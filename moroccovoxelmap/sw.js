/* Release shells plus a bounded, visited-only geographic cache. */
const VERSION = '9686470d051e75436138';
const SHELL = `morocco-voxel-map-shell-${VERSION}`;
// URL revisions identify content, so an unchanged CVM survives a UI release.
const DATA = 'morocco-voxel-map-data-v2';
const SHELL_FILES = ["index.html","icon.svg","favicon.ico","favicon-16.png","favicon-32.png","apple-touch-icon.png","icon-192.png","icon-512.png","icon-maskable-512.png","manifest.webmanifest","provenance.json?v=9686470d051e75436138","third-party-notices.json?v=9686470d051e75436138","data/regions.json?v=9686470d051e75436138","previews/manifest.json?v=9686470d051e75436138","data/greater-casablanca/index.json?v=9686470d051e75436138","assets/NotoSansTifinagh-Regular-BcGNahJE.woff2","assets/brotli_dec_wasm-vK8OFmHz.js","assets/brotli_dec_wasm_bg-BK3DOf3U.wasm","assets/brotli_dec_wasm_bg-BmCHhgOM.js","assets/main-C8GXWplL.css","assets/main-Xy0dD6Mx.js","assets/rolldown-runtime-B0lUwjiP.js","assets/scene-previews-DibDOfCP.js"];
const MAX_FILES = 2048;
const MAX_BYTES = 128 * 1024 * 1024;
const BYTE_HEADER = 'x-casa-cache-bytes';
let cacheWork = Promise.resolve();
let dataState;
const inFlight = new Map();
const local = path => new URL(path, self.registration.scope).href;
const SHELL_URLS = new Set(SHELL_FILES.map(local));
function nativeBrotli() {
  try { new DecompressionStream('brotli'); return true; }
  catch { return false; }
}
// The application already selects the native decoder before importing WASM.
// Apply the same rule to offline installation, which otherwise downloads all
// lazy chunks even when no page ever imports them. Keep their URLs eligible
// for normal cache-on-use if a later page does need the fallback.
const INSTALL_FILES = nativeBrotli() ? SHELL_FILES.filter(path =>
  !/^assets\/brotli(?:_dec_wasm|[-_]decoder)[^/]*\.(?:js|wasm)$/.test(path)) : SHELL_FILES;
function httpCache(request, installing = false) {
  if (typeof request !== 'string' && (request.cache === 'reload' || request.cache === 'no-cache')) return 'reload';
  const url = new URL(typeof request === 'string' ? request : request.url);
  // Revisioned requests may reuse an earlier uncontrolled HTTP-cache response.
  // Stable names must validate once before joining the service-worker cache.
  const immutable = /^(?:[a-f0-9]{20}|[a-f0-9]{64})$/.test(url.searchParams.get('v') || '')
    || /\/assets\/[^/]+-[A-Za-z0-9_-]{8}\.(?:js|css|wasm|woff2)$/.test(url.pathname)
    || /\/previews\/[a-z0-9.-]+\.[a-f0-9]{20}\.webp$/.test(url.pathname);
  return immutable ? 'default' : installing ? 'reload' : 'no-cache';
}

