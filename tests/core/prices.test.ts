import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, type Db } from '../../src/core/db/db';
import { createProduct } from '../../src/core/repo/products';
import { createSupplier } from '../../src/core/repo/suppliers';
import { addPriceRecord, listPriceRecords, getEffectiveCost } from '../../src/core/repo/prices';

let db: Db; let pid: number; let s1: number; let s2: number;
beforeEach(() => {
  db = openDb(':memory:');
  pid = createProduct(db, { category: '拼接屏', name: '55寸拼接屏', unit: '台' }).id;
  s1 = createSupplier(db, { name: '畅博' }).id;
  s2 = createSupplier(db, { name: '迈创' }).id;
  addPriceRecord(db, { productId: pid, source: 'supplier', supplierId: s1, priceCents: 220000, capturedAt: '2026-01-01' });
  addPriceRecord(db, { productId: pid, source: 'supplier', supplierId: s2, priceCents: 210000, capturedAt: '2026-02-01' });
  addPriceRecord(db, { productId: pid, source: 'ai_search', priceCents: 230000, capturedAt: '2026-03-01' });
});

describe('effective cost', () => {
  it('lowest picks minimum', () => {
    expect(getEffectiveCost(db, pid, 'lowest')).toBe(210000);
  });
  it('latest picks newest capturedAt', () => {
    expect(getEffectiveCost(db, pid, 'latest')).toBe(230000);
  });
  it('supplier rule picks that supplier newest', () => {
    expect(getEffectiveCost(db, pid, `supplier:${s1}`)).toBe(220000);
  });
  it('product override beats global rule', () => {
    db.prepare('UPDATE products SET cost_rule_override=? WHERE id=?').run(`supplier:${s2}`, pid);
    expect(getEffectiveCost(db, pid, 'lowest')).toBe(210000);
  });
  it('null when no records', () => {
    const p2 = createProduct(db, { category: 'X', name: 'Y', unit: '台' }).id;
    expect(getEffectiveCost(db, p2, 'lowest')).toBeNull();
  });
  it('lists newest first', () => {
    const rs = listPriceRecords(db, pid);
    expect(rs[0].priceCents).toBe(230000);
    expect(rs).toHaveLength(3);
  });
});
