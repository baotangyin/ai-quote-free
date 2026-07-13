import type { Db } from '../db/db';
import type { Product, ProductOption, LineItem, LineItemSnapshot, CostRule, Cents } from './types';
import { getEffectiveCost } from '../repo/prices';
import { getProduct } from '../repo/products';
import { getLineItem, updateLineItem } from '../repo/projects';
import { getActiveLineItemCost } from '../repo/lineItemCosts';

/**
 * 选配联动：勾选的选配项非空时，在基础参数文本后追加每个选配项的描述——
 * 有 paramsText 的追加「\n选配：{name}（{paramsText}）」，没有的追加「\n选配：{name}」。
 * 未勾选任何选配项时原样返回，不改动基础参数（包括 null）。
 */
function appendOptionParams(base: string | null, optionsApplied: ProductOption[]): string | null {
  if (optionsApplied.length === 0) return base;
  let result = base ?? '';
  for (const o of optionsApplied) {
    result += o.paramsText ? `\n选配：${o.name}（${o.paramsText}）` : `\n选配：${o.name}`;
  }
  return result;
}

export function takeSnapshot(product: Product, costUnitCents: Cents, optionsApplied: ProductOption[] = []): LineItemSnapshot {
  const optionTotal = optionsApplied.reduce((s, o) => s + o.addPriceCents, 0);
  return {
    name: product.name, brand: product.brand, model: product.model,
    recommendedBrands: [...product.recommendedBrands],
    paramsCore: appendOptionParams(product.paramsCore, optionsApplied),
    paramsBid: appendOptionParams(product.paramsBid, optionsApplied),
    paramsTender: appendOptionParams(product.paramsTender, optionsApplied),
    unit: product.unit, dims: product.dims,
    power220W: product.power220W, power380W: product.power380W,
    rackU: product.rackU, seqPowerPorts: product.seqPowerPorts,
    netPorts: product.netPorts, comPorts: product.comPorts,
    costUnitCents: costUnitCents + optionTotal,
    optionsApplied: optionsApplied.map(o => ({ ...o })),
  };
}

export function isSnapshotStale(db: Db, item: LineItem, globalRule: CostRule): boolean {
  if (item.productId == null) return false;
  // 该行已选定生效候选成本（多供应商比价）：成本由用户主动选定，非产品库规则，不判定过期。
  if (getActiveLineItemCost(db, item.id)) return false;
  const current = getEffectiveCost(db, item.productId, globalRule);
  if (current == null) return false;
  const optionTotal = item.snapshot.optionsApplied.reduce((s, o) => s + o.addPriceCents, 0);
  return current + optionTotal !== item.snapshot.costUnitCents;
}

export function refreshSnapshot(db: Db, itemId: number, globalRule: CostRule): LineItem {
  const item = getLineItem(db, itemId);
  if (!item) throw new Error(`line item ${itemId} not found`);
  if (item.productId == null) return item;
  const product = getProduct(db, item.productId);
  if (!product) return item;
  // 存在生效候选成本时：刷新产品展示字段，但成本单价保留用户选定的候选成本，不被产品库规则覆盖。
  const active = getActiveLineItemCost(db, item.id);
  if (active) {
    const snap = takeSnapshot(product, 0, item.snapshot.optionsApplied);
    snap.costUnitCents = active.costUnitCents;
    return updateLineItem(db, itemId, { snapshot: snap });
  }
  const cost = getEffectiveCost(db, item.productId, globalRule);
  if (cost == null) return item;
  const snap = takeSnapshot(product, cost, item.snapshot.optionsApplied);
  return updateLineItem(db, itemId, { snapshot: snap });
}
