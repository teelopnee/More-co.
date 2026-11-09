// Summaries and mind maps on the device, with no AI: the classic methods summarizing tools used
// before language models (SMMRY, TextRank, TextTiling, RAKE, rule-based meeting notes), tuned
// for spoken Thai.
//
//   1. Utterances: Thai has no full stops, so a transcript is cut where people pause (spaces),
//      after polite end particles (ครับ ค่ะ …), at fillers (เอ่อ อืม) and before discourse markers
//      (เรื่องต่อไป, สรุปว่า, แล้วก็ …). Bare agreement ("ได้ครับ", "โอเคค่ะ") is dropped.
//   2. Key phrases: runs of content words between Thai stop words; repeated runs (n-grams) win,
//      longer ones preferred (RAKE / SMMRY-style frequency).
//   3. Key sentences: TextRank (Mihalcea & Tarau 2004) over word overlap, plus key-phrase
//      coverage and cue words, then MMR so the summary does not repeat itself.
//   4. Topics: spoken topic markers ("อีกเรื่องหนึ่งคือ…"), paragraphs, else TextTiling
//      (Hearst 1997): a dip in word overlap between neighbouring windows is a topic change.
//   5. Meeting-note rules: things to do (who, what, by when via lib/dates.js), decisions, open
//      questions, numbers worth remembering; a short answer borrows the subject of its question.
//   6. Mind map: the subject in the middle, a branch per topic named the way the speaker named
//      it, the key sentences shortened under it (✓ for what was agreed), then ต้องทำ / ยังไม่สรุป.

import { describeWhen, dayKey, parseWhen } from './dates.js';
import { addChild, newMap, rootOf } from './mindmap.js';

const seg = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter('th', { granularity: 'word' }) : null;
const wordSet = (s) => new Set(s.split(/\s+/).filter(Boolean));

/** Sounds people make while thinking. */
const FILLERS = wordSet('เอ่อ อืม อ่า เอิ่ม อ้า เออ อะ อ่ะ อือ เอ้อ แบบว่า คือว่า ประมาณว่า');
/** Politeness at the end of a phrase: dropped from what is shown. */
const PARTICLES = wordSet('ครับ ค่ะ คะ คับ จ้ะ จ้า จ๊ะ ฮะ นะ น่ะ เนอะ หนะ ล่ะ สิ ซิ เถอะ หรอก นะคะ นะครับ ครับผม');
const END_PARTICLES = wordSet('ครับ ค่ะ คะ คับ ค่า จ้ะ จ้า ฮะ ครับผม นะคะ นะครับ');
/** A phrase made only of these is agreement, not content: "ได้ครับ", "โอเคค่ะ", "ใช่ค่ะ". */
const ACK = wordSet('ได้ โอเค ใช่ ตกลง ดี เลย ครับ ค่ะ ค่า คะ จ้า จ้ะ ฮะ นะ ครับผม แน่นอน');
const PRONOUNS = wordSet('เรา ผม หนู ฉัน ดิฉัน');
/** Thai function words and very common verbs: they glue sentences together but say little. */
const STOP = wordSet(`ที่ ซึ่ง อัน และ กับ หรือ แต่ ก็ จะ ได้ ให้ ไป มา อยู่ เป็น คือ มี ของ ใน บน จาก ถึง กัน แล้ว ว่า นี้ นั้น นี่ นั่น โน้น
  เรา ผม ฉัน หนู ดิฉัน คุณ เขา เธอ มัน พวก ทุก เลย ด้วย อีก ยัง เพราะ ถ้า หาก เมื่อ ตอน ไหม มั้ย เปล่า อะไร ยังไง อย่างไร
  ทำไม ใคร เท่าไร เท่าไหร่ ประมาณ โอเค ใช่ ไม่ ต้อง ควร อาจ น่า คง ทำ เอา ดู บอก พูด เห็น รู้ กว่า มาก ขึ้น ลง ออก เข้า
  เพื่อ โดย ตาม ต่อ แค่ เท่านั้น ทั้ง หมด บาง หลาย อื่น เอง ไว้ เดี๋ยว เหมือน เช่น อย่าง แบบ เรื่อง ครั้ง สิ่ง หน่อย ช่วย
  ลอง กำลัง เคย ซะ งั้น ดังนั้น ฉะนั้น นอก จริง ค่อนข้าง ส่วน ช่วง ตอนนี้ วันนี้ เดิม พอ ทาง แล้วก็ นะ ละ บ้าง กี่ สำหรับ
  ไหน ไหร่ เมื่อไร เมื่อไหร่ หลัง ภายใน อย่า อย่าลืม ก่อน ระหว่าง ตั้งแต่ จน กระทั่ง อยาก ขอ ตัว ดี ใหม่ เท่า แม้ ถึงแม้ จึง ทั้งนี้ แต่ละ ๆ
  หนึ่ง สอง สาม สี่ ห้า หก เจ็ด แปด เก้า สิบ the a an is are of to in on for and or it this that be`);
/** Stop words that still belong inside a phrase: "เปิดตัว", "สินค้าใหม่", "เสื้อกันหนาว". */
const KEEP_IN_RUN = wordSet('ตัว ใหม่ ดี เอง ต่อ ออก ขึ้น ลง กัน รวม');
const KEEP_END = wordSet('ตัว ใหม่ ออก ขึ้น ลง รวม');
/** Too general to be a key word on their own (fine inside a longer phrase). */
const KEY_STOP = wordSet(`วัน คน ครั้ง เดือน ปี สัปดาห์ อาทิตย์ เวลา ชั่วโมง นาที บาท เปอร์เซ็นต์ ส่วน ที่ เครื่อง อัน ตัว ข้อ ทีม ละ
  เช้า สาย บ่าย เย็น ค่ำ คืน โมง พรุ่งนี้ มะรืน ปลาย ต้น กลาง หน้า หลัง ไว้ ทุกคน คุย ทาง ได้ เปิด ปิด เกิน
  จอง ซื้อ จ่าย ใช้ เดิน ส่ง โทร หา ถาม เลื่อน สูง ต่ำ ใหญ่ เล็ก สะดวก คิด งาน สวัสดี ขอบคุณ สุดท้าย แรก การ ความ
  จันทร์ อังคาร พุธ พฤหัส พฤหัสบดี ศุกร์ เสาร์ มกราคม กุมภาพันธ์ มีนาคม เมษายน พฤษภาคม มิถุนายน กรกฎาคม
  สิงหาคม กันยายน ตุลาคม พฤศจิกายน ธันวาคม`);
/** Loanwords the word breaker splits into syllables ("อิน|ฟลู|เอน|เซอร์"): joined back. */
const JOIN = wordSet(`โอเค ไอเดีย เดโม ไลฟ์สไตล์ อินฟลูเอนเซอร์ โปรเจกต์ โปรเจค โปรโมชั่น มีตติ้ง ฟีดแบ็ก คอนเทนต์ พรีเซนต์
  เฟซบุ๊ก ยูทูบ ทาร์เก็ต มาร์เก็ตติ้ง วโรรส สุเทพ พรุ่งนี้`);

const ORD = '(?:\\d+|หนึ่ง|สอง|สาม|สี่|ห้า|หก|เจ็ด|แปด|เก้า|สิบ\\S{0,3}|แรก|สุดท้าย)';
const TOPIC_MARKERS = new RegExp(
  `^(?:เรื่องต่อไป|ต่อไปเป็นเรื่อง|ต่อไปเรื่อง|ต่อไปคือ|ถัดไปเป็นเรื่อง|ถัดไปเรื่อง|อีกเรื่อง|สุดท้าย(?:เรื่อง|คือ)|ประเด็น(?:ต่อไป|ที่${ORD})|หัวข้อ(?:ต่อไป|ที่${ORD})|เรื่องแรก|ข้อแรก|ข้อที่${ORD}|ประการ${ORD}|ก่อนอื่น|เริ่มจาก|การบ้าน|(?:แล้ว|ส่วน)?เรื่อง(?!นี้|นั้น|ที่ว่า|มาก))`,
);
const SENTENCE_STARTS =
  /^(?:เรื่องต่อไป|ต่อไป|ถัดไป|ถัดมา|อีกเรื่อง|เรื่อง(?!นี้|นั้น|ที่ว่า|มาก)|สุดท้าย|ก่อนอื่น|เริ่มจาก|สรุปว่า|สรุปคือ|สรุป|ตกลง|งั้น|โอเค|ข้อแรก|ข้อที่|ประการ|ต่อมา|หลังจากนั้น|จากนั้น|นอกจากนี้|อย่างไรก็ตาม|การบ้าน|แล้วใคร|แล้วเรื่อง|ส่วนเรื่อง|เพราะฉะนั้น|ดังนั้น|ฉะนั้น|เอาเป็นว่า)/;
