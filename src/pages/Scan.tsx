import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { go, takePendingFiles, useApp } from '../lib/app';
import { isDuplicate, saveMany, type TxDraft } from '../lib/actions';
import { guessCategory, type Category, type TxType } from '../lib/categories';
import { getSetting, learnedRules } from '../lib/db';
import { fmtBaht, localDate, localTime, monthOf, parseAmountInput } from '../lib/format';
import { categoriesOf, useBlobUrl, useCategories } from '../lib/hooks';
import { guessDirection, type ParsedSlip } from '../slip/parse';
import { onEngineProgress, readSlip, type EngineProgress } from '../slip/reader';
import { IconAlert, IconCheck, IconClose, IconScan } from '../components/Icons';
import { CategoryChips, TypeToggle } from '../components/Pickers';
import { ImageViewer } from '../components/Sheet';

type Status = 'queued' | 'reading' | 'done' | 'error';

interface Item {
  key: string;
  file: File;
  status: Status;
  slip?: ParsedSlip;
  thumb?: Blob | null;
  include: boolean;
  duplicate: boolean;
  dateFromFile: boolean;
  catTouched: boolean;
  type: TxType;
  amount: string;
  date: string;
  time: string;
  categoryId: string;
  counterparty: string;
  note: string;
}

let seq = 0;
const blank = (file: File): Item => ({
  key: `s${++seq}`,
  file,
  status: 'queued',
  include: false,
  duplicate: false,
  dateFromFile: false,
  catTouched: false,
  type: 'expense',
  amount: '',
  date: '',
  time: '',
  categoryId: '',
  counterparty: '',
  note: '',
});

const partyFor = (slip: ParsedSlip | undefined, type: TxType) => (type === 'income' ? slip?.from : slip?.to) ?? '';

function SlipCard({ item, cats, onChange }: { item: Item; cats: Category[]; onChange: (patch: Partial<Item>) => void }) {
  const fileUrl = useBlobUrl(item.thumb ?? item.file);
  const [zoom, setZoom] = useState(false);
  const typeCats = categoriesOf(cats, item.type);
  const satang = parseAmountInput(item.amount);
  const busy = item.status === 'queued' || item.status === 'reading';
  const future = item.date > localDate();

  let badge: ReactNode;
  if (busy) badge = <span className="badge"><span className="spin" style={{ width: 12, height: 12 }} /> {item.status === 'reading' ? 'กำลังอ่าน…' : 'รอคิว'}</span>;
  else if (item.duplicate) badge = <span className="badge">บันทึกไปแล้ว (ซ้ำ)</span>;
  else if (item.status === 'error') badge = <span className="badge bad"><IconAlert /> อ่านไม่ได้ กรอกเองได้</span>;
  else if (!item.slip?.isSlip) badge = <span className="badge">ดูไม่เหมือนสลิป</span>;
  else if (satang == null || future) badge = <span className="badge warn"><IconAlert /> ตรวจสอบอีกครั้ง</span>;
  else badge = <span className="badge ok"><IconCheck /> อ่านได้</span>;

  return (
    <article className={`card slip${item.include ? '' : ' excluded'}`} data-testid="slip-card" aria-busy={busy}>
      <div className="head">
        <button className="thumb" onClick={() => setZoom(true)} aria-label="ดูรูปสลิปขนาดใหญ่" disabled={!fileUrl}>
          {fileUrl && <img src={fileUrl} alt="" />}
        </button>
        <div className="meta">
          <div className="top">
            {badge}
            <label className="switch">
              <input type="checkbox" checked={item.include} disabled={busy} onChange={(e) => onChange({ include: e.target.checked })} />
              บันทึก
            </label>
          </div>
          {!busy && (
            <div className="big-amount num" aria-hidden>
              {satang != null ? fmtBaht(satang, item.type === 'expense' ? '-' : '+') : '฿ —'}
            </div>
          )}
          {!busy && item.slip?.bank && <div className="small muted">{item.slip.bank.name}{item.slip.ref ? ` · ${item.slip.ref}` : ''}</div>}
        </div>
      </div>
      {!busy && (
        <div className="fields">
          <TypeToggle
            value={item.type}
            onChange={(type) => {
              const patch: Partial<Item> = { type };
              if (item.counterparty === partyFor(item.slip, item.type)) patch.counterparty = partyFor(item.slip, type);
              onChange(patch);
            }}
          />
          <div className="grid-2">
            <label className="field">
              <span>จำนวนเงิน</span>
              <div className="amount-wrap">
                <input
                  className={`input${satang == null && item.include ? ' warn' : ''}`}
                  inputMode="decimal"
                  value={item.amount}
                  placeholder="0.00"
                  onChange={(e) => onChange({ amount: e.target.value })}
                  aria-label="จำนวนเงิน"
                  data-testid="slip-amount"
                />
              </div>
            </label>
            <label className="field">
              <span>{item.type === 'income' ? 'ได้จาก' : 'จ่ายให้'}</span>
              <input className="input" value={item.counterparty} onChange={(e) => onChange({ counterparty: e.target.value })} data-testid="slip-party" />
            </label>
          </div>
          <div className="grid-2">
            <label className="field">
              <span>วันที่{item.dateFromFile ? ' (จากไฟล์)' : ''}</span>
              <input className={`input${future || item.dateFromFile ? ' warn' : ''}`} type="date" value={item.date} onChange={(e) => onChange({ date: e.target.value, dateFromFile: false })} data-testid="slip-date" />
            </label>
            <label className="field">
              <span>เวลา</span>
              <input className="input" type="time" value={item.time} onChange={(e) => onChange({ time: e.target.value })} data-testid="slip-time" />
            </label>
          </div>
          <CategoryChips cats={typeCats} value={item.categoryId} onChange={(id) => onChange({ categoryId: id, catTouched: true })} />
          <input className="input" value={item.note} placeholder="บันทึกเพิ่มเติม" onChange={(e) => onChange({ note: e.target.value })} aria-label="บันทึกเพิ่มเติม" />
        </div>
      )}
      {zoom && fileUrl && <ImageViewer src={fileUrl} onClose={() => setZoom(false)} />}
    </article>
  );
}

