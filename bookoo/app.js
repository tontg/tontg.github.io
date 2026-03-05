const BLE = {
  SERVICE: 0x0FFE,
  WEIGHT_CHAR: 0xFF11,
  CMD_CHAR: 0xFF12,
};

const CMD = {
  TARE: 0x01,
  BEEP: 0x02,
  AUTO_OFF: 0x03,
  TIMER_START: 0x04,
  TIMER_STOP: 0x05,
  TIMER_RESET: 0x06,
  TARE_AND_START: 0x07,
  SMOOTHING: 0x08,
  CALIBRATE: 0x09,
  AUTO_STOP_COND: 0x0B,
};

const AUTO_STOP_MS = 15000;
const WEIGHT_EPSILON_G = 0.01;
const AUTO_START_THRESHOLD_G = 0.10;
const NEAR_ZERO_G = 0.05;
const THEME_STORAGE_KEY = "bookoo-theme";
const BLE_SUPPORTED = typeof navigator !== "undefined" && Boolean(navigator.bluetooth);

let device = null;
let server = null;
let weightChar = null;
let cmdChar = null;

let chart = null;
const sessions = [];
let activeSessionId = null;
let selectedSessionId = null;
let lastGlobalWeight = null;

const health = {
  packetCount: 0,
  checksumErrors: 0,
  lastValidPacketAt: null,
  packetTimes: [],
};

const ui = {
  dot: document.getElementById("status-dot"),
  statusText: document.getElementById("status-text"),
  meta: document.getElementById("meta"),

  connectBtn: document.getElementById("connect-btn"),
  disconnectBtn: document.getElementById("disconnect-btn"),
  tareBtn: document.getElementById("tare-btn"),
  startBtn: document.getElementById("start-session-btn"),
  stopBtn: document.getElementById("stop-session-btn"),
  exportBtn: document.getElementById("export-btn"),
  themeToggleBtn: document.getElementById("theme-toggle-btn"),

  applyBeepBtn: document.getElementById("apply-beep-btn"),
  applyAutooffBtn: document.getElementById("apply-autooff-btn"),
  applySmoothingBtn: document.getElementById("apply-smoothing-btn"),
  applyStopCondBtn: document.getElementById("apply-stop-cond-btn"),

  timerStartBtn: document.getElementById("timer-start-btn"),
  timerStopBtn: document.getElementById("timer-stop-btn"),
  timerResetBtn: document.getElementById("timer-reset-btn"),
  tareStartBtn: document.getElementById("tare-start-btn"),
  calibrateBtn: document.getElementById("calibrate-btn"),

  beepLevel: document.getElementById("beep-level"),
  autooffMin: document.getElementById("autooff-min"),
  flowSmoothing: document.getElementById("flow-smoothing"),
  stopCondition: document.getElementById("stop-condition"),
  lowBatteryThreshold: document.getElementById("low-battery-threshold"),

  showFlow: document.getElementById("show-flow"),
  autoStart: document.getElementById("auto-start"),

  currentWeight: document.getElementById("current-weight"),
  currentFlow: document.getElementById("current-flow"),
  battery: document.getElementById("battery"),
  standby: document.getElementById("standby"),
  activeSession: document.getElementById("active-session"),
  packetCount: document.getElementById("packet-count"),
  checksumErrors: document.getElementById("checksum-errors"),
  packetRate: document.getElementById("packet-rate"),
  lastPacket: document.getElementById("last-packet"),

  sessions: document.getElementById("sessions"),
  sessionCount: document.getElementById("session-count"),
  samplesBody: document.getElementById("samples-body"),
};

function xorChecksum(bytes) {
  let x = 0;
  for (const b of bytes) x ^= b;
  return x & 0xff;
}

function buildCommand(data1, data2, data3) {
  const frame = [0x03, 0x0A, data1 & 0xff, data2 & 0xff, data3 & 0xff];
  frame.push(xorChecksum(frame));
  return new Uint8Array(frame);
}

function signedFromMarker(marker, magnitude) {
  const negativeMarkers = new Set([0x01, 0x2d, 0xff]);
  return negativeMarkers.has(marker) ? -magnitude : magnitude;
}

