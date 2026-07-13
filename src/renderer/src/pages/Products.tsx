import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Button,
  Table,
  Modal,
  Form,
  Input,
  InputNumber,
  Select,
  Tabs,
  Popconfirm,
  message,
  Space,
  Empty,
  Typography,
  Row,
  Col,
  Tag,
  Switch,
  Drawer,
  List,
  Checkbox
} from 'antd';
import dayjs from 'dayjs';
import type { Product, ProductOption, Cents, CategoryParamTemplate, CategoryParamDefaults, ScreenshotProductResult } from '../../../shared/api-types';
import { api } from '../api';
import { yuanToCents, centsToYuan, fmtYuan } from '../money';
import PricePanel from '../components/PricePanel';
import { usePersistedState } from '../useListState';
import ScreenshotCapture, { type CaptureImage } from '../components/ScreenshotCapture';

/** 产品库深度筛选条件（持久化至 localStorage）。 */
interface ProductsFilter {
  categories: string[];
  brand: string;
  keyword: string;
  onlyWatched: boolean;
}

const EMPTY_FILTER: ProductsFilter = { categories: [], brand: '', keyword: '', onlyWatched: false };

interface ProductFormOption {
  name: string;
  addPriceYuan: number;
  paramsText?: string;
}

interface ProductFormValues {
  categories: string[];
  name: string;
  brand?: string;
  model?: string;
  recommendedBrands?: string[];
  unit: string;
  dims?: string;
  paramsCore?: string;
  paramsBid?: string;
  paramsTender?: string;
  power220W?: number;
  power380W?: number;
  rackU?: number;
  seqPowerPorts?: number;
  netPorts?: number;
  comPorts?: number;
  note?: string;
  options?: ProductFormOption[];
}

