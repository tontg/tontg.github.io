// app.js

const video = document.getElementById('video');
const btnStartCamera = document.getElementById('btn-start-camera');
const btnStopCamera = document.getElementById('btn-stop-camera');
const btnCapture = document.getElementById('btn-capture');
const fileInput = document.getElementById('file-input');

const ditherSelect = document.getElementById('dither-select');
const prefixInput = document.getElementById('prefix-line');
const printDateCheckbox = document.getElementById('print-date');
const enableCropCheckbox = document.getElementById('enable-crop');
const autoFixHistogramCheckbox = document.getElementById('auto-fix-histogram');

const workCanvas = document.getElementById('work-canvas');
const previewCanvas = document.getElementById('preview-canvas');
const cropOverlay = document.getElementById('crop-overlay');
const workCtx = workCanvas.getContext('2d');
const previewCtx = previewCanvas.getContext('2d');
const cropCtx = cropOverlay.getContext('2d');

const statusLine = document.getElementById('status-line');

const btRadio = document.getElementById('bt-radio');
const btLabel = document.getElementById('bt-label');
const btWarning = document.getElementById('bt-warning');

const btnProcess = document.getElementById('btn-process');
const btnSend = document.getElementById('btn-send');

let stream = null;
let processedBytes = null;   // Uint8Array of 1-bit packed data
let processedWidth = 0;
let processedHeight = 0;

// Crop selection
let cropRect = null; // {x, y, w, h}
let isDragging = false;
let dragStart = null;

// --- Web Bluetooth global state for POS-5809LN ---
let blePrinter = {
  device: null,
  server: null,
  service: null,
  characteristic: null
};

// Known services on your printer: FFE0, 18F0, E7810A71-73AE-499D-8C15-FAA9AEF0C3F2
// Common patterns for BLE thermal printers:
//
//  - Service 0xFFE0 with TX characteristic 0xFFE1
//  - Sometimes a vendor service with a single writable characteristic
//
// We'll try the vendor service first, then FFE0, then 18F0.
const BLE_SERVICE_CANDIDATES = [
  // Vendor-specific service from your printer:
  '49535343-fe7d-4ae5-8fa9-9fafd205e455',
  //'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
  // Generic ESP-style UUIDs for 0xFFE0 / 0x18F0:
  // 0xffe0,
  // 0x18f0
];

// Common write characteristics many printers use (we will probe them):
const BLE_CHARACTERISTIC_CANDIDATES = [
  // 0xffe1,
  // 0x2af0,
  // 0x2af1, // sometimes used with 0x18F0
  "49535343-8841-43f4-a8d4-ecbe34729bb3"
];

async function ensureBlePrinterConnected() {
  // Already connected & characteristic ready?
  if (blePrinter.characteristic && blePrinter.server?.connected) {
    return blePrinter.characteristic;
  }

  if (!navigator.bluetooth) {
    throw new Error("Web Bluetooth not supported in this browser.");
  }

  // Request device (filter by advertised services if possible)
  // If your printer shows up with a specific name like "POS-5809LN",
  // you can add: filters: [{ namePrefix: "POS" }]
  /*
{
    // acceptAllDevices: true is most robust, services go in optionalServices
    //acceptAllDevices: true,
    optionalServices: BLE_SERVICE_CANDIDATES
  }
  */


  // leads to Chrome error "Could not find a suitable BLE Service on printer."
  /*
{
    filters: [
      { name: "BlueTooth Printer" }
    ]
  }
  */
  const device = await navigator.bluetooth.requestDevice({
    // acceptAllDevices: true is most robust, services go in optionalServices
    acceptAllDevices: true,
    optionalServices: BLE_SERVICE_CANDIDATES
  });

  console.log("found bluetooth device:");
  console.dir(device);

  blePrinter.device = device;
  blePrinter.server = await device.gatt.connect();

  // Try candidate services in order
  let service = null;
  for (const svc of BLE_SERVICE_CANDIDATES) {
    try {
      service = await blePrinter.server.getPrimaryService(svc);
      console.log("Using BLE service:", svc);
      break;
    } catch (e) {
      console.log("Service candidate failed:", svc, e);
    }
  }

  if (!service) {
    throw new Error("Could not find a suitable BLE service on printer.");
  }

  blePrinter.service = service;

  // Try to find a writable characteristic
  let characteristic = null;

  // 1) Try known characteristic UUIDs
  for (const ch of BLE_CHARACTERISTIC_CANDIDATES) {
    try {
      characteristic = await service.getCharacteristic(ch);
      console.log("Using known characteristic:", ch);
      break;
    } catch (e) {
      console.log("Characteristic candidate failed:", ch, e);
    }
  }

  // 2) Fallback: enumerate all characteristics and pick the first writable one
  if (!characteristic) {
    const chars = await service.getCharacteristics();
    console.log("found caracteristics for service");
    console.dir(service);
    console.dir(chars);
    for (const c of chars) {
      // Try to detect write / writeWithoutResponse
      const props = c.properties;
      if (props.write || props.writeWithoutResponse) {
        characteristic = c;
        console.log("Using discovered writable characteristic:", c.uuid);
        break;
      }
    }
  }

  if (!characteristic) {
    throw new Error("No writable characteristic found on printer.");
  }

  blePrinter.characteristic = characteristic;
  console.log("BLE printer connected / characteristic ready.");
  return characteristic;
}

