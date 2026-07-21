import React, { useEffect, useRef, useState } from 'react';
import {
  Button,
  Card,
  Table,
  Modal,
  Form,
  Input,
  InputNumber,
  Select,
  Segmented,
  Popconfirm,
  message,
  Space,
  Empty,
  Spin,
  Typography
} from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, ExportOutlined } from '@ant-design/icons';
import { PANEL_STYLE } from '../theme';
import type {
  AssembledEstimate,
  AssembledEstimateRow,
  EstimateCategory,
  EstimateRow,
  EstimateValueMethod,
  Section
} from '../../../shared/api-types';
import { api } from '../api';
import { yuanToCents, centsToYuan, fmtByUnit } from '../money';

type DisplayUnit = '元' | '万元';

const VALUE_METHOD_OPTIONS: { value: EstimateValueMethod; label: string }[] = [
  { value: 'manual', label: '手工填报' },
  { value: 'coefficient', label: '按系数估算' },
  { value: 'sectionRef', label: '引用板块合价' }
];

interface EstimateEditorProps {
  projectId: number;
  projectName: string;
}

export default function EstimateEditor({ projectId, projectName }: EstimateEditorProps): React.JSX.Element {
  const [assembled, setAssembled] = useState<AssembledEstimate | null>(null);
  const [sections, setSections] = useState<Section[]>([]);
  const [loading, setLoading] = useState(false);
  const [unit, setUnit] = useState<DisplayUnit>('万元');
  const [seeding, setSeeding] = useState(false);
  const [exporting, setExporting] = useState(false);

  const [catModalOpen, setCatModalOpen] = useState(false);
  const [editingCat, setEditingCat] = useState<EstimateCategory | null>(null);
  const [catSubmitting, setCatSubmitting] = useState(false);
  const [catForm] = Form.useForm<{ name: string }>();

  const seqRef = useRef(0);

  const reloadAssemble = async (): Promise<void> => {
    const seq = ++seqRef.current;
    try {
      const a = await api.estimateAssemble(projectId);
      if (seq !== seqRef.current) return;
      setAssembled(a);
    } catch (err) {
      if (seq === seqRef.current) message.error(`加载概算失败：${(err as Error).message}`);
    }
  };

  const loadAll = async (): Promise<void> => {
    const seq = ++seqRef.current;
    setLoading(true);
    try {
      const [a, secs] = await Promise.all([api.estimateAssemble(projectId), api.sectionsList(projectId)]);
      if (seq !== seqRef.current) return;
      setAssembled(a);
      setSections(secs);
    } catch (err) {
      if (seq === seqRef.current) message.error(`加载概算失败：${(err as Error).message}`);
    } finally {
      if (seq === seqRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    if (!projectId || Number.isNaN(projectId)) return;
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // ---------- 大类 ----------

  const openCatCreate = (): void => {
    setEditingCat(null);
    catForm.resetFields();
    setCatModalOpen(true);
  };

  const openCatEdit = (cat: EstimateCategory): void => {
    setEditingCat(cat);
    catForm.setFieldsValue({ name: cat.name });
    setCatModalOpen(true);
  };

  const closeCatModal = (): void => {
    setCatModalOpen(false);
    setEditingCat(null);
    catForm.resetFields();
  };

  const handleCatSubmit = async (): Promise<void> => {
    let values: { name: string };
    try {
      values = await catForm.validateFields();
    } catch (err) {
      if ((err as { errorFields?: unknown }).errorFields) return;
      throw err;
    }
    setCatSubmitting(true);
    try {
      if (editingCat) {
        await api.estimateCategoriesUpdate({ id: editingCat.id, patch: { name: values.name } });
        message.success('大类已更新');
      } else {
        await api.estimateCategoriesCreate({ projectId, name: values.name });
        message.success('大类已创建');
      }
      closeCatModal();
      await reloadAssemble();
    } catch (err) {
      message.error(`保存大类失败：${(err as Error).message}`);
    } finally {
      setCatSubmitting(false);
    }
  };

  const handleDeleteCat = async (categoryId: number): Promise<void> => {
    try {
      await api.estimateCategoriesDelete(categoryId);
      message.success('大类已删除');
      await reloadAssemble();
    } catch (err) {
      message.error(`删除大类失败：${(err as Error).message}`);
    }
  };

  // ---------- 子项 ----------

  const handleAddRow = async (categoryId: number): Promise<void> => {
    try {
      await api.estimateRowsCreate({ categoryId, name: '新子项', valueMethod: 'manual' });
      await reloadAssemble();
    } catch (err) {
      message.error(`新增子项失败：${(err as Error).message}`);
    }
  };

  const updateRow = async (
    id: number,
    patch: Partial<{
      name: string;
      valueMethod: EstimateValueMethod;
      manualAmountCents: number | null;
      coefBaseCents: number | null;
      coefFactor: number | null;
      refSectionId: number | null;
      remark: string | null;
    }>
  ): Promise<void> => {
    try {
      await api.estimateRowsUpdate({ id, patch });
      await reloadAssemble();
    } catch (err) {
      message.error(`保存失败：${(err as Error).message}`);
    }
  };

  const handleDeleteRow = async (id: number): Promise<void> => {
    try {
      await api.estimateRowsDelete(id);
      await reloadAssemble();
    } catch (err) {
      message.error(`删除子项失败：${(err as Error).message}`);
    }
  };

  const handleNameBlur = (r: EstimateRow, e: React.FocusEvent<HTMLInputElement>): void => {
    const val = e.target.value.trim();
    if (val === '' || val === r.name) return;
    updateRow(r.id, { name: val });
  };

  const handleRemarkBlur = (r: EstimateRow, e: React.FocusEvent<HTMLInputElement>): void => {
    const val = e.target.value;
    if (val === (r.remark ?? '')) return;
    updateRow(r.id, { remark: val || null });
  };

  const handleMethodChange = (r: EstimateRow, method: EstimateValueMethod): void => {
    if (method === r.valueMethod) return;
    updateRow(r.id, { valueMethod: method });
  };

  const handleManualBlur = (r: EstimateRow, e: React.FocusEvent<HTMLInputElement>): void => {
    const raw = e.target.value.replace(/,/g, '').trim();
    if (raw === '') {
      if (r.manualAmountCents != null) updateRow(r.id, { manualAmountCents: null });
      return;
    }
    const v = Number(raw);
    if (Number.isNaN(v) || v < 0) {
      message.error('金额不能为负数');
      return;
    }
    const cents = yuanToCents(v);
    if (cents === (r.manualAmountCents ?? null)) return;
    updateRow(r.id, { manualAmountCents: cents });
  };

  const handleBaseBlur = (r: EstimateRow, e: React.FocusEvent<HTMLInputElement>): void => {
    const raw = e.target.value.replace(/,/g, '').trim();
    if (raw === '') {
      if (r.coefBaseCents != null) updateRow(r.id, { coefBaseCents: null });
      return;
    }
    const v = Number(raw);
    if (Number.isNaN(v) || v < 0) {
      message.error('基数不能为负数');
      return;
    }
    const cents = yuanToCents(v);
    if (cents === (r.coefBaseCents ?? null)) return;
    updateRow(r.id, { coefBaseCents: cents });
  };

  const handleFactorBlur = (r: EstimateRow, e: React.FocusEvent<HTMLInputElement>): void => {
    const raw = e.target.value.replace(/,/g, '').trim();
    if (raw === '') {
      if (r.coefFactor != null) updateRow(r.id, { coefFactor: null });
      return;
    }
    const v = Number(raw);
    if (Number.isNaN(v) || v < 0) {
      message.error('系数不能为负数');
      return;
    }
    if (v === (r.coefFactor ?? null)) return;
    updateRow(r.id, { coefFactor: v });
  };

  const renderParams = (ar: AssembledEstimateRow): React.ReactNode => {
    const r = ar.row;
    if (r.valueMethod === 'manual') {
      return (
        <InputNumber
          key={`manual-${r.id}-${r.manualAmountCents ?? ''}`}
          min={0}
          precision={2}
          defaultValue={r.manualAmountCents != null ? centsToYuan(r.manualAmountCents) : undefined}
          addonAfter="元"
          style={{ width: 180 }}
          onBlur={(e) => handleManualBlur(r, e)}
        />
      );
    }
    if (r.valueMethod === 'coefficient') {
      return (
        <Space>
          <InputNumber
            key={`base-${r.id}-${r.coefBaseCents ?? ''}`}
            min={0}
            precision={2}
            defaultValue={r.coefBaseCents != null ? centsToYuan(r.coefBaseCents) : undefined}
            addonBefore="基数"
            addonAfter="元"
            style={{ width: 200 }}
            onBlur={(e) => handleBaseBlur(r, e)}
          />
          <InputNumber
            key={`factor-${r.id}-${r.coefFactor ?? ''}`}
            min={0}
            precision={4}
            defaultValue={r.coefFactor ?? undefined}
            addonBefore="系数"
            style={{ width: 160 }}
            onBlur={(e) => handleFactorBlur(r, e)}
          />
        </Space>
      );
    }
    // sectionRef
    return (
      <Select<number>
        key={`ref-${r.id}-${r.refSectionId ?? ''}`}
        value={r.refSectionId ?? undefined}
        placeholder="选择板块"
        style={{ width: 200 }}
        options={sections.map((s) => ({ value: s.id, label: s.name }))}
        onChange={(v) => updateRow(r.id, { refSectionId: v })}
        notFoundContent={<Empty description="暂无板块" image={Empty.PRESENTED_IMAGE_SIMPLE} />}
      />
    );
  };

  const rowColumns = [
    {
      title: '序号',
      key: 'idx',
      width: 56,
      render: (_: unknown, __: AssembledEstimateRow, idx: number) => idx + 1
    },
    {
      title: '名称',
      key: 'name',
      ellipsis: true,
      render: (_: unknown, ar: AssembledEstimateRow) => (
        <Input
          key={`name-${ar.row.id}-${ar.row.name}`}
          defaultValue={ar.row.name}
          style={{ width: 160 }}
          onBlur={(e) => handleNameBlur(ar.row, e)}
        />
      )
    },
    {
      title: '取值方式',
      key: 'method',
      render: (_: unknown, ar: AssembledEstimateRow) => (
        <Select<EstimateValueMethod>
          value={ar.row.valueMethod}
          style={{ width: 130 }}
          options={VALUE_METHOD_OPTIONS}
          onChange={(v) => handleMethodChange(ar.row, v)}
        />
      )
    },
    {
      title: '参数',
      key: 'params',
      render: (_: unknown, ar: AssembledEstimateRow) => renderParams(ar)
    },
    {
      title: '金额',
      key: 'amount',
      render: (_: unknown, ar: AssembledEstimateRow) => (
        <Typography.Text strong>{fmtByUnit(ar.amountCents, unit)}</Typography.Text>
      )
    },
    {
      title: '备注',
      key: 'remark',
      ellipsis: true,
      render: (_: unknown, ar: AssembledEstimateRow) => (
        <Input
          key={`remark-${ar.row.id}-${ar.row.remark ?? ''}`}
          defaultValue={ar.row.remark ?? ''}
          style={{ width: 140 }}
          onBlur={(e) => handleRemarkBlur(ar.row, e)}
        />
      )
    },
    {
      title: '操作',
      key: 'action',
      width: 80,
      render: (_: unknown, ar: AssembledEstimateRow) => (
        <Popconfirm
          title="确认删除该子项？"
          okText="确认"
          cancelText="取消"
          onConfirm={() => handleDeleteRow(ar.row.id)}
        >
          <Button type="link" danger>
            删除
          </Button>
        </Popconfirm>
      )
    }
  ];

  // ---------- 载入默认结构 ----------

  const handleSeed = async (): Promise<void> => {
    setSeeding(true);
    try {
      await api.estimateSeed(projectId);
      message.success('已载入默认结构');
      await reloadAssemble();
    } catch (err) {
      message.error(`载入默认结构失败：${(err as Error).message}`);
    } finally {
      setSeeding(false);
    }
  };

  // ---------- 导出 ----------

  const handleExport = async (): Promise<void> => {
    try {
      const dir = await api.dialogPickDir();
      if (!dir) return;
      setExporting(true);
      const files = await api.exportRun({ projectId, outDir: dir });
      message.success(`导出成功，生成 ${files.length} 个文件`);
      if (files[0]) await api.shellReveal(files[0]);
    } catch (err) {
      message.error(`导出失败：${(err as Error).message}`);
    } finally {
      setExporting(false);
    }
  };

  const hasCategories = (assembled?.categories.length ?? 0) > 0;

  return (
    <div>
      <div style={{ ...PANEL_STYLE, marginBottom: 16 }}>
        <Space size="large" wrap style={{ width: '100%', justifyContent: 'space-between' }}>
          <Space size="large" wrap>
            <Typography.Title level={4} style={{ margin: 0 }}>
              总投资估算：
              <Typography.Text strong type="danger">
                {assembled ? fmtByUnit(assembled.grandTotalCents, unit) : '-'}
              </Typography.Text>
            </Typography.Title>
            <Space>
              <Typography.Text>金额单位：</Typography.Text>
              <Segmented
                value={unit}
                options={['万元', '元']}
                onChange={(v) => setUnit(v as DisplayUnit)}
              />
            </Space>
          </Space>
          <Space>
            {!hasCategories && (
              <Button loading={seeding} onClick={handleSeed}>
                载入默认结构
              </Button>
            )}
            <Button icon={<PlusOutlined />} onClick={openCatCreate}>
              新增大类
            </Button>
            <Button type="primary" icon={<ExportOutlined />} loading={exporting} onClick={handleExport}>
              导出估算表
            </Button>
          </Space>
        </Space>
      </div>

      <Spin spinning={loading}>
        {!hasCategories ? (
          <div style={{ ...PANEL_STYLE, padding: 24 }}>
            <Empty description={`「${projectName}」暂无概算结构`}>
              <Button type="primary" loading={seeding} onClick={handleSeed}>
                载入默认结构
              </Button>
            </Empty>
          </div>
        ) : (
          assembled?.categories.map((cat) => (
            <Card
              key={cat.category.id}
              style={{ marginBottom: 16 }}
              title={
                <Space>
                  <Typography.Text strong>{cat.category.name}</Typography.Text>
                  <Typography.Text type="secondary">小计：{fmtByUnit(cat.subtotalCents, unit)}</Typography.Text>
                </Space>
              }
              extra={
                <Space>
                  <Button size="small" icon={<PlusOutlined />} onClick={() => handleAddRow(cat.category.id)}>
                    新增子项
                  </Button>
                  <Button size="small" icon={<EditOutlined />} onClick={() => openCatEdit(cat.category)}>
                    改名
                  </Button>
                  <Popconfirm
                    title="确认删除该大类？（含其下所有子项）"
                    okText="确认"
                    cancelText="取消"
                    onConfirm={() => handleDeleteCat(cat.category.id)}
                  >
                    <Button size="small" danger icon={<DeleteOutlined />}>
                      删除大类
                    </Button>
                  </Popconfirm>
                </Space>
              }
            >
              <Table
                rowKey={(ar) => ar.row.id}
                columns={rowColumns}
                dataSource={cat.rows}
                pagination={false}
                size="small"
                locale={{ emptyText: <Empty description="暂无子项" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
                scroll={{ y: 400 }}
              />
            </Card>
          ))
        )}
      </Spin>

      <Modal
        title={editingCat ? '重命名大类' : '新增大类'}
        open={catModalOpen}
        onOk={handleCatSubmit}
        onCancel={closeCatModal}
        okText="保存"
        cancelText="取消"
        confirmLoading={catSubmitting}
        destroyOnClose
      >
        <Form form={catForm} layout="vertical">
          <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入大类名称' }]}>
            <Input placeholder="请输入大类名称" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
