import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { openDb } from '../../src/core/db/db';

describe('migration v10: category_param_templates 类别参数模板', () => {
  it('新库 user_version=10，含 category_param_templates 表', () => {
    const db = openDb(':memory:');
    expect(db.pragma('user_version', { simple: true })).toBe(11);
    const cols = db.prepare("SELECT name FROM pragma_table_info('category_param_templates')").all().map((r: any) => r.name);
    expect(cols).toContain('id');
    expect(cols).toContain('category');
    expect(cols).toContain('defaults');
    expect(cols).toContain('created_at');
    expect(cols).toContain('updated_at');
    db.close();
  });

  it('category 列唯一约束', () => {
    const db = openDb(':memory:');
    const t = '2026-01-01T00:00:00.000Z';
    db.prepare('INSERT INTO category_param_templates (category, defaults, created_at, updated_at) VALUES (?,?,?,?)')
      .run('LED屏', '{}', t, t);
    expect(() =>
      db.prepare('INSERT INTO category_param_templates (category, defaults, created_at, updated_at) VALUES (?,?,?,?)')
        .run('LED屏', '{}', t, t)
    ).toThrow();
    db.close();
  });

  it('迁移幂等：同一文件库重复 openDb 不重复建表/报错', () => {
    const dbPath = join(tmpdir(), `aiq-mig-v10-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
    try {
      openDb(dbPath).close();
      const db = openDb(dbPath);
      expect(db.pragma('user_version', { simple: true })).toBe(11);
      db.close();
    } finally {
      for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) { try { rmSync(f, { force: true }); } catch { /* ignore */ } }
    }
  });

  it('存量 v9 库升级：无 category_param_templates 表，升级后建表且版本提升到 10，不影响既有数据', () => {
    const dbPath = join(tmpdir(), `aiq-mig-v10-old-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
    const seed = new Database(dbPath);
    seed.exec(`CREATE TABLE suppliers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL, contact TEXT, note TEXT,
      phone TEXT, address TEXT, payment_terms TEXT, bank_info TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    )`);
    seed.prepare(
      `INSERT INTO suppliers (name, created_at, updated_at) VALUES ('老供应商', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`
    ).run();
    seed.pragma('user_version = 9');
    seed.close();

    try {
      const db = openDb(dbPath);
      expect(db.pragma('user_version', { simple: true })).toBe(11);
      const cols = db.prepare("SELECT name FROM pragma_table_info('category_param_templates')").all().map((r: any) => r.name);
      expect(cols).toContain('category');
      expect(cols).toContain('defaults');
      const row = db.prepare("SELECT name FROM suppliers WHERE name = '老供应商'").get() as any;
      expect(row.name).toBe('老供应商');
      db.close();
    } finally {
      for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) { try { rmSync(f, { force: true }); } catch { /* ignore */ } }
    }
  });
});
