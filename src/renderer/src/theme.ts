import { theme as antdTheme } from 'antd';
import type { ThemeConfig } from 'antd';
import type React from 'react';

// 商务深蓝主题 token（见 docs/superpowers/specs/2026-07-11-ui-design-tokens.md §1）
export const theme: ThemeConfig = {
  // v6 默认算法即 defaultAlgorithm；此处显式声明，便于后续切换
  algorithm: antdTheme.defaultAlgorithm,
  token: {
    // —— 主色系：商务深蓝 ——
    colorPrimary: '#1654A6', // 应用图标色，主色
    colorInfo: '#1654A6', // Info 与主色同族，保持克制统一

    // —— 语义色：与深蓝和谐、饱和度略收敛的一组 ——
    colorSuccess: '#2E8B57', // 深海绿（偏稳重，非荧光绿）
    colorWarning: '#D48806', // 琥珀金（对应现有 gold Tag 语义）
    colorError: '#C0392B', // 砖红（比默认 #ff4d4f 更沉稳，配深蓝）

    // —— 圆角体系 ——
    borderRadius: 6, // 基准圆角（按钮/输入/卡片默认）

    // —— 字号体系 ——
    fontSize: 14, // 正文基准

    // —— 中性色（收敛硬编码灰）——
    colorBgLayout: '#f5f5f5', // 页面/代码块底色统一
    colorBorderSecondary: '#f0f0f0' // 分隔线/面板描边统一
  },
  components: {
    Layout: {
      siderBg: '#ffffff', // 侧栏保持浅色（现为 theme="light"）
      bodyBg: '#f5f5f5' // 内容区底色，衬托白色面板
    },
    Menu: {
      itemSelectedBg: '#e8f0fb', // 选中项底色＝主色 8% 淡染，替代默认 #e6f4ff
      itemSelectedColor: '#1654A6'
    },
    Table: {
      headerBg: '#f5f7fa', // 表头浅蓝灰，弱化默认灰
      borderColor: '#f0f0f0',
      cellPaddingBlockSM: 8 // small 表格行高统一
    },
    Card: {
      borderRadiusLG: 8, // 卡片/面板统一 8（见 §3 面板规范）
      paddingLG: 16
    },
    Modal: {
      borderRadiusLG: 8,
      titleFontSize: 16
    },
    Button: {
      borderRadius: 6,
      fontWeight: 400
    },
    Tag: {
      borderRadiusSM: 4
    }
  }
};

// echarts 系列色板：与主色同族，5–6 色（见 §1.4）
export const CHART_PALETTE = [
  '#1654A6', // 主色 深蓝
  '#3E7CC9', // 中蓝
  '#6FA8DC', // 浅蓝
  '#2E8B57', // 深海绿（＝colorSuccess，第二数据系列）
  '#D48806', // 琥珀金（＝colorWarning）
  '#8E7CC3' // 雾紫（收尾色，低饱和）
];

// 页内面板标准样式（见 §3.4），收敛重复内联样式
// #f0f0f0 与主题 colorBorderSecondary 一致，故视觉不变，只是去重
export const PANEL_STYLE: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #f0f0f0',
  borderRadius: 8,
  padding: 16
};

// 选中行高亮底色（主色淡染），与 Menu 选中一致（见 §3.5）
export const SELECTED_BG = '#e8f0fb';
