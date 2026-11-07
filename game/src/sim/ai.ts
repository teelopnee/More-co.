// CPU opponent. It drives the same InputFrame interface a human does.
import { SUPER_COST, type Fight, type Fighter, type InputFrame } from './fight';

export type Difficulty = 'easy' | 'normal' | 'hard';

interface Tuning {
  react: number;
  block: number;
  antiAir: number;
  aggression: number;
  combo: number;
  superUse: number;
}

const TUNING: Record<Difficulty, Tuning> = {
  easy: { react: 26, block: 0.18, antiAir: 0.12, aggression: 0.45, combo: 0.25, superUse: 0.25 },
  normal: { react: 15, block: 0.5, antiAir: 0.45, aggression: 0.65, combo: 0.6, superUse: 0.6 },
  hard: { react: 7, block: 0.86, antiAir: 0.82, aggression: 0.8, combo: 0.95, superUse: 0.95 },
};

type Btn = 'p' | 'k' | 's' | 'u';
interface Step {
  /** Horizontal hold, relative to the opponent (1 toward, -1 away). */
  rx: number;
  y: number;
  press?: Btn;
  frames: number;
}

export class CpuController {
  private plan: Step[] = [];
  private cooldown = 0;
  private blocking = 0;
  private readonly t: Tuning;
  /** Training dummy: stands still. */
  dummy = false;

  constructor(readonly idx: number, difficulty: Difficulty, private readonly rnd: () => number = Math.random) {
    this.t = TUNING[difficulty];
  }

  reset() {
    this.plan.length = 0;
    this.cooldown = 30;
    this.blocking = 0;
  }

  next(fight: Fight): InputFrame {
    const me = fight.f[this.idx];
    const op = fight.f[1 - this.idx];
    const toward = Math.sign(op.x - me.x) || me.facing;
    const out = (rx: number, y: number, press?: Btn): InputFrame => ({
      x: rx * toward, y, p: press === 'p', k: press === 'k', s: press === 's', u: press === 'u',
    });
    if (!fight.controllable || this.dummy) { this.plan.length = 0; return out(0, 0); }

    // Defence first: it interrupts plans that have not started an attack.
    const neutral = me.state === 'idle' || me.state === 'walk' || me.state === 'crouch' || me.state === 'guard' || me.state === 'blockstun';
    if (neutral) {
      const danger = this.danger(fight, me, op);
      if (danger && this.blocking === 0 && this.rnd() < this.t.block) this.blocking = 12 + Math.floor(this.rnd() * 14);
      if (this.blocking > 0) {
        this.blocking--;
        this.plan.length = 0;
        const low = op.move?.level === 'low' || !!op.move?.crouch;
        const crouch = low ? -1 : op.move?.level === 'overhead' ? 0 : (this.rnd() < 0.15 ? -1 : 0);
        if (danger === 'projectile' && Math.abs(op.x - me.x) > 3.4 && this.rnd() < this.t.antiAir * 0.08) {
          this.blocking = 0;
          this.plan = [{ rx: 1, y: 1, frames: 6 }, { rx: 1, y: 0, frames: 14 }, { rx: 0, y: 0, press: 'k', frames: 20 }];
        } else {
          return out(-1, crouch);
        }
      }
    }

    if (this.plan.length) return this.runPlan(out);
    if (this.cooldown > 0) { this.cooldown--; return out(0, 0); }
    this.decide(me, op);
    return this.plan.length ? this.runPlan(out) : out(0, 0);
  }

  private runPlan(out: (rx: number, y: number, press?: Btn) => InputFrame): InputFrame {
    const s = this.plan[0];
    const frame = out(s.rx, s.y, s.press);
    s.press = undefined;
    s.frames--;
    if (s.frames <= 0) this.plan.shift();
    return frame;
  }

  private danger(fight: Fight, me: Fighter, op: Fighter): 'melee' | 'projectile' | 'beam' | null {
    const dx = Math.abs(op.x - me.x);
    if (fight.beam && fight.beam.owner === op.idx) return 'beam';
    if (op.state === 'attack' && op.move && dx < 2.4 && op.move.id !== 'orb') return 'melee';
    for (const p of fight.projectiles) {
      if (p.owner === op.idx && Math.sign(p.vx) === Math.sign(me.x - p.x) && Math.abs(p.x - me.x) < 3.8) return 'projectile';
    }
    if (op.state === 'air' && dx < 2.2 && op.y > 0.5) return 'melee';
    return null;
  }

