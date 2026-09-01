/* eslint-env serviceworker */
/**
 * Push service worker (docx §8).
 *
 *   Order Placed → BullMQ → Notification Worker → Web Push → THIS FILE → Customer
 *
 * Lives in public/ rather than src/ because a service worker's scope is limited
 * to the directory it is served from: at the origin root it can control the
 * whole app, whereas a bundled copy under /assets/ could only control /assets/.
 */

// Take over immediately instead of waiting for every tab on the old worker to
// close — otherwise a change here needs a full browser restart to take effect.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  /**
   * Always show something.
   *
   * Browsers permit a push message only if it results in a visible
   * notification; returning without calling showNotification() makes them
   * display a generic "this site was updated in the background" notice
   * instead, so a malformed payload must still render.
   */
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { body: event.data ? event.data.text() : '' };
  }

  const title = payload.title || 'Order update';

  event.waitUntil(
    self.registration.showNotification(title, {
      body: payload.body || '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { url: payload.url || '/notifications' },
      /**
       * Collapse repeats of the same event rather than stacking duplicates.
       *
       * The queue retries with backoff and enqueues with a deterministic job
       * id, so the same event can legitimately arrive twice; tagging by event
       * means the second replaces the first instead of appearing beside it.
       */
      tag: payload.event || 'order-update',
      renotify: true,
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = event.notification.data?.url || '/notifications';

  // Focus an already-open tab rather than opening a duplicate window on every
  // click, then navigate it to the order the notification refers to.
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.startsWith(self.location.origin) && 'focus' in client) {
          if ('navigate' in client) client.navigate(target);
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});