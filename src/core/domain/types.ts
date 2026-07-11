export type Cents = number; // 整数，单位分

export interface Supplier {
  id: number;
  name: string;
  contact: string | null;
  note: string | null;
  phone: string | null;              // 电话
  address: string | null;            // 地址
  paymentTerms: string | null;       // 付款方式
  bankInfo: string | null;           // 开户信息
  createdAt: string;
  updatedAt: string;
}

export interface ProductOption {
  name: string;
  addPriceCents: Cents;
  /** 选配项参数描述，勾选该选配项建快照时会追加到三个参数字段末尾。 */
  paramsText?: string | null;
}

/** 成本价取值规则："lowest" 最低价 | "latest" 最新记录 | "supplier:<id>" 指定供应商 */
export type CostRule = 'lowest' | 'latest' | `supplier:${number}`;

export interface Product {
  id: number;
  category: string;                 // 兼容旧版单分类字段（写入时同步为 categories[0] 或 ''）
  categories: string[];             // 多分类标签（如设备类别 + 尺寸标签），同一设备可属多个分类
  name: string;
  brand: string | null;
  model: string | null;
  recommendedBrands: string[];      // 招标推荐品牌，通常 3 个
  paramsCore: string | null;        // 核心参数
  paramsBid: string | null;         // 招标参数
  paramsTender: string | null;      // 投标参数
  unit: string;                     // 台/套/只/㎡…
  dims: string | null;              // 规格尺寸
  power220W: number;                // 220V 用电量（W，按 unit 计）
  power380W: number;                // 380V 用电量
  rackU: number;                    // 机柜占用 U 数
  seqPowerPorts: number;            // 时序电源路数
  netPorts: number;                 // 网口数
  comPorts: number;                 // com 口数
  imagePath: string | null;
  note: string | null;
  options: ProductOption[];         // 选配项
  costRuleOverride: CostRule | null;
  watchPrice: boolean;              // 是否监控该产品价格
  createdAt: string;
  updatedAt: string;
}

export type PriceSource = 'supplier' | 'ai_search' | 'manual';

export interface PriceRecord {
  id: number;
  productId: number;
  source: PriceSource;
  supplierId: number | null;
  priceCents: Cents;
  sourceUrl: string | null;
  capturedAt: string;
  createdAt: string;
  updatedAt: string;
}

export type QuoteMode = 'estimate' | 'budget' | 'pricing' | 'tender';
export type RoundRule = 'cent' | 'yuan' | 'ten';

export interface Project {
  id: number;
  name: string;
  client: string | null;
  projectType: string | null;       // 项目类型（如展厅/指挥中心…），用于规则按项目类型触发
  mode: QuoteMode;
  defaultMargin: number;            // 乘法倍率，如 1.3
  roundRule: RoundRule;
  status: 'draft' | 'done';
  createdAt: string;
  updatedAt: string;
}

export interface Section {
  id: number;
  projectId: number;
  name: string;
  sortOrder: number;
  integrationFeeRate: number;       // 系统集成费比例，0 表示无
  isHardware: boolean;              // 硬件类板块（导出技术指标汇总行）
  subtotalLabel: string | null;     // 板块小计行文案，null 使用默认「{名}小计」
  feeLabel: string | null;          // 系统集成费行文案，null 使用默认「系统集成费(%)」
  linkSpaces: boolean;              // 联动开关：若为 true，该板块会随源板块同步改名
  createdAt: string;
  updatedAt: string;
}

export interface Space {
  id: number;
  sectionId: number;
  name: string;
  description: string | null;
  sortOrder: number;
  area: number | null;
  pinBottom: boolean;               // 置底空间：恒排在板块末尾，新建空间自动插于其前
  createdAt: string;
  updatedAt: string;
}

