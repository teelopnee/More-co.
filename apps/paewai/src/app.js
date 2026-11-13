// แปะไว้ — the UI. State lives in lib/store.js, Thai dates in lib/dates.js.

import { addDays, dayKey, dayLabel, describeWhen, diffDays, fromKey, longDate, parseWhen, repeatLabel, shortDate, timeOf, toTimestamp } from './lib/dates.js';
import * as S from './lib/store.js';
import { MONEY_CATS, classify, findAmount, pastedLines } from './lib/sort.js';
import { icsFileName, taskToICS } from './lib/ics.js';
import * as Y from './lib/sync.js';
import { GitHubRepo, explain, isConflict } from './lib/github.js';
import * as C from './lib/claude.js';
import * as V from './lib/voice.js';
import * as Mm from './lib/mindmap.js';
import * as Sum from './lib/summarize.js';
import * as N from './lib/notes.js';
import * as T from './lib/thai.js';
import * as Ai from './lib/ai.js';
import { adopt, bytesOf, cachedUrl, media, prepare, urlFor } from './lib/media.js';
import { MapView } from './mapview.js';

const VERSION = 'dev';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const icon = (id) => `<svg aria-hidden="true"><use href="#${id}"/></svg>`;
const URL_RE = /https?:\/\/[^\s<>"']+/i;

// Inside the Android app (apps/paewai-notch) the page gets window.PaewaiAndroid, and the card
// that drops from the notch loads it with ?mode=panel.
const android = window.PaewaiAndroid ?? null;
const mode = new URLSearchParams(location.search).get('mode') ?? '';
document.documentElement.classList.toggle('android', !!android);
document.documentElement.classList.toggle('panel', mode === 'panel');
document.documentElement.dataset.view = 'tasks';
// iPhone / iPad (an iPad says it is a Mac, but has a touch screen)
const ios = /iP(?:hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
document.documentElement.classList.toggle('ios', ios);

// ---------------------------------------------------------------------------
// State

// Hours of transcripts outgrow localStorage (about 5 MB): the state then lives in IndexedDB, and
// localStorage only keeps the version number, so every window knows to read it from there.
const OVERFLOW_KEY = `${S.STORAGE_KEY}:idb`;
const overflowAtStart = readOverflowVersion();
let overflow = !!overflowAtStart; // saving to IndexedDB
let overflowVer = ''; // the IndexedDB version this window has
let storageReady = !overflow; // false until the IndexedDB copy is read: nothing is saved before
let lastLoaded = null;
let refreshing = null;
let writing = null;
let pendingJson = null;

function readOverflowVersion() {
  try {
    return localStorage.getItem(`${S.STORAGE_KEY}:idb`) || '';
  } catch {
    return '';
  }
}

const stateDb = (() => {
  let db = null;
  const open = () =>
    (db ??= new Promise((ok, no) => {
      const r = indexedDB.open('paewai-state', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => ok(r.result);
      r.onerror = () => no(r.error);
    }));
  const run = async (mode, fn) => {
    const d = await open();
    return new Promise((ok, no) => {
      const t = d.transaction('kv', mode);
      const req = fn(t.objectStore('kv'));
      t.oncomplete = () => ok(req?.result);
      t.onerror = t.onabort = () => no(t.error);
    });
  };
  return { get: () => run('readonly', (st) => st.get('state')), put: (json) => run('readwrite', (st) => st.put(json, 'state')) };
})();

let state = load();
let undoState = null;
let today = dayKey(new Date());
let view = 'tasks';
let noteDay = today;
let dropWhen = false; // the person tapped × on the parsed date
let editingId = null;
let engaged = false; // the person tapped or typed in the composer since it got focus
let installPrompt = null;

function load() {
  const ver = readOverflowVersion();
  if (ver) {
    // In IndexedDB (asynchronous): keep what this window has, and read the newer copy.
    overflow = true;
    if (ver !== overflowVer) refreshOverflow(ver);
    return lastLoaded ?? S.emptyState();
  }
  try {
    const raw = localStorage.getItem(S.STORAGE_KEY);
    if (raw) return (lastLoaded = S.sanitize(JSON.parse(raw)) ?? S.emptyState());
  } catch {
    // unreadable storage: start empty
  }
  return (lastLoaded = S.emptyState());
}

function refreshOverflow(ver) {
  refreshing ??= (async () => {
    try {
      const json = await stateDb.get();
      const next = json ? S.sanitize(JSON.parse(json)) : null;
      overflowVer = ver;
      if (next) {
        state = lastLoaded = next;
        if (typeof render === 'function' && storageReady) {
          render();
          syncNote();
        }
      }
    } catch {
      toast('อ่านข้อมูลในเครื่องไม่ได้ ลองปิดแล้วเปิดใหม่');
    } finally {
      refreshing = null;
      if (!storageReady) {
        storageReady = true;
        render();
        syncNote();
      }
    }
  })();
  return refreshing;
}

function writeOverflow(json) {
  pendingJson = json;
  if (writing) return;
  writing = (async () => {
    while (pendingJson) {
      const next = pendingJson;
      pendingJson = null;
      const ver = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      try {
        await stateDb.put(next);
        overflowVer = ver;
        try {
          localStorage.removeItem(S.STORAGE_KEY); // free the room it took
          localStorage.setItem(OVERFLOW_KEY, ver); // other windows: read it again
        } catch {
          // the version tells other windows; this one has it already
        }
      } catch {
        toast('บันทึกไม่ได้ ที่เก็บข้อมูลในเครื่องเต็มหรือถูกปิดไว้');
      }
    }
    writing = null;
  })();
}

function save({ sync = true } = {}) {
  if (!storageReady) return; // the IndexedDB copy is not read yet: do not write over it
  const json = JSON.stringify(state);
  lastLoaded = state;
  if (!overflow) {
    try {
      localStorage.setItem(S.STORAGE_KEY, json);
    } catch {
      // full (hours of transcripts): move to IndexedDB, which has room for much more
      overflow = true;
    }
  }
  if (overflow) writeOverflow(json);
  syncAndroid();
  if (sync) scheduleSync();
}

/** Tells the Android app what the notch pill shows and which alarms to set. */
function syncAndroid() {
  if (!android) return;
  const now = Date.now();
  const reminders = state.tasks
    .filter((t) => !t.done && t.day && t.time)
    .map((t) => ({ id: t.id, at: S.ringAt(t), title: `ถึงเวลา ${t.time} น.`, text: t.text }))
    .filter((r) => r.at > now);
  const f = state.focus;
  if (f?.endsAt) {
    reminders.push({ id: 'focus', at: f.endsAt, title: 'ครบเวลาโฟกัส', text: f.label || 'พักสายตาหน่อย' });
  }
  const summary = {
    openDays: state.tasks.filter((t) => !t.done && t.day).map((t) => t.day),
    focus: f ? { endsAt: f.endsAt ?? 0, leftMs: f.leftMs ?? 0, totalMs: f.totalMs } : null,
    reminders,
  };
  try {
    android.sync(JSON.stringify(summary));
  } catch {
    // the bridge is gone (page closing)
  }
}

/** Resolves once the last redraw is in the DOM (it may run inside a view transition). */
let rendered = Promise.resolve();
const calm = matchMedia('(prefers-reduced-motion: reduce)');

/**
 * Names the tasks that are on screen, so the view transition moves them. Tasks scrolled out of a
 * column stay unnamed: their snapshots would be drawn without the column's clipping.
 */
function nameVisible(on = true) {
  const top = Math.max(0, $('.dock').getBoundingClientRect().bottom);
  for (const li of $$('.task')) {
    li.style.viewTransitionName = '';
    if (!on || !/^[\w-]+$/.test(li.dataset.id)) continue;
    const r = li.getBoundingClientRect();
    if (!r.height) continue;
    const col = li.closest('.col');
    const head = col?.querySelector('.col-head')?.getBoundingClientRect();
    const box = col?.getBoundingClientRect();
    const from = Math.max(top, head && col.scrollHeight > col.clientHeight ? head.bottom : 0, 0);
    const to = Math.min(innerHeight, box && col.scrollHeight > col.clientHeight ? box.bottom : innerHeight);
    if (r.top >= from - 1 && r.bottom <= to + 1) li.style.viewTransitionName = `t-${li.dataset.id}`;
  }
}

let transitions = 0;

/** Runs a DOM update as a view transition: tasks glide to where they now belong. */
function animated(update) {
  if (!document.startViewTransition || calm.matches || document.visibilityState !== 'visible') {
    update();
    return Promise.resolve();
  }
  try {
    const n = ++transitions;
    nameVisible();
    const t = document.startViewTransition(() => {
      update();
      nameVisible();
    });
    t.ready.catch(() => {}); // skipped when another change starts first: fine
    t.finished.then(() => n === transitions && nameVisible(false), () => {});
    return t.updateCallbackDone.catch(() => {});
  } catch {
    update();
    return Promise.resolve();
  }
}

/**
 * Replace the state, save it, redraw. `undoable` keeps the old state for the toast's เลิกทำ;
 * `animate` moves the tasks smoothly instead of jumping.
 */
function commit(next, { undoable = false, redraw = true, animate = false } = {}) {
  if (next === state) return;
  if (undoable) undoState = state;
  state = Y.stamp(state, next);
  save();
  if (!redraw) return;
  if (animate) rendered = animated(render);
  else {
    render();
    rendered = Promise.resolve();
  }
}

function undo() {
  if (!undoState) return;
  state = Y.stamp(state, undoState);
  undoState = null;
  save();
  rendered = animated(render);
  syncNote();
}

/** A short tick on devices that can vibrate. */
function buzz(ms = 8) {
  // Browsers refuse (and log) a vibration before the first tap.
  if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
  try {
    navigator.vibrate?.(ms);
  } catch {
    // not allowed here
  }
}

// ---------------------------------------------------------------------------
// Rendering

function render() {
  today = dayKey(new Date());
  $('#today-label').textContent = shortDate(today);
  renderHero();
  renderTasks();
  renderShop();
  renderNotes();
  renderNoteHead();
  renderMoney();
  renderFocus();
  if (recview?.open) renderRecView();
  if (mapDialog?.open && mapView && !mapView.editing?.isConnected) {
    const m = state.maps.find((x) => x.id === mapId);
    if (!m) mapDialog.close();
    else if (m !== mapView.map) mapView.set(m);
  }
  // Android app: the banner stays until notch access is on. Web: until dismissed.
  $('#setup-banner').hidden = android ? notchOn() : !!state.prefs.guideDone;
}

/** Minutes from now until a task's time today (negative = already past). */
function minutesUntil(t) {
  return Math.round((toTimestamp(t.day, t.time) - Date.now()) / 60_000);
}

function inWords(mins) {
  const m = Math.abs(mins);
  if (m < 1) return 'ตอนนี้';
  if (m < 60) return `${m} นาที`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h} ชม. ${m % 60} นาที` : `${h} ชม.`;
}

function taskItem(t, { withDay = false } = {}) {
  const overdue = !t.done && t.day && t.day < today;
  const timedToday = !t.done && t.day === today && t.time;
  const mins = timedToday ? minutesUntil(t) : null;
  const badges = [];
  if (withDay && t.day) {
    const away = diffDays(today, t.day);
    badges.push(`<span class="badge">${icon('i-cal')}${esc(describeWhen(t.day, t.time, today))}${away > 6 ? ` · อีก ${away} วัน` : ''}</span>`);
  } else if (t.time) {
    const tone = mins == null ? '' : mins <= 0 ? ' late' : mins <= 60 ? ' soon' : '';
    badges.push(`<span class="badge time${tone}">${icon('i-clock')}${esc(t.time)}</span>`);
  }
  if (overdue) {
    const label = dayLabel(t.day, today);
    badges.push(`<span class="badge late">${label === 'เมื่อวาน' ? 'ค้างจากเมื่อวาน' : `ค้างจาก ${esc(label)}`}</span>`);
  }
  if (t.snoozeAt && !t.done && t.snoozeAt > Date.now()) badges.push(`<span class="badge soon">${icon('i-clock')}เลื่อนถึง ${esc(timeOf(new Date(t.snoozeAt)))}</span>`);
  if (t.repeat) badges.push(`<span class="badge rep">${icon('i-repeat')}${esc(repeatLabel(t.repeat))}${t.streak > 1 ? ` · ทำแล้ว ${t.streak} ครั้ง` : ''}</span>`);
  if (URL_RE.test(t.text)) badges.push(`<span class="badge">${icon('i-link')}ลิงก์</span>`);
  const later = !t.day || t.day < today ? 'วันนี้' : 'วันถัดไป';
  return `<li class="task${t.done ? ' done' : ''}" data-id="${esc(t.id)}">
<div class="swipe" aria-hidden="true"><span class="s-done">${icon('i-check')}${t.done ? 'ยังไม่เสร็จ' : 'เสร็จ'}</span><span class="s-later">${later}${icon('i-arrow')}</span></div>
<div class="row">
<button type="button" class="check" data-action="toggle" role="checkbox" aria-checked="${t.done}" aria-label="เสร็จแล้ว: ${esc(t.text)}">${icon('i-check')}</button>
<button type="button" class="body" data-action="open"><span class="text">${esc(t.text)}</span>${badges.length ? `<span class="meta">${badges.join('')}</span>` : ''}</button>
</div>
</li>`;
}

const VIEW_NAMES = { tasks: 'งาน', notes: 'โน้ต', money: 'เงิน', focus: 'โฟกัส' };
const baht = (n) => `฿${Number(n).toLocaleString('th-TH', { maximumFractionDigits: 2 })}`;

function greeting() {
  const hour = new Date().getHours();
  return hour < 5 ? 'ดึกแล้ว พักผ่อนบ้างนะ' : hour < 11 ? 'อรุณสวัสดิ์' : hour < 13 ? 'สวัสดีตอนเที่ยง' : hour < 17 ? 'สวัสดีตอนบ่าย' : hour < 21 ? 'สวัสดีตอนเย็น' : 'ดึกแล้ว พักผ่อนบ้างนะ';
}

/**
 * The extended app bar's dynamic title (One UI): what is left today and a Now Bar-style capsule
 * for what comes next. The notes and focus pages get their own title.
 */
function renderHero() {
  $('#bar-title').textContent = mode === 'panel' ? 'แปะไว้' : VIEW_NAMES[view];
  if (view === 'notes') {
    $('#hero-title').textContent = 'โน้ต';
    $('#hero-greet').textContent = `${S.sortedMemos(state).length ? `${S.sortedMemos(state).length} โน้ต · ` : ''}บันทึก${noteDay === today ? `วันนี้ · ${shortDate(today)}` : longDate(noteDay)}`;
    $('#hero-sub').innerHTML = '';
    return;
  }
  if (view === 'money') {
    const m = S.moneySummary(state, today);
    $('#hero-title').textContent = m.today ? `วันนี้ใช้ไป ${baht(m.today)}` : 'วันนี้ยังไม่ได้ใช้เงิน';
    const b = S.budgetStatus(state, today);
    $('#hero-greet').textContent = `7 วัน ${baht(m.weekTotal)} · เดือนนี้ ${baht(m.month)}${b ? ` · ${b.left >= 0 ? `เหลืองบ ${baht(b.left)}` : `เกินงบ ${baht(-b.left)}`}` : ''}`;
    $('#hero-sub').innerHTML = '';
    return;
  }
  if (view === 'focus') {
    const st = S.stats(state, today, Date.now());
    $('#hero-title').textContent = 'โฟกัส';
    $('#hero-greet').textContent = st.focusTodayMs >= 60_000 ? `วันนี้โฟกัสไปแล้ว ${inWords(Math.round(st.focusTodayMs / 60_000))}` : 'ตั้งเวลาแล้วทำทีละเรื่อง';
    $('#hero-sub').innerHTML = '';
    return;
  }
  const v = S.taskViews(state, today, 0);
  const list = v.today;
  const open = openCount(list);
  const done = list.length - open;
  $('#hero-title').textContent = !list.length ? 'วันนี้ยังว่าง' : open ? `วันนี้เหลือ ${open} เรื่อง` : 'วันนี้เคลียร์หมดแล้ว';
  const spent = S.moneySummary(state, today).today;
  $('#hero-greet').textContent = `${greeting()} · ${shortDate(today)}${list.length ? ` · เสร็จ ${done}/${list.length}` : ''}${spent ? ` · ใช้ไป ${baht(spent)}` : ''}`;

  const timed = list.filter((t) => !t.done && t.time && t.day === today).sort((a, b) => a.time.localeCompare(b.time));
  const next = timed.find((t) => minutesUntil(t) >= 0);
  const missed = timed.filter((t) => minutesUntil(t) < 0).at(-1);
  const inboxOpen = openCount(v.inbox);
  const capsule = (cls, when, what, after) =>
    `<span class="next${cls}"><span class="nb-dot">${icon('i-clock')}</span><span class="when">${esc(when)}</span><span class="what">${esc(what)}</span>${after ? `<span class="in">${esc(after)}</span>` : ''}</span>`;
  let sub = '';
  if (next) {
    const mins = minutesUntil(next);
    sub = capsule(mins <= 30 ? ' soon' : '', next.time, next.text, `อีก ${inWords(mins)}`);
  } else if (missed) {
    sub = capsule(' late', missed.time, missed.text, 'เลยเวลาแล้ว');
  } else if (v.overdue) {
    sub = `ค้างจากวันก่อน ${v.overdue} เรื่อง`;
  } else if (inboxOpen) {
    sub = `ในกล่องรับมี ${inboxOpen} เรื่องรอจัดวัน`;
  } else if (!list.length) {
    sub = 'นึกอะไรออกก็แปะไว้ก่อน แล้วค่อยจัดทีหลัง';
  }
  $('#hero-sub').innerHTML = sub;
}

const WEEKDAYS_SHORT = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];

const openCount = (list) => list.filter((t) => !t.done).length;
const countLabel = (n) => (n ? String(n) : '');

function renderTasks() {
  const v = S.taskViews(state, today, 6);

  const inbox = $('#col-inbox');
  $('.count', inbox).textContent = countLabel(openCount(v.inbox));
  $('.list', inbox).innerHTML = v.inbox.map((t) => taskItem(t)).join('');

  const col = $('#col-today');
  $('.count', col).textContent = countLabel(openCount(v.today));
  $('#today-sub').textContent = shortDate(today);
  $('.list', col).innerHTML = v.today.map((t) => taskItem(t)).join('');
  const carry = $('.carry', col);
  carry.hidden = v.overdue === 0;
  carry.textContent = `ยก ${v.overdue} เรื่องที่ค้างมาเป็นของวันนี้`;

  const ahead = $('#col-ahead');
  const aheadOpen = v.ahead.reduce((n, g) => n + openCount(g.tasks), 0) + v.later.length;
  $('.count', ahead).textContent = countLabel(aheadOpen);
  // Week strip (Samsung Calendar style): today + 6 days, a dot per task.
  const week = [{ day: today, tasks: v.today.filter((t) => t.day === today) }, ...v.ahead];
  $('#week').innerHTML = week
    .map(({ day, tasks }) => {
      const d = fromKey(day);
      const dots = tasks.slice(0, 3).map((t) => `<i${t.done ? ' class="done"' : ''}></i>`).join('');
      const cls = `${day === today ? 'is-today' : ''}${d.getDay() === 0 ? ' sun' : ''}`;
      return `<button type="button" role="listitem" class="${cls}" data-day="${day}" aria-label="${esc(shortDate(day, today))} ${tasks.length} เรื่อง"><span class="wd">${WEEKDAYS_SHORT[d.getDay()]}</span><span class="dn">${d.getDate()}</span><span class="dots">${dots}</span></button>`;
    })
    .join('');
  const days = v.ahead
    .filter((g) => g.tasks.length)
    .map((g) => {
      const label = dayLabel(g.day, today);
      const date = shortDate(g.day, today);
      return `<section class="day" id="day-${g.day}"><h3>${esc(label)}${label === date ? '' : ` <span class="dn2">${esc(date)}</span>`}</h3><ul class="list">${g.tasks.map((t) => taskItem(t)).join('')}</ul></section>`;
    });
  if (v.later.length) {
    days.push(`<section class="day"><h3>หลังจากนั้น</h3><ul class="list">${v.later.map((t) => taskItem(t, { withDay: true })).join('')}</ul></section>`);
  }
  $('.ahead', ahead).innerHTML = days.length ? days.join('') : '<p class="ahead-empty">ยังไม่มีอะไรในสัปดาห์นี้ แตะวันด้านบนเพื่อแปะลงวันนั้น</p>';
}

function flash(id, cls = 'flash', scroll = true) {
  rendered.then(() =>
    requestAnimationFrame(() => {
      const el = document.querySelector(`.task[data-id="${CSS.escape(id)}"]`);
      if (!el) return;
      el.classList.add(cls);
      if (scroll) el.scrollIntoView({ block: 'nearest', behavior: calm.matches ? 'auto' : 'smooth' });
      setTimeout(() => el.classList.remove(cls), 1400);
    }),
  );
}

// ---------------------------------------------------------------------------
// Capture bar

const input = $('#capture-input');
const hint = $('#capture-hint');
const QUICK_DAYS = ['วันนี้', 'เย็นนี้', 'พรุ่งนี้', 'สุดสัปดาห์', 'สัปดาห์หน้า'];
const quickChips = () => QUICK_DAYS.map((d) => `<button type="button" class="chip" data-chip="${d}">${d}</button>`).join('');

const KIND_ICON = { task: 'i-tasks', note: 'i-note', shop: 'i-cart', money: 'i-money' };
const KIND_ORDER = ['task', 'note', 'shop', 'money'];
let forceKind = null; // the person tapped the kind chip to choose
let choiceFor = ''; // the text those choices (kind, no date) were made for

function captureSort(text) {
  return classify(text, Date.now(), { force: forceKind, noDate: dropWhen });
}

function kindLabel(r) {
  if (r.kind === 'task') return r.day ? (r.repeat ? `เตือน${repeatLabel(r.repeat)}` : 'เตือน') : 'งาน';
  if (r.kind === 'note') return 'โน้ต';
  if (r.kind === 'shop') return r.items.length > 1 ? `ซื้อ ${r.items.length} อย่าง` : 'ของต้องซื้อ';
  return r.amount ? `${baht(r.amount)} · ${r.cat}` : 'รายจ่าย · ใส่จำนวนเงิน';
}

/** Under the composer: what it will become (tap to change), the date, and the cleaned text. */
function updateHint() {
  const text = input.value;
  if (!text.trim()) {
    dropWhen = false;
    forceKind = null;
    hint.dataset.sig = '';
    // Day chips only while the person is using the composer: otherwise they sit over the page.
    if (document.activeElement !== input || !engaged) hint.innerHTML = '';
    else if (!hint.querySelector('.chip') || hint.querySelector('.kind-chip')) hint.innerHTML = `<span class="chip-label">ใส่วัน</span>${quickChips()}`;
    return;
  }
  // A choice holds while the text is only extended or trimmed, not when it is replaced.
  if ((forceKind || dropWhen) && !(text.startsWith(choiceFor) || choiceFor.startsWith(text))) {
    forceKind = null;
    dropWhen = false;
  }
  choiceFor = forceKind || dropWhen ? text : '';
  const r = captureSort(text);
  const when = r.kind === 'task' && r.day ? describeWhen(r.day, r.time, today) : '';
  const what = r.kind === 'shop' && r.items.length > 1 ? r.items.map((i) => i.text).join(' · ') : r.text;
  const sig = `${r.kind}|${kindLabel(r)}|${when}|${dropWhen}`;
  // Keep the chips (and their pop-in) while only the text after them changes.
  if (hint.dataset.sig === sig) {
    const parsed = hint.querySelector('.parsed');
    if (parsed) parsed.textContent = what;
    return;
  }
  hint.dataset.sig = sig;
  const tone = r.kind === 'task' && r.day ? 'remind' : r.kind;
  hint.innerHTML =
    `<button type="button" class="kind-chip k-${tone}" data-action="cycle-kind" title="${esc(r.why)}" aria-label="เป็น${esc(kindLabel(r))} (${esc(r.why)}) แตะเพื่อเปลี่ยน">${icon(r.kind === 'task' && r.day ? 'i-clock' : KIND_ICON[r.kind])}<span>${esc(kindLabel(r))}</span></button>` +
    (when ? `<span class="when-chip">${icon('i-cal')}${esc(when)}<button type="button" data-action="drop-when" aria-label="ไม่ใส่วันเวลา">${icon('i-close')}</button></span>` : '') +
    `<span class="dim parsed">${esc(what)}</span>` +
    (r.kind === 'task' && !r.day && !dropWhen ? quickChips() : '');
}

/** Puts one sorted entry where it belongs. Pure: returns the next state. */
function route(st, r, now = Date.now()) {
  if (r.kind === 'note') return S.addMemo(st, N.extractLabels(r.text), now);
  if (r.kind === 'shop') return S.addShop(st, r.items.length ? r.items : [r.text], now);
  if (r.kind === 'money') return r.amount ? S.addMoney(st, r, now) : S.addMemo(st, r.text, now);
  return S.addTask(st, r, now);
}

/** Sorts and saves what was typed or shared; returns what to tell the person. */
function capture(text, { shared = false } = {}) {
  if (shared && V.looksLikeTranscript(text)) {
    // A transcript (Samsung Voice Recorder's "share text") or long notes: keep it whole, ready for a summary.
    const now = Date.now();
    // a heading line names it; a speaker label ("ผู้พูด 1 (00:00)") does not, the summary will
    const first = text.trim().split(/\n/)[0].replace(/^#+\s*/, '').trim();
    const label = /^(?:ผู้พูด|speaker|ผู้บรรยาย)?\s*\d*\s*\(?\d{1,2}:\d{2}/i.test(first) || /^(?:ผู้พูด|speaker)\s*\d+\s*:?$/i.test(first);
    const title = !label && first.length > 4 && first.length <= 60 ? first : `ข้อความที่แชร์มา ${shortDate(dayKey(new Date(now)))} ${timeOf(new Date(now))}`;
    const id = S.uid(now);
    commit(withSummary(S.addRec(state, { id, at: now, title, parts: 0, durationMs: 0, origin: 'share', transcript: T.tidy(text.trim(), [], { walls: false }).text, device: deviceName() }), id), { undoable: true });
    setTimeout(() => openRec(id, 'sum'), 50);
    return { kind: 'rec', msg: 'เก็บเป็นบันทึกพร้อมสรุปแล้ว' };
  }
  const r = shared ? classify(text, Date.now()) : captureSort(text);
  if (r.kind === 'money' && !r.amount) return { error: 'ใส่จำนวนเงินด้วย เช่น “ข้าวมันไก่ 50”' };
  const next = route(state, r);
  if (next === state) return null;
  commit(next, { undoable: true, animate: true });
  persistOnce();
  if (r.kind === 'note') return { kind: 'note', msg: 'เก็บเป็นโน้ตแล้ว' };
  if (r.kind === 'shop') return { kind: 'shop', msg: r.items.length > 1 ? `เพิ่ม ${r.items.length} อย่างในของต้องซื้อ` : 'เพิ่มในของต้องซื้อแล้ว' };
  if (r.kind === 'money') return { kind: 'money', msg: `จดรายจ่าย ${baht(r.amount)} · ${r.cat}` };
  const where = r.day ? `${describeWhen(r.day, r.time, today)}${r.repeat ? ` · ${repeatLabel(r.repeat)}` : ''}` : 'กล่องรับ';
  return { kind: 'task', id: next.tasks.at(-1).id, msg: `แปะไว้ที่${r.day ? ' ' : ''}${where}แล้ว` };
}

$('#capture').addEventListener('submit', (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text) {
    input.focus();
    return;
  }
  const res = capture(text);
  if (res?.error) {
    toast(res.error);
    input.focus();
    return;
  }
  input.value = '';
  dropWhen = false;
  forceKind = null;
  updateHint();
  input.focus();
  if (!res) return;
  toast(res.msg, { label: 'เลิกทำ', run: undo });
  if (res.kind === 'task' && view === 'tasks') flash(res.id);
});

input.addEventListener('input', updateHint);

// The on-screen keyboard is up when the window got much shorter while typing (not when a hardware
// keyboard or a pop-up window is used): only then hide the tabs so the composer sits on it.
let fullHeight = innerHeight;
addEventListener('resize', () => {
  const typing = document.activeElement === input;
  if (!typing) fullHeight = innerHeight;
  document.body.classList.toggle('kb', typing && innerHeight < fullHeight - 150);
});
input.addEventListener('focus', () => {
  fullHeight = Math.max(fullHeight, innerHeight);
  updateHint();
});
input.addEventListener('blur', () => {
  document.body.classList.remove('kb');
  setTimeout(() => {
    if (document.activeElement === input) return;
    engaged = false;
    updateHint();
  }, 250);
});
// The page focuses the composer on its own (for hardware keyboards); the day chips wait for a tap or a key.
for (const type of ['pointerdown', 'keydown']) {
  input.addEventListener(type, () => {
    if (engaged) return;
    engaged = true;
    queueMicrotask(updateHint);
  });
}
// Tapping a chip keeps the typing focus (and the on-screen keyboard) in the composer.
hint.addEventListener('mousedown', (e) => e.target.closest('button') && e.preventDefault());
input.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (input.value) {
    e.preventDefault();
    input.value = '';
    updateHint();
  } else if (android && mode === 'panel') {
    android.close();
  }
});

// Several lines pasted at once = several things, each sorted on its own.
input.addEventListener('paste', (e) => {
  const pics = pastedImages(e);
  if (pics.length) {
    // a copied picture or screenshot becomes a note with it
    e.preventDefault();
    noteFromImages(pics, { text: input.value.trim() }).then((ok) => {
      if (!ok) return;
      input.value = '';
      updateHint();
    });
    return;
  }
  const text = e.clipboardData?.getData('text/plain') ?? '';
  if (C.isAnswer(text)) {
    // an answer copied from Claude: read it in the Claude sheet (its job, if one is waiting)
    e.preventDefault();
    const p = C.readPasted(text);
    const job = claudeJob.kind !== 'ask' && (p.summary || p.outline) ? claudeJob : { kind: 'ask' };
    openClaude('', { job, pasted: text });
    return;
  }
  const lines = pastedLines(text);
  if (lines.length < 2) return;
  e.preventDefault();
  let next = state;
  const now = Date.now();
  lines.forEach((line, i) => (next = route(next, classify(line, now), now + i)));
  commit(next, { undoable: true, animate: true });
  toast(`แปะ ${lines.length} เรื่องแล้ว จัดให้ตามประเภท`, { label: 'เลิกทำ', run: undo });
});

hint.addEventListener('click', (e) => {
  if (e.target.closest('[data-action="cycle-kind"]')) {
    // task → note → shop → money (money only when there is an amount)
    const current = captureSort(input.value).kind;
    let next = KIND_ORDER[(KIND_ORDER.indexOf(current) + 1) % KIND_ORDER.length];
    if (next === 'money' && !findAmount(input.value)) next = 'task';
    forceKind = next;
    choiceFor = input.value;
    updateHint();
    input.focus();
    buzz(5);
    return;
  }
  const chip = e.target.closest('[data-chip]')?.dataset.chip;
  if (chip) {
    const text = input.value.trim();
    input.value = text ? `${text} ${chip}` : `${chip} `;
    dropWhen = false;
    updateHint();
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
    buzz(5);
    return;
  }
  if (!e.target.closest('[data-action="drop-when"]')) return;
  dropWhen = true;
  choiceFor = input.value;
  hint.dataset.sig = '';
  updateHint();
  input.focus();
});

// Voice input (Chrome on Android; hidden where the browser has no speech recognition).
const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
const mic = $('#mic-btn');
let recognition = null;
if (Speech) {
  mic.hidden = false;
  mic.addEventListener('click', () => {
    if (recognition) {
      recognition.stop();
      return;
    }
    const base = input.value.trim() ? `${input.value.trim()} ` : '';
    recognition = new Speech();
    recognition.lang = 'th-TH';
    recognition.interimResults = true;
    recognition.onresult = (e) => {
      input.value = base + [...e.results].map((r) => r[0].transcript).join('');
      updateHint();
    };
    recognition.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') toast('ยังไม่ได้อนุญาตให้ใช้ไมโครโฟน');
      else if (e.error === 'network') toast('พูดแทนพิมพ์ต้องต่ออินเทอร์เน็ต');
    };
    recognition.onend = () => {
      recognition = null;
      mic.classList.remove('on');
      mic.setAttribute('aria-label', 'พูดแทนพิมพ์');
      input.focus();
    };
    try {
      recognition.start();
      mic.classList.add('on');
      mic.setAttribute('aria-label', 'หยุดฟัง');
    } catch {
      recognition = null;
    }
  });
}

// ---------------------------------------------------------------------------
// Tabs

function setView(next) {
  view = next;
  document.documentElement.dataset.view = next;
  for (const tab of $$('.tabs [role="tab"]')) tab.setAttribute('aria-selected', String(tab.dataset.view === next));
  for (const id of ['tasks', 'notes', 'money', 'focus']) $(`#view-${id}`).hidden = id !== next;
  moveInk();
  renderHero();
  renderFocus();
  if (innerWidth < 840) scrollTo({ top: 0 });
  if (next === 'notes') {
    syncNote();
    renderNotes();
  }
  if (next === 'money') renderMoney();
  if (next === 'focus') renderFocus();
}

/** Slides the white pill under the selected tab. */
function moveInk() {
  const tabs = $('.tabs');
  const tab = $('.tabs [aria-selected="true"]');
  const ink = $('#tab-ink');
  if (!tab || !tabs.offsetWidth) return;
  ink.style.width = `${tab.offsetWidth}px`;
  ink.style.height = `${tab.offsetHeight}px`;
  ink.style.transform = `translate(${tab.offsetLeft}px, ${tab.offsetTop}px)`;
  tabs.classList.add('ready');
}
addEventListener('resize', moveInk);

$('.tabs').addEventListener('click', (e) => {
  const tab = e.target.closest('[data-view]');
  if (tab) setView(tab.dataset.view);
});

// ---------------------------------------------------------------------------
// Task list actions

function onListClick(e) {
  const action = e.target.closest('[data-action]')?.dataset.action;
  if (!action) return;
  const id = e.target.closest('.task')?.dataset.id;
  const shopId = e.target.closest('[data-shop]')?.dataset.shop;
  if (swallowClick) {
    swallowClick = false;
    return;
  }
  if (action === 'shop-toggle' && shopId) {
    const was = state.shop.find((i) => i.id === shopId)?.done;
    commit(S.toggleShop(state, shopId), { undoable: true, animate: true });
    if (!was) buzz(10);
  } else if (action === 'shop-open' && shopId) {
    openItem('shop', shopId);
  } else if (action === 'clear-bought') {
    commit(S.clearBought(state), { undoable: true, animate: true });
    toast('ล้างของที่ซื้อแล้ว', { label: 'เลิกทำ', run: undo });
  } else if (action === 'toggle' && id) {
    toggle(id);
  } else if (action === 'open' && id) {
    openTask(id);
  } else if (action === 'carry') {
    commit(S.carryOver(state, today), { undoable: true, animate: true });
    toast('ยกมาเป็นของวันนี้แล้ว', { label: 'เลิกทำ', run: undo });
  } else if (action === 'guide') {
    refreshMenu();
    $('#guide-dialog').showModal();
  } else if (action === 'dismiss-banner') {
    commit({ ...state, prefs: { ...state.prefs, guideDone: true } });
  }
}
$('#view-tasks').addEventListener('click', onListClick);
$('#search-results').addEventListener('click', onListClick);

/** Tick a task off (or back on) with a little pop. */
function toggle(id) {
  const wasDone = state.tasks.find((t) => t.id === id)?.done;
  commit(S.toggleDone(state, id), { undoable: true, animate: true });
  if (!wasDone) {
    buzz(12);
    flash(id, 'pop', false);
  }
}

/** Left swipe: inbox → today, today or later → the next day (time kept). */
function postpone(id) {
  const t = state.tasks.find((x) => x.id === id);
  if (!t) return;
  const day = !t.day || t.day < today ? today : addDays(t.day, 1);
  commit(S.editTask(state, id, { day, time: t.time }), { undoable: true, animate: true });
  toast(`เลื่อนไป${describeWhen(day, null, today)}แล้ว`, { label: 'เลิกทำ', run: undo });
}

// Swipe a task: right = done, left = postpone. Vertical drags keep scrolling (touch-action: pan-y).
let swipe = null;
let swallowClick = false;
const SWIPE_AT = 88;
const board = $('#board');

board.addEventListener('pointerdown', (e) => {
  const row = e.target.closest('.task[data-id] .row');
  if (!row || e.button > 0) return;
  swipe = { row, li: row.parentElement, x0: e.clientX, y0: e.clientY, dx: 0, on: false, pointer: e.pointerId };
});

board.addEventListener('pointermove', (e) => {
  if (!swipe || e.pointerId !== swipe.pointer) return;
  const dx = e.clientX - swipe.x0;
  const dy = e.clientY - swipe.y0;
  if (!swipe.on) {
    if (Math.abs(dy) > 14 && Math.abs(dy) > Math.abs(dx)) {
      swipe = null;
      return;
    }
    if (Math.abs(dx) < 14 || Math.abs(dx) < Math.abs(dy) * 1.3) return;
    swipe.on = true;
    swipe.row.setPointerCapture?.(e.pointerId);
    swipe.li.classList.add('swiping');
  }
  // Resist past the threshold so it feels elastic.
  const over = Math.max(0, Math.abs(dx) - SWIPE_AT);
  const shown = Math.sign(dx) * (Math.min(Math.abs(dx), SWIPE_AT) + over * 0.35);
  swipe.dx = dx;
  swipe.row.style.transform = `translateX(${shown}px)`;
  swipe.li.dataset.dir = dx > 0 ? 'right' : 'left';
  const armed = Math.abs(dx) >= SWIPE_AT;
  if (armed !== swipe.li.classList.contains('armed')) {
    swipe.li.classList.toggle('armed', armed);
    if (armed) buzz(6);
  }
});

function endSwipe(e) {
  if (!swipe || (e && e.pointerId !== swipe.pointer)) return;
  const { row, li, dx, on } = swipe;
  swipe = null;
  if (!on) return;
  swallowClick = true;
  setTimeout(() => (swallowClick = false), 350);
  const id = li.dataset.id;
  if (Math.abs(dx) >= SWIPE_AT && e?.type !== 'pointercancel') {
    row.style.transform = `translateX(${dx > 0 ? 110 : -110}%)`;
    if (!state.prefs.swipeTipSeen) {
      state = { ...state, prefs: { ...state.prefs, swipeTipSeen: true } };
      $('#swipe-tip').hidden = true;
    }
    setTimeout(() => (dx > 0 ? toggle(id) : postpone(id)), 160);
  } else {
    row.style.transform = '';
    li.classList.remove('armed');
    setTimeout(() => li.classList.remove('swiping'), 320);
  }
}
board.addEventListener('pointerup', endSwipe);
board.addEventListener('pointercancel', endSwipe);

$('#week').addEventListener('click', (e) => {
  const day = e.target.closest('[data-day]')?.dataset.day;
  if (!day) return;
  const target = day === today ? $('#col-today') : document.getElementById(`day-${day}`);
  if (target) {
    target.scrollIntoView({ behavior: calm.matches ? 'auto' : 'smooth', block: 'start' });
    return;
  }
  const [, m, d] = day.split('-').map(Number);
  const text = input.value.trim().replace(/\s*\d{1,2}\/\d{1,2}$/, '');
  input.value = `${text ? `${text} ` : ''}${d}/${m}`;
  if (!text) input.value += ' ';
  dropWhen = false;
  updateHint();
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
});

// ---------------------------------------------------------------------------
// Shopping list, quick notes, search, money

function shopItem(i) {
  return `<li class="task shop-item${i.done ? ' done' : ''}" data-shop="${esc(i.id)}"><div class="row">
<button type="button" class="check" data-action="shop-toggle" role="checkbox" aria-checked="${i.done}" aria-label="ซื้อแล้ว: ${esc(i.text)}">${icon('i-check')}</button>
<button type="button" class="body" data-action="shop-open"><span class="text">${esc(i.text)}</span></button></div></li>`;
}

function renderShop() {
  const g = S.shopGroups(state);
  $('#shop-block').hidden = !state.shop.length;
  $('#shop-count').textContent = countLabel(g.open);
  $('#clear-bought').hidden = !g.bought.length;
  $('#shop-list').innerHTML =
    (g.groups.length ? `<ul class="list shop-list">${g.groups.map(({ cat, items }) => `<li class="shop-cat">${esc(cat)}</li>${items.map(shopItem).join('')}`).join('')}</ul>` : '') +
    (g.bought.length ? `<ul class="list shop-list bought"><li class="shop-cat">ใส่ตะกร้าแล้ว</li>${g.bought.map(shopItem).join('')}</ul>` : '');
}

function ago(ms) {
  const mins = Math.round((Date.now() - ms) / 60_000);
  if (mins < 1) return 'เมื่อสักครู่';
  if (mins < 60) return `${mins} นาทีที่แล้ว`;
  const day = dayKey(new Date(ms));
  if (day === today) return `วันนี้ ${timeOf(new Date(ms))}`;
  return dayLabel(day, today);
}

// ---- the notes board (lib/notes.js): cards with pictures, colours and labels ----

let noteSeg = 'all'; // which part of the notes page shows: all | notes | recs | maps | journal
let noteFilter = 'all'; // all | images | lists | archive | trash
let noteLabel = '';
let boardCols = 0;

const imgTag = (id) => {
  const url = cachedUrl(id);
  return `<img data-img="${esc(id)}" alt="" decoding="async"${url ? ` src="${url}" class="ready"` : ''}>`;
};

/** Fills in the pictures of freshly drawn cards (they are read from the device's storage). */
function hydrateImages(root) {
  for (const img of $$('img[data-img]:not([src])', root)) {
    const id = img.dataset.img;
    urlFor(id)
      .then((url) => {
        if (!img.isConnected) return;
        if (url) {
          img.src = url;
          img.classList.add('ready');
        } else {
          img.closest('.ph')?.classList.add('away');
          wantMedia();
        }
      })
      .catch(() => img.closest('.ph')?.classList.add('away'));
  }
}

function noteCard(m) {
  const imgs = m.images ?? [];
  const shown = imgs.slice(0, 4);
  const pics = shown.length
    ? `<div class="nc-imgs n${shown.length}">${shown
        .map((im, i) => `<span class="ph"${shown.length === 1 && im.w && im.h ? ` style="aspect-ratio:${im.w}/${im.h}"` : ''}>${imgTag(im.id)}${i === 3 && imgs.length > 4 ? `<span class="nc-more">+${imgs.length - 4}</span>` : ''}</span>`)
        .join('')}</div>`
    : '';
  let body = '';
  if (m.list) {
    const items = N.listItems(m.text).map((it, i) => ({ ...it, i }));
    const open = items.filter((it) => !it.done);
    const done = items.length - open.length;
    const rest = [open.length > 7 ? `อีก ${open.length - 7} รายการ` : '', done ? `ติ๊กแล้ว ${done}` : ''].filter(Boolean).join(' · ');
    body =
      (open.length ? `<ul class="nc-list">${open.slice(0, 7).map((it) => `<li><button type="button" class="nc-check" data-tick="${it.i}" aria-label="ติ๊ก: ${esc(it.text)}"></button><span>${esc(it.text)}</span></li>`).join('')}</ul>` : '') +
      (rest ? `<p class="nc-rest">${rest}</p>` : '');
  } else if (m.text) {
    const big = !m.title && !imgs.length && m.text.length <= 48 && !m.text.includes('\n');
    body = `<p class="nc-text memo-text${big ? ' big' : ''}">${esc(m.text)}</p>`;
  }
  const foot = `<div class="nc-foot">${(m.labels ?? []).map((l) => `<span class="nc-label">${esc(l)}</span>`).join('')}${URL_RE.test(m.text) ? icon('i-link') : ''}<span class="nc-time">${esc(m.trashedAt ? `ลบ${ago(m.trashedAt)}` : ago(m.updatedAt))}</span></div>`;
  const name = m.title || (m.list ? 'รายการ' : m.text.slice(0, 40)) || 'โน้ตรูปภาพ';
  return `<article class="memo note-card${m.pinned ? ' pinned' : ''}" data-memo="${esc(m.id)}"${m.color ? ` data-color="${m.color}"` : ''} role="button" tabindex="0" aria-label="โน้ต: ${esc(name)}">${pics}${m.title ? `<h3 class="nc-title">${esc(m.title)}</h3>` : ''}${body}${foot}${m.pinned ? `<span class="memo-pin">${icon('i-pin')}</span>` : ''}</article>`;
}

/** Cards dealt into columns that fit the width, pinned ones first under their own heading. */
function boardHtml(list, cols, { headings = true } = {}) {
  const part = (items) => `<div class="board-cols">${N.deal(items, cols).map((col) => `<div class="board-col">${col.map(noteCard).join('')}</div>`).join('')}</div>`;
  const pinned = list.filter((m) => m.pinned);
  const rest = list.filter((m) => !m.pinned);
  if (!headings || !pinned.length) return list.length ? part(list) : '';
  return `<h3 class="board-h">ปักหมุด</h3>${part(pinned)}${rest.length ? `<h3 class="board-h">อื่น ๆ</h3>${part(rest)}` : ''}`;
}

const boardWidth = () => $('#memos').clientWidth || Math.min(980, window.innerWidth - (window.innerWidth >= 840 ? 150 : 32));

function renderFilters() {
  const live = state.memos.filter((m) => !m.trashedAt);
  const labels = N.allLabels(state.memos);
  const archived = live.filter((m) => m.archived).length;
  const trashed = state.memos.length - live.length;
  const board = live.filter((m) => !m.archived);
  const hasImg = board.some((m) => m.images?.length);
  const hasList = board.some((m) => m.list);
  // a filter that no longer has anything to show goes back to everything
  if ((noteFilter === 'archive' && !archived) || (noteFilter === 'trash' && !trashed) || (noteFilter === 'images' && !hasImg) || (noteFilter === 'lists' && !hasList)) noteFilter = 'all';
  if (noteLabel && !labels.some((l) => l.name === noteLabel)) noteLabel = '';
  const box = $('#note-filters');
  box.hidden = !(labels.length || archived || trashed || hasImg || hasList);
  if (box.hidden) return;
  const chip = (attrs, on, html) => `<button type="button" class="chip${on ? ' on' : ''}" ${attrs} aria-pressed="${on}">${html}</button>`;
  const plain = noteFilter === 'all' && !noteLabel;
  const html =
    chip('data-nf="all"', plain, 'ทั้งหมด') +
    labels.map((l) => chip(`data-nlabel="${esc(l.name)}"`, noteLabel === l.name && noteFilter === 'all', `${icon('i-tag')}${esc(l.name)} <small>${l.count}</small>`)).join('') +
    (hasImg ? chip('data-nf="images"', noteFilter === 'images', `${icon('i-image')}รูปภาพ`) : '') +
    (hasList ? chip('data-nf="lists"', noteFilter === 'lists', `${icon('i-list')}รายการ`) : '') +
    (archived ? chip('data-nf="archive"', noteFilter === 'archive', `${icon('i-archive')}เก็บถาวร <small>${archived}</small>`) : '') +
    (trashed ? chip('data-nf="trash"', noteFilter === 'trash', `${icon('i-trash')}ถังขยะ <small>${trashed}</small>`) : '');
  if (box.innerHTML !== html) box.innerHTML = html;
}

function renderBoard() {
  renderFilters();
  const list = N.visibleNotes(state.memos, { filter: noteFilter, label: noteLabel });
  boardCols = N.columnsFor(boardWidth());
  const host = $('#memos');
  const html = boardHtml(list, boardCols, { headings: noteFilter !== 'trash' });
  if (host.dataset.html !== html) {
    host.dataset.html = html;
    host.innerHTML = html;
    hydrateImages(host);
  }
  $('#memo-head').textContent = noteFilter === 'archive' ? 'เก็บถาวร' : noteFilter === 'trash' ? 'ถังขยะ' : noteLabel ? `#${noteLabel}` : 'โน้ต';
  $('#memo-count').textContent = countLabel(list.length);
  const empty = $('#memos-empty');
  empty.hidden = list.length > 0;
  if (!list.length)
    empty.textContent =
      noteFilter === 'trash'
        ? 'ถังขยะว่าง'
        : noteFilter !== 'all' || noteLabel
          ? 'ไม่มีโน้ตในมุมมองนี้'
          : 'แตะ “จดโน้ต…” หรือพิมพ์ในช่องแปะ แนบรูป วาดเขียน ทำรายการติ๊ก ใส่สีและป้ายกำกับได้';
  if (noteFilter === 'trash' && list.length) {
    empty.hidden = false;
    empty.textContent = `โน้ตในถังขยะจะถูกลบถาวรหลัง ${N.TRASH_DAYS} วัน`;
  }
}

function renderNotes() {
  const q = $('#search').value.trim();
  $('#search-results').hidden = !q;
  $('#notes-main').hidden = !!q;
  if (q) {
    renderSearch(q);
    return;
  }
  renderVoiceLists();
  renderBoard();
  for (const b of $$('#notes-seg [data-seg]')) b.setAttribute('aria-selected', String(b.dataset.seg === noteSeg));
  for (const part of $$('#notes-main .seg-part')) part.hidden = noteSeg !== 'all' && part.dataset.part !== noteSeg;
  $('#recs-empty').hidden = noteSeg !== 'recs' || state.recs.length > 0;
  $('#maps-empty').hidden = noteSeg !== 'maps' || state.maps.length > 0;
}

// columns follow the width (rotation, split screen, the pop-up window being resized)
new ResizeObserver(() => {
  if (view === 'notes' && boardCols && N.columnsFor(boardWidth()) !== boardCols) renderNotes();
}).observe($('#memos'));

function renderSearch(q) {
  const r = S.search(state, q);
  const part = (title, html) => (html ? `<h3>${title}</h3>${html}` : '');
  const html =
    part('งาน', r.tasks.length ? `<ul class="list">${r.tasks.map((t) => taskItem(t, { withDay: true })).join('')}</ul>` : '') +
    part('โน้ต', r.memos.length ? `<div class="nboard">${boardHtml(r.memos, N.columnsFor(boardWidth()), { headings: false })}</div>` : '') +
    part('บันทึกประจำวัน', r.notes.length ? `<ul class="list">${r.notes.map((n) => `<li class="plain-row"><button type="button" class="row-btn" data-note-day="${n.day}"><strong>${esc(shortDate(n.day, today))}</strong><span>${esc(n.line)}</span></button></li>`).join('')}</ul>` : '') +
    part('ของต้องซื้อ', r.shop.length ? `<ul class="list shop-list">${r.shop.map(shopItem).join('')}</ul>` : '') +
    part('รายจ่าย', r.money.length ? `<ul class="list">${r.money.map(moneyItem).join('')}</ul>` : '') +
    part('บันทึกเสียง', r.recs.length ? `<ul class="list">${r.recs.map(recRow).join('')}</ul>` : '') +
    part('มายด์แมป', r.maps.length ? `<div class="map-cards">${r.maps.map(mapCard).join('')}</div>` : '');
  $('#search-results').innerHTML = html || `<p class="empty">ไม่เจอ “${esc(q)}”</p>`;
  hydrateImages($('#search-results'));
}

$('#search').addEventListener('input', () => renderNotes());

$('#view-notes').addEventListener('click', (e) => {
  const memo = e.target.closest('[data-memo]')?.dataset.memo;
  if (memo) {
    const tick = e.target.closest('[data-tick]')?.dataset.tick;
    if (tick != null) {
      // ticking an item on the card, without opening the note
      const m = state.memos.find((x) => x.id === memo);
      if (m) commit(S.patchMemo(state, memo, { text: N.toggleItem(m.text, Number(tick)) }), { undoable: true });
      buzz();
      return;
    }
    openNote(memo);
    return;
  }
  const seg = e.target.closest('[data-seg]')?.dataset.seg;
  if (seg) {
    noteSeg = seg;
    renderNotes();
    return;
  }
  const nf = e.target.closest('[data-nf]')?.dataset.nf;
  const nl = e.target.closest('[data-nlabel]')?.dataset.nlabel;
  if (nf || nl != null) {
    noteFilter = nf ?? 'all';
    noteLabel = nl ?? '';
    renderNotes();
    return;
  }
  const money = e.target.closest('[data-money]')?.dataset.money;
  if (money) {
    openItem('money', money);
    return;
  }
  const day = e.target.closest('[data-note-day]')?.dataset.noteDay;
  if (day) {
    $('#search').value = '';
    noteDay = day;
    renderNotes();
    syncNote();
    $('#note').scrollIntoView({ behavior: calm.matches ? 'auto' : 'smooth', block: 'center' });
  }
});

function moneyItem(e) {
  return `<li class="plain-row"><button type="button" class="row-btn money-row" data-money="${esc(e.id)}"><span class="mi"><span>${esc(e.text)}</span><small>${esc(e.cat)} · ${esc(timeOf(new Date(e.at)))}</small></span><strong>${baht(e.amount)}</strong></button></li>`;
}

function renderMoney() {
  const m = S.moneySummary(state, today);
  const has = state.money.length > 0;
  $('#m-overview').hidden = !has;
  $('#m-empty').hidden = has;
  $('#m-today').textContent = baht(m.today);
  const b = S.budgetStatus(state, today);
  const box = $('#m-budget');
  box.classList.toggle('unset', !b);
  box.classList.toggle('over', !!b && b.left < 0);
  box.classList.toggle('tight', !!b && b.left >= 0 && b.ratio > 0.85);
  if (b) {
    $('#m-budget-title').textContent = `งบเดือนนี้ ${baht(b.budget)}`;
    $('#m-budget-left').textContent = b.left >= 0 ? `เหลือ ${baht(b.left)}` : `เกิน ${baht(-b.left)}`;
    $('#m-budget-bar').style.setProperty('--w', `${Math.min(100, b.ratio * 100).toFixed(1)}%`);
    $('#m-budget-sub').textContent = b.left > 0 ? `ใช้ได้อีกวันละ ${baht(b.perDay)} · อีก ${b.daysLeft} วันจะสิ้นเดือน` : 'ใช้เกินงบแล้ว ลองชะลอรายจ่ายที่ไม่จำเป็น';
  } else {
    $('#m-budget-title').textContent = 'ตั้งงบรายเดือน';
    $('#m-budget-left').textContent = '';
    $('#m-budget-sub').textContent = 'บอกได้ว่าเหลือใช้วันละเท่าไรถึงสิ้นเดือน';
  }
  $('#m-week').textContent = baht(m.weekTotal);
  $('#m-month').textContent = baht(m.month);
  const max = Math.max(1, ...m.week.map((w) => w.total));
  const short = (n) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(Math.round(n)));
  $('#m-bars').innerHTML = m.week
    .map(
      (w) =>
        `<div class="mbar${w.day === today ? ' is-today' : ''}"><span class="mbar-v">${w.total ? short(w.total) : ''}</span><span class="mbar-track"><i style="--h:${((w.total / max) * 100).toFixed(1)}%"></i></span><span class="mbar-d">${WEEKDAYS_SHORT[fromKey(w.day).getDay()]}</span></div>`,
    )
    .join('');
  const sum = m.byCat.reduce((n, c) => n + c.total, 0) || 1;
  $('#m-cats').innerHTML = m.byCat
    .map((c) => `<div class="cat-row"><span>${esc(c.cat)}</span><span class="cat-bar"><i style="--w:${((c.total / sum) * 100).toFixed(1)}%"></i></span><strong>${baht(c.total)}</strong></div>`)
    .join('');
  $('#m-days').innerHTML = m.days
    .slice(0, 31)
    .map((d) => `<section class="day"><h3>${esc(dayLabel(d.day, today))}<span class="dn2">${baht(d.total)}</span></h3><ul class="list">${d.items.map(moneyItem).join('')}</ul></section>`)
    .join('');
}

$('#view-money').addEventListener('click', (e) => {
  if (e.target.closest('[data-action="budget"]')) {
    const form = $('#budget-form');
    form.budget.value = state.settings?.budget ?? '';
    $('#budget-dialog').showModal();
    return;
  }
  const id = e.target.closest('[data-money]')?.dataset.money;
  if (id) openItem('money', id);
});

$('#budget-form').addEventListener('submit', () => {
  const amount = Number($('#budget-form').budget.value);
  commit(S.setBudget(state, amount > 0 ? amount : 0));
  toast(amount > 0 ? `ตั้งงบ ${baht(Math.round(amount))} ต่อเดือนแล้ว` : 'ไม่ตั้งงบแล้ว');
});
$('[data-budget="clear"]').addEventListener('click', () => {
  $('#budget-dialog').close();
  commit(S.setBudget(state, 0));
  toast('ไม่ตั้งงบแล้ว');
});

// One sheet edits a quick note, a thing to buy, or an expense.
const itemDialog = $('#item-dialog');
const itemForm = $('#item-form');
let editingItem = null;

function openItem(kind, id) {
  const list = kind === 'memo' ? state.memos : kind === 'shop' ? state.shop : state.money;
  const item = list.find((x) => x.id === id);
  if (!item) return;
  editingItem = { kind, id };
  $('#item-title').textContent = kind === 'memo' ? 'โน้ตย่อ' : kind === 'shop' ? 'ของต้องซื้อ' : 'รายจ่าย';
  itemForm.text.value = item.text;
  itemForm.text.rows = kind === 'memo' ? 5 : 2;
  $('#item-amount').hidden = kind !== 'money';
  itemForm.amount.value = kind === 'money' ? item.amount : '';
  const cats = $('#item-cats');
  cats.hidden = kind !== 'money';
  cats.innerHTML = kind === 'money' ? MONEY_CATS.map((c) => `<button type="button" data-cat="${esc(c)}" class="${c === item.cat ? 'on' : ''}">${esc(c)}</button>`).join('') : '';
  $('[data-iact="pin"]', itemForm).hidden = kind !== 'memo';
  $('[data-iact="pin"] span', itemForm).textContent = item.pinned ? 'เลิกปักหมุด' : 'ปักหมุด';
  $('[data-iact="to-task"]', itemForm).hidden = kind === 'money';
  $('[data-iact="to-map"]', itemForm).hidden = kind !== 'memo' || item.text.trim().length < 40;
  $('[data-iact="link"]', itemForm).hidden = !URL_RE.test(item.text);
  itemDialog.showModal();
}

function saveItem() {
  if (!editingItem) return;
  const { kind, id } = editingItem;
  const text = itemForm.text.value;
  if (kind === 'memo') commit(S.editMemo(state, id, text), { undoable: true });
  if (kind === 'shop') commit(S.editShop(state, id, text), { undoable: true });
  if (kind === 'money') {
    const cat = $('#item-cats .on')?.dataset.cat;
    commit(S.editMoney(state, id, { text, amount: Number(itemForm.amount.value), cat }), { undoable: true });
  }
}

itemForm.addEventListener('submit', (e) => {
  e.preventDefault();
  saveItem();
  itemDialog.close();
});

itemForm.addEventListener('click', async (e) => {
  const cat = e.target.closest('[data-cat]');
  if (cat) {
    for (const b of $$('[data-cat]', itemForm)) b.classList.toggle('on', b === cat);
    return;
  }
  const act = e.target.closest('[data-iact]')?.dataset.iact;
  if (!act || !editingItem) return;
  const { kind, id } = editingItem;
  if (act === 'cancel') itemDialog.close();
  if (act === 'pin') {
    saveItem();
    commit(S.pinMemo(state, id), { animate: true });
    itemDialog.close();
  }
  if (act === 'link') window.open(itemForm.text.value.match(URL_RE)[0], '_blank', 'noopener');
  if (act === 'copy') {
    const text = itemForm.text.value;
    try {
      if (android) android.copyText(text);
      else await navigator.clipboard.writeText(text);
      toast('คัดลอกแล้ว');
    } catch {
      toast('คัดลอกไม่ได้');
    }
  }
  if (act === 'to-map') {
    saveItem();
    itemDialog.close();
    memoToMap(id);
  }
  if (act === 'to-task') {
    const text = itemForm.text.value.trim();
    const p = parseWhen(kind === 'shop' ? `ซื้อ${text}` : text, Date.now());
    const without = kind === 'memo' ? S.deleteMemo(state, id) : S.deleteShop(state, id);
    commit(S.addTask(without, p), { undoable: true, animate: true });
    itemDialog.close();
    toast(`ย้ายไปเป็นงาน${p.day ? ` ${describeWhen(p.day, p.time, today)}` : 'ในกล่องรับ'}แล้ว`, { label: 'เลิกทำ', run: undo });
  }
  if (act === 'delete') {
    const next = kind === 'memo' ? S.deleteMemo(state, id) : kind === 'shop' ? S.deleteShop(state, id) : S.deleteMoney(state, id);
    itemDialog.close();
    commit(next, { undoable: true, animate: true });
    toast('ลบแล้ว', { label: 'เลิกทำ', run: undo });
  }
});

itemDialog.addEventListener('close', () => {
  editingItem = null;
});

// ---------------------------------------------------------------------------
// The note editor: title, text or a checklist, pictures, colour, labels. It saves by itself
// (while typing, when it closes, when the app goes to the background); an empty note is dropped.

const noteDialog = $('#note-dialog');
let draft = null; // the note being edited: { id, title, text, list, items, color, labels, images, pinned, archived, readonly, saved }
let draftTimer = 0;
let busyImages = 0;

function openNote(id = null, { list = false, text = '', title = '', images = [], labels = null, then = '' } = {}) {
  const m = id ? state.memos.find((x) => x.id === id) : null;
  if (id && !m) return;
  if (noteDialog.open) closeNote();
  draft = m
    ? { id: m.id, title: m.title ?? '', text: m.text, list: !!m.list, color: m.color ?? '', labels: [...(m.labels ?? [])], images: [...(m.images ?? [])], pinned: !!m.pinned, archived: !!m.archived, readonly: !!m.trashedAt, at: m.updatedAt, saved: false }
    : { id: S.uid(), title, text, list, color: '', labels: labels ?? (noteLabel ? [noteLabel] : []), images: [...images], pinned: false, archived: false, readonly: false, at: 0, saved: false };
  draft.items = draft.list ? N.listItems(draft.text) : [];
  if (draft.list && !draft.items.length) draft.items = [{ text: '', done: false }];
  $('#note-title').value = draft.title;
  $('#note-text').value = draft.list ? '' : draft.text;
  $('#note-colors').hidden = true;
  $('#note-labeler').hidden = true;
  $('#note-sum').hidden = true;
  for (const b of $$('[data-nact="color"], [data-nact="label"]', noteDialog)) b.setAttribute('aria-expanded', 'false');
  noteDialog.classList.toggle('readonly', draft.readonly);
  for (const el of [$('#note-title'), $('#note-text')]) el.readOnly = draft.readonly;
  renderDraft();
  noteDialog.showModal();
  growText();
  if (draft.readonly) return;
  if (then === 'image') $('#note-file').click();
  else if (then === 'camera') $('#note-camera').click();
  else if (then === 'draw') openDraw();
  else if (!m) requestAnimationFrame(() => (draft?.list ? $('#note-list input[type="text"]') : $('#note-text'))?.focus());
  if (images.length) saveDraft();
}

function renderDraft() {
  if (!draft) return;
  if (draft.color) noteDialog.dataset.color = draft.color;
  else delete noteDialog.dataset.color;
  const pin = $('[data-nact="pin"]', noteDialog);
  pin.setAttribute('aria-pressed', String(draft.pinned));
  pin.setAttribute('aria-label', draft.pinned ? 'เลิกปักหมุด' : 'ปักหมุด');
  $('[data-nact="archive"]', noteDialog).setAttribute('aria-label', draft.archived ? 'นำออกจากที่เก็บถาวร' : 'เก็บถาวร');
  $('[data-nact="archive"]', noteDialog).title = draft.archived ? 'นำออกจากที่เก็บถาวร' : 'เก็บถาวร';
  const listBtn = $('[data-nact="list"]', noteDialog);
  listBtn.setAttribute('aria-pressed', String(draft.list));
  $('#note-text').hidden = draft.list;
  $('#note-list').hidden = !draft.list;
  renderDraftImages();
  renderDraftList();
  renderDraftLabels();
  $('#note-meta').textContent = draft.readonly ? 'อยู่ในถังขยะ แตะ ⋮ เพื่อกู้คืน' : draft.at ? `แก้ไขล่าสุด ${ago(draft.at)}` : '';
  $('#note-state').textContent = '';
}

function renderDraftImages() {
  const box = $('#note-images');
  box.classList.toggle('one', draft.images.length === 1 && !busyImages);
  box.innerHTML =
    draft.images
      .map((im, i) => `<button type="button" class="ph" data-img-open="${i}" aria-label="ดูรูปที่ ${i + 1}"${draft.images.length === 1 && im.w && im.h ? ` style="aspect-ratio:${im.w}/${im.h}"` : ''}>${imgTag(im.id)}</button>`)
      .join('') + (busyImages ? `<span class="ph busy">กำลังเตรียมรูป…</span>` : '');
  hydrateImages(box);
}

function renderDraftLabels() {
  $('#note-labels').innerHTML = draft.labels.map((l, i) => `<button type="button" class="nc-label" data-label-x="${i}" aria-label="เอาป้าย ${esc(l)} ออก"${draft.readonly ? ' disabled' : ''}>${esc(l)}${draft.readonly ? '' : '<b aria-hidden="true">×</b>'}</button>`).join('');
  const all = [...new Set([...draft.labels, ...N.allLabels(state.memos).map((l) => l.name)])];
  $('#note-label-list').innerHTML = all.map((l) => `<button type="button" class="chip${draft.labels.includes(l) ? ' on' : ''}" data-label-pick="${esc(l)}" aria-pressed="${draft.labels.includes(l)}">${esc(l)}</button>`).join('');
  $('#note-label-list').hidden = !all.length;
}

function renderDraftList() {
  if (!draft.list) return;
  const row = (it, i) =>
    `<div class="nl-row${it.done ? ' done' : ''}" data-i="${i}"><button type="button" class="nl-check" data-nl="toggle" role="checkbox" aria-checked="${it.done}" aria-label="${it.done ? 'เอาติ๊กออก' : 'ติ๊ก'}"></button><input type="text" value="${esc(it.text)}" maxlength="500" placeholder="รายการ" aria-label="รายการที่ ${i + 1}" enterkeyhint="next" autocomplete="off"${draft.readonly ? ' readonly' : ''}><button type="button" class="nl-x" data-nl="remove" aria-label="ลบรายการนี้">×</button></div>`;
  const items = draft.items.map((it, i) => ({ it, i }));
  const open = items.filter((x) => !x.it.done);
  const done = items.filter((x) => x.it.done);
  $('#note-list').innerHTML =
    open.map((x) => row(x.it, x.i)).join('') +
    (draft.readonly ? '' : `<button type="button" class="nl-add" data-nl="add">${icon('i-plus')}<span>เพิ่มรายการ</span></button>`) +
    (done.length ? `<p class="nl-done-head">ติ๊กแล้ว ${done.length}</p>${done.map((x) => row(x.it, x.i)).join('')}` : '');
}

const focusItem = (i, end = true) => {
  const el = $(`#note-list .nl-row[data-i="${i}"] input[type="text"]`);
  if (!el) return;
  el.focus();
  const at = end ? el.value.length : 0;
  el.setSelectionRange(at, at);
};

function growText() {
  const el = $('#note-text');
  if (el.hidden) return;
  el.style.height = 'auto';
  el.style.height = `${Math.max(96, el.scrollHeight + 2)}px`;
}

/** What the editor holds now, as the fields of a note. */
function readDraft() {
  return {
    title: $('#note-title').value,
    text: draft.list ? N.listText(draft.items) : $('#note-text').value,
    list: draft.list,
    color: draft.color || undefined,
    labels: draft.labels,
    images: draft.images,
    pinned: draft.pinned,
    archived: draft.archived,
  };
}

function saveDraft() {
  clearTimeout(draftTimer);
  if (!draft || draft.readonly) return false;
  const n = readDraft();
  const exists = state.memos.some((m) => m.id === draft.id);
  const next = exists ? S.patchMemo(state, draft.id, n) : S.addMemo(state, { ...n, id: draft.id });
  if (next === state) return false;
  // one undo takes back everything done since the note was opened
  commit(next, { undoable: !draft.saved });
  draft.saved = true;
  $('#note-state').textContent = next.memos.some((m) => m.id === draft.id) ? 'บันทึกแล้ว' : '';
  persistOnce();
  return true;
}

function touchDraft() {
  if (!draft || draft.readonly) return;
  $('#note-state').textContent = '';
  clearTimeout(draftTimer);
  draftTimer = setTimeout(saveDraft, 900);
}

function closeNote() {
  saveDraft();
  if (noteDialog.open) noteDialog.close();
}

noteDialog.addEventListener('close', () => {
  saveDraft();
  draft = null;
});
// Escape and the Android back button close it like the arrow does (saving first)
noteDialog.addEventListener('cancel', () => saveDraft());
document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && saveDraft());
window.addEventListener('pagehide', () => saveDraft());

