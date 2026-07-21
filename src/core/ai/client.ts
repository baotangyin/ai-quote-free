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
  /**
   * 调用所属功能标识（用量统计用）。未提供时本次调用不记录用量（如 testConnection 探活）。
   * 记录动作由 setAiUsageRecorder 注入的回调完成，未注入（免费版/统计关闭）则一律不记录。
   */
  feature?: AiUsageFeature;
}

export type AiUsageFeature = 'import' | 'drawing' | 'watch' | 'screenshot' | 'template' | 'product' | 'other';

export interface AiUsageEvent {
  feature: AiUsageFeature;
  model: string;
  protocol: 'openai' | 'anthropic';
  ok: boolean;
  promptTokens: number | null;
  completionTokens: number | null;
  at: string;
}

type AiUsageRecorder = (event: AiUsageEvent) => void;

let usageRecorder: AiUsageRecorder | null = null;

/**
 * 注入用量记录回调（付费版主进程注入，写本地队列后随在线校验批量上报）。
 * 传 null 取消注入。回调内部异常由 chatComplete 吞掉，不影响 AI 调用本身。
 */
export function setAiUsageRecorder(recorder: AiUsageRecorder | null): void {
  usageRecorder = recorder;
}

function recordUsage(
  feature: AiUsageFeature | undefined,
  cfg: AiConfig,
  ok: boolean,
  usage: { promptTokens: number | null; completionTokens: number | null },
): void {
  if (!feature || !usageRecorder) return;
  try {
    usageRecorder({
      feature,
      model: cfg.model,
      protocol: cfg.protocol,
      ok,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      at: new Date().toISOString(),
    });
  } catch {
    // 用量记录失败不影响 AI 调用本身
  }
}

function toTokenCount(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null;
}

interface RequestResult {
  text: string;
  usage: { promptTokens: number | null; completionTokens: number | null };
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
): Promise<RequestResult> {
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
    usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
  };
  return {
    text: data.choices?.[0]?.message?.content ?? '',
    usage: {
      promptTokens: toTokenCount(data.usage?.prompt_tokens),
      completionTokens: toTokenCount(data.usage?.completion_tokens),
    },
  };
}

async function requestAnthropic(
  cfg: AiConfig,
  messages: ChatMessage[],
  maxTokens: number,
  fetchImpl: typeof fetch,
  extraBody?: Record<string, unknown>,
): Promise<RequestResult> {
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
    usage?: { input_tokens?: unknown; output_tokens?: unknown };
  };
  return {
    text: data.content?.[0]?.text ?? '',
    usage: {
      promptTokens: toTokenCount(data.usage?.input_tokens),
      completionTokens: toTokenCount(data.usage?.output_tokens),
    },
  };
}

export async function chatComplete(
  cfg: AiConfig,
  messages: ChatMessage[],
  opts: ChatCompleteOpts = {},
): Promise<string> {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const maxTokens = opts.maxTokens ?? DEFAULT_MAX_TOKENS;

  try {
    const result =
      cfg.protocol === 'openai'
        ? await requestOpenai(cfg, messages, maxTokens, fetchImpl, opts.extraBody)
        : await requestAnthropic(cfg, messages, maxTokens, fetchImpl, opts.extraBody);
    recordUsage(opts.feature, cfg, true, result.usage);
    return result.text;
  } catch (err) {
    recordUsage(opts.feature, cfg, false, { promptTokens: null, completionTokens: null });
    throw err;
  }
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

/** 获取指定提供商的官方模型名称列表（OpenAI 兼容 /models 或 Anthropic /models 端点）。 */
export async function fetchModelNames(
  cfg: AiConfig,
  opts: ChatCompleteOpts = {},
): Promise<string[]> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const baseUrl = cfg.baseUrl.replace(/\/+$/, '');

  if (cfg.protocol === 'openai') {
    const url = `${baseUrl}/models`;
    const res = await fetchImpl(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
      },
    });
    if (!res.ok) {
      const bodyPreview = await readErrorBody(res);
      throw new Error(`获取模型列表失败：状态码 ${res.status}，响应：${bodyPreview}`);
    }
    const data = (await res.json()) as { data?: Array<{ id: string }> };
    const models = (data.data ?? [])
      .map((m) => m.id)
      .filter((id) => !id.includes('audio') && !id.includes('tts') && !id.includes('whisper') && !id.includes('embedding') && !id.includes('dall-e') && !id.includes('moderation'));
    return models.sort();
  }

  // Anthropic protocol
  const url = `${baseUrl}/v1/models`;
  const res = await fetchImpl(url, {
    method: 'GET',
    headers: {
      'x-api-key': cfg.apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
    },
  });
  if (!res.ok) {
    const bodyPreview = await readErrorBody(res);
    throw new Error(`获取模型列表失败：状态码 ${res.status}，响应：${bodyPreview}`);
  }
  const data = (await res.json()) as { data?: Array<{ id: string }> };
  const models = (data.data ?? []).map((m) => m.id);
  return models.sort();
}
