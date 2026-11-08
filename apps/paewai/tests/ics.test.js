import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fold, icsFileName, taskToICS } from '../src/lib/ics.js';

const NOW = Date.UTC(2026, 10, 8, 3, 0, 0);

test('timed task: local start, 15 minutes, alarm at start', () => {
  const ics = taskToICS({ id: 'abc', text: 'โทรหาแม่, ด่วน; จริง', day: '2026-11-09', time: '17:00' }, NOW);
  assert.ok(ics.endsWith('\r\n'));
  const lines = ics.split('\r\n');
  assert.ok(lines.includes('DTSTART:20261109T170000'));
  assert.ok(lines.includes('DURATION:PT15M'));
  assert.ok(lines.includes('DTSTAMP:20261108T030000Z'));
  assert.ok(lines.includes('UID:abc@paewai'));
  assert.ok(lines.includes('SUMMARY:โทรหาแม่\\, ด่วน\\; จริง'));
  assert.ok(lines.includes('TRIGGER:-PT0M'));
  assert.equal(lines.filter((l) => l === 'BEGIN:VALARM').length, 1);
});

test('all-day task: next-day end, alarm at 09:00', () => {
  const ics = taskToICS({ id: 'x', text: 'จ่ายบัตร', day: '2026-12-31', time: null }, NOW);
  assert.match(ics, /DTSTART;VALUE=DATE:20261231\r\n/);
  assert.match(ics, /DTEND;VALUE=DATE:20270101\r\n/);
  assert.match(ics, /TRIGGER:PT9H\r\n/);
});

test('long Thai lines fold at 75 bytes without splitting a letter', () => {
  const line = `SUMMARY:${'ก'.repeat(60)}`;
  const folded = fold(line);
  const parts = folded.split('\r\n');
  assert.ok(parts.length > 1);
  const enc = new TextEncoder();
  parts.forEach((p, i) => assert.ok(enc.encode(p).length <= 75, `part ${i} too long`));
  assert.equal(parts.map((p, i) => (i ? p.slice(1) : p)).join(''), line);
  assert.equal(fold('SHORT:x'), 'SHORT:x');
});

test('file name', () => {
  assert.equal(icsFileName({ text: 'นัดหมอ / ฟัน', day: '2026-12-03', time: '09:30' }), 'paewai-20261203-0930.ics');
  assert.equal(icsFileName({ text: 'จ่ายบัตร', day: '2026-12-25', time: null }), 'paewai-20261225.ics');
});

test('no day: refuses', () => {
  assert.throws(() => taskToICS({ id: 'x', text: 'a', day: null }));
});
