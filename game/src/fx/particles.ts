// CPU-simulated, GPU-instanced particles. Each particle is a camera-facing quad that can stretch
// along its screen-space velocity (sparks) or stay round (glows, smoke).
import {
  AdditiveBlending, BufferAttribute, DynamicDrawUsage, InstancedBufferAttribute, InstancedBufferGeometry, Mesh,
  NormalBlending, ShaderMaterial,
} from 'three';

export interface Emit {
  x: number; y: number; z: number;
  vx?: number; vy?: number; vz?: number;
  life: number;
  size: number;
  sizeEnd?: number;
  r: number; g: number; b: number;
  alpha?: number;
  drag?: number;
  gravity?: number;
  /** Screen-space stretch along velocity. */
  stretch?: number;
  /** 0 = additive glow look, 1 = soft smoke (alpha system only). */
}

export class Particles {
  readonly mesh: Mesh;
  private readonly geo: InstancedBufferGeometry;
  private readonly aPos: InstancedBufferAttribute;
  private readonly aVel: InstancedBufferAttribute;
  private readonly aCol: InstancedBufferAttribute;
  private readonly aData: InstancedBufferAttribute;
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly col: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly size0: Float32Array;
  private readonly size1: Float32Array;
  private readonly alpha: Float32Array;
  private readonly drag: Float32Array;
  private readonly grav: Float32Array;
  private readonly stretch: Float32Array;
  count = 0;
  cap: number;

