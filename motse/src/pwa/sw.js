'use strict';

/**
 * Motse PWA service worker (Phase 2, WS2).
 *
 * Strategy per the platform's offline-first principle (P1):
 *  - the app shell is cache-first (works with zero connectivity);
 *  - /v1 GETs are network-first with cache fallback (stale-while-offline
 *    read model, §8);
 *  - /v1 mutations are NEVER cached or replayed here — the in-app
 *    outbox owns replay via POST /v1/sync/outbox with idempotency keys,
 *    matching the backend replay protocol exactly.
 */
const SHELL_CACHE = 'motse-shell-v1';
const API_CACHE = 'motse-api-v1';
const SHELL = ['/app', '/app/manifest.json'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET') return; // mutations: outbox territory

  if (url.pathname === '/app' || url.pathname.startsWith('/app/')) {
    event.respondWith(
      caches.match(event.request).then(
        (hit) =>
          hit ||
          fetch(event.request).then((response) => {
            const copy = response.clone();
            caches.open(SHELL_CACHE).then((cache) => cache.put(event.request, copy));
            return response;
          })
      )
    );
    return;
  }

  if (url.pathname.startsWith('/v1/')) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(API_CACHE).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => caches.match(event.request))
    );
  }
});
