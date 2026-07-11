import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, type Db } from '../../src/core/db/db';
import { createProduct } from '../../src/core/repo/products';
import { addPriceRecord } from '../../src/core/repo/prices';
import { takeSnapshot } from '../../src/core/domain/snapshot';
import {
  createProject, getProject, createSection, listSections,
  createSpace, listSpaces, createLineItem, listLineItems,
} from '../../src/core/repo/projects';
import {
  createLineItemCost, listLineItemCosts, setActiveCost, getActiveLineItemCost,
} from '../../src/core/repo/lineItemCosts';
import {
  createEstimateCategory, listEstimateCategories,
  createEstimateRow, listEstimateRows,
} from '../../src/core/repo/estimate';
import { duplicateProject } from '../../src/core/repo/projectDuplicate';
import type { Product } from '../../src/core/domain/types';

let db: Db;

function snapOf(p: Product, costUnitCents: number) {
  return takeSnapshot(p, costUnitCents, []);
}

/** 建一个含两板块/空间/清单行/候选成本/概算大类行的完整项目，返回相关 id。 */
function buildProject() {
  const prodA = createProduct(db, { category: '触摸屏', name: '一体机', unit: '台', brand: '牌A', model: 'M1' });
  const prodB = createProduct(db, { category: '音响', name: '音箱', unit: '只', brand: '牌B', model: 'M2' });
  addPriceRecord(db, { productId: prodA.id, source: 'manual', priceCents: 30000 });

  const pj = createProject(db, { name: '样板工程', client: '甲方', projectType: '展厅', mode: 'budget', defaultMargin: 1.5, roundRule: 'ten' });
  const sec1 = createSection(db, {
    projectId: pj.id, name: '硬件板块', integrationFeeRate: 0.05, isHardware: true,
    subtotalLabel: '设备小计', feeLabel: '集成费', linkSpaces: true,
  });
  const sec2 = createSection(db, { projectId: pj.id, name: '软件板块', integrationFeeRate: 0, isHardware: false });

  const sp1 = createSpace(db, { sectionId: sec1.id, name: '序厅', description: '入口', area: 100 });
  const sp2 = createSpace(db, { sectionId: sec2.id, name: '主厅' });

  const it1 = createLineItem(db, { spaceId: sp1.id, productId: prodA.id, snapshot: snapOf(prodA, 30000), qty: 2, remark: '备注1' });
  createLineItem(db, { spaceId: sp1.id, snapshot: snapOf(prodB, 12000), qty: 1 });
  createLineItem(db, { spaceId: sp2.id, productId: prodB.id, snapshot: snapOf(prodB, 12000), qty: 3 });

  // it1 加两条候选成本并生效第二条
  createLineItemCost(db, { lineItemId: it1.id, costUnitCents: 30000, supplierName: '供X', brand: '牌A', model: 'M1' });
  const cB = createLineItemCost(db, { lineItemId: it1.id, costUnitCents: 27000, supplierName: '供Y' });
  setActiveCost(db, cB.id);

  // 概算大类 + 行（含一个引用 sec1 的 sectionRef 行）
  const cat = createEstimateCategory(db, { projectId: pj.id, name: '工程费' });
  createEstimateRow(db, { categoryId: cat.id, name: '手填项', valueMethod: 'manual', manualAmountCents: 500000 });
  createEstimateRow(db, { categoryId: cat.id, name: '引用板块', valueMethod: 'sectionRef', refSectionId: sec1.id });

  return { pj, sec1, sec2, it1 };
}

beforeEach(() => { db = openDb(':memory:'); });

