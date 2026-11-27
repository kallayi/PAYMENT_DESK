// Payment Desk Lightweight PWA Service Worker (v6 — Payment Desk rupee icon)
// No aggressive HTML caching (preserves Next.js SSR & auth isolation).
// Handles Web Push workflow notifications and deep-link navigation.

const CACHE_NAME = 'payment-desk-static-v6';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.map((key) => {
            if (key !== CACHE_NAME) {
              return caches.delete(key);
            }
            return Promise.resolve();
          })
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') {
    return;
  }

  const url = new URL(request.url);

  // Never intercept API, Supabase, auth, or HTML document requests
  if (
    url.hostname.includes('supabase') ||
    url.pathname.startsWith('/api/') ||
    url.pathname.includes('/auth/') ||
    request.mode === 'navigate'
  ) {
    return;
  }

  // Only cache immutable Next static assets and icons
  if (
    url.pathname.startsWith('/_next/static/') ||
    /\.(?:png|jpg|jpeg|svg|webp|woff2|ico)$/i.test(url.pathname)
  ) {
    event.respondWith(
      fetch(request)
        .then((networkResponse) => {
          if (networkResponse.status === 200) {
            const clone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return networkResponse;
        })
        .catch(() => caches.match(request))
    );
  }
});

// Web Push Notification Listener
self.addEventListener('push', (event) => {
  let payload = {
    title: 'Payment Desk',
    body: 'You have a new payment workflow update.',
    url: '/',
  };

  if (event.data) {
    try {
      const parsed = event.data.json();
      payload = {
        title: parsed.title || 'Payment Desk',
        body: parsed.body || payload.body,
        url: parsed.action_url || parsed.url || '/',
      };
    } catch {
      const text = event.data.text();
      if (text) payload.body = text;
    }
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: '/icon-192.png?v=3',
      badge: '/badge-72.png?v=3',
      silent: false,
      data: { url: payload.url, action_url: payload.url },
      tag: `payment-desk-${Date.now()}`,
      renotify: true,
      vibrate: [250, 100, 250],
      requireInteraction: false,
    })
  );
});

// Notification Click Deep-Link Handler
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const rawUrl =
    (event.notification.data &&
      (event.notification.data.action_url || event.notification.data.url)) ||
    '/';
  const targetUrl = new URL(rawUrl, self.location.origin).href;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          client.focus();
          if ('navigate' in client) {
            return client.navigate(targetUrl);
          }
          return client;
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
      return undefined;
    })
  );
});
