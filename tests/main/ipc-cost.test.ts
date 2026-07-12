import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../../src/core/db/db';
import { handlers } from '../../src/main/ipc';
import { ensureSettingsTable } from '../../src/main/settings';

function buildDb() {
  const db = openDb(':memory:');
  ensureSettingsTable(db);
  return db;
}

/** 建 项目→板块→空间，返回三者。 */
function createTree(db: any) {
  const project = handlers['projects:create'](db, { name: 'T', mode: 'pricing' });
  const section = handlers['sections:create'](db, { projectId: project.id, name: '硬件' });
  const space = handlers['spaces:create'](db, { sectionId: section.id, name: '会议室', area: 30 });
  return { project, section, space };
}

/** 建产品并加一条价格记录（可指定供应商），返回产品。 */
function createProduct(db: any, name: string, priceCents: number, supplierId?: number) {
  const p = handlers['products:create'](db, { name, unit: '台' });
  handlers['prices:add'](db, { productId: p.id, source: 'manual', priceCents, supplierId });
  return p;
}

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
  tmpDirs.length = 0;
});

describe('itemCosts CRUD round-trip', () => {
  it('create/list/update/delete', () => {
    const db = buildDb();
    const { space } = createTree(db);
    const product = createProduct(db, '交换机', 10000);
    const item = handlers['items:createFromProduct'](db, { spaceId: space.id, productId: product.id, qty: 1 });

    const cost = handlers['itemCosts:create'](db, {
      lineItemId: item.id, costUnitCents: 9000, supplierName: '甲', brand: 'B', model: 'M',
    });
    expect(cost.id).toBeDefined();
    expect(cost.costUnitCents).toBe(9000);

    const list = handlers['itemCosts:list'](db, item.id);
    expect(list.map((c: any) => c.id)).toContain(cost.id);

    const updated = handlers['itemCosts:update'](db, { id: cost.id, patch: { costUnitCents: 8500, note: '砍价' } });
    expect(updated.costUnitCents).toBe(8500);
    expect(updated.note).toBe('砍价');

    expect(handlers['itemCosts:delete'](db, cost.id)).toBeNull();
    expect(handlers['itemCosts:list'](db, item.id).map((c: any) => c.id)).not.toContain(cost.id);
  });
});

describe('itemCosts:setActive', () => {
  it('设为生效同步快照成本，且仅一个候选 isActive', () => {
    const db = buildDb();
    const { space } = createTree(db);
    const product = createProduct(db, '交换机', 10000);
    const item = handlers['items:createFromProduct'](db, { spaceId: space.id, productId: product.id, qty: 1 });

    const c1 = handlers['itemCosts:create'](db, { lineItemId: item.id, costUnitCents: 9000, supplierName: '甲' });
    const c2 = handlers['itemCosts:create'](db, { lineItemId: item.id, costUnitCents: 7000, supplierName: '乙' });

    const li = handlers['itemCosts:setActive'](db, c2.id);
    expect(li.snapshot.costUnitCents).toBe(7000);

    const list = handlers['itemCosts:list'](db, item.id);
    const active = list.filter((c: any) => c.isActive);
    expect(active.length).toBe(1);
    expect(active[0].id).toBe(c2.id);
    expect(list.find((c: any) => c.id === c1.id).isActive).toBe(false);
  });
});

describe('itemCosts:seedFromPrices', () => {
  it('两供应商价格播种候选；再次调用幂等返回 0', () => {
    const db = buildDb();
    const { space } = createTree(db);
    const s1 = handlers['suppliers:create'](db, { name: '供应商甲' });
    const s2 = handlers['suppliers:create'](db, { name: '供应商乙' });
    const p = handlers['products:create'](db, { name: '交换机', unit: '台' });
    handlers['prices:add'](db, { productId: p.id, source: 'manual', priceCents: 10000, supplierId: s1.id });
    handlers['prices:add'](db, { productId: p.id, source: 'manual', priceCents: 9500, supplierId: s2.id });
    const item = handlers['items:createFromProduct'](db, { spaceId: space.id, productId: p.id, qty: 1 });

    const n = handlers['itemCosts:seedFromPrices'](db, item.id);
    expect(n).toBe(2);
    expect(handlers['itemCosts:list'](db, item.id).length).toBe(2);

    expect(handlers['itemCosts:seedFromPrices'](db, item.id)).toBe(0);
  });
});

describe('export:costCompare', () => {
  it('pricing 项目导出成本对比版，返回文件路径', async () => {
    const db = buildDb();
    const { project, space } = createTree(db);
    const product = createProduct(db, '交换机', 10000);
    const item = handlers['items:createFromProduct'](db, { spaceId: space.id, productId: product.id, qty: 1 });
    handlers['itemCosts:create'](db, { lineItemId: item.id, costUnitCents: 9000, supplierName: '甲' });

    const outDir = mkdtempSync(join(tmpdir(), 'cost-compare-'));
    tmpDirs.push(outDir);
    const file = await handlers['export:costCompare'](db, { projectId: project.id, outDir });
    expect(file).toContain('成本对比版');
  });
});
