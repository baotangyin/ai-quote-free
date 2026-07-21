import type { ChatMessage, ChatCompleteOpts } from '../ai/client';
import { extractJson } from '../ai/json';
import type { ExportTemplateConfig, TemplateColumn } from '../domain/types';
import { KNOWN_COLUMN_KEYS, validateExportTemplateConfig } from '../repo/exportTemplates';
import { FACTORY_CONFIG } from '../export/factoryTemplate';

/** AI 识别客户 xlsx 生成的导出模板草稿。 */
export interface ParsedTemplateDraft {
  config: ExportTemplateConfig;
  ignoredColumns: string[];
}

/**
 * 注入的 AI 调用：已绑定 AiConfig（由调用方——如 IPC handler——闭包提供），
 * 只需传 messages（+可选 opts），便于测试直接 mock，无需构造 AiConfig。
 */
export type ChatFn = (messages: ChatMessage[], opts?: ChatCompleteOpts) => Promise<string>;

const MAX_GRID_ROWS = 30;

/** 系统列 key -> 出厂默认表头名（与 columns.ts BUDGET_COLUMNS 一致，brands 取 PRICING_COLUMNS 定义）。 */
const DEFAULT_COLUMN_LABELS: Record<string, string> = {
  xh: '序号',
  name: '项目名称',
  params: '核心参数',
  unit: '单位',
  qty: '数量',
  unitPrice: '单价',
  total: '合计',
  remark: '备注',
  brands: '推荐品牌',
  dims: '规格尺寸',
  costUnit: '成本单价',
  costTotal: '成本合计',
  power220: '220V用电量',
  power380: '380V用电量',
  rackU: '机柜',
  seqPower: '时序电源',
  netPorts: '网口',
  comPorts: 'com口',
  ratio: '比例',
};

/** 系统列 key 含义说明（供 AI 映射提示词使用）。 */
const COLUMN_KEY_MEANINGS: Array<[string, string]> = [
  ['xh', '序号'],
  ['name', '名称'],
  ['params', '规格参数'],
  ['unit', '单位'],
  ['qty', '数量'],
  ['unitPrice', '单价'],
  ['total', '合计'],
  ['remark', '备注'],
  ['brands', '推荐品牌'],
  ['dims', '规格尺寸'],
  ['costUnit', '成本单价'],
  ['costTotal', '成本合计'],
  ['power220', '220V用电量'],
  ['power380', '380V用电量'],
  ['rackU', '机柜'],
  ['seqPower', '时序电源'],
  ['netPorts', '网口'],
  ['comPorts', 'com口'],
  ['ratio', '比例'],
];

/** 构造模板识别提示词：全中文，风格随 recognize.ts buildPrompt，要求严格 JSON 输出。 */
export function buildTemplatePrompt(grid: string[][]): ChatMessage[] {
  const tsv = grid.map((row) => row.join('\t')).join('\n');

  const keyList = COLUMN_KEY_MEANINGS.map(([key, meaning]) => `- ${key}：${meaning}`).join('\n');

  const system = [
    '你是专业的弱电智能化工程报价单模板识别助手。',
    '任务：分析用户提供的客户报价单表格（TSV 格式的前若干行），识别表格标题、公司名称、表头行位置，',
    '并将每一列的原始表头文字映射到我方系统已有的列 key（无法映射的列 mappedKey 填 null）。',
    '输出为严格的 JSON 对象，不要输出任何解释性文字，不要使用 Markdown 代码围栏。',
    '',
    '我方系统列 key 全集及含义：',
    keyList,
    '',
    'JSON 输出格式：',
    '{',
    '  "title": string | null,          // 表格标题（如"XX工程报价单"），没有则为 null',
    '  "companyName": string | null,    // 公司抬头名称，没有则为 null',
    '  "headerRowIndex": number,        // 表头所在行号（从 0 开始）',
    '  "columns": [ { "sourceLabel": string, "mappedKey": string | null } ],  // 按来源列顺序，逐列给出原始表头文字与映射的系统列 key',
    '  "summaryLabels": string[]        // 表格中出现的合计/小计等汇总行文字（无则为 []）',
    '}',
    '',
    '规则：',
    '1. mappedKey 只能是上面列出的系统列 key 之一，或 null（无法映射时）。',
    '2. sourceLabel 保留原始表头文字，不要翻译或改写。',
    '3. 严格输出 JSON 对象，不要有多余文字、不要使用 Markdown 代码围栏。',
  ].join('\n');

  const user = `表格内容（TSV，每行以制表符分隔）：\n${tsv}`;

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

function toNullableString(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * grid：客户 xlsx 首个数据 sheet 前 30 行文本网格（调用方负责截取；此处仍做一次防御性截断）。
 * chat：注入的 AI 调用（已绑定 AiConfig），便于测试 mock。
 *
 * 组装结果必须通过 validateExportTemplateConfig；AI 输出全部列都无法映射时抛
 * 「未能从文件中识别出任何可映射的列」；AI 输出无法解析为 JSON 时抛「AI输出无法解析」（extractJson 抛出）。
 */
export async function parseTemplateFromGrid(grid: string[][], chat: ChatFn): Promise<ParsedTemplateDraft> {
  const truncatedGrid = grid.slice(0, MAX_GRID_ROWS);
  const messages = buildTemplatePrompt(truncatedGrid);
  const text = await chat(messages, { maxTokens: 4096 });

  const parsed = extractJson(text);
  const obj = (parsed !== null && typeof parsed === 'object' ? parsed : {}) as Record<string, unknown>;

  const title = toNullableString(obj.title);
  const companyName = toNullableString(obj.companyName);
  const columnsRaw = Array.isArray(obj.columns) ? obj.columns : [];

  const columns: TemplateColumn[] = [];
  const ignoredColumns: string[] = [];

  for (const item of columnsRaw) {
    if (item === null || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const sourceLabel = toNullableString(o.sourceLabel);
    if (!sourceLabel) continue;

    const mappedKey = typeof o.mappedKey === 'string' ? o.mappedKey : null;
    if (mappedKey && (KNOWN_COLUMN_KEYS as readonly string[]).includes(mappedKey)) {
      const label = DEFAULT_COLUMN_LABELS[mappedKey] === sourceLabel ? null : sourceLabel;
      columns.push({ key: mappedKey, label, width: null });
    } else {
      ignoredColumns.push(sourceLabel);
    }
  }

  if (columns.length === 0) {
    throw new Error('未能从文件中识别出任何可映射的列');
  }

  const config: ExportTemplateConfig = {
    header: {
      ...FACTORY_CONFIG.header,
      detailTitle: title ?? FACTORY_CONFIG.header.detailTitle,
      companyName: companyName ?? FACTORY_CONFIG.header.companyName,
    },
    style: { ...FACTORY_CONFIG.style },
    versions: [
      {
        key: 'v1',
        name: '客户格式',
        columns,
        includeSummarySheet: false,
        summaryRows: { ...FACTORY_CONFIG.versions[0].summaryRows },
      },
    ],
  };

  return { config: validateExportTemplateConfig(config), ignoredColumns };
}
