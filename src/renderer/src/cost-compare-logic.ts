import type { LineItemCost } from '../../shared/api-types';
import { yuanToCents } from './money';

/**
 * 在候选成本列表中查找当前生效项（isActive===true 的第一条）。
 * 纯函数，便于单测；无生效项时返回 undefined。
 */
export function findActive(costs: LineItemCost[]): LineItemCost | undefined {
  return costs.find((c) => c.isActive);
}

/**
 * 将「候选行成本单价（元，用户输入）」转换为 itemCostsUpdate 的补丁载荷（分）。
 * - 非有限数或 <0 视为无效，返回 null（调用方应跳过提交）；
 * - 与当前 costUnitCents 相等（无变化）也返回 null，避免无谓提交。
 */
export function costYuanToPatch(
  current: LineItemCost,
  yuan: number
): { costUnitCents: number } | null {
  if (!Number.isFinite(yuan) || yuan < 0) return null;
  const cents = yuanToCents(yuan);
  if (cents === current.costUnitCents) return null;
  return { costUnitCents: cents };
}
