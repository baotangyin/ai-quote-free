import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as core from '../../src/core/index';
import { handlers, registerIpc, searchExtraBody } from '../../src/main/ipc';
import { ensureSettingsTable, type AiProfile } from '../../src/main/settings';

function buildDb() {
  const db = core.openDb(':memory:');
  ensureSettingsTable(db);
  return db;
}

const blankSnapshot = (costUnitCents: number) => ({
  name: 'x', brand: null, model: null, recommendedBrands: [], paramsCore: null, paramsBid: null,
  paramsTender: null, unit: '台', dims: null, power220W: 0, power380W: 0, rackU: 0, seqPowerPorts: 0,
  netPorts: 0, comPorts: 0, costUnitCents, optionsApplied: [],
});

describe('registerIpc', () => {
  it('注册所有 handler，通道名为 域:方法 格式', () => {
    const registered: Record<string, (...a: any[]) => any> = {};
    const fakeIpcMain = { handle: (ch: string, fn: (...a: any[]) => any) => { registered[ch] = fn; } };
    const db = buildDb();
    registerIpc(fakeIpcMain, db);
    expect(Object.keys(registered).length).toBe(Object.keys(handlers).length);
    for (const ch of Object.keys(registered)) {
      expect(ch).toMatch(/^[a-z][a-zA-Z]*(:[a-zA-Z]+)+$/);
    }
  });

  it('registered handler 以 (db, payload) 调用底层 handler', async () => {
    const registered: Record<string, (...a: any[]) => any> = {};
    const fakeIpcMain = { handle: (ch: string, fn: (...a: any[]) => any) => { registered[ch] = fn; } };
    const db = buildDb();
    registerIpc(fakeIpcMain, db);
    const sup = await registered['suppliers:create'](null, { name: '测试供应商' });
    expect(sup.id).toBeDefined();
    const list = await registered['suppliers:list'](null, undefined);
    expect(list).toHaveLength(1);
  });
});

