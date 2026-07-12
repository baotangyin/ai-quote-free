import type { AiConfig, ChatMessage } from '../ai/client';
import { chatComplete } from '../ai/client';
import { extractJsonLenient } from '../ai/json';
import type { ProductOption } from '../domain/types';

export interface RecognizedRow {
  /** 多分类标签：至少含设备类别，可附尺寸等标签（如"55寸"）。 */
  categories: string[];
  name: string;
  brand: string | null;
  model: string | null;
  params: string | null;
  unit: string;
  dims: string | null;
  priceCents: number;
  options: ProductOption[];
  remark: string | null;
  confidence: number;
  /** 推荐品牌，非 AI 识别产出，缺省视为 []；入库前若为空会由 suggestBrands 自动补齐。 */
  recommendedBrands?: string[];
  /** 220V 用电量（W）；无法判别电压归属时为 null，不臆测。 */
  power220W: number | null;
  /** 380V/三相用电量（W）；无法判别电压归属时为 null，不臆测。 */
  power380W: number | null;
  /** 机柜占用 U 数（整数）；无法判别时为 null，不臆测。 */
  rackU: number | null;
  /** 时序电源路数（整数）；无法判别时为 null，不臆测。 */
  seqPowerPorts: number | null;
  /** 网口数（整数）；无法判别时为 null，不臆测。 */
  netPorts: number | null;
  /** com/串口数（整数）；无法判别时为 null，不臆测。 */
  comPorts: number | null;
}

const HEADER_KEYWORD_REGEX = /名称|型号|价格|售价/;
const HEADER_SCAN_LIMIT = 3;
const DEFAULT_MAX_ROWS = 25;
const DEFAULT_MAX_CHARS = 6000;
const DEFAULT_CONFIDENCE = 0.5;

/**
 * 构造识别提示词。system 消息说明任务、字段与识别规则（全中文，要求严格 JSON 数组输出）；
 * user 消息携带 sheet 名与 grid 的 TSV 文本。
 */
