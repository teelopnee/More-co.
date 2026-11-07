// High-level visual effects built on the particle systems: hit sparks, shockwaves, lights,
// limb trails, projectiles, the super beam and electric arcs.
import {
  AdditiveBlending, BufferAttribute, BufferGeometry, Color, CylinderGeometry, DoubleSide, Group, Mesh,
  PlaneGeometry, PointLight, ShaderMaterial, SphereGeometry, TorusGeometry, Vector3, type Camera, type Scene,
} from 'three';
import type { CharId } from '../data/characters';
import { CHARACTERS } from '../data/characters';
import { NOISE } from '../render/glsl';
import type { Quality } from '../render/quality';
import { Particles, type Emit } from './particles';

const v = new Vector3();
const rnd = (a: number, b: number) => a + (b - a) * Math.random();

export function hdr(hex: number, k: number): [number, number, number] {
  const c = new Color(hex);
  return [c.r * k, c.g * k, c.b * k];
}

interface PooledLight {
  light: PointLight;
  life: number;
  max: number;
  peak: number;
  owner: number;
}

interface Ring {
  mesh: Mesh;
  mat: ShaderMaterial;
  life: number;
  max: number;
  size: number;
  flat: boolean;
}

const RING_FRAG = /* glsl */ `
  uniform float uT;
  uniform vec3 uColor;
  uniform float uThick;
  varying vec2 vUv;
  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p);
    float rad = 0.25 + 0.75 * (1.0 - pow(1.0 - uT, 3.0));
    float w = uThick * (1.0 - uT * 0.7);
    float ring = smoothstep(w, 0.0, abs(r - rad));
    float inner = smoothstep(rad, 0.0, r) * 0.15 * (1.0 - uT);
    float a = (ring + inner) * (1.0 - uT) * step(r, 1.0);
    gl_FragColor = vec4(uColor * a, 1.0);
  }
`;

/** Polyline ribbons rebuilt every frame (electric arcs). */
export class Arcs {
  readonly mesh: Mesh;
  private readonly pos: Float32Array;
  private readonly edge: Float32Array;
  private readonly geo = new BufferGeometry();
  private n = 0;
  private readonly cap: number;
  private readonly side = new Vector3();
  private readonly tan = new Vector3();
  private readonly view = new Vector3();

  constructor(maxPoints: number, color: [number, number, number]) {
    this.cap = maxPoints;
    this.pos = new Float32Array(maxPoints * 2 * 3);
    this.edge = new Float32Array(maxPoints * 2);
    for (let i = 0; i < maxPoints; i++) { this.edge[i * 2] = -1; this.edge[i * 2 + 1] = 1; }
    this.geo.setAttribute('position', new BufferAttribute(this.pos, 3));
    this.geo.setAttribute('aEdge', new BufferAttribute(this.edge, 1));
    const idx: number[] = [];
    for (let i = 0; i < maxPoints - 1; i++) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
    this.geo.setIndex(idx);
    this.geo.setDrawRange(0, 0);
    const mat = new ShaderMaterial({
      uniforms: { uColor: { value: new Color(...color) } },
      vertexShader: /* glsl */ `
        attribute float aEdge;
        varying float vEdge;
        void main() { vEdge = aEdge; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        varying float vEdge;
        void main() {
          float c = 1.0 - abs(vEdge);
          gl_FragColor = vec4(mix(uColor, vec3(6.0), pow(c, 4.0)) * c, 1.0);
        }
      `,
      transparent: true, depthWrite: false, blending: AdditiveBlending, side: DoubleSide,
    });
    this.mesh = new Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
  }

  begin() {
    this.n = 0;
  }

  /** Adds a jagged arc from a to b. Consecutive arcs are separated by degenerate segments. */
  arc(a: Vector3, b: Vector3, segments: number, jitter: number, width: number, eye: Vector3) {
    if (this.n + segments + 3 > this.cap) return;
    const pts: Vector3[] = [];
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const p = new Vector3().lerpVectors(a, b, t);
      if (i > 0 && i < segments) p.add(v.set(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)).multiplyScalar(jitter * Math.sin(t * Math.PI)));
      pts.push(p);
    }
    // Degenerate joint so separate arcs do not connect visibly.
    this.write(pts[0], 0);
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      this.tan.subVectors(pts[Math.min(pts.length - 1, i + 1)], pts[Math.max(0, i - 1)]).normalize();
      this.view.subVectors(eye, p).normalize();
      this.side.crossVectors(this.tan, this.view).normalize().multiplyScalar(width * (1 - Math.abs(i / segments - 0.5)));
      this.writeSide(p, this.side);
    }
    this.write(pts[pts.length - 1], 0);
  }

  private write(p: Vector3, w: number) {
    const i = this.n * 6;
    this.pos[i] = this.pos[i + 3] = p.x;
    this.pos[i + 1] = this.pos[i + 4] = p.y + w;
    this.pos[i + 2] = this.pos[i + 5] = p.z;
    this.n++;
  }

  private writeSide(p: Vector3, s: Vector3) {
    const i = this.n * 6;
    this.pos[i] = p.x + s.x; this.pos[i + 1] = p.y + s.y; this.pos[i + 2] = p.z + s.z;
    this.pos[i + 3] = p.x - s.x; this.pos[i + 4] = p.y - s.y; this.pos[i + 5] = p.z - s.z;
    this.n++;
  }

  end() {
    this.geo.setDrawRange(0, Math.max(0, (this.n - 1) * 6));
    (this.geo.attributes.position as BufferAttribute).needsUpdate = true;
  }
}

