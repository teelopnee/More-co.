import { counterpartyKey } from './categories';
import { db, newId, requestPersistence, type SlipImage, type Tx } from './db';

export type TxDraft = Omit<Tx, 'id' | 'createdAt' | 'updatedAt'> & { id?: string };

async function learn(tx: Pick<Tx, 'counterparty' | 'categoryId'>) {
  const key = counterpartyKey(tx.counterparty);
  if (key) await db.rules.put({ key, categoryId: tx.categoryId, updatedAt: Date.now() });
}

export async function saveTx(draft: TxDraft, image?: Blob | null): Promise<Tx> {
  const now = Date.now();
  const existing = draft.id ? await db.txs.get(draft.id) : undefined;
  const tx: Tx = {
    ...draft,
    id: draft.id ?? newId(),
    hasImage: image ? true : (existing?.hasImage ?? draft.hasImage ?? false),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  await db.transaction('rw', db.txs, db.images, db.rules, async () => {
    await db.txs.put(tx);
    if (image) await db.images.put({ txId: tx.id, blob: image });
    await learn(tx);
  });
  void requestPersistence();
  return tx;
}

export async function saveMany(items: { draft: TxDraft; image?: Blob | null }[]): Promise<number> {
  const now = Date.now();
  await db.transaction('rw', db.txs, db.images, db.rules, async () => {
    for (const [i, { draft, image }] of items.entries()) {
      const tx: Tx = { ...draft, id: draft.id ?? newId(), hasImage: !!image, createdAt: now + i, updatedAt: now + i };
      await db.txs.put(tx);
      if (image) await db.images.put({ txId: tx.id, blob: image });
      await learn(tx);
    }
  });
  void requestPersistence();
  return items.length;
}

export async function deleteTx(id: string): Promise<{ tx?: Tx; image?: SlipImage }> {
  let tx: Tx | undefined;
  let image: SlipImage | undefined;
  await db.transaction('rw', db.txs, db.images, async () => {
    tx = await db.txs.get(id);
    image = await db.images.get(id);
    await db.txs.delete(id);
    await db.images.delete(id);
  });
  return { tx, image };
}

export async function restoreTx(tx: Tx, image?: SlipImage) {
  await db.transaction('rw', db.txs, db.images, async () => {
    await db.txs.put(tx);
    if (image) await db.images.put(image);
  });
}

export async function isDuplicate(slipKey: string | null | undefined): Promise<boolean> {
  if (!slipKey) return false;
  return (await db.txs.where('slipKey').equals(slipKey).count()) > 0;
}
