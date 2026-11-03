// Drives a Rig from simulation state every rendered frame: picks and blends animation,
// adds procedural motion, and spawns the fighter's own effects (trails, aura, afterimages).
import { Color, Euler, MathUtils, MeshBasicMaterial, Quaternion, Vector3, type Scene } from 'three';
import type { Fighter } from '../sim/fight';
import type { Effects } from '../fx/effects';
import { hdr, Trail } from '../fx/effects';
import { CLIPS, COMPILED, blendPoses, copyPose, newPose, sampleClip, type CompiledPose } from './poses';
import { HIP_HEIGHT, JOINTS, Rig, type Joint } from './rig';

const YAW_BIAS = 0.36;
const PIVOT_Y = 0.95;
const J = Object.fromEntries(JOINTS.map((j, i) => [j, i])) as Record<Joint, number>;
const eul = new Euler();
const dq = new Quaternion();
const tmp = new Vector3();
const tmp2 = new Vector3();
const rnd = (a: number, b: number) => a + (b - a) * Math.random();

function addRot(p: CompiledPose, j: Joint, x: number, y = 0, z = 0) {
  eul.set(x * MathUtils.DEG2RAD, y * MathUtils.DEG2RAD, z * MathUtils.DEG2RAD, 'YXZ');
  dq.setFromEuler(eul);
  p.q[J[j]].multiply(dq);
}

interface Ghost {
  rig: Rig;
  life: number;
  mat: MeshBasicMaterial;
}

export class FighterView {
  readonly rig: Rig;
  private readonly target = newPose();
  private readonly current = newPose();
  private readonly from = newPose();
  private readonly scratch = newPose();
  private key = '';
  private blendT = 1;
  private blendDur = 1;
  private walkPhase = 0;
  private spin = 0;
  private flash = 0;
  private lastFlash = 0;
  private time = 0;
  private readonly trails: Record<'handL' | 'handR' | 'footL' | 'footR', Trail>;
  private readonly ghosts: Ghost[] = [];
  private ghostTimer = 0;
  private readonly wind = new Vector3(-3, 1, 1.5);
  readonly pos = new Vector3();
  /** Visual lean impulse from hits (radians). */
  private recoil = 0;
  ghostsEnabled = true;
  auraScale = 1;

  constructor(readonly f: Fighter, private readonly scene: Scene, private readonly fx: Effects) {
    this.rig = new Rig(f.def);
    scene.add(this.rig.root);
    for (const r of this.rig.ribbons) scene.add(r.mesh);
    const c = new Color(f.def.accent);
    this.trails = {
      handL: new Trail(c), handR: new Trail(c), footL: new Trail(c), footR: new Trail(c),
    };
    for (const t of Object.values(this.trails)) scene.add(t.mesh);
    this.rig.pivot.position.set(0, PIVOT_Y, 0);
    copyPose(COMPILED.guard, this.current);
    copyPose(COMPILED.guard, this.from);
  }

  dispose() {
    this.scene.remove(this.rig.root);
    for (const r of this.rig.ribbons) this.scene.remove(r.mesh);
    for (const t of Object.values(this.trails)) this.scene.remove(t.mesh);
    for (const g of this.ghosts) this.scene.remove(g.rig.root);
  }

  resetCloth() {
    for (const r of this.rig.ribbons) r.reset();
  }

