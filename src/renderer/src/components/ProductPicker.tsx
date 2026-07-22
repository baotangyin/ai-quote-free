import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Table, Select, Input, InputNumber, Checkbox, Space, Typography, message, Empty, Tag, Tooltip, Card } from 'antd';
import type { Product, Cents, ProductOption, LineItem } from '../../../shared/api-types';
import { api } from '../api';
import { fmtYuan } from '../money';

interface ProductPickerProps {
  open: boolean;
  spaceId: number | null;
  onClose: () => void;
  /** 添加成功后回调，供父级重新加载清单；参数为新建的清单行，供触发规则联动。mode='add' 时必填 */
  onAdded?: (created: LineItem) => void;
  /** 'add'（默认）：选中产品后直接调 itemsCreateFromProduct 落库；'pick'：仅选择产品，交由父级处理（如换绑），不发起任何写入 */
  mode?: 'add' | 'pick';
  /** mode='pick' 时必填：确认选择后回调，随后关闭弹窗 */
  onPick?: (product: Product) => void;
}

export default function ProductPicker({
  open,
  spaceId,
  onClose,
  onAdded,
  mode = 'add',
  onPick
}: ProductPickerProps): React.JSX.Element {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<string | undefined>(undefined);
  const [keyword, setKeyword] = useState('');
  const [allCategories, setAllCategories] = useState<string[]>([]);
  const [effectiveCosts, setEffectiveCosts] = useState<Record<number, Cents | null>>({});
  const [selectedProductId, setSelectedProductId] = useState<number | null>(null);
  const [qty, setQty] = useState<number>(1);
  const [selectedOptionNames, setSelectedOptionNames] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const seqRef = useRef(0);

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
    const seq = ++seqRef.current;
    setLoading(true);
    try {
      const list = await api.productsList({ category: categoryFilter, keyword: keyword || undefined });
      const costs = await Promise.all(list.map((p) => api.pricesEffectiveCost(p.id)));
      if (seq !== seqRef.current) return; // 已被更新的查询覆盖，丢弃过期响应
      setProducts(list);
      const map: Record<number, Cents | null> = {};
      list.forEach((p, i) => {
        map[p.id] = costs[i];
      });
      setEffectiveCosts(map);
    } catch (err) {
      if (seq === seqRef.current) message.error(`加载产品列表失败：${(err as Error).message}`);
    } finally {
      if (seq === seqRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      loadCategories();
      loadProducts();
      setSelectedProductId(null);
      setQty(1);
      setSelectedOptionNames([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (open) {
      loadProducts();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryFilter, keyword]);

  const categoryOptions = useMemo(() => allCategories.map((c) => ({ value: c, label: c })), [allCategories]);

  const selectedProduct = useMemo(
    () => products.find((p) => p.id === selectedProductId) ?? null,
    [products, selectedProductId]
  );

  const handleSelectProduct = (id: number): void => {
    if (effectiveCosts[id] == null) {
      message.warning('该产品无价格记录，无法添加到清单');
      return;
    }
    setSelectedProductId(id);
    setQty(1);
    setSelectedOptionNames([]);
  };

  const resetAndClose = (): void => {
    setSelectedProductId(null);
    setQty(1);
    setSelectedOptionNames([]);
    onClose();
  };

  const handleConfirm = async (): Promise<void> => {
    if (mode === 'pick') {
      if (!selectedProduct) {
        message.warning('请先选择一个产品');
        return;
      }
      onPick?.(selectedProduct);
      resetAndClose();
      return;
    }
    if (!spaceId) {
      message.error('未选中空间');
      return;
    }
    if (!selectedProduct) {
      message.warning('请先选择一个产品');
      return;
    }
    if (effectiveCosts[selectedProduct.id] == null) {
      message.error('该产品无价格记录，无法添加');
      return;
    }
    if (!qty || qty <= 0) {
      message.error('请输入大于 0 的数量');
      return;
    }
    const options: ProductOption[] = selectedProduct.options.filter((o) => selectedOptionNames.includes(o.name));
    setSubmitting(true);
    try {
      const created = await api.itemsCreateFromProduct({ spaceId, productId: selectedProduct.id, qty, options });
      message.success('已添加到清单');
      onAdded?.(created);
      resetAndClose();
    } catch (err) {
      message.error(`添加失败：${(err as Error).message}`);
    } finally {
      setSubmitting(false);
    }
  };

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
      title: '成本单价',
      key: 'cost',
      render: (_: unknown, record: Product) => {
        const cost = effectiveCosts[record.id];
        if (cost === undefined) return '-';
        if (cost === null) return <Typography.Text type="danger">无价格</Typography.Text>;
        return fmtYuan(cost);
      }
    }
  ];

  return (
    <Modal
      title={mode === 'pick' ? '选择产品换绑' : '从产品库添加'}
      open={open}
      onCancel={resetAndClose}
      onOk={handleConfirm}
      okText={mode === 'pick' ? '确定换绑' : '添加'}
      cancelText="取消"
      confirmLoading={submitting}
      okButtonProps={{ disabled: !selectedProduct }}
      width={900}
      destroyOnClose
    >
      <Space style={{ marginBottom: 16 }} wrap>
        <Select
          allowClear
          placeholder="按分类筛选"
          style={{ width: 180 }}
          options={categoryOptions}
          value={categoryFilter}
          onChange={(v) => setCategoryFilter(v)}
        />
        <Input.Search
          allowClear
          placeholder="按名称/品牌/型号搜索"
          style={{ width: 240 }}
          onSearch={(v) => setKeyword(v)}
        />
      </Space>
      <Table
        rowKey="id"
        size="small"
        columns={columns}
        dataSource={products}
        loading={loading}
        pagination={{ pageSize: 8 }}
        scroll={{ y: 280 }}
        locale={{ emptyText: <Empty description="暂无产品" /> }}
        rowSelection={{
          type: 'radio',
          selectedRowKeys: selectedProductId != null ? [selectedProductId] : [],
          onChange: (keys) => {
            const id = keys[0] as number | undefined;
            if (id != null) handleSelectProduct(id);
          },
          getCheckboxProps: (record: Product) => ({
            disabled: effectiveCosts[record.id] == null
          })
        }}
        onRow={(record) => ({
          onClick: () => handleSelectProduct(record.id)
        })}
      />
      {mode !== 'pick' && selectedProduct && (
        <Card size="small" style={{ marginTop: 16, background: '#fafafa' }}>
          <Space direction="vertical" style={{ width: '100%' }}>
            <Space>
              <span>已选：{selectedProduct.name}</span>
              <span>数量：</span>
              <InputNumber min={0.01} precision={2} value={qty} onChange={(v) => setQty(v ?? 1)} style={{ width: 100 }} />
              <span>{selectedProduct.unit}</span>
            </Space>
            {selectedProduct.options.length > 0 && (
              <Space direction="vertical">
                <span>选配项：</span>
                <Checkbox.Group value={selectedOptionNames} onChange={(vals) => setSelectedOptionNames(vals as string[])}>
                  <Space direction="vertical">
                    {selectedProduct.options.map((o) => {
                      const label = `${o.name}（+${fmtYuan(o.addPriceCents)} 元）`;
                      return (
                        <Checkbox key={o.name} value={o.name}>
                          {o.paramsText ? <Tooltip title={o.paramsText}>{label}</Tooltip> : label}
                        </Checkbox>
                      );
                    })}
                  </Space>
                </Checkbox.Group>
              </Space>
            )}
          </Space>
        </Card>
      )}
    </Modal>
  );
}
