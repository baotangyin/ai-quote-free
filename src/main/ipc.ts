import type { Db } from '../core/db/db';
import {
  createSupplier, listSuppliers, updateSupplier, deleteSupplier,
  createProduct, listProducts, getProduct, updateProduct, deleteProduct, suggestBrands, setWatchPrice,
  addPriceRecord, listPriceRecords, getEffectiveCost,
  createProject, listProjects, getProject, updateProject, deleteProject,
  createSection, listSections, updateSection, deleteSection,
  createSpace, listSpaces, updateSpace, deleteSpace,
  createLineItem, listLineItems, getLineItem, updateLineItem, deleteLineItem,
  takeSnapshot, isSnapshotStale, refreshSnapshot, lineTotals, projectTotals,
  createEstimateCategory, listEstimateCategories, updateEstimateCategory, deleteEstimateCategory,
  createEstimateRow, listEstimateRows, updateEstimateRow, deleteEstimateRow,
  createEstimateNorm, listEstimateNorms, updateEstimateNorm, deleteEstimateNorm,
  seedDefaultCategories, assembleEstimate,
  listRules, getRule, createRule, updateRule, deleteRule,
  evaluateItemTrigger, evaluateProjectTrigger,
  createLineItemCost, listLineItemCosts, updateLineItemCost, deleteLineItemCost,
  setActiveCost, seedCostsFromPrices,
  duplicateProject,
  listTemplates, getTemplate, createTemplate, updateTemplate, deleteTemplate, createProjectWithTemplate,
  listExportTemplates, getExportTemplate, createExportTemplate, updateExportTemplate, deleteExportTemplate,
  listCategoryTemplates, getCategoryTemplate, createCategoryTemplate, updateCategoryTemplate, deleteCategoryTemplate,
  applyCategoryDefaults,
  recognizeDrawing, applyDrawingToSection,
  listProductProfit, listProjectProfit, getAnalyticsSummary, listPriceTrend, listPriceChanges,
  replaceLineItemProduct, syncLinkedSpaces,
  createInquiry, listInquiries, getInquiry, deleteInquiry, setInquiryItemReply, writeReplyToPriceRecord,
} from '../core/index';
import { assembleExportModel } from '../core/export/model';
import { exportProjectToFiles } from '../core/export/exportProject';
import { exportCostCompareToFile } from '../core/export/exportCostCompare';
import { exportProductsToFile, exportSuppliersToFile } from '../core/export/exportSelection';
import { exportInquiryToFile } from '../core/export/exportInquiry';
import { getSetting, setSetting, getCostRule, getWatchAlertRate, ensureAiProfiles, getAiProfileFor, type AiProfile } from './settings';
import { parseWorkbook, trimGrid, splitSideBySide } from '../core/import/parseGrid';
import { recognizeSheet, type RecognizedRow } from '../core/import/recognize';
import { matchProduct } from '../core/import/match';
import { commitRows, type CommitRow } from '../core/import/commit';
import { parseTemplateFromGrid, type ChatFn } from '../core/import/templateFromXlsx';
import { chatComplete, testConnection, type AiConfig } from '../core/ai/client';
import type { VisionChatFn, DrawingImage } from '../core/import/drawingRecognize';
import { recognizeScreenshotPrice } from '../core/ai/screenshotPrice';
import { recognizeScreenshotProduct } from '../core/ai/screenshotProduct';
import { runNow, getStatus, type RunNowDeps } from './watchScheduler';
import { checkForUpdateAndSync, getUpdateStatus, installUpdate } from './updater';

export interface ImportBlock {
  sheetName: string;
  blockIndex: number;
  grid: string[][];
  rows: number;
  cols: number;
}

/** 解析一个 xls/xlsx 文件为 trim + 并排拆分后的块列表。 */
function parseImportFile(filePath: string): ImportBlock[] {
  const sheets = parseWorkbook(filePath);
  const result: ImportBlock[] = [];
  for (const sheet of sheets) {
    const trimmed = trimGrid(sheet.grid);
    const blocks = splitSideBySide(trimmed);
    blocks.forEach((grid, blockIndex) => {
      result.push({
        sheetName: sheet.name,
        blockIndex,
        grid,
        rows: grid.length,
        cols: grid[0]?.length ?? 0,
      });
    });
  }
  return result;
}