  /** Which pose/clip to show and how fast to blend into it. */
  private choose(t: number): { key: string; blend: number } {
    const f = this.f;
    const pose = this.target;
    switch (f.state) {
      case 'intro': {
        if (f.sf < 95) { copyPose(COMPILED.wai, pose); return { key: 'wai', blend: 1 }; }
        this.idle();
        return { key: 'idle', blend: 22 };
      }
      case 'idle':
        this.idle();
        return { key: 'idle', blend: 6 };
      case 'walk': {
        this.idle();
        const k = Math.sin(this.walkPhase);
        const c = Math.cos(this.walkPhase);
        addRot(pose, 'thighL', -k * 16);
        addRot(pose, 'thighR', k * 16);
        addRot(pose, 'shinL', Math.max(0, c) * 26);
        addRot(pose, 'shinR', Math.max(0, -c) * 26);
        addRot(pose, 'chest', 0, k * 4);
        pose.hp.y -= Math.abs(c) * 0.025;
        return { key: 'walk', blend: 6 };
      }
      case 'crouch':
        copyPose(COMPILED.crouch, pose);
        addRot(pose, 'chest', Math.sin(t * 2.4) * 2);
        return { key: 'crouch', blend: 4 };
      case 'guard':
      case 'blockstun':
        copyPose(f.crouching ? COMPILED.crouchBlock : COMPILED.block, pose);
        if (f.state === 'blockstun') pose.hp.z -= Math.min(1, f.stun / 8) * 0.06;
        return { key: f.crouching ? 'cblock' : 'block', blend: 3 };
      case 'prejump':
        copyPose(COMPILED.squat, pose);
        return { key: 'squat', blend: 3 };
      case 'air': {
        const rel = f.jumpDir * f.facing;
        if (rel !== 0 && f.sf > 3 && f.sf < 38) copyPose(COMPILED.tuck, pose);
        else copyPose(f.vy > 0 ? COMPILED.jumpUp : COMPILED.jumpFall, pose);
        return { key: f.vy > 0 ? 'up' : 'fall', blend: 6 };
      }
      case 'land':
        copyPose(COMPILED.squat, pose);
        return { key: 'land', blend: 2 };
      case 'dash':
        copyPose(f.dashDir > 0 ? COMPILED.dashF : COMPILED.dashB, pose);
        return { key: 'dash' + f.dashDir, blend: 3 };
      case 'attack': {
        const mv = f.move!;
        sampleClip(CLIPS[mv.id], f.mf + t, pose);
        if (mv.id === 'rising') addRot(pose, 'hips', 0, (f.mf + t) * 18, 0);
        return { key: 'atk:' + mv.id + ':' + f.connected, blend: f.mf < 2 ? 2 : 1 };
      }
      case 'hitstun': {
        const total = f.sf + f.stun;
        const k = Math.min(1, Math.max(0, (f.stun - 2) / Math.max(1, total * 0.6)));
        blendPoses(COMPILED.guard, f.lowHit ? COMPILED.hitLow : COMPILED.hitHigh, k, pose);
        return { key: 'hit' + f.lowHit + f.hitFlash, blend: 1.5 };
      }
      case 'juggle':
      case 'ko':
        if (f.grounded) { copyPose(COMPILED.lie, pose); return { key: 'lie', blend: 4 }; }
        copyPose(COMPILED.tumble, pose);
        return { key: 'tumble', blend: 3 };
      case 'down':
        copyPose(COMPILED.lie, pose);
        return { key: 'lie', blend: 4 };
      case 'getup': {
        const k = Math.min(1, f.sf / 20);
        blendPoses(COMPILED.lie, COMPILED.getup, Math.min(1, k * 2), this.scratch);
        blendPoses(this.scratch, COMPILED.guard, Math.max(0, k * 2 - 1), pose);
        return { key: 'getup', blend: 1 };
      }
      case 'win': {
        copyPose(COMPILED.win, pose);
        addRot(pose, 'armR', Math.sin(this.time * 3) * 4);
        addRot(pose, 'chest', Math.sin(this.time * 1.6) * 2);
        return { key: 'win', blend: 10 };
      }
    }
    copyPose(COMPILED.guard, pose);
    return { key: 'guard', blend: 6 };
  }

  private idle() {
    const b = (Math.sin(this.time * 2.4) + 1) / 2;
    blendPoses(COMPILED.guard, COMPILED.guardBreath, b, this.target);
    this.target.hp.y -= Math.abs(Math.sin(this.time * 3.3)) * 0.018;
  }

