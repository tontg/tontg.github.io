"use strict";
const worker = self;
const CACHE_PREFIX = `geo-camera-map:${worker.registration.scope}:`;
const CACHE_NAME = `${CACHE_PREFIX}0.9.1`;
const LEGACY_CACHES = new Set(["geo-camera-map-overlay-v2", "geo-camera-map-runtime-v1"]);
const APP_SHELL_URLS = [
    "./", "./index.html", "./styles.css", "./app.js", "./navigation.js",
    "./journey-store.js", "./journey-tools.js", "./gpx.js", "./feedback.js", "./route-editor.js", "./xr-controls.js",
    "./xr-anchors.js", "./xr-debug.js", "./dom.js", "./errors.js", "./version.js", "./types.js",
    "./manifest.webmanifest", "./favicon.ico", "./data/i18n.json", "./data/targets.json",
    "./icons/icon-192.png", "./icons/icon-512.png", "./icons/icon-maskable-512.png",
    "./icons/app-icon.svg", "./icons/app-icon-maskable.svg"
].map((path) => new URL(path, worker.registration.scope).href);
const VENDOR_URLS = new Set([
    "./vendor/leaflet/leaflet.css", "./vendor/leaflet/leaflet.js", "./vendor/three/three.module.js",
    "./vendor/leaflet/images/marker-icon.png", "./vendor/leaflet/images/marker-icon-2x.png",
    "./vendor/leaflet/images/marker-shadow.png", "./vendor/leaflet/images/layers.png", "./vendor/leaflet/images/layers-2x.png"
].map((path) => new URL(path, worker.registration.scope).href));
const SHELL_URLS = new Set(APP_SHELL_URLS);
worker.addEventListener("install", (event) => {
    event.waitUntil((async () => {
        const cache = await caches.open(CACHE_NAME);
        const shell = [...APP_SHELL_URLS, ...Array.from(VENDOR_URLS).filter((url) => !url.includes('/three/'))];
        await cache.addAll(shell.map((url) => new Request(url, { cache: "reload" })));
        await worker.skipWaiting();
    })());
});
worker.addEventListener("activate", (event) => {
    event.waitUntil((async () => {
        const keys = await caches.keys();
        // CacheStorage is shared by every application on this origin.
        await Promise.all(keys.filter((key) => (key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME) || LEGACY_CACHES.has(key)).map((key) => caches.delete(key)));
        await worker.clients.claim();
    })());
});
async function cachedResponse(cache, request) {
    try {
        return await cache?.match(request);
    }
    catch (error) {
        console.warn("[pwa] Cache read failed", error);
        return undefined;
    }
}
async function saveResponse(cache, request, response) {
    try {
        await cache.put(request, response.clone());
    }
    catch (error) {
        console.warn("[pwa] Cache write failed", error);
    }
}
async function respond(request, background) {
    let cache = null;
    try {
        cache = await caches.open(CACHE_NAME);
    }
    catch (error) {
        console.warn("[pwa] Cache unavailable; using network", error);
    }
    // Pinned libraries are immutable within a release. App/data files still revalidate.
    if (VENDOR_URLS.has(request.url) || worker.navigator?.onLine === false) {
        const cached = await cachedResponse(cache, request);
        if (cached)
            return cached;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
        // Revalidate app/data files; never indefinitely serve a cached release or journey.
        const response = await fetch(request, { cache: "no-cache", signal: controller.signal });
        if (response.ok && cache) {
            background(saveResponse(cache, request, response));
        }
        else if (response.status >= 500) {
            const cached = await cachedResponse(cache, request);
            if (cached)
                return cached;
        }
        return response;
    }
    catch (error) {
        const cached = await cachedResponse(cache, request);
        if (cached)
            return cached;
        throw error;
    }
    finally {
        clearTimeout(timeout);
    }
}
worker.addEventListener("fetch", (event) => {
    const { request } = event;
    // An allowlist bounds storage and excludes tiles, private APIs and sibling apps.
    if (request.method !== "GET" || (!SHELL_URLS.has(request.url) && !VENDOR_URLS.has(request.url)))
        return;
    let write = Promise.resolve();
    const response = respond(request, (work) => { write = work; });
    event.respondWith(response);
    // Extend worker lifetime, but do not delay delivery while CacheStorage writes finish.
    event.waitUntil(response.then(() => write, () => write));
});
//# sourceMappingURL=sw.js.map