// Gamepad reading, kept free of browser globals so it can be unit-tested.
//
// What it guards against:
// - Several pads mapped to one player (a controller listed twice, Steam's virtual pad, a headset
//   that reports as a gamepad): their states are OR-merged, so an idle pad never cancels a held one.
// - Phantom devices with stuck axes: a pad only counts once a button is pressed or a stick moves
//   away from where it rested when first seen.
// - Analogue noise: the stick is read as 8 directions with a radial dead zone and hysteresis, so a
//   thumb resting near a boundary does not flicker (which used to trigger dashes and jumps).
import type { Action, MenuAction } from './input';

export interface PadButton { pressed: boolean; value?: number }
export interface PadSnapshot {
  index: number;
  connected: boolean;
  mapping: string;
  axes: readonly number[];
  buttons: readonly (PadButton | null | undefined)[];
}

export interface Dir { x: number; y: number }

const ACTIONS: Action[] = ['left', 'right', 'up', 'down', 'p', 'k', 's', 'u'];
const MENU: MenuAction[] = ['up', 'down', 'left', 'right', 'ok', 'back', 'pause'];
const REPEATS: Partial<Record<MenuAction, true>> = { up: true, down: true, left: true, right: true };

/** 8-way sectors as [centre angle, half width] in degrees (0 = right, 90 = up). Up diagonals are narrow so holding back never jumps by accident. */
const SECTORS: [Dir, number, number][] = [
  [{ x: 1, y: 0 }, 0, 30], [{ x: 1, y: 1 }, 47.5, 17.5], [{ x: 0, y: 1 }, 90, 25], [{ x: -1, y: 1 }, 132.5, 17.5],
  [{ x: -1, y: 0 }, 180, 30], [{ x: -1, y: -1 }, -132.5, 17.5], [{ x: 0, y: -1 }, -90, 25], [{ x: 1, y: -1 }, -47.5, 17.5],
];

const angDist = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

const DEAD_ENTER = 0.45;
const DEAD_EXIT = 0.3;
const STICKY_DEG = 10;

/** Reads a stick as one of 8 directions, holding the previous one near sector borders. */
export function stickDir(ax: number, ay: number, prev: Dir): Dir {
  const engaged = prev.x !== 0 || prev.y !== 0;
  const mag = Math.hypot(ax, ay);
  if (mag < (engaged ? DEAD_EXIT : DEAD_ENTER)) return { x: 0, y: 0 };
  const deg = (Math.atan2(-ay, ax) * 180) / Math.PI;
  if (engaged) {
    const cur = SECTORS.find(([d]) => d.x === prev.x && d.y === prev.y);
    if (cur && angDist(deg, cur[1]) <= cur[2] + STICKY_DEG) return prev;
  }
  let best = SECTORS[0];
  for (const s of SECTORS) if (angDist(deg, s[1]) <= s[2]) { best = s; break; }
  return { ...best[0] };
}

interface PadInfo {
  index: number;
  rest: number[];
  active: boolean;
  order: number;
  stick: Dir;
  held: Record<Action, boolean>;
  menuSince: Record<MenuAction, number>;
  menuNext: Record<MenuAction, number>;
}

const none = (): Record<Action, boolean> => ({ left: false, right: false, up: false, down: false, p: false, k: false, s: false, u: false });

export interface PadFrame {
  held: [Record<Action, boolean>, Record<Action, boolean>];
  pressed: [Action[], Action[]];
  menu: { action: MenuAction; player: number }[];
  /** A pad produced input this poll. */
  used: boolean;
}

export class PadTracker {
  /** 'single': every pad drives player 1. 'versus': two pads by first use; a lone pad is player 2. */
  mode: 'single' | 'versus' = 'single';
  private readonly pads = new Map<number, PadInfo>();
  private counter = 0;

