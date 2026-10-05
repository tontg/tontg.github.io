import {
  parseRoute, distanceMeters as haversineMeters, validCoordinates,
  freshCompass, advanceJourney, compassHeading, sensorConfidence, viewerYawDegrees, navigationPositionAvailable
} from "./navigation.mjs";
import { JourneyTools } from "./journey-tools.mjs";
import { XrControls } from "./xr-controls.mjs";

let THREE;
async function loadThree() {
  THREE ??= await import("https://unpkg.com/three@0.162.0/build/three.module.js");
}

const CAMERA_CONSTRAINTS = {
  audio: false,
  video: {
    facingMode: { ideal: "environment" },
    width: { ideal: 1920 },
    height: { ideal: 1080 }
  }
};

const MAP_ZOOM = 19;
const DISTANCE_SWITCH_METERS = 1000;
const APP_VERSION = "0.8.0";
const XR_MINIMAP_ZOOM = 17;
const XR_MINIMAP_SIZE_PX = 512;
const XR_MINIMAP_TILE_SIZE = 256;
const GEO_WATCH_OPTIONS = {
  enableHighAccuracy: true,
  maximumAge: 1000,
  timeout: 30000
};

const state = {
  user: {
    latitude: null,
    longitude: null,
    locationSource: "none",
    headingDeg: 0,
    hasHeading: false,
    lastPositionTs: 0,
    lastHeadingTs: 0,
    headingSource: "none",
    accuracyMeters: null
  },
  targets: [],
  targetsById: new Map(),
  journey: {
    name: "",
    sequence: [],
    activeStepIndex: 0,
    totalPlannedDistanceMeters: 0,
    legRemainders: [],
    awaitingExit: false
  },
  map: null,
  tools: null,
  ui: null,
  layers: {
    userMarker: null,
    headingMarker: null,
    targetCircles: [],
    targetMarkers: []
  },
  watchers: {
    geolocation: null
  },
  capabilities: {
    orientationForArrows: false
  },
  app: {
    experienceReady: false,
    starting: false,
    statusKey: "status.tapStart", statusValues: {},
    cameraPending: null, cameraGeneration: 0, geoPending: null,
    orientationListening: false, renderFrame: null, freshnessTimer: null,
    lastMapPositionTs: 0, arrowNodes: new Map(), edgeNodes: new Map(), edgeFrame: null,
    geoErrorKey: null, cameraError: null
  },
  mapControl: {
    followUser: true,
    hasCenteredOnce: false
  },
  xr: {
    supported: false,
    session: null,
    renderer: null,
    scene: null,
    camera: null,
    arrowMeshes: new Map(),
    starting: false, northOffsetDeg: null, viewerYawDeg: 0, viewerPose: null,
    resumeCamera: false, mapRevision: 0, mapSignature: "", hudSignature: "",
    waitingMesh: null,
    domOverlayActive: false,
    mapCanvas: null,
    mapContext: null,
    mapTexture: null,
    mapPlane: null,
    mapTileCache: new Map(),
    mapLastDrawMs: 0,
    hudCanvas: null,
    hudContext: null,
    hudTexture: null,
    hudPlane: null,
    hudLastDrawMs: 0,
    closestArrowMesh: null
  },
  i18n: {
    messages: null,
    language: "en"
  }
};

function byId(id) {
  return document.getElementById(id);
}

function logXr(level, message, details) {
  const prefix = "[XR]";
  if (details !== undefined) {
    console[level](`${prefix} ${message}`, details);
  } else {
    console[level](`${prefix} ${message}`);
  }
}

function detectPreferredLanguage() {
  const languages = Array.isArray(navigator.languages) ? navigator.languages : [navigator.language];
  const first = String(languages?.[0] ?? "en").toLowerCase();
  return first.startsWith("fr") ? "fr" : "en";
}

function t(key, values = {}) {
  const lang = state.i18n.language || "en";
  const messages = state.i18n.messages || {};
  const template =
    messages?.[lang]?.[key] ??
    messages?.en?.[key] ??
    key;
  return String(template).replace(/\{(\w+)\}/g, (_, name) => {
    const value = values[name];
    return value == null ? `{${name}}` : String(value);
  });
}

async function loadI18nMessages() {
  const response = await fetch("./data/i18n.json");
  if (!response.ok) {
    throw new Error(`Unable to load i18n (${response.status}).`);
  }
  state.i18n.messages = await response.json();
}

function toRad(value) {
  return (value * Math.PI) / 180;
}

function toDeg(value) {
  return (value * 180) / Math.PI;
}

function normalizeAngleDeg(value) {
  let angle = value % 360;
  if (angle < 0) angle += 360;
  return angle;
}

function shortestSignedAngleDeg(from, to) {
  const diff = normalizeAngleDeg(to) - normalizeAngleDeg(from);
  if (diff > 180) return diff - 360;
  if (diff < -180) return diff + 360;
  return diff;
}

function formatDistance(distanceMeters) {
  if (distanceMeters < DISTANCE_SWITCH_METERS) {
    return `${Math.round(distanceMeters)} m`;
  }
  const distanceKm = distanceMeters / 1000;
  if (distanceKm < 10) {
    return `${distanceKm.toFixed(1)} km`;
  }
  return `${Math.round(distanceKm)} km`;
}

function getTargetById(targetId) {
  return state.targetsById.get(targetId) ?? null;
}

function getJourneyRemainingDistanceMeters(lat, lon) {
  const { sequence, activeStepIndex, legRemainders } = state.journey;
  if (!sequence.length) return null;
  if (activeStepIndex >= sequence.length) return 0;
  if (!validCoordinates(lat, lon) || !navigationPositionAvailable(state.user)) return null;
  const next = getTargetById(sequence[activeStepIndex]);
  return haversineMeters(lat, lon, next.latitude, next.longitude) + legRemainders[activeStepIndex];
}

function updateJourneySummaryLine(lat, lon) {
  const { sequence, activeStepIndex, totalPlannedDistanceMeters, name } = state.journey;
  if (!sequence.length) {
    state.ui.journeySummary.textContent = t("journey.notConfigured");
    return;
  }

  if (activeStepIndex >= sequence.length) {
    state.ui.journeySummary.textContent = t("journey.complete", {
      name: name || t("journey.defaultName"),
      remaining: formatDistance(0),
      planned: formatDistance(totalPlannedDistanceMeters)
    });
    return;
  }

  const nextTargetId = sequence[activeStepIndex];
  const remainingMeters = getJourneyRemainingDistanceMeters(lat, lon);
  const remainingText = remainingMeters == null ? "--" : formatDistance(remainingMeters);
  state.ui.journeySummary.textContent = t("journey.progress", {
    name: name || t("journey.defaultName"),
    step: activeStepIndex + 1,
    total: sequence.length,
    next: nextTargetId,
    remaining: remainingText,
    planned: formatDistance(totalPlannedDistanceMeters)
  });
}

function applyLanguage(languageCode) {
  state.i18n.language = languageCode === "fr" ? "fr" : "en";
  document.documentElement.lang = state.i18n.language;
  try { localStorage.setItem("geo-map-language", state.i18n.language); } catch { /* Storage may be disabled. */ }

  if (!state.ui) return;
  state.ui.languageLabel.textContent = t("ui.language");
  state.ui.versionLine.textContent = t("ui.version", { version: APP_VERSION });
  state.ui.aboutLink.textContent = t("ui.about");
  state.ui.aboutTitle.textContent = t("ui.about");
  state.ui.aboutCloseButton.textContent = t("ui.close");
  state.ui.aboutCodedWithLabel.textContent = t("about.codedWithLabel");
  state.ui.aboutLicenseLabel.textContent = t("about.licenseLabel");
  state.ui.aboutMapDataLabel.textContent = t("about.mapDataLabel");
  state.ui.aboutMapLibraryLabel.textContent = t("about.mapLibraryLabel");
  state.ui.aboutXrLibraryLabel.textContent = t("about.xrLibraryLabel");
  state.ui.aboutFaviconLabel.textContent = t("about.favicon");
  state.ui.mapFollowButton.textContent = state.mapControl.followUser ? t("ui.following") : t("ui.recenter");
  if (state.app.starting) state.ui.startButton.textContent = t("ui.starting");
  else if (state.app.experienceReady) state.ui.startButton.textContent = t("ui.retry");
  else state.ui.startButton.textContent = t("ui.start");
  state.ui.enterArButton.textContent = state.xr.session ? t("ui.exitAr") : t("ui.enterAr");

  state.ui.aboutCloseButton.setAttribute("aria-label", t("ui.close"));
  state.ui.mapFollowButton.setAttribute("aria-label", t("ui.recenter"));
  byId("mapContainer").setAttribute("aria-label", t("ui.mapPreview"));
  renderStatus();
  renderXrSupportLabel();
  updateTargetOverlay();
  updateJourneySummaryLine(state.user.latitude, state.user.longitude);
  state.tools?.render();
}

