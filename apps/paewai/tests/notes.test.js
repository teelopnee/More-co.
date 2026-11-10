import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/lib/store.js';
import * as N from '../src/lib/notes.js';
import * as Y from '../src/lib/sync.js';
import { base64ToBytes, bytesToBase64, fromBase64, toBase64 } from '../src/lib/github.js';

const NOW = new Date(2026, 10, 10, 10, 0).getTime();
const IMG = { id: 'mwa3qykr03o2qh', w: 1600, h: 1067 };

test('a note: title, colour, labels, pictures; an empty one is not kept', () => {
  let s = S.addMemo(S.emptyState(), { title: '  ทริป  เชียงใหม่ ', text: 'จองที่พัก', color: 'mint', labels: ['#เที่ยว', 'เที่ยว', ' ครอบครัว '], images: [IMG, IMG, { id: '../x' }] }, NOW);
  const m = s.memos[0];
  assert.deepEqual([m.title, m.color, m.labels, m.images], ['ทริป เชียงใหม่', 'mint', ['เที่ยว', 'ครอบครัว'], [IMG]]);
  assert.equal(S.addMemo(s, { text: ' ', title: '' }, NOW), s);
  // a picture alone is a note
  s = S.addMemo(s, { text: '', images: [{ ...IMG, id: 'abcdef123456', t: 'png' }] }, NOW + 1);
  assert.equal(s.memos.length, 2);
  assert.equal(s.memos[0].images[0].t, 'png');
  // an unknown colour is dropped; clearing everything deletes the note
  s = S.patchMemo(s, m.id, { color: 'neon', pinned: true }, NOW + 2);
  assert.equal(s.memos.find((x) => x.id === m.id).color, undefined);
  assert.equal(S.patchMemo(s, m.id, { text: '', title: '', images: [] }, NOW + 3).memos.length, 1);
  // saving the same thing again changes nothing (no new sync stamp)
  assert.equal(S.patchMemo(s, m.id, { pinned: true }, NOW + 9), s);
  // all of it survives the saved file
  assert.deepEqual(S.sanitize(JSON.parse(JSON.stringify(s))).memos, s.memos);
});