/** Camera-facing ribbon that follows a moving point (punch/kick trails). */
export class Trail {
  readonly mesh: Mesh;
  private readonly pts: Vector3[] = [];
  private readonly ages: number[] = [];
  private readonly geo = new BufferGeometry();
  private readonly pos: Float32Array;
  private readonly alpha: Float32Array;
  private readonly max = 16;
  active = false;
  width = 0.11;

  constructor(color: Color) {
    this.pos = new Float32Array(this.max * 2 * 3);
    this.alpha = new Float32Array(this.max * 2);
    this.geo.setAttribute('position', new BufferAttribute(this.pos, 3));
    this.geo.setAttribute('aAlpha', new BufferAttribute(this.alpha, 1));
    const idx: number[] = [];
    for (let i = 0; i < this.max - 1; i++) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
    this.geo.setIndex(idx);
    this.geo.setDrawRange(0, 0);
    const mat = new ShaderMaterial({
      uniforms: { uColor: { value: color.clone().multiplyScalar(3.5) } },
      vertexShader: /* glsl */ `
        attribute float aAlpha;
        varying float vA;
        varying float vSide;
        void main() { vA = aAlpha; vSide = float(gl_VertexID % 2) * 2.0 - 1.0; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        varying float vA;
        varying float vSide;
        void main() {
          float c = 1.0 - abs(vSide);
          gl_FragColor = vec4((uColor + vec3(2.0) * c * vA) * vA * (0.4 + c), 1.0);
        }
      `,
      transparent: true, depthWrite: false, blending: AdditiveBlending, side: DoubleSide,
    });
    this.mesh = new Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
  }

  update(dt: number, tip: Vector3 | null, eye: Vector3) {
    for (let i = 0; i < this.ages.length; i++) this.ages[i] += dt;
    if (tip && this.active) {
      this.pts.unshift(tip.clone());
      this.ages.unshift(0);
    }
    while (this.pts.length > this.max || (this.ages.length && this.ages[this.ages.length - 1] > 0.14)) { this.pts.pop(); this.ages.pop(); }
    const n = this.pts.length;
    if (n < 2) { this.geo.setDrawRange(0, 0); return; }
    const t = new Vector3(), view = new Vector3(), s = new Vector3();
    for (let i = 0; i < n; i++) {
      const p = this.pts[i];
      t.subVectors(this.pts[Math.min(n - 1, i + 1)], this.pts[Math.max(0, i - 1)]).normalize();
      view.subVectors(eye, p).normalize();
      s.crossVectors(t, view).normalize();
      const a = Math.max(0, 1 - this.ages[i] / 0.14) * (1 - i / n);
      const w = this.width * a;
      this.pos.set([p.x + s.x * w, p.y + s.y * w, p.z + s.z * w, p.x - s.x * w, p.y - s.y * w, p.z - s.z * w], i * 6);
      this.alpha[i * 2] = this.alpha[i * 2 + 1] = a;
    }
    this.geo.setDrawRange(0, (n - 1) * 6);
    (this.geo.attributes.position as BufferAttribute).needsUpdate = true;
    (this.geo.attributes.aAlpha as BufferAttribute).needsUpdate = true;
  }
}

interface ProjectileVis {
  id: number;
  char: CharId;
  group: Group;
  core: Mesh;
  extra: Mesh | null;
  light: number;
  dir: number;
  age: number;
}

const CORE_VERT = /* glsl */ `
  varying vec3 vN;
  varying vec3 vV;
  varying vec3 vP;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vN = normalize(normalMatrix * normal);
    vV = normalize(-mv.xyz);
    vP = position;
    gl_Position = projectionMatrix * mv;
  }
`;

