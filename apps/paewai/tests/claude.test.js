import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/lib/store.js';
import * as Mm from '../src/lib/mindmap.js';
import { classify } from '../src/lib/sort.js';
import { ANSWER_SCHEMA, contextFor, isAnswer, mapOutline, mapWebPrompt, noteWebPrompt, readAnswer, readPasted, request, timedText, timesFromLabels, webPrompt } from '../src/lib/claude.js';

const NOW = new Date(2026, 10, 8, 10, 0).getTime();
const TODAY = '2026-11-08';

function sample() {
  let s = S.emptyState();
  s = S.addTask(s, { text: 'ส่งรายงาน', day: TODAY, time: '14:00' }, NOW);
  s = S.addTask(s, { text: 'โทรหาช่างแอร์' }, NOW + 1);
  s = S.addTask(s, { text: 'กินยา', day: '2026-11-09', time: '20:00', repeat: 'daily' }, NOW + 2);
  s = S.addShop(s, ['นม', 'ไข่'], NOW + 3);
  s = S.addMoney(s, { text: 'ข้าวมันไก่', amount: 50, cat: 'อาหาร' }, NOW + 4);
  s = S.addMemo(s, 'รหัส wifi abc', NOW + 5);
  s = S.setNote(s, TODAY, 'ประชุมเลื่อนไปพฤหัส');
  return s;
}

test('context: a short Thai summary of the day', () => {
  const c = contextFor(sample(), TODAY, NOW);
  for (const part of ['2026-11-08', '10:00', 'ส่งรายงาน (14:00)', 'โทรหาช่างแอร์', 'กินยา', 'ทุกวัน', 'นม, ไข่', '฿50', 'รหัส wifi abc', 'ประชุมเลื่อนไปพฤหัส']) {
    assert.ok(c.includes(part), part);
  }
  assert.ok(contextFor(sample(), TODAY, NOW, { limit: 80 }).length <= 80);
});

test('request: Opus 5.5 by default, structured answer, refusal fallback', () => {
  const r = request({ question: 'จัดตารางให้หน่อย', context: 'ctx' });
  assert.equal(r.model, 'claude-opus-5-5');
  assert.equal(r.output_config.format.type, 'json_schema');
  assert.equal(r.output_config.format.schema, ANSWER_SCHEMA);
  assert.deepEqual([r.fallbacks, r.betas], ['default', ['server-side-fallback-2026-07-01']]);
  assert.match(r.messages[0].content, /จัดตารางให้หน่อย[\s\S]*<ข้อมูลในแปะไว้>\nctx/);
  assert.equal(request({ model: 'gpt-x', question: 'q' }).model, 'claude-opus-5-5');
  assert.equal(request({ model: 'claude-haiku-5-5', question: 'q' }).model, 'claude-haiku-5-5');
  assert.equal('thinking' in r, false);
});

test('answers: JSON, refusals and cut-offs', () => {
  const msg = (text, stop = 'end_turn') => ({ stop_reason: stop, content: [{ type: 'thinking', thinking: '' }, { type: 'text', text }] });
  const ok = readAnswer(msg(JSON.stringify({ reply: 'ทำรายงานก่อน', items: [{ kind: 'task', text: ' พรุ่งนี้ 09:00 โทรหาหมอ ' }, { kind: 'pizza', text: 'x' }, { kind: 'shop', text: '' }] })));
  assert.deepEqual(ok, { reply: 'ทำรายงานก่อน', items: [{ kind: 'task', text: 'พรุ่งนี้ 09:00 โทรหาหมอ' }], note: '' });
  assert.match(readAnswer({ stop_reason: 'refusal', content: [] }).note, /ไม่ตอบ/);
  const cut = readAnswer(msg('{"reply": "ยาว', 'max_tokens'));
  assert.equal(cut.items.length, 0);
  assert.match(cut.note, /ถูกตัด/);
});

