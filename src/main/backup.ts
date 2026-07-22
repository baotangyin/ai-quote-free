import Database from 'better-sqlite3';
import { existsSync, copyFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import type { Db } from '../core/db/db';
import { CURRENT_SCHEMA_VERSION } from '../core/db/db';

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** 生成 `YYYYMMDD-HHmmss` 格式的本地时间戳，用于备份/留底文件名。 */
function timestamp(): string {
  const d = new Date();
  const date = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  const time = `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  return `${date}-${time}`;
}

/**
 * 在线备份当前数据库到 destDir：底层用 better-sqlite3 的 `db.backup()`（SQLite 在线备份 API），
 * 不阻塞、不影响正在进行的读写，产出一份完整独立的 .db 文件。
 * 文件名 `ai-quote-backup-YYYYMMDD-HHmmss.db`，返回完整路径供调用方展示/reveal。
 */
export async function backupDatabase(db: Db, destDir: string): Promise<string> {
  const destPath = join(destDir, `ai-quote-backup-${timestamp()}.db`);
  await db.backup(destPath);
  return destPath;
}

function tableExists(db: Database.Database, name: string): boolean {
  const r = db.prepare(
    "SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name=?"
  ).get(name) as { c: number };
  return r.c > 0;
}

/**
 * 校验一个文件是否为合法的本软件数据库备份：
 * - 以只读模式打开（fileMustExist，不存在/不是文件直接失败）；
 * - `PRAGMA user_version` 须在 1..CURRENT_SCHEMA_VERSION 之间——高于当前版本视为「备份来自更新版本的
 *   软件」，明确拒绝并提示先升级软件，避免用低版本 schema 理解误读高版本数据；
 * - 须存在 products / projects 两张核心表。
 * 任何异常（非 sqlite 文件、损坏、缺表等）统一返回中文 reason，不抛错，供 IPC 直接透传给前端展示。
 */
export function validateBackupFile(filePath: string): { ok: boolean; reason?: string } {
  if (!existsSync(filePath)) {
    return { ok: false, reason: '文件不存在' };
  }
  let testDb: Database.Database;
  try {
    testDb = new Database(filePath, { readonly: true, fileMustExist: true });
  } catch {
    return { ok: false, reason: '不是有效的数据库备份文件' };
  }
  try {
    const version = testDb.pragma('user_version', { simple: true }) as number;
    if (version < 1) {
      return { ok: false, reason: '不是有效的数据库备份文件' };
    }
    if (version > CURRENT_SCHEMA_VERSION) {
      return { ok: false, reason: '备份来自更新版本的软件，请先升级软件' };
    }
    if (!tableExists(testDb, 'products') || !tableExists(testDb, 'projects')) {
      return { ok: false, reason: '不是有效的数据库备份文件' };
    }
    return { ok: true };
  } catch {
    return { ok: false, reason: '不是有效的数据库备份文件' };
  } finally {
    testDb.close();
  }
}

/**
 * 将一份已通过校验的备份文件暂存到 dbPath 同目录下（`<dbPath>.restore`），与 applyPendingRestore
 * 读取的路径严格对齐，等待下次启动时（applyPendingRestore）生效。
 * 不在运行时直接替换当前库文件，避免影响正在使用中的连接。
 */
export function stageRestore(filePath: string, dbPath: string): void {
  copyFileSync(filePath, `${dbPath}.restore`);
}

/**
 * 启动时（openDb 之前）调用：若存在暂存的待还原文件，则：
 * 1. 当前库文件存在时，rename 为 `<dbPath>.bak-<ts>` 留底（连同 -wal/-shm 边车文件一并 rename，
 *    避免残留的旧 wal 内容被新库误读，同时不丢失任何未 checkpoint 的历史数据）；
 * 2. 暂存的待还原文件 rename 为 dbPath，生效。
 * 返回是否执行了还原（供调用方决定是否记录日志/提示）。
 */
export function applyPendingRestore(dbPath: string): boolean {
  const restorePath = `${dbPath}.restore`;
  if (!existsSync(restorePath)) return false;

  if (existsSync(dbPath)) {
    const bakPath = `${dbPath}.bak-${timestamp()}`;
    renameSync(dbPath, bakPath);
    for (const ext of ['-wal', '-shm']) {
      const sidecar = `${dbPath}${ext}`;
      if (existsSync(sidecar)) {
        renameSync(sidecar, `${bakPath}${ext}`);
      }
    }
  }

  renameSync(restorePath, dbPath);
  return true;
}
