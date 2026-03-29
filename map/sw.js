const CACHE_NAME = "geo-camera-map-overlay-v2";
const RUNTIME_CACHE_NAME = "geo-camera-map-runtime-v1";
const APP_SHELL_URLS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.webmanifest",
  "./favicon.ico",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/app-icon.svg",
  "./icons/app-icon-maskable.svg",
  "./data/i18n.json",
  "./data/targets.json"
];
const RUNTIME_CACHE_ORIGINS = new Set([
  self.location.origin,
  "https://unpkg.com"
]);

function shouldHandleRequest(request) {
  if (request.method !== "GET") return false;
  const requestUrl = new URL(request.url);
  return RUNTIME_CACHE_ORIGINS.has(requestUrl.origin);
}

function shouldCacheResponse(response) {
  return Boolean(response) && (response.ok || response.type === "opaque");
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL_URLS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME && key !== RUNTIME_CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (!shouldHandleRequest(request)) return;

  event.respondWith(
    caches.match(request).then(async (cachedResponse) => {
      if (cachedResponse) return cachedResponse;

      const networkResponse = await fetch(request);
      if (shouldCacheResponse(networkResponse)) {
        const responseClone = networkResponse.clone();
        const cacheName = new URL(request.url).origin === self.location.origin ? CACHE_NAME : RUNTIME_CACHE_NAME;
        caches.open(cacheName).then((cache) => cache.put(request, responseClone));
      }
      return networkResponse;
    }).catch(async () => {
      const cachedResponse = await caches.match(request);
      if (cachedResponse) return cachedResponse;
      throw new Error(`Request failed for ${request.url}`);
    })
  );
});
