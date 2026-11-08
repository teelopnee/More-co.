// แปะไว้ — the UI. State lives in lib/store.js, Thai dates in lib/dates.js.

import { addDays, dayKey, dayLabel, describeWhen, fromKey, longDate, parseWhen, shortDate, toTimestamp } from './lib/dates.js';
import * as S from './lib/store.js';
import { icsFileName, taskToICS } from './lib/ics.js';

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

// ---------------------------------------------------------------------------
// State

let state = load();
let undoState = null;
let today = dayKey(new Date());
let view = 'tasks';
let noteDay = today;
let dropWhen = false; // the person tapped × on the parsed date
let editingId = null;
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

function save() {
  try {
    localStorage.setItem(S.STORAGE_KEY, JSON.stringify(state));
  } catch {
    toast('บันทึกไม่ได้ ที่เก็บข้อมูลในเครื่องเต็มหรือถูกปิดไว้');
  }
  syncAndroid();
}

/** Tells the Android app what the notch pill shows and which alarms to set. */
function syncAndroid() {
  if (!android) return;
  const now = Date.now();
  const reminders = state.tasks
    .filter((t) => !t.done && t.day && t.time)
    .map((t) => ({ id: t.id, at: toTimestamp(t.day, t.time), title: `ถึงเวลา ${t.time} น.`, text: t.text }))
    .filter((r) => r.at > now);
  const f = state.focus;
  if (f?.endsAt) {
    reminders.push({ id: 'focus', at: f.endsAt, title: 'ครบเวลาโฟกัส', text: f.label || 'พักสายตาหน่อย' });
  }
  const summary = {
    openDays: state.tasks.filter((t) => !t.done && t.day).map((t) => t.day),
    focus: f ? { endsAt: f.endsAt ?? 0, leftMs: f.leftMs ?? 0 } : null,
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
  state = next;
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
  state = undoState;
  undoState = null;
  save();
  rendered = animated(render);
  syncNote();
}

/** A short tick on devices that can vibrate. */
function buzz(ms = 8) {
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
  renderNoteHead();
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
    badges.push(`<span class="badge">${icon('i-cal')}${esc(describeWhen(t.day, t.time, today))}</span>`);
  } else if (t.time) {
    const tone = mins == null ? '' : mins <= 0 ? ' late' : mins <= 60 ? ' soon' : '';
    badges.push(`<span class="badge time${tone}">${icon('i-clock')}${esc(t.time)}</span>`);
  }
  if (overdue) {
    const label = dayLabel(t.day, today);
    badges.push(`<span class="badge late">${label === 'เมื่อวาน' ? 'ค้างจากเมื่อวาน' : `ค้างจาก ${esc(label)}`}</span>`);
  }
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

const VIEW_NAMES = { tasks: 'งาน', notes: 'โน้ต', focus: 'โฟกัส' };

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
    $('#hero-greet').textContent = noteDay === today ? `วันนี้ · ${shortDate(today)}` : longDate(noteDay);
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
  $('#hero-greet').textContent = `${greeting()} · ${shortDate(today)}${list.length ? ` · เสร็จ ${done}/${list.length}` : ''}`;

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

function captureParse(text) {
  return dropWhen ? { text: text.trim(), day: null, time: null } : parseWhen(text, Date.now());
}

function updateHint() {
  const text = input.value;
  if (!text.trim()) {
    dropWhen = false;
    if (!hint.querySelector('.chip') || hint.querySelector('.when-chip')) hint.innerHTML = `<span class="chip-label">ใส่วัน</span>${quickChips()}`;
    return;
  }
  const p = captureParse(text);
  if (p.day) {
    const label = describeWhen(p.day, p.time, today);
    const chip = hint.querySelector('.when-chip');
    // Keep the chip (and its pop-in) while only the text after it changes.
    if (chip && chip.dataset.when === label) hint.querySelector('.parsed').textContent = p.text;
    else hint.innerHTML = `<span class="when-chip" data-when="${esc(label)}">${icon('i-cal')}${esc(label)}<button type="button" data-action="drop-when" aria-label="ไม่ใส่วันเวลา">${icon('i-close')}</button></span><span class="dim parsed">${esc(p.text)}</span>`;
  } else if (!hint.querySelector('.into-inbox')) {
    hint.innerHTML = `<span class="chip-label into-inbox">ลงกล่องรับ หรือ</span>${dropWhen ? '' : quickChips()}`;
  }
}

function addFromText(text, { parse = true } = {}) {
  const p = parse ? captureParse(text) : { text: text.trim(), day: null, time: null };
  const next = S.addTask(state, p);
  if (next === state) return null;
  commit(next, { undoable: true, animate: true });
  persistOnce();
  return { id: next.tasks.at(-1).id, where: p.day ? describeWhen(p.day, p.time, today) : 'กล่องรับ' };
}

$('#capture').addEventListener('submit', (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text) {
    input.focus();
    return;
  }
  const added = addFromText(text);
  input.value = '';
  dropWhen = false;
  updateHint();
  input.focus();
  if (!added) return;
  toast(`แปะไว้ที่${added.where === 'กล่องรับ' ? 'กล่องรับ' : ` ${added.where}`}แล้ว`, { label: 'เลิกทำ', run: undo });
  if (view === 'tasks') flash(added.id);
});