$('#note-title').addEventListener('input', touchDraft);
$('#note-title').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || e.isComposing) return;
  e.preventDefault();
  if (draft?.list) focusItem(draft.items.findIndex((it) => !it.done));
  else $('#note-text').focus();
});
$('#note-text').addEventListener('input', () => {
  growText();
  touchDraft();
});

$('#note-list').addEventListener('input', (e) => {
  const row = e.target.closest('.nl-row');
  if (!row || !draft) return;
  draft.items[Number(row.dataset.i)].text = e.target.value;
  touchDraft();
});
$('#note-list').addEventListener('keydown', (e) => {
  const row = e.target.closest('.nl-row');
  if (!row || !draft || draft.readonly || e.isComposing) return;
  const i = Number(row.dataset.i);
  if (e.key === 'Enter') {
    e.preventDefault();
    const at = e.target.selectionStart ?? e.target.value.length;
    const rest = e.target.value.slice(at);
    draft.items[i].text = e.target.value.slice(0, at);
    draft.items.splice(i + 1, 0, { text: rest, done: draft.items[i].done });
    renderDraftList();
    focusItem(i + 1, false);
    touchDraft();
  } else if (e.key === 'Backspace' && !e.target.value && draft.items.length > 1) {
    e.preventDefault();
    draft.items.splice(i, 1);
    renderDraftList();
    focusItem(Math.max(0, i - 1));
    touchDraft();
  }
});
$('#note-list').addEventListener('click', (e) => {
  const act = e.target.closest('[data-nl]')?.dataset.nl;
  if (!act || !draft || draft.readonly) return;
  const i = Number(e.target.closest('.nl-row')?.dataset.i);
  if (act === 'toggle') {
    draft.items[i].done = !draft.items[i].done;
    buzz();
  }
  if (act === 'remove') draft.items.splice(i, 1);
  if (act === 'add') draft.items.push({ text: '', done: false });
  renderDraftList();
  if (act === 'add') focusItem(draft.items.length - 1);
  touchDraft();
});

