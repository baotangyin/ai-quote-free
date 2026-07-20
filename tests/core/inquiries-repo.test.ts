import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, type Db } from '../../src/core/db/db';
import { createSupplier, updateSupplier, deleteSupplier } from '../../src/core/repo/suppliers';
import { createProject, updateProject, deleteProject } from '../../src/core/repo/projects';
import { createProduct, deleteProduct } from '../../src/core/repo/products';
import { listPriceRecords } from '../../src/core/repo/prices';
import {
  createInquiry, listInquiries, getInquiry, deleteInquiry,
  setInquiryItemReply, writeReplyToPriceRecord,
} from '../../src/core/repo/inquiries';

let db: Db; let supplierId: number; let projectId: number; let productId: number;
beforeEach(() => {
  db = openDb(':memory:');
  supplierId = createSupplier(db, { name: '供应商甲' }).id;
  projectId = createProject(db, { name: '项目甲' }).id;
  productId = createProduct(db, { category: '触摸屏', name: '一体机', unit: '台' }).id;
});

describe('createInquiry', () => {
  it('事务创建询价单+行，冗余快照供应商/项目当前名称，行按数组顺序 sort_order 0,1,2', () => {
    const inq = createInquiry(db, {
      supplierId, projectId, title: '项目甲-询价单', note: '备注X',
      items: [
        { productId, name: '一体机', params: '55寸', unit: '台', qty: 2, remark: '含安装' },
        { name: '手工行', unit: '套', qty: 1 },
      ],
    });
    expect(inq.supplierId).toBe(supplierId);
    expect(inq.supplierName).toBe('供应商甲');
    expect(inq.projectId).toBe(projectId);
    expect(inq.projectName).toBe('项目甲');
    expect(inq.title).toBe('项目甲-询价单');
    expect(inq.note).toBe('备注X');
    expect(inq.items).toHaveLength(2);
    expect(inq.items.map(i => i.sortOrder)).toEqual([0, 1]);
    expect(inq.items[0].productId).toBe(productId);
    expect(inq.items[0].name).toBe('一体机');
    expect(inq.items[0].params).toBe('55寸');
    expect(inq.items[0].qty).toBe(2);
    expect(inq.items[0].remark).toBe('含安装');
    expect(inq.items[0].replyPriceCents).toBeNull();
    expect(inq.items[1].productId).toBeNull();
    expect(inq.items[1].name).toBe('手工行');
  });

  it('冗余名快照语义：创建后供应商/项目改名，询价单显示名不受影响', () => {
    const inq = createInquiry(db, {
      supplierId, projectId, title: 'T', items: [{ name: '行A', unit: '台', qty: 1 }],
    });
    updateSupplier(db, supplierId, { name: '供应商乙' });
    updateProject(db, projectId, { name: '项目乙' });
    const reloaded = getInquiry(db, inq.id)!;
    expect(reloaded.supplierName).toBe('供应商甲');
    expect(reloaded.projectName).toBe('项目甲');
  });

  it('级联删除语义：供应商/项目被删除后，inquiries 的 FK 列置 null，冗余名列仍保留', () => {
    const inq = createInquiry(db, {
      supplierId, projectId, title: 'T', items: [{ name: '行A', unit: '台', qty: 1 }],
    });
    deleteSupplier(db, supplierId);
    deleteProject(db, projectId);
    const reloaded = getInquiry(db, inq.id)!;
    expect(reloaded.supplierId).toBeNull();
    expect(reloaded.projectId).toBeNull();
    expect(reloaded.supplierName).toBe('供应商甲');
    expect(reloaded.projectName).toBe('项目甲');
  });

  it('supplierId/projectId 不存在时抛中文错', () => {
    expect(() => createInquiry(db, { supplierId: 9999, projectId, title: 'T', items: [] }))
      .toThrow('供应商 9999 不存在');
    expect(() => createInquiry(db, { supplierId, projectId: 9999, title: 'T', items: [] }))
      .toThrow('项目 9999 不存在');
  });
});

describe('listInquiries / getInquiry', () => {
  it('listInquiries 无 supplierId 时返回全部，按创建时间倒序；带 supplierId 时按供应商过滤', () => {
    const otherSupplierId = createSupplier(db, { name: '供应商乙' }).id;
    const a = createInquiry(db, { supplierId, projectId, title: 'A', items: [] });
    const b = createInquiry(db, { supplierId: otherSupplierId, projectId, title: 'B', items: [] });
    const all = listInquiries(db);
    expect(all.map(i => i.id).sort()).toEqual([a.id, b.id].sort());

    const onlyA = listInquiries(db, supplierId);
    expect(onlyA.map(i => i.id)).toEqual([a.id]);
  });

  it('getInquiry 返回不存在 id 为 null；行按 sort_order 排序', () => {
    expect(getInquiry(db, 9999)).toBeNull();
    const inq = createInquiry(db, {
      supplierId, projectId, title: 'T',
      items: [{ name: '第一行', unit: '台', qty: 1 }, { name: '第二行', unit: '台', qty: 1 }],
    });
    const reloaded = getInquiry(db, inq.id)!;
    expect(reloaded.items.map(i => i.name)).toEqual(['第一行', '第二行']);
  });
});