function setStatus(key, values = {}) {
  state.app.statusKey = key;
  state.app.statusValues = values;
  renderStatus();
}

function renderStatus() {
  const values = { ...state.app.statusValues };
  if (values.errorKey) values.error = t(values.errorKey);
  state.ui.statusLine.textContent = t(state.app.statusKey, values);
}

function refreshTrackingStatus() {
  if (state.xr.session) {
    setStatus(!navigationPositionAvailable(state.user) ? "status.xrWaitingLocation" :
      state.xr.northOffsetDeg == null ? "status.xrHeadingUnavailable" : "status.xrActive");
  } else if (state.app.cameraError) {
    setStatus("status.cameraError", { error: state.app.cameraError });
  } else if (state.app.geoErrorKey) {
    setStatus("status.locationError", { errorKey: state.app.geoErrorKey });
  } else {
    setStatus(freshCompass(state.user) ? "status.orientationActive" : "status.orientationUnavailable");
  }
}

function scheduleSensorRender() {
  if (state.app.renderFrame != null) return;
  state.app.renderFrame = requestAnimationFrame(() => {
    state.app.renderFrame = null;
    updateMapUserState();
    updateTargetOverlay();
  });
}

function getNextJourneyStepInfo(lat, lon) {
  const { sequence, activeStepIndex } = state.journey;
  if (!sequence.length || activeStepIndex >= sequence.length) return null;
  const targetId = sequence[activeStepIndex];
  const target = getTargetById(targetId);
  if (!target) return null;
  const distance =
    lat == null || lon == null ? null : haversineMeters(lat, lon, target.latitude, target.longitude);
  return {
    target,
    targetId,
    stepIndex: activeStepIndex,
    totalSteps: sequence.length,
    distance
  };
}

function computeXrConfidence() {
  const trackedHeading = state.xr.viewerPose && state.xr.northOffsetDeg != null;
  const confidence = sensorConfidence(trackedHeading ? { ...state.user, hasHeading: true,
    headingSource: 'compass', headingDeg: normalizeAngleDeg(state.xr.viewerYawDeg + state.xr.northOffsetDeg), lastHeadingTs: Date.now() } : state.user);
  if (trackedHeading && state.xr.northSource === 'manual' && confidence.level !== 'low') {
    confidence.level = 'med';
    confidence.detail = 'manualAlignment';
  }
  return { label: t(`confidence.${confidence.level}`), detail: t(`confidence.${confidence.detail}`),
    color: { high: "#46dd7a", med: "#ffd05a", low: "#ff5d5d" }[confidence.level] };
}

function getTargetMetrics(target) {
  const key = `${state.user.lastPositionTs}/${state.user.latitude}/${state.user.longitude}`;
  if (target.metrics?.key !== key) {
    target.metrics = {
      key,
      distance: haversineMeters(state.user.latitude, state.user.longitude, target.latitude, target.longitude),
      bearing: bearingDegrees(state.user.latitude, state.user.longitude, target.latitude, target.longitude)
    };
  }
  return target.metrics;
}

function bearingDegrees(lat1, lon1, lat2, lon2) {
  const y = Math.sin(toRad(lon2 - lon1)) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lon2 - lon1));
  return normalizeAngleDeg(toDeg(Math.atan2(y, x)));
}

function createHeadingIcon(headingDeg) {
  return L.divIcon({
    className: "heading-icon-wrapper",
    html: `<div class="user-heading-marker" style="transform: rotate(${headingDeg}deg)">▲</div>`,
    iconSize: [20, 20],
    iconAnchor: [10, 10]
  });
}

async function loadTargets() {
  const response = await fetch("./data/targets.json");
  if (!response.ok) {
    throw new Error(`Unable to load targets (${response.status}).`);
  }
  const configured = await response.json();
  parseRoute(configured);
  state.tools.defaultRoute = configured;
  const route = parseRoute(state.tools.store.loadRoute() || configured);
  state.targets = route.targets;
  state.targetsById = route.byId;
  state.journey = route.journey;
  state.tools.restored = state.tools.store.restoreProgress(state.targets, state.journey);
}

function replaceActiveRoute(data) {
  const route = parseRoute(data);
  state.targets = route.targets;
  state.targetsById = route.byId;
  state.journey = route.journey;
  for (const layer of [...state.layers.targetCircles, ...state.layers.targetMarkers]) layer.remove();
  state.layers.targetCircles = [];
  state.layers.targetMarkers = [];
  state.layers.routeLine?.remove();
  drawMapTargets();
  state.ui.overlayArrows.replaceChildren();
  state.app.arrowNodes.clear();
  state.ui.mapEdgeTargets.replaceChildren();
  state.app.edgeNodes.clear();
  for (const mesh of state.xr.arrowMeshes.values()) { state.xr.scene?.remove(mesh); disposeObject(mesh); }
  state.xr.arrowMeshes.clear();
  if (state.xr.closestArrowMesh) state.xr.closestArrowMesh.visible = false;
  state.xr.mapSignature = state.xr.hudSignature = "";
  updateMapEdgeBullets();
  scheduleSensorRender();
}

function positionSourceChanged() {
  state.app.lastMapPositionTs = 0;
  state.xr.mapSignature = state.xr.hudSignature = "";
  scheduleSensorRender();
}

function tooltipText(text) {
  const node = document.createElement("span");
  node.textContent = text;
  return node;
}

function setupMap() {
  const map = L.map("map", {
    zoomControl: false,
    attributionControl: true
  }).setView([0, 0], 2);

  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 20,
    maxNativeZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>'
  }).addTo(map);

  state.map = map;

  state.layers.userMarker = L.circleMarker([0, 0], {
    radius: 6,
    color: "#ffffff",
    weight: 2,
    fillColor: "#1f88ff",
    fillOpacity: 1
  });

  state.layers.headingMarker = L.marker([0, 0], {
    icon: createHeadingIcon(0)
  });

  drawMapTargets();
  map.on("click", ({ latlng }) => state.tools.pickedPosition(latlng.lat, latlng.lng));

  if (state.targets.length) {
    map.fitBounds(state.targets.map((target) => [target.latitude, target.longitude]), { padding: [20, 20], maxZoom: MAP_ZOOM });
  }
  state.map.on("move zoom resize", scheduleMapEdgeBullets);

  const mapDom = state.map.getContainer();
  const disableFollow = () => {
    if (!state.mapControl.followUser) return;
    state.mapControl.followUser = false;
    state.ui.mapFollowButton.classList.add("off");
    state.ui.mapFollowButton.textContent = t("ui.recenter");
  };
  ["pointerdown", "touchstart", "mousedown", "wheel", "keydown"].forEach((eventName) => {
    mapDom.addEventListener(eventName, disableFollow, { passive: true });
  });

  updateMapEdgeBullets();
}

function drawMapTargets() {
  const map = state.map;
  state.targets.forEach((target) => {
    const circle = L.circle([target.latitude, target.longitude], {
      radius: target.radiusMeters,
      color: "#000000",
      weight: 4,
      fillColor: "#4fd5ff",
      fillOpacity: 0.2
    }).addTo(map);
    circle.bindTooltip(tooltipText(`${target.id} (${target.radiusMeters}m)`));
    state.layers.targetCircles.push(circle);

    const marker = L.circleMarker([target.latitude, target.longitude], {
      radius: 4,
      color: "#000000",
      weight: 3,
      fillColor: "#4fd5ff",
      fillOpacity: 1
    }).addTo(map);
    marker.bindTooltip(tooltipText(target.id));
    state.layers.targetMarkers.push(marker);
  });

  state.layers.routeLine = L.polyline(state.journey.sequence.map((id) => {
    const target = getTargetById(id);
    return [target.latitude, target.longitude];
  }), { color: "#ffbd59", weight: 2, opacity: 0.65 }).addTo(map);
}

