import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import * as core from '../../../src/core/index';
import { writeEstimateSheet } from '../../../src/core/export/estimateSheet';
import { exportProjectToFiles } from '../../../src/core/export/exportProject';
import type { AssembledEstimate } from '../../../src/core/domain/estimate';
import type { EstimateRow, EstimateCategory } from '../../../src/core/domain/types';

function cat(id: number, name: string): EstimateCategory {
  return { id, projectId: 1, name, sortOrder: id, createdAt: '', updatedAt: '' };
}
function row(id: number, categoryId: number, patch: Partial<EstimateRow>): EstimateRow {
  return {
    id, categoryId, name: `row${id}`, sortOrder: id, valueMethod: 'manual',
    manualAmountCents: null, coefBaseCents: null, coefFactor: null, refSectionId: null,
    remark: null, createdAt: '', updatedAt: '', ...patch,
  };
}

function sampleAssembled(): AssembledEstimate {
  return {
    projectId: 1,
    categories: [
      {
        category: cat(1, '布展装饰工程费'),
        rows: [
          { row: row(1, 1, { name: '地面工程', valueMethod: 'manual', manualAmountCents: 100000 }), amountCents: 100000 },
          { row: row(2, 1, { name: '墙面工程', valueMethod: 'coefficient', coefFactor: 0.05 }), amountCents: 5000 },
          { row: row(3, 1, { name: '集成', valueMethod: 'sectionRef', refSectionId: 9 }), amountCents: 20000 },
        ],
        subtotalCents: 125000,
      },
      {
        category: cat(2, '其他费用'),
        rows: [
          { row: row(4, 2, { name: '设计费', valueMethod: 'manual', manualAmountCents: 30000, remark: '自定义备注' }), amountCents: 30000 },
        ],
        subtotalCents: 30000,
      },
    ],
    grandTotalCents: 155000,
  };
}

describe('writeEstimateSheet', () => {
  it('writes title, header, category formulas, child values, remarks and total', () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('项目总投资估算表');
    writeEstimateSheet(ws, sampleAssembled(), '瑞安博物馆');

    expect(String(ws.getCell('A1').value)).toContain('项目总投资估算表');
    expect(String(ws.getCell('A1').value)).toContain('瑞安博物馆');

    const headers: string[] = [];
    ws.getRow(2).eachCell(c => headers.push(String(c.value)));
    expect(headers).toEqual(['序号', '费用名称', '估算金额（万元）', '备注']);

    // 大类1 行3，子项 4-6；大类2 行7，子项 8；总投资 行9
    expect(ws.getCell('A3').value).toBe('一');
    expect(ws.getCell('B3').value).toBe('布展装饰工程费');
    expect((ws.getCell('C3').value as any).formula).toBe('SUM(C4:C6)');

    expect(ws.getCell('A4').value).toBe(1);
    expect(ws.getCell('B4').value).toBe('地面工程');
    expect(ws.getCell('C4').value).toBe(0.1); // 100000分 = 0.1万元
    expect(ws.getCell('D4').value).toBe(''); // manual 无备注

    expect(ws.getCell('D5').value).toBe('系数法 0.05');
    expect(ws.getCell('D6').value).toBe('引用清单板块合价');

    expect(ws.getCell('A7').value).toBe('二');
    expect((ws.getCell('C7').value as any).formula).toBe('SUM(C8:C8)');
    expect(ws.getCell('D8').value).toBe('自定义备注'); // 显式 remark 优先

    expect(ws.getCell('B9').value).toBe('总投资');
    expect((ws.getCell('C9').value as any).formula).toBe('C3+C7');
  });

  it('writes 0 for empty category and empty total', () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('s');
    const empty: AssembledEstimate = { projectId: 1, categories: [], grandTotalCents: 0 };
    writeEstimateSheet(ws, empty, 'P');
    // 无大类：总投资行在行3，C 为静态 0
    expect(ws.getCell('B3').value).toBe('总投资');
    expect(ws.getCell('C3').value).toBe(0);
  });
});

describe('exportProjectToFiles estimate mode', () => {
  const dirs: string[] = [];
  afterEach(() => { dirs.forEach(d => rmSync(d, { recursive: true, force: true })); dirs.length = 0; });

  it('exports a single 项目总投资估算表 file with 总投资 row', async () => {
    const db = core.openDb(':memory:');
    const pj = core.createProject(db, { name: '瑞安博物馆', mode: 'estimate', defaultMargin: 1.3 });
    core.seedDefaultCategories(db, pj.id);
    const firstCat = core.listEstimateCategories(db, pj.id)[0];
    const firstRow = core.listEstimateRows(db, firstCat.id)[0];
    core.updateEstimateRow(db, firstRow.id, { valueMethod: 'manual', manualAmountCents: 500000 });

    const dir = mkdtempSync(join(tmpdir(), 'aiq-est-')); dirs.push(dir);
    const files = await exportProjectToFiles(db, pj.id, dir);
    expect(files).toHaveLength(1);
    expect(files[0]).toContain('项目总投资估算表');

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(files[0]);
    expect(wb.worksheets.map(w => w.name)).toEqual(['项目总投资估算表']);
    const ws = wb.getWorksheet('项目总投资估算表')!;
    // 找到 总投资 行
    let totalRow = 0;
    ws.eachRow((r, n) => { if (r.getCell('B').value === '总投资') totalRow = n; });
    expect(totalRow).toBeGreaterThan(0);
  });
});