test('checklists: one item a line, ticked or not', () => {
  assert.deepEqual(N.listItems('[ ] นม\n- [x] ไข่\n\n• ขนมปัง\n2. กาแฟ'), [
    { done: false, text: 'นม' }, { done: true, text: 'ไข่' }, { done: false, text: 'ขนมปัง' }, { done: false, text: 'กาแฟ' },
  ]);
  const text = N.listText(N.listItems('นม\nไข่'));
  assert.equal(text, '[ ] นม\n[ ] ไข่');
  assert.equal(N.toggleItem(text, 1), '[ ] นม\n[x] ไข่');
  assert.equal(N.plainText('[ ] นม\n[x] ไข่'), 'นม\nไข่');
  assert.match(N.noteText({ title: 'ซื้อ', text: '[x] ไข่', list: true, labels: ['บ้าน'] }), /^ซื้อ\nไข่\n#บ้าน$/);
});

test('labels typed as #tags', () => {
  assert.deepEqual(N.extractLabels('ไอเดียคลิป #งาน #ยูทูบ'), { text: 'ไอเดียคลิป', labels: ['งาน', 'ยูทูบ'] });
  // "#1" and a "#" inside a link are not labels
  assert.deepEqual(N.extractLabels('ห้อง #1 https://a.b/#top'), { text: 'ห้อง #1 https://a.b/#top', labels: [] });
  const memos = [{ labels: ['งาน', 'บ้าน'] }, { labels: ['งาน'] }, { labels: ['ลับ'], trashedAt: 5 }];
  assert.deepEqual(N.allLabels(memos), [{ name: 'งาน', count: 2 }, { name: 'บ้าน', count: 1 }]);
});

test('board, archive and the bin', () => {
  let s = S.emptyState();
  for (const [i, t] of ['ก', 'ข', 'ค', 'ง'].entries()) s = S.addMemo(s, { text: t, labels: i < 2 ? ['งาน'] : [], images: i === 3 ? [IMG] : [] }, NOW + i);
  const id = (t) => s.memos.find((m) => m.text === t).id;
  s = S.pinMemo(s, id('ก'));
  s = S.archiveMemo(s, id('ข'));
  s = S.trashMemo(s, id('ค'), NOW + 10);
  const texts = (opts) => N.visibleNotes(s.memos, opts).map((m) => m.text);
  assert.deepEqual(texts(), ['ก', 'ง']);
  assert.deepEqual(S.sortedMemos(s).map((m) => m.text), ['ก', 'ง']);
  assert.deepEqual(texts({ filter: 'archive' }), ['ข']);
  assert.deepEqual(texts({ filter: 'trash' }), ['ค']);
  assert.deepEqual(texts({ label: 'งาน' }), ['ก']);
  assert.deepEqual(texts({ filter: 'images' }), ['ง']);
  // search looks in archived notes, never in the bin
  assert.deepEqual(S.search(s, 'ข').memos.map((m) => m.text), ['ข']);
  assert.equal(S.search(s, 'ค').memos.length, 0);
  // back from the bin; after a week it is gone for good
  assert.deepEqual(N.visibleNotes(S.restoreMemo(s, id('ค')).memos).map((m) => m.text).sort(), ['ก', 'ค', 'ง']);
  assert.equal(S.emptyOldTrash(s, NOW + 6 * 86_400_000), s);
  assert.equal(S.emptyOldTrash(s, NOW + 8 * 86_400_000).memos.length, 3);
});

test('cards are dealt to the shortest column, left to right', () => {
  const memos = [{ text: 'ก' }, { text: 'ข'.repeat(400) }, { text: 'ค' }, { text: 'ง' }, { text: 'จ' }];
  const cols = N.deal(memos, 2);
  assert.deepEqual(cols.map((c) => c.map((m) => m.text[0])), [['ก', 'ค', 'ง', 'จ'], ['ข']]);
  assert.deepEqual([320, 500, 800, 1000, 1400].map(N.columnsFor), [1, 2, 3, 4, 5]);
  assert.ok(N.cardHeight({ text: 'ก', images: [IMG] }) > N.cardHeight({ text: 'ก' }) + 100);
});

test('pictures and the sync repo: send, fetch, clean up', () => {
  const a = { id: 'aaaaaa1', w: 1, h: 1 };
  const b = { id: 'bbbbbb2', w: 1, h: 1, t: 'png' };
  const need = N.imagesOf([{ images: [a] }, { images: [b] }, {}]);
  assert.deepEqual([N.mediaPath(a), N.mediaPath(b)], ['media/aaaaaa1.jpg', 'media/bbbbbb2.png']);
  const plan = N.mediaPlan({ need, local: new Set(['aaaaaa1', 'zzzzzz9']), known: new Set(['cccccc3']) });
  assert.deepEqual([plan.upload, plan.download, plan.remove, plan.more], [[a], [b], ['cccccc3'], false]);
  // nothing to do once both sides have them
  const done = N.mediaPlan({ need, local: new Set(['aaaaaa1', 'bbbbbb2']), known: new Set(['aaaaaa1', 'bbbbbb2']) });
  assert.deepEqual([done.upload, done.download, done.remove], [[], [], []]);
  assert.deepEqual(N.fit(2400, 1600, 1600), { w: 1600, h: 1067 });
  assert.deepEqual(N.fit(300, 200, 1600), { w: 300, h: 200 });
});

test('sync keeps the new fields; binary files keep their bytes', () => {
  let a = S.addMemo(S.emptyState(), { text: 'ก', title: 'หัว', color: 'sky', labels: ['งาน'], images: [IMG], list: true }, NOW);
  a = Y.stamp(S.emptyState(), a, NOW);
  const back = S.sanitize(JSON.parse(Y.serialize(a)));
  assert.deepEqual(back.memos[0], a.memos[0]);
  const merged = Y.merge(a, Y.stamp(a, S.trashMemo(a, a.memos[0].id, NOW + 5), NOW + 5));
  assert.equal(merged.memos[0].trashedAt, NOW + 5);
  const bytes = new Uint8Array([0xff, 0xd8, 0, 1, 2, 250]);
  assert.deepEqual([...base64ToBytes(bytesToBase64(bytes))], [...bytes]);
  assert.equal(fromBase64(toBase64('แปะไว้')), 'แปะไว้');
});
