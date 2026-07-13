import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as core from '../../src/core/index';
import { ensureSettingsTable, setSetting } from '../../src/main/settings';
import {
  checkForUpdate,
  checkForUpdateAndSync,
  getUpdateStatus,
  setUpdaterMainWindow,
  resetUpdateStateForTest,
} from '../../src/main/updater';

function buildDb() {
  const db = core.openDb(':memory:');
  ensureSettingsTable(db);
  return db;
}

function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
  } as Response;
}

describe('checkForUpdate（GitHub API 路径，fetch 依赖注入）', () => {
  beforeEach(() => {
    resetUpdateStateForTest();
  });

  it('GitHub 最新 tag 比当前版本新：hasUpdate=true，返回 version/notes/url', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      tag_name: 'v0.16.0',
      body: '## 更新说明\n- 支持自动更新',
      html_url: 'https://github.com/baotangyin/ai-quote-free/releases/tag/v0.16.0',
    }));
    const result = await checkForUpdate('0.15.0', { fetchImpl: fetchMock });
    expect(result).toEqual({
      hasUpdate: true,
      version: 'v0.16.0',
      notes: '## 更新说明\n- 支持自动更新',
      url: 'https://github.com/baotangyin/ai-quote-free/releases/tag/v0.16.0',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.github.com/repos/baotangyin/ai-quote-free/releases/latest');
    expect(opts).toMatchObject({ headers: { Accept: 'application/vnd.github+json' } });
  });

  it('已是最新：hasUpdate=false，version/notes/url 为 null', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      tag_name: 'v0.15.0',
      body: 'x',
      html_url: 'https://github.com/x',
    }));
    const result = await checkForUpdate('0.15.0', { fetchImpl: fetchMock });
    expect(result).toEqual({ hasUpdate: false, version: null, notes: null, url: null });
  });

  it('当前版本比 latest 还新：hasUpdate=false', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ tag_name: 'v0.14.0' }));
    const result = await checkForUpdate('0.15.0', { fetchImpl: fetchMock });
    expect(result.hasUpdate).toBe(false);
  });

  it('HTTP 404/403（发布仓库不存在或不可访问）：抛友好错误文案，且 status 记录 error', async () => {
    for (const code of [404, 403]) {
      resetUpdateStateForTest();
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}, false, code));
      await expect(checkForUpdate('0.15.0', { fetchImpl: fetchMock })).rejects.toThrow(
        '无法访问更新源：请检查网络连接',
      );
      const status = getUpdateStatus();
      expect(status.error).toBe('无法访问更新源：请检查网络连接');
      expect(status.checking).toBe(false);
    }
  });

  it('HTTP 其它非 2xx（如 500）：保留原始 HTTP 状态码文案', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}, false, 500));
    await expect(checkForUpdate('0.15.0', { fetchImpl: fetchMock })).rejects.toThrow('GitHub API 请求失败：HTTP 500');
  });

  it('返回数据缺少 tag_name：抛错', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}));
    await expect(checkForUpdate('0.15.0', { fetchImpl: fetchMock })).rejects.toThrow();
  });

  it('fetch 本身抛错（超时/网络失败）：checkForUpdate 抛友好错误文案，不吞掉', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('network fail'));
    await expect(checkForUpdate('0.15.0', { fetchImpl: fetchMock })).rejects.toThrow(
      '无法访问更新源：请检查网络连接',
    );
  });

  it('成功路径更新内部 status 缓存，可经 getUpdateStatus 读取', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      tag_name: 'v0.16.0', body: 'notes', html_url: 'https://x',
    }));
    await checkForUpdate('0.15.0', { fetchImpl: fetchMock });
    const status = getUpdateStatus();
    expect(status.hasUpdate).toBe(true);
    expect(status.version).toBe('v0.16.0');
    expect(status.notes).toBe('notes');
    expect(status.url).toBe('https://x');
    expect(status.checking).toBe(false);
    expect(status.error).toBeNull();
  });

  it('广播 update:event：checking → available', async () => {
    const sends: unknown[] = [];
    setUpdaterMainWindow({ webContents: { send: (_ch: string, payload: unknown) => sends.push(payload) } } as any);
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      tag_name: 'v0.16.0', body: 'notes', html_url: 'https://x',
    }));
    await checkForUpdate('0.15.0', { fetchImpl: fetchMock });
    expect(sends[0]).toMatchObject({ type: 'checking' });
    expect(sends[1]).toMatchObject({ type: 'available', version: 'v0.16.0' });
  });

  it('广播 update:event：checking → not-available', async () => {
    const sends: unknown[] = [];
    setUpdaterMainWindow({ webContents: { send: (_ch: string, payload: unknown) => sends.push(payload) } } as any);
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ tag_name: 'v0.15.0' }));
    await checkForUpdate('0.15.0', { fetchImpl: fetchMock });
    expect(sends[0]).toMatchObject({ type: 'checking' });
    expect(sends[1]).toMatchObject({ type: 'not-available' });
  });

  it('广播 update:event：checking → error（网络失败转友好文案）', async () => {
    const sends: unknown[] = [];
    setUpdaterMainWindow({ webContents: { send: (_ch: string, payload: unknown) => sends.push(payload) } } as any);
    const fetchMock = vi.fn().mockRejectedValue(new Error('boom'));
    await expect(checkForUpdate('0.15.0', { fetchImpl: fetchMock })).rejects.toThrow();
    expect(sends[0]).toMatchObject({ type: 'checking' });
    expect(sends[1]).toMatchObject({
      type: 'error',
      message: '无法访问更新源：请检查网络连接',
    });
  });

  it('checkForUpdateAndSync：非 Electron 运行时（vitest）不触发 electron-updater，纯走 GitHub API 检测结果', async () => {
    const db = buildDb();
    setSetting(db, 'updateMode', 'auto');
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      tag_name: 'v0.16.0', body: 'notes', html_url: 'https://x',
    }));
    const result = await checkForUpdateAndSync(db, '0.15.0', { fetchImpl: fetchMock });
    expect(result).toEqual({ hasUpdate: true, version: 'v0.16.0', notes: 'notes', url: 'https://x' });
    // process.versions.electron 在 vitest 下为 undefined，maybeAutoDownload 内部 loadAutoUpdater 直接短路返回，
    // 不会抛错、不会污染 status.downloaded。
    expect(getUpdateStatus().downloaded).toBe(false);
  });

  it('checkForUpdateAndSync：GitHub API 检测失败时仍然抛错（不被自动下载分支吞掉）', async () => {
    const db = buildDb();
    const fetchMock = vi.fn().mockRejectedValue(new Error('boom'));
    await expect(checkForUpdateAndSync(db, '0.15.0', { fetchImpl: fetchMock })).rejects.toThrow(
      '无法访问更新源：请检查网络连接',
    );
  });

  it('防重入：in-flight 时并发两次调用仅触发一次 fetch，两个 promise 解析为同一结果', async () => {
    let resolveFetch: (v: Response) => void;
    const fetchMock = vi.fn().mockReturnValue(new Promise<Response>((resolve) => { resolveFetch = resolve; }));
    const p1 = checkForUpdate('0.15.0', { fetchImpl: fetchMock });
    const p2 = checkForUpdate('0.15.0', { fetchImpl: fetchMock });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    resolveFetch!(jsonResponse({ tag_name: 'v0.16.0', body: 'notes', html_url: 'https://x' }));
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toEqual(r2);
    expect(r1).toEqual({ hasUpdate: true, version: 'v0.16.0', notes: 'notes', url: 'https://x' });
  });

  it('防重入：上一次检测完成后，下一次调用会重新发起 fetch', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ tag_name: 'v0.15.0' }));
    await checkForUpdate('0.15.0', { fetchImpl: fetchMock });
    await checkForUpdate('0.15.0', { fetchImpl: fetchMock });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('resetUpdateStateForTest 后 mainWindow 引用与 status 均重置', async () => {
    const sends: unknown[] = [];
    setUpdaterMainWindow({ webContents: { send: (_ch: string, payload: unknown) => sends.push(payload) } } as any);
    resetUpdateStateForTest();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ tag_name: 'v0.15.0' }));
    await checkForUpdate('0.15.0', { fetchImpl: fetchMock });
    expect(sends).toEqual([]);
    expect(getUpdateStatus()).toMatchObject({ hasUpdate: false, error: null, checking: false });
  });
});
