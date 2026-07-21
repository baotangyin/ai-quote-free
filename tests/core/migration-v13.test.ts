import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { openDb, CURRENT_SCHEMA_VERSION } from '../../src/core/db/db';

describe('migration v13: ai_usage_queue AI 用量本地队列', () => {
  it('新库 user_version>=13，含 ai_usage_queue 表及关键列', () => {
    const db = openDb(':memory:');
    expect(db.pragma('user_version', { simple: true }) as number).toBe(CURRENT_SCHEMA_VERSION);
    const cols = db.prepare("SELECT name FROM pragma_table_info('ai_usage_queue')").all().map((r: any) => r.name);
    expect(cols).toEqual(expect.arrayContaining([
      'id', 'feature', 'model', 'protocol', 'ok', 'prompt_tokens', 'completion_tokens', 'at',
    ]));
    db.close();
  });

  it('存量 v12 库升级：建表且版本提升到 13，不影响既有数据', () => {
    const dbPath = join(tmpdir(), `aiq-mig-v13-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
    const seed = new Database(dbPath);
    seed.exec(`CREATE TABLE suppliers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL, contact TEXT, note TEXT,
      phone TEXT, address TEXT, payment_terms TEXT, bank_info TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    )`);
    seed.prepare(
      `INSERT INTO suppliers (name, created_at, updated_at) VALUES ('存量供应商', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`
    ).run();
    seed.pragma('user_version = 12');
    seed.close();

    try {
      const db = openDb(dbPath);
      expect(db.pragma('user_version', { simple: true }) as number).toBe(13);
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r: any) => r.name);
      expect(tables).toContain('ai_usage_queue');
      const row = db.prepare("SELECT name FROM suppliers WHERE name = '存量供应商'").get() as any;
      expect(row.name).toBe('存量供应商');
      db.close();
    } finally {
      for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) { try { rmSync(f, { force: true }); } catch { /* ignore */ } }
    }
  });

  it('迁移幂等：重复 openDb 不报错', () => {
    const dbPath = join(tmpdir(), `aiq-mig-v13-idem-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
    try {
      openDb(dbPath).close();
      const db = openDb(dbPath);
      expect(db.pragma('user_version', { simple: true }) as number).toBe(13);
      db.close();
    } finally {
      for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) { try { rmSync(f, { force: true }); } catch { /* ignore */ } }
    }
  });
});