  update(dt: number, alpha: number, eye: Vector3, quality: number) {
    const f = this.f;
    this.time += dt;
    const x = f.px + (f.x - f.px) * alpha;
    const y = f.py + (f.y - f.py) * alpha;
    this.pos.set(x, y, 0);

    if (f.state === 'walk') this.walkPhase += f.vx * f.facing * dt * 3.6;

    const { key, blend } = this.choose(Math.min(alpha, 1));
    if (key !== this.key) {
      copyPose(this.current, this.from);
      this.key = key;
      this.blendT = 0;
      this.blendDur = blend / 60;
    }
    this.blendT = Math.min(1, this.blendT + dt / Math.max(1e-3, this.blendDur));
    blendPoses(this.from, this.target, 1 - Math.pow(1 - this.blendT, 2), this.current);

    // Hit recoil.
    if (f.hitFlash !== this.lastFlash) {
      this.lastFlash = f.hitFlash;
      this.flash = 1;
      this.recoil = 1;
    }
    this.recoil = Math.max(0, this.recoil - dt * 6);
    this.flash = Math.max(0, this.flash - dt * 6);

    const rig = this.rig;
    const p = this.current;
    for (let i = 0; i < JOINTS.length; i++) rig.joints[JOINTS[i]].quaternion.copy(p.q[i]);
    if (this.recoil > 0 && f.state !== 'juggle') {
      dq.setFromAxisAngle(tmp.set(1, 0, 0), -this.recoil * 0.35);
      rig.joints.chest.quaternion.multiply(dq);
      dq.setFromAxisAngle(tmp.set(1, 0, 0), -this.recoil * 0.4);
      rig.joints.head.quaternion.multiply(dq);
    }
    rig.joints.hips.position.set(p.hp.x, HIP_HEIGHT + p.hp.y - PIVOT_Y, p.hp.z);

    // Facing and placement.
    const yaw = Math.PI / 2 - YAW_BIAS;
    rig.root.rotation.set(0, f.facing > 0 ? yaw : -yaw, 0);
    const h = f.def.build[2];
    rig.root.scale.set(f.facing > 0 ? h : -h, h, h);
    let shake = 0;
    if (f.hitstop > 0 && this.flash > 0.2) shake = Math.sin(this.time * 110) * 0.035;
    rig.root.position.set(x + shake, y, 0);

    // Flips and tumbles.
    let flip = 0;
    if (f.state === 'air' && f.jumpDir !== 0) {
      const prog = MathUtils.smoothstep(f.sf, 4, 36);
      flip = prog * Math.PI * 2 * Math.sign(f.jumpDir * f.facing);
    } else if (f.state === 'juggle' || (f.state === 'ko' && !f.grounded)) {
      if (f.vy > -2 || f.y > 1.4) this.spin -= dt * 11;
      else {
        const targetSpin = Math.round(this.spin / (Math.PI * 2)) * Math.PI * 2;
        this.spin += (targetSpin - this.spin) * Math.min(1, dt * 12);
      }
      flip = this.spin;
    } else {
      this.spin = 0;
    }
    rig.pivot.rotation.set(flip, 0, 0);

    // Keep feet on the floor for grounded poses.
    const grounded = f.grounded && (f.state !== 'juggle' && f.state !== 'ko' && f.state !== 'down' && f.state !== 'air');
    rig.root.updateMatrixWorld(true);
    if (grounded && !(f.state === 'attack' && f.move?.air)) {
      const fl = rig.tip('footL', tmp).y;
      const fr = rig.tip('footR', tmp2).y;
      const low = Math.min(fl, fr) - 0.045 * h;
      const corr = MathUtils.clamp(-low + y, -0.25, 0.25);
      if (Math.abs(corr) > 0.002) {
        rig.root.position.y += corr;
        rig.root.updateMatrixWorld(true);
      }
    }

    // Glow & hit flash.
    const maxed = f.meter >= 100;
    const pulse = maxed ? 1.6 + Math.sin(this.time * 6) * 0.5 : 1;
    rig.mats.rimStrength.value = pulse + this.flash * 5;
    rig.mats.armor.emissive.setScalar(this.flash * 0.6);
    rig.mats.suit.emissive.setScalar(this.flash * 0.4);
    for (const r of rig.ribbons) r.material.uniforms.uBoost.value = 1 + (maxed ? 0.6 : 0) + this.flash;

    // Trails.
    const mv = f.state === 'attack' ? f.move : null;
    for (const [limb, trail] of Object.entries(this.trails) as [keyof typeof this.trails, Trail][]) {
      const on = !!mv && mv.limb === limb && f.mf >= mv.startup - 3 && f.mf <= mv.startup + mv.active + 2;
      trail.active = on;
      trail.width = mv?.strength === 'heavy' ? 0.16 : 0.1;
      trail.update(dt, on ? rig.tip(limb, tmp) : null, eye);
    }

    // Ribbons (scarves).
    this.wind.set(-2.5 - f.vx * f.facing * 2, 0.5 + Math.max(0, -f.vy) * 0.6, 1.4);
    for (const r of rig.ribbons) r.update(dt, eye, this.wind);

    // Halo spin for Chantra.
    if (rig.halo) rig.halo.rotation.y = Math.sin(this.time * 1.5) * 0.25;

    this.aura(dt, quality, maxed);
    this.afterimages(dt, quality);
  }

