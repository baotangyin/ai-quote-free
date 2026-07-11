import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Button,
  Table,
  Modal,
  Form,
  Input,
  Select,
  AutoComplete,
  Switch,
  Popconfirm,
  Popover,
  message,
  Space,
  Empty,
  Typography,
  Divider,
  Card
} from 'antd';
import { PlusOutlined, DeleteOutlined, QuestionCircleOutlined } from '@ant-design/icons';
import type { BomRule, RuleAction, RuleTriggerType, Product } from '../../../shared/api-types';
import { api } from '../api';
import { triggerLabel, TRIGGER_TYPE_LABELS } from '../rules-logic';
import { usePersistedState } from '../useListState';
import { matchRuleFilter, EMPTY_RULE_FILTER, type RuleFilter } from './list-filters';

const TRIGGER_TYPE_OPTIONS: { value: RuleTriggerType; label: string }[] = (
  ['category', 'product', 'projectType'] as RuleTriggerType[]
).map((t) => ({ value: t, label: TRIGGER_TYPE_LABELS[t] }));

/** 行级变量说明（与 core/domain/rules-engine.ts buildTriggerContext 保持一致）。 */
const ROW_VARS: { name: string; desc: string }[] = [
  { name: 'qty', desc: '触发清单行的数量' },
  { name: 'area', desc: '屏体/展项面积：该行单位为「㎡」时=数量，否则取所属空间面积，无则 0（㎡）' },
  { name: 'power220', desc: '该行 220V 总用电量（单台×数量，W）' },
  { name: 'power380', desc: '该行 380V 总用电量（W）' },
  { name: 'power', desc: '该行总用电量（=power220+power380，W）' },
  { name: 'netPorts', desc: '该行网口总数（单台×数量）' },
  { name: 'comPorts', desc: '该行 com/串口总数' },
  { name: 'rackU', desc: '该行机柜占用总数（U）' },
  { name: 'seqPower', desc: '该行时序电源总路数' }
];

/** 项目级变量说明（全项目汇总）。 */
const PROJ_VARS: { name: string; desc: string }[] = [
  { name: 'projPower220', desc: '全项目 220V 总用电量（W）' },
  { name: 'projPower380', desc: '全项目 380V 总用电量（W）' },
  { name: 'projNetPorts', desc: '全项目网口总数' },
  { name: 'projComPorts', desc: '全项目 com 口总数' },
  { name: 'projRackU', desc: '全项目机柜占用总 U 数' },
  { name: 'projSeqPower', desc: '全项目时序电源总路数' },
  { name: 'projItemCount', desc: '全项目清单行数量合计（各行数量之和）' }
];

/** 可用函数说明。 */
const FUNC_VARS: { name: string; desc: string }[] = [
  { name: 'ceil(x)', desc: '向上取整（如接收卡、电源数量常用）' },
  { name: 'floor(x)', desc: '向下取整' },
  { name: 'round(x)', desc: '四舍五入' },
  { name: 'abs(x)', desc: '绝对值' },
  { name: 'min(a,b,…)', desc: '取最小值' },
  { name: 'max(a,b,…)', desc: '取最大值' }
];

/** 示例公式。 */
const EXAMPLES: { name: string; desc: string }[] = [
  { name: 'ceil(area*270000/512)', desc: 'LED 接收卡' },
  { name: 'ceil(power*1.2/300)', desc: 'LED 电源' },
  { name: 'area*0.06', desc: '钢结构面积' },
  { name: 'ceil(projNetPorts*1.2/24)', desc: '交换机（项目级）' }
];

const VAR_COLUMNS = [
  { title: '变量', dataIndex: 'name', key: 'name', width: 130 },
  { title: '含义', dataIndex: 'desc', key: 'desc' }
];
const FUNC_COLUMNS = [
  { title: '函数', dataIndex: 'name', key: 'name', width: 110 },
  { title: '说明', dataIndex: 'desc', key: 'desc' }
];
const EXAMPLE_COLUMNS = [
  { title: '示例公式', dataIndex: 'name', key: 'name', width: 200 },
  { title: '用途', dataIndex: 'desc', key: 'desc' }
];

