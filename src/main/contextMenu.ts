import { Menu, type BrowserWindow, type ContextMenuParams } from 'electron';

/** 可编辑元素（输入框/文本域）右键菜单项。 */
const EDITABLE_TEMPLATE = [
  { label: '剪切', role: 'cut' as const },
  { label: '复制', role: 'copy' as const },
  { label: '粘贴', role: 'paste' as const },
  { type: 'separator' as const },
  { label: '全选', role: 'selectAll' as const },
];

/** 非可编辑但有选中文本时（如只读文字）的右键菜单项。 */
const SELECTION_TEMPLATE = [
  { label: '复制', role: 'copy' as const },
  { type: 'separator' as const },
  { label: '全选', role: 'selectAll' as const },
];

/**
 * 为窗口注册输入框右键菜单：可编辑元素（isEditable）弹「剪切/复制/粘贴/全选」；
 * 非可编辑但有选中文本（selectionText 非空）时弹「复制/全选」；否则不弹菜单。
 * 依赖真实 Electron webContents/Menu，人工冒烟验证，不纳入自动化测试。
 */
/* istanbul ignore next -- 依赖真实 electron BrowserWindow/webContents/Menu，人工冒烟验证，不纳入自动化测试 */
export function registerInputContextMenu(win: BrowserWindow): void {
  win.webContents.on('context-menu', (_event, params: ContextMenuParams) => {
    if (params.isEditable) {
      Menu.buildFromTemplate(EDITABLE_TEMPLATE).popup({ window: win });
    } else if (params.selectionText && params.selectionText.trim().length > 0) {
      Menu.buildFromTemplate(SELECTION_TEMPLATE).popup({ window: win });
    }
  });
}
