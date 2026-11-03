import { useMemo, useState } from 'react';
import { useApp } from '../lib/app';
import type { TxType } from '../lib/categories';
import { daysInMonth, fmtBaht, fmtMonth, localDate, monthOf } from '../lib/format';
import { totalsOf, useCategoryMap, useMonthTxs } from '../lib/hooks';
import { DailyColumns, RankedBars, type RankedRow } from '../components/Charts';
import { MonthSwitcher, TypeToggle } from '../components/Pickers';
import { Summary } from './Home';

export function Stats() {
  const { month, setMonth } = useApp();
  const [type, setType] = useState<TxType>('expense');
  const txs = useMonthTxs(month);
  const cats = useCategoryMap();

  const rows: RankedRow[] = useMemo(() => {
    const sums = new Map<string, number>();
    for (const t of txs ?? []) if (t.type === type) sums.set(t.categoryId, (sums.get(t.categoryId) ?? 0) + t.amount);
    return [...sums.entries()].map(([id, amount]) => ({ id, amount, cat: cats.get(id) })).sort((a, b) => b.amount - a.amount);
  }, [txs, type, cats]);

  const daily = useMemo(() => {
    const arr = new Array(daysInMonth(month)).fill(0) as number[];
    for (const t of txs ?? []) if (t.type === 'expense') arr[Number(t.date.slice(8, 10)) - 1] += t.amount;
    return arr;
  }, [txs, month]);

  const totals = totalsOf(txs);
  const today = localDate();
  const isCurrent = monthOf(today) === month;
  const daysSoFar = isCurrent ? Number(today.slice(8, 10)) : daysInMonth(month);
  const avg = Math.round(totals.expense / Math.max(1, daysSoFar));
  const maxDay = daily.reduce((best, v, i) => (v > daily[best] ? i : best), 0);
  const count = (txs ?? []).filter((t) => t.type === 'expense').length;

  return (
    <>
      <div className="topbar">
        <h1 className="page-title">สรุป</h1>
        <MonthSwitcher month={month} onChange={setMonth} />
      </div>
      <div className="stats-grid">
        <div>
          <Summary month={month} />
          <div className="card" style={{ marginTop: 14 }}>
            <div className="card-title">
              <span>รายจ่ายรายวัน</span>
            </div>
            <DailyColumns values={daily} today={isCurrent ? Number(today.slice(8, 10)) : undefined} label={`รายจ่ายรายวัน ${fmtMonth(month)}`} />
            <div className="stat-row" style={{ marginTop: 14 }}>
              <div className="tile">
                <div className="label muted">เฉลี่ย/วัน</div>
                <div className="value num">{fmtBaht(avg)}</div>
              </div>
              <div className="tile">
                <div className="label muted">วันที่จ่ายมากสุด</div>
                <div className="value num">{daily[maxDay] > 0 ? fmtBaht(daily[maxDay]) : '—'}</div>
                {daily[maxDay] > 0 && <div className="sub">วันที่ {maxDay + 1}</div>}
              </div>
              <div className="tile">
                <div className="label muted">รายการ</div>
                <div className="value num">{count}</div>
              </div>
            </div>
          </div>
        </div>
        <div className="card">
          <div className="card-title">
            <span>แยกตามหมวดหมู่</span>
            <TypeToggle value={type} onChange={setType} />
          </div>
          {rows.length ? (
            <RankedBars rows={rows} />
          ) : (
            <div className="empty" style={{ padding: 24 }}>
              <p>ยังไม่มี{type === 'expense' ? 'รายจ่าย' : 'รายรับ'}ในเดือนนี้</p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
