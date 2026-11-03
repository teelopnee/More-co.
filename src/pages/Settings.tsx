import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState } from 'react';
import { useApp } from '../lib/app';
import { backupName, buildBackup, buildCsv, deliverFile, importBackup } from '../lib/backup';
import type { Category, TxType } from '../lib/categories';
import { db, newId, setSetting } from '../lib/db';
import { useCategories, useSetting } from '../lib/hooks';
import { installPrompt, onInstallPromptChange } from '../lib/install';
import { IconDownload, IconPencil, IconPlus, IconTrash, IconUpload } from '../components/Icons';
import { TypeToggle } from '../components/Pickers';
import { Sheet } from '../components/Sheet';

function MyNames() {
  const names = useSetting<string[]>('myNames', []);
  const [draft, setDraft] = useState('');
  const add = async () => {
    const v = draft.trim();
    if (v.length < 2 || names.includes(v)) return;
    await setSetting('myNames', [...names, v]);
    setDraft('');
  };
  return (
    <section className="card set-section">
      <div className="card-title">ชื่อของฉันบนสลิป</div>
      <p className="help">ใส่ชื่อจริงหรือนามสกุลที่เห็นบนสลิป ทั้งภาษาไทยและอังกฤษ แอปจะรู้ว่าสลิปไหนเป็นเงินเข้า (รายรับ)</p>
      {names.length > 0 && (
        <div className="chips" style={{ marginBottom: 12 }}>
          {names.map((n) => (
            <span className="chip" key={n}>
              {n}
              <button className="x" aria-label={`ลบ ${n}`} onClick={() => setSetting('myNames', names.filter((x) => x !== n))}>
                ✕
              </button>
            </span>
          ))}
        </div>
      )}
      <form
        style={{ display: 'flex', gap: 8 }}
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <input className="input" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="เช่น สมชาย หรือ SOMCHAI" aria-label="เพิ่มชื่อ" />
        <button className="btn btn-soft" type="submit" disabled={draft.trim().length < 2}>
          เพิ่ม
        </button>
      </form>
    </section>
  );
}

function CategoryEditor({ cat, type, onClose }: { cat?: Category; type: TxType; onClose: () => void }) {
  const cats = useCategories();
  const [name, setName] = useState(cat?.name ?? '');
  const [emoji, setEmoji] = useState(cat?.emoji ?? '🏷️');
  const used = useLiveQuery(() => (cat ? db.txs.where('categoryId').equals(cat.id).count() : 0), [cat?.id]) ?? 0;

  async function save() {
    if (!name.trim()) return;
    if (cat) await db.categories.update(cat.id, { name: name.trim(), emoji: emoji.trim() || '🏷️' });
    else {
      const order = Math.max(0, ...cats.filter((c) => c.type === type && c.order < 99).map((c) => c.order)) + 1;
      await db.categories.add({ id: `c-${newId()}`, type, name: name.trim(), emoji: emoji.trim() || '🏷️', color: '#64748b', order });
    }
    onClose();
  }

  return (
    <Sheet title={cat ? 'แก้ไขหมวดหมู่' : 'เพิ่มหมวดหมู่'} onClose={onClose}>
      <div className="stack">
        <div style={{ display: 'grid', gridTemplateColumns: '84px 1fr', gap: 10 }}>
          <label className="field">
            <span>ไอคอน</span>
            <input className="input" value={emoji} onChange={(e) => setEmoji(e.target.value)} style={{ fontSize: 24, textAlign: 'center' }} maxLength={4} />
          </label>
          <label className="field">
            <span>ชื่อหมวดหมู่</span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </label>
        </div>
        <button className="btn btn-primary btn-lg" onClick={save} disabled={!name.trim()}>
          บันทึก
        </button>
        {cat && (
          <button
            className="btn"
            onClick={async () => {
              await db.categories.update(cat.id, { hidden: !cat.hidden });
              onClose();
            }}
          >
            {cat.hidden ? 'แสดงหมวดนี้อีกครั้ง' : `ซ่อนหมวดนี้${used ? ` (มี ${used} รายการ จะยังอยู่)` : ''}`}
          </button>
        )}
      </div>
    </Sheet>
  );
}