// printData is expected to be a Uint8Array containing ESC/POS commands
// for the image/text you want to print.
async function printViaWebBluetooth(printData) {
  console.log("printViaWebBluetooth, printData:" + printData.length);
  try {
    const ch = await ensureBlePrinterConnected();

    // Many BLE stacks limit MTU to around 185 bytes,
    // so keep chunks safely below that.
    const MAX_CHUNK = 180;

    let offset = 0;
    while (offset < printData.length) {
      const end = Math.min(offset + MAX_CHUNK, printData.length);
      const chunk = printData.slice(offset, end);

      // console.log("sending...");
      // console.dir(chunk);

      // Prefer writeWithoutResponse if available (faster / no backpressure)
      if (ch.properties.writeWithoutResponse) {
        await ch.writeValueWithoutResponse(chunk);
      } else {
        await ch.writeValue(chunk);
      }

      offset = end;

      // Tiny delay to avoid overloading the radio stack
      await new Promise(resolve => setTimeout(resolve, 10));
    }

    console.log("Web Bluetooth print job sent.");
  } catch (err) {
    console.error("Web Bluetooth print error:", err);
    alert("Bluetooth print failed: " + (err?.message || err));
  }
}


// ------------- Init: Web Bluetooth capability -------------

(function initBluetoothSupport() {
  if (!navigator.bluetooth) {
    btRadio.disabled = true;
    btLabel.classList.add('disabled');
    btWarning.textContent = "Direct Bluetooth printing not available (Web Bluetooth not supported in this browser).";
  } else {
    btWarning.textContent = "";
  }
})();

// ------------- Camera handling -------------

btnStartCamera.addEventListener('click', async () => {
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    video.srcObject = stream;
    statusLine.textContent = "Camera started. Capture a frame when ready.";
  } catch (err) {
    console.error(err);
    statusLine.textContent = "Failed to start camera: " + err.message;
  }
});

btnStopCamera.addEventListener('click', () => {
  if (stream) {
    stream.getTracks().forEach(t => t.stop());
    stream = null;
    video.srcObject = null;
    statusLine.textContent = "Camera stopped.";
  }
});

btnCapture.addEventListener('click', () => {
  if (!stream) {
    statusLine.textContent = "Camera not started.";
    return;
  }
  // Draw video frame into work canvas
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (!w || !h) {
    statusLine.textContent = "No frame available yet.";
    return;
  }
  workCanvas.width = w;
  workCanvas.height = h;
  workCtx.drawImage(video, 0, 0, w, h);
  cropOverlay.width = w;
  cropOverlay.height = h;
  cropRect = null;
  clearCropOverlay();

  // Stop camera after capturing
  stream.getTracks().forEach(t => t.stop());
  stream = null;
  video.srcObject = null;

  statusLine.textContent = "Captured frame. Adjust rotation/dithering and process.";
  updatePreview();
});

// ------------- File input -------------

