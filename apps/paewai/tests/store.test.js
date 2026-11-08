import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/lib/store.js';

const T = (h, m = 0, d = 8) => new Date(2026, 10, d, h, m).getTime();
const TODAY = '2026-11-08';

function seed() {
  let s = S.emptyState();
  s = S.addTask(s, { text: 'ซื้อนม' }, T(8));
  s = S.addTask(s, { text: 'ประชุม', day: TODAY, time: '14:00' }, T(8, 1));
  s = S.addTask(s, { text: 'ส่งงาน', day: TODAY }, T(8, 2));
  s = S.addTask(s, { text: 'โทรหาแม่', day: '2026-11-09', time: '17:00' }, T(8, 3));
  s = S.addTask(s, { text: 'ค้างจากเมื่อวาน', day: '2026-11-07' }, T(8, 4));
  s = S.addTask(s, { text: 'ปีหน้า', day: '2027-01-02' }, T(8, 5));
  return s;
}
const texts = (list) => list.map((t) => t.text);

test('addTask ignores empty text and keeps ids unique', () => {
  const s = S.emptyState();
  assert.equal(S.addTask(s, { text: '   ' }), s);
  const many = Array.from({ length: 50 }).reduce((acc, _, i) => S.addTask(acc, { text: `t${i}` }, T(9)), s);
  assert.equal(new Set(many.tasks.map((t) => t.id)).size, 50);
});

test('views group tasks by inbox / today / ahead / later', () => {
  const v = S.taskViews(seed(), TODAY, 6);
  assert.deepEqual(texts(v.inbox), ['ซื้อนม']);
  // overdue first (earlier day), then timed, then untimed
  assert.deepEqual(texts(v.today), ['ค้างจากเมื่อวาน', 'ประชุม', 'ส่งงาน']);
  assert.equal(v.overdue, 1);
  assert.equal(v.ahead.length, 6);
  assert.deepEqual(texts(v.ahead[0].tasks), ['โทรหาแม่']);
  assert.deepEqual(texts(v.later), ['ปีหน้า']);
});

test('finished tasks stay visible today, then drop off', () => {
  let s = seed();
  const id = s.tasks.find((t) => t.text === 'ค้างจากเมื่อวาน').id;
  s = S.toggleDone(s, id, T(11));
  let v = S.taskViews(s, TODAY);
  assert.deepEqual(texts(v.today), ['ประชุม', 'ส่งงาน', 'ค้างจากเมื่อวาน']);
  assert.equal(v.overdue, 0);
  v = S.taskViews(s, '2026-11-09');
  assert.ok(!texts(v.today).includes('ค้างจากเมื่อวาน'));
  // undo the tick
  s = S.toggleDone(s, id, T(12));
  assert.equal(s.tasks.find((t) => t.id === id).doneAt, null);
});

test('carryOver moves unfinished past tasks to today', () => {
  const s = S.carryOver(seed(), TODAY);
  assert.equal(s.tasks.find((t) => t.text === 'ค้างจากเมื่อวาน').day, TODAY);
  assert.equal(S.taskViews(s, TODAY).overdue, 0);
});

test('moveTask and editTask', () => {
  let s = seed();
  const id = s.tasks.find((t) => t.text === 'ประชุม').id;
  s = S.moveTask(s, id, null);
  assert.deepEqual([s.tasks.find((t) => t.id === id).day, s.tasks.find((t) => t.id === id).time], [null, null]);
  s = S.editTask(s, id, { text: ' ประชุมใหญ่ ', day: '2026-11-10', time: '09:00' });
  const t = s.tasks.find((x) => x.id === id);
  assert.deepEqual([t.text, t.day, t.time], ['ประชุมใหญ่', '2026-11-10', '09:00']);
  s = S.editTask(s, id, { day: null, time: '09:00' });
  assert.equal(s.tasks.find((x) => x.id === id).time, null);
});

test('dueTasks only returns unannounced timed tasks that are due', () => {
  let s = seed();
  assert.deepEqual(texts(S.dueTasks(s, T(13, 59))), []);
  assert.deepEqual(texts(S.dueTasks(s, T(14, 0))), ['ประชุม']);
  s = S.markAlerted(s, S.dueTasks(s, T(14, 0)).map((t) => t.id));
  assert.deepEqual(texts(S.dueTasks(s, T(15))), []);
  // moving it re-arms the reminder
  const id = s.tasks.find((t) => t.text === 'ประชุม').id;
  s = S.editTask(s, id, { day: TODAY, time: '16:00' });
  assert.deepEqual(texts(S.dueTasks(s, T(16))), ['ประชุม']);
});

