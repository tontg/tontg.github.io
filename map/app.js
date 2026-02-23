import * as THREE from "https://unpkg.com/three@0.162.0/build/three.module.js";

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
const APP_VERSION = "0.5.0";
const XR_MINIMAP_ZOOM = 17;
const XR_MINIMAP_SIZE_PX = 512;
const XR_MINIMAP_TILE_SIZE = 256;
const GEO_FIRST_FIX_OPTIONS = {
  enableHighAccuracy: true,
  maximumAge: 0,
  timeout: 20000
};
const GEO_WATCH_OPTIONS = {
  enableHighAccuracy: true,
  maximumAge: 1000,
  timeout: 30000
};

const state = {
  user: {
    latitude: null,
    longitude: null,
    headingDeg: 0,
    hasHeading: false,
    lastPositionTs: 0,
    lastHeadingTs: 0,
    headingSource: "none"
  },
  targets: [],
  targetsById: new Map(),
  journey: {
    name: "Journey",
    sequence: [],
    activeStepIndex: 0,
    totalPlannedDistanceMeters: 0
  },
  map: null,
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
    starting: false
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
    fallbackHeadingDeg: 0,
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

function computeJourneyPlannedDistance(sequence) {
  if (!Array.isArray(sequence) || sequence.length < 2) return 0;
  let total = 0;
  for (let index = 0; index < sequence.length - 1; index += 1) {
    const from = getTargetById(sequence[index]);
    const to = getTargetById(sequence[index + 1]);
    if (!from || !to) continue;
    total += haversineMeters(from.latitude, from.longitude, to.latitude, to.longitude);
  }
  return total;
}

function getJourneyRemainingDistanceMeters(lat, lon) {
  const { sequence, activeStepIndex } = state.journey;
  if (!sequence.length) return null;
  if (activeStepIndex >= sequence.length) return 0;

  let remaining = 0;
  const nextTarget = getTargetById(sequence[activeStepIndex]);
  if (nextTarget && lat != null && lon != null) {
    remaining += haversineMeters(lat, lon, nextTarget.latitude, nextTarget.longitude);
  }

  for (let index = activeStepIndex; index < sequence.length - 1; index += 1) {
    const from = getTargetById(sequence[index]);
    const to = getTargetById(sequence[index + 1]);
    if (!from || !to) continue;
    remaining += haversineMeters(from.latitude, from.longitude, to.latitude, to.longitude);
  }
  return remaining;
}

function updateJourneyProgress(lat, lon) {
  const { sequence } = state.journey;
  if (!sequence.length) return;

  while (state.journey.activeStepIndex < sequence.length) {
    const requiredId = sequence[state.journey.activeStepIndex];
    const requiredTarget = getTargetById(requiredId);
    if (!requiredTarget) break;
    const distance = haversineMeters(lat, lon, requiredTarget.latitude, requiredTarget.longitude);
    if (distance > requiredTarget.radiusMeters) break;
    state.journey.activeStepIndex += 1;
  }
}

function updateJourneySummaryLine(lat, lon) {
  const { sequence, activeStepIndex, totalPlannedDistanceMeters, name } = state.journey;
  if (!sequence.length) {
    state.ui.journeySummary.textContent = t("journey.notConfigured");
    return;
  }

  if (activeStepIndex >= sequence.length) {
    state.ui.journeySummary.textContent = t("journey.complete", {
      name,
      remaining: formatDistance(0),
      planned: formatDistance(totalPlannedDistanceMeters)
    });
    return;
  }

  const nextTargetId = sequence[activeStepIndex];
  const remainingMeters = getJourneyRemainingDistanceMeters(lat, lon);
  const remainingText = remainingMeters == null ? "--" : formatDistance(remainingMeters);
  state.ui.journeySummary.textContent = t("journey.progress", {
    name,
    step: activeStepIndex + 1,
    total: sequence.length,
    next: nextTargetId,
    remaining: remainingText,
    planned: formatDistance(totalPlannedDistanceMeters)
  });
}

function applyLanguage(languageCode) {
  state.i18n.language = languageCode === "fr" ? "fr" : "en";

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
  else if (state.app.experienceReady) state.ui.startButton.textContent = t("ui.active");
  else state.ui.startButton.textContent = t("ui.start");
  state.ui.enterArButton.textContent = state.xr.session ? t("ui.exitAr") : t("ui.enterAr");

  if (state.app.starting) {
    state.ui.statusLine.textContent = t("status.requestingPermissions");
  } else if (!state.app.experienceReady) {
    state.ui.statusLine.textContent = t("status.tapStart");
  }

  if (state.user.latitude == null || state.user.longitude == null) {
    state.ui.distanceSummary.textContent = state.app.experienceReady
      ? t("distance.locationUnavailable")
      : t("distance.noFix");
  } else {
    updateTargetOverlay();
  }

  updateJourneySummaryLine(state.user.latitude, state.user.longitude);
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

function computeXrConfidence(nowMs) {
  if (state.user.latitude == null || state.user.longitude == null || state.user.lastPositionTs <= 0) {
    return { label: t("confidence.low"), detail: t("confidence.noLocation"), color: "#ff5d5d" };
  }

  const locAgeSec = (nowMs - state.user.lastPositionTs) / 1000;
  const headingAgeSec =
    state.user.hasHeading && state.user.lastHeadingTs > 0
      ? (nowMs - state.user.lastHeadingTs) / 1000
      : Number.POSITIVE_INFINITY;

  let score = 2;
  if (locAgeSec > 20) score -= 2;
  else if (locAgeSec > 8) score -= 1;

  if (headingAgeSec > 20) score -= 2;
  else if (headingAgeSec > 8) score -= 1;

  if (!state.user.hasHeading) score -= 1;
  if (score >= 2) return { label: t("confidence.high"), detail: t("confidence.stable"), color: "#46dd7a" };
  if (score >= 1) return { label: t("confidence.med"), detail: t("confidence.someDrift"), color: "#ffd05a" };
  return { label: t("confidence.low"), detail: t("confidence.stale"), color: "#ff5d5d" };
}

function haversineMeters(lat1, lon1, lat2, lon2) {
  const earthRadius = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadius * c;
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
  const data = await response.json();
  const pointsSource = Array.isArray(data.points) ? data.points : data.targets;
  if (!Array.isArray(pointsSource)) {
    throw new Error("targets.json must contain a `points` array (or legacy `targets` array).");
  }
  state.targets = pointsSource.map((target, index) => ({
    id: target.id ?? `target-${index + 1}`,
    latitude: Number(target.latitude),
    longitude: Number(target.longitude),
    radiusMeters: Number(target.radiusMeters)
  }));
  state.targetsById = new Map(state.targets.map((target) => [target.id, target]));

  let journeySequence = [];
  let journeyName = "Journey";
  if (Array.isArray(data.journey?.sequence)) {
    journeySequence = data.journey.sequence.map((value) => String(value));
    if (typeof data.journey.name === "string" && data.journey.name.trim()) {
      journeyName = data.journey.name.trim();
    }
  } else {
    journeySequence = state.targets.map((target) => target.id);
  }

  const missingIds = journeySequence.filter((targetId) => !state.targetsById.has(targetId));
  if (missingIds.length) {
    throw new Error(`Journey sequence references unknown point ids: ${missingIds.join(", ")}`);
  }

  state.journey.name = journeyName;
  state.journey.sequence = journeySequence;
  state.journey.activeStepIndex = 0;
  state.journey.totalPlannedDistanceMeters = computeJourneyPlannedDistance(journeySequence);
}

function setupMap() {
  // attribution is displayed in the about section
  const map = L.map("map", {
    zoomControl: false,
    attributionControl: false
  }).setView([0, 0], 2);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 20,
    attribution: "&copy; OpenStreetMap contributors"
  }).addTo(map);

  state.map = map;

  state.layers.userMarker = L.circleMarker([0, 0], {
    radius: 6,
    color: "#ffffff",
    weight: 2,
    fillColor: "#1f88ff",
    fillOpacity: 1
  }).addTo(map);

  state.layers.headingMarker = L.marker([0, 0], {
    icon: createHeadingIcon(0)
  });

  state.targets.forEach((target) => {
    const circle = L.circle([target.latitude, target.longitude], {
      radius: target.radiusMeters,
      color: "#4fd5ff",
      weight: 2,
      fillColor: "#4fd5ff",
      fillOpacity: 0.2
    }).addTo(map);
    circle.bindTooltip(`${target.id} (${target.radiusMeters}m)`);
    state.layers.targetCircles.push(circle);

    const marker = L.circleMarker([target.latitude, target.longitude], {
      radius: 4,
      color: "#4fd5ff",
      weight: 2,
      fillColor: "#4fd5ff",
      fillOpacity: 1
    }).addTo(map);
    marker.bindTooltip(target.id);
    state.layers.targetMarkers.push(marker);
  });

  state.map.on("move zoom resize", updateMapEdgeBullets);

  const mapDom = state.map.getContainer();
  const disableFollow = () => {
    if (!state.mapControl.followUser) return;
    state.mapControl.followUser = false;
    state.ui.mapFollowButton.classList.add("off");
    state.ui.mapFollowButton.textContent = t("ui.recenter");
  };
  ["pointerdown", "touchstart", "mousedown", "wheel"].forEach((eventName) => {
    mapDom.addEventListener(eventName, disableFollow, { passive: true });
  });

  updateMapEdgeBullets();
}