/** 读取文件首个有数据（trim 后非空）的 sheet，取其前 30 行文本网格。 */
function firstDataSheetGrid(filePath: string, maxRows = 30): string[][] {
  const sheets = parseWorkbook(filePath);
  for (const sheet of sheets) {
    const trimmed = trimGrid(sheet.grid);
    if (trimmed.length > 0) return trimmed.slice(0, maxRows);
  }
  return [];
}

/**
 * `exportTemplates:parseXlsx` handler 工厂：chatFn 可注入（默认真实 chatComplete），
 * 供测试注入 stub，避免真实网络请求。
 */
export function makeParseTemplateXlsxHandler(chatFn: typeof chatComplete = chatComplete) {
  return async (db: Db, payload: { filePath: string }) => {
    const cfg = readAiConfig(db);
    const grid = firstDataSheetGrid(payload.filePath);
    const chat: ChatFn = (messages, opts) => chatFn(cfg, messages, opts);
    return parseTemplateFromGrid(grid, chat);
  };
}

export function profileToAiConfig(profile: AiProfile): AiConfig {
  return { protocol: profile.protocol, baseUrl: profile.baseUrl, apiKey: profile.apiKey, model: profile.model };
}

/**
 * 按档案的 searchMode 生成注入到查价链路请求体的 extraBody（开启模型联网搜索）。
 * - zhipu：智谱 web_search 工具。
 * - dashscope：通义 enable_search 开关。
 * - minimax：MiniMax web_search 工具。
 * - custom：用户自填 JSON（searchCustomJson）原样注入；parse 失败时忽略（视为未配置）并 console.warn。
 * - none/缺省：不注入，返回 undefined。
 */
export function searchExtraBody(profile: AiProfile): Record<string, unknown> | undefined {
  switch (profile.searchMode) {
    case 'zhipu':
      return { tools: [{ type: 'web_search', web_search: { enable: true } }] };
    case 'dashscope':
      return { enable_search: true };
    case 'minimax':
      return { tools: [{ type: 'web_search' }] };
    case 'custom': {
      if (!profile.searchCustomJson) return undefined;
      try {
        return JSON.parse(profile.searchCustomJson) as Record<string, unknown>;
      } catch (err) {
        console.warn('AI档案联网搜索自定义参数 JSON 解析失败，已忽略：', err);
        return undefined;
      }
    }
    case 'none':
    default:
      return undefined;
  }
}

/** 从设置中解析「文本识别」用途绑定的 AI 档案；未配置任何档案（含懒迁移后仍为空）时中文报错。 */
export function readAiConfig(db: Db): AiConfig {
  const profile = getAiProfileFor(db, 'aiProfileText');
  if (!profile) throw new Error('请先在设置中配置 AI 档案');
  return profileToAiConfig(profile);
}

/** 查价专用 AI 档案：解析「定时查价」用途绑定的档案，未配置时中文报错。 */
export function readWatchAiProfile(db: Db): AiProfile {
  const profile = getAiProfileFor(db, 'aiProfileWatch');
  if (!profile) throw new Error('请先在设置中配置 AI 档案');
  return profile;
}

/** 查价专用 AI 配置：解析「定时查价」用途绑定的档案，未配置时中文报错。 */
export function readWatchAiConfig(db: Db): AiConfig {
  return profileToAiConfig(readWatchAiProfile(db));
}

/** 图纸识别（视觉）专用 AI 配置：解析「图片处理」用途绑定的档案，未配置时中文报错。 */
export function readVisionAiConfig(db: Db): AiConfig {
  const profile = getAiProfileFor(db, 'aiProfileVision');
  if (!profile) throw new Error('请先在设置中配置 AI 档案');
  return profileToAiConfig(profile);
}

/**
 * `import:recognize` handler 工厂：chatFn 可注入（默认真实 chatComplete），
 * 供测试注入 stub，避免真实网络请求，同时保持 handlers 表的 (db, payload) => any 形态。
 */
export function makeRecognizeHandler(chatFn: typeof chatComplete = chatComplete) {
  return async (db: Db, payload: { sheetName: string; grid: string[][] }) => {
    const cfg = readAiConfig(db);
    return recognizeSheet(cfg, payload.sheetName, payload.grid, { chatFn });
  };
}

