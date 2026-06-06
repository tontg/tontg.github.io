(function (global) {
  function computeCRC(text) {
    const bytes = new TextEncoder().encode(text);
    let crc = 0xffff;

    for (const byte of bytes) {
      crc ^= byte << 8;
      for (let bit = 0; bit < 8; bit += 1) {
        crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) : (crc << 1);
        crc &= 0xffff;
      }
    }

    return crc.toString(16).toUpperCase().padStart(4, '0');
  }

  global.CRC16 = { computeCRC };
  global.emvCore = global.CRC16;
}(window));
