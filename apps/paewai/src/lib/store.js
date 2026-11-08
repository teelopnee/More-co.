// App state and the pure functions that change it. Every function returns a new state object,
// so the UI can keep the previous one for "เลิกทำ" (undo).

import { addDays, dayKey, diffDays, isRepeat, nextOccurrence, toTimestamp } from './dates.js';
import { MONEY_CATS, SHOP_SECTIONS, shopSection } from './sort.js';

export const STORAGE_KEY = 'paewai:v1';
export const FOCUS_PRESETS = [5, 15, 25, 50];

export function emptyState() {
  return {
    v: 2,
    tasks: [],
    notes: {},
    memos: [],
    shop: [],
    money: [],
    focus: null,
    focusLog: {},
    prefs: {},
    // Shared between devices (lib/sync.js): when each day's note changed, what was deleted, settings.
    notesAt: {},
    tomb: {},
    settings: {},
    settingsAt: 0,
  };
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
      repeat: day && isRepeat(t.repeat) ? t.repeat : null,
      streak: t.repeat && Number.isInteger(t.streak) && t.streak > 0 ? t.streak : 0,
      ...(Number.isFinite(t.lastDoneAt) ? { lastDoneAt: t.lastDoneAt } : {}),
      ...(day && Number.isFinite(t.snoozeAt) ? { snoozeAt: t.snoozeAt } : {}),
      updatedAt: Number.isFinite(t.updatedAt) ? t.updatedAt : Number.isFinite(t.createdAt) ? t.createdAt : 0,
    });
  }
  const ids = new Set();
  const freshId = (id) => {
    const out = typeof id === 'string' && id && !ids.has(id) ? id : uid();
    ids.add(out);
    return out;
  };
  const when = (v) => (Number.isFinite(v) ? v : Date.now());
  for (const m of Array.isArray(raw.memos) ? raw.memos : []) {
    if (!m || typeof m.text !== 'string' || !m.text.trim()) continue;
    state.memos.push({ id: freshId(m.id), text: m.text.slice(0, 20_000), pinned: !!m.pinned, createdAt: when(m.createdAt), updatedAt: when(m.updatedAt ?? m.createdAt) });
  }
  for (const i of Array.isArray(raw.shop) ? raw.shop : []) {
    if (!i || typeof i.text !== 'string' || !i.text.trim()) continue;
    state.shop.push({
      id: freshId(i.id),
      text: i.text.trim().slice(0, 200),
      cat: SHOP_SECTIONS.includes(i.cat) ? i.cat : shopSection(i.text),
      done: !!i.done,
      doneAt: i.done && Number.isFinite(i.doneAt) ? i.doneAt : null,
      createdAt: when(i.createdAt),
      updatedAt: Number.isFinite(i.updatedAt) ? i.updatedAt : Number.isFinite(i.createdAt) ? i.createdAt : 0,
    });
  }
  for (const e of Array.isArray(raw.money) ? raw.money : []) {
    if (!e || !Number.isFinite(e.amount) || e.amount <= 0) continue;
    state.money.push({
      id: freshId(e.id),
      text: typeof e.text === 'string' && e.text.trim() ? e.text.trim().slice(0, 200) : 'รายจ่าย',
      amount: Math.round(e.amount * 100) / 100,
      cat: MONEY_CATS.includes(e.cat) ? e.cat : 'อื่น ๆ',
      at: when(e.at),
      updatedAt: Number.isFinite(e.updatedAt) ? e.updatedAt : Number.isFinite(e.at) ? e.at : 0,
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
  const times = (obj, keyOk) => {
    const out = {};
    if (obj && typeof obj === 'object') for (const [k, v] of Object.entries(obj)) if (keyOk(k) && Number.isFinite(v) && v > 0) out[k] = v;
    return out;
  };
  state.notesAt = times(raw.notesAt, isDay);
  state.tomb = times(raw.tomb, (k) => typeof k === 'string' && k.length <= 64);
  if (raw.settings && typeof raw.settings === 'object' && !Array.isArray(raw.settings)) {
    const budget = Number(raw.settings.budget);
    if (budget > 0) state.settings.budget = Math.round(budget);
  }
  state.settingsAt = Number.isFinite(raw.settingsAt) ? raw.settingsAt : 0;
  return state;
}

// ---------------------------------------------------------------------------
// Tasks

const update = (state, id, fn) => ({ ...state, tasks: state.tasks.map((t) => (t.id === id ? fn(t) : t)) });

export function addTask(state, { text, day = null, time = null, repeat = null }, now = Date.now()) {
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
    repeat: day && isRepeat(repeat) ? repeat : null,
    streak: 0,
  };
  return { ...state, tasks: [...state.tasks, task] };
}

export function toggleDone(state, id, now = Date.now()) {
  return update(state, id, (t) => {
    if (t.repeat && !t.done) {
      // A repeating reminder is never "done": it moves on to its next time.
      const today = dayKey(new Date(now));
      let next = nextOccurrence(t.repeat, t.day);
      while (next < today) next = nextOccurrence(t.repeat, next);
      return { ...unsnoozed(t), day: next, alerted: false, streak: (t.streak ?? 0) + 1, lastDoneAt: now };
    }
    return { ...unsnoozed(t), done: !t.done, doneAt: t.done ? null : now };
  });
}

const unsnoozed = (t) => {
  if (t.snoozeAt == null) return t;
  const { snoozeAt, ...rest } = t;
  return rest;
};

/** "เลื่อน 10 นาที": rings again later without moving the task (a repeating one keeps its usual time). */
export function snoozeTask(state, id, minutes = 10, now = Date.now()) {
  return update(state, id, (t) => {
    if (t.done || !t.day) return t;
    const due = t.time ? toTimestamp(t.day, t.time) : now;
    return { ...t, snoozeAt: Math.max(now, due) + Math.round(minutes * 60_000), alerted: false };
  });
}

/** When a task rings: the snooze time, or its day and time. */
export const ringAt = (t) => t.snoozeAt ?? (t.day && t.time ? toTimestamp(t.day, t.time) : null);

export function setRepeat(state, id, repeat) {
  return update(state, id, (t) => ({ ...t, repeat: t.day && isRepeat(repeat) ? repeat : null }));
}

export function editTask(state, id, changes) {
  return update(state, id, (t) => {
    const next = { ...t };
    if (typeof changes.text === 'string' && changes.text.trim()) next.text = changes.text.trim();
    if ('day' in changes) next.day = changes.day || null;
    if ('time' in changes) next.time = changes.time || null;
    if ('repeat' in changes) next.repeat = isRepeat(changes.repeat) ? changes.repeat : null;
    if (!next.day) {
      next.time = null;
      next.repeat = null;
    }
    if (next.day !== t.day || next.time !== t.time) {
      next.alerted = false;
      delete next.snoozeAt;
    }
    return next;
  });
}

/** Move to a day (or null = กล่อง). Keeps the time only when staying on the same day. */
export function moveTask(state, id, day) {
  return update(state, id, (t) => ({ ...unsnoozed(t), day: day ?? null, time: day && day === t.day ? t.time : null, repeat: day ? t.repeat : null, alerted: false }));
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
    tasks: state.tasks.map((t) => (!t.done && t.day && t.day < today ? { ...unsnoozed(t), day: today, time: null, alerted: false } : t)),
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
  return state.tasks.filter(
    (t) => !t.done && !t.alerted && t.time && (t.snoozeAt != null ? t.snoozeAt <= now : t.day < today || (t.day === today && t.time <= hhmm)),
  );
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
// Quick notes (Keep-style cards)

export function addMemo(state, text, now = Date.now()) {
  const clean = String(text ?? '').trim();
  if (!clean) return state;
  return { ...state, memos: [{ id: uid(now), text: clean, pinned: false, createdAt: now, updatedAt: now }, ...state.memos] };
}

export function editMemo(state, id, text, now = Date.now()) {
  const clean = String(text ?? '').trim();
  if (!clean) return deleteMemo(state, id);
  return { ...state, memos: state.memos.map((m) => (m.id === id ? { ...m, text: clean, updatedAt: now } : m)) };
}

export function pinMemo(state, id) {
  return { ...state, memos: state.memos.map((m) => (m.id === id ? { ...m, pinned: !m.pinned } : m)) };
}

export function deleteMemo(state, id) {
  return { ...state, memos: state.memos.filter((m) => m.id !== id) };
}

/** Pinned first, then newest. */
export function sortedMemos(state) {
  return [...state.memos].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt);
}

// ---------------------------------------------------------------------------
// Shopping list, grouped by store section

export function addShop(state, items, now = Date.now()) {
  const fresh = items
    .map((i) => (typeof i === 'string' ? { text: i } : i))
    .filter((i) => i.text && i.text.trim())
    .map((i, n) => ({ id: uid(now + n), text: i.text.trim(), cat: i.cat ?? shopSection(i.text), done: false, doneAt: null, createdAt: now }));
  return fresh.length ? { ...state, shop: [...state.shop, ...fresh] } : state;
}

export function toggleShop(state, id, now = Date.now()) {
  return { ...state, shop: state.shop.map((i) => (i.id === id ? { ...i, done: !i.done, doneAt: i.done ? null : now } : i)) };
}

export function editShop(state, id, text) {
  const clean = String(text ?? '').trim();
  if (!clean) return deleteShop(state, id);
  return { ...state, shop: state.shop.map((i) => (i.id === id ? { ...i, text: clean, cat: shopSection(clean) } : i)) };
}

export function deleteShop(state, id) {
  return { ...state, shop: state.shop.filter((i) => i.id !== id) };
}

export function clearBought(state) {
  return { ...state, shop: state.shop.filter((i) => !i.done) };
}

/** [{ cat, items }] in store-walk order, then what is already in the basket. */
export function shopGroups(state) {
  const open = state.shop.filter((i) => !i.done);
  const groups = SHOP_SECTIONS.map((cat) => ({ cat, items: open.filter((i) => i.cat === cat) })).filter((g) => g.items.length);
  return { groups, bought: state.shop.filter((i) => i.done), open: open.length };
}

// ---------------------------------------------------------------------------
// Money spent

export function addMoney(state, { text, amount, cat }, now = Date.now()) {
  if (!(amount > 0)) return state;
  const entry = { id: uid(now), text: String(text ?? '').trim() || 'รายจ่าย', amount: Math.round(amount * 100) / 100, cat: MONEY_CATS.includes(cat) ? cat : 'อื่น ๆ', at: now };
  return { ...state, money: [...state.money, entry] };
}

export function editMoney(state, id, changes) {
  return {
    ...state,
    money: state.money.map((e) =>
      e.id === id
        ? {
            ...e,
            ...(typeof changes.text === 'string' && changes.text.trim() ? { text: changes.text.trim() } : {}),
            ...(changes.amount > 0 ? { amount: Math.round(changes.amount * 100) / 100 } : {}),
            ...(MONEY_CATS.includes(changes.cat) ? { cat: changes.cat } : {}),
          }
        : e,
    ),
  };
}

/** Monthly budget (shared between devices); 0 or less = no budget. */
export function setBudget(state, amount) {
  const settings = { ...(state.settings ?? {}) };
  if (amount > 0) settings.budget = Math.round(amount);
  else delete settings.budget;
  return { ...state, settings };
}

/** { budget, spent, left, ratio, daysLeft (incl. today), perDay } for this month, or null without a budget. */
export function budgetStatus(state, today) {
  const budget = state.settings?.budget;
  if (!(budget > 0)) return null;
  const month = today.slice(0, 7);
  const spent = Math.round(state.money.filter((e) => dayKey(new Date(e.at)).startsWith(month)).reduce((n, e) => n + e.amount, 0) * 100) / 100;
  const [y, m] = month.split('-').map(Number);
  const lastDay = dayKey(new Date(y, m, 0));
  const daysLeft = diffDays(today, lastDay) + 1;
  const left = Math.round((budget - spent) * 100) / 100;
  return { budget, spent, left, ratio: spent / budget, daysLeft, perDay: left > 0 ? Math.floor(left / daysLeft) : 0 };
}

export function deleteMoney(state, id) {
  return { ...state, money: state.money.filter((e) => e.id !== id) };
}

/** Today, the last 7 days (oldest first), this month, and by category for the last 30 days. */
export function moneySummary(state, today) {
  const dayOf = (e) => dayKey(new Date(e.at));
  const sum = (list) => Math.round(list.reduce((n, e) => n + e.amount, 0) * 100) / 100;
  const week = [];
  for (let i = 6; i >= 0; i--) {
    const day = addDays(today, -i);
    week.push({ day, total: sum(state.money.filter((e) => dayOf(e) === day)) });
  }
  const month = today.slice(0, 7);
  const since = addDays(today, -29);
  const byCat = {};
  for (const e of state.money) if (dayOf(e) >= since && dayOf(e) <= today) byCat[e.cat] = (byCat[e.cat] ?? 0) + e.amount;
  const days = {};
  for (const e of [...state.money].sort((a, b) => b.at - a.at)) (days[dayOf(e)] ??= []).push(e);
  return {
    today: sum(state.money.filter((e) => dayOf(e) === today)),
    week,
    weekTotal: sum(week.flatMap((w) => state.money.filter((e) => dayOf(e) === w.day))),
    month: sum(state.money.filter((e) => dayOf(e).startsWith(month))),
    byCat: Object.entries(byCat).map(([cat, total]) => ({ cat, total: Math.round(total * 100) / 100 })).sort((a, b) => b.total - a.total),
    days: Object.entries(days).map(([day, items]) => ({ day, items, total: sum(items) })),
  };
}

// ---------------------------------------------------------------------------
// Restore from a backup file: adds back what is missing, never removes what is here
// (with sync on, removing would remove it from every device).

export function restoreFrom(state, backup) {
  let added = 0;
  const out = { ...state };
  for (const list of ['tasks', 'memos', 'shop', 'money']) {
    const have = new Set(state[list].map((i) => i.id));
    const missing = backup[list].filter((i) => !have.has(i.id));
    added += missing.length;
    if (missing.length) out[list] = [...state[list], ...missing];
  }
  const notes = { ...state.notes };
  for (const [day, text] of Object.entries(backup.notes)) {
    if (notes[day]) continue;
    notes[day] = text;
    added++;
  }
  out.notes = notes;
  if (!state.settings?.budget && backup.settings?.budget) out.settings = { ...state.settings, budget: backup.settings.budget };
  return added || out.settings !== state.settings ? { state: out, added } : { state, added: 0 };
}

// ---------------------------------------------------------------------------
// Search everything

export function search(state, query) {
  const q = String(query ?? '').trim().toLowerCase();
  if (!q) return { tasks: [], memos: [], notes: [], shop: [], money: [] };
  const has = (t) => String(t ?? '').toLowerCase().includes(q);
  return {
    tasks: state.tasks.filter((t) => has(t.text)).slice(0, 50),
    memos: sortedMemos(state).filter((m) => has(m.text)).slice(0, 50),
    notes: Object.entries(state.notes)
      .filter(([, text]) => has(text))
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([day, text]) => ({ day, line: text.split('\n').find((l) => has(l)) ?? '' }))
      .slice(0, 30),
    shop: state.shop.filter((i) => has(i.text)),
    money: state.money.filter((e) => has(e.text) || has(e.cat)).slice(-50).reverse(),
  };
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
