// Day keys ("2026-11-08", local time) and Thai natural-language dates.
//
// parseWhen("พรุ่งนี้ 5 โมงเย็น โทรหาแม่", now)
//   → { text: "โทรหาแม่", day: "2026-11-09", time: "17:00", matched: [...] }
//
// No dependencies; runs in the browser and in Node (tests).

const pad = (n) => String(n).padStart(2, '0');

export function dayKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function fromKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(key, n) {
  const d = fromKey(key);
  d.setDate(d.getDate() + n);
  return dayKey(d);
}

/** Whole days from a to b (b − a). */
export function diffDays(a, b) {
  return Math.round((fromKey(b) - fromKey(a)) / 86_400_000);
}

export function timeOf(date) {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Milliseconds since epoch for a day key + "HH:MM" in local time. */
export function toTimestamp(day, time = '00:00') {
  const d = fromKey(day);
  const [h, m] = time.split(':').map(Number);
  d.setHours(h, m, 0, 0);
  return d.getTime();
}

const DAYS_SHORT = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];
const DAYS_LONG = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
const MONTHS_SHORT = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const MONTHS_LONG = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
];

/** "อา. 8 พ.ย." (adds the 2-digit Buddhist year when it is not this year). */
export function shortDate(key, todayKey = key) {
  const d = fromKey(key);
  const base = `${DAYS_SHORT[d.getDay()]} ${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
  return d.getFullYear() === fromKey(todayKey).getFullYear() ? base : `${base} ${(d.getFullYear() + 543) % 100}`;
}

/** "วันอาทิตย์ที่ 8 พฤศจิกายน 2569" */
export function longDate(key) {
  const d = fromKey(key);
  return `วัน${DAYS_LONG[d.getDay()]}ที่ ${d.getDate()} ${MONTHS_LONG[d.getMonth()]} ${d.getFullYear() + 543}`;
}

/** "วันนี้", "พรุ่งนี้", "เมื่อวาน", or a short date. */
export function dayLabel(key, todayKey) {
  const n = diffDays(todayKey, key);
  if (n === 0) return 'วันนี้';
  if (n === 1) return 'พรุ่งนี้';
  if (n === 2) return 'มะรืนนี้';
  if (n === -1) return 'เมื่อวาน';
  return shortDate(key, todayKey);
}

export function describeWhen(day, time, todayKey) {
  if (!day) return '';
  return time ? `${dayLabel(day, todayKey)} ${time} น.` : dayLabel(day, todayKey);
}

// ---------------------------------------------------------------------------
// Parsing

const THAI_DIGITS = '๐๑๒๓๔๕๖๗๘๙';
/** Thai digits → ASCII, one character for one, so match positions stay valid. */
export const normalizeDigits = (s) => s.replace(/[๐-๙]/g, (c) => String(THAI_DIGITS.indexOf(c)));

const NUM_WORDS = [
  ['สิบเอ็ด', 11], ['สิบสอง', 12], ['หนึ่ง', 1], ['นึง', 1], ['สอง', 2], ['สาม', 3], ['สี่', 4],
  ['ห้า', 5], ['หก', 6], ['เจ็ด', 7], ['แปด', 8], ['เก้า', 9], ['สิบ', 10],
];
const WORDS = NUM_WORDS.map((w) => w[0]).join('|');
const NUM = `(\\d{1,2}|${WORDS})`;
const COUNT = `(\\d{1,3}|${WORDS}|ครึ่ง)`;
const num = (s) => (/^\d+$/.test(s) ? Number(s) : s === 'ครึ่ง' ? 0.5 : NUM_WORDS.find((w) => w[0] === s)?.[1]);

const hm = (h, m = 0) => (Number.isInteger(h) && h >= 0 && h <= 23 && m >= 0 && m <= 59 ? `${pad(h)}:${pad(m)}` : null);

function ampm(h, marker) {
  if (!marker) return h;
  if (h < 1 || h > 12) return -1;
  const pm = /^p/i.test(marker);
  if (pm) return h === 12 ? 12 : h + 12;
  return h === 12 ? 0 : h;
}

// "น." after a time, but not the first letter of the next word ("17:00 นัดหมอ").
const NA = '(?:\\s*น(?:\\.|(?=\\s|$)))?';
const PART = '(เช้า|สาย|บ่าย|เย็น|ค่ำ|คืน)';
// A part of day right after พรุ่งนี้/มะรืน, but not the verb in "พรุ่งนี้ คืนหนังสือ".
// "บ่ายสอง" right after is a time, so บ่าย is left for the time rules.
const PART_AFTER = `(เช้า|สาย|เย็น|ค่ำ|คืน|บ่าย(?!\\s*(?:\\d|${WORDS}|โมง)))(?=$|[\\s\\d.,]|${WORDS}|โมง|ทุ่ม|ตี|นี้)`;
const PM_PARTS = ['บ่าย', 'เย็น', 'ค่ำ', 'คืน', 'กลางคืน'];

const TIME_RULES = [
  // 17:30, 9:05 น., 5:30pm
  {
    re: new RegExp(`(?<![\\d.:/])(\\d{1,2}):(\\d{2})(?!\\d)(?:\\s*(am|pm|a\\.m\\.|p\\.m\\.)(?![a-z])|${NA})`, 'giu'),
    fn: (m) => hm(ampm(+m[1], m[3]), +m[2]),
  },
  // 17.30 น. (a bare 17.30 could be a price, so it needs น. or a leading เวลา/ตอน)
  {
    re: /(?:(?:เวลา|ตอน)\s*)?(?<![\d.:/])(\d{1,2})\.(\d{2})(?!\d)(\s*น(?:\.|(?=\s|$)))?/gu,
    fn: (m) => (m[3] || /^(เวลา|ตอน)/.test(m[0]) ? hm(+m[1], +m[2]) : null),
  },
  // 5pm, 11 am
  {
    re: /(?<![\d.:])(\d{1,2})\s*(am|pm|a\.m\.|p\.m\.)(?![a-z])/giu,
    fn: (m) => hm(ampm(+m[1], m[2]), 0),
  },
  // 17 นาฬิกา, 9.30 นาฬิกา
  {
    re: /(?<![\d.:])(\d{1,2})(?:[.:](\d{2}))?\s*นาฬิกา/gu,
    fn: (m) => hm(+m[1], +(m[2] ?? 0)),
  },
  // บ่ายโมง, บ่ายสอง, บ่าย 3 โมงครึ่ง
  {
    re: new RegExp(`บ่าย\\s*(?:${NUM}\\s*(?:โมง)?|โมง)\\s*(ครึ่ง)?`, 'gu'),
    fn: (m) => {
      const n = m[1] ? num(m[1]) : 1;
      return n >= 1 && n <= 6 ? hm(12 + n, m[2] ? 30 : 0) : null;
    },
  },
  // 7 โมงเช้า, 5 โมงเย็น, สิบโมง, ห้าโมงครึ่ง
  {
    re: new RegExp(`(?<!บ่าย\\s*)${NUM}\\s*โมง\\s*(เช้า|เย็น|ตรง)?\\s*(ครึ่ง)?`, 'gu'),
    fn: (m, ctx) => {
      const n = num(m[1]);
      const min = m[3] ? 30 : 0;
      if (m[2] === 'เช้า') return n >= 4 && n <= 11 ? hm(n, min) : null;
      if (m[2] === 'เย็น') return n >= 1 && n <= 7 ? hm(n + 12, min) : null;
      if (n === 12) return hm(12, min);
      if (n < 1 || n > 11) return null;
      if (ctx.pm) return hm(n + 12, min);
      if (ctx.am) return hm(n, min);
      return hm(n >= 6 ? n : n + 12, min); // bare: 6–11 morning, 1–5 afternoon
    },
  },
  // หนึ่งทุ่ม, ทุ่มนึง, 2 ทุ่มครึ่ง
  {
    re: new RegExp(`(?:${NUM}\\s*ทุ่ม|ทุ่ม\\s*(?:นึง|หนึ่ง))\\s*(ครึ่ง)?`, 'gu'),
    fn: (m) => {
      const n = m[1] ? num(m[1]) : 1;
      return n >= 1 && n <= 5 ? hm(18 + n, m[2] ? 30 : 0) : null;
    },
  },
  // ตี 2, ตีห้าครึ่ง
  {
    re: new RegExp(`ตี\\s*${NUM}\\s*(ครึ่ง)?`, 'gu'),
    fn: (m) => {
      const n = num(m[1]);
      return n >= 1 && n <= 5 ? hm(n, m[2] ? 30 : 0) : null;
    },
  },
  // เที่ยง, เที่ยงวัน, เที่ยงครึ่ง (not เที่ยงคืน)
  {
    re: /เที่ยง(?:วัน|ตรง)?(?!คืน)\s*(ครึ่ง)?/gu,
    fn: (m) => hm(12, m[1] ? 30 : 0),
  },
];

const MONTH_ALT = [
  ...MONTHS_LONG.map((m) => [m, MONTHS_LONG.indexOf(m)]),
  ...MONTHS_SHORT.map((m, i) => [m.replace(/\./g, '\\.?'), i]),
].sort((a, b) => b[0].length - a[0].length);
const MONTH_RE = MONTH_ALT.map((m) => m[0]).join('|');
const monthIndex = (s) => MONTH_ALT.find(([re]) => new RegExp(`^(?:${re})$`, 'u').test(s))?.[1] ?? -1;

const WEEKDAYS = { จันทร์: 1, อังคาร: 2, พุธ: 3, พฤหัส: 4, พฤหัสบดี: 4, ศุกร์: 5, เสาร์: 6, อาทิตย์: 0 };

function fullYear(y, todayYear) {
  if (y == null) return null;
  const n = Number(y);
  if (y.length === 2) {
    const be = 1957 + n; // 69 → พ.ศ. 2569 → 2026
    return be >= todayYear - 1 ? be : 2000 + n;
  }
  return n > 2400 ? n - 543 : n;
}

function makeDate(d, m, y, ctx) {
  const year = y ?? ctx.year;
  const date = new Date(year, m, d);
  if (date.getMonth() !== m || date.getDate() !== d) return null;
  let key = dayKey(date);
  if (y == null && key < ctx.today) {
    const next = new Date(year + 1, m, d);
    if (next.getMonth() !== m) return null;
    key = dayKey(next);
  }
  return key;
}

/** The given weekday on/after today, or in next week ("หน้า"; weeks start on Sunday as on Thai calendars). */
function weekdayKey(target, next, ctx) {
  const dow = fromKey(ctx.today).getDay();
  if (next) return addDays(ctx.today, 7 - dow + target);
  return addDays(ctx.today, (target - dow + 7) % 7);
}

const DAY_RULES = [
  {
    re: new RegExp(`วันนี้|${PART}นี้|\\btoday\\b|\\btonight\\b`, 'giu'),
    fn: (m, ctx) => ({ day: ctx.today, part: m[1] ?? (/tonight/i.test(m[0]) ? 'คืน' : null) }),
  },
  {
    re: new RegExp(`พรุ่งนี้\\s*(?:${PART_AFTER})?|\\btomorrow\\b`, 'giu'),
    fn: (m, ctx) => ({ day: addDays(ctx.today, 1), part: m[1] }),
  },
  {
    re: new RegExp(`มะรืน(?:นี้)?\\s*(?:${PART_AFTER})?`, 'gu'),
    fn: (m, ctx) => ({ day: addDays(ctx.today, 2), part: m[1] }),
  },
  {
    re: /(?:วัน)?เสาร์\s*-?\s*อาทิตย์\s*(นี้|หน้า)?|สุดสัปดาห์\s*(นี้|หน้า)?|\bweekend\b/giu,
    fn: (m, ctx) => {
      const which = m[1] ?? m[2];
      // On a Sunday "สุดสัปดาห์นี้" is today; otherwise the coming Saturday.
      if (which === 'นี้' && fromKey(ctx.today).getDay() === 0) return { day: ctx.today };
      return { day: weekdayKey(6, which === 'หน้า', ctx) };
    },
  },
  {
    re: /(?:วัน\s*)?(?<!พระ)(จันทร์|อังคาร|พุธ|พฤหัสบดี|พฤหัส|ศุกร์|เสาร์|(?<=วัน\s*)อาทิตย์)\s*(นี้|หน้า)?/gu,
    fn: (m, ctx) => ({ day: weekdayKey(WEEKDAYS[m[1]], m[2] === 'หน้า', ctx) }),
  },
  {
    re: /(?:สัปดาห์|อาทิตย์)\s*หน้า|\bnext week\b/giu,
    fn: (m, ctx) => ({ day: weekdayKey(1, true, ctx) }),
  },
  // อีก 3 วัน, ในอีก 2 สัปดาห์, อีกครึ่งชั่วโมง, อีก 1 ชั่วโมงครึ่ง, อีก 20 นาที
  {
    re: new RegExp(`(?:ใน)?อีก\\s*${COUNT}\\s*(วัน|สัปดาห์|อาทิตย์|ชั่วโมง|ชม\\.?|นาที)\\s*(ครึ่ง)?`, 'gu'),
    fn: (m, ctx) => {
      const n = num(m[1]);
      if (!n) return null;
      const unit = m[2];
      if (unit === 'วัน' || unit === 'สัปดาห์' || unit === 'อาทิตย์') {
        if (!Number.isInteger(n)) return null;
        return { day: addDays(ctx.today, unit === 'วัน' ? n : n * 7) };
      }
      const minutes = (unit === 'นาที' ? n : n * 60) + (m[3] && unit !== 'นาที' ? 30 : 0);
      const at = new Date(ctx.now + minutes * 60_000);
      return { day: dayKey(at), time: timeOf(at) };
    },
  },
  // 15/11, 15/11/69, 15/11/2026
  {
    re: /(?:วันที่\s*)?(?<![\d/.:])(\d{1,2})\/(\d{1,2})(?:\/(\d{4}|\d{2}))?(?![\d/])/gu,
    fn: (m, ctx) => ({ day: makeDate(+m[1], +m[2] - 1, fullYear(m[3], ctx.year), ctx) }),
  },
  // 15 พ.ย., 15 พฤศจิกายน 2569, วันที่ 3 ธค 69
  {
    re: new RegExp(
      `(?:วันที่\\s*)?(?<![\\d.:])(\\d{1,2})\\s*(${MONTH_RE})(?:\\s*(?:พ\\.ศ\\.|ค\\.ศ\\.)?\\s*(\\d{4}|\\d{2})(?!\\d|\\s*(?:โมง|ทุ่ม|นาฬิกา|[:.]\\d)))?`,
      'gu',
    ),
    fn: (m, ctx) => {
      const month = monthIndex(m[2]);
      return month < 0 ? null : { day: makeDate(+m[1], month, fullYear(m[3], ctx.year), ctx) };
    },
  },
  // วันที่ 15 (this month, or next month if it has passed)
  {
    re: /วันที่\s*(\d{1,2})(?![\d/])/gu,
    fn: (m, ctx) => {
      const d = +m[1];
      const t = fromKey(ctx.today);
      for (let i = 0; i < 3; i++) {
        const date = new Date(t.getFullYear(), t.getMonth() + i, d);
        if (date.getDate() === d && dayKey(date) >= ctx.today) return { day: dayKey(date) };
      }
      return null;
    },
  },
];

// ---------------------------------------------------------------------------
// Repeats ("ทุกวัน 8 โมง กินยา", "ทุกวันที่ 25 จ่ายบัตร"), stored as
// 'daily' | 'weekdays' | 'weekly:<0-6>' | 'monthly:<1-31>' | 'yearly'.

const WD_NO_SUN = 'จันทร์|อังคาร|พุธ|พฤหัสบดี|พฤหัส|ศุกร์|เสาร์';
const REPEAT_RULES = [
  {
    re: /ทุก\s*วัน(?:ทำงาน|ธรรมดา)|(?:ทุก\s*)?(?:วัน)?จันทร์\s*(?:-|–|ถึง)\s*(?:วัน)?ศุกร์|\bevery weekday\b|\bweekdays\b/giu,
    fn: () => 'weekdays',
  },
  // "ทุกอาทิตย์" means every week; every Sunday is "ทุกวันอาทิตย์"
  {
    re: new RegExp(`ทุก\\s*(?:(?:วัน)?(${WD_NO_SUN})|วัน(อาทิตย์))`, 'gu'),
    fn: (m) => `weekly:${WEEKDAYS[m[1] ?? m[2]]}`,
  },
  {
    re: /ทุก\s*(?:เดือน\s*)?วันที่\s*(\d{1,2})/gu,
    fn: (m) => (+m[1] >= 1 && +m[1] <= 31 ? `monthly:${+m[1]}` : null),
  },
  { re: /ทุก\s*วัน(?!ที่)|\bevery ?day\b|\bdaily\b/giu, fn: () => 'daily' },
  { re: /ทุก\s*(?:สัปดาห์|อาทิตย์)|\bevery week\b|\bweekly\b/giu, fn: () => 'weekly:*' },
  { re: /ทุก\s*เดือน|\bevery month\b|\bmonthly\b/giu, fn: () => 'monthly:*' },
  { re: /ทุก\s*ปี|\bevery year\b|\byearly\b|\bannually\b/giu, fn: () => 'yearly' },
];

const daysIn = (y, m) => new Date(y, m + 1, 0).getDate();

/** Does `day` fall on the repeat? (yearly: every day qualifies; it is anchored by the task's own date.) */
function repeatMatches(repeat, day) {
  const [kind, arg] = repeat.split(':');
  const d = fromKey(day);
  if (kind === 'weekdays') return d.getDay() >= 1 && d.getDay() <= 5;
  if (kind === 'weekly') return d.getDay() === Number(arg);
  if (kind === 'monthly') return d.getDate() === Math.min(Number(arg), daysIn(d.getFullYear(), d.getMonth()));
  return true;
}

/** The next day after `day` on which the repeat falls. */
export function nextOccurrence(repeat, day) {
  const [kind, arg] = repeat.split(':');
  if (kind === 'yearly') {
    const d = fromKey(day);
    const y = d.getFullYear() + 1;
    return dayKey(new Date(y, d.getMonth(), Math.min(d.getDate(), daysIn(y, d.getMonth()))));
  }
  if (kind === 'monthly') {
    const d = fromKey(day);
    for (let i = 0; i < 3; i++) {
      const y = d.getFullYear() + Math.floor((d.getMonth() + i) / 12);
      const m = (d.getMonth() + i) % 12;
      const key = dayKey(new Date(y, m, Math.min(Number(arg), daysIn(y, m))));
      if (key > day) return key;
    }
  }
  let next = addDays(day, 1);
  for (let i = 0; i < 8 && !repeatMatches(repeat, next); i++) next = addDays(next, 1);
  return next;
}

/** First day on or after today (today only if its time has not passed). */
function firstOccurrence(repeat, today, time, nowDate) {
  if (repeatMatches(repeat, today) && (!time || time >= timeOf(nowDate))) return today;
  return nextOccurrence(repeat, today);
}

export function repeatLabel(repeat) {
  if (!repeat) return '';
  const [kind, arg] = repeat.split(':');
  if (kind === 'daily') return 'ทุกวัน';
  if (kind === 'weekdays') return 'ทุกวันทำงาน';
  if (kind === 'weekly') return `ทุกวัน${DAYS_LONG[Number(arg)]}`;
  if (kind === 'monthly') return `ทุกวันที่ ${arg}`;
  if (kind === 'yearly') return 'ทุกปี';
  return '';
}

export const isRepeat = (v) => typeof v === 'string' && /^(daily|weekdays|weekly:[0-6]|monthly:([1-9]|[12]\d|3[01])|yearly)$/.test(v);

function candidates(rules, s, ctx) {
  const out = [];
  for (const rule of rules) {
    for (const m of s.matchAll(rule.re)) {
      const value = rule.fn(m, ctx);
      if (value && (typeof value === 'string' || value.day)) out.push({ start: m.index, end: m.index + m[0].length, value });
    }
  }
  return out.sort((a, b) => a.start - b.start || b.end - a.end);
}

const overlaps = (a, b) => a.start < b.end && b.start < a.end;

/**
 * Finds a day and/or time in free text and returns the text without them.
 * Only the first day phrase and first time phrase are used.
 */
export function parseWhen(input, now = Date.now()) {
  const text = String(input ?? '');
  let s = normalizeDigits(text);
  const nowDate = new Date(now);
  const ctx = { now, today: dayKey(nowDate), year: nowDate.getFullYear(), am: false, pm: false };

  const repeatHit = candidates(REPEAT_RULES, s, ctx)[0] ?? null;
  if (repeatHit) s = s.slice(0, repeatHit.start) + ' '.repeat(repeatHit.end - repeatHit.start) + s.slice(repeatHit.end);

  const dayHit = candidates(DAY_RULES, s, ctx)[0] ?? null;
  const partMatch = dayHit?.value.part ? null : s.match(/(?<!ขั้น|ช่วง)ตอน\s*(เช้า|สาย|บ่าย|เย็น|ค่ำ|กลางคืน)(?!นี้)/u);
  const part = dayHit?.value.part ?? partMatch?.[1];
  if (part) {
    ctx.pm = PM_PARTS.includes(part);
    ctx.am = !ctx.pm;
  }

  let day = dayHit?.value.day ?? null;
  let time = dayHit?.value.time ?? null;
  let timeHit = null;
  if (!time) {
    timeHit = candidates(TIME_RULES, s, ctx).find((c) => !dayHit || !overlaps(c, dayHit)) ?? null;
    time = timeHit?.value ?? null;
  }
  let repeat = repeatHit?.value ?? null;
  if (!day && !time && !repeat) return { text: text.trim(), day: null, time: null, repeat: null, matched: [] };
  // "ทุกสัปดาห์" / "ทุกเดือน" without a day start today (or tomorrow if the time has passed).
  if (repeat && !day) day = firstOccurrence(repeat.endsWith(':*') ? 'daily' : repeat, ctx.today, time, nowDate);
  if (time && !day) day = time >= timeOf(nowDate) ? ctx.today : addDays(ctx.today, 1);
  if (repeat === 'weekly:*') repeat = `weekly:${fromKey(day).getDay()}`;
  if (repeat === 'monthly:*') repeat = `monthly:${fromKey(day).getDate()}`;

  // Cut the matched phrases (and a leading "ตอน"/"เวลา"/"at") out of the text.
  const partHit = partMatch && timeHit ? { start: partMatch.index, end: partMatch.index + partMatch[0].length } : null;
  const spans = [repeatHit, dayHit, timeHit, partHit]
    .filter(Boolean)
    .map((c) => {
      const before = s.slice(0, c.start).match(/(?:(?<!ขั้น|ช่วง)ตอน|(?<!ช่วง)เวลา|\b(?:at|on))\s*$/iu);
      return { start: before ? c.start - before[0].length : c.start, end: c.end };
    })
    .sort((a, b) => a.start - b.start);
  const cuts = [];
  for (const c of spans) {
    const last = cuts.at(-1);
    if (last && c.start <= last.end) last.end = Math.max(last.end, c.end);
    else cuts.push({ ...c });
  }
  let rest = text;
  for (const c of cuts.reverse()) rest = `${rest.slice(0, c.start)} ${rest.slice(c.end)}`;
  rest = rest
    .replace(/\s+/g, ' ')
    .replace(/^[\s,;:–—-]+|[\s,;:–—-]+$/g, '')
    .trim();

  return {
    text: rest || text.trim(),
    day,
    time,
    repeat,
    matched: [repeatHit, dayHit, timeHit].filter(Boolean).map((c) => text.slice(c.start, c.end).trim()),
  };
}
