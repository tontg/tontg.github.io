// Copyright 2026 Gilles Reant. SPDX-License-Identifier: Apache-2.0
(function (global) {
  const maxBytes = 65536;
  function loadDocument(text) {
    if (typeof text !== 'string' || new TextEncoder().encode(text).length > maxBytes) throw new RangeError('YAML input must not exceed 64 KiB.');
    let depth = 0, nodes = 0;
    return global.jsyaml.load(text, {
      schema: global.jsyaml.FAILSAFE_SCHEMA,
      maxDepth: 24,
      listener(event) {
        if (event === 'open' && (++depth > 24 || ++nodes > 4096)) throw new RangeError('YAML nesting or node limit exceeded.');
        if (event === 'close') depth--;
      },
    });
  }
  function parse(text) {
    const document = loadDocument(text);
    const fields = Array.isArray(document) ? document : document && Object.keys(document).length === 1 ? document.fields : null;
    if (!Array.isArray(fields)) throw new TypeError('YAML must be a field sequence or an object containing only a fields sequence.');
    return global.emvCodec.normalizeFields(fields);
  }
  function parseTestSet(text) {
    function mapping(value, keys, label) {
      if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) {
        throw new TypeError(`${label} must be an object containing only ${keys.join(', ')}.`);
      }
    }
    function textValue(value, label, max, fallback) {
      if (value === undefined && fallback !== undefined) return fallback;
      if (typeof value !== 'string' || !value.trim() || value.length > max) throw new TypeError(`${label} must be nonempty text of at most ${max} characters.`);
      return value;
    }
    const document = loadDocument(text);
    mapping(document, ['title', 'description', 'codes'], 'Test set');
    if (!Array.isArray(document.codes) || !document.codes.length || document.codes.length > 50) throw new RangeError('Test set must contain 1-50 codes.');
    const ids = new Set();
    const codes = document.codes.map((entry, index) => {
      const label = `Code ${index + 1}`;
      mapping(entry, ['id', 'title', 'description', 'errorCorrection', 'fields'], label);
      const id = textValue(entry.id, `${label} id`, 64);
      if (!/^[a-z0-9][a-z0-9_-]*$/.test(id) || ids.has(id)) throw new TypeError(`${label} needs a unique lowercase id using letters, digits, underscores or hyphens.`);
      ids.add(id);
      const errorCorrection = entry.errorCorrection ?? 'L';
      if (!['L', 'M', 'Q', 'H'].includes(errorCorrection)) throw new TypeError(`${label} errorCorrection must be L, M, Q or H.`);
      let fields;
      try { fields = global.emvCodec.normalizeFields(entry.fields); }
      catch (error) { throw new TypeError(`${label}: ${error.message}`); }
      return {
        id, title: textValue(entry.title, `${label} title`, 120),
        description: textValue(entry.description, `${label} description`, 500, ''),
        errorCorrection, fields,
      };
    });
    return {
      title: textValue(document.title, 'Test set title', 120, 'Scanner test set'),
      description: textValue(document.description, 'Test set description', 500, ''),
      codes,
    };
  }
  global.emvYaml = { parse, parseTestSet, maxBytes };
}(globalThis));
