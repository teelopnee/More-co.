import { describe, expect, it } from 'vitest';
import { Fight, NEUTRAL, type InputFrame } from '../../game/src/sim/fight';
import { CpuController } from '../../game/src/sim/ai';

const press = (over: Partial<InputFrame>): InputFrame => ({ ...NEUTRAL, ...over });

function run(fight: Fight, frames: number, inputs: (f: number) => [InputFrame, InputFrame]) {
  const events = [];
  for (let i = 0; i < frames; i++) {
    fight.step(inputs(i));
    events.push(...fight.events);
  }
  return events;
}

describe('fight simulation', () => {
  it('walks the intro into a live round', () => {
    const fight = new Fight('vayu', 'phloeng');
    expect(fight.phase).toBe('intro');
    run(fight, 260, () => [NEUTRAL, NEUTRAL]);
    expect(fight.phase).toBe('fight');
    expect(fight.timer).toBeLessThan(99 * 60);
  });

  it('lands a jab at close range and damages the opponent', () => {
    const fight = new Fight('vayu', 'chantra', { skipIntro: true });
    fight.f[0].x = -0.4; fight.f[1].x = 0.4;
    const events = run(fight, 30, (i) => [press({ p: i === 0 }), NEUTRAL]);
    const hit = events.find((e) => e.t === 'hit');
    expect(hit).toBeTruthy();
    expect(fight.f[1].hp).toBeLessThan(fight.f[1].maxHp);
  });

  it('blocks when holding away from the attacker', () => {
    const fight = new Fight('vayu', 'chantra', { skipIntro: true });
    fight.f[0].x = -0.4; fight.f[1].x = 0.4;
    const events = run(fight, 30, (i) => [press({ p: i === 0 }), press({ x: 1 })]);
    const hit = events.find((e) => e.t === 'hit');
    expect(hit && hit.t === 'hit' && hit.blocked).toBe(true);
    expect(fight.f[1].hp).toBe(fight.f[1].maxHp);
  });

  it('chains jab into cross and builds a combo', () => {
    const fight = new Fight('phloeng', 'vayu', { skipIntro: true });
    fight.f[0].x = -0.4; fight.f[1].x = 0.4;
    const events = run(fight, 90, (i) => [press({ p: i === 0 || i === 9 || i === 20 }), NEUTRAL]);
    const hits = events.filter((e) => e.t === 'hit');
    expect(hits.length).toBeGreaterThanOrEqual(2);
    const combo = events.find((e) => e.t === 'combo');
    expect(combo && combo.t === 'combo' && combo.hits).toBeGreaterThanOrEqual(2);
  });

  it('fires a projectile that travels and hits', () => {
    const fight = new Fight('chantra', 'vayu', { skipIntro: true });
    const events = run(fight, 90, (i) => [press({ s: i === 0 }), NEUTRAL]);
    expect(events.some((e) => e.t === 'projectile')).toBe(true);
    expect(events.some((e) => e.t === 'hit' && e.projectile)).toBe(true);
  });

  it('spends meter on a super that multi-hits', () => {
    const fight = new Fight('vayu', 'phloeng', { skipIntro: true });
    fight.f[0].meter = 100;
    const events = run(fight, 200, (i) => [press({ u: i === 0 }), NEUTRAL]);
    expect(events.some((e) => e.t === 'superStart')).toBe(true);
    expect(events.filter((e) => e.t === 'hit').length).toBeGreaterThanOrEqual(8);
    expect(fight.f[0].meter).toBeLessThan(100);
  });

  it('CPU vs CPU finishes a match', () => {
    const fight = new Fight('vayu', 'phloeng', { roundSeconds: 40 });
    const a = new CpuController(0, 'hard');
    const b = new CpuController(1, 'normal');
    let n = 0;
    while (fight.phase !== 'matchEnd' && n < 60 * 60 * 8) {
      fight.step([a.next(fight), b.next(fight)]);
      n++;
    }
    expect(fight.phase).toBe('matchEnd');
    expect(Math.max(fight.f[0].wins, fight.f[1].wins)).toBeGreaterThanOrEqual(2);
  });
});