fileInput.addEventListener('change', () => {
  const file = fileInput.files[0];
  if (!file) return;
  const img = new Image();
  img.onload = () => {
    workCanvas.width = img.width;
    workCanvas.height = img.height;
    workCtx.drawImage(img, 0, 0);
    cropOverlay.width = img.width;
    cropOverlay.height = img.height;
    cropRect = null;
    clearCropOverlay();
    statusLine.textContent = "Image loaded. Adjust rotation/dithering and process.";
    updatePreview();
  };
  img.onerror = err => {
    console.error(err);
    statusLine.textContent = "Failed to load image.";
  };
  const url = URL.createObjectURL(file);
  img.src = url;
});

// ------------- Rotation + dithering preview -------------

ditherSelect.addEventListener('change', updatePreview);
autoFixHistogramCheckbox.addEventListener('change', updatePreview);
enableCropCheckbox.addEventListener('change', () => {
  cropOverlay.style.pointerEvents = enableCropCheckbox.checked ? 'auto' : 'none';
  if (!enableCropCheckbox.checked) {
    cropRect = null;
    clearCropOverlay();
  }
  updatePreview();
});

// Crop overlay event listeners
cropOverlay.addEventListener('mousedown', (e) => {
  if (!enableCropCheckbox.checked) return;
  // console.log("work canvas:", workCanvas.clientWidth, workCanvas.client);
  const rect = cropOverlay.getBoundingClientRect();
  const ratio = workCanvas.width / workCanvas.clientWidth;
  dragStart = { x: (e.clientX - rect.left) * ratio, y: (e.clientY - rect.top) * ratio };
  isDragging = true;
  cropOverlay.style.cursor = 'nw-resize';
});

cropOverlay.addEventListener('mousemove', (e) => {
  if (!isDragging || !enableCropCheckbox.checked) return;
  const rect = cropOverlay.getBoundingClientRect();
  const ratio = workCanvas.width / workCanvas.clientWidth;
  const current = { x: (e.clientX - rect.left) * ratio, y: (e.clientY - rect.top) * ratio };
  cropRect = {
    x: Math.min(dragStart.x, current.x),
    y: Math.min(dragStart.y, current.y),
    w: Math.abs(current.x - dragStart.x),
    h: Math.abs(current.y - dragStart.y)
  };
  drawCropOverlay();
});

cropOverlay.addEventListener('mouseup', () => {
  if (!enableCropCheckbox.checked) return;
  isDragging = false;
  cropOverlay.style.cursor = 'default';
  updatePreview();
});

function clearCropOverlay() {
  cropCtx.clearRect(0, 0, cropOverlay.width, cropOverlay.height);
}

function drawCropOverlay() {
  clearCropOverlay();
  if (!cropRect) return;
  cropOverlay.width = workCanvas.width;
  cropOverlay.height = workCanvas.height;
  cropCtx.strokeStyle = 'red';
  cropCtx.lineWidth = 2;
  cropCtx.strokeRect(cropRect.x, cropRect.y, cropRect.w, cropRect.h);
  cropCtx.fillStyle = 'rgba(255, 0, 0, 0.1)';
  cropCtx.fillRect(cropRect.x, cropRect.y, cropRect.w, cropRect.h);
}