/** Where a new clause usually starts; a cut only when the sentence so far is long enough. */
const SOFT_STARTS = /^(?:แล้วก็|แล้ว|และ|แต่|ส่วน|ต้อง|อย่าลืม|ไอเดีย|ลอง|ข้อดี|ข้อเสีย|แนะนำ|เหมาะ|โดยทั่วไป|หลักการ|ที่(?:แรก|สอง|สาม|สี่)|อัน(?:แรก|ที่สอง)|อย่างแรก|พรุ่งนี้|มะรืน|วัน(?:จันทร์|อังคาร|พุธ|พฤหัส|ศุกร์|เสาร์|อาทิตย์|นี้)|เดี๋ยว|ช่วง|ถ้า|เพราะ)/;
const GREETING = /^(?:สวัสดี|ขอบคุณ|ขอบใจ|พอแค่นี้|วันนี้พอ|งั้นวันนี้พอ|บ๊ายบาย|ลาก่อน|ยินดีต้อนรับ)/;
const AGENDA = /(?:^|จะ|มา|วันนี้|ขอ|เรา|ผม|หนู|ฉัน)(?:จะ)?(?:มา)?(?:คุย|พูด|เรียน|ประชุม|ปรึกษา|เล่า|อัปเดต|สอน|นำเสนอ)(?:กัน)?(?:เรื่อง|ถึง|เกี่ยวกับ)\s*(.+)$/;
const NAMED = new RegExp(
  `^(?:เรื่อง(?:ต่อไป|ที่${ORD}|แรก|สุดท้าย)?|ต่อไป(?:เป็น|คือ)?(?:เรื่อง)?|ถัดไป(?:เป็น)?(?:เรื่อง)?|อีกเรื่อง(?:หนึ่ง)?|สุดท้าย(?:เรื่อง)?|เริ่มจาก(?:เรื่อง)?|ก่อนอื่น(?:เลย)?(?:เรื่อง)?|หัวข้อ(?:ต่อไป|ที่${ORD})?|ประเด็น(?:ต่อไป|ที่${ORD})?|ส่วนเรื่อง)\\s*(?:คือ|เป็น|ก็คือ|เรื่อง)?\\s*(.+)$`,
);
const TOPIC_STOP = wordSet('ก่อน กัน ซึ่ง โดย เพราะ คือ เช่น หรือ แต่ ว่า นะ จะ ล่ะ ครับ ค่ะ คะ ดี เลย บ้าง ไหม มั้ย ยังไง อะไร เท่าไหร่ เท่าไร');
const DECISION = /(ตกลง|สรุปว่า|สรุปคือ|ได้ข้อสรุป|อนุมัติ|ตัดสินใจ|เคาะ|ยืนยันว่า|เอาตามนี้|ใช้ตามนี้|เอาเป็นว่า)/;
const IMPORTANT = /(สำคัญ|หลักการ|ข้อดี|ข้อเสีย|แนะนำ|ควร|เพราะ|ปัญหา|ต้อง|ห้าม|อย่า)/;
const QWORD = '(?:ไหม|มั้ย|หรือเปล่า|หรือยัง|หรือไม่|ยังไง|อย่างไร|ทำไม|เท่าไร|เท่าไหร่|ใคร|ที่ไหน|ตรงไหน|อันไหน|เมื่อไร|เมื่อไหร่|กี่\\S{0,8}?|อะไร|\\?)';
const QUESTION = new RegExp(`(?:${QWORD}\\s*(?:ครับ|ค่ะ|คะ|นะ|ดี|บ้าง|กัน|ล่ะ)*|(?<!นะ)คะ|บ้าง(?:ครับ|คะ)?|หรือ\\S+\\s*ดี(?:ครับ|คะ)?)\\s*$`);
const QSTART = /^(?:แล้ว)?(?:ใคร|ทำไม|ยังไง|อย่างไร|ที่ไหน|เมื่อไหร่|เมื่อไร)/;
const RHETORICAL = /(โอเค|ได้|เข้าใจ|ชัด|ตกลง|ใช่)\s*(ไหม|มั้ย|หรือเปล่า)/;
const UNDECIDED = /(ยังไม่(?:ได้)?(?:ตัดสินใจ|ยืนยัน|สรุป|แน่ใจ|รู้|ชัด|ตอบ|เคาะ|ตกลง)|ไว้คุยกัน|ค่อยคุยกัน|ค่อยว่ากัน|ต้องหารือ|รอ\S{0,8}ยืนยัน|รอ\S{0,6}ตอบ)/;
const VAGUE = /^(?:อันนี้|เรื่องนี้|ตรงนี้|ส่วนนี้|อันนั้น|เรื่องนั้น|ข้อนี้)/;
const SPECULATIVE = /(คงต้อง|คงจะ|น่าจะ|อาจจะ|อาจ|ถ้า|หาก|สมมติ|ไม่แน่)/;
const DONE = /\S(?:ไว้|แล้ว)(?=\s|$|ที่|กับ|ว่า)/;
const STRONG = /(ช่วย|ฝาก|รบกวน|อย่าลืม|การบ้าน|ให้ทุกคน|ให้เสร็จ|ภายใน|ด่วน)/;
const MODAL = /(ต้อง|จะ|เดี๋ยว|(?:ผม|หนู|ฉัน|ดิฉัน|เรา|พี่|น้อง)ขอ)/;
const ACTION_START =
  /^(?:ส่ง|โทร|จอง|ติดต่อ|นัด|เตรียม|ทำ|ซื้อ|จ่าย|โอน|ยืนยัน|เช็ค|เช็ก|ตรวจ|อัปเดต|อัพเดท|สรุป(?!ว่า|คือ)|เขียน|ร่าง|ประสาน|คุย|ถาม|แจ้ง|ออกแบบ|ถ่าย|อัด|เก็บ|ปิด|จด|แบ่ง|อ่าน|ฝึก|ทบทวน|เคลียร์|หา|รับ|ลงทะเบียน|ลงคลิป|สมัคร|ยกเลิก|เลื่อน|ต่ออายุ|ปรับ|แก้|เช่า|พา|รด|ล้าง|ซัก|จัด|เตือน|บอก|ขอ|ไป|กลับ|นำ|เอา|ซ่อม|ปริ้น|พิมพ์|โพสต์)/;
const EVENT_START = /^(?:ประชุม|นัด|สอบ|งาน|ปาร์ตี้|ทริป|เดินทาง|บิน|เรียน|สัมมนา|อบรม|เลี้ยง|วันเกิด)/;
const LEAD = /^(?:แล้วก็|แล้ว|และ|ก็|เดี๋ยว|ช่วย|ฝาก|รบกวน|อย่าลืม|ต้อง|จะ|ผม|หนู|ฉัน|ดิฉัน|เรา|พวกเรา|ทุกคน|ขอให้|ให้|ลอง)\s*/;
const TRAIL = /\s*(?:ภายใน|ก่อน|ให้เสร็จ|ด้วย|เลย|ให้ผม|ให้หนู|ให้ด้วย|ให้|แทน|เอง|กัน|ส่งผม|ส่งหนู|ส่ง|ทันที|ได้)$/;
const PERSON = /^(?:คุณ|พี่|น้อง|ป้า|ลุง|อา|น้า|ทีม|ฝ่าย|แผนก)\s?(?!จะ|ต้อง|ช่วย|ก็)[^\s]{1,12}?(?=ช่วย|ต้อง|ไป|จะ|รับ|ดู|ทำ|ส่ง|ติดต่อ|โทร|จอง|เตรียม|ประสาน|ลอง|ฝาก|\s)/;
const UNIT = '(?:บาท|เปอร์เซ็นต์|%|คน|เครื่อง|วัน|สัปดาห์|อาทิตย์|เดือน|ปี|ชิ้น|ครั้ง|ชั่วโมง|นาที|เมตร|กิโล|กก\\.?|ห้อง|คืน|ตัว|กล่อง|ชุด|ล้าน|แสน|หมื่น|พัน)';
const NUM = '(?:\\d[\\d,]*(?:\\.\\d+)?|(?:หนึ่ง|สอง|สาม|สี่|ห้า|หก|เจ็ด|แปด|เก้า|สิบ|ยี่สิบ|ร้อย|พัน|หมื่น|แสน|ล้าน)+)';
const NUMBER = new RegExp(`${NUM}\\s?${UNIT}(?:ต่อ(?:คน|ปี|เดือน|วัน|คืน|ครั้ง|ชั่วโมง|สัปดาห์))?`);
const MONEY = /(บาท|เปอร์เซ็นต์|%|ล้าน)/;
const UNIT_RE = new RegExp(`^${UNIT}`);

