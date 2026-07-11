import type {
  Supplier, Product, ProductOption, PriceRecord, PriceSource,
  Project, Section, Space, LineItem, LineItemSnapshot,
  CostRule, QuoteMode, RoundRule, Cents,
  EstimateCategory, EstimateRow, EstimateNorm, EstimateValueMethod,
  BomRule, RuleAction, RuleTriggerType,
  LineItemCost,
  ProjectTypeTemplate, TemplateSection, TemplateSpace,
  ExportTemplate, ExportTemplateConfig, ExportTemplateVersion, TemplateColumn,
  CategoryParamTemplate, CategoryParamDefaults,
  Inquiry, InquiryItem, InquiryDetail,
} from '../core/domain/types';
import type { LineTotals, SectionTotals } from '../core/domain/pricing';
import type { CreateInquiryItemInput } from '../core/repo/inquiries';
import type { AssembledEstimate } from '../core/domain/estimate';
import type { CandidateItem } from '../core/domain/rules-engine';
import type { RecognizedRow } from '../core/import/recognize';
import type { MatchResult } from '../core/import/match';
import type { CommitRow } from '../core/import/commit';
import type { ParsedTemplateDraft } from '../core/import/templateFromXlsx';
import type { DrawingItem, DrawingSpace } from '../core/domain/types';
import type { ApplyDrawingItem, ApplyDrawingSpace } from '../core/import/applyDrawing';
import type { AnalyticsFilter, ProductProfitRow, ProjectProfitRow, PriceTrendPoint, PriceChangeRow, AnalyticsSummary } from '../core/analytics/analytics';
import type { WatchRoundSummary } from '../core/ai/priceSearch';
import type { UpdateCheckResult, UpdateStatus, UpdateEventPayload } from '../main/updater';
import type { AiProfile } from '../main/settings';

// 领域类型经由 shared 契约层 re-export，renderer 不得直接 import src/core。
export type {
  Supplier, Product, PriceRecord, PriceSource, Project, Section, Space,
  LineItem, LineItemSnapshot, ProductOption, CostRule, QuoteMode, RoundRule, Cents,
  EstimateCategory, EstimateRow, EstimateNorm, EstimateValueMethod,
  ProjectTypeTemplate, TemplateSection, TemplateSpace,
  ExportTemplate, ExportTemplateConfig, ExportTemplateVersion, TemplateColumn,
  CategoryParamTemplate, CategoryParamDefaults,
  Inquiry, InquiryItem, InquiryDetail,
} from '../core/domain/types';
export type { BomRule, RuleAction, RuleTriggerType, LineItemCost } from '../core/domain/types';
export type { CreateInquiryItemInput } from '../core/repo/inquiries';
export type { LineTotals, SectionTotals } from '../core/domain/pricing';
export type { AssembledEstimate, AssembledEstimateCategory, AssembledEstimateRow } from '../core/domain/estimate';
export type { CandidateItem } from '../core/domain/rules-engine';
export type { RecognizedRow } from '../core/import/recognize';
export type { MatchResult } from '../core/import/match';
export type { CommitRow } from '../core/import/commit';
export type { ParsedTemplateDraft } from '../core/import/templateFromXlsx';
export type { DrawingItem, DrawingSpace } from '../core/domain/types';
export type { ApplyDrawingItem, ApplyDrawingSpace } from '../core/import/applyDrawing';
export type { AnalyticsFilter, ProductProfitRow, ProjectProfitRow, PriceTrendPoint, PriceChangeRow, AnalyticsSummary } from '../core/analytics/analytics';
export type { WatchRoundSummary } from '../core/ai/priceSearch';
export type { UpdateCheckResult, UpdateStatus, UpdateEventPayload } from '../main/updater';
export type { AiProfile } from '../main/settings';

export interface ProjectTotalsResult {
  sections: { id: number; name: string; totals: SectionTotals }[];
  projectTotals: { totalCents: Cents; costTotalCents: Cents; profitCents: Cents };
}

/** import:parse 通道返回的单个块（sheet 经 trim + 并排拆分后的一段网格）。 */
export interface ImportBlock {
  sheetName: string;
  blockIndex: number;
  grid: string[][];
  rows: number;
  cols: number;
}

