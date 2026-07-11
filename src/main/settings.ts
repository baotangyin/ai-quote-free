import type { Db } from '../core/db/db';
import type { CostRule } from '../core/domain/types';

export function ensureSettingsTable(db: Db): void {
  db.exec(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
}

export function getSetting(db: Db, key: string): string | null {
  const r = db.prepare('SELECT value FROM settings WHERE key=?').get(key) as { value: string } | undefined;
  return r ? r.value : null;
}

export function setSetting(db: Db, key: string, value: string): void {
  db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(key, value);
}

/** 多厂家 AI 配置档案。id 为创建时生成的随机串，用于三个用途绑定键（aiProfileText/aiProfileVision/aiProfileWatch）引用。 */
export interface AiProfile {
  id: string;
  name: string;
  protocol: 'openai' | 'anthropic';
  baseUrl: string;
  apiKey: string;
  model: string;
}

export type AiProfileUsage = 'aiProfileText' | 'aiProfileVision' | 'aiProfileWatch';

/** 生成档案 id：时间戳+随机串，足够本机唯一，无需强加密随机性。 */
function randomProfileId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/** 读取 aiProfiles 设置并解析为数组；未设置或 JSON 非法/非数组时返回空数组。 */
export function getAiProfiles(db: Db): AiProfile[] {
  const raw = getSetting(db, 'aiProfiles');
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as AiProfile[]) : [];
  } catch {
    return [];
  }
}

export function setAiProfiles(db: Db, profiles: AiProfile[]): void {
  setSetting(db, 'aiProfiles', JSON.stringify(profiles));
}

/**
 * 懒迁移：aiProfiles 已有内容时直接返回（幂等，不重复迁移）。
 * 为空且旧的单一 AI 配置键（aiProtocol/aiBaseUrl/aiApiKey/aiModel）齐全时，
 * 自动组装「默认档案」写入 aiProfiles，并把文本识别/查价用途绑定指向它（图片处理用途默认也指向它，
 * 除非 visionModel 非空——此时生成同厂家、模型替换为 visionModel 的「图片处理档案」并绑定）；
 * 旧的 watchModel 非空时同理生成「查价档案」覆盖查价用途绑定。
 * 旧键全程保留不删除（保证回滚兼容）。旧键不齐全（如仍是全新安装）时不迁移，返回空数组。
 */
export function ensureAiProfiles(db: Db): AiProfile[] {
  const existing = getAiProfiles(db);
  if (existing.length > 0) return existing;

  const protocol = getSetting(db, 'aiProtocol');
  const baseUrl = getSetting(db, 'aiBaseUrl');
  const apiKey = getSetting(db, 'aiApiKey');
  const model = getSetting(db, 'aiModel');
  if (!protocol || !baseUrl || !apiKey || !model) return [];

  const defaultProfile: AiProfile = {
    id: randomProfileId(),
    name: '默认档案',
    protocol: protocol as AiProfile['protocol'],
    baseUrl,
    apiKey,
    model,
  };
  const profiles: AiProfile[] = [defaultProfile];
  setSetting(db, 'aiProfileText', defaultProfile.id);
  setSetting(db, 'aiProfileVision', defaultProfile.id);
  setSetting(db, 'aiProfileWatch', defaultProfile.id);

  const visionModel = getSetting(db, 'visionModel');
  if (visionModel) {
    const visionProfile: AiProfile = { ...defaultProfile, id: randomProfileId(), name: '图片处理档案', model: visionModel };
    profiles.push(visionProfile);
    setSetting(db, 'aiProfileVision', visionProfile.id);
  }

  const watchModel = getSetting(db, 'watchModel');
  if (watchModel) {
    const watchProfile: AiProfile = { ...defaultProfile, id: randomProfileId(), name: '查价档案', model: watchModel };
    profiles.push(watchProfile);
    setSetting(db, 'aiProfileWatch', watchProfile.id);
  }

  setAiProfiles(db, profiles);
  return profiles;
}

/**
 * 按用途取得绑定档案：先确保完成懒迁移，再按绑定键取对应 id 的档案；
 * 绑定为空或指向的档案已被删除时回退到第一个档案；档案列表本身为空时返回 null。
 */
export function getAiProfileFor(db: Db, usage: AiProfileUsage): AiProfile | null {
  const profiles = ensureAiProfiles(db);
  if (profiles.length === 0) return null;
  const boundId = getSetting(db, usage);
  const found = boundId ? profiles.find((p) => p.id === boundId) : undefined;
  return found ?? profiles[0];
}

export function getCostRule(db: Db): CostRule {
  const v = getSetting(db, 'costRule');
  return (v as CostRule | null) ?? 'lowest';
}

export function getDefaultMargin(db: Db): number {
  const v = getSetting(db, 'defaultMargin');
  return v != null ? Number(v) : 1.3;
}

/** 查价监控总开关，默认关闭。 */
export function isWatchEnabled(db: Db): boolean {
  return getSetting(db, 'watchEnabled') === '1';
}

/** 查价周期（天），可选 1/7/30，默认 30。 */
export function getWatchIntervalDays(db: Db): number {
  const v = getSetting(db, 'watchIntervalDays');
  return v != null ? Number(v) : 30;
}

/** 异动通知阈值（相对变化率），默认 0.1（±10%）。 */
export function getWatchAlertRate(db: Db): number {
  const v = getSetting(db, 'watchAlertRate');
  return v != null ? Number(v) : 0.1;
}

/** 关闭主窗口时是否最小化到托盘（而非退出），默认开启（'1'）。 */
export function getCloseToTray(db: Db): boolean {
  const v = getSetting(db, 'closeToTray');
  return v == null ? true : v === '1';
}

/**
 * 软件更新方式：'auto'（自动下载+提示重启，仅 Windows 生效）| 'notify'（仅提示+打开下载页）。
 * 未设置时按平台给默认值：Windows 'auto'，其余（含 mac，未签名不支持自动安装）'notify'。
 * platform 可注入以便测试覆盖两个分支，默认取 process.platform。
 */
export function getUpdateMode(db: Db, platform: NodeJS.Platform = process.platform): 'auto' | 'notify' {
  const v = getSetting(db, 'updateMode');
  if (v === 'auto' || v === 'notify') return v;
  return platform === 'win32' ? 'auto' : 'notify';
}

/** 开机自启开关，默认关闭。仅 mac/Windows 生效，Linux 不处理（由调用方判断）。 */
export function getLaunchAtLogin(db: Db): boolean {
  return getSetting(db, 'launchAtLogin') === '1';
}
