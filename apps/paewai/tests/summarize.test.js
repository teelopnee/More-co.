import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { childrenOf, rootOf } from '../src/lib/mindmap.js';
import { analyze, clean, namedTopic, sentences, shorten, thaiNumber, toMindMap } from '../src/lib/summarize.js';

// The recordings were "made" on Monday 9 Nov 2026, 10:00.
const NOW = new Date(2026, 10, 9, 10, 0).getTime();
const fixture = (name) => readFileSync(new URL(`./fixtures/${name}.txt`, import.meta.url), 'utf8');
/** Speech recognizers: one long line (no paragraphs), or no spaces at all. */
const oneLine = (t) => t.replace(/\s*\n\s*/g, ' ');
const noSpaces = (t) => t.replace(/[ \t]+/g, '');

const find = (list, re) => list.find((x) => re.test(x.text));

/** Rules every generated map follows: readable nodes, no repeats, no speech noise. */
function checkMap(map, a) {
  const root = rootOf(map);
  assert.equal(root.text, a.title);
  const branches = childrenOf(map, root.id);
  assert.ok(branches.length >= 2 && branches.length <= 9, `branches: ${branches.length}`);
  for (const n of map.nodes) {
    assert.ok(n.text.length > 0 && n.text.length <= 90, `node too long: ${n.text}`);
    assert.doesNotMatch(n.text, /(?:^|\s)(?:เอ่อ|อืม)(?:\s|$)|ครับ$|ค่ะ$|นะคะ$|ผู้พูด|\(\d{2}:\d{2}\)/, n.text);
    const sibs = childrenOf(map, n.id).map((c) => c.text);
    assert.equal(new Set(sibs).size, sibs.length, `repeated under ${n.text}: ${sibs}`);
    assert.ok(sibs.length <= 8, `too many under ${n.text}`);
  }
}

test('Thai numbers, cleaning and topic names', () => {
  assert.equal(thaiNumber('สิบห้า'), 15);
  assert.equal(thaiNumber('ยี่สิบเอ็ด'), 21);
  assert.equal(thaiNumber('สามพันห้าร้อย'), 3500);
  assert.ok(Number.isNaN(thaiNumber('ห้าง')));
  assert.equal(clean('เอ่อ แล้วก็ส่งงานพรุ่งนี้นะครับ'), 'ส่งงานพรุ่งนี้');
  assert.equal(clean('แต่ละคนได้ของขวัญ'), 'แต่ละคนได้ของขวัญ');
  assert.equal(namedTopic('เรื่องต่อไปคืองบโฆษณาออนไลน์ครับ'), 'งบโฆษณาออนไลน์');
  assert.equal(namedTopic('ต่อไปเป็นเรื่องการแบ่งเงินเดือนแบบ 50 30 20 นะคะ'), 'การแบ่งเงินเดือนแบบ 50 30 20');
  assert.equal(namedTopic('วันนี้เราจะมาเรียนเรื่องการวางแผนการเงินส่วนบุคคลกันนะคะ'), 'การวางแผนการเงินส่วนบุคคล');
  assert.equal(namedTopic('แล้วเรื่องที่เที่ยวล่ะคะ'), 'ที่เที่ยว');
  assert.equal(namedTopic('อย่าลืมทำสัญญาเรื่องวันที่ลงคลิปด้วย'), '');
  // a number keeps its unit, an abbreviation its dot
  assert.match(shorten('ตอนนี้ทีมผลิตแจ้งมาว่าสินค้าล็อตแรกจะเสร็จช้ากว่ากำหนดประมาณ 2 สัปดาห์ครับ', 40), /2 สัปดาห์$/);
  assert.match(shorten('หนี้บัตรเครดิตมีดอกเบี้ยสูงถึง 16% ต่อปี ถ้าจ่ายแค่ขั้นต่ำ หนี้จะลดลงช้ามาก', 34), /16%/);
});

