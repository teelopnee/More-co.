import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AiError, ask, batches, cleanupPrompt, joinCleaned, listModels, pickModel, readCleaned } from '../src/lib/ai.js';

const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

test('OpenRouter: chat completions with the key as a bearer token; the answer is the first choice', async () => {
  let seen = null;
  const fetchImpl = async (url, init) => {
    seen = { url, init, body: JSON.parse(init.body) };
    return reply(200, { choices: [{ message: { role: 'assistant', content: ' สรุปแล้ว ' } }] });
  };
  const text = await ask({ provider: 'openrouter', key: 'sk-or-test', model: 'vendor/model-x', prompt: 'สรุปให้หน่อย', fetchImpl });
  assert.equal(text, 'สรุปแล้ว');
  assert.equal(seen.url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(seen.init.headers.Authorization, 'Bearer sk-or-test');
  assert.deepEqual(seen.body, { model: 'vendor/model-x', messages: [{ role: 'user', content: 'สรุปให้หนอ่ย'.replace('หนอ่ย', 'หน่อย') }] });
  // header values must be plain ASCII (a Thai app name would make fetch throw)
  for (const v of Object.values(seen.init.headers)) assert.match(v, /^[\x20-\x7e]+$/);
  // no model chosen: say so instead of sending
  await assert.rejects(ask({ provider: 'openrouter', key: 'k', prompt: 'x', fetchImpl }), /ยังไม่ได้เลือกรุ่น/);
});

test('Gemini: the Interactions API with the key in its header', async () => {
  let seen = null;
  const fetchImpl = async (url, init) => {
    seen = { url, init, body: JSON.parse(init.body) };
    return reply(200, { steps: [{ type: 'model_output', content: [{ type: 'text', text: 'คำตอบ' }] }] });
  };
  assert.equal(await ask({ provider: 'gemini', key: 'AIza-test', prompt: 'ถาม', fetchImpl }), 'คำตอบ');
  assert.equal(seen.url, 'https://generativelanguage.googleapis.com/v1beta/interactions');
  assert.equal(seen.init.headers['x-goog-api-key'], 'AIza-test');
  assert.deepEqual(seen.body.input, [{ type: 'text', text: 'ถาม' }]);
  assert.ok(seen.body.model.startsWith('gemini-'));
});

test('errors come back as Thai messages', async () => {
  const fail = (status, body = {}) => ask({ provider: 'openrouter', key: 'k', model: 'm', prompt: 'x', fetchImpl: async () => reply(status, body) });
  await assert.rejects(fail(401), (e) => e instanceof AiError && /คีย์ OpenRouter ใช้ไม่ได้/.test(e.message) && e.status === 401);
  await assert.rejects(fail(402), /เครดิต OpenRouter ไม่พอ/);
  await assert.rejects(fail(404, { error: { message: 'No endpoints found for vendor/gone' } }), /ไม่เจอรุ่นนี้.*No endpoints found/);
  await assert.rejects(fail(429), /รอสักครู่/);
  await assert.rejects(fail(200, { error: { code: 502, message: 'provider down' } }), /มีปัญหาชั่วคราว/);
  await assert.rejects(fail(200, { choices: [{ message: { content: '' } }] }), /ไม่ได้ตอบอะไร/);
  await assert.rejects(ask({ provider: 'gemini', key: 'k', prompt: 'x', fetchImpl: async () => { throw new TypeError('network'); } }), /ต่อ Google Gemini ไม่ได้/);
  await assert.rejects(ask({ provider: 'gemini', key: '', prompt: 'x' }), /ยังไม่ได้ใส่คีย์/);
  await assert.rejects(ask({ provider: 'nope', key: 'k', prompt: 'x' }), /ยังไม่ได้เลือกบริการ/);
});

test('OpenRouter models are read on the device, newest first, and a first choice is picked from them', async () => {
  const data = { data: [
    { id: 'google/gemini-9-flash', name: 'Gemini 9 Flash', created: 300 },
    { id: 'anthropic/claude-sonnet-9', name: 'Claude Sonnet 9', created: 200 },
    { id: 'anthropic/claude-sonnet-8', name: 'Claude Sonnet 8', created: 100 },
    { id: 'x/y', created: 400 },
    { name: 'no id' },
  ] };
  const list = await listModels(async () => reply(200, data));
  assert.deepEqual(list.map((m) => m.id), ['x/y', 'google/gemini-9-flash', 'anthropic/claude-sonnet-9', 'anthropic/claude-sonnet-8']);
  assert.equal(pickModel(list), 'anthropic/claude-sonnet-9');
  assert.equal(pickModel(list.filter((m) => !m.id.startsWith('anthropic/'))), 'google/gemini-9-flash');
  assert.equal(pickModel([]), '');
  assert.deepEqual(await listModels(async () => reply(500, {})), []);
  assert.deepEqual(await listModels(async () => { throw new Error('offline'); }), []);
});

const PART = '[0:00] สวัสดี คับ ทุก คน วัน นี้ เรา จะ คุย เรื่อง งบ โค สะ นา\n\n[0:30] เดิม เรา ตั้ง ไว้ ห้า แสน บาท';

test('clean-up prompt: fix, do not summarise, keep the times', () => {
  const p = cleanupPrompt(PART, { title: 'ประชุมทีม' });
  assert.ok(p.startsWith(`<การถอดเสียง>\n${PART}\n</การถอดเสียง>`));
  for (const s of ['ห้ามสรุป', 'ไม่เว้นวรรคระหว่างคำ', 'คงเครื่องหมายเวลา [นาที:วินาที]', 'เรื่อง “ประชุมทีม”']) assert.ok(p.includes(s), s);
  assert.ok(!cleanupPrompt('ข้อความไม่มีเวลา').includes('คงเครื่องหมายเวลา'));
});

test('a cleaned part keeps its times; a summary is not taken for the text', () => {
  const good = readCleaned('```\n[0:00] สวัสดีครับทุกคน วันนี้เราจะคุยเรื่องงบโฆษณา\n\n[0:30] เดิมเราตั้งไว้ 500,000 บาท\n```', PART);
  assert.equal(good.text, 'สวัสดีครับทุกคน วันนี้เราจะคุยเรื่องงบโฆษณา เดิมเราตั้งไว้ 500,000 บาท');
  assert.deepEqual(good.times.map(([at, ms]) => [good.text.slice(at, at + 4), ms]), [['สวัส', 0], ['เดิม', 30_000]]);
  // far shorter: the model summarised; far longer: it wandered off
  assert.equal(readCleaned('คุยเรื่องงบ', PART), null);
  assert.equal(readCleaned(`${PART} ${'เพิ่มเติม '.repeat(40)}`, PART), null);
  assert.equal(readCleaned('', PART), null);
  // the times were dropped or shuffled: the text is still better, but it no longer plays from them
  assert.deepEqual(readCleaned('สวัสดีครับทุกคน วันนี้เราจะคุยเรื่องงบโฆษณา เดิมเราตั้งไว้ 500,000 บาท', PART).times, []);
  assert.deepEqual(readCleaned('[0:30] สวัสดีครับทุกคน วันนี้เราจะคุยเรื่องงบโฆษณา\n[0:00] เดิมเราตั้งไว้ 500,000 บาท', PART).times, []);
  // a part left as it was is read the same way
  assert.equal(readCleaned(PART, PART).times.length, 2);
});

test('long recordings go a few minutes at a time and come back as one text', () => {
  const timed = Array.from({ length: 10 }, (_, i) => `[${i}:00] ${'คำ'.repeat(300)}`).join('\n\n');
  const parts = batches(timed, 2000);
  assert.equal(parts.length, 4);
  assert.ok(parts.every((p) => p.startsWith('[')));
  assert.equal(parts.join('\n\n'), timed);
  // text with no times is cut at spaces
  assert.deepEqual(batches(`${'ก'.repeat(30)} ${'ข'.repeat(30)} ${'ค'.repeat(30)}`, 40).map((p) => p.length), [30, 30, 30]);
  const all = joinCleaned([{ text: 'หนึ่ง สอง', times: [[0, 0], [6, 5000]] }, null, { text: 'สาม', times: [[0, 60_000]] }]);
  assert.deepEqual(all, { text: 'หนึ่ง สอง สาม', times: [[0, 0], [6, 5000], [10, 60_000]] });
});