// ---------------------------------------------------------------------------
// Words

const THAI_DIGITS = /[๐-๙]/g;
const DIGIT_WORDS = { ศูนย์: 0, หนึ่ง: 1, เอ็ด: 1, สอง: 2, ยี่: 2, สาม: 3, สี่: 4, ห้า: 5, หก: 6, เจ็ด: 7, แปด: 8, เก้า: 9 };
const TENS = { สิบ: 10, ร้อย: 100, พัน: 1000 };
const SPOKEN_NUM = '(?:ศูนย์|หนึ่ง|เอ็ด|สอง|ยี่|สาม|สี่|ห้า|หก|เจ็ด|แปด|เก้า|สิบ|ร้อย|พัน)+';

/** "สิบห้า" → 15, "ยี่สิบ" → 20, "สามพันห้าร้อย" → 3500; NaN when it is not a number. */
export function thaiNumber(s) {
  let total = 0;
  let digit = null;
  let i = 0;
  while (i < s.length) {
    const d = Object.keys(DIGIT_WORDS).find((k) => s.startsWith(k, i));
    if (d) {
      if (digit != null) return NaN;
      digit = DIGIT_WORDS[d];
      i += d.length;
      continue;
    }
    const t = Object.keys(TENS).find((k) => s.startsWith(k, i));
    if (!t) return NaN;
    total += (digit ?? 1) * TENS[t];
    digit = null;
    i += t.length;
  }
  return total + (digit ?? 0);
}

/** Thai digits, spoken counts ("หนึ่งสัปดาห์" → "1 สัปดาห์", "สามคูณสามเมตร" → "3×3 เมตร"), "%". */
function normalizeDigits(s) {
  return s
    .replace(THAI_DIGITS, (d) => String('๐๑๒๓๔๕๖๗๘๙'.indexOf(d)))
    .replace(new RegExp(`(${SPOKEN_NUM}|\\d+)\\s?คูณ\\s?(${SPOKEN_NUM}|\\d+)\\s?(เมตร|เซน\\S*|ซม\\.?)`, 'g'), (m, a, b, u) => {
      const x = /\d/.test(a) ? a : thaiNumber(a);
      const y = /\d/.test(b) ? b : thaiNumber(b);
      return Number.isNaN(Number(x)) || Number.isNaN(Number(y)) ? m : ` ${x}×${y} ${u}`;
    })
    .replace(new RegExp(`(${SPOKEN_NUM})(?=\\s?${UNIT})`, 'g'), (m) => {
      const n = thaiNumber(m);
      return Number.isNaN(n) ? m : ` ${n} `;
    })
    .replace(/(\d)\s*เปอร์เซ็นต์/g, '$1% ')
    .replace(/([\u0E01-\u0E4E])(\d)/g, '$1 $2')
    .replace(/(\d)([\u0E01-\u0E4E])/g, '$1 $2')
    .replace(/[ \t]{2,}/g, ' ');
}

/** Word tokens with their place in the text: [{ w, word, start, end }]. */
export function words(text) {
  const raw = [];
  if (!seg) {
    for (const m of text.matchAll(/\S+|\s+/g)) raw.push({ w: m[0].toLowerCase(), word: /\S/.test(m[0]), start: m.index, end: m.index + m[0].length });
    return raw;
  }
  for (const s of seg.segment(text)) raw.push({ w: s.segment.toLowerCase(), word: !!s.isWordLike, start: s.index, end: s.index + s.segment.length });
  const out = [];
  for (let i = 0; i < raw.length; i++) {
    // the longest run of up to 4 words that spells a loanword in JOIN
    let n = 0;
    if (raw[i].word && raw[i].w.length < JOIN_LONGEST) {
      let w = raw[i].w;
      for (let k = 1; k < 4 && i + k < raw.length && raw[i + k].word; k++) {
        w += raw[i + k].w;
        if (w.length > JOIN_LONGEST) break;
        if (JOIN.has(w)) n = k + 1;
      }
    }
    if (n) {
      const w = raw.slice(i, i + n).map((t) => t.w).join('');
      out.push({ w, word: true, start: raw[i].start, end: raw[i + n - 1].end });
      i += n - 1;
    } else out.push(raw[i]);
  }
  return out;
}

const JOIN_LONGEST = Math.max(...[...JOIN].map((w) => w.length));

const isContent = (w) => w.length > 1 && !STOP.has(w) && !FILLERS.has(w) && !PARTICLES.has(w) && !/^[\d,.]+$/.test(w);
const wordsOf = (text) => words(text).filter((t) => t.word);
const contentCount = (text) => wordsOf(text).filter((t) => isContent(t.w)).length;
/** Content words that say something specific (not "วัน", "คน", "เครื่อง" …). */
const contentful = (text) => wordsOf(text).filter((t) => isContent(t.w) && !KEY_STOP.has(t.w)).length;
const hasNumber = (text) => /\d/.test(text) || NUMBER.test(text);

/** What a person would read: no ums, no politeness before a pause, single spaces. */
export function clean(text, toks = words(String(text ?? ''))) {
  let out = '';
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k];
    if (t.word && FILLERS.has(t.w)) continue;
    const next = toks[k + 1];
    if (t.word && PARTICLES.has(t.w) && (!next || /^\s/.test(next.w) || (next.word && PARTICLES.has(next.w)))) continue;
    out += t.w === text.slice(t.start, t.end).toLowerCase() ? text.slice(t.start, t.end) : t.w;
  }
  out = out.replace(/\s+/g, ' ').trim();
  return stripLead(out, CLEAN_LEAD);
}

const CLEAN_LEAD = wordSet('แล้วก็ แล้ว และ ก็คือ ก็ คือ ซึ่ง งั้น เพราะฉะนั้น ดังนั้น ฉะนั้น โอเค อ๋อ อ้อ');
const COMPACT_LEAD = wordSet('ว่า ก็ คือ ตอนนี้ เพราะ แต่ และ ซึ่ง ส่วน');

const startsWithAny = new Map();
/** Drops leading words from `set`, word by word ("แต่ละคน" keeps its "แต่"). */
function stripLead(text, set) {
  let quick = startsWithAny.get(set);
  if (!quick) startsWithAny.set(set, (quick = new RegExp(`^(?:${[...set].join('|')})`)));
  if (!quick.test(text)) return text; // most text starts with none of them: no need to read words
  let out = text;
  for (let k = 0; k < 4; k++) {
    const first = wordsOf(out.slice(0, 40))[0]; // the first word (no need to read the rest)
    if (!first || !set.has(first.w) || first.end >= out.length) break;
    out = out.slice(first.end).trim();
  }
  return out;
}

const MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
const MONTH_SHORT = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const MONTH_RE = new RegExp(`(?:เดือน)?(${MONTHS.join('|')})`, 'g');

/**
 * Headline style for what is shown: no "เรา/ผม", no "จะ", no leading "เพราะ/แต่",
 * short dates ("ช่วงวันที่ 15 ถึง 17 ธันวาคม" → "ช่วง 15–17 ธ.ค.").
 */
function compact(text) {
  const toks = words(text);
  let out = '';
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k];
    if (t.word && PRONOUNS.has(t.w)) {
      if (toks[k + 1]?.word && /^(?:จะ|ก็)$/.test(toks[k + 1].w)) k++;
      continue;
    }
    if (t.word && t.w === 'จะ' && toks[k + 1]?.word && !/^(?:ได้|เป็น)$/.test(toks[k + 1].w)) continue;
    out += text.slice(t.start, t.end);
  }
  out = out
    .replace(/(?:วันที่\s*)?(\d{1,2})\s*(?:ถึง|-|–)\s*(?:วันที่\s*)?(\d{1,2})\s*(?=(?:เดือน)?(?:มกราคม|กุมภาพันธ์|มีนาคม|เมษายน|พฤษภาคม|มิถุนายน|กรกฎาคม|สิงหาคม|กันยายน|ตุลาคม|พฤศจิกายน|ธันวาคม))/g, ' $1–$2 ')
    .replace(/วันที่\s*(\d{1,2})\s*(?=(?:เดือน)?(?:มกราคม|กุมภาพันธ์|มีนาคม|เมษายน|พฤษภาคม|มิถุนายน|กรกฎาคม|สิงหาคม|กันยายน|ตุลาคม|พฤศจิกายน|ธันวาคม))/g, ' $1 ')
    .replace(MONTH_RE, (m, name, at, all) => `${/\S/.test(all[at - 1] ?? ' ') ? ' ' : ''}${MONTH_SHORT[MONTHS.indexOf(name)]}${/[\u0E01-\u0E4E]/.test(all[at + m.length] ?? '') ? ' ' : ''}`)
    .replace(/\s+/g, ' ')
    .trim();
  return stripLead(out, COMPACT_LEAD) || text;
}

