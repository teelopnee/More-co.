// Frame data. Everything runs at 60 simulation steps per second.
export type MoveId =
  | 'jab' | 'cross' | 'hook' | 'straight'
  | 'snap' | 'round'
  | 'upper' | 'sweep'
  | 'airP' | 'airK'
  | 'orb' | 'rush' | 'rising' | 'super';

export type Strength = 'light' | 'medium' | 'heavy' | 'super';
export type Limb = 'handL' | 'handR' | 'footL' | 'footR' | 'none';

export interface Box {
  /** Centre offset along the facing direction (m). */
  x: number;
  /** Centre height above the fighter's origin (m). */
  y: number;
  w: number;
  h: number;
}

export interface MoveDef {
  id: MoveId;
  startup: number;
  active: number;
  recovery: number;
  damage: number;
  hitstun: number;
  blockstun: number;
  hitbox: Box;
  level: 'mid' | 'low' | 'overhead';
  /** What happens to a grounded opponent on hit. Airborne opponents always juggle. */
  onHit: 'stun' | 'launch' | 'knockdown';
  push: number;
  lift?: number;
  hits?: number;
  hitInterval?: number;
  /** Chain targets for a button pressed after this move connects. */
  chain?: { p?: MoveId; k?: MoveId };
  /** Can be cancelled into specials (s) / super (u) after connecting. */
  cancel?: 'special' | 'super';
  air?: boolean;
  crouch?: boolean;
  /** Velocity overrides by move frame, in m/s along facing. */
  motion?: { from: number; to: number; vx: number; vy?: number }[];
  invuln?: [number, number];
  /** Chip damage on block (specials only). */
  chip?: number;
  strength: Strength;
  limb: Limb;
  special?: boolean;
  /** Landing recovery for moves that leave the ground. */
  landing?: number;
}

const m = (d: MoveDef) => d;