function updatePreview() {
  if (workCanvas.width === 0 || workCanvas.height === 0) {
    return;
  }

  // Start with workCanvas, apply crop if enabled
  let srcCanvas = workCanvas;
  if (enableCropCheckbox.checked && cropRect) {
    const cropped = document.createElement('canvas');
    cropped.width = cropRect.w;
    cropped.height = cropRect.h;
    const croppedCtx = cropped.getContext('2d');
    croppedCtx.drawImage(workCanvas, cropRect.x, cropRect.y, cropRect.w, cropRect.h, 0, 0, cropRect.w, cropRect.h);
    srcCanvas = cropped;
  }

  // Apply resizing if width > 384 (no rotation in preview)
  if (srcCanvas.width > 384) {
    srcCanvas = lanczosResize(srcCanvas, 384);
  }

  let srcW = srcCanvas.width;
  let srcH = srcCanvas.height;

  previewCanvas.width = srcW;
  previewCanvas.height = srcH;

  // Draw grayscale
  const tmpCanvas = document.createElement('canvas');
  tmpCanvas.width = srcW;
  tmpCanvas.height = srcH;
  const tmpCtx = tmpCanvas.getContext('2d');
  tmpCtx.drawImage(srcCanvas, 0, 0);

  let imgData = tmpCtx.getImageData(0, 0, srcW, srcH);
  let gray = toGrayscale(imgData);

  // Apply histogram equalization if enabled
  if (autoFixHistogramCheckbox.checked) {
    gray = histogramEqualize(gray, srcW, srcH);
  }

  const mode = ditherSelect.value;
  let bw;

  if (mode === 'none') {
    bw = threshold(gray, srcW, srcH, 128);
  } else if (mode === 'bayer') {
    bw = orderedBayer(gray, srcW, srcH);
  } else if (mode === 'floyd') {
    bw = floydSteinberg(gray, srcW, srcH);
  } else if (mode === 'atkinson') {
    bw = atkinson(gray, srcW, srcH);
  }

  // Draw 1-bit preview (black/white)
  const out = previewCtx.createImageData(srcW, srcH);
  for (let i = 0; i < srcW * srcH; i++) {
    const v = bw[i] ? 0 : 255;
    out.data[i * 4 + 0] = v;
    out.data[i * 4 + 1] = v;
    out.data[i * 4 + 2] = v;
    out.data[i * 4 + 3] = 255;
  }
  previewCtx.putImageData(out, 0, 0);
}

// ------------- Grayscale + dithering helpers -------------

function toGrayscale(imgData) {
  const { data, width, height } = imgData;
  const gray = new Uint8ClampedArray(width * height);
  for (let i = 0; i < width * height; i++) {
    const r = data[i * 4 + 0];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    gray[i] = 0.299 * r + 0.587 * g + 0.114 * b;
  }
  return gray;
}

function threshold(gray, w, h, t) {
  const out = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    out[i] = gray[i] < t ? 1 : 0;
  }
  return out;
}

function orderedBayer(gray, w, h) {
  const out = new Uint8Array(w * h);
  const bayer = [
    [15, 7, 13, 5],
    [3, 11, 1, 9],
    [12, 4, 14, 6],
    [0, 8, 2, 10]
  ];
  const n = 4;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const threshold = (bayer[y % n][x % n] + 0.5) * (255 / (n * n));
      out[i] = (gray[i] < threshold) ? 1 : 0;
    }
  }
  return out;
}

function floydSteinberg(gray, w, h) {
  const out = new Uint8Array(w * h);
  const g = new Float32Array(gray); // work copy
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const old = g[i];
      const newVal = old < 128 ? 0 : 255;
      const err = old - newVal;
      out[i] = newVal === 0 ? 1 : 0;
      // Distribute error
      if (x + 1 < w) g[i + 1] += err * 7 / 16;
      if (y + 1 < h) {
        if (x > 0) g[i + w - 1] += err * 3 / 16;
        g[i + w] += err * 5 / 16;
        if (x + 1 < w) g[i + w + 1] += err * 1 / 16;
      }
    }
  }
  return out;
}

function atkinson(gray, w, h) {
  const out = new Uint8Array(w * h);
  const g = new Float32Array(gray);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const old = g[i];
      const newVal = old < 128 ? 0 : 255;
      const err = (old - newVal) / 8;
      out[i] = newVal === 0 ? 1 : 0;

      function add(xo, yo) {
        const nx = x + xo;
        const ny = y + yo;
        if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
          g[ny * w + nx] += err;
        }
      }

      add(1, 0);
      add(2, 0);
      add(-1, 1);
      add(0, 1);
      add(1, 1);
      add(0, 2);
    }
  }
  return out;
}

// Histogram equalization to enhance contrast (simulate HDR)
function histogramEqualize(gray, w, h) {
  const hist = new Uint32Array(256);
  for (let i = 0; i < w * h; i++) {
    hist[gray[i]]++;
  }
  const cdf = new Uint32Array(256);
  cdf[0] = hist[0];
  for (let i = 1; i < 256; i++) {
    cdf[i] = cdf[i - 1] + hist[i];
  }
  const cdfMin = cdf.find(v => v > 0);
  const total = w * h;
  const equalized = new Uint8ClampedArray(w * h);
  for (let i = 0; i < w * h; i++) {
    equalized[i] = Math.round(((cdf[gray[i]] - cdfMin) / (total - cdfMin)) * 255);
  }
  return equalized;
}

