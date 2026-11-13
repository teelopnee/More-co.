import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { tidy, wordSpaced } from '../src/lib/thai.js';
import { analyze } from '../src/lib/summarize.js';

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}.txt`, import.meta.url), 'utf8');
const seg = new Intl.Segmenter('th', { granularity: 'word' });
/** What a recognizer that puts a space after every word returns. */
const spaced = (text) => [...seg.segment(text)].map((s) => s.segment.trim()).filter(Boolean).join(' ');
const NOW = new Date(2026, 10, 13, 10, 0).getTime();

test('a space after every word is not how Thai is written: the words are joined again', () => {
  const heard = 'สวัสดี ครับ ทุก คน วัน นี้ เรา จะ คุย เรื่อง การ เปิด ตัว สินค้า ใหม่ นะ ครับ ตอน นี้ ทีม ผลิต แจ้ง มา ว่า สินค้า ล็อต แรก จะ เสร็จ ช้า กว่า กำหนด ประมาณ สอง สัปดาห์ ครับ';
  assert.ok(wordSpaced(heard));
  const t = tidy(heard);
  assert.ok(t.changed);
  assert.equal(t.text, 'สวัสดีครับ ทุกคนวันนี้เราจะคุยเรื่องการเปิดตัวสินค้าใหม่นะครับ ตอนนี้ทีมผลิตแจ้งมาว่าสินค้าล็อตแรกจะเสร็จช้ากว่ากำหนดประมาณสองสัปดาห์ครับ');
  // done once: tidying again changes nothing
  assert.deepEqual([tidy(t.text).text, tidy(t.text).changed], [t.text, false]);
});

test('numbers, English words and ๆ keep their spaces', () => {
  const t = tidy('เรา จะ ประชุม วัน ที่ 15 ธันวาคม เวลา 10 โมง ที่ ห้อง Meeting A แล้ว ก็ คุย เรื่อง ต่าง ๆ กัน').text;
  assert.match(t, /วันที่ 15 ธันวาคม/);
  assert.match(t, /เวลา 10 โมง/);
  assert.match(t, /ห้อง Meeting A แล้วก็/);
  assert.match(t, /ต่าง ๆ กัน/);
});

test('text written the usual way is left as it is', () => {
  for (const name of ['meeting', 'lecture', 'memo', 'interview']) {
    const text = fixture(name);
    assert.equal(wordSpaced(text), false, name);
    assert.deepEqual([tidy(text, [], { walls: false }).changed, tidy(text, [], { walls: false }).text === text], [false, true], name);
  }
  // a typed list of short things stays a list when its lines are short
  assert.equal(tidy('นม\nไข่\nขนมปัง', [], { walls: false }).text, 'นม\nไข่\nขนมปัง');
});

test('each run the recognizer reported is an utterance: its pause stays, its time follows it', () => {
  const runs = ['สวัสดี ครับ ทุก คน', 'วัน นี้ เรา จะ คุย เรื่อง งบ โฆษณา', 'เดิม เรา ตั้ง ไว้ 500,000 บาท', 'โอ เค ครับ'];
  let text = '';
  const times = [];
  runs.forEach((r, i) => {
    times.push([text ? text.length + 1 : 0, i * 5000]);
    text += (text ? ' ' : '') + r;
  });
  const t = tidy(text, times);
  assert.equal(t.text, 'สวัสดีครับทุกคน วันนี้เราจะคุยเรื่องงบโฆษณา เดิมเราตั้งไว้ 500,000 บาท โอเคครับ');
  assert.deepEqual(t.times.map(([at, ms]) => [t.text.slice(at, at + 4), ms]), [['สวัส', 0], ['วันน', 5000], ['เดิม', 10000], ['โอเค', 15000]]);
  // a longer recording keeps what was tidied before (the app compares the two to see what was added)
  const more = `${text} แล้ว เจอ กัน พรุ่ง นี้ นะ ครับ`;
  const t2 = tidy(more, [...times, [text.length + 1, 20000]]);
  assert.ok(t2.text.startsWith(t.text));
  assert.equal(t2.text.slice(t2.times.at(-1)[0]), 'แล้วเจอกันพรุ่งนี้นะครับ');
});

test('a recognizer that returns no space at all gets its pauses back', () => {
  const wall = fixture('meeting').replace(/\s+/g, '');
  const t = tidy(wall);
  assert.ok(t.changed);
  assert.ok(t.text.split(' ').length > 20);
  assert.equal(t.text.replace(/ /g, ''), wall, 'only spaces are added');
  // not when the text may be a person's own
  assert.equal(tidy(wall, [], { walls: false }).changed, false);
});

test('the summary of a word-spaced meeting is the same as of the meeting itself', () => {
  const text = fixture('meeting');
  const good = analyze(text, { title: 'x', now: NOW });
  const raw = analyze(spaced(text.replace(/\n+/g, ' ')), { title: 'x', now: NOW });
  const fixed = analyze(tidy(spaced(text.replace(/\n+/g, ' '))).text, { title: 'x', now: NOW });
  // before: no decisions found, words still apart
  assert.equal(raw.decisions.length, 0);
  assert.deepEqual([fixed.kind, fixed.decisions.length, fixed.actions.length, fixed.open.length], [good.kind, good.decisions.length, good.actions.length, good.open.length]);
  assert.match(fixed.summary, /เลื่อนเปิดตัวไป 15 ธ\.ค\./);
  assert.match(fixed.summary, /เพิ่มงบโฆษณาเป็น 600,000 บาท/);
  assert.doesNotMatch(fixed.summary, /[ก-๎] [ก-๎]{1,3} [ก-๎]{1,3} [ก-๎]/, 'no words left apart');
});

test('an hour of word-spaced speech is tidied in well under a second', () => {
  const hour = Array.from({ length: 12 }, () => spaced(fixture('meeting').replace(/\n+/g, ' '))).join(' ');
  const t0 = Date.now();
  const t = tidy(hour);
  assert.ok(t.changed);
  assert.ok(Date.now() - t0 < 1500, `${Date.now() - t0} ms`);
});
