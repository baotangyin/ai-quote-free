import type { ChatMessage } from '../ai/client';
import { extractJson } from '../ai/json';
import type { DrawingItem, DrawingSpace } from '../domain/types';

/** 视觉识别用的 chat 函数：已绑定 AI 配置，仅需传消息与可选项。 */
export type VisionChatFn = (messages: ChatMessage[], opts?: { maxTokens?: number }) => Promise<string>;

export interface DrawingImage {
  mediaType: 'image/png' | 'image/jpeg' | 'image/webp';
  base64: string;
}

export interface DrawingRecognizeResult {
  spaces: DrawingSpace[];
  failedImages: number;
  /** 逐张失败图的错误信息，格式「第N张：{message}」，N 为该图在入参 images 中的 1-based 位置。 */
  errors: string[];
}

const MAX_TOKENS = 8000;

/**
 * 构造图纸识别提示词（中文）：展厅/智能化平面布置图，提取空间名与设备标注。
 * 输出严格 JSON 数组，不要输出解释性文字，不要使用 Markdown 代码围栏。
 */
export function buildDrawingPrompt(): string {
  return [
    '你是专业的弱电智能化工程图纸识别助手。',
    '任务：从用户提供的展厅/智能化平面布置图中，识别出图中划分的各个空间（房间/区域）及其内的设备标注，输出为严格的 JSON 数组，不要输出任何解释性文字，不要使用 Markdown 代码围栏。',
    '',
    '数组中每个元素代表一个空间，结构如下：',
    '{"name": "空间名称", "items": [{"name": "设备名称", "category": "设备类别，识别不出为 null", "size": "尺寸规格，识别不出为 null", "qty": 数量, "remark": "备注，没有为 null"}]}',
    '',
    '识别规则：',
    '1. name 取图上空间/房间的标注文字（如"多功能厅""接待区"）；图上未划分空间但仍有设备标注时，可用设备所在区域的合理描述作为空间名。',
    '2. 设备数量识别："设备名*2"、"设备名×2"、"设备名 2台"、"设备名 2套" 等写法均表示 qty=2；无法识别数量时 qty=1。',
    '3. 尺寸规格（如"65寸""P2.5""3×2m"）归入 size 字段；设备类别（如"LED屏""音响""摄像头"）归入 category 字段。',
    '4. 非设备文字（尺寸标注线、图例说明、指北针、比例尺等）一律忽略，不要输出为 items。',
    '5. 严格输出 JSON 数组，不要有多余文字、不要使用 Markdown 代码围栏。',
  ].join('\n');
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

function toNullableString(v: unknown): string | null {
  if (typeof v === 'string') {
    const trimmed = v.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  return null;
}

function normalizeQty(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return 1;
  return n;
}

function validateItem(item: unknown): DrawingItem | null {
  if (item === null || typeof item !== 'object') return null;
  const obj = item as Record<string, unknown>;
  if (!isNonEmptyString(obj.name)) return null;
  return {
    name: obj.name.trim(),
    category: toNullableString(obj.category),
    size: toNullableString(obj.size),
    qty: normalizeQty(obj.qty),
    remark: toNullableString(obj.remark),
  };
}

function validateSpace(space: unknown): DrawingSpace | null {
  if (space === null || typeof space !== 'object') return null;
  const obj = space as Record<string, unknown>;
  if (!isNonEmptyString(obj.name)) return null;
  const itemsRaw = Array.isArray(obj.items) ? obj.items : [];
  const items = itemsRaw
    .map(validateItem)
    .filter((it): it is DrawingItem => it !== null);
  return { name: obj.name.trim(), items };
}

/**
 * 校验单张图 AI 输出（预期数组），非法元素逐条丢弃；非数组时尝试两级解包容错：
 * 1) 对象且其 spaces 属性为数组 —— 视为 { spaces: [...] } 包裹；
 * 2) 单个空间对象（有 string name，items 缺省或为数组）—— 包成单元素数组。
 * 仍不行才抛错（计入 failedImages）。
 */
function validateSpaces(x: unknown): DrawingSpace[] {
  let arr: unknown[];
  if (Array.isArray(x)) {
    arr = x;
  } else if (x !== null && typeof x === 'object' && Array.isArray((x as Record<string, unknown>).spaces)) {
    arr = (x as Record<string, unknown>).spaces as unknown[];
  } else if (
    x !== null &&
    typeof x === 'object' &&
    isNonEmptyString((x as Record<string, unknown>).name) &&
    ((x as Record<string, unknown>).items === undefined || Array.isArray((x as Record<string, unknown>).items))
  ) {
    arr = [x];
  } else {
    throw new Error('AI输出格式非法');
  }
  const spaces: DrawingSpace[] = [];
  for (const item of arr) {
    const space = validateSpace(item);
    if (space) spaces.push(space);
  }
  return spaces;
}

/** 跨图合并：同名（trim 后）空间的 items 拼接，保持首次出现的空间顺序。 */
function mergeSpaces(all: DrawingSpace[][]): DrawingSpace[] {
  const order: string[] = [];
  const map = new Map<string, DrawingItem[]>();
  for (const spaces of all) {
    for (const space of spaces) {
      const key = space.name;
      if (!map.has(key)) {
        map.set(key, []);
        order.push(key);
      }
      map.get(key)!.push(...space.items);
    }
  }
  return order.map((name) => ({ name, items: map.get(name)! }));
}

/**
 * 逐图识别图纸（一图一次 chat 请求），归一化后按空间名（trim 后）跨图合并。
 * 单图请求失败（chat 抛错）或返回内容 JSON 解析/校验失败，计入 failedImages，
 * 不中断其余图的识别；全部失败时返回 spaces=[]。
 */
export async function recognizeDrawing(
  chat: VisionChatFn,
  images: DrawingImage[],
): Promise<DrawingRecognizeResult> {
  const prompt = buildDrawingPrompt();
  const perImageSpaces: DrawingSpace[][] = [];
  let failedImages = 0;
  const errors: string[] = [];

  for (let i = 0; i < images.length; i++) {
    const image = images[i];
    const messages: ChatMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image', mediaType: image.mediaType, base64: image.base64 },
        ],
      },
    ];

    try {
      const text = await chat(messages, { maxTokens: MAX_TOKENS });
      const parsed = extractJson(text);
      perImageSpaces.push(validateSpaces(parsed));
    } catch (e) {
      failedImages++;
      const message = e instanceof Error ? e.message : String(e);
      errors.push(`第${i + 1}张：${message}`);
    }
  }

  return { spaces: mergeSpaces(perImageSpaces), failedImages, errors };
}
