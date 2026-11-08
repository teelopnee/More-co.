// App state and the pure functions that change it. Every function returns a new state object,
// so the UI can keep the previous one for "เลิกทำ" (undo).

import { addDays, dayKey } from './dates.js';

export const STORAGE_KEY = 'paewai:v1';
export const FOCUS_PRESETS = [5, 15, 25, 50];

export function emptyState() {
  return { v: 1, tasks: [], notes: {}, focus: null, focusLog: {}, prefs: {} };
}

let counter = 0;
export function uid(now = Date.now()) {
  counter = (counter + 1) % 1296;
  return now.toString(36) + counter.toString(36).padStart(2, '0') + Math.random().toString(36).slice(2, 6);
}

const isDay = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const isTime = (v) => typeof v === 'string' && /^\d{2}:\d{2}$/.test(v);

/** Accepts anything (saved JSON, an imported backup) and returns a valid state, or null. */
export function sanitize(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.tasks)) return null;
  const state = emptyState();
  const seen = new Set();
  for (const t of raw.tasks) {
    if (!t || typeof t.text !== 'string' || !t.text.trim()) continue;
    const id = typeof t.id === 'string' && !seen.has(t.id) ? t.id : uid();
    seen.add(id);
    const day = isDay(t.day) ? t.day : null;
    state.tasks.push({
      id,
      text: t.text.trim().slice(0, 2000),
      day,
      time: day && isTime(t.time) ? t.time : null,
      done: !!t.done,
      doneAt: t.done && Number.isFinite(t.doneAt) ? t.doneAt : null,
      createdAt: Number.isFinite(t.createdAt) ? t.createdAt : Date.now(),
      alerted: !!t.alerted,
    });
  }
  if (raw.notes && typeof raw.notes === 'object') {
    for (const [k, v] of Object.entries(raw.notes)) if (isDay(k) && typeof v === 'string' && v) state.notes[k] = v;
  }
  if (raw.focusLog && typeof raw.focusLog === 'object') {
    for (const [k, v] of Object.entries(raw.focusLog)) if (isDay(k) && Number.isFinite(v) && v > 0) state.focusLog[k] = v;
  }
  const f = raw.focus;
  if (f && Number.isFinite(f.totalMs) && (Number.isFinite(f.endsAt) || Number.isFinite(f.leftMs))) {
    state.focus = {
      totalMs: f.totalMs,
      endsAt: Number.isFinite(f.endsAt) ? f.endsAt : null,
      leftMs: Number.isFinite(f.endsAt) ? null : f.leftMs,
      label: typeof f.label === 'string' ? f.label.slice(0, 200) : '',
    };
  }
  if (raw.prefs && typeof raw.prefs === 'object') state.prefs = { ...raw.prefs };
  return state;
}

// ---------------------------------------------------------------------------
// Tasks

const update = (state, id, fn) => ({ ...state, tasks: state.tasks.map((t) => (t.id === id ? fn(t) : t)) });

export function addTask(state, { text, day = null, time = null }, now = Date.now()) {
  const clean = String(text ?? '').trim();
  if (!clean) return state;
  const task = {
    id: uid(now),
    text: clean,
    day: day ?? null,
    time: day ? (time ?? null) : null,
    done: false,
    doneAt: null,
    createdAt: now,
    alerted: false,
  };
  return { ...state, tasks: [...state.tasks, task] };
}

export function toggleDone(state, id, now = Date.now()) {
  return update(state, id, (t) => ({ ...t, done: !t.done, doneAt: t.done ? null : now }));
}

export function editTask(state, id, changes) {
  return update(state, id, (t) => {
    const next = { ...t };
    if (typeof changes.text === 'string' && changes.text.trim()) next.text = changes.text.trim();
    if ('day' in changes) next.day = changes.day || null;
    if ('time' in changes) next.time = changes.time || null;
    if (!next.day) next.time = null;
    if (next.day !== t.day || next.time !== t.time) next.alerted = false;
    return next;
  });
}

