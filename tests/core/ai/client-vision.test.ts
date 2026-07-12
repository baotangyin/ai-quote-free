import { describe, it, expect, vi } from 'vitest';
import {
  chatComplete,
  type AiConfig,
  type ChatMessage,
  type ChatContentPart,
} from '../../../src/core/ai/client';

function jsonResponse(status: number, body: unknown): Response {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => text,
    json: async () => JSON.parse(text),
  } as unknown as Response;
}

function fakeFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
    handler(String(input), init),
  );
}

const openaiCfg: AiConfig = {
  protocol: 'openai',
  baseUrl: 'https://api.deepseek.com',
  apiKey: 'sk-test-key',
  model: 'deepseek-chat',
};

const anthropicCfg: AiConfig = {
  protocol: 'anthropic',
  baseUrl: 'https://api.anthropic.com',
  apiKey: 'ak-test-key',
  model: 'claude-3-5-sonnet',
};

const parts: ChatContentPart[] = [
  { type: 'text', text: '请识别这张图纸' },
  { type: 'image', mediaType: 'image/png', base64: 'ZmFrZS1iYXNlNjQtZGF0YQ==' },
];

describe('chatComplete - openai 协议 - 视觉输入', () => {
  it('content 为 string 时原样传递（向后兼容）', async () => {
    const fetchImpl = fakeFetch(() =>
      jsonResponse(200, { choices: [{ message: { content: 'ok' } }] }),
    );
    const messages: ChatMessage[] = [{ role: 'user', content: '纯文本消息' }];
    await chatComplete(openaiCfg, messages, { fetchImpl });
    const [, init] = fetchImpl.mock.calls[0];
    const body = JSON.parse(init?.body as string);
    expect(body.messages).toEqual([{ role: 'user', content: '纯文本消息' }]);
  });

  it('content 为 ChatContentPart[] 时映射为 text/image_url 结构，data URL 拼接正确', async () => {
    const fetchImpl = fakeFetch(() =>
      jsonResponse(200, { choices: [{ message: { content: 'ok' } }] }),
    );
    const messages: ChatMessage[] = [{ role: 'user', content: parts }];
    await chatComplete(openaiCfg, messages, { fetchImpl });
    const [, init] = fetchImpl.mock.calls[0];
    const body = JSON.parse(init?.body as string);
    expect(body.messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: '请识别这张图纸' },
          {
            type: 'image_url',
            image_url: { url: 'data:image/png;base64,ZmFrZS1iYXNlNjQtZGF0YQ==' },
          },
        ],
      },
    ]);
  });
});

describe('chatComplete - anthropic 协议 - 视觉输入', () => {
  it('content 为 string 时原样传递（向后兼容）', async () => {
    const fetchImpl = fakeFetch(() =>
      jsonResponse(200, { content: [{ type: 'text', text: 'ok' }] }),
    );
    const messages: ChatMessage[] = [
      { role: 'system', content: '你是识图助手' },
      { role: 'user', content: '纯文本消息' },
    ];
    await chatComplete(anthropicCfg, messages, { fetchImpl });
    const [, init] = fetchImpl.mock.calls[0];
    const body = JSON.parse(init?.body as string);
    expect(body.system).toBe('你是识图助手');
    expect(body.messages).toEqual([{ role: 'user', content: '纯文本消息' }]);
  });

  it('content 为 ChatContentPart[] 时映射为 text/image (base64 source) 结构', async () => {
    const fetchImpl = fakeFetch(() =>
      jsonResponse(200, { content: [{ type: 'text', text: 'ok' }] }),
    );
    const messages: ChatMessage[] = [
      { role: 'system', content: '你是识图助手' },
      { role: 'user', content: parts },
    ];
    await chatComplete(anthropicCfg, messages, { fetchImpl });
    const [, init] = fetchImpl.mock.calls[0];
    const body = JSON.parse(init?.body as string);
    expect(body.system).toBe('你是识图助手');
    expect(body.messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: '请识别这张图纸' },
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: 'image/png',
              data: 'ZmFrZS1iYXNlNjQtZGF0YQ==',
            },
          },
        ],
      },
    ]);
  });
});
