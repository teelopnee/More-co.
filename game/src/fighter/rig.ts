// Procedural armoured fighter: a joint hierarchy dressed with primitives, PBR armour with an
// energy rim light, glowing seams, and a verlet-simulated scarf.
import {
  AdditiveBlending, BufferAttribute, BufferGeometry, CapsuleGeometry, Color, ConeGeometry, CylinderGeometry,
  DoubleSide, Group, Mesh, MeshBasicMaterial, MeshPhysicalMaterial, Object3D, OctahedronGeometry, Quaternion,
  ShaderMaterial, SphereGeometry, TorusGeometry, Vector3, type BufferGeometry as BG, type Material,
} from 'three';
import type { CharacterDef } from '../data/characters';

export const JOINTS = [
  'hips', 'spine', 'chest', 'neck', 'head',
  'armL', 'foreL', 'handL', 'armR', 'foreR', 'handR',
  'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR',
] as const;
export type Joint = (typeof JOINTS)[number];

export const HIP_HEIGHT = 1.0;

const PARENT: Record<Joint, Joint | null> = {
  hips: null, spine: 'hips', chest: 'spine', neck: 'chest', head: 'neck',
  armL: 'chest', foreL: 'armL', handL: 'foreL', armR: 'chest', foreR: 'armR', handR: 'foreR',
  thighL: 'hips', shinL: 'thighL', footL: 'shinL', thighR: 'hips', shinR: 'thighR', footR: 'shinR',
};

const OFFSET: Record<Joint, [number, number, number]> = {
  hips: [0, HIP_HEIGHT, 0], spine: [0, 0.1, 0], chest: [0, 0.2, 0], neck: [0, 0.27, 0], head: [0, 0.08, 0],
  armL: [0.215, 0.2, -0.01], foreL: [0, -0.29, 0], handL: [0, -0.27, 0],
  armR: [-0.215, 0.2, -0.01], foreR: [0, -0.29, 0], handR: [0, -0.27, 0],
  thighL: [0.1, -0.04, 0], shinL: [0, -0.45, 0], footL: [0, -0.44, 0],
  thighR: [-0.1, -0.04, 0], shinR: [0, -0.45, 0], footR: [0, -0.44, 0],
};

