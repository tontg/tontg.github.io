(function (global) {
  function encodeUtf8(text) {
    return new TextEncoder().encode(String(text));
  }

  function decodeUtf8(bytes) {
    return new TextDecoder().decode(bytes);
  }

  function concatBytes(parts) {
    const total = parts.reduce((sum, part) => sum + part.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) {
      out.set(part, offset);
      offset += part.length;
    }
    return out;
  }

  function uintBytes(value, width) {
    const out = new Uint8Array(width);
    let current = BigInt(value);
    for (let index = width - 1; index >= 0; index -= 1) {
      out[index] = Number(current & 0xffn);
      current >>= 8n;
    }
    return out;
  }

  function encodeLength(majorType, length) {
    const size = BigInt(length);
    if (size < 24n) return Uint8Array.of((majorType << 5) | Number(size));
    if (size <= 0xffn) return Uint8Array.of((majorType << 5) | 24, Number(size));
    if (size <= 0xffffn) return concatBytes([Uint8Array.of((majorType << 5) | 25), uintBytes(size, 2)]);
    if (size <= 0xffffffffn) return concatBytes([Uint8Array.of((majorType << 5) | 26), uintBytes(size, 4)]);
    return concatBytes([Uint8Array.of((majorType << 5) | 27), uintBytes(size, 8)]);
  }

  function encodeNumber(value) {
    if (!Number.isFinite(value)) {
      throw new Error('CBOR helper does not support NaN or Infinity.');
    }
    if (Object.is(value, -0)) {
      const buffer = new ArrayBuffer(8);
      const view = new DataView(buffer);
      view.setFloat64(0, value);
      return concatBytes([Uint8Array.of(0xfb), new Uint8Array(buffer)]);
    }
    if (Number.isInteger(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER) {
      if (value >= 0) return encodeLength(0, value);
      return encodeLength(1, -1 - value);
    }
    const buffer = new ArrayBuffer(8);
    const view = new DataView(buffer);
    view.setFloat64(0, value);
    return concatBytes([Uint8Array.of(0xfb), new Uint8Array(buffer)]);
  }

  function encodeValue(value) {
    if (value === false) return Uint8Array.of(0xf4);
    if (value === true) return Uint8Array.of(0xf5);
    if (value === null) return Uint8Array.of(0xf6);
    if (value === undefined) return Uint8Array.of(0xf7);
    if (typeof value === 'number') return encodeNumber(value);
    if (typeof value === 'string') {
      const bytes = encodeUtf8(value);
      return concatBytes([encodeLength(3, bytes.length), bytes]);
    }
    if (value instanceof Uint8Array) {
      return concatBytes([encodeLength(2, value.length), value]);
    }
    if (Array.isArray(value)) {
      const items = value.map(encodeValue);
      return concatBytes([encodeLength(4, items.length), ...items]);
    }
    if (typeof value === 'object') {
      const entries = Object.entries(value);
      const encodedEntries = [];
      for (const [key, entryValue] of entries) {
        encodedEntries.push(encodeValue(key));
        encodedEntries.push(encodeValue(entryValue));
      }
      return concatBytes([encodeLength(5, entries.length), ...encodedEntries]);
    }
    throw new Error(`Unsupported value type: ${typeof value}`);
  }

  function bytesToBase64Url(bytes) {
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  function base64UrlToBytes(text) {
    const normalized = String(text).replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '==='.slice((normalized.length + 3) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  }

  function readLength(bytes, offset, additionalInfo) {
    if (additionalInfo < 24) {
      return { length: additionalInfo, offset };
    }
    if (additionalInfo === 24) {
      return { length: bytes[offset], offset: offset + 1 };
    }
    if (additionalInfo === 25) {
      return { length: (bytes[offset] << 8) | bytes[offset + 1], offset: offset + 2 };
    }
    if (additionalInfo === 26) {
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      return { length: view.getUint32(offset), offset: offset + 4 };
    }
    if (additionalInfo === 27) {
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const value = view.getBigUint64(offset);
      if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new Error('CBOR integer exceeds JavaScript safe integer range.');
      }
      return { length: Number(value), offset: offset + 8 };
    }
    throw new Error('Indefinite-length CBOR items are not supported by this helper.');
  }

  function decodeValue(bytes, startOffset = 0) {
    const initialByte = bytes[startOffset];
    if (initialByte === undefined) throw new Error('Unexpected end of CBOR input.');

    const majorType = initialByte >> 5;
    const additionalInfo = initialByte & 0x1f;
    let offset = startOffset + 1;

    if (majorType === 0 || majorType === 1) {
      const lengthInfo = readLength(bytes, offset, additionalInfo);
      const integerValue = lengthInfo.length;
      return {
        value: majorType === 0 ? integerValue : -1 - integerValue,
        offset: lengthInfo.offset,
      };
    }

    if (majorType === 2) {
      const lengthInfo = readLength(bytes, offset, additionalInfo);
      const end = lengthInfo.offset + lengthInfo.length;
      return {
        value: bytes.slice(lengthInfo.offset, end),
        offset: end,
      };
    }

    if (majorType === 3) {
      const lengthInfo = readLength(bytes, offset, additionalInfo);
      const end = lengthInfo.offset + lengthInfo.length;
      return {
        value: decodeUtf8(bytes.slice(lengthInfo.offset, end)),
        offset: end,
      };
    }

    if (majorType === 4) {
      const lengthInfo = readLength(bytes, offset, additionalInfo);
      const items = [];
      offset = lengthInfo.offset;
      for (let index = 0; index < lengthInfo.length; index += 1) {
        const decoded = decodeValue(bytes, offset);
        items.push(decoded.value);
        offset = decoded.offset;
      }
      return { value: items, offset };
    }

    if (majorType === 5) {
      const lengthInfo = readLength(bytes, offset, additionalInfo);
      const out = {};
      offset = lengthInfo.offset;
      for (let index = 0; index < lengthInfo.length; index += 1) {
        const keyResult = decodeValue(bytes, offset);
        const valueResult = decodeValue(bytes, keyResult.offset);
        out[String(keyResult.value)] = valueResult.value;
        offset = valueResult.offset;
      }
      return { value: out, offset };
    }

    if (majorType === 7) {
      if (additionalInfo === 20) return { value: false, offset };
      if (additionalInfo === 21) return { value: true, offset };
      if (additionalInfo === 22) return { value: null, offset };
      if (additionalInfo === 23) return { value: undefined, offset };
      if (additionalInfo === 27) {
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        return { value: view.getFloat64(offset), offset: offset + 8 };
      }
    }

    throw new Error(`Unsupported CBOR major type/additional info: ${majorType}/${additionalInfo}`);
  }

  function encodeToCborBytes(value) {
    return encodeValue(value);
  }

  function encodeToBase64Url(value) {
    return bytesToBase64Url(encodeToCborBytes(value));
  }

  function decodeFromCborBytes(bytes) {
    const result = decodeValue(bytes, 0);
    if (result.offset !== bytes.length) {
      throw new Error('Trailing bytes remain after CBOR decode.');
    }
    return result.value;
  }

  function decodeFromBase64Url(text) {
    return decodeFromCborBytes(base64UrlToBytes(text));
  }

  global.cborBase64Url = {
    base64UrlToBytes,
    bytesToBase64Url,
    decode: decodeFromBase64Url,
    decodeFromBase64Url,
    decodeFromCborBytes,
    encode: encodeToBase64Url,
    encodeToBase64Url,
    encodeToCborBytes,
  };
}(window));
