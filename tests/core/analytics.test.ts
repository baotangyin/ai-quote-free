import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, type Db } from '../../src/core/db/db';
import {
  createProject, updateProject, createSection, createSpace, createLineItem,
} from '../../src/core/repo/projects';
import { createProduct as createProductRepo } from '../../src/core/repo/products';
import { createSupplier as createSupplierRepo } from '../../src/core/repo/suppliers';
import { addPriceRecord as addPriceRecordRepo } from '../../src/core/repo/prices';
import type { LineItemSnapshot } from '../../src/core/domain/types';
import {
  listProductProfit, listProjectProfit, listPriceTrend, listPriceChanges, getAnalyticsSummary,
} from '../../src/core/analytics/analytics';

function mkSnap(over: Partial<LineItemSnapshot> = {}): LineItemSnapshot {
  return {
    name: '测试设备', brand: null, model: null, recommendedBrands: [],
    paramsCore: null, paramsBid: null, paramsTender: null, unit: '台', dims: null,
    power220W: 0, power380W: 0, rackU: 0, seqPowerPorts: 0, netPorts: 0, comPorts: 0,
    costUnitCents: 100000, optionsApplied: [], ...over,
  };
}

/** 建一个 project/section/space 三级容器，返回 spaceId。 */
function mkContainer(db: Db, projectOver: Partial<{ name: string; defaultMargin: number; roundRule: 'cent' | 'yuan' | 'ten' }> = {}) {
  const pj = createProject(db, { name: projectOver.name ?? 'P', defaultMargin: projectOver.defaultMargin ?? 1.3, roundRule: projectOver.roundRule ?? 'yuan' });
  const sec = createSection(db, { projectId: pj.id, name: 'S' });
  const sp = createSpace(db, { sectionId: sec.id, name: 'K' });
  return { project: pj, section: sec, space: sp };
}

let db: Db;
beforeEach(() => { db = openDb(':memory:'); });

describe('售价三优先级 -> revenue', () => {
  it('manual price wins', () => {
    const { space } = mkContainer(db);
    createLineItem(db, { spaceId: space.id, snapshot: mkSnap({ costUnitCents: 100000 }), qty: 1, manualUnitPriceCents: 88800 });
    expect(getAnalyticsSummary(db, {}).revenueTotalCents).toBe(88800);
  });
  it('row marginOverride beats project default', () => {
    const { space } = mkContainer(db);
    createLineItem(db, { spaceId: space.id, snapshot: mkSnap({ costUnitCents: 100000 }), qty: 1, marginOverride: 1.5 });
    expect(getAnalyticsSummary(db, {}).revenueTotalCents).toBe(150000);
  });
  it('default margin + yuan round rule', () => {
    const { space } = mkContainer(db, { defaultMargin: 1.3, roundRule: 'yuan' });
    createLineItem(db, { spaceId: space.id, snapshot: mkSnap({ costUnitCents: 123456 }), qty: 1 });
    // 123456*1.3=160492.8 -> round -> 160500 (yuan: 取整百分)
    expect(getAnalyticsSummary(db, {}).revenueTotalCents).toBe(160500);
  });
});

describe('时间过滤含端点 / onlyDone', () => {
  it('includes rows with created_at exactly at from/to boundary', () => {
    const { space } = mkContainer(db);
    const item = createLineItem(db, { spaceId: space.id, snapshot: mkSnap(), qty: 1 });
    db.prepare('UPDATE line_items SET created_at=? WHERE id=?').run('2026-05-10T00:00:00.000Z', item.id);
    const rows = listProjectProfit(db, { from: '2026-05-10T00:00:00.000Z', to: '2026-05-10T00:00:00.000Z' });
    expect(rows).toHaveLength(1);
    const outside = listProjectProfit(db, { from: '2026-05-10T00:00:00.001Z', to: '2026-05-11T00:00:00.000Z' });
    expect(outside).toHaveLength(0);
  });
  it('onlyDone excludes draft projects', () => {
    const { project: pDraft, space: spDraft } = mkContainer(db, { name: 'draft-proj' });
    createLineItem(db, { spaceId: spDraft.id, snapshot: mkSnap(), qty: 1 });
    const { project: pDone, space: spDone } = mkContainer(db, { name: 'done-proj' });
    createLineItem(db, { spaceId: spDone.id, snapshot: mkSnap(), qty: 1 });
    updateProject(db, pDone.id, { status: 'done' });

    const all = listProjectProfit(db, {});
    expect(all).toHaveLength(2);
    const doneOnly = listProjectProfit(db, { onlyDone: true });
    expect(doneOnly).toHaveLength(1);
    expect(doneOnly[0].projectId).toBe(pDone.id);
    expect(pDraft.status).toBe('draft');
  });
});

