// Payment Desk Lightweight PWA Service Worker (v8 — custom-branded urgent/normal alerts & badging)
// No aggressive HTML caching (preserves Next.js SSR & auth isolation).
// Handles Web Push workflow notifications and deep-link navigation.

const CACHE_NAME = 'payment-desk-static-v8';

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
    priority: 'normal',
    actionLabel: 'Open Desk',
    tag: null,
    badgeCount: 1,
  };

  if (event.data) {
    try {
      const parsed = event.data.json();
      const parsedBadgeCount = Number(parsed.badgeCount);
      payload = {
        title: parsed.title || 'Payment Desk',
        body: parsed.body || payload.body,
        url: parsed.action_url || parsed.url || '/',
        priority: parsed.priority === 'urgent' ? 'urgent' : 'normal',
        actionLabel:
          typeof parsed.actionLabel === 'string' && parsed.actionLabel.trim()
            ? parsed.actionLabel.trim()
            : 'Open Desk',
        tag:
          typeof parsed.tag === 'string' && parsed.tag.trim()
            ? parsed.tag.trim()
            : null,
        badgeCount:
          Number.isFinite(parsedBadgeCount) && parsedBadgeCount > 0
            ? Math.floor(parsedBadgeCount)
            : 1,
      };
    } catch {
      const text = event.data.text();
      if (text) payload.body = text;
    }
  }

  const isUrgent = payload.priority === 'urgent';
  const icon = isUrgent ? '/icon-urgent-192.png?v=1' : '/icon-192.png?v=3';
  const badge = '/badge-72.png?v=4';
  const vibrate = isUrgent ? [300, 100, 300, 100, 300] : [180, 90, 180];
  const tag = payload.tag || `payment-desk-${Date.now()}`;
  const actions = [
    { action: 'open', title: payload.actionLabel || 'Open Desk' },
    { action: 'dismiss', title: 'Dismiss' },
  ];

  const tasks = [
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon,
      badge,
      silent: false,
      data: { url: payload.url, action_url: payload.url },
      tag,
      renotify: true,
      vibrate,
      requireInteraction: isUrgent,
      actions,
    }),
  ];

  if (
    self.navigator &&
    typeof self.navigator.setAppBadge === 'function'
  ) {
    tasks.push(
      Promise.resolve(self.navigator.setAppBadge(payload.badgeCount)).catch(() => {})
    );
  }

  event.waitUntil(Promise.all(tasks));
});

// Notification Click Deep-Link Handler
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  if (event.action === 'dismiss') {
    return;
  }

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