/**
 * `ai:test` handler 工厂：testConnectionFn 可注入 stub，避免真实网络请求。
 * payload.profileId 非空时按 id 定位档案测试（供「逐档案测试连接」使用）；未传或档案不存在时
 * 回退到「文本识别」用途绑定的档案（与懒迁移前行为一致）。全部无档案时中文报错。
 */
export function makeAiTestHandler(testConnectionFn: typeof testConnection = testConnection) {
  return async (db: Db, payload?: { profileId?: string }) => {
    let profile: AiProfile | null = null;
    if (payload?.profileId) {
      const profiles = ensureAiProfiles(db);
      profile = profiles.find((p) => p.id === payload.profileId) ?? null;
    } else {
      profile = getAiProfileFor(db, 'aiProfileText');
    }
    if (!profile) throw new Error('请先在设置中配置 AI 档案');
    return testConnectionFn(profileToAiConfig(profile));
  };
}

/**
 * `aiProfiles:ensure` handler：供 Settings 页在打开 AI 配置区时调用——触发（若需要）懒迁移，
 * 返回当前档案列表与三个用途的「有效绑定」档案 id（绑定为空/失效时已回退到第一个档案，
 * 与 readAiConfig 系列的解析口径一致，UI 无需重复实现回退逻辑）。
 */
export function makeAiProfilesEnsureHandler() {
  return (db: Db) => {
    const profiles = ensureAiProfiles(db);
    return {
      profiles,
      bindings: {
        text: getAiProfileFor(db, 'aiProfileText')?.id ?? null,
        vision: getAiProfileFor(db, 'aiProfileVision')?.id ?? null,
        watch: getAiProfileFor(db, 'aiProfileWatch')?.id ?? null,
      },
    };
  };
}

/**
 * `import:recognizeDrawing` handler 工厂：chatFn 可注入 stub（默认真实 chatComplete），
 * 供测试注入 stub，避免真实网络请求。
 * 图片 mediaType 在入参校验：只支持 png/jpeg/webp，否则抛错。
 */
export function makeRecognizeDrawingHandler(chatFn: typeof chatComplete = chatComplete) {
  return async (db: Db, payload: { images: { mediaType: string; base64: string }[] }) => {
    const cfg = readVisionAiConfig(db);
    // 校验 mediaType：只支持 png/jpeg/webp
    const images: DrawingImage[] = [];
    for (const img of payload.images) {
      const mediaType = img.mediaType.toLowerCase();
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(mediaType)) {
        throw new Error('不支持的图片格式');
      }
      images.push({
        mediaType: mediaType as DrawingImage['mediaType'],
        base64: img.base64,
      });
    }
    const chat: VisionChatFn = (messages, opts) => chatFn(cfg, messages, opts);
    return recognizeDrawing(chat, images);
  };
}

/**
 * 当前应用版本：index.ts 在 app.whenReady 后经 setAppVersion(app.getVersion()) 注入，
 * 未注入时（如测试直接调用 handlers 表）默认 'dev'——checkForUpdate 会把 'dev' 当作旧版本，
 * 只要 GitHub 上存在任意合法 tag 就判定为有更新，行为可预期不抛错。
 */
let appVersion = 'dev';
export function setAppVersion(v: string): void {
  appVersion = v;
}

/**
 * `watch:runNow` handler 工厂：chatFn 可注入（默认真实 chatComplete），供测试注入 stub。
 * runNowDeps 可注入 broadcast/notify（默认使用 watchScheduler 内的 electron 实现），
 * 测试中不传即可，因为首轮无历史价格基线时不会产生 alerts，不会触发默认 Notification 路径。
 */
export function makeWatchRunNowHandler(chatFn: typeof chatComplete = chatComplete, runNowDeps: RunNowDeps = {}) {
  return async (db: Db) => {
    const profile = readWatchAiProfile(db);
    const cfg = profileToAiConfig(profile);
    const extraBody = searchExtraBody(profile);
    const chat: VisionChatFn = (messages, opts) => chatFn(cfg, messages, { ...opts, extraBody });
    return runNow(db, chat, { costRule: getCostRule(db), alertRate: getWatchAlertRate(db) }, runNowDeps);
  };
}