function parseWeightPacket(dataView) {
  if (dataView.byteLength < 20) return null;
  const b = new Uint8Array(dataView.buffer, dataView.byteOffset, dataView.byteLength);
  if (b[0] !== 0x03 || b[1] !== 0x0B) return null;

  const payload = b.slice(0, 19);
  const expected = xorChecksum(payload);
  if (expected !== b[19]) {
    return { invalid: true, reason: "Checksum mismatch" };
  }

  const scaleMillis = (b[2] << 16) | (b[3] << 8) | b[4];
  const unit = b[5] === 0x01 ? "oz" : "g";
  const weightRaw = (b[7] << 16) | (b[8] << 8) | b[9];
  const flowRaw = (b[11] << 8) | b[12];
  const standbyMinutes = (b[14] << 8) | b[15];

  return {
    invalid: false,
    scaleMillis,
    unit,
    weight: signedFromMarker(b[6], weightRaw / 100),
    flow: signedFromMarker(b[10], flowRaw / 100),
    battery: b[13],
    standbyMinutes,
  };
}

function nowIso() {
  return new Date().toISOString();
}

function makeSession() {
  const id = crypto.randomUUID();
  const startedAt = Date.now();
  return {
    id,
    label: `Session ${sessions.length + 1}`,
    startedAt,
    endedAt: null,
    samples: [],
    lastWeight: null,
    lastWeightChangeAt: startedAt,
    stopReason: null,
  };
}

function getSessionById(id) {
  return sessions.find((s) => s.id === id) || null;
}

function getActiveSession() {
  return activeSessionId ? getSessionById(activeSessionId) : null;
}

function setStatus(text, connected) {
  ui.statusText.textContent = text;
  ui.dot.classList.toggle("connected", Boolean(connected));
}

function setMeta(text, isError = false) {
  ui.meta.textContent = text;
  ui.meta.style.color = isError ? "var(--danger)" : "var(--muted)";
}

function isConnected() {
  return Boolean(server && server.connected);
}

function refreshButtons() {
  const connected = isConnected();
  const active = Boolean(getActiveSession());
  const selected = Boolean(getSessionById(selectedSessionId));

  ui.connectBtn.disabled = connected || !BLE_SUPPORTED;
  ui.disconnectBtn.disabled = !connected;

  ui.tareBtn.disabled = !connected;
  ui.startBtn.disabled = !connected || active;
  ui.stopBtn.disabled = !active;
  ui.exportBtn.disabled = !selected;

  ui.applyBeepBtn.disabled = !connected;
  ui.applyAutooffBtn.disabled = !connected;
  ui.applySmoothingBtn.disabled = !connected;
  ui.applyStopCondBtn.disabled = !connected;

  ui.timerStartBtn.disabled = !connected;
  ui.timerStopBtn.disabled = !connected;
  ui.timerResetBtn.disabled = !connected;
  ui.tareStartBtn.disabled = !connected;
  ui.calibrateBtn.disabled = !connected;
}

function getChartPalette() {
  const dark = document.documentElement.getAttribute("data-theme") === "dark";
  if (dark) {
    return {
      weightLine: "#58b5ab",
      weightArea: "rgba(88,181,171,0.16)",
      flowLine: "#f0b15b",
      text: "#a7bbc6",
      axis: "#2f3d46",
      tipBg: "rgba(24,33,39,0.95)",
      tipBorder: "#2f3d46",
    };
  }
  return {
    weightLine: "#1b7a72",
    weightArea: "rgba(27,122,114,0.10)",
    flowLine: "#f39b32",
    text: "#607280",
    axis: "#d7e0e7",
    tipBg: "rgba(255,255,255,0.95)",
    tipBorder: "#d7e0e7",
  };
}

