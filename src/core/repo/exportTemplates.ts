import type { Db } from '../db/db';
import { nowIso } from '../db/db';
import type { ExportTemplate, ExportTemplateConfig } from '../domain/types';
import { FACTORY_CONFIG } from '../export/factoryTemplate';

export const KNOWN_COLUMN_KEYS = ['xh','name','params','unit','qty','unitPrice','total','remark','brands','dims',
  'costUnit','costTotal','power220','power380','rackU','seqPower','netPorts','comPorts','ratio'] as const;

/** 校验并返回模板 config；非法结构抛中文错误（写路径把关；读路径容错见 parseConfig）。 */
export function validateExportTemplateConfig(v: unknown): ExportTemplateConfig {
  const c = v as ExportTemplateConfig;
  if (!c || typeof c !== 'object') throw new Error('模板配置必须是对象');
  const h = c.header, s = c.style;
  if (!h || typeof h.detailTitle !== 'string' || !h.detailTitle.trim()) throw new Error('明细表标题不能为空');
  if (typeof h.summaryTitle !== 'string' || !h.summaryTitle.trim()) throw new Error('汇总表标题不能为空');
  if (typeof h.projectNameLabel !== 'string') throw new Error('工程名称行前缀必须是文本');
  if (!s || typeof s.headerFillArgb !== 'string' || !/^[0-9A-Fa-f]{8}$/.test(s.headerFillArgb)) throw new Error('表头底色必须是 8 位 ARGB 十六进制');
  if (typeof s.titleFontSize !== 'number' || s.titleFontSize <= 0) throw new Error('标题字号必须为正数');
  if (typeof s.moneyFmt !== 'string' || !s.moneyFmt.trim()) throw new Error('金额格式不能为空');
  if (typeof s.border !== 'boolean') throw new Error('边框开关必须是布尔值');
  if (!Array.isArray(c.versions) || c.versions.length === 0) throw new Error('模板至少需要一个版本');
  const seen = new Set<string>();
  for (const ver of c.versions) {
    if (typeof ver.key !== 'string' || !/^[a-z0-9-]+$/.test(ver.key)) throw new Error('版本标识只能包含小写字母、数字与连字符');
    if (seen.has(ver.key)) throw new Error(`版本标识重复：${ver.key}`);
    seen.add(ver.key);
    if (typeof ver.name !== 'string' || !ver.name.trim()) throw new Error('版本名称不能为空');
    if (!Array.isArray(ver.columns) || ver.columns.length === 0) throw new Error(`版本「${ver.name}」至少需要一列`);
    for (const col of ver.columns) {
      const isCustom = col.key.startsWith('custom-');
      if (isCustom) {
        if (typeof col.label !== 'string' || !col.label.trim()) throw new Error('自定义列必须填写列名');
      } else if (!(KNOWN_COLUMN_KEYS as readonly string[]).includes(col.key)) {
        throw new Error(`未知列：${col.key}`);
      }
      if (col.width != null && (typeof col.width !== 'number' || col.width <= 0)) throw new Error('列宽必须为正数');
    }
    const sr = ver.summaryRows;
    if (!sr || [sr.spaceSubtotal, sr.integrationFee, sr.sectionTotal, sr.techSummary].some((b) => typeof b !== 'boolean'))
      throw new Error('汇总行开关必须是布尔值');
    if (sr.taxRate != null && (typeof sr.taxRate !== 'number' || sr.taxRate < 0 || sr.taxRate >= 1))
      throw new Error('税率必须在 0 到 1 之间');
    if (ver.includeSummarySheet === true && sr.sectionTotal === false)
      throw new Error('生成汇总表的版本必须开启合计行');
  }
  return c;
}

/** 读路径：损坏/非法 config 容错回退出厂 config（导出永不因坏模板崩溃）。 */
function parseConfig(raw: string): ExportTemplateConfig {
  try { return validateExportTemplateConfig(JSON.parse(raw)); } catch { return FACTORY_CONFIG; }
}

const toTemplate = (r: any): ExportTemplate => ({ id: r.id, name: r.name,
  config: parseConfig(r.config), createdAt: r.created_at, updatedAt: r.updated_at });

export function listExportTemplates(db: Db): ExportTemplate[] {
  return db.prepare('SELECT * FROM export_templates ORDER BY id').all().map(toTemplate);
}
export function getExportTemplate(db: Db, id: number): ExportTemplate | null {
  const r = db.prepare('SELECT * FROM export_templates WHERE id=?').get(id);
  return r ? toTemplate(r) : null;
}
export function createExportTemplate(db: Db, input: { name: string; config: ExportTemplateConfig }): ExportTemplate {
  const name = input.name.trim();
  if (!name) throw new Error('模板名称不能为空');
  const config = validateExportTemplateConfig(input.config);
  const t = nowIso();
  try {
    const info = db.prepare('INSERT INTO export_templates (name, config, created_at, updated_at) VALUES (?,?,?,?)')
      .run(name, JSON.stringify(config), t, t);
    return getExportTemplate(db, Number(info.lastInsertRowid))!;
  } catch (err) {
    if ((err as Error).message.includes('UNIQUE')) throw new Error(`模板「${name}」已存在`);
    throw err;
  }
}
export function updateExportTemplate(db: Db, id: number, patch: Partial<{ name: string; config: ExportTemplateConfig }>): ExportTemplate {
  const cur = getExportTemplate(db, id);
  if (!cur) throw new Error(`模板 ${id} 不存在`);
  const name = (patch.name ?? cur.name).trim();
  if (!name) throw new Error('模板名称不能为空');
  const config = patch.config !== undefined ? validateExportTemplateConfig(patch.config) : cur.config;
  try {
    db.prepare('UPDATE export_templates SET name=?, config=?, updated_at=? WHERE id=?')
      .run(name, JSON.stringify(config), nowIso(), id);
  } catch (err) {
    if ((err as Error).message.includes('UNIQUE')) throw new Error(`模板「${name}」已存在`);
    throw err;
  }
  return getExportTemplate(db, id)!;
}
export function deleteExportTemplate(db: Db, id: number): void {
  db.prepare('DELETE FROM export_templates WHERE id=?').run(id);
}
