import type { Db } from '../db/db';
import type { CostRule, LineItemSnapshot } from '../domain/types';
import { getEffectiveCost } from '../repo/prices';
import { getProduct } from '../repo/products';
import { createSpace, createLineItem } from '../repo/projects';
import { takeSnapshot } from '../domain/snapshot';

export interface ApplyDrawingItem {
  name: string;
  qty: number;
  remark: string | null;
  productId: number | null;
}

export interface ApplyDrawingSpace {
  name: string;
  items: ApplyDrawingItem[];
}

function manualSnapshot(name: string): LineItemSnapshot {
  return {
    name,
    brand: null,
    model: null,
    recommendedBrands: [],
    paramsCore: null,
    paramsBid: null,
    paramsTender: null,
    unit: '台',
    dims: null,
    power220W: 0,
    power380W: 0,
    rackU: 0,
    seqPowerPorts: 0,
    netPorts: 0,
    comPorts: 0,
    costUnitCents: 0,
    optionsApplied: [],
  };
}

/**
 * 将图纸识别结果落库到指定板块：每个空间建一个 Space（默认非置底，自然排在已有置底空间之前），
 * 空间下每个 item 建一行 LineItem——有 productId 且产品未删时按产品快照（成本取 getEffectiveCost，
 * 取不到时为 0），否则（productId 为 null 或产品已删）降级为手工行快照。整体在一个事务内完成。
 */
export function applyDrawingToSection(
  db: Db,
  sectionId: number,
  spaces: ApplyDrawingSpace[],
  costRule: CostRule,
): { spaces: number; items: number } {
  const section = db.prepare('SELECT id FROM sections WHERE id=?').get(sectionId);
  if (!section) throw new Error(`板块 ${sectionId} 不存在`);

  const run = db.transaction(() => {
    let itemCount = 0;
    for (const space of spaces) {
      const createdSpace = createSpace(db, { sectionId, name: space.name });
      for (const item of space.items) {
        const product = item.productId != null ? getProduct(db, item.productId) : null;
        if (product) {
          const cost = getEffectiveCost(db, product.id, costRule) ?? 0;
          const snapshot = takeSnapshot(product, cost);
          createLineItem(db, {
            spaceId: createdSpace.id,
            productId: product.id,
            snapshot,
            qty: item.qty,
            remark: item.remark ?? undefined,
          });
        } else {
          createLineItem(db, {
            spaceId: createdSpace.id,
            snapshot: manualSnapshot(item.name),
            qty: item.qty,
            remark: item.remark ?? undefined,
          });
        }
        itemCount++;
      }
    }
    return { spaces: spaces.length, items: itemCount };
  });

  return run();
}