function ensureArrowNode(targetId) {
  let node = state.ui.overlayArrows.querySelector(`[data-target-id="${targetId}"]`);
  if (!node) {
    node = document.createElement("div");
    node.className = "target-arrow";
    node.dataset.targetId = targetId;
    const charSum = Array.from(targetId).reduce((sum, char) => sum + char.charCodeAt(0), 0);
    node.style.setProperty("--bob-delay", `${-((charSum % 24) / 10)}s`);
    node.innerHTML =
      '<div class="arrow-3d"><span class="arrow-shadow">▼</span><span class="arrow-core">▼</span></div><span class="label"></span>';
    state.ui.overlayArrows.appendChild(node);
  }
  return node;
}

function clearArrowOverlay() {
  state.ui.overlayArrows.replaceChildren();
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
  const latRad = toRad(latDeg);
  const n = 2 ** zoom;
  return (
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n
  );
}

function metersPerPixel(latDeg, zoom) {
  return (156543.03392 * Math.cos(toRad(latDeg))) / (2 ** zoom);
}

function getXrTileUrl(z, x, y) {
  const domain = ["a", "b", "c"][Math.abs((x + y) % 3)];
  return `https://${domain}.tile.openstreetmap.org/${z}/${x}/${y}.png`;
}

function requestXrMapTile(z, x, y) {
  const key = `${z}/${x}/${y}`;
  const existing = state.xr.mapTileCache.get(key);
  if (existing) return existing;

  const entry = { status: "loading", image: null };
  state.xr.mapTileCache.set(key, entry);
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.onload = () => {
    entry.status = "ready";
    entry.image = img;
  };
  img.onerror = () => {
    entry.status = "error";
  };
  img.src = getXrTileUrl(z, x, y);
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
  ctx.fillText("XR MAP", size / 2, size / 2 - 16);
  ctx.fillStyle = "rgba(214,243,255,0.85)";
  ctx.font = "18px sans-serif";
  ctx.fillText(text, size / 2, size / 2 + 18);
  if (state.xr.mapTexture) state.xr.mapTexture.needsUpdate = true;
}

