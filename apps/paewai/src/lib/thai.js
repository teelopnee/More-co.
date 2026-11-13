// Thai as speech recognizers write it. Thai puts no space between words: a space is a pause.
// Many recognizers (Google's and Samsung's on the device) return a space after every word,
// "วัน นี้ เรา จะ คุย เรื่อง การ เปิด ตัว …", which is hard to read and breaks everything that
// reads spaces as pauses (the summary, the mind map). Others return no space at all.
//
// tidy() makes it the way Thai is written: the words of each run joined again, with a space where
// the speaker really paused (each run the recognizer reported is one utterance), after an end
// particle ("ครับ", "ค่ะ"), around an "เอ่อ", and before a word that starts a sentence
// ("แต่", "เพราะฉะนั้น", "เรื่องต่อไป"). The recognizer's own word breaks are used for that: they
// are better than a word breaker's guess on the joined text. The times of the runs
// ([offset, ms]) are moved to match. Only for a recognizer's text: what a person typed is left alone.

import { SPEECH, breathe } from './summarize.js';

/** Ends in a Thai letter, vowel or tone mark (not ๆ, ฯ or a Thai digit). */
const TH_END = /[ก-ฮะ-ฺเ-ๅ็-๎]$/;
/** Starts with a Thai consonant or a vowel written in front. */
const TH_START = /^[ก-ฮเ-ไ]/;
const THAI = /[ก-๎]/;

/** Thai words are short: where the pieces between spaces average this or less, the spaces are word breaks. */
const WORD_LEN = 6.2;
const WINDOW = 6; // pieces looked at on each side
/** A stretch with no space longer than this is a wall of text: pauses are put back. */
const WALL = 120;
/** Utterances shorter than this many words are said in one breath. */
const BREATH = 12;

/** Is this text written with a space after every word? */
export function wordSpaced(text) {
  const thai = String(text ?? '').split(/\s+/).filter((t) => THAI.test(t));
  if (thai.length < 4) return false;
  return thai.reduce((n, t) => n + t.length, 0) / thai.length <= WORD_LEN;
}

/**
 * → { text, times, changed }. `times`: [[character offset, ms]], where each run of words the
 * recognizer reported starts; those places are real pauses and keep their space.
 * `walls: false` leaves text with no word spacing alone (for text that may have been written by
 * a person: there a long sentence with no space is how it should be).
 */
export function tidy(input, times = [], { walls = true } = {}) {
  const text = String(input ?? '');
  const marks = (Array.isArray(times) ? times : []).filter((t) => Array.isArray(t) && Number.isFinite(t[0]));
  if (!text.trim()) return { text, times: marks, changed: false };
  const pause = new Set(marks.map((t) => t[0]));

  const toks = [];
  for (const m of text.matchAll(/\S+/g)) toks.push({ s: m[0], w: m[0].toLowerCase(), at: m.index, end: m.index + m[0].length, thai: THAI.test(m[0]) });
  // An utterance runs from one real pause (or line break) to the next: decided on its own, so
  // text that grows (a longer recording, a part added later) keeps what was already tidied.
  const first = new Array(toks.length).fill(0);
  const last = new Array(toks.length).fill(0);
  let start = 0;
  for (let i = 0; i <= toks.length; i++) {
    const brk = i === toks.length || (i > 0 && (pause.has(toks[i].at) || text.slice(toks[i - 1].end, toks[i].at).includes('\n')));
    if (!brk) continue;
    for (let k = start; k < i; k++) {
      first[k] = start;
      last[k] = i - 1;
    }
    start = i;
  }
  /** Are the pieces around the gap after piece i single words? */
  const dense = (i) => {
    let n = 0;
    let len = 0;
    for (let k = Math.max(first[i], i - WINDOW + 1); k <= Math.min(last[i], i + WINDOW); k++) {
      if (!toks[k].thai) continue;
      n++;
      len += toks[k].s.length;
    }
    return n >= 2 && len / n <= WORD_LEN;
  };
  /** Does the speaker pause before word k? `run`: words since the last pause. */
  const pauseBefore = (k, run) => {
    const w = toks[k].w;
    const p = toks[k - 1].w;
    if (SPEECH.FILLERS.has(w) || SPEECH.FILLERS.has(p)) return true;
    if (SPEECH.PAUSE_AFTER.has(p) && !SPEECH.PARTICLES.has(w)) return true;
    // a phrase that opens a sentence, made of whole words ("เพราะ ฉะนั้น", "เรื่อง ต่อ ไป")
    let ahead = '';
    const ends = [];
    for (let j = k; j <= Math.min(last[k], k + 4); j++) {
      ahead += toks[j].w;
      ends.push(ahead.length);
    }
    const m = SPEECH.PAUSE_BEFORE.exec(ahead);
    if (m && ends.includes(m[0].length)) return true;
    if (run >= 20 && SPEECH.CLAUSE_WORDS.has(w)) return true;
    return run >= 32;
  };

  // 1) join the words of each utterance, keeping a space where the speaker pauses
  let out = '';
  const map = new Int32Array(text.length + 1); // old offset → new offset
  let cursor = 0;
  let touched = false;
  let run = 0;
  const copy = (to) => {
    for (; cursor < to; cursor++) {
      map[cursor] = out.length;
      out += text[cursor];
    }
  };
  for (let i = 0; i < toks.length; i++) {
    copy(toks[i].end);
    run++;
    const next = toks[i + 1];
    if (!next) break;
    const gap = text.slice(toks[i].end, next.at);
    const same = first[i + 1] === first[i] && !gap.includes('\n');
    const words = same && dense(i);
    const drop = words && TH_END.test(toks[i].s) && TH_START.test(next.s) && !(last[i] - first[i] + 1 > BREATH && pauseBefore(i + 1, run));
    if (drop) {
      for (; cursor < next.at; cursor++) map[cursor] = out.length;
      touched = true;
      continue;
    }
    // a pause only where words were being joined: next to a number or an English word the space says nothing
    if (!words || (TH_END.test(toks[i].s) && TH_START.test(next.s))) run = 0;
    if (gap.length > 1 && !gap.includes('\n')) {
      // several spaces in a row are one
      map[cursor] = out.length;
      out += ' ';
      for (cursor++; cursor < next.at; cursor++) map[cursor] = out.length;
      touched = true;
    }
  }
  copy(text.length);
  map[text.length] = out.length;
  let outTimes = marks.map(([at, ms]) => [map[Math.max(0, Math.min(at, text.length))], ms]);

  // 2) a recognizer that returned no spaces at all: pauses found by breaking the wall into words
  if (!touched && walls) {
    const src = out;
    let aired = '';
    const shift = []; // [offset in `src`, spaces added before it]
    let added = 0;
    for (const m of src.matchAll(/\S+|\s+/g)) {
      const chunk = m[0];
      const better = /\s/.test(chunk[0]) || chunk.length < WALL ? chunk : breathe(chunk);
      if (better !== chunk) {
        // `better` is `chunk` with single spaces put in: note where
        let k = 0;
        for (let j = 0; j < better.length; j++) {
          if (better[j] === ' ' && chunk[k] !== ' ') shift.push([m.index + k, ++added]);
          else k++;
        }
      }
      aired += better;
    }
    if (shift.length) {
      let s = 0;
      let extra = 0;
      outTimes = outTimes.map(([at, ms]) => {
        while (s < shift.length && shift[s][0] <= at) extra = shift[s++][1];
        return [at + extra, ms];
      });
      out = aired;
      touched = true;
    }
  }
  return { text: out, times: outTimes, changed: touched && out !== text };
}
