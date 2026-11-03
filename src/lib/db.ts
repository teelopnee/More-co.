import Dexie, { type Table } from 'dexie';
import { DEFAULT_CATEGORIES, type Category, type TxType } from './categories';

export interface Tx {
  id: string;
  type: TxType;
  /** Amount in satang (1 baht = 100) to avoid floating point drift. */
  amount: number;
  /** Local date YYYY-MM-DD. */
  date: string;
  /** HH:MM or '' when unknown. */
  time: string;
  categoryId: string;
  counterparty: string;
  note: string;
  source: 'slip' | 'manual';
  slipKey?: string | null;
  bankId?: string | null;
  ref?: string | null;
  hasImage?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface SlipImage {
  txId: string;
  blob: Blob;
}

export interface Rule {
  key: string;
  categoryId: string;
  updatedAt: number;
}

export interface Setting {
  key: string;
  value: unknown;
}

export class AppDB extends Dexie {
  txs!: Table<Tx, string>;
  categories!: Table<Category, string>;
  images!: Table<SlipImage, string>;
  rules!: Table<Rule, string>;
  settings!: Table<Setting, string>;

  constructor(name = 'jodwai') {
    super(name);
    this.version(1).stores({
      txs: 'id, date, slipKey, categoryId, type, createdAt',
      categories: 'id, type, order',
      images: 'txId',
      rules: 'key',
      settings: 'key',
    });
    this.on('populate', (tx) => {
      tx.table('categories').bulkAdd(DEFAULT_CATEGORIES);
    });
  }
}

export const db = new AppDB();

export const newId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export const toSatang = (baht: number) => Math.round(baht * 100);
export const toBaht = (satang: number) => satang / 100;

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const row = await db.settings.get(key);
  return (row?.value as T) ?? fallback;
}

export async function setSetting(key: string, value: unknown) {
  await db.settings.put({ key, value });
}

export async function learnedRules(): Promise<Map<string, string>> {
  const rows = await db.rules.toArray();
  return new Map(rows.map((r) => [r.key, r.categoryId]));
}

/** Ask the browser not to evict our data (important on iOS). */
export async function requestPersistence() {
  try {
    if (navigator.storage?.persisted && !(await navigator.storage.persisted())) {
      await navigator.storage.persist?.();
    }
  } catch {
    /* not supported */
  }
}
