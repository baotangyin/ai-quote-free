import Database from 'better-sqlite3';
import { SCHEMA_SQL } from './schema';
import { FACTORY_EXHIBITION_SECTIONS } from './seedTemplates';
import { FACTORY_CONFIG, FACTORY_TEMPLATE_NAME } from '../export/factoryTemplate';

export type Db = Database.Database;

/** 当前 schema 版本，存于 SQLite `PRAGMA user_version`。新增迁移时递增并在 migrate() 中追加对应分支。 */
export const CURRENT_SCHEMA_VERSION = 13;

export function openDb(path: string): Db {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA_SQL);
  migrate(db);
  return db;
}

/** 基于 user_version 的增量迁移。幂等：可安全对新库/已迁移库重复调用。 */
function migrate(db: Db): void {
  const version = db.pragma('user_version', { simple: true }) as number;
  if (version < 1) {
    migrateToV1(db);
  }
  if (version < 2) {
    migrateToV2(db);
  }
  if (version < 3) {
    migrateToV3(db);
  }
  if (version < 4) {
    migrateToV4(db);
  }
  if (version < 5) {
    migrateToV5(db);
  }
  if (version < 6) {
    migrateToV6(db);
  }
  if (version < 7) {
    migrateToV7(db);
  }
  if (version < 8) {
    migrateToV8(db);
  }
  if (version < 9) {
    migrateToV9(db);
  }
  if (version < 10) {
    migrateToV10(db);
  }
  if (version < 11) {
    migrateToV11(db);
  }
  if (version < 12) {
    migrateToV12(db);
  }
  if (version < 13) {
    migrateToV13(db);
  }
}

/**
 * v0 -> v1：products 表新增 categories（JSON 字符串数组）列，支持一件设备归属多个分类。
 * - 若列已存在（新装库，CREATE TABLE 已含该列）则跳过 ALTER。
 * - 存量数据（v0.2.x 库）：categories 仍为默认值 '[]' 的行，逐条读出旧 category 值回填为 [category]，
 *   不使用 SQLite json_array()（版本兼容性未知），改用逐行 UPDATE 更稳妥。
 * - 保留旧 category 列不变，供向后兼容读取。
 */
function migrateToV1(db: Db): void {
  const run = db.transaction(() => {
    const hasCategories = (db.prepare(
      "SELECT COUNT(*) AS c FROM pragma_table_info('products') WHERE name='categories'"
    ).get() as { c: number }).c > 0;
    if (!hasCategories) {
      db.exec("ALTER TABLE products ADD COLUMN categories TEXT NOT NULL DEFAULT '[]'");
    }
    const rows = db.prepare(
      "SELECT id, category FROM products WHERE categories = '[]' OR categories IS NULL"
    ).all() as { id: number; category: string }[];
    const update = db.prepare('UPDATE products SET categories = ? WHERE id = ?');
    for (const r of rows) {
      update.run(JSON.stringify(r.category ? [r.category] : []), r.id);
    }
    db.pragma('user_version = 1');
  });
  run();
}

/**
 * v1 -> v2：概算模式新增三张表 estimate_categories / estimate_rows / estimate_norms
 * （项目概算分类、概算行、概算单价指标库）。
 * - 建表 SQL 已随 SCHEMA_SQL 以 IF NOT EXISTS 方式执行，故新装库无需额外 DDL。
 * - 存量 v1 库同样已在 openDb 的 db.exec(SCHEMA_SQL) 阶段补齐三表，此处仅将
 *   user_version 提升到 2，用事务保证原子性。
 */
function migrateToV2(db: Db): void {
  const run = db.transaction(() => {
    db.pragma('user_version = 2');
  });
  run();
}

