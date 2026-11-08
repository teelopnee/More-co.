// The mind map canvas: draws a map (lib/mindmap.js) as SVG, pans and pinch-zooms like a photo,
// selects and edits nodes in place, and exports a PNG. It knows nothing about the rest of the app:
// changes go out through onChange(map).

import * as M from './lib/mindmap.js';

const NS = 'http://www.w3.org/2000/svg';
const FONT = (st) => `${st.weight} ${st.size}px Sarabun, system-ui, sans-serif`;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

let measureCtx = null;
export function measure(text, st) {
  measureCtx ??= document.createElement('canvas').getContext('2d');
  measureCtx.font = FONT(st);
  return measureCtx.measureText(text).width;
}

export class MapView {
  constructor(host, { onChange = () => {}, onSelect = () => {}, editable = true } = {}) {
    Object.assign(this, { host, onChange, onSelect, editable });
    this.k = 1;
    this.tx = 0;
    this.ty = 0;
    this.selected = null;
    this.svg = document.createElementNS(NS, 'svg');
    this.svg.classList.add('mm');
    this.svg.setAttribute('role', 'img');
    this.world = document.createElementNS(NS, 'g');
    this.svg.append(this.world);
    host.append(this.svg);
    this.pointers = new Map();
    this.bind();
    this.ro = new ResizeObserver(() => this.applyTransform());
    this.ro.observe(host);
    // Measure with the real font once it has loaded.
    document.fonts?.ready.then(() => this.map && this.render());
  }

  set(map, { fit = false } = {}) {
    const first = !this.map;
    this.map = map;
    if (this.selected && !map.nodes.some((n) => n.id === this.selected)) this.selected = null;
    this.render();
    if (first || fit) this.fit(32, { readable: true });
  }

  render() {
    if (!this.map) return;
    this.layout = M.layoutMap(this.map, measure);
    const L = this.layout;
    const parts = [];
    for (const e of L.edges) {
      const a = L.byId.get(e.from);
      const b = L.byId.get(e.to);
      parts.push(`<path class="mm-edge" d="${M.edgePath(a, b)}" stroke="${b.color}" stroke-width="${b.depth === 1 ? 3 : b.depth === 2 ? 2.2 : 1.6}"/>`);
    }
    for (const n of L.nodes) {
      const st = M.styleAt(n.depth);
      const x = n.x - n.w / 2;
      const y = n.y - n.h / 2;
      const cls = `mm-node d${Math.min(n.depth, 2)}${n.id === this.selected ? ' sel' : ''}`;
      const style = n.color ? ` style="--c:${n.color}"` : '';
      const tx = n.depth >= 2 ? (n.side < 0 ? n.w - st.padX : st.padX) : n.w / 2;
      const anchor = n.depth >= 2 ? (n.side < 0 ? 'end' : 'start') : 'middle';
      const lines = n.lines
        .map((l, i) => `<tspan x="${tx.toFixed(1)}" y="${(st.padY + st.line * i + st.line * 0.72).toFixed(1)}">${esc(l)}</tspan>`)
        .join('');
      const fold = n.folded
        ? `<g class="mm-fold" transform="translate(${n.side < 0 ? -2 : n.w + 2} ${n.h / 2})"><circle r="11"/><text text-anchor="middle" y="4.5">${n.folded}</text></g>`
        : '';
      const under = n.depth >= 2 ? `<line class="mm-under" x1="0" x2="${n.w}" y1="${n.h - 3}" y2="${n.h - 3}"/>` : '';
      parts.push(
        `<g class="${cls}" data-id="${esc(n.id)}" transform="translate(${x.toFixed(1)} ${y.toFixed(1)})"${style}><rect class="mm-box" width="${n.w}" height="${n.h}" rx="${n.depth === 0 ? n.h / 2 > 30 ? 22 : n.h / 2 : n.depth === 1 ? 14 : 9}"/>${under}<text class="mm-text" text-anchor="${anchor}" font-size="${st.size}" font-weight="${st.weight}">${lines}</text>${fold}</g>`,
      );
    }
    this.world.innerHTML = parts.join('');
    this.svg.setAttribute('aria-label', `มายด์แมป ${M.titleOf(this.map)}`);
    this.applyTransform();
  }

  applyTransform() {
    this.world.setAttribute('transform', `translate(${this.tx.toFixed(1)} ${this.ty.toFixed(1)}) scale(${this.k.toFixed(4)})`);
  }