test('clearDone keeps today\'s finished tasks', () => {
  let s = seed();
  const [a, b] = s.tasks;
  s = S.toggleDone(s, a.id, T(9, 0, 7));
  s = S.toggleDone(s, b.id, T(9, 0, 8));
  s = S.clearDone(s, TODAY);
  assert.ok(!s.tasks.some((t) => t.id === a.id));
  assert.ok(s.tasks.some((t) => t.id === b.id));
});

test('focus timer: pause, resume, extend, log', () => {
  let s = S.startFocus(S.emptyState(), 25, T(9), 'เขียนรายงาน');
  assert.equal(S.focusLeft(s.focus, T(9, 10)), 15 * 60_000);
  s = S.pauseFocus(s, T(9, 10));
  assert.equal(S.focusLeft(s.focus, T(9, 50)), 15 * 60_000);
  s = S.resumeFocus(s, T(10));
  s = S.extendFocus(s, 5, T(10));
  assert.equal(S.focusLeft(s.focus, T(10)), 20 * 60_000);
  s = S.stopFocus(s, T(10, 5));
  assert.equal(s.focus, null);
  assert.equal(s.focusLog[TODAY], 15 * 60_000);
  const st = S.stats(s, TODAY, T(11));
  assert.equal(st.focusTodayMs, 15 * 60_000);
});

test('notes: take a line out as a task', () => {
  const text = 'คิดเรื่องทริป\n- จองโรงแรม พรุ่งนี้\nซื้อของฝาก';
  const at = text.indexOf('จอง') + 2;
  const r = S.takeLine(text, at);
  assert.equal(r.line, 'จองโรงแรม พรุ่งนี้');
  assert.equal(r.rest, 'คิดเรื่องทริป\nซื้อของฝาก');
  const last = S.takeLine(text, text.length);
  assert.equal(last.line, 'ซื้อของฝาก');
  assert.equal(last.rest, 'คิดเรื่องทริป\n- จองโรงแรม พรุ่งนี้');
  assert.equal(S.takeLine('\nabc', 0).line, '');
  let s = S.setNote(S.emptyState(), TODAY, 'abc');
  s = S.setNote(s, TODAY, '');
  assert.deepEqual(s.notes, {});
});

test('sanitize rejects junk and repairs fields', () => {
  assert.equal(S.sanitize(null), null);
  assert.equal(S.sanitize({ tasks: 'x' }), null);
  const s = S.sanitize({
    tasks: [
      { id: 'a', text: ' ok ', day: '2026-11-08', time: '25:99x' },
      { id: 'a', text: 'dup id', day: 'bad' , time: '10:00' },
      { text: '' },
      null,
    ],
    notes: { '2026-11-08': 'hi', nope: 'x' },
    focus: { totalMs: 60000, endsAt: 'soon' },
  });
  assert.equal(s.tasks.length, 2);
  assert.equal(s.tasks[0].text, 'ok');
  assert.equal(s.tasks[0].time, null);
  assert.notEqual(s.tasks[1].id, 'a');
  assert.equal(s.tasks[1].day, null);
  assert.deepEqual(s.notes, { '2026-11-08': 'hi' });
  assert.equal(s.focus, null);
  // a saved state survives a round trip
  const round = S.sanitize(JSON.parse(JSON.stringify(seed())));
  assert.deepEqual(round.tasks.map((t) => t.text), seed().tasks.map((t) => t.text));
});

test('exportText lists unfinished tasks', () => {
  const text = S.exportText(seed(), TODAY, (d, t) => `${d}${t ? ` ${t}` : ''}`);
  assert.match(text, /^กล่องรับ\n☐ ซื้อนม/);
  assert.match(text, /☐ โทรหาแม่ \(2026-11-09 17:00\)/);
});

test('repeating reminders move on instead of finishing', () => {
  let s = S.addTask(S.emptyState(), { text: 'กินยา', day: TODAY, time: '20:00', repeat: 'daily' }, T(9));
  const id = s.tasks[0].id;
  s = S.toggleDone(s, id, T(20, 5));
  let t = s.tasks[0];
  assert.deepEqual([t.done, t.day, t.time, t.streak], [false, '2026-11-09', '20:00', 1]);
  // overdue by a few days: the next time is not in the past
  s = S.editTask(s, id, { day: '2026-11-01', time: '20:00' });
  s = S.toggleDone(s, id, T(9));
  assert.ok(s.tasks[0].day >= TODAY);
  // clearing the day drops the repeat
  s = S.editTask(s, id, { day: null });
  assert.equal(s.tasks[0].repeat, null);
  assert.equal(S.addTask(S.emptyState(), { text: 'x', repeat: 'daily' }).tasks[0].repeat, null);
});

