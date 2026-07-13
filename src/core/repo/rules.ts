import type { Db } from '../db/db';
import { nowIso } from '../db/db';
import type { BomRule, RuleAction, RuleTriggerType } from '../domain/types';

const toRule = (r: any): BomRule => ({
  id: r.id, name: r.name, enabled: !!r.enabled,
  triggerType: r.trigger_type, triggerValue: r.trigger_value,
  actions: JSON.parse(r.actions), sortOrder: r.sort_order,
  createdAt: r.created_at, updatedAt: r.updated_at,
});

function nextSort(db: Db): number {
  const r = db.prepare('SELECT COALESCE(MAX(sort_order)+1, 0) AS n FROM bom_rules').get() as any;
  return r.n;
}

export function createRule(db: Db, input: {
  name: string; triggerType: RuleTriggerType; triggerValue: string;
  actions?: RuleAction[]; enabled?: boolean;
}): BomRule {
  const t = nowIso();
  const info = db.prepare(`INSERT INTO bom_rules
    (name, enabled, trigger_type, trigger_value, actions, sort_order, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?)`).run(
    input.name, (input.enabled ?? true) ? 1 : 0, input.triggerType, input.triggerValue,
    JSON.stringify(input.actions ?? []), nextSort(db), t, t);
  return getRule(db, Number(info.lastInsertRowid))!;
}

export function getRule(db: Db, id: number): BomRule | null {
  const r = db.prepare('SELECT * FROM bom_rules WHERE id=?').get(id);
  return r ? toRule(r) : null;
}

export function listRules(db: Db): BomRule[] {
  return db.prepare('SELECT * FROM bom_rules ORDER BY sort_order, id').all().map(toRule);
}

export function listRulesByTrigger(db: Db, triggerType: RuleTriggerType, triggerValue: string): BomRule[] {
  return db.prepare(`SELECT * FROM bom_rules
    WHERE enabled=1 AND trigger_type=? AND trigger_value=? ORDER BY sort_order`)
    .all(triggerType, triggerValue).map(toRule);
}

export function updateRule(db: Db, id: number, patch: Partial<{
  name: string; enabled: boolean; triggerType: RuleTriggerType;
  triggerValue: string; actions: RuleAction[]; sortOrder: number;
}>): BomRule {
  const cur = getRule(db, id);
  if (!cur) throw new Error(`bom rule ${id} not found`);
  const m = { ...cur, ...patch };
  db.prepare(`UPDATE bom_rules SET name=?, enabled=?, trigger_type=?, trigger_value=?,
    actions=?, sort_order=?, updated_at=? WHERE id=?`).run(
    m.name, m.enabled ? 1 : 0, m.triggerType, m.triggerValue,
    JSON.stringify(m.actions), m.sortOrder, nowIso(), id);
  return getRule(db, id)!;
}

export function deleteRule(db: Db, id: number): void {
  db.prepare('DELETE FROM bom_rules WHERE id=?').run(id);
}
