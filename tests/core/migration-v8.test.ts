import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { openDb } from '../../src/core/db/db';
import { CURRENT_SCHEMA_VERSION } from '../../src/core/db/db';

describe('migration v8: sections 板块行名与联动开关字段', () => {
  it('新库 user_version=8，sections 含三列 subtotal_label/fee_label/link_spaces', () => {
    const db = openDb(':memory:');
    expect(db.pragma('user_version', { simple: true })).toBe(CURRENT_SCHEMA_VERSION);
    const cols = db.prepare("SELECT name FROM pragma_table_info('sections')").all().map((r: any) => r.name);
    expect(cols).toContain('subtotal_label');
    expect(cols).toContain('fee_label');
    expect(cols).toContain('link_spaces');
    db.close();
  });

  it('新库建表时 sections 行三字段默认值：subtotal_label=null，fee_label=null，link_spaces=0', () => {
    const db = openDb(':memory:');
    db.prepare(
      `INSERT INTO projects (id, name, mode, status, created_at, updated_at)
       VALUES (1, '测试项目', 'budget', 'draft', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`
    ).run();
    db.prepare(
      `INSERT INTO sections (project_id, name, sort_order, integration_fee_rate, is_hardware, created_at, updated_at)
       VALUES (1, '展厅硬件', 0, 0.05, 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`
    ).run();
    const row = db.prepare('SELECT subtotal_label, fee_label, link_spaces FROM sections LIMIT 1').get() as any;
    expect(row.subtotal_label).toBeNull();
    expect(row.fee_label).toBeNull();
    expect(row.link_spaces).toBe(0);
    db.close();
  });

  it('迁移幂等：同一文件库重复 openDb 不重复添加列', () => {
    const dbPath = join(tmpdir(), `aiq-mig-v8-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
    try {
      openDb(dbPath).close();
      const db = openDb(dbPath);
      const cols1 = db.prepare("SELECT name FROM pragma_table_info('sections')").all().map((r: any) => r.name);
      expect(cols1).toContain('subtotal_label');
      expect(cols1).toContain('fee_label');
      expect(cols1).toContain('link_spaces');
      db.close();

      openDb(dbPath).close();
      const db2 = openDb(dbPath);
      const cols2 = db2.prepare("SELECT name FROM pragma_table_info('sections')").all().map((r: any) => r.name);
      expect(cols2).toContain('subtotal_label');
      expect(cols2).toContain('fee_label');
      expect(cols2).toContain('link_spaces');
      db2.close();
    } finally {
      for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) { try { rmSync(f, { force: true }); } catch { /* ignore */ } }
    }
  });

  it('存量 v7 库升级：既有 sections 行三字段回填默认值，版本提升到 8', () => {
    const dbPath = join(tmpdir(), `aiq-mig-v8-old-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
    // 手工造一个 v7 形态的库（无三个新列）
    const seed = new Database(dbPath);
    seed.exec(`CREATE TABLE projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL, client TEXT, project_type TEXT,
      mode TEXT NOT NULL DEFAULT 'budget' CHECK (mode IN ('estimate','budget','pricing','tender')),
      default_margin REAL NOT NULL DEFAULT 1.3,
      round_rule TEXT NOT NULL DEFAULT 'yuan' CHECK (round_rule IN ('cent','yuan','ten')),
      status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','done')),
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    )`);
    seed.exec(`CREATE TABLE sections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0,
      integration_fee_rate REAL NOT NULL DEFAULT 0,
      is_hardware INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    )`);
    seed.prepare(
      `INSERT INTO projects (name, mode, status, created_at, updated_at)
       VALUES ('展厅方案', 'budget', 'draft', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`
    ).run();
    seed.prepare(
      `INSERT INTO sections (project_id, name, sort_order, integration_fee_rate, is_hardware, created_at, updated_at)
       VALUES (1, '展厅硬件', 0, 0.05, 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`
    ).run();
    seed.pragma('user_version = 7');
    seed.close();

    try {
      const db = openDb(dbPath);
      expect(db.pragma('user_version', { simple: true })).toBe(CURRENT_SCHEMA_VERSION);
      const row = db.prepare('SELECT subtotal_label, fee_label, link_spaces FROM sections WHERE name = ?').get('展厅硬件') as any;
      expect(row.subtotal_label).toBeNull();
      expect(row.fee_label).toBeNull();
      expect(row.link_spaces).toBe(0);
      db.close();
    } finally {
      for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) { try { rmSync(f, { force: true }); } catch { /* ignore */ } }
    }
  });
});
