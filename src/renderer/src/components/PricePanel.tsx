import React, { useEffect, useRef, useState } from 'react';
import { Drawer, Table, Form, Select, InputNumber, DatePicker, Input, Button, message, Typography, Space, Descriptions } from 'antd';
import dayjs from 'dayjs';
import type { Product, PriceRecord, PriceSource, Supplier, CostRule } from '../../../shared/api-types';
import { api } from '../api';
import { yuanToCents, fmtYuan } from '../money';
import ScreenshotPriceModal from './ScreenshotPriceModal';

interface PricePanelProps {
  open: boolean;
  product: Product | null;
  onClose: () => void;
  /** 新增报价成功后回调，供父级刷新该产品的成本价展示 */
  onChanged?: () => void;
}

interface AddPriceFormValues {
  source: PriceSource;
  supplierId?: number;
  priceYuan: number;
  capturedAt: dayjs.Dayjs;
  sourceUrl?: string;
}

const sourceLabel: Record<PriceSource, string> = {
  supplier: '供应商报价',
  ai_search: 'AI查价',
  manual: '手动'
};

function ruleLabel(rule: CostRule, suppliers: Supplier[]): string {
  if (rule === 'lowest') return '最低价';
  if (rule === 'latest') return '最新记录';
  const supplierId = Number(rule.split(':')[1]);
  const supplier = suppliers.find((s) => s.id === supplierId);
  return `指定供应商（${supplier ? supplier.name : `#${supplierId}`}）`;
}

