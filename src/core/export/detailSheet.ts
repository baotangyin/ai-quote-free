import type { Worksheet } from 'exceljs';
import type { ColumnDef, ParamsField } from './columns';
import { colLetter } from './columns';
import type { ExportSection } from './model';
import { cnOrdinal } from './model';
import type { ExportTemplateConfig, ExportTemplateVersion } from '../domain/types';
import { FACTORY_CONFIG } from './factoryTemplate';

export interface DetailRefs {
  /**
   * 板块合计行号（含税时为含税合计行）；无价格列的变体（implementation）无合计行，此时为最后一个数据行行号——
   * 该变体不生成汇总表，此值不被消费。
   */
  totalRow: number;
}

const THIN = { style: 'thin' as const };
const BORDER = { top: THIN, left: THIN, bottom: THIN, right: THIN };

function has(cols: ColumnDef[], key: string): boolean { return cols.some(c => c.key === key); }
function L(cols: ColumnDef[], key: string): string { return colLetter(cols, key); }

function todayYmd(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 占位符替换：{项目名}/{日期} 等，未知占位符原样保留。 */
export function applyPlaceholders(text: string, vars: Record<string, string>): string {
  return text.replace(/\{([^{}]+)\}/g, (m, key) => (key in vars ? vars[key] : m));
}

export function writeDetailSheet(
  ws: Worksheet, sec: ExportSection, projectName: string, cols: ColumnDef[],
  paramsField: ParamsField = 'paramsCore',
  config: ExportTemplateConfig = FACTORY_CONFIG,
  version: ExportTemplateVersion = FACTORY_CONFIG.versions[0],
): DetailRefs {
  const n = cols.length;
  cols.forEach((c, i) => { ws.getColumn(i + 1).width = c.width; });

  const MONEY_FMT = config.style.moneyFmt;
  const border = config.style.border !== false;
  const today = todayYmd();

  const top = config.header.companyName != null ? 1 : 0;

  if (top) {
    ws.mergeCells(1, 1, 1, n);
    const companyCell = ws.getCell(1, 1);
    companyCell.value = config.header.companyName as string;
    companyCell.font = { bold: true };
    companyCell.alignment = { horizontal: 'center', vertical: 'middle' };
  }

  ws.mergeCells(1 + top, 1, 1 + top, n);
  const title = ws.getCell(1 + top, 1);
  title.value = config.header.detailTitle;
  title.font = { size: config.style.titleFontSize, bold: true };
  title.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(1 + top).height = 28;

  ws.mergeCells(2 + top, 1, 2 + top, n);
  ws.getCell(2 + top, 1).value = `${config.header.projectNameLabel}${projectName}-${sec.section.name}`;

  cols.forEach((c, i) => {
    const cell = ws.getCell(3 + top, i + 1);
    cell.value = c.header;
    cell.font = { bold: true };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: config.style.headerFillArgb } };
    if (border) cell.border = BORDER;
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  });

  const priced = has(cols, 'total');
  const techKeys = ['power220', 'power380', 'rackU', 'seqPower', 'netPorts', 'comPorts'].filter(k => has(cols, k));
  const qtyL = L(cols, 'qty');

  let row = 4 + top;
  const spaceRows: number[] = [];
  let firstItemRow = 0, lastItemRow = 0;

  const setBorders = (r: number) => {
    for (let i = 0; i < n; i++) {
      const cell = ws.getCell(r, i + 1);
      if (border) cell.border = BORDER;
      const c = cols[i];
      cell.alignment = { vertical: 'middle', horizontal: c.align, wrapText: c.wrap };
    }
  };
  const money = (r: number, key: string, cents: number) => {
    const cell = ws.getCell(`${L(cols, key)}${r}`);
    cell.value = cents / 100; cell.numFmt = MONEY_FMT;
  };
  const formula = (r: number, key: string, f: string, fmt?: string) => {
    const cell = ws.getCell(`${L(cols, key)}${r}`);
    cell.value = { formula: f } as any; if (fmt) cell.numFmt = fmt;
  };

  const spaceSubtotalEnabled = version.summaryRows.spaceSubtotal !== false;

  for (let si = 0; si < sec.spaces.length; si++) {
    const sp = sec.spaces[si];
    const spaceRow = row;
    spaceRows.push(spaceRow);
    ws.getCell(`A${spaceRow}`).value = cnOrdinal(si + 1);
    ws.getCell(`B${spaceRow}`).value = sp.space.name;
    ws.getRow(spaceRow).font = { bold: true };
    setBorders(spaceRow);
    row++;
    const first = row;
    sp.items.forEach((it, ii) => {
      const s = it.item.snapshot;
      ws.getCell(`A${row}`).value = ii + 1;
      ws.getCell(`B${row}`).value = s.name;
      if (has(cols, 'params')) ws.getCell(`${L(cols, 'params')}${row}`).value = s[paramsField] ?? '';
      ws.getCell(`${L(cols, 'unit')}${row}`).value = s.unit;
      ws.getCell(`${qtyL}${row}`).value = it.item.qty;
      if (has(cols, 'unitPrice')) money(row, 'unitPrice', it.lt.unitPriceCents);
      if (priced) formula(row, 'total', `${qtyL}${row}*${L(cols, 'unitPrice')}${row}`, MONEY_FMT);
      if (has(cols, 'remark')) ws.getCell(`${L(cols, 'remark')}${row}`).value = it.item.remark ?? '';
      if (has(cols, 'brands')) ws.getCell(`${L(cols, 'brands')}${row}`).value = (s.recommendedBrands ?? []).join('、');
      if (has(cols, 'dims')) ws.getCell(`${L(cols, 'dims')}${row}`).value = s.dims ?? '';
      if (has(cols, 'costUnit')) money(row, 'costUnit', s.costUnitCents);
      if (has(cols, 'costTotal')) formula(row, 'costTotal', `${qtyL}${row}*${L(cols, 'costUnit')}${row}`, MONEY_FMT);
      const techVals: Record<string, number> = {
        power220: s.power220W, power380: s.power380W, rackU: s.rackU,
        seqPower: s.seqPowerPorts, netPorts: s.netPorts, comPorts: s.comPorts,
      };
      for (const k of techKeys) if (techVals[k] > 0) formula(row, k, `${techVals[k]}*${qtyL}${row}`);
      if (has(cols, 'ratio') && s.costUnitCents > 0)
        formula(row, 'ratio', `${L(cols, 'unitPrice')}${row}/${L(cols, 'costUnit')}${row}`, '0.00');
      cols.forEach((c) => {
        if (c.key.startsWith('custom-')) ws.getCell(`${L(cols, c.key)}${row}`).value = c.fixedText ?? '';
      });
      setBorders(row);
      if (!firstItemRow) firstItemRow = row;
      lastItemRow = row;
      row++;
    });
    if (priced && spaceSubtotalEnabled) {
      if (sp.items.length === 0) {
        money(spaceRow, 'total', 0);
        if (has(cols, 'costTotal')) money(spaceRow, 'costTotal', 0);
      } else {
        const tl = L(cols, 'total');
        formula(spaceRow, 'total', `SUM(${tl}${first}:${tl}${row - 1})`, MONEY_FMT);
        if (has(cols, 'costTotal')) {
          const cl = L(cols, 'costTotal');
          formula(spaceRow, 'costTotal', `SUM(${cl}${first}:${cl}${row - 1})`, MONEY_FMT);
        }
      }
    }
  }

  let totalRow = row - 1;
  const sectionTotalEnabled = version.summaryRows.sectionTotal !== false;
  if (priced && sectionTotalEnabled) {
    const tl = L(cols, 'total');
    const subtotalRow = row;
    ws.getCell(`B${subtotalRow}`).value = sec.section.subtotalLabel ?? `${sec.section.name}小计`;
    if (spaceRows.length === 0) {
      money(subtotalRow, 'total', 0);
      if (has(cols, 'costTotal')) money(subtotalRow, 'costTotal', 0);
    } else {
      formula(subtotalRow, 'total', spaceRows.map(r => `${tl}${r}`).join('+'), MONEY_FMT);
      if (has(cols, 'costTotal')) {
        const cl = L(cols, 'costTotal');
        formula(subtotalRow, 'costTotal', spaceRows.map(r => `${cl}${r}`).join('+'), MONEY_FMT);
      }
    }
    ws.getRow(subtotalRow).font = { bold: true };
    setBorders(subtotalRow);
    row++;
    let feeRow = 0;
    const rate = sec.section.integrationFeeRate;
    const integrationFeeEnabled = version.summaryRows.integrationFee !== false;
    if (rate > 0 && integrationFeeEnabled) {
      feeRow = row;
      ws.getCell(`B${feeRow}`).value = `${sec.section.feeLabel ?? '系统集成费'}(${Math.round(rate * 1000) / 10}%)`;
      formula(feeRow, 'total', `${tl}${subtotalRow}*${rate}`, MONEY_FMT);
      setBorders(feeRow);
      row++;
    }
    totalRow = row;
    ws.getCell(`B${totalRow}`).value = '合计';
    formula(totalRow, 'total', feeRow ? `${tl}${subtotalRow}+${tl}${feeRow}` : `${tl}${subtotalRow}`, MONEY_FMT);
    ws.getRow(totalRow).font = { bold: true };
    setBorders(totalRow);
    row++;

    const taxRate = version.summaryRows.taxRate;
    if (taxRate != null) {
      const preTaxRow = totalRow;
      const taxRow = row;
      ws.getCell(`B${taxRow}`).value = `税金(${Math.round(taxRate * 1000) / 10}%)`;
      formula(taxRow, 'total', `${tl}${preTaxRow}*${taxRate}`, MONEY_FMT);
      ws.getRow(taxRow).font = { bold: true };
      setBorders(taxRow);
      row++;

      const grossRow = row;
      ws.getCell(`B${grossRow}`).value = '含税合计';
      formula(grossRow, 'total', `${tl}${preTaxRow}+${tl}${taxRow}`, MONEY_FMT);
      ws.getRow(grossRow).font = { bold: true };
      setBorders(grossRow);
      row++;

      totalRow = grossRow;
    }
  }

  const techSummaryEnabled = version.summaryRows.techSummary !== false;
  if (sec.section.isHardware && techKeys.length > 0 && firstItemRow > 0 && techSummaryEnabled) {
    ws.getCell(`B${row}`).value = '技术指标合计';
    for (const k of techKeys) {
      const l = L(cols, k);
      formula(row, k, `SUM(${l}${firstItemRow}:${l}${lastItemRow})`);
    }
    ws.getRow(row).font = { bold: true };
    setBorders(row);
    row++;
  }

  if (config.header.footer != null) {
    row++; // 空一行
    const footerRow = row;
    ws.mergeCells(footerRow, 1, footerRow, n);
    const footerCell = ws.getCell(footerRow, 1);
    footerCell.value = applyPlaceholders(config.header.footer, { 项目名: projectName, 日期: today });
    footerCell.alignment = { horizontal: 'left', vertical: 'middle' };
    row++;
  }

  return { totalRow };
}