function updateXrMiniMap(timeMs) {
  if (!state.xr.mapContext || !state.xr.mapTexture) return;
  if (timeMs - state.xr.mapLastDrawMs < 250) return;
  state.xr.mapLastDrawMs = timeMs;

  if (state.user.latitude == null || state.user.longitude == null) {
    drawXrMapPlaceholder("Waiting for location...");
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
    let px = targetX - centerX + centerPx.x;
    const py = targetY - centerY + centerPx.y;
    if (px < -size) px += worldSize;
    if (px > size * 2) px -= worldSize;

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
  if (state.user.hasHeading) {
    const h = toRad(state.user.headingDeg);
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
  ctx.fillText("OpenStreetMap XR", 12, size - 13);
  state.xr.mapTexture.needsUpdate = true;
}

function drawXrHud(textLine1, textLine2, textLine3 = "", confidence = null) {
  const ctx = state.xr.hudContext;
  if (!ctx || !state.xr.hudTexture) return;

  const width = 640;
  const height = 220;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "rgba(2, 8, 14, 0.72)";
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = "rgba(157, 239, 255, 0.9)";
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, width - 6, height - 6);
  ctx.fillStyle = "#e7fbff";
  ctx.font = "bold 38px sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(textLine1, 24, 72);
  ctx.fillStyle = "rgba(231, 251, 255, 0.95)";
  ctx.font = "30px sans-serif";
  ctx.fillText(textLine2, 24, 128);
  ctx.fillStyle = "rgba(231, 251, 255, 0.9)";
  ctx.font = "24px sans-serif";
  ctx.fillText(textLine3, 24, 176);

  if (confidence) {
    ctx.fillStyle = confidence.color;
    ctx.fillRect(width - 170, 18, 146, 42);
    ctx.fillStyle = "#061018";
    ctx.font = "bold 24px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(confidence.label, width - 97, 46);
    ctx.textAlign = "left";
  }
  state.xr.hudTexture.needsUpdate = true;
}

function updateXrHud(timeMs) {
  if (!state.xr.session || !state.xr.hudPlane || !state.xr.renderer || !state.xr.hudContext) return;
  if (timeMs - state.xr.hudLastDrawMs < 180) return;
  state.xr.hudLastDrawMs = timeMs;

  const xrCamera = state.xr.renderer.xr.getCamera(state.xr.camera);
  const camPos = new THREE.Vector3();
  const camDir = new THREE.Vector3();
  xrCamera.getWorldPosition(camPos);
  xrCamera.getWorldDirection(camDir);
  const hudPos = camPos.clone().add(camDir.multiplyScalar(1.2));
  hudPos.y = camPos.y - 0.2;
  state.xr.hudPlane.position.copy(hudPos);
  state.xr.hudPlane.lookAt(camPos);
  const confidence = computeXrConfidence(timeMs);

  if (state.user.latitude == null || state.user.longitude == null) {
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
    drawXrHud(t("xr.nextComplete"), t("xr.distanceZero"), t("xr.turnUnknown"), confidence);
    return;
  }

  updateJourneyProgress(state.user.latitude, state.user.longitude);
  updateJourneySummaryLine(state.user.latitude, state.user.longitude);

  const headingDeg = state.user.hasHeading ? state.user.headingDeg : state.xr.fallbackHeadingDeg;
  const bearing = bearingDegrees(
    state.user.latitude,
    state.user.longitude,
    nextStep.target.latitude,
    nextStep.target.longitude
  );
  const signedTurn = shortestSignedAngleDeg(headingDeg, bearing);
  const turnText =
    Math.abs(signedTurn) < 5
      ? t("turn.ahead")
      : signedTurn > 0
        ? t("turn.right", { deg: Math.abs(signedTurn).toFixed(0) })
        : t("turn.left", { deg: Math.abs(signedTurn).toFixed(0) });
  const inRange = nextStep.distance != null && nextStep.distance <= nextStep.target.radiusMeters;
  const { sequence, activeStepIndex, totalPlannedDistanceMeters } = state.journey;
  const nextWaypointId =
    sequence.length && activeStepIndex < sequence.length ? sequence[activeStepIndex] : "done";
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
      heading: state.user.hasHeading ? t("heading.compass") : t("heading.fallback"),
      planned: formatDistance(totalPlannedDistanceMeters),
      confidence: confidence.detail
    }),
    confidence
  );
}