  constructor(readonly max: number, additive: boolean) {
    this.cap = max;
    const quad = new InstancedBufferGeometry();
    quad.setAttribute('position', new BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]), 3));
    quad.setIndex([0, 1, 2, 0, 2, 3]);
    this.geo = quad;
    const mk = (n: number) => {
      const a = new InstancedBufferAttribute(new Float32Array(max * n), n);
      a.setUsage(DynamicDrawUsage);
      return a;
    };
    this.aPos = mk(3); this.aVel = mk(3); this.aCol = mk(3); this.aData = mk(3);
    quad.setAttribute('iPos', this.aPos);
    quad.setAttribute('iVel', this.aVel);
    quad.setAttribute('iCol', this.aCol);
    quad.setAttribute('iData', this.aData);
    quad.instanceCount = 0;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.size0 = new Float32Array(max);
    this.size1 = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.stretch = new Float32Array(max);

    const mat = new ShaderMaterial({
      vertexShader: /* glsl */ `
        attribute vec3 iPos;
        attribute vec3 iVel;
        attribute vec3 iCol;
        attribute vec3 iData; // size, alpha, stretch
        varying vec2 vUv;
        varying vec3 vCol;
        varying float vA;
        void main() {
          vec4 mv = viewMatrix * vec4(iPos, 1.0);
          vec3 vv = mat3(viewMatrix) * iVel;
          float sp = length(vv.xy);
          vec2 ay = sp > 1e-4 ? vv.xy / sp : vec2(0.0, 1.0);
          vec2 ax = vec2(-ay.y, ay.x);
          float len = iData.x * (1.0 + iData.z * sp);
          mv.xy += ax * position.x * iData.x + ay * position.y * len;
          gl_Position = projectionMatrix * mv;
          vUv = position.xy * 2.0;
          vCol = iCol;
          vA = iData.y;
        }
      `,
      fragmentShader: additive
        ? /* glsl */ `
          varying vec2 vUv;
          varying vec3 vCol;
          varying float vA;
          void main() {
            float d = length(vUv);
            if (d > 1.0) discard;
            float a = pow(1.0 - d, 1.8);
            vec3 c = vCol * a + vec3(1.0) * pow(max(0.0, 1.0 - d * 1.8), 3.0) * length(vCol) * 0.35;
            gl_FragColor = vec4(c * vA, 1.0);
          }`
        : /* glsl */ `
          varying vec2 vUv;
          varying vec3 vCol;
          varying float vA;
          void main() {
            float d = length(vUv);
            if (d > 1.0) discard;
            float a = smoothstep(1.0, 0.1, d) * vA;
            gl_FragColor = vec4(vCol, a);
          }`,
      transparent: true,
      depthWrite: false,
      blending: additive ? AdditiveBlending : NormalBlending,
      fog: false,
    });
    this.mesh = new Mesh(quad, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = additive ? 5 : 4;
  }

  emit(e: Emit) {
    let i = this.count;
    if (i >= this.cap) {
      // Overwrite a random old particle instead of dropping the newest effect.
      i = Math.floor(Math.random() * this.count);
    } else {
      this.count++;
    }
    const i3 = i * 3;
    this.pos[i3] = e.x; this.pos[i3 + 1] = e.y; this.pos[i3 + 2] = e.z;
    this.vel[i3] = e.vx ?? 0; this.vel[i3 + 1] = e.vy ?? 0; this.vel[i3 + 2] = e.vz ?? 0;
    this.col[i3] = e.r; this.col[i3 + 1] = e.g; this.col[i3 + 2] = e.b;
    this.life[i] = e.life;
    this.maxLife[i] = e.life;
    this.size0[i] = e.size;
    this.size1[i] = e.sizeEnd ?? e.size;
    this.alpha[i] = e.alpha ?? 1;
    this.drag[i] = e.drag ?? 0;
    this.grav[i] = e.gravity ?? 0;
    this.stretch[i] = e.stretch ?? 0;
  }

  update(dt: number) {
    const { pos, vel, col, life, maxLife } = this;
    const P = this.aPos.array as Float32Array;
    const V = this.aVel.array as Float32Array;
    const C = this.aCol.array as Float32Array;
    const D = this.aData.array as Float32Array;
    let n = this.count;
    for (let i = 0; i < n; i++) {
      life[i] -= dt;
      if (life[i] <= 0) {
        n--;
        if (i !== n) this.move(n, i);
        i--;
        continue;
      }
      const i3 = i * 3;
      const k = Math.exp(-this.drag[i] * dt);
      vel[i3] *= k; vel[i3 + 1] = vel[i3 + 1] * k + this.grav[i] * dt; vel[i3 + 2] *= k;
      pos[i3] += vel[i3] * dt; pos[i3 + 1] += vel[i3 + 1] * dt; pos[i3 + 2] += vel[i3 + 2] * dt;
      if (pos[i3 + 1] < 0.01 && vel[i3 + 1] < 0 && this.grav[i] < 0) { pos[i3 + 1] = 0.01; vel[i3 + 1] *= -0.35; vel[i3] *= 0.6; vel[i3 + 2] *= 0.6; }
      const t = 1 - life[i] / maxLife[i];
      const fadeIn = Math.min(1, t * 12);
      const fade = (1 - t) * (1 - t) * fadeIn * this.alpha[i];
      P[i3] = pos[i3]; P[i3 + 1] = pos[i3 + 1]; P[i3 + 2] = pos[i3 + 2];
      V[i3] = vel[i3]; V[i3 + 1] = vel[i3 + 1]; V[i3 + 2] = vel[i3 + 2];
      C[i3] = col[i3]; C[i3 + 1] = col[i3 + 1]; C[i3 + 2] = col[i3 + 2];
      D[i3] = this.size0[i] + (this.size1[i] - this.size0[i]) * t;
      D[i3 + 1] = fade;
      D[i3 + 2] = this.stretch[i];
    }
    this.count = n;
    this.geo.instanceCount = n;
    for (const a of [this.aPos, this.aVel, this.aCol, this.aData]) {
      a.clearUpdateRanges();
      a.addUpdateRange(0, n * 3);
      a.needsUpdate = true;
    }
  }

  private move(from: number, to: number) {
    const f3 = from * 3, t3 = to * 3;
    for (let k = 0; k < 3; k++) {
      this.pos[t3 + k] = this.pos[f3 + k];
      this.vel[t3 + k] = this.vel[f3 + k];
      this.col[t3 + k] = this.col[f3 + k];
    }
    this.life[to] = this.life[from];
    this.maxLife[to] = this.maxLife[from];
    this.size0[to] = this.size0[from];
    this.size1[to] = this.size1[from];
    this.alpha[to] = this.alpha[from];
    this.drag[to] = this.drag[from];
    this.grav[to] = this.grav[from];
    this.stretch[to] = this.stretch[from];
  }

  clear() {
    this.count = 0;
    this.geo.instanceCount = 0;
  }
}
