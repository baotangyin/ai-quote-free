export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS suppliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL, contact TEXT, note TEXT,
  phone TEXT, address TEXT, payment_terms TEXT, bank_info TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL, categories TEXT NOT NULL DEFAULT '[]', name TEXT NOT NULL,
  brand TEXT, model TEXT,
  recommended_brands TEXT NOT NULL DEFAULT '[]',
  params_core TEXT, params_bid TEXT, params_tender TEXT,
  unit TEXT NOT NULL DEFAULT '台', dims TEXT,
  power220_w REAL NOT NULL DEFAULT 0, power380_w REAL NOT NULL DEFAULT 0,
  rack_u REAL NOT NULL DEFAULT 0, seq_power_ports REAL NOT NULL DEFAULT 0,
  net_ports REAL NOT NULL DEFAULT 0, com_ports REAL NOT NULL DEFAULT 0,
  image_path TEXT, note TEXT,
  options TEXT NOT NULL DEFAULT '[]',
  cost_rule_override TEXT,
  watch_price INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS price_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('supplier','ai_search','manual')),
  supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
  price_cents INTEGER NOT NULL,
  source_url TEXT,
  captured_at TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL, client TEXT, project_type TEXT,
  mode TEXT NOT NULL DEFAULT 'budget' CHECK (mode IN ('estimate','budget','pricing','tender')),
  default_margin REAL NOT NULL DEFAULT 1.3,
  round_rule TEXT NOT NULL DEFAULT 'yuan' CHECK (round_rule IN ('cent','yuan','ten')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','done')),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0,
  integration_fee_rate REAL NOT NULL DEFAULT 0,
  is_hardware INTEGER NOT NULL DEFAULT 1,
  subtotal_label TEXT,
  fee_label TEXT,
  link_spaces INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS spaces (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  section_id INTEGER NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  name TEXT NOT NULL, description TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0, area REAL,
  pin_bottom INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS line_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  space_id INTEGER NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  snapshot TEXT NOT NULL,
  qty REAL NOT NULL DEFAULT 1,
  margin_override REAL,
  manual_unit_price_cents INTEGER,
  remark TEXT, image_path TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_price_product ON price_records(product_id);
CREATE INDEX IF NOT EXISTS idx_items_space ON line_items(space_id);

-- v1 -> v2 概算模式：分类 / 概算行 / 概算指标三表 --
CREATE TABLE IF NOT EXISTS estimate_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS estimate_rows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL REFERENCES estimate_categories(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  value_method TEXT NOT NULL DEFAULT 'manual' CHECK (value_method IN ('manual','coefficient','sectionRef')),
  manual_amount_cents INTEGER,
  coef_base_cents INTEGER,
  coef_factor REAL,
  ref_section_id INTEGER REFERENCES sections(id) ON DELETE SET NULL,
  remark TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS estimate_norms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_type TEXT,
  space_type TEXT,
  unit_price_low_cents INTEGER,
  unit_price_high_cents INTEGER,
  note TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_estcat_project ON estimate_categories(project_id);
CREATE INDEX IF NOT EXISTS idx_estrow_cat ON estimate_rows(category_id);

-- v2 -> v3 规则引擎：BOM 规则表（触发条件 + 动作 JSON） --
CREATE TABLE IF NOT EXISTS bom_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('category','product','projectType')),
  trigger_value TEXT NOT NULL,
  actions TEXT NOT NULL DEFAULT '[]',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bomrules_trigger ON bom_rules(trigger_type, trigger_value);

-- v3 -> v4 多供应商比价：清单行候选成本方案表（并联多条，单行至多一条生效） --
CREATE TABLE IF NOT EXISTS line_item_costs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  line_item_id INTEGER NOT NULL REFERENCES line_items(id) ON DELETE CASCADE,
  supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
  supplier_name TEXT,
  brand TEXT, model TEXT,
  cost_unit_cents INTEGER NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_licost_item ON line_item_costs(line_item_id);

-- v4 -> v5 项目类型模板：按项目类型预置板块+空间骨架（sections 为 JSON） --
CREATE TABLE IF NOT EXISTS project_type_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_type TEXT NOT NULL UNIQUE,
  sections TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

-- v5 -> v6 导出模板：header+style+versions 配置（config 为 JSON） --
CREATE TABLE IF NOT EXISTS export_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  config TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

-- v9 -> v10 类别参数模板：按产品类别预置技术参数默认值（defaults 为 JSON） --
CREATE TABLE IF NOT EXISTS category_param_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL UNIQUE,
  defaults TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

-- v10 -> v11 供应商询价单：询价单（不含我方价格）+ 询价单行（回价后可写入 price_records） --
CREATE TABLE IF NOT EXISTS inquiries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
  supplier_name TEXT NOT NULL,
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  project_name TEXT NOT NULL,
  title TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS inquiry_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  inquiry_id INTEGER NOT NULL REFERENCES inquiries(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  params TEXT,
  unit TEXT NOT NULL,
  qty REAL NOT NULL DEFAULT 1,
  remark TEXT,
  reply_price_cents INTEGER,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_inquiry_items_inquiry ON inquiry_items(inquiry_id);
`;
