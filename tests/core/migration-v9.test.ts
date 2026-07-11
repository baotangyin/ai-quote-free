import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { openDb } from '../../src/core/db/db';

describe('migration v9: suppliers 供应商字段细化', () => {
  it('新库 user_version=9，suppliers 含四列 phone/address/payment_terms/bank_info', () => {
    const db = openDb(':memory:');
    expect(db.pragma('user_version', { simple: true })).toBe(11);
    const cols = db.prepare("SELECT name FROM pragma_table_info('suppliers')").all().map((r: any) => r.name);
    expect(cols).toContain('phone');
    expect(cols).toContain('address');
    expect(cols).toContain('payment_terms');
    expect(cols).toContain('bank_info');
    db.close();
  });

  it('新库建表时 suppliers 四字段默认值均为 null', () => {
    const db = openDb(':memory:');
    db.prepare(
      `INSERT INTO suppliers (name, created_at, updated_at)
       VALUES ('供应商A', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`
    ).run();
    const row = db.prepare('SELECT phone, address, payment_terms, bank_info FROM suppliers LIMIT 1').get() as any;
    expect(row.phone).toBeNull();
    expect(row.address).toBeNull();
    expect(row.payment_terms).toBeNull();
    expect(row.bank_info).toBeNull();
    db.close();
  });

  it('迁移幂等：同一文件库重复 openDb 不重复添加列', () => {
    const dbPath = join(tmpdir(), `aiq-mig-v9-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
    try {
      openDb(dbPath).close();
      const db = openDb(dbPath);
      const cols1 = db.prepare("SELECT name FROM pragma_table_info('suppliers')").all().map((r: any) => r.name);
      expect(cols1).toContain('phone');
      expect(cols1).toContain('address');
      expect(cols1).toContain('payment_terms');
      expect(cols1).toContain('bank_info');
      db.close();

      openDb(dbPath).close();
      const db2 = openDb(dbPath);
      const cols2 = db2.prepare("SELECT name FROM pragma_table_info('suppliers')").all().map((r: any) => r.name);
      expect(cols2).toContain('phone');
      expect(cols2).toContain('address');
      expect(cols2).toContain('payment_terms');
      expect(cols2).toContain('bank_info');
      db2.close();
    } finally {
      for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) { try { rmSync(f, { force: true }); } catch { /* ignore */ } }
    }
  });

  it('存量 v8 库升级：既有 suppliers 行四字段回填 null，版本提升到 9，不影响既有数据', () => {
    const dbPath = join(tmpdir(), `aiq-mig-v9-old-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
    // 手工造一个 v8 形态的库（suppliers 无四个新列）
    const seed = new Database(dbPath);
    seed.exec(`CREATE TABLE suppliers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL, contact TEXT, note TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    )`);
    seed.prepare(
      `INSERT INTO suppliers (name, contact, note, created_at, updated_at)
       VALUES ('老供应商', '张三', '备注', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`
    ).run();
    seed.pragma('user_version = 8');
    seed.close();

    try {
      const db = openDb(dbPath);
      expect(db.pragma('user_version', { simple: true })).toBe(11);
      const row = db.prepare('SELECT name, contact, note, phone, address, payment_terms, bank_info FROM suppliers WHERE name = ?').get('老供应商') as any;
      expect(row.name).toBe('老供应商');
      expect(row.contact).toBe('张三');
      expect(row.note).toBe('备注');
      expect(row.phone).toBeNull();
      expect(row.address).toBeNull();
      expect(row.payment_terms).toBeNull();
      expect(row.bank_info).toBeNull();
      db.close();
    } finally {
      for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) { try { rmSync(f, { force: true }); } catch { /* ignore */ } }
    }
  });
});
