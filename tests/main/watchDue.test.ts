import { describe, it, expect } from 'vitest';
import { isWatchDue } from '../../src/main/watchDue';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('isWatchDue', () => {
  it('lastRunAt 为 null（从未运行过）视为到期', () => {
    expect(isWatchDue(Date.now(), null, 30)).toBe(true);
  });

  it('无法解析的日期字符串视为到期', () => {
    expect(isWatchDue(Date.now(), 'not-a-date', 30)).toBe(true);
  });

  it('未到周期返回 false', () => {
    const now = Date.now();
    const last = new Date(now - 1 * DAY_MS).toISOString();
    expect(isWatchDue(now, last, 7)).toBe(false);
  });

  it('恰好到期（差值等于周期）返回 true', () => {
    const now = Date.now();
    const last = new Date(now - 7 * DAY_MS).toISOString();
    expect(isWatchDue(now, last, 7)).toBe(true);
  });

  it('超过周期返回 true', () => {
    const now = Date.now();
    const last = new Date(now - 40 * DAY_MS).toISOString();
    expect(isWatchDue(now, last, 30)).toBe(true);
  });

  it('周期为 1 天：23 小时前未到期，25 小时前到期', () => {
    const now = Date.now();
    expect(isWatchDue(now, new Date(now - 23 * 60 * 60 * 1000).toISOString(), 1)).toBe(false);
    expect(isWatchDue(now, new Date(now - 25 * 60 * 60 * 1000).toISOString(), 1)).toBe(true);
  });
});