function addLabel(raw) {
  const label = N.cleanLabel(raw);
  if (!label || !draft) return;
  if (!draft.labels.some((l) => l.toLowerCase() === label.toLowerCase())) {
    if (draft.labels.length >= N.MAX_LABELS) {
      toast(`ใส่ได้ ${N.MAX_LABELS} ป้ายต่อโน้ต`);
      return;
    }
    draft.labels.push(label);
  }
  renderDraftLabels();
  touchDraft();
}
$('#note-label-new').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || e.isComposing) return;
  e.preventDefault();
  addLabel(e.target.value);
  e.target.value = '';
});

noteDialog.addEventListener('click', (e) => {
  if (!draft) return;
  const open = e.target.closest('[data-img-open]')?.dataset.imgOpen;
  if (open != null) {
    openViewer(draft.images, Number(open), { editable: !draft.readonly });
    return;
  }
  if (draft.readonly && !e.target.closest('[data-nact="close"], [data-nact="more"]')) return;
  const x = e.target.closest('[data-label-x]')?.dataset.labelX;
  if (x != null) {
    draft.labels.splice(Number(x), 1);
    renderDraftLabels();
    touchDraft();
    return;
  }
  const pick = e.target.closest('[data-label-pick]')?.dataset.labelPick;
  if (pick != null) {
    if (draft.labels.includes(pick)) draft.labels = draft.labels.filter((l) => l !== pick);
    else addLabel(pick);
    renderDraftLabels();
    touchDraft();
    return;
  }
  const color = e.target.closest('[data-swatch]')?.dataset.swatch;
  if (color != null) {
    draft.color = color;
    renderDraft();
    renderSwatches();
    touchDraft();
    return;
  }
  const act = e.target.closest('[data-nact]')?.dataset.nact;
  if (!act) return;
  if (act === 'close') closeNote();
  if (act === 'pin') {
    draft.pinned = !draft.pinned;
    if (draft.pinned) draft.archived = false;
    renderDraft();
    touchDraft();
    buzz();
  }
  if (act === 'archive') {
    const on = !draft.archived;
    draft.archived = on;
    if (on) draft.pinned = false;
    const empty = N.isEmptyNote(readDraft());
    closeNote();
    if (!empty) toast(on ? 'เก็บถาวรแล้ว' : 'นำกลับมาที่กระดานแล้ว', { label: 'เลิกทำ', run: undo });
  }
  if (act === 'more') openNoteMenu();
  if (act === 'image') $('#note-file').click();
  if (act === 'camera') $('#note-camera').click();
  if (act === 'draw') openDraw();
  if (act === 'list') {
    if (draft.list) {
      $('#note-text').value = draft.items.map((it) => it.text).filter(Boolean).join('\n');
      draft.list = false;
    } else {
      draft.items = N.listItems($('#note-text').value);
      if (!draft.items.length) draft.items = [{ text: '', done: false }];
      draft.list = true;
    }
    renderDraft();
    growText();
    if (draft.list) focusItem(draft.items.length - 1);
    touchDraft();
  }
  if (act === 'color' || act === 'label') {
    const box = act === 'color' ? $('#note-colors') : $('#note-labeler');
    const other = act === 'color' ? $('#note-labeler') : $('#note-colors');
    other.hidden = true;
    box.hidden = !box.hidden;
    $('[data-nact="color"]', noteDialog).setAttribute('aria-expanded', String(!$('#note-colors').hidden));
    $('[data-nact="label"]', noteDialog).setAttribute('aria-expanded', String(!$('#note-labeler').hidden));
    if (act === 'color') renderSwatches();
    else if (!box.hidden && matchMedia('(hover: hover)').matches) $('#note-label-new').focus();
  }
  if (act === 'label-add') {
    addLabel($('#note-label-new').value);
    $('#note-label-new').value = '';
  }
});

function renderSwatches() {
  $('#note-colors').innerHTML =
    `<button type="button" class="swatch none" data-swatch="" aria-pressed="${!draft.color}" aria-label="ไม่ใส่สี" title="ไม่ใส่สี"></button>` +
    N.NOTE_COLORS.map((c) => `<button type="button" class="swatch" data-swatch="${c}" data-color="${c}" aria-pressed="${draft.color === c}" aria-label="สี${N.COLOR_NAMES[c]}" title="${N.COLOR_NAMES[c]}"></button>`).join('');
}

// ---- pictures: from the gallery, the camera, the clipboard, or dropped on the page ----

/** Keeps pictures on this device and returns their entries for a note ([] when none could be read). */
async function storeImages(files, { png = false } = {}) {
  const out = [];
  let failed = 0;
  let full = false;
  for (const file of files) {
    try {
      const made = await prepare(file, { png });
      const id = S.uid();
      await media.put(id, made);
      out.push({ id, w: made.w, h: made.h, ...(made.t ? { t: made.t } : {}) });
    } catch (err) {
      failed++;
      full ||= err?.name === 'QuotaExceededError';
    }
  }
  if (failed) toast(full ? 'ที่เก็บในเครื่องเต็ม ลบรูปหรือบันทึกเสียงเก่าก่อน' : failed === files.length ? 'เปิดรูปนี้ไม่ได้' : `เปิดไม่ได้ ${failed} รูป`);
  return out;
}

async function addImagesToDraft(files) {
  const list = [...files].filter((f) => f && (f instanceof HTMLCanvasElement || /^image\//.test(f.type) || /\.(?:jpe?g|png|webp|gif|heic|heif|avif|bmp)$/i.test(f.name ?? '')));
  if (!list.length || !draft || draft.readonly) return;
  const room = N.MAX_IMAGES - draft.images.length;
  if (room <= 0) {
    toast(`แนบได้ ${N.MAX_IMAGES} รูปต่อโน้ต`);
    return;
  }
  const target = draft;
  busyImages++;
  renderDraftImages();
  const made = await storeImages(list.slice(0, room));
  busyImages--;
  if (draft !== target) {
    // the note was closed while the pictures were being prepared: add them to it all the same
    if (made.length) commit(state.memos.some((m) => m.id === target.id) ? S.patchMemo(state, target.id, { images: [...target.images, ...made] }) : S.addMemo(state, { id: target.id, text: '', images: made }));
    return;
  }
  draft.images.push(...made);
  renderDraftImages();
  if (made.length) saveDraft();
  if (list.length > room) toast(`แนบได้ ${N.MAX_IMAGES} รูปต่อโน้ต`);
}

for (const id of ['#note-file', '#note-camera'])
  $(id).addEventListener('change', (e) => {
    const files = [...(e.target.files ?? [])];
    e.target.value = '';
    addImagesToDraft(files);
  });

const pastedImages = (e) => [...(e.clipboardData?.files ?? [])].filter((f) => /^image\//.test(f.type));
noteDialog.addEventListener('paste', (e) => {
  const files = pastedImages(e);
  if (!files.length) return;
  e.preventDefault();
  addImagesToDraft(files);
});

/** A new note that starts with these pictures, opened for the words to be added. */
async function noteFromImages(files, { text = '' } = {}) {
  const list = [...files].filter((f) => /^image\//.test(f.type) || /\.(?:jpe?g|png|webp|gif|heic|heif|avif|bmp)$/i.test(f.name ?? ''));
  if (!list.length) return false;
  setView('notes');
  toast(list.length > 1 ? `กำลังเตรียม ${list.length} รูป…` : 'กำลังเตรียมรูป…');
  const images = await storeImages(list.slice(0, N.MAX_IMAGES));
  if (!images.length) return false;
  openNote(null, { images, text });
  return true;
}

// dropping pictures on the page (computer, DeX, split screen with the gallery)
let dragDepth = 0;
const hasFiles = (e) => [...(e.dataTransfer?.types ?? [])].includes('Files');
document.addEventListener('dragenter', (e) => {
  if (!hasFiles(e)) return;
  dragDepth++;
  document.documentElement.classList.add('drop-on');
});
document.addEventListener('dragleave', (e) => {
  if (!hasFiles(e)) return;
  if (--dragDepth <= 0) document.documentElement.classList.remove('drop-on');
});
document.addEventListener('dragover', (e) => hasFiles(e) && e.preventDefault());
document.addEventListener('drop', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth = 0;
  document.documentElement.classList.remove('drop-on');
  const files = [...e.dataTransfer.files];
  if (draft && noteDialog.open) addImagesToDraft(files);
  else if (!document.querySelector('dialog[open]')) noteFromImages(files);
});

// ---- ⋮ on a note ----

function openNoteMenu() {
  const menuEl = $('#note-menu');
  const n = readDraft();
  const words = (n.list ? N.plainText(n.text) : n.text).trim();
  const trashed = draft.readonly;
  const show = { copy: !!(words || n.title), share: !!(words || n.title), dup: !trashed && !N.isEmptyNote(n), sum: !trashed && !n.list && words.length >= 120, map: !trashed && words.length >= 40, task: !trashed && !!(words || n.title), restore: trashed, delete: true };
  for (const b of $$('[data-nm]', menuEl)) b.hidden = !show[b.dataset.nm];
  $('[data-nm="delete"]', menuEl).textContent = trashed ? 'ลบถาวร' : 'ย้ายไปถังขยะ';
  menuEl.showModal();
}

$('#note-menu').addEventListener('click', async (e) => {
  const menuEl = $('#note-menu');
  const act = e.target.closest('[data-nm]')?.dataset.nm;
  if (!act) {
    if (e.target === menuEl) menuEl.close();
    return;
  }
  menuEl.close();
  if (!draft) return;
  const id = draft.id;
  const n = readDraft();
  const words = [n.title, n.list ? N.listItems(n.text).map((it) => `${it.done ? '☑' : '☐'} ${it.text}`).join('\n') : n.text].filter((x) => x?.trim()).join('\n\n');
  if (act === 'copy') copyText(words);
  if (act === 'share') {
    try {
      if (android?.shareText) android.shareText(words);
      else if (navigator.share) await navigator.share({ title: n.title || undefined, text: words });
      else copyText(words, 'คัดลอกแล้ว วางในแอปที่จะส่งได้เลย');
    } catch (err) {
      if (err?.name !== 'AbortError') copyText(words);
    }
  }
  if (act === 'dup') {
    saveDraft();
    closeNote();
    commit(S.addMemo(state, { ...n, pinned: false, archived: false, title: n.title ? `${n.title} (สำเนา)` : '' }), { undoable: true });
    toast('ทำสำเนาแล้ว', { label: 'เลิกทำ', run: undo });
  }
  if (act === 'sum') summarizeDraft();
  if (act === 'map') {
    closeNote();
    memoToMap(id);
  }
  if (act === 'task') {
    const p = parseWhen([n.title, n.list ? N.plainText(n.text) : n.text].filter((x) => x?.trim()).join(' ').replace(/\s+/g, ' ').trim().slice(0, 2000), Date.now());
    saveDraft();
    draft.readonly = true; // nothing more to save: the note becomes a task
    noteDialog.close();
    commit(S.addTask(state.memos.some((m) => m.id === id) ? S.trashMemo(state, id) : state, p), { undoable: true, animate: true });
    toast(`ย้ายไปเป็นงาน${p.day ? ` ${describeWhen(p.day, p.time, today)}` : 'ในกล่องรับ'}แล้ว (โน้ตอยู่ในถังขยะ)`, { label: 'เลิกทำ', run: undo });
  }
  if (act === 'restore') {
    noteDialog.close();
    commit(S.restoreMemo(state, id), { undoable: true });
    toast('กู้คืนแล้ว', { label: 'เลิกทำ', run: undo });
  }
  if (act === 'delete') {
    const forever = draft.readonly;
    if (!forever) saveDraft();
    draft.readonly = true;
    noteDialog.close();
    if (!state.memos.some((m) => m.id === id)) return;
    commit(forever ? S.deleteMemo(state, id) : S.trashMemo(state, id), { undoable: true, animate: true });
    toast(forever ? 'ลบถาวรแล้ว' : `ย้ายไปถังขยะแล้ว (เก็บไว้ ${N.TRASH_DAYS} วัน)`, { label: 'เลิกทำ', run: undo });
  }
});

/** A long note summarised on the device (lib/summarize.js, no AI), shown under it. */
function summarizeDraft() {
  const n = readDraft();
  const box = $('#note-sum');
  let a = null;
  try {
    a = Sum.analyze(n.text, { title: n.title || 'โน้ต', now: Date.now() });
  } catch (err) {
    console.error(err);
  }
  if (!a?.summary) {
    toast('โน้ตสั้นเกินไปที่จะสรุป');
    return;
  }
  box.hidden = false;
  box.dataset.text = a.summary;
  box.innerHTML = `${miniMarkdown(a.summary)}<div class="sheet-buttons"><button type="button" data-sum="top">แทรกไว้บนสุด</button><button type="button" data-sum="copy">คัดลอก</button><button type="button" data-sum="hide">ซ่อน</button></div>`;
  box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}
$('#note-sum').addEventListener('click', (e) => {
  const act = e.target.closest('[data-sum]')?.dataset.sum;
  const box = $('#note-sum');
  if (!act || !draft) return;
  const plain = (box.dataset.text ?? '').replace(/\*\*(.+?)\*\*/g, '$1');
  if (act === 'copy') copyText(plain);
  if (act === 'top') {
    $('#note-text').value = `สรุป\n${plain}\n\n${$('#note-text').value}`;
    growText();
    touchDraft();
    box.hidden = true;
    $('#note-body').scrollTo({ top: 0, behavior: 'smooth' });
  }
  if (act === 'hide') box.hidden = true;
});

// ---------------------------------------------------------------------------
// Picture viewer: swipe between a note's pictures, pinch or double-tap to zoom

const viewer = $('#img-viewer');
const viewerImg = $('#viewer-img');
let viewing = null; // { images, i, editable }
let zoom = { k: 1, x: 0, y: 0 };

function openViewer(images, i = 0, { editable = false } = {}) {
  if (!images.length) return;
  viewing = { images, i: Math.max(0, Math.min(i, images.length - 1)), editable };
  if (!viewer.open) viewer.showModal();
  showViewed();
}

async function showViewed() {
  if (!viewing) return;
  const im = viewing.images[viewing.i];
  zoom = { k: 1, x: 0, y: 0 };
  applyZoom();
  $('#viewer-count').textContent = viewing.images.length > 1 ? `${viewing.i + 1} / ${viewing.images.length}` : '';
  $('[data-vact="prev"]', viewer).hidden = viewing.i === 0;
  $('[data-vact="next"]', viewer).hidden = viewing.i >= viewing.images.length - 1;
  $('[data-vact="delete"]', viewer).hidden = !viewing.editable;
  $('[data-vact="draw"]', viewer).hidden = !viewing.editable;
  // the small copy at once, then the picture itself
  viewerImg.src = cachedUrl(im.id) || '';
  const url = await urlFor(im.id, { full: true }).catch(() => '');
  if (viewing?.images[viewing.i] !== im) return;
  if (url) viewerImg.src = url;
  else toast('รูปนี้ยังไม่อยู่ในเครื่องนี้ จะมาเมื่อซิงก์');
}

const applyZoom = () => (viewerImg.style.transform = `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.k})`);

function stepViewer(d) {
  if (!viewing) return;
  const i = viewing.i + d;
  if (i < 0 || i >= viewing.images.length) return;
  viewing.i = i;
  showViewed();
}

{
  const stage = $('#viewer-stage');
  const pts = new Map();
  let start = null; // gesture start: { k, x, y, dist, cx, cy }
  let lastTap = 0;
  const center = () => {
    const [a, b] = [...pts.values()];
    return b ? { cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, dist: Math.hypot(a.x - b.x, a.y - b.y) } : { cx: a.x, cy: a.y, dist: 0 };
  };
  stage.addEventListener('pointerdown', (e) => {
    stage.setPointerCapture(e.pointerId);
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    start = { ...zoom, ...center(), t: Date.now(), moved: false };
  });
  stage.addEventListener('pointermove', (e) => {
    if (!pts.has(e.pointerId) || !start) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const c = center();
    if (Math.hypot(c.cx - start.cx, c.cy - start.cy) > 6) start.moved = true;
    if (pts.size >= 2 && start.dist) {
      zoom.k = Math.max(1, Math.min(6, start.k * (c.dist / start.dist)));
      start.moved = true;
    }
    if (zoom.k > 1 || pts.size >= 2) {
      zoom.x = start.x + (c.cx - start.cx);
      zoom.y = start.y + (c.cy - start.cy);
    } else zoom.x = c.cx - start.cx; // a swipe to the next picture follows the finger
    applyZoom();
  });
  const end = (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.delete(e.pointerId);
    if (pts.size) {
      start = { ...zoom, ...center(), t: 0, moved: true };
      return;
    }
    if (!start) return;
    const dx = zoom.x - start.x;
    if (zoom.k <= 1.02) {
      zoom = { k: 1, x: 0, y: 0 };
      if (Math.abs(dx) > 70) stepViewer(dx < 0 ? 1 : -1);
      else if (!start.moved) {
        // double tap (or double click): zoom in where it was tapped, and back out
        const now = Date.now();
        if (now - lastTap < 320) {
          const r = stage.getBoundingClientRect();
          zoom = { k: 2.6, x: (r.width / 2 - (e.clientX - r.left)) * 1.6, y: (r.height / 2 - (e.clientY - r.top)) * 1.6 };
          lastTap = 0;
        } else lastTap = now;
      }
    } else if (!start.moved && Date.now() - lastTap < 320) {
      zoom = { k: 1, x: 0, y: 0 };
      lastTap = 0;
    } else if (!start.moved) lastTap = Date.now();
    applyZoom();
    start = null;
  };
  stage.addEventListener('pointerup', end);
  stage.addEventListener('pointercancel', end);
  stage.addEventListener('wheel', (e) => {
    e.preventDefault();
    zoom.k = Math.max(1, Math.min(6, zoom.k * (e.deltaY < 0 ? 1.15 : 0.87)));
    if (zoom.k === 1) zoom.x = zoom.y = 0;
    applyZoom();
  }, { passive: false });
}

viewer.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowRight') stepViewer(1);
  if (e.key === 'ArrowLeft') stepViewer(-1);
});
viewer.addEventListener('close', () => {
  viewing = null;
  viewerImg.removeAttribute('src');
});
viewer.addEventListener('click', async (e) => {
  const act = e.target.closest('[data-vact]')?.dataset.vact;
  if (!act || !viewing) return;
  const im = viewing.images[viewing.i];
  if (act === 'close') viewer.close();
  if (act === 'prev') stepViewer(-1);
  if (act === 'next') stepViewer(1);
  if (act === 'save') {
    const rec = await media.get(im.id).catch(() => null);
    if (!rec) {
      toast('รูปนี้ยังไม่อยู่ในเครื่องนี้');
      return;
    }
    await shareBlob(`paewai-${im.id}.${im.t === 'png' ? 'png' : 'jpg'}`, rec.blob);
  }
  if (act === 'delete' && draft) {
    const i = draft.images.findIndex((x) => x.id === im.id);
    if (i < 0) return;
    draft.images.splice(i, 1);
    renderDraftImages();
    saveDraft();
    if (!draft.images.length) viewer.close();
    else {
      viewing = { ...viewing, images: draft.images, i: Math.min(viewing.i, draft.images.length - 1) };
      showViewed();
    }
    const noteId = draft.id;
    toast('เอารูปออกแล้ว', {
      label: 'เลิกทำ',
      run: () => {
        if (draft?.id !== noteId || draft.images.some((x) => x.id === im.id)) return;
        draft.images.splice(Math.min(i, draft.images.length), 0, im);
        renderDraftImages();
        saveDraft();
      },
    });
  }
  if (act === 'draw' && draft) {
    viewer.close();
    openDraw({ over: im });
  }
});

/** A picture or drawing to the share sheet, the Android app's "save", or a download. */
async function shareBlob(name, blob) {
  if (android?.saveBase64) {
    const reader = new FileReader();
    reader.onload = () => android.saveBase64(name, String(reader.result).split(',')[1], blob.type);
    reader.readAsDataURL(blob);
    return;
  }
  const file = new File([blob], name, { type: blob.type });
  try {
    if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file] });
    else {
      const url = URL.createObjectURL(file);
      Object.assign(document.createElement('a'), { href: url, download: name }).click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    }
  } catch (err) {
    if (err?.name !== 'AbortError') toast('บันทึกรูปไม่ได้');
  }
}

// ---------------------------------------------------------------------------
// Drawing (finger, mouse or S Pen): kept as a picture of the note. Ink is its own layer over the
// paper (white, or the picture being drawn on), so the eraser only removes ink.

const drawDialog = $('#draw-dialog');
const drawCanvas = $('#draw-canvas');
const DRAW_COLORS = ['#16161a', '#e5393b', '#f29b05', '#2e9e4f', '#0381fe', '#8e44ec'];
let drawing = null; // { strokes, redo, tool, color, size, ink, paper, over, dpr, cur, sawPen }
let drawPrefs = { tool: 'pen', color: DRAW_COLORS[0], size: 5 }; // the pen as it was left
let drawCancelArmed = 0;

$('#draw-colors').innerHTML = DRAW_COLORS.map((c, i) => `<button type="button" data-ink="${c}" style="--c:${c}" aria-pressed="${i === 0}" aria-label="สีที่ ${i + 1}"></button>`).join('');

async function openDraw({ over = null } = {}) {
  if (!draft || draft.readonly) return;
  if (!over && draft.images.length >= N.MAX_IMAGES) {
    toast(`แนบได้ ${N.MAX_IMAGES} รูปต่อโน้ต`);
    return;
  }
  let paper = null;
  if (over) {
    const rec = await media.get(over.id).catch(() => null);
    if (!rec) {
      toast('รูปนี้ยังไม่อยู่ในเครื่องนี้');
      return;
    }
    paper = await createImageBitmap(rec.blob).catch(() => null);
    if (!paper) {
      toast('เปิดรูปนี้ไม่ได้');
      return;
    }
  }
  drawDialog.showModal();
  const stage = $('#draw-stage');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  let w = Math.max(200, stage.clientWidth);
  let h = Math.max(200, stage.clientHeight);
  if (paper) {
    // the paper takes the picture's shape, as large as fits
    const k = Math.min(w / paper.width, h / paper.height);
    w = Math.max(1, Math.round(paper.width * k));
    h = Math.max(1, Math.round(paper.height * k));
  }
  drawCanvas.width = Math.round(w * dpr);
  drawCanvas.height = Math.round(h * dpr);
  drawCanvas.style.objectFit = 'contain';
  const ink = Object.assign(document.createElement('canvas'), { width: drawCanvas.width, height: drawCanvas.height });
  drawing = { strokes: [], redo: [], ...drawPrefs, ink, paper, over, dpr, cur: null, sawPen: false };
  drawCancelArmed = 0;
  syncDrawTools();
  paint();
}

