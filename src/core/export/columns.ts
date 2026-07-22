import type { QuoteMode } from '../domain/types';
import type { TemplateColumn } from '../domain/types';

export type Align = 'left' | 'center' | 'right';

export interface ColumnDef {
  key: string; header: string; width: number;
  /** 数据单元格水平对齐；未指定时使用 Excel 默认（general）。 */
  align?: Align;
  /** 数据单元格是否自动换行。 */
  wrap?: boolean;
  /** 仅 custom- 前缀自定义列：数据行固定填充内容，null/未设置=空串。 */
  fixedText?: string | null;
}

/** 方案预算模式全列集。顺序即导出列顺序。 */
export const BUDGET_COLUMNS: ColumnDef[] = [
  { key: 'xh',        header: '序号',       width: 6,  align: 'center' },
  { key: 'name',      header: '项目名称',   width: 28, align: 'left', wrap: true },
  { key: 'params',    header: '核心参数',   width: 45, align: 'left', wrap: true },
  { key: 'unit',      header: '单位',       width: 6,  align: 'center' },
  { key: 'qty',       header: '数量',       width: 8,  align: 'right' },
  { key: 'unitPrice', header: '单价',       width: 12, align: 'right' },
  { key: 'total',     header: '合计',       width: 14, align: 'right' },
  { key: 'remark',    header: '备注',       width: 16, align: 'left', wrap: true },
  { key: 'dims',      header: '规格尺寸',   width: 20, align: 'left', wrap: true },
  { key: 'costUnit',  header: '成本单价',   width: 12, align: 'right' },
  { key: 'costTotal', header: '成本合计',   width: 14, align: 'right' },
  { key: 'power220',  header: '220V用电量', width: 12, align: 'right' },
  { key: 'power380',  header: '380V用电量', width: 12, align: 'right' },
  { key: 'rackU',     header: '机柜',       width: 8,  align: 'right' },
  { key: 'seqPower',  header: '时序电源',   width: 10, align: 'right' },
  { key: 'netPorts',  header: '网口',       width: 8,  align: 'right' },
  { key: 'comPorts',  header: 'com口',      width: 8,  align: 'right' },
  { key: 'ratio',     header: '比例',       width: 8,  align: 'right' },
];

/** 造价清单模式全列集：与 BUDGET 相同，参数列表头为「招标参数」，备注列之后插入推荐品牌列。 */
export const PRICING_COLUMNS: ColumnDef[] = [
  { key: 'xh',        header: '序号',       width: 6,  align: 'center' },
  { key: 'name',      header: '项目名称',   width: 28, align: 'left', wrap: true },
  { key: 'params',    header: '招标参数',   width: 45, align: 'left', wrap: true },
  { key: 'unit',      header: '单位',       width: 6,  align: 'center' },
  { key: 'qty',       header: '数量',       width: 8,  align: 'right' },
  { key: 'unitPrice', header: '单价',       width: 12, align: 'right' },
  { key: 'total',     header: '合计',       width: 14, align: 'right' },
  { key: 'remark',    header: '备注',       width: 16, align: 'left', wrap: true },
  { key: 'brands',    header: '推荐品牌',   width: 18, align: 'left', wrap: true },
  { key: 'dims',      header: '规格尺寸',   width: 20, align: 'left', wrap: true },
  { key: 'costUnit',  header: '成本单价',   width: 12, align: 'right' },
  { key: 'costTotal', header: '成本合计',   width: 14, align: 'right' },
  { key: 'power220',  header: '220V用电量', width: 12, align: 'right' },
  { key: 'power380',  header: '380V用电量', width: 12, align: 'right' },
  { key: 'rackU',     header: '机柜',       width: 8,  align: 'right' },
  { key: 'seqPower',  header: '时序电源',   width: 10, align: 'right' },
  { key: 'netPorts',  header: '网口',       width: 8,  align: 'right' },
  { key: 'comPorts',  header: 'com口',      width: 8,  align: 'right' },
  { key: 'ratio',     header: '比例',       width: 8,  align: 'right' },
];

/** 投标造价清单模式精简列集：至备注列止，含成本版仍带成本/比例列，无规格尺寸与技术列。 */
export const TENDER_COLUMNS: ColumnDef[] = [
  { key: 'xh',        header: '序号',       width: 6,  align: 'center' },
  { key: 'name',      header: '项目名称',   width: 28, align: 'left', wrap: true },
  { key: 'params',    header: '投标参数',   width: 45, align: 'left', wrap: true },
  { key: 'unit',      header: '单位',       width: 6,  align: 'center' },
  { key: 'qty',       header: '数量',       width: 8,  align: 'right' },
  { key: 'unitPrice', header: '单价',       width: 12, align: 'right' },
  { key: 'total',     header: '合计',       width: 14, align: 'right' },
  { key: 'remark',    header: '备注',       width: 16, align: 'left', wrap: true },
  { key: 'costUnit',  header: '成本单价',   width: 12, align: 'right' },
  { key: 'costTotal', header: '成本合计',   width: 14, align: 'right' },
  { key: 'ratio',     header: '比例',       width: 8,  align: 'right' },
];

export type ParamsField = 'paramsCore' | 'paramsBid' | 'paramsTender';

export interface ModeConfig {
  columns: ColumnDef[];
  paramsField: ParamsField;
  label: string;
}

/** 四种报价模式的导出配置：列集 + 参数字段 + 文件名用标签。概算模式尚未实现。 */
export function modeConfig(mode: QuoteMode): ModeConfig {
  switch (mode) {
    case 'budget':
      return { columns: BUDGET_COLUMNS, paramsField: 'paramsCore', label: '方案预算' };
    case 'pricing':
      return { columns: PRICING_COLUMNS, paramsField: 'paramsBid', label: '造价清单' };
    case 'tender':
      return { columns: TENDER_COLUMNS, paramsField: 'paramsTender', label: '投标造价清单' };
    case 'estimate':
      throw new Error('概算模式导出将在后续版本支持');
    default: {
      const _exhaustive: never = mode;
      throw new Error(`unknown mode: ${_exhaustive}`);
    }
  }
}

/**
 * 模板列序 ∩ 模式列集：保序取交集，label/width 覆盖。模板引用而模式没有的列（如 budget 无 brands）静默跳过。
 * custom- 前缀的自定义列不参与模式列集交集，恒渲染：直接映射为 { header: label, width: width??12, align: 'left' }。
 */
export function resolveColumns(modeCols: ColumnDef[], templateCols: TemplateColumn[]): ColumnDef[] {
  const byKey = new Map(modeCols.map((c) => [c.key, c]));
  const out: ColumnDef[] = [];
  for (const tc of templateCols) {
    if (tc.key.startsWith('custom-')) {
      out.push({ key: tc.key, header: tc.label!, width: tc.width ?? 12, align: 'left', fixedText: tc.fixedText ?? null });
      continue;
    }
    const base = byKey.get(tc.key);
    if (!base) continue;
    out.push({ ...base, header: tc.label ?? base.header, width: tc.width ?? base.width });
  }
  return out;
}

export function colLetter(cols: ColumnDef[], key: string): string {
  const idx = cols.findIndex(c => c.key === key);
  if (idx < 0) throw new Error(`column ${key} not in variant`);
  let n = idx + 1, s = '';
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}