/**
 * `watch:recognizeScreenshot` handler 工厂：chatFn 可注入 stub（默认真实 chatComplete），
 * 供测试注入 stub，避免真实网络请求。用「图片处理」用途绑定的档案（与图纸识别一致），
 * 只做用户手动截图的识别，不做任何自动访问页面的行为；结果不落库。
 * 图片 mediaType 在入参校验：只支持 png/jpeg/webp，否则抛错。
 */
export function makeRecognizeScreenshotHandler(chatFn: typeof chatComplete = chatComplete) {
  return async (db: Db, payload: { image: { mediaType: string; base64: string } }) => {
    const cfg = readVisionAiConfig(db);
    const mediaType = payload.image.mediaType.toLowerCase();
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(mediaType)) {
      throw new Error('不支持的图片格式');
    }
    const chat: VisionChatFn = (messages, opts) => chatFn(cfg, messages, opts);
    return recognizeScreenshotPrice(chat, {
      mediaType: mediaType as 'image/png' | 'image/jpeg' | 'image/webp',
      base64: payload.image.base64,
    });
  };
}

/**
 * `products:recognizeScreenshot` handler 工厂：chatFn 可注入 stub（默认真实 chatComplete），
 * 供测试注入 stub，避免真实网络请求。用「图片处理」用途绑定的档案（与图纸识别/截图识价一致），
 * 只做用户手动截图的产品信息识别，不做任何自动访问页面的行为；结果不落库，由 UI 决定是否
 * 填表/写入价格记录。图片 mediaType 在入参校验：只支持 png/jpeg/webp，否则抛错。
 */
export function makeRecognizeScreenshotProductHandler(chatFn: typeof chatComplete = chatComplete) {
  return async (db: Db, payload: { image: { mediaType: string; base64: string } }) => {
    const cfg = readVisionAiConfig(db);
    const mediaType = payload.image.mediaType.toLowerCase();
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(mediaType)) {
      throw new Error('不支持的图片格式');
    }
    const chat: VisionChatFn = (messages, opts) => chatFn(cfg, messages, opts);
    return recognizeScreenshotProduct(chat, {
      mediaType: mediaType as 'image/png' | 'image/jpeg' | 'image/webp',
      base64: payload.image.base64,
    });
  };
}

/**
 * `import:applyDrawing` handler 工厂。
 */
export function makeApplyDrawingHandler() {
  return (db: Db, payload: { sectionId: number; spaces: unknown[] }) => {
    const costRule = getCostRule(db);
    return applyDrawingToSection(db, payload.sectionId, payload.spaces as any, costRule);
  };
}

/** 通过板块 id 找到所属项目 id。 */
function findProjectIdForSection(db: Db, sectionId: number): number {
  const r = db.prepare('SELECT project_id AS projectId FROM sections WHERE id=?').get(sectionId) as { projectId: number } | undefined;
  if (!r) throw new Error(`section ${sectionId} not found`);
  return r.projectId;
}

/** 判断 sectionId 是否为其项目内 sort_order 最小的板块（联动源）。 */
function isSourceSection(db: Db, projectId: number, sectionId: number): boolean {
  const sections = listSections(db, projectId);
  return sections.length > 0 && sections[0].id === sectionId;
}

/**
 * `spaces:create` handler：建空间后，若该空间所属板块 = 项目内 sort_order 最小板块（联动源）
 * 且新空间非置底（pinBottom=true 的空间不参与联动，见 spec §6），则事务外调用 syncLinkedSpaces
 * （core 函数自带事务）向其它 link_spaces=1 的板块同步新建同名空间。返回值附加 syncedSections
 * （交叉类型可选字段，不破坏既有 Space 返回结构）。
 */
function handleSpacesCreate(db: Db, payload: { sectionId: number; name: string; description?: string; area?: number; pinBottom?: boolean }) {
  const space = createSpace(db, payload);
  if (payload.pinBottom) return space;
  const projectId = findProjectIdForSection(db, payload.sectionId);
  if (!isSourceSection(db, projectId, payload.sectionId)) return space;
  const syncedSections = syncLinkedSpaces(db, projectId, { type: 'create', name: payload.name });
  return { ...space, syncedSections };
}

