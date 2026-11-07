// Deterministic fighting simulation. No rendering code lives here: the renderer reads
// the state and the per-step event list.
import { CHARACTERS, type CharId, type CharacterDef } from '../data/characters';
import { MOVES, isActive, totalFrames, type Box, type MoveDef, type MoveId, type Strength } from './moves';

export const DT = 1 / 60;
export const GRAVITY = -36;
export const STAGE_HALF = 7.6;
export const MAX_SEPARATION = 9.2;
export const PUSH_WIDTH = 0.62;
export const ROUND_SECONDS = 99;
export const SUPER_COST = 100;
export const METER_MAX = 100;

export interface InputFrame {
  /** -1 left, 1 right (world space). */
  x: number;
  /** 1 up, -1 down. */
  y: number;
  /** Buttons pressed since the previous step. */
  p: boolean;
  k: boolean;
  s: boolean;
  u: boolean;
}

export const NEUTRAL: InputFrame = Object.freeze({ x: 0, y: 0, p: false, k: false, s: false, u: false });

export type FState =
  | 'intro' | 'idle' | 'walk' | 'crouch' | 'guard' | 'prejump' | 'air' | 'land' | 'dash'
  | 'attack' | 'hitstun' | 'blockstun' | 'juggle' | 'down' | 'getup' | 'ko' | 'win';

export type Phase = 'intro' | 'ready' | 'go' | 'fight' | 'ko' | 'timeup' | 'roundEnd' | 'matchEnd';

export type SimEvent =
  | { t: 'hit'; att: number; def: number; x: number; y: number; strength: Strength; blocked: boolean; dmg: number; move: MoveId; counter: boolean; projectile: boolean }
  | { t: 'swing'; who: number; move: MoveId; strength: Strength }
  | { t: 'special'; who: number; move: MoveId }
  | { t: 'projectile'; who: number; id: number }
  | { t: 'clash'; x: number; y: number }
  | { t: 'projectileEnd'; id: number; x: number; y: number }
  | { t: 'jump'; who: number }
  | { t: 'land'; who: number; hard: boolean }
  | { t: 'dash'; who: number; dir: number }
  | { t: 'superStart'; who: number }
  | { t: 'beamStart'; who: number }
  | { t: 'beamEnd'; who: number }
  | { t: 'knockdown'; who: number; x: number; hard: boolean }
  | { t: 'ko'; loser: number; double: boolean }
  | { t: 'combo'; who: number; hits: number; dmg: number }
  | { t: 'phase'; phase: Phase; round: number };

type Btn = 'p' | 'k' | 's' | 'u';
interface Buffered {
  b: Btn;
  /** Direction relative to facing at the moment of the press. */
  rel: number;
  down: boolean;
  frame: number;
}

export class Fighter {
  readonly def: CharacterDef;
  x = 0; y = 0; vx = 0; vy = 0;
  /** Previous-step position, for render interpolation. */
  px = 0; py = 0;
  facing: 1 | -1 = 1;
  hp: number;
  readonly maxHp: number;
  meter = 0;
  state: FState = 'idle';
  /** Frames spent in the current state. */
  sf = 0;
  move: MoveDef | null = null;
  /** Frames into the current move. */
  mf = 0;
  moveHits = 0;
  lastHitFrame = -99;
  connected = false;
  crouching = false;
  airAttackUsed = false;
  jumpDir = 0;
  stun = 0;
  hitstop = 0;
  invuln = 0;
  juggle = 0;
  bounced = false;
  comboHits = 0;
  comboDmg = 0;
  /** Last reaction was to a low hit (renderer picks the animation). */
  lowHit = false;
  dashDir = 0;
  landFrames = 3;
  /** Landing recovery owed by a move that ended in the air. */
  pendingLand = 0;
  wins = 0;
  input: InputFrame = NEUTRAL;
  readonly buffer: Buffered[] = [];
  prevRel = 0;
  lastFwdTap = -99;
  lastBackTap = -99;
  projectileOut = false;
  /** Counts rendered hit flashes. */
  hitFlash = 0;
  /** Set when the last landed hit was a counter hit. */
  counterHit = false;
  /** Whether this fighter moved on the last step (false during hitstop or a super freeze). */
  advanced = false;

  constructor(readonly idx: number, id: CharId) {
    this.def = CHARACTERS[id];
    this.maxHp = this.def.hp;
    this.hp = this.maxHp;
  }

  get grounded() {
    return this.y <= 0 && this.vy <= 0;
  }
}

