import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clock, extFor, geminiText, pickFormat, transcribeParts, TranscribeError } from '../src/lib/voice.js';
import { noteRequest, readNote, noteWebPrompt, NOTE_SCHEMA } from '../src/lib/claude.js';
import { rootOf, childrenOf } from '../src/lib/mindmap.js';

test('formats: Opus on Chrome/Android, AAC on Safari/iPhone', () => {
  assert.equal(pickFormat((t) => t.startsWith('audio/webm')).mime, 'audio/webm;codecs=opus');
  assert.equal(pickFormat((t) => t.startsWith('audio/mp4')).mime, 'audio/mp4;codecs=mp4a.40.2');
  assert.deepEqual(pickFormat(() => false), { mime: '', bits: 64000 });
  assert.equal(extFor('audio/mp4;codecs=mp4a.40.2'), 'm4a');
  assert.equal(extFor('audio/webm;codecs=opus'), 'webm');
  assert.equal(clock(65_000), '1:05');
  assert.equal(clock(3_725_000), '1:02:05');
});

test('transcription: OpenAI and Gemini requests, parts joined in order', async () => {
  const calls = [];
  const fake = (reply) => async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200, json: async () => reply(calls.length) };
  };
  const parts = [new Blob(['a'], { type: 'audio/webm' }), new Blob(['b'], { type: 'audio/webm' })];
  const progress = [];
  const text = await transcribeParts({ provider: 'openai', key: 'sk-x', parts, mime: 'audio/webm;codecs=opus', fetchImpl: fake((n) => ({ text: `ส่วน ${n}` })), onprogress: (d, t) => progress.push(`${d}/${t}`) });
  assert.equal(text, 'ส่วน 1\n\nส่วน 2');
  assert.deepEqual(progress, ['0/2', '1/2', '2/2']);
  assert.equal(calls[0].url, 'https://api.openai.com/v1/audio/transcriptions');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer sk-x');
  const form = calls[0].init.body;
  assert.equal(form.get('model'), 'gpt-transcribe');
  assert.equal(form.get('languages[]'), 'th');
  assert.equal(form.get('file').name, 'paewai-1.webm');

  calls.length = 0;
  const g = await transcribeParts({ provider: 'gemini', key: 'AIza-x', parts: parts.slice(0, 1), mime: 'audio/webm;codecs=opus', fetchImpl: fake(() => ({ status: 'completed', steps: [{ type: 'thought' }, { type: 'model_output', content: [{ type: 'text', text: 'สวัสดีครับ' }] }] })) });
  assert.equal(g, 'สวัสดีครับ');
  const body = JSON.parse(calls[0].init.body);
  assert.equal(calls[0].init.headers['x-goog-api-key'], 'AIza-x');
  assert.equal(body.model, 'gemini-3.8-flash');
  assert.deepEqual([body.input[1].type, body.input[1].mime_type, body.input[1].data], ['audio', 'audio/webm', 'YQ==']);
  assert.equal(geminiText({ output_text: 'x' }), 'x');
  assert.equal(geminiText({ candidates: [{ content: { parts: [{ text: 'y' }] } }] }), 'y');

  const fail = async () => ({ ok: false, status: 401, json: async () => ({ error: { message: 'Incorrect API key' } }) });
  await assert.rejects(transcribeParts({ provider: 'openai', key: 'bad', parts, fetchImpl: fail }), (e) => e instanceof TranscribeError && /คีย์ OpenAI ใช้ไม่ได้/.test(e.message) && e.status === 401);
  await assert.rejects(transcribeParts({ provider: 'openai', key: '', parts }), /ยังไม่ได้ใส่คีย์/);
  const offline = async () => {
    throw new TypeError('Failed to fetch');
  };
  await assert.rejects(transcribeParts({ provider: 'gemini', key: 'k', parts, fetchImpl: offline }), /ตรวจอินเทอร์เน็ต/);
});

