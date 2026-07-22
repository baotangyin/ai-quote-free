import { describe, it, expect, vi } from 'vitest';
import {
  buildScreenshotPricePrompt,
  recognizeScreenshotPrice,
} from '../../../src/core/ai/screenshotPrice';
import type { VisionChatFn } from '../../../src/core/import/drawingRecognize';

const image = { mediaType: 'image/jpeg' as const, base64: 'AAAA' };

function jsonReply(obj: unknown): string {
  return JSON.stringify(obj);
}

describe('buildScreenshotPricePrompt', () => {
  it('要求严格 JSON，禁止编造', () => {
    const prompt = buildScreenshotPricePrompt();
    expect(prompt).toContain('JSON');
    expect(prompt).toContain('found');
    expect(prompt).toContain('禁止编造');
  });
});

describe('recognizeScreenshotPrice', () => {
  it('found=true 时把 priceYuan 转换为分（Math.round），并透传其余字段', async () => {
    const chat: VisionChatFn = vi.fn().mockResolvedValue(
      jsonReply({ found: true, name: '55寸拼接屏', spec: 'P2.5', priceYuan: 1234.567, shop: '某旗舰店', note: null }),
    );
    const result = await recognizeScreenshotPrice(chat, image);
    expect(result.found).toBe(true);
    expect(result.name).toBe('55寸拼接屏');
    expect(result.spec).toBe('P2.5');
    expect(result.priceCents).toBe(Math.round(1234.567 * 100));
    expect(result.shop).toBe('某旗舰店');
  });

  it('传给 chat 的消息含图片内容块', async () => {
    const chat: VisionChatFn = vi.fn().mockResolvedValue(
      jsonReply({ found: true, name: 'A', spec: null, priceYuan: 100, shop: null, note: null }),
    );
    await recognizeScreenshotPrice(chat, image);
    const messages = (chat as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const content = messages[0].content;
    expect(Array.isArray(content)).toBe(true);
    expect(content.some((p: { type: string }) => p.type === 'image')).toBe(true);
  });

  it('found=false 时各字段均为 null', async () => {
    const chat: VisionChatFn = vi.fn().mockResolvedValue(
      jsonReply({ found: false, name: null, spec: null, priceYuan: null, shop: null, note: '截图模糊看不清价格' }),
    );
    const result = await recognizeScreenshotPrice(chat, image);
    expect(result.found).toBe(false);
    expect(result.priceCents).toBeNull();
    expect(result.name).toBeNull();
    expect(result.note).toBe('截图模糊看不清价格');
  });

  it('破损 JSON 时抛出异常', async () => {
    const chat: VisionChatFn = vi.fn().mockResolvedValue('这不是 JSON，抱歉我编不出来');
    await expect(recognizeScreenshotPrice(chat, image)).rejects.toThrow();
  });

  it('found=true 但价格非正时拒绝（抛异常）', async () => {
    const chat: VisionChatFn = vi.fn().mockResolvedValue(
      jsonReply({ found: true, name: 'A', spec: null, priceYuan: 0, shop: null, note: null }),
    );
    await expect(recognizeScreenshotPrice(chat, image)).rejects.toThrow();
  });

  it('found=true 但价格为负时拒绝（抛异常）', async () => {
    const chat: VisionChatFn = vi.fn().mockResolvedValue(
      jsonReply({ found: true, name: 'A', spec: null, priceYuan: -10, shop: null, note: null }),
    );
    await expect(recognizeScreenshotPrice(chat, image)).rejects.toThrow();
  });

  it('found 缺失或非布尔时抛出异常', async () => {
    const chat: VisionChatFn = vi.fn().mockResolvedValue(jsonReply({ name: 'A' }));
    await expect(recognizeScreenshotPrice(chat, image)).rejects.toThrow();
  });
});
