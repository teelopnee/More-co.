// Camera direction and screen-space juice: framing, shake, super cinematics, KO slow motion.
import { MathUtils, Vector2, Vector3, type PerspectiveCamera } from 'three';
import type { Engine } from './render/engine';
import { MOON_DIR } from './render/stage';
import type { Fight } from './sim/fight';

export type CamMode = 'fight' | 'attract' | 'select' | 'title';

const noise = (t: number) => Math.sin(t * 1.0) * 0.5 + Math.sin(t * 2.31 + 1.3) * 0.3 + Math.sin(t * 5.17 + 2.1) * 0.2;

export class Director {
  readonly pos = new Vector3(0, 2.2, 14);
  readonly look = new Vector3(0, 1.1, 0);
  private readonly tPos = new Vector3();
  private readonly tLook = new Vector3();
  fov = 34;
  private trauma = 0;
  private time = 0;
  private ca = 0;
  private radial = 0;
  private flash = 0;
  private darken = 0;
  private bars = 0;
  private speed = 0;
  private zoomKick = 0;
  private readonly center = new Vector2(0.5, 0.5);
  /** Simulation speed (KO slow motion). */
  timeScale = 1;
  private slow = 0;
  private cine: { kind: 'super' | 'beam' | 'ko'; who: number; t: number; dur: number } | null = null;
  mode: CamMode = 'title';
  private readonly tmp = new Vector3();

  constructor(private readonly engine: Engine) {}

  get camera(): PerspectiveCamera {
    return this.engine.camera;
  }

  shake(a: number) {
    this.trauma = Math.min(1, this.trauma + a);
  }

  punch(strength: number, world: Vector3) {
    this.tmp.copy(world).project(this.camera);
    this.center.set(this.tmp.x * 0.5 + 0.5, this.tmp.y * 0.5 + 0.5);
    this.radial = Math.max(this.radial, strength * 0.07);
    this.ca = Math.max(this.ca, strength * 0.014);
    this.zoomKick = Math.max(this.zoomKick, strength * 2.2);
  }

  flashScreen(amount: number, r = 1, g = 1, b = 1) {
    this.flash = Math.max(this.flash, amount);
    this.engine.post.flashColor.setRGB(r, g, b);
  }

  superStart(who: number, frames: number) {
    this.cine = { kind: 'super', who, t: 0, dur: frames / 60 };
    this.flashScreen(0.35);
  }

  beamStart(who: number) {
    this.cine = { kind: 'beam', who, t: 0, dur: 1.05 };
    this.flashScreen(0.35);
    this.speed = 0.8;
    this.shake(0.6);
  }

  ko(loser: number) {
    this.cine = { kind: 'ko', who: Math.max(0, loser), t: 0, dur: 1.7 };
    this.slow = 1.5;
    this.flashScreen(1);
    this.ca = 0.03;
    this.shake(1);
  }

  reset() {
    this.cine = null;
    this.slow = 0;
    this.timeScale = 1;
    this.trauma = 0;
    this.darken = this.bars = this.speed = 0;
  }

  /** Snap the camera to its target (after scene changes). */
  cut(fight: Fight | null) {
    this.update(0, fight, true);
  }

