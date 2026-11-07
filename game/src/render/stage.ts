// The Storm Temple arena: sky, floating temple ruins, wet reflective floor, rain, lanterns, lightning.
import {
  AdditiveBlending, BackSide, BoxGeometry, BufferAttribute, BufferGeometry, CanvasTexture, Color, CylinderGeometry,
  DirectionalLight, DoubleSide, FogExp2, Group, HemisphereLight, IcosahedronGeometry, InstancedBufferAttribute,
  InstancedBufferGeometry, LatheGeometry, Mesh, MeshBasicMaterial, MeshStandardMaterial, OctahedronGeometry,
  PlaneGeometry, PMREMGenerator, PointLight, RepeatWrapping, Scene, ShaderMaterial, SphereGeometry, SRGBColorSpace,
  TorusGeometry, UniformsLib, UniformsUtils, Vector2, Vector3, type Texture, type WebGLRenderer,
} from 'three';
import { LAYER_NO_REFLECT, type Engine } from './engine';
import { NOISE } from './glsl';
import { MAX_LANTERNS, MAX_RAIN, type Quality } from './quality';

const rand = mulberry(7);
function mulberry(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rr = (a: number, b: number) => a + (b - a) * rand();

export const MOON_DIR = new Vector3(0.06, 0.25, -1).normalize();

const SKY_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uFlash;
  uniform vec3 uMoonDir;
  uniform float uSimple;
  varying vec3 vDir;
  ${NOISE}
  void main() {
    vec3 dir = normalize(vDir);
    float h = dir.y;
    vec3 zenith = vec3(0.006, 0.006, 0.03);
    vec3 mid = vec3(0.035, 0.022, 0.1);
    vec3 horizon = vec3(0.2, 0.07, 0.26);
    vec3 col = mix(horizon, mid, smoothstep(-0.02, 0.22, h));
    col = mix(col, zenith, smoothstep(0.22, 0.85, h));
    // Abyss below the horizon: deep teal haze.
    col = mix(col, vec3(0.02, 0.035, 0.07), smoothstep(0.0, -0.35, h));
    float md = dot(dir, uMoonDir);
    // Teal-gold atmosphere around the moon.
    col += vec3(0.12, 0.2, 0.36) * pow(max(md, 0.0), 14.0) * 0.45;
    col += vec3(0.7, 0.45, 0.3) * pow(max(md, 0.0), 120.0) * 0.35;

    // Stars.
    vec3 sd = dir * 260.0;
    float star = hash13(floor(sd));
    float tw = 0.6 + 0.4 * sin(uTime * 3.0 + star * 50.0);
    float starMask = step(0.9975, star) * smoothstep(0.05, 0.35, h);
    col += vec3(0.8, 0.85, 1.0) * starMask * tw * 1.6;

    // Moon disc with craters.
    float disc = smoothstep(0.9968, 0.99695, md);
    if (disc > 0.0) {
      vec3 up = vec3(0.0, 1.0, 0.0);
      vec3 mx = normalize(cross(up, uMoonDir));
      vec3 my = cross(uMoonDir, mx);
      vec2 mp = vec2(dot(dir, mx), dot(dir, my)) * 40.0;
      float cr = fbm(mp * 3.0) * 0.6 + vnoise(mp * 9.0) * 0.25;
      vec3 moon = vec3(5.5, 5.0, 4.3) * (0.62 + cr * 0.55);
      col = mix(col, moon, disc);
    }
    col += vec3(0.7, 0.75, 1.0) * pow(max(md, 0.0), 1400.0) * 1.6;

    // Storm clouds: two layers projected on a dome.
    if (uSimple < 0.5 && h > -0.12) {
      vec2 cuv = dir.xz / (h + 0.22);
      float t = uTime * 0.012;
      float n1 = fbm(cuv * 1.3 + vec2(t, t * 0.4));
      float n2 = fbm(cuv * 2.7 - vec2(t * 1.7, 0.0) + n1 * 1.2);
      float dens = smoothstep(0.42, 0.85, n1 * 0.6 + n2 * 0.55);
      dens *= smoothstep(-0.1, 0.12, h);
      float lit = pow(max(md, 0.0), 6.0);
      vec3 cloudCol = mix(vec3(0.02, 0.016, 0.05), vec3(0.16, 0.13, 0.3), n2);
      cloudCol += vec3(0.4, 0.45, 0.75) * lit * (1.0 - n2) * 0.7;
      cloudCol += vec3(0.6, 0.72, 1.0) * uFlash * (0.6 + n1 * 2.5);
      col = mix(col, cloudCol, dens * 0.92);
    }
    col += vec3(0.2, 0.25, 0.45) * uFlash * 0.35;
    gl_FragColor = vec4(col, 1.0);
  }
`;

function makeTrimTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#120c16';
  g.fillRect(0, 0, 512, 64);
  g.strokeStyle = '#ffb648';
  g.fillStyle = '#ffb648';
  g.lineWidth = 3;
  g.fillRect(0, 4, 512, 3);
  g.fillRect(0, 57, 512, 3);
  // Lotus-petal scallops and diamond lattice.
  for (let i = 0; i < 16; i++) {
    const x = i * 32 + 16;
    g.beginPath();
    g.moveTo(x - 14, 46);
    g.quadraticCurveTo(x - 12, 14, x, 12);
    g.quadraticCurveTo(x + 12, 14, x + 14, 46);
    g.stroke();
    g.beginPath();
    g.moveTo(x, 20); g.lineTo(x + 5, 30); g.lineTo(x, 40); g.lineTo(x - 5, 30); g.closePath();
    g.fill();
    g.fillRect(x + 15, 26, 2, 10);
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.wrapS = RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

function prangProfile(R: number, H: number): Vector2[] {
  const pts: [number, number][] = [
    [0, 0], [1, 0], [1, 0.05], [0.9, 0.06], [0.9, 0.1], [0.8, 0.11], [0.8, 0.16], [0.7, 0.17], [0.7, 0.22],
    [0.62, 0.23], [0.66, 0.3], [0.64, 0.38], [0.56, 0.4], [0.58, 0.47], [0.52, 0.53], [0.44, 0.55], [0.46, 0.6],
    [0.38, 0.66], [0.3, 0.68], [0.31, 0.72], [0.22, 0.77], [0.16, 0.79], [0.16, 0.82], [0.1, 0.86],
    [0.06, 0.87], [0.05, 0.92], [0.025, 0.96], [0.01, 1.0], [0, 1.0],
  ];
  return pts.map(([r, h]) => new Vector2(r * R, h * H));
}

function chediProfile(R: number, H: number): Vector2[] {
  const pts: [number, number][] = [
    [0, 0], [1, 0], [1, 0.06], [0.85, 0.08], [0.85, 0.13], [0.72, 0.15], [0.7, 0.2], [0.74, 0.27], [0.7, 0.36],
    [0.6, 0.44], [0.42, 0.5], [0.3, 0.52], [0.3, 0.56], [0.2, 0.57], [0.17, 0.62], [0.14, 0.66], [0.15, 0.68],
    [0.11, 0.72], [0.12, 0.74], [0.08, 0.79], [0.09, 0.81], [0.05, 0.87], [0.03, 0.94], [0.008, 1.0], [0, 1.0],
  ];
  return pts.map(([r, h]) => new Vector2(r * R, h * H));
}

function rockGeometry(radius: number, detail: number, seed: number) {
  const g = new IcosahedronGeometry(radius, detail);
  const p = g.attributes.position as BufferAttribute;
  const v = new Vector3();
  const r = mulberry(seed);
  const bumps = Array.from({ length: 6 }, () => [new Vector3(r() - 0.5, r() - 0.5, r() - 0.5).normalize(), r() * 0.35 + 0.1] as const);
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = v.clone().normalize();
    let s = 1;
    for (const [d, a] of bumps) s += Math.max(0, n.dot(d)) ** 3 * a;
    // Flat top, long jagged underside: floating-island silhouette.
    if (n.y > 0.35) s *= 0.75 + (1 - n.y) * 0.3;
    if (n.y < -0.2) s *= 1 + (-n.y) * 1.3;
    v.multiplyScalar(s);
    if (v.y > radius * 0.4) v.y = radius * 0.4 + (v.y - radius * 0.4) * 0.2;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

export interface FireSource {
  pos: Vector3;
  scale: number;
}

export class Stage {
  readonly group = new Group();
  readonly floor: Mesh;
  readonly fires: FireSource[] = [];
  readonly fireLights: PointLight[] = [];
  readonly key: DirectionalLight;
  private readonly flashLight: DirectionalLight;
  private readonly hemi: HemisphereLight;
  private readonly skyMat: ShaderMaterial;
  private readonly floorUniforms: Record<string, { value: unknown }>;
  private readonly rain: Mesh;
  private readonly rainMat: ShaderMaterial;
  private readonly splash: Mesh;
  private readonly splashMat: ShaderMaterial;
  private readonly lanterns: Mesh[] = [];
  private readonly lanternMats: ShaderMaterial[] = [];
  private readonly mistMats: ShaderMaterial[] = [];
  private readonly bannerMats: ShaderMaterial[] = [];
  private readonly rocks: { mesh: Group; base: Vector3; phase: number; spin: number }[] = [];
  private readonly bolts: { mesh: Mesh; life: number; max: number }[] = [];
  private readonly boltMat: ShaderMaterial;
  private readonly detailProps: Group[] = [];
  private nextBolt = 4;
  flash = 0;
  /** 0..1 rune glow boost (supers). */
  runeBoost = 0;
  /** Called with the strike distance (m) so audio can roll thunder. */
  onStrike: ((distance: number) => void) | null = null;
  time = 0;

  constructor(private readonly engine: Engine) {
    const scene = engine.scene;
    scene.fog = new FogExp2(0x150d2a, 0.011);
    scene.background = new Color(0x05040c);
    scene.add(this.group);

    // ── Sky ──
    this.skyMat = new ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uFlash: { value: 0 }, uMoonDir: { value: MOON_DIR.clone() }, uSimple: { value: 0 } },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = position;
          vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_Position = p.xyww;
        }
      `,
      fragmentShader: SKY_FRAG,
      side: BackSide,
      depthWrite: false,
      fog: false,
    });
    const sky = new Mesh(new SphereGeometry(900, 48, 24), this.skyMat);
    sky.renderOrder = -10;
    sky.frustumCulled = false;
    this.group.add(sky);

    // ── Lights ──
    this.hemi = new HemisphereLight(0x5a66ff, 0x1a0b18, 0.75);
    this.group.add(this.hemi);
    this.key = new DirectionalLight(0xbfd0ff, 2.6);
    this.key.position.set(5, 14, -11);
    this.key.castShadow = true;
    const sc = this.key.shadow.camera;
    sc.left = -13; sc.right = 13; sc.top = 9; sc.bottom = -6; sc.near = 2; sc.far = 40;
    this.key.shadow.bias = -0.0004;
    this.key.shadow.normalBias = 0.025;
    this.key.shadow.radius = 4;
    this.group.add(this.key, this.key.target);
    const fill = new DirectionalLight(0x8d74ff, 0.9);
    fill.position.set(-5, 5, 14);
    this.group.add(fill);
    this.flashLight = new DirectionalLight(0xd5e4ff, 0);
    this.flashLight.position.set(-8, 30, -30);
    this.group.add(this.flashLight);

    // ── Arena platform ──
    const trim = makeTrimTexture();
    const stone = new MeshStandardMaterial({ color: 0x2a2433, roughness: 0.78, metalness: 0.05 });
    const darkStone = new MeshStandardMaterial({ color: 0x17131e, roughness: 0.85 });
    const gold = new MeshStandardMaterial({ color: 0xd4a04a, roughness: 0.28, metalness: 1, emissive: 0x2a1500 });
    const trimTex = trim.clone();
    trimTex.repeat.set(10, 1);
    trimTex.needsUpdate = true;
    const trimMat = new MeshStandardMaterial({
      color: 0x8a6a40, map: trimTex, emissive: 0xffaa44, emissiveMap: trimTex, emissiveIntensity: 1.6, roughness: 0.4, metalness: 0.6,
    });
    const tier1 = new Mesh(new CylinderGeometry(13.6, 14.2, 1.1, 8, 1, false), [trimMat, stone, stone]);
    tier1.position.y = -0.55;
    tier1.rotation.y = Math.PI / 8;
    tier1.receiveShadow = true;
    const tier2 = new Mesh(new CylinderGeometry(15.4, 16.2, 1.4, 8), darkStone);
    tier2.position.y = -1.8;
    tier2.rotation.y = Math.PI / 8;
    const under = new Mesh(new CylinderGeometry(15.8, 3, 9, 8, 3), darkStone);
    under.position.y = -7;
    under.rotation.y = Math.PI / 8;
    const lip = new Mesh(new TorusGeometry(13.62, 0.08, 6, 8), gold);
    lip.rotation.x = Math.PI / 2;
    lip.rotation.z = Math.PI / 8;
    lip.position.y = 0.0;
    this.group.add(tier1, tier2, under, lip);

    // Reflective floor.
    const floorMat = new MeshStandardMaterial({ color: 0x24202c, roughness: 0.32, metalness: 0.0, envMapIntensity: 0.6 });
    this.floorUniforms = {
      tReflect: { value: engine.mirror.target.texture },
      uReflMatrix: { value: engine.mirror.textureMatrix },
      uReflStrength: { value: 1 },
      uTime: { value: 0 },
      uRune: { value: 0 },
      uRipples: { value: 1 },
    };
    floorMat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.floorUniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          varying vec3 vWPos;
          uniform sampler2D tReflect;
          uniform mat4 uReflMatrix;
          uniform float uReflStrength;
          uniform float uTime;
          uniform float uRune;
          uniform float uRipples;
          ${NOISE}
          float gTile; float gGrout; float gWet; vec2 gRipple; float gRune;
          vec2 ripples(vec2 p, float t) {
            vec2 cell = floor(p);
            vec2 acc = vec2(0.0);
            for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
              vec2 c = cell + vec2(float(i), float(j));
              float h = hash12(c);
              vec2 ctr = c + vec2(hash12(c + 3.1), hash12(c + 7.7));
              float tt = fract(t * (0.7 + h * 0.6) + h * 9.0);
              vec2 d = p - ctr;
              float r = length(d);
              float front = tt * 0.85;
              float ring = sin((r - front) * 34.0) * smoothstep(front + 0.1, front, r) * smoothstep(front - 0.3, front, r);
              acc += d / max(r, 1e-3) * ring * (1.0 - tt) * (1.0 - tt);
            }
            return acc;
          }
        `)
        .replace('#include <color_fragment>', `#include <color_fragment>
          {
            vec2 tp = vWPos.xz / 1.6;
            tp.x += step(1.0, mod(floor(tp.y), 2.0)) * 0.5;
            vec2 tid = floor(tp);
            vec2 tf = fract(tp);
            float edge = min(min(tf.x, 1.0 - tf.x), min(tf.y, 1.0 - tf.y));
            gGrout = 1.0 - smoothstep(0.012, 0.03, edge);
            gTile = hash12(tid);
            float stain = fbm(vWPos.xz * 0.35);
            gWet = smoothstep(0.35, 0.7, stain + gTile * 0.25);
            diffuseColor.rgb *= mix(0.75, 1.25, gTile) * mix(1.0, 0.3, gGrout) * mix(1.1, 0.7, gWet);
            diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.85, 0.8, 1.1), stain);
            gRipple = uRipples > 0.5 ? ripples(vWPos.xz * 2.2, uTime) : vec2(0.0);
            float r = length(vWPos.xz - vec2(0.0, 0.0));
            float a = atan(vWPos.z, vWPos.x);
            float ring1 = smoothstep(0.035, 0.0, abs(r - 2.35));
            float ring2 = smoothstep(0.03, 0.0, abs(r - 3.55));
            float ring3 = smoothstep(0.02, 0.0, abs(r - 1.15));
            float band = step(2.62, r) * step(r, 3.3);
            float seg = floor(a / 6.2831853 * 28.0);
            float cellA = fract(a / 6.2831853 * 28.0);
            float cellR = (r - 2.62) / 0.68;
            vec2 g = floor(vec2(cellA * 3.0, cellR * 3.0));
            float bit = step(0.45, hash12(g + seg * 7.0));
            vec2 gf = fract(vec2(cellA * 3.0, cellR * 3.0));
            float stroke = bit * (1.0 - smoothstep(0.08, 0.16, abs(gf.x - 0.5))) * (1.0 - smoothstep(0.3, 0.45, abs(gf.y - 0.5))) * step(0.12, cellA) * step(cellA, 0.88);
            float petal = smoothstep(0.03, 0.0, abs(r - (1.2 + 0.9 * abs(cos(a * 4.0)))) ) * step(r, 2.2);
            gRune = (ring1 + ring2 + ring3 * 0.7 + band * stroke * 0.45 + petal * 0.6);
          }
        `)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
          roughnessFactor = mix(roughnessFactor, 0.08, gWet);
          roughnessFactor = mix(roughnessFactor, 0.55, gGrout);
        `)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          {
            float pulse = 0.65 + 0.35 * sin(uTime * 1.7);
            vec3 runeCol = mix(vec3(1.0, 0.55, 0.16), vec3(0.4, 0.8, 1.0), uRune);
            totalEmissiveRadiance += runeCol * gRune * (0.32 * pulse + uRune * 3.0);
          }
        `)
        .replace('#include <opaque_fragment>', `
          {
            vec3 wp = vWPos + vec3(gRipple.x, 0.0, gRipple.y) * 0.06 + vec3(vnoise(vWPos.xz * 7.0) - 0.5, 0.0, vnoise(vWPos.zx * 7.0) - 0.5) * mix(0.09, 0.02, gWet);
            vec4 rc = uReflMatrix * vec4(wp, 1.0);
            vec3 refl = texture2DProj(tReflect, rc).rgb;
            float ndv = clamp(dot(normalize(vViewPosition), normal), 0.0, 1.0);
            float fres = 0.08 + 0.92 * pow(1.0 - ndv, 4.0);
            float k = mix(0.14, 0.7, gWet) * (1.0 - gGrout * 0.85) * mix(0.5, 1.0, fres);
            outgoingLight += refl * k * uReflStrength;
            outgoingLight += vec3(0.5, 0.6, 0.9) * length(gRipple) * 0.04;
          }
          #include <opaque_fragment>
        `);
    };
    this.floor = new Mesh(new CylinderGeometry(13.6, 13.6, 0.02, 8, 1), floorMat);
    this.floor.rotation.y = Math.PI / 8;
    this.floor.position.y = -0.01;
    this.floor.receiveShadow = true;
    this.group.add(this.floor);
    engine.mirrorHide.push(this.floor);

    this.buildColonnade(stone, gold, trim);
    this.buildBraziers(stone, gold);
    this.buildBackground(stone);

    // ── Rain ──
    const quad = new BufferGeometry();
    quad.setAttribute('position', new BufferAttribute(new Float32Array([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0]), 3));
    quad.setIndex([0, 1, 2, 0, 2, 3]);
    const rainGeo = new InstancedBufferGeometry();
    rainGeo.index = quad.index;
    rainGeo.setAttribute('position', quad.attributes.position);
    const seeds = new Float32Array(MAX_RAIN * 4);
    for (let i = 0; i < MAX_RAIN; i++) {
      seeds[i * 4] = rr(-16, 16);
      seeds[i * 4 + 1] = rr(-13, 2.5);
      seeds[i * 4 + 2] = rand();
      seeds[i * 4 + 3] = rand();
    }
    rainGeo.setAttribute('aSeed', new InstancedBufferAttribute(seeds, 4));
    rainGeo.instanceCount = 4000;
    this.rainMat = new ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uCenter: { value: new Vector3() }, uFlash: { value: 0 } },
      vertexShader: /* glsl */ `
        attribute vec4 aSeed;
        uniform float uTime;
        uniform vec3 uCenter;
        varying vec2 vUv;
        varying float vFade;
        void main() {
          float H = 16.0;
          float speed = 17.0 + aSeed.w * 7.0;
          float y = H - mod(uTime * speed + aSeed.z * H, H) - 0.5;
          vec3 base = vec3(aSeed.x + uCenter.x, y, aSeed.y);
          base.x += y * 0.12;
          vec3 vel = normalize(vec3(-0.12 * speed, -speed, 0.0));
          vec4 mv = modelViewMatrix * vec4(base, 1.0);
          vec3 vv = (modelViewMatrix * vec4(vel, 0.0)).xyz;
          vec2 axis = normalize(vv.xy + 1e-5);
          vec2 side = vec2(-axis.y, axis.x);
          float len = 0.55 + aSeed.w * 0.45;
          mv.xy += side * position.x * (0.011 + aSeed.z * 0.008) - axis * position.y * len;
          gl_Position = projectionMatrix * mv;
          vUv = vec2(position.x + 0.5, position.y);
          vFade = smoothstep(-0.4, 0.6, y) * smoothstep(3.0, 6.0, -mv.z);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uFlash;
        varying vec2 vUv;
        varying float vFade;
        void main() {
          float a = (1.0 - abs(vUv.x * 2.0 - 1.0)) * smoothstep(0.0, 0.3, vUv.y) * smoothstep(1.0, 0.6, vUv.y);
          vec3 c = vec3(0.55, 0.65, 1.0) * (0.7 + uFlash * 4.0);
          gl_FragColor = vec4(c * a * vFade * 0.5, 1.0);
        }
      `,
      transparent: true, depthWrite: false, blending: AdditiveBlending, fog: false,
    });
    this.rain = new Mesh(rainGeo, this.rainMat);
    this.rain.frustumCulled = false;
    this.rain.layers.set(LAYER_NO_REFLECT);
    this.group.add(this.rain);

    // Splash crowns on the floor.
    const splashGeo = new InstancedBufferGeometry();
    splashGeo.index = quad.index;
    splashGeo.setAttribute('position', quad.attributes.position);
    const sSeeds = new Float32Array(900 * 4);
    for (let i = 0; i < 900; i++) {
      sSeeds[i * 4] = rr(-13, 13); sSeeds[i * 4 + 1] = rr(-8, 6); sSeeds[i * 4 + 2] = rand(); sSeeds[i * 4 + 3] = rand();
    }
    splashGeo.setAttribute('aSeed', new InstancedBufferAttribute(sSeeds, 4));
    splashGeo.instanceCount = 500;
    this.splashMat = new ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uCenter: { value: new Vector3() }, uFlash: { value: 0 } },
      vertexShader: /* glsl */ `
        attribute vec4 aSeed;
        uniform float uTime;
        uniform vec3 uCenter;
        varying vec2 vUv;
        varying float vT;
        void main() {
          float rate = 1.6 + aSeed.w;
          float cyc = uTime * rate + aSeed.z * 10.0;
          float t = fract(cyc);
          float k = floor(cyc);
          vec3 base = vec3(aSeed.x + uCenter.x + sin(k * 12.7 + aSeed.z * 40.0) * 1.5, 0.02, aSeed.y + cos(k * 7.3) * 1.5);
          float s = 0.06 + t * 0.22;
          vec3 p = base + vec3(position.x * s * 2.0, 0.0, (position.y - 0.5) * s * 2.0);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
          vUv = vec2(position.x, position.y - 0.5) * 2.0;
          vT = t;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uFlash;
        varying vec2 vUv;
        varying float vT;
        void main() {
          float r = length(vUv);
          float ring = smoothstep(0.16, 0.0, abs(r - 0.8)) * (1.0 - vT) * step(r, 1.0);
          gl_FragColor = vec4(vec3(0.55, 0.65, 1.0) * ring * (0.5 + uFlash * 3.0), 1.0);
        }
      `,
      transparent: true, depthWrite: false, blending: AdditiveBlending, fog: false,
    });
    this.splash = new Mesh(splashGeo, this.splashMat);
    this.splash.frustumCulled = false;
    this.splash.layers.set(LAYER_NO_REFLECT);
    this.group.add(this.splash);

    // Lightning.
    this.boltMat = new ShaderMaterial({
      uniforms: { uAlpha: { value: 1 } },
      vertexShader: /* glsl */ `
        attribute float aEdge;
        varying float vEdge;
        void main() { vEdge = aEdge; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
      `,
      fragmentShader: /* glsl */ `
        uniform float uAlpha;
        varying float vEdge;
        void main() {
          float core = 1.0 - abs(vEdge);
          vec3 c = mix(vec3(0.5, 0.6, 2.5), vec3(6.0, 6.5, 9.0), pow(core, 3.0));
          gl_FragColor = vec4(c * core * uAlpha, 1.0);
        }
      `,
      transparent: true, depthWrite: false, blending: AdditiveBlending, fog: false, side: DoubleSide,
    });

    this.buildEnvironment(engine.renderer);
  }

  // ───────────────────────────── builders ─────────────────────────────

  private buildEnvironment(renderer: WebGLRenderer) {
    const envScene = new Scene();
    const sky = new Mesh(new SphereGeometry(50, 32, 16), this.skyMat);
    envScene.add(sky);
    const warm = new MeshBasicMaterial({ color: new Color(3, 1.3, 0.4) });
    const cool = new MeshBasicMaterial({ color: new Color(0.4, 1.2, 2.5) });
    for (const x of [-1, 1]) {
      const p = new Mesh(new BoxGeometry(4, 2, 4), warm);
      p.position.set(x * 18, -2, -6);
      envScene.add(p);
    }
    const c = new Mesh(new BoxGeometry(20, 1, 4), cool);
    c.position.set(0, 25, 10);
    envScene.add(c);
    const pm = new PMREMGenerator(renderer);
    this.skyMat.uniforms.uSimple.value = 1;
    const env: Texture = pm.fromScene(envScene, 0.03).texture;
    this.skyMat.uniforms.uSimple.value = 0;
    pm.dispose();
    this.engine.scene.environment = env;
    this.engine.scene.environmentIntensity = 0.9;
  }

  private buildColonnade(stone: MeshStandardMaterial, gold: MeshStandardMaterial, trim: CanvasTexture) {
    const g = new Group();
    const shaft = new CylinderGeometry(0.42, 0.48, 7, 8);
    const capital = new LatheGeometry(
      [[0, 0], [0.45, 0], [0.62, 0.25], [0.72, 0.5], [0.55, 0.62], [0.8, 0.7], [0.8, 0.85], [0, 0.85]].map(([r, h]) => new Vector2(r, h)), 8,
    );
    const base = new BoxGeometry(1.3, 0.6, 1.3);
    const band = new CylinderGeometry(0.5, 0.5, 0.14, 8);
    const trimTex = trim.clone();
    trimTex.repeat.set(2, 1);
    trimTex.needsUpdate = true;
    const bandMat = new MeshStandardMaterial({ color: 0x8a6a40, map: trimTex, emissive: 0xffaa44, emissiveMap: trimTex, emissiveIntensity: 1.2, metalness: 0.7, roughness: 0.35 });
    const xs = [-13, -8.5, -4.2, 4.2, 8.5, 13];
    for (const x of xs) {
      const z = -9.5 - Math.abs(x) * 0.12;
      const p = new Group();
      const s = new Mesh(shaft, stone);
      s.position.y = 3.5;
      const c = new Mesh(capital, gold);
      c.position.y = 7;
      const b = new Mesh(base, stone);
      b.position.y = 0.3;
      const b1 = new Mesh(band, bandMat);
      b1.position.y = 1.2;
      const b2 = new Mesh(band, bandMat);
      b2.position.y = 6.2;
      for (const m of [s, c, b, b1, b2]) { m.castShadow = true; m.receiveShadow = true; p.add(m); }
      p.position.set(x, 0, z);
      g.add(p);
    }
    // Beams.
    const beamGeo = new BoxGeometry(9.6, 0.7, 0.9);
    for (const [x0, x1] of [[-13, -4.2], [4.2, 13]] as const) {
      const bm = new Mesh(beamGeo, stone);
      bm.position.set((x0 + x1) / 2, 8.2, -10.2);
      bm.scale.x = Math.abs(x1 - x0) / 9.6 + 0.12;
      const tb = new Mesh(new BoxGeometry(1, 0.2, 0.95), bandMat);
      tb.position.copy(bm.position).add(new Vector3(0, -0.42, 0));
      tb.scale.x = bm.scale.x * 9.6;
      g.add(bm, tb);
    }

    // Banners: cloth with a wave in the vertex shader.
    const bannerGeo = new PlaneGeometry(1.5, 5.2, 4, 24);
    bannerGeo.translate(0, -2.6, 0);
    for (const [x, hue] of [[-6.35, 0], [6.35, 1], [-10.75, 1], [10.75, 0]] as const) {
      const mat = new ShaderMaterial({
        uniforms: {
          uTime: { value: 0 }, uPhase: { value: x }, uFlash: { value: 0 },
          uColor: { value: hue ? new Color(0.22, 0.03, 0.06) : new Color(0.05, 0.04, 0.18) },
          uGlow: { value: hue ? new Color(2.2, 0.9, 0.25) : new Color(0.4, 1.2, 2.4) },
          ...UniformsUtils.clone(UniformsLib.fog),
        },
        vertexShader: /* glsl */ `
          uniform float uTime;
          uniform float uPhase;
          varying vec2 vUv;
          varying float vShade;
          varying float vFogDepth;
          void main() {
            vUv = uv;
            vec3 p = position;
            float hang = -p.y / 5.2;
            float w = sin(uTime * 2.1 + p.y * 1.3 + uPhase) * 0.18 + sin(uTime * 3.7 + p.y * 2.9 + uPhase * 2.0) * 0.06;
            p.z += w * hang * 1.6;
            p.x += sin(uTime * 1.3 + uPhase) * 0.08 * hang;
            vShade = 0.75 + 0.6 * cos(uTime * 2.1 + p.y * 1.3 + uPhase) * hang;
            vec4 mv = modelViewMatrix * vec4(p, 1.0);
            vFogDepth = -mv.z;
            gl_Position = projectionMatrix * mv;
          }
        `,
        fragmentShader: /* glsl */ `
          uniform vec3 uColor;
          uniform vec3 uGlow;
          uniform float uFlash;
          uniform vec3 fogColor;
          uniform float fogDensity;
          varying vec2 vUv;
          varying float vShade;
          varying float vFogDepth;
          void main() {
            vec2 uv = vUv;
            float border = step(uv.x, 0.07) + step(0.93, uv.x);
            vec2 c = vec2(uv.x - 0.5, (uv.y - 0.62) * 0.29);
            float r = length(c);
            float a = atan(c.y, c.x);
            float emblem = smoothstep(0.012, 0.0, abs(r - 0.28)) + smoothstep(0.012, 0.0, abs(r - (0.12 + 0.08 * abs(cos(a * 4.0)))));
            float stripes = step(0.5, fract(uv.y * 14.0)) * step(uv.y, 0.22) * 0.5;
            float tassel = step(uv.y, 0.04) * step(0.5, fract(uv.x * 9.0));
            vec3 col = uColor * vShade;
            col += uGlow * (emblem * 0.9 + border * 0.25 + stripes * 0.2 + tassel * 0.4);
            col *= 1.0 + uFlash * 1.5;
            float fogF = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
            col = mix(col, fogColor, fogF);
            gl_FragColor = vec4(col, 1.0);
          }
        `,
        side: DoubleSide,
        fog: true,
      });
      this.bannerMats.push(mat);
      const b = new Mesh(bannerGeo, mat);
      b.position.set(x, 7.75, -9.75);
      g.add(b);
    }
    this.group.add(g);
    this.detailProps.push(g);
  }

  private buildBraziers(stone: MeshStandardMaterial, gold: MeshStandardMaterial) {
    const bowl = new LatheGeometry(
      [[0, 0], [0.25, 0], [0.3, 0.1], [0.12, 0.25], [0.15, 0.85], [0.55, 1.0], [0.78, 1.25], [0.82, 1.4], [0.74, 1.38], [0.5, 1.2], [0, 1.15]].map(([r, h]) => new Vector2(r, h)), 16,
    );
    const ped = new CylinderGeometry(0.42, 0.55, 0.5, 8);
    const coal = new MeshBasicMaterial({ color: new Color(4, 1.2, 0.25) });
    const spots: [number, number, number, boolean][] = [[-10.4, -2.2, 1.15, true], [10.4, -2.2, 1.15, true], [-5.6, -7.6, 0.9, false], [5.6, -7.6, 0.9, false]];
    for (const [x, z, s, lit] of spots) {
      const g = new Group();
      const b = new Mesh(bowl, gold);
      b.position.y = 0.5;
      const p = new Mesh(ped, stone);
      p.position.y = 0.25;
      const c = new Mesh(new SphereGeometry(0.62, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), coal);
      c.position.y = 1.62;
      c.scale.y = 0.25;
      for (const m of [b, p]) { m.castShadow = true; m.receiveShadow = true; }
      g.add(b, p, c);
      g.scale.setScalar(s);
      g.position.set(x, 0, z);
      this.group.add(g);
      this.fires.push({ pos: new Vector3(x, 1.75 * s, z), scale: s });
      if (lit) {
        const l = new PointLight(0xff7a2c, 55, 26, 2);
        l.position.set(x, 2.4 * s, z + 0.4);
        this.group.add(l);
        this.fireLights.push(l);
      }
    }
  }

  private buildBackground(stone: MeshStandardMaterial) {
    const farStone = new MeshStandardMaterial({ color: 0x2c2638, roughness: 0.85, metalness: 0.05 });
    const glowWarm = new MeshBasicMaterial({ color: new Color(3.2, 1.5, 0.45), fog: true });
    const glowCool = new MeshBasicMaterial({ color: new Color(0.35, 1.6, 3.2), fog: true });
    const rockMat = new MeshStandardMaterial({ color: 0x241e2c, roughness: 0.95, flatShading: true });

    const addPrang = (parent: Group, x: number, y: number, z: number, R: number, H: number, rings: boolean) => {
      const m = new Mesh(new LatheGeometry(prangProfile(R, H), 12), farStone);
      m.position.set(x, y, z);
      parent.add(m);
      if (rings) {
        for (const t of [0.22, 0.4, 0.55, 0.68, 0.79]) {
          const prof = prangProfile(R, H);
          let r = R * 0.5;
          for (let i = 1; i < prof.length; i++) if (prof[i].y >= t * H) { r = prof[i].x; break; }
          const ring = new Mesh(new TorusGeometry(r * 1.01, Math.max(0.05, R * 0.012), 4, 24), glowWarm);
          ring.rotation.x = Math.PI / 2;
          ring.position.set(x, y + t * H, z);
          parent.add(ring);
        }
        const tip = new Mesh(new OctahedronGeometry(R * 0.06), glowWarm);
        tip.position.set(x, y + H * 1.02, z);
        parent.add(tip);
      }
      return m;
    };

    // Main temple island, far behind the moon line.
    const far = new Group();
    const island = new Mesh(rockGeometry(40, 3, 3), rockMat);
    island.scale.set(1.6, 0.5, 0.7);
    island.position.set(0, -14, -95);
    far.add(island);
    addPrang(far, 0, -2, -92, 9, 52, true);
    for (const s of [-1, 1]) {
      addPrang(far, s * 20, -4, -88, 5, 30, true);
      addPrang(far, s * 34, -5, -96, 3.6, 21, true);
      addPrang(far, s * 11, -3, -80, 2.4, 14, false);
    }
    const wall = new Mesh(new BoxGeometry(80, 3, 1.5), farStone);
    wall.position.set(0, -2.5, -78);
    far.add(wall);
    this.group.add(far);

    // Floating islands with chedis and crystals.
    const chediGeo = new LatheGeometry(chediProfile(1, 1), 24);
    const crystalGeo = new OctahedronGeometry(1, 0);
    const spots: [number, number, number, number][] = [
      [-24, 4, -34, 5], [26, 7, -40, 6], [-42, 13, -55, 7], [44, 2, -52, 5.5], [-15, -6, -26, 3.5], [17, -5, -24, 3],
      [-60, 6, -70, 8], [60, 12, -72, 7], [0, 20, -60, 4],
    ];
    spots.forEach(([x, y, z, s], i) => {
      const g = new Group();
      const rock = new Mesh(rockGeometry(s, 2, 11 + i), rockMat);
      rock.scale.set(1, 0.8, 0.8);
      rock.castShadow = false;
      g.add(rock);
      if (i % 3 !== 2) {
        const ch = new Mesh(chediGeo, stone);
        ch.scale.set(s * 0.32, s * 1.1, s * 0.32);
        ch.position.y = s * 0.3;
        g.add(ch);
        const band = new Mesh(new TorusGeometry(s * 0.24, s * 0.012, 4, 20), glowWarm);
        band.rotation.x = Math.PI / 2;
        band.position.y = s * 0.55;
        g.add(band);
      }
      for (let k = 0; k < 3; k++) {
        const cr = new Mesh(crystalGeo, glowCool);
        cr.scale.set(s * 0.08, s * 0.28, s * 0.08);
        cr.position.set(rr(-s * 0.5, s * 0.5), -s * rr(0.6, 1.1), rr(-s * 0.3, s * 0.3));
        cr.rotation.z = rr(-0.5, 0.5);
        g.add(cr);
      }
      g.position.set(x, y, z);
      this.group.add(g);
      this.rocks.push({ mesh: g, base: new Vector3(x, y, z), phase: rand() * 6.28, spin: rr(-0.05, 0.05) });
      if (i > 5) this.detailProps.push(g);
    });

    // Distant mountain silhouettes (unlit gradient so fog does not swallow them).
    const mountMat = new ShaderMaterial({
      vertexShader: /* glsl */ `
        varying float vH;
        void main() { vH = position.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
      `,
      fragmentShader: /* glsl */ `
        varying float vH;
        void main() {
          vec3 low = vec3(0.12, 0.06, 0.18);
          vec3 high = vec3(0.025, 0.02, 0.06);
          gl_FragColor = vec4(mix(low, high, smoothstep(-30.0, 60.0, vH)), 1.0);
        }
      `,
      fog: false,
    });
    for (let layer = 0; layer < 2; layer++) {
      const seg = 120;
      const pos: number[] = [];
      const idx: number[] = [];
      const z = -330 - layer * 120;
      for (let i = 0; i <= seg; i++) {
        const x = -900 + (1800 * i) / seg;
        const t = i / seg;
        const hgt = 30 + Math.sin(t * 17 + layer) * 22 + Math.sin(t * 41) * 12 + Math.sin(t * 93 + layer * 3) * 6 + layer * 30;
        pos.push(x, -60, z, x, hgt, z);
        if (i < seg) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      }
      const g = new BufferGeometry();
      g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
      g.setIndex(idx);
      const m = new Mesh(g, mountMat);
      m.renderOrder = -5;
      this.group.add(m);
    }

    // Mist cards.
    const mistGeo = new PlaneGeometry(1, 1);
    const cards: [number, number, number, number, number, number][] = [
      [0, -3.5, -16, 70, 9, 0.55], [0, -1, -32, 120, 14, 0.5], [0, 2, -60, 200, 22, 0.45], [0, -9, -6, 90, 8, 0.7],
      [-30, 8, -45, 60, 10, 0.25], [30, 10, -50, 60, 10, 0.25],
    ];
    cards.forEach(([x, y, z, w, h, a], i) => {
      const mat = new ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uSeed: { value: i * 13.7 }, uAlpha: { value: a }, uFlash: { value: 0 } },
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          varying vec3 vW;
          void main() { vUv = uv; vW = (modelMatrix * vec4(position, 1.0)).xyz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
        `,
        fragmentShader: /* glsl */ `
          uniform float uTime;
          uniform float uSeed;
          uniform float uAlpha;
          uniform float uFlash;
          varying vec2 vUv;
          varying vec3 vW;
          ${NOISE}
          void main() {
            vec2 p = vW.xy * 0.06 + vec2(uTime * 0.02 + uSeed, uSeed);
            float n = fbm(p + fbm(p * 1.7 - uTime * 0.01));
            float edge = smoothstep(0.0, 0.25, vUv.y) * smoothstep(1.0, 0.45, vUv.y) * smoothstep(0.0, 0.15, vUv.x) * smoothstep(1.0, 0.85, vUv.x);
            float a = smoothstep(0.3, 0.85, n) * edge * uAlpha;
            vec3 c = mix(vec3(0.16, 0.1, 0.32), vec3(0.15, 0.28, 0.45), n) * (1.0 + uFlash * 3.0);
            gl_FragColor = vec4(c * a, a * 0.6);
          }
        `,
        transparent: true, depthWrite: false, fog: false, blending: AdditiveBlending,
      });
      this.mistMats.push(mat);
      const m = new Mesh(mistGeo, mat);
      m.scale.set(w, h, 1);
      m.position.set(x, y, z);
      m.layers.set(LAYER_NO_REFLECT);
      m.renderOrder = 2;
      this.group.add(m);
    });

    // Sky lanterns (khom loi): GPU animated, two instanced meshes sharing seeds.
    const seeds = new Float32Array(MAX_LANTERNS * 4);
    for (let i = 0; i < MAX_LANTERNS; i++) {
      const near = i % 9 === 0;
      seeds[i * 4] = near ? rr(-22, 22) : rr(-80, 80);
      seeds[i * 4 + 1] = near ? rr(-26, -14) : rr(-110, -26);
      seeds[i * 4 + 2] = rand();
      seeds[i * 4 + 3] = rand();
    }
    const seedAttr = new InstancedBufferAttribute(seeds, 4);
    const lanternVert = (glow: boolean) => /* glsl */ `
      attribute vec4 aSeed;
      uniform float uTime;
      varying vec2 vUv;
      varying float vFlick;
      varying float vFog;
      void main() {
        float H = 70.0;
        float y = mod(aSeed.z * H + uTime * (0.35 + aSeed.w * 0.5), H) - 12.0;
        vec3 c = vec3(aSeed.x + sin(uTime * 0.2 + aSeed.z * 30.0) * 2.0, y, aSeed.y);
        float s = 0.4 + aSeed.w * 0.45;
        vFlick = 0.75 + 0.25 * sin(uTime * 9.0 + aSeed.z * 80.0) * sin(uTime * 5.3 + aSeed.w * 40.0);
        vUv = uv;
        ${glow
          ? 'vec4 mv = viewMatrix * vec4(c, 1.0); mv.xy += position.xy * s * 1.7;'
          : 'vec4 mv = viewMatrix * vec4(c + position * s, 1.0);'}
        vFog = exp(-0.000035 * mv.z * mv.z);
        gl_Position = projectionMatrix * mv;
      }
    `;
    const bodyGeo = new InstancedBufferGeometry();
    const lathe = new LatheGeometry([[0.0, -0.4], [0.22, -0.4], [0.3, -0.1], [0.32, 0.2], [0.26, 0.42], [0.0, 0.45]].map(([r, h]) => new Vector2(r, h)), 8);
    bodyGeo.index = lathe.index;
    bodyGeo.setAttribute('position', lathe.attributes.position);
    bodyGeo.setAttribute('uv', lathe.attributes.uv);
    bodyGeo.setAttribute('aSeed', seedAttr);
    const bodyMat = new ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: lanternVert(false),
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        varying float vFlick;
        varying float vFog;
        void main() {
          vec3 c = mix(vec3(4.5, 1.9, 0.5), vec3(1.6, 0.45, 0.12), vUv.y) * vFlick;
          gl_FragColor = vec4(mix(vec3(0.08, 0.05, 0.16), c, vFog), 1.0);
        }
      `,
      fog: false,
    });
    const glowGeo = new InstancedBufferGeometry();
    const plane = new PlaneGeometry(1, 1);
    glowGeo.index = plane.index;
    glowGeo.setAttribute('position', plane.attributes.position);
    glowGeo.setAttribute('uv', plane.attributes.uv);
    glowGeo.setAttribute('aSeed', seedAttr);
    const glowMat = new ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: lanternVert(true),
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        varying float vFlick;
        varying float vFog;
        void main() {
          float r = length(vUv - 0.5) * 2.0;
          float a = pow(max(0.0, 1.0 - r), 2.5);
          gl_FragColor = vec4(vec3(1.0, 0.45, 0.12) * a * 0.55 * vFlick * vFog, 1.0);
        }
      `,
      transparent: true, depthWrite: false, blending: AdditiveBlending, fog: false,
    });
    for (const [geo, mat] of [[bodyGeo, bodyMat], [glowGeo, glowMat]] as const) {
      geo.instanceCount = 60;
      const m = new Mesh(geo, mat);
      m.frustumCulled = false;
      this.lanterns.push(m);
      this.lanternMats.push(mat);
      this.group.add(m);
    }
  }

  // ───────────────────────────── runtime ─────────────────────────────

  setQuality(q: Quality) {
    (this.rain.geometry as InstancedBufferGeometry).instanceCount = q.rain;
    (this.splash.geometry as InstancedBufferGeometry).instanceCount = Math.round(q.rain * 0.06);
    for (const l of this.lanterns) (l.geometry as InstancedBufferGeometry).instanceCount = q.lanterns;
    this.floorUniforms.uReflStrength.value = q.reflection > 0 ? 1 : 0;
    this.floorUniforms.uRipples.value = q.detail >= 0.6 ? 1 : 0;
    this.skyMat.uniforms.uSimple.value = q.detail < 0.4 ? 1 : 0;
    this.detailProps.forEach((g, i) => { g.visible = i === 0 || q.detail >= 0.6; });
    this.key.shadow.mapSize.set(q.shadows || 512, q.shadows || 512);
    this.key.shadow.map?.dispose();
    this.key.shadow.map = null;
    for (const m of this.mistMats) m.visible = q.detail >= 0.5;
  }

  update(dt: number, focusX: number) {
    this.time += dt;
    const t = this.time;
    this.skyMat.uniforms.uTime.value = t;
    this.floorUniforms.uTime.value = t;
    this.floorUniforms.uRune.value = this.runeBoost;
    this.rainMat.uniforms.uTime.value = t;
    this.rainMat.uniforms.uCenter.value.x = focusX;
    this.splashMat.uniforms.uTime.value = t;
    this.splashMat.uniforms.uCenter.value.x = focusX;
    for (const m of this.lanternMats) m.uniforms.uTime.value = t;
    for (const m of this.mistMats) { m.uniforms.uTime.value = t; m.uniforms.uFlash.value = this.flash * 0.3; }
    for (const m of this.bannerMats) {
      m.uniforms.uTime.value = t;
      m.uniforms.uFlash.value = this.flash;
    }
    for (const r of this.rocks) {
      r.mesh.position.y = r.base.y + Math.sin(t * 0.4 + r.phase) * 0.8;
      r.mesh.rotation.y += r.spin * dt;
    }
    this.fireLights.forEach((l, i) => {
      l.intensity = 48 + Math.sin(t * 13 + i) * 6 + Math.sin(t * 29 + i * 3) * 5 + (Math.random() - 0.5) * 6;
    });

    // Lightning.
    this.nextBolt -= dt;
    if (this.nextBolt <= 0) {
      this.strike();
      this.nextBolt = 5 + Math.random() * 9;
    }
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i];
      b.life -= dt;
      const k = b.life / b.max;
      const flick = k > 0.75 ? 1 : k > 0.6 ? 0.15 : k > 0.45 ? 0.9 : k * 1.6;
      (b.mesh.material as ShaderMaterial).uniforms.uAlpha.value = Math.max(0, flick);
      if (b.life <= 0) {
        this.group.remove(b.mesh);
        b.mesh.geometry.dispose();
        (b.mesh.material as ShaderMaterial).dispose();
        this.bolts.splice(i, 1);
      }
    }
    this.flash = Math.max(0, this.flash - dt * 2.2);
    const f = this.flash;
    this.skyMat.uniforms.uFlash.value = f;
    this.rainMat.uniforms.uFlash.value = f;
    this.splashMat.uniforms.uFlash.value = f;
    this.flashLight.intensity = f * 9;
    this.hemi.intensity = 0.75 + f * 1.4;
  }

  strike(x = (Math.random() - 0.5) * 140, z = -70 - Math.random() * 60) {
    const top = new Vector3(x + (Math.random() - 0.5) * 30, 95, z);
    const bottom = new Vector3(x, Math.random() < 0.5 ? 40 : 0, z + (Math.random() - 0.5) * 10);
    const width = 0.5 + Math.random() * 0.5;
    const paths: { pts: Vector3[]; w: number }[] = [{ pts: jagged(top, bottom, 7, 0.22), w: width }];
    for (let i = 0; i < 4; i++) {
      const main = paths[0].pts;
      const from = main[Math.floor(main.length * (0.2 + Math.random() * 0.5))];
      const to = from.clone().add(new Vector3((Math.random() - 0.5) * 30, -15 - Math.random() * 25, (Math.random() - 0.5) * 6));
      paths.push({ pts: jagged(from, to, 5, 0.25), w: width * 0.45 });
    }
    const geo = ribbonGeometry(paths, this.engine.camera.position);
    const mat = this.boltMat.clone();
    const mesh = new Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 1;
    this.group.add(mesh);
    const life = 0.42 + Math.random() * 0.2;
    this.bolts.push({ mesh, life, max: life });
    this.flash = 1;
    this.onStrike?.(Math.hypot(x, z));
  }
}

