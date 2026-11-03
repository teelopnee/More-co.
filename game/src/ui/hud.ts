// In-fight HUD: health, super meters, timer, round pips, combo counters, announcements.
import type { Fight } from '../sim/fight';
import { METER_MAX } from '../sim/fight';

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

export class Hud {
  readonly el: HTMLDivElement;
  private readonly hp: HTMLDivElement[] = [];
  private readonly ghost: HTMLDivElement[] = [];
  private readonly meter: HTMLDivElement[] = [];
  private readonly meterBox: HTMLDivElement[] = [];
  private readonly wins: HTMLDivElement[] = [];
  private readonly names: HTMLDivElement[] = [];
  private readonly combos: HTMLDivElement[] = [];
  private readonly callouts: HTMLDivElement[] = [];
  private readonly timer: HTMLDivElement;
  private readonly announceEl: HTMLDivElement;
  private readonly cutin: HTMLDivElement;
  readonly fps: HTMLDivElement;
  private readonly toastEl: HTMLDivElement;
  private ghostVal = [1, 1];
  private ghostDelay = [0, 0];
  private comboTimer = [0, 0];
  private lastHits = [0, 0];

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'hud';
    this.el.hidden = true;
    this.el.innerHTML = `
      <div class="hud-top">
        ${[0, 1].map((i) => `
        <div class="side side-${i}">
          <div class="nameplate"><span class="nm"></span><span class="wins"><i></i><i></i></span></div>
          <div class="hpbar"><div class="hp-ghost"></div><div class="hp-fill"></div><div class="hp-shine"></div></div>
        </div>`).join('<div class="timer">99</div>')}
      </div>
      <div class="hud-bottom">
        ${[0, 1].map((i) => `
        <div class="meter meter-${i}"><div class="meter-track"><div class="meter-fill"></div></div><span class="meter-label">ไม้ตาย</span></div>`).join('')}
      </div>
      ${[0, 1].map((i) => `<div class="combo combo-${i}"><b>0</b><span>HITS</span><em></em></div><div class="callout callout-${i}"></div>`).join('')}
      <div class="announce"></div>
      <div class="cutin"></div>
      <div class="toast"></div>
    `;
    parent.appendChild(this.el);
    for (let i = 0; i < 2; i++) {
      const side = this.el.querySelector(`.side-${i}`)!;
      this.hp.push(side.querySelector('.hp-fill')!);
      this.ghost.push(side.querySelector('.hp-ghost')!);
      this.wins.push(side.querySelector('.wins')!);
      this.names.push(side.querySelector('.nm')!);
      const m = this.el.querySelector(`.meter-${i}`) as HTMLDivElement;
      this.meterBox.push(m);
      this.meter.push(m.querySelector('.meter-fill')!);
      this.combos.push(this.el.querySelector(`.combo-${i}`)!);
      this.callouts.push(this.el.querySelector(`.callout-${i}`)!);
    }
    this.timer = this.el.querySelector('.timer')!;
    this.announceEl = this.el.querySelector('.announce')!;
    this.cutin = this.el.querySelector('.cutin')!;
    this.toastEl = this.el.querySelector('.toast')!;
    this.fps = document.createElement('div');
    this.fps.className = 'fps';
    this.fps.hidden = true;
    parent.appendChild(this.fps);
  }

  setup(fight: Fight) {
    for (let i = 0; i < 2; i++) {
      const d = fight.f[i].def;
      this.names[i].textContent = `${d.name} · ${d.nameEn}`;
      const side = this.el.querySelector(`.side-${i}`) as HTMLDivElement;
      side.style.setProperty('--acc', hex(d.accent));
      side.style.setProperty('--acc2', hex(d.accent2));
      this.meterBox[i].style.setProperty('--acc', hex(d.accent));
      this.meterBox[i].style.setProperty('--acc2', hex(d.accent2));
      this.combos[i].style.setProperty('--acc', hex(d.accent));
      this.callouts[i].style.setProperty('--acc', hex(d.accent));
      this.ghostVal[i] = 1;
    }
    this.timer.classList.toggle('inf', fight.training);
    this.announceEl.innerHTML = '';
  }

  update(fight: Fight, dt: number) {
    for (let i = 0; i < 2; i++) {
      const f = fight.f[i];
      const v = Math.max(0, f.hp / f.maxHp);
      this.hp[i].style.transform = `scaleX(${v})`;
      this.hp[i].classList.toggle('low', v < 0.3);
      if (v < this.ghostVal[i]) {
        this.ghostDelay[i] -= dt;
        if (this.ghostDelay[i] <= 0 && f.comboHits === 0) this.ghostVal[i] = Math.max(v, this.ghostVal[i] - dt * 0.8);
      } else {
        this.ghostVal[i] = v;
        this.ghostDelay[i] = 0.5;
      }
      if (f.comboHits > 0) this.ghostDelay[i] = 0.35;
      this.ghost[i].style.transform = `scaleX(${this.ghostVal[i]})`;
      const m = f.meter / METER_MAX;
      this.meter[i].style.transform = `scaleX(${m})`;
      this.meterBox[i].classList.toggle('max', m >= 1);
      const pips = this.wins[i].children;
      for (let k = 0; k < pips.length; k++) pips[k].classList.toggle('on', f.wins > k);
      // Live combo counter on the attacker's side.
      const att = i;
      const defender = fight.f[1 - i];
      if (defender.comboHits >= 2 && defender.comboHits !== this.lastHits[att]) {
        this.lastHits[att] = defender.comboHits;
        this.showCombo(att, defender.comboHits, defender.comboDmg);
      }
      if (defender.comboHits === 0) this.lastHits[att] = 0;
      if (this.comboTimer[att] > 0) {
        this.comboTimer[att] -= dt;
        if (this.comboTimer[att] <= 0) this.combos[att].classList.remove('show');
      }
    }
    const secs = Math.ceil(fight.timer / 60);
    this.timer.textContent = fight.training ? '∞' : String(Math.min(99, secs));
    this.timer.classList.toggle('urgent', !fight.training && secs <= 10 && fight.phase === 'fight');
  }

  showCombo(side: number, hits: number, dmg: number) {
    const c = this.combos[side];
    c.querySelector('b')!.textContent = String(hits);
    c.querySelector('em')!.textContent = `${dmg} ดาเมจ`;
    c.classList.remove('show', 'bump');
    void c.offsetWidth;
    c.classList.add('show', 'bump');
    this.comboTimer[side] = 1.6;
  }

  callout(side: number, text: string) {
    const c = this.callouts[side];
    c.textContent = text;
    c.classList.remove('show');
    void c.offsetWidth;
    c.classList.add('show');
  }

  announce(text: string, opts: { sub?: string; cls?: string; ms?: number } = {}) {
    const a = document.createElement('div');
    a.className = `ann ${opts.cls ?? ''}`;
    a.innerHTML = `<div class="ann-main" data-text="${text}">${text}</div>${opts.sub ? `<div class="ann-sub">${opts.sub}</div>` : ''}`;
    this.announceEl.appendChild(a);
    window.setTimeout(() => a.remove(), opts.ms ?? 1400);
  }

  superCutin(side: number, name: string, move: string, accent: number) {
    const c = this.cutin;
    c.style.setProperty('--acc', hex(accent));
    c.className = `cutin side-${side}`;
    c.innerHTML = `<div class="cut-band"><span class="cut-name">${name}</span><span class="cut-move">${move}</span></div>`;
    void c.offsetWidth;
    c.classList.add('show');
    window.setTimeout(() => c.classList.remove('show'), 1100);
  }

  toast(text: string) {
    this.toastEl.textContent = text;
    this.toastEl.classList.remove('show');
    void this.toastEl.offsetWidth;
    this.toastEl.classList.add('show');
  }

  show(on: boolean) {
    this.el.hidden = !on;
  }

  /** Bars and timer hidden (attract mode) while announcements still play. */
  minimal(on: boolean) {
    this.el.classList.toggle('minimal', on);
  }
}
