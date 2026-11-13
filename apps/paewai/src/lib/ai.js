// Optional help from a language model, with the person's own key: Google Gemini or OpenRouter.
// Off unless a key is set (on this device only, lib/voice.js VOICE_KEY). Two jobs:
//   - clean up a recognizer's transcript: misheard words put right from context, written the way
//     Thai is written; nothing summarised or left out, the [m:ss] times kept so the text still plays
//   - summary, mind map and things to do: the same prompt and answer format as the copy-and-paste
//     way (lib/claude.js noteWebPrompt / readPasted), sent for the person instead
// Everything else in the app works without it.

import { geminiText } from './voice.js';

export const AI = {
  gemini: { name: 'Google Gemini', model: 'gemini-3.8-flash', keyUrl: 'https://aistudio.google.com/apikey' },
  openrouter: { name: 'OpenRouter', model: '', keyUrl: 'https://openrouter.ai/keys', modelsUrl: 'https://openrouter.ai/models' },
};
const SITE = 'https://teelopnee.github.io/More-co./paewai/';

export class AiError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.status = status;
  }
}

function explain(status, name, detail = '') {
  const more = detail ? `: ${String(detail).slice(0, 160)}` : '';
  if (status === 401 || status === 403) return `คีย์ ${name} ใช้ไม่ได้ ตรวจแล้วใส่ใหม่`;
  if (status === 402) return `เครดิต ${name} ไม่พอ`;
  if (status === 404) return `ไม่เจอรุ่นนี้ใน ${name} เลือกรุ่นใหม่ในตั้งค่า${more}`;
  if (status === 413) return 'ข้อความยาวเกินที่รุ่นนี้รับได้';
  if (status === 429) return `${name} ขอให้รอสักครู่ (ใช้ถี่หรือโควตาหมด)`;
  if (status >= 500) return `${name} มีปัญหาชั่วคราว ลองใหม่อีกครั้ง`;
  return `${name} ตอบกลับผิดพลาด (${status})${more}`;
}

/** One question, one answer (text). Throws AiError with a Thai message. */
export async function ask({ provider, key, model = '', prompt, fetchImpl = fetch, signal }) {
  const p = AI[provider];
  if (!p) throw new AiError('ยังไม่ได้เลือกบริการ AI');
  if (!key) throw new AiError(`ยังไม่ได้ใส่คีย์ ${p.name}`);
  const use = String(model || p.model).trim();
  if (!use) throw new AiError(`ยังไม่ได้เลือกรุ่นของ ${p.name}`);
  const init =
    provider === 'gemini'
      ? {
          url: 'https://generativelanguage.googleapis.com/v1beta/interactions',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key, 'Api-Revision': '2026-05-20' },
          body: { model: use, input: [{ type: 'text', text: prompt }] },
        }
      : {
          url: 'https://openrouter.ai/api/v1/chat/completions',
          // header values are ASCII only; these two name the app on OpenRouter's side
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}`, 'HTTP-Referer': SITE, 'X-Title': 'Paewai' },
          body: { model: use, messages: [{ role: 'user', content: prompt }] },
        };
  let res;
  try {
    res = await fetchImpl(init.url, { method: 'POST', headers: init.headers, body: JSON.stringify(init.body), signal });
  } catch (err) {
    if (err?.name === 'AbortError') throw new AiError('ยกเลิกแล้ว');
    throw new AiError(`ต่อ ${p.name} ไม่ได้ ตรวจอินเทอร์เน็ตแล้วลองใหม่`);
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new AiError(explain(res.status, p.name, data?.error?.message), res.status);
  // OpenRouter can answer 200 with an error inside (the model's provider failed)
  if (data?.error?.message) throw new AiError(explain(Number(data.error.code) || 500, p.name, data.error.message), Number(data.error.code) || 500);
  let text = '';
  if (provider === 'gemini') {
    if (data?.status === 'failed') throw new AiError('Gemini ทำไม่สำเร็จ ลองใหม่อีกครั้ง');
    text = geminiText(data);
  } else {
    const content = data?.choices?.[0]?.message?.content;
    text = Array.isArray(content) ? content.map((c) => (typeof c === 'string' ? c : c?.text ?? '')).join('') : String(content ?? '');
  }
  text = text.trim();
  if (!text) throw new AiError(`${p.name} ไม่ได้ตอบอะไรกลับมา ลองใหม่อีกครั้ง`);
  return text;
}

// ---- OpenRouter's catalogue (it changes often: read it on the device, never from a list in here) ----

/** → [{ id, name, created }] newest first ([] when it cannot be read). */
export async function listModels(fetchImpl = fetch) {
  try {
    const res = await fetchImpl('https://openrouter.ai/api/v1/models');
    if (!res.ok) return [];
    const data = await res.json();
    const list = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : [];
    return list
      .filter((m) => m && typeof m.id === 'string')
      .map((m) => ({ id: m.id, name: String(m.name ?? m.display_name ?? m.id), created: Number(m.created) || Date.parse(m.created_at ?? '') / 1000 || 0 }))
      .sort((a, b) => b.created - a.created);
  } catch {
    return [];
  }
}

/** A good first choice from the catalogue: a current general model that reads Thai well. */
export function pickModel(list) {
  const newest = (re) => list.find((m) => re.test(m.id))?.id;
  return newest(/^anthropic\/claude-.*sonnet/) ?? newest(/^anthropic\/claude-/) ?? newest(/^google\/gemini-.*flash/) ?? newest(/^google\/gemini-/) ?? list[0]?.id ?? '';
}

// ---- cleaning up a transcript ----

const TIME = /^\s*\[(\d{1,2}(?::\d{2}){1,2})\]\s*/;

/** Timed paragraphs ("[1:05] …", as lib/claude.js timedText makes them) in groups of about `max` characters. */
export function batches(timed, max = 5000) {
  const paras = String(timed ?? '')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    // text with no times is one long paragraph: cut it at pauses
    .flatMap((p) => (p.length <= max * 1.5 ? [p] : p.match(new RegExp(`[\\s\\S]{1,${max}}(?:\\s|$)|\\S+`, 'g')).map((x) => x.trim()).filter(Boolean)));
  const out = [];
  let cur = [];
  let size = 0;
  for (const p of paras) {
    if (cur.length && size + p.length > max) {
      out.push(cur.join('\n\n'));
      cur = [];
      size = 0;
    }
    cur.push(p);
    size += p.length;
  }
  if (cur.length) out.push(cur.join('\n\n'));
  return out;
}

export function cleanupPrompt(part, { title = '', names = '' } = {}) {
  const timed = TIME.test(part);
  return `<การถอดเสียง>
