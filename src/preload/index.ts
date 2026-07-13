import { contextBridge, ipcRenderer } from 'electron';
import type { AiQuoteApi, WatchRoundSummary, UpdateEventPayload } from '../shared/api-types';

const invoke = (channel: string) => (payload?: unknown) => ipcRenderer.invoke(channel, payload);

const api: AiQuoteApi = {
  ping: invoke('ping'),

  suppliersList: invoke('suppliers:list'),
  suppliersCreate: invoke('suppliers:create'),
  suppliersUpdate: invoke('suppliers:update'),
  suppliersDelete: invoke('suppliers:delete'),

  productsList: invoke('products:list'),
  productsGet: invoke('products:get'),
  productsCreate: invoke('products:create'),
  productsUpdate: invoke('products:update'),
  productsDelete: invoke('products:delete'),
  productsSuggestBrands: invoke('products:suggestBrands'),
  productsRecognizeScreenshot: invoke('products:recognizeScreenshot'),

  pricesList: invoke('prices:list'),
  pricesAdd: invoke('prices:add'),
  pricesEffectiveCost: invoke('prices:effectiveCost'),

  projectsList: invoke('projects:list'),
  projectsCreate: invoke('projects:create'),
  projectsGet: invoke('projects:get'),
  projectsUpdate: invoke('projects:update'),
  projectsDelete: invoke('projects:delete'),
  projectsTotals: invoke('projects:totals'),

  sectionsList: invoke('sections:list'),
  sectionsCreate: invoke('sections:create'),
  sectionsUpdate: invoke('sections:update'),
  sectionsDelete: invoke('sections:delete'),

  spacesList: invoke('spaces:list'),
  spacesCreate: invoke('spaces:create'),
  spacesUpdate: invoke('spaces:update'),
  spacesDelete: invoke('spaces:delete'),

  templatesList: invoke('templates:list'),
  templatesGet: invoke('templates:get'),
  templatesCreate: invoke('templates:create'),
  templatesUpdate: invoke('templates:update'),
  templatesDelete: invoke('templates:delete'),

  exportTemplatesList: invoke('exportTemplates:list'),
  exportTemplatesGet: invoke('exportTemplates:get'),
  exportTemplatesCreate: invoke('exportTemplates:create'),
  exportTemplatesUpdate: invoke('exportTemplates:update'),
  exportTemplatesDelete: invoke('exportTemplates:delete'),
  exportTemplatesParseXlsx: invoke('exportTemplates:parseXlsx'),

  categoryTemplatesList: invoke('categoryTemplates:list'),
  categoryTemplatesGet: invoke('categoryTemplates:get'),
  categoryTemplatesCreate: invoke('categoryTemplates:create'),
  categoryTemplatesUpdate: invoke('categoryTemplates:update'),
  categoryTemplatesDelete: invoke('categoryTemplates:delete'),

  itemsList: invoke('items:list'),
  itemsCreateFromProduct: invoke('items:createFromProduct'),
  itemsCreateManual: invoke('items:createManual'),
  itemsReplaceProduct: invoke('items:replaceProduct'),
  itemsUpdate: invoke('items:update'),
  itemsDelete: invoke('items:delete'),
  itemsCheckStale: invoke('items:checkStale'),
  itemsRefreshSnapshot: invoke('items:refreshSnapshot'),
  itemsComputed: invoke('items:computed'),

  settingsGet: invoke('settings:get'),
  settingsSet: invoke('settings:set'),
  settingsSetLaunchAtLogin: invoke('settings:setLaunchAtLogin'),

  dialogPickDir: invoke('dialog:pickDir'),
  dialogPickFile: invoke('dialog:pickFile'),
  dialogPickDbFile: invoke('dialog:pickDbFile'),
  shellReveal: invoke('shell:reveal'),
  shellOpenExternal: invoke('shell:openExternal'),

  // 应用信息
  appVersion: invoke('app:version'),
  platform: process.platform,

  // 数据备份与还原
  backupRun: invoke('backup:run'),
  backupStageRestore: invoke('backup:stageRestore'),
  appRelaunch: invoke('app:relaunch'),

  exportRun: invoke('export:run'),

  importParse: invoke('import:parse'),
  importRecognize: invoke('import:recognize'),
  importRecognizeDrawing: invoke('import:recognizeDrawing'),
  importMatch: invoke('import:match'),
  importCommit: invoke('import:commit'),
  importApplyDrawing: invoke('import:applyDrawing'),
  aiTest: invoke('ai:test'),
  aiProfilesEnsure: invoke('aiProfiles:ensure'),

  // 概算
  estimateCategoriesList: invoke('estimate:categories:list'),
  estimateCategoriesCreate: invoke('estimate:categories:create'),
  estimateCategoriesUpdate: invoke('estimate:categories:update'),
  estimateCategoriesDelete: invoke('estimate:categories:delete'),
  estimateRowsList: invoke('estimate:rows:list'),
  estimateRowsCreate: invoke('estimate:rows:create'),
  estimateRowsUpdate: invoke('estimate:rows:update'),
  estimateRowsDelete: invoke('estimate:rows:delete'),
  estimateNormsList: invoke('estimate:norms:list'),
  estimateNormsCreate: invoke('estimate:norms:create'),
  estimateNormsUpdate: invoke('estimate:norms:update'),
  estimateNormsDelete: invoke('estimate:norms:delete'),
  estimateSeed: invoke('estimate:seed'),
  estimateAssemble: invoke('estimate:assemble'),

  // 规则
  rulesList: invoke('rules:list'),
  rulesGet: invoke('rules:get'),
  rulesCreate: invoke('rules:create'),
  rulesUpdate: invoke('rules:update'),
  rulesDelete: invoke('rules:delete'),
  rulesEvaluateItem: invoke('rules:evaluateItem'),
  rulesEvaluateProject: invoke('rules:evaluateProject'),
  rulesApply: invoke('rules:apply'),

  // 多供应商比价
  itemCostsList: invoke('itemCosts:list'),
  itemCostsCreate: invoke('itemCosts:create'),
  itemCostsUpdate: invoke('itemCosts:update'),
  itemCostsDelete: invoke('itemCosts:delete'),
  itemCostsSetActive: invoke('itemCosts:setActive'),
  itemCostsSeedFromPrices: invoke('itemCosts:seedFromPrices'),
  exportCostCompare: invoke('export:costCompare'),

  // 批量操作
  productsBatchDelete: invoke('products:batchDelete'),
  suppliersBatchDelete: invoke('suppliers:batchDelete'),
  projectsBatchDelete: invoke('projects:batchDelete'),
  rulesBatchDelete: invoke('rules:batchDelete'),
  estimateNormsBatchDelete: invoke('estimate:norms:batchDelete'),
  productsBatchSetCategories: invoke('products:batchSetCategories'),
  productsSetWatchPrice: invoke('products:setWatchPrice'),
  projectsBatchSetStatus: invoke('projects:batchSetStatus'),
  projectsDuplicate: invoke('projects:duplicate'),
  exportProducts: invoke('export:products'),
  exportSuppliers: invoke('export:suppliers'),

  // 询价单
  inquiriesCreate: invoke('inquiries:create'),
  inquiriesList: invoke('inquiries:list'),
  inquiriesGet: invoke('inquiries:get'),
  inquiriesDelete: invoke('inquiries:delete'),
  inquiriesSetReply: invoke('inquiries:setReply'),
  inquiriesWriteReply: invoke('inquiries:writeReply'),
  exportInquiry: invoke('export:inquiry'),

  // 统计分析
  analyticsSummary: invoke('analytics:summary'),
  analyticsProductProfit: invoke('analytics:productProfit'),
  analyticsProjectProfit: invoke('analytics:projectProfit'),
  analyticsPriceTrend: invoke('analytics:priceTrend'),
  analyticsPriceChanges: invoke('analytics:priceChanges'),

  // 查价监控
  watchRunNow: invoke('watch:runNow'),
  watchStatus: invoke('watch:status'),
  onWatchDone: (cb: (summary: WatchRoundSummary) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, summary: WatchRoundSummary) => cb(summary);
    ipcRenderer.on('watch:done', listener);
    return () => ipcRenderer.removeListener('watch:done', listener);
  },
  watchRecognizeScreenshot: invoke('watch:recognizeScreenshot'),

  // 软件更新
  updateCheck: invoke('update:check'),
  updateInstall: invoke('update:install'),
  updateStatus: invoke('update:status'),
  onUpdateEvent: (cb: (payload: UpdateEventPayload) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: UpdateEventPayload) => cb(payload);
    ipcRenderer.on('update:event', listener);
    return () => ipcRenderer.removeListener('update:event', listener);
  },
} satisfies AiQuoteApi;

contextBridge.exposeInMainWorld('api', api);

declare global {
  interface Window {
    api: AiQuoteApi;
  }
}
