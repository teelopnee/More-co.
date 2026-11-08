// แปะไว้ — the UI. State lives in lib/store.js, Thai dates in lib/dates.js.

import { addDays, dayKey, dayLabel, describeWhen, diffDays, fromKey, longDate, parseWhen, repeatLabel, shortDate, timeOf, toTimestamp } from './lib/dates.js';
import * as S from './lib/store.js';
import { MONEY_CATS, classify, findAmount, pastedLines } from './lib/sort.js';
import { icsFileName, taskToICS } from './lib/ics.js';
import * as Y from './lib/sync.js';
import { GitHubRepo, explain } from './lib/github.js';
import * as C from './lib/claude.js';

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
  try {
    const raw = localStorage.getItem(S.STORAGE_KEY);
    if (raw) return S.sanitize(JSON.parse(raw)) ?? S.emptyState();
  } catch {
    // unreadable storage: start empty
  }
  return S.emptyState();
}

function save({ sync = true } = {}) {
  try {
    localStorage.setItem(S.STORAGE_KEY, JSON.stringify(state));
  } catch {
    toast('บันทึกไม่ได้ ที่เก็บข้อมูลในเครื่องเต็มหรือถูกปิดไว้');
  }
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
    $('#hero-greet').textContent = `${state.memos.length ? `${state.memos.length} โน้ตย่อ · ` : ''}บันทึก${noteDay === today ? `วันนี้ · ${shortDate(today)}` : longDate(noteDay)}`;
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
  if (r.kind === 'note') return S.addMemo(st, r.text, now);
  if (r.kind === 'shop') return S.addShop(st, r.items.length ? r.items : [r.text], now);
  if (r.kind === 'money') return r.amount ? S.addMoney(st, r, now) : S.addMemo(st, r.text, now);
  return S.addTask(st, r, now);
}

/** Sorts and saves what was typed or shared; returns what to tell the person. */
function capture(text, { shared = false } = {}) {
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
  const lines = pastedLines(e.clipboardData?.getData('text/plain') ?? '');
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

function memoCard(m) {
  const link = URL_RE.test(m.text);
  return `<button type="button" class="memo${m.pinned ? ' pinned' : ''}" data-memo="${esc(m.id)}">
${m.pinned ? `<span class="memo-pin">${icon('i-pin')}</span>` : ''}<span class="memo-text">${esc(m.text)}</span>
<span class="memo-meta">${link ? `${icon('i-link')} ` : ''}${esc(ago(m.updatedAt))}</span></button>`;
}

function renderNotes() {
  const q = $('#search').value.trim();
  $('#search-results').hidden = !q;
  $('#notes-main').hidden = !!q;
  if (q) {
    renderSearch(q);
    return;
  }
  const memos = S.sortedMemos(state);
  $('#memo-count').textContent = countLabel(memos.length);
  $('#memos').innerHTML = memos.map(memoCard).join('');
  $('#memos-empty').hidden = memos.length > 0;
}

function renderSearch(q) {
  const r = S.search(state, q);
  const part = (title, html) => (html ? `<h3>${title}</h3>${html}` : '');
  const html =
    part('งาน', r.tasks.length ? `<ul class="list">${r.tasks.map((t) => taskItem(t, { withDay: true })).join('')}</ul>` : '') +
    part('โน้ตย่อ', r.memos.length ? `<div class="memos">${r.memos.map(memoCard).join('')}</div>` : '') +
    part('บันทึกประจำวัน', r.notes.length ? `<ul class="list">${r.notes.map((n) => `<li class="plain-row"><button type="button" class="row-btn" data-note-day="${n.day}"><strong>${esc(shortDate(n.day, today))}</strong><span>${esc(n.line)}</span></button></li>`).join('')}</ul>` : '') +
    part('ของต้องซื้อ', r.shop.length ? `<ul class="list shop-list">${r.shop.map(shopItem).join('')}</ul>` : '') +
    part('รายจ่าย', r.money.length ? `<ul class="list">${r.money.map(moneyItem).join('')}</ul>` : '');
  $('#search-results').innerHTML = html || `<p class="empty">ไม่เจอ “${esc(q)}”</p>`;
}

$('#search').addEventListener('input', () => renderNotes());

$('#view-notes').addEventListener('click', (e) => {
  const memo = e.target.closest('[data-memo]')?.dataset.memo;
  if (memo) {
    openItem('memo', memo);
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
    if (e.target === dialog) dialog.close();
    if (e.target.closest('[data-close]')) dialog.close();
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
    await shareFile(`paewai-${today}.json`, JSON.stringify(state, null, 1), 'application/json');
  }
  if (item === 'import') $('#import-file').click();
});

$('#import-file').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  let next = null;
  try {
    next = S.sanitize(JSON.parse(await file.text()));
  } catch {
    next = null;
  }
  if (!next) {
    toast('ไฟล์นี้ไม่ใช่ไฟล์สำรองของแปะไว้');
    return;
  }
  const { state: merged, added } = S.restoreFrom(state, next);
  menu.close();
  if (!added) {
    toast('ทุกอย่างในไฟล์สำรองมีอยู่แล้ว');
    return;
  }
  commit(merged, { undoable: true });
  syncNote();
  toast(`กู้คืน ${added} รายการที่หายไป (ของที่มีอยู่ไม่ถูกแตะ)`, { label: 'เลิกทำ', run: undo });
});

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
function toast(message, action) {
  const el = $('#toast');
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
  if (e.key !== S.STORAGE_KEY) return;
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
// Ask Claude (lib/claude.js): in the app with the person's API key, or in the Claude app

const claudeDialog = $('#claude-dialog');
let claudeCfg = loadClaudeCfg(); // { key, model } on this device only
let claudeItems = [];
let asking = null;

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
}

