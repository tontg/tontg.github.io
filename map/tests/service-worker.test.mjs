import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../sw.js', import.meta.url), 'utf8');
const scope = 'https://example.test/map/';
function worker({ network = async () => new Response('new'), cached = new Response('old') } = {}) {
  const listeners = {}, deleted = [], writes = [], requests = [];
  const context = vm.createContext({
    URL, Request, AbortController, setTimeout, clearTimeout, console,
    self: { registration: { scope }, addEventListener: (name, cb) => { listeners[name] = cb; },
      clients: { claim: async () => {} }, skipWaiting: async () => {} },
    caches: {
      keys: async () => ['unrelated-site', 'geo-camera-map:https://example.test/other/:0.6.0',
        `geo-camera-map:${scope}:0.6.0`, `geo-camera-map:${scope}:0.8.0`, 'geo-camera-map-overlay-v2'],
      delete: async (key) => { deleted.push(key); },
      open: async () => ({ match: async () => cached?.clone(), put: async (req, res) => { writes.push([req.url, await res.text()]); }, addAll: async () => {} })
    },
    fetch: async (req, options) => { requests.push(options); return network(req); }
  });
  vm.runInContext(source, context);
  return { listeners, deleted, writes, requests };
}

test('activation only removes owned old caches', async () => {
  const w = worker();
  let completion;
  w.listeners.activate({ waitUntil: (promise) => { completion = promise; } });
  await completion;
  assert.deepEqual(w.deleted.sort(), [`geo-camera-map:${scope}:0.6.0`, 'geo-camera-map-overlay-v2'].sort());
});

function request(w, url, method = 'GET') {
  let response;
  w.listeners.fetch({ request: new Request(url, { method }), respondWith: (promise) => { response = promise; } });
  return response;
}

test('app files use network-first, refreshing previously cached releases', async () => {
  const w = worker();
  assert.equal(await (await request(w, scope + 'app.js')).text(), 'new');
  assert.equal(w.requests[0].cache, 'no-cache');
  assert.equal(w.writes.length, 1);
});

test('offline app files fall back to cache; pinned CDN files are cache-first', async () => {
  const offline = worker({ network: async () => { throw new Error('offline'); } });
  assert.equal(await (await request(offline, scope + 'data/targets.json')).text(), 'old');
  const cdn = worker();
  assert.equal(await (await request(cdn, 'https://unpkg.com/three@0.162.0/build/three.module.js')).text(), 'old');
  assert.equal(cdn.requests.length, 0);
});

test('does not intercept sibling apps, arbitrary APIs, tiles, query variants or writes', () => {
  const w = worker();
  for (const url of ['https://example.test/private', scope + 'api/user', scope + 'app.js?token=secret',
    'https://tile.openstreetmap.org/17/0/0.png', 'https://unpkg.com/other-module']) {
    assert.equal(request(w, url), undefined);
  }
  assert.equal(request(w, scope + 'app.js', 'POST'), undefined);
});
