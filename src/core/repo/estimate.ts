import type { Db } from '../db/db';
import { nowIso } from '../db/db';
import type { EstimateCategory, EstimateRow, EstimateNorm, EstimateValueMethod } from '../domain/types';

const toCategory = (r: any): EstimateCategory => ({ id: r.id, projectId: r.project_id, name: r.name,
  sortOrder: r.sort_order, createdAt: r.created_at, updatedAt: r.updated_at });
const toRow = (r: any): EstimateRow => ({ id: r.id, categoryId: r.category_id, name: r.name,
  sortOrder: r.sort_order, valueMethod: r.value_method,
  manualAmountCents: r.manual_amount_cents, coefBaseCents: r.coef_base_cents, coefFactor: r.coef_factor,
  refSectionId: r.ref_section_id, remark: r.remark, createdAt: r.created_at, updatedAt: r.updated_at });
const toNorm = (r: any): EstimateNorm => ({ id: r.id, projectType: r.project_type, spaceType: r.space_type,
  unitPriceLowCents: r.unit_price_low_cents, unitPriceHighCents: r.unit_price_high_cents,
  note: r.note, createdAt: r.created_at, updatedAt: r.updated_at });

function nextSort(db: Db, table: 'estimate_categories' | 'estimate_rows', fkCol: string, fkVal: number): number {
  const r = db.prepare(`SELECT COALESCE(MAX(sort_order)+1, 0) AS n FROM ${table} WHERE ${fkCol}=?`).get(fkVal) as any;
  return r.n;
}

// ===== 分类（大类） =====

export function createEstimateCategory(db: Db, input: { projectId: number; name: string }): EstimateCategory {
  const t = nowIso();
  const info = db.prepare(`INSERT INTO estimate_categories (project_id, name, sort_order, created_at, updated_at)
    VALUES (?,?,?,?,?)`).run(input.projectId, input.name,
    nextSort(db, 'estimate_categories', 'project_id', input.projectId), t, t);
  return toCategory(db.prepare('SELECT * FROM estimate_categories WHERE id=?').get(Number(info.lastInsertRowid)));
}
export function listEstimateCategories(db: Db, projectId: number): EstimateCategory[] {
  return db.prepare('SELECT * FROM estimate_categories WHERE project_id=? ORDER BY sort_order').all(projectId).map(toCategory);
}
export function updateEstimateCategory(db: Db, id: number, patch: Partial<{ name: string; sortOrder: number }>): EstimateCategory {
  const r0 = db.prepare('SELECT * FROM estimate_categories WHERE id=?').get(id);
  if (!r0) throw new Error(`estimate category ${id} not found`);
  const cur = toCategory(r0); const m = { ...cur, ...patch };
  db.prepare('UPDATE estimate_categories SET name=?, sort_order=?, updated_at=? WHERE id=?')
    .run(m.name, m.sortOrder, nowIso(), id);
  return toCategory(db.prepare('SELECT * FROM estimate_categories WHERE id=?').get(id));
}
export function deleteEstimateCategory(db: Db, id: number): void {
  db.prepare('DELETE FROM estimate_categories WHERE id=?').run(id);
}

// ===== 行（子项） =====