const HintSection = ({
  title,
  columns,
  data
}: {
  title: string;
  columns: { title: string; dataIndex: string; key: string; width?: number }[];
  data: { name: string; desc: string }[];
}): React.JSX.Element => (
  <div style={{ marginBottom: 10 }}>
    <Typography.Text strong style={{ display: 'block', marginBottom: 4 }}>
      {title}
    </Typography.Text>
    <Table
      size="small"
      pagination={false}
      rowKey="name"
      columns={columns}
      dataSource={data}
      style={{ fontSize: 12 }}
    />
  </div>
);

const VariableHint = (
  <div style={{ width: 420, maxHeight: 360, overflow: 'auto' }}>
    <HintSection title="行级变量（由触发的清单行提供）" columns={VAR_COLUMNS} data={ROW_VARS} />
    <HintSection title="项目级变量（全项目汇总）" columns={VAR_COLUMNS} data={PROJ_VARS} />
    <HintSection title="可用函数" columns={FUNC_COLUMNS} data={FUNC_VARS} />
    <div style={{ marginBottom: 10 }}>
      <Typography.Text strong style={{ display: 'block', marginBottom: 4 }}>
        运算符
      </Typography.Text>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        + - * / 与括号 ( )；常量（如每㎡点数、单卡带载、系数）直接写数字。
      </Typography.Text>
    </div>
    <HintSection title="示例" columns={EXAMPLE_COLUMNS} data={EXAMPLES} />
  </div>
);

interface ActionDraft {
  productId: number | null;
  qtyFormula: string;
  optional: boolean;
  note: string;
}

const emptyAction = (): ActionDraft => ({ productId: null, qtyFormula: '', optional: false, note: '' });