/** "ทีมผลิตแจ้งมาว่าสินค้าล็อตแรกเสร็จช้า…" → "สินค้าล็อตแรกเสร็จช้า…" when what was said stands on its own. */
function dropFrame(text) {
  const m = /^\S{0,24}?(?:แจ้งมาว่า|บอกมาว่า|บอกว่า|เล่าว่า|รายงานว่า|ยืนยันมาว่า|แจ้งว่า)\s*/.exec(text);
  if (!m) return text;
  const rest = text.slice(m[0].length);
  return contentful(rest) >= 2 ? rest : text;
}

// ---------------------------------------------------------------------------
// 1. Utterances

const SPEAKER_LINE = /^\s*(?:ผู้พูด|speaker|ผู้บรรยาย)\s*\d*\s*[:：]?\s*(?:\(?\d{1,2}:\d{2}(?::\d{2})?\)?)?\s*$/i;
const TIME_LINE = /^\s*\(?\d{1,2}:\d{2}(?::\d{2})?\)?\s*$/;
const SPEAKER_PREFIX = /^\s*(?:ผู้พูด|speaker)\s*\d+\s*(?:\(?\d{1,2}:\d{2}(?::\d{2})?\)?)?\s*[:：]\s*/i;

const isQuestion = (s) => QUESTION.test(s.text) || QSTART.test(s.clean);
const INLINE_SPEAKER = /(?:ผู้พูด|speaker)\s*\d+\s*(?:\(\d{1,2}:\d{2}(?::\d{2})?\))?\s*[:：]?|\(\d{1,2}:\d{2}(?::\d{2})?\)/gi;

/**
 * Speech recognizers often return long runs with no spaces at all: put a pause after polite end
 * particles and before words that start a sentence, so the rest works as with spaced text.
 */
const PAUSE_AFTER = wordSet('ครับ ค่ะ คะ ครับผม นะคะ นะครับ จ้ะ จ้า ฮะ');
const PAUSE_BEFORE =
  /^(?:เรื่องต่อไป|ต่อไปเป็นเรื่อง|อีกเรื่อง|สุดท้ายเรื่อง|สรุปว่า|สรุปคือ|เพราะฉะนั้น|ดังนั้น|นอกจากนี้|อย่างไรก็ตาม|หลังจากนั้น|จากนั้น|การบ้าน|เอาเป็นว่า|แล้วก็|แล้วใคร|แล้วเรื่อง|ส่วนเรื่อง|แต่ว่า|แต่|เพราะ|ถ้า|อย่าลืม|ซึ่ง|ข้อดี|ข้อเสีย|แนะนำ|โดยทั่วไป|เดี๋ยว|ตกลง|งั้น|โอเค|ที่(?:แรก|สอง|สาม))/;
const CLAUSE_WORDS = wordSet('และ หรือ โดย เช่น ก็ แล้ว ที่ ส่วน ควร ต้อง');

/** A line → phrases (what lies between pauses) with their words: [{ p, toks }]. */
function phrasesOf(line) {
  const out = [];
  for (const chunk of line.split(/\s+/)) {
    if (!chunk) continue;
    const toks = words(chunk);
    const text = pauses(chunk, toks);
    const pieces = (text === chunk ? [chunk] : text.split(' ')).flatMap((x) => x.split(/(?<=[.!?…])/)).filter(Boolean);
    if (pieces.length === 1) out.push({ p: chunk, toks });
    else for (const p of pieces) out.push({ p, toks: words(p) });
  }
  return out;
}

function pauses(chunk, toks) {
  if (chunk.length < 40) return chunk; // fewer than ~12 words
  if (toks.filter((t) => t.word).length <= 12) return chunk;
  const ends = new Set(toks.map((t) => t.end));
  let out = '';
  let run = 0;
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k];
    const prev = toks[k - 1];
    if (k && t.word && prev?.word) {
      const m = PAUSE_BEFORE.exec(chunk.slice(t.start));
      const cut =
        (PAUSE_AFTER.has(prev.w) && !PARTICLES.has(t.w)) ||
        (m && ends.has(t.start + m[0].length)) ||
        FILLERS.has(t.w) ||
        (run >= 20 && CLAUSE_WORDS.has(t.w)) ||
        run >= 32;
      if (cut) {
        out += ' ';
        run = 0;
      }
    }
    out += chunk.slice(t.start, t.end);
    if (t.word) run++;
  }
  return out;
}

/**
 * Text → sentences [{ i, text, clean, para, newPara, toks, content, set, isQ, answers?, answered? }].
 * Paragraph numbers mark breaks in the source (speaker turns, blank lines).
 */
