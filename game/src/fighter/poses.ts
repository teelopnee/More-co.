// Keyframe poses (degrees, model space: +Z forward, +Y up, +X is the fighter's left) and
// animation clips keyed to simulation frames.
import { Euler, MathUtils, Quaternion, Vector3 } from 'three';
import { JOINTS, type Joint } from './rig';

type R = [number, number, number];
export interface PoseDef extends Partial<Record<Joint, R>> {
  /** Hip offset [left, up, forward] in metres. */
  hp?: R;
}

export const POSES: Record<string, PoseDef> = {
  guard: {
    hp: [0, -0.1, 0],
    hips: [0, -32, 0], spine: [8, -6, 0], chest: [6, -12, 0], neck: [-4, 18, 0], head: [-6, 28, 0],
    armL: [-62, 6, 22], foreL: [-100, 0, 0], handL: [10, 0, 0],
    armR: [-38, -10, -28], foreR: [-128, 0, 0], handR: [10, 0, 0],
    thighL: [-30, 30, 8], shinL: [34, 0, 0], footL: [-4, -20, 0],
    thighR: [16, 26, -6], shinR: [30, 0, 0], footR: [-18, 8, 0],
  },
  guardBreath: {
    hp: [0, -0.125, 0],
    hips: [2, -32, 0], spine: [10, -6, 0], chest: [8, -12, 0], neck: [-4, 18, 0], head: [-8, 28, 0],
    armL: [-60, 6, 24], foreL: [-104, 0, 0], handL: [10, 0, 0],
    armR: [-36, -10, -30], foreR: [-130, 0, 0], handR: [10, 0, 0],
    thighL: [-34, 30, 8], shinL: [42, 0, 0], footL: [-6, -20, 0],
    thighR: [12, 26, -6], shinR: [38, 0, 0], footR: [-20, 8, 0],
  },
  block: {
    hp: [0, -0.14, -0.03],
    hips: [0, -28, 0], spine: [14, -4, 0], chest: [10, -6, 0], neck: [6, 10, 0], head: [8, 20, 0],
    armL: [-100, 18, 28], foreL: [-118, 0, 0], handL: [20, 0, 0],
    armR: [-92, -22, -30], foreR: [-122, 0, 0], handR: [20, 0, 0],
    thighL: [-26, 30, 8], shinL: [42, 0, 0], footL: [-10, -20, 0],
    thighR: [22, 24, -8], shinR: [36, 0, 0], footR: [-22, 8, 0],
  },
  crouch: {
    hp: [0, -0.46, 0.0],
    hips: [18, -28, 0], spine: [16, -4, 0], chest: [8, -10, 0], neck: [-12, 14, 0], head: [-16, 24, 0],
    armL: [-62, 6, 22], foreL: [-104, 0, 0], handL: [10, 0, 0],
    armR: [-40, -10, -26], foreR: [-126, 0, 0], handR: [10, 0, 0],
    thighL: [-96, 30, 12], shinL: [118, 0, 0], footL: [-20, -20, 0],
    thighR: [-30, 22, -16], shinR: [128, 0, 0], footR: [-48, 8, 0],
  },
  crouchBlock: {
    hp: [0, -0.5, -0.03],
    hips: [20, -26, 0], spine: [20, -4, 0], chest: [12, -6, 0], neck: [6, 10, 0], head: [6, 18, 0],
    armL: [-104, 18, 26], foreL: [-118, 0, 0], handL: [20, 0, 0],
    armR: [-96, -22, -28], foreR: [-122, 0, 0], handR: [20, 0, 0],
    thighL: [-98, 30, 12], shinL: [124, 0, 0], footL: [-22, -20, 0],
    thighR: [-32, 22, -16], shinR: [132, 0, 0], footR: [-50, 8, 0],
  },
  squat: {
    hp: [0, -0.3, 0],
    hips: [14, -20, 0], spine: [12, 0, 0], chest: [6, -6, 0], head: [-8, 18, 0],
    armL: [-30, 0, 30], foreL: [-80, 0, 0], armR: [-20, 0, -30], foreR: [-90, 0, 0],
    thighL: [-70, 12, 10], shinL: [96, 0, 0], footL: [-24, 0, 0],
    thighR: [-50, 12, -10], shinR: [96, 0, 0], footR: [-40, 0, 0],
  },
  jumpUp: {
    hp: [0, -0.02, 0],
    hips: [-4, -20, 0], spine: [-4, 0, 0], chest: [-6, -6, 0], head: [6, 18, 0],
    armL: [-150, 0, 24], foreL: [-40, 0, 0], armR: [-120, 0, -40], foreR: [-60, 0, 0],
    thighL: [-70, 10, 6], shinL: [80, 0, 0], footL: [20, 0, 0],
    thighR: [6, 10, -6], shinR: [40, 0, 0], footR: [30, 0, 0],
  },
  tuck: {
    hp: [0, 0.1, 0],
    hips: [10, -10, 0], spine: [24, 0, 0], chest: [18, 0, 0], head: [20, 10, 0],
    armL: [-60, 0, 20], foreL: [-120, 0, 0], armR: [-60, 0, -20], foreR: [-120, 0, 0],
    thighL: [-120, 10, 8], shinL: [140, 0, 0], footL: [20, 0, 0],
    thighR: [-110, 10, -8], shinR: [140, 0, 0], footR: [20, 0, 0],
  },
  jumpFall: {
    hp: [0, -0.05, 0],
    hips: [0, -28, 0], spine: [6, -4, 0], chest: [4, -10, 0], head: [0, 26, 0],
    armL: [-70, 0, 40], foreL: [-80, 0, 0], armR: [-50, 0, -50], foreR: [-100, 0, 0],
    thighL: [-40, 24, 10], shinL: [60, 0, 0], footL: [10, 0, 0],
    thighR: [-10, 24, -10], shinR: [70, 0, 0], footR: [20, 0, 0],
  },
  dashF: {
    hp: [0, -0.2, 0.08],
    hips: [20, -24, 0], spine: [16, -4, 0], chest: [10, -8, 0], head: [-26, 22, 0],
    armL: [10, 0, 24], foreL: [-30, 0, 0], armR: [30, 0, -30], foreR: [-20, 0, 0],
    thighL: [-70, 26, 8], shinL: [70, 0, 0], footL: [-10, -20, 0],
    thighR: [30, 20, -6], shinR: [60, 0, 0], footR: [20, 8, 0],
  },
  dashB: {
    hp: [0, -0.12, -0.05],
    hips: [-12, -30, 0], spine: [-8, -6, 0], chest: [-6, -10, 0], head: [12, 24, 0],
    armL: [-50, 6, 30], foreL: [-100, 0, 0], armR: [-30, -10, -36], foreR: [-120, 0, 0],
    thighL: [-50, 30, 8], shinL: [40, 0, 0], footL: [10, -20, 0],
    thighR: [-10, 26, -6], shinR: [80, 0, 0], footR: [10, 8, 0],
  },

  // ── Punches ──
  jab: {
    hp: [0, -0.1, 0.06],
    hips: [0, -40, 0], spine: [8, -8, 0], chest: [6, -22, 0], neck: [-4, 22, 0], head: [-6, 36, 0],
    armL: [-84, 62, 6], foreL: [-6, 0, 0], handL: [0, 0, 0],
    armR: [-40, -10, -28], foreR: [-130, 0, 0], handR: [10, 0, 0],
    thighL: [-34, 34, 8], shinL: [30, 0, 0], footL: [-4, -20, 0],
    thighR: [18, 30, -6], shinR: [26, 0, 0], footR: [-18, 8, 0],
  },
  cross: {
    hp: [0, -0.12, 0.12],
    hips: [0, -4, 0], spine: [12, 8, 0], chest: [10, 26, 0], neck: [-4, -10, 0], head: [-8, -14, 0],
    armL: [-50, 6, 30], foreL: [-112, 0, 0], handL: [10, 0, 0],
    armR: [-86, -30, -4], foreR: [-4, 0, 0], handR: [0, 0, 0],
    thighL: [-36, 8, 8], shinL: [36, 0, 0], footL: [-6, -20, 0],
    thighR: [26, 4, -6], shinR: [12, 0, 0], footR: [-30, 20, 0],
  },
  hookWind: {
    hp: [0, -0.14, -0.02],
    hips: [0, -50, 0], spine: [6, -12, 0], chest: [4, -26, 0], head: [-6, 40, 0],
    armL: [-10, 50, 80], foreL: [-105, 0, 0], handL: [0, 0, 0],
    armR: [-40, -10, -28], foreR: [-130, 0, 0],
    thighL: [-28, 40, 8], shinL: [40, 0, 0], footL: [-4, -20, 0],
    thighR: [14, 34, -6], shinR: [36, 0, 0], footR: [-18, 8, 0],
  },
  hook: {
    hp: [0, -0.16, 0.1],
    hips: [0, 10, 0], spine: [10, 14, -6], chest: [8, 30, -8], head: [-6, -22, 0],
    armL: [-6, -54, 86], foreL: [-96, 0, 0], handL: [0, 0, 0],
    armR: [-30, -10, -36], foreR: [-120, 0, 0],
    thighL: [-36, 0, 8], shinL: [40, 0, 0], footL: [-6, -10, 0],
    thighR: [24, 0, -6], shinR: [20, 0, 0], footR: [-30, 20, 0],
  },
  straightWind: {
    hp: [0, -0.16, -0.06],
    hips: [0, -44, 0], spine: [4, -10, 0], chest: [2, -24, 0], head: [-4, 38, 0],
    armL: [-70, 6, 24], foreL: [-96, 0, 0],
    armR: [-20, -20, -40], foreR: [-120, 0, 0],
    thighL: [-30, 36, 8], shinL: [40, 0, 0], footL: [-4, -20, 0],
    thighR: [18, 30, -6], shinR: [40, 0, 0], footR: [-18, 8, 0],
  },
  straight: {
    hp: [0, -0.2, 0.22],
    hips: [6, 0, 0], spine: [14, 10, 0], chest: [10, 30, 0], neck: [-6, -14, 0], head: [-10, -16, 0],
    armL: [-30, 6, 40], foreL: [-120, 0, 0],
    armR: [-90, -40, -4], foreR: [0, 0, 0], handR: [-6, 0, 0],
    thighL: [-50, 6, 8], shinL: [50, 0, 0], footL: [-6, -20, 0],
    thighR: [34, 4, -6], shinR: [8, 0, 0], footR: [-36, 20, 0],
  },

  // ── Kicks ──
  snapChamber: {
    hp: [0, -0.06, -0.04],
    hips: [-6, -30, 0], spine: [-4, -6, 0], chest: [-2, -12, 0], head: [6, 26, 0],
    armL: [-60, 6, 30], foreL: [-100, 0, 0], armR: [-30, -10, -36], foreR: [-120, 0, 0],
    thighL: [-8, 30, 8], shinL: [20, 0, 0], footL: [-4, -20, 0],
    thighR: [-100, 30, -6], shinR: [110, 0, 0], footR: [20, 8, 0],
  },
  snap: {
    hp: [0, -0.04, -0.06],
    hips: [-14, -30, 0], spine: [-8, -6, 0], chest: [-4, -12, 0], head: [10, 26, 0],
    armL: [-50, 6, 34], foreL: [-100, 0, 0], armR: [-10, -10, -40], foreR: [-110, 0, 0],
    thighL: [-4, 30, 8], shinL: [16, 0, 0], footL: [-4, -20, 0],
    thighR: [-96, 30, -6], shinR: [6, 0, 0], footR: [40, 8, 0],
  },
  roundChamber: {
    hp: [0, -0.04, 0],
    hips: [0, 40, -8], spine: [0, -4, -6], chest: [0, -10, -4], head: [0, -36, 10],
    armL: [-30, 0, 50], foreL: [-90, 0, 0], armR: [-30, 0, -40], foreR: [-100, 0, 0],
    thighL: [-8, -10, 10], shinL: [16, 0, 0], footL: [-4, 0, 0],
    thighR: [-80, -30, -40], shinR: [120, 0, 0], footR: [30, 0, 0],
  },
  round: {
    hp: [0, 0.02, -0.02],
    hips: [0, 78, -16], spine: [0, -4, -14], chest: [0, -12, -10], head: [0, -56, 22],
    armL: [-20, 0, 64], foreL: [-70, 0, 0], armR: [-24, 0, -48], foreR: [-90, 0, 0],
    thighL: [-6, 0, 18], shinL: [10, 0, 0], footL: [0, 0, 0],
    thighR: [-12, -14, -96], shinR: [6, 0, 0], footR: [40, 0, 0],
  },

  // ── Crouching ──
  upperLow: {
    hp: [0, -0.5, 0.02],
    hips: [22, -36, 0], spine: [16, -6, 0], chest: [10, -18, 0], head: [-16, 30, 0],
    armL: [-60, 6, 22], foreL: [-104, 0, 0],
    armR: [20, -10, -20], foreR: [-120, 0, 0],
    thighL: [-98, 34, 12], shinL: [120, 0, 0], footL: [-20, -20, 0],
    thighR: [-30, 26, -16], shinR: [128, 0, 0], footR: [-48, 8, 0],
  },
  upper: {
    hp: [0, -0.04, 0.12],
    hips: [-8, 4, 0], spine: [-8, 12, -8], chest: [-10, 28, -10], head: [16, -10, 0],
    armL: [-40, 6, 30], foreL: [-110, 0, 0],
    armR: [-178, 10, -6], foreR: [-30, 0, 0], handR: [0, 0, 0],
    thighL: [-36, 8, 8], shinL: [30, 0, 0], footL: [-6, -10, 0],
    thighR: [22, 4, -6], shinR: [16, 0, 0], footR: [-40, 20, 0],
  },
  sweep: {
    hp: [0, -0.62, 0],
    hips: [24, 80, -8], spine: [16, -10, -6], chest: [10, -20, 0], head: [-30, -50, 10],
    armL: [-70, 0, 30], foreL: [-10, 0, 0], armR: [-60, 0, -30], foreR: [-10, 0, 0],
    thighL: [-118, -20, 20], shinL: [140, 0, 0], footL: [-30, 0, 0],
    thighR: [-16, -10, -94], shinR: [0, 0, 0], footR: [30, 0, 0],
  },

  // ── Air ──
  airP: {
    hp: [0, 0.04, 0.04],
    hips: [10, -20, 0], spine: [16, 10, 0], chest: [10, 24, 0], head: [-6, -10, 0],
    armL: [-50, 0, 40], foreL: [-110, 0, 0],
    armR: [-60, -14, -6], foreR: [0, 0, 0], handR: [-30, 0, 0],
    thighL: [-90, 20, 6], shinL: [120, 0, 0], footL: [20, 0, 0],
    thighR: [-40, 20, -6], shinR: [100, 0, 0], footR: [30, 0, 0],
  },
  airK: {
    hp: [0, 0.1, 0],
    hips: [-30, -20, 0], spine: [6, -6, 0], chest: [10, -10, 0], head: [10, 30, 0],
    armL: [-90, 0, 50], foreL: [-60, 0, 0], armR: [-20, 0, -70], foreR: [-50, 0, 0],
    thighL: [-110, 30, 8], shinL: [130, 0, 0], footL: [20, 0, 0],
    thighR: [-40, 30, -6], shinR: [2, 0, 0], footR: [40, 0, 0],
  },

  // ── Specials ──
  orbCharge: {
    hp: [0, -0.2, -0.06],
    hips: [6, -60, 0], spine: [4, -14, 0], chest: [2, -22, 0], head: [-6, 60, 0],
    armL: [-40, -40, 30], foreL: [-90, 0, 0], handL: [0, 0, 0],
    armR: [-30, -40, -30], foreR: [-100, 0, 0],
    thighL: [-36, 50, 10], shinL: [50, 0, 0], footL: [-8, -20, 0],
    thighR: [20, 44, -6], shinR: [50, 0, 0], footR: [-18, 8, 0],
  },
  orbRelease: {
    hp: [0, -0.2, 0.16],
    hips: [6, -6, 0], spine: [10, 6, 0], chest: [6, 14, 0], head: [-8, -8, 0],
    armL: [-86, -26, 4], foreL: [-10, 0, 0], handL: [-60, 0, 0],
    armR: [-86, -2, -4], foreR: [-10, 0, 0], handR: [-60, 0, 0],
    thighL: [-40, 10, 8], shinL: [40, 0, 0], footL: [-6, -20, 0],
    thighR: [30, 6, -6], shinR: [16, 0, 0], footR: [-30, 20, 0],
  },
  rushWind: {
    hp: [0, -0.28, -0.08],
    hips: [14, -40, 0], spine: [10, -10, 0], chest: [6, -20, 0], head: [-20, 40, 0],
    armL: [-70, 0, 20], foreL: [-110, 0, 0], armR: [20, -30, -30], foreR: [-100, 0, 0],
    thighL: [-60, 36, 10], shinL: [80, 0, 0], footL: [-10, -20, 0],
    thighR: [20, 30, -6], shinR: [70, 0, 0], footR: [-18, 8, 0],
  },
  rush: {
    hp: [0, -0.24, 0.2],
    hips: [24, 0, 0], spine: [16, 10, 0], chest: [8, 24, 0], head: [-28, -10, 0],
    armL: [10, 0, 40], foreL: [-40, 0, 0],
    armR: [-92, -34, -4], foreR: [-4, 0, 0], handR: [-50, 0, 0],
    thighL: [-60, 6, 8], shinL: [50, 0, 0], footL: [-6, -20, 0],
    thighR: [40, 4, -6], shinR: [20, 0, 0], footR: [-30, 20, 0],
  },
  rising: {
    hp: [0, 0.08, 0.1],
    hips: [-10, 20, 0], spine: [-10, 20, -8], chest: [-12, 30, -10], head: [16, -20, 0],
    armL: [-40, 0, 50], foreL: [-90, 0, 0],
    armR: [-176, 0, -10], foreR: [-10, 0, 0], handR: [0, 0, 0],
    thighL: [-90, 10, 8], shinL: [110, 0, 0], footL: [20, 0, 0],
    thighR: [10, 10, -6], shinR: [30, 0, 0], footR: [30, 0, 0],
  },
  superCharge: {
    hp: [0, -0.32, -0.04],
    hips: [10, -70, 0], spine: [6, -10, 0], chest: [-6, -10, 0], head: [-16, 70, 0],
    armL: [-30, -60, 40], foreL: [-80, 0, 0], handL: [0, 0, 0],
    armR: [-26, -60, -26], foreR: [-90, 0, 0], handR: [0, 0, 0],
    thighL: [-44, 60, 20], shinL: [70, 0, 0], footL: [-10, -20, 0],
    thighR: [26, 50, -10], shinR: [64, 0, 0], footR: [-18, 8, 0],
  },
  superFire: {
    hp: [0, -0.28, 0.12],
    hips: [6, -10, 0], spine: [8, 6, 0], chest: [0, 12, 0], head: [-6, -6, 0],
    armL: [-88, -18, 4], foreL: [-6, 0, 0], handL: [-70, 0, 0],
    armR: [-88, 2, -4], foreR: [-6, 0, 0], handR: [-70, 0, 0],
    thighL: [-46, 14, 10], shinL: [50, 0, 0], footL: [-6, -20, 0],
    thighR: [36, 8, -6], shinR: [24, 0, 0], footR: [-30, 20, 0],
  },

  // ── Reactions ──
  hitHigh: {
    hp: [0, -0.12, -0.12],
    hips: [-14, -30, 0], spine: [-16, -10, 6], chest: [-14, -10, 6], neck: [-14, 10, 0], head: [-28, 30, 10],
    armL: [-20, 0, 50], foreL: [-70, 0, 0], armR: [10, 0, -50], foreR: [-80, 0, 0],
    thighL: [-20, 30, 8], shinL: [30, 0, 0], footL: [10, -20, 0],
    thighR: [10, 26, -6], shinR: [50, 0, 0], footR: [-10, 8, 0],
  },
  hitLow: {
    hp: [0, -0.3, -0.06],
    hips: [30, -30, 0], spine: [24, -4, 0], chest: [16, -10, 0], head: [20, 30, 0],
    armL: [-10, 0, 30], foreL: [-80, 0, 0], armR: [0, 0, -30], foreR: [-80, 0, 0],
    thighL: [-60, 30, 8], shinL: [70, 0, 0], footL: [-10, -20, 0],
    thighR: [-10, 26, -6], shinR: [80, 0, 0], footR: [-20, 8, 0],
  },
  tumble: {
    hp: [0, 0.1, 0],
    hips: [-40, -20, 0], spine: [-20, 0, 0], chest: [-14, 0, 0], head: [-30, 20, 0],
    armL: [-160, 0, 50], foreL: [-30, 0, 0], armR: [-150, 0, -60], foreR: [-40, 0, 0],
    thighL: [-60, 20, 10], shinL: [60, 0, 0], footL: [20, 0, 0],
    thighR: [-30, 20, -10], shinR: [90, 0, 0], footR: [20, 0, 0],
  },
  lie: {
    hp: [0, -0.86, -0.25],
    hips: [-88, -10, 0], spine: [-4, 0, 0], chest: [-2, 0, 4], head: [-10, 30, 0],
    armL: [-30, 0, 70], foreL: [-30, 0, 0], armR: [-50, 0, -60], foreR: [-50, 0, 0],
    thighL: [-10, 0, 10], shinL: [20, 0, 0], footL: [-40, 0, 0],
    thighR: [-30, 0, -6], shinR: [50, 0, 0], footR: [-40, 0, 0],
  },
  getup: {
    hp: [0, -0.5, -0.05],
    hips: [10, -30, 0], spine: [30, 0, 0], chest: [10, -10, 0], head: [-20, 20, 0],
    armL: [-20, 0, 40], foreL: [-60, 0, 0], armR: [-10, 0, -40], foreR: [-70, 0, 0],
    thighL: [-100, 30, 10], shinL: [120, 0, 0], footL: [-10, -20, 0],
    thighR: [-20, 20, -10], shinR: [130, 0, 0], footR: [-50, 8, 0],
  },
  win: {
    hp: [0, 0, 0],
    hips: [0, -20, 0], spine: [-4, -6, 0], chest: [-6, -10, 0], head: [-16, 20, 0],
    armL: [-40, 0, 20], foreL: [-110, 0, 0], handL: [0, 0, 0],
    armR: [-176, -20, -16], foreR: [-20, 0, 0], handR: [0, 0, 0],
    thighL: [-10, 20, 10], shinL: [10, 0, 0], footL: [0, -10, 0],
    thighR: [6, 20, -10], shinR: [10, 0, 0], footR: [0, 8, 0],
  },
  wai: {
    hp: [0, -0.02, 0],
    hips: [0, 0, 0], spine: [8, 0, 0], chest: [8, 0, 0], head: [22, 0, 0],
    armL: [-22, 0, -6], foreL: [-122, -38, 0], handL: [0, 0, 20],
    armR: [-22, 0, 6], foreR: [-122, 38, 0], handR: [0, 0, -20],
    thighL: [-2, 0, 4], shinL: [4, 0, 0], footL: [0, 0, 0],
    thighR: [-2, 0, -4], shinR: [4, 0, 0], footR: [0, 0, 0],
  },
};