/**
 * v2 -> v3 规则引擎：
 * - projects 表新增 project_type（项目类型，可空），用于按项目类型触发规则。
 *   新装库的 CREATE TABLE 已含该列，故先探测 pragma_table_info，缺列才 ALTER，
 *   存量 v2 库借此补齐；ALTER 不影响既有行数据（新列填 NULL）。
 * - bom_rules 表（BOM 规则）已随 SCHEMA_SQL 以 IF NOT EXISTS 建好，此处无需额外 DDL。
 * - 用事务保证 ALTER + 版本号提升的原子性。
 */
function migrateToV3(db: Db): void {
  const run = db.transaction(() => {
    const hasProjectType = (db.prepare(
      "SELECT COUNT(*) AS c FROM pragma_table_info('projects') WHERE name='project_type'"
    ).get() as { c: number }).c > 0;
    if (!hasProjectType) {
      db.exec('ALTER TABLE projects ADD COLUMN project_type TEXT');
    }
    db.pragma('user_version = 3');
  });
  run();
}

/**
 * v3 -> v4 多供应商比价：新增 line_item_costs（清单行候选成本方案表）。
 * - 建表 SQL 已随 SCHEMA_SQL 以 IF NOT EXISTS 方式执行，新装库与存量 v3 库均已在
 *   openDb 的 db.exec(SCHEMA_SQL) 阶段补齐该表，故此处仅将 user_version 提升到 4，
 *   用事务保证原子性。
 */
function migrateToV4(db: Db): void {
  const run = db.transaction(() => {
    db.pragma('user_version = 4');
  });
  run();
}

/**
 * v4 -> v5 项目类型模板：
 * - spaces 表新增 pin_bottom（置底空间，恒排板块末尾）。新装库 CREATE TABLE 已含该列，
 *   探测 pragma_table_info 缺列才 ALTER；存量行填默认 0。
 * - project_type_templates 表已随 SCHEMA_SQL 以 IF NOT EXISTS 建好。
 * - 仅当模板表为空时播种出厂「展厅」模板（保证幂等，且不覆盖用户自建模板）。
 */
function migrateToV5(db: Db): void {
  const run = db.transaction(() => {
    const hasPinBottom = (db.prepare(
      "SELECT COUNT(*) AS c FROM pragma_table_info('spaces') WHERE name='pin_bottom'"
    ).get() as { c: number }).c > 0;
    if (!hasPinBottom) {
      db.exec('ALTER TABLE spaces ADD COLUMN pin_bottom INTEGER NOT NULL DEFAULT 0');
    }
    const count = (db.prepare('SELECT COUNT(*) AS c FROM project_type_templates').get() as { c: number }).c;
    if (count === 0) {
      const t = nowIso();
      db.prepare('INSERT INTO project_type_templates (project_type, sections, created_at, updated_at) VALUES (?,?,?,?)')
        .run('展厅', JSON.stringify(FACTORY_EXHIBITION_SECTIONS), t, t);
    }
    db.pragma('user_version = 5');
  });
  run();
}

/**
 * v5 -> v6 导出模板：export_templates 表已随 SCHEMA_SQL 建好；
 * 仅当表为空时播种出厂「标准三版本」模板（幂等，不覆盖用户模板）。
 */
function migrateToV6(db: Db): void {
  const run = db.transaction(() => {
    const count = (db.prepare('SELECT COUNT(*) AS c FROM export_templates').get() as { c: number }).c;
    if (count === 0) {
      const t = nowIso();
      db.prepare('INSERT INTO export_templates (name, config, created_at, updated_at) VALUES (?,?,?,?)')
        .run(FACTORY_TEMPLATE_NAME, JSON.stringify(FACTORY_CONFIG), t, t);
    }
    db.pragma('user_version = 6');
  });
  run();
}

/**
 * v6 -> v7 产品价格监控字段：
 * - products 表新增 watch_price（监控开关，0=不监控 1=监控）。新装库 CREATE TABLE 已含该列，
 *   探测 pragma_table_info 缺列才 ALTER；存量行填默认 0（不监控）。
 * - 用事务保证 ALTER + 版本号提升的原子性。
 */
