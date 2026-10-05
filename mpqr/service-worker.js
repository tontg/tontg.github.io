// Copyright 2026 Gilles Reant. SPDX-License-Identifier: Apache-2.0
const BASE = new URL('./', self.location.href);
const CACHE_PREFIX = `emvqr:${encodeURIComponent(BASE.pathname)}:`;
const CACHE_NAME = `${CACHE_PREFIX}0.10.0-v4`;
const ASSETS = [
  './', './index.html', './parser.html', './generator.html', './checkout.html', './validator.html', './render.html', './about.html', './test-set.html',
  './styles.css', './app.js', './generator.js', './checkout.js', './validator.js', './test-set.js',
  './CRC16.js', './emv-codec.js', './emv-analyzer.js', './emv.mjs', './emv-format.js', './emv-yaml.js',
  './qr-output.js', './qr-resizer.js', './qr-scanner.js', './qr-decoder.js', './qr-worker.js', './opencv-loader.js',
  './site-menu.js', './pwa.js', './manifest.webmanifest', './icons/app-icon.svg', './icons/favicon-192.png',
  './samples/valid-emvqr-without-crc.yaml', './samples/qr-test-set.yaml', './vendor/jsQR.js', './vendor/js-yaml.min.js', './vendor/qrcode-generator.js',
  './vendor/mcc-codes.js', './vendor/iso4217-codes.js', './vendor/iso3166-alpha2-codes.js', './vendor/iso639-language-codes.js',
];
const ASSET_URLS = new Set(ASSETS.map(path => new URL(path, BASE).href));
const OPTIONAL_URLS = new Set([new URL('./vendor/opencv.js', BASE).href]);
const TEST_SET_URL = new URL('./samples/qr-test-set.yaml', BASE).href;

self.addEventListener('install', event => {
  // Updates wait for existing tabs to close, avoiding mixed HTML/script versions.
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME) await caches.delete(name);
      // Migrate only this deployment's entries out of the old unscoped cache.
      if (/^emvqr-pwa-v\d+$/.test(name)) {
        const cache = await caches.open(name);
        for (const request of await cache.keys()) {
          const url = new URL(request.url); url.search = '';
          if (ASSET_URLS.has(url.href) || OPTIONAL_URLS.has(url.href)) await cache.delete(request);
        }
        if (!(await cache.keys()).length) await caches.delete(name);
      }
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== BASE.origin) return;
  url.search = '';
  const key = url.href;
  if (!ASSET_URLS.has(key) && !OPTIONAL_URLS.has(key)) return;
  const response = (async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(key);
    // Editable test data is network-first; retain the last fetched copy offline.
    if (key === TEST_SET_URL) {
      try {
        const fresh = await fetch(new Request(key, { credentials: 'same-origin', cache: 'no-cache' }));
        if (fresh.ok && fresh.type !== 'opaque') await cache.put(key, fresh.clone());
        return fresh;
      } catch (error) {
        if (cached) return cached;
        throw error;
      }
    }
    if (cached) return cached;
    // Static assets never depend on payment parameters. Do not transmit or store them.
    const fetched = await fetch(new Request(key, { credentials: 'same-origin' }));
    if (fetched.ok && fetched.type !== 'opaque') await cache.put(key, fetched.clone());
    return fetched;
  })();
  event.respondWith(response);
  event.waitUntil(response.then(() => undefined, () => undefined));
});
