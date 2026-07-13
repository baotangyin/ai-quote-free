import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, type Db } from '../../src/core/db/db';
import {
  listCategoryTemplates,
  getCategoryTemplate,
  createCategoryTemplate,
  updateCategoryTemplate,
  deleteCategoryTemplate,
  applyCategoryDefaults,
  findCategoryTemplate,
  type ApplyCategoryDefaultsFields,
} from '../../src/core/repo/categoryTemplates';

describe('categoryTemplates repo：CRUD', () => {
  let db: Db;

  beforeEach(() => {
    db = openDb(':memory:');
  });

  it('创建/查询/列表', () => {
    const t = createCategoryTemplate(db, { category: 'LED屏', defaults: { unit: '㎡', power220W: 200 } });
    expect(t.category).toBe('LED屏');
    expect(t.defaults).toEqual({ unit: '㎡', power220W: 200 });
    expect(getCategoryTemplate(db, t.id)).toEqual(t);
    expect(listCategoryTemplates(db)).toEqual([t]);
  });

  it('category 不能为空', () => {
    expect(() => createCategoryTemplate(db, { category: '  ', defaults: {} })).toThrow();
  });

  it('category 唯一，重复创建抛中文错误', () => {
    createCategoryTemplate(db, { category: 'LED屏', defaults: {} });
    expect(() => createCategoryTemplate(db, { category: 'LED屏', defaults: {} })).toThrow('已存在');
  });

  it('defaults 字段类型非法时抛错', () => {
    expect(() => createCategoryTemplate(db, { category: 'X', defaults: { unit: 123 as any } })).toThrow();
    expect(() => createCategoryTemplate(db, { category: 'Y', defaults: { power220W: '200' as any } })).toThrow();
  });

  it('更新 category/defaults', () => {
    const t = createCategoryTemplate(db, { category: 'LED屏', defaults: { unit: '㎡' } });
    const updated = updateCategoryTemplate(db, t.id, { defaults: { unit: '台', rackU: 4 } });
    expect(updated.defaults).toEqual({ unit: '台', rackU: 4 });
    expect(updated.category).toBe('LED屏');
  });

  it('更新为已存在的 category 名报错', () => {
    createCategoryTemplate(db, { category: 'A', defaults: {} });
    const b = createCategoryTemplate(db, { category: 'B', defaults: {} });
    expect(() => updateCategoryTemplate(db, b.id, { category: 'A' })).toThrow('已存在');
  });

  it('删除', () => {
    const t = createCategoryTemplate(db, { category: 'LED屏', defaults: {} });
    deleteCategoryTemplate(db, t.id);
    expect(getCategoryTemplate(db, t.id)).toBeNull();
  });
});

describe('findCategoryTemplate：首个命中类别的模板', () => {
  let db: Db;
  beforeEach(() => {
    db = openDb(':memory:');
  });

  it('按 categories 顺序取首个命中；未命中任何类别返回 null', () => {
    createCategoryTemplate(db, { category: '音响', defaults: { unit: '只' } });
    const t = findCategoryTemplate(db, ['LED屏', '音响']);
    expect(t?.category).toBe('音响');
    expect(findCategoryTemplate(db, ['未知类别'])).toBeNull();
  });
});

describe('applyCategoryDefaults：仅填空值不覆盖已有', () => {
  let db: Db;
  beforeEach(() => {
    db = openDb(':memory:');
    createCategoryTemplate(db, {
      category: 'LED屏',
      defaults: {
        unit: '㎡',
        power220W: 200,
        power380W: 1000,
        rackU: 4,
        seqPowerPorts: 2,
        netPorts: 8,
        comPorts: 1,
        paramsCore: '默认参数',
        paramsBid: '默认标书参数',
        paramsTender: '默认招标参数',
      },
    });
  });

  it('未命中类别时原样返回', () => {
    const fields = { unit: '', power220W: 0 };
    const out = applyCategoryDefaults(db, ['不存在的类别'], fields);
    expect(out).toEqual(fields);
  });

  it('空/零值字段被模板默认值填充', () => {
    const out = applyCategoryDefaults(db, ['LED屏'], {
      unit: '',
      power220W: 0,
      power380W: 0,
      rackU: 0,
      seqPowerPorts: 0,
      netPorts: 0,
      comPorts: 0,
      paramsCore: null,
      paramsBid: '',
      paramsTender: undefined,
    });
    expect(out).toEqual({
      unit: '㎡',
      power220W: 200,
      power380W: 1000,
      rackU: 4,
      seqPowerPorts: 2,
      netPorts: 8,
      comPorts: 1,
      paramsCore: '默认参数',
      paramsBid: '默认标书参数',
      paramsTender: '默认招标参数',
    });
  });

  it('已有非空/非零值不被覆盖', () => {
    const out = applyCategoryDefaults<ApplyCategoryDefaultsFields>(db, ['LED屏'], {
      unit: '台',
      power220W: 50,
      rackU: 2,
      paramsCore: '实际参数',
    });
    expect(out.unit).toBe('台');
    expect(out.power220W).toBe(50);
    expect(out.rackU).toBe(2);
    expect(out.paramsCore).toBe('实际参数');
    // 未提供的字段仍按模板补齐
    expect(out.power380W).toBe(1000);
    expect(out.netPorts).toBe(8);
  });

  it('首个命中类别（categories 顺序优先）的模板生效', () => {
    createCategoryTemplate(db, { category: '55寸', defaults: { unit: '台' } });
    const out = applyCategoryDefaults(db, ['55寸', 'LED屏'], { unit: '' });
    expect(out.unit).toBe('台');
  });
});
