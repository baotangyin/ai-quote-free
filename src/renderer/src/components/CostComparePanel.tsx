import React, { useEffect, useRef, useState } from 'react';
import {
  Modal,
  Table,
  Button,
  Input,
  InputNumber,
  Select,
  Radio,
  Space,
  Popconfirm,
  Empty,
  Typography,
  message
} from 'antd';
import type { LineItem, LineItemCost, Supplier } from '../../../shared/api-types';
import { api } from '../api';
import { centsToYuan } from '../money';
import { costYuanToPatch } from '../cost-compare-logic';

interface CostComparePanelProps {
  open: boolean;
  lineItem: LineItem | null;
  onClose: () => void;
  /** 生效成本变化后回调，供父级刷新行成本/总价 */
  onActiveChanged: () => void;
}

export default function CostComparePanel({
  open,
  lineItem,
  onClose,
  onActiveChanged
}: CostComparePanelProps): React.JSX.Element {
  const [costs, setCosts] = useState<LineItemCost[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [creating, setCreating] = useState(false);
  const loadSeqRef = useRef(0);

  const load = async (lineItemId: number): Promise<void> => {
    const seq = ++loadSeqRef.current;
    setLoading(true);
    try {
      const [list, supplierList] = await Promise.all([
        api.itemCostsList(lineItemId),
        api.suppliersList()
      ]);
      if (seq !== loadSeqRef.current) return; // 清单行已切换，丢弃过期响应
      setCosts(list);
      setSuppliers(supplierList);
    } catch (err) {
      if (seq === loadSeqRef.current) message.error(`加载候选成本失败：${(err as Error).message}`);
    } finally {
      if (seq === loadSeqRef.current) setLoading(false);
    }
  };

  const reload = async (): Promise<void> => {
    if (lineItem) await load(lineItem.id);
  };

  useEffect(() => {
    if (open && lineItem) {
      load(lineItem.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, lineItem?.id]);

  const handleSetActive = async (costId: number): Promise<void> => {
    try {
      await api.itemCostsSetActive(costId);
      await reload();
      onActiveChanged();
      message.success('已切换生效成本');
    } catch (err) {
      message.error(`切换生效成本失败：${(err as Error).message}`);
    }
  };

  const handleUpdate = async (
    id: number,
    patch: Partial<{
      supplierId: number | null;
      supplierName: string | null;
      brand: string | null;
      model: string | null;
      costUnitCents: number;
      note: string | null;
    }>
  ): Promise<void> => {
    try {
      await api.itemCostsUpdate({ id, patch });
      await reload();
      // 生效候选被编辑时，成本单价变化需反映到父级
      onActiveChanged();
    } catch (err) {
      message.error(`保存失败：${(err as Error).message}`);
      await reload();
    }
  };

  const handleSupplierChange = (record: LineItemCost, value: number | null): void => {
    if (value == null) {
      handleUpdate(record.id, { supplierId: null, supplierName: null });
      return;
    }
    const sup = suppliers.find((s) => s.id === value);
    handleUpdate(record.id, { supplierId: value, supplierName: sup?.name ?? null });
  };

  const handleCostBlur = async (record: LineItemCost, e: React.FocusEvent<HTMLInputElement>): Promise<void> => {
    const raw = e.target.value.replace(/,/g, '').trim();
    if (raw === '') return;
    const val = Number(raw);
    if (Number.isNaN(val) || val < 0) {
      message.error('成本单价不能为负数');
      return;
    }
    const patch = costYuanToPatch(record, val);
    if (patch == null) return; // 无变化或无效
    try {
      await api.itemCostsUpdate({ id: record.id, patch });
      // 编辑的是生效候选：重新置为生效以把新成本同步回清单行快照
      if (record.isActive) await api.itemCostsSetActive(record.id);
      await reload();
      onActiveChanged();
    } catch (err) {
      message.error(`保存失败：${(err as Error).message}`);
      await reload();
    }
  };

  const handleTextBlur = (
    record: LineItemCost,
    field: 'brand' | 'model' | 'note',
    e: React.FocusEvent<HTMLInputElement>
  ): void => {
    const val = e.target.value;
    if (val === (record[field] ?? '')) return;
    handleUpdate(record.id, { [field]: val || null });
  };

  const handleDelete = async (id: number): Promise<void> => {
    try {
      await api.itemCostsDelete(id);
      await reload();
    } catch (err) {
      message.error(`删除失败：${(err as Error).message}`);
    }
  };

  const handleSeed = async (): Promise<void> => {
    if (!lineItem) return;
    setSeeding(true);
    try {
      const n = await api.itemCostsSeedFromPrices(lineItem.id);
      await reload();
      if (n > 0) message.success(`已从供应商报价生成 ${n} 条候选`);
      else message.info('无新候选生成（已有候选或无供应商报价）');
    } catch (err) {
      message.error(`生成候选失败：${(err as Error).message}`);
    } finally {
      setSeeding(false);
    }
  };

  const handleCreate = async (): Promise<void> => {
    if (!lineItem) return;
    setCreating(true);
    try {
      await api.itemCostsCreate({ lineItemId: lineItem.id, costUnitCents: 0 });
      await reload();
      message.success('已新增候选，请编辑其信息');
    } catch (err) {
      message.error(`新增候选失败：${(err as Error).message}`);
    } finally {
      setCreating(false);
    }
  };

  const columns = [
    {
      title: '生效',
      key: 'active',
      width: 60,
      render: (_: unknown, record: LineItemCost) => (
        <Radio checked={record.isActive} onChange={() => handleSetActive(record.id)} />
      )
    },
    {
      title: '供应商',
      key: 'supplier',
      width: 180,
      render: (_: unknown, record: LineItemCost) => (
        <Select
          allowClear
          placeholder="选择供应商"
          style={{ width: 160 }}
          value={record.supplierId ?? undefined}
          options={suppliers.map((s) => ({ value: s.id, label: s.name }))}
          onChange={(v) => handleSupplierChange(record, (v as number | undefined) ?? null)}
          notFoundContent={record.supplierName ?? undefined}
        />
      )
    },
    {
      title: '品牌',
      key: 'brand',
      width: 130,
      render: (_: unknown, record: LineItemCost) => (
        <Input
          key={`brand-${record.id}-${record.brand ?? ''}`}
          defaultValue={record.brand ?? ''}
          style={{ width: 110 }}
          onBlur={(e) => handleTextBlur(record, 'brand', e)}
        />
      )
    },
    {
      title: '型号',
      key: 'model',
      width: 130,
      render: (_: unknown, record: LineItemCost) => (
        <Input
          key={`model-${record.id}-${record.model ?? ''}`}
          defaultValue={record.model ?? ''}
          style={{ width: 110 }}
          onBlur={(e) => handleTextBlur(record, 'model', e)}
        />
      )
    },
    {
      title: '成本单价（元）',
      key: 'costUnit',
      width: 140,
      render: (_: unknown, record: LineItemCost) => (
        <InputNumber
          key={`cost-${record.id}-${record.costUnitCents}`}
          min={0}
          precision={2}
          defaultValue={centsToYuan(record.costUnitCents)}
          style={{ width: 120 }}
          onBlur={(e) => handleCostBlur(record, e)}
        />
      )
    },
    {
      title: '备注',
      key: 'note',
      render: (_: unknown, record: LineItemCost) => (
        <Input
          key={`note-${record.id}-${record.note ?? ''}`}
          defaultValue={record.note ?? ''}
          style={{ width: 140 }}
          onBlur={(e) => handleTextBlur(record, 'note', e)}
        />
      )
    },
    {
      title: '操作',
      key: 'action',
      width: 80,
      render: (_: unknown, record: LineItemCost) => (
        <Popconfirm
          title="确认删除该候选？"
          okText="确认"
          cancelText="取消"
          onConfirm={() => handleDelete(record.id)}
        >
          <Button type="link" danger>
            删除
          </Button>
        </Popconfirm>
      )
    }
  ];

  return (
    <Modal
      title={`多供应商比价 — ${lineItem?.snapshot.name ?? ''}`}
      open={open}
      onCancel={onClose}
      footer={null}
      width={960}
      destroyOnClose
    >
      <Space style={{ marginBottom: 16 }}>
        <Button loading={seeding} onClick={handleSeed}>
          从供应商报价生成
        </Button>
        <Button type="primary" loading={creating} onClick={handleCreate}>
          新增候选
        </Button>
      </Space>
      <Table
        rowKey="id"
        size="small"
        columns={columns}
        dataSource={costs}
        loading={loading}
        pagination={false}
        locale={{ emptyText: <Empty description="暂无候选成本，可从供应商报价生成或手动新增" /> }}
        scroll={{ x: 900 }}
      />
      <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>
        选择「生效」的候选将作为该清单行的成本单价，实时影响行合价与项目总价。
      </Typography.Paragraph>
    </Modal>
  );
}