export function sentences(input) {
  const lines = normalizeDigits(String(input ?? ''))
    .replace(/\r/g, '')
    .replace(INLINE_SPEAKER, '\n')
    .split('\n');
  const raw = [];
  let para = 0;
  let current = [];
  let count = 0;
  let breakBefore = true;
  // A sentence's words are its phrases' words put together (each piece of text is read once).
  const flush = () => {
    let text = '';
    const toks = [];
    for (const { p, toks: pt } of current) {
      if (text) {
        toks.push({ w: ' ', word: false, start: text.length, end: text.length + 1 });
        text += ' ';
      }
      for (const t of pt) toks.push({ ...t, start: t.start + text.length, end: t.end + text.length });
      text += p;
    }
    current = [];
    count = 0;
    if (text) {
      raw.push({ text, toks, para, newPara: breakBefore });
      breakBefore = false;
    }
  };
  for (const line0 of lines) {
    if (SPEAKER_LINE.test(line0) || TIME_LINE.test(line0)) {
      flush();
      continue;
    }
    const line = line0.replace(SPEAKER_PREFIX, '').trim();
    if (!line) {
      flush();
      para++;
      breakBefore = true;
      continue;
    }
    for (const { p: phrase, toks: all } of phrasesOf(line)) {
      const toks = all.filter((t) => t.word);
      if (toks.length && toks.every((t) => FILLERS.has(t.w))) {
        if (count >= 4) flush(); // a pause
        continue;
      }
      if (toks.length && toks.every((t) => ACK.has(t.w) || PARTICLES.has(t.w))) {
        // "ได้ครับ" after a request: its own (empty) sentence, so the request stays clean
        flush();
        current.push({ p: phrase, toks: all });
        flush();
        continue;
      }
      const clause = count >= 6 && /^\S{2,30}?(?:จะต้อง|ต้อง|ช่วย|ควร)\S/.test(phrase) && !SOFT_STARTS.test(phrase);
      if (current.length && (SENTENCE_STARTS.test(phrase) || (count >= 5 && SOFT_STARTS.test(phrase)) || clause)) flush();
      current.push({ p: phrase, toks: all });
      count += toks.length;
      const last = toks.at(-1)?.w ?? '';
      if (END_PARTICLES.has(last) || /[.!?]$/.test(phrase) || QUESTION.test(phrase) || count >= 28) flush();
    }
    flush();
    para++;
    breakBefore = true;
  }
  flush();
  // Agreement and bare particles carry no content: dropped, but a paragraph break they held moves on.
  const kept = [];
  let carry = false;
  for (const s of raw) {
    const toks = s.toks;
    const content = toks.filter((t) => t.word && isContent(t.w)).map((t) => t.w);
    if (!content.length && !hasNumber(s.text)) {
      carry ||= s.newPara;
      continue;
    }
    kept.push({ ...s, toks, content, newPara: s.newPara || carry });
    carry = false;
  }
  const out = kept.map((s, i) => ({
    i,
    text: s.text,
    para: s.para,
    newPara: s.newPara,
    clean: clean(s.text, s.toks),
    toks: s.toks,
    content: s.content,
    set: new Set(s.content),
    isQ: false,
  }));
  for (const s of out) s.isQ = isQuestion(s);
  // A question and the answer right after it
  for (let i = 0; i + 1 < out.length; i++) {
    const q = out[i];
    const a = out[i + 1];
    if (q.isQ && !RHETORICAL.test(q.text) && !a.isQ && !UNDECIDED.test(a.text)) {
      a.answers = i;
      q.answered = true;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 2. Key phrases

/** Runs of content words (n-grams inside them) → [{ phrase, score, count }] best first. */
export function keyphrases(sents, { max = 12 } = {}) {
  const grams = new Map();
  for (const s of sents) {
    let run = [];
    const close = () => {
      while (run.length && !isContent(run[0].w)) run.shift();
      while (run.length && !isContent(run.at(-1).w) && !(run.length > 1 && KEEP_END.has(run.at(-1).w))) run.pop();
      for (let a = 0; a < run.length; a++) {
        for (let b = a + 1; b <= Math.min(run.length, a + 5); b++) {
          const part = run.slice(a, b);
          const end = part.at(-1).w;
          if (!isContent(part[0].w) || !(isContent(end) || (part.length > 1 && KEEP_END.has(end)))) continue;
          if (part.length === 1 && KEY_STOP.has(end)) continue;
          const phrase = s.text.slice(part[0].start, part.at(-1).end).replace(/\s+/g, ' ');
          if (phrase.length < 2) continue;
          const g = grams.get(phrase) ?? { phrase, n: b - a, count: 0 };
          g.count++;
          grams.set(phrase, g);
        }
      }
      run = [];
    };
    for (const t of s.toks) {
      if (!t.word) {
        if (/\s/.test(t.w)) close();
        continue;
      }
      if (isContent(t.w) || (run.length && KEEP_IN_RUN.has(t.w))) run.push(t);
      else close();
    }
    close();
  }
  const list = [...grams.values()].filter((g) => g.n === 1 || g.count >= 2);
  for (const g of list) g.score = g.count * (1 + 0.6 * (g.n - 1)) * (g.n === 1 && g.phrase.length < 3 ? 0.5 : 1);
  // A phrase that mostly appears inside a longer one is that longer phrase.
  list.sort((a, b) => b.phrase.length - a.phrase.length);
  const kept = [];
  for (const g of list) {
    if (kept.some((k) => k.phrase.includes(g.phrase) && k.count >= g.count * 0.6)) continue;
    kept.push(g);
  }
  return kept.sort((a, b) => b.score - a.score || b.n - a.n).slice(0, max);
}

// ---------------------------------------------------------------------------
// 3. Key sentences

const overlap = (a, b) => {
  let n = 0;
  for (const w of a) if (b.has(w)) n++;
  return n;
};

/** TextRank: a sentence is important when important sentences share its words. */
export function textrank(sents, { damping = 0.85, iterations = 40 } = {}) {
  const n = sents.length;
  if (!n) return [];
  if (n > 900) return sents.map((s) => s.set.size); // very long: plain word coverage
  const w = sents.map(() => new Float64Array(n));
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = sents[i].set;
      const b = sents[j].set;
      if (a.size < 2 || b.size < 2) continue;
      const o = overlap(a, b);
      if (!o) continue;
      const sim = o / (Math.log(a.size + 1) + Math.log(b.size + 1));
      w[i][j] = sim;
      w[j][i] = sim;
    }
  }
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) out[i] += w[i][j];
  let score = new Float64Array(n).fill(1);
  for (let k = 0; k < iterations; k++) {
    const next = new Float64Array(n).fill(1 - damping);
    for (let j = 0; j < n; j++) {
      if (!out[j]) continue;
      const share = (damping * score[j]) / out[j];
      for (let i = 0; i < n; i++) if (w[j][i]) next[i] += w[j][i] * share;
    }
    score = next;
  }
  return [...score];
}

function scoreSentences(sents, phrases) {
  const tr = textrank(sents);
  const trMax = Math.max(...tr, 1e-9);
  const kw = sents.map((s) => {
    let v = 0;
    for (const p of phrases) if (s.text.includes(p.phrase)) v += p.score;
    return v / Math.sqrt(Math.max(4, s.content.length));
  });
  const kwMax = Math.max(...kw, 1e-9);
  return sents.map((s, i) => {
    let v = 0.5 * (tr[i] / trMax) + 0.5 * (kw[i] / kwMax);
    if (s.newPara || i === 0) v += 0.05;
    if (DECISION.test(s.text) && !UNDECIDED.test(s.text)) v += 0.2;
    if (IMPORTANT.test(s.text)) v += 0.1;
    if (NUMBER.test(s.text)) v += 0.1;
    if (s.answers != null) v += 0.1;
    if (s.content.length < 3 && s.answers == null) v *= 0.3;
    if (GREETING.test(s.clean)) v *= 0.2;
    if (s.isQ) v *= 0.5;
    return v;
  });
}

const jaccard = (a, b) => {
  const o = overlap(a, b);
  return o / (a.size + b.size - o || 1);
};

/** Maximal Marginal Relevance: good sentences that do not repeat each other. */
function pick(cands, scores, k, sents, lambda = 0.72) {
  const chosen = [];
  const pool = [...cands];
  while (chosen.length < k && pool.length) {
    let best = -Infinity;
    let at = -1;
    pool.forEach((i, n) => {
      const red = chosen.length ? Math.max(...chosen.map((c) => jaccard(sents[i].set, sents[c].set))) : 0;
      const v = lambda * scores[i] - (1 - lambda) * red;
      if (v > best) {
        best = v;
        at = n;
      }
    });
    chosen.push(pool.splice(at, 1)[0]);
  }
  return chosen.sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------
// 4. Topics

const cosine = (a, b) => {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const [w, x] of a) {
    na += x * x;
    if (b.has(w)) dot += x * b.get(w);
  }
  for (const x of b.values()) nb += x * x;
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
};

const bag = (list) => {
  const m = new Map();
  for (const s of list) for (const w of s.content) m.set(w, (m.get(w) ?? 0) + 1);
  return m;
};

/** Sections as [start, end) sentence indexes. */
export function topics(sents, { maxSections = 6 } = {}) {
  const n = sents.length;
  if (n < 5) return [[0, n]];
  // Paragraphs are topics in a written-up transcript, but only speaker turns in a dialogue.
  const paras = new Set(sents.map((s) => s.para)).size;
  const paraTopics = n / paras >= 2.5;
  const forced = new Set();
  for (let i = 1; i < n; i++) {
    if (TOPIC_MARKERS.test(sents[i].clean) || (paraTopics && sents[i].newPara && sents[i].para !== sents[i - 1].para)) forced.add(i);
  }
  let cuts = [...forced];
  if (cuts.length < 2 && n >= 10) {
    // TextTiling: depth of the dips in word overlap between neighbouring windows
    const k = Math.max(2, Math.min(4, Math.round(n / 8)));
    const gaps = [];
    for (let g = 1; g < n; g++) gaps.push(cosine(bag(sents.slice(Math.max(0, g - k), g)), bag(sents.slice(g, g + k))));
    const smooth = gaps.map((v, i) => (gaps[i - 1] ?? v) / 4 + v / 2 + (gaps[i + 1] ?? v) / 4);
    const depth = smooth.map((v, i) => {
      let l = v;
      for (let j = i - 1; j >= 0 && smooth[j] >= l; j--) l = smooth[j];
      let r = v;
      for (let j = i + 1; j < smooth.length && smooth[j] >= r; j++) r = smooth[j];
      return l - v + (r - v);
    });
    const mean = depth.reduce((a, b) => a + b, 0) / depth.length;
    const sd = Math.sqrt(depth.reduce((a, b) => a + (b - mean) ** 2, 0) / depth.length);
    const found = depth
      .map((d, i) => ({ at: i + 1, d }))
      .filter((x) => x.d > mean + sd / 2 && x.d > 0.1)
      .sort((a, b) => b.d - a.d);
    for (const x of found) if (cuts.every((c) => Math.abs(c - x.at) >= 3) && x.at >= 2 && n - x.at >= 2) cuts.push(x.at);
  }
  cuts = cuts.filter((c) => c > 0 && c < n).sort((a, b) => a - b);
  cuts = cuts.filter((c, i) => c - (cuts[i - 1] ?? 0) >= 2 || forced.has(c));
  while (cuts.length >= maxSections) {
    // merge the shortest section into the one before it
    const bounds = [0, ...cuts, n];
    let shortest = 1;
    for (let i = 1; i < bounds.length - 1; i++) if (bounds[i + 1] - bounds[i] < bounds[shortest + 1] - bounds[shortest]) shortest = i;
    cuts.splice(shortest - 1, 1);
  }
  const bounds = [0, ...cuts, n];
  return bounds.slice(0, -1).map((b, i) => [b, bounds[i + 1]]);
}