function coreMaterial(color: [number, number, number], hot: number) {
  return new ShaderMaterial({
    uniforms: { uColor: { value: new Color(...color) }, uTime: { value: 0 }, uHot: { value: hot }, uAlpha: { value: 1 } },
    vertexShader: CORE_VERT,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uTime;
      uniform float uHot;
      uniform float uAlpha;
      varying vec3 vN;
      varying vec3 vV;
      varying vec3 vP;
      ${NOISE}
      void main() {
        float f = abs(dot(vN, vV));
        float n = vnoise3(vP * 6.0 + vec3(uTime * 5.0, -uTime * 3.0, uTime * 2.0));
        float core = pow(f, 2.2);
        vec3 c = uColor * (0.35 + n * 1.2) * (0.3 + core) + vec3(uHot) * pow(f, 6.0);
        gl_FragColor = vec4(c * uAlpha, 1.0);
      }
    `,
    transparent: true, depthWrite: false, blending: AdditiveBlending,
  });
}

class BeamVis {
  readonly group = new Group();
  private readonly core: Mesh;
  private readonly outer: Mesh;
  private readonly haze: Mesh;
  private readonly rings: Mesh[] = [];
  private readonly mats: ShaderMaterial[] = [];
  active = false;
  owner = -1;
  age = 0;
  fade = 0;
  char: CharId = 'vayu';
  x0 = 0;
  y = 1.2;
  dir = 1;

  constructor() {
    const mk = (hot: number, flow: number) => new ShaderMaterial({
      uniforms: { uColor: { value: new Color() }, uTime: { value: 0 }, uHot: { value: hot }, uFlow: { value: flow }, uAlpha: { value: 1 } },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vN;
        varying vec3 vV;
        void main() {
          vUv = uv;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vN = normalize(normalMatrix * normal);
          vV = normalize(-mv.xyz);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform float uTime;
        uniform float uHot;
        uniform float uFlow;
        uniform float uAlpha;
        varying vec2 vUv;
        varying vec3 vN;
        varying vec3 vV;
        ${NOISE}
        void main() {
          float f = abs(dot(vN, vV));
          float n = fbm(vec2(vUv.y * 26.0 - uTime * uFlow, vUv.x * 5.0 + uTime));
          float body = pow(f, 1.6);
          float startFade = smoothstep(0.0, 0.04, 1.0 - vUv.y);
          vec3 c = uColor * body * (0.4 + n * 1.4) + vec3(uHot) * pow(f, 5.0) * (0.7 + n * 0.6);
          gl_FragColor = vec4(c * uAlpha * startFade, 1.0);
        }
      `,
      transparent: true, depthWrite: false, blending: AdditiveBlending,
    });
    const geo = (r: number) => {
      const g = new CylinderGeometry(r, r, 1, 24, 1, true);
      g.translate(0, -0.5, 0);
      g.rotateZ(Math.PI / 2);
      return g;
    };
    const mc = mk(2.2, 14), mo = mk(0.25, 9), mh = mk(0, 5);
    this.mats.push(mc, mo, mh);
    this.core = new Mesh(geo(0.16), mc);
    this.outer = new Mesh(geo(0.45), mo);
    this.haze = new Mesh(geo(0.95), mh);
    for (const m of [this.core, this.outer, this.haze]) { m.frustumCulled = false; m.renderOrder = 7; this.group.add(m); }
    const ringMat = coreMaterial([1, 1, 1], 1.5);
    for (let i = 0; i < 6; i++) {
      const r = new Mesh(new TorusGeometry(0.75, 0.05, 6, 32), ringMat.clone());
      r.rotation.y = Math.PI / 2;
      r.frustumCulled = false;
      this.rings.push(r);
      this.group.add(r);
    }
    this.group.visible = false;
  }

  start(owner: number, char: CharId, x0: number, y: number, dir: number) {
    this.active = true;
    this.owner = owner;
    this.char = char;
    this.x0 = x0; this.y = y; this.dir = dir;
    this.age = 0;
    this.fade = 0;
    const d = CHARACTERS[char];
    const [r, g, b] = hdr(d.accent, 1.8);
    const [r2, g2, b2] = hdr(d.accent2, 1.6);
    (this.mats[0].uniforms.uColor.value as Color).setRGB(r2, g2, b2);
    (this.mats[1].uniforms.uColor.value as Color).setRGB(r, g, b);
    (this.mats[2].uniforms.uColor.value as Color).setRGB(r * 0.06, g * 0.06, b * 0.06);
    for (const ring of this.rings) ((ring.material as ShaderMaterial).uniforms.uColor.value as Color).setRGB(r, g, b);
    this.group.visible = true;
  }

  stop() {
    this.active = false;
  }

  update(dt: number, time: number) {
    if (!this.group.visible) return;
    this.age += dt;
    this.fade = this.active ? Math.min(1, this.fade + dt * 8) : Math.max(0, this.fade - dt * 3);
    if (!this.active && this.fade <= 0) { this.group.visible = false; return; }
    const len = 26;
    const pulse = 1 + Math.sin(time * 40) * 0.06 + Math.sin(time * 23) * 0.05;
    const w = this.fade * pulse;
    this.group.position.set(this.x0, this.y, 0);
    this.group.scale.set(this.dir, 1, 1);
    for (const m of [this.core, this.outer, this.haze]) {
      m.scale.set(len, w, w);
    }
    for (const mat of this.mats) { mat.uniforms.uTime.value = time; mat.uniforms.uAlpha.value = this.fade; }
    this.rings.forEach((r, i) => {
      const t = ((time * 1.6 + i / this.rings.length) % 1);
      r.position.x = t * 14;
      const s = (0.6 + t * 0.9) * w;
      r.scale.set(s, s, s);
      const m = r.material as ShaderMaterial;
      m.uniforms.uAlpha.value = (1 - t) * this.fade;
      m.uniforms.uTime.value = time;
    });
  }
}

