// แปะไว้ — the UI. State lives in lib/store.js, Thai dates in lib/dates.js.

import { addDays, dayKey, dayLabel, describeWhen, fromKey, longDate, parseWhen, shortDate, timeOf, toTimestamp } from './lib/dates.js';
import * as S from './lib/store.js';
import { icsFileName, taskToICS } from './lib/ics.js';

const VERSION = 'dev';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const icon = (id) => `<svg aria-hidden="true"><use href="#${id}"/></svg>`;
const URL_RE = /https?:\/\/[^\s<>"']+/i;

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
}

/** Replace the state, save it, redraw. `undoable` keeps the old state for the toast's เลิกทำ. */
function commit(next, { undoable = false, redraw = true } = {}) {
  if (next === state) return;
  if (undoable) undoState = state;
  state = next;
  save();
  if (redraw) render();
}

function undo() {
  if (!undoState) return;
  state = undoState;
  undoState = null;
  save();
  render();
  syncNote();
}

// ---------------------------------------------------------------------------
// Rendering

function render() {
  today = dayKey(new Date());
  $('#today-label').textContent = shortDate(today);
  renderTasks();
  renderNoteHead();
  renderFocus();
  $('#setup-banner').hidden = !!state.prefs.guideDone;
}

function taskItem(t, { withDay = false } = {}) {
  const overdue = !t.done && t.day && t.day < today;
  const late = overdue || (!t.done && t.day === today && t.time && t.time <= timeOf(new Date()));
  const meta = [];
  if (withDay && t.day) meta.push(describeWhen(t.day, t.time, today));
  else if (t.time) meta.push(`${t.time} น.`);
  if (overdue) {
    const label = dayLabel(t.day, today);
    meta.push(label === 'เมื่อวาน' ? 'ค้างจากเมื่อวาน' : `ค้างจาก ${label}`);
  }
  if (URL_RE.test(t.text)) meta.push('มีลิงก์');
  return `<li class="task${t.done ? ' done' : ''}${late ? ' late' : ''}" data-id="${esc(t.id)}">
<button type="button" class="check" data-action="toggle" role="checkbox" aria-checked="${t.done}" aria-label="เสร็จแล้ว: ${esc(t.text)}">${icon('i-check')}</button>
<button type="button" class="body" data-action="open"><span class="text">${esc(t.text)}</span>${meta.length ? `<span class="meta">${esc(meta.join(' · '))}</span>` : ''}</button>
</li>`;
}

const openCount = (list) => list.filter((t) => !t.done).length;
const countLabel = (n) => (n ? String(n) : '');

function renderTasks() {
  const v = S.taskViews(state, today, 6);

  const inbox = $('#col-inbox');
  $('.count', inbox).textContent = countLabel(openCount(v.inbox));
  $('.list', inbox).innerHTML = v.inbox.map((t) => taskItem(t)).join('');

  const col = $('#col-today');
  $('.count', col).textContent = countLabel(openCount(v.today));
  $('#today-sub').textContent = longDate(today);
  $('.list', col).innerHTML = v.today.map((t) => taskItem(t)).join('');
  const carry = $('.carry', col);
  carry.hidden = v.overdue === 0;
  carry.textContent = `ยก ${v.overdue} เรื่องที่ค้างมาเป็นของวันนี้`;

  const ahead = $('#col-ahead');
  const aheadOpen = v.ahead.reduce((n, g) => n + openCount(g.tasks), 0) + v.later.length;
  $('.count', ahead).textContent = countLabel(aheadOpen);
  const days = v.ahead.map(
    (g) => `<section class="day${g.tasks.length ? '' : ' empty-day'}">
<h3>${esc(dayLabel(g.day, today))}${dayLabel(g.day, today) === shortDate(g.day, today) ? '' : ` <span class="dim">${esc(shortDate(g.day, today))}</span>`}</h3>
${g.tasks.length ? `<ul class="list">${g.tasks.map((t) => taskItem(t)).join('')}</ul>` : ''}
</section>`,
  );
  if (v.later.length) {
    days.push(`<section class="day"><h3>หลังจากนั้น</h3><ul class="list">${v.later.map((t) => taskItem(t, { withDay: true })).join('')}</ul></section>`);
  }
  $('.ahead', ahead).innerHTML = days.join('');
}

