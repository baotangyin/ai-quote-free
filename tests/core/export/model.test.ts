import { describe, it, expect, beforeEach } from 'vitest';
import * as core from '../../../src/core/index';
import { assembleExportModel, cnOrdinal } from '../../../src/core/export/model';

let db: core.Db;
beforeEach(() => { db = core.openDb(':memory:'); });

const snap = (cost: number, extra: Partial<core.LineItemSnapshot> = {}): core.LineItemSnapshot => ({
  name: '设备', brand: null, model: null, recommendedBrands: [],
  paramsCore: '参数', paramsBid: null, paramsTender: null, unit: '台', dims: null,
  power220W: 0, power380W: 0, rackU: 0, seqPowerPorts: 0, netPorts: 0, comPorts: 0,
  costUnitCents: cost, optionsApplied: [], ...extra,
});

describe('assembleExportModel', () => {
  it('builds full tree with computed totals', () => {
    const pj = core.createProject(db, { name: '测试项目', defaultMargin: 1.3 });
    const sec = core.createSection(db, { projectId: pj.id, name: '展厅多媒体硬件', integrationFeeRate: 0.05 });
    const sp = core.createSpace(db, { sectionId: sec.id, name: '序厅' });
    core.createLineItem(db, { spaceId: sp.id, snapshot: snap(100000), qty: 2 });
    const m = assembleExportModel(db, pj.id);
    expect(m.project.name).toBe('测试项目');
    expect(m.sections).toHaveLength(1);
    expect(m.sections[0].spaces[0].items[0].lt.unitPriceCents).toBe(130000);
    expect(m.sections[0].spaces[0].subtotal.totalCents).toBe(260000);
    expect(m.sections[0].totals.integrationFeeCents).toBe(13000);
  });
  it('throws for missing project', () => {
    expect(() => assembleExportModel(db, 999)).toThrow();
  });
});

describe('cnOrdinal', () => {
  it.each([[1,'一'],[2,'二'],[9,'九'],[10,'十'],[11,'十一'],[19,'十九'],[20,'二十'],[21,'二十一'],[99,'九十九']])(
    '%i → %s', (n, s) => { expect(cnOrdinal(n)).toBe(s); });
});
