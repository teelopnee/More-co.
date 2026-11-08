// Smart sorting: what did the person just type?
//   reminder/task → งาน (with a day, time or repeat it becomes a reminder)
//   note          → โน้ต (an idea, a code, a phone number, a link, a place…)
//   shop          → ของต้องซื้อ, split into items and sorted by store section
//   money         → รายจ่าย, with the amount and a spending category
// Runs on the device with word lists and rules; nothing leaves the tablet.

import { parseWhen } from './dates.js';

export const KINDS = ['task', 'note', 'shop', 'money'];
export const KIND_LABELS = { task: 'งาน', note: 'โน้ต', shop: 'ของต้องซื้อ', money: 'รายจ่าย' };

const ACTION_VERBS = [
  'ทำ', 'ส่ง', 'โทร', 'จ่าย', 'จอง', 'นัด', 'ไป', 'รับ', 'ซ่อม', 'ล้าง', 'ซัก', 'เก็บ', 'ตอบ', 'เขียน', 'อ่าน',
  'เช็ค', 'เช็ก', 'ตรวจ', 'ต่อ', 'เติม', 'แก้', 'อัปเดต', 'อัพเดท', 'ติดต่อ', 'คุย', 'ประชุม', 'ยื่น', 'สมัคร',
  'ยกเลิก', 'คืน', 'ถอน', 'โอน', 'ฝาก', 'ทิ้ง', 'ปลูก', 'รดน้ำ', 'ให้', 'กิน', 'ทาน', 'ตื่น', 'ออก', 'วิ่ง',
  'ว่ายน้ำ', 'เรียน', 'สอบ', 'ทบทวน', 'เตรียม', 'จัด', 'ปริ้น', 'พิมพ์', 'สแกน', 'แชร์', 'โพสต์', 'อัด', 'ตัด',
  'หา', 'เอา', 'พา', 'ลงทะเบียน', 'ชาร์จ', 'ปิด', 'เปิด', 'ย้าย', 'ขาย', 'แพ็ค', 'แพ็ก', 'ทัก', 'บอก', 'ถาม',
  'เตือน', 'ฝึก', 'ซ้อม', 'ดู', 'นอน', 'ซื้อ', 'โหลด', 'ติดตั้ง', 'อาบ', 'ให้อาหาร', 'พบ', 'เจอ', 'สั่ง', 'ปั่น',
  'call', 'email', 'buy', 'pay', 'send', 'book', 'fix', 'check', 'finish', 'submit', 'renew', 'clean', 'reply',
  'meet', 'visit', 'pick', 'return', 'cancel', 'print', 'order', 'write', 'read', 'call', 'review', 'prepare',
];

const NOTE_STARTS = [
  'ไอเดีย', 'idea', 'รหัส', 'password', 'pass', 'wifi', 'ไวไฟ', 'pin', 'เบอร์', 'ที่อยู่', 'สูตร', 'คำคม', 'quote',
  'ร้าน', 'หนัง', 'ซีรีส์', 'เพลง', 'อยากได้', 'อยากดู', 'อยากอ่าน', 'อยากไป', 'อยากลอง', 'อยากกิน', 'คิดว่า',
  'รู้สึก', 'จำไว้', 'ข้อคิด', 'บันทึก', 'ลิสต์', 'แรงบันดาลใจ', 'เลขบัญชี', 'บัญชี', 'ไซส์', 'size', 'ชื่อ',
  'วันนี้ได้เรียนรู้', 'ได้เรียนรู้', 'ข้อมูล', 'สรุป', 'โน้ต', 'note', 'memo',
];

