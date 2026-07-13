import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Button,
  Table,
  Modal,
  Form,
  Input,
  InputNumber,
  Select,
  Popconfirm,
  message,
  Space,
  Empty,
  Tag,
  Typography
} from 'antd';
import dayjs from 'dayjs';
import { useNavigate } from 'react-router-dom';
import type { Project, QuoteMode, RoundRule } from '../../../shared/api-types';
import { api } from '../api';
import { MODE_LABELS } from '../labels';
import { usePersistedState } from '../useListState';
import { matchProjectFilter, EMPTY_PROJECTS_FILTER, type ProjectsFilter } from '../projectsFilter';

// 报价模式色（保留语义，主题统一预设取值后与主色区分度足够，见 UI 设计规范 §4.10）
const MODE_COLORS: Record<QuoteMode, string> = {
  estimate: 'default',
  budget: 'blue',
  pricing: 'green',
  tender: 'purple'
};

const STATUS_LABELS: Record<Project['status'], string> = {
  draft: '草稿',
  done: '已完成'
};

const STATUS_OPTIONS: { value: Project['status']; label: string }[] = [
  { value: 'draft', label: STATUS_LABELS.draft },
  { value: 'done', label: STATUS_LABELS.done }
];

const ROUND_RULE_OPTIONS: { value: RoundRule; label: string }[] = [
  { value: 'cent', label: '分' },
  { value: 'yuan', label: '元' },
  { value: 'ten', label: '十元' }
];

const MODE_OPTIONS: { value: QuoteMode; label: string }[] = (
  ['budget', 'pricing', 'tender', 'estimate'] as QuoteMode[]
).map((m) => ({
  value: m,
  label: MODE_LABELS[m]
}));

interface ProjectFormValues {
  name: string;
  client?: string;
  mode: QuoteMode;
  defaultMargin: number;
  roundRule: RoundRule;
  projectType?: string;
}

