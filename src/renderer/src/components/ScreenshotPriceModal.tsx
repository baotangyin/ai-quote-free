import React, { useEffect, useRef, useState } from 'react';
import { Modal, Form, Input, InputNumber, Button, message, Typography, Space, Alert } from 'antd';
import dayjs from 'dayjs';
import type { Product, ScreenshotPriceResult } from '../../../shared/api-types';
import { api } from '../api';
import { yuanToCents } from '../money';
import { imageFileToNormalizedJpeg, type NormalizedImage } from '../pdfToImages';

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

const IMAGE_MIME = new Set(['image/png', 'image/jpeg', 'image/webp']);

/** 展示/识别用的图片：粘贴/拖入固定归一化为 jpeg，比价浏览器截取为 png，两者均可命中此类型。 */
type CaptureImage = { mediaType: 'image/png' | 'image/jpeg' | 'image/webp'; base64: string };

/** 从 File 归一化为可展示、可传给 AI 的 jpeg 图片（复用 pdfToImages.ts 的归一化逻辑）。 */
async function normalizeFile(file: File): Promise<NormalizedImage | null> {
  if (!IMAGE_MIME.has(file.type)) return null;
  try {
    return await imageFileToNormalizedJpeg(file);
  } catch {
    return null;
  }
}

export default function ScreenshotPriceModal({
  open,
  product,
  onClose,
  onWritten
}: ScreenshotPriceModalProps): React.JSX.Element {
  const [image, setImage] = useState<CaptureImage | null>(null);
  const [dragOver, setDragOver] = useState(false);
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

  // 监听粘贴事件：从剪贴板取图片（用户手动截图后粘贴），不做任何自动访问页面的行为。
  useEffect(() => {
    if (!open) return;
    const handlePaste = (e: ClipboardEvent): void => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.kind === 'file' && IMAGE_MIME.has(item.type)) {
          const file = item.getAsFile();
          if (file) {
            e.preventDefault();
            normalizeFile(file).then((img) => {
              if (img) {
                setResult(null);
                setSourceUrl(null);
                setImage(img);
              } else {
                message.error('粘贴的图片格式不支持');
              }
            });
          }
          break;
        }
      }
    };
    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, [open]);

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>): Promise<void> => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    const img = await normalizeFile(file);
    if (img) {
      setResult(null);
      setSourceUrl(null);
      setImage(img);
    } else {
      message.error('仅支持拖入 png/jpg/webp 图片');
    }
  };


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
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="仅识别用户手动截图/拖入的商品页图片，不会自动访问任何网页；粘贴（Ctrl/Cmd+V）或将图片文件拖入下方区域即可。"
        />
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          tabIndex={0}
          style={{
            border: `1px dashed ${dragOver ? '#1677ff' : '#d9d9d9'}`,
            borderRadius: 8,
            padding: 16,
            textAlign: 'center',
            marginBottom: 12,
            background: dragOver ? '#f0f7ff' : undefined
          }}
        >
          {image ? (
            <img
              src={`data:${image.mediaType};base64,${image.base64}`}
              alt="商品页截图预览"
              style={{ maxWidth: '100%', maxHeight: 240, objectFit: 'contain' }}
            />
          ) : (
            <Typography.Text type="secondary">
              在此处粘贴（Ctrl/Cmd+V）或拖入商品页截图
            </Typography.Text>
          )}
        </div>

        <Space style={{ marginBottom: 12 }}>
          <Button onClick={handleRecognize} loading={recognizing} disabled={!image}>
            识别
          </Button>
          {image && (
            <Button
              onClick={() => {
                setImage(null);
                setResult(null);
                setSourceUrl(null);
                form.resetFields();
              }}
            >
              清除图片
            </Button>
          )}
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
