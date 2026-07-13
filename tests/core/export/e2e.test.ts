import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import * as core from '../../../src/core/index';
import { exportProjectToFiles } from '../../../src/core/export/exportProject';

const snap = (name: string, cost: number, extra: Partial<core.LineItemSnapshot> = {}): core.LineItemSnapshot => ({
  name, brand: null, model: null, recommendedBrands: [],
  paramsCore: '参数', paramsBid: null, paramsTender: null, unit: '套', dims: null,
  power220W: 0, power380W: 0, rackU: 0, seqPowerPorts: 0, netPorts: 0, comPorts: 0,
  costUnitCents: cost, optionsApplied: [], ...extra,
});

describe('端到端：双板块多空间导出', () => {
  it('exports full workbook with correct cross-refs and footers', async () => {
    const db = core.openDb(':memory:');
    const pj = core.createProject(db, { name: '翔威新能源', defaultMargin: 1.3 });
    const hw = core.createSection(db, { projectId: pj.id, name: '展厅多媒体硬件', integrationFeeRate: 0.05 });
    const sw = core.createSection(db, { projectId: pj.id, name: '软件影片', isHardware: false });
    const s1 = core.createSpace(db, { sectionId: hw.id, name: '序厅' });
    const s2 = core.createSpace(db, { sectionId: hw.id, name: '企业篇' });
    const s3 = core.createSpace(db, { sectionId: sw.id, name: '序厅' });
    core.createLineItem(db, { spaceId: s1.id, snapshot: snap('LED屏', 480000, { power220W: 800, unit: '㎡' }), qty: 73.73 });
    core.createLineItem(db, { spaceId: s1.id, snapshot: snap('媒体服务器', 2100000, { power220W: 600, rackU: 4, netPorts: 1 }), qty: 1 });
    core.createLineItem(db, { spaceId: s2.id, snapshot: snap('拼接屏', 220000), qty: 6 });
    core.createLineItem(db, { spaceId: s3.id, snapshot: snap('影片制作', 5000000), qty: 1 });

    const dir = mkdtempSync(join(tmpdir(), 'aiq-e2e-'));
    const [fullFile] = await exportProjectToFiles(db, pj.id, dir);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(fullFile);

    expect(wb.worksheets.map(w => w.name)).toEqual(['汇总表', '展厅多媒体硬件', '软件影片']);
    const hwWs = wb.getWorksheet('展厅多媒体硬件')!;
    // 结构：4空间一 5,6设备 7空间二 8设备 9小计 10集成费 11合计 12技术指标
    expect(hwWs.getCell('A4').value).toBe('一');
    expect(hwWs.getCell('A7').value).toBe('二');
    expect((hwWs.getCell('G7').value as any).formula).toBe('SUM(G8:G8)');
    expect(hwWs.getCell('B9').value).toBe('展厅多媒体硬件小计');
    expect((hwWs.getCell('G9').value as any).formula).toBe('G4+G7');
    expect(hwWs.getCell('B12').value).toBe('技术指标合计');
    const swWs = wb.getWorksheet('软件影片')!;
    // 软件板块：4空间 5设备 6小计 7合计（无集成费、无技术指标）
    expect(swWs.getCell('B6').value).toBe('软件影片小计');
    expect(swWs.getCell('B7').value).toBe('合计');
    expect(swWs.getCell('B8').value).toBeFalsy();
    const sums = wb.getWorksheet('汇总表')!;
    expect((sums.getCell('C3').value as any).formula).toBe("'展厅多媒体硬件'!G11");
    expect((sums.getCell('C4').value as any).formula).toBe("'软件影片'!G7");
    expect((sums.getCell('C5').value as any).formula).toBe('SUM(C3:C4)');
  });
});
