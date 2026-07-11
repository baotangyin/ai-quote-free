import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, type Db } from '../../src/core/db/db';
import { createProduct, getProduct, updateProduct } from '../../src/core/repo/products';
import { addPriceRecord } from '../../src/core/repo/prices';
import { createProject, createSection, createSpace, createLineItem, getLineItem } from '../../src/core/repo/projects';
import { takeSnapshot, isSnapshotStale, refreshSnapshot } from '../../src/core/domain/snapshot';
import { createLineItemCost, setActiveCost } from '../../src/core/repo/lineItemCosts';
import type { LineItem } from '../../src/core/domain/types';

let db: Db;
let pid: number;
let item: LineItem;

beforeEach(() => {
  db = openDb(':memory:');
  pid = createProduct(db, { category: 'LED屏', name: 'P2屏', unit: '㎡' }).id;
  addPriceRecord(db, { productId: pid, source: 'manual', priceCents: 100000, capturedAt: '2026-01-01' });
  const pj = createProject(db, { name: 'T' });
  const sec = createSection(db, { projectId: pj.id, name: 'S' });
  const spaceId = createSpace(db, { sectionId: sec.id, name: 'K' }).id;
  const product = getProduct(db, pid)!;
  item = createLineItem(db, { spaceId, productId: pid, snapshot: takeSnapshot(product, 100000) });
});

describe('生效候选成本与快照过期/刷新的联动', () => {
  it('选定与规则价不同的生效候选后：该行不再被判定过期（避免假阳性）', () => {
    // 新增一条更低的候选成本并设为生效（如砍价后 90000，规则价仍 100000）
    const cost = createLineItemCost(db, { lineItemId: item.id, costUnitCents: 90000, supplierName: '畅博' });
    setActiveCost(db, cost.id);
    const fresh = getLineItem(db, item.id)!;
    expect(fresh.snapshot.costUnitCents).toBe(90000); // 生效候选已回写快照
    // 规则价(100000) != 快照(90000)，但因存在生效候选，不判定过期
    expect(isSnapshotStale(db, fresh, 'latest')).toBe(false);
  });

  it('无生效候选时仍按规则价判定过期（原行为保留）', () => {
    addPriceRecord(db, { productId: pid, source: 'manual', priceCents: 80000, capturedAt: '2026-06-01' });
    const fresh = getLineItem(db, item.id)!;
    expect(isSnapshotStale(db, fresh, 'latest')).toBe(true); // 最新价 80000 != 快照 100000
  });

  it('refreshSnapshot 在存在生效候选时：刷新产品字段但保留生效候选成本，不被规则价覆盖', () => {
    const cost = createLineItemCost(db, { lineItemId: item.id, costUnitCents: 90000, supplierName: '畅博' });
    setActiveCost(db, cost.id);
    // 产品改名 + 规则价变动
    updateProduct(db, pid, { name: 'P2屏-新款' });
    addPriceRecord(db, { productId: pid, source: 'manual', priceCents: 70000, capturedAt: '2026-07-01' });
    const refreshed = refreshSnapshot(db, item.id, 'latest');
    expect(refreshed.snapshot.name).toBe('P2屏-新款'); // 产品展示字段已刷新
    expect(refreshed.snapshot.costUnitCents).toBe(90000); // 成本仍为生效候选，未被规则价 70000 覆盖
  });

  it('refreshSnapshot 无生效候选时按规则价刷新成本（原行为保留）', () => {
    addPriceRecord(db, { productId: pid, source: 'manual', priceCents: 70000, capturedAt: '2026-07-01' });
    const refreshed = refreshSnapshot(db, item.id, 'latest');
    expect(refreshed.snapshot.costUnitCents).toBe(70000);
  });
});
