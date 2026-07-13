import { describe, it, expect } from 'vitest';
import { yuanToCents, centsToYuan, fmtYuan, fmtWan, fmtByUnit } from '../../src/renderer/src/money';

describe('yuanToCents', () => {
  it('converts basic yuan to cents', () => {
    expect(yuanToCents(1)).toBe(100);
    expect(yuanToCents(10)).toBe(1000);
    expect(yuanToCents(100)).toBe(10000);
  });

  it('handles decimal yuan amounts', () => {
    expect(yuanToCents(1.5)).toBe(150);
    expect(yuanToCents(2.99)).toBe(299);
    expect(yuanToCents(0.01)).toBe(1);
  });

  it('handles 0.1 + 0.2 floating point precision', () => {
    // 0.1 + 0.2 = 0.30000000000000004 in JavaScript
    const result = yuanToCents(0.1 + 0.2);
    expect(result).toBe(30);
  });

  it('handles negative amounts', () => {
    expect(yuanToCents(-1)).toBe(-100);
    expect(yuanToCents(-1.5)).toBe(-150);
    expect(yuanToCents(-0.01)).toBe(-1);
  });

  it('accepts string input', () => {
    expect(yuanToCents('1')).toBe(100);
    expect(yuanToCents('10.5')).toBe(1050);
    expect(yuanToCents('0.01')).toBe(1);
    expect(yuanToCents('-5.99')).toBe(-599);
  });

  it('rounds correctly using Math.round', () => {
    // Note: 1.005 * 100 = 100.49999999999999 due to floating point, rounds to 100
    expect(yuanToCents(1.005)).toBe(100);
    expect(yuanToCents(1.994)).toBe(199); // 199.4 rounds to 199
    expect(yuanToCents(2)).toBe(200); // 200 rounds to 200
  });

  it('throws on invalid string input', () => {
    expect(() => yuanToCents('abc')).toThrow();
    expect(() => yuanToCents('12abc')).toThrow();
    expect(() => yuanToCents('')).toThrow();
  });

  it('throws on NaN', () => {
    expect(() => yuanToCents(NaN)).toThrow();
  });

  it('handles zero', () => {
    expect(yuanToCents(0)).toBe(0);
    expect(yuanToCents('0')).toBe(0);
  });

  it('handles large amounts', () => {
    expect(yuanToCents(1000000)).toBe(100000000);
    expect(yuanToCents('999999.99')).toBe(99999999);
  });

  it('rejects null/undefined/Infinity', () => {
    expect(() => yuanToCents(null as any)).toThrow();
    expect(() => yuanToCents(undefined as any)).toThrow();
    expect(() => yuanToCents(Infinity)).toThrow();
    expect(() => yuanToCents(-Infinity)).toThrow();
  });

  it('spec example: -0.005 rounds to -0 (round-half-to-positive-infinity)', () => {
    // Math.round(-0.5) === -0 in JS, so -0.005 yuan -> -0.5 cents -> -0 cents
    expect(yuanToCents('-0.005')).toBe(-0);
  });
});

describe('centsToYuan', () => {
  it('converts basic cents to yuan', () => {
    expect(centsToYuan(100)).toBe(1);
    expect(centsToYuan(1000)).toBe(10);
    expect(centsToYuan(10000)).toBe(100);
  });

  it('converts partial cents to yuan decimals', () => {
    expect(centsToYuan(150)).toBe(1.5);
    expect(centsToYuan(299)).toBe(2.99);
    expect(centsToYuan(1)).toBe(0.01);
  });

  it('handles negative amounts', () => {
    expect(centsToYuan(-100)).toBe(-1);
    expect(centsToYuan(-150)).toBe(-1.5);
    expect(centsToYuan(-1)).toBe(-0.01);
  });

  it('handles zero', () => {
    expect(centsToYuan(0)).toBe(0);
  });

  it('handles large amounts', () => {
    expect(centsToYuan(100000000)).toBe(1000000);
    expect(centsToYuan(99999999)).toBe(999999.99);
  });
});

