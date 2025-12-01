// script.js

let port = null;
let reader = null;
let writer = null;
let readLoopActive = false;
let readBuffer = "";

// UI elements
const connectBtn = document.getElementById("connect-btn");
const statusBadge = document.getElementById("status-badge");

const displayForm = document.getElementById("display-form");
const urlInput = document.getElementById("url-input");
const qrCheckbox = document.getElementById("qr-checkbox");
const ndefCheckbox = document.getElementById("ndef-checkbox");
const clearBtn = document.getElementById("clear-btn");

const logOutput = document.getElementById("log-output");
const clearLogBtn = document.getElementById("clear-log-btn");
const lastResponsePre = document.getElementById("last-response");

// Helpers for log
function log(line) {
  const ts = new Date().toISOString().split("T")[1].replace("Z", "");
  logOutput.textContent += `[${ts}] ${line}\n`;
  logOutput.scrollTop = logOutput.scrollHeight;
}

function setStatus(connected) {
  if (connected) {
    statusBadge.textContent = "Connected";
    statusBadge.classList.remove("status-disconnected");
    statusBadge.classList.add("status-connected");
  } else {
    statusBadge.textContent = "Disconnected";
    statusBadge.classList.remove("status-connected");
    statusBadge.classList.add("status-disconnected");
  }
}

async function connectSerial() {
  if (!("serial" in navigator)) {
    alert("WebSerial not supported in this browser.\nUse recent Chrome/Edge.");
    return;
  }

  try {
    connectBtn.disabled = true;
    if (!port) {
      // Ask the user to select a device
      port = await navigator.serial.requestPort();
    }

    if (!port.readable || !port.writable) {
      await port.open({ baudRate: 115200 });
    }

    const textEncoder = new TextEncoder();
    writer = port.writable.getWriter();

    reader = port.readable.getReader();
    readLoopActive = true;
    readLoop();

    setStatus(true);
    log("Serial port opened.");
  } catch (err) {
    console.error(err);
    log("Error opening serial port: " + err.message);
    port = null;
    setStatus(false);
  } finally {
    connectBtn.disabled = false;
  }
}

async function disconnectSerial() {
  readLoopActive = false;

  try {
    if (reader) {
      await reader.cancel();
      reader.releaseLock();
      reader = null;
    }
  } catch (e) {
    console.warn("Error cancelling reader:", e);
  }

  try {
    if (writer) {
      writer.releaseLock();
      writer = null;
    }
  } catch (e) {
    console.warn("Error releasing writer:", e);
  }

  try {
    if (port) {
      await port.close();
      port = null;
    }
  } catch (e) {
    console.warn("Error closing port:", e);
  }

  setStatus(false);
  log("Serial port closed.");
}

async function readLoop() {
  const decoder = new TextDecoder();

  while (readLoopActive && port && reader) {
    try {
      const { value, done } = await reader.read();
      if (done) {
        log("Serial reader closed by device.");
        break;
      }
      if (value) {
        const chunk = decoder.decode(value);
        handleIncomingText(chunk);
      }
    } catch (err) {
      console.error("Read error:", err);
      log("Read error: " + err.message);
      break;
    }
  }

  setStatus(false);
}

function handleIncomingText(chunk) {
  // Append to buffer and split on newline to get full JSON lines
  readBuffer += chunk;
  let idx;
  while ((idx = readBuffer.indexOf("\n")) >= 0) {
    const line = readBuffer.slice(0, idx).trim();
    readBuffer = readBuffer.slice(idx + 1);

    if (!line) continue;

    log("[RX] " + line);
    try {
      const obj = JSON.parse(line);
      lastResponsePre.textContent = JSON.stringify(obj, null, 2);
    } catch (e) {
      console.warn("Failed to parse JSON:", e, "Line was:", line);
    }
  }
}

async function sendJson(obj) {
  if (!port || !writer) {
    alert("Not connected to device.");
    return;
  }
  const line = JSON.stringify(obj) + "\n";
  const data = new TextEncoder().encode(line);
  try {
    await writer.write(data);
    log("[TX] " + line.trim());
  } catch (e) {
    console.error("Write error:", e);
    log("Write error: " + e.message);
  }
}

// UI handlers
connectBtn.addEventListener("click", async () => {
  if (port) {
    await disconnectSerial();
  } else {
    await connectSerial();
  }
});

// Display URL command
displayForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const url = urlInput.value.trim();
  if (!url) {
    alert("Please enter a URL.");
    return;
  }

  const req = {
    command: "display_URL",
    params: {
      URL: url,
      "QR-Code": qrCheckbox.checked,
      NDEF: ndefCheckbox.checked,
    },
  };

  await sendJson(req);
});

// Clear command
clearBtn.addEventListener("click", async () => {
  const req = {
    command: "clear",
    params: {
      "QR-Code": qrCheckbox.checked,
      NDEF: ndefCheckbox.checked,
    },
  };

  await sendJson(req);
});

// Clear log
clearLogBtn.addEventListener("click", () => {
  logOutput.textContent = "";
});

// Try to handle automatic disconnect
if ("serial" in navigator) {
  navigator.serial.addEventListener("disconnect", (event) => {
    if (port && event.target === port) {
      log("Device disconnected.");
      port = null;
      setStatus(false);
    }
  });
}