export interface Projectile {
  id: number;
  owner: number;
  x: number;
  y: number;
  px: number;
  vx: number;
  life: number;
  dead: boolean;
}

export interface Beam {
  owner: number;
  frame: number;
  duration: number;
  hits: number;
  x0: number;
  dir: number;
  y: number;
}

export interface FightOptions {
  training?: boolean;
  roundSeconds?: number;
  /** Skip the intro walk-in (tests, replays). */
  skipIntro?: boolean;
}

let projectileIds = 1;

export class Fight {
  readonly f: [Fighter, Fighter];
  readonly projectiles: Projectile[] = [];
  beam: Beam | null = null;
  readonly events: SimEvent[] = [];
  frame = 0;
  phase: Phase = 'intro';
  pf = 0;
  round = 1;
  timer: number;
  freeze = 0;
  freezeOwner = -1;
  koLoser = -1;
  matchWinner = -1;
  readonly training: boolean;
  private readonly roundFrames: number;

  constructor(p1: CharId, p2: CharId, readonly opts: FightOptions = {}) {
    this.f = [new Fighter(0, p1), new Fighter(1, p2)];
    this.training = !!opts.training;
    this.roundFrames = (opts.roundSeconds ?? ROUND_SECONDS) * 60;
    this.timer = this.roundFrames;
    this.resetPositions();
    if (this.training) {
      this.setPhase('fight');
      for (const f of this.f) f.meter = METER_MAX;
    } else if (opts.skipIntro) {
      this.setPhase('fight');
    } else {
      this.setPhase('intro');
      for (const f of this.f) f.state = 'intro';
    }
  }

  get controllable() {
    return this.phase === 'go' || this.phase === 'fight';
  }

  private resetPositions() {
    const [a, b] = this.f;
    a.x = a.px = -2.3; b.x = b.px = 2.3;
    for (const f of this.f) {
      f.y = f.py = 0; f.vx = f.vy = 0; f.hp = f.maxHp; f.state = 'idle'; f.sf = 0; f.move = null;
      f.stun = 0; f.hitstop = 0; f.invuln = 0; f.juggle = 0; f.comboHits = 0; f.comboDmg = 0;
      f.crouching = false; f.projectileOut = false; f.buffer.length = 0; f.bounced = false;
    }
    a.facing = 1; b.facing = -1;
    this.projectiles.length = 0;
    this.beam = null;
    this.freeze = 0;
    this.timer = this.roundFrames;
  }

  private setPhase(p: Phase) {
    this.phase = p;
    this.pf = 0;
    this.events.push({ t: 'phase', phase: p, round: this.round });
  }

  step(inputs: [InputFrame, InputFrame]) {
    this.events.length = 0;
    this.frame++;
    this.updatePhase();
    const live = this.controllable;
    for (let i = 0; i < 2; i++) {
      const f = this.f[i];
      f.px = f.x; f.py = f.y;
      f.advanced = false;
      f.input = live ? inputs[i] : NEUTRAL;
      this.bufferInput(f, f.input);
    }
    for (const p of this.projectiles) p.px = p.x;

    if (this.freeze > 0) {
      // Super flash: only the attacker advances (its startup plays out during the freeze).
      this.freeze--;
      const owner = this.f[this.freezeOwner];
      if (owner.hitstop > 0) owner.hitstop--;
      else this.updateFighter(owner, this.f[1 - this.freezeOwner]);
      return;
    }

    for (let i = 0; i < 2; i++) {
      const f = this.f[i];
      if (f.hitstop > 0) { f.hitstop--; continue; }
      this.updateFighter(f, this.f[1 - i]);
      if (f.state !== 'dash') f.dashDir = 0;
    }
    this.resolvePush();
    this.updateProjectiles();
    this.updateBeam();
    this.checkMelee();
    this.updateFacing();
    this.updateCombos();
    this.updateRules();
  }

  // ───────────────────────────── phases ─────────────────────────────

