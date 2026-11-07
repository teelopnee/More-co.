// Title, character select, settings, how-to-play, pause and results screens.
import { CHARACTERS, ROSTER, type CharId } from '../data/characters';
import type { MenuAction } from '../input/input';
import type { Difficulty } from '../sim/ai';
import type { QualityLevel } from '../render/quality';
import { QUALITY, QUALITY_ORDER } from '../render/quality';

export type Mode = 'cpu' | 'versus' | 'training';

export interface Settings {
  quality: 'auto' | QualityLevel;
  fps: boolean;
  music: number;
  sfx: number;
  difficulty: Difficulty;
  roundTime: number;
  effects: number;
  /** Lowest preset "auto" has needed on this device; later sessions start there. */
  autoCap: QualityLevel | null;
}

export const DEFAULT_SETTINGS: Settings = { quality: 'auto', fps: false, music: 0.6, sfx: 0.9, difficulty: 'normal', roundTime: 99, effects: 1, autoCap: null };

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

interface Item {
  label: string;
  hint?: string;
  run?: () => void;
  options?: { label: string; value: unknown }[];
  get?: () => unknown;
  set?: (v: unknown) => void;
}

/** A vertical list of buttons and option rows that works with keys, pads, mouse and touch. */
class ListMenu {
  readonly el: HTMLDivElement;
  private focus = 0;
  private buttons: HTMLButtonElement[] = [];

  constructor(private items: Item[], private readonly onMove: () => void) {
    this.el = document.createElement('div');
    this.el.className = 'list';
    this.render();
  }

  render() {
    this.el.innerHTML = '';
    this.buttons = this.items.map((it, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'item' + (it.options ? ' opt' : '');
      b.id = `item-${it.label.replace(/\s+/g, '-')}`;
      b.innerHTML = it.options
        ? `<span class="lbl">${it.label}</span><span class="val"><i class="arr">‹</i><b></b><i class="arr">›</i></span>`
        : `<span class="lbl">${it.label}</span>${it.hint ? `<span class="hint">${it.hint}</span>` : ''}`;
      b.addEventListener('pointerenter', () => this.setFocus(i, false));
      b.addEventListener('click', (e) => {
        this.setFocus(i, false);
        if (it.options) {
          const r = b.getBoundingClientRect();
          this.change(e.clientX < r.left + r.width * 0.55 && e.detail > 0 ? -1 : 1);
        } else it.run?.();
      });
      this.el.appendChild(b);
      return b;
    });
    this.refresh();
    this.setFocus(Math.min(this.focus, this.items.length - 1), false);
  }

  refresh() {
    this.items.forEach((it, i) => {
      if (!it.options) return;
      const cur = it.get?.();
      const o = it.options.find((x) => x.value === cur) ?? it.options[0];
      this.buttons[i].querySelector('b')!.textContent = o.label;
    });
  }

  setFocus(i: number, sound = true) {
    if (i !== this.focus && sound) this.onMove();
    this.focus = (i + this.items.length) % this.items.length;
    this.buttons.forEach((b, k) => b.classList.toggle('focus', k === this.focus));
  }

  private change(dir: number) {
    const it = this.items[this.focus];
    if (!it.options) return;
    const cur = it.get?.();
    let idx = it.options.findIndex((x) => x.value === cur);
    idx = (idx + dir + it.options.length) % it.options.length;
    it.set?.(it.options[idx].value);
    this.onMove();
    this.refresh();
  }

  key(a: MenuAction): boolean {
    if (a === 'up') { this.setFocus(this.focus - 1); return true; }
    if (a === 'down') { this.setFocus(this.focus + 1); return true; }
    const it = this.items[this.focus];
    if (a === 'left' || a === 'right') { if (it.options) this.change(a === 'left' ? -1 : 1); return true; }
    if (a === 'ok') { if (it.options) this.change(1); else it.run?.(); return true; }
    return false;
  }
}

export interface ScreenHooks {
  start(mode: Mode, p1: CharId, p2: CharId, difficulty: Difficulty): void;
  preview(p1: CharId, p2: CharId | null): void;
  settingsChanged(s: Settings): void;
  resume(): void;
  restart(): void;
  toSelect(): void;
  toTitle(): void;
  sound(kind: 'move' | 'ok' | 'back'): void;
  modeChanged(screen: string): void;
}

export class Screens {
  readonly root: HTMLDivElement;
  private current: { name: string; el: HTMLElement; key: (a: MenuAction, player: number) => void } | null = null;
  private selectMode: Mode = 'cpu';
  private selStep: 'p1' | 'p2' | 'go' = 'p1';
  private cursor = [0, 1];
  private picked: (CharId | null)[] = [null, null];