export function Scan() {
  const { pickSlips, toast, setMonth } = useApp();
  const cats = useCategories();
  const [items, setItems] = useState<Item[]>([]);
  const [engine, setEngine] = useState<EngineProgress | null>(null);
  const [saving, setSaving] = useState(false);
  const running = useRef(false);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const catsRef = useRef(cats);
  catsRef.current = cats;

  const addFiles = useCallback(() => {
    const files = takePendingFiles();
    if (files.length) setItems((prev) => [...prev, ...files.map(blank)]);
  }, []);

  useEffect(() => {
    addFiles();
    window.addEventListener('jodwai:files', addFiles);
    return () => window.removeEventListener('jodwai:files', addFiles);
  }, [addFiles]);

  useEffect(() => {
    onEngineProgress((p) => setEngine(p));
    return () => onEngineProgress(null);
  }, []);

  const patch = useCallback((key: string, p: Partial<Item>) => {
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...p } : it)));
  }, []);

  // Read queued slips one at a time (OCR is CPU heavy).
  useEffect(() => {
    if (running.current || !cats.length) return;
    const next = items.find((i) => i.status === 'queued');
    if (!next) return;
    running.current = true;
    (async () => {
      patch(next.key, { status: 'reading' });
      try {
        const [res, myNames, learned] = await Promise.all([readSlip(next.file), getSetting<string[]>('myNames', []), learnedRules()]);
        const slip = res.slip;
        const type = guessDirection(slip, myNames);
        const counterparty = partyFor(slip, type);
        const fileDate = new Date(res.fileTime);
        const seen = itemsRef.current.some((o) => o.key !== next.key && o.slip?.dedupeKey && o.slip.dedupeKey === slip.dedupeKey);
        const duplicate = seen || (await isDuplicate(slip.dedupeKey));
        patch(next.key, {
          status: 'done',
          slip,
          thumb: res.thumb,
          type,
          counterparty,
          amount: slip.amount != null ? slip.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '',
          date: slip.date ?? localDate(fileDate),
          dateFromFile: !slip.date,
          time: slip.time ?? (slip.date ? '' : localTime(fileDate)),
          note: slip.memo ?? '',
          categoryId: guessCategory(type, counterparty, slip.memo, learned, catsRef.current),
          duplicate,
          include: slip.isSlip && !duplicate,
        });
      } catch (err) {
        console.error(err);
        patch(next.key, { status: 'error', date: localDate(new Date(next.file.lastModified || Date.now())), categoryId: 'other-ex' });
      } finally {
        running.current = false;
        setItems((prev) => [...prev]); // kick the queue
      }
    })();
  }, [items, cats.length, patch]);

  // Re-guess category when the type flips and the user hasn't picked one.
  useEffect(() => {
    setItems((prev) => {
      let changed = false;
      const next = prev.map((it) => {
        if (it.status !== 'done' || it.catTouched) return it;
        const valid = cats.some((c) => c.id === it.categoryId && c.type === it.type);
        if (valid) return it;
        changed = true;
        return { ...it, categoryId: guessCategory(it.type, it.counterparty, it.note, new Map(), cats) };
      });
      return changed ? next : prev;
    });
  }, [items, cats]);

  const done = items.filter((i) => i.status === 'done' || i.status === 'error').length;
  const busy = done < items.length;
  const chosen = items.filter((i) => i.include);
  const invalid = chosen.filter((i) => parseAmountInput(i.amount) == null || !i.date);
  const total = useMemo(
    () => chosen.reduce((s, i) => s + (parseAmountInput(i.amount) ?? 0) * (i.type === 'expense' ? 1 : 0), 0),
    [chosen],
  );
  const engineLoading = engine && /loading|initializ/i.test(engine.status) && engine.progress < 1;

  async function onSave() {
    if (!chosen.length || invalid.length || busy) return;
    setSaving(true);
    try {
      const drafts = chosen.map((i) => ({
        draft: {
          type: i.type,
          amount: parseAmountInput(i.amount)!,
          date: i.date,
          time: i.time,
          categoryId: i.categoryId,
          counterparty: i.counterparty.trim(),
          note: i.note.trim(),
          source: 'slip',
          slipKey: i.slip?.dedupeKey ?? null,
          bankId: i.slip?.bank?.id ?? null,
          ref: i.slip?.ref ?? null,
        } satisfies TxDraft,
        image: i.thumb ?? null,
      }));
      const n = await saveMany(drafts);
      const latest = chosen.map((i) => i.date).sort().pop()!;
      setMonth(monthOf(latest));
      setItems([]);
      toast(`บันทึกแล้ว ${n} รายการ`);
      go('home');
    } finally {
      setSaving(false);
    }
  }

  function onCancel() {
    if (items.length && !confirm('ยกเลิกสลิปที่ยังไม่ได้บันทึก?')) return;
    setItems([]);
    go('home');
  }

  return (
    <>
      <div className="topbar">
        <h1 className="page-title">ตรวจสลิป</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          {items.length > 0 && (
            <button className="btn btn-soft" onClick={pickSlips}>
              <IconScan /> เพิ่มสลิป
            </button>
          )}
          <button className="icon-btn" onClick={onCancel} aria-label="ปิด">
            <IconClose />
          </button>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="card empty">
          <div className="big">📸</div>
          <h3>เลือกรูปสลิปที่ต้องการจด</h3>
          <p style={{ marginBottom: 16 }}>เลือกได้หลายรูปพร้อมกัน แอปอ่านยอดเงิน วันที่ และชื่อผู้รับให้ ทุกอย่างทำในเครื่องนี้</p>
          <button className="btn btn-primary btn-lg" onClick={pickSlips}>
            <IconScan /> เลือกสลิป
          </button>
        </div>
      ) : (
        <>
          {busy && (
            <div className="card" style={{ marginBottom: 14 }} aria-live="polite">
              <div className="row-between small" style={{ marginBottom: 8 }}>
                <span>{engineLoading ? 'กำลังเตรียมตัวอ่านภาษาไทย (ครั้งแรกจะช้าหน่อย)' : `กำลังอ่านสลิป ${Math.min(done + 1, items.length)}/${items.length}`}</span>
                <span className="spin" />
              </div>
              <div className="progress">
                <i style={{ width: `${Math.round(((done + (engineLoading ? 0 : 0.5)) / items.length) * 100)}%` }} />
              </div>
            </div>
          )}
          <div className="slip-grid">
            {items.map((it) => (
              <SlipCard key={it.key} item={it} cats={cats} onChange={(p) => patch(it.key, p)} />
            ))}
          </div>
          <div className="footer-bar">
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600 }}>{chosen.length} รายการ</div>
              <div className="small muted num">
                {invalid.length ? `ยังไม่มียอดเงิน ${invalid.length} รายการ` : `รายจ่ายรวม ${fmtBaht(total)}`}
              </div>
            </div>
            <button className="btn btn-primary btn-lg" onClick={onSave} disabled={busy || saving || !chosen.length || invalid.length > 0} data-testid="save-slips">
              {busy ? 'รออ่านให้ครบ…' : `บันทึก ${chosen.length} รายการ`}
            </button>
          </div>
        </>
      )}
    </>
  );
}
