import React, { useEffect, useRef } from 'react';
import * as echarts from 'echarts/core';
import { LineChart } from 'echarts/charts';
import { GridComponent, TooltipComponent, LegendComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { Empty, Spin } from 'antd';
import { CHART_PALETTE } from '../theme';

// 按需注册：仅折线图 + 直角坐标系/提示/图例组件 + Canvas 渲染器，控制打包体积。
echarts.use([LineChart, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer]);

export interface TrendChartSeries {
  name: string;
  /** [x, y] 二元组；x 为 ISO 日期/日期时间字符串（时间轴），y 为数值（如元、分）。 */
  data: [string, number][];
}

interface TrendChartProps {
  series: TrendChartSeries[];
  loading?: boolean;
  height?: number;
}

/** 通用折线趋势图封装：ResizeObserver 自适应容器尺寸，卸载时 dispose 释放实例。 */
export default function TrendChart({ series, loading = false, height = 300 }: TrendChartProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  // 初始化/销毁：容器 DOM 变化时才重建
  useEffect(() => {
    if (!containerRef.current) return undefined;
    const chart = echarts.init(containerRef.current);
    chartRef.current = chart;

    const resizeObserver = new ResizeObserver(() => chart.resize());
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  // 数据变化时更新配置
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.setOption(
      {
        color: CHART_PALETTE,
        tooltip: { trigger: 'axis' },
        legend: series.length > 1 ? { data: series.map((s) => s.name) } : undefined,
        grid: { left: 56, right: 24, top: series.length > 1 ? 36 : 16, bottom: 32, containLabel: true },
        xAxis: { type: 'time' },
        yAxis: { type: 'value' },
        series: series.map((s) => ({ name: s.name, type: 'line', data: s.data, showSymbol: s.data.length <= 30 }))
      },
      true
    );
  }, [series]);

  const hasData = series.some((s) => s.data.length > 0);

  return (
    <div style={{ position: 'relative', height }}>
      {loading && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1 }}>
          <Spin />
        </div>
      )}
      {!loading && !hasData && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Empty description="暂无数据" />
        </div>
      )}
      <div ref={containerRef} style={{ width: '100%', height: '100%', visibility: hasData && !loading ? 'visible' : 'hidden' }} />
    </div>
  );
}