describe('手工行', () => {
  it('counts in projectProfit/summary, absent from productProfit', () => {
    const { space } = mkContainer(db);
    createLineItem(db, { spaceId: space.id, snapshot: mkSnap({ costUnitCents: 100000 }), qty: 1, manualUnitPriceCents: 200000 });
    const proj = listProjectProfit(db, {});
    expect(proj).toHaveLength(1);
    expect(proj[0].revenueTotalCents).toBe(200000);
    const summary = getAnalyticsSummary(db, {});
    expect(summary.itemCount).toBe(1);
    expect(summary.revenueTotalCents).toBe(200000);
    expect(listProductProfit(db, {})).toHaveLength(0);
  });
});

describe('产品已删', () => {
  it('productProfit falls back to snapshot.name / 已删除', () => {
    const { space } = mkContainer(db);
    const product = createProductRepo(db, { name: '拼接屏55寸', category: '拼接屏', unit: '台' });
    const item = createLineItem(db, { spaceId: space.id, productId: product.id, snapshot: mkSnap({ name: '拼接屏55寸-快照', costUnitCents: 100000 }), qty: 1 });
    expect(item.productId).toBe(product.id);

    // 模拟历史遗留的悬空引用：关闭外键约束后删除产品，保留 line_items.product_id 不被级联置空。
    db.pragma('foreign_keys = OFF');
    db.prepare('DELETE FROM products WHERE id=?').run(product.id);
    db.pragma('foreign_keys = ON');

    const rows = listProductProfit(db, {});
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('拼接屏55寸-快照');
    expect(rows[0].category).toBe('已删除');
  });
});

describe('profitRate', () => {
  it('revenue=0 with positive cost -> null (not Infinity/NaN)', () => {
    const { space } = mkContainer(db);
    const product = createProductRepo(db, { name: 'X', category: 'C', unit: '台' });
    createLineItem(db, { spaceId: space.id, productId: product.id, snapshot: mkSnap({ costUnitCents: 50000 }), qty: 1, manualUnitPriceCents: 0 });
    const rows = listProductProfit(db, {});
    expect(rows).toHaveLength(1);
    expect(rows[0].revenueTotalCents).toBe(0);
    expect(rows[0].profitCents).toBe(-50000);
    expect(rows[0].profitRate).toBeNull();
  });
});

describe('priceTrend', () => {
  it('orders by capturedAt, joins supplier name, filters by range', () => {
    const product = createProductRepo(db, { name: 'Y', category: 'C', unit: '台' });
    const supplier = createSupplierRepo(db, { name: '畅博' });
    addPriceRecordRepo(db, { productId: product.id, source: 'supplier', supplierId: supplier.id, priceCents: 100000, capturedAt: '2026-01-01T00:00:00.000Z' });
    addPriceRecordRepo(db, { productId: product.id, source: 'ai_search', priceCents: 110000, capturedAt: '2026-02-01T00:00:00.000Z' });
    addPriceRecordRepo(db, { productId: product.id, source: 'manual', priceCents: 120000, capturedAt: '2026-03-01T00:00:00.000Z' });

    const all = listPriceTrend(db, product.id, {});
    expect(all.map((p) => p.priceCents)).toEqual([100000, 110000, 120000]);
    expect(all[0].supplierName).toBe('畅博');
    expect(all[1].supplierName).toBeNull();

    const ranged = listPriceTrend(db, product.id, { from: '2026-01-15T00:00:00.000Z', to: '2026-02-15T00:00:00.000Z' });
    expect(ranged).toHaveLength(1);
    expect(ranged[0].priceCents).toBe(110000);
  });
});

