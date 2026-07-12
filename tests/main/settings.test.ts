import { describe, it, expect } from 'vitest';
import * as core from '../../src/core/index';
import {
  ensureSettingsTable, getSetting, setSetting, getCostRule, getDefaultMargin,
  isWatchEnabled, getWatchIntervalDays, getWatchAlertRate, getCloseToTray, getUpdateMode,
  getLaunchAtLogin, ensureAiProfiles, getAiProfiles, setAiProfiles, getAiProfileFor,
  type AiProfile,
} from '../../src/main/settings';

function configureLegacyAi(db: ReturnType<typeof buildDb>): void {
  setSetting(db, 'aiProtocol', 'openai');
  setSetting(db, 'aiBaseUrl', 'https://api.test');
  setSetting(db, 'aiApiKey', 'sk-test');
  setSetting(db, 'aiModel', 'test-model');
}

function buildDb() {
  const db = core.openDb(':memory:');
  ensureSettingsTable(db);
  return db;
}

describe('settings 表', () => {
  it('get/set 基本读写，set 为 upsert', () => {
    const db = buildDb();
    expect(getSetting(db, 'foo')).toBeNull();
    setSetting(db, 'foo', 'bar');
    expect(getSetting(db, 'foo')).toBe('bar');
    setSetting(db, 'foo', 'baz');
    expect(getSetting(db, 'foo')).toBe('baz');
  });

  it('getCostRule 默认 lowest，可被 settings 覆盖', () => {
    const db = buildDb();
    expect(getCostRule(db)).toBe('lowest');
    setSetting(db, 'costRule', 'latest');
    expect(getCostRule(db)).toBe('latest');
  });

  it('getDefaultMargin 默认 1.3，可被 settings 覆盖', () => {
    const db = buildDb();
    expect(getDefaultMargin(db)).toBe(1.3);
    setSetting(db, 'defaultMargin', '1.5');
    expect(getDefaultMargin(db)).toBe(1.5);
  });

  it('ensureSettingsTable 幂等（重复调用不抛错）', () => {
    const db = buildDb();
    expect(() => ensureSettingsTable(db)).not.toThrow();
    setSetting(db, 'foo', 'bar');
    ensureSettingsTable(db);
    expect(getSetting(db, 'foo')).toBe('bar');
  });

  it('isWatchEnabled 默认关闭，仅 "1" 视为开启', () => {
    const db = buildDb();
    expect(isWatchEnabled(db)).toBe(false);
    setSetting(db, 'watchEnabled', '0');
    expect(isWatchEnabled(db)).toBe(false);
    setSetting(db, 'watchEnabled', '1');
    expect(isWatchEnabled(db)).toBe(true);
  });

  it('getWatchIntervalDays 默认 30，可被 settings 覆盖', () => {
    const db = buildDb();
    expect(getWatchIntervalDays(db)).toBe(30);
    setSetting(db, 'watchIntervalDays', '7');
    expect(getWatchIntervalDays(db)).toBe(7);
  });

  it('getWatchAlertRate 默认 0.1，可被 settings 覆盖', () => {
    const db = buildDb();
    expect(getWatchAlertRate(db)).toBe(0.1);
    setSetting(db, 'watchAlertRate', '0.2');
    expect(getWatchAlertRate(db)).toBe(0.2);
  });

  it('getCloseToTray 未设置时默认开启，显式设为 "0" 时关闭', () => {
    const db = buildDb();
    expect(getCloseToTray(db)).toBe(true);
    setSetting(db, 'closeToTray', '0');
    expect(getCloseToTray(db)).toBe(false);
    setSetting(db, 'closeToTray', '1');
    expect(getCloseToTray(db)).toBe(true);
  });

  it('getUpdateMode 未设置时按平台给默认值：win32→auto，其余（含 darwin）→notify', () => {
    const db = buildDb();
    expect(getUpdateMode(db, 'win32')).toBe('auto');
    expect(getUpdateMode(db, 'darwin')).toBe('notify');
    expect(getUpdateMode(db, 'linux')).toBe('notify');
  });

  it('getUpdateMode 已显式设置时忽略平台默认值', () => {
    const db = buildDb();
    setSetting(db, 'updateMode', 'notify');
    expect(getUpdateMode(db, 'win32')).toBe('notify');
    setSetting(db, 'updateMode', 'auto');
    expect(getUpdateMode(db, 'darwin')).toBe('auto');
  });

  it('getUpdateMode 无效值时回退到平台默认值', () => {
    const db = buildDb();
    setSetting(db, 'updateMode', 'garbage');
    expect(getUpdateMode(db, 'win32')).toBe('auto');
    expect(getUpdateMode(db, 'darwin')).toBe('notify');
  });

  it('getLaunchAtLogin 默认关闭，仅 "1" 视为开启', () => {
    const db = buildDb();
    expect(getLaunchAtLogin(db)).toBe(false);
    setSetting(db, 'launchAtLogin', '0');
    expect(getLaunchAtLogin(db)).toBe(false);
    setSetting(db, 'launchAtLogin', '1');
    expect(getLaunchAtLogin(db)).toBe(true);
  });
});

