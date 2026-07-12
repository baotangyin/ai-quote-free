import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { openDb, type Db } from '../../../src/core/db/db';
import { createProduct } from '../../../src/core/repo/products';
import { listProducts } from '../../../src/core/repo/products';
import { listPriceRecords } from '../../../src/core/repo/prices';
import { createSupplier } from '../../../src/core/repo/suppliers';
import { parseWorkbook, trimGrid, splitSideBySide } from '../../../src/core/import/parseGrid';
import { recognizeSheet, type RecognizedRow } from '../../../src/core/import/recognize';
import { matchProduct } from '../../../src/core/import/match';
import { commitRows, type CommitRow } from '../../../src/core/import/commit';
import type { AiConfig } from '../../../src/core/ai/client';

/** 动态生成一份供应商报价单 fixture（单 sheet，不含并排分栏）。 */
async function buildFixture(): Promise<string> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('拼接屏报价');

  const rows = [
    ['名称', '品牌', '型号', '单价'],
    ['46寸拼接屏', '海康', 'X100', '8000'],
    ['55寸拼接屏（选配防爆屏另加400元）', '海康', 'X200', '12000'],
    ['矩阵产品-46寸', '', '', '1.2万'],
    ['矩阵产品-55寸', '', '', '1.8万'],
  ];
  rows.forEach((r, ri) => {
    r.forEach((v, ci) => {
      ws.getCell(ri + 1, ci + 1).value = v;
    });
  });

  const dir = mkdtempSync(join(tmpdir(), 'import-e2e-'));
  const file = join(dir, 'supplier-quote.xlsx');
  await wb.xlsx.writeFile(file);
  return file;
}

/**
 * 固定的 stub AI 输出：2 个基础产品（第一个命中已有产品，第二个为新产品且带 1 条选配项拆分）
 * + 1 处矩阵定价展开为 2 行（同一逻辑产品的两个规格分别成行）。
 * 覆盖 brief 要求的「2 产品、1 选配项拆分、1 矩阵展开」。
 */
function buildStubJson(): string {
  return JSON.stringify([
    {
      category: '显示设备',
      name: '46寸拼接屏',
      brand: '海康',
      model: 'X100',
      params: null,
      unit: '台',
      dims: null,
      price_yuan: 8000,
      options: [],
      remark: null,
      confidence: 0.95,
    },
    {
      category: '显示设备',
      name: '55寸拼接屏',
      brand: '海康',
      model: 'X200',
      params: null,
      unit: '台',
      dims: null,
      price_yuan: 12000,
      options: [{ name: '防爆屏', add_price_yuan: 400 }],
      remark: null,
      confidence: 0.9,
    },
    {
      category: '显示设备',
      name: '矩阵产品',
      brand: null,
      model: null,
      params: null,
      unit: '台',
      dims: '46寸',
      price_yuan: '1.2万',
      options: [],
      remark: null,
      confidence: 0.8,
    },
    {
      category: '显示设备',
      name: '矩阵产品',
      brand: null,
      model: null,
      params: null,
      unit: '台',
      dims: '55寸',
      price_yuan: '1.8万',
      options: [],
      remark: null,
      confidence: 0.8,
    },
  ]);
}

