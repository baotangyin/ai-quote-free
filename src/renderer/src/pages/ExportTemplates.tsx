import React, { useEffect, useState } from 'react';
import {
  Alert, Button, Card, Empty, Input, InputNumber, List, message, Modal, Popconfirm, Select, Space, Switch, Tag,
  Typography
} from 'antd';
import { ArrowDownOutlined, ArrowUpOutlined, DeleteOutlined, PlusOutlined, UploadOutlined } from '@ant-design/icons';
import type {
  ExportTemplate, ExportTemplateConfig, ExportTemplateVersion, ParsedTemplateDraft
} from '../../../shared/api-types';
import { api } from '../api';
import { SELECTED_BG } from '../theme';

const FACTORY_TEMPLATE_NAME = '标准三版本';

/** 系统列 key 全集（校验与 AI 映射用，与 KNOWN_COLUMN_KEYS 一致）+ 默认显示名。 */
const ALL_COLUMNS: Array<{ key: string; label: string }> = [
  { key: 'xh', label: '序号' },
  { key: 'name', label: '项目名称' },
  { key: 'params', label: '参数' },
  { key: 'unit', label: '单位' },
  { key: 'qty', label: '数量' },
  { key: 'unitPrice', label: '单价' },
  { key: 'total', label: '合计' },
  { key: 'remark', label: '备注' },
  { key: 'brands', label: '推荐品牌' },
  { key: 'dims', label: '规格尺寸' },
  { key: 'costUnit', label: '成本单价' },
  { key: 'costTotal', label: '成本合计' },
  { key: 'power220', label: '220V用电量' },
  { key: 'power380', label: '380V用电量' },
  { key: 'rackU', label: '机柜' },
  { key: 'seqPower', label: '时序电源' },
  { key: 'netPorts', label: '网口' },
  { key: 'comPorts', label: 'com口' },
  { key: 'ratio', label: '比例' },
];
const COLUMN_LABEL: Record<string, string> = Object.fromEntries(ALL_COLUMNS.map((c) => [c.key, c.label]));

const DEFAULT_SUMMARY_ROWS = { spaceSubtotal: true, integrationFee: true, sectionTotal: true, techSummary: true, taxRate: null };

const emptyConfig = (): ExportTemplateConfig => ({
  header: { detailTitle: '', summaryTitle: '', projectNameLabel: '工程名称：', companyName: null, footer: null },
  style: { headerFillArgb: 'FFD9D9D9', titleFontSize: 16, moneyFmt: '#,##0.00', border: true },
  versions: [],
});

function nextVersionKey(versions: ExportTemplateVersion[]): string {
  const used = new Set(versions.map((v) => v.key));
  let i = 1;
  while (used.has(`v${i}`)) i++;
  return `v${i}`;
}