describe('getAiProfiles / setAiProfiles', () => {
  it('未设置 aiProfiles 时返回空数组', () => {
    const db = buildDb();
    expect(getAiProfiles(db)).toEqual([]);
  });

  it('JSON 非法或非数组时容错返回空数组', () => {
    const db = buildDb();
    setSetting(db, 'aiProfiles', '{not json');
    expect(getAiProfiles(db)).toEqual([]);
    setSetting(db, 'aiProfiles', '{"a":1}');
    expect(getAiProfiles(db)).toEqual([]);
  });

  it('setAiProfiles 写入后 getAiProfiles 能读回', () => {
    const db = buildDb();
    const profiles: AiProfile[] = [{ id: 'p1', name: 'A', protocol: 'openai', baseUrl: 'https://x', apiKey: 'k', model: 'm' }];
    setAiProfiles(db, profiles);
    expect(getAiProfiles(db)).toEqual(profiles);
  });
});

describe('ensureAiProfiles 懒迁移', () => {
  it('无旧键、无 aiProfiles 时不迁移，返回空数组，不写任何绑定键', () => {
    const db = buildDb();
    expect(ensureAiProfiles(db)).toEqual([]);
    expect(getSetting(db, 'aiProfileText')).toBeNull();
    expect(getSetting(db, 'aiProfileVision')).toBeNull();
    expect(getSetting(db, 'aiProfileWatch')).toBeNull();
  });

  it('旧键不齐全（缺 aiModel）时不迁移', () => {
    const db = buildDb();
    setSetting(db, 'aiProtocol', 'openai');
    setSetting(db, 'aiBaseUrl', 'https://api.test');
    setSetting(db, 'aiApiKey', 'sk-test');
    expect(ensureAiProfiles(db)).toEqual([]);
  });

  it('仅主配置齐全时生成默认档案，三用途绑定均指向它，旧键保留不删', () => {
    const db = buildDb();
    configureLegacyAi(db);
    const profiles = ensureAiProfiles(db);
    expect(profiles).toHaveLength(1);
    const p = profiles[0];
    expect(p).toMatchObject({ name: '默认档案', protocol: 'openai', baseUrl: 'https://api.test', apiKey: 'sk-test', model: 'test-model' });
    expect(getSetting(db, 'aiProfileText')).toBe(p.id);
    expect(getSetting(db, 'aiProfileVision')).toBe(p.id);
    expect(getSetting(db, 'aiProfileWatch')).toBe(p.id);
    // 旧键保留不删（回滚兼容）
    expect(getSetting(db, 'aiProtocol')).toBe('openai');
    expect(getSetting(db, 'aiModel')).toBe('test-model');
  });

  it('含旧 visionModel 时额外生成图片处理档案（同厂家不同模型）并单独绑定图片处理用途', () => {
    const db = buildDb();
    configureLegacyAi(db);
    setSetting(db, 'visionModel', 'vision-model-x');
    const profiles = ensureAiProfiles(db);
    expect(profiles).toHaveLength(2);
    const defaultP = profiles.find((p) => p.name === '默认档案')!;
    const visionP = profiles.find((p) => p.name === '图片处理档案')!;
    expect(visionP.model).toBe('vision-model-x');
    expect(visionP.protocol).toBe(defaultP.protocol);
    expect(visionP.baseUrl).toBe(defaultP.baseUrl);
    expect(getSetting(db, 'aiProfileText')).toBe(defaultP.id);
    expect(getSetting(db, 'aiProfileVision')).toBe(visionP.id);
    expect(getSetting(db, 'aiProfileWatch')).toBe(defaultP.id);
  });

  it('含旧 watchModel 时额外生成查价档案并单独绑定查价用途', () => {
    const db = buildDb();
    configureLegacyAi(db);
    setSetting(db, 'watchModel', 'watch-model-x');
    const profiles = ensureAiProfiles(db);
    expect(profiles).toHaveLength(2);
    const defaultP = profiles.find((p) => p.name === '默认档案')!;
    const watchP = profiles.find((p) => p.name === '查价档案')!;
    expect(watchP.model).toBe('watch-model-x');
    expect(getSetting(db, 'aiProfileWatch')).toBe(watchP.id);
    expect(getSetting(db, 'aiProfileText')).toBe(defaultP.id);
    expect(getSetting(db, 'aiProfileVision')).toBe(defaultP.id);
  });

  it('幂等：aiProfiles 已存在时直接返回，不重复迁移或覆盖', () => {
    const db = buildDb();
    const manual: AiProfile[] = [{ id: 'fixed', name: '手工档案', protocol: 'anthropic', baseUrl: 'https://a', apiKey: 'k', model: 'm' }];
    setAiProfiles(db, manual);
    configureLegacyAi(db); // 即使旧键也齐全，已有 aiProfiles 时不应触发迁移
    expect(ensureAiProfiles(db)).toEqual(manual);
    expect(getSetting(db, 'aiProfileText')).toBeNull(); // 未曾绑定，迁移未发生
  });
});

