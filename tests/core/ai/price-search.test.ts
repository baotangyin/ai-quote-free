import { describe, it, expect, vi } from 'vitest';
import { openDb, type Db } from '../../../src/core/db/db';
import { createProduct } from '../../../src/core/repo/products';
import { addPriceRecord, listPriceRecords, getEffectiveCost } from '../../../src/core/repo/prices';
import {
  buildPriceSearchPrompt,
  searchPrice,
  runPriceWatchRound,
} from '../../../src/core/ai/priceSearch';
import type { VisionChatFn } from '../../../src/core/import/drawingRecognize';

function makeDbWithProduct(watchPrice = true) {
  const db: Db = openDb(':memory:');
  const p = createProduct(db, { category: '拼接屏', name: '55寸拼接屏', unit: '台', watchPrice });
  return { db, product: p };
}

function jsonReply(obj: unknown): string {
  return JSON.stringify(obj);
}

describe('buildPriceSearchPrompt', () => {
  it('包含产品名称，要求严格 JSON', () => {
    const { product } = makeDbWithProduct();
    const prompt = buildPriceSearchPrompt(product);
    expect(prompt).toContain(product.name);
    expect(prompt).toContain('JSON');
  });
});

describe('searchPrice', () => {
  it('found=true 时把 priceYuan 转换为分（Math.round）', async () => {
    const { product } = makeDbWithProduct();
    const chat: VisionChatFn = vi.fn().mockResolvedValue(
      jsonReply({ found: true, priceYuan: 1234.567, sourceUrl: 'https://a.com', note: null }),
    );
    const result = await searchPrice(chat, product);
    expect(result.found).toBe(true);
    expect(result.priceCents).toBe(Math.round(1234.567 * 100));
    expect(result.sourceUrl).toBe('https://a.com');
  });

  it('found=false 时 priceCents 为 null', async () => {
    const { product } = makeDbWithProduct();
    const chat: VisionChatFn = vi.fn().mockResolvedValue(
      jsonReply({ found: false, priceYuan: null, sourceUrl: null, note: '未找到可靠来源' }),
    );
    const result = await searchPrice(chat, product);
    expect(result.found).toBe(false);
    expect(result.priceCents).toBeNull();
    expect(result.note).toBe('未找到可靠来源');
  });

  it('破损 JSON 时抛出异常', async () => {
    const { product } = makeDbWithProduct();
    const chat: VisionChatFn = vi.fn().mockResolvedValue('这不是 JSON，抱歉我编不出来');
    await expect(searchPrice(chat, product)).rejects.toThrow();
  });
});

