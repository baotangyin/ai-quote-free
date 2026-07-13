import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { openDb } from '../../src/core/db/db';
import { getProduct, listProducts, createProduct } from '../../src/core/repo/products';
import { createProject, listProjects, createSection, createSpace, createLineItem, listLineItems } from '../../src/core/repo/projects';
import type { LineItemSnapshot } from '../../src/core/domain/types';

/** 手工建一份 v0.2.x（迁移前）products 表结构：无 categories 列，user_version=0（SQLite 默认）。 */
function buildLegacyDb(path: string): void {
  const raw = new Database(path);
  raw.exec(`
    CREATE TABLE suppliers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL, contact TEXT, note TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL, name TEXT NOT NULL,
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
    );
  `);
  const t = '2025-06-01T00:00:00.000Z';
  raw.prepare(
    `INSERT INTO products (category,name,brand,model,unit,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`
  ).run('LED屏', 'P1.8全彩屏', '洲明', 'P1.8', '㎡', t, t);
  raw.prepare(
    `INSERT INTO products (category,name,brand,model,unit,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`
  ).run('音响', '壁挂全频音响', null, null, '只', t, t);
  // 确认迁移前 user_version 为 SQLite 默认值 0
  expect(raw.pragma('user_version', { simple: true })).toBe(0);
  raw.close();
}

describe('db 迁移：v0 -> v1 新增 products.categories 列', () => {
  it('存量 v0.2.x 库（无 categories 列）经 openDb 迁移后：新增列、旧数据回填、user_version=2，且不丢数据', () => {
    const dir = mkdtempSync(join(tmpdir(), 'aiq-migration-'));
    const dbPath = join(dir, 'legacy.db');
    buildLegacyDb(dbPath);

    const db = openDb(dbPath);
    try {
      // user_version 已推进到当前最新版本（v6）
      expect(db.pragma('user_version', { simple: true })).toBe(12);

      // categories 列已存在
      const cols = (db.prepare("SELECT name FROM pragma_table_info('products')").all() as { name: string }[]).map((c) => c.name);
      expect(cols).toContain('categories');

      // 存量数据未丢失，且 category 回填为 categories 的单元素数组
      const list = listProducts(db);
      expect(list).toHaveLength(2);
      const led = list.find((p) => p.name === 'P1.8全彩屏')!;
      expect(led.category).toBe('LED屏');
      expect(led.categories).toEqual(['LED屏']);
      expect(led.brand).toBe('洲明');
      const audio = list.find((p) => p.name === '壁挂全频音响')!;
      expect(audio.categories).toEqual(['音响']);

      // 再次 openDb（幂等）：不报错，数据不变
      const cur = getProduct(db, led.id)!;
      expect(cur.categories).toEqual(['LED屏']);
    } finally {
      db.close();
    }
  });

  it('对已迁移库重复调用 openDb 是幂等的（不重复回填、不报错）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'aiq-migration-idempotent-'));
    const dbPath = join(dir, 'twice.db');

    const db1 = openDb(dbPath);
    createProduct(db1, { categories: ['LED屏', '55寸'], name: '产品A', unit: '台' });
    db1.close();

    const db2 = openDb(dbPath);
    try {
      expect(db2.pragma('user_version', { simple: true })).toBe(12);
      const list = listProducts(db2);
      expect(list).toHaveLength(1);
      expect(list[0].categories).toEqual(['LED屏', '55寸']);
      // category 兼容字段同步为 categories[0]
      expect(list[0].category).toBe('LED屏');
    } finally {
      db2.close();
    }
  });

  it('新装库（:memory:）直接建表含 categories 列，user_version=5', () => {
    const db = openDb(':memory:');
    try {
      expect(db.pragma('user_version', { simple: true })).toBe(12);
      const cols = (db.prepare("SELECT name FROM pragma_table_info('products')").all() as { name: string }[]).map((c) => c.name);
      expect(cols).toContain('categories');
      expect(cols).toContain('category');
    } finally {
      db.close();
    }
  });
});