/** 清单行快照：创建行时从产品+生效成本价复制，此后独立于产品库 */
export interface LineItemSnapshot {
  name: string;
  brand: string | null;
  model: string | null;
  recommendedBrands: string[];
  paramsCore: string | null;
  paramsBid: string | null;
  paramsTender: string | null;
  unit: string;
  dims: string | null;
  power220W: number;
  power380W: number;
  rackU: number;
  seqPowerPorts: number;
  netPorts: number;
  comPorts: number;
  costUnitCents: Cents;
  optionsApplied: ProductOption[];
}

export interface LineItem {
  id: number;
  spaceId: number;
  productId: number | null;
  snapshot: LineItemSnapshot;
  qty: number;
  marginOverride: number | null;      // 行级倍率
  manualUnitPriceCents: Cents | null; // 手动定价，最高优先级
  remark: string | null;
  imagePath: string | null;           // 展项效果图
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

// ===== 概算模式（estimate） =====

/** 概算行取值方式：manual 手填金额 | coefficient 系数法（基数×系数）| sectionRef 引用板块合价 */
export type EstimateValueMethod = 'manual' | 'coefficient' | 'sectionRef';

export interface EstimateCategory {
  id: number;
  projectId: number;
  name: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface EstimateRow {
  id: number;
  categoryId: number;
  name: string;
  sortOrder: number;
  valueMethod: EstimateValueMethod;
  manualAmountCents: Cents | null;    // manual：直接金额
  coefBaseCents: Cents | null;        // coefficient：基数
  coefFactor: number | null;          // coefficient：系数
  refSectionId: number | null;        // sectionRef：引用板块 id
  remark: string | null;
  createdAt: string;
  updatedAt: string;
}

/** 概算单价指标库：按项目类型 / 空间类型给出单价区间参考 */
export interface EstimateNorm {
  id: number;
  projectType: string | null;
  spaceType: string | null;
  unitPriceLowCents: Cents | null;
  unitPriceHighCents: Cents | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

// ===== 规则引擎（BOM 规则） =====

/** 规则触发类型：category 按分类 | product 按具体产品 | projectType 按项目类型 */
export type RuleTriggerType = 'category' | 'product' | 'projectType';

/** 规则动作：命中后产生的配套项（productId 为空表示占位/待定），qtyFormula 为数量公式 */
export interface RuleAction {
  productId: number | null;
  qtyFormula: string;
  optional: boolean;
  note: string | null;
}

export interface BomRule {
  id: number;
  name: string;
  enabled: boolean;
  triggerType: RuleTriggerType;
  triggerValue: string;
  actions: RuleAction[];
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

// ===== 多供应商成本对比（候选成本方案） =====

/** 清单行的候选成本方案（多供应商比价）：并联多条，单行至多一条 isActive 生效。 */
export interface LineItemCost {
  id: number;
  lineItemId: number;
  supplierId: number | null;
  supplierName: string | null;   // 冗余存名，导出稳定（供应商改名/删除后仍可显示）
  brand: string | null;
  model: string | null;
  costUnitCents: Cents;
  isActive: boolean;
  note: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

// ===== 项目类型模板（板块+空间预置） =====

export interface TemplateSpace {
  name: string;
  description: string | null;
  pinBottom: boolean;               // 置底空间（如安防监控/中控网络）
}

export interface TemplateSection {
  name: string;
  integrationFeeRate: number;
  isHardware: boolean;
  spaces: TemplateSpace[];
}

/** 项目类型模板：新建项目选中对应类型时自动生成板块+空间骨架 */
export interface ProjectTypeTemplate {
  id: number;
  projectType: string;              // 与 projects.project_type 文本对应，唯一
  sections: TemplateSection[];
  createdAt: string;
  updatedAt: string;
}

// ===== 导出模板（header + style + versions） =====

export interface TemplateColumn {
  key: string;                  // 系统列 key（columns.ts 模式列集）或 custom- 前缀的自定义列 key
  label: string | null;         // 覆盖显示名，null=系统默认（默认名随模式，如参数列）；自定义列必填即列名
  width: number | null;         // 覆盖列宽，null=默认
  fixedText?: string | null;    // 仅自定义列（custom- 前缀）：数据行固定填充内容，null/未设置=空串
}

export interface ExportTemplateVersion {
  key: string;                  // 唯一，[a-z0-9-]，用于内部标识
  name: string;                 // 显示名，用于文件名后缀
  columns: TemplateColumn[];    // 有序；导出时与模式列集求交集
  includeSummarySheet: boolean;
  summaryRows: {
    spaceSubtotal: boolean;     // 空间小计（写在空间行）
    integrationFee: boolean;    // 系统集成费行
    sectionTotal: boolean;      // 合计行
    techSummary: boolean;       // 技术指标合计（仅硬件板块）
    taxRate: number | null;     // 税率 [0,1)，如 0.09 生成「税金(9%)」行，null=无
  };
}

export interface ExportTemplateConfig {
  header: {
    detailTitle: string;        // 明细表标题
    summaryTitle: string;       // 汇总表标题，支持 {项目名} 占位符
    projectNameLabel: string;   // 工程名称行前缀
    companyName: string | null; // 公司抬头行（标题上方），null=不显示
    footer: string | null;      // 落款行（表尾），支持 {日期} 占位符
  };
  style: {
    headerFillArgb: string;
    titleFontSize: number;
    moneyFmt: string;
    border: boolean;
  };
  versions: ExportTemplateVersion[];
}

export interface ExportTemplate {
  id: number;
  name: string;
  config: ExportTemplateConfig;
  createdAt: string;
  updatedAt: string;
}

// ===== 类别参数模板（按产品类别预置技术参数默认值） =====

/** 模板默认值：字段均可选，未设置的字段不参与「仅填空值」应用。 */
export interface CategoryParamDefaults {
  unit?: string;
  power220W?: number;
  power380W?: number;
  rackU?: number;
  seqPowerPorts?: number;
  netPorts?: number;
  comPorts?: number;
  paramsCore?: string;
  paramsBid?: string;
  paramsTender?: string;
}

/** 类别参数模板：category 唯一，新建产品（导入/手动）时按命中类别为空/零值字段填充默认值。 */
export interface CategoryParamTemplate {
  id: number;
  category: string;
  defaults: CategoryParamDefaults;
  createdAt: string;
  updatedAt: string;
}

// ===== 图纸视觉识别（drawingRecognize） =====

/** 图纸识别出的单个设备条目。 */
export interface DrawingItem {
  name: string;
  category: string | null;
  size: string | null;
  qty: number;
  remark: string | null;
}

/** 图纸识别出的单个空间（含其下设备清单）。 */
export interface DrawingSpace {
  name: string;
  items: DrawingItem[];
}

// ===== 供应商询价单（inquiries，不含我方价格） =====

/** 询价单：项目清单选行 → 按供应商生成，供应商回价后可写入 price_records。 */
export interface Inquiry {
  id: number;
  supplierId: number | null;
  supplierName: string;      // 冗余存名，供应商改名/删除后仍可显示
  projectId: number | null;
  projectName: string;       // 冗余存名，项目改名/删除后仍可显示
  title: string;
  note: string | null;
  itemCount: number;         // 行数（供列表展示，不随 items 一起返回时的轻量计数）
  createdAt: string;
  updatedAt: string;
}

/** 询价单行：不含我方价格；产品可空（手工行，无法回价写入价格记录）。 */
export interface InquiryItem {
  id: number;
  inquiryId: number;
  productId: number | null;
  name: string;
  params: string | null;
  unit: string;
  qty: number;
  remark: string | null;
  replyPriceCents: Cents | null;  // 供应商回价，未回价为 null
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

/** 询价单详情：含行数据，getInquiry 返回此类型。 */
export interface InquiryDetail extends Inquiry {
  items: InquiryItem[];
}