  /**
   * Whole map in view, centred. With `readable`, a map too big for the screen (a phone) opens at
   * a size you can read instead, centred on the main topic; the พอดี button shows all of it.
   */
  fit(pad = 32, { readable = false } = {}) {
    if (!this.layout) return;
    const { minX, maxX, minY, maxY } = this.layout.bounds;
    const r = this.host.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const k = Math.min((r.width - pad * 2) / (maxX - minX || 1), (r.height - pad * 2) / (maxY - minY || 1), 1.4);
    if (readable && k < 0.62) {
      this.k = 0.8;
      this.tx = r.width / 2;
      this.ty = r.height / 2;
    } else {
      this.k = Math.max(0.15, k);
      this.tx = r.width / 2 - ((minX + maxX) / 2) * this.k;
      this.ty = r.height / 2 - ((minY + maxY) / 2) * this.k;
    }
    this.applyTransform();
  }

  zoomBy(f, cx, cy) {
    const r = this.host.getBoundingClientRect();
    const x = cx ?? r.width / 2;
    const y = cy ?? r.height / 2;
    const k = Math.min(4, Math.max(0.15, this.k * f));
    this.tx = x - ((x - this.tx) * k) / this.k;
    this.ty = y - ((y - this.ty) * k) / this.k;
    this.k = k;
    this.applyTransform();
  }

  /** Brings a node into view (near the top, so an on-screen keyboard does not cover it). */
  reveal(id, top = false) {
    const n = this.layout?.byId.get(id);
    if (!n) return;
    const r = this.host.getBoundingClientRect();
    const sx = n.x * this.k + this.tx;
    const sy = n.y * this.k + this.ty;
    const margin = 40;
    if (top) {
      this.tx += r.width / 2 - sx;
      this.ty += r.height * 0.28 - sy;
    } else {
      if (sx < margin || sx > r.width - margin) this.tx += r.width / 2 - sx;
      if (sy < margin || sy > r.height - margin) this.ty += r.height / 2 - sy;
    }
    this.applyTransform();
  }

  select(id) {
    this.selected = id;
    for (const g of this.world.querySelectorAll('.mm-node')) g.classList.toggle('sel', g.dataset.id === id);
    if (id) this.reveal(id);
    this.onSelect(id);
  }

  change(map, select) {
    this.map = map;
    if (select !== undefined) this.selected = select;
    this.render();
    this.onChange(map);
    this.onSelect(this.selected);
  }

  // ---- editing --------------------------------------------------------------

  addChild() {
    if (!this.editable) return;
    const parent = this.selected ?? M.rootOf(this.map).id;
    const { map, id } = M.addChild(this.map, parent);
    this.change(map, id);
    this.edit(id, true);
  }

  addSibling() {
    if (!this.editable) return;
    const at = this.selected ?? M.rootOf(this.map).id;
    const { map, id } = M.addSibling(this.map, at);
    this.change(map, id);
    this.edit(id, true);
  }

  remove() {
    const node = this.map.nodes.find((n) => n.id === this.selected);
    if (!this.editable || !node || node.parent == null) return false;
    this.change(M.removeNode(this.map, node.id), node.parent);
    return true;
  }

  toggle() {
    const id = this.selected;
    if (!id || !M.childrenOf(this.map, id).length) return;
    this.change(M.toggleNode(this.map, id), id);
  }

  move(step) {
    if (!this.selected) return;
    this.change(M.moveNode(this.map, this.selected, step), this.selected);
  }