/** 类别参数模板表单值：category + defaults 结构展平，字段均可选（未填不参与模板默认值）。 */
interface TemplateFormValues {
  category: string;
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

const TEMPLATE_DEFAULTS_LABELS: Record<keyof CategoryParamDefaults, string> = {
  unit: '单位',
  power220W: '220V(W)',
  power380W: '380V(W)',
  rackU: 'U数',
  seqPowerPorts: '时序电源',
  netPorts: '网口',
  comPorts: 'com口',
  paramsCore: '核心参数',
  paramsBid: '招标参数',
  paramsTender: '投标参数'
};

/** 摘要文案：仅列出已设置的字段，供模板列表行展示。 */
function summarizeDefaults(defaults: CategoryParamDefaults): string {
  const parts: string[] = [];
  (Object.keys(TEMPLATE_DEFAULTS_LABELS) as (keyof CategoryParamDefaults)[]).forEach((k) => {
    const v = defaults[k];
    if (v === undefined || v === null || v === '') return;
    parts.push(`${TEMPLATE_DEFAULTS_LABELS[k]}=${v}`);
  });
  return parts.length > 0 ? parts.join('，') : '（未设置默认值）';
}

export default function Products(): React.JSX.Element {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = usePersistedState<ProductsFilter>('aiquote.filters.products', EMPTY_FILTER);
  const [pageSize, setPageSize] = usePersistedState<number>('aiquote.pageSize.products', 10);
  const [currentPage, setCurrentPage] = useState(1);
  const [effectiveCosts, setEffectiveCosts] = useState<Record<number, Cents | null>>({});
  // 多选批量
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [batchDeleting, setBatchDeleting] = useState(false);
  const [batchCatModalOpen, setBatchCatModalOpen] = useState(false);
  const [batchCatMode, setBatchCatMode] = useState<'replace' | 'append'>('replace');
  const [batchCatValues, setBatchCatValues] = useState<string[]>([]);
  const [batchSubmitting, setBatchSubmitting] = useState(false);
  const [batchWatching, setBatchWatching] = useState(false);
  const [watchTogglingId, setWatchTogglingId] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [pricePanelProduct, setPricePanelProduct] = useState<Product | null>(null);
  const [pricePanelOpen, setPricePanelOpen] = useState(false);
  const [allCategories, setAllCategories] = useState<string[]>([]);
  const [suggestingBrands, setSuggestingBrands] = useState(false);
  const [form] = Form.useForm<ProductFormValues>();
  // 新建/编辑弹窗内「截图识别」子弹窗：识别结果不落库，成功后仅填充当前为空的表单字段；
  // 识别出价格时可选在建档/保存成功后写入一条价格记录（手工来源）。
  const [screenshotOpen, setScreenshotOpen] = useState(false);
  const [screenshotImage, setScreenshotImage] = useState<CaptureImage | null>(null);
  const [screenshotRecognizing, setScreenshotRecognizing] = useState(false);
  const [screenshotResult, setScreenshotResult] = useState<ScreenshotProductResult | null>(null);
  const [writeRecognizedPrice, setWriteRecognizedPrice] = useState(true);
  const productsSeqRef = useRef(0);

  // 类别参数模板管理
  const [templateDrawerOpen, setTemplateDrawerOpen] = useState(false);
  const [categoryTemplates, setCategoryTemplates] = useState<CategoryParamTemplate[]>([]);
  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<CategoryParamTemplate | null>(null);
  const [templateSubmitting, setTemplateSubmitting] = useState(false);
  const [templateDeletingId, setTemplateDeletingId] = useState<number | null>(null);
  const [templateForm] = Form.useForm<TemplateFormValues>();

  const loadCategoryTemplates = async (): Promise<void> => {
    try {
      const list = await api.categoryTemplatesList();
      setCategoryTemplates(list);
    } catch (err) {
      message.error(`加载类别参数模板失败：${(err as Error).message}`);
    }
  };

  const openTemplateDrawer = (): void => {
    setTemplateDrawerOpen(true);
    loadCategoryTemplates();
  };

  const closeTemplateDrawer = (): void => setTemplateDrawerOpen(false);

  const openCreateTemplateModal = (): void => {
    setEditingTemplate(null);
    templateForm.resetFields();
    setTemplateModalOpen(true);
  };

  const openEditTemplateModal = (t: CategoryParamTemplate): void => {
    setEditingTemplate(t);
    templateForm.setFieldsValue({ category: t.category, ...t.defaults });
    setTemplateModalOpen(true);
  };

  const closeTemplateModal = (): void => {
    setTemplateModalOpen(false);
    setEditingTemplate(null);
    templateForm.resetFields();
  };

  const handleTemplateSubmit = async (): Promise<void> => {
    let values: TemplateFormValues;
    try {
      values = await templateForm.validateFields();
    } catch (err) {
      if ((err as { errorFields?: unknown }).errorFields) return;
      throw err;
    }
    const { category, ...rest } = values;
    const defaults: CategoryParamDefaults = {};
    (Object.keys(rest) as (keyof typeof rest)[]).forEach((k) => {
      const v = rest[k];
      if (v !== undefined && v !== null && v !== '') (defaults as any)[k] = v;
    });
    setTemplateSubmitting(true);
    try {
      if (editingTemplate) {
        await api.categoryTemplatesUpdate({ id: editingTemplate.id, patch: { category, defaults } });
      } else {
        await api.categoryTemplatesCreate({ category, defaults });
      }
      message.success('保存成功');
      closeTemplateModal();
      loadCategoryTemplates();
    } catch (err) {
      message.error(`保存失败：${(err as Error).message}`);
    } finally {
      setTemplateSubmitting(false);
    }
  };

  const handleDeleteTemplate = async (id: number): Promise<void> => {
    setTemplateDeletingId(id);
    try {
      await api.categoryTemplatesDelete(id);
      message.success('删除成功');
      loadCategoryTemplates();
    } catch (err) {
      message.error(`删除失败：${(err as Error).message}`);
    } finally {
      setTemplateDeletingId(null);
    }
  };

  const loadCategories = async (): Promise<void> => {
    try {
      const all = await api.productsList();
      const set = new Set<string>();
      all.forEach((p) => p.categories.forEach((c) => { if (c) set.add(c); }));
      setAllCategories(Array.from(set).sort());
    } catch {
      // 分类加载失败不阻塞主流程
    }
  };

  const loadProducts = async (): Promise<void> => {
    const seq = ++productsSeqRef.current;
    setLoading(true);
    try {
      const list = await api.productsList();
      if (seq !== productsSeqRef.current) return; // 加载已被更新的加载覆盖，丢弃过期响应
      const costs = await Promise.all(list.map((p) => api.pricesEffectiveCost(p.id)));
      if (seq !== productsSeqRef.current) return; // 筛选条件已变化，丢弃过期响应
      setProducts(list);
      const map: Record<number, Cents | null> = {};
      list.forEach((p, i) => {
        map[p.id] = costs[i];
      });
      setEffectiveCosts(map);
    } catch (err) {
      if (seq === productsSeqRef.current) message.error(`加载产品列表失败：${(err as Error).message}`);
    } finally {
      if (seq === productsSeqRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    loadCategories();
  }, []);

  useEffect(() => {
    loadProducts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 筛选变化时回到第 1 页
  useEffect(() => {
    setCurrentPage(1);
  }, [filter]);

  // 深度筛选：分类(命中任一)、品牌(包含,忽略大小写)、关键词(名称/型号,忽略大小写) 组合 AND
  const filteredProducts = useMemo(() => {
    const brandKw = filter.brand.trim().toLowerCase();
    const kw = filter.keyword.trim().toLowerCase();
    return products.filter((p) => {
      if (filter.categories.length > 0) {
        const hit = p.categories.some((c) => filter.categories.includes(c));
        if (!hit) return false;
      }
      if (brandKw && !(p.brand ?? '').toLowerCase().includes(brandKw)) return false;
      if (kw) {
        const inName = p.name.toLowerCase().includes(kw);
        const inModel = (p.model ?? '').toLowerCase().includes(kw);
        if (!inName && !inModel) return false;
      }
      if (filter.onlyWatched && !p.watchPrice) return false;
      return true;
    });
  }, [products, filter]);

  const resetFilter = (): void => setFilter(EMPTY_FILTER);
  const clearSelection = (): void => setSelectedRowKeys([]);
  const selectedIds = useMemo(() => selectedRowKeys.map((k) => Number(k)), [selectedRowKeys]);

  const refreshCost = async (productId: number): Promise<void> => {
    try {
      const cost = await api.pricesEffectiveCost(productId);
      setEffectiveCosts((prev) => ({ ...prev, [productId]: cost }));
    } catch (err) {
      message.error(`刷新成本价失败：${(err as Error).message}`);
    }
  };

  const resetScreenshotState = (): void => {
    setScreenshotOpen(false);
    setScreenshotImage(null);
    setScreenshotResult(null);
    setWriteRecognizedPrice(true);
  };

  const openCreateModal = (): void => {
    setEditing(null);
    form.resetFields();
    resetScreenshotState();
    setModalOpen(true);
  };

  const openEditModal = (record: Product): void => {
    setEditing(record);
    form.setFieldsValue({
      categories: record.categories,
      name: record.name,
      brand: record.brand ?? undefined,
      model: record.model ?? undefined,
      recommendedBrands: record.recommendedBrands,
      unit: record.unit,
      dims: record.dims ?? undefined,
      paramsCore: record.paramsCore ?? undefined,
      paramsBid: record.paramsBid ?? undefined,
      paramsTender: record.paramsTender ?? undefined,
      power220W: record.power220W,
      power380W: record.power380W,
      rackU: record.rackU,
      seqPowerPorts: record.seqPowerPorts,
      netPorts: record.netPorts,
      comPorts: record.comPorts,
      note: record.note ?? undefined,
      options: record.options.map((o) => ({
        name: o.name,
        addPriceYuan: centsToYuan(o.addPriceCents),
        paramsText: o.paramsText ?? undefined
      }))
    });
    resetScreenshotState();
    setModalOpen(true);
  };

  const closeModal = (): void => {
    setModalOpen(false);
    setEditing(null);
    form.resetFields();
    resetScreenshotState();
  };

  const closeScreenshotModal = (): void => {
    setScreenshotOpen(false);
    setScreenshotImage(null);
    setScreenshotResult(null);
  };

  const handleScreenshotImageChange = (img: CaptureImage | null): void => {
    setScreenshotImage(img);
    setScreenshotResult(null);
  };

  const handleRecognizeProductScreenshot = async (): Promise<void> => {
    if (!screenshotImage) {
      message.error('请先粘贴或拖入产品页截图');
      return;
    }
    setScreenshotRecognizing(true);
    try {
      const r = await api.productsRecognizeScreenshot({
        image: { mediaType: screenshotImage.mediaType, base64: screenshotImage.base64 }
      });
      setScreenshotResult(r);
      if (!r.found) {
        message.warning(`未能从截图中识别出产品信息${r.note ? `：${r.note}` : ''}`);
        return;
      }
      // 仅填当前为空的字段，不覆盖用户已填写的内容。
      const current = form.getFieldsValue() as ProductFormValues;
      const patch: Partial<ProductFormValues> = {};
      if ((!current.categories || current.categories.length === 0) && r.category) {
        patch.categories = [r.category];
      }
      if (!current.name && r.name) patch.name = r.name;
      if (!current.brand && r.brand) patch.brand = r.brand;
      if (!current.model && r.model) patch.model = r.model;
      if (!current.dims && r.dims) patch.dims = r.dims;
      // 单位的表单默认值为「台」：未被用户改动过的默认值视为"空"，允许识别结果填入
      if ((!current.unit || current.unit === '台') && r.unit) patch.unit = r.unit;
      if (!current.paramsCore && r.paramsCore) patch.paramsCore = r.paramsCore;
      if (Object.keys(patch).length > 0) form.setFieldsValue(patch);
      setWriteRecognizedPrice(true);
      message.success('已识别产品信息，未填字段已自动填充');
      setScreenshotOpen(false);
    } catch (err) {
      message.error(`识别失败：${(err as Error).message}`);
    } finally {
      setScreenshotRecognizing(false);
    }
  };


  // 比价浏览器操作区：付费版填充为两个按钮，免费版剥离后保持 null（ScreenshotCapture 不渲染该行）。
  let screenshotPriceBrowserActions: React.ReactNode = null;

  /** 建档/保存成功后，若识别出价格且勾选写入，则写一条价格记录（手工来源）；失败不影响主流程，仅提示。 */
  const writePendingRecognizedPrice = async (productId: number): Promise<void> => {
    if (!writeRecognizedPrice || screenshotResult?.priceYuan == null) return;
    try {
      await api.pricesAdd({
        productId,
        source: 'manual',
        priceCents: yuanToCents(screenshotResult.priceYuan),
        sourceUrl: '截图识别产品建档',
        capturedAt: dayjs().toISOString()
      });
    } catch (err) {
      message.error(`价格记录写入失败：${(err as Error).message}`);
    }
  };

  const handleSubmit = async (): Promise<void> => {
    let values: ProductFormValues;
    try {
      values = await form.validateFields();
    } catch (err) {
      if ((err as { errorFields?: unknown }).errorFields) {
        // 表单校验失败，无需额外提示
        return;
      }
      throw err;
    }
    const options: ProductOption[] = (values.options ?? [])
      .filter((o) => o && o.name)
      .map((o) => ({
        name: o.name,
        addPriceCents: yuanToCents(o.addPriceYuan ?? 0),
        paramsText: o.paramsText?.trim() || null
      }));
    const categories = (values.categories ?? []).map((c) => c.trim()).filter(Boolean);

    setSubmitting(true);
    try {
      if (editing) {
        await api.productsUpdate({
          id: editing.id,
          patch: {
            categories,
            name: values.name,
            unit: values.unit,
            brand: values.brand || null,
            model: values.model || null,
            recommendedBrands: values.recommendedBrands ?? [],
            paramsCore: values.paramsCore || null,
            paramsBid: values.paramsBid || null,
            paramsTender: values.paramsTender || null,
            dims: values.dims || null,
            power220W: values.power220W ?? 0,
            power380W: values.power380W ?? 0,
            rackU: values.rackU ?? 0,
            seqPowerPorts: values.seqPowerPorts ?? 0,
            netPorts: values.netPorts ?? 0,
            comPorts: values.comPorts ?? 0,
            note: values.note || null,
            options
          }
        });
        await writePendingRecognizedPrice(editing.id);
        message.success('产品已更新');
      } else {
        const created = await api.productsCreate({
          categories,
          name: values.name,
          unit: values.unit,
          brand: values.brand || undefined,
          model: values.model || undefined,
          recommendedBrands: values.recommendedBrands ?? [],
          paramsCore: values.paramsCore || undefined,
          paramsBid: values.paramsBid || undefined,
          paramsTender: values.paramsTender || undefined,
          dims: values.dims || undefined,
          power220W: values.power220W ?? undefined,
          power380W: values.power380W ?? undefined,
          rackU: values.rackU ?? undefined,
          seqPowerPorts: values.seqPowerPorts ?? undefined,
          netPorts: values.netPorts ?? undefined,
          comPorts: values.comPorts ?? undefined,
          note: values.note || undefined,
          options
        });
        await writePendingRecognizedPrice(created.id);
        message.success('产品已创建');
      }
      closeModal();
      await loadCategories();
      await loadProducts();
    } catch (err) {
      message.error(`保存产品失败：${(err as Error).message}`);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: number): Promise<void> => {
    setDeletingId(id);
    try {
      await api.productsDelete(id);
      message.success('产品已删除');
      await loadProducts();
    } catch (err) {
      message.error(`删除产品失败：${(err as Error).message}`);
    } finally {
      setDeletingId(null);
    }
  };

  const handleBatchDelete = async (): Promise<void> => {
    if (selectedIds.length === 0) return;
    setBatchDeleting(true);
    try {
      const n = await api.productsBatchDelete(selectedIds);
      message.success(`已删除 ${n} 个产品`);
      clearSelection();
      await loadCategories();
      await loadProducts();
    } catch (err) {
      message.error(`批量删除失败：${(err as Error).message}`);
    } finally {
      setBatchDeleting(false);
    }
  };

  const openBatchCatModal = (mode: 'replace' | 'append'): void => {
    setBatchCatMode(mode);
    setBatchCatValues([]);
    setBatchCatModalOpen(true);
  };

  const closeBatchCatModal = (): void => {
    setBatchCatModalOpen(false);
    setBatchCatValues([]);
  };

  const handleBatchCatSubmit = async (): Promise<void> => {
    const categories = batchCatValues.map((c) => c.trim()).filter(Boolean);
    if (categories.length === 0) {
      message.warning('请至少输入一个分类');
      return;
    }
    setBatchSubmitting(true);
    try {
      const n = await api.productsBatchSetCategories({ ids: selectedIds, categories, mode: batchCatMode });
      message.success(batchCatMode === 'replace' ? `已为 ${n} 个产品替换分类` : `已为 ${n} 个产品追加标签`);
      closeBatchCatModal();
      clearSelection();
      await loadCategories();
      await loadProducts();
    } catch (err) {
      message.error(`批量改分类失败：${(err as Error).message}`);
    } finally {
      setBatchSubmitting(false);
    }
  };

  const handleToggleWatch = async (record: Product, checked: boolean): Promise<void> => {
    setWatchTogglingId(record.id);
    try {
      await api.productsUpdate({ id: record.id, patch: { watchPrice: checked } });
      setProducts((prev) => prev.map((p) => (p.id === record.id ? { ...p, watchPrice: checked } : p)));
    } catch (err) {
      message.error(`更新监控状态失败：${(err as Error).message}`);
    } finally {
      setWatchTogglingId(null);
    }
  };

  const handleBatchSetWatch = async (watch: boolean): Promise<void> => {
    if (selectedIds.length === 0) return;
    setBatchWatching(true);
    try {
      const n = await api.productsSetWatchPrice({ ids: selectedIds, watch });
      message.success(watch ? `已将 ${n} 个产品设为监控` : `已取消 ${n} 个产品的监控`);
      clearSelection();
      await loadProducts();
    } catch (err) {
      message.error(`批量设置监控失败：${(err as Error).message}`);
    } finally {
      setBatchWatching(false);
    }
  };

  const handleBatchExport = async (): Promise<void> => {
    if (selectedIds.length === 0) return;
    try {
      const dir = await api.dialogPickDir();
      if (!dir) return;
      setExporting(true);
      const filePath = await api.exportProducts({ ids: selectedIds, outDir: dir });
      message.success(`已导出 ${selectedIds.length} 个产品`);
      await api.shellReveal(filePath);
    } catch (err) {
      message.error(`导出失败：${(err as Error).message}`);
    } finally {
      setExporting(false);
    }
  };

  const handleSuggestBrands = async (): Promise<void> => {
    const brand = form.getFieldValue('brand') as string | undefined;
    const categories = (form.getFieldValue('categories') as string[] | undefined) ?? [];
    setSuggestingBrands(true);
    try {
      const suggested = await api.productsSuggestBrands({
        brand: brand || null,
        categories,
        excludeProductId: editing?.id
      });
      form.setFieldsValue({ recommendedBrands: suggested });
    } catch (err) {
      message.error(`生成推荐品牌失败：${(err as Error).message}`);
    } finally {
      setSuggestingBrands(false);
    }
  };

  const openPricePanel = (record: Product): void => {
    setPricePanelProduct(record);
    setPricePanelOpen(true);
  };

  const closePricePanel = (): void => {
    setPricePanelOpen(false);
    setPricePanelProduct(null);
  };

  const categoryOptions = useMemo(() => allCategories.map((c) => ({ value: c, label: c })), [allCategories]);

  const columns = [
    {
      title: '分类',
      key: 'categories',
      render: (_: unknown, record: Product) => (
        <Space size={[4, 4]} wrap>
          {record.categories.map((c) => (
            <Tag key={c}>{c}</Tag>
          ))}
        </Space>
      )
    },
    { title: '名称', dataIndex: 'name', key: 'name' },
    { title: '品牌', dataIndex: 'brand', key: 'brand', render: (v: string | null) => v ?? '-' },
    { title: '型号', dataIndex: 'model', key: 'model', render: (v: string | null) => v ?? '-' },
    { title: '单位', dataIndex: 'unit', key: 'unit' },
    {
      title: '当前成本价',
      key: 'effectiveCost',
      render: (_: unknown, record: Product) => {
        const cost = effectiveCosts[record.id];
        if (cost === undefined) return '-';
        if (cost === null) return <Typography.Text type="danger">无价格</Typography.Text>;
        return fmtYuan(cost);
      }
    },
    {
      title: '监控',
      key: 'watchPrice',
      render: (_: unknown, record: Product) => (
        <Switch
          checked={record.watchPrice}
          loading={watchTogglingId === record.id}
          onChange={(checked) => handleToggleWatch(record, checked)}
        />
      )
    },
    {
      title: '操作',
      key: 'action',
      render: (_: unknown, record: Product) => (
        <Space>
          <Button type="link" onClick={() => openEditModal(record)}>
            编辑
          </Button>
          <Button type="link" onClick={() => openPricePanel(record)}>
            价格
          </Button>
          <Popconfirm
            title="确认删除该产品？"
            okText="确认"
            cancelText="取消"
            okButtonProps={{ loading: deletingId === record.id }}
            onConfirm={() => handleDelete(record.id)}
          >
            <Button type="link" danger loading={deletingId === record.id}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      )
    }
  ];

  return (
    <div>
      <Typography.Title level={4} style={{ marginTop: 0, marginBottom: 16 }}>
        产品库
      </Typography.Title>
      <Space style={{ marginBottom: 16 }} wrap>
        <Select
          allowClear
          mode="multiple"
          placeholder="按分类筛选（命中任一）"
          style={{ minWidth: 220 }}
          maxTagCount="responsive"
          options={categoryOptions}
          value={filter.categories}
          onChange={(v) => setFilter({ ...filter, categories: v })}
        />
        <Input
          allowClear
          placeholder="按品牌筛选"
          style={{ width: 160 }}
          value={filter.brand}
          onChange={(e) => setFilter({ ...filter, brand: e.target.value })}
        />
        <Input.Search
          allowClear
          placeholder="按名称/型号搜索"
          style={{ width: 240 }}
          value={filter.keyword}
          onChange={(e) => setFilter({ ...filter, keyword: e.target.value })}
          onSearch={(v) => setFilter({ ...filter, keyword: v })}
        />
        <Space>
          <span>仅监控中</span>
          <Switch
            checked={filter.onlyWatched}
            onChange={(checked) => setFilter({ ...filter, onlyWatched: checked })}
          />
        </Space>
        <Button onClick={resetFilter}>重置筛选</Button>
        <Button type="primary" onClick={openCreateModal}>
          新增产品
        </Button>
        <Button onClick={openTemplateDrawer}>类别参数模板</Button>
      </Space>
      {selectedRowKeys.length > 0 && (
        <Space style={{ marginBottom: 16 }} wrap>
          <Typography.Text strong>已选 {selectedRowKeys.length} 项</Typography.Text>
          <Button size="small" onClick={clearSelection}>
            清空选择
          </Button>
          <Button size="small" onClick={() => openBatchCatModal('replace')}>
            批量改分类
          </Button>
          <Button size="small" onClick={() => openBatchCatModal('append')}>
            批量加标签
          </Button>
          <Button size="small" loading={batchWatching} onClick={() => handleBatchSetWatch(true)}>
            设为监控
          </Button>
          <Button size="small" loading={batchWatching} onClick={() => handleBatchSetWatch(false)}>
            取消监控
          </Button>
          <Button size="small" loading={exporting} onClick={handleBatchExport}>
            导出选中
          </Button>
          <Popconfirm
            title={`确认删除选中 ${selectedRowKeys.length} 个产品？`}
            okText="确认"
            cancelText="取消"
            okButtonProps={{ loading: batchDeleting }}
            onConfirm={handleBatchDelete}
          >
            <Button size="small" danger loading={batchDeleting}>
              批量删除
            </Button>
          </Popconfirm>
        </Space>
      )}
      <Table
        size="small"
        rowKey="id"
        rowSelection={{
          selectedRowKeys,
          onChange: (keys) => setSelectedRowKeys(keys),
          preserveSelectedRowKeys: true
        }}
        columns={columns}
        dataSource={filteredProducts}
        loading={loading}
        locale={{ emptyText: <Empty description="暂无产品" /> }}
        pagination={{
          current: currentPage,
          pageSize,
          showSizeChanger: true,
          pageSizeOptions: ['10', '20', '50', '100'],
          showTotal: (t) => `共 ${t} 条`,
          onChange: (page, size) => {
            setCurrentPage(page);
            if (size !== pageSize) setPageSize(size);
          }
        }}
      />
      <Modal
        title={editing ? '编辑产品' : '新增产品'}
        open={modalOpen}
        onOk={handleSubmit}
        onCancel={closeModal}
        okText="保存"
        cancelText="取消"
        confirmLoading={submitting}
        destroyOnClose
        width={800}
      >
        <Space style={{ marginBottom: 12 }}>
          <Button onClick={() => setScreenshotOpen(true)}>截图识别</Button>
        </Space>
        {screenshotResult?.priceYuan != null && (
          <div style={{ marginBottom: 12 }}>
            <Checkbox checked={writeRecognizedPrice} onChange={(e) => setWriteRecognizedPrice(e.target.checked)}>
              建档后写入价格记录 ¥{screenshotResult.priceYuan.toFixed(2)}（手工来源）
            </Checkbox>
          </div>
        )}
        <Form form={form} layout="vertical" initialValues={{ unit: '台' }}>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="categories"
                label="分类"
                rules={[{ required: true, type: 'array', min: 1, message: '请至少选择或输入一个分类' }]}
              >
                <Select
                  mode="tags"
                  options={categoryOptions}
                  placeholder="输入或选择分类，可多选（如设备类别 + 尺寸标签）"
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入名称' }]}>
                <Input placeholder="请输入产品名称" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="brand" label="品牌">
                <Input placeholder="请输入品牌" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="model" label="型号">
                <Input placeholder="请输入型号" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="推荐品牌">
                <Space.Compact style={{ width: '100%' }}>
                  <Form.Item name="recommendedBrands" noStyle>
                    <Select mode="tags" placeholder="输入后回车添加，通常 3 个" style={{ width: '100%' }} />
                  </Form.Item>
                  <Button loading={suggestingBrands} onClick={handleSuggestBrands}>
                    自动生成
                  </Button>
                </Space.Compact>
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="unit" label="单位" rules={[{ required: true, message: '请输入单位' }]}>
                <Input placeholder="台" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="dims" label="规格尺寸">
                <Input placeholder="请输入规格尺寸" />
              </Form.Item>
            </Col>
          </Row>

          <Tabs
            style={{ marginBottom: 16 }}
            items={[
              {
                key: 'paramsCore',
                label: '核心参数',
                children: (
                  <Form.Item name="paramsCore" noStyle>
                    <Input.TextArea rows={3} placeholder="请输入核心参数" />
                  </Form.Item>
                )
              },
              {
                key: 'paramsBid',
                label: '招标参数',
                children: (
                  <Form.Item name="paramsBid" noStyle>
                    <Input.TextArea rows={3} placeholder="请输入招标参数" />
                  </Form.Item>
                )
              },
              {
                key: 'paramsTender',
                label: '投标参数',
                children: (
                  <Form.Item name="paramsTender" noStyle>
                    <Input.TextArea rows={3} placeholder="请输入投标参数" />
                  </Form.Item>
                )
              }
            ]}
          />

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="power220W" label="220V 用电量（W）">
                <InputNumber min={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="power380W" label="380V 用电量（W）">
                <InputNumber min={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="rackU" label="机柜占用（U）">
                <InputNumber min={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="seqPowerPorts" label="时序电源（路）">
                <InputNumber min={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="netPorts" label="网口数">
                <InputNumber min={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="comPorts" label="com 口数">
                <InputNumber min={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item name="note" label="备注">
            <Input.TextArea rows={2} placeholder="请输入备注" />
          </Form.Item>

          <Form.Item label="选配项">
            <Form.List name="options">
              {(fields, { add, remove }) => (
                <div>
                  {fields.map(({ key, name, ...restField }) => (
                    <Space key={key} style={{ display: 'flex', marginBottom: 8 }} align="baseline">
                      <Form.Item
                        {...restField}
                        name={[name, 'name']}
                        rules={[{ required: true, message: '请输入选配项名称' }]}
                      >
                        <Input placeholder="选配项名称" />
                      </Form.Item>
                      <Form.Item
                        {...restField}
                        name={[name, 'addPriceYuan']}
                        rules={[{ required: true, message: '请输入加价' }]}
                      >
                        <InputNumber min={0} precision={2} placeholder="加价（元）" />
                      </Form.Item>
                      <Form.Item {...restField} name={[name, 'paramsText']}>
                        <Input placeholder="参数描述（选填）" style={{ width: 220 }} />
                      </Form.Item>
                      <Button type="link" danger onClick={() => remove(name)}>
                        删除
                      </Button>
                    </Space>
                  ))}
                  <Button type="dashed" onClick={() => add()} block>
                    添加选配项
                  </Button>
                </div>
              )}
            </Form.List>
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="截图识别产品信息"
        open={screenshotOpen}
        onCancel={closeScreenshotModal}
        footer={null}
        width={560}
        destroyOnClose
      >
        <ScreenshotCapture
          image={screenshotImage}
          onChange={handleScreenshotImageChange}
          hint="仅识别用户手动截图/拖入的产品页图片，不会自动访问任何网页；粘贴（Ctrl/Cmd+V）或将图片文件拖入下方区域即可。"
          extraActions={screenshotPriceBrowserActions}
        />
        <Space style={{ marginBottom: 12 }}>
          <Button onClick={handleRecognizeProductScreenshot} loading={screenshotRecognizing} disabled={!screenshotImage}>
            识别
          </Button>
        </Space>
      </Modal>

      <Modal
        open={batchCatModalOpen}
        title={batchCatMode === 'replace' ? '批量改分类' : '批量加标签'}
        confirmLoading={batchSubmitting}
        onOk={handleBatchCatSubmit}
        onCancel={closeBatchCatModal}
      >
        <Select
          mode="tags"
          style={{ width: '100%' }}
          value={batchCatValues}
          onChange={setBatchCatValues}
          placeholder="输入分类，回车确认"
        />
      </Modal>

      <PricePanel
        open={pricePanelOpen}
        product={pricePanelProduct}
        onClose={closePricePanel}
        onChanged={() => pricePanelProduct && refreshCost(pricePanelProduct.id)}
      />

      <Drawer
        title="类别参数模板"
        open={templateDrawerOpen}
        onClose={closeTemplateDrawer}
        width={520}
      >
        <Space style={{ marginBottom: 16 }}>
          <Button type="primary" onClick={openCreateTemplateModal}>
            新增模板
          </Button>
        </Space>
        <List
          dataSource={categoryTemplates}
          locale={{ emptyText: <Empty description="暂无类别参数模板" /> }}
          renderItem={(t) => (
            <List.Item
              actions={[
                <Button key="edit" type="link" onClick={() => openEditTemplateModal(t)}>
                  编辑
                </Button>,
                <Popconfirm
                  key="delete"
                  title="确认删除该模板？"
                  okText="确认"
                  cancelText="取消"
                  onConfirm={() => handleDeleteTemplate(t.id)}
                >
                  <Button type="link" danger loading={templateDeletingId === t.id}>
                    删除
                  </Button>
                </Popconfirm>
              ]}
            >
              <List.Item.Meta
                title={t.category}
                description={summarizeDefaults(t.defaults)}
              />
            </List.Item>
          )}
        />
      </Drawer>

      <Modal
        open={templateModalOpen}
        title={editingTemplate ? '编辑类别参数模板' : '新增类别参数模板'}
        confirmLoading={templateSubmitting}
        onOk={handleTemplateSubmit}
        onCancel={closeTemplateModal}
        destroyOnClose
      >
        <Form form={templateForm} layout="vertical">
          <Form.Item name="category" label="类别名" rules={[{ required: true, message: '请输入类别名' }]}>
            <Input placeholder="需与产品分类标签一致，如 LED屏" />
          </Form.Item>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="unit" label="单位默认值">
                <Input placeholder="台" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="power220W" label="220V 用电量（W）">
                <InputNumber min={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="power380W" label="380V 用电量（W）">
                <InputNumber min={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="rackU" label="机柜占用（U）">
                <InputNumber min={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="seqPowerPorts" label="时序电源（路）">
                <InputNumber min={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="netPorts" label="网口数">
                <InputNumber min={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="comPorts" label="com 口数">
                <InputNumber min={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="paramsCore" label="核心参数默认值">
            <Input.TextArea rows={2} placeholder="请输入核心参数默认值" />
          </Form.Item>
          <Form.Item name="paramsBid" label="招标参数默认值">
            <Input.TextArea rows={2} placeholder="请输入招标参数默认值" />
          </Form.Item>
          <Form.Item name="paramsTender" label="投标参数默认值">
            <Input.TextArea rows={2} placeholder="请输入投标参数默认值" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