function flash(id) {
  requestAnimationFrame(() => {
    const el = document.querySelector(`.task[data-id="${CSS.escape(id)}"]`);
    if (!el) return;
    el.classList.add('flash');
    el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    setTimeout(() => el.classList.remove('flash'), 1300);
  });
}

// ---------------------------------------------------------------------------
// Capture bar

const input = $('#capture-input');
const hint = $('#capture-hint');
const DEFAULT_HINT = 'พิมพ์แล้วกด Enter · ใส่วันเวลาแบบพูดได้ เช่น “พรุ่งนี้ บ่ายสอง”';

function captureParse(text) {
  return dropWhen ? { text: text.trim(), day: null, time: null } : parseWhen(text, Date.now());
}

function updateHint() {
  const text = input.value;
  if (!text.trim()) {
    dropWhen = false;
    hint.innerHTML = `<span class="dim">${DEFAULT_HINT}</span>`;
    return;
  }
  const p = captureParse(text);
  if (p.day) {
    hint.innerHTML = `<span class="when-chip">${icon('i-cal')}${esc(describeWhen(p.day, p.time, today))}<button type="button" data-action="drop-when" aria-label="ไม่ใส่วันเวลา">${icon('i-close')}</button></span><span class="dim">${esc(p.text)}</span>`;
  } else {
    hint.innerHTML = `<span class="dim">ไม่มีวัน → ลงกล่องรับ</span>`;
  }
}

function addFromText(text, { parse = true } = {}) {
  const p = parse ? captureParse(text) : { text: text.trim(), day: null, time: null };
  const next = S.addTask(state, p);
  if (next === state) return null;
  commit(next, { undoable: true });
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
  if (e.key === 'Escape' && input.value) {
    e.preventDefault();
    input.value = '';
    updateHint();
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
  commit(next, { undoable: true });
  toast(`แปะ ${lines.length} เรื่องแล้ว`, { label: 'เลิกทำ', run: undo });
});

hint.addEventListener('click', (e) => {
  if (!e.target.closest('[data-action="drop-when"]')) return;
  dropWhen = true;
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
  if (next === 'notes') syncNote();
  if (next === 'focus') renderFocus();
}

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
  if (action === 'toggle' && id) {
    commit(S.toggleDone(state, id), { undoable: true });
  } else if (action === 'open' && id) {
    openTask(id);
  } else if (action === 'carry') {
    commit(S.carryOver(state, today), { undoable: true });
    toast('ยกมาเป็นของวันนี้แล้ว', { label: 'เลิกทำ', run: undo });
  } else if (action === 'guide') {
    refreshMenu();
    $('#guide-dialog').showModal();
  } else if (action === 'dismiss-banner') {
    commit({ ...state, prefs: { ...state.prefs, guideDone: true } });
  }
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
  commit(S.editTask(state, t.id, { text: taskForm.text.value, day, time: day ? taskForm.time.value || null : null }), { undoable: true });
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
    commit(S.deleteTask(state, t.id), { undoable: true });
    taskDialog.close();
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

  const chip = $('#focus-chip');
  chip.hidden = !f;
  chip.classList.toggle('paused', !!f && !running);
  $('span', chip).textContent = f ? fmt(left) : '';
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

$('#focus-chip').addEventListener('click', () => setView('focus'));

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
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
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
  $('[data-menu="notify"]').hidden = !('Notification' in window) || Notification.permission === 'granted';
  $('#installed-note').hidden = !matchMedia('(display-mode: standalone)').matches;
}

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
      await navigator.clipboard.writeText(text);
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
  history.replaceState(null, '', location.pathname);
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
  if (document.visibilityState !== 'visible') return;
  render();
  checkDue();
  if (view === 'tasks' && !document.querySelector('dialog[open]') && document.activeElement === document.body) input.focus();
});

function tick() {
  const f = state.focus;
  if (f && f.endsAt != null && f.endsAt <= Date.now()) finishFocus();
  else if (f) renderFocus();
  if (dayKey(new Date()) !== today) {
    if (noteDay === today) noteDay = dayKey(new Date());
    render();
    syncNote();
  }
}
setInterval(tick, 1000);
setInterval(checkDue, 15_000);

$('#version').textContent = `เวอร์ชัน ${VERSION}`;
render();
updateHint();
handleLaunch();
checkDue();
input.focus();

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
