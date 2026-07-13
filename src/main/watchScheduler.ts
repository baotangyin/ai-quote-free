import type { BrowserWindow } from 'electron';
import type { Db } from '../core/db/db';
import type { CostRule } from '../core/domain/types';
import type { VisionChatFn } from '../core/import/drawingRecognize';
import { runPriceWatchRound, type WatchRoundSummary } from '../core/ai/priceSearch';
import { getSetting, setSetting } from './settings';
import { isWatchDue } from './watchDue';

export { isWatchDue } from './watchDue';

const HOUR_MS = 60 * 60 * 1000;
/** 启动时若已到期，延迟 5 分钟再执行第一轮，避开应用启动高峰。 */
const STARTUP_DELAY_MS = 5 * 60 * 1000;
/** watchIntervalDays 未设置时的默认周期（天），与 settings.getWatchIntervalDays 保持一致。 */
const DEFAULT_INTERVAL_DAYS = 30;

let mainWindow: BrowserWindow | null = null;
let running = false;
let lastSummary: WatchRoundSummary | null = null;
let hourlyTimer: ReturnType<typeof setInterval> | null = null;
let startupTimer: ReturnType<typeof setTimeout> | null = null;

/** index.ts 在创建/切换主窗口时注入引用，供事件广播、通知点击后聚焦使用。 */
export function setMainWindow(win: BrowserWindow | null): void {
  mainWindow = win;
}

export function isRunning(): boolean {
  return running;
}

export function getLastSummary(): WatchRoundSummary | null {
  return lastSummary;
}

/** watch:status IPC 端点承载的状态。 */
export function getStatus(db: Db): { lastRunAt: string | null; lastSummary: WatchRoundSummary | null; running: boolean } {
  return { lastRunAt: getSetting(db, 'lastWatchRunAt'), lastSummary, running };
}

/** 显示主窗口：通知点击 / 托盘菜单“打开主界面”共用。 */
export function showMainWindow(): void {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function defaultBroadcast(summary: WatchRoundSummary): void {
  mainWindow?.webContents.send('watch:done', summary);
}

/**
 * 异动通知：延迟（动态 import）加载 electron 的 Notification，
 * 避免非 Electron 运行时（如 vitest）在模块顶层静态 import 时因缺少真实 electron API 而报错。
 */
async function defaultNotify(summary: WatchRoundSummary): Promise<void> {
  // 非真实 Electron 主进程运行时（如 vitest）不 import 'electron'：
  // 该 npm 包在非 Electron 运行时 require 时会尝试下载/校验 electron 二进制，有网络副作用。
  if (!process.versions.electron) return;
  try {
    const { Notification } = await import('electron');
    if (!Notification || !Notification.isSupported()) return;
    const n = new Notification({
      title: '查价异动提醒',
      body: `本轮查价发现 ${summary.alerts.length} 个产品价格异动`,
    });
    n.on('click', () => showMainWindow());
    n.show();
  } catch {
    // 通知发送失败不影响查价主流程。
  }
}

export interface RunNowDeps {
  broadcast?: (summary: WatchRoundSummary) => void;
  notify?: (summary: WatchRoundSummary) => void | Promise<void>;
}

/**
 * 执行一轮查价：running 锁防重入（含手动触发与调度触发共用同一把锁）；
 * 轮结束写 settings.lastWatchRunAt、缓存 lastSummary（内存）、广播 watch:done、
 * 异动非空时发系统通知。
 */
export async function runNow(
  db: Db,
  chat: VisionChatFn,
  opts: { costRule: CostRule; alertRate: number; delayMs?: number },
  deps: RunNowDeps = {},
): Promise<WatchRoundSummary> {
  if (running) {
    throw new Error('查价正在进行中，请稍候');
  }
  running = true;
  try {
    const summary = await runPriceWatchRound(db, chat, opts);
    setSetting(db, 'lastWatchRunAt', summary.finishedAt);
    lastSummary = summary;
    (deps.broadcast ?? defaultBroadcast)(summary);
    if (summary.alerts.length > 0) {
      await (deps.notify ?? defaultNotify)(summary);
    }
    return summary;
  } finally {
    running = false;
  }
}

export interface SchedulerDeps {
  /** 构建查价用的 chat 闭包；AI 未配置等原因导致无法构建时返回 null，本轮跳过。 */
  buildChat: (db: Db) => VisionChatFn | null;
  costRule: (db: Db) => CostRule;
  alertRate: (db: Db) => number;
}

function checkAndRun(db: Db, deps: SchedulerDeps): void {
  if (running) return;
  if (getSetting(db, 'watchEnabled') !== '1') return;
  const intervalDaysRaw = getSetting(db, 'watchIntervalDays');
  const intervalDays = intervalDaysRaw != null ? Number(intervalDaysRaw) : DEFAULT_INTERVAL_DAYS;
  const lastRunAt = getSetting(db, 'lastWatchRunAt');
  if (!isWatchDue(Date.now(), lastRunAt, intervalDays)) return;
  const chat = deps.buildChat(db);
  if (!chat) return;
  void runNow(db, chat, { costRule: deps.costRule(db), alertRate: deps.alertRate(db) }).catch(() => {
    // 后台调度触发的失败静默处理，不影响应用运行；单产品失败已由 runPriceWatchRound 内部容错。
  });
}

/**
 * 启动调度器：每小时检查一次是否到期（不使用跨越数周/数月的单次长 setInterval）；
 * 启动时若已到期，延迟 5 分钟再执行第一轮。返回停止函数（测试 / 应用退出时清理定时器）。
 */
export function startScheduler(db: Db, deps: SchedulerDeps): () => void {
  stopScheduler();
  startupTimer = setTimeout(() => checkAndRun(db, deps), STARTUP_DELAY_MS);
  hourlyTimer = setInterval(() => checkAndRun(db, deps), HOUR_MS);
  return stopScheduler;
}

export function stopScheduler(): void {
  if (hourlyTimer) { clearInterval(hourlyTimer); hourlyTimer = null; }
  if (startupTimer) { clearTimeout(startupTimer); startupTimer = null; }
}

/** 仅供测试使用：重置模块级单例状态（running/lastSummary），避免测试间状态串扰。 */
export function resetWatchStateForTest(): void {
  running = false;
  lastSummary = null;
  mainWindow = null;
  stopScheduler();
}