function syncDrawTools() {
  for (const b of $$('[data-tool]', drawDialog)) b.setAttribute('aria-pressed', String(b.dataset.tool === drawing.tool));
  for (const b of $$('[data-ink]', drawDialog)) b.setAttribute('aria-pressed', String(b.dataset.ink === drawing.color));
  for (const b of $$('[data-size]', drawDialog)) b.setAttribute('aria-pressed', String(Number(b.dataset.size) === drawing.size));
  $('[data-dact="undo"]', drawDialog).disabled = !drawing.strokes.length;
  $('[data-dact="redo"]', drawDialog).disabled = !drawing.redo.length;
}

/** One stroke onto a canvas context (sizes in CSS px, scaled by the canvas's pixel ratio). */
function inkStroke(g, s, dpr) {
  if (s.tool === 'clear') {
    g.clearRect(0, 0, g.canvas.width, g.canvas.height);
    return;
  }
  const pts = s.pts;
  if (!pts.length) return;
  g.save();
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.globalCompositeOperation = s.tool === 'eraser' ? 'destination-out' : 'source-over';
  g.globalAlpha = s.tool === 'marker' ? 0.32 : 1;
  g.strokeStyle = g.fillStyle = s.tool === 'eraser' ? '#000' : s.color;
  const base = (s.tool === 'marker' ? s.size * 3.2 : s.tool === 'eraser' ? s.size * 4 : s.size) * dpr;
  if (pts.length === 1) {
    g.beginPath();
    g.arc(pts[0][0] * dpr, pts[0][1] * dpr, (base * (s.tool === 'pen' ? 0.5 + pts[0][2] : 1)) / 2, 0, Math.PI * 2);
    g.fill();
  } else if (s.tool === 'pen') {
    // the pen's width follows its pressure: one short piece per point, joined at mid-points
    let px = pts[0][0];
    let py = pts[0][1];
    for (let i = 1; i < pts.length; i++) {
      const [x, y, p] = pts[i];
      const mx = (pts[i - 1][0] + x) / 2;
      const my = (pts[i - 1][1] + y) / 2;
      g.beginPath();
      g.lineWidth = base * (0.5 + (pts[i - 1][2] + p) / 2);
      g.moveTo(px * dpr, py * dpr);
      g.quadraticCurveTo(pts[i - 1][0] * dpr, pts[i - 1][1] * dpr, mx * dpr, my * dpr);
      g.stroke();
      px = mx;
      py = my;
    }
    g.beginPath();
    g.lineWidth = base * (0.5 + pts.at(-1)[2]);
    g.moveTo(px * dpr, py * dpr);
    g.lineTo(pts.at(-1)[0] * dpr, pts.at(-1)[1] * dpr);
    g.stroke();
  } else {
    g.lineWidth = base;
    g.beginPath();
    g.moveTo(pts[0][0] * dpr, pts[0][1] * dpr);
    for (let i = 1; i < pts.length; i++) {
      const mx = (pts[i - 1][0] + pts[i][0]) / 2;
      const my = (pts[i - 1][1] + pts[i][1]) / 2;
      g.quadraticCurveTo(pts[i - 1][0] * dpr, pts[i - 1][1] * dpr, mx * dpr, my * dpr);
    }
    g.lineTo(pts.at(-1)[0] * dpr, pts.at(-1)[1] * dpr);
    g.stroke();
  }
  g.restore();
}

/** Paper, then the ink so far, then the stroke being drawn. */
function paint() {
  const d = drawing;
  if (!d) return;
  const g = drawCanvas.getContext('2d');
  g.globalCompositeOperation = 'source-over';
  g.globalAlpha = 1;
  if (d.paper) g.drawImage(d.paper, 0, 0, drawCanvas.width, drawCanvas.height);
  else {
    g.fillStyle = '#fff';
    g.fillRect(0, 0, drawCanvas.width, drawCanvas.height);
  }
  if (d.cur?.tool === 'eraser') {
    // erasing shows as it happens: on a copy of the ink
    const tmp = (d.tmp ??= Object.assign(document.createElement('canvas'), { width: d.ink.width, height: d.ink.height }));
    const t = tmp.getContext('2d');
    t.clearRect(0, 0, tmp.width, tmp.height);
    t.drawImage(d.ink, 0, 0);
    inkStroke(t, d.cur, d.dpr);
    g.drawImage(tmp, 0, 0);
  } else {
    g.drawImage(d.ink, 0, 0);
    if (d.cur) inkStroke(g, d.cur, d.dpr);
  }
}

function replayInk() {
  const d = drawing;
  const g = d.ink.getContext('2d');
  g.clearRect(0, 0, d.ink.width, d.ink.height);
  for (const s of d.strokes) inkStroke(g, s, d.dpr);
}

/** A pointer position on the paper, in CSS px of the canvas's own size (it may be letter-boxed). */
function drawPoint(e) {
  const r = drawCanvas.getBoundingClientRect();
  const cw = drawCanvas.width / drawing.dpr;
  const ch = drawCanvas.height / drawing.dpr;
  const k = Math.min(r.width / cw, r.height / ch);
  const ox = (r.width - cw * k) / 2;
  const oy = (r.height - ch * k) / 2;
  const pressure = e.pointerType === 'pen' && e.pressure > 0 ? e.pressure : 0.5;
  return [Math.round(((e.clientX - r.left - ox) / k) * 10) / 10, Math.round(((e.clientY - r.top - oy) / k) * 10) / 10, Math.round(pressure * 100) / 100];
}

drawCanvas.addEventListener('pointerdown', (e) => {
  const d = drawing;
  if (!d || d.cur) return;
  if (e.pointerType === 'pen') d.sawPen = true;
  else if (e.pointerType === 'touch' && d.sawPen) return; // the hand resting on the screen while the pen writes
  e.preventDefault();
  drawCanvas.setPointerCapture(e.pointerId);
  // the S Pen's side button (or the eraser end of a pen) erases
  const tool = e.pointerType === 'pen' && (e.buttons & 32 || e.button === 5 || e.buttons & 2) ? 'eraser' : d.tool;
  d.cur = { tool, color: d.color, size: d.size, pts: [drawPoint(e)], id: e.pointerId };
  paint();
});
drawCanvas.addEventListener('pointermove', (e) => {
  const d = drawing;
  if (!d?.cur || d.cur.id !== e.pointerId) return;
  for (const ev of e.getCoalescedEvents?.() ?? [e]) {
    const p = drawPoint(ev);
    const last = d.cur.pts.at(-1);
    if (Math.hypot(p[0] - last[0], p[1] - last[1]) >= 0.8) d.cur.pts.push(p);
  }
  paint();
});
const endStroke = (e) => {
  const d = drawing;
  if (!d?.cur || d.cur.id !== e.pointerId) return;
  const { id, ...stroke } = d.cur;
  d.cur = null;
  d.strokes.push(stroke);
  d.redo = [];
  inkStroke(d.ink.getContext('2d'), stroke, d.dpr);
  paint();
  syncDrawTools();
};
drawCanvas.addEventListener('pointerup', endStroke);
drawCanvas.addEventListener('pointercancel', endStroke);

drawDialog.addEventListener('click', (e) => {
  const d = drawing;
  if (!d) return;
  const tool = e.target.closest('[data-tool]')?.dataset.tool;
  const ink = e.target.closest('[data-ink]')?.dataset.ink;
  const size = e.target.closest('[data-size]')?.dataset.size;
  if (tool) d.tool = tool;
  if (ink) {
    d.color = ink;
    if (d.tool === 'eraser') d.tool = 'pen';
  }
  if (size) d.size = Number(size);
  const act = e.target.closest('[data-dact]')?.dataset.dact;
  if (act === 'undo' && d.strokes.length) {
    d.redo.push(d.strokes.pop());
    replayInk();
  }
  if (act === 'redo' && d.redo.length) {
    const s = d.redo.pop();
    d.strokes.push(s);
    inkStroke(d.ink.getContext('2d'), s, d.dpr);
  }
  if (act === 'clear' && d.strokes.length) {
    // clearing is one more step that can be undone
    d.redo = [];
    d.strokes.push({ tool: 'clear' });
    replayInk();
  }
  if (tool || ink || size || act === 'undo' || act === 'redo' || act === 'clear') {
    paint();
    syncDrawTools();
  }
  if (act === 'cancel') {
    if (d.strokes.length && Date.now() - drawCancelArmed > 4000) {
      drawCancelArmed = Date.now();
      toast('แตะ “ยกเลิก” อีกครั้งเพื่อทิ้งภาพวาดนี้');
      return;
    }
    drawDialog.close();
  }
  if (act === 'done') finishDraw();
});
drawDialog.addEventListener('cancel', (e) => {
  // Escape / back with ink on the paper: keep the drawing rather than lose it
  if (drawing?.strokes.length) {
    e.preventDefault();
    finishDraw();
  }
});
drawDialog.addEventListener('close', () => {
  if (!drawing) return;
  drawing.paper?.close?.();
  drawPrefs = { tool: drawing.tool, color: drawing.color, size: drawing.size };
  drawing = null;
});
drawDialog.addEventListener('keydown', (e) => {
  if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z') return;
  e.preventDefault();
  $(`[data-dact="${e.shiftKey ? 'redo' : 'undo'}"]`, drawDialog).click();
});

async function finishDraw() {
  const d = drawing;
  if (!d || d.saving) return;
  d.saving = true;
  if (!d.strokes.length) {
    drawDialog.close();
    return;
  }
  d.cur = null;
  paint();
  const target = draft;
  const [made] = await storeImages([drawCanvas], { png: !d.paper });
  drawDialog.close();
  if (!made || !target || draft !== target) return;
  const at = d.over ? draft.images.findIndex((x) => x.id === d.over.id) : -1;
  if (at >= 0) draft.images.splice(at, 1, made);
  else draft.images.push(made);
  renderDraftImages();
  saveDraft();
}


// ---------------------------------------------------------------------------
// Task dialog

const taskDialog = $('#task-dialog');
const taskForm = $('#task-form');

function openTask(id) {
  const t = state.tasks.find((x) => x.id === id);
  if (!t) return;
  editingId = id;
  taskForm.text.value = t.text;
  taskForm.day.value = t.day ?? '';
  taskForm.time.value = t.time ?? '';
  taskForm.repeat.value = t.repeat ? t.repeat.split(':')[0] : '';
  $('[data-act="link"]', taskForm).hidden = !URL_RE.test(t.text);
  markQuick();
  taskDialog.showModal();
}

function quickDay(kind) {
  if (kind === 'today') return today;
  if (kind === 'tomorrow') return addDays(today, 1);
  if (kind === 'next-week') return addDays(today, 8 - (fromKey(today).getDay() || 7)); // next Monday
  return null;
}

function markQuick() {
  const day = taskForm.day.value || null;
  for (const b of $$('[data-move]', taskForm)) b.classList.toggle('on', quickDay(b.dataset.move) === day);
}

function saveTask() {
  const t = state.tasks.find((x) => x.id === editingId);
  if (!t) return;
  const day = taskForm.day.value || null;
  const kind = taskForm.repeat.value;
  const d = day ? fromKey(day) : null;
  const repeat = !day || !kind ? null : kind === 'weekly' ? `weekly:${d.getDay()}` : kind === 'monthly' ? `monthly:${d.getDate()}` : kind;
  commit(S.editTask(state, t.id, { text: taskForm.text.value, day, time: day ? taskForm.time.value || null : null, repeat }), { undoable: true, animate: true });
}

taskForm.day.addEventListener('input', markQuick);

taskForm.addEventListener('submit', (e) => {
  e.preventDefault();
  saveTask();
  taskDialog.close();
});

taskForm.text.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    taskForm.requestSubmit();
  }
});

taskForm.addEventListener('click', async (e) => {
  const move = e.target.closest('[data-move]')?.dataset.move;
  if (move) {
    const day = quickDay(move);
    taskForm.day.value = day ?? '';
    if (!day) taskForm.time.value = '';
    saveTask();
    taskDialog.close();
    toast(day ? `ย้ายไป${describeWhen(day, null, today)}แล้ว` : 'ย้ายไปกล่องรับแล้ว', { label: 'เลิกทำ', run: undo });
    return;
  }
  const act = e.target.closest('[data-act]')?.dataset.act;
  const t = state.tasks.find((x) => x.id === editingId);
  if (!act || !t) return;
  if (act === 'cancel') taskDialog.close();
  if (act === 'delete') {
    taskDialog.close();
    commit(S.deleteTask(state, t.id), { undoable: true, animate: true });
    toast('ลบแล้ว', { label: 'เลิกทำ', run: undo });
  }
  if (act === 'link') window.open(t.text.match(URL_RE)[0], '_blank', 'noopener');
  if (act === 'claude') {
    saveTask();
    taskDialog.close();
    openClaude(C.breakdownPrompt(state.tasks.find((x) => x.id === t.id) ?? t, today));
    return;
  }
  if (act === 'focus') {
    saveTask();
    taskDialog.close();
    commit(S.startFocus(state, 25, Date.now(), t.text));
    setView('focus');
  }
  if (act === 'calendar') {
    if (!taskForm.day.value) {
      toast('ใส่วันก่อน แล้วค่อยลงปฏิทิน');
      taskForm.day.focus();
      return;
    }
    saveTask();
    const saved = state.tasks.find((x) => x.id === t.id);
    if (android) {
      const begin = toTimestamp(saved.day, saved.time ?? '00:00');
      const end = saved.time ? begin + 15 * 60_000 : toTimestamp(addDays(saved.day, 1));
      if (!android.addToCalendar(saved.text, begin, end, !saved.time)) toast('ไม่เจอแอปปฏิทินในเครื่อง');
      return;
    }
    await shareFile(icsFileName(saved), taskToICS(saved), 'text/calendar');
  }
});

taskDialog.addEventListener('close', () => {
  editingId = null;
});

// Tap outside a dialog closes it.
for (const dialog of $$('dialog')) {
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog && !dialog.classList.contains('full')) dialog.close();
    if (e.target.closest('[data-close]') && e.target.closest('dialog') === dialog) dialog.close();
  });
}

// ---------------------------------------------------------------------------
// Notes

const note = $('#note');
let noteTimer = null;

function syncNote() {
  if (document.activeElement !== note || note.value !== (state.notes[noteDay] ?? '')) note.value = state.notes[noteDay] ?? '';
  renderNoteHead();
}

function renderNoteHead() {
  if (view === 'notes') renderHero();
  $('#note-date').textContent = noteDay === today ? `วันนี้ · ${shortDate(noteDay)}` : longDate(noteDay);
  $('[data-note="today"]').hidden = noteDay === today;
}

note.addEventListener('input', () => {
  state = Y.stamp(state, S.setNote(state, noteDay, note.value));
  clearTimeout(noteTimer);
  noteTimer = setTimeout(save, 300);
});

function lineToTask() {
  const { line, rest, cursor } = S.takeLine(note.value, note.selectionStart);
  if (!line) {
    toast('วางเคอร์เซอร์ไว้บนบรรทัดที่มีข้อความก่อน');
    return;
  }
  const p = parseWhen(line, Date.now());
  commit(S.addTask(S.setNote(state, noteDay, rest), p), { undoable: true });
  note.value = rest;
  note.focus();
  note.setSelectionRange(cursor, cursor);
  toast(`ย้าย “${p.text}” ไป${p.day ? describeWhen(p.day, p.time, today) : 'กล่องรับ'}แล้ว`, { label: 'เลิกทำ', run: undo });
}

$('#line-to-task').addEventListener('click', lineToTask);
note.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    lineToTask();
  }
});

$('#view-notes').addEventListener('click', (e) => {
  const step = e.target.closest('[data-note]')?.dataset.note;
  if (!step) return;
  save();
  noteDay = step === 'today' ? today : addDays(noteDay, Number(step));
  syncNote();
});

// ---------------------------------------------------------------------------
// Focus timer

const RING = 339.29;
const fmt = (ms) => {
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};
const minutesText = (ms) => {
  const m = Math.round(ms / 60_000);
  return m >= 60 ? `${Math.floor(m / 60)} ชม. ${m % 60} น.` : `${m} นาที`;
};

function renderFocus() {
  const f = state.focus;
  const now = Date.now();
  const left = S.focusLeft(f, now);
  const preset = state.prefs.focusMinutes ?? 25;
  const running = f && f.endsAt != null;

  // One UI 7-style Now Bar above the composer while a timer runs (not on the timer page itself).
  const chip = $('#focus-chip');
  chip.hidden = !f || view === 'focus';
  chip.classList.toggle('paused', !!f && !running);
  $('.nb-time', chip).textContent = f ? fmt(left) : '';
  $('.nb-label', chip).textContent = f ? f.label || (running ? 'กำลังโฟกัส' : 'พักไว้') : '';
  chip.setAttribute('aria-label', f ? `โฟกัส เหลือ ${fmt(left)}` : 'โฟกัส');

  if (view !== 'focus') return;
  $('#focus-time').textContent = fmt(f ? left : preset * 60_000);
  $('#focus-label').textContent = f ? f.label || (running ? 'กำลังโฟกัส' : 'พักไว้') : 'พร้อมเมื่อไหร่ก็เริ่ม';
  $('.ring-bar').style.strokeDashoffset = String(f ? RING * (left / f.totalMs) : RING);
  $('#focus-controls').innerHTML = f
    ? `<button type="button" class="primary" data-focus="${running ? 'pause' : 'resume'}">${running ? 'พัก' : 'ทำต่อ'}</button>
       <button type="button" data-focus="extend">+5 นาที</button>
       <button type="button" data-focus="stop">จบ</button>`
    : `<button type="button" class="primary" data-focus="start">เริ่ม ${preset} นาที</button>`;
  for (const b of $$('.presets button')) b.classList.toggle('on', Number(b.dataset.minutes) === (f ? Math.round(f.totalMs / 60_000) : preset));

  const st = S.stats(state, today, now);
  $('#stats').innerHTML = [
    ['โฟกัสวันนี้', minutesText(st.focusTodayMs)],
    ['โฟกัส 7 วัน', minutesText(st.focusWeekMs)],
    ['เสร็จวันนี้', `${st.doneToday} เรื่อง`],
    ['เสร็จ 7 วัน', `${st.doneWeek} เรื่อง`],
    ['ยังค้าง', `${st.open} เรื่อง`],
  ]
    .map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`)
    .join('');
}

$('#view-focus').addEventListener('click', (e) => {
  const minutes = Number(e.target.closest('[data-minutes]')?.dataset.minutes);
  const now = Date.now();
  if (minutes) {
    const label = state.focus?.label ?? '';
    commit(S.startFocus({ ...state, prefs: { ...state.prefs, focusMinutes: minutes } }, minutes, now, label));
    unlockAudio();
    return;
  }
  const act = e.target.closest('[data-focus]')?.dataset.focus;
  if (act === 'start') {
    commit(S.startFocus(state, state.prefs.focusMinutes ?? 25, now));
    unlockAudio();
  }
  if (act === 'pause') commit(S.pauseFocus(state, now));
  if (act === 'resume') commit(S.resumeFocus(state, now));
  if (act === 'extend') commit(S.extendFocus(state, 5, now));
  if (act === 'stop') {
    const spent = S.focusElapsed(state.focus, now);
    commit(S.stopFocus(state, now), { undoable: true });
    toast(`โฟกัสไป ${minutesText(spent)}`);
  }
});

$('#focus-chip').addEventListener('click', () => (android && mode === 'panel' ? android.openFull('focus') : setView('focus')));
$('#open-full').addEventListener('click', () => android?.openFull(''));
$('#close-panel').addEventListener('click', () => android?.close());

function finishFocus() {
  const f = state.focus;
  const lateBy = Date.now() - f.endsAt;
  commit(S.stopFocus(state, f.endsAt));
  const text = `ครบ ${minutesText(f.totalMs)}แล้ว พักสายตาหน่อย`;
  toast(text);
  if (lateBy < 60_000) {
    chime();
    notify('ครบเวลาโฟกัส', f.label ? `${f.label} · ${text}` : text);
  }
}

// ---------------------------------------------------------------------------
// Reminders while the app is open (for alarms when it is closed: ลงปฏิทิน)

function checkDue() {
  const due = S.dueTasks(state, Date.now());
  if (!due.length) return;
  const now = Date.now();
  const fresh = due.filter((t) => now - toTimestamp(t.day, t.time) < 10 * 60_000);
  commit(S.markAlerted(state, due.map((t) => t.id)));
  if (!fresh.length) return;
  chime();
  toast(`ถึงเวลา: ${fresh[0].text}${fresh.length > 1 ? ` และอีก ${fresh.length - 1} เรื่อง` : ''}`, fresh.length === 1 ? { label: 'เลื่อน 10 นาที', run: () => snooze(fresh[0].id) } : undefined);
  for (const t of fresh) notify(`ถึงเวลา ${t.time} น.`, t.text, t.id);
}

/** From a notification button or the toast: ring again in a few minutes. */
function snooze(id, minutes = 10) {
  const t = state.tasks.find((x) => x.id === id);
  if (!t || t.done) return;
  commit(S.snoozeTask(state, id, minutes, Date.now()), { undoable: true });
  toast(`เลื่อน “${t.text}” ไป ${timeOf(new Date(S.ringAt(state.tasks.find((x) => x.id === id))))} น.`, { label: 'เลิกทำ', run: undo });
}

function markDone(id) {
  const t = state.tasks.find((x) => x.id === id);
  if (!t || t.done) return;
  commit(S.toggleDone(state, id, Date.now()), { undoable: true, animate: true });
  toast(t.repeat ? `เสร็จแล้ว รอบหน้า${describeWhen(state.tasks.find((x) => x.id === id).day, t.time, today)}` : `เสร็จแล้ว: ${t.text}`, { label: 'เลิกทำ', run: undo });
}

// Buttons on a notification (service worker → this page)
navigator.serviceWorker?.addEventListener('message', (e) => {
  const { type, action, id } = e.data ?? {};
  if (type !== 'notification-action') return;
  state = load();
  if (action === 'snooze') snooze(id);
  if (action === 'done') markDone(id);
});
navigator.serviceWorker?.startMessages?.();

let audio = null;
function unlockAudio() {
  try {
    audio ??= new AudioContext();
    if (audio.state === 'suspended') audio.resume();
  } catch {
    audio = null;
  }
}
document.addEventListener('pointerdown', unlockAudio, { once: true });

function chime() {
  try {
    unlockAudio();
    if (!audio) return;
    const t0 = audio.currentTime + 0.02;
    [784, 1175, 1568].forEach((freq, i) => {
      const t = t0 + i * 0.16;
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.22, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
      osc.connect(gain).connect(audio.destination);
      osc.start(t);
      osc.stop(t + 0.75);
    });
    navigator.vibrate?.([120, 80, 120]);
  } catch {
    // no sound available
  }
}

async function notify(title, body, id = null) {
  // In the Android app the alarms set through syncAndroid() notify instead.
  if (android || !('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    const actions = id
      ? [
          { action: 'snooze', title: 'เลื่อน 10 นาที' },
          { action: 'done', title: 'เสร็จแล้ว' },
        ]
      : [];
    if (reg) await reg.showNotification(title, { body, icon: 'icons/icon-192.png', tag: id ?? `${title}|${body}`, lang: 'th', data: { id }, actions });
    else new Notification(title, { body, icon: 'icons/icon-192.png' });
  } catch {
    // notifications blocked
  }
}

// ---------------------------------------------------------------------------
// Menu

const menu = $('#menu-dialog');
$('#menu-btn').addEventListener('click', () => {
  refreshMenu();
  menu.showModal();
});

function refreshMenu() {
  for (const b of $$('[data-menu="install"]')) b.hidden = !installPrompt;
  $('[data-menu="notify"]').hidden = !!android || !('Notification' in window) || Notification.permission === 'granted';
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  $('#installed-note').hidden = !standalone;
  $('#installed-note-ios').hidden = !standalone;
  renderSyncStatus();
  renderAndroid();
}

function notchOn() {
  try {
    return !!JSON.parse(android.info()).notch;
  } catch {
    return false;
  }
}

/** Notch status and switches in the guide (Android app only). */
function renderAndroid() {
  if (!android) return;
  let info = {};
  try {
    info = JSON.parse(android.info());
  } catch {
    return;
  }
  const status = $('#notch-status');
  status.textContent = info.notch ? '✓ แถบที่ notch เปิดอยู่' : 'แถบที่ notch ยังไม่ได้เปิด ทำตามข้อ 1';
  status.classList.toggle('on', !!info.notch);
  for (const box of $$('[data-android-pref]')) box.checked = !!info[box.dataset.androidPref];
  $('#version').textContent = `เวอร์ชัน ${VERSION} · แอป ${info.version ?? ''}`;
}

document.addEventListener('click', (e) => {
  const act = e.target.closest('[data-android]')?.dataset.android;
  if (!android || !act) return;
  if (act === 'notch-settings') android.openNotchSettings();
  if (act === 'app-info') android.openAppInfo();
});

document.addEventListener('change', (e) => {
  const pref = e.target.closest?.('[data-android-pref]')?.dataset.androidPref;
  if (!android || !pref) return;
  if (pref === 'pill') android.setPill(e.target.checked);
  if (pref === 'hideFullscreen') android.setHideFullscreen(e.target.checked);
});

document.addEventListener('click', async (e) => {
  const item = e.target.closest('[data-menu]')?.dataset.menu;
  if (!item) {
    if (e.target.closest('[data-action="guide-done"]')) commit({ ...state, prefs: { ...state.prefs, guideDone: true } });
    return;
  }
  if (item === 'sync') {
    menu.close();
    $('#guide-dialog').close();
    openSync();
    return;
  }
  if (item === 'claude') {
    menu.close();
    openClaude();
    return;
  }
  if (item === 'record') {
    menu.close();
    startRecording();
    return;
  }
  if (item === 'guide') {
    menu.close();
    refreshMenu();
    $('#guide-dialog').showModal();
  }
  if (item === 'install' && installPrompt) {
    installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    installPrompt = null;
    refreshMenu();
    if (outcome === 'accepted') toast('ติดตั้งแล้ว ต่อไปใส่ใน Edge panel ได้เลย');
  }
  if (item === 'notify') {
    const result = await Notification.requestPermission();
    toast(result === 'granted' ? 'เปิดแจ้งเตือนแล้ว จะเด้งเตือนตอนถึงเวลาขณะแอปเปิดหรือย่ออยู่' : 'ยังไม่ได้อนุญาตการแจ้งเตือน');
    refreshMenu();
  }
  if (item === 'copy') {
    const text = S.exportText(state, today, (d, t) => describeWhen(d, t, today));
    if (!text) {
      toast('ไม่มีเรื่องค้าง');
      return;
    }
    try {
      if (android) {
        if (!android.copyText(text)) throw new Error('no clipboard');
      } else {
        await navigator.clipboard.writeText(text);
      }
      toast('คัดลอกแล้ว วางในแชตหรือโน้ตได้เลย');
    } catch {
      await shareFile('paewai.txt', text, 'text/plain');
    }
  }
  if (item === 'clear-done') {
    const next = S.clearDone(state, today);
    const removed = state.tasks.length - next.tasks.length;
    commit(next, { undoable: true });
    toast(removed ? `ล้าง ${removed} เรื่องแล้ว` : 'ไม่มีเรื่องที่ต้องล้าง', removed ? { label: 'เลิกทำ', run: undo } : undefined);
  }
  if (item === 'export') {
    const pics = await backupMedia();
    await shareFile(`paewai-${today}.json`, JSON.stringify(pics.count ? { ...state, media: pics.media } : state, null, 1), 'application/json');
    if (pics.left) toast(`สำรองแล้ว แต่รูปอีก ${pics.left} รูปไม่ได้อยู่ในไฟล์ (ใหญ่เกินไป หรือยังไม่อยู่ในเครื่องนี้)`);
  }
  if (item === 'import') $('#import-file').click();
});

$('#import-file').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  let next = null;
  let raw = null;
  try {
    raw = JSON.parse(await file.text());
    next = S.sanitize(raw);
  } catch {
    next = null;
  }
  if (!next) {
    toast('ไฟล์นี้ไม่ใช่ไฟล์สำรองของแปะไว้');
    return;
  }
  const { state: merged, added } = S.restoreFrom(state, next);
  menu.close();
  const pics = await restoreMedia(raw?.media, N.imagesOf(merged.memos));
  if (!added) {
    toast(pics ? `กู้คืนรูป ${pics} รูปแล้ว` : 'ทุกอย่างในไฟล์สำรองมีอยู่แล้ว');
    if (pics) renderNotes();
    return;
  }
  commit(merged, { undoable: true });
  syncNote();
  toast(`กู้คืน ${added} รายการที่หายไป (ของที่มีอยู่ไม่ถูกแตะ)`, { label: 'เลิกทำ', run: undo });
});

const BACKUP_MEDIA_MAX = 40_000_000; // bytes of pictures in one backup file

/** The notes' pictures for a backup file: { media: { id: 'data:image/…;base64,…' }, count, left }. */
async function backupMedia() {
  const out = { media: {}, count: 0, left: 0 };
  let size = 0;
  for (const id of N.imagesOf(state.memos).keys()) {
    const rec = await media.get(id).catch(() => null);
    if (!rec || size + rec.blob.size > BACKUP_MEDIA_MAX) {
      out.left++;
      continue;
    }
    size += rec.blob.size;
    out.media[id] = await new Promise((ok) => {
      const reader = new FileReader();
      reader.onload = () => ok(String(reader.result));
      reader.onerror = () => ok('');
      reader.readAsDataURL(rec.blob);
    });
    if (out.media[id]) out.count++;
    else {
      delete out.media[id];
      out.left++;
    }
  }
  return out;
}

/** Puts back the pictures of a backup file that the notes use and this device lacks. → how many */
async function restoreMedia(pics, need) {
  if (!pics || typeof pics !== 'object') return 0;
  const local = await media.keys().catch(() => new Set());
  let n = 0;
  for (const [id, url] of Object.entries(pics)) {
    if (!need.has(id) || local.has(id) || typeof url !== 'string' || !url.startsWith('data:image/')) continue;
    try {
      const blob = await (await fetch(url)).blob();
      await adopt(id, await bytesOf(blob), blob.type);
      n++;
    } catch {
      // a damaged picture: the note stays, without it
    }
  }
  return n;
}

/** Saves a file: the share sheet where it can take files, else a download. */
async function shareFile(name, text, type) {
  if (android) {
    android.saveText(name, text, type);
    return;
  }
  const file = new File([text], name, { type });
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: name });
      return;
    }
  } catch (err) {
    if (err?.name === 'AbortError') return;
  }
  const url = URL.createObjectURL(file);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  if (type === 'text/calendar') toast('ดาวน์โหลดแล้ว แตะไฟล์เพื่อเพิ่มลงปฏิทิน');
}

// ---------------------------------------------------------------------------
// Toast

let toastTimer = null;
/** Over an open sheet the rest of the page is inert: the toast (and its undo) goes into the top sheet. */
function placeToast(el = $('#toast')) {
  const host = document.activeElement?.closest?.('dialog[open]') ?? [...document.querySelectorAll('dialog[open]:not(.popover)')].at(-1) ?? document.body;
  if (el.parentElement !== host) host.append(el);
}
// a sheet closing under a toast hands it on ('close' does not bubble, so listen while capturing)
document.addEventListener('close', (e) => e.target.contains?.($('#toast')) && placeToast(), true);

function toast(message, action) {
  const el = $('#toast');
  placeToast(el);
  el.innerHTML = `<span>${esc(message)}</span>${action ? `<button type="button">${esc(action.label)}</button>` : ''}`;
  if (action) $('button', el).addEventListener('click', () => {
    action.run();
    el.hidden = true;
  });
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), action ? 5000 : 2600);
}

// ---------------------------------------------------------------------------
// Keyboard (Book Cover Keyboard, DeX)

document.addEventListener('keydown', (e) => {
  const typing = e.target.closest?.('input, textarea, [contenteditable="true"]');
  if (document.querySelector('dialog[open]')) return;
  if ((!typing && e.key === '/') || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k')) {
    e.preventDefault();
    input.focus();
    input.select();
  } else if ((e.ctrlKey || e.altKey) && ['1', '2', '3', '4'].includes(e.key)) {
    e.preventDefault();
    setView(['tasks', 'notes', 'money', 'focus'][Number(e.key) - 1]);
  }
});

// ---------------------------------------------------------------------------
// Start-up: links from the home-screen shortcuts and from the share sheet

function handleLaunch() {
  const params = new URLSearchParams(location.search);
  params.delete('mode');
  if (![...params.keys()].length) return;
  const parts = [];
  for (const key of ['title', 'text', 'url']) {
    const v = params.get(key)?.trim();
    if (v && !parts.some((p) => p.includes(v))) parts.push(v);
  }
  if (parts.length) {
    const res = capture(parts.join(' '), { shared: true });
    if (res && !res.error) toast(`รับมาแล้ว: ${res.msg}`, { label: 'เลิกทำ', run: undo });
  }
  if (params.get('record')) setTimeout(startRecording, 300);
  if (params.get('snooze')) snooze(params.get('snooze'));
  if (params.get('done')) markDone(params.get('done'));
  const v = params.get('view');
  if (['notes', 'money', 'focus'].includes(v)) setView(v);
  const minutes = Number(params.get('focus'));
  if (minutes > 0 && minutes <= 180) {
    if (!state.focus) commit(S.startFocus(state, minutes, Date.now()));
    setView('focus');
  }
  history.replaceState(null, '', mode ? `${location.pathname}?mode=${encodeURIComponent(mode)}` : location.pathname);
}

let persisted = false;
function persistOnce() {
  if (persisted) return;
  persisted = true;
  navigator.storage?.persist?.().catch(() => {});
}

window.addEventListener('storage', (e) => {
  if (e.key === Y.SYNC_KEY) {
    syncCfg = loadSyncCfg();
    renderSyncStatus();
    return;
  }
  if (e.key === OVERFLOW_KEY && e.newValue) {
    refreshOverflow(e.newValue);
    return;
  }
  if (e.key !== S.STORAGE_KEY || overflow) return;
  state = load();
  render();
  syncNote();
});

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
  refreshMenu();
});

// Coming back to the window (e.g. tapping the floating bubble): ready to type straight away.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') {
    clearTimeout(noteTimer);
    save();
    return;
  }
  // Another window (the notch panel, another tab) may have saved in the meantime.
  state = load();
  render();
  syncNote();
  checkDue();
  scheduleSync(300);
  if (view === 'tasks' && !document.querySelector('dialog[open]') && document.activeElement === document.body) input.focus();
});

let lastMinute = new Date().getMinutes();
function tick() {
  const f = state.focus;
  if (f && f.endsAt != null && f.endsAt <= Date.now()) finishFocus();
  else if (f) renderFocus();
  if (dayKey(new Date()) !== today) {
    if (noteDay === today) noteDay = dayKey(new Date());
    render();
    syncNote();
  } else if (new Date().getMinutes() !== lastMinute && !swipe) {
    // "อีก 25 นาที", soon/late badges
    renderHero();
    renderTasks();
  }
  lastMinute = new Date().getMinutes();
}
setInterval(tick, 1000);
setInterval(checkDue, 15_000);

// ---------------------------------------------------------------------------
// Sync across devices: one JSON file in the person's own private GitHub repository (lib/sync.js)

let syncCfg = loadSyncCfg(); // { repo, token, lastSync, error, errorAt } or null; never part of the data or backups
let syncing = null;
let syncTimer = 0;
let syncPending = false;
let syncAgain = false;

function loadSyncCfg() {
  try {
    const c = JSON.parse(localStorage.getItem(Y.SYNC_KEY) ?? 'null');
    return c && Y.cleanRepo(c.repo) && Y.looksLikeToken(c.token) ? c : null;
  } catch {
    return null;
  }
}

function saveSyncCfg() {
  try {
    if (syncCfg) localStorage.setItem(Y.SYNC_KEY, JSON.stringify(syncCfg));
    else localStorage.removeItem(Y.SYNC_KEY);
  } catch {
    // storage blocked: works until the page closes
  }
}

function deviceName() {
  const ua = navigator.userAgent;
  if (android) return 'แอป Android';
  if (ios) return /iPhone/.test(ua) ? 'iPhone' : 'iPad';
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? 'มือถือ Android' : 'แท็บเล็ต Android';
  if (/Windows/.test(ua)) return 'Windows';
  if (/Mac/.test(ua)) return 'Mac';
  return 'เว็บ';
}

/** Syncs a moment later, so a burst of changes becomes one commit. Backs off after an error. */
function scheduleSync(ms = 2500) {
  if (!syncCfg) return;
  if (syncCfg.errorAt) ms = Math.max(ms, 120_000 - (Date.now() - syncCfg.errorAt));
  syncPending = true;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => runSync(), ms);
}

function runSync({ manual = false } = {}) {
  const cfg = syncCfg;
  if (!cfg) return Promise.resolve();
  if (syncing) {
    syncAgain = true;
    return syncing;
  }
  if (!manual && navigator.onLine === false) return Promise.resolve();
  clearTimeout(syncTimer);
  syncPending = false;
  const before = state;
  syncing = Y.syncOnce({
    gh: new GitHubRepo(cfg),
    local: before,
    add: (st, line, now) => route(st, classify(line, now), now),
    readFile: S.sanitize,
    device: deviceName(),
  })
    .then((res) => {
      if (syncCfg?.token !== cfg.token) return;
      applySynced(before, res.state);
      syncCfg = { ...syncCfg, lastSync: Date.now(), error: '', errorAt: 0 };
      saveSyncCfg();
      if (res.inbox) toast(`รับ ${res.inbox} เรื่องที่ส่งมาจากคำสั่งลัดหรือ Claude แล้ว`);
      syncMedia(); // the notes are in the repo: now their pictures
    })
    .catch((err) => {
      if (syncCfg?.token !== cfg.token) return;
      syncCfg = { ...syncCfg, error: explain(err), errorAt: Date.now() };
      saveSyncCfg();
    })
    .finally(() => {
      syncing = null;
      renderSyncStatus();
      if (syncAgain) {
        syncAgain = false;
        scheduleSync(300);
      }
    });
  renderSyncStatus();
  return syncing;
}

// ---- the pictures of notes: media/<id>.jpg in the same repo, a few each pass ----

const MEDIA_KEY = 'paewai:media'; // ids this device knows are in the repo
const mediaKnown = (() => {
  try {
    const v = JSON.parse(localStorage.getItem(MEDIA_KEY) ?? '[]');
    return new Set(Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
})();
const mediaMissed = new Map(); // id → when the repo did not have it yet (asked again after ten minutes)
let mediaBusy = null;
let mediaWanted = 0;

function saveMediaKnown() {
  try {
    localStorage.setItem(MEDIA_KEY, JSON.stringify([...mediaKnown]));
  } catch {
    // storage blocked
  }
}

/** A card found its picture missing on this device: fetch it soon. */
function wantMedia() {
  if (!syncCfg || mediaWanted) return;
  mediaWanted = setTimeout(() => {
    mediaWanted = 0;
    syncMedia();
  }, 1200);
}

/**
 * Sends the pictures the repo lacks, fetches the ones this device lacks, and removes from the
 * repo those no note uses any more (lib/notes.js mediaPlan). Runs after the notes themselves
 * are in the repo, so a picture there always has its note.
 */
function syncMedia() {
  const cfg = syncCfg;
  if (!cfg || navigator.onLine === false) return Promise.resolve();
  if (mediaBusy) return mediaBusy;
  const work = async () => {
    const gh = new GitHubRepo(cfg);
    const need = N.imagesOf(state.memos);
    const local = await media.keys();
    const now = Date.now();
    const plan = N.mediaPlan({ need, local, known: mediaKnown });
    let got = 0;
    for (const img of plan.upload) {
      const rec = await media.get(img.id);
      if (!rec) continue;
      try {
        await gh.writeBytes(N.mediaPath(img), await bytesOf(rec.blob), null, 'แปะไว้: รูปของโน้ต');
      } catch (err) {
        if (!isConflict(err)) throw err; // 409/422: it is there already
      }
      mediaKnown.add(img.id);
    }
    for (const img of plan.download) {
      if (now - (mediaMissed.get(img.id) ?? 0) < 600_000) continue;
      const file = await gh.readBytes(N.mediaPath(img));
      if (!file) {
        mediaMissed.set(img.id, now); // its device has not sent it yet
        continue;
      }
      await adopt(img.id, file.bytes, img.t === 'png' ? 'image/png' : 'image/jpeg');
      mediaKnown.add(img.id);
      got++;
    }
    if (plan.remove.length) {
      const files = await gh.list(N.MEDIA_DIR);
      for (const id of plan.remove) {
        const f = files.find((x) => x.name.startsWith(`${id}.`));
        if (f) await gh.remove(f.path, f.sha, 'แปะไว้: ลบรูปที่ไม่ใช้แล้ว');
        mediaKnown.delete(id);
      }
    }
    if (got) {
      $('#memos').dataset.html = '';
      renderNotes();
      if (draft && noteDialog.open) renderDraftImages();
    }
    return plan.more && (plan.upload.length || got || plan.remove.length);
  };
  mediaBusy = work()
    .then((more) => {
      if (more) setTimeout(syncMedia, 500);
    })
    .catch((err) => console.warn('media sync', err?.message ?? err))
    .finally(() => {
      mediaBusy = null;
      saveMediaKnown();
    });
  return mediaBusy;
}

/** Start-up housekeeping: the bin empties itself after a week, and pictures no note uses are freed. */
function tidyNotes() {
  if (!storageReady) return;
  const next = S.emptyOldTrash(state);
  if (next !== state) commit(next);
  // only with real data in hand: an unreadable state must never look like "no note uses these"
  if (!(state.tasks.length || state.memos.length || state.recs.length)) return;
  media.sweep(new Set(N.imagesOf(state.memos).keys())).catch(() => {});
}

/** Takes in what the sync brought. Edits made here while it ran are newer and stay (the next sync sends them). */
function applySynced(before, synced) {
  if (synced === before) return;
  const next = state === before ? synced : Y.merge(state, synced);
  if (next === state) return;
  state = next;
  undoState = null; // an undo now could bring back what another device removed
  save({ sync: state !== synced });
  rendered = animated(render);
  if (document.activeElement === note) renderNoteHead();
  else syncNote();
}

function renderSyncStatus() {
  const on = !!syncCfg;
  const err = syncCfg?.error;
  const status = !on ? '' : syncing ? 'กำลังซิงก์…' : err ? err : syncCfg.lastSync ? `ซิงก์แล้ว ${ago(syncCfg.lastSync)}` : 'รอซิงก์ครั้งแรก';
  $('#sync-menu-status').textContent = !on ? 'แท็บเล็ต · มือถือ · iPhone' : err ? 'มีปัญหา แตะเพื่อดู' : status;
  $('#sync-menu-status').classList.toggle('bad', !!err);
  $('#store-note').textContent = on ? 'เก็บในเครื่องนี้และใน GitHub ของคุณ' : 'เก็บในเครื่องนี้เท่านั้น';
  $('#sync-on').hidden = !on;
  $('#sync-off').hidden = on;
  if (!on) return;
  $('#sync-repo').textContent = syncCfg.repo;
  for (const el of $$('.sync-repo-name')) el.textContent = syncCfg.repo;
  $('#sync-status').textContent = status;
  $('#sync-dot').className = `sync-dot ${syncing ? 'busy' : err ? 'bad' : 'ok'}`;
  $('#sync-repo-link').href = `https://github.com/${syncCfg.repo}`;
  $('#shortcut-url').value = `https://api.github.com/repos/${syncCfg.repo}/contents/${Y.INBOX_DIR}/`;
  $('#shortcut-auth').value = `Bearer ${syncCfg.token}`;
}

