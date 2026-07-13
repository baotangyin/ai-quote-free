import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import * as core from '../../src/core/index';
import { CURRENT_SCHEMA_VERSION } from '../../src/core/index';
import { backupDatabase, validateBackupFile, stageRestore, applyPendingRestore } from '../../src/main/backup';

function buildDb(path: string) {
  return core.openDb(path);
}

describe('backupDatabase', () => {
  it('产物可打开且数据与源库一致，文件名符合约定', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'aiquote-backup-'));
    try {
      const dbPath = join(dir, 'ai-quote.db');
      const db = buildDb(dbPath);
      core.createProduct(db, { name: '测试产品', unit: '台', categories: ['测试'] });

      const destDir = mkdtempSync(join(tmpdir(), 'aiquote-backup-dest-'));
      const backupPath = await backupDatabase(db, destDir);

      expect(backupPath.startsWith(destDir)).toBe(true);
      expect(backupPath).toMatch(/ai-quote-backup-\d{8}-\d{6}\.db$/);
      expect(existsSync(backupPath)).toBe(true);

      const backedUp = new Database(backupPath, { readonly: true });
      const products = backedUp.prepare('SELECT name FROM products').all() as { name: string }[];
      expect(products).toHaveLength(1);
      expect(products[0].name).toBe('测试产品');
      backedUp.close();
      db.close();
      rmSync(destDir, { recursive: true, force: true });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('validateBackupFile', () => {
  it('合法备份文件通过校验', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'aiquote-validate-'));
    try {
      const dbPath = join(dir, 'ai-quote.db');
      const db = buildDb(dbPath);
      const backupPath = await backupDatabase(db, dir);
      db.close();

      expect(validateBackupFile(backupPath)).toEqual({ ok: true });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('user_version 高于当前 schema 版本时拒绝，提示先升级软件', () => {
    const dir = mkdtempSync(join(tmpdir(), 'aiquote-validate-'));
    try {
      const dbPath = join(dir, 'future.db');
      const raw = new Database(dbPath);
      raw.exec('CREATE TABLE products (id INTEGER PRIMARY KEY); CREATE TABLE projects (id INTEGER PRIMARY KEY);');
      raw.pragma(`user_version = ${CURRENT_SCHEMA_VERSION + 1}`);
      raw.close();

      const result = validateBackupFile(dbPath);
      expect(result.ok).toBe(false);
      expect(result.reason).toBe('备份来自更新版本的软件，请先升级软件');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('非数据库文件返回「不是有效的数据库备份文件」', () => {
    const dir = mkdtempSync(join(tmpdir(), 'aiquote-validate-'));
    try {
      const bogusPath = join(dir, 'bogus.db');
      writeFileSync(bogusPath, '这不是一个 sqlite 文件');

      const result = validateBackupFile(bogusPath);
      expect(result.ok).toBe(false);
      expect(result.reason).toBe('不是有效的数据库备份文件');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('缺少 products/projects 表的合法 sqlite 文件返回「不是有效的数据库备份文件」', () => {
    const dir = mkdtempSync(join(tmpdir(), 'aiquote-validate-'));
    try {
      const dbPath = join(dir, 'other.db');
      const raw = new Database(dbPath);
      raw.exec('CREATE TABLE foo (id INTEGER PRIMARY KEY)');
      raw.pragma('user_version = 1');
      raw.close();

      const result = validateBackupFile(dbPath);
      expect(result.ok).toBe(false);
      expect(result.reason).toBe('不是有效的数据库备份文件');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('文件不存在返回失败', () => {
    const result = validateBackupFile(join(tmpdir(), 'definitely-not-exist-aiquote.db'));
    expect(result.ok).toBe(false);
  });

  it('user_version 为 0（未迁移/非本软件库）返回「不是有效的数据库备份文件」', () => {
    const dir = mkdtempSync(join(tmpdir(), 'aiquote-validate-'));
    try {
      const dbPath = join(dir, 'zero.db');
      const raw = new Database(dbPath);
      raw.exec('CREATE TABLE products (id INTEGER PRIMARY KEY); CREATE TABLE projects (id INTEGER PRIMARY KEY);');
      raw.close();

      const result = validateBackupFile(dbPath);
      expect(result.ok).toBe(false);
      expect(result.reason).toBe('不是有效的数据库备份文件');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('stageRestore + applyPendingRestore', () => {
  it('stage 后 apply：当前库留底（含 -wal/-shm），暂存文件替换为正式库', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'aiquote-restore-'));
    try {
      const dbPath = join(dir, 'ai-quote.db');
      const db = buildDb(dbPath);
      core.createProduct(db, { name: '旧数据产品', unit: '台', categories: [] });
      db.close();

      // 造一份「新」备份（另一个库，含不同数据）用于还原
      const backupDir = mkdtempSync(join(tmpdir(), 'aiquote-restore-src-'));
      const srcDbPath = join(backupDir, 'src.db');
      const srcDb = buildDb(srcDbPath);
      core.createProduct(srcDb, { name: '新数据产品', unit: '台', categories: [] });
      const backupPath = await backupDatabase(srcDb, backupDir);
      srcDb.close();

      expect(validateBackupFile(backupPath)).toEqual({ ok: true });

      stageRestore(backupPath, dbPath);
      expect(existsSync(join(dir, 'ai-quote.db.restore'))).toBe(true);

      const applied = applyPendingRestore(dbPath);
      expect(applied).toBe(true);
      expect(existsSync(join(dir, 'ai-quote.db.restore'))).toBe(false);

      // 正式库已被替换为新数据
      const reopened = core.openDb(dbPath);
      const products = core.listProducts(reopened);
      expect(products).toHaveLength(1);
      expect(products[0].name).toBe('新数据产品');
      reopened.close();

      // 旧数据留底：能找到一个 .bak-* 文件，且能打开读出旧数据
      const { readdirSync } = await import('node:fs');
      const bakFiles = readdirSync(dir).filter((f) => f.startsWith('ai-quote.db.bak-'));
      expect(bakFiles.length).toBeGreaterThan(0);
      const bakDb = new Database(join(dir, bakFiles[0]), { readonly: true });
      const oldProducts = bakDb.prepare('SELECT name FROM products').all() as { name: string }[];
      expect(oldProducts).toHaveLength(1);
      expect(oldProducts[0].name).toBe('旧数据产品');
      bakDb.close();

      rmSync(backupDir, { recursive: true, force: true });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('当前库存在 -wal/-shm 边车文件时，还原后旧库连同边车一并留底，还原后库旁无残留', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'aiquote-restore-wal-'));
    try {
      const dbPath = join(dir, 'ai-quote.db');
      const db = buildDb(dbPath);
      core.createProduct(db, { name: '旧数据产品', unit: '台', categories: [] });
      // 不 close，模拟运行中留下 -wal/-shm；若底层非 WAL 模式或未产生边车文件，
      // 手工伪造以保证测试稳定覆盖「边车存在」这一分支。
      db.close();
      const walPath = `${dbPath}-wal`;
      const shmPath = `${dbPath}-shm`;
      if (!existsSync(walPath)) writeFileSync(walPath, 'fake-wal');
      if (!existsSync(shmPath)) writeFileSync(shmPath, 'fake-shm');

      const backupDir = mkdtempSync(join(tmpdir(), 'aiquote-restore-wal-src-'));
      const srcDbPath = join(backupDir, 'src.db');
      const srcDb = buildDb(srcDbPath);
      core.createProduct(srcDb, { name: '新数据产品', unit: '台', categories: [] });
      const backupPath = await backupDatabase(srcDb, backupDir);
      srcDb.close();

      expect(validateBackupFile(backupPath)).toEqual({ ok: true });

      stageRestore(backupPath, dbPath);
      expect(existsSync(`${dbPath}.restore`)).toBe(true);

      const applied = applyPendingRestore(dbPath);
      expect(applied).toBe(true);

      // ① dbPath 现为还原内容
      const reopened = core.openDb(dbPath);
      const products = core.listProducts(reopened);
      expect(products).toHaveLength(1);
      expect(products[0].name).toBe('新数据产品');
      reopened.close();

      // ② 旧库与其 -wal/-shm 都被 rename 到 .bak-<ts> 系，原位置不存在
      expect(existsSync(walPath)).toBe(false);
      expect(existsSync(shmPath)).toBe(false);

      const { readdirSync } = await import('node:fs');
      const files = readdirSync(dir);
      const bakDbFiles = files.filter((f) => f.startsWith('ai-quote.db.bak-') && !f.endsWith('-wal') && !f.endsWith('-shm'));
      expect(bakDbFiles.length).toBeGreaterThan(0);
      const bakTs = bakDbFiles[0].slice('ai-quote.db.bak-'.length);
      expect(files).toContain(`ai-quote.db.bak-${bakTs}-wal`);
      expect(files).toContain(`ai-quote.db.bak-${bakTs}-shm`);

      const bakDb = new Database(join(dir, bakDbFiles[0]), { readonly: true });
      const oldProducts = bakDb.prepare('SELECT name FROM products').all() as { name: string }[];
      expect(oldProducts).toHaveLength(1);
      expect(oldProducts[0].name).toBe('旧数据产品');
      bakDb.close();

      // ③ 还原后库旁无 stale wal/shm
      expect(existsSync(`${dbPath}-wal`)).toBe(false);
      expect(existsSync(`${dbPath}-shm`)).toBe(false);

      rmSync(backupDir, { recursive: true, force: true });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('无暂存文件时 applyPendingRestore 返回 false，不做任何改动', () => {
    const dir = mkdtempSync(join(tmpdir(), 'aiquote-restore-'));
    try {
      const dbPath = join(dir, 'ai-quote.db');
      const db = buildDb(dbPath);
      db.close();
      expect(applyPendingRestore(dbPath)).toBe(false);
      expect(existsSync(dbPath)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('当前库不存在时（全新安装场景）applyPendingRestore 仍能生效，无留底文件', () => {
    const dir = mkdtempSync(join(tmpdir(), 'aiquote-restore-'));
    try {
      const dbPath = join(dir, 'ai-quote.db');

      const backupDir = mkdtempSync(join(tmpdir(), 'aiquote-restore-src-'));
      const srcDbPath = join(backupDir, 'src.db');
      const srcDb = buildDb(srcDbPath);
      core.createProduct(srcDb, { name: '新装还原产品', unit: '台', categories: [] });
      srcDb.close();
      writeFileSync(join(dir, 'ai-quote.db.restore'), readFileSync(srcDbPath));

      const applied = applyPendingRestore(dbPath);
      expect(applied).toBe(true);
      expect(existsSync(dbPath)).toBe(true);

      const reopened = core.openDb(dbPath);
      expect(core.listProducts(reopened)).toHaveLength(1);
      reopened.close();

      rmSync(backupDir, { recursive: true, force: true });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
