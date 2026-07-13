import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, type Db } from '../../src/core/db/db';
import { createProject, createSection, createSpace, createLineItem, updateProject } from '../../src/core/repo/projects';
import { createProduct, deleteProduct } from '../../src/core/repo/products';
import { addPriceRecord } from '../../src/core/repo/prices';
import { createRule } from '../../src/core/repo/rules';
import { takeSnapshot } from '../../src/core/domain/snapshot';
import { getProduct } from '../../src/core/repo/products';
import {
  buildTriggerContext,
  evaluateItemTrigger,
  evaluateProjectTrigger,
} from '../../src/core/domain/rules-engine';
import type { RuleAction } from '../../src/core/domain/types';

/** 建一个带一条价格记录的产品 */
function mkProduct(db: Db, over: Partial<Parameters<typeof createProduct>[1]> = {}, priceCents = 100000) {
  const p = createProduct(db, {
    name: '产品', unit: '台', power220W: 0, power380W: 0,
    rackU: 0, seqPowerPorts: 0, netPorts: 0, comPorts: 0,
    ...over,
  } as any);
  addPriceRecord(db, { productId: p.id, source: 'manual', priceCents });
  return getProduct(db, p.id)!;
}

/** 建一个产品并在指定空间下建一行清单，返回 lineItem */
function mkLine(db: Db, spaceId: number, product: ReturnType<typeof mkProduct>, qty: number) {
  const snap = takeSnapshot(product, 100000, []);
  return createLineItem(db, { spaceId, productId: product.id, snapshot: snap, qty });
}

describe('buildTriggerContext', () => {
  let db: Db;
  beforeEach(() => { db = openDb(':memory:'); });

  it('行级变量：LED屏行 unit=㎡ → area=qty，power220/netPorts 正确', () => {
    const pj = createProject(db, { name: 'X' });
    const sec = createSection(db, { projectId: pj.id, name: '硬件' });
    const sp = createSpace(db, { sectionId: sec.id, name: '序厅', area: 20 });
    const led = mkProduct(db, { name: 'LED屏', unit: '㎡', categories: ['LED屏'], power220W: 800, netPorts: 2 });
    const item = mkLine(db, sp.id, led, 73.73);

    const ctx = buildTriggerContext(db, pj.id, item);
    expect(ctx.qty).toBe(73.73);
    // unit==='㎡' → area 取 qty，而非空间 area(20)
    expect(ctx.area).toBe(73.73);
    expect(ctx.power220).toBeCloseTo(800 * 73.73, 6);
    expect(ctx.power380).toBe(0);
    expect(ctx.power).toBeCloseTo(800 * 73.73, 6);
    expect(ctx.netPorts).toBeCloseTo(2 * 73.73, 6);
  });

  it('非㎡行 → area 取所属空间 area；查不到取 0', () => {
    const pj = createProject(db, { name: 'X' });
    const sec = createSection(db, { projectId: pj.id, name: '硬件' });
    const sp = createSpace(db, { sectionId: sec.id, name: '序厅', area: 42 });
    const prod = mkProduct(db, { name: '功放', unit: '台', power220W: 100 });
    const item = mkLine(db, sp.id, prod, 3);
    const ctx = buildTriggerContext(db, pj.id, item);
    expect(ctx.area).toBe(42);
    expect(ctx.power220).toBe(300);

    const sp2 = createSpace(db, { sectionId: sec.id, name: '无面积' });
    const item2 = mkLine(db, sp2.id, prod, 1);
    const ctx2 = buildTriggerContext(db, pj.id, item2);
    expect(ctx2.area).toBe(0);
  });

  it('triggerItem=null → 行级全 0，项目级仍汇总', () => {
    const pj = createProject(db, { name: 'X' });
    const sec = createSection(db, { projectId: pj.id, name: '硬件' });
    const sp = createSpace(db, { sectionId: sec.id, name: '序厅', area: 10 });
    const a = mkProduct(db, { name: 'A', unit: '台', netPorts: 2, power220W: 100 });
    const b = mkProduct(db, { name: 'B', unit: '台', netPorts: 3, power220W: 50 });
    mkLine(db, sp.id, a, 2); // netPorts 4, power220 200
    mkLine(db, sp.id, b, 5); // netPorts 15, power220 250

    const ctx = buildTriggerContext(db, pj.id, null);
    expect(ctx.qty).toBe(0);
    expect(ctx.area).toBe(0);
    expect(ctx.power220).toBe(0);
    expect(ctx.netPorts).toBe(0);
    // 项目级
    expect(ctx.projNetPorts).toBe(4 + 15);
    expect(ctx.projPower220).toBe(200 + 250);
    expect(ctx.projItemCount).toBe(2 + 5);
  });

  it('项目级 projNetPorts 等于全项目网口合计', () => {
    const pj = createProject(db, { name: 'X' });
    const sec = createSection(db, { projectId: pj.id, name: '硬件' });
    const sp1 = createSpace(db, { sectionId: sec.id, name: 's1' });
    const sp2 = createSpace(db, { sectionId: sec.id, name: 's2' });
    const led = mkProduct(db, { name: 'LED屏', unit: '㎡', netPorts: 2, comPorts: 1 });
    const led2 = mkProduct(db, { name: 'LED2', unit: '台', netPorts: 4, comPorts: 0 });
    const item = mkLine(db, sp1.id, led, 73.73);
    mkLine(db, sp2.id, led2, 3);

    const ctx = buildTriggerContext(db, pj.id, item);
    expect(ctx.projNetPorts).toBeCloseTo(2 * 73.73 + 4 * 3, 6);
    expect(ctx.projComPorts).toBeCloseTo(1 * 73.73, 6);
  });
});