  private updatePhase() {
    this.pf++;
    switch (this.phase) {
      case 'intro':
        if (this.pf >= 150) { for (const f of this.f) f.state = 'idle'; this.setPhase('ready'); }
        break;
      case 'ready':
        if (this.pf >= 72) this.setPhase('go');
        break;
      case 'go':
        if (this.pf >= 36) this.setPhase('fight');
        break;
      case 'fight':
        if (!this.training && this.freeze === 0 && this.timer > 0) {
          this.timer--;
          if (this.timer === 0) this.setPhase('timeup');
        }
        break;
      case 'ko':
        if (this.pf >= 110) this.claimWin();
        if (this.pf >= 230) this.endRound();
        break;
      case 'timeup':
        if (this.pf === 1) {
          const [a, b] = this.f;
          const ra = a.hp / a.maxHp, rb = b.hp / b.maxHp;
          if (ra > rb) a.wins++; else if (rb > ra) b.wins++; else { a.wins++; b.wins++; }
          this.koLoser = ra > rb ? 1 : rb > ra ? 0 : -1;
        }
        if (this.pf >= 60) this.claimWin();
        if (this.pf >= 170) this.endRound();
        break;
      case 'roundEnd':
        if (this.pf >= 30) {
          this.round++;
          this.resetPositions();
          this.setPhase('ready');
        }
        break;
      case 'matchEnd':
        break;
    }
  }

  private claimWin() {
    if (this.koLoser < 0) return;
    const w = this.f[1 - this.koLoser];
    if (w.state === 'win' || w.hp <= 0 || !w.grounded) return;
    if (w.state === 'attack' || w.state === 'hitstun' || w.state === 'blockstun' || w.state === 'juggle' || w.state === 'down') return;
    w.state = 'win'; w.sf = 0; w.move = null; w.vx = 0; w.crouching = false;
  }

  private endRound() {
    const [a, b] = this.f;
    if (a.wins >= 2 || b.wins >= 2) {
      this.matchWinner = a.wins > b.wins ? 0 : b.wins > a.wins ? 1 : -1;
      this.setPhase('matchEnd');
    } else {
      this.setPhase('roundEnd');
    }
  }

  private updateRules() {
    if (this.training || (this.phase !== 'fight' && this.phase !== 'go')) return;
    const [a, b] = this.f;
    const deadA = a.hp <= 0, deadB = b.hp <= 0;
    if (!deadA && !deadB) return;
    this.koLoser = deadA && deadB ? -1 : deadA ? 0 : 1;
    if (deadA && deadB) { a.wins++; b.wins++; }
    else this.f[1 - this.koLoser].wins++;
    this.projectiles.length = 0;
    this.events.push({ t: 'ko', loser: this.koLoser, double: deadA && deadB });
    this.setPhase('ko');
  }

  // ───────────────────────────── input ─────────────────────────────

  private bufferInput(f: Fighter, inp: InputFrame) {
    const rel = Math.sign(inp.x) * f.facing;
    const down = inp.y < 0;
    for (const b of ['p', 'k', 's', 'u'] as Btn[]) {
      if (inp[b]) f.buffer.push({ b, rel, down, frame: this.frame });
    }
    while (f.buffer.length && this.frame - f.buffer[0].frame > 7) f.buffer.shift();
    // Double-tap detection for dashes (only meaningful on the ground).
    if (rel !== f.prevRel && rel !== 0 && inp.y === 0) {
      if (rel > 0) {
        if (this.frame - f.lastFwdTap <= 12) { f.dashDir = 1; f.lastFwdTap = -99; } else f.lastFwdTap = this.frame;
      } else {
        if (this.frame - f.lastBackTap <= 12) { f.dashDir = -1; f.lastBackTap = -99; } else f.lastBackTap = this.frame;
      }
    }
    f.prevRel = rel;
  }

  private takeBuffered(f: Fighter, accept: (b: Buffered) => MoveDef | null): MoveDef | null {
    for (let i = f.buffer.length - 1; i >= 0; i--) {
      const mv = accept(f.buffer[i]);
      if (mv) { f.buffer.splice(0, i + 1); return mv; }
    }
    return null;
  }

  private neutralMove(f: Fighter, b: Buffered): MoveDef | null {
    if (b.b === 'u') return f.meter >= SUPER_COST ? MOVES.super : null;
    if (b.b === 's') {
      if (b.down) return MOVES.rising;
      if (b.rel > 0) return MOVES.rush;
      return f.projectileOut ? null : MOVES.orb;
    }
    if (b.b === 'p') return b.down ? MOVES.upper : b.rel > 0 ? MOVES.straight : MOVES.jab;
    return b.down ? MOVES.sweep : b.rel > 0 ? MOVES.round : MOVES.snap;
  }

  private tryNeutralAction(f: Fighter): boolean {
    const mv = this.takeBuffered(f, (b) => this.neutralMove(f, b));
    if (!mv) return false;
    this.startMove(f, mv);
    return true;
  }