  private decide(me: Fighter, op: Fighter) {
    const t = this.t;
    const r = this.rnd;
    const dist = Math.abs(op.x - me.x);
    const neutral = me.state === 'idle' || me.state === 'walk' || me.state === 'crouch' || me.state === 'guard';
    this.cooldown = Math.floor(t.react * (0.6 + r() * 0.8));
    if (!neutral) return;

    // Super when the opponent is stuck or far and careless.
    if (me.meter >= SUPER_COST && (op.state === 'hitstun' || op.state === 'land' || (dist > 3 && r() < 0.04)) && r() < t.superUse) {
      this.plan = [{ rx: 0, y: 0, press: 'u', frames: 30 }];
      return;
    }
    // Anti-air.
    if ((op.state === 'air' || (op.state === 'attack' && op.move?.air)) && dist < 2.8 && Math.sign(op.vx) === Math.sign(me.x - op.x || 1)) {
      if (r() < t.antiAir) {
        this.plan = [{ rx: 0, y: -1, press: r() < 0.55 ? 's' : 'p', frames: 26 }];
        return;
      }
    }
    // Punish recovery.
    if (op.state === 'attack' && op.move && op.mf > op.move.startup + op.move.active && dist < 1.7 && r() < t.combo) {
      this.plan = this.combo(me);
      return;
    }
    if (op.state === 'down' || op.state === 'getup') {
      // Meaty pressure or back off.
      this.plan = r() < 0.5 ? [{ rx: 1, y: 0, frames: 18 }] : [{ rx: -1, y: 0, frames: 14 }];
      return;
    }

    const aggr = t.aggression;
    if (dist > 4.6) {
      const roll = r();
      if (roll < 0.32 && !me.projectileOut) this.plan = [{ rx: 0, y: 0, press: 's', frames: 42 }];
      else if (roll < 0.32 + 0.4 * aggr) this.plan = [{ rx: 1, y: 0, frames: 20 + Math.floor(r() * 24) }];
      else if (roll < 0.85) this.plan = [{ rx: 1, y: 0, frames: 2 }, { rx: 0, y: 0, frames: 2 }, { rx: 1, y: 0, frames: 2 }, { rx: 1, y: 0, frames: 18 }];
      else this.plan = [{ rx: 0, y: 0, frames: 20 }];
    } else if (dist > 1.9) {
      const roll = r();
      if (roll < 0.42 * aggr) this.plan = [{ rx: 1, y: 0, frames: 10 + Math.floor(r() * 16) }];
      else if (roll < 0.42 * aggr + 0.12) this.plan = [{ rx: 1, y: 1, frames: 8 }, { rx: 1, y: 0, frames: 16 }, { rx: 1, y: 0, press: 'k', frames: 18 }, ...this.combo(me).slice(0, 2)];
      else if (roll < 0.42 * aggr + 0.22) this.plan = [{ rx: 1, y: 0, press: 's', frames: 46 }];
      else if (roll < 0.42 * aggr + 0.32 && !me.projectileOut) this.plan = [{ rx: 0, y: 0, press: 's', frames: 42 }];
      else if (roll < 0.42 * aggr + 0.4) this.plan = [{ rx: 1, y: 0, press: 'k', frames: 34 }];
      else this.plan = [{ rx: -1, y: 0, frames: 10 + Math.floor(r() * 10) }];
    } else {
      const roll = r();
      if (roll < 0.62 * aggr + 0.15) this.plan = this.combo(me);
      else if (roll < 0.8) this.plan = [{ rx: -1, y: r() < 0.4 ? -1 : 0, frames: 16 }];
      else if (roll < 0.9) this.plan = [{ rx: -1, y: 0, frames: 2 }, { rx: 0, y: 0, frames: 2 }, { rx: -1, y: 0, frames: 22 }];
      else this.plan = [{ rx: 0, y: 1, frames: 30 }];
    }
  }

  private combo(me: Fighter): Step[] {
    const r = this.rnd;
    const skilled = r() < this.t.combo;
    const finisher: Step = me.meter >= SUPER_COST && skilled && r() < this.t.superUse * 0.6
      ? { rx: 0, y: 0, press: 'u', frames: 40 }
      : r() < 0.5 ? { rx: 1, y: 0, press: 's', frames: 44 } : { rx: 0, y: -1, press: 's', frames: 50 };
    const options: Step[][] = [
      [{ rx: 0, y: 0, press: 'p', frames: 8 }, { rx: 0, y: 0, press: 'p', frames: 9 }, { rx: 0, y: 0, press: 'p', frames: 24 }],
      [{ rx: 0, y: 0, press: 'p', frames: 8 }, { rx: 0, y: 0, press: 'p', frames: 9 }, { rx: 0, y: 0, press: 'k', frames: 30 }],
      [{ rx: 0, y: 0, press: 'k', frames: 11 }, { rx: 0, y: 0, press: 'k', frames: 30 }],
      [{ rx: 0, y: -1, press: 'k', frames: 30 }],
      [{ rx: 0, y: -1, press: 'p', frames: 14 }, finisher],
      [{ rx: 1, y: 0, press: 'p', frames: 14 }, finisher],
      [{ rx: 0, y: 0, press: 'p', frames: 8 }, { rx: 0, y: 0, press: 'p', frames: 10 }, finisher],
    ];
    const pick = skilled ? options[Math.floor(r() * options.length)] : options[Math.floor(r() * 4)];
    return pick.map((s) => ({ ...s }));
  }
}