function clearXrArrows() {
  if (!state.xr.scene) return;
  for (const mesh of state.xr.arrowMeshes.values()) {
    state.xr.scene.remove(mesh);
  }
  state.xr.arrowMeshes.clear();
  if (state.xr.closestArrowMesh) {
    state.xr.closestArrowMesh.parent?.remove(state.xr.closestArrowMesh);
    state.xr.closestArrowMesh = null;
  }
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

function updateXrArrows(timeSeconds) {
  if (!state.xr.session || !state.xr.scene) return;
  if (state.user.latitude == null || state.user.longitude == null) {
    if (state.xr.waitingMesh) {
      state.xr.waitingMesh.visible = true;
      state.xr.waitingMesh.position.y = 1.45 + Math.sin(timeSeconds * 1.2) * 0.08;
      state.xr.waitingMesh.rotation.y += 0.008;
    }
    for (const mesh of state.xr.arrowMeshes.values()) {
      mesh.visible = false;
    }
    if (state.xr.closestArrowMesh) {
      state.xr.closestArrowMesh.visible = false;
    }
    return;
  }
  if (state.xr.waitingMesh) {
    state.xr.waitingMesh.visible = false;
  }

  const headingDeg = state.user.hasHeading ? state.user.headingDeg : state.xr.fallbackHeadingDeg;
  const nextStep = getNextJourneyStepInfo(state.user.latitude, state.user.longitude);
  const xrCamera = state.xr.renderer?.xr?.getCamera(state.xr.camera) ?? null;

  for (const target of state.targets) {
    const mesh = ensureXrArrow(target);
    const distance = haversineMeters(
      state.user.latitude,
      state.user.longitude,
      target.latitude,
      target.longitude
    );
    const bearing = bearingDegrees(
      state.user.latitude,
      state.user.longitude,
      target.latitude,
      target.longitude
    );
    const signed = shortestSignedAngleDeg(headingDeg, bearing);
    const relRad = toRad(signed);
    const radialDistance = Math.max(1.8, Math.min(9.5, 2 + Math.log10(distance + 12) * 2.6));
    const bobOffset = Math.sin(timeSeconds * 1.1 + mesh.userData.floatPhase) * 0.13;
    const x = Math.sin(relRad) * radialDistance;
    const z = -Math.cos(relRad) * radialDistance;
    const y = 1.35 + bobOffset;
    const scale = Math.max(0.12, Math.min(1.1, 2200 / (distance * distance + 2000)));

    mesh.position.set(x, y, z);
    mesh.scale.setScalar(scale);
    mesh.visible = true;
  }

  if (nextStep) {
    if (!state.xr.closestArrowMesh) {
      state.xr.closestArrowMesh = createXrClosestArrowMesh();
    }
    if (xrCamera && state.xr.closestArrowMesh.parent !== xrCamera) {
      xrCamera.add(state.xr.closestArrowMesh);
    }
    const bearing = bearingDegrees(
      state.user.latitude,
      state.user.longitude,
      nextStep.target.latitude,
      nextStep.target.longitude
    );
    const signed = shortestSignedAngleDeg(headingDeg, bearing);
    // Body-attached compass: near waist, horizontal, rotating in viewer space.
    state.xr.closestArrowMesh.position.set(0, -0.62, -0.55);
    state.xr.closestArrowMesh.rotation.set(0, -toRad(signed), 0);
    state.xr.closestArrowMesh.scale.setScalar(0.9);
    state.xr.closestArrowMesh.visible = true;
  } else if (state.xr.closestArrowMesh) {
    state.xr.closestArrowMesh.visible = false;
  }
}

function computeNearestTargetBearing(lat, lon) {
  const nextStep = getNextJourneyStepInfo(lat, lon);
  if (!nextStep) return 0;
  return bearingDegrees(lat, lon, nextStep.target.latitude, nextStep.target.longitude);
}

function setupXrScene() {
  const scene = new THREE.Scene();
  const hemi = new THREE.HemisphereLight(0xe8f7ff, 0x101010, 0.95);
  scene.add(hemi);
  const dir = new THREE.DirectionalLight(0xffffff, 0.75);
  dir.position.set(2, 5, 1);
  scene.add(dir);

  const camera = new THREE.PerspectiveCamera();
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.xr.enabled = true;
  renderer.xr.setReferenceSpaceType("local");
  renderer.setPixelRatio(window.devicePixelRatio);
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
    new THREE.PlaneGeometry(0.78, 0.78),
    new THREE.MeshBasicMaterial({ map: mapTexture, transparent: false })
  );
  mapPlane.position.set(0.58, 1.2, -1.3);
  scene.add(mapPlane);
  state.xr.mapCanvas = mapCanvas;
  state.xr.mapContext = mapContext;
  state.xr.mapTexture = mapTexture;
  state.xr.mapPlane = mapPlane;
  state.xr.mapLastDrawMs = 0;
  drawXrMapPlaceholder("Loading map tiles...");

  const hudCanvas = document.createElement("canvas");
  hudCanvas.width = 640;
  hudCanvas.height = 220;
  const hudContext = hudCanvas.getContext("2d");
  const hudTexture = new THREE.CanvasTexture(hudCanvas);
  hudTexture.colorSpace = THREE.SRGBColorSpace;
  const hudPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(0.92, 0.32),
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
  clearXrArrows();
  state.xr.waitingMesh = null;
  if (state.xr.mapPlane) {
    state.xr.scene?.remove(state.xr.mapPlane);
    state.xr.mapPlane.geometry.dispose();
    state.xr.mapPlane.material.dispose();
  }
  if (state.xr.mapTexture) {
    state.xr.mapTexture.dispose();
  }
  state.xr.mapPlane = null;
  state.xr.mapTexture = null;
  state.xr.mapContext = null;
  state.xr.mapCanvas = null;
  state.xr.mapLastDrawMs = 0;
  if (state.xr.hudPlane) {
    state.xr.scene?.remove(state.xr.hudPlane);
    state.xr.hudPlane.geometry.dispose();
    state.xr.hudPlane.material.dispose();
  }
  if (state.xr.hudTexture) {
    state.xr.hudTexture.dispose();
  }
  state.xr.hudPlane = null;
  state.xr.hudTexture = null;
  state.xr.hudContext = null;
  state.xr.hudCanvas = null;
  state.xr.hudLastDrawMs = 0;
  if (state.xr.renderer) {
    state.xr.renderer.setAnimationLoop(null);
    state.xr.renderer.dispose();
    state.xr.renderer.domElement.remove();
  }
  state.xr.renderer = null;
  state.xr.scene = null;
  state.xr.camera = null;
}