  private tryCancel(f: Fighter): boolean {
    const cur = f.move;
    if (!cur || !f.connected) return false;
    const end = cur.startup + cur.active + 12;
    if (f.mf < cur.startup || f.mf > end) return false;
    const mv = this.takeBuffered(f, (b) => {
      if ((b.b === 'p' || b.b === 'k') && cur.chain?.[b.b]) {
        // Directional normals override the chain when asked for explicitly.
        if (b.down) return b.b === 'p' ? MOVES.upper : MOVES.sweep;
        return MOVES[cur.chain[b.b]!];
      }
      if (cur.cancel === 'special' && (b.b === 's' || b.b === 'u')) return this.neutralMove(f, b);
      if (cur.cancel === 'super' && b.b === 'u') return this.neutralMove(f, b);
      return null;
    });
    if (!mv || mv === cur) return false;
    this.startMove(f, mv);
    return true;
  }

  private startMove(f: Fighter, mv: MoveDef) {
    f.state = 'attack';
    f.move = mv;
    f.mf = 0;
    f.sf = 0;
    f.moveHits = 0;
    f.lastHitFrame = -99;
    f.connected = false;
    f.crouching = !!mv.crouch;
    if (mv.air) f.airAttackUsed = true;
    if (!mv.air && f.grounded) f.vx = 0;
    if (mv.special) this.events.push({ t: 'special', who: f.idx, move: mv.id });
    if (mv.id === 'super') {
      f.meter -= SUPER_COST;
      this.freeze = mv.startup;
      this.freezeOwner = f.idx;
      this.events.push({ t: 'superStart', who: f.idx });
    } else {
      f.meter = Math.min(METER_MAX, f.meter + (mv.special ? 3 : 1));
    }
  }

  // ───────────────────────────── fighters ─────────────────────────────

  private threat(f: Fighter, o: Fighter): boolean {
    const dx = Math.abs(o.x - f.x);
    if (o.state === 'attack' && o.move && dx < 3.6) return true;
    if (this.beam && this.beam.owner === o.idx) return true;
    for (const p of this.projectiles) {
      if (p.owner === o.idx && Math.sign(p.vx) === Math.sign(f.x - p.x) && Math.abs(p.x - f.x) < 4.5) return true;
    }
    return false;
  }

  private isNeutral(f: Fighter) {
    return f.state === 'idle' || f.state === 'walk' || f.state === 'crouch' || f.state === 'guard';
  }

