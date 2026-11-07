// Keyboard, gamepad and touch merged into per-player input frames.
import type { InputFrame } from '../sim/fight';

export type Action = 'left' | 'right' | 'up' | 'down' | 'p' | 'k' | 's' | 'u';
export type MenuAction = 'up' | 'down' | 'left' | 'right' | 'ok' | 'back' | 'pause';

const P1_KEYS: Record<string, Action> = {
  KeyA: 'left', KeyD: 'right', KeyW: 'up', KeyS: 'down',
  KeyJ: 'p', KeyK: 'k', KeyL: 's', KeyI: 'u', KeyU: 'u',
};
const P2_KEYS: Record<string, Action> = {
  ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down',
  Numpad1: 'p', Numpad2: 'k', Numpad3: 's', Numpad0: 'u', Numpad5: 'u',
  Comma: 'p', Period: 'k', Slash: 's', ShiftRight: 'u', Quote: 'u',
};
const MENU_KEYS: Record<string, MenuAction> = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', KeyW: 'up', KeyS: 'down', KeyA: 'left', KeyD: 'right',
  Enter: 'ok', Space: 'ok', KeyJ: 'ok', NumpadEnter: 'ok', Numpad1: 'ok', Comma: 'ok',
  Escape: 'pause', Backspace: 'back', KeyK: 'back', Numpad2: 'back', Period: 'back', KeyP: 'pause',
};
const MENU_PLAYER: Record<string, number> = {
  ArrowUp: 1, ArrowDown: 1, ArrowLeft: 1, ArrowRight: 1, Numpad1: 1, Numpad2: 1, Comma: 1, Period: 1, NumpadEnter: 1,
};

const ACTIONS: Action[] = ['left', 'right', 'up', 'down', 'p', 'k', 's', 'u'];

class Slot {
  held: Record<Action, number> = { left: 0, right: 0, up: 0, down: 0, p: 0, k: 0, s: 0, u: 0 };
  pad: Record<Action, boolean> = { left: false, right: false, up: false, down: false, p: false, k: false, s: false, u: false };
  touch: Record<Action, boolean> = { left: false, right: false, up: false, down: false, p: false, k: false, s: false, u: false };
  pressed = new Set<Action>();

  isHeld(a: Action) {
    return this.held[a] > 0 || this.pad[a] || this.touch[a];
  }
}

export class Input {
  readonly slots = [new Slot(), new Slot()];
  /** When true, P2 keys also drive P1 (single-player). */
  shareKeys = true;
  onMenu: ((a: MenuAction, player: number) => void) | null = null;
  onAny: (() => void) | null = null;
  private readonly padPrev: Record<number, boolean[]> = {};
  private readonly padMenuPrev: Record<number, boolean[]> = {};
  private gamepadsBlocked = false;
  lastDevice: 'keyboard' | 'pad' | 'touch' = 'keyboard';

  constructor() {
    window.addEventListener('keydown', (e) => this.key(e, true));
    window.addEventListener('keyup', (e) => this.key(e, false));
    window.addEventListener('blur', () => this.releaseAll());
  }

  private key(e: KeyboardEvent, down: boolean) {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    const code = e.code;
    const handled = code in P1_KEYS || code in P2_KEYS || code in MENU_KEYS;
    if (handled) e.preventDefault();
    if (down) { this.lastDevice = 'keyboard'; this.onAny?.(); }
    if (e.repeat) return;
    const apply = (slot: Slot, a: Action) => {
      if (down) { slot.held[a]++; slot.pressed.add(a); } else slot.held[a] = Math.max(0, slot.held[a] - 1);
    };
    const a1 = P1_KEYS[code];
    if (a1) apply(this.slots[0], a1);
    const a2 = P2_KEYS[code];
    if (a2) apply(this.shareKeys ? this.slots[0] : this.slots[1], a2);
    if (down) {
      const m = MENU_KEYS[code];
      if (m) this.onMenu?.(m, this.shareKeys ? 0 : MENU_PLAYER[code] ?? 0);
    }
  }

  releaseAll() {
    for (const s of this.slots) {
      for (const a of ACTIONS) { s.held[a] = 0; s.touch[a] = false; }
    }
  }

  setTouch(player: number, a: Action, on: boolean) {
    const s = this.slots[player];
    if (on && !s.touch[a]) s.pressed.add(a);
    s.touch[a] = on;
    this.lastDevice = 'touch';
  }