/** import:recognize 通道返回结果。 */
export interface ImportRecognizeResult {
  rows: RecognizedRow[];
  dropped: number;
  failedChunks: number;
  /** 输出被截断但抢救出部分行的分块数（可能有更多行因截断而永久丢失，具体数量不可知）。 */
  truncatedChunks: number;
}

export interface AiQuoteApi {
  ping(): Promise<string>;

  // 供应商
  suppliersList(): Promise<Supplier[]>;
  suppliersCreate(input: { name: string; contact?: string; note?: string; phone?: string; address?: string; paymentTerms?: string; bankInfo?: string }): Promise<Supplier>;
  suppliersUpdate(input: { id: number; patch: Partial<{ name: string; contact: string | null; note: string | null; phone: string | null; address: string | null; paymentTerms: string | null; bankInfo: string | null }> }): Promise<Supplier>;
  suppliersDelete(id: number): Promise<null>;

  // 产品
  productsList(filter?: { category?: string; keyword?: string }): Promise<Product[]>;
  productsGet(id: number): Promise<Product | null>;
  productsCreate(input: {
    name: string; unit: string;
    category?: string; categories?: string[];
    brand?: string | null; model?: string | null;
    recommendedBrands?: string[];
    paramsCore?: string | null; paramsBid?: string | null; paramsTender?: string | null;
    dims?: string | null;
    power220W?: number; power380W?: number;
    rackU?: number; seqPowerPorts?: number; netPorts?: number; comPorts?: number;
    imagePath?: string | null; note?: string | null;
    options?: ProductOption[];
    costRuleOverride?: CostRule | null;
  }): Promise<Product>;
  productsUpdate(input: { id: number; patch: Partial<Omit<Product, 'id' | 'createdAt' | 'updatedAt'>> }): Promise<Product>;
  productsDelete(id: number): Promise<null>;
  productsSuggestBrands(input: { brand?: string | null; categories: string[]; excludeProductId?: number }): Promise<string[]>;

  // 价格
  pricesList(productId: number): Promise<PriceRecord[]>;
  pricesAdd(input: {
    productId: number; source: PriceSource; priceCents: Cents;
    supplierId?: number; sourceUrl?: string; capturedAt?: string;
  }): Promise<PriceRecord>;
  pricesEffectiveCost(productId: number): Promise<Cents | null>;

  // 项目
  projectsList(): Promise<Project[]>;
  projectsCreate(input: { name: string; client?: string; mode?: QuoteMode; defaultMargin?: number; roundRule?: RoundRule; projectType?: string | null }): Promise<Project>;
  projectsGet(id: number): Promise<Project | null>;
  projectsUpdate(input: { id: number; patch: Partial<{ name: string; client: string | null; mode: QuoteMode; defaultMargin: number; roundRule: RoundRule; status: 'draft' | 'done'; projectType: string | null }> }): Promise<Project>;
  projectsDelete(id: number): Promise<null>;
  projectsTotals(projectId: number): Promise<ProjectTotalsResult>;

  // 板块
  sectionsList(projectId: number): Promise<Section[]>;
  sectionsCreate(input: { projectId: number; name: string; integrationFeeRate?: number; isHardware?: boolean; subtotalLabel?: string | null; feeLabel?: string | null; linkSpaces?: boolean }): Promise<Section>;
  sectionsUpdate(input: { id: number; patch: Partial<{ name: string; sortOrder: number; integrationFeeRate: number; isHardware: boolean; subtotalLabel: string | null; feeLabel: string | null; linkSpaces: boolean }> }): Promise<Section>;
  sectionsDelete(id: number): Promise<null>;

  // 空间
  spacesList(sectionId: number): Promise<Space[]>;
  /** syncedSections：本次操作触发板块空间联动同步的目标板块数（仅源板块内非置底空间新建时可能 >0），renderer 有值且>0 时提示。 */
  spacesCreate(input: { sectionId: number; name: string; description?: string; area?: number; pinBottom?: boolean }): Promise<Space & { syncedSections?: number }>;
  spacesUpdate(input: { id: number; patch: Partial<{ name: string; description: string | null; sortOrder: number; area: number | null; pinBottom: boolean }> }): Promise<Space & { syncedSections?: number }>;
  spacesDelete(id: number): Promise<null>;

