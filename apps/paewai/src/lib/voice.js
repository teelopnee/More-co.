// Voice notes: record (MediaRecorder), keep the audio safe on this device (IndexedDB, saved every
// few seconds so a crash or a closed tab loses at most a moment), and transcribe it with the
// person's own key (OpenAI gpt-transcribe or Google Gemini). Claude cannot take audio, so it
// works on the transcript (lib/claude.js).

export const VOICE_KEY = 'paewai:voice'; // { provider, openaiKey, geminiKey } on this device only
export const PART_MS = 25 * 60_000; // a new file every 25 minutes: each part stays well under upload limits
const CHUNK_MS = 4000;
const MAX_UPLOAD = 24 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Audio on this device (IndexedDB): finished parts, plus chunks of the part being recorded

const DB_NAME = 'paewai-audio';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore('parts'); // key "recId/part" → Blob
      db.createObjectStore('live'); // key "recId/part/seq" → Blob (while recording)
      db.createObjectStore('meta'); // key recId → { id, at, mime } (while recording)
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

let dbPromise = null;
const db = () => (dbPromise ??= openDb().catch((err) => {
  dbPromise = null;
  throw err;
}));

async function tx(store, mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(store, mode);
    const s = t.objectStore(store);
    let out;
    Promise.resolve(fn(s)).then((v) => (out = v));
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

const req = (r) => new Promise((resolve, reject) => {
  r.onsuccess = () => resolve(r.result);
  r.onerror = () => reject(r.error);
});

const pad = (n) => String(n).padStart(6, '0');

export const audio = {
  async putChunk(id, part, seq, blob) {
    await tx('live', 'readwrite', (s) => s.put(blob, `${id}/${part}/${pad(seq)}`));
  },
  async putMeta(meta) {
    await tx('meta', 'readwrite', (s) => s.put(meta, meta.id));
  },
  async dropMeta(id) {
    await tx('meta', 'readwrite', (s) => s.delete(id));
  },
  /** Joins the saved chunks of a part into one file and frees the chunks. */
  async sealPart(id, part, mime) {
    const range = IDBKeyRange.bound(`${id}/${part}/`, `${id}/${part}/￿`);
    const chunks = await tx('live', 'readonly', (s) => req(s.getAll(range)));
    if (!chunks?.length) return null;
    const blob = new Blob(chunks, { type: mime || chunks[0].type || 'audio/webm' });
    await tx('parts', 'readwrite', (s) => s.put(blob, `${id}/${part}`));
    await tx('live', 'readwrite', (s) => s.delete(range));
    return blob;
  },
  async parts(id) {
    const range = IDBKeyRange.bound(`${id}/`, `${id}/￿`);
    const d = await db();
    return new Promise((resolve, reject) => {
      const out = [];
      const cur = d.transaction('parts').objectStore('parts').openCursor(range);
      cur.onsuccess = () => {
        const c = cur.result;
        if (!c) return resolve(out.sort((a, b) => a.part - b.part).map((x) => x.blob));
        out.push({ part: Number(String(c.key).split('/')[1]), blob: c.value });
        c.continue();
      };
      cur.onerror = () => reject(cur.error);
    });
  },
  async has(id) {
    return (await this.parts(id)).length > 0;
  },
  async remove(id) {
    for (const store of ['parts', 'live']) await tx(store, 'readwrite', (s) => s.delete(IDBKeyRange.bound(`${id}/`, `${id}/￿`)));
    await this.dropMeta(id);
  },
  /** Recordings that were cut off (tab closed, crash): seals what was saved. → [{ id, at, mime, parts }] */
  async recover() {
    const metas = await tx('meta', 'readonly', (s) => req(s.getAll()));
    const out = [];
    for (const m of metas ?? []) {
      const keys = await tx('live', 'readonly', (s) => req(s.getAllKeys(IDBKeyRange.bound(`${m.id}/`, `${m.id}/￿`))));
      const partsLive = [...new Set((keys ?? []).map((k) => Number(String(k).split('/')[1])))];
      for (const p of partsLive) await this.sealPart(m.id, p, m.mime);
      const parts = (await this.parts(m.id)).length;
      await this.dropMeta(m.id);
      if (parts) out.push({ ...m, parts });
    }
    return out;
  },
  async usage() {
    try {
      return (await navigator.storage?.estimate?.()) ?? null;
    } catch {
      return null;
    }
  },
};

// ---------------------------------------------------------------------------
// Recording

/** The best format this browser records: Opus in WebM (Chrome, Android) or AAC in MP4 (Safari, iPhone). */
export function pickFormat(isSupported = (t) => globalThis.MediaRecorder?.isTypeSupported?.(t)) {
  for (const [mime, bits] of [
    ['audio/webm;codecs=opus', 32_000],
    ['audio/mp4;codecs=mp4a.40.2', 64_000],
    ['audio/mp4', 64_000],
    ['audio/webm', 32_000],
    ['audio/ogg;codecs=opus', 32_000],
  ]) {
    if (isSupported(mime)) return { mime, bits };
  }
  return { mime: '', bits: 64_000 };
}

export const extFor = (mime) => (/mp4|aac|m4a/.test(mime) ? 'm4a' : /ogg/.test(mime) ? 'ogg' : /wav/.test(mime) ? 'wav' : 'webm');

/**
 * One recording. Events: onlevel(0..1), onstate(state), onerror(message), onpart(n).
 * state: 'idle' | 'recording' | 'paused' | 'stopped'
 */
export class Recorder {
  constructor({ id, onlevel = () => {}, onstate = () => {}, onerror = () => {} }) {
    Object.assign(this, { id, onlevel, onstate, onerror });
    this.state = 'idle';
    this.part = 0;
    this.seq = 0;
    this.elapsed = 0; // ms recorded before the current run
    this.runStart = 0;
    this.saving = Promise.resolve();
    this.format = pickFormat();
  }

  get durationMs() {
    return this.elapsed + (this.state === 'recording' ? Date.now() - this.runStart : 0);
  }

  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    });
    this.at = Date.now();
    await audio.putMeta({ id: this.id, at: this.at, mime: this.format.mime });
    // If the microphone goes away (another app took it, permission revoked): keep what we have.
    for (const track of this.stream.getAudioTracks()) track.addEventListener('ended', () => this.state !== 'stopped' && this.stop('ไมโครโฟนถูกปิดหรือแอปอื่นใช้อยู่ บันทึกส่วนที่อัดได้ไว้แล้ว'));
    this.meter();
    this.wake();
    this.begin();
    this.timer = setInterval(() => {
      if (this.state === 'recording' && Date.now() - this.partStart >= PART_MS) this.rotate();
    }, 1000);
  }

  begin() {
    const opts = this.format.mime ? { mimeType: this.format.mime, audioBitsPerSecond: this.format.bits } : { audioBitsPerSecond: this.format.bits };
    const mr = new MediaRecorder(this.stream, opts);
    const part = this.part;
    let seq = 0;
    mr.ondataavailable = (e) => {
      if (!e.data?.size) return;
      const n = seq++;
      this.saving = this.saving.then(() => audio.putChunk(this.id, part, n, e.data)).catch(() => this.onerror('บันทึกเสียงลงเครื่องไม่ได้ (ที่เก็บเต็ม?)'));
    };
    mr.onerror = () => this.onerror('เครื่องอัดเสียงมีปัญหา บันทึกส่วนที่อัดได้ไว้แล้ว');
    mr.start(CHUNK_MS);
    this.mr = mr;
    this.partStart = Date.now();
    this.runStart = Date.now();
    this.setState('recording');
  }

  /** Ends the current file and starts the next one on the same microphone. */
  async rotate() {
    const old = this.mr;
    const part = this.part;
    this.elapsed += Date.now() - this.runStart;
    this.part++;
    this.begin();
    await new Promise((r) => {
      old.onstop = r;
      old.stop();
    });
    await this.saving;
    await audio.sealPart(this.id, part, this.format.mime);
  }

  pause() {
    if (this.state !== 'recording') return;
    this.mr.pause();
    this.elapsed += Date.now() - this.runStart;
    this.setState('paused');
  }

  resume() {
    if (this.state !== 'paused') return;
    this.mr.resume();
    this.runStart = Date.now();
    this.setState('recording');
  }

  /** Stops and seals the last file. Resolves to { id, at, durationMs, mime, parts }. */
  async stop(reason = '') {
    if (this.stopping) return this.stopping;
    this.stopping = (async () => {
      const duration = this.durationMs;
      clearInterval(this.timer);
      if (this.mr && this.mr.state !== 'inactive') {
        await new Promise((r) => {
          this.mr.onstop = r;
          try {
            this.mr.stop();
          } catch {
            r();
          }
        });
      }
      for (const t of this.stream?.getTracks() ?? []) t.stop();
      cancelAnimationFrame(this.raf);
      this.ctx?.close().catch(() => {});
      this.lock?.release().catch(() => {});
      document.removeEventListener('visibilitychange', this.relock);
      this.elapsed = duration;
      this.setState('stopped');
      await this.saving;
      await audio.sealPart(this.id, this.part, this.format.mime);
      await audio.dropMeta(this.id);
      if (reason) this.onerror(reason);
      return { id: this.id, at: this.at, durationMs: duration, mime: this.format.mime, parts: this.part + 1 };
    })();
    return this.stopping;
  }

  setState(s) {
    this.state = s;
    this.onstate(s);
  }

  /** Microphone level for the waveform. */
  meter() {
    try {
      this.ctx = new AudioContext();
      const src = this.ctx.createMediaStreamSource(this.stream);
      const an = this.ctx.createAnalyser();
      an.fftSize = 1024;
      src.connect(an);
      const buf = new Float32Array(an.fftSize);
      const loop = () => {
        an.getFloatTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) sum += v * v;
        const rms = Math.sqrt(sum / buf.length);
        this.onlevel(this.state === 'recording' ? Math.min(1, rms * 4) : 0);
        this.raf = requestAnimationFrame(loop);
      };
      loop();
    } catch {
      // no meter: recording still works
    }
  }

  /** Keeps the screen on while recording (the browser may stop the microphone when it sleeps). */
  async wake() {
    this.relock = async () => {
      if (document.visibilityState === 'visible' && this.state !== 'stopped') {
        try {
          this.lock = await navigator.wakeLock?.request('screen');
        } catch {
          // not allowed: fine
        }
      }
    };
    document.addEventListener('visibilitychange', this.relock);
    await this.relock();
  }
}