const EXPENSE_CATS = [
  ['อาหาร', ['ข้าว', 'ก๋วยเตี๋ยว', 'กาแฟ', 'ชา', 'นม', 'ขนม', 'อาหาร', 'มื้อ', 'ส้มตำ', 'หมูกระทะ', 'ชาบู', 'บุฟเฟ่ต์', 'พิซซ่า',
    'เบอร์เกอร์', 'kfc', 'mk', 'starbucks', 'คาเฟ่', 'cafe', 'ผัด', 'แกง', 'ต้ม', 'ไก่', 'หมู', 'ปลา', 'ไอติม', 'ไอศกรีม', 'เค้ก',
    'ขนมปัง', 'น้ำดื่ม', 'โค้ก', 'เบียร์', 'food', 'lunch', 'dinner', 'coffee', 'lineman', 'foodpanda', 'grabfood', 'ข้าวมันไก่',
    'ราดหน้า', 'สุกี้', 'ซูชิ', 'ราเมง', 'ปิ้งย่าง', 'ติ่มซำ', 'โจ๊ก', 'น้ำปั่น', 'ชานม', 'ชาไข่มุก']],
  ['เดินทาง', ['น้ำมัน', 'แก๊ส', 'ทางด่วน', 'จอดรถ', 'ที่จอด', 'แท็กซี่', 'taxi', 'grab', 'bolt', 'วิน', 'มอไซค์', 'bts', 'mrt',
    'รถไฟ', 'รถเมล์', 'เรือ', 'ตั๋ว', 'ค่ารถ', 'ค่าเดินทาง', 'เครื่องบิน', 'ล้างรถ', 'ค่าทางด่วน', 'easy pass']],
  ['บิล ค่าบ้าน', ['ค่าไฟ', 'ค่าน้ำ', 'ค่าเน็ต', 'เน็ต', 'อินเทอร์เน็ต', 'ค่าโทรศัพท์', 'ค่ามือถือ', 'ค่าเช่า', 'ค่าห้อง',
    'ค่าส่วนกลาง', 'ประกัน', 'ภาษี', 'บัตรเครดิต', 'ผ่อน', 'ค่างวด', 'ais', 'true', 'dtac', '3bb']],
  ['ของใช้', ['7-11', 'เซเว่น', 'โลตัส', 'lotus', 'บิ๊กซี', 'big c', 'แม็คโคร', 'makro', 'ท็อปส์', 'tops', 'ซุปเปอร์',
    'ตลาด', 'ของใช้', 'สบู่', 'ยาสีฟัน', 'ทิชชู่', 'ผงซักฟอก', 'แชมพู']],
  ['สุขภาพ', ['ยา', 'หมอ', 'คลินิก', 'โรงพยาบาล', 'ทำฟัน', 'ฟิตเนส', 'ยิม', 'gym', 'วิตามิน', 'นวด']],
  ['บันเทิง', ['โรงหนัง', 'ดูหนัง', 'เกม', 'netflix', 'spotify', 'youtube', 'disney', 'คอนเสิร์ต', 'เที่ยว', 'โรงแรม', 'ที่พัก']],
  ['ช้อปปิ้ง', ['เสื้อ', 'กางเกง', 'รองเท้า', 'กระเป๋า', 'shopee', 'lazada', 'tiktok shop', 'ช้อป', 'ของขวัญ', 'ของฝาก', 'แว่น']],
];

