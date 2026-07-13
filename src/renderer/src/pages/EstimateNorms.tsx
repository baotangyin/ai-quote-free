import React, { useEffect, useMemo, useState } from 'react';
import { Button, Table, Modal, Form, Input, InputNumber, Popconfirm, message, Space, Empty, Typography } from 'antd';
import type { EstimateNorm } from '../../../shared/api-types';
import { api } from '../api';
import { yuanToCents, centsToYuan, fmtYuan } from '../money';
import { usePersistedState } from '../useListState';
import { matchEstimateNormFilter, EMPTY_ESTIMATE_NORM_FILTER, type EstimateNormFilter } from './list-filters';

interface NormFormValues {
  projectType?: string;
  spaceType?: string;
  unitPriceLowYuan?: number;
  unitPriceHighYuan?: number;
  note?: string;
}

export default function EstimateNorms(): React.JSX.Element {
  const [norms, setNorms] = useState<EstimateNorm[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = usePersistedState<EstimateNormFilter>(
    'aiquote.filters.estimateNorms',
    EMPTY_ESTIMATE_NORM_FILTER
  );
  const [pageSize, setPageSize] = usePersistedState<number>('aiquote.pageSize.estimateNorms', 10);
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [batchDeleting, setBatchDeleting] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<EstimateNorm | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [form] = Form.useForm<NormFormValues>();

  const filteredNorms = useMemo(
    () => norms.filter((n) => matchEstimateNormFilter(n, filter)),
    [norms, filter]
  );

  useEffect(() => {
    setCurrentPage(1);
  }, [filter]);
  const resetFilter = (): void => setFilter(EMPTY_ESTIMATE_NORM_FILTER);
  const clearSelection = (): void => setSelectedRowKeys([]);
  const selectedIds = useMemo(() => selectedRowKeys.map((k) => Number(k)), [selectedRowKeys]);

  const loadNorms = async (): Promise<void> => {
    setLoading(true);
    try {
      const list = await api.estimateNormsList();
      setNorms(list);
    } catch (err) {
      message.error(`加载概算指标失败：${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadNorms();
  }, []);

  const openCreateModal = (): void => {
    setEditing(null);
    form.resetFields();
    setModalOpen(true);
  };

  const openEditModal = (record: EstimateNorm): void => {
    setEditing(record);
    form.setFieldsValue({
      projectType: record.projectType ?? undefined,
      spaceType: record.spaceType ?? undefined,
      unitPriceLowYuan: record.unitPriceLowCents != null ? centsToYuan(record.unitPriceLowCents) : undefined,
      unitPriceHighYuan: record.unitPriceHighCents != null ? centsToYuan(record.unitPriceHighCents) : undefined,
      note: record.note ?? undefined
    });
    setModalOpen(true);
  };

  const closeModal = (): void => {
    setModalOpen(false);
    setEditing(null);
    form.resetFields();
  };

  const handleSubmit = async (): Promise<void> => {
    let values: NormFormValues;
    try {
      values = await form.validateFields();
    } catch (err) {
      if ((err as { errorFields?: unknown }).errorFields) return;
      throw err;
    }
    const lowCents = values.unitPriceLowYuan != null ? yuanToCents(values.unitPriceLowYuan) : null;
    const highCents = values.unitPriceHighYuan != null ? yuanToCents(values.unitPriceHighYuan) : null;
    setSubmitting(true);
    try {
      if (editing) {
        await api.estimateNormsUpdate({
          id: editing.id,
          patch: {
            projectType: values.projectType || null,
            spaceType: values.spaceType || null,
            unitPriceLowCents: lowCents,
            unitPriceHighCents: highCents,
            note: values.note || null
          }
        });
        message.success('概算指标已更新');
      } else {
        await api.estimateNormsCreate({
          projectType: values.projectType || null,
          spaceType: values.spaceType || null,
          unitPriceLowCents: lowCents,
          unitPriceHighCents: highCents,
          note: values.note || null
        });
        message.success('概算指标已创建');
      }
      closeModal();
      await loadNorms();
    } catch (err) {
      message.error(`保存概算指标失败：${(err as Error).message}`);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: number): Promise<void> => {
    setDeletingId(id);
    try {
      await api.estimateNormsDelete(id);
      message.success('概算指标已删除');
      await loadNorms();
    } catch (err) {
      message.error(`删除概算指标失败：${(err as Error).message}`);
    } finally {
      setDeletingId(null);
    }
  };

  const handleBatchDelete = async (): Promise<void> => {
    if (selectedIds.length === 0) return;
    setBatchDeleting(true);
    try {
      const n = await api.estimateNormsBatchDelete(selectedIds);
      message.success(`已删除 ${n} 个概算指标`);
      clearSelection();
      await loadNorms();
    } catch (err) {
      message.error(`批量删除失败：${(err as Error).message}`);
    } finally {
      setBatchDeleting(false);
    }
  };

  const columns = [
    { title: '项目类型', dataIndex: 'projectType', key: 'projectType', render: (v: string | null) => v ?? '-' },
    { title: '空间类型', dataIndex: 'spaceType', key: 'spaceType', render: (v: string | null) => v ?? '-' },
    {
      title: '单价下限（元）',
      dataIndex: 'unitPriceLowCents',
      key: 'unitPriceLowCents',
      render: (v: number | null) => (v != null ? fmtYuan(v) : '-')
    },
    {
      title: '单价上限（元）',
      dataIndex: 'unitPriceHighCents',
      key: 'unitPriceHighCents',
      render: (v: number | null) => (v != null ? fmtYuan(v) : '-')
    },
    { title: '备注', dataIndex: 'note', key: 'note', render: (v: string | null) => v ?? '-' },
    {
      title: '操作',
      key: 'action',
      render: (_: unknown, record: EstimateNorm) => (
        <Space>
          <Button type="link" onClick={() => openEditModal(record)}>
            编辑
          </Button>
          <Popconfirm
            title="确认删除该概算指标？"
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
        概算指标
      </Typography.Title>
      <Space style={{ marginBottom: 16 }} wrap>
        <Input.Search
          allowClear
          placeholder="按项目类型/空间类型/备注搜索"
          style={{ width: 280 }}
          value={filter.keyword}
          onChange={(e) => setFilter({ ...filter, keyword: e.target.value })}
          onSearch={(v) => setFilter({ ...filter, keyword: v })}
        />
        <Button onClick={resetFilter}>重置筛选</Button>
        <Button type="primary" onClick={openCreateModal}>
          新增指标
        </Button>
      </Space>
      {selectedRowKeys.length > 0 && (
        <Space style={{ marginBottom: 16 }} wrap>
          <Typography.Text strong>已选 {selectedRowKeys.length} 项</Typography.Text>
          <Button size="small" onClick={clearSelection}>
            清空选择
          </Button>
          <Popconfirm
            title={`确认删除选中 ${selectedRowKeys.length} 个概算指标？`}
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
        dataSource={filteredNorms}
        loading={loading}
        locale={{ emptyText: <Empty description="暂无概算指标" /> }}
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
        title={editing ? '编辑概算指标' : '新增概算指标'}
        open={modalOpen}
        onOk={handleSubmit}
        onCancel={closeModal}
        okText="保存"
        cancelText="取消"
        confirmLoading={submitting}
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          <Form.Item name="projectType" label="项目类型">
            <Input placeholder="如：智能化、弱电、机房" />
          </Form.Item>
          <Form.Item name="spaceType" label="空间类型">
            <Input placeholder="如：会议室、办公区" />
          </Form.Item>
          <Form.Item name="unitPriceLowYuan" label="单价下限（元）">
            <InputNumber min={0} precision={2} style={{ width: '100%' }} placeholder="可留空" />
          </Form.Item>
          <Form.Item name="unitPriceHighYuan" label="单价上限（元）">
            <InputNumber min={0} precision={2} style={{ width: '100%' }} placeholder="可留空" />
          </Form.Item>
          <Form.Item name="note" label="备注">
            <Input.TextArea rows={3} placeholder="请输入备注" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
