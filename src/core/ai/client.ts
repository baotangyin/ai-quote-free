export interface AiConfig {
  protocol: 'openai' | 'anthropic';
  baseUrl: string;
  apiKey: string;
  model: string;
}

export type ChatContentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; mediaType: 'image/png' | 'image/jpeg' | 'image/webp'; base64: string };

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | ChatContentPart[];
}

export interface ChatCompleteOpts {
  maxTokens?: number;
  fetchImpl?: typeof fetch;
  /**
   * 按厂商追加到请求体的额外字段（如联网搜索开关）。与标准字段（model/messages/max_tokens
   * 等）合并时标准字段优先——合并顺序为 extraBody 在前、标准字段在后（对象展开语义），
   * 因此 extraBody 不得覆盖这些标准字段，即便其中包含同名 key。
   */
  extraBody?: Record<string, unknown>;
}

const DEFAULT_MAX_TOKENS = 4096;
const ANTHROPIC_VERSION = '2023-06-01';

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

async function readErrorBody(res: Response): Promise<string> {
  try {
    const text = await res.text();
    return text.slice(0, 200);
  } catch {
    return '';
  }
}

function toOpenaiContentPart(part: ChatContentPart): Record<string, unknown> {
  if (part.type === 'text') {
    return { type: 'text', text: part.text };
  }
  return {
    type: 'image_url',
    image_url: { url: `data:${part.mediaType};base64,${part.base64}` },
  };
}

function toOpenaiMessage(m: ChatMessage): { role: string; content: unknown } {
  if (typeof m.content === 'string') {
    return { role: m.role, content: m.content };
  }
  return { role: m.role, content: m.content.map(toOpenaiContentPart) };
}

function toAnthropicContentPart(part: ChatContentPart): Record<string, unknown> {
  if (part.type === 'text') {
    return { type: 'text', text: part.text };
  }
  return {
    type: 'image',
    source: { type: 'base64', media_type: part.mediaType, data: part.base64 },
  };
}

function toAnthropicMessage(m: ChatMessage): { role: string; content: unknown } {
  if (typeof m.content === 'string') {
    return { role: m.role, content: m.content };
  }
  return { role: m.role, content: m.content.map(toAnthropicContentPart) };
}

async function requestOpenai(
  cfg: AiConfig,
  messages: ChatMessage[],
  maxTokens: number,
  fetchImpl: typeof fetch,
  extraBody?: Record<string, unknown>,
): Promise<string> {
  const url = `${trimTrailingSlash(cfg.baseUrl)}/chat/completions`;
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({
      ...extraBody,
      model: cfg.model,
      messages: messages.map(toOpenaiMessage),
      max_tokens: maxTokens,
    }),
  });

  if (!res.ok) {
    const bodyPreview = await readErrorBody(res);
    throw new Error(`AI请求失败：状态码 ${res.status}，响应：${bodyPreview}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return data.choices?.[0]?.message?.content ?? '';
}

async function requestAnthropic(
  cfg: AiConfig,
  messages: ChatMessage[],
  maxTokens: number,
  fetchImpl: typeof fetch,
  extraBody?: Record<string, unknown>,
): Promise<string> {
  const url = `${trimTrailingSlash(cfg.baseUrl)}/v1/messages`;
  const systemContent = messages
    .filter((m) => m.role === 'system')
    .map((m) => (typeof m.content === 'string' ? m.content : ''))
    .join('\n\n');
  const nonSystemMessages = messages
    .filter((m) => m.role !== 'system')
    .map(toAnthropicMessage);

  const body: Record<string, unknown> = {
    ...extraBody,
    model: cfg.model,
    max_tokens: maxTokens,
    messages: nonSystemMessages,
  };
  if (systemContent) {
    body.system = systemContent;
  }

  const res = await fetchImpl(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': cfg.apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const bodyPreview = await readErrorBody(res);
    throw new Error(`AI请求失败：状态码 ${res.status}，响应：${bodyPreview}`);
  }

  const data = (await res.json()) as {
    content?: Array<{ type?: string; text?: string }>;
  };
  return data.content?.[0]?.text ?? '';
}

export async function chatComplete(
  cfg: AiConfig,
  messages: ChatMessage[],
  opts: ChatCompleteOpts = {},
): Promise<string> {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const maxTokens = opts.maxTokens ?? DEFAULT_MAX_TOKENS;

  if (cfg.protocol === 'openai') {
    return requestOpenai(cfg, messages, maxTokens, fetchImpl, opts.extraBody);
  }
  return requestAnthropic(cfg, messages, maxTokens, fetchImpl, opts.extraBody);
}

export async function testConnection(
  cfg: AiConfig,
  opts: ChatCompleteOpts = {},
): Promise<boolean> {
  try {
    await chatComplete(cfg, [{ role: 'user', content: 'ping' }], opts);
    return true;
  } catch {
    return false;
  }
}