const syncDialog = $('#sync-dialog');

function openSync(code = '') {
  showSyncNote('');
  $('#sync-pair').hidden = true;
  renderSyncStatus();
  if (code) {
    const cfg = Y.readPairCode(code);
    if (syncCfg) showSyncNote(`เครื่องนี้เชื่อมกับ ${syncCfg.repo} อยู่แล้ว ถ้าจะเปลี่ยน กด “เลิกซิงก์ในเครื่องนี้” ก่อน`);
    else if (cfg) {
      $('#pair-input').value = code;
      showSyncNote(`เชื่อมกับ repo ${cfg.repo} ไหม? กด “เชื่อม” ถ้าโค้ดนี้มาจากเครื่องของคุณเอง`, 'info');
    }
  }
  if (!syncDialog.open) syncDialog.showModal();
}

function showSyncNote(message, tone = 'bad') {
  const el = $('#sync-error');
  el.textContent = message;
  el.dataset.tone = tone;
  el.hidden = !message;
}

async function connectSync(cfg) {
  showSyncNote('กำลังเชื่อม…', 'info');
  const buttons = $$('[data-sync="connect"], [data-sync="join"]');
  for (const b of buttons) b.disabled = true;
  try {
    const gh = new GitHubRepo(cfg);
    const info = await gh.info();
    if (!info.private) {
      showSyncNote(`repo ${cfg.repo} เป็น Public ใครก็เห็นข้อมูลได้ ไปที่ Settings ของ repo → Change visibility → Private ก่อน แล้วเชื่อมใหม่`);
      return;
    }
    syncCfg = { repo: info.fullName || cfg.repo, token: cfg.token, lastSync: 0, error: '', errorAt: 0 };
    saveSyncCfg();
    await runSync({ manual: true });
    if (!syncCfg || syncCfg.error) {
      const why = syncCfg?.error ?? '';
      syncCfg = null;
      saveSyncCfg();
      renderSyncStatus();
      showSyncNote(why || 'เชื่อมไม่สำเร็จ');
      return;
    }
    // A guide next to the data, for people and for Claude (written once).
    try {
      if (!(await gh.read(Y.GUIDE_PATH))) await gh.write(Y.GUIDE_PATH, Y.DATA_GUIDE, null, 'แปะไว้: คู่มือข้อมูล (สำหรับคนและ Claude)');
      const readme = `${Y.INBOX_DIR}/README.md`;
      if (!(await gh.read(readme))) await gh.write(readme, Y.INBOX_README, null, 'แปะไว้: โฟลเดอร์ inbox');
    } catch {
      // optional
    }
    $('#sync-token-input').value = '';
    $('#pair-input').value = '';
    showSyncNote('');
    renderSyncStatus();
    toast('เชื่อมแล้ว รวมข้อมูลในเครื่องนี้กับ GitHub เรียบร้อย');
  } catch (err) {
    showSyncNote(explain(err));
  } finally {
    for (const b of buttons) b.disabled = false;
  }
}

async function copyText(text, done = 'คัดลอกแล้ว') {
  try {
    if (android) {
      if (!android.copyText(text)) throw new Error('no clipboard');
    } else await navigator.clipboard.writeText(text);
    if (done) toast(done);
    return true;
  } catch {
    if (done) toast('คัดลอกไม่ได้ กดค้างที่ข้อความแล้วเลือกคัดลอก');
    return false;
  }
}

async function showPair() {
  const box = $('#sync-pair');
  if (!box.hidden) {
    box.hidden = true;
    return;
  }
  const link = Y.pairLink(syncCfg);
  $('#sync-code').value = link;
  $('[data-sync="share"]').hidden = android || !navigator.share;
  box.hidden = false;
  try {
    const { default: qrcode } = await import('./vendor/qrcode.js');
    const qr = qrcode(0, 'L');
    qr.addData(link);
    qr.make();
    const n = qr.getModuleCount();
    let d = '';
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
    $('#sync-qr').innerHTML = `<svg viewBox="-3 -3 ${n + 6} ${n + 6}" shape-rendering="crispEdges" aria-hidden="true"><rect x="-3" y="-3" width="${n + 6}" height="${n + 6}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
    $('#sync-qr').hidden = false;
  } catch {
    $('#sync-qr').hidden = true;
  }
  box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

let offArmed = 0;
syncDialog.addEventListener('click', async (e) => {
  const button = e.target.closest('[data-sync]');
  const act = button?.dataset.sync;
  if (!act) return;
  if (act === 'connect') {
    const repo = Y.cleanRepo($('#sync-repo-input').value);
    const token = $('#sync-token-input').value.trim();
    if (!repo) return showSyncNote('ใส่ชื่อ repo แบบ ชื่อผู้ใช้/ชื่อ repo เช่น teelopnee/paewai-data');
    if (!Y.looksLikeToken(token)) return showSyncNote('โทเคนไม่ถูกรูปแบบ ต้องขึ้นต้นด้วย github_pat_');
    await connectSync({ repo, token });
  }
  if (act === 'join') {
    const cfg = Y.readPairCode($('#pair-input').value);
    if (!cfg) return showSyncNote('โค้ดไม่ถูกต้อง คัดลอกใหม่จากเครื่องที่เชื่อมแล้ว (⋮ → ซิงก์ข้ามเครื่อง → เชื่อมเครื่องอื่น)');
    await connectSync(cfg);
  }
  if (act === 'paste') {
    try {
      $('#pair-input').value = (await navigator.clipboard.readText()).trim();
    } catch {
      toast('กดค้างในช่องแล้วเลือก “วาง”');
      $('#pair-input').focus();
    }
  }
  if (act === 'now') {
    await runSync({ manual: true });
    toast(syncCfg?.error ? syncCfg.error : 'ซิงก์แล้ว');
  }
  if (act === 'pair') await showPair();
  if (act === 'copy') copyText($('#sync-code').value, 'คัดลอกแล้ว ส่งไปเครื่องอื่นของคุณได้เลย');
  if (act === 'share') navigator.share?.({ title: 'เชื่อมแปะไว้', url: $('#sync-code').value }).catch(() => {});
  if (act === 'off') {
    // Two taps: no browser confirm() (it does not show inside the Android app).
    if (Date.now() - offArmed > 4000) {
      offArmed = Date.now();
      button.textContent = 'แตะอีกครั้งเพื่อเลิกซิงก์';
      setTimeout(() => (button.textContent = 'เลิกซิงก์ในเครื่องนี้'), 4000);
      return;
    }
    offArmed = 0;
    button.textContent = 'เลิกซิงก์ในเครื่องนี้';
    syncCfg = null;
    saveSyncCfg();
    renderSyncStatus();
    toast('เลิกซิงก์ในเครื่องนี้แล้ว ข้อมูลยังอยู่ทั้งในเครื่องและใน GitHub');
  }
});

document.addEventListener('click', (e) => {
  const target = e.target.closest('[data-copy]')?.dataset.copy;
  if (target) copyText($(target).value);
});

/** A pairing link (#pair=…) opened on this device: ask before joining. */
function checkPairLink() {
  const m = /#pair=([^&]+)/.exec(location.hash);
  if (!m) return;
  history.replaceState(null, '', location.pathname + location.search);
  openSync(decodeURIComponent(m[1]));
}

setInterval(() => document.visibilityState === 'visible' && scheduleSync(0), 60_000);
addEventListener('online', () => scheduleSync(300));
document.addEventListener('visibilitychange', () => {
  // Leaving the app: send what is waiting now rather than in a few seconds.
  if (document.visibilityState === 'hidden' && syncPending) runSync();
});

// ---------------------------------------------------------------------------
// Ask Claude (lib/claude.js). The usual way needs no key: the app writes the whole prompt, the person
// pastes it into Claude (app or claude.ai), copies the answer and pastes it back into step 2, where
// readPasted() picks out what to file. With the person's own API key there is also "ถามในแอป".
// One sheet, three jobs: a question ('ask'), a recording to summarise ('rec'), a mind map to grow ('map').

const claudeDialog = $('#claude-dialog');
let claudeCfg = loadClaudeCfg(); // { key, model } on this device only
let claudeItems = [];
let asking = null;
const JOB_KEY = 'paewai:claude-job'; // survives the page being reloaded while the person is in Claude
let claudeJob = loadJob();
let claudeSent = ''; // the prompt last copied, so it is not mistaken for the answer

function loadClaudeCfg() {
  try {
    const c = JSON.parse(localStorage.getItem(C.CLAUDE_KEY) ?? 'null');
    return c && typeof c === 'object' ? c : {};
  } catch {
    return {};
  }
}

function saveClaudeCfg() {
  try {
    localStorage.setItem(C.CLAUDE_KEY, JSON.stringify(claudeCfg));
  } catch {
    // storage blocked
  }
  renderClaude();
}

function loadJob() {
  try {
    const j = JSON.parse(sessionStorage.getItem(JOB_KEY) ?? 'null');
    return j && ['rec', 'map'].includes(j.kind) && typeof j.id === 'string' ? j : { kind: 'ask' };
  } catch {
    return { kind: 'ask' };
  }
}

function setJob(job) {
  const same = job.kind === claudeJob.kind && job.id === claudeJob.id;
  claudeJob = job;
  try {
    if (job.kind === 'ask') sessionStorage.removeItem(JOB_KEY);
    else sessionStorage.setItem(JOB_KEY, JSON.stringify(job));
  } catch {
    // storage blocked
  }
  return same;
}

/**
 * Opens the sheet. `question` fills the question box; `job` says what is being sent (a question
 * by default); `settings` opens the settings at the bottom (transcription, optional API key).
 */
function openClaude(question = '', { settings = false, job = { kind: 'ask' }, pasted = '' } = {}) {
  const same = setJob(job);
  if (question) $('#claude-q').value = question;
  if (!same || question || pasted) {
    $('#claude-paste').value = pasted;
    $('#claude-out').hidden = true;
    $('#claude-out').innerHTML = '';
  }
  $('#claude-key').value = claudeCfg.key ?? '';
  $('#claude-model').value = C.MODELS.includes(claudeCfg.model) ? claudeCfg.model : C.DEFAULT_MODEL;
  $('#stt-provider').value = sttProvider();
  $('#stt-gemini').value = voiceCfg.geminiKey ?? '';
  $('#stt-openai').value = voiceCfg.openaiKey ?? '';
  renderAiSettings();
  android?.sttRefresh?.();
  renderSttSettings();
  $('#claude-settings').open = settings;
  $('#claude-preview').open = false;
  $('#claude-step2').classList.remove('waiting');
  renderClaude();
  if (!claudeDialog.open) claudeDialog.showModal();
  if (settings) requestAnimationFrame(() => $('#claude-settings').scrollIntoView({ block: 'start', behavior: 'smooth' }));
  if (pasted) readClaudePaste();
  else if (question && claudeCfg.key && job.kind === 'ask') askClaude();
}

const nf = (n) => n.toLocaleString('th-TH');

/** What this job sends to Claude ('' when there is nothing to send). */
function claudePrompt() {
  if (claudeJob.kind === 'rec') return recPrompt(findRec(claudeJob.id));
  if (claudeJob.kind === 'map') {
    const map = state.maps.find((m) => m.id === claudeJob.id);
    return map ? C.mapWebPrompt(C.mapOutline(map)) : '';
  }
  const question = $('#claude-q').value.trim();
  return question ? C.webPrompt(question, $('#claude-context').checked ? C.contextFor(state, today) : '', { today: longDate(today) }) : '';
}

/** A recording for a model to summarise: its text with times, its bookmarks, and how to answer. */
function recPrompt(r) {
  if (!r?.transcript?.trim()) return '';
  const at = new Date(r.at);
  return C.noteWebPrompt(C.timedText(r.transcript, r.times), 'การถอดเสียง', {
    title: r.title,
    when: `${longDate(dayKey(at))} เวลา ${timeOf(at)} น.`,
    timed: !!r.times?.length,
    pins: markLines(r),
  });
}

/** Big prompts may be more than one chat takes (Thai is about one token per character or two). */
const LONG_PROMPT = 150_000;

function renderClaude() {
  const kind = claudeJob.kind;
  const rec = kind === 'rec' ? findRec(claudeJob.id) : null;
  const map = kind === 'map' ? state.maps.find((m) => m.id === claudeJob.id) : null;
  $('#claude-title').lastChild.textContent = kind === 'rec' ? 'สรุปบันทึกด้วย Claude' : kind === 'map' ? 'ขยายมายด์แมปด้วย Claude' : 'ถาม Claude';
  $('#claude-ask').hidden = kind !== 'ask';
  const job = $('#claude-job');
  job.hidden = kind === 'ask';
  if (rec) job.textContent = `ส่งข้อความที่ถอดจาก “${rec.title}” (${nf(rec.transcript?.length ?? 0)} ตัวอักษร) ให้ Claude สรุป ทำมายด์แมป และหาสิ่งที่ต้องทำ`;
  if (map) job.textContent = `ส่งโครงร่างของ “${Mm.titleOf(map)}” (${map.nodes.length} กิ่ง) ให้ Claude เติมกิ่งย่อยและจัดให้เป็นระเบียบ`;
  $('#claude-step2-hint').textContent =
    kind === 'rec'
      ? 'ใน Claude กดปุ่มคัดลอกใต้คำตอบ แล้วกลับมาวางตรงนี้ แอปจะใส่ชื่อเรื่อง สรุป มายด์แมป และสิ่งที่ต้องทำลงบันทึกนี้ให้'
      : kind === 'map'
        ? 'ใน Claude กดปุ่มคัดลอกใต้คำตอบ (หรือที่กล่องโค้ด) แล้วกลับมาวางตรงนี้ แอปจะเปลี่ยนมายด์แมปตามโครงร่างใหม่ (เลิกทำได้)'
        : 'ใน Claude กดปุ่มคัดลอกใต้คำตอบ แล้วกลับมาวางตรงนี้ แอปจะแยกสิ่งที่ควรแปะให้เลือก';
  $('[data-claude="ask"]').hidden = !claudeCfg.key;
  $('[data-claude="ask"] span').textContent = kind === 'ask' ? 'ถามในแอป (API)' : 'ให้ Claude ทำในแอป (API)';
  const prompt = claudePrompt();
  $('#claude-size').textContent = prompt ? `· ${nf(prompt.length)} ตัวอักษร` : '';
  const long = $('#claude-long');
  long.hidden = prompt.length <= LONG_PROMPT;
  if (!long.hidden) long.textContent = 'ข้อความยาวมาก ถ้า Claude บอกว่ายาวเกินที่รับได้ ให้ใช้ “สรุปในเครื่อง” แทน หรือแบ่งส่งทีละช่วง';
  if ($('#claude-preview').open) showPrompt(prompt);
}

/** The prompt as it will be sent (only the start of a very long one: the page stays light). */
function showPrompt(prompt = claudePrompt()) {
  const max = 20_000;
  $('#claude-prompt').textContent = prompt
    ? prompt.length > max ? `${prompt.slice(0, max)}\n\n… (อีก ${nf(prompt.length - max)} ตัวอักษร คัดลอกไปครบทั้งหมด)` : prompt
    : 'พิมพ์คำถาม หรือแตะคำถามสำเร็จรูปก่อน';
}

/** Step 1: copies the prompt (and opens Claude). Synchronous up to the link, so pop-up blockers allow it. */
function sendToClaude(open) {
  const prompt = claudePrompt();
  if (!prompt) {
    if (claudeJob.kind === 'ask') {
      toast('พิมพ์คำถาม หรือแตะคำถามสำเร็จรูปก่อน');
      $('#claude-q').focus();
    } else toast(claudeJob.kind === 'rec' ? 'ถอดเสียงก่อน แล้วค่อยส่งให้ Claude' : 'ไม่เจอมายด์แมปนี้แล้ว');
    return;
  }
  const copied = copyText(prompt, null);
  claudeSent = prompt;
  if (open) {
    const a = Object.assign(document.createElement('a'), { href: C.CLAUDE_WEB, target: '_blank', rel: 'noopener' });
    document.body.append(a);
    a.click();
    a.remove();
  }
  $('#claude-step2').classList.add('waiting');
  copied.then((ok) => {
    if (ok) toast(open ? 'คัดลอกแล้ว วางในแชตของ Claude แล้วกดส่ง ได้คำตอบแล้วคัดลอกกลับมาวางที่ข้อ 2' : 'คัดลอกแล้ว ไปวางในแชตใหม่ของ Claude แล้วกดส่ง');
    else {
      $('#claude-preview').open = true;
      showPrompt(prompt);
      toast('คัดลอกไม่ได้ กดค้างที่ข้อความด้านล่างเพื่อเลือกทั้งหมดแล้วคัดลอก');
    }
  });
}

/** Step 2: reads what was pasted and does what the job is for. */
function readClaudePaste() {
  const text = $('#claude-paste').value.trim();
  if (!text) {
    toast('วางคำตอบจาก Claude ก่อน');
    $('#claude-paste').focus();
    return;
  }
  if (claudeSent && text === claudeSent.trim()) {
    toast('นี่คือคำถามที่คัดลอกไป ส่งใน Claude ก่อน แล้วคัดลอกคำตอบกลับมา');
    return;
  }
  $('#claude-step2').classList.remove('waiting');
  const p = C.readPasted(text);
  if (claudeJob.kind === 'rec') applyRecAnswer(claudeJob.id, p);
  else if (claudeJob.kind === 'map') applyMapAnswer(claudeJob.id, p);
  else {
    // no แปะไว้ block: offer the answer's list lines, unticked
    const items = p.items.length ? p.items : listLines(p.reply).map((it) => ({ ...it, off: true }));
    showAnswer({ reply: p.reply || text, items, note: p.items.length || !items.length ? '' : 'คำตอบนี้ไม่มีกล่อง “แปะไว้” เลือกบรรทัดที่อยากแปะเองได้' });
  }
}

/** The bulleted or numbered lines of an answer, as things that could be filed. */
function listLines(text) {
  return String(text ?? '')
    .split('\n')
    .filter((l) => /^\s*(?:[-*•]|\d{1,2}[.)])\s+\S/.test(l))
    .map((l) => ({ kind: null, text: pastedLines(l)[0] ?? '' }))
    .filter((it) => it.text && it.text.length <= 200)
    .slice(0, 15);
}

/** Pastes from the clipboard (the Android app reads it itself; browsers ask first). */
async function pasteFromClipboard({ quiet = false } = {}) {
  let text = '';
  try {
    text = android?.readClipboard ? android.readClipboard() : await navigator.clipboard.readText();
  } catch {
    text = '';
  }
  text = String(text ?? '').trim();
  if (!text || (claudeSent && text === claudeSent.trim())) {
    if (!quiet) toast(text ? 'ในคลิปบอร์ดยังเป็นคำถามอยู่ คัดลอกคำตอบจาก Claude ก่อน' : 'วางเองได้: กดค้างในช่องแล้วเลือกวาง');
    return false;
  }
  if (quiet) {
    // coming back from Claude: only take what is clearly an answer
    const p = C.readPasted(text);
    if (!C.isAnswer(text) && !p.items.length && !p.outline && !p.summary) return false;
  }
  $('#claude-paste').value = text;
  readClaudePaste();
  return true;
}

// Back from Claude: point at step 2, and on Android take the answer straight from the clipboard.
let backCheck = 0;
function backFromClaude() {
  if (!claudeDialog.open || !$('#claude-step2').classList.contains('waiting') || $('#claude-paste').value.trim()) return;
  clearTimeout(backCheck);
  backCheck = setTimeout(async () => {
    $('#claude-step2').scrollIntoView({ block: 'center', behavior: 'smooth' });
    if (android?.readClipboard && (await pasteFromClipboard({ quiet: true }))) toast('วางคำตอบจาก Claude ให้แล้ว');
  }, 250);
}
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && backFromClaude());
window.addEventListener('focus', backFromClaude);

/** Bold, bullets and paragraphs from Claude's text, safely. */
function miniMarkdown(text) {
  const blocks = [];
  let list = [];
  const flush = () => {
    if (list.length) blocks.push(`<ul>${list.map((l) => `<li>${l}</li>`).join('')}</ul>`);
    list = [];
  };
  const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  for (const raw of String(text).split('\n')) {
    const line = raw.trim();
    const bullet = /^(?:[-*•]|\d+[.)])\s+(.*)$/.exec(line);
    if (bullet) list.push(inline(bullet[1]));
    else {
      flush();
      if (line && !/^(`{3,}|~{3,})/.test(line)) blocks.push(`<p>${inline(line.replace(/^#+\s*/, ''))}</p>`);
    }
  }
  flush();
  return blocks.join('');
}

