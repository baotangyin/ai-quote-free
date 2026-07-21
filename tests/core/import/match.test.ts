import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, type Db } from '../../../src/core/db/db';
import { createProduct } from '../../../src/core/repo/products';
import { matchProduct } from '../../../src/core/import/match';
import type { RecognizedRow } from '../../../src/core/import/recognize';

function row(overrides: Partial<RecognizedRow>): RecognizedRow {
  return {
    categories: ['显示设备'],
    name: '46寸拼接屏',
    brand: null,
    model: null,
    params: null,
    unit: '台',
    dims: null,
    priceCents: 100000,
    options: [],
    remark: null,
    confidence: 0.9,
    power220W: null,
    power380W: null,
    rackU: null,
    seqPowerPorts: null,
    netPorts: null,
    comPorts: null,
    ...overrides,
  };
}

describe('matchProduct', () => {
  let db: Db;

  beforeEach(() => {
    db = openDb(':memory:');
    createProduct(db, { category: '显示设备', name: '46寸拼接屏-旧名', unit: '台', brand: '海康', model: 'X100' });
    createProduct(db, { category: '显示设备', name: '同名产品', unit: '台' });
  });

  it('brand+model 均非空且精确匹配时返回 existing', () => {
    const result = matchProduct(db, row({ brand: '海康', model: 'X100', name: '随便什么名字' }));
    expect(result.kind).toBe('existing');
    if (result.kind === 'existing') {
      expect(result.productId).toBeGreaterThan(0);
    }
  });

  it('brand/model 有一个为空时不走 brand+model 匹配，退化到 name 匹配', () => {
    const result = matchProduct(db, row({ brand: '海康', model: null, name: '同名产品' }));
    expect(result).toEqual({ kind: 'existing', productId: expect.any(Number) });
  });

  it('brand+model 不中，但 name 全等命中时返回 existing', () => {
    const result = matchProduct(db, row({ brand: '未知品牌', model: '未知型号', name: '同名产品' }));
    expect(result.kind).toBe('existing');
  });

  it('brand+model 与 name 均不中时返回 new', () => {
    const result = matchProduct(db, row({ brand: '未知品牌', model: '未知型号', name: '全新产品名' }));
    expect(result).toEqual({ kind: 'new' });
  });
});
