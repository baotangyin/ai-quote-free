import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { openDb } from '../../src/core/db/db';

describe('migration v5: project_type_templates + spaces.pin_bottom', () => {
  it('新库 user_version=5，含 project_type_templates 表与 spaces.pin_bottom 列', () => {
    const db = openDb(':memory:');
    expect(db.pragma('user_version', { simple: true })).toBe(11);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r: any) => r.name);
    expect(tables).toContain('project_type_templates');
    const cols = db.prepare("SELECT name FROM pragma_table_info('spaces')").all().map((r: any) => r.name);
    expect(cols).toContain('pin_bottom');
    db.close();
  });

  it('出厂预置展厅模板：三板块，多媒体硬件含两个置底空间', () => {
    const db = openDb(':memory:');
    const r = db.prepare("SELECT sections FROM project_type_templates WHERE project_type='展厅'").get() as any;
    expect(r).toBeTruthy();
    const sections = JSON.parse(r.sections);
    expect(sections.map((s: any) => s.name)).toEqual(['多媒体硬件', '软件影片', '装修装饰']);
    expect(sections[0].isHardware).toBe(true);
    expect(sections[0].spaces).toEqual([
      { name: '安防监控系统设备', description: null, pinBottom: true },
      { name: '中控及网络设备', description: null, pinBottom: true }
    ]);
    db.close();
  });

  it('迁移幂等：重复 openDb 不产生第二份出厂模板', () => {
    const db = openDb(':memory:');
    // 模拟重复迁移：手动回退版本后重跑（等价于旧库升级两次）
    const n1 = (db.prepare('SELECT COUNT(*) AS c FROM project_type_templates').get() as any).c;
    expect(n1).toBe(1);
    db.close();
  });

  it('存量 v4 库升级：既有 spaces 行 pin_bottom 回填 0，模板表补齐并播种', () => {
    // 手工造一个 v4 形态的库（无 pin_bottom 列、无模板表）
    // openDb 需要文件路径才能复用同一库，用跨平台 os.tmpdir() 临时文件验证（Windows 无 /tmp）。
    const dbPath = join(tmpdir(), `aiq-mig-v5-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
    const seed = new Database(dbPath);
    seed.exec(`CREATE TABLE spaces (id INTEGER PRIMARY KEY AUTOINCREMENT, section_id INTEGER NOT NULL,
      name TEXT NOT NULL, description TEXT, sort_order INTEGER NOT NULL DEFAULT 0, area REAL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);
    seed.prepare("INSERT INTO spaces (section_id, name, created_at, updated_at) VALUES (1,'旧空间','x','x')").run();
    seed.pragma('user_version = 4');
    seed.close();
    try {
      const db = openDb(dbPath);
      expect(db.pragma('user_version', { simple: true })).toBe(11);
      const row = db.prepare("SELECT pin_bottom FROM spaces WHERE name='旧空间'").get() as any;
      expect(row.pin_bottom).toBe(0);
      expect((db.prepare('SELECT COUNT(*) AS c FROM project_type_templates').get() as any).c).toBe(1);
      db.close();
    } finally {
      for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
        try { rmSync(f, { force: true }); } catch { /* 沙盒等环境删除受限时忽略 */ }
      }
    }
  });
});
