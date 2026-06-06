(function () {
  const fileInput = document.getElementById('fileInput');
  const startCamera = document.getElementById('startCamera');
  const stopCamera = document.getElementById('stopCamera');
  const useOpenCv = document.getElementById('useOpenCv');
  const videoWrap = document.getElementById('videoWrap');
  const video = document.getElementById('video');
  const canvas = document.getElementById('canvas');
  const imagePreview = document.getElementById('imagePreview');
  const payloadInput = document.getElementById('payloadInput');
  const parseText = document.getElementById('parseText');
  const status = document.getElementById('status');
  const validState = document.getElementById('validState');
  const byteCount = document.getElementById('byteCount');
  const charCount = document.getElementById('charCount');
  const decodeSeconds = document.getElementById('decodeSeconds');
  const hexOutput = document.getElementById('hexOutput');
  const validationList = document.getElementById('validationList');
  const treeOutput = document.getElementById('treeOutput');
  const yamlOutput = document.getElementById('yamlOutput');
  const exportYamlButton = document.getElementById('exportYamlButton');
  const generateQrButton = document.getElementById('generateQrButton');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  let stream = null;
  let scanning = false;
  let lastPayload = '';
  let lastResult = null;
  let cvReady = Boolean(window.__cvReady);
  let previewUrl = '';
  let scanStartedAt = 0;

  window.addEventListener('opencv-ready', () => {
    cvReady = true;
    setStatus('OpenCV preprocessing is ready.');
  });

  function setStatus(message) {
    status.textContent = message;
  }

  function nowSeconds() {
    return performance.now() / 1000;
  }

  function formatSeconds(value) {
    return Number.isFinite(value) ? value.toFixed(3) : '0.000';
  }

  function maybeAddSlowScanWarning(result, source) {
    if (!Number.isFinite(result.elapsedSeconds) || result.elapsedSeconds <= 1.5) return;
    if (source === 'text input') return;
    result.validation.warnings.push(`QR decoding took ${formatSeconds(result.elapsedSeconds)} s, which is slower than the 1.500 s warning threshold.`);
  }

  function clearImagePreview() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = '';
    imagePreview.innerHTML = '';
    imagePreview.hidden = true;
  }

  function showImagePreview(url) {
    const previewImage = document.createElement('img');
    previewImage.alt = 'Selected QR image preview';
    previewImage.src = url;
    imagePreview.innerHTML = '';
    imagePreview.appendChild(previewImage);
    imagePreview.hidden = false;
  }

  function drawImageToCanvas(image, options = {}) {
    const maxSide = options.maxSide || 1400;
    const scale = options.scale || 1;
    const sourceWidth = image.naturalWidth || image.videoWidth;
    const sourceHeight = image.naturalHeight || image.videoHeight;
    const ratio = Math.min(scale, maxSide / Math.max(sourceWidth, sourceHeight));
    const width = Math.max(1, Math.round(sourceWidth * ratio));
    const height = Math.max(1, Math.round(sourceHeight * ratio));
    canvas.width = width;
    canvas.height = height;
    ctx.imageSmoothingEnabled = scale <= 1;
    ctx.drawImage(image, 0, 0, width, height);
  }

  function drawRotatedImageToCanvas(image, angleDegrees, options = {}) {
    const maxSide = options.maxSide || 2800;
    const scale = options.scale || 1;
    const sourceWidth = image.naturalWidth || image.videoWidth;
    const sourceHeight = image.naturalHeight || image.videoHeight;
    const ratio = Math.min(scale, maxSide / Math.max(sourceWidth, sourceHeight));
    const width = Math.max(1, Math.round(sourceWidth * ratio));
    const height = Math.max(1, Math.round(sourceHeight * ratio));
    const radians = angleDegrees * Math.PI / 180;
    const cos = Math.abs(Math.cos(radians));
    const sin = Math.abs(Math.sin(radians));
    const targetWidth = Math.max(1, Math.ceil(width * cos + height * sin));
    const targetHeight = Math.max(1, Math.ceil(width * sin + height * cos));
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    ctx.save();
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, targetWidth, targetHeight);
    ctx.translate(targetWidth / 2, targetHeight / 2);
    ctx.rotate(radians);
    ctx.imageSmoothingEnabled = scale <= 1;
    ctx.drawImage(image, -width / 2, -height / 2, width, height);
    ctx.restore();
  }

  function grayscaleVariant(imageData) {
    const copy = new ImageData(new Uint8ClampedArray(imageData.data), imageData.width, imageData.height);
    for (let index = 0; index < copy.data.length; index += 4) {
      const gray = Math.round((copy.data[index] * 299 + copy.data[index + 1] * 587 + copy.data[index + 2] * 114) / 1000);
      copy.data[index] = gray;
      copy.data[index + 1] = gray;
      copy.data[index + 2] = gray;
      copy.data[index + 3] = 255;
    }
    return copy;
  }

  function thresholdVariant(imageData, threshold, contrast = 1) {
    const gray = grayscaleVariant(imageData);
    for (let index = 0; index < gray.data.length; index += 4) {
      const centered = (gray.data[index] - 128) * contrast + 128;
      const value = centered >= threshold ? 255 : 0;
      gray.data[index] = value;
      gray.data[index + 1] = value;
      gray.data[index + 2] = value;
      gray.data[index + 3] = 255;
    }
    return gray;
  }

  function tryDecodeWithJsQr(imageData) {
    return jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: 'attemptBoth' });
  }

  function decodeWithOpenCvDetector() {
    if (!useOpenCv.checked || !cvReady || !window.cv || typeof cv.QRCodeDetector !== 'function') return null;
    let src;
    let detector;
    try {
      src = cv.imread(canvas);
      detector = new cv.QRCodeDetector();
      const decoded = detector.detectAndDecode(src);
      if (typeof decoded === 'string' && decoded) return { data: decoded };
      if (Array.isArray(decoded) && typeof decoded[0] === 'string' && decoded[0]) return { data: decoded[0] };
      if (decoded && typeof decoded.data === 'string' && decoded.data) return { data: decoded.data };
      return null;
    } catch (error) {
      return null;
    } finally {
      if (detector) detector.delete();
      if (src) src.delete();
    }
  }

  function preprocessWithOpenCv() {
    if (!useOpenCv.checked || !cvReady || !window.cv || canvas.width === 0 || canvas.height === 0) return null;
    let src;
    let gray;
    let blurred;
    let thresh;
    try {
      src = cv.imread(canvas);
      gray = new cv.Mat();
      blurred = new cv.Mat();
      thresh = new cv.Mat();
      cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY, 0);
      cv.GaussianBlur(gray, blurred, new cv.Size(3, 3), 0, 0, cv.BORDER_DEFAULT);
      cv.adaptiveThreshold(blurred, thresh, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY, 31, 5);
      cv.imshow(canvas, thresh);
      return ctx.getImageData(0, 0, canvas.width, canvas.height);
    } catch (error) {
      setStatus(`OpenCV preprocessing skipped: ${error.message}`);
      return null;
    } finally {
      if (src) src.delete();
      if (gray) gray.delete();
      if (blurred) blurred.delete();
      if (thresh) thresh.delete();
    }
  }

  function decodeCanvas(tryHarder = false) {
    const original = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const variants = [original];
    const openCvVariant = preprocessWithOpenCv();
    if (openCvVariant) variants.push(openCvVariant);
    if (tryHarder) {
      variants.push(grayscaleVariant(original));
      variants.push(thresholdVariant(original, 128, 1.2));
      variants.push(thresholdVariant(original, 160, 1.5));
      variants.push(thresholdVariant(original, 192, 1.8));
    }

    for (const imageData of variants) {
      const code = tryDecodeWithJsQr(imageData);
      if (code && code.data) return code;
    }
    if (tryHarder) return decodeWithOpenCvDetector();
    return null;
  }

  function decodeStillImage(image) {
    drawImageToCanvas(image);
    let payload = decodeCanvas();
    if (payload) return payload;

    drawImageToCanvas(image, { maxSide: 2800, scale: 2 });
    payload = decodeCanvas(true);
    if (payload) {
      setStatus('QR decoded after oversampling the image.');
      return payload;
    }

    setStatus('Regular QR decode failed. Trying harder...');
    const angles = [0, -12, -8, -4, 4, 8, 12];
    for (const angle of angles) {
      drawRotatedImageToCanvas(image, angle, { maxSide: 3600, scale: 3 });
      payload = decodeCanvas(true);
      if (payload) {
        setStatus(angle === 0 ? 'QR decoded with try-harder image processing.' : `QR decoded with try-harder image processing at ${angle}\u00b0.`);
        return payload;
      }
    }
    return payload;
  }

  function parsePayload(payload, source, qrInfo = null, elapsedSeconds = null) {
    const cleanPayload = String(payload || '').trim();
    if (!cleanPayload) {
      setStatus('No QR payload found.');
      return;
    }
    if (cleanPayload === lastPayload && source === 'camera') return;
    lastPayload = cleanPayload;
    payloadInput.value = cleanPayload;
    setStatus(`Parsing payload from ${source}.`);
    const result = window.emvAnalyzer.analyzePayload(cleanPayload);
    result.qrInfo = qrInfo;
    result.elapsedSeconds = elapsedSeconds;
    maybeAddSlowScanWarning(result, source);
    renderResult(result);
  }

  function loadQrFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const qr = params.get('qr');
    if (!qr) return false;
    payloadInput.value = qr;
    parsePayload(qr, 'URL parameter', null, 0);
    return true;
  }

  function renderResult(result) {
    lastResult = result;
    validState.textContent = result.validation.valid ? 'true' : 'false';
    validState.style.color = result.validation.valid ? '#185c35' : '#8a2619';
    byteCount.textContent = String(result.byteCount);
    charCount.textContent = String(result.charCount);
    decodeSeconds.textContent = formatSeconds(result.elapsedSeconds);
    hexOutput.textContent = result.rawHex;
    renderValidation(result.validation);
    treeOutput.innerHTML = '';
    treeOutput.appendChild(renderTree(result.tree));
    yamlOutput.innerHTML = highlightYaml(buildYamlExport(result));
    exportYamlButton.disabled = result.tree.length === 0;
    generateQrButton.disabled = result.tree.length === 0;
    setStatus(result.validation.valid ? 'Parsed. Content is valid.' : 'Parsed. Validation errors found.');
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function highlightYamlLine(line) {
    if (line.startsWith('#')) {
      return `<span class="yaml-comment">${escapeHtml(line)}</span>`;
    }

    const fieldMatch = line.match(/^(\s*-\s*)("[^"]+")(:)(\s*)(.*)$/);
    if (fieldMatch) {
      return `${escapeHtml(fieldMatch[1])}<span class="yaml-key">${escapeHtml(fieldMatch[2])}</span>${escapeHtml(fieldMatch[3] + fieldMatch[4])}${highlightYamlValue(fieldMatch[5])}`;
    }

    const keyMatch = line.match(/^(\s*)([A-Za-z_][\w-]*)(:)(\s*)(.*)$/);
    if (keyMatch) {
      return `${escapeHtml(keyMatch[1])}<span class="yaml-key">${escapeHtml(keyMatch[2])}</span>${escapeHtml(keyMatch[3] + keyMatch[4])}${highlightYamlValue(keyMatch[5])}`;
    }

    return escapeHtml(line);
  }

  function highlightYamlValue(value) {
    if (!value) return '';
    if (/^".*"$/.test(value)) return `<span class="yaml-string">${escapeHtml(value)}</span>`;
    if (/^\d+$/.test(value)) return `<span class="yaml-number">${escapeHtml(value)}</span>`;
    return escapeHtml(value);
  }

  function highlightYaml(yamlText) {
    return yamlText.split('\n').map(highlightYamlLine).join('\n');
  }

  function yamlScalar(value) {
    return JSON.stringify(String(value));
  }

  function renderYamlNodes(nodes, indent) {
    const lines = [];
    const prefix = ' '.repeat(indent);

    for (const node of nodes) {
      if (node.children && node.children.length) {
        lines.push(`${prefix}- ${yamlScalar(node.id)}:`);
        lines.push(...renderYamlNodes(node.children, indent + 4));
      } else {
        lines.push(`${prefix}- ${yamlScalar(node.id)}: ${yamlScalar(node.value || '')}`);
      }
    }

    return lines;
  }

  function buildYamlExport(result) {
    const warningLines = result.validation.warnings.length
      ? result.validation.warnings.map(text => `#   - ${String(text).replace(/\r?\n/g, ' ')}`)
      : ['#   - none'];
    const errorLines = result.validation.errors.length
      ? result.validation.errors.map(text => `#   - ${String(text).replace(/\r?\n/g, ' ')}`)
      : ['#   - none'];

    return [
      '# Merchant-Presented QR-Code export.',
      '# Field order follows the parsed QR-Code content.',
      ...qrInfoYamlComments(result.qrInfo),
      `# payload: ${String(result.rawText || '').replace(/\r?\n/g, ' ')}`,
      `# nbchars: ${result.charCount}`,
      `# nbbytes: ${result.byteCount}`,
      `# decode_parse_seconds: ${formatSeconds(result.elapsedSeconds)}`,
      `# hexastring: ${result.rawHex}`,
      '# errors:',
      ...errorLines,
      '# warnings:',
      ...warningLines,
      'fields:',
      ...renderYamlNodes(result.tree, 2),
      '',
    ].join('\n');
  }

  function qrInfoYamlComments(qrInfo) {
    if (!qrInfo || !qrInfo.version) return [];
    if (!qrInfo.errorCorrectionLevel) return [`# qrcode: version ${qrInfo.version}`];
    return [`# qrcode: version ${qrInfo.version}/${qrInfo.errorCorrectionLevel}`];
  }

  function exportYaml() {
    if (!lastResult || !lastResult.tree.length) return;
    const blob = new Blob([buildYamlExport(lastResult)], { type: 'text/yaml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `emv-merchant-qr-${lastResult.validation.crc.actual || 'export'}.yaml`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function openGeneratorWithQr() {
    const payload = String(payloadInput.value || '').trim();
    if (!payload) return;
    window.location.href = `generator.html?qr=${encodeURIComponent(payload)}`;
  }

  function renderValidation(validation) {
    validationList.innerHTML = '';
    const items = [];
    if (validation.valid) items.push({ type: 'ok', text: 'Valid according to implemented EMV Merchant-Presented QR checks.' });
    validation.errors.forEach(text => items.push({ type: 'error', text }));
    validation.warnings
      .filter(text => text !== 'Payload contains characters outside printable ASCII.')
      .forEach(text => items.push({ type: 'warning', text }));
    items.push({ type: validation.crc.ok ? 'ok' : 'error', text: validation.crc.message });
    validation.checkedRules.forEach(text => items.push({ type: 'ok', text: `Checked: ${text}.` }));

    for (const item of items) {
      const li = document.createElement('li');
      li.className = item.type;
      li.textContent = item.text;
      validationList.appendChild(li);
    }
  }

  function mccDescription(value) {
    const mcc = String(value || '');
    if (!/^\d{4}$/.test(mcc) || !window.mccCodes) return '';
    return window.mccCodes[mcc] || '';
  }

  function currencyDescription(value) {
    const code = String(value || '');
    if (!/^\d{3}$/.test(code) || !window.iso4217Codes) return '';
    const entry = window.iso4217Codes[code];
    if (!entry) return '';
    return `${entry.alpha}, ${entry.name}`;
  }

  function countryDescription(value) {
    const code = String(value || '').trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(code) || !window.iso3166Alpha2Codes) return '';
    return window.iso3166Alpha2Codes[code] || '';
  }

  function languageDescription(value) {
    const code = String(value || '').trim().toLowerCase();
    if (!/^[a-z]{2}$/.test(code) || !window.iso639LanguageCodes) return '';
    return window.iso639LanguageCodes[code] || '';
  }

  function renderTree(nodes, parentId = null) {
    const ul = document.createElement('ul');
    if (!nodes.length) {
      const li = document.createElement('li');
      li.textContent = 'No TLV nodes parsed.';
      ul.appendChild(li);
      return ul;
    }
    for (const node of nodes) {
      const li = document.createElement('li');
      const line = document.createElement('div');
      line.className = 'node-line';
      const id = document.createElement('span');
      id.className = 'node-id';
      id.textContent = node.id;
      const label = document.createElement('span');
      label.textContent = `${node.name} `;
      const meta = document.createElement('span');
      meta.className = 'node-meta';
      meta.textContent = `(len ${node.length}, offset ${node.offset})`;
      line.append(id, label, meta);
      li.appendChild(line);
      if (node.value !== undefined) {
        const value = document.createElement('div');
        value.className = 'node-meta';
        const mcc = node.id === '52' ? mccDescription(node.value) : '';
        const currency = node.id === '53' ? currencyDescription(node.value) : '';
        const country = node.id === '58' ? countryDescription(node.value) : '';
        const language = parentId === '64' && node.id === '00' ? languageDescription(node.value) : '';
        const annotation = mcc || currency || country || language;
        value.textContent = annotation ? `Value: ${node.value} (${annotation})` : `Value: ${node.value}`;
        li.appendChild(value);
      }
      if (node.children && node.children.length) li.appendChild(renderTree(node.children, node.id));
      ul.appendChild(li);
    }
    return ul;
  }

  fileInput.addEventListener('change', () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    const image = new Image();
    clearImagePreview();
    previewUrl = URL.createObjectURL(file);
    showImagePreview(previewUrl);
    image.onload = async () => {
      const startedAt = nowSeconds();
      const payload = decodeStillImage(image);
      parsePayload(payload && payload.data, file.name, qrMetadata(payload), nowSeconds() - startedAt);
    };
    image.onerror = () => {
      clearImagePreview();
      setStatus('Unable to load that image file.');
    };
    image.src = previewUrl;
  });

  parseText.addEventListener('click', () => {
    const startedAt = nowSeconds();
    parsePayload(payloadInput.value, 'text input', null, nowSeconds() - startedAt);
  });

  exportYamlButton.addEventListener('click', exportYaml);
  generateQrButton.addEventListener('click', openGeneratorWithQr);

  startCamera.addEventListener('click', async () => {
    try {
      if (!window.isSecureContext || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Camera access requires HTTPS or localhost and a browser that supports getUserMedia.');
      }
      clearImagePreview();
      videoWrap.hidden = false;
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      video.srcObject = stream;
      await video.play();
      scanning = true;
      scanStartedAt = nowSeconds();
      setStatus('Scanning camera frames.');
      requestAnimationFrame(scanFrame);
    } catch (error) {
      videoWrap.hidden = true;
      const message = `Camera unavailable: ${error.message}`;
      setStatus(message);
      window.alert(message);
    }
  });

  stopCamera.addEventListener('click', () => {
    stopCameraStream('Camera stopped.');
  });

  function scanFrame() {
    if (!scanning) return;
    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const payload = decodeCanvas();
        if (payload) {
        parsePayload(payload.data, 'camera', qrMetadata(payload), Math.max(0, nowSeconds() - scanStartedAt));
        stopCameraStream('Camera stopped after QR code parsing.');
        return;
      }
    }
    requestAnimationFrame(scanFrame);
  }

  function stopCameraStream(message) {
    scanning = false;
    if (stream) stream.getTracks().forEach(track => track.stop());
    stream = null;
    scanStartedAt = 0;
    video.srcObject = null;
    videoWrap.hidden = true;
    setStatus(message);
  }

  function qrMetadata(code) {
    if (!code) return null;
    const ecMap = ['L', 'M', 'Q', 'H'];
    const ec = Number.isInteger(code.errorCorrectionLevel) ? ecMap[code.errorCorrectionLevel] : null;
    return {
      version: code.version || null,
      errorCorrectionLevel: ec,
    };
  }

  loadQrFromUrl();
}());