function migrateToV7(db: Db): void {
  const run = db.transaction(() => {
    const hasWatchPrice = (db.prepare(
      "SELECT COUNT(*) AS c FROM pragma_table_info('products') WHERE name='watch_price'"
    ).get() as { c: number }).c > 0;
    if (!hasWatchPrice) {
      db.exec('ALTER TABLE products ADD COLUMN watch_price INTEGER NOT NULL DEFAULT 0');
    }
    db.pragma('user_version = 7');
  });
  run();
}

/**
 * v7 -> v8 板块行名与联动开关字段：
 * - sections 表新增三列：
 *   - subtotal_label TEXT（可空，板块小计行文案）
 *   - fee_label TEXT（可空，系统集成费行文案）
 *   - link_spaces INTEGER NOT NULL DEFAULT 0（联动开关）
 * - 新装库 CREATE TABLE 已含这三列，探测 pragma_table_info 缺列才 ALTER；
 *   存量行填默认值（NULL / NULL / 0）。
 * - 用事务保证 ALTER + 版本号提升的原子性。
 */
function migrateToV8(db: Db): void {
  const run = db.transaction(() => {
    const hasSubtotalLabel = (db.prepare(
      "SELECT COUNT(*) AS c FROM pragma_table_info('sections') WHERE name='subtotal_label'"
    ).get() as { c: number }).c > 0;
    if (!hasSubtotalLabel) {
      db.exec('ALTER TABLE sections ADD COLUMN subtotal_label TEXT');
    }
    const hasFeeLabel = (db.prepare(
      "SELECT COUNT(*) AS c FROM pragma_table_info('sections') WHERE name='fee_label'"
    ).get() as { c: number }).c > 0;
    if (!hasFeeLabel) {
      db.exec('ALTER TABLE sections ADD COLUMN fee_label TEXT');
    }
    const hasLinkSpaces = (db.prepare(
      "SELECT COUNT(*) AS c FROM pragma_table_info('sections') WHERE name='link_spaces'"
    ).get() as { c: number }).c > 0;
    if (!hasLinkSpaces) {
      db.exec('ALTER TABLE sections ADD COLUMN link_spaces INTEGER NOT NULL DEFAULT 0');
    }
    db.pragma('user_version = 8');
  });
  run();
}

/**
 * v8 -> v9 供应商字段细化：
 * - suppliers 表新增四列（均 TEXT 可空）：phone（电话）/ address（地址）/
 *   payment_terms（付款方式）/ bank_info（开户信息）。
 * - 新装库 CREATE TABLE 已含这四列，探测 pragma_table_info 缺列才逐一 ALTER；
 *   存量行填默认值 NULL，不影响既有数据。
 * - 用事务保证 ALTER + 版本号提升的原子性。
 */
function migrateToV9(db: Db): void {
  const run = db.transaction(() => {
    const hasPhone = (db.prepare(
      "SELECT COUNT(*) AS c FROM pragma_table_info('suppliers') WHERE name='phone'"
    ).get() as { c: number }).c > 0;
    if (!hasPhone) {
      db.exec('ALTER TABLE suppliers ADD COLUMN phone TEXT');
    }
    const hasAddress = (db.prepare(
      "SELECT COUNT(*) AS c FROM pragma_table_info('suppliers') WHERE name='address'"
    ).get() as { c: number }).c > 0;
    if (!hasAddress) {
      db.exec('ALTER TABLE suppliers ADD COLUMN address TEXT');
    }
    const hasPaymentTerms = (db.prepare(
      "SELECT COUNT(*) AS c FROM pragma_table_info('suppliers') WHERE name='payment_terms'"
    ).get() as { c: number }).c > 0;
    if (!hasPaymentTerms) {
      db.exec('ALTER TABLE suppliers ADD COLUMN payment_terms TEXT');
    }
    const hasBankInfo = (db.prepare(
      "SELECT COUNT(*) AS c FROM pragma_table_info('suppliers') WHERE name='bank_info'"
    ).get() as { c: number }).c > 0;
    if (!hasBankInfo) {
      db.exec('ALTER TABLE suppliers ADD COLUMN bank_info TEXT');
    }
    db.pragma('user_version = 9');
  });
  run();
}