/** Adds a coloured fresnel rim to a physical material. */
function addRim(mat: MeshPhysicalMaterial, rim: Color, power: number, strength: { value: number }) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uRimColor = { value: rim };
    shader.uniforms.uRimPower = { value: power };
    shader.uniforms.uRimStrength = strength;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uRimColor;\nuniform float uRimPower;\nuniform float uRimStrength;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          float ndv = clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
          totalEmissiveRadiance += uRimColor * pow(1.0 - ndv, uRimPower) * uRimStrength;
        }`);
  };
  mat.customProgramCacheKey = () => 'rim';
}

export interface RigMaterials {
  armor: MeshPhysicalMaterial;
  suit: MeshPhysicalMaterial;
  glow: MeshBasicMaterial;
  trim: MeshPhysicalMaterial;
  rimStrength: { value: number };
}

/** A verlet ribbon hanging from an anchor (scarf, ribbons, ponytail). */
export class Ribbon {
  readonly mesh: Mesh;
  private readonly pts: Vector3[] = [];
  private readonly prev: Vector3[] = [];
  private readonly geo: BufferGeometry;
  private readonly tmp = new Vector3();
  private readonly anchorW = new Vector3();
  private acc = 0;
  private ready = false;

  constructor(
    private readonly anchor: Object3D,
    private readonly offset: Vector3,
    private readonly segments: number,
    private readonly segLen: number,
    private readonly width: number,
    base: Color,
    tip: Color,
  ) {
    for (let i = 0; i <= segments; i++) { this.pts.push(new Vector3()); this.prev.push(new Vector3()); }
    this.geo = new BufferGeometry();
    const n = segments + 1;
    this.geo.setAttribute('position', new BufferAttribute(new Float32Array(n * 2 * 3), 3));
    const uv = new Float32Array(n * 2 * 2);
    for (let i = 0; i < n; i++) { uv.set([0, i / segments, 1, i / segments], i * 4); }
    this.geo.setAttribute('uv', new BufferAttribute(uv, 2));
    const idx: number[] = [];
    for (let i = 0; i < segments; i++) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
    this.geo.setIndex(idx);
    const mat = new ShaderMaterial({
      uniforms: { uBase: { value: base }, uTip: { value: tip }, uBoost: { value: 1 } },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        #include <fog_pars_vertex>
        void main() {
          vUv = uv;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uBase;
        uniform vec3 uTip;
        uniform float uBoost;
        varying vec2 vUv;
        #include <fog_pars_fragment>
        void main() {
          float t = vUv.y;
          float edge = pow(abs(vUv.x * 2.0 - 1.0), 6.0);
          vec3 c = mix(uBase, uTip * uBoost, smoothstep(0.15, 1.0, t));
          c += uTip * uBoost * edge * 0.8;
          float stripe = smoothstep(0.92, 1.0, fract(t * 6.0)) * 0.6;
          c += uTip * stripe * t;
          gl_FragColor = vec4(c, 1.0);
          #include <fog_fragment>
        }
      `,
      side: DoubleSide,
      fog: true,
    });
    this.mesh = new Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
  }

  get material() {
    return this.mesh.material as ShaderMaterial;
  }

  reset() {
    this.ready = false;
  }

  update(dt: number, eye: Vector3, wind: Vector3) {
    this.anchor.updateWorldMatrix(true, false);
    this.anchorW.copy(this.offset).applyMatrix4(this.anchor.matrixWorld);
    if (!this.ready) {
      for (let i = 0; i < this.pts.length; i++) {
        this.pts[i].copy(this.anchorW).add(this.tmp.set(0, -i * this.segLen, -i * this.segLen * 0.3));
        this.prev[i].copy(this.pts[i]);
      }
      this.ready = true;
    }
    this.acc = Math.min(this.acc + dt, 0.05);
    const h = 1 / 120;
    while (this.acc >= h) {
      this.acc -= h;
      this.pts[0].copy(this.anchorW);
      this.prev[0].copy(this.anchorW);
      for (let i = 1; i < this.pts.length; i++) {
        const p = this.pts[i], q = this.prev[i];
        const vx = (p.x - q.x) * 0.985, vy = (p.y - q.y) * 0.985, vz = (p.z - q.z) * 0.985;
        q.copy(p);
        const flutter = Math.sin(performance.now() * 0.006 + i * 0.9) * 0.6;
        p.x += vx + (wind.x + flutter * wind.length() * 0.3) * h * h;
        p.y += vy + (-9.8 + wind.y) * h * h * 0.6;
        p.z += vz + (wind.z + flutter * 1.5) * h * h;
        if (p.y < 0.02) p.y = 0.02;
      }
      for (let it = 0; it < 3; it++) {
        for (let i = 0; i < this.pts.length - 1; i++) {
          const a = this.pts[i], b = this.pts[i + 1];
          this.tmp.subVectors(b, a);
          const d = this.tmp.length() || 1e-5;
          const diff = (d - this.segLen) / d;
          if (i === 0) b.addScaledVector(this.tmp, -diff);
          else { a.addScaledVector(this.tmp, diff * 0.5); b.addScaledVector(this.tmp, -diff * 0.5); }
        }
      }
    }
    // Build a camera-facing strip.
    const pos = this.geo.attributes.position as BufferAttribute;
    const t = new Vector3(), v = new Vector3(), s = new Vector3();
    for (let i = 0; i < this.pts.length; i++) {
      const p = this.pts[i];
      const a = this.pts[Math.max(0, i - 1)], b = this.pts[Math.min(this.pts.length - 1, i + 1)];
      t.subVectors(b, a).normalize();
      v.subVectors(eye, p).normalize();
      s.crossVectors(t, v).normalize();
      const w = this.width * (1 - (i / this.pts.length) * 0.55);
      pos.setXYZ(i * 2, p.x + s.x * w, p.y + s.y * w, p.z + s.z * w);
      pos.setXYZ(i * 2 + 1, p.x - s.x * w, p.y - s.y * w, p.z - s.z * w);
    }
    pos.needsUpdate = true;
  }
}

export class Rig {
  readonly root = new Group();
  /** Rotates the whole body (flips) around the hips. */
  readonly pivot = new Group();
  readonly joints = {} as Record<Joint, Object3D>;
  readonly rest = {} as Record<Joint, Vector3>;
  readonly mats: RigMaterials;
  readonly ribbons: Ribbon[] = [];
  readonly meshes: Mesh[] = [];
  /** Extra glowing parts animated by the view (halo, flame crest). */
  readonly halo: Object3D | null = null;
  readonly accent: Color;
  readonly accent2: Color;

