(function () {
  if (!('serviceWorker' in navigator)) return;
  if (window.location.protocol === 'file:') return;

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js').catch(() => {
      // PWA support is optional; the parser and generator work without it.
    });
  });
}());
