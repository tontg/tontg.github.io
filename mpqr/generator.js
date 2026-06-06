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
  const downloadQrWebpButton = document.getElementById('downloadQrWebpButton');
  const parseGeneratedTextButton = document.getElementById('parseGeneratedTextButton');
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

  function yamlFromFields(fields) {
    return [
      '# EMV Merchant-Presented QR content from URL parameter.',
      'fields:',
      ...renderConfigFields((fields || []).filter(field => !Object.prototype.hasOwnProperty.call(field || {}, '63')), 2),
      '',
    ].join('\n');
  }

  function hasTopLevelCrcField(fields) {
    return (fields || []).some(field => Object.prototype.hasOwnProperty.call(field || {}, '63'));
  }

  function withFixedTopLevelCrc(fields, crc) {
    return (fields || []).map(field => {
      if (Object.prototype.hasOwnProperty.call(field || {}, '63')) return { '63': crc };
      return field;
    });
  }

  function yamlDocumentFromFields(fields) {
    return [
      'fields:',
      ...renderConfigFields(fields, 2),
      '',
    ].join('\n');
  }

  function renderNodesToYaml(nodes, indent) {
    const lines = [];
    const prefix = ' '.repeat(indent);

    for (const node of nodes || []) {
      if (node.children && node.children.length) {
        lines.push(`${prefix}- ${yamlScalar(node.id)}:`);
        lines.push(...renderNodesToYaml(node.children, indent + 4));
      } else {
        lines.push(`${prefix}- ${yamlScalar(node.id)}: ${yamlScalar(node.value || '')}`);
      }
    }

    return lines;
  }

  yamlInput.value = sampleYaml();
  if (window.emvQrOutput) window.emvQrOutput.initResizable(qrImage);
  const webpSupported = Boolean(window.emvQrOutput && window.emvQrOutput.supportsWebp && window.emvQrOutput.supportsWebp());
  downloadQrWebpButton.hidden = !webpSupported;

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

  function toShorthandField(field) {
    field = normalizeField(field);
    const id = normalizeId(field.id);
    if (Array.isArray(field.children)) {
      return { [id]: field.children.map(toShorthandField) };
    }
    if (Object.prototype.hasOwnProperty.call(field, 'value')) {
      return { [id]: String(field.value) };
    }
    throw new Error(`Field ${id} must define either "value" or "children".`);
  }

  function parseYamlFields(yamlText) {
    const document = jsyaml.load(yamlText);
    const fields = normalizeFields(document);
    return fields.map(toShorthandField);
  }

  function loadQrFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const qr = params.get('qr');
    if (!qr) return false;
    if (!window.emvAnalyzer) throw new Error('EMV analyzer is not available.');
    const result = window.emvAnalyzer.analyzePayload(qr);
    yamlInput.value = [
      '# EMV Merchant-Presented QR content from URL parameter.',
      `# payload: ${String(qr).replace(/\r?\n/g, ' ')}`,
      'fields:',
      ...renderNodesToYaml((result.tree || []).filter(node => node.id !== '63'), 2),
      '',
    ].join('\n');
    return true;
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

  function downloadQrWebp() {
    window.emvQrOutput.downloadWebpFromContainer(
      qrImage,
      currentQrSvg,
      `emv-merchant-qr-${generatedCrc.textContent || 'code'}.webp`,
      () => setStatus('Unable to render WebP download.'),
    );
  }

  function openParserWithText() {
    const payload = String(generatedText.textContent || '').trim();
    if (!payload) return;
    window.location.href = `parser.html?qr=${encodeURIComponent(payload)}`;
  }

  function generate() {
    try {
      let fields = parseYamlFields(yamlInput.value);
      const result = window.MerchantPresentedQrCode.render(qrImage, fields, {
        altText: 'Generated EMV QR code',
        cellSize: qrCellSize,
        errorCorrection: errorCorrectionSelect.value,
        quietZoneModules: qrQuietZoneModules,
      });
      if (hasTopLevelCrcField(fields)) {
        fields = withFixedTopLevelCrc(fields, result.crc);
        const normalizedYaml = yamlDocumentFromFields(fields);
        if (yamlInput.value !== normalizedYaml) yamlInput.value = normalizedYaml;
      }
      currentQrSvg = result.svg;
      downloadQrSvgButton.disabled = false;
      downloadQrPngButton.disabled = false;
      downloadQrWebpButton.disabled = !webpSupported;
      parseGeneratedTextButton.disabled = false;
      generatedText.textContent = result.payload;
      generatedHex.textContent = result.hex;
      generatedChars.textContent = String(result.characters);
      generatedBytes.textContent = String(result.bytes);
      generatedTextTitle.textContent = `Generated text (${result.characters} chars)`;
      generatedHexTitle.textContent = `Generated hexadecimal string (${result.bytes} bytes)`;
      generatedCrc.textContent = result.crc;
      setStatus('QR code generated.');
    } catch (error) {
      setStatus(error.message, 'error');
      qrImage.innerHTML = '';
      currentQrSvg = '';
      downloadQrSvgButton.disabled = true;
      downloadQrPngButton.disabled = true;
      downloadQrWebpButton.disabled = true;
      parseGeneratedTextButton.disabled = true;
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
  downloadQrWebpButton.addEventListener('click', downloadQrWebp);
  parseGeneratedTextButton.addEventListener('click', openParserWithText);
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

  try {
    if (!loadQrFromUrl()) yamlInput.value = sampleYaml();
  } catch (error) {
    yamlInput.value = sampleYaml();
    setStatus(`Unable to load QR parameter: ${error.message}`, 'error');
  }

  generate();
}());