test('shopping list groups by section and clears what was bought', () => {
  let s = S.addShop(S.emptyState(), [{ text: 'นม' }, 'กล้วย', 'น้ำยาล้างจาน', ' '], T(9));
  assert.equal(s.shop.length, 3);
  const g = S.shopGroups(s);
  assert.deepEqual(g.groups.map((x) => x.cat), ['ผัก ผลไม้', 'นม ไข่ เบเกอรี่', 'ของใช้ในบ้าน']);
  s = S.toggleShop(s, s.shop[0].id, T(10));
  assert.equal(S.shopGroups(s).bought.length, 1);
  s = S.clearBought(s);
  assert.deepEqual(s.shop.map((i) => i.text), ['กล้วย', 'น้ำยาล้างจาน']);
});

test('money: totals for today, the week and by category', () => {
  let s = S.emptyState();
  s = S.addMoney(s, { text: 'ข้าว', amount: 50, cat: 'อาหาร' }, T(9));
  s = S.addMoney(s, { text: 'กาแฟ', amount: 65.5, cat: 'อาหาร' }, T(10));
  s = S.addMoney(s, { text: 'น้ำมัน', amount: 1200, cat: 'เดินทาง' }, T(9, 0, 6));
  s = S.addMoney(s, { text: 'ศูนย์', amount: 0 }, T(9));
  const m = S.moneySummary(s, TODAY);
  assert.equal(m.today, 115.5);
  assert.equal(m.weekTotal, 1315.5);
  assert.equal(m.week.length, 7);
  assert.equal(m.week.at(-1).total, 115.5);
  assert.deepEqual(m.byCat.map((c) => c.cat), ['เดินทาง', 'อาหาร']);
  assert.deepEqual(m.days.map((d) => d.day), ['2026-11-08', '2026-11-06']);
  s = S.editMoney(s, s.money[0].id, { amount: 60, cat: 'ไม่มี' });
  assert.deepEqual([s.money[0].amount, s.money[0].cat], [60, 'อาหาร']);
  s = S.deleteMoney(s, s.money[0].id);
  assert.equal(s.money.length, 2);
});

test('quick notes: pinned first, edit, delete', () => {
  let s = S.addMemo(S.emptyState(), 'รหัส wifi abc', T(9));
  s = S.addMemo(s, 'ไอเดียคลิป', T(10));
  assert.deepEqual(S.sortedMemos(s).map((m) => m.text), ['ไอเดียคลิป', 'รหัส wifi abc']);
  s = S.pinMemo(s, s.memos.find((m) => m.text.startsWith('รหัส')).id);
  assert.deepEqual(S.sortedMemos(s).map((m) => m.text), ['รหัส wifi abc', 'ไอเดียคลิป']);
  s = S.editMemo(s, s.memos[0].id, '  ');
  assert.equal(s.memos.length, 1);
});

test('search across everything', () => {
  let s = seed();
  s = S.addMemo(s, 'ประชุมใหญ่ปีหน้า: จองห้องก่อน', T(9));
  s = S.setNote(s, TODAY, 'บรรทัดแรก\nคิดเรื่องประชุม');
  s = S.addMoney(s, { text: 'กาแฟก่อนประชุม', amount: 60, cat: 'อาหาร' }, T(9));
  const r = S.search(s, 'ประชุม');
  assert.deepEqual(r.tasks.map((t) => t.text), ['ประชุม']);
  assert.equal(r.memos.length, 1);
  assert.deepEqual(r.notes, [{ day: TODAY, line: 'คิดเรื่องประชุม' }]);
  assert.equal(r.money.length, 1);
  assert.deepEqual(S.search(s, '  ').tasks, []);
});

test('sanitize keeps the new collections and drops junk', () => {
  const s = S.sanitize({
    tasks: [{ id: 'r', text: 'x', day: '2026-11-08', repeat: 'weekly:9' }],
    memos: [{ text: 'm' }, { text: '' }],
    shop: [{ text: 'นม', cat: 'ไม่มี' }],
    money: [{ text: 'a', amount: 10, cat: 'อาหาร' }, { amount: -5 }],
  });
  assert.equal(s.tasks[0].repeat, null);
  assert.equal(s.memos.length, 1);
  assert.equal(s.shop[0].cat, 'นม ไข่ เบเกอรี่');
  assert.equal(s.money.length, 1);
  assert.deepEqual(S.sanitize({ tasks: [] }).shop, []);
});
