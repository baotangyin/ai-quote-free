import type { Db } from '../db/db';
import { nowIso } from '../db/db';
import type { ProjectTypeTemplate, TemplateSection, Project, QuoteMode, RoundRule } from '../domain/types';
import { createProject, createSection, createSpace, getProject } from './projects';

/** 校验并规范化模板板块 JSON 结构；非法结构抛中文错误。宽容缺省：费率默认 0、isHardware 默认 false、spaces 默认 []。 */
export function validateTemplateSections(v: unknown): TemplateSection[] {
  if (!Array.isArray(v)) throw new Error('模板板块必须是数组');
  return v.map((s: any) => {
    if (typeof s?.name !== 'string' || !s.name.trim()) throw new Error('板块名称不能为空');
    const rate = s.integrationFeeRate ?? 0;
    if (typeof rate !== 'number' || Number.isNaN(rate) || rate < 0) throw new Error('集成费比例必须为非负数字');
    const spacesRaw = s.spaces ?? [];
    if (!Array.isArray(spacesRaw)) throw new Error('空间列表必须是数组');
    return {
      name: s.name.trim(),
      integrationFeeRate: rate,
      isHardware: !!s.isHardware,
      linkSpaces: !!s.linkSpaces,
      spaces: spacesRaw.map((sp: any) => {
        if (typeof sp?.name !== 'string' || !sp.name.trim()) throw new Error('空间名称不能为空');
        return { name: sp.name.trim(), description: sp.description ?? null, pinBottom: !!sp.pinBottom };
      }),
    };
  });
}

/** 存储层 JSON 解析：损坏或非法结构容错为空模板（读路径不抛错，写路径由 validate 把关）。 */
function parseSections(raw: string): TemplateSection[] {
  try {
    return validateTemplateSections(JSON.parse(raw));
  } catch {
    return [];
  }
}

const toTemplate = (r: any): ProjectTypeTemplate => ({ id: r.id, projectType: r.project_type,
  sections: parseSections(r.sections), createdAt: r.created_at, updatedAt: r.updated_at });

export function listTemplates(db: Db): ProjectTypeTemplate[] {
  return db.prepare('SELECT * FROM project_type_templates ORDER BY project_type').all().map(toTemplate);
}
export function getTemplate(db: Db, id: number): ProjectTypeTemplate | null {
  const r = db.prepare('SELECT * FROM project_type_templates WHERE id=?').get(id);
  return r ? toTemplate(r) : null;
}
export function getTemplateByType(db: Db, projectType: string): ProjectTypeTemplate | null {
  const r = db.prepare('SELECT * FROM project_type_templates WHERE project_type=?').get(projectType);
  return r ? toTemplate(r) : null;
}

export function createTemplate(db: Db, input: { projectType: string; sections: TemplateSection[] }): ProjectTypeTemplate {
  const type = input.projectType.trim();
  if (!type) throw new Error('项目类型不能为空');
  const sections = validateTemplateSections(input.sections);
  const t = nowIso();
  try {
    const info = db.prepare('INSERT INTO project_type_templates (project_type, sections, created_at, updated_at) VALUES (?,?,?,?)')
      .run(type, JSON.stringify(sections), t, t);
    return getTemplate(db, Number(info.lastInsertRowid))!;
  } catch (err) {
    if ((err as Error).message.includes('UNIQUE')) throw new Error(`项目类型「${type}」的模板已存在`);
    throw err;
  }
}

export function updateTemplate(db: Db, id: number, patch: Partial<{ projectType: string; sections: TemplateSection[] }>): ProjectTypeTemplate {
  const cur = getTemplate(db, id);
  if (!cur) throw new Error(`模板 ${id} 不存在`);
  const type = (patch.projectType ?? cur.projectType).trim();
  if (!type) throw new Error('项目类型不能为空');
  const sections = patch.sections !== undefined ? validateTemplateSections(patch.sections) : cur.sections;
  try {
    db.prepare('UPDATE project_type_templates SET project_type=?, sections=?, updated_at=? WHERE id=?')
      .run(type, JSON.stringify(sections), nowIso(), id);
  } catch (err) {
    if ((err as Error).message.includes('UNIQUE')) throw new Error(`项目类型「${type}」的模板已存在`);
    throw err;
  }
  return getTemplate(db, id)!;
}

export function deleteTemplate(db: Db, id: number): void {
  db.prepare('DELETE FROM project_type_templates WHERE id=?').run(id);
}

/** 按模板为项目批量创建板块+空间（追加语义：不清空已有板块，新板块排在末尾）。整体在事务中。 */
export function applyTemplate(db: Db, projectId: number, templateId: number): void {
  const tpl = getTemplate(db, templateId);
  if (!tpl) throw new Error(`模板 ${templateId} 不存在`);
  if (!getProject(db, projectId)) throw new Error(`project ${projectId} not found`);
  const run = db.transaction(() => {
    for (const sec of tpl.sections) {
      const newSec = createSection(db, {
        projectId, name: sec.name,
        integrationFeeRate: sec.integrationFeeRate, isHardware: sec.isHardware,
        linkSpaces: sec.linkSpaces,
      });
      for (const sp of sec.spaces) {
        createSpace(db, { sectionId: newSec.id, name: sp.name, description: sp.description ?? undefined, pinBottom: sp.pinBottom });
      }
    }
  });
  run();
}

/** 建项目并按项目类型自动应用模板（若该类型存在模板）。IPC projects:create 使用。 */
export function createProjectWithTemplate(db: Db, input: {
  name: string; client?: string; projectType?: string | null;
  mode?: QuoteMode; defaultMargin?: number; roundRule?: RoundRule;
}): Project {
  const run = db.transaction(() => {
    const project = createProject(db, input);
    if (project.projectType) {
      const tpl = getTemplateByType(db, project.projectType);
      if (tpl) applyTemplate(db, project.id, tpl.id);
    }
    return project;
  });
  return run();
}
