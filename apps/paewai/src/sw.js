// Offline cache. scripts/build.mjs fills VERSION and FILES; a new build = a new cache.
const VERSION = 'dev';
const FILES = ['./'];
const CACHE = `paewai-${VERSION}`;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(FILES))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('paewai-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  if (req.mode === 'navigate') {
    // Home-screen shortcuts and the share sheet open "./?…": serve the cached page for all of them.
    event.respondWith(
      caches.match('./', { ignoreSearch: true }).then((hit) => hit || fetch(req)),
    );
    return;
  }
  event.respondWith(caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req)));
});

// Tapping a reminder opens แปะไว้; its buttons (เลื่อน 10 นาที / เสร็จแล้ว) act without opening it.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const id = event.notification.data?.id;
  const action = ['snooze', 'done'].includes(event.action) && id ? event.action : '';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const open = list.find((c) => c.url.startsWith(self.registration.scope));
      if (action && open) {
        open.postMessage({ type: 'notification-action', action, id });
        return undefined;
      }
      if (action) return self.clients.openWindow(`./?${action}=${encodeURIComponent(id)}`);
      return open ? open.focus() : self.clients.openWindow('./');
    }),
  );
});