function renderSessions() {
  ui.sessions.innerHTML = "";
  for (const s of sessions) {
    const btn = document.createElement("button");
    btn.className = "session-btn" + (s.id === selectedSessionId ? " active" : "");
    const durationMs = (s.endedAt || Date.now()) - s.startedAt;
    const sec = Math.max(0, Math.round(durationMs / 1000));
    btn.innerHTML = `<strong>${s.label}</strong><br>${new Date(s.startedAt).toLocaleTimeString()} | ${s.samples.length} pts | ${sec}s${s.stopReason ? ` | ${s.stopReason}` : ""}`;
    btn.onclick = () => {
      selectedSessionId = s.id;
      renderSessions();
      renderSelectedTable();
      renderChart();
      refreshButtons();
    };
    ui.sessions.appendChild(btn);
  }
  ui.sessionCount.textContent = String(sessions.length);
}

function renderSelectedTable() {
  const s = getSessionById(selectedSessionId);
  ui.samplesBody.innerHTML = "";
  if (!s) return;

  for (const smp of s.samples.slice(-300)) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${smp.elapsedSec.toFixed(2)}</td>
      <td>${smp.scaleMillis}</td>
      <td>${smp.weight.toFixed(2)}</td>
      <td>${smp.flow.toFixed(2)}</td>
      <td>${smp.battery}</td>
      <td>${smp.standbyMinutes}</td>
      <td>${smp.unit}</td>
    `;
    ui.samplesBody.appendChild(tr);
  }
}

function ensureChart() {
  if (chart) return;
  chart = echarts.init(document.getElementById("chart"));
  window.addEventListener("resize", () => chart && chart.resize());
}

function renderChart() {
  ensureChart();
  const palette = getChartPalette();
  const showFlow = ui.showFlow.checked;
  const s = getSessionById(selectedSessionId);
  const weightPoints = s ? s.samples.map((x) => [x.elapsedSec, x.weight]) : [];
  const flowPoints = s ? s.samples.map((x) => [x.elapsedSec, x.flow]) : [];

  const series = [{
    name: "Weight",
    type: "line",
    yAxisIndex: 0,
    smooth: 0.22,
    showSymbol: false,
    lineStyle: { width: 2, color: palette.weightLine },
    areaStyle: { color: palette.weightArea },
    data: weightPoints,
  }];

  if (showFlow) {
    series.push({
      name: "Flow",
      type: "line",
      yAxisIndex: 1,
      smooth: 0.2,
      showSymbol: false,
      lineStyle: { width: 2, color: palette.flowLine },
      data: flowPoints,
    });
  }

  chart.setOption({
    animation: false,
    legend: {
      top: 0,
      textStyle: { color: palette.text },
    },
    tooltip: {
      trigger: "axis",
      backgroundColor: palette.tipBg,
      borderColor: palette.tipBorder,
      textStyle: { color: palette.text },
      valueFormatter: (v) => Number(v).toFixed(2),
    },
    grid: { left: 50, right: showFlow ? 56 : 20, top: 36, bottom: 35 },
    xAxis: {
      type: "value",
      name: "Time (s)",
      nameLocation: "middle",
      nameGap: 24,
      nameTextStyle: { color: palette.text },
      axisLabel: { color: palette.text },
      axisLine: { lineStyle: { color: palette.axis } },
      splitLine: { lineStyle: { color: palette.axis } },
    },
    yAxis: [
      {
        type: "value",
        name: "Weight (g)",
        nameTextStyle: { color: palette.text },
        axisLabel: { color: palette.text },
        axisLine: { lineStyle: { color: palette.axis } },
        splitLine: { lineStyle: { color: palette.axis } },
      },
      {
        type: "value",
        name: "Flow (g/s)",
        show: showFlow,
        nameTextStyle: { color: palette.text },
        axisLabel: { color: palette.text },
        axisLine: { lineStyle: { color: palette.axis } },
        splitLine: { show: false },
      },
    ],
    series,
  });
}

function startSession(reason = "Manual start") {
  const session = makeSession();
  sessions.push(session);
  activeSessionId = session.id;
  selectedSessionId = session.id;
  ui.activeSession.textContent = session.label;
  setMeta(`${session.label} started (${reason}) at ${new Date(session.startedAt).toLocaleTimeString()}`);
  renderSessions();
  renderSelectedTable();
  renderChart();
  refreshButtons();
}

function stopSession(reason = "Manual") {
  const s = getActiveSession();
  if (!s) return;
  s.endedAt = Date.now();
  s.stopReason = reason;
  activeSessionId = null;
  ui.activeSession.textContent = "None";
  setMeta(`${s.label} stopped (${reason})`);
  renderSessions();
  refreshButtons();
}

function maybeAutoStop(active, nowMs) {
  if (!active) return;
  if (nowMs - active.lastWeightChangeAt >= AUTO_STOP_MS) {
    stopSession("Auto stop: no weight change (15s)");
  }
}

function maybeAutoStart(weight) {
  if (!ui.autoStart.checked) return;
  if (getActiveSession()) return;
  const previous = lastGlobalWeight;
  if (previous === null) return;

  const wasNearZero = Math.abs(previous) <= NEAR_ZERO_G;
  const nowAboveThreshold = Math.abs(weight) >= AUTO_START_THRESHOLD_G;

  if (wasNearZero && nowAboveThreshold) {
    startSession("Auto start");
  }
}

function updatePacketHealth(nowMs) {
  health.packetCount += 1;
  health.lastValidPacketAt = nowMs;
  health.packetTimes.push(nowMs);

  const minMs = nowMs - 10000;
  while (health.packetTimes.length && health.packetTimes[0] < minMs) {
    health.packetTimes.shift();
  }

  const ratePerSec = health.packetTimes.length / 10;
  ui.packetCount.textContent = String(health.packetCount);
  ui.checksumErrors.textContent = String(health.checksumErrors);
  ui.packetRate.textContent = `${ratePerSec.toFixed(2)} /s`;
  ui.lastPacket.textContent = new Date(nowMs).toLocaleTimeString();
}

function updateBatteryUI(battery) {
  const threshold = clampInt(ui.lowBatteryThreshold.value, 1, 99, 20);
  ui.battery.textContent = `${battery}%`;
  ui.battery.classList.toggle("alert", battery < threshold);
}

function onMeasurement(packet) {
  const nowMs = Date.now();

  updatePacketHealth(nowMs);
  updateBatteryUI(packet.battery);
  ui.currentWeight.textContent = `${packet.weight.toFixed(2)} g`;
  ui.currentFlow.textContent = `${packet.flow.toFixed(2)} g/s`;
  ui.standby.textContent = `${packet.standbyMinutes} min`;

  maybeAutoStart(packet.weight);

  const active = getActiveSession();
  if (active) {
    const elapsedSec = (nowMs - active.startedAt) / 1000;
    const previous = active.lastWeight;
    const changed = previous === null || Math.abs(packet.weight - previous) > WEIGHT_EPSILON_G;

    if (changed) {
      active.lastWeight = packet.weight;
      active.lastWeightChangeAt = nowMs;
    }

    active.samples.push({
      ts: nowIso(),
      elapsedSec,
      scaleMillis: packet.scaleMillis,
      weight: packet.weight,
      flow: packet.flow,
      battery: packet.battery,
      standbyMinutes: packet.standbyMinutes,
      unit: packet.unit,
    });

    maybeAutoStop(active, nowMs);
    if (selectedSessionId === active.id) {
      renderSelectedTable();
      renderChart();
    }
    renderSessions();
  }

  lastGlobalWeight = packet.weight;
  refreshButtons();
}

function onWeightNotification(event) {
  const parsed = parseWeightPacket(event.target.value);
  if (!parsed) return;
  if (parsed.invalid) {
    health.checksumErrors += 1;
    ui.checksumErrors.textContent = String(health.checksumErrors);
    setMeta(`Dropped packet: ${parsed.reason}`, true);
    return;
  }
  onMeasurement(parsed);
}

async function sendCommand(frame, label) {
  if (!cmdChar) throw new Error("Command characteristic not available");
  await cmdChar.writeValue(frame);
  const frameHex = Array.from(frame).map((x) => x.toString(16).padStart(2, "0")).join(" ");
  setMeta(`${label} command sent: [${frameHex}]`);
}

function clampInt(value, min, max, fallback) {
  const n = Number.parseInt(value, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

async function sendSimpleCommand(command, label) {
  await sendCommand(buildCommand(command, 0x00, 0x00), label);
}

async function connectScale() {
  if (!navigator.bluetooth) {
    setMeta("Web Bluetooth is not available in this browser.", true);
    return;
  }

  setMeta("Requesting Bluetooth device...");
  device = await navigator.bluetooth.requestDevice({
    filters: [{ services: [BLE.SERVICE] }],
    optionalServices: [BLE.SERVICE],
  });
  device.addEventListener("gattserverdisconnected", onDisconnected);

  server = await device.gatt.connect();
  const service = await server.getPrimaryService(BLE.SERVICE);
  weightChar = await service.getCharacteristic(BLE.WEIGHT_CHAR);
  cmdChar = await service.getCharacteristic(BLE.CMD_CHAR);

  await weightChar.startNotifications();
  weightChar.addEventListener("characteristicvaluechanged", onWeightNotification);

  setStatus(`Connected: ${device.name || "Bookoo Scale"}`, true);
  setMeta("Connected. You can start a logging session or send settings commands.");
  refreshButtons();
}

function resetBleState() {
  if (weightChar) {
    weightChar.removeEventListener("characteristicvaluechanged", onWeightNotification);
  }
  weightChar = null;
  cmdChar = null;
  server = null;
  device = null;
  setStatus("Disconnected", false);
  refreshButtons();
}

async function disconnectScale() {
  stopSession("Disconnected");
  if (device && device.gatt && device.gatt.connected) {
    device.gatt.disconnect();
  }
  resetBleState();
  setMeta("Disconnected from scale.");
}

function onDisconnected() {
  stopSession("Disconnected");
  resetBleState();
  setMeta("Scale disconnected.", true);
}

function exportSelectedCsv() {
  const s = getSessionById(selectedSessionId);
  if (!s) return;

  const rows = ["session,started_at,ended_at,stop_reason,elapsed_s,scale_ms,weight_g,flow_gps,battery,standby_min,unit,timestamp"];
  for (const x of s.samples) {
    rows.push([
      s.label,
      new Date(s.startedAt).toISOString(),
      s.endedAt ? new Date(s.endedAt).toISOString() : "",
      s.stopReason || "",
      x.elapsedSec.toFixed(3),
      x.scaleMillis,
      x.weight.toFixed(2),
      x.flow.toFixed(2),
      x.battery,
      x.standbyMinutes,
      x.unit,
      x.ts,
    ].map((v) => `"${String(v).replaceAll("\"", "\"\"")}"`).join(","));
  }

  const blob = new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${s.label.replace(/\s+/g, "_").toLowerCase()}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
}

