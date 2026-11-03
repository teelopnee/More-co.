// Graphics presets and the automatic tuner that walks down them when the frame rate drops.
export type QualityLevel = 'extreme' | 'ultra' | 'high' | 'medium' | 'low';

export interface Quality {
  level: QualityLevel;
  label: string;
  /** Multiplier on devicePixelRatio, capped by maxPixelRatio. */
  maxPixelRatio: number;
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
    level: 'extreme', label: 'สุดขีด', maxPixelRatio: 3, msaa: 8, bloomScale: 1, godRays: 72,
    reflection: 1, shadows: 4096, particles: 14000, rain: 14000, lanterns: 180, fxaa: false, detail: 1,
  },
  ultra: {
    level: 'ultra', label: 'อัลตร้า', maxPixelRatio: 2, msaa: 4, bloomScale: 1, godRays: 48,
    reflection: 0.6, shadows: 2048, particles: 9000, rain: 8000, lanterns: 130, fxaa: false, detail: 1,
  },
  high: {
    level: 'high', label: 'สูง', maxPixelRatio: 1.5, msaa: 2, bloomScale: 0.75, godRays: 28,
    reflection: 0.45, shadows: 1024, particles: 5500, rain: 4500, lanterns: 80, fxaa: false, detail: 0.8,
  },
  medium: {
    level: 'medium', label: 'กลาง', maxPixelRatio: 1, msaa: 0, bloomScale: 0.5, godRays: 14,
    reflection: 0, shadows: 0, particles: 3200, rain: 2200, lanterns: 45, fxaa: true, detail: 0.6,
  },
  low: {
    level: 'low', label: 'ต่ำ', maxPixelRatio: 0.75, msaa: 0, bloomScale: 0.5, godRays: 0,
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

export function autoStartLevel(): QualityLevel {
  return isMobileDevice() ? 'high' : 'extreme';
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

  constructor(private readonly onDowngrade: () => boolean) {}

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
    if (this.warm < 2.5) return;
    const fps = 1 / this.avg;
    if (fps < 50) this.bad += dt; else this.bad = Math.max(0, this.bad - dt * 0.5);
    if (this.bad > 1.6) {
      this.bad = 0;
      this.warm = 0;
      if (!this.onDowngrade()) this.enabled = false;
    }
  }

  get fps() {
    return 1 / this.avg;
  }
}
