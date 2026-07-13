import { describe, it, expect } from 'vitest';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { parseWorkbook, trimGrid, splitSideBySide } from '../../../src/core/import/parseGrid';

async function buildFixture(): Promise<string> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('可见表');

  // horizontal merge: A1:B1
  ws.mergeCells('A1:B1');
  ws.getCell('A1').value = '标题';
  ws.getCell('C1').value = 100; // number -> String()

  // vertical merge: D1:D2
  ws.mergeCells('D1:D2');
  ws.getCell('D1').value = '竖合并';

  ws.getCell('A2').value = '行2列A';
  ws.getCell('B2').value = 42;
  ws.getCell('C2').value = new Date(2024, 0, 15);
  ws.getCell('C2').numFmt = 'yyyy-mm-dd';

  const hiddenWs = wb.addWorksheet('隐藏表', { state: 'hidden' });
  hiddenWs.getCell('A1').value = '不应出现';

  const dir = mkdtempSync(join(tmpdir(), 'parsegrid-'));
  const file = join(dir, 'fixture.xlsx');
  await wb.xlsx.writeFile(file);
  return file;
}

describe('parseWorkbook (dynamic exceljs fixture)', () => {
  it('expands merges into every cell, stringifies numbers, skips hidden sheets', async () => {
    const file = await buildFixture();
    const sheets = parseWorkbook(file);

    expect(sheets.map((s) => s.name)).toEqual(['可见表']);

    const grid = sheets[0].grid;
    expect(grid[0][0]).toBe('标题');
    expect(grid[0][1]).toBe('标题'); // horizontal merge fill
    expect(grid[0][2]).toBe('100'); // number -> String()
    expect(grid[0][3]).toBe('竖合并');
    expect(grid[1][3]).toBe('竖合并'); // vertical merge fill
    expect(grid[1][0]).toBe('行2列A');
    expect(grid[1][1]).toBe('42');
    // date cell: formatted (w) value should be preferred, not the raw serial number
    expect(grid[1][2]).not.toMatch(/^\d+(\.\d+)?$/);
    expect(grid[1][2].length).toBeGreaterThan(0);
  });
});

describe('trimGrid', () => {
  it('removes fully-empty leading/trailing rows and columns', () => {
    const grid = [
      ['', '', '', ''],
      ['', 'A', 'B', ''],
      ['', 'C', 'D', ''],
      ['', '', '', ''],
    ];
    expect(trimGrid(grid)).toEqual([
      ['A', 'B'],
      ['C', 'D'],
    ]);
  });

  it('returns [] for a fully empty grid', () => {
    expect(trimGrid([['', ''], ['', '']])).toEqual([]);
    expect(trimGrid([])).toEqual([]);
  });

  it('is a no-op when there is no empty padding', () => {
    const grid = [['A', 'B'], ['C', 'D']];
    expect(trimGrid(grid)).toEqual(grid);
  });
});

describe('splitSideBySide', () => {
  it('splits on a fully-empty separator column into left/right blocks', () => {
    const grid = [
      ['A1', 'A2', '', 'B1', 'B2'],
      ['a1', 'a2', '', 'b1', 'b2'],
    ];
    const blocks = splitSideBySide(grid);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toEqual([
      ['A1', 'A2'],
      ['a1', 'a2'],
    ]);
    expect(blocks[1]).toEqual([
      ['B1', 'B2'],
      ['b1', 'b2'],
    ]);
  });

  it('handles multiple separator columns between blocks', () => {
    const grid = [
      ['A1', '', '', 'B1'],
      ['a1', '', '', 'b1'],
    ];
    const blocks = splitSideBySide(grid);
    expect(blocks).toEqual([
      [['A1'], ['a1']],
      [['B1'], ['b1']],
    ]);
  });

  it('returns [grid] unchanged when there is no separator column', () => {
    const grid = [
      ['A', 'B'],
      ['C', 'D'],
    ];
    expect(splitSideBySide(grid)).toEqual([grid]);
  });
});

// --- Regression against real supplier sample files (not committed to git) ---
const sample1 = join(process.cwd(), 'samples', '2026年最新报价.xls');
const sample2 = join(process.cwd(), 'samples', 'To立众产品核心价格-迈创日新0318.xls');

describe.skipIf(!existsSync(sample1))('samples: 2026年最新报价.xls', () => {
  it('parses visible sheets only (Sheet1/Sheet2 are hidden and skipped)', () => {
    const sheets = parseWorkbook(sample1);
    expect(sheets.map((s) => s.name)).toEqual([
      '电容触摸',
      '红外触摸',
      '显示器',
      '会议屏',
      '拼接屏',
      '异形屏',
      '透明柜',
      '红外触摸框',
    ]);
  });

  it('「拼接屏」sheet contains expected product text', () => {
    const sheets = parseWorkbook(sample1);
    const jp = sheets.find((s) => s.name === '拼接屏')!;
    const flat = jp.grid.flat().join('|');
    expect(flat).toContain('46寸液晶拼接显示单元');
    expect(flat).toContain('防爆屏加400元');
  });

  it('「红外触摸框」sheet: column F ("高超2米" annotations) is separated from the main stacked table', () => {
    // Verified with python xlrd: this sheet is actually a single 6-column
    // vertically-stacked table (46/49/55寸 groups), NOT the left-right
    // side-by-side layout described in the reference notes -- that layout
    // belongs to the "红外框" sheet of the other sample file (see below).
    // Column E is fully empty and column F only carries a handful of
    // "高超2米" notes near the bottom, so splitSideBySide legitimately
    // produces 2 blocks here (main table + the sparse annotation column).
    const sheets = parseWorkbook(sample1);
    const kw = sheets.find((s) => s.name === '红外触摸框')!;
    const blocks = splitSideBySide(trimGrid(kw.grid));
    expect(blocks.length).toBeGreaterThanOrEqual(1);
    expect(blocks[0].flat().join('|')).toContain('拼接红外触摸框价格表');
  });
});

describe.skipIf(!existsSync(sample2))('samples: To立众产品核心价格-迈创日新0318.xls', () => {
  it('parses 3 sheets', () => {
    const sheets = parseWorkbook(sample2);
    expect(sheets.map((s) => s.name)).toEqual(['专显', '拼接屏', '红外框']);
  });

  it('「专显」sheet contains 21.5寸电容智能平板', () => {
    const sheets = parseWorkbook(sample2);
    const zx = sheets.find((s) => s.name === '专显')!;
    expect(zx.grid.flat().join('|')).toContain('21.5寸电容智能平板');
  });

  it('「红外框」sheet splits into >=2 side-by-side blocks', () => {
    const sheets = parseWorkbook(sample2);
    const hw = sheets.find((s) => s.name === '红外框')!;
    const blocks = splitSideBySide(trimGrid(hw.grid));
    expect(blocks.length).toBeGreaterThanOrEqual(2);
  });
});