export default function Rules(): React.JSX.Element {
  const [rules, setRules] = useState<BomRule[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const [togglingId, setTogglingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [filter, setFilter] = usePersistedState<RuleFilter>('aiquote.filters.rules', EMPTY_RULE_FILTER);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [batchDeleting, setBatchDeleting] = useState(false);
  const [batchEnabling, setBatchEnabling] = useState(false);
  const [batchDisabling, setBatchDisabling] = useState(false);
  const seqRef = useRef(0);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<BomRule | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [name, setName] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [triggerType, setTriggerType] = useState<RuleTriggerType>('category');
  const [triggerValue, setTriggerValue] = useState('');
  const [actions, setActions] = useState<ActionDraft[]>([emptyAction()]);

  const productNameById = useMemo(() => {
    const map: Record<number, string> = {};
    products.forEach((p) => {
      map[p.id] = p.model ? `${p.name}（${p.model}）` : p.name;
    });
    return map;
  }, [products]);

  const categoryOptions = useMemo(() => {
    const set = new Set<string>();
    products.forEach((p) => p.categories.forEach((c) => c && set.add(c)));
    return Array.from(set)
      .sort()
      .map((c) => ({ value: c, label: c }));
  }, [products]);

  const productOptions = useMemo(
    () => products.map((p) => ({ value: p.id, label: productNameById[p.id] })),
    [products, productNameById]
  );

  const filteredRules = useMemo(() => rules.filter((r) => matchRuleFilter(r, filter)), [rules, filter]);
  const resetFilter = (): void => setFilter(EMPTY_RULE_FILTER);
  const clearSelection = (): void => setSelectedRowKeys([]);
  const selectedIds = useMemo(() => selectedRowKeys.map((k) => Number(k)), [selectedRowKeys]);

  const loadRules = async (): Promise<void> => {
    const seq = ++seqRef.current;
    setLoading(true);
    try {
      const list = await api.rulesList();
      if (seq !== seqRef.current) return;
      setRules(list);
    } catch (err) {
      if (seq === seqRef.current) message.error(`加载规则失败：${(err as Error).message}`);
    } finally {
      if (seq === seqRef.current) setLoading(false);
    }
  };

  const loadProducts = async (): Promise<void> => {
    try {
      const list = await api.productsList();
      setProducts(list);
    } catch (err) {
      message.error(`加载产品失败：${(err as Error).message}`);
    }
  };

  useEffect(() => {
    loadRules();
    loadProducts();
  }, []);

  const openCreateModal = (): void => {
    setEditing(null);
    setName('');
    setEnabled(true);
    setTriggerType('category');
    setTriggerValue('');
    setActions([emptyAction()]);
    setModalOpen(true);
  };

  const openEditModal = (rule: BomRule): void => {
    setEditing(rule);
    setName(rule.name);
    setEnabled(rule.enabled);
    setTriggerType(rule.triggerType);
    setTriggerValue(rule.triggerValue);
    setActions(
      rule.actions.length > 0
        ? rule.actions.map((a) => ({
            productId: a.productId,
            qtyFormula: a.qtyFormula,
            optional: a.optional,
            note: a.note ?? ''
          }))
        : [emptyAction()]
    );
    setModalOpen(true);
  };

  const closeModal = (): void => {
    setModalOpen(false);
    setEditing(null);
  };

  const updateAction = (idx: number, patch: Partial<ActionDraft>): void => {
    setActions((prev) => prev.map((a, i) => (i === idx ? { ...a, ...patch } : a)));
  };

  const addAction = (): void => setActions((prev) => [...prev, emptyAction()]);

  const removeAction = (idx: number): void => setActions((prev) => prev.filter((_, i) => i !== idx));

  const handleTriggerTypeChange = (t: RuleTriggerType): void => {
    setTriggerType(t);
    setTriggerValue(''); // 触发类型变更时清空触发值，避免类型不匹配
  };

  const handleSubmit = async (): Promise<void> => {
    if (!name.trim()) {
      message.error('请输入规则名称');
      return;
    }
    if (!triggerValue.trim()) {
      message.error('请填写触发值');
      return;
    }
    // 校验动作：每条动作须选定关联产品且填写数量公式（否则评估时会被静默跳过）
    for (let i = 0; i < actions.length; i++) {
      const a = actions[i];
      if (a.productId == null) {
        message.error(`第 ${i + 1} 条动作未选择关联产品`);
        return;
      }
      if (!a.qtyFormula.trim()) {
        message.error(`第 ${i + 1} 条动作未填写数量公式`);
        return;
      }
    }
    const composedActions: RuleAction[] = actions.map((a) => ({
      productId: a.productId,
      qtyFormula: a.qtyFormula.trim(),
      optional: a.optional,
      note: a.note.trim() || null
    }));
    setSubmitting(true);
    try {
      if (editing) {
        await api.rulesUpdate({
          id: editing.id,
          patch: {
            name: name.trim(),
            enabled,
            triggerType,
            triggerValue: triggerValue.trim(),
            actions: composedActions
          }
        });
        message.success('规则已更新');
      } else {
        await api.rulesCreate({
          name: name.trim(),
          triggerType,
          triggerValue: triggerValue.trim(),
          actions: composedActions,
          enabled
        });
        message.success('规则已创建');
      }
      closeModal();
      await loadRules();
    } catch (err) {
      message.error(`保存规则失败：${(err as Error).message}`);
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleEnabled = async (rule: BomRule, value: boolean): Promise<void> => {
    setTogglingId(rule.id);
    try {
      await api.rulesUpdate({ id: rule.id, patch: { enabled: value } });
      setRules((prev) => prev.map((r) => (r.id === rule.id ? { ...r, enabled: value } : r)));
    } catch (err) {
      message.error(`切换启用状态失败：${(err as Error).message}`);
    } finally {
      setTogglingId(null);
    }
  };

  const handleDelete = async (id: number): Promise<void> => {
    setDeletingId(id);
    try {
      await api.rulesDelete(id);
      message.success('规则已删除');
      await loadRules();
    } catch (err) {
      message.error(`删除规则失败：${(err as Error).message}`);
    } finally {
      setDeletingId(null);
    }
  };

  const handleBatchDelete = async (): Promise<void> => {
    if (selectedIds.length === 0) return;
    setBatchDeleting(true);
    try {
      const n = await api.rulesBatchDelete(selectedIds);
      message.success(`已删除 ${n} 条规则`);
      clearSelection();
      await loadRules();
    } catch (err) {
      message.error(`批量删除失败：${(err as Error).message}`);
    } finally {
      setBatchDeleting(false);
    }
  };

  const handleBatchSetEnabled = async (value: boolean): Promise<void> => {
    if (selectedIds.length === 0) return;
    if (value) setBatchEnabling(true);
    else setBatchDisabling(true);
    try {
      for (const id of selectedIds) {
        await api.rulesUpdate({ id, patch: { enabled: value } });
      }
      message.success(value ? `已启用 ${selectedIds.length} 条规则` : `已停用 ${selectedIds.length} 条规则`);
      clearSelection();
      await loadRules();
    } catch (err) {
      message.error(`批量${value ? '启用' : '停用'}失败：${(err as Error).message}`);
    } finally {
      setBatchEnabling(false);
      setBatchDisabling(false);
    }
  };

  const renderTriggerValueInput = (): React.JSX.Element => {
    if (triggerType === 'category') {
      return (
        <AutoComplete
          style={{ width: '100%' }}
          options={categoryOptions}
          value={triggerValue}
          onChange={(v) => setTriggerValue(v)}
          placeholder="选择或输入分类"
          filterOption={(input, option) =>
            String(option?.value ?? '').toLowerCase().includes(input.toLowerCase())
          }
        />
      );
    }
    if (triggerType === 'product') {
      return (
        <Select
          showSearch
          style={{ width: '100%' }}
          options={productOptions}
          value={triggerValue ? Number(triggerValue) : undefined}
          onChange={(v) => setTriggerValue(v != null ? String(v) : '')}
          placeholder="选择触发产品"
          optionFilterProp="label"
        />
      );
    }
    return (
      <Input value={triggerValue} onChange={(e) => setTriggerValue(e.target.value)} placeholder="输入项目类型，如 展厅" />
    );
  };

  const columns = [
    { title: '名称', dataIndex: 'name', key: 'name' },
    {
      title: '触发条件',
      key: 'trigger',
      render: (_: unknown, record: BomRule) =>
        triggerLabel(
          record,
          record.triggerType === 'product' ? productNameById[Number(record.triggerValue)] : undefined
        )
    },
    {
      title: '动作数',
      key: 'actionCount',
      render: (_: unknown, record: BomRule) => record.actions.length
    },
    {
      title: '启用',
      key: 'enabled',
      render: (_: unknown, record: BomRule) => (
        <Switch
          checked={record.enabled}
          loading={togglingId === record.id}
          onChange={(v) => handleToggleEnabled(record, v)}
        />
      )
    },
    {
      title: '操作',
      key: 'action',
      render: (_: unknown, record: BomRule) => (
        <Space>
          <Button type="link" onClick={() => openEditModal(record)}>
            编辑
          </Button>
          <Popconfirm
            title="确认删除该规则？"
            okText="确认"
            cancelText="取消"
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
        联动规则
      </Typography.Title>
      <Space style={{ marginBottom: 16 }} wrap>
        <Select
          allowClear
          mode="multiple"
          placeholder="按触发类型筛选"
          style={{ minWidth: 220 }}
          maxTagCount="responsive"
          options={TRIGGER_TYPE_OPTIONS}
          value={filter.triggerTypes}
          onChange={(v) => setFilter({ ...filter, triggerTypes: v })}
        />
        <Input.Search
          allowClear
          placeholder="按规则名搜索"
          style={{ width: 220 }}
          value={filter.keyword}
          onChange={(e) => setFilter({ ...filter, keyword: e.target.value })}
          onSearch={(v) => setFilter({ ...filter, keyword: v })}
        />
        <Button onClick={resetFilter}>重置筛选</Button>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreateModal}>
          新增规则
        </Button>
      </Space>
      {selectedRowKeys.length > 0 && (
        <Space style={{ marginBottom: 16 }} wrap>
          <Typography.Text strong>已选 {selectedRowKeys.length} 项</Typography.Text>
          <Button size="small" onClick={clearSelection}>
            清空选择
          </Button>
          <Button size="small" loading={batchEnabling} onClick={() => handleBatchSetEnabled(true)}>
            批量启用
          </Button>
          <Button size="small" loading={batchDisabling} onClick={() => handleBatchSetEnabled(false)}>
            批量停用
          </Button>
          <Popconfirm
            title={`确认删除选中 ${selectedRowKeys.length} 条规则？`}
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
        dataSource={filteredRules}
        loading={loading}
        locale={{ emptyText: <Empty description="暂无规则" /> }}
      />

      <Modal
        title={editing ? '编辑规则' : '新增规则'}
        open={modalOpen}
        onOk={handleSubmit}
        onCancel={closeModal}
        okText="保存"
        cancelText="取消"
        confirmLoading={submitting}
        width={800}
        destroyOnClose
      >
        <Form layout="vertical">
          <Space size="large" style={{ display: 'flex' }} align="end">
            <Form.Item label="规则名称" required style={{ flex: 1 }}>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="请输入规则名称" />
            </Form.Item>
            <Form.Item label="启用">
              <Switch checked={enabled} onChange={setEnabled} />
            </Form.Item>
          </Space>
          <Space size="large" style={{ display: 'flex' }} align="start">
            <Form.Item label="触发类型" style={{ width: 200 }}>
              <Select value={triggerType} options={TRIGGER_TYPE_OPTIONS} onChange={handleTriggerTypeChange} />
            </Form.Item>
            <Form.Item label="触发值" required style={{ flex: 1 }}>
              {renderTriggerValueInput()}
            </Form.Item>
          </Space>

          <Divider titlePlacement="start" style={{ margin: '4px 0 12px' }}>
            <Space>
              动作列表
              <Popover content={VariableHint} title="可用变量 / 函数">
                <Typography.Text type="secondary">
                  <QuestionCircleOutlined />
                </Typography.Text>
              </Popover>
            </Space>
          </Divider>

          {actions.map((a, idx) => (
            <Card key={idx} size="small" style={{ marginBottom: 16, background: '#fafafa' }}>
              <Space wrap align="end" style={{ width: '100%' }}>
                <div>
                  <div style={{ marginBottom: 4 }}>关联产品</div>
                  <Select
                    showSearch
                    style={{ width: 220 }}
                    options={productOptions}
                    value={a.productId ?? undefined}
                    onChange={(v) => updateAction(idx, { productId: (v as number) ?? null })}
                    optionFilterProp="label"
                    placeholder="选择产品"
                    allowClear
                  />
                </div>
                <div>
                  <div style={{ marginBottom: 4 }}>
                    数量公式{' '}
                    <Popover content={VariableHint} title="可用变量 / 函数">
                      <Typography.Text type="secondary">
                  <QuestionCircleOutlined />
                </Typography.Text>
                    </Popover>
                  </div>
                  <Input
                    style={{ width: 240 }}
                    value={a.qtyFormula}
                    onChange={(e) => updateAction(idx, { qtyFormula: e.target.value })}
                    placeholder="如 ceil(area*270000/512)"
                  />
                </div>
                <div>
                  <div style={{ marginBottom: 4 }}>必选/可选</div>
                  <Select
                    style={{ width: 100 }}
                    value={a.optional}
                    onChange={(v) => updateAction(idx, { optional: v })}
                    options={[
                      { value: false, label: '必选' },
                      { value: true, label: '可选' }
                    ]}
                  />
                </div>
                <div>
                  <div style={{ marginBottom: 4 }}>备注</div>
                  <Input
                    style={{ width: 160 }}
                    value={a.note}
                    onChange={(e) => updateAction(idx, { note: e.target.value })}
                    placeholder="备注"
                  />
                </div>
                <Button
                  danger
                  type="text"
                  icon={<DeleteOutlined />}
                  disabled={actions.length <= 1}
                  onClick={() => removeAction(idx)}
                />
              </Space>
            </Card>
          ))}
          <Button type="dashed" block icon={<PlusOutlined />} onClick={addAction}>
            添加动作
          </Button>
        </Form>
      </Modal>
    </div>
  );
}
