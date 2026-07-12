import React, { useEffect, useMemo, useState } from 'react';
import { Button, Table, Modal, Form, Input, Popconfirm, message, Space, Empty, Typography } from 'antd';
import type { Supplier } from '../../../shared/api-types';
import { api } from '../api';
import { usePersistedState } from '../useListState';
import { matchSupplierFilter, EMPTY_SUPPLIER_FILTER, type SupplierFilter } from './list-filters';
import InquiryPanel from '../components/InquiryPanel';

export default function Suppliers(): React.JSX.Element {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = usePersistedState<SupplierFilter>('aiquote.filters.suppliers', EMPTY_SUPPLIER_FILTER);
  const [pageSize, setPageSize] = usePersistedState<number>('aiquote.pageSize.suppliers', 10);
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [batchDeleting, setBatchDeleting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [inquiryPanelOpen, setInquiryPanelOpen] = useState(false);
  const [inquirySupplier, setInquirySupplier] = useState<Supplier | null>(null);
  const [form] = Form.useForm<{
    name: string;
    contact?: string;
    note?: string;
    phone?: string;
    address?: string;
    paymentTerms?: string;
    bankInfo?: string;
  }>();

  const filteredSuppliers = useMemo(
    () => suppliers.filter((s) => matchSupplierFilter(s, filter)),
    [suppliers, filter]
  );
  useEffect(() => {
    setCurrentPage(1);
  }, [filter]);
  const resetFilter = (): void => setFilter(EMPTY_SUPPLIER_FILTER);
  const clearSelection = (): void => setSelectedRowKeys([]);
  const selectedIds = useMemo(() => selectedRowKeys.map((k) => Number(k)), [selectedRowKeys]);

  const loadSuppliers = async (): Promise<void> => {
    setLoading(true);
    try {
      const list = await api.suppliersList();
      setSuppliers(list);
    } catch (err) {
      message.error(`加载供应商列表失败：${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSuppliers();
  }, []);

  const openCreateModal = (): void => {
    setEditing(null);
    form.resetFields();
    setModalOpen(true);
  };

  const openEditModal = (record: Supplier): void => {
    setEditing(record);
    form.setFieldsValue({
      name: record.name,
      contact: record.contact ?? undefined,
      note: record.note ?? undefined,
      phone: record.phone ?? undefined,
      address: record.address ?? undefined,
      paymentTerms: record.paymentTerms ?? undefined,
      bankInfo: record.bankInfo ?? undefined
    });
    setModalOpen(true);
  };

  const closeModal = (): void => {
    setModalOpen(false);
    setEditing(null);
    form.resetFields();
  };

  const handleSubmit = async (): Promise<void> => {
    let values: {
      name: string;
      contact?: string;
      note?: string;
      phone?: string;
      address?: string;
      paymentTerms?: string;
      bankInfo?: string;
    };
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
      if (editing) {
        await api.suppliersUpdate({
          id: editing.id,
          patch: {
            name: values.name,
            contact: values.contact ?? null,
            note: values.note ?? null,
            phone: values.phone ?? null,
            address: values.address ?? null,
            paymentTerms: values.paymentTerms ?? null,
            bankInfo: values.bankInfo ?? null
          }
        });
        message.success('供应商已更新');
      } else {
        await api.suppliersCreate({
          name: values.name,
          contact: values.contact,
          note: values.note,
          phone: values.phone,
          address: values.address,
          paymentTerms: values.paymentTerms,
          bankInfo: values.bankInfo
        });
        message.success('供应商已创建');
      }
      closeModal();
      await loadSuppliers();
    } catch (err) {
      message.error(`保存供应商失败：${(err as Error).message}`);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: number): Promise<void> => {
    setDeletingId(id);
    try {
      await api.suppliersDelete(id);
      message.success('供应商已删除');
      await loadSuppliers();
    } catch (err) {
      message.error(`删除供应商失败：${(err as Error).message}`);
    } finally {
      setDeletingId(null);
    }
  };

  const handleBatchDelete = async (): Promise<void> => {
    if (selectedIds.length === 0) return;
    setBatchDeleting(true);
    try {
      const n = await api.suppliersBatchDelete(selectedIds);
      message.success(`已删除 ${n} 个供应商`);
      clearSelection();
      await loadSuppliers();
    } catch (err) {
      message.error(`批量删除失败：${(err as Error).message}`);
    } finally {
      setBatchDeleting(false);
    }
  };

  const handleBatchExport = async (): Promise<void> => {
    if (selectedIds.length === 0) return;
    try {
      const dir = await api.dialogPickDir();
      if (!dir) return;
      setExporting(true);
      const filePath = await api.exportSuppliers({ ids: selectedIds, outDir: dir });
      message.success(`已导出 ${selectedIds.length} 个供应商`);
      await api.shellReveal(filePath);
    } catch (err) {
      message.error(`导出失败：${(err as Error).message}`);
    } finally {
      setExporting(false);
    }
  };

  const columns = [
    { title: '名称', dataIndex: 'name', key: 'name' },
    { title: '联系人', dataIndex: 'contact', key: 'contact', render: (v: string | null) => v ?? '-' },
    { title: '电话', dataIndex: 'phone', key: 'phone', render: (v: string | null) => v ?? '-' },
    { title: '地址', dataIndex: 'address', key: 'address', render: (v: string | null) => v ?? '-' },
    { title: '备注', dataIndex: 'note', key: 'note', render: (v: string | null) => v ?? '-' },
    {
      title: '操作',
      key: 'action',
      render: (_: unknown, record: Supplier) => (
        <Space>
          <Button type="link" onClick={() => openEditModal(record)}>
            编辑
          </Button>
          <Button
            type="link"
            onClick={() => {
              setInquirySupplier(record);
              setInquiryPanelOpen(true);
            }}
          >
            询价单
          </Button>
          <Popconfirm
            title="确认删除该供应商？"
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
        供应商
      </Typography.Title>
      <Space style={{ marginBottom: 16 }} wrap>
        <Input.Search
          allowClear
          placeholder="按名称/联系人搜索"
          style={{ width: 240 }}
          value={filter.keyword}
          onChange={(e) => setFilter({ ...filter, keyword: e.target.value })}
          onSearch={(v) => setFilter({ ...filter, keyword: v })}
        />
        <Button onClick={resetFilter}>重置筛选</Button>
        <Button type="primary" onClick={openCreateModal}>
          新增供应商
        </Button>
      </Space>
      {selectedRowKeys.length > 0 && (
        <Space style={{ marginBottom: 16 }} wrap>
          <Typography.Text strong>已选 {selectedRowKeys.length} 项</Typography.Text>
          <Button size="small" onClick={clearSelection}>
            清空选择
          </Button>
          <Button size="small" loading={exporting} onClick={handleBatchExport}>
            导出选中
          </Button>
          <Popconfirm
            title={`确认删除选中 ${selectedRowKeys.length} 个供应商？`}
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
        dataSource={filteredSuppliers}
        loading={loading}
        locale={{ emptyText: <Empty description="暂无供应商" /> }}
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
        title={editing ? '编辑供应商' : '新增供应商'}
        open={modalOpen}
        onOk={handleSubmit}
        onCancel={closeModal}
        okText="保存"
        cancelText="取消"
        confirmLoading={submitting}
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入供应商名称' }]}>
            <Input placeholder="请输入供应商名称" />
          </Form.Item>
          <Form.Item name="contact" label="联系人">
            <Input placeholder="请输入联系人" />
          </Form.Item>
          <Form.Item name="phone" label="电话">
            <Input placeholder="请输入电话" />
          </Form.Item>
          <Form.Item name="address" label="地址">
            <Input placeholder="请输入地址" />
          </Form.Item>
          <Form.Item name="paymentTerms" label="付款方式">
            <Input placeholder="请输入付款方式" />
          </Form.Item>
          <Form.Item name="bankInfo" label="开户信息">
            <Input.TextArea placeholder="请输入开户信息（开户行/账号等）" rows={2} />
          </Form.Item>
          <Form.Item name="note" label="备注">
            <Input.TextArea placeholder="请输入备注" rows={3} />
          </Form.Item>
        </Form>
      </Modal>
      <InquiryPanel
        open={inquiryPanelOpen}
        supplier={inquirySupplier}
        onClose={() => {
          setInquiryPanelOpen(false);
          setInquirySupplier(null);
        }}
      />
    </div>
  );
}
