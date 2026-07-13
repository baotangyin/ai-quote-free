import { describe, it, expect } from 'vitest';
import { findActive, costYuanToPatch } from '../../src/renderer/src/cost-compare-logic';
import type { LineItemCost } from '../../src/shared/api-types';

function cost(overrides: Partial<LineItemCost>): LineItemCost {
  return {
    id: 1,
    lineItemId: 100,
    supplierId: null,
    supplierName: null,
    brand: null,
    model: null,
    costUnitCents: 10000,
    isActive: false,
    note: null,
    sortOrder: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  };
}

describe('findActive', () => {
  it('returns the active cost', () => {
    const costs = [cost({ id: 1 }), cost({ id: 2, isActive: true }), cost({ id: 3 })];
    expect(findActive(costs)?.id).toBe(2);
  });

  it('returns the first active when multiple are active', () => {
    const costs = [cost({ id: 1, isActive: true }), cost({ id: 2, isActive: true })];
    expect(findActive(costs)?.id).toBe(1);
  });

  it('returns undefined when none active', () => {
    expect(findActive([cost({ id: 1 }), cost({ id: 2 })])).toBeUndefined();
  });

  it('returns undefined for empty list', () => {
    expect(findActive([])).toBeUndefined();
  });
});

describe('costYuanToPatch', () => {
  it('converts yuan to cents patch when changed', () => {
    const c = cost({ costUnitCents: 10000 });
    expect(costYuanToPatch(c, 123.45)).toEqual({ costUnitCents: 12345 });
  });

  it('returns null when value is unchanged', () => {
    const c = cost({ costUnitCents: 10000 });
    expect(costYuanToPatch(c, 100)).toBeNull();
  });

  it('returns null for negative input', () => {
    expect(costYuanToPatch(cost({}), -1)).toBeNull();
  });

  it('returns null for non-finite input', () => {
    expect(costYuanToPatch(cost({}), NaN)).toBeNull();
    expect(costYuanToPatch(cost({}), Infinity)).toBeNull();
  });

  it('rounds to nearest cent', () => {
    const c = cost({ costUnitCents: 0 });
    expect(costYuanToPatch(c, 0.005)).toEqual({ costUnitCents: 1 });
  });
});