export default function Projects(): React.JSX.Element {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = usePersistedState<ProjectsFilter>('aiquote.filters.projects', EMPTY_PROJECTS_FILTER);
  const [pageSize, setPageSize] = usePersistedState<number>('aiquote.pageSize.projects', 10);
  const [currentPage, setCurrentPage] = useState(1);
  const [modalOpen, setModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [openingModal, setOpeningModal] = useState(false);
  // 多选批量
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [batchDeleting, setBatchDeleting] = useState(false);
  const [batchStatusLoading, setBatchStatusLoading] = useState(false);
  const [batchDuplicating, setBatchDuplicating] = useState(false);
  const [form] = Form.useForm<ProjectFormValues>();
  const projectsSeqRef = useRef(0);
  const [typeOptions, setTypeOptions] = useState<{ value: string; label: string }[]>([]);

  const loadProjects = async (): Promise<void> => {
    const seq = ++projectsSeqRef.current;
    setLoading(true);
    try {
      const list = await api.projectsList();
      if (seq !== projectsSeqRef.current) return; // 丢弃过期响应
      setProjects(list);
    } catch (err) {
      if (seq === projectsSeqRef.current) message.error(`加载项目列表失败：${(err as Error).message}`);
    } finally {
      if (seq === projectsSeqRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    loadProjects();
  }, []);

  const filteredProjects = useMemo(
    () => projects.filter((p) => matchProjectFilter(p, filter)),
    [projects, filter]
  );

  useEffect(() => {
    setCurrentPage(1);
  }, [filter]);

  const resetFilter = (): void => setFilter(EMPTY_PROJECTS_FILTER);
  const clearSelection = (): void => setSelectedRowKeys([]);
  const selectedIds = useMemo(() => selectedRowKeys.map((k) => Number(k)), [selectedRowKeys]);

  const openCreateModal = async (): Promise<void> => {
    setOpeningModal(true);
    form.resetFields();
    let defaultMargin = 1.3;
    try {
      const stored = await api.settingsGet('defaultMargin');
      if (stored) {
        const parsed = parseFloat(stored);
        if (!isNaN(parsed)) {
          defaultMargin = parsed;
        }
      }
      const tpls = await api.templatesList();
      setTypeOptions(tpls.map((t) => ({ value: t.projectType, label: t.projectType })));
    } catch (err) {
      message.error(`读取默认配置失败：${(err as Error).message}`);
    } finally {
      setOpeningModal(false);
    }
    form.setFieldsValue({ defaultMargin, roundRule: 'yuan', mode: 'budget' });
    setModalOpen(true);
  };

  const closeModal = (): void => {
    setModalOpen(false);
    form.resetFields();
  };

  const handleSubmit = async (): Promise<void> => {
    let values: ProjectFormValues;
    try {
      values = await form.validateFields();
    } catch (err) {
      if ((err as { errorFields?: unknown }).errorFields) {
        // 表单校验失败，无需额外提示
        return;
      }
      throw err;
    }
    setSubmitting(true);
    try {
      await api.projectsCreate({
        name: values.name,
        client: values.client,
        mode: values.mode,
        defaultMargin: values.defaultMargin,
        roundRule: values.roundRule,
        projectType: values.projectType ?? null
      });
      message.success(values.projectType ? '项目已创建，已按类型模板生成板块与空间' : '项目已创建');
      closeModal();
      await loadProjects();
    } catch (err) {
      message.error(`创建项目失败：${(err as Error).message}`);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: number): Promise<void> => {
    setDeletingId(id);
    try {
      await api.projectsDelete(id);
      message.success('项目已删除');
      await loadProjects();
    } catch (err) {
      message.error(`删除项目失败：${(err as Error).message}`);
    } finally {
      setDeletingId(null);
    }
  };

  const handleBatchSetStatus = async (status: Project['status']): Promise<void> => {
    if (selectedIds.length === 0) return;
    setBatchStatusLoading(true);
    try {
      const n = await api.projectsBatchSetStatus({ ids: selectedIds, status });
      message.success(status === 'done' ? `已标记 ${n} 个项目为已完成` : `已标记 ${n} 个项目为草稿`);
      clearSelection();
      await loadProjects();
    } catch (err) {
      message.error(`批量改状态失败：${(err as Error).message}`);
    } finally {
      setBatchStatusLoading(false);
    }
  };

  const handleBatchDuplicate = async (): Promise<void> => {
    if (selectedIds.length === 0) return;
    setBatchDuplicating(true);
    try {
      let n = 0;
      for (const id of selectedIds) {
        await api.projectsDuplicate(id);
        n += 1;
      }
      message.success(`已复制 ${n} 个项目`);
      clearSelection();
      await loadProjects();
    } catch (err) {
      message.error(`批量复制失败：${(err as Error).message}`);
    } finally {
      setBatchDuplicating(false);
    }
  };

  const handleBatchDelete = async (): Promise<void> => {
    if (selectedIds.length === 0) return;
    setBatchDeleting(true);
    try {
      const n = await api.projectsBatchDelete(selectedIds);
      message.success(`已删除 ${n} 个项目`);
      clearSelection();
      await loadProjects();
    } catch (err) {
      message.error(`批量删除失败：${(err as Error).message}`);
    } finally {
      setBatchDeleting(false);
    }
  };

  const columns = [
    { title: '名称', dataIndex: 'name', key: 'name' },
    { title: '客户', dataIndex: 'client', key: 'client', render: (v: string | null) => v ?? '-' },
    {
      title: '模式',
      dataIndex: 'mode',
      key: 'mode',
      render: (v: QuoteMode) => <Tag color={MODE_COLORS[v]}>{MODE_LABELS[v]}</Tag>
    },
    {
      title: '默认倍率',
      dataIndex: 'defaultMargin',
      key: 'defaultMargin',
      render: (v: number) => v.toFixed(2)
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (v: Project['status']) => <Tag>{STATUS_LABELS[v]}</Tag>
    },
    {
      title: '更新时间',
      dataIndex: 'updatedAt',
      key: 'updatedAt',
      render: (v: string) => dayjs(v).format('YYYY-MM-DD HH:mm')
    },
    {
      title: '操作',
      key: 'action',
      render: (_: unknown, record: Project) => (
        <Space>
          <Button type="link" onClick={() => navigate(`/projects/${record.id}`)}>
            打开
          </Button>
          <Popconfirm
            title="确认删除该项目？"
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
        项目
      </Typography.Title>
      <Space style={{ marginBottom: 16 }} wrap>
        <Select
          allowClear
          mode="multiple"
          placeholder="按报价模式筛选（命中任一）"
          style={{ minWidth: 220 }}
          maxTagCount="responsive"
          options={MODE_OPTIONS}
          value={filter.modes}
          onChange={(v) => setFilter({ ...filter, modes: v })}
        />
        <Select
          allowClear
          mode="multiple"
          placeholder="按状态筛选"
          style={{ minWidth: 160 }}
          maxTagCount="responsive"
          options={STATUS_OPTIONS}
          value={filter.statuses}
          onChange={(v) => setFilter({ ...filter, statuses: v })}
        />
        <Input.Search
          allowClear
          placeholder="按项目名/客户搜索"
          style={{ width: 240 }}
          value={filter.keyword}
          onChange={(e) => setFilter({ ...filter, keyword: e.target.value })}
          onSearch={(v) => setFilter({ ...filter, keyword: v })}
        />
        <Button onClick={resetFilter}>重置筛选</Button>
        <Button type="primary" onClick={openCreateModal} loading={openingModal}>
          新建项目
        </Button>
      </Space>
      {selectedRowKeys.length > 0 && (
        <Space style={{ marginBottom: 16 }} wrap>
          <Typography.Text strong>已选 {selectedRowKeys.length} 项</Typography.Text>
          <Button size="small" onClick={clearSelection}>
            清空选择
          </Button>
          <Button size="small" loading={batchStatusLoading} onClick={() => handleBatchSetStatus('done')}>
            批量标记完成
          </Button>
          <Button size="small" loading={batchStatusLoading} onClick={() => handleBatchSetStatus('draft')}>
            批量标记草稿
          </Button>
          <Button size="small" loading={batchDuplicating} onClick={handleBatchDuplicate}>
            批量复制
          </Button>
          <Popconfirm
            title={`确认删除选中 ${selectedRowKeys.length} 个项目？（含其下全部板块/清单）`}
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
        dataSource={filteredProjects}
        loading={loading}
        locale={{ emptyText: <Empty description="暂无项目" /> }}
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
        title="新建项目"
        open={modalOpen}
        onOk={handleSubmit}
        onCancel={closeModal}
        okText="保存"
        cancelText="取消"
        confirmLoading={submitting}
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入项目名称' }]}>
            <Input placeholder="请输入项目名称" />
          </Form.Item>
          <Form.Item name="client" label="客户">
            <Input placeholder="请输入客户名称" />
          </Form.Item>
          <Form.Item name="projectType" label="项目类型" extra="选择类型将按模板自动生成板块与空间骨架，可留空">
            <Select allowClear placeholder="不选择则不生成骨架" options={typeOptions} />
          </Form.Item>
          <Form.Item name="mode" label="报价模式" rules={[{ required: true, message: '请选择报价模式' }]}>
            <Select options={MODE_OPTIONS} />
          </Form.Item>
          <Form.Item name="defaultMargin" label="默认倍率" rules={[{ required: true, message: '请输入默认倍率' }]}>
            <InputNumber min={0} precision={2} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="roundRule" label="取整规则" rules={[{ required: true, message: '请选择取整规则' }]}>
            <Select options={ROUND_RULE_OPTIONS} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
