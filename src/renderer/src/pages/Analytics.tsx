import React, { useEffect, useState } from 'react';
import {
  Space, Radio, DatePicker, Switch, Button, Tabs, Row, Col, Card, Statistic,
  Table, Select, Tag, Empty, message, Typography
} from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import type {
  AnalyticsSummary, ProductProfitRow, ProjectProfitRow, PriceTrendPoint, PriceChangeRow, Product, PriceSource,
  WatchRoundSummary
} from '../../../shared/api-types';
import { api } from '../api';
import { fmtYuan, centsToYuan } from '../money';
import { usePersistedState } from '../useListState';
import {
  DEFAULT_ANALYTICS_FILTER, toAnalyticsFilter, aggregateMonthlyProfit,
  type AnalyticsFilterState
} from './analytics-logic';
import TrendChart, { type TrendChartSeries } from '../components/TrendChart';

const { RangePicker } = DatePicker;

const sourceLabel: Record<PriceSource, string> = {
  supplier: '供应商报价',
  ai_search: 'AI查价',
  manual: '手动'
};

function fmtRate(v: number | null): string {
  return v == null ? '-' : `${(v * 100).toFixed(1)}%`;
}

/** 价格趋势按 supplierName 分系列；无供应商时按 source 归为「手动」/「AI」。 */
function buildPriceTrendSeries(points: PriceTrendPoint[]): TrendChartSeries[] {
  const map = new Map<string, [string, number][]>();
  for (const p of points) {
    const label = p.supplierName ?? (p.source === 'manual' ? '手动' : 'AI');
    let arr = map.get(label);
    if (!arr) { arr = []; map.set(label, arr); }
    arr.push([p.capturedAt, centsToYuan(p.priceCents)]);
  }
  return Array.from(map.entries()).map(([name, data]) => ({ name, data }));
}