test('sentences: pauses, particles and agreement', () => {
  const s = sentences('ทุกคนโอเคไหมครับ ค่ะ โอเคค่ะ ทางการตลาดไม่มีปัญหาค่ะ ได้ครับ งั้นสรุปว่าเราเลื่อนเปิดตัวนะครับ');
  assert.deepEqual(
    s.map((x) => x.clean),
    ['ทุกคนโอเคไหม', 'ทางการตลาดไม่มีปัญหา', 'สรุปว่าเราเลื่อนเปิดตัว'],
  );
  assert.ok(s[0].isQ);
  // speech recognizers that return no spaces
  const run = sentences('สวัสดีครับวันนี้เราจะคุยเรื่องงบโฆษณานะครับเดิมเราตั้งไว้ห้าแสนบาทแต่พอเลื่อนเปิดตัวค่าโฆษณาจะแพงขึ้นยี่สิบเปอร์เซ็นต์ค่ะ');
  assert.ok(run.length >= 3, run.map((x) => x.text).join(' | '));
  assert.ok(run.some((x) => /20%/.test(x.text)));
});

test('meeting: topics, decisions, tasks with owners and dates, open questions', () => {
  for (const text of [fixture('meeting'), oneLine(fixture('meeting'))]) {
    const a = analyze(text, { now: NOW });
    assert.equal(a.title, 'การเปิดตัวสินค้าใหม่');
    assert.ok(a.named);
    const names = a.sections.map((s) => s.name);
    for (const n of ['งบโฆษณาออนไลน์', 'คลิปรีวิวสินค้ากับอินฟลูเอนเซอร์', 'บูธที่ห้าง']) assert.ok(names.includes(n), names.join(', '));

    assert.ok(find(a.decisions, /เลื่อนเปิดตัว.*15 ธ\.ค\./), a.decisions.map((d) => d.text).join(' | '));
    assert.ok(find(a.decisions, /เพิ่มงบ.*600,000 บาท/));

    const b = find(a.actions, /ทำแผนงบโฆษณา/);
    assert.equal(b.who, 'คุณบี');
    assert.equal(b.day, '2026-11-13');
    const m = find(a.actions, /ส่งสินค้าตัวอย่าง/);
    assert.equal(m.who, 'คุณเอ็ม');
    assert.equal(m.day, '2026-12-02');
    assert.equal(find(a.actions, /ทำสัญญา/).who, 'คุณเอ็ม');
    assert.equal(find(a.actions, /โทรคุยกับฝ่ายการตลาด/).day, '2026-11-10');
    const next = find(a.actions, /ประชุมครั้งหน้า/);
    assert.deepEqual([next.day, next.time], ['2026-11-16', '14:00']);
    assert.ok(!a.actions.some((x) => /สวัสดี|คุยเรื่อง|เลื่อนวันเปิดตัว|จองพื้นที่ไว้/.test(x.text)), a.actions.map((x) => x.text).join(' | '));

    assert.ok(find(a.open, /ยังไม่ยืนยันขนาดพื้นที่/));
    assert.ok(find(a.open, /ใครจะเป็นคนดูแลบูธ/));
    assert.ok(!a.open.some((o) => /สินค้าตัวอย่าง|กี่เครื่อง|โอเค/.test(o.text)), 'answered questions are not open');

    for (const fact of ['20%', '500,000 บาท', '600,000 บาท', '2 สัปดาห์', '3×3 เมตร']) assert.ok(a.summary.includes(fact), `${fact} missing`);
    assert.doesNotMatch(a.summary, /เอ่อ|อืม|ครับ|ค่ะ/);
    assert.deepEqual(
      a.items.map((x) => x.text.slice(0, 5)).filter((t) => /^\d/.test(t)),
      ['13/11', '02/12', '10/11', '16/11'],
    );
    checkMap(toMindMap(a, NOW), a);
  }
});

test('meeting without any spaces still gives the same decisions and owners', () => {
  const a = analyze(noSpaces(fixture('meeting')), { now: NOW });
  assert.equal(a.title, 'การเปิดตัวสินค้าใหม่');
  assert.ok(find(a.decisions, /600,000/));
  assert.equal(find(a.actions, /ทำแผนงบโฆษณา/).who, 'คุณบี');
  assert.equal(find(a.actions, /ส่งสินค้าตัวอย่าง/).day, '2026-12-02');
  checkMap(toMindMap(a, NOW), a);
});

