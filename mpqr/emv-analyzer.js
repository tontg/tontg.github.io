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

  function isTemplate(id) {
    const n = Number(id);
    return (n >= 2 && n <= 51) || id === '62' || id === '64' || (n >= 65 && n <= 99);
  }

  function tagName(id, parentId) {
    const n = Number(id);
    if (parentId === '62') {
      if (ADDITIONAL_DATA_NAMES[id]) return ADDITIONAL_DATA_NAMES[id];
      if (n >= 10 && n <= 49) return 'RFU for EMVCo';
      if (n >= 50 && n <= 99) return 'Payment System specific template';
      return 'Additional Data Field';
    }
    if (parentId === '64') return LANGUAGE_NAMES[id] || 'Language Data';
    if (parentId && Number(parentId) >= 2 && Number(parentId) <= 51) {
      if (id === '00') return 'Globally Unique Identifier';
      if (n >= 1 && n <= 63) return 'Context Specific Data';
      if (id === '98' || id === '99') return 'Globally Unique Identifier';
    }
    if (parentId && Number(parentId) >= 80 && Number(parentId) <= 99) {
      if (id === '00') return 'Globally Unique Identifier';
      if (n >= 1 && n <= 99) return 'Context Specific Data';
    }
    if (TAG_NAMES[id]) return TAG_NAMES[id];
    if (n >= 2 && n <= 51) return 'Merchant Account Information';
    if (n >= 65 && n <= 79) return 'RFU for EMVCo';
    if (n >= 80 && n <= 99) return 'Unreserved Template';
    return 'Unknown';
  }

  function parseTlv(text, parentId = null, offset = 0) {
    const nodes = [];
    const errors = [];
    const seen = new Set();
    let cursor = 0;

    while (cursor < text.length) {
      const absoluteOffset = offset + cursor;
      if (cursor + 4 > text.length) {
        errors.push(`Truncated TLV header at character ${absoluteOffset}.`);
        break;
      }

      const id = text.slice(cursor, cursor + 2);
      const lenText = text.slice(cursor + 2, cursor + 4);
      if (!/^\d{2}$/.test(id)) {
        errors.push(`Invalid data object ID "${id}" at character ${absoluteOffset}.`);
        break;
      }
      if (!/^\d{2}$/.test(lenText)) {
        errors.push(`Invalid length "${lenText}" for ID ${id} at character ${absoluteOffset + 2}.`);
        break;
      }

      const declaredLength = Number(lenText);
      const valueStart = cursor + 4;
      const valueEnd = valueStart + declaredLength;
      if (valueEnd > text.length) {
        errors.push(`ID ${id} declares length ${declaredLength}, but only ${text.length - valueStart} characters remain.`);
        break;
      }
      if (seen.has(id)) {
        errors.push(`Duplicate ID ${id} in ${parentId ? `template ${parentId}` : 'root payload'}.`);
      }
      seen.add(id);

      const value = text.slice(valueStart, valueEnd);
      const node = {
        id,
        name: tagName(id, parentId),
        length: declaredLength,
        offset: absoluteOffset,
        raw: text.slice(cursor, valueEnd),
        value,
        children: [],
      };

      if (isTemplate(id) && id !== '63' && value.length >= 4) {
        const childParse = parseTlv(value, id, offset + valueStart);
        if (childParse.nodes.length && childParse.consumed === value.length && childParse.errors.length === 0) {
          node.children = childParse.nodes;
          delete node.value;
        }
      }

      nodes.push(node);
      cursor = valueEnd;
    }

    return { nodes, errors, consumed: cursor };
  }

  function findNode(nodes, id) {
    return nodes.find(node => node.id === id);
  }

  function collectEmptyValueWarnings(nodes, parentPath = []) {
    const warnings = [];

    for (const node of nodes) {
      const path = [...parentPath, node.id];
      if (node.length === 0) {
        warnings.push(`ID ${path.join('-')} (${node.name}) has an empty value.`);
      }
      if (node.children && node.children.length) {
        warnings.push(...collectEmptyValueWarnings(node.children, path));
      }
    }

    return warnings;
  }

  function crcResult(text) {
    if (text.length < 8) {
      return { ok: false, expected: null, actual: null, message: 'Payload is too short to contain a CRC.' };
    }
    const crcTag = text.slice(-8, -4);
    const actual = text.slice(-4).toUpperCase();
    if (crcTag !== '6304') {
      return { ok: false, expected: null, actual, message: 'CRC must be the final data object with ID 63 and length 04.' };
    }
    const expected = global.emvCore.computeCRC(text.slice(0, -4));
    return {
      ok: expected === actual,
      expected,
      actual,
      message: expected === actual ? 'CRC is valid.' : `CRC mismatch: expected ${expected}, found ${actual}.`,
    };
  }

  function validateEmv(text, nodes, parseErrors) {
    const errors = [...parseErrors];
    const warnings = [];
    const ids = nodes.map(node => node.id);

    if (!text) errors.push('Payload is empty.');
    if (nodes.length === 0 && text) errors.push('No complete TLV data objects were parsed.');
    warnings.push(...collectEmptyValueWarnings(nodes));

    for (const id of ['00', '52', '53', '58', '59', '60', '63']) {
      if (!ids.includes(id)) errors.push(`Missing mandatory ID ${id} (${tagName(id)}).`);
    }
    if (!nodes.some(node => Number(node.id) >= 2 && Number(node.id) <= 51)) {
      errors.push('Missing one Merchant Account Information template in ID range 02-51.');
    }

    const payloadFormat = findNode(nodes, '00');
    if (payloadFormat && payloadFormat.value !== '01') errors.push('Payload Format Indicator (ID 00) must be "01".');

    const initiation = findNode(nodes, '01');
    if (initiation && !['11', '12'].includes(initiation.value)) {
      errors.push('Point of Initiation Method (ID 01), when present, must be "11" or "12".');
    }

    const mcc = findNode(nodes, '52');
    if (mcc && !/^\d{4}$/.test(mcc.value)) errors.push('Merchant Category Code (ID 52) must be four digits.');

    const currency = findNode(nodes, '53');
    if (currency && !/^\d{3}$/.test(currency.value)) errors.push('Transaction Currency (ID 53) must be three digits.');

    const amount = findNode(nodes, '54');
    if (amount && !/^\d{1,13}(\.\d{1,2})?$/.test(amount.value)) {
      errors.push('Transaction Amount (ID 54) must be numeric with up to two decimal places.');
    }

    const country = findNode(nodes, '58');
    if (country && !/^[A-Z]{2}$/.test(country.value)) errors.push('Country Code (ID 58) must be two uppercase letters.');

    for (const id of ['59', '60']) {
      const node = findNode(nodes, id);
      if (node && node.length < 1) errors.push(`${tagName(id)} (ID ${id}) must not be empty.`);
    }

    const crc = crcResult(text);
    if (!crc.ok) errors.push(crc.message);
    const crcNode = findNode(nodes, '63');
    if (crcNode && crcNode.length !== 4) errors.push('CRC (ID 63) must have length 04.');
    if (crcNode && nodes[nodes.length - 1] && nodes[nodes.length - 1].id !== '63') {
      errors.push('CRC (ID 63) must be the final data object.');
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      crc,
      checkedRules: [
        'TLV structure and declared lengths',
        'duplicate IDs inside each template',
        'mandatory merchant-presented fields',
        'Payload Format Indicator value',
        'Point of Initiation Method values',
        'basic format checks for MCC, currency, amount, country, merchant name, and merchant city',
        'CRC-16/CCITT-FALSE as final ID 63 length 04',
        'empty values reported as warnings',
      ],
    };
  }

  function rawHex(text) {
    return Array.from(new TextEncoder().encode(text))
      .map(byte => byte.toString(16).toUpperCase().padStart(2, '0'))
      .join(' ');
  }

  function analyzePayload(rawInput) {
    const rawText = String(rawInput || '').trim();
    const bytes = new TextEncoder().encode(rawText);
    const manualParse = parseTlv(rawText);
    const validation = validateEmv(rawText, manualParse.nodes, manualParse.errors);

    return {
      rawText,
      rawHex: rawHex(rawText),
      byteCount: bytes.length,
      charCount: rawText.length,
      tree: manualParse.nodes,
      validation,
      specificationSource: 'specifications/EMVCo-Merchant-Presented-QR-Specification-v1.1-1.pdf',
    };
  }

  global.emvAnalyzer = { analyzePayload };
}(window));
