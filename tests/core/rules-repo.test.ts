import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, type Db } from '../../src/core/db/db';
import {
  createRule, getRule, listRules, listRulesByTrigger, updateRule, deleteRule,
} from '../../src/core/repo/rules';
import type { RuleAction } from '../../src/core/domain/types';

let db: Db;
beforeEach(() => { db = openDb(':memory:'); });

describe('rules repo', () => {
  it('create + get round-trip: actions JSON, enabled defaults true, sort_order auto 0,1,2', () => {
    const actions: RuleAction[] = [
      { productId: 10, qtyFormula: 'area * 2', optional: false, note: '主设备' },
      { productId: null, qtyFormula: '1', optional: true, note: null },
    ];
    const r0 = createRule(db, { name: '规则A', triggerType: 'category', triggerValue: '多媒体', actions });
    const r1 = createRule(db, { name: '规则B', triggerType: 'product', triggerValue: '99' });
    const r2 = createRule(db, { name: '规则C', triggerType: 'projectType', triggerValue: '科技馆' });

    expect(r0.sortOrder).toBe(0);
    expect(r1.sortOrder).toBe(1);
    expect(r2.sortOrder).toBe(2);
    expect(r0.enabled).toBe(true);
    expect(r1.actions).toEqual([]);

    const back = getRule(db, r0.id)!;
    expect(back.name).toBe('规则A');
    expect(back.triggerType).toBe('category');
    expect(back.triggerValue).toBe('多媒体');
    expect(back.enabled).toBe(true);
    expect(back.actions).toEqual(actions);
    expect(back.actions[0].productId).toBe(10);
    expect(back.actions[0].optional).toBe(false);
    expect(back.actions[0].note).toBe('主设备');
    expect(back.actions[1].productId).toBeNull();
    expect(back.actions[1].optional).toBe(true);
    expect(back.actions[1].note).toBeNull();
  });

  it('getRule returns null when missing', () => {
    expect(getRule(db, 999)).toBeNull();
  });

  it('lists ordered by sortOrder', () => {
    createRule(db, { name: 'A', triggerType: 'category', triggerValue: 'x' });
    createRule(db, { name: 'B', triggerType: 'category', triggerValue: 'x' });
    createRule(db, { name: 'C', triggerType: 'category', triggerValue: 'x' });
    expect(listRules(db).map(r => r.name)).toEqual(['A', 'B', 'C']);
    expect(listRules(db).map(r => r.sortOrder)).toEqual([0, 1, 2]);
  });

  it('listRulesByTrigger returns only enabled and matching', () => {
    const enabled = createRule(db, { name: '启用', triggerType: 'category', triggerValue: '灯光' });
    createRule(db, { name: '停用', triggerType: 'category', triggerValue: '灯光', enabled: false });
    createRule(db, { name: '异值', triggerType: 'category', triggerValue: '音响' });
    createRule(db, { name: '异类', triggerType: 'product', triggerValue: '灯光' });

    const hits = listRulesByTrigger(db, 'category', '灯光');
    expect(hits.map(r => r.id)).toEqual([enabled.id]);
    expect(hits[0].name).toBe('启用');
  });

  it('update: name, enabled=false, actions replace, triggerValue', () => {
    const r = createRule(db, {
      name: '旧', triggerType: 'category', triggerValue: '旧值',
      actions: [{ productId: 1, qtyFormula: '1', optional: false, note: null }],
    });
    const newActions: RuleAction[] = [
      { productId: 2, qtyFormula: 'count', optional: true, note: '替换' },
    ];
    const u = updateRule(db, r.id, { name: '新', enabled: false, actions: newActions, triggerValue: '新值' });
    expect(u.name).toBe('新');
    expect(u.enabled).toBe(false);
    expect(u.triggerValue).toBe('新值');
    expect(u.actions).toEqual(newActions);
    // enabled=false should be excluded from listRulesByTrigger
    expect(listRulesByTrigger(db, 'category', '新值')).toHaveLength(0);
  });

  it('deletes', () => {
    const r = createRule(db, { name: 'D', triggerType: 'category', triggerValue: 'x' });
    deleteRule(db, r.id);
    expect(getRule(db, r.id)).toBeNull();
    expect(listRules(db)).toHaveLength(0);
  });
});