  private updateFighter(f: Fighter, o: Fighter) {
    const inp = f.input;
    const rel = Math.sign(inp.x) * f.facing;
    const speed = f.def.speed;
    f.advanced = true;
    f.sf++;
    if (f.invuln > 0) f.invuln--;

    switch (f.state) {
      case 'intro':
      case 'win':
        f.vx = 0;
        break;

      case 'idle': case 'walk': case 'crouch': case 'guard': {
        if (this.tryNeutralAction(f)) break;
        if (inp.y > 0) {
          this.setState(f, 'prejump');
          f.jumpDir = Math.sign(inp.x);
          f.vx = 0;
          break;
        }
        if (f.dashDir !== 0 && inp.y >= 0) {
          this.setState(f, 'dash');
          f.invuln = f.dashDir < 0 ? 8 : 0;
          this.events.push({ t: 'dash', who: f.idx, dir: f.dashDir });
          break;
        }
        const threatened = rel < 0 && this.threat(f, o);
        if (inp.y < 0) {
          this.setState(f, threatened ? 'guard' : 'crouch', true);
          f.crouching = true;
          f.vx = 0;
        } else if (rel < 0 && threatened) {
          this.setState(f, 'guard', true);
          f.crouching = false;
          f.vx = 0;
        } else if (rel !== 0) {
          this.setState(f, 'walk', true);
          f.crouching = false;
          f.vx = Math.sign(inp.x) * (rel > 0 ? 3.4 : 2.7) * speed;
        } else {
          this.setState(f, 'idle', true);
          f.crouching = false;
          f.vx = 0;
        }
        break;
      }

      case 'prejump':
        if (f.sf >= 4) {
          this.setState(f, 'air');
          f.vy = 12.8;
          f.vx = f.jumpDir * 3.7 * speed;
          f.airAttackUsed = false;
          f.crouching = false;
          this.events.push({ t: 'jump', who: f.idx });
        }
        break;

      case 'air':
        if (!f.airAttackUsed) {
          const mv = this.takeBuffered(f, (b) => (b.b === 'p' ? MOVES.airP : b.b === 'k' ? MOVES.airK : null));
          if (mv) { this.startMove(f, mv); break; }
        }
        break;

      case 'land':
        f.vx *= 0.6;
        if (f.sf >= f.landFrames) this.setState(f, 'idle');
        break;

      case 'dash': {
        const len = f.dashDir > 0 ? 17 : 20;
        const t = f.sf / len;
        f.vx = f.dashDir * f.facing * (f.dashDir > 0 ? 10.5 : 8) * (1 - t * t) * speed;
        if (f.sf >= len) { f.dashDir = 0; this.setState(f, 'idle'); }
        break;
      }

      case 'attack': {
        const mv = f.move!;
        f.mf++;
        if (this.tryCancel(f)) break;
        let moved = false;
        if (mv.motion) {
          for (const mo of mv.motion) {
            if (f.mf >= mo.from && f.mf < mo.to) {
              f.vx = mo.vx * f.facing * (mv.id === 'rush' ? speed : 1);
              if (mo.vy !== undefined && f.mf === mo.from) f.vy = mo.vy;
              moved = true;
            }
          }
        }
        if (mv.id === 'rush' && f.connected) { f.vx *= 0.3; }
        if (!moved && f.grounded && !mv.air) f.vx *= 0.75;
        if (mv.invuln) f.invuln = f.mf >= mv.invuln[0] && f.mf < mv.invuln[1] ? 2 : f.invuln;
        if (mv.id === 'orb' && f.mf === mv.startup) this.spawnProjectile(f);
        if (mv.id === 'super' && f.mf === mv.startup) this.spawnBeam(f);
        if (f.mf === mv.startup && mv.id !== 'super' && mv.id !== 'orb') {
          this.events.push({ t: 'swing', who: f.idx, move: mv.id, strength: mv.strength });
        }
        if (!mv.air && f.mf >= totalFrames(mv) && f.grounded) {
          f.move = null;
          this.setState(f, f.input.y < 0 ? 'crouch' : 'idle');
          f.crouching = f.input.y < 0;
        } else if (mv.air && f.mf >= totalFrames(mv)) {
          f.move = null;
          this.setState(f, 'air');
        } else if (!mv.air && f.mf >= totalFrames(mv) && !f.grounded) {
          f.move = null;
          this.setState(f, 'air');
          f.airAttackUsed = true;
          f.pendingLand = mv.landing ?? 3;
        }
        break;
      }

      case 'hitstun':
        f.stun--;
        f.vx *= 0.86;
        if (f.stun <= 0) this.setState(f, f.crouching ? 'crouch' : 'idle');
        break;

      case 'blockstun':
        f.stun--;
        f.vx *= 0.85;
        if (f.stun <= 0) this.setState(f, f.crouching ? 'crouch' : 'idle');
        break;

      case 'juggle':
      case 'ko':
        break;

      case 'down':
        f.vx *= 0.8;
        if (f.sf >= 44) { this.setState(f, 'getup'); f.invuln = 24; }
        break;

      case 'getup':
        if (f.sf >= 22) { this.setState(f, 'idle'); f.juggle = 0; }
        break;
    }

    this.integrate(f);
  }

  private setState(f: Fighter, s: FState, keepFrame = false) {
    if (f.state === s && keepFrame) return;
    f.state = s;
    f.sf = 0;
  }

  private integrate(f: Fighter) {
    if (f.state === 'intro' || f.state === 'win') return;
    f.x += f.vx * DT;
    const airborne = f.y > 0 || f.vy > 0;
    if (!airborne) return;
    f.vy += GRAVITY * DT;
    f.y += f.vy * DT;
    // Wall bounce for launched fighters.
    if ((f.state === 'juggle' || f.state === 'ko') && Math.abs(f.x) > STAGE_HALF && Math.sign(f.vx) === Math.sign(f.x)) {
      f.vx = -f.vx * 0.35;
    }
    if (f.y > 0) return;
    const impact = f.vy;
    f.y = 0;
    f.vy = 0;
    switch (f.state) {
      case 'air':
        this.setState(f, 'land');
        f.landFrames = f.pendingLand || 3;
        f.pendingLand = 0;
        this.events.push({ t: 'land', who: f.idx, hard: false });
        break;
      case 'attack':
        if (f.move?.air || f.move?.landing) {
          f.landFrames = f.move.landing ?? 4;
          f.move = null;
          this.setState(f, 'land');
          this.events.push({ t: 'land', who: f.idx, hard: false });
        }
        break;
      case 'juggle':
      case 'ko':
        if (!f.bounced && impact < -7) {
          f.bounced = true;
          f.vy = Math.min(5.5, -impact * 0.35);
          f.y = 0.001;
          f.vx *= 0.6;
          this.events.push({ t: 'knockdown', who: f.idx, x: f.x, hard: true });
        } else {
          f.bounced = false;
          f.vx = 0;
          if (f.state === 'juggle') this.setState(f, 'down');
          this.events.push({ t: 'knockdown', who: f.idx, x: f.x, hard: false });
        }
        break;
      default:
        break;
    }
  }