function ensureArrowNode(targetId) {
  let node = state.app.arrowNodes.get(targetId);
  if (!node) {
    node = document.createElement("div");
    node.className = "target-arrow";
    node.dataset.targetId = targetId;
    const charSum = Array.from(targetId).reduce((sum, char) => sum + char.charCodeAt(0), 0);
    node.style.setProperty("--bob-delay", `${-((charSum % 24) / 10)}s`);
    node.innerHTML =
      '<div class="arrow-3d"><span class="arrow-shadow">▼</span><span class="arrow-core">▼</span></div><span class="label"></span>';
    state.app.arrowNodes.set(targetId, node);
    state.ui.overlayArrows.appendChild(node);
  }
  return node;
}

function clearArrowOverlay() {
  state.ui.overlayArrows.style.display = "none";
}

function enableArrowOverlay() {
  state.ui.overlayArrows.style.display = "";
}

function createXrArrowMesh(targetId) {
  const group = new THREE.Group();
  const cone = new THREE.Mesh(
    new THREE.ConeGeometry(0.22, 0.48, 16),
    new THREE.MeshStandardMaterial({
      color: 0x7ce8ff,
      emissive: 0x0f6278,
      emissiveIntensity: 0.55,
      roughness: 0.35,
      metalness: 0.08
    })
  );
  cone.rotation.x = Math.PI;
  cone.position.y = -0.18;
  group.add(cone);

  const stem = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.05, 0.22, 10),
    new THREE.MeshStandardMaterial({
      color: 0x9defff,
      emissive: 0x0f6278,
      emissiveIntensity: 0.3,
      roughness: 0.4,
      metalness: 0.06
    })
  );
  stem.position.y = 0.08;
  group.add(stem);

  const charSum = Array.from(targetId).reduce((sum, char) => sum + char.charCodeAt(0), 0);
  group.userData.floatPhase = (charSum % 37) * 0.17;
  return group;
}

function createXrClosestArrowMesh() {
  const group = new THREE.Group();
  const shaft = new THREE.Mesh(
    new THREE.BoxGeometry(0.08, 0.06, 0.46),
    new THREE.MeshStandardMaterial({
      color: 0xfff176,
      emissive: 0x8a6d00,
      emissiveIntensity: 0.65,
      roughness: 0.28,
      metalness: 0.1
    })
  );
  shaft.position.set(0, 0, -0.12);
  group.add(shaft);

  const tip = new THREE.Mesh(
    new THREE.ConeGeometry(0.12, 0.26, 16),
    new THREE.MeshStandardMaterial({
      color: 0xfff9c4,
      emissive: 0x8a6d00,
      emissiveIntensity: 0.45,
      roughness: 0.36,
      metalness: 0.08
    })
  );
  // Cone points forward in camera-local -Z direction.
  tip.rotation.x = -Math.PI / 2;
  tip.position.set(0, 0, -0.42);
  group.add(tip);

  const tail = new THREE.Mesh(
    new THREE.CylinderGeometry(0.03, 0.03, 0.16, 10),
    new THREE.MeshStandardMaterial({
      color: 0xfff9c4,
      emissive: 0x8a6d00,
      emissiveIntensity: 0.35,
      roughness: 0.4,
      metalness: 0.05
    })
  );
  tail.rotation.x = -Math.PI / 2;
  tail.position.set(0, 0, 0.16);
  group.add(tail);
  return group;
}

function lonToTileX(lonDeg, zoom) {
  const n = 2 ** zoom;
  return ((lonDeg + 180) / 360) * n;
}

function latToTileY(latDeg, zoom) {
  const latRad = toRad(Math.max(-85.05112878, Math.min(85.05112878, latDeg)));
  const n = 2 ** zoom;
  return (
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n
  );
}

function metersPerPixel(latDeg, zoom) {
  return (156543.03392 * Math.cos(toRad(Math.max(-85.05112878, Math.min(85.05112878, latDeg))))) / (2 ** zoom);
}

function requestXrMapTile(z, x, y) {
  const key = `${z}/${x}/${y}`;
  const cache = state.xr.mapTileCache;
  let entry = cache.get(key);
  if (entry && !(entry.status === "error" && Date.now() - entry.failedAt > 30000)) {
    cache.delete(key);
    cache.set(key, entry);
    return entry;
  }
  entry = { status: "loading", image: new Image(), failedAt: 0 };
  cache.set(key, entry);
  while (cache.size > 64) {
    const oldest = cache.keys().next().value;
    const removed = cache.get(oldest);
    removed.image.onload = removed.image.onerror = null;
    cache.delete(oldest);
  }
  const img = entry.image;
  img.crossOrigin = "anonymous";
  img.onload = () => { entry.status = "ready"; state.xr.mapRevision += 1; };
  img.onerror = () => {
    entry.status = "error";
    entry.failedAt = Date.now();
    state.xr.mapRevision += 1;
  };
  img.src = `https://tile.openstreetmap.org/${key}.png`;
  return entry;
}

function drawXrMapPlaceholder(text) {
  const ctx = state.xr.mapContext;
  if (!ctx) return;
  const size = XR_MINIMAP_SIZE_PX;
  ctx.fillStyle = "#0a0d12";
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = "rgba(255,255,255,0.28)";
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, size - 6, size - 6);
  ctx.fillStyle = "#d6f3ff";
  ctx.font = "26px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(t("xr.mapTitle"), size / 2, size / 2 - 16);
  ctx.fillStyle = "rgba(214,243,255,0.85)";
  ctx.font = "18px sans-serif";
  ctx.fillText(text, size / 2, size / 2 + 18);
  if (state.xr.mapTexture) state.xr.mapTexture.needsUpdate = true;
}

