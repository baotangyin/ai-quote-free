import { describe, it, expect } from 'vitest';
import * as core from '../../src/core/index';
import { handlers } from '../../src/main/ipc';

function buildDb() {
  return core.openDb(':memory:');
}

describe('inquiries:* IPC 契约', () => {
  it('create→list→get→setReply→writeReply 全链路，写入 price_records', () => {
    const db = buildDb();
    const supplier = handlers['suppliers:create'](db, { name: '供应商甲' });
    const project = handlers['projects:create'](db, { name: '项目甲' });
    const product = handlers['products:create'](db, { category: '触摸屏', name: '一体机', unit: '台' });

    const created = handlers['inquiries:create'](db, {
      supplierId: supplier.id,
      projectId: project.id,
      title: '项目甲-询价单',
      items: [{ productId: product.id, name: '一体机', unit: '台', qty: 2 }],
    });
    expect(created.supplierName).toBe('供应商甲');
    expect(created.items).toHaveLength(1);

    const list = handlers['inquiries:list'](db, undefined);
    expect(list.some((i: any) => i.id === created.id)).toBe(true);

    const listBySupplier = handlers['inquiries:list'](db, supplier.id);
    expect(listBySupplier.map((i: any) => i.id)).toEqual([created.id]);

    const got = handlers['inquiries:get'](db, created.id);
    expect(got.id).toBe(created.id);

    const itemId = got.items[0].id;
    const replied = handlers['inquiries:setReply'](db, { itemId, replyPriceCents: 55000 });
    expect(replied.replyPriceCents).toBe(55000);

    const rec = handlers['inquiries:writeReply'](db, itemId);
    expect(rec.source).toBe('supplier');
    expect(rec.supplierId).toBe(supplier.id);
    expect(rec.priceCents).toBe(55000);

    const records = handlers['prices:list'](db, product.id);
    expect(records.some((r: any) => r.id === rec.id)).toBe(true);

    handlers['inquiries:delete'](db, created.id);
    expect(handlers['inquiries:get'](db, created.id)).toBeNull();
    db.close();
  });
});