export default function PricePanel({ open, product, onClose, onChanged }: PricePanelProps): React.JSX.Element {
  const [records, setRecords] = useState<PriceRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [effectiveCost, setEffectiveCost] = useState<number | null>(null);
  const [globalRule, setGlobalRule] = useState<CostRule>('lowest');
  const [submitting, setSubmitting] = useState(false);
  const [screenshotOpen, setScreenshotOpen] = useState(false);
  const [form] = Form.useForm<AddPriceFormValues>();
  const source = Form.useWatch('source', form);
  const loadSeqRef = useRef(0);

  const load = async (productId: number): Promise<void> => {
    const seq = ++loadSeqRef.current;
    setLoading(true);
    try {
      const [list, cost, rule, supplierList] = await Promise.all([
        api.pricesList(productId),
        api.pricesEffectiveCost(productId),
        api.settingsGet('costRule'),
        api.suppliersList()
      ]);
      if (seq !== loadSeqRef.current) return; // 产品已切换，丢弃过期响应
      setRecords(list);
      setEffectiveCost(cost);
      setGlobalRule((rule as CostRule | null) ?? 'lowest');
      setSuppliers(supplierList);
    } catch (err) {
      if (seq === loadSeqRef.current) message.error(`加载价格信息失败：${(err as Error).message}`);
    } finally {
      if (seq === loadSeqRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    if (open && product) {
      load(product.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, product?.id]);

  const handleAdd = async (): Promise<void> => {
    if (!product) return;
    let values: AddPriceFormValues;
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
      await api.pricesAdd({
        productId: product.id,
        source: values.source,
        priceCents: yuanToCents(values.priceYuan),
        supplierId: values.source === 'supplier' ? values.supplierId : undefined,
        sourceUrl: values.sourceUrl || undefined,
        capturedAt: values.capturedAt.toISOString()
      });
      message.success('报价已添加');
      form.resetFields();
      await load(product.id);
      onChanged?.();
    } catch (err) {
      message.error(`添加报价失败：${(err as Error).message}`);
    } finally {
      setSubmitting(false);
    }
  };

  const columns = [
    { title: '来源', dataIndex: 'source', key: 'source', render: (v: PriceSource) => sourceLabel[v] },
    {
      title: '供应商',
      dataIndex: 'supplierId',
      key: 'supplierId',
      render: (v: number | null) => (v ? (suppliers.find((s) => s.id === v)?.name ?? `#${v}`) : '-')
    },
    { title: '价格（元）', dataIndex: 'priceCents', key: 'priceCents', render: (v: number) => fmtYuan(v) },
    {
      title: '时间',
      dataIndex: 'capturedAt',
      key: 'capturedAt',
      render: (v: string) => dayjs(v).format('YYYY-MM-DD HH:mm')
    },
    {
      title: '链接',
      dataIndex: 'sourceUrl',
      key: 'sourceUrl',
      render: (v: string | null) =>
        v ? (
          /^https?:\/\//i.test(v) ? (
            <a href={v} target="_blank" rel="noreferrer">
              {v}
            </a>
          ) : (
            // 非链接的备注性内容（如「截图识价：某店铺」）降级为纯文本展示
            <span>{v}</span>
          )
        ) : (
          '-'
        )
    }
  ];

  const currentRule: CostRule = (product?.costRuleOverride as CostRule | null) ?? globalRule;
  const ruleSource = product?.costRuleOverride ? '本产品单独设置' : '全局规则';

  return (
    <Drawer title={product ? `价格 - ${product.name}` : '价格'} open={open} onClose={onClose} width={720} destroyOnClose>
      {product && (
        <>
          <Descriptions column={1} size="small" bordered style={{ marginBottom: 16 }}>
            <Descriptions.Item label="当前生效成本价">
              {effectiveCost == null ? (
                <Typography.Text type="danger">无价格</Typography.Text>
              ) : (
                fmtYuan(effectiveCost)
              )}
            </Descriptions.Item>
            <Descriptions.Item label="取值规则">
              {ruleSource}：{ruleLabel(currentRule, suppliers)}
            </Descriptions.Item>
          </Descriptions>

          <div style={{ marginBottom: 16 }}>
            <Button onClick={() => setScreenshotOpen(true)}>截图识价</Button>
          </div>

          <Form
            form={form}
            layout="inline"
            onFinish={handleAdd}
            initialValues={{ source: 'manual', capturedAt: dayjs() }}
            style={{ marginBottom: 16, rowGap: 8 }}
          >
            <Form.Item name="source" label="来源" rules={[{ required: true, message: '请选择来源' }]}>
              <Select
                style={{ width: 140 }}
                options={[
                  { value: 'supplier', label: '供应商报价' },
                  { value: 'manual', label: '手动' }
                ]}
              />
            </Form.Item>
            {source === 'supplier' && (
              <Form.Item name="supplierId" label="供应商" rules={[{ required: true, message: '请选择供应商' }]}>
                <Select
                  style={{ width: 160 }}
                  placeholder="请选择供应商"
                  options={suppliers.map((s) => ({ value: s.id, label: s.name }))}
                />
              </Form.Item>
            )}
            <Form.Item name="priceYuan" label="价格（元）" rules={[{ required: true, message: '请输入价格' }]}>
              <InputNumber min={0} precision={2} style={{ width: 140 }} placeholder="请输入价格" />
            </Form.Item>
            <Form.Item name="capturedAt" label="日期" rules={[{ required: true, message: '请选择日期' }]}>
              <DatePicker style={{ width: 140 }} />
            </Form.Item>
            <Form.Item name="sourceUrl" label="链接">
              <Input style={{ width: 200 }} placeholder="可选" />
            </Form.Item>
            <Form.Item>
              <Button type="primary" htmlType="submit" loading={submitting}>
                新增报价
              </Button>
            </Form.Item>
          </Form>

          <Table
            rowKey="id"
            columns={columns}
            dataSource={records}
            loading={loading}
            size="small"
            pagination={false}
            locale={{ emptyText: <Space>暂无报价记录</Space> }}
          />
        </>
      )}
      <ScreenshotPriceModal
        open={screenshotOpen}
        product={product}
        onClose={() => setScreenshotOpen(false)}
        onWritten={() => {
          if (product) load(product.id);
          onChanged?.();
        }}
      />
    </Drawer>
  );
}
