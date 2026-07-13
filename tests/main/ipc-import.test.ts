import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import * as core from '../../src/core/index';
import { handlers, makeRecognizeHandler, makeAiTestHandler, makeParseTemplateXlsxHandler, makeRecognizeDrawingHandler, makeRecognizeScreenshotHandler } from '../../src/main/ipc';
import { ensureSettingsTable } from '../../src/main/settings';
import type { RecognizedRow } from '../../src/core/import/recognize';
import type { AiConfig } from '../../src/core/ai/client';

function buildDb() {
  const db = core.openDb(':memory:');
  ensureSettingsTable(db);
  return db;
}

function configureAi(db: ReturnType<typeof buildDb>) {
  handlers['settings:set'](db, { key: 'aiProtocol', value: 'openai' });
  handlers['settings:set'](db, { key: 'aiBaseUrl', value: 'https://api.test' });
  handlers['settings:set'](db, { key: 'aiApiKey', value: 'sk-test' });
  handlers['settings:set'](db, { key: 'aiModel', value: 'test-model' });
}

async function buildFixture(): Promise<string> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('报价单');
  // Left block: cols A-B; separator col C empty; right block: cols D-E.
  ws.getCell('A1').value = '名称';
  ws.getCell('B1').value = '售价';
  ws.getCell('D1').value = '名称2';
  ws.getCell('E1').value = '售价2';
  ws.getCell('A2').value = '产品A';
  ws.getCell('B2').value = 100;
  ws.getCell('D2').value = '产品B';
  ws.getCell('E2').value = 200;

  const dir = mkdtempSync(join(tmpdir(), 'ipc-import-'));
  const file = join(dir, 'fixture.xlsx');
  await wb.xlsx.writeFile(file);
  return file;
}

function row(overrides: Partial<RecognizedRow> = {}): RecognizedRow {
  return {
    categories: ['显示设备'],
    name: '46寸拼接屏',
    brand: null,
    model: null,
    params: null,
    unit: '台',
    dims: null,
    priceCents: 100000,
    options: [],
    remark: null,
    confidence: 0.9,
    power220W: null,
    power380W: null,
    rackU: null,
    seqPowerPorts: null,
    netPorts: null,
    comPorts: null,
    ...overrides,
  };
}

describe('import:parse', () => {
  it('解析文件为 trim + splitSideBySide 后的块列表，含 sheetName/blockIndex/grid/rows/cols', async () => {
    const file = await buildFixture();
    const db = buildDb();
    const blocks = await handlers['import:parse'](db, { filePath: file });

    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({ sheetName: '报价单', blockIndex: 0 });
    expect(blocks[1]).toMatchObject({ sheetName: '报价单', blockIndex: 1 });
    expect(blocks[0].grid).toEqual([
      ['名称', '售价'],
      ['产品A', '100'],
    ]);
    expect(blocks[0].rows).toBe(2);
    expect(blocks[0].cols).toBe(2);
    expect(blocks[1].grid).toEqual([
      ['名称2', '售价2'],
      ['产品B', '200'],
    ]);
  });
});