// ---------------------------------------------------------------------------
// Naming things and making them short

/** Cuts a chunk at its first stop word (after the first word); [text, stopped]. */
function cutAt(chunk, stops) {
  const toks = words(chunk);
  let seen = 0;
  for (const t of toks) {
    if (!t.word) continue;
    if (seen && stops.has(t.w)) return [chunk.slice(0, t.start).trim(), true];
    seen++;
  }
  return [chunk, false];
}

function topicName(rest) {
  const chunks = rest.replace(/^(?:คือ|เป็น|เรื่อง|ของ|เรา|กัน|ก็คือ)\s*/, '').split(/\s+/).filter(Boolean);
  if (!chunks.length) return '';
  let [name, stopped] = cutAt(chunks[0], TOPIC_STOP);
  for (let k = 1; k < chunks.length && !stopped; k++) {
    const tail = wordsOf(name).at(-1)?.w ?? '';
    if (!/^[\dA-Za-z]/.test(chunks[k]) && !/^(?:แบบ|ของ|กับ|และ|ใน|ที่)$/.test(tail)) break;
    const [more, s] = cutAt(chunks[k], TOPIC_STOP);
    if (!more || (name + more).length > 36) break;
    name += ` ${more}`;
    stopped = s;
  }
  name = shorten(name, 36, { keepStart: true });
  if (!contentCount(name)) return '';
  return name.length <= 3 ? `เรื่อง${name}` : name;
}

/** A topic the speaker named: "อีกเรื่องหนึ่งคือคลิปรีวิวสินค้า…" → "คลิปรีวิวสินค้า…". */
export function namedTopic(text) {
  const t = clean(text);
  if (/^การบ้าน/.test(t)) return 'การบ้าน';
  const m = AGENDA.exec(t) ?? NAMED.exec(t);
  return m ? topicName(m[1]) : '';
}

const WEAK_START = wordSet('และ แต่ ก็ ซึ่ง ที่ คือ ว่า แล้ว เพราะ โดย หรือ กับ ของ ใน จะ ได้');
const WEAK_END = wordSet(`และ แต่ ก็ ซึ่ง ที่ คือ ว่า แล้ว เพราะ โดย หรือ กับ ของ ใน บน จะ ให้ ไป มา เป็น อยู่ มี จาก ถึง ตาม เพื่อ
  แบบ เช่น อย่าง ทั้ง ทุก บาง ประมาณ อีก ยัง ถ้า หาก เมื่อ ตอน ช่วง ต้อง ควร อาจ น่า คง แค่ ตั้งแต่ ระหว่าง จน ส่วน
  เรา ผม หนู ฉัน คุณ เขา สำหรับ`);
const weakEnd = (w, inside) => PARTICLES.has(w) || FILLERS.has(w) || WEAK_END.has(w) || (inside && w === 'ไม่');
const ORDINAL_NEXT = /^(?:แรก|สอง|สาม|สี่|ห้า|หนึ่ง|\d)/;

/**
 * At most `max` characters of a sentence: the stretch with the most key words, cut between words,
 * preferably at pauses, without dangling ends. `keepStart` keeps the beginning.
 */
export function shorten(text, max = 40, { focus = [], keepStart = false } = {}) {
  const t = clean(text);
  const toks = words(t);
  const idx = toks.map((x, i) => (x.word ? i : -1)).filter((i) => i >= 0);
  if (!idx.length) return t;
  const natural = (k) => {
    const nx = toks[k + 1];
    return !nx || !nx.word || STOP.has(nx.w) || PARTICLES.has(nx.w);
  };
  const trimEnd = (a, b) => {
    while (b > a && weakEnd(toks[idx[b]].w, b < idx.length - 1)) b--;
    return b;
  };
  // "ที่แรก" is a place, not a relative clause
  const weakStart = (k) => WEAK_START.has(toks[idx[k]].w) && !(toks[idx[k]].w === 'ที่' && ORDINAL_NEXT.test(toks[idx[k] + 1]?.w ?? ''));
  if (t.length <= max) {
    let a = 0;
    while (!keepStart && a < idx.length - 1 && weakStart(a)) a++;
    const b = trimEnd(a, idx.length - 1);
    return withDot(t, toks[idx[a]].start, toks[idx[b]].end);
  }
  let best = null;
  for (let a = 0; a < idx.length; a++) {
    if (keepStart && a > 0) break;
    if (a > 0 && weakStart(a)) continue;
    const start = toks[idx[a]].start;
    let b = a;
    while (b + 1 < idx.length && toks[idx[b + 1]].end - start <= max) b++;
    if (/^\d/.test(toks[idx[b]].w) && b + 1 < idx.length && UNIT_RE.test(toks[idx[b + 1]].w)) b++; // "2 สัปดาห์", never "2"
    // step back to a pause when one is close
    let nb = b;
    for (let k = b; k > a && k >= b - 3 && b < idx.length - 1; k--) {
      if (natural(idx[k])) {
        nb = k;
        break;
      }
    }
    nb = trimEnd(a, nb);
    const piece = t.slice(start, toks[idx[nb]].end);
    let v = 0;
    for (let k = a; k <= nb; k++) if (isContent(toks[idx[k]].w)) v++;
    v += focus.reduce((n, f) => n + (f && piece.includes(f) ? 2 + f.length / 6 : 0), 0);
    if (hasNumber(piece)) v += 3;
    const prev = toks[idx[a] - 1];
    if (a === 0 || !prev || /\s/.test(prev.w) || WEAK_START.has(prev.w)) v += 1;
    if (natural(idx[nb])) v += 1;
    if (nb === idx.length - 1) v += 1;
    v -= a * 0.02;
    if (!best || v > best.v) best = { v, a, b: nb };
  }
  return withDot(t, toks[idx[best.a]].start, toks[idx[best.b]].end);
}

/** A slice that keeps what is glued to its last word: the dot of "ธ.ค.", the "%" of "20%". */
const withDot = (t, a, b) => t.slice(a, /[.%)]/.test(t[b] ?? '') ? b + 1 : b).trim();

/** The end of a text, at most `max` characters, starting at a word. */
function tail(text, max) {
  if (text.length <= max) return text;
  const all = words(text);
  const toks = all.filter((t) => t.word);
  const fits = (t) => text.length - t.start <= max;
  const pause = (t) => {
    const k = all.indexOf(t);
    return k === 0 || /\s/.test(all[k - 1].w) || STOP.has(all[k - 1].w);
  };
  let a = toks.findIndex((t) => fits(t) && pause(t));
  if (a < 0) a = toks.findIndex(fits);
  if (a < 0) a = toks.length - 1;
  while (a < toks.length - 1 && WEAK_START.has(toks[a].w)) a++;
  return text.slice(toks[a].start).trim();
}

/** What a question was about: "แล้วงบทั้งทริปเท่าไหร่ดีคะ" → "งบทั้งทริป". */
function qTopic(s) {
  const m = new RegExp(QWORD).exec(s.clean);
  let text = !m ? s.clean : m.index > 0 ? s.clean.slice(0, m.index) : s.clean.slice(m[0].length);
  text = compact(text.replace(/^(?:แล้ว|ส่วน|เรื่อง|ถ้า)\s*/, ''));
  for (let k = 0; k < 4; k++) text = text.replace(/\s*(?:จะ|ได้|เป็น|มี|ควร|ต้อง|ดี|หรือ|กัน)$/, '').replace(/^(?:จะ|เป็น|ได้)\s*/, '');
  return tail(text.trim(), 26);
}

/** A sentence as a point: compact, short, and an answer says what it answers. */
function pointText(s, sents, max, focus) {
  let base = compact(s.clean);
  if (TOPIC_MARKERS.test(s.clean) && base.includes(' ')) {
    const rest = base.slice(base.indexOf(' ') + 1);
    if (contentful(rest) >= 2) base = rest;
  }
  let text = shorten(dropFrame(base), max, { focus });
  const q = s.answers != null && sents[s.answers];
  if (q && contentful(text) < 2 && !overlap(s.set, q.set)) {
    const topic = qTopic(q);
    if (topic && !text.includes(topic)) text = `${topic}: ${text}`;
  }
  return text;
}

// ---------------------------------------------------------------------------
// 5. Meeting-note rules

