import type { ExportTemplateConfig, TemplateColumn } from '../domain/types';

export const FACTORY_TEMPLATE_NAME = '标准三版本';

const col = (key: string): TemplateColumn => ({ key, label: null, width: null });

/** 全集顺序（与 PRICING_COLUMNS 一致；budget/tender 导出时与各自模式列集求交集后即现状列序）。 */
const ALL = ['xh','name','params','unit','qty','unitPrice','total','remark','brands','dims',
  'costUnit','costTotal','power220','power380','rackU','seqPower','netPorts','comPorts','ratio'];
/** 对外报价版（原 external 变体：FE/FEI 标签列）。 */
const EXTERNAL = ['xh','name','params','unit','qty','unitPrice','total','remark','brands'];
/** 实施清单（原 implementation 变体：FI/FEI 标签列，无价格）。 */
const IMPLEMENTATION = ['xh','name','params','unit','qty','remark','brands','dims',
  'power220','power380','rackU','seqPower','netPorts','comPorts'];

const SUMMARY_ROWS = { spaceSubtotal: true, integrationFee: true, sectionTotal: true, techSummary: true, taxRate: null };

/** 出厂「标准三版本」：与改造前硬编码行为逐单元格等价。 */
export const FACTORY_CONFIG: ExportTemplateConfig = {
  header: {
    detailTitle: '概 算 明 细 表',
    summaryTitle: '{项目名}\n项目总投资估算表',
    projectNameLabel: '工程名称：',
    companyName: null,
    footer: null
  },
  style: { headerFillArgb: 'FFD9D9D9', titleFontSize: 16, moneyFmt: '#,##0.00', border: true },
  versions: [
    { key: 'full', name: '含成本完整版', columns: ALL.map(col), includeSummarySheet: true, summaryRows: { ...SUMMARY_ROWS } },
    { key: 'external', name: '对外报价版', columns: EXTERNAL.map(col), includeSummarySheet: true, summaryRows: { ...SUMMARY_ROWS } },
    { key: 'implementation', name: '实施清单', columns: IMPLEMENTATION.map(col), includeSummarySheet: false, summaryRows: { ...SUMMARY_ROWS } }
  ]
};
