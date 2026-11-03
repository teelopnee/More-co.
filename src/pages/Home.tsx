import { useMemo } from 'react';
import { useApp } from '../lib/app';
import type { Tx } from '../lib/db';
import { fmtBaht, fmtDayHeader, fmtMonth } from '../lib/format';
import { totalsOf, useCategoryMap, useMonthTxs, usePrevMonthTotals } from '../lib/hooks';
import { IconPlus, IconReceipt, IconScan } from '../components/Icons';
import { MonthSwitcher } from '../components/Pickers';
import { RankedBars } from '../components/Charts';
import { Brand } from '../components/Brand';

function Delta({ now, prev, goodWhenUp }: { now: number; prev?: number; goodWhenUp: boolean }) {
  if (prev == null || prev === 0) return null;
  const pct = Math.round(((now - prev) / prev) * 100);
  if (!Number.isFinite(pct) || pct === 0) return <div className="delta">เท่ากับเดือนก่อน</div>;
  const up = pct > 0;
  const good = up === goodWhenUp;
  return (
    <div className="delta">
      <span style={{ color: good ? 'var(--income)' : 'var(--expense)', fontWeight: 600 }}>
        {up ? '▲' : '▼'} {Math.abs(pct)}%
      </span>{' '}
      จากเดือนก่อน
    </div>
  );
}

export function Summary({ month }: { month: string }) {
  const txs = useMonthTxs(month);
  const prev = usePrevMonthTotals(month);
  const t = totalsOf(txs);
  const net = t.income - t.expense;
  return (
    <div className="summary" aria-label={`สรุป ${fmtMonth(month)}`}>
      <div className="tile wide">
        <div>
          <div className="label">
            <i style={{ background: 'var(--expense)' }} />
            รายจ่ายเดือนนี้
          </div>
          <div className="value num" data-testid="total-expense">{fmtBaht(t.expense)}</div>
        </div>
        <Delta now={t.expense} prev={prev?.expense} goodWhenUp={false} />
      </div>
      <div className="tile">
        <div className="label">
          <i style={{ background: 'var(--income)' }} />
          รายรับ
        </div>
        <div className="value num" data-testid="total-income">{fmtBaht(t.income)}</div>
      </div>
      <div className="tile">
        <div className="label">คงเหลือ</div>
        <div className="value num" style={{ color: net < 0 ? 'var(--expense)' : undefined }} data-testid="total-net">
          {fmtBaht(net)}
        </div>
      </div>
    </div>
  );
}

function TxRow({ tx }: { tx: Tx }) {
  const { openEditor } = useApp();
  const cats = useCategoryMap();
  const cat = cats.get(tx.categoryId);
  const title = tx.counterparty || cat?.name || (tx.type === 'income' ? 'รายรับ' : 'รายจ่าย');
  const sub = [cat && tx.counterparty ? cat.name : null, tx.note || null, tx.time || null].filter(Boolean).join(' · ');
  return (
    <button className="tx" onClick={() => openEditor({ tx })}>
      <span className="ic" style={{ background: cat ? `color-mix(in srgb, ${cat.color} 16%, var(--surface))` : undefined }}>
        {cat?.emoji ?? '•'}
      </span>
      <div>
        <div className="t">{title}</div>
        <div className="s">
          {tx.source === 'slip' && <IconReceipt aria-label="จากสลิป" />}
          <span>{sub || (tx.source === 'slip' ? 'จากสลิป' : 'จดเอง')}</span>
        </div>
      </div>
      <span className={`a ${tx.type}`}>{fmtBaht(tx.amount, tx.type === 'expense' ? '-' : '+')}</span>
    </button>
  );
}

function TxList({ txs }: { txs: Tx[] }) {
  const days = useMemo(() => {
    const sorted = [...txs].sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time) || b.createdAt - a.createdAt);
    const map = new Map<string, Tx[]>();
    for (const t of sorted) map.set(t.date, [...(map.get(t.date) ?? []), t]);
    return [...map.entries()];
  }, [txs]);
  return (
    <div>
      {days.map(([date, items]) => {
        const spent = items.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
        return (
          <section className="day" key={date}>
            <div className="day-head">
              <b>{fmtDayHeader(date)}</b>
              {spent > 0 && <span className="num">จ่าย {fmtBaht(spent)}</span>}
            </div>
            <div className="list">
              {items.map((t) => (
                <TxRow key={t.id} tx={t} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function TopCategories({ txs }: { txs: Tx[] | undefined }) {
  const cats = useCategoryMap();
  const { rows, total } = useMemo(() => {
    const sums = new Map<string, number>();
    for (const t of txs ?? []) if (t.type === 'expense') sums.set(t.categoryId, (sums.get(t.categoryId) ?? 0) + t.amount);
    const all = [...sums.entries()].map(([id, amount]) => ({ id, amount, cat: cats.get(id) })).sort((a, b) => b.amount - a.amount);
    return { rows: all.slice(0, 5), total: all.reduce((s, r) => s + r.amount, 0) };
  }, [txs, cats]);
  if (!rows.length) return null;
  return (
    <div className="card wide-only" style={{ marginTop: 18 }}>
      <div className="card-title">
        <span>ใช้จ่ายมากสุด</span>
        <a href="#/stats" className="small" style={{ color: 'var(--primary)' }}>
          ดูสรุป
        </a>
      </div>
      <RankedBars rows={rows} total={total} onPick={() => (location.hash = '#/stats')} />
    </div>
  );
}

export function Home() {
  const { month, setMonth, pickSlips, openEditor } = useApp();
  const txs = useMonthTxs(month);

  return (
    <>
      <div className="topbar">
        <Brand />
        <h1 className="page-title wide-only">รายการ</h1>
        <MonthSwitcher month={month} onChange={setMonth} />
      </div>
      <div className="home-grid">
        <div className="side">
          <Summary month={month} />
          <div className="cta">
            <button className="btn btn-primary btn-lg" onClick={pickSlips}>
              <IconScan /> สแกนสลิป
            </button>
            <button className="btn btn-lg" onClick={() => openEditor({ newType: 'expense' })} aria-label="จดเอง">
              <IconPlus /> จดเอง
            </button>
          </div>
          <p className="small muted" style={{ marginTop: 10, textAlign: 'center' }}>
            เลือกสลิปจากอัลบั้มได้ทีละหลายรูป แอปอ่านยอดเงินให้ในเครื่อง
          </p>
          <TopCategories txs={txs} />
        </div>
        <div>
          {txs === undefined ? null : txs.length === 0 ? (
            <div className="card empty">
              <div className="big">🧾</div>
              <h3>ยังไม่มีรายการใน{fmtMonth(month)}</h3>
              <p>กด “สแกนสลิป” แล้วเลือกรูปสลิปโอนเงิน หรือกด “จดเอง”</p>
            </div>
          ) : (
            <TxList txs={txs} />
          )}
        </div>
      </div>
    </>
  );
}
