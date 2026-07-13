import type { Db } from '../db/db';
import { nowIso } from '../db/db';
import type { PriceRecord, PriceSource, CostRule, Cents } from '../domain/types';

function rowToRecord(r: any): PriceRecord {
  return { id: r.id, productId: r.product_id, source: r.source, supplierId: r.supplier_id,
    priceCents: r.price_cents, sourceUrl: r.source_url, capturedAt: r.captured_at,
    createdAt: r.created_at, updatedAt: r.updated_at };
}

export function addPriceRecord(db: Db, input: {
  productId: number; source: PriceSource; priceCents: Cents;
  supplierId?: number; sourceUrl?: string; capturedAt?: string;
}): PriceRecord {
  const t = nowIso();
  const info = db.prepare(`INSERT INTO price_records
    (product_id, source, supplier_id, price_cents, source_url, captured_at, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?)`).run(
    input.productId, input.source, input.supplierId ?? null, input.priceCents,
    input.sourceUrl ?? null, input.capturedAt ?? t, t, t);
  const r = db.prepare('SELECT * FROM price_records WHERE id=?').get(Number(info.lastInsertRowid));
  return rowToRecord(r);
}

export function listPriceRecords(db: Db, productId: number): PriceRecord[] {
  return db.prepare('SELECT * FROM price_records WHERE product_id=? ORDER BY captured_at DESC, id DESC')
    .all(productId).map(rowToRecord);
}

export function getEffectiveCost(db: Db, productId: number, globalRule: CostRule): Cents | null {
  const override = (db.prepare('SELECT cost_rule_override FROM products WHERE id=?')
    .get(productId) as any)?.cost_rule_override as CostRule | null | undefined;
  const rule: CostRule = override ?? globalRule;

  if (rule === 'lowest') {
    const r = db.prepare('SELECT MIN(price_cents) AS p FROM price_records WHERE product_id=?')
      .get(productId) as any;
    return r?.p ?? null;
  }
  if (rule === 'latest') {
    const r = db.prepare('SELECT price_cents FROM price_records WHERE product_id=? ORDER BY captured_at DESC, id DESC LIMIT 1')
      .get(productId) as any;
    return r?.price_cents ?? null;
  }
  const supplierId = Number(rule.split(':')[1]);
  const r = db.prepare('SELECT price_cents FROM price_records WHERE product_id=? AND supplier_id=? ORDER BY captured_at DESC, id DESC LIMIT 1')
    .get(productId, supplierId) as any;
  return r?.price_cents ?? null;
}