describe('deleteInquiry', () => {
  it('级联删除询价单行', () => {
    const inq = createInquiry(db, {
      supplierId, projectId, title: 'T',
      items: [{ name: 'A', unit: '台', qty: 1 }, { name: 'B', unit: '台', qty: 1 }],
    });
    const itemsBefore = db.prepare('SELECT COUNT(*) AS c FROM inquiry_items WHERE inquiry_id=?').get(inq.id) as any;
    expect(itemsBefore.c).toBe(2);

    deleteInquiry(db, inq.id);
    expect(getInquiry(db, inq.id)).toBeNull();
    const itemsAfter = db.prepare('SELECT COUNT(*) AS c FROM inquiry_items WHERE inquiry_id=?').get(inq.id) as any;
    expect(itemsAfter.c).toBe(0);
  });
});

describe('setInquiryItemReply', () => {
  it('设置回价并可清空为 null', () => {
    const inq = createInquiry(db, {
      supplierId, projectId, title: 'T', items: [{ productId, name: 'A', unit: '台', qty: 1 }],
    });
    const itemId = inq.items[0].id;
    const updated = setInquiryItemReply(db, itemId, 12345);
    expect(updated.replyPriceCents).toBe(12345);
    expect(getInquiry(db, inq.id)!.items[0].replyPriceCents).toBe(12345);

    const cleared = setInquiryItemReply(db, itemId, null);
    expect(cleared.replyPriceCents).toBeNull();
  });

  it('行不存在时抛中文错', () => {
    expect(() => setInquiryItemReply(db, 9999, 100)).toThrow('询价单行 9999 不存在');
  });
});

describe('writeReplyToPriceRecord', () => {
  it('成功：写入 price_records，source=supplier，supplierId 取询价单当前 supplier_id', () => {
    const inq = createInquiry(db, {
      supplierId, projectId, title: 'T', items: [{ productId, name: 'A', unit: '台', qty: 1 }],
    });
    const itemId = inq.items[0].id;
    setInquiryItemReply(db, itemId, 55000);
    const rec = writeReplyToPriceRecord(db, itemId);
    expect(rec.productId).toBe(productId);
    expect(rec.source).toBe('supplier');
    expect(rec.supplierId).toBe(supplierId);
    expect(rec.priceCents).toBe(55000);
    const records = listPriceRecords(db, productId);
    expect(records.some(r => r.id === rec.id)).toBe(true);
  });

  it('手工行（productId 为空）拒绝：「手工行无法写入价格记录」', () => {
    const inq = createInquiry(db, {
      supplierId, projectId, title: 'T', items: [{ name: '手工行', unit: '台', qty: 1 }],
    });
    const itemId = inq.items[0].id;
    setInquiryItemReply(db, itemId, 100);
    expect(() => writeReplyToPriceRecord(db, itemId)).toThrow('手工行无法写入价格记录');
  });

  it('无回价拒绝：「该行尚未填写回价，无法写入价格记录」', () => {
    const inq = createInquiry(db, {
      supplierId, projectId, title: 'T', items: [{ productId, name: 'A', unit: '台', qty: 1 }],
    });
    const itemId = inq.items[0].id;
    expect(() => writeReplyToPriceRecord(db, itemId)).toThrow('该行尚未填写回价，无法写入价格记录');
  });

  it('产品仍存在性校验：产品被删除后（product_id 因 ON DELETE SET NULL 置空）按手工行拒绝', () => {
    const inq = createInquiry(db, {
      supplierId, projectId, title: 'T', items: [{ productId, name: 'A', unit: '台', qty: 1 }],
    });
    const itemId = inq.items[0].id;
    setInquiryItemReply(db, itemId, 100);
    deleteProduct(db, productId);
    expect(() => writeReplyToPriceRecord(db, itemId)).toThrow('手工行无法写入价格记录');
  });

  it('产品仍存在性校验：product_id 残留指向不存在的产品（防御性）时拒绝', () => {
    const inq = createInquiry(db, {
      supplierId, projectId, title: 'T', items: [{ productId, name: 'A', unit: '台', qty: 1 }],
    });
    const itemId = inq.items[0].id;
    setInquiryItemReply(db, itemId, 100);
    // 绕过 API 直接伪造一个不存在的 product_id（模拟外键未生效等异常场景）；
    // 临时关闭 foreign_keys 使该 UPDATE 得以写入非法引用，随后恢复。
    db.pragma('foreign_keys = OFF');
    db.prepare('UPDATE inquiry_items SET product_id=? WHERE id=?').run(999999, itemId);
    db.pragma('foreign_keys = ON');
    expect(() => writeReplyToPriceRecord(db, itemId)).toThrow('产品已不存在，无法写入价格记录');
  });

  it('行不存在时抛中文错', () => {
    expect(() => writeReplyToPriceRecord(db, 9999)).toThrow('询价单行 9999 不存在');
  });
});
