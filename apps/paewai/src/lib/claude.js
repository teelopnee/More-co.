// "ถาม Claude": what the app tells Claude about the person's day, the ready-made questions, and the
// shape of the answer. Two ways to ask:
//   - in the app, with the person's own API key (Messages API, structured JSON answer whose
//     suggested items can be filed with one tap), via the official SDK in vendor/anthropic.js
//   - in the Claude app or claude.ai (no key, the usual way): the app writes the whole prompt, the
//     person pastes it into Claude, copies the answer and pastes it back; readPasted() reads it

import { addDays, describeWhen, longDate, repeatLabel } from './dates.js';
import { KIND_LABELS } from './sort.js';
import { moneySummary, sortedMemos, taskViews } from './store.js';
import { childrenOf, rootOf, sanitizeMap } from './mindmap.js';
import { clock } from './voice.js';

export const CLAUDE_KEY = 'paewai:claude';
export const MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'];
export const DEFAULT_MODEL = 'claude-opus-5-5';
export const CLAUDE_WEB = 'https://claude.ai/new';

const clip = (s, n) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};
const baht = (n) => `฿${Math.round(n).toLocaleString('th-TH')}`;

/** A compact Thai summary of everything in the app, for Claude to work with. */
export function contextFor(state, today, now = Date.now(), { limit = 6000 } = {}) {
  const v = taskViews(state, today, 6);
  const when = (t) => (t.day ? describeWhen(t.day, t.time, today) : '');
  const task = (t) => `- ${t.done ? '[เสร็จ] ' : ''}${t.text}${t.time && t.day === today ? ` (${t.time})` : ''}${t.repeat ? ` · ${repeatLabel(t.repeat)}` : ''}`;
  const time = new Date(now);
  const lines = [`วันนี้คือ${longDate(today)} (${today}) เวลา ${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')} น. (เวลาไทย)`];
  const section = (title, list) => {
    if (!list.length) return;
    lines.push('', `## ${title}`, ...list);
  };
  section('งานวันนี้', v.today.map(task));
  if (v.overdue) lines.push(`(มี ${v.overdue} เรื่องเลยกำหนดจากวันก่อน)`);
  section('กล่องรับ (ยังไม่มีวัน)', v.inbox.filter((t) => !t.done).map(task));
  section(
    'ข้างหน้า',
    [...v.ahead.flatMap((g) => g.tasks), ...v.later].filter((t) => !t.done).slice(0, 40).map((t) => `- ${when(t)}: ${t.text}${t.repeat ? ` · ${repeatLabel(t.repeat)}` : ''}`),
  );
  const since = addDays(today, -6);
  const done = state.tasks.filter((t) => t.done && t.doneAt && new Date(t.doneAt) >= new Date(`${since}T00:00`)).slice(-20);
  section(`เสร็จแล้วใน 7 วัน (${done.length})`, done.map((t) => `- ${t.text}`));
  const open = state.shop.filter((i) => !i.done);
  if (open.length) section('ของต้องซื้อ', [open.map((i) => i.text).join(', ')]);
  if (state.money.length) {
    const m = moneySummary(state, today);
    const budget = state.settings?.budget;
    section('รายจ่าย', [
      `วันนี้ ${baht(m.today)} · 7 วัน ${baht(m.weekTotal)} · เดือนนี้ ${baht(m.month)}${budget ? ` จากงบ ${baht(budget)}` : ''}`,
      ...m.byCat.slice(0, 6).map((c) => `- ${c.cat} ${baht(c.total)} (30 วัน)`),
      ...m.days.slice(0, 3).flatMap((d) => d.items.slice(0, 6).map((e) => `- ${d.day}: ${e.text} ${baht(e.amount)}`)),
    ]);
  }
  section('โน้ตย่อ', sortedMemos(state).slice(0, 12).map((m) => `- ${m.pinned ? '📌 ' : ''}${clip(m.text, 160)}`));
  const days = Object.keys(state.notes).filter((d) => d >= since && d <= today).sort().reverse();
  section('บันทึกประจำวัน (7 วัน)', days.map((d) => `- ${d}: ${clip(state.notes[d], 500)}`));
  let text = lines.join('\n');
  if (text.length > limit) text = `${text.slice(0, limit - 1)}…`;
  return text;
}