describe('import:recognize', () => {
  it('未配置 AI 时抛「请先在设置中配置 AI 档案」', async () => {
    const db = buildDb();
    await expect(handlers['import:recognize'](db, { sheetName: 's', grid: [['名称', '售价'], ['A', '1']] }))
      .rejects.toThrow('请先在设置中配置 AI 档案');
  });

  it('部分配置缺失（如 aiModel 为空）不满足懒迁移条件，同样抛错', async () => {
    const db = buildDb();
    handlers['settings:set'](db, { key: 'aiProtocol', value: 'openai' });
    handlers['settings:set'](db, { key: 'aiBaseUrl', value: 'https://api.test' });
    handlers['settings:set'](db, { key: 'aiApiKey', value: 'sk-test' });
    await expect(handlers['import:recognize'](db, { sheetName: 's', grid: [['名称', '售价'], ['A', '1']] }))
      .rejects.toThrow('请先在设置中配置 AI 档案');
  });

  it('配置齐全时用 makeRecognizeHandler 注入 stub chatFn，不发真实网络请求，返回 {rows, dropped, failedChunks}', async () => {
    const db = buildDb();
    configureAi(db);

    const chatFn = vi.fn().mockResolvedValue(JSON.stringify([
      { category: 'A类', name: '产品A', brand: null, model: null, params: null, unit: '台', dims: null, price_yuan: 100, options: [], remark: null, confidence: 0.9 },
    ]));
    const handler = makeRecognizeHandler(chatFn);

    const result = await handler(db, { sheetName: 's', grid: [['名称', '售价'], ['产品A', '100']] });

    expect(chatFn).toHaveBeenCalledTimes(1);
    // 注入的 stub 收到的 AiConfig 来自 settings
    const cfgArg = chatFn.mock.calls[0][0] as AiConfig;
    expect(cfgArg).toEqual({ protocol: 'openai', baseUrl: 'https://api.test', apiKey: 'sk-test', model: 'test-model' });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].priceCents).toBe(10000);
    expect(result.dropped).toBe(0);
    expect(result.failedChunks).toBe(0);
    expect(result.truncatedChunks).toBe(0);
  });

  it('handlers 表中的 import:recognize 默认使用真实 chatComplete（未配置时提前抛错，不会真正发请求）', async () => {
    const db = buildDb();
    // 不配置 AI，确认走到 readAiConfig 校验分支即抛错，chatComplete 不会被调用（无网络副作用）
    await expect(handlers['import:recognize'](db, { sheetName: 's', grid: [] })).rejects.toThrow('请先在设置中配置 AI 档案');
  });
});

describe('exportTemplates:parseXlsx', () => {
  it('未配置 AI 时抛「请先在设置中配置 AI 档案」', async () => {
    const db = buildDb();
    const file = await buildFixture();
    await expect(handlers['exportTemplates:parseXlsx'](db, { filePath: file }))
      .rejects.toThrow('请先在设置中配置 AI 档案');
  });

  it('配置齐全时用 makeParseTemplateXlsxHandler 注入 stub chatFn，读取首个数据 sheet 前 30 行并返回 ParsedTemplateDraft', async () => {
    const db = buildDb();
    configureAi(db);
    const file = await buildFixture();

    const aiResponse = {
      title: '客户报价单',
      companyName: null,
      headerRowIndex: 0,
      columns: [{ sourceLabel: '名称', mappedKey: 'name' }],
      summaryLabels: [],
    };
    const chatFn = vi.fn().mockResolvedValue(JSON.stringify(aiResponse));
    const handler = makeParseTemplateXlsxHandler(chatFn);

    const draft = await handler(db, { filePath: file });

    expect(chatFn).toHaveBeenCalledTimes(1);
    const cfgArg = chatFn.mock.calls[0][0] as AiConfig;
    expect(cfgArg).toEqual({ protocol: 'openai', baseUrl: 'https://api.test', apiKey: 'sk-test', model: 'test-model' });
    expect(draft.config.header.detailTitle).toBe('客户报价单');
    expect(draft.config.versions[0].columns).toEqual([{ key: 'name', label: '名称', width: null }]);
    expect(draft.ignoredColumns).toEqual([]);
  });

  it('handlers 表中的 exportTemplates:parseXlsx 默认使用真实 chatComplete（未配置时提前抛错，不会真正发请求）', async () => {
    const db = buildDb();
    const file = await buildFixture();
    await expect(handlers['exportTemplates:parseXlsx'](db, { filePath: file }))
      .rejects.toThrow('请先在设置中配置 AI 档案');
  });
});

