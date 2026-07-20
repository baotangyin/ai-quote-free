import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { openDb, type Db } from '../../src/core/db/db';
import { createSupplier } from '../../src/core/repo/suppliers';
import { createProject } from '../../src/core/repo/projects';
import { createProduct } from '../../src/core/repo/products';
import { createInquiry } from '../../src/core/repo/inquiries';
import { exportInquiryToFile } from '../../src/core/export/exportInquiry';

let db: Db; let outDir: string;
beforeEach(() => { db = openDb(':memory:'); outDir = mkdtempSync(join(tmpdir(), 'ai-quote-inquiry-')); });
afterEach(() => { rmSync(outDir, { recursive: true, force: true }); });

describe('exportInquiryToFile', () => {
  it('导出询价单 xlsx：标题/供应商项目日期行/表头/数据行，不含我方价格，最后两列留空', async () => {
    const supplierId = createSupplier(db, { name: '供应商甲' }).id;
    const projectId = createProject(db, { name: '翔威新能源' }).id;
    const productId = createProduct(db, { category: '触摸屏', name: '一体机', unit: '台' }).id;

    const inq = createInquiry(db, {
      supplierId, projectId, title: '翔威新能源-询价单',
      items: [
        { productId, name: 'P1.8全彩屏', params: '像素间距1.8mm', unit: '㎡', qty: 73.73, remark: '含安装' },
        { name: '手工行', unit: '套', qty: 1 },
      ],
    });

    const file = await exportInquiryToFile(db, inq.id, outDir);
    expect(file).toContain('翔威新能源-询价单');
    expect(file.endsWith('.xlsx')).toBe(true);

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(file);
    const ws = wb.getWorksheet('询价单')!;
    expect(ws).toBeTruthy();

    expect(ws.getCell('A1').value).toBe('询 价 单');
    expect(ws.getCell('A2').value).toBe('供应商：供应商甲');
    expect(ws.getCell('A3').value).toBe('项目：翔威新能源');
    expect(String(ws.getCell('A4').value)).toMatch(/^日期：\d{4}-\d{2}-\d{2}$/);

    const headers = ['序号', '产品名称', '参数', '单位', '数量', '备注', '单价（请填写）', '备注（供应商）'];
    headers.forEach((h, i) => {
      expect(ws.getCell(5, i + 1).value).toBe(h);
    });

    // 数据行1
    expect(ws.getCell('A6').value).toBe(1);
    expect(ws.getCell('B6').value).toBe('P1.8全彩屏');
    expect(ws.getCell('C6').value).toBe('像素间距1.8mm');
    expect(ws.getCell('D6').value).toBe('㎡');
    expect(ws.getCell('E6').value).toBe(73.73);
    expect(ws.getCell('F6').value).toBe('含安装');
    expect(ws.getCell('G6').value == null).toBe(true);
    expect(ws.getCell('H6').value == null).toBe(true);

    // 数据行2：手工行
    expect(ws.getCell('A7').value).toBe(2);
    expect(ws.getCell('B7').value).toBe('手工行');
    expect(ws.getCell('C7').value).toBe('');
    expect(ws.getCell('F7').value).toBe('');
    expect(ws.getCell('G7').value == null).toBe(true);
  });

  it('询价单不存在时抛中文错', async () => {
    await expect(exportInquiryToFile(db, 9999, outDir)).rejects.toThrow('询价单 9999 不存在');
  });
});