export function buildPrompt(sheetName: string, grid: string[][]): ChatMessage[] {
  const tsv = grid.map((row) => row.join('\t')).join('\n');

  const system = [
    '你是专业的弱电智能化工程报价单数据识别助手。',
    '任务：从用户提供的表格数据（TSV 格式）中识别出每一条产品报价记录，输出为严格的 JSON 数组，不要输出任何解释性文字，不要使用 Markdown 代码围栏。',
    '',
    '数组中每个元素代表一行产品记录，字段如下：',
    '- categories: 产品分类标签数组（string[]），必须包含设备类别（如"LED屏"/"音响"），可附加尺寸等标签（如"55寸"），示例：["LED屏","55寸"]',
    '- name: 产品名称（string）',
    '- brand: 品牌，没有则为 null',
    '- model: 型号，没有则为 null',
    '- params: 核心参数/规格描述，没有则为 null',
    '- unit: 计价单位，如"台"/"套"/"㎡"',
    '- dims: 尺寸规格，没有则为 null',
    '- price_yuan: 单价，单位"元"，数字类型',
    '- options: 选配加价数组，每项为 {"name": 选项名, "add_price_yuan": 加价金额（元）, "params": 选配项的参数描述，没有则为 null}，没有选配则为空数组 []',
    '- power_220w: 220V 用电量/功率（W，数字），无法判别或不适用则为 null',
    '- power_380w: 380V/三相用电量/功率（W，数字），无法判别或不适用则为 null',
    '- rack_u: 机柜占用 U 数（整数），无法判别或不适用则为 null，不要臆测',
    '- seq_power_ports: 时序电源路数（整数），无法判别或不适用则为 null，不要臆测',
    '- net_ports: 网口数（整数），无法判别或不适用则为 null，不要臆测',
    '- com_ports: com/串口数（整数），无法判别或不适用则为 null，不要臆测',
    '- remark: 备注，没有则为 null',
    '- confidence: 你对这一行识别准确性的置信度，0~1 之间的小数，每一行都必须给出',
    '',
    '识别规则：',
    '1. 表格备注中出现"XX另加""加N元"等描述时，应将其拆分为 options 数组中的一项（name + add_price_yuan），不要拼在 name 或 remark 里。',
    '2. 矩阵定价（同一产品有多个规格分别对应多个价格，例如同一产品不同尺寸/型号在表格中并列出现多个价格）时，应展开为多行，每行对应一个规格与一个价格，规格信息并入 name 或 dims 字段。',
    '3. 没有价格的行（说明行、标题行、空行等）应跳过，不要输出。',
    '4. 严格输出 JSON 数组，不要有多余文字、不要使用 Markdown 代码围栏。',
    '5. 参数字段请压缩至200字以内，保留关键规格，避免输出内容过长。',
    '6. 功耗/功率电压判别：明确标注"380V"/"三相"/"动力电"等字样的，功率数值填入 power_380w，power_220w 为 null；',
    '   明确标注"220V"或为显示屏/主机/音响等常规低压设备的，功率数值填入 power_220w，power_380w 为 null；',
    '   若没有电压线索、但设备属于空调/电机/舞台机械等大功率动力类，不要臆测归属，power_220w 与 power_380w 均填 null，并在 remark 中追加"功率电压待确认"。',
  ].join('\n');

  const user = `表格名称：${sheetName}\n\n表格内容（TSV，每行一条记录，单元格以制表符分隔）：\n${tsv}`;

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

/** 表头启发式：前 3 行中含「名称|型号|价格|售价」关键词的行视为表头，其余为数据行。 */
function detectHeaderRows(rows: string[][]): { headerRows: string[][]; bodyRows: string[][] } {
  const scanLimit = Math.min(HEADER_SCAN_LIMIT, rows.length);
  const headerIdx: number[] = [];
  for (let i = 0; i < scanLimit; i++) {
    if (rows[i].some((cell) => HEADER_KEYWORD_REGEX.test(cell))) {
      headerIdx.push(i);
    }
  }
  const headerSet = new Set(headerIdx);
  const headerRows = headerIdx.map((i) => rows[i]);
  const bodyRows = rows.filter((_, i) => !headerSet.has(i));
  return { headerRows, bodyRows };
}

function rowTsvChars(row: string[]): number {
  return row.join('\t').length;
}

export interface ChunkGridOpts {
  maxChars?: number;
  maxRows?: number;
}

/**
 * 按「字符预算 + 行数」双约束分块（先到为准，每块最少 1 行数据）。表头行
 * （启发式：前 3 行中含「名称|型号|价格|售价」关键词的行）会被复制到每个分块的首部。
 */
export function chunkGrid(grid: string[][], opts: ChunkGridOpts = {}): string[][][] {
  const maxChars = opts.maxChars ?? DEFAULT_MAX_CHARS;
  const maxRows = opts.maxRows ?? DEFAULT_MAX_ROWS;

  const totalChars = grid.reduce((sum, row) => sum + rowTsvChars(row), 0);
  if (grid.length <= maxRows && totalChars <= maxChars) {
    return [grid.slice()];
  }

  const { headerRows, bodyRows } = detectHeaderRows(grid);

  if (bodyRows.length === 0) {
    return [grid.slice()];
  }

  const chunks: string[][][] = [];
  let current: string[][] = [];
  let currentChars = 0;

  for (const row of bodyRows) {
    const chars = rowTsvChars(row);
    const wouldExceedRows = current.length + 1 > maxRows;
    const wouldExceedChars = current.length > 0 && currentChars + chars > maxChars;
    if (current.length > 0 && (wouldExceedRows || wouldExceedChars)) {
      chunks.push([...headerRows, ...current]);
      current = [];
      currentChars = 0;
    }
    current.push(row);
    currentChars += chars;
  }
  if (current.length > 0) {
    chunks.push([...headerRows, ...current]);
  }
  return chunks;
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

function toNullableString(v: unknown): string | null | undefined {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') {
    const trimmed = v.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  return undefined; // 类型非法
}

/** 一千亿元——荒谬价格上限（分）。 */
const MAX_PRICE_CENTS = 1e13;
/** "万"单位识别：数字后紧跟「万」，可选「元」，前后允许空白。其余非纯数字单位（如 K/w）视为歧义，直接丢弃。 */
const WAN_UNIT_REGEX = /^\s*(-?[0-9]+(?:\.[0-9]+)?)\s*万元?\s*$/;

/** 解析"元"计价字段为分。支持数字、带逗号/货币符号的字符串（如"4,500元"）与"万"单位（如"1.5万"）。
 * 0、负数、无法识别单位（如"K"/"w"）、超出上限（>1e13 分或超过 Number.MAX_SAFE_INTEGER）均返回 null。 */
function parseYuanToCents(v: unknown): number | null {
  let n: number;
  if (typeof v === 'number') {
    n = v;
  } else if (typeof v === 'string') {
    const trimmed = v.trim();
    if (trimmed.includes('万')) {
      // 含"万"：严格按「数字 + 万 + 可选元」识别，格式不符则视为歧义，直接丢弃（不清洗兜底）。
      const wanMatch = trimmed.match(WAN_UNIT_REGEX);
      if (!wanMatch) return null;
      // 按规格约定：'1.5万' → 1500000 分、'3万元' → 3000000 分。
      // 1万元 = 10,000元 = 1,000,000分。下方统一走 n * 100 换算为分，此处预先乘以 10000（万→元）。
      n = Number(wanMatch[1]) * 10000;
    } else if (/[kKwW]/.test(trimmed)) {
      // 含有 K/w 等无法确定换算关系的单位缩写时，视为歧义，直接丢弃。
      return null;
    } else {
      const cleaned = trimmed.replace(/[^0-9.\-]/g, '');
      if (cleaned === '' || cleaned === '-') return null;
      n = Number(cleaned);
    }
  } else {
    return null;
  }
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n > Number.MAX_SAFE_INTEGER) return null;
  const cents = Math.round(n * 100);
  if (!Number.isFinite(cents) || cents > Number.MAX_SAFE_INTEGER || cents > MAX_PRICE_CENTS) return null;
  return cents;
}

function validateOptions(v: unknown): ProductOption[] {
  if (!Array.isArray(v)) return [];
  const out: ProductOption[] = [];
  for (const item of v) {
    if (item === null || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    if (!isNonEmptyString(obj.name)) continue;
    const addPriceCents = parseYuanToCents(obj.add_price_yuan);
    if (addPriceCents === null) continue;
    const entry: ProductOption = { name: obj.name.trim(), addPriceCents };
    const paramsText = toNullableString(obj.params);
    if (paramsText) entry.paramsText = paramsText;
    out.push(entry);
  }
  return out;
}

/** 解析可空功率数值：数字或可清洗为数字的字符串；null/undefined/无法识别均返回 null（不臆测）。 */
function parseNullableWatt(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const cleaned = v.trim().replace(/[^0-9.\-]/g, '');
    if (cleaned === '' || cleaned === '-') return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** 解析可空整数：数字或可清洗为整数的字符串；非整数、null/undefined/无法识别均返回 null（不臆测）。 */
function parseNullableInt(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isInteger(v) ? v : null;
  if (typeof v === 'string') {
    const cleaned = v.trim().replace(/[^0-9.\-]/g, '');
    if (cleaned === '' || cleaned === '-') return null;
    const n = Number(cleaned);
    return Number.isInteger(n) ? n : null;
  }
  return null;
}

function validateConfidence(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return DEFAULT_CONFIDENCE;
  return Math.min(1, Math.max(0, v));
}

/** 兼容 string（单分类）与 string[]（多分类）两种输入形态；也兼容旧字段名 category（单分类）。 */
function validateCategories(v: unknown): string[] {
  if (typeof v === 'string') {
    const t = v.trim();
    return t ? [t] : [];
  }
  if (Array.isArray(v)) {
    return v.filter((c): c is string => typeof c === 'string' && c.trim().length > 0).map((c) => c.trim());
  }
  return [];
}

function validateOne(item: unknown): RecognizedRow | null {
  if (item === null || typeof item !== 'object') return null;
  const obj = item as Record<string, unknown>;

  const categories = validateCategories(obj.categories ?? obj.category);
  if (categories.length === 0) return null;
  if (!isNonEmptyString(obj.name)) return null;
  if (!isNonEmptyString(obj.unit)) return null;

  const brand = toNullableString(obj.brand);
  const model = toNullableString(obj.model);
  const params = toNullableString(obj.params);
  const dims = toNullableString(obj.dims);
  const remark = toNullableString(obj.remark);
  if (brand === undefined || model === undefined || params === undefined || dims === undefined || remark === undefined) {
    return null;
  }

  const priceCents = parseYuanToCents(obj.price_yuan);
  if (priceCents === null) return null;

  const recommendedBrandsRaw = obj.recommendedBrands ?? obj.recommended_brands;
  const recommendedBrands = Array.isArray(recommendedBrandsRaw)
    ? recommendedBrandsRaw.filter((b): b is string => typeof b === 'string' && b.trim().length > 0).map((b) => b.trim())
    : [];

  return {
    categories,
    name: obj.name.trim(),
    brand,
    model,
    params,
    unit: obj.unit.trim(),
    dims,
    priceCents,
    options: validateOptions(obj.options),
    remark,
    confidence: validateConfidence(obj.confidence),
    recommendedBrands,
    power220W: parseNullableWatt(obj.power_220w ?? obj.power220W),
    power380W: parseNullableWatt(obj.power_380w ?? obj.power380W),
    rackU: parseNullableInt(obj.rack_u ?? obj.rackU),
    seqPowerPorts: parseNullableInt(obj.seq_power_ports ?? obj.seqPowerPorts),
    netPorts: parseNullableInt(obj.net_ports ?? obj.netPorts),
    comPorts: parseNullableInt(obj.com_ports ?? obj.comPorts),
  };
}

/** 校验 LLM 输出（预期为数组）；若为单个对象则按 [obj] 救回，非数组非对象则整体丢弃计 1。非法行逐条丢弃并计数。 */
export function validateRecognizedRows(x: unknown): { rows: RecognizedRow[]; dropped: number } {
  let arr: unknown[];
  if (Array.isArray(x)) {
    arr = x;
  } else if (x !== null && typeof x === 'object') {
    arr = [x];
  } else {
    return { rows: [], dropped: 1 };
  }

  const rows: RecognizedRow[] = [];
  let dropped = 0;
  for (const item of arr) {
    const row = validateOne(item);
    if (row) {
      rows.push(row);
    } else {
      dropped++;
    }
  }
  return { rows, dropped };
}

export interface RecognizeSheetOpts {
  chatFn?: typeof chatComplete;
  maxRows?: number;
  maxChars?: number;
}

export interface RecognizeSheetResult {
  rows: RecognizedRow[];
  dropped: number;
  failedChunks: number;
  /** 输出被截断但抢救出部分行的分块数（可能有更多行因截断而永久丢失，具体数量不可知）。 */
  truncatedChunks: number;
}

interface ChunkAttemptResult {
  rows: RecognizedRow[];
  dropped: number;
  truncated: boolean;
}

/** 对单个分块调用 AI 并解析、校验；解析/校验失败（含 chatFn 抛错）时向上抛错，由调用方决定重试策略。 */
async function attemptChunk(
  cfg: AiConfig,
  sheetName: string,
  chunk: string[][],
  chatFn: typeof chatComplete,
): Promise<ChunkAttemptResult> {
  const messages = buildPrompt(sheetName, chunk);
  const text = await chatFn(cfg, messages, { maxTokens: 8000 });
  const { value, truncated } = extractJsonLenient(text);
  const result = validateRecognizedRows(value);
  return { rows: result.rows, dropped: result.dropped, truncated };
}

/**
 * 分块串行调用 AI 识别一个 sheet，合并所有分块的校验结果。
 *
 * 单块失败（chatFn 抛错、输出无法解析/抢救等）不会导致整表丢弃：若该块数据行数 >1，
 * 对半拆成两个子块各重试一次（不再递归），子块成功计入 rows，子块失败计入 failedChunks；
 * 块只有 1 行数据则直接计入 failedChunks。
 *
 * 单块输出被截断（超出 token 预算）但能抢救出前 N 个完整对象时：抢救出的行照常校验入 rows，
 * 该块不计入 failedChunks，但计入 truncatedChunks（供 UI 提示「输出被截断，可能有部分行永久丢失」）。
 */
export async function recognizeSheet(
  cfg: AiConfig,
  sheetName: string,
  grid: string[][],
  opts: RecognizeSheetOpts = {},
): Promise<RecognizeSheetResult> {
  const chatFn = opts.chatFn ?? chatComplete;
  const chunks = chunkGrid(grid, { maxRows: opts.maxRows, maxChars: opts.maxChars });

  const rows: RecognizedRow[] = [];
  let dropped = 0;
  let failedChunks = 0;
  let truncatedChunks = 0;

  const applyResult = (result: ChunkAttemptResult): void => {
    rows.push(...result.rows);
    dropped += result.dropped;
    if (result.truncated) truncatedChunks++;
  };

  for (const chunk of chunks) {
    try {
      applyResult(await attemptChunk(cfg, sheetName, chunk, chatFn));
    } catch {
      const { headerRows, bodyRows } = detectHeaderRows(chunk);
      if (bodyRows.length > 1) {
        const mid = Math.ceil(bodyRows.length / 2);
        const subChunks = [
          [...headerRows, ...bodyRows.slice(0, mid)],
          [...headerRows, ...bodyRows.slice(mid)],
        ];
        for (const sub of subChunks) {
          try {
            applyResult(await attemptChunk(cfg, sheetName, sub, chatFn));
          } catch {
            failedChunks++;
          }
        }
      } else {
        failedChunks++;
      }
    }
  }
  return { rows, dropped, failedChunks, truncatedChunks };
}
