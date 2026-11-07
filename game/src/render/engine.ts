// Renderer, post-processing chain and planar reflections.
import {
  ACESFilmicToneMapping, Color, HalfFloatType, Matrix4, Mesh, PCFShadowMap, PerspectiveCamera, Plane,
  Scene, SRGBColorSpace, Vector2, Vector3, Vector4, WebGLRenderTarget, WebGLRenderer, type Object3D,
} from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { FXAAPass } from 'three/examples/jsm/postprocessing/FXAAPass.js';
import { QUALITY, type Quality } from './quality';

/** Layer for things that should not appear in the floor reflection (rain, mist). */
export const LAYER_NO_REFLECT = 1;

const FX_SHADER = {
  uniforms: {
    tDiffuse: { value: null },
    uLight: { value: new Vector2(0.5, 0.7) },
    uGodRays: { value: 0 },
    uRadial: { value: 0 },
    uCenter: { value: new Vector2(0.5, 0.5) },
    uCA: { value: 0 },
    uFlash: { value: 0 },
    uFlashColor: { value: new Color(1, 1, 1) },
    uDarken: { value: 0 },
    uAspect: { value: 1.7 },
  },
  defines: { GR_SAMPLES: 48 },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 uLight;
    uniform float uGodRays;
    uniform float uRadial;
    uniform vec2 uCenter;
    uniform float uCA;
    uniform float uFlash;
    uniform vec3 uFlashColor;
    uniform float uDarken;
    uniform float uAspect;
    varying vec2 vUv;

    vec3 sampleCA(vec2 uv) {
      if (uCA < 0.0005) return texture2D(tDiffuse, uv).rgb;
      vec2 d = (uv - 0.5) * uCA;
      return vec3(texture2D(tDiffuse, uv + d).r, texture2D(tDiffuse, uv).g, texture2D(tDiffuse, uv - d).b);
    }

    void main() {
      vec3 col;
      if (uRadial > 0.001) {
        vec2 dir = (vUv - uCenter) * uRadial;
        col = vec3(0.0);
        float wsum = 0.0;
        for (int i = 0; i < 12; i++) {
          float t = float(i) / 11.0;
          float w = 1.0 - t * 0.6;
          col += sampleCA(vUv - dir * t) * w;
          wsum += w;
        }
        col /= wsum;
      } else {
        col = sampleCA(vUv);
      }
      #if GR_SAMPLES > 0
      if (uGodRays > 0.001) {
        vec2 delta = (vUv - uLight) / float(GR_SAMPLES) * 0.92;
        vec2 p = vUv;
        float decay = 1.0;
        vec3 rays = vec3(0.0);
        for (int i = 0; i < GR_SAMPLES; i++) {
          p -= delta;
          vec3 s = texture2D(tDiffuse, p).rgb;
          float l = max(max(s.r, s.g), s.b);
          vec2 dl = (p - uLight) * vec2(uAspect, 1.0);
          float nearLight = 1.0 - smoothstep(0.02, 0.22, length(dl));
          rays += min(s, vec3(8.0)) * smoothstep(2.5, 5.0, l) * nearLight * decay;
          decay *= 0.965;
        }
        vec2 q = (vUv - uLight) * vec2(uAspect, 1.0);
        float fall = 1.0 / (1.0 + dot(q, q) * 3.0);
        col += rays / float(GR_SAMPLES) * uGodRays * fall;
      }
      #endif
      float lum = max(max(col.r, col.g), col.b);
      col = mix(col, col * 0.16 + max(col - 1.2, 0.0) * 0.9, uDarken * (1.0 - smoothstep(1.0, 3.0, lum) * 0.6));
      col += uFlashColor * uFlash;
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

const GRADE_SHADER = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uVignette: { value: 1 },
    uGrain: { value: 0.035 },
    uSpeed: { value: 0 },
    uBars: { value: 0 },
    uAspect: { value: 1.7 },
    uSat: { value: 1.08 },
    uTint: { value: new Color(1, 1, 1) },
  },
  vertexShader: FX_SHADER.vertexShader,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uVignette;
    uniform float uGrain;
    uniform float uSpeed;
    uniform float uBars;
    uniform float uAspect;
    uniform float uSat;
    uniform vec3 uTint;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec3 col = texture2D(tDiffuse, vUv).rgb;
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(vec3(l), col, uSat) * uTint;
      // Gentle S-curve for punch.
      col = clamp(col, 0.0, 1.0);
      col = mix(col, col * col * (3.0 - 2.0 * col), 0.22);
      vec2 q = (vUv - 0.5) * vec2(uAspect, 1.0);
      float r = length(q);
      col *= mix(1.0, smoothstep(1.25, 0.35, r), 0.55 * uVignette);
      if (uSpeed > 0.001) {
        float a = atan(q.y, q.x);
        float n = hash(vec2(floor(a * 90.0), floor(uTime * 24.0)));
        float line = step(0.82, n) * smoothstep(0.32, 0.9, r);
        col = mix(col, vec3(1.0), line * uSpeed * 0.55);
      }
      col += (hash(vUv * 1024.0 + fract(uTime * 7.13)) - 0.5) * uGrain;
      float bar = uBars * 0.12;
      if (vUv.y < bar || vUv.y > 1.0 - bar) col = vec3(0.0);
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

/** Planar mirror for the wet arena floor (adapted from three's Reflector). */
export class Mirror {
  readonly target: WebGLRenderTarget;
  readonly textureMatrix = new Matrix4();
  readonly camera = new PerspectiveCamera();
  private readonly plane = new Plane();
  private readonly normal = new Vector3(0, 1, 0);
  private readonly clipPlane = new Vector4();
  private readonly q = new Vector4();
  private readonly mirrorPos = new Vector3(0, 0, 0);
  private readonly camPos = new Vector3();
  private readonly rot = new Matrix4();
  private readonly lookAt = new Vector3();
  private readonly view = new Vector3();
  private readonly tgt = new Vector3();
  scale = 0.5;
  enabled = true;

  constructor() {
    this.target = new WebGLRenderTarget(16, 16, { type: HalfFloatType, samples: 0 });
    this.camera.layers.set(0);
  }

  setSize(w: number, h: number) {
    this.target.setSize(Math.max(16, Math.round(w * this.scale)), Math.max(16, Math.round(h * this.scale)));
  }

  render(renderer: WebGLRenderer, scene: Scene, camera: PerspectiveCamera, hide: Object3D[]) {
    if (!this.enabled) return;
    this.camPos.setFromMatrixPosition(camera.matrixWorld);
    this.view.subVectors(this.mirrorPos, this.camPos);
    if (this.view.dot(this.normal) > 0) return;
    this.view.reflect(this.normal).negate().add(this.mirrorPos);
    this.rot.extractRotation(camera.matrixWorld);
    this.lookAt.set(0, 0, -1).applyMatrix4(this.rot).add(this.camPos);
    this.tgt.subVectors(this.mirrorPos, this.lookAt).reflect(this.normal).negate().add(this.mirrorPos);
    const vc = this.camera;
    vc.position.copy(this.view);
    vc.up.set(0, 1, 0).applyMatrix4(this.rot).reflect(this.normal);
    vc.lookAt(this.tgt);
    vc.far = camera.far;
    vc.updateMatrixWorld();
    vc.projectionMatrix.copy(camera.projectionMatrix);
    this.textureMatrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    this.textureMatrix.multiply(vc.projectionMatrix).multiply(vc.matrixWorldInverse);
    this.plane.setFromNormalAndCoplanarPoint(this.normal, this.mirrorPos);
    this.plane.applyMatrix4(vc.matrixWorldInverse);
    this.clipPlane.set(this.plane.normal.x, this.plane.normal.y, this.plane.normal.z, this.plane.constant);
    const pm = vc.projectionMatrix.elements;
    this.q.x = (Math.sign(this.clipPlane.x) + pm[8]) / pm[0];
    this.q.y = (Math.sign(this.clipPlane.y) + pm[9]) / pm[5];
    this.q.z = -1;
    this.q.w = (1 + pm[10]) / pm[14];
    this.clipPlane.multiplyScalar(2 / this.clipPlane.dot(this.q));
    pm[2] = this.clipPlane.x;
    pm[6] = this.clipPlane.y;
    pm[10] = this.clipPlane.z + 1 - 0.003;
    pm[14] = this.clipPlane.w;

    for (const o of hide) o.visible = false;
    const prevTarget = renderer.getRenderTarget();
    renderer.setRenderTarget(this.target);
    renderer.state.buffers.depth.setMask(true);
    if (renderer.autoClear === false) renderer.clear();
    renderer.render(scene, vc);
    renderer.setRenderTarget(prevTarget);
    for (const o of hide) o.visible = true;
  }
}

export interface PostFx {
  /** Chromatic aberration amount. */
  ca: number;
  radial: number;
  center: Vector2;
  flash: number;
  flashColor: Color;
  darken: number;
  speed: number;
  bars: number;
  godRays: number;
  light: Vector2;
}

export class Engine {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(36, 1, 0.1, 1500);
  readonly mirror = new Mirror();
  composer!: EffectComposer;
  private renderPass!: RenderPass;
  bloom!: UnrealBloomPass;
  private fxPass!: ShaderPass;
  private fxaa!: FXAAPass;
  private grade!: ShaderPass;
  quality: Quality = QUALITY.high;
  readonly post: PostFx = {
    ca: 0, radial: 0, center: new Vector2(0.5, 0.5), flash: 0, flashColor: new Color(1, 1, 1),
    darken: 0, speed: 0, bars: 0, godRays: 1, light: new Vector2(0.5, 0.75),
  };
  /** Meshes hidden while the mirror renders (the floor itself). */
  readonly mirrorHide: Object3D[] = [];
  width = 1;
  height = 1;
  private time = 0;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.renderer = new WebGLRenderer({
      canvas, antialias: false, powerPreference: 'high-performance', stencil: false, depth: true, alpha: false,
    });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.type = PCFShadowMap;
    this.camera.layers.enable(LAYER_NO_REFLECT);
    this.buildComposer();
  }

  get maxSamples() {
    return this.renderer.capabilities.maxSamples ?? 4;
  }

  private buildComposer() {
    const q = this.quality;
    const samples = Math.min(q.msaa, this.maxSamples);
    const rt = new WebGLRenderTarget(this.width, this.height, { type: HalfFloatType, samples });
    this.composer?.dispose();
    this.composer = new EffectComposer(this.renderer, rt);
    this.renderPass ??= new RenderPass(this.scene, this.camera);
    this.bloom ??= new UnrealBloomPass(new Vector2(256, 256), 0.75, 0.42, 1.05);
    if (!this.fxPass) this.fxPass = new ShaderPass(FX_SHADER);
    this.fxaa ??= new FXAAPass();
    if (!this.grade) this.grade = new ShaderPass(GRADE_SHADER);
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.bloom);
    this.composer.addPass(this.fxPass);
    this.composer.addPass(new OutputPass());
    if (q.fxaa) this.composer.addPass(this.fxaa);
    this.composer.addPass(this.grade);
  }

  setQuality(q: Quality) {
    const shadowChange = (q.shadows > 0) !== (this.quality.shadows > 0);
    this.quality = q;
    this.renderer.shadowMap.enabled = q.shadows > 0;
    this.mirror.enabled = q.reflection > 0;
    this.mirror.scale = q.reflection || 0.25;
    const defines = this.fxPass?.material.defines as Record<string, number> | undefined;
    this.buildComposer();
    const fxDefines = this.fxPass.material.defines as Record<string, number>;
    if (!defines || defines.GR_SAMPLES !== q.godRays) {
      fxDefines.GR_SAMPLES = q.godRays;
      this.fxPass.material.needsUpdate = true;
    }
    if (shadowChange) {
      this.scene.traverse((o) => {
        const m = (o as Mesh).material;
        if (!m) return;
        for (const mat of Array.isArray(m) ? m : [m]) mat.needsUpdate = true;
      });
    }
    this.resize(this.width, this.height, true);
  }

  resize(w: number, h: number, force = false) {
    if (!force && w === this.width && h === this.height) return;
    this.width = Math.max(1, w);
    this.height = Math.max(1, h);
    const pr = Math.min(window.devicePixelRatio || 1, this.quality.maxPixelRatio);
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(this.width, this.height, false);
    this.composer.setPixelRatio(pr);
    this.composer.setSize(this.width, this.height);
    const bw = Math.round(this.width * pr * this.quality.bloomScale);
    const bh = Math.round(this.height * pr * this.quality.bloomScale);
    this.bloom.setSize(bw, bh);
    this.fxaa.setSize(this.width * pr, this.height * pr);
    this.mirror.setSize(this.width * pr, this.height * pr);
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
    const aspect = this.width / this.height;
    this.fxPass.uniforms.uAspect.value = aspect;
    this.grade.uniforms.uAspect.value = aspect;
  }

  render(dt: number) {
    this.time += dt;
    const p = this.post;
    const fu = this.fxPass.uniforms;
    fu.uCA.value = p.ca;
    fu.uRadial.value = p.radial;
    fu.uCenter.value.copy(p.center);
    fu.uFlash.value = p.flash;
    fu.uFlashColor.value.copy(p.flashColor);
    fu.uDarken.value = p.darken;
    fu.uGodRays.value = this.quality.godRays > 0 ? p.godRays : 0;
    fu.uLight.value.copy(p.light);
    const gu = this.grade.uniforms;
    gu.uTime.value = this.time;
    gu.uSpeed.value = p.speed;
    gu.uBars.value = p.bars;
    this.camera.updateMatrixWorld();
    // Shadows are drawn once per frame and shared by the mirror and main passes.
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.shadowMap.needsUpdate = true;
    this.mirror.render(this.renderer, this.scene, this.camera, this.mirrorHide);
    this.composer.render(dt);
  }
}
