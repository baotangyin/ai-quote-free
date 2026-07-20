import type { ChatMessage } from './client';
import { extractJson } from './json';
import type { VisionChatFn } from '../import/drawingRecognize';
import type { Cents } from '../domain/types';

export interface ScreenshotPriceImage {
  mediaType: 'image/png' | 'image/jpeg' | 'image/webp';
  base64: string;
}

export interface ScreenshotPriceResult {
  found: boolean;
  name: string | null;
  spec: string | null;
  priceCents: Cents | null;
  shop: string | null;
  note: string | null;
}

const MAX_TOKENS = 1000;

/**
 * 构造截图识价提示词（中文）：输入为用户手动截图的电商商品页，要求严格 JSON，禁止编造。
 * 输出结构：{"found": boolean, "name": 字符串或null, "spec": 字符串或null,
 * "priceYuan": 数字或null, "shop": 字符串或null, "note": 字符串或null}
 * priceYuan 为人民币元（非分），元→分换算在调用方（recognizeScreenshotPrice）以
 * Math.round(priceYuan*100) 完成。
 */
export function buildScreenshotPricePrompt(): string {
  return [
    '你是专业的电商商品页信息识别助手。',
    '任务：用户提供的图片是一张电商商品详情页/商品列表页的截图，请从图中识别商品名称、规格、当前售价（人民币）与店铺名称，输出严格的 JSON 对象，不要输出任何解释性文字，不要使用 Markdown 代码围栏。',
    '',
    '输出结构：{"found": true/false, "name": 字符串或null, "spec": 字符串或null, "priceYuan": 数字或null, "shop": 字符串或null, "note": 字符串或null}',
    '',
    '规则：',
    '1. 只有在图中能清晰识别出商品名称与具体售价时才输出 found=true，并填写对应字段；识别不出的字段（如规格、店铺）可为 null。',
    '2. 图片不是商品页截图、内容模糊无法辨认、或找不到明确售价时，必须输出 found=false，其余字段均为 null，禁止编造或估算。',
    '3. priceYuan 只填数字（单位：元），不要带货币符号或单位文字；促销价与原价同时出现时，取当前实际售价（通常是促销价/到手价）。',
    '4. note 用于补充说明（如识别不出的原因、价格类型说明），没有可留 null。',
    '5. 严格输出 JSON 对象，不要有多余文字、不要使用 Markdown 代码围栏。',
  ].join('\n');
}

function toNullableString(v: unknown): string | null {
  if (typeof v === 'string') {
    const trimmed = v.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  return null;
}

/** 将 AI 返回的已解析 JSON 校验、归一化为 ScreenshotPriceResult；结构非法时抛错。 */
function toScreenshotPriceResult(parsed: unknown): ScreenshotPriceResult {
  if (parsed === null || typeof parsed !== 'object') {
    throw new Error('AI输出格式非法');
  }
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.found !== 'boolean') {
    throw new Error('AI输出格式非法');
  }
  if (!obj.found) {
    return {
      found: false,
      name: null,
      spec: null,
      priceCents: null,
      shop: null,
      note: toNullableString(obj.note),
    };
  }
  if (typeof obj.priceYuan !== 'number' || !Number.isFinite(obj.priceYuan) || obj.priceYuan <= 0) {
    throw new Error('AI输出格式非法');
  }
  const priceCents = Math.round(obj.priceYuan * 100);
  return {
    found: true,
    name: toNullableString(obj.name),
    spec: toNullableString(obj.spec),
    priceCents,
    shop: toNullableString(obj.shop),
    note: toNullableString(obj.note),
  };
}

/**
 * 对单张用户手动提供的商品页截图发起一次 AI 识价请求（不联网、不自动访问页面，
 * 仅基于图片内容识别）。chat 调用失败、AI 输出无法解析为 JSON、或结构非法（含
 * found=true 但价格非正）均会抛出异常，由调用方处理。
 */
export async function recognizeScreenshotPrice(
  chat: VisionChatFn,
  image: ScreenshotPriceImage,
): Promise<ScreenshotPriceResult> {
  const prompt = buildScreenshotPricePrompt();
  const messages: ChatMessage[] = [
    {
      role: 'user',
      content: [
        { type: 'text', text: prompt },
        { type: 'image', mediaType: image.mediaType, base64: image.base64 },
      ],
    },
  ];
  const text = await chat(messages, { maxTokens: MAX_TOKENS });
  const parsed = extractJson(text);
  return toScreenshotPriceResult(parsed);
}