describe('fmtYuan', () => {
  it('formats basic amounts with 2 decimals', () => {
    expect(fmtYuan(100)).toBe('1.00');
    expect(fmtYuan(1000)).toBe('10.00');
    expect(fmtYuan(10000)).toBe('100.00');
  });

  it('adds thousands separator for large amounts', () => {
    expect(fmtYuan(100000)).toBe('1,000.00');
    expect(fmtYuan(1000000)).toBe('10,000.00');
    expect(fmtYuan(10000000)).toBe('100,000.00');
    expect(fmtYuan(100000000)).toBe('1,000,000.00');
  });

  it('formats partial yuan correctly', () => {
    expect(fmtYuan(150)).toBe('1.50');
    expect(fmtYuan(299)).toBe('2.99');
    expect(fmtYuan(1)).toBe('0.01');
  });

  it('handles negative amounts', () => {
    expect(fmtYuan(-100)).toBe('-1.00');
    expect(fmtYuan(-150)).toBe('-1.50');
    expect(fmtYuan(-100000)).toBe('-1,000.00');
  });

  it('handles zero', () => {
    expect(fmtYuan(0)).toBe('0.00');
  });

  it('handles large amounts', () => {
    expect(fmtYuan(9999999999)).toBe('99,999,999.99');
  });

  it('spec example: fmtYuan(123456789)', () => {
    expect(fmtYuan(123456789)).toBe('1,234,567.89');
  });
});

describe('fmtWan', () => {
  it('formats amounts in 万元 (ten thousand yuan)', () => {
    // 1M cents = 10,000 yuan = 1万元
    expect(fmtWan(1000000)).toBe('1.00万元');
    // 10M cents = 100,000 yuan = 10万元
    expect(fmtWan(10000000)).toBe('10.00万元');
  });

  it('formats basic amounts', () => {
    // 100,000 cents = 1,000 yuan = 0.10万元
    expect(fmtWan(100000)).toBe('0.10万元');
    // 1M cents = 10,000 yuan = 1.00万元
    expect(fmtWan(1000000)).toBe('1.00万元');
    // 10M cents = 100,000 yuan = 10.00万元
    expect(fmtWan(10000000)).toBe('10.00万元');
  });

  it('handles zero', () => {
    expect(fmtWan(0)).toBe('0.00万元');
  });

  it('handles negative amounts', () => {
    // -1M cents = -10,000 yuan = -1.00万元
    expect(fmtWan(-1000000)).toBe('-1.00万元');
    // -10M cents = -100,000 yuan = -10.00万元
    expect(fmtWan(-10000000)).toBe('-10.00万元');
  });

  it('handles large amounts', () => {
    // 100M cents = 1M yuan = 100.00万元
    expect(fmtWan(100000000)).toBe('100.00万元');
    // 500M cents = 5M yuan = 500.00万元
    expect(fmtWan(500000000)).toBe('500.00万元');
  });

  it('displays with thousands separator for wan part', () => {
    // 100M cents = 1M yuan = 100.00万元
    expect(fmtWan(100000000)).toBe('100.00万元');
    // 1B cents = 10M yuan = 1,000.00万元
    expect(fmtWan(1000000000)).toBe('1,000.00万元');
    // 10B cents = 100M yuan = 10,000.00万元
    expect(fmtWan(10000000000)).toBe('10,000.00万元');
  });

  it('does not show negative sign for amounts rounding to zero', () => {
    expect(fmtWan(-1)).toBe('0.00万元');
    expect(fmtWan(-4999)).toBe('0.00万元');
    expect(fmtWan(-50000)).toBe('-0.05万元');
  });
});

describe('fmtByUnit', () => {
  it('formats with fmtYuan when unit is 元', () => {
    expect(fmtByUnit(100, '元')).toBe('1.00');
    expect(fmtByUnit(100000, '元')).toBe('1,000.00');
    expect(fmtByUnit(0, '元')).toBe('0.00');
  });

  it('formats with fmtWan when unit is 万元', () => {
    expect(fmtByUnit(1000000, '万元')).toBe('1.00万元');
    expect(fmtByUnit(100000000, '万元')).toBe('100.00万元');
    expect(fmtByUnit(0, '万元')).toBe('0.00万元');
  });

  it('agrees with fmtYuan and fmtWan for the same amount', () => {
    const cents = 123456789;
    expect(fmtByUnit(cents, '元')).toBe(fmtYuan(cents));
    expect(fmtByUnit(cents, '万元')).toBe(fmtWan(cents));
  });
});