  constructor(parent: HTMLElement, private readonly settings: Settings, private readonly hooks: ScreenHooks) {
    this.root = document.createElement('div');
    this.root.className = 'screens';
    parent.appendChild(this.root);
  }

  get name() {
    return this.current?.name ?? '';
  }

  key(a: MenuAction, player: number) {
    this.current?.key(a, player);
  }

  hide() {
    this.root.innerHTML = '';
    this.current = null;
    this.hooks.modeChanged('');
  }

  private mount(name: string, el: HTMLElement, key: (a: MenuAction, player: number) => void) {
    this.root.innerHTML = '';
    this.root.appendChild(el);
    this.current = { name, el, key };
    this.hooks.modeChanged(name);
  }

  // ───────────────────────────── title ─────────────────────────────

  title() {
    const el = document.createElement('section');
    el.className = 'scr title';
    el.innerHTML = `
      <div class="logo">
        <div class="logo-kicker">STORM TEMPLE FIGHTERS</div>
        <h1 class="logo-main" data-text="ศึกอัสนี">ศึกอัสนี</h1>
        <div class="logo-sub">ศึกชิงวิหารกลางพายุ · ๓ นักรบ ๓ ธาตุ</div>
      </div>`;
    const menu = new ListMenu([
      { label: 'เล่นกับคอม', hint: 'VS CPU', run: () => this.select('cpu') },
      { label: 'สองผู้เล่น', hint: 'คีย์บอร์ดเดียวกัน / จอย 2 ตัว', run: () => this.select('versus') },
      { label: 'ฝึกซ้อม', hint: 'เลือดไม่ลด พลังเต็มตลอด', run: () => this.select('training') },
      { label: 'ตั้งค่า', hint: 'กราฟิก เสียง', run: () => this.settingsScreen(() => this.title()) },
      { label: 'วิธีเล่น', hint: 'ปุ่มและท่าไม้ตาย', run: () => this.help(() => this.title()) },
    ], () => this.hooks.sound('move'));
    el.appendChild(menu.el);
    const foot = document.createElement('div');
    foot.className = 'foot';
    foot.textContent = 'ลูกศร/WASD เลือก · Enter ยืนยัน · Esc กลับ · รองรับจอยและจอสัมผัส';
    el.appendChild(foot);
    this.mount('title', el, (a) => {
      if (menu.key(a) && a === 'ok') this.hooks.sound('ok');
    });
  }

  // ───────────────────────────── select ─────────────────────────────

  select(mode: Mode) {
    this.selectMode = mode;
    this.selStep = 'p1';
    this.picked = [null, null];
    this.cursor = [0, 1];
    this.hooks.sound('ok');
    this.renderSelect();
  }