export interface EffectsHooks {
  shake(amount: number): void;
  punch(strength: number, x: number, y: number): void;
}

export class Effects {
  readonly add: Particles;
  readonly alpha: Particles;
  readonly group = new Group();
  private readonly lights: PooledLight[] = [];
  private readonly rings: Ring[] = [];
  private readonly projectiles = new Map<number, ProjectileVis>();
  readonly beam = new BeamVis();
  readonly arcs: Arcs;
  private time = 0;
  private quality: Quality;
  private budget = 1;
  eye = new Vector3();

  constructor(scene: Scene, q: Quality, private readonly camera: Camera) {
    this.quality = q;
    this.add = new Particles(14000, true);
    this.alpha = new Particles(3000, false);
    this.group.add(this.add.mesh, this.alpha.mesh, this.beam.group);
    for (let i = 0; i < 4; i++) {
      const light = new PointLight(0xffffff, 0, 14, 2);
      light.position.set(0, -50, 0);
      this.lights.push({ light, life: 0, max: 1, peak: 0, owner: -1 });
      this.group.add(light);
    }
    const ringGeo = new PlaneGeometry(1, 1);
    for (let i = 0; i < 14; i++) {
      const mat = new ShaderMaterial({
        uniforms: { uT: { value: 0 }, uColor: { value: new Color() }, uThick: { value: 0.08 } },
        vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: RING_FRAG,
        transparent: true, depthWrite: false, blending: AdditiveBlending, side: DoubleSide,
      });
      const mesh = new Mesh(ringGeo, mat);
      mesh.visible = false;
      mesh.renderOrder = 6;
      this.rings.push({ mesh, mat, life: 0, max: 1, size: 1, flat: false });
      this.group.add(mesh);
    }
    this.arcs = new Arcs(900, [0.5, 1.6, 4]);
    this.group.add(this.arcs.mesh);
    scene.add(this.group);
    this.setQuality(q);
  }

  setQuality(q: Quality) {
    this.quality = q;
    this.add.cap = Math.min(this.add.max, q.particles);
    this.alpha.cap = Math.min(this.alpha.max, Math.round(q.particles * 0.2));
    this.budget = q.particles / 9000;
  }

  /** Scales particle counts by the quality budget. */
  n(count: number) {
    return Math.max(1, Math.round(count * Math.min(1.5, this.budget)));
  }

  emit(e: Emit) {
    this.add.emit(e);
  }

  flashLight(pos: Vector3, color: number | Color, intensity: number, life: number) {
    let best = this.lights[0];
    for (const l of this.lights) {
      if (l.owner >= 0) continue;
      if (l.life <= 0) { best = l; break; }
      if (l.life < best.life || best.owner >= 0) best = l;
    }
    if (best.owner >= 0) return;
    best.light.position.copy(pos);
    best.light.color.set(color);
    best.peak = intensity;
    best.life = best.max = life;
  }

  private acquireLight(owner: number): number {
    const i = this.lights.findIndex((l) => l.owner < 0 && l.life <= 0);
    const k = i >= 0 ? i : this.lights.findIndex((l) => l.owner < 0);
    if (k < 0) return -1;
    this.lights[k].owner = owner;
    this.lights[k].life = 0;
    return k;
  }

  private releaseLight(k: number) {
    if (k < 0) return;
    const l = this.lights[k];
    l.owner = -1;
    l.life = l.max = 0.15;
  }

