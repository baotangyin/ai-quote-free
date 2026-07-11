import { describe, it, expect } from 'vitest';
import dayjs from 'dayjs';
import {
  resolveDateRange,
  toAnalyticsFilter,
  aggregateMonthlyProfit,
  DEFAULT_ANALYTICS_FILTER,
  type AnalyticsFilterState
} from '../../src/renderer/src/pages/analytics-logic';

const REF = dayjs('2026-07-10T12:34:56.789Z');

describe('resolveDateRange', () => {
  it('30d: from 为 ref 往前 29 天的当日零点，to 为 ref 当日 23:59:59.999', () => {
    const { from, to } = resolveDateRange({ preset: '30d', customRange: null, onlyDone: false }, REF);
    expect(from).toBe(REF.subtract(29, 'day').startOf('day').toISOString());
    expect(to).toBe(REF.endOf('day').toISOString());
    // endOf('day') 恒为本地时区当日 23:59:59.999，toISOString 转换为 UTC 后毫秒部分不变
    expect(to?.endsWith('.999Z')).toBe(true);
  });

  it('90d: from 为 ref 往前 89 天', () => {
    const { from, to } = resolveDateRange({ preset: '90d', customRange: null, onlyDone: false }, REF);
    expect(from).toBe(REF.subtract(89, 'day').startOf('day').toISOString());
    expect(to).toBe(REF.endOf('day').toISOString());
  });

  it('year: from 为今年 1 月 1 日零点', () => {
    const { from, to } = resolveDateRange({ preset: 'year', customRange: null, onlyDone: false }, REF);
    expect(from).toBe(REF.startOf('year').toISOString());
    expect(to).toBe(REF.endOf('day').toISOString());
  });

  it('all: 不带任何时间范围', () => {
    const { from, to } = resolveDateRange({ preset: 'all', customRange: null, onlyDone: false }, REF);
    expect(from).toBeUndefined();
    expect(to).toBeUndefined();
  });

  it('custom: 未选区间时不带范围', () => {
    const { from, to } = resolveDateRange({ preset: 'custom', customRange: null, onlyDone: false }, REF);
    expect(from).toBeUndefined();
    expect(to).toBeUndefined();
  });

  it('custom: 已选区间时 from 为起始日零点，to 为结束日 23:59:59.999', () => {
    const state: AnalyticsFilterState = { preset: 'custom', customRange: ['2026-01-05', '2026-01-20'], onlyDone: false };
    const { from, to } = resolveDateRange(state, REF);
    expect(from).toBe(dayjs('2026-01-05').startOf('day').toISOString());
    expect(to).toBe(dayjs('2026-01-20').endOf('day').toISOString());
    expect(to?.endsWith('.999Z')).toBe(true);
  });
});

describe('toAnalyticsFilter', () => {
  it('携带 onlyDone 与解析出的 from/to', () => {
    const filter = toAnalyticsFilter({ preset: 'all', customRange: null, onlyDone: true }, REF);
    expect(filter.onlyDone).toBe(true);
    expect(filter.from).toBeUndefined();
    expect(filter.to).toBeUndefined();
  });

  it('DEFAULT_ANALYTICS_FILTER 默认近 30 天、未仅完成', () => {
    expect(DEFAULT_ANALYTICS_FILTER.preset).toBe('30d');
    expect(DEFAULT_ANALYTICS_FILTER.onlyDone).toBe(false);
    expect(DEFAULT_ANALYTICS_FILTER.customRange).toBeNull();
  });
});

describe('aggregateMonthlyProfit', () => {
  it('按 createdAt 月分桶累加成本/报价，按月升序', () => {
    const rows = [
      { createdAt: '2026-02-15T00:00:00.000Z', costTotalCents: 100, revenueTotalCents: 200 },
      { createdAt: '2026-01-01T00:00:00.000Z', costTotalCents: 50, revenueTotalCents: 80 },
      { createdAt: '2026-01-20T00:00:00.000Z', costTotalCents: 30, revenueTotalCents: 40 },
      { createdAt: '2026-02-01T00:00:00.000Z', costTotalCents: 10, revenueTotalCents: 20 }
    ];
    const result = aggregateMonthlyProfit(rows);
    expect(result).toEqual([
      { month: '2026-01', costCents: 80, revenueCents: 120 },
      { month: '2026-02', costCents: 110, revenueCents: 220 }
    ]);
  });

  it('空输入返回空数组', () => {
    expect(aggregateMonthlyProfit([])).toEqual([]);
  });
});
