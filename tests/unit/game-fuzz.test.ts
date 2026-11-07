import { describe, expect, it } from 'vitest';
import { Fight, METER_MAX, STAGE_HALF, type InputFrame } from '../../game/src/sim/fight';
import { CpuController } from '../../game/src/sim/ai';
import { ROSTER } from '../../game/src/data/characters';

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

function randomInput(r: () => number, prev: InputFrame): InputFrame {
  // Hold directions for a while like a person would, mash buttons now and then.
  const keep = r() < 0.85;
  return {
    x: keep ? prev.x : [-1, 0, 1][Math.floor(r() * 3)],
    y: keep ? prev.y : r() < 0.7 ? 0 : r() < 0.5 ? 1 : -1,
    p: r() < 0.08, k: r() < 0.06, s: r() < 0.04, u: r() < 0.02,
  };
}

const LIMIT: Partial<Record<string, number>> = { attack: 400, hitstun: 120, blockstun: 120, juggle: 600, down: 120, getup: 60, prejump: 10, land: 30, dash: 30 };

function check(fight: Fight, frame: number) {
  for (const f of fight.f) {
    const bad = (why: string) => { throw new Error(`frame ${frame} p${f.idx} ${f.state}${f.move ? ':' + f.move.id : ''}: ${why}`); };
    for (const v of [f.x, f.y, f.vx, f.vy, f.hp, f.meter]) if (!Number.isFinite(v)) bad('non-finite value');
    if (Math.abs(f.x) > STAGE_HALF + 1e-6) bad(`outside the stage x=${f.x}`);
    if (f.y < 0 || f.y > 8) bad(`bad height y=${f.y}`);
    if (f.hp < 0 || f.hp > f.maxHp) bad(`hp out of range ${f.hp}`);
    if (f.meter < 0 || f.meter > METER_MAX) bad(`meter out of range ${f.meter}`);
    if (f.state === 'attack' && !f.move) bad('attacking without a move');
    const lim = LIMIT[f.state];
    if (lim && f.sf > lim) bad(`stuck for ${f.sf} frames`);
  }
}

describe('fight simulation fuzz', () => {
  it('survives random button mashing on both sides', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const r = rng(seed);
      const a = ROSTER[seed % 3], b = ROSTER[(seed + 1) % 3];
      const fight = new Fight(a, b, { roundSeconds: 30 });
      let i0: InputFrame = { x: 0, y: 0, p: false, k: false, s: false, u: false };
      let i1 = i0;
      let n = 0;
      while (fight.phase !== 'matchEnd' && n < 60 * 60 * 4) {
        i0 = randomInput(r, i0);
        i1 = randomInput(r, i1);
        if (n % 300 === 0) { fight.f[0].meter = 100; fight.f[1].meter = 100; }
        fight.step([i0, i1]);
        check(fight, n);
        n++;
      }
      expect(fight.phase, `seed ${seed}`).toBe('matchEnd');
    }
  }, 120_000);

  it('CPU matches always finish, at every difficulty', () => {
    for (const d of ['easy', 'normal', 'hard'] as const) {
      for (let seed = 0; seed < 4; seed++) {
        const r = rng(seed + 100);
        const fight = new Fight(ROSTER[seed % 3], ROSTER[(seed + 2) % 3], { roundSeconds: 40 });
        const c0 = new CpuController(0, d, r), c1 = new CpuController(1, 'hard', r);
        let n = 0;
        while (fight.phase !== 'matchEnd' && n < 60 * 60 * 6) {
          fight.step([c0.next(fight), c1.next(fight)]);
          check(fight, n);
          n++;
        }
        expect(fight.phase).toBe('matchEnd');
      }
    }
  }, 120_000);

  it('training never ends in a KO', () => {
    const r = rng(7);
    const fight = new Fight('vayu', 'phloeng', { training: true });
    let i0: InputFrame = { x: 0, y: 0, p: false, k: false, s: false, u: false };
    for (let n = 0; n < 60 * 120; n++) {
      i0 = randomInput(r, i0);
      fight.step([i0, { x: 1, y: n % 200 < 100 ? -1 : 0, p: false, k: false, s: false, u: false }]);
      expect(fight.phase).toBe('fight');
      expect(fight.f[1].hp).toBeGreaterThan(0);
    }
  });
});
