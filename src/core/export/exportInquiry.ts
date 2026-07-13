import ExcelJS from 'exceljs';
import type { Worksheet } from 'exceljs';
import { join, resolve } from 'node:path';
import type { Db } from '../db/db';
import { getInquiry } from '../repo/inquiries';

const THIN = { style: 'thin' as const };
const BORDER = { top: THIN, left: THIN, bottom: THIN, right: THIN };
const HEADER_FILL = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFD9D9D9' } };

function todayYmd(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function border(ws: Worksheet, rowIdx: number, colCount: number): void {
  for (let c = 1; c <= colCount; c++) ws.getCell(rowIdx, c).border = BORDER;
}

/**
 * 导出询价单为 xlsx：标题「询 价 单」、供应商/项目/日期行、表头 序号/产品名称/参数/单位/数量/备注/
 * 单价（请填写）/备注（供应商）——不含我方价格，最后两列留空供供应商填写后回传。
 */
export async function exportInquiryToFile(db: Db, inquiryId: number, outDir: string): Promise<string> {
  const inquiry = getInquiry(db, inquiryId);
  if (!inquiry) throw new Error(`询价单 ${inquiryId} 不存在`);

  const headers = ['序号', '产品名称', '参数', '单位', '数量', '备注', '单价（请填写）', '备注（供应商）'];
  const widths = [8, 24, 30, 8, 10, 20, 16, 20];
  const n = headers.length;

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('询价单');
  widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });

  ws.mergeCells(1, 1, 1, n);
  const title = ws.getCell(1, 1);
  title.value = '询 价 单';
  title.font = { size: 16, bold: true };
  title.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(1).height = 28;

  ws.mergeCells(2, 1, 2, n);
  ws.getCell(2, 1).value = `供应商：${inquiry.supplierName}`;

  ws.mergeCells(3, 1, 3, n);
  ws.getCell(3, 1).value = `项目：${inquiry.projectName}`;

  ws.mergeCells(4, 1, 4, n);
  ws.getCell(4, 1).value = `日期：${todayYmd()}`;

  const headerRow = 5;
  headers.forEach((h, i) => {
    const cell = ws.getCell(headerRow, i + 1);
    cell.value = h;
    cell.font = { bold: true };
    cell.fill = HEADER_FILL;
    cell.border = BORDER;
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  });

  let row = headerRow + 1;
  for (const it of inquiry.items) {
    ws.getCell(row, 1).value = row - headerRow;
    ws.getCell(row, 2).value = it.name;
    ws.getCell(row, 3).value = it.params ?? '';
    ws.getCell(row, 4).value = it.unit;
    ws.getCell(row, 5).value = it.qty;
    ws.getCell(row, 6).value = it.remark ?? '';
    // 第7/8列（单价/供应商备注）留空，供供应商回价填写
    border(ws, row, n);
    row++;
  }

  const file = resolve(join(outDir, `${inquiry.title}-询价单.xlsx`));
  await wb.xlsx.writeFile(file);
  return file;
}
