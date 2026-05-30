(function () {
  const amountInput = document.getElementById('amountInput');
  const referenceInput = document.getElementById('referenceInput');
  const checkoutPermalink = document.getElementById('checkoutPermalink');
  const checkoutStatus = document.getElementById('checkoutStatus');
  const checkoutChars = document.getElementById('checkoutChars');
  const checkoutBytes = document.getElementById('checkoutBytes');
  const checkoutCrc = document.getElementById('checkoutCrc');
  const checkoutQrImage = document.getElementById('checkoutQrImage');
  const downloadCheckoutSvgButton = document.getElementById('downloadCheckoutSvgButton');
  const downloadCheckoutPngButton = document.getElementById('downloadCheckoutPngButton');
  const checkoutTextTitle = document.getElementById('checkoutTextTitle');
  const checkoutText = document.getElementById('checkoutText');
  const checkoutHexTitle = document.getElementById('checkoutHexTitle');
  const checkoutHex = document.getElementById('checkoutHex');

  const qrCellSize = 8;
  const qrQuietZoneModules = 2;
  let currentQrSvg = '';
  let renderTimer = null;

  if (window.emvQrOutput) window.emvQrOutput.initResizable(checkoutQrImage);

  function setStatus(message, type = 'info') {
    checkoutStatus.textContent = message;
    checkoutStatus.classList.toggle('error', type === 'error');
  }

  function normalizeAmountInput() {
    const normalized = amountInput.value.replace(/,/g, '.');
    if (normalized !== amountInput.value) amountInput.value = normalized;
    return normalized.trim();
  }

  function updatePermalink() {
    const url = new URL(window.location.href);
    url.search = '';
    const amount = normalizeAmountInput();
    const reference = referenceInput.value.trim();
    if (amount) url.searchParams.set('a', amount);
    if (reference) url.searchParams.set('l', reference);
    const currentPath = `${url.pathname}${url.search}`;
    window.history.replaceState(null, '', currentPath);
    checkoutPermalink.href = currentPath;
    checkoutPermalink.textContent = `${url.pathname.split('/').pop() || 'index.html'}${url.search}`;
  }

  function encodeLength(value, id) {
    const length = String(value).length;
    if (length > 99) throw new Error(`Field ${id} is ${length} characters long; EMV TLV length must fit in two digits.`);
    return String(length).padStart(2, '0');
  }

  function encodeField(id, value) {
    return `${id}${encodeLength(value, id)}${value}`;
  }

  function normalizeId(id) {
    const text = String(id).trim();
    if (!/^\d{1,2}$/.test(text)) throw new Error(`Invalid field id "${id}". Use a one or two digit numeric ID.`);
    return text.padStart(2, '0');
  }

  function checkoutConfig() {
    return window.emvQrCheckoutConfig || { fields: [] };
  }

  function resolveValue(value, dynamicValues) {
    if (value === '{{amount}}') return dynamicValues.amount;
    if (value === '{{reference}}') return dynamicValues.reference;
    return String(value);
  }

  function encodeConfiguredField(field, dynamicValues) {
    if (!field || typeof field !== 'object' || Array.isArray(field)) {
      throw new Error('Each configured checkout field must be an object.');
    }

    const keys = Object.keys(field);
    if (keys.length !== 1) {
      throw new Error('Each configured checkout field must contain exactly one EMV ID key.');
    }

    const id = normalizeId(keys[0]);
    const value = field[keys[0]];
    if (Array.isArray(value)) {
      const children = value
        .map(child => encodeConfiguredField(child, dynamicValues))
        .filter(Boolean)
        .join('');
      if (!children) return '';
      return encodeField(id, children);
    }

    const resolved = resolveValue(value, dynamicValues);
    if (resolved === '') return '';
    return encodeField(id, resolved);
  }

  function encodeConfiguredFields(fields, dynamicValues) {
    return (fields || [])
      .map(field => encodeConfiguredField(field, dynamicValues))
      .filter(Boolean);
  }

  function validateAmount(amount) {
    if (!amount) return '';
    if (!/^\d{1,13}(\.\d{1,2})?$/.test(amount)) {
      throw new Error('Amount must be numeric with up to two decimal places.');
    }
    return amount;
  }

  function buildPayload() {
    const amount = validateAmount(normalizeAmountInput());
    const reference = referenceInput.value.trim();
    const fields = encodeConfiguredFields(checkoutConfig().fields, { amount, reference });

    const crcInput = `${fields.join('')}6304`;
    const crc = window.emvCore.computeCRC(crcInput);
    return { text: `${crcInput}${crc}`, crc };
  }

  function renderQr(text) {
    const qr = qrcode(0, 'L');
    qr.addData(text);
    qr.make();
    currentQrSvg = qr.createSvgTag(
      qrCellSize,
      qrCellSize * qrQuietZoneModules,
      'Checkout EMV QR code',
      'Checkout EMV QR code',
    );
    window.emvQrOutput.renderSvg(checkoutQrImage, currentQrSvg);
    downloadCheckoutSvgButton.disabled = false;
    downloadCheckoutPngButton.disabled = false;
  }

  function render() {
    try {
      updatePermalink();
      const result = buildPayload();
      const bytes = new TextEncoder().encode(result.text);
      renderQr(result.text);
      checkoutText.textContent = result.text;
      checkoutHex.textContent = window.emvQrOutput.toHex(result.text);
      checkoutChars.textContent = String(result.text.length);
      checkoutBytes.textContent = String(bytes.length);
      checkoutCrc.textContent = result.crc;
      checkoutTextTitle.textContent = `Generated text (${result.text.length} chars)`;
      checkoutHexTitle.textContent = `Generated hexadecimal string (${bytes.length} bytes)`;
      setStatus('QR code generated.');
    } catch (error) {
      updatePermalink();
      setStatus(error.message, 'error');
      currentQrSvg = '';
      checkoutQrImage.innerHTML = '';
      downloadCheckoutSvgButton.disabled = true;
      downloadCheckoutPngButton.disabled = true;
      checkoutText.textContent = '';
      checkoutHex.textContent = '';
      checkoutChars.textContent = '0';
      checkoutBytes.textContent = '0';
      checkoutCrc.textContent = '-';
      checkoutTextTitle.textContent = 'Generated text';
      checkoutHexTitle.textContent = 'Generated hexadecimal string';
    }
  }

  function scheduleRender() {
    normalizeAmountInput();
    window.clearTimeout(renderTimer);
    renderTimer = window.setTimeout(render, 200);
  }

  function downloadSvg() {
    window.emvQrOutput.downloadSvg(currentQrSvg, `checkout-qr-${checkoutCrc.textContent || 'code'}.svg`);
  }

  function downloadPng() {
    window.emvQrOutput.downloadPngFromContainer(
      checkoutQrImage,
      currentQrSvg,
      `checkout-qr-${checkoutCrc.textContent || 'code'}.png`,
      () => setStatus('Unable to render PNG download.', 'error'),
    );
  }

  function loadFromUrl() {
    const params = new URLSearchParams(window.location.search);
    if (params.has('a')) amountInput.value = params.get('a') || '';
    if (params.has('l')) referenceInput.value = params.get('l') || '';
  }

  amountInput.addEventListener('input', scheduleRender);
  referenceInput.addEventListener('input', scheduleRender);
  downloadCheckoutSvgButton.addEventListener('click', downloadSvg);
  downloadCheckoutPngButton.addEventListener('click', downloadPng);

  loadFromUrl();
  render();
}());
