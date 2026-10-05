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
  const downloadCheckoutWebpButton = document.getElementById('downloadCheckoutWebpButton');
  const checkoutTextTitle = document.getElementById('checkoutTextTitle');
  const checkoutText = document.getElementById('checkoutText');
  const checkoutHexTitle = document.getElementById('checkoutHexTitle');
  const checkoutHex = document.getElementById('checkoutHex');

  const qrCellSize = 8;
  const qrQuietZoneModules = 2;
  let currentQrSvg = '';
  let renderTimer = null;
  const webpSupported = Boolean(window.emvQrOutput && window.emvQrOutput.supportsWebp && window.emvQrOutput.supportsWebp());

  if (window.emvQrOutput) window.emvQrOutput.initResizable(checkoutQrImage);
  downloadCheckoutWebpButton.hidden = !webpSupported;

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
    const params = new URLSearchParams();
    if (amount) params.set('a', amount);
    if (reference) params.set('l', reference);
    url.hash = params.toString();
    const currentPath = `${url.pathname}${url.hash}`;
    window.history.replaceState(null, '', currentPath);
    checkoutPermalink.href = currentPath;
    checkoutPermalink.textContent = `${url.pathname.split('/').pop() || 'index.html'}${url.hash}`;
  }

  function configuredFields() {
    const values = { '{{amount}}': normalizeAmountInput(), '{{reference}}': referenceInput.value.trim() };
    if (values['{{amount}}'] && (!/^\d+(\.\d*)?$/.test(values['{{amount}}']) || values['{{amount}}'].length > 13 || Number(values['{{amount}}']) <= 0)) throw new Error('Amount must be positive, numeric, and at most 13 characters.');
    function resolve(fields) {
      return fields.flatMap(field => {
        const [id, value] = Object.entries(field)[0];
        const resolved = Array.isArray(value) ? resolve(value) : Object.hasOwn(values, value) ? values[value] : value;
        return resolved === '' || (Array.isArray(resolved) && !resolved.length) ? [] : [{ [id]: resolved }];
      });
    }
    return resolve(window.emvCodec.normalizeFields(window.emvQrCheckoutConfig?.fields || []));
  }

  function render() {
    try {
      updatePermalink();
      const result = window.MerchantPresentedQrCode.render(checkoutQrImage, configuredFields(), { cellSize: qrCellSize, quietZoneModules: qrQuietZoneModules, altText: 'Checkout EMV QR code' });
      currentQrSvg = result.svg;
      downloadCheckoutSvgButton.disabled = downloadCheckoutPngButton.disabled = false;
      checkoutText.textContent = result.payload;
      checkoutHex.textContent = window.emvQrOutput.toHex(result.payload);
      checkoutChars.textContent = String(result.characters);
      checkoutBytes.textContent = String(result.bytes);
      checkoutCrc.textContent = result.crc;
      downloadCheckoutWebpButton.disabled = !webpSupported;
      checkoutTextTitle.textContent = `Generated text (${result.characters} chars)`;
      checkoutHexTitle.textContent = `Generated hexadecimal string (${result.bytes} bytes)`;
      setStatus('QR code generated.');
    } catch (error) {
      updatePermalink();
      setStatus(error.message, 'error');
      currentQrSvg = '';
      checkoutQrImage.innerHTML = '';
      downloadCheckoutSvgButton.disabled = true;
      downloadCheckoutPngButton.disabled = true;
      downloadCheckoutWebpButton.disabled = true;
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

  function downloadWebp() {
    window.emvQrOutput.downloadWebpFromContainer(
      checkoutQrImage,
      currentQrSvg,
      `checkout-qr-${checkoutCrc.textContent || 'code'}.webp`,
      () => setStatus('Unable to render WebP download.', 'error'),
    );
  }

  function loadFromUrl() {
    const params = new URLSearchParams(window.location.hash.slice(1) || window.location.search);
    if (params.has('a')) amountInput.value = params.get('a') || '';
    if (params.has('l')) referenceInput.value = params.get('l') || '';
  }

  amountInput.addEventListener('input', scheduleRender);
  referenceInput.addEventListener('input', scheduleRender);
  downloadCheckoutSvgButton.addEventListener('click', downloadSvg);
  downloadCheckoutPngButton.addEventListener('click', downloadPng);
  downloadCheckoutWebpButton.addEventListener('click', downloadWebp);

  loadFromUrl();
  render();
}());
