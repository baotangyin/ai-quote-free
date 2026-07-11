import type { Db } from '../db/db';
import { nowIso } from '../db/db';
import type { CategoryParamDefaults, CategoryParamTemplate } from '../domain/types';

const STRING_KEYS = ['unit', 'paramsCore', 'paramsBid', 'paramsTender'] as const;
const NUMBER_KEYS = ['power220W', 'power380W', 'rackU', 'seqPowerPorts', 'netPorts', 'comPorts'] as const;

/** 校验并返回模板 defaults；非法结构抛中文错误（写路径把关）。 */
export function validateCategoryParamDefaults(v: unknown): CategoryParamDefaults {
  if (v === null || typeof v !== 'object') throw new Error('模板默认值必须是对象');
  const obj = v as Record<string, unknown>;
  const out: CategoryParamDefaults = {};
  for (const k of STRING_KEYS) {
    const val = obj[k];
    if (val === undefined || val === null) continue;
    if (typeof val !== 'string') throw new Error(`${k} 必须是文本`);
    out[k] = val;
  }
  for (const k of NUMBER_KEYS) {
    const val = obj[k];
    if (val === undefined || val === null) continue;
    if (typeof val !== 'number' || !Number.isFinite(val)) throw new Error(`${k} 必须是数字`);
    out[k] = val;
  }
  return out;
}

/** 读路径：损坏/非法 defaults 容错回退空对象（不影响产品创建主流程）。 */
function parseDefaults(raw: string): CategoryParamDefaults {
  try {
    return validateCategoryParamDefaults(JSON.parse(raw));
  } catch {
    return {};
  }
}

const toTemplate = (r: any): CategoryParamTemplate => ({
  id: r.id,
  category: r.category,
  defaults: parseDefaults(r.defaults),
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export function listCategoryTemplates(db: Db): CategoryParamTemplate[] {
  return db.prepare('SELECT * FROM category_param_templates ORDER BY id').all().map(toTemplate);
}

export function getCategoryTemplate(db: Db, id: number): CategoryParamTemplate | null {
  const r = db.prepare('SELECT * FROM category_param_templates WHERE id=?').get(id);
  return r ? toTemplate(r) : null;
}

export function getCategoryTemplateByCategory(db: Db, category: string): CategoryParamTemplate | null {
  const r = db.prepare('SELECT * FROM category_param_templates WHERE category=?').get(category);
  return r ? toTemplate(r) : null;
}

export function createCategoryTemplate(
  db: Db,
  input: { category: string; defaults: CategoryParamDefaults },
): CategoryParamTemplate {
  const category = input.category.trim();
  if (!category) throw new Error('类别名不能为空');
  const defaults = validateCategoryParamDefaults(input.defaults);
  const t = nowIso();
  try {
    const info = db
      .prepare('INSERT INTO category_param_templates (category, defaults, created_at, updated_at) VALUES (?,?,?,?)')
      .run(category, JSON.stringify(defaults), t, t);
    return getCategoryTemplate(db, Number(info.lastInsertRowid))!;
  } catch (err) {
    if ((err as Error).message.includes('UNIQUE')) throw new Error(`类别「${category}」的模板已存在`);
    throw err;
  }
}

export function updateCategoryTemplate(
  db: Db,
  id: number,
  patch: Partial<{ category: string; defaults: CategoryParamDefaults }>,
): CategoryParamTemplate {
  const cur = getCategoryTemplate(db, id);
  if (!cur) throw new Error(`模板 ${id} 不存在`);
  const category = (patch.category ?? cur.category).trim();
  if (!category) throw new Error('类别名不能为空');
  const defaults = patch.defaults !== undefined ? validateCategoryParamDefaults(patch.defaults) : cur.defaults;
  try {
    db.prepare('UPDATE category_param_templates SET category=?, defaults=?, updated_at=? WHERE id=?').run(
      category,
      JSON.stringify(defaults),
      nowIso(),
      id,
    );
  } catch (err) {
    if ((err as Error).message.includes('UNIQUE')) throw new Error(`类别「${category}」的模板已存在`);
    throw err;
  }
  return getCategoryTemplate(db, id)!;
}

export function deleteCategoryTemplate(db: Db, id: number): void {
  db.prepare('DELETE FROM category_param_templates WHERE id=?').run(id);
}

/** applyCategoryDefaults 可应用的产品技术字段子集（与 ProductInput 兼容）。 */
export interface ApplyCategoryDefaultsFields {
  unit?: string;
  power220W?: number;
  power380W?: number;
  rackU?: number;
  seqPowerPorts?: number;
  netPorts?: number;
  comPorts?: number;
  paramsCore?: string | null;
  paramsBid?: string | null;
  paramsTender?: string | null;
}

/** 字段「空/零值」判定：null/undefined、空白字符串、数字 0 均视为空。 */
function isEmptyValue(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (typeof v === 'number') return v === 0;
  return false;
}

/**
 * 按 categories 顺序查找首个命中类别参数模板（首个存在模板的类别生效，找不到则不应用任何默认值）。
 */
export function findCategoryTemplate(db: Db, categories: string[]): CategoryParamTemplate | null {
  for (const c of categories) {
    const t = getCategoryTemplateByCategory(db, c);
    if (t) return t;
  }
  return null;
}

/**
 * 为 fields 中「空/零值」字段填充命中类别模板的默认值；已有非空/非零值的字段不覆盖。
 * 未命中任何类别模板时原样返回 fields（浅拷贝）。
 */
export function applyCategoryDefaults<T extends ApplyCategoryDefaultsFields>(
  db: Db,
  categories: string[],
  fields: T,
): T {
  const tpl = findCategoryTemplate(db, categories);
  const out: T = { ...fields };
  if (!tpl) return out;
  const d = tpl.defaults;
  if (d.unit !== undefined && isEmptyValue(out.unit)) out.unit = d.unit as T['unit'];
  if (d.power220W !== undefined && isEmptyValue(out.power220W)) out.power220W = d.power220W as T['power220W'];
  if (d.power380W !== undefined && isEmptyValue(out.power380W)) out.power380W = d.power380W as T['power380W'];
  if (d.rackU !== undefined && isEmptyValue(out.rackU)) out.rackU = d.rackU as T['rackU'];
  if (d.seqPowerPorts !== undefined && isEmptyValue(out.seqPowerPorts)) out.seqPowerPorts = d.seqPowerPorts as T['seqPowerPorts'];
  if (d.netPorts !== undefined && isEmptyValue(out.netPorts)) out.netPorts = d.netPorts as T['netPorts'];
  if (d.comPorts !== undefined && isEmptyValue(out.comPorts)) out.comPorts = d.comPorts as T['comPorts'];
  if (d.paramsCore !== undefined && isEmptyValue(out.paramsCore)) out.paramsCore = d.paramsCore as T['paramsCore'];
  if (d.paramsBid !== undefined && isEmptyValue(out.paramsBid)) out.paramsBid = d.paramsBid as T['paramsBid'];
  if (d.paramsTender !== undefined && isEmptyValue(out.paramsTender)) out.paramsTender = d.paramsTender as T['paramsTender'];
  return out;
}
