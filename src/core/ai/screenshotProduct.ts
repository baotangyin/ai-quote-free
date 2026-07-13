import type { ChatMessage } from './client';
import { extractJson } from './json';
import type { VisionChatFn } from '../import/drawingRecognize';

export interface ScreenshotProductImage {
  mediaType: 'image/png' | 'image/jpeg' | 'image/webp';
  base64: string;
}

export interface ScreenshotProductResult {
  found: boolean;
  name: string | null;
  brand: string | null;
  model: string | null;
  category: string | null;
  dims: string | null;
  unit: string | null;
  paramsCore: string | null;
  priceYuan: number | null;
  note: string | null;
}

const MAX_TOKENS = 1000;

/**
 * 构造截图识别产品信息提示词（中文）：输入为用户手动截图的电商/产品详情页，要求严格 JSON，
 * 禁止编造。与截图识价（screenshotPrice.ts）的区别：本功能以「产品资料建档」为主要目的，
 * 价格只是附带项——即便识别不出价格，只要能识别出产品名称等信息即应 found=true，
 * priceYuan 置 null 即可，不因价格缺失而丢弃整体识别结果。
 */
export function buildScreenshotProductPrompt(): string {
  return [
    '你是专业的电商/产品详情页信息识别助手。',
    '任务：用户提供的图片是一张电商商品详情页/产品资料页的截图，请从图中识别产品的建档信息，输出严格的 JSON 对象，不要输出任何解释性文字，不要使用 Markdown 代码围栏。',
    '',
    '输出结构：{"found": true/false, "name": 字符串或null, "brand": 字符串或null, "model": 字符串或null, "category": 字符串或null, "dims": 字符串或null, "unit": 字符串或null, "paramsCore": 字符串或null, "priceYuan": 数字或null, "note": 字符串或null}',
    '',
    '规则：',
    '1. 只有在图中能清晰识别出产品名称时才输出 found=true；识别不出的其余字段可为 null。图片不是产品页截图、内容模糊无法辨认、或连产品名称都无法确定时，必须输出 found=false，其余字段均为 null，禁止编造或估算。',
    '2. brand 为品牌名，model 为型号/货号。',
    '3. category 只给一个最贴切的中文类别词（如"拼接屏""音响""摄像头"），不要输出多个类别或短语。',
    '4. dims 为规格尺寸（如"1920×1080mm"），unit 为常用计量单位（如"台""套""㎡"）。',
    '5. paramsCore 为核心参数要点，可多行文本（每行一条要点），提炼图中可见的关键参数（如分辨率、功率、接口数量等），识别不出可为 null。',
    '6. priceYuan 只填数字（单位：元），不要带货币符号或单位文字；促销价与原价同时出现时，取当前实际售价。价格只是附带信息，识别不出价格时置为 null，不影响其余字段的识别与 found 判定。',
    '7. note 用于补充说明（如识别不出的原因），没有可留 null。',
    '8. 严格输出 JSON 对象，不要有多余文字、不要使用 Markdown 代码围栏。',
  ].join('\n');
}

function toNullableString(v: unknown): string | null {
  if (typeof v === 'string') {
    const trimmed = v.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  return null;
}

/** priceYuan 非正（含非 number/NaN/Infinity/<=0）一律归为 null；产品信息其余字段不受影响。 */
function toNullablePositiveNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v;
  return null;
}

/** 将 AI 返回的已解析 JSON 校验、归一化为 ScreenshotProductResult；结构非法时抛错。 */
function toScreenshotProductResult(parsed: unknown): ScreenshotProductResult {
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
      brand: null,
      model: null,
      category: null,
      dims: null,
      unit: null,
      paramsCore: null,
      priceYuan: null,
      note: toNullableString(obj.note),
    };
  }
  return {
    found: true,
    name: toNullableString(obj.name),
    brand: toNullableString(obj.brand),
    model: toNullableString(obj.model),
    category: toNullableString(obj.category),
    dims: toNullableString(obj.dims),
    unit: toNullableString(obj.unit),
    paramsCore: toNullableString(obj.paramsCore),
    priceYuan: toNullablePositiveNumber(obj.priceYuan),
    note: toNullableString(obj.note),
  };
}

/**
 * 对单张用户手动提供的产品页截图发起一次 AI 识别请求（不联网、不自动访问页面，
 * 仅基于图片内容识别），提取用于产品建档的信息。chat 调用失败、AI 输出无法解析为 JSON、
 * 或结构非法均会抛出异常，由调用方处理；found=true 但价格非正时，价格置 null 而非视为
 * 整体非法（与截图识价 recognizeScreenshotPrice 的区别：价格是附带项）。
 */
export async function recognizeScreenshotProduct(
  chat: VisionChatFn,
  image: ScreenshotProductImage,
): Promise<ScreenshotProductResult> {
  const prompt = buildScreenshotProductPrompt();
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
  return toScreenshotProductResult(parsed);
}
