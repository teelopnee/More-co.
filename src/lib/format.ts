const money0 = new Intl.NumberFormat('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const money2 = new Intl.NumberFormat('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Satang → "1,250" or "1,250.50". */
export function fmtMoney(satang: number): string {
  const baht = Math.abs(satang) / 100;
  return satang % 100 === 0 ? money0.format(baht) : money2.format(baht);
}

export function fmtBaht(satang: number, sign?: '+' | '-'): string {
  return `${sign ? (sign === '-' ? '−' : '+') : satang < 0 ? '−' : ''}฿${fmtMoney(satang)}`;
}

/** Compact axis label: 950, 1.2K, 15K. */
export function fmtCompact(baht: number): string {
  if (baht >= 1_000_000) return `${+(baht / 1_000_000).toFixed(1)}M`;
  if (baht >= 1_000) return `${+(baht / 1_000).toFixed(baht >= 10_000 ? 0 : 1)}K`;
  return String(Math.round(baht));
}

const pad = (n: number) => String(n).padStart(2, '0');

export function localDate(d = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export function localTime(d = new Date()): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export const monthOf = (date: string) => date.slice(0, 7);
export const thisMonth = () => monthOf(localDate());

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

export function daysInMonth(month: string): number {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

const parseLocal = (date: string) => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d);
};

const monthFmt = new Intl.DateTimeFormat('th-TH', { month: 'long', year: 'numeric' });
const dayFmt = new Intl.DateTimeFormat('th-TH', { weekday: 'long', day: 'numeric', month: 'short' });
const shortFmt = new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'short', year: '2-digit' });

export function fmtMonth(month: string): string {
  return monthFmt.format(parseLocal(`${month}-01`));
}

export function fmtDayHeader(date: string): string {
  const today = localDate();
  const y = new Date();
  y.setDate(y.getDate() - 1);
  if (date === today) return 'วันนี้';
  if (date === localDate(y)) return 'เมื่อวาน';
  return dayFmt.format(parseLocal(date));
}

export function fmtShortDate(date: string): string {
  return shortFmt.format(parseLocal(date));
}

/** Parse a user-typed amount ("1,250.5") into satang, or null. */
export function parseAmountInput(s: string): number | null {
  const clean = s.replace(/[,\s฿]/g, '');
  if (!clean || !/^\d*\.?\d{0,2}$/.test(clean)) return null;
  const v = Number(clean);
  return Number.isFinite(v) && v > 0 ? Math.round(v * 100) : null;
}

export function amountToInput(satang: number | null | undefined): string {
  if (satang == null) return '';
  return satang % 100 === 0 ? String(satang / 100) : (satang / 100).toFixed(2);
}