/** 生成自定义列唯一 key（custom- 前缀，时间戳+随机后缀，版本内不会重复）。 */
function nextCustomColumnKey(): string {
  return `custom-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

const move = <T,>(arr: T[], i: number, delta: number): T[] => {
  const j = i + delta;
  if (j < 0 || j >= arr.length) return arr;
  [arr[i], arr[j]] = [arr[j], arr[i]];
  return arr;
};

/** 导出模板管理：左侧模板列表（内置「从 xlsx 导入」草稿态），右侧抬头/样式/版本集三区块编辑器。 */
export default function ExportTemplates(): React.JSX.Element {
  const [templates, setTemplates] = useState<ExportTemplate[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [name, setName] = useState('');
  const [config, setConfig] = useState<ExportTemplateConfig>(emptyConfig());
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [isNew, setIsNew] = useState(false);
  const [ignoredColumns, setIgnoredColumns] = useState<string[] | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [importing, setImporting] = useState(false);

  const load = async (keepSelection = false): Promise<void> => {
    try {
      const list = await api.exportTemplatesList();
      setTemplates(list);
      if (!keepSelection) {
        const first = list[0] ?? null;
        applySelection(first);
      }
    } catch (err) {
      message.error(`加载导出模板失败：${(err as Error).message}`);
    }
  };

  useEffect(() => { load(); }, []);

  const applySelection = (tpl: ExportTemplate | null): void => {
    setSelectedId(tpl ? tpl.id : null);
    setName(tpl ? tpl.name : '');
    setConfig(tpl ? tpl.config : emptyConfig());
    setIsNew(false);
    setIgnoredColumns(null);
    setDirty(false);
  };

  const confirmDiscard = (): boolean => {
    if (!dirty) return true;
    return window.confirm('当前模板有未保存修改，切换将丢失，继续？');
  };

  const select = (tpl: ExportTemplate): void => {
    if (!confirmDiscard()) return;
    applySelection(tpl);
  };

  const mutate = (fn: (draft: ExportTemplateConfig) => ExportTemplateConfig): void => {
    setConfig((prev) => fn(structuredClone(prev)));
    setDirty(true);
  };

  const handleSave = async (): Promise<void> => {
    const trimmedName = name.trim();
    if (!trimmedName) { message.error('模板名称不能为空'); return; }
    if (config.versions.some((v) => !v.name.trim())) { message.error('版本名称不能为空'); return; }
    setSaving(true);
    try {
      if (isNew || selectedId == null) {
        const tpl = await api.exportTemplatesCreate({ name: trimmedName, config });
        message.success('模板已创建');
        await load(true);
        applySelection(tpl);
      } else {
        const tpl = await api.exportTemplatesUpdate({ id: selectedId, patch: { name: trimmedName, config } });
        message.success('模板已保存');
        await load(true);
        applySelection(tpl);
      }
    } catch (err) {
      message.error(`保存模板失败：${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleCreate = (): void => {
    const factory = templates.find((t) => t.name === FACTORY_TEMPLATE_NAME);
    const base = factory ? factory.config : (templates[0] ? templates[0].config : emptyConfig());
    const trimmed = newName.trim();
    if (!trimmed) { message.error('请输入模板名称'); return; }
    setCreateOpen(false);
    setNewName('');
    setSelectedId(null);
    setName(trimmed);
    setConfig(structuredClone(base));
    setIsNew(true);
    setIgnoredColumns(null);
    setDirty(true);
  };

  const handleDelete = async (id: number): Promise<void> => {
    if (!confirmDiscard()) return;
    try {
      await api.exportTemplatesDelete(id);
      message.success('模板已删除');
      await load();
    } catch (err) {
      message.error(`删除模板失败：${(err as Error).message}`);
    }
  };

  const handleImport = async (): Promise<void> => {
    if (!confirmDiscard()) return;
    try {
      const filePath = await api.dialogPickFile();
      if (!filePath) return;
      setImporting(true);
      const draft: ParsedTemplateDraft = await api.exportTemplatesParseXlsx({ filePath });
      let draftName = '客户格式';
      if (templates.some((t) => t.name === draftName)) {
        draftName = window.prompt('模板名称「客户格式」已存在，请输入新的模板名称：', '客户格式(1)') ?? '';
        if (!draftName.trim()) { setImporting(false); return; }
      }
      setSelectedId(null);
      setName(draftName);
      setConfig(draft.config);
      setIsNew(true);
      setIgnoredColumns(draft.ignoredColumns);
      setDirty(true);
    } catch (err) {
      message.error(`从 xlsx 导入失败：${(err as Error).message}`);
    } finally {
      setImporting(false);
    }
  };

  const selected = templates.find((t) => t.id === selectedId) ?? null;
  const editing = isNew || selected != null;

  return (
    <div>
      <Typography.Title level={4} style={{ marginTop: 0, marginBottom: 16 }}>导出模板</Typography.Title>
      <Typography.Paragraph type="secondary">
        管理导出 Excel 的抬头/落款、样式与多版本列集；「标准三版本」为出厂模板，可编辑或删除（删除后不复活）。
      </Typography.Paragraph>
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        <Card
          style={{ width: 280, flexShrink: 0 }}
          title="模板列表"
          extra={
            <Space>
              <Button type="link" icon={<UploadOutlined />} loading={importing} onClick={handleImport}>从 xlsx 导入</Button>
              <Button type="link" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>新建</Button>
            </Space>
          }
        >
          <List
            dataSource={templates}
            locale={{ emptyText: <Empty description="暂无导出模板" /> }}
            renderItem={(tpl) => (
              <List.Item
                style={{ cursor: 'pointer', background: tpl.id === selectedId ? SELECTED_BG : undefined, paddingLeft: 8 }}
                onClick={() => select(tpl)}
                actions={[
                  <Popconfirm
                    key="del"
                    title="确认删除该导出模板？"
                    okText="确认"
                    cancelText="取消"
                    onConfirm={(e) => { e?.stopPropagation(); handleDelete(tpl.id); }}
                    onCancel={(e) => e?.stopPropagation()}
                  >
                    <Button type="text" size="small" danger icon={<DeleteOutlined />} onClick={(e) => e.stopPropagation()} />
                  </Popconfirm>
                ]}
              >
                <Space>
                  {tpl.name}
                  {tpl.name === FACTORY_TEMPLATE_NAME && <Tag color="blue">出厂</Tag>}
                </Space>
              </List.Item>
            )}
          />
        </Card>

        <div style={{ flex: 1 }}>
          {!editing ? (
            <Card><Empty description="请在左侧选择、新建或从 xlsx 导入一个导出模板" /></Card>
          ) : (
            <Space direction="vertical" size="middle" style={{ width: '100%' }}>
              <Card
                title={isNew ? '新建导出模板' : `编辑「${selected?.name}」`}
                extra={<Button type="primary" loading={saving} disabled={!dirty} onClick={handleSave}>保存</Button>}
              >
                <Space direction="vertical" size="small" style={{ width: '100%' }}>
                  <div>
                    <span>模板名称：</span>
                    <Input
                      style={{ width: 300 }}
                      value={name}
                      onChange={(e) => { setName(e.target.value); setDirty(true); }}
                      placeholder="模板名称"
                    />
                  </div>
                  {ignoredColumns && ignoredColumns.length > 0 && (
                    <Alert
                      type="warning"
                      showIcon
                      message={`以下列系统无对应字段，已忽略：${ignoredColumns.join('、')}`}
                    />
                  )}
                </Space>
              </Card>

              <Card title="抬头 / 落款">
                <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                  <div>
                    <div>明细表标题</div>
                    <Input
                      value={config.header.detailTitle}
                      onChange={(e) => mutate((d) => { d.header.detailTitle = e.target.value; return d; })}
                    />
                  </div>
                  <div>
                    <div>汇总表标题</div>
                    <Input
                      value={config.header.summaryTitle}
                      placeholder="支持 {项目名} 占位符"
                      onChange={(e) => mutate((d) => { d.header.summaryTitle = e.target.value; return d; })}
                    />
                  </div>
                  <div>
                    <div>工程名称行前缀</div>
                    <Input
                      value={config.header.projectNameLabel}
                      onChange={(e) => mutate((d) => { d.header.projectNameLabel = e.target.value; return d; })}
                    />
                  </div>
                  <div>
                    <div>公司抬头（标题上方，可空）</div>
                    <Input
                      value={config.header.companyName ?? ''}
                      placeholder="不显示则留空"
                      onChange={(e) => mutate((d) => { d.header.companyName = e.target.value || null; return d; })}
                    />
                  </div>
                  <div>
                    <div>落款（表尾，可空）</div>
                    <Input
                      value={config.header.footer ?? ''}
                      placeholder="支持 {日期} 占位符，不显示则留空"
                      onChange={(e) => mutate((d) => { d.header.footer = e.target.value || null; return d; })}
                    />
                  </div>
                </Space>
              </Card>

              <Card title="样式">
                <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                  <div>
                    <div>表头底色（8 位 ARGB 十六进制，如 FFD9D9D9）</div>
                    <Input
                      style={{ width: 200 }}
                      value={config.style.headerFillArgb}
                      status={/^[0-9A-Fa-f]{8}$/.test(config.style.headerFillArgb) ? undefined : 'error'}
                      onChange={(e) => mutate((d) => { d.style.headerFillArgb = e.target.value; return d; })}
                    />
                  </div>
                  <Space size="large">
                    <span>标题字号 <InputNumber
                      min={1}
                      value={config.style.titleFontSize}
                      onChange={(v) => mutate((d) => { d.style.titleFontSize = v ?? 1; return d; })}
                    /></span>
                    <span>边框 <Switch
                      checked={config.style.border}
                      onChange={(v) => mutate((d) => { d.style.border = v; return d; })}
                    /></span>
                  </Space>
                  <div>
                    <div>金额格式</div>
                    <Input
                      style={{ width: 200 }}
                      value={config.style.moneyFmt}
                      onChange={(e) => mutate((d) => { d.style.moneyFmt = e.target.value; return d; })}
                    />
                  </div>
                </Space>
              </Card>

              <Card
                title="版本集"
                extra={
                  <Button
                    icon={<PlusOutlined />}
                    onClick={() => mutate((d) => {
                      d.versions.push({
                        key: nextVersionKey(d.versions),
                        name: '',
                        columns: [],
                        includeSummarySheet: false,
                        summaryRows: { ...DEFAULT_SUMMARY_ROWS },
                      });
                      return d;
                    })}
                  >
                    添加版本
                  </Button>
                }
              >
                {config.versions.length === 0 ? (
                  <Empty description="暂无版本，点击右上角「添加版本」" />
                ) : (
                  <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                    {config.versions.map((ver, i) => (
                      <VersionEditor
                        key={ver.key}
                        ver={ver}
                        index={i}
                        total={config.versions.length}
                        onChange={(fn) => mutate((d) => { fn(d.versions[i]); return d; })}
                        onMove={(delta) => mutate((d) => { move(d.versions, i, delta); return d; })}
                        onDelete={() => mutate((d) => { d.versions.splice(i, 1); return d; })}
                      />
                    ))}
                  </Space>
                )}
              </Card>
            </Space>
          )}
        </div>
      </div>

      <Modal
        title="新建导出模板"
        open={createOpen}
        onOk={handleCreate}
        onCancel={() => { setCreateOpen(false); setNewName(''); }}
        okText="创建"
        cancelText="取消"
      >
        <Typography.Paragraph type="secondary">以出厂模板「标准三版本」为起点，可在保存前自由修改。</Typography.Paragraph>
        <Input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="模板名称"
          onPressEnter={handleCreate}
        />
      </Modal>
    </div>
  );
}

function VersionEditor(props: {
  ver: ExportTemplateVersion;
  index: number;
  total: number;
  onChange: (fn: (ver: ExportTemplateVersion) => void) => void;
  onMove: (delta: number) => void;
  onDelete: () => void;
}): React.JSX.Element {
  const { ver, index, total, onChange, onMove, onDelete } = props;
  const [addCustomOpen, setAddCustomOpen] = useState(false);
  const [customName, setCustomName] = useState('');
  const [customFixedText, setCustomFixedText] = useState('');

  const moveColumn = (colIdx: number, delta: number): void => {
    onChange((v) => {
      const j = colIdx + delta;
      if (j < 0 || j >= v.columns.length) return;
      [v.columns[colIdx], v.columns[j]] = [v.columns[j], v.columns[colIdx]];
    });
  };

  const removeColumn = (colIdx: number): void => {
    onChange((v) => { v.columns.splice(colIdx, 1); });
  };

  const addSystemColumn = (key: string): void => {
    onChange((v) => { v.columns.push({ key, label: null, width: null }); });
  };

  const openAddCustom = (): void => {
    setCustomName('');
    setCustomFixedText('');
    setAddCustomOpen(true);
  };

  const confirmAddCustom = (): void => {
    const label = customName.trim();
    if (!label) { message.error('请输入自定义列名'); return; }
    onChange((v) => {
      v.columns.push({ key: nextCustomColumnKey(), label, width: null, fixedText: customFixedText.trim() || null });
    });
    setAddCustomOpen(false);
  };

  const unselectedSystemColumns = ALL_COLUMNS.filter((c) => !ver.columns.some((vc) => vc.key === c.key));

  return (
    <Card
      size="small"
      title={
        <Space>
          <Tag>{ver.key}</Tag>
          <Input
            style={{ width: 200 }}
            value={ver.name}
            placeholder="版本名称"
            onChange={(e) => onChange((v) => { v.name = e.target.value; })}
          />
        </Space>
      }
      extra={
        <Space>
          <Button type="text" size="small" icon={<ArrowUpOutlined />} disabled={index === 0} onClick={() => onMove(-1)} />
          <Button type="text" size="small" icon={<ArrowDownOutlined />} disabled={index === total - 1} onClick={() => onMove(1)} />
          <Popconfirm title="确认删除该版本？" okText="确认" cancelText="取消" onConfirm={onDelete}>
            <Button type="text" size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      }
    >
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <div>
          <div>已选列（顺序即导出顺序；系统列可覆盖显示名/宽度，自定义列（custom-前缀）可编辑列名/宽度/固定内容）</div>
          <Space direction="vertical" size="small" style={{ width: '100%' }}>
            {ver.columns.length === 0 && <Typography.Text type="secondary">暂无已选列，请在下方添加</Typography.Text>}
            {ver.columns.map((col, ci) => {
              const isCustom = col.key.startsWith('custom-');
              return (
                <Space key={col.key} wrap>
                  {isCustom ? (
                    <>
                      <Tag color="purple">自定义</Tag>
                      <Input
                        style={{ width: 140 }}
                        value={col.label ?? ''}
                        placeholder="列名（必填）"
                        status={col.label && col.label.trim() ? undefined : 'error'}
                        onChange={(e) => onChange((v) => { v.columns[ci].label = e.target.value; })}
                      />
                    </>
                  ) : (
                    <>
                      <span style={{ width: 90, display: 'inline-block' }}>{COLUMN_LABEL[col.key] ?? col.key}</span>
                      <Input
                        style={{ width: 160 }}
                        value={col.label ?? ''}
                        placeholder="覆盖显示名（留空=默认）"
                        onChange={(e) => onChange((v) => { v.columns[ci].label = e.target.value || null; })}
                      />
                    </>
                  )}
                  <InputNumber
                    style={{ width: 100 }}
                    min={1}
                    value={col.width ?? undefined}
                    placeholder="覆盖列宽"
                    onChange={(val) => onChange((v) => { v.columns[ci].width = val ?? null; })}
                  />
                  {isCustom && (
                    <Input
                      style={{ width: 180 }}
                      value={col.fixedText ?? ''}
                      placeholder="固定内容（可空，每行相同）"
                      onChange={(e) => onChange((v) => { v.columns[ci].fixedText = e.target.value || null; })}
                    />
                  )}
                  <Button type="text" size="small" icon={<ArrowUpOutlined />} disabled={ci === 0} onClick={() => moveColumn(ci, -1)} />
                  <Button type="text" size="small" icon={<ArrowDownOutlined />} disabled={ci === ver.columns.length - 1} onClick={() => moveColumn(ci, 1)} />
                  <Popconfirm title="确认删除该列？" okText="确认" cancelText="取消" onConfirm={() => removeColumn(ci)}>
                    <Button type="text" size="small" danger icon={<DeleteOutlined />} />
                  </Popconfirm>
                </Space>
              );
            })}
          </Space>
          <Space style={{ marginTop: 8 }}>
            <Select<string>
              style={{ width: 180 }}
              placeholder="添加系统列"
              value={undefined}
              options={unselectedSystemColumns.map((c) => ({ value: c.key, label: c.label }))}
              onChange={(key) => addSystemColumn(key)}
            />
            <Button icon={<PlusOutlined />} onClick={openAddCustom}>添加自定义列</Button>
          </Space>
        </div>

        <Space size="large" wrap>
          <span>生成汇总表 <Switch
            checked={ver.includeSummarySheet}
            onChange={(v) => onChange((ver2) => { ver2.includeSummarySheet = v; })}
          /></span>
          <span>空间小计 <Switch
            checked={ver.summaryRows.spaceSubtotal}
            onChange={(v) => onChange((ver2) => { ver2.summaryRows.spaceSubtotal = v; })}
          /></span>
          <span>系统集成费 <Switch
            checked={ver.summaryRows.integrationFee}
            onChange={(v) => onChange((ver2) => { ver2.summaryRows.integrationFee = v; })}
          /></span>
          <span>合计行 <Switch
            checked={ver.summaryRows.sectionTotal}
            onChange={(v) => onChange((ver2) => { ver2.summaryRows.sectionTotal = v; })}
          /></span>
          <span>技术指标合计 <Switch
            checked={ver.summaryRows.techSummary}
            onChange={(v) => onChange((ver2) => { ver2.summaryRows.techSummary = v; })}
          /></span>
          <span>税率（%，留空=不收）<InputNumber
            style={{ width: 100 }}
            min={0}
            max={99}
            value={ver.summaryRows.taxRate == null ? null : Math.round(ver.summaryRows.taxRate * 100)}
            onChange={(v) => onChange((ver2) => { ver2.summaryRows.taxRate = v == null ? null : v / 100; })}
          /></span>
        </Space>
      </Space>

      <Modal
        title="添加自定义列"
        open={addCustomOpen}
        onOk={confirmAddCustom}
        onCancel={() => setAddCustomOpen(false)}
        okText="添加"
        cancelText="取消"
      >
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <div>
            <div>列名（必填）</div>
            <Input value={customName} onChange={(e) => setCustomName(e.target.value)} placeholder="如：厂家备注" onPressEnter={confirmAddCustom} />
          </div>
          <div>
            <div>固定内容（可空，每行相同）</div>
            <Input value={customFixedText} onChange={(e) => setCustomFixedText(e.target.value)} placeholder="不填则导出为空白" onPressEnter={confirmAddCustom} />
          </div>
        </Space>
      </Modal>
    </Card>
  );
}