  update(dt: number, fight: Fight | null, snap = false, alpha = 1) {
    this.time += dt;
    const cam = this.camera;
    const aspect = cam.aspect;
    let fov = aspect < 1 ? 48 : 34;
    let k = 5;
    let dark = 0, bars = 0;

    // KO slow motion runs on real time.
    if (this.slow > 0) {
      this.slow -= dt;
      this.timeScale = this.slow > 0.25 ? 0.22 : 0.22 + (0.25 - this.slow) * 3.1;
      if (this.slow <= 0) this.timeScale = 1;
    }

    if (this.cine) {
      this.cine.t += dt;
      if (this.cine.t > this.cine.dur) this.cine = null;
    }

    if (fight) {
      const [a, b] = fight.f;
      const ax = a.px + (a.x - a.px) * alpha, bx = b.px + (b.x - b.px) * alpha;
      const cine = this.cine;
      if (cine && cine.kind === 'super') {
        const f = fight.f[cine.who];
        const t = cine.t / cine.dur;
        const side = f.facing;
        this.tPos.set(f.x + side * (1.7 - t * 0.4), 1.25 + t * 0.2, 2.9 - t * 0.5);
        this.tLook.set(f.x + side * 0.25, 1.15, 0);
        fov = 30;
        k = 10;
        dark = 0.85;
        bars = 1;
      } else if (cine && cine.kind === 'beam') {
        const f = fight.f[cine.who];
        const t = cine.t / cine.dur;
        this.tPos.set(f.x - f.facing * (2.6 + t), 0.9 + t * 0.5, 5.4 + t * 2);
        this.tLook.set(f.x + f.facing * 4.5, 1.25, 0);
        fov = 44;
        k = 7;
        dark = 0.35 * (1 - t);
        bars = 1 - t;
      } else if (cine && cine.kind === 'ko') {
        const f = fight.f[cine.who];
        const t = cine.t;
        this.tPos.set(f.x + Math.sin(t * 0.9) * 2.4 - f.facing * 0.5, 1.1 + t * 0.2, 4.6);
        this.tLook.set(f.x, Math.max(0.6, f.y + 0.7), 0);
        fov = 34;
        k = 6;
        bars = 1;
        dark = 0.15;
      } else {
        const mid = (ax + bx) / 2;
        const dist = Math.abs(ax - bx);
        const top = Math.max(a.y, b.y);
        const tanV = Math.tan(MathUtils.degToRad(fov / 2));
        const tanH = tanV * aspect;
        const halfW = dist / 2 + (aspect < 1 ? 1.2 : 1.9);
        const halfV = 1.5 + top * 0.45;
        let d = Math.max(halfW / tanH, halfV / tanV, aspect < 1 ? 5.5 : 6.8);
        d = Math.min(d, 18);
        if (this.mode === 'attract') d *= 1.12;
        const cx = MathUtils.clamp(mid, -6.2, 6.2);
        const sway = this.mode === 'attract' ? Math.sin(this.time * 0.25) * 1.2 : 0;
        this.tPos.set(cx + sway, 1.45 + top * 0.3 + d * 0.045, d);
        this.tLook.set(cx, 1.05 + top * 0.42, 0);
      }
    }
    if (this.mode === 'select') {
      this.tPos.set(Math.sin(this.time * 0.3) * 0.35, 1.4, 6.1);
      this.tLook.set(0, 1.05, 0);
      fov = aspect < 1 ? 52 : 30;
      k = 4;
    } else if (!fight) {
      const t = this.time * 0.08;
      this.tPos.set(Math.sin(t) * 8, 2.6, 10 + Math.cos(t) * 2);
      this.tLook.set(0, 2, -10);
    }

    const a = snap ? 1 : 1 - Math.exp(-dt * k);
    this.pos.lerp(this.tPos, a);
    this.look.lerp(this.tLook, a);
    this.fov += (fov - this.fov) * (snap ? 1 : 1 - Math.exp(-dt * 6));

    // Shake.
    this.trauma = Math.max(0, this.trauma - dt * 1.6);
    const s = this.trauma * this.trauma;
    const tt = this.time * 28;
    cam.position.set(this.pos.x + noise(tt) * s * 0.32, this.pos.y + noise(tt + 50) * s * 0.26, this.pos.z + noise(tt + 90) * s * 0.18);
    cam.up.set(noise(tt + 140) * s * 0.06, 1, 0).normalize();
    cam.lookAt(this.look);
    this.zoomKick = Math.max(0, this.zoomKick - dt * 14);
    cam.fov = this.fov - this.zoomKick;
    cam.updateProjectionMatrix();

    // Screen effects.
    const decay = (v: number, r: number) => Math.max(0, v - dt * r);
    this.ca = decay(this.ca, 0.08);
    this.radial = decay(this.radial, 0.4);
    this.flash = decay(this.flash, 3);
    this.speed = decay(this.speed, 0.9);
    this.darken += (dark - this.darken) * (1 - Math.exp(-dt * 10));
    this.bars += (bars - this.bars) * (1 - Math.exp(-dt * 8));
    const p = this.engine.post;
    p.ca = this.ca + 0.0012;
    p.radial = this.radial;
    p.center.copy(this.center);
    p.flash = this.flash * 0.9;
    p.darken = this.darken;
    p.bars = this.bars;
    p.speed = this.speed;

    // God-ray source: the moon's screen position.
    cam.updateMatrixWorld();
    this.tmp.copy(MOON_DIR).multiplyScalar(600).add(cam.position).project(cam);
    const visible = this.tmp.z < 1 && Math.abs(this.tmp.x) < 1.6 && Math.abs(this.tmp.y) < 1.6;
    p.light.set(this.tmp.x * 0.5 + 0.5, this.tmp.y * 0.5 + 0.5);
    p.godRays = visible ? 1.15 : 0;
  }
}
