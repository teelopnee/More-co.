// "ถาม Claude": what the app tells Claude about the person's day, the ready-made questions, and the
// shape of the answer. Two ways to ask:
//   - in the app, with the person's own API key (Messages API, structured JSON answer whose
//     suggested items can be filed with one tap), via the official SDK in vendor/anthropic.js
//   - in the Claude app or claude.ai (no key; the person copies the answer back and pastes it)

import { addDays, describeWhen, longDate, repeatLabel } from './dates.js';
import { KIND_LABELS } from './sort.js';
import { moneySummary, sortedMemos, taskViews } from './store.js';
import { sanitizeMap } from './mindmap.js';

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

/** For the Claude app: the whole question as one message, answer to be pasted back line by line. */
export function webPrompt(question, context) {
  return `${userMessage(question, context)}

ตอบเป็นภาษาไทย กระชับ ถ้ามีอะไรที่ควรแปะลงแอปแปะไว้ (งาน นัด ของต้องซื้อ โน้ต) ให้ปิดท้ายด้วยรายการทีละบรรทัด ขึ้นต้นด้วยวันเวลาถ้ามี เช่น “พรุ่งนี้ 09:00 โทรหาหมอ” “15/11 14:30 ประชุมทีม” เพื่อให้ฉันคัดลอกไปวางในแอปได้เลย`;
}

/** claude.ai link with the question filled in (shorter questions only: long URLs get cut). */
export function webLink(prompt, max = 7000) {
  const url = `${CLAUDE_WEB}?q=${encodeURIComponent(prompt)}`;
  return url.length <= max ? url : CLAUDE_WEB;
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

/** For the Claude app (no key): asks for a summary and an outline that pastes straight into a mind map. */
export function noteWebPrompt(text, kind = 'บันทึก') {
  return `ช่วยสรุป${kind}นี้เป็นภาษาไทย แล้วทำมายด์แมปเป็นโครงร่าง markdown ในกล่องโค้ด แบบนี้:
# หัวข้อกลาง
- กิ่งหลัก
  - กิ่งย่อย
(กิ่งหลัก 3–7 กิ่ง ข้อความสั้น ๆ) ฉันจะคัดลอกโครงร่างไปวางในแอปแปะไว้ให้เป็นมายด์แมป

<${kind}>
${text}
</${kind}>`;
}
