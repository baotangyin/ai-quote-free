import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Table, Checkbox, InputNumber, Tag, Tooltip, Typography, message } from 'antd';
import type { CandidateItem } from '../../../shared/api-types';
import { api } from '../api';
import {
  buildApplyItems,
  initialSelections,
  DELETED_PRODUCT_NAME,
  type CandidateSelection
} from '../rules-logic';

interface BomSuggestPanelProps {
  open: boolean;
  candidates: CandidateItem[];
  spaceId: number | null;
  onClose: () => void;
  /** 加入成功后回调，供父级刷新清单 */
  onApplied: () => void;
}

export default function BomSuggestPanel({
  open,
  candidates,
  spaceId,
  onClose,
  onApplied
}: BomSuggestPanelProps): React.JSX.Element {
  const [selections, setSelections] = useState<Record<number, CandidateSelection>>({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setSelections(initialSelections(candidates));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, candidates]);

  const setChecked = (idx: number, checked: boolean): void => {
    setSelections((prev) => ({ ...prev, [idx]: { ...prev[idx], checked } }));
  };

  const setQty = (idx: number, qty: number): void => {
    setSelections((prev) => ({ ...prev, [idx]: { ...prev[idx], qty } }));
  };

  const applyItems = useMemo(() => buildApplyItems(candidates, selections), [candidates, selections]);

  const handleApply = async (): Promise<void> => {
    if (spaceId == null) {
      message.warning('请先选择一个空间');
      return;
    }
    if (applyItems.length === 0) {
      message.warning('请至少勾选一项');
      return;
    }
    setSubmitting(true);
    try {
      const res = await api.rulesApply({ spaceId, items: applyItems });
      message.success(`已加入 ${res.created} 项，跳过 ${res.skipped} 项`);
      onApplied();
      onClose();
    } catch (err) {
      message.error(`加入失败：${(err as Error).message}`);
    } finally {
      setSubmitting(false);
    }
  };

  const columns = [
    {
      title: '选择',
      key: 'checked',
      width: 60,
      render: (_: unknown, _record: CandidateItem, idx: number) => {
        const deleted = candidates[idx].productName === DELETED_PRODUCT_NAME;
        return (
          <Checkbox
            checked={selections[idx]?.checked ?? false}
            disabled={deleted}
            onChange={(e) => setChecked(idx, e.target.checked)}
          />
        );
      }
    },
    {
      title: '配套产品',
      key: 'productName',
      render: (_: unknown, record: CandidateItem) =>
        record.productName === DELETED_PRODUCT_NAME ? (
          <Typography.Text type="danger">{record.productName}</Typography.Text>
        ) : (
          record.productName
        )
    },
    {
      title: '数量',
      key: 'qty',
      width: 110,
      render: (_: unknown, _record: CandidateItem, idx: number) => (
        <InputNumber
          min={0.01}
          precision={2}
          value={selections[idx]?.qty ?? 0}
          style={{ width: 90 }}
          onChange={(v) => setQty(idx, v ?? 0)}
        />
      )
    },
    {
      title: '必选/可选',
      key: 'optional',
      width: 90,
      render: (_: unknown, record: CandidateItem) =>
        record.optional ? <Tag color="gold">可选</Tag> : <Tag color="blue">必选</Tag>
    },
    {
      title: '来源规则',
      dataIndex: 'ruleName',
      key: 'ruleName'
    },
    {
      title: '公式',
      key: 'formula',
      render: (_: unknown, record: CandidateItem) =>
        record.formula ? (
          <Tooltip title={record.formula}>
            <Typography.Text code style={{ fontSize: 12 }}>
              {record.formula}
            </Typography.Text>
          </Tooltip>
        ) : (
          '-'
        )
    },
    {
      title: '备注',
      key: 'note',
      render: (_: unknown, record: CandidateItem) => record.note ?? '-'
    }
  ];

  return (
    <Modal
      title="联动配套清单"
      open={open}
      onOk={handleApply}
      onCancel={onClose}
      okText="加入所选"
      cancelText="关闭"
      confirmLoading={submitting}
      okButtonProps={{ disabled: spaceId == null || applyItems.length === 0 }}
      width={900}
      destroyOnClose
    >
      {spaceId == null && (
        <Typography.Paragraph type="warning">未选中目标空间，请先在左侧选择一个空间。</Typography.Paragraph>
      )}
      <Table
        rowKey={(_record, idx) => String(idx)}
        size="small"
        columns={columns}
        dataSource={candidates}
        pagination={false}
        scroll={{ y: 360 }}
      />
    </Modal>
  );
}