function claudeError(err, Anthropic) {
  if (Anthropic && err instanceof Anthropic.APIUserAbortError) return '';
  if (Anthropic && err instanceof Anthropic.AuthenticationError) return 'API key ใช้ไม่ได้ ตรวจที่ console.anthropic.com แล้วใส่ใหม่';
  if (Anthropic && err instanceof Anthropic.PermissionDeniedError) return 'คีย์นี้ไม่มีสิทธิ์ใช้รุ่นนี้ ลองเปลี่ยนรุ่นในตั้งค่า';
  if (Anthropic && err instanceof Anthropic.RateLimitError) return 'ถามถี่เกินไปหรือเครดิตหมด รอสักครู่แล้วลองใหม่';
  if (Anthropic && err instanceof Anthropic.BadRequestError) return `ส่งคำถามไม่ได้: ${err.message}`;
  if (Anthropic && err instanceof Anthropic.APIConnectionError) return 'ต่อ Claude ไม่ได้ ตรวจอินเทอร์เน็ตแล้วลองใหม่';
  if (Anthropic && err instanceof Anthropic.APIError && (err.status ?? 0) >= 500) return 'Claude ยุ่งอยู่ ลองใหม่อีกครั้ง';
  return err?.message || 'ถาม Claude ไม่สำเร็จ';
}

/** "ถามในแอป": only with the person's own API key (optional). */
async function askClaude() {
  if (claudeJob.kind === 'rec') {
    const id = claudeJob.id;
    claudeDialog.close();
    analyzeRec(id);
    return;
  }
  if (claudeJob.kind === 'map') {
    claudeDialog.close();
    expandMapApi(claudeJob.id);
    return;
  }
  const question = $('#claude-q').value.trim();
  if (!question) {
    toast('พิมพ์คำถาม หรือแตะคำถามสำเร็จรูปก่อน');
    return;
  }
  if (!claudeCfg.key) {
    sendToClaude(true);
    return;
  }
  if (asking) return;
  const out = $('#claude-out');
  const button = $('[data-claude="ask"]');
  out.hidden = false;
  out.innerHTML = '<p class="thinking"><span class="dot-pulse" aria-hidden="true"></span>Claude กำลังคิด…</p>';
  button.disabled = true;
  const context = $('#claude-context').checked ? C.contextFor(state, today) : '';
  let Anthropic = null;
  try {
    ({ Anthropic } = await import('./vendor/anthropic.js'));
    const client = new Anthropic({ apiKey: claudeCfg.key, dangerouslyAllowBrowser: true });
    asking = client.beta.messages.stream(C.request({ model: claudeCfg.model, question, context }));
    showAnswer(C.readAnswer(await asking.finalMessage()));
  } catch (err) {
    const message = claudeError(err, Anthropic);
    out.innerHTML = message ? `<p class="sync-error">${esc(message)}</p>` : '';
    out.hidden = !message;
  } finally {
    asking = null;
    button.disabled = false;
  }
}

function showAnswer({ reply, items, note: why }) {
  claudeItems = items;
  const now = Date.now();
  const rows = items.map((it, i) => {
    const r = classify(it.text, now, { force: it.kind || null });
    const when = r.kind === 'task' && r.day ? describeWhen(r.day, r.time, today) : r.kind === 'money' && r.amount ? baht(r.amount) : '';
    const tone = r.kind === 'task' && r.day ? 'remind' : r.kind;
    return `<li><label><input type="checkbox" data-i="${i}"${it.off ? '' : ' checked'}><span class="kind-chip small k-${tone}">${esc(KIND_NAMES[r.kind])}</span><span class="suggest-text">${esc(r.kind === 'shop' && r.items.length > 1 ? r.items.map((x) => x.text).join(' · ') : r.text)}${when ? ` <em>${esc(when)}</em>` : ''}</span></label></li>`;
  });
  const out = $('#claude-out');
  out.hidden = false;
  out.innerHTML =
    (reply ? `<div class="answer">${miniMarkdown(reply)}</div>` : '') +
    (why ? `<p class="dim small">${esc(why)}</p>` : '') +
    (items.length
      ? `<div class="suggest"><p class="suggest-title">แปะลงแอปได้เลย</p><ul>${rows.join('')}</ul><button type="button" class="primary" data-claude="add">แปะที่เลือก</button></div>`
      : '') +
    (reply ? `<button type="button" class="text-btn" data-claude="copy">คัดลอกคำตอบ</button>` : '');
  requestAnimationFrame(() => out.scrollIntoView({ block: 'start', behavior: 'smooth' }));
}

const KIND_NAMES = { task: 'งาน', note: 'โน้ต', shop: 'ซื้อ', money: 'จ่าย' };

function addClaudeItems() {
  const now = Date.now();
  let next = state;
  let n = 0;
  for (const box of $$('#claude-out input[data-i]:checked')) {
    const it = claudeItems[Number(box.dataset.i)];
    if (!it) continue;
    const r = classify(it.text, now, { force: it.kind || null });
    if (r.kind === 'money' && !r.amount) continue;
    next = route(next, r, now + n);
    n++;
  }
  if (!n) {
    toast('ยังไม่ได้เลือกอะไร');
    return;
  }
  claudeDialog.close();
  $('#claude-paste').value = '';
  commit(next, { undoable: true, animate: true });
  toast(`แปะ ${n} เรื่องจาก Claude แล้ว`, { label: 'เลิกทำ', run: undo });
}

claudeDialog.addEventListener('click', (e) => {
  const preset = e.target.closest('[data-ask]')?.dataset.ask;
  if (preset) {
    $('#claude-q').value = C.PRESETS[preset];
    renderClaude();
    if (claudeCfg.key) askClaude();
    return;
  }
  const act = e.target.closest('[data-claude]')?.dataset.claude;
  if (act === 'ask') askClaude();
  if (act === 'open') sendToClaude(true);
  if (act === 'copy-prompt') sendToClaude(false);
  if (act === 'clip') pasteFromClipboard();
  if (act === 'read') readClaudePaste();
  if (act === 'add') addClaudeItems();
  if (act === 'copy') copyText($('#claude-out .answer')?.innerText ?? '');
});
$('#claude-preview').addEventListener('toggle', (e) => e.target.open && showPrompt());
$('#claude-q').addEventListener('input', () => renderClaude());
$('#claude-context').addEventListener('change', () => renderClaude());
// a pasted answer is read straight away
$('#claude-paste').addEventListener('paste', () => setTimeout(readClaudePaste, 0));
$('#claude-key').addEventListener('change', (e) => {
  claudeCfg = { ...claudeCfg, key: e.target.value.trim() };
  saveClaudeCfg();
});
$('#claude-model').addEventListener('change', (e) => {
  claudeCfg = { ...claudeCfg, model: e.target.value };
  saveClaudeCfg();
});
$('#claude-q').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    if (claudeCfg.key) askClaude();
    else sendToClaude(true);
  }
});
claudeDialog.addEventListener('close', () => asking?.abort());

// ---------------------------------------------------------------------------
// Voice notes (lib/voice.js): record → transcribe → summary and mind map, made on the device
// (lib/summarize.js, no AI) or by Claude when asked

const readLocal = (key, fallback) => {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null') ?? fallback;
  } catch {
    return fallback;
  }
};
const writeLocal = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage blocked
  }
};

let voiceCfg = readLocal(V.VOICE_KEY, {}); // { provider, geminiKey, openaiKey } on this device only
// Default: the device's own speech recognition (no key, no other AI).
const sttProvider = () => (V.PROVIDERS[voiceCfg.provider] ? voiceCfg.provider : 'device');
const sttKey = () => (sttProvider() === 'openai' ? voiceCfg.openaiKey : sttProvider() === 'gemini' ? voiceCfg.geminiKey : '') ?? '';

/** What "ระบบของเครื่อง" can do here: { where: android|browser|none, ok, text, download, retry }. */
function deviceStt() {
  if (android?.sttInfo) {
    let i = {};
    try {
      i = JSON.parse(android.sttInfo());
    } catch {
      // older app
    }
    if (i.available === false) return { where: 'android', ok: false, text: 'แท็บเล็ตนี้ยังไม่ได้เลือกระบบรู้จำเสียง: ในแอปการตั้งค่า ค้นหา “การป้อนข้อมูลด้วยเสียง” (Voice input) แล้วเลือกของ Google หรือ Samsung' };
    if (i.sdk && i.sdk < 33) return { where: 'android', ok: false, text: 'ต้องใช้ Android 13 ขึ้นไปจึงจะถอดจากเสียงที่อัดได้' };
    if (i.refused) return { where: 'android', ok: false, retry: true, text: 'ระบบรู้จำเสียงที่ตั้งไว้ในเครื่องรับเสียงจากแอปอื่นไม่ได้ จึงปิดไว้เพื่อไม่ให้การอัดเสียงสะดุด ลองเปลี่ยนเป็นของ Google (ในแอปการตั้งค่า ค้นหา “การป้อนข้อมูลด้วยเสียง” / Voice input) แล้วแตะลองใหม่' };
    const thai = {
      installed: 'ถอดภาษาไทยในเครื่องได้ทันที เสียงไม่ออกนอกเครื่อง',
      downloading: 'กำลังดาวน์โหลดภาษาไทยลงเครื่อง ระหว่างนี้จะถอดผ่านเน็ต',
      downloadable: 'ถอดได้เลย (ผ่านเน็ต) · ดาวน์โหลดภาษาไทยลงเครื่องเพื่อถอดได้แม้ไม่มีเน็ต และเสียงไม่ออกนอกเครื่อง',
      online: 'ถอดด้วยระบบรู้จำเสียงที่มากับเครื่อง (ต้องต่อเน็ต)',
      none: 'ระบบรู้จำเสียงในเครื่องยังไม่รองรับภาษาไทย',
    }[i.thai];
    return {
      where: 'android',
      ok: i.thai !== 'none',
      download: i.thai === 'downloadable',
      text: `${thai ?? 'ถอดด้วยระบบรู้จำเสียงที่มากับแท็บเล็ต (Samsung/Google) ระหว่างอัด ข้อความพร้อมตอนกดหยุด'}`,
    };
  }
  if (V.LiveCaption.supported) return { where: 'browser', ok: true, text: 'ถอดสดระหว่างอัดด้วยระบบของเบราว์เซอร์ (ต้องต่อเน็ต) · ถอดไฟล์ที่อัดไว้แล้วต้องใช้แอป Android หรือบริการที่ใช้คีย์' };
  return { where: 'none', ok: false, text: 'เบราว์เซอร์นี้ถอดเสียงเองไม่ได้ ใช้แอปแปะไว้บน Android หรือเลือกบริการที่ใช้คีย์' };
}

function renderSttSettings() {
  renderBattery();
  const device = sttProvider() === 'device';
  $('#stt-device').hidden = !device;
  $('#stt-keys').hidden = device;
  if (!device) return;
  const d = deviceStt();
  $('#stt-device-status').textContent = d.text;
  $('[data-stt="download"]').hidden = !d.download;
  $('[data-stt="retry"]').hidden = !d.retry;
}

/** Android app: is แปะไว้ safe from battery saving for hours of recording, and how much room is left. */
function renderBattery() {
  const box = $('#rec-battery');
  let b = null;
  try {
    b = android?.batteryInfo ? JSON.parse(android.batteryInfo()) : null;
  } catch {
    b = null;
  }
  box.hidden = !b;
  if (!b) return;
  const hours = Math.floor((b.freeMb || 0) / 22);
  const room = b.freeMb ? ` · ที่ว่าง ${b.freeMb >= 1024 ? `${(b.freeMb / 1024).toFixed(1)} GB` : `${b.freeMb} MB`} อัดได้อีกราว ${hours.toLocaleString('th-TH')} ชั่วโมง` : '';
  const samsung = b.samsung ? ' ใน Samsung เพิ่มแปะไว้ในรายการแอปที่ไม่ต้องสลีปด้วย: การตั้งค่า → แบตเตอรี่ → ขีดจำกัดการใช้งานเบื้องหลัง (Background usage limits) → Never sleeping apps' : '';
  $('#rec-battery-status').textContent = b.ignoring
    ? `แปะไว้ได้รับยกเว้นจากการประหยัดแบตแล้ว อัดต่อได้แม้ปิดจอนาน ๆ${room}${samsung ? ` ·${samsung}` : ''}`
    : `ระบบประหยัดแบตอาจหยุดแปะไว้เมื่อปิดจอนาน ๆ แตะปุ่มด้านล่างแล้วเลือก “อนุญาต”${room}${samsung ? ` ·${samsung}` : ''}`;
  $('[data-battery="ask"]').hidden = !!b.ignoring;
}

$('#rec-battery').addEventListener('click', (e) => {
  if (e.target.closest('[data-battery="ask"]')) {
    if (!android?.batterySettings?.()) toast('เปิดหน้าตั้งค่าแบตเตอรี่ไม่ได้');
    setTimeout(renderBattery, 1500);
  }
});
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && !$('#rec-battery').hidden && renderBattery());

$('#stt-device').addEventListener('click', (e) => {
  const act = e.target.closest('[data-stt]')?.dataset.stt;
  if (act === 'download') toast(android?.sttDownload?.() ? 'เริ่มดาวน์โหลดภาษาไทยแล้ว (ดูความคืบหน้าในการแจ้งเตือน)' : 'ดาวน์โหลดจากในแอปไม่ได้ ในแอปการตั้งค่า ค้นหา “การรู้จำเสียง” หรือ “Voice input” แล้วเพิ่มภาษาไทย');
  if (act === 'retry') android?.sttReset?.();
  setTimeout(renderSttSettings, 800);
});

for (const [sel, field] of [
  ['#stt-provider', 'provider'],
  ['#stt-gemini', 'geminiKey'],
  ['#stt-openai', 'openaiKey'],
  ['#ai-provider', 'ai'],
  ['#ai-gemini-key', 'geminiKey'],
  ['#ai-openrouter-key', 'openrouterKey'],
  ['#ai-openrouter-model', 'openrouterModel'],
]) {
  $(sel).addEventListener('change', (e) => {
    voiceCfg = { ...voiceCfg, [field]: e.target.value.trim() };
    writeLocal(V.VOICE_KEY, voiceCfg);
    renderSttSettings();
    renderAiSettings();
    if (recview.open) renderRecView();
  });
}

// ---- optional AI (lib/ai.js): Gemini or OpenRouter with the person's own key, for cleaning up
// a transcript and for the summary and mind map. Nothing is sent unless they press its buttons.

/** { provider, key, model } when a service is chosen and has its key, else null. */
function aiCfg() {
  if (voiceCfg.ai === 'gemini' && voiceCfg.geminiKey) return { provider: 'gemini', key: voiceCfg.geminiKey, model: '' };
  if (voiceCfg.ai === 'openrouter' && voiceCfg.openrouterKey) return { provider: 'openrouter', key: voiceCfg.openrouterKey, model: voiceCfg.openrouterModel ?? '' };
  return null;
}
const aiName = () => Ai.AI[voiceCfg.ai]?.name ?? 'AI';

let aiModels = null; // OpenRouter's catalogue, read once when its settings are first shown
function renderAiSettings() {
  const p = Ai.AI[voiceCfg.ai] ? voiceCfg.ai : '';
  $('#ai-provider').value = p;
  $('#ai-gemini').hidden = p !== 'gemini';
  $('#ai-openrouter').hidden = p !== 'openrouter';
  $('#ai-gemini-key').value = voiceCfg.geminiKey ?? '';
  $('#stt-gemini').value = voiceCfg.geminiKey ?? '';
  $('#ai-openrouter-key').value = voiceCfg.openrouterKey ?? '';
  $('#ai-openrouter-model').value = voiceCfg.openrouterModel ?? '';
  if (p !== 'openrouter' || aiModels) return;
  aiModels = Ai.listModels().then((list) => {
    $('#ai-models').innerHTML = list.slice(0, 400).map((m) => `<option value="${esc(m.id)}">${esc(m.name)}</option>`).join('');
    // the catalogue changes often: the first choice comes from what is there today
    if (!voiceCfg.openrouterModel && list.length) {
      voiceCfg = { ...voiceCfg, openrouterModel: Ai.pickModel(list) };
      writeLocal(V.VOICE_KEY, voiceCfg);
      $('#ai-openrouter-model').value = voiceCfg.openrouterModel;
    }
    if (!list.length) aiModels = null; // offline: try again next time
    return list;
  });
}

/** Summary, mind map and things to do from the chosen service (the copy-and-paste prompt, sent for the person). */
async function aiSummarize(id) {
  const r = findRec(id);
  const cfg = aiCfg();
  if (!r || busy.has(id)) return;
  if (!r.transcript?.trim()) {
    toast('ถอดเสียงก่อน แล้วค่อยสรุป');
    rvTab('text');
    return;
  }
  if (!cfg) {
    openClaude('', { settings: true });
    toast('เลือกบริการ AI และใส่คีย์ก่อน');
    return;
  }
  const name = aiName();
  busy.set(id, { kind: 'ai', what: 'sum' });
  renderRecView();
  try {
    const reply = await Ai.ask({ ...cfg, prompt: recPrompt(r) });
    busy.delete(id);
    applyRecAnswer(id, C.readPasted(reply), name);
  } catch (err) {
    toast(err?.message || 'สรุปไม่สำเร็จ');
  } finally {
    busy.delete(id);
    if (rvId === id) renderRecView();
  }
}

/**
 * The recognizer's text put right by the chosen service: misheard words fixed from context, written
 * as Thai is written. Sent a few minutes at a time; a part that comes back shortened (a summary,
 * not the text) is left as it was. The times of the paragraphs stay, so the text still plays.
 */
async function aiClean(id) {
  const r = findRec(id);
  const cfg = aiCfg();
  if (!r?.transcript?.trim() || busy.has(id)) return;
  if (!cfg) {
    openClaude('', { settings: true });
    toast('เลือกบริการ AI และใส่คีย์ก่อน');
    return;
  }
  const parts = Ai.batches(C.timedText(r.transcript, r.times, { gap: 30_000, max: 700 }));
  const title = AUTO_REC_TITLE.test(r.title) ? '' : r.title;
  try {
    const out = [];
    let kept = 0;
    for (let i = 0; i < parts.length; i++) {
      busy.set(id, { kind: 'ai', what: 'clean', done: i, total: parts.length });
      if (rvId === id) renderRecView();
      const got = Ai.readCleaned(await Ai.ask({ ...cfg, prompt: Ai.cleanupPrompt(parts[i], { title }) }), parts[i]);
      if (!got) kept++;
      out.push(got ?? Ai.readCleaned(parts[i], parts[i]));
    }
    if (kept === parts.length) throw new Error(`${aiName()} ไม่ได้ส่งข้อความที่เกลาแล้วกลับมา ข้อความเดิมยังอยู่`);
    const cur = findRec(id);
    if (!cur) return;
    if (cur.transcript !== r.transcript) {
      toast('ข้อความถูกแก้ระหว่างที่ AI ทำงาน จึงไม่ได้เปลี่ยนให้');
      return;
    }
    const res = Ai.joinCleaned(out);
    busy.delete(id);
    spacingChecked.add(id);
    commit(withSummary(S.editRec(state, id, { transcript: res.text, times: S.cleanTimes(res.times) }), id, { force: true }), { undoable: true });
    toast(kept ? `เกลาแล้ว (${kept} ช่วงคงไว้ตามเดิม) และสรุปใหม่` : 'เกลาข้อความและสรุปใหม่แล้ว', { label: 'เลิกทำ', run: undo });
  } catch (err) {
    toast(err?.message || 'เกลาข้อความไม่สำเร็จ');
  } finally {
    busy.delete(id);
    if (rvId === id) renderRecView();
  }
}

function recRow(r) {
  const tags = [r.transcript ? 'ถอดแล้ว' : '', r.summary ? 'สรุปแล้ว' : '', r.mapId ? 'มายด์แมป' : ''].filter(Boolean);
  const when = `${dayLabel(dayKey(new Date(r.at)), today)} ${timeOf(new Date(r.at))}`;
  return `<li class="plain-row"><button type="button" class="row-btn rec-row" data-rec-id="${esc(r.id)}"><span class="rec-ico">${icon('i-mic')}</span><span class="mi"><span>${esc(r.title)}</span><small>${esc(when)}${r.durationMs ? ` · ${V.clock(r.durationMs)}` : ''}${tags.length ? ` · ${tags.join(' · ')}` : ''}</small></span>${icon('i-right')}</button></li>`;
}

function mapCard(m) {
  const branches = Mm.childrenOf(m, Mm.rootOf(m).id).slice(0, 3).map((n) => n.text);
  return `<button type="button" class="map-card" data-map-id="${esc(m.id)}"><span class="map-thumb">${icon('i-map')}</span><strong>${esc(Mm.titleOf(m))}</strong><small>${esc(branches.join(' · ') || 'ยังไม่มีกิ่ง')}</small><small class="faint">${m.nodes.length - 1} หัวข้อ · ${esc(ago(m.updatedAt))}</small></button>`;
}

function renderVoiceLists() {
  const recs = S.sortedRecs(state);
  $('#recs-head').hidden = !recs.length;
  $('#rec-count').textContent = countLabel(recs.length);
  $('#recs').innerHTML = recs.slice(0, 30).map(recRow).join('');
  const maps = S.sortedMaps(state);
  $('#maps-head').hidden = !maps.length;
  $('#map-count').textContent = countLabel(maps.length);
  $('#maps').innerHTML = maps.slice(0, 30).map(mapCard).join('');
}

// ---- recording ---------------------------------------------------------------

const recDialog = $('#rec-dialog');
let recorder = null;
let recRaf = 0;
let recLevel = 0;
let recBars = [];
let lastBar = 0;
let cancelArmed = 0;

/** The Android app records natively (keeps going with the screen off); same interface as V.Recorder. */
class NativeRecorder {
  constructor() {
    this.native = true;
    this.polled = 0;
    this.poll(true);
  }
  /** Asks the app at most ~7 times a second. */
  poll(now = false) {
    if (!now && performance.now() - this.polled < 140) return this.last;
    this.polled = performance.now();
    try {
      this.last = JSON.parse(android.recState());
    } catch {
      this.last = { state: 'idle' };
    }
    return this.last;
  }
  get text() {
    return this.last.text || '';
  }
  get state() {
    return this.last.state === 'idle' ? 'stopped' : this.last.state;
  }
  get durationMs() {
    return this.last.elapsedMs || 0;
  }
  get level() {
    return Math.sqrt(this.last.level || 0);
  }
  get markCount() {
    return this.last.marks || 0;
  }
  get call() {
    return !!this.last.call;
  }
  mark() {
    if (!android.recMark) return -1;
    android.recMark();
    const ms = this.durationMs;
    this.last = { ...this.last, marks: (this.last.marks || 0) + 1 };
    return ms;
  }
  pause() {
    android.recPause();
  }
  resume() {
    android.recResume();
  }
  async stop() {
    this.poll(true);
    const { id, at } = this.last;
    const length = this.durationMs;
    android.recStop();
    for (let i = 0; i < 50; i++) {
      await new Promise((r) => setTimeout(r, 100));
      try {
        const m = JSON.parse(android.recList()).find((x) => x.id === id);
        if (m) return { ...m, origin: 'android' };
      } catch {
        break;
      }
    }
    return { id, at, durationMs: length, mime: 'audio/mp4', parts: 0, origin: 'android' };
  }
}

function showNativeRecorder() {
  if (!recorder) recorder = new NativeRecorder();
  recBars = [];
  for (const d of $$('dialog[open]')) if (d !== recDialog) d.close();
  if (!recDialog.open) recDialog.showModal();
  renderRecState();
  cancelAnimationFrame(recRaf);
  const loop = () => {
    if (!recorder?.native) return;
    const before = `${recorder.state}${recorder.markCount}${recorder.call}`;
    recorder.poll();
    recLevel = recorder.level;
    if (`${recorder.state}${recorder.markCount}${recorder.call}` !== before) renderRecState();
    renderLive(recorder.text, '');
    // Stopped from the notification, the tile or the side key: save it like the stop button.
    if (recorder.state === 'stopped') {
      stopRecording();
      return;
    }
    drawRec();
    recRaf = requestAnimationFrame(loop);
  };
  loop();
}