export default function Analytics(): React.JSX.Element {
  const [filterState, setFilterState] = usePersistedState<AnalyticsFilterState>(
    'analytics.filter',
    DEFAULT_ANALYTICS_FILTER
  );
  const [activeTab, setActiveTab] = useState('1');
  const [reloadToken, setReloadToken] = useState(0);

  // Tab1 总览
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [monthlyRows, setMonthlyRows] = useState<ProjectProfitRow[]>([]);
  const [overviewLoading, setOverviewLoading] = useState(false);

  // Tab2 产品利润
  const [productProfitRows, setProductProfitRows] = useState<ProductProfitRow[]>([]);
  const [productProfitLoading, setProductProfitLoading] = useState(false);
  const [expandedRowKeys, setExpandedRowKeys] = useState<React.Key[]>([]);
  const [productTrendMap, setProductTrendMap] = useState<Record<number, { loading: boolean; points: PriceTrendPoint[] }>>({});

  // Tab3 价格趋势
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedProductId, setSelectedProductId] = useState<number | null>(null);
  const [priceTrendPoints, setPriceTrendPoints] = useState<PriceTrendPoint[]>([]);
  const [priceTrendLoading, setPriceTrendLoading] = useState(false);

  // Tab4 价格异动
  const [priceChanges, setPriceChanges] = useState<PriceChangeRow[]>([]);
  const [priceChangesLoading, setPriceChangesLoading] = useState(false);
  const [watchStatus, setWatchStatus] = useState<{ lastRunAt: string | null; lastSummary: WatchRoundSummary | null; running: boolean } | null>(null);

  // 产品下拉列表：与筛选条无关，加载一次
  useEffect(() => {
    api.productsList().then(setProducts).catch((err) => message.error(`加载产品列表失败：${(err as Error).message}`));
  }, []);

  // 筛选/刷新变化时，清空产品利润的已展开趋势缓存，避免展示过期数据
  useEffect(() => {
    setExpandedRowKeys([]);
    setProductTrendMap({});
  }, [filterState, reloadToken]);

  // Tab1
  useEffect(() => {
    if (activeTab !== '1') return undefined;
    let cancelled = false;
    (async () => {
      setOverviewLoading(true);
      try {
        const filter = toAnalyticsFilter(filterState);
        const [s, pp] = await Promise.all([api.analyticsSummary(filter), api.analyticsProjectProfit(filter)]);
        if (cancelled) return;
        setSummary(s);
        setMonthlyRows(pp);
      } catch (err) {
        if (!cancelled) message.error(`加载总览数据失败：${(err as Error).message}`);
      } finally {
        if (!cancelled) setOverviewLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [activeTab, filterState, reloadToken]);

  // Tab2
  useEffect(() => {
    if (activeTab !== '2') return undefined;
    let cancelled = false;
    (async () => {
      setProductProfitLoading(true);
      try {
        const filter = toAnalyticsFilter(filterState);
        const rows = await api.analyticsProductProfit(filter);
        if (cancelled) return;
        setProductProfitRows(rows);
      } catch (err) {
        if (!cancelled) message.error(`加载产品利润失败：${(err as Error).message}`);
      } finally {
        if (!cancelled) setProductProfitLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [activeTab, filterState, reloadToken]);

  // Tab3：选中产品变化或筛选变化时重拉
  useEffect(() => {
    if (activeTab !== '3' || selectedProductId == null) {
      setPriceTrendPoints([]);
      return undefined;
    }
    let cancelled = false;
    (async () => {
      setPriceTrendLoading(true);
      try {
        const filter = toAnalyticsFilter(filterState);
        const points = await api.analyticsPriceTrend({ productId: selectedProductId, ...filter });
        if (cancelled) return;
        setPriceTrendPoints(points);
      } catch (err) {
        if (!cancelled) message.error(`加载价格趋势失败：${(err as Error).message}`);
      } finally {
        if (!cancelled) setPriceTrendLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [activeTab, selectedProductId, filterState, reloadToken]);

  // Tab4
  useEffect(() => {
    if (activeTab !== '4') return undefined;
    let cancelled = false;
    (async () => {
      setPriceChangesLoading(true);
      try {
        const filter = toAnalyticsFilter(filterState);
        const rows = await api.analyticsPriceChanges({ ...filter, limit: 20 });
        if (cancelled) return;
        setPriceChanges(rows);
      } catch (err) {
        if (!cancelled) message.error(`加载价格异动失败：${(err as Error).message}`);
      } finally {
        if (!cancelled) setPriceChangesLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [activeTab, filterState, reloadToken]);

  // 「最近一轮查价」卡片：拉取初始状态，并订阅整轮查价完成事件实时刷新；组件卸载时取消订阅
  useEffect(() => {
    let cancelled = false;
    api
      .watchStatus()
      .then((s) => { if (!cancelled) setWatchStatus(s); })
      .catch((err) => { if (!cancelled) message.error(`加载查价状态失败：${(err as Error).message}`); });
    const unsubscribe = api.onWatchDone((summary) => {
      setWatchStatus({ lastRunAt: summary.finishedAt, lastSummary: summary, running: false });
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const handleExpandProduct = (expanded: boolean, record: ProductProfitRow): void => {
    setExpandedRowKeys((keys) =>
      expanded ? [...keys, record.productId] : keys.filter((k) => k !== record.productId)
    );
    if (!expanded) return;
    const cached = productTrendMap[record.productId];
    if (cached) return; // 已加载过（首次展开才拉取）
    setProductTrendMap((m) => ({ ...m, [record.productId]: { loading: true, points: [] } }));
    const filter = toAnalyticsFilter(filterState);
    api
      .analyticsPriceTrend({ productId: record.productId, ...filter })
      .then((points) => {
        setProductTrendMap((m) => ({ ...m, [record.productId]: { loading: false, points } }));
      })
      .catch((err) => {
        message.error(`加载价格趋势失败：${(err as Error).message}`);
        setProductTrendMap((m) => ({ ...m, [record.productId]: { loading: false, points: [] } }));
      });
  };

  const jumpToTrend = (productId: number): void => {
    setSelectedProductId(productId);
    setActiveTab('3');
  };

  const monthly = aggregateMonthlyProfit(monthlyRows);
  const overviewSeries: TrendChartSeries[] = [
    { name: '成本', data: monthly.map((m) => [`${m.month}-01`, centsToYuan(m.costCents)] as [string, number]) },
    { name: '报价', data: monthly.map((m) => [`${m.month}-01`, centsToYuan(m.revenueCents)] as [string, number]) }
  ];

  const productProfitColumns = [
    { title: '名称', dataIndex: 'name', key: 'name', sorter: (a: ProductProfitRow, b: ProductProfitRow) => a.name.localeCompare(b.name) },
    { title: '分类', dataIndex: 'category', key: 'category', sorter: (a: ProductProfitRow, b: ProductProfitRow) => a.category.localeCompare(b.category) },
    { title: '使用次数', dataIndex: 'usageCount', key: 'usageCount', sorter: (a: ProductProfitRow, b: ProductProfitRow) => a.usageCount - b.usageCount },
    { title: '总数量', dataIndex: 'totalQty', key: 'totalQty', sorter: (a: ProductProfitRow, b: ProductProfitRow) => a.totalQty - b.totalQty },
    {
      title: '成本合计', dataIndex: 'costTotalCents', key: 'costTotalCents',
      sorter: (a: ProductProfitRow, b: ProductProfitRow) => a.costTotalCents - b.costTotalCents,
      render: (v: number) => fmtYuan(v)
    },
    {
      title: '报价合计', dataIndex: 'revenueTotalCents', key: 'revenueTotalCents',
      sorter: (a: ProductProfitRow, b: ProductProfitRow) => a.revenueTotalCents - b.revenueTotalCents,
      render: (v: number) => fmtYuan(v)
    },
    {
      title: '利润', dataIndex: 'profitCents', key: 'profitCents',
      sorter: (a: ProductProfitRow, b: ProductProfitRow) => a.profitCents - b.profitCents,
      defaultSortOrder: 'descend' as const,
      render: (v: number) => fmtYuan(v)
    },
    {
      title: '利润率', dataIndex: 'profitRate', key: 'profitRate',
      sorter: (a: ProductProfitRow, b: ProductProfitRow) => (a.profitRate ?? -Infinity) - (b.profitRate ?? -Infinity),
      render: (v: number | null) => fmtRate(v)
    }
  ];

  const priceRecordColumns = [
    { title: '时间', dataIndex: 'capturedAt', key: 'capturedAt', render: (v: string) => dayjs(v).format('YYYY-MM-DD HH:mm') },
    { title: '来源', dataIndex: 'source', key: 'source', render: (v: PriceSource) => sourceLabel[v] },
    { title: '供应商', dataIndex: 'supplierName', key: 'supplierName', render: (v: string | null) => v ?? '-' },
    { title: '价格（元）', dataIndex: 'priceCents', key: 'priceCents', render: (v: number) => fmtYuan(v) }
  ];

  const gainers = priceChanges
    .filter((r) => r.changeRate != null && r.changeRate > 0)
    .sort((a, b) => (b.changeRate as number) - (a.changeRate as number));
  const losers = priceChanges
    .filter((r) => r.changeRate != null && r.changeRate < 0)
    .sort((a, b) => (a.changeRate as number) - (b.changeRate as number));

  const priceChangeColumns = [
    { title: '产品', dataIndex: 'name', key: 'name' },
    { title: '首次价格', dataIndex: 'firstCents', key: 'firstCents', render: (v: number) => fmtYuan(v) },
    { title: '最新价格', dataIndex: 'lastCents', key: 'lastCents', render: (v: number) => fmtYuan(v) },
    { title: '涨跌额', dataIndex: 'changeCents', key: 'changeCents', render: (v: number) => fmtYuan(v) },
    {
      title: '涨跌幅', dataIndex: 'changeRate', key: 'changeRate',
      render: (v: number | null) =>
        v == null ? '-' : <Tag color={v > 0 ? 'red' : 'green'}>{fmtRate(v)}</Tag>
    },
    { title: '记录数', dataIndex: 'recordCount', key: 'recordCount' }
  ];

  const rowClickToTrend = (record: PriceChangeRow): { onClick: () => void; style: React.CSSProperties } => ({
    onClick: () => jumpToTrend(record.productId),
    style: { cursor: 'pointer' }
  });

  const handlePresetChange = (preset: AnalyticsFilterState['preset']): void => {
    setFilterState({ ...filterState, preset });
  };

  const handleCustomRangeChange = (vals: [dayjs.Dayjs | null, dayjs.Dayjs | null] | null): void => {
    if (!vals || !vals[0] || !vals[1]) {
      setFilterState({ ...filterState, customRange: null });
      return;
    }
    setFilterState({ ...filterState, customRange: [vals[0].format('YYYY-MM-DD'), vals[1].format('YYYY-MM-DD')] });
  };

  return (
    <div>
      <Typography.Title level={4} style={{ marginTop: 0, marginBottom: 16 }}>
        统计分析
      </Typography.Title>
      <Space style={{ marginBottom: 16 }} wrap>
        <Radio.Group value={filterState.preset} onChange={(e) => handlePresetChange(e.target.value)}>
          <Radio.Button value="30d">近30天</Radio.Button>
          <Radio.Button value="90d">近90天</Radio.Button>
          <Radio.Button value="year">今年</Radio.Button>
          <Radio.Button value="all">全部</Radio.Button>
          <Radio.Button value="custom">自定义</Radio.Button>
        </Radio.Group>
        {filterState.preset === 'custom' && (
          <RangePicker
            value={
              filterState.customRange
                ? [dayjs(filterState.customRange[0]), dayjs(filterState.customRange[1])]
                : null
            }
            onChange={(vals) => handleCustomRangeChange(vals as [dayjs.Dayjs | null, dayjs.Dayjs | null] | null)}
          />
        )}
        <Space>
          <span>仅已完成</span>
          <Switch
            checked={filterState.onlyDone}
            onChange={(checked) => setFilterState({ ...filterState, onlyDone: checked })}
          />
        </Space>
        <Button icon={<ReloadOutlined />} onClick={() => setReloadToken((t) => t + 1)}>
          刷新
        </Button>
      </Space>

      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={[
          {
            key: '1',
            label: '总览',
            children: (
              <div>
                <Row gutter={16} style={{ marginBottom: 16 }}>
                  <Col span={4}>
                    <Card>
                      <Statistic title="项目数" value={summary?.projectCount ?? 0} loading={overviewLoading} />
                    </Card>
                  </Col>
                  <Col span={4}>
                    <Card>
                      <Statistic title="清单行数" value={summary?.itemCount ?? 0} loading={overviewLoading} />
                    </Card>
                  </Col>
                  <Col span={4}>
                    <Card>
                      <Statistic title="总成本（元）" value={summary ? fmtYuan(summary.costTotalCents) : '-'} loading={overviewLoading} />
                    </Card>
                  </Col>
                  <Col span={4}>
                    <Card>
                      <Statistic title="总报价（元）" value={summary ? fmtYuan(summary.revenueTotalCents) : '-'} loading={overviewLoading} />
                    </Card>
                  </Col>
                  <Col span={4}>
                    <Card>
                      <Statistic title="总利润（元）" value={summary ? fmtYuan(summary.profitCents) : '-'} loading={overviewLoading} />
                    </Card>
                  </Col>
                  <Col span={4}>
                    <Card>
                      <Statistic title="利润率" value={summary ? fmtRate(summary.profitRate) : '-'} loading={overviewLoading} />
                    </Card>
                  </Col>
                </Row>
                <Card title="成本/报价按月趋势">
                  <TrendChart series={overviewSeries} loading={overviewLoading} height={320} />
                </Card>
              </div>
            )
          },
          {
            key: '2',
            label: '产品利润',
            children: (
              <Table
                size="small"
                rowKey="productId"
                columns={productProfitColumns}
                dataSource={productProfitRows}
                loading={productProfitLoading}
                locale={{ emptyText: <Empty description="暂无产品利润数据" /> }}
                expandable={{
                  expandedRowKeys,
                  onExpand: handleExpandProduct,
                  expandedRowRender: (record: ProductProfitRow) => {
                    const cache = productTrendMap[record.productId];
                    const series: TrendChartSeries[] = [
                      { name: record.name, data: (cache?.points ?? []).map((p) => [p.capturedAt, centsToYuan(p.priceCents)] as [string, number]) }
                    ];
                    return <TrendChart series={series} loading={cache?.loading ?? true} height={220} />;
                  }
                }}
              />
            )
          },
          {
            key: '3',
            label: '价格趋势',
            children: (
              <div>
                <Space style={{ marginBottom: 16 }}>
                  <Select
                    showSearch
                    allowClear
                    style={{ width: 320 }}
                    placeholder="请选择产品"
                    value={selectedProductId ?? undefined}
                    onChange={(v) => setSelectedProductId(v ?? null)}
                    options={products.map((p) => ({ value: p.id, label: p.name }))}
                    filterOption={(input, option) =>
                      (option?.label as string)?.toLowerCase().includes(input.toLowerCase())
                    }
                  />
                </Space>
                <Card style={{ marginBottom: 16 }}>
                  <TrendChart series={buildPriceTrendSeries(priceTrendPoints)} loading={priceTrendLoading} height={300} />
                </Card>
                <Table
                  size="small"
                  rowKey={(record, index) => `${record.capturedAt}-${index}`}
                  columns={priceRecordColumns}
                  dataSource={priceTrendPoints}
                  loading={priceTrendLoading}
                  locale={{ emptyText: <Empty description={selectedProductId == null ? '请先选择产品' : '暂无价格记录'} /> }}
                />
              </div>
            )
          },
          {
            key: '4',
            label: '价格异动',
            children: (
              <div>
                <Card title="最近一轮查价" style={{ marginBottom: 16 }} loading={watchStatus == null}>
                  {watchStatus && (
                    <Space direction="vertical" size={4}>
                      <span>
                        状态：{watchStatus.running ? '进行中' : '空闲'}
                        {watchStatus.lastRunAt && `，上次运行：${dayjs(watchStatus.lastRunAt).format('YYYY-MM-DD HH:mm')}`}
                      </span>
                      {watchStatus.lastSummary ? (
                        <span>
                          检查 {watchStatus.lastSummary.checked} 个，更新 {watchStatus.lastSummary.updated} 个，失败{' '}
                          {watchStatus.lastSummary.failed} 个，跳过 {watchStatus.lastSummary.skipped} 个，异动{' '}
                          {watchStatus.lastSummary.alerts.length} 项
                        </span>
                      ) : (
                        <span>尚未运行过查价</span>
                      )}
                    </Space>
                  )}
                </Card>
                <Row gutter={16}>
                <Col span={12}>
                  <Card title="涨幅榜">
                    <Table
                      size="small"
                      rowKey="productId"
                      columns={priceChangeColumns}
                      dataSource={gainers}
                      loading={priceChangesLoading}
                      pagination={false}
                      onRow={rowClickToTrend}
                      locale={{ emptyText: <Empty description="暂无涨价记录" /> }}
                    />
                  </Card>
                </Col>
                <Col span={12}>
                  <Card title="跌幅榜">
                    <Table
                      size="small"
                      rowKey="productId"
                      columns={priceChangeColumns}
                      dataSource={losers}
                      loading={priceChangesLoading}
                      pagination={false}
                      onRow={rowClickToTrend}
                      locale={{ emptyText: <Empty description="暂无跌价记录" /> }}
                    />
                  </Card>
                </Col>
                </Row>
              </div>
            )
          }
        ]}
      />
    </div>
  );
}
