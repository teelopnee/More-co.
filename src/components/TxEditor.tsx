import { useEffect, useMemo, useState } from 'react';
import { deleteTx, restoreTx, saveTx } from '../lib/actions';
import { FALLBACK_CATEGORY, type TxType } from '../lib/categories';
import type { Tx } from '../lib/db';
import { amountToInput, localDate, localTime, monthOf, parseAmountInput } from '../lib/format';
import { categoriesOf, useCategories, useSlipImage } from '../lib/hooks';
import { useApp } from '../lib/app';
import { bankById } from '../slip/banks';
import { IconImage, IconTrash } from './Icons';
import { CategoryGrid, TypeToggle } from './Pickers';
import { ImageViewer, Sheet } from './Sheet';

export function TxEditor({ tx, newType, onClose }: { tx?: Tx; newType?: TxType; onClose: () => void }) {
  const { toast, setMonth } = useApp();
  const cats = useCategories();
  const [type, setType] = useState<TxType>(tx?.type ?? newType ?? 'expense');
  const [amount, setAmount] = useState(amountToInput(tx?.amount));
  const [categoryId, setCategoryId] = useState(tx?.categoryId ?? '');
  const [date, setDate] = useState(tx?.date ?? localDate());
  const [time, setTime] = useState(tx?.time ?? (tx ? '' : localTime()));
  const [counterparty, setCounterparty] = useState(tx?.counterparty ?? '');
  const [note, setNote] = useState(tx?.note ?? '');
  const [showImage, setShowImage] = useState(false);
  const [touched, setTouched] = useState(false);
  const imageUrl = useSlipImage(tx?.hasImage ? tx.id : null);

  const typeCats = useMemo(() => categoriesOf(cats, type, tx?.categoryId), [cats, type, tx?.categoryId]);
  useEffect(() => {
    if (typeCats.length && !typeCats.some((c) => c.id === categoryId)) {
      setCategoryId(typeCats.find((c) => c.id === FALLBACK_CATEGORY[type])?.id ?? typeCats[0].id);
    }
  }, [typeCats, categoryId, type]);

  const satang = parseAmountInput(amount);
  const valid = satang != null && !!date && !!categoryId;

  async function onSave() {
    setTouched(true);
    if (!valid) return;
    const saved = await saveTx({
      id: tx?.id,
      type,
      amount: satang!,
      date,
      time,
      categoryId,
      counterparty: counterparty.trim(),
      note: note.trim(),
      source: tx?.source ?? 'manual',
      slipKey: tx?.slipKey ?? null,
      bankId: tx?.bankId ?? null,
      ref: tx?.ref ?? null,
      hasImage: tx?.hasImage,
    });
    setMonth(monthOf(saved.date));
    toast(tx ? 'แก้ไขแล้ว' : 'บันทึกแล้ว');
    onClose();
  }

  async function onDelete() {
    if (!tx) return;
    const removed = await deleteTx(tx.id);
    onClose();
    toast('ลบรายการแล้ว', {
      label: 'เลิกทำ',
      run: () => removed.tx && restoreTx(removed.tx, removed.image),
    });
  }

  const bank = bankById(tx?.bankId);

  return (
    <Sheet
      title={tx ? 'แก้ไขรายการ' : 'จดรายการใหม่'}
      onClose={onClose}
      footer={
        <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
          {tx && (
            <button className="btn btn-danger" onClick={onDelete} aria-label="ลบรายการ">
              <IconTrash />
            </button>
          )}
          <button className="btn btn-primary btn-lg" style={{ flex: 1 }} onClick={onSave} disabled={touched && !valid}>
            บันทึก
          </button>
        </div>
      }
    >
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          void onSave();
        }}
      >
        <TypeToggle value={type} onChange={setType} />
        <label className="field">
          <span>จำนวนเงิน</span>
          <div className="amount-wrap amount-big">
            <input
              className={`input${touched && satang == null ? ' warn' : ''}`}
              inputMode="decimal"
              placeholder="0"
              value={amount}
              autoFocus={!tx}
              onChange={(e) => setAmount(e.target.value)}
              aria-invalid={touched && satang == null}
            />
          </div>
        </label>
        <div className="field">
          <span>หมวดหมู่</span>
          <CategoryGrid cats={typeCats} value={categoryId} onChange={setCategoryId} />
        </div>
        <div className="grid-2">
          <label className="field">
            <span>วันที่</span>
            <input className="input" type="date" value={date} max={localDate()} onChange={(e) => setDate(e.target.value)} required />
          </label>
          <label className="field">
            <span>เวลา</span>
            <input className="input" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </label>
        </div>
        <label className="field">
          <span>{type === 'income' ? 'ได้จาก' : 'จ่ายให้'}</span>
          <input className="input" value={counterparty} onChange={(e) => setCounterparty(e.target.value)} placeholder={type === 'income' ? 'เช่น บริษัท, ชื่อคน' : 'เช่น ร้านค้า, ชื่อคน'} />
        </label>
        <label className="field">
          <span>บันทึกเพิ่มเติม</span>
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="ไม่ใส่ก็ได้" />
        </label>
        {tx?.source === 'slip' && (
          <div className="row-between small muted">
            <span>
              จากสลิป{bank ? ` · ${bank.name}` : ''}
              {tx.ref ? ` · ${tx.ref}` : ''}
            </span>
            {imageUrl && (
              <button type="button" className="btn btn-soft" onClick={() => setShowImage(true)}>
                <IconImage /> ดูสลิป
              </button>
            )}
          </div>
        )}
        <button type="submit" hidden />
      </form>
      {showImage && imageUrl && <ImageViewer src={imageUrl} onClose={() => setShowImage(false)} />}
    </Sheet>
  );
}