function updateXrMiniMap(timeMs) {
  if (!state.xr.mapContext || !state.xr.mapTexture) return;
  if (timeMs - state.xr.mapLastDrawMs < 250) return;
  state.xr.mapLastDrawMs = timeMs;

  const mapHeading = state.xr.northOffsetDeg != null ? normalizeAngleDeg(state.xr.viewerYawDeg + state.xr.northOffsetDeg) :
    freshCompass(state.user) ? state.user.headingDeg : null;
  const signature = JSON.stringify([state.user.lastPositionTs, mapHeading == null ? null : Math.round(mapHeading),
    state.xr.mapRevision, state.i18n.language, Math.floor(Date.now() / 30000)]);
  if (state.xr.mapSignature === signature) return;
  state.xr.mapSignature = signature;
  if (state.user.latitude == null || state.user.longitude == null) {
    drawXrMapPlaceholder(t("xr.mapWaiting"));
    return;
  }

  const ctx = state.xr.mapContext;
  const zoom = XR_MINIMAP_ZOOM;
  const size = XR_MINIMAP_SIZE_PX;
  const worldSize = XR_MINIMAP_TILE_SIZE * (2 ** zoom);
  const centerX = lonToTileX(state.user.longitude, zoom) * XR_MINIMAP_TILE_SIZE;
  const centerY = latToTileY(state.user.latitude, zoom) * XR_MINIMAP_TILE_SIZE;
  const left = centerX - size / 2;
  const top = centerY - size / 2;
  const startTileX = Math.floor(left / XR_MINIMAP_TILE_SIZE);
  const endTileX = Math.floor((left + size) / XR_MINIMAP_TILE_SIZE);
  const startTileY = Math.floor(top / XR_MINIMAP_TILE_SIZE);
  const endTileY = Math.floor((top + size) / XR_MINIMAP_TILE_SIZE);
  const tileCount = 2 ** zoom;

  ctx.fillStyle = "#0b0f16";
  ctx.fillRect(0, 0, size, size);

  for (let ty = startTileY; ty <= endTileY; ty += 1) {
    if (ty < 0 || ty >= tileCount) continue;
    for (let tx = startTileX; tx <= endTileX; tx += 1) {
      const wrappedTx = ((tx % tileCount) + tileCount) % tileCount;
      const tile = requestXrMapTile(zoom, wrappedTx, ty);
      if (tile.status !== "ready" || !tile.image) continue;

      const dx = tx * XR_MINIMAP_TILE_SIZE - left;
      const dy = ty * XR_MINIMAP_TILE_SIZE - top;
      ctx.drawImage(tile.image, dx, dy, XR_MINIMAP_TILE_SIZE, XR_MINIMAP_TILE_SIZE);
    }
  }

  const mpp = metersPerPixel(state.user.latitude, zoom);
  const centerPx = { x: size / 2, y: size / 2 };

  for (const target of state.targets) {
    const targetX = lonToTileX(target.longitude, zoom) * XR_MINIMAP_TILE_SIZE;
    const targetY = latToTileY(target.latitude, zoom) * XR_MINIMAP_TILE_SIZE;
    const dx = ((targetX - centerX + worldSize * 1.5) % worldSize) - worldSize / 2;
    const px = dx + centerPx.x;
    const py = targetY - centerY + centerPx.y;

    const radiusPx = Math.max(2, target.radiusMeters / Math.max(mpp, 0.01));
    ctx.beginPath();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(79,213,255,0.95)";
    ctx.fillStyle = "rgba(79,213,255,0.15)";
    ctx.arc(px, py, radiusPx, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  ctx.beginPath();
  ctx.fillStyle = "#ffffff";
  ctx.arc(centerPx.x, centerPx.y, 7, 0, Math.PI * 2);
  ctx.fill();
  if (mapHeading != null) {
    const h = toRad(mapHeading);
    ctx.strokeStyle = "#ffeb3b";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(centerPx.x, centerPx.y);
    ctx.lineTo(centerPx.x + Math.sin(h) * 22, centerPx.y - Math.cos(h) * 22);
    ctx.stroke();
  }

  ctx.strokeStyle = "rgba(255,255,255,0.32)";
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, size - 6, size - 6);
  ctx.fillStyle = "rgba(0,0,0,0.45)";
  ctx.fillRect(0, size - 36, size, 36);
  ctx.fillStyle = "#e3f7ff";
  ctx.font = "18px sans-serif";
  ctx.textAlign = "left";
  ctx.fillText("(c) OpenStreetMap contributors", 12, size - 13);
  state.xr.mapTexture.needsUpdate = true;
}

function drawXrHud(textLine1, textLine2, textLine3 = "", confidence = null) {
  const ctx = state.xr.hudContext;
  if (!ctx || !state.xr.hudTexture) return;
  const toolsLine = state.tools?.xrStatusText() || "";
  const diagnosticLine = state.tools?.xrDiagnosticText() || "";
  const signature = JSON.stringify([textLine1, textLine2, textLine3, confidence, toolsLine, diagnosticLine]);
  if (signature === state.xr.hudSignature) return;
  state.xr.hudSignature = signature;
  const { width, height } = state.xr.hudCanvas;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "rgba(2, 8, 14, 0.86)";
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = "rgba(157, 239, 255, 0.9)";
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, width - 6, height - 6);
  ctx.textAlign = "left";
  ctx.fillStyle = confidence?.color || "#e7fbff";
  ctx.font = "bold 24px sans-serif";
  ctx.fillText(`v${APP_VERSION}  |  ${confidence?.label || "--"}`, 24, 38);
  ctx.fillStyle = "#e7fbff";
  const rows = [
    [textLine1, 78, 28, 2], [textLine2, 150, 24, 2], [textLine3, 222, 24, 3],
    [toolsLine, 330, 22, 1], [diagnosticLine, 375, 24, 2]
  ];
  for (const [text, y, fontSize, maxLines] of rows) {
    ctx.font = `${fontSize}px sans-serif`;
    const lines = [];
    let line = '';
    for (const word of text.split(" ")) {
      const candidate = line ? line + " " + word : word;
      if (line && ctx.measureText(candidate).width > width - 48) {
        lines.push(line);
        line = word;
      } else line = candidate;
    }
    lines.push(line);
    lines.slice(0, maxLines).forEach((value, index) => {
      let clipped = value;
      while (clipped.length && ctx.measureText(clipped).width > width - 72) clipped = clipped.slice(0, -1);
      if (clipped !== value || (index === maxLines - 1 && lines.length > maxLines)) clipped += '...';
      ctx.fillText(clipped, 24, y + index * (fontSize + 5));
    });
  }
  state.xr.hudTexture.needsUpdate = true;
}

function updateXrHud(timeMs) {
  if (!state.xr.session || !state.xr.hudPlane || !state.xr.renderer || !state.xr.hudContext) return;
  if (timeMs - state.xr.hudLastDrawMs < 180) return;
  state.xr.hudLastDrawMs = timeMs;

  const confidence = computeXrConfidence();

  if (!navigationPositionAvailable(state.user)) {
    updateJourneySummaryLine(null, null);
    drawXrHud(
      t("xr.nextWaiting"),
      t("xr.distanceUnknown"),
      t("xr.turnUnknown"),
      confidence
    );
    return;
  }

  const nextStep = getNextJourneyStepInfo(state.user.latitude, state.user.longitude);
  if (!nextStep) {
    updateJourneySummaryLine(state.user.latitude, state.user.longitude);
    drawXrHud(t(state.journey.sequence.length ? "xr.nextComplete" : "journey.notConfigured"), t("xr.distanceZero"), t("xr.turnUnknown"), confidence);
    return;
  }

  updateJourneySummaryLine(state.user.latitude, state.user.longitude);

  const headingDeg = state.xr.northOffsetDeg == null ? null : normalizeAngleDeg(state.xr.viewerYawDeg + state.xr.northOffsetDeg);
  const bearing = bearingDegrees(
    state.user.latitude,
    state.user.longitude,
    nextStep.target.latitude,
    nextStep.target.longitude
  );
  const signedTurn = shortestSignedAngleDeg(headingDeg, bearing);
  const turnText = headingDeg == null ? "--" :
    Math.abs(signedTurn) < 5
      ? t("turn.ahead")
      : signedTurn > 0
        ? t("turn.right", { deg: Math.abs(signedTurn).toFixed(0) })
        : t("turn.left", { deg: Math.abs(signedTurn).toFixed(0) });
  const inRange = nextStep.distance != null && nextStep.distance <= nextStep.target.radiusMeters;
  const { totalPlannedDistanceMeters } = state.journey;
  const remainingJourney = getJourneyRemainingDistanceMeters(state.user.latitude, state.user.longitude);
  const remainingJourneyText = remainingJourney == null ? "--" : formatDistance(remainingJourney);
  drawXrHud(
    t("xr.lineNext", {
      id: nextStep.targetId,
      inRange: inRange ? t("xr.inRangeSuffix") : ""
    }),
    t("xr.lineDistance", {
      distance: nextStep.distance == null ? "--" : formatDistance(nextStep.distance),
      remaining: remainingJourneyText
    }),
    t("xr.lineTurn", {
      turn: turnText,
      heading: headingDeg == null ? t("heading.unavailable") : t(state.xr.northSource === "manual" ? "heading.manual" : "heading.compass"),
      planned: formatDistance(totalPlannedDistanceMeters),
      confidence: confidence.detail
    }),
    confidence
  );
}

function disposeObject(root) {
  const resources = new Set();
  root?.traverse((object) => {
    if (object.geometry) resources.add(object.geometry);
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (!material) continue;
      if (material.map) resources.add(material.map);
      resources.add(material);
    }
  });
  for (const resource of resources) resource.dispose();
}

function ensureXrArrow(target) {
  let mesh = state.xr.arrowMeshes.get(target.id);
  if (!mesh) {
    mesh = createXrArrowMesh(target.id);
    state.xr.arrowMeshes.set(target.id, mesh);
    state.xr.scene.add(mesh);
  }
  return mesh;
}

