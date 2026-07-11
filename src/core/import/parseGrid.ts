import { readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';

export interface RawSheet {
  name: string;
  grid: string[][];
}

function cellToString(cell: XLSX.CellObject | undefined): string {
  if (!cell) return '';
  if (cell.v === undefined || cell.v === null) return '';
  // Plain numbers: use the raw value via String(), not the formatted (w) text
  // (which may contain thousands separators / currency symbols).
  if (cell.t === 'n') return String(cell.v);
  // Dates (read with cellDates:true, cell.t === 'd') and other formatted
  // values: prefer the formatted text (w) when present.
  if (cell.w !== undefined) return cell.w;
  if (cell.v instanceof Date) return cell.v.toISOString().slice(0, 10);
  return String(cell.v);
}

function sheetToGrid(ws: XLSX.WorkSheet): string[][] {
  const ref = ws['!ref'];
  if (!ref) return [];
  const range = XLSX.utils.decode_range(ref);
  const nRows = range.e.r - range.s.r + 1;
  const nCols = range.e.c - range.s.c + 1;
  if (nRows <= 0 || nCols <= 0) return [];

  const grid: string[][] = Array.from({ length: nRows }, () => new Array<string>(nCols).fill(''));

  for (let r = range.s.r; r <= range.e.r; r++) {
    for (let c = range.s.c; c <= range.e.c; c++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      grid[r - range.s.r][c - range.s.c] = cellToString(ws[addr]);
    }
  }

  const merges = ws['!merges'] ?? [];
  for (const m of merges) {
    const topLeftAddr = XLSX.utils.encode_cell({ r: m.s.r, c: m.s.c });
    const value = cellToString(ws[topLeftAddr]);
    for (let r = m.s.r; r <= m.e.r; r++) {
      const rr = r - range.s.r;
      if (rr < 0 || rr >= nRows) continue;
      for (let c = m.s.c; c <= m.e.c; c++) {
        const cc = c - range.s.c;
        if (cc < 0 || cc >= nCols) continue;
        grid[rr][cc] = value;
      }
    }
  }

  return grid;
}

/** Parses an xls/xlsx workbook into raw grids, one per visible sheet (hidden sheets skipped). */
export function parseWorkbook(filePath: string): RawSheet[] {
  // Use XLSX.read(buffer) instead of XLSX.readFile(): the packaged app runs
  // xlsx's ESM build (per its package.json "exports" map for `import`
  // conditions), which does not bind Node's `fs` module, so
  // `XLSX.readFile` is undefined there (vitest's CJS interop masked this).
  // Reading the file ourselves and passing a Buffer works under both the
  // CJS and ESM builds, and also sidesteps any encoding issues with
  // non-ASCII (e.g. Chinese) file paths since we never hand a path string
  // to xlsx.
  const wb = XLSX.read(readFileSync(filePath), { type: 'buffer', cellDates: true });
  const hiddenMeta = wb.Workbook?.Sheets ?? [];
  const result: RawSheet[] = [];
  wb.SheetNames.forEach((name, idx) => {
    const hidden = hiddenMeta[idx]?.Hidden;
    if (hidden === 1 || hidden === 2) return;
    const ws = wb.Sheets[name];
    if (!ws) return;
    result.push({ name, grid: sheetToGrid(ws) });
  });
  return result;
}

function isRowEmpty(row: string[]): boolean {
  return row.every((c) => c.trim() === '');
}

/** Trims fully-empty leading/trailing rows and columns from a grid. */
export function trimGrid(grid: string[][]): string[][] {
  if (grid.length === 0) return [];

  let top = 0;
  let bottom = grid.length - 1;
  while (top <= bottom && isRowEmpty(grid[top])) top++;
  while (bottom >= top && isRowEmpty(grid[bottom])) bottom--;
  if (top > bottom) return [];

  const rows = grid.slice(top, bottom + 1);
  const nCols = Math.max(0, ...rows.map((r) => r.length));
  if (nCols === 0) return [];

  const isColEmpty = (c: number) => rows.every((r) => (r[c] ?? '').trim() === '');
  let left = 0;
  let right = nCols - 1;
  while (left <= right && isColEmpty(left)) left++;
  while (right >= left && isColEmpty(right)) right--;
  if (left > right) return [];

  return rows.map((r) => r.slice(left, right + 1));
}

// A separator column doesn't have to be *literally* empty in every row: real
// supplier sheets often carry a full-width merged footnote/title row (e.g.
// "以上价格含税及运费") that spans across what is otherwise a blank spacer
// column between two side-by-side tables. Treat a column as a separator when
// it is empty in all but a small fraction of rows.
const SEPARATOR_NON_EMPTY_RATIO = 0.15;

/**
 * Detects side-by-side tables separated by one or more (near-)empty columns
 * and splits the grid into blocks (each trimmed). Returns [grid] unchanged
 * when no such separator exists.
 */
export function splitSideBySide(grid: string[][]): string[][][] {
  if (grid.length === 0) return [grid];

  const nCols = Math.max(0, ...grid.map((r) => r.length));
  if (nCols === 0) return [grid];

  const colEmpty: boolean[] = [];
  for (let c = 0; c < nCols; c++) {
    const nonEmptyCount = grid.reduce((n, r) => n + ((r[c] ?? '').trim() === '' ? 0 : 1), 0);
    colEmpty[c] = nonEmptyCount / grid.length <= SEPARATOR_NON_EMPTY_RATIO;
  }

  const segments: Array<[number, number]> = [];
  let start = -1;
  for (let c = 0; c <= nCols; c++) {
    const empty = c === nCols || colEmpty[c];
    if (!empty) {
      if (start === -1) start = c;
    } else if (start !== -1) {
      segments.push([start, c]);
      start = -1;
    }
  }

  if (segments.length <= 1) return [grid];

  return segments.map(([s, e]) => trimGrid(grid.map((r) => r.slice(s, e))));
}
