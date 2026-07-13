import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import * as core from '../../../src/core/index';
import { exportProjectToFiles, sanitizeSheetName } from '../../../src/core/export/exportProject';

function buildDb() {
  const db = core.openDb(':memory:');
  const pj = core.createProject(db, { name: '翔威新能源', defaultMargin: 1.3 });
  const sec = core.createSection(db, { projectId: pj.id, name: '展厅多媒体硬件', integrationFeeRate: 0.05 });
  const sp = core.createSpace(db, { sectionId: sec.id, name: '序厅' });
  core.createLineItem(db, {
    spaceId: sp.id, qty: 2,
    snapshot: {
      name: '媒体服务器', brand: null, model: null, recommendedBrands: [],
      paramsCore: 'I7-14700', paramsBid: null, paramsTender: null, unit: '套', dims: null,
      power220W: 600, power380W: 0, rackU: 4, seqPowerPorts: 1, netPorts: 1, comPorts: 0,
      costUnitCents: 2100000, optionsApplied: [],
    },
  });
  return { db, pj };
}

describe('sanitizeSheetName', () => {
  it('replaces illegal chars and truncates to 31', () => {
    expect(sanitizeSheetName('a/b:c*d?e[f]g\\h')).toBe('a_b_c_d_e_f_g_h');
    expect(sanitizeSheetName('x'.repeat(40))).toHaveLength(31);
  });
});

describe('exportProjectToFiles', () => {
  it('writes 3 variant files with correct structure', async () => {
    const { db, pj } = buildDb();
    const dir = mkdtempSync(join(tmpdir(), 'aiq-'));
    const files = await exportProjectToFiles(db, pj.id, dir);
    expect(files).toHaveLength(3);
    expect(files[0]).toContain('含成本完整版');

    const full = new ExcelJS.Workbook();
    await full.xlsx.readFile(files[0]);
    expect(full.worksheets.map(w => w.name)).toEqual(['汇总表', '展厅多媒体硬件']);
    const dws = full.getWorksheet('展厅多媒体硬件')!;
    expect(dws.getCell('F5').value).toBe(27300); // 21000*1.3
    const sws = full.getWorksheet('汇总表')!;
    expect((sws.getCell('C3').value as any).formula).toBe("'展厅多媒体硬件'!G8");

    const ext = new ExcelJS.Workbook();
    await ext.xlsx.readFile(files[1]);
    const ews = ext.getWorksheet('展厅多媒体硬件')!;
    const headers: string[] = [];
    ews.getRow(3).eachCell(c => headers.push(String(c.value)));
    expect(headers).toEqual(['序号','项目名称','核心参数','单位','数量','单价','合计','备注']);

    const impl = new ExcelJS.Workbook();
    await impl.xlsx.readFile(files[2]);
    expect(impl.worksheets.map(w => w.name)).toEqual(['展厅多媒体硬件']);
  });
});

function buildPricingDb(mode: 'pricing' | 'tender') {
  const db = core.openDb(':memory:');
  const pj = core.createProject(db, { name: '玉海楼', mode, defaultMargin: 1.3 });
  const sec = core.createSection(db, { projectId: pj.id, name: '展厅多媒体硬件', integrationFeeRate: 0.05 });
  const sp = core.createSpace(db, { sectionId: sec.id, name: '序厅' });
  core.createLineItem(db, {
    spaceId: sp.id, qty: 2,
    snapshot: {
      name: '媒体服务器', brand: null, model: null, recommendedBrands: ['戴尔', '惠普', '联想'],
      paramsCore: 'I7-14700', paramsBid: '招标参数：I7-14700', paramsTender: '投标参数：I7-14700',
      unit: '套', dims: null,
      power220W: 600, power380W: 0, rackU: 4, seqPowerPorts: 1, netPorts: 1, comPorts: 0,
      costUnitCents: 2100000, optionsApplied: [],
    },
  });
  return { db, pj };
}

describe('exportProjectToFiles pricing mode', () => {
  it('exports 造价清单 with 招标参数 header, paramsBid content, brands column', async () => {
    const { db, pj } = buildPricingDb('pricing');
    const dir = mkdtempSync(join(tmpdir(), 'aiq-pricing-'));
    const files = await exportProjectToFiles(db, pj.id, dir);
    expect(files).toHaveLength(3);
    expect(files[0]).toContain('造价清单');
    expect(files[0]).toContain('含成本完整版');

    const full = new ExcelJS.Workbook();
    await full.xlsx.readFile(files[0]);
    const dws = full.getWorksheet('展厅多媒体硬件')!;
    expect(dws.getCell('C3').value).toBe('招标参数');
    expect(dws.getCell('C5').value).toBe('招标参数：I7-14700');
    expect(dws.getCell('I3').value).toBe('推荐品牌');
    expect(dws.getCell('I5').value).toBe('戴尔、惠普、联想');
  });
});

describe('exportProjectToFiles tender mode', () => {
  it('exports 投标造价清单 with 投标参数 header, no dims/tech columns, implementation variant trimmed', async () => {
    const { db, pj } = buildPricingDb('tender');
    const dir = mkdtempSync(join(tmpdir(), 'aiq-tender-'));
    const files = await exportProjectToFiles(db, pj.id, dir);
    expect(files[0]).toContain('投标造价清单');

    const full = new ExcelJS.Workbook();
    await full.xlsx.readFile(files[0]);
    const dws = full.getWorksheet('展厅多媒体硬件')!;
    const headers: string[] = [];
    dws.getRow(3).eachCell(c => headers.push(String(c.value)));
    expect(headers).toEqual(['序号','项目名称','投标参数','单位','数量','单价','合计','备注','成本单价','成本合计','比例']);
    expect(dws.getCell('C5').value).toBe('投标参数：I7-14700');

    const impl = new ExcelJS.Workbook();
    await impl.xlsx.readFile(files[2]);
    const iws = impl.getWorksheet('展厅多媒体硬件')!;
    const implHeaders: string[] = [];
    iws.getRow(3).eachCell(c => implHeaders.push(String(c.value)));
    expect(implHeaders).toEqual(['序号','项目名称','投标参数','单位','数量','备注']);
  });
});

describe('exportProjectToFiles estimate mode', () => {
  it('exports a single 项目总投资估算表 file', async () => {
    const db = core.openDb(':memory:');
    const pj = core.createProject(db, { name: 'P', mode: 'estimate', defaultMargin: 1.3 });
    core.seedDefaultCategories(db, pj.id);
    const dir = mkdtempSync(join(tmpdir(), 'aiq-estimate-'));
    const files = await exportProjectToFiles(db, pj.id, dir);
    expect(files).toHaveLength(1);
    expect(files[0]).toContain('项目总投资估算表');
  });
});

describe('duplicate section names', () => {
  it('dedupes sheet names and keeps summary refs resolvable', async () => {
    const db = core.openDb(':memory:');
    const pj = core.createProject(db, { name: 'P', defaultMargin: 1.3 });
    core.createSection(db, { projectId: pj.id, name: '硬件' });
    core.createSection(db, { projectId: pj.id, name: '硬件' });
    const dir = mkdtempSync(join(tmpdir(), 'aiq-dup-'));
    const files = await exportProjectToFiles(db, pj.id, dir);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(files[0]);
    expect(wb.worksheets.map(w => w.name)).toEqual(['汇总表', '硬件', '硬件(2)']);
    const sws = wb.getWorksheet('汇总表')!;
    expect((sws.getCell('C4').value as any).formula).toContain("'硬件(2)'!");
  });
});
