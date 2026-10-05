const CACHE_PREFIX = `geo-camera-map:${self.registration.scope}:`;
const CACHE_NAME = `${CACHE_PREFIX}0.8.0`;
const LEGACY_CACHES = new Set(["geo-camera-map-overlay-v2", "geo-camera-map-runtime-v1"]);
const APP_SHELL_URLS = [
  "./", "./index.html", "./styles.css", "./app.js", "./navigation.mjs",
  "./journey-store.mjs", "./journey-tools.mjs", "./gpx.mjs", "./feedback.mjs", "./route-editor.mjs", "./xr-controls.mjs",
  "./manifest.webmanifest", "./favicon.ico", "./data/i18n.json", "./data/targets.json",
  "./icons/icon-192.png", "./icons/icon-512.png", "./icons/icon-maskable-512.png",
  "./icons/app-icon.svg", "./icons/app-icon-maskable.svg"
].map((path) => new URL(path, self.registration.scope).href);
const CDN_URLS = new Set([
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js",
  "https://unpkg.com/three@0.162.0/build/three.module.js"
]);
const SHELL_URLS = new Set(APP_SHELL_URLS);

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(APP_SHELL_URLS.map((url) => new Request(url, { cache: "reload" })));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    // CacheStorage is shared by every application on this origin.
    await Promise.all(keys.filter((key) =>
      (key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME) || LEGACY_CACHES.has(key)
    ).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

async function respond(request) {
  const cache = await caches.open(CACHE_NAME);
  const immutable = CDN_URLS.has(request.url);
  if (immutable) {
    const cached = await cache.match(request);
    if (cached) return cached;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    // Revalidate app/data files; never indefinitely serve a cached release or journey.
    const response = await fetch(request, { cache: immutable ? "default" : "no-cache", signal: controller.signal });
    if (response.ok) {
      try { await cache.put(request, response.clone()); }
      catch (error) { console.warn("[pwa] Cache write failed", error); }
    } else if (response.status >= 500) {
      const cached = await cache.match(request);
      if (cached) return cached;
    }
    return response;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  // An allowlist bounds storage and excludes tiles, private APIs and sibling apps.
  if (request.method !== "GET" || (!SHELL_URLS.has(request.url) && !CDN_URLS.has(request.url))) return;
  event.respondWith(respond(request));
});
