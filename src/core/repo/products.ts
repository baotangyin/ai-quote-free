import type { Db } from '../db/db';
import { nowIso } from '../db/db';
import type { Product, ProductOption, CostRule } from '../domain/types';

export interface ProductInput {
  name: string; unit: string;
  /** 兼容旧版单分类字段。与 categories 二选一给，都给时 categories 优先。 */
  category?: string;
  /** 多分类标签（如设备类别 + 尺寸标签），同一设备可属多个分类。 */
  categories?: string[];
  brand?: string | null; model?: string | null;
  recommendedBrands?: string[];
  paramsCore?: string | null; paramsBid?: string | null; paramsTender?: string | null;
  dims?: string | null;
  power220W?: number; power380W?: number;
  rackU?: number; seqPowerPorts?: number; netPorts?: number; comPorts?: number;
  imagePath?: string | null; note?: string | null;
  options?: ProductOption[];
  costRuleOverride?: CostRule | null;
  watchPrice?: boolean;
}

/**
 * 解析 category/categories 二选一输入为落库用的一致值：
 * - categoriesIn 非空数组时优先采用（去空白/去重），category 缺省时取 categories[0]。
 * - 否则若 categoryIn 有值，视为单分类，categories=[category]。
 * - 两者均未传入（如 update 时未改动分类）时回退 fallback（通常是当前值）。
 */
function resolveCategories(
  categoryIn: string | undefined,
  categoriesIn: string[] | undefined,
  fallback: { category: string; categories: string[] },
): { category: string; categories: string[] } {
  if (categoriesIn !== undefined) {
    const cats = Array.from(new Set(categoriesIn.map((c) => c.trim()).filter(Boolean)));
    const category = (categoryIn ?? '').trim() || cats[0] || '';
    return { category, categories: cats.length > 0 ? cats : (category ? [category] : []) };
  }
  if (categoryIn !== undefined) {
    const category = categoryIn.trim();
    return { category, categories: category ? [category] : [] };
  }
  return fallback;
}

