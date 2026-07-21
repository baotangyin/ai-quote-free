import type { Db } from '../db/db';
import type { EstimateRow, EstimateCategory, Cents } from './types';
import { getProject, listSections, listSpaces, listLineItems, listProjects } from '../repo/projects';
import { listEstimateCategories, listEstimateRows } from '../repo/estimate';
import { sectionTotals } from './pricing';

/**
 * 计算单个概算行的金额（分）：
 * - manual：直接取手填金额（null → 0）
 * - coefficient：基数 × 系数，四舍五入到分（任一为 null 按 0 处理）
 * - sectionRef：引用板块合价，refSectionId 为 null → 0，否则调用 lookup
 */
export function estimateRowAmount(row: EstimateRow, sectionTotalCents: (sectionId: number) => Cents): Cents {
  switch (row.valueMethod) {
    case 'manual':
      return row.manualAmountCents ?? 0;
    case 'coefficient':
      return Math.round((row.coefBaseCents ?? 0) * (row.coefFactor ?? 0));
    case 'sectionRef':
      return row.refSectionId == null ? 0 : sectionTotalCents(row.refSectionId);
    default:
      return 0;
  }
}

export interface AssembledEstimateRow { row: EstimateRow; amountCents: Cents }
export interface AssembledEstimateCategory { category: EstimateCategory; rows: AssembledEstimateRow[]; subtotalCents: Cents }
export interface AssembledEstimate { projectId: number; categories: AssembledEstimateCategory[]; grandTotalCents: Cents }

/**
 * 组装某项目的完整概算：为每个大类计算子项金额与小计，并汇总项目总额。
 * sectionRef 行按清单板块合价（含集成费）求值，引用不存在的板块记为 0。
 */
export function assembleEstimate(db: Db, projectId: number): AssembledEstimate {
  const project = getProject(db, projectId);
  if (!project) throw new Error(`project ${projectId} not found`);

  // 预计算各板块合价查表
  const sectionTotalMap = new Map<number, Cents>();
  for (const section of listSections(db, projectId)) {
    const spaces = listSpaces(db, section.id).map(sp => ({ items: listLineItems(db, sp.id) }));
    sectionTotalMap.set(section.id, sectionTotals(spaces, section, project).totalCents);
  }
  const lookup = (id: number): Cents => sectionTotalMap.get(id) ?? 0;

  const categories: AssembledEstimateCategory[] = [];
  let grandTotalCents = 0;
  for (const category of listEstimateCategories(db, projectId)) {
    const rows: AssembledEstimateRow[] = [];
    let subtotalCents = 0;
    for (const row of listEstimateRows(db, category.id)) {
      const amountCents = estimateRowAmount(row, lookup);
      rows.push({ row, amountCents });
      subtotalCents += amountCents;
    }
    categories.push({ category, rows, subtotalCents });
    grandTotalCents += subtotalCents;
  }

  return { projectId, categories, grandTotalCents };
}

/** 聚合统计单条数据点。 */
export interface SpaceCostStats {
  /** 项目类型（取自 projects.project_type，可能为 null） */
  projectType: string | null;
  /** 空间名称 */
  spaceName: string;
  /** 单位面积造价（分/㎡）：所有清单行 (price × qty) 合计 / 空间面积 */
  unitPriceCentsPerSqm: number;
  /** 样本数（该聚合项中包含多少个独立空间） */
  sampleCount: number;
  /** 造价中位数（分/㎡） */
  medianCentsPerSqm: number;
  /** 下四分位（分/㎡） */
  p25CentsPerSqm: number;
  /** 上四分位（分/㎡） */
  p75CentsPerSqm: number;
}

/**
 * 聚合已完成项目（status='done'）的空间造价统计数据，用于 AI 生成概算指标参考。
 * 按 project_type × space_name 分组，每组返回均值/中位数/四分位数/样本数。
 * 面积 ≤ 0 的空间静默跳过；样本数 < 1 的组不输出。
 */
export function analyzeCompletedProjectCosts(db: Db): SpaceCostStats[] {
  // 收集所有已完成项目的空间造价原始数据
  const raw: { projectType: string | null; spaceName: string; centsPerSqm: number }[] = [];

  for (const project of listProjects(db)) {
    if (project.status !== 'done') continue;
    for (const section of listSections(db, project.id)) {
      for (const space of listSpaces(db, section.id)) {
        if (!space.area || space.area <= 0) continue;
        const items = listLineItems(db, space.id);
        const totalCents = items.reduce(
          (sum, it) => sum + Math.round((it.snapshot.costUnitCents ?? 0) * it.qty),
          0,
        );
        raw.push({
          projectType: project.projectType ?? null,
          spaceName: space.name,
          centsPerSqm: Math.round(totalCents / space.area),
        });
      }
    }
  }

  // 按 projectType × spaceName 分组
  const groups = new Map<string, { projectType: string | null; spaceName: string; values: number[] }>();
  for (const r of raw) {
    const key = `${r.projectType ?? ''}::${r.spaceName}`;
    let g = groups.get(key);
    if (!g) {
      g = { projectType: r.projectType, spaceName: r.spaceName, values: [] };
      groups.set(key, g);
    }
    g.values.push(r.centsPerSqm);
  }

  // 计算统计指标
  const result: SpaceCostStats[] = [];
  for (const g of groups.values()) {
    if (g.values.length < 1) continue;
    const sorted = g.values.slice().sort((a, b) => a - b);
    const sum = sorted.reduce((a, b) => a + b, 0);
    const mean = Math.round(sum / sorted.length);
    const median = sorted.length % 2 === 1
      ? sorted[Math.floor(sorted.length / 2)]
      : Math.round((sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2);
    const p25 = sorted[Math.floor(sorted.length * 0.25)];
    const p75 = sorted[Math.ceil(sorted.length * 0.75) - 1];
    result.push({
      projectType: g.projectType,
      spaceName: g.spaceName,
      unitPriceCentsPerSqm: mean,
      sampleCount: g.values.length,
      medianCentsPerSqm: median,
      p25CentsPerSqm: p25,
      p75CentsPerSqm: p75,
    });
  }

  return result.sort((a, b) => a.spaceName.localeCompare(b.spaceName));
}