const ACTION_ANY = new RegExp(`${ACTION_START.source.slice(1)}|${EVENT_START.source.slice(1)}`);
/** Words that may carry a date or time (only then is the date reader worth running). */
const DATEISH = /วัน|พรุ่งนี้|มะรืน|คืนนี้|เช้า|บ่าย|เย็น|ค่ำ|โมง|ทุ่ม|เที่ยง|\d|นี้|หน้า|มกรา|กุมภา|มีนา|เมษา|พฤษภา|มิถุนา|กรกฎา|สิงหา|กันยา|ตุลา|พฤศจิ|ธันวา/;

function action(s, now, today) {
  if (s.isQ || GREETING.test(s.clean) || !ACTION_ANY.test(s.clean)) return null;
  const strong = STRONG.test(s.text);
  if (!strong && !MODAL.test(s.text) && !DATEISH.test(s.clean)) return null;
  if (!strong && (SPECULATIVE.test(s.clean) || DONE.test(s.clean) || (DECISION.test(s.text) && !UNDECIDED.test(s.text)))) return null;
  const parsed = parseWhen(s.clean, now);
  const dated = !!parsed.day;
  if (AGENDA.test(s.clean) && (!dated || parsed.day === today) && !strong) return null;
  let what = (dated ? parsed.text : s.clean).replace(/\s+/g, ' ').trim();
  let prefix = '';
  if (/^การบ้าน/.test(what)) {
    prefix = 'การบ้าน: ';
    what = what.replace(/^การบ้าน\S*\s*/, '');
  }
  let who = '';
  for (let k = 0; k < 6; k++) {
    const p = !who && PERSON.exec(what);
    if (p) {
      who = p[0].trim();
      what = what.slice(p[0].length).trim();
      continue;
    }
    const next = what.replace(LEAD, '');
    if (next === what) break;
    what = next;
  }
  if (!(ACTION_START.test(what) || (dated && EVENT_START.test(what)))) return null;
  if (!strong && !dated && !MODAL.test(s.text)) return null;
  for (let k = 0; k < 4; k++) {
    const next = what.replace(TRAIL, '').trim();
    if (next === what || contentCount(next) < 1) break;
    what = next;
  }
  what = shorten(compact(what), 48, { keepStart: true });
  if (contentCount(what) < 1) return null;
  const when = dated ? describeWhen(parsed.day, parsed.time, today) : '';
  return { text: prefix + what, who, day: parsed.day, time: parsed.time, when, i: s.i };
}

/** The part of a sentence that says what is still open: "…แต่ทางห้างยังไม่ยืนยันขนาด" → "ทางห้างยังไม่ยืนยันขนาด". */
function openClause(s) {
  const m = UNDECIDED.exec(s.clean);
  let text = s.clean;
  if (m) {
    const before = s.clean.slice(0, m.index);
    const cut = Math.max(before.lastIndexOf(' '), ...['แต่', 'ส่วน', 'ซึ่ง'].map((w) => before.lastIndexOf(w)));
    if (cut > 0) text = s.clean.slice(cut).replace(/^\s*(?:แต่|ส่วน|ซึ่ง)\s*/, '');
  }
  return shorten(dropFrame(compact(text)), 48);
}

const questionText = (s) => shorten(compact(s.clean.replace(/^แล้ว\s*/, '')), 48);

/** Numbers worth remembering with the words that say what they are: "งบ… 600,000 บาท". */
function factsOf(s, sents) {
  const out = [];
  if (!NUMBER.test(s.clean)) return out;
  const text = compact(s.clean);
  for (const m of text.matchAll(new RegExp(NUMBER.source, 'g'))) {
    const before = text.slice(0, m.index);
    let start = before.length;
    // back to the pause before the number, and further while that says nothing
    for (let k = 0; k < 3 && start > 0; k++) {
      const sp = before.lastIndexOf(' ', start - 2);
      start = sp + 1;
      const lead = before.slice(start);
      if (wordsOf(lead).some((t) => isContent(t.w) && !KEY_STOP.has(t.w))) break;
      if (sp < 0) break;
    }
    const lead = before.slice(start);
    const after = text.slice(m.index + m[0].length).trim().split(' ')[0] ?? '';
    let fact =
      (!contentful(lead) || /^(?:สำหรับ|ของ|ต่อ|ใน|เป็น)/.test(after)) && contentful(after)
        ? `${m[0].trim()} ${shorten(after, 30, { keepStart: true })}`
        : tail(dropFrame(text.slice(start, m.index + m[0].length).trim()), 48);
    if (s.answers != null && contentful(fact.replace(m[0], '')) < 1) {
      const topic = qTopic(sents[s.answers]);
      if (topic) fact = `${topic}: ${fact}`;
    }
    if (fact.length > m[0].length + 1) out.push({ i: s.i, text: fact, value: m[0].replace(/\s+/g, ''), money: MONEY.test(m[0]) });
  }
  return out;
}

// ---------------------------------------------------------------------------
// 6. Everything together

/** A number the summary already shows (in a point, a topic or a decision). */
const saidElsewhere = (f, ...lists) => lists.flat().some((x) => x.text.includes(f.text) || x.text.replace(/\s+/g, '').includes(f.value));

const AUTO_TITLE = /^(?:บันทึกเสียง|ไฟล์เสียงที่แชร์มา|ข้อความที่แชร์มา)(?:\s|$)/;

function dedupe(list) {
  const out = [];
  for (const x of list) if (x && !out.some((y) => y === x || y.includes(x) || x.includes(y))) out.push(x);
  return out;
}

/**
 * Text → { title, named, keywords, points, decisions, actions, open, facts, sections, summary, items }.
 * `now` is when it was said (dates like "ศุกร์นี้" count from then).
 */