${part}
</การถอดเสียง>

ข้างบนคือข้อความที่ถอดจากเสียงพูดภาษาไทยด้วยระบบอัตโนมัติ${title ? ` (เรื่อง “${title}”)` : ''} มีคำที่ฟังผิด คำซ้ำ และไม่มีเครื่องหมายวรรคตอน ช่วยเกลาให้อ่านง่ายตามนี้
- แก้คำที่ถอดผิดให้เป็นคำที่ผู้พูดน่าจะพูดจริงตามบริบท ถ้าเดาไม่ได้ให้คงคำเดิมไว้${names ? `\n- ชื่อและคำเฉพาะที่น่าจะมี: ${names}` : ''}
- เขียนแบบภาษาไทยปกติ: ไม่เว้นวรรคระหว่างคำ เว้นวรรคระหว่างประโยคหรือวลี ตัวเลขเขียนเป็นเลขอารบิก คำภาษาอังกฤษเขียนเป็นภาษาอังกฤษ
- ห้ามสรุป ห้ามย่อ ห้ามตัดเนื้อหา ห้ามเติมสิ่งที่ไม่ได้พูด ตัดได้เฉพาะคำซ้ำที่เกิดจากการถอดผิดและเสียงอย่าง “เอ่อ” “อืม”${timed ? '\n- คงเครื่องหมายเวลา [นาที:วินาที] ไว้หน้าย่อหน้าเดิมทุกอัน ห้ามเปลี่ยนตัวเลข ห้ามรวมหรือแยกย่อหน้า' : ''}

ตอบเฉพาะข้อความที่เกลาแล้ว ไม่ต้องมีคำนำ คำอธิบาย หรือกล่องโค้ด`;
}

/**
 * The model's answer for one part → { text, times } ([[offset, ms]] from the [m:ss] it kept), or
 * null when the answer is not the same text cleaned up (far shorter or longer: it summarised, or
 * wandered off). The part then stays as it was.
 */
export function readCleaned(reply, part) {
  let body = String(reply ?? '').trim();
  const fence = /^```[^\n]*\n([\s\S]*?)\n```$/.exec(body);
  if (fence) body = fence[1].trim();
  body = body.replace(/^<การถอดเสียง>\s*|\s*<\/การถอดเสียง>$/g, '').trim();
  const plain = (s) => s.replace(/\[\d{1,2}(?::\d{2}){1,2}\]/g, '').replace(/\s+/g, '');
  const was = plain(part).length;
  const now = plain(body).length;
  if (!now || now < was * 0.6 || now > was * 1.5) return null;
  const want = (String(part).match(/^\s*\[\d{1,2}(?::\d{2}){1,2}\]/gm) ?? []).length;
  let text = '';
  const times = [];
  let seen = 0;
  for (const para of body.split(/\n+/).map((p) => p.trim()).filter(Boolean)) {
    const m = TIME.exec(para);
    const words = (m ? para.slice(m[0].length) : para).trim();
    if (!words) continue;
    const at = text ? text.length + 1 : 0;
    if (m) {
      times.push([at, m[1].split(':').reduce((a, x) => a * 60 + Number(x), 0) * 1000]);
      seen++;
    }
    text += (text ? ' ' : '') + words;
  }
  // most of the times must have come back, in order: otherwise the text would play from the wrong places
  const ordered = times.every((t, i) => i === 0 || t[1] >= times[i - 1][1]);
  if (want && (seen < want * 0.7 || !ordered)) return { text, times: [] };
  return { text, times };
}

/** Parts cleaned one after another, joined: { text, times, kept } (kept: parts left as they were). */
export function joinCleaned(parts) {
  let text = '';
  const times = [];
  for (const p of parts) {
    if (!p?.text) continue;
    const at = text ? text.length + 1 : 0;
    for (const [o, ms] of p.times ?? []) if (!times.length || ms >= times.at(-1)[1]) times.push([at + o, ms]);
    text += (text ? ' ' : '') + p.text;
  }
  return { text, times };
}