  ring(pos: Vector3, color: [number, number, number], size: number, life: number, flat = false, thick = 0.08) {
    const r = this.rings.find((x) => x.life <= 0) ?? this.rings[0];
    r.mesh.position.copy(pos);
    (r.mat.uniforms.uColor.value as Color).setRGB(color[0] * 0.45, color[1] * 0.45, color[2] * 0.45);
    r.mat.uniforms.uThick.value = thick;
    r.life = r.max = life;
    r.size = size;
    r.flat = flat;
    r.mesh.visible = true;
  }

  // ───────────────────────────── combat effects ─────────────────────────────

  hit(x: number, y: number, dir: number, strength: 'light' | 'medium' | 'heavy' | 'super', blocked: boolean, attacker: CharId, counter: boolean) {
    const d = CHARACTERS[attacker];
    const z = 0.25;
    const big = strength === 'heavy' ? 1 : strength === 'medium' ? 0.65 : strength === 'super' ? 0.55 : 0.4;
    const pos = v.set(x, y, z);
    if (blocked) {
      const c: [number, number, number] = [2.2, 3, 5];
      this.add.emit({ x, y, z, life: 0.12, size: 1.3 * big + 0.4, sizeEnd: 0.6, r: 3, g: 3.5, b: 5 });
      for (let i = 0; i < this.n(14 * big + 6); i++) {
        const a = rnd(-1.2, 1.2) + (dir > 0 ? Math.PI : 0);
        const s = rnd(3, 9);
        this.add.emit({ x, y, z, vx: Math.cos(a) * s, vy: Math.sin(a) * s + 1, vz: rnd(-2, 2), life: rnd(0.15, 0.3), size: 0.035, r: c[0], g: c[1], b: c[2], stretch: 0.05, drag: 4, gravity: -8 });
      }
      this.ring(pos, c, 1.4 + big, 0.22, false, 0.12);
      this.flashLight(pos, 0x88aaff, 10 * big, 0.1);
      return;
    }
    const [r, g, b] = hdr(d.accent, 4.5);
    const [r2, g2, b2] = hdr(d.accent2, 5);
    // Core flash + soft glow.
    this.add.emit({ x, y, z, life: 0.08, size: 0.5 + big * 0.9, sizeEnd: 0.2, r: 3, g: 3, b: 3 });
    this.add.emit({ x, y, z, life: 0.24, size: 0.9 + big * 1.1, sizeEnd: 1.6 + big * 1.4, r: r * 0.12, g: g * 0.12, b: b * 0.12 });
    const count = this.n(strength === 'super' ? 14 : 16 + big * 40);
    for (let i = 0; i < count; i++) {
      const a = rnd(-1.4, 1.4) + (dir > 0 ? 0 : Math.PI);
      const el = rnd(-1, 1);
      const s = rnd(5, 17) * (0.6 + big * 0.6);
      const hot = Math.random() < 0.35;
      this.add.emit({
        x, y, z, vx: Math.cos(a) * s * Math.cos(el), vy: Math.sin(a) * s + el * 3, vz: rnd(-4, 4),
        life: rnd(0.18, 0.5), size: rnd(0.025, 0.05), r: hot ? r2 : r, g: hot ? g2 : g, b: hot ? b2 : b,
        stretch: 0.045, drag: 3.5, gravity: -14,
      });
    }
    for (let i = 0; i < this.n(6 + big * 10); i++) {
      this.add.emit({
        x: x + rnd(-0.2, 0.2), y: y + rnd(-0.2, 0.2), z, vx: rnd(-2, 2) + dir * 2, vy: rnd(-1, 3), vz: rnd(-1, 1),
        life: rnd(0.3, 0.7), size: rnd(0.12, 0.28), sizeEnd: 0.02, r: r * 0.5, g: g * 0.5, b: b * 0.5, drag: 2,
      });
    }
    this.ring(pos, [r, g, b], 1.2 + big * 2.6, 0.18 + big * 0.12);
    if (strength === 'heavy' || counter) this.ring(pos, counter ? [5, 1.6, 0.6] : [r2, g2, b2], 2.4 + big * 2, 0.32, false, 0.05);
    this.flashLight(pos, d.accent, 10 + big * 28, 0.1 + big * 0.1);
    if (attacker === 'vayu' && this.quality.detail >= 0.6) this.zap(pos, 0.9 + big, 3 + Math.round(big * 4));
    if (attacker === 'phloeng') this.flames(pos, 0.5 + big, this.n(8 + big * 12));
    if (attacker === 'chantra') this.sparkles(pos, 0.8 + big, this.n(10 + big * 14));
  }

  private zapTimer: { pos: Vector3; r: number; n: number; life: number }[] = [];
  zap(pos: Vector3, radius: number, n: number, life = 0.12) {
    this.zapTimer.push({ pos: pos.clone(), r: radius, n, life });
  }

