// Copyright 2026 Gilles Reant. SPDX-License-Identifier: Apache-2.0
importScripts('vendor/jsQR.js', 'opencv-loader.js', 'qr-decoder.js');
self.onmessage = async ({ data: { bitmap, options } }) => {
  try { self.postMessage({ result: await emvDecoder.decode(bitmap, options) }); }
  catch (error) { self.postMessage({ error: { name: error.name, message: error.message } }); }
  finally { bitmap.close(); }
};
