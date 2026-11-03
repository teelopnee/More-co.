import type { OcrLine } from './parse';

interface TBox { x0: number; y0: number; x1: number; y1: number }
interface TWord { text: string; bbox: TBox }
interface TLine { text: string; bbox: TBox; words: TWord[] }
interface TBlock { paragraphs: { lines: TLine[] }[] }

/** Flatten a Tesseract.js result (blocks output) into lines with prominence info. */
export function toOcrLines(blocks: TBlock[] | null | undefined, fallbackText: string): OcrLine[] {
  if (!blocks?.length) return fallbackText.split('\n').map((text) => ({ text }));
  const lines: OcrLine[] = [];
  for (const b of blocks) {
    for (const p of b.paragraphs) {
      for (const l of p.lines) {
        const numeric = l.words.filter((w) => /\d[.,]\d{2}/.test(w.text) || /^\d[\d,]*$/.test(w.text));
        const digitHeight = numeric.length ? Math.max(...numeric.map((w) => w.bbox.y1 - w.bbox.y0)) : undefined;
        lines.push({ text: l.text.replace(/\n+$/, ''), digitHeight });
      }
    }
  }
  return lines;
}
