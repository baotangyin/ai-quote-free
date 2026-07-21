import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import * as core from '../../../src/core/index';
import {
  writeCostCompareSheet, type CostCompareSection,
} from '../../../src/core/export/costCompareSheet';
import { exportCostCompareToFile } from '../../../src/core/export/exportCostCompare';
import type { LineItemCost, LineItemSnapshot } from '../../../src/core/domain/types';

function cost(patch: Partial<LineItemCost>): LineItemCost {
  return {
    id: 1, lineItemId: 1, supplierId: null, supplierName: null, brand: null, model: null,
    costUnitCents: 0, isActive: false, note: null, sortOrder: 0, createdAt: '', updatedAt: '',
    ...patch,
  };
}

function snap(costUnitCents: number, name: string): LineItemSnapshot {
  return {
    name, brand: null, model: null, recommendedBrands: [],
    paramsCore: null, paramsBid: null, paramsTender: null, unit: '台', dims: null,
    power220W: 0, power380W: 0, rackU: 0, seqPowerPorts: 0, netPorts: 0, comPorts: 0,
    costUnitCents, optionsApplied: [],
  };
}

describe('writeCostCompareSheet', () => {
  it('writes title, headers, candidate cost values, and snapshot fallback', () => {
    const section: CostCompareSection = {
      sectionName: '硬件',
      items: [
        {
          name: '媒体服务器', unit: '套', qty: 2, snapshotCostCents: 2100000,
          costs: [
            cost({ id: 1, supplierName: '供A', model: '型A', costUnitCents: 200000, isActive: false }),
            cost({ id: 2, supplierName: '供B', model: '型B', costUnitCents: 190000, isActive: true }),
          ],
        },
        {
          name: '拼接屏', unit: '块', qty: 4, snapshotCostCents: 50000, costs: [],
        },
      ],
    };
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('硬件');
    writeCostCompareSheet(ws, section, '翔威新能源');

    expect(String(ws.getCell('A1').value)).toContain('成本对比表');
    expect(String(ws.getCell('A1').value)).toContain('翔威新能源');

    const headers: string[] = [];
    ws.getRow(2).eachCell(c => headers.push(String(c.value)));
    expect(headers).toContain('方案1供应商');
    expect(headers).toContain('方案2供应商');
    expect(headers).toContain('生效方案');
    expect(headers.slice(0, 4)).toEqual(['序号', '名称', '单位', '数量']);

    // 行3：媒体服务器，两个候选
    expect(ws.getCell('A3').value).toBe(1);
    expect(ws.getCell('B3').value).toBe('媒体服务器');
    expect(ws.getCell('C3').value).toBe('套');
    expect(ws.getCell('D3').value).toBe(2);
    // 方案1: E供应商 F型号 G成本; 方案2: H I J; 生效: K
    expect(ws.getCell('E3').value).toBe('供A');
    expect(ws.getCell('F3').value).toBe('型A');
    expect(ws.getCell('G3').value).toBe(2000); // 200000/100
    expect(ws.getCell('H3').value).toBe('供B');
    expect(ws.getCell('J3').value).toBe(1900); // 190000/100
    expect(ws.getCell('K3').value).toBe('供B'); // 生效候选供应商名

    // 行4：无候选 → 方案1供应商 '（快照成本）'，成本=快照
    expect(ws.getCell('E4').value).toBe('（快照成本）');
    expect(ws.getCell('G4').value).toBe(500); // 50000/100
    expect(ws.getCell('K4').value).toBe('快照');
  });
});

function buildDb(mode: 'pricing' | 'estimate') {
  const db = core.openDb(':memory:');
  const pj = core.createProject(db, { name: '翔威新能源', mode, defaultMargin: 1.3 });
  return { db, pj };
}

describe('exportCostCompareToFile', () => {
  const dirs: string[] = [];
  afterEach(() => { dirs.forEach(d => rmSync(d, { recursive: true, force: true })); dirs.length = 0; });

  it('exports 成本对比版 file with candidate sheet', async () => {
    const { db, pj } = buildDb('pricing');
    const sec = core.createSection(db, { projectId: pj.id, name: '硬件' });
    const sp = core.createSpace(db, { sectionId: sec.id, name: '序厅' });
    const supA = core.createSupplier(db, { name: '供A' });
    const prod = core.createProduct(db, { category: '', name: '媒体服务器', unit: '套' } as any);
    core.addPriceRecord(db, { productId: prod.id, source: 'manual', priceCents: 200000, supplierId: supA.id });
    const item = core.createLineItem(db, { spaceId: sp.id, qty: 2, snapshot: snap(2100000, '媒体服务器') });
    core.createLineItemCost(db, { lineItemId: item.id, costUnitCents: 200000, supplierName: '供A', model: '型A' });
    const c2 = core.createLineItemCost(db, { lineItemId: item.id, costUnitCents: 190000, supplierName: '供B', model: '型B' });
    core.setActiveCost(db, c2.id);

    const dir = mkdtempSync(join(tmpdir(), 'aiq-cc-')); dirs.push(dir);
    const file = await exportCostCompareToFile(db, pj.id, dir);
    expect(file).toContain('成本对比版');

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(file);
    expect(wb.worksheets.map(w => w.name)).toContain('硬件');
    const ws = wb.getWorksheet('硬件')!;
    expect(String(ws.getCell('A1').value)).toContain('成本对比表');
    expect(ws.getCell('B3').value).toBe('媒体服务器');
  });

  it('throws on estimate mode', async () => {
    const { db, pj } = buildDb('estimate');
    const dir = mkdtempSync(join(tmpdir(), 'aiq-cc-est-')); dirs.push(dir);
    await expect(exportCostCompareToFile(db, pj.id, dir)).rejects.toThrow('概算模式无成本对比版');
  });
});