  private resolvePush() {
    const [a, b] = this.f;
    // Keep both on stage and within the camera's reach.
    for (const f of this.f) f.x = Math.max(-STAGE_HALF, Math.min(STAGE_HALF, f.x));
    const sep = b.x - a.x;
    if (Math.abs(sep) > MAX_SEPARATION) {
      const excess = Math.abs(sep) - MAX_SEPARATION;
      const dir = Math.sign(sep);
      const movedA = Math.abs(a.x - a.px), movedB = Math.abs(b.x - b.px);
      if (movedA >= movedB) a.x += dir * excess; else b.x -= dir * excess;
    }
    if (Math.abs(a.y - b.y) > 1.3) return;
    if (a.state === 'down' || b.state === 'down' || a.state === 'ko' || b.state === 'ko') return;
    const dx = b.x - a.x;
    const overlap = PUSH_WIDTH - Math.abs(dx);
    if (overlap <= 0) return;
    const dir = dx !== 0 ? Math.sign(dx) : a.facing;
    a.x -= dir * overlap * 0.5;
    b.x += dir * overlap * 0.5;
    // Wall: whoever is cornered stays, the other gets pushed out.
    for (const [f, o, s] of [[a, b, -dir], [b, a, dir]] as const) {
      if (Math.abs(f.x) > STAGE_HALF) {
        const over = Math.abs(f.x) - STAGE_HALF;
        f.x = Math.sign(f.x) * STAGE_HALF;
        o.x -= s * over;
      }
    }
  }

  private updateFacing() {
    for (const f of this.f) {
      const o = this.f[1 - f.idx];
      const turnable = this.isNeutral(f) || f.state === 'land' || f.state === 'prejump' || f.state === 'getup' || f.state === 'intro';
      if (!turnable) continue;
      const dx = o.x - f.x;
      if (Math.abs(dx) > 0.05) f.facing = dx > 0 ? 1 : -1;
    }
  }

  private updateCombos() {
    for (const f of this.f) {
      if (f.comboHits === 0) continue;
      const recovered = this.isNeutral(f) || f.state === 'land' || f.state === 'getup' || f.state === 'air' || f.state === 'attack' || f.state === 'dash';
      if (!recovered) continue;
      this.events.push({ t: 'combo', who: 1 - f.idx, hits: f.comboHits, dmg: f.comboDmg });
      f.comboHits = 0;
      f.comboDmg = 0;
      f.juggle = 0;
      if (this.training) f.hp = f.maxHp;
    }
    if (this.training) for (const f of this.f) f.meter = Math.min(METER_MAX, f.meter + 0.5);
  }

  // ───────────────────────────── combat ─────────────────────────────

  hurtbox(f: Fighter): { x0: number; x1: number; y0: number; y1: number } | null {
    if (f.invuln > 0 || f.state === 'down' || f.state === 'getup') return null;
    if (f.state === 'ko' && f.grounded) return null;
    const hw = 0.36;
    if (f.state === 'juggle' || f.state === 'ko') return { x0: f.x - 0.48, x1: f.x + 0.48, y0: f.y, y1: f.y + 1.1 };
    if (!f.grounded) return { x0: f.x - hw, x1: f.x + hw, y0: f.y + 0.2, y1: f.y + 1.6 };
    const h = f.crouching ? 1.15 : 1.85;
    return { x0: f.x - hw, x1: f.x + hw, y0: f.y, y1: f.y + h };
  }

  hitbox(f: Fighter): { x0: number; x1: number; y0: number; y1: number } | null {
    const mv = f.move;
    if (f.state !== 'attack' || !mv || mv.id === 'orb' || mv.id === 'super') return null;
    if (!isActive(mv, f.mf)) return null;
    const hits = mv.hits ?? 1;
    if (f.moveHits >= hits) return null;
    if (f.moveHits > 0 && f.mf - f.lastHitFrame < (mv.hitInterval ?? 99)) return null;
    return boxAt(f, mv.hitbox);
  }