  private renderSelect() {
    const mode = this.selectMode;
    const el = document.createElement('section');
    el.className = 'scr select';
    const stepText = this.selStep === 'p1'
      ? 'ผู้เล่น 1 เลือกนักรบ'
      : this.selStep === 'p2'
        ? mode === 'versus' ? 'ผู้เล่น 2 เลือกนักรบ' : mode === 'training' ? 'เลือกหุ่นซ้อม' : 'เลือกคู่ต่อสู้'
        : 'พร้อมแล้ว!';
    el.innerHTML = `
      <header class="sel-head">
        <span class="sel-mode">${mode === 'cpu' ? 'เล่นกับคอม' : mode === 'versus' ? 'สองผู้เล่น' : 'ฝึกซ้อม'}</span>
        <h2>${stepText}</h2>
      </header>
      <div class="cards">
        ${ROSTER.map((id, i) => {
          const d = CHARACTERS[id];
          const stat = (v: number) => `<i style="--v:${Math.round(v * 100)}%"></i>`;
          return `
          <button type="button" class="card" id="card-${id}" data-i="${i}" style="--acc:${hex(d.accent)};--acc2:${hex(d.accent2)}">
            <span class="card-el">${d.element}</span>
            <span class="card-name">${d.name}</span>
            <span class="card-en">${d.nameEn}</span>
            <span class="card-title">${d.title}</span>
            <span class="stats">
              <span>ความเร็ว</span>${stat((d.speed - 0.7) / 0.5)}
              <span>พลังโจมตี</span>${stat((d.power - 0.75) / 0.5)}
              <span>ความทน</span>${stat((d.hp - 850) / 280)}
            </span>
            <span class="card-bio">${d.bio}</span>
            <span class="tags"><b class="tag t1">P1</b><b class="tag t2">${mode === 'versus' ? 'P2' : mode === 'training' ? 'หุ่น' : 'CPU'}</b></span>
          </button>`;
        }).join('')}
      </div>
      <footer class="sel-foot"></footer>`;
    const foot = el.querySelector('.sel-foot') as HTMLElement;
    let goMenu: ListMenu | null = null;
    if (this.selStep === 'go') {
      const items: Item[] = [];
      if (mode === 'cpu') {
        items.push({
          label: 'ความยาก', options: [{ label: 'ง่าย', value: 'easy' }, { label: 'ปกติ', value: 'normal' }, { label: 'โหด', value: 'hard' }],
          get: () => this.settings.difficulty, set: (v) => { this.settings.difficulty = v as Difficulty; this.hooks.settingsChanged(this.settings); },
        });
      }
      items.push({ label: 'เริ่มต่อสู้!', run: () => this.go() });
      items.push({ label: 'เลือกใหม่', run: () => { this.hooks.sound('back'); this.selStep = 'p1'; this.picked = [null, null]; this.renderSelect(); } });
      goMenu = new ListMenu(items, () => this.hooks.sound('move'));
      goMenu.setFocus(items.length - 2, false);
      foot.appendChild(goMenu.el);
    } else {
      foot.innerHTML = `<span class="foot">${mode === 'versus' && this.selStep === 'p2' ? 'P2: ลูกศร ←→ แล้วกด , หรือ Numpad1' : '←→ เลือก · Enter ยืนยัน · แตะการ์ดเพื่อเลือก'}</span>`;
    }
    const cards = [...el.querySelectorAll<HTMLButtonElement>('.card')];
    const paint = () => {
      cards.forEach((c, i) => {
        c.classList.toggle('c1', this.selStep === 'p1' ? this.cursor[0] === i : this.picked[0] === ROSTER[i]);
        c.classList.toggle('c2', this.selStep === 'p2' ? this.cursor[1] === i : this.picked[1] === ROSTER[i]);
      });
      const p1 = this.picked[0] ?? ROSTER[this.cursor[0]];
      const p2 = this.selStep === 'p1' ? null : this.picked[1] ?? ROSTER[this.cursor[1]];
      this.hooks.preview(p1, p2);
    };
    cards.forEach((c, i) => {
      c.addEventListener('click', () => {
        if (this.selStep === 'go') return;
        const who = this.selStep === 'p1' ? 0 : 1;
        this.cursor[who] = i;
        this.confirm();
      });
      c.addEventListener('pointerenter', () => {
        if (this.selStep === 'go') return;
        const who = this.selStep === 'p1' ? 0 : 1;
        if (this.cursor[who] !== i) { this.cursor[who] = i; this.hooks.sound('move'); paint(); }
      });
    });
    paint();
    this.mount('select', el, (a, player) => {
      if (this.selStep === 'go') {
        if (a === 'back' || a === 'pause') { this.hooks.sound('back'); this.selStep = 'p2'; this.picked[1] = null; this.renderSelect(); return; }
        if (goMenu?.key(a) && a === 'ok') this.hooks.sound('ok');
        return;
      }
      const who = this.selStep === 'p1' ? 0 : 1;
      if (mode === 'versus' && player !== who && a !== 'pause') return;
      if (a === 'left' || a === 'right') {
        this.cursor[who] = (this.cursor[who] + (a === 'left' ? -1 : 1) + ROSTER.length) % ROSTER.length;
        this.hooks.sound('move');
        paint();
      } else if (a === 'ok') {
        this.confirm();
      } else if (a === 'back' || a === 'pause') {
        this.hooks.sound('back');
        if (this.selStep === 'p2') { this.selStep = 'p1'; this.picked[0] = null; this.renderSelect(); } else this.title();
      }
    });
  }

  private confirm() {
    this.hooks.sound('ok');
    if (this.selStep === 'p1') {
      this.picked[0] = ROSTER[this.cursor[0]];
      this.selStep = 'p2';
      if (this.cursor[1] === this.cursor[0]) this.cursor[1] = (this.cursor[0] + 1) % ROSTER.length;
    } else if (this.selStep === 'p2') {
      this.picked[1] = ROSTER[this.cursor[1]];
      this.selStep = 'go';
    }
    this.renderSelect();
  }

