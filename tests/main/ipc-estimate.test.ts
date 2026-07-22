import { describe, it, expect } from 'vitest';
import { openDb } from '../../src/core/db/db';
import { handlers } from '../../src/main/ipc';

function buildDb() {
  return openDb(':memory:');
}

function createProject(db: any) {
  return handlers['projects:create'](db, { name: 'T', mode: 'estimate' });
}

describe('estimate:categories round-trip', () => {
  it('create/list/update/delete', () => {
    const db = buildDb();
    const project = createProject(db);
    const cat = handlers['estimate:categories:create'](db, { projectId: project.id, name: '智能化' });
    expect(cat.id).toBeDefined();
    expect(cat.name).toBe('智能化');

    const list = handlers['estimate:categories:list'](db, project.id);
    expect(list.map((c: any) => c.id)).toContain(cat.id);

    const updated = handlers['estimate:categories:update'](db, { id: cat.id, patch: { name: '弱电' } });
    expect(updated.name).toBe('弱电');

    expect(handlers['estimate:categories:delete'](db, cat.id)).toBeNull();
    expect(handlers['estimate:categories:list'](db, project.id).map((c: any) => c.id)).not.toContain(cat.id);
  });
});

describe('estimate:rows round-trip', () => {
  it('create（含 valueMethod）/list/update/delete', () => {
    const db = buildDb();
    const project = createProject(db);
    const cat = handlers['estimate:categories:create'](db, { projectId: project.id, name: '智能化' });
    const row = handlers['estimate:rows:create'](db, {
      categoryId: cat.id, name: '综合布线', valueMethod: 'manual', manualAmountCents: 500000,
    });
    expect(row.id).toBeDefined();
    expect(row.valueMethod).toBe('manual');

    const list = handlers['estimate:rows:list'](db, cat.id);
    expect(list.map((r: any) => r.id)).toContain(row.id);

    const updated = handlers['estimate:rows:update'](db, { id: row.id, patch: { name: '布线2', manualAmountCents: 600000 } });
    expect(updated.name).toBe('布线2');
    expect(updated.manualAmountCents).toBe(600000);

    expect(handlers['estimate:rows:delete'](db, row.id)).toBeNull();
    expect(handlers['estimate:rows:list'](db, cat.id).map((r: any) => r.id)).not.toContain(row.id);
  });
});

describe('estimate:norms round-trip', () => {
  it('create/list/update/delete', () => {
    const db = buildDb();
    const norm = handlers['estimate:norms:create'](db, {
      projectType: '办公', spaceType: '会议室', unitPriceLowCents: 10000, unitPriceHighCents: 20000,
    });
    expect(norm.id).toBeDefined();

    const list = handlers['estimate:norms:list'](db, undefined);
    expect(list.map((n: any) => n.id)).toContain(norm.id);

    const updated = handlers['estimate:norms:update'](db, { id: norm.id, patch: { note: '备注' } });
    expect(updated.note).toBe('备注');

    expect(handlers['estimate:norms:delete'](db, norm.id)).toBeNull();
    expect(handlers['estimate:norms:list'](db, undefined).map((n: any) => n.id)).not.toContain(norm.id);
  });
});

describe('estimate:seed', () => {
  it('首次返回 5，再次返回 0', () => {
    const db = buildDb();
    const project = createProject(db);
    expect(handlers['estimate:seed'](db, project.id)).toBe(5);
    expect(handlers['estimate:seed'](db, project.id)).toBe(0);
  });
});

describe('estimate:assemble', () => {
  it('seed 后返回含 categories 数组与 grandTotalCents 的对象', () => {
    const db = buildDb();
    const project = createProject(db);
    handlers['estimate:seed'](db, project.id);
    const assembled = handlers['estimate:assemble'](db, project.id);
    expect(Array.isArray(assembled.categories)).toBe(true);
    expect(assembled.categories.length).toBe(5);
    expect(typeof assembled.grandTotalCents).toBe('number');
  });
});
