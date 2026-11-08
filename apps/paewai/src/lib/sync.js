// Sync between devices through one JSON file in the person's own private GitHub repository.
// Pure functions only (the network part is lib/github.js, the loop is in app.js):
//
//   stamp(prev, next)   every local change gets updatedAt; removed items leave a tombstone
//   merge(local, remote) newest version of each item wins; deletions win over older edits
//   serialize(state)     the file's text: one item per line, stable order, so git diffs stay small
//
// The file is also meant to be read and edited by people and by Claude (see DATA_GUIDE).

import { toTimestamp } from './dates.js';
import { pastedLines } from './sort.js';

export const DATA_PATH = 'paewai.json';
export const INBOX_DIR = 'inbox';
export const GUIDE_PATH = 'CLAUDE.md';
export const LISTS = ['tasks', 'memos', 'shop', 'money', 'recs', 'maps'];
export const PUBLIC_URL = 'https://teelopnee.github.io/More-co./paewai/';
const TOMB_DAYS = 120;

// Fields that only mean something on this device.
const LOCAL_FIELDS = new Set(['alerted']);

const plain = (item) => {
  const out = {};
  for (const k of Object.keys(item).sort()) if (k !== 'updatedAt' && !LOCAL_FIELDS.has(k) && item[k] !== undefined) out[k] = item[k];
  return JSON.stringify(out);
};

/**
 * Marks what changed between two local states: new or edited items get updatedAt = now, removed
 * ones get a tombstone, edited day notes get notesAt. Returns `next` itself when nothing changed.
 */
export function stamp(prev, next, now = Date.now()) {
  if (!prev || prev === next) return next;
  let out = next;
  const tomb = { ...(next.tomb ?? {}) };
  let tombChanged = false;
  for (const list of LISTS) {
    const before = new Map((prev[list] ?? []).map((i) => [i.id, i]));
    const after = next[list] ?? [];
    let changed = false;
    const items = after.map((item) => {
      const old = before.get(item.id);
      before.delete(item.id);
      if (tomb[item.id] != null) {
        delete tomb[item.id];
        tombChanged = true;
      }
      if (old === item || (old && plain(old) === plain(item))) return old?.updatedAt === item.updatedAt ? item : { ...item, updatedAt: old.updatedAt };
      changed = true;
      return { ...item, updatedAt: Math.max(now, (item.updatedAt ?? 0) + 1) };
    });
    for (const id of before.keys()) {
      tomb[id] = now;
      tombChanged = true;
    }
    if (changed) out = { ...out, [list]: items };
  }
  if (tombChanged) out = { ...out, tomb };
  const notesAt = { ...(next.notesAt ?? {}) };
  let notesChanged = false;
  for (const day of new Set([...Object.keys(prev.notes ?? {}), ...Object.keys(next.notes ?? {})])) {
    if ((prev.notes?.[day] ?? '') !== (next.notes?.[day] ?? '')) {
      notesAt[day] = now;
      notesChanged = true;
    }
  }
  if (notesChanged) out = { ...out, notesAt };
  if (JSON.stringify(prev.settings ?? {}) !== JSON.stringify(next.settings ?? {})) out = { ...out, settingsAt: now };
  return out;
}

/** Same time on both sides but different content: pick the same one on every device. */
const later = (a, b) => (a.updatedAt ?? 0) - (b.updatedAt ?? 0) || (plain(a) > plain(b) ? 1 : plain(a) < plain(b) ? -1 : 0);

const isPast = (t, now) => !!(t.day && t.time && toTimestamp(t.day, t.time) <= now);

/**
 * Combines this device's state with the file's. Device-only parts (focus timer, prefs) stay as
 * they are here. Pure: the result is a new state, or `local` itself when nothing came in.
 */