  // 项目类型模板
  templatesList(): Promise<ProjectTypeTemplate[]>;
  templatesGet(id: number): Promise<ProjectTypeTemplate | null>;
  templatesCreate(input: { projectType: string; sections: TemplateSection[] }): Promise<ProjectTypeTemplate>;
  templatesUpdate(input: { id: number; patch: Partial<{ projectType: string; sections: TemplateSection[] }> }): Promise<ProjectTypeTemplate>;
  templatesDelete(id: number): Promise<null>;

  // 导出模板
  exportTemplatesList(): Promise<ExportTemplate[]>;
  exportTemplatesGet(id: number): Promise<ExportTemplate | null>;
  exportTemplatesCreate(input: { name: string; config: ExportTemplateConfig }): Promise<ExportTemplate>;
  exportTemplatesUpdate(input: { id: number; patch: Partial<{ name: string; config: ExportTemplateConfig }> }): Promise<ExportTemplate>;
  exportTemplatesDelete(id: number): Promise<null>;
  exportTemplatesParseXlsx(input: { filePath: string }): Promise<ParsedTemplateDraft>;

  // 类别参数模板
  categoryTemplatesList(): Promise<CategoryParamTemplate[]>;
  categoryTemplatesGet(id: number): Promise<CategoryParamTemplate | null>;
  categoryTemplatesCreate(input: { category: string; defaults: CategoryParamDefaults }): Promise<CategoryParamTemplate>;
  categoryTemplatesUpdate(input: { id: number; patch: Partial<{ category: string; defaults: CategoryParamDefaults }> }): Promise<CategoryParamTemplate>;
  categoryTemplatesDelete(id: number): Promise<null>;

  // 清单行
  itemsList(spaceId: number): Promise<LineItem[]>;
  itemsCreateFromProduct(input: { spaceId: number; productId: number; qty?: number; options?: ProductOption[] }): Promise<LineItem>;
  itemsCreateManual(input: { spaceId: number; snapshot: LineItemSnapshot; qty?: number }): Promise<LineItem>;
  /** 换产品：保留 qty/remark/marginOverride/sortOrder，用新产品+生效成本价（取不到按 0）重建快照，清除手工价与候选成本。 */
  itemsReplaceProduct(input: { itemId: number; productId: number; optionNames: string[] }): Promise<LineItem>;
  itemsUpdate(input: { id: number; patch: Partial<{
    snapshot: LineItemSnapshot; qty: number; marginOverride: number | null;
    manualUnitPriceCents: Cents | null; remark: string | null; imagePath: string | null; sortOrder: number;
  }> }): Promise<LineItem>;
  itemsDelete(id: number): Promise<null>;
  itemsCheckStale(itemId: number): Promise<boolean>;
  itemsRefreshSnapshot(itemId: number): Promise<LineItem>;
  itemsComputed(itemId: number): Promise<LineTotals>;

  // 设置
  settingsGet(key: string): Promise<string | null>;
  settingsSet(input: { key: string; value: string }): Promise<null>;
  /** 落库开机自启设置并即时调用 app.setLoginItemSettings 生效（仅 mac/Windows，Linux 不处理）。 */
  settingsSetLaunchAtLogin(enabled: boolean): Promise<null>;

  // 系统交互
  dialogPickDir(): Promise<string | null>;
  dialogPickFile(): Promise<string | null>;
  shellReveal(path: string): Promise<null>;
  /** 用系统默认浏览器打开外部链接（如更新下载页）。 */
  shellOpenExternal(url: string): Promise<null>;

  // 应用信息
  /** 当前应用版本号（app.getVersion()，dev 下取 package.json 版本）。 */
  appVersion(): Promise<string>;
  /** 当前操作系统平台（preload 内直接读取 process.platform，非 IPC），用于设置页判断 mac 禁用自动更新。 */
  platform: NodeJS.Platform;

  // 导出
  exportRun(input: { projectId: number; outDir: string; templateId?: number }): Promise<string[]>;

