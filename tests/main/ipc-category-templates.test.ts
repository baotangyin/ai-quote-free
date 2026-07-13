import { describe, it, expect } from 'vitest';
import * as core from '../../src/core/index';
import { handlers } from '../../src/main/ipc';

function buildDb() {
  return core.openDb(':memory:');
}

describe('categoryTemplates:* IPC 契约', () => {
  it('list/create/update/delete 全流程', () => {
    const db = buildDb();
    expect(handlers['categoryTemplates:list'](db, undefined)).toEqual([]);

    const created = handlers['categoryTemplates:create'](db, {
      category: 'LED屏',
      defaults: { unit: '㎡', power220W: 200 },
    });
    expect(created.category).toBe('LED屏');
    expect(handlers['categoryTemplates:get'](db, created.id)).toEqual(created);
    expect(handlers['categoryTemplates:list'](db, undefined)).toEqual([created]);

    const updated = handlers['categoryTemplates:update'](db, {
      id: created.id,
      patch: { defaults: { unit: '台', rackU: 4 } },
    });
    expect(updated.defaults).toEqual({ unit: '台', rackU: 4 });

    handlers['categoryTemplates:delete'](db, created.id);
    expect(handlers['categoryTemplates:list'](db, undefined)).toEqual([]);
    db.close();
  });

  it('products:create 手动新建产品时，应用类别模板仅填空/零值字段', () => {
    const db = buildDb();
    handlers['categoryTemplates:create'](db, {
      category: 'LED屏',
      defaults: { unit: '㎡', power220W: 200, rackU: 4 },
    });
    const product = handlers['products:create'](db, {
      category: 'LED屏',
      name: 'P1.8全彩屏',
      unit: '',
      power220W: 0,
      rackU: 2, // 已有值，不被覆盖
    });
    expect(product.unit).toBe('㎡');
    expect(product.power220W).toBe(200);
    expect(product.rackU).toBe(2);
    db.close();
  });
});
