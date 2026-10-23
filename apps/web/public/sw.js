/* PSEBC Lifts service worker.
 *
 * Privacy rule (PRD §9 "no personal data on drivers' phones beyond the app session"):
 * API responses and pages are NEVER cached. Only the app shell's static files and the
 * offline page are stored, so the app opens fast and shows a friendly message offline.
 */
const VERSION = 'psebc-v2';
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

// ---------------------------------------------------------------------------
// Message alerts (Web Push). Payloads are generic: no names, addresses or times.
// ---------------------------------------------------------------------------
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = {};
  }
  const title = data.title || 'PSEBC Lifts';
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      // Tell open tabs to refresh their inbox; the tab plays the in-app chime.
      windows.forEach((w) => w.postMessage({ type: 'psebc-push', tag: data.tag }));
      const focused = windows.some((w) => w.visibilityState === 'visible' && w.focused);
      if (focused) return;
      await self.registration.showNotification(title, {
        body: data.body || 'Open PSEBC Lifts to see the details.',
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
        tag: data.tag || 'psebc',
        renotify: true,
        requireInteraction: !!data.urgent,
        vibrate: data.urgent ? [200, 100, 200, 100, 200] : [120, 60, 120],
        silent: false,
        data: { url: data.url || '/notifications' },
      });
    })(),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/notifications';
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const existing = windows.find((w) => new URL(w.url).origin === self.location.origin);
      if (existing) {
        await existing.focus();
        if ('navigate' in existing) return existing.navigate(url);
        return undefined;
      }
      return self.clients.openWindow(url);
    })(),
  );
});
