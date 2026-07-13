/// <reference types="vite/client" />
import * as pdfjsLib from 'pdfjs-dist';
// Vite 特殊后缀 `?url`：返回该 worker 文件打包后的最终 URL 字符串（不作为模块执行），
// electron-vite（基于 Vite）renderer 构建下可行；已通过 `npm run build` 验证产物含该 worker 资源。
import pdfjsWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl;

export interface NormalizedImage {
  mediaType: 'image/jpeg';
  base64: string;
}

const JPEG_QUALITY = 0.85;

/** 去掉 data URL 前缀（如 "data:image/jpeg;base64,"），仅保留 base64 正文。 */
function stripDataUrlPrefix(dataUrl: string): string {
  const idx = dataUrl.indexOf(',');
  return idx >= 0 ? dataUrl.slice(idx + 1) : dataUrl;
}

/** 计算令最长边 ≤ maxEdge 的缩放比例（已 ≤ maxEdge 时不放大，返回 1）。 */
function scaleForMaxEdge(width: number, height: number, maxEdge: number): number {
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return 1;
  return maxEdge / longest;
}

function canvasToJpegBase64(canvas: HTMLCanvasElement): NormalizedImage {
  const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
  return { mediaType: 'image/jpeg', base64: stripDataUrlPrefix(dataUrl) };
}

/**
 * 将 PDF 文件逐页渲染为 jpeg base64（归一化缩放，最长边 ≤ maxEdge）。
 * 使用 pdfjs-dist 的 getDocument({ data }) 加载，worker 通过 `?url` 导入的打包资源配置。
 */
export async function pdfToImages(file: File, maxEdge = 2000): Promise<NormalizedImage[]> {
  const buf = await file.arrayBuffer();
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
  const images: NormalizedImage[] = [];
  try {
    for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
      const page = await doc.getPage(pageNum);
      const baseViewport = page.getViewport({ scale: 1 });
      const scale = scaleForMaxEdge(baseViewport.width, baseViewport.height, maxEdge);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('无法创建画布上下文');
      await page.render({ canvasContext: ctx, viewport }).promise;
      images.push(canvasToJpegBase64(canvas));
    }
  } finally {
    await doc.destroy();
  }
  return images;
}

/**
 * 将图片文件（png/jpg/webp）经 canvas 缩放归一化为 jpeg base64（最长边 ≤ maxEdge）。
 */
export async function imageFileToNormalizedJpeg(file: File, maxEdge = 2000): Promise<NormalizedImage> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('图片加载失败'));
      el.src = url;
    });
    const scale = scaleForMaxEdge(img.naturalWidth, img.naturalHeight, maxEdge);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('无法创建画布上下文');
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvasToJpegBase64(canvas);
  } finally {
    URL.revokeObjectURL(url);
  }
}
