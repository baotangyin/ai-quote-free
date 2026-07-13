import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import * as core from '../../../src/core/index';
import { assembleExportModel } from '../../../src/core/export/model';
import { writeSummarySheet } from '../../../src/core/export/summarySheet';

describe('writeSummarySheet', () => {
  it('writes per-section cross-sheet formula rows and total', () => {
    const db = core.openDb(':memory:');
    const pj = core.createProject(db, { name: '测试项目' });
    core.createSection(db, { projectId: pj.id, name: '硬件' });
    core.createSection(db, { projectId: pj.id, name: '软件' });
    const m = assembleExportModel(db, pj.id);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('汇总表');
    writeSummarySheet(ws, m, ['硬件', '软件'], [{ totalRow: 8 }, { totalRow: 12 }], ['G', 'G'], true);

    expect(String(ws.getCell('A1').value)).toContain('项目总投资估算表');
    expect(ws.getCell('B2').value).toBe('项目名称');
    expect(ws.getCell('A3').value).toBe('一');
    expect(ws.getCell('B3').value).toBe('硬件');
    expect((ws.getCell('C3').value as any).formula).toBe("'硬件'!G8");
    expect(ws.getCell('D3').value).toBe('明细详见附表');
    expect(ws.getCell('B5').value).toBe('合计');
    expect((ws.getCell('C5').value as any).formula).toBe('SUM(C3:C4)');

    // 对齐样式：项目名称(B)居左，预算金额(C)居右，全部垂直居中
    expect(ws.getCell('B3').alignment).toEqual({ vertical: 'middle', horizontal: 'left' });
    expect(ws.getCell('C3').alignment).toEqual({ vertical: 'middle', horizontal: 'right' });
    expect(ws.getCell('A3').alignment).toEqual({ vertical: 'middle', horizontal: 'center' });
    expect(ws.getCell('C3').numFmt).toBe('#,##0.00');
  });
});
