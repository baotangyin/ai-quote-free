import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Steps,
  Button,
  Upload,
  Image,
  Space,
  Typography,
  message,
  Radio,
  Input,
  InputNumber,
  Select,
  Card,
  Tag,
  Popconfirm,
  Result,
  Empty,
  Alert,
  Row,
  Col,
  Tooltip
} from 'antd';
import { InboxOutlined, DeleteOutlined } from '@ant-design/icons';
import { PANEL_STYLE } from '../theme';
import type { UploadProps } from 'antd';
import type {
  RecognizedRow,
  MatchResult,
  Project,
  Section,
  ProjectTypeTemplate,
  Product,
  ApplyDrawingSpace,
  ApplyDrawingItem
} from '../../../shared/api-types';
import { api } from '../api';
import { pdfToImages, imageFileToNormalizedJpeg } from '../pdfToImages';
import ProductPicker from '../components/ProductPicker';

const { Dragger } = Upload;

// ---------- 上传态图片 ----------
interface WizardImage {
  key: string;
  mediaType: 'image/jpeg';
  base64: string;
  /** 来源标注：文件名，PDF 附加"第N页" */
  sourceLabel: string;
}

// ---------- 核对态数据 ----------
interface WizardItem {
  key: string;
  name: string;
  category: string | null;
  size: string | null;
  qty: number;
  remark: string | null;
  match: MatchResult;
  /** 当前绑定的产品 id；null 表示手工行 */
  productId: number | null;
}

interface WizardSpace {
  key: string;
  name: string;
  items: WizardItem[];
}

const DWG_EXTS = ['.dwg', '.dxf'];
const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.webp'];

function extOf(name: string): string {
  const idx = name.lastIndexOf('.');
  return idx >= 0 ? name.slice(idx).toLowerCase() : '';
}

