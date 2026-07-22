import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  Breadcrumb,
  Button,
  Table,
  Tree,
  Modal,
  Form,
  Input,
  InputNumber,
  Select,
  Switch,
  Popconfirm,
  message,
  Space,
  Empty,
  Tag,
  Tooltip,
  Typography,
  Spin,
  Checkbox
} from 'antd';
import type { TreeDataNode } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, ExportOutlined } from '@ant-design/icons';
import type {
  Project,
  QuoteMode,
  Section,
  Space as ProjectSpace,
  LineItem,
  LineItemSnapshot,
  LineTotals,
  ProjectTotalsResult,
  CandidateItem,
  ExportTemplate,
  Product,
  ProductOption,
  Supplier
} from '../../../shared/api-types';
import { api } from '../api';
import { yuanToCents, centsToYuan, fmtYuan } from '../money';
import ProductPicker from '../components/ProductPicker';
import BomSuggestPanel from '../components/BomSuggestPanel';
import CostComparePanel from '../components/CostComparePanel';
import EstimateEditor from '../components/EstimateEditor';
import { MODE_LABELS } from '../labels';
import { usePersistedState } from '../useListState';
import { PANEL_STYLE } from '../theme';

const FACTORY_TEMPLATE_NAME = '标准三版本';

/** 模式 -> 清单参数字段 与 列头文案。与 core/export/columns.ts 的 modeConfig 保持一致。 */
const MODE_PARAMS_FIELD: Record<QuoteMode, 'paramsCore' | 'paramsBid' | 'paramsTender'> = {
  budget: 'paramsCore',
  pricing: 'paramsBid',
  tender: 'paramsTender',
  estimate: 'paramsCore'
};

const MODE_PARAMS_LABEL: Record<QuoteMode, string> = {
  budget: '核心参数',
  pricing: '招标参数',
  tender: '投标参数',
  estimate: '核心参数'
};

const MODE_SELECT_OPTIONS: { value: QuoteMode; label: string }[] = (
  ['budget', 'pricing', 'tender', 'estimate'] as QuoteMode[]
).map((m) => ({
  value: m,
  label: MODE_LABELS[m]
}));

interface SectionFormValues {
  name: string;
  integrationFeeRatePercent: number;
  isHardware: boolean;
  subtotalLabel?: string;
  feeLabel?: string;
  linkSpaces?: boolean;
}

/** 板块视图只读汇总表的一行：区分空间行/明细行/小计/集成费/合计行，同一 Table 用一套列渲染。 */
type QuoteViewRow =
  | { type: 'space'; key: string; spaceId: number; name: string; area: number | null; subtotalCents: number }
  | {
      type: 'item';
      key: string;
      spaceId: number;
      idx: number;
      item: LineItem;
      computed: LineTotals;
    }
  | { type: 'subtotal'; key: string; label: string; amountCents: number }
  | { type: 'fee'; key: string; label: string; amountCents: number }
  | { type: 'total'; key: string; amountCents: number };

interface SectionQuoteSpaceData {
  space: ProjectSpace;
  items: LineItem[];
  computed: Record<number, LineTotals>;
}

interface SpaceFormValues {
  name: string;
  description?: string;
  area?: number;
  pinBottom?: boolean;
}

interface ManualItemFormValues {
  name: string;
  unit: string;
  qty?: number;
  costUnitYuan: number;
}

/** 百分比格式化：保留至多1位小数并去除多余的尾零（如 5%、12.5%）。 */
function formatFeeRate(rate: number): string {
  return (Math.round(rate * 1000) / 10).toString();
}