  private go() {
    const [p1, p2] = this.picked;
    if (!p1 || !p2) return;
    this.hooks.sound('ok');
    this.hooks.start(this.selectMode, p1, p2, this.settings.difficulty);
  }

  // ───────────────────────────── settings ─────────────────────────────

  settingsScreen(back: () => void) {
    const s = this.settings;
    const ch = () => this.hooks.settingsChanged(s);
    const vol = [0, 0.2, 0.4, 0.6, 0.8, 1].map((v) => ({ label: v === 0 ? 'ปิด' : `${Math.round(v * 100)}%`, value: v }));
    const el = document.createElement('section');
    el.className = 'scr panel-scr';
    el.innerHTML = `<h2>ตั้งค่า</h2><p class="note">"อัตโนมัติ" เริ่มที่สุดขีดแล้วลดระดับเองถ้าเครื่องเริ่มกระตุก</p>`;
    const menu = new ListMenu([
      {
        label: 'คุณภาพกราฟิก',
        options: [{ label: 'อัตโนมัติ', value: 'auto' }, ...QUALITY_ORDER.map((q) => ({ label: QUALITY[q].label, value: q }))],
        get: () => s.quality, set: (v) => { s.quality = v as Settings['quality']; if (v === 'auto') s.autoCap = null; ch(); },
      },
      {
        label: 'เอฟเฟกต์อนุภาค', options: [{ label: 'ปกติ', value: 1 }, { label: 'จัดเต็ม ×1.5', value: 1.5 }, { label: 'เบาลง', value: 0.6 }],
        get: () => s.effects, set: (v) => { s.effects = v as number; ch(); },
      },
      { label: 'แสดง FPS', options: [{ label: 'ปิด', value: false }, { label: 'เปิด', value: true }], get: () => s.fps, set: (v) => { s.fps = v as boolean; ch(); } },
      { label: 'เพลง', options: vol, get: () => s.music, set: (v) => { s.music = v as number; ch(); } },
      { label: 'เสียงเอฟเฟกต์', options: vol, get: () => s.sfx, set: (v) => { s.sfx = v as number; ch(); } },
      {
        label: 'เวลาต่อยก', options: [{ label: '60 วิ', value: 60 }, { label: '99 วิ', value: 99 }],
        get: () => s.roundTime, set: (v) => { s.roundTime = v as number; ch(); },
      },
      { label: 'กลับ', run: () => { this.hooks.sound('back'); back(); } },
    ], () => this.hooks.sound('move'));
    el.appendChild(menu.el);
    this.mount('settings', el, (a) => {
      if (a === 'back' || a === 'pause') { this.hooks.sound('back'); back(); return; }
      menu.key(a);
    });
  }

  // ───────────────────────────── help ─────────────────────────────

