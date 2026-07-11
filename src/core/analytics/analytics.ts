import type { Db } from '../db/db';
import type { Cents, LineItem, Project } from '../domain/types';
import { lineTotals, type LineTotals } from '../domain/pricing';

export interface AnalyticsFilter { from?: string; to?: string; onlyDone?: boolean; }

export interface ProductProfitRow {
  productId: number; name: string; category: string; usageCount: number; totalQty: number;
  costTotalCents: Cents; revenueTotalCents: Cents; profitCents: Cents; profitRate: number | null;
}

export interface ProjectProfitRow {
  projectId: number; name: string; status: string; createdAt: string;
  costTotalCents: Cents; revenueTotalCents: Cents; profitCents: Cents; profitRate: number | null;
}

export interface PriceTrendPoint {
  capturedAt: string; priceCents: Cents; supplierId: number | null; supplierName: string | null; source: string;
}

export interface PriceChangeRow {
  productId: number; name: string; firstCents: Cents; lastCents: Cents;
  changeCents: Cents; changeRate: number | null; recordCount: number;
}

export interface AnalyticsSummary {
  projectCount: number; itemCount: number; costTotalCents: Cents; revenueTotalCents: Cents;
  profitCents: Cents; profitRate: number | null;
}

/** 共用行集：清单行 JOIN 空间/板块/项目，行定价交由 pricing.lineTotals 计算（禁止重写公式）。 */
interface AnalyticsRow {
  item: LineItem;
  project: Project;
  productExists: boolean;
  productName: string | null;
  productCategory: string | null;
  totals: LineTotals;
}

function buildRows(db: Db, filter: AnalyticsFilter): AnalyticsRow[] {
  let sql = `SELECT li.*,
      p.id AS p_id, p.name AS p_name, p.client AS p_client, p.project_type AS p_project_type,
      p.mode AS p_mode, p.default_margin AS p_default_margin, p.round_rule AS p_round_rule,
      p.status AS p_status, p.created_at AS p_created_at, p.updated_at AS p_updated_at,
      pr.id AS prod_id, pr.name AS prod_name, pr.category AS prod_category
    FROM line_items li
    JOIN spaces sp ON sp.id = li.space_id
    JOIN sections sec ON sec.id = sp.section_id
    JOIN projects p ON p.id = sec.project_id
    LEFT JOIN products pr ON pr.id = li.product_id
    WHERE 1=1`;
  const args: unknown[] = [];
  if (filter.onlyDone) sql += " AND p.status='done'";
  if (filter.from) { sql += ' AND li.created_at >= ?'; args.push(filter.from); }
  if (filter.to) { sql += ' AND li.created_at <= ?'; args.push(filter.to); }

  const raws = db.prepare(sql).all(...args) as any[];
  return raws.map((r) => {
    const item: LineItem = {
      id: r.id, spaceId: r.space_id, productId: r.product_id,
      snapshot: JSON.parse(r.snapshot), qty: r.qty, marginOverride: r.margin_override,
      manualUnitPriceCents: r.manual_unit_price_cents, remark: r.remark, imagePath: r.image_path,
      sortOrder: r.sort_order, createdAt: r.created_at, updatedAt: r.updated_at,
    };
    const project: Project = {
      id: r.p_id, name: r.p_name, client: r.p_client, projectType: r.p_project_type,
      mode: r.p_mode, defaultMargin: r.p_default_margin, roundRule: r.p_round_rule,
      status: r.p_status, createdAt: r.p_created_at, updatedAt: r.p_updated_at,
    };
    return {
      item, project,
      productExists: r.prod_id != null,
      productName: r.prod_name ?? null,
      productCategory: r.prod_category ?? null,
      totals: lineTotals(item, project),
    };
  });
}

function profitRateOf(revenueTotalCents: Cents, profitCents: Cents): number | null {
  return revenueTotalCents === 0 ? null : profitCents / revenueTotalCents;
}

export function listProductProfit(db: Db, filter: AnalyticsFilter): ProductProfitRow[] {
  const rows = buildRows(db, filter).filter((r) => r.item.productId != null);
  const map = new Map<number, ProductProfitRow>();
  for (const r of rows) {
    const pid = r.item.productId as number;
    let row = map.get(pid);
    if (!row) {
      const name = r.productExists ? (r.productName as string) : r.item.snapshot.name;
      const category = r.productExists ? (r.productCategory as string) : '已删除';
      row = { productId: pid, name, category, usageCount: 0, totalQty: 0,
        costTotalCents: 0, revenueTotalCents: 0, profitCents: 0, profitRate: null };
      map.set(pid, row);
    }
    row.usageCount += 1;
    row.totalQty += r.item.qty;
    row.costTotalCents += r.totals.costTotalCents;
    row.revenueTotalCents += r.totals.totalCents;
  }
  const result = Array.from(map.values());
  for (const row of result) {
    row.profitCents = row.revenueTotalCents - row.costTotalCents;
    row.profitRate = profitRateOf(row.revenueTotalCents, row.profitCents);
  }
  return result;
}

