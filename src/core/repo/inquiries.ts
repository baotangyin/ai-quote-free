import type { Db } from '../db/db';
import { nowIso } from '../db/db';
import type { Inquiry, InquiryDetail, InquiryItem, PriceRecord } from '../domain/types';
import { getSupplier } from './suppliers';
import { getProject } from './projects';
import { getProduct } from './products';
import { addPriceRecord } from './prices';

function toInquiry(r: any): Inquiry {
  return {
    id: r.id, supplierId: r.supplier_id, supplierName: r.supplier_name,
    projectId: r.project_id, projectName: r.project_name,
    title: r.title, note: r.note, itemCount: r.item_count ?? 0,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

const ITEM_COUNT_SELECT = `SELECT *, (SELECT COUNT(*) FROM inquiry_items WHERE inquiry_id = inquiries.id) AS item_count FROM inquiries`;

function toItem(r: any): InquiryItem {
  return {
    id: r.id, inquiryId: r.inquiry_id, productId: r.product_id,
    name: r.name, params: r.params, unit: r.unit, qty: r.qty,
    remark: r.remark, replyPriceCents: r.reply_price_cents,
    sortOrder: r.sort_order, createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

export interface CreateInquiryItemInput {
  productId?: number | null;
  name: string;
  params?: string | null;
  unit: string;
  qty: number;
  remark?: string | null;
}

/**
 * 新建询价单（不含我方价格）。事务：先按 supplierId/projectId 查出当前名称快照为
 * supplier_name/project_name（此后独立于供应商/项目库，改名或删除均不影响询价单显示），
 * 再按顺序插入行（sort_order = 数组下标）。supplierId/projectId 对应记录不存在时抛中文错。
 */
export function createInquiry(db: Db, input: {
  supplierId: number; projectId: number; title: string; note?: string | null;
  items: CreateInquiryItemInput[];
}): InquiryDetail {
  const run = db.transaction(() => {
    const supplier = getSupplier(db, input.supplierId);
    if (!supplier) throw new Error(`供应商 ${input.supplierId} 不存在`);
    const project = getProject(db, input.projectId);
    if (!project) throw new Error(`项目 ${input.projectId} 不存在`);

    const t = nowIso();
    const info = db.prepare(`INSERT INTO inquiries
      (supplier_id, supplier_name, project_id, project_name, title, note, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?)`).run(
      input.supplierId, supplier.name, input.projectId, project.name,
      input.title, input.note ?? null, t, t);
    const inquiryId = Number(info.lastInsertRowid);

    input.items.forEach((it, idx) => {
      db.prepare(`INSERT INTO inquiry_items
        (inquiry_id, product_id, name, params, unit, qty, remark, sort_order, created_at, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
        inquiryId, it.productId ?? null, it.name, it.params ?? null, it.unit,
        it.qty, it.remark ?? null, idx, t, t);
    });

    return getInquiry(db, inquiryId)!;
  });
  return run();
}

export function listInquiries(db: Db, supplierId?: number): Inquiry[] {
  if (supplierId != null) {
    return db.prepare(`${ITEM_COUNT_SELECT} WHERE supplier_id=? ORDER BY created_at DESC, id DESC`)
      .all(supplierId).map(toInquiry);
  }
  return db.prepare(`${ITEM_COUNT_SELECT} ORDER BY created_at DESC, id DESC`).all().map(toInquiry);
}

export function getInquiry(db: Db, id: number): InquiryDetail | null {
  const r = db.prepare(`${ITEM_COUNT_SELECT} WHERE id=?`).get(id);
  if (!r) return null;
  const items = db.prepare('SELECT * FROM inquiry_items WHERE inquiry_id=? ORDER BY sort_order, id')
    .all(id).map(toItem);
  return { ...toInquiry(r), items };
}

/** 删除询价单，行经 inquiry_items.inquiry_id 的 ON DELETE CASCADE 级联删除。 */
export function deleteInquiry(db: Db, id: number): void {
  db.prepare('DELETE FROM inquiries WHERE id=?').run(id);
}

/** 设置/清空某询价单行的供应商回价（元←→分由调用方转换）。传 null 清空回价。 */
export function setInquiryItemReply(db: Db, itemId: number, replyPriceCents: number | null): InquiryItem {
  const r0 = db.prepare('SELECT * FROM inquiry_items WHERE id=?').get(itemId);
  if (!r0) throw new Error(`询价单行 ${itemId} 不存在`);
  db.prepare('UPDATE inquiry_items SET reply_price_cents=?, updated_at=? WHERE id=?')
    .run(replyPriceCents, nowIso(), itemId);
  return toItem(db.prepare('SELECT * FROM inquiry_items WHERE id=?').get(itemId));
}

/**
 * 将某询价单行的回价写入价格记录（source='supplier'，supplierId 取所属询价单当前的 supplier_id，
 * capturedAt=now）。校验顺序：
 * 1. 行不存在 → 中文错；
 * 2. productId 为空（手工行）→「手工行无法写入价格记录」；
 * 3. productId 指向的产品已不存在（防御性校验，产品可能已被删除）→「产品已不存在，无法写入价格记录」；
 * 4. 尚无回价 → 「该行尚未填写回价，无法写入价格记录」。
 */
export function writeReplyToPriceRecord(db: Db, itemId: number): PriceRecord {
  const item = db.prepare('SELECT * FROM inquiry_items WHERE id=?').get(itemId) as any;
  if (!item) throw new Error(`询价单行 ${itemId} 不存在`);
  if (item.product_id == null) throw new Error('手工行无法写入价格记录');
  const product = getProduct(db, item.product_id);
  if (!product) throw new Error('产品已不存在，无法写入价格记录');
  if (item.reply_price_cents == null) throw new Error('该行尚未填写回价，无法写入价格记录');

  const inquiry = db.prepare('SELECT supplier_id FROM inquiries WHERE id=?').get(item.inquiry_id) as any;
  return addPriceRecord(db, {
    productId: item.product_id,
    source: 'supplier',
    supplierId: inquiry?.supplier_id ?? undefined,
    priceCents: item.reply_price_cents,
  });
}
