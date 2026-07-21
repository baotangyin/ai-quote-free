import { describe, it, expect } from 'vitest';
import {
  triggerLabel,
  buildApplyItems,
  initialSelections,
  TRIGGER_TYPE_LABELS,
  DELETED_PRODUCT_NAME,
  type CandidateSelection
} from '../../src/renderer/src/rules-logic';
import type { CandidateItem } from '../../src/shared/api-types';

function candidate(overrides: Partial<CandidateItem>): CandidateItem {
  return {
    ruleId: 1,
    ruleName: '规则A',
    productId: 10,
    productName: '交换机',
    qty: 2,
    optional: false,
    note: null,
    formula: 'qty*2',
    ...overrides
  };
}

describe('triggerLabel', () => {
  it('formats category trigger', () => {
    expect(triggerLabel({ triggerType: 'category', triggerValue: '交换机' })).toBe('分类：交换机');
  });

  it('formats projectType trigger', () => {
    expect(triggerLabel({ triggerType: 'projectType', triggerValue: '展厅' })).toBe('项目类型：展厅');
  });

  it('formats product trigger with resolved name', () => {
    expect(triggerLabel({ triggerType: 'product', triggerValue: '42' }, '核心交换机')).toBe('具体产品：核心交换机');
  });

  it('falls back to id when product name is not resolvable', () => {
    expect(triggerLabel({ triggerType: 'product', triggerValue: '42' })).toBe('具体产品：42');
  });

  it('shows placeholder for empty value', () => {
    expect(triggerLabel({ triggerType: 'category', triggerValue: '' })).toBe('分类：(空)');
  });

  it('exposes trigger type labels', () => {
    expect(TRIGGER_TYPE_LABELS.category).toBe('分类');
    expect(TRIGGER_TYPE_LABELS.product).toBe('具体产品');
    expect(TRIGGER_TYPE_LABELS.projectType).toBe('项目类型');
  });
});

describe('initialSelections', () => {
  it('checks required by default and unchecks optional, qty from candidate', () => {
    const cands = [candidate({ optional: false, qty: 3 }), candidate({ optional: true, qty: 5 })];
    const sel = initialSelections(cands);
    expect(sel[0]).toEqual({ checked: true, qty: 3 });
    expect(sel[1]).toEqual({ checked: false, qty: 5 });
  });
});

describe('buildApplyItems', () => {
  it('maps only checked rows to payload', () => {
    const cands = [candidate({ productId: 10, qty: 2 }), candidate({ productId: 11, qty: 4 })];
    const sel: Record<number, CandidateSelection> = {
      0: { checked: true, qty: 2 },
      1: { checked: false, qty: 4 }
    };
    expect(buildApplyItems(cands, sel)).toEqual([{ productId: 10, qty: 2 }]);
  });

  it('uses edited qty over candidate qty', () => {
    const cands = [candidate({ productId: 10, qty: 2 })];
    const sel: Record<number, CandidateSelection> = { 0: { checked: true, qty: 9 } };
    expect(buildApplyItems(cands, sel)).toEqual([{ productId: 10, qty: 9 }]);
  });

  it('skips deleted products even if checked', () => {
    const cands = [candidate({ productId: 10, productName: DELETED_PRODUCT_NAME })];
    const sel: Record<number, CandidateSelection> = { 0: { checked: true, qty: 2 } };
    expect(buildApplyItems(cands, sel)).toEqual([]);
  });

  it('skips rows with non-positive or non-finite qty', () => {
    const cands = [
      candidate({ productId: 10 }),
      candidate({ productId: 11 }),
      candidate({ productId: 12 })
    ];
    const sel: Record<number, CandidateSelection> = {
      0: { checked: true, qty: 0 },
      1: { checked: true, qty: -1 },
      2: { checked: true, qty: NaN }
    };
    expect(buildApplyItems(cands, sel)).toEqual([]);
  });

  it('skips rows with no selection entry', () => {
    const cands = [candidate({ productId: 10 })];
    expect(buildApplyItems(cands, {})).toEqual([]);
  });
});
