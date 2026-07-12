import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { openDb } from '../../src/core/db/db';

describe('migration v12: 项目类型模板板块补 linkSpaces 字段', () => {
  it('新库 user_version=12，出厂展厅模板「软件影片」「装修装饰」linkSpaces=true，「多媒体硬件」为 false', () => {
    const db = openDb(':memory:');
    expect(db.pragma('user_version', { simple: true })).toBe(12);
    const row = db.prepare("SELECT sections FROM project_type_templates WHERE project_type='展厅'").get() as any;
    const sections = JSON.parse(row.sections);
    expect(sections.map((s: any) => [s.name, s.linkSpaces])).toEqual([
      ['多媒体硬件', false],
      ['软件影片', true],
      ['装修装饰', true],
    ]);
    db.close();
  });

  it('存量库升级：出厂展厅模板缺 linkSpaces 字段的行补齐（软件影片/装修装饰=true，其余=false）；自建模板只补 false，不臆测语义', () => {
    const dbPath = join(tmpdir(), `aiq-mig-v12-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
    const seed = new Database(dbPath);
    seed.exec(`CREATE TABLE project_type_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_type TEXT NOT NULL UNIQUE,
      sections TEXT NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    )`);
    const now = '2026-01-01T00:00:00.000Z';
    const exhibitionSections = [
      { name: '多媒体硬件', integrationFeeRate: 0, isHardware: true, spaces: [] },
      { name: '软件影片', integrationFeeRate: 0, isHardware: false, spaces: [] },
      { name: '装修装饰', integrationFeeRate: 0, isHardware: false, spaces: [] },
    ];
    const customSections = [
      { name: '软件影片', integrationFeeRate: 0, isHardware: false, spaces: [] }, // 同名但非「展厅」类型，不应被补 true
    ];
    seed.prepare('INSERT INTO project_type_templates (project_type, sections, created_at, updated_at) VALUES (?,?,?,?)')
      .run('展厅', JSON.stringify(exhibitionSections), now, now);
    seed.prepare('INSERT INTO project_type_templates (project_type, sections, created_at, updated_at) VALUES (?,?,?,?)')
      .run('指挥中心', JSON.stringify(customSections), now, now);
    seed.prepare('INSERT INTO project_type_templates (project_type, sections, created_at, updated_at) VALUES (?,?,?,?)')
      .run('坏数据类型', '{oops', now, now);
    seed.pragma('user_version = 11');
    seed.close();

    try {
      const db = openDb(dbPath);
      expect(db.pragma('user_version', { simple: true })).toBe(12);

      const exhibition = db.prepare("SELECT sections FROM project_type_templates WHERE project_type='展厅'").get() as any;
      expect(JSON.parse(exhibition.sections).map((s: any) => [s.name, s.linkSpaces])).toEqual([
        ['多媒体硬件', false],
        ['软件影片', true],
        ['装修装饰', true],
      ]);

      const custom = db.prepare("SELECT sections FROM project_type_templates WHERE project_type='指挥中心'").get() as any;
      expect(JSON.parse(custom.sections).map((s: any) => [s.name, s.linkSpaces])).toEqual([
        ['软件影片', false],
      ]);

      const broken = db.prepare("SELECT sections FROM project_type_templates WHERE project_type='坏数据类型'").get() as any;
      expect(broken.sections).toBe('{oops'); // 损坏 JSON 行原样跳过

      db.close();
    } finally {
      for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) { try { rmSync(f, { force: true }); } catch { /* ignore */ } }
    }
  });

  it('迁移幂等：同一文件库重复 openDb 不重复处理/报错', () => {
    const dbPath = join(tmpdir(), `aiq-mig-v12-idem-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
    try {
      openDb(dbPath).close();
      const db = openDb(dbPath);
      expect(db.pragma('user_version', { simple: true })).toBe(12);
      db.close();
    } finally {
      for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) { try { rmSync(f, { force: true }); } catch { /* ignore */ } }
    }
  });
});
