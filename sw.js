const CACHE_NAME = 'tg-drive-v2';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './css/style.css',
  './css/messenger.css',
  './js/app.js',
  './js/messenger.js',
  './favicon.png',
  './favicon2.png',
  './manifest.json'
];

// Map of active streaming download sessions: uuid -> { port, filename, mime, size }
const PORT_MAP = new Map();

// Install Event
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[ServiceWorker] Pre-caching App Shell');
      return cache.addAll(ASSETS_TO_CACHE);
    }).then(() => self.skipWaiting())
  );
});

// Activate Event
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keyList) => {
      return Promise.all(keyList.map((key) => {
        if (key !== CACHE_NAME && key !== 'tg-drive-download-stream') {
          console.log('[ServiceWorker] Removing old cache', key);
          return caches.delete(key);
        }
      }));
    }).then(() => self.clients.claim())
  );
});

// Receive MessagePort for streaming downloads from main thread
self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'INIT_PORT') {
    const { uuid, filename, mime, size } = e.data;
    const port = e.ports && e.ports[0];
    if (port && uuid) {
      PORT_MAP.set(uuid, { port, filename, mime: mime || 'application/octet-stream', size: size || 0 });
    }
  }
});

// Fetch Event
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // 1. Intercept streaming download requests (/sw-download/{uuid})
  if (url.pathname.includes('/sw-download/')) {
    const parts = url.pathname.split('/sw-download/');
    const uuid = parts[1];
    if (!uuid) return;

    const entry = PORT_MAP.get(uuid);
    if (!entry) {
      event.respondWith(new Response('Download session not found or expired', { status: 404 }));
      return;
    }

    PORT_MAP.delete(uuid); // One-shot consumption
    const { port, filename, mime, size } = entry;

    const body = new ReadableStream({
      start(controller) {
        port.onmessage = (evt) => {
          const data = evt.data;

          if (data && data.done) {
            controller.close();
            port.close();
            return;
          }

          if (data && data.error) {
            controller.error(new Error(data.error));
            port.close();
            return;
          }

          if (data instanceof ArrayBuffer) {
            controller.enqueue(new Uint8Array(data));
          } else if (data instanceof Uint8Array) {
            controller.enqueue(data);
          } else if (data && data.buffer) {
            controller.enqueue(new Uint8Array(data.buffer, data.byteOffset || 0, data.byteLength || data.length));
          } else if (data) {
            controller.enqueue(data);
          }
        };

        port.onmessageerror = () => {
          controller.error(new Error('MessagePort transfer error'));
          port.close();
        };
      },
      cancel() {
        try { port.postMessage({ cancelled: true }); } catch (_) {}
        port.close();
      }
    });

    const encodedName = encodeURIComponent(filename).replace(/'/g, '%27');
    const headers = {
      'Content-Type': mime,
      'Content-Disposition': `attachment; filename="${filename}"; filename*=UTF-8''${encodedName}`,
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    };
    if (size > 0) {
      headers['Content-Length'] = String(size);
    }

    event.respondWith(new Response(body, { headers }));
    return;
  }

  // 2. Standard GET / App Shell caching
  if (event.request.method !== 'GET') return;
  if (!event.request.url.startsWith(self.location.origin)) return;
  if (event.request.url.includes('/api/')) return;

  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      })
      .catch(() => {
        return caches.match(event.request).then((cachedResponse) => {
          if (cachedResponse) return cachedResponse;
          if (event.request.headers.get('accept')?.includes('text/html')) {
            return caches.match('./index.html');
          }
        });
      })
  );
});
