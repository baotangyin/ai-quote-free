import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, type Db } from '../../src/core/db/db';
import { createSupplier, listSuppliers, updateSupplier, deleteSupplier } from '../../src/core/repo/suppliers';

let db: Db;
beforeEach(() => { db = openDb(':memory:'); });

describe('suppliers repo', () => {
  it('creates and lists', () => {
    createSupplier(db, { name: '畅博视讯', contact: '张三' });
    createSupplier(db, { name: '迈创日新' });
    const all = listSuppliers(db);
    expect(all.map(s => s.name)).toEqual(['畅博视讯', '迈创日新']);
  });
  it('updates and deletes', () => {
    const s = createSupplier(db, { name: 'A' });
    const u = updateSupplier(db, s.id, { contact: '李四' });
    expect(u.contact).toBe('李四');
    deleteSupplier(db, s.id);
    expect(listSuppliers(db)).toHaveLength(0);
  });

  it('创建时可带 phone/address/paymentTerms/bankInfo，缺省为 null', () => {
    const s1 = createSupplier(db, { name: 'B' });
    expect(s1.phone).toBeNull();
    expect(s1.address).toBeNull();
    expect(s1.paymentTerms).toBeNull();
    expect(s1.bankInfo).toBeNull();

    const s2 = createSupplier(db, {
      name: 'C', phone: '13800000000', address: '某市某路1号',
      paymentTerms: '月结30天', bankInfo: '中国银行 6222xxxx'
    });
    expect(s2.phone).toBe('13800000000');
    expect(s2.address).toBe('某市某路1号');
    expect(s2.paymentTerms).toBe('月结30天');
    expect(s2.bankInfo).toBe('中国银行 6222xxxx');
  });

  it('更新 phone/address/paymentTerms/bankInfo', () => {
    const s = createSupplier(db, { name: 'D' });
    const u = updateSupplier(db, s.id, {
      phone: '13900000000', address: '新地址', paymentTerms: '现结', bankInfo: '工商银行 622xxxx'
    });
    expect(u.phone).toBe('13900000000');
    expect(u.address).toBe('新地址');
    expect(u.paymentTerms).toBe('现结');
    expect(u.bankInfo).toBe('工商银行 622xxxx');
  });
});