input.addEventListener('input', updateHint);
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

// Several lines pasted at once = several things to remember.
input.addEventListener('paste', (e) => {
  const text = e.clipboardData?.getData('text/plain') ?? '';
  const lines = text.split(/\r?\n/).map((l) => l.replace(/^\s*(?:[-*•☐]|\d+[.)])\s*/u, '').trim()).filter(Boolean);
  if (lines.length < 2) return;
  e.preventDefault();
  let next = state;
  for (const line of lines) next = S.addTask(next, parseWhen(line, Date.now()));
  commit(next, { undoable: true, animate: true });
  toast(`แปะ ${lines.length} เรื่องแล้ว`, { label: 'เลิกทำ', run: undo });
});

hint.addEventListener('click', (e) => {
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
  hint.innerHTML = '';
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
  for (const tab of $$('.tabs [role="tab"]')) tab.setAttribute('aria-selected', String(tab.dataset.view === next));
  for (const id of ['tasks', 'notes', 'focus']) $(`#view-${id}`).hidden = id !== next;
  moveInk();
  renderHero();
  renderFocus();
  if (innerWidth < 840) scrollTo({ top: 0 });
  if (next === 'notes') syncNote();
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

$('#view-tasks').addEventListener('click', (e) => {
  const action = e.target.closest('[data-action]')?.dataset.action;
  if (!action) return;
  const id = e.target.closest('.task')?.dataset.id;
  if (swallowClick) {
    swallowClick = false;
    return;
  }
  if (action === 'toggle' && id) {
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
});

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
  const row = e.target.closest('.task .row');
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
  commit(S.editTask(state, t.id, { text: taskForm.text.value, day, time: day ? taskForm.time.value || null : null }), { undoable: true, animate: true });
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
  state = S.setNote(state, noteDay, note.value);
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
  toast(`ถึงเวลา: ${fresh[0].text}${fresh.length > 1 ? ` และอีก ${fresh.length - 1} เรื่อง` : ''}`);
  for (const t of fresh) notify(`ถึงเวลา ${t.time} น.`, t.text);
}

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

async function notify(title, body) {
  // In the Android app the alarms set through syncAndroid() notify instead.
  if (android || !('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) await reg.showNotification(title, { body, icon: 'icons/icon-192.png', tag: `${title}|${body}`, lang: 'th' });
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
  $('#installed-note').hidden = !matchMedia('(display-mode: standalone)').matches;
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
  if (!confirm(`แทนที่ข้อมูลตอนนี้ด้วยไฟล์สำรอง (${next.tasks.length} เรื่อง)?`)) return;
  commit(next, { undoable: true });
  syncNote();
  menu.close();
  toast('กู้คืนแล้ว', { label: 'เลิกทำ', run: undo });
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
  } else if ((e.ctrlKey || e.altKey) && ['1', '2', '3'].includes(e.key)) {
    e.preventDefault();
    setView(['tasks', 'notes', 'focus'][Number(e.key) - 1]);
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
    const added = addFromText(parts.join(' '), { parse: false });
    if (added) {
      toast('รับเข้ากล่องรับแล้ว', { label: 'เลิกทำ', run: undo });
      flash(added.id);
    }
  }
  const v = params.get('view');
  if (v === 'notes' || v === 'focus') setView(v);
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

// Called by the Android app (MainActivity / PanelActivity).
window.paewai = {
  reload() {
    state = load();
    render();
    syncNote();
    updateHint();
    renderAndroid();
  },
  focusCapture() {
    if (document.querySelector('dialog[open]')) return;
    setView('tasks');
    input.focus();
    android?.showKeyboard(); // after focus, so the keyboard opens on the input
  },
  show(next) {
    if (['tasks', 'notes', 'focus'].includes(next)) setView(next);
  },
  addShared(text) {
    const added = addFromText(String(text), { parse: false });
    if (!added) return;
    toast('รับเข้ากล่องรับแล้ว', { label: 'เลิกทำ', run: undo });
    flash(added.id);
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

if (!android && 'serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