async function startImmersiveArSession() {
  if (!navigator.xr) {
    state.ui.statusLine.textContent = t("status.webxrUnavailable");
    logXr("error", "navigator.xr unavailable");
    return;
  }

  if (state.xr.session) return;

  const attempts = [
    {
      label: "immersive-ar + dom-overlay",
      options: {
        requiredFeatures: ["local"],
        optionalFeatures: ["dom-overlay"],
        domOverlay: { root: document.body }
      },
      domOverlay: true
    },
    {
      label: "immersive-ar without dom-overlay",
      options: {
        requiredFeatures: ["local"]
      },
      domOverlay: false
    }
  ];

  let session = null;
  let lastError = null;
  state.xr.domOverlayActive = false;
  for (const attempt of attempts) {
    try {
      logXr("info", `Requesting session (${attempt.label})`, attempt.options);
      session = await navigator.xr.requestSession("immersive-ar", attempt.options);
      const domOverlayStateType = session.domOverlayState?.type ?? null;
      state.xr.domOverlayActive = !!domOverlayStateType;
      logXr("info", `Session created (${attempt.label})`, {
        domOverlayRequested: attempt.domOverlay,
        domOverlayStateType
      });
      if (attempt.domOverlay && !state.xr.domOverlayActive) {
        logXr("warn", "DOM overlay requested but not active in created session");
      }
      break;
    } catch (error) {
      lastError = error;
      logXr("warn", `Session request failed (${attempt.label})`, {
        name: error?.name,
        message: error?.message
      });
    }
  }
  if (!session) {
    const detail = lastError ? `${lastError.name}: ${lastError.message}` : "Unknown XR error";
    throw new Error(`Unable to create immersive-ar session. ${detail}`);
  }

  setupXrScene();
  await state.xr.renderer.xr.setSession(session);
  state.xr.session = session;
  logXr("info", "XR renderer session attached", { domOverlayActive: state.xr.domOverlayActive });
  if (state.user.latitude != null && state.user.longitude != null) {
    state.xr.fallbackHeadingDeg = computeNearestTargetBearing(
      state.user.latitude,
      state.user.longitude
    );
  }
  if (state.xr.domOverlayActive) {
    document.body.classList.add("xr-active");
  } else {
    document.body.classList.remove("xr-active");
  }
  state.ui.enterArButton.textContent = t("ui.exitAr");
  if (state.xr.domOverlayActive) {
    logXr("info", "DOM overlay active in XR session");
    state.ui.xrSummary.textContent = t("xr.summaryDomOverlayOn");
  } else {
    logXr("info", "DOM overlay unavailable; running XR without DOM overlay");
    state.ui.xrSummary.textContent = t("xr.summaryDomOverlayOff");
  }
  state.ui.statusLine.textContent =
    state.user.latitude == null || state.user.longitude == null
      ? t("status.xrWaitingLocation")
      : state.user.hasHeading
        ? t("status.xrActive")
        : t("status.xrApproxHeading");

  if (!state.app.experienceReady && !state.app.starting) {
    logXr("info", "Starting base experience after XR session creation");
    startExperience();
  }

  state.xr.renderer.setAnimationLoop((time) => {
    updateXrArrows(time / 1000);
    updateXrMiniMap(time);
    updateXrHud(time);
    state.xr.renderer.render(state.xr.scene, state.xr.camera);
  });

  session.addEventListener("end", () => {
    logXr("info", "XR session ended");
    state.xr.session = null;
    state.xr.domOverlayActive = false;
    teardownXrScene();
    document.body.classList.remove("xr-active");
    state.ui.enterArButton.textContent = t("ui.enterAr");
    state.ui.statusLine.textContent = t("status.xrEnded");
  });
}