  private checkMelee() {
    const boxes = this.f.map((f) => this.hitbox(f));
    const hurts = this.f.map((f) => this.hurtbox(f));
    // Moves are captured first so a trade (both connect on the same frame) resolves both hits.
    const moves = this.f.map((f) => f.move);
    const hits: { i: number; cx: number; cy: number }[] = [];
    for (let i = 0; i < 2; i++) {
      const hb = boxes[i];
      const hu = hurts[1 - i];
      if (!hb || !hu || !moves[i]) continue;
      if (hb.x1 < hu.x0 || hb.x0 > hu.x1 || hb.y1 < hu.y0 || hb.y0 > hu.y1) continue;
      hits.push({ i, cx: (Math.max(hb.x0, hu.x0) + Math.min(hb.x1, hu.x1)) / 2, cy: (Math.max(hb.y0, hu.y0) + Math.min(hb.y1, hu.y1)) / 2 });
    }
    for (const h of hits) {
      const a = this.f[h.i];
      this.resolveHit(a, this.f[1 - h.i], moves[h.i]!, a.x, h.cx, h.cy, false, false);
    }
  }

  private canBlock(d: Fighter, fromX: number, level: MoveDef['level']) {
    if (!(this.isNeutral(d) || d.state === 'blockstun')) return false;
    if (!d.grounded) return false;
    const away = Math.sign(d.x - fromX) || -d.facing;
    if (Math.sign(d.input.x) !== away) return false;
    const crouch = d.input.y < 0;
    if (level === 'low' && !crouch) return false;
    if (level === 'overhead' && crouch) return false;
    return true;
  }

  private resolveHit(a: Fighter, d: Fighter, mv: MoveDef, fromX: number, x: number, y: number, projectile: boolean, lastBeamHit: boolean) {
    const dir = Math.sign(d.x - fromX) || a.facing;
    const blocked = this.canBlock(d, fromX, mv.level);
    const stop = mv.strength === 'light' ? 7 : mv.strength === 'medium' ? 10 : mv.strength === 'heavy' ? 13 : 5;
    a.connected = true;
    a.moveHits++;
    a.lastHitFrame = a.mf;
    let dmg = 0;
    let counter = false;
    if (blocked) {
      d.state = 'blockstun';
      d.sf = 0;
      d.stun = mv.blockstun;
      d.crouching = d.input.y < 0;
      d.vx = dir * mv.push * 0.75;
      dmg = mv.chip ?? 0;
      if (dmg) d.hp = Math.max(mv.id === 'super' && !this.training ? 0 : 1, d.hp - dmg);
      if (!projectile) a.hitstop = Math.round(stop * 0.6);
      d.hitstop = Math.round(stop * 0.6);
      d.meter = Math.min(METER_MAX, d.meter + 3);
      a.meter = Math.min(METER_MAX, a.meter + 2);
    } else {
      counter = d.state === 'attack' && !!d.move && d.mf < d.move.startup + d.move.active;
      const scale = Math.max(0.3, 1 - 0.1 * d.comboHits);
      dmg = Math.round(mv.damage * a.def.power * scale * (counter ? 1.2 : 1));
      d.hp = Math.max(0, d.hp - dmg);
      if (this.training) d.hp = Math.max(1, d.hp);
      d.comboHits++;
      d.comboDmg += dmg;
      d.counterHit = counter;
      d.hitFlash++;
      a.meter = Math.min(METER_MAX, a.meter + dmg * 0.11 + 2);
      d.meter = Math.min(METER_MAX, d.meter + dmg * 0.05);
      const airborne = !d.grounded || d.state === 'juggle';
      d.move = null;
      if (d.hp <= 0) {
        d.state = 'ko';
        d.sf = 0;
        d.vy = 9.5;
        d.vx = dir * 5.5;
        d.y = Math.max(d.y, 0.001);
        d.bounced = false;
      } else if (mv.onHit !== 'stun' || airborne || lastBeamHit) {
        d.state = 'juggle';
        d.sf = 0;
        d.juggle++;
        let lift = lastBeamHit ? 7 : mv.lift ?? 4.5;
        if (airborne && mv.onHit === 'stun') lift = 5;
        if (d.juggle > 5) lift = Math.min(lift, 2.5);
        d.vy = lift;
        d.y = Math.max(d.y, 0.001);
        d.vx = dir * (lastBeamHit ? 8 : mv.push * (airborne ? 0.6 : 0.8));
        d.bounced = mv.onHit !== 'knockdown' || d.juggle > 2;
        d.crouching = false;
      } else {
        d.state = 'hitstun';
        d.sf = 0;
        d.stun = mv.hitstun;
        d.vx = dir * mv.push;
        d.lowHit = mv.level === 'low' || d.crouching;
      }
      d.hitstop = stop;
      if (!projectile) a.hitstop = stop;
      // Cornered defender: attacker takes the pushback instead.
      if (Math.abs(d.x) > STAGE_HALF - 0.35 && Math.sign(d.x) === dir && !projectile) a.vx -= dir * mv.push * 0.6;
    }
    this.events.push({ t: 'hit', att: a.idx, def: d.idx, x, y, strength: mv.strength, blocked, dmg, move: mv.id, counter, projectile });
  }

