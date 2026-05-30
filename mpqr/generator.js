(function () {
  const yamlInput = document.getElementById('yamlInput');
  const loadSampleButton = document.getElementById('loadSampleButton');
  const loadYamlFileButton = document.getElementById('loadYamlFileButton');
  const yamlFileInput = document.getElementById('yamlFileInput');
  const errorCorrectionSelect = document.getElementById('errorCorrectionSelect');
  const generatorStatus = document.getElementById('generatorStatus');
  const generatedChars = document.getElementById('generatedChars');
  const generatedBytes = document.getElementById('generatedBytes');
  const generatedCrc = document.getElementById('generatedCrc');
  const qrImage = document.getElementById('qrImage');
  const downloadQrSvgButton = document.getElementById('downloadQrSvgButton');
  const downloadQrPngButton = document.getElementById('downloadQrPngButton');
  const generatedTextTitle = document.getElementById('generatedTextTitle');
  const generatedText = document.getElementById('generatedText');
  const generatedHexTitle = document.getElementById('generatedHexTitle');
  const generatedHex = document.getElementById('generatedHex');
  const qrCellSize = 8;
  const qrQuietZoneModules = 2;
  let currentQrSvg = '';
  let generateTimer = null;

  function defaultGeneratorConfig() {
    return window.emvQrGeneratorConfig || { fields: [] };
  }

  function yamlScalar(value) {
    return JSON.stringify(String(value));
  }

  function renderConfigFields(fields, indent) {
    const lines = [];
    const prefix = ' '.repeat(indent);

    for (const field of fields || []) {
      const keys = Object.keys(field || {});
      if (keys.length !== 1) continue;
      const key = keys[0];
      const value = field[key];
      if (Array.isArray(value)) {
        lines.push(`${prefix}- ${yamlScalar(key)}:`);
        lines.push(...renderConfigFields(value, indent + 4));
      } else {
        lines.push(`${prefix}- ${yamlScalar(key)}: ${yamlScalar(value)}`);
      }
    }

    return lines;
  }

  function sampleYaml() {
    return [
      '# EMV Merchant-Presented QR sample.',
      '# Field 63 CRC is intentionally omitted; the generator appends 6304 + CRC.',
      'fields:',
      ...renderConfigFields(defaultGeneratorConfig().fields, 2),
      '',
    ].join('\n');
  }

  yamlInput.value = sampleYaml();
  if (window.emvQrOutput) window.emvQrOutput.initResizable(qrImage);

  function setStatus(message, type = 'info') {
    generatorStatus.textContent = message;
    generatorStatus.classList.toggle('error', type === 'error');
  }

  function normalizeFields(document) {
    if (Array.isArray(document)) return document;
    if (document && Array.isArray(document.fields)) return document.fields;
    throw new Error('YAML must be a sequence of fields or an object with a "fields" sequence.');
  }

  function normalizeId(id) {
    const text = String(id).trim();
    if (!/^\d{1,2}$/.test(text)) throw new Error(`Invalid field id "${id}". Use a one or two digit numeric ID.`);
    return text.padStart(2, '0');
  }

  function normalizeField(field) {
    if (!field || typeof field !== 'object' || Array.isArray(field)) {
      throw new Error('Each YAML field must be an object.');
    }

    if (Object.prototype.hasOwnProperty.call(field, 'id')) {
      return field;
    }

    const keys = Object.keys(field);
    if (keys.length !== 1) {
      throw new Error('Shorthand YAML fields must contain exactly one EMV ID key.');
    }

    const key = keys[0];
    const value = field[key];
    if (Array.isArray(value)) return { id: key, children: value };
    return { id: key, value };
  }

  function encodeLength(value, id) {
    const length = String(value).length;
    if (length > 99) throw new Error(`Field ${id} is ${length} characters long; EMV TLV length must fit in two digits.`);
    return String(length).padStart(2, '0');
  }

  function encodeField(field) {
    field = normalizeField(field);
    const id = normalizeId(field.id);

    let value;
    if (Array.isArray(field.children)) {
      value = field.children.map(encodeField).join('');
    } else if (Object.prototype.hasOwnProperty.call(field, 'value')) {
      value = String(field.value);
    } else {
      throw new Error(`Field ${id} must define either "value" or "children".`);
    }

    return `${id}${encodeLength(value, id)}${value}`;
  }

  function generateTextFromYaml(yamlText) {
    const document = jsyaml.load(yamlText);
    const fields = normalizeFields(document);
    const normalizedFields = fields.map(normalizeField);
    const fieldIds = normalizedFields.map(field => normalizeId(field.id));
    const crcIndex = fieldIds.indexOf('63');
    if (crcIndex !== -1 && crcIndex !== fieldIds.length - 1) {
      throw new Error('Field 63, when present, must be the final field.');
    }

    const encoded = normalizedFields.map(encodeField).join('');
    if (crcIndex === -1) {
      const crcInput = `${encoded}6304`;
      const crc = window.emvCore.computeCRC(crcInput);
      return { text: `${crcInput}${crc}`, crc };
    }

    const crcMatch = encoded.match(/6304([0-9A-Fa-f]{4})$/);
    if (crcMatch) {
      return { text: encoded, crc: crcMatch[1].toUpperCase() };
    }

    throw new Error('Field 63, when present, must be the final field with length 04 and a four-character CRC value.');
  }

  function renderQr(text) {
    const qr = qrcode(0, errorCorrectionSelect.value);
    qr.addData(text);
    qr.make();
    currentQrSvg = qr.createSvgTag(
      qrCellSize,
      qrCellSize * qrQuietZoneModules,
      'Generated EMV QR code',
      'Generated EMV QR code',
    );
    window.emvQrOutput.renderSvg(qrImage, currentQrSvg);
    downloadQrSvgButton.disabled = false;
    downloadQrPngButton.disabled = false;
  }

  function downloadQrSvg() {
    window.emvQrOutput.downloadSvg(currentQrSvg, `emv-merchant-qr-${generatedCrc.textContent || 'code'}.svg`);
  }

  function downloadQrPng() {
    window.emvQrOutput.downloadPngFromContainer(
      qrImage,
      currentQrSvg,
      `emv-merchant-qr-${generatedCrc.textContent || 'code'}.png`,
      () => setStatus('Unable to render PNG download.'),
    );
  }

  function generate() {
    try {
      const result = generateTextFromYaml(yamlInput.value);
      const bytes = new TextEncoder().encode(result.text);
      renderQr(result.text);
      generatedText.textContent = result.text;
      generatedHex.textContent = window.emvQrOutput.toHex(result.text);
      generatedChars.textContent = String(result.text.length);
      generatedBytes.textContent = String(bytes.length);
      generatedTextTitle.textContent = `Generated text (${result.text.length} chars)`;
      generatedHexTitle.textContent = `Generated hexadecimal string (${bytes.length} bytes)`;
      generatedCrc.textContent = result.crc;
      setStatus('QR code generated.');
    } catch (error) {
      setStatus(error.message, 'error');
      qrImage.innerHTML = '';
      currentQrSvg = '';
      downloadQrSvgButton.disabled = true;
      downloadQrPngButton.disabled = true;
      generatedText.textContent = '';
      generatedHex.textContent = '';
      generatedTextTitle.textContent = 'Generated text';
      generatedHexTitle.textContent = 'Generated hexadecimal string';
      generatedChars.textContent = '0';
      generatedBytes.textContent = '0';
      generatedCrc.textContent = '-';
    }
  }

  function scheduleGenerate() {
    window.clearTimeout(generateTimer);
    generateTimer = window.setTimeout(generate, 350);
  }

  yamlInput.addEventListener('input', scheduleGenerate);
  errorCorrectionSelect.addEventListener('change', generate);
  downloadQrSvgButton.addEventListener('click', downloadQrSvg);
  downloadQrPngButton.addEventListener('click', downloadQrPng);
  loadSampleButton.addEventListener('click', () => {
    yamlInput.value = sampleYaml();
    generate();
  });
  loadYamlFileButton.addEventListener('click', () => {
    yamlFileInput.click();
  });
  yamlFileInput.addEventListener('change', () => {
    const file = yamlFileInput.files && yamlFileInput.files[0];
    if (!file) return;
    if (file.size > 1024 * 1024) {
      setStatus('YAML file is too large. Maximum size is 1 MB.', 'error');
      yamlFileInput.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      yamlInput.value = String(reader.result || '');
      generate();
      yamlFileInput.value = '';
    };
    reader.onerror = () => {
      setStatus('Unable to read that YAML file.', 'error');
      yamlFileInput.value = '';
    };
    reader.readAsText(file);
  });

  generate();
}());