describe('searchExtraBody 按档案 searchMode 生成查价链路 extraBody', () => {
  const base: AiProfile = { id: 'p1', name: 'P', protocol: 'openai', baseUrl: 'https://x', apiKey: 'k', model: 'm' };

  it('缺省（无 searchMode 字段）返回 undefined', () => {
    expect(searchExtraBody(base)).toBeUndefined();
  });

  it("searchMode='none' 返回 undefined", () => {
    expect(searchExtraBody({ ...base, searchMode: 'none' })).toBeUndefined();
  });

  it("searchMode='zhipu' 返回智谱 web_search 工具结构", () => {
    expect(searchExtraBody({ ...base, searchMode: 'zhipu' })).toEqual({
      tools: [{ type: 'web_search', web_search: { enable: true } }],
    });
  });

  it("searchMode='dashscope' 返回 enable_search:true", () => {
    expect(searchExtraBody({ ...base, searchMode: 'dashscope' })).toEqual({ enable_search: true });
  });

  it("searchMode='minimax' 返回 MiniMax web_search 工具结构", () => {
    expect(searchExtraBody({ ...base, searchMode: 'minimax' })).toEqual({ tools: [{ type: 'web_search' }] });
  });

  it("searchMode='custom' 时按 searchCustomJson 解析", () => {
    const profile: AiProfile = { ...base, searchMode: 'custom', searchCustomJson: '{"foo":"bar"}' };
    expect(searchExtraBody(profile)).toEqual({ foo: 'bar' });
  });

  it("searchMode='custom' 但 searchCustomJson 缺失时返回 undefined", () => {
    expect(searchExtraBody({ ...base, searchMode: 'custom' })).toBeUndefined();
  });

  it("searchMode='custom' 但 JSON 非法时忽略并返回 undefined（不抛错）", () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const profile: AiProfile = { ...base, searchMode: 'custom', searchCustomJson: '{not json' };
    expect(searchExtraBody(profile)).toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe('settings:get/set', () => {
  it('读写设置', () => {
    const db = buildDb();
    expect(handlers['settings:get'](db, 'costRule')).toBeNull();
    handlers['settings:set'](db, { key: 'costRule', value: 'latest' });
    expect(handlers['settings:get'](db, 'costRule')).toBe('latest');
  });
});

describe('products:create + products:list', () => {
  it('建产品后可列出', () => {
    const db = buildDb();
    const p = handlers['products:create'](db, { category: 'LED屏', name: 'P1.8', unit: '㎡' });
    expect(p.id).toBeDefined();
    const list = handlers['products:list'](db, undefined);
    expect(list.map((x: any) => x.id)).toContain(p.id);
  });
});

function setupProjectChain(db: any) {
  const project = handlers['projects:create'](db, { name: 'proj', defaultMargin: 1.3 });
  const section = handlers['sections:create'](db, { projectId: project.id, name: 'sec', integrationFeeRate: 0.05 });
  const space = handlers['spaces:create'](db, { sectionId: section.id, name: 'sp' });
  return { project, section, space };
}

describe('items:createFromProduct', () => {
  it('无价格记录时报错「该产品无价格记录」', () => {
    const db = buildDb();
    const product = handlers['products:create'](db, { category: 'LED屏', name: 'P1.8', unit: '㎡' });
    const { space } = setupProjectChain(db);
    expect(() => handlers['items:createFromProduct'](db, { spaceId: space.id, productId: product.id, qty: 1 }))
      .toThrow('该产品无价格记录');
  });

  it('有价格记录时建行，快照写入生效成本价（lowest 规则）', () => {
    const db = buildDb();
    const sup = handlers['suppliers:create'](db, { name: 'S1' });
    const product = handlers['products:create'](db, { category: 'LED屏', name: 'P1.8', unit: '㎡' });
    const { space } = setupProjectChain(db);
    handlers['prices:add'](db, { productId: product.id, source: 'supplier', supplierId: sup.id, priceCents: 48000 });
    const item = handlers['items:createFromProduct'](db, { spaceId: space.id, productId: product.id, qty: 2 });
    expect(item.snapshot.costUnitCents).toBe(48000);
    expect(item.qty).toBe(2);
    expect(item.productId).toBe(product.id);
  });
});

describe('items:refreshSnapshot / items:checkStale', () => {
  it('刷新快照后成本随最新有效价变化', () => {
    const db = buildDb();
    const sup = handlers['suppliers:create'](db, { name: 'S1' });
    const product = handlers['products:create'](db, { category: 'x', name: 'y', unit: '台' });
    const { space } = setupProjectChain(db);
    handlers['prices:add'](db, { productId: product.id, source: 'supplier', supplierId: sup.id, priceCents: 10000, capturedAt: '2026-01-01' });
    const item = handlers['items:createFromProduct'](db, { spaceId: space.id, productId: product.id, qty: 1 });
    expect(handlers['items:checkStale'](db, item.id)).toBe(false);
    handlers['prices:add'](db, { productId: product.id, source: 'supplier', supplierId: sup.id, priceCents: 8000, capturedAt: '2026-02-01' });
    expect(handlers['items:checkStale'](db, item.id)).toBe(true);
    const refreshed = handlers['items:refreshSnapshot'](db, item.id);
    expect(refreshed.snapshot.costUnitCents).toBe(8000);
    expect(handlers['items:checkStale'](db, item.id)).toBe(false);
  });
});

describe('projects:totals', () => {
  it('返回各板块 totals 与 projectTotals', () => {
    const db = buildDb();
    const { project, section, space } = setupProjectChain(db);
    handlers['items:createManual'](db, { spaceId: space.id, qty: 2, snapshot: blankSnapshot(10000) });
    const totals = handlers['projects:totals'](db, project.id);
    expect(totals.sections).toHaveLength(1);
    expect(totals.sections[0].id).toBe(section.id);
    expect(totals.sections[0].totals.equipmentCents).toBe(26000); // 10000*1.3*2
    expect(totals.projectTotals.totalCents).toBe(totals.sections[0].totals.totalCents);
    expect(totals.projectTotals.profitCents).toBe(totals.projectTotals.totalCents - totals.projectTotals.costTotalCents);
  });
});

describe('items:computed', () => {
  it('返回 lineTotals 结果', () => {
    const db = buildDb();
    const { space } = setupProjectChain(db);
    const item = handlers['items:createManual'](db, { spaceId: space.id, qty: 1, snapshot: blankSnapshot(10000) });
    const computed = handlers['items:computed'](db, item.id);
    expect(computed.unitPriceCents).toBe(13000);
  });
});

describe('export:run', () => {
  it('写出 3 个文件到临时目录', async () => {
    const db = buildDb();
    const { space } = setupProjectChain(db);
    handlers['items:createManual'](db, { spaceId: space.id, qty: 1, snapshot: blankSnapshot(10000) });
    const project = core.listProjects(db)[0];
    const dir = mkdtempSync(join(tmpdir(), 'aiq-ipc-'));
    const files = await handlers['export:run'](db, { projectId: project.id, outDir: dir });
    expect(files).toHaveLength(3);
  });
});

describe('settings costRule 影响 prices:effectiveCost', () => {
  it('lowest 与 latest 规则给出不同结果', () => {
    const db = buildDb();
    const sup = handlers['suppliers:create'](db, { name: 'S1' });
    const product = handlers['products:create'](db, { category: 'x', name: 'y', unit: '台' });
    handlers['prices:add'](db, { productId: product.id, source: 'supplier', supplierId: sup.id, priceCents: 10000, capturedAt: '2026-01-01' });
    handlers['prices:add'](db, { productId: product.id, source: 'supplier', supplierId: sup.id, priceCents: 9000, capturedAt: '2026-03-01' });
    handlers['prices:add'](db, { productId: product.id, source: 'supplier', supplierId: sup.id, priceCents: 8000, capturedAt: '2026-02-01' });
    // default costRule = lowest
    expect(handlers['prices:effectiveCost'](db, product.id)).toBe(8000);
    handlers['settings:set'](db, { key: 'costRule', value: 'latest' });
    expect(handlers['prices:effectiveCost'](db, product.id)).toBe(9000); // 按 capturedAt 最新
    handlers['settings:set'](db, { key: 'costRule', value: 'lowest' });
    expect(handlers['prices:effectiveCost'](db, product.id)).toBe(8000);
  });
});

describe('薄封装通道抽查', () => {
  it('sections/spaces list+create、prices:list', () => {
    const db = buildDb();
    const { project, section, space } = setupProjectChain(db);
    expect(handlers['sections:list'](db, project.id).map((s: any) => s.id)).toContain(section.id);
    expect(handlers['spaces:list'](db, section.id).map((s: any) => s.id)).toContain(space.id);
    const product = handlers['products:create'](db, { category: 'x', name: 'y', unit: '台' });
    expect(handlers['prices:list'](db, product.id)).toEqual([]);
  });

  it('suppliers/products/projects update+delete', () => {
    const db = buildDb();
    const sup = handlers['suppliers:create'](db, { name: 'S1' });
    const updated = handlers['suppliers:update'](db, { id: sup.id, patch: { name: 'S2' } });
    expect(updated.name).toBe('S2');
    handlers['suppliers:delete'](db, sup.id);
    expect(handlers['suppliers:list'](db, undefined)).toEqual([]);
  });
});

describe('items:replaceProduct 全链路', () => {
  it('handler 换产品：新产品成本价+清空手工价与候选成本，qty/remark 保留', () => {
    const db = buildDb();
    const sup = handlers['suppliers:create'](db, { name: 'S1' });
    const prodOld = handlers['products:create'](db, { category: '屏幕', name: '旧产品', unit: '台' });
    const prodNew = handlers['products:create'](db, {
      category: '屏幕', name: '新产品', unit: '台',
      options: [{ name: '支架', addPriceCents: 1000 }],
    });
    handlers['prices:add'](db, { productId: prodOld.id, source: 'supplier', supplierId: sup.id, priceCents: 20000 });
    handlers['prices:add'](db, { productId: prodNew.id, source: 'supplier', supplierId: sup.id, priceCents: 30000 });
    const { space } = setupProjectChain(db);
    const item = handlers['items:createFromProduct'](db, { spaceId: space.id, productId: prodOld.id, qty: 3 });
    handlers['items:update'](db, { id: item.id, patch: { remark: '备注保留', manualUnitPriceCents: 99999 } });
    handlers['itemCosts:create'](db, { lineItemId: item.id, costUnitCents: 18000, supplierName: '供X' });

    const updated = handlers['items:replaceProduct'](db, { itemId: item.id, productId: prodNew.id, optionNames: ['支架'] });

    expect(updated.productId).toBe(prodNew.id);
    expect(updated.qty).toBe(3);
    expect(updated.remark).toBe('备注保留');
    expect(updated.manualUnitPriceCents).toBeNull();
    expect(updated.snapshot.costUnitCents).toBe(30000 + 1000);
    expect(handlers['itemCosts:list'](db, item.id)).toEqual([]);
  });

  it('产品不存在时抛中文错误', () => {
    const db = buildDb();
    const { space } = setupProjectChain(db);
    const item = handlers['items:createManual'](db, { spaceId: space.id, qty: 1, snapshot: blankSnapshot(10000) });
    expect(() => handlers['items:replaceProduct'](db, { itemId: item.id, productId: 999999, optionNames: [] }))
      .toThrow('产品 999999 不存在');
  });

  it('无价格记录时成本按 0 处理，不抛错（IPC 层不额外抛错）', () => {
    const db = buildDb();
    const prodOld = handlers['products:create'](db, { category: '屏幕', name: '旧产品', unit: '台' });
    const prodNoPrice = handlers['products:create'](db, { category: '屏幕', name: '无价产品', unit: '台' });
    const { space } = setupProjectChain(db);
    const item = handlers['items:createManual'](db, { spaceId: space.id, qty: 1, snapshot: blankSnapshot(10000) });
    const updated = handlers['items:replaceProduct'](db, { itemId: item.id, productId: prodNoPrice.id, optionNames: [] });
    expect(updated.snapshot.costUnitCents).toBe(0);
    expect(updated.productId).toBe(prodNoPrice.id);
    expect(prodOld).toBeDefined();
  });
});

describe('spaces:create/update 板块空间联动触发全链路', () => {
  function buildLinkedProject(db: any) {
    const project = handlers['projects:create'](db, { name: 'proj', defaultMargin: 1.3 });
    // sort_order 由创建顺序自然递增，source 是第一个创建的板块
    const source = handlers['sections:create'](db, { projectId: project.id, name: '源板块' });
    const linked = handlers['sections:create'](db, { projectId: project.id, name: '联动板块' });
    handlers['sections:update'](db, { id: linked.id, patch: { linkSpaces: true } });
    return { project, source, linked };
  }

  it('spaces:create 在源板块新建非置底空间时触发同步，附 syncedSections', () => {
    const db = buildDb();
    const { source, linked } = buildLinkedProject(db);
    const space = handlers['spaces:create'](db, { sectionId: source.id, name: '序厅' });
    expect(space.syncedSections).toBe(1);
    const linkedSpaces = handlers['spaces:list'](db, linked.id);
    expect(linkedSpaces.map((s: any) => s.name)).toEqual(['序厅']);
  });

  it('spaces:create 置底空间（pinBottom=true）不触发同步', () => {
    const db = buildDb();
    const { source, linked } = buildLinkedProject(db);
    const space = handlers['spaces:create'](db, { sectionId: source.id, name: '安防', pinBottom: true });
    expect(space.syncedSections).toBeUndefined();
    expect(handlers['spaces:list'](db, linked.id)).toHaveLength(0);
  });

  it('spaces:create 在非源板块新建时不触发同步', () => {
    const db = buildDb();
    const { linked } = buildLinkedProject(db);
    const space = handlers['spaces:create'](db, { sectionId: linked.id, name: '序厅' });
    expect(space.syncedSections).toBeUndefined();
  });

  it('spaces:update 在源板块改名时触发 rename 同步，oldName=改前名', () => {
    const db = buildDb();
    const { source, linked } = buildLinkedProject(db);
    const space = handlers['spaces:create'](db, { sectionId: source.id, name: '旧名' });
    // 联动板块内应已同步出现同名空间
    const linkedSpaceBefore = handlers['spaces:list'](db, linked.id)[0];
    expect(linkedSpaceBefore.name).toBe('旧名');

    const updated = handlers['spaces:update'](db, { id: space.id, patch: { name: '新名' } });
    expect(updated.syncedSections).toBe(1);
    const linkedSpaceAfter = handlers['spaces:list'](db, linked.id)[0];
    expect(linkedSpaceAfter.name).toBe('新名');
  });

  it('spaces:update 未改名（仅改其它字段）不触发同步', () => {
    const db = buildDb();
    const { source } = buildLinkedProject(db);
    const space = handlers['spaces:create'](db, { sectionId: source.id, name: '序厅' });
    const updated = handlers['spaces:update'](db, { id: space.id, patch: { area: 30 } });
    expect(updated.syncedSections).toBeUndefined();
  });

  it('spaces:update 在非源板块改名时不触发同步', () => {
    const db = buildDb();
    const { linked } = buildLinkedProject(db);
    const space = handlers['spaces:create'](db, { sectionId: linked.id, name: '旧名' });
    const updated = handlers['spaces:update'](db, { id: space.id, patch: { name: '新名' } });
    expect(updated.syncedSections).toBeUndefined();
  });
});

describe('analytics:productProfit 全链路', () => {
  it('造项目+产品+行→handler→断言金额', () => {
    const db = buildDb();
    const sup = handlers['suppliers:create'](db, { name: 'S1' });
    const product = handlers['products:create'](db, { category: 'LED屏', name: 'P1.8', unit: '㎡' });
    handlers['prices:add'](db, { productId: product.id, source: 'supplier', supplierId: sup.id, priceCents: 48000 });
    const { space } = setupProjectChain(db);
    handlers['items:createFromProduct'](db, { spaceId: space.id, productId: product.id, qty: 2 });
    const result = handlers['analytics:productProfit'](db, {});
    expect(result).toHaveLength(1);
    expect(result[0].productId).toBe(product.id);
    expect(result[0].name).toBe('P1.8');
    expect(result[0].costTotalCents).toBe(96000); // 48000 * 2
    expect(result[0].revenueTotalCents).toBe(124800); // 48000 * 2 * 1.3
    expect(result[0].profitCents).toBe(28800); // 124800 - 96000
  });
});