/** Ready-made questions. */
export const PRESETS = {
  plan: 'ช่วยจัดตารางวันนี้ให้หน่อย เรียงว่าควรทำอะไรก่อนหลัง ใส่ช่วงเวลาที่เหมาะ บอกสั้น ๆ ว่าทำไม และถ้ามีอะไรควรเลื่อนไปวันอื่นก็บอกด้วย',
  week: 'สรุปสัปดาห์นี้ให้หน่อย ทำอะไรไปแล้ว อะไรยังค้าง ใช้เงินไปกับอะไร แล้วแนะนำ 3 อย่างที่ควรทำสัปดาห์หน้า',
  money: 'ดูรายจ่ายช่วงนี้ให้หน่อย ใช้ไปกับอะไรมากที่สุด มีอะไรน่าลดไหม และถ้าตั้งงบไว้ จะพอถึงสิ้นเดือนไหม',
  shop: 'จากของต้องซื้อ งาน และโน้ตที่มี มีของอะไรที่น่าจะลืมซื้อไหม',
};

export const breakdownPrompt = (task, today) =>
  `ช่วยแตกงาน “${task.text}” เป็นขั้นตอนย่อยที่ลงมือทำได้จริง ขั้นละไม่เกิน 30 นาที${task.day ? ` และต้องเสร็จภายใน${describeWhen(task.day, task.time, today)}` : ''} ใส่วันเวลาให้แต่ละขั้นถ้าเหมาะ`;

export const SYSTEM = `คุณคือผู้ช่วยในแอป “แปะไว้” แอปที่ผู้ใช้คนไทยแปะทุกเรื่องที่ค้างในหัว: งาน เตือนตามเวลา โน้ต ของต้องซื้อ และรายจ่าย
ใช้ข้อมูลของผู้ใช้ที่แนบมา (ถ้ามี) ตอบเป็นภาษาไทย กระชับ เป็นกันเอง ตรงประเด็น ไม่ต้องทวนคำถาม

ตอบเป็น JSON ตาม schema:
- reply: คำตอบสำหรับอ่าน ใช้ย่อหน้าสั้น ๆ และรายการ “- ” ได้ ไม่ต้องใส่หัวข้อใหญ่
- items: สิ่งที่ควรแปะลงแอปจากคำตอบนี้ (งานย่อย นัด ของที่ต้องซื้อ โน้ตที่ควรเก็บ) ไม่เกิน 12 อย่าง ถ้าไม่มีให้เป็น []
  - kind: task (สิ่งที่ต้องทำ/เตือน) · note (ข้อมูลหรือไอเดียที่ควรเก็บ) · shop (ของที่ต้องซื้อ หนึ่งอย่างต่อหนึ่งรายการ) · money (รายจ่ายที่จ่ายไปแล้ว ต้องมีจำนวนเงิน)
  - text: เขียนแบบที่คนพิมพ์ในแอป สั้น ๆ ขึ้นต้นด้วยวันและเวลาถ้ามี เช่น “พรุ่งนี้ 09:00 โทรหาหมอ” “15/11 14:30 ประชุมทีม” “ศุกร์นี้ ส่งรายงาน” “ทุกวัน 20:00 กินยา” “ข้าวมันไก่ 50”
    วันที่ใช้ วว/ดด (วันก่อนเดือน) เวลาใช้ ชช:นน แบบ 24 ชั่วโมง ไม่ใส่ปี
- อย่าใส่สิ่งที่มีอยู่แล้วในแอปซ้ำลงใน items`;

/** JSON schema for the structured answer (output_config.format). */
export const ANSWER_SCHEMA = {
  type: 'object',
  properties: {
    reply: { type: 'string' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['task', 'note', 'shop', 'money'] },
          text: { type: 'string' },
        },
        required: ['kind', 'text'],
        additionalProperties: false,
      },
    },
  },
  required: ['reply', 'items'],
  additionalProperties: false,
};

/** The user turn: the question, then the person's data when they allow it. */
export function userMessage(question, context) {
  return context ? `${question}\n\n<ข้อมูลในแปะไว้>\n${context}\n</ข้อมูลในแปะไว้>` : question;
}

