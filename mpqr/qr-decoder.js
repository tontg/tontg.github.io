// Copyright 2026 Gilles Reant. SPDX-License-Identifier: Apache-2.0
(function (global) {
  const limits = Object.freeze({ fileBytes: 20 * 1024 * 1024, imagePixels: 32000000, batchFiles: 100, batchBytes: 100 * 1024 * 1024, zipBytes: 128 * 1024 * 1024 });
  const checkAbort = signal => { if (signal?.aborted) throw new DOMException('Scan cancelled.', 'AbortError'); };
  const pause = () => new Promise(resolve => setTimeout(resolve, 0));
  function checkFile(file) {
    if (file.size > limits.fileBytes) throw new RangeError('Image exceeds 20 MiB.');
    if (file.type && !/^image\//.test(file.type)) throw new TypeError('Select an image file.');
  }
  function checkBatch(files) {
    if (files.length > limits.batchFiles || files.reduce((sum, file) => sum + file.size, 0) > limits.batchBytes) throw new RangeError('A batch is limited to 100 files and 100 MiB.');
  }
  function variant(original, threshold, contrast = 1) {
    const data = new Uint8ClampedArray(original.data.length);
    for (let i = 0; i < data.length; i += 4) {
      let value = (original.data[i] * 299 + original.data[i + 1] * 587 + original.data[i + 2] * 114) / 1000;
      if (threshold !== undefined) value = (value - 128) * contrast + 128 >= threshold ? 255 : 0;
      data[i] = data[i + 1] = data[i + 2] = value;
      data[i + 3] = 255;
    }
    return { data, width: original.width, height: original.height };
  }
  function preprocess(original) {
    const cv = global.cv, mats = [];
    try {
      const src = cv.matFromImageData(original); mats.push(src);
      const gray = new cv.Mat(); mats.push(gray);
      const blur = new cv.Mat(); mats.push(blur);
      const threshold = new cv.Mat(); mats.push(threshold);
      const rgba = new cv.Mat(); mats.push(rgba);
      cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
      cv.GaussianBlur(gray, blur, new cv.Size(3, 3), 0, 0, cv.BORDER_DEFAULT);
      cv.adaptiveThreshold(blur, threshold, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY, 31, 5);
      cv.cvtColor(threshold, rgba, cv.COLOR_GRAY2RGBA);
      return { data: new Uint8ClampedArray(rgba.data), width: original.width, height: original.height };
    } finally { mats.reverse().forEach(mat => mat.delete()); }
  }
  function openCvDetect(original) {
    const cv = global.cv;
    if (typeof cv?.QRCodeDetector !== 'function') return null;
    const mats = [];
    let detector;
    try {
      const src = cv.matFromImageData(original); mats.push(src);
      const gray = new cv.Mat(); mats.push(gray);
      cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
      detector = new cv.QRCodeDetector();
      const decoded = detector.detectAndDecode(gray);
      const data = typeof decoded === 'string' ? decoded : Array.isArray(decoded) ? decoded[0] : decoded?.data;
      return typeof data === 'string' && data ? { data } : null;
    } catch { return null; }
    finally { detector?.delete(); mats.reverse().forEach(mat => mat.delete()); }
  }
  async function decode(source, options = {}) {
    const { signal, useOpenCv = false, camera = false } = options;
    const width = source.naturalWidth || source.videoWidth || source.width;
    const height = source.naturalHeight || source.videoHeight || source.height;
    if (!width || !height || width * height > limits.imagePixels) throw new RangeError('Image dimensions exceed the 32 megapixel limit.');
    const canvas = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(1, 1) : document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const warnings = [];
    let thumbnail = null;
    let cvAvailable = useOpenCv;
    const attempts = camera ? [[1400, 1, 0]] : [[1400, 1, 0], [2800, 2, 0], ...[0, -12, -8, -4, 4, 8, 12].map(angle => [3600, 3, angle])];
    const detect = image => {
      const code = global.jsQR(image.data, image.width, image.height, { inversionAttempts: 'attemptBoth' });
      return code?.data ? { data: code.data, version: code.version, errorCorrectionLevel: code.errorCorrectionLevel } : null;
    };
    try {
      if (!camera) {
        const ratio = Math.min(1, 160 / Math.max(width, height));
        canvas.width = Math.max(1, Math.round(width * ratio));
        canvas.height = Math.max(1, Math.round(height * ratio));
        ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
        thumbnail = canvas.convertToBlob ? await canvas.convertToBlob({ type: 'image/png' }) : await new Promise(resolve => canvas.toBlob(resolve));
      }
      for (let attempt = 0; attempt < attempts.length; attempt++) {
        checkAbort(signal);
        await pause();
        checkAbort(signal);
        const [maxSide, scale, angle] = attempts[attempt];
        const ratio = Math.min(scale, maxSide / Math.max(width, height));
        const w = Math.max(1, Math.round(width * ratio)), h = Math.max(1, Math.round(height * ratio));
        const radians = angle * Math.PI / 180;
        canvas.width = Math.ceil(w * Math.abs(Math.cos(radians)) + h * Math.abs(Math.sin(radians)));
        canvas.height = Math.ceil(w * Math.abs(Math.sin(radians)) + h * Math.abs(Math.cos(radians)));
        ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.save(); ctx.translate(canvas.width / 2, canvas.height / 2); ctx.rotate(radians);
        ctx.imageSmoothingEnabled = scale <= 1;
        ctx.drawImage(source, -w / 2, -h / 2, w, h); ctx.restore();
        const original = ctx.getImageData(0, 0, canvas.width, canvas.height);
        let code = detect(original);
        if (code) return { code, width, height, warnings, thumbnail };
        if (cvAvailable) {
          try {
            await global.loadEmvOpenCv(); checkAbort(signal);
            code = detect(preprocess(original));
            if (code) return { code, width, height, warnings, thumbnail };
          } catch (error) {
            checkAbort(signal);
            warnings.push(`OpenCV preprocessing unavailable: ${error.message}`);
            cvAvailable = false;
          }
        }
        if (attempt > 0) {
          for (const [threshold, contrast] of [[undefined, 1], [128, 1.2], [160, 1.5], [192, 1.8]]) {
            await pause(); checkAbort(signal);
            code = detect(variant(original, threshold, contrast));
            if (code) return { code, width, height, warnings, thumbnail };
          }
          if (cvAvailable) {
            code = openCvDetect(original);
            if (code) return { code, width, height, warnings, thumbnail };
          }
        }
      }
      return { code: null, width, height, warnings, thumbnail };
    } finally { canvas.width = canvas.height = 1; }
  }
  global.emvDecoder = { decode, limits, checkFile, checkBatch, checkAbort };
}(globalThis));
