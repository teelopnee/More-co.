import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, findAmount, moneyCategory, pastedLines, shopSection, splitItems } from '../src/lib/sort.js';

// Sunday 8 November 2026, 10:00
const NOW = new Date(2026, 10, 8, 10, 0).getTime();
const kind = (s, opts) => classify(s, NOW, opts).kind;

test('reminders: a day, a time or a repeat', () => {
  const r = classify('พรุ่งนี้ 5 โมงเย็น โทรหาแม่', NOW);
  assert.deepEqual([r.kind, r.text, r.day, r.time], ['task', 'โทรหาแม่', '2026-11-09', '17:00']);
  const d = classify('ทุกวัน 8 โมง กินยา', NOW);
  assert.deepEqual([d.kind, d.text, d.repeat, d.time], ['task', 'กินยา', 'daily', '08:00']);
  assert.equal(kind('จ่ายค่าไฟ 850 วันที่ 25'), 'task'); // a date wins over the amount
});

test('tasks: things to do start with an action', () => {
  for (const s of ['โทรหาช่างแอร์', 'ประชุมทีม', 'อ่านหนังสือ 20 หน้า', 'ส่งรายงาน', 'จองโต๊ะร้านอาหาร', 'ดูหนัง Dune', 'หาไอเดียทำคลิปใหม่', 'call the bank', 'ตัดผม', 'ทำการบ้าน', 'ซักผ้า']) {
    assert.equal(kind(s), 'task', s);
  }
});

test('notes: ideas, info, numbers, links, places', () => {
  for (const s of [
    'ไอเดียทำคลิปใหม่',
    'รหัส wifi บ้าน abc12345',
    'เบอร์ช่างแอร์ 081-234-5678',
    'https://www.threads.com/share/xyz',
    'ร้านข้าวซอยอร่อยแถวนิมมาน',
    'หาดใหญ่สวยมาก',
    'อยากดู Severance ซีซั่น 2',
  ]) {
    assert.equal(kind(s), 'note', s);
  }
  const n = classify('โน้ต: ประชุมวันนี้ได้ข้อสรุปว่าจะเลื่อนเปิดตัว', NOW);
  assert.deepEqual([n.kind, n.text], ['note', 'ประชุมวันนี้ได้ข้อสรุปว่าจะเลื่อนเปิดตัว']);
});

test('shopping: split into items and sorted by store section', () => {
  const s = classify('ซื้อนม ไข่ ขนมปัง', NOW);
  assert.equal(s.kind, 'shop');
  assert.deepEqual(s.items.map((i) => i.text), ['นม', 'ไข่', 'ขนมปัง']);
  assert.deepEqual(new Set(s.items.map((i) => i.cat)), new Set(['นม ไข่ เบเกอรี่']));
  assert.deepEqual(classify('ซื้อนมไข่ขนมปัง', NOW).items.map((i) => i.text), ['นม', 'ไข่', 'ขนมปัง']);
  assert.deepEqual(classify('ซื้อไข่ 10 ฟอง น้ำยาล้างจาน', NOW).items.map((i) => `${i.text}|${i.cat}`), [
    'ไข่ 10 ฟอง|นม ไข่ เบเกอรี่',
    'น้ำยาล้างจาน|ของใช้ในบ้าน',
  ]);
  assert.deepEqual(classify('ซื้อของฝากแม่', NOW).items.map((i) => i.cat), ['อื่น ๆ']);
  assert.equal(kind('นม ไข่ กล้วย'), 'shop');
  assert.equal(kind('ซื้อของฝากแม่ พรุ่งนี้'), 'task'); // with a day it is a reminder
});

test('money: an amount with a spending word or ฿/บาท', () => {
  const m = classify('ข้าวมันไก่ 50', NOW);
  assert.deepEqual([m.kind, m.text, m.amount, m.cat], ['money', 'ข้าวมันไก่', 50, 'อาหาร']);
  assert.deepEqual(
    ['ค่ากาแฟ 65 บาท', 'เติมน้ำมัน 1,200', 'ค่าเช่า 8,500 บาท', 'grab ไปออฟฟิศ 120'].map((s) => {
      const r = classify(s, NOW);
      return [r.kind, r.amount, r.cat];
    }),
    [['money', 65, 'อาหาร'], ['money', 1200, 'เดินทาง'], ['money', 8500, 'บิล ค่าบ้าน'], ['money', 120, 'เดินทาง']],
  );
  assert.deepEqual([classify('จ่ายค่าไฟ 850', NOW).text], ['ค่าไฟ']);
  assert.equal(kind('ห้อง 302'), 'note'); // a number alone is not money
  assert.equal(findAmount('อ่าน 20 หน้า'), null);
  assert.equal(findAmount('โทร 0812345678'), null);
  assert.equal(findAmount('฿99.50').amount, 99.5);
  assert.equal(findAmount('ค่าเช่า 15/11'), null);
  assert.equal(findAmount('ประชุม 17:30'), null);
});

test('force and noDate overrides', () => {
  assert.equal(kind('ไอเดียทำคลิปใหม่', { force: 'task' }), 'task');
  const r = classify('ค่าเช่า 15/11', NOW, { noDate: true, force: 'note' });
  assert.deepEqual([r.kind, r.text, r.day], ['note', 'ค่าเช่า 15/11', null]);
  assert.equal(classify('นม', NOW, { force: 'shop' }).items[0].text, 'นม');
});

test('word lists', () => {
  assert.deepEqual(splitItems('นม, ไข่ และกาแฟ'), ['นม', 'ไข่', 'กาแฟ']);
  assert.equal(shopSection('นมถั่วเหลือง'), 'นม ไข่ เบเกอรี่');
  assert.equal(shopSection('อาหารแมว'), 'สัตว์เลี้ยง');
  assert.equal(moneyCategory('ค่าไฟเดือนนี้'), 'บิล ค่าบ้าน');
  assert.equal(moneyCategory('อะไรสักอย่าง'), null);
});

test('pasted lists: one entry per line, without markdown', () => {
  const text = '## แผนพรุ่งนี้\n- [ ] พรุ่งนี้ 9 โมง โทรหาหมอ\n- **ซื้อ** ไข่ นม\n1. ไอเดีย: ทำคลิปรีวิว\n**วันจันทร์:**\n---\n* [x] จ่ายค่าไฟ 850\n2) 10:30 ประชุม\n\n';
  assert.deepEqual(pastedLines(text), ['พรุ่งนี้ 9 โมง โทรหาหมอ', 'ซื้อ ไข่ นม', 'ไอเดีย: ทำคลิปรีวิว', 'จ่ายค่าไฟ 850', '10:30 ประชุม']);
  assert.deepEqual(pastedLines('25 บาท ค่าน้ำ'), ['25 บาท ค่าน้ำ']); // a number is not a list marker
});
