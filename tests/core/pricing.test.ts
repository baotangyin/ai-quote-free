import { describe, it, expect } from 'vitest';
import { roundCents, unitPriceCents, lineTotals, techTotals, spaceSubtotal, sectionTotals, projectTotals } from '../../src/core/domain/pricing';
import type { LineItem, LineItemSnapshot, Project, Section } from '../../src/core/domain/types';

const project = { id: 1, name: 'T', client: null, mode: 'budget', defaultMargin: 1.3,
  roundRule: 'yuan', status: 'draft', createdAt: '', updatedAt: '' } as Project;
const section = { id: 1, projectId: 1, name: '硬件', sortOrder: 0,
  integrationFeeRate: 0.05, isHardware: true, createdAt: '', updatedAt: '' } as Section;

function mkItem(over: Partial<LineItem> & { snap?: Partial<LineItemSnapshot> }): LineItem {
  const snapshot: LineItemSnapshot = {
    name: 'X', brand: null, model: null, recommendedBrands: [],
    paramsCore: null, paramsBid: null, paramsTender: null, unit: '台', dims: null,
    power220W: 0, power380W: 0, rackU: 0, seqPowerPorts: 0, netPorts: 0, comPorts: 0,
    costUnitCents: 100000, optionsApplied: [], ...over.snap };
  return { id: 1, spaceId: 1, productId: null, snapshot, qty: 1,
    marginOverride: null, manualUnitPriceCents: null, remark: null, imagePath: null,
    sortOrder: 0, createdAt: '', updatedAt: '', ...over } as LineItem;
}

describe('rounding', () => {
  it('yuan rounds to 100 cents', () => { expect(roundCents(123456, 'yuan')).toBe(123500); });
  it('ten rounds to 1000 cents', () => { expect(roundCents(123456, 'ten')).toBe(123000); });
  it('cent keeps exact', () => { expect(roundCents(123456, 'cent')).toBe(123456); });
});

describe('unit price precedence', () => {
  it('default margin: 1000元*1.3 = 1300元', () => {
    expect(unitPriceCents(mkItem({}), project)).toBe(130000);
  });
  it('row margin override beats default', () => {
    expect(unitPriceCents(mkItem({ marginOverride: 1.5 }), project)).toBe(150000);
  });
  it('manual price beats everything', () => {
    expect(unitPriceCents(mkItem({ marginOverride: 1.5, manualUnitPriceCents: 88800 }), project)).toBe(88800);
  });
});

describe('line and aggregates', () => {
  it('lineTotals computes totals and ratio', () => {
    const r = lineTotals(mkItem({ qty: 2 }), project);
    expect(r.totalCents).toBe(260000);
    expect(r.costTotalCents).toBe(200000);
    expect(r.ratio).toBeCloseTo(1.3);
  });
  it('techTotals multiplies by qty (㎡ 单位即按面积)', () => {
    const led = mkItem({ qty: 73.73, snap: { power220W: 800, seqPowerPorts: 1 } });
    const t = techTotals([led]);
    expect(t.power220W).toBeCloseTo(58984);
    expect(t.seqPowerPorts).toBeCloseTo(73.73);
  });
  it('sectionTotals adds integration fee', () => {
    const items = [mkItem({ qty: 2 })]; // 设备 2600 元
    const r = sectionTotals([{ items }], section, project);
    expect(r.equipmentCents).toBe(260000);
    expect(r.integrationFeeCents).toBe(13000); // 5%
    expect(r.totalCents).toBe(273000);
  });
  it('projectTotals sums and computes profit', () => {
    const items = [mkItem({ qty: 2 })];
    const s = sectionTotals([{ items }], section, project);
    const p = projectTotals([s]);
    expect(p.totalCents).toBe(273000);
    expect(p.costTotalCents).toBe(200000);
    expect(p.profitCents).toBe(73000);
  });
});
