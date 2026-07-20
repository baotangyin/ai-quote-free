import type { Supplier, EstimateNorm, BomRule, RuleTriggerType } from '../../../shared/api-types';

/** 供应商筛选条件（持久化至 localStorage）。 */
export interface SupplierFilter {
  keyword: string;
}

/** 概算指标筛选条件（持久化至 localStorage）。 */
export interface EstimateNormFilter {
  keyword: string;
}

/** 规则筛选条件（持久化至 localStorage）。 */
export interface RuleFilter {
  triggerTypes: RuleTriggerType[];
  keyword: string;
}

export const EMPTY_SUPPLIER_FILTER: SupplierFilter = { keyword: '' };
export const EMPTY_ESTIMATE_NORM_FILTER: EstimateNormFilter = { keyword: '' };
export const EMPTY_RULE_FILTER: RuleFilter = { triggerTypes: [], keyword: '' };

/** 关键词匹配供应商：命中名称或联系人（忽略大小写、字段可空容错）。 */
export function matchSupplierFilter(s: Supplier, filter: SupplierFilter): boolean {
  const kw = filter.keyword.trim().toLowerCase();
  if (!kw) return true;
  const inName = (s.name ?? '').toLowerCase().includes(kw);
  const inContact = (s.contact ?? '').toLowerCase().includes(kw);
  return inName || inContact;
}

/** 关键词匹配概算指标：命中项目类型/空间类型/备注（忽略大小写、字段可空容错）。 */
export function matchEstimateNormFilter(n: EstimateNorm, filter: EstimateNormFilter): boolean {
  const kw = filter.keyword.trim().toLowerCase();
  if (!kw) return true;
  const inProject = (n.projectType ?? '').toLowerCase().includes(kw);
  const inSpace = (n.spaceType ?? '').toLowerCase().includes(kw);
  const inNote = (n.note ?? '').toLowerCase().includes(kw);
  return inProject || inSpace || inNote;
}

/** 触发类型多选 + 关键词匹配规则名（忽略大小写）组合 AND。 */
export function matchRuleFilter(r: BomRule, filter: RuleFilter): boolean {
  if (filter.triggerTypes.length > 0 && !filter.triggerTypes.includes(r.triggerType)) return false;
  const kw = filter.keyword.trim().toLowerCase();
  if (kw && !(r.name ?? '').toLowerCase().includes(kw)) return false;
  return true;
}