async function toggleArSession() {
  try {
    if (state.xr.session) {
      logXr("info", "Ending XR session by user action");
      await state.xr.session.end();
      return;
    }
    await startImmersiveArSession();
  } catch (error) {
    logXr("error", "Failed to start immersive AR", { name: error?.name, message: error?.message });
    state.ui.statusLine.textContent = t("status.failedStartAr", { error: error.message });
  }
}

function createEdgeBullet(target, x, y) {
  const bullet = document.createElement("div");
  bullet.className = "map-edge-bullet";
  bullet.style.left = `${x}px`;
  bullet.style.top = `${y}px`;
  bullet.innerHTML = `<span class="dot"></span><span class="tag">${target.id}</span>`;
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

function updateMapEdgeBullets() {
  if (!state.map || !state.ui?.mapEdgeTargets) return;
  const container = state.ui.mapEdgeTargets;
  container.replaceChildren();

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
    container.appendChild(createEdgeBullet(target, edgePoint.x, edgePoint.y));
  });
}

function updateMapUserState() {
  const { latitude, longitude, headingDeg, hasHeading } = state.user;
  if (latitude == null || longitude == null) return;

  const latLng = [latitude, longitude];
  state.layers.userMarker.setLatLng(latLng);
  const showHeadingMarker = state.capabilities.orientationForArrows && hasHeading;

  if (showHeadingMarker) {
    state.layers.headingMarker.setLatLng(latLng);
    state.layers.headingMarker.setIcon(createHeadingIcon(headingDeg));
    if (!state.map.hasLayer(state.layers.headingMarker)) {
      state.layers.headingMarker.addTo(state.map);
    }
  } else if (state.map.hasLayer(state.layers.headingMarker)) {
    state.map.removeLayer(state.layers.headingMarker);
  }

  if (state.mapControl.followUser) {
    const targetZoom = state.mapControl.hasCenteredOnce ? state.map.getZoom() : MAP_ZOOM;
    state.map.setView(latLng, targetZoom, { animate: false });
    state.mapControl.hasCenteredOnce = true;
  }

  updateMapEdgeBullets();
}