describe('import:match', () => {
  it('每行附 match 结果：brand+model 命中已存在产品', () => {
    const db = buildDb();
    core.createProduct(db, { category: '显示设备', name: '旧名', unit: '台', brand: '海康', model: 'X100' });
    const result = handlers['import:match'](db, { rows: [row({ brand: '海康', model: 'X100', name: '随便' })] });
    expect(result).toHaveLength(1);
    expect(result[0].match).toEqual({ kind: 'existing', productId: expect.any(Number) });
    expect(result[0].name).toBe('随便'); // 原始字段保留
  });

  it('未命中任何产品时 match.kind 为 new', () => {
    const db = buildDb();
    const result = handlers['import:match'](db, { rows: [row({ name: '全新产品' })] });
    expect(result[0].match).toEqual({ kind: 'new' });
  });
});

describe('import:commit', () => {
  it('supplierId 为真实供应商 id 时落库，来源为 supplier', () => {
    const db = buildDb();
    const sup = handlers['suppliers:create'](db, { name: '供应商A' });
    const result = handlers['import:commit'](db, {
      supplierId: sup.id,
      rows: [{ ...row(), action: 'create' }],
    });
    expect(result).toEqual({ created: 1, priced: 1 });
    const products = core.listProducts(db);
    expect(products).toHaveLength(1);
    const prices = core.listPriceRecords(db, products[0].id);
    expect(prices[0].source).toBe('supplier');
    expect(prices[0].supplierId).toBe(sup.id);
  });

  it('supplierId 为 null 时来源为 manual', () => {
    const db = buildDb();
    const result = handlers['import:commit'](db, {
      supplierId: null,
      rows: [{ ...row(), action: 'create' }],
    });
    expect(result).toEqual({ created: 1, priced: 1 });
    const products = core.listProducts(db);
    const prices = core.listPriceRecords(db, products[0].id);
    expect(prices[0].source).toBe('manual');
    expect(prices[0].supplierId).toBeNull();
  });

  it('supplierId 为不存在的供应商 id 时因外键约束抛错', () => {
    const db = buildDb();
    expect(() => handlers['import:commit'](db, {
      supplierId: 999999,
      rows: [{ ...row(), action: 'create' }],
    })).toThrow();
  });

  it('payload 未带 supplierId 字段时按 null 处理（manual）', () => {
    const db = buildDb();
    const result = handlers['import:commit'](db, { rows: [{ ...row(), action: 'create' }] });
    expect(result).toEqual({ created: 1, priced: 1 });
    const products = core.listProducts(db);
    const prices = core.listPriceRecords(db, products[0].id);
    expect(prices[0].source).toBe('manual');
  });
});

describe('ai:test', () => {
  it('未配置 AI 时抛「请先在设置中配置 AI 档案」', async () => {
    const db = buildDb();
    await expect(handlers['ai:test'](db, undefined)).rejects.toThrow('请先在设置中配置 AI 档案');
  });

  it('配置齐全时用 makeAiTestHandler 注入 stub testConnectionFn，返回其结果，不发真实网络请求', async () => {
    const db = buildDb();
    configureAi(db);
    const testConnectionFn = vi.fn().mockResolvedValue(true);
    const handler = makeAiTestHandler(testConnectionFn);
    const ok = await handler(db);
    expect(ok).toBe(true);
    expect(testConnectionFn).toHaveBeenCalledTimes(1);
    expect(testConnectionFn).toHaveBeenCalledWith({ protocol: 'openai', baseUrl: 'https://api.test', apiKey: 'sk-test', model: 'test-model' });
  });

  it('stub 返回 false 时 ai:test 也返回 false', async () => {
    const db = buildDb();
    configureAi(db);
    const testConnectionFn = vi.fn().mockResolvedValue(false);
    const handler = makeAiTestHandler(testConnectionFn);
    expect(await handler(db)).toBe(false);
  });

  it('传入 profileId 时按指定档案测试（逐档案测试连接），不依赖三用途绑定', async () => {
    const db = buildDb();
    configureAi(db); // 触发懒迁移，生成默认档案
    const ensureResult = handlers['aiProfiles:ensure'](db, undefined);
    const defaultProfileId = ensureResult.profiles[0].id;
    // 新增第二个档案，写回 aiProfiles，且不绑定任何用途
    const secondProfile = { id: 'p2', name: '备用档案', protocol: 'anthropic' as const, baseUrl: 'https://api.anthropic.test', apiKey: 'sk-2', model: 'claude-x' };
    handlers['settings:set'](db, { key: 'aiProfiles', value: JSON.stringify([...ensureResult.profiles, secondProfile]) });

    const testConnectionFn = vi.fn().mockResolvedValue(true);
    const handler = makeAiTestHandler(testConnectionFn);
    await handler(db, { profileId: secondProfile.id });
    expect(testConnectionFn).toHaveBeenCalledWith({ protocol: 'anthropic', baseUrl: 'https://api.anthropic.test', apiKey: 'sk-2', model: 'claude-x' });

    await handler(db, { profileId: defaultProfileId });
    expect(testConnectionFn).toHaveBeenLastCalledWith({ protocol: 'openai', baseUrl: 'https://api.test', apiKey: 'sk-test', model: 'test-model' });
  });

  it('profileId 指向不存在的档案时抛「请先在设置中配置 AI 档案」', async () => {
    const db = buildDb();
    configureAi(db);
    const handler = makeAiTestHandler(vi.fn());
    await expect(handler(db, { profileId: 'not-exist' })).rejects.toThrow('请先在设置中配置 AI 档案');
  });
});

