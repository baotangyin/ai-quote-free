import ExcelJS from 'exceljs';
import { join, resolve } from 'node:path';
import type { Db } from '../index';
import { getProject, listLineItemCosts } from '../index';
import { assembleExportModel } from './model';
import { writeCostCompareSheet, type CostCompareSection, type CostCompareItem } from './costCompareSheet';
import { uniqueSheetName } from './exportProject';

export async function exportCostCompareToFile(db: Db, projectId: number, outDir: string): Promise<string> {
  const project = getProject(db, projectId);
  if (!project) throw new Error(`project ${projectId} not found`);
  if (project.mode === 'estimate') throw new Error('概算模式无成本对比版');

  const m = assembleExportModel(db, projectId);
  const wb = new ExcelJS.Workbook();
  const usedNames = new Set<string>();
  for (const sec of m.sections) {
    const items: CostCompareItem[] = sec.spaces.flatMap(sp => sp.items).map(ex => ({
      name: ex.item.snapshot.name,
      unit: ex.item.snapshot.unit,
      qty: ex.item.qty,
      snapshotCostCents: ex.item.snapshot.costUnitCents,
      costs: listLineItemCosts(db, ex.item.id),
    }));
    const compareSection: CostCompareSection = { sectionName: sec.section.name, items };
    const name = uniqueSheetName(sec.section.name, usedNames);
    const ws = wb.addWorksheet(name);
    writeCostCompareSheet(ws, compareSection, m.project.name);
  }

  const file = resolve(join(outDir, `${m.project.name}-成本对比版.xlsx`));
  await wb.xlsx.writeFile(file);
  return file;
}
