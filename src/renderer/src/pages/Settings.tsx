import React, { useEffect, useState } from 'react';
import { Form, Select, InputNumber, Input, Button, message, Card, Typography, Space, Switch, Tooltip, Radio, Progress, Alert, Tag, Table, Modal, Popconfirm, Divider, AutoComplete } from 'antd';
import { QuestionCircleOutlined, PlusOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import type { CostRule, WatchRoundSummary, UpdateEventPayload, AiProfile } from '../../../shared/api-types';
import { api } from '../api';

type UpdateMode = 'auto' | 'notify';

interface SettingsFormValues {
  costRule: CostRule;
  defaultMargin: number;
}

interface AiProfileFormValues {
  name: string;
  protocol: 'openai' | 'anthropic';
  baseUrl: string;
  apiKey: string;
  model: string;
  searchMode?: 'none' | 'zhipu' | 'dashscope' | 'minimax' | 'custom';
  searchCustomJson?: string;
}

const SEARCH_MODE_OPTIONS: { value: NonNullable<AiProfileFormValues['searchMode']>; label: string }[] = [
  { value: 'none', label: '无' },
  { value: 'zhipu', label: '智谱' },
  { value: 'dashscope', label: '通义' },
  { value: 'minimax', label: 'MiniMax' },
  { value: 'custom', label: '自定义参数' }
];

/** 档案表格「联网搜索」摘要列文案。 */
function searchModeLabel(mode: AiProfile['searchMode']): string {
  return SEARCH_MODE_OPTIONS.find((o) => o.value === (mode ?? 'none'))?.label ?? '无';
}

/** AI 档案三个用途绑定：文本识别（导入报价单识别/导出模板解析）/ 图片处理（图纸识别）/ 定时查价。 */
interface AiBindings {
  text: string | null;
  vision: string | null;
  watch: string | null;
}

/** 生成档案 id：简单随机串，本机唯一即可，无需强加密随机性。 */
function randomProfileId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

interface WatchFormValues {
  watchEnabled: boolean;
  watchIntervalDays: number;
  watchAlertRate: number;
  closeToTray: boolean;
  launchAtLogin: boolean;
}

function summarizeWatch(s: WatchRoundSummary): string {
  return `检查 ${s.checked} 个，更新 ${s.updated} 个，失败 ${s.failed} 个，跳过 ${s.skipped} 个，异动 ${s.alerts.length} 项`;
}

/** 更新检测错误信息中文包装：网络/fetch 层失败统一提示，GitHub API 已给出结构化中文说明的错误直接透传。 */
function wrapUpdateError(message: string): string {
  if (message.startsWith('GitHub API')) return message;
  return '检查更新失败：网络异常或无法访问 GitHub';
}

/** 发布说明摘要：取前 80 字，避免结果提示过长。 */
function summarizeNotes(notes: string | null): string {
  if (!notes) return '';
  const trimmed = notes.trim();
  return trimmed.length > 80 ? `${trimmed.slice(0, 80)}…` : trimmed;
}

// 全页表单统一布局：固定宽度 label + 自适应输入区（见设计规范 §2 排版一致性）
const LABEL_COL = { flex: '0 0 240px' };
const WRAPPER_COL = { flex: '1 1 auto' };

export default function Settings(): React.JSX.Element {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm<SettingsFormValues>();

  const [aiLoading, setAiLoading] = useState(false);
  const [aiProfiles, setAiProfilesState] = useState<AiProfile[]>([]);
  const [aiBindings, setAiBindings] = useState<AiBindings>({ text: null, vision: null, watch: null });
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null);
  const [profileSaving, setProfileSaving] = useState(false);
  const [testingProfileId, setTestingProfileId] = useState<string | null>(null);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [modelOptions, setModelOptions] = useState<string[]>([]);
  const [profileForm] = Form.useForm<AiProfileFormValues>();

  const [watchLoading, setWatchLoading] = useState(false);
  const [watchSaving, setWatchSaving] = useState(false);
  const [watchRunning, setWatchRunning] = useState(false);
  const [lastRunAt, setLastRunAt] = useState<string | null>(null);
  const [lastSummary, setLastSummary] = useState<WatchRoundSummary | null>(null);
  const [watchForm] = Form.useForm<WatchFormValues>();

  // 软件更新
  const isMac = api.platform !== 'win32';
  const isLinux = api.platform === 'linux';
  const [appVersion, setAppVersion] = useState('');
  const [updateMode, setUpdateMode] = useState<UpdateMode>('notify');
  const [updateModeSaving, setUpdateModeSaving] = useState(false);
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<{ hasUpdate: boolean; version: string | null; notes: string | null; url: string | null } | null>(null);
  const [progressPercent, setProgressPercent] = useState<number | null>(null);
  const [downloaded, setDownloaded] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);


  const loadUpdateSettings = async (): Promise<void> => {
    try {
      const [version, modeRaw, status] = await Promise.all([
        api.appVersion(),
        api.settingsGet('updateMode'),
        api.updateStatus()
      ]);
      setAppVersion(version);
      const defaultMode: UpdateMode = isMac ? 'notify' : 'auto';
      setUpdateMode(modeRaw === 'auto' || modeRaw === 'notify' ? modeRaw : defaultMode);
      if (status.hasUpdate) setCheckResult({ hasUpdate: true, version: status.version, notes: status.notes, url: status.url });
      setProgressPercent(status.progressPercent);
      setDownloaded(status.downloaded);
      if (status.error) setUpdateError(wrapUpdateError(status.error));
    } catch (err) {
      message.error(`加载更新设置失败：${(err as Error).message}`);
    }
  };

  useEffect(() => {
    loadUpdateSettings();
    const unsubscribe = api.onUpdateEvent((payload) => {
      switch (payload.type) {
        case 'checking':
          setChecking(true);
          setUpdateError(null);
          break;
        case 'available':
          setChecking(false);
          setCheckResult({ hasUpdate: true, version: payload.version, notes: payload.notes, url: payload.url });
          break;
        case 'not-available':
          setChecking(false);
          setCheckResult({ hasUpdate: false, version: null, notes: null, url: null });
          break;
        case 'progress':
          setProgressPercent(payload.percent);
          break;
        case 'downloaded':
          setDownloaded(true);
          setProgressPercent(100);
          break;
        case 'error':
          setChecking(false);
          setUpdateError(wrapUpdateError(payload.message));
          break;
      }
    });
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleUpdateModeChange = async (mode: UpdateMode): Promise<void> => {
    setUpdateModeSaving(true);
    try {
      await api.settingsSet({ key: 'updateMode', value: mode });
      setUpdateMode(mode);
      message.success('更新方式已保存');
    } catch (err) {
      message.error(`保存更新方式失败：${(err as Error).message}`);
    } finally {
      setUpdateModeSaving(false);
    }
  };

  const handleCheckUpdate = async (): Promise<void> => {
    setChecking(true);
    setUpdateError(null);
    try {
      const result = await api.updateCheck();
      setCheckResult(result);
      if (result.hasUpdate) {
        message.success(`发现新版本 ${result.version}`);
      } else {
        message.success('已是最新版本');
      }
    } catch (err) {
      // 错误已经过 onUpdateEvent 的 error 事件广播并在此处更新 updateError，这里只需吞掉 promise
      // 拒绝，避免控制台出现未处理的 rejection；不重复弹 message。
      if (!(err instanceof Error)) setUpdateError('检查更新失败：网络异常或无法访问 GitHub');
    } finally {
      setChecking(false);
    }
  };

  const handleOpenDownloadPage = (): void => {
    if (checkResult?.url) api.shellOpenExternal(checkResult.url);
  };

  const handleInstallUpdate = async (): Promise<void> => {
    try {
      const ok = await api.updateInstall();
      if (!ok) message.error('当前没有已下载完成的更新');
    } catch (err) {
      message.error(`重启安装失败：${(err as Error).message}`);
    }
  };

  const loadSettings = async (): Promise<void> => {
    setLoading(true);
    try {
      const [costRuleRaw, defaultMarginRaw] = await Promise.all([
        api.settingsGet('costRule'),
        api.settingsGet('defaultMargin')
      ]);
      form.setFieldsValue({
        costRule: (costRuleRaw as CostRule | null) ?? 'lowest',
        defaultMargin: defaultMarginRaw != null ? Number(defaultMarginRaw) : 1.3
      });
    } catch (err) {
      message.error(`加载设置失败：${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  /** 打开 AI 配置区时调用：触发（若需要）懒迁移，加载档案列表与三用途的有效绑定。 */
  const loadAiSettings = async (): Promise<void> => {
    setAiLoading(true);
    try {
      const result = await api.aiProfilesEnsure();
      setAiProfilesState(result.profiles);
      setAiBindings(result.bindings);
    } catch (err) {
      message.error(`加载 AI 配置失败：${(err as Error).message}`);
    } finally {
      setAiLoading(false);
    }
  };

  const loadWatchSettings = async (): Promise<void> => {
    setWatchLoading(true);
    try {
      const [enabled, intervalDays, alertRate, closeToTray, launchAtLogin, status] = await Promise.all([
        api.settingsGet('watchEnabled'),
        api.settingsGet('watchIntervalDays'),
        api.settingsGet('watchAlertRate'),
        api.settingsGet('closeToTray'),
        api.settingsGet('launchAtLogin'),
        api.watchStatus()
      ]);
      watchForm.setFieldsValue({
        watchEnabled: enabled === '1',
        watchIntervalDays: intervalDays != null ? Number(intervalDays) : 30,
        watchAlertRate: alertRate != null ? Number(alertRate) * 100 : 10,
        closeToTray: closeToTray == null ? true : closeToTray === '1',
        launchAtLogin: launchAtLogin === '1'
      });
      setLastRunAt(status.lastRunAt);
      setLastSummary(status.lastSummary);
      setWatchRunning(status.running);
    } catch (err) {
      message.error(`加载查价配置失败：${(err as Error).message}`);
    } finally {
      setWatchLoading(false);
    }
  };

  useEffect(() => {
    loadSettings();
    loadAiSettings();
    loadWatchSettings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSave = async (): Promise<void> => {
    let values: SettingsFormValues;
    try {
      values = await form.validateFields();
    } catch (err) {
      if ((err as { errorFields?: unknown }).errorFields) return;
      throw err;
    }
    setSaving(true);
    try {
      await Promise.all([
        api.settingsSet({ key: 'costRule', value: values.costRule }),
        api.settingsSet({ key: 'defaultMargin', value: String(values.defaultMargin) })
      ]);
      message.success('设置已保存');
    } catch (err) {
      message.error(`保存设置失败：${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  /** 持久化档案列表（settings 键 aiProfiles，JSON 数组）。 */
  const persistAiProfiles = async (profiles: AiProfile[]): Promise<void> => {
    await api.settingsSet({ key: 'aiProfiles', value: JSON.stringify(profiles) });
    setAiProfilesState(profiles);
  };

  const bindingKeyOf = (usage: keyof AiBindings): 'aiProfileText' | 'aiProfileVision' | 'aiProfileWatch' =>
    (usage === 'text' ? 'aiProfileText' : usage === 'vision' ? 'aiProfileVision' : 'aiProfileWatch');

  /** 用途绑定 Select 变更：立即持久化，不需要额外“保存”按钮。 */
  const handleBindingChange = async (usage: keyof AiBindings, profileId: string): Promise<void> => {
    try {
      await api.settingsSet({ key: bindingKeyOf(usage), value: profileId });
      setAiBindings((prev) => ({ ...prev, [usage]: profileId }));
    } catch (err) {
      message.error(`保存绑定失败：${(err as Error).message}`);
    }
  };

  const openAddProfileModal = (): void => {
    setEditingProfileId(null);
    setModelOptions([]);
    profileForm.resetFields();
    profileForm.setFieldsValue({ protocol: 'openai', name: '', baseUrl: '', apiKey: '', model: '', searchMode: 'none', searchCustomJson: '' });
    setProfileModalOpen(true);
  };

  const openEditProfileModal = (profile: AiProfile): void => {
    setEditingProfileId(profile.id);
    setModelOptions([]);
    profileForm.setFieldsValue({
      name: profile.name,
      protocol: profile.protocol,
      baseUrl: profile.baseUrl,
      apiKey: profile.apiKey,
      model: profile.model,
      searchMode: profile.searchMode ?? 'none',
      searchCustomJson: profile.searchCustomJson ?? ''
    });
    setProfileModalOpen(true);
  };

  /** 按表单中已填的协议/Base URL/API Key 获取官方模型名称列表。 */
  const handleFetchModelNames = async (): Promise<void> => {
    try {
      const vals = profileForm.getFieldsValue(['name', 'protocol', 'baseUrl', 'apiKey']);
      if (!vals.baseUrl || !vals.apiKey) {
        message.warning('请先填写 Base URL 和 API Key');
        return;
      }
      setFetchingModels(true);
      const models = await api.aiModelNames({ name: vals.name || '', protocol: vals.protocol, baseUrl: vals.baseUrl, apiKey: vals.apiKey });
      setModelOptions(models);
      if (models.length === 0) {
        message.info('该提供商未返回可用模型，请手动输入');
      } else {
        message.success(`已获取 ${models.length} 个模型`);
      }
    } catch (err) {
      message.error(`获取模型列表失败：${(err as Error).message}`);
    } finally {
      setFetchingModels(false);
    }
  };

  const handleProfileModalOk = async (): Promise<void> => {
    let values: AiProfileFormValues;
    try {
      values = await profileForm.validateFields();
    } catch (err) {
      if ((err as { errorFields?: unknown }).errorFields) return;
      throw err;
    }
    setProfileSaving(true);
    try {
      let nextProfiles: AiProfile[];
      if (editingProfileId) {
        nextProfiles = aiProfiles.map((p) => (p.id === editingProfileId ? { ...p, ...values } : p));
      } else {
        const created: AiProfile = { id: randomProfileId(), ...values };
        nextProfiles = [...aiProfiles, created];
      }
      await persistAiProfiles(nextProfiles);
      // 新增第一个档案时，三个用途尚未绑定过（均为 null），此时让它们都指向新档案，
      // 与懒迁移「默认档案」三用途绑定的语义保持一致，避免用户新增后还要手动逐个绑定。
      if (aiProfiles.length === 0 && !editingProfileId) {
        const onlyId = nextProfiles[0].id;
        await Promise.all([
          api.settingsSet({ key: 'aiProfileText', value: onlyId }),
          api.settingsSet({ key: 'aiProfileVision', value: onlyId }),
          api.settingsSet({ key: 'aiProfileWatch', value: onlyId })
        ]);
        setAiBindings({ text: onlyId, vision: onlyId, watch: onlyId });
      }
      message.success(editingProfileId ? '档案已更新' : '档案已新增');
      setProfileModalOpen(false);
    } catch (err) {
      message.error(`保存档案失败：${(err as Error).message}`);
    } finally {
      setProfileSaving(false);
    }
  };

  /** 删除档案：若该档案被任一用途绑定，绑定回退到剩余档案的第一个（无剩余档案则清空绑定），并提示用户。 */
  const handleDeleteProfile = async (profile: AiProfile): Promise<void> => {
    const remaining = aiProfiles.filter((p) => p.id !== profile.id);
    const fallbackId = remaining[0]?.id ?? '';
    const affectedUsages: string[] = [];
    const usageLabels: Record<keyof AiBindings, string> = { text: '文本识别', vision: '图片处理', watch: '定时查价' };
    const nextBindings: AiBindings = { ...aiBindings };
    for (const usage of Object.keys(aiBindings) as (keyof AiBindings)[]) {
      if (aiBindings[usage] === profile.id) {
        affectedUsages.push(usageLabels[usage]);
        nextBindings[usage] = fallbackId || null;
      }
    }
    try {
      await persistAiProfiles(remaining);
      if (affectedUsages.length > 0) {
        await Promise.all(
          (Object.keys(aiBindings) as (keyof AiBindings)[])
            .filter((usage) => aiBindings[usage] === profile.id)
            .map((usage) => api.settingsSet({ key: bindingKeyOf(usage), value: fallbackId }))
        );
        setAiBindings(nextBindings);
        message.warning(
          fallbackId
            ? `档案已删除，原绑定「${affectedUsages.join('/')}」已自动回退到「${remaining[0].name}」`
            : `档案已删除，「${affectedUsages.join('/')}」暂无可用档案，请尽快新增`
        );
      } else {
        message.success('档案已删除');
      }
    } catch (err) {
      message.error(`删除档案失败：${(err as Error).message}`);
    }
  };

  const handleTestProfile = async (profile: AiProfile): Promise<void> => {
    setTestingProfileId(profile.id);
    try {
      const ok = await api.aiTest({ profileId: profile.id });
      if (ok) {
        message.success(`「${profile.name}」连接成功`);
      } else {
        message.error(`「${profile.name}」连接失败，请检查配置`);
      }
    } catch (err) {
      message.error(`测试连接失败：${(err as Error).message}`);
    } finally {
      setTestingProfileId(null);
    }
  };

  const handleWatchSave = async (): Promise<void> => {
    let values: WatchFormValues;
    try {
      values = await watchForm.validateFields();
    } catch (err) {
      if ((err as { errorFields?: unknown }).errorFields) return;
      throw err;
    }
    setWatchSaving(true);
    try {
      await Promise.all([
        api.settingsSet({ key: 'watchEnabled', value: values.watchEnabled ? '1' : '0' }),
        api.settingsSet({ key: 'watchIntervalDays', value: String(values.watchIntervalDays) }),
        api.settingsSet({ key: 'watchAlertRate', value: String(values.watchAlertRate / 100) }),
        api.settingsSet({ key: 'closeToTray', value: values.closeToTray ? '1' : '0' }),
        api.settingsSetLaunchAtLogin(!!values.launchAtLogin)
      ]);
      message.success('查价配置已保存');
    } catch (err) {
      message.error(`保存查价配置失败：${(err as Error).message}`);
    } finally {
      setWatchSaving(false);
    }
  };

  // 数据备份与还原
  const [backingUp, setBackingUp] = useState(false);
  const [lastBackupPath, setLastBackupPath] = useState<string | null>(null);
  const [restoreModalOpen, setRestoreModalOpen] = useState(false);
  const [restoreFilePath, setRestoreFilePath] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [restoreStaged, setRestoreStaged] = useState(false);

  const handleBackupRun = async (): Promise<void> => {
    const destDir = await api.dialogPickDir();
    if (!destDir) return;
    setBackingUp(true);
    try {
      const path = await api.backupRun({ destDir });
      setLastBackupPath(path);
      message.success(`备份成功：${path}`);
    } catch (err) {
      message.error(`备份失败：${(err as Error).message}`);
    } finally {
      setBackingUp(false);
    }
  };

  const handlePickRestoreFile = async (): Promise<void> => {
    const filePath = await api.dialogPickDbFile();
    if (!filePath) return;
    setRestoreFilePath(filePath);
    setRestoreStaged(false);
    setRestoreModalOpen(true);
  };

  const handleConfirmRestore = async (): Promise<void> => {
    if (!restoreFilePath) return;
    setRestoring(true);
    try {
      const result = await api.backupStageRestore({ filePath: restoreFilePath });
      if (result.ok) {
        setRestoreStaged(true);
        message.success('已准备就绪，重启后生效（当前数据已自动留底）');
      } else {
        message.error(`还原失败：${result.reason}`);
        setRestoreModalOpen(false);
      }
    } catch (err) {
      message.error(`还原失败：${(err as Error).message}`);
      setRestoreModalOpen(false);
    } finally {
      setRestoring(false);
    }
  };

  const handleRelaunch = async (): Promise<void> => {
    try {
      await api.appRelaunch();
    } catch (err) {
      message.error(`重启失败：${(err as Error).message}`);
    }
  };

  const handleWatchRunNow = async (): Promise<void> => {
    setWatchRunning(true);
    try {
      const summary = await api.watchRunNow();
      setLastSummary(summary);
      setLastRunAt(summary.finishedAt);
      message.success(`本轮查价完成：${summarizeWatch(summary)}`);
    } catch (err) {
      message.error(`立即查价失败：${(err as Error).message}`);
    } finally {
      setWatchRunning(false);
    }
  };

  return (
    <div>
      <Typography.Title level={4} style={{ marginTop: 0, marginBottom: 16 }}>设置</Typography.Title>
      <div style={{ maxWidth: 960, margin: '0 auto' }}>
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          <Card
            title="计价设置"
            size="small"
            loading={loading}
            extra={
              <Button type="primary" loading={saving} onClick={handleSave}>
                保存
              </Button>
            }
          >
            <Form form={form} layout="horizontal" labelCol={LABEL_COL} wrapperCol={WRAPPER_COL}>
              <Form.Item
                name="costRule"
                label="成本价取值规则"
                rules={[{ required: true, message: '请选择成本价取值规则' }]}
              >
                <Select
                  options={[
                    { value: 'lowest', label: '最低价' },
                    { value: 'latest', label: '最新报价' }
                  ]}
                />
              </Form.Item>
              <Form.Item
                name="defaultMargin"
                label="默认利润倍率"
                rules={[{ required: true, message: '请输入默认利润倍率' }]}
                style={{ marginBottom: 0 }}
              >
                <InputNumber min={0} precision={2} style={{ width: '100%' }} />
              </Form.Item>
            </Form>
          </Card>

          <Card
            title={
              <Space size={4}>
                <span>AI 配置档案</span>
                <Tooltip title="支持配置多个厂家/账号的 AI 接口档案，分别用于「文本识别」（报价单导入识别、导出模板解析）、「图片处理」（图纸识别）、「定时查价」三种用途，可自由绑定，也可共用同一档案。支持任意 OpenAI 兼容接口或 Anthropic 接口，填入自有 API Key 即可，密钥仅保存在本机数据库中。">
                  <QuestionCircleOutlined />
                </Tooltip>
              </Space>
            }
            size="small"
            loading={aiLoading}
            extra={
              <Button icon={<PlusOutlined />} onClick={openAddProfileModal}>
                新增档案
              </Button>
            }
          >
            <Typography.Paragraph type="secondary" style={{ marginBottom: 16 }}>
              · DeepSeek（OpenAI 兼容）：协议选「OpenAI 兼容」，Base URL 填{' '}
              <Typography.Text code>https://api.deepseek.com</Typography.Text>，模型名如{' '}
              <Typography.Text code>deepseek-v4-flash</Typography.Text>
              <br />
              · 通义千问（OpenAI 兼容模式）：协议选「OpenAI 兼容」，Base URL 填{' '}
              <Typography.Text code>https://dashscope.aliyuncs.com/compatible-mode/v1</Typography.Text>
              ，模型名如 <Typography.Text code>qwen-plus</Typography.Text>
              <br />
              · Claude（Anthropic 官方接口）：协议选「Anthropic」，Base URL 填{' '}
              <Typography.Text code>https://api.anthropic.com</Typography.Text>，模型名如{' '}
              <Typography.Text code>claude-sonnet-5-20250901</Typography.Text>
            </Typography.Paragraph>

            <Table<AiProfile>
              rowKey="id"
              size="small"
              pagination={false}
              style={{ marginBottom: 16 }}
              dataSource={aiProfiles}
              locale={{ emptyText: '尚未配置任何 AI 档案，点击右上「新增档案」开始配置' }}
              columns={[
                { title: '名称', dataIndex: 'name', ellipsis: true },
                {
                  title: '协议',
                  dataIndex: 'protocol',
                  width: 110,
                  render: (v: AiProfile['protocol']) => (v === 'openai' ? 'OpenAI 兼容' : 'Anthropic')
                },
                { title: '模型名', dataIndex: 'model', ellipsis: true },
                {
                  title: '联网搜索',
                  dataIndex: 'searchMode',
                  width: 100,
                  render: (v: AiProfile['searchMode']) => searchModeLabel(v)
                },
                {
                  title: '操作',
                  key: 'actions',
                  width: 200,
                  align: 'right',
                  render: (_: unknown, p: AiProfile) => (
                    <Space size="small">
                      <Button size="small" onClick={() => openEditProfileModal(p)}>编辑</Button>
                      <Button size="small" loading={testingProfileId === p.id} onClick={() => handleTestProfile(p)}>
                        测试
                      </Button>
                      <Popconfirm
                        title="确认删除该档案？"
                        description="若被某个用途绑定，将自动回退到剩余档案的第一个"
                        onConfirm={() => handleDeleteProfile(p)}
                      >
                        <Button size="small" danger>删除</Button>
                      </Popconfirm>
                    </Space>
                  )
                }
              ]}
            />

            <Divider style={{ margin: '16px 0' }} />

            <Form layout="horizontal" labelCol={LABEL_COL} wrapperCol={WRAPPER_COL}>
              <Form.Item
                label={
                  <Space size={4}>
                    <span>文本识别用途绑定</span>
                    <Tooltip title="用于报价单导入识别、导出模板 AI 解析">
                      <QuestionCircleOutlined />
                    </Tooltip>
                  </Space>
                }
              >
                <Select
                  value={aiBindings.text ?? undefined}
                  placeholder="请先新增档案"
                  disabled={aiProfiles.length === 0}
                  options={aiProfiles.map((p) => ({ value: p.id, label: p.name }))}
                  onChange={(v) => handleBindingChange('text', v)}
                />
              </Form.Item>
              <Form.Item
                label={
                  <Space size={4}>
                    <span>图片处理用途绑定</span>
                    <Tooltip title="用于图纸识别等图片功能，需绑定支持视觉（图片输入）的模型档案">
                      <QuestionCircleOutlined />
                    </Tooltip>
                  </Space>
                }
              >
                <Select
                  value={aiBindings.vision ?? undefined}
                  placeholder="请先新增档案"
                  disabled={aiProfiles.length === 0}
                  options={aiProfiles.map((p) => ({ value: p.id, label: p.name }))}
                  onChange={(v) => handleBindingChange('vision', v)}
                />
              </Form.Item>
              <Form.Item
                label={
                  <Space size={4}>
                    <span>定时查价用途绑定</span>
                    <Tooltip title="用于价格监控自动查价，需绑定支持联网搜索的模型档案">
                      <QuestionCircleOutlined />
                    </Tooltip>
                  </Space>
                }
                style={{ marginBottom: 0 }}
              >
                <Select
                  value={aiBindings.watch ?? undefined}
                  placeholder="请先新增档案"
                  disabled={aiProfiles.length === 0}
                  options={aiProfiles.map((p) => ({ value: p.id, label: p.name }))}
                  onChange={(v) => handleBindingChange('watch', v)}
                />
              </Form.Item>
            </Form>
          </Card>

        <Modal
          title={editingProfileId ? '编辑 AI 档案' : '新增 AI 档案'}
          open={profileModalOpen}
          onOk={handleProfileModalOk}
          onCancel={() => setProfileModalOpen(false)}
          confirmLoading={profileSaving}
          destroyOnClose
        >
          <Form form={profileForm} layout="vertical">
            <Form.Item name="name" label="档案名称" rules={[{ required: true, message: '请输入档案名称' }]}>
              <Input placeholder="如 DeepSeek主账号" />
            </Form.Item>
            <Form.Item name="protocol" label="协议" rules={[{ required: true, message: '请选择协议' }]}>
              <Select
                options={[
                  { value: 'openai', label: 'OpenAI 兼容' },
                  { value: 'anthropic', label: 'Anthropic' }
                ]}
              />
            </Form.Item>
            <Form.Item name="baseUrl" label="Base URL" rules={[{ required: true, message: '请输入 Base URL' }]}>
              <Input placeholder="如 https://api.deepseek.com" />
            </Form.Item>
            <Form.Item name="apiKey" label="API Key" rules={[{ required: true, message: '请输入 API Key' }]}>
              <Input.Password placeholder="请输入 API Key" autoComplete="off" />
            </Form.Item>
            <Form.Item
              name="model"
              label="模型名"
              rules={[{ required: true, message: '请选择或输入模型名' }]}
            >
              <AutoComplete
                placeholder="先填 Base URL 和 API Key，再点「获取模型」"
                options={modelOptions.map((m) => ({ value: m }))}
                filterOption={(inputValue, option) =>
                  option?.value?.toLowerCase().includes(inputValue.toLowerCase()) ?? false
                }
                dropdownRender={(menu) => (
                  <>
                    <div style={{ padding: '4px 8px' }}>
                      <Button
                        type="link"
                        size="small"
                        loading={fetchingModels}
                        onClick={handleFetchModelNames}
                        style={{ padding: 0 }}
                      >
                        获取官方模型列表
                      </Button>
                    </div>
                    {menu}
                  </>
                )}
              />
            </Form.Item>
            <Form.Item
              name="searchMode"
              label={
                <Space size={4}>
                  <span>联网搜索</span>
                  <Tooltip title="仅用于「定时查价」用途：按所选厂商在查价请求中注入对应的联网搜索参数">
                    <QuestionCircleOutlined />
                  </Tooltip>
                </Space>
              }
              initialValue="none"
            >
              <Select options={SEARCH_MODE_OPTIONS} />
            </Form.Item>
            <Form.Item noStyle shouldUpdate={(prev, cur) => prev.searchMode !== cur.searchMode}>
              {({ getFieldValue }) =>
                getFieldValue('searchMode') === 'custom' ? (
                  <Form.Item
                    name="searchCustomJson"
                    label="自定义搜索参数（JSON，将合并进请求体）"
                    rules={[
                      {
                        validator: (_rule, value: string | undefined) => {
                          if (!value) return Promise.resolve();
                          try {
                            JSON.parse(value);
                            return Promise.resolve();
                          } catch {
                            return Promise.reject(new Error('请输入合法的 JSON'));
                          }
                        }
                      }
                    ]}
                  >
                    <Input.TextArea rows={4} placeholder='如 {"enable_search": true}' />
                  </Form.Item>
                ) : null
              }
            </Form.Item>
          </Form>
        </Modal>

          <Card
            title="查价监控配置"
            size="small"
            loading={watchLoading}
            extra={
              <Space>
                <Button type="primary" loading={watchSaving} onClick={handleWatchSave}>
                  保存
                </Button>
                <Button loading={watchRunning} onClick={handleWatchRunNow}>
                  立即查价
                </Button>
              </Space>
            }
          >
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
              message="查价按产品的名称+品牌+型号+规格组合搜索，型号最关键——请规范维护产品的品牌与型号字段以提高命中率；查不到或异常价格会自动跳过不入库。"
            />
            <Form form={watchForm} layout="horizontal" labelCol={LABEL_COL} wrapperCol={WRAPPER_COL}>
              <Form.Item name="watchEnabled" label="启用价格监控" valuePropName="checked">
                <Switch />
              </Form.Item>
              <Form.Item
                name="watchIntervalDays"
                label="查价周期"
                rules={[{ required: true, message: '请选择查价周期' }]}
              >
                <Select
                  options={[
                    { value: 1, label: '每日' },
                    { value: 7, label: '每周' },
                    { value: 30, label: '每月' }
                  ]}
                />
              </Form.Item>
              <Form.Item
                name="watchAlertRate"
                label="异动提醒阈值（%）"
                rules={[{ required: true, message: '请输入异动提醒阈值' }]}
              >
                <InputNumber min={0} max={1000} precision={1} style={{ width: '100%' }} addonAfter="%" />
              </Form.Item>
              <Form.Item name="closeToTray" label="关闭窗口时最小化到托盘" valuePropName="checked">
                <Switch />
              </Form.Item>
              <Form.Item
                name="launchAtLogin"
                label={
                  <Space size={4}>
                    <span>开机自动启动</span>
                    {isLinux && (
                      <Tooltip title="Linux 暂不支持开机自启，此开关仅保存设置，不会实际生效">
                        <QuestionCircleOutlined />
                      </Tooltip>
                    )}
                  </Space>
                }
                valuePropName="checked"
                style={{ marginBottom: 0 }}
              >
                <Switch />
              </Form.Item>
            </Form>
            <Typography.Paragraph type="secondary" style={{ marginTop: 16, marginBottom: 0 }}>
              {lastRunAt
                ? `上次运行：${dayjs(lastRunAt).format('YYYY-MM-DD HH:mm')}${lastSummary ? `，${summarizeWatch(lastSummary)}` : ''}`
                : '尚未运行过查价'}
            </Typography.Paragraph>
          </Card>

          <Card
            title="软件更新"
            size="small"
            extra={
              <Button type="primary" loading={checking} disabled={checking} onClick={handleCheckUpdate}>
                立即检查
              </Button>
            }
          >
            <Space direction="vertical" size="middle" style={{ width: '100%' }}>
              <Typography.Text>当前版本：{appVersion || '-'}</Typography.Text>

              <Form layout="horizontal" labelCol={LABEL_COL} wrapperCol={WRAPPER_COL}>
                <Form.Item label="更新方式" style={{ marginBottom: 0 }}>
                  <Radio.Group
                    value={updateMode}
                    disabled={updateModeSaving}
                    onChange={(e) => handleUpdateModeChange(e.target.value as UpdateMode)}
                  >
                    <Space direction="vertical">
                      <Radio value="auto" disabled={isMac}>
                        自动下载并提示重启安装{isMac ? '（macOS 需签名版支持）' : ''}
                      </Radio>
                      <Radio value="notify">仅提示新版本，手动打开下载页</Radio>
                    </Space>
                  </Radio.Group>
                </Form.Item>
              </Form>

              {(checkResult?.hasUpdate && (updateMode === 'notify' || isMac)) || downloaded ? (
                <Space>
                  {checkResult?.hasUpdate && (updateMode === 'notify' || isMac) && (
                    <Button onClick={handleOpenDownloadPage}>打开下载页</Button>
                  )}
                  {downloaded && (
                    <Button type="primary" onClick={handleInstallUpdate}>
                      重启安装
                    </Button>
                  )}
                </Space>
              ) : null}

              {updateError && <Alert type="error" showIcon message={updateError} />}

              {!updateError && checkResult && (
                checkResult.hasUpdate
                  ? (
                    <Alert
                      type="info"
                      showIcon
                      message={`发现新版本 ${checkResult.version}`}
                      description={summarizeNotes(checkResult.notes) || undefined}
                    />
                  )
                  : <Alert type="success" showIcon message="已是最新版本" />
              )}

              {progressPercent != null && (
                <div>
                  <Typography.Text type="secondary">下载进度</Typography.Text>
                  <Progress percent={Math.round(progressPercent)} status={downloaded ? 'success' : 'active'} />
                </div>
              )}
            </Space>
          </Card>
          <Card title="数据备份" size="small">
            <Space direction="vertical" size="middle" style={{ width: '100%' }}>
              <Space>
                <Button type="primary" loading={backingUp} onClick={handleBackupRun}>
                  备份数据到…
                </Button>
                <Button onClick={handlePickRestoreFile}>从备份还原…</Button>
              </Space>
              {lastBackupPath && (
                <Space>
                  <Typography.Text type="secondary">上次备份：{lastBackupPath}</Typography.Text>
                  <Button size="small" onClick={() => api.shellReveal(lastBackupPath)}>
                    在文件夹中显示
                  </Button>
                </Space>
              )}
              <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
                备份即完整复制当前数据库文件（含全部设置），可用于换机迁移或定期留档；建议定期手动备份到外部存储。
              </Typography.Paragraph>
            </Space>
          </Card>

          <Modal
            title="从备份还原"
            open={restoreModalOpen}
            onCancel={() => setRestoreModalOpen(false)}
            footer={
              restoreStaged
                ? [
                    <Button key="later" onClick={() => setRestoreModalOpen(false)}>
                      稍后重启
                    </Button>,
                    <Button key="relaunch" type="primary" onClick={handleRelaunch}>
                      立即重启
                    </Button>
                  ]
                : [
                    <Button key="cancel" onClick={() => setRestoreModalOpen(false)}>
                      取消
                    </Button>,
                    <Button key="confirm" type="primary" danger loading={restoring} onClick={handleConfirmRestore}>
                      确认还原
                    </Button>
                  ]
            }
          >
            {restoreStaged ? (
              <Alert
                type="success"
                showIcon
                message="还原已准备就绪"
                description="重启应用后将自动替换为该备份的数据，当前数据已自动留底（保存在应用数据目录下，文件名含 .bak- 时间戳）。"
              />
            ) : (
              <Alert
                type="warning"
                showIcon
                message="还原将替换当前全部数据与设置"
                description={
                  <>
                    选中文件：<Typography.Text code>{restoreFilePath}</Typography.Text>
                    <br />
                    还原将用该备份文件的全部数据（含设置）替换当前数据库，当前数据会自动留底，但确认后仍建议提前自行另存一份备份。生效需要重启应用。
                  </>
                }
              />
            )}
          </Modal>
        </Space>
      </div>
    </div>
  );
}
