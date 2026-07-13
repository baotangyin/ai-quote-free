import type { Db } from '../db/db';
import { nowIso } from '../db/db';
import type { LineItem, CostRule } from '../domain/types';
import { getLineItem } from './projects';
import { getProduct } from './products';
import { getEffectiveCost } from './prices';
import { takeSnapshot } from '../domain/snapshot';

/**
 * 清单行「换产品」：用新产品 + 生效成本价（costRule，取不到按 0 处理）重建快照，
 * optionNames 命中新产品 options[].name 的作为 optionsApplied 传入 takeSnapshot（未命中忽略）。
 * 事务内：保留 qty/remark/marginOverride/sortOrder（本函数不改动这些列）；
 * 清除 manualUnitPriceCents（置 null，旧值对新产品无意义）与该行全部候选成本 line_item_costs
 * （DELETE，避免残留指向旧产品供应商的候选）。产品不存在抛中文错误。
 */
export function replaceLineItemProduct(
  db: Db, itemId: number, productId: number, optionNames: string[], costRule: CostRule,
): LineItem {
  const run = db.transaction(() => {
    const item = getLineItem(db, itemId);
    if (!item) throw new Error(`line item ${itemId} not found`);
    const product = getProduct(db, productId);
    if (!product) throw new Error(`产品 ${productId} 不存在`);

    const cost = getEffectiveCost(db, productId, costRule) ?? 0;
    const optionsApplied = product.options.filter((o) => optionNames.includes(o.name));
    const snapshot = takeSnapshot(product, cost, optionsApplied);

    db.prepare(`UPDATE line_items SET product_id=?, snapshot=?, manual_unit_price_cents=NULL, updated_at=? WHERE id=?`)
      .run(productId, JSON.stringify(snapshot), nowIso(), itemId);
    db.prepare('DELETE FROM line_item_costs WHERE line_item_id=?').run(itemId);

    return getLineItem(db, itemId)!;
  });
  return run();
}