/** Move to a day (or null = กล่อง). Keeps the time only when staying on the same day. */
export function moveTask(state, id, day) {
  return update(state, id, (t) => ({ ...t, day: day ?? null, time: day && day === t.day ? t.time : null, alerted: false }));
}

export function deleteTask(state, id) {
  return { ...state, tasks: state.tasks.filter((t) => t.id !== id) };
}

export function markAlerted(state, ids) {
  const set = new Set(ids);
  return { ...state, tasks: state.tasks.map((t) => (set.has(t.id) ? { ...t, alerted: true } : t)) };
}

/** Drops tasks that were finished before today. */
export function clearDone(state, today) {
  return { ...state, tasks: state.tasks.filter((t) => !t.done || (doneDay(t) ?? '') >= today) };
}

/** Moves every unfinished task from earlier days onto today. */
export function carryOver(state, today) {
  return {
    ...state,
    tasks: state.tasks.map((t) => (!t.done && t.day && t.day < today ? { ...t, day: today, time: null, alerted: false } : t)),
  };
}

const doneDay = (t) => (t.doneAt ? dayKey(new Date(t.doneAt)) : null);

/** Unfinished first; then by time (untimed after timed); then oldest first. */
export function sortTasks(list) {
  return [...list].sort(
    (a, b) =>
      Number(a.done) - Number(b.done) ||
      (a.day ?? '').localeCompare(b.day ?? '') ||
      (a.time ?? '99').localeCompare(b.time ?? '99') ||
      a.createdAt - b.createdAt,
  );
}

/** Everything the task screen shows, grouped. Finished tasks stay visible on the day they were finished. */
export function taskViews(state, today, aheadDays = 6) {
  const shownDone = (t) => doneDay(t) === today;
  const inbox = state.tasks.filter((t) => !t.day && (!t.done || shownDone(t)));
  const todayList = state.tasks.filter((t) => t.day && t.day <= today && (!t.done || t.day === today || shownDone(t)));
  const lastAhead = addDays(today, aheadDays);
  const ahead = [];
  for (let i = 1; i <= aheadDays; i++) {
    const day = addDays(today, i);
    ahead.push({ day, tasks: sortTasks(state.tasks.filter((t) => t.day === day)) });
  }
  const later = sortTasks(state.tasks.filter((t) => t.day && t.day > lastAhead && !t.done));
  return {
    inbox: sortTasks(inbox),
    today: sortTasks(todayList),
    overdue: todayList.filter((t) => !t.done && t.day < today).length,
    ahead,
    later,
  };
}

/** Timed tasks due now that have not been announced yet. */
export function dueTasks(state, now = Date.now()) {
  const date = new Date(now);
  const today = dayKey(date);
  const hhmm = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  return state.tasks.filter((t) => !t.done && !t.alerted && t.time && (t.day < today || (t.day === today && t.time <= hhmm)));
}

export function stats(state, today, now = Date.now()) {
  const weekStart = addDays(today, -6);
  let doneToday = 0;
  let doneWeek = 0;
  for (const t of state.tasks) {
    const d = doneDay(t);
    if (!t.done || !d) continue;
    if (d === today) doneToday++;
    if (d >= weekStart && d <= today) doneWeek++;
  }
  let focusWeek = 0;
  for (const [d, ms] of Object.entries(state.focusLog)) if (d >= weekStart && d <= today) focusWeek += ms;
  const running = state.focus ? focusElapsed(state.focus, now) : 0;
  return {
    doneToday,
    doneWeek,
    open: state.tasks.filter((t) => !t.done).length,
    focusTodayMs: (state.focusLog[today] ?? 0) + running,
    focusWeekMs: focusWeek + running,
  };
}

