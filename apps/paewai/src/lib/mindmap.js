// Mind maps: a map is a flat list of nodes { id, parent, text, collapsed?, at? } with one root
// (parent null). Flat, so it syncs and merges like every other item and Claude can return it
// with a simple JSON schema. Everything here is pure; app.js draws the result.

let counter = 0;
const uid = (now = Date.now()) => {
  counter = (counter + 1) % 1296;
  return `n${now.toString(36)}${counter.toString(36).padStart(2, '0')}${Math.random().toString(36).slice(2, 6)}`;
};

export const BRANCH_COLORS = ['#3e7bfa', '#f08c2e', '#1fae6b', '#a259e6', '#e8473c', '#14a3b8', '#d4a106', '#e2569b'];

const clean = (t) => String(t ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);

export function newMap(title = 'หัวข้อหลัก', now = Date.now()) {
  const root = { id: uid(now), parent: null, text: clean(title) || 'หัวข้อหลัก' };
  return { id: uid(now + 1), nodes: [root], source: null, createdAt: now, updatedAt: now };
}

export const rootOf = (map) => map.nodes.find((n) => n.parent == null) ?? map.nodes[0];
export const titleOf = (map) => rootOf(map)?.text ?? 'มายด์แมป';
export const childrenOf = (map, id) => map.nodes.filter((n) => n.parent === id);

/** Checks and repairs a map from storage, a sync file or Claude: one root, no orphans, no loops. */
export function sanitizeMap(raw) {
  if (!raw || !Array.isArray(raw.nodes)) return null;
  const nodes = [];
  const ids = new Set();
  for (const n of raw.nodes.slice(0, 2000)) {
    if (!n || typeof n.text !== 'string') continue;
    const id = typeof n.id === 'string' && n.id && !ids.has(n.id) ? n.id.slice(0, 64) : uid();
    ids.add(id);
    nodes.push({
      id,
      parent: typeof n.parent === 'string' && n.parent ? n.parent : null,
      text: clean(n.text) || '…',
      ...(n.collapsed ? { collapsed: true } : {}),
      ...(Number.isFinite(n.at) && n.at >= 0 ? { at: Math.round(n.at) } : {}), // ms into a recording
    });
  }
  if (!nodes.length) return null;
  let root = nodes.find((n) => n.parent == null) ?? nodes[0];
  root.parent = null;
  // Anything that points nowhere, or at itself through a loop, hangs off the root.
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const n of nodes) {
    if (n === root) continue;
    if (n.parent == null || !byId.has(n.parent)) {
      n.parent = root.id;
      continue;
    }
    const seen = new Set([n.id]);
    let p = byId.get(n.parent);
    while (p && p !== root) {
      if (seen.has(p.id)) {
        n.parent = root.id;
        break;
      }
      seen.add(p.id);
      p = byId.get(p.parent);
    }
  }
  // Only one root.
  for (const n of nodes) if (n !== root && n.parent == null) n.parent = root.id;
  const when = (v) => (Number.isFinite(v) ? v : Date.now());
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : uid(),
    nodes,
    source: raw.source && typeof raw.source === 'object' && typeof raw.source.id === 'string' ? { kind: String(raw.source.kind ?? ''), id: raw.source.id } : null,
    createdAt: when(raw.createdAt),
    updatedAt: when(raw.updatedAt ?? raw.createdAt),
  };
}

// ---------------------------------------------------------------------------
// Editing (each returns a new map)

const touch = (map, nodes, now = Date.now()) => ({ ...map, nodes, updatedAt: now });

export function addChild(map, parentId, text = 'หัวข้อใหม่') {
  const node = { id: uid(), parent: parentId, text: clean(text) || 'หัวข้อใหม่' };
  const nodes = map.nodes.map((n) => (n.id === parentId && n.collapsed ? { ...n, collapsed: false } : n));
  return { map: touch(map, [...nodes, node]), id: node.id };
}

