import type { Db } from '../db/db';
import type { Project } from '../domain/types';
import {
  getProject, createProject, listSections, createSection,
  listSpaces, createSpace, listLineItems, createLineItem,
} from './projects';
import { listLineItemCosts, createLineItemCost, setActiveCost } from './lineItemCosts';
import {
  listEstimateCategories, createEstimateCategory,
  listEstimateRows, createEstimateRow,
} from './estimate';

/**
 * 深复制一个项目：板块 / 空间 / 清单行 / 候选成本（含生效候选）/ 概算大类与行全部克隆到新项目。
 * 新项目名称追加「 副本」，status 自然为 draft。概算 sectionRef 行的 refSectionId 若指向本项目板块，
 * 按 旧→新 板块映射改写；映射不到则置 null。整个过程包裹在单个事务中。
 */
export function duplicateProject(db: Db, projectId: number): Project {
  const orig = getProject(db, projectId);
  if (!orig) throw new Error(`project ${projectId} not found`);

  const run = db.transaction(() => {
    const created = createProject(db, {
      name: `${orig.name} 副本`,
      client: orig.client ?? undefined,
      projectType: orig.projectType,
      mode: orig.mode,
      defaultMargin: orig.defaultMargin,
      roundRule: orig.roundRule,
    });

    const sectionMap = new Map<number, number>();
    for (const sec of listSections(db, orig.id)) {
      const newSec = createSection(db, {
        projectId: created.id,
        name: sec.name,
        integrationFeeRate: sec.integrationFeeRate,
        isHardware: sec.isHardware,
        subtotalLabel: sec.subtotalLabel,
        feeLabel: sec.feeLabel,
        linkSpaces: sec.linkSpaces,
      });
      sectionMap.set(sec.id, newSec.id);

      for (const sp of listSpaces(db, sec.id)) {
        const newSp = createSpace(db, {
          sectionId: newSec.id,
          name: sp.name,
          description: sp.description ?? undefined,
          area: sp.area ?? undefined,
          pinBottom: sp.pinBottom,
        });

        for (const it of listLineItems(db, sp.id)) {
          const newItem = createLineItem(db, {
            spaceId: newSp.id,
            productId: it.productId ?? undefined,
            snapshot: it.snapshot,
            qty: it.qty,
            marginOverride: it.marginOverride ?? undefined,
            manualUnitPriceCents: it.manualUnitPriceCents ?? undefined,
            remark: it.remark ?? undefined,
            imagePath: it.imagePath ?? undefined,
          });

          let newActiveCostId: number | null = null;
          for (const cost of listLineItemCosts(db, it.id)) {
            const newCost = createLineItemCost(db, {
              lineItemId: newItem.id,
              costUnitCents: cost.costUnitCents,
              supplierId: cost.supplierId,
              supplierName: cost.supplierName,
              brand: cost.brand,
              model: cost.model,
              note: cost.note,
            });
            if (cost.isActive) newActiveCostId = newCost.id;
          }
          if (newActiveCostId != null) setActiveCost(db, newActiveCostId);
        }
      }
    }

    for (const cat of listEstimateCategories(db, orig.id)) {
      const newCat = createEstimateCategory(db, { projectId: created.id, name: cat.name });
      for (const row of listEstimateRows(db, cat.id)) {
        const remappedRef = row.refSectionId != null
          ? (sectionMap.get(row.refSectionId) ?? null)
          : null;
        createEstimateRow(db, {
          categoryId: newCat.id,
          name: row.name,
          valueMethod: row.valueMethod,
          manualAmountCents: row.manualAmountCents,
          coefBaseCents: row.coefBaseCents,
          coefFactor: row.coefFactor,
          refSectionId: remappedRef,
          remark: row.remark,
        });
      }
    }

    return created.id;
  });

  const newId = run();
  return getProject(db, newId)!;
}