function updateXrViewerPose(frame) {
  const reference = state.xr.renderer.xr.getReferenceSpace();
  const pose = reference && frame.getViewerPose(reference);
  state.xr.viewerPose = pose;
  if (!pose) {
    state.tools?.updateCalibration(null, performance.now());
    return false;
  }
  const yaw = viewerYawDegrees(pose.transform.orientation);
  if (yaw != null) state.xr.viewerYawDeg = yaw;
  state.tools?.updateCalibration(yaw, performance.now());
  if (!state.tools?.calibration.armed && state.xr.northOffsetDeg == null && yaw != null && freshCompass(state.user)) {
    state.xr.northOffsetDeg = shortestSignedAngleDeg(yaw, state.user.headingDeg);
    state.xr.northSource = "compass";
    logXr("info", "North aligned from device compass");
    refreshTrackingStatus();
  }
  const { position, orientation } = pose.transform;
  state.xr.poseQuaternion.set(orientation.x, orientation.y, orientation.z, orientation.w);
  for (const [object, x, y, z] of [
    [state.xr.hudPlane, -0.35, 0.2, -1.6],
    [state.xr.mapPlane, 0.75, -0.27, -1.6],
    [state.xr.waitingMesh, 0, -0.22, -1.8]
  ]) {
    object.position.set(x, y, z).applyQuaternion(state.xr.poseQuaternion);
    object.position.x += position.x;
    object.position.y += position.y;
    object.position.z += position.z;
    object.quaternion.copy(state.xr.poseQuaternion);
  }
  state.xr.controls?.update(frame, reference, pose);
  return true;
}

function updateXrArrows(timeSeconds) {
  if (!state.xr.session || !state.xr.scene || !state.xr.viewerPose) return;
  const usable = navigationPositionAvailable(state.user) && state.xr.northOffsetDeg != null && !state.journey.paused;
  state.xr.waitingMesh.visible = !navigationPositionAvailable(state.user) || state.xr.northOffsetDeg == null;
  if (!usable) {
    for (const mesh of state.xr.arrowMeshes.values()) mesh.visible = false;
    if (state.xr.closestArrowMesh) state.xr.closestArrowMesh.visible = false;
    return;
  }
  const viewer = state.xr.viewerPose.transform.position;
  for (const target of state.targets) {
    const mesh = ensureXrArrow(target);
    const { distance, bearing } = getTargetMetrics(target);
    const worldBearing = toRad(bearing - state.xr.northOffsetDeg);
    const radialDistance = Math.max(1.8, Math.min(9.5, 2 + Math.log10(distance + 12) * 2.6));
    const bob = Math.sin(timeSeconds * 1.1 + mesh.userData.floatPhase) * 0.13;
    mesh.position.set(viewer.x + Math.sin(worldBearing) * radialDistance,
      viewer.y - 0.15 + bob, viewer.z - Math.cos(worldBearing) * radialDistance);
    mesh.scale.setScalar(Math.max(0.12, Math.min(1.1, 2200 / (distance * distance + 2000))));
    mesh.visible = true;
  }
  const next = getNextJourneyStepInfo(state.user.latitude, state.user.longitude);
  if (!next) {
    if (state.xr.closestArrowMesh) state.xr.closestArrowMesh.visible = false;
    return;
  }
  if (!state.xr.closestArrowMesh) {
    state.xr.closestArrowMesh = createXrClosestArrowMesh();
    state.xr.scene.add(state.xr.closestArrowMesh);
  }
  const arrow = state.xr.closestArrowMesh;
  const yaw = toRad(state.xr.viewerYawDeg);
  const { bearing } = getTargetMetrics(next.target);
  // Approximate the waist from head translation and yaw only, never head pitch/roll.
  arrow.position.set(viewer.x + Math.sin(yaw) * 0.55, viewer.y - 0.62, viewer.z - Math.cos(yaw) * 0.55);
  arrow.rotation.set(0, -toRad(bearing - state.xr.northOffsetDeg), 0);
  arrow.scale.setScalar(0.9);
  arrow.visible = true;
}

function setupXrScene() {
  const scene = new THREE.Scene();
  state.xr.scene = scene;
  state.xr.poseQuaternion = new THREE.Quaternion();
  const hemi = new THREE.HemisphereLight(0xe8f7ff, 0x101010, 0.95);
  scene.add(hemi);
  const dir = new THREE.DirectionalLight(0xffffff, 0.75);
  dir.position.set(2, 5, 1);
  scene.add(dir);

  const camera = new THREE.PerspectiveCamera();
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  state.xr.renderer = renderer;
  renderer.xr.enabled = true;
  renderer.xr.setReferenceSpaceType("local");
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.domElement.style.position = "fixed";
  renderer.domElement.style.inset = "0";
  renderer.domElement.style.zIndex = "1000";
  renderer.domElement.style.pointerEvents = "none";
  document.body.appendChild(renderer.domElement);

  state.xr.scene = scene;
  state.xr.camera = camera;
  state.xr.renderer = renderer;
  logXr("info", "XR renderer configured", { referenceSpaceType: "local" });

  const mapCanvas = document.createElement("canvas");
  mapCanvas.width = XR_MINIMAP_SIZE_PX;
  mapCanvas.height = XR_MINIMAP_SIZE_PX;
  const mapContext = mapCanvas.getContext("2d");
  const mapTexture = new THREE.CanvasTexture(mapCanvas);
  mapTexture.colorSpace = THREE.SRGBColorSpace;
  const mapPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(0.65, 0.65),
    new THREE.MeshBasicMaterial({ map: mapTexture, transparent: false })
  );
  mapPlane.position.set(0.58, 1.2, -1.3);
  scene.add(mapPlane);
  state.xr.mapCanvas = mapCanvas;
  state.xr.mapContext = mapContext;
  state.xr.mapTexture = mapTexture;
  state.xr.mapPlane = mapPlane;
  state.xr.mapLastDrawMs = 0;
  drawXrMapPlaceholder(t("xr.mapLoading"));

  const hudCanvas = document.createElement("canvas");
  hudCanvas.width = 768;
  hudCanvas.height = 460;
  const hudContext = hudCanvas.getContext("2d");
  const hudTexture = new THREE.CanvasTexture(hudCanvas);
  hudTexture.colorSpace = THREE.SRGBColorSpace;
  const hudPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(1.08, 1.08 * 460 / 768),
    new THREE.MeshBasicMaterial({ map: hudTexture, transparent: true })
  );
  hudPlane.position.set(0, 1.2, -1.2);
  scene.add(hudPlane);
  state.xr.hudCanvas = hudCanvas;
  state.xr.hudContext = hudContext;
  state.xr.hudTexture = hudTexture;
  state.xr.hudPlane = hudPlane;
  state.xr.hudLastDrawMs = 0;
  drawXrHud(t("xr.nextWaiting"), t("xr.distanceUnknown"), t("xr.turnUnknown"));

  const waiting = new THREE.Group();
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.24, 0.03, 12, 36),
    new THREE.MeshStandardMaterial({
      color: 0x4fd5ff,
      emissive: 0x0e5169,
      emissiveIntensity: 0.6,
      roughness: 0.35,
      metalness: 0.08
    })
  );
  ring.rotation.x = Math.PI / 2;
  waiting.add(ring);

  const tip = new THREE.Mesh(
    new THREE.ConeGeometry(0.08, 0.18, 12),
    new THREE.MeshStandardMaterial({
      color: 0x9defff,
      emissive: 0x0e5169,
      emissiveIntensity: 0.4,
      roughness: 0.3,
      metalness: 0.06
    })
  );
  tip.rotation.x = Math.PI;
  tip.position.y = -0.16;
  waiting.add(tip);
  waiting.position.set(0, 1.5, -2.1);
  scene.add(waiting);
  state.xr.waitingMesh = waiting;
}

