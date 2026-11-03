import { bankByCode, guessBankFromText, type BankInfo } from './banks';
import { parseSlipQr, type SlipQr } from './qr';
import { afterLabel, collapseSpaces, fuzzyIncludes, normalizeOcr, skeleton } from './text';
import { findDate, findTime } from './thaiDate';

export interface OcrLine {
  text: string;
  /** Pixel height of the tallest numeric word on the line (bigger = more prominent). */
  digitHeight?: number;
}

export interface ParsedSlip {
  isSlip: boolean;
  amount: number | null;
  fee: number | null;
  date: string | null;
  time: string | null;
  from: string | null;
  to: string | null;
  memo: string | null;
  ref: string | null;
  bank: BankInfo | null;
  qr: SlipQr | null;
  /** Slip explicitly says money was received. */
  received: boolean;
  /** Key used to detect a slip that was already saved. */
  dedupeKey: string | null;
  text: string;
}

const L = {
  amount: ['จำนวนเงิน', 'จำนวน', 'ยอดเงิน', 'ยอดชำระ', 'ยอดโอน', 'ยอดเงินโอน', 'ยอดรวม', 'ยอดชำระทั้งหมด', 'amount', 'total', 'total amount'],
  fee: ['ค่าธรรมเนียม', 'ค่าบริการ', 'fee', 'service fee'],
  balance: ['ยอดคงเหลือ', 'คงเหลือ', 'ยอดเงินคงเหลือ', 'ยอดเงินที่ใช้ได้', 'balance', 'available balance'],
  ref: ['เลขที่รายการ', 'รหัสอ้างอิง', 'หมายเลขอ้างอิง', 'เลขที่อ้างอิง', 'รหัสรายการ', 'เลขอ้างอิง', 'reference no', 'reference', 'ref no', 'ref', 'transaction id', 'transaction no'],
  from: ['จาก', 'ผู้โอน', 'ผู้ส่ง', 'ผู้ชำระ', 'บัญชีต้นทาง', 'from'],
  to: ['ไปยัง', 'ถึง', 'ผู้รับ', 'ผู้รับเงิน', 'ร้านค้า', 'ชื่อร้าน', 'ชื่อร้านค้า', 'บัญชีปลายทาง', 'to', 'merchant', 'biller', 'paid to'],
  memo: ['บันทึกช่วยจำ', 'บันทึก', 'หมายเหตุ', 'ข้อความ', 'memo', 'note'],
  success: ['สำเร็จ', 'ทำรายการสำเร็จ', 'successful', 'success', 'completed'],
  received: ['รับเงินสำเร็จ', 'ได้รับเงิน', 'เงินเข้า', 'received', 'money received'],
} as const;

const MONEY = /(?<![\dA-Za-z.,])(\d{1,3}(?:,\d{3})+|\d{1,7})[.,](\d{2})(?![\d,])/g;
const NAME_PREFIX = /^(นาย|นางสาว|นาง|น\.?\s?ส\.?|ด\.?\s?ช\.?|ด\.?\s?ญ\.?|บจก\.?|บมจ\.?|หจก\.?|บริษัท|ห้างหุ้นส่วน|ร้าน|คุณ|mr\.?|mrs\.?|ms\.?|miss|dr\.?)\s*/i;
const BANK_LINE = /^(ธ\.|ธนาคาร|พร้อมเพย์|promptpay|e-?wallet|true\s?money|ทรูมันนี่|xxx|x{2,}|\d{3}-|bank\b)/i;
const MASKED_ACCOUNT = /[xX*•]{2,}[-\dxX*•]*|\b\d{3}-\d-\d{5}-\d\b/g;

function moneyIn(text: string): { value: number; raw: string }[] {
  const out: { value: number; raw: string }[] = [];
  for (const m of normalizeOcr(text).matchAll(MONEY)) {
    const value = Number(`${m[1].replace(/,/g, '')}.${m[2]}`);
    if (Number.isFinite(value)) out.push({ value, raw: m[0] });
  }
  return out;
}

function lineMatches(line: string, labels: readonly string[], strict = false): boolean {
  return labels.some((l) =>
    skeleton(l).length <= 3
      ? new RegExp(`(^|\\s)${l}(\\s|:|$)`, 'i').test(line)
      : fuzzyIncludes(line, l, strict ? 0 : undefined),
  );
}

function cleanName(s: string | null): string | null {
  if (!s) return null;
  let v = normalizeOcr(s).replace(MASKED_ACCOUNT, ' ');
  v = v.replace(/\b(biller id|ref|เลขที่บัญชี|บัญชี)\b.*$/i, '');
  v = collapseSpaces(v.replace(/[|_~^*=<>]+/g, ' ')).replace(/^[:\-–—.,\s]+|[:\-–—,\s]+$/g, '');
  if (v.length < 2 || !/[ก-ฮA-Za-z]{2}/.test(v)) return null;
  return v;
}

function isNameLike(line: string): boolean {
  const t = normalizeOcr(line).trim();
  return NAME_PREFIX.test(t) && /[ก-ฮA-Za-z]{2}/.test(t.replace(NAME_PREFIX, ''));
}

function valueAfterLabel(lines: string[], labels: readonly string[]): { value: string; index: number } | null {
  for (let i = 0; i < lines.length; i++) {
    const v = afterLabel(lines[i], labels);
    if (v == null) continue;
    if (v) return { value: v, index: i };
    // Label alone on its line → value is on the next non-empty line.
    const next = lines.slice(i + 1).find((l) => l.trim());
    if (next) return { value: next.trim(), index: i + 1 };
  }
  return null;
}