function Categories() {
  const cats = useCategories();
  const [type, setType] = useState<TxType>('expense');
  const [editing, setEditing] = useState<{ cat?: Category } | null>(null);
  const list = cats.filter((c) => c.type === type);
  return (
    <section className="card set-section">
      <div className="card-title">
        <span>หมวดหมู่</span>
        <TypeToggle value={type} onChange={setType} />
      </div>
      <div className="set-list">
        {list.map((c) => (
          <div className="item" key={c.id} style={c.hidden ? { opacity: 0.5 } : undefined}>
            <span style={{ fontSize: 22, width: 32, textAlign: 'center' }}>{c.emoji}</span>
            <span className="grow">
              {c.name}
              {c.hidden ? ' (ซ่อน)' : ''}
            </span>
            <button className="icon-btn" aria-label={`แก้ไข ${c.name}`} onClick={() => setEditing({ cat: c })}>
              <IconPencil />
            </button>
          </div>
        ))}
      </div>
      <button className="btn btn-soft btn-block" style={{ marginTop: 10 }} onClick={() => setEditing({})}>
        <IconPlus /> เพิ่มหมวดหมู่
      </button>
      {editing && <CategoryEditor cat={editing.cat} type={type} onClose={() => setEditing(null)} />}
    </section>
  );
}

function Appearance() {
  const theme = useSetting<'system' | 'light' | 'dark'>('theme', 'system');
  const opts: [typeof theme, string][] = [
    ['system', 'ตามเครื่อง'],
    ['light', 'สว่าง'],
    ['dark', 'มืด'],
  ];
  return (
    <section className="card set-section">
      <div className="card-title">หน้าตา</div>
      <div className="seg" role="group" aria-label="ธีม">
        {opts.map(([v, label]) => (
          <button key={v} aria-pressed={theme === v} onClick={() => setSetting('theme', v)}>
            {label}
          </button>
        ))}
      </div>
    </section>
  );
}

function DataSection() {
  const { toast } = useApp();
  const fileRef = useRef<HTMLInputElement>(null);
  const counts = useLiveQuery(async () => ({ txs: await db.txs.count(), images: await db.images.count() }), []);
  const [usage, setUsage] = useState<string | null>(null);
  const [withImages, setWithImages] = useState(false);

  useEffect(() => {
    navigator.storage?.estimate?.().then((e) => e.usage != null && setUsage(`${(e.usage / 1024 / 1024).toFixed(1)} MB`));
  }, [counts]);

  return (
    <section className="card set-section">
      <div className="card-title">ข้อมูลของฉัน</div>
      <p className="help">
        ข้อมูลเก็บอยู่ในเครื่องนี้เท่านั้น ({counts?.txs ?? 0} รายการ{usage ? ` · ใช้พื้นที่ ${usage}` : ''}) ถ้าใช้หลายเครื่อง ให้สำรองจากเครื่องหนึ่งแล้วกู้คืนในอีกเครื่อง ข้อมูลจะรวมกันโดยไม่ซ้ำ
      </p>
      <div className="stack" style={{ gap: 10 }}>
        <label className="switch">
          <input type="checkbox" checked={withImages} onChange={(e) => setWithImages(e.target.checked)} />
          รวมรูปสลิปด้วย (ไฟล์ใหญ่ขึ้น)
        </label>
        <button
          className="btn btn-block"
          onClick={async () => {
            const r = await deliverFile(await buildBackup(withImages), backupName('json'));
            if (r !== 'cancelled') toast('สำรองข้อมูลแล้ว');
          }}
        >
          <IconDownload /> สำรองข้อมูล
        </button>
        <button className="btn btn-block" onClick={() => fileRef.current?.click()}>
          <IconUpload /> กู้คืน / รวมข้อมูลจากไฟล์
        </button>
        <button
          className="btn btn-block"
          onClick={async () => {
            const r = await deliverFile(await buildCsv(), backupName('csv'));
            if (r !== 'cancelled') toast('ส่งออกไฟล์ Excel (CSV) แล้ว');
          }}
        >
          <IconDownload /> ส่งออกเป็น Excel (CSV)
        </button>
        <button
          className="btn btn-block btn-danger"
          onClick={async () => {
            if (!confirm('ลบรายการทั้งหมดในเครื่องนี้? กู้คืนไม่ได้ถ้าไม่ได้สำรองไว้')) return;
            if (!confirm('ยืนยันอีกครั้ง: ลบทั้งหมดจริงไหม?')) return;
            await db.transaction('rw', db.txs, db.images, db.rules, async () => {
              await db.txs.clear();
              await db.images.clear();
              await db.rules.clear();
            });
            toast('ลบข้อมูลทั้งหมดแล้ว');
          }}
        >
          <IconTrash /> ลบข้อมูลทั้งหมด
        </button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          try {
            const r = await importBackup(f);
            toast(`กู้คืนแล้ว: เพิ่ม ${r.added} · อัปเดต ${r.updated} · ข้าม ${r.skipped}`);
          } catch (err) {
            toast((err as Error).message);
          }
        }}
      />
    </section>
  );
}

