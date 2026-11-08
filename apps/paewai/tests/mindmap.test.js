import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../src/lib/mindmap.js';

const measure = (text, st) => text.length * st.size * 0.55;
const texts = (map, parentText) => {
  const p = map.nodes.find((n) => n.text === parentText);
  return M.childrenOf(map, p.id).map((n) => n.text);
};

test('outline → map → outline', () => {
  const outline = `# ประชุมเปิดตัวสินค้า

## สรุป
- เลื่อนเปิดตัวไป **ธันวาคม**
- งบเพิ่ม 20%
## งานต่อไป
1. ทำสไลด์ใหม่
   - ส่งให้หัวหน้าดู
2. จองห้องประชุม
## คนที่เกี่ยวข้อง:
- ทีมการตลาด`;
  const map = M.fromOutline(outline);
  assert.equal(M.titleOf(map), 'ประชุมเปิดตัวสินค้า');
  assert.deepEqual(texts(map, 'ประชุมเปิดตัวสินค้า'), ['สรุป', 'งานต่อไป', 'คนที่เกี่ยวข้อง']);
  assert.deepEqual(texts(map, 'สรุป'), ['เลื่อนเปิดตัวไป ธันวาคม', 'งบเพิ่ม 20%']);
  assert.deepEqual(texts(map, 'ทำสไลด์ใหม่'), ['ส่งให้หัวหน้าดู']);
  assert.equal(M.toOutline(map), '# ประชุมเปิดตัวสินค้า\n- สรุป\n  - เลื่อนเปิดตัวไป ธันวาคม\n  - งบเพิ่ม 20%\n- งานต่อไป\n  - ทำสไลด์ใหม่\n    - ส่งให้หัวหน้าดู\n  - จองห้องประชุม\n- คนที่เกี่ยวข้อง\n  - ทีมการตลาด');
  // a bullet list with no heading gets a root of its own
  const list = M.fromOutline('- นม\n- ไข่\n  - ไข่ไก่ 10 ฟอง', 'ของต้องซื้อ');
  assert.equal(M.titleOf(list), 'ของต้องซื้อ');
  assert.deepEqual(texts(list, 'ของต้องซื้อ'), ['นม', 'ไข่']);
  assert.deepEqual(texts(list, 'ไข่'), ['ไข่ไก่ 10 ฟอง']);
  assert.equal(M.fromOutline('   ').nodes.length, 1);
});

test('editing keeps one root and a tidy order', () => {
  let map = M.newMap('ทริปเชียงใหม่');
  const root = M.rootOf(map).id;
  let r = M.addChild(map, root, 'ที่พัก');
  map = r.map;
  const stay = r.id;
  r = M.addSibling(map, stay, 'ที่เที่ยว');
  map = r.map;
  map = M.addChild(map, stay, 'นิมมาน').map;
  map = M.addSibling(map, stay, 'งบ').map; // right after ที่พัก
  assert.deepEqual(texts(map, 'ทริปเชียงใหม่'), ['ที่พัก', 'งบ', 'ที่เที่ยว']);
  map = M.moveNode(map, stay, 1);
  assert.deepEqual(texts(map, 'ทริปเชียงใหม่'), ['งบ', 'ที่พัก', 'ที่เที่ยว']);
  map = M.renameNode(map, stay, '  ที่พัก  2 คืน ');
  assert.ok(texts(map, 'ทริปเชียงใหม่').includes('ที่พัก 2 คืน'));
  assert.equal(M.renameNode(map, stay, '   '), map, 'empty names are ignored');
  map = M.removeNode(map, stay);
  assert.equal(map.nodes.some((n) => n.text === 'นิมมาน'), false, 'the whole branch goes');
  assert.equal(M.removeNode(map, root), map, 'the root stays');
  map = M.toggleNode(map, root);
  assert.equal(M.rootOf(map).collapsed, true);
  assert.equal(M.addChild(map, root, 'x').map.nodes[0].collapsed, false, 'adding opens a folded node');
});

test('sanitize repairs maps from files and from Claude', () => {
  const m = M.sanitizeMap({
    id: 'm1',
    nodes: [
      { id: 'a', parent: 'zz', text: 'ลูกหลง' },
      { id: 'r', parent: null, text: 'ราก' },
      { id: 'b', parent: 'c', text: 'วน 1' },
      { id: 'c', parent: 'b', text: 'วน 2' },
      { id: 'r', parent: null, text: 'รากซ้ำ' },
      { id: 'd', parent: 'r', text: '' },
      { text: 5 },
    ],
  });
  const root = M.rootOf(m);
  assert.equal(m.nodes.filter((n) => n.parent == null).length, 1);
  assert.equal(root.text, 'ราก');
  for (const n of m.nodes) if (n !== root) assert.ok(m.nodes.some((p) => p.id === n.parent), n.text);
  assert.equal(M.sanitizeMap({ nodes: [] }), null);
});

test('layout: balanced sides, no overlaps, folded branches hidden', () => {
  let map = M.newMap('โปรเจกต์ใหม่ที่ชื่อยาวมากจนต้องขึ้นบรรทัดใหม่แน่นอนเลยครับ');
  const root = M.rootOf(map).id;
  const ids = [];
  for (let i = 0; i < 6; i++) {
    const r = M.addChild(map, root, `กิ่งที่ ${i + 1}`);
    map = r.map;
    ids.push(r.id);
    for (let j = 0; j < i; j++) map = M.addChild(map, r.id, `ย่อย ${i + 1}.${j + 1}`).map;
  }
  const L = M.layoutMap(map, measure);
  const rootBox = L.byId.get(root);
  assert.deepEqual([rootBox.x, rootBox.y], [0, 0]);
  assert.ok(rootBox.lines.length > 1, 'long titles wrap');
  const sides = ids.map((id) => L.byId.get(id).side);
  assert.ok(sides.includes(1) && sides.includes(-1), 'both sides used');
  // children sit outside their parent, on the same side
  for (const n of L.nodes) {
    if (n.parent == null) continue;
    const p = L.byId.get(n.parent);
    assert.ok(n.side * (n.x - p.x) > 0, n.text);
  }
  // no two boxes overlap
  for (const a of L.nodes) for (const b of L.nodes) {
    if (a === b) continue;
    const overlap = Math.abs(a.x - b.x) * 2 < a.w + b.w - 1 && Math.abs(a.y - b.y) * 2 < a.h + b.h - 1;
    assert.ok(!overlap, `${a.text} / ${b.text}`);
  }
  assert.equal(L.edges.length, L.nodes.length - 1);
  assert.match(M.edgePath(rootBox, L.byId.get(ids[0])), /^M[-\d.]+ [-\d.]+C/);
  // fold the biggest branch
  const folded = M.layoutMap(M.toggleNode(map, ids[5]), measure);
  assert.equal(folded.nodes.length, L.nodes.length - 5);
  assert.equal(folded.byId.get(ids[5]).folded, 5);
});

test('wrapping Thai text between words', () => {
  const lines = M.wrapText('สรุปการประชุมทีมการตลาดประจำสัปดาห์', 60, (t) => t.length * 6);
  assert.ok(lines.length > 1);
  assert.equal(lines.join(''), 'สรุปการประชุมทีมการตลาดประจำสัปดาห์');
  for (const l of lines) assert.ok(l.length * 6 <= 60, l);
});