/** Messages API request (beta namespace for the server-side refusal fallback). */
export function request({ model = DEFAULT_MODEL, question, context }) {
  return {
    model: MODELS.includes(model) ? model : DEFAULT_MODEL,
    max_tokens: 16000,
    system: SYSTEM,
    messages: [{ role: 'user', content: userMessage(question, context) }],
    // Light everyday questions: answer quickly.
    output_config: { effort: 'low', format: { type: 'json_schema', schema: ANSWER_SCHEMA } },
    // If a request is declined for policy reasons, let the API retry on its recommended fallback.
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
  };
}

/** Reads the final message: { reply, items, note } (note explains a refusal or a cut-off answer). */
export function readAnswer(message) {
  if (message?.stop_reason === 'refusal') {
    return { reply: '', items: [], note: 'Claude ไม่ตอบคำถามนี้ ลองถามใหม่ด้วยคำอื่น' };
  }
  const text = (message?.content ?? [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = null;
  }
  const cut = message?.stop_reason === 'max_tokens' ? 'คำตอบยาวเกินไปเลยถูกตัด' : '';
  if (!data || typeof data.reply !== 'string') return { reply: text.trim(), items: [], note: cut };
  const items = (Array.isArray(data.items) ? data.items : [])
    .filter((i) => i && KIND_LABELS[i.kind] && typeof i.text === 'string' && i.text.trim())
    .slice(0, 12)
    .map((i) => ({ kind: i.kind, text: i.text.trim().slice(0, 300) }));
  return { reply: data.reply.trim(), items, note: cut };
}

// ---------------------------------------------------------------------------
// A recording's transcript, a note or a journal day → title, summary, mind map, things to do

export const NOTE_SYSTEM = `คุณช่วยสรุปบันทึกและการถอดเสียงของผู้ใช้คนไทยในแอป “แปะไว้” ให้อ่านง่ายและนำไปใช้ต่อได้ ตอบเป็นภาษาไทย
ตอบเป็น JSON ตาม schema:
- title: ชื่อเรื่องสั้น ๆ ไม่เกิน 60 ตัวอักษร
- summary: สรุปใจความสำคัญ 3–8 ข้อ แต่ละข้อขึ้นต้นด้วย “- ” ตามด้วยประเด็นที่ตกลงกันหรือสิ่งที่ต้องจำ ถ้าเป็นการประชุมให้บอกข้อสรุปและใครรับผิดชอบอะไร
- nodes: มายด์แมปแบบรายการโหนด { id, parent, text } โหนดแรกคือหัวข้อกลาง (parent เป็น "") กิ่งหลัก 3–7 กิ่ง ลึกไม่เกิน 3 ชั้น
  ข้อความแต่ละโหนดสั้น กระชับ (ไม่เกิน 8 คำ) id เป็นตัวอักษรสั้น ๆ ไม่ซ้ำกัน และ parent ต้องเป็น id ที่มีอยู่
- items: สิ่งที่ต้องทำหรือนัดหมายที่พูดถึงในบันทึก (ไม่เกิน 10) kind เป็น task/note/shop/money
  text เขียนแบบที่คนพิมพ์ในแอป ขึ้นต้นด้วยวันเวลาถ้ามี เช่น “พรุ่งนี้ 09:00 ส่งสไลด์” “15/11 ประชุมทีม” ไม่มีก็ให้เป็น []
ใช้เฉพาะข้อมูลในบันทึก อย่าเติมเนื้อหาที่ไม่มี`;

const NODE = {
  type: 'object',
  properties: { id: { type: 'string' }, parent: { type: 'string' }, text: { type: 'string' } },
  required: ['id', 'parent', 'text'],
  additionalProperties: false,
};

export const NOTE_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    summary: { type: 'string' },
    nodes: { type: 'array', items: NODE },
    items: ANSWER_SCHEMA.properties.items,
  },
  required: ['title', 'summary', 'nodes', 'items'],
  additionalProperties: false,
};