export function merge(local, remote, now = Date.now()) {
  if (!remote) return local;
  const tomb = { ...(remote.tomb ?? {}) };
  for (const [id, at] of Object.entries(local.tomb ?? {})) if (!(tomb[id] >= at)) tomb[id] = at;
  const cutoff = now - TOMB_DAYS * 86_400_000;
  for (const [id, at] of Object.entries(tomb)) if (at < cutoff) delete tomb[id];

  const out = { ...local, tomb };
  for (const list of LISTS) {
    const mine = new Map((local[list] ?? []).map((i) => [i.id, i]));
    const theirsById = new Map((remote[list] ?? []).map((i) => [i.id, i]));
    const result = [];
    const seen = new Set();
    const keep = (item) => !(tomb[item.id] >= (item.updatedAt ?? 0));
    for (const item of local[list] ?? []) {
      const theirs = theirsById.get(item.id);
      let pick = theirs && later(theirs, item) > 0 ? theirs : item;
      if (pick !== item && list === 'tasks') {
        // Keep "already announced here" unless the reminder moved to another time.
        const moved = pick.day !== item.day || pick.time !== item.time;
        pick = { ...pick, alerted: moved ? isPast(pick, now) : !!item.alerted };
      }
      seen.add(item.id);
      if (keep(pick)) result.push(pick);
    }
    for (const item of remote[list] ?? []) {
      if (seen.has(item.id) || mine.has(item.id) || !keep(item)) continue;
      seen.add(item.id);
      result.push(list === 'tasks' ? { ...item, alerted: isPast(item, now) } : item);
    }
    out[list] = result;
  }

  const notes = {};
  const notesAt = {};
  const days = new Set([...Object.keys(local.notes ?? {}), ...Object.keys(remote.notes ?? {}), ...Object.keys(local.notesAt ?? {}), ...Object.keys(remote.notesAt ?? {})]);
  for (const day of days) {
    const a = { at: local.notesAt?.[day] ?? 0, text: local.notes?.[day] ?? '' };
    const b = { at: remote.notesAt?.[day] ?? 0, text: remote.notes?.[day] ?? '' };
    const win = b.at > a.at || (b.at === a.at && b.text > a.text) ? b : a;
    if (win.text) notes[day] = win.text;
    if (win.at) notesAt[day] = win.at;
  }
  out.notes = notes;
  out.notesAt = notesAt;

  const focusLog = { ...(local.focusLog ?? {}) };
  for (const [day, ms] of Object.entries(remote.focusLog ?? {})) focusLog[day] = Math.max(focusLog[day] ?? 0, ms);
  out.focusLog = focusLog;

  if ((remote.settingsAt ?? 0) > (local.settingsAt ?? 0)) {
    out.settings = { ...(remote.settings ?? {}) };
    out.settingsAt = remote.settingsAt;
  }
  return sameData(out, local) ? local : out;
}

const order = {
  tasks: (a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1),
  memos: (a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1),
  shop: (a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1),
  money: (a, b) => a.at - b.at || (a.id < b.id ? -1 : 1),
  recs: (a, b) => a.at - b.at || (a.id < b.id ? -1 : 1),
  maps: (a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1),
};

const sortedObject = (obj) => Object.fromEntries(Object.entries(obj ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));

/** What goes into the file: the shared parts only, in a stable order. */
export function shared(state) {
  const strip = (item) => {
    const out = {};
    for (const k of Object.keys(item)) if (!LOCAL_FIELDS.has(k) && item[k] !== undefined) out[k] = item[k];
    return out;
  };
  return {
    app: 'paewai',
    v: 2,
    tasks: [...(state.tasks ?? [])].sort(order.tasks).map(strip),
    memos: [...(state.memos ?? [])].sort(order.memos).map(strip),
    shop: [...(state.shop ?? [])].sort(order.shop).map(strip),
    money: [...(state.money ?? [])].sort(order.money).map(strip),
    recs: [...(state.recs ?? [])].sort(order.recs).map(strip),
    maps: [...(state.maps ?? [])].sort(order.maps).map(strip),
    notes: sortedObject(state.notes),
    notesAt: sortedObject(state.notesAt),
    focusLog: sortedObject(state.focusLog),
    settings: sortedObject(state.settings),
    settingsAt: state.settingsAt ?? 0,
    tomb: sortedObject(state.tomb),
  };
}

/** The file's text: readable, one item per line. */
export function serialize(state) {
  const data = shared(state);
  const lines = ['{'];
  const keys = Object.keys(data);
  keys.forEach((key, n) => {
    const comma = n < keys.length - 1 ? ',' : '';
    const value = data[key];
    if (Array.isArray(value)) {
      if (!value.length) lines.push(`  ${JSON.stringify(key)}: []${comma}`);
      else {
        lines.push(`  ${JSON.stringify(key)}: [`);
        value.forEach((item, i) => lines.push(`    ${JSON.stringify(item)}${i < value.length - 1 ? ',' : ''}`));
        lines.push(`  ]${comma}`);
      }
    } else lines.push(`  ${JSON.stringify(key)}: ${JSON.stringify(value)}${comma}`);
  });
  lines.push('}');
  return lines.join('\n') + '\n';
}

