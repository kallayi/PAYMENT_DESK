// INDFURN PayFlow Lightweight Service Worker
// Implements network-first strategy to guarantee zero stale financial/balance data.

const CACHE_NAME = 'indfurn-payflow-v1';
const STATIC_ASSETS = [
  '/',
  '/login',
  '/manifest.webmanifest',
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Never cache non-GET requests (mutations, server actions, uploads)
  if (request.method !== 'GET') {
    return;
  }

  const url = new URL(request.url);

  // Strictly skip caching for any Supabase API, Auth, or Storage requests
  if (
    url.hostname.includes('supabase') ||
    url.pathname.startsWith('/api/') ||
    url.pathname.includes('/auth/')
  ) {
    return;
  }

  // Network-first strategy for pages and static assets
  event.respondWith(
    fetch(request)
      .then((networkResponse) => {
        // Cache valid static responses (CSS, JS, images, fonts)
        if (
          networkResponse.status === 200 &&
          (url.pathname.match(/\.(js|css|png|jpg|jpeg|svg|webp|woff2)$/) ||
            url.pathname.startsWith('/_next/static/'))
        ) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, responseToCache);
          });
        }
        return networkResponse;
      })
      .catch(async () => {
        // Fallback to cache if network is unavailable
        const cachedResponse = await caches.match(request);
        if (cachedResponse) {
          return cachedResponse;
        }

        // Return basic offline response for HTML navigation requests
        if (request.mode === 'navigate') {
          return new Response(
            `<!DOCTYPE html>
            <html lang="en">
              <head>
                <meta charset="utf-8">
                <meta name="viewport" content="width=device-width, initial-scale=1">
                <title>Offline — INDFURN PayFlow</title>
                <style>
                  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #F8FAFC; color: #0F172A; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; padding: 20px; text-align: center; }
                  .card { background: white; border: 1px solid #E2E8F0; padding: 32px; border-radius: 12px; max-width: 400px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); }
                  h1 { font-size: 18px; margin: 0 0 8px 0; }
                  p { font-size: 13px; color: #64748B; margin: 0 0 16px 0; line-height: 1.5; }
                  button { background: #1E293B; color: white; border: none; padding: 10px 18px; border-radius: 8px; font-size: 13px; font-weight: 500; cursor: pointer; }
                </style>
              </head>
              <body>
                <div class="card">
                  <h1>You are currently offline</h1>
                  <p>INDFURN PayFlow requires an active internet connection to securely process approvals and verify transactions.</p>
                  <button onclick="window.location.reload()">Retry Connection</button>
                </div>
              </body>
            </html>`,
            {
              headers: { 'Content-Type': 'text/html' },
            }
          );
        }

        return new Response('Network unavailable', { status: 503, statusText: 'Service Unavailable' });
      })
  );
});
