import type { Worksheet } from 'exceljs';
import type { LineItemCost } from '../domain/types';

const THIN = { style: 'thin' as const };
const BORDER = { top: THIN, left: THIN, bottom: THIN, right: THIN };
const MONEY_FMT = '#,##0.00';
const ACTIVE_FILL = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFFFF2CC' } };
const HEADER_FILL = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFD9D9D9' } };

/** 每个清单行连同其候选成本方案 */
export interface CostCompareItem {
  name: string; unit: string; qty: number; snapshotCostCents: number; costs: LineItemCost[];
}
export interface CostCompareSection { sectionName: string; items: CostCompareItem[] }

export function writeCostCompareSheet(ws: Worksheet, section: CostCompareSection, projectName: string): void {
  const maxCandidates = Math.max(1, ...section.items.map(i => i.costs.length));
  const lastCol = 4 + maxCandidates * 3 + 1; // 固定4 + 每方案3列 + 生效列

  // 列宽
  ws.getColumn(1).width = 6;   // 序号
  ws.getColumn(2).width = 28;  // 名称
  ws.getColumn(3).width = 6;   // 单位
  ws.getColumn(4).width = 8;   // 数量
  for (let k = 0; k < maxCandidates; k++) {
    const base = 5 + k * 3;
    ws.getColumn(base).width = 16;     // 供应商
    ws.getColumn(base + 1).width = 16; // 型号
    ws.getColumn(base + 2).width = 12; // 成本
  }
  ws.getColumn(lastCol).width = 14; // 生效方案

  // 行1 标题
  ws.mergeCells(1, 1, 1, lastCol);
  const title = ws.getCell(1, 1);
  title.value = `${projectName}\n成本对比表`;
  title.font = { size: 16, bold: true };
  title.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  ws.getRow(1).height = 44;

  // 行2 表头
  const headers: string[] = ['序号', '名称', '单位', '数量'];
  for (let k = 1; k <= maxCandidates; k++) {
    headers.push(`方案${k}供应商`, `方案${k}型号`, `方案${k}成本(元)`);
  }
  headers.push('生效方案');
  headers.forEach((h, i) => {
    const cell = ws.getCell(2, i + 1);
    cell.value = h;
    cell.font = { bold: true };
    cell.fill = HEADER_FILL;
    cell.border = BORDER;
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  });

  const setRowBorders = (r: number) => {
    for (let c = 1; c <= lastCol; c++) {
      const cell = ws.getCell(r, c);
      cell.border = BORDER;
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
    }
  };

  section.items.forEach((it, ii) => {
    const row = 3 + ii;
    ws.getCell(row, 1).value = ii + 1;
    ws.getCell(row, 2).value = it.name;
    ws.getCell(row, 3).value = it.unit;
    ws.getCell(row, 4).value = it.qty;

    if (it.costs.length === 0) {
      // 无候选：方案1 组填快照成本
      ws.getCell(row, 5).value = '（快照成本）';
      ws.getCell(row, 6).value = '';
      const costCell = ws.getCell(row, 7);
      costCell.value = it.snapshotCostCents / 100;
      costCell.numFmt = MONEY_FMT;
      ws.getCell(row, lastCol).value = '快照';
    } else {
      let activeK = 0; // 生效候选的 1 基序号
      let activeName: string | null = null;
      it.costs.forEach((cost, ci) => {
        const base = 5 + ci * 3;
        ws.getCell(row, base).value = cost.supplierName ?? '-';
        ws.getCell(row, base + 1).value = cost.model ?? '-';
        const costCell = ws.getCell(row, base + 2);
        costCell.value = cost.costUnitCents / 100;
        costCell.numFmt = MONEY_FMT;
        if (cost.isActive) {
          activeK = ci + 1;
          activeName = cost.supplierName;
          costCell.font = { bold: true };
          costCell.fill = ACTIVE_FILL;
        }
      });
      if (activeK > 0) {
        ws.getCell(row, lastCol).value = activeName ?? `方案${activeK}`;
      } else {
        ws.getCell(row, lastCol).value = `（快照成本 ${it.snapshotCostCents / 100}）`;
      }
    }
    setRowBorders(row);
  });
}