function setStoredTheme(theme) {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch (_e) {
    // Ignore storage failures
  }
}

function getStoredTheme() {
  try {
    return localStorage.getItem(THEME_STORAGE_KEY);
  } catch (_e) {
    return null;
  }
}

function applyTheme(theme) {
  const resolved = theme === "dark" ? "dark" : "light";
  document.documentElement.setAttribute("data-theme", resolved);
  ui.themeToggleBtn.textContent = resolved === "dark" ? "Light Mode" : "Dark Mode";
  setStoredTheme(resolved);
  if (chart) renderChart();
}

function initTheme() {
  const stored = getStoredTheme();
  if (stored === "dark" || stored === "light") {
    applyTheme(stored);
    return;
  }
  const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  applyTheme(prefersDark ? "dark" : "light");
}

function toggleTheme() {
  const current = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
  applyTheme(current === "dark" ? "light" : "dark");
}

function checkBleSupportOnStartup() {
  if (BLE_SUPPORTED) return;
  setStatus("BLE Not Supported", false);
  setMeta("Warning: This browser does not support Web Bluetooth. Use a recent Chromium-based browser on HTTPS or localhost.", true);
}

ui.connectBtn.addEventListener("click", async () => {
  try {
    await connectScale();
  } catch (err) {
    setMeta(`Connection failed: ${err.message || err}`, true);
    resetBleState();
  }
});

