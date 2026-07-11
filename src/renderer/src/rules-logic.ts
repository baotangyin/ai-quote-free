import type { BomRule, CandidateItem, RuleTriggerType } from '../../shared/api-types';

/** 触发类型的中文文案。 */
export const TRIGGER_TYPE_LABELS: Record<RuleTriggerType, string> = {
  category: '分类',
  product: '具体产品',
  projectType: '项目类型'
};

/** 已删除产品在候选项中的占位名称（与 core/domain/rules-engine.ts 保持一致）。 */
export const DELETED_PRODUCT_NAME = '(产品已删)';

/**
 * 生成规则触发条件的可读文案，如「分类：交换机」「具体产品：核心交换机」「项目类型：展厅」。
 * - triggerType==='product' 时，triggerValue 存的是产品 id 字符串；若能通过 productName 解析出名称则展示名称，否则回退展示 id。
 */
export function triggerLabel(
  rule: Pick<BomRule, 'triggerType' | 'triggerValue'>,
  productName?: string | null
): string {
  const typeLabel = TRIGGER_TYPE_LABELS[rule.triggerType] ?? rule.triggerType;
  let valueLabel = rule.triggerValue;
  if (rule.triggerType === 'product' && productName) valueLabel = productName;
  if (!valueLabel) valueLabel = '(空)';
  return `${typeLabel}：${valueLabel}`;
}

/** 配套面板中每一候选行的用户选择状态。 */
export interface CandidateSelection {
  checked: boolean;
  qty: number;
}

/**
 * 将「候选项 + 勾选状态」映射为 rulesApply 的 items 载荷（纯函数，便于单测）。
 * 过滤规则：
 * - 未勾选的行跳过；
 * - 指向已删产品（productName===DELETED_PRODUCT_NAME）的行跳过（不可加入）；
 * - qty 非有限数或 <=0 跳过。
 * selections 以候选数组下标为键。
 */
export function buildApplyItems(
  candidates: CandidateItem[],
  selections: Record<number, CandidateSelection>
): { productId: number; qty: number }[] {
  const out: { productId: number; qty: number }[] = [];
  candidates.forEach((c, idx) => {
    const sel = selections[idx];
    if (!sel || !sel.checked) return;
    if (c.productName === DELETED_PRODUCT_NAME) return;
    const qty = sel.qty;
    if (!Number.isFinite(qty) || qty <= 0) return;
    out.push({ productId: c.productId, qty });
  });
  return out;
}

/**
 * 依据候选项默认勾选策略生成初始选择状态：必选默认勾选、可选默认不勾选，数量取候选 qty。
 */
export function initialSelections(candidates: CandidateItem[]): Record<number, CandidateSelection> {
  const out: Record<number, CandidateSelection> = {};
  candidates.forEach((c, idx) => {
    out[idx] = { checked: !c.optional, qty: c.qty };
  });
  return out;
}
