(function () {
  const validatorFiles = document.getElementById('validatorFiles');
  const validatorUseOpenCv = document.getElementById('validatorUseOpenCv');
  const validatorDisplayFilter = document.getElementById('validatorDisplayFilter');
  const downloadValidatorZipButton = document.getElementById('downloadValidatorZipButton');
  const printValidatorButton = document.getElementById('printValidatorButton');
  const validatorStatus = document.getElementById('validatorStatus');
  const validatorTotal = document.getElementById('validatorTotal');
  const validatorValid = document.getElementById('validatorValid');
  const validatorInvalid = document.getElementById('validatorInvalid');
  const validatorRows = document.getElementById('validatorRows');
  const validatorCanvas = document.getElementById('validatorCanvas');
  const ctx = validatorCanvas.getContext('2d', { willReadFrequently: true });

  let cvReady = Boolean(window.__cvReady);
  let runId = 0;
  let latestResults = [];

  window.addEventListener('opencv-ready', () => {
    cvReady = true;
    setStatus('OpenCV preprocessing is ready.');
  });

  function setStatus(message, type = 'info') {
    validatorStatus.textContent = message;
    validatorStatus.classList.toggle('error', type === 'error');
  }

  function drawImageToCanvas(image, options = {}) {
    const maxSide = options.maxSide || 1400;
    const scale = options.scale || 1;
    const sourceWidth = image.naturalWidth;
    const sourceHeight = image.naturalHeight;
    const ratio = Math.min(scale, maxSide / Math.max(sourceWidth, sourceHeight));
    const width = Math.max(1, Math.round(sourceWidth * ratio));
    const height = Math.max(1, Math.round(sourceHeight * ratio));
    validatorCanvas.width = width;
    validatorCanvas.height = height;
    ctx.imageSmoothingEnabled = scale <= 1;
    ctx.drawImage(image, 0, 0, width, height);
  }

  function preprocessWithOpenCv() {
    if (!validatorUseOpenCv.checked || !cvReady || !window.cv || validatorCanvas.width === 0 || validatorCanvas.height === 0) return null;
    let src;
    let gray;
    let blurred;
    let thresh;
    try {
      src = cv.imread(validatorCanvas);
      gray = new cv.Mat();
      blurred = new cv.Mat();
      thresh = new cv.Mat();
      cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY, 0);
      cv.GaussianBlur(gray, blurred, new cv.Size(3, 3), 0, 0, cv.BORDER_DEFAULT);
      cv.adaptiveThreshold(blurred, thresh, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY, 31, 5);
      cv.imshow(validatorCanvas, thresh);
      return ctx.getImageData(0, 0, validatorCanvas.width, validatorCanvas.height);
    } catch (error) {
      return null;
    } finally {
      if (src) src.delete();
      if (gray) gray.delete();
      if (blurred) blurred.delete();
      if (thresh) thresh.delete();
    }
  }

  function decodeCanvas() {
    const original = ctx.getImageData(0, 0, validatorCanvas.width, validatorCanvas.height);
    const variants = [original];
    const openCvVariant = preprocessWithOpenCv();
    if (openCvVariant) variants.push(openCvVariant);

    for (const imageData of variants) {
      const code = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: 'attemptBoth' });
      if (code && code.data) return code;
    }
    return null;
  }

  function decodeImage(image) {
    drawImageToCanvas(image);
    let code = decodeCanvas();
    if (code) return code;

    drawImageToCanvas(image, { maxSide: 2800, scale: 2 });
    code = decodeCanvas();
    return code;
  }

  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => {
        URL.revokeObjectURL(url);
        resolve({ image, url });
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Unable to load image.'));
      };
      image.src = url;
    });
  }

  function thumbnail(file) {
    const url = URL.createObjectURL(file);
    const img = document.createElement('img');
    img.alt = `${file.name} thumbnail`;
    img.src = url;
    img.onload = () => URL.revokeObjectURL(url);
    img.onerror = () => URL.revokeObjectURL(url);
    return img;
  }

  function appendMessageList(cell, messages, className) {
    if (!messages.length) return;
    const ul = document.createElement('ul');
    ul.className = `validator-messages ${className}`;
    for (const message of messages) {
      const li = document.createElement('li');
      li.textContent = message;
      ul.appendChild(li);
    }
    cell.appendChild(ul);
  }

  function renderRow(result) {
    const row = document.createElement('tr');
    row.className = result.valid ? 'valid-row' : 'invalid-row';

    const name = document.createElement('td');
    name.textContent = result.file.name;
    row.appendChild(name);

    const thumb = document.createElement('td');
    thumb.className = 'thumbnail-cell';
    thumb.appendChild(thumbnail(result.file));
    row.appendChild(thumb);

    const qr = document.createElement('td');
    qr.textContent = result.qrFound ? 'yes' : 'no';
    row.appendChild(qr);

    const valid = document.createElement('td');
    valid.textContent = result.valid ? 'true' : 'false';
    row.appendChild(valid);

    const bytes = document.createElement('td');
    bytes.textContent = result.byteCount === null ? '-' : String(result.byteCount);
    row.appendChild(bytes);

    const errors = document.createElement('td');
    errors.textContent = String(result.errors.length);
    row.appendChild(errors);

    const warnings = document.createElement('td');
    warnings.textContent = String(result.warnings.length);
    row.appendChild(warnings);

    const messages = document.createElement('td');
    appendMessageList(messages, result.errors, 'error');
    appendMessageList(messages, result.warnings, 'warning');
    if (!result.errors.length && !result.warnings.length) messages.textContent = 'OK';
    row.appendChild(messages);

    return row;
  }

  function visibleResults(results) {
    const filter = validatorDisplayFilter.value;
    if (filter === 'valid') return results.filter(result => result.valid);
    if (filter === 'invalid') return results.filter(result => !result.valid);
    return results;
  }

  function renderResultsTable(results) {
    const rows = visibleResults(results);
    validatorRows.innerHTML = '';

    if (!results.length) {
      validatorRows.innerHTML = '<tr><td colspan="8">No files selected.</td></tr>';
      return;
    }

    if (!rows.length) {
      validatorRows.innerHTML = '<tr><td colspan="8">No files match the selected display filter.</td></tr>';
      return;
    }

    const fragment = document.createDocumentFragment();
    rows.forEach(result => fragment.appendChild(renderRow(result)));
    validatorRows.appendChild(fragment);
  }

  function yamlScalar(value) {
    return JSON.stringify(String(value));
  }

  function yamlComment(value) {
    return String(value || '').replace(/\r?\n/g, ' ');
  }

  function renderYamlNodes(nodes, indent) {
    const lines = [];
    const prefix = ' '.repeat(indent);

    for (const node of nodes || []) {
      if (node.children && node.children.length) {
        lines.push(`${prefix}- ${yamlScalar(node.id)}:`);
        lines.push(...renderYamlNodes(node.children, indent + 4));
      } else {
        lines.push(`${prefix}- ${yamlScalar(node.id)}: ${yamlScalar(node.value || '')}`);
      }
    }

    return lines;
  }

  function countNodes(nodes) {
    let total = 0;
    for (const node of nodes || []) {
      total += 1;
      if (node.children && node.children.length) total += countNodes(node.children);
    }
    return total;
  }

  function resultToYaml(result) {
    const lines = [
      '# EMV Merchant-Presented QR validation export.',
      `# source_file: ${yamlComment(result.file.name)}`,
      `# qr_found: ${result.qrFound ? 'true' : 'false'}`,
      `# emv_valid: ${result.valid ? 'true' : 'false'}`,
      `# nb_errors: ${result.errors.length}`,
      `# nb_warnings: ${result.warnings.length}`,
    ];

    if (result.byteCount !== null) lines.push(`# nbbytes: ${result.byteCount}`);
    if (result.charCount !== null) lines.push(`# nbchars: ${result.charCount}`);
    if (result.rawHex) lines.push(`# hexastring: ${result.rawHex}`);

    lines.push('# errors:');
    if (result.errors.length) {
      result.errors.forEach(error => lines.push(`#   - ${yamlComment(error)}`));
    } else {
      lines.push('#   - none');
    }

    lines.push('# warnings:');
    if (result.warnings.length) {
      result.warnings.forEach(warning => lines.push(`#   - ${yamlComment(warning)}`));
    } else {
      lines.push('#   - none');
    }

    lines.push('fields:');
    lines.push(...renderYamlNodes(result.tree, 2));
    lines.push('');
    return lines.join('\n');
  }

  function renderMarkdownNodes(nodes, indent = 0) {
    const lines = [];
    const prefix = `${'  '.repeat(indent)}- `;

    for (const node of nodes || []) {
      lines.push(`${prefix}**${node.id}** ${node.name} _(len ${node.length}, offset ${node.offset})_`);
      if (node.value !== undefined) {
        lines.push(`${'  '.repeat(indent + 1)}- Value: \`${String(node.value || '').replace(/`/g, '\\`')}\``);
      }
      if (node.children && node.children.length) {
        lines.push(...renderMarkdownNodes(node.children, indent + 1));
      }
    }

    return lines;
  }

  function resultToMarkdown(result) {
    const lines = [
      '# EMV Merchant-Presented QR validation export',
      '',
      `- Source file: \`${result.file.name}\``,
      `- QR found: \`${result.qrFound ? 'true' : 'false'}\``,
      `- EMV valid: \`${result.valid ? 'true' : 'false'}\``,
      `- Errors: \`${result.errors.length}\``,
      `- Warnings: \`${result.warnings.length}\``,
    ];

    if (result.byteCount !== null) lines.push(`- Bytes: \`${result.byteCount}\``);
    if (result.charCount !== null) lines.push(`- Characters: \`${result.charCount}\``);
    if (result.rawHex) lines.push(`- Hex string: \`${result.rawHex}\``);

    lines.push('');
    lines.push('## Errors');
    lines.push('');
    if (result.errors.length) {
      result.errors.forEach(error => lines.push(`- ${error}`));
    } else {
      lines.push('- none');
    }

    lines.push('');
    lines.push('## Warnings');
    lines.push('');
    if (result.warnings.length) {
      result.warnings.forEach(warning => lines.push(`- ${warning}`));
    } else {
      lines.push('- none');
    }

    lines.push('');
    lines.push('## TLV Tree');
    lines.push('');
    if (result.tree.length) {
      lines.push(...renderMarkdownNodes(result.tree));
    } else {
      lines.push('- No TLV nodes parsed.');
    }
    lines.push('');

    return lines.join('\n');
  }

  function sanitizeBaseName(name) {
    const withoutExtension = String(name || 'image').replace(/\.[^.]+$/, '');
    return withoutExtension.replace(/[^a-z0-9._-]+/gi, '_').replace(/^_+|_+$/g, '') || 'image';
  }

  function crc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit += 1) {
        crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
      }
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function dosDateTime(date = new Date()) {
    const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
    const dosDate = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
    return { time, date: dosDate };
  }

  function writeUint16(target, offset, value) {
    target[offset] = value & 0xff;
    target[offset + 1] = (value >>> 8) & 0xff;
  }

  function writeUint32(target, offset, value) {
    target[offset] = value & 0xff;
    target[offset + 1] = (value >>> 8) & 0xff;
    target[offset + 2] = (value >>> 16) & 0xff;
    target[offset + 3] = (value >>> 24) & 0xff;
  }

  async function entryData(entry) {
    if (entry.content !== undefined) {
      return new TextEncoder().encode(entry.content);
    }
    return new Uint8Array(await entry.blob.arrayBuffer());
  }

  async function createZip(entries) {
    const encoder = new TextEncoder();
    const now = dosDateTime();
    const localParts = [];
    const centralParts = [];
    let offset = 0;

    for (const entry of entries) {
      const nameBytes = encoder.encode(entry.name);
      const dataBytes = await entryData(entry);
      const checksum = crc32(dataBytes);

      const local = new Uint8Array(30 + nameBytes.length + dataBytes.length);
      writeUint32(local, 0, 0x04034b50);
      writeUint16(local, 4, 20);
      writeUint16(local, 6, 0x0800);
      writeUint16(local, 8, 0);
      writeUint16(local, 10, now.time);
      writeUint16(local, 12, now.date);
      writeUint32(local, 14, checksum);
      writeUint32(local, 18, dataBytes.length);
      writeUint32(local, 22, dataBytes.length);
      writeUint16(local, 26, nameBytes.length);
      writeUint16(local, 28, 0);
      local.set(nameBytes, 30);
      local.set(dataBytes, 30 + nameBytes.length);
      localParts.push(local);

      const central = new Uint8Array(46 + nameBytes.length);
      writeUint32(central, 0, 0x02014b50);
      writeUint16(central, 4, 20);
      writeUint16(central, 6, 20);
      writeUint16(central, 8, 0x0800);
      writeUint16(central, 10, 0);
      writeUint16(central, 12, now.time);
      writeUint16(central, 14, now.date);
      writeUint32(central, 16, checksum);
      writeUint32(central, 20, dataBytes.length);
      writeUint32(central, 24, dataBytes.length);
      writeUint16(central, 28, nameBytes.length);
      writeUint16(central, 30, 0);
      writeUint16(central, 32, 0);
      writeUint16(central, 34, 0);
      writeUint16(central, 36, 0);
      writeUint32(central, 38, 0);
      writeUint32(central, 42, offset);
      central.set(nameBytes, 46);
      centralParts.push(central);

      offset += local.length;
    }

    const centralOffset = offset;
    const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
    const end = new Uint8Array(22);
    writeUint32(end, 0, 0x06054b50);
    writeUint16(end, 4, 0);
    writeUint16(end, 6, 0);
    writeUint16(end, 8, entries.length);
    writeUint16(end, 10, entries.length);
    writeUint32(end, 12, centralSize);
    writeUint32(end, 16, centralOffset);
    writeUint16(end, 20, 0);

    return new Blob([...localParts, ...centralParts, end], { type: 'application/zip' });
  }

  function resultSummaryLine(result, index) {
    return [
      `${index + 1}. ${result.file.name}`,
      `   QR found: ${result.qrFound ? 'true' : 'false'}`,
      `   EMV valid: ${result.valid ? 'true' : 'false'}`,
      `   bytes: ${result.byteCount === null ? '-' : result.byteCount}`,
      `   errors: ${result.errors.length}`,
      ...result.errors.map(error => `     - ERROR: ${error}`),
      `   warnings: ${result.warnings.length}`,
      ...result.warnings.map(warning => `     - WARNING: ${warning}`),
      '',
    ].join('\n');
  }

  function csvValue(value) {
    const text = String(value === null || value === undefined ? '' : value);
    if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
    return text;
  }

  function csvLine(values) {
    return values.map(csvValue).join(',');
  }

  function buildCsvReport(rows) {
    const headers = [
      'file_name',
      'file_type',
      'file_size_bytes',
      'image_width',
      'image_height',
      'open_cv_enabled',
      'qr_found',
      'emv_valid',
      'qr_version',
      'qr_error_correction_level',
      'payload_chars',
      'payload_bytes',
      'root_field_count',
      'total_node_count',
      'root_field_ids',
      'crc_ok',
      'crc_expected',
      'crc_actual',
      'crc_message',
      'error_count',
      'warning_count',
      'errors',
      'warnings',
      'raw_text',
      'raw_hex',
      'yaml_file',
      'markdown_file',
      'picture_file',
    ];

    return [
      csvLine(headers),
      ...rows.map(({ result, yamlName, markdownName, pictureName }) => csvLine([
        result.file.name,
        result.file.type || '',
        result.file.size,
        result.imageWidth,
        result.imageHeight,
        result.openCvEnabled,
        result.qrFound,
        result.valid,
        result.qrVersion,
        result.qrErrorCorrectionLevel,
        result.charCount,
        result.byteCount,
        result.tree.length,
        countNodes(result.tree),
        result.tree.map(node => node.id).join(' '),
        result.crcOk,
        result.crcExpected,
        result.crcActual,
        result.crcMessage,
        result.errors.length,
        result.warnings.length,
        result.errors.join(' | '),
        result.warnings.join(' | '),
        result.rawText,
        result.rawHex,
        yamlName,
        markdownName,
        pictureName,
      ])),
      '',
    ].join('\n');
  }

  function buildTextReport(results) {
    const validCount = results.filter(result => result.valid).length;
    const validPercent = results.length ? Math.round((validCount / results.length) * 100) : 0;
    const invalidPercent = results.length ? Math.round(((results.length - validCount) / results.length) * 100) : 0;
    const generatedAt = new Date();
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'local time';
    return [
      'EMV Merchant-Presented QR validation report',
      `Generated: ${formatLocalDateTime(generatedAt)} ${timeZone}`,
      `Files: ${results.length}`,
      `Valid EMV QR: ${validCount} (${validPercent}%)`,
      `Invalid or unreadable: ${results.length - validCount} (${invalidPercent}%)`,
      '',
      ...results.map(resultSummaryLine),
    ].join('\n');
  }

  function pad2(value) {
    return String(value).padStart(2, '0');
  }

  function formatLocalDateTime(date) {
    const offsetMinutes = -date.getTimezoneOffset();
    const sign = offsetMinutes >= 0 ? '+' : '-';
    const absoluteOffset = Math.abs(offsetMinutes);
    const offset = `${sign}${pad2(Math.floor(absoluteOffset / 60))}:${pad2(absoluteOffset % 60)}`;
    return [
      date.getFullYear(),
      '-',
      pad2(date.getMonth() + 1),
      '-',
      pad2(date.getDate()),
      'T',
      pad2(date.getHours()),
      ':',
      pad2(date.getMinutes()),
      ':',
      pad2(date.getSeconds()),
      offset,
    ].join('');
  }

  function formatFilenameDateTime(date) {
    return [
      date.getFullYear(),
      '-',
      pad2(date.getMonth() + 1),
      '-',
      pad2(date.getDate()),
      'T',
      pad2(date.getHours()),
      '-',
      pad2(date.getMinutes()),
      '-',
      pad2(date.getSeconds()),
    ].join('');
  }

  async function downloadReportZip() {
    if (!latestResults.length) return;
    const seen = new Map();
    const reportRows = [];
    const entries = [{
      name: 'report.txt',
      content: buildTextReport(latestResults),
    }];

    for (const result of latestResults) {
      const base = sanitizeBaseName(result.file.name);
      const count = seen.get(base) || 0;
      seen.set(base, count + 1);
      const suffix = count ? `-${count + 1}` : '';
      const yamlName = `yaml/${base}${suffix}.yaml`;
      const markdownName = `markdown/${base}${suffix}.md`;
      const pictureName = `pictures/${base}${suffix}-${result.file.name}`;
      reportRows.push({ result, yamlName, markdownName, pictureName });
      entries.push({
        name: yamlName,
        content: resultToYaml(result),
      });
      entries.push({
        name: markdownName,
        content: resultToMarkdown(result),
      });
      entries.push({
        name: pictureName,
        blob: result.file,
      });
    }

    entries.push({
      name: 'report.csv',
      content: buildCsvReport(reportRows),
    });

    const blob = await createZip(entries);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `emvqr-validation-report_${formatFilenameDateTime(new Date())}.zip`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function updateSummary(results) {
    const validCount = results.filter(result => result.valid).length;
    const total = results.length;
    const validPercent = total ? Math.round((validCount / total) * 100) : 0;
    const invalidPercent = total ? Math.round(((total - validCount) / total) * 100) : 0;
    validatorTotal.textContent = String(results.length);
    validatorValid.textContent = `${validCount} (${validPercent}%)`;
    validatorInvalid.textContent = `${total - validCount} (${invalidPercent}%)`;
  }

  async function validateFile(file) {
    try {
      const loaded = await loadImage(file);
      const code = decodeImage(loaded.image);
      if (!code) {
        return {
          file,
          imageWidth: loaded.image.naturalWidth,
          imageHeight: loaded.image.naturalHeight,
          openCvEnabled: validatorUseOpenCv.checked,
          qrFound: false,
          valid: false,
          byteCount: null,
          charCount: null,
          rawText: '',
          rawHex: '',
          tree: [],
          qrVersion: null,
          qrErrorCorrectionLevel: '',
          crcOk: false,
          crcExpected: '',
          crcActual: '',
          crcMessage: '',
          errors: ['No QR code could be decoded from this image.'],
          warnings: [],
        };
      }

      const analysis = window.emvAnalyzer.analyzePayload(code.data);
      return {
        file,
        imageWidth: loaded.image.naturalWidth,
        imageHeight: loaded.image.naturalHeight,
        openCvEnabled: validatorUseOpenCv.checked,
        qrFound: true,
        valid: analysis.validation.valid,
        byteCount: analysis.byteCount,
        charCount: analysis.charCount,
        rawText: analysis.rawText,
        rawHex: analysis.rawHex,
        tree: analysis.tree,
        qrVersion: code.version || null,
        qrErrorCorrectionLevel: code.errorCorrectionLevel || '',
        crcOk: analysis.validation.crc.ok,
        crcExpected: analysis.validation.crc.expected || '',
        crcActual: analysis.validation.crc.actual || '',
        crcMessage: analysis.validation.crc.message || '',
        errors: analysis.validation.errors,
        warnings: analysis.validation.warnings,
      };
    } catch (error) {
      return {
        file,
        imageWidth: null,
        imageHeight: null,
        openCvEnabled: validatorUseOpenCv.checked,
        qrFound: false,
        valid: false,
        byteCount: null,
        charCount: null,
        rawText: '',
        rawHex: '',
        tree: [],
        qrVersion: null,
        qrErrorCorrectionLevel: '',
        crcOk: false,
        crcExpected: '',
        crcActual: '',
        crcMessage: '',
        errors: [error.message],
        warnings: [],
      };
    }
  }

  async function validateFiles(files) {
    const currentRun = runId + 1;
    runId = currentRun;
    const fileList = Array.from(files);
    validatorRows.innerHTML = '';
    latestResults = [];
    downloadValidatorZipButton.disabled = true;
    updateSummary([]);
    if (!fileList.length) {
      validatorRows.innerHTML = '<tr><td colspan="8">No files selected.</td></tr>';
      setStatus('Ready.');
      return;
    }

    const results = [];
    setStatus(`Validating 0/${fileList.length} files.`);

    for (let index = 0; index < fileList.length; index += 1) {
      if (runId !== currentRun) return;
      const result = await validateFile(fileList[index]);
      results.push(result);
      latestResults = results.slice();
      renderResultsTable(latestResults);
      updateSummary(results);
      setStatus(`Validating ${index + 1}/${fileList.length} files.`);
    }

    const validCount = results.filter(result => result.valid).length;
    downloadValidatorZipButton.disabled = results.length === 0;
    setStatus(`Done. ${validCount}/${results.length} files contain valid EMV QR payloads.`);
  }

  validatorFiles.addEventListener('change', () => {
    validateFiles(validatorFiles.files);
  });
  validatorDisplayFilter.addEventListener('change', () => {
    renderResultsTable(latestResults);
  });
  printValidatorButton.addEventListener('click', () => {
    window.print();
  });
  downloadValidatorZipButton.addEventListener('click', () => {
    downloadReportZip().catch(error => setStatus(`Unable to create report zip: ${error.message}`, 'error'));
  });
}());
