import type { BrowserWindow } from 'electron';
import { isNewerVersion } from './updateVersion';
import { getUpdateMode } from './settings';
import type { Db } from '../core/db/db';

const OWNER = 'baotangyin';
const REPO = 'ai-quote-free';
/** 手动/定时检测遇到 404/403（仓库不存在或不可访问）与网络失败（fetch 本身抛错，含超时 abort）时的统一友好文案。 */
const REPO_UNAVAILABLE_MESSAGE = '无法访问更新源：请检查网络连接';
const GITHUB_API_TIMEOUT_MS = 10_000;
const HOUR_MS = 60 * 60 * 1000;
/** 启动后延迟 1 分钟做首次检查，24h 周期检查一次。 */
const STARTUP_DELAY_MS = 60 * 1000;
const CHECK_INTERVAL_MS = 24 * HOUR_MS;

export interface UpdateCheckResult {
  hasUpdate: boolean;
  version: string | null;
  notes: string | null;
  url: string | null;
}

/** update:event 广播 payload：checking→available/not-available/error 为检测阶段；
 * progress/downloaded 为 Windows 自动下载阶段（仅 electron-updater 触发）。 */
export type UpdateEventPayload =
  | { type: 'checking' }
  | { type: 'available'; version: string; notes: string | null; url: string | null }
  | { type: 'not-available' }
  | { type: 'progress'; percent: number }
  | { type: 'downloaded'; version: string }
  | { type: 'error'; message: string };

export interface UpdateStatus extends UpdateCheckResult {
  checking: boolean;
  progressPercent: number | null;
  downloaded: boolean;
  error: string | null;
}

function initialStatus(): UpdateStatus {
  return {
    checking: false,
    hasUpdate: false,
    version: null,
    notes: null,
    url: null,
    progressPercent: null,
    downloaded: false,
    error: null,
  };
}

let mainWindow: BrowserWindow | null = null;
let status: UpdateStatus = initialStatus();
let hourlyTimer: ReturnType<typeof setInterval> | null = null;
let startupTimer: ReturnType<typeof setTimeout> | null = null;
let autoUpdaterWired = false;

/** index.ts 在创建/切换主窗口时注入引用，供事件广播使用。 */
export function setUpdaterMainWindow(win: BrowserWindow | null): void {
  mainWindow = win;
}

export function getUpdateStatus(): UpdateStatus {
  return status;
}

function broadcast(payload: UpdateEventPayload): void {
  mainWindow?.webContents.send('update:event', payload);
}

export interface CheckForUpdateDeps {
  fetchImpl?: typeof fetch;
}

/** 防重入：in-flight 时缓存同一 promise，避免并发调用重复触发 fetch（见 checkForUpdate）。 */
let inFlightCheck: Promise<UpdateCheckResult> | null = null;

/**
 * 手动/定时检测入口：统一走 GitHub Releases API（mac 未签名无法用 electron-updater 自动更新，
 * win 也复用同一路径便于 dev 环境验证——electron-updater 依赖打包后的 latest.yml，dev 下不可用）。
 * 10s 超时；失败抛错（由调用方决定静默或提示，定时调度捕获忽略，手动检查向 renderer 报错）。
 * 防重入：若已有检测在进行中，直接返回同一个 in-flight promise，不重复发起 fetch（例如用户连续点击
 * 「立即检查」、或手动检查与定时调度同时触发）。
 */
export function checkForUpdate(currentVersion: string, deps: CheckForUpdateDeps = {}): Promise<UpdateCheckResult> {
  if (inFlightCheck) return inFlightCheck;
  const promise = runCheckForUpdate(currentVersion, deps).finally(() => {
    inFlightCheck = null;
  });
  inFlightCheck = promise;
  return promise;
}

