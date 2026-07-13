import React, { useEffect, useRef, useState } from 'react';
import { Modal, Form, Input, InputNumber, Button, message, Space } from 'antd';
import dayjs from 'dayjs';
import type { Product, ScreenshotPriceResult } from '../../../shared/api-types';
import { api } from '../api';
import { yuanToCents } from '../money';
import ScreenshotCapture, { type CaptureImage } from './ScreenshotCapture';

interface ScreenshotPriceModalProps {
  open: boolean;
  product: Product | null;
  onClose: () => void;
  /** 写入价格记录成功后回调，供父级刷新价格列表 */
  onWritten?: () => void;
}

interface ResultFormValues {
  name: string | null;
  spec: string | null;
  priceYuan: number | null;
  shop: string | null;
}

export default function ScreenshotPriceModal({
  open,
  product,
  onClose,
  onWritten
}: ScreenshotPriceModalProps): React.JSX.Element {
  const [image, setImage] = useState<CaptureImage | null>(null);
  const [recognizing, setRecognizing] = useState(false);
  const [result, setResult] = useState<ScreenshotPriceResult | null>(null);
  const [writing, setWriting] = useState(false);
  const [form] = Form.useForm<ResultFormValues>();
  const containerRef = useRef<HTMLDivElement>(null);
  // 截图来源链接：通用能力（免费版剥离后仍保留声明，仅无 premium 入口设置它）。
  // 有真实来源链接时，写入价格记录优先使用它而非「截图识价：店铺」占位文案。
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);

  const reset = (): void => {
    setImage(null);
    setResult(null);
    setSourceUrl(null);
    form.resetFields();
  };

  useEffect(() => {
    if (open) reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, product?.id]);

  const handleCaptureChange = (img: CaptureImage | null): void => {
    setResult(null);
    setSourceUrl(null);
    setImage(img);
    if (img) form.resetFields();
  };


  // 比价浏览器操作区：付费版填充为两个按钮，免费版剥离后保持 null（ScreenshotCapture 不渲染该行）。
  let priceBrowserActions: React.ReactNode = null;

  const handleRecognize = async (): Promise<void> => {
    if (!image) {
      message.error('请先粘贴或拖入商品页截图');
      return;
    }
    setRecognizing(true);
    try {
      const r = await api.watchRecognizeScreenshot({ image: { mediaType: image.mediaType, base64: image.base64 } });
      setResult(r);
      if (r.found) {
        form.setFieldsValue({
          name: r.name,
          spec: r.spec,
          priceYuan: r.priceCents != null ? r.priceCents / 100 : null,
          shop: r.shop
        });
      } else {
        message.warning(`未能从截图中识别出价格${r.note ? `：${r.note}` : ''}`);
      }
    } catch (err) {
      message.error(`识别失败：${(err as Error).message}`);
    } finally {
      setRecognizing(false);
    }
  };

  const handleWrite = async (): Promise<void> => {
    if (!product) return;
    let values: ResultFormValues;
    try {
      values = await form.validateFields();
    } catch (err) {
      if ((err as { errorFields?: unknown }).errorFields) return;
      throw err;
    }
    if (values.priceYuan == null) {
      message.error('请输入价格');
      return;
    }
    setWriting(true);
    try {
      const shopLabel = values.shop?.trim() || '未知店铺';
      // 有真实截图来源链接（如比价浏览器截取）时优先使用，否则回退到占位文案。
      const effectiveSourceUrl = sourceUrl || `截图识价：${shopLabel}`;
      await api.pricesAdd({
        productId: product.id,
        source: 'manual',
        priceCents: yuanToCents(values.priceYuan),
        sourceUrl: effectiveSourceUrl,
        capturedAt: dayjs().toISOString()
      });
      message.success('价格记录已写入');
      onWritten?.();
      onClose();
    } catch (err) {
      message.error(`写入失败：${(err as Error).message}`);
    } finally {
      setWriting(false);
    }
  };

  return (
    <Modal
      title={product ? `截图识价 - ${product.name}` : '截图识价'}
      open={open}
      onCancel={onClose}
      footer={null}
      width={560}
      destroyOnClose
    >
      <div ref={containerRef}>
        <ScreenshotCapture
          image={image}
          onChange={handleCaptureChange}
          hint="仅识别用户手动截图/拖入的商品页图片，不会自动访问任何网页；粘贴（Ctrl/Cmd+V）或将图片文件拖入下方区域即可。"
          extraActions={priceBrowserActions}
        />

        <Space style={{ marginBottom: 12 }}>
          <Button onClick={handleRecognize} loading={recognizing} disabled={!image}>
            识别
          </Button>
        </Space>

        {result && (
          <Form form={form} layout="vertical">
            <Form.Item name="name" label="商品名称">
              <Input placeholder="识别不出可手动填写" />
            </Form.Item>
            <Form.Item name="spec" label="规格">
              <Input placeholder="可选" />
            </Form.Item>
            <Form.Item
              name="priceYuan"
              label="价格（元）"
              rules={[{ required: true, message: '请输入价格' }]}
            >
              <InputNumber min={0.01} precision={2} style={{ width: '100%' }} placeholder="请输入价格" />
            </Form.Item>
            <Form.Item name="shop" label="店铺">
              <Input placeholder="可选" />
            </Form.Item>
            <Form.Item style={{ marginBottom: 0, textAlign: 'right' }}>
              <Button type="primary" onClick={handleWrite} loading={writing}>
                写入价格记录
              </Button>
            </Form.Item>
          </Form>
        )}
      </div>
    </Modal>
  );
}
