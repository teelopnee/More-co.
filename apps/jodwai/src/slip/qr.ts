// Thai e-slips carry a small "slip verification" QR (EMVCo TLV format):
//   00 → { 00: API id "000001", 01: sending bank code, 02: transaction ref }
//   51 → country "TH", 91 → CRC
// It holds no amount, but the transaction ref is a perfect duplicate key.

export interface SlipQr {
  raw: string;
  bankCode: string | null;
  transRef: string | null;
}

export function parseTlv(s: string): Map<string, string> | null {
  const out = new Map<string, string>();
  let i = 0;
  while (i < s.length) {
    if (i + 4 > s.length) return null;
    const tag = s.slice(i, i + 2);
    const len = Number(s.slice(i + 2, i + 4));
    if (!/^\d{2}$/.test(tag) || Number.isNaN(len)) return null;
    const value = s.slice(i + 4, i + 4 + len);
    if (value.length !== len) return null;
    out.set(tag, value);
    i += 4 + len;
  }
  return out;
}

export function parseSlipQr(raw: string | null | undefined): SlipQr | null {
  if (!raw) return null;
  const text = raw.trim();
  const top = parseTlv(text);
  const inner = top?.get('00') ? parseTlv(top.get('00')!) : null;
  if (top && inner && inner.has('02')) {
    return {
      raw: text,
      bankCode: inner.get('01') ?? null,
      transRef: inner.get('02') ?? null,
    };
  }
  // Unknown QR on a slip: still useful as a duplicate key.
  return { raw: text, bankCode: null, transRef: null };
}