async function runCheckForUpdate(currentVersion: string, deps: CheckForUpdateDeps = {}): Promise<UpdateCheckResult> {
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  status = { ...status, checking: true, error: null };
  broadcast({ type: 'checking' });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GITHUB_API_TIMEOUT_MS);
  try {
    let res: Response;
    try {
      res = await fetchImpl(`https://api.github.com/repos/${OWNER}/${REPO}/releases/latest`, {
        signal: controller.signal,
        headers: { Accept: 'application/vnd.github+json' },
      });
    } catch {
      // fetch 本身抛错：网络失败/超时（AbortController 触发的 abort 也在此捕获）。
      throw new Error(REPO_UNAVAILABLE_MESSAGE);
    }
    if (!res.ok) {
      if (res.status === 404 || res.status === 403) throw new Error(REPO_UNAVAILABLE_MESSAGE);
      throw new Error(`GitHub API 请求失败：HTTP ${res.status}`);
    }
    const data = await res.json() as { tag_name?: string; body?: string; html_url?: string };
    const tag = data.tag_name;
    if (!tag) throw new Error('GitHub API 返回缺少 tag_name');
    const hasUpdate = isNewerVersion(tag, currentVersion);
    const result: UpdateCheckResult = {
      hasUpdate,
      version: hasUpdate ? tag : null,
      notes: hasUpdate ? (data.body ?? null) : null,
      url: hasUpdate ? (data.html_url ?? `https://github.com/${OWNER}/${REPO}/releases/latest`) : null,
    };
    status = { ...status, ...result, checking: false, error: null };
    broadcast(hasUpdate
      ? { type: 'available', version: result.version as string, notes: result.notes, url: result.url }
      : { type: 'not-available' });
    return result;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    status = { ...status, checking: false, error: message };
    broadcast({ type: 'error', message });
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 动态加载 electron-updater 的 autoUpdater 单例：非真实 Electron 主进程运行时（如 vitest）不 import，
 * 避免模块顶层副作用（与 watchScheduler.ts 的 Notification 门控同一教训）。
 * electron-updater 为 CJS 包，ESM 动态 import 下 named export 可能落在 default 上，两处都兜底取值。
 */
async function loadAutoUpdater(): Promise<any | null> {
  if (!process.versions.electron) return null;
  const mod: any = await import('electron-updater');
  return mod.autoUpdater ?? mod.default?.autoUpdater ?? null;
}

/** 将 electron-updater 事件转发为统一的 update:event 广播 + status 缓存；仅在真实 Electron 环境调用一次。 */
function wireAutoUpdaterEvents(autoUpdater: any): void {
  if (autoUpdaterWired) return;
  autoUpdaterWired = true;
  autoUpdater.on('download-progress', (p: { percent: number }) => {
    status = { ...status, progressPercent: p.percent };
    broadcast({ type: 'progress', percent: p.percent });
  });
  autoUpdater.on('update-downloaded', (info: { version: string }) => {
    status = { ...status, downloaded: true, progressPercent: 100 };
    broadcast({ type: 'downloaded', version: info.version });
  });
  autoUpdater.on('error', (err: Error) => {
    status = { ...status, error: err.message };
    broadcast({ type: 'error', message: err.message });
  });
}

/**
 * Windows 'auto' 模式下触发 electron-updater 自动下载：仅打包环境、win32、真实 Electron 运行时生效。
 * autoDownload 由本次调用显式置位，避免受历史调用/其它平台状态影响。
 */
async function maybeAutoDownload(db: Db): Promise<void> {
  if (process.platform !== 'win32') return;
  if (getUpdateMode(db, process.platform) !== 'auto') return;
  const autoUpdater = await loadAutoUpdater();
  if (!autoUpdater) return;
  wireAutoUpdaterEvents(autoUpdater);
  autoUpdater.autoDownload = true;
  try {
    await autoUpdater.checkForUpdates();
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    status = { ...status, error: message };
    broadcast({ type: 'error', message });
  }
}

/**
 * 供 IPC `update:check`（手动）与调度器共用：先经 GitHub API 检测，再按 updateMode/平台
 * 决定是否顺带触发 Windows 自动下载（与定时调度行为一致，手动点「立即检查」在 win auto 模式下
 * 也会直接开始下载，而不是要用户再点一次）。检测阶段的错误会照常抛出；自动下载阶段的错误已在
 * maybeAutoDownload 内部转成 error 事件广播，不会影响本函数的返回值。
 */
export async function checkForUpdateAndSync(db: Db, currentVersion: string, deps: CheckForUpdateDeps = {}): Promise<UpdateCheckResult> {
  const result = await checkForUpdate(currentVersion, deps);
  await maybeAutoDownload(db);
  return result;
}

/** update:install：quitAndInstall，仅 Windows 下载完成后有效；其余情况 no-op（返回 false）。 */
export async function installUpdate(): Promise<boolean> {
  if (!status.downloaded) return false;
  const autoUpdater = await loadAutoUpdater();
  if (!autoUpdater) return false;
  autoUpdater.quitAndInstall();
  return true;
}

/**
 * 启动定时检查：dev 模式（!isPackaged）跳过，避免未打包环境下反复触发网络请求；
 * 启动 1 分钟后首检，之后每 24h 一次。定时触发失败静默吞掉（不影响应用运行，手动检查仍会报错提示用户）。
 * 返回停止函数（应用退出 / 测试清理时调用）。
 */
export function startUpdateScheduler(db: Db, currentVersion: string, isPackaged: boolean): () => void {
  stopUpdateScheduler();
  if (!isPackaged) return stopUpdateScheduler;
  const run = () => {
    void checkForUpdateAndSync(db, currentVersion).catch(() => {
      // 定时调度触发的失败静默处理，手动检查（update:check）会把错误抛给 renderer。
    });
  };
  startupTimer = setTimeout(run, STARTUP_DELAY_MS);
  hourlyTimer = setInterval(run, CHECK_INTERVAL_MS);
  return stopUpdateScheduler;
}

export function stopUpdateScheduler(): void {
  if (hourlyTimer) { clearInterval(hourlyTimer); hourlyTimer = null; }
  if (startupTimer) { clearTimeout(startupTimer); startupTimer = null; }
}

/** 仅供测试使用：重置模块级单例状态，避免测试间状态串扰。 */
export function resetUpdateStateForTest(): void {
  status = initialStatus();
  mainWindow = null;
  autoUpdaterWired = false;
  inFlightCheck = null;
  stopUpdateScheduler();
}
