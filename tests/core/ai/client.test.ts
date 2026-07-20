import { describe, it, expect, vi } from 'vitest';
import { chatComplete, testConnection, type AiConfig, type ChatMessage } from '../../../src/core/ai/client';

function jsonResponse(status: number, body: unknown): Response {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => text,
    json: async () => JSON.parse(text),
  } as unknown as Response;
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

const messages: ChatMessage[] = [
  { role: 'system', content: '你是报价单识别助手' },
  { role: 'user', content: '请识别这份报价单' },
];

function fakeFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
    handler(String(input), init),
  );
}

describe('chatComplete - openai 协议', () => {
  it('POST {baseUrl}/chat/completions，Bearer 鉴权，body 含 model/messages/max_tokens', async () => {
    const fetchImpl = fakeFetch(() =>
      jsonResponse(200, { choices: [{ message: { content: '识别结果文本' } }] }),
    );

    const result = await chatComplete(openaiCfg, messages, { fetchImpl, maxTokens: 2048 });

    expect(result).toBe('识别结果文本');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api.deepseek.com/chat/completions');
    expect(init?.method).toBe('POST');
    const headers = init?.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer sk-test-key');
    expect(headers['Content-Type']).toBe('application/json');
    const body = JSON.parse(init?.body as string);
    expect(body).toEqual({
      model: 'deepseek-chat',
      messages,
      max_tokens: 2048,
    });
  });

  it('baseUrl 末尾带斜杠时归一，不产生双斜杠', async () => {
    const fetchImpl = fakeFetch(() =>
      jsonResponse(200, { choices: [{ message: { content: 'ok' } }] }),
    );
    const cfg: AiConfig = { ...openaiCfg, baseUrl: 'https://api.deepseek.com/' };
    await chatComplete(cfg, messages, { fetchImpl });
    const [url] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api.deepseek.com/chat/completions');
  });

  it('baseUrl 带 /v1 时按原样拼接（不额外处理，仅去末尾斜杠）', async () => {
    const fetchImpl = fakeFetch(() =>
      jsonResponse(200, { choices: [{ message: { content: 'ok' } }] }),
    );
    const cfg: AiConfig = { ...openaiCfg, baseUrl: 'https://api.deepseek.com/v1/' };
    await chatComplete(cfg, messages, { fetchImpl });
    const [url] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api.deepseek.com/v1/chat/completions');
  });

  it('未指定 maxTokens 时使用默认值', async () => {
    const fetchImpl = fakeFetch(() =>
      jsonResponse(200, { choices: [{ message: { content: 'ok' } }] }),
    );
    await chatComplete(openaiCfg, messages, { fetchImpl });
    const [, init] = fetchImpl.mock.calls[0];
    const body = JSON.parse(init?.body as string);
    expect(typeof body.max_tokens).toBe('number');
    expect(body.max_tokens).toBeGreaterThan(0);
  });

  it('非 2xx 响应抛错，错误信息含状态码与响应体前200字', async () => {
    const longBody = 'x'.repeat(300);
    const fetchImpl = fakeFetch(() => jsonResponse(500, longBody));
    await expect(chatComplete(openaiCfg, messages, { fetchImpl })).rejects.toThrow();
    try {
      await chatComplete(openaiCfg, messages, { fetchImpl });
      expect.unreachable();
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain('500');
      expect(msg).toContain('x'.repeat(200));
      expect(msg).not.toContain('x'.repeat(201));
    }
  });

  it('网络错误原样抛出', async () => {
    const netError = new Error('network down');
    const fetchImpl = fakeFetch(() => {
      throw netError;
    });
    await expect(chatComplete(openaiCfg, messages, { fetchImpl })).rejects.toBe(netError);
  });
});

