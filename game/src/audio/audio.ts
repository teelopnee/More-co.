// Every sound is synthesised with Web Audio: hits, whooshes, thunder, and a driving soundtrack
// whose lead line is a ranat-style xylophone over a minor pentatonic scale.
import type { CharId } from '../data/characters';
import type { Strength } from '../sim/moves';

type Ctx = AudioContext;

export class Sound {
  private ctx: Ctx | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private music!: GainNode;
  private reverb!: ConvolverNode;
  private reverbSend!: GainNode;
  private noise!: AudioBuffer;
  private drive!: WaveShaperNode;
  private rain: AudioBufferSourceNode | null = null;
  private beamNodes: { src: AudioBufferSourceNode; osc: OscillatorNode; gain: GainNode } | null = null;
  private seqTimer = 0;
  private nextNote = 0;
  private step = 0;
  private musicMode: 'off' | 'menu' | 'fight' = 'off';
  private delay!: DelayNode;
  musicVolume = 0.55;
  sfxVolume = 0.9;

  get ready() {
    return !!this.ctx && this.ctx.state === 'running';
  }

  /** Must be called from a user gesture. */
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      try { this.ctx = new AC({ latencyHint: 'interactive' }); } catch { return; }
      this.build();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  private build() {
    const ctx = this.ctx!;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    comp.attack.value = 0.003;
    comp.release.value = 0.2;
    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(comp).connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.sfx.gain.value = this.sfxVolume;
    this.sfx.connect(this.master);
    this.music = ctx.createGain();
    this.music.gain.value = this.musicVolume * 0.5;
    this.music.connect(this.master);

    // Noise source buffer.
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // Hall reverb from a synthetic impulse response.
    this.reverb = ctx.createConvolver();
    const irLen = Math.floor(ctx.sampleRate * 2.6);
    const ir = ctx.createBuffer(2, irLen, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const ch = ir.getChannelData(c);
      for (let i = 0; i < irLen; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / irLen, 3.2);
    }
    this.reverb.buffer = ir;
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0.35;
    this.reverbSend.connect(this.reverb).connect(this.master);

    this.drive = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = (i / 1023) * 2 - 1; curve[i] = Math.tanh(x * 3.2); }
    this.drive.curve = curve;
    this.drive.connect(this.sfx);

