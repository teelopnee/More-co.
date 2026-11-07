// ศึกอัสนี — app shell: game loop, modes (attract/select/fight), event → effects/audio/HUD wiring.
import './styles.css';
import { Vector3 } from 'three';
import { sound } from './audio/audio';
import { CHARACTERS, ROSTER, type CharId } from './data/characters';
import { Director } from './director';
import { Effects } from './fx/effects';
import { FighterView } from './fighter/view';
import { Input, TouchControls, type MenuAction } from './input/input';
import { Engine } from './render/engine';
import { AutoTuner, QUALITY, QUALITY_ORDER, autoStartLevel, isMobileDevice, type QualityLevel } from './render/quality';
import { Stage } from './render/stage';
import { CpuController, type Difficulty } from './sim/ai';
import { DT, Fight, NEUTRAL, type InputFrame, type SimEvent } from './sim/fight';
import { MOVES } from './sim/moves';
import { Hud } from './ui/hud';
import { DEFAULT_SETTINGS, Screens, type Mode, type Settings } from './ui/screens';

type Kind = Mode | 'attract' | 'showcase';

const SETTINGS_KEY = 'asani-settings-v1';
const params = new URLSearchParams(location.search);

function loadSettings(): Settings {
  const s = { ...DEFAULT_SETTINGS };
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) Object.assign(s, JSON.parse(raw));
  } catch { /* storage unavailable */ }
  const q = params.get('quality') as QualityLevel | null;
  if (q && q in QUALITY) s.quality = q;
  if (params.get('fps')) s.fps = true;
  return s;
}

function saveSettings(s: Settings) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];
const tmp = new Vector3();

class App {
  readonly root: HTMLDivElement;
  readonly engine: Engine;
  readonly stage: Stage;
  readonly fx: Effects;
  readonly director: Director;
  readonly input = new Input();
  readonly touch: TouchControls;
  readonly hud: Hud;
  readonly screens: Screens;
  readonly settings = loadSettings();
  private readonly tuner: AutoTuner;
  private level: QualityLevel;

  fight: Fight | null = null;
  views: FighterView[] = [];
  cpus: (CpuController | null)[] = [null, null];
  kind: Kind = 'attract';
  private chars: [CharId, CharId] = ['vayu', 'phloeng'];
  private difficulty: Difficulty = 'normal';
  paused = false;
  private acc = 0;
  private last = performance.now();
  private time = 0;
  private endTimer = -1;
  private fpsAcc = 0;
  private fpsFrames = 0;