describe('aiProfiles:ensure', () => {
  it('无任何配置时返回空档案列表与全空绑定', () => {
    const db = buildDb();
    const result = handlers['aiProfiles:ensure'](db, undefined);
    expect(result.profiles).toEqual([]);
    expect(result.bindings).toEqual({ text: null, vision: null, watch: null });
  });

  it('旧的单一 AI 配置齐全时懒迁移生成默认档案并三用途绑定指向它', () => {
    const db = buildDb();
    configureAi(db);
    const result = handlers['aiProfiles:ensure'](db, undefined);
    expect(result.profiles).toHaveLength(1);
    const p = result.profiles[0];
    expect(p).toMatchObject({ name: '默认档案', protocol: 'openai', baseUrl: 'https://api.test', apiKey: 'sk-test', model: 'test-model' });
    expect(typeof p.id).toBe('string');
    expect(p.id.length).toBeGreaterThan(0);
    expect(result.bindings).toEqual({ text: p.id, vision: p.id, watch: p.id });
  });

  it('旧 visionModel 非空时额外生成图片处理档案并绑定图片处理用途，文本/查价仍绑默认档案', () => {
    const db = buildDb();
    configureAi(db);
    handlers['settings:set'](db, { key: 'visionModel', value: 'vision-model-x' });
    const result = handlers['aiProfiles:ensure'](db, undefined);
    expect(result.profiles).toHaveLength(2);
    const defaultP = result.profiles.find((p: { name: string }) => p.name === '默认档案')!;
    const visionP = result.profiles.find((p: { name: string }) => p.name === '图片处理档案')!;
    expect(visionP).toMatchObject({ protocol: 'openai', baseUrl: 'https://api.test', apiKey: 'sk-test', model: 'vision-model-x' });
    expect(result.bindings).toEqual({ text: defaultP.id, vision: visionP.id, watch: defaultP.id });
  });

  it('旧 watchModel 非空时额外生成查价档案并绑定查价用途，与 visionModel 分支互不影响', () => {
    const db = buildDb();
    configureAi(db);
    handlers['settings:set'](db, { key: 'watchModel', value: 'watch-model-x' });
    const result = handlers['aiProfiles:ensure'](db, undefined);
    expect(result.profiles).toHaveLength(2);
    const defaultP = result.profiles.find((p: { name: string }) => p.name === '默认档案')!;
    const watchP = result.profiles.find((p: { name: string }) => p.name === '查价档案')!;
    expect(watchP).toMatchObject({ protocol: 'openai', baseUrl: 'https://api.test', apiKey: 'sk-test', model: 'watch-model-x' });
    expect(result.bindings).toEqual({ text: defaultP.id, vision: defaultP.id, watch: watchP.id });
  });

  it('vision 与 watch 旧模型同时非空时生成 3 个档案，三用途各自绑定', () => {
    const db = buildDb();
    configureAi(db);
    handlers['settings:set'](db, { key: 'visionModel', value: 'vision-model-x' });
    handlers['settings:set'](db, { key: 'watchModel', value: 'watch-model-x' });
    const result = handlers['aiProfiles:ensure'](db, undefined);
    expect(result.profiles).toHaveLength(3);
    expect(result.bindings.text).not.toBe(result.bindings.vision);
    expect(result.bindings.text).not.toBe(result.bindings.watch);
    expect(result.bindings.vision).not.toBe(result.bindings.watch);
  });

  it('已存在 aiProfiles 时幂等，不重复迁移（重复调用返回同一份档案）', () => {
    const db = buildDb();
    configureAi(db);
    const first = handlers['aiProfiles:ensure'](db, undefined);
    const second = handlers['aiProfiles:ensure'](db, undefined);
    expect(second.profiles).toEqual(first.profiles);
  });
});

