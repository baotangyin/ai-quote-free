import React, { useEffect, useState } from 'react';
import {
  Button, Card, Empty, Input, InputNumber, List, message, Modal, Popconfirm, Space, Switch, Tag, Tooltip, Typography
} from 'antd';
import { ArrowDownOutlined, ArrowUpOutlined, DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import type { ProjectTypeTemplate, TemplateSection } from '../../../shared/api-types';
import { api } from '../api';
import { SELECTED_BG } from '../theme';

/** 项目类型模板管理：左侧类型列表，右侧编辑板块+空间骨架。保存整体提交 sections JSON。 */
export default function Templates(): React.JSX.Element {
  const [templates, setTemplates] = useState<ProjectTypeTemplate[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [sections, setSections] = useState<TemplateSection[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [newType, setNewType] = useState('');

  const load = async (keepSelection = false): Promise<void> => {
    try {
      const list = await api.templatesList();
      setTemplates(list);
      if (!keepSelection) {
        const first = list[0] ?? null;
        setSelectedId(first ? first.id : null);
        setSections(first ? first.sections : []);
        setDirty(false);
      }
    } catch (err) {
      message.error(`加载模板失败：${(err as Error).message}`);
    }
  };

  useEffect(() => { load(); }, []);

  const select = (tpl: ProjectTypeTemplate): void => {
    if (dirty && !window.confirm('当前模板有未保存修改，切换将丢失，继续？')) return;
    setSelectedId(tpl.id);
    setSections(tpl.sections);
    setDirty(false);
  };

  const mutate = (fn: (draft: TemplateSection[]) => TemplateSection[]): void => {
    setSections((prev) => fn(structuredClone(prev)));
    setDirty(true);
  };

  const move = <T,>(arr: T[], i: number, delta: number): T[] => {
    const j = i + delta;
    if (j < 0 || j >= arr.length) return arr;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    return arr;
  };

  const handleSave = async (): Promise<void> => {
    if (selectedId == null) return;
    if (sections.some((s) => !s.name.trim()) || sections.some((s) => s.spaces.some((sp) => !sp.name.trim()))) {
      message.error('板块与空间名称不能为空');
      return;
    }
    setSaving(true);
    try {
      await api.templatesUpdate({ id: selectedId, patch: { sections } });
      message.success('模板已保存');
      setDirty(false);
      await load(true);
    } catch (err) {
      message.error(`保存模板失败：${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleCreate = async (): Promise<void> => {
    const type = newType.trim();
    if (!type) { message.error('请输入项目类型名称'); return; }
    try {
      const tpl = await api.templatesCreate({ projectType: type, sections: [] });
      setCreateOpen(false);
      setNewType('');
      await load(true);
      setSelectedId(tpl.id);
      setSections([]);
      setDirty(false);
    } catch (err) {
      message.error(`创建模板失败：${(err as Error).message}`);
    }
  };

  const handleDelete = async (id: number): Promise<void> => {
    if (dirty && !window.confirm('当前模板有未保存修改，删除操作将丢失这些修改，继续？')) return;
    try {
      await api.templatesDelete(id);
      message.success('模板已删除（不影响已创建的项目）');
      await load();
    } catch (err) {
      message.error(`删除模板失败：${(err as Error).message}`);
    }
  };

  const selected = templates.find((t) => t.id === selectedId) ?? null;

  return (
    <div>
      <Typography.Title level={4} style={{ marginTop: 0, marginBottom: 16 }}>项目模板</Typography.Title>
      <Typography.Paragraph type="secondary">
        按项目类型预置板块与空间骨架；新建项目选择对应类型时自动生成。置底空间恒排在板块末尾，之后新增的空间会自动插在它们之前。
      </Typography.Paragraph>
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        <Card
          style={{ width: 280, flexShrink: 0 }}
          title="项目类型"
          extra={<Button type="link" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>新建</Button>}
        >
          <List
            dataSource={templates}
            locale={{ emptyText: <Empty description="暂无模板" /> }}
            renderItem={(tpl) => (
              <List.Item
                style={{ cursor: 'pointer', background: tpl.id === selectedId ? SELECTED_BG : undefined, paddingLeft: 8 }}
                onClick={() => select(tpl)}
                actions={[
                  <Popconfirm
                    key="del"
                    title="确认删除该模板？（不影响已创建的项目）"
                    okText="确认"
                    cancelText="取消"
                    onConfirm={(e) => { e?.stopPropagation(); handleDelete(tpl.id); }}
                    onCancel={(e) => e?.stopPropagation()}
                  >
                    <Button type="text" size="small" danger icon={<DeleteOutlined />} onClick={(e) => e.stopPropagation()} />
                  </Popconfirm>
                ]}
              >
                {tpl.projectType}
              </List.Item>
            )}
          />
        </Card>

        <Card
          style={{ flex: 1 }}
          title={selected ? `「${selected.projectType}」板块与空间` : '未选择模板'}
          extra={selected && (
            <Space>
              <Button onClick={() => mutate((d) => { d.push({ name: '', integrationFeeRate: 0, isHardware: false, linkSpaces: false, spaces: [] }); return d; })}>
                添加板块
              </Button>
              <Button type="primary" loading={saving} disabled={!dirty} onClick={handleSave}>保存</Button>
            </Space>
          )}
        >
          {!selected ? (
            <Empty description="请在左侧选择或新建一个项目类型模板" />
          ) : sections.length === 0 ? (
            <Empty description="暂无板块，点击右上角「添加板块」" />
          ) : (
            <Space direction="vertical" size="middle" style={{ width: '100%' }}>
              {sections.map((sec, i) => (
                <Card
                  key={i}
                  size="small"
                  title={
                    <Space>
                      <Input
                        style={{ width: 200 }}
                        value={sec.name}
                        placeholder="板块名称"
                        onChange={(e) => mutate((d) => { d[i].name = e.target.value; return d; })}
                      />
                      <span>集成费</span>
                      <InputNumber
                        min={0} max={1} step={0.01} value={sec.integrationFeeRate}
                        onChange={(v) => mutate((d) => { d[i].integrationFeeRate = v ?? 0; return d; })}
                      />
                      <span>硬件板块</span>
                      <Switch
                        size="small" checked={sec.isHardware}
                        onChange={(v) => mutate((d) => { d[i].isHardware = v; return d; })}
                      />
                      <Tooltip title="随第一板块同步新增/改名空间">
                        <Space size={4}>
                          <span>空间联动</span>
                          <Switch
                            size="small" checked={sec.linkSpaces}
                            onChange={(v) => mutate((d) => { d[i].linkSpaces = v; return d; })}
                          />
                        </Space>
                      </Tooltip>
                    </Space>
                  }
                  extra={
                    <Space>
                      <Button type="text" size="small" icon={<ArrowUpOutlined />} disabled={i === 0}
                        onClick={() => mutate((d) => move(d, i, -1))} />
                      <Button type="text" size="small" icon={<ArrowDownOutlined />} disabled={i === sections.length - 1}
                        onClick={() => mutate((d) => move(d, i, 1))} />
                      <Popconfirm title="确认删除该板块？" okText="确认" cancelText="取消"
                        onConfirm={() => mutate((d) => { d.splice(i, 1); return d; })}>
                        <Button type="text" size="small" danger icon={<DeleteOutlined />} />
                      </Popconfirm>
                    </Space>
                  }
                >
                  <Space direction="vertical" size="small" style={{ width: '100%' }}>
                    {sec.spaces.map((sp, j) => (
                      <Space key={j}>
                        <Input
                          style={{ width: 220 }}
                          value={sp.name}
                          placeholder="空间名称"
                          onChange={(e) => mutate((d) => { d[i].spaces[j].name = e.target.value; return d; })}
                        />
                        <Input
                          style={{ width: 260 }}
                          value={sp.description ?? ''}
                          placeholder="描述（可选）"
                          onChange={(e) => mutate((d) => { d[i].spaces[j].description = e.target.value || null; return d; })}
                        />
                        <Tooltip title="置底空间恒排在板块末尾，新增空间自动插在其前">
                          <Space size={4}>
                            <span>置底</span>
                            <Switch size="small" checked={sp.pinBottom}
                              onChange={(v) => mutate((d) => { d[i].spaces[j].pinBottom = v; return d; })} />
                          </Space>
                        </Tooltip>
                        {sp.pinBottom && <Tag color="purple">置底</Tag>}
                        <Button type="text" size="small" icon={<ArrowUpOutlined />} disabled={j === 0}
                          onClick={() => mutate((d) => { move(d[i].spaces, j, -1); return d; })} />
                        <Button type="text" size="small" icon={<ArrowDownOutlined />} disabled={j === sec.spaces.length - 1}
                          onClick={() => mutate((d) => { move(d[i].spaces, j, 1); return d; })} />
                        <Button type="text" size="small" danger icon={<DeleteOutlined />}
                          onClick={() => mutate((d) => { d[i].spaces.splice(j, 1); return d; })} />
                      </Space>
                    ))}
                    <Button size="small" icon={<PlusOutlined />}
                      onClick={() => mutate((d) => {
                        const idx = d[i].spaces.findIndex((sp) => sp.pinBottom);
                        const newSp = { name: '', description: null, pinBottom: false };
                        if (idx === -1) d[i].spaces.push(newSp); else d[i].spaces.splice(idx, 0, newSp);
                        return d;
                      })}>
                      添加空间
                    </Button>
                  </Space>
                </Card>
              ))}
            </Space>
          )}
        </Card>
      </div>

      <Modal
        title="新建项目类型模板"
        open={createOpen}
        onOk={handleCreate}
        onCancel={() => { setCreateOpen(false); setNewType(''); }}
        okText="创建"
        cancelText="取消"
      >
        <Input
          value={newType}
          onChange={(e) => setNewType(e.target.value)}
          placeholder="项目类型名称，如：展厅 / 指挥中心"
          onPressEnter={handleCreate}
        />
      </Modal>
    </div>
  );
}
