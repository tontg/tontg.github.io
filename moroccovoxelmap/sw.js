/* A bounded, visited-only map cache. No geographic archives are prefetched. */
const VERSION = 'c46d276d45a6';
const SHELL = `casa-shell-${VERSION}`;
const DATA = `casa-data-${VERSION}`;
const SHELL_FILES = ["index.html","icon.svg","icon-192.png","icon-512.png","manifest.webmanifest","provenance.json","third-party-notices.json","data/regions.json","data/index.json","data/cfc/index.json","data/sidi-maarouf/index.json","assets/index-CirDaBeI.js","assets/index-DdYVUp2g.css"];
const MAX_FILES = 24;
const MAX_BYTES = 32 * 1024 * 1024;
let cacheWork = Promise.resolve();
const local = path => new URL(path, self.registration.scope).href;
self.addEventListener('install', event => {
  event.waitUntil(caches.open(SHELL).then(cache => Promise.all(SHELL_FILES.map(async path => {
    const response = await fetch(local(path), {cache:'reload'});
    if (response.ok) await cache.put(local(path), response);
  }))).then(()=>self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('casa-')&&key!==SHELL&&key!==DATA).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));
});
async function boundedPut(request, response) {
  const body = await response.clone().arrayBuffer();
  if (body.byteLength > MAX_BYTES) return;
  const cache = await caches.open(DATA);
  const headers = new Headers(response.headers); headers.set('x-casa-cache-bytes', String(body.byteLength));
  await cache.delete(request);
  await cache.put(request, new Response(body, {status:response.status,headers}));
  const keys = await cache.keys();
  let bytes = 0;
  for (const key of keys) { const value = await cache.match(key); bytes += Number(value.headers.get('x-casa-cache-bytes') || 0); }
  while (keys.length > MAX_FILES || bytes > MAX_BYTES) {
    const key = keys.shift(); if (!key) break;
    const value = await cache.match(key); bytes -= Number(value.headers.get('x-casa-cache-bytes') || 0);
    await cache.delete(key);
  }
}
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || !request.url.startsWith(self.registration.scope)) return;
  const path = request.url.slice(self.registration.scope.length).split('?')[0];
  const isMap = /^data\/(?:[^/]+\/)?(?:meshes\/\d+\/[^/]+\.cvm|features\/[^/]+\.json)$/.test(path);
  const isShell = SHELL_FILES.includes(path);
  if (!isMap && !isShell && request.mode !== 'navigate') return;
  event.respondWith((async()=>{
    try {
      const response = await fetch(request);
      if (response.ok && isMap) {
        const copy = response.clone();
        cacheWork = cacheWork.catch(()=>{}).then(()=>boundedPut(request,copy));
        event.waitUntil(cacheWork);
      }
      return response;
    } catch (error) {
      const cached = await caches.match(request) || (request.mode === 'navigate' ? await caches.match(local('index.html')) : undefined);
      if (cached) return cached;
      throw error;
    }
  })());
});
self.addEventListener('message', event => {
  if(event.data !== 'cache-status' || !event.ports[0]) return;
  event.waitUntil(cacheWork.catch(()=>{}).then(async()=>{
    const cache = await caches.open(DATA); const keys = await cache.keys(); let bytes = 0;
    for(const key of keys) {const value=await cache.match(key); if(value)bytes+=Number(value.headers.get('x-casa-cache-bytes')||0);}
    event.ports[0].postMessage({count:keys.length,bytes});
  }));
});