export interface CompiledPose {
  q: Quaternion[];
  hp: Vector3;
}

const euler = new Euler();
function compile(p: PoseDef): CompiledPose {
  const q = JOINTS.map((j) => {
    const r = p[j] ?? [0, 0, 0];
    euler.set(r[0] * MathUtils.DEG2RAD, r[1] * MathUtils.DEG2RAD, r[2] * MathUtils.DEG2RAD, 'YXZ');
    return new Quaternion().setFromEuler(euler);
  });
  const hp = p.hp ?? [0, 0, 0];
  return { q, hp: new Vector3(hp[0], hp[1], hp[2]) };
}

export const COMPILED: Record<string, CompiledPose> = Object.fromEntries(
  Object.entries(POSES).map(([k, v]) => [k, compile(v)]),
);

export type Ease = 'lin' | 'out' | 'in' | 'io' | 'hold';
/** [frame, pose, ease into this key] */
export type Key = [number, string, Ease?];

/** Attack clips, frame-aligned with the move data in sim/moves.ts. */
export const CLIPS: Record<string, Key[]> = {
  jab: [[0, 'guard'], [3, 'jab', 'out'], [7, 'jab'], [16, 'guard', 'io']],
  cross: [[0, 'guard'], [4, 'cross', 'out'], [8, 'cross'], [20, 'guard', 'io']],
  hook: [[0, 'guard'], [5, 'hookWind', 'io'], [9, 'hook', 'out'], [13, 'hook'], [30, 'guard', 'io']],
  straight: [[0, 'guard'], [6, 'straightWind', 'io'], [10, 'straight', 'out'], [14, 'straight'], [30, 'guard', 'io']],
  snap: [[0, 'guard'], [4, 'snapChamber', 'out'], [7, 'snap', 'out'], [10, 'snap'], [16, 'snapChamber', 'io'], [22, 'guard', 'io']],
  round: [[0, 'guard'], [7, 'roundChamber', 'io'], [12, 'round', 'out'], [16, 'round'], [26, 'roundChamber', 'io'], [35, 'guard', 'io']],
  upper: [[0, 'crouch'], [3, 'upperLow', 'out'], [7, 'upper', 'out'], [12, 'upper'], [32, 'guard', 'io']],
  sweep: [[0, 'crouch'], [8, 'sweep', 'out'], [13, 'sweep'], [26, 'crouch', 'io'], [34, 'crouch']],
  airP: [[0, 'jumpFall'], [4, 'airP', 'out'], [21, 'airP']],
  airK: [[0, 'tuck'], [6, 'airK', 'out'], [26, 'airK']],
  orb: [[0, 'guard'], [9, 'orbCharge', 'io'], [14, 'orbRelease', 'out'], [26, 'orbRelease'], [41, 'guard', 'io']],
  rush: [[0, 'guard'], [8, 'rushWind', 'io'], [11, 'rush', 'out'], [24, 'rush'], [42, 'guard', 'io']],
  rising: [[0, 'upperLow'], [4, 'upperLow'], [9, 'rising', 'out'], [26, 'rising'], [40, 'jumpFall', 'io']],
  super: [[0, 'guard'], [20, 'superCharge', 'io'], [46, 'superCharge'], [50, 'superFire', 'out'], [120, 'superFire'], [150, 'guard', 'io']],
};