/** Plain-text list of unfinished tasks, for pasting into LINE or notes. */
export function exportText(state, today, describe) {
  const v = taskViews(state, today, 6);
  const lines = [];
  const add = (title, list) => {
    const open = list.filter((t) => !t.done);
    if (!open.length) return;
    lines.push(title);
    for (const t of open) lines.push(`☐ ${t.text}${t.day ? ` (${describe(t.day, t.time)})` : ''}`);
    lines.push('');
  };
  add('กล่องรับ', v.inbox);
  add('วันนี้', v.today);
  add('ข้างหน้า', [...v.ahead.flatMap((g) => g.tasks), ...v.later]);
  return lines.join('\n').trim();
}

// ---------------------------------------------------------------------------
// Notes (one notepad per day)

export function setNote(state, day, text) {
  const notes = { ...state.notes };
  if (text) notes[day] = text;
  else delete notes[day];
  return { ...state, notes };
}

/** The line around a cursor position: { line, start, end }. */
export function lineAt(text, pos) {
  const p = Math.max(0, Math.min(pos, text.length));
  const start = p === 0 ? 0 : text.lastIndexOf('\n', p - 1) + 1;
  let end = text.indexOf('\n', p);
  if (end === -1) end = text.length;
  return { line: text.slice(start, end), start, end };
}

/** Removes the line at `pos` from the note: { line (without a bullet), rest, cursor }. */
export function takeLine(text, pos) {
  const { line, start, end } = lineAt(text, pos);
  const clean = line.replace(/^\s*(?:[-*•☐☑✓]|\d+[.)]|\[[ xX]?\])\s*/u, '').trim();
  const rest = end < text.length ? text.slice(0, start) + text.slice(end + 1) : text.slice(0, Math.max(0, start - 1));
  return { line: clean, rest, cursor: Math.min(start, rest.length) };
}

// ---------------------------------------------------------------------------
// Focus timer. Running: endsAt is set. Paused: leftMs is set.

export function focusLeft(focus, now = Date.now()) {
  if (!focus) return 0;
  return Math.max(0, focus.endsAt != null ? focus.endsAt - now : focus.leftMs);
}

export function focusElapsed(focus, now = Date.now()) {
  return focus ? Math.max(0, focus.totalMs - focusLeft(focus, now)) : 0;
}

export function startFocus(state, minutes, now = Date.now(), label = '') {
  const ms = Math.round(minutes * 60_000);
  const logged = state.focus ? logFocus(state, focusElapsed(state.focus, now), now) : state;
  return { ...logged, focus: { totalMs: ms, endsAt: now + ms, leftMs: null, label } };
}

export function pauseFocus(state, now = Date.now()) {
  const f = state.focus;
  if (!f || f.endsAt == null) return state;
  return { ...state, focus: { ...f, endsAt: null, leftMs: Math.max(0, f.endsAt - now) } };
}

export function resumeFocus(state, now = Date.now()) {
  const f = state.focus;
  if (!f || f.endsAt != null) return state;
  return { ...state, focus: { ...f, endsAt: now + f.leftMs, leftMs: null } };
}

export function extendFocus(state, minutes, now = Date.now()) {
  const f = state.focus;
  if (!f) return startFocus(state, minutes, now);
  const ms = minutes * 60_000;
  return {
    ...state,
    focus:
      f.endsAt != null
        ? { ...f, totalMs: f.totalMs + ms, endsAt: Math.max(f.endsAt, now) + ms }
        : { ...f, totalMs: f.totalMs + ms, leftMs: f.leftMs + ms },
  };
}

/** Ends the timer (finished or stopped early) and logs the time actually spent. */
export function stopFocus(state, now = Date.now()) {
  if (!state.focus) return state;
  return { ...logFocus(state, focusElapsed(state.focus, now), now), focus: null };
}

function logFocus(state, ms, now) {
  if (ms < 1000) return state;
  const day = dayKey(new Date(now));
  return { ...state, focusLog: { ...state.focusLog, [day]: (state.focusLog[day] ?? 0) + ms } };
}