/**
 * v9 -> v10 类别参数模板：
 * - category_param_templates 表已随 SCHEMA_SQL 以 IF NOT EXISTS 方式建好，新装库与存量 v9 库均已在
 *   openDb 的 db.exec(SCHEMA_SQL) 阶段补齐该表，故此处仅将 user_version 提升到 10，用事务保证原子性。
 */
function migrateToV10(db: Db): void {
  const run = db.transaction(() => {
    db.pragma('user_version = 10');
  });
  run();
}

/**
 * v10 -> v11 供应商询价单：inquiries / inquiry_items 两表已随 SCHEMA_SQL 以 IF NOT EXISTS 方式建好，
 * 新装库与存量 v10 库均已在 openDb 的 db.exec(SCHEMA_SQL) 阶段补齐两表，故此处仅将 user_version
 * 提升到 11，用事务保证原子性。
 */
function migrateToV11(db: Db): void {
  const run = db.transaction(() => {
    db.pragma('user_version = 11');
  });
  run();
}

/**
 * v11 -> v12 项目类型模板板块补 linkSpaces 字段：
 * - TemplateSection 新增 linkSpaces（空间联动开关），历史存量模板的 sections JSON 里没有这个字段，
 *   applyTemplate 建板块时会默认关闭联动，导致出厂展厅模板「软件影片」「装修装饰」板块不再随
 *   「多媒体硬件」联动改名（回归）。此处逐条读出 project_type_templates.sections，补齐缺省字段：
 *   - 缺省一律补 linkSpaces:false；
 *   - 仅当 project_type='展厅' 且板块名精确为「软件影片」或「装修装饰」时补 true
 *     （出厂模板的既定联动语义），用户自建模板不臆测语义，只补 false。
 * - JSON 解析失败的行原样跳过（存储层读路径本就容错为空模板，这里不重复报错）。
 * - 用事务保证批量 UPDATE + 版本号提升的原子性。
 */
function migrateToV12(db: Db): void {
  const run = db.transaction(() => {
    const rows = db.prepare('SELECT id, project_type, sections FROM project_type_templates').all() as
      { id: number; project_type: string; sections: string }[];
    const update = db.prepare('UPDATE project_type_templates SET sections=? WHERE id=?');
    for (const row of rows) {
      let parsed: any;
      try {
        parsed = JSON.parse(row.sections);
      } catch {
        continue;
      }
      if (!Array.isArray(parsed)) continue;
      const patched = parsed.map((s: any) => {
        if (s && typeof s === 'object' && !('linkSpaces' in s)) {
          const linkSpaces = row.project_type === '展厅' && (s.name === '软件影片' || s.name === '装修装饰');
          return { ...s, linkSpaces };
        }
        return s;
      });
      update.run(JSON.stringify(patched), row.id);
    }
    db.pragma('user_version = 12');
  });
  run();
}

/**
 * v12 -> v13 AI 用量本地队列：ai_usage_queue 表已随 SCHEMA_SQL 以 IF NOT EXISTS 方式建好
 * （openDb 的 db.exec(SCHEMA_SQL) 阶段对新装库与存量 v12 库均已补齐），此处仅提升 user_version。
 * 免费版同样建表（结构无用户数据、无隐私），但只有付费版的用量上报模块会写入。
 */
function migrateToV13(db: Db): void {
  const run = db.transaction(() => {
    db.pragma('user_version = 13');
  });
  run();
}

export function nowIso(): string { return new Date().toISOString(); }