test('Claude: summary and mind map from a transcript', () => {
  const r = noteRequest({ text: 'ประชุมเรื่องเปิดตัว', title: 'ประชุม', kind: 'การถอดเสียง' });
  assert.equal(r.model, 'claude-opus-5-5');
  assert.equal(r.output_config.format.schema, NOTE_SCHEMA);
  assert.equal(r.fallbacks, 'default');
  assert.match(r.messages[0].content, /<การถอดเสียง>\nประชุมเรื่องเปิดตัว\n<\/การถอดเสียง>/);
  const msg = {
    stop_reason: 'end_turn',
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          title: 'ประชุมเปิดตัว',
          summary: '- เลื่อนไปธันวาคม',
          nodes: [
            { id: 'r', parent: '', text: 'เปิดตัวสินค้า' },
            { id: 'a', parent: 'r', text: 'กำหนดการ' },
            { id: 'b', parent: 'a', text: 'ธันวาคม' },
            { id: 'c', parent: 'zz', text: 'ลอย' },
          ],
          items: [{ kind: 'task', text: 'พรุ่งนี้ 09:00 ส่งสไลด์' }],
        }),
      },
    ],
  };
  const n = readNote(msg);
  assert.equal(n.title, 'ประชุมเปิดตัว');
  assert.equal(rootOf(n.map).text, 'เปิดตัวสินค้า');
  assert.deepEqual(childrenOf(n.map, rootOf(n.map).id).map((x) => x.text), ['กำหนดการ', 'ลอย']);
  assert.deepEqual(n.items, [{ kind: 'task', text: 'พรุ่งนี้ 09:00 ส่งสไลด์' }]);
  assert.match(readNote({ stop_reason: 'refusal', content: [] }).note, /ไม่สรุป/);
  assert.match(noteWebPrompt('ข้อความ'), /# หัวข้อกลาง/);
});

test('device transcription helpers', async () => {
  const { tail, looksLikeTranscript, PROVIDERS } = await import('../src/lib/voice.js');
  assert.equal(PROVIDERS.device.name, 'ระบบของเครื่อง');
  assert.equal(tail('สั้น ๆ'), 'สั้น ๆ');
  const long = Array.from({ length: 60 }, (_, i) => `คำที่${i}`).join(' ');
  const t = tail(long, 40);
  assert.ok(t.startsWith('…') && t.length <= 41 && long.endsWith(t.slice(1)));
  assert.equal(looksLikeTranscript('ซื้อนม ไข่'), false);
  assert.equal(looksLikeTranscript('ก'.repeat(300)), true);
  const meeting = 'ผู้พูด 1: สวัสดีครับ วันนี้เราจะคุยเรื่องแผนการตลาด\nผู้พูด 2: สวัสดีค่ะ พร้อมแล้วค่ะ\nผู้พูด 1: เริ่มจากงบโฆษณาออนไลน์ก่อนเลย\nผู้พูด 2: ได้ค่ะ เดือนนี้ใช้ไปแล้วครึ่งหนึ่ง';
  assert.ok(meeting.length > 120 && meeting.length < 280);
  assert.equal(looksLikeTranscript(meeting), true, 'several lines of talk');
});

test('text-only recordings survive saving', async () => {
  const S = await import('../src/lib/store.js');
  let s = S.addRec(S.emptyState(), { id: 'x1', title: 'ถอดความจาก Samsung', parts: 0, origin: 'share', transcript: 'ข้อความยาว' });
  s = S.sanitize(JSON.parse(JSON.stringify(s)));
  assert.deepEqual([s.recs[0].parts, s.recs[0].origin, s.recs[0].transcript], [0, 'share', 'ข้อความยาว']);
});

test('live captions remember where each run of words started', async () => {
  const { LiveCaption } = await import('../src/lib/voice.js');
  let now = 0;
  const c = new LiveCaption({ clock: () => now });
  now = 3000;
  c.segStart = c.now(); // the first partial result of a sentence
  now = 6000;
  c.addFinal('สวัสดีครับ');
  now = 20000;
  c.addFinal('เรื่องงบโฆษณา'); // no partial seen: starts where the last one ended
  now = 30000;
  c.partial = 'บูธที่ห้าง';
  assert.equal(c.stop(), 'สวัสดีครับ เรื่องงบโฆษณา บูธที่ห้าง');
  assert.deepEqual(c.times, [[0, 1500], [11, 4500], [25, 18500]]);
});
