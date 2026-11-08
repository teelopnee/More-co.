// One task → an .ics file. Opening it on a Samsung tablet adds the event to Samsung Calendar,
// which then rings at the right time even when แปะไว้ is closed.

import { addDays } from './dates.js';

const escape = (s) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

const encoder = new TextEncoder();

/** Lines longer than 75 bytes are folded (RFC 5545); Thai letters are 3 bytes each and never split. */
export function fold(line) {
  if (encoder.encode(line).length <= 75) return line;
  const parts = [];
  let current = '';
  let bytes = 0;
  let limit = 75;
  for (const ch of line) {
    const size = encoder.encode(ch).length;
    if (bytes + size > limit) {
      parts.push(current);
      current = '';
      bytes = 0;
      limit = 74; // continuation lines start with a space
    }
    current += ch;
    bytes += size;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

const utcStamp = (ms) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

export function taskToICS(task, now = Date.now()) {
  if (!task.day) throw new Error('task has no day');
  const date = task.day.replace(/-/g, '');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//More-co.//paewai//TH',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${task.id}@paewai`,
    `DTSTAMP:${utcStamp(now)}`,
  ];
  if (task.time) {
    // Floating local time: the calendar uses the tablet's own time zone.
    lines.push(`DTSTART:${date}T${task.time.replace(':', '')}00`, 'DURATION:PT15M');
  } else {
    lines.push(`DTSTART;VALUE=DATE:${date}`, `DTEND;VALUE=DATE:${addDays(task.day, 1).replace(/-/g, '')}`);
  }
  lines.push(
    `SUMMARY:${escape(task.text)}`,
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `DESCRIPTION:${escape(task.text)}`,
    // Timed: at the start. All-day: 09:00 that morning.
    `TRIGGER:${task.time ? '-PT0M' : 'PT9H'}`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  );
  return lines.map(fold).join('\r\n') + '\r\n';
}

/** ASCII only: Chrome falls back to "download" for some Thai file names. */
export function icsFileName(task) {
  return `paewai-${task.day.replace(/-/g, '')}${task.time ? `-${task.time.replace(':', '')}` : ''}.ics`;
}
