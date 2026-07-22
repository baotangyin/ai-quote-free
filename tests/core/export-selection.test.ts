import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { openDb, type Db } from '../../src/core/db/db';
import { createProduct } from '../../src/core/repo/products';
import { addPriceRecord } from '../../src/core/repo/prices';
import { createSupplier } from '../../src/core/repo/suppliers';
import { exportProductsToFile, exportSuppliersToFile } from '../../src/core/export/exportSelection';

let db: Db; let outDir: string;
beforeEach(() => { db = openDb(':memory:'); outDir = mkdtempSync(join(tmpdir(), 'ai-quote-sel-')); });
afterEach(() => { rmSync(outDir, { recursive: true, force: true }); });

describe('exportProductsToFile', () => {
  it('exports selected products with header and cost reference', async () => {
    const p1 = createProduct(db, { categories: ['触摸屏', '大屏'], name: '一体机', unit: '台', brand: '牌A', model: 'M1',
      paramsCore: '55寸', dims: '1200x700', power220W: 300 });
    createProduct(db, { category: '音响', name: '音箱', unit: '只', brand: '牌B', model: 'M2' }); // p2, not selected
    const p3 = createProduct(db, { category: '灯光', name: '射灯', unit: '个', brand: '牌C', model: 'M3' });
    addPriceRecord(db, { productId: p1.id, source: 'manual', priceCents: 128800 });

    const file = await exportProductsToFile(db, [p1.id, p3.id], outDir);
    expect(file).toContain('产品库-选中导出.xlsx');

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(file);
    const ws = wb.getWorksheet('产品库');
    expect(ws).toBeTruthy();

    // find header row (contains 名称)
    let headerRow = 0;
    ws!.eachRow((row, rn) => {
      if (row.getCell(2).value === '名称' && !headerRow) headerRow = rn;
    });
    expect(headerRow).toBeGreaterThan(0);
    const headers = (ws!.getRow(headerRow).values as any[]).filter(v => v != null);
    expect(headers).toContain('分类');
    expect(headers).toContain('名称');
    expect(headers).toContain('品牌');
    expect(headers).toContain('成本参考(元)');

    // data rows
    const names: string[] = [];
    let costRefColByName: Record<string, any> = {};
    ws!.eachRow((row, rn) => {
      if (rn <= headerRow) return;
      const name = row.getCell(2).value;
      if (name) { names.push(String(name)); costRefColByName[String(name)] = row.getCell(10).value; }
    });
    expect(names).toHaveLength(2);
    expect(names).toContain('一体机');
    expect(names).toContain('射灯');
    expect(names).not.toContain('音箱');
    // p1 has a price -> cost ref numeric = 1288.00
    expect(costRefColByName['一体机']).toBeCloseTo(1288, 5);
    // p3 has no price -> blank
    expect(costRefColByName['射灯'] == null || costRefColByName['射灯'] === '').toBe(true);
  });
});

describe('exportSuppliersToFile', () => {
  it('exports selected suppliers with header and new fields', async () => {
    const s1 = createSupplier(db, { name: '供应商A', contact: '张三', phone: '13800138000', address: '北京市', paymentTerms: '30天', bankInfo: '工商银行', note: '备注A' });
    createSupplier(db, { name: '供应商B' }); // not selected
    const s3 = createSupplier(db, { name: '供应商C', contact: '李四', phone: '13900139000', address: '上海市' });

    const file = await exportSuppliersToFile(db, [s1.id, s3.id], outDir);
    expect(file).toContain('供应商-选中导出.xlsx');

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(file);
    const ws = wb.getWorksheet('供应商');
    expect(ws).toBeTruthy();

    let headerRow = 0;
    ws!.eachRow((row, rn) => {
      if (row.getCell(1).value === '名称' && !headerRow) headerRow = rn;
    });
    expect(headerRow).toBeGreaterThan(0);
    const headers = (ws!.getRow(headerRow).values as any[]).filter(v => v != null);
    expect(headers).toEqual(['名称', '联系人', '电话', '地址', '付款方式', '开户信息', '备注']);

    const names: string[] = [];
    ws!.eachRow((row, rn) => {
      if (rn <= headerRow) return;
      const name = row.getCell(1).value;
      if (name) names.push(String(name));
    });
    expect(names).toHaveLength(2);
    expect(names).toContain('供应商A');
    expect(names).toContain('供应商C');
    expect(names).not.toContain('供应商B');

    // Verify data fields
    let dataRow = 0;
    ws!.eachRow((row, rn) => {
      if (rn > headerRow && row.getCell(1).value === '供应商A') dataRow = rn;
    });
    expect(dataRow).toBeGreaterThan(0);
    expect(ws!.getCell(dataRow, 2).value).toBe('张三'); // contact
    expect(ws!.getCell(dataRow, 3).value).toBe('13800138000'); // phone
    expect(ws!.getCell(dataRow, 4).value).toBe('北京市'); // address
    expect(ws!.getCell(dataRow, 5).value).toBe('30天'); // paymentTerms
    expect(ws!.getCell(dataRow, 6).value).toBe('工商银行'); // bankInfo
    expect(ws!.getCell(dataRow, 7).value).toBe('备注A'); // note
  });
});