  constructor(readonly def: CharacterDef, ghost = false) {
    this.accent = new Color(def.accent);
    this.accent2 = new Color(def.accent2);
    const rimStrength = { value: 1 };
    const armor = new MeshPhysicalMaterial({
      color: def.armor, metalness: def.id === 'chantra' ? 0.55 : 0.85, roughness: def.id === 'chantra' ? 0.24 : 0.3,
      clearcoat: 1, clearcoatRoughness: 0.12, envMapIntensity: 1.4,
    });
    const suit = new MeshPhysicalMaterial({
      color: def.suit, metalness: 0.1, roughness: 0.62, sheen: 1, sheenRoughness: 0.4,
      sheenColor: new Color(def.accent).multiplyScalar(0.35), envMapIntensity: 0.8,
    });
    const trim = new MeshPhysicalMaterial({ color: 0xd8a84e, metalness: 1, roughness: 0.22, clearcoat: 0.6, envMapIntensity: 1.6 });
    const rim = new Color(def.accent).multiplyScalar(1.3);
    addRim(armor, rim, 2.6, rimStrength);
    addRim(suit, rim.clone().multiplyScalar(0.7), 3.0, rimStrength);
    addRim(trim, rim.clone().multiplyScalar(0.5), 3.0, rimStrength);
    const glow = new MeshBasicMaterial({ color: new Color(def.accent).multiplyScalar(4.5) });
    this.mats = { armor, suit, glow, trim, rimStrength };

    // Skeleton.
    for (const j of JOINTS) {
      const o = new Object3D();
      o.name = j;
      const off = OFFSET[j];
      const [bw, bulk] = def.build;
      const sx = j.startsWith('arm') ? bw : 1;
      o.position.set(off[0] * sx, off[1], off[2]);
      this.rest[j] = o.position.clone();
      this.joints[j] = o;
      const parent = PARENT[j];
      if (parent) this.joints[parent].add(o);
      void bulk;
    }
    this.root.add(this.pivot);
    this.pivot.add(this.joints.hips);
    this.dress(ghost);
    const h = def.build[2];
    this.root.scale.setScalar(h);

    if (!ghost) {
      const base = new Color(def.suit).lerp(new Color(def.accent), 0.25);
      const tip = new Color(def.accent2).multiplyScalar(3);
      if (def.id === 'chantra') {
        this.ribbons.push(new Ribbon(this.joints.chest, new Vector3(0.09, 0.25, -0.12), 14, 0.075, 0.045, base, tip));
        this.ribbons.push(new Ribbon(this.joints.chest, new Vector3(-0.09, 0.25, -0.12), 14, 0.075, 0.045, base, tip));
        this.ribbons.push(new Ribbon(this.joints.head, new Vector3(0, 0.2, -0.09), 10, 0.07, 0.035, base, new Color(def.accent).multiplyScalar(3)));
      } else if (def.id === 'phloeng') {
        this.ribbons.push(new Ribbon(this.joints.chest, new Vector3(0, 0.22, -0.13), 9, 0.085, 0.075, base, tip));
        this.ribbons.push(new Ribbon(this.joints.hips, new Vector3(0.06, 0.02, -0.12), 7, 0.08, 0.05, base, tip));
      } else {
        this.ribbons.push(new Ribbon(this.joints.chest, new Vector3(0.04, 0.24, -0.12), 16, 0.085, 0.06, base, tip));
        this.ribbons.push(new Ribbon(this.joints.chest, new Vector3(-0.05, 0.24, -0.12), 12, 0.08, 0.045, base, tip));
      }
    }
  }

  private add(j: Joint, geo: BG, mat: Material, pos: [number, number, number], scale?: [number, number, number], rot?: [number, number, number]) {
    const m = new Mesh(geo, mat);
    m.position.set(...pos);
    if (scale) m.scale.set(...scale);
    if (rot) m.rotation.set(...rot);
    m.castShadow = mat !== this.mats.glow;
    m.receiveShadow = true;
    this.joints[j].add(m);
    this.meshes.push(m);
    return m;
  }

