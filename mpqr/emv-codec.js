// Copyright 2026 Gilles Reant. SPDX-License-Identifier: Apache-2.0
(function (global) {
  const Fields = Object.freeze({
    PAYLOAD_FORMAT_INDICATOR: '00',
    POINT_OF_INITIATION_METHOD: '01',
    MERCHANT_CATEGORY_CODE: '52',
    TRANSACTION_CURRENCY: '53',
    TRANSACTION_AMOUNT: '54',
    TIP_OR_CONVENIENCE_INDICATOR: '55',
    VALUE_OF_CONVENIENCE_FEE_FIXED: '56',
    VALUE_OF_CONVENIENCE_FEE_PERCENTAGE: '57',
    COUNTRY_CODE: '58',
    MERCHANT_NAME: '59',
    MERCHANT_CITY: '60',
    POSTAL_CODE: '61',
    ADDITIONAL_DATA_FIELD_TEMPLATE: '62',
    CRC: '63',
    MERCHANT_INFORMATION_LANGUAGE_TEMPLATE: '64',
  });
  const AdditionalDataFields = Object.freeze({
    BILL_NUMBER: '01',
    MOBILE_NUMBER: '02',
    STORE_LABEL: '03',
    LOYALTY_NUMBER: '04',
    REFERENCE_LABEL: '05',
    CUSTOMER_LABEL: '06',
    TERMINAL_LABEL: '07',
    PURPOSE_OF_TRANSACTION: '08',
    ADDITIONAL_CONSUMER_DATA_REQUEST: '09',
  });
  const LanguageFields = Object.freeze({
    LANGUAGE_PREFERENCE: '00',
    MERCHANT_NAME_ALTERNATE_LANGUAGE: '01',
    MERCHANT_CITY_ALTERNATE_LANGUAGE: '02',
  });
  const TemplateFields = Object.freeze({ GLOBALLY_UNIQUE_IDENTIFIER: '00' });

  const limits = Object.freeze({ maxCharacters: 16384, maxNodes: 1024, maxDepth: 8 });
  const characterCount = value => Array.from(value).length;
  const toHex = value => Array.from(new TextEncoder().encode(value), byte => byte.toString(16).toUpperCase().padStart(2, '0')).join(' ');

  function normalizeId(value) {
    const id = String(value).trim();
    if (!/^\d{1,2}$/.test(id)) throw new TypeError('Field IDs must contain one or two digits.');
    return id.padStart(2, '0');
  }

  function normalizeFields(input) {
    const active = new Set();
    let count = 0;
    function visit(fields, depth) {
      if (!Array.isArray(fields)) throw new TypeError('fields must be an array.');
      if (depth > limits.maxDepth || active.has(fields)) throw new RangeError('Fields are cyclic or exceed the nesting limit.');
      active.add(fields);
      const result = fields.map(field => {
        if (++count > limits.maxNodes) throw new RangeError('Too many fields.');
        if (!field || typeof field !== 'object' || Array.isArray(field)) throw new TypeError('Each field must be an object.');
        let id, value;
        if (Object.hasOwn(field, 'id')) {
          if (Object.keys(field).some(key => !['id', 'value', 'children'].includes(key))) throw new TypeError('Unknown field property.');
          if (Object.hasOwn(field, 'value') === Object.hasOwn(field, 'children')) throw new TypeError('Define either value or children.');
          id = normalizeId(field.id);
          value = Object.hasOwn(field, 'children') ? field.children : field.value;
        } else {
          const keys = Object.keys(field);
          if (keys.length !== 1) throw new TypeError('Each field must have exactly one ID key.');
          id = normalizeId(keys[0]);
          value = field[keys[0]];
        }
        if (Array.isArray(value)) return { [id]: visit(value, depth + 1) };
        if (typeof value !== 'string' && typeof value !== 'number') throw new TypeError(`Field ${id} must contain text or child fields.`);
        value = String(value);
        if (characterCount(value) > 99) throw new RangeError(`Field ${id} exceeds 99 characters.`);
        if (new TextDecoder().decode(new TextEncoder().encode(value)) !== value) throw new TypeError(`Field ${id} contains an unpaired Unicode surrogate.`);
        return { [id]: value };
      });
      active.delete(fields);
      return result;
    }
    return visit(input, 0);
  }

  function serialize(fields) {
    function encode(list) {
      return list.map(field => {
        const [id, input] = Object.entries(field)[0];
        const value = Array.isArray(input) ? encode(input) : input;
        const length = characterCount(value);
        if (length > 99) throw new RangeError(`Field ${id} exceeds 99 characters.`);
        return `${id}${String(length).padStart(2, '0')}${value}`;
      }).join('');
    }
    const text = encode(normalizeFields(fields));
    if (characterCount(text) > limits.maxCharacters) throw new RangeError('Payload is too large.');
    return text;
  }

  function buildPayload(input, options = {}) {
    let fields = normalizeFields(input);
    if (!fields.some(field => Object.hasOwn(field, '00'))) fields.unshift({ '00': '01' });
    if (!fields.some(field => Object.hasOwn(field, '01'))) fields.splice(fields.findIndex(field => Object.hasOwn(field, '00')) + 1, 0, { '01': '11' });
    const crcs = fields.filter(field => Object.hasOwn(field, '63'));
    if (options.preserveExistingCrc === true && crcs.length) {
      const payload = serialize(fields);
      if (crcs.length !== 1 || fields.at(-1) !== crcs[0] || !/^[A-Fa-f0-9]{4}$/.test(crcs[0]['63'])) throw new TypeError('Field 63 must be a single final four-digit hexadecimal CRC.');
      const crc = global.CRC16.computeCRC(payload.slice(0, -4));
      if (crc !== crcs[0]['63'].toUpperCase()) throw new TypeError('Existing CRC does not match the payload.');
      return { fields, payload, crc };
    }
    fields = fields.filter(field => !Object.hasOwn(field, '63'));
    const prefix = `${serialize(fields)}6304`;
    const crc = global.CRC16.computeCRC(prefix);
    return { fields, payload: prefix + crc, crc };
  }

  global.emvCodec = {
    Fields, AdditionalDataFields, LanguageFields, TemplateFields,
    limits, normalizeFields, serialize, buildPayload, characterCount, toHex,
  };
}(globalThis));