describe('端到端导入链路（mock AI）', () => {
  it('parse → recognize(stub chatFn) → match → commit 全链路落库正确', async () => {
    const db: Db = openDb(':memory:');
    const supplier = createSupplier(db, { name: '供应商E2E' });

    // 预先建好一个产品，使识别出的第一条记录（brand+model 精确命中）走 updatePrice 分支
    const existing = createProduct(db, {
      category: '显示设备',
      name: '46寸拼接屏-旧档案名',
      brand: '海康',
      model: 'X100',
      unit: '台',
    });
    // 该产品已有一条历史价格记录，用于验证 updatePrice 不重复建档、只追加价格
    const { addPriceRecord } = await import('../../../src/core/repo/prices');
    addPriceRecord(db, { productId: existing.id, source: 'manual', priceCents: 750000 });

    // 1) parse：动态 exceljs fixture
    const file = await buildFixture();
    const sheets = parseWorkbook(file);
    expect(sheets.map((s) => s.name)).toEqual(['拼接屏报价']);

    const trimmed = trimGrid(sheets[0].grid);
    const blocks = splitSideBySide(trimmed);
    expect(blocks).toHaveLength(1); // 无并排分栏，单 block

    // 2) recognize：stub chatFn 返回固定 JSON（2 产品 + 1 选配项拆分 + 1 矩阵展开）
    const cfg: AiConfig = { protocol: 'openai', baseUrl: 'https://example.invalid', apiKey: 'k', model: 'm' };
    const chatFn = vi.fn().mockResolvedValue(buildStubJson());
    const { rows, dropped, failedChunks } = await recognizeSheet(cfg, sheets[0].name, blocks[0], { chatFn });

    expect(chatFn).toHaveBeenCalledTimes(1); // 小表不分块
    expect(dropped).toBe(0);
    expect(failedChunks).toBe(0);
    expect(rows).toHaveLength(4);

    // 万单位换算校验：1.2万元 = 1,200,000 分（1万元=1,000,000分）
    const matrix46 = rows.find((r) => r.dims === '46寸')!;
    const matrix55 = rows.find((r) => r.dims === '55寸')!;
    expect(matrix46.priceCents).toBe(1200000);
    expect(matrix55.priceCents).toBe(1800000);

    // 选配项拆分校验
    const withOption = rows.find((r) => r.name === '55寸拼接屏')!;
    expect(withOption.options).toEqual([{ name: '防爆屏', addPriceCents: 40000 }]);

    // 3) match：其中 1 条（brand=海康/model=X100）命中已有产品
    const commitRowsInput: CommitRow[] = rows.map((row: RecognizedRow) => {
      const result = matchProduct(db, row);
      return result.kind === 'existing'
        ? { ...row, action: 'updatePrice', productId: result.productId }
        : { ...row, action: 'create' };
    });

    const matchedExisting = commitRowsInput.filter((r) => r.action === 'updatePrice');
    expect(matchedExisting).toHaveLength(1);
    expect(matchedExisting[0].productId).toBe(existing.id);

    const matchedNew = commitRowsInput.filter((r) => r.action === 'create');
    expect(matchedNew).toHaveLength(3); // 55寸拼接屏 + 矩阵46寸 + 矩阵55寸

    // 4) commit：落库
    const result = commitRows(db, supplier.id, commitRowsInput);
    expect(result).toEqual({ created: 3, priced: 4 });

    const products = listProducts(db);
    // 预建 1 个 + 新建 3 个（55寸拼接屏、矩阵产品×2）
    expect(products).toHaveLength(4);

    // updatePrice 不重复建档：仍是旧档案名，未被覆盖为新名字
    const stillExisting = products.find((p) => p.id === existing.id)!;
    expect(stillExisting.name).toBe('46寸拼接屏-旧档案名');
    const existingPrices = listPriceRecords(db, existing.id);
    // 原有 1 条 + 本次导入追加 1 条 = 2 条，价格记录累加而非覆盖
    expect(existingPrices).toHaveLength(2);
    expect(existingPrices.map((p) => p.priceCents).sort((a, b) => a - b)).toEqual([750000, 800000]);
    expect(existingPrices.every((p) => p.source === 'manual' || p.source === 'supplier')).toBe(true);
    expect(existingPrices.find((p) => p.priceCents === 800000)!.source).toBe('supplier');
    expect(existingPrices.find((p) => p.priceCents === 800000)!.supplierId).toBe(supplier.id);

    // 新产品：55寸拼接屏，含选配项
    const newWithOption = products.find((p) => p.name === '55寸拼接屏')!;
    expect(newWithOption.brand).toBe('海康');
    expect(newWithOption.model).toBe('X200');
    expect(newWithOption.options).toEqual([{ name: '防爆屏', addPriceCents: 40000 }]);
    const newWithOptionPrices = listPriceRecords(db, newWithOption.id);
    expect(newWithOptionPrices).toHaveLength(1);
    expect(newWithOptionPrices[0].priceCents).toBe(1200000);
    expect(newWithOptionPrices[0].source).toBe('supplier');
    expect(newWithOptionPrices[0].supplierId).toBe(supplier.id);

    // 矩阵展开产品：2 条独立产品，dims 区分规格，价格各自正确（万单位换算）
    const matrixProducts = products.filter((p) => p.name === '矩阵产品');
    expect(matrixProducts).toHaveLength(2);
    const byDims46 = matrixProducts.find((p) => p.dims === '46寸')!;
    const byDims55 = matrixProducts.find((p) => p.dims === '55寸')!;
    expect(listPriceRecords(db, byDims46.id)[0].priceCents).toBe(1200000);
    expect(listPriceRecords(db, byDims55.id)[0].priceCents).toBe(1800000);
  });
});
