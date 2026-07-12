import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, type Db } from '../../src/core/db/db';
import { createProject, createSection, createSpace, createLineItem } from '../../src/core/repo/projects';
import { createEstimateCategory, createEstimateRow } from '../../src/core/repo/estimate';
import { estimateRowAmount, assembleEstimate } from '../../src/core/domain/estimate';
import { sectionTotals } from '../../src/core/domain/pricing';
import type { EstimateRow, LineItemSnapshot } from '../../src/core/domain/types';

const snap: LineItemSnapshot = {
  name: 'P1.8室内全彩LED屏', brand: '洲明', model: 'P1.8',
  recommendedBrands: [], paramsCore: '像素间距1.8mm', paramsBid: null, paramsTender: null,
  unit: '㎡', dims: '7680*1600', power220W: 800, power380W: 0,
  rackU: 0, seqPowerPorts: 1, netPorts: 0, comPorts: 0,
  costUnitCents: 480000, optionsApplied: [],
};

function mkRow(over: Partial<EstimateRow>): EstimateRow {
  return {
    id: 1, categoryId: 1, name: 'R', sortOrder: 0, valueMethod: 'manual',
    manualAmountCents: null, coefBaseCents: null, coefFactor: null, refSectionId: null,
    remark: null, createdAt: '', updatedAt: '', ...over,
  };
}

describe('estimateRowAmount', () => {
  const noLookup = () => 0;
  it('manual takes manualAmountCents', () => {
    expect(estimateRowAmount(mkRow({ valueMethod: 'manual', manualAmountCents: 123456 }), noLookup)).toBe(123456);
  });
  it('manual with null amount is 0', () => {
    expect(estimateRowAmount(mkRow({ valueMethod: 'manual', manualAmountCents: null }), noLookup)).toBe(0);
  });
  it('coefficient = round(base * factor)', () => {
    expect(estimateRowAmount(mkRow({ valueMethod: 'coefficient', coefBaseCents: 1000000, coefFactor: 0.8 }), noLookup)).toBe(800000);
  });
  it('coefficient rounds to nearest cent', () => {
    expect(estimateRowAmount(mkRow({ valueMethod: 'coefficient', coefBaseCents: 333, coefFactor: 0.5 }), noLookup)).toBe(167);
  });
  it('coefficient with null base or factor is 0', () => {
    expect(estimateRowAmount(mkRow({ valueMethod: 'coefficient', coefBaseCents: null, coefFactor: 0.5 }), noLookup)).toBe(0);
    expect(estimateRowAmount(mkRow({ valueMethod: 'coefficient', coefBaseCents: 1000000, coefFactor: null }), noLookup)).toBe(0);
  });
  it('sectionRef with null refSectionId is 0', () => {
    expect(estimateRowAmount(mkRow({ valueMethod: 'sectionRef', refSectionId: null }), () => 999)).toBe(0);
  });
  it('sectionRef calls lookup with refSectionId', () => {
    const lookup = (id: number) => (id === 42 ? 555000 : 0);
    expect(estimateRowAmount(mkRow({ valueMethod: 'sectionRef', refSectionId: 42 }), lookup)).toBe(555000);
  });
});

describe('assembleEstimate', () => {
  let db: Db;
  beforeEach(() => { db = openDb(':memory:'); });

  it('throws when project not found', () => {
    expect(() => assembleEstimate(db, 999)).toThrow('project 999 not found');
  });

  it('computes amounts, subtotals and grand total across three methods', () => {
    const pj = createProject(db, { name: 'X', defaultMargin: 1.3, roundRule: 'yuan' });
    const project = { ...pj };
    const sec = createSection(db, { projectId: pj.id, name: '硬件', integrationFeeRate: 0.05 });
    const sp = createSpace(db, { sectionId: sec.id, name: '序厅' });
    createLineItem(db, { spaceId: sp.id, snapshot: snap, qty: 2 });

    // expected section total via pricing
    const secFull = { id: sec.id, projectId: pj.id, name: '硬件', sortOrder: 0,
      integrationFeeRate: 0.05, isHardware: true, createdAt: '', updatedAt: '' } as const;
    const expectedSectionTotal = sectionTotals(
      [{ items: [createDummy()] }], secFull as any, project as any,
    ).totalCents;

    function createDummy() {
      return { id: 1, spaceId: sp.id, productId: null, snapshot: snap, qty: 2,
        marginOverride: null, manualUnitPriceCents: null, remark: null, imagePath: null,
        sortOrder: 0, createdAt: '', updatedAt: '' } as any;
    }

    const cat = createEstimateCategory(db, { projectId: pj.id, name: '大类' });
    createEstimateRow(db, { categoryId: cat.id, name: '手填', valueMethod: 'manual', manualAmountCents: 100000 });
    createEstimateRow(db, { categoryId: cat.id, name: '系数', valueMethod: 'coefficient', coefBaseCents: 1000000, coefFactor: 0.8 });
    createEstimateRow(db, { categoryId: cat.id, name: '引用', valueMethod: 'sectionRef', refSectionId: sec.id });

    const result = assembleEstimate(db, pj.id);
    expect(result.projectId).toBe(pj.id);
    expect(result.categories).toHaveLength(1);
    const c = result.categories[0];
    expect(c.rows).toHaveLength(3);
    expect(c.rows[0].amountCents).toBe(100000);
    expect(c.rows[1].amountCents).toBe(800000);
    expect(c.rows[2].amountCents).toBe(expectedSectionTotal);
    const expectedSubtotal = 100000 + 800000 + expectedSectionTotal;
    expect(c.subtotalCents).toBe(expectedSubtotal);
    expect(result.grandTotalCents).toBe(expectedSubtotal);
  });

  it('sectionRef to a section outside this project yields amount 0', () => {
    const pj = createProject(db, { name: 'X' });
    const other = createProject(db, { name: 'Y' });
    // 一个真实存在但不属于本项目的板块——不会进入本项目的合价查表
    const foreignSec = createSection(db, { projectId: other.id, name: '外部板块' });
    const cat = createEstimateCategory(db, { projectId: pj.id, name: '大类' });
    createEstimateRow(db, { categoryId: cat.id, name: '引用', valueMethod: 'sectionRef', refSectionId: foreignSec.id });
    const result = assembleEstimate(db, pj.id);
    expect(result.categories[0].rows[0].amountCents).toBe(0);
    expect(result.grandTotalCents).toBe(0);
  });

  it('sums multiple categories into grand total', () => {
    const pj = createProject(db, { name: 'X' });
    const c1 = createEstimateCategory(db, { projectId: pj.id, name: 'A' });
    createEstimateRow(db, { categoryId: c1.id, name: 'r', valueMethod: 'manual', manualAmountCents: 300 });
    const c2 = createEstimateCategory(db, { projectId: pj.id, name: 'B' });
    createEstimateRow(db, { categoryId: c2.id, name: 'r', valueMethod: 'manual', manualAmountCents: 700 });
    const result = assembleEstimate(db, pj.id);
    expect(result.categories.map(c => c.subtotalCents)).toEqual([300, 700]);
    expect(result.grandTotalCents).toBe(1000);
  });
});
