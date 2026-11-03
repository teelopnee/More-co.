import type { Category, TxType } from '../lib/categories';
import { fmtMonth, shiftMonth, thisMonth } from '../lib/format';
import { IconChevronLeft, IconChevronRight } from './Icons';

export function TypeToggle({ value, onChange }: { value: TxType; onChange: (t: TxType) => void }) {
  return (
    <div className="seg" role="group" aria-label="ประเภท">
      <button type="button" className="is-expense" aria-pressed={value === 'expense'} onClick={() => onChange('expense')}>
        รายจ่าย
      </button>
      <button type="button" className="is-income" aria-pressed={value === 'income'} onClick={() => onChange('income')}>
        รายรับ
      </button>
    </div>
  );
}

export function CategoryGrid({ cats, value, onChange }: { cats: Category[]; value: string; onChange: (id: string) => void }) {
  return (
    <div className="cat-grid" role="group" aria-label="หมวดหมู่">
      {cats.map((c) => (
        <button type="button" key={c.id} aria-pressed={c.id === value} onClick={() => onChange(c.id)}>
          <span className="e">{c.emoji}</span>
          <span>{c.name}</span>
        </button>
      ))}
    </div>
  );
}

export function CategoryChips({ cats, value, onChange }: { cats: Category[]; value: string; onChange: (id: string) => void }) {
  // Keep the selected chip first so it is visible without scrolling.
  const sel = cats.find((c) => c.id === value);
  const ordered = sel ? [sel, ...cats.filter((c) => c.id !== value)] : cats;
  return (
    <div className="chips scroll" role="group" aria-label="หมวดหมู่">
      {ordered.map((c) => (
        <button type="button" className="chip" key={c.id} aria-pressed={c.id === value} onClick={() => onChange(c.id)}>
          <span>{c.emoji}</span>
          {c.name}
        </button>
      ))}
    </div>
  );
}

export function MonthSwitcher({ month, onChange }: { month: string; onChange: (m: string) => void }) {
  const current = thisMonth();
  return (
    <div className="month">
      <button className="icon-btn" aria-label="เดือนก่อน" onClick={() => onChange(shiftMonth(month, -1))}>
        <IconChevronLeft />
      </button>
      <button className="label" onClick={() => onChange(current)} title="กลับไปเดือนนี้" aria-label={`${fmtMonth(month)} (แตะเพื่อกลับไปเดือนนี้)`}>
        {fmtMonth(month)}
      </button>
      <button className="icon-btn" aria-label="เดือนถัดไป" disabled={month >= current} onClick={() => onChange(shiftMonth(month, 1))} style={month >= current ? { opacity: 0.3 } : undefined}>
        <IconChevronRight />
      </button>
    </div>
  );
}