export function createEstimateRow(db: Db, input: {
  categoryId: number; name: string; valueMethod?: EstimateValueMethod;
  manualAmountCents?: number | null; coefBaseCents?: number | null; coefFactor?: number | null;
  refSectionId?: number | null; remark?: string | null;
}): EstimateRow {
  const t = nowIso();
  const info = db.prepare(`INSERT INTO estimate_rows
    (category_id, name, sort_order, value_method, manual_amount_cents, coef_base_cents, coef_factor, ref_section_id, remark, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
    input.categoryId, input.name,
    nextSort(db, 'estimate_rows', 'category_id', input.categoryId),
    input.valueMethod ?? 'manual',
    input.manualAmountCents ?? null, input.coefBaseCents ?? null, input.coefFactor ?? null,
    input.refSectionId ?? null, input.remark ?? null, t, t);
  return toRow(db.prepare('SELECT * FROM estimate_rows WHERE id=?').get(Number(info.lastInsertRowid)));
}
export function listEstimateRows(db: Db, categoryId: number): EstimateRow[] {
  return db.prepare('SELECT * FROM estimate_rows WHERE category_id=? ORDER BY sort_order').all(categoryId).map(toRow);
}
export function getEstimateRow(db: Db, id: number): EstimateRow | null {
  const r = db.prepare('SELECT * FROM estimate_rows WHERE id=?').get(id);
  return r ? toRow(r) : null;
}
export function updateEstimateRow(db: Db, id: number, patch: Partial<{
  name: string; sortOrder: number; valueMethod: EstimateValueMethod;
  manualAmountCents: number | null; coefBaseCents: number | null; coefFactor: number | null;
  refSectionId: number | null; remark: string | null;
}>): EstimateRow {
  const cur = getEstimateRow(db, id); if (!cur) throw new Error(`estimate row ${id} not found`);
  const m = { ...cur, ...patch };
  db.prepare(`UPDATE estimate_rows SET name=?, sort_order=?, value_method=?, manual_amount_cents=?,
    coef_base_cents=?, coef_factor=?, ref_section_id=?, remark=?, updated_at=? WHERE id=?`).run(
    m.name, m.sortOrder, m.valueMethod, m.manualAmountCents ?? null,
    m.coefBaseCents ?? null, m.coefFactor ?? null, m.refSectionId ?? null, m.remark ?? null, nowIso(), id);
  return getEstimateRow(db, id)!;
}
export function deleteEstimateRow(db: Db, id: number): void {
  db.prepare('DELETE FROM estimate_rows WHERE id=?').run(id);
}

// ===== 指标库 =====

export function createEstimateNorm(db: Db, input: {
  projectType?: string | null; spaceType?: string | null;
  unitPriceLowCents?: number | null; unitPriceHighCents?: number | null; note?: string | null;
}): EstimateNorm {
  const t = nowIso();
  const info = db.prepare(`INSERT INTO estimate_norms
    (project_type, space_type, unit_price_low_cents, unit_price_high_cents, note, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?)`).run(
    input.projectType ?? null, input.spaceType ?? null,
    input.unitPriceLowCents ?? null, input.unitPriceHighCents ?? null, input.note ?? null, t, t);
  return toNorm(db.prepare('SELECT * FROM estimate_norms WHERE id=?').get(Number(info.lastInsertRowid)));
}
export function listEstimateNorms(db: Db): EstimateNorm[] {
  return db.prepare('SELECT * FROM estimate_norms ORDER BY id').all().map(toNorm);
}
export function updateEstimateNorm(db: Db, id: number, patch: Partial<{
  projectType: string | null; spaceType: string | null;
  unitPriceLowCents: number | null; unitPriceHighCents: number | null; note: string | null;
}>): EstimateNorm {
  const r0 = db.prepare('SELECT * FROM estimate_norms WHERE id=?').get(id);
  if (!r0) throw new Error(`estimate norm ${id} not found`);
  const cur = toNorm(r0); const m = { ...cur, ...patch };
  db.prepare(`UPDATE estimate_norms SET project_type=?, space_type=?, unit_price_low_cents=?,
    unit_price_high_cents=?, note=?, updated_at=? WHERE id=?`).run(
    m.projectType ?? null, m.spaceType ?? null, m.unitPriceLowCents ?? null,
    m.unitPriceHighCents ?? null, m.note ?? null, nowIso(), id);
  return toNorm(db.prepare('SELECT * FROM estimate_norms WHERE id=?').get(id));
}
export function deleteEstimateNorm(db: Db, id: number): void {
  db.prepare('DELETE FROM estimate_norms WHERE id=?').run(id);
}

/** 批量创建概算指标（事务内，失败全部回滚）。 */
export function batchCreateEstimateNorms(db: Db, inputs: {
  projectType?: string | null; spaceType?: string | null;
  unitPriceLowCents?: number | null; unitPriceHighCents?: number | null; note?: string | null;
}[]): number {
  const run = db.transaction(() => {
    let count = 0;
    for (const input of inputs) {
      createEstimateNorm(db, input);
      count++;
    }
    return count;
  });
  return run();
}

// ===== 默认结构 =====

const DEFAULT_CATEGORIES: { name: string; rows: string[] }[] = [
  { name: '布展装饰工程费', rows: ['地面工程', '墙面工程', '吊顶工程', '门窗工程'] },
  { name: '安装工程费', rows: ['电气安装', '给排水安装', '暖通安装'] },
  { name: '陈列布展费', rows: ['展具制作', '图文制作', '灯光照明'] },
  { name: '多媒体系统工程费', rows: ['多媒体硬件', '软件与内容', '系统集成'] },
  { name: '其他费用', rows: ['设计费', '管理费', '不可预见费'] },
];

/**
 * 为项目播种默认概算结构。幂等：若该项目已存在大类则不做任何事并返回 0。
 * 否则按默认结构创建大类及其子项（子项 valueMethod='manual'，金额留 null），返回创建的大类数。
 */
export function seedDefaultCategories(db: Db, projectId: number): number {
  if (listEstimateCategories(db, projectId).length > 0) return 0;
  const run = db.transaction(() => {
    for (const cat of DEFAULT_CATEGORIES) {
      const c = createEstimateCategory(db, { projectId, name: cat.name });
      for (const rowName of cat.rows) {
        createEstimateRow(db, { categoryId: c.id, name: rowName });
      }
    }
    return DEFAULT_CATEGORIES.length;
  });
  return run();
}