  help(back: () => void) {
    const el = document.createElement('section');
    el.className = 'scr panel-scr help';
    el.innerHTML = `
      <h2>วิธีเล่น</h2>
      <div class="help-grid">
        <div class="help-col">
          <h3>ปุ่ม</h3>
          <table>
            <tr><th></th><th>ผู้เล่น 1</th><th>ผู้เล่น 2</th><th>จอย</th></tr>
            <tr><td>เดิน / กระโดด / ย่อ</td><td><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd></td><td><kbd>↑</kbd><kbd>←</kbd><kbd>↓</kbd><kbd>→</kbd></td><td>ปุ่มทิศ / อนาล็อก</td></tr>
            <tr><td>หมัด</td><td><kbd>J</kbd></td><td><kbd>,</kbd> / <kbd>Num1</kbd></td><td>X / □</td></tr>
            <tr><td>เตะ</td><td><kbd>K</kbd></td><td><kbd>.</kbd> / <kbd>Num2</kbd></td><td>A / ✕</td></tr>
            <tr><td>พลัง</td><td><kbd>L</kbd></td><td><kbd>/</kbd> / <kbd>Num3</kbd></td><td>B / ○</td></tr>
            <tr><td>ไม้ตาย (เกจเต็ม)</td><td><kbd>I</kbd></td><td><kbd>Shift ขวา</kbd> / <kbd>Num0</kbd></td><td>Y / △ / RB</td></tr>
            <tr><td>หยุดเกม</td><td colspan="2"><kbd>Esc</kbd></td><td>Start</td></tr>
          </table>
          <p class="note">ป้องกัน: กดถอยหลังค้าง (ย่อ + ถอย กันท่าต่ำ) · กดเดินหน้า/ถอยสองครั้งเร็ว ๆ = พุ่งตัว · มือถือใช้จอยสติ๊กซ้ายกับปุ่มขวา</p>
        </div>
        <div class="help-col">
          <h3>ท่า</h3>
          <table class="moves">
            <tr><td>หมัด → หมัด → หมัด</td><td>คอมโบ 3 จังหวะ</td></tr>
            <tr><td>หน้า + หมัด</td><td>หมัดตรงหนัก</td></tr>
            <tr><td>เตะ → เตะ</td><td>เตะหน้า ต่อเตะเหวี่ยงล้ม</td></tr>
            <tr><td>ย่อ + หมัด</td><td>อัปเปอร์คัตงัดลอย</td></tr>
            <tr><td>ย่อ + เตะ</td><td>กวาดขา (ต้องย่อกัน)</td></tr>
            <tr><td>กลางอากาศ + หมัด/เตะ</td><td>โจมตีจากบน (ห้ามย่อกัน)</td></tr>
            <tr><td>พลัง</td><td>ลูกพลังพุ่ง</td></tr>
            <tr><td>หน้า + พลัง</td><td>พุ่งชาร์จ</td></tr>
            <tr><td>ย่อ + พลัง</td><td>ท่าทะยานฟ้า อมตะช่วงต้น ใช้สกัดคนกระโดด</td></tr>
            <tr><td>ไม้ตาย</td><td>ลำแสงทำลายล้าง 10 ฮิต</td></tr>
          </table>
          <p class="note">ท่าปกติที่โดนแล้ว ยกเลิกเข้าท่าพลังหรือไม้ตายได้ทันทีเพื่อต่อคอมโบ</p>
        </div>
      </div>`;
    const menu = new ListMenu([{ label: 'กลับ', run: () => { this.hooks.sound('back'); back(); } }], () => this.hooks.sound('move'));
    el.appendChild(menu.el);
    this.mount('help', el, (a) => {
      if (a === 'back' || a === 'pause' || a === 'ok') { this.hooks.sound('back'); back(); }
    });
  }

  // ───────────────────────────── pause & results ─────────────────────────────

  pause() {
    const el = document.createElement('section');
    el.className = 'scr panel-scr pause';
    el.innerHTML = '<h2>หยุดเกม</h2>';
    const menu = new ListMenu([
      { label: 'เล่นต่อ', run: () => { this.hooks.sound('ok'); this.hooks.resume(); } },
      { label: 'เริ่มใหม่', run: () => { this.hooks.sound('ok'); this.hooks.restart(); } },
      { label: 'ตั้งค่า', run: () => this.settingsScreen(() => this.pause()) },
      { label: 'วิธีเล่น', run: () => this.help(() => this.pause()) },
      { label: 'เลือกตัวละคร', run: () => { this.hooks.sound('back'); this.hooks.toSelect(); } },
      { label: 'เมนูหลัก', run: () => { this.hooks.sound('back'); this.hooks.toTitle(); } },
    ], () => this.hooks.sound('move'));
    el.appendChild(menu.el);
    this.mount('pause', el, (a) => {
      if (a === 'pause' || a === 'back') { this.hooks.sound('ok'); this.hooks.resume(); return; }
      if (menu.key(a) && a === 'ok') this.hooks.sound('ok');
    });
  }

  results(winner: CharId | null, perfect: boolean, label: string) {
    const el = document.createElement('section');
    el.className = 'scr results';
    const d = winner ? CHARACTERS[winner] : null;
    el.style.setProperty('--acc', d ? hex(d.accent) : '#ffb648');
    el.innerHTML = `
      <div class="res-kicker">${label}</div>
      <h2 class="res-name" data-text="${d ? d.name : 'เสมอ'}">${d ? d.name : 'เสมอ'}</h2>
      <div class="res-sub">${d ? (perfect ? 'ชนะขาดลอย · PERFECT' : 'ชนะ!') : 'ไม่มีใครยอมใคร'}</div>`;
    const menu = new ListMenu([
      { label: 'แข่งอีกรอบ', run: () => { this.hooks.sound('ok'); this.hooks.restart(); } },
      { label: 'เลือกตัวละคร', run: () => { this.hooks.sound('ok'); this.hooks.toSelect(); } },
      { label: 'เมนูหลัก', run: () => { this.hooks.sound('back'); this.hooks.toTitle(); } },
    ], () => this.hooks.sound('move'));
    el.appendChild(menu.el);
    this.mount('results', el, (a) => {
      if (menu.key(a) && a === 'ok') this.hooks.sound('ok');
    });
  }

  reselect() {
    this.select(this.selectMode);
  }
}
