import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/lib/store.js';
import { cleanRepo, merge, pairCode, pairLink, readPairCode, sameData, serialize, shared, stamp } from '../src/lib/sync.js';

const T0 = new Date(2026, 10, 8, 10, 0).getTime();
const at = (min) => T0 + min * 60_000;

/** A device: every change goes through stamp(), like commit() in the app. */
function device(state = S.emptyState()) {
  return {
    state,
    do(fn, now) {
      this.state = stamp(this.state, fn(this.state), now);
      return this;
    },
  };
}
const texts = (st, list = 'tasks') => st[list].map((i) => i.text).sort();
const fromFile = (text) => S.sanitize(JSON.parse(text));

test('stamp: new, edited and removed items', () => {
  const a = device().do((s) => S.addTask(s, { text: 'โทรหาหมอ' }, at(0)), at(0));
  const id = a.state.tasks[0].id;
  assert.equal(a.state.tasks[0].updatedAt, at(0));
  a.do((s) => S.editTask(s, id, { text: 'โทรหาหมอฟัน' }), at(5));
  assert.equal(a.state.tasks[0].updatedAt, at(5));
  const same = a.state;
  a.do((s) => S.markAlerted(s, [id]), at(6)); // device-only flag: not a change
  assert.equal(a.state.tasks[0].updatedAt, at(5));
  a.do((s) => S.deleteTask(s, id), at(7));
  assert.equal(a.state.tomb[id], at(7));
  // undo brings it back, newer than the tombstone
  a.state = stamp(a.state, same, at(8));
  assert.equal(a.state.tomb[id], undefined);
  assert.equal(a.state.tasks[0].updatedAt, at(8));
  a.do((s) => S.setNote(s, '2026-11-08', 'สรุปประชุม'), at(9));
  assert.equal(a.state.notesAt['2026-11-08'], at(9));
  assert.equal(stamp(a.state, a.state, at(10)), a.state);
});

test('merge: two devices add, edit and delete without losing anything', () => {
  const tablet = device().do((s) => S.addTask(s, { text: 'ส่งรายงาน' }, at(0)), at(0));
  const file = serialize(tablet.state);
  const phone = device(merge(S.emptyState(), fromFile(file), at(1)));
  assert.deepEqual(texts(phone.state), ['ส่งรายงาน']);
  const id = phone.state.tasks[0].id;

  // offline on both: the phone edits and adds, the tablet adds a note and buys something
  phone.do((s) => S.editTask(s, id, { day: '2026-11-09', time: '09:00' }), at(10));
  phone.do((s) => S.addMoney(s, { text: 'กาแฟ', amount: 65, cat: 'อาหาร' }, at(11)), at(11));
  tablet.do((s) => S.addMemo(s, 'รหัส wifi abc', at(12)), at(12));
  tablet.do((s) => S.addShop(s, ['นม', 'ไข่'], at(13)), at(13));

  const a = merge(phone.state, tablet.state, at(20));
  const b = merge(tablet.state, phone.state, at(20));
  assert.ok(sameData(a, b), 'both devices end up with the same data');
  assert.deepEqual(a.tasks.map((t) => [t.text, t.day, t.time]), [['ส่งรายงาน', '2026-11-09', '09:00']]);
  assert.deepEqual(texts(a, 'memos'), ['รหัส wifi abc']);
  assert.deepEqual(texts(a, 'shop'), ['นม', 'ไข่']);
  assert.deepEqual(texts(a, 'money'), ['กาแฟ']);
  assert.equal(merge(a, b, at(21)), a, 'merging again changes nothing');

  // delete on one side beats an older edit on the other; a newer edit beats the delete
  const p = device(a);
  const t = device(b);
  const memo = a.memos[0].id;
  t.do((s) => S.editMemo(s, memo, 'รหัส wifi xyz', at(30)), at(30));
  p.do((s) => S.deleteMemo(s, memo), at(31));
  assert.deepEqual(merge(t.state, p.state, at(40)).memos, []);
  const shopId = a.shop[0].id;
  p.do((s) => S.deleteShop(s, shopId), at(32));
  t.do((s) => S.toggleShop(s, shopId, at(33)), at(33));
  assert.deepEqual(texts(merge(p.state, t.state, at(40)), 'shop'), ['นม', 'ไข่']);
});

