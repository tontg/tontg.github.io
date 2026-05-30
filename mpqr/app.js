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
  const hexOutput = document.getElementById('hexOutput');
  const validationList = document.getElementById('validationList');
  const treeOutput = document.getElementById('treeOutput');
  const yamlOutput = document.getElementById('yamlOutput');
  const exportYamlButton = document.getElementById('exportYamlButton');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  let stream = null;
  let scanning = false;
  let lastPayload = '';
  let lastResult = null;
  let cvReady = Boolean(window.__cvReady);
  let previewUrl = '';

  window.addEventListener('opencv-ready', () => {
    cvReady = true;
    setStatus('OpenCV preprocessing is ready.');
  });

  function setStatus(message) {
    status.textContent = message;
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

  function decodeCanvas() {
    const original = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const variants = [original];
    const openCvVariant = preprocessWithOpenCv();
    if (openCvVariant) variants.push(openCvVariant);

    for (const imageData of variants) {
      const code = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: 'attemptBoth' });
      if (code && code.data) return code;
    }
    return null;
  }

  function decodeStillImage(image) {
    drawImageToCanvas(image);
    let payload = decodeCanvas();
    if (payload) return payload;

    drawImageToCanvas(image, { maxSide: 2800, scale: 2 });
    payload = decodeCanvas();
    if (payload) setStatus('QR decoded after oversampling the image.');
    return payload;
  }

  function parsePayload(payload, source, qrInfo = null) {
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
    renderResult(result);
  }

  function renderResult(result) {
    lastResult = result;
    validState.textContent = result.validation.valid ? 'true' : 'false';
    validState.style.color = result.validation.valid ? '#185c35' : '#8a2619';
    byteCount.textContent = String(result.byteCount);
    charCount.textContent = String(result.charCount);
    hexOutput.textContent = result.rawHex;
    renderValidation(result.validation);
    treeOutput.innerHTML = '';
    treeOutput.appendChild(renderTree(result.tree));
    yamlOutput.innerHTML = highlightYaml(buildYamlExport(result));
    exportYamlButton.disabled = result.tree.length === 0;
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
    return [
      '# EMV Merchant-Presented QR export.',
      '# Field order follows the parsed QR-Code content.',
      ...qrInfoYamlComments(result.qrInfo),
      `# nbchars: ${result.charCount}`,
      `# nbbytes: ${result.byteCount}`,
      `# hexastring: ${result.rawHex}`,
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

  function renderTree(nodes) {
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
        value.textContent = mcc ? `Value: ${node.value} (${mcc})` : `Value: ${node.value}`;
        li.appendChild(value);
      }
      if (node.children && node.children.length) li.appendChild(renderTree(node.children));
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
      const payload = decodeStillImage(image);
      parsePayload(payload && payload.data, file.name, qrMetadata(payload));
    };
    image.onerror = () => {
      clearImagePreview();
      setStatus('Unable to load that image file.');
    };
    image.src = previewUrl;
  });

  parseText.addEventListener('click', () => {
    parsePayload(payloadInput.value, 'text input');
  });

  exportYamlButton.addEventListener('click', exportYaml);

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
        parsePayload(payload.data, 'camera', qrMetadata(payload));
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
}());
