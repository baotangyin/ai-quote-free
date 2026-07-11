import ExcelJS from 'exceljs';
import type { Worksheet } from 'exceljs';
import { join, resolve } from 'node:path';
import type { Db } from '../index';
import type { CostRule } from '../domain/types';
import { getProduct } from '../repo/products';
import { getSupplier } from '../repo/suppliers';
import { getEffectiveCost } from '../repo/prices';

const THIN = { style: 'thin' as const };
const BORDER = { top: THIN, left: THIN, bottom: THIN, right: THIN };
const MONEY_FMT = '#,##0.00';
const HEADER_FILL = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFD9D9D9' } };

function writeHeaderRow(ws: Worksheet, rowIdx: number, headers: string[]): void {
  headers.forEach((h, i) => {
    const cell = ws.getCell(rowIdx, i + 1);
    cell.value = h;
    cell.font = { bold: true };
    cell.fill = HEADER_FILL;
    cell.border = BORDER;
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  });
}

function border(ws: Worksheet, rowIdx: number, colCount: number): void {
  for (let c = 1; c <= colCount; c++) {
    ws.getCell(rowIdx, c).border = BORDER;
  }
}

/**
 * 导出选中产品到「产品库」xlsx。逐个 getProduct，跳过不存在的 id。分类列优先用 categories.join('、')，
 * 无则用旧 category 字段。成本参考经 getEffectiveCost(costRule??'lowest') 取得（分/100），为 null 留空。
 */
export async function exportProductsToFile(
  db: Db, productIds: number[], outDir: string, costRule?: CostRule,
): Promise<string> {
  const rule: CostRule = costRule ?? 'lowest';
  const headers = ['分类', '名称', '品牌', '型号', '单位', '规格尺寸', '核心参数', '220V用电量', '380V用电量', '成本参考(元)'];
  const widths = [18, 22, 12, 16, 8, 18, 30, 12, 12, 14];

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('产品库');
  widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });

  ws.mergeCells(1, 1, 1, headers.length);
  const title = ws.getCell(1, 1);
  title.value = '产品库导出';
  title.font = { size: 14, bold: true };
  title.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(1).height = 24;

  const headerRow = 2;
  writeHeaderRow(ws, headerRow, headers);

  let row = headerRow + 1;
  for (const id of productIds) {
    const p = getProduct(db, id);
    if (!p) continue;
    const category = p.categories.length > 0 ? p.categories.join('、') : p.category;
    ws.getCell(row, 1).value = category;
    ws.getCell(row, 2).value = p.name;
    ws.getCell(row, 3).value = p.brand ?? '';
    ws.getCell(row, 4).value = p.model ?? '';
    ws.getCell(row, 5).value = p.unit;
    ws.getCell(row, 6).value = p.dims ?? '';
    ws.getCell(row, 7).value = p.paramsCore ?? '';
    ws.getCell(row, 8).value = p.power220W;
    ws.getCell(row, 9).value = p.power380W;
    const cost = getEffectiveCost(db, id, rule);
    if (cost != null) {
      const cell = ws.getCell(row, 10);
      cell.value = cost / 100;
      cell.numFmt = MONEY_FMT;
    }
    border(ws, row, headers.length);
    row++;
  }

  const file = resolve(join(outDir, '产品库-选中导出.xlsx'));
  await wb.xlsx.writeFile(file);
  return file;
}

/** 导出选中供应商到「供应商」xlsx。逐个 getSupplier，跳过不存在的 id。 */
export async function exportSuppliersToFile(
  db: Db, supplierIds: number[], outDir: string,
): Promise<string> {
  const headers = ['名称', '联系人', '电话', '地址', '付款方式', '开户信息', '备注'];
  const widths = [24, 18, 16, 20, 16, 24, 40];

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('供应商');
  widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });

  ws.mergeCells(1, 1, 1, headers.length);
  const title = ws.getCell(1, 1);
  title.value = '供应商导出';
  title.font = { size: 14, bold: true };
  title.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(1).height = 24;

  const headerRow = 2;
  writeHeaderRow(ws, headerRow, headers);

  let row = headerRow + 1;
  for (const id of supplierIds) {
    const s = getSupplier(db, id);
    if (!s) continue;
    ws.getCell(row, 1).value = s.name;
    ws.getCell(row, 2).value = s.contact ?? '';
    ws.getCell(row, 3).value = s.phone ?? '';
    ws.getCell(row, 4).value = s.address ?? '';
    ws.getCell(row, 5).value = s.paymentTerms ?? '';
    ws.getCell(row, 6).value = s.bankInfo ?? '';
    ws.getCell(row, 7).value = s.note ?? '';
    border(ws, row, headers.length);
    row++;
  }

  const file = resolve(join(outDir, '供应商-选中导出.xlsx'));
  await wb.xlsx.writeFile(file);
  return file;
}