    this.delay = ctx.createDelay(1);
    this.delay.delayTime.value = 60 / 132 * 0.75;
    const fb = ctx.createGain();
    fb.gain.value = 0.32;
    const dl = ctx.createGain();
    dl.gain.value = 0.3;
    this.delay.connect(fb).connect(this.delay);
    this.delay.connect(dl).connect(this.music);
  }

  setVolumes(music: number, sfx: number) {
    this.musicVolume = music;
    this.sfxVolume = sfx;
    if (!this.ctx) return;
    this.music.gain.setTargetAtTime(music * 0.5, this.ctx.currentTime, 0.05);
    this.sfx.gain.setTargetAtTime(sfx, this.ctx.currentTime, 0.05);
  }

  // ───────────────────────────── primitives ─────────────────────────────

  private now() {
    return this.ctx!.currentTime;
  }

  private noiseBurst(opts: { t?: number; dur: number; type: BiquadFilterType; f0: number; f1?: number; q?: number; gain: number; out?: AudioNode; send?: number; attack?: number }) {
    const ctx = this.ctx!;
    const t = opts.t ?? this.now();
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const filt = ctx.createBiquadFilter();
    filt.type = opts.type;
    filt.Q.value = opts.q ?? 1;
    filt.frequency.setValueAtTime(opts.f0, t);
    if (opts.f1) filt.frequency.exponentialRampToValueAtTime(opts.f1, t + opts.dur);
    const g = ctx.createGain();
    const a = opts.attack ?? 0.002;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(opts.gain, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + opts.dur);
    src.connect(filt).connect(g).connect(opts.out ?? this.sfx);
    if (opts.send) { const s = ctx.createGain(); s.gain.value = opts.send; g.connect(s).connect(this.reverbSend); }
    src.start(t, Math.random() * 1.5);
    src.stop(t + opts.dur + 0.05);
  }

  private tone(opts: { t?: number; dur: number; type: OscillatorType; f0: number; f1?: number; gain: number; out?: AudioNode; send?: number; attack?: number; detune?: number }) {
    const ctx = this.ctx!;
    const t = opts.t ?? this.now();
    const o = ctx.createOscillator();
    o.type = opts.type;
    o.frequency.setValueAtTime(opts.f0, t);
    if (opts.f1) o.frequency.exponentialRampToValueAtTime(Math.max(20, opts.f1), t + opts.dur);
    if (opts.detune) o.detune.value = opts.detune;
    const g = ctx.createGain();
    const a = opts.attack ?? 0.003;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(opts.gain, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + opts.dur);
    o.connect(g).connect(opts.out ?? this.sfx);
    if (opts.send) { const s = ctx.createGain(); s.gain.value = opts.send; g.connect(s).connect(this.reverbSend); }
    o.start(t);
    o.stop(t + opts.dur + 0.05);
  }

  // ───────────────────────────── game sounds ─────────────────────────────

  hit(strength: Strength, blocked: boolean, char: CharId) {
    if (!this.ready) return;
    const k = strength === 'heavy' ? 1 : strength === 'medium' ? 0.7 : strength === 'super' ? 0.6 : 0.45;
    if (blocked) {
      this.noiseBurst({ dur: 0.09, type: 'highpass', f0: 2500, gain: 0.5 * k + 0.2 });
      this.tone({ dur: 0.18, type: 'square', f0: 1250, f1: 900, gain: 0.07 });
      this.tone({ dur: 0.14, type: 'square', f0: 1680, f1: 1300, gain: 0.05, send: 0.3 });
      return;
    }
    this.noiseBurst({ dur: 0.08 + k * 0.12, type: 'bandpass', f0: 2600, f1: 500, q: 0.7, gain: 0.7 + k * 0.4, out: this.drive, send: 0.25 * k });
    this.tone({ dur: 0.12 + k * 0.15, type: 'sine', f0: 170 + k * 40, f1: 38, gain: 0.7 + k * 0.5, out: this.drive });
    if (k >= 0.7) this.noiseBurst({ dur: 0.5, type: 'lowpass', f0: 900, f1: 120, gain: 0.35 * k, send: 0.6 });
    if (char === 'vayu') this.zap(0.15 * k + 0.05);
    if (char === 'phloeng') this.noiseBurst({ dur: 0.3, type: 'lowpass', f0: 1800, f1: 300, gain: 0.25 * k + 0.1 });
    if (char === 'chantra') this.tone({ dur: 0.4, type: 'sine', f0: 1760, f1: 1500, gain: 0.06 + k * 0.05, send: 0.8 });
  }

  zap(gain = 0.2) {
    if (!this.ready) return;
    const t = this.now();
    for (let i = 0; i < 4; i++) {
      this.noiseBurst({ t: t + i * 0.025 + Math.random() * 0.02, dur: 0.05, type: 'highpass', f0: 3000 + Math.random() * 3000, gain });
    }
    this.tone({ t, dur: 0.12, type: 'sawtooth', f0: 2400, f1: 300, gain: gain * 0.3 });
  }

  whoosh(strength: Strength) {
    if (!this.ready) return;
    const k = strength === 'heavy' ? 1 : strength === 'medium' ? 0.7 : 0.5;
    this.noiseBurst({ dur: 0.12 + k * 0.1, type: 'bandpass', f0: 400, f1: 2200 + k * 1500, q: 2.5, gain: 0.22 + k * 0.18, attack: 0.03 });
  }

  special(char: CharId) {
    if (!this.ready) return;
    if (char === 'vayu') { this.tone({ dur: 0.4, type: 'sawtooth', f0: 90, f1: 1400, gain: 0.12, send: 0.4 }); this.zap(0.25); }
    else if (char === 'phloeng') { this.noiseBurst({ dur: 0.6, type: 'lowpass', f0: 300, f1: 2400, gain: 0.5, attack: 0.08, send: 0.4 }); this.tone({ dur: 0.5, type: 'sine', f0: 60, f1: 120, gain: 0.5 }); }
    else { for (const f of [1320, 1760, 2640]) this.tone({ dur: 0.7, type: 'sine', f0: f, f1: f * 1.02, gain: 0.07, send: 0.9, attack: 0.02 }); this.whoosh('medium'); }
  }

  explosion(size = 1) {
    if (!this.ready) return;
    this.noiseBurst({ dur: 0.5 + size * 0.5, type: 'lowpass', f0: 2200, f1: 90, gain: 0.7 * size, out: this.drive, send: 0.7 });
    this.tone({ dur: 0.6 + size * 0.3, type: 'sine', f0: 110, f1: 30, gain: 0.9 * size });
  }

  jump() {
    if (!this.ready) return;
    this.noiseBurst({ dur: 0.12, type: 'bandpass', f0: 700, f1: 1600, q: 1.5, gain: 0.12, attack: 0.02 });
  }

  land(hard: boolean) {
    if (!this.ready) return;
    this.tone({ dur: hard ? 0.3 : 0.12, type: 'sine', f0: hard ? 120 : 160, f1: 40, gain: hard ? 0.8 : 0.25 });
    this.noiseBurst({ dur: hard ? 0.4 : 0.15, type: 'lowpass', f0: 900, f1: 200, gain: hard ? 0.4 : 0.12, send: hard ? 0.3 : 0 });
    if (hard) this.noiseBurst({ dur: 0.3, type: 'highpass', f0: 3000, gain: 0.12 });
  }

  dash() {
    if (!this.ready) return;
    this.noiseBurst({ dur: 0.22, type: 'bandpass', f0: 2500, f1: 500, q: 1.2, gain: 0.25, attack: 0.01 });
  }

  superStart(char: CharId) {
    if (!this.ready) return;
    const t = this.now();
    this.tone({ t, dur: 0.12, type: 'square', f0: 220, gain: 0.0001 });
    this.noiseBurst({ t, dur: 0.9, type: 'bandpass', f0: 200, f1: 5000, q: 3, gain: 0.35, attack: 0.6, send: 0.5 });
    for (const f of [110, 164.8, 220]) this.tone({ t, dur: 1.0, type: 'sawtooth', f0: f, f1: f * 2, gain: 0.07, attack: 0.5, send: 0.5 });
    this.tone({ t: t + 0.02, dur: 0.6, type: 'sine', f0: 880, f1: 1760, gain: 0.08, send: 1 });
    this.explosion(0.5);
    if (char === 'vayu') this.zap(0.3);
  }

  beam(on: boolean) {
    if (!this.ready) return;
    const ctx = this.ctx!;
    if (on && !this.beamNodes) {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 900;
      f.Q.value = 0.6;
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = 55;
      const og = ctx.createGain();
      og.gain.value = 0.25;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, this.now());
      gain.gain.linearRampToValueAtTime(0.7, this.now() + 0.08);
      src.connect(f).connect(gain);
      osc.connect(og).connect(gain);
      gain.connect(this.drive);
      const send = ctx.createGain();
      send.gain.value = 0.4;
      gain.connect(send).connect(this.reverbSend);
      src.start();
      osc.start();
      this.beamNodes = { src, osc, gain };
      this.explosion(1.1);
    } else if (!on && this.beamNodes) {
      const { src, osc, gain } = this.beamNodes;
      const t = this.now();
      gain.gain.cancelScheduledValues(t);
      gain.gain.setValueAtTime(gain.gain.value, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
      src.stop(t + 0.45);
      osc.stop(t + 0.45);
      this.beamNodes = null;
    }
  }

  thunder(distance: number) {
    if (!this.ready) return;
    const t = this.now() + Math.min(2.5, distance / 340);
    const g = Math.max(0.15, 0.8 - distance / 250);
    this.noiseBurst({ t, dur: 0.25, type: 'highpass', f0: 1500, gain: g * 0.4 });
    this.noiseBurst({ t, dur: 3.5, type: 'lowpass', f0: 500, f1: 60, gain: g, attack: 0.05, send: 0.8 });
    this.noiseBurst({ t: t + 0.4, dur: 2.5, type: 'lowpass', f0: 300, f1: 50, gain: g * 0.6, attack: 0.3 });
  }

  ko() {
    if (!this.ready) return;
    this.explosion(1.4);
    const t = this.now();
    this.tone({ t, dur: 2.2, type: 'sawtooth', f0: 220, f1: 40, gain: 0.15, send: 1 });
    this.noiseBurst({ t, dur: 2.5, type: 'lowpass', f0: 4000, f1: 100, gain: 0.3, send: 1 });
  }

  stinger(kind: 'round' | 'fight' | 'win') {
    if (!this.ready) return;
    const t = this.now();
    const chord = kind === 'round' ? [146.8, 220, 293.7] : kind === 'fight' ? [146.8, 220, 293.7, 440] : [146.8, 185, 220, 293.7, 370];
    for (const f of chord) {
      this.tone({ t, dur: kind === 'round' ? 0.7 : 1.3, type: 'sawtooth', f0: f, gain: 0.06, attack: 0.01, send: 0.6, detune: (Math.random() - 0.5) * 14 });
    }
    if (kind !== 'round') { this.explosion(0.7); this.noiseBurst({ t, dur: 1.2, type: 'highpass', f0: 6000, gain: 0.2, send: 0.8 }); }
    else this.tone({ t, dur: 0.4, type: 'sine', f0: 90, f1: 40, gain: 0.6 });
  }

  ui(kind: 'move' | 'ok' | 'back') {
    if (!this.ready) return;
    if (kind === 'move') this.tone({ dur: 0.06, type: 'triangle', f0: 1320, gain: 0.12 });
    else if (kind === 'ok') { this.tone({ dur: 0.12, type: 'triangle', f0: 880, gain: 0.14 }); this.tone({ t: this.now() + 0.06, dur: 0.18, type: 'triangle', f0: 1320, gain: 0.14, send: 0.4 }); }
    else this.tone({ dur: 0.12, type: 'triangle', f0: 660, f1: 440, gain: 0.12 });
  }

  // ───────────────────────────── ambience & music ─────────────────────────────

  startRain() {
    if (!this.ready || this.rain) return;
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1200;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 7000;
    const g = ctx.createGain();
    g.gain.value = 0.06;
    src.connect(hp).connect(lp).connect(g).connect(this.sfx);
    src.start();
    this.rain = src;
  }

  setMusic(mode: 'off' | 'menu' | 'fight') {
    if (mode === this.musicMode) return;
    this.musicMode = mode;
    if (!this.ready) return;
    if (mode !== 'off' && !this.seqTimer) {
      this.nextNote = this.now() + 0.1;
      this.step = 0;
      this.seqTimer = window.setInterval(() => this.schedule(), 25);
    }
    if (mode === 'off' && this.seqTimer) { clearInterval(this.seqTimer); this.seqTimer = 0; }
  }

  /** Re-applies the requested music mode once audio is unlocked. */
  resumeMusic() {
    const m = this.musicMode;
    this.musicMode = 'off';
    this.setMusic(m);
  }

  private schedule() {
    if (!this.ctx) return;
    const spb = 60 / 132 / 4;
    // After the tab was hidden, skip the missed notes instead of firing them all at once.
    if (this.nextNote < this.now() - 0.2) this.nextNote = this.now() + 0.05;
    while (this.nextNote < this.now() + 0.12) {
      this.playStep(this.step, this.nextNote);
      this.nextNote += spb;
      this.step = (this.step + 1) % 256;
    }
  }

  private playStep(s: number, t: number) {
    const fight = this.musicMode === 'fight';
    const bar = Math.floor(s / 16) % 4;
    const i = s % 16;
    const out = this.music;
    // D minor pentatonic-ish: D F G A C.
    const roots = [73.42, 58.27, 65.41, 55.0];
    const root = roots[bar];
    if (fight) {
      if (i % 4 === 0 || i === 14) this.tone({ t, dur: 0.28, type: 'sine', f0: 140, f1: 42, gain: 0.9, out });
      if (i === 4 || i === 12) {
        this.noiseBurst({ t, dur: 0.16, type: 'bandpass', f0: 1900, q: 0.8, gain: 0.45, out, send: 0.15 });
        this.tone({ t, dur: 0.08, type: 'triangle', f0: 220, f1: 160, gain: 0.25, out });
      }
      this.noiseBurst({ t, dur: i % 2 ? 0.03 : 0.05, type: 'highpass', f0: 8000, gain: i % 4 === 2 ? 0.18 : 0.08, out });
      if (i % 2 === 0 || i === 7 || i === 15) {
        const oct = i % 4 === 2 ? 2 : 1;
        this.bass(t, root * oct, 0.16);
      }
    } else if (i % 8 === 0) {
      this.tone({ t, dur: 0.4, type: 'sine', f0: 110, f1: 40, gain: 0.35, out });
    }
    // Ranat-style lead.
    const scale = [293.66, 349.23, 392.0, 440.0, 523.25, 587.33, 698.46, 783.99];
    const pattern = [0, 2, 4, 5, 4, 2, 3, 1, 0, 3, 5, 7, 6, 4, 3, 2];
    const shift = [0, -1, 1, -2][bar];
    if (fight ? true : i % 2 === 0) {
      const n = scale[Math.max(0, Math.min(scale.length - 1, pattern[(i + bar * 3) % 16] + shift + 1))];
      const g = fight ? (i % 4 === 0 ? 0.11 : 0.07) : 0.06;
      this.mallet(t, n, g);
      if (s % 64 >= 32 && i % 4 === 0) this.mallet(t, n * 2, g * 0.5);
    }
    // Pad on bar starts.
    if (i === 0) {
      for (const m of [1, 1.5, 2, 2.4]) {
        this.tone({ t, dur: 60 / 132 * 4, type: 'sawtooth', f0: root * 2 * m, gain: fight ? 0.018 : 0.03, out, attack: 0.4, detune: (Math.random() - 0.5) * 18 });
      }
    }
  }

  private bass(t: number, f: number, dur: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = f;
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.Q.value = 6;
    filt.frequency.setValueAtTime(1600, t);
    filt.frequency.exponentialRampToValueAtTime(140, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.32, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.05);
    o.connect(filt).connect(g).connect(this.music);
    o.start(t);
    o.stop(t + dur + 0.1);
  }

  private mallet(t: number, f: number, gain: number) {
    const ctx = this.ctx!;
    for (const [mult, gm, dur] of [[1, 1, 0.35], [3.98, 0.25, 0.08], [2.01, 0.2, 0.15]] as const) {
      const o = ctx.createOscillator();
      o.type = mult === 1 ? 'triangle' : 'sine';
      o.frequency.value = f * mult;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(gain * gm, t + 0.002);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g);
      g.connect(this.music);
      g.connect(this.delay);
      o.start(t);
      o.stop(t + dur + 0.05);
    }
  }
}

export const sound = new Sound();