  private spawnProjectile(f: Fighter) {
    const p: Projectile = {
      id: projectileIds++, owner: f.idx, x: f.x + f.facing * 0.7, y: f.y + 1.3, px: 0,
      vx: f.facing * f.def.projSpeed, life: 150, dead: false,
    };
    p.px = p.x;
    f.projectileOut = true;
    this.projectiles.push(p);
    this.events.push({ t: 'projectile', who: f.idx, id: p.id });
  }

  private updateProjectiles() {
    const list = this.projectiles;
    for (const p of list) {
      p.x += p.vx * DT;
      p.life--;
      if (p.life <= 0 || Math.abs(p.x) > STAGE_HALF + 3) p.dead = true;
    }
    // Clash.
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j];
        if (a.dead || b.dead || a.owner === b.owner) continue;
        if (Math.abs(a.x - b.x) < 0.6) {
          a.dead = b.dead = true;
          this.events.push({ t: 'clash', x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
        }
      }
    }
    for (const p of list) {
      if (p.dead) continue;
      const d = this.f[1 - p.owner];
      const hu = this.hurtbox(d);
      if (!hu) continue;
      if (p.x + 0.28 < hu.x0 || p.x - 0.28 > hu.x1 || p.y + 0.28 < hu.y0 || p.y - 0.28 > hu.y1) continue;
      p.dead = true;
      const a = this.f[p.owner];
      this.resolveHit(a, d, MOVES.orb, p.x - Math.sign(p.vx), (p.x + d.x) / 2, p.y, true, false);
    }
    for (let i = list.length - 1; i >= 0; i--) {
      const p = list[i];
      if (!p.dead) continue;
      this.f[p.owner].projectileOut = false;
      this.events.push({ t: 'projectileEnd', id: p.id, x: p.x, y: p.y });
      list.splice(i, 1);
    }
  }

  private spawnBeam(f: Fighter) {
    this.beam = { owner: f.idx, frame: 0, duration: MOVES.super.active, hits: 0, x0: f.x + f.facing * 0.55, dir: f.facing, y: f.y + 1.25 };
    this.events.push({ t: 'beamStart', who: f.idx });
  }

  private updateBeam() {
    const bm = this.beam;
    if (!bm) return;
    const owner = this.f[bm.owner];
    if (owner.state !== 'attack' || owner.move?.id !== 'super' || owner.hitstop > 0) {
      if (owner.state !== 'attack' || owner.move?.id !== 'super') this.endBeam();
      return;
    }
    bm.frame++;
    bm.x0 = owner.x + owner.facing * 0.55;
    // Beams erase projectiles.
    for (const p of this.projectiles) {
      if (p.owner !== bm.owner && Math.sign(p.x - bm.x0) === bm.dir && Math.abs(p.y - bm.y) < 0.7) p.dead = true;
    }
    const mv = MOVES.super;
    if (bm.hits < (mv.hits ?? 1) && bm.frame % (mv.hitInterval ?? 7) === 1) {
      const d = this.f[1 - bm.owner];
      const hu = this.hurtbox(d);
      const y0 = bm.y - 0.55, y1 = bm.y + 0.55;
      const inFront = Math.sign(d.x - bm.x0) === bm.dir || Math.abs(d.x - bm.x0) < 0.4;
      if (hu && inFront && hu.y1 > y0 && hu.y0 < y1) {
        bm.hits++;
        const last = bm.hits === (mv.hits ?? 1);
        this.resolveHit(owner, d, mv, owner.x, d.x - bm.dir * 0.3, Math.min(Math.max(bm.y, hu.y0 + 0.2), hu.y1 - 0.1), true, last);
      }
    }
    if (bm.frame >= bm.duration) this.endBeam();
  }

  private endBeam() {
    if (!this.beam) return;
    this.events.push({ t: 'beamEnd', who: this.beam.owner });
    this.beam = null;
  }
}

export function boxAt(f: Fighter, b: Box) {
  const cx = f.x + f.facing * b.x;
  const cy = f.y + b.y;
  return { x0: cx - b.w / 2, x1: cx + b.w / 2, y0: cy - b.h / 2, y1: cy + b.h / 2 };
}
