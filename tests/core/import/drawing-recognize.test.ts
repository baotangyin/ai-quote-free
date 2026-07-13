import { describe, it, expect, vi } from 'vitest';
import {
  recognizeDrawing,
  buildDrawingPrompt,
  type DrawingImage,
} from '../../../src/core/import/drawingRecognize';

const image: DrawingImage = { mediaType: 'image/png', base64: 'AAAA' };

describe('buildDrawingPrompt', () => {
  it('返回中文提示词，含关键规则', () => {
    const prompt = buildDrawingPrompt();
    expect(prompt).toContain('JSON 数组');
    expect(prompt).toContain('qty');
    expect(prompt).toContain('category');
    expect(prompt).toContain('size');
    expect(prompt).toContain('*2');
    expect(prompt).toContain('×2');
    expect(prompt).toContain('2台');
    expect(prompt).toContain('2套');
  });
});

describe('recognizeDrawing', () => {
  it('典型两图合并（含重名空间），逐图各请求一次', async () => {
    const chat = vi.fn();
    chat
      .mockResolvedValueOnce(
        JSON.stringify([
          {
            name: '多功能厅',
            items: [{ name: 'LED屏', category: 'LED屏', size: '65寸', qty: 2, remark: null }],
          },
        ]),
      )
      .mockResolvedValueOnce(
        JSON.stringify([
          {
            name: '多功能厅',
            items: [{ name: '音响', category: '音响', size: null, qty: 1, remark: '吊装' }],
          },
          {
            name: '接待区',
            items: [{ name: '摄像头', category: '摄像头', size: null, qty: 1, remark: null }],
          },
        ]),
      );

    const result = await recognizeDrawing(chat, [image, image]);

    expect(chat).toHaveBeenCalledTimes(2);
    expect(result.failedImages).toBe(0);
    expect(result.spaces).toEqual([
      {
        name: '多功能厅',
        items: [
          { name: 'LED屏', category: 'LED屏', size: '65寸', qty: 2, remark: null },
          { name: '音响', category: '音响', size: null, qty: 1, remark: '吊装' },
        ],
      },
      {
        name: '接待区',
        items: [{ name: '摄像头', category: '摄像头', size: null, qty: 1, remark: null }],
      },
    ]);
  });

  it('qty 归一化：非 number/NaN/<=0 归 1', async () => {
    const chat = vi.fn().mockResolvedValueOnce(
      JSON.stringify([
        {
          name: '大厅',
          items: [
            { name: 'A', category: null, size: null, qty: '3', remark: null },
            { name: 'B', category: null, size: null, qty: NaN, remark: null },
            { name: 'C', category: null, size: null, qty: 0, remark: null },
            { name: 'D', category: null, size: null, qty: -1, remark: null },
            { name: 'E', category: null, size: null, remark: null },
            { name: 'F', category: null, size: null, qty: 'abc', remark: null },
          ],
        },
      ]),
    );

    const result = await recognizeDrawing(chat, [image]);

    expect(result.spaces).toEqual([
      {
        name: '大厅',
        items: [
          { name: 'A', category: null, size: null, qty: 3, remark: null },
          { name: 'B', category: null, size: null, qty: 1, remark: null },
          { name: 'C', category: null, size: null, qty: 1, remark: null },
          { name: 'D', category: null, size: null, qty: 1, remark: null },
          { name: 'E', category: null, size: null, qty: 1, remark: null },
          { name: 'F', category: null, size: null, qty: 1, remark: null },
        ],
      },
    ]);
  });

  it('空名 item 丢弃；空 items 的空间保留', async () => {
    const chat = vi.fn().mockResolvedValueOnce(
      JSON.stringify([
        {
          name: '空房间',
          items: [],
        },
        {
          name: '走廊',
          items: [
            { name: '', category: null, size: null, qty: 1, remark: null },
            { name: '   ', category: null, size: null, qty: 1, remark: null },
            { name: '灯', category: null, size: null, qty: 1, remark: null },
          ],
        },
      ]),
    );

    const result = await recognizeDrawing(chat, [image]);

    expect(result.spaces).toEqual([
      { name: '空房间', items: [] },
      { name: '走廊', items: [{ name: '灯', category: null, size: null, qty: 1, remark: null }] },
    ]);
  });

  it('单图 chat 抛错，计 failedImages 且不中断其余图', async () => {
    const chat = vi
      .fn()
      .mockRejectedValueOnce(new Error('网络错误'))
      .mockResolvedValueOnce(
        JSON.stringify([{ name: '大厅', items: [{ name: 'A', category: null, size: null, qty: 1, remark: null }] }]),
      );

    const result = await recognizeDrawing(chat, [image, image]);

    expect(result.failedImages).toBe(1);
    expect(result.spaces).toEqual([
      { name: '大厅', items: [{ name: 'A', category: null, size: null, qty: 1, remark: null }] },
    ]);
  });

  it('单图返回破损 JSON，计 failedImages 且不中断', async () => {
    const chat = vi
      .fn()
      .mockResolvedValueOnce('这不是 JSON，抱歉无法识别')
      .mockResolvedValueOnce(
        JSON.stringify([{ name: '大厅', items: [] }]),
      );

    const result = await recognizeDrawing(chat, [image, image]);

    expect(result.failedImages).toBe(1);
    expect(result.spaces).toEqual([{ name: '大厅', items: [] }]);
  });

  it('顶层包裹容错：{spaces:[...]} 对象按 spaces 解包', async () => {
    const chat = vi.fn().mockResolvedValueOnce(
      JSON.stringify({
        spaces: [
          { name: '大厅', items: [{ name: 'A', category: null, size: null, qty: 1, remark: null }] },
        ],
      }),
    );

    const result = await recognizeDrawing(chat, [image]);

    expect(result.failedImages).toBe(0);
    expect(result.spaces).toEqual([
      { name: '大厅', items: [{ name: 'A', category: null, size: null, qty: 1, remark: null }] },
    ]);
  });

  it('顶层包裹容错：单个空间对象包成单元素数组', async () => {
    const chat = vi.fn().mockResolvedValueOnce(
      JSON.stringify({
        name: '大厅',
        items: [{ name: 'A', category: null, size: null, qty: 1, remark: null }],
      }),
    );

    const result = await recognizeDrawing(chat, [image]);

    expect(result.failedImages).toBe(0);
    expect(result.spaces).toEqual([
      { name: '大厅', items: [{ name: 'A', category: null, size: null, qty: 1, remark: null }] },
    ]);
  });

  it('全部失败：返回 spaces=[]，failedImages=N', async () => {
    const chat = vi
      .fn()
      .mockRejectedValueOnce(new Error('网络错误'))
      .mockRejectedValueOnce(new Error('超时'));

    const result = await recognizeDrawing(chat, [image, image]);

    expect(result.spaces).toEqual([]);
    expect(result.failedImages).toBe(2);
  });

  it('errors 收集：chat 抛错与 JSON 非法均计入，格式「第N张：{message}」', async () => {
    const chat = vi
      .fn()
      .mockRejectedValueOnce(new Error('网络错误'))
      .mockResolvedValueOnce('这不是 JSON')
      .mockResolvedValueOnce(
        JSON.stringify([{ name: '大厅', items: [] }]),
      );

    const result = await recognizeDrawing(chat, [image, image, image]);

    expect(result.failedImages).toBe(2);
    expect(result.errors).toHaveLength(2);
    expect(result.errors[0]).toMatch(/^第1张：/);
    expect(result.errors[0]).toContain('网络错误');
    expect(result.errors[1]).toMatch(/^第2张：/);
  });

  it('全部成功时 errors 为空数组', async () => {
    const chat = vi.fn().mockResolvedValueOnce(
      JSON.stringify([{ name: '大厅', items: [] }]),
    );

    const result = await recognizeDrawing(chat, [image]);

    expect(result.errors).toEqual([]);
  });
});
