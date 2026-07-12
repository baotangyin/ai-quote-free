import { describe, it, expect } from 'vitest';
import { openDb } from '../../src/core/db/db';
import { FACTORY_CONFIG, FACTORY_TEMPLATE_NAME } from '../../src/core/export/factoryTemplate';

describe('migration v6: export_templates', () => {
  it('新库 user_version=6，含 export_templates 表', () => {
    const db = openDb(':memory:');
    expect(db.pragma('user_version', { simple: true })).toBe(12);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r: any) => r.name);
    expect(tables).toContain('export_templates');
    db.close();
  });

  it('出厂「标准三版本」模板已播种且与 FACTORY_CONFIG 一致', () => {
    const db = openDb(':memory:');
    const r = db.prepare('SELECT name, config FROM export_templates').all() as any[];
    expect(r).toHaveLength(1);
    expect(r[0].name).toBe(FACTORY_TEMPLATE_NAME);
    expect(JSON.parse(r[0].config)).toEqual(FACTORY_CONFIG);
    db.close();
  });

  it('出厂 config 结构完整复刻现状：三版本/无抬头落款/默认样式', () => {
    expect(FACTORY_CONFIG.header).toEqual({
      detailTitle: '概 算 明 细 表',
      summaryTitle: '{项目名}\n项目总投资估算表',
      projectNameLabel: '工程名称：',
      companyName: null,
      footer: null
    });
    expect(FACTORY_CONFIG.style).toEqual({ headerFillArgb: 'FFD9D9D9', titleFontSize: 16, moneyFmt: '#,##0.00', border: true });
    expect(FACTORY_CONFIG.versions.map((v) => [v.key, v.name, v.includeSummarySheet])).toEqual([
      ['full', '含成本完整版', true],
      ['external', '对外报价版', true],
      ['implementation', '实施清单', false]
    ]);
    // full 版列集为全集顺序；所有 label/width 为 null（用系统默认）
    expect(FACTORY_CONFIG.versions[0].columns.map((c) => c.key)).toEqual([
      'xh','name','params','unit','qty','unitPrice','total','remark','brands','dims',
      'costUnit','costTotal','power220','power380','rackU','seqPower','netPorts','comPorts','ratio'
    ]);
    expect(FACTORY_CONFIG.versions[0].columns.every((c) => c.label === null && c.width === null)).toBe(true);
    expect(FACTORY_CONFIG.versions[0].summaryRows).toEqual(
      { spaceSubtotal: true, integrationFee: true, sectionTotal: true, techSummary: true, taxRate: null });
  });

  it('迁移幂等：同一文件库重复 openDb 不重复播种', () => {
    // 跨平台临时文件（Windows 无 /tmp）
    const { tmpdir } = require('node:os');
    const { join } = require('node:path');
    const { rmSync } = require('node:fs');
    const p = join(tmpdir(), `aiq-mig-v6-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
    try {
      openDb(p).close();
      const db = openDb(p);
      expect((db.prepare('SELECT COUNT(*) AS c FROM export_templates').get() as any).c).toBe(1);
      db.close();
    } finally {
      for (const f of [p, `${p}-wal`, `${p}-shm`]) { try { rmSync(f, { force: true }); } catch { /* ignore */ } }
    }
  });
});