export function noteRequest({ model = DEFAULT_MODEL, kind = 'บันทึก', title = '', text, today = '' }) {
  return {
    model: MODELS.includes(model) ? model : DEFAULT_MODEL,
    max_tokens: 16000,
    system: NOTE_SYSTEM,
    messages: [
      {
        role: 'user',
        content: `${today ? `วันนี้คือ ${today}\n` : ''}ช่วยสรุปและทำมายด์แมปจาก${kind}นี้${title ? ` (“${title}”)` : ''}\n\n<${kind}>\n${text}\n</${kind}>`,
      },
    ],
    // Summaries and mind maps of long recordings are worth a little more thought.
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: NOTE_SCHEMA } },
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
  };
}

/** → { title, summary, map, items, note } (map is null when Claude gave none). */
export function readNote(message, now = Date.now()) {
  if (message?.stop_reason === 'refusal') return { title: '', summary: '', map: null, items: [], note: 'Claude ไม่สรุปบันทึกนี้' };
  const text = (message?.content ?? []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = null;
  }
  const cut = message?.stop_reason === 'max_tokens' ? 'คำตอบยาวเกินไปเลยถูกตัด ลองอีกครั้ง' : '';
  if (!data) return { title: '', summary: text.trim(), map: null, items: [], note: cut || 'อ่านคำตอบไม่ได้' };
  const nodes = (Array.isArray(data.nodes) ? data.nodes : []).map((n) => ({ id: String(n.id ?? ''), parent: n.parent ? String(n.parent) : null, text: String(n.text ?? '') }));
  const map = nodes.length ? sanitizeMap({ nodes, createdAt: now, updatedAt: now }) : null;
  const items = readAnswer({ content: [{ type: 'text', text: JSON.stringify({ reply: '', items: data.items ?? [] }) }] }).items;
  return { title: String(data.title ?? '').trim().slice(0, 120), summary: String(data.summary ?? '').trim(), map, items, note: cut };
}


// ---------------------------------------------------------------------------
// Copy and paste (no key): the app writes the whole prompt for claude.ai or the Claude app, the
// person sends it, copies Claude's answer (the copy button under it) and pastes it back here.
// Every prompt asks for an answer the app can read back: things to file go in a ```แปะไว้ block,
// one per line as "งาน: …" / "โน้ต: …" / "ซื้อ: …" / "จ่าย: …"; summaries come under fixed headings.

/** Fixed dates, not "tomorrow": the answer may be pasted back on another day. */
const ITEM_RULES = (dates = 'วันที่เขียนเป็น วว/ดด') => `\`\`\`แปะไว้
งาน: 10/11 09:00 โทรหาหมอ
งาน: ทุกวัน 20:00 กินยา
ซื้อ: นม
โน้ต: รหัสห้องประชุม 1234
จ่าย: ข้าวมันไก่ 50
\`\`\`
- บรรทัดละเรื่อง ขึ้นต้นด้วยประเภท: งาน (สิ่งที่ต้องทำหรือนัด) · โน้ต (ข้อมูลที่ควรเก็บ) · ซื้อ (ของหนึ่งอย่างต่อบรรทัด) · จ่าย (เงินที่จ่ายไปแล้ว ต้องมีจำนวนเงิน)
- เขียนสั้น ๆ แบบที่คนพิมพ์จดเอง วันเวลาไว้หน้าข้อความ ${dates} ไม่ใส่ปี และไม่ใช้คำอย่าง “พรุ่งนี้” หรือ “ศุกร์นี้” เพราะฉันอาจวางคืนในวันอื่น
- เวลาเป็น ชช:นน แบบ 24 ชั่วโมง งานที่ทำซ้ำเขียนว่า “ทุกวัน” “ทุกจันทร์” “ทุกวันที่ 5”`;