/**
 * `spaces:update` handler：改空间前先读取改前状态（sectionId/name/pinBottom）。
 * 仅当该空间所属板块为联动源、空间本身非置底、且 patch 中 name 实际发生变化时，
 * 事务外调用 syncLinkedSpaces 做 rename 同步（oldName=改前名）。返回值同 create 附加 syncedSections。
 */
function handleSpacesUpdate(db: Db, payload: { id: number; patch: Record<string, unknown> }) {
  const before = db.prepare('SELECT section_id AS sectionId, name, pin_bottom AS pinBottom FROM spaces WHERE id=?')
    .get(payload.id) as { sectionId: number; name: string; pinBottom: number } | undefined;
  const space = updateSpace(db, payload.id, payload.patch as any);
  if (!before || before.pinBottom) return space;
  const newName = payload.patch?.name as string | undefined;
  if (newName === undefined || newName === before.name) return space;
  const projectId = findProjectIdForSection(db, before.sectionId);
  if (!isSourceSection(db, projectId, before.sectionId)) return space;
  const syncedSections = syncLinkedSpaces(db, projectId, { type: 'rename', name: newName, oldName: before.name });
  return { ...space, syncedSections };
}

/** 通过清单行 id 找到所属项目 id（core 未提供跨层反查，这里只做数据回溯，不含业务计算） */
function findProjectIdForItem(db: Db, itemId: number): number {
  const r = db.prepare(`
    SELECT sec.project_id AS projectId
    FROM line_items li
    JOIN spaces sp ON sp.id = li.space_id
    JOIN sections sec ON sec.id = sp.section_id
    WHERE li.id = ?
  `).get(itemId) as { projectId: number } | undefined;
  if (!r) throw new Error(`line item ${itemId} not found`);
  return r.projectId;
}

/** 将选中的候选配套项批量加入某空间：逐项取生效成本→快照→建行。返回创建数与跳过数。 */
function applyCandidates(db: Db, payload: { spaceId: number; items: { productId: number; qty: number }[] }): { created: number; skipped: number } {
  let created = 0, skipped = 0;
  for (const it of payload.items) {
    const product = getProduct(db, it.productId);
    if (!product) { skipped++; continue; }
    const cost = getEffectiveCost(db, it.productId, getCostRule(db));
    if (cost == null) { skipped++; continue; }  // 无价格记录，无法建成本快照
    const snapshot = takeSnapshot(product, cost, []);
    createLineItem(db, { spaceId: payload.spaceId, productId: it.productId, snapshot, qty: it.qty });
    created++;
  }
  return { created, skipped };
}

/** 事务内逐个删除 ids，返回删除条数。del 为既有单条删除函数。 */
function batchDelete(db: Db, ids: number[], del: (db: Db, id: number) => void): number {
  const run = db.transaction(() => { let n = 0; for (const id of ids) { del(db, id); n++; } return n; });
  return run();
}

/** 批量设置产品分类：replace 直接覆盖；append 在原分类后去重合并（保序）。跳过不存在产品，返回更新数。 */
function batchSetCategories(
  db: Db, payload: { ids: number[]; categories: string[]; mode: 'replace' | 'append' },
): number {
  const run = db.transaction(() => {
    let n = 0;
    for (const id of payload.ids) {
      const p = getProduct(db, id);
      if (!p) continue;
      let newCats: string[];
      if (payload.mode === 'replace') {
        newCats = payload.categories;
      } else {
        newCats = [...p.categories];
        for (const c of payload.categories) if (!newCats.includes(c)) newCats.push(c);
      }
      updateProduct(db, id, { categories: newCats });
      n++;
    }
    return n;
  });
  return run();
}

/** 批量设置项目状态，返回更新数。 */
function batchSetStatus(db: Db, payload: { ids: number[]; status: 'draft' | 'done' }): number {
  const run = db.transaction(() => {
    let n = 0;
    for (const id of payload.ids) { updateProject(db, id, { status: payload.status }); n++; }
    return n;
  });
  return run();
}