/** A new node right after `id`, under the same parent (on the root: a new branch). */
export function addSibling(map, id, text = 'หัวข้อใหม่') {
  const at = map.nodes.find((n) => n.id === id);
  if (!at || at.parent == null) return addChild(map, id, text);
  const node = { id: uid(), parent: at.parent, text: clean(text) || 'หัวข้อใหม่' };
  // Siblings are ordered by their place in the list: put it right after `at`.
  const nodes = [...map.nodes];
  const index = nodes.indexOf(at);
  nodes.splice(index + 1, 0, node);
  return { map: touch(map, nodes), id: node.id };
}

export function renameNode(map, id, text) {
  const t = clean(text);
  if (!t) return map;
  return touch(map, map.nodes.map((n) => (n.id === id ? { ...n, text: t } : n)));
}

export function toggleNode(map, id) {
  return touch(map, map.nodes.map((n) => (n.id === id ? { ...n, collapsed: !n.collapsed } : n)));
}

/** Removes a node and everything under it (never the root). */
export function removeNode(map, id) {
  const node = map.nodes.find((n) => n.id === id);
  if (!node || node.parent == null) return map;
  const gone = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const n of map.nodes) if (!gone.has(n.id) && gone.has(n.parent)) (gone.add(n.id), (grew = true));
  }
  return touch(map, map.nodes.filter((n) => !gone.has(n.id)));
}

/** Moves a node one place up or down among its siblings. */
export function moveNode(map, id, step) {
  const node = map.nodes.find((n) => n.id === id);
  if (!node) return map;
  const sibs = map.nodes.filter((n) => n.parent === node.parent);
  const i = sibs.indexOf(node);
  const j = i + step;
  if (j < 0 || j >= sibs.length) return map;
  const nodes = [...map.nodes];
  const a = nodes.indexOf(sibs[i]);
  const b = nodes.indexOf(sibs[j]);
  [nodes[a], nodes[b]] = [nodes[b], nodes[a]];
  return touch(map, nodes);
}

// ---------------------------------------------------------------------------
// Outline text <-> map ("# หัวข้อ\n- กิ่ง\n  - ย่อย"), for pasting Claude's answer or a note

/** Builds a map from a markdown-ish outline: headings, bullets, numbers and indentation. */
export function fromOutline(text, fallbackTitle = 'มายด์แมป', now = Date.now()) {
  const rows = [];
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    if (!raw.trim() || /^\s*[-*_=]{3,}\s*$/.test(raw)) continue;
    const expanded = raw.replace(/\t/g, '    ');
    const heading = /^\s*(#{1,6})\s+(.*)$/.exec(expanded);
    const bullet = /^(\s*)(?:[-*+•▪◦]|\d{1,3}[.)])\s+(.*)$/.exec(expanded);
    let level;
    let body;
    if (heading) {
      level = heading[1].length - 1; // # = 0 (root), ## = 1 …
      body = heading[2];
    } else if (bullet) {
      level = 100 + Math.floor(bullet[1].length / 2); // bullets sit under the latest heading
      body = bullet[2];
    } else {
      level = 100 + Math.floor((/^\s*/.exec(expanded)[0].length) / 2);
      body = expanded;
    }
    const t = clean(body.replace(/\*\*(.+?)\*\*|__(.+?)__/g, '$1$2').replace(/^\[[ xX]?\]\s*/, '').replace(/[:：]$/, ''));
    if (t) rows.push({ level, heading: !!heading, text: t });
  }
  if (!rows.length) return newMap(fallbackTitle, now);
  // Bullets count from the heading above them.
  let headingLevel = -1;
  for (const r of rows) {
    if (r.heading) headingLevel = r.level;
    else r.level = headingLevel + 1 + (r.level - 100);
  }
  const top = Math.min(...rows.map((r) => r.level));
  const tops = rows.filter((r) => r.level === top);
  const map = newMap(tops.length === 1 && rows[0].level === top ? rows[0].text : fallbackTitle, now);
  const root = map.nodes[0];
  const stack = [{ level: tops.length === 1 && rows[0].level === top ? top : top - 1, id: root.id }];
  rows.forEach((r, i) => {
    if (i === 0 && tops.length === 1 && r.level === top) return; // it is the root
    while (stack.length > 1 && stack.at(-1).level >= r.level) stack.pop();
    const node = { id: uid(now + i + 2), parent: stack.at(-1).id, text: r.text };
    map.nodes.push(node);
    stack.push({ level: r.level, id: node.id });
  });
  return map;
}