describe('chatComplete - anthropic 协议', () => {
  it('POST {baseUrl}/v1/messages，x-api-key + anthropic-version，system 提升为顶层字段', async () => {
    const fetchImpl = fakeFetch(() =>
      jsonResponse(200, { content: [{ type: 'text', text: '识别结果文本' }] }),
    );

    const result = await chatComplete(anthropicCfg, messages, { fetchImpl, maxTokens: 1024 });

    expect(result).toBe('识别结果文本');
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(init?.method).toBe('POST');
    const headers = init?.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('ak-test-key');
    expect(headers['anthropic-version']).toBe('2023-06-01');
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['Authorization']).toBeUndefined();

    const body = JSON.parse(init?.body as string);
    expect(body.model).toBe('claude-3-5-sonnet');
    expect(body.max_tokens).toBe(1024);
    expect(body.system).toBe('你是报价单识别助手');
    expect(body.messages).toEqual([{ role: 'user', content: '请识别这份报价单' }]);
  });

  it('baseUrl 末尾带斜杠时归一', async () => {
    const fetchImpl = fakeFetch(() =>
      jsonResponse(200, { content: [{ type: 'text', text: 'ok' }] }),
    );
    const cfg: AiConfig = { ...anthropicCfg, baseUrl: 'https://api.anthropic.com/' };
    await chatComplete(cfg, messages, { fetchImpl });
    const [url] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
  });

  it('非 2xx 响应抛错，含状态码与响应体前200字', async () => {
    const longBody = 'y'.repeat(300);
    const fetchImpl = fakeFetch(() => jsonResponse(401, longBody));
    try {
      await chatComplete(anthropicCfg, messages, { fetchImpl });
      expect.unreachable();
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain('401');
      expect(msg).toContain('y'.repeat(200));
    }
  });

  it('网络错误原样抛出', async () => {
    const netError = new Error('boom');
    const fetchImpl = fakeFetch(() => {
      throw netError;
    });
    await expect(chatComplete(anthropicCfg, messages, { fetchImpl })).rejects.toBe(netError);
  });
});

describe('chatComplete - extraBody 合并', () => {
  it('openai 协议：extraBody 与标准字段浅合并，标准字段优先（不被 extraBody 覆盖）', async () => {
    const fetchImpl = fakeFetch(() =>
      jsonResponse(200, { choices: [{ message: { content: 'ok' } }] }),
    );
    await chatComplete(openaiCfg, messages, {
      fetchImpl,
      maxTokens: 999,
      extraBody: { enable_search: true, model: 'should-be-overridden', max_tokens: -1 },
    });
    const [, init] = fetchImpl.mock.calls[0];
    const body = JSON.parse(init?.body as string);
    expect(body.enable_search).toBe(true);
    expect(body.model).toBe('deepseek-chat');
    expect(body.max_tokens).toBe(999);
    expect(body.messages).toEqual(messages);
  });

  it('anthropic 协议：extraBody 与标准字段浅合并，标准字段优先', async () => {
    const fetchImpl = fakeFetch(() =>
      jsonResponse(200, { content: [{ type: 'text', text: 'ok' }] }),
    );
    await chatComplete(anthropicCfg, messages, {
      fetchImpl,
      maxTokens: 777,
      extraBody: { tools: [{ type: 'web_search' }], max_tokens: -1 },
    });
    const [, init] = fetchImpl.mock.calls[0];
    const body = JSON.parse(init?.body as string);
    expect(body.tools).toEqual([{ type: 'web_search' }]);
    expect(body.max_tokens).toBe(777);
    expect(body.model).toBe('claude-3-5-sonnet');
  });

  it('未传 extraBody 时请求体不受影响', async () => {
    const fetchImpl = fakeFetch(() =>
      jsonResponse(200, { choices: [{ message: { content: 'ok' } }] }),
    );
    await chatComplete(openaiCfg, messages, { fetchImpl });
    const [, init] = fetchImpl.mock.calls[0];
    const body = JSON.parse(init?.body as string);
    expect(body).toEqual({
      model: 'deepseek-chat',
      messages,
      max_tokens: expect.any(Number),
    });
  });
});

describe('testConnection', () => {
  it('能拿到任意响应即返回 true（openai）', async () => {
    const fetchImpl = fakeFetch(() =>
      jsonResponse(200, { choices: [{ message: { content: 'pong' } }] }),
    );
    const ok = await testConnection(openaiCfg, { fetchImpl });
    expect(ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [, init] = fetchImpl.mock.calls[0];
    const body = JSON.parse(init?.body as string);
    expect(
      body.messages.some(
        (m: { content: string }) => m.content.toLowerCase().includes('ping'),
      ),
    ).toBe(true);
  });

  it('请求失败时返回 false，不向外抛错', async () => {
    const fetchImpl = fakeFetch(() => jsonResponse(500, 'server error'));
    const ok = await testConnection(anthropicCfg, { fetchImpl });
    expect(ok).toBe(false);
  });

  it('网络错误时也返回 false', async () => {
    const fetchImpl = fakeFetch(() => {
      throw new Error('down');
    });
    const ok = await testConnection(openaiCfg, { fetchImpl });
    expect(ok).toBe(false);
  });
});