  /** Edits a node's text in place. `fresh`: a just-added node (Escape removes it). */
  edit(id = this.selected, fresh = false) {
    if (!this.editable || !id) return;
    this.reveal(id, true);
    const g = this.world.querySelector(`[data-id="${CSS.escape(id)}"]`);
    const n = this.layout.byId.get(id);
    if (!g || !n) return;
    const box = g.getBoundingClientRect();
    const host = this.host.getBoundingClientRect();
    const st = M.styleAt(n.depth);
    const ta = document.createElement('textarea');
    ta.className = `mm-edit d${Math.min(n.depth, 2)}`;
    ta.value = n.text;
    ta.rows = 1;
    ta.setAttribute('aria-label', 'แก้ข้อความหัวข้อ');
    Object.assign(ta.style, {
      left: `${box.left - host.left}px`,
      top: `${box.top - host.top}px`,
      minWidth: `${Math.max(box.width, 140)}px`,
      minHeight: `${box.height}px`,
      fontSize: `${st.size * this.k}px`,
      fontWeight: st.weight,
    });
    this.host.append(ta);
    ta.focus();
    ta.select();
    let done = false;
    const finish = (save) => {
      if (done) return;
      done = true;
      const text = ta.value.trim();
      ta.remove();
      if (save && text && text !== n.text) this.change(M.renameNode(this.map, id, text), id);
      else if (!save && fresh) this.change(M.removeNode(this.map, id), n.parent);
      this.svg.focus({ preventScroll: true });
    };
    ta.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        finish(true);
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        finish(false);
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        finish(true);
        this.addChild();
      }
    });
    ta.addEventListener('blur', () => finish(true));
    this.editing = ta;
  }

  // ---- input ------------------------------------------------------------------

  bind() {
    const svg = this.svg;
    svg.tabIndex = 0;
    let downAt = null;
    let lastTap = { id: null, t: 0 };
    svg.addEventListener('pointerdown', (e) => {
      svg.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size === 1) downAt = { x: e.clientX, y: e.clientY, tx: this.tx, ty: this.ty, moved: false, target: e.target };
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), k: this.k };
        if (downAt) downAt.moved = true;
      }
    });
    svg.addEventListener('pointermove', (e) => {
      if (!this.pointers.has(e.pointerId)) return;
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const r = this.host.getBoundingClientRect();
      if (this.pointers.size >= 2 && this.pinch) {
        const [a, b] = [...this.pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        this.zoomBy((this.pinch.k * d) / this.pinch.d / this.k, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top);
        return;
      }
      if (!downAt) return;
      const dx = e.clientX - downAt.x;
      const dy = e.clientY - downAt.y;
      if (!downAt.moved && Math.hypot(dx, dy) < 6) return;
      downAt.moved = true;
      this.tx = downAt.tx + dx;
      this.ty = downAt.ty + dy;
      this.applyTransform();
    });
    const up = (e) => {
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) this.pinch = null;
      if (!downAt || this.pointers.size) return;
      const tap = !downAt.moved;
      const target = downAt.target;
      downAt = null;
      if (!tap) return;
      const g = target.closest?.('.mm-node');
      const id = g?.dataset.id ?? null;
      const now = Date.now();
      if (id && lastTap.id === id && now - lastTap.t < 350) {
        lastTap = { id: null, t: 0 };
        this.edit(id);
        return;
      }
      lastTap = { id, t: now };
      if (target.closest?.('.mm-fold') && id) {
        this.selected = id;
        this.toggle();
        return;
      }
      this.select(id);
    };
    svg.addEventListener('pointerup', up);
    svg.addEventListener('pointercancel', up);
    svg.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const r = this.host.getBoundingClientRect();
        if (e.ctrlKey || e.metaKey) this.zoomBy(Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top);
        else {
          this.tx -= e.deltaX;
          this.ty -= e.deltaY;
          this.applyTransform();
        }
      },
      { passive: false },
    );
    svg.addEventListener('keydown', (e) => this.key(e));
  }

  /** XMind-style keys: Tab child, Enter sibling, F2/Space edit, Delete remove, arrows move around. */
  key(e) {
    if (e.target !== this.svg || !this.map) return;
    const sel = this.selected;
    const L = this.layout;
    const keys = {
      Tab: () => this.addChild(),
      Enter: () => (sel ? this.addSibling() : this.select(M.rootOf(this.map).id)),
      F2: () => this.edit(),
      ' ': () => this.edit(),
      Delete: () => this.remove(),
      Backspace: () => this.remove(),
      '+': () => this.zoomBy(1.2),
      '=': () => this.zoomBy(1.2),
      '-': () => this.zoomBy(1 / 1.2),
      0: () => this.fit(),
      ArrowLeft: () => this.walk('left'),
      ArrowRight: () => this.walk('right'),
      ArrowUp: () => (e.altKey ? this.move(-1) : this.walk('up')),
      ArrowDown: () => (e.altKey ? this.move(1) : this.walk('down')),
    };
    const fn = keys[e.key];
    if (!fn || (e.ctrlKey && e.key !== '0') || (!sel && !['Enter', '+', '=', '-', '0'].includes(e.key) && !e.key.startsWith('Arrow'))) {
      if (!sel && e.key.startsWith('Arrow')) {
        e.preventDefault();
        this.select(M.rootOf(this.map).id);
      }
      return;
    }
    e.preventDefault();
    fn();
    void L;
  }

  walk(dir) {
    const L = this.layout;
    const cur = L.byId.get(this.selected) ?? L.byId.get(M.rootOf(this.map).id);
    if (!cur) return;
    let next = null;
    if (dir === 'up' || dir === 'down') {
      const sibs = L.nodes.filter((n) => n.parent === cur.parent && n.side === cur.side).sort((a, b) => a.y - b.y);
      next = sibs[sibs.indexOf(cur) + (dir === 'up' ? -1 : 1)];
    } else {
      const outward = (dir === 'right' ? 1 : -1) === (cur.side || (dir === 'right' ? 1 : -1));
      if (cur.depth === 0) next = L.nodes.filter((n) => n.parent === cur.id && n.side === (dir === 'right' ? 1 : -1)).sort((a, b) => Math.abs(a.y) - Math.abs(b.y))[0];
      else if (outward) next = L.nodes.filter((n) => n.parent === cur.id).sort((a, b) => Math.abs(a.y - cur.y) - Math.abs(b.y - cur.y))[0];
      else next = L.byId.get(cur.parent);
    }
    if (next) this.select(next.id);
  }

  // ---- export -------------------------------------------------------------------

  /** The whole map as a PNG (drawn with the same fonts and colours). */
  async png(scale = 2) {
    const L = M.layoutMap(this.map, measure);
    const pad = 40;
    const { minX, maxX, minY, maxY } = L.bounds;
    const w = Math.ceil(maxX - minX + pad * 2);
    const h = Math.ceil(maxY - minY + pad * 2);
    const canvas = document.createElement('canvas');
    canvas.width = Math.min(8000, w * scale);
    canvas.height = Math.min(8000, h * scale);
    const s = Math.min(scale, canvas.width / w, canvas.height / h);
    const ctx = canvas.getContext('2d');
    const css = getComputedStyle(this.host);
    const bg = css.getPropertyValue('--mm-bg').trim() || '#ffffff';
    const ink = css.getPropertyValue('--mm-ink').trim() || '#111';
    const rootFill = css.getPropertyValue('--mm-root').trim() || '#0381fe';
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.scale(s, s);
    ctx.translate(pad - minX, pad - minY);
    for (const e of L.edges) {
      const a = L.byId.get(e.from);
      const b = L.byId.get(e.to);
      ctx.strokeStyle = b.color;
      ctx.lineWidth = b.depth === 1 ? 3 : b.depth === 2 ? 2.2 : 1.6;
      ctx.stroke(new Path2D(M.edgePath(a, b)));
    }
    for (const n of L.nodes) {
      const st = M.styleAt(n.depth);
      const x = n.x - n.w / 2;
      const y = n.y - n.h / 2;
      if (n.depth < 2) {
        ctx.fillStyle = n.depth === 0 ? rootFill : tint(n.color, 0.16, bg);
        ctx.beginPath();
        ctx.roundRect(x, y, n.w, n.h, n.depth === 0 ? Math.min(22, n.h / 2) : 14);
        ctx.fill();
      } else {
        ctx.strokeStyle = n.color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x, y + n.h - 3);
        ctx.lineTo(x + n.w, y + n.h - 3);
        ctx.stroke();
      }
      ctx.fillStyle = n.depth === 0 ? '#fff' : ink;
      ctx.font = FONT(st);
      ctx.textAlign = n.depth >= 2 ? (n.side < 0 ? 'right' : 'left') : 'center';
      const tx = n.depth >= 2 ? (n.side < 0 ? x + n.w - st.padX : x + st.padX) : n.x;
      n.lines.forEach((l, i) => ctx.fillText(l, tx, y + st.padY + st.line * i + st.line * 0.72));
    }
    return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  }

  destroy() {
    this.ro.disconnect();
    this.svg.remove();
  }
}

/** A colour mixed with the background (for filled branch boxes in the PNG). */
function tint(hex, amount, bg) {
  const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [r, g, b] = p(hex);
  const [R, G, B] = /^#[0-9a-f]{6}$/i.test(bg) ? p(bg) : [255, 255, 255];
  const mix = (c, C) => Math.round(C + (c - C) * amount);
  return `rgb(${mix(r, R)} ${mix(g, G)} ${mix(b, B)})`;
}