async function startRecording() {
  if (recorder) {
    if (!recDialog.open) recDialog.showModal();
    return;
  }
  if (android?.recStart) {
    let st = 'idle';
    try {
      st = JSON.parse(android.recState()).state;
    } catch {
      // older app
    }
    if (st === 'idle') {
      const res = android.recStart();
      if (res === 'permission') {
        toast('อนุญาตไมโครโฟน แล้วแตะอัดเสียงอีกครั้ง');
        return;
      }
      if (res === 'storage') {
        toast('พื้นที่ในแท็บเล็ตเหลือไม่ถึง 50 MB ลบไฟล์ที่ไม่ใช้แล้วลองอีกครั้ง');
        return;
      }
      if (res !== 'ok') {
        toast('เริ่มอัดเสียงไม่ได้');
        return;
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    showNativeRecorder();
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    toast('เบราว์เซอร์นี้อัดเสียงไม่ได้ ลองเปิดใน Chrome หรือ Safari');
    return;
  }
  // ~30 MB an hour: warn when the browser has little room left for this site
  try {
    const est = await navigator.storage?.estimate?.();
    if (est?.quota && est.quota - est.usage < 100 * 2 ** 20) toast('ที่เก็บของเบราว์เซอร์เหลือน้อย อัดได้ไม่นาน ลบบันทึกเสียงเก่าที่ไม่ใช้แล้วจะดีกว่า');
  } catch {
    // unknown: record anyway
  }
  const rec = new V.Recorder({
    id: S.uid(),
    onlevel: (l) => (recLevel = l),
    onstate: () => renderRecState(),
    onerror: (m) => toast(m),
    // Live captions took the microphone away from the recording: the recording comes first.
    onmute: () => {
      if (!caption?.active) return;
      caption.stop();
      captionBlocked = true;
      toast('ระบบถอดสดของเบราว์เซอร์นี้ใช้ไมโครโฟนพร้อมการอัดไม่ได้ ปิดการถอดสดแล้ว เสียงยังอัดต่อ');
      renderLive('', '');
    },
  });
  Object.defineProperty(rec, 'markCount', { get: () => rec.marks.length });
  recorder = rec;
  recBars = [];
  caption = null;
  renderLive('', '');
  for (const d of $$('dialog[open]')) if (d !== recDialog) d.close();
  recDialog.showModal();
  renderRecState();
  try {
    await rec.start();
    navigator.storage?.persist?.().catch(() => {});
    if (sttProvider() === 'device' && V.LiveCaption.supported && !captionBlocked) {
      caption = new V.LiveCaption({ onchange: (c) => renderLive(c.text, c.partial), clock: () => rec.durationMs });
      caption.start();
    }
  } catch (err) {
    recorder = null;
    recDialog.close();
    toast(
      err?.name === 'NotAllowedError'
        ? 'ยังไม่ได้อนุญาตไมโครโฟน: แตะไอคอนข้างช่องที่อยู่เว็บ → สิทธิ์ → ไมโครโฟน → อนุญาต'
        : err?.name === 'NotFoundError'
          ? 'ไม่เจอไมโครโฟนในเครื่องนี้'
          : 'เปิดไมโครโฟนไม่ได้ (แอปอื่นอาจใช้อยู่)',
    );
    return;
  }
  cancelAnimationFrame(recRaf);
  const loop = () => {
    drawRec();
    recRaf = requestAnimationFrame(loop);
  };
  loop();
}

let caption = null; // browser live captions while recording
let captionBlocked = false; // it took the microphone once on this device: not again this session

/** The words so far under the waveform, like the live transcript of a phone's recorder. */
function renderLive(text, partial) {
  const box = $('#rec-live');
  // as Thai is written (the recognizer puts a space after every word)
  const t = V.tail(T.tidy(V.tail(text, 600)).text, 180);
  const p = partial ? T.tidy(partial).text : '';
  box.hidden = !t && !p;
  $('.rec-live-text', box).textContent = t;
  $('.rec-live-partial', box).textContent = p ? ` ${p}` : '';
}

function renderRecState() {
  const st = recorder?.state ?? 'idle';
  recDialog.dataset.state = st;
  $('#rec-badge span').textContent = st === 'paused' ? 'พักอยู่' : st === 'recording' ? 'กำลังอัด' : 'กำลังเริ่ม…';
  const pause = $('[data-rec="pause"]');
  pause.innerHTML = icon(st === 'paused' ? 'i-mic' : 'i-pause');
  pause.setAttribute('aria-label', st === 'paused' ? 'อัดต่อ' : 'พัก');
  pause.disabled = st !== 'recording' && st !== 'paused';
  const mark = $('[data-rec="mark"]');
  mark.hidden = st !== 'recording' && st !== 'paused';
  const n = recorder?.markCount ?? 0;
  mark.dataset.count = n ? String(n) : '';
  mark.setAttribute('aria-label', n ? `ปักหมุดช่วงนี้ (ปักไว้ ${n} จุด)` : 'ปักหมุดช่วงนี้');
  if (recorder?.call) $('#rec-badge span').textContent = 'พักไว้ระหว่างสาย';
}

function drawRec() {
  if (!recorder) return;
  $('#rec-time').textContent = V.clock(recorder.durationMs);
  const now = performance.now();
  if (now - lastBar > 70) {
    lastBar = now;
    recBars.push(recorder.state === 'recording' ? recLevel : 0);
    if (recBars.length > 400) recBars.shift();
  }
  const c = $('#rec-wave');
  const dpr = devicePixelRatio || 1;
  const w = c.clientWidth;
  const h = c.clientHeight;
  if (!w || !h) return;
  if (c.width !== Math.round(w * dpr)) c.width = Math.round(w * dpr);
  if (c.height !== Math.round(h * dpr)) c.height = Math.round(h * dpr);
  const ctx = c.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const step = 5;
  const count = Math.floor(w / step);
  const bars = recBars.slice(-count);
  const color = getComputedStyle(recDialog).getPropertyValue('--wave').trim() || '#ff3b30';
  bars.forEach((v, i) => {
    const x = w - (bars.length - i) * step;
    const bh = Math.max(3, Math.min(h * 0.9, Math.sqrt(v) * h * 0.9));
    ctx.globalAlpha = 0.35 + 0.65 * (i / bars.length);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(x, (h - bh) / 2, 3, bh, 1.5);
    ctx.fill();
  });
  ctx.globalAlpha = 1;
}

async function stopRecording() {
  const rec = recorder;
  if (!rec) return;
  cancelAnimationFrame(recRaf);
  const words = caption ? caption.stop() : '';
  const wordTimes = caption?.times ?? [];
  caption = null;
  const res = await rec.stop();
  recorder = null;
  recDialog.close();
  renderLive('', '');
  const origin = res.origin ?? 'web';
  if (res.durationMs < 800 || !res.parts) {
    if (origin === 'android') android?.recDelete?.(res.id);
    else await V.audio.remove(res.id).catch(() => {});
    toast('สั้นเกินไป ไม่ได้เก็บไว้');
    return;
  }
  if (state.recs.some((r) => r.id === res.id)) {
    openRec(res.id);
    return;
  }
  const title = `บันทึกเสียง ${shortDate(dayKey(new Date(res.at)))} ${timeOf(new Date(res.at))}`;
  const heard = T.tidy((origin === 'android' ? res.transcript : words) || '', S.cleanTimes(origin === 'android' ? res.times : wordTimes));
  const transcript = heard.text;
  const times = S.cleanTimes(heard.times);
  const marks = S.cleanMarks(res.marks);
  commit(withSummary(S.addRec(state, { id: res.id, title, at: res.at, durationMs: res.durationMs, mime: res.mime, parts: res.parts, device: deviceName(), origin, transcript, times, marks }), res.id));
  openRec(res.id);
  if (origin === 'android' && res.stt === 'listening') waitNativeText(res.id);
  else if (origin === 'android' && (res.appending || res.stt === 'running')) followNative(res.id);
  else if (!transcript && (sttKey() || (sttProvider() === 'device' && origin === 'android'))) transcribeRec(res.id);
}

/** The Android app is still writing the last words of a recording's text: pick them up. */
async function waitNativeText(id) {
  busy.set(id, { kind: 'stt', device: true });
  if (rvId === id) renderRecView();
  try {
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      let m = null;
      try {
        m = JSON.parse(android.recList()).find((x) => x.id === id);
      } catch {
        break;
      }
      if (!m) break;
      if (m.stt === 'listening' || m.stt === 'running') continue;
      if (m.transcript && findRec(id)) commit(withSummary(S.editRec(state, id, nativeText(m)), id));
      if (m.appending || m.stt === 'running') {
        busy.delete(id);
        followNative(id);
        return;
      }
      break;
    }
  } finally {
    if (!busy.get(id)?.follow) busy.delete(id);
    if (rvId === id) renderRecView();
  }
}

/**
 * The Android app is transcribing a saved recording (or the part live transcription missed): show
 * its progress for as long as it takes, and take the text when it is done. Works again after the
 * page reloads (openRec calls it for a job that is running).
 */
async function followNative(id) {
  if (!android?.recList || busy.get(id)?.follow) return;
  busy.set(id, { kind: 'stt', device: true, follow: true });
  if (rvId === id) renderRecView();
  try {
    for (;;) {
      await new Promise((ok) => setTimeout(ok, 1000));
      let m = null;
      try {
        m = JSON.parse(android.recList()).find((x) => x.id === id);
      } catch {
        break;
      }
      if (!m || !findRec(id)) break;
      if (m.stt === 'running') {
        busy.set(id, { kind: 'stt', device: true, follow: true, progress: m.progress, text: m.appending ? '' : m.transcript });
        if (rvId === id) renderSttProgress(id);
        continue;
      }
      const r = findRec(id);
      const got = nativeText(m);
      if (got.transcript && got.transcript !== r.transcript) {
        // a longer text (the missed part added) makes a new summary
        const grown = !r.transcript || got.transcript.startsWith(r.transcript);
        commit(withSummary(S.editRec(state, id, got), id, { force: grown }));
        toast(got.transcript.length > (r.transcript?.length ?? 0) && r.transcript ? 'ถอดช่วงที่ขาดเพิ่มให้แล้ว' : 'ถอดเป็นข้อความและสรุปแล้ว');
      } else if (!m.transcript) toast(m.stt === 'unsupported' ? deviceStt().text : 'ไม่ได้ยินเสียงพูดในไฟล์นี้');
      break;
    }
  } finally {
    busy.delete(id);
    if (rvId === id) renderRecView();
  }
}

function renderSttProgress(id) {
  const job = busy.get(id);
  if (!job) return;
  const pct = Number.isFinite(job.progress) && job.progress >= 0 ? ` ${Math.round(job.progress * 100)}%` : '';
  $('#rv-stt-status').textContent = `กำลังถอดด้วยระบบของเครื่อง…${pct}${job.text ? ` ${V.tail(T.tidy(V.tail(job.text, 400)).text, 100)}` : ''} · ปิดแอปได้ ทำต่อให้เอง`;
}

recDialog.addEventListener('cancel', (e) => {
  // Escape does not throw a recording away.
  if (recorder) e.preventDefault();
});

recDialog.addEventListener('click', async (e) => {
  const act = e.target.closest('[data-rec]')?.dataset.rec;
  if (!act) return;
  if (act === 'pause') {
    if (recorder?.state === 'recording') recorder.pause();
    else recorder?.resume();
    buzz(10);
  }
  if (act === 'stop') {
    buzz(15);
    await stopRecording();
  }
  if (act === 'mark' && recorder) {
    const ms = recorder.mark();
    buzz(10);
    renderRecState();
    if (ms >= 0) toast(`ปักหมุดที่ ${V.clock(ms)}`);
  }
  if (act === 'cancel') {
    const button = e.target.closest('[data-rec]');
    if (recorder && recorder.durationMs > 5000 && Date.now() - cancelArmed > 3000) {
      cancelArmed = Date.now();
      button.textContent = 'ทิ้งเลยไหม?';
      setTimeout(() => (button.textContent = 'ยกเลิก'), 3000);
      return;
    }
    button.textContent = 'ยกเลิก';
    const rec = recorder;
    recorder = null;
    cancelAnimationFrame(recRaf);
    recDialog.close();
    if (rec) {
      const res = await rec.stop();
      if (res.origin === 'android') android?.recDelete?.(res.id);
      else await V.audio.remove(res.id).catch(() => {});
    }
    toast('ไม่ได้เก็บเสียงนี้');
  }
});

// ---- one recording ------------------------------------------------------------

const recview = $('#recview');
const player = new Audio();
player.preload = 'metadata';
let rvId = null;
let rvTabName = 'text';
let rvUrls = [];
let rvPart = 0;
let rvItems = [];
const pendingItems = new Map(); // rec id → things to do found by the last summary, until they are added
let rvMapView = null;
const busy = new Map(); // rec id → 'stt' | 'claude' (+ progress)

const findRec = (id) => state.recs.find((r) => r.id === id);

function openRec(id, tab = 'text') {
  if (!findRec(id)) return;
  if (rvId !== id) {
    rvItems = pendingItems.get(id) ?? [];
    stopPlayer();
  }
  rvId = id;
  rvTab(tab);
  if (!recview.open) recview.showModal();
  renderRecView();
  // text kept with a space after every word (older versions): put right once, when it is opened
  setTimeout(() => rvId === id && recview.open && fixSpacing(id), 350);
  if (android?.recList && findRec(id).origin === 'android' && !busy.has(id)) {
    try {
      const m = JSON.parse(android.recList()).find((x) => x.id === id);
      if (m && (m.stt === 'running' || m.appending)) followNative(id);
    } catch {
      // older app
    }
  }
  loadPlayer().catch(() => {
    $('#rv-player').hidden = true;
  });
}

function rvTab(name) {
  rvTabName = name;
  const r = findRec(rvId);
  if (name === 'map' && r?.transcript?.trim() && !state.maps.some((m) => m.id === r.mapId)) commit(withMap(state, r.id));
  for (const b of $$('[data-rvtab]')) b.setAttribute('aria-selected', String(b.dataset.rvtab === name));
  for (const p of $$('.rv-pane')) p.hidden = p.dataset.pane !== name;
  if (name === 'map') renderRvMap();
}

function renderRecView() {
  const r = findRec(rvId);
  if (!r) {
    if (recview.open) recview.close();
    return;
  }
  if (document.activeElement !== $('#recview-title')) $('#recview-title').value = r.title;
  $('#rv-meta').textContent = `${longDate(dayKey(new Date(r.at)))} · ${timeOf(new Date(r.at))} น.${r.durationMs ? ` · ${V.clock(r.durationMs)}` : ''}${r.device ? ` · อัดจาก ${r.device}` : ''}`;
  // Transcript
  const job = busy.get(r.id);
  const hasText = !!r.transcript;
  $('#rv-text-empty').hidden = hasText && job?.kind !== 'stt';
  $('#rv-text').hidden = !hasText;
  if (hasText && document.activeElement !== $('#rv-text')) $('#rv-text').value = r.transcript;
  const p = V.PROVIDERS[sttProvider()];
  const onDevice = sttProvider() === 'device';
  $('#rv-stt-status').textContent =
    job?.kind === 'stt'
      ? job.device
        ? 'กำลังถอดด้วยระบบของเครื่อง…'
        : `กำลังถอดเสียงด้วย ${p.name}${job.total > 1 ? ` (ส่วนที่ ${Math.min(job.done + 1, job.total)}/${job.total})` : ''}…`
      : onDevice
        ? deviceStt().text
        : sttKey()
          ? `ใช้ ${p.name} (${p.model}) · ส่งไฟล์เสียงไปถอดแล้วเก็บข้อความไว้ที่นี่`
          : 'ยังไม่ได้ใส่คีย์ แตะ “ตั้งค่าบริการ”';
  if (job?.follow) renderSttProgress(r.id);
  $('[data-rv="transcribe"]').disabled = !!job;
  $('[data-rv="transcribe"] span').textContent = job?.kind === 'stt' ? 'กำลังถอด…' : onDevice ? 'ถอดด้วยระบบของเครื่อง' : 'ถอดเสียง';
  renderMarks(r);
  renderTextBar();
  renderFind();
  // Optional AI (shown only when a service and its key are set)
  const ai = aiCfg();
  const aiBusy = job?.kind === 'ai';
  $('#rv-ai').hidden = !ai || !hasText;
  $('[data-rv="ai-clean"]').disabled = !!job;
  $('[data-rv="ai-clean"] span').textContent = aiBusy && job.what === 'clean' ? `กำลังเกลา… ${job.total > 1 ? `${job.done + 1}/${job.total}` : ''}` : 'เกลาข้อความด้วย AI';
  $('#rv-ai-status').textContent = aiBusy && job.what === 'clean' ? `ส่งให้ ${aiName()} ทีละช่วง` : 'แก้คำที่ถอดผิดจากบริบท ไม่ย่อ ไม่ตัดเนื้อหา';
  // Summary
  const sum = $('#rv-sum');
  $('#rv-sum-empty').hidden = !!r.summary && job?.kind !== 'claude' && !(aiBusy && job.what === 'sum');
  $('[data-rv="analyze"]').disabled = !!job;
  $('[data-rv="local"]').disabled = !!job || !hasText;
  $('[data-rv="analyze"] span').textContent = job?.kind === 'claude' ? 'Claude กำลังสรุป…' : 'สรุปด้วย Claude';
  const aiSum = $('#rv-sum-empty [data-rv="ai-sum"]');
  aiSum.hidden = !ai;
  aiSum.disabled = !!job || !hasText;
  $('span', aiSum).textContent = aiBusy && job.what === 'sum' ? `${aiName()} กำลังสรุป…` : `สรุปด้วย ${ai ? aiName() : 'AI'}`;
  sum.hidden = !r.summary;
  if (r.summary) {
    const now = Date.now();
    const rows = rvItems.map((it, i) => {
      const c = classify(it.text, now, { force: it.kind });
      const when = c.kind === 'task' && c.day ? describeWhen(c.day, c.time, today) : '';
      return `<li><label><input type="checkbox" data-i="${i}" checked><span class="kind-chip small k-${c.kind === 'task' && c.day ? 'remind' : c.kind}">${esc(KIND_NAMES[c.kind])}</span><span class="suggest-text">${esc(c.text)}${when ? ` <em>${esc(when)}</em>` : ''}</span></label></li>`;
    });
    sum.innerHTML =
      `<div class="answer">${withTimes(miniMarkdown(r.summary))}</div>` +
      (rows.length ? `<div class="suggest"><p class="suggest-title">สิ่งที่ต้องทำจากบันทึกนี้</p><ul>${rows.join('')}</ul><button type="button" class="primary" data-rv="add-items">แปะที่เลือก</button></div>` : '') +
      `<div class="sheet-buttons"><button type="button" class="secondary" data-rv="analyze-again">สรุปใหม่</button><button type="button" class="secondary" data-rv="copy-sum">คัดลอก</button><button type="button" class="secondary" data-rv="analyze">ให้ Claude สรุป</button>${ai ? `<button type="button" class="secondary" data-rv="ai-sum"${job ? ' disabled' : ''}>ให้ ${esc(aiName())} สรุป</button>` : ''}</div>`;
  }
  // Mind map
  const map = state.maps.find((m) => m.id === r.mapId);
  $('#rv-map-label').textContent = map ? 'เปิดมายด์แมป' : 'ทำมายด์แมป';
  $('[data-rv="open-map"]').disabled = !map && !hasText;
  $('[data-rv="outline-map"]').hidden = !map || !hasText;
  if (rvTabName === 'map') renderRvMap();
}

function renderRvMap() {
  const r = findRec(rvId);
  const map = r && state.maps.find((m) => m.id === r.mapId);
  const host = $('#rv-map');
  host.classList.toggle('empty', !map);
  $('#rv-map-hint').hidden = !map?.nodes.some((n) => Number.isFinite(n.at)) || !rvUrls.length;
  if (!map) {
    rvMapView?.destroy();
    rvMapView = null;
    host.innerHTML = `<p class="dim">${r?.transcript ? 'แตะ “ทำมายด์แมป” เพื่อทำจากข้อความที่ถอดได้' : 'ถอดเสียงก่อน แล้วค่อยทำมายด์แมป'}</p>`;
    return;
  }
  if (!rvMapView) {
    host.innerHTML = '';
    rvMapView = new MapView(host, {
      editable: false,
      // a branch made from the recording knows when it was said: play from there
      onSelect: (id) => {
        const node = state.maps.find((m) => m.id === findRec(rvId)?.mapId)?.nodes.find((n) => n.id === id);
        if (Number.isFinite(node?.at) && rvUrls.length) {
          seekTo(node.at);
          toast(`เล่นจาก ${V.clock(node.at)}`);
        }
      },
    });
  }
  rvMapView.set(map, { fit: true });
  requestAnimationFrame(() => rvMapView?.fit(16));
}

// Audio: the parts saved on this device (or in the Android app), played one after another.
async function audioParts(r) {
  if (r.origin === 'android' && android?.recUrl) {
    const blobs = [];
    for (let i = 0; i < r.parts; i++) {
      try {
        const res = await fetch(android.recUrl(r.id, i));
        if (res.ok) blobs.push(await res.blob());
      } catch {
        // missing or unreadable part: play the rest
      }
    }
    return blobs;
  }
  return V.audio.parts(r.id).catch(() => []);
}

function stopPlayer() {
  player.pause();
  for (const u of rvUrls) URL.revokeObjectURL(u);
  rvUrls = [];
  rvPart = 0;
  updatePlayer();
}

async function loadPlayer() {
  const r = findRec(rvId);
  if (!r || rvUrls.length) return;
  if (!r.parts) {
    // text shared in (e.g. a transcript from Samsung Voice Recorder): nothing to play
    $('#rv-player').hidden = true;
    $('#rv-away').hidden = true;
    return;
  }
  const blobs = await audioParts(r);
  if (rvId !== r.id) return;
  rvUrls = blobs.map((b) => URL.createObjectURL(b));
  $('#rv-player').hidden = !rvUrls.length;
  $('#rv-away').hidden = !!rvUrls.length;
  $('#rv-away').textContent = r.device && r.device !== deviceName() ? `ไฟล์เสียงอยู่ใน ${r.device} (ข้อความ สรุป และมายด์แมปซิงก์มาให้แล้ว)` : 'ไม่มีไฟล์เสียงในเครื่องนี้';
  if (rvUrls.length) setPart(0, 0);
  renderMarks(r);
  renderTextBar();
}

const partLen = (r, i) => (i < r.parts - 1 ? V.PART_MS : Math.max(0, (r.durationMs || 0) - V.PART_MS * (r.parts - 1)));

function setPart(i, offsetMs) {
  rvPart = i;
  player.src = rvUrls[i];
  player.playbackRate = Number(player.dataset.rate || 1);
  const seek = () => {
    // MediaRecorder WebM files may not know their length until read once: nudge the browser.
    if (player.duration === Infinity) {
      player.currentTime = 1e101;
      player.addEventListener('durationchange', () => (player.currentTime = offsetMs / 1000), { once: true });
    } else player.currentTime = offsetMs / 1000;
  };
  player.addEventListener('loadedmetadata', seek, { once: true });
}

function totalMs() {
  const r = findRec(rvId);
  return r?.durationMs || (Number.isFinite(player.duration) ? player.duration * 1000 : 0);
}

function positionMs() {
  const r = findRec(rvId);
  if (!r) return 0;
  let before = 0;
  for (let i = 0; i < rvPart; i++) before += partLen(r, i);
  return before + (player.currentTime || 0) * 1000;
}

function updatePlayer() {
  const t = totalMs();
  const pos = Math.min(positionMs(), t || Infinity);
  $('#rv-pos').textContent = V.clock(pos);
  $('#rv-dur').textContent = V.clock(t);
  if (document.activeElement !== $('#rv-seek')) $('#rv-seek').value = t ? String(Math.round((pos / t) * 1000)) : '0';
  const playing = !player.paused;
  $('[data-rv="play"]').innerHTML = icon(playing ? 'i-pause' : 'i-play');
  $('[data-rv="play"]').setAttribute('aria-label', playing ? 'หยุดเล่น' : 'เล่น');
}

player.addEventListener('timeupdate', updatePlayer);
player.addEventListener('play', updatePlayer);
player.addEventListener('pause', updatePlayer);
player.addEventListener('ended', () => {
  if (rvPart < rvUrls.length - 1) {
    setPart(rvPart + 1, 0);
    player.play().catch(() => {});
  } else updatePlayer();
});
/** "[2:15]" in a summary (a topic's time) becomes a button that plays from there. */
function withTimes(html) {
  return html.replace(/\[(\d{1,2}(?::\d{2}){1,2})\]/g, (m, t) => {
    const ms = t.split(':').reduce((a, x) => a * 60 + Number(x), 0) * 1000;
    return `<button type="button" class="ts" data-seek="${ms}" aria-label="เล่นจาก ${t}">${t}</button>`;
  });
}

/** Plays (or moves to) `ms` into the whole recording, across its files. */
function seekTo(ms, play = true) {
  const r = findRec(rvId);
  if (!r || !rvUrls.length) return;
  let target = Math.max(0, Math.min(ms, totalMs() || ms));
  let i = 0;
  while (i < rvUrls.length - 1 && target > partLen(r, i)) target -= partLen(r, i++);
  if (i !== rvPart) setPart(i, target);
  else player.currentTime = target / 1000;
  if (play) player.play().catch(() => {});
  updatePlayer();
}

$('#rv-seek').addEventListener('input', (e) => seekTo((Number(e.target.value) / 1000) * totalMs(), !player.paused));

// Bookmarks (as in Samsung's and Google's recorders): tap one to play from there.
function renderMarks(r) {
  const box = $('#rv-marks');
  const chips = (r.marks ?? []).map((ms, i) => {
    const at = S.offsetAt(r.times, ms);
    const words = at >= 0 && r.transcript ? Sum.shorten(r.transcript.slice(at, at + 200), 34, { keepStart: true }) : '';
    return `<span class="mark-chip"><button type="button" class="mark-go" data-mark="${i}" aria-label="เล่นจาก ${V.clock(ms)}"><svg aria-hidden="true"><use href="#i-pin"/></svg><b>${V.clock(ms)}</b>${words ? `<span>${esc(words)}</span>` : ''}</button><button type="button" class="x" data-unmark="${i}" aria-label="เอาหมุด ${V.clock(ms)} ออก">×</button></span>`;
  });
  if (rvUrls.length && r.parts) chips.push(`<button type="button" class="mark-chip add" data-rv="add-mark"><svg aria-hidden="true"><use href="#i-pin"/></svg>ปักหมุดตรงนี้</button>`);
  const html = chips.join('');
  if (box.innerHTML !== html) box.innerHTML = html;
}

/** Where the text cursor is, in the audio: from the word times, else in proportion. */
function hereMs(r) {
  const text = $('#rv-text');
  const at = text.selectionStart ?? 0;
  const ms = S.timeAt(r.times, at);
  if (ms >= 0) return { ms, exact: true };
  const len = text.value.length || 1;
  return { ms: Math.round((at / len) * totalMs()), exact: false };
}

function renderTextBar() {
  const r = findRec(rvId);
  const bar = $('#rv-textbar');
  bar.hidden = !r?.transcript || !rvUrls.length;
  if (bar.hidden) return;
  const focused = document.activeElement === $('#rv-text') || $('#rv-text').selectionStart > 0;
  const { ms, exact } = hereMs(r);
  $('#rv-here').textContent = focused ? `${exact ? '' : 'ประมาณ '}${V.clock(ms)}` : 'แตะในข้อความ แล้วกดเล่นจากตรงนั้น';
}
for (const ev of ['click', 'keyup', 'select', 'focus']) $('#rv-text').addEventListener(ev, () => renderTextBar());

// ---- search inside the transcript: every place a word was said, with its time ----

let rvHits = { q: '', at: [], i: 0 };

function renderFind() {
  const r = findRec(rvId);
  const has = (r?.transcript?.length ?? 0) > 200;
  $('#rv-find').hidden = !has;
  // the summary's key words, one tap to find where each was said
  const keys = has ? (/\*\*คำสำคัญ:\*\*\s*(.+)/.exec(r.summary ?? '')?.[1] ?? '').split(' · ').map((k) => k.trim()).filter(Boolean).slice(0, 10) : [];
  const box = $('#rv-keys');
  box.hidden = !keys.length;
  const html = keys.map((k) => `<button type="button" class="chip${k.toLowerCase() === rvHits.q ? ' on' : ''}" data-key="${esc(k)}">${esc(k)}</button>`).join('');
  if (box.innerHTML !== html) box.innerHTML = html;
  if (!has || !rvHits.q) $('#rv-hit').hidden = true;
}

function findInText(q, step = 0) {
  const r = findRec(rvId);
  const text = r?.transcript ?? '';
  const low = text.toLowerCase();
  const needle = q.trim().toLowerCase();
  if (needle !== rvHits.q || rvHits.id !== rvId) {
    const at = [];
    if (needle) for (let i = low.indexOf(needle); i >= 0 && at.length < 2000; i = low.indexOf(needle, i + needle.length)) at.push(i);
    rvHits = { q: needle, at, i: 0, id: rvId };
  } else if (rvHits.at.length) rvHits.i = (rvHits.i + step + rvHits.at.length) % rvHits.at.length;
  const n = rvHits.at.length;
  $('#rv-find-count').textContent = needle ? (n ? `${rvHits.i + 1}/${n}` : 'ไม่เจอ') : '';
  for (const b of $$('[data-rv="find-prev"], [data-rv="find-next"]')) b.disabled = n < 2;
  for (const c of $$('#rv-keys .chip')) c.classList.toggle('on', c.dataset.key.toLowerCase() === needle);
  const hit = $('#rv-hit');
  hit.hidden = !n;
  if (!n) return;
  const pos = rvHits.at[rvHits.i];
  const ms = r.times?.length ? S.timeAt(r.times, pos) : -1;
  const from = Math.max(0, pos - 40);
  hit.dataset.ms = String(ms);
  hit.innerHTML = `${ms >= 0 ? `<b>${V.clock(ms)}</b>` : ''}<span>${from ? '…' : ''}${esc(text.slice(from, pos))}<mark>${esc(text.slice(pos, pos + needle.length))}</mark>${esc(text.slice(pos + needle.length, pos + needle.length + 70))}…</span>`;
  // bring that place into view in the text below
  const ta = $('#rv-text');
  const full = ta.value;
  if (full === text) {
    ta.value = full.slice(0, pos);
    const top = ta.scrollHeight;
    ta.value = full;
    ta.scrollTop = Math.max(0, top - ta.clientHeight / 2);
    ta.setSelectionRange(pos, pos + needle.length);
    renderTextBar();
  }
}

$('#rv-find-q').addEventListener('input', (e) => findInText(e.target.value));
$('#rv-find-q').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  findInText(e.target.value, e.shiftKey ? -1 : 1);
});
$('#rv-keys').addEventListener('click', (e) => {
  const key = e.target.closest('[data-key]')?.dataset.key;
  if (!key) return;
  $('#rv-find-q').value = key;
  findInText(key, 1);
});

recview.addEventListener('close', () => {
  player.pause();
  rvMapView?.destroy();
  rvMapView = null;
});

$('#recview-title').addEventListener('change', (e) => {
  const title = e.target.value.trim();
  if (title && rvId) commit(S.editRec(state, rvId, { title }));
});
let rvTextTimer = 0;
$('#rv-text').addEventListener('input', (e) => {
  const id = rvId;
  const text = e.target.value;
  clearTimeout(rvTextTimer);
  rvTextTimer = setTimeout(() => commit(S.editRec(state, id, { transcript: text }), { redraw: false }), 600);
});

async function transcribeRec(id) {
  const r = findRec(id);
  if (!r || busy.has(id)) return;
  if (sttProvider() === 'device') {
    transcribeOnDevice(r);
    return;
  }
  if (!sttKey()) {
    openClaude('', { settings: true });
    toast('ใส่คีย์ของบริการที่เลือกก่อน หรือเปลี่ยนเป็นระบบถอดเสียงของเครื่อง');
    return;
  }
  const parts = await audioParts(r);
  if (!parts.length) {
    toast('ไม่มีไฟล์เสียงในเครื่องนี้ ถอดจากเครื่องที่อัดไว้');
    return;
  }
  busy.set(id, { kind: 'stt', done: 0, total: parts.length });
  renderRecView();
  try {
    const text = await V.transcribeParts({
      provider: sttProvider(),
      key: sttKey(),
      parts,
      mime: r.mime,
      onprogress: (done, total) => {
        busy.set(id, { kind: 'stt', done, total });
        if (rvId === id) renderRecView();
      },
    });
    busy.delete(id);
    if (!text) {
      toast('ไม่ได้ยินเสียงพูดในไฟล์นี้');
      return;
    }
    commit(withSummary(S.editRec(state, id, { transcript: text }), id));
    toast('ถอดเสียงและสรุปแล้ว');
  } catch (err) {
    toast(err?.message || 'ถอดเสียงไม่สำเร็จ');
  } finally {
    busy.delete(id);
    if (rvId === id) renderRecView();
  }
}

/** The Android app's own speech recognition reads the saved file (no other AI). */
async function transcribeOnDevice(r) {
  if (!android?.recTranscribe || r.origin !== 'android') {
    const d = deviceStt();
    toast(
      d.where === 'android'
        ? 'ไฟล์นี้อัดจากหน้าเว็บ ระบบของเครื่องถอดได้เฉพาะไฟล์ที่อัดหรือแชร์เข้าแอป'
        : d.where === 'browser'
          ? 'บนเบราว์เซอร์ ระบบของเครื่องถอดได้ระหว่างอัดเท่านั้น ถ้าจะถอดไฟล์นี้ ใช้แอป Android หรือบริการที่ใช้คีย์'
          : d.text,
    );
    return;
  }
  const res = android.recTranscribe(r.id);
  if (res === 'unsupported') {
    openClaude('', { settings: true });
    toast(deviceStt().text);
    return;
  }
  if (res === 'missing') {
    toast('ไม่เจอไฟล์เสียงนี้ในแท็บเล็ต');
    return;
  }
  followNative(r.id);
}

/** Claude: summary, things to do and a mind map from a transcript. */
async function analyzeRec(id) {
  const r = findRec(id);
  if (!r || busy.has(id)) return;
  if (!r.transcript) {
    toast('ถอดเสียงก่อน แล้วค่อยสรุป');
    rvTab('text');
    return;
  }
  if (!claudeCfg.key) {
    openClaude('', { job: { kind: 'rec', id } });
    return;
  }
  busy.set(id, { kind: 'claude' });
  renderRecView();
  try {
    const message = await claudeFinal(C.noteRequest({ model: claudeCfg.model, kind: 'การถอดเสียง', title: r.title, text: r.transcript, today: longDate(today) }));
    const note = C.readNote(message);
    if (note.note && !note.summary) throw new Error(note.note);
    const cur = findRec(id);
    let next = state;
    let mapId = cur.mapId;
    if (note.map) {
      const old = state.maps.find((m) => m.id === mapId);
      const map = { ...note.map, id: old?.id ?? note.map.id, source: { kind: 'rec', id }, createdAt: old?.createdAt ?? Date.now(), updatedAt: Date.now() };
      next = S.saveMap(next, map);
      mapId = map.id;
    }
    // a title the person did not write (the default, or the one the on-device summary gave) can change
    const autoTitle = (AUTO_REC_TITLE.test(cur.title) || cur.title === analyzeLocal(cur)?.title) && note.title;
    next = S.editRec(next, id, { summary: note.summary, mapId, ...(autoTitle ? { title: note.title } : {}) });
    rvItems = note.items;
    pendingItems.set(id, note.items);
    commit(next);
    toast(note.note || 'สรุปแล้ว พร้อมมายด์แมป');
  } catch (err) {
    toast(err?.message || 'สรุปไม่สำเร็จ');
  } finally {
    busy.delete(id);
    if (rvId === id) renderRecView();
  }
}

/** One Claude request through the official SDK; returns the final message. */
async function claudeFinal(request) {
  let Anthropic = null;
  try {
    ({ Anthropic } = await import('./vendor/anthropic.js'));
    const client = new Anthropic({ apiKey: claudeCfg.key, dangerouslyAllowBrowser: true });
    return await client.beta.messages.stream(request).finalMessage();
  } catch (err) {
    throw new Error(claudeError(err, Anthropic) || 'ยกเลิกแล้ว');
  }
}