// ------------- Process → pack 1-bit data -------------

// Pack any canvas into 1-bit packed bytes (row-major, MSB leftmost)
// using currently selected dithering. Returns { packed, width, height }.
function packCanvasTo1Bit(srcCanvas) {
  const w = srcCanvas.width;
  const h = srcCanvas.height;
  const ctx = srcCanvas.getContext('2d');
  const imgData = ctx.getImageData(0, 0, w, h);
  let gray = toGrayscale(imgData);

  // Apply histogram equalization if enabled
  if (autoFixHistogramCheckbox.checked) {
    gray = histogramEqualize(gray, w, h);
  }

  const mode = ditherSelect.value;
  let bw;
  if (mode === 'none') bw = threshold(gray, w, h, 128);
  else if (mode === 'bayer') bw = orderedBayer(gray, w, h);
  else if (mode === 'floyd') bw = floydSteinberg(gray, w, h);
  else if (mode === 'atkinson') bw = atkinson(gray, w, h);

  const bytesPerRow = Math.ceil(w / 8);
  const totalBytes = bytesPerRow * h;
  const packed = new Uint8Array(totalBytes);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const bit = bw[y * w + x];
      const byteIndex = y * bytesPerRow + (x >> 3);
      const bitIndex = 7 - (x & 7);
      if (bit) packed[byteIndex] |= (1 << bitIndex);
    }
  }

  return { packed, width: w, height: h };
}

// Lanczos resampling for downscaling (approximate implementation)
function lanczosResize(srcCanvas, targetWidth) {
  const srcW = srcCanvas.width;
  const srcH = srcCanvas.height;
  const targetHeight = Math.round(targetWidth * (srcH / srcW));

  const dstCanvas = document.createElement('canvas');
  dstCanvas.width = targetWidth;
  dstCanvas.height = targetHeight;
  const dstCtx = dstCanvas.getContext('2d');

  // Use Canvas's built-in scaling (bilinear), approximating Lanczos for simplicity
  dstCtx.drawImage(srcCanvas, 0, 0, targetWidth, targetHeight);
  return dstCanvas;
}

btnProcess.addEventListener('click', () => {
  if (previewCanvas.width === 0 || previewCanvas.height === 0) {
    statusLine.textContent = "No image to process.";
    return;
  }
  const w = previewCanvas.width;
  const h = previewCanvas.height;
  const imgData = previewCtx.getImageData(0, 0, w, h);
  const bw = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const r = imgData.data[i * 4 + 0];
    bw[i] = (r < 128) ? 1 : 0;
  }

  // Pack 8 pixels per byte, row-major
  const bytesPerRow = Math.ceil(w / 8);
  const totalBytes = bytesPerRow * h;
  const packed = new Uint8Array(totalBytes);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const bit = bw[y * w + x];
      const byteIndex = y * bytesPerRow + (x >> 3);
      const bitIndex = 7 - (x & 7);
      if (bit) {
        packed[byteIndex] |= (1 << bitIndex);
      }
    }
  }

  processedBytes = packed;
  processedWidth = w;
  processedHeight = h;
  statusLine.textContent = `Processed image to 1-bit: ${w}x${h}, ${totalBytes} bytes.`;
});


