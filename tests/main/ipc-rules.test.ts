import { describe, it, expect } from 'vitest';
import { openDb } from '../../src/core/db/db';
import { handlers } from '../../src/main/ipc';
import { ensureSettingsTable } from '../../src/main/settings';

function buildDb() {
  const db = openDb(':memory:');
  ensureSettingsTable(db);
  return db;
}

function createProject(db: any) {
  return handlers['projects:create'](db, { name: 'T', mode: 'pricing' });
}

/** 建 项目→板块→空间，返回三者 id。 */
function createTree(db: any) {
  const project = createProject(db);
  const section = handlers['sections:create'](db, { projectId: project.id, name: '硬件' });
  const space = handlers['spaces:create'](db, { sectionId: section.id, name: '会议室', area: 30 });
  return { project, section, space };
}

/** 建产品（可选加价格记录）。 */
function createProduct(db: any, name: string, withPrice: boolean) {
  const p = handlers['products:create'](db, { name, unit: '台' });
  if (withPrice) {
    handlers['prices:add'](db, { productId: p.id, source: 'manual', priceCents: 10000 });
  }
  return p;
}

describe('rules CRUD round-trip', () => {
  it('create/get/list/update/delete（含 actions）', () => {
    const db = buildDb();
    const rule = handlers['rules:create'](db, {
      name: 'UPS 配套',
      triggerType: 'product',
      triggerValue: '1',
      actions: [{ productId: 2, qtyFormula: 'ceil(qty)', optional: false, note: '备电' }],
    });
    expect(rule.id).toBeDefined();
    expect(rule.actions.length).toBe(1);

    const got = handlers['rules:get'](db, rule.id);
    expect(got.name).toBe('UPS 配套');

    const list = handlers['rules:list'](db, undefined);
    expect(list.map((r: any) => r.id)).toContain(rule.id);

    const updated = handlers['rules:update'](db, { id: rule.id, patch: { name: '改名', enabled: false } });
    expect(updated.name).toBe('改名');
    expect(updated.enabled).toBe(false);

    expect(handlers['rules:delete'](db, rule.id)).toBeNull();
    expect(handlers['rules:list'](db, undefined).map((r: any) => r.id)).not.toContain(rule.id);
  });
});

describe('rules:evaluateItem', () => {
  it('product 触发 ceil(qty) 产出候选', () => {
    const db = buildDb();
    const { project, space } = createTree(db);
    const trigger = createProduct(db, '触发产品', true);
    const mat = createProduct(db, '配套产品', true);

    handlers['rules:create'](db, {
      name: '配套规则',
      triggerType: 'product',
      triggerValue: String(trigger.id),
      actions: [{ productId: mat.id, qtyFormula: 'ceil(qty)', optional: false, note: null }],
    });

    const item = handlers['items:createFromProduct'](db, {
      spaceId: space.id, productId: trigger.id, qty: 3,
    });

    const candidates = handlers['rules:evaluateItem'](db, { projectId: project.id, itemId: item.id });
    expect(candidates.length).toBe(1);
    expect(candidates[0].productId).toBe(mat.id);
    expect(candidates[0].qty).toBe(3);
  });
});

describe('rules:evaluateProject', () => {
  it('projectType 匹配返回候选；未设 projectType 返回 []', () => {
    const db = buildDb();
    const { project } = createTree(db);
    const mat = createProduct(db, '项目级配套', true);

    handlers['rules:create'](db, {
      name: '项目类型规则',
      triggerType: 'projectType',
      triggerValue: '指挥中心',
      actions: [{ productId: mat.id, qtyFormula: '2', optional: false, note: null }],
    });

    // 未设 projectType
    expect(handlers['rules:evaluateProject'](db, project.id)).toEqual([]);

    handlers['projects:update'](db, { id: project.id, patch: { projectType: '指挥中心' } });
    const candidates = handlers['rules:evaluateProject'](db, project.id);
    expect(candidates.length).toBe(1);
    expect(candidates[0].productId).toBe(mat.id);
    expect(candidates[0].qty).toBe(2);
  });
});

describe('rules:apply', () => {
  it('有价格→created；无价格→skipped，并核对新增行数', () => {
    const db = buildDb();
    const { space } = createTree(db);
    const priced = createProduct(db, '有价', true);
    const noPrice = createProduct(db, '无价', false);

    const before = handlers['items:list'](db, space.id).length;
    const result = handlers['rules:apply'](db, {
      spaceId: space.id,
      items: [
        { productId: priced.id, qty: 2 },
        { productId: noPrice.id, qty: 1 },
      ],
    });
    expect(result.created).toBe(1);
    expect(result.skipped).toBe(1);

    const after = handlers['items:list'](db, space.id).length;
    expect(after - before).toBe(1);
  });
});