export default function DrawingWizard(): React.JSX.Element {
  const [currentStep, setCurrentStep] = useState(0);
  const keySeqRef = useRef(0);
  const nextKey = (prefix: string): string => `${prefix}-${++keySeqRef.current}`;
  // 序列令牌：重选文件/重置向导/开始新一轮识别或匹配时递增，用于丢弃过期的异步结果
  const wizardSeqRef = useRef(0);
  // 入口①（新建项目）已成功创建的项目 id；用于失败重试时跳过 projectsCreate，避免重复建项目
  const createdProjectIdRef = useRef<number | null>(null);

  // ---------- 基础数据 ----------
  const [productMap, setProductMap] = useState<Record<number, Product>>({});
  const loadProductMap = (): void => {
    api
      .productsList()
      .then((list) => {
        const map: Record<number, Product> = {};
        list.forEach((p) => {
          map[p.id] = p;
        });
        setProductMap(map);
      })
      .catch((err) => message.error(`加载产品库失败：${(err as Error).message}`));
  };

  // ---------- 第一步：选目标 ----------
  const [targetMode, setTargetMode] = useState<'new' | 'existing'>('new');
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectType, setNewProjectType] = useState<string | undefined>(undefined);
  const [templates, setTemplates] = useState<ProjectTypeTemplate[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [existingProjectId, setExistingProjectId] = useState<number | null>(null);
  const [sections, setSections] = useState<Section[]>([]);
  const [existingSectionId, setExistingSectionId] = useState<number | null>(null);
  const [loadingSections, setLoadingSections] = useState(false);

  const loadStep0Data = (): void => {
    api.templatesList().then(setTemplates).catch(() => {});
    api
      .projectsList()
      .then((list) => {
        const sorted = [...list].sort((a, b) => {
          if (a.status === b.status) return 0;
          return a.status === 'draft' ? -1 : 1;
        });
        setProjects(sorted);
      })
      .catch((err) => message.error(`加载项目列表失败：${(err as Error).message}`));
  };

  useEffect(() => {
    loadStep0Data();
    loadProductMap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handlePickExistingProject = (projectId: number): void => {
    setExistingProjectId(projectId);
    setExistingSectionId(null);
    setSections([]);
    setLoadingSections(true);
    api
      .sectionsList(projectId)
      .then(setSections)
      .catch((err) => message.error(`加载板块列表失败：${(err as Error).message}`))
      .finally(() => setLoadingSections(false));
  };

  const targetValid = (): boolean => {
    if (targetMode === 'new') return newProjectName.trim().length > 0;
    return existingProjectId != null && existingSectionId != null;
  };

  // ---------- 第二步：上传 ----------
  const [images, setImages] = useState<WizardImage[]>([]);
  // 并发上传计数：每个文件处理开始 +1、结束 -1，避免多文件并发时先完成的文件把状态误置为「未上传」
  const [pendingUploads, setPendingUploads] = useState(0);
  const uploading = pendingUploads > 0;

  const resetDownstream = (): void => {
    wizardSeqRef.current++; // 使正在进行中的识别/匹配过期
    setRecognizing(false);
    setMatching(false);
    setRecognizeDone(false);
    setFailedImages(0);
    setRecognizeErrors([]);
    setSpaceCount(0);
    setItemCount(0);
    setWizardSpaces([]);
    matchedOnceRef.current = false;
    setApplyResult(null);
  };

  const handleBeforeUpload: UploadProps['beforeUpload'] = (file) => {
    const ext = extOf(file.name);
    if (DWG_EXTS.includes(ext)) {
      message.warning('dwg 请先从 CAD 导出 PDF 或图片后导入');
      return Upload.LIST_IGNORE;
    }
    if (ext !== '.pdf' && !IMAGE_EXTS.includes(ext)) {
      message.warning('仅支持 PDF 或 png/jpg/webp 图片');
      return Upload.LIST_IGNORE;
    }
    resetDownstream();
    setPendingUploads((n) => n + 1);
    const run = async (): Promise<void> => {
      try {
        if (ext === '.pdf') {
          const pages = await pdfToImages(file);
          setImages((prev) => [
            ...prev,
            ...pages.map((p, idx) => ({
              key: nextKey('img'),
              mediaType: p.mediaType,
              base64: p.base64,
              sourceLabel: `${file.name} 第${idx + 1}页`
            }))
          ]);
        } else {
          const img = await imageFileToNormalizedJpeg(file);
          setImages((prev) => [
            ...prev,
            { key: nextKey('img'), mediaType: img.mediaType, base64: img.base64, sourceLabel: file.name }
          ]);
        }
      } catch (err) {
        message.error(`处理文件「${file.name}」失败：${(err as Error).message}`);
      } finally {
        setPendingUploads((n) => n - 1);
      }
    };
    run();
    return false; // 阻止 antd 自带上传行为，改由上方逻辑处理
  };

  const removeImage = (key: string): void => {
    resetDownstream();
    setImages((prev) => prev.filter((i) => i.key !== key));
  };

  // ---------- 第三步：识别 + 匹配 ----------
  const [recognizing, setRecognizing] = useState(false);
  const [matching, setMatching] = useState(false);
  const [recognizeDone, setRecognizeDone] = useState(false);
  const [failedImages, setFailedImages] = useState(0);
  const [recognizeErrors, setRecognizeErrors] = useState<string[]>([]);
  const [spaceCount, setSpaceCount] = useState(0);
  const [itemCount, setItemCount] = useState(0);
  const [wizardSpaces, setWizardSpaces] = useState<WizardSpace[]>([]);
  const matchedOnceRef = useRef(false);

  const runRecognizeAndMatch = async (): Promise<void> => {
    if (images.length === 0) {
      message.error('请先上传至少一张图纸');
      return;
    }
    const seq = ++wizardSeqRef.current;
    setRecognizing(true);
    setRecognizeDone(false);
    setWizardSpaces([]);
    matchedOnceRef.current = false;
    try {
      const result = await api.importRecognizeDrawing({
        images: images.map((i) => ({ mediaType: i.mediaType, base64: i.base64 }))
      });
      if (seq !== wizardSeqRef.current) return; // 已过期，丢弃

      const totalItems = result.spaces.reduce((sum, s) => sum + s.items.length, 0);
      setSpaceCount(result.spaces.length);
      setItemCount(totalItems);
      setFailedImages(result.failedImages);
      setRecognizeErrors(result.errors ?? []);
      setRecognizing(false);
      setRecognizeDone(true);

      if (result.spaces.length === 0) {
        setWizardSpaces([]);
        return;
      }

      // 将 DrawingItem 展平为 RecognizedRow，记录 (spaceIdx, itemIdx) 以便匹配结果回填分组
      const rows: RecognizedRow[] = [];
      const positions: { spaceIdx: number; itemIdx: number }[] = [];
      result.spaces.forEach((space, spaceIdx) => {
        space.items.forEach((item, itemIdx) => {
          rows.push({
            categories: [item.category, item.size].filter((v): v is string => !!v),
            name: item.name,
            brand: null,
            model: null,
            params: null,
            unit: '台',
            dims: item.size,
            priceCents: 0,
            options: [],
            remark: item.remark,
            confidence: 1,
            power220W: null,
            power380W: null,
            rackU: null,
            seqPowerPorts: null,
            netPorts: null,
            comPorts: null
          });
          positions.push({ spaceIdx, itemIdx });
        });
      });

      matchedOnceRef.current = true;
      setMatching(true);
      loadProductMap(); // 刷新产品库，确保命中产品名称正确显示
      const matched = await api.importMatch({ rows });
      if (seq !== wizardSeqRef.current) return; // 已过期，丢弃

      const spacesOut: WizardSpace[] = result.spaces.map((space) => ({
        key: nextKey('space'),
        name: space.name,
        items: []
      }));
      matched.forEach((row, i) => {
        const { spaceIdx } = positions[i];
        const source = result.spaces[spaceIdx].items[positions[i].itemIdx];
        spacesOut[spaceIdx].items.push({
          key: nextKey('item'),
          name: row.name,
          category: source.category,
          size: source.size,
          qty: source.qty,
          remark: row.remark,
          match: row.match,
          productId: row.match.kind === 'existing' ? row.match.productId : null
        });
      });
      setWizardSpaces(spacesOut);
      setMatching(false);
    } catch (err) {
      if (seq !== wizardSeqRef.current) return;
      setRecognizing(false);
      setMatching(false);
      message.error(`识别失败：${(err as Error).message}`);
    }
  };

  // ---------- 第四步：核对 ----------
  const renameSpace = (spaceKey: string, name: string): void => {
    const trimmed = name.trim();
    if (!trimmed) {
      message.error('空间名不能为空');
      return;
    }
    setWizardSpaces((prev) => prev.map((s) => (s.key === spaceKey ? { ...s, name: trimmed } : s)));
  };

  const deleteSpace = (spaceKey: string): void => {
    setWizardSpaces((prev) => prev.filter((s) => s.key !== spaceKey));
  };

  const updateItem = (spaceKey: string, itemKey: string, patch: Partial<WizardItem>): void => {
    setWizardSpaces((prev) =>
      prev.map((s) =>
        s.key !== spaceKey
          ? s
          : { ...s, items: s.items.map((it) => (it.key === itemKey ? { ...it, ...patch } : it)) }
      )
    );
  };

  const deleteItem = (spaceKey: string, itemKey: string): void => {
    setWizardSpaces((prev) =>
      prev.map((s) => (s.key !== spaceKey ? s : { ...s, items: s.items.filter((it) => it.key !== itemKey) }))
    );
  };

  // ---------- 核对：换绑弹窗 ----------
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerTarget, setPickerTarget] = useState<{ spaceKey: string; itemKey: string } | null>(null);

  const openPicker = (spaceKey: string, itemKey: string): void => {
    setPickerTarget({ spaceKey, itemKey });
    setPickerOpen(true);
  };

  const closePicker = (): void => {
    setPickerOpen(false);
    setPickerTarget(null);
  };

  const handlePick = (product: Product): void => {
    if (!pickerTarget) return;
    updateItem(pickerTarget.spaceKey, pickerTarget.itemKey, {
      productId: product.id,
      match: { kind: 'existing', productId: product.id }
    });
  };

  const setManual = (spaceKey: string, itemKey: string): void => {
    updateItem(spaceKey, itemKey, { productId: null, match: { kind: 'new' } });
  };

  const totalItemCount = useMemo(() => wizardSpaces.reduce((sum, s) => sum + s.items.length, 0), [wizardSpaces]);

  // ---------- 第五步：生成 ----------
  const [generating, setGenerating] = useState(false);
  const [applyResult, setApplyResult] = useState<{ spaces: number; items: number; projectId: number | null } | null>(
    null
  );

  const buildApplySpaces = (): ApplyDrawingSpace[] =>
    wizardSpaces.map((s) => ({
      name: s.name,
      items: s.items.map(
        (it): ApplyDrawingItem => ({
          name: it.name,
          qty: it.qty,
          remark: it.remark,
          productId: it.productId
        })
      )
    }));

  const handleGenerate = async (): Promise<void> => {
    if (wizardSpaces.length === 0 || totalItemCount === 0) {
      message.error('没有可生成的空间/设备');
      return;
    }
    setGenerating(true);
    try {
      const spaces = buildApplySpaces();
      if (targetMode === 'existing') {
        if (existingSectionId == null) {
          message.error('请先在第一步选择板块');
          setGenerating(false);
          return;
        }
        try {
          const result = await api.importApplyDrawing({ sectionId: existingSectionId, spaces });
          setApplyResult({ ...result, projectId: existingProjectId });
          message.success('生成完成');
        } catch (err) {
          message.error(`生成失败：${(err as Error).message}`);
        }
        return;
      }

      // 入口①：先建项目，任一步失败立即中断，不继续 apply
      // 若此前已成功建过项目（重试场景），复用已建项目，避免重复 projectsCreate
      let project: Project;
      if (createdProjectIdRef.current != null) {
        try {
          const existing = await api.projectsGet(createdProjectIdRef.current);
          if (!existing) throw new Error('项目已不存在，请重置向导后重试');
          project = existing;
        } catch (err) {
          message.error(`加载已建项目失败：${(err as Error).message}`);
          setGenerating(false);
          return;
        }
      } else {
        try {
          project = await api.projectsCreate({ name: newProjectName.trim(), projectType: newProjectType ?? null });
          createdProjectIdRef.current = project.id;
        } catch (err) {
          message.error(`新建项目失败：${(err as Error).message}`);
          setGenerating(false);
          return;
        }
      }

      let sectionList: Section[];
      try {
        sectionList = await api.sectionsList(project.id);
      } catch (err) {
        message.error(`项目「${project.name}」已建立，但加载其板块列表失败：${(err as Error).message}，请到项目编辑器手动生成`);
        setGenerating(false);
        return;
      }

      let targetSection = sectionList.find((s) => s.isHardware) ?? sectionList[0] ?? null;
      if (!targetSection) {
        try {
          targetSection = await api.sectionsCreate({ projectId: project.id, name: '多媒体硬件', isHardware: true });
        } catch (err) {
          message.error(`项目「${project.name}」已建立，但创建板块失败：${(err as Error).message}，请到项目编辑器手动生成`);
          setGenerating(false);
          return;
        }
      }

      try {
        const result = await api.importApplyDrawing({ sectionId: targetSection.id, spaces });
        setApplyResult({ ...result, projectId: project.id });
        createdProjectIdRef.current = null;
        message.success('生成完成');
      } catch (err) {
        message.error(`项目「${project.name}」已建立，但生成清单失败：${(err as Error).message}，请到项目编辑器手动核对`);
      }
    } finally {
      setGenerating(false);
    }
  };

  const resetWizard = (): void => {
    wizardSeqRef.current++;
    createdProjectIdRef.current = null;
    setCurrentStep(0);
    setTargetMode('new');
    setNewProjectName('');
    setNewProjectType(undefined);
    setExistingProjectId(null);
    setSections([]);
    setExistingSectionId(null);
    setImages([]);
    resetDownstream();
    setApplyResult(null);
    loadStep0Data();
    loadProductMap();
  };

  // ---------- 步骤跳转 ----------
  const canGoNext = (): boolean => {
    if (currentStep === 0) return targetValid();
    if (currentStep === 1) return images.length > 0 && !uploading;
    if (currentStep === 2) return recognizeDone && !recognizing && !matching;
    if (currentStep === 3) return true;
    return false;
  };

  const goNext = (): void => setCurrentStep((s) => Math.min(4, s + 1));
  const goPrev = (): void => setCurrentStep((s) => Math.max(0, s - 1));

  const projectOptions = projects.map((p) => ({
    value: p.id,
    label: `${p.name}${p.status === 'draft' ? '（草稿）' : ''}`
  }));

  return (
    <div>
      <Typography.Title level={4} style={{ marginTop: 0, marginBottom: 16 }}>图纸识别</Typography.Title>

      <Steps
        current={currentStep}
        style={{ marginBottom: 24 }}
        items={[{ title: '选目标' }, { title: '上传' }, { title: '识别' }, { title: '核对' }, { title: '生成' }]}
      />

      <div style={{ ...PANEL_STYLE, minHeight: 320 }}>
        {currentStep === 0 && (
          <Space direction="vertical" size="large" style={{ width: '100%' }}>
            <Radio.Group
              value={targetMode}
              onChange={(e) => {
                createdProjectIdRef.current = null;
                setTargetMode(e.target.value);
              }}
            >
              <Radio value="new">新建项目</Radio>
              <Radio value="existing">导入到已有项目</Radio>
            </Radio.Group>

            {targetMode === 'new' ? (
              <Space direction="vertical">
                <Space>
                  <Typography.Text>项目名称：</Typography.Text>
                  <Input
                    style={{ width: 260 }}
                    value={newProjectName}
                    onChange={(e) => {
                      createdProjectIdRef.current = null;
                      setNewProjectName(e.target.value);
                    }}
                    placeholder="请输入新项目名称"
                  />
                </Space>
                <Space>
                  <Typography.Text>项目类型：</Typography.Text>
                  <Select
                    allowClear
                    style={{ width: 260 }}
                    placeholder="可不选"
                    value={newProjectType}
                    onChange={(v) => {
                      createdProjectIdRef.current = null;
                      setNewProjectType(v);
                    }}
                    options={templates.map((t) => ({ value: t.projectType, label: t.projectType }))}
                  />
                </Space>
              </Space>
            ) : (
              <Space direction="vertical">
                <Space>
                  <Typography.Text>项目：</Typography.Text>
                  <Select
                    style={{ width: 260 }}
                    placeholder="请选择项目"
                    value={existingProjectId ?? undefined}
                    onChange={handlePickExistingProject}
                    options={projectOptions}
                  />
                </Space>
                <Space>
                  <Typography.Text>板块：</Typography.Text>
                  <Select
                    style={{ width: 260 }}
                    placeholder="请选择板块"
                    loading={loadingSections}
                    disabled={existingProjectId == null}
                    value={existingSectionId ?? undefined}
                    onChange={(v) => setExistingSectionId(v)}
                    options={sections.map((s) => ({ value: s.id, label: s.name }))}
                  />
                </Space>
              </Space>
            )}
          </Space>
        )}

        {currentStep === 1 && (
          <div>
            <Dragger
              multiple
              showUploadList={false}
              accept=".pdf,.png,.jpg,.jpeg,.webp,.dwg,.dxf"
              beforeUpload={handleBeforeUpload}
              disabled={uploading}
            >
              <p className="ant-upload-drag-icon">
                <InboxOutlined />
              </p>
              <p className="ant-upload-text">点击或拖拽 PDF / 图纸图片到此处上传</p>
              <p className="ant-upload-hint">支持 PDF、png/jpg/webp；PDF 将逐页转为图片；dwg/dxf 暂不支持</p>
            </Dragger>
            {uploading && (
              <Typography.Text type="secondary" style={{ display: 'block', marginTop: 8 }}>
                正在处理文件…
              </Typography.Text>
            )}
            {images.length > 0 && (
              <Row gutter={[12, 12]} style={{ marginTop: 16 }}>
                {images.map((img) => (
                  <Col key={img.key}>
                    <div style={{ textAlign: 'center', width: 140 }}>
                      <Image
                        width={140}
                        height={100}
                        style={{ objectFit: 'cover' }}
                        src={`data:${img.mediaType};base64,${img.base64}`}
                      />
                      <div style={{ fontSize: 12, marginTop: 4, wordBreak: 'break-all' }}>{img.sourceLabel}</div>
                      <Button type="link" danger size="small" icon={<DeleteOutlined />} onClick={() => removeImage(img.key)}>
                        删除
                      </Button>
                    </div>
                  </Col>
                ))}
              </Row>
            )}
          </div>
        )}

        {currentStep === 2 && (
          <div>
            <Space style={{ marginBottom: 16 }}>
              <Button type="primary" loading={recognizing || matching} onClick={runRecognizeAndMatch}>
                {recognizeDone ? '重新识别' : '开始识别'}
              </Button>
            </Space>
            {recognizing && <Typography.Text type="secondary">正在识别图纸…</Typography.Text>}
            {matching && <Typography.Text type="secondary">正在匹配已有产品…</Typography.Text>}
            {recognizeDone && !recognizing && (
              <Alert
                type={failedImages > 0 ? 'warning' : 'info'}
                showIcon
                message={`识别出 ${spaceCount} 个空间 ${itemCount} 台设备；${failedImages} 张图识别失败`}
                description={
                  recognizeErrors.length > 0 ? (
                    <Space>
                      <span>{recognizeErrors[0]}</span>
                      {recognizeErrors.length > 1 && (
                        <Tooltip
                          title={
                            <div>
                              {recognizeErrors.map((e, i) => (
                                <div key={i}>{e}</div>
                              ))}
                            </div>
                          }
                        >
                          <Typography.Link>查看全部 {recognizeErrors.length} 条</Typography.Link>
                        </Tooltip>
                      )}
                    </Space>
                  ) : undefined
                }
              />
            )}
          </div>
        )}

        {currentStep === 3 && (
          <div>
            <Typography.Paragraph type="secondary">
              空间名可编辑、可删；设备名称/数量/备注可编辑、可删；点击「匹配」标签可换绑产品或设为手工行。
            </Typography.Paragraph>
            {wizardSpaces.length === 0 ? (
              <Empty description="暂无可核对的空间，请返回上一步重新识别" />
            ) : (
              <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                {wizardSpaces.map((space) => (
                  <Card
                    key={space.key}
                    size="small"
                    title={
                      <Input
                        style={{ maxWidth: 260 }}
                        defaultValue={space.name}
                        onBlur={(e) => renameSpace(space.key, e.target.value)}
                      />
                    }
                    extra={
                      <Popconfirm title="确认删除该空间？" okText="确认" cancelText="取消" onConfirm={() => deleteSpace(space.key)}>
                        <Button type="link" danger icon={<DeleteOutlined />}>
                          删除空间
                        </Button>
                      </Popconfirm>
                    }
                  >
                    {space.items.length === 0 ? (
                      <Empty description="该空间下暂无设备" />
                    ) : (
                      <Space direction="vertical" style={{ width: '100%' }}>
                        {space.items.map((item) => {
                          const productName =
                            item.productId != null ? productMap[item.productId]?.name ?? `#${item.productId}` : null;
                          return (
                            <Row key={item.key} gutter={8} align="middle" wrap={false}>
                              <Col flex="200px">
                                <Input
                                  defaultValue={item.name}
                                  onBlur={(e) => {
                                    const val = e.target.value.trim();
                                    if (!val) {
                                      message.error('名称不能为空');
                                      return;
                                    }
                                    updateItem(space.key, item.key, { name: val });
                                  }}
                                />
                              </Col>
                              <Col flex="100px">
                                <InputNumber
                                  min={0.01}
                                  precision={2}
                                  style={{ width: '100%' }}
                                  value={item.qty}
                                  onChange={(v) => updateItem(space.key, item.key, { qty: v ?? item.qty })}
                                />
                              </Col>
                              <Col flex="160px">
                                <Input
                                  placeholder="备注"
                                  defaultValue={item.remark ?? ''}
                                  onBlur={(e) => updateItem(space.key, item.key, { remark: e.target.value.trim() || null })}
                                />
                              </Col>
                              <Col flex="auto">
                                <Space>
                                  {productName ? (
                                    <Tag color="blue" style={{ cursor: 'pointer' }} onClick={() => openPicker(space.key, item.key)}>
                                      关联：{productName}
                                    </Tag>
                                  ) : (
                                    <Tag style={{ cursor: 'pointer' }} onClick={() => openPicker(space.key, item.key)}>
                                      手工行
                                    </Tag>
                                  )}
                                  <Button type="link" size="small" onClick={() => openPicker(space.key, item.key)}>
                                    换绑
                                  </Button>
                                  {productName && (
                                    <Button type="link" size="small" onClick={() => setManual(space.key, item.key)}>
                                      设为手工行
                                    </Button>
                                  )}
                                </Space>
                              </Col>
                              <Col flex="40px">
                                <Popconfirm title="确认删除该行？" okText="确认" cancelText="取消" onConfirm={() => deleteItem(space.key, item.key)}>
                                  <Button type="link" danger icon={<DeleteOutlined />} />
                                </Popconfirm>
                              </Col>
                            </Row>
                          );
                        })}
                      </Space>
                    )}
                  </Card>
                ))}
              </Space>
            )}
          </div>
        )}

        {currentStep === 4 && (
          <div>
            {applyResult ? (
              <Result
                status="success"
                title="生成完成"
                subTitle={`共生成 ${applyResult.spaces} 个空间、${applyResult.items} 条清单行`}
                extra={[
                  applyResult.projectId != null ? (
                    <Link key="project" to={`/projects/${applyResult.projectId}`}>
                      <Button type="primary">去项目编辑器</Button>
                    </Link>
                  ) : null,
                  <Button key="reset" onClick={resetWizard}>
                    识别新图纸
                  </Button>
                ]}
              />
            ) : (
              <Space direction="vertical" size="large" style={{ width: '100%' }}>
                <Typography.Text>
                  即将生成 <Typography.Text strong>{wizardSpaces.length}</Typography.Text> 个空间、
                  <Typography.Text strong>{totalItemCount}</Typography.Text> 条设备清单行，目标：
                  {targetMode === 'new'
                    ? `新建项目「${newProjectName.trim() || '（未命名）'}」`
                    : `已有项目「${projects.find((p) => p.id === existingProjectId)?.name ?? ''}」/ 板块「${
                        sections.find((s) => s.id === existingSectionId)?.name ?? ''
                      }」`}
                </Typography.Text>
                <Button
                  type="primary"
                  loading={generating}
                  disabled={wizardSpaces.length === 0 || totalItemCount === 0}
                  onClick={handleGenerate}
                >
                  开始生成
                </Button>
              </Space>
            )}
          </div>
        )}
      </div>

      {currentStep < 4 && (
        <Space style={{ marginTop: 16 }}>
          <Button disabled={currentStep === 0 || recognizing || matching || uploading} onClick={goPrev}>
            上一步
          </Button>
          <Button type="primary" disabled={!canGoNext()} onClick={goNext}>
            下一步
          </Button>
        </Space>
      )}
      {currentStep === 4 && !applyResult && (
        <Space style={{ marginTop: 16 }}>
          <Button onClick={goPrev}>上一步</Button>
        </Space>
      )}

      <ProductPicker
        open={pickerOpen}
        spaceId={null}
        mode="pick"
        onClose={closePicker}
        onPick={handlePick}
      />
    </div>
  );
}
