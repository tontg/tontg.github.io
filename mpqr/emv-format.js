// Copyright 2026 Gilles Reant. SPDX-License-Identifier: Apache-2.0
(function (global) {
  const comment = value => String(value ?? '').replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ');
  const scalar = value => JSON.stringify(String(value)).replace(/[\u0085\u2028\u2029]/g, ch => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`);
  const seconds = value => Number.isFinite(value) ? value.toFixed(3) : '0.000';
  function fieldsYaml(fields, indent = 2) {
    return fields.flatMap(field => {
      const [id, value] = Object.entries(field)[0];
      const prefix = `${' '.repeat(indent)}- ${scalar(id)}:`;
      return Array.isArray(value) ? (value.length ? [prefix, ...fieldsYaml(value, indent + 4)] : [`${prefix} []`]) : [`${prefix} ${scalar(value)}`];
    });
  }
  function treeFields(nodes) {
    return nodes.map(node => ({ [node.id]: node.value !== undefined ? node.value : treeFields(node.children || []) }));
  }
  const nodesYaml = (nodes, indent = 2) => fieldsYaml(treeFields(nodes), indent);
  function metadata(code) {
    if (!code) return null;
    const ec = code.errorCorrectionLevel;
    return { version: code.version || null, errorCorrectionLevel: Number.isInteger(ec) ? ['L', 'M', 'Q', 'H'][ec] : /^[LMQH]$/.test(ec) ? ec : null };
  }
  function yamlExport(result, extraComments = []) {
    const qr = result.qrInfo;
    return [
      '# Merchant-Presented QR-Code export. Field order and CRC are preserved.',
      ...extraComments.map(comment),
      ...(qr?.version ? [`# qrcode: version ${qr.version}${qr.errorCorrectionLevel ? '/' + qr.errorCorrectionLevel : ''}`] : []),
      `# payload: ${comment(result.rawText)}`,
      `# nbchars: ${result.charCount ?? 0}`, `# nbbytes: ${result.byteCount ?? 0}`,
      `# decode_parse_seconds: ${seconds(result.elapsedSeconds)}`, `# hexastring: ${result.rawHex || ''}`,
      '# errors:', ...(result.validation.errors.length ? result.validation.errors.map(value => '#   - ' + comment(value)) : ['#   - none']),
      '# warnings:', ...(result.validation.warnings.length ? result.validation.warnings.map(value => '#   - ' + comment(value)) : ['#   - none']),
      result.tree.length ? 'fields:' : 'fields: []', ...nodesYaml(result.tree), '',
    ].join('\n');
  }
  function csvValue(value) {
    let text = String(value ?? '');
    // Spreadsheet-facing CSV only. Original values remain in YAML and raw payloads.
    if (/^[\s\u0000-\u001f]*[=+@\-\uFF1D\uFF0B\uFF0D\uFF20]|^[\t\r\n]/u.test(text)) text = "'" + text;
    return `"${text.replace(/"/g, '""')}"`;
  }
  function markdown(value) {
    return comment(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/([\\`*_{}\[\]()#+.!|~-])/g, '\\$1');
  }
  function description(id, value, parentId) {
    if (parentId === '64' && id === '00') return global.iso639LanguageCodes?.[String(value).toLowerCase()] || '';
    if (parentId) return '';
    if (id === '52') return global.mccCodes?.[value] || '';
    if (id === '58') return global.iso3166Alpha2Codes?.[value] || '';
    const currency = id === '53' && global.iso4217Codes?.[value];
    return currency ? `${currency.alpha}, ${currency.name}` : '';
  }
  function qrParameter(location) {
    const fragment = new URLSearchParams(location.hash.slice(1));
    return fragment.has('qr') ? fragment.get('qr') : new URLSearchParams(location.search).get('qr');
  }
  function slowWarnings(warnings, elapsedSeconds) {
    return elapsedSeconds > 1.5 ? warnings.concat(`QR decoding and parsing took ${seconds(elapsedSeconds)} s, which exceeds the 1.500 s warning threshold.`) : warnings;
  }
  global.emvFormat = { comment, scalar, seconds, fieldsYaml, treeFields, nodesYaml, metadata, yamlExport, csvValue, markdown, description, qrParameter, slowWarnings };
}(globalThis));