describe('import:recognizeDrawing', () => {
  it('未配置 AI 时抛「请先在设置中配置 AI 档案」', async () => {
    const db = buildDb();
    await expect(handlers['import:recognizeDrawing'](db, { images: [{ mediaType: 'image/png', base64: 'AAAA' }] }))
      .rejects.toThrow('请先在设置中配置 AI 档案');
  });

  it('未设置 visionModel 时透传主 AI 配置的 model 给 chatFn', async () => {
    const db = buildDb();
    configureAi(db);
    const chatFn = vi.fn().mockResolvedValue(JSON.stringify([{ name: '大厅', items: [] }]));
    const handler = makeRecognizeDrawingHandler(chatFn);
    await handler(db, { images: [{ mediaType: 'image/png', base64: 'AAAA' }] });
    expect(chatFn).toHaveBeenCalledTimes(1);
    const cfgArg = chatFn.mock.calls[0][0] as AiConfig;
    expect(cfgArg.model).toBe('test-model');
  });

  it('设置 visionModel 后覆盖 model（非空覆盖，参照 readWatchAiConfig）', async () => {
    const db = buildDb();
    configureAi(db);
    handlers['settings:set'](db, { key: 'visionModel', value: 'vision-model-x' });
    const chatFn = vi.fn().mockResolvedValue(JSON.stringify([{ name: '大厅', items: [] }]));
    const handler = makeRecognizeDrawingHandler(chatFn);
    await handler(db, { images: [{ mediaType: 'image/png', base64: 'AAAA' }] });
    const cfgArg = chatFn.mock.calls[0][0] as AiConfig;
    expect(cfgArg.model).toBe('vision-model-x');
    expect(cfgArg.protocol).toBe('openai');
    expect(cfgArg.baseUrl).toBe('https://api.test');
    expect(cfgArg.apiKey).toBe('sk-test');
  });

  it('单图识别失败时 errors 从 core recognizeDrawing 透出到 handler 结果', async () => {
    const db = buildDb();
    configureAi(db);
    const chatFn = vi.fn().mockRejectedValueOnce(new Error('网络错误'));
    const handler = makeRecognizeDrawingHandler(chatFn);
    const result = await handler(db, { images: [{ mediaType: 'image/png', base64: 'AAAA' }] });
    expect(result.failedImages).toBe(1);
    expect(result.errors).toEqual(['第1张：网络错误']);
  });

  it('不支持的图片格式抛「不支持的图片格式」', async () => {
    const db = buildDb();
    configureAi(db);
    const handler = makeRecognizeDrawingHandler(vi.fn());
    await expect(handler(db, { images: [{ mediaType: 'image/gif', base64: 'AAAA' }] }))
      .rejects.toThrow('不支持的图片格式');
  });
});

