/* Generated static-only QR Link worker. Never caches session data or files. */
'use strict';
const VERSION = "9856b86235e8b2bba877";
const SCOPE = self.registration.scope;
const PREFIX = 'qr-link-static:' + SCOPE + ':';
const CACHE = PREFIX + VERSION;
const ASSETS = ["LICENSE","THIRD_PARTY_NOTICES.txt","assets/index-Cfn2s-JE.js","assets/index-DiztzYSb.css","icon-192.png","icon-512.png","icon.svg","index.html","manifest.webmanifest"].map((asset) => new URL(asset, SCOPE).href);
const STATIC_URLS = new Set(ASSETS);
const INDEX = new URL('index.html', SCOPE).href;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const existed = await caches.has(CACHE);
    try {
      const cache = await caches.open(CACHE);
      // Cache.addAll commits its batch only if every static asset loads.
      await cache.addAll(ASSETS.map((url) => new Request(url, { cache: 'reload', credentials: 'same-origin' })));
    } catch (error) {
      if (!existed) await caches.delete(CACHE);
      throw error;
    }
    // No skipWaiting: an update waits until older app tabs have closed, so
    // installing new code cannot interrupt a transfer or a running call.
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name.startsWith(PREFIX) && name !== CACHE).map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || request.headers.has('range')) return;
  const url = new URL(request.url);
  // Exact allowlist only: no runtime cache writes, query strings, Blob URLs,
  // user content, arbitrary navigation routes, or requests to another origin.
  if (url.origin !== new URL(SCOPE).origin || url.search || url.hash) return;
  let key = url.href;
  if (request.mode === 'navigate') {
    if (key !== SCOPE && key !== INDEX) return;
    key = INDEX;
  } else if (!STATIC_URLS.has(key)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    return (await cache.match(key)) || fetch(request);
  })());
});
