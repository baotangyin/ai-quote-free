/**
 * 查价调度的纯逻辑（不依赖 electron），便于独立单测。
 * watchScheduler.ts 中依赖 Notification / webContents 等 electron API 的部分与本文件分离。
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 判断本轮查价是否到期。
 * - lastRunAt 为 null（从未运行过）或无法解析为合法日期 → 视为到期。
 * - 否则 now - lastRunAt（毫秒）>= intervalDays 天 → 到期（含恰好相等的边界）。
 */
export function isWatchDue(now: number, lastRunAt: string | null, intervalDays: number): boolean {
  if (lastRunAt === null) return true;
  const last = new Date(lastRunAt).getTime();
  if (Number.isNaN(last)) return true;
  return now - last >= intervalDays * DAY_MS;
}
