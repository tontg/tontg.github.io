(function () {
  const buildMerchantPresentedPayload = (fields, options) => window.emvCodec.buildPayload(fields, options);
  const toHex = text => window.emvCodec.toHex(text);

  function renderSvg(container, svgText) {
    container.innerHTML = svgText;
    if (window.emvQrResizer) window.emvQrResizer.refresh(container);
  }

  function downloadSvg(svgText, filename) {
    if (!svgText) return;
    const blob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function renderRasterDownload(container, svgText, filename, mimeType, onError) {
    if (!svgText) return;
    const svgElement = container.querySelector('svg');
    if (!svgElement) return;
    const viewBox = svgElement.getAttribute('viewBox').split(/\s+/).map(Number);
    const width = viewBox[2];
    const height = viewBox[3];
    const image = new Image();
    const svgBlob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
    const svgUrl = URL.createObjectURL(svgBlob);

    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      context.fillStyle = '#fff';
      context.fillRect(0, 0, width, height);
      context.drawImage(image, 0, 0);
      URL.revokeObjectURL(svgUrl);
      const link = document.createElement('a');
      const dataUrl = canvas.toDataURL(mimeType);
      if (!dataUrl.startsWith(`data:${mimeType}`)) {
        if (onError) onError();
        return;
      }
      link.href = dataUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
    };

    image.onerror = () => {
      URL.revokeObjectURL(svgUrl);
      if (onError) onError();
    };

    image.src = svgUrl;
  }

  function downloadPngFromContainer(container, svgText, filename, onError) {
    renderRasterDownload(container, svgText, filename, 'image/png', onError);
  }

  function downloadWebpFromContainer(container, svgText, filename, onError) {
    renderRasterDownload(container, svgText, filename, 'image/webp', onError);
  }

  function supportsWebp() {
    const canvas = document.createElement('canvas');
    if (!canvas.toDataURL) return false;
    try {
      return canvas.toDataURL('image/webp').startsWith('data:image/webp');
    } catch (error) {
      return false;
    }
  }

  function initResizable(container) {
    if (window.emvQrResizer) window.emvQrResizer.initQrResizers();
    return container;
  }

  function resolveContainer(target) {
    if (!target) throw new Error('targetElement is required.');
    if (typeof target === 'string') {
      const node = document.querySelector(target);
      if (!node) throw new Error(`No element matches selector "${target}".`);
      return node;
    }
    if (target instanceof Element) return target;
    throw new Error('targetElement must be a DOM element or selector string.');
  }

  function renderMerchantPresentedQr(targetElement, fields, options = {}) {
    if (typeof qrcode !== 'function') {
      throw new Error('qrcode-generator is required. Load vendor/qrcode-generator.js before calling MerchantPresentedQrCode.render().');
    }
    if (!window.emvCore || typeof window.emvCore.computeCRC !== 'function') {
      throw new Error('CRC16.js is required. Load CRC16.js before calling MerchantPresentedQrCode.render().');
    }
    if (!window.emvCodec) throw new Error('Load emv-codec.js before calling MerchantPresentedQrCode.render().');

    const container = resolveContainer(targetElement);
    const cellSize = Number.isFinite(options.cellSize) ? options.cellSize : 8;
    const quietZoneModules = Number.isFinite(options.quietZoneModules) ? options.quietZoneModules : 2;
    const errorCorrection = String(options.errorCorrection || 'L').toUpperCase();
    const altText = options.altText || 'Merchant-Presented QR-Code';

    const { payload, crc, fields: normalizedFields } = buildMerchantPresentedPayload(fields, options);
    if (!/^[LMQH]$/.test(errorCorrection)) throw new TypeError('Invalid error correction level.');
    if (cellSize < 1 || cellSize > 32 || quietZoneModules < 0 || quietZoneModules > 16) throw new RangeError('QR dimensions are outside supported limits.');
    const qr = qrcode(0, errorCorrection);
    const previousEncoding = qrcode.stringToBytes;
    try {
      qrcode.stringToBytes = text => Array.from(new TextEncoder().encode(text));
      qr.addData(payload, 'Byte');
    } finally {
      qrcode.stringToBytes = previousEncoding;
    }
    qr.make();

    const svg = qr.createSvgTag(
      cellSize,
      cellSize * quietZoneModules,
      altText,
      altText,
    );

    renderSvg(container, svg);

    const bytes = new TextEncoder().encode(payload);
    const moduleCount = typeof qr.getModuleCount === 'function' ? qr.getModuleCount() : null;
    const version = Number.isInteger(moduleCount) ? Math.round((moduleCount - 17) / 4) : null;
    return {
      bytes: bytes.length,
      characters: window.emvCodec.characterCount(payload),
      crc,
      fields: normalizedFields,
      hex: toHex(payload),
      payload,
      svg,
      version,
    };
  }

  window.emvQrOutput = {
    buildMerchantPresentedPayload,
    downloadPngFromContainer,
    downloadSvg,
    downloadWebpFromContainer,
    initResizable,
    renderMerchantPresentedQr,
    renderSvg,
    supportsWebp,
    toHex,
  };

  window.MerchantPresentedQrCode = {
    Fields: window.emvCodec.Fields,
    AdditionalDataFields: window.emvCodec.AdditionalDataFields,
    LanguageFields: window.emvCodec.LanguageFields,
    TemplateFields: window.emvCodec.TemplateFields,
    render: renderMerchantPresentedQr,
  };
}());