/** The question with the person's data, and how to answer so the answer pastes back into the app. */
export function webPrompt(question, context = '', { today = '' } = {}) {
  const data = context ? `<ข้อมูลในแปะไว้>\n${context}\n</ข้อมูลในแปะไว้>\n\n` : today ? `วันนี้คือ${today}\n\n` : '';
  return `${data}<คำขอ>
${String(question).trim()}
</คำขอ>

ฉันใช้แอปจดงานชื่อ “แปะไว้”${context ? ' ข้อมูลข้างบนคือสิ่งที่อยู่ในแอปตอนนี้' : ''} ช่วยตอบคำขอเป็นภาษาไทย กระชับ เป็นกันเอง ตรงประเด็น ไม่ต้องทวนคำถาม

ถ้าในคำตอบมีสิ่งที่ควรจดลงแอป (งานย่อย นัด ของที่ต้องซื้อ ข้อมูลที่ควรเก็บ รายจ่าย) ให้ปิดท้ายคำตอบด้วยกล่องโค้ดชื่อ แปะไว้ ตามแบบนี้ ไม่เกิน 15 บรรทัด และไม่ใส่สิ่งที่มีในแอปอยู่แล้ว ถ้าไม่มีอะไรต้องจดก็ไม่ต้องมีกล่องนี้ ฉันจะคัดลอกทั้งคำตอบไปวางในแอป แล้วแอปจะจดตามกล่องนี้ให้เอง
${ITEM_RULES()}`;
}

/**
 * A transcript in paragraphs that start with the time they were said ("[12:30] …"), from the
 * recording's word times ([char offset, ms]); the plain text when there are none.
 */
export function timedText(text, times, { gap = 60_000, max = 1200 } = {}) {
  const t = String(text ?? '');
  const list = (times ?? []).filter((x) => Array.isArray(x) && x[0] >= 0 && x[0] < t.length && Number.isFinite(x[1]));
  if (!list.length) return t.trim();
  const out = [];
  let para = null;
  list.forEach(([at, ms], i) => {
    const piece = t.slice(i ? at : 0, list[i + 1]?.[0] ?? t.length).trim();
    if (!piece) return;
    if (!para || ms - para.ms >= gap || para.text.length > max) {
      if (para) out.push(`[${clock(para.ms)}] ${para.text}`);
      para = { ms: i ? ms : Math.min(ms, list[0][1]), text: piece };
    } else para.text += ` ${piece}`;
  });
  if (para) out.push(`[${clock(para.ms)}] ${para.text}`);
  return out.join('\n\n');
}

/**
 * A recording's transcript, a note or a journal day → title, summary, mind map, things to do,
 * under headings readPasted() knows. `when`: when it was recorded (dates in it count from then);
 * `timed`: the text carries [m:ss] times, kept in the summary and on the branches so they can play.
 */
