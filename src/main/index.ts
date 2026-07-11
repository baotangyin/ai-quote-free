import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import { join } from 'node:path';
import { openDb } from '../core/index';
import type { Db } from '../core/db/db';
import { ensureSettingsTable, getCloseToTray, getCostRule, getWatchAlertRate, getLaunchAtLogin, setSetting } from './settings';
import { registerIpc, readWatchAiConfig, makeWatchRunNowHandler, setAppVersion } from './ipc';
import { chatComplete } from '../core/ai/client';
import type { VisionChatFn } from '../core/import/drawingRecognize';
import { setMainWindow, startScheduler, stopScheduler } from './watchScheduler';
import { setUpdaterMainWindow, startUpdateScheduler, stopUpdateScheduler } from './updater';
import { createTray, destroyTray } from './tray';
import appIconPath from '../../resources/icon.png?asset';

/** 由托盘“退出”菜单项置真，绕过窗口 close 拦截，走真正的 app.quit() 路径。 */
let isQuitting = false;

function createWindow(db: Db): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    icon: appIconPath, // Linux/Windows 窗口图标；mac 使用打包时的 .icns（electron-builder 自动生成）
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false, // ESM preload 需关闭渲染器沙箱；contextIsolation 仍隔离渲染器与 Node
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  // closeToTray 开启（默认）时，关闭按钮只隐藏窗口到托盘，不退出应用；
  // 真正退出只能经托盘菜单“退出”（isQuitting=true 后调用 app.quit()）。
  win.on('close', (event) => {
    if (isQuitting) return;
    if (getCloseToTray(db)) {
      event.preventDefault();
      win.hide();
    }
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'));
  }

  setMainWindow(win);
  setUpdaterMainWindow(win);
  return win;
}

/** 构建调度器用的查价 chat 闭包；AI 未配置（readWatchAiConfig 抛错）时返回 null，本轮跳过。 */
function buildWatchChat(db: Db): VisionChatFn | null {
  try {
    const cfg = readWatchAiConfig(db);
    return (messages, opts) => chatComplete(cfg, messages, opts);
  } catch {
    return null;
  }
}

/**
 * 按设置应用开机自启（app.setLoginItemSettings）。仅 mac/Windows 生效，Linux 不处理；
 * dev（!isPackaged）下跳过实际系统调用，仅落库设置，避免开发环境污染用户登录项。
 */
/* istanbul ignore next -- 依赖真实 electron app 对象与操作系统登录项，人工冒烟验证，不纳入自动化测试 */
function applyLaunchAtLogin(enabled: boolean): void {
  if (process.platform === 'linux') return;
  if (!app.isPackaged) return;
  app.setLoginItemSettings({ openAtLogin: enabled });
}

app.whenReady().then(() => {
  const dbPath = process.env.AIQUOTE_DB ?? join(app.getPath('userData'), 'ai-quote.db');
  const db = openDb(dbPath);
  ensureSettingsTable(db);
  registerIpc(ipcMain, db);
  setAppVersion(app.getVersion());
  applyLaunchAtLogin(getLaunchAtLogin(db));

  /* istanbul ignore next -- 依赖 electron app 对象，落库+应用登录项，人工冒烟验证，不纳入自动化测试 */
  ipcMain.handle('settings:setLaunchAtLogin', (_event, enabled: boolean) => {
    setSetting(db, 'launchAtLogin', enabled ? '1' : '0');
    applyLaunchAtLogin(enabled);
    return null;
  });

  ipcMain.handle('ping', () => 'pong');

  /* istanbul ignore next -- 依赖 electron dialog 对象，涉及真实文件系统弹窗，ipc.test.ts 不覆盖 */
  ipcMain.handle('dialog:pickDir', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory']
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  /* istanbul ignore next -- 依赖 electron dialog 对象，涉及真实文件系统弹窗，ipc.test.ts 不覆盖 */
  ipcMain.handle('dialog:pickFile', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'Excel', extensions: ['xls', 'xlsx'] }]
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  /* istanbul ignore next -- 依赖 electron shell 对象，唤起系统文件管理器，ipc.test.ts 不覆盖 */
  ipcMain.handle('shell:reveal', (_event, targetPath: string) => {
    shell.showItemInFolder(targetPath);
    return null;
  });

  /* istanbul ignore next -- 依赖 electron shell 对象，唤起系统默认浏览器，ipc.test.ts 不覆盖 */
  ipcMain.handle('shell:openExternal', (_event, url: string) => {
    // 安全：仅允许 http/https，防止 file:// 或自定义协议被用作命令执行原语
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return null;
  });

  /* istanbul ignore next -- 依赖 electron app 对象，app.getVersion() 本身无分支逻辑，ipc.test.ts 不覆盖 */
  ipcMain.handle('app:version', () => app.getVersion());

  createWindow(db);

  /* istanbul ignore next -- 依赖真实 electron Tray/Menu/Notification，人工冒烟验证，不纳入自动化测试 */
  createTray({
    db,
    runWatchNow: () => makeWatchRunNowHandler()(db),
    onQuit: () => {
      isQuitting = true;
      app.quit();
    },
  });

  startScheduler(db, {
    buildChat: buildWatchChat,
    costRule: getCostRule,
    alertRate: getWatchAlertRate,
  });

  startUpdateScheduler(db, app.getVersion(), app.isPackaged);

  app.on('activate', () => {
    const windows = BrowserWindow.getAllWindows();
    if (windows.length === 0) {
      createWindow(db);
    } else {
      windows[0].show();
    }
  });
});

app.on('window-all-closed', () => {
  // closeToTray 开启时窗口只会被 hide，不会触发 window-all-closed；
  // 仅当用户关闭了 closeToTray 或走真正退出路径时才会到这里。
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  isQuitting = true;
  stopScheduler();
  stopUpdateScheduler();
  destroyTray();
});
