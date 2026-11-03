// Browser-side slip reader: image → (QR + OCR) → ParsedSlip, all on device.
import { createWorker, PSM, type Worker } from 'tesseract.js';
import jsQR from 'jsqr';
import { OCR_LANGS, OCR_PARAMS } from './ocrConfig';
import { toOcrLines } from './ocrLines';
import { parseSlip, type ParsedSlip } from './parse';

export interface ReadResult {
  slip: ParsedSlip;
  thumb: Blob | null;
  fileTime: number;
}

export interface EngineProgress {
  status: string;
  progress: number;
}

let workerPromise: Promise<Worker> | null = null;
let listener: ((p: EngineProgress) => void) | null = null;

export function onEngineProgress(fn: ((p: EngineProgress) => void) | null) {
  listener = fn;
}

function assetBase() {
  return new URL('./ocr/', document.baseURI).href;
}

export function getEngine(): Promise<Worker> {
  if (!workerPromise) {
    const base = assetBase();
    workerPromise = (async () => {
      const w = await createWorker(OCR_LANGS, 1, {
        workerPath: `${base}worker.min.js`,
        corePath: `${base}core/`,
        langPath: `${base}lang`,
        workerBlobURL: false,
        logger: (m: { status: string; progress: number }) => listener?.({ status: m.status, progress: m.progress }),
      });
      await w.setParameters({ ...OCR_PARAMS, tessedit_pageseg_mode: PSM.AUTO });
      return w;
    })();
    workerPromise.catch(() => {
      workerPromise = null;
    });
  }
  return workerPromise;
}

export async function stopEngine() {
  const p = workerPromise;
  workerPromise = null;
  if (p) (await p.catch(() => null))?.terminate();
}

async function loadBitmap(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions);
  } catch {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.decoding = 'async';
      img.src = url;
      await img.decode();
      return img;
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }
}

function drawScaled(src: CanvasImageSource, w: number, h: number, targetW: number) {
  const scale = targetW / w;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
  return canvas;
}

const toBlob = (c: HTMLCanvasElement, type: string, q?: number) =>
  new Promise<Blob | null>((res) => c.toBlob(res, type, q));

function readQr(canvas: HTMLCanvasElement): string | null {
  // QR decoding is cheaper on a smaller copy; slip QRs are large enough.
  const small = canvas.width > 900 ? drawScaled(canvas, canvas.width, canvas.height, 900) : canvas;
  const ctx = small.getContext('2d', { willReadFrequently: true })!;
  const data = ctx.getImageData(0, 0, small.width, small.height);
  const hit = jsQR(data.data, data.width, data.height, { inversionAttempts: 'attemptBoth' });
  return hit?.data || null;
}

export async function readSlip(file: File): Promise<ReadResult> {
  const bmp = await loadBitmap(file);
  const w = 'naturalWidth' in bmp ? bmp.naturalWidth : bmp.width;
  const h = 'naturalHeight' in bmp ? bmp.naturalHeight : bmp.height;

  // Tesseract likes glyphs ~30px tall: upscale small images, cap huge ones.
  const targetW = w < 900 ? Math.min(w * 2, 1400) : Math.min(w, 1600);
  const canvas = drawScaled(bmp, w, h, targetW);
  if ('close' in bmp) bmp.close();

  let qrText: string | null = null;
  try {
    qrText = readQr(canvas);
  } catch {
    qrText = null;
  }

  const engine = await getEngine();
  const { data } = await engine.recognize(canvas, {}, { blocks: true, text: true });
  const slip = parseSlip(toOcrLines(data.blocks as never, data.text), qrText);

  const thumbCanvas = drawScaled(canvas, canvas.width, canvas.height, Math.min(560, canvas.width));
  const thumb = (await toBlob(thumbCanvas, 'image/jpeg', 0.8)) ?? null;
  return { slip, thumb, fileTime: file.lastModified || Date.now() };
}