describe('priceChanges', () => {
  it('first/last, recordCount<2 excluded, first=0 -> changeRate null, gain/loss ordering', () => {
    const gainer = createProductRepo(db, { name: '涨价品', category: 'C', unit: '台' });
    addPriceRecordRepo(db, { productId: gainer.id, source: 'manual', priceCents: 100000, capturedAt: '2026-01-01T00:00:00.000Z' });
    addPriceRecordRepo(db, { productId: gainer.id, source: 'manual', priceCents: 200000, capturedAt: '2026-02-01T00:00:00.000Z' });

    const loser = createProductRepo(db, { name: '跌价品', category: 'C', unit: '台' });
    addPriceRecordRepo(db, { productId: loser.id, source: 'manual', priceCents: 300000, capturedAt: '2026-01-01T00:00:00.000Z' });
    addPriceRecordRepo(db, { productId: loser.id, source: 'manual', priceCents: 100000, capturedAt: '2026-02-01T00:00:00.000Z' });

    const single = createProductRepo(db, { name: '仅一条', category: 'C', unit: '台' });
    addPriceRecordRepo(db, { productId: single.id, source: 'manual', priceCents: 50000, capturedAt: '2026-01-01T00:00:00.000Z' });

    const fromZero = createProductRepo(db, { name: '首价为0', category: 'C', unit: '台' });
    addPriceRecordRepo(db, { productId: fromZero.id, source: 'manual', priceCents: 0, capturedAt: '2026-01-01T00:00:00.000Z' });
    addPriceRecordRepo(db, { productId: fromZero.id, source: 'manual', priceCents: 50000, capturedAt: '2026-02-01T00:00:00.000Z' });

    const rows = listPriceChanges(db, {}, 20);
    const byId = new Map(rows.map((r) => [r.productId, r]));

    expect(byId.has(single.id)).toBe(false);

    const g = byId.get(gainer.id)!;
    expect(g.firstCents).toBe(100000);
    expect(g.lastCents).toBe(200000);
    expect(g.changeCents).toBe(100000);
    expect(g.changeRate).toBeCloseTo(1);
    expect(g.recordCount).toBe(2);

    const l = byId.get(loser.id)!;
    expect(l.firstCents).toBe(300000);
    expect(l.lastCents).toBe(100000);
    expect(l.changeCents).toBe(-200000);
    expect(l.changeRate).toBeCloseTo(-2 / 3);

    // 零基线行（首价为0，changeRate=null）不入涨跌榜
    expect(byId.has(fromZero.id)).toBe(false);

    // 涨幅排序应在跌幅之前
    const gainerIdx = rows.findIndex((r) => r.productId === gainer.id);
    const loserIdx = rows.findIndex((r) => r.productId === loser.id);
    expect(gainerIdx).toBeLessThan(loserIdx);
  });

  it('limit applies to both gain and loss ends', () => {
    // 3 只涨、3 只跌，limit=1 应各取一端最极值
    for (let i = 0; i < 3; i++) {
      const p = createProductRepo(db, { name: `涨${i}`, category: 'C', unit: '台' });
      addPriceRecordRepo(db, { productId: p.id, source: 'manual', priceCents: 100000, capturedAt: '2026-01-01T00:00:00.000Z' });
      addPriceRecordRepo(db, { productId: p.id, source: 'manual', priceCents: 100000 + (i + 1) * 10000, capturedAt: '2026-02-01T00:00:00.000Z' });
    }
    for (let i = 0; i < 3; i++) {
      const p = createProductRepo(db, { name: `跌${i}`, category: 'C', unit: '台' });
      addPriceRecordRepo(db, { productId: p.id, source: 'manual', priceCents: 100000, capturedAt: '2026-01-01T00:00:00.000Z' });
      addPriceRecordRepo(db, { productId: p.id, source: 'manual', priceCents: 100000 - (i + 1) * 10000, capturedAt: '2026-02-01T00:00:00.000Z' });
    }
    const rows = listPriceChanges(db, {}, 1);
    expect(rows).toHaveLength(2);
    expect(rows[0].name).toBe('涨2'); // 涨幅最大
    expect(rows[1].name).toBe('跌2'); // 跌幅最大
  });

  it('zero-baseline rows never occupy gain/loss slots, even mixed with 5 gainers/5 losers', () => {
    // 5 只涨、5 只跌、3 只零基线（首价为0），limit=2 应恰好返回最大2涨+最大2跌，零基线不出现
    for (let i = 0; i < 5; i++) {
      const p = createProductRepo(db, { name: `涨${i}`, category: 'C', unit: '台' });
      addPriceRecordRepo(db, { productId: p.id, source: 'manual', priceCents: 100000, capturedAt: '2026-01-01T00:00:00.000Z' });
      addPriceRecordRepo(db, { productId: p.id, source: 'manual', priceCents: 100000 + (i + 1) * 10000, capturedAt: '2026-02-01T00:00:00.000Z' });
    }
    for (let i = 0; i < 5; i++) {
      const p = createProductRepo(db, { name: `跌${i}`, category: 'C', unit: '台' });
      addPriceRecordRepo(db, { productId: p.id, source: 'manual', priceCents: 100000, capturedAt: '2026-01-01T00:00:00.000Z' });
      addPriceRecordRepo(db, { productId: p.id, source: 'manual', priceCents: 100000 - (i + 1) * 10000, capturedAt: '2026-02-01T00:00:00.000Z' });
    }
    const zeroBaselineIds: number[] = [];
    for (let i = 0; i < 3; i++) {
      const p = createProductRepo(db, { name: `零基线${i}`, category: 'C', unit: '台' });
      zeroBaselineIds.push(p.id);
      addPriceRecordRepo(db, { productId: p.id, source: 'manual', priceCents: 0, capturedAt: '2026-01-01T00:00:00.000Z' });
      // 极端跌幅式的绝对涨价数额，试图挤占跌幅端
      addPriceRecordRepo(db, { productId: p.id, source: 'manual', priceCents: 999999999, capturedAt: '2026-02-01T00:00:00.000Z' });
    }

    const rows = listPriceChanges(db, {}, 2);
    expect(rows).toHaveLength(4);
    expect(rows.map((r) => r.name)).toEqual(['涨4', '涨3', '跌4', '跌3']);
    for (const id of zeroBaselineIds) {
      expect(rows.some((r) => r.productId === id)).toBe(false);
    }
  });
});

