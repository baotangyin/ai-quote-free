import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, type Db } from '../../src/core/db/db';
import { createProduct, getProduct } from '../../src/core/repo/products';
import { addPriceRecord, getEffectiveCost } from '../../src/core/repo/prices';
import { createProject, createSection, createSpace, createLineItem } from '../../src/core/repo/projects';
import { takeSnapshot, isSnapshotStale, refreshSnapshot } from '../../src/core/domain/snapshot';

let db: Db; let pid: number; let spaceId: number;
beforeEach(() => {
  db = openDb(':memory:');
  pid = createProduct(db, {
    category: '触摸屏', name: '55寸电容触控一体机', unit: '台',
    options: [{ name: '防眩光', addPriceCents: 40000 }],
  }).id;
  addPriceRecord(db, { productId: pid, source: 'manual', priceCents: 400000, capturedAt: '2026-01-01' });
  const pj = createProject(db, { name: 'T' });
  const sec = createSection(db, { projectId: pj.id, name: 'S' });
  spaceId = createSpace(db, { sectionId: sec.id, name: 'K' }).id;
});

describe('snapshot', () => {
  it('takeSnapshot copies product and adds option price', () => {
    const p = getProduct(db, pid)!;
    const cost = getEffectiveCost(db, pid, 'lowest')!;
    const snap = takeSnapshot(p, cost, p.options);
    expect(snap.costUnitCents).toBe(440000);
    expect(snap.optionsApplied).toHaveLength(1);
    expect(snap.name).toBe('55寸电容触控一体机');
  });
  it('detects stale after price drops', () => {
    const p = getProduct(db, pid)!;
    const item = createLineItem(db, { spaceId, productId: pid,
      snapshot: takeSnapshot(p, getEffectiveCost(db, pid, 'lowest')!) });
    expect(isSnapshotStale(db, item, 'lowest')).toBe(false);
    addPriceRecord(db, { productId: pid, source: 'supplier', priceCents: 380000, capturedAt: '2026-06-01' });
    expect(isSnapshotStale(db, item, 'lowest')).toBe(true);
  });
  it('refreshSnapshot updates cost, keeps manual price', () => {
    const p = getProduct(db, pid)!;
    const item = createLineItem(db, { spaceId, productId: pid,
      snapshot: takeSnapshot(p, 400000), manualUnitPriceCents: 520000 });
    addPriceRecord(db, { productId: pid, source: 'supplier', priceCents: 380000, capturedAt: '2026-06-01' });
    const fresh = refreshSnapshot(db, item.id, 'lowest');
    expect(fresh.snapshot.costUnitCents).toBe(380000);
    expect(fresh.manualUnitPriceCents).toBe(520000);
  });
  it('选配联动：勾选选配项追加参数描述（有 paramsText 的带括号说明，没有的只追加名称）', () => {
    const p2Id = createProduct(db, {
      category: '触摸屏', name: '65寸触控一体机', unit: '台',
      paramsCore: '65寸/4K',
      paramsBid: '投标核心参数',
      paramsTender: null,
      options: [
        { name: '防眩光', addPriceCents: 40000, paramsText: '雾度3%以下' },
        { name: '壁挂支架', addPriceCents: 10000 },
      ],
    }).id;
    addPriceRecord(db, { productId: p2Id, source: 'manual', priceCents: 500000, capturedAt: '2026-01-01' });
    const p2 = getProduct(db, p2Id)!;
    const cost2 = getEffectiveCost(db, p2Id, 'lowest')!;
    const snap = takeSnapshot(p2, cost2, p2.options);
    expect(snap.costUnitCents).toBe(550000); // 500000 + 40000 + 10000

    const expectedSuffix = '\n选配：防眩光（雾度3%以下）\n选配：壁挂支架';
    expect(snap.paramsCore).toBe('65寸/4K' + expectedSuffix);
    expect(snap.paramsBid).toBe('投标核心参数' + expectedSuffix);
    expect(snap.paramsTender).toBe(expectedSuffix); // 基础值为 null 时从空串开始追加
  });

  it('选配联动：未勾选任何选配项时参数字段原样不变（含 null）', () => {
    const p2Id = createProduct(db, {
      category: '触摸屏', name: '75寸触控一体机', unit: '台',
      paramsCore: '75寸/4K',
    }).id;
    addPriceRecord(db, { productId: p2Id, source: 'manual', priceCents: 600000, capturedAt: '2026-01-01' });
    const p2 = getProduct(db, p2Id)!;
    const cost2 = getEffectiveCost(db, p2Id, 'lowest')!;
    const snap = takeSnapshot(p2, cost2, []);
    expect(snap.paramsCore).toBe('75寸/4K');
    expect(snap.paramsBid).toBeNull();
    expect(snap.paramsTender).toBeNull();
  });

  it('manual-line (no product) never stale', () => {
    const item = createLineItem(db, { spaceId,
      snapshot: { name: '手工项', brand: null, model: null, recommendedBrands: [],
        paramsCore: null, paramsBid: null, paramsTender: null, unit: '项', dims: null,
        power220W: 0, power380W: 0, rackU: 0, seqPowerPorts: 0, netPorts: 0, comPorts: 0,
        costUnitCents: 10000, optionsApplied: [] } });
    expect(isSnapshotStale(db, item, 'lowest')).toBe(false);
  });
});