function findAmount(lines: OcrLine[]): { amount: number | null; fee: number | null } {
  const heights = lines.map((l) => l.digitHeight ?? 0).filter((h) => h > 0);
  const maxH = heights.length ? Math.max(...heights) : 0;
  let fee: number | null = null;
  let best: { value: number; score: number; order: number } | null = null;

  lines.forEach((line, i) => {
    const text = normalizeOcr(line.text);
    const values = moneyIn(text);
    if (!values.length) return;
    const isFee = lineMatches(text, L.fee);
    const isBalance = lineMatches(text, L.balance);
    if (isFee) {
      fee ??= values[0].value;
      return;
    }
    if (isBalance) return;
    const prev = i > 0 ? normalizeOcr(lines[i - 1].text) : '';
    for (const v of values) {
      let score = 0;
      if (lineMatches(text, L.amount)) score += 10;
      else if (prev && !moneyIn(prev).length && lineMatches(prev, L.amount)) score += 8;
      if (/บาท|thb|฿|baht/i.test(text)) score += 3;
      if (maxH && line.digitHeight && line.digitHeight >= maxH * 0.9) score += 5;
      if (v.value === 0) score -= 20;
      if (!best || score > best.score) best = { value: v.value, score, order: i };
    }
  });
  const b = best as { value: number; score: number } | null;
  return { amount: b && b.score > 0 ? b.value : null, fee };
}

function findRef(lines: string[]): string | null {
  const hit = valueAfterLabel(lines, L.ref);
  const pick = (s: string) =>
    normalizeOcr(s)
      .split(/\s+/)
      .map((t) => t.replace(/[^0-9A-Za-z]/g, ''))
      .filter((t) => t.length >= 8 && /\d{4}/.test(t))
      .sort((a, b) => b.length - a.length)[0] ?? null;
  return hit ? pick(hit.value) : null;
}

function findParties(lines: string[]): { from: string | null; to: string | null } {
  let from = cleanName(valueAfterLabel(lines, L.from)?.value ?? null);
  let to = cleanName(valueAfterLabel(lines, L.to)?.value ?? null);
  if (from && to) return { from, to };

  // Unlabelled layout: two name blocks, each followed by a bank/account line.
  const names: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t || moneyIn(t).length || lineMatches(t, L.success)) continue;
    const next = lines.slice(i + 1).find((l) => l.trim())?.trim() ?? '';
    const looksLikeBlock = BANK_LINE.test(normalizeOcr(next)) && !BANK_LINE.test(normalizeOcr(t)) && !findDate([t]);
    if (isNameLike(t) || looksLikeBlock) {
      const n = cleanName(t);
      if (n && !names.includes(n)) names.push(n);
    }
    if (names.length >= 2) break;
  }
  if (!from && !to && names.length >= 2) return { from: names[0], to: names[1] };
  if (!to && names.length) to = names.find((n) => n !== from) ?? null;
  if (!from && names.length >= 2) from = names.find((n) => n !== to) ?? null;
  return { from, to };
}

export function parseSlip(input: OcrLine[] | string, qrText?: string | null): ParsedSlip {
  const ocrLines: OcrLine[] = typeof input === 'string' ? input.split('\n').map((text) => ({ text })) : input;
  const lines = ocrLines.map((l) => normalizeOcr(l.text).replace(/\s+$/, '')).filter((l) => l.trim());
  const filtered = ocrLines.filter((l) => l.text.trim());
  const text = lines.join('\n');

  const qr = parseSlipQr(qrText);
  const { amount, fee } = findAmount(filtered);
  const foundDate = findDate(lines);
  const time = findTime(lines, foundDate?.index);
  const { from, to } = findParties(lines);
  const memoHit = valueAfterLabel(lines, L.memo);
  const memo = memoHit ? collapseSpaces(memoHit.value) || null : null;
  const ref = findRef(lines);
  const bank = bankByCode(qr?.bankCode) ?? guessBankFromText(lines.slice(0, 12));
  const success = lines.some((l) => lineMatches(l, L.success, true));
  const received = lines.slice(0, 4).some((l) => lineMatches(l, L.received, true));

  const isSlip = amount != null && (success || !!qr || !!foundDate || !!ref);
  const dedupeKey = qr?.transRef
    ? `qr:${qr.transRef}`
    : qr?.raw
      ? `qr:${qr.raw}`
      : ref
        ? `ref:${ref}`
        : amount != null && foundDate && time
          ? `at:${foundDate.date}T${time}|${amount.toFixed(2)}`
          : null;

  return {
    isSlip,
    amount,
    fee,
    date: foundDate?.date ?? null,
    time,
    from,
    to,
    memo,
    ref: qr?.transRef ?? ref,
    bank,
    qr,
    received,
    dedupeKey,
    text,
  };
}

/** Does any of the user's own names appear in `name`? */
export function isMe(name: string | null, myNames: string[]): boolean {
  if (!name) return false;
  return myNames.some((n) => {
    const len = skeleton(n).length;
    return len >= 2 && fuzzyIncludes(name, n.trim(), len >= 6 ? 1 : 0);
  });
}

export function guessDirection(slip: Pick<ParsedSlip, 'from' | 'to' | 'received'>, myNames: string[]): 'income' | 'expense' {
  if (slip.received) return 'income';
  const toMe = isMe(slip.to, myNames);
  const fromMe = isMe(slip.from, myNames);
  if (toMe && !fromMe) return 'income';
  return 'expense';
}
