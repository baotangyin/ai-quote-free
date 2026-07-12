import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, type Db } from '../../../src/core/db/db';
import { createProduct } from '../../../src/core/repo/products';
import { listPriceRecords } from '../../../src/core/repo/prices';
import { listProducts } from '../../../src/core/repo/products';
import { createSupplier } from '../../../src/core/repo/suppliers';
import { createCategoryTemplate } from '../../../src/core/repo/categoryTemplates';
import { commitRows, type CommitRow } from '../../../src/core/import/commit';
import type { RecognizedRow } from '../../../src/core/import/recognize';

function row(overrides: Partial<CommitRow>): CommitRow {
  return {
    categories: ['显示设备'],
    name: '46寸拼接屏',
    brand: '海康',
    model: 'X100',
    params: '46寸',
    unit: '台',
    dims: '1000x600',
    priceCents: 100000,
    options: [{ name: '防爆屏', addPriceCents: 40000 }],
    remark: null,
    confidence: 0.9,
    power220W: null,
    power380W: null,
    rackU: null,
    seqPowerPorts: null,
    netPorts: null,
    comPorts: null,
    action: 'create',
    ...overrides,
  };
}

describe('commitRows', () => {
  let db: Db;

  beforeEach(() => {
    db = openDb(':memory:');
  });

  it('action=create 建产品并落价格记录，来源为 supplier（有 supplierId）', () => {
    const supplier = createSupplier(db, { name: '供应商A' });
    const result = commitRows(db, supplier.id, [row({})]);
    expect(result).toEqual({ created: 1, priced: 1 });

    const products = listProducts(db);
    expect(products).toHaveLength(1);
    expect(products[0].category).toBe('显示设备');
    expect(products[0].name).toBe('46寸拼接屏');
    expect(products[0].brand).toBe('海康');
    expect(products[0].model).toBe('X100');
    expect(products[0].paramsCore).toBe('46寸');
    expect(products[0].dims).toBe('1000x600');
    expect(products[0].options).toEqual([{ name: '防爆屏', addPriceCents: 40000 }]);

    const prices = listPriceRecords(db, products[0].id);
    expect(prices).toHaveLength(1);
    expect(prices[0].priceCents).toBe(100000);
    expect(prices[0].source).toBe('supplier');
    expect(prices[0].supplierId).toBe(supplier.id);
  });

  it('supplierId 为 null 时来源为 manual', () => {
    commitRows(db, null, [row({})]);
    const products = listProducts(db);
    const prices = listPriceRecords(db, products[0].id);
    expect(prices[0].source).toBe('manual');
    expect(prices[0].supplierId).toBeNull();
  });

  it('action=updatePrice 仅落价格记录，不建新档', () => {
    const supplier = createSupplier(db, { name: '供应商B' });
    const existing = createProduct(db, { category: '显示设备', name: '已存在产品', unit: '台' });

    const result = commitRows(db, supplier.id, [
      row({ action: 'updatePrice', productId: existing.id, priceCents: 88888 }),
    ]);

    expect(result).toEqual({ created: 0, priced: 1 });
    expect(listProducts(db)).toHaveLength(1); // 未新建产品

    const prices = listPriceRecords(db, existing.id);
    expect(prices).toHaveLength(1);
    expect(prices[0].priceCents).toBe(88888);
  });

  it('updatePrice 缺少 productId 时抛错', () => {
    expect(() => commitRows(db, 1, [row({ action: 'updatePrice', productId: undefined })])).toThrow();
  });

  it('action=create 且 recommendedBrands 为空时自动用 suggestBrands 按品牌+分类补齐', () => {
    createProduct(db, { categories: ['显示设备'], name: '已有产品', brand: '海康', unit: '台' });
    const result = commitRows(db, null, [row({ brand: null, recommendedBrands: undefined })]);
    expect(result.created).toBe(1);
    const created = listProducts(db).find((p) => p.name === '46寸拼接屏')!;
    expect(created.recommendedBrands).toEqual(['海康']);
  });

  it('action=create 且 recommendedBrands 非空时保留原值，不自动填充', () => {
    createProduct(db, { categories: ['显示设备'], name: '已有产品', brand: '海康', unit: '台' });
    const result = commitRows(db, null, [row({ recommendedBrands: ['指定品牌'] })]);
    expect(result.created).toBe(1);
    const created = listProducts(db).find((p) => p.name === '46寸拼接屏')!;
    expect(created.recommendedBrands).toEqual(['指定品牌']);
  });

  it('action=create 行的选配项 paramsText 透传入库', () => {
    const result = commitRows(db, null, [
      row({ options: [{ name: '防爆屏', addPriceCents: 40000, paramsText: 'IK10' }] }),
    ]);
    expect(result.created).toBe(1);
    const created = listProducts(db).find((p) => p.name === '46寸拼接屏')!;
    expect(created.options).toEqual([{ name: '防爆屏', addPriceCents: 40000, paramsText: 'IK10' }]);
  });

  it('action=create 且技术字段为空/0 时，按 categories 命中的类别模板填充默认值', () => {
    createCategoryTemplate(db, {
      category: '显示设备',
      defaults: { unit: '㎡', power220W: 200, rackU: 4, seqPowerPorts: 2, netPorts: 8, comPorts: 1, paramsCore: '默认参数' },
    });
    const result = commitRows(db, null, [
      row({ unit: '台', power220W: null, power380W: null, rackU: null, seqPowerPorts: null, netPorts: null, comPorts: null, params: null }),
    ]);
    expect(result.created).toBe(1);
    const created = listProducts(db).find((p) => p.name === '46寸拼接屏')!;
    // unit 不是空值（'台'非空字符串），不被模板覆盖；其余空/零值字段被模板填充
    expect(created.unit).toBe('台');
    expect(created.power220W).toBe(200);
    expect(created.rackU).toBe(4);
    expect(created.seqPowerPorts).toBe(2);
    expect(created.netPorts).toBe(8);
    expect(created.comPorts).toBe(1);
    expect(created.paramsCore).toBe('默认参数');
  });

  it('action=create 且技术字段已有值时，不被类别模板覆盖', () => {
    createCategoryTemplate(db, { category: '显示设备', defaults: { power220W: 200, paramsCore: '默认参数' } });
    const result = commitRows(db, null, [row({ power220W: 50, params: '实际参数' })]);
    expect(result.created).toBe(1);
    const created = listProducts(db).find((p) => p.name === '46寸拼接屏')!;
    expect(created.power220W).toBe(50);
    expect(created.paramsCore).toBe('实际参数');
  });

  it('action=create 时类别模板的 paramsBid/paramsTender 默认值透传入库', () => {
    createCategoryTemplate(db, {
      category: '显示设备',
      defaults: { paramsBid: '招标参数值', paramsTender: '投标参数值' },
    });
    const result = commitRows(db, null, [row({})]);
    expect(result.created).toBe(1);
    const created = listProducts(db).find((p) => p.name === '46寸拼接屏')!;
    expect(created.paramsBid).toBe('招标参数值');
    expect(created.paramsTender).toBe('投标参数值');
  });

  it('多行混合 create 与 updatePrice，计数正确累加', () => {
    const supplier = createSupplier(db, { name: '供应商C' });
    const existing = createProduct(db, { category: '显示设备', name: '老产品', unit: '台' });
    const rows: CommitRow[] = [
      row({ name: '新产品1' }),
      row({ name: '新产品2', brand: null, model: null }),
      row({ action: 'updatePrice', productId: existing.id }),
    ];
    const result = commitRows(db, supplier.id, rows);
    expect(result).toEqual({ created: 2, priced: 3 });
    expect(listProducts(db)).toHaveLength(3);
  });
});

// 类型引用，确保 RecognizedRow 与 CommitRow 组合形态符合 brief 约定
const _typeCheck: CommitRow = row({}) satisfies RecognizedRow & { action: 'create' | 'updatePrice'; productId?: number };
void _typeCheck;
