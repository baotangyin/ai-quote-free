import type { Db } from '../db/db';
import { nowIso } from '../db/db';
import type { LineItem, LineItemCost } from '../domain/types';
import { getLineItem, updateLineItem } from './projects';
import { getProduct } from './products';
import { getSupplier } from './suppliers';
import { listPriceRecords } from './prices';

const toCost = (r: any): LineItemCost => ({
  id: r.id, lineItemId: r.line_item_id, supplierId: r.supplier_id,
  supplierName: r.supplier_name, brand: r.brand, model: r.model,
  costUnitCents: r.cost_unit_cents, isActive: !!r.is_active, note: r.note,
  sortOrder: r.sort_order, createdAt: r.created_at, updatedAt: r.updated_at,
});

function nextSort(db: Db, lineItemId: number): number {
  const r = db.prepare('SELECT COALESCE(MAX(sort_order)+1, 0) AS n FROM line_item_costs WHERE line_item_id=?')
    .get(lineItemId) as any;
  return r.n;
}

/**
 * 新建候选成本方案。始终以「非生效」（is_active=0）插入——生效状态一律经 setActiveCost 设置，
 * 以维持「单行至多一条生效且快照与之同步」的不变量。
 */
export function createLineItemCost(db: Db, input: {
  lineItemId: number; costUnitCents: number;
  supplierId?: number | null; supplierName?: string | null;
  brand?: string | null; model?: string | null; note?: string | null;
}): LineItemCost {
  const t = nowIso();
  const info = db.prepare(`INSERT INTO line_item_costs
    (line_item_id, supplier_id, supplier_name, brand, model, cost_unit_cents, is_active, sort_order, note, created_at, updated_at)
    VALUES (?,?,?,?,?,?,0,?,?,?,?)`).run(
    input.lineItemId, input.supplierId ?? null, input.supplierName ?? null,
    input.brand ?? null, input.model ?? null, input.costUnitCents,
    nextSort(db, input.lineItemId), input.note ?? null, t, t);
  return getLineItemCost(db, Number(info.lastInsertRowid))!;
}

export function getLineItemCost(db: Db, id: number): LineItemCost | null {
  const r = db.prepare('SELECT * FROM line_item_costs WHERE id=?').get(id);
  return r ? toCost(r) : null;
}

/** 取某清单行当前生效的候选成本方案；无生效则返回 null。 */
export function getActiveLineItemCost(db: Db, lineItemId: number): LineItemCost | null {
  const r = db.prepare('SELECT * FROM line_item_costs WHERE line_item_id=? AND is_active=1 LIMIT 1').get(lineItemId);
  return r ? toCost(r) : null;
}

export function listLineItemCosts(db: Db, lineItemId: number): LineItemCost[] {
  return db.prepare('SELECT * FROM line_item_costs WHERE line_item_id=? ORDER BY sort_order, id')
    .all(lineItemId).map(toCost);
}

export function updateLineItemCost(db: Db, id: number, patch: Partial<{
  supplierId: number | null; supplierName: string | null; brand: string | null;
  model: string | null; costUnitCents: number; note: string | null; sortOrder: number;
}>): LineItemCost {
  const cur = getLineItemCost(db, id);
  if (!cur) throw new Error(`line item cost ${id} not found`);
  const m = { ...cur, ...patch };
  db.prepare(`UPDATE line_item_costs SET supplier_id=?, supplier_name=?, brand=?, model=?,
    cost_unit_cents=?, note=?, sort_order=?, updated_at=? WHERE id=?`).run(
    m.supplierId ?? null, m.supplierName ?? null, m.brand ?? null, m.model ?? null,
    m.costUnitCents, m.note ?? null, m.sortOrder, nowIso(), id);
  return getLineItemCost(db, id)!;
}

export function deleteLineItemCost(db: Db, id: number): void {
  db.prepare('DELETE FROM line_item_costs WHERE id=?').run(id);
}

/**
 * 将指定候选设为生效方案，并同步到所属清单行的成本快照。事务保证：
 * 同一清单行至多一个候选 is_active=1，且 line_items.snapshot.costUnitCents 等于生效候选成本。
 */
export function setActiveCost(db: Db, costId: number): LineItem {
  const run = db.transaction(() => {
    const cost = getLineItemCost(db, costId);
    if (!cost) throw new Error(`line item cost ${costId} not found`);
    const lineItemId = cost.lineItemId;
    const t = nowIso();
    db.prepare('UPDATE line_item_costs SET is_active=0, updated_at=? WHERE line_item_id=?').run(t, lineItemId);
    db.prepare('UPDATE line_item_costs SET is_active=1, updated_at=? WHERE id=?').run(t, costId);
    const li = getLineItem(db, lineItemId);
    if (li) {
      const snapshot = { ...li.snapshot, costUnitCents: cost.costUnitCents };
      updateLineItem(db, lineItemId, { snapshot });
    }
    return getLineItem(db, lineItemId)!;
  });
  return run();
}

/**
 * 从产品价格记录为清单行播种候选成本。幂等：该行已有候选时返回 0。
 * 手工行（productId 为 null）返回 0。按供应商分组（无供应商单独一组），
 * 每组取最新一条价格。不自动设为生效。返回新建候选数。
 */
export function seedCostsFromPrices(db: Db, lineItemId: number): number {
  if (listLineItemCosts(db, lineItemId).length > 0) return 0;
  const li = getLineItem(db, lineItemId);
  if (!li || li.productId == null) return 0;
  const productId = li.productId;
  const product = getProduct(db, productId);
  const records = listPriceRecords(db, productId); // 最新在前
  const seen = new Set<string>();
  let count = 0;
  for (const rec of records) {
    const key = rec.supplierId == null ? 'null' : String(rec.supplierId);
    if (seen.has(key)) continue; // 每组取第一条（最新）
    seen.add(key);
    const supplierName = rec.supplierId != null ? (getSupplier(db, rec.supplierId)?.name ?? null) : null;
    createLineItemCost(db, {
      lineItemId, supplierId: rec.supplierId, supplierName,
      brand: product?.brand ?? null, model: product?.model ?? null,
      costUnitCents: rec.priceCents,
    });
    count++;
  }
  return count;
}
