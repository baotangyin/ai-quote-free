import { describe, it, expect, vi } from 'vitest';
import { parseTemplateFromGrid, type ChatFn } from '../../../src/core/import/templateFromXlsx';
import type { ChatMessage } from '../../../src/core/ai/client';

function smallGrid(): string[][] {
  return [
    ['序号', '品名', '单位', '数量', '单价', '总价', '附注', '交期'],
    ['1', '46寸拼接屏', '台', '2', '5000', '10000', '含税', '15天'],
  ];
}

describe('parseTemplateFromGrid', () => {
  it('组装典型 AI 输出为 config + ignoredColumns（含 2 个未知/未映射列）', async () => {
    const aiResponse = {
      title: '东风工程报价单',
      companyName: '东风科技有限公司',
      headerRowIndex: 0,
      columns: [
        { sourceLabel: '序号', mappedKey: 'xh' },
        { sourceLabel: '品名', mappedKey: 'name' },
        { sourceLabel: '单位', mappedKey: 'unit' },
        { sourceLabel: '数量', mappedKey: 'qty' },
        { sourceLabel: '单价', mappedKey: 'unitPrice' },
        { sourceLabel: '总价', mappedKey: 'total' },
        { sourceLabel: '附注', mappedKey: null },
        { sourceLabel: '交期', mappedKey: 'notARealKey' },
      ],
      summaryLabels: ['总价'],
    };
    const chat: ChatFn = vi.fn().mockResolvedValue(JSON.stringify(aiResponse));

    const draft = await parseTemplateFromGrid(smallGrid(), chat);

    expect(chat).toHaveBeenCalledTimes(1);
    expect(draft.ignoredColumns).toEqual(['附注', '交期']);

    const { config } = draft;
    expect(config.header.detailTitle).toBe('东风工程报价单');
    expect(config.header.companyName).toBe('东风科技有限公司');
    expect(config.versions).toHaveLength(1);
    const v = config.versions[0];
    expect(v.key).toBe('v1');
    expect(v.name).toBe('客户格式');
    expect(v.includeSummarySheet).toBe(false);
    expect(v.columns).toEqual([
      { key: 'xh', label: null, width: null }, // 系统默认名「序号」与来源同名 -> null
      { key: 'name', label: '品名', width: null }, // 系统默认名「项目名称」不同 -> 保留来源名
      { key: 'unit', label: null, width: null }, // 「单位」同名
      { key: 'qty', label: null, width: null }, // 「数量」同名
      { key: 'unitPrice', label: null, width: null }, // 「单价」同名
      { key: 'total', label: '总价', width: null }, // 系统默认名「合计」不同 -> 保留来源名
    ]);
  });

  it('AI 输出无法解析为 JSON 时抛中文错误', async () => {
    const chat: ChatFn = vi.fn().mockResolvedValue('这不是 JSON，抱歉无法识别表格结构。');
    await expect(parseTemplateFromGrid(smallGrid(), chat)).rejects.toThrow('AI输出无法解析');
  });

  it('全部列均无法映射时抛「未能从文件中识别出任何可映射的列」', async () => {
    const aiResponse = {
      title: null,
      companyName: null,
      headerRowIndex: 0,
      columns: [
        { sourceLabel: '附注', mappedKey: null },
        { sourceLabel: '交期', mappedKey: 'notARealKey' },
      ],
      summaryLabels: [],
    };
    const chat: ChatFn = vi.fn().mockResolvedValue(JSON.stringify(aiResponse));
    await expect(parseTemplateFromGrid(smallGrid(), chat)).rejects.toThrow(
      '未能从文件中识别出任何可映射的列',
    );
  });

  it('grid 超过 30 行时截断为前 30 行再发给 AI', async () => {
    const header = ['序号', '名称'];
    const bodyRows = Array.from({ length: 40 }, (_, i) => [`${i + 1}`, `产品${i + 1}`]);
    const grid = [header, ...bodyRows];

    let capturedMessages: ChatMessage[] = [];
    const aiResponse = {
      title: null,
      companyName: null,
      headerRowIndex: 0,
      columns: [{ sourceLabel: '序号', mappedKey: 'xh' }],
      summaryLabels: [],
    };
    const chat: ChatFn = vi.fn().mockImplementation(async (messages: ChatMessage[]) => {
      capturedMessages = messages;
      return JSON.stringify(aiResponse);
    });

    await parseTemplateFromGrid(grid, chat);

    const userMsg = capturedMessages.find((m) => m.role === 'user')!;
    expect(userMsg.content).toContain('产品1\n'); // 第 1 行数据仍在
    expect(userMsg.content).toContain('产品29'); // 第 30 行（含表头共 30 行 -> 29 条数据行）
    expect(userMsg.content).not.toContain('产品30'); // 超出前 30 行的数据已被截断
  });
});
