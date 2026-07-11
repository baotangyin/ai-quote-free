import type { Worksheet } from 'exceljs';
import type { ExportModel } from './model';
import type { DetailRefs } from './detailSheet';
import { applyPlaceholders } from './detailSheet';
import { cnOrdinal } from './model';
import type { ExportTemplateConfig } from '../domain/types';
import { FACTORY_CONFIG } from './factoryTemplate';

const THIN = { style: 'thin' as const };
const BORDER = { top: THIN, left: THIN, bottom: THIN, right: THIN };
type Align = 'left' | 'center' | 'right';
/** 列对齐：1序号居中 2项目名称居左 3预算金额居右 4备注居左 5成本居右 */
const COL_ALIGN: Record<number, Align> = { 1: 'center', 2: 'left', 3: 'right', 4: 'left', 5: 'right' };

export function writeSummarySheet(
  ws: Worksheet, m: ExportModel, sheetNames: string[], refs: DetailRefs[],
  totalColLetters: string[], withCost: boolean,
  config: ExportTemplateConfig = FACTORY_CONFIG,
): void {
  const MONEY_FMT = config.style.moneyFmt;
  const border = config.style.border !== false;
  const n = withCost ? 5 : 4;
  const widths = withCost ? [8, 30, 18, 20, 18] : [8, 30, 18, 20];
  widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });

  ws.mergeCells(1, 1, 1, n);
  const title = ws.getCell(1, 1);
  title.value = applyPlaceholders(config.header.summaryTitle, { 项目名: m.project.name });
  title.font = { size: config.style.titleFontSize, bold: true };
  title.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  ws.getRow(1).height = 44;

  const headers = withCost ? ['序号', '项目名称', '预算金额（元)', '备注', '成本'] : ['序号', '项目名称', '预算金额（元)', '备注'];
  headers.forEach((h, i) => {
    const cell = ws.getCell(2, i + 1);
    cell.value = h; cell.font = { bold: true };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: config.style.headerFillArgb } };
    if (border) cell.border = BORDER;
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
  });

  let row = 3;
  m.sections.forEach((sec, i) => {
    ws.getCell(`A${row}`).value = cnOrdinal(i + 1);
    ws.getCell(`B${row}`).value = sec.section.name;
    const budget = ws.getCell(`C${row}`);
    budget.value = { formula: `'${sheetNames[i]}'!${totalColLetters[i]}${refs[i].totalRow}` } as any;
    budget.numFmt = MONEY_FMT;
    ws.getCell(`D${row}`).value = '明细详见附表';
    if (withCost) {
      const cost = ws.getCell(`E${row}`);
      cost.value = sec.totals.costTotalCents / 100;
      cost.numFmt = MONEY_FMT;
    }
    for (let c = 1; c <= n; c++) {
      const cell = ws.getCell(row, c);
      if (border) cell.border = BORDER;
      cell.alignment = { vertical: 'middle', horizontal: COL_ALIGN[c] };
    }
    row++;
  });

  ws.getCell(`B${row}`).value = '合计';
  const total = ws.getCell(`C${row}`);
  total.value = { formula: `SUM(C3:C${row - 1})` } as any;
  total.numFmt = MONEY_FMT;
  if (withCost) {
    const cost = ws.getCell(`E${row}`);
    cost.value = { formula: `SUM(E3:E${row - 1})` } as any;
    cost.numFmt = MONEY_FMT;
  }
  ws.getRow(row).font = { bold: true };
  for (let c = 1; c <= n; c++) {
    const cell = ws.getCell(row, c);
    if (border) cell.border = BORDER;
    cell.alignment = { vertical: 'middle', horizontal: COL_ALIGN[c] };
  }
}