describe('getAiProfileFor 读取器解析与回退', () => {
  it('无档案时返回 null', () => {
    const db = buildDb();
    expect(getAiProfileFor(db, 'aiProfileText')).toBeNull();
  });

  it('绑定键为空时回退到第一个档案', () => {
    const db = buildDb();
    const profiles: AiProfile[] = [
      { id: 'p1', name: 'A', protocol: 'openai', baseUrl: 'https://a', apiKey: 'k1', model: 'm1' },
      { id: 'p2', name: 'B', protocol: 'openai', baseUrl: 'https://b', apiKey: 'k2', model: 'm2' },
    ];
    setAiProfiles(db, profiles);
    expect(getAiProfileFor(db, 'aiProfileText')).toEqual(profiles[0]);
  });

  it('绑定键指向的档案已被删除（id 失效）时回退到第一个档案', () => {
    const db = buildDb();
    const profiles: AiProfile[] = [
      { id: 'p1', name: 'A', protocol: 'openai', baseUrl: 'https://a', apiKey: 'k1', model: 'm1' },
    ];
    setAiProfiles(db, profiles);
    setSetting(db, 'aiProfileVision', 'deleted-id');
    expect(getAiProfileFor(db, 'aiProfileVision')).toEqual(profiles[0]);
  });

  it('绑定键有效时精确命中对应档案', () => {
    const db = buildDb();
    const profiles: AiProfile[] = [
      { id: 'p1', name: 'A', protocol: 'openai', baseUrl: 'https://a', apiKey: 'k1', model: 'm1' },
      { id: 'p2', name: 'B', protocol: 'anthropic', baseUrl: 'https://b', apiKey: 'k2', model: 'm2' },
    ];
    setAiProfiles(db, profiles);
    setSetting(db, 'aiProfileWatch', 'p2');
    expect(getAiProfileFor(db, 'aiProfileWatch')).toEqual(profiles[1]);
  });
});