// Build ESC/POS byte stream for a 1-bit dithered ImageData
// to print with GS v 0 on the POS-5809LN.
function buildPrinterDataFromImage(processedBytes, width, height, prefixText, printDate) {
  const ESC = 0x1B;
  const GS = 0x1D;
  const LF = 0x0A;

  // const width = processedWidth;
  // const height = processedHeight;
  //const rgba = processedBytes; // Uint8ClampedArray, length = width * height * 4

  console.log("width: " + width + "px");
  console.log("height: " + height + "px");
  console.log("image: " + processedBytes.length + " bytes to be sent");;
  const encoder = new TextEncoder();

  const out = [];

  // --- 2. ESC/POS raster header (GS v 0) ---
  const bytesPerRow = Math.ceil(width / 8);        // number of data bytes per raster row
  const xL = bytesPerRow & 0xff;
  const xH = (bytesPerRow >> 8) & 0xff;
  const yL = height & 0xff;
  const yH = (height >> 8) & 0xff;

  // Initialize printer (ESC @)
  out.push(ESC, 0x40);

  // Optional: small line spacing for images (ESC 3 0)
  out.push(ESC, 0x33, 0x00);

  // If a prefix text was provided, send it as plain text (followed by LF)
  if (prefixText && prefixText.length) {
    const txt = encoder.encode(prefixText);
    out.push(...txt);
    out.push(LF);
  }

  // Reset printer before image to clear any residual bitmap buffer data
  out.push(ESC, 0x40);

  // GS v 0 m xL xH yL yH
  const m = 0; // normal density
  out.push(GS, 0x76, 0x30, m, xL, xH, yL, yH);

  out.push(...processedBytes);

  // Feed a line after the bitmap
  out.push(LF);

  // Optionally print localized date/time below the image
  // console.log("printDate?", printDate);
  if (printDate) {
    const dateStr = new Date().toLocaleString(undefined, {
      weekday: "short",
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "numeric"
    });
    const db = encoder.encode(dateStr);
    out.push(...db);
    out.push(LF);
  }

  // Ensure at least one final line feed at the very end
  out.push(LF);

  return new Uint8Array(out);
}


// ------------- Send to printer (Wi-Fi or BT) -------------

btnSend.addEventListener('click', async () => {
  if (!processedBytes) {
    statusLine.textContent = "Nothing processed yet. Click 'Process' first.";
    return;
  }

  const connMode = document.querySelector('input[name="connMode"]:checked').value;

  // New logic: if source width > 384, rotate if needed, then resize if still > 384
  let finalCanvas = workCanvas; // start with original
  let statusMsg = "Sending processed image";

  console.dir(workCanvas);
  // Apply cropping if enabled
  if (enableCropCheckbox.checked && cropRect) {
    const cropped = document.createElement('canvas');
    cropped.width = cropRect.w;
    cropped.height = cropRect.h;
    const croppedCtx = cropped.getContext('2d');
    croppedCtx.drawImage(workCanvas, cropRect.x, cropRect.y, cropRect.w, cropRect.h, 0, 0, cropRect.w, cropRect.h);
    finalCanvas = cropped;
    statusMsg = `Cropped for printing: ${finalCanvas.width}x${finalCanvas.height}`;
  }

  if (finalCanvas.width > 384) {
    // First, rotate if width > height
    if (finalCanvas.width > finalCanvas.height) {
      const tmp = document.createElement('canvas');
      tmp.width = finalCanvas.height;
      tmp.height = finalCanvas.width;
      const tctx = tmp.getContext('2d');
      tctx.save();
      tctx.translate(0, tmp.height);
      tctx.rotate(-Math.PI / 2);
      tctx.drawImage(finalCanvas, 0, 0);
      tctx.restore();
      finalCanvas = tmp;
      statusMsg = `Rotated for printing: ${finalCanvas.width}x${finalCanvas.height}`;
    }

    // Now, if still > 384, resize to 384 width maintaining ratio
    if (finalCanvas.width > 384) {
      finalCanvas = lanczosResize(finalCanvas, 384);
      statusMsg = `Resized for printing: ${finalCanvas.width}x${finalCanvas.height}`;
    }
  }

  // Pack the final canvas
  const res = packCanvasTo1Bit(finalCanvas);
  const sendBytes = res.packed;
  const sendW = res.width;
  const sendH = res.height;

  statusLine.textContent = statusMsg;

  const prefixText = prefixInput ? prefixInput.value.trim() : '';
  const wantDate = printDateCheckbox ? printDateCheckbox.checked : false;

  const printData = buildPrinterDataFromImage(sendBytes, sendW, sendH, prefixText, wantDate);

  if (connMode === "bt") {
    await printViaWebBluetooth(printData);
  } else {
    await sendViaWifi(printData);
  }

});

async function sendViaWifi(printData) {
  try {
    statusLine.textContent = "Sending to ESP32 via /print...";
    const res = await fetch('/print', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream'
      },
      body: printData
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const txt = await res.text();
    statusLine.textContent = "Sent via Wi-Fi. Response: " + txt;
  } catch (err) {
    console.error(err);
    statusLine.textContent = "Error sending via Wi-Fi: " + err.message;
  }
}