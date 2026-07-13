import { describe, it, expect } from 'vitest';
import * as core from '../../src/core/index';

describe('端到端：建库→报价→改价→刷新快照', () => {
  it('walks the full flow', () => {
    const db = core.openDb(':memory:');
    // 1. 供应商报价入库
    const sup = core.createSupplier(db, { name: '迈创日新' });
    const led = core.createProduct(db, { category: 'LED屏', name: 'P1.8全彩屏', unit: '㎡', power220W: 800, seqPowerPorts: 1 });
    core.addPriceRecord(db, { productId: led.id, source: 'supplier', supplierId: sup.id, priceCents: 480000, capturedAt: '2026-06-01' });
    // 2. 建项目四层结构并引用产品
    const pj = core.createProject(db, { name: '翔威新能源', defaultMargin: 1.3 });
    const sec = core.createSection(db, { projectId: pj.id, name: '展厅多媒体硬件', integrationFeeRate: 0.05 });
    const sp = core.createSpace(db, { sectionId: sec.id, name: '序厅' });
    const cost = core.getEffectiveCost(db, led.id, 'lowest')!;
    const item = core.createLineItem(db, { spaceId: sp.id, productId: led.id,
      snapshot: core.takeSnapshot(core.getProduct(db, led.id)!, cost), qty: 73.73 });
    // 3. 计价核对（4800元/㎡ × 1.3 = 6240元/㎡）
    const lt = core.lineTotals(item, core.getProject(db, pj.id)!);
    expect(lt.unitPriceCents).toBe(624000);
    // 4. 供应商降价 → 快照失效 → 刷新
    core.addPriceRecord(db, { productId: led.id, source: 'supplier', supplierId: sup.id, priceCents: 460000, capturedAt: '2026-07-01' });
    expect(core.isSnapshotStale(db, item, 'lowest')).toBe(true);
    const fresh = core.refreshSnapshot(db, item.id, 'lowest');
    expect(fresh.snapshot.costUnitCents).toBe(460000);
    db.close();
  });
});