export const handlers: Record<string, (db: Db, payload: any) => any> = {
  // 供应商
  'suppliers:list': (db) => listSuppliers(db),
  'suppliers:create': (db, payload) => createSupplier(db, payload),
  'suppliers:update': (db, payload) => updateSupplier(db, payload.id, payload.patch),
  'suppliers:delete': (db, payload) => { deleteSupplier(db, payload); return null; },

  // 产品
  'products:list': (db, payload) => listProducts(db, payload),
  'products:get': (db, payload) => getProduct(db, payload),
  'products:create': (db, payload) => createProduct(
    db,
    applyCategoryDefaults(db, payload.categories ?? (payload.category ? [payload.category] : []), payload),
  ),
  'products:update': (db, payload) => updateProduct(db, payload.id, payload.patch),
  'products:delete': (db, payload) => { deleteProduct(db, payload); return null; },
  'products:suggestBrands': (db, payload) => suggestBrands(db, payload),
  'products:recognizeScreenshot': makeRecognizeScreenshotProductHandler(),

  // 价格
  'prices:list': (db, payload) => listPriceRecords(db, payload),
  'prices:add': (db, payload) => addPriceRecord(db, payload),
  'prices:effectiveCost': (db, payload) => getEffectiveCost(db, payload, getCostRule(db)),

  // 项目
  'projects:list': (db) => listProjects(db),
  'projects:create': (db, payload) => createProjectWithTemplate(db, payload),
  'projects:get': (db, payload) => getProject(db, payload),
  'projects:update': (db, payload) => updateProject(db, payload.id, payload.patch),
  'projects:delete': (db, payload) => { deleteProject(db, payload); return null; },
  'projects:totals': (db, payload) => {
    const model = assembleExportModel(db, payload);
    const sections = model.sections.map((s) => ({ id: s.section.id, name: s.section.name, totals: s.totals }));
    const totals = projectTotals(model.sections.map((s) => s.totals));
    return { sections, projectTotals: totals };
  },

  // 板块
  'sections:list': (db, payload) => listSections(db, payload),
  'sections:create': (db, payload) => createSection(db, payload),
  'sections:update': (db, payload) => updateSection(db, payload.id, payload.patch),
  'sections:delete': (db, payload) => { deleteSection(db, payload); return null; },

  // 空间
  'spaces:list': (db, payload) => listSpaces(db, payload),
  'spaces:create': (db, payload) => handleSpacesCreate(db, payload),
  'spaces:update': (db, payload) => handleSpacesUpdate(db, payload),
  'spaces:delete': (db, payload) => { deleteSpace(db, payload); return null; },

  // 项目类型模板
  'templates:list': (db) => listTemplates(db),
  'templates:get': (db, payload) => getTemplate(db, payload),
  'templates:create': (db, payload) => createTemplate(db, payload),
  'templates:update': (db, payload) => updateTemplate(db, payload.id, payload.patch),
  'templates:delete': (db, payload) => { deleteTemplate(db, payload); return null; },

  // 清单行
  'items:list': (db, payload) => listLineItems(db, payload),
  'items:createFromProduct': (db, payload) => {
    const product = getProduct(db, payload.productId);
    if (!product) throw new Error(`product ${payload.productId} not found`);
    const cost = getEffectiveCost(db, payload.productId, getCostRule(db));
    if (cost == null) throw new Error('该产品无价格记录');
    const snapshot = takeSnapshot(product, cost, payload.options ?? []);
    return createLineItem(db, {
      spaceId: payload.spaceId, productId: payload.productId, snapshot, qty: payload.qty ?? 1,
    });
  },
  'items:createManual': (db, payload) => createLineItem(db, {
    spaceId: payload.spaceId, snapshot: payload.snapshot, qty: payload.qty ?? 1,
  }),
  // 换产品：core replaceLineItemProduct 内 getEffectiveCost 取不到按 0 处理（与 import:applyDrawing
  // 一致的既有惯例），IPC 层不额外抛错——成本 0 可在换产品后由用户补录价格、经
  // items:checkStale/items:refreshSnapshot 刷新，或后续价格入库后自然纠正。
  'items:replaceProduct': (db, payload) => replaceLineItemProduct(db, payload.itemId, payload.productId, payload.optionNames ?? [], getCostRule(db)),
  'items:update': (db, payload) => updateLineItem(db, payload.id, payload.patch),
  'items:delete': (db, payload) => { deleteLineItem(db, payload); return null; },
  'items:checkStale': (db, payload) => {
    const item = getLineItem(db, payload);
    if (!item) throw new Error(`line item ${payload} not found`);
    return isSnapshotStale(db, item, getCostRule(db));
  },
  'items:refreshSnapshot': (db, payload) => refreshSnapshot(db, payload, getCostRule(db)),
  'items:computed': (db, payload) => {
    const item = getLineItem(db, payload);
    if (!item) throw new Error(`line item ${payload} not found`);
    const project = getProject(db, findProjectIdForItem(db, payload));
    if (!project) throw new Error(`project for item ${payload} not found`);
    return lineTotals(item, project);
  },

  // 设置
  'settings:get': (db, payload) => getSetting(db, payload),
  'settings:set': (db, payload) => { setSetting(db, payload.key, payload.value); return null; },

  // 导出模板
  'exportTemplates:list': (db) => listExportTemplates(db),
  'exportTemplates:get': (db, payload) => getExportTemplate(db, payload),
  'exportTemplates:create': (db, payload) => createExportTemplate(db, payload),
  'exportTemplates:update': (db, payload) => updateExportTemplate(db, payload.id, payload.patch),
  'exportTemplates:delete': (db, payload) => { deleteExportTemplate(db, payload); return null; },
  'exportTemplates:parseXlsx': makeParseTemplateXlsxHandler(),

  // 类别参数模板
  'categoryTemplates:list': (db) => listCategoryTemplates(db),
  'categoryTemplates:get': (db, payload) => getCategoryTemplate(db, payload),
  'categoryTemplates:create': (db, payload) => createCategoryTemplate(db, payload),
  'categoryTemplates:update': (db, payload) => updateCategoryTemplate(db, payload.id, payload.patch),
  'categoryTemplates:delete': (db, payload) => { deleteCategoryTemplate(db, payload); return null; },

  // 导出
  'export:run': (db, payload) => exportProjectToFiles(db, payload.projectId, payload.outDir, payload.templateId),

  // 导入
  'import:parse': (_db, payload) => parseImportFile(payload.filePath),
  'import:recognize': makeRecognizeHandler(),
  'import:recognizeDrawing': makeRecognizeDrawingHandler(),
  'import:match': (db, payload) => (payload.rows as RecognizedRow[]).map((row) => ({
    ...row,
    match: matchProduct(db, row),
  })),
  'import:commit': (db, payload) => commitRows(db, payload.supplierId ?? null, payload.rows as CommitRow[]),
  'import:applyDrawing': makeApplyDrawingHandler(),

  // AI
  'ai:test': makeAiTestHandler(),
  'aiProfiles:ensure': makeAiProfilesEnsureHandler(),

  // 查价监控
  'watch:runNow': makeWatchRunNowHandler(),
  'watch:status': (db) => getStatus(db),
  'watch:recognizeScreenshot': makeRecognizeScreenshotHandler(),

  // 软件更新
  'update:check': (db) => checkForUpdateAndSync(db, appVersion),
  'update:install': () => installUpdate(),
  'update:status': () => getUpdateStatus(),

  // 概算
  'estimate:categories:list': (db, payload) => listEstimateCategories(db, payload),
  'estimate:categories:create': (db, payload) => createEstimateCategory(db, payload),
  'estimate:categories:update': (db, payload) => updateEstimateCategory(db, payload.id, payload.patch),
  'estimate:categories:delete': (db, payload) => { deleteEstimateCategory(db, payload); return null; },
  'estimate:rows:list': (db, payload) => listEstimateRows(db, payload),
  'estimate:rows:create': (db, payload) => createEstimateRow(db, payload),
  'estimate:rows:update': (db, payload) => updateEstimateRow(db, payload.id, payload.patch),
  'estimate:rows:delete': (db, payload) => { deleteEstimateRow(db, payload); return null; },
  'estimate:norms:list': (db) => listEstimateNorms(db),
  'estimate:norms:create': (db, payload) => createEstimateNorm(db, payload),
  'estimate:norms:update': (db, payload) => updateEstimateNorm(db, payload.id, payload.patch),
  'estimate:norms:delete': (db, payload) => { deleteEstimateNorm(db, payload); return null; },
  'estimate:seed': (db, payload) => seedDefaultCategories(db, payload),
  'estimate:assemble': (db, payload) => assembleEstimate(db, payload),

  // 规则
  'rules:list': (db) => listRules(db),
  'rules:get': (db, payload) => getRule(db, payload),
  'rules:create': (db, payload) => createRule(db, payload),
  'rules:update': (db, payload) => updateRule(db, payload.id, payload.patch),
  'rules:delete': (db, payload) => { deleteRule(db, payload); return null; },
  'rules:evaluateItem': (db, payload) => evaluateItemTrigger(db, payload.projectId, payload.itemId),
  'rules:evaluateProject': (db, payload) => evaluateProjectTrigger(db, payload),
  'rules:apply': (db, payload) => applyCandidates(db, payload),

  // 多供应商比价
  'itemCosts:list': (db, payload) => listLineItemCosts(db, payload),
  'itemCosts:create': (db, payload) => createLineItemCost(db, payload),
  'itemCosts:update': (db, payload) => updateLineItemCost(db, payload.id, payload.patch),
  'itemCosts:delete': (db, payload) => { deleteLineItemCost(db, payload); return null; },
  'itemCosts:setActive': (db, payload) => setActiveCost(db, payload),
  'itemCosts:seedFromPrices': (db, payload) => seedCostsFromPrices(db, payload),
  'export:costCompare': (db, payload) => exportCostCompareToFile(db, payload.projectId, payload.outDir),

  // 批量操作
  'products:batchDelete': (db, payload) => batchDelete(db, payload, deleteProduct),
  'suppliers:batchDelete': (db, payload) => batchDelete(db, payload, deleteSupplier),
  'projects:batchDelete': (db, payload) => batchDelete(db, payload, deleteProject),
  'rules:batchDelete': (db, payload) => batchDelete(db, payload, deleteRule),
  'estimate:norms:batchDelete': (db, payload) => batchDelete(db, payload, deleteEstimateNorm),
  'products:batchSetCategories': (db, payload) => batchSetCategories(db, payload),
  'products:setWatchPrice': (db, payload) => setWatchPrice(db, payload.ids, payload.watch),
  'projects:batchSetStatus': (db, payload) => batchSetStatus(db, payload),
  'projects:duplicate': (db, payload) => duplicateProject(db, payload),
  'export:products': (db, payload) => exportProductsToFile(db, payload.ids, payload.outDir, getCostRule(db)),
  'export:suppliers': (db, payload) => exportSuppliersToFile(db, payload.ids, payload.outDir),

  // 询价单
  'inquiries:create': (db, payload) => createInquiry(db, payload),
  'inquiries:list': (db, payload) => listInquiries(db, payload),
  'inquiries:get': (db, payload) => getInquiry(db, payload),
  'inquiries:delete': (db, payload) => { deleteInquiry(db, payload); return null; },
  'inquiries:setReply': (db, payload) => setInquiryItemReply(db, payload.itemId, payload.replyPriceCents),
  'inquiries:writeReply': (db, payload) => writeReplyToPriceRecord(db, payload),
  'export:inquiry': (db, payload) => exportInquiryToFile(db, payload.inquiryId, payload.outDir),

  // 统计分析
  'analytics:summary': (db, payload) => getAnalyticsSummary(db, payload),
  'analytics:productProfit': (db, payload) => listProductProfit(db, payload),
  'analytics:projectProfit': (db, payload) => listProjectProfit(db, payload),
  'analytics:priceTrend': (db, payload) => listPriceTrend(db, payload.productId, payload),
  'analytics:priceChanges': (db, payload) => listPriceChanges(db, payload, payload.limit),
};

export interface IpcMainLike {
  handle(channel: string, fn: (...args: any[]) => any): void;
}

/**
 * 注册所有 IPC handler。
 */
export function registerIpc(ipcMain: IpcMainLike, db: Db): void {
  for (const [channel, fn] of Object.entries(handlers)) {
    ipcMain.handle(channel, (_event: unknown, payload: any) => {
      return fn(db, payload);
    });
  }
}