  flames(pos: Vector3, spread: number, n: number) {
    for (let i = 0; i < n; i++) {
      const hot = Math.random();
      this.add.emit({
        x: pos.x + rnd(-0.2, 0.2) * spread, y: pos.y + rnd(-0.2, 0.2) * spread, z: pos.z + rnd(-0.2, 0.2),
        vx: rnd(-2, 2) * spread, vy: rnd(1, 4), vz: rnd(-1, 1), life: rnd(0.25, 0.6), size: rnd(0.15, 0.35) * spread, sizeEnd: 0.05,
        r: 4.5, g: 1.3 + hot * 1.5, b: 0.25 + hot * 0.3, drag: 1.5, gravity: 3,
      });
    }
  }

  sparkles(pos: Vector3, spread: number, n: number) {
    const d = CHARACTERS.chantra;
    const [r, g, b] = hdr(d.accent2, 5);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = rnd(1, 6) * spread;
      this.add.emit({
        x: pos.x, y: pos.y, z: pos.z, vx: Math.cos(a) * s, vy: Math.sin(a) * s, vz: rnd(-2, 2),
        life: rnd(0.3, 0.8), size: rnd(0.03, 0.07), r, g, b, drag: 3, gravity: -1, stretch: 0.02,
      });
    }
  }

  clash(x: number, y: number) {
    const pos = v.set(x, y, 0.2);
    this.add.emit({ x, y, z: 0.2, life: 0.14, size: 1.8, sizeEnd: 0.5, r: 3, g: 3, b: 3 });
    for (let i = 0; i < this.n(70); i++) {
      const a = Math.random() * Math.PI * 2;
      const s = rnd(4, 18);
      this.add.emit({ x, y, z: 0.2, vx: Math.cos(a) * s, vy: Math.sin(a) * s, vz: rnd(-5, 5), life: rnd(0.2, 0.6), size: 0.05, r: 5, g: 4, b: 3, stretch: 0.05, drag: 3, gravity: -10 });
    }
    this.ring(pos, [4, 4, 5], 5, 0.4);
    this.ring(pos, [3, 2, 1], 3, 0.25);
    this.flashLight(pos, 0xffffff, 50, 0.25);
  }

  dust(x: number, z: number, amount: number) {
    for (let i = 0; i < this.n(8 * amount); i++) {
      const a = Math.random() * Math.PI * 2;
      const s = rnd(0.5, 2.5) * amount;
      this.alpha.emit({
        x: x + rnd(-0.2, 0.2), y: 0.08, z: z + rnd(-0.2, 0.2), vx: Math.cos(a) * s, vy: rnd(0.2, 1.2), vz: Math.sin(a) * s * 0.6,
        life: rnd(0.5, 1.1), size: rnd(0.2, 0.4), sizeEnd: rnd(0.7, 1.3) * amount, r: 0.22, g: 0.2, b: 0.3, alpha: 0.35, drag: 2.5,
      });
    }
    for (let i = 0; i < this.n(10 * amount); i++) {
      this.add.emit({
        x: x + rnd(-0.3, 0.3), y: 0.05, z: z + rnd(-0.3, 0.3), vx: rnd(-3, 3), vy: rnd(1, 4), vz: rnd(-1, 1),
        life: rnd(0.2, 0.45), size: 0.02, r: 2, g: 2.4, b: 4, stretch: 0.04, drag: 3, gravity: -12,
      });
    }
  }

  /** Rain-water splash when someone lands hard. */
  splash(x: number, strength: number) {
    this.ring(v.set(x, 0.03, 0), [1, 1.3, 2.4], 2.5 * strength, 0.45, true, 0.05);
    this.dust(x, 0, strength);
  }

  // ───────────────────────────── projectiles ─────────────────────────────

  projectile(id: number, char: CharId, x: number, y: number, dir: number) {
    let p = this.projectiles.get(id);
    const d = CHARACTERS[char];
    if (!p) {
      const group = new Group();
      const [r, g, b] = hdr(d.accent, char === 'phloeng' ? 3 : 3.5);
      const core = new Mesh(new SphereGeometry(char === 'phloeng' ? 0.38 : 0.28, 24, 16), coreMaterial([r * 0.6, g * 0.6, b * 0.6], 1.6));
      core.renderOrder = 7;
      group.add(core);
      let extra: Mesh | null = null;
      if (char === 'chantra') {
        extra = new Mesh(new TorusGeometry(0.55, 0.06, 8, 40, Math.PI * 1.15), coreMaterial(hdr(d.accent2, 4), 3));
        extra.renderOrder = 7;
        core.scale.setScalar(0.55);
        group.add(extra);
      } else if (char === 'vayu') {
        extra = new Mesh(new TorusGeometry(0.46, 0.025, 6, 40), coreMaterial([r, g, b], 2));
        extra.renderOrder = 7;
        group.add(extra);
      }
      this.group.add(group);
      p = { id, char, group, core, extra, light: this.acquireLight(1000 + id), dir, age: 0 };
      this.projectiles.set(id, p);
      // Muzzle burst.
      this.ring(v.set(x, y, 0.2), [r, g, b], 2.5, 0.3);
      this.add.emit({ x, y, z: 0.2, life: 0.18, size: 1.2, sizeEnd: 0.3, r: r * 0.3, g: g * 0.3, b: b * 0.3 });
    }
    p.group.position.set(x, y, 0.15);
    p.dir = dir;
    if (p.light >= 0) {
      const l = this.lights[p.light];
      l.light.position.set(x, y, 0.8);
      l.light.color.set(d.accent);
      l.light.intensity = 16 + Math.sin(this.time * 30) * 4;
    }
  }

  endProjectile(id: number, x: number, y: number) {
    const p = this.projectiles.get(id);
    if (!p) return;
    this.releaseLight(p.light);
    this.group.remove(p.group);
    p.group.traverse((o) => { const m = o as Mesh; if (m.geometry) { m.geometry.dispose(); (m.material as ShaderMaterial).dispose(); } });
    this.projectiles.delete(id);
    const d = CHARACTERS[p.char];
    const [r, g, b] = hdr(d.accent, 4);
    this.add.emit({ x, y, z: 0.2, life: 0.15, size: 1.4, sizeEnd: 0.4, r: 3, g: 3, b: 3 });
    for (let i = 0; i < this.n(45); i++) {
      const a = Math.random() * Math.PI * 2;
      const s = rnd(3, 12);
      this.add.emit({ x, y, z: 0.2, vx: Math.cos(a) * s, vy: Math.sin(a) * s, vz: rnd(-4, 4), life: rnd(0.2, 0.55), size: 0.045, r, g, b, stretch: 0.05, drag: 3, gravity: -6 });
    }
    this.ring(v.set(x, y, 0.2), [r, g, b], 3.2, 0.35);
    this.flashLight(v.set(x, y, 0.6), d.accent, 30, 0.22);
    if (p.char === 'phloeng') this.flames(v.set(x, y, 0.2), 1.6, this.n(30));
    if (p.char === 'vayu') this.zap(v.set(x, y, 0.2), 1.6, 6, 0.2);
  }

  private updateProjectiles(dt: number) {
    for (const p of this.projectiles.values()) {
      p.age += dt;
      const d = CHARACTERS[p.char];
      const pos = p.group.position;
      (p.core.material as ShaderMaterial).uniforms.uTime.value = this.time;
      const pulse = 1 + Math.sin(this.time * 35) * 0.08;
      if (p.char !== 'chantra') p.core.scale.setScalar(pulse);
      if (p.extra) {
        (p.extra.material as ShaderMaterial).uniforms.uTime.value = this.time;
        if (p.char === 'chantra') { p.extra.rotation.z = -this.time * 18 * p.dir; }
        else { p.extra.rotation.x = this.time * 9; p.extra.rotation.y = this.time * 6; }
      }
      const [r, g, b] = hdr(d.accent, 3);
      const k = this.n(p.char === 'phloeng' ? 6 : 4);
      for (let i = 0; i < k; i++) {
        if (p.char === 'phloeng') {
          this.add.emit({
            x: pos.x + rnd(-0.25, 0.25), y: pos.y + rnd(-0.25, 0.25), z: pos.z + rnd(-0.2, 0.2), vx: -p.dir * rnd(1, 4), vy: rnd(0.5, 2.5), vz: rnd(-0.5, 0.5),
            life: rnd(0.25, 0.5), size: rnd(0.25, 0.45), sizeEnd: 0.05, r: 4.5, g: rnd(1.2, 2.4), b: 0.3, drag: 1, gravity: 2,
          });
          if (Math.random() < 0.3) this.alpha.emit({ x: pos.x - p.dir * 0.4, y: pos.y + 0.1, z: pos.z, vx: -p.dir, vy: 1, life: 0.9, size: 0.3, sizeEnd: 0.9, r: 0.12, g: 0.08, b: 0.1, alpha: 0.4, drag: 1 });
        } else {
          this.add.emit({
            x: pos.x + rnd(-0.15, 0.15), y: pos.y + rnd(-0.15, 0.15), z: pos.z, vx: -p.dir * rnd(0.5, 2), vy: rnd(-0.5, 0.5), vz: rnd(-0.5, 0.5),
            life: rnd(0.2, 0.45), size: rnd(0.12, 0.25), sizeEnd: 0.02, r, g, b, drag: 2,
          });
        }
      }
      if (p.char === 'chantra') this.sparkles(pos, 0.4, this.n(2));
      if (p.char === 'vayu' && this.quality.detail >= 0.6) {
        for (let i = 0; i < 3; i++) {
          const a = Math.random() * Math.PI * 2;
          const bpos = new Vector3(pos.x + Math.cos(a) * 0.65, pos.y + Math.sin(a) * 0.65, pos.z + rnd(-0.3, 0.3));
          this.arcs.arc(pos, bpos, 6, 0.12, 0.018, this.eye);
        }
      }
    }
  }

  // ───────────────────────────── super ─────────────────────────────

  superCharge(center: Vector3, char: CharId, t: number) {
    const d = CHARACTERS[char];
    const [r, g, b] = hdr(d.accent, 4);
    for (let i = 0; i < this.n(10); i++) {
      const a = Math.random() * Math.PI * 2;
      const el = rnd(-1, 1);
      const R = rnd(1.4, 2.6);
      const p = new Vector3(Math.cos(a) * R, Math.sin(a) * R * 0.8 + el * 0.4, rnd(-1, 1)).add(center);
      const vel = new Vector3().subVectors(center, p).multiplyScalar(rnd(2.5, 4));
      this.add.emit({ x: p.x, y: p.y, z: p.z, vx: vel.x, vy: vel.y, vz: vel.z, life: 0.32, size: rnd(0.03, 0.06), r, g, b, stretch: 0.06 });
    }
    this.add.emit({ x: center.x, y: center.y, z: center.z, life: 0.08, size: 0.4 + t * 0.9, r: r * 0.35, g: g * 0.35, b: b * 0.35 });
    if (char === 'vayu' && Math.random() < 0.5) this.zap(center, 1.2, 2, 0.06);
  }

  // ───────────────────────────── per frame ─────────────────────────────

  update(dt: number, time: number) {
    this.time = time;
    this.eye.setFromMatrixPosition(this.camera.matrixWorld);
    this.arcs.begin();
    this.updateProjectiles(dt);
    for (let i = this.zapTimer.length - 1; i >= 0; i--) {
      const z = this.zapTimer[i];
      z.life -= dt;
      for (let k = 0; k < z.n; k++) {
        const a = Math.random() * Math.PI * 2;
        const e = new Vector3(Math.cos(a), Math.sin(a), rnd(-0.5, 0.5)).multiplyScalar(z.r * rnd(0.5, 1)).add(z.pos);
        this.arcs.arc(z.pos, e, 7, z.r * 0.18, 0.022, this.eye);
      }
      if (z.life <= 0) this.zapTimer.splice(i, 1);
    }
    this.arcs.end();
    this.beam.update(dt, time);
    this.add.update(dt);
    this.alpha.update(dt);
    for (const l of this.lights) {
      if (l.owner >= 0) continue;
      if (l.life > 0) {
        l.life -= dt;
        const k = Math.max(0, l.life / l.max);
        l.light.intensity = l.peak * k * k;
      } else {
        l.light.intensity = 0;
      }
    }
    for (const r of this.rings) {
      if (r.life <= 0) { r.mesh.visible = false; continue; }
      r.life -= dt;
      const t = 1 - Math.max(0, r.life) / r.max;
      r.mat.uniforms.uT.value = t;
      r.mesh.scale.setScalar(r.size);
      if (r.flat) r.mesh.rotation.set(-Math.PI / 2, 0, 0);
      else r.mesh.quaternion.copy(this.camera.quaternion);
    }
  }

  private beamLightIdx = -1;

  beamLight(x: number, y: number, color: number, on: boolean) {
    if (on) {
      if (this.beamLightIdx < 0) this.beamLightIdx = this.acquireLight(9999);
      if (this.beamLightIdx >= 0) {
        const l = this.lights[this.beamLightIdx].light;
        l.position.set(x, y, 1);
        l.color.set(color);
        l.intensity = 55 + Math.sin(this.time * 50) * 12;
        l.distance = 22;
      }
    } else if (this.beamLightIdx >= 0) {
      this.lights[this.beamLightIdx].light.distance = 14;
      this.releaseLight(this.beamLightIdx);
      this.beamLightIdx = -1;
    }
  }

  clearAll() {
    for (const id of [...this.projectiles.keys()]) {
      const p = this.projectiles.get(id)!;
      this.releaseLight(p.light);
      this.group.remove(p.group);
      this.projectiles.delete(id);
    }
    this.beam.stop();
    this.beamLight(0, 0, 0, false);
    this.add.clear();
    this.alpha.clear();
  }
}
