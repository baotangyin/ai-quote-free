import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import * as core from '../../../src/core/index';
import { assembleExportModel } from '../../../src/core/export/model';
import { writeDetailSheet } from '../../../src/core/export/detailSheet';
import { writeSummarySheet } from '../../../src/core/export/summarySheet';
import { exportProjectToFiles } from '../../../src/core/export/exportProject';
import { BUDGET_COLUMNS, resolveColumns, modeConfig, type ColumnDef } from '../../../src/core/export/columns';
import { FACTORY_CONFIG } from '../../../src/core/export/factoryTemplate';
import type { ExportTemplateConfig } from '../../../src/core/domain/types';

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

function cloneFactoryConfig(): ExportTemplateConfig {
  return JSON.parse(JSON.stringify(FACTORY_CONFIG));
}

describe('出厂等价冒烟：exportProjectToFiles 不传模板', () => {
  it('生成 3 个文件，文件名与改造前一致', async () => {
    const { db, pj } = buildDb();
    const dir = mkdtempSync(join(tmpdir(), 'aiq-tpl-smoke-'));
    const files = await exportProjectToFiles(db, pj.id, dir);
    expect(files).toHaveLength(3);
    expect(files[0]).toContain('翔威新能源-方案预算-含成本完整版.xlsx');
    expect(files[1]).toContain('翔威新能源-方案预算-对外报价版.xlsx');
    expect(files[2]).toContain('翔威新能源-方案预算-实施清单.xlsx');
  });
});

describe('resolveColumns', () => {
  it('保序取交集，label/width 覆盖生效', () => {
    const modeCols: ColumnDef[] = [
      { key: 'xh', header: '序号', width: 6 },
      { key: 'name', header: '项目名称', width: 28 },
      { key: 'total', header: '合计', width: 14 },
    ];
    const out = resolveColumns(modeCols, [
      { key: 'total', label: '总价', width: 20 },
      { key: 'xh', label: null, width: null },
    ]);
    expect(out.map(c => c.key)).toEqual(['total', 'xh']);
    expect(out[0].header).toBe('总价');
    expect(out[0].width).toBe(20);
    expect(out[1].header).toBe('序号');
  });

  it('模式外的列（budget 无 brands）静默跳过', () => {
    const out = resolveColumns(modeConfig('budget').columns, [
      { key: 'xh', label: null, width: null },
      { key: 'brands', label: null, width: null },
      { key: 'name', label: null, width: null },
    ]);
    expect(out.map(c => c.key)).toEqual(['xh', 'name']);
  });
});

describe('companyName 行偏移', () => {
  it('设置 companyName 时标题整体下移一行，首行为公司名', () => {
    const { db, pj } = buildDb();
    const m = assembleExportModel(db, pj.id);
    const config = cloneFactoryConfig();
    config.header.companyName = '某某集成商有限公司';
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('x');
    const cols = resolveColumns(BUDGET_COLUMNS, config.versions[0].columns);
    writeDetailSheet(ws, m.sections[0], m.project.name, cols, 'paramsCore', config, config.versions[0]);
    expect(ws.getCell('A1').value).toBe('某某集成商有限公司');
    expect(ws.getCell('A2').value).toBe('概 算 明 细 表');
    expect(ws.getCell('A3').value).toBe('工程名称：翔威新能源-展厅多媒体硬件');
    expect(ws.getCell('A4').value).toBe('序号');
    // 数据起始行也整体下移一行（原为 row4，现为 row5）
    expect(ws.getCell('A5').value).toBe('一');
  });
});

describe('footer 落款行', () => {
  it('footer 含 {日期} 占位符替换为当日日期', () => {
    const { db, pj } = buildDb();
    const m = assembleExportModel(db, pj.id);
    const config = cloneFactoryConfig();
    config.header.footer = '制表日期：{日期}';
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('x');
    const cols = resolveColumns(BUDGET_COLUMNS, config.versions[0].columns);
    writeDetailSheet(ws, m.sections[0], m.project.name, cols, 'paramsCore', config, config.versions[0]);
    const today = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    const ymd = `${today.getFullYear()}-${p(today.getMonth() + 1)}-${p(today.getDate())}`;
    // 找到含落款文案的单元格
    let found: string | null = null;
    ws.eachRow(row => {
      row.eachCell(cell => {
        if (typeof cell.value === 'string' && cell.value.startsWith('制表日期：')) found = cell.value;
      });
    });
    expect(found).toBe(`制表日期：${ymd}`);
  });
});

