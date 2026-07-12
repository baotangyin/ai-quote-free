import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Steps,
  Button,
  Table,
  Progress,
  Typography,
  Space,
  message,
  Tag,
  Select,
  Input,
  InputNumber,
  Popconfirm,
  Empty,
  Result,
  Alert,
  Switch,
  Tooltip,
  Modal
} from 'antd';
import { DeleteOutlined } from '@ant-design/icons';
import type {
  ImportBlock,
  RecognizedRow,
  MatchResult,
  CommitRow,
  Supplier,
  Product
} from '../../../shared/api-types';
import { api } from '../api';
import { yuanToCents, centsToYuan, fmtYuan } from '../money';
import { PANEL_STYLE } from '../theme';

interface WizardRow extends RecognizedRow {
  key: string;
  match: MatchResult;
  action: 'create' | 'updatePrice';
  productId?: number;
  /** 编辑被拒绝（无效值）时递增，用于强制重挂输入框回滚显示值 */
  editVersion: number;
}

interface FailedBlockInfo {
  label: string;
  error: string;
}

const blockKey = (b: ImportBlock): string => `${b.sheetName}::${b.blockIndex}`;

export default function ImportWizard(): React.JSX.Element {
  const [currentStep, setCurrentStep] = useState(0);
  const rowKeySeqRef = useRef(0);
  const nextRowKey = (): string => `row-${++rowKeySeqRef.current}`;
  // 序列令牌：重选文件/重置向导/开始新一轮识别或匹配时递增，用于丢弃过期的异步结果
  const wizardSeqRef = useRef(0);

  // ---------- 基础数据 ----------
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [productMap, setProductMap] = useState<Record<number, Product>>({});

  const loadRefData = (): void => {
    api
      .suppliersList()
      .then(setSuppliers)
      .catch((err) => message.error(`加载供应商列表失败：${(err as Error).message}`));
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

  useEffect(() => {
    loadRefData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- 第一步：选文件 ----------
  const [filePath, setFilePath] = useState<string | null>(null);
  const [blocks, setBlocks] = useState<ImportBlock[]>([]);
  const [selectedBlockKeys, setSelectedBlockKeys] = useState<React.Key[]>([]);
  const [parsing, setParsing] = useState(false);

  const handlePickFile = async (): Promise<void> => {
    try {
      const path = await api.dialogPickFile();
      if (!path) return;
      wizardSeqRef.current++; // 使正在进行中的识别/匹配过期
      setFilePath(path);
      setParsing(true);
      const result = await api.importParse({ filePath: path });
      setBlocks(result);
      setSelectedBlockKeys(result.map(blockKey));
      // 重置后续步骤的产出，避免选择新文件后残留旧数据
      setRecognizing(false);
      setMatching(false);
      setRecognizeDone(false);
      setRecognizedRows([]);
      setWizardRows([]);
      matchedOnceRef.current = false;
      setCommitResult(null);
    } catch (err) {
      message.error(`解析文件失败：${(err as Error).message}`);
    } finally {
      setParsing(false);
    }
  };

  const blockColumns = [
    { title: 'Sheet 名', dataIndex: 'sheetName', key: 'sheetName' },
    { title: '块序号', key: 'blockIndex', render: (_: unknown, b: ImportBlock) => b.blockIndex + 1 },
    { title: '行数', dataIndex: 'rows', key: 'rows' },
    { title: '列数', dataIndex: 'cols', key: 'cols' }
  ];

  // ---------- 第二步：识别 ----------
  const [recognizing, setRecognizing] = useState(false);
  const [recognizeDone, setRecognizeDone] = useState(false);
  const [progressDone, setProgressDone] = useState(0);
  const [progressTotal, setProgressTotal] = useState(0);
  const [progressLabel, setProgressLabel] = useState('');
  const [recognizedRows, setRecognizedRows] = useState<RecognizedRow[]>([]);
  const [droppedTotal, setDroppedTotal] = useState(0);
  const [failedChunksTotal, setFailedChunksTotal] = useState(0);
  const [truncatedChunksTotal, setTruncatedChunksTotal] = useState(0);
  const [failedBlocks, setFailedBlocks] = useState<FailedBlockInfo[]>([]);

  const runRecognize = async (): Promise<void> => {
    const targets = blocks.filter((b) => selectedBlockKeys.includes(blockKey(b)));
    if (targets.length === 0) {
      message.error('请至少勾选一个块');
      return;
    }
    const seq = ++wizardSeqRef.current;
    setRecognizing(true);
    setRecognizeDone(false);
    setProgressDone(0);
    setProgressTotal(targets.length);
    setProgressLabel('');

    const allRows: RecognizedRow[] = [];
    let dropped = 0;
    let failedChunks = 0;
    let truncatedChunks = 0;
    const failed: FailedBlockInfo[] = [];

    for (const block of targets) {
      const label = `${block.sheetName}（第 ${block.blockIndex + 1} 块）`;
      setProgressLabel(label);
      try {
        const res = await api.importRecognize({ sheetName: block.sheetName, grid: block.grid });
        if (seq !== wizardSeqRef.current) return; // 已被更新的操作覆盖，丢弃过期结果
        allRows.push(...res.rows);
        dropped += res.dropped;
        failedChunks += res.failedChunks;
        truncatedChunks += res.truncatedChunks;
      } catch (err) {
        if (seq !== wizardSeqRef.current) return;
        failed.push({ label, error: (err as Error).message });
      }
      if (seq !== wizardSeqRef.current) return;
      setProgressDone((d) => d + 1);
    }

    if (seq !== wizardSeqRef.current) return;
    setRecognizedRows(allRows);
    setDroppedTotal(dropped);
    setFailedChunksTotal(failedChunks);
    setTruncatedChunksTotal(truncatedChunks);
    setFailedBlocks(failed);
    setRecognizing(false);
    setRecognizeDone(true);
    matchedOnceRef.current = false; // 允许重新识别后重新匹配
  };

  // ---------- 第三步：核对（含 import:match） ----------
  const [wizardRows, setWizardRows] = useState<WizardRow[]>([]);
  const [matching, setMatching] = useState(false);
  const matchedOnceRef = useRef(false);

  const runMatch = async (): Promise<void> => {
    const seq = ++wizardSeqRef.current;
    loadRefData(); // 重新拉取产品/供应商，确保命中新建产品时名称正确显示
    setMatching(true);
    try {
      const matched = await api.importMatch({ rows: recognizedRows });
      if (seq !== wizardSeqRef.current) return; // 已被更新的操作覆盖，丢弃过期结果
      const rows: WizardRow[] = matched.map((r) => ({
        ...r,
        key: nextRowKey(),
        match: r.match,
        action: r.match.kind === 'existing' ? 'updatePrice' : 'create',
        productId: r.match.kind === 'existing' ? r.match.productId : undefined,
        editVersion: 0
      }));
      setWizardRows(rows);
    } catch (err) {
      if (seq !== wizardSeqRef.current) return;
      message.error(`匹配已有产品失败：${(err as Error).message}`);
    } finally {
      if (seq === wizardSeqRef.current) setMatching(false);
    }
  };

  useEffect(() => {
    if (currentStep === 2 && recognizeDone && !matchedOnceRef.current) {
      matchedOnceRef.current = true;
      runMatch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStep, recognizeDone]);

  const updateRow = (key: string, patch: Partial<RecognizedRow>): void => {
    setWizardRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch, confidence: 1 } : r)));
  };

  /** 编辑被拒绝（无效值）时调用：不改数据，仅递增 editVersion 强制重挂输入框，使显示回滚到原值 */
  const bumpEditVersion = (key: string): void => {
    setWizardRows((prev) => prev.map((r) => (r.key === key ? { ...r, editVersion: r.editVersion + 1 } : r)));
  };

  const deleteRow = (key: string): void => {
    setWizardRows((prev) => prev.filter((r) => r.key !== key));
  };

  // ---------- 核对：参数弹窗编辑 ----------
  const [paramsModalOpen, setParamsModalOpen] = useState(false);
  const [paramsModalKey, setParamsModalKey] = useState<string | null>(null);
  const [paramsModalValue, setParamsModalValue] = useState('');

  const openParamsModal = (r: WizardRow): void => {
    setParamsModalKey(r.key);
    setParamsModalValue(r.params ?? '');
    setParamsModalOpen(true);
  };

  const closeParamsModal = (): void => {
    setParamsModalOpen(false);
    setParamsModalKey(null);
    setParamsModalValue('');
  };

  const saveParamsModal = (): void => {
    if (paramsModalKey) {
      const val = paramsModalValue.trim();
      updateRow(paramsModalKey, { params: val || null });
    }
    closeParamsModal();
  };

  const toggleAction = (key: string): void => {
    setWizardRows((prev) =>
      prev.map((r) => {
        if (r.key !== key || r.match.kind !== 'existing') return r;
        return { ...r, action: r.action === 'updatePrice' ? 'create' : 'updatePrice' };
      })
    );
  };

  const makeTextBlurHandler = (key: string, field: 'name' | 'unit') =>
    (e: React.FocusEvent<HTMLInputElement>): void => {
      const val = e.target.value.trim();
      if (!val) {
        message.error('该字段不能为空');
        bumpEditVersion(key);
        return;
      }
      updateRow(key, { [field]: val } as Partial<RecognizedRow>);
    };

  /** 分类：以逗号（中/英文）分隔的文本编辑多分类标签，至少保留一个。 */
  const makeCategoriesBlurHandler = (key: string) =>
    (e: React.FocusEvent<HTMLInputElement>): void => {
      const cats = e.target.value
        .split(/[,，]/)
        .map((c) => c.trim())
        .filter(Boolean);
      if (cats.length === 0) {
        message.error('分类不能为空');
        bumpEditVersion(key);
        return;
      }
      updateRow(key, { categories: cats });
    };

  const makeNullableTextBlurHandler = (key: string, field: 'brand' | 'model' | 'dims' | 'remark') =>
    (e: React.FocusEvent<HTMLInputElement>): void => {
      const val = e.target.value.trim();
      updateRow(key, { [field]: val || null } as Partial<RecognizedRow>);
    };

  /** 技术参数（U数/时序电源/网口/com口）：可空整数，非整数/负数视为无效并回滚显示值，不臆测。 */
  const makeNullableIntChangeHandler = (key: string, field: 'rackU' | 'seqPowerPorts' | 'netPorts' | 'comPorts') =>
    (v: number | null): void => {
      if (v === null) {
        updateRow(key, { [field]: null } as Partial<RecognizedRow>);
        return;
      }
      if (!Number.isInteger(v) || v < 0) {
        message.error('该字段必须是非负整数');
        bumpEditVersion(key);
        return;
      }
      updateRow(key, { [field]: v } as Partial<RecognizedRow>);
    };

  const handlePriceBlur = (record: WizardRow, e: React.FocusEvent<HTMLInputElement>): void => {
    const raw = e.target.value.replace(/,/g, '').trim();
    if (raw === '') {
      bumpEditVersion(record.key);
      return;
    }
    const val = Number(raw);
    if (Number.isNaN(val) || val < 0) {
      message.error('单价不能为负数');
      bumpEditVersion(record.key);
      return;
    }
    updateRow(record.key, { priceCents: yuanToCents(val) });
  };

  const reviewColumns = [
    {
      title: '名称',
      key: 'name',
      width: 160,
      render: (_: unknown, r: WizardRow) => (
        <Input
          key={`name-${r.key}-${r.editVersion}`}
          defaultValue={r.name}
          onBlur={makeTextBlurHandler(r.key, 'name')}
        />
      )
    },
    {
      title: '分类',
      key: 'categories',
      width: 140,
      render: (_: unknown, r: WizardRow) => (
        <Input
          key={`categories-${r.key}-${r.editVersion}`}
          defaultValue={r.categories.join(',')}
          placeholder="逗号分隔，如：LED屏,55寸"
          onBlur={makeCategoriesBlurHandler(r.key)}
        />
      )
    },
    {
      title: '品牌',
      key: 'brand',
      width: 100,
      render: (_: unknown, r: WizardRow) => (
        <Input key={`brand-${r.key}`} defaultValue={r.brand ?? ''} onBlur={makeNullableTextBlurHandler(r.key, 'brand')} />
      )
    },
    {
      title: '型号',
      key: 'model',
      width: 120,
      render: (_: unknown, r: WizardRow) => (
        <Input key={`model-${r.key}`} defaultValue={r.model ?? ''} onBlur={makeNullableTextBlurHandler(r.key, 'model')} />
      )
    },
    {
      title: '参数',
      key: 'params',
      width: 160,
      render: (_: unknown, r: WizardRow) => (
        <Space size={4}>
          {r.params ? (
            <Tooltip title={r.params}>
              <span
                style={{
                  display: 'inline-block',
                  maxWidth: 100,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  verticalAlign: 'bottom'
                }}
              >
                {r.params}
              </span>
            </Tooltip>
          ) : (
            <Typography.Text type="secondary">-</Typography.Text>
          )}
          <Button type="link" size="small" onClick={() => openParamsModal(r)}>
            编辑
          </Button>
        </Space>
      )
    },
    {
      title: '单位',
      key: 'unit',
      width: 80,
      render: (_: unknown, r: WizardRow) => (
        <Input
          key={`unit-${r.key}-${r.editVersion}`}
          defaultValue={r.unit}
          onBlur={makeTextBlurHandler(r.key, 'unit')}
        />
      )
    },
    {
      title: '规格',
      key: 'dims',
      width: 100,
      render: (_: unknown, r: WizardRow) => (
        <Input key={`dims-${r.key}`} defaultValue={r.dims ?? ''} onBlur={makeNullableTextBlurHandler(r.key, 'dims')} />
      )
    },
    {
      title: 'U数',
      key: 'rackU',
      width: 70,
      render: (_: unknown, r: WizardRow) => (
        <InputNumber
          key={`rackU-${r.key}-${r.editVersion}`}
          min={0}
          precision={0}
          style={{ width: 60 }}
          defaultValue={r.rackU ?? undefined}
          onChange={makeNullableIntChangeHandler(r.key, 'rackU')}
        />
      )
    },
    {
      title: '时序电源',
      key: 'seqPowerPorts',
      width: 80,
      render: (_: unknown, r: WizardRow) => (
        <InputNumber
          key={`seqPowerPorts-${r.key}-${r.editVersion}`}
          min={0}
          precision={0}
          style={{ width: 70 }}
          defaultValue={r.seqPowerPorts ?? undefined}
          onChange={makeNullableIntChangeHandler(r.key, 'seqPowerPorts')}
        />
      )
    },
    {
      title: '网口',
      key: 'netPorts',
      width: 70,
      render: (_: unknown, r: WizardRow) => (
        <InputNumber
          key={`netPorts-${r.key}-${r.editVersion}`}
          min={0}
          precision={0}
          style={{ width: 60 }}
          defaultValue={r.netPorts ?? undefined}
          onChange={makeNullableIntChangeHandler(r.key, 'netPorts')}
        />
      )
    },
    {
      title: 'com口',
      key: 'comPorts',
      width: 70,
      render: (_: unknown, r: WizardRow) => (
        <InputNumber
          key={`comPorts-${r.key}-${r.editVersion}`}
          min={0}
          precision={0}
          style={{ width: 60 }}
          defaultValue={r.comPorts ?? undefined}
          onChange={makeNullableIntChangeHandler(r.key, 'comPorts')}
        />
      )
    },
    {
      title: '单价（元）',
      key: 'priceCents',
      width: 110,
      render: (_: unknown, r: WizardRow) => (
        <InputNumber
          key={`price-${r.key}-${r.priceCents}-${r.editVersion}`}
          min={0}
          precision={2}
          defaultValue={centsToYuan(r.priceCents)}
          style={{ width: 100 }}
          onBlur={(e) => handlePriceBlur(r, e)}
        />
      )
    },
    {
      title: '选配项',
      key: 'options',
      width: 160,
      render: (_: unknown, r: WizardRow) =>
        r.options.length === 0 ? (
          '-'
        ) : (
          <Space size={[4, 4]} wrap>
            {r.options.map((o, idx) => (
              <Tag key={idx}>
                {o.name} +{fmtYuan(o.addPriceCents)}
              </Tag>
            ))}
          </Space>
        )
    },
    {
      title: '备注',
      key: 'remark',
      width: 120,
      render: (_: unknown, r: WizardRow) => (
        <Input key={`remark-${r.key}`} defaultValue={r.remark ?? ''} onBlur={makeNullableTextBlurHandler(r.key, 'remark')} />
      )
    },
    {
      title: '置信度',
      key: 'confidence',
      width: 90,
      render: (_: unknown, r: WizardRow) => (
        <Tag color={r.confidence < 0.7 ? 'gold' : 'default'}>{Math.round(r.confidence * 100)}%</Tag>
      )
    },
    {
      title: '匹配',
      key: 'match',
      width: 180,
      render: (_: unknown, r: WizardRow) => {
        const productName = r.productId != null ? productMap[r.productId]?.name ?? `#${r.productId}` : null;
        if (r.match.kind !== 'existing') {
          return <Tag color="green">新建</Tag>;
        }
        return (
          <Space>
            <Tag color={r.action === 'updatePrice' ? 'blue' : 'green'}>
              {r.action === 'updatePrice' ? `更新价格→${productName}` : '新建'}
            </Tag>
            <Switch
              size="small"
              checked={r.action === 'updatePrice'}
              onChange={() => toggleAction(r.key)}
            />
          </Space>
        );
      }
    },
    {
      title: '操作',
      key: 'op',
      width: 70,
      fixed: 'right' as const,
      render: (_: unknown, r: WizardRow) => (
        <Popconfirm title="确认删除该行？" okText="确认" cancelText="取消" onConfirm={() => deleteRow(r.key)}>
          <Button type="link" danger icon={<DeleteOutlined />} />
        </Popconfirm>
      )
    }
  ];

  // ---------- 第四步：关联供应商 ----------
  const [supplierId, setSupplierId] = useState<number | null>(null);

  const createCount = useMemo(() => wizardRows.filter((r) => r.action === 'create').length, [wizardRows]);
  const updateCount = useMemo(() => wizardRows.filter((r) => r.action === 'updatePrice').length, [wizardRows]);

  // ---------- 第五步：入库 ----------
  const [committing, setCommitting] = useState(false);
  const [commitResult, setCommitResult] = useState<{ created: number; priced: number } | null>(null);

  const handleCommit = async (): Promise<void> => {
    setCommitting(true);
    try {
      const rows: CommitRow[] = wizardRows.map((r) => {
        const { key, match, action, productId, ...recognized } = r;
        void key;
        void match;
        return {
          ...recognized,
          action,
          productId: action === 'updatePrice' ? productId : undefined
        };
      });
      const result = await api.importCommit({ supplierId, rows });
      setCommitResult(result);
      message.success('入库完成');
    } catch (err) {
      message.error(`入库失败：${(err as Error).message}`);
    } finally {
      setCommitting(false);
    }
  };

  const resetWizard = (): void => {
    wizardSeqRef.current++; // 使正在进行中的识别/匹配过期
    setCurrentStep(0);
    setFilePath(null);
    setBlocks([]);
    setSelectedBlockKeys([]);
    setRecognizing(false);
    setMatching(false);
    setRecognizeDone(false);
    setRecognizedRows([]);
    setDroppedTotal(0);
    setFailedChunksTotal(0);
    setFailedBlocks([]);
    setWizardRows([]);
    matchedOnceRef.current = false;
    setSupplierId(null);
    setCommitResult(null);
    loadRefData(); // 导入新文件前刷新参考数据，避免下一轮命中的新建产品名称过期
  };

  // ---------- 步骤跳转控制 ----------
  const canGoNext = (): boolean => {
    if (currentStep === 0) return blocks.length > 0 && selectedBlockKeys.length > 0;
    if (currentStep === 1) return recognizeDone;
    if (currentStep === 2) return wizardRows.length > 0 && !matching;
    if (currentStep === 3) return true;
    return false;
  };

  const goNext = (): void => setCurrentStep((s) => Math.min(4, s + 1));
  const goPrev = (): void => setCurrentStep((s) => Math.max(0, s - 1));

  return (
    <div>
      <Typography.Title level={4} style={{ marginTop: 0, marginBottom: 16 }}>报价单导入</Typography.Title>
      {/* 低置信度行底：warning 语义底（浅金警示），与 colorWarningBg 一致，登记统一 */}
      <style>{`
        .import-row-low-confidence > td { background-color: #fffbe6 !important; }
      `}</style>

      <Steps
        current={currentStep}
        style={{ marginBottom: 24 }}
        items={[
          { title: '选文件' },
          { title: '识别' },
          { title: '核对' },
          { title: '关联供应商' },
          { title: '入库' }
        ]}
      />

      <div style={{ ...PANEL_STYLE, minHeight: 320 }}>
        {currentStep === 0 && (
          <div>
            <Space style={{ marginBottom: 16 }}>
              <Button type="primary" loading={parsing} onClick={handlePickFile}>
                选择报价单文件
              </Button>
              <Typography.Text type={filePath ? undefined : 'secondary'}>{filePath ?? '未选择文件'}</Typography.Text>
            </Space>
            {blocks.length === 0 ? (
              <Empty description="请选择 xls/xlsx 报价单文件" />
            ) : (
              <Table
                rowKey={blockKey}
                columns={blockColumns}
                dataSource={blocks}
                pagination={false}
                size="small"
                rowSelection={{
                  selectedRowKeys: selectedBlockKeys,
                  onChange: setSelectedBlockKeys
                }}
              />
            )}
          </div>
        )}

        {currentStep === 1 && (
          <div>
            <Space style={{ marginBottom: 16 }}>
              <Button type="primary" loading={recognizing} onClick={runRecognize}>
                {recognizeDone ? '重新识别' : '开始识别'}
              </Button>
            </Space>
            {(recognizing || recognizeDone) && (
              <Progress
                percent={progressTotal > 0 ? Math.round((progressDone / progressTotal) * 100) : 0}
                format={() => `${progressDone}/${progressTotal}`}
              />
            )}
            {recognizing && <Typography.Text type="secondary">正在识别：{progressLabel}</Typography.Text>}
            {recognizeDone && (
              <div style={{ marginTop: 12 }}>
                <Alert
                  type="info"
                  showIcon
                  message={`识别完成：共识别 ${recognizedRows.length} 行；${droppedTotal} 行无法识别已跳过；${failedChunksTotal} 块解析失败${truncatedChunksTotal > 0 ? `；${truncatedChunksTotal} 块输出被截断，已抢救部分行` : ''}`}
                />
                {failedBlocks.length > 0 && (
                  <Alert
                    style={{ marginTop: 8 }}
                    type="warning"
                    showIcon
                    message={`以下 ${failedBlocks.length} 个块整体解析出错，已跳过：`}
                    description={
                      <ul style={{ margin: 0, paddingLeft: 18 }}>
                        {failedBlocks.map((f, idx) => (
                          <li key={idx}>
                            {f.label}：{f.error}
                          </li>
                        ))}
                      </ul>
                    }
                  />
                )}
              </div>
            )}
          </div>
        )}

        {currentStep === 2 && (
          <div>
            <Typography.Paragraph type="secondary">
              可编辑名称/分类/品牌/型号/单位/规格/U数/时序电源/网口/com口/单价/备注；编辑后该行置信度记为 100%。置信度低于 70%
              的行以黄底提示。匹配列可手动切换「新建」/「更新价格」。
            </Typography.Paragraph>
            <Table
              rowKey="key"
              columns={reviewColumns}
              dataSource={wizardRows}
              loading={matching}
              size="small"
              pagination={false}
              scroll={{ x: 1800 }}
              rowClassName={(r: WizardRow) => (r.confidence < 0.7 ? 'import-row-low-confidence' : '')}
              locale={{ emptyText: <Empty description="暂无可核对的行" /> }}
            />
          </div>
        )}

        {currentStep === 3 && (
          <div>
            <Space direction="vertical" size="large" style={{ width: '100%' }}>
              <Space>
                <Typography.Text>供应商：</Typography.Text>
                <Select
                  allowClear
                  style={{ width: 260 }}
                  placeholder="不选择则价格来源记为「手动」"
                  value={supplierId ?? undefined}
                  onChange={(v) => setSupplierId(v ?? null)}
                  options={suppliers.map((s) => ({ value: s.id, label: s.name }))}
                />
              </Space>
              <Typography.Text>
                本次导入将：新建 <Typography.Text strong>{createCount}</Typography.Text> 条产品 / 更新价格{' '}
                <Typography.Text strong>{updateCount}</Typography.Text> 条
              </Typography.Text>
            </Space>
          </div>
        )}

        {currentStep === 4 && (
          <div>
            {commitResult ? (
              <Result
                status="success"
                title="入库完成"
                subTitle={`共新建 ${commitResult.created} 条产品，写入 ${commitResult.priced} 条价格记录`}
                extra={[
                  <Link key="products" to="/">
                    <Button type="primary">去产品库查看</Button>
                  </Link>,
                  <Button key="reset" onClick={resetWizard}>
                    导入新文件
                  </Button>
                ]}
              />
            ) : (
              <Space direction="vertical" size="large" style={{ width: '100%' }}>
                <Typography.Text>
                  即将新建 <Typography.Text strong>{createCount}</Typography.Text> 条产品、更新价格{' '}
                  <Typography.Text strong>{updateCount}</Typography.Text> 条，供应商：
                  {supplierId != null ? suppliers.find((s) => s.id === supplierId)?.name ?? `#${supplierId}` : '未选择（手动来源）'}
                </Typography.Text>
                <Button type="primary" loading={committing} disabled={wizardRows.length === 0} onClick={handleCommit}>
                  开始入库
                </Button>
              </Space>
            )}
          </div>
        )}
      </div>

      {currentStep < 4 && (
        <Space style={{ marginTop: 16 }}>
          <Button disabled={currentStep === 0 || recognizing || matching} onClick={goPrev}>
            上一步
          </Button>
          <Button type="primary" disabled={!canGoNext()} onClick={goNext}>
            下一步
          </Button>
        </Space>
      )}
      {currentStep === 4 && !commitResult && (
        <Space style={{ marginTop: 16 }}>
          <Button onClick={goPrev}>上一步</Button>
        </Space>
      )}

      <Modal
        title="编辑参数"
        open={paramsModalOpen}
        onOk={saveParamsModal}
        onCancel={closeParamsModal}
        okText="保存"
        cancelText="取消"
        destroyOnClose
      >
        <Input.TextArea
          rows={8}
          value={paramsModalValue}
          onChange={(e) => setParamsModalValue(e.target.value)}
          placeholder="请输入参数"
        />
      </Modal>
    </div>
  );
}
