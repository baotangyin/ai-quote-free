import dayjs from 'dayjs';
import type { AnalyticsFilter, ProjectProfitRow } from '../../../shared/api-types';

/** 时间段预设。'custom' 时读取 customRange。 */
export type DatePreset = '30d' | '90d' | 'year' | 'all' | 'custom';

/** 统计分析页顶部筛选条状态，整体持久化于 localStorage（key: analytics.filter）。 */
export interface AnalyticsFilterState {
  preset: DatePreset;
  /** 自定义区间 ['YYYY-MM-DD', 'YYYY-MM-DD']；仅 preset==='custom' 时生效，其余预设下保留上次选择以便切回。 */
  customRange: [string, string] | null;
  onlyDone: boolean;
}

export const DEFAULT_ANALYTICS_FILTER: AnalyticsFilterState = {
  preset: '30d',
  customRange: null,
  onlyDone: false
};

/**
 * 根据筛选条件解析请求用的 {from,to}：
 * - to 恒为当日末刻（23:59:59.999 的 ISO），与 Global Constraints 时间口径一致。
 * - 'all' 或 'custom' 未选区间时不带 from/to（core 端跳过对应条件）。
 * @param ref 基准时刻，默认当前时间；测试可注入固定值。
 */
export function resolveDateRange(state: AnalyticsFilterState, ref: dayjs.Dayjs = dayjs()): { from?: string; to?: string } {
  switch (state.preset) {
    case '30d':
      return { from: ref.subtract(29, 'day').startOf('day').toISOString(), to: ref.endOf('day').toISOString() };
    case '90d':
      return { from: ref.subtract(89, 'day').startOf('day').toISOString(), to: ref.endOf('day').toISOString() };
    case 'year':
      return { from: ref.startOf('year').toISOString(), to: ref.endOf('day').toISOString() };
    case 'all':
      return {};
    case 'custom': {
      if (!state.customRange) return {};
      const [start, end] = state.customRange;
      return { from: dayjs(start).startOf('day').toISOString(), to: dayjs(end).endOf('day').toISOString() };
    }
    default:
      return {};
  }
}

/** 筛选条状态 -> IPC 请求用的 AnalyticsFilter。 */
export function toAnalyticsFilter(state: AnalyticsFilterState, ref?: dayjs.Dayjs): AnalyticsFilter {
  const { from, to } = resolveDateRange(state, ref);
  return { from, to, onlyDone: state.onlyDone };
}

export interface MonthlyProfitPoint {
  month: string; // 'YYYY-MM'
  costCents: number;
  revenueCents: number;
}

/** 项目利润行按 createdAt 月分桶前端聚合成本/报价合计，按月份升序返回（供总览页月度双折线使用）。 */
export function aggregateMonthlyProfit(
  rows: Pick<ProjectProfitRow, 'createdAt' | 'costTotalCents' | 'revenueTotalCents'>[]
): MonthlyProfitPoint[] {
  const map = new Map<string, MonthlyProfitPoint>();
  for (const r of rows) {
    const month = dayjs(r.createdAt).format('YYYY-MM');
    let p = map.get(month);
    if (!p) {
      p = { month, costCents: 0, revenueCents: 0 };
      map.set(month, p);
    }
    p.costCents += r.costTotalCents;
    p.revenueCents += r.revenueTotalCents;
  }
  return Array.from(map.values()).sort((a, b) => a.month.localeCompare(b.month));
}