ui.disconnectBtn.addEventListener("click", async () => {
  try {
    await disconnectScale();
  } catch (err) {
    setMeta(`Disconnect error: ${err.message || err}`, true);
  }
});

ui.tareBtn.addEventListener("click", async () => {
  try {
    await sendSimpleCommand(CMD.TARE, "Tare");
  } catch (err) {
    setMeta(`Tare failed: ${err.message || err}`, true);
  }
});

ui.startBtn.addEventListener("click", () => startSession());
ui.stopBtn.addEventListener("click", () => stopSession("Manual"));
ui.exportBtn.addEventListener("click", () => exportSelectedCsv());
ui.themeToggleBtn.addEventListener("click", () => toggleTheme());

ui.applyBeepBtn.addEventListener("click", async () => {
  try {
    const level = clampInt(ui.beepLevel.value, 0, 5, 0);
    await sendCommand(buildCommand(CMD.BEEP, 0x00, level), `Beep level ${level}`);
  } catch (err) {
    setMeta(`Apply beep failed: ${err.message || err}`, true);
  }
});

ui.applyAutooffBtn.addEventListener("click", async () => {
  try {
    const mins = clampInt(ui.autooffMin.value, 5, 30, 10);
    ui.autooffMin.value = String(mins);
    await sendCommand(buildCommand(CMD.AUTO_OFF, 0x00, mins), `Auto-off ${mins} min`);
  } catch (err) {
    setMeta(`Apply auto-off failed: ${err.message || err}`, true);
  }
});

