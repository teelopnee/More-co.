import type { Category } from './categories';
import { db, type Rule, type Tx } from './db';
import { localDate } from './format';

interface BackupFile {
  app: 'jodwai';
  version: 1;
  exportedAt: string;
  txs: Tx[];
  categories: Category[];
  rules: Rule[];
  myNames: string[];
  images?: { txId: string; dataUrl: string }[];
}

const blobToDataUrl = (b: Blob) =>
  new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = () => rej(r.error);
    r.readAsDataURL(b);
  });

const dataUrlToBlob = async (u: string) => (await fetch(u)).blob();

export async function buildBackup(includeImages: boolean): Promise<Blob> {
  const [txs, categories, rules, names] = await Promise.all([
    db.txs.toArray(),
    db.categories.toArray(),
    db.rules.toArray(),
    db.settings.get('myNames'),
  ]);
  const file: BackupFile = {
    app: 'jodwai',
    version: 1,
    exportedAt: new Date().toISOString(),
    txs,
    categories,
    rules,
    myNames: (names?.value as string[]) ?? [],
  };
  if (includeImages) {
    const imgs = await db.images.toArray();
    file.images = await Promise.all(imgs.map(async (i) => ({ txId: i.txId, dataUrl: await blobToDataUrl(i.blob) })));
  }
  return new Blob([JSON.stringify(file)], { type: 'application/json' });
}

export interface ImportResult {
  added: number;
  updated: number;
  skipped: number;
}

/** Merge a backup into this device. Newer edits win; nothing is deleted. */
export async function importBackup(file: Blob): Promise<ImportResult> {
  let data: BackupFile;
  try {
    data = JSON.parse(await file.text());
  } catch {
    throw new Error('ไฟล์นี้ไม่ใช่ไฟล์สำรองของจดไว');
  }
  if (data?.app !== 'jodwai' || !Array.isArray(data.txs)) throw new Error('ไฟล์นี้ไม่ใช่ไฟล์สำรองของจดไว');

  const images = new Map<string, Blob>();
  for (const i of data.images ?? []) images.set(i.txId, await dataUrlToBlob(i.dataUrl));

  const res: ImportResult = { added: 0, updated: 0, skipped: 0 };
  await db.transaction('rw', [db.txs, db.images, db.categories, db.rules, db.settings], async () => {
    for (const c of data.categories ?? []) if (!(await db.categories.get(c.id))) await db.categories.put(c);
    for (const r of data.rules ?? []) {
      const cur = await db.rules.get(r.key);
      if (!cur || cur.updatedAt < r.updatedAt) await db.rules.put(r);
    }
    const names = new Set([...(((await db.settings.get('myNames'))?.value as string[]) ?? []), ...(data.myNames ?? [])]);
    await db.settings.put({ key: 'myNames', value: [...names] });

    for (const t of data.txs) {
      if (!t?.id || typeof t.amount !== 'number' || !/^\d{4}-\d{2}-\d{2}$/.test(t.date ?? '')) {
        res.skipped++;
        continue;
      }
      const cur = await db.txs.get(t.id);
      if (cur && cur.updatedAt >= t.updatedAt) {
        res.skipped++;
        continue;
      }
      const dup = !cur && t.slipKey ? await db.txs.where('slipKey').equals(t.slipKey).first() : undefined;
      if (dup) {
        res.skipped++;
        continue;
      }
      const img = images.get(t.id);
      await db.txs.put({ ...t, hasImage: img ? true : cur?.hasImage ?? false });
      if (img) await db.images.put({ txId: t.id, blob: img });
      if (cur) res.updated++;
      else res.added++;
    }
  });
  return res;
}

const csvCell = (v: string | number) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export async function buildCsv(): Promise<Blob> {
  const [txs, cats] = await Promise.all([db.txs.orderBy('date').toArray(), db.categories.toArray()]);
  const catName = new Map(cats.map((c) => [c.id, c.name]));
  const rows = [
    ['วันที่', 'เวลา', 'ประเภท', 'หมวดหมู่', 'จำนวนเงิน', 'จ่ายให้/ได้จาก', 'บันทึก', 'ที่มา', 'เลขอ้างอิง'],
    ...txs.map((t) => [
      t.date,
      t.time,
      t.type === 'income' ? 'รายรับ' : 'รายจ่าย',
      catName.get(t.categoryId) ?? t.categoryId,
      (t.amount / 100).toFixed(2),
      t.counterparty,
      t.note,
      t.source === 'slip' ? 'สลิป' : 'จดเอง',
      t.ref ?? '',
    ]),
  ];
  // BOM so Excel opens Thai text correctly.
  return new Blob(['﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
}

export function backupName(ext: string) {
  return `jodwai-${localDate()}.${ext}`;
}

/** Share (mobile) or download (desktop) a generated file. */
export async function deliverFile(blob: Blob, name: string): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const file = new File([blob], name, { type: blob.type });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.canShare?.({ files: [file] }) && matchMedia('(pointer: coarse)').matches) {
    try {
      await nav.share({ files: [file], title: name });
      return 'shared';
    } catch (e) {
      if ((e as Error).name === 'AbortError') return 'cancelled';
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return 'downloaded';
}