function updateTargetOverlay() {
  const { latitude, longitude, headingDeg } = state.user;
  if (latitude == null || longitude == null) return;

  updateJourneyProgress(latitude, longitude);
  updateJourneySummaryLine(latitude, longitude);
  const nextStep = getNextJourneyStepInfo(latitude, longitude);
  if (!nextStep) {
    state.ui.distanceSummary.innerHTML = `<span class="in-range">${t("distance.journeyComplete")}</span>`;
  } else if (nextStep.distance != null && nextStep.distance <= nextStep.target.radiusMeters) {
    state.ui.distanceSummary.innerHTML =
      `<span class="in-range">${t("distance.insideNextStep", { id: nextStep.targetId, radius: nextStep.target.radiusMeters })}</span>`;
  } else if (nextStep.distance != null) {
    state.ui.distanceSummary.innerHTML =
      `<span class="out-range">${t("distance.nextStep", { id: nextStep.targetId, distance: formatDistance(nextStep.distance) })}</span>`;
  } else {
    state.ui.distanceSummary.innerHTML = `<span class="out-range">${t("distance.waitingNextStep")}</span>`;
  }

  if (!state.capabilities.orientationForArrows || !state.user.hasHeading) {
    clearArrowOverlay();
    return;
  }

  enableArrowOverlay();
  const width = window.innerWidth;

  state.targets.forEach((target) => {
    const distance = haversineMeters(latitude, longitude, target.latitude, target.longitude);
    const bearing = bearingDegrees(latitude, longitude, target.latitude, target.longitude);
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

function readHeadingFromEvent(event) {
  if (typeof event.webkitCompassHeading === "number") {
    return normalizeAngleDeg(event.webkitCompassHeading);
  }
  if (typeof event.absolute === "boolean" && event.absolute && typeof event.alpha === "number") {
    return normalizeAngleDeg(360 - event.alpha);
  }
  if (typeof event.alpha === "number") {
    return normalizeAngleDeg(360 - event.alpha);
  }
  return null;
}

function handleOrientationEvent(event) {
  const heading = readHeadingFromEvent(event);
  if (heading == null) return;
  state.user.headingDeg = heading;
  state.user.hasHeading = true;
  state.user.lastHeadingTs = Date.now();
  state.user.headingSource = "compass";
  updateMapUserState();
  updateTargetOverlay();
}

async function enableOrientation() {
  if (typeof window.DeviceOrientationEvent === "undefined") {
    return false;
  }

  if (typeof DeviceOrientationEvent.requestPermission === "function") {
    let permissionState = "denied";
    try {
      permissionState = await DeviceOrientationEvent.requestPermission();
    } catch (error) {
      return false;
    }
    if (permissionState !== "granted") {
      return false;
    }

    // Some iOS versions gate orientation updates behind motion permission too.
    if (
      typeof window.DeviceMotionEvent !== "undefined" &&
      typeof DeviceMotionEvent.requestPermission === "function"
    ) {
      try {
        await DeviceMotionEvent.requestPermission();
      } catch (error) {
        // Keep going when motion permission request fails; orientation may still work.
      }
    }
  }

  window.addEventListener("deviceorientationabsolute", handleOrientationEvent, true);
  window.addEventListener("deviceorientation", handleOrientationEvent, true);
  return true;
}

function applyPositionUpdate(position) {
  state.user.latitude = position.coords.latitude;
  state.user.longitude = position.coords.longitude;
  state.user.lastPositionTs = Date.now();
  if (typeof position.coords.heading === "number" && !Number.isNaN(position.coords.heading)) {
    state.user.headingDeg = normalizeAngleDeg(position.coords.heading);
    state.user.hasHeading = true;
    state.user.lastHeadingTs = Date.now();
    state.user.headingSource = "geolocation";
  }
  updateMapUserState();
  updateTargetOverlay();
}

function getGeolocationErrorMessage(error) {
  if (!error || typeof error.code !== "number") {
    return t("geo.unableRead");
  }

  if (error.code === error.PERMISSION_DENIED) {
    return t("geo.permissionDenied");
  }
  if (error.code === error.POSITION_UNAVAILABLE) {
    return t("geo.positionUnavailable");
  }
  if (error.code === error.TIMEOUT) {
    return t("geo.timeout");
  }
  return error.message || t("geo.unableRead");
}

function getCurrentPositionOnce(options) {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, options);
  });
}

async function enableGeolocation() {
  if (!("geolocation" in navigator)) {
    throw new Error("Geolocation is not available in this browser.");
  }

  try {
    const firstFix = await getCurrentPositionOnce(GEO_FIRST_FIX_OPTIONS);
    applyPositionUpdate(firstFix);
    state.ui.statusLine.textContent = t("status.liveTracking");
  } catch (error) {
    throw new Error(getGeolocationErrorMessage(error));
  }

  state.watchers.geolocation = navigator.geolocation.watchPosition(
    (position) => {
      applyPositionUpdate(position);
      state.ui.statusLine.textContent = t("status.liveTracking");
    },
    (error) => {
      state.ui.statusLine.textContent = t("status.locationError", {
        error: getGeolocationErrorMessage(error)
      });
    },
    GEO_WATCH_OPTIONS
  );
}

async function enableCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Camera access is not available in this browser.");
  }
  const stream = await navigator.mediaDevices.getUserMedia(CAMERA_CONSTRAINTS);
  state.ui.cameraView.srcObject = stream;
}

