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

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
  tmpDirs.length = 0;
});

describe('products:batchDelete', () => {
  it('删 2 条返回 2，列表剩 1', () => {
    const db = buildDb();
    const a = handlers['products:create'](db, { name: 'A', unit: '台' });
    const b = handlers['products:create'](db, { name: 'B', unit: '台' });
    const c = handlers['products:create'](db, { name: 'C', unit: '台' });
    expect(handlers['products:batchDelete'](db, [a.id, b.id])).toBe(2);
    const rest = handlers['products:list'](db, undefined);
    expect(rest.map((p: any) => p.id)).toEqual([c.id]);
  });
});

describe('suppliers:batchDelete', () => {
  it('删 2 条返回 2，列表剩 1', () => {
    const db = buildDb();
    const a = handlers['suppliers:create'](db, { name: '甲' });
    const b = handlers['suppliers:create'](db, { name: '乙' });
    const c = handlers['suppliers:create'](db, { name: '丙' });
    expect(handlers['suppliers:batchDelete'](db, [a.id, b.id])).toBe(2);
    expect(handlers['suppliers:list'](db, undefined).map((s: any) => s.id)).toEqual([c.id]);
  });
});

describe('projects:batchDelete', () => {
  it('删 2 条返回 2，列表剩 1', () => {
    const db = buildDb();
    const a = handlers['projects:create'](db, { name: 'P1', mode: 'pricing' });
    const b = handlers['projects:create'](db, { name: 'P2', mode: 'pricing' });
    const c = handlers['projects:create'](db, { name: 'P3', mode: 'pricing' });
    expect(handlers['projects:batchDelete'](db, [a.id, b.id])).toBe(2);
    expect(handlers['projects:list'](db, undefined).map((p: any) => p.id)).toEqual([c.id]);
  });
});

describe('rules:batchDelete', () => {
  it('删 2 条返回 2，列表剩 1', () => {
    const db = buildDb();
    const a = handlers['rules:create'](db, { name: 'R1', triggerType: 'category', triggerValue: 'x' });
    const b = handlers['rules:create'](db, { name: 'R2', triggerType: 'category', triggerValue: 'y' });
    const c = handlers['rules:create'](db, { name: 'R3', triggerType: 'category', triggerValue: 'z' });
    expect(handlers['rules:batchDelete'](db, [a.id, b.id])).toBe(2);
    expect(handlers['rules:list'](db, undefined).map((r: any) => r.id)).toEqual([c.id]);
  });
});

describe('estimate:norms:batchDelete', () => {
  it('删 2 条返回 2，列表剩 1', () => {
    const db = buildDb();
    const a = handlers['estimate:norms:create'](db, { projectType: '办公', spaceType: '会议室' });
    const b = handlers['estimate:norms:create'](db, { projectType: '办公', spaceType: '大厅' });
    const c = handlers['estimate:norms:create'](db, { projectType: '办公', spaceType: '走廊' });
    expect(handlers['estimate:norms:batchDelete'](db, [a.id, b.id])).toBe(2);
    expect(handlers['estimate:norms:list'](db, undefined).map((n: any) => n.id)).toEqual([c.id]);
  });
});

describe('products:batchSetCategories', () => {
  it('replace 替换分类', () => {
    const db = buildDb();
    const a = handlers['products:create'](db, { name: 'A', unit: '台', categories: ['旧1', '旧2'] });
    const b = handlers['products:create'](db, { name: 'B', unit: '台', categories: ['旧3'] });
    const n = handlers['products:batchSetCategories'](db, { ids: [a.id, b.id], categories: ['新'], mode: 'replace' });
    expect(n).toBe(2);
    expect(handlers['products:get'](db, a.id).categories).toEqual(['新']);
    expect(handlers['products:get'](db, b.id).categories).toEqual(['新']);
  });

  it('append 合并去重保序，跳过不存在产品', () => {
    const db = buildDb();
    const a = handlers['products:create'](db, { name: 'A', unit: '台', categories: ['交换机', '网络'] });
    const n = handlers['products:batchSetCategories'](db, { ids: [a.id, 999999], categories: ['网络', '核心'], mode: 'append' });
    expect(n).toBe(1);
    expect(handlers['products:get'](db, a.id).categories).toEqual(['交换机', '网络', '核心']);
  });
});

describe('projects:batchSetStatus', () => {
  it('批量设为 done', () => {
    const db = buildDb();
    const a = handlers['projects:create'](db, { name: 'P1', mode: 'pricing' });
    const b = handlers['projects:create'](db, { name: 'P2', mode: 'pricing' });
    const n = handlers['projects:batchSetStatus'](db, { ids: [a.id, b.id], status: 'done' });
    expect(n).toBe(2);
    expect(handlers['projects:get'](db, a.id).status).toBe('done');
    expect(handlers['projects:get'](db, b.id).status).toBe('done');
  });
});

describe('projects:duplicate', () => {
  it('复制带板块项目返回新 Project，id 不同且名称含副本', () => {
    const db = buildDb();
    const p = handlers['projects:create'](db, { name: '原项目', mode: 'pricing' });
    handlers['sections:create'](db, { projectId: p.id, name: '硬件' });
    const copy = handlers['projects:duplicate'](db, p.id);
    expect(copy.id).not.toBe(p.id);
    expect(copy.name).toContain('副本');
    expect(handlers['sections:list'](db, copy.id).length).toBe(1);
  });
});

describe('export:products', () => {
  it('返回文件路径含关键字', async () => {
    const db = buildDb();
    const a = handlers['products:create'](db, { name: '交换机', unit: '台' });
    const outDir = mkdtempSync(join(tmpdir(), 'export-products-'));
    tmpDirs.push(outDir);
    const file = await handlers['export:products'](db, { ids: [a.id], outDir });
    expect(file).toContain('产品库');
  });
});

describe('export:suppliers', () => {
  it('返回文件路径含关键字', async () => {
    const db = buildDb();
    const s = handlers['suppliers:create'](db, { name: '供应商甲' });
    const outDir = mkdtempSync(join(tmpdir(), 'export-suppliers-'));
    tmpDirs.push(outDir);
    const file = await handlers['export:suppliers'](db, { ids: [s.id], outDir });
    expect(file).toContain('供应商');
  });
});
