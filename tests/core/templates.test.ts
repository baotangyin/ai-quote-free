import { describe, it, expect } from 'vitest';
import { openDb } from '../../src/core/db/db';
import {
  listTemplates, getTemplate, getTemplateByType, createTemplate, updateTemplate, deleteTemplate,
  applyTemplate, validateTemplateSections, createProjectWithTemplate,
} from '../../src/core/repo/templates';
import { createProject, createSection, listSections, listSpaces } from '../../src/core/repo/projects';
import type { TemplateSection } from '../../src/core/domain/types';

const SECTIONS: TemplateSection[] = [
  { name: '多媒体硬件', integrationFeeRate: 0.05, isHardware: true, spaces: [
    { name: '安防监控系统设备', description: null, pinBottom: true }
  ] },
  { name: '软件影片', integrationFeeRate: 0, isHardware: false, spaces: [] }
];

describe('templates repo', () => {
  it('CRUD 往返：create/get/getByType/update/delete', () => {
    const db = openDb(':memory:');
    const tpl = createTemplate(db, { projectType: '指挥中心', sections: SECTIONS });
    expect(tpl.projectType).toBe('指挥中心');
    expect(getTemplate(db, tpl.id)!.sections).toEqual(SECTIONS);
    expect(getTemplateByType(db, '指挥中心')!.id).toBe(tpl.id);
    const upd = updateTemplate(db, tpl.id, { sections: [] });
    expect(upd.sections).toEqual([]);
    deleteTemplate(db, tpl.id);
    expect(getTemplate(db, tpl.id)).toBeNull();
    // 出厂展厅模板仍在（list 含展厅）
    expect(listTemplates(db).map((t) => t.projectType)).toContain('展厅');
    db.close();
  });

  it('project_type 唯一：重复创建报中文错误', () => {
    const db = openDb(':memory:');
    expect(() => createTemplate(db, { projectType: '展厅', sections: [] }))
      .toThrow('项目类型「展厅」的模板已存在');
    db.close();
  });

  it('校验：空板块名/空空间名/负费率拒绝；宽容缺省字段', () => {
    expect(() => validateTemplateSections([{ name: ' ', spaces: [] }])).toThrow('板块名称不能为空');
    expect(() => validateTemplateSections([{ name: 'A', spaces: [{ name: '' }] }])).toThrow('空间名称不能为空');
    expect(() => validateTemplateSections([{ name: 'A', integrationFeeRate: -1, spaces: [] }]))
      .toThrow('集成费比例必须为非负数字');
    expect(validateTemplateSections([{ name: 'A' }])).toEqual([
      { name: 'A', integrationFeeRate: 0, isHardware: false, spaces: [] }
    ]);
  });

  it('存储中损坏 JSON 容错为空模板', () => {
    const db = openDb(':memory:');
    db.prepare("UPDATE project_type_templates SET sections='{oops' WHERE project_type='展厅'").run();
    expect(getTemplateByType(db, '展厅')!.sections).toEqual([]);
    db.close();
  });

  it('applyTemplate：按序建板块+空间，置底/费率/硬件生效；已有板块时追加在末尾', () => {
    const db = openDb(':memory:');
    const p = createProject(db, { name: 'T' });
    createSection(db, { projectId: p.id, name: '已有板块' });
    const tpl = createTemplate(db, { projectType: '指挥中心', sections: SECTIONS });
    applyTemplate(db, p.id, tpl.id);
    const secs = listSections(db, p.id);
    expect(secs.map((s) => s.name)).toEqual(['已有板块', '多媒体硬件', '软件影片']);
    expect(secs[1].integrationFeeRate).toBe(0.05);
    expect(secs[1].isHardware).toBe(true);
    expect(secs[2].isHardware).toBe(false);
    const spaces = listSpaces(db, secs[1].id);
    expect(spaces.map((s) => `${s.name}:${s.pinBottom}`)).toEqual(['安防监控系统设备:true']);
    db.close();
  });

  it('applyTemplate：模板/项目不存在抛错', () => {
    const db = openDb(':memory:');
    const p = createProject(db, { name: 'T' });
    expect(() => applyTemplate(db, p.id, 999)).toThrow('模板 999 不存在');
    const tpl = getTemplateByType(db, '展厅')!;
    expect(() => applyTemplate(db, 999, tpl.id)).toThrow('project 999 not found');
    db.close();
  });

  it('createProjectWithTemplate：有同名类型模板则自动生成骨架，无模板/无类型则仅建项目', () => {
    const db = openDb(':memory:');
    const p1 = createProjectWithTemplate(db, { name: 'A', projectType: '展厅' });
    const secs1 = listSections(db, p1.id);
    expect(secs1.map((s) => s.name)).toEqual(['多媒体硬件', '软件影片', '装修装饰']);
    expect(listSpaces(db, secs1[0].id).map((s) => s.name))
      .toEqual(['安防监控系统设备', '中控及网络设备']);
    const p2 = createProjectWithTemplate(db, { name: 'B', projectType: '不存在的类型' });
    expect(listSections(db, p2.id)).toEqual([]);
    const p3 = createProjectWithTemplate(db, { name: 'C' });
    expect(listSections(db, p3.id)).toEqual([]);
    db.close();
  });
});