test('merge: day notes, focus time and settings', () => {
  const a = device().do((s) => S.setNote(s, '2026-11-08', 'เช้า'), at(0));
  const b = device().do((s) => S.setNote(s, '2026-11-08', 'เช้า\nบ่าย'), at(5));
  b.state = { ...b.state, focusLog: { '2026-11-08': 25 * 60_000 } };
  a.state = { ...a.state, focusLog: { '2026-11-08': 10 * 60_000, '2026-11-07': 5 * 60_000 } };
  b.do((s) => ({ ...s, settings: { budget: 12000 } }), at(6));
  const m = merge(a.state, b.state, at(10));
  assert.equal(m.notes['2026-11-08'], 'เช้า\nบ่าย');
  assert.deepEqual(m.focusLog, { '2026-11-08': 25 * 60_000, '2026-11-07': 5 * 60_000 });
  assert.equal(m.settings.budget, 12000);
  // clearing a day's note on one device clears it everywhere
  a.state = m;
  a.do((s) => S.setNote(s, '2026-11-08', ''), at(20));
  assert.equal(merge(b.state, a.state, at(21)).notes['2026-11-08'], undefined);
});

test('merge: reminders that arrive from another device', () => {
  const now = at(60);
  const other = device()
    .do((s) => S.addTask(s, { text: 'ประชุม', day: '2026-11-08', time: '10:30' }, at(0)), at(0))
    .do((s) => S.addTask(s, { text: 'กินยา', day: '2026-11-08', time: '20:00' }, at(1)), at(1));
  const here = merge(S.emptyState(), other.state, now);
  // one already passed: no alert for it on this device; the later one still rings
  assert.deepEqual(here.tasks.map((t) => [t.text, t.alerted]), [['ประชุม', true], ['กินยา', false]]);
});