describe('evaluateItemTrigger', () => {
  let db: Db;
  beforeEach(() => { db = openDb(':memory:'); });

  it('不存在的行抛错', () => {
    expect(() => evaluateItemTrigger(db, 1, 999)).toThrow('line item 999 not found');
  });

  it('product 触发：接收卡 ceil(area*270000/512)', () => {
    const pj = createProject(db, { name: 'X' });
    const sec = createSection(db, { projectId: pj.id, name: '硬件' });
    const sp = createSpace(db, { sectionId: sec.id, name: '序厅' });
    const led = mkProduct(db, { name: 'LED屏', unit: '㎡', categories: ['LED屏'], power220W: 800 });
    const card = mkProduct(db, { name: '接收卡', unit: '张' });
    const item = mkLine(db, sp.id, led, 73.73);

    const actions: RuleAction[] = [
      { productId: card.id, qtyFormula: 'ceil(area*270000/512)', optional: false, note: '按点数配' },
    ];
    createRule(db, { name: 'LED接收卡', triggerType: 'product', triggerValue: String(led.id), actions });

    const cands = evaluateItemTrigger(db, pj.id, item.id);
    expect(cands).toHaveLength(1);
    const expectedQty = Math.ceil(73.73 * 270000 / 512); // 38882
    expect(cands[0].qty).toBe(expectedQty);
    expect(cands[0].productId).toBe(card.id);
    expect(cands[0].productName).toBe('接收卡');
    expect(cands[0].optional).toBe(false);
    expect(cands[0].note).toBe('按点数配');
    expect(cands[0].ruleName).toBe('LED接收卡');
  });

  it('category 触发：产品 categories 含 LED屏 → 命中', () => {
    const pj = createProject(db, { name: 'X' });
    const sec = createSection(db, { projectId: pj.id, name: '硬件' });
    const sp = createSpace(db, { sectionId: sec.id, name: '序厅' });
    const led = mkProduct(db, { name: 'LED屏', unit: '㎡', categories: ['LED屏', 'P1.8'] });
    const steel = mkProduct(db, { name: '钢结构', unit: 'kg' });
    const item = mkLine(db, sp.id, led, 73.73);

    const actions: RuleAction[] = [
      { productId: steel.id, qtyFormula: 'area*0.06', optional: false, note: null },
    ];
    createRule(db, { name: 'LED钢结构', triggerType: 'category', triggerValue: 'LED屏', actions });

    const cands = evaluateItemTrigger(db, pj.id, item.id);
    expect(cands).toHaveLength(1);
    // 不取整：约 4.4238
    expect(cands[0].qty).toBeCloseTo(4.4238, 4);
    expect(cands[0].qty).not.toBe(Math.ceil(cands[0].qty));
  });

  it('qty<=0 跳过；公式非法（未知变量）该动作被跳过而非报错', () => {
    const pj = createProject(db, { name: 'X' });
    const sec = createSection(db, { projectId: pj.id, name: '硬件' });
    const sp = createSpace(db, { sectionId: sec.id, name: '序厅' });
    const led = mkProduct(db, { name: 'LED屏', unit: '㎡' });
    const ok = mkProduct(db, { name: 'OK件', unit: '台' });
    const zero = mkProduct(db, { name: '零件', unit: '台' });
    const bad = mkProduct(db, { name: '坏公式件', unit: '台' });
    const item = mkLine(db, sp.id, led, 73.73);

    const actions: RuleAction[] = [
      { productId: zero.id, qtyFormula: 'area*0', optional: false, note: null },
      { productId: bad.id, qtyFormula: 'foo+1', optional: false, note: null },
      { productId: ok.id, qtyFormula: '2', optional: false, note: null },
    ];
    createRule(db, { name: '混合', triggerType: 'product', triggerValue: String(led.id), actions });

    const cands = evaluateItemTrigger(db, pj.id, item.id);
    expect(cands).toHaveLength(1);
    expect(cands[0].productId).toBe(ok.id);
    expect(cands[0].qty).toBe(2);
  });

  it('productId=null 动作被跳过', () => {
    const pj = createProject(db, { name: 'X' });
    const sec = createSection(db, { projectId: pj.id, name: '硬件' });
    const sp = createSpace(db, { sectionId: sec.id, name: '序厅' });
    const led = mkProduct(db, { name: 'LED屏', unit: '㎡' });
    const item = mkLine(db, sp.id, led, 5);

    const actions: RuleAction[] = [
      { productId: null, qtyFormula: '1', optional: true, note: '待定' },
    ];
    createRule(db, { name: '占位', triggerType: 'product', triggerValue: String(led.id), actions });

    expect(evaluateItemTrigger(db, pj.id, item.id)).toHaveLength(0);
  });

  it('产品已删：候选 productName=(产品已删)，qty 照算', () => {
    const pj = createProject(db, { name: 'X' });
    const sec = createSection(db, { projectId: pj.id, name: '硬件' });
    const sp = createSpace(db, { sectionId: sec.id, name: '序厅' });
    const led = mkProduct(db, { name: 'LED屏', unit: '㎡' });
    const gone = mkProduct(db, { name: '将删件', unit: '台' });
    const item = mkLine(db, sp.id, led, 5);

    const actions: RuleAction[] = [
      { productId: gone.id, qtyFormula: 'qty*2', optional: false, note: null },
    ];
    createRule(db, { name: '删件规则', triggerType: 'product', triggerValue: String(led.id), actions });
    deleteProduct(db, gone.id);

    const cands = evaluateItemTrigger(db, pj.id, item.id);
    expect(cands).toHaveLength(1);
    expect(cands[0].productName).toBe('(产品已删)');
    expect(cands[0].qty).toBe(10);
  });

  it('product 与 category 触发合并，规则按 sort_order', () => {
    const pj = createProject(db, { name: 'X' });
    const sec = createSection(db, { projectId: pj.id, name: '硬件' });
    const sp = createSpace(db, { sectionId: sec.id, name: '序厅' });
    const led = mkProduct(db, { name: 'LED屏', unit: '㎡', categories: ['LED屏'] });
    const c1 = mkProduct(db, { name: 'C1', unit: '台' });
    const c2 = mkProduct(db, { name: 'C2', unit: '台' });
    const item = mkLine(db, sp.id, led, 5);

    createRule(db, { name: 'byProduct', triggerType: 'product', triggerValue: String(led.id),
      actions: [{ productId: c1.id, qtyFormula: '1', optional: false, note: null }] });
    createRule(db, { name: 'byCategory', triggerType: 'category', triggerValue: 'LED屏',
      actions: [{ productId: c2.id, qtyFormula: '1', optional: false, note: null }] });

    const cands = evaluateItemTrigger(db, pj.id, item.id);
    expect(cands.map(c => c.productId)).toEqual([c1.id, c2.id]);
  });
});