describe('duplicateProject', () => {
  it('throws for missing project', () => {
    expect(() => duplicateProject(db, 9999)).toThrow('project 9999 not found');
  });

  it('deep-copies project structure with new ids, 副本 name, draft status', () => {
    const { pj } = buildProject();
    const dup = duplicateProject(db, pj.id);

    expect(dup.id).not.toBe(pj.id);
    expect(dup.name).toContain('副本');
    expect(dup.name).toBe('样板工程 副本');
    expect(dup.status).toBe('draft');
    expect(dup.client).toBe('甲方');
    expect(dup.projectType).toBe('展厅');
    expect(dup.mode).toBe('budget');
    expect(dup.defaultMargin).toBe(1.5);
    expect(dup.roundRule).toBe('ten');

    // sections
    const origSecs = listSections(db, pj.id);
    const newSecs = listSections(db, dup.id);
    expect(newSecs).toHaveLength(origSecs.length);
    expect(newSecs.map(s => s.name)).toEqual(origSecs.map(s => s.name));
    expect(newSecs[0].integrationFeeRate).toBe(0.05);
    expect(newSecs[0].isHardware).toBe(true);
    expect(newSecs[1].isHardware).toBe(false);
    // subtotalLabel/feeLabel/linkSpaces 深复制时应随板块转发保留
    expect(newSecs[0].subtotalLabel).toBe('设备小计');
    expect(newSecs[0].feeLabel).toBe('集成费');
    expect(newSecs[0].linkSpaces).toBe(true);
    expect(newSecs[1].subtotalLabel).toBeNull();
    expect(newSecs[1].feeLabel).toBeNull();
    expect(newSecs[1].linkSpaces).toBe(false);
    // new sections belong to the new project and have distinct ids
    expect(newSecs.every(s => s.projectId === dup.id)).toBe(true);
    expect(newSecs.every(s => !origSecs.some(o => o.id === s.id))).toBe(true);

    // spaces + line items count per section
    for (let i = 0; i < origSecs.length; i++) {
      const oSpaces = listSpaces(db, origSecs[i].id);
      const nSpaces = listSpaces(db, newSecs[i].id);
      expect(nSpaces).toHaveLength(oSpaces.length);
      expect(nSpaces.map(s => s.name)).toEqual(oSpaces.map(s => s.name));
      for (let j = 0; j < oSpaces.length; j++) {
        const oItems = listLineItems(db, oSpaces[j].id);
        const nItems = listLineItems(db, nSpaces[j].id);
        expect(nItems).toHaveLength(oItems.length);
        expect(nItems.map(x => x.snapshot.name)).toEqual(oItems.map(x => x.snapshot.name));
        expect(nItems.map(x => x.qty)).toEqual(oItems.map(x => x.qty));
      }
    }
  });

  it('copies line_item_costs preserving active candidate', () => {
    const { pj, it1 } = buildProject();
    const dup = duplicateProject(db, pj.id);

    const newSecs = listSections(db, dup.id);
    const sp = listSpaces(db, newSecs[0].id)[0];
    const items = listLineItems(db, sp.id);
    const newIt1 = items[0]; // corresponds to it1 (first item of first space)

    const costs = listLineItemCosts(db, newIt1.id);
    expect(costs).toHaveLength(2);
    const active = getActiveLineItemCost(db, newIt1.id);
    const origActive = getActiveLineItemCost(db, it1.id);
    expect(active).not.toBeNull();
    expect(active!.costUnitCents).toBe(origActive!.costUnitCents);
    expect(active!.costUnitCents).toBe(27000);
    // snapshot cost synced to active candidate
    expect(newIt1.snapshot.costUnitCents).toBe(27000);
    // exactly one active
    expect(costs.filter(c => c.isActive)).toHaveLength(1);
  });

  it('copies estimate categories/rows, remapping sectionRef to the new section', () => {
    const { pj } = buildProject();
    const dup = duplicateProject(db, pj.id);

    const newCats = listEstimateCategories(db, dup.id);
    expect(newCats).toHaveLength(1);
    const rows = listEstimateRows(db, newCats[0].id);
    expect(rows).toHaveLength(2);
    expect(rows[0].manualAmountCents).toBe(500000);

    const refRow = rows.find(r => r.valueMethod === 'sectionRef')!;
    const newSecs = listSections(db, dup.id);
    const origSecs = listSections(db, pj.id);
    // remapped to a section of the NEW project (not the original one)
    expect(refRow.refSectionId).not.toBeNull();
    expect(refRow.refSectionId).toBe(newSecs[0].id);
    expect(refRow.refSectionId).not.toBe(origSecs[0].id);
  });

  it('does not pollute the original project', () => {
    const { pj } = buildProject();
    const beforeSecs = listSections(db, pj.id).length;
    const beforeCats = listEstimateCategories(db, pj.id);
    const beforeRows = listEstimateRows(db, beforeCats[0].id).length;

    duplicateProject(db, pj.id);

    expect(listSections(db, pj.id)).toHaveLength(beforeSecs);
    expect(listEstimateCategories(db, pj.id)).toHaveLength(beforeCats.length);
    expect(listEstimateRows(db, beforeCats[0].id)).toHaveLength(beforeRows);
    // original ref row still points to original section
    const origRefRow = listEstimateRows(db, beforeCats[0].id).find(r => r.valueMethod === 'sectionRef')!;
    expect(origRefRow.refSectionId).toBe(listSections(db, pj.id)[0].id);
  });
});