export function analyze(text, { title = '', now = Date.now(), maxPoints } = {}) {
  const today = dayKey(new Date(now));
  const sents = sentences(text);
  if (!sents.length) return null;
  const phrases = keyphrases(sents);
  const scores = scoreSentences(sents, phrases);
  const focus = phrases.slice(0, 6).map((p) => p.phrase);

  // Rules: things to do, what was agreed, what is still open, numbers
  const actions = [];
  const decisions = [];
  const open = [];
  const facts = [];
  const used = new Set();
  sents.forEach((s, i) => {
    if (used.has(i)) return;
    const a = action(s, now, today);
    if (a) {
      // "…โทรคุยกับฝ่ายการตลาด" + "ขอพื้นที่ใหญ่ขึ้น": the short follow-up belongs to it
      const nx = sents[i + 1];
      if (nx && nx.para === s.para && !nx.isQ && nx.content.length <= 4 && ACTION_START.test(nx.clean) && !action(nx, now, today) && !nx.answers) {
        a.text = shorten(`${a.text} ${compact(nx.clean)}`, 56, { keepStart: true });
        used.add(i + 1);
      }
      // "คุณเอ็มช่วยส่ง…" + "แล้วก็อย่าลืมทำสัญญา…": the same person
      const last = actions.at(-1);
      const goesOn = last && last.i >= i - 1 && /^(?:แล้วก็|แล้ว|และ|กับ|อย่าลืม)/.test(s.text);
      if (goesOn && !last.when && a.when && (!a.who || a.who === last.who)) {
        // "การบ้าน… จดรายรับรายจ่าย 7 วัน" + "แล้วแบ่งตามสูตร… ส่งวันพุธหน้า": one task with a due date
        Object.assign(last, { text: shorten(`${last.text} แล้ว${a.text}`, 64, { keepStart: true }), day: a.day, time: a.time, when: a.when, i });
        used.add(i);
        return;
      }
      if (goesOn && !a.who && last.who) a.who = last.who;
      if (!actions.some((x) => x.text === a.text && x.who === a.who && x.day === a.day)) actions.push(a);
      used.add(i);
      return;
    }
    if (UNDECIDED.test(s.text)) {
      const prev = sents[i - 1];
      const lastOpen = open.at(-1);
      if (lastOpen && lastOpen.i >= i - 2 && /^(?:ไว้|ค่อย|รอ|เดี๋ยว)/.test(s.clean)) {
        lastOpen.note = shorten(compact(s.clean), 36);
      } else if (VAGUE.test(s.clean) || s.content.length < 3) {
        // "อันนี้ยังไม่ได้ตัดสินใจ": the question before it is what is open
        if (prev?.isQ && !open.some((o) => o.i === i - 1)) open.push({ i: i - 1, text: questionText(prev) });
      } else if (!open.some((o) => o.text === openClause(s))) open.push({ i, text: openClause(s) });
      used.add(i);
      return;
    }
    if (s.isQ) {
      if (!s.answered && !RHETORICAL.test(s.text) && s.content.length >= 2) open.push({ i, text: questionText(s) });
      used.add(i);
      return;
    }
    if (DECISION.test(s.text) && s.content.length >= 2) {
      const t = s.clean.replace(/^(?:งั้น|โอเค)?\s*(?:สรุปว่า|สรุปคือ|ตกลง(?:ว่า|กัน)?|เอาเป็นว่า|ได้ข้อสรุปว่า)\s*/, '');
      const text = shorten(compact(t), 48, { focus });
      if (!decisions.some((d) => d.text === text)) decisions.push({ i, text });
      used.add(i);
    }
  });
  open.sort((a, b) => a.i - b.i);
  // numbers: only the best few dozen sentences that have one are worth reading closely
  const withNumbers = sents.filter((s) => NUMBER.test(s.clean)).sort((a, b) => MONEY.test(b.clean) - MONEY.test(a.clean) || scores[b.i] - scores[a.i]).slice(0, 40);
  for (const s of withNumbers) for (const f of factsOf(s, sents)) if (!facts.some((x) => x.value === f.value)) facts.push(f);
  facts.sort((a, b) => b.money - a.money || scores[b.i] - scores[a.i]);

  // Key sentences, not repeating the lists above
  const isPoint = (i) => {
    const s = sents[i];
    const weight = s.content.length + (hasNumber(s.text) ? 1 : 0);
    // "วันนี้มาคุยเรื่อง…" names the subject; in a short note it is the content
    const agenda = sents.length >= 6 && AGENDA.test(s.clean);
    return !used.has(i) && (weight >= 3 || (s.answers != null && weight >= 1)) && !GREETING.test(s.clean) && !s.isQ && !agenda;
  };
  const count = maxPoints ?? Math.max(2, Math.min(7, Math.round(sents.length * 0.2)));
  const cands = sents.map((s) => s.i).filter(isPoint);
  const points = pick(cands, scores, count, sents).map((i) => ({ i, text: pointText(sents[i], sents, 64, focus) }));

  // The subject
  let subject = '';
  for (const s of sents.slice(0, 3)) if ((subject = namedTopic(s.text)) && subject !== 'การบ้าน') break;
  if (subject === 'การบ้าน') subject = '';
  const named = !!subject;
  const given = title.trim();
  if (!subject && given && !AUTO_TITLE.test(given)) subject = given;
  if (!subject) subject = phrases.find((p) => p.n > 1 && p.count >= 2)?.phrase ?? (given || 'บันทึก');

  // Topics and what each one says
  const usedNames = new Set([subject]);
  const sections = [];
  for (const [a, b] of topics(sents)) {
    const part = sents.slice(a, b);
    let name = '';
    for (const s of part.slice(0, 2)) if ((name = namedTopic(s.text))) break;
    if (!name || name === subject) name = a === 0 && part.length >= 2 ? 'ภาพรวม' : '';
    if (!name || usedNames.has(name)) {
      const local = keyphrases(part, { max: 8 });
      name = local.map((p) => p.phrase).find((p) => !usedNames.has(p) && !subject.includes(p) && p.length >= 3) ?? '';
    }
    const idx = [];
    for (let i = a; i < b; i++) if (isPoint(i) && !(name && sents[i].clean.includes(name) && sents[i].content.length <= wordsOf(name).length + 2)) idx.push(i);
    const decs = decisions.filter((d) => d.i >= a && d.i < b).sort((x, y) => scores[y.i] - scores[x.i]).slice(0, 3);
    // the best sentences of the topic that do not repeat each other or what was agreed
    const top = [];
    for (const i of idx.sort((x, y) => scores[y] - scores[x])) {
      if (top.length >= (b - a > 7 ? 4 : 3)) break;
      if ([...top, ...decs.map((d) => d.i)].some((j) => jaccard(sents[i].set, sents[j].set) >= 0.34 || sents[j].clean === sents[i].clean)) continue;
      top.push(i);
    }
    if (!top.length && !decs.length) continue;
    if (!name) name = shorten(compact(sents[top[0] ?? decs[0].i].clean), 22);
    usedNames.add(name);
    const rows = [...top.map((i) => ({ i, text: pointText(sents[i], sents, 56, [name, ...focus]) })), ...decs.map((d) => ({ i: d.i, text: d.text, agreed: true }))].sort((x, y) => x.i - y.i);
    sections.push({ name, from: a, to: b, rows, points: rows.filter((r) => !r.agreed).map((r) => r.text), decisions: decs.map((d) => d.text) });
  }
  if (sections.length === 1 && sections[0].name === 'ภาพรวม') sections[0].name = phrases.find((p) => !subject.includes(p.phrase))?.phrase ?? 'ภาพรวม';

  const keywords = phrases
    .map((p) => p.phrase)
    .filter((p, _, all) => !subject.includes(p) && !all.some((q) => q !== p && q.includes(p) && !subject.includes(q)))
    .slice(0, 8);
  const doText = (x) => `${x.who ? `${x.who}: ` : ''}${x.text}${x.when ? ` (${x.when})` : ''}`;
  const lines = [];
  const block = (head, items) => {
    if (items.length) lines.push(`**${head}**`, ...items.map((x) => `- ${x}`));
  };
  if (sections.length > 1) block('หัวข้อที่คุย', sections.filter((s) => s.points.length).map((s) => `**${s.name}:** ${s.points.slice(0, 3).join(' · ')}`));
  else block('ใจความสำคัญ', points.map((p) => p.text));
  block('ข้อสรุป', dedupe(decisions.map((d) => d.text)).slice(0, 6));
  block('ต้องทำ', actions.slice(0, 10).map(doText));
  block(
    'ยังไม่สรุป',
    dedupe(open.map((o) => o.text))
      .slice(0, 5)
      .map((t) => {
        const note = open.find((o) => o.text === t)?.note;
        return note ? `${t} (${note})` : t;
      }),
  );
  const notSaid = facts.filter((f) => !saidElsewhere(f, sections.length > 1 ? sections.flatMap((x) => x.rows) : points, decisions, actions));
  const shownFacts = sections.length > 1 && notSaid.filter((f) => f.money).length >= 2 ? notSaid.filter((f) => f.money) : notSaid;
  if (shownFacts.length) lines.push(`**ตัวเลขสำคัญ:** ${dedupe(shownFacts.map((f) => f.text)).slice(0, 5).join(' · ')}`);
  if (keywords.length) lines.push(`**คำสำคัญ:** ${keywords.join(' · ')}`);

  const items = actions.slice(0, 10).map((x) => ({
    kind: 'task',
    text: `${x.day ? `${x.day.slice(8)}/${x.day.slice(5, 7)}${x.time ? ` ${x.time}` : ''} ` : ''}${x.text}${x.who ? ` (${x.who})` : ''}`,
  }));
  return { title: subject, named, keywords, points, decisions, actions, open, facts, sections, summary: lines.join('\n'), items, sentences: sents.length };
}

/** The analysis as a mind map: subject in the middle, topics around it, then what to do and what is open. */
export function toMindMap(a, now = Date.now()) {
  let map = newMap(a.title, now);
  const root = rootOf(map).id;
  const add = (parent, text) => {
    const r = addChild(map, parent, text);
    map = r.map;
    return r.id;
  };
  const branch = (name, list, max = 6) => {
    const items = dedupe(list).slice(0, max);
    if (!items.length) return;
    const id = add(root, name);
    for (const x of items) add(id, x);
  };
  const multi = a.sections.length > 1;
  if (multi) {
    for (const s of a.sections) {
      const id = add(root, s.name);
      for (const r of s.rows) add(id, r.agreed ? `✓ ${r.text}` : r.text);
    }
  } else {
    for (const p of dedupe(a.points.map((x) => shorten(x.text, 52))).slice(0, 5)) add(root, p);
    branch('ข้อสรุป', a.decisions.map((d) => `✓ ${d.text}`));
  }
  branch(
    'ต้องทำ',
    a.actions.map((x) => `${x.who ? `${x.who}: ` : ''}${shorten(x.text, 44, { keepStart: true })}${x.when ? ` · ${x.when}` : ''}`),
    8,
  );
  branch('ยังไม่สรุป', a.open.map((o) => o.text));
  if (!multi) branch('ตัวเลขสำคัญ', a.facts.filter((f) => !saidElsewhere(f, a.points, a.decisions, a.actions)).map((f) => f.text), 5);
  return { ...map, source: null, createdAt: now, updatedAt: now };
}
