(function () {
  const validatorFiles = document.getElementById('validatorFiles');
  const validatorUseOpenCv = document.getElementById('validatorUseOpenCv');
  const validatorDisplayFilter = document.getElementById('validatorDisplayFilter');
  const downloadValidatorZipButton = document.getElementById('downloadValidatorZipButton');
  const printValidatorButton = document.getElementById('printValidatorButton');
  const validatorStatus = document.getElementById('validatorStatus');
  const validatorProgressBar = document.getElementById('validatorProgressBar');
  const validatorProgressText = document.getElementById('validatorProgressText');
  const validatorTotal = document.getElementById('validatorTotal');
  const validatorValid = document.getElementById('validatorValid');
  const validatorInvalid = document.getElementById('validatorInvalid');
  const validatorRows = document.getElementById('validatorRows');
  const scanner = window.emvScanner.createScanner();
  let controller = null;
  let rowCache = new WeakMap();
  let runId = 0;
  let latestResults = [];

  function setStatus(message, type = 'info') {
    validatorStatus.textContent = message;
    validatorStatus.classList.toggle('error', type === 'error');
  }

  const formatSeconds = window.emvFormat.seconds;

  function updateProgress(completed, total) {
    const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
    validatorProgressBar.style.width = `${percent}%`;
    validatorProgressBar.setAttribute('aria-valuenow', String(percent));
    validatorProgressText.textContent = `${completed}/${total} (${percent}%)`;
  }

  function thumbnail(result) {
    const url = URL.createObjectURL(result.thumbnail);
    const img = document.createElement('img');
    img.alt = `${result.file.name} thumbnail`;
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
    if (rowCache.has(result)) return rowCache.get(result);
    const row = document.createElement('tr');
    row.dataset.result = 'true';
    rowCache.set(result, row);
    row.className = result.valid ? 'valid-row' : 'invalid-row';

    const name = document.createElement('td');
    name.textContent = result.file.name;
    row.appendChild(name);

    const thumb = document.createElement('td');
    thumb.className = 'thumbnail-cell';
    if (result.thumbnail) thumb.appendChild(thumbnail(result));
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

    const seconds = document.createElement('td');
    seconds.textContent = formatSeconds(result.elapsedSeconds);
    row.appendChild(seconds);

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
      validatorRows.innerHTML = '<tr><td colspan="9">No files selected.</td></tr>';
      return;
    }

    if (!rows.length) {
      validatorRows.innerHTML = '<tr><td colspan="9">No files match the selected display filter.</td></tr>';
      return;
    }

    const fragment = document.createDocumentFragment();
    rows.forEach(result => fragment.appendChild(renderRow(result)));
    validatorRows.appendChild(fragment);
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
    return window.emvFormat.yamlExport({
      ...result, qrInfo: { version: result.qrVersion, errorCorrectionLevel: result.qrErrorCorrectionLevel },
      validation: { errors: result.errors, warnings: result.warnings },
    }, [`# source_file: ${window.emvFormat.comment(result.file.name)}`, `# qr_found: ${result.qrFound}`, `# emv_valid: ${result.valid}`]);
  }

  function renderMarkdownNodes(nodes, indent = 0, parentId = null) {
    const lines = [];
    const prefix = `${'  '.repeat(indent)}- `;

    for (const node of nodes || []) {
      lines.push(`${prefix}**${node.id}** ${node.name} _(len ${node.length}, offset ${node.offset})_`);
      if (node.value !== undefined) {
        const annotation = window.emvFormat.description(node.id, node.value, parentId);
        lines.push(`${'  '.repeat(indent + 1)}- Value: ${window.emvFormat.markdown(node.value)}${annotation ? ' (' + window.emvFormat.markdown(annotation) + ')' : ''}`);
      }
      if (node.children && node.children.length) {
        lines.push(...renderMarkdownNodes(node.children, indent + 1, node.id));
      }
    }

    return lines;
  }

  function resultToMarkdown(result) {
    const lines = [
      '# EMV Merchant-Presented QR validation export',
      '',
      `- Source file: ${window.emvFormat.markdown(result.file.name)}`,
      `- QR found: \`${result.qrFound ? 'true' : 'false'}\``,
      `- EMV valid: \`${result.valid ? 'true' : 'false'}\``,
      `- Errors: \`${result.errors.length}\``,
      `- Warnings: \`${result.warnings.length}\``,
      `- Decode/parse seconds: \`${formatSeconds(result.elapsedSeconds)}\``,
    ];

    if (result.byteCount !== null) lines.push(`- Bytes: \`${result.byteCount}\``);
    if (result.charCount !== null) lines.push(`- Characters: \`${result.charCount}\``);
    if (result.rawHex) lines.push(`- Hex string: \`${result.rawHex}\``);

    lines.push('');
    lines.push('## Errors');
    lines.push('');
    if (result.errors.length) {
      result.errors.forEach(error => lines.push(`- ${window.emvFormat.markdown(error)}`));
    } else {
      lines.push('- none');
    }

    lines.push('');
    lines.push('## Warnings');
    lines.push('');
    if (result.warnings.length) {
      result.warnings.forEach(warning => lines.push(`- ${window.emvFormat.markdown(warning)}`));
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

  async function createZip(entries, checkCurrent) {
    const size = entries.reduce((sum, entry) => sum + (entry.blob?.size ?? new TextEncoder().encode(entry.content).length) + 256, 0);
    if (size > window.emvDecoder.limits.zipBytes || entries.length > 65535) throw new RangeError('Report exceeds the 128 MiB ZIP limit.');
    const encoder = new TextEncoder();
    const now = dosDateTime();
    const localParts = [];
    const centralParts = [];
    let offset = 0;

    for (const entry of entries) {
      checkCurrent();
      await new Promise(resolve => setTimeout(resolve, 0));
      checkCurrent();
      const nameBytes = encoder.encode(entry.name);
      const dataBytes = await entryData(entry);
      checkCurrent();
      const checksum = crc32(dataBytes);

      const local = new Uint8Array(30 + nameBytes.length);
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
      localParts.push(local, dataBytes);

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

      offset += local.length + dataBytes.length;
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
      `${index + 1}. ${window.emvFormat.comment(result.file.name)}`,
      `   QR found: ${result.qrFound ? 'true' : 'false'}`,
      `   EMV valid: ${result.valid ? 'true' : 'false'}`,
      `   bytes: ${result.byteCount === null ? '-' : result.byteCount}`,
      `   seconds: ${formatSeconds(result.elapsedSeconds)}`,
      `   errors: ${result.errors.length}`,
      ...result.errors.map(error => `     - ERROR: ${window.emvFormat.comment(error)}`),
      `   warnings: ${result.warnings.length}`,
      ...result.warnings.map(warning => `     - WARNING: ${window.emvFormat.comment(warning)}`),
      '',
    ].join('\n');
  }

  const csvValue = window.emvFormat.csvValue;

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
      'decode_parse_seconds',
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
        formatSeconds(result.elapsedSeconds),
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
    const totalSeconds = totalElapsedSeconds(results);
    const generatedAt = new Date();
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'local time';
    return [
      'Merchant-Presented QR-Code validation report',
      `Generated: ${formatLocalDateTime(generatedAt)} ${timeZone}`,
      `Files: ${results.length}`,
      `Valid EMV QR: ${validCount} (${validPercent}%)`,
      `Invalid or unreadable: ${results.length - validCount} (${invalidPercent}%)`,
      `Total scanning time: ${formatSeconds(totalSeconds)} s`,
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

  async function downloadReportZip(results = latestResults.slice(), expectedRun = runId) {
    if (!results.length) return;
    const checkCurrent = () => { if (runId !== expectedRun) throw new DOMException('Report cancelled.', 'AbortError'); };
    checkCurrent();
    const seen = new Map();
    const reportRows = [];
    const entries = [{
      name: 'report.txt',
      content: buildTextReport(results),
    }];

    for (const result of results) {
      const base = `${String(reportRows.length + 1).padStart(3, '0')}-${sanitizeBaseName(result.file.name).slice(0, 100)}`;
      const count = seen.get(base) || 0;
      seen.set(base, count + 1);
      const suffix = count ? `-${count + 1}` : '';
      const yamlName = `yaml/${base}${suffix}.yaml`;
      const markdownName = `markdown/${base}${suffix}.md`;
      const extension = result.file.name.match(/\.[a-z0-9]{1,8}$/i)?.[0] || '.bin';
      const pictureName = `pictures/${base}${suffix}${extension}`;
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

    const blob = await createZip(entries, checkCurrent);
    checkCurrent();
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

  function totalElapsedSeconds(results) {
    return results.reduce((sum, result) => sum + (Number.isFinite(result.elapsedSeconds) ? result.elapsedSeconds : 0), 0);
  }

  async function validateFile(file, options) {
    const startedAt = performance.now();
    const result = {
      file, imageWidth: null, imageHeight: null, openCvEnabled: options.useOpenCv,
      qrFound: false, valid: false, byteCount: null, charCount: null, elapsedSeconds: 0,
      rawText: '', rawHex: '', tree: [], qrVersion: null, qrErrorCorrectionLevel: '',
      crcOk: false, crcExpected: '', crcActual: '', crcMessage: '', errors: [], warnings: [],
    };
    try {
      const decoded = await scanner.scanFile(file, options);
      window.emvDecoder.checkAbort(options.signal);
      result.imageWidth = decoded.width;
      result.imageHeight = decoded.height;
      result.thumbnail = decoded.thumbnail;
      result.warnings = decoded.warnings;
      if (!decoded.code) result.errors.push('No QR code could be decoded from this image.');
      else {
        const analysis = window.emvAnalyzer.analyzePayload(decoded.code.data);
        const qr = window.emvFormat.metadata(decoded.code);
        Object.assign(result, {
          qrFound: true, valid: analysis.validation.valid, byteCount: analysis.byteCount, charCount: analysis.charCount,
          rawText: analysis.rawText, rawHex: analysis.rawHex, tree: analysis.tree,
          qrVersion: qr.version, qrErrorCorrectionLevel: qr.errorCorrectionLevel || '',
          crcOk: analysis.validation.crc.ok, crcExpected: analysis.validation.crc.expected || '',
          crcActual: analysis.validation.crc.actual || '', crcMessage: analysis.validation.crc.message,
          errors: analysis.validation.errors, warnings: result.warnings.concat(analysis.validation.warnings),
        });
      }
    } catch (error) {
      if (error.name === 'AbortError') throw error;
      result.errors.push(error.message);
    }
    result.elapsedSeconds = (performance.now() - startedAt) / 1000;
    result.warnings = window.emvFormat.slowWarnings(result.warnings, result.elapsedSeconds);
    return result;
  }

  function appendResultRow(result) {
    if (!visibleResults([result]).length) {
      if (!validatorRows.querySelector('[data-result]')) validatorRows.innerHTML = '<tr><td colspan="9">No files match the selected display filter.</td></tr>';
      return;
    }
    if (!validatorRows.querySelector('[data-result]')) validatorRows.innerHTML = '';
    validatorRows.appendChild(renderRow(result));
  }

  async function validateFiles(files) {
    controller?.abort();
    controller = new AbortController();
    const options = { signal: controller.signal, useOpenCv: validatorUseOpenCv.checked };
    rowCache = new WeakMap();
    const currentRun = runId + 1;
    runId = currentRun;
    const fileList = Array.from(files);
    validatorRows.innerHTML = '';
    latestResults = [];
    downloadValidatorZipButton.disabled = true;
    updateSummary([]);
    updateProgress(0, fileList.length);
    try { window.emvDecoder.checkBatch(fileList); } catch (error) { setStatus(error.message, 'error'); return; }
    if (!fileList.length) {
      validatorRows.innerHTML = '<tr><td colspan="9">No files selected.</td></tr>';
      setStatus('Ready.');
      return;
    }

    const results = [];
    setStatus(`Validating 0/${fileList.length} files.`);

    for (let index = 0; index < fileList.length; index += 1) {
      if (runId !== currentRun) return;
      let result;
      try { result = await validateFile(fileList[index], options); }
      catch (error) { if (error.name === 'AbortError') return; throw error; }
      if (runId !== currentRun || options.signal.aborted) return;
      results.push(result);
      latestResults = results.slice();
      appendResultRow(result);
      updateSummary(results);
      updateProgress(index + 1, fileList.length);
      setStatus(`Validating ${index + 1}/${fileList.length} files.`);
    }

    const validCount = results.filter(result => result.valid).length;
    downloadValidatorZipButton.disabled = results.length === 0;
    updateProgress(results.length, results.length);
    setStatus(`Done. ${validCount}/${results.length} files contain valid EMV QR payloads. Total scanning time: ${formatSeconds(totalElapsedSeconds(results))} s.`);
    if (results.length && runId === currentRun) {
      downloadValidatorZipButton.disabled = true;
      try {
        await downloadReportZip(results.slice(), currentRun);
      } catch (error) {
        if (runId !== currentRun || error.name === 'AbortError') return;
        setStatus(`Done, but unable to create report zip: ${error.message}`, 'error');
      } finally {
        if (runId === currentRun) downloadValidatorZipButton.disabled = false;
      }
    }
  }

  validatorFiles.addEventListener('change', () => {
    validateFiles(validatorFiles.files).catch(error => setStatus(error.message, 'error'));
  });
  validatorDisplayFilter.addEventListener('change', () => {
    renderResultsTable(latestResults);
  });
  printValidatorButton.addEventListener('click', () => {
    window.print();
  });
  downloadValidatorZipButton.addEventListener('click', () => {
    const expectedRun = runId;
    downloadValidatorZipButton.disabled = true;
    downloadReportZip().catch(error => { if (runId === expectedRun && error.name !== 'AbortError') setStatus(`Unable to create report zip: ${error.message}`, 'error'); }).finally(() => { if (runId === expectedRun) downloadValidatorZipButton.disabled = !latestResults.length; });
  });
  window.addEventListener('pagehide', () => { runId++; controller?.abort(); scanner.dispose(); });
}());