export function noteWebPrompt(text, kind = 'บันทึก', { title = '', when = '', timed = false, pins = [] } = {}) {
  const clean = String(title ?? '').replace(/["<>]/g, '').trim();
  return `<${kind}${clean ? ` ชื่อ="${clean}"` : ''}>
${String(text ?? '').trim()}
</${kind}>
${pins.length ? `\nช่วงที่ฉันปักหมุดไว้ว่าสำคัญ:\n${pins.map((l) => `- ${l}`).join('\n')}\n` : ''}
ข้างบนคือ${kind}ของฉัน${when ? ` (อัดเมื่อ${when})` : ''} ช่วยสรุปเป็นภาษาไทยให้อ่านง่ายและนำไปใช้ต่อได้
- ใช้เฉพาะข้อมูลใน${kind} อย่าเติมสิ่งที่ไม่มี ถ้าคำไหนถอดเสียงผิดจนเดาไม่ได้ให้ข้ามไป${timed ? `
- ในข้อความมีเวลา [นาที:วินาที] กำกับเป็นช่วง ๆ ให้ใส่เวลาของช่วงที่พูดเรื่องนั้นไว้ท้ายข้อสรุปและท้ายกิ่งหลักของมายด์แมป เช่น “เลื่อนส่งงานเป็นวันศุกร์ [12:30]”` : ''}

ตอบตามหัวข้อด้านล่างนี้ตรง ๆ ไม่ต้องมีคำนำหรือคำลงท้าย เพราะฉันจะคัดลอกทั้งคำตอบไปวางในแอปแปะไว้ แล้วแอปจะอ่านหัวข้อเหล่านี้เอง

## ชื่อเรื่อง
ชื่อสั้น ๆ ไม่เกิน 60 ตัวอักษร

## สรุป
3–8 ข้อ ขึ้นต้นด้วย “- ” บอกประเด็นสำคัญ ข้อสรุป และสิ่งที่ต้องจำ ถ้าเป็นการประชุมให้บอกว่าใครรับผิดชอบอะไร เน้นคำสำคัญด้วย **ตัวหนา** ได้

## มายด์แมป
โครงร่างในกล่องโค้ด แบบนี้
\`\`\`
# หัวข้อกลาง
- กิ่งหลัก
  - กิ่งย่อย
\`\`\`
กิ่งหลัก 3–7 กิ่ง ลึกไม่เกิน 3 ชั้น แต่ละกิ่งเป็นคำสำคัญสั้น ๆ ไม่เกิน 8 คำ ไม่ใช่ประโยคยาว

## สิ่งที่ต้องทำ
สิ่งที่ต้องทำ นัด หรือของที่ต้องซื้อที่พูดถึงใน${kind} ในกล่องโค้ดชื่อ แปะไว้ แบบนี้ ถ้าไม่มีให้เขียนว่า ไม่มี
${ITEM_RULES(`วันที่ให้นับจากวันที่${when ? 'อัด' : 'เขียน'}แล้วเขียนเป็น วว/ดด`)}`;
}

/** A mind map as an outline, each branch said in a recording keeping its time ("… [12:30]"). */
export function mapOutline(map) {
  const root = rootOf(map);
  const lines = [`# ${root.text}`];
  const walk = (id, depth) => {
    for (const c of childrenOf(map, id)) {
      lines.push(`${'  '.repeat(depth)}- ${c.text}${Number.isFinite(c.at) ? ` [${clock(c.at)}]` : ''}`);
      walk(c.id, depth + 1);
    }
  };
  walk(root.id, 0);
  return lines.join('\n');
}

/** Asks Claude to grow a mind map; the answer is one outline. */
export function mapWebPrompt(outline) {
  return `<มายด์แมป>
${String(outline ?? '').trim()}
</มายด์แมป>

ข้างบนคือมายด์แมปของฉันในรูปโครงร่าง (# หัวข้อกลาง, - กิ่ง, เยื้อง 2 ช่องต่อชั้น) ช่วยขยายความให้ครบและเป็นระเบียบขึ้น เป็นภาษาไทย
- เก็บกิ่งเดิมไว้ทั้งหมด ปรับคำให้สั้นและชัดได้ เติมกิ่งย่อยที่ยังขาด เช่น เหตุผล ตัวอย่าง ขั้นตอน ข้อควรระวัง
- รวมกิ่งที่ซ้ำกัน กิ่งหนึ่งมีกิ่งย่อยไม่เกิน 7 กิ่ง ลึกไม่เกิน 4 ชั้น
- แต่ละกิ่งเป็นคำสำคัญสั้น ๆ ไม่เกิน 8 คำ
- กิ่งที่มีเวลา [นาที:วินาที] ต่อท้าย ให้คงเวลานั้นไว้ที่กิ่งเดิม

ตอบเป็นโครงร่างรูปแบบเดิมในกล่องโค้ดเดียว ไม่ต้องอธิบาย ฉันจะคัดลอกไปวางในแอปให้เป็นมายด์แมป`;
}

// ---- reading what is pasted back -----------------------------------------------------------

const KIND_WORDS = {
  task: ['งาน', 'นัด', 'เตือน', 'ทำ', 'todo', 'to-do', 'task'],
  note: ['โน้ต', 'โน๊ต', 'จด', 'บันทึก', 'ไอเดีย', 'note', 'idea'],
  shop: ['ของต้องซื้อ', 'ซื้อ', 'shop', 'buy'],
  money: ['รายจ่าย', 'ค่าใช้จ่าย', 'จ่าย', 'money', 'expense', 'spent'],
};
const KIND_OF = new Map(Object.entries(KIND_WORDS).flatMap(([k, words]) => words.map((w) => [w, k])));
const ITEM_LINE = new RegExp(`^(${[...KIND_OF.keys()].join('|')})\\s*[:：]\\s*(.+)$`, 'iu');
const NOTHING = /^[(（]?\s*(?:ไม่มี|ไม่มีสิ่งที่ต้องทำ|none|n\/?a|-)\s*[)）]?\.?$/iu;

const SECTIONS = [
  ['title', /^(?:ชื่อเรื่อง|ชื่อ|หัวเรื่อง|title)$/iu],
  ['summary', /^(?:สรุป|สรุปใจความ(?:สำคัญ)?|ใจความสำคัญ|ประเด็นสำคัญ|summary)$/iu],
  ['map', /^(?:มาย(?:ด์)?แม[็]?[ปพ]|mind ?map|โครงร่าง(?:มายด์แมป)?|แผนผังความคิด|outline)$/iu],
  ['items', /^(?:สิ่งที่ต้องทำ|งานที่ต้องทำ|ต้องทำ|แปะไว้|รายการแปะไว้|to-?dos?|action items?|tasks?)$/iu],
];

/** "## สรุป", "**สรุป**", "สรุป:" or a bare "สรุป" line → 'summary'. */
function sectionOf(line) {
  const name = line
    .replace(/^\s*#{1,6}\s*/, '')
    .replace(/\*\*|__/g, '')
    .replace(/^[^\p{L}\p{N}]+/u, '')
    .replace(/^\d{1,2}[.)]\s*/, '')
    .replace(/[\s:：]+$/u, '')
    .trim();
  if (!name || name.length > 30) return null;
  return SECTIONS.find(([, re]) => re.test(name))?.[0] ?? null;
}

/** One pasted line → { kind, text } (kind null: let the app sort it) or null. */
function itemOf(raw, { loose = false } = {}) {
  const line = raw
    .trim()
    .replace(/^(?:[-*+•▪◦☐☑✓✔]\s*|\d{1,3}[.)]\s+)+/u, '')
    .replace(/^\[[ xX✓]?\]\s*/u, '')
    .replace(/\*\*|`/g, '')
    .trim();
  if (!line || NOTHING.test(line)) return null;
  const m = ITEM_LINE.exec(line);
  if (m) return m[2].trim() ? { kind: KIND_OF.get(m[1].toLowerCase()) ?? KIND_OF.get(m[1]), text: m[2].trim().slice(0, 300) } : null;
  return loose && !/[:：]$/.test(line) ? { kind: null, text: line.slice(0, 300) } : null;
}

const FENCE = /^\s*(`{3,}|~{3,})\s*([^`\s]*)[^`]*$/;

/**
 * Reads an answer pasted back from Claude, however it was copied (markdown from the copy button,
 * the rendered text, or just one code block): { title, summary, outline, items, reply }.
 * - items: from the ```แปะไว้ block (or "งาน: …" lines), [{ kind, text }]
 * - outline: the mind map's code block (or the "มายด์แมป" section)
 * - reply: the answer without the things to file, for reading
 */
export function readPasted(input) {
  const lines = String(input ?? '').replace(/\r\n?/g, '\n').split('\n');
  const prose = []; // { section, line, at }
  const fences = []; // { section, lang, lines, at }
  let section = 'intro';
  let title = '';
  let open = null;
  for (const line of lines) {
    if (open) {
      const close = /^\s*(`{3,}|~{3,})\s*$/.exec(line);
      if (close && close[1][0] === open.mark[0] && close[1].length >= open.mark.length) open = null;
      else open.lines.push(line);
      continue;
    }
    const fence = FENCE.exec(line);
    if (fence) {
      open = { mark: fence[1], section, lang: fence[2].toLowerCase(), lines: [], at: prose.length };
      fences.push(open);
      continue;
    }
    const inline = /^\s*(?:#{1,6}\s*)?(?:\*\*)?\s*(?:ชื่อเรื่อง|title)\s*(?:\*\*)?\s*[:：]\s*(?:\*\*)?(.+?)(?:\*\*)?\s*$/iu.exec(line);
    if (inline && !title) {
      title = inline[1];
      section = 'after-title';
      continue;
    }
    const s = sectionOf(line);
    if (s) {
      section = s;
      continue;
    }
    prose.push({ section, line });
  }

  // Things to file: the แปะไว้ block, the block under "สิ่งที่ต้องทำ", or a block of "งาน: …" lines.
  const prefixed = (ls) => {
    const full = ls.filter((l) => l.trim());
    return full.length > 0 && full.filter((l) => itemOf(l)).length / full.length >= 0.6;
  };
  const itemFences = fences.filter((f) => /แปะไว้|paewai/.test(f.lang) || f.section === 'items' || prefixed(f.lines));
  let items = [];
  const itemLines = new Set();
  if (itemFences.length) items = itemFences.flatMap((f) => f.lines.map((l) => itemOf(l, { loose: true })));
  else
    prose.forEach((p, i) => {
      const it = itemOf(p.line, { loose: p.section === 'items' });
      if (it && (p.section === 'items' || it.kind)) {
        items.push(it);
        itemLines.add(i);
      }
    });
  const seen = new Set();
  items = items.filter((it) => it && !seen.has(it.text) && seen.add(it.text)).slice(0, 30);

  // The mind map: the block under "มายด์แมป", else a block that looks like an outline.
  const looksOutline = (ls) => {
    const full = ls.filter((l) => l.trim());
    return full.length >= 2 && (/^\s*#\s/.test(full[0]) || full.filter((l) => /^\s*(?:[-*+•]|\d{1,3}[.)])\s/.test(l)).length >= 2);
  };
  const rest = fences.filter((f) => !itemFences.includes(f));
  const mapFence = rest.find((f) => f.section === 'map') ?? rest.find((f) => looksOutline(f.lines));
  let outline = mapFence ? mapFence.lines.join('\n').trim() : '';
  if (!outline) {
    const mapProse = prose.filter((p) => p.section === 'map').map((p) => p.line);
    if (looksOutline(mapProse)) outline = mapProse.join('\n').trim();
  }
  // just the outline (copied from the code block itself)
  const bare = lines.filter((l) => l.trim());
  if (!outline && !fences.length && bare.length >= 2 && /^\s*#\s/.test(bare[0]) && looksOutline(bare)) outline = bare.join('\n');

  const text = (sec) => prose.filter((p) => p.section === sec).map((p) => p.line).join('\n').trim();
  if (!title) title = text('title').split('\n')[0] ?? '';
  title = title.replace(/\*\*|__/g, '').trim().replace(/^[“"'「『]+|[”"'」』]+$/gu, '').trim().slice(0, 120);
  const summary = text('summary');

  // For reading: everything but the things to file (and the headings around them).
  const out = [];
  let last = null;
  const shown = rest.filter((f) => f !== mapFence || !summary);
  const blocks = (at) => shown.filter((f) => f.at === at).forEach((f) => out.push('', ...f.lines, ''));
  prose.forEach((p, i) => {
    blocks(i);
    if (itemLines.has(i) || p.section === 'items' || p.section === 'title') return;
    if (p.section !== last && SECTIONS.some(([k]) => k === p.section) && p.line.trim()) out.push(`**${SECTION_NAMES[p.section]}**`);
    last = p.section;
    out.push(p.line);
  });
  blocks(prose.length);
  const reply = out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return { title, summary, outline, items, reply };
}

const SECTION_NAMES = { summary: 'สรุป', map: 'มายด์แมป', items: 'สิ่งที่ต้องทำ', title: 'ชื่อเรื่อง' };

/** Is this pasted text an answer from Claude (rather than a plain list to file line by line)? */
export function isAnswer(text) {
  const t = String(text ?? '');
  return /^\s*(`{3,}|~{3,})\s*(?:แปะไว้|paewai)\b/imu.test(t) || (/^\s*(`{3,}|~{3,})/m.test(t) && t.split('\n').some((l) => sectionOf(l)));
}

/** Branches labelled "… [12:30]" (as Claude was asked to keep them) play from that time again. */
export function timesFromLabels(map) {
  const TIME = /\s*[[(]\s*(\d{1,2}(?::\d{2}){1,2})\s*[\])]\s*$/;
  let changed = false;
  const nodes = map.nodes.map((n) => {
    const m = TIME.exec(n.text);
    if (!m || !n.text.slice(0, m.index).trim()) return n;
    changed = true;
    const at = m[1].split(':').reduce((a, x) => a * 60 + Number(x), 0) * 1000;
    return { ...n, text: n.text.slice(0, m.index).trim(), at };
  });
  return changed ? { ...map, nodes } : map;
}