self.addEventListener('install', event => {
  event.waitUntil(caches.open(SHELL).then(cache => Promise.all(INSTALL_FILES.map(async path => {
    const response = await fetch(local(path), { cache: httpCache(local(path), true) });
    if (!response.ok) throw new Error(`Application shell HTTP ${response.status}: ${path}`);
    await cache.put(local(path), response);
  }))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key =>
    (key.startsWith('casa-') || key.startsWith('morocco-voxel-map-')) && key !== SHELL && key !== DATA,
  ).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

// CacheStorage insertion order is the persisted LRU order. Keep sizes in memory
// after one scan, rather than rereading every cached body/header for each tile.
function state() {
  if (!dataState) dataState = (async () => {
    const cache = await caches.open(DATA), entries = new Map();
    let bytes = 0;
    for (const key of await cache.keys()) {
      const response = await cache.match(key);
      if (!response) continue;
      const size = Number(response.headers.get(BYTE_HEADER) || 0);
      entries.set(key.url, size); bytes += size;
    }
    return { cache, entries, bytes };
  })().catch(error => { dataState = undefined; throw error; });
  return dataState;
}
function schedule(event, operation) {
  const work = cacheWork.catch(() => {}).then(operation);
  // A disabled/full cache must never break the online viewer or future writes.
  cacheWork = work.catch(() => {});
  event.waitUntil(cacheWork);
  return cacheWork;
}
async function remove(value, url) {
  await value.cache.delete(url);
  value.bytes -= value.entries.get(url) || 0;
  value.entries.delete(url);
}
function retainedMetadata(entries) {
  const currentIndex = [...entries.keys()].filter(url => /\/index\.json$/.test(new URL(url).pathname)).at(-1);
  if (!currentIndex) return new Set();
  const foundation = new URL('foundation.json', currentIndex);
  foundation.search = new URL(currentIndex).search;
  return new Set([currentIndex, foundation.href]);
}
async function trim(value) {
  const retained = retainedMetadata(value.entries);
  while (value.entries.size > MAX_FILES || value.bytes > MAX_BYTES) {
    const candidate = [...value.entries.keys()].find(url => !retained.has(url)) || value.entries.keys().next().value;
    if (!candidate) break;
    await remove(value, candidate);
  }
}
async function boundedPut(request, response) {
  const body = await response.arrayBuffer();
  if (body.byteLength > MAX_BYTES) return;
  const value = await state(), headers = new Headers(response.headers);
  // fetch() has already decoded HTTP transfer compression. This reconstructed
  // Response stores those decoded bytes, not the compressed network envelope.
  headers.delete('content-encoding');
  headers.set('content-length', String(body.byteLength));
  headers.set(BYTE_HEADER, String(body.byteLength));
  const stored = new Response(body, { status: response.status, statusText: response.statusText, headers });
  // Make room before writing, including for browsers with a small storage quota.
  await remove(value, request.url);
  value.entries.set(request.url, body.byteLength); value.bytes += body.byteLength;
  try {
    await trim(value);
    if (!value.entries.has(request.url)) return;
    await value.cache.put(request, stored);
  } catch (error) {
    value.bytes -= value.entries.get(request.url) || 0; value.entries.delete(request.url);
    throw error;
  }
}
async function promote(request, response) {
  const value = await state(), bytes = value.entries.get(request.url);
  if (bytes === undefined) return; // It may have been evicted by another write.
  await value.cache.delete(request);
  try {
    await value.cache.put(request, response);
    value.entries.delete(request.url); value.entries.set(request.url, bytes);
  } catch (error) {
    value.entries.delete(request.url); value.bytes -= bytes;
    throw error;
  }
}
async function cachedAsset(event, isMap, isShell) {
  const request = event.request;
  const refresh = request.cache === 'reload' || request.cache === 'no-cache';
  try {
    // Wait for a preceding successful fetch to finish storing its bytes.
    await cacheWork;
    if (!refresh && isMap) {
      const cached = await (await state()).cache.match(request);
      if (cached) { schedule(event, () => promote(request, cached.clone())); return cached; }
    }
    if (!refresh && isShell) {
      const cached = await (await caches.open(SHELL)).match(request);
      if (cached) {
        if (isMap) schedule(event, () => boundedPut(request, cached.clone()));
        return cached;
      }
    }
  } catch { /* CacheStorage is optional; use the network when unavailable. */ }

  // Switching scenes quickly can ask for the same tile twice before its first
  // response is cached. Share that transfer and return an independent body to
  // every caller. Detach a single caller's abort signal from the shared request.
  const transferKey = request.url + (refresh ? '|refresh' : '');
  let pending = inFlight.get(transferKey);
  if (!pending) {
    pending = fetch(request, { cache: httpCache(request), signal: null }).then(response => {
      if (response.status === 200 && !response.headers.has('content-range') && !/\bno-store\b/i.test(response.headers.get('cache-control') || '')) {
        const copy = response.clone();
        const written = isMap ? schedule(event, () => boundedPut(request, copy))
          : schedule(event, async () => { await (await caches.open(SHELL)).put(request, copy); });
        written.finally(() => { if (inFlight.get(transferKey) === pending) inFlight.delete(transferKey); });
      } else inFlight.delete(transferKey);
      return response;
    }, error => { inFlight.delete(transferKey); throw error; });
    inFlight.set(transferKey, pending);
  }
  return (await pending).clone();
}
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || !request.url.startsWith(self.registration.scope) || request.headers.has('range') || request.headers.has('authorization') || request.cache === 'no-store') return;
  const path = new URL(request.url).pathname.slice(new URL(self.registration.scope).pathname.length);
  const isMap = /^data\/(?:[^/]+\/)?(?:(?:index|foundation)\.json|meshes\/\d+\/[^/]+\.cvm|features\/[^/]+\.json)$/.test(path)
    || /^previews\/[a-z0-9.-]+\.[a-f0-9]{20}\.webp$/.test(path);
  const isShell = SHELL_URLS.has(request.url);
  if (request.mode === 'navigate') {
    // HTML remains fresh: a new page can discover a newly deployed release.
    event.respondWith(fetch(request, { cache: 'no-cache' }).catch(async error => {
      // The authoring page is a separate entry and is deliberately not installed
      // by ordinary viewers. Never disguise a missing editor as the public app.
      if (path !== '' && path !== 'index.html') throw error;
      const cached = await (await caches.open(SHELL)).match(local('index.html'));
      if (cached) return cached;
      throw error;
    }));
  } else if (isMap || isShell) event.respondWith(cachedAsset(event, isMap, isShell));
});
self.addEventListener('message', event => {
  if (event.data !== 'cache-status' || !event.ports[0]) return;
  event.waitUntil(cacheWork.catch(() => {}).then(async () => {
    const value = await state();
    event.ports[0].postMessage({ count: value.entries.size, bytes: value.bytes, maxFiles: MAX_FILES, maxBytes: MAX_BYTES, version: VERSION, policy: 'cache-first-visited-lru' });
  }));
});