describe('runPriceWatchRound', () => {
  it('found=true 且通过护栏：入库 price_records，updated++', async () => {
    const { db, product } = makeDbWithProduct();
    const chat: VisionChatFn = vi.fn().mockResolvedValue(
      jsonReply({ found: true, priceYuan: 2000, sourceUrl: 'https://s.com/p', note: null }),
    );
    const summary = await runPriceWatchRound(db, chat, { costRule: 'latest', alertRate: 0.2, delayMs: 0 });
    expect(summary.checked).toBe(1);
    expect(summary.updated).toBe(1);
    expect(summary.failed).toBe(0);
    expect(summary.skipped).toBe(0);
    const records = listPriceRecords(db, product.id);
    expect(records).toHaveLength(1);
    expect(records[0].priceCents).toBe(200000);
    expect(records[0].source).toBe('ai_search');
    expect(records[0].sourceUrl).toBe('https://s.com/p');
  });

  it('新价 >20 倍历史有效成本时护栏丢弃，计入 failed，不入库', async () => {
    const { db, product } = makeDbWithProduct();
    // 历史有效成本 1000 元 = 100000 分
    addPriceRecord(db, { productId: product.id, source: 'manual', priceCents: 100000, capturedAt: '2026-01-01' });
    // AI 报价 21000 元 = 21 倍，超过 20 倍护栏
    const chat: VisionChatFn = vi.fn().mockResolvedValue(
      jsonReply({ found: true, priceYuan: 21000, sourceUrl: null, note: null }),
    );
    const summary = await runPriceWatchRound(db, chat, { costRule: 'latest', alertRate: 0.2, delayMs: 0 });
    expect(summary.failed).toBe(1);
    expect(summary.updated).toBe(0);
    const records = listPriceRecords(db, product.id);
    expect(records).toHaveLength(1); // 仍只有历史那条，新条被护栏丢弃
  });

  it('新价 <1/20 历史有效成本时护栏丢弃，计入 failed，不入库', async () => {
    const { db, product } = makeDbWithProduct();
    addPriceRecord(db, { productId: product.id, source: 'manual', priceCents: 100000, capturedAt: '2026-01-01' });
    const chat: VisionChatFn = vi.fn().mockResolvedValue(
      jsonReply({ found: true, priceYuan: 40, sourceUrl: null, note: null }), // 4000分, <1/20*100000=5000
    );
    const summary = await runPriceWatchRound(db, chat, { costRule: 'latest', alertRate: 0.2, delayMs: 0 });
    expect(summary.failed).toBe(1);
    expect(summary.updated).toBe(0);
  });

  it('priceYuan 非正时护栏丢弃，计入 failed', async () => {
    const { db, product } = makeDbWithProduct();
    const chat: VisionChatFn = vi.fn().mockResolvedValue(
      jsonReply({ found: true, priceYuan: 0, sourceUrl: null, note: null }),
    );
    const summary = await runPriceWatchRound(db, chat, { costRule: 'latest', alertRate: 0.2, delayMs: 0 });
    expect(summary.failed).toBe(1);
    expect(summary.updated).toBe(0);
    expect(listPriceRecords(db, product.id)).toHaveLength(0);
  });

  it('破损 JSON 计入 failed，不中断整轮', async () => {
    const { db } = makeDbWithProduct();
    const chat: VisionChatFn = vi.fn().mockResolvedValue('乱七八糟不是JSON');
    const summary = await runPriceWatchRound(db, chat, { costRule: 'latest', alertRate: 0.2, delayMs: 0 });
    expect(summary.failed).toBe(1);
    expect(summary.updated).toBe(0);
    expect(summary.skipped).toBe(0);
  });

  it('found=false 计入 skipped，不入库', async () => {
    const { db, product } = makeDbWithProduct();
    const chat: VisionChatFn = vi.fn().mockResolvedValue(
      jsonReply({ found: false, priceYuan: null, sourceUrl: null, note: '搜不到' }),
    );
    const summary = await runPriceWatchRound(db, chat, { costRule: 'latest', alertRate: 0.2, delayMs: 0 });
    expect(summary.skipped).toBe(1);
    expect(summary.updated).toBe(0);
    expect(summary.failed).toBe(0);
    expect(listPriceRecords(db, product.id)).toHaveLength(0);
  });

  it('异动判定：变化率超过阈值计入 alerts，基线取插入前 getEffectiveCost', async () => {
    const { db, product } = makeDbWithProduct();
    addPriceRecord(db, { productId: product.id, source: 'manual', priceCents: 100000, capturedAt: '2026-01-01' });
    const beforeOld = getEffectiveCost(db, product.id, 'latest');
    expect(beforeOld).toBe(100000);
    // 新价 130000（涨 30%），alertRate=0.2 → 触发 alert
    const chat: VisionChatFn = vi.fn().mockResolvedValue(
      jsonReply({ found: true, priceYuan: 1300, sourceUrl: null, note: null }),
    );
    const summary = await runPriceWatchRound(db, chat, { costRule: 'latest', alertRate: 0.2, delayMs: 0 });
    expect(summary.updated).toBe(1);
    expect(summary.alerts).toHaveLength(1);
    expect(summary.alerts[0]).toMatchObject({
      productId: product.id,
      name: product.name,
      oldCents: 100000,
      newCents: 130000,
    });
    expect(summary.alerts[0].changeRate).toBeCloseTo(0.3, 5);
  });

  it('异动判定：变化率未超阈值不计入 alerts', async () => {
    const { db, product } = makeDbWithProduct();
    addPriceRecord(db, { productId: product.id, source: 'manual', priceCents: 100000, capturedAt: '2026-01-01' });
    const chat: VisionChatFn = vi.fn().mockResolvedValue(
      jsonReply({ found: true, priceYuan: 1050, sourceUrl: null, note: null }), // 涨 5%
    );
    const summary = await runPriceWatchRound(db, chat, { costRule: 'latest', alertRate: 0.2, delayMs: 0 });
    expect(summary.updated).toBe(1);
    expect(summary.alerts).toHaveLength(0);
  });

  it('异动判定：历史成本为 null（无记录）时跳过判定，不计入 alerts 也不误杀护栏', async () => {
    const { db, product } = makeDbWithProduct();
    expect(getEffectiveCost(db, product.id, 'latest')).toBeNull();
    const chat: VisionChatFn = vi.fn().mockResolvedValue(
      jsonReply({ found: true, priceYuan: 99999, sourceUrl: null, note: null }), // 数字很大但无历史，不该被护栏误杀
    );
    const summary = await runPriceWatchRound(db, chat, { costRule: 'latest', alertRate: 0.2, delayMs: 0 });
    expect(summary.updated).toBe(1);
    expect(summary.failed).toBe(0);
    expect(summary.alerts).toHaveLength(0);
  });

  it('单产品 chat 异常不中断整轮，其余产品继续处理', async () => {
    const db: Db = openDb(':memory:');
    const p1 = createProduct(db, { category: 'A', name: '产品甲', unit: '台', watchPrice: true });
    const p2 = createProduct(db, { category: 'A', name: '产品乙', unit: '台', watchPrice: true });
    const chat: VisionChatFn = vi.fn().mockImplementation(async (messages) => {
      const text = typeof messages[0].content === 'string' ? messages[0].content : '';
      if (text.includes('产品甲')) {
        throw new Error('网络异常');
      }
      return jsonReply({ found: true, priceYuan: 500, sourceUrl: null, note: null });
    });
    const summary = await runPriceWatchRound(db, chat, { costRule: 'latest', alertRate: 0.2, delayMs: 0 });
    expect(summary.checked).toBe(2);
    expect(summary.failed).toBe(1);
    expect(summary.updated).toBe(1);
    expect(listPriceRecords(db, p1.id)).toHaveLength(0);
    expect(listPriceRecords(db, p2.id)).toHaveLength(1);
  });

  it('summary 计数完整覆盖 checked/updated/failed/skipped 且带 finishedAt', async () => {
    const db: Db = openDb(':memory:');
    const pOk = createProduct(db, { category: 'A', name: '正常产品', unit: '台', watchPrice: true });
    const pSkip = createProduct(db, { category: 'A', name: '跳过产品', unit: '台', watchPrice: true });
    const pFail = createProduct(db, { category: 'A', name: '失败产品', unit: '台', watchPrice: true });
    const chat: VisionChatFn = vi.fn().mockImplementation(async (messages) => {
      const text = typeof messages[0].content === 'string' ? messages[0].content : '';
      if (text.includes('跳过产品')) {
        return jsonReply({ found: false, priceYuan: null, sourceUrl: null, note: null });
      }
      if (text.includes('失败产品')) {
        return '坏JSON';
      }
      return jsonReply({ found: true, priceYuan: 800, sourceUrl: null, note: null });
    });
    const summary = await runPriceWatchRound(db, chat, { costRule: 'latest', alertRate: 0.2, delayMs: 0 });
    expect(summary.checked).toBe(3);
    expect(summary.updated).toBe(1);
    expect(summary.skipped).toBe(1);
    expect(summary.failed).toBe(1);
    expect(typeof summary.finishedAt).toBe('string');
    expect(listPriceRecords(db, pOk.id)).toHaveLength(1);
    expect(listPriceRecords(db, pSkip.id)).toHaveLength(0);
    expect(listPriceRecords(db, pFail.id)).toHaveLength(0);
  });

  it('不监控（watchPrice=false）的产品不被遍历', async () => {
    const { db } = makeDbWithProduct(false);
    const chat: VisionChatFn = vi.fn();
    const summary = await runPriceWatchRound(db, chat, { costRule: 'latest', alertRate: 0.2, delayMs: 0 });
    expect(summary.checked).toBe(0);
    expect(chat).not.toHaveBeenCalled();
  });
});
