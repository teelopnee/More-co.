// Notes as cards (the "โน้ต" board): a note has a title, text or a checklist, a colour, labels and
// pictures; it can be pinned, archived or put in the bin. Pure functions only: the pictures
// themselves live on the device (lib/media.js) and in the person's sync repo (media/<id>.jpg).

/** Card colours (the shades are in styles.css, light and dark). */
export const NOTE_COLORS = ['rose', 'peach', 'sand', 'mint', 'sea', 'sky', 'lilac', 'pink', 'clay', 'stone'];
export const COLOR_NAMES = { rose: 'แดง', peach: 'ส้ม', sand: 'เหลือง', mint: 'เขียว', sea: 'เขียวน้ำทะเล', sky: 'ฟ้า', lilac: 'ม่วง', pink: 'ชมพู', clay: 'น้ำตาล', stone: 'เทา' };

export const MAX_IMAGES = 20;
export const MAX_LABELS = 10;
export const TRASH_DAYS = 7;

const ID = /^[a-z0-9]{6,40}$/;

/** One picture of a note: { id, w, h } (+ t: 'png' for drawings; photos are JPEG). */
export function cleanImage(i) {
  if (!i || typeof i.id !== 'string' || !ID.test(i.id)) return null;
  const n = (v) => (Number.isFinite(v) && v > 0 ? Math.min(Math.round(v), 20_000) : 0);
  return { id: i.id, w: n(i.w), h: n(i.h), ...(i.t === 'png' ? { t: 'png' } : {}) };
}

export function cleanImages(list) {
  const seen = new Set();
  return (Array.isArray(list) ? list : [])
    .map(cleanImage)
    .filter((i) => i && !seen.has(i.id) && seen.add(i.id))
    .slice(0, MAX_IMAGES);
}

/** "#งาน " → "งาน" */
export function cleanLabel(s) {
  return String(s ?? '').replace(/^[#\s]+/, '').replace(/[\s,]+/g, ' ').trim().slice(0, 30);
}

export function cleanLabels(list) {
  const seen = new Set();
  return (Array.isArray(list) ? list : [])
    .map(cleanLabel)
    .filter((l) => l && !seen.has(l.toLowerCase()) && seen.add(l.toLowerCase()))
    .slice(0, MAX_LABELS);
}

/** The optional fields of a note, valid or left out (used by store.sanitize and when saving). */
export function cleanExtras(m) {
  const out = {};
  const title = typeof m?.title === 'string' ? m.title.replace(/\s+/g, ' ').trim().slice(0, 200) : '';
  if (title) out.title = title;
  if (NOTE_COLORS.includes(m?.color)) out.color = m.color;
  const labels = cleanLabels(m?.labels);
  if (labels.length) out.labels = labels;
  const images = cleanImages(m?.images);
  if (images.length) out.images = images;
  if (m?.list) out.list = true;
  if (m?.archived) out.archived = true;
  if (Number.isFinite(m?.trashedAt) && m.trashedAt > 0) out.trashedAt = m.trashedAt;
  return out;
}

export const isEmptyNote = (m) => !String(m?.text ?? '').trim() && !String(m?.title ?? '').trim() && !(m?.images?.length > 0);

// ---- "#label" typed in the capture box ------------------------------------------------------

const TAG = /(^|\s)#([\p{L}][\p{L}\p{M}\p{N}_-]{0,29})(?=\s|$)/gu;

/** "ไอเดียคลิป #งาน #ยูทูบ" → { text: 'ไอเดียคลิป', labels: ['งาน', 'ยูทูบ'] } */
export function extractLabels(text) {
  const labels = [];
  const rest = String(text ?? '').replace(TAG, (m, lead, tag) => {
    labels.push(tag);
    return lead;
  });
  return { text: labels.length ? rest.replace(/[ \t]{2,}/g, ' ').trim() : String(text ?? ''), labels: cleanLabels(labels) };
}

/** Every label in use, most used first: [{ name, count }] (notes in the bin do not count). */
export function allLabels(memos) {
  const count = new Map();
  for (const m of memos ?? []) {
    if (m.trashedAt) continue;
    for (const l of m.labels ?? []) count.set(l, (count.get(l) ?? 0) + 1);
  }
  return [...count].map(([name, n]) => ({ name, count: n })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'th'));
}

// ---- checklists -----------------------------------------------------------------------------
// A checklist is a note with `list: true` whose text has one item per line: "[ ] นม", "[x] ไข่".

const ITEM = /^\s*(?:[-*+•]\s*)?\[( |x|X|✓|✔)?\]\s?(.*)$/u;

export function listItems(text) {
  return String(text ?? '')
    .split('\n')
    .map((line) => {
      const m = ITEM.exec(line);
      if (m) return { done: !!(m[1] && m[1].trim()), text: m[2].trim() };
      return { done: false, text: line.replace(/^\s*(?:[-*+•]|\d{1,3}[.)])\s+/, '').trim() };
    })
    .filter((i) => i.text);
}

