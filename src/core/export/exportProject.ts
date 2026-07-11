import ExcelJS from 'exceljs';
import { join, resolve } from 'node:path';
import type { Db } from '../index';
import { getProject } from '../index';
import { modeConfig, resolveColumns, colLetter } from './columns';
import { assembleExportModel } from './model';
import { assembleEstimate } from '../domain/estimate';
import { writeDetailSheet, type DetailRefs } from './detailSheet';
import { writeSummarySheet } from './summarySheet';
import { writeEstimateSheet } from './estimateSheet';
import { FACTORY_CONFIG } from './factoryTemplate';
import { getExportTemplate } from '../repo/exportTemplates';

export function sanitizeSheetName(name: string): string {
  return name.replace(/[\[\]:*?/\\]/g, '_').slice(0, 31);
}

export function uniqueSheetName(name: string, used: Set<string>): string {
  const base = sanitizeSheetName(name);
  if (!used.has(base)) { used.add(base); return base; }
  for (let i = 2; ; i++) {
    const suffix = `(${i})`;
    const candidate = base.slice(0, 31 - suffix.length) + suffix;
    if (!used.has(candidate)) { used.add(candidate); return candidate; }
  }
}

export async function exportProjectToFiles(db: Db, projectId: number, outDir: string, templateId?: number): Promise<string[]> {
  const project = getProject(db, projectId);
  if (!project) throw new Error(`project ${projectId} not found`);
  if (project.mode === 'estimate') {
    const assembled = assembleEstimate(db, projectId);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('项目总投资估算表');
    writeEstimateSheet(ws, assembled, project.name);
    const file = resolve(join(outDir, `${project.name}-项目总投资估算表.xlsx`));
    await wb.xlsx.writeFile(file);
    return [file];
  }

  const config = templateId != null ? (getExportTemplate(db, templateId)?.config ?? FACTORY_CONFIG) : FACTORY_CONFIG;

  const m = assembleExportModel(db, projectId);
  const cfg = modeConfig(m.project.mode);
  const out: string[] = [];
  for (const version of config.versions) {
    const cols = resolveColumns(cfg.columns, version.columns);
    const wb = new ExcelJS.Workbook();
    const withCost = cols.some(c => c.key === 'costTotal');
    const summaryWs = version.includeSummarySheet ? wb.addWorksheet('汇总表') : null;
    const sheetNames: string[] = [];
    const refs: DetailRefs[] = [];
    const totalCols: string[] = [];
    const usedNames = new Set<string>();
    for (const sec of m.sections) {
      const name = uniqueSheetName(sec.section.name, usedNames);
      const ws = wb.addWorksheet(name);
      const r = writeDetailSheet(ws, sec, m.project.name, cols, cfg.paramsField, config, version);
      sheetNames.push(name); refs.push(r);
      totalCols.push(cols.some(c => c.key === 'total') ? colLetter(cols, 'total') : 'A');
    }
    if (summaryWs) writeSummarySheet(summaryWs, m, sheetNames, refs, totalCols, withCost, config);
    const versionLabel = sanitizeSheetName(version.name).replace(/[<>|"]/g, '_');
    const file = resolve(join(outDir, `${m.project.name}-${cfg.label}-${versionLabel}.xlsx`));
    await wb.xlsx.writeFile(file);
    out.push(file);
  }
  return out;
}