function jagged(a: Vector3, b: Vector3, depth: number, rough: number): Vector3[] {
  let pts = [a.clone(), b.clone()];
  let disp = a.distanceTo(b) * rough;
  for (let d = 0; d < depth; d++) {
    const next: Vector3[] = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const p = pts[i], q = pts[i + 1];
      const mid = p.clone().add(q).multiplyScalar(0.5);
      mid.x += (Math.random() - 0.5) * disp;
      mid.y += (Math.random() - 0.5) * disp * 0.3;
      mid.z += (Math.random() - 0.5) * disp * 0.3;
      next.push(p, mid);
    }
    next.push(pts[pts.length - 1]);
    pts = next;
    disp *= 0.55;
  }
  return pts;
}

/** Camera-facing ribbon for one or more polylines. aEdge runs -1..1 across the width. */
export function ribbonGeometry(paths: { pts: Vector3[]; w: number }[], eye: Vector3): BufferGeometry {
  const pos: number[] = [];
  const edge: number[] = [];
  const idx: number[] = [];
  const t = new Vector3();
  const view = new Vector3();
  const side = new Vector3();
  for (const { pts, w } of paths) {
    const base = pos.length / 3;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      t.subVectors(b, a).normalize();
      view.subVectors(eye, p).normalize();
      side.crossVectors(t, view).normalize();
      const ww = w * (1 - (i / pts.length) * 0.6);
      pos.push(p.x + side.x * ww, p.y + side.y * ww, p.z + side.z * ww, p.x - side.x * ww, p.y - side.y * ww, p.z - side.z * ww);
      edge.push(-1, 1);
      if (i < pts.length - 1) {
        const k = base + i * 2;
        idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
      }
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('aEdge', new BufferAttribute(new Float32Array(edge), 1));
  g.setIndex(idx);
  return g;
}
