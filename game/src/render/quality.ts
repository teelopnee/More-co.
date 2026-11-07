// Graphics presets and the automatic tuner that walks down them when the frame rate drops.
export type QualityLevel = 'extreme' | 'ultra' | 'high' | 'medium' | 'low';

export interface Quality {
  level: QualityLevel;
  label: string;
  /** Upper bound on devicePixelRatio. */
  maxPixelRatio: number;
  /** Most pixels rendered per frame; high-DPI screens render below native resolution past this. */
  pixelBudget: number;
  msaa: number;
  bloomScale: number;
  godRays: number;
  /** Planar reflection resolution scale, 0 disables the mirror pass. */
  reflection: number;
  shadows: number;
  particles: number;
  rain: number;
  lanterns: number;
  fxaa: boolean;
  /** 0..1 fraction of background props drawn. */
  detail: number;
}

export const QUALITY_ORDER: QualityLevel[] = ['extreme', 'ultra', 'high', 'medium', 'low'];

export const QUALITY: Record<QualityLevel, Quality> = {
  extreme: {
    level: 'extreme', label: 'สุดขีด', maxPixelRatio: 2, pixelBudget: 8.3e6, msaa: 4, bloomScale: 1, godRays: 64,
    reflection: 0.75, shadows: 4096, particles: 14000, rain: 12000, lanterns: 180, fxaa: false, detail: 1,
  },
  ultra: {
    level: 'ultra', label: 'อัลตร้า', maxPixelRatio: 2, pixelBudget: 3.7e6, msaa: 4, bloomScale: 0.75, godRays: 40,
    reflection: 0.5, shadows: 2048, particles: 9000, rain: 8000, lanterns: 130, fxaa: false, detail: 1,
  },
  high: {
    level: 'high', label: 'สูง', maxPixelRatio: 1.5, pixelBudget: 2.1e6, msaa: 2, bloomScale: 0.6, godRays: 24,
    reflection: 0.4, shadows: 1024, particles: 5500, rain: 4500, lanterns: 80, fxaa: false, detail: 0.8,
  },
  medium: {
    level: 'medium', label: 'กลาง', maxPixelRatio: 1.25, pixelBudget: 1.25e6, msaa: 0, bloomScale: 0.5, godRays: 12,
    reflection: 0, shadows: 1024, particles: 3200, rain: 2200, lanterns: 45, fxaa: true, detail: 0.6,
  },
  low: {
    level: 'low', label: 'ต่ำ', maxPixelRatio: 1, pixelBudget: 0.6e6, msaa: 0, bloomScale: 0.5, godRays: 0,
    reflection: 0, shadows: 0, particles: 1600, rain: 900, lanterns: 20, fxaa: false, detail: 0.35,
  },
};

export const MAX_RAIN = QUALITY.extreme.rain;
export const MAX_LANTERNS = QUALITY.extreme.lanterns;
export const MAX_PARTICLES = QUALITY.extreme.particles;

export function isMobileDevice(): boolean {
  const ua = navigator.userAgent;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(ua));
}

/** Starting preset for "auto": high-end desktops get ultra; extreme is opt-in. */
export function autoStartLevel(cap?: QualityLevel | null): QualityLevel {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const mem = nav.deviceMemory ?? 8;
  const cores = navigator.hardwareConcurrency ?? 4;
  let level: QualityLevel;
  if (isMobileDevice()) level = mem <= 3 || cores <= 4 ? 'medium' : 'high';
  else level = mem <= 4 || cores <= 4 ? 'high' : 'ultra';
  if (cap && QUALITY_ORDER.indexOf(cap) > QUALITY_ORDER.indexOf(level)) level = cap;
  return level;
}

/**
 * Watches frame times. When the average drops under the target for long enough it asks for the
 * next preset down. It never steps back up, so it cannot oscillate.
 */
export class AutoTuner {
  private avg = 1 / 60;
  private bad = 0;
  private warm = 0;
  enabled = true;

  constructor(private readonly onDowngrade: (steps: number) => boolean) {}

  reset() {
    this.bad = 0;
    this.warm = 0;
    this.avg = 1 / 60;
  }

  /** Call every rendered frame with the real frame time in seconds. */
  sample(dt: number) {
    if (!this.enabled) return;
    if (document.hidden || dt > 0.25) return;
    this.warm += dt;
    this.avg += (dt - this.avg) * 0.05;
    if (this.warm < 1.5) return;
    const fps = 1 / this.avg;
    if (fps < 50) this.bad += dt; else this.bad = Math.max(0, this.bad - dt * 0.5);
    if (this.bad > 1.0) {
      this.bad = 0;
      this.warm = 0;
      this.avg = 1 / 60;
      if (!this.onDowngrade(fps < 28 ? 2 : 1)) this.enabled = false;
    }
  }

  get fps() {
    return 1 / this.avg;
  }
}