  private aura(dt: number, quality: number, maxed: boolean) {
    const f = this.f;
    const fx = this.fx;
    const rig = this.rig;
    const def = f.def;
    const rate = (maxed ? 70 : 14) * quality * this.auraScale;
    let n = rate * dt;
    const [r, g, b] = hdr(def.accent, maxed ? 4 : 2.4);
    const joints: Joint[] = ['chest', 'hips', 'handL', 'handR', 'footL', 'footR', 'head', 'foreL', 'foreR'];
    while (n > 0) {
      if (n < 1 && Math.random() > n) break;
      n -= 1;
      const j = rig.joints[joints[Math.floor(Math.random() * joints.length)]];
      j.getWorldPosition(tmp);
      fx.emit({
        x: tmp.x + rnd(-0.12, 0.12), y: tmp.y + rnd(-0.1, 0.1), z: tmp.z + rnd(-0.12, 0.12),
        vx: rnd(-0.3, 0.3), vy: rnd(0.6, 1.8), vz: rnd(-0.3, 0.3), life: rnd(0.4, 0.9),
        size: rnd(0.03, maxed ? 0.12 : 0.06), sizeEnd: 0.0, r, g, b, drag: 1.2,
      });
    }
    // Signature idle effects.
    if (def.id === 'phloeng' && quality > 0.4) {
      rig.joints.head.getWorldPosition(tmp);
      for (let i = 0; i < 2; i++) {
        fx.emit({
          x: tmp.x + rnd(-0.06, 0.06), y: tmp.y + 0.22 + rnd(0, 0.05), z: tmp.z + rnd(-0.06, 0.06) - 0.05,
          vx: rnd(-0.3, 0.3) - f.vx * 0.2, vy: rnd(1.2, 2.2), vz: rnd(-0.2, 0.2), life: rnd(0.2, 0.4),
          size: rnd(0.06, 0.12), sizeEnd: 0.01, r: 4.5, g: rnd(1.1, 2.2), b: 0.25, drag: 1,
        });
      }
    } else if (def.id === 'vayu' && quality > 0.5 && Math.random() < (maxed ? 0.5 : 0.08)) {
      const hand = Math.random() < 0.5 ? 'handL' : 'handR';
      rig.tip(hand, tmp);
      fx.zap(tmp, 0.35, 1, 0.05);
    } else if (def.id === 'chantra' && Math.random() < 0.25 * quality) {
      rig.halo?.getWorldPosition(tmp);
      fx.sparkles(tmp, 0.15, 1);
    }
  }

  private afterimages(dt: number, quality: number) {
    const f = this.f;
    const want = this.ghostsEnabled && quality >= 0.5 && (
      f.state === 'dash' ||
      (f.state === 'attack' && (f.move?.id === 'rush' || f.move?.id === 'rising') && f.mf >= f.move.startup - 2 && f.mf < f.move.startup + f.move.active) ||
      (f.state === 'attack' && f.move?.id === 'super' && f.mf > 44 && f.mf < 56)
    );
    this.ghostTimer -= dt;
    if (want && this.ghostTimer <= 0) {
      this.ghostTimer = 0.04;
      let g = this.ghosts.find((x) => x.life <= 0);
      if (!g && this.ghosts.length < 6) {
        const rig = new Rig(f.def, true);
        rig.pivot.position.set(0, PIVOT_Y, 0);
        this.scene.add(rig.root);
        g = { rig, life: 0, mat: rig.mats.glow };
        this.ghosts.push(g);
      }
      if (g) {
        g.rig.copyPoseFrom(this.rig);
        g.life = 0.28;
        g.rig.root.visible = true;
      }
    }
    for (const g of this.ghosts) {
      if (g.life <= 0) { g.rig.root.visible = false; continue; }
      g.life -= dt;
      g.mat.opacity = Math.max(0, g.life / 0.28) * 0.55;
    }
  }

  /** World position between the hands (super charge, beam origin). */
  handsCenter(out: Vector3) {
    this.rig.tip('handL', tmp);
    this.rig.tip('handR', out);
    return out.add(tmp).multiplyScalar(0.5);
  }

  head(out: Vector3) {
    return this.rig.joints.head.getWorldPosition(out);
  }
}