// ---------------------------------------------------------------------------
// Transcription with the person's own key

export const PROVIDERS = {
  openai: { name: 'OpenAI', model: 'gpt-transcribe', keyHint: 'sk-…', keyUrl: 'https://platform.openai.com/api-keys' },
  gemini: { name: 'Google Gemini', model: 'gemini-3.8-flash', keyHint: 'AIza…', keyUrl: 'https://aistudio.google.com/apikey' },
};

const TRANSCRIBE_PROMPT =
  'ถอดเสียงพูดในไฟล์นี้เป็นข้อความตามที่พูดจริง ภาษาไทย (คำภาษาอังกฤษเขียนตามที่พูด) แบ่งย่อหน้าตามช่วงที่เปลี่ยนเรื่องหรือเปลี่ยนคนพูด ไม่ต้องสรุป ไม่ต้องใส่คำอธิบายอื่น';

export class TranscribeError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.status = status;
  }
}

function explainStatus(status, provider) {
  const name = PROVIDERS[provider]?.name ?? provider;
  if (status === 401 || status === 403) return `คีย์ ${name} ใช้ไม่ได้ ตรวจแล้วใส่ใหม่`;
  if (status === 413) return 'ไฟล์ใหญ่เกินไปสำหรับการถอดครั้งเดียว';
  if (status === 429) return `${name} ขอให้รอสักครู่ (ใช้ถี่หรือโควตาหมด)`;
  if (status >= 500) return `${name} มีปัญหาชั่วคราว ลองใหม่อีกครั้ง`;
  return `ถอดเสียงไม่สำเร็จ (${name} ${status})`;
}

