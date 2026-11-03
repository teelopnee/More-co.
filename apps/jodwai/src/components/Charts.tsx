import { useEffect, useRef, useState } from 'react';
import type { Category } from '../lib/categories';
import { fmtBaht, fmtCompact } from '../lib/format';

export interface RankedRow {
  cat: Category | undefined;
  id: string;
  amount: number; // satang
}

/** Ranked horizontal bars: one hue, largest first, name + amount + share as text. */
export function RankedBars({ rows, total: totalProp, onPick }: { rows: RankedRow[]; total?: number; onPick?: (id: string) => void }) {
  const total = totalProp ?? rows.reduce((s, r) => s + r.amount, 0);
  const max = rows[0]?.amount ?? 0;
  return (
    <div className="ranked">
      {rows.map((r) => {
        const pct = total ? Math.round((r.amount / total) * 100) : 0;
        return (
          <button key={r.id} className="item" onClick={() => onPick?.(r.id)}>
            <span className="e" aria-hidden>{r.cat?.emoji ?? '•'}</span>
            <span>
              <span className="meta">
                <b>{r.cat?.name ?? 'ไม่ระบุ'}</b>
                <span>
                  {fmtBaht(r.amount)} · {pct}%
                </span>
              </span>
              <span className="bar" aria-hidden>
                <i style={{ width: `${max ? (r.amount / max) * 100 : 0}%` }} />
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function niceMax(v: number): number {
  if (v <= 0) return 100;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * p;
}

/** Daily spending columns for one month, with a tap/hover tooltip per day. */
export function DailyColumns({ values, today, label }: { values: number[]; today?: number; label: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  // Draw at the real pixel width so text stays 12px on phones and tablets.
  const [W, setW] = useState(600);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(240, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const H = 190;
  const padL = 34;
  const padB = 22;
  const padT = 10;
  const n = values.length;
  const maxV = niceMax(Math.max(...values, 0) / 100);
  const ticks = [0, maxV / 2, maxV];
  const slot = (W - padL) / n;
  const barW = Math.min(24, Math.max(3, slot - 2));
  const y = (baht: number) => padT + (H - padT - padB) * (1 - baht / maxV);
  const labelEvery = slot < 14 ? 5 : slot < 22 ? 3 : 1;
  const tip = hover == null ? null : { x: padL + slot * hover + slot / 2, y: y(values[hover] / 100) };

  return (
    <div className="cols" ref={wrap} onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={label}>
        {ticks.map((t) => (
          <g key={t}>
            <line className={t === 0 ? 'baseline' : 'gridline'} x1={padL} x2={W} y1={y(t)} y2={y(t)} />
            <text className="tick" x={padL - 6} y={y(t) + 4} textAnchor="end">
              {fmtCompact(t)}
            </text>
          </g>
        ))}
        {values.map((v, i) => {
          const baht = v / 100;
          const x = padL + slot * i + (slot - barW) / 2;
          const top = y(baht);
          const h = H - padB - top;
          const r = Math.min(4, h, barW / 2);
          const day = i + 1;
          const dim = hover != null && hover !== i;
          return (
            <g key={i}>
              {v > 0 && (
                <path
                  className={`bar${dim ? ' dim' : ''}`}
                  d={`M${x},${H - padB} V${top + r} Q${x},${top} ${x + r},${top} H${x + barW - r} Q${x + barW},${top} ${x + barW},${top + r} V${H - padB} Z`}
                />
              )}
              {(day === 1 || day % labelEvery === 0 || day === today) && (
                <text className="tick" x={padL + slot * i + slot / 2} y={H - 6} textAnchor="middle" style={day === today ? { fontWeight: 700, fill: 'var(--text)' } : undefined}>
                  {day}
                </text>
              )}
              <rect
                className="hit"
                x={padL + slot * i}
                y={padT}
                width={slot}
                height={H - padT}
                onMouseEnter={() => setHover(i)}
                onClick={() => setHover(hover === i ? null : i)}
              >
                <title>{`วันที่ ${day}: ${fmtBaht(v)}`}</title>
              </rect>
            </g>
          );
        })}
      </svg>
      {tip && hover != null && (
        <div className="tip num" style={{ left: Math.min(W - 70, Math.max(70, tip.x)), top: tip.y - 8 }}>
          วันที่ {hover + 1} · {fmtBaht(values[hover])}
        </div>
      )}
    </div>
  );
}