describe('taxRate 税金行 + 含税合计', () => {
  it('taxRate=0.09 生成税金(9%)行与含税合计行，公式正确', () => {
    const { db, pj } = buildDb();
    const m = assembleExportModel(db, pj.id);
    const config = cloneFactoryConfig();
    config.versions[0].summaryRows.taxRate = 0.09;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('x');
    const cols = resolveColumns(BUDGET_COLUMNS, config.versions[0].columns);
    const refs = writeDetailSheet(ws, m.sections[0], m.project.name, cols, 'paramsCore', config, config.versions[0]);
    // 原合计行 row8（税金行前）：小计row6、集成费row7、合计row8、税金row9、含税合计row10
    expect(ws.getCell('B8').value).toBe('合计');
    expect(ws.getCell('B9').value).toBe('税金(9%)');
    expect((ws.getCell('G9').value as any).formula).toBe('G8*0.09');
    expect(ws.getCell('B10').value).toBe('含税合计');
    expect((ws.getCell('G10').value as any).formula).toBe('G8+G9');
    expect(refs.totalRow).toBe(10);
  });
});

describe('spaceSubtotal=false', () => {
  it('空间行不写 SUM 公式（空间行仍存在）', () => {
    const { db, pj } = buildDb();
    const m = assembleExportModel(db, pj.id);
    const config = cloneFactoryConfig();
    config.versions[0].summaryRows.spaceSubtotal = false;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('x');
    const cols = resolveColumns(BUDGET_COLUMNS, config.versions[0].columns);
    writeDetailSheet(ws, m.sections[0], m.project.name, cols, 'paramsCore', config, config.versions[0]);
    expect(ws.getCell('B4').value).toBe('序厅'); // 空间行仍存在
    expect(ws.getCell('G4').value).toBeNull(); // 无 SUM 公式
  });
});

describe('sectionTotal=false', () => {
  it('不写设备小计与合计行，totalRow 语义同 implementation 版', () => {
    const { db, pj } = buildDb();
    const m = assembleExportModel(db, pj.id);
    const config = cloneFactoryConfig();
    config.versions[0].summaryRows.sectionTotal = false;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('x');
    const cols = resolveColumns(BUDGET_COLUMNS, config.versions[0].columns);
    const refs = writeDetailSheet(ws, m.sections[0], m.project.name, cols, 'paramsCore', config, config.versions[0]);
    expect(ws.getCell('B6').value).toBe('技术指标合计'); // 直接技术指标合计，无小计/集成费/合计行
    expect(refs.totalRow).toBe(5); // 最后一个数据行（无合计行）
  });
});

describe('自定义样式落地', () => {
  it('headerFillArgb/titleFontSize/moneyFmt 落到单元格', () => {
    const { db, pj } = buildDb();
    const m = assembleExportModel(db, pj.id);
    const config = cloneFactoryConfig();
    config.style.headerFillArgb = 'FFCCEEFF';
    config.style.titleFontSize = 20;
    config.style.moneyFmt = '0.00';
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('x');
    const cols = resolveColumns(BUDGET_COLUMNS, config.versions[0].columns);
    writeDetailSheet(ws, m.sections[0], m.project.name, cols, 'paramsCore', config, config.versions[0]);
    expect(ws.getCell('A3').fill).toEqual({ type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFCCEEFF' } });
    expect(ws.getCell('A1').font).toEqual({ size: 20, bold: true });
    expect(ws.getCell('F5').numFmt).toBe('0.00');

    const sws = wb.addWorksheet('汇总');
    writeSummarySheet(sws, m, ['x'], [{ totalRow: 8 }], ['G'], true, config);
    expect(sws.getCell('A2').fill).toEqual({ type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFCCEEFF' } });
  });
});
