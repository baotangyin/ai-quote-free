import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, type Db } from '../../src/core/db/db';
import { createProject, createSection, deleteProject } from '../../src/core/repo/projects';
import {
  createEstimateCategory, listEstimateCategories, updateEstimateCategory, deleteEstimateCategory,
  createEstimateRow, listEstimateRows, getEstimateRow, updateEstimateRow, deleteEstimateRow,
  createEstimateNorm, listEstimateNorms, updateEstimateNorm, deleteEstimateNorm,
  seedDefaultCategories,
} from '../../src/core/repo/estimate';

let db: Db;
beforeEach(() => { db = openDb(':memory:'); });

describe('estimate categories', () => {
  it('creates with auto sortOrder appended to tail', () => {
    const pj = createProject(db, { name: 'X' });
    createEstimateCategory(db, { projectId: pj.id, name: '布展装饰工程费' });
    createEstimateCategory(db, { projectId: pj.id, name: '安装工程费' });
    expect(listEstimateCategories(db, pj.id).map(c => c.sortOrder)).toEqual([0, 1]);
  });
  it('lists, updates name, and deletes', () => {
    const pj = createProject(db, { name: 'X' });
    const c = createEstimateCategory(db, { projectId: pj.id, name: '旧名' });
    const u = updateEstimateCategory(db, c.id, { name: '新名' });
    expect(u.name).toBe('新名');
    deleteEstimateCategory(db, c.id);
    expect(listEstimateCategories(db, pj.id)).toHaveLength(0);
  });
});

describe('estimate rows', () => {
  it('defaults valueMethod to manual', () => {
    const pj = createProject(db, { name: 'X' });
    const c = createEstimateCategory(db, { projectId: pj.id, name: 'C' });
    const r = createEstimateRow(db, { categoryId: c.id, name: '子项' });
    expect(r.valueMethod).toBe('manual');
    expect(r.manualAmountCents).toBeNull();
    expect(r.coefBaseCents).toBeNull();
  });
  it('round-trips all three valuation methods', () => {
    const pj = createProject(db, { name: 'X' });
    const c = createEstimateCategory(db, { projectId: pj.id, name: 'C' });
    const sec = createSection(db, { projectId: pj.id, name: 'S' });
    const manual = createEstimateRow(db, { categoryId: c.id, name: '手填', valueMethod: 'manual', manualAmountCents: 123456 });
    expect(getEstimateRow(db, manual.id)!.manualAmountCents).toBe(123456);
    const coef = createEstimateRow(db, { categoryId: c.id, name: '系数', valueMethod: 'coefficient', coefBaseCents: 1000000, coefFactor: 0.05 });
    const coefBack = getEstimateRow(db, coef.id)!;
    expect(coefBack.valueMethod).toBe('coefficient');
    expect(coefBack.coefBaseCents).toBe(1000000);
    expect(coefBack.coefFactor).toBe(0.05);
    const ref = createEstimateRow(db, { categoryId: c.id, name: '引用', valueMethod: 'sectionRef', refSectionId: sec.id });
    expect(getEstimateRow(db, ref.id)!.refSectionId).toBe(sec.id);
  });
  it('lists ordered by sortOrder', () => {
    const pj = createProject(db, { name: 'X' });
    const c = createEstimateCategory(db, { projectId: pj.id, name: 'C' });
    createEstimateRow(db, { categoryId: c.id, name: 'A' });
    createEstimateRow(db, { categoryId: c.id, name: 'B' });
    expect(listEstimateRows(db, c.id).map(r => r.sortOrder)).toEqual([0, 1]);
    expect(listEstimateRows(db, c.id).map(r => r.name)).toEqual(['A', 'B']);
  });
  it('updates and deletes', () => {
    const pj = createProject(db, { name: 'X' });
    const c = createEstimateCategory(db, { projectId: pj.id, name: 'C' });
    const r = createEstimateRow(db, { categoryId: c.id, name: 'R' });
    const u = updateEstimateRow(db, r.id, { name: 'R2', valueMethod: 'coefficient', coefBaseCents: 500, coefFactor: 2 });
    expect(u.name).toBe('R2');
    expect(u.coefFactor).toBe(2);
    deleteEstimateRow(db, r.id);
    expect(listEstimateRows(db, c.id)).toHaveLength(0);
  });
});

describe('cascade delete', () => {
  it('deleting a category cascades to its rows', () => {
    const pj = createProject(db, { name: 'X' });
    const c = createEstimateCategory(db, { projectId: pj.id, name: 'C' });
    createEstimateRow(db, { categoryId: c.id, name: 'R1' });
    createEstimateRow(db, { categoryId: c.id, name: 'R2' });
    deleteEstimateCategory(db, c.id);
    expect(listEstimateRows(db, c.id)).toHaveLength(0);
  });
  it('deleting a project cascades to its categories', () => {
    const pj = createProject(db, { name: 'X' });
    createSection(db, { projectId: pj.id, name: 'S' });
    createEstimateCategory(db, { projectId: pj.id, name: 'C' });
    deleteProject(db, pj.id);
    expect(listEstimateCategories(db, pj.id)).toHaveLength(0);
  });
});

describe('estimate norms', () => {
  it('round-trips CRUD', () => {
    const n = createEstimateNorm(db, { projectType: '科技馆', spaceType: '序厅', unitPriceLowCents: 300000, unitPriceHighCents: 800000, note: '参考' });
    expect(listEstimateNorms(db)).toHaveLength(1);
    expect(n.projectType).toBe('科技馆');
    expect(n.unitPriceLowCents).toBe(300000);
    const u = updateEstimateNorm(db, n.id, { unitPriceHighCents: 900000, note: '更新' });
    expect(u.unitPriceHighCents).toBe(900000);
    expect(u.note).toBe('更新');
    deleteEstimateNorm(db, n.id);
    expect(listEstimateNorms(db)).toHaveLength(0);
  });
});

describe('seedDefaultCategories', () => {
  it('seeds 5 categories with correct rows, idempotent on second call', () => {
    const pj = createProject(db, { name: 'X' });
    const created = seedDefaultCategories(db, pj.id);
    expect(created).toBe(5);
    const cats = listEstimateCategories(db, pj.id);
    expect(cats).toHaveLength(5);
    const rowCounts = cats.map(c => listEstimateRows(db, c.id).length);
    expect(rowCounts).toEqual([4, 3, 3, 3, 3]);
    const totalRows = rowCounts.reduce((a, b) => a + b, 0);
    expect(totalRows).toBe(16);
    // all seeded rows default to manual
    expect(listEstimateRows(db, cats[0].id).every(r => r.valueMethod === 'manual')).toBe(true);

    const again = seedDefaultCategories(db, pj.id);
    expect(again).toBe(0);
    expect(listEstimateCategories(db, pj.id)).toHaveLength(5);
  });
});