export function listProjectProfit(db: Db, filter: AnalyticsFilter): ProjectProfitRow[] {
  const rows = buildRows(db, filter);
  const map = new Map<number, ProjectProfitRow>();
  for (const r of rows) {
    let row = map.get(r.project.id);
    if (!row) {
      row = { projectId: r.project.id, name: r.project.name, status: r.project.status,
        createdAt: r.project.createdAt, costTotalCents: 0, revenueTotalCents: 0,
        profitCents: 0, profitRate: null };
      map.set(r.project.id, row);
    }
    row.costTotalCents += r.totals.costTotalCents;
    row.revenueTotalCents += r.totals.totalCents;
  }
  const result = Array.from(map.values());
  for (const row of result) {
    row.profitCents = row.revenueTotalCents - row.costTotalCents;
    row.profitRate = profitRateOf(row.revenueTotalCents, row.profitCents);
  }
  return result;
}

export function getAnalyticsSummary(db: Db, filter: AnalyticsFilter): AnalyticsSummary {
  const rows = buildRows(db, filter);
  const projectIds = new Set(rows.map((r) => r.project.id));
  let costTotalCents = 0;
  let revenueTotalCents = 0;
  for (const r of rows) {
    costTotalCents += r.totals.costTotalCents;
    revenueTotalCents += r.totals.totalCents;
  }
  const profitCents = revenueTotalCents - costTotalCents;
  return {
    projectCount: projectIds.size,
    itemCount: rows.length,
    costTotalCents, revenueTotalCents, profitCents,
    profitRate: profitRateOf(revenueTotalCents, profitCents),
  };
}

export function listPriceTrend(db: Db, productId: number, filter: AnalyticsFilter): PriceTrendPoint[] {
  let sql = `SELECT pr.*, s.name AS supplier_name
    FROM price_records pr
    LEFT JOIN suppliers s ON s.id = pr.supplier_id
    WHERE pr.product_id = ?`;
  const args: unknown[] = [productId];
  if (filter.from) { sql += ' AND pr.captured_at >= ?'; args.push(filter.from); }
  if (filter.to) { sql += ' AND pr.captured_at <= ?'; args.push(filter.to); }
  sql += ' ORDER BY pr.captured_at, pr.id';
  const raws = db.prepare(sql).all(...args) as any[];
  return raws.map((r) => ({
    capturedAt: r.captured_at, priceCents: r.price_cents,
    supplierId: r.supplier_id, supplierName: r.supplier_name ?? null, source: r.source,
  }));
}

function computeAllPriceChanges(db: Db, filter: AnalyticsFilter): PriceChangeRow[] {
  let sql = `SELECT pr.*, p.name AS prod_name
    FROM price_records pr
    JOIN products p ON p.id = pr.product_id
    WHERE 1=1`;
  const args: unknown[] = [];
  if (filter.from) { sql += ' AND pr.captured_at >= ?'; args.push(filter.from); }
  if (filter.to) { sql += ' AND pr.captured_at <= ?'; args.push(filter.to); }
  sql += ' ORDER BY pr.product_id, pr.captured_at, pr.id';
  const raws = db.prepare(sql).all(...args) as any[];

  const grouped = new Map<number, { name: string; records: any[] }>();
  for (const r of raws) {
    let g = grouped.get(r.product_id);
    if (!g) { g = { name: r.prod_name, records: [] }; grouped.set(r.product_id, g); }
    g.records.push(r);
  }

  const result: PriceChangeRow[] = [];
  for (const [productId, g] of grouped) {
    if (g.records.length < 2) continue;
    const first = g.records[0];
    const last = g.records[g.records.length - 1];
    const changeCents = last.price_cents - first.price_cents;
    const changeRate = first.price_cents === 0 ? null : changeCents / first.price_cents;
    result.push({
      productId, name: g.name,
      firstCents: first.price_cents, lastCents: last.price_cents,
      changeCents, changeRate, recordCount: g.records.length,
    });
  }
  return result;
}

/** changeRate 非空按其降序排列（涨在前跌在后）；changeRate 为空（首价为 0，零基线）的行不参与涨跌排序，由调用方排除在涨跌榜之外。 */
function sortPriceChanges(rows: PriceChangeRow[]): PriceChangeRow[] {
  return rows.filter((r) => r.changeRate != null)
    .sort((a, b) => (b.changeRate as number) - (a.changeRate as number));
}

/**
 * 涨跌榜：零基线行（changeRate=null，即首价为 0）不入榜，避免其挤占/污染跌幅端。
 * 涨幅榜 = changeRate>0 按降序取前 limit；跌幅榜 = changeRate<0 按升序取前 limit；合并返回（涨在前跌在后）。
 */
export function listPriceChanges(db: Db, filter: AnalyticsFilter, limit = 20): PriceChangeRow[] {
  const all = computeAllPriceChanges(db, filter);
  const sorted = sortPriceChanges(all); // changeRate 非 null，降序：正值(涨)在前，负值(跌)在后
  const gainers = sorted.filter((r) => (r.changeRate as number) > 0).slice(0, limit);
  const losers = sorted.filter((r) => (r.changeRate as number) < 0).slice(-limit).reverse();
  return [...gainers, ...losers];
}
