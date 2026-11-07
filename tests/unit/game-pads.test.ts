import { describe, expect, it } from 'vitest';
import { PadTracker, stickDir, type PadSnapshot } from '../../game/src/input/pads';

function pad(index: number, opts: { axes?: number[]; buttons?: number[]; mapping?: string } = {}): PadSnapshot {
  const pressed = new Set(opts.buttons ?? []);
  return {
    index, connected: true, mapping: opts.mapping ?? 'standard',
    axes: opts.axes ?? [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.has(i), value: pressed.has(i) ? 1 : 0 })),
  };
}

describe('gamepad reading', () => {
  it('an idle second pad does not cancel what the real pad holds', () => {
    const t = new PadTracker();
    t.read([pad(0), pad(1)], 0);
    for (let i = 1; i <= 20; i++) {
      const f = t.read([pad(0, { axes: [1, 0], buttons: [0] }), pad(1)], i / 60);
      expect(f.held[0].right).toBe(true);
      expect(f.held[0].k).toBe(true);
    }
  });

  it('a phantom device with a stuck axis never drives a player', () => {
    const t = new PadTracker();
    for (let i = 0; i < 30; i++) {
      const f = t.read([pad(0, { axes: [-1, -1, -1, -1] })], i / 60);
      expect(f.held[0].left || f.held[0].up).toBe(false);
    }
    expect(t.activeCount).toBe(0);
  });

  it('stick noise around the threshold does not produce repeated presses', () => {
    const t = new PadTracker();
    t.read([pad(0, { buttons: [9] })], 0);
    t.read([pad(0)], 0.01);
    let presses = 0;
    for (let i = 0; i < 120; i++) {
      const x = 0.45 + Math.sin(i * 1.7) * 0.08; // jittering between 0.37 and 0.53
      const f = t.read([pad(0, { axes: [x, 0] })], 0.02 + i / 60);
      presses += f.pressed[0].filter((a) => a === 'right').length;
    }
    expect(presses).toBe(1);
  });

  it('holding back with the stick tilted a little upward blocks instead of jumping', () => {
    const tilt = (deg: number) => [Math.cos((deg * Math.PI) / 180), -Math.sin((deg * Math.PI) / 180)];
    for (const deg of [150, 160, 170, 180, 200, 210]) {
      const [ax, ay] = tilt(deg);
      expect(stickDir(ax, ay, { x: 0, y: 0 }), `${deg}°`).toEqual({ x: -1, y: 0 });
    }
    expect(stickDir(...(tilt(135) as [number, number]), { x: 0, y: 0 })).toEqual({ x: -1, y: 1 });
    expect(stickDir(...(tilt(-90) as [number, number]), { x: 0, y: 0 })).toEqual({ x: 0, y: -1 });
  });

  it('the d-pad works and beats the stick', () => {
    const t = new PadTracker();
    const f = t.read([pad(0, { axes: [1, 0], buttons: [14] })], 0);
    expect(f.held[0].left).toBe(true);
    expect(f.held[0].right).toBe(false);
  });

  it('generic pads report the d-pad on axes 6/7', () => {
    const t = new PadTracker();
    t.read([pad(0, { mapping: '', axes: [0, 0, 0, 0, 0, 0, 0, 0], buttons: [1] })], 0);
    const f = t.read([pad(0, { mapping: '', axes: [0, 0, 0, 0, 0, 0, 0, 1] })], 0.1);
    expect(f.held[0].down).toBe(true);
  });

  it('versus: a lone pad is player 2, two pads go by first use', () => {
    const t = new PadTracker();
    t.mode = 'versus';
    t.read([pad(3, { buttons: [0] })], 0);
    expect(t.playerOf(3)).toBe(1);
    t.read([pad(3), pad(5, { buttons: [0] })], 0.1);
    expect(t.playerOf(3)).toBe(0);
    expect(t.playerOf(5)).toBe(1);
    const f = t.read([pad(3, { buttons: [2] }), pad(5, { buttons: [1] })], 0.2);
    expect(f.held[0].p).toBe(true);
    expect(f.held[1].s).toBe(true);
    expect(f.held[0].s).toBe(false);
  });

  it('menu directions auto-repeat while held, buttons do not', () => {
    const t = new PadTracker();
    let downs = 0, oks = 0;
    for (let i = 0; i <= 60; i++) {
      const f = t.read([pad(0, { buttons: [13, 0] })], i / 60);
      downs += f.menu.filter((m) => m.action === 'down').length;
      oks += f.menu.filter((m) => m.action === 'ok').length;
    }
    expect(oks).toBe(1);
    expect(downs).toBeGreaterThanOrEqual(5);
    expect(downs).toBeLessThanOrEqual(8);
  });

  it('forgets a pad when it disconnects', () => {
    const t = new PadTracker();
    t.read([pad(0, { buttons: [0] })], 0);
    expect(t.playerOf(0)).toBe(0);
    t.read([], 0.1);
    expect(t.playerOf(0)).toBe(-1);
  });
});
