import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState } from 'react';
import { db, type Tx } from './db';
import type { Category, TxType } from './categories';
import { shiftMonth } from './format';

export function useCategories(): Category[] {
  return useLiveQuery(() => db.categories.orderBy('order').toArray(), [], []) ?? [];
}

export function useCategoryMap(): Map<string, Category> {
  const cats = useCategories();
  return useMemo(() => new Map(cats.map((c) => [c.id, c])), [cats]);
}

export function categoriesOf(cats: Category[], type: TxType, includeId?: string) {
  return cats.filter((c) => c.type === type && (!c.hidden || c.id === includeId));
}

export function useMonthTxs(month: string): Tx[] | undefined {
  return useLiveQuery(
    () => db.txs.where('date').between(`${month}-01`, `${month}-31`, true, true).toArray(),
    [month],
  );
}

export interface Totals {
  income: number;
  expense: number;
}

export function totalsOf(txs: Tx[] | undefined): Totals {
  const t = { income: 0, expense: 0 };
  for (const x of txs ?? []) t[x.type] += x.amount;
  return t;
}

export function usePrevMonthTotals(month: string): Totals | undefined {
  const prev = useMonthTxs(shiftMonth(month, -1));
  return prev ? totalsOf(prev) : undefined;
}

export function useSetting<T>(key: string, fallback: T): T {
  const row = useLiveQuery(() => db.settings.get(key), [key]);
  return (row?.value as T) ?? fallback;
}

/** Object URL for a stored slip image (revoked on unmount). */
export function useSlipImage(txId: string | null | undefined): string | null {
  const row = useLiveQuery(() => (txId ? db.images.get(txId) : undefined), [txId]);
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!row?.blob) {
      setUrl(null);
      return;
    }
    const u = URL.createObjectURL(row.blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [row]);
  return url;
}

export function useBlobUrl(blob: Blob | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) {
      setUrl(null);
      return;
    }
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return url;
}