test('copy-paste prompt: data first, then the question, then how to answer so it pastes back', () => {
  const p = webPrompt('สรุปสัปดาห์นี้', 'ctx');
  assert.ok(p.indexOf('<ข้อมูลในแปะไว้>\nctx') < p.indexOf('<คำขอ>\nสรุปสัปดาห์นี้'));
  assert.match(p, /```แปะไว้\nงาน: /);
  assert.match(p, /วว\/ดด/);
  assert.match(p, /ไม่ใช้คำอย่าง “พรุ่งนี้”/);
  // without the person's data Claude still knows the day
  assert.match(webPrompt('q', '', { today: 'วันจันทร์ที่ 9' }), /^วันนี้คือวันจันทร์ที่ 9/);
});

test('copy-paste prompt for a recording: fixed headings, outline block, times kept', () => {
  const p = noteWebPrompt('[0:00] ประชุมทีม', 'การถอดเสียง', { title: 'ทีม "A"', when: '9 พ.ย.', timed: true, pins: ['1:23 · เลื่อนส่งงาน'] });
  assert.match(p, /^<การถอดเสียง ชื่อ="ทีม A">\n\[0:00\] ประชุมทีม\n<\/การถอดเสียง>/);
  for (const h of ['## ชื่อเรื่อง', '## สรุป', '## มายด์แมป', '## สิ่งที่ต้องทำ', '```แปะไว้', 'อัดเมื่อ9 พ.ย.', '[นาที:วินาที]', '1:23 · เลื่อนส่งงาน', 'ใช้เฉพาะข้อมูลในการถอดเสียง']) assert.ok(p.includes(h), h);
  assert.ok(!noteWebPrompt('x').includes('[นาที:วินาที]'));
});

test('timed text: a paragraph a minute, each with its time', () => {
  const text = 'สวัสดีครับ เริ่มประชุม เรื่องแรก งบ เรื่องสอง คน';
  const at = (w) => text.indexOf(w);
  const times = [[0, 0], [at('เริ่ม'), 20_000], [at('เรื่องแรก'), 65_000], [at('งบ'), 70_000], [at('เรื่องสอง'), 130_000]];
  assert.equal(timedText(text, times), '[0:00] สวัสดีครับ เริ่มประชุม\n\n[1:05] เรื่องแรก งบ\n\n[2:10] เรื่องสอง คน');
  assert.equal(timedText(' ข้อความ ', []), 'ข้อความ');
  // text before the first time is kept
  assert.match(timedText('ก่อน หลัง', [[5, 3000]]), /^\[0:03\] ก่อน หลัง$/);
});

const ANSWER = `## ชื่อเรื่อง
**“ประชุมเปิดตัวสินค้า”**

## สรุป
- **เลื่อนวันเปิดตัว**เป็น 20 พ.ย. [3:10]
- คุณแนนทำสไลด์ [7:45]

## มายด์แมป
\`\`\`
# เปิดตัวสินค้า
- วันเปิดตัว [3:10]
  - 20 พ.ย.
- สไลด์ [7:45]
\`\`\`

## สิ่งที่ต้องทำ
\`\`\`แปะไว้
งาน: 13/11 ส่งสไลด์
- ซื้อ: ของตัวอย่าง
จ่าย: ค่ารถ 120
งาน: 13/11 ส่งสไลด์
\`\`\``;

test('pasted answer: title, summary, outline and things to file', () => {
  const p = readPasted(ANSWER);
  assert.equal(p.title, 'ประชุมเปิดตัวสินค้า');
  assert.match(p.summary, /^- \*\*เลื่อนวันเปิดตัว\*\*เป็น 20 พ.ย. \[3:10\]\n- คุณแนนทำสไลด์ \[7:45\]$/);
  assert.match(p.outline, /^# เปิดตัวสินค้า\n- วันเปิดตัว \[3:10\]/);
  assert.deepEqual(p.items, [
    { kind: 'task', text: '13/11 ส่งสไลด์' },
    { kind: 'shop', text: 'ของตัวอย่าง' },
    { kind: 'money', text: 'ค่ารถ 120' },
  ]);
  assert.ok(isAnswer(ANSWER));
  // the app reads each line as the person would type it
  const now = new Date(2026, 10, 9, 10, 0).getTime();
  const r = classify(p.items[0].text, now, { force: p.items[0].kind });
  assert.deepEqual([r.kind, r.day, r.text], ['task', '2026-11-13', 'ส่งสไลด์']);
  assert.equal(classify(p.items[2].text, now, { force: 'money' }).amount, 120);
});

test('pasted answer: copied as rendered text, or just one code block', () => {
  const rendered = readPasted('ชื่อเรื่อง\nประชุมทีม\n\nสรุป\nเลื่อนงาน\n\nมายด์แมป\n# ทีม\n- งาน\n  - เลื่อน\n- คน\n\nสิ่งที่ต้องทำ\nงาน: 13/11 ส่งสไลด์\nไม่มี');
  assert.deepEqual([rendered.title, rendered.summary, rendered.outline.split('\n')[0], rendered.items], ['ประชุมทีม', 'เลื่อนงาน', '# ทีม', [{ kind: 'task', text: '13/11 ส่งสไลด์' }]]);
  assert.deepEqual(readPasted('งาน: 13/11 ส่งสไลด์\nซื้อ: นม').items, [{ kind: 'task', text: '13/11 ส่งสไลด์' }, { kind: 'shop', text: 'นม' }]);
  assert.equal(readPasted('# หัวข้อ\n- ก\n  - ข\n- ค').outline, '# หัวข้อ\n- ก\n  - ข\n- ค');
  assert.equal(readPasted('```markdown\n# หัวข้อ\n- ก\n- ค\n```').outline, '# หัวข้อ\n- ก\n- ค');
  // "ไม่มี" under the heading is nothing to file
  assert.deepEqual(readPasted('## สิ่งที่ต้องทำ\nไม่มี').items, []);
});

test('pasted answer to a question: the reading part without the block, lines in the block unsorted when unlabelled', () => {
  const p = readPasted('ทำรายงานก่อน\n\n1. **09:00** รายงาน\n\n```แปะไว้\nงาน: 09/11 13:00 โทรหาช่าง\nนม 2 ขวด\n```\nถ้ามีอะไรถามได้');
  assert.equal(p.reply, 'ทำรายงานก่อน\n\n1. **09:00** รายงาน\n\nถ้ามีอะไรถามได้');
  assert.deepEqual(p.items, [{ kind: 'task', text: '09/11 13:00 โทรหาช่าง' }, { kind: null, text: 'นม 2 ขวด' }]);
  assert.equal(readPasted('ตอบเฉย ๆ ไม่มีรายการ').items.length, 0);
  // other code blocks stay where they were
  assert.equal(readPasted('ก่อน\n```\nโค้ด\n```\nหลัง').reply, 'ก่อน\n\nโค้ด\n\nหลัง');
  assert.equal(isAnswer('นม\nไข่\nขนมปัง'), false);
  assert.equal(isAnswer('งาน: ก\nซื้อ: ข'), false); // a plain list: filed line by line as before
});

test('mind map outline keeps times both ways', () => {
  let map = Mm.fromOutline('# เปิดตัว\n- วันเปิดตัว\n- สไลด์', 'x', 1);
  map = { ...map, nodes: map.nodes.map((n) => (n.text === 'สไลด์' ? { ...n, at: 465_000 } : n)) };
  const outline = mapOutline(map);
  assert.equal(outline, '# เปิดตัว\n- วันเปิดตัว\n- สไลด์ [7:45]');
  assert.match(mapWebPrompt(outline), /^<มายด์แมป>\n# เปิดตัว[\s\S]*กล่องโค้ดเดียว/);
  const back = timesFromLabels(Mm.fromOutline(`${outline}\n  - ย่อย (1:02:03)`, 'x', 2));
  assert.deepEqual(
    back.nodes.map((n) => [n.text, n.at]),
    [['เปิดตัว', undefined], ['วันเปิดตัว', undefined], ['สไลด์', 465_000], ['ย่อย', 3_723_000]],
  );
});
