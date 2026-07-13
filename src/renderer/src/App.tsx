import React from 'react';
import { Layout, Menu, Typography } from 'antd';
import type { MenuProps } from 'antd';
import {
  AppstoreOutlined,
  ShopOutlined,
  ProjectOutlined,
  SettingOutlined,
  ImportOutlined,
  ProfileOutlined,
  ApartmentOutlined,
  QuestionCircleOutlined,
  BuildOutlined,
  FileExcelOutlined,
  FileImageOutlined,
  LineChartOutlined
} from '@ant-design/icons';
import { Link, Route, Routes, useLocation } from 'react-router-dom';
import Suppliers from './pages/Suppliers';
import Products from './pages/Products';
import Projects from './pages/Projects';
import ProjectEditor from './pages/ProjectEditor';
import EstimateNorms from './pages/EstimateNorms';
import Rules from './pages/Rules';
import Templates from './pages/Templates';
import ExportTemplates from './pages/ExportTemplates';
import Analytics from './pages/Analytics';
import Settings from './pages/Settings';
import ImportWizard from './pages/ImportWizard';
import DrawingWizard from './pages/DrawingWizard';
import Help from './pages/Help';

const { Sider, Content } = Layout;

const menuItems: MenuProps['items'] = [
  { key: '/', icon: <AppstoreOutlined />, label: <Link to="/">产品库</Link> },
  { key: '/suppliers', icon: <ShopOutlined />, label: <Link to="/suppliers">供应商</Link> },
  { key: '/projects', icon: <ProjectOutlined />, label: <Link to="/projects">项目报价</Link> },
  { key: '/estimate-norms', icon: <ProfileOutlined />, label: <Link to="/estimate-norms">概算指标</Link> },
  { key: '/rules', icon: <ApartmentOutlined />, label: <Link to="/rules">联动规则</Link> },
  { key: '/templates', icon: <BuildOutlined />, label: <Link to="/templates">项目模板</Link> },
  { key: '/export-templates', icon: <FileExcelOutlined />, label: <Link to="/export-templates">导出模板</Link> },
  { key: '/analytics', icon: <LineChartOutlined />, label: <Link to="/analytics">统计分析</Link> },
  { key: '/import', icon: <ImportOutlined />, label: <Link to="/import">报价单导入</Link> },
  { key: '/drawing', icon: <FileImageOutlined />, label: <Link to="/drawing">图纸识别</Link> },
  { key: '/settings', icon: <SettingOutlined />, label: <Link to="/settings">设置</Link> },
  { key: '/help', icon: <QuestionCircleOutlined />, label: <Link to="/help">帮助</Link> }
];

export default function App(): React.JSX.Element {
  const location = useLocation();
  const onImportPage = location.pathname === '/import';
  const onDrawingPage = location.pathname === '/drawing';

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider theme="light" width={200}>
        <div style={{ height: 48, margin: 16 }}>
          <Typography.Text strong>AI 报价单</Typography.Text>
        </div>
        <Menu mode="inline" selectedKeys={[location.pathname]} items={menuItems} />
      </Sider>
      <Layout>
        <Content style={{ padding: 24 }}>
          <Routes>
            <Route path="/" element={<Products />} />
            <Route path="/suppliers" element={<Suppliers />} />
            <Route path="/projects" element={<Projects />} />
            <Route path="/projects/:id" element={<ProjectEditor />} />
            <Route path="/estimate-norms" element={<EstimateNorms />} />
            <Route path="/rules" element={<Rules />} />
            <Route path="/templates" element={<Templates />} />
            <Route path="/export-templates" element={<ExportTemplates />} />
            <Route path="/analytics" element={<Analytics />} />
            {/* /import 由下方常驻挂载的 ImportWizard 渲染，此处仅占位以避免落入通配路由 */}
            <Route path="/import" element={null} />
            {/* /drawing 由下方常驻挂载的 DrawingWizard 渲染，此处仅占位以避免落入通配路由 */}
            <Route path="/drawing" element={null} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/help" element={<Help />} />
            <Route path="*" element={<Products />} />
          </Routes>
          {/* 报价单导入向导常驻挂载：切换到其他页面时仅隐藏不卸载，识别结果与进度不丢失 */}
          <div style={{ display: onImportPage ? 'block' : 'none' }}>
            <ImportWizard />
          </div>
          {/* 图纸识别向导常驻挂载：切换到其他页面时仅隐藏不卸载，上传/识别结果不丢失 */}
          <div style={{ display: onDrawingPage ? 'block' : 'none' }}>
            <DrawingWizard />
          </div>
        </Content>
      </Layout>
    </Layout>
  );
}