test('lecture: one branch per part of the lesson, homework with its due date', () => {
  for (const text of [fixture('lecture'), oneLine(fixture('lecture'))]) {
    const a = analyze(text, { now: NOW });
    assert.equal(a.title, 'การวางแผนการเงินส่วนบุคคล');
    assert.deepEqual(
      a.sections.map((s) => s.name),
      ['เงินสำรองฉุกเฉิน', 'การแบ่งเงินเดือนแบบ 50 30 20', 'การลงทุนแบบ DCA', 'หนี้บัตรเครดิต'],
    );
    for (const s of a.sections) assert.ok(s.points.length >= 2, s.name);
    for (const fact of ['6 เดือน', '16%', '20%', 'กองทุนรวมดัชนี']) assert.ok(a.summary.includes(fact), `${fact} missing`);
    const hw = find(a.actions, /^การบ้าน/);
    assert.equal(hw.day, '2026-11-18');
    assert.match(hw.text, /จดรายรับรายจ่าย/);
    assert.equal(a.open.length, 0);
    checkMap(toMindMap(a, NOW), a);
  }
});

test('voice memo: every errand becomes a task, the idea stays a note', () => {
  const a = analyze(fixture('memo'), { now: NOW, title: 'บันทึกเสียง 9 พ.ย. 10:00' });
  assert.ok(!a.named);
  assert.equal(a.title, 'บันทึกเสียง 9 พ.ย. 10:00');
  const dentist = find(a.actions, /โทรหาหมอฟัน/);
  assert.deepEqual([dentist.day, dentist.time], ['2026-11-10', '09:00']);
  assert.ok(find(a.actions, /ซื้อนม ไข่/));
  assert.equal(find(a.actions, /งานแต่ง/).day, '2026-11-14');
  assert.equal(find(a.actions, /ตั๋วเครื่องบิน/).day, '2026-11-09');
  assert.ok(find(a.points, /ไอเดีย/));
  assert.ok(!a.actions.some((x) => /ไอเดีย|ลองถ่าย/.test(x.text)));
  checkMap(toMindMap(a, NOW), a);
});

test('Samsung Voice Recorder transcript: speaker labels and times are not content', () => {
  for (const text of [fixture('samsung'), oneLine(fixture('samsung'))]) {
    const a = analyze(text, { now: NOW });
    assert.equal(a.title, 'ทริปเชียงใหม่ช่วงปีใหม่');
    assert.doesNotMatch(a.summary, /ผู้พูด|\d\d:\d\d\)/);
    assert.ok(find(a.decisions, /นิมมาน 3 คืน/));
    assert.equal(find(a.actions, /จองที่พัก/).day, '2026-11-10');
    assert.equal(find(a.actions, /จองรถเช่า/).day, '2026-11-13');
    assert.ok(find(a.actions, /เสื้อกันหนาว/));
    assert.match(a.summary, /15,000 บาทต่อคน/);
    assert.match(a.summary, /2,500 บาท/);
    const names = a.sections.map((s) => s.name);
    assert.ok(names.includes('ที่พัก') && names.includes('ที่เที่ยว'), names.join(', '));
    checkMap(toMindMap(a, NOW), a);
  }
});

test('edge cases: nothing, one line, English, a very long recording', () => {
  assert.equal(analyze('', { now: NOW }), null);
  assert.equal(analyze('เอ่อ ครับ', { now: NOW }), null);
  const one = analyze('พรุ่งนี้ต้องส่งรายงานให้หัวหน้าก่อนเที่ยง', { now: NOW });
  assert.equal(one.actions.length, 1);
  assert.equal(one.actions[0].day, '2026-11-10');
  assert.ok(toMindMap(one, NOW).nodes.length >= 3);
  const en = analyze('We agreed to move the launch to December. Ben will send the new budget by Friday. Who runs the booth?', { now: NOW });
  assert.ok(en && en.summary.length > 0);
  // an hour of talk: still quick
  const long = Array.from({ length: 25 }, () => fixture('meeting')).join('\n\n');
  const t0 = performance.now();
  const big = analyze(long, { now: NOW });
  const ms = performance.now() - t0;
  assert.ok(big.sentences > 800);
  assert.ok(ms < 8000, `${Math.round(ms)} ms`);
  checkMap(toMindMap(big, NOW), big);
});