function openClaude(question = '') {
  if (question) $('#claude-q').value = question;
  $('#claude-key').value = claudeCfg.key ?? '';
  $('#claude-model').value = C.MODELS.includes(claudeCfg.model) ? claudeCfg.model : C.DEFAULT_MODEL;
  $('#claude-settings').open = false;
  if (!claudeDialog.open) claudeDialog.showModal();
  if (question && claudeCfg.key) askClaude();
}

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
      if (line) blocks.push(`<p>${inline(line.replace(/^#+\s*/, ''))}</p>`);
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

async function askClaude() {
  const question = $('#claude-q').value.trim();
  if (!question) {
    toast('พิมพ์คำถาม หรือแตะคำถามสำเร็จรูปก่อน');
    return;
  }
  if (!claudeCfg.key) {
    $('#claude-settings').open = true;
    $('#claude-key').focus();
    toast('ใส่ API key ก่อน หรือใช้ “เปิดใน Claude” แทน');
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
    const r = classify(it.text, now, { force: it.kind });
    const when = r.kind === 'task' && r.day ? describeWhen(r.day, r.time, today) : r.kind === 'money' && r.amount ? baht(r.amount) : '';
    const tone = r.kind === 'task' && r.day ? 'remind' : r.kind;
    return `<li><label><input type="checkbox" data-i="${i}" checked><span class="kind-chip small k-${tone}">${esc(KIND_NAMES[r.kind])}</span><span class="suggest-text">${esc(r.kind === 'shop' && r.items.length > 1 ? r.items.map((x) => x.text).join(' · ') : r.text)}${when ? ` <em>${esc(when)}</em>` : ''}</span></label></li>`;
  });
  $('#claude-out').innerHTML =
    `<div class="answer">${miniMarkdown(reply)}</div>` +
    (why ? `<p class="dim small">${esc(why)}</p>` : '') +
    (items.length
      ? `<div class="suggest"><p class="suggest-title">แปะลงแอปได้เลย</p><ul>${rows.join('')}</ul><button type="button" class="primary" data-claude="add">แปะที่เลือก</button></div>`
      : '') +
    `<button type="button" class="text-btn" data-claude="copy">คัดลอกคำตอบ</button>`;
}

const KIND_NAMES = { task: 'งาน', note: 'โน้ต', shop: 'ซื้อ', money: 'จ่าย' };

function addClaudeItems() {
  const now = Date.now();
  let next = state;
  let n = 0;
  for (const box of $$('#claude-out input[data-i]:checked')) {
    const it = claudeItems[Number(box.dataset.i)];
    if (!it) continue;
    const r = classify(it.text, now, { force: it.kind });
    if (r.kind === 'money' && !r.amount) continue;
    next = route(next, r, now + n);
    n++;
  }
  if (!n) {
    toast('ยังไม่ได้เลือกอะไร');
    return;
  }
  claudeDialog.close();
  commit(next, { undoable: true, animate: true });
  toast(`แปะ ${n} เรื่องจาก Claude แล้ว`, { label: 'เลิกทำ', run: undo });
}

function openInClaudeApp() {
  const question = $('#claude-q').value.trim() || C.PRESETS.plan;
  const prompt = C.webPrompt(question, $('#claude-context').checked ? C.contextFor(state, today) : '');
  const link = C.webLink(prompt);
  copyText(prompt, null);
  const a = Object.assign(document.createElement('a'), { href: link, target: '_blank', rel: 'noopener' });
  document.body.append(a);
  a.click();
  a.remove();
  toast(link === C.CLAUDE_WEB ? 'คัดลอกคำถามแล้ว วางในแชตของ Claude ได้เลย' : 'เปิด Claude แล้ว ได้คำตอบแล้วคัดลอกมาวางในช่องแปะ จะจัดให้ทีละบรรทัด');
}

claudeDialog.addEventListener('click', (e) => {
  const preset = e.target.closest('[data-ask]')?.dataset.ask;
  if (preset) {
    $('#claude-q').value = C.PRESETS[preset];
    if (claudeCfg.key) askClaude();
    return;
  }
  const act = e.target.closest('[data-claude]')?.dataset.claude;
  if (act === 'ask') askClaude();
  if (act === 'open') openInClaudeApp();
  if (act === 'add') addClaudeItems();
  if (act === 'copy') copyText($('#claude-out .answer')?.innerText ?? '');
});
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
    askClaude();
  }
});
claudeDialog.addEventListener('close', () => asking?.abort());

// Called by the Android app (MainActivity / PanelActivity).
window.paewai = {
  reload() {
    state = load();
    render();
    syncNote();
    updateHint();
    renderAndroid();
    scheduleSync(300);
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
};

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

if (!android && 'serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