ui.applySmoothingBtn.addEventListener("click", async () => {
  try {
    const on = clampInt(ui.flowSmoothing.value, 0, 1, 1);
    await sendCommand(buildCommand(CMD.SMOOTHING, on, 0x00), `Flow smoothing ${on ? "on" : "off"}`);
  } catch (err) {
    setMeta(`Apply smoothing failed: ${err.message || err}`, true);
  }
});

ui.applyStopCondBtn.addEventListener("click", async () => {
  try {
    const cond = clampInt(ui.stopCondition.value, 0, 1, 0);
    await sendCommand(buildCommand(CMD.AUTO_STOP_COND, cond, 0x00), `Stop condition ${cond}`);
  } catch (err) {
    setMeta(`Apply stop condition failed: ${err.message || err}`, true);
  }
});

ui.timerStartBtn.addEventListener("click", async () => {
  try {
    await sendSimpleCommand(CMD.TIMER_START, "Timer start");
  } catch (err) {
    setMeta(`Timer start failed: ${err.message || err}`, true);
  }
});

ui.timerStopBtn.addEventListener("click", async () => {
  try {
    await sendSimpleCommand(CMD.TIMER_STOP, "Timer stop");
  } catch (err) {
    setMeta(`Timer stop failed: ${err.message || err}`, true);
  }
});

ui.timerResetBtn.addEventListener("click", async () => {
  try {
    await sendSimpleCommand(CMD.TIMER_RESET, "Timer reset");
  } catch (err) {
    setMeta(`Timer reset failed: ${err.message || err}`, true);
  }
});

ui.tareStartBtn.addEventListener("click", async () => {
  try {
    await sendSimpleCommand(CMD.TARE_AND_START, "Tare + Start");
  } catch (err) {
    setMeta(`Tare + Start failed: ${err.message || err}`, true);
  }
});

ui.calibrateBtn.addEventListener("click", async () => {
  const ok = window.confirm("Send calibration command now? This should only be used in proper calibration procedure.");
  if (!ok) return;
  try {
    await sendSimpleCommand(CMD.CALIBRATE, "Calibration");
  } catch (err) {
    setMeta(`Calibration failed: ${err.message || err}`, true);
  }
});

ui.showFlow.addEventListener("change", () => renderChart());
ui.lowBatteryThreshold.addEventListener("change", () => {
  const val = clampInt(ui.lowBatteryThreshold.value, 1, 99, 20);
  ui.lowBatteryThreshold.value = String(val);
});

checkBleSupportOnStartup();
initTheme();
ensureChart();
renderChart();
renderSessions();
refreshButtons();