describe('evaluateProjectTrigger', () => {
  let db: Db;
  beforeEach(() => { db = openDb(':memory:'); });

  it('project 不存在抛错', () => {
    expect(() => evaluateProjectTrigger(db, 999)).toThrow();
  });

  it('projectType=展厅 触发交换机 ceil(projNetPorts*1.2/24)', () => {
    const pj = createProject(db, { name: 'X', projectType: '展厅' });
    const sec = createSection(db, { projectId: pj.id, name: '硬件' });
    const sp = createSpace(db, { sectionId: sec.id, name: '序厅' });
    const dev = mkProduct(db, { name: '设备', unit: '台', netPorts: 4 });
    mkLine(db, sp.id, dev, 30); // projNetPorts = 120
    const sw = mkProduct(db, { name: '交换机', unit: '台' });

    createRule(db, { name: '展厅交换机', triggerType: 'projectType', triggerValue: '展厅',
      actions: [{ productId: sw.id, qtyFormula: 'ceil(projNetPorts*1.2/24)', optional: false, note: null }] });

    const cands = evaluateProjectTrigger(db, pj.id);
    expect(cands).toHaveLength(1);
    const expectedQty = Math.ceil(120 * 1.2 / 24); // ceil(6)=6
    expect(cands[0].qty).toBe(expectedQty);
    expect(cands[0].productId).toBe(sw.id);
  });

  it('projectType 为空 → []', () => {
    const pj = createProject(db, { name: 'X' });
    expect(evaluateProjectTrigger(db, pj.id)).toEqual([]);
    updateProject(db, pj.id, { projectType: '' });
    expect(evaluateProjectTrigger(db, pj.id)).toEqual([]);
  });
});
