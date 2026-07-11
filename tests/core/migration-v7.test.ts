import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { openDb } from '../../src/core/db/db';

describe('migration v7: products.watch_price', () => {
  it('新库 user_version=7，含 products.watch_price 列，默认值为 0', () => {
    const db = openDb(':memory:');
    expect(db.pragma('user_version', { simple: true })).toBe(11);
    const cols = db.prepare("SELECT name FROM pragma_table_info('products')").all().map((r: any) => r.name);
    expect(cols).toContain('watch_price');
    db.close();
  });

  it('新库建表时 products 行 watch_price 默认 0（不监控）', () => {
    const db = openDb(':memory:');
    db.prepare(
      `INSERT INTO products (category, name, unit, created_at, updated_at)
       VALUES ('LED屏', 'P1.8屏', '㎡', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`
    ).run();
    const row = db.prepare('SELECT watch_price FROM products LIMIT 1').get() as any;
    expect(row.watch_price).toBe(0);
    db.close();
  });

  it('迁移幂等：同一文件库重复 openDb 不重复添加列', () => {
    const dbPath = join(tmpdir(), `aiq-mig-v7-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
    try {
      openDb(dbPath).close();
      const db = openDb(dbPath);
      const cols1 = db.prepare("SELECT name FROM pragma_table_info('products')").all().map((r: any) => r.name);
      expect(cols1).toContain('watch_price');
      db.close();

      openDb(dbPath).close();
      const db2 = openDb(dbPath);
      const cols2 = db2.prepare("SELECT name FROM pragma_table_info('products')").all().map((r: any) => r.name);
      expect(cols2).toContain('watch_price');
      db2.close();
    } finally {
      for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) { try { rmSync(f, { force: true }); } catch { /* ignore */ } }
    }
  });

  it('存量 v6 库升级：既有 products 行 watch_price 回填 0，版本提升到 7', () => {
    const dbPath = join(tmpdir(), `aiq-mig-v7-old-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
    // 手工造一个 v6 形态的库（无 watch_price 列）
    const seed = new Database(dbPath);
    seed.exec(`CREATE TABLE products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL, categories TEXT NOT NULL DEFAULT '[]', name TEXT NOT NULL,
      brand TEXT, model TEXT,
      recommended_brands TEXT NOT NULL DEFAULT '[]',
      params_core TEXT, params_bid TEXT, params_tender TEXT,
      unit TEXT NOT NULL DEFAULT '台', dims TEXT,
      power220_w REAL NOT NULL DEFAULT 0, power380_w REAL NOT NULL DEFAULT 0,
      rack_u REAL NOT NULL DEFAULT 0, seq_power_ports REAL NOT NULL DEFAULT 0,
      net_ports REAL NOT NULL DEFAULT 0, com_ports REAL NOT NULL DEFAULT 0,
      image_path TEXT, note TEXT,
      options TEXT NOT NULL DEFAULT '[]',
      cost_rule_override TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    )`);
    seed.prepare(
      `INSERT INTO products (category, name, unit, created_at, updated_at)
       VALUES ('LED屏', 'P1.8屏', '㎡', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`
    ).run();
    seed.pragma('user_version = 6');
    seed.close();

    try {
      const db = openDb(dbPath);
      expect(db.pragma('user_version', { simple: true })).toBe(11);
      const row = db.prepare('SELECT watch_price FROM products WHERE name = ?').get('P1.8屏') as any;
      expect(row.watch_price).toBe(0);
      db.close();
    } finally {
      for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) { try { rmSync(f, { force: true }); } catch { /* ignore */ } }
    }
  });
});
