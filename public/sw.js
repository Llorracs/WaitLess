// ============================================
// WAITLESS — Service Worker
// ============================================
// Enables PWA install prompt, basic caching, and push notifications.
// FILE: public/sw.js
//
// CHANGES in v2 (push notifications added):
//   - 'push' event listener — displays incoming push notifications
//   - 'notificationclick' event listener — opens app to relevant page on tap
//   - CACHE_NAME bumped to 'waitless-v2' so existing patrons get the new SW
//
// All pre-existing PWA install + caching behavior is unchanged.
// ============================================

const CACHE_NAME = 'waitless-v2';
const PRECACHE_URLS = [
  '/',
];

// Install — precache essential assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();
});

// Activate — clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch — network first, fallback to cache
self.addEventListener('fetch', (event) => {
  // Skip non-GET requests and API calls
  if (event.request.method !== 'GET') return;
  if (event.request.url.includes('/.netlify/')) return;
  if (event.request.url.includes('supabase')) return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Cache successful responses
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});

// ============================================
// PUSH NOTIFICATION HANDLERS
// ============================================
//
// PUSH EVENT
//   Fires when our send-push.js dispatches a push to this device.
//   The push service (Apple/Google/Mozilla) wakes up our SW even if the
//   tab is closed and delivers the payload.
//
//   Payload shape (from send-push.js):
//     {
//       title: "TRFQ — Your drink is ready! 🍸",
//       body: "Red M is ready at the bar",
//       url: "/trfq/order/<order_id>",
//       timestamp: 1747234567890
//     }
//
//   We use showNotification() to display it on the lock screen / system tray.
//   Returning a promise via event.waitUntil() keeps the SW alive until the
//   notification is actually shown — without this, mobile browsers can kill
//   the SW before display.
// ============================================

self.addEventListener('push', (event) => {
  // Defensive parse — if payload is missing or malformed, show a generic message
  let payload = {};
  try {
    if (event.data) {
      payload = event.data.json();
    }
  } catch (err) {
    console.error('Push payload parse failed:', err);
  }

  const title = payload.title || 'Waitless';
  const options = {
    body: payload.body || 'Your order has an update',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: payload.tag || 'waitless-order',  // tag collapses duplicate notifications
    requireInteraction: false,              // auto-dismiss after a few seconds on most platforms
    data: {
      url: payload.url || '/',
      timestamp: payload.timestamp || Date.now(),
    },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// ============================================
// NOTIFICATION CLICK
//   Fires when the patron taps the notification on their lock screen.
//   We close the notification, then try to focus an existing tab on the
//   right URL. If no matching tab is open, open a fresh one.
// ============================================

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const targetUrl = event.notification.data?.url || '/';

  // Try to focus an existing open tab for this URL; otherwise open new one
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Look for an exact URL match first
      for (const client of clientList) {
        if (client.url.endsWith(targetUrl) && 'focus' in client) {
          return client.focus();
        }
      }
      // Look for any tab on the same origin and navigate it
      for (const client of clientList) {
        if ('navigate' in client && 'focus' in client) {
          return client.navigate(targetUrl).then((c) => c?.focus());
        }
      }
      // Last resort: open a new window
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});