  /** Poll gamepads; call once per rendered frame. */
  poll() {
    if (this.gamepadsBlocked || !navigator.getGamepads) return;
    let pads: (Gamepad | null)[];
    try { pads = navigator.getGamepads(); } catch { this.gamepadsBlocked = true; return; }
    let idx = 0;
    for (const gp of pads) {
      if (!gp || !gp.connected) continue;
      const player = this.shareKeys ? 0 : Math.min(1, idx);
      idx++;
      const slot = this.slots[player];
      const b = (i: number) => !!gp.buttons[i]?.pressed;
      const ax = gp.axes[0] ?? 0, ay = gp.axes[1] ?? 0;
      const state: Record<Action, boolean> = {
        left: b(14) || ax < -0.45, right: b(15) || ax > 0.45, up: b(12) || ay < -0.55, down: b(13) || ay > 0.55,
        p: b(2), k: b(0), s: b(1), u: b(3) || b(5) || b(7),
      };
      const prev = this.padPrev[gp.index] ?? [];
      ACTIONS.forEach((a, i) => {
        if (state[a] && !prev[i]) { slot.pressed.add(a); this.lastDevice = 'pad'; this.onAny?.(); }
        slot.pad[a] = state[a];
      });
      // Menu events from the pad (edge-triggered).
      const menuMap: [boolean, MenuAction][] = [
        [state.up, 'up'], [state.down, 'down'], [state.left, 'left'], [state.right, 'right'],
        [b(0), 'ok'], [b(1), 'back'], [b(9), 'pause'],
      ];
      const mPrev = this.padMenuPrev[gp.index];
      menuMap.forEach(([v, m], i) => { if (v && !mPrev?.[i]) this.onMenu?.(m, player); });
      this.padMenuPrev[gp.index] = menuMap.map(([v]) => v);
      this.padPrev[gp.index] = ACTIONS.map((a) => state[a]);
    }
  }

  /** Consume one simulation step of input for a player. */
  frame(player: number): InputFrame {
    const s = this.slots[player];
    // A direction tapped and released between two steps still counts for this step.
    const on = (a: Action) => s.isHeld(a) || s.pressed.has(a);
    const x = (on('right') ? 1 : 0) - (on('left') ? 1 : 0);
    const y = (on('up') ? 1 : 0) - (on('down') ? 1 : 0);
    const f: InputFrame = { x, y, p: s.pressed.has('p'), k: s.pressed.has('k'), s: s.pressed.has('s'), u: s.pressed.has('u') };
    s.pressed.clear();
    return f;
  }

  clearPressed() {
    for (const s of this.slots) s.pressed.clear();
  }
}

/** On-screen stick and buttons for phones and tablets. */
export class TouchControls {
  readonly el: HTMLDivElement;
  private stickId = -1;
  private origin = { x: 0, y: 0 };
  private readonly knob: HTMLDivElement;
  private readonly base: HTMLDivElement;
  visible = false;

  constructor(private readonly input: Input, parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'touch';
    this.el.hidden = true;
    this.el.innerHTML = `
      <div class="stick-zone"><div class="stick-base"><div class="stick-knob"></div></div></div>
      <div class="btns">
        <button class="tb tb-p" data-a="p" aria-label="หมัด"><span>หมัด</span></button>
        <button class="tb tb-k" data-a="k" aria-label="เตะ"><span>เตะ</span></button>
        <button class="tb tb-s" data-a="s" aria-label="พลัง"><span>พลัง</span></button>
        <button class="tb tb-u" data-a="u" aria-label="ไม้ตาย"><span>ไม้ตาย</span></button>
      </div>`;
    parent.appendChild(this.el);
    this.base = this.el.querySelector('.stick-base')!;
    this.knob = this.el.querySelector('.stick-knob')!;
    const zone = this.el.querySelector('.stick-zone') as HTMLDivElement;
    zone.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.stickId = e.pointerId;
      zone.setPointerCapture(e.pointerId);
      const r = zone.getBoundingClientRect();
      this.origin = { x: e.clientX, y: e.clientY };
      this.base.style.left = `${e.clientX - r.left}px`;
      this.base.style.top = `${e.clientY - r.top}px`;
      this.base.classList.add('on');
      this.move(e.clientX, e.clientY);
    });
    zone.addEventListener('pointermove', (e) => { if (e.pointerId === this.stickId) this.move(e.clientX, e.clientY); });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== this.stickId) return;
      this.stickId = -1;
      this.base.classList.remove('on');
      this.knob.style.transform = '';
      for (const a of ['left', 'right', 'up', 'down'] as Action[]) this.input.setTouch(0, a, false);
    };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);
    for (const b of this.el.querySelectorAll<HTMLButtonElement>('.tb')) {
      const a = b.dataset.a as Action;
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); b.setPointerCapture(e.pointerId); b.classList.add('on'); this.input.setTouch(0, a, true); });
      const up = () => { b.classList.remove('on'); this.input.setTouch(0, a, false); };
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
      b.addEventListener('contextmenu', (e) => e.preventDefault());
    }
  }

  private move(x: number, y: number) {
    const dx = x - this.origin.x, dy = y - this.origin.y;
    const len = Math.hypot(dx, dy);
    const max = 46;
    const k = len > max ? max / len : 1;
    this.knob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
    const dead = 16;
    this.input.setTouch(0, 'left', dx < -dead);
    this.input.setTouch(0, 'right', dx > dead);
    this.input.setTouch(0, 'up', dy < -dead * 1.8);
    this.input.setTouch(0, 'down', dy > dead * 1.6);
  }

  show(on: boolean) {
    this.visible = on;
    this.el.hidden = !on;
  }
}
