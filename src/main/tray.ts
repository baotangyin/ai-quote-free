import { Tray, Menu, nativeImage } from 'electron';
import type { Db } from '../core/db/db';
import { showMainWindow } from './watchScheduler';
import trayIconPath from '../../resources/icon.png?asset';

/**
 * 托盘图标：resources/icon.png（256x256），经 electron-vite 的 ?asset 语法在打包后仍可按路径加载。
 * 按平台缩放到系统托盘常见基准尺寸，避免原图直接塞进托盘导致图标过大（尤其 mac 菜单栏）：
 * - mac：18px，且 setTemplateImage(false)——我们是彩色图标，非需要系统按主题着色的模板图。
 * - Windows/Linux：16px 基准，Windows 托盘的实际物理像素由系统 DPI 缩放处理，16 基准即可。
 */
function loadTrayIcon() {
  const image = nativeImage.createFromPath(trayIconPath);
  const size = process.platform === 'darwin' ? 18 : 16;
  const resized = image.resize({ width: size, height: size });
  if (process.platform === 'darwin') {
    resized.setTemplateImage(false);
  }
  return resized;
}

export interface TrayDeps {
  db: Db;
  /** “立即查价”菜单项触发，交由调用方（index.ts）复用 watch:runNow 同一套逻辑。 */
  runWatchNow: () => Promise<unknown>;
  /** “退出”菜单项触发的真退出路径，调用方需在其中置 isQuitting 标志再 app.quit()。 */
  onQuit: () => void;
}

let tray: Tray | null = null;

/** 创建托盘图标 + 菜单（打开主界面 / 立即查价 / 退出）。人工冒烟验证，不纳入自动化测试。 */
export function createTray(deps: TrayDeps): Tray {
  const t = new Tray(loadTrayIcon());
  t.setToolTip('AI 报价单');

  const menu = Menu.buildFromTemplate([
    { label: '打开主界面', click: () => showMainWindow() },
    { label: '立即查价', click: () => { void deps.runWatchNow(); } },
    { type: 'separator' },
    { label: '退出', click: () => deps.onQuit() },
  ]);
  t.setContextMenu(menu);
  t.on('click', () => showMainWindow());

  tray = t;
  return t;
}

/** 应用退出前销毁托盘图标。 */
export function destroyTray(): void {
  tray?.destroy();
  tray = null;
}
