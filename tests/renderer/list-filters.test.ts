import { describe, it, expect } from 'vitest';
import type { Supplier, EstimateNorm, BomRule } from '../../src/shared/api-types';
import {
  matchSupplierFilter,
  matchEstimateNormFilter,
  matchRuleFilter,
  EMPTY_SUPPLIER_FILTER,
  EMPTY_ESTIMATE_NORM_FILTER,
  EMPTY_RULE_FILTER
} from '../../src/renderer/src/pages/list-filters';

function mkSupplier(overrides: Partial<Supplier>): Supplier {
  return {
    id: 1,
    name: '某供应商',
    contact: null,
    note: null,
    phone: null,
    address: null,
    paymentTerms: null,
    bankInfo: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  };
}

function mkNorm(overrides: Partial<EstimateNorm>): EstimateNorm {
  return {
    id: 1,
    projectType: null,
    spaceType: null,
    unitPriceLowCents: null,
    unitPriceHighCents: null,
    note: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  };
}

function mkRule(overrides: Partial<BomRule>): BomRule {
  return {
    id: 1,
    name: '规则甲',
    enabled: true,
    triggerType: 'category',
    triggerValue: 'LED',
    actions: [],
    sortOrder: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  };
}

describe('matchSupplierFilter', () => {
  it('空筛选放行所有供应商', () => {
    expect(matchSupplierFilter(mkSupplier({}), EMPTY_SUPPLIER_FILTER)).toBe(true);
  });

  it('keyword 匹配名称或联系人，忽略大小写', () => {
    const s = mkSupplier({ name: 'Acme 电子', contact: '张三' });
    expect(matchSupplierFilter(s, { keyword: 'acme' })).toBe(true);
    expect(matchSupplierFilter(s, { keyword: '张三' })).toBe(true);
    expect(matchSupplierFilter(s, { keyword: '不存在' })).toBe(false);
  });

  it('contact 为 null 时仅按名称匹配，不报错', () => {
    const s = mkSupplier({ name: '甲公司', contact: null });
    expect(matchSupplierFilter(s, { keyword: '甲' })).toBe(true);
    expect(matchSupplierFilter(s, { keyword: '乙' })).toBe(false);
  });
});

describe('matchEstimateNormFilter', () => {
  it('空筛选放行所有指标', () => {
    expect(matchEstimateNormFilter(mkNorm({}), EMPTY_ESTIMATE_NORM_FILTER)).toBe(true);
  });

  it('keyword 匹配项目类型/空间类型/备注，忽略大小写', () => {
    const n = mkNorm({ projectType: '智能化', spaceType: '会议室', note: 'Note备注' });
    expect(matchEstimateNormFilter(n, { keyword: '智能' })).toBe(true);
    expect(matchEstimateNormFilter(n, { keyword: '会议' })).toBe(true);
    expect(matchEstimateNormFilter(n, { keyword: 'note' })).toBe(true);
    expect(matchEstimateNormFilter(n, { keyword: '不存在' })).toBe(false);
  });

  it('字段全为 null 时非空 keyword 不放行且不报错', () => {
    expect(matchEstimateNormFilter(mkNorm({}), { keyword: '任意' })).toBe(false);
  });
});

describe('matchRuleFilter', () => {
  it('空筛选放行所有规则', () => {
    expect(matchRuleFilter(mkRule({}), EMPTY_RULE_FILTER)).toBe(true);
  });

  it('triggerTypes 命中任一才放行', () => {
    const r = mkRule({ triggerType: 'product' });
    expect(matchRuleFilter(r, { triggerTypes: ['product'], keyword: '' })).toBe(true);
    expect(matchRuleFilter(r, { triggerTypes: ['category', 'projectType'], keyword: '' })).toBe(false);
  });

  it('keyword 匹配规则名，忽略大小写', () => {
    const r = mkRule({ name: 'LED 接收卡规则' });
    expect(matchRuleFilter(r, { triggerTypes: [], keyword: 'led' })).toBe(true);
    expect(matchRuleFilter(r, { triggerTypes: [], keyword: '不存在' })).toBe(false);
  });

  it('多条件 AND 组合', () => {
    const r = mkRule({ triggerType: 'category', name: '交换机规则' });
    expect(matchRuleFilter(r, { triggerTypes: ['category'], keyword: '交换' })).toBe(true);
    expect(matchRuleFilter(r, { triggerTypes: ['product'], keyword: '交换' })).toBe(false);
  });
});