function teardownXrScene() {
  state.xr.renderer?.setAnimationLoop(null);
  state.xr.controls?.detach();
  state.xr.controls = null;
  state.tools?.resetCalibration();
  disposeObject(state.xr.scene);
  for (const entry of state.xr.mapTileCache.values()) {
    entry.image.onload = entry.image.onerror = null;
  }
  state.xr.mapTileCache.clear();
  state.xr.arrowMeshes.clear();
  state.xr.renderer?.dispose();
  state.xr.renderer?.domElement.remove();
  for (const key of ["renderer", "scene", "camera", "waitingMesh", "mapPlane", "mapTexture", "mapContext",
    "mapCanvas", "hudPlane", "hudTexture", "hudContext", "hudCanvas", "closestArrowMesh", "viewerPose", "northOffsetDeg"]) {
    state.xr[key] = null;
  }
  state.xr.mapLastDrawMs = state.xr.hudLastDrawMs = state.xr.mapRevision = 0;
  state.xr.mapSignature = state.xr.hudSignature = "";
}

function handleXrEnd(session) {
  if (state.xr.session !== session) return;
  logXr("info", "XR session ended");
  state.xr.session = null;
  state.xr.domOverlayActive = false;
  teardownXrScene();
  document.body.classList.remove("xr-active");
  state.ui.enterArButton.textContent = t("ui.enterAr");
  renderXrSupportLabel();
  setStatus("status.xrEnded");
  state.tools?.render();
  void resumeCameraAfterXr();
}

async function resumeCameraAfterXr() {
  if (state.xr.starting || state.xr.session || !state.xr.resumeCamera) return;
  state.xr.resumeCamera = false;
  // An outstanding permission request may finish after the XR session has ended.
  try { await state.app.cameraPending; } catch { /* Retry below if still appropriate. */ }
  if (document.hidden || state.xr.session || state.xr.starting) return;
  try { await enableCamera(); }
  catch (error) { setStatus("status.cameraError", { error: error.message }); }
}

async function startImmersiveArSession() {
  if (state.xr.starting || state.xr.session) return;
  if (!navigator.xr) { setStatus("status.webxrUnavailable"); return; }
  state.xr.starting = true;
  state.ui.enterArButton.disabled = true;
  let session;
  try {
    const options = { requiredFeatures: ["local"], optionalFeatures: ["dom-overlay"], domOverlay: { root: byId("hud") } };
    logXr("info", "Requesting immersive-ar session", options);
    // No awaits before requestSession: transient user activation is required.
    session = await navigator.xr.requestSession("immersive-ar", options);
    state.xr.session = session;
    byId('toolsDialog').close();
    byId('editorDialog').close();
    session.addEventListener("end", () => handleXrEnd(session), { once: true });
    state.xr.domOverlayActive = !!session.domOverlayState?.type;
    state.xr.resumeCamera = !!state.ui.cameraView.srcObject?.active || !!state.app.cameraPending;
    stopCamera();
    document.body.classList.add("xr-active");
    logXr("info", "Session created; loading Three.js", { domOverlayActive: state.xr.domOverlayActive });
    await loadThree();
    if (state.xr.session !== session) return;
    setupXrScene();
    await state.xr.renderer.xr.setSession(session);
    if (state.xr.session !== session) return;
    logXr("info", "XR renderer attached; waiting for first viewer pose");
    state.xr.renderer.xr.getReferenceSpace()?.addEventListener("reset", () => state.tools.resetCalibration());
    state.xr.controls = new XrControls(THREE, state.xr.scene, session, {
      labels: () => state.tools.xrLabels(), onAction: (id) => state.tools.xrAction(id)
    });
    state.ui.enterArButton.textContent = t("ui.exitAr");
    renderXrSupportLabel();
    refreshTrackingStatus();
    // Location never gates XR entry, and immersive passthrough does not need getUserMedia.
    state.tools.render();
    if (state.tools.positionMode !== 'manual') {
      void enableGeolocation().catch((error) => logXr("warn", "XR location unavailable", { message: error.message }));
    }
    let firstFrame = true;
    state.xr.renderer.setAnimationLoop((time, frame) => {
      if (!frame || !state.xr.session) return;
      try {
        if (!updateXrViewerPose(frame)) return;
        if (firstFrame) { logXr("info", "First XR viewer pose received"); firstFrame = false; }
        updateXrArrows(time / 1000);
        updateXrMiniMap(time);
        updateXrHud(time);
        state.xr.renderer.render(state.xr.scene, state.xr.camera);
      } catch (error) {
        logXr("error", "XR frame failed", error);
        state.xr.renderer?.setAnimationLoop(null);
        void session.end().catch((endError) => logXr("error", "XR end failed", endError));
      }
    });
  } catch (error) {
    logXr("error", "XR setup failed", error);
    if (session) {
      try { await session.end(); } catch (endError) { logXr("warn", "XR cleanup failed", endError); }
      handleXrEnd(session);
    }
    throw error;
  } finally {
    state.xr.starting = false;
    state.ui.enterArButton.disabled = !state.xr.supported;
    void resumeCameraAfterXr();
  }
}

async function toggleArSession() {
  if (state.xr.starting) return;
  void state.tools?.feedback.unlock();
  try {
    if (state.xr.session) await state.xr.session.end();
    else await startImmersiveArSession();
  } catch (error) {
    logXr("error", "Failed to toggle immersive AR", error);
    setStatus("status.failedStartAr", { error: error.message });
  }
}

function createEdgeBullet(target, x, y) {
  const bullet = document.createElement("div");
  bullet.className = "map-edge-bullet";
  bullet.style.left = `${x}px`;
  bullet.style.top = `${y}px`;
  const dot = document.createElement("span");
  dot.className = "dot";
  const tag = document.createElement("span");
  tag.className = "tag";
  tag.textContent = target.id;
  bullet.append(dot, tag);
  return bullet;
}

function findBorderIntersection(center, point, width, height, margin) {
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  if (dx === 0 && dy === 0) return null;

  const minX = margin;
  const maxX = width - margin;
  const minY = margin;
  const maxY = height - margin;
  const candidates = [];

  if (dx !== 0) {
    const tLeft = (minX - center.x) / dx;
    const yLeft = center.y + tLeft * dy;
    if (tLeft > 0 && yLeft >= minY && yLeft <= maxY) candidates.push(tLeft);

    const tRight = (maxX - center.x) / dx;
    const yRight = center.y + tRight * dy;
    if (tRight > 0 && yRight >= minY && yRight <= maxY) candidates.push(tRight);
  }

  if (dy !== 0) {
    const tTop = (minY - center.y) / dy;
    const xTop = center.x + tTop * dx;
    if (tTop > 0 && xTop >= minX && xTop <= maxX) candidates.push(tTop);

    const tBottom = (maxY - center.y) / dy;
    const xBottom = center.x + tBottom * dx;
    if (tBottom > 0 && xBottom >= minX && xBottom <= maxX) candidates.push(tBottom);
  }

  if (!candidates.length) return null;
  const t = Math.min(...candidates);
  return {
    x: center.x + t * dx,
    y: center.y + t * dy
  };
}

function scheduleMapEdgeBullets() {
  if (state.app.edgeFrame != null) return;
  state.app.edgeFrame = requestAnimationFrame(() => {
    state.app.edgeFrame = null;
    updateMapEdgeBullets();
  });
}

function updateMapEdgeBullets() {
  if (!state.map || !state.ui?.mapEdgeTargets) return;
  const container = state.ui.mapEdgeTargets;
  for (const node of state.app.edgeNodes.values()) node.hidden = true;

  const size = state.map.getSize();
  if (!size || size.x <= 0 || size.y <= 0) return;

  const center = L.point(size.x / 2, size.y / 2);
  const margin = 14;

  state.targets.forEach((target) => {
    const targetLatLng = L.latLng(target.latitude, target.longitude);
    const targetPoint = state.map.latLngToContainerPoint(targetLatLng);
    if (!Number.isFinite(targetPoint.x) || !Number.isFinite(targetPoint.y)) return;

    const insideViewport =
      targetPoint.x >= margin &&
      targetPoint.x <= size.x - margin &&
      targetPoint.y >= margin &&
      targetPoint.y <= size.y - margin;
    if (insideViewport) return;

    const edgePoint = findBorderIntersection(center, targetPoint, size.x, size.y, margin);
    if (!edgePoint) return;
    let node = state.app.edgeNodes.get(target.id);
    if (!node) {
      node = createEdgeBullet(target, edgePoint.x, edgePoint.y);
      state.app.edgeNodes.set(target.id, node);
      container.appendChild(node);
    }
    node.hidden = false;
    node.style.left = `${edgePoint.x}px`;
    node.style.top = `${edgePoint.y}px`;
  });
}