test('the file: stable, readable, and round-trips', () => {
  const d = device()
    .do((s) => S.addShop(s, ['นม'], at(2)), at(2))
    .do((s) => S.addTask(s, { text: 'ส่งรายงาน' }, at(1)), at(1))
    .do((s) => S.markAlerted(s, s.tasks.map((t) => t.id)), at(3));
  const text = serialize(d.state);
  assert.match(text, /^\{\n  "app": "paewai",/);
  assert.equal(text.split('\n').filter((l) => l.includes('"text":"ส่งรายงาน"')).length, 1, 'one item per line');
  assert.doesNotMatch(text, /alerted/);
  const back = fromFile(text);
  assert.deepEqual(shared(back), shared(d.state));
  // order on this device does not change the file
  const shuffled = { ...d.state, shop: [...d.state.shop].reverse(), tasks: [...d.state.tasks].reverse() };
  assert.equal(serialize(shuffled), text);
});

test('pairing codes and repository names', () => {
  const cfg = { repo: 'teelopnee/paewai-data', token: 'github_pat_11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyz' };
  const code = pairCode(cfg);
  assert.match(code, /^paewai1\.[A-Za-z0-9_-]+$/);
  assert.deepEqual(readPairCode(code), cfg);
  assert.deepEqual(readPairCode(`เปิดลิงก์นี้ ${pairLink(cfg)} นะ`), cfg);
  assert.equal(readPairCode('paewai1.bm90LWpzb24'), null);
  assert.equal(readPairCode('hello'), null);
  assert.equal(cleanRepo('https://github.com/teelopnee/paewai-data.git'), 'teelopnee/paewai-data');
  assert.equal(cleanRepo(' teelopnee/paewai-data/ '), 'teelopnee/paewai-data');
  assert.equal(cleanRepo('paewai-data'), null);
  assert.equal(cleanRepo('a/b/c'), null);
});

/** An in-memory stand-in for the GitHub contents API (same methods as lib/github.js). */
function fakeRepo() {
  const files = new Map();
  let n = 0;
  const sha = () => `sha${++n}`;
  const err = (status) => Object.assign(new Error(`HTTP ${status}`), { status });
  return {
    files,
    writes: 0,
    beforeWrite: null,
    async list(dir) {
      return [...files.entries()].filter(([p]) => p.startsWith(dir + '/')).map(([path, f]) => ({ name: path.slice(dir.length + 1), path, sha: f.sha, size: f.text.length }));
    },
    async read(path) {
      const f = files.get(path);
      return f ? { ...f } : null;
    },
    async write(path, text, s) {
      if (this.beforeWrite) {
        const hook = this.beforeWrite;
        this.beforeWrite = null;
        await hook();
      }
      const cur = files.get(path);
      if ((cur?.sha ?? null) !== (s ?? null)) throw err(cur ? 409 : 422);
      this.writes++;
      const f = { sha: sha(), text };
      files.set(path, f);
      return { sha: f.sha };
    },
    async remove(path, s) {
      const cur = files.get(path);
      if (!cur || cur.sha !== s) return false;
      files.delete(path);
      return true;
    },
    put(path, text) {
      files.set(path, { sha: sha(), text });
    },
  };
}

const { syncOnce, DATA_PATH } = await import('../src/lib/sync.js');
const { classify } = await import('../src/lib/sort.js');
const add = (st, line, now) => {
  const r = classify(line, now);
  if (r.kind === 'note') return S.addMemo(st, r.text, now);
  if (r.kind === 'shop') return S.addShop(st, r.items, now);
  if (r.kind === 'money') return S.addMoney(st, r, now);
  return S.addTask(st, r, now);
};
const sync = (gh, local, now, device) => syncOnce({ gh, local, add, readFile: S.sanitize, now, device });

test('syncOnce: two devices, the inbox, and a write race', async () => {
  const gh = fakeRepo();
  const tablet = device().do((s) => S.addTask(s, { text: 'ส่งรายงาน' }, at(0)), at(0));
  let r = await sync(gh, tablet.state, at(1), 'tablet');
  assert.equal(r.wrote, true);
  tablet.state = r.state;
  r = await sync(gh, tablet.state, at(2), 'tablet');
  assert.equal(r.wrote, false, 'nothing new: no commit');

  // Claude (or the iPhone shortcut) drops two lines into inbox/
  gh.put('inbox/20261108-101500.txt', 'พรุ่งนี้ 9 โมง โทรหาหมอ\n- ข้าวมันไก่ 50\n');
  gh.put('inbox/README.md', 'not an entry');
  const phone = device(S.emptyState()).do((s) => S.addMemo(s, 'รหัส wifi abc', at(3)), at(3));
  r = await sync(gh, phone.state, at(4), 'phone');
  assert.equal(r.inbox, 2);
  assert.deepEqual(texts(r.state), ['ส่งรายงาน', 'โทรหาหมอ']);
  assert.deepEqual(texts(r.state, 'money'), ['ข้าวมันไก่']);
  assert.ok(!gh.files.has('inbox/20261108-101500.txt') && gh.files.has('inbox/README.md'));
  phone.state = r.state;

  // the tablet edits while the phone's write lands first: the tablet retries with a merge
  tablet.do((s) => S.toggleDone(s, s.tasks[0].id, at(5)), at(5));
  phone.do((s) => S.addShop(s, ['นม'], at(6)), at(6));
  gh.beforeWrite = async () => {
    const p = await sync(gh, phone.state, at(7), 'phone');
    phone.state = p.state;
  };
  r = await sync(gh, tablet.state, at(8), 'tablet');
  tablet.state = r.state;
  phone.state = (await sync(gh, phone.state, at(9), 'phone')).state;
  assert.ok(sameData(tablet.state, phone.state));
  assert.deepEqual(texts(tablet.state, 'shop'), ['นม']);
  assert.equal(tablet.state.tasks.find((t) => t.text === 'ส่งรายงาน').done, true);
  assert.equal(gh.files.get(DATA_PATH).text, serialize(tablet.state));
});

test('syncOnce: a broken data file is never overwritten', async () => {
  const gh = fakeRepo();
  gh.put(DATA_PATH, '{ "tasks": [ oops');
  await assert.rejects(sync(gh, S.emptyState(), at(1), 'x'), /อ่านไม่ได้/);
  assert.equal(gh.files.get(DATA_PATH).text, '{ "tasks": [ oops');
});
