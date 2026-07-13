import type { Db } from '../db/db';
import type { LineItem, BomRule } from './types';
import { getProduct } from '../repo/products';
import { getProject, getLineItem, listSections, listSpaces, listLineItems } from '../repo/projects';
import { listRulesByTrigger } from '../repo/rules';
import { techTotals } from './pricing';
import { evaluateFormula } from './formula';

/**
 * 构建规则公式求值上下文（扁平 Record<string,number>）。
 *
 * 行级变量（triggerItem 为 null 时全部为 0）：
 *   qty / area / power220 / power380 / power / netPorts / comPorts / rackU / seqPower
 * 项目级变量（遍历全项目清单行汇总）：
 *   projPower220 / projPower380 / projNetPorts / projComPorts / projRackU / projSeqPower / projItemCount
 *
 * area 取值：行 unit==='㎡' 时取该行 qty；否则取该行所属空间的 area（查不到或 null 取 0）。
 */
export function buildTriggerContext(db: Db, projectId: number, triggerItem: LineItem | null): Record<string, number> {
  const ctx: Record<string, number> = {
    qty: 0, area: 0,
    power220: 0, power380: 0, power: 0,
    netPorts: 0, comPorts: 0, rackU: 0, seqPower: 0,
    projPower220: 0, projPower380: 0, projNetPorts: 0, projComPorts: 0,
    projRackU: 0, projSeqPower: 0, projItemCount: 0,
  };

  if (triggerItem) {
    const snap = triggerItem.snapshot;
    const qty = triggerItem.qty;
    ctx.qty = qty;
    if (snap.unit === '㎡') {
      ctx.area = qty;
    } else {
      const row = db.prepare('SELECT area FROM spaces WHERE id=?').get(triggerItem.spaceId) as any;
      ctx.area = (row?.area ?? 0) as number;
    }
    ctx.power220 = snap.power220W * qty;
    ctx.power380 = snap.power380W * qty;
    ctx.power = ctx.power220 + ctx.power380;
    ctx.netPorts = snap.netPorts * qty;
    ctx.comPorts = snap.comPorts * qty;
    ctx.rackU = snap.rackU * qty;
    ctx.seqPower = snap.seqPowerPorts * qty;
  }

  // 项目级：收集全部清单行
  const allItems: LineItem[] = [];
  let projItemCount = 0;
  for (const section of listSections(db, projectId)) {
    for (const space of listSpaces(db, section.id)) {
      for (const it of listLineItems(db, space.id)) {
        allItems.push(it);
        projItemCount += it.qty;
      }
    }
  }
  const tech = techTotals(allItems);
  ctx.projPower220 = tech.power220W;
  ctx.projPower380 = tech.power380W;
  ctx.projNetPorts = tech.netPorts;
  ctx.projComPorts = tech.comPorts;
  ctx.projRackU = tech.rackU;
  ctx.projSeqPower = tech.seqPowerPorts;
  ctx.projItemCount = projItemCount;

  return ctx;
}

/** 规则命中后产生的候选配套项 */
export interface CandidateItem {
  ruleId: number;
  ruleName: string;
  productId: number;
  productName: string;
  qty: number;
  optional: boolean;
  note: string | null;
  formula: string;
}

/**
 * 对一条规则 + 一个上下文求值，产出候选配套项列表（保持动作顺序）。
 * - productId 为空的动作跳过（本期仅支持指向具体产品的动作）。
 * - 产品已删（getProduct=null）仍产出候选，productName='(产品已删)'。
 * - 公式抛错的动作被吞掉（跳过），不影响其他动作。
 * - qty 四舍五入到 4 位小数消除浮点噪声；qty<=0 跳过。是否取整由公式作者自行写 ceil()。
 */
function evaluateRuleActions(db: Db, rule: BomRule, context: Record<string, number>): CandidateItem[] {
  const out: CandidateItem[] = [];
  for (const action of rule.actions) {
    if (action.productId == null) continue;
    const product = getProduct(db, action.productId);
    const productName = product ? product.name : '(产品已删)';

    let qtyRaw: number;
    try {
      qtyRaw = evaluateFormula(action.qtyFormula, context);
    } catch {
      continue; // 公式非法/未知变量/除零等：跳过该动作
    }
    const qty = Math.round(qtyRaw * 10000) / 10000;
    if (qty <= 0) continue;

    out.push({
      ruleId: rule.id,
      ruleName: rule.name,
      productId: action.productId,
      productName,
      qty,
      optional: action.optional,
      note: action.note,
      formula: action.qtyFormula,
    });
  }
  return out;
}

/**
 * 按某清单行触发规则匹配，产出配套候选清单。
 * 匹配规则集合（去重，保持先 product 后 category 的顺序）：
 *   - product 触发：item.productId != null → listRulesByTrigger('product', String(productId))
 *   - category 触发：对该产品 categories 每个分类 → listRulesByTrigger('category', c)
 */
export function evaluateItemTrigger(db: Db, projectId: number, triggerItemId: number): CandidateItem[] {
  const item = getLineItem(db, triggerItemId);
  if (!item) throw new Error(`line item ${triggerItemId} not found`);

  const seen = new Set<number>();
  const rules: BomRule[] = [];
  const addRules = (rs: BomRule[]) => {
    for (const r of rs) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      rules.push(r);
    }
  };

  if (item.productId != null) {
    addRules(listRulesByTrigger(db, 'product', String(item.productId)));
    const product = getProduct(db, item.productId);
    if (product) {
      for (const c of product.categories) {
        addRules(listRulesByTrigger(db, 'category', c));
      }
    }
  }

  const context = buildTriggerContext(db, projectId, item);
  const candidates: CandidateItem[] = [];
  for (const rule of rules) {
    candidates.push(...evaluateRuleActions(db, rule, context));
  }
  return candidates;
}

/**
 * 按项目类型触发规则匹配，产出项目级配套候选清单。
 * project.projectType 为空 → []；否则 listRulesByTrigger('projectType', projectType) 求值。
 */
export function evaluateProjectTrigger(db: Db, projectId: number): CandidateItem[] {
  const project = getProject(db, projectId);
  if (!project) throw new Error(`project ${projectId} not found`);
  if (!project.projectType) return [];

  const rules: BomRule[] = listRulesByTrigger(db, 'projectType', project.projectType);
  const context = buildTriggerContext(db, projectId, null);
  const candidates: CandidateItem[] = [];
  for (const rule of rules) {
    candidates.push(...evaluateRuleActions(db, rule, context));
  }
  return candidates;
}