  // 导入
  importParse(input: { filePath: string }): Promise<ImportBlock[]>;
  importRecognize(input: { sheetName: string; grid: string[][] }): Promise<ImportRecognizeResult>;
  importRecognizeDrawing(input: { images: { mediaType: string; base64: string }[] }): Promise<{ spaces: DrawingSpace[]; failedImages: number; errors: string[] }>;
  importMatch(input: { rows: RecognizedRow[] }): Promise<(RecognizedRow & { match: MatchResult })[]>;
  importCommit(input: { supplierId: number | null; rows: CommitRow[] }): Promise<{ created: number; priced: number }>;
  importApplyDrawing(input: { sectionId: number; spaces: ApplyDrawingSpace[] }): Promise<{ spaces: number; items: number }>;
  /** 测试连接；profileId 指定档案时按其测试（逐档案测试连接），不传则测试「文本识别」用途绑定的档案。 */
  aiTest(input?: { profileId?: string }): Promise<boolean>;
  /** 打开 AI 配置区时调用：触发懒迁移（若需要），返回档案列表与三个用途的有效绑定档案 id。 */
  aiProfilesEnsure(): Promise<{ profiles: AiProfile[]; bindings: { text: string | null; vision: string | null; watch: string | null } }>;

  // 概算
  estimateCategoriesList(projectId: number): Promise<EstimateCategory[]>;
  estimateCategoriesCreate(input: { projectId: number; name: string }): Promise<EstimateCategory>;
  estimateCategoriesUpdate(input: { id: number; patch: Partial<{ name: string; sortOrder: number }> }): Promise<EstimateCategory>;
  estimateCategoriesDelete(id: number): Promise<null>;
  estimateRowsList(categoryId: number): Promise<EstimateRow[]>;
  estimateRowsCreate(input: { categoryId: number; name: string; valueMethod?: EstimateValueMethod; manualAmountCents?: number | null; coefBaseCents?: number | null; coefFactor?: number | null; refSectionId?: number | null; remark?: string | null }): Promise<EstimateRow>;
  estimateRowsUpdate(input: { id: number; patch: Partial<{ name: string; sortOrder: number; valueMethod: EstimateValueMethod; manualAmountCents: number | null; coefBaseCents: number | null; coefFactor: number | null; refSectionId: number | null; remark: string | null }> }): Promise<EstimateRow>;
  estimateRowsDelete(id: number): Promise<null>;
  estimateNormsList(): Promise<EstimateNorm[]>;
  estimateNormsCreate(input: { projectType?: string | null; spaceType?: string | null; unitPriceLowCents?: number | null; unitPriceHighCents?: number | null; note?: string | null }): Promise<EstimateNorm>;
  estimateNormsUpdate(input: { id: number; patch: Partial<{ projectType: string | null; spaceType: string | null; unitPriceLowCents: number | null; unitPriceHighCents: number | null; note: string | null }> }): Promise<EstimateNorm>;
  estimateNormsDelete(id: number): Promise<null>;
  estimateSeed(projectId: number): Promise<number>;
  estimateAssemble(projectId: number): Promise<AssembledEstimate>;

  // 规则
  rulesList(): Promise<BomRule[]>;
  rulesGet(id: number): Promise<BomRule | null>;
  rulesCreate(input: { name: string; triggerType: RuleTriggerType; triggerValue: string; actions?: RuleAction[]; enabled?: boolean }): Promise<BomRule>;
  rulesUpdate(input: { id: number; patch: Partial<{ name: string; enabled: boolean; triggerType: RuleTriggerType; triggerValue: string; actions: RuleAction[]; sortOrder: number }> }): Promise<BomRule>;
  rulesDelete(id: number): Promise<null>;
  rulesEvaluateItem(input: { projectId: number; itemId: number }): Promise<CandidateItem[]>;
  rulesEvaluateProject(projectId: number): Promise<CandidateItem[]>;
  rulesApply(input: { spaceId: number; items: { productId: number; qty: number }[] }): Promise<{ created: number; skipped: number }>;