const GROCERY = [
  ['ผัก ผลไม้', ['ผัก', 'ผลไม้', 'กะหล่ำ', 'คะน้า', 'ผักกาด', 'ผักบุ้ง', 'แครอท', 'มะเขือเทศ', 'มะเขือ', 'แตงกวา', 'ต้นหอม', 'ผักชี',
    'กระเทียม', 'หอมแดง', 'หอมใหญ่', 'พริก', 'มะนาว', 'ขิง', 'ข่า', 'ตะไคร้', 'มะม่วง', 'กล้วย', 'ส้ม', 'แอปเปิ้ล', 'แอปเปิล',
    'องุ่น', 'แตงโม', 'สับปะรด', 'มะละกอ', 'ฝรั่ง', 'เห็ด', 'ถั่วงอก', 'โหระพา', 'กะเพรา', 'มันฝรั่ง', 'ข้าวโพด', 'บรอกโคลี',
    'บร็อคโคลี่', 'สลัด', 'อะโวคาโด', 'ลำไย', 'ทุเรียน', 'มังคุด', 'เงาะ', 'ชมพู่', 'สตรอว์เบอร์รี', 'บลูเบอร์รี', 'ฟักทอง', 'บวบ',
    'ถั่วฝักยาว', 'ผักโขม', 'ใบมะกรูด', 'มะพร้าว']],
  ['เนื้อสัตว์ อาหารทะเล', ['หมู', 'ไก่', 'เนื้อ', 'ปลา', 'กุ้ง', 'หมึก', 'ปู', 'หอย', 'เบคอน', 'แฮม', 'ไส้กรอก', 'ลูกชิ้น', 'สันใน',
    'สามชั้น', 'อกไก่', 'น่องไก่', 'ปีกไก่', 'แซลมอน', 'ทูน่า', 'หมูสับ', 'หมูบด']],
  ['นม ไข่ เบเกอรี่', ['นม', 'ไข่', 'โยเกิร์ต', 'ชีส', 'เนย', 'ขนมปัง', 'ครัวซองต์', 'เค้ก', 'วิปครีม', 'ครีม', 'นมถั่วเหลือง',
    'นมอัลมอนด์', 'นมจืด', 'นมเปรี้ยว']],
  ['ของแห้ง เครื่องปรุง', ['ข้าวสาร', 'เส้น', 'มาม่า', 'บะหมี่', 'พาสต้า', 'สปาเก็ตตี้', 'แป้ง', 'น้ำตาล', 'เกลือ', 'น้ำปลา', 'ซีอิ๊ว',
    'ซอส', 'น้ำมันพืช', 'น้ำมันหอย', 'พริกไทย', 'ผงชูรส', 'กะปิ', 'ปลาร้า', 'ปลากระป๋อง', 'กระป๋อง', 'ถั่ว', 'ซีเรียล',
    'ข้าวโอ๊ต', 'น้ำส้มสายชู', 'มายองเนส', 'ซอสมะเขือเทศ', 'ผงปรุง', 'กะทิ', 'ข้าว']],
  ['เครื่องดื่ม ขนม', ['น้ำดื่ม', 'น้ำเปล่า', 'โซดา', 'โค้ก', 'เป๊ปซี่', 'น้ำอัดลม', 'น้ำผลไม้', 'กาแฟ', 'ชา', 'เบียร์', 'ไวน์',
    'ขนม', 'ช็อกโกแลต', 'คุกกี้', 'เลย์', 'ไอศกรีม', 'ไอติม', 'ลูกอม', 'หมากฝรั่ง', 'น้ำแข็ง', 'มันฝรั่งทอด']],
  ['ของใช้ในบ้าน', ['ทิชชู่', 'กระดาษทิชชู่', 'ผงซักฟอก', 'น้ำยาซักผ้า', 'น้ำยาปรับผ้านุ่ม', 'น้ำยาล้างจาน', 'ฟองน้ำ',
    'ถุงขยะ', 'น้ำยาถูพื้น', 'ไม้กวาด', 'หลอดไฟ', 'ถ่าน', 'แบตเตอรี่', 'ฟอยล์', 'แรป', 'ทิชชู่เปียก', 'ยากันยุง', 'ไฟแช็ก']],
  ['ของใช้ส่วนตัว ยา', ['สบู่', 'แชมพู', 'ครีมนวด', 'ยาสีฟัน', 'แปรงสีฟัน', 'ไหมขัดฟัน', 'โลชั่น', 'ครีมกันแดด', 'ผ้าอนามัย',
    'มีดโกน', 'โฟมล้างหน้า', 'น้ำหอม', 'ยา', 'พารา', 'วิตามิน', 'พลาสเตอร์', 'แอลกอฮอล์', 'หน้ากากอนามัย', 'สำลี']],
  ['สัตว์เลี้ยง', ['อาหารแมว', 'อาหารหมา', 'ทรายแมว', 'ขนมแมว', 'ขนมหมา']],
];
export const SHOP_SECTIONS = [...GROCERY.map((g) => g[0]), 'อื่น ๆ'];
export const MONEY_CATS = [...EXPENSE_CATS.map((c) => c[0]), 'อื่น ๆ'];

const GROCERY_WORDS = GROCERY.flatMap(([, words]) => words).sort((a, b) => b.length - a.length);

const segmenter = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter('th', { granularity: 'word' }) : null;

/** Where words start (Thai has no spaces): "อยาก" must not match "ยา". */
function wordStarts(t) {
  if (!segmenter) return null;
  const starts = new Set();
  for (const seg of segmenter.segment(t)) starts.add(seg.index);
  return starts;
}

/** The best (longest) keyword that starts a word decides the group. */
function bestGroup(groups, text) {
  const t = text.toLowerCase();
  const starts = wordStarts(t);
  let best = null;
  let len = 0;
  for (const [name, words] of groups) {
    for (const w of words) {
      if (w.length <= len) continue;
      for (let i = t.indexOf(w); i !== -1; i = t.indexOf(w, i + 1)) {
        if (!starts || starts.has(i)) {
          [best, len] = [name, w.length];
          break;
        }
      }
    }
  }
  return best;
}

export const shopSection = (item) => bestGroup(GROCERY, item) ?? 'อื่น ๆ';
/** Spending category, or null when nothing in the text looks like spending. */
export const moneyCategory = (text) => bestGroup(EXPENSE_CATS, text);

/** First word of the text (Thai has no spaces, so use the word segmenter when there is one). */
function firstWord(text) {
  const t = text.trim().toLowerCase();
  if (segmenter) {
    for (const seg of segmenter.segment(t)) if (seg.isWordLike) return seg.segment;
  }
  return t.split(/\s+/)[0] ?? '';
}

