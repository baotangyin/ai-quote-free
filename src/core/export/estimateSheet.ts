import type { Worksheet } from 'exceljs';
import type { AssembledEstimate, AssembledEstimateRow } from '../domain/estimate';
import { cnOrdinal } from './model';

const THIN = { style: 'thin' as const };
const BORDER = { top: THIN, left: THIN, bottom: THIN, right: THIN };
const MONEY_FMT = '#,##0.00';
/** 概算惯用万元制：1 万元 = 1,000,000 分。单元格写入的数值为精确万元值，numFmt 仅控制显示保留两位。 */
const WAN = 1_000_000;

/** 子项备注：显式 remark 优先；否则按取值方式给提示。 */
function childRemark(r: AssembledEstimateRow): string {
  const { row } = r;
  if (row.remark) return row.remark;
  switch (row.valueMethod) {
    case 'coefficient':
      return row.coefFactor == null ? '' : `系数法 ${row.coefFactor}`;
    case 'sectionRef':
      return row.refSectionId == null ? '未选择板块' : '引用清单板块合价';
    default:
      return '';
  }
}

/**
 * 写「项目总投资估算表」单 sheet：
 * 标题两行合并 → 表头 → 每个大类（活公式小计）及其子项（静态金额）→ 末尾总投资行（各大类活公式相加）。
 * 金额一律写「万元」（分/1,000,000，概算惯用），numFmt='#,##0.00'。
 * 活公式（SUM 小计、大类相加总投资）与单位无关，故仍保留活公式。
 */
export function writeEstimateSheet(ws: Worksheet, assembled: AssembledEstimate, projectName: string): void {
  const widths = [8, 36, 18, 30];
  widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });

  ws.mergeCells(1, 1, 1, 4);
  const title = ws.getCell(1, 1);
  title.value = `${projectName}\n项目总投资估算表`;
  title.font = { size: 16, bold: true };
  title.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  ws.getRow(1).height = 44;

  const headers = ['序号', '费用名称', '估算金额（万元）', '备注'];
  headers.forEach((h, i) => {
    const cell = ws.getCell(2, i + 1);
    cell.value = h;
    cell.font = { bold: true };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9D9D9' } };
    cell.border = BORDER;
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
  });

  // 对齐：A 序号居中，B 费用名称居左，C 金额居右，D 备注居左
  const align: Record<number, 'left' | 'center' | 'right'> = { 1: 'center', 2: 'left', 3: 'right', 4: 'left' };
  const setBorders = (r: number) => {
    for (let c = 1; c <= 4; c++) {
      const cell = ws.getCell(r, c);
      cell.border = BORDER;
      cell.alignment = { vertical: 'middle', horizontal: align[c] };
    }
  };

  let row = 3;
  const catRows: number[] = [];
  assembled.categories.forEach((cat, i) => {
    const catRow = row;
    catRows.push(catRow);
    ws.getCell(`A${catRow}`).value = cnOrdinal(i + 1);
    ws.getCell(`B${catRow}`).value = cat.category.name;
    ws.getRow(catRow).font = { bold: true };
    setBorders(catRow);
    row++;

    const firstChild = row;
    cat.rows.forEach((ar, j) => {
      ws.getCell(`A${row}`).value = j + 1;
      ws.getCell(`B${row}`).value = ar.row.name;
      const c = ws.getCell(`C${row}`);
      c.value = ar.amountCents / WAN;
      c.numFmt = MONEY_FMT;
      ws.getCell(`D${row}`).value = childRemark(ar);
      setBorders(row);
      row++;
    });

    const cCell = ws.getCell(`C${catRow}`);
    if (cat.rows.length === 0) {
      cCell.value = 0;
    } else {
      cCell.value = { formula: `SUM(C${firstChild}:C${row - 1})` } as any;
    }
    cCell.numFmt = MONEY_FMT;
  });

  // 总投资
  const totalRow = row;
  ws.getCell(`B${totalRow}`).value = '总投资';
  const totalCell = ws.getCell(`C${totalRow}`);
  if (catRows.length === 0) {
    totalCell.value = 0;
  } else {
    totalCell.value = { formula: catRows.map(r => `C${r}`).join('+') } as any;
  }
  totalCell.numFmt = MONEY_FMT;
  ws.getRow(totalRow).font = { bold: true };
  setBorders(totalRow);
}
