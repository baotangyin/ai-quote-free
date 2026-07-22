import React, { useEffect, useState } from 'react';
import { Alert, Button, Space, Typography, message } from 'antd';
import { imageFileToNormalizedJpeg, type NormalizedImage } from '../pdfToImages';

const IMAGE_MIME = new Set(['image/png', 'image/jpeg', 'image/webp']);

/** 展示/识别用的图片：粘贴/拖入固定归一化为 jpeg，比价浏览器截取为 png，两者均可命中此类型。 */
export type CaptureImage = { mediaType: 'image/png' | 'image/jpeg' | 'image/webp'; base64: string };

/** 从 File 归一化为可展示、可传给 AI 的 jpeg 图片（复用 pdfToImages.ts 的归一化逻辑）。 */
async function normalizeFile(file: File): Promise<NormalizedImage | null> {
  if (!IMAGE_MIME.has(file.type)) return null;
  try {
    return await imageFileToNormalizedJpeg(file);
  } catch {
    return null;
  }
}

interface ScreenshotCaptureProps {
  image: CaptureImage | null;
  /** 图片变化回调：粘贴/拖入产生新图，或点击「清除图片」时传 null。 */
  onChange: (image: CaptureImage | null) => void;
  /** 顶部提示文案，默认为通用的「仅识别手动截图，不自动访问网页」说明。 */
  hint?: string;
  /** 顶部可选操作区（如付费版比价浏览器的两个按钮），不传则不渲染该行。 */
  extraActions?: React.ReactNode;
}

/**
 * 截图粘贴/拖入公共组件：负责监听粘贴事件、处理拖入文件、归一化为 jpeg 并展示缩略图。
 * 供截图识价（ScreenshotPriceModal）与新建产品截图识别共用交互模式。
 * 组件挂载期间即监听 document 粘贴事件，卸载时自动移除——调用方应配合 Modal 的
 * destroyOnClose，使组件随弹窗关闭而卸载，避免多个实例同时监听粘贴。
 */
export default function ScreenshotCapture({
  image,
  onChange,
  hint,
  extraActions
}: ScreenshotCaptureProps): React.JSX.Element {
  const [dragOver, setDragOver] = useState(false);

  // 监听粘贴事件：从剪贴板取图片（用户手动截图后粘贴），不做任何自动访问页面的行为。
  useEffect(() => {
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
                onChange(img);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>): Promise<void> => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    const img = await normalizeFile(file);
    if (img) {
      onChange(img);
    } else {
      message.error('仅支持拖入 png/jpg/webp 图片');
    }
  };

  return (
    <div>
      {extraActions && <Space style={{ marginBottom: 12 }}>{extraActions}</Space>}
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message={hint ?? '仅识别用户手动截图/拖入的图片，不会自动访问任何网页；粘贴（Ctrl/Cmd+V）或将图片文件拖入下方区域即可。'}
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
            alt="截图预览"
            style={{ maxWidth: '100%', maxHeight: 240, objectFit: 'contain' }}
          />
        ) : (
          <Typography.Text type="secondary">在此处粘贴（Ctrl/Cmd+V）或拖入截图</Typography.Text>
        )}
      </div>
      {image && (
        <Space style={{ marginBottom: 12 }}>
          <Button onClick={() => onChange(null)}>清除图片</Button>
        </Space>
      )}
    </div>
  );
}