/** The map as a markdown outline (root as a heading, branches as nested bullets). */
export function toOutline(map) {
  const root = rootOf(map);
  const lines = [`# ${root.text}`];
  const walk = (id, depth) => {
    for (const c of childrenOf(map, id)) {
      lines.push(`${'  '.repeat(depth)}- ${c.text}`);
      walk(c.id, depth + 1);
    }
  };
  walk(root.id, 0);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Layout: root in the middle, branches balanced left and right, each side a tidy tree.

const segmenter = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter('th', { granularity: 'word' }) : null;

/** Wraps text into lines no wider than `max`, breaking between Thai words (or anywhere for long words). */
export function wrapText(text, max, measure) {
  const raw = segmenter ? [...segmenter.segment(text)].map((s) => s.segment) : text.split(/(\s+)/);
  // "15–17", "20%", "ธ.ค.", "3×3", "14:00" stay on one line
  const pieces = [];
  for (const p of raw) {
    const prev = pieces.at(-1);
    const glue = prev !== undefined && !/\s$/.test(prev) && !/^\s/.test(p) && (/^[–\-.,:;%)\]×/]/.test(p) || /[–\-(\[×/.:]$/.test(prev) || (/^\d/.test(p) && /\d$/.test(prev)));
    if (glue) pieces[pieces.length - 1] = prev + p;
    else pieces.push(p);
  }
  const lines = [];
  let line = '';
  for (const piece of pieces) {
    const next = line + piece;
    if (!line || measure(next) <= max) {
      line = next;
      continue;
    }
    // a pause near the end of the line is a better place to break than between two words
    const sp = line.lastIndexOf(' ');
    if (sp > 0 && sp >= line.length * 0.55 && measure(line.slice(sp + 1) + piece) <= max) {
      lines.push(line.slice(0, sp).trimEnd());
      line = line.slice(sp + 1) + piece;
      continue;
    }
    lines.push(line.trimEnd());
    line = piece.trimStart();
    // A single piece wider than the line: cut it by characters.
    while (measure(line) > max && line.length > 1) {
      let cut = line.length - 1;
      while (cut > 1 && measure(line.slice(0, cut)) > max) cut--;
      lines.push(line.slice(0, cut));
      line = line.slice(cut);
    }
  }
  if (line.trim()) lines.push(line.trimEnd());
  return lines.length ? lines : [''];
}

export const STYLE = [
  { size: 22, weight: 700, line: 30, padX: 26, padY: 16, max: 280 }, // root
  { size: 17, weight: 600, line: 25, padX: 18, padY: 11, max: 240 }, // main branches
  { size: 15.5, weight: 500, line: 22, padX: 10, padY: 7, max: 220 }, // the rest
];
export const styleAt = (depth) => STYLE[Math.min(depth, 2)];

/**
 * Positions every visible node. `measure(text, style)` returns the text width in px.
 * Returns { nodes: [{ id, text, lines, x, y, w, h, depth, side, color, parent, hidden }], edges, bounds }
 * where x/y is the centre of the node.
 */
export function layoutMap(map, measure, { gapX = 56, gapY = 14 } = {}) {
  const root = rootOf(map);
  const kids = new Map();
  for (const n of map.nodes) if (n.parent != null) (kids.get(n.parent) ?? kids.set(n.parent, []).get(n.parent)).push(n);
  const out = new Map();

  const box = (node, depth) => {
    const st = styleAt(depth);
    const lines = wrapText(node.text, st.max, (t) => measure(t, st));
    const w = Math.ceil(Math.max(...lines.map((l) => measure(l, st)), 24) + st.padX * 2);
    const h = Math.ceil(lines.length * st.line + st.padY * 2);
    return { lines, w, h };
  };

  // Subtree heights, skipping what is folded away.
  const shown = (n) => (n.collapsed ? [] : kids.get(n.id) ?? []);
  const sizes = new Map();
  const measureTree = (n, depth) => {
    const b = box(n, depth);
    const children = shown(n);
    let span = 0;
    for (const c of children) span += measureTree(c, depth + 1);
    span += Math.max(0, children.length - 1) * gapY;
    const total = Math.max(b.h, span);
    sizes.set(n.id, { ...b, span, total });
    return total;
  };
  measureTree(root, 0);

  // Split the main branches: the first ones go right until it holds about half.
  const branches = shown(root);
  const sum = branches.reduce((s, b) => s + sizes.get(b.id).total, 0);
  let acc = 0;
  const right = [];
  const left = [];
  for (const b of branches) {
    if (right.length && acc + sizes.get(b.id).total / 2 > sum / 2 && branches.length > 2) left.push(b);
    else {
      right.push(b);
      acc += sizes.get(b.id).total;
    }
  }
  if (!left.length && right.length > 3) left.push(...right.splice(Math.ceil(right.length / 2)));

  const rs = sizes.get(root.id);
  out.set(root.id, { id: root.id, text: root.text, lines: rs.lines, x: 0, y: 0, w: rs.w, h: rs.h, depth: 0, side: 0, color: '', parent: null, folded: !!root.collapsed && (kids.get(root.id)?.length ?? 0) });

  const place = (n, depth, side, color, parentNode, top) => {
    const s = sizes.get(n.id);
    const y = top + s.total / 2;
    const x = parentNode.x + side * (parentNode.w / 2 + gapX + s.w / 2);
    const node = { id: n.id, text: n.text, lines: s.lines, x, y, w: s.w, h: s.h, depth, side, color, parent: parentNode.id, folded: n.collapsed ? (kids.get(n.id)?.length ?? 0) : 0 };
    out.set(n.id, node);
    let t = y - s.span / 2;
    for (const c of shown(n)) {
      const cs = sizes.get(c.id);
      place(c, depth + 1, side, color, node, t);
      t += cs.total + gapY;
    }
  };
  const column = (list, side, offset) => {
    const height = list.reduce((s, b) => s + sizes.get(b.id).total, 0) + Math.max(0, list.length - 1) * gapY * 2;
    let t = -height / 2;
    for (const b of list) {
      const color = BRANCH_COLORS[(branches.indexOf(b) + offset) % BRANCH_COLORS.length];
      place(b, 1, side, color, out.get(root.id), t);
      t += sizes.get(b.id).total + gapY * 2;
    }
  };
  column(right, 1, 0);
  column(left, -1, 0);

  const nodes = [...out.values()];
  const edges = nodes.filter((n) => n.parent != null).map((n) => ({ from: n.parent, to: n.id, side: n.side, color: n.color, depth: n.depth }));
  const bounds = nodes.reduce(
    (b, n) => ({ minX: Math.min(b.minX, n.x - n.w / 2), maxX: Math.max(b.maxX, n.x + n.w / 2), minY: Math.min(b.minY, n.y - n.h / 2), maxY: Math.max(b.maxY, n.y + n.h / 2) }),
    { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity },
  );
  return { nodes, edges, bounds, byId: out };
}

/** SVG path for an edge: a smooth S-curve from the parent's side to the child's side. */
export function edgePath(from, to) {
  const side = to.side || 1;
  const x1 = from.x + side * (from.w / 2);
  const y1 = from.y;
  const x2 = to.x - side * (to.w / 2);
  const y2 = to.depth >= 2 ? to.y + to.h / 2 - 3 : to.y;
  const mid = (x1 + x2) / 2;
  return `M${x1.toFixed(1)} ${y1.toFixed(1)}C${mid.toFixed(1)} ${y1.toFixed(1)} ${mid.toFixed(1)} ${y2.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`;
}

/** Text for search and for asking Claude about a map. */
export const mapText = (map) => map.nodes.map((n) => n.text).join(' · ');