const ease = (e: Ease | undefined, t: number) => {
  switch (e) {
    case 'out': return 1 - (1 - t) * (1 - t) * (1 - t);
    case 'in': return t * t * t;
    case 'io': return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    case 'hold': return 0;
    default: return t;
  }
};

/** Samples a clip into `out` at fractional frame t. */
export function sampleClip(keys: Key[], t: number, out: CompiledPose) {
  let i = 0;
  while (i < keys.length - 1 && keys[i + 1][0] <= t) i++;
  const a = keys[i];
  const b = keys[Math.min(i + 1, keys.length - 1)];
  if (a === b || b[0] === a[0]) { copyPose(COMPILED[a[1]], out); return; }
  const u = ease(b[2], Math.min(1, Math.max(0, (t - a[0]) / (b[0] - a[0]))));
  blendPoses(COMPILED[a[1]], COMPILED[b[1]], u, out);
}

export function copyPose(src: CompiledPose, out: CompiledPose) {
  for (let i = 0; i < src.q.length; i++) out.q[i].copy(src.q[i]);
  out.hp.copy(src.hp);
}

export function blendPoses(a: CompiledPose, b: CompiledPose, t: number, out: CompiledPose) {
  for (let i = 0; i < a.q.length; i++) out.q[i].slerpQuaternions(a.q[i], b.q[i], t);
  out.hp.lerpVectors(a.hp, b.hp, t);
}

export function newPose(): CompiledPose {
  return { q: JOINTS.map(() => new Quaternion()), hp: new Vector3() };
}