export const listText = (items) => items.filter((i) => String(i.text ?? '').trim()).map((i) => `[${i.done ? 'x' : ' '}] ${String(i.text).trim()}`).join('\n');

/** Plain lines again when the checklist is switched off. */
export const plainText = (text) => listItems(text).map((i) => i.text).join('\n');

/** Ticks or unticks item `index` of a checklist's text. */
export function toggleItem(text, index) {
  const items = listItems(text);
  if (!items[index]) return text;
  items[index] = { ...items[index], done: !items[index].done };
  return listText(items);
}

// ---- which notes to show ---------------------------------------------------------------------

/**
 * filter: 'all' (not archived, not in the bin) · 'archive' · 'trash' · 'images' · 'lists';
 * label: only notes with this label. Pinned first, then newest.
 */
export function visibleNotes(memos, { filter = 'all', label = '' } = {}) {
  const out = (memos ?? []).filter((m) => {
    if (filter === 'trash') return !!m.trashedAt;
    if (m.trashedAt) return false;
    if (filter === 'archive') return !!m.archived;
    if (m.archived) return false;
    if (label && !(m.labels ?? []).includes(label)) return false;
    if (filter === 'images') return m.images?.length > 0;
    if (filter === 'lists') return !!m.list;
    return true;
  });
  return out.sort((a, b) => (filter === 'trash' ? b.trashedAt - a.trashedAt : Number(!!b.pinned) - Number(!!a.pinned) || b.updatedAt - a.updatedAt));
}

/** Notes that have been in the bin longer than `days` (to delete for good). */
export const expired = (memos, now = Date.now(), days = TRASH_DAYS) => (memos ?? []).filter((m) => m.trashedAt && now - m.trashedAt > days * 86_400_000).map((m) => m.id);

/** What a note says, for search and for the card when it has no title. */
export function noteText(m) {
  return [m.title ?? '', m.list ? plainText(m.text) : m.text ?? '', ...(m.labels ?? []).map((l) => `#${l}`)].filter(Boolean).join('\n');
}

// ---- the board: cards dealt into columns, each next card to the shortest column -----------------

/** A rough height of a card, in pixels for a column about 240 px wide. */
export function cardHeight(m) {
  let h = 34;
  const imgs = m.images ?? [];
  if (imgs.length === 1) h += Math.max(90, Math.min(300, imgs[0].w && imgs[0].h ? (imgs[0].h / imgs[0].w) * 240 : 160));
  else if (imgs.length) h += imgs.length <= 3 ? 110 : 200;
  if (m.title) h += 26 * Math.ceil(Math.min(m.title.length, 80) / 22);
  const lines = String(m.text ?? '').split('\n');
  if (m.list) h += Math.min(lines.length, 7) * 26;
  else h += Math.min(9, lines.reduce((n, l) => n + Math.max(1, Math.ceil(l.length / 28)), 0)) * 22;
  if (m.labels?.length) h += 30;
  return h;
}

export function columnsFor(width) {
  if (width < 360) return 1;
  if (width < 620) return 2;
  if (width < 900) return 3;
  if (width < 1180) return 4;
  return 5;
}

/** → `cols` arrays of notes; reading order stays left to right. */
export function deal(memos, cols) {
  const n = Math.max(1, cols);
  const out = Array.from({ length: n }, () => []);
  const heights = new Array(n).fill(0);
  for (const m of memos) {
    let best = 0;
    for (let i = 1; i < n; i++) if (heights[i] < heights[best] - 24) best = i;
    out[best].push(m);
    heights[best] += cardHeight(m) + 12;
  }
  return out;
}

// ---- pictures: what to send to and fetch from the sync repo ------------------------------------

export const MEDIA_DIR = 'media';
export const mediaName = (img) => `${img.id}.${img.t === 'png' ? 'png' : 'jpg'}`;
export const mediaPath = (img) => `${MEDIA_DIR}/${mediaName(img)}`;

/** Every picture the notes refer to: Map id → image. */
export function imagesOf(memos) {
  const out = new Map();
  for (const m of memos ?? []) for (const i of m.images ?? []) out.set(i.id, i);
  return out;
}

/**
 * need: Map id → image (from the notes) · local: ids stored on this device · known: ids this
 * device knows are in the repo. → what to do next, a few at a time: send what the repo lacks,
 * fetch what this device lacks, and remove from the repo what no note uses any more.
 */
export function mediaPlan({ need, local, known }, { batch = 6 } = {}) {
  const upload = [];
  const download = [];
  for (const [id, img] of need) {
    if (!local.has(id)) download.push(img);
    else if (!known.has(id)) upload.push(img);
  }
  const remove = [...known].filter((id) => !need.has(id));
  return { upload: upload.slice(0, batch), download: download.slice(0, batch), remove: remove.slice(0, batch), more: upload.length > batch || download.length > batch || remove.length > batch };
}

/** Largest size that fits `max` on its longer side, never larger than the picture. */
export function fit(w, h, max) {
  if (!(w > 0 && h > 0)) return { w: 0, h: 0 };
  const k = Math.min(1, max / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}