function rowToProduct(r: any): Product {
  let categories: string[] = [];
  try {
    const parsed = JSON.parse(r.categories ?? '[]');
    if (Array.isArray(parsed)) categories = parsed.filter((c): c is string => typeof c === 'string' && c.trim().length > 0);
  } catch {
    // 无法解析时回退到单分类
  }
  if (categories.length === 0 && r.category) categories = [r.category];
  return {
    id: r.id, category: r.category, categories, name: r.name, brand: r.brand, model: r.model,
    recommendedBrands: JSON.parse(r.recommended_brands),
    paramsCore: r.params_core, paramsBid: r.params_bid, paramsTender: r.params_tender,
    unit: r.unit, dims: r.dims,
    power220W: r.power220_w, power380W: r.power380_w,
    rackU: r.rack_u, seqPowerPorts: r.seq_power_ports,
    netPorts: r.net_ports, comPorts: r.com_ports,
    imagePath: r.image_path, note: r.note,
    options: JSON.parse(r.options),
    costRuleOverride: r.cost_rule_override,
    watchPrice: r.watch_price !== 0,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

export function createProduct(db: Db, input: ProductInput): Product {
  const t = nowIso();
  const { category, categories } = resolveCategories(input.category, input.categories, { category: '', categories: [] });
  const info = db.prepare(`INSERT INTO products
    (category,categories,name,brand,model,recommended_brands,params_core,params_bid,params_tender,
     unit,dims,power220_w,power380_w,rack_u,seq_power_ports,net_ports,com_ports,
     image_path,note,options,cost_rule_override,watch_price,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    category, JSON.stringify(categories), input.name, input.brand ?? null, input.model ?? null,
    JSON.stringify(input.recommendedBrands ?? []),
    input.paramsCore ?? null, input.paramsBid ?? null, input.paramsTender ?? null,
    input.unit, input.dims ?? null,
    input.power220W ?? 0, input.power380W ?? 0,
    input.rackU ?? 0, input.seqPowerPorts ?? 0, input.netPorts ?? 0, input.comPorts ?? 0,
    input.imagePath ?? null, input.note ?? null,
    JSON.stringify(input.options ?? []), input.costRuleOverride ?? null, input.watchPrice ? 1 : 0, t, t);
  return getProduct(db, Number(info.lastInsertRowid))!;
}

export function getProduct(db: Db, id: number): Product | null {
  const r = db.prepare('SELECT * FROM products WHERE id=?').get(id);
  return r ? rowToProduct(r) : null;
}

export function listProducts(db: Db, filter?: { category?: string; keyword?: string }): Product[] {
  let sql = 'SELECT * FROM products WHERE 1=1';
  const args: unknown[] = [];
  if (filter?.category) {
    // 命中条件：categories 数组包含该值（JSON 文本子串匹配），或旧 category 字段等于该值
    sql += ' AND (categories LIKE ? OR category = ?)';
    args.push(`%"${filter.category}"%`, filter.category);
  }
  if (filter?.keyword) {
    sql += ' AND (name LIKE ? OR brand LIKE ? OR model LIKE ?)';
    const k = `%${filter.keyword}%`; args.push(k, k, k);
  }
  sql += ' ORDER BY id';
  return db.prepare(sql).all(...args).map(rowToProduct);
}

export function updateProduct(db: Db, id: number, patch: Partial<ProductInput>): Product {
  const cur = getProduct(db, id);
  if (!cur) throw new Error(`product ${id} not found`);
  const merged = { ...cur, ...patch } as Product & ProductInput;
  const { category, categories } = resolveCategories(patch.category, patch.categories, {
    category: cur.category,
    categories: cur.categories,
  });
  db.prepare(`UPDATE products SET category=?,categories=?,name=?,brand=?,model=?,recommended_brands=?,
    params_core=?,params_bid=?,params_tender=?,unit=?,dims=?,power220_w=?,power380_w=?,
    rack_u=?,seq_power_ports=?,net_ports=?,com_ports=?,image_path=?,note=?,options=?,
    cost_rule_override=?,watch_price=?,updated_at=? WHERE id=?`).run(
    category, JSON.stringify(categories), merged.name, merged.brand ?? null, merged.model ?? null,
    JSON.stringify(merged.recommendedBrands ?? []),
    merged.paramsCore ?? null, merged.paramsBid ?? null, merged.paramsTender ?? null,
    merged.unit, merged.dims ?? null, merged.power220W ?? 0, merged.power380W ?? 0,
    merged.rackU ?? 0, merged.seqPowerPorts ?? 0, merged.netPorts ?? 0, merged.comPorts ?? 0,
    merged.imagePath ?? null, merged.note ?? null, JSON.stringify(merged.options ?? []),
    merged.costRuleOverride ?? null, merged.watchPrice ? 1 : 0, nowIso(), id);
  return getProduct(db, id)!;
}

export function deleteProduct(db: Db, id: number): void {
  db.prepare('DELETE FROM products WHERE id=?').run(id);
}

export interface SuggestBrandsInput {
  brand?: string | null;
  categories: string[];
  /** 编辑已有产品时排除自身，避免把自己算作"同分类的其他产品"。 */
  excludeProductId?: number;
}

/**
 * 推荐品牌自动生成：结果为 [自身品牌（非空时）, ...同分类（categories 任一交集）产品的其他
 * distinct 品牌，最多取 2 个]。整体去重、排除空值，结果最多 3 个；不足 2 个可用品牌时按实际数量返回。
 */
export function suggestBrands(db: Db, input: SuggestBrandsInput): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  const ownBrand = (input.brand ?? '').trim();
  if (ownBrand) {
    result.push(ownBrand);
    seen.add(ownBrand);
  }

  if (input.categories.length > 0) {
    const others = listProducts(db);
    const otherBrandLimit = 2;
    let otherBrandCount = 0;
    for (const p of others) {
      if (otherBrandCount >= otherBrandLimit) break;
      if (input.excludeProductId != null && p.id === input.excludeProductId) continue;
      const shares = p.categories.some((c) => input.categories.includes(c));
      if (!shares) continue;
      const b = (p.brand ?? '').trim();
      if (!b || seen.has(b)) continue;
      seen.add(b);
      result.push(b);
      otherBrandCount++;
    }
  }

  return result.slice(0, 3);
}

/** 列出所有已启用价格监控的产品。 */
export function listWatchedProducts(db: Db): Product[] {
  return db.prepare('SELECT * FROM products WHERE watch_price != 0 ORDER BY id').all().map(rowToProduct);
}

/** 批量设置产品的价格监控状态。返回实际更新的产品数。 */
export function setWatchPrice(db: Db, ids: number[], watch: boolean): number {
  if (ids.length === 0) return 0;
  const placeholders = ids.map(() => '?').join(',');
  const watchValue = watch ? 1 : 0;
  const info = db.prepare(`UPDATE products SET watch_price = ? WHERE id IN (${placeholders})`).run(watchValue, ...ids);
  return Number(info.changes);
}