function Install() {
  const [, force] = useState(0);
  useEffect(() => onInstallPromptChange(() => force((n) => n + 1)), []);
  const standalone = matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone;
  return (
    <section className="card set-section">
      <div className="card-title">ติดตั้งเป็นแอป</div>
      {standalone ? (
        <p className="help">ติดตั้งแล้ว ✓ เปิดจากไอคอน “จดไว” บนหน้าจอได้เลย ใช้งานได้แม้ไม่มีเน็ต</p>
      ) : (
        <>
          {installPrompt() && (
            <button className="btn btn-primary btn-block" style={{ marginBottom: 12 }} onClick={() => installPrompt()?.prompt()}>
              ติดตั้งจดไวลงเครื่องนี้
            </button>
          )}
          <p className="help" style={{ marginBottom: 4 }}>
            <b>iPhone (Safari):</b>
          </p>
          <ol className="howto">
            <li>กดปุ่มแชร์ (สี่เหลี่ยมมีลูกศรชี้ขึ้น)</li>
            <li>เลือก “เพิ่มไปยังหน้าจอโฮม”</li>
          </ol>
          <p className="help" style={{ margin: '10px 0 4px' }}>
            <b>Android (Chrome / Samsung Internet):</b>
          </p>
          <ol className="howto">
            <li>กดเมนู ⋮ หรือ ☰</li>
            <li>เลือก “ติดตั้งแอป” หรือ “เพิ่มไปยังหน้าจอหลัก”</li>
            <li>หลังติดตั้ง กดแชร์รูปสลิปจากแกลเลอรีมาที่ “จดไว” ได้เลย</li>
          </ol>
        </>
      )}
    </section>
  );
}

function About() {
  return (
    <section className="card set-section">
      <div className="card-title">เกี่ยวกับ</div>
      <p className="help" style={{ marginBottom: 0 }}>
        จดไว เวอร์ชัน {__APP_VERSION__} · อ่านสลิปด้วย OCR ในเครื่อง ไม่ส่งรูปหรือข้อมูลการเงินออกไปไหน ไม่มีบัญชีผู้ใช้ ไม่มีโฆษณา
      </p>
    </section>
  );
}

export function Settings() {
  return (
    <>
      <div className="topbar">
        <h1 className="page-title">ตั้งค่า</h1>
      </div>
      <div className="settings-grid">
        <div>
          <MyNames />
          <Categories />
        </div>
        <div>
          <DataSection />
          <Install />
          <Appearance />
          <About />
        </div>
      </div>
    </>
  );
}
