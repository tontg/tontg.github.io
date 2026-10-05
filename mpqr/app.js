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
  let lastResult = null;
  let previewUrl = '';
  const scanner = window.emvScanner.createScanner();
  let activeController = null;

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

  function parsePayload(payload, source, qrInfo = null, elapsedSeconds = null) {
    const cleanPayload = String(payload || '');
    const startedAt = nowSeconds();
    if (!cleanPayload) {
      setStatus('No QR payload found.');
      return;
    }
    payloadInput.value = cleanPayload;
    setStatus(`Parsing payload from ${source}.`);
    const result = window.emvAnalyzer.analyzePayload(cleanPayload);
    result.qrInfo = qrInfo;
    result.elapsedSeconds = (elapsedSeconds || 0) + nowSeconds() - startedAt;
    maybeAddSlowScanWarning(result, source);
    renderResult(result);
  }

  function loadQrFromUrl() {
    const qr = window.emvFormat.qrParameter(window.location);
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

  const buildYamlExport = result => window.emvFormat.yamlExport(result);

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
    const payload = String(payloadInput.value || '');
    if (!payload) return;
    window.location.href = `generator.html#qr=${encodeURIComponent(payload)}`;
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
        const annotation = window.emvFormat.description(node.id, node.value, parentId);
        value.textContent = annotation ? `Value: ${node.value} (${annotation})` : `Value: ${node.value}`;
        li.appendChild(value);
      }
      if (node.children && node.children.length) li.appendChild(renderTree(node.children, node.id));
      ul.appendChild(li);
    }
    return ul;
  }

  function beginTask() {
    stopCameraStream('');
    clearImagePreview();
    lastResult = null;
    validState.textContent = '-';
    byteCount.textContent = charCount.textContent = '0';
    decodeSeconds.textContent = '0.000';
    hexOutput.textContent = yamlOutput.textContent = '';
    validationList.replaceChildren();
    treeOutput.replaceChildren();
    activeController = new AbortController();
    exportYamlButton.disabled = generateQrButton.disabled = true;
    return activeController;
  }

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    const controller = beginTask();
    clearImagePreview();
    const startedAt = nowSeconds();
    try {
      window.emvDecoder.checkFile(file);
      setStatus('Scanning image...');
      const decoded = await scanner.scanFile(file, { signal: controller.signal, useOpenCv: useOpenCv.checked });
      if (controller.signal.aborted) return;
      if (decoded.thumbnail) {
        previewUrl = URL.createObjectURL(decoded.thumbnail);
        showImagePreview(previewUrl);
      }
      parsePayload(decoded.code?.data, file.name, window.emvFormat.metadata(decoded.code), nowSeconds() - startedAt);
      if (decoded.warnings.length && lastResult && decoded.code) {
        lastResult.validation.warnings.push(...decoded.warnings);
        renderResult(lastResult);
      }
    } catch (error) {
      if (error.name !== 'AbortError') setStatus(error.message);
    }
  });

  parseText.addEventListener('click', () => {
    beginTask();
    try { parsePayload(payloadInput.value, 'text input', null, 0); }
    catch (error) { setStatus(error.message); }
  });

  exportYamlButton.addEventListener('click', exportYaml);
  generateQrButton.addEventListener('click', openGeneratorWithQr);

  startCamera.addEventListener('click', async () => {
    const controller = beginTask();
    startCamera.disabled = true;
    try {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new Error('Camera access requires HTTPS or localhost and getUserMedia support.');
      clearImagePreview();
      const acquired = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      if (controller.signal.aborted) { acquired.getTracks().forEach(track => track.stop()); return; }
      stream = acquired;
      videoWrap.hidden = false;
      video.srcObject = stream;
      await video.play();
      if (controller.signal.aborted) return;
      scanning = true;
      setStatus('Scanning camera frames.');
      requestAnimationFrame(() => scanFrame(controller));
    } catch (error) {
      if (controller.signal.aborted) return;
      stopCameraStream('');
      const message = `Camera unavailable: ${error.message}`;
      setStatus(message);
      window.alert(message);
    }
  });

  stopCamera.addEventListener('click', () => stopCameraStream('Camera stopped.'));

  async function scanFrame(controller) {
    if (!scanning || controller.signal.aborted) return;
    try {
      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        const startedAt = nowSeconds();
        let source;
        if (typeof createImageBitmap === 'function') source = await createImageBitmap(video);
        else {
          canvas.width = video.videoWidth; canvas.height = video.videoHeight;
          ctx.drawImage(video, 0, 0);
          source = canvas;
        }
        if (controller.signal.aborted) { source.close?.(); return; }
        const decoded = await scanner.scan(source, { signal: controller.signal, useOpenCv: useOpenCv.checked, camera: true });
        if (controller.signal.aborted) return;
        if (decoded.code) {
          parsePayload(decoded.code.data, 'camera', window.emvFormat.metadata(decoded.code), nowSeconds() - startedAt);
          stopCameraStream('Camera stopped after QR code parsing.');
          return;
        }
      }
      if (!controller.signal.aborted) requestAnimationFrame(() => scanFrame(controller));
    } catch (error) {
      if (error.name !== 'AbortError') stopCameraStream(error.message);
    }
  }

  function stopCameraStream(message) {
    activeController?.abort();
    scanning = false;
    stream?.getTracks().forEach(track => track.stop());
    stream = null;
    video.srcObject = null;
    videoWrap.hidden = true;
    startCamera.disabled = false;
    if (message) setStatus(message);
  }

  window.addEventListener('pagehide', () => { stopCameraStream(''); scanner.dispose(); clearImagePreview(); });
  try { loadQrFromUrl(); } catch (error) { setStatus(error.message); }
}());
