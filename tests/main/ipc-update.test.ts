import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as core from '../../src/core/index';
import { handlers, setAppVersion } from '../../src/main/ipc';
import { ensureSettingsTable } from '../../src/main/settings';
import { resetUpdateStateForTest } from '../../src/main/updater';

function buildDb() {
  const db = core.openDb(':memory:');
  ensureSettingsTable(db);
  return db;
}

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body } as Response;
}

describe('update:check / update:install / update:status IPC', () => {
  beforeEach(() => {
    resetUpdateStateForTest();
    setAppVersion('0.15.0');
  });

  afterEach(() => {
    setAppVersion('dev');
    vi.unstubAllGlobals();
  });

  it('handlers 表注册了 update:check / update:install / update:status', () => {
    expect(typeof handlers['update:check']).toBe('function');
    expect(typeof handlers['update:install']).toBe('function');
    expect(typeof handlers['update:status']).toBe('function');
  });

  it('update:check 走 GitHub API（全局 fetch），发现新版返回 hasUpdate=true', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      tag_name: 'v0.16.0', body: '发布说明', html_url: 'https://github.com/baotangyin/ai-quote-free/releases/tag/v0.16.0',
    }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await handlers['update:check'](buildDb(), undefined);
    expect(result).toEqual({
      hasUpdate: true, version: 'v0.16.0', notes: '发布说明',
      url: 'https://github.com/baotangyin/ai-quote-free/releases/tag/v0.16.0',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.github.com/repos/baotangyin/ai-quote-free/releases/latest',
      expect.anything(),
    );

    const status = await handlers['update:status'](buildDb(), undefined);
    expect(status).toMatchObject({ hasUpdate: true, version: 'v0.16.0', checking: false });
  });

  it('已是最新版本：update:check 返回 hasUpdate=false', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ tag_name: 'v0.15.0' })));
    const result = await handlers['update:check'](buildDb(), undefined);
    expect(result).toEqual({ hasUpdate: false, version: null, notes: null, url: null });
  });

  it('update:install 在未下载完成时返回 false（no-op）', async () => {
    const result = await handlers['update:install'](buildDb(), undefined);
    expect(result).toBe(false);
  });
});
