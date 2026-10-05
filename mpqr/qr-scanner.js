// Copyright 2026 Gilles Reant. SPDX-License-Identifier: Apache-2.0
(function (global) {
  async function loadImage(file, signal) {
    global.emvDecoder.checkFile(file);
    global.emvDecoder.checkAbort(signal);
    if (typeof createImageBitmap === 'function') {
      try {
        const bitmap = await createImageBitmap(file);
        if (signal?.aborted) { bitmap.close(); global.emvDecoder.checkAbort(signal); }
        return bitmap;
      } catch (error) { if (error.name === 'AbortError') throw error; }
    }
    return new Promise((resolve, reject) => {
      const image = new Image(), url = URL.createObjectURL(file);
      const clean = () => { URL.revokeObjectURL(url); signal?.removeEventListener('abort', abort); };
      const abort = () => { image.src = ''; clean(); reject(new DOMException('Scan cancelled.', 'AbortError')); };
      image.onload = () => { clean(); resolve(image); };
      image.onerror = () => { clean(); reject(new Error('Unable to load image.')); };
      signal?.addEventListener('abort', abort, { once: true });
      image.src = url;
    });
  }
  function createScanner() {
    let worker = null, busy = false;
    function dispose() { worker?.terminate(); worker = null; }
    async function scan(source, options = {}) {
      const signal = options.signal;
      if (signal?.aborted || busy) {
        source.close?.();
        global.emvDecoder.checkAbort(signal);
        throw new Error('A scan is already running.');
      }
      busy = true;
      try {
        if (location.protocol === 'file:' || typeof Worker !== 'function' || typeof OffscreenCanvas !== 'function' || typeof ImageBitmap !== 'function' || !(source instanceof ImageBitmap)) return await global.emvDecoder.decode(source, options);
        if (!worker) worker = new Worker('qr-worker.js');
        const target = worker;
        return await new Promise((resolve, reject) => {
          let timer;
          const clean = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); target.onmessage = target.onerror = null; };
          const fail = error => { clean(); dispose(); reject(error); };
          const abort = () => fail(new DOMException('Scan cancelled.', 'AbortError'));
          timer = setTimeout(() => fail(new Error('Image decoding exceeded the 45 second limit.')), 45000);
          signal?.addEventListener('abort', abort, { once: true });
          target.onmessage = ({ data }) => { clean(); data.error ? reject(Object.assign(new Error(data.error.message), { name: data.error.name })) : resolve(data.result); };
          target.onerror = event => { event.preventDefault(); fail(new Error('QR worker could not run. Check the site security policy.')); };
          target.postMessage({ bitmap: source, options: { useOpenCv: options.useOpenCv, camera: options.camera } }, [source]);
        });
      } finally { busy = false; source.close?.(); }
    }
    return { dispose, scan, async scanFile(file, options = {}) { return scan(await loadImage(file, options.signal), options); } };
  }
  global.emvScanner = { createScanner };
}(globalThis));
