/* PSEBC Lifts service worker.
 *
 * Privacy rule (PRD §9 "no personal data on drivers' phones beyond the app session"):
 * API responses and pages are NEVER cached. Only the app shell's static files and the
 * offline page are stored, so the app opens fast and shows a friendly message offline.
 */
const VERSION = 'psebc-v1';
const STATIC_CACHE = `${VERSION}-static`;
const PRECACHE = ['/offline', '/icons/icon-192.png', '/icons/icon-512.png', '/favicon.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(STATIC_CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Never cache API calls: they carry personal data.
  if (url.pathname.startsWith('/api/')) return;

  // Pages: always from the network; fall back to the offline page.
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(() => caches.match('/offline')));
    return;
  }

  // Versioned build assets and icons: cache-first.
  if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/')) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(STATIC_CACHE).then((c) => c.put(req, copy));
            }
            return res;
          }),
      ),
    );
  }
});

// Signing out clears everything this app stored on the device.
self.addEventListener('message', (event) => {
  if (event.data === 'logout') {
    event.waitUntil(caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k)))));
  }
});
