import { describe, it, expect, vi } from 'vitest';
import {
  buildScreenshotProductPrompt,
  recognizeScreenshotProduct,
} from '../../../src/core/ai/screenshotProduct';
import type { VisionChatFn } from '../../../src/core/import/drawingRecognize';

const image = { mediaType: 'image/jpeg' as const, base64: 'AAAA' };

function jsonReply(obj: unknown): string {
  return JSON.stringify(obj);
}

describe('buildScreenshotProductPrompt', () => {
  it('要求严格 JSON，禁止编造', () => {
    const prompt = buildScreenshotProductPrompt();
    expect(prompt).toContain('JSON');
    expect(prompt).toContain('found');
    expect(prompt).toContain('禁止编造');
  });
});

describe('recognizeScreenshotProduct', () => {
  it('典型情形：found=true 时透传各字段，priceYuan 保留为元（不做分转换）', async () => {
    const chat: VisionChatFn = vi.fn().mockResolvedValue(
      jsonReply({
        found: true,
        name: '55寸拼接屏',
        brand: '海康威视',
        model: 'DS-D5055',
        category: '拼接屏',
        dims: '1920×1080mm',
        unit: '台',
        paramsCore: '分辨率：1920×1080\n亮度：500cd/㎡',
        priceYuan: 1234.56,
        note: null,
      }),
    );
    const result = await recognizeScreenshotProduct(chat, image);
    expect(result.found).toBe(true);
    expect(result.name).toBe('55寸拼接屏');
    expect(result.brand).toBe('海康威视');
    expect(result.model).toBe('DS-D5055');
    expect(result.category).toBe('拼接屏');
    expect(result.dims).toBe('1920×1080mm');
    expect(result.unit).toBe('台');
    expect(result.paramsCore).toBe('分辨率：1920×1080\n亮度：500cd/㎡');
    expect(result.priceYuan).toBe(1234.56);
  });

  it('传给 chat 的消息含图片内容块', async () => {
    const chat: VisionChatFn = vi.fn().mockResolvedValue(
      jsonReply({ found: true, name: 'A', brand: null, model: null, category: null, dims: null, unit: null, paramsCore: null, priceYuan: null, note: null }),
    );
    await recognizeScreenshotProduct(chat, image);
    const messages = (chat as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const content = messages[0].content;
    expect(Array.isArray(content)).toBe(true);
    expect(content.some((p: { type: string }) => p.type === 'image')).toBe(true);
  });

  it('破损 JSON 时抛出异常', async () => {
    const chat: VisionChatFn = vi.fn().mockResolvedValue('这不是 JSON，抱歉我编不出来');
    await expect(recognizeScreenshotProduct(chat, image)).rejects.toThrow();
  });

  it('found=false 时所有字段均为 null', async () => {
    const chat: VisionChatFn = vi.fn().mockResolvedValue(
      jsonReply({ found: false, name: null, brand: null, model: null, category: null, dims: null, unit: null, paramsCore: null, priceYuan: null, note: '截图模糊看不清产品信息' }),
    );
    const result = await recognizeScreenshotProduct(chat, image);
    expect(result.found).toBe(false);
    expect(result.name).toBeNull();
    expect(result.brand).toBeNull();
    expect(result.model).toBeNull();
    expect(result.category).toBeNull();
    expect(result.dims).toBeNull();
    expect(result.unit).toBeNull();
    expect(result.paramsCore).toBeNull();
    expect(result.priceYuan).toBeNull();
    expect(result.note).toBe('截图模糊看不清产品信息');
  });

  it('found 缺失或非布尔时抛出异常', async () => {
    const chat: VisionChatFn = vi.fn().mockResolvedValue(jsonReply({ name: 'A' }));
    await expect(recognizeScreenshotProduct(chat, image)).rejects.toThrow();
  });

  it('价格非正（0）时置为 null，但其余产品信息字段保留——产品信息不因价格丢整体', async () => {
    const chat: VisionChatFn = vi.fn().mockResolvedValue(
      jsonReply({ found: true, name: '55寸拼接屏', brand: '海康威视', model: 'DS-D5055', category: '拼接屏', dims: null, unit: '台', paramsCore: '分辨率：1920×1080', priceYuan: 0, note: null }),
    );
    const result = await recognizeScreenshotProduct(chat, image);
    expect(result.found).toBe(true);
    expect(result.priceYuan).toBeNull();
    expect(result.name).toBe('55寸拼接屏');
    expect(result.brand).toBe('海康威视');
    expect(result.category).toBe('拼接屏');
    expect(result.paramsCore).toBe('分辨率：1920×1080');
  });

  it('价格非正（负数）时置为 null，其余字段保留', async () => {
    const chat: VisionChatFn = vi.fn().mockResolvedValue(
      jsonReply({ found: true, name: 'A', brand: null, model: null, category: null, dims: null, unit: null, paramsCore: null, priceYuan: -10, note: null }),
    );
    const result = await recognizeScreenshotProduct(chat, image);
    expect(result.found).toBe(true);
    expect(result.priceYuan).toBeNull();
    expect(result.name).toBe('A');
  });

  it('价格字段非 number 类型（如字符串）时置为 null', async () => {
    const chat: VisionChatFn = vi.fn().mockResolvedValue(
      jsonReply({ found: true, name: 'A', brand: null, model: null, category: null, dims: null, unit: null, paramsCore: null, priceYuan: '不是数字', note: null }),
    );
    const result = await recognizeScreenshotProduct(chat, image);
    expect(result.found).toBe(true);
    expect(result.priceYuan).toBeNull();
  });
});