export const sameData = (a, b) => serialize(a) === serialize(b);

// ---------------------------------------------------------------------------
// Settings for this device (kept apart from the data so backups never carry the token)

export const SYNC_KEY = 'paewai:sync';

/** "owner/name", or null. Accepts a pasted github.com URL too. */
export function cleanRepo(input) {
  const s = String(input ?? '')
    .trim()
    .replace(/^https?:\/\/(?:www\.)?github\.com\//i, '')
    .replace(/\.git$/i, '')
    .replace(/\/+$/, '');
  const m = /^([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100})$/.exec(s);
  return m ? `${m[1]}/${m[2]}` : null;
}

const looksLikeToken = (t) => typeof t === 'string' && /^(?:github_pat_|gh[pousr]_)[A-Za-z0-9_]{20,}$/.test(t.trim());

const b64url = {
  encode(text) {
    const bytes = new TextEncoder().encode(text);
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },
  decode(s) {
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
    return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  },
};

/** A code (or a link) another device can use to join: it carries the repository and the token. */
export function pairCode({ repo, token }) {
  return `paewai1.${b64url.encode(JSON.stringify({ r: repo, t: token }))}`;
}

export const pairLink = (cfg, base = PUBLIC_URL) => `${base}#pair=${pairCode(cfg)}`;

/** Reads a pairing code, a pairing link, or text that contains one. Returns { repo, token } or null. */
export function readPairCode(input) {
  const m = /paewai1\.([A-Za-z0-9_-]+)/.exec(String(input ?? ''));
  if (!m) return null;
  try {
    const { r, t } = JSON.parse(b64url.decode(m[1]));
    const repo = cleanRepo(r);
    return repo && looksLikeToken(t) ? { repo, token: t.trim() } : null;
  } catch {
    return null;
  }
}

export { looksLikeToken };

// ---------------------------------------------------------------------------
// The guide written next to the data, for people and for Claude

export const DATA_GUIDE = `# แปะไว้ — ข้อมูล

ไฟล์ในที่เก็บนี้คือข้อมูลของแอป **แปะไว้** (${PUBLIC_URL}) ที่ซิงก์กันระหว่างแท็บเล็ต มือถือ และ iPhone
แอปอ่านและเขียนไฟล์เหล่านี้เองผ่าน GitHub API ทุกครั้งที่ซิงก์

## เพิ่มเรื่องใหม่ (วิธีที่ง่ายและปลอดภัยที่สุด)

สร้างไฟล์ข้อความในโฟลเดอร์ \`${INBOX_DIR}/\` ชื่ออะไรก็ได้ เช่น \`${INBOX_DIR}/2026-11-08-1.txt\`
หนึ่งบรรทัด = หนึ่งเรื่อง เขียนแบบที่คนพิมพ์ในแอป แล้วแอปจะจัดประเภทให้เองตอนซิงก์ครั้งถัดไป และลบไฟล์ทิ้ง

\`\`\`
พรุ่งนี้ 9 โมง โทรหาหมอ
ทุกวัน 2 ทุ่ม กินยา
ซื้อนม ไข่ ขนมปัง
ข้าวมันไก่ 50
โน้ต: รหัส wifi บ้าน abc12345
\`\`\`

ขึ้นต้นด้วย \`งาน:\` \`โน้ต:\` \`ซื้อ:\` หรือ \`จ่าย:\` เพื่อบอกประเภทตรง ๆ
วันที่เขียนได้ทั้ง \`วันนี้\` \`พรุ่งนี้\` \`วันศุกร์\` \`15/11\` \`15 พ.ย.\` และเวลา \`14:30\` \`บ่าย 2\` \`2 ทุ่ม\`

## \`${DATA_PATH}\`

- \`tasks\`: งานและเตือน \`{ id, text, day: "YYYY-MM-DD" | null, time: "HH:MM" | null, done, doneAt, createdAt, updatedAt, repeat, streak }\`
  - \`day: null\` = อยู่ในกล่องรับ
  - \`repeat\`: \`daily\`, \`weekdays\`, \`weekly:0-6\` (0 = อาทิตย์), \`monthly:1-31\`, \`yearly\` หรือ \`null\`
- \`memos\`: โน้ตย่อ \`{ id, text, pinned, createdAt, updatedAt }\`
- \`shop\`: ของต้องซื้อ \`{ id, text, cat, done, doneAt, createdAt, updatedAt }\`
- \`money\`: รายจ่าย \`{ id, text, amount (บาท), cat, at, updatedAt }\`
- \`recs\`: บันทึกเสียง \`{ id, title, at, durationMs, transcript, summary, mapId, device }\` (ไฟล์เสียงอยู่ในเครื่องที่อัด ไม่อยู่ใน repo)
- \`maps\`: มายด์แมป \`{ id, nodes: [{ id, parent, text }], source, createdAt, updatedAt }\` โหนดที่ \`parent: null\` คือหัวข้อกลาง
- \`notes\`: บันทึกประจำวัน \`{ "YYYY-MM-DD": "ข้อความ" }\` และ \`notesAt\` เวลาที่แก้ล่าสุดของแต่ละวัน
- \`focusLog\`: เวลาโฟกัสต่อวัน (มิลลิวินาที) · \`settings\`: ค่าที่ใช้ร่วมกัน เช่น \`budget\` (งบต่อเดือน)
- \`tomb\`: \`{ id: เวลาที่ลบ }\` ของที่ถูกลบ เพื่อไม่ให้เครื่องอื่นเอากลับมา
- เวลาทั้งหมดเป็นมิลลิวินาทีแบบ Unix (\`Date.now()\`) วันและเวลาเป็นเวลาไทย

ถ้าจะแก้ไฟล์นี้ตรง ๆ: ใส่ \`updatedAt\` เป็นเวลาปัจจุบันในรายการที่แก้ (ไม่อย่างนั้นแอปอาจเก็บรุ่นเก่าไว้)
ใช้ \`id\` ใหม่ที่ไม่ซ้ำสำหรับรายการใหม่ และอย่าลบ \`tomb\`
`;

export const INBOX_README = `# inbox

วางไฟล์ข้อความไว้ที่นี่ (ชื่ออะไรก็ได้ เช่น \`2026-11-08-1.txt\`) หนึ่งบรรทัด = หนึ่งเรื่อง
แปะไว้จะจัดเข้าที่ให้ (งาน เตือน ซื้อ จ่าย โน้ต) ตอนซิงก์ครั้งถัดไป แล้วลบไฟล์ทิ้ง · ไฟล์นี้ (README) ไม่ถูกลบ
`;

// ---------------------------------------------------------------------------
// One round of syncing

const INBOX_MAX_FILES = 30;
const INBOX_MAX_BYTES = 64 * 1024;
const isInboxFile = (f) => !f.name.startsWith('.') && !/^readme(\.\w+)?$/i.test(f.name) && f.size <= INBOX_MAX_BYTES;

/**
 * Pulls what was dropped into inbox/, merges with the data file and writes it back when needed.
 * `add(state, line, now)` files one inbox line (the app classifies it like typed text).
 * Resolves to { state, inbox, wrote }. Never overwrites a data file it cannot read.
 */
export async function syncOnce({ gh, local, add, readFile, now = Date.now(), device = 'เครื่องนี้' }) {
  let state = local;
  let inbox = 0;
  const files = (await gh.list(INBOX_DIR)).filter(isInboxFile).slice(0, INBOX_MAX_FILES);
  for (const f of files) {
    const file = await gh.read(f.path);
    if (!file) continue;
    // Whoever deletes the file first files its lines: no duplicates when two devices sync at once.
    if (!(await gh.remove(f.path, file.sha, `แปะไว้: รับ ${f.name} (${device})`))) continue;
    for (const line of pastedLines(file.text)) {
      state = stamp(state, add(state, line, now + inbox), now + inbox);
      inbox++;
    }
  }

  for (let attempt = 0; ; attempt++) {
    const file = await gh.read(DATA_PATH);
    let remote = null;
    if (file) {
      try {
        remote = readFile(JSON.parse(file.text));
      } catch {
        remote = null;
      }
      if (!remote) throw Object.assign(new Error(`${DATA_PATH} ใน repo อ่านไม่ได้ (JSON เสีย) แก้ไฟล์ให้ถูกก่อน แปะไว้จะไม่เขียนทับ`), { status: -1 });
    }
    const merged = merge(state, remote, now);
    const text = serialize(merged);
    if (file && file.text === text) return { state: merged, inbox, wrote: false };
    try {
      await gh.write(DATA_PATH, text, file?.sha ?? null, `แปะไว้: ซิงก์จาก ${device}`);
      return { state: merged, inbox, wrote: true };
    } catch (err) {
      // Another device wrote in between: read again and merge with theirs.
      if (attempt < 3 && (err?.status === 409 || err?.status === 422)) {
        state = merged;
        continue;
      }
      throw err;
    }
  }
}
