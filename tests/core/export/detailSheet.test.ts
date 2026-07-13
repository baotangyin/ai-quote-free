import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import * as core from '../../../src/core/index';
import { assembleExportModel } from '../../../src/core/export/model';
import { writeDetailSheet } from '../../../src/core/export/detailSheet';
import { BUDGET_COLUMNS, PRICING_COLUMNS, TENDER_COLUMNS, resolveColumns, type ColumnDef } from '../../../src/core/export/columns';
import { FACTORY_CONFIG } from '../../../src/core/export/factoryTemplate';

/**
 * variants/columnsForVariant 机制已随重构删除（见 columns.ts）；本文件的断言均为出厂等价基准，
 * 一行不改。此处仅用出厂 FACTORY_CONFIG 版本列 + resolveColumns 重建等价的列集构造 helper。
 */
function columnsForVariant(cols: ColumnDef[], v: 'full' | 'external' | 'implementation'): ColumnDef[] {
  const version = FACTORY_CONFIG.versions.find(ver => ver.key === v)!;
  return resolveColumns(cols, version.columns);
}

function buildDb() {
  const db = core.openDb(':memory:');
  const pj = core.createProject(db, { name: '翔威新能源', defaultMargin: 1.3 });
  const sec = core.createSection(db, { projectId: pj.id, name: '展厅多媒体硬件', integrationFeeRate: 0.05 });
  const sp = core.createSpace(db, { sectionId: sec.id, name: '序厅' });
  core.createLineItem(db, {
    spaceId: sp.id, qty: 73.73,
    snapshot: {
      name: 'P1.8室内全彩LED屏', brand: null, model: null, recommendedBrands: [],
      paramsCore: '像素间距1.8mm', paramsBid: null, paramsTender: null, unit: '㎡', dims: '7680*1600',
      power220W: 800, power380W: 0, rackU: 0, seqPowerPorts: 1, netPorts: 0, comPorts: 0,
      costUnitCents: 480000, optionsApplied: [],
    },
  });
  return { db, pj };
}

describe('writeDetailSheet full variant', () => {
  it('writes title, headers, space row, item row with live formulas, footers', () => {
    const { db, pj } = buildDb();
    const m = assembleExportModel(db, pj.id);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('展厅多媒体硬件');
    const cols = columnsForVariant(BUDGET_COLUMNS, 'full');
    const refs = writeDetailSheet(ws, m.sections[0], m.project.name, cols);

    expect(ws.getCell('A1').value).toBe('概 算 明 细 表');
    expect(ws.getCell('A2').value).toBe('工程名称：翔威新能源-展厅多媒体硬件');
    expect(ws.getCell('A3').value).toBe('序号');
    expect(ws.getCell('G3').value).toBe('合计');
    // 空间行row4：汉字序号 + SUM 公式
    expect(ws.getCell('A4').value).toBe('一');
    expect(ws.getCell('B4').value).toBe('序厅');
    expect((ws.getCell('G4').value as any).formula).toBe('SUM(G5:G5)');
    // 设备行row5：单价 6240 元、合计公式、成本 4800 元、用电量公式
    expect(ws.getCell('A5').value).toBe(1);
    expect(ws.getCell('F5').value).toBe(6240);
    expect((ws.getCell('G5').value as any).formula).toBe('E5*F5');
    expect(ws.getCell('J5').value).toBe(4800);
    expect((ws.getCell('L5').value as any).formula).toBe('800*E5');
    expect((ws.getCell('R5').value as any).formula).toBe('F5/J5');
    // 尾部：小计row6、集成费row7、合计row8、技术指标row9
    // 导出默认小计文案变更为「{板块名}小计」（本用例板块名"展厅多媒体硬件"）
    expect(ws.getCell('B6').value).toBe('展厅多媒体硬件小计');
    expect((ws.getCell('G6').value as any).formula).toBe('G4');
    expect(ws.getCell('B7').value).toBe('系统集成费(5%)');
    expect((ws.getCell('G7').value as any).formula).toBe('G6*0.05');
    expect(ws.getCell('B8').value).toBe('合计');
    expect((ws.getCell('G8').value as any).formula).toBe('G6+G7');
    expect(refs.totalRow).toBe(8);
    expect(ws.getCell('B9').value).toBe('技术指标合计');
    expect((ws.getCell('L9').value as any).formula).toBe('SUM(L5:L5)');

    // 对齐样式：params(C) 自动换行+左对齐+垂直居中；qty(E) 右对齐；xh(A)/unit(D) 居中；money numFmt 不受影响
    const paramsCell = ws.getCell('C5');
    expect(paramsCell.alignment).toEqual({ vertical: 'middle', horizontal: 'left', wrapText: true });
    const qtyCell = ws.getCell('E5');
    expect(qtyCell.alignment).toEqual({ vertical: 'middle', horizontal: 'right', wrapText: undefined });
    expect(ws.getCell('A5').alignment.horizontal).toBe('center');
    expect(ws.getCell('D5').alignment.horizontal).toBe('center');
    expect(ws.getCell('F5').numFmt).toBe('#,##0.00'); // 单价 numFmt 未被对齐覆盖
    expect(ws.getCell('F5').alignment.horizontal).toBe('right');
  });
});

