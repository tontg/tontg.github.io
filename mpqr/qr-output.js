(function () {
  function normalizeId(id) {
    const text = String(id).trim();
    if (!/^\d{1,2}$/.test(text)) {
      throw new Error(`Invalid EMV field id "${id}". Use a one or two digit numeric ID.`);
    }
    return text.padStart(2, '0');
  }

  function encodeLength(value, id) {
    const length = value.length;
    if (length > 99) {
      throw new Error(`Field ${id} is ${length} characters long; EMV TLV length must fit in two digits.`);
    }
    return String(length).padStart(2, '0');
  }

  function encodeField(id, value) {
    return `${id}${encodeLength(value, id)}${value}`;
  }

  function cloneFields(fields) {
    return (fields || []).map(field => {
      if (!field || typeof field !== 'object' || Array.isArray(field)) {
        throw new Error('Each EMV field must be an object with exactly one ID key.');
      }

      const keys = Object.keys(field);
      if (keys.length !== 1) {
        throw new Error('Each EMV field must contain exactly one ID key.');
      }

      const key = keys[0];
      const value = field[key];
      if (Array.isArray(value)) return { [key]: cloneFields(value) };
      return { [key]: String(value) };
    });
  }

  function hasTopLevelField(fields, wantedId) {
    return fields.some(field => normalizeId(Object.keys(field)[0]) === wantedId);
  }

  function removeTopLevelField(fields, wantedId) {
    return fields.filter(field => normalizeId(Object.keys(field)[0]) !== wantedId);
  }

  function ensureMandatoryTopLevelFields(fields) {
    const nextFields = cloneFields(fields);
    if (!hasTopLevelField(nextFields, '00')) nextFields.unshift({ '00': '01' });
    if (!hasTopLevelField(nextFields, '01')) {
      const pfiIndex = nextFields.findIndex(field => normalizeId(Object.keys(field)[0]) === '00');
      const insertIndex = pfiIndex >= 0 ? pfiIndex + 1 : 0;
      nextFields.splice(insertIndex, 0, { '01': '11' });
    }
    return nextFields;
  }

  function encodeConfiguredField(field) {
    if (!field || typeof field !== 'object' || Array.isArray(field)) {
      throw new Error('Each EMV field must be an object with exactly one ID key.');
    }

    const keys = Object.keys(field);
    if (keys.length !== 1) {
      throw new Error('Each EMV field must contain exactly one ID key.');
    }

    const id = normalizeId(keys[0]);
    const value = field[keys[0]];
    if (Array.isArray(value)) {
      return encodeField(id, value.map(encodeConfiguredField).join(''));
    }
    return encodeField(id, String(value));
  }

  function buildMerchantPresentedPayload(fields, options = {}) {
    if (!Array.isArray(fields)) {
      throw new Error('fields must be an array of EMV field objects.');
    }

    const preserveExistingCrc = options.preserveExistingCrc === true;
    const preparedFields = ensureMandatoryTopLevelFields(cloneFields(fields));
    const fieldIds = preparedFields.map(field => normalizeId(Object.keys(field)[0]));
    const crcIndex = fieldIds.indexOf('63');

    if (!preserveExistingCrc || crcIndex === -1) {
      const fieldsWithoutCrc = removeTopLevelField(preparedFields, '63');
      const payloadWithoutCrc = fieldsWithoutCrc.map(encodeConfiguredField).join('');
      const crcInput = `${payloadWithoutCrc}6304`;
      const crc = window.emvCore.computeCRC(crcInput);
      return {
        crc,
        fields: fieldsWithoutCrc,
        payload: `${crcInput}${crc}`,
      };
    }

    if (crcIndex !== preparedFields.length - 1) {
      throw new Error('Field 63, when present, must be the final field.');
    }

    const encoded = preparedFields.map(encodeConfiguredField).join('');
    const crcMatch = encoded.match(/6304([0-9A-Fa-f]{4})$/);
    if (!crcMatch) {
      throw new Error('Field 63, when present, must be the final field with length 04 and a four-character CRC value.');
    }

    return {
      crc: crcMatch[1].toUpperCase(),
      fields: preparedFields,
      payload: encoded,
    };
  }

  function toHex(text) {
    return Array.from(new TextEncoder().encode(text))
      .map(byte => byte.toString(16).toUpperCase().padStart(2, '0'))
      .join(' ');
  }

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

    const container = resolveContainer(targetElement);
    const cellSize = Number.isFinite(options.cellSize) ? options.cellSize : 8;
    const quietZoneModules = Number.isFinite(options.quietZoneModules) ? options.quietZoneModules : 2;
    const errorCorrection = String(options.errorCorrection || 'L').toUpperCase();
    const altText = options.altText || 'Merchant-Presented QR-Code';

    const { payload, crc, fields: normalizedFields } = buildMerchantPresentedPayload(fields, options);
    const qr = qrcode(0, errorCorrection);
    qr.addData(payload);
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
      characters: payload.length,
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
    render: renderMerchantPresentedQr,
  };
}());