/** A copied-and-pasted answer about a recording: title, summary, mind map and things to do. */
function applyRecAnswer(id, p, from = 'Claude') {
  const cur = findRec(id);
  if (!cur) return;
  // no headings at all: the whole answer is the summary
  const summary = p.summary || (!p.outline && !p.items.length ? p.reply : '');
  if (!summary && !p.outline && !p.items.length) {
    toast('อ่านคำตอบนี้ไม่ได้ ลองคัดลอกด้วยปุ่มคัดลอกใต้คำตอบของ Claude');
    return;
  }
  let next = state;
  let mapId = cur.mapId;
  if (p.outline) {
    const old = state.maps.find((m) => m.id === mapId);
    const fresh = C.timesFromLabels(Mm.fromOutline(p.outline, p.title || cur.title));
    const map = { ...fresh, id: old?.id ?? fresh.id, source: { kind: 'rec', id }, createdAt: old?.createdAt ?? Date.now(), updatedAt: Date.now() };
    next = S.saveMap(next, map);
    mapId = map.id;
  }
  // a title the person did not write (the default, or the one the on-device summary gave) can change
  const autoTitle = p.title && (AUTO_REC_TITLE.test(cur.title) || cur.title === analyzeLocal(cur)?.title);
  next = S.editRec(next, id, { ...(summary ? { summary } : {}), mapId, ...(autoTitle ? { title: p.title } : {}) });
  pendingItems.set(id, p.items);
  if (rvId === id) rvItems = p.items;
  claudeDialog.close();
  $('#claude-paste').value = '';
  setJob({ kind: 'ask' });
  commit(next, { undoable: true });
  if (rvId === id && recview.open) rvTab(summary || p.items.length ? 'sum' : 'map');
  toast(`ใส่คำตอบจาก ${from} แล้ว`, { label: 'เลิกทำ', run: undo });
}

/** Fresh branches keep the time of an old branch with the same words. */
function keepTimes(nodes, old) {
  const at = new Map(old.filter((n) => Number.isFinite(n.at)).map((n) => [n.text, n.at]));
  return nodes.map((n) => (!Number.isFinite(n.at) && at.has(n.text) ? { ...n, at: at.get(n.text) } : n));
}

/** Replaces a mind map's branches with an outline (from Claude or typed), undoably. */
function replaceMap(id, outline, done) {
  const map = state.maps.find((m) => m.id === id);
  if (!map) return false;
  const fresh = C.timesFromLabels(Mm.fromOutline(outline, Mm.titleOf(map)));
  if (fresh.nodes.length < 2) {
    toast('ไม่เจอโครงร่างในข้อความนี้ (ต้องมี # หัวข้อ และ - กิ่ง)');
    return false;
  }
  const next = { ...map, nodes: keepTimes(fresh.nodes, map.nodes), updatedAt: Date.now() };
  commit(S.saveMap(state, next), { undoable: true });
  if (mapId === id) mapView?.set(next, { fit: true });
  const back = () => {
    undo();
    const was = state.maps.find((m) => m.id === id);
    if (mapId === id && was) mapView?.set(was, { fit: true });
  };
  toast(done, { label: 'เลิกทำ', run: back });
  return true;
}

function applyMapAnswer(id, p) {
  const outline = p.outline || $('#claude-paste').value;
  if (Mm.fromOutline(outline).nodes.length < 2) {
    toast('ไม่เจอโครงร่างในคำตอบนี้ ลองคัดลอกจากกล่องโค้ดของ Claude');
    return;
  }
  claudeDialog.close();
  $('#claude-paste').value = '';
  setJob({ kind: 'ask' });
  replaceMap(id, outline, 'ขยายมายด์แมปแล้ว');
}

/**
 * The Android recognizer's text for a recording, as Thai is written (lib/thai.js): { transcript, times }.
 * Remembered per recording, since the app is asked for its list again every time it comes to the front.
 */
const tidied = new Map(); // rec id → { len, head, transcript, times }
function nativeText(m) {
  const raw = m.transcript || '';
  const hit = tidied.get(m.id);
  if (hit && hit.len === raw.length && hit.head === raw.slice(0, 48)) return { transcript: hit.transcript, times: hit.times };
  const t = T.tidy(raw, S.cleanTimes(m.times));
  const out = { len: raw.length, head: raw.slice(0, 48), transcript: t.text, times: S.cleanTimes(t.times) };
  tidied.set(m.id, out);
  return { transcript: out.transcript, times: out.times };
}

/**
 * A recording kept before the app tidied the recognizer's text (a space after every word): fixed
 * when it is opened, with a new summary, and a new mind map if the old one was never edited.
 * `manual`: asked for from the menu, also airs text that has no spaces at all.
 */
const spacingChecked = new Set();
function fixSpacing(id, { manual = false } = {}) {
  const r = findRec(id);
  if (!r?.transcript || busy.has(id)) return false;
  if (!manual) {
    if (spacingChecked.has(id)) return false;
    spacingChecked.add(id);
  }
  const t = T.tidy(r.transcript, r.times ?? [], { walls: manual });
  if (!t.changed) return false;
  let next = withSummary(S.editRec(state, id, { transcript: t.text, times: S.cleanTimes(t.times) }), id, { force: true });
  const map = next.maps.find((m) => m.id === r.mapId);
  if (map && map.source?.kind === 'rec' && Math.abs((map.updatedAt ?? 0) - (map.createdAt ?? 0)) < 2000) next = withMap(next, id);
  commit(next, { undoable: true });
  toast('จัดวรรคตอนของข้อความใหม่ และสรุปใหม่แล้ว', { label: 'เลิกทำ', run: undo });
  return true;
}

const AUTO_REC_TITLE = /^(?:บันทึกเสียง|ไฟล์เสียงที่แชร์มา|ข้อความที่แชร์มา)\s/;

/** Reads a recording's text on the device (lib/summarize.js): topics, decisions, tasks, open questions. */
function analyzeLocal(r) {
  try {
    return Sum.analyze(r.transcript, { title: r.title, now: r.at, times: r.times });
  } catch (err) {
    console.error(err);
    return null;
  }
}

/**
 * The on-device summary for a recording that has text and no summary yet (`force`: make it again).
 * Pure apart from remembering the things to do it found for the open recording.
 */
function withSummary(st, id, { force = false } = {}) {
  const r = st.recs.find((x) => x.id === id);
  if (!r?.transcript?.trim() || (r.summary && !force)) return st;
  const a = analyzeLocal(r);
  if (!a) return st;
  pendingItems.set(id, a.items);
  if (rvId === id) rvItems = a.items;
  const retitle = AUTO_REC_TITLE.test(r.title) && a.named;
  const pins = markLines(r);
  const summary = pins.length ? `${a.summary}\n**ช่วงที่ปักหมุด**\n${pins.map((l) => `- ${l}`).join('\n')}` : a.summary;
  return S.editRec(st, id, { summary, ...(retitle ? { title: a.title } : {}) });
}

/** "1:23 · what was being said" for each bookmark. */
function markLines(r, max = 40) {
  return (r.marks ?? []).slice(0, 12).map((ms) => {
    const at = S.offsetAt(r.times, ms);
    const words = at >= 0 && r.transcript ? Sum.shorten(r.transcript.slice(at, at + 240), max, { keepStart: true }) : '';
    return words ? `${V.clock(ms)} · ${words}` : V.clock(ms);
  });
}

/** The recording as a text file: summary, bookmarks, and the transcript with times. */
function recText(r) {
  const head = [r.title, `${longDate(dayKey(new Date(r.at)))} · ${timeOf(new Date(r.at))} น.${r.durationMs ? ` · ${V.clock(r.durationMs)}` : ''}`, ''];
  const plain = (t) => t.replace(/\*\*(.+?)\*\*/g, '$1');
  const out = [...head];
  if (r.summary) out.push('สรุป', plain(r.summary), '');
  const pins = markLines(r, 60);
  if (pins.length && !r.summary?.includes('ช่วงที่ปักหมุด')) out.push('ช่วงที่ปักหมุด', ...pins.map((l) => `- ${l}`), '');
  if (r.transcript) {
    out.push('ข้อความที่ถอด');
    const times = r.times ?? [];
    if (times.length) {
      // a paragraph about every half minute, each with the time it starts
      let para = null;
      times.forEach(([at, ms], i) => {
        const piece = r.transcript.slice(at, times[i + 1]?.[0] ?? r.transcript.length).trim();
        if (!piece) return;
        if (!para || ms - para.ms >= 30_000 || para.text.length > 400) {
          if (para) out.push(`[${V.clock(para.ms)}] ${para.text}`, '');
          para = { ms, text: piece };
        } else para.text += ` ${piece}`;
      });
      if (para) out.push(`[${V.clock(para.ms)}] ${para.text}`);
    } else out.push(r.transcript);
  }
  return `${out.join('\n').trim()}\n\nจาก แปะไว้\n`;
}

/** The on-device mind map for a recording, replacing the one it had (same id, so links stay). */
function withMap(st, id) {
  const r = st.recs.find((x) => x.id === id);
  const a = r?.transcript?.trim() && analyzeLocal(r);
  if (!a) return st;
  const old = st.maps.find((m) => m.id === r.mapId);
  let fresh = Sum.toMindMap(a, Date.now());
  const pins = markLines(r, 36);
  if (pins.length) {
    // bookmarks as a branch; each knows its time, so a tap plays from there
    const branch = Mm.addChild(fresh, Mm.rootOf(fresh).id, 'ช่วงที่ปักหมุด');
    fresh = branch.map;
    pins.slice(0, 8).forEach((l, i) => {
      const pin = Mm.addChild(fresh, branch.id, `📍 ${l}`);
      fresh = { ...pin.map, nodes: pin.map.nodes.map((n) => (n.id === pin.id ? { ...n, at: r.marks[i] } : n)) };
    });
  }
  const map = { ...fresh, id: old?.id ?? fresh.id, source: { kind: 'rec', id }, createdAt: old?.createdAt ?? fresh.createdAt };
  return S.editRec(S.saveMap(st, map), id, { mapId: map.id });
}

let rvDeleteArmed = 0;
recview.addEventListener('click', async (e) => {
  const tab = e.target.closest('[data-rvtab]')?.dataset.rvtab;
  if (tab) {
    rvTab(tab);
    return;
  }
  const r = findRec(rvId);
  const seek = e.target.closest('[data-seek]')?.dataset.seek;
  if (seek != null && r) {
    if (rvUrls.length) seekTo(Number(seek));
    else toast('ไฟล์เสียงไม่ได้อยู่ในเครื่องนี้');
    return;
  }
  const go = e.target.closest('[data-mark]')?.dataset.mark;
  if (go != null && r) {
    seekTo(r.marks[Number(go)] ?? 0);
    return;
  }
  const drop = e.target.closest('[data-unmark]')?.dataset.unmark;
  if (drop != null && r) {
    commit(S.editRec(state, r.id, { marks: r.marks.filter((_, i) => i !== Number(drop)) }), { undoable: true });
    toast('เอาหมุดออกแล้ว', { label: 'เลิกทำ', run: undo });
    return;
  }
  const act = e.target.closest('[data-rv]')?.dataset.rv;
  if (!act || !r) return;
  if (act === 'add-mark') {
    const ms = Math.round(positionMs());
    commit(S.editRec(state, r.id, { marks: S.cleanMarks([...(r.marks ?? []), ms]) }));
    toast(`ปักหมุดที่ ${V.clock(ms)}`);
    return;
  }
  if (act === 'play-here') {
    seekTo(hereMs(r).ms);
    return;
  }
  if (act === 'play') {
    if (!rvUrls.length) return;
    if (player.paused) player.play().catch(() => toast('เล่นไฟล์นี้ไม่ได้'));
    else player.pause();
  }
  if (act === 'speed') {
    const rates = [1, 1.25, 1.5, 2, 0.75];
    const next = rates[(rates.indexOf(Number(player.dataset.rate || 1)) + 1) % rates.length];
    player.dataset.rate = String(next);
    player.playbackRate = next;
    e.target.closest('[data-rv]').textContent = `${next}×`;
  }
  if (act === 'find-prev' || act === 'find-next') findInText($('#rv-find-q').value, act === 'find-next' ? 1 : -1);
  if (act === 'hit-play') {
    const ms = Number($('#rv-hit').dataset.ms);
    if (ms >= 0 && rvUrls.length) {
      seekTo(ms);
      toast(`เล่นจาก ${V.clock(ms)}`);
    } else toast(rvUrls.length ? 'ช่วงนี้ไม่มีเวลากำกับ' : 'ไฟล์เสียงไม่อยู่ในเครื่องนี้');
  }
  if (act === 'ai-clean') aiClean(r.id);
  if (act === 'ai-sum') aiSummarize(r.id);
  if (act === 'transcribe') transcribeRec(r.id);
  if (act === 'settings') openClaude('', { settings: true });
  if (act === 'analyze') analyzeRec(r.id);
  if (act === 'local' || act === 'analyze-again') {
    if (!r.transcript?.trim()) {
      toast('ถอดเสียงก่อน แล้วค่อยสรุป');
      rvTab('text');
      return;
    }
    const next = withSummary(state, r.id, { force: true });
    if (next === state) {
      toast('ข้อความสั้นเกินไปที่จะสรุป');
      return;
    }
    // the mind map stays as it is (it may have been edited): มายด์แมป → ทำใหม่จากข้อความ remakes it
    commit(next, { undoable: true });
    toast('สรุปแล้ว', { label: 'เลิกทำ', run: undo });
  }
  if (act === 'web') {
    if (!r.transcript) {
      toast('ถอดเสียงก่อน แล้วค่อยส่งให้ Claude');
      return;
    }
    openClaude('', { job: { kind: 'rec', id: r.id } });
  }
  if (act === 'copy-sum') copyText(r.summary);
  if (act === 'add-items') {
    const now = Date.now();
    let next = state;
    let n = 0;
    for (const box of $$('#rv-sum input[data-i]:checked')) {
      const it = rvItems[Number(box.dataset.i)];
      if (!it) continue;
      const c = classify(it.text, now, { force: it.kind });
      if (c.kind === 'money' && !c.amount) continue;
      next = route(next, c, now + n++);
    }
    if (!n) return;
    rvItems = [];
    pendingItems.delete(r.id);
    commit(next, { undoable: true });
    toast(`แปะ ${n} เรื่องจากบันทึกนี้แล้ว`, { label: 'เลิกทำ', run: undo });
  }
  if (act === 'open-map') {
    let map = state.maps.find((m) => m.id === r.mapId);
    if (!map && r.transcript?.trim()) {
      commit(withMap(state, r.id));
      map = state.maps.find((m) => m.id === findRec(r.id).mapId);
    }
    if (map) openMap(map.id);
    else toast('ถอดเสียงก่อน แล้วค่อยทำมายด์แมป');
  }
  if (act === 'outline-map') {
    commit(withMap(state, r.id), { undoable: true });
    toast('ทำมายด์แมปใหม่จากข้อความแล้ว', { label: 'เลิกทำ', run: undo });
  }
  if (act === 'more') {
    const menuEl = $('#rv-menu');
    menuEl.querySelector('[data-rvm="share"]').hidden = !rvUrls.length;
    menuEl.querySelector('[data-rvm="copy"]').hidden = !r.transcript;
    menuEl.querySelector('[data-rvm="tidy"]').hidden = !r.transcript;
    menuEl.querySelector('[data-rvm="export"]').hidden = !r.transcript && !r.summary;
    menuEl.querySelector('[data-rvm="memo"]').hidden = !r.summary;
    menuEl.showModal();
  }
});

$('#rv-menu').addEventListener('click', async (e) => {
  const act = e.target.closest('[data-rvm]')?.dataset.rvm;
  const r = findRec(rvId);
  if (!act || !r) {
    if (e.target === $('#rv-menu')) $('#rv-menu').close();
    return;
  }
  const button = e.target.closest('[data-rvm]');
  if (act === 'delete') {
    if (Date.now() - rvDeleteArmed > 3000) {
      rvDeleteArmed = Date.now();
      button.textContent = 'แตะอีกครั้งเพื่อลบ (ลบไฟล์เสียงด้วย)';
      setTimeout(() => (button.textContent = 'ลบบันทึกนี้'), 3000);
      return;
    }
    button.textContent = 'ลบบันทึกนี้';
    $('#rv-menu').close();
    recview.close();
    stopPlayer();
    commit(S.deleteRec(state, r.id));
    if (r.origin === 'android') android?.recDelete?.(r.id);
    else V.audio.remove(r.id).catch(() => {});
    toast('ลบบันทึกเสียงแล้ว');
    return;
  }
  $('#rv-menu').close();
  if (act === 'copy') copyText(r.transcript);
  if (act === 'tidy' && !fixSpacing(r.id, { manual: true })) toast('ข้อความนี้จัดวรรคตอนดีอยู่แล้ว');
  if (act === 'export') shareFile(`${r.title.replace(/[\\/:*?"<>|]/g, ' ').slice(0, 60)}.txt`, recText(r), 'text/plain');
  if (act === 'memo') {
    commit(S.addMemo(state, { title: r.title, text: r.summary.replace(/\*\*(.+?)\*\*/g, '$1'), labels: ['บันทึกเสียง'] }), { undoable: true });
    toast('เก็บสรุปเป็นโน้ตแล้ว', { label: 'เลิกทำ', run: undo });
  }
  if (act === 'share') {
    const blobs = await audioParts(r);
    const files = blobs.map((b, i) => new File([b], `${r.title.replace(/[\\/:*?"<>|]/g, ' ')}${blobs.length > 1 ? ` (${i + 1})` : ''}.${V.extFor(r.mime || b.type)}`, { type: b.type }));
    try {
      if (navigator.canShare?.({ files })) await navigator.share({ files, title: r.title });
      else
        for (const f of files) {
          const url = URL.createObjectURL(f);
          Object.assign(document.createElement('a'), { href: url, download: f.name }).click();
          setTimeout(() => URL.revokeObjectURL(url), 10_000);
        }
    } catch (err) {
      if (err?.name !== 'AbortError') toast('แชร์ไม่ได้');
    }
  }
});

// ---- mind maps --------------------------------------------------------------

const mapDialog = $('#map-dialog');
let mapView = null;
let mapId = null;

function openMap(id) {
  const map = state.maps.find((m) => m.id === id);
  if (!map) return;
  mapId = id;
  $('#map-title').textContent = Mm.titleOf(map);
  if (!mapDialog.open) mapDialog.showModal();
  if (!mapView) {
    mapView = new MapView($('#mm-host'), {
      onChange: (m) => {
        commit(S.saveMap(state, m), { redraw: false });
        $('#map-title').textContent = Mm.titleOf(m);
      },
      onSelect: renderMapTools,
    });
  }
  mapView.set(map, { fit: true });
  requestAnimationFrame(() => {
    mapView.fit(32, { readable: true });
    mapView.svg.focus({ preventScroll: true });
  });
  renderMapTools(mapView.selected);
}

function renderMapTools(sel) {
  const node = mapView?.map.nodes.find((n) => n.id === sel);
  const root = node && node.parent == null;
  $('[data-mm="sibling"]').disabled = !node;
  $('[data-mm="edit"]').disabled = !node;
  $('[data-mm="delete"]').disabled = !node || root;
  $('[data-mm="fold"]').disabled = !node || !Mm.childrenOf(mapView.map, node.id).length;
  $('[data-mm="fold"] span').textContent = node?.collapsed ? 'กาง' : 'พับ';
}

/** A memo as a mind map: a list stays a list, plain text is read like a recording (no AI). */
function memoToMap(id) {
  const memo = state.memos.find((m) => m.id === id);
  if (!memo) return;
  // a checklist is a list of branches; other notes are read like a recording
  const text = (memo.list ? N.listItems(memo.text).map((it) => `- ${it.text}`).join('\n') : memo.text).trim();
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const BULLET = /^(?:[-*+•]|\d{1,3}[.)]|#{1,6})\s/;
  const first = !memo.title && lines.length > 1 && lines[0].length <= 60 && !BULLET.test(lines[0]) ? lines[0] : '';
  const head = memo.title || first;
  let map;
  if (lines.filter((l) => BULLET.test(l)).length >= 2) map = Mm.fromOutline(text, head || 'โน้ต');
  else {
    const a = Sum.analyze(first ? lines.slice(1).join('\n') : text, { title: head || 'โน้ต', now: memo.updatedAt ?? Date.now() });
    if (!a) {
      toast('ข้อความสั้นเกินไปที่จะทำมายด์แมป');
      return;
    }
    map = Sum.toMindMap(a, Date.now());
  }
  map = { ...map, source: { kind: 'memo', id } };
  commit(S.saveMap(state, map), { undoable: true });
  openMap(map.id);
}

function newMindMap(title = 'หัวข้อหลัก', outline = '') {
  const map = outline ? Mm.fromOutline(outline, title) : Mm.newMap(title);
  commit(S.saveMap(state, map));
  openMap(map.id);
  if (!outline)
    requestAnimationFrame(() => {
      const root = Mm.rootOf(map).id;
      mapView.select(root);
      mapView.edit(root);
    });
}

mapDialog.addEventListener('click', (e) => {
  const act = e.target.closest('[data-mm]')?.dataset.mm;
  if (!act || !mapView) return;
  if (act === 'child') mapView.addChild();
  if (act === 'sibling') mapView.addSibling();
  if (act === 'edit') mapView.edit();
  if (act === 'fold') mapView.toggle();
  if (act === 'delete') mapView.remove();
  if (act === 'fit') mapView.fit();
  if (act === 'more') {
    $('[data-mmm="layout"]').textContent = state.maps.find((m) => m.id === mapId)?.layout === 'right' ? 'จัดกิ่งสองข้าง' : 'จัดกิ่งไปทางขวาทั้งหมด';
    $('#mm-menu').showModal();
  }
});

mapDialog.addEventListener('close', () => {
  mapView?.editing?.blur();
  mapId = null;
  render();
});

$('#mm-menu').addEventListener('click', async (e) => {
  const act = e.target.closest('[data-mmm]')?.dataset.mmm;
  if (!act) {
    if (e.target === $('#mm-menu')) $('#mm-menu').close();
    return;
  }
  $('#mm-menu').close();
  const map = state.maps.find((m) => m.id === mapId);
  if (!map) return;
  if (act === 'png') {
    const blob = await mapView.png();
    const name = `${Mm.titleOf(map).replace(/[\\/:*?"<>|]/g, ' ').slice(0, 60)}.png`;
    if (android?.saveBase64) {
      const reader = new FileReader();
      reader.onload = () => android.saveBase64(name, String(reader.result).split(',')[1], 'image/png');
      reader.readAsDataURL(blob);
      return;
    }
    const file = new File([blob], name, { type: 'image/png' });
    try {
      if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: Mm.titleOf(map) });
      else {
        const url = URL.createObjectURL(file);
        Object.assign(document.createElement('a'), { href: url, download: name }).click();
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
      }
    } catch (err) {
      if (err?.name !== 'AbortError') toast('บันทึกรูปไม่ได้');
    }
  }
  if (act === 'copy') copyText(Mm.toOutline(map), 'คัดลอกโครงร่างแล้ว');
  if (act === 'layout') {
    const { layout, ...rest } = map;
    const next = { ...rest, ...(layout === 'right' ? {} : { layout: 'right' }), updatedAt: Date.now() };
    commit(S.saveMap(state, next));
    mapView.set(next, { fit: true });
  }
  if (act === 'paste') {
    $('#paste-form').outline.value = '';
    $('#paste-dialog').showModal();
  }
  if (act === 'claude') openClaude('', { job: { kind: 'map', id: map.id } });
  if (act === 'delete') {
    mapDialog.close();
    commit(S.deleteMap(state, map.id), { undoable: true });
    toast('ลบมายด์แมปแล้ว', { label: 'เลิกทำ', run: undo });
  }
});

/** "ให้ Claude ขยายความ" in the app, with the person's own API key (optional). */
async function expandMapApi(id) {
  const map = state.maps.find((m) => m.id === id);
  if (!map) return;
  toast('Claude กำลังขยายความ…');
  try {
    const note = C.readNote(await claudeFinal(C.noteRequest({ model: claudeCfg.model, kind: 'มายด์แมป', text: Mm.toOutline(map), today: longDate(today) })));
    if (!note.map) throw new Error(note.note || 'Claude ไม่ได้ส่งมายด์แมปกลับมา');
    replaceMap(id, Mm.toOutline(note.map), 'ขยายความแล้ว');
  } catch (err) {
    toast(err?.message || 'ไม่สำเร็จ');
  }
}

$('#paste-form').addEventListener('submit', () => {
  const text = $('#paste-form').outline.value;
  if (!mapId || !text.trim()) return;
  // a whole answer from Claude works too: its outline is picked out
  replaceMap(mapId, C.readPasted(text).outline || text, 'ใช้โครงร่างนี้แล้ว');
});

// ---- entry points --------------------------------------------------------------

$('#view-notes').addEventListener('click', (e) => {
  const create = e.target.closest('[data-create]')?.dataset.create;
  if (create === 'record') startRecording();
  if (create === 'map') newMindMap();
  if (create === 'note') openNote();
  if (create === 'list') openNote(null, { list: true });
  if (create === 'draw' || create === 'image' || create === 'camera') openNote(null, { then: create });
  const rec = e.target.closest('[data-rec-id]')?.dataset.recId;
  if (rec) openRec(rec);
  const map = e.target.closest('[data-map-id]')?.dataset.mapId;
  if (map) openMap(map);
});
$('#search-results').addEventListener('click', (e) => {
  const rec = e.target.closest('[data-rec-id]')?.dataset.recId;
  if (rec) openRec(rec);
  const map = e.target.closest('[data-map-id]')?.dataset.mapId;
  if (map) openMap(map);
});

/** Recordings made by the Android app while the page was closed (tile, side key, notification). */
function syncNativeRecordings() {
  if (!android?.recList) return;
  let list = [];
  try {
    list = JSON.parse(android.recList());
  } catch {
    return;
  }
  let next = state;
  for (const m of list) {
    const have = next.recs.find((r) => r.id === m.id);
    if (have) {
      const settled = m.stt !== 'running' && m.stt !== 'listening' && !m.appending;
      const got = settled && m.transcript ? nativeText(m) : null;
      if (got && got.transcript !== have.transcript && (!have.transcript || got.transcript.startsWith(have.transcript)))
        next = withSummary(S.editRec(next, m.id, got), m.id, { force: !!have.transcript });
      if (Array.isArray(m.marks) && m.marks.length && !have.marks?.length) next = S.editRec(next, m.id, { marks: S.cleanMarks(m.marks) });
      continue;
    }
    if (next.tomb?.[m.id]) continue;
    const title = m.shared ? `ไฟล์เสียงที่แชร์มา ${shortDate(dayKey(new Date(m.at)))} ${timeOf(new Date(m.at))}` : `บันทึกเสียง ${shortDate(dayKey(new Date(m.at)))} ${timeOf(new Date(m.at))}`;
    const got = m.stt === 'running' && !m.appending ? { transcript: '', times: [] } : nativeText(m);
    next = withSummary(S.addRec(next, { id: m.id, at: m.at, title, durationMs: m.durationMs, mime: m.mime, parts: m.parts, device: deviceName(), origin: 'android', ...got, marks: S.cleanMarks(m.marks) }), m.id);
  }
  if (next !== state) commit(next);
  // Still recording (started from the tile or the side key): show it.
  try {
    if (!recorder && JSON.parse(android.recState()).state !== 'idle') showNativeRecorder();
  } catch {
    // older app
  }
}

/** Recordings cut off by a crash or a closed tab: keep what was saved. */
async function recoverRecordings() {
  try {
    const found = await V.audio.recover();
    let next = state;
    for (const m of found) {
      if (next.recs.some((r) => r.id === m.id)) continue;
      next = S.addRec(next, { id: m.id, at: m.at, title: `บันทึกเสียง ${shortDate(dayKey(new Date(m.at)))} ${timeOf(new Date(m.at))} (กู้คืน)`, mime: m.mime, parts: m.parts, device: deviceName(), origin: 'web' });
    }
    if (next !== state) {
      commit(next);
      toast(`กู้คืนการอัดเสียงที่ค้างไว้ ${found.length} รายการ`);
    }
  } catch {
    // no IndexedDB here
  }
}

// ---- keeping things safe ---------------------------------------------------------

let lastCrashToast = 0;
function onCrash(err) {
  if (!err || ['AbortError', 'APIUserAbortError'].includes(err.name)) return;
  console.error(err);
  if (Date.now() - lastCrashToast < 60_000) return;
  lastCrashToast = Date.now();
  toast('มีบางอย่างสะดุด แต่ข้อมูลยังอยู่ครบ ถ้าหน้าจอแปลก ๆ ลองปิดแล้วเปิดใหม่');
}
addEventListener('error', (e) => onCrash(e.error));
addEventListener('unhandledrejection', (e) => onCrash(e.reason));

// Called by the Android app (MainActivity / PanelActivity).
window.paewai = {
  reload() {
    state = load();
    render();
    syncNote();
    updateHint();
    renderAndroid();
    scheduleSync(300);
    syncNativeRecordings();
  },
  openRec(id) {
    syncNativeRecordings();
    setView('notes');
    openRec(String(id));
  },
  focusCapture() {
    if (document.querySelector('dialog[open]')) return;
    setView('tasks');
    input.focus();
    android?.showKeyboard(); // after focus, so the keyboard opens on the input
  },
  show(next) {
    if (['tasks', 'notes', 'money', 'focus'].includes(next)) setView(next);
  },
  snooze(id, minutes = 10) {
    state = load();
    snooze(String(id), Number(minutes) || 10);
  },
  done(id) {
    state = load();
    markDone(String(id));
  },
  addShared(text) {
    const res = capture(String(text), { shared: true });
    if (res && !res.error) toast(`รับมาแล้ว: ${res.msg}`, { label: 'เลิกทำ', run: undo });
  },
  toast(message) {
    toast(message);
  },
  /** Pictures shared to the Android app (served to the page at these addresses): a new note with them. */
  importImages(urls, text = '') {
    importShared(urls, text);
  },
  openNote(id) {
    setView('notes');
    openNote(id ? String(id) : null);
  },
};

async function importShared(urls, text) {
  {
    const files = [];
    for (const url of [].concat(urls ?? []).slice(0, N.MAX_IMAGES)) {
      try {
        const blob = await (await fetch(String(url))).blob();
        files.push(new File([blob], 'shared', { type: /^image\//.test(blob.type) ? blob.type : 'image/jpeg' }));
      } catch {
        // skip what cannot be read
      }
    }
    if (!(await noteFromImages(files, { text: String(text ?? '') }))) toast('เปิดรูปที่แชร์มาไม่ได้');
  }
}

$('#version').textContent = `เวอร์ชัน ${VERSION}`;
render();
updateHint();
moveInk();
$('#swipe-tip').hidden = !matchMedia('(pointer: coarse)').matches || !!state.prefs.swipeTipSeen;
handleLaunch();
checkDue();
syncAndroid();
input.focus();
checkPairLink();
renderSyncStatus();
scheduleSync(800);
recoverRecordings();
syncNativeRecordings();
setTimeout(tidyNotes, 8000);

if (!android && 'serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