describe('writeDetailSheet 小计/集成费行文案', () => {
  it('自定义 subtotalLabel/feeLabel 时优先于板块名默认值', () => {
    const db = core.openDb(':memory:');
    const pj = core.createProject(db, { name: '翔威新能源', defaultMargin: 1.3 });
    const sec = core.createSection(db, {
      projectId: pj.id, name: '展厅多媒体硬件', integrationFeeRate: 0.05,
      subtotalLabel: '硬件设备合价', feeLabel: '系统集成服务费',
    });
    const sp = core.createSpace(db, { sectionId: sec.id, name: '序厅' });
    core.createLineItem(db, {
      spaceId: sp.id, qty: 1,
      snapshot: {
        name: 'X', brand: null, model: null, recommendedBrands: [],
        paramsCore: null, paramsBid: null, paramsTender: null, unit: '台', dims: null,
        power220W: 0, power380W: 0, rackU: 0, seqPowerPorts: 0, netPorts: 0, comPorts: 0,
        costUnitCents: 100, optionsApplied: [],
      },
    });
    const m = assembleExportModel(db, pj.id);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('x');
    writeDetailSheet(ws, m.sections[0], m.project.name, columnsForVariant(BUDGET_COLUMNS, 'full'));
    expect(ws.getCell('B6').value).toBe('硬件设备合价');
    expect(ws.getCell('B7').value).toBe('系统集成服务费(5%)');
  });

  it('未设置 subtotalLabel/feeLabel 时回退为「{板块名}小计」/「系统集成费」默认值', () => {
    const { db, pj } = buildDb();
    const m = assembleExportModel(db, pj.id);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('x');
    writeDetailSheet(ws, m.sections[0], m.project.name, columnsForVariant(BUDGET_COLUMNS, 'full'));
    expect(ws.getCell('B6').value).toBe('展厅多媒体硬件小计');
    expect(ws.getCell('B7').value).toBe('系统集成费(5%)');
  });
});

describe('writeDetailSheet implementation variant', () => {
  it('has no price columns and no price footer rows, keeps tech totals', () => {
    const { db, pj } = buildDb();
    const m = assembleExportModel(db, pj.id);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('x');
    const cols = columnsForVariant(BUDGET_COLUMNS, 'implementation');
    writeDetailSheet(ws, m.sections[0], m.project.name, cols);
    const headers: string[] = [];
    ws.getRow(3).eachCell(c => headers.push(String(c.value)));
    expect(headers).not.toContain('单价');
    expect(headers).not.toContain('成本单价');
    expect(headers).toContain('220V用电量');
    // row6 直接是技术指标合计（无小计/集成费/合计行）
    expect(ws.getCell('B6').value).toBe('技术指标合计');
  });
});