function startsWithVerb(text) {
  const t = text.trim().toLowerCase();
  const w = firstWord(t);
  if (ACTION_VERBS.includes(w)) return true;
  if (segmenter) {
    // The segmenter keeps some verb + object pairs as one word ("ตัดผม", "ทำการบ้าน"): accept them
    // when what follows the verb is itself a word ("ผม"), but not "หาดใหญ่" ("ดใหญ่").
    const verb = ACTION_VERBS.filter((v) => v.length >= 2 && w.length > v.length && w.startsWith(v)).sort((a, b) => b.length - a.length)[0];
    if (verb) {
      const rest = w.slice(verb.length);
      const next = [...segmenter.segment(rest)].find((seg) => seg.isWordLike)?.segment ?? '';
      if (next.length >= 2 && !/^[\u0E30-\u0E3A\u0E47-\u0E4E]/u.test(rest)) return true;
    }
  }
  // without a segmenter, fall back to a prefix check on spaced text
  return !segmenter && ACTION_VERBS.some((v) => t.startsWith(`${v} `));
}

/** Splits "นม ไข่, ขนมปัง และกาแฟ" or "นมไข่ขนมปัง" into items. */
export function splitItems(text) {
  const parts = text
    .split(/\s*(?:,|，|、|\/|\+|\n|\s+และ\s*|\s+กับ\s*|\s{1,})\s*/u)
    .map((p) => p.replace(/^(?:และ|กับ)/u, '').trim())
    .filter(Boolean);
  if (parts.length > 1) return mergeQuantities(parts);
  // no separators: split only if grocery words cover the whole text ("นมไข่ขนมปัง")
  const one = parts[0] ?? '';
  const out = [];
  let i = 0;
  while (i < one.length) {
    const w = GROCERY_WORDS.find((g) => one.startsWith(g, i));
    if (!w) return one ? [one] : [];
    out.push(w);
    i += w.length;
  }
  return out.length ? out : [one];
}

/** "ไข่ 10 ฟอง" stays one item. */
function mergeQuantities(parts) {
  const out = [];
  for (const p of parts) {
    if (out.length && /^\d+(?:[.,]\d+)?$|^(?:ฟอง|ชิ้น|อัน|กล่อง|ขวด|แพ็ค|แพ็ก|ห่อ|ถุง|กก\.?|กิโล|กรัม|ลิตร|ลูก|ใบ|แผง|โหล|แพค)$/u.test(p)) {
      out[out.length - 1] += ` ${p}`;
    } else out.push(p);
  }
  return out;
}

const UNIT_AFTER = /^\s*(?:ฟอง|ชิ้น|อัน|กล่อง|ขวด|แพ็ค|แพ็ก|ห่อ|ถุง|กก|กิโล|กรัม|ลิตร|มล|เมตร|ซม|หน้า|บท|ข้อ|รอบ|นาที|ชั่วโมง|ชม|วัน|คน|เล่ม|แก้ว|จาน|ชาม|ลูก|ใบ|ตัว|คู่|ครั้ง|ปี|เดือน|สัปดาห์|โมง|ทุ่ม|%|km|kg|g\b|ml|pcs|x)/iu;
const PHONE = /(?:\+66|\b0)\d{1,2}[-\s]?\d{3}[-\s]?\d{3,4}\b/;
const URL = /https?:\/\/\S+/i;

/** The money amount in a text: { amount, start, end, marked } or null. */
export function findAmount(text) {
  const s = text.replace(PHONE, (m) => ' '.repeat(m.length));
  // not part of a date or time ("15/11", "17:30")
  const re = /(?<![\d/.:])(฿\s*)?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?(?![\d/:])(\s*(?:บาท|บ\.|฿|thb|baht))?/giu;
  let found = null;
  for (const m of s.matchAll(re)) {
    const after = s.slice(m.index + m[0].length);
    const marked = !!(m[1] || m[4]);
    if (!marked && UNIT_AFTER.test(after)) continue;
    const amount = Number(m[2].replace(/,/g, '')) + (m[3] ? Number(`0.${m[3]}`) : 0);
    if (!(amount > 0) || amount > 10_000_000) continue;
    found = { amount, start: m.index, end: m.index + m[0].length, marked };
  }
  return found;
}

const tidy = (s) => s.replace(/\s+/g, ' ').replace(/^[\s,;:–—-]+|[\s,;:–—-]+$/g, '').trim();
const PREFIX = /^\s*(โน้ต|จด|บันทึก|ไอเดีย|idea|note|ซื้อ|buy|จ่าย|ค่าใช้จ่าย|งาน|todo|ทำ|เตือน)\s*[:：]\s*/iu;

/**
 * Sorts one line of input. `force` (one of KINDS) overrides the guess; `noDate` keeps a date
 * phrase as plain text (the person tapped × on the date chip).
 * Returns { kind, why, text, day, time, repeat, items, amount, cat }.
 */