  // 多供应商比价
  itemCostsList(lineItemId: number): Promise<LineItemCost[]>;
  itemCostsCreate(input: { lineItemId: number; costUnitCents: number; supplierId?: number | null; supplierName?: string | null; brand?: string | null; model?: string | null; note?: string | null }): Promise<LineItemCost>;
  itemCostsUpdate(input: { id: number; patch: Partial<{ supplierId: number | null; supplierName: string | null; brand: string | null; model: string | null; costUnitCents: number; note: string | null; sortOrder: number }> }): Promise<LineItemCost>;
  itemCostsDelete(id: number): Promise<null>;
  itemCostsSetActive(costId: number): Promise<LineItem>;
  itemCostsSeedFromPrices(lineItemId: number): Promise<number>;
  exportCostCompare(input: { projectId: number; outDir: string }): Promise<string>;

  // 批量操作
  productsBatchDelete(ids: number[]): Promise<number>;
  suppliersBatchDelete(ids: number[]): Promise<number>;
  projectsBatchDelete(ids: number[]): Promise<number>;
  rulesBatchDelete(ids: number[]): Promise<number>;
  estimateNormsBatchDelete(ids: number[]): Promise<number>;
  productsBatchSetCategories(input: { ids: number[]; categories: string[]; mode: 'replace' | 'append' }): Promise<number>;
  productsSetWatchPrice(input: { ids: number[]; watch: boolean }): Promise<number>;
  projectsBatchSetStatus(input: { ids: number[]; status: 'draft' | 'done' }): Promise<number>;
  projectsDuplicate(projectId: number): Promise<Project>;
  exportProducts(input: { ids: number[]; outDir: string }): Promise<string>;
  exportSuppliers(input: { ids: number[]; outDir: string }): Promise<string>;

  // 询价单（不含我方价格）
  inquiriesCreate(input: {
    supplierId: number; projectId: number; title: string; note?: string | null;
    items: CreateInquiryItemInput[];
  }): Promise<InquiryDetail>;
  inquiriesList(supplierId?: number): Promise<Inquiry[]>;
  inquiriesGet(id: number): Promise<InquiryDetail | null>;
  inquiriesDelete(id: number): Promise<null>;
  inquiriesSetReply(input: { itemId: number; replyPriceCents: number | null }): Promise<InquiryItem>;
  /** 将某询价单行的回价写入价格记录（productId 为空的手工行/无回价会抛中文错，由 UI 提前禁用按钮）。 */
  inquiriesWriteReply(itemId: number): Promise<PriceRecord>;
  exportInquiry(input: { inquiryId: number; outDir: string }): Promise<string>;

  // 统计分析
  analyticsSummary(input: AnalyticsFilter): Promise<AnalyticsSummary>;
  analyticsProductProfit(input: AnalyticsFilter): Promise<ProductProfitRow[]>;
  analyticsProjectProfit(input: AnalyticsFilter): Promise<ProjectProfitRow[]>;
  analyticsPriceTrend(input: { productId: number } & AnalyticsFilter): Promise<PriceTrendPoint[]>;
  analyticsPriceChanges(input: AnalyticsFilter & { limit?: number }): Promise<PriceChangeRow[]>;

  // 查价监控
  watchRunNow(): Promise<WatchRoundSummary>;
  watchStatus(): Promise<{ lastRunAt: string | null; lastSummary: WatchRoundSummary | null; running: boolean }>;
  /** 订阅整轮查价完成事件（主进程 webContents.send('watch:done', ...)）。返回取消订阅函数。 */
  onWatchDone(cb: (summary: WatchRoundSummary) => void): () => void;

  // 软件更新
  /** 手动检查更新：走 GitHub Releases API，返回是否有新版本、版本号、发布说明、下载/详情页 url。 */
  updateCheck(): Promise<UpdateCheckResult>;
  /** 重启并安装已下载的更新：仅 Windows 'auto' 模式下载完成后有效，其余情况返回 false（no-op）。 */
  updateInstall(): Promise<boolean>;
  /** 查询当前更新状态缓存（含检测中/下载进度/是否已下载/错误信息）。 */
  updateStatus(): Promise<UpdateStatus>;
  /** 订阅更新事件（主进程 webContents.send('update:event', ...)）。返回取消订阅函数。 */
  onUpdateEvent(cb: (payload: UpdateEventPayload) => void): () => void;
}
