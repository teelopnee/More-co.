// Dev-only pose sheet: open /poses.html?char=vayu&view=side
import { AmbientLight, Color, DirectionalLight, GridHelper, PerspectiveCamera, Scene, Vector3, WebGLRenderer, SRGBColorSpace } from 'three';
import { CHARACTERS, type CharId } from '../data/characters';
import { Rig, JOINTS, HIP_HEIGHT } from '../fighter/rig';
import { COMPILED } from '../fighter/poses';

const params = new URLSearchParams(location.search);
const id = (params.get('char') ?? 'vayu') as CharId;
const only = params.get('poses')?.split(',');
const names = only ?? Object.keys(COMPILED);
const canvas = document.getElementById('c') as HTMLCanvasElement;
const r = new WebGLRenderer({ canvas, antialias: true });
r.outputColorSpace = SRGBColorSpace;
const W = innerWidth, H = innerHeight;
r.setSize(W, H, false);
r.setScissorTest(true);
const cols = Math.ceil(Math.sqrt(names.length * (W / H)));
const rows = Math.ceil(names.length / cols);
const cw = W / cols, ch = H / rows;
const scene = new Scene();
scene.background = new Color(0x1a1a24);
scene.add(new AmbientLight(0xffffff, 1.2));
const dl = new DirectionalLight(0xffffff, 2.5);
dl.position.set(2, 4, 5);
scene.add(dl);
scene.add(new GridHelper(4, 8, 0x555577, 0x333344));
const rig = new Rig(CHARACTERS[id]);
scene.add(rig.root);
// Same placement as gameplay: facing right (+X), slightly turned to camera.
rig.root.rotation.y = Math.PI / 2 - 0.35;
const cam = new PerspectiveCamera(30, cw / ch, 0.1, 50);
const view = params.get('view') ?? 'side';
if (view === 'front') cam.position.set(1.0, 1.2, 4.2).applyAxisAngle(new Vector3(0, 1, 0), 0.9);
else cam.position.set(0.3, 1.25, 4.6);
cam.lookAt(0.2, 0.85, 0);
names.forEach((n, i) => {
  const p = COMPILED[n];
  JOINTS.forEach((j, k) => rig.joints[j].quaternion.copy(p.q[k]));
  rig.joints.hips.position.set(p.hp.x, HIP_HEIGHT + p.hp.y, p.hp.z);
  const x = (i % cols) * cw, y = H - (Math.floor(i / cols) + 1) * ch;
  r.setViewport(x, y, cw, ch);
  r.setScissor(x, y, cw, ch);
  r.render(scene, cam);
  const label = document.createElement('div');
  label.textContent = n;
  label.style.cssText = `position:absolute;left:${x + 6}px;top:${H - y - ch + 4}px;color:#fff;font:14px monospace`;
  document.body.appendChild(label);
});
(window as unknown as { __ready: boolean }).__ready = true;