export default function ProjectEditor(): React.JSX.Element {
  const { id } = useParams();
  const projectId = Number(id);

  const [project, setProject] = useState<Project | null>(null);
  const [sections, setSections] = useState<Section[]>([]);
  const [spacesBySection, setSpacesBySection] = useState<Record<number, ProjectSpace[]>>({});
  const [treeLoading, setTreeLoading] = useState(false);

  const [selectedSpaceId, setSelectedSpaceId] = useState<number | null>(null);
  const [selectedSectionId, setSelectedSectionId] = useState<number | null>(null);
  const [sectionQuoteSpaces, setSectionQuoteSpaces] = useState<SectionQuoteSpaceData[]>([]);
  const [sectionQuoteLoading, setSectionQuoteLoading] = useState(false);
  const sectionQuoteSeqRef = useRef(0);
  const [items, setItems] = useState<LineItem[]>([]);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [computedMap, setComputedMap] = useState<Record<number, LineTotals>>({});
  const [staleMap, setStaleMap] = useState<Record<number, boolean>>({});
  const [refreshingId, setRefreshingId] = useState<number | null>(null);
  const [deletingItemId, setDeletingItemId] = useState<number | null>(null);

  const [totals, setTotals] = useState<ProjectTotalsResult | null>(null);

  const [sectionModalOpen, setSectionModalOpen] = useState(false);
  const [editingSection, setEditingSection] = useState<Section | null>(null);
  const [sectionSubmitting, setSectionSubmitting] = useState(false);
  const [sectionForm] = Form.useForm<SectionFormValues>();
  const sectionFormName = Form.useWatch('name', sectionForm);

  const [spaceModalOpen, setSpaceModalOpen] = useState(false);
  const [editingSpace, setEditingSpace] = useState<ProjectSpace | null>(null);
  const [spaceModalSectionId, setSpaceModalSectionId] = useState<number | null>(null);
  const [spaceSubmitting, setSpaceSubmitting] = useState(false);
  const [spaceForm] = Form.useForm<SpaceFormValues>();

  const [manualModalOpen, setManualModalOpen] = useState(false);
  const [manualSubmitting, setManualSubmitting] = useState(false);
  const [manualForm] = Form.useForm<ManualItemFormValues>();

  const [pickerOpen, setPickerOpen] = useState(false);

  // ---------- 换产品 ----------
  const [replacePickerOpen, setReplacePickerOpen] = useState(false);
  const [replaceTargetItem, setReplaceTargetItem] = useState<LineItem | null>(null);
  const [replaceOptionsModalOpen, setReplaceOptionsModalOpen] = useState(false);
  const [replaceProduct, setReplaceProduct] = useState<Product | null>(null);
  const [replaceOptionNames, setReplaceOptionNames] = useState<string[]>([]);
  const [replaceSubmitting, setReplaceSubmitting] = useState(false);

  const [suggestOpen, setSuggestOpen] = useState(false);
  const [suggestCandidates, setSuggestCandidates] = useState<CandidateItem[]>([]);
  const [suggestSpaceId, setSuggestSpaceId] = useState<number | null>(null);
  const [evaluatingProject, setEvaluatingProject] = useState(false);

  const [costPanelItem, setCostPanelItem] = useState<LineItem | null>(null);
  const [costPanelOpen, setCostPanelOpen] = useState(false);

  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [outDir, setOutDir] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportedFiles, setExportedFiles] = useState<string[] | null>(null);
  const [exportTemplates, setExportTemplates] = useState<ExportTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = usePersistedState<number | null>('export.templateId', null);
  const [costCompareExporting, setCostCompareExporting] = useState(false);
  const [modeSwitching, setModeSwitching] = useState(false);
  const [pendingMode, setPendingMode] = useState<QuoteMode | null>(null);

  // ---------- 生成询价单 ----------
  const [selectedItemKeys, setSelectedItemKeys] = useState<React.Key[]>([]);
  const [inquiryModalOpen, setInquiryModalOpen] = useState(false);
  const [inquirySuppliers, setInquirySuppliers] = useState<Supplier[]>([]);
  const [inquirySupplierIds, setInquirySupplierIds] = useState<number[]>([]);
  const [inquiryTitle, setInquiryTitle] = useState('');
  const [inquirySubmitting, setInquirySubmitting] = useState(false);

  const treeSeqRef = useRef(0);
  const itemsSeqRef = useRef(0);
  const totalsSeqRef = useRef(0);

  const loadProject = async (): Promise<void> => {
    try {
      const p = await api.projectsGet(projectId);
      setProject(p);
    } catch (err) {
      message.error(`加载项目失败：${(err as Error).message}`);
    }
  };

  const loadTree = async (): Promise<void> => {
    const seq = ++treeSeqRef.current;
    setTreeLoading(true);
    try {
      const secs = await api.sectionsList(projectId);
      const spacesArr = await Promise.all(secs.map((s) => api.spacesList(s.id)));
      if (seq !== treeSeqRef.current) return; // 树已被后续加载覆盖，丢弃过期响应
      const map: Record<number, ProjectSpace[]> = {};
      secs.forEach((s, i) => {
        map[s.id] = spacesArr[i];
      });
      setSections(secs);
      setSpacesBySection(map);
    } catch (err) {
      if (seq === treeSeqRef.current) message.error(`加载板块/空间失败：${(err as Error).message}`);
    } finally {
      if (seq === treeSeqRef.current) setTreeLoading(false);
    }
  };

  const loadTotals = async (): Promise<void> => {
    if (!projectId || Number.isNaN(projectId)) return;
    const seq = ++totalsSeqRef.current;
    try {
      const t = await api.projectsTotals(projectId);
      if (seq !== totalsSeqRef.current) return;
      setTotals(t);
    } catch (err) {
      if (seq === totalsSeqRef.current) message.error(`加载统计失败：${(err as Error).message}`);
    }
  };

  const loadItems = async (spaceId: number): Promise<void> => {
    const seq = ++itemsSeqRef.current;
    setItemsLoading(true);
    try {
      const list = await api.itemsList(spaceId);
      if (seq !== itemsSeqRef.current) return; // 空间已切换，丢弃过期响应
      const [computedArr, staleArr] = await Promise.all([
        Promise.all(list.map((it) => api.itemsComputed(it.id))),
        Promise.all(list.map((it) => api.itemsCheckStale(it.id)))
      ]);
      if (seq !== itemsSeqRef.current) return; // 空间已切换，丢弃过期响应
      setItems(list);
      setSelectedItemKeys([]); // 清单刷新（切空间/增删改后重取）后清空行选择，避免选中过期行
      const cMap: Record<number, LineTotals> = {};
      const sMap: Record<number, boolean> = {};
      list.forEach((it, i) => {
        cMap[it.id] = computedArr[i];
        sMap[it.id] = staleArr[i];
      });
      setComputedMap(cMap);
      setStaleMap(sMap);
    } catch (err) {
      if (seq === itemsSeqRef.current) message.error(`加载清单失败：${(err as Error).message}`);
    } finally {
      if (seq === itemsSeqRef.current) setItemsLoading(false);
    }
  };

  /** 板块级只读报价表视图数据组装：逐空间拉取 items:list + itemsComputed（复用现有定价逻辑，与导出口径一致），
   * 不新增聚合端点——评估后该路径最简单，见任务报告。
   * 空间列表直接从后端查询（api.spacesList），不依赖闭包捕获的 spacesBySection state，
   * 避免调用方在 loadTree() 之后立即调用本函数时读到陈旧闭包值（新增空间不显示 / 已删空间仍被查询）。 */
  const loadSectionQuote = async (sectionId: number): Promise<void> => {
    const seq = ++sectionQuoteSeqRef.current;
    setSectionQuoteLoading(true);
    try {
      const spaces = await api.spacesList(sectionId);
      if (seq !== sectionQuoteSeqRef.current) return; // 已被后续加载覆盖，丢弃过期响应
      const results = await Promise.all(
        spaces.map(async (sp): Promise<SectionQuoteSpaceData> => {
          const list = await api.itemsList(sp.id);
          const computedArr = await Promise.all(list.map((it) => api.itemsComputed(it.id)));
          const computed: Record<number, LineTotals> = {};
          list.forEach((it, i) => {
            computed[it.id] = computedArr[i];
          });
          return { space: sp, items: list, computed };
        })
      );
      if (seq !== sectionQuoteSeqRef.current) return; // 已被后续加载覆盖，丢弃过期响应
      setSectionQuoteSpaces(results);
    } catch (err) {
      if (seq === sectionQuoteSeqRef.current) message.error(`加载板块报价表失败：${(err as Error).message}`);
    } finally {
      if (seq === sectionQuoteSeqRef.current) setSectionQuoteLoading(false);
    }
  };

  useEffect(() => {
    if (!projectId || Number.isNaN(projectId)) return;
    loadProject();
    loadTree();
    loadTotals();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  useEffect(() => {
    if (selectedSpaceId == null) {
      itemsSeqRef.current++; // 使任何正在途中的旧请求失效
      setItems([]);
      setComputedMap({});
      setStaleMap({});
      setSelectedItemKeys([]);
      return;
    }
    loadItems(selectedSpaceId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSpaceId]);

  useEffect(() => {
    if (selectedSectionId == null) {
      sectionQuoteSeqRef.current++;
      setSectionQuoteSpaces([]);
      return;
    }
    loadSectionQuote(selectedSectionId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSectionId]);

  const selectedSpaceInfo = useMemo(() => {
    if (selectedSpaceId == null) return null;
    for (const sec of sections) {
      const sp = (spacesBySection[sec.id] ?? []).find((s) => s.id === selectedSpaceId);
      if (sp) return { space: sp, section: sec };
    }
    return null;
  }, [selectedSpaceId, sections, spacesBySection]);

  // ---------- 板块/空间 树 ----------

  /** 联动源板块 = 项目内 sortOrder 最小的板块（其自身的联动开关无意义，弹窗内隐藏）。 */
  const sourceSectionId = useMemo(() => {
    if (sections.length === 0) return null;
    return sections.reduce((min, s) => (s.sortOrder < min.sortOrder ? s : min), sections[0]).id;
  }, [sections]);

  const openSectionCreateModal = (): void => {
    setEditingSection(null);
    sectionForm.resetFields();
    sectionForm.setFieldsValue({ integrationFeeRatePercent: 0, isHardware: true, linkSpaces: false });
    setSectionModalOpen(true);
  };

  const openSectionEditModal = (section: Section): void => {
    setEditingSection(section);
    sectionForm.setFieldsValue({
      name: section.name,
      integrationFeeRatePercent: section.integrationFeeRate * 100,
      isHardware: section.isHardware,
      subtotalLabel: section.subtotalLabel ?? undefined,
      feeLabel: section.feeLabel ?? undefined,
      linkSpaces: section.linkSpaces
    });
    setSectionModalOpen(true);
  };

  const closeSectionModal = (): void => {
    setSectionModalOpen(false);
    setEditingSection(null);
    sectionForm.resetFields();
  };

  const handleSectionSubmit = async (): Promise<void> => {
    let values: SectionFormValues;
    try {
      values = await sectionForm.validateFields();
    } catch (err) {
      if ((err as { errorFields?: unknown }).errorFields) return;
      throw err;
    }
    setSectionSubmitting(true);
    try {
      const rate = (values.integrationFeeRatePercent ?? 0) / 100;
      const subtotalLabel = values.subtotalLabel?.trim() || null;
      const feeLabel = values.feeLabel?.trim() || null;
      if (editingSection) {
        const isSource = editingSection.id === sourceSectionId;
        await api.sectionsUpdate({
          id: editingSection.id,
          patch: {
            name: values.name,
            integrationFeeRate: rate,
            isHardware: values.isHardware,
            subtotalLabel,
            feeLabel,
            linkSpaces: isSource ? false : (values.linkSpaces ?? false)
          }
        });
        message.success('板块已更新');
      } else {
        await api.sectionsCreate({
          projectId,
          name: values.name,
          integrationFeeRate: rate,
          isHardware: values.isHardware,
          subtotalLabel,
          feeLabel,
          linkSpaces: values.linkSpaces ?? false
        });
        message.success('板块已创建');
      }
      closeSectionModal();
      await loadTree();
      await loadTotals();
      if (selectedSectionId != null) await loadSectionQuote(selectedSectionId);
    } catch (err) {
      message.error(`保存板块失败：${(err as Error).message}`);
    } finally {
      setSectionSubmitting(false);
    }
  };

  const handleDeleteSection = async (sectionId: number): Promise<void> => {
    try {
      await api.sectionsDelete(sectionId);
      message.success('板块已删除');
      if (selectedSpaceInfo?.section.id === sectionId) setSelectedSpaceId(null);
      if (selectedSectionId === sectionId) setSelectedSectionId(null);
      await loadTree();
      await loadTotals();
    } catch (err) {
      message.error(`删除板块失败：${(err as Error).message}`);
    }
  };

  const openSpaceCreateModal = (sectionId: number): void => {
    setEditingSpace(null);
    setSpaceModalSectionId(sectionId);
    spaceForm.resetFields();
    spaceForm.setFieldsValue({ pinBottom: false });
    setSpaceModalOpen(true);
  };

  const openSpaceEditModal = (space: ProjectSpace): void => {
    setEditingSpace(space);
    setSpaceModalSectionId(space.sectionId);
    spaceForm.setFieldsValue({
      name: space.name,
      description: space.description ?? undefined,
      area: space.area ?? undefined,
      pinBottom: space.pinBottom
    });
    setSpaceModalOpen(true);
  };

  const closeSpaceModal = (): void => {
    setSpaceModalOpen(false);
    setEditingSpace(null);
    setSpaceModalSectionId(null);
    spaceForm.resetFields();
  };

  const handleSpaceSubmit = async (): Promise<void> => {
    let values: SpaceFormValues;
    try {
      values = await spaceForm.validateFields();
    } catch (err) {
      if ((err as { errorFields?: unknown }).errorFields) return;
      throw err;
    }
    setSpaceSubmitting(true);
    try {
      if (editingSpace) {
        const updated = await api.spacesUpdate({
          id: editingSpace.id,
          patch: {
            name: values.name,
            description: values.description ?? null,
            area: values.area ?? null,
            pinBottom: values.pinBottom ?? false
          }
        });
        message.success('空间已更新');
        if (updated.syncedSections && updated.syncedSections > 0) {
          message.success(`已同步到 ${updated.syncedSections} 个联动板块`);
        }
      } else if (spaceModalSectionId != null) {
        const created = await api.spacesCreate({
          sectionId: spaceModalSectionId,
          name: values.name,
          description: values.description,
          area: values.area,
          pinBottom: values.pinBottom
        });
        message.success('空间已创建');
        if (created.syncedSections && created.syncedSections > 0) {
          message.success(`已同步到 ${created.syncedSections} 个联动板块`);
        }
      }
      closeSpaceModal();
      await loadTree();
      await loadTotals();
      if (selectedSectionId != null) await loadSectionQuote(selectedSectionId);
    } catch (err) {
      message.error(`保存空间失败：${(err as Error).message}`);
    } finally {
      setSpaceSubmitting(false);
    }
  };

  const handleDeleteSpace = async (spaceId: number): Promise<void> => {
    try {
      await api.spacesDelete(spaceId);
      message.success('空间已删除');
      if (selectedSpaceId === spaceId) setSelectedSpaceId(null);
      await loadTree();
      await loadTotals();
      if (selectedSectionId != null) await loadSectionQuote(selectedSectionId);
    } catch (err) {
      message.error(`删除空间失败：${(err as Error).message}`);
    }
  };

  const handleTreeSelect = (keys: React.Key[]): void => {
    const key = keys[0] as string | undefined;
    if (key && key.startsWith('space-')) {
      setSelectedSectionId(null);
      setSelectedSpaceId(Number(key.slice('space-'.length)));
    } else if (key && key.startsWith('section-')) {
      setSelectedSpaceId(null);
      setSelectedSectionId(Number(key.slice('section-'.length)));
    } else {
      setSelectedSpaceId(null);
      setSelectedSectionId(null);
    }
  };

  const renderSectionTitle = (sec: Section): React.ReactNode => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '4px 0' }}>
      <span style={{ whiteSpace: 'normal', wordBreak: 'break-all', fontWeight: 500 }}>{sec.name}</span>
      <Space size={4} wrap>
        <Tag>集成费 {formatFeeRate(sec.integrationFeeRate)}%</Tag>
        {sec.isHardware && <Tag color="blue">硬件</Tag>}
      </Space>
      <span onClick={(e) => e.stopPropagation()}>
        <Tooltip title="新增空间">
          <Button type="text" size="small" icon={<PlusOutlined />} onClick={() => openSpaceCreateModal(sec.id)} />
        </Tooltip>
        <Tooltip title="重命名板块">
          <Button type="text" size="small" icon={<EditOutlined />} onClick={() => openSectionEditModal(sec)} />
        </Tooltip>
        <Popconfirm
          title="确认删除该板块？（含其下所有空间与清单）"
          okText="确认"
          cancelText="取消"
          onConfirm={() => handleDeleteSection(sec.id)}
        >
          <Button type="text" size="small" danger icon={<DeleteOutlined />} />
        </Popconfirm>
      </span>
    </div>
  );

  const renderSpaceTitle = (sp: ProjectSpace): React.ReactNode => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '4px 0' }}>
      <span style={{ whiteSpace: 'normal', wordBreak: 'break-all', fontWeight: 500 }}>{sp.name}</span>
      <Space size={4} wrap>
        {sp.area != null && <Tag>{sp.area}㎡</Tag>}
        {sp.pinBottom && <Tag color="purple">置底</Tag>}
      </Space>
      <span onClick={(e) => e.stopPropagation()}>
        <Tooltip title="重命名空间">
          <Button
            type="text"
            size="small"
            icon={<EditOutlined />}
            onClick={(e) => {
              e.stopPropagation();
              openSpaceEditModal(sp);
            }}
          />
        </Tooltip>
        <Popconfirm
          title="确认删除该空间？（含其下所有清单行）"
          okText="确认"
          cancelText="取消"
          onConfirm={() => handleDeleteSpace(sp.id)}
        >
          <Button type="text" size="small" danger icon={<DeleteOutlined />} onClick={(e) => e.stopPropagation()} />
        </Popconfirm>
      </span>
    </div>
  );

  const treeData: TreeDataNode[] = sections.map((sec) => ({
    key: `section-${sec.id}`,
    title: renderSectionTitle(sec),
    children: (spacesBySection[sec.id] ?? []).map((sp) => ({
      key: `space-${sp.id}`,
      title: renderSpaceTitle(sp),
      isLeaf: true
    }))
  }));

  // ---------- 清单行编辑 ----------

  const commitItemPatch = async (
    record: LineItem,
    patch: Partial<{ qty: number; marginOverride: number | null; manualUnitPriceCents: number | null; remark: string | null }>
  ): Promise<void> => {
    try {
      const updated = await api.itemsUpdate({ id: record.id, patch });
      setItems((prev) => prev.map((it) => (it.id === record.id ? updated : it)));
      const [computed, stale] = await Promise.all([api.itemsComputed(record.id), api.itemsCheckStale(record.id)]);
      setComputedMap((prev) => ({ ...prev, [record.id]: computed }));
      setStaleMap((prev) => ({ ...prev, [record.id]: stale }));
      await loadTotals();
    } catch (err) {
      message.error(`保存失败：${(err as Error).message}`);
      if (selectedSpaceId != null) loadItems(selectedSpaceId);
    }
  };

  const handleQtyBlur = (record: LineItem, e: React.FocusEvent<HTMLInputElement>): void => {
    const raw = e.target.value.replace(/,/g, '').trim();
    if (raw === '') return;
    const val = Number(raw);
    if (Number.isNaN(val) || val <= 0) {
      message.error('数量必须大于 0');
      return;
    }
    if (Math.abs(val - record.qty) < 0.0001) return;
    commitItemPatch(record, { qty: val });
  };

  const handleUnitPriceBlur = (record: LineItem, e: React.FocusEvent<HTMLInputElement>): void => {
    const raw = e.target.value.replace(/,/g, '').trim();
    if (raw === '') return;
    const val = Number(raw);
    if (Number.isNaN(val) || val < 0) {
      message.error('单价不能为负数');
      return;
    }
    const currentYuan = centsToYuan(computedMap[record.id]?.unitPriceCents ?? 0);
    if (Math.abs(val - currentYuan) < 0.005) return; // 未发生变化，跳过提交
    commitItemPatch(record, { manualUnitPriceCents: yuanToCents(val) });
  };

  const handleMarginBlur = (record: LineItem, e: React.FocusEvent<HTMLInputElement>): void => {
    const raw = e.target.value.replace(/,/g, '').trim();
    if (raw === '') return;
    const val = Number(raw);
    if (Number.isNaN(val) || val < 0) {
      message.error('倍率不能为负数');
      return;
    }
    const current = record.marginOverride ?? project?.defaultMargin ?? 1;
    if (Math.abs(val - current) < 0.0001) return; // 未发生变化，跳过提交
    commitItemPatch(record, { marginOverride: val, manualUnitPriceCents: null });
  };

  const handleRemarkBlur = (record: LineItem, e: React.FocusEvent<HTMLInputElement>): void => {
    const val = e.target.value;
    if (val === (record.remark ?? '')) return;
    commitItemPatch(record, { remark: val || null });
  };

  const handleRefreshSnapshot = async (itemId: number): Promise<void> => {
    setRefreshingId(itemId);
    try {
      const updated = await api.itemsRefreshSnapshot(itemId);
      setItems((prev) => prev.map((it) => (it.id === itemId ? updated : it)));
      const [computed, stale] = await Promise.all([api.itemsComputed(itemId), api.itemsCheckStale(itemId)]);
      setComputedMap((prev) => ({ ...prev, [itemId]: computed }));
      setStaleMap((prev) => ({ ...prev, [itemId]: stale }));
      await loadTotals();
      message.success('已刷新快照');
    } catch (err) {
      message.error(`刷新快照失败：${(err as Error).message}`);
    } finally {
      setRefreshingId(null);
    }
  };

  const handleDeleteItem = async (itemId: number): Promise<void> => {
    setDeletingItemId(itemId);
    try {
      await api.itemsDelete(itemId);
      message.success('已删除');
      if (selectedSpaceId != null) await loadItems(selectedSpaceId);
      await loadTotals();
    } catch (err) {
      message.error(`删除失败：${(err as Error).message}`);
    } finally {
      setDeletingItemId(null);
    }
  };

  // ---------- 换产品 ----------

  const openReplaceProductPicker = (record: LineItem): void => {
    setReplaceTargetItem(record);
    setReplacePickerOpen(true);
  };

  const closeReplacePicker = (): void => {
    setReplacePickerOpen(false);
  };

  const closeReplaceOptionsModal = (): void => {
    setReplaceOptionsModalOpen(false);
    setReplaceProduct(null);
    setReplaceOptionNames([]);
  };

  const doReplaceProduct = async (product: Product, optionNames: string[]): Promise<void> => {
    if (!replaceTargetItem) return;
    setReplaceSubmitting(true);
    try {
      await api.itemsReplaceProduct({ itemId: replaceTargetItem.id, productId: product.id, optionNames });
      message.success('已更换产品（手动价与候选成本已清除，请核对新成本价）');
      if (selectedSpaceId != null) await loadItems(selectedSpaceId);
      await loadTotals();
      if (selectedSectionId != null) await loadSectionQuote(selectedSectionId);
      setReplaceTargetItem(null);
      closeReplaceOptionsModal();
    } catch (err) {
      message.error(`换产品失败：${(err as Error).message}`);
    } finally {
      setReplaceSubmitting(false);
    }
  };

  const handleReplacePick = (product: Product): void => {
    setReplacePickerOpen(false);
    if (product.options.length > 0) {
      setReplaceProduct(product);
      setReplaceOptionNames([]);
      setReplaceOptionsModalOpen(true);
    } else {
      void doReplaceProduct(product, []);
    }
  };

  const handleReplaceOptionsConfirm = (): void => {
    if (!replaceProduct) return;
    void doReplaceProduct(replaceProduct, replaceOptionNames);
  };

  const openManualModal = (): void => {
    manualForm.resetFields();
    manualForm.setFieldsValue({ unit: '台', qty: 1 });
    setManualModalOpen(true);
  };

  const closeManualModal = (): void => {
    setManualModalOpen(false);
    manualForm.resetFields();
  };

  const handleManualSubmit = async (): Promise<void> => {
    if (selectedSpaceId == null) return;
    let values: ManualItemFormValues;
    try {
      values = await manualForm.validateFields();
    } catch (err) {
      if ((err as { errorFields?: unknown }).errorFields) return;
      throw err;
    }
    setManualSubmitting(true);
    try {
      const snapshot: LineItemSnapshot = {
        name: values.name,
        brand: null,
        model: null,
        recommendedBrands: [],
        paramsCore: null,
        paramsBid: null,
        paramsTender: null,
        unit: values.unit,
        dims: null,
        power220W: 0,
        power380W: 0,
        rackU: 0,
        seqPowerPorts: 0,
        netPorts: 0,
        comPorts: 0,
        costUnitCents: yuanToCents(values.costUnitYuan),
        optionsApplied: []
      };
      await api.itemsCreateManual({ spaceId: selectedSpaceId, qty: values.qty ?? 1, snapshot });
      message.success('已添加手工行');
      closeManualModal();
      await loadItems(selectedSpaceId);
      await loadTotals();
    } catch (err) {
      message.error(`添加失败：${(err as Error).message}`);
    } finally {
      setManualSubmitting(false);
    }
  };

  // ---------- 报价模式 ----------

  const handleModeChange = async (mode: QuoteMode): Promise<void> => {
    if (!project || mode === project.mode) return;
    setModeSwitching(true);
    try {
      const updated = await api.projectsUpdate({ id: project.id, patch: { mode } });
      setProject(updated);
      message.success('报价模式已切换');
    } catch (err) {
      message.error(`切换模式失败：${(err as Error).message}`);
    } finally {
      setModeSwitching(false);
    }
  };

  // ---------- 规则联动 ----------

  /** 产品加入清单成功后：评估该行触发的配套规则，有候选则打开配套面板。 */
  const handleProductAdded = async (created: LineItem): Promise<void> => {
    if (selectedSpaceId != null) await loadItems(selectedSpaceId);
    await loadTotals();
    try {
      const candidates = await api.rulesEvaluateItem({ projectId, itemId: created.id });
      if (candidates.length > 0) {
        setSuggestCandidates(candidates);
        setSuggestSpaceId(created.spaceId ?? selectedSpaceId);
        setSuggestOpen(true);
      }
    } catch (err) {
      message.error(`规则评估失败：${(err as Error).message}`);
    }
  };

  /** 应用项目级规则：以当前选中空间为目标，评估全项目候选并打开配套面板。 */
  const handleEvaluateProject = async (): Promise<void> => {
    if (selectedSpaceId == null) {
      message.warning('请先在左侧选择一个空间作为配套项加入目标');
      return;
    }
    setEvaluatingProject(true);
    try {
      const candidates = await api.rulesEvaluateProject(projectId);
      if (candidates.length === 0) {
        message.info('没有匹配的项目级规则');
        return;
      }
      setSuggestCandidates(candidates);
      setSuggestSpaceId(selectedSpaceId);
      setSuggestOpen(true);
    } catch (err) {
      message.error(`规则评估失败：${(err as Error).message}`);
    } finally {
      setEvaluatingProject(false);
    }
  };

  const handleProjectTypeBlur = async (e: React.FocusEvent<HTMLInputElement>): Promise<void> => {
    if (!project) return;
    const val = e.target.value.trim() || null;
    if (val === (project.projectType ?? null)) return;
    try {
      const updated = await api.projectsUpdate({ id: project.id, patch: { projectType: val } });
      setProject(updated);
      message.success('项目类型已更新');
    } catch (err) {
      message.error(`更新项目类型失败：${(err as Error).message}`);
    }
  };

  // ---------- 导出 ----------

  const openExportModal = (): void => {
    setOutDir(null);
    setExportedFiles(null);
    setExportModalOpen(true);
    void loadExportTemplates();
  };

  const loadExportTemplates = async (): Promise<void> => {
    try {
      const list = await api.exportTemplatesList();
      setExportTemplates(list);
      const factory = list.find((t) => t.name === FACTORY_TEMPLATE_NAME);
      const persistedValid = selectedTemplateId != null && list.some((t) => t.id === selectedTemplateId);
      if (!persistedValid) {
        setSelectedTemplateId(factory?.id ?? null);
      }
    } catch (err) {
      message.error(`加载导出模板列表失败：${(err as Error).message}`);
      setExportTemplates([]);
    }
  };

  const closeExportModal = (): void => {
    setExportModalOpen(false);
    setOutDir(null);
    setExportedFiles(null);
  };

  const handlePickDir = async (): Promise<void> => {
    try {
      const dir = await api.dialogPickDir();
      if (dir) setOutDir(dir);
    } catch (err) {
      message.error(`选择目录失败：${(err as Error).message}`);
    }
  };

  const handleExport = async (): Promise<void> => {
    if (!outDir) return;
    setExporting(true);
    try {
      const templateId = exportTemplates.length > 0 && selectedTemplateId != null ? selectedTemplateId : undefined;
      const files = await api.exportRun({ projectId, outDir, templateId });
      setExportedFiles(files);
      message.success('导出成功');
    } catch (err) {
      message.error(`导出失败：${(err as Error).message}`);
    } finally {
      setExporting(false);
    }
  };

  const handleExportCostCompare = async (): Promise<void> => {
    setCostCompareExporting(true);
    try {
      const dir = await api.dialogPickDir();
      if (!dir) return;
      const file = await api.exportCostCompare({ projectId, outDir: dir });
      message.success('成本对比版已导出');
      await api.shellReveal(file);
    } catch (err) {
      message.error(`导出成本对比版失败：${(err as Error).message}`);
    } finally {
      setCostCompareExporting(false);
    }
  };

  // ---------- 生成询价单 ----------

  const openInquiryModal = async (): Promise<void> => {
    setInquirySupplierIds([]);
    setInquiryTitle(`${project?.name ?? ''}-询价单`);
    setInquiryModalOpen(true);
    try {
      const list = await api.suppliersList();
      setInquirySuppliers(list);
    } catch (err) {
      message.error(`加载供应商列表失败：${(err as Error).message}`);
      setInquirySuppliers([]);
    }
  };

  const closeInquiryModal = (): void => {
    setInquiryModalOpen(false);
    setInquirySupplierIds([]);
  };

  const handleGenerateInquiry = async (): Promise<void> => {
    if (inquirySupplierIds.length === 0) {
      message.warning('请至少选择一个供应商');
      return;
    }
    const selectedItems = items.filter((it) => selectedItemKeys.includes(it.id));
    if (selectedItems.length === 0) {
      message.warning('请先在清单表中勾选行');
      return;
    }
    const title = inquiryTitle.trim() || `${project?.name ?? ''}-询价单`;
    const itemInputs = selectedItems.map((it) => ({
      productId: it.productId ?? null,
      name: it.snapshot.name,
      params: it.snapshot.paramsCore ?? null,
      unit: it.snapshot.unit,
      qty: it.qty,
      remark: it.remark ?? null
    }));
    setInquirySubmitting(true);
    try {
      await Promise.all(
        inquirySupplierIds.map((supplierId) =>
          api.inquiriesCreate({ supplierId, projectId, title, items: itemInputs })
        )
      );
      message.success(`已生成 ${inquirySupplierIds.length} 张询价单，可在供应商页查看`);
      closeInquiryModal();
      setSelectedItemKeys([]);
    } catch (err) {
      message.error(`生成询价单失败：${(err as Error).message}`);
    } finally {
      setInquirySubmitting(false);
    }
  };

  const handleReveal = async (filePath: string): Promise<void> => {
    try {
      await api.shellReveal(filePath);
    } catch (err) {
      message.error(`打开文件夹失败：${(err as Error).message}`);
    }
  };

  // ---------- 清单表格列 ----------

  const columns = [
    {
      title: '序号',
      key: 'idx',
      width: 56,
      render: (_: unknown, __: LineItem, idx: number) => idx + 1
    },
    {
      title: '名称',
      key: 'name',
      ellipsis: true,
      render: (_: unknown, record: LineItem) => (
        <Space>
          <span>{record.snapshot.name}</span>
          {record.productId == null && <Tag>手工</Tag>}
        </Space>
      )
    },
    {
      title: MODE_PARAMS_LABEL[project?.mode ?? 'budget'],
      key: 'params',
      render: (_: unknown, record: LineItem) => {
        const field = MODE_PARAMS_FIELD[project?.mode ?? 'budget'];
        const text = record.snapshot[field] ?? '';
        if (!text) return '-';
        return (
          <Tooltip title={text}>
            <span
              style={{
                display: 'inline-block',
                maxWidth: 160,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                verticalAlign: 'bottom'
              }}
            >
              {text}
            </span>
          </Tooltip>
        );
      }
    },
    {
      title: '单位',
      key: 'unit',
      render: (_: unknown, record: LineItem) => record.snapshot.unit
    },
    {
      title: '数量',
      key: 'qty',
      render: (_: unknown, record: LineItem) => (
        <InputNumber
          key={`qty-${record.id}-${record.qty}`}
          min={0.01}
          precision={2}
          defaultValue={record.qty}
          style={{ width: 90 }}
          onBlur={(e) => handleQtyBlur(record, e)}
        />
      )
    },
    {
      title: '成本单价（元）',
      key: 'costUnit',
      render: (_: unknown, record: LineItem) => (
        <Space>
          <span>{fmtYuan(record.snapshot.costUnitCents)}</span>
          <Button
            type="link"
            size="small"
            style={{ padding: 0 }}
            onClick={() => {
              setCostPanelItem(record);
              setCostPanelOpen(true);
            }}
          >
            比价
          </Button>
        </Space>
      )
    },
    {
      title: '单价（元）',
      key: 'unitPrice',
      render: (_: unknown, record: LineItem) => {
        const computed = computedMap[record.id];
        return (
          <Space>
            <InputNumber
              key={`price-${record.id}-${computed?.unitPriceCents ?? 0}`}
              min={0}
              precision={2}
              defaultValue={computed ? centsToYuan(computed.unitPriceCents) : 0}
              style={{ width: 100 }}
              onBlur={(e) => handleUnitPriceBlur(record, e)}
            />
            {record.manualUnitPriceCents != null && (
              <Tooltip title="手动定价">
                <Tag color="purple">手</Tag>
              </Tooltip>
            )}
          </Space>
        );
      }
    },
    {
      title: '倍率',
      key: 'margin',
      render: (_: unknown, record: LineItem) => (
        <InputNumber
          key={`margin-${record.id}-${record.marginOverride ?? 'd'}-${project?.defaultMargin ?? 1}`}
          min={0}
          precision={2}
          defaultValue={record.marginOverride ?? project?.defaultMargin ?? 1}
          style={{ width: 90 }}
          onBlur={(e) => handleMarginBlur(record, e)}
        />
      )
    },
    {
      title: '合计（元）',
      key: 'total',
      render: (_: unknown, record: LineItem) => {
        const c = computedMap[record.id];
        return c ? fmtYuan(c.totalCents) : '-';
      }
    },
    {
      title: '备注',
      key: 'remark',
      ellipsis: true,
      render: (_: unknown, record: LineItem) => (
        <Input
          key={`remark-${record.id}-${record.remark ?? ''}`}
          defaultValue={record.remark ?? ''}
          style={{ width: 120 }}
          onBlur={(e) => handleRemarkBlur(record, e)}
        />
      )
    },
    {
      title: '状态',
      key: 'status',
      render: (_: unknown, record: LineItem) => {
        const stale = staleMap[record.id];
        if (!stale) return <Tag>正常</Tag>;
        return (
          <Space>
            <Tag color="gold">价格已更新</Tag>
            <Button size="small" loading={refreshingId === record.id} onClick={() => handleRefreshSnapshot(record.id)}>
              刷新
            </Button>
          </Space>
        );
      }
    },
    {
      title: '操作',
      key: 'action',
      render: (_: unknown, record: LineItem) => (
        <Space>
          <Button type="link" onClick={() => openReplaceProductPicker(record)}>
            换产品
          </Button>
          <Popconfirm
            title="确认删除该行？"
            okText="确认"
            cancelText="取消"
            onConfirm={() => handleDeleteItem(record.id)}
          >
            <Button type="link" danger loading={deletingItemId === record.id}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      )
    }
  ];

  const profitRateText = (): string => {
    if (!totals || totals.projectTotals.totalCents <= 0) return '-';
    const rate = (totals.projectTotals.profitCents / totals.projectTotals.totalCents) * 100;
    return `${rate.toFixed(1)}%`;
  };

  const selectedSection = useMemo(
    () => (selectedSectionId != null ? sections.find((s) => s.id === selectedSectionId) ?? null : null),
    [selectedSectionId, sections]
  );

  /** 板块视图汇总行金额：与导出 detailSheet 口径一致（sectionTotals：equipment=不含费小计/fee=集成费/total=含费合计）。 */
  const selectedSectionTotals = useMemo(() => {
    if (selectedSectionId == null || !totals) return null;
    return totals.sections.find((s) => s.id === selectedSectionId)?.totals ?? null;
  }, [selectedSectionId, totals]);

  const quoteViewRows: QuoteViewRow[] = useMemo(() => {
    if (!selectedSection) return [];
    const rows: QuoteViewRow[] = [];
    for (const sd of sectionQuoteSpaces) {
      const subtotalCents = sd.items.reduce((sum, it) => sum + (sd.computed[it.id]?.totalCents ?? 0), 0);
      rows.push({
        type: 'space',
        key: `space-${sd.space.id}`,
        spaceId: sd.space.id,
        name: sd.space.name,
        area: sd.space.area,
        subtotalCents
      });
      sd.items.forEach((it, idx) => {
        rows.push({
          type: 'item',
          key: `item-${it.id}`,
          spaceId: sd.space.id,
          idx,
          item: it,
          computed: sd.computed[it.id] ?? { unitPriceCents: 0, totalCents: 0, costTotalCents: 0, ratio: null }
        });
      });
    }
    const subtotalLabel = selectedSection.subtotalLabel ?? `${selectedSection.name}小计`;
    const subtotalCents = selectedSectionTotals?.equipmentCents ?? rows.reduce((sum, r) => (r.type === 'space' ? sum + r.subtotalCents : sum), 0);
    rows.push({ type: 'subtotal', key: 'subtotal', label: subtotalLabel, amountCents: subtotalCents });
    const rate = selectedSection.integrationFeeRate;
    let totalCents = subtotalCents;
    if (rate > 0) {
      const feeCents = selectedSectionTotals?.integrationFeeCents ?? Math.round(subtotalCents * rate);
      const feeLabel = `${selectedSection.feeLabel ?? '系统集成费'}(${formatFeeRate(rate)}%)`;
      rows.push({ type: 'fee', key: 'fee', label: feeLabel, amountCents: feeCents });
      totalCents = selectedSectionTotals?.totalCents ?? subtotalCents + feeCents;
    }
    rows.push({ type: 'total', key: 'total', amountCents: totalCents });
    return rows;
  }, [selectedSection, sectionQuoteSpaces, selectedSectionTotals]);

  const quoteViewColumns = [
    {
      title: '序号',
      key: 'idx',
      width: 56,
      render: (_: unknown, row: QuoteViewRow) => (row.type === 'item' ? row.idx + 1 : '')
    },
    {
      title: '名称',
      key: 'name',
      ellipsis: true,
      render: (_: unknown, row: QuoteViewRow) => {
        if (row.type === 'space') {
          return (
            <Space>
              <Typography.Text strong>{row.name}</Typography.Text>
              {row.area != null && <Tag>{row.area}㎡</Tag>}
            </Space>
          );
        }
        if (row.type === 'item') {
          return (
            <Space>
              <span>{row.item.snapshot.name}</span>
              {row.item.productId == null && <Tag>手工</Tag>}
            </Space>
          );
        }
        if (row.type === 'subtotal' || row.type === 'fee') return <Typography.Text strong>{row.label}</Typography.Text>;
        return <Typography.Text strong>合计</Typography.Text>;
      }
    },
    {
      title: MODE_PARAMS_LABEL[project?.mode ?? 'budget'],
      key: 'params',
      render: (_: unknown, row: QuoteViewRow) => {
        if (row.type !== 'item') return '';
        const field = MODE_PARAMS_FIELD[project?.mode ?? 'budget'];
        return row.item.snapshot[field] ?? '-';
      }
    },
    {
      title: '单位',
      key: 'unit',
      render: (_: unknown, row: QuoteViewRow) => (row.type === 'item' ? row.item.snapshot.unit : '')
    },
    {
      title: '数量',
      key: 'qty',
      render: (_: unknown, row: QuoteViewRow) => (row.type === 'item' ? row.item.qty : '')
    },
    {
      title: '单价（元）',
      key: 'unitPrice',
      render: (_: unknown, row: QuoteViewRow) => (row.type === 'item' ? fmtYuan(row.computed.unitPriceCents) : '')
    },
    {
      title: '合计（元）',
      key: 'total',
      render: (_: unknown, row: QuoteViewRow) => {
        if (row.type === 'item') return fmtYuan(row.computed.totalCents);
        if (row.type === 'space') return <Typography.Text strong>{fmtYuan(row.subtotalCents)}</Typography.Text>;
        if (row.type === 'subtotal' || row.type === 'fee' || row.type === 'total') {
          return <Typography.Text strong>{fmtYuan(row.amountCents)}</Typography.Text>;
        }
        return '';
      }
    },
    {
      title: '备注',
      key: 'remark',
      render: (_: unknown, row: QuoteViewRow) => (row.type === 'item' ? row.item.remark ?? '' : '')
    },
    {
      title: '操作',
      key: 'action',
      render: (_: unknown, row: QuoteViewRow) => {
        const spaceId = row.type === 'space' ? row.spaceId : row.type === 'item' ? row.spaceId : null;
        if (spaceId == null) return null;
        return (
          <Button
            type="link"
            onClick={() => {
              setSelectedSectionId(null);
              setSelectedSpaceId(spaceId);
            }}
          >
            编辑
          </Button>
        );
      }
    }
  ];

  return (
    <div>
      <div style={{ ...PANEL_STYLE, marginBottom: 16 }}>
        <Space size="large" wrap style={{ width: '100%', justifyContent: 'space-between' }}>
          <Space size="large" wrap>
            <Typography.Text>
              总报价：<Typography.Text strong>{totals ? fmtYuan(totals.projectTotals.totalCents) : '-'}</Typography.Text> 元
            </Typography.Text>
            <Typography.Text>
              总成本：<Typography.Text strong>{totals ? fmtYuan(totals.projectTotals.costTotalCents) : '-'}</Typography.Text> 元
            </Typography.Text>
            <Typography.Text>
              总利润：<Typography.Text strong>{totals ? fmtYuan(totals.projectTotals.profitCents) : '-'}</Typography.Text> 元（利润率 {profitRateText()}）
            </Typography.Text>
            <Space>
              <Typography.Text>报价模式：</Typography.Text>
              <Popconfirm
                title="切换模式会改变清单参数列与导出格式，确认切换？"
                okText="确认"
                cancelText="取消"
                open={pendingMode != null}
                onConfirm={() => {
                  if (pendingMode) handleModeChange(pendingMode);
                  setPendingMode(null);
                }}
                onCancel={() => setPendingMode(null)}
              >
                <Select
                  value={project?.mode ?? 'budget'}
                  options={MODE_SELECT_OPTIONS}
                  disabled={modeSwitching}
                  style={{ width: 200 }}
                  onChange={(mode: QuoteMode) => setPendingMode(mode)}
                />
              </Popconfirm>
            </Space>
            <Space>
              <Typography.Text>项目类型：</Typography.Text>
              <Input
                key={`ptype-${project?.id ?? 0}-${project?.projectType ?? ''}`}
                defaultValue={project?.projectType ?? ''}
                placeholder="如 展厅/指挥中心"
                style={{ width: 160 }}
                onBlur={handleProjectTypeBlur}
              />
            </Space>
          </Space>
          <Button type="primary" icon={<ExportOutlined />} onClick={openExportModal}>
            导出
          </Button>
        </Space>
      </div>

      {project?.mode === 'estimate' ? (
        <EstimateEditor projectId={projectId} projectName={project.name} />
      ) : (
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        <div style={{ ...PANEL_STYLE, width: 280, flexShrink: 0 }}>
          <Button type="primary" block icon={<PlusOutlined />} onClick={openSectionCreateModal} style={{ marginBottom: 16 }}>
            新增板块
          </Button>
          <Spin spinning={treeLoading}>
            {treeData.length === 0 ? (
              <Empty description="暂无板块" />
            ) : (
              <Tree
                treeData={treeData}
                selectedKeys={
                  selectedSpaceId != null
                    ? [`space-${selectedSpaceId}`]
                    : selectedSectionId != null
                      ? [`section-${selectedSectionId}`]
                      : []
                }
                onSelect={handleTreeSelect}
                defaultExpandAll
                showLine
                blockNode
              />
            )}
          </Spin>
        </div>

        <div style={{ ...PANEL_STYLE, flex: 1, minWidth: 0 }}>
          <Breadcrumb
            style={{ marginBottom: 16 }}
            items={[
              { title: project?.name ?? '项目' },
              { title: selectedSpaceInfo?.section.name ?? selectedSection?.name ?? '未选择板块' },
              { title: selectedSpaceInfo?.space.name ?? (selectedSection ? '板块报价表（只读）' : '未选择空间') }
            ]}
          />

          {selectedSpaceId != null ? (
            <>
              <Space style={{ marginBottom: 16 }} wrap>
                <Button onClick={() => setPickerOpen(true)}>从产品库添加</Button>
                <Button onClick={openManualModal}>添加手工行</Button>
                <Button loading={evaluatingProject} onClick={handleEvaluateProject}>
                  应用项目级规则
                </Button>
                <Button disabled={selectedItemKeys.length === 0} onClick={openInquiryModal}>
                  生成询价单{selectedItemKeys.length > 0 ? `（已选 ${selectedItemKeys.length} 行）` : ''}
                </Button>
              </Space>
              <Table
                rowKey="id"
                rowSelection={{
                  selectedRowKeys: selectedItemKeys,
                  onChange: (keys) => setSelectedItemKeys(keys),
                  preserveSelectedRowKeys: true
                }}
                columns={columns}
                dataSource={items}
                loading={itemsLoading}
                pagination={false}
                locale={{ emptyText: <Empty description="暂无清单行" /> }}
                scroll={{ y: 'calc(100vh - 380px)' }}
              />
            </>
          ) : selectedSection != null ? (
            <Spin spinning={sectionQuoteLoading}>
              <Table
                rowKey="key"
                columns={quoteViewColumns}
                dataSource={quoteViewRows}
                pagination={false}
                locale={{ emptyText: <Empty description="该板块下暂无空间" /> }}
                scroll={{ y: 'calc(100vh - 380px)' }}
              />
            </Spin>
          ) : (
            <Empty description="请在左侧选择一个板块（查看报价表）或空间（编辑清单）" />
          )}
        </div>
      </div>
      )}

      {/* 板块 新增/编辑 */}
      <Modal
        title={editingSection ? '编辑板块' : '新增板块'}
        open={sectionModalOpen}
        onOk={handleSectionSubmit}
        onCancel={closeSectionModal}
        okText="保存"
        cancelText="取消"
        confirmLoading={sectionSubmitting}
        destroyOnClose
      >
        <Form form={sectionForm} layout="vertical">
          <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入板块名称' }]}>
            <Input placeholder="请输入板块名称" />
          </Form.Item>
          <Form.Item name="integrationFeeRatePercent" label="系统集成费率（%）">
            <InputNumber min={0} max={100} precision={2} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="isHardware" label="是否硬件板块" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item name="subtotalLabel" label="小计行名">
            <Input placeholder={`留空默认「${(sectionFormName || '板块').trim() || '板块'}小计」`} />
          </Form.Item>
          <Form.Item name="feeLabel" label="集成费行名">
            <Input placeholder="留空默认「系统集成费」" />
          </Form.Item>
          {editingSection && editingSection.id === sourceSectionId ? (
            <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
              该板块是项目内排序第一的板块（联动源），联动开关对其自身无意义，不显示。
            </Typography.Paragraph>
          ) : (
            <Form.Item
              name="linkSpaces"
              label="联动源板块空间"
              valuePropName="checked"
              extra="开启后，联动源板块（项目内排序第一的板块）新增/改名空间时会自动同步到本板块（删除不同步，置底空间不参与）"
            >
              <Switch />
            </Form.Item>
          )}
        </Form>
      </Modal>

      {/* 空间 新增/编辑 */}
      <Modal
        title={editingSpace ? '编辑空间' : '新增空间'}
        open={spaceModalOpen}
        onOk={handleSpaceSubmit}
        onCancel={closeSpaceModal}
        okText="保存"
        cancelText="取消"
        confirmLoading={spaceSubmitting}
        destroyOnClose
      >
        <Form form={spaceForm} layout="vertical">
          <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入空间名称' }]}>
            <Input placeholder="请输入空间名称" />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={2} placeholder="请输入描述" />
          </Form.Item>
          <Form.Item name="area" label="面积（㎡）">
            <InputNumber min={0} precision={2} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="pinBottom" label="置底" valuePropName="checked"
            extra="置底空间恒排在板块末尾（如安防监控/中控网络），新增空间自动插在其前">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>

      {/* 添加手工行 */}
      <Modal
        title="添加手工行"
        open={manualModalOpen}
        onOk={handleManualSubmit}
        onCancel={closeManualModal}
        okText="保存"
        cancelText="取消"
        confirmLoading={manualSubmitting}
        destroyOnClose
      >
        <Form form={manualForm} layout="vertical">
          <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入名称' }]}>
            <Input placeholder="请输入名称" />
          </Form.Item>
          <Form.Item name="unit" label="单位" rules={[{ required: true, message: '请输入单位' }]}>
            <Input placeholder="台" />
          </Form.Item>
          <Form.Item name="qty" label="数量" rules={[{ required: true, message: '请输入数量' }]}>
            <InputNumber min={0.01} precision={2} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="costUnitYuan" label="成本单价（元）" rules={[{ required: true, message: '请输入成本单价' }]}>
            <InputNumber min={0} precision={2} style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>

      {/* 生成询价单 */}
      <Modal
        title="生成询价单"
        open={inquiryModalOpen}
        onOk={handleGenerateInquiry}
        onCancel={closeInquiryModal}
        okText="生成"
        cancelText="取消"
        confirmLoading={inquirySubmitting}
        destroyOnClose
      >
        <Typography.Paragraph type="secondary">
          将按所选供应商各生成一张询价单（不含我方价格），共 {selectedItemKeys.length} 行。生成后可在「供应商」页查看/回价/导出。
        </Typography.Paragraph>
        <Form layout="vertical">
          <Form.Item label="标题">
            <Input value={inquiryTitle} onChange={(e) => setInquiryTitle(e.target.value)} placeholder="询价单标题" />
          </Form.Item>
          <Form.Item label="供应商（可多选，每个供应商各生成一张询价单）">
            <Select
              mode="multiple"
              value={inquirySupplierIds}
              onChange={(vals: number[]) => setInquirySupplierIds(vals)}
              options={inquirySuppliers.map((s) => ({ value: s.id, label: s.name }))}
              placeholder="请选择供应商"
              style={{ width: '100%' }}
            />
          </Form.Item>
        </Form>
      </Modal>

      {/* 从产品库添加 */}
      <ProductPicker
        open={pickerOpen}
        spaceId={selectedSpaceId}
        onClose={() => setPickerOpen(false)}
        onAdded={handleProductAdded}
      />

      {/* 换产品：选新产品 */}
      <ProductPicker
        open={replacePickerOpen}
        spaceId={null}
        mode="pick"
        onClose={closeReplacePicker}
        onPick={handleReplacePick}
      />

      {/* 换产品：选配确认 */}
      <Modal
        title={`选配确认：${replaceProduct?.name ?? ''}`}
        open={replaceOptionsModalOpen}
        onOk={handleReplaceOptionsConfirm}
        onCancel={closeReplaceOptionsModal}
        okText="确认换产品"
        cancelText="取消"
        confirmLoading={replaceSubmitting}
        destroyOnClose
      >
        <Typography.Paragraph type="secondary">
          该产品有选配项，可勾选后一并生效；换产品会清除本行手动定价与候选成本。
        </Typography.Paragraph>
        <Checkbox.Group
          value={replaceOptionNames}
          onChange={(vals) => setReplaceOptionNames(vals as string[])}
          style={{ width: '100%' }}
        >
          <Space direction="vertical">
            {(replaceProduct?.options ?? []).map((o: ProductOption) => (
              <Checkbox key={o.name} value={o.name}>
                {o.name}（+{fmtYuan(o.addPriceCents)} 元）
              </Checkbox>
            ))}
          </Space>
        </Checkbox.Group>
      </Modal>

      {/* 联动配套清单 */}
      <BomSuggestPanel
        open={suggestOpen}
        candidates={suggestCandidates}
        spaceId={suggestSpaceId}
        onClose={() => setSuggestOpen(false)}
        onApplied={() => {
          if (selectedSpaceId != null) loadItems(selectedSpaceId);
          loadTotals();
        }}
      />

      {/* 多供应商比价 */}
      <CostComparePanel
        open={costPanelOpen}
        lineItem={costPanelItem}
        onClose={() => setCostPanelOpen(false)}
        onActiveChanged={() => {
          if (selectedSpaceId != null) loadItems(selectedSpaceId);
          loadTotals();
        }}
      />

      {/* 导出 */}
      <Modal
        title={`导出（当前模式：${MODE_LABELS[project?.mode ?? 'budget']}）`}
        open={exportModalOpen}
        onCancel={closeExportModal}
        footer={null}
        destroyOnClose
      >
        {(() => {
          const selectedTemplate = exportTemplates.find((t) => t.id === selectedTemplateId) ?? null;
          const versionNames = selectedTemplate?.config.versions.map((v) => v.name) ?? null;
          return versionNames ? (
            <Typography.Paragraph>
              {`导出将生成 ${versionNames.length} 个 Excel 文件（含：${versionNames.join('、')}）。`}
            </Typography.Paragraph>
          ) : (
            <Typography.Paragraph>导出将生成三个 Excel 文件：含成本完整版、对外报价版、实施清单。</Typography.Paragraph>
          );
        })()}
        <Space direction="vertical" style={{ width: '100%' }}>
          <Space>
            <Typography.Text>导出模板：</Typography.Text>
            <Select
              style={{ width: 220 }}
              placeholder="标准三版本（出厂）"
              value={selectedTemplateId ?? undefined}
              onChange={(v) => setSelectedTemplateId(v)}
              disabled={exportTemplates.length === 0}
              options={exportTemplates.map((t) => ({ value: t.id, label: t.name }))}
            />
          </Space>
          <Space>
            <Button onClick={handlePickDir}>选择目录</Button>
            <Typography.Text type={outDir ? undefined : 'secondary'}>{outDir ?? '未选择目录'}</Typography.Text>
          </Space>
          <Button type="primary" disabled={!outDir} loading={exporting} onClick={handleExport}>
            开始导出
          </Button>
          {project?.mode !== 'estimate' && (
            <>
              <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>
                成本对比版：按各清单行的多供应商候选成本生成一张对比表（选择目录后立即导出）。
              </Typography.Paragraph>
              <Button loading={costCompareExporting} onClick={handleExportCostCompare}>
                导出成本对比版
              </Button>
            </>
          )}
          {exportedFiles && (
            <div style={{ marginTop: 8 }}>
              <Typography.Text strong>导出成功，生成文件：</Typography.Text>
              {exportedFiles.map((f) => (
                <div key={f} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginTop: 4 }}>
                  <Typography.Text style={{ maxWidth: 320 }} ellipsis={{ tooltip: f }}>
                    {f}
                  </Typography.Text>
                  <Button size="small" onClick={() => handleReveal(f)}>
                    打开所在文件夹
                  </Button>
                </div>
              ))}
            </div>
          )}
        </Space>
      </Modal>
    </div>
  );
}