describe('db 迁移：v1 -> v2 新增概算三表', () => {
  function tableNames(db: ReturnType<typeof openDb>): string[] {
    return (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map((t) => t.name);
  }

  it('新库 openDb 后存在概算三表且 user_version=5', () => {
    const db = openDb(':memory:');
    try {
      expect(db.pragma('user_version', { simple: true })).toBe(12);
      const names = tableNames(db);
      expect(names).toContain('estimate_categories');
      expect(names).toContain('estimate_rows');
      expect(names).toContain('estimate_norms');
    } finally {
      db.close();
    }
  });

  it('对同一文件重复 openDb 幂等：不报错、user_version=5、表仍在', () => {
    const dir = mkdtempSync(join(tmpdir(), 'aiq-migration-v2-'));
    const dbPath = join(dir, 'estimate.db');

    const db1 = openDb(dbPath);
    db1.close();

    const db2 = openDb(dbPath);
    try {
      expect(db2.pragma('user_version', { simple: true })).toBe(12);
      const names = tableNames(db2);
      expect(names).toContain('estimate_categories');
      expect(names).toContain('estimate_rows');
      expect(names).toContain('estimate_norms');
    } finally {
      db2.close();
    }
  });

  it('外键约束：向 estimate_rows 插入不存在的 category_id 应抛错', () => {
    const db = openDb(':memory:');
    try {
      const now = '2026-01-01T00:00:00.000Z';
      const insert = db.prepare(
        `INSERT INTO estimate_rows (category_id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`
      );
      expect(() => insert.run(9999, '行A', now, now)).toThrow();
    } finally {
      db.close();
    }
  });

  it('存量 v1 库（user_version=1、已有业务数据）升到 v2：数据不变、补齐三表', () => {
    const dir = mkdtempSync(join(tmpdir(), 'aiq-migration-v1v2-'));
    const dbPath = join(dir, 'v1.db');

    // 构造一份「已迁移到 v1」的库：完整 schema + categories 已回填 + user_version=1，
    // 但尚无概算三表（模拟 v0.3.x/v0.4.x 存量库）。用 openDb 建库后手动降版本并删除三表。
    {
      const seed = openDb(dbPath);
      createProduct(seed, { category: 'LED屏', name: 'P2屏', unit: '㎡' });
      seed.exec('DROP TABLE IF EXISTS estimate_rows; DROP TABLE IF EXISTS estimate_categories; DROP TABLE IF EXISTS estimate_norms;');
      seed.pragma('user_version = 1');
      seed.close();
    }

    // 确认降级成功：v1、无三表、有业务数据
    const check = new Database(dbPath);
    expect(check.pragma('user_version', { simple: true })).toBe(1);
    const before = (check.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map((t) => t.name);
    expect(before).not.toContain('estimate_categories');
    check.close();

    // 重新 openDb 触发 v1 -> v2 -> v3 -> v4 -> v5（一次性补齐到最新）
    const db = openDb(dbPath);
    try {
      expect(db.pragma('user_version', { simple: true })).toBe(12);
      const names = tableNames(db);
      expect(names).toContain('estimate_categories');
      expect(names).toContain('estimate_rows');
      expect(names).toContain('estimate_norms');
      // 存量业务数据未受影响
      const products = listProducts(db);
      expect(products).toHaveLength(1);
      expect(products[0].name).toBe('P2屏');
      expect(products[0].categories).toEqual(['LED屏']);
    } finally {
      db.close();
    }
  });
});

/** 构造一份最小清单行快照，供 v3->v4 存量保全测试建 line_item 使用。 */
const snap: LineItemSnapshot = {
  name: '测试设备',
  brand: null,
  model: null,
  recommendedBrands: [],
  paramsCore: null,
  paramsBid: null,
  paramsTender: null,
  unit: '台',
  dims: null,
  power220W: 0,
  power380W: 0,
  rackU: 0,
  seqPowerPorts: 0,
  netPorts: 0,
  comPorts: 0,
  costUnitCents: 100000,
  optionsApplied: [],
};

describe('db 迁移：v3 -> v4 候选成本方案表 line_item_costs', () => {
  function tableNames(db: ReturnType<typeof openDb>): string[] {
    return (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map((t) => t.name);
  }

  it('新库 openDb 后 user_version=5、存在 line_item_costs 表', () => {
    const db = openDb(':memory:');
    try {
      expect(db.pragma('user_version', { simple: true })).toBe(12);
      expect(tableNames(db)).toContain('line_item_costs');
    } finally {
      db.close();
    }
  });

  it('对同一文件重复 openDb 幂等：不报错、user_version=5、line_item_costs 仍在', () => {
    const dir = mkdtempSync(join(tmpdir(), 'aiq-migration-v4-'));
    const dbPath = join(dir, 'costs.db');

    const db1 = openDb(dbPath);
    db1.close();

    const db2 = openDb(dbPath);
    try {
      expect(db2.pragma('user_version', { simple: true })).toBe(12);
      expect(tableNames(db2)).toContain('line_item_costs');
    } finally {
      db2.close();
    }
  });

  it('存量 v3 库（无 line_item_costs、user_version=3、已有清单数据）升到 v4：补齐表、提升版本、数据不变', () => {
    const dir = mkdtempSync(join(tmpdir(), 'aiq-migration-v3v4-'));
    const dbPath = join(dir, 'v3.db');

    // 构造一份「已迁移到 v3」的库：openDb 建库后插入 project+section+space+line_item，
    // 手动删除 line_item_costs 并降版本到 3。
    {
      const seed = openDb(dbPath);
      const pj = createProject(seed, { name: '存量项目' });
      const sec = createSection(seed, { projectId: pj.id, name: '硬件' });
      const sp = createSpace(seed, { sectionId: sec.id, name: '序厅' });
      createLineItem(seed, { spaceId: sp.id, snapshot: snap, qty: 2 });
      seed.exec('DROP TABLE IF EXISTS line_item_costs;');
      seed.pragma('user_version = 3');
      seed.close();
    }

    // 确认降级成功：v3、无 line_item_costs、有清单数据
    const check = new Database(dbPath);
    expect(check.pragma('user_version', { simple: true })).toBe(3);
    const before = (check.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map((t) => t.name);
    expect(before).not.toContain('line_item_costs');
    check.close();

    // 重新 openDb 触发 v3 -> v4 -> v5
    const db = openDb(dbPath);
    try {
      expect(db.pragma('user_version', { simple: true })).toBe(12);
      expect(tableNames(db)).toContain('line_item_costs');
      // 存量清单数据未受影响
      const sp = db.prepare("SELECT id FROM spaces LIMIT 1").get() as { id: number };
      const items = listLineItems(db, sp.id);
      expect(items).toHaveLength(1);
      expect(items[0].snapshot.name).toBe('测试设备');
      expect(items[0].qty).toBe(2);
    } finally {
      db.close();
    }
  });

  it('外键约束：向 line_item_costs 插入不存在的 line_item_id 应抛错', () => {
    const db = openDb(':memory:');
    try {
      const now = '2026-01-01T00:00:00.000Z';
      const insert = db.prepare(
        `INSERT INTO line_item_costs (line_item_id, cost_unit_cents, created_at, updated_at) VALUES (?, ?, ?, ?)`
      );
      expect(() => insert.run(9999, 100000, now, now)).toThrow();
    } finally {
      db.close();
    }
  });
});

describe('db 迁移：v2 -> v3 规则引擎 bom_rules + projects.project_type', () => {
  function tableNames(db: ReturnType<typeof openDb>): string[] {
    return (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map((t) => t.name);
  }
  function projectCols(db: ReturnType<typeof openDb>): string[] {
    return (db.prepare("SELECT name FROM pragma_table_info('projects')").all() as { name: string }[]).map((c) => c.name);
  }

  it('新库 openDb 后 user_version=5、存在 bom_rules 表、projects 有 project_type 列', () => {
    const db = openDb(':memory:');
    try {
      expect(db.pragma('user_version', { simple: true })).toBe(12);
      expect(tableNames(db)).toContain('bom_rules');
      expect(projectCols(db)).toContain('project_type');
    } finally {
      db.close();
    }
  });

  it('对同一文件重复 openDb 幂等：不报错、user_version=5、bom_rules 与 project_type 仍在', () => {
    const dir = mkdtempSync(join(tmpdir(), 'aiq-migration-v3-'));
    const dbPath = join(dir, 'rules.db');

    const db1 = openDb(dbPath);
    db1.close();

    const db2 = openDb(dbPath);
    try {
      expect(db2.pragma('user_version', { simple: true })).toBe(12);
      expect(tableNames(db2)).toContain('bom_rules');
      expect(projectCols(db2)).toContain('project_type');
    } finally {
      db2.close();
    }
  });

  it('存量 v2 库（无 bom_rules、user_version=2、已有项目数据）升到 v3：补齐 bom_rules、提升版本、数据不变', () => {
    const dir = mkdtempSync(join(tmpdir(), 'aiq-migration-v2v3-'));
    const dbPath = join(dir, 'v2.db');

    // 构造一份「已迁移到 v2」的库：openDb 建库后插入项目，手动删除 bom_rules 并降版本到 2。
    // project_type 列 SQLite 无法轻易移除，保留即可（不影响 v3 幂等 ALTER 探测）。
    {
      const seed = openDb(dbPath);
      createProject(seed, { name: '存量项目' });
      seed.exec('DROP TABLE IF EXISTS bom_rules;');
      seed.pragma('user_version = 2');
      seed.close();
    }

    // 确认降级成功：v2、无 bom_rules、有项目数据
    const check = new Database(dbPath);
    expect(check.pragma('user_version', { simple: true })).toBe(2);
    const before = (check.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map((t) => t.name);
    expect(before).not.toContain('bom_rules');
    check.close();

    // 重新 openDb 触发 v2 -> v3 -> v4 -> v5（一次性补齐到最新）
    const db = openDb(dbPath);
    try {
      expect(db.pragma('user_version', { simple: true })).toBe(12);
      expect(tableNames(db)).toContain('bom_rules');
      // 存量项目数据未受影响
      const projects = listProjects(db);
      expect(projects).toHaveLength(1);
      expect(projects[0].name).toBe('存量项目');
    } finally {
      db.close();
    }
  });
});