export function classify(input, now = Date.now(), { force = null, noDate = false } = {}) {
  let raw = String(input ?? '').trim();
  let hinted = null;
  const pre = raw.match(PREFIX);
  if (pre) {
    const word = pre[1].toLowerCase();
    hinted = /โน้ต|จด|บันทึก|ไอเดีย|idea|note/.test(word) ? 'note' : /ซื้อ|buy/.test(word) ? 'shop' : /จ่าย|ค่าใช้จ่าย/.test(word) ? 'money' : 'task';
    raw = raw.slice(pre[0].length).trim();
  }
  const parsed = noDate ? { text: raw, day: null, time: null, repeat: null } : parseWhen(raw, now);
  const when = !!(parsed.day || parsed.repeat);
  const base = { text: parsed.text, day: parsed.day, time: parsed.time, repeat: parsed.repeat, items: [], amount: null, cat: null };

  let kind = force ?? hinted;
  let why = force ? 'เลือกเอง' : hinted ? 'ขึ้นต้นด้วยคำบอกประเภท' : '';
  const money = findAmount(raw);
  const spendy = !!moneyCategory(raw);
  const verb = startsWithVerb(raw);
  const buy = /^\s*(?:ซื้อ|ต้องซื้อ|buy)\s*/iu.exec(raw);

  if (!kind) {
    if (when) [kind, why] = ['task', parsed.time ? 'มีเวลา → ตั้งเตือน' : parsed.repeat ? 'ทำซ้ำ → ตั้งเตือน' : 'มีวัน → ลงวันนั้น'];
    else if (money && (money.marked || spendy || /^\s*(?:ค่า|จ่าย|เติม)/u.test(raw))) [kind, why] = ['money', 'มีจำนวนเงิน'];
    else if (buy && raw.slice(buy[0].length).trim()) [kind, why] = ['shop', 'ของที่ต้องซื้อ'];
    else if (!verb && (URL.test(raw) || PHONE.test(raw))) [kind, why] = ['note', URL.test(raw) ? 'ลิงก์ → เก็บเป็นโน้ต' : 'เบอร์โทร → เก็บเป็นโน้ต'];
    else if (NOTE_STARTS.some((w) => raw.toLowerCase().startsWith(w))) [kind, why] = ['note', 'ข้อมูล/ไอเดีย'];
    else if (verb) [kind, why] = ['task', 'เป็นสิ่งที่ต้องทำ'];
    else if (raw.length > 80 || raw.includes('\n')) [kind, why] = ['note', 'ข้อความยาว'];
    else if (splitItems(raw).every((i) => shopSection(i) !== 'อื่น ๆ')) [kind, why] = ['shop', 'ชื่อของกินของใช้'];
    else [kind, why] = ['note', 'ไม่ใช่สิ่งที่ต้องทำ → โน้ต'];
  }

  if (kind === 'money') {
    const m = money;
    const text = m ? tidy(raw.slice(0, m.start) + ' ' + raw.slice(m.end)) : raw;
    const label = text.replace(/^(?:จ่าย|ค่าใช้จ่าย)\s*/u, '') || 'รายจ่าย';
    return { ...base, kind, why, text: label, day: null, time: null, repeat: null, amount: m?.amount ?? null, cat: moneyCategory(raw) ?? 'อื่น ๆ' };
  }
  if (kind === 'shop') {
    const rest = buy ? raw.slice(buy[0].length) : raw;
    const items = splitItems(rest).map((text) => ({ text, cat: shopSection(text) }));
    return { ...base, kind, why, text: rest.trim(), day: null, time: null, repeat: null, items };
  }
  if (kind === 'note') return { ...base, kind, why, text: raw, day: null, time: null, repeat: null };
  return { ...base, kind: 'task', why };
}

/**
 * A pasted list (from LINE, Notes or a Claude answer) → one entry per line: bullets, checkboxes,
 * numbering and **bold** are dropped, and so are headings ("## พรุ่งนี้", "ของต้องซื้อ:").
 */
export function pastedLines(text) {
  return String(text ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !/^#{1,6}\s/.test(l) && !/^[-*_=]{3,}$/.test(l))
    .map((l) =>
      l
        .replace(/\*\*(.+?)\*\*|__(.+?)__/g, '$1$2')
        .replace(/^(?:[-*+•▪◦☐☑✓✔]\s*|\d{1,3}[.)]\s+)+/u, '')
        .replace(/^\[[ xX✓]?\]\s*/u, '')
        .trim(),
    )
    .filter((l) => l && !/[:：]$/.test(l));
}
