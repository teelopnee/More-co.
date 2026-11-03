/// <reference lib="webworker" />
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { CacheFirst } from 'workbox-strategies';

declare const self: ServiceWorkerGlobalScope;

const SHARE_CACHE = 'jodwai-share-inbox';

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// OCR engine + Thai language data: large, versioned with the app, cached on first use.
registerRoute(({ url }) => url.pathname.includes('/ocr/'), new CacheFirst({ cacheName: 'jodwai-ocr' }));

// Web Share Target: Android "share to จดไว" posts the images here.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'POST' || !url.pathname.endsWith('/share-target')) return;
  event.respondWith(
    (async () => {
      try {
        const form = await event.request.formData();
        const cache = await caches.open(SHARE_CACHE);
        const files = form.getAll('slips').filter((f): f is File => f instanceof File);
        await Promise.all(
          files.map((f, i) =>
            cache.put(
              new Request(`${self.registration.scope}__share/${Date.now()}-${i}`),
              new Response(f, {
                headers: {
                  'content-type': f.type || 'image/jpeg',
                  'x-file-name': encodeURIComponent(f.name || `slip-${i}.jpg`),
                  'x-last-modified': String(f.lastModified || Date.now()),
                },
              }),
            ),
          ),
        );
      } catch (err) {
        console.error('share-target failed', err);
      }
      return Response.redirect(`${self.registration.scope}#/scan?shared=1`, 303);
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') void self.skipWaiting();
});
