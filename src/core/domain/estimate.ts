import type { Db } from '../db/db';
import type { EstimateRow, EstimateCategory, Cents } from './types';
import { getProject, listSections, listSpaces, listLineItems } from '../repo/projects';
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
