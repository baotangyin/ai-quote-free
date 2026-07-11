import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as core from '../../src/core/index';
import { handlers, makeWatchRunNowHandler } from '../../src/main/ipc';
import { ensureSettingsTable, setSetting } from '../../src/main/settings';
import { resetWatchStateForTest, isRunning } from '../../src/main/watchScheduler';

function buildDb() {
  const db = core.openDb(':memory:');
  ensureSettingsTable(db);
  return db;
}

function configureAi(db: ReturnType<typeof buildDb>) {
  setSetting(db, 'aiProtocol', 'openai');
  setSetting(db, 'aiBaseUrl', 'https://api.test');
  setSetting(db, 'aiApiKey', 'sk-test');
  setSetting(db, 'aiModel', 'test-model');
}

describe('watch:runNow / watch:status 全链路（chat 依赖注入 mock）', () => {
  beforeEach(() => {
    resetWatchStateForTest();
  });

  it('handlers 表注册了 watch:runNow 与 watch:status', () => {
    expect(typeof handlers['watch:runNow']).toBe('function');
    expect(typeof handlers['watch:status']).toBe('function');
  });

  it('无监控产品：checked=0，不调用 chat，watch:status 反映本轮结果', async () => {
    const db = buildDb();
    configureAi(db);
    const chatFn = vi.fn();
    const summary = await makeWatchRunNowHandler(chatFn)(db);
    expect(summary.checked).toBe(0);
    expect(summary.alerts).toEqual([]);
    expect(chatFn).not.toHaveBeenCalled();

    const status = handlers['watch:status'](db, undefined);
    expect(status.lastRunAt).toBe(summary.finishedAt);
    expect(status.lastSummary).toEqual(summary);
    expect(status.running).toBe(false);
  });

  it('AI 未配置时抛错，且不会把 running 卡死', async () => {
    const db = buildDb();
    const chatFn = vi.fn();
    await expect(makeWatchRunNowHandler(chatFn)(db)).rejects.toThrow('请先在设置中配置 AI 档案');
    expect(isRunning()).toBe(false);
    expect(chatFn).not.toHaveBeenCalled();
  });

  it('监控产品查价成功入库：updated 计数、异动超阈值计入 alerts', async () => {
    const db = buildDb();
    configureAi(db);
    const product = core.createProduct(db, { name: '测试屏', unit: '台', watchPrice: true });
    core.addPriceRecord(db, {
      productId: product.id, source: 'manual', priceCents: 10000, capturedAt: new Date().toISOString(),
    });

    const chatFn = vi.fn().mockResolvedValue(
      JSON.stringify({ found: true, priceYuan: 200, sourceUrl: 'https://x.test', note: null }),
    );
    const summary = await makeWatchRunNowHandler(chatFn)(db);

    expect(summary.checked).toBe(1);
    expect(summary.updated).toBe(1);
    expect(summary.failed).toBe(0);
    expect(summary.skipped).toBe(0);
    expect(summary.alerts).toHaveLength(1);
    expect(summary.alerts[0]).toMatchObject({ productId: product.id, oldCents: 10000, newCents: 20000 });
    expect(chatFn).toHaveBeenCalledTimes(1);

    const status = handlers['watch:status'](db, undefined);
    expect(status.lastSummary).toEqual(summary);
  });

  it('watchModel 设置非空时覆盖 cfg.model 传给 chat', async () => {
    const db = buildDb();
    configureAi(db);
    setSetting(db, 'watchModel', 'watch-special-model');
    core.createProduct(db, { name: 'X', unit: '台', watchPrice: true });
    const chatFn = vi.fn().mockResolvedValue(
      JSON.stringify({ found: false, priceYuan: null, sourceUrl: null, note: null }),
    );
    await makeWatchRunNowHandler(chatFn)(db);
    expect(chatFn).toHaveBeenCalledTimes(1);
    expect(chatFn.mock.calls[0][0]).toMatchObject({ model: 'watch-special-model' });
  });

  it('watchModel 为空时沿用主 AI 模型', async () => {
    const db = buildDb();
    configureAi(db);
    core.createProduct(db, { name: 'X', unit: '台', watchPrice: true });
    const chatFn = vi.fn().mockResolvedValue(
      JSON.stringify({ found: false, priceYuan: null, sourceUrl: null, note: null }),
    );
    await makeWatchRunNowHandler(chatFn)(db);
    expect(chatFn.mock.calls[0][0]).toMatchObject({ model: 'test-model' });
  });

  it('running 期间重复调用 watch:runNow 抛错（防重入），先前一轮完成后可再次运行', async () => {
    const db = buildDb();
    configureAi(db);
    core.createProduct(db, { name: 'Y', unit: '台', watchPrice: true });

    let resolveChat: (v: string) => void = () => {};
    const chatFn = vi.fn(() => new Promise<string>((resolve) => { resolveChat = resolve; }));
    const handler = makeWatchRunNowHandler(chatFn);

    const p1 = handler(db);
    expect(isRunning()).toBe(true);
    await expect(handler(db)).rejects.toThrow('查价正在进行中');

    resolveChat(JSON.stringify({ found: false, priceYuan: null, sourceUrl: null, note: null }));
    const summary1 = await p1;
    expect(summary1.checked).toBe(1);
    expect(isRunning()).toBe(false);

    // 第一轮结束后锁已释放，可再次运行。
    const chatFn2 = vi.fn().mockResolvedValue(JSON.stringify({ found: false, priceYuan: null, sourceUrl: null, note: null }));
    const summary2 = await makeWatchRunNowHandler(chatFn2)(db);
    expect(summary2.checked).toBe(1);
  });

  it('无异动时不触发 notify 回调；有异动时触发 notify 回调（依赖注入）', async () => {
    const db = buildDb();
    configureAi(db);
    const product = core.createProduct(db, { name: 'Z', unit: '台', watchPrice: true });
    core.addPriceRecord(db, {
      productId: product.id, source: 'manual', priceCents: 10000, capturedAt: new Date().toISOString(),
    });
    const broadcast = vi.fn();
    const notify = vi.fn();

    // 无异动（价格几乎不变）
    const chatFnNoAlert = vi.fn().mockResolvedValue(
      JSON.stringify({ found: true, priceYuan: 100.5, sourceUrl: null, note: null }),
    );
    await makeWatchRunNowHandler(chatFnNoAlert, { broadcast, notify })(db);
    expect(broadcast).toHaveBeenCalledTimes(1);
    expect(notify).not.toHaveBeenCalled();

    resetWatchStateForTest();

    // 有异动（价格翻倍）
    const chatFnAlert = vi.fn().mockResolvedValue(
      JSON.stringify({ found: true, priceYuan: 400, sourceUrl: null, note: null }),
    );
    await makeWatchRunNowHandler(chatFnAlert, { broadcast, notify })(db);
    expect(notify).toHaveBeenCalledTimes(1);
  });
});
