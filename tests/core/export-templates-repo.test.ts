import { describe, it, expect } from 'vitest';
import { openDb } from '../../src/core/db/db';
import {
  listExportTemplates, getExportTemplate, createExportTemplate, updateExportTemplate,
  deleteExportTemplate, validateExportTemplateConfig,
} from '../../src/core/repo/exportTemplates';
import { FACTORY_CONFIG } from '../../src/core/export/factoryTemplate';

const cfg = () => JSON.parse(JSON.stringify(FACTORY_CONFIG));

describe('exportTemplates repo', () => {
  it('CRUD 往返 + 出厂模板在列', () => {
    const db = openDb(':memory:');
    expect(listExportTemplates(db).map((t) => t.name)).toEqual(['标准三版本']);
    const t = createExportTemplate(db, { name: '甲方格式', config: cfg() });
    expect(getExportTemplate(db, t.id)!.config).toEqual(FACTORY_CONFIG);
    const upd = updateExportTemplate(db, t.id, { name: '甲方格式2' });
    expect(upd.name).toBe('甲方格式2');
    deleteExportTemplate(db, t.id);
    expect(getExportTemplate(db, t.id)).toBeNull();
    db.close();
  });

  it('name 唯一：重复创建报中文错误', () => {
    const db = openDb(':memory:');
    expect(() => createExportTemplate(db, { name: '标准三版本', config: cfg() }))
      .toThrow('模板「标准三版本」已存在');
    db.close();
  });

  it('校验：空版本/重复version key/非法key格式/未知列/空列集/非法税率 全部拒绝', () => {
    const base = cfg();
    expect(() => validateExportTemplateConfig({ ...base, versions: [] })).toThrow('模板至少需要一个版本');
    const dup = cfg(); dup.versions[1].key = 'full';
    expect(() => validateExportTemplateConfig(dup)).toThrow('版本标识重复：full');
    const badKey = cfg(); badKey.versions[0].key = 'Full 版';
    expect(() => validateExportTemplateConfig(badKey)).toThrow('版本标识只能包含小写字母、数字与连字符');
    const unknownCol = cfg(); unknownCol.versions[0].columns.push({ key: 'origin', label: null, width: null });
    expect(() => validateExportTemplateConfig(unknownCol)).toThrow('未知列：origin');
    const emptyCols = cfg(); emptyCols.versions[0].columns = [];
    expect(() => validateExportTemplateConfig(emptyCols)).toThrow('版本「含成本完整版」至少需要一列');
    const badTax = cfg(); badTax.versions[0].summaryRows.taxRate = 1.5;
    expect(() => validateExportTemplateConfig(badTax)).toThrow('税率必须在 0 到 1 之间');
  });

  it('读路径容错：损坏 config 回退出厂 config', () => {
    const db = openDb(':memory:');
    const t = createExportTemplate(db, { name: 'X', config: cfg() });
    db.prepare("UPDATE export_templates SET config='{broken' WHERE id=?").run(t.id);
    expect(getExportTemplate(db, t.id)!.config).toEqual(FACTORY_CONFIG);
    db.close();
  });

  it('防呆校验：includeSummarySheet=true 且 sectionTotal=false 拒绝', () => {
    const base = cfg();
    base.versions[0].includeSummarySheet = true;
    base.versions[0].summaryRows.sectionTotal = false;
    expect(() => validateExportTemplateConfig(base))
      .toThrow('生成汇总表的版本必须开启合计行');
  });

  it('自定义列（custom- 前缀）：label 为空拒绝，合法通过', () => {
    const emptyLabel = cfg();
    emptyLabel.versions[0].columns.push({ key: 'custom-1', label: null, width: null });
    expect(() => validateExportTemplateConfig(emptyLabel)).toThrow('自定义列必须填写列名');

    const blankLabel = cfg();
    blankLabel.versions[0].columns.push({ key: 'custom-2', label: '   ', width: null });
    expect(() => validateExportTemplateConfig(blankLabel)).toThrow('自定义列必须填写列名');

    const ok = cfg();
    ok.versions[0].columns.push({ key: 'custom-3', label: '厂家备注', width: 20, fixedText: '内部专供' });
    expect(() => validateExportTemplateConfig(ok)).not.toThrow();
    const parsed = validateExportTemplateConfig(ok);
    const customCol = parsed.versions[0].columns.find((c) => c.key === 'custom-3')!;
    expect(customCol.label).toBe('厂家备注');
    expect(customCol.fixedText).toBe('内部专供');
  });

  it('自定义列不受未知列 key 校验限制（custom- 前缀跳过 KNOWN_COLUMN_KEYS 检查）', () => {
    const ok = cfg();
    ok.versions[0].columns.push({ key: 'custom-anything-goes', label: '任意列', width: null });
    expect(() => validateExportTemplateConfig(ok)).not.toThrow();
  });
});