function updateMapUserState() {
  const { latitude, longitude, headingDeg } = state.user;
  if (!state.map) return;
  if (latitude == null || longitude == null) {
    state.layers.userMarker.remove();
    state.layers.headingMarker.remove();
    return;
  }

  const latLng = [latitude, longitude];
  if (!state.map.hasLayer(state.layers.userMarker)) state.layers.userMarker.addTo(state.map);
  const newPosition = state.app.lastMapPositionTs !== state.user.lastPositionTs;
  if (newPosition) {
    state.layers.userMarker.setLatLng(latLng);
    state.layers.userMarker.setStyle({ fillColor: state.user.locationSource === "manual" ? "#ffbd59" : "#1f88ff" });
  }
  const showHeadingMarker = state.capabilities.orientationForArrows && freshCompass(state.user);

  if (showHeadingMarker) {
    state.layers.headingMarker.setLatLng(latLng);

    if (!state.map.hasLayer(state.layers.headingMarker)) {
      state.layers.headingMarker.addTo(state.map);
    }
    const glyph = state.layers.headingMarker.getElement()?.firstElementChild;
    if (glyph) glyph.style.transform = `rotate(${headingDeg}deg)`;
  } else if (state.map.hasLayer(state.layers.headingMarker)) {
    state.map.removeLayer(state.layers.headingMarker);
  }

  if (state.mapControl.followUser && newPosition) {
    const targetZoom = state.mapControl.hasCenteredOnce
      ? state.map.getZoom()
      : MAP_ZOOM;
    state.map.setView(latLng, targetZoom, { animate: false });
    state.mapControl.hasCenteredOnce = true;
  }

  state.app.lastMapPositionTs = state.user.lastPositionTs;
}

function updateTargetOverlay() {
  const { latitude, longitude, headingDeg } = state.user;
  updateJourneySummaryLine(latitude, longitude);
  if (!navigationPositionAvailable(state.user)) {
    state.ui.distanceSummary.textContent = t(latitude == null ? "distance.noFix" : "distance.stale");
    state.ui.distanceSummary.className = "out-range";
    clearArrowOverlay();
    return;
  }
  const nextStep = getNextJourneyStepInfo(latitude, longitude);
  const inRange = nextStep?.distance <= nextStep?.target.radiusMeters;
  const summary = state.ui.distanceSummary;
  summary.className = inRange || !nextStep ? "in-range" : "out-range";
  summary.textContent = !state.journey.sequence.length ? t("journey.notConfigured") : !nextStep ? t("distance.journeyComplete") :
    inRange ? t("distance.insideNextStep", { id: nextStep.targetId, radius: nextStep.target.radiusMeters }) :
    t("distance.nextStep", { id: nextStep.targetId, distance: formatDistance(nextStep.distance) });
  if (state.user.locationSource === "manual") summary.textContent = `${t("position.manualBadge")} ${summary.textContent}`;

  if (state.journey.paused || !state.capabilities.orientationForArrows || !freshCompass(state.user)) {
    clearArrowOverlay();
    return;
  }

  enableArrowOverlay();
  const width = window.innerWidth;

  state.targets.forEach((target) => {
    const { distance, bearing } = getTargetMetrics(target);
    const signed = shortestSignedAngleDeg(headingDeg, bearing);
    const arrowEl = ensureArrowNode(target.id);
    const relativeHorizontalFov = 70;
    const clamped = Math.max(-relativeHorizontalFov, Math.min(relativeHorizontalFov, signed));
    const normalized = clamped / relativeHorizontalFov;
    const left = width * (0.5 + normalized * 0.45);
    const glyphSize = Math.max(20, Math.min(84, 350000 / Math.max(distance * distance, 1)));

    arrowEl.style.left = `${left}px`;
    arrowEl.style.opacity = Math.abs(signed) > 95 ? "0.35" : "1";
    arrowEl.querySelector(".arrow-core").style.fontSize = `${glyphSize}px`;
    arrowEl.querySelector(".arrow-shadow").style.fontSize = `${glyphSize * 0.98}px`;
    arrowEl.querySelector(".label").textContent = `${target.id}: ${formatDistance(distance)}`;
  });
}

function handleOrientationEvent(event) {
  const heading = compassHeading(event);
  if (heading == null) return;
  const wasFresh = freshCompass(state.user);
  state.user.headingDeg = heading;
  state.user.hasHeading = true;
  state.user.lastHeadingTs = Date.now();
  state.user.headingSource = "compass";
  if (!wasFresh && state.app.experienceReady) refreshTrackingStatus();
  scheduleSensorRender();
}

async function enableOrientation() {
  if (state.app.orientationListening) return true;
  if (!window.DeviceOrientationEvent) return false;
  if (typeof DeviceOrientationEvent.requestPermission === "function") {
    try {
      if (await DeviceOrientationEvent.requestPermission() !== "granted") return false;
    } catch { return false; }
  }
  window.addEventListener("deviceorientationabsolute", handleOrientationEvent, true);
  window.addEventListener("deviceorientation", handleOrientationEvent, true);
  state.app.orientationListening = true;
  state.capabilities.orientationForArrows = true;
  return true;
}

function applyPositionUpdate(position, allowAdvance = true) {
  const coords = position.coords;
  const previousTimestamp = state.tools?.latestGps?.timestamp ?? (state.user.locationSource === "geolocation" ? state.user.lastPositionTs : 0);
  if (!validCoordinates(coords.latitude, coords.longitude) || !Number.isFinite(position.timestamp) ||
      position.timestamp <= previousTimestamp || position.timestamp > Date.now()) return false;
  if (state.tools) {
    state.tools.latestGps = position;
    if (state.tools.positionMode === "manual") return true;
  }
  state.user.latitude = coords.latitude;
  state.user.longitude = coords.longitude;
  state.user.locationSource = "geolocation";
  state.user.lastPositionTs = position.timestamp;
  state.user.accuracyMeters = Number.isFinite(coords.accuracy) && coords.accuracy >= 0 ? coords.accuracy : null;
  const stepId = state.journey.sequence[state.journey.activeStepIndex];
  const wasAwaitingExit = state.journey.awaitingExit;
  if (allowAdvance && advanceJourney(state.journey, state.targetsById, state.user)) state.tools?.arrived(stepId);
  else if (wasAwaitingExit !== state.journey.awaitingExit) state.tools?.save();
  scheduleSensorRender();
  return true;
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  if (!window.isSecureContext) return;

  try {
    await navigator.serviceWorker.register("./sw.js");
  } catch (error) {
    console.warn("[pwa] Service worker registration failed.", error);
  }
}

function geolocationErrorKey(error) {
  return { 1: "geo.permissionDenied", 2: "geo.positionUnavailable", 3: "geo.timeout" }[error?.code] || "geo.unableRead";
}

function enableGeolocation() {
  if (state.app.geoPending) return state.app.geoPending;
  if (state.watchers.geolocation != null) return Promise.resolve();
  if (!navigator.geolocation) {
    state.app.geoErrorKey = "geo.unableRead";
    return Promise.reject(new Error(t(state.app.geoErrorKey)));
  }
  state.app.geoPending = new Promise((resolve, reject) => {
    state.watchers.geolocation = navigator.geolocation.watchPosition((position) => {
      if (!applyPositionUpdate(position)) return;
      state.app.geoErrorKey = null;
      refreshTrackingStatus();
      resolve();
    }, (error) => {
      state.app.geoErrorKey = geolocationErrorKey(error);
      if (error.code === 1) {
        navigator.geolocation.clearWatch(state.watchers.geolocation);
        state.watchers.geolocation = null;
      }
      refreshTrackingStatus();
      reject(new Error(t(state.app.geoErrorKey)));
    }, GEO_WATCH_OPTIONS);
  }).finally(() => { state.app.geoPending = null; });
  return state.app.geoPending;
}