async function call(url, init, provider, fetchImpl) {
  let res;
  try {
    res = await fetchImpl(url, init);
  } catch {
    throw new TranscribeError('ต่อบริการถอดเสียงไม่ได้ ตรวจอินเทอร์เน็ตแล้วลองใหม่');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new TranscribeError(data?.error?.message ? `${explainStatus(res.status, provider)}: ${data.error.message}` : explainStatus(res.status, provider), res.status);
  return data;
}

/** OpenAI speech-to-text (/v1/audio/transcriptions, gpt-transcribe). */
export async function transcribeOpenAI({ key, blob, name = 'audio.webm', keywords = [], fetchImpl = fetch }) {
  const form = new FormData();
  form.append('file', blob, name);
  form.append('model', PROVIDERS.openai.model);
  form.append('languages[]', 'th');
  for (const k of keywords.slice(0, 20)) form.append('keywords[]', k);
  const data = await call('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form }, 'openai', fetchImpl);
  return String(data?.text ?? '').trim();
}

async function toBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** Reads the text of a Gemini Interactions response (or a generateContent one, to be safe). */
export function geminiText(data) {
  if (typeof data?.output_text === 'string') return data.output_text;
  const steps = Array.isArray(data?.steps) ? data.steps : [];
  const fromSteps = steps
    .filter((s) => !s.type || s.type === 'model_output')
    .flatMap((s) => (Array.isArray(s.content) ? s.content : []))
    .filter((c) => c?.type === 'text' && typeof c.text === 'string')
    .map((c) => c.text)
    .join('');
  if (fromSteps) return fromSteps;
  const parts = data?.candidates?.[0]?.content?.parts ?? [];
  return parts.map((p) => p.text ?? '').join('');
}

/** Google Gemini (Interactions API, audio inline up to 20 MB per request). */
export async function transcribeGemini({ key, blob, mime, fetchImpl = fetch }) {
  const body = {
    model: PROVIDERS.gemini.model,
    input: [
      { type: 'text', text: TRANSCRIBE_PROMPT },
      { type: 'audio', data: await toBase64(blob), mime_type: (mime || blob.type || 'audio/webm').split(';')[0] },
    ],
  };
  const data = await call(
    'https://generativelanguage.googleapis.com/v1beta/interactions',
    { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key, 'Api-Revision': '2026-05-20' }, body: JSON.stringify(body) },
    'gemini',
    fetchImpl,
  );
  if (data?.status === 'failed') throw new TranscribeError('Gemini ถอดเสียงไม่สำเร็จ ลองใหม่อีกครั้ง');
  return geminiText(data).trim();
}

/** Transcribes every part in order. onprogress(done, total). */
export async function transcribeParts({ provider, key, parts, mime, onprogress = () => {}, fetchImpl = fetch }) {
  if (!key) throw new TranscribeError('ยังไม่ได้ใส่คีย์สำหรับถอดเสียง');
  const texts = [];
  for (let i = 0; i < parts.length; i++) {
    const blob = parts[i];
    if (blob.size > MAX_UPLOAD) throw new TranscribeError('ไฟล์เสียงส่วนนี้ใหญ่เกิน 24 MB ถอดทีละครั้งไม่ได้');
    onprogress(i, parts.length);
    const name = `paewai-${i + 1}.${extFor(mime || blob.type)}`;
    const text = provider === 'gemini' ? await transcribeGemini({ key, blob, mime, fetchImpl }) : await transcribeOpenAI({ key, blob, name, fetchImpl });
    if (text) texts.push(text);
  }
  onprogress(parts.length, parts.length);
  return texts.join('\n\n');
}

export const clock = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
};
