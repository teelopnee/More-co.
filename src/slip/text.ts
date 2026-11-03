// Text helpers tuned for Thai OCR output.

const THAI_DIGITS = '๐๑๒๓๔๕๖๗๘๙';

/** Fix common OCR artefacts so regexes can match reliably. */
export function normalizeOcr(input: string): string {
  let s = input.normalize('NFC');
  // Tesseract often emits sara am as nikhahit + sara aa (ํา) instead of ำ.
  s = s.replace(/ํา/g, 'ำ');
  s = s.replace(/[๐-๙]/g, (d) => String(THAI_DIGITS.indexOf(d)));
  s = s.replace(/[“”«»]/g, '"').replace(/[‘’]/g, "'");
  s = s.replace(/[，]/g, ',');
  return s;
}

// Marks that OCR frequently drops, adds or swaps. Removing them gives a
// "skeleton" that survives most misreads (e.g. "ร้านค้า" vs "รานคา").
const UNSTABLE_MARKS = /[ัิ-ฺ็-๎.:\s\-_'"|]/g;

/** Thai/Latin skeleton: lower-case, sara am→aa, no tone marks/vowel marks/punctuation. */
export function skeleton(input: string): string {
  return normalizeOcr(input).toLowerCase().replace(/ำ/g, 'า').replace(UNSTABLE_MARKS, '');
}

/** Levenshtein distance, early-exit when above `max`. */
export function editDistance(a: string, b: string, max = Infinity): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      cur.push(v);
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

/**
 * Does `haystack` contain something close to `needle` (both compared as skeletons)?
 * By default short needles must match exactly; longer ones tolerate one misread
 * per 5 chars. Pass `tolerance` to override (0 = exact skeleton match).
 */
export function fuzzyIncludes(haystack: string, needle: string, tolerance?: number): boolean {
  const h = skeleton(haystack);
  const n = skeleton(needle);
  if (!n) return false;
  if (h.includes(n)) return true;
  const tol = tolerance ?? (n.length < 4 ? 0 : Math.floor(n.length / 5) || 1);
  if (tol <= 0) return false;
  for (let len = n.length - tol; len <= n.length + tol; len++) {
    if (len <= 0 || len > h.length) continue;
    for (let i = 0; i + len <= h.length; i++) {
      if (editDistance(h.slice(i, i + len), n, tol) <= tol) return true;
    }
  }
  return false;
}

/** Index in `line` right after a fuzzy match of `label` at the line start (or -1). */
export function afterLabel(line: string, labels: readonly string[]): string | null {
  // Split on the first run of 2+ spaces or a colon: "label:    value".
  const m = line.match(/^(.*?)(?:\s*[:：]\s*|\s{2,})(.*)$/);
  const head = m ? m[1] : line;
  const rest = m ? m[2] : '';
  for (const label of labels) {
    const hs = skeleton(head);
    const ls = skeleton(label);
    if (!ls) continue;
    if (hs === ls || (ls.length >= 4 && editDistance(hs, ls, 1) <= 1)) return rest.trim();
    // Label followed by value with a single space ("From MR A B").
    if (skeleton(line).startsWith(ls)) {
      const words = line.trim().split(/\s+/);
      for (let k = 1; k <= Math.min(4, words.length); k++) {
        if (skeleton(words.slice(0, k).join(' ')) === ls) return words.slice(k).join(' ').trim();
      }
    }
  }
  return null;
}

export function collapseSpaces(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}
