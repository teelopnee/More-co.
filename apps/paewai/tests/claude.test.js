import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/lib/store.js';
import { ANSWER_SCHEMA, contextFor, readAnswer, request, webLink, webPrompt } from '../src/lib/claude.js';

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

test('claude.ai link: the question goes in the link while it is short enough', () => {
  const p = webPrompt('สรุปสัปดาห์นี้', 'ctx');
  assert.match(p, /คัดลอกไปวางในแอป/);
  assert.ok(webLink(p).startsWith('https://claude.ai/new?q='));
  assert.equal(webLink('ก'.repeat(5000)), 'https://claude.ai/new');
});