function stopCamera() {
  state.app.cameraGeneration += 1;
  const stream = state.ui.cameraView.srcObject;
  stream?.getTracks().forEach((track) => track.stop());
  state.ui.cameraView.srcObject = null;
}

async function enableCamera() {
  if (state.xr.session || state.xr.starting) return;
  if (state.ui.cameraView.srcObject?.active) return;
  if (state.app.cameraPending) return state.app.cameraPending;
  const generation = state.app.cameraGeneration;
  state.app.cameraPending = (async () => {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error(t("camera.unavailable"));
    const stream = await navigator.mediaDevices.getUserMedia(CAMERA_CONSTRAINTS);
    if (generation !== state.app.cameraGeneration || state.xr.session || state.xr.starting) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    state.ui.cameraView.srcObject = stream;
    try { await state.ui.cameraView.play(); }
    catch (error) { stopCamera(); throw error; }
  })().finally(() => { state.app.cameraPending = null; });
  return state.app.cameraPending;
}

function renderXrSupportLabel() {
  const key = state.xr.session ? (state.xr.domOverlayActive ? "xr.summaryDomOverlayOn" : "xr.summaryDomOverlayOff") :
    state.xr.supported ? "xr.summarySupported" : "xr.summaryUnavailable";
  state.ui.xrSummary.textContent = t(key);
}

async function updateXrSupportLabel() {
  if (!navigator.xr) {
    state.xr.supported = false;
  } else {
    try {
      state.xr.supported = await navigator.xr.isSessionSupported("immersive-ar");
      logXr("info", "Session support results", { immersiveAr: state.xr.supported });
    } catch (error) {
      state.xr.supported = true;
      logXr("warn", "Session support check failed; allowing an explicit attempt", error);
    }
  }
  state.ui.enterArButton.disabled = !state.xr.supported;
  renderXrSupportLabel();
}

async function startExperience() {
  if (state.app.starting) return;
  state.app.starting = true;
  state.app.cameraError = null;
  state.ui.startButton.disabled = true;
  state.ui.startButton.textContent = t("ui.starting");
  setStatus("status.requestingPermissions");
  // Request orientation before any await: iOS requires a direct user gesture.
  const orientation = enableOrientation();
  void state.tools?.feedback.unlock();
  const results = await Promise.allSettled([orientation, enableCamera(),
    state.tools?.positionMode === 'manual' ? Promise.resolve() : enableGeolocation()]);
  state.app.cameraError = results[1].status === "rejected" ? results[1].reason.message : null;
  state.app.experienceReady = true;
  state.app.starting = false;
  // Keep retry available if a permission was declined or a sensor is still unavailable.
  state.ui.startButton.disabled = false;
  state.ui.startButton.textContent = t("ui.retry");
  refreshTrackingStatus();
  scheduleSensorRender();
}

function setAboutOpen(open) {
  state.ui.aboutModal.classList.toggle("open", open);
  state.ui.aboutModal.setAttribute("aria-hidden", String(!open));
  byId("app").inert = open;
  (open ? state.ui.aboutCloseButton : state.ui.aboutLink).focus();
}

async function init() {
  void registerServiceWorker();
  state.ui = {
    cameraView: byId("cameraView"),
    overlayArrows: byId("overlayArrows"),
    mapFollowButton: byId("mapFollowButton"),
    mapEdgeTargets: byId("mapEdgeTargets"),
    languageLabel: byId("languageLabel"),
    languageSelect: byId("languageSelect"),
    versionLine: byId("versionLine"),
    statusLine: byId("statusLine"),
    distanceSummary: byId("distanceSummary"),
    journeySummary: byId("journeySummary"),
    xrSummary: byId("xrSummary"),
    startButton: byId("startButton"),
    enterArButton: byId("enterArButton"),
    aboutLink: byId("aboutLink"),
    aboutModal: byId("aboutModal"),
    aboutCloseButton: byId("aboutCloseButton"),
    aboutTitle: byId("aboutTitle"),
    aboutCodedWithLabel: byId("aboutCodedWithLabel"),
    aboutLicenseLabel: byId("aboutLicenseLabel"),
    aboutMapDataLabel: byId("aboutMapDataLabel"),
    aboutMapLibraryLabel: byId("aboutMapLibraryLabel"),
    aboutXrLibraryLabel: byId("aboutXrLibraryLabel"),
    aboutFaviconLabel: byId("aboutFaviconLabel")
  };

  await loadI18nMessages();
  let preferredLanguage = detectPreferredLanguage();
  try { preferredLanguage = localStorage.getItem("geo-map-language") || preferredLanguage; } catch { /* Optional preference. */ }
  state.ui.languageSelect.value = preferredLanguage;
  applyLanguage(preferredLanguage);
  state.ui.statusLine.textContent = t("status.tapStart");
  state.ui.distanceSummary.textContent = t("distance.noFix");
  state.ui.xrSummary.textContent = t("xr.summaryChecking");
  updateJourneySummaryLine(null, null);

  state.tools = new JourneyTools(state, t, {
    replaceRoute: replaceActiveRoute,
    render: scheduleSensorRender,
    positionChanged: positionSourceChanged,
    status: setStatus,
    applyGps: (position) => applyPositionUpdate(position, false),
    enableGps: enableGeolocation
  });
  byId('hud').addEventListener('beforexrselect', (event) => {
    if (event.target.closest('button, a, input, select, summary')) event.preventDefault();
  });

  state.tools = new JourneyTools(state, t, {
    replaceRoute: replaceActiveRoute,
    render: scheduleSensorRender,
    positionChanged: positionSourceChanged,
    status: setStatus,
    applyGps: (position) => applyPositionUpdate(position, false),
    enableGps: enableGeolocation
  });
  byId('hud').addEventListener('beforexrselect', (event) => {
    if (event.target.closest('button, a, input, select, summary')) event.preventDefault();
  });

  await loadTargets();
  setupMap();
  state.tools.routeChanged();
  updateJourneySummaryLine(null, null);
  updateXrSupportLabel();

  state.ui.startButton.addEventListener("click", startExperience);
  state.ui.enterArButton.addEventListener("click", toggleArSession);
  state.ui.languageSelect.addEventListener("change", () => {
    applyLanguage(state.ui.languageSelect.value);
    updateTargetOverlay();
  });
  state.ui.aboutLink.addEventListener("click", (event) => {
    event.preventDefault();
    setAboutOpen(true);
  });
  state.ui.aboutCloseButton.addEventListener("click", () => setAboutOpen(false));
  state.ui.aboutModal.addEventListener("click", (event) => {
    if (event.target === state.ui.aboutModal) setAboutOpen(false);
  });
  window.addEventListener("keydown", (event) => {
    if (!state.ui.aboutModal.classList.contains("open")) return;
    if (event.key === "Escape") setAboutOpen(false);
    if (event.key === "Tab") {
      const focusable = [...state.ui.aboutModal.querySelectorAll("button, a[href]")];
      const first = focusable[0], last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });
  state.app.freshnessTimer = setInterval(() => {
    if (!document.hidden) { scheduleSensorRender(); state.tools.render(); }
  }, 1000);
  window.addEventListener("resize", scheduleSensorRender);
  window.addEventListener("pagehide", () => {
    state.tools.save();
    state.tools.feedback.close();
    stopCamera();
    if (state.watchers.geolocation != null) navigator.geolocation.clearWatch(state.watchers.geolocation);
    state.watchers.geolocation = null;
    state.xr.resumeCamera = false;
    state.xr.session?.end().catch((error) => logXr("warn", "Could not end XR on page exit", error));
    clearInterval(state.app.freshnessTimer);
  });
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) location.reload();
  });

  state.ui.mapFollowButton.addEventListener("click", () => {
    state.mapControl.followUser = true;
    state.ui.mapFollowButton.classList.remove("off");
    state.ui.mapFollowButton.textContent = t("ui.following");
    state.app.lastMapPositionTs = 0;
    updateMapUserState();
  });
}

init().catch((error) => {
  const statusLine = byId("statusLine");
  if (statusLine) {
    statusLine.textContent = `Initialization failed: ${error.message}`;
  }
});