describe('watch:recognizeScreenshot', () => {
  it('未配置 AI 时抛「请先在设置中配置 AI 档案」', async () => {
    const db = buildDb();
    await expect(handlers['watch:recognizeScreenshot'](db, { image: { mediaType: 'image/png', base64: 'AAAA' } }))
      .rejects.toThrow('请先在设置中配置 AI 档案');
  });

  it('用「图片处理」用途绑定档案（未设置 visionModel 时透传主 AI 配置的 model）', async () => {
    const db = buildDb();
    configureAi(db);
    const chatFn = vi.fn().mockResolvedValue(
      JSON.stringify({ found: true, name: 'A', spec: null, priceYuan: 100, shop: null, note: null }),
    );
    const handler = makeRecognizeScreenshotHandler(chatFn);
    const result = await handler(db, { image: { mediaType: 'image/png', base64: 'AAAA' } });
    expect(chatFn).toHaveBeenCalledTimes(1);
    const cfgArg = chatFn.mock.calls[0][0] as AiConfig;
    expect(cfgArg.model).toBe('test-model');
    expect(result.found).toBe(true);
    expect(result.priceCents).toBe(10000);
  });

  it('设置 visionModel 后覆盖 model', async () => {
    const db = buildDb();
    configureAi(db);
    handlers['settings:set'](db, { key: 'visionModel', value: 'vision-model-x' });
    const chatFn = vi.fn().mockResolvedValue(
      JSON.stringify({ found: false, name: null, spec: null, priceYuan: null, shop: null, note: null }),
    );
    const handler = makeRecognizeScreenshotHandler(chatFn);
    await handler(db, { image: { mediaType: 'image/png', base64: 'AAAA' } });
    const cfgArg = chatFn.mock.calls[0][0] as AiConfig;
    expect(cfgArg.model).toBe('vision-model-x');
  });

  it('不支持的图片格式抛「不支持的图片格式」', async () => {
    const db = buildDb();
    configureAi(db);
    const handler = makeRecognizeScreenshotHandler(vi.fn());
    await expect(handler(db, { image: { mediaType: 'image/gif', base64: 'AAAA' } }))
      .rejects.toThrow('不支持的图片格式');
  });

  it('AI 输出非法结构时抛出异常，不吞掉', async () => {
    const db = buildDb();
    configureAi(db);
    const chatFn = vi.fn().mockResolvedValue('不是JSON');
    const handler = makeRecognizeScreenshotHandler(chatFn);
    await expect(handler(db, { image: { mediaType: 'image/jpeg', base64: 'AAAA' } })).rejects.toThrow();
  });
});

describe('import:applyDrawing', () => {
  it('applyDrawing handler 全链路：在内存库造板块→handler apply→断言空间与行', async () => {
    const db = buildDb();
    const proj = handlers['projects:create'](db, { name: '测试项目' });
    const section = handlers['sections:create'](db, { projectId: proj.id, name: '硬件部分' });

    const result = await handlers['import:applyDrawing'](db, {
      sectionId: section.id,
      spaces: [
        {
          name: '主会议室',
          items: [
            { name: '65寸屏', qty: 2, remark: null, productId: null },
          ],
        },
        {
          name: '接待区',
          items: [
            { name: '摄像头', qty: 1, remark: '高清', productId: null },
          ],
        },
      ],
    });

    expect(result).toEqual({ spaces: 2, items: 2 });

    // 验证空间和行已创建
    const spaces = handlers['spaces:list'](db, section.id);
    expect(spaces).toHaveLength(2);
    expect(spaces[0].name).toBe('主会议室');
    expect(spaces[1].name).toBe('接待区');

    const itemsInSpace1 = handlers['items:list'](db, spaces[0].id);
    expect(itemsInSpace1).toHaveLength(1);
    expect(itemsInSpace1[0].snapshot.name).toBe('65寸屏');
    expect(itemsInSpace1[0].qty).toBe(2);

    const itemsInSpace2 = handlers['items:list'](db, spaces[1].id);
    expect(itemsInSpace2).toHaveLength(1);
    expect(itemsInSpace2[0].snapshot.name).toBe('摄像头');
    expect(itemsInSpace2[0].qty).toBe(1);
    expect(itemsInSpace2[0].remark).toBe('高清');
  });
});
