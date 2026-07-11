import React, { useEffect, useRef, useState } from 'react';
import { Drawer, Modal, Table, Button, Popconfirm, message, Space, Typography, Tag, Tooltip, InputNumber, Empty } from 'antd';
import dayjs from 'dayjs';
import type { Supplier, Inquiry, InquiryDetail, InquiryItem } from '../../../shared/api-types';
import { api } from '../api';
import { yuanToCents, centsToYuan, fmtYuan } from '../money';

interface InquiryPanelProps {
  open: boolean;
  supplier: Supplier | null;
  onClose: () => void;
}

/** 供应商页询价单入口：Drawer 展示该供应商的询价单列表，点击进入嵌套 Modal 查看/回价/导出。 */
export default function InquiryPanel({ open, supplier, onClose }: InquiryPanelProps): React.JSX.Element {
  const [inquiries, setInquiries] = useState<Inquiry[]>([]);
  const [loading, setLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const loadSeqRef = useRef(0);

  const [detailOpen, setDetailOpen] = useState(false);
  const [detail, setDetail] = useState<InquiryDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [writingId, setWritingId] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);

  const load = async (supplierId: number): Promise<void> => {
    const seq = ++loadSeqRef.current;
    setLoading(true);
    try {
      const list = await api.inquiriesList(supplierId);
      if (seq !== loadSeqRef.current) return;
      setInquiries(list);
    } catch (err) {
      if (seq === loadSeqRef.current) message.error(`加载询价单列表失败：${(err as Error).message}`);
    } finally {
      if (seq === loadSeqRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    if (open && supplier) {
      load(supplier.id);
    } else if (!open) {
      setInquiries([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, supplier?.id]);

  const handleDelete = async (id: number): Promise<void> => {
    setDeletingId(id);
    try {
      await api.inquiriesDelete(id);
      message.success('询价单已删除');
      if (supplier) await load(supplier.id);
    } catch (err) {
      message.error(`删除失败：${(err as Error).message}`);
    } finally {
      setDeletingId(null);
    }
  };

  const openDetail = async (id: number): Promise<void> => {
    setDetailOpen(true);
    setDetailLoading(true);
    try {
      const d = await api.inquiriesGet(id);
      setDetail(d);
    } catch (err) {
      message.error(`加载询价单详情失败：${(err as Error).message}`);
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const closeDetail = (): void => {
    setDetailOpen(false);
    setDetail(null);
  };

  const handleReplyBlur = async (item: InquiryItem, e: React.FocusEvent<HTMLInputElement>): Promise<void> => {
    const raw = e.target.value.replace(/,/g, '').trim();
    const current = item.replyPriceCents;
    if (raw === '') {
      if (current == null) return;
      try {
        const updated = await api.inquiriesSetReply({ itemId: item.id, replyPriceCents: null });
        setDetail((prev) => (prev ? { ...prev, items: prev.items.map((it) => (it.id === item.id ? updated : it)) } : prev));
      } catch (err) {
        message.error(`清空回价失败：${(err as Error).message}`);
      }
      return;
    }
    const val = Number(raw);
    if (Number.isNaN(val) || val < 0) {
      message.error('回价不能为负数');
      return;
    }
    const cents = yuanToCents(val);
    if (cents === current) return;
    try {
      const updated = await api.inquiriesSetReply({ itemId: item.id, replyPriceCents: cents });
      setDetail((prev) => (prev ? { ...prev, items: prev.items.map((it) => (it.id === item.id ? updated : it)) } : prev));
    } catch (err) {
      message.error(`保存回价失败：${(err as Error).message}`);
    }
  };

  const handleWritePriceRecord = async (item: InquiryItem): Promise<void> => {
    setWritingId(item.id);
    try {
      await api.inquiriesWriteReply(item.id);
      message.success('已写入价格记录');
    } catch (err) {
      message.error(`写入失败：${(err as Error).message}`);
    } finally {
      setWritingId(null);
    }
  };

  const handleExport = async (): Promise<void> => {
    if (!detail) return;
    setExporting(true);
    try {
      const dir = await api.dialogPickDir();
      if (!dir) return;
      const file = await api.exportInquiry({ inquiryId: detail.id, outDir: dir });
      message.success(`导出成功：${file}`);
      await api.shellReveal(file);
    } catch (err) {
      message.error(`导出失败：${(err as Error).message}`);
    } finally {
      setExporting(false);
    }
  };

  const listColumns = [
    { title: '标题', dataIndex: 'title', key: 'title' },
    { title: '项目', dataIndex: 'projectName', key: 'projectName' },
    { title: '行数', dataIndex: 'itemCount', key: 'itemCount', width: 72 },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: (v: string) => dayjs(v).format('YYYY-MM-DD HH:mm')
    },
    {
      title: '操作',
      key: 'action',
      render: (_: unknown, record: Inquiry) => (
        <Space>
          <Button type="link" onClick={() => openDetail(record.id)}>
            查看
          </Button>
          <Popconfirm title="确认删除该询价单？" okText="确认" cancelText="取消" onConfirm={() => handleDelete(record.id)}>
            <Button type="link" danger loading={deletingId === record.id}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      )
    }
  ];

  const detailColumns = [
    {
      title: '名称',
      key: 'name',
      render: (_: unknown, record: InquiryItem) => (
        <Space>
          <span>{record.name}</span>
          {record.productId == null && <Tag>手工</Tag>}
        </Space>
      )
    },
    {
      title: '参数',
      key: 'params',
      render: (_: unknown, record: InquiryItem) => {
        const text = record.params ?? '';
        if (!text) return '-';
        return (
          <Tooltip title={text}>
            <span
              style={{
                display: 'inline-block',
                maxWidth: 160,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                verticalAlign: 'bottom'
              }}
            >
              {text}
            </span>
          </Tooltip>
        );
      }
    },
    { title: '单位', key: 'unit', render: (_: unknown, record: InquiryItem) => record.unit },
    { title: '数量', key: 'qty', render: (_: unknown, record: InquiryItem) => record.qty },
    { title: '备注', key: 'remark', render: (_: unknown, record: InquiryItem) => record.remark ?? '-' },
    {
      title: '回价（元）',
      key: 'reply',
      render: (_: unknown, record: InquiryItem) => (
        <InputNumber
          key={`reply-${record.id}-${record.replyPriceCents ?? 'null'}`}
          min={0}
          precision={2}
          defaultValue={record.replyPriceCents != null ? centsToYuan(record.replyPriceCents) : undefined}
          style={{ width: 110 }}
          onBlur={(e) => handleReplyBlur(record, e)}
        />
      )
    },
    {
      title: '操作',
      key: 'action',
      render: (_: unknown, record: InquiryItem) => {
        const disabled = record.productId == null || record.replyPriceCents == null;
        const tip = record.productId == null ? '手工行无产品，无法写入价格记录' : record.replyPriceCents == null ? '请先填写回价' : '';
        const btn = (
          <Button type="link" disabled={disabled} loading={writingId === record.id} onClick={() => handleWritePriceRecord(record)}>
            写入价格记录
          </Button>
        );
        return tip ? <Tooltip title={tip}>{btn}</Tooltip> : btn;
      }
    }
  ];

  return (
    <>
      <Drawer title={supplier ? `询价单 - ${supplier.name}` : '询价单'} open={open} onClose={onClose} width={640} destroyOnClose>
        <Table
          rowKey="id"
          columns={listColumns}
          dataSource={inquiries}
          loading={loading}
          size="small"
          pagination={false}
          locale={{ emptyText: <Empty description="暂无询价单" /> }}
        />
      </Drawer>

      <Modal
        title={detail ? `${detail.title}` : '询价单详情'}
        open={detailOpen}
        onCancel={closeDetail}
        footer={null}
        width={900}
        destroyOnClose
      >
        {detail && (
          <>
            <Typography.Paragraph type="secondary">
              项目：{detail.projectName}　供应商：{detail.supplierName}
            </Typography.Paragraph>
            <Space style={{ marginBottom: 12 }}>
              <Button loading={exporting} onClick={handleExport}>
                导出 xlsx
              </Button>
            </Space>
            <Table
              rowKey="id"
              columns={detailColumns}
              dataSource={detail.items}
              loading={detailLoading}
              size="small"
              pagination={false}
              locale={{ emptyText: <Empty description="暂无行" /> }}
            />
          </>
        )}
      </Modal>
    </>
  );
}
