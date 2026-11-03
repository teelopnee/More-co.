import { normalizeOcr, skeleton } from './text';

const THAI_MONTHS_FULL = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
];
const THAI_MONTHS_SHORT = [
  'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
  'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.',
];
const EN_MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

// Skeletons drop vowel marks, so "มี.ค." → "มค" collides with "ม.ค.". Keep the
// marks that distinguish months by building keys with a lighter normaliser.
const monthKey = (s: string) =>
  normalizeOcr(s).replace(/[.\s:,ุู่-์]/g, '');

const MONTH_LOOKUP = new Map<string, number>();
THAI_MONTHS_SHORT.forEach((m, i) => MONTH_LOOKUP.set(monthKey(m), i + 1));
THAI_MONTHS_FULL.forEach((m, i) => {
  MONTH_LOOKUP.set(monthKey(m), i + 1);
  MONTH_LOOKUP.set(skeleton(m), i + 1);
});

export function thaiMonthNumber(token: string): number | null {
  const key = monthKey(token);
  if (MONTH_LOOKUP.has(key)) return MONTH_LOOKUP.get(key)!;
  const sk = skeleton(token);
  // Full month names survive as skeletons; short ones only when unambiguous.
  for (let i = 0; i < 12; i++) {
    if (sk.length >= 4 && sk === skeleton(THAI_MONTHS_FULL[i])) return i + 1;
  }
  return null;
}

export function toCeYear(y: number): number {
  if (y >= 2400) return y - 543; // Buddhist era, 4 digits
  if (y >= 1900) return y;
  if (y >= 40) return 2500 + y - 543; // "69" → 2569 BE → 2026
  return 2000 + y; // "26" → 2026 CE
}

const pad = (n: number) => String(n).padStart(2, '0');

function validDate(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return null;
  if (y < 2000 || y > 2100) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

export interface FoundDate {
  date: string; // YYYY-MM-DD (CE)
  index: number; // line index where found
}

/** Find the first plausible transaction date in OCR lines. */
export function findDate(lines: string[]): FoundDate | null {
  for (let i = 0; i < lines.length; i++) {
    const line = normalizeOcr(lines[i]);

    // 3 พ.ย. 69 / 03 พ.ย. 2569 / 2 พฤศจิกายน 2569 (OCR may garble the dots)
    const thai = /(\d{1,2})\s*([฀-๿][฀-๿.\s]{0,14}?)\s*(\d{4}|\d{2})(?!\d)/g;
    for (const m of line.matchAll(thai)) {
      const month = thaiMonthNumber(m[2]);
      if (!month) continue;
      const d = validDate(toCeYear(Number(m[3])), month, Number(m[1]));
      if (d) return { date: d, index: i };
    }

    // 01 Nov 2026 / 1 November, 2026
    const en1 = /(\d{1,2})\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?,?\s*(\d{4}|\d{2})(?!\d)/gi;
    for (const m of line.matchAll(en1)) {
      const d = validDate(toCeYear(Number(m[3])), EN_MONTHS.indexOf(m[2].toLowerCase()) + 1, Number(m[1]));
      if (d) return { date: d, index: i };
    }
    // Nov 01, 2026
    const en2 = /(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})/gi;
    for (const m of line.matchAll(en2)) {
      const d = validDate(toCeYear(Number(m[3])), EN_MONTHS.indexOf(m[1].toLowerCase()) + 1, Number(m[2]));
      if (d) return { date: d, index: i };
    }
    // 03/11/2569, 03-11-26
    const num = /(?<![\d.])(\d{1,2})[/-](\d{1,2})[/-](\d{4}|\d{2})(?![\d])/g;
    for (const m of line.matchAll(num)) {
      const d = validDate(toCeYear(Number(m[3])), Number(m[2]), Number(m[1]));
      if (d) return { date: d, index: i };
    }
  }
  return null;
}

/** Find HH:MM, preferring the line where the date was found. */
export function findTime(lines: string[], preferIndex?: number): string | null {
  const order = preferIndex == null ? lines.map((_, i) => i) : [preferIndex, ...lines.map((_, i) => i).filter((i) => i !== preferIndex)];
  for (const i of order) {
    const line = normalizeOcr(lines[i] ?? '');
    const m = line.match(/(?<![\d:])([01]?\d|2[0-3])\s?:\s?([0-5]\d)(?::[0-5]\d)?(?![\d])/) ??
      line.match(/(?<![\d.,])([01]?\d|2[0-3])\.([0-5]\d)\s*(?:น\.?|u\.?|นาฬิกา)/);
    if (m) return `${pad(Number(m[1]))}:${m[2]}`;
  }
  return null;
}
