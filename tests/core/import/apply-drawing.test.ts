import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, type Db } from '../../../src/core/db/db';
import { createProduct, deleteProduct } from '../../../src/core/repo/products';
import { addPriceRecord } from '../../../src/core/repo/prices';
import { createProject, createSection, createSpace, listSpaces, listLineItems } from '../../../src/core/repo/projects';
import { applyDrawingToSection, type ApplyDrawingSpace } from '../../../src/core/import/applyDrawing';

let db: Db;
let sectionId: number;

beforeEach(() => {
  db = openDb(':memory:');
  const pj = createProject(db, { name: 'T' });
  sectionId = createSection(db, { projectId: pj.id, name: 'S' }).id;
});

describe('applyDrawingToSection', () => {
  it('产品行：快照成本来源于 getEffectiveCost', () => {
    const pid = createProduct(db, { category: 'LED屏', name: 'P2屏', unit: '㎡' }).id;
    addPriceRecord(db, { productId: pid, source: 'manual', priceCents: 50000, capturedAt: '2026-01-01' });
    addPriceRecord(db, { productId: pid, source: 'manual', priceCents: 30000, capturedAt: '2026-02-01' });

    const spaces: ApplyDrawingSpace[] = [
      { name: '大厅', items: [{ name: 'P2屏', qty: 2, remark: null, productId: pid }] },
    ];

    const result = applyDrawingToSection(db, sectionId, spaces, 'lowest');

    expect(result).toEqual({ spaces: 1, items: 1 });
    const sp = listSpaces(db, sectionId);
    expect(sp).toHaveLength(1);
    expect(sp[0].name).toBe('大厅');
    const items = listLineItems(db, sp[0].id);
    expect(items).toHaveLength(1);
    expect(items[0].productId).toBe(pid);
    expect(items[0].qty).toBe(2);
    expect(items[0].snapshot.name).toBe('P2屏');
    expect(items[0].snapshot.costUnitCents).toBe(30000); // lowest 规则
  });

  it('产品已删：降级为手工行（productId=null，走手工快照）', () => {
    const pid = createProduct(db, { category: 'LED屏', name: '已删产品', unit: '台' }).id;
    deleteProduct(db, pid);

    const spaces: ApplyDrawingSpace[] = [
      { name: '大厅', items: [{ name: '已删产品', qty: 1, remark: '备注', productId: pid }] },
    ];

    const result = applyDrawingToSection(db, sectionId, spaces, 'latest');

    expect(result).toEqual({ spaces: 1, items: 1 });
    const sp = listSpaces(db, sectionId);
    const items = listLineItems(db, sp[0].id);
    expect(items[0].productId).toBeNull();
    expect(items[0].snapshot.name).toBe('已删产品');
    expect(items[0].snapshot.costUnitCents).toBe(0);
  });

  it('手工行（productId=null）：字段全断言', () => {
    const spaces: ApplyDrawingSpace[] = [
      { name: '大厅', items: [{ name: '手工设备', qty: 3, remark: '现场定制', productId: null }] },
    ];

    applyDrawingToSection(db, sectionId, spaces, 'latest');

    const sp = listSpaces(db, sectionId);
    const items = listLineItems(db, sp[0].id);
    expect(items).toHaveLength(1);
    const item = items[0];
    expect(item.productId).toBeNull();
    expect(item.qty).toBe(3);
    expect(item.remark).toBe('现场定制');
    expect(item.snapshot).toEqual({
      name: '手工设备',
      brand: null,
      model: null,
      recommendedBrands: [],
      paramsCore: null,
      paramsBid: null,
      paramsTender: null,
      unit: '台',
      dims: null,
      power220W: 0,
      power380W: 0,
      rackU: 0,
      seqPowerPorts: 0,
      netPorts: 0,
      comPorts: 0,
      costUnitCents: 0,
      optionsApplied: [],
    });
  });

  it('置底空间前插入：新建空间自然排在已有置底空间之前', () => {
    const pinned = createSpace(db, { sectionId, name: '置底空间', pinBottom: true });

    const spaces: ApplyDrawingSpace[] = [
      { name: '新空间A', items: [] },
      { name: '新空间B', items: [] },
    ];

    applyDrawingToSection(db, sectionId, spaces, 'latest');

    const sp = listSpaces(db, sectionId);
    expect(sp.map((s) => s.name)).toEqual(['新空间A', '新空间B', '置底空间']);
    expect(sp[sp.length - 1].id).toBe(pinned.id);
  });

  it('空 spaces：返回 {spaces:0, items:0}，不落库', () => {
    const result = applyDrawingToSection(db, sectionId, [], 'latest');
    expect(result).toEqual({ spaces: 0, items: 0 });
    expect(listSpaces(db, sectionId)).toEqual([]);
  });

  it('section 不存在：抛错，事务不落任何库', () => {
    const spaces: ApplyDrawingSpace[] = [
      { name: '大厅', items: [{ name: '手工设备', qty: 1, remark: null, productId: null }] },
    ];
    expect(() => applyDrawingToSection(db, 999999, spaces, 'latest')).toThrow('板块 999999 不存在');
  });
});