  constructor() {
    this.root = document.getElementById('game') as HTMLDivElement;
    const canvas = document.createElement('canvas');
    canvas.className = 'view';
    this.root.appendChild(canvas);
    this.engine = new Engine(canvas);
    this.level = this.settings.quality === 'auto' ? autoStartLevel() : this.settings.quality;
    this.engine.setQuality(QUALITY[this.level]);
    this.stage = new Stage(this.engine);
    this.fx = new Effects(this.engine.scene, QUALITY[this.level], this.engine.camera);
    this.director = new Director(this.engine);
    this.hud = new Hud(this.root);
    this.touch = new TouchControls(this.input, this.root);
    this.tuner = new AutoTuner(() => this.downgrade());
    this.tuner.enabled = this.settings.quality === 'auto';
    this.applyQuality();
    this.stage.onStrike = (d) => sound.thunder(d);

    this.screens = new Screens(this.root, this.settings, {
      start: (mode, p1, p2, diff) => this.startMatch(mode, p1, p2, diff),
      preview: (p1, p2) => this.showcase(p1, p2),
      settingsChanged: (s) => this.onSettings(s),
      resume: () => this.resume(),
      restart: () => this.startMatch(this.kind as Mode, this.chars[0], this.chars[1], this.difficulty),
      toSelect: () => { this.paused = false; this.screens.reselect(); },
      toTitle: () => this.toTitle(),
      sound: (k) => sound.ui(k),
      modeChanged: () => this.updateChrome(),
    });

    this.input.onMenu = (a, p) => this.onMenu(a, p);
    const unlock = () => {
      const was = sound.ready;
      sound.unlock();
      if (!was && sound.ready) { sound.setVolumes(this.settings.music, this.settings.sfx); sound.startRain(); sound.resumeMusic(); }
    };
    window.addEventListener('pointerdown', unlock, { capture: true });
    window.addEventListener('keydown', unlock, { capture: true });

    this.buildCornerButtons();
    new ResizeObserver(() => this.resize()).observe(this.root);
    this.resize();
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.isFighting() && !this.paused) this.pause();
    });

    const auto = params.get('auto');
    if (auto) {
      const p1 = (params.get('p1') as CharId) ?? 'vayu';
      const p2 = (params.get('p2') as CharId) ?? 'phloeng';
      this.startMatch('cpu', p1, p2, 'hard', true);
    } else {
      this.toTitle();
    }
    this.engine.renderer.compile(this.engine.scene, this.engine.camera);
    document.getElementById('boot')?.classList.add('done');
    if (isMobileDevice() && innerHeight > innerWidth) this.hud.toast('หมุนจอเป็นแนวนอนจะเล่นมันกว่า');
    requestAnimationFrame((t) => this.frame(t));
    (window as unknown as { __app: App }).__app = this;
  }

  // ───────────────────────────── quality ─────────────────────────────

  private applyQuality() {
    const q = QUALITY[this.level];
    this.engine.setQuality(q);
    this.stage.setQuality(q);
    this.fx.setQuality({ ...q, particles: Math.round(q.particles * this.settings.effects) });
    this.resize(true);
  }

  private downgrade(): boolean {
    const i = QUALITY_ORDER.indexOf(this.level);
    if (i >= QUALITY_ORDER.length - 1) return false;
    this.level = QUALITY_ORDER[i + 1];
    this.applyQuality();
    this.hud.toast(`ปรับกราฟิกเป็น "${QUALITY[this.level].label}" ให้ลื่นขึ้น`);
    return true;
  }

  private onSettings(s: Settings) {
    saveSettings(s);
    sound.setVolumes(s.music, s.sfx);
    this.hud.fps.hidden = !s.fps;
    const want = s.quality === 'auto' ? autoStartLevel() : s.quality;
    this.tuner.enabled = s.quality === 'auto';
    this.tuner.reset();
    this.level = want;
    this.applyQuality();
  }

  private resize(force = false) {
    const w = this.root.clientWidth, h = this.root.clientHeight;
    this.engine.resize(w, h, force);
  }

  // ───────────────────────────── modes ─────────────────────────────

  private clearMatch() {
    for (const v of this.views) v.dispose();
    this.views = [];
    this.fight = null;
    this.fx.clearAll();
    sound.beam(false);
    this.director.reset();
    this.endTimer = -1;
  }

  private buildMatch(kind: Kind, p1: CharId, p2: CharId, fight: Fight) {
    this.clearMatch();
    this.kind = kind;
    this.chars = [p1, p2];
    this.fight = fight;
    this.views = fight.f.map((f) => new FighterView(f, this.engine.scene, this.fx));
    this.acc = 0;
  }

  toTitle() {
    this.paused = false;
    this.startAttract();
    this.screens.title();
    sound.setMusic('menu');
  }

  private startAttract() {
    const a = pick(ROSTER);
    const b = pick(ROSTER.filter((x) => x !== a));
    const fight = new Fight(a, b, { roundSeconds: 45 });
    this.buildMatch('attract', a, b, fight);
    this.cpus = [new CpuController(0, 'hard'), new CpuController(1, 'hard')];
    this.director.mode = 'attract';
    this.hud.show(false);
    this.director.cut(this.fight);
  }

  private showcaseKey = '';

  private showcase(p1: CharId, p2: CharId | null) {
    const key = `${p1}|${p2 ?? '-'}`;
    if (this.kind !== 'showcase' || key !== this.showcaseKey) {
      this.showcaseKey = key;
      const fight = new Fight(p1, p2 ?? p1, { training: true });
      fight.f[0].x = fight.f[0].px = -1.35;
      fight.f[1].x = fight.f[1].px = 1.35;
      this.buildMatch('showcase', p1, p2 ?? p1, fight);
      this.cpus = [null, null];
      if (!p2) { this.views[1].rig.root.visible = false; for (const r of this.views[1].rig.ribbons) r.mesh.visible = false; this.views[1].auraScale = 0; }
      this.director.mode = 'select';
      this.hud.show(false);
      sound.setMusic('menu');
    }
  }

  startMatch(mode: Mode, p1: CharId, p2: CharId, difficulty: Difficulty, autoplay = false) {
    this.paused = false;
    this.difficulty = difficulty;
    const fight = new Fight(p1, p2, { training: mode === 'training', roundSeconds: this.settings.roundTime, skipIntro: autoplay });
    this.buildMatch(mode, p1, p2, fight);
    this.input.shareKeys = mode !== 'versus';
    this.cpus = [
      autoplay ? new CpuController(0, 'hard') : null,
      mode === 'cpu' ? new CpuController(1, difficulty) : null,
    ];
    if (mode === 'training') { const c = new CpuController(1, 'easy'); c.dummy = true; this.cpus[1] = c; }
    this.director.mode = 'fight';
    this.screens.hide();
    this.hud.setup(fight);
    this.hud.show(true);
    this.hud.minimal(false);
    this.input.clearPressed();
    this.director.cut(fight);
    sound.setMusic('fight');
    if (mode === 'training') this.hud.announce('ฝึกซ้อม', { sub: 'เลือดไม่ลด · เกจไม้ตายเต็มตลอด', cls: 'small', ms: 2200 });
    this.updateChrome();
  }

  private isFighting() {
    return this.kind === 'cpu' || this.kind === 'versus' || this.kind === 'training';
  }

  pause() {
    if (!this.isFighting() || this.screens.name === 'results') return;
    this.paused = true;
    this.input.releaseAll();
    this.screens.pause();
    sound.beam(false);
  }

  resume() {
    this.paused = false;
    this.screens.hide();
    this.input.clearPressed();
    this.last = performance.now();
    if (this.fight?.beam) sound.beam(true);
  }

  private onMenu(a: MenuAction, player: number) {
    if (this.screens.name) { this.screens.key(a, player); return; }
    if (a === 'pause' && this.isFighting()) this.pause();
  }

  private updateChrome() {
    const fighting = this.isFighting() && !this.paused && !this.screens.name;
    const coarse = matchMedia('(pointer: coarse)').matches || this.input.lastDevice === 'touch';
    this.touch.show(fighting && coarse && this.kind !== 'versus');
    this.root.classList.toggle('in-fight', fighting);
    this.root.classList.toggle('in-menu', !!this.screens.name);
  }

  private buildCornerButtons() {
    const bar = document.createElement('div');
    bar.className = 'corner';
    bar.innerHTML = `
      <button type="button" class="cb cb-pause" id="btn-pause" aria-label="หยุดเกม" title="หยุดเกม (Esc)">❚❚</button>
      <button type="button" class="cb cb-full" id="btn-full" aria-label="เต็มจอ" title="เต็มจอ">⛶</button>`;
    this.root.appendChild(bar);
    bar.querySelector('#btn-pause')!.addEventListener('click', () => { if (this.paused) this.resume(); else this.pause(); this.updateChrome(); });
    bar.querySelector('#btn-full')!.addEventListener('click', async () => {
      try {
        if (document.fullscreenElement) await document.exitFullscreen();
        else await this.root.requestFullscreen({ navigationUI: 'hide' });
        try { await (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.('landscape'); } catch { /* optional */ }
      } catch { this.hud.toast('เบราว์เซอร์นี้ไม่อนุญาตโหมดเต็มจอ'); }
    });
  }

  // ───────────────────────────── loop ─────────────────────────────

  private gatherInputs(): [InputFrame, InputFrame] {
    const f = this.fight!;
    const out: InputFrame[] = [NEUTRAL, NEUTRAL];
    for (let i = 0; i < 2; i++) {
      const cpu = this.cpus[i];
      if (cpu) out[i] = cpu.next(f);
      else if (this.kind === 'showcase') out[i] = NEUTRAL;
      else if (this.kind === 'versus' || i === 0) out[i] = this.input.frame(i);
    }
    return out as [InputFrame, InputFrame];
  }

  private frame(now: number) {
    requestAnimationFrame((t) => this.frame(t));
    const raw = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    this.time += raw;
    this.input.poll();
    this.tuner.sample(raw);
    this.updateChrome();

    const fight = this.fight;
    let alpha = 1;
    const ts = this.director.timeScale;
    const live = !!fight && !this.paused;
    if (fight && live) {
      this.acc += raw * ts;
      let steps = 0;
      while (this.acc >= DT && steps < 5) {
        fight.step(this.gatherInputs());
        this.handleEvents(fight.events);
        this.acc -= DT;
        steps++;
      }
      if (steps >= 5) this.acc = 0;
      alpha = this.acc / DT;
      if (this.kind === 'showcase') { for (const f of fight.f) { f.hp = f.maxHp; } }
    }
    const vdt = live ? raw * ts : 0;
    const quality = QUALITY[this.level].detail * this.settings.effects;
    for (const v of this.views) v.update(vdt, alpha, this.fx.eye, quality);
    if (fight) this.updateProjectileVisuals(fight, alpha, vdt);
    this.director.update(raw, this.kind === 'showcase' ? null : fight);
    const focus = fight ? (fight.f[0].x + fight.f[1].x) / 2 : 0;
    this.stage.update(raw * (this.paused ? 0.15 : ts), focus);
    this.fx.update(vdt, this.time);
    if (fight && this.isFighting()) this.hud.update(fight, raw);
    this.engine.render(raw);

    if (this.endTimer > 0 && live) {
      this.endTimer -= raw;
      if (this.endTimer <= 0) this.onMatchEnd();
    }
    if (this.settings.fps) {
      this.fpsAcc += raw;
      this.fpsFrames++;
      if (this.fpsAcc > 0.5) {
        this.hud.fps.textContent = `${Math.round(this.fpsFrames / this.fpsAcc)} FPS · ${QUALITY[this.level].label}`;
        this.fpsAcc = 0;
        this.fpsFrames = 0;
      }
    }
    this.hud.fps.hidden = !this.settings.fps;
  }

  private updateProjectileVisuals(fight: Fight, alpha: number, dt: number) {
    for (const p of fight.projectiles) {
      const x = p.px + (p.x - p.px) * alpha;
      this.fx.projectile(p.id, fight.f[p.owner].def.id, x, p.y, Math.sign(p.vx));
    }
    const bm = fight.beam;
    if (bm) {
      const owner = fight.f[bm.owner];
      this.fx.beam.x0 = owner.x + owner.facing * 0.5;
      this.fx.beam.y = bm.y;
      this.fx.beamLight(bm.x0 + bm.dir * 1.5, bm.y, owner.def.accent, true);
      // Particles streaming down the beam and a hot flare at the origin.
      const c = CHARACTERS[owner.def.id];
      const col = hexToRgb(c.accent, 4);
      for (let i = 0; i < this.fx.n(10); i++) {
        const d = Math.random() * 14;
        this.fx.emit({
          x: bm.x0 + bm.dir * d, y: bm.y + (Math.random() - 0.5) * 0.9, z: (Math.random() - 0.5) * 0.9,
          vx: bm.dir * (8 + Math.random() * 10), vy: (Math.random() - 0.5) * 2, vz: (Math.random() - 0.5) * 2,
          life: 0.25 + Math.random() * 0.3, size: 0.04 + Math.random() * 0.05, r: col[0], g: col[1], b: col[2], stretch: 0.03,
        });
      }
      this.fx.emit({ x: bm.x0, y: bm.y, z: 0.2, life: 0.08, size: 1.4 + Math.random() * 0.5, r: col[0] * 0.3, g: col[1] * 0.3, b: col[2] * 0.3 });
      if (owner.def.id === 'vayu' && Math.random() < 0.6) {
        this.fx.zap(tmp.set(bm.x0 + bm.dir * Math.random() * 10, bm.y, 0), 1.2, 2, 0.05);
      }
      if (owner.def.id === 'phloeng') this.fx.flames(tmp.set(bm.x0 + bm.dir * Math.random() * 8, bm.y, 0), 1.4, this.fx.n(4));
      if (owner.def.id === 'chantra') this.fx.sparkles(tmp.set(bm.x0 + bm.dir * Math.random() * 10, bm.y, 0), 1.2, this.fx.n(4));
      this.director.shake(dt * 1.2);
      this.stage.runeBoost = 1;
    } else {
      this.stage.runeBoost = Math.max(0, this.stage.runeBoost - dt * 1.5);
    }
    // Super charge-up visuals during the freeze.
    if (fight.freeze > 0 && fight.freezeOwner >= 0) {
      const v = this.views[fight.freezeOwner];
      v.handsCenter(tmp);
      this.fx.superCharge(tmp, fight.f[fight.freezeOwner].def.id, 1 - fight.freeze / MOVES.super.startup);
      this.stage.runeBoost = Math.min(1, this.stage.runeBoost + dt * 2);
    }
  }

  // ───────────────────────────── events ─────────────────────────────

  private handleEvents(events: SimEvent[]) {
    const fight = this.fight!;
    const loud = this.kind !== 'attract' && this.kind !== 'showcase';
    for (const e of events) {
      switch (e.t) {
        case 'hit': {
          const att = fight.f[e.att];
          const dir = Math.sign(fight.f[e.def].x - (e.projectile ? e.x - 0.01 * att.facing : att.x)) || att.facing;
          this.fx.hit(e.x, e.y, dir, e.strength, e.blocked, att.def.id, e.counter);
          if (loud || e.strength === 'heavy') sound.hit(e.strength, e.blocked, att.def.id);
          const k = e.blocked ? 0.4 : 1;
          this.director.shake((e.strength === 'heavy' ? 0.42 : e.strength === 'medium' ? 0.24 : e.strength === 'super' ? 0.16 : 0.13) * k);
          if (!e.blocked && (e.strength === 'heavy' || e.counter)) this.director.punch(e.counter ? 1.2 : 1, tmp.set(e.x, e.y, 0));
          if (e.counter && loud) this.hud.callout(e.att, 'เคาน์เตอร์!');
          break;
        }
        case 'swing':
          if (loud) sound.whoosh(e.strength);
          break;
        case 'special': {
          const f = fight.f[e.who];
          if (loud) {
            sound.special(f.def.id);
            const name = e.move === 'orb' ? f.def.moves.orb : e.move === 'rush' ? f.def.moves.rush : e.move === 'rising' ? f.def.moves.rising : f.def.moves.super;
            this.hud.callout(e.who, name);
          }
          break;
        }
        case 'projectileEnd':
          this.fx.endProjectile(e.id, e.x, e.y);
          if (loud) sound.explosion(0.45);
          break;
        case 'clash':
          this.fx.clash(e.x, e.y);
          this.director.shake(0.5);
          this.director.flashScreen(0.3);
          sound.explosion(1);
          break;
        case 'jump':
          if (loud) sound.jump();
          this.fx.dust(fight.f[e.who].x, 0, 0.6);
          break;
        case 'land':
          if (loud) sound.land(e.hard);
          this.fx.dust(fight.f[e.who].x, 0, 0.5);
          break;
        case 'dash':
          if (loud) sound.dash();
          this.fx.dust(fight.f[e.who].x, 0, 0.8);
          break;
        case 'superStart': {
          const f = fight.f[e.who];
          this.director.superStart(e.who, MOVES.super.startup);
          sound.superStart(f.def.id);
          if (loud || this.kind === 'attract') this.hud.superCutin(e.who, f.def.name, f.def.moves.super, f.def.accent);
          this.fx.ring(tmp.set(f.x, 0.04, 0), [4, 3, 1.2], 6, 0.9, true, 0.03);
          this.views[e.who].handsCenter(tmp);
          this.fx.flashLight(tmp, f.def.accent, 45, 0.8);
          break;
        }
        case 'beamStart': {
          const f = fight.f[e.who];
          const bm = fight.beam!;
          this.fx.beam.start(e.who, f.def.id, bm.x0, bm.y, bm.dir);
          this.director.beamStart(e.who);
          sound.beam(true);
          this.fx.ring(tmp.set(bm.x0, bm.y, 0.2), hexToRgb(f.def.accent, 5), 6, 0.5);
          break;
        }
        case 'beamEnd':
          this.fx.beam.stop();
          this.fx.beamLight(0, 0, 0, false);
          sound.beam(false);
          break;
        case 'knockdown':
          this.fx.splash(e.x, e.hard ? 1.3 : 0.8);
          if (loud) sound.land(true);
          this.director.shake(e.hard ? 0.3 : 0.15);
          break;
        case 'ko': {
          this.director.ko(e.loser);
          sound.ko();
          const loser = fight.f[Math.max(0, e.loser)];
          this.fx.clash(loser.x, loser.y + 1);
          if (loud || this.kind === 'attract') {
            const winner = e.loser >= 0 ? fight.f[1 - e.loser] : null;
            const perfect = winner && winner.hp === winner.maxHp;
            this.hud.announce(e.double ? 'DOUBLE K.O.' : 'K.O.', { cls: 'ko', sub: perfect ? 'PERFECT · ไร้รอยขีดข่วน' : undefined, ms: 2400 });
          }
          break;
        }
        case 'combo':
          break;
        case 'phase':
          this.onPhase(e.phase, e.round);
          break;
        default:
          break;
      }
    }
  }

  private onPhase(phase: string, round: number) {
    const fight = this.fight!;
    const show = this.kind !== 'showcase';
    switch (phase) {
      case 'intro':
        if (show && this.kind !== 'attract') {
          const [a, b] = fight.f;
          this.hud.announce(`${a.def.name}<i>VS</i>${b.def.name}`, { cls: 'vs', sub: `${a.def.title} ปะทะ ${b.def.title}`, ms: 2400 });
        }
        break;
      case 'ready': {
        for (const v of this.views) v.resetCloth();
        this.fx.clearAll();
        for (const c of this.cpus) c?.reset();
        if (!show) break;
        const final = fight.f[0].wins === 1 && fight.f[1].wins === 1;
        this.hud.announce(final ? 'FINAL ROUND' : `ROUND ${round}`, { sub: final ? 'ยกตัดสิน' : `ยกที่ ${round}`, cls: 'round' });
        sound.stinger('round');
        break;
      }
      case 'go':
        if (!show) break;
        this.hud.announce('FIGHT!', { sub: 'สู้!', cls: 'fight', ms: 900 });
        sound.stinger('fight');
        this.director.shake(0.3);
        break;
      case 'timeup':
        if (show) this.hud.announce('TIME UP', { sub: 'หมดเวลา', cls: 'round', ms: 1800 });
        break;
      case 'matchEnd':
        this.endTimer = this.kind === 'attract' ? 2.5 : 1.6;
        if (this.kind !== 'attract' && fight.matchWinner >= 0) sound.stinger('win');
        break;
    }
  }

  private onMatchEnd() {
    const fight = this.fight;
    if (!fight) return;
    if (this.kind === 'attract') { this.startAttract(); return; }
    const w = fight.matchWinner;
    const winner = w >= 0 ? fight.f[w] : null;
    const label = this.kind === 'cpu' ? (w === 0 ? 'คุณชนะ' : w === 1 ? 'คอมชนะ' : 'เสมอ') : w >= 0 ? `ผู้เล่น ${w + 1} ชนะ` : 'เสมอ';
    this.hud.show(false);
    this.screens.results(winner?.def.id ?? null, !!winner && winner.hp === winner.maxHp, label);
  }
}

function hexToRgb(hex: number, k: number): [number, number, number] {
  const r = ((hex >> 16) & 255) / 255, g = ((hex >> 8) & 255) / 255, b = (hex & 255) / 255;
  // Approximate sRGB → linear so glow colours match the scene.
  const lin = (c: number) => Math.pow(c, 2.2);
  return [lin(r) * k, lin(g) * k, lin(b) * k];
}

function boot() {
  try {
    new App();
  } catch (err) {
    console.error(err);
    const b = document.getElementById('boot');
    if (b) b.innerHTML = `<div class="boot-err">เปิดเกมไม่ได้: เครื่องหรือเบราว์เซอร์นี้อาจไม่รองรับ WebGL2<br><small>${String(err)}</small></div>`;
  }
}

boot();
