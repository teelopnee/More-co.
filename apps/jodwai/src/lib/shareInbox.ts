// Images shared to the app (Android share sheet → "จดไว") are parked by the
// service worker in this cache, then picked up here on launch.
export const SHARE_CACHE = 'jodwai-share-inbox';

export async function takeSharedFiles(): Promise<File[]> {
  if (!('caches' in window)) return [];
  const cache = await caches.open(SHARE_CACHE);
  const keys = await cache.keys();
  const files: File[] = [];
  for (const req of keys) {
    const res = await cache.match(req);
    if (res) {
      const blob = await res.blob();
      const name = decodeURIComponent(res.headers.get('x-file-name') ?? 'slip.jpg');
      files.push(new File([blob], name, { type: blob.type || 'image/jpeg', lastModified: Number(res.headers.get('x-last-modified')) || Date.now() }));
    }
    await cache.delete(req);
  }
  return files;
}