  private dress(ghost: boolean) {
    const { armor, suit, glow, trim } = this.mats;
    const id = this.def.id;
    const [bw, bulk] = this.def.build;
    const sph = new SphereGeometry(1, 24, 16);
    const sphLo = new SphereGeometry(1, 16, 10);
    const cap = (r: number, l: number) => new CapsuleGeometry(r, l, 6, 14);

    // Pelvis & belt.
    this.add('hips', sph, suit, [0, -0.02, 0], [0.16 * bulk, 0.12, 0.115 * bulk]);
    this.add('hips', new TorusGeometry(0.15, 0.028, 8, 28), trim, [0, 0.05, 0], [bulk, 0.78 * bulk, 1], [Math.PI / 2, 0, 0]);
    this.add('hips', new OctahedronGeometry(0.04), glow, [0, 0.05, 0.12 * bulk]);
    // Tassets.
    for (const s of [-1, 1]) {
      this.add('hips', sphLo, armor, [s * 0.12 * bulk, -0.06, 0.02], [0.07, 0.11, 0.1], [0, 0, s * 0.25]);
    }
    this.add('hips', sphLo, armor, [0, -0.1, 0.1 * bulk], [0.08, 0.12, 0.03]);

    // Abdomen.
    this.add('spine', cap(0.1 * bulk, 0.1), suit, [0, 0.07, 0], [1, 1, 0.82]);
    this.add('spine', sphLo, armor, [0, 0.08, 0.07 * bulk], [0.08 * bulk, 0.08, 0.04]);

    // Chest.
    this.add('chest', sph, suit, [0, 0.12, 0], [0.2 * bw * bulk, 0.19, 0.13 * bulk]);
    this.add('chest', sph, armor, [0, 0.15, 0.035], [0.19 * bw * bulk, 0.15, 0.12 * bulk]);
    this.add('chest', sph, armor, [0, 0.13, -0.04], [0.18 * bw * bulk, 0.16, 0.1 * bulk]);
    const core = this.add('chest', new OctahedronGeometry(0.045, 0), glow, [0, 0.13, 0.155 * bulk], [1, 1.3, 0.6]);
    core.castShadow = false;
    // Glowing chest seams.
    for (const s of [-1, 1]) {
      this.add('chest', new CylinderGeometry(0.007, 0.007, 0.2, 5), glow, [s * 0.075 * bw, 0.15, 0.148 * bulk], undefined, [0, 0, s * 0.9]);
    }
    // Collar.
    this.add('chest', new TorusGeometry(0.085, 0.022, 8, 20), trim, [0, 0.255, -0.01], [1, 1, 1], [Math.PI / 2 + 0.2, 0, 0]);

    // Neck & head.
    this.add('neck', new CylinderGeometry(0.05, 0.058, 0.11, 12), suit, [0, 0.03, 0]);
    this.add('head', sph, armor, [0, 0.1, -0.005], [0.112, 0.125, 0.122]);
    this.add('head', sph, suit, [0, 0.05, 0.035], [0.088, 0.07, 0.09]);
    const visor = this.add('head', new TorusGeometry(0.104, 0.014, 6, 24, Math.PI * 0.62), glow, [0, 0.108, 0.0], [1, 0.75, 1.12], [Math.PI / 2, 0, Math.PI * 0.19]);
    visor.castShadow = false;
    // Character crests.
    if (id === 'vayu') {
      for (let i = 0; i < 4; i++) {
        this.add('head', new ConeGeometry(0.03 - i * 0.004, 0.24 - i * 0.03, 4), armor, [0, 0.2 - i * 0.035, -0.06 - i * 0.03], [1, 1, 0.4], [-1.9 + i * 0.15, 0, 0]);
      }
      for (const s of [-1, 1]) {
        this.add('head', new ConeGeometry(0.018, 0.16, 4), glow, [s * 0.1, 0.14, -0.02], [1, 1, 0.5], [-1.6, 0, s * 0.35]);
      }
    } else if (id === 'phloeng') {
      for (const s of [-1, 1]) {
        const horn = this.add('head', new ConeGeometry(0.028, 0.22, 8), trim, [s * 0.1, 0.19, 0.02], undefined, [-0.5, 0, -s * 0.7]);
        horn.scale.set(1, 1, 1);
      }
      for (let i = 0; i < 5; i++) {
        this.add('head', new ConeGeometry(0.025, 0.14, 5), glow, [(i - 2) * 0.03, 0.21 - Math.abs(i - 2) * 0.02, -0.06], undefined, [-1.0 - Math.abs(i - 2) * 0.1, 0, (i - 2) * -0.2]);
      }
    } else {
      const halo = new Mesh(new TorusGeometry(0.2, 0.012, 8, 48, Math.PI * 1.45), glow);
      halo.position.set(0, 0.14, -0.13);
      halo.rotation.set(0, 0, -Math.PI * 0.225);
      this.joints.head.add(halo);
      (this as { halo: Object3D | null }).halo = halo;
      this.add('head', new ConeGeometry(0.02, 0.12, 4), trim, [0, 0.24, 0.0], [1, 1, 0.5], [0.3, 0, 0]);
    }

    // Arms.
    for (const s of ['L', 'R'] as const) {
      const side = s === 'L' ? 1 : -1;
      const arm = `arm${s}` as Joint, fore = `fore${s}` as Joint, hand = `hand${s}` as Joint;
      const pad = id === 'phloeng' ? 1.25 : id === 'chantra' ? 0.9 : 1;
      this.add(arm, sph, armor, [side * 0.02, -0.01, 0], [0.105 * pad * bulk, 0.085 * pad, 0.1 * pad * bulk], [0, 0, side * 0.35]);
      this.add(arm, sph, trim, [side * 0.03, -0.075, 0], [0.09 * pad * bulk, 0.02, 0.085 * pad * bulk], [0, 0, side * 0.35]);
      if (id === 'phloeng') this.add(arm, new ConeGeometry(0.03, 0.12, 6), trim, [side * 0.07, 0.06, 0], undefined, [0, 0, -side * 0.6]);
      this.add(arm, cap(0.054 * bulk, 0.19), suit, [0, -0.14, 0]);
      this.add(fore, cap(0.048 * bulk, 0.16), suit, [0, -0.12, 0]);
      this.add(fore, new CylinderGeometry(0.06 * bulk, 0.068 * bulk, 0.17, 12), armor, [0, -0.15, 0]);
      this.add(fore, new TorusGeometry(0.066 * bulk, 0.009, 6, 20), glow, [0, -0.09, 0], undefined, [Math.PI / 2, 0, 0]);
      this.add(fore, new TorusGeometry(0.069 * bulk, 0.007, 6, 20), glow, [0, -0.2, 0], undefined, [Math.PI / 2, 0, 0]);
      this.add(hand, sph, armor, [0, -0.045, 0.005], [0.058 * bulk, 0.055, 0.064 * bulk]);
      this.add(hand, new CylinderGeometry(0.006, 0.006, 0.09, 4), glow, [0, -0.06, 0.06 * bulk], undefined, [0, 0, Math.PI / 2]);
    }

    // Legs.
    for (const s of ['L', 'R'] as const) {
      const thigh = `thigh${s}` as Joint, shin = `shin${s}` as Joint, foot = `foot${s}` as Joint;
      this.add(thigh, cap(0.078 * bulk, 0.3), suit, [0, -0.21, 0]);
      this.add(thigh, sphLo, armor, [0, -0.19, 0.045], [0.07 * bulk, 0.15, 0.05]);
      this.add(shin, cap(0.06 * bulk, 0.3), suit, [0, -0.21, 0]);
      this.add(shin, new CylinderGeometry(0.075 * bulk, 0.064 * bulk, 0.3, 12), armor, [0, -0.25, 0.005]);
      this.add(shin, sph, armor, [0, 0.0, 0.045], [0.07, 0.07, 0.06]);
      this.add(shin, new CylinderGeometry(0.006, 0.006, 0.22, 4), glow, [0, -0.24, 0.072 * bulk]);
      this.add(foot, sph, armor, [0, -0.03, 0.055], [0.062 * bulk, 0.045, 0.13]);
      this.add(foot, new TorusGeometry(0.066 * bulk, 0.008, 6, 18), glow, [0, 0.02, 0], [1, 1, 1], [Math.PI / 2, 0, 0]);
    }

    if (ghost) {
      const g = new MeshBasicMaterial({
        color: new Color(this.def.accent).multiplyScalar(1.4), transparent: true, opacity: 0.5,
        blending: AdditiveBlending, depthWrite: false,
      });
      for (const m of this.meshes) { m.material = g; m.castShadow = false; m.receiveShadow = false; }
      this.mats.glow = g;
    }
  }

  /** World position of a limb tip (fist or toe). */
  tip(limb: 'handL' | 'handR' | 'footL' | 'footR', out: Vector3) {
    const j = this.joints[limb];
    j.updateWorldMatrix(true, false);
    return out.set(0, limb.startsWith('hand') ? -0.06 : -0.03, limb.startsWith('foot') ? 0.14 : 0.02).applyMatrix4(j.matrixWorld);
  }

  copyPoseFrom(other: Rig) {
    this.root.position.copy(other.root.position);
    this.root.quaternion.copy(other.root.quaternion);
    this.root.scale.copy(other.root.scale);
    this.pivot.quaternion.copy(other.pivot.quaternion);
    this.pivot.position.copy(other.pivot.position);
    for (const j of JOINTS) {
      this.joints[j].quaternion.copy(other.joints[j].quaternion);
      this.joints[j].position.copy(other.joints[j].position);
    }
  }
}

export const tmpQ = new Quaternion();
