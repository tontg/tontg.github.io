const CACHE_NAME = 'emvqr-pwa-v56';

const ASSETS = [
  './',
  './index.html',
  './parser.html',
  './about.html',
  './generator.html',
  './checkout.html',
  './render.html',
  './validator.html',
  './styles.css',
  './app.js',
  './generator.js',
  './checkout.js',
  './validator.js',
  './qr-output.js',
  './qr-resizer.js',
  './cbor-base64url.js',
  './site-menu.js',
  './CRC16.js',
  './emv-analyzer.js',
  './pwa.js',
  './manifest.webmanifest',
  './icons/app-icon.svg',
  './icons/favicon-192.png',
  './samples/valid-emvqr-without-crc.yaml',
  './vendor/jsQR.js',
  './vendor/js-yaml.min.js',
  './vendor/mcc-codes.js',
  './vendor/mcc-codes.LICENSE.txt',
  './vendor/iso4217-codes.js',
  './vendor/iso4217-codes.LICENSE.txt',
  './vendor/iso3166-alpha2-codes.js',
  './vendor/iso3166-alpha2-codes.LICENSE.txt',
  './vendor/iso639-language-codes.js',
  './vendor/iso639-language-codes.LICENSE.txt',
  './vendor/qrcode-generator.js',
  './vendor/opencv.js',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(names => Promise.all(names.filter(name => name !== CACHE_NAME).map(name => caches.delete(name))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', event => {
  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin || event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        if (!response.ok) return response;
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
        return response;
      });
    }),
  );
});