export const MOVES: Record<MoveId, MoveDef> = {
  jab: m({
    id: 'jab', startup: 4, active: 3, recovery: 9, damage: 35, hitstun: 14, blockstun: 10,
    hitbox: { x: 0.78, y: 1.42, w: 0.62, h: 0.34 }, level: 'mid', onHit: 'stun', push: 1.6,
    chain: { p: 'cross', k: 'snap' }, cancel: 'special', strength: 'light', limb: 'handL',
  }),
  cross: m({
    id: 'cross', startup: 5, active: 3, recovery: 12, damage: 45, hitstun: 16, blockstun: 11,
    hitbox: { x: 0.86, y: 1.42, w: 0.66, h: 0.36 }, level: 'mid', onHit: 'stun', push: 2.0,
    chain: { p: 'hook', k: 'round' }, cancel: 'special', strength: 'medium', limb: 'handR',
    motion: [{ from: 0, to: 6, vx: 1.6 }],
  }),
  hook: m({
    id: 'hook', startup: 8, active: 4, recovery: 18, damage: 72, hitstun: 20, blockstun: 14,
    hitbox: { x: 0.82, y: 1.4, w: 0.72, h: 0.5 }, level: 'mid', onHit: 'knockdown', push: 5.5, lift: 6.5,
    cancel: 'special', strength: 'heavy', limb: 'handL', motion: [{ from: 0, to: 9, vx: 2.4 }],
  }),
  straight: m({
    id: 'straight', startup: 9, active: 4, recovery: 17, damage: 82, hitstun: 20, blockstun: 13,
    hitbox: { x: 0.98, y: 1.4, w: 0.82, h: 0.4 }, level: 'mid', onHit: 'stun', push: 3.4,
    cancel: 'special', strength: 'heavy', limb: 'handR', motion: [{ from: 0, to: 10, vx: 3.2 }],
  }),
  snap: m({
    id: 'snap', startup: 6, active: 3, recovery: 13, damage: 52, hitstun: 16, blockstun: 11,
    hitbox: { x: 0.9, y: 1.0, w: 0.78, h: 0.42 }, level: 'mid', onHit: 'stun', push: 2.2,
    chain: { k: 'round', p: 'straight' }, cancel: 'special', strength: 'medium', limb: 'footR',
  }),
  round: m({
    id: 'round', startup: 11, active: 4, recovery: 20, damage: 96, hitstun: 22, blockstun: 15,
    hitbox: { x: 0.98, y: 1.36, w: 0.96, h: 0.52 }, level: 'mid', onHit: 'knockdown', push: 6.5, lift: 5.5,
    strength: 'heavy', limb: 'footR', motion: [{ from: 0, to: 12, vx: 1.2 }],
  }),
  upper: m({
    id: 'upper', startup: 6, active: 5, recovery: 21, damage: 86, hitstun: 20, blockstun: 13,
    hitbox: { x: 0.62, y: 1.55, w: 0.66, h: 1.1 }, level: 'mid', onHit: 'launch', push: 1.3, lift: 11.5,
    cancel: 'special', strength: 'heavy', limb: 'handR', crouch: true,
  }),
  sweep: m({
    id: 'sweep', startup: 8, active: 4, recovery: 22, damage: 76, hitstun: 18, blockstun: 12,
    hitbox: { x: 0.98, y: 0.18, w: 1.04, h: 0.32 }, level: 'low', onHit: 'knockdown', push: 2.0, lift: 3.6,
    cancel: 'special', strength: 'medium', limb: 'footR', crouch: true,
  }),
  airP: m({
    id: 'airP', startup: 5, active: 8, recovery: 8, damage: 56, hitstun: 16, blockstun: 10,
    hitbox: { x: 0.62, y: 1.0, w: 0.62, h: 0.52 }, level: 'overhead', onHit: 'stun', push: 1.8,
    strength: 'medium', limb: 'handR', air: true, landing: 4,
  }),
  airK: m({
    id: 'airK', startup: 7, active: 11, recovery: 8, damage: 72, hitstun: 18, blockstun: 12,
    hitbox: { x: 0.72, y: 0.55, w: 0.82, h: 0.55 }, level: 'overhead', onHit: 'stun', push: 2.2,
    strength: 'heavy', limb: 'footR', air: true, landing: 5,
  }),
  orb: m({
    id: 'orb', startup: 14, active: 1, recovery: 26, damage: 72, hitstun: 18, blockstun: 13,
    hitbox: { x: 0, y: 1.3, w: 0.56, h: 0.56 }, level: 'mid', onHit: 'stun', push: 2.6,
    chip: 9, strength: 'heavy', limb: 'handR', special: true, cancel: 'super',
  }),
  rush: m({
    id: 'rush', startup: 10, active: 14, recovery: 18, damage: 104, hitstun: 22, blockstun: 16,
    hitbox: { x: 0.72, y: 1.2, w: 0.82, h: 1.0 }, level: 'mid', onHit: 'knockdown', push: 7.5, lift: 4.5,
    chip: 12, strength: 'heavy', limb: 'handR', special: true, cancel: 'super',
    motion: [{ from: 0, to: 8, vx: -0.6 }, { from: 8, to: 24, vx: 13 }],
  }),
  rising: m({
    id: 'rising', startup: 4, active: 14, recovery: 22, damage: 62, hitstun: 20, blockstun: 14,
    hitbox: { x: 0.55, y: 1.35, w: 0.85, h: 1.6 }, level: 'mid', onHit: 'launch', push: 1.6, lift: 12.5,
    hits: 2, hitInterval: 7, chip: 8, strength: 'heavy', limb: 'handR', special: true,
    invuln: [0, 9], motion: [{ from: 4, to: 16, vx: 2.2, vy: 11.5 }], landing: 12, cancel: 'super',
  }),
  super: m({
    id: 'super', startup: 48, active: 72, recovery: 30, damage: 32, hitstun: 16, blockstun: 10,
    hitbox: { x: 0, y: 1.1, w: 0, h: 1.1 }, level: 'mid', onHit: 'stun', push: 1.4,
    hits: 10, hitInterval: 7, chip: 7, strength: 'super', limb: 'handR', special: true,
    invuln: [0, 60],
  }),
};

export const isActive = (mv: MoveDef, frame: number) => frame >= mv.startup && frame < mv.startup + mv.active;
export const totalFrames = (mv: MoveDef) => mv.startup + mv.active + mv.recovery;