async function updateXrSupportLabel() {
  if (!navigator.xr) {
    state.ui.xrSummary.textContent = t("xr.summaryUnavailable");
    state.xr.supported = false;
    state.ui.enterArButton.disabled = true;
    logXr("warn", "WebXR unavailable during support check");
    return;
  }
  try {
    const arSupported = await navigator.xr.isSessionSupported("immersive-ar");
    const vrSupported = await navigator.xr.isSessionSupported("immersive-vr");
    logXr("info", "Session support results", {
      immersiveAr: arSupported,
      immersiveVr: vrSupported
    });
    state.xr.supported = arSupported || vrSupported;
    state.ui.enterArButton.disabled = false;
    state.ui.xrSummary.textContent = arSupported ? t("xr.summarySupported") : t("xr.summaryTryAr");
  } catch (error) {
    logXr("warn", "Session support check failed", { name: error?.name, message: error?.message });
    state.xr.supported = true;
    state.ui.enterArButton.disabled = false;
    state.ui.xrSummary.textContent = t("xr.summaryUncertain", { error: error.message });
  }
}

async function startExperience() {
  if (state.app.starting) return;
  if (state.app.experienceReady) return;

  state.app.starting = true;
  state.ui.startButton.disabled = true;
  state.ui.startButton.textContent = t("ui.starting");
  state.ui.statusLine.textContent = t("status.requestingPermissions");

  try {
    // Orientation permission should be requested as early as possible in the user gesture path.
    const orientationEnabled = await enableOrientation();
    state.capabilities.orientationForArrows = orientationEnabled;
    await enableCamera();
    let geolocationError = null;
    try {
      await enableGeolocation();
    } catch (error) {
      geolocationError = error;
    }

    if (!orientationEnabled) {
      clearArrowOverlay();
      state.ui.statusLine.textContent = t("status.orientationUnavailable");
    } else {
      enableArrowOverlay();
      state.ui.statusLine.textContent = t("status.orientationActive");
    }

    if (geolocationError) {
      state.ui.statusLine.textContent = t("status.locationUnavailableArOk", {
        error: geolocationError.message
      });
      state.ui.distanceSummary.textContent = t("distance.locationUnavailable");
      updateJourneySummaryLine(null, null);
    }

    state.app.experienceReady = true;
    state.ui.startButton.textContent = t("ui.active");
    updateTargetOverlay();
  } catch (error) {
    const secureHint = !window.isSecureContext ? t("hint.httpsRequired") : t("hint.questLocation");
    state.ui.statusLine.textContent = t("status.setupFailed", {
      error: error.message,
      hint: secureHint
    });
    state.ui.startButton.disabled = false;
    state.ui.startButton.textContent = t("ui.retry");
  } finally {
    state.app.starting = false;
  }
}

async function init() {
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
  const preferredLanguage = detectPreferredLanguage();
  state.ui.languageSelect.value = preferredLanguage;
  applyLanguage(preferredLanguage);
  state.ui.statusLine.textContent = t("status.tapStart");
  state.ui.distanceSummary.textContent = t("distance.noFix");
  state.ui.xrSummary.textContent = t("xr.summaryChecking");
  updateJourneySummaryLine(null, null);

  await loadTargets();
  setupMap();
  updateXrSupportLabel();

  state.ui.startButton.addEventListener("click", startExperience);
  state.ui.enterArButton.addEventListener("click", toggleArSession);
  state.ui.languageSelect.addEventListener("change", () => {
    applyLanguage(state.ui.languageSelect.value);
    updateXrSupportLabel();
    updateTargetOverlay();
  });
  state.ui.aboutLink.addEventListener("click", (event) => {
    event.preventDefault();
    state.ui.aboutModal.classList.add("open");
    state.ui.aboutModal.setAttribute("aria-hidden", "false");
  });
  state.ui.aboutCloseButton.addEventListener("click", () => {
    state.ui.aboutModal.classList.remove("open");
    state.ui.aboutModal.setAttribute("aria-hidden", "true");
  });
  state.ui.aboutModal.addEventListener("click", (event) => {
    if (event.target !== state.ui.aboutModal) return;
    state.ui.aboutModal.classList.remove("open");
    state.ui.aboutModal.setAttribute("aria-hidden", "true");
  });
  window.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    state.ui.aboutModal.classList.remove("open");
    state.ui.aboutModal.setAttribute("aria-hidden", "true");
  });
  state.ui.mapFollowButton.addEventListener("click", () => {
    state.mapControl.followUser = true;
    state.ui.mapFollowButton.classList.remove("off");
    state.ui.mapFollowButton.textContent = t("ui.following");
    updateMapUserState();
  });
}

init().catch((error) => {
  const statusLine = byId("statusLine");
  if (statusLine) {
    statusLine.textContent = `Initialization failed: ${error.message}`;
  }
});
