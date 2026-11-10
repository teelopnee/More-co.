// Pictures of notes on this device (IndexedDB "paewai-media"): each picture as it is kept
// (at most 1600 px on its longer side) and a small copy for the board. The notes only hold
// { id, w, h }; the files also go to the person's sync repo (app.js, lib/notes.js mediaPlan).

import { fit } from './notes.js';

export const MAX_SIDE = 1600;
export const THUMB_SIDE = 520;
const DB_NAME = 'paewai-media';

let dbPromise = null;
const db = () =>
  (dbPromise ??= new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore('img'); // id → { blob, w, h, at }
      r.result.createObjectStore('thumb'); // id → Blob
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  }).catch((err) => {
    dbPromise = null;
    throw err;
  }));

async function run(stores, mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(stores, mode);
    let out;
    const r = fn(t);
    if (r && 'onsuccess' in r) r.onsuccess = () => (out = r.result);
    t.oncomplete = () => resolve(out);
    t.onerror = t.onabort = () => reject(t.error);
  });
}

const urls = new Map(); // "id" (small) / "id:full" → object URL

export const media = {
  async put(id, { blob, thumb, w, h }, at = Date.now()) {
    await run(['img', 'thumb'], 'readwrite', (t) => {
      t.objectStore('img').put({ blob, w, h, at }, id);
      if (thumb) t.objectStore('thumb').put(thumb, id);
    });
  },
  get: (id) => run(['img'], 'readonly', (t) => t.objectStore('img').get(id)).then((v) => v ?? null),
  thumb: (id) => run(['thumb'], 'readonly', (t) => t.objectStore('thumb').get(id)).then((v) => v ?? null),
  async keys() {
    return new Set((await run(['img'], 'readonly', (t) => t.objectStore('img').getAllKeys())) ?? []);
  },
  async has(id) {
    return (await run(['img'], 'readonly', (t) => t.objectStore('img').count(id))) > 0;
  },
  async remove(id) {
    forget(id);
    await run(['img', 'thumb'], 'readwrite', (t) => {
      t.objectStore('img').delete(id);
      t.objectStore('thumb').delete(id);
    });
  },
  /** Pictures no note uses any more, kept at least `keepMs` (an undo may still bring the note back). */
  async sweep(used, keepMs = 86_400_000, now = Date.now()) {
    const d = await db();
    const old = await new Promise((resolve, reject) => {
      const out = [];
      const cur = d.transaction('img').objectStore('img').openCursor();
      cur.onsuccess = () => {
        const c = cur.result;
        if (!c) return resolve(out);
        if (!used.has(c.key) && now - (c.value?.at ?? 0) > keepMs) out.push(c.key);
        c.continue();
      };
      cur.onerror = () => reject(cur.error);
    });
    for (const id of old) await this.remove(id);
    return old;
  },
};

/** An object URL for a picture ('' when it is not on this device). Small copy unless `full`. */
export async function urlFor(id, { full = false } = {}) {
  const key = full ? `${id}:full` : id;
  if (urls.has(key)) return urls.get(key);
  let blob = full ? null : await media.thumb(id);
  blob ??= (await media.get(id))?.blob ?? null;
  if (!blob) return '';
  if (urls.has(key)) return urls.get(key);
  const url = URL.createObjectURL(blob);
  urls.set(key, url);
  return url;
}

export const cachedUrl = (id) => urls.get(id) ?? '';

export function forget(id) {
  for (const key of [id, `${id}:full`]) {
    const url = urls.get(key);
    if (url) URL.revokeObjectURL(url);
    urls.delete(key);
  }
}

// ---- making the copies to keep ---------------------------------------------------------------

async function decode(blob) {
  if (globalThis.createImageBitmap) {
    try {
      return await createImageBitmap(blob, { imageOrientation: 'from-image' });
    } catch {
      // some formats only decode through <img>
    }
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function draw(source, w, h, type, quality) {
  const canvas = Object.assign(document.createElement('canvas'), { width: w, height: h });
  const g = canvas.getContext('2d');
  if (type === 'image/jpeg') {
    g.fillStyle = '#fff'; // see-through parts become white, not black
    g.fillRect(0, 0, w, h);
  }
  g.imageSmoothingQuality = 'high';
  g.drawImage(source, 0, 0, w, h);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode'))), type, quality));
}

/**
 * A picture file (or a drawing's canvas) → what is kept: { blob, thumb, w, h, t }.
 * Photos become JPEG; `png` keeps line drawings sharp. Throws when the file is not a picture.
 */
export async function prepare(file, { png = false } = {}) {
  const source = file instanceof HTMLCanvasElement ? file : await decode(file);
  const sw = source.naturalWidth ?? source.width;
  const sh = source.naturalHeight ?? source.height;
  if (!(sw > 0 && sh > 0)) throw new Error('not a picture');
  const size = fit(sw, sh, MAX_SIDE);
  const small = fit(sw, sh, THUMB_SIDE);
  const type = png ? 'image/png' : 'image/jpeg';
  const blob = await draw(source, size.w, size.h, type, 0.86);
  const thumb = await draw(source, small.w, small.h, png ? 'image/png' : 'image/jpeg', 0.78);
  source.close?.();
  return { blob, thumb, w: size.w, h: size.h, ...(png ? { t: 'png' } : {}) };
}

/** A picture that came from the sync repo: stores it with a small copy made here. */
export async function adopt(id, bytes, type) {
  const blob = new Blob([bytes], { type });
  const made = await prepare(blob, { png: type === 'image/png' });
  // keep the bytes as they are in the repo; only the small copy is new
  await media.put(id, { blob, thumb: made.thumb, w: made.w, h: made.h });
  return made;
}

export async function bytesOf(blob) {
  return new Uint8Array(await blob.arrayBuffer());
}