describe('summary', () => {
  it('projectCount deduped, aggregates across projects', () => {
    const { space: sp1 } = mkContainer(db, { name: 'P1' });
    createLineItem(db, { spaceId: sp1.id, snapshot: mkSnap({ costUnitCents: 100000 }), qty: 1, manualUnitPriceCents: 150000 });
    createLineItem(db, { spaceId: sp1.id, snapshot: mkSnap({ costUnitCents: 50000 }), qty: 1, manualUnitPriceCents: 80000 });
    const { space: sp2 } = mkContainer(db, { name: 'P2' });
    createLineItem(db, { spaceId: sp2.id, snapshot: mkSnap({ costUnitCents: 200000 }), qty: 1, manualUnitPriceCents: 300000 });

    const summary = getAnalyticsSummary(db, {});
    expect(summary.projectCount).toBe(2);
    expect(summary.itemCount).toBe(3);
    expect(summary.costTotalCents).toBe(350000);
    expect(summary.revenueTotalCents).toBe(530000);
    expect(summary.profitCents).toBe(180000);
  });
});

describe('只读', () => {
  it('does not mutate schema version or table row counts', () => {
    const { space } = mkContainer(db);
    const product = createProductRepo(db, { name: 'Z', category: 'C', unit: '台' });
    createLineItem(db, { spaceId: space.id, productId: product.id, snapshot: mkSnap(), qty: 1 });
    addPriceRecordRepo(db, { productId: product.id, source: 'manual', priceCents: 100000, capturedAt: '2026-01-01T00:00:00.000Z' });
    addPriceRecordRepo(db, { productId: product.id, source: 'manual', priceCents: 120000, capturedAt: '2026-02-01T00:00:00.000Z' });

    const tables = ['projects', 'sections', 'spaces', 'line_items', 'products', 'price_records', 'suppliers'];
    const countAll = () => tables.map((t) => (db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get() as any).c);
    const versionBefore = db.pragma('user_version', { simple: true });
    const countsBefore = countAll();

    listProductProfit(db, {});
    listProjectProfit(db, {});
    listPriceTrend(db, product.id, {});
    listPriceChanges(db, {});
    getAnalyticsSummary(db, {});

    expect(db.pragma('user_version', { simple: true })).toBe(versionBefore);
    expect(countAll()).toEqual(countsBefore);
  });
});
