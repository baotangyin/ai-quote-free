import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, type Db } from '../../src/core/db/db';
import { createProduct } from '../../src/core/repo/products';
import { addPriceRecord } from '../../src/core/repo/prices';
import { takeSnapshot } from '../../src/core/domain/snapshot';
import {
  createProject, createSection, createSpace, createLineItem, getLineItem,
} from '../../src/core/repo/projects';
import { createLineItemCost, listLineItemCosts } from '../../src/core/repo/lineItemCosts';
import { replaceLineItemProduct } from '../../src/core/repo/replaceProduct';
import type { Product } from '../../src/core/domain/types';

let db: Db; let spaceId: number; let prodOld: Product; let prodNew: Product;

beforeEach(() => {
  db = openDb(':memory:');
  prodOld = createProduct(db, { category: '屏幕', name: '旧一体机', unit: '台', brand: '牌A', model: 'M1' });
  prodNew = createProduct(db, {
    category: '屏幕', name: '新一体机', unit: '台', brand: '牌B', model: 'M2',
    options: [
      { name: '支架', addPriceCents: 1000, paramsText: '壁挂支架' },
      { name: '延保', addPriceCents: 500 },
    ],
  });
  addPriceRecord(db, { productId: prodOld.id, source: 'manual', priceCents: 20000 });
  addPriceRecord(db, { productId: prodNew.id, source: 'manual', priceCents: 30000 });

  const pj = createProject(db, { name: '项目' });
  const sec = createSection(db, { projectId: pj.id, name: '板块' });
  spaceId = createSpace(db, { sectionId: sec.id, name: '空间' }).id;
});

describe('replaceLineItemProduct', () => {
  it('产品不存在时抛中文错误', () => {
    const item = createLineItem(db, { spaceId, productId: prodOld.id, snapshot: takeSnapshot(prodOld, 20000), qty: 2 });
    expect(() => replaceLineItemProduct(db, item.id, 999999, [], 'lowest')).toThrow('产品 999999 不存在');
  });

  it('清单行不存在时抛错', () => {
    expect(() => replaceLineItemProduct(db, 999999, prodNew.id, [], 'lowest')).toThrow('999999');
  });

  it('保留 qty/remark/marginOverride/sortOrder，切换 productId 与快照', () => {
    const other = createLineItem(db, { spaceId, snapshot: takeSnapshot(prodOld, 20000) }); // 占一个 sortOrder
    const item = createLineItem(db, {
      spaceId, productId: prodOld.id, snapshot: takeSnapshot(prodOld, 20000),
      qty: 3, marginOverride: 1.6, remark: '备注保留',
    });
    const before = getLineItem(db, item.id)!;

    const updated = replaceLineItemProduct(db, item.id, prodNew.id, [], 'lowest');

    expect(updated.productId).toBe(prodNew.id);
    expect(updated.qty).toBe(before.qty);
    expect(updated.qty).toBe(3);
    expect(updated.marginOverride).toBe(1.6);
    expect(updated.remark).toBe('备注保留');
    expect(updated.sortOrder).toBe(before.sortOrder);
    expect(updated.snapshot.name).toBe('新一体机');
    expect(updated.snapshot.brand).toBe('牌B');
    expect(updated.snapshot.costUnitCents).toBe(30000);
    expect(other.id).not.toBe(item.id);
  });

  it('清除 manualUnitPriceCents 与全部 line_item_costs 候选', () => {
    const item = createLineItem(db, {
      spaceId, productId: prodOld.id, snapshot: takeSnapshot(prodOld, 20000),
      manualUnitPriceCents: 99999,
    });
    createLineItemCost(db, { lineItemId: item.id, costUnitCents: 18000, supplierName: '供X' });
    createLineItemCost(db, { lineItemId: item.id, costUnitCents: 19000, supplierName: '供Y' });
    expect(listLineItemCosts(db, item.id)).toHaveLength(2);

    const updated = replaceLineItemProduct(db, item.id, prodNew.id, [], 'lowest');

    expect(updated.manualUnitPriceCents).toBeNull();
    expect(listLineItemCosts(db, item.id)).toHaveLength(0);
  });

  it('选配匹配：optionNames 命中的作为 optionsApplied 传 takeSnapshot，计入成本与参数文案', () => {
    const item = createLineItem(db, { spaceId, productId: prodOld.id, snapshot: takeSnapshot(prodOld, 20000) });

    const updated = replaceLineItemProduct(db, item.id, prodNew.id, ['支架', '不存在的选配'], 'lowest');

    expect(updated.snapshot.optionsApplied).toHaveLength(1);
    expect(updated.snapshot.optionsApplied[0].name).toBe('支架');
    expect(updated.snapshot.costUnitCents).toBe(30000 + 1000);
    expect(updated.snapshot.paramsCore).toContain('选配：支架（壁挂支架）');
  });

  it('optionNames 为空数组时不带选配', () => {
    const item = createLineItem(db, { spaceId, productId: prodOld.id, snapshot: takeSnapshot(prodOld, 20000) });
    const updated = replaceLineItemProduct(db, item.id, prodNew.id, [], 'lowest');
    expect(updated.snapshot.optionsApplied).toEqual([]);
    expect(updated.snapshot.costUnitCents).toBe(30000);
  });

  it('无价格记录时成本按 0 处理，不抛错', () => {
    const prodNoPrice = createProduct(db, { category: '屏幕', name: '无价产品', unit: '台' });
    const item = createLineItem(db, { spaceId, productId: prodOld.id, snapshot: takeSnapshot(prodOld, 20000) });
    const updated = replaceLineItemProduct(db, item.id, prodNoPrice.id, [], 'lowest');
    expect(updated.snapshot.costUnitCents).toBe(0);
  });

  it('手工行（productId 原为 null）也可换产品', () => {
    const item = createLineItem(db, { spaceId, snapshot: takeSnapshot(prodOld, 20000) });
    expect(getLineItem(db, item.id)!.productId).toBeNull();
    const updated = replaceLineItemProduct(db, item.id, prodNew.id, [], 'lowest');
    expect(updated.productId).toBe(prodNew.id);
  });
});
