import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { openDb } from '../../src/core/db/db';

describe('migration v11: inquiries 供应商询价单', () => {
  it('新库 user_version>=11，含 inquiries / inquiry_items 两表及关键列', () => {
    const db = openDb(':memory:');
    expect(db.pragma('user_version', { simple: true }) as number).toBeGreaterThanOrEqual(11);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r: any) => r.name);
    expect(tables).toContain('inquiries');
    expect(tables).toContain('inquiry_items');

    const inqCols = db.prepare("SELECT name FROM pragma_table_info('inquiries')").all().map((r: any) => r.name);
    expect(inqCols).toEqual(expect.arrayContaining([
      'id', 'supplier_id', 'supplier_name', 'project_id', 'project_name', 'title', 'note', 'created_at', 'updated_at',
    ]));

    const itemCols = db.prepare("SELECT name FROM pragma_table_info('inquiry_items')").all().map((r: any) => r.name);
    expect(itemCols).toEqual(expect.arrayContaining([
      'id', 'inquiry_id', 'product_id', 'name', 'params', 'unit', 'qty', 'remark',
      'reply_price_cents', 'sort_order', 'created_at', 'updated_at',
    ]));
    db.close();
  });

  it('迁移幂等：同一文件库重复 openDb 不重复建表/报错', () => {
    const dbPath = join(tmpdir(), `aiq-mig-v11-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
    try {
      openDb(dbPath).close();
      const db = openDb(dbPath);
      expect(db.pragma('user_version', { simple: true }) as number).toBeGreaterThanOrEqual(11);
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r: any) => r.name);
      expect(tables).toContain('inquiries');
      expect(tables).toContain('inquiry_items');
      db.close();
    } finally {
      for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) { try { rmSync(f, { force: true }); } catch { /* ignore */ } }
    }
  });

  it('存量 v10 库升级：无 inquiries/inquiry_items 表，升级后建表且版本提升到 11+，不影响既有数据', () => {
    const dbPath = join(tmpdir(), `aiq-mig-v11-old-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
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
    seed.pragma('user_version = 10');
    seed.close();

    try {
      const db = openDb(dbPath);
      expect(db.pragma('user_version', { simple: true }) as number).toBeGreaterThanOrEqual(11);
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r: any) => r.name);
      expect(tables).toContain('inquiries');
      expect(tables).toContain('inquiry_items');
      const row = db.prepare("SELECT name FROM suppliers WHERE name = '老供应商'").get() as any;
      expect(row.name).toBe('老供应商');
      db.close();
    } finally {
      for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) { try { rmSync(f, { force: true }); } catch { /* ignore */ } }
    }
  });

  it('外键约束：inquiry_items 插入不存在的 inquiry_id 应抛错', () => {
    const db = openDb(':memory:');
    const now = '2026-01-01T00:00:00.000Z';
    expect(() =>
      db.prepare('INSERT INTO inquiry_items (inquiry_id, name, unit, created_at, updated_at) VALUES (?,?,?,?,?)')
        .run(9999, 'x', '台', now, now)
    ).toThrow();
    db.close();
  });
});
