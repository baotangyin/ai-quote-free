import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, type Db } from '../../src/core/db/db';
import { createProduct } from '../../src/core/repo/products';
import { addPriceRecord } from '../../src/core/repo/prices';
import { createSupplier } from '../../src/core/repo/suppliers';
import {
  createProject, createSection, createSpace, createLineItem, getLineItem, deleteLineItem,
} from '../../src/core/repo/projects';
import type { LineItemSnapshot } from '../../src/core/domain/types';
import {
  createLineItemCost, getLineItemCost, listLineItemCosts, updateLineItemCost,
  deleteLineItemCost, setActiveCost, seedCostsFromPrices,
} from '../../src/core/repo/lineItemCosts';

function snap(costUnitCents: number): LineItemSnapshot {
  return {
    name: '项', brand: null, model: null, recommendedBrands: [],
    paramsCore: null, paramsBid: null, paramsTender: null, unit: '台', dims: null,
    power220W: 0, power380W: 0, rackU: 0, seqPowerPorts: 0, netPorts: 0, comPorts: 0,
    costUnitCents, optionsApplied: [],
  };
}

let db: Db; let spaceId: number;
beforeEach(() => {
  db = openDb(':memory:');
  const pj = createProject(db, { name: 'T' });
  const sec = createSection(db, { projectId: pj.id, name: 'S' });
  spaceId = createSpace(db, { sectionId: sec.id, name: 'K' }).id;
});

describe('lineItemCosts repo', () => {
  it('create + list with auto sort_order 0,1,2 and round-trip fields, isActive default false', () => {
    const item = createLineItem(db, { spaceId, snapshot: snap(10000) });
    const c0 = createLineItemCost(db, { lineItemId: item.id, costUnitCents: 30000,
      supplierName: '供A', brand: '品牌X', model: '型号1', note: '备注' });
    const c1 = createLineItemCost(db, { lineItemId: item.id, costUnitCents: 28000 });
    const c2 = createLineItemCost(db, { lineItemId: item.id, costUnitCents: 32000 });
    expect([c0.sortOrder, c1.sortOrder, c2.sortOrder]).toEqual([0, 1, 2]);
    const list = listLineItemCosts(db, item.id);
    expect(list.map(c => c.id)).toEqual([c0.id, c1.id, c2.id]);
    expect(c0.supplierName).toBe('供A');
    expect(c0.brand).toBe('品牌X');
    expect(c0.model).toBe('型号1');
    expect(c0.note).toBe('备注');
    expect(c0.costUnitCents).toBe(30000);
    expect(c0.isActive).toBe(false);
    expect(getLineItemCost(db, c0.id)!.costUnitCents).toBe(30000);
  });

  it('getLineItemCost returns null for missing id', () => {
    expect(getLineItemCost(db, 9999)).toBeNull();
  });

  it('update changes costUnitCents/note; delete removes', () => {
    const item = createLineItem(db, { spaceId, snapshot: snap(10000) });
    const c = createLineItemCost(db, { lineItemId: item.id, costUnitCents: 30000, note: '旧' });
    const u = updateLineItemCost(db, c.id, { costUnitCents: 25000, note: '新' });
    expect(u.costUnitCents).toBe(25000);
    expect(u.note).toBe('新');
    deleteLineItemCost(db, c.id);
    expect(getLineItemCost(db, c.id)).toBeNull();
    expect(listLineItemCosts(db, item.id)).toHaveLength(0);
  });

  it('deleting the line item cascades to its costs', () => {
    const item = createLineItem(db, { spaceId, snapshot: snap(10000) });
    createLineItemCost(db, { lineItemId: item.id, costUnitCents: 30000 });
    createLineItemCost(db, { lineItemId: item.id, costUnitCents: 28000 });
    expect(listLineItemCosts(db, item.id)).toHaveLength(2);
    deleteLineItem(db, item.id);
    expect(listLineItemCosts(db, item.id)).toHaveLength(0);
  });

  it('setActiveCost keeps a single active and syncs line item snapshot cost', () => {
    const item = createLineItem(db, { spaceId, snapshot: snap(10000) });
    const a = createLineItemCost(db, { lineItemId: item.id, costUnitCents: 30000 });
    const b = createLineItemCost(db, { lineItemId: item.id, costUnitCents: 28000 });
    const c = createLineItemCost(db, { lineItemId: item.id, costUnitCents: 32000 });

    const li1 = setActiveCost(db, b.id);
    expect(li1.snapshot.costUnitCents).toBe(28000);
    let list = listLineItemCosts(db, item.id);
    expect(list.filter(x => x.isActive).map(x => x.id)).toEqual([b.id]);
    expect(getLineItem(db, item.id)!.snapshot.costUnitCents).toBe(28000);

    const li2 = setActiveCost(db, c.id);
    expect(li2.snapshot.costUnitCents).toBe(32000);
    list = listLineItemCosts(db, item.id);
    expect(list.filter(x => x.isActive).map(x => x.id)).toEqual([c.id]);
    expect(getLineItem(db, item.id)!.snapshot.costUnitCents).toBe(32000);
    // a never became active
    expect(getLineItemCost(db, a.id)!.isActive).toBe(false);
  });

  it('setActiveCost throws for missing id', () => {
    expect(() => setActiveCost(db, 4242)).toThrow('line item cost 4242 not found');
  });

  it('seedCostsFromPrices groups by supplier taking latest, idempotent, skips manual line', () => {
    const supA = createSupplier(db, { name: '供应商A' }).id;
    const supB = createSupplier(db, { name: '供应商B' }).id;
    const pid = createProduct(db, { category: '触摸屏', name: '一体机', unit: '台',
      brand: '牌子', model: '型号Z' }).id;
    addPriceRecord(db, { productId: pid, source: 'supplier', supplierId: supA, priceCents: 40000, capturedAt: '2026-01-01' });
    addPriceRecord(db, { productId: pid, source: 'supplier', supplierId: supA, priceCents: 38000, capturedAt: '2026-06-01' });
    addPriceRecord(db, { productId: pid, source: 'supplier', supplierId: supB, priceCents: 41000, capturedAt: '2026-03-01' });
    addPriceRecord(db, { productId: pid, source: 'manual', priceCents: 45000, capturedAt: '2026-02-01' });

    const item = createLineItem(db, { spaceId, productId: pid, snapshot: snap(38000) });
    const n = seedCostsFromPrices(db, item.id);
    expect(n).toBe(3);
    const list = listLineItemCosts(db, item.id);
    const bySup = new Map(list.map(c => [c.supplierId ?? 'null', c]));
    expect(bySup.get(supA)!.costUnitCents).toBe(38000); // latest for A
    expect(bySup.get(supA)!.supplierName).toBe('供应商A');
    expect(bySup.get(supB)!.costUnitCents).toBe(41000);
    expect(bySup.get('null')!.costUnitCents).toBe(45000); // no-supplier group
    expect(bySup.get('null')!.supplierName).toBeNull();
    expect(bySup.get(supA)!.brand).toBe('牌子');
    expect(bySup.get(supA)!.model).toBe('型号Z');
    expect(list.every(c => c.isActive === false)).toBe(true);

    // idempotent: already has candidates -> 0
    expect(seedCostsFromPrices(db, item.id)).toBe(0);

    // manual line with no productId -> 0
    const manual = createLineItem(db, { spaceId, snapshot: snap(10000) });
    expect(seedCostsFromPrices(db, manual.id)).toBe(0);
  });
});