  /** Which player a pad currently controls, or -1. */
  playerOf(index: number): number {
    const info = this.pads.get(index);
    if (!info?.active) return -1;
    if (this.mode === 'single') return 0;
    const actives = [...this.pads.values()].filter((p) => p.active).sort((a, b) => a.order - b.order);
    const pos = actives.indexOf(info);
    if (pos < 0 || pos > 1) return -1;
    return actives.length === 1 ? 1 : pos;
  }

  get activeCount() {
    let n = 0;
    for (const p of this.pads.values()) if (p.active) n++;
    return n;
  }

  read(list: readonly (PadSnapshot | null | undefined)[], now: number): PadFrame {
    const out: PadFrame = { held: [none(), none()], pressed: [[], []], menu: [], used: false };
    const seen = new Set<number>();
    for (const gp of list) {
      if (!gp || !gp.connected) continue;
      seen.add(gp.index);
      let info = this.pads.get(gp.index);
      if (!info) {
        info = {
          index: gp.index, rest: gp.axes.slice(0, 8).map((v) => v ?? 0), active: false, order: 0, stick: { x: 0, y: 0 }, held: none(),
          menuSince: Object.fromEntries(MENU.map((m) => [m, -1])) as Record<MenuAction, number>,
          menuNext: Object.fromEntries(MENU.map((m) => [m, 0])) as Record<MenuAction, number>,
        };
        this.pads.set(gp.index, info);
      }
      const btn = (i: number) => !!gp.buttons[i]?.pressed;
      const axis = (i: number) => gp.axes[i] ?? 0;
      if (!info.active) {
        const anyButton = gp.buttons.some((b) => b?.pressed);
        const moved = [0, 1].some((k) => Math.abs(axis(k) - (info!.rest[k] ?? 0)) > 0.5);
        if (!anyButton && !moved) continue;
        info.active = true;
        info.order = ++this.counter;
      }
      const player = this.playerOf(gp.index);
      if (player < 0) continue;

      // D-pad wins over the stick when pressed.
      let dx = (btn(15) ? 1 : 0) - (btn(14) ? 1 : 0);
      let dy = (btn(12) ? 1 : 0) - (btn(13) ? 1 : 0);
      if (gp.mapping !== 'standard' && dx === 0 && dy === 0 && gp.axes.length > 7) {
        // Many generic pads report the d-pad on axes 6/7.
        const hx = axis(6) - (info.rest[6] ?? 0), hy = axis(7) - (info.rest[7] ?? 0);
        if (Math.abs(hx) > 0.5) dx = Math.sign(hx);
        if (Math.abs(hy) > 0.5) dy = -Math.sign(hy);
      }
      info.stick = stickDir(axis(0), axis(1), info.stick);
      if (dx === 0 && dy === 0) { dx = info.stick.x; dy = info.stick.y; }

      const held: Record<Action, boolean> = {
        left: dx < 0, right: dx > 0, up: dy > 0, down: dy < 0,
        p: btn(2), k: btn(0), s: btn(1), u: btn(3) || btn(5) || btn(7),
      };
      for (const a of ACTIONS) {
        if (held[a] && !info.held[a]) { out.pressed[player].push(a); out.used = true; }
        if (held[a]) out.held[player][a] = true;
      }
      info.held = held;

      const menu: Record<MenuAction, boolean> = {
        up: dy > 0, down: dy < 0, left: dx < 0, right: dx > 0, ok: btn(0), back: btn(1) || btn(8), pause: btn(9),
      };
      for (const m of MENU) {
        if (!menu[m]) { info.menuSince[m] = -1; continue; }
        if (info.menuSince[m] < 0) {
          info.menuSince[m] = now;
          info.menuNext[m] = now + 0.38;
          out.menu.push({ action: m, player });
          out.used = true;
        } else if (REPEATS[m] && now >= info.menuNext[m]) {
          info.menuNext[m] = now + 0.11;
          out.menu.push({ action: m, player });
        }
      }
    }
    for (const idx of [...this.pads.keys()]) if (!seen.has(idx)) this.pads.delete(idx);
    return out;
  }
}
