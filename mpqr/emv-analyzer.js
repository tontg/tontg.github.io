(function (global) {
  const TAG_NAMES = {
    '00': 'Payload Format Indicator',
    '01': 'Point of Initiation Method',
    '52': 'Merchant Category Code',
    '53': 'Transaction Currency',
    '54': 'Transaction Amount',
    '55': 'Tip or Convenience Indicator',
    '56': 'Value of Convenience Fee Fixed',
    '57': 'Value of Convenience Fee Percentage',
    '58': 'Country Code',
    '59': 'Merchant Name',
    '60': 'Merchant City',
    '61': 'Postal Code',
    '62': 'Additional Data Field Template',
    '63': 'CRC',
    '64': 'Merchant Information - Language Template',
  };

  const ADDITIONAL_DATA_NAMES = {
    '01': 'Bill Number',
    '02': 'Mobile Number',
    '03': 'Store Label',
    '04': 'Loyalty Number',
    '05': 'Reference Label',
    '06': 'Customer Label',
    '07': 'Terminal Label',
    '08': 'Purpose of Transaction',
    '09': 'Additional Consumer Data Request',
  };

  const LANGUAGE_NAMES = {
    '00': 'Language Preference',
    '01': 'Merchant Name - Alternate Language',
    '02': 'Merchant City - Alternate Language',
  };

  function merchantAccountInformationName(id) {
    const n = Number(id);
    if (n >= 2 && n <= 3) return 'Merchant Account Information (Visa)';
    if (n >= 4 && n <= 5) return 'Merchant Account Information (Mastercard)';
    if (n >= 6 && n <= 8) return 'Merchant Account Information (Reserved by EMVCo)';
    if (n >= 9 && n <= 10) return 'Merchant Account Information (Discover)';
    if (n >= 11 && n <= 12) return 'Merchant Account Information (Amex)';
    if (n >= 13 && n <= 14) return 'Merchant Account Information (JCB)';
    if (n >= 15 && n <= 16) return 'Merchant Account Information (UnionPay)';
    if (n >= 17 && n <= 25) return 'Merchant Account Information (Reserved by EMVCo)';
    if (n >= 26 && n <= 51) return 'Merchant Account Information (Private Use)';
    return 'Merchant Account Information';
  }

  function isTemplate(id, path) {
    const n = Number(id);
    if (path.length === 0) return (n >= 26 && n <= 51) || id === '62' || id === '64' || n >= 80;
    return path.length === 1 && path[0] === '62' && n >= 50;
  }

  function tagName(id, parentId, parentPath = []) {
    const n = Number(id);
    if (parentPath.length === 2 && parentPath[0] === '62' && Number(parentPath[1]) >= 50) {
      return id === '00' ? 'Globally Unique Identifier' : 'Context Specific Data';
    }
    if (parentId === '62') {
      if (ADDITIONAL_DATA_NAMES[id]) return ADDITIONAL_DATA_NAMES[id];
      if (n >= 10 && n <= 49) return 'RFU for EMVCo';
      if (n >= 50 && n <= 99) return 'Payment System specific template';
      return 'Additional Data Field';
    }
    if (parentId === '64') return LANGUAGE_NAMES[id] || 'Language Data';
    if (parentId && Number(parentId) >= 2 && Number(parentId) <= 51) {
      if (id === '00') return 'Globally Unique Identifier';
      return 'Context Specific Data';
    }
    if (parentId && Number(parentId) >= 80 && Number(parentId) <= 99) {
      if (id === '00') return 'Globally Unique Identifier';
      if (n >= 1 && n <= 99) return 'Context Specific Data';
    }
    if (TAG_NAMES[id]) return TAG_NAMES[id];
    if (n >= 2 && n <= 51) return merchantAccountInformationName(id);
    if (n >= 65 && n <= 79) return 'RFU for EMVCo';
    if (n >= 80 && n <= 99) return 'Unreserved Template';
    return 'Unknown';
  }

  function diagnostic(code, message, path = [], offset = null, severity = 'error') {
    return { code, message, path, offset, severity };
  }

  function parseTlv(text) {
    if (typeof text !== 'string') throw new TypeError('Payload must be a string.');
    const limits = global.emvCodec.limits;
    if (text.length > limits.maxCharacters * 2) throw new RangeError('Payload is too large.');
    const chars = Array.from(text);
    if (chars.length > limits.maxCharacters) throw new RangeError('Payload is too large.');
    const diagnostics = [];
    let count = 0;
    function parse(start, end, path) {
      const nodes = [], seen = new Set();
      let cursor = start;
      const initialErrors = diagnostics.length;
      while (cursor < end) {
        if (++count > limits.maxNodes || path.length > limits.maxDepth) {
          diagnostics.push(diagnostic('tlv.limit', 'TLV nesting or field count limit exceeded.', path, cursor));
          break;
        }
        const offset = cursor;
        const id = chars.slice(cursor, cursor + 2).join('');
        const len = chars.slice(cursor + 2, cursor + 4).join('');
        if (cursor + 4 > end || !/^\d{2}$/.test(id) || !/^\d{2}$/.test(len)) {
          diagnostics.push(diagnostic('tlv.header', 'Invalid or truncated TLV header.', path, cursor));
          break;
        }
        const length = Number(len), valueStart = cursor + 4, valueEnd = valueStart + length;
        const nodePath = [...path, id];
        if (valueEnd > end) {
          diagnostics.push(diagnostic('tlv.length', `ID ${id} declares ${length} characters, but only ${end - valueStart} remain.`, nodePath, cursor));
          break;
        }
        if (seen.has(id)) diagnostics.push(diagnostic('tlv.duplicate', `Duplicate ID ${id} in ${path.join('-') || 'root payload'}.`, nodePath, cursor));
        seen.add(id);
        const value = chars.slice(valueStart, valueEnd).join('');
        const node = { id, name: tagName(id, path.at(-1), path), length, offset, path: nodePath, raw: chars.slice(cursor, valueEnd).join(''), value, children: [] };
        if (isTemplate(id, path)) {
          const child = parse(valueStart, valueEnd, nodePath);
          node.template = true;
          node.templateValid = child.complete;
          node.children = child.nodes;
          // Keep malformed templates as scalar text when exporting them.
          if (child.complete) delete node.value;
        }
        nodes.push(node);
        cursor = valueEnd;
      }
      return { nodes, consumed: cursor - start, complete: cursor === end && diagnostics.length === initialErrors };
    }
    const parsed = parse(0, chars.length, []);
    return { ...parsed, diagnostics, errors: diagnostics.map(item => item.message) };
  }

  function crcResult(text) {
    const actual = text.slice(-4).toUpperCase();
    if (!/6304[0-9A-Fa-f]{4}$/.test(text)) {
      return { ok: false, expected: null, actual, message: 'CRC must be the final ID 63 with length 04 and four hexadecimal digits.' };
    }
    const expected = global.CRC16.computeCRC(text.slice(0, -4));
    return { ok: expected === actual, expected, actual, message: expected === actual ? 'CRC is valid.' : `CRC mismatch: expected ${expected}, found ${actual}.` };
  }

  function analyzePayload(rawText, options = {}) {
    const parsed = parseTlv(rawText);
    const nodes = parsed.nodes;
    const diagnostics = [...parsed.diagnostics];
    const add = (code, message, node, severity = 'error') => diagnostics.push(diagnostic(code, message, node ? node.path : [], node ? node.offset : null, severity));
    const root = id => nodes.find(node => node.id === id);
    for (const id of ['00', '52', '53', '58', '59', '60', '63']) {
      if (!root(id)) diagnostics.push(diagnostic('emv.required', `Missing mandatory ID ${id} (${tagName(id)}).`, [id]));
    }
    if (!nodes.some(node => Number(node.id) >= 2 && Number(node.id) <= 51)) add('emv.account', 'Missing Merchant Account Information (02-51).');
    if (nodes[0]?.id !== '00') add('emv.order', 'Payload Format Indicator (00) must be first.', root('00'));
    if (root('00') && root('00').value !== '01') add('emv.format', 'Payload Format Indicator (00) must be "01".', root('00'));
    if (root('01') && !['11', '12'].includes(root('01').value)) add('emv.initiation', 'Point of Initiation Method (01) must be 11 or 12.', root('01'));
    for (const [id, pattern, description] of [
      ['52', /^\d{4}$/, 'four-digit MCC'], ['53', /^\d{3}$/, 'three-digit currency'],
      ['58', /^[A-Z]{2}$/, 'two-letter uppercase country'],
      ['54', /^\d+(\.\d*)?$/, 'numeric amount with an optional decimal point'],
      ['55', /^(01|02|03)$/, 'tip indicator 01, 02 or 03'],
      ['56', /^\d+(\.\d*)?$/, 'numeric fixed fee'], ['57', /^\d+(\.\d*)?$/, 'numeric percentage fee'],
    ]) {
      if (root(id) && !pattern.test(root(id).value)) add('emv.value', `ID ${id} must contain a ${description}.`, root(id));
    }
    for (const [id, max] of [['54', 13], ['56', 13], ['57', 5], ['59', 25], ['60', 15], ['61', 10]]) {
      const node = root(id);
      if (node && (node.length < 1 || node.length > max)) add('emv.length', `ID ${id} must contain 1-${max} characters.`, node);
    }
    if (root('54') && Number(root('54').value) <= 0) add('emv.amount', 'Transaction Amount must be greater than zero.', root('54'));
    const tip = root('55')?.value;
    if (tip === '02' && !root('56')) add('emv.fee', 'Fixed fee (56) is required for tip indicator 02.', root('55'));
    if (tip === '03' && !root('57')) add('emv.fee', 'Percentage fee (57) is required for tip indicator 03.', root('55'));
    if (root('56') && tip !== '02') add('emv.fee', 'Fixed fee (56) requires tip indicator 02.', root('56'));
    if (root('57') && tip !== '03') add('emv.fee', 'Percentage fee (57) requires tip indicator 03.', root('57'));

    function walk(list) {
      for (const node of list) {
        if (!node.length) add('emv.empty', `ID ${node.path.join('-')} (${node.name}) has an empty value.`, node, 'warning');
        if (node.template && node.templateValid) {
          const required = node.id === '64' && node.path.length === 1 ? ['00', '01'] : node.id === '62' && node.path.length === 1 ? [] : ['00'];
          for (const id of required) {
            if (!node.children.some(child => child.id === id && child.length > 0)) add('emv.template.required', `Template ${node.path.join('-')} requires nonempty ID ${id}.`, node);
          }
          if (node.id === '64' && node.path.length === 1) {
            const language = node.children.find(child => child.id === '00');
            if (language && !/^[a-zA-Z]{2}$/.test(language.value)) add('emv.language', 'Language Preference must be two letters.', language);
            for (const child of node.children) {
              const max = child.id === '01' ? 25 : child.id === '02' ? 15 : null;
              if (max && (child.length < 1 || child.length > max)) add('emv.length', `ID 64-${child.id} must contain 1-${max} characters.`, child);
            }
          }
        }
        if (node.children.length) walk(node.children);
      }
    }
    walk(nodes);
    const crc = crcResult(rawText);
    if (!crc.ok) add('emv.crc', crc.message, root('63'));
    if (root('63') && (nodes.at(-1).id !== '63' || root('63').length !== 4)) add('emv.crc.position', 'CRC (63) must be final and length 04.', root('63'));

    for (const rule of options.rules || []) {
      if (typeof rule !== 'function') throw new TypeError('Each validation rule must be a function.');
      const additions = rule(structuredClone({ rawText, tree: nodes })) || [];
      if (!Array.isArray(additions) || additions.some(item => !item || typeof item.code !== 'string' || typeof item.message !== 'string' || !['error', 'warning'].includes(item.severity) || !Array.isArray(item.path))) throw new TypeError('Rules must return structured diagnostics.');
      diagnostics.push(...structuredClone(additions));
    }
    const errors = diagnostics.filter(item => item.severity === 'error').map(item => item.message);
    const warnings = diagnostics.filter(item => item.severity === 'warning').map(item => item.message);
    return {
      rawText, rawHex: global.emvCodec.toHex(rawText),
      byteCount: new TextEncoder().encode(rawText).length, charCount: Array.from(rawText).length,
      tree: nodes,
      validation: { valid: errors.length === 0, errors, warnings, diagnostics, crc, checkedRules: [
        'TLV headers, lengths and duplicate IDs at every defined template level',
        'mandatory root fields, format indicator and initiation method',
        'basic field formats and lengths, fee dependencies and required template children',
        'CRC-16/CCITT-FALSE in final field 63',
        'empty values reported as warnings',
      ] },
      specificationSource: 'EMV QRCPS Merchant-Presented Mode v1.1 (November 2020)',
    };
  }
  global.emvAnalyzer = { analyzePayload, parseTlv };
}(globalThis));