describe('writeDetailSheet paramsField and brands', () => {
  function buildPricingDb() {
    const db = core.openDb(':memory:');
    const pj = core.createProject(db, { name: '翔威新能源', mode: 'pricing', defaultMargin: 1.3 });
    const sec = core.createSection(db, { projectId: pj.id, name: '展厅多媒体硬件', integrationFeeRate: 0.05 });
    const sp = core.createSpace(db, { sectionId: sec.id, name: '序厅' });
    core.createLineItem(db, {
      spaceId: sp.id, qty: 2,
      snapshot: {
        name: 'P1.8室内全彩LED屏', brand: null, model: null, recommendedBrands: ['利亚德', '洲明', '索尼'],
        paramsCore: '核心参数文本', paramsBid: '招标参数文本', paramsTender: '投标参数文本',
        unit: '㎡', dims: '7680*1600',
        power220W: 800, power380W: 0, rackU: 0, seqPowerPorts: 1, netPorts: 0, comPorts: 0,
        costUnitCents: 480000, optionsApplied: [],
      },
    });
    return { db, pj };
  }

  it('uses paramsBid and fills brands column for pricing mode columns', () => {
    const { db, pj } = buildPricingDb();
    const m = assembleExportModel(db, pj.id);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('展厅多媒体硬件');
    const cols = columnsForVariant(PRICING_COLUMNS, 'full');
    writeDetailSheet(ws, m.sections[0], m.project.name, cols, 'paramsBid');
    expect(ws.getCell('C3').value).toBe('招标参数');
    expect(ws.getCell('C5').value).toBe('招标参数文本');
    expect(ws.getCell('I3').value).toBe('推荐品牌');
    expect(ws.getCell('I5').value).toBe('利亚德、洲明、索尼');
  });

  it('defaults to paramsCore when paramsField omitted (backward compat)', () => {
    const { db, pj } = buildPricingDb();
    const m = assembleExportModel(db, pj.id);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('x');
    writeDetailSheet(ws, m.sections[0], m.project.name, columnsForVariant(BUDGET_COLUMNS, 'full'));
    expect(ws.getCell('C5').value).toBe('核心参数文本');
  });

  it('tender columns use paramsTender, skip tech totals row (no tech columns)', () => {
    const { db, pj } = buildPricingDb();
    const m = assembleExportModel(db, pj.id);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('t');
    const cols = columnsForVariant(TENDER_COLUMNS, 'full');
    const refs = writeDetailSheet(ws, m.sections[0], m.project.name, cols, 'paramsTender');
    expect(ws.getCell('C3').value).toBe('投标参数');
    expect(ws.getCell('C5').value).toBe('投标参数文本');
    // 尾部：小计row6、集成费row7、合计row8——无技术指标合计行
    expect(ws.getCell('B8').value).toBe('合计');
    expect(refs.totalRow).toBe(8);
    expect(ws.getCell('B9').value).toBeNull();
  });
});

describe('writeDetailSheet custom columns', () => {
  it('renders fixedText on item rows, blank on space/summary rows', () => {
    const { db, pj } = buildDb();
    const m = assembleExportModel(db, pj.id);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('展厅多媒体硬件');
    const cols = resolveColumns(BUDGET_COLUMNS, [
      ...FACTORY_CONFIG.versions.find(v => v.key === 'full')!.columns,
      { key: 'custom-1', label: '厂家备注', width: 20, fixedText: '内部专供' },
    ]);
    writeDetailSheet(ws, m.sections[0], m.project.name, cols);
    const customCol = 'S'; // 19th column (18 factory full cols + 1 custom)
    // header
    expect(ws.getCell(`${customCol}3`).value).toBe('厂家备注');
    // item row (row 5): fixedText rendered
    expect(ws.getCell(`${customCol}5`).value).toBe('内部专供');
    // space row (row 4) and subtotal/total rows: not filled (undefined/null)
    expect(ws.getCell(`${customCol}4`).value == null).toBe(true);
    expect(ws.getCell(`${customCol}6`).value == null).toBe(true);
  });

  it('renders empty string when fixedText is null', () => {
    const { db, pj } = buildDb();
    const m = assembleExportModel(db, pj.id);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('x');
    const cols = resolveColumns(BUDGET_COLUMNS, [
      ...FACTORY_CONFIG.versions.find(v => v.key === 'full')!.columns,
      { key: 'custom-2', label: '空备注', width: null },
    ]);
    writeDetailSheet(ws, m.sections[0], m.project.name, cols);
    expect(ws.getCell('S5').value).toBe('');
  });
});

describe('writeDetailSheet edge cases', () => {
  it('empty space writes literal 0, no circular formula', () => {
    const db = core.openDb(':memory:');
    const pj = core.createProject(db, { name: 'P', defaultMargin: 1.3 });
    const sec = core.createSection(db, { projectId: pj.id, name: 'S', integrationFeeRate: 0.05 });
    core.createSpace(db, { sectionId: sec.id, name: '空空间' });
    const m = assembleExportModel(db, pj.id);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('S');
    writeDetailSheet(ws, m.sections[0], 'P', columnsForVariant(BUDGET_COLUMNS, 'full'));
    expect(ws.getCell('G4').value).toBe(0);            // 字面量而非公式
    expect(ws.getCell('K4').value).toBe(0);
    expect(ws.getCell('B5').value).toBe('S小计');
    expect((ws.getCell('G5').value as any).formula).toBe('G4');
  });
  it('section with zero spaces writes literal 0 subtotal', () => {
    const db = core.openDb(':memory:');
    const pj = core.createProject(db, { name: 'P' });
    core.createSection(db, { projectId: pj.id, name: 'S' });
    const m = assembleExportModel(db, pj.id);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('S');
    writeDetailSheet(ws, m.sections[0], 'P', columnsForVariant(BUDGET_COLUMNS, 'full'));
    expect(ws.getCell('B4').value).toBe('S小计');
    expect(ws.getCell('G4').value).toBe(0);
  });
});
