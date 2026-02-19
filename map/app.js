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
    hasHeading: false
  },
  targets: [],
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
  mapControl: {
    followUser: true,
    hasCenteredOnce: false
  }
};

function byId(id) {
  return document.getElementById(id);
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
    return `${distanceMeters.toFixed(1)} m`;
  }
  return `${(distanceMeters / 1000).toFixed(2)} km`;
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
  if (!Array.isArray(data.targets)) {
    throw new Error("targets.json must contain a `targets` array.");
  }
  state.targets = data.targets.map((target, index) => ({
    id: target.id ?? `target-${index + 1}`,
    latitude: Number(target.latitude),
    longitude: Number(target.longitude),
    radiusMeters: Number(target.radiusMeters)
  }));
}

function setupMap() {
  const map = L.map("map", {
    zoomControl: false,
    attributionControl: true
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
    state.ui.mapFollowButton.textContent = "Recenter";
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

  let nearestTarget = null;
  let insideTarget = null;

  state.targets.forEach((target) => {
    const distance = haversineMeters(latitude, longitude, target.latitude, target.longitude);

    if (!nearestTarget || distance < nearestTarget.distance) {
      nearestTarget = { target, distance };
    }
    if (distance <= target.radiusMeters && !insideTarget) {
      insideTarget = { target, distance };
    }
  });

  if (insideTarget) {
    state.ui.distanceSummary.innerHTML = `<span class="in-range">Inside ${insideTarget.target.id} zone (${insideTarget.target.radiusMeters}m)</span>`;
  } else if (nearestTarget) {
    state.ui.distanceSummary.innerHTML = `<span class="out-range">Nearest: ${nearestTarget.target.id} at ${formatDistance(nearestTarget.distance)}</span>`;
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
  if (typeof position.coords.heading === "number" && !Number.isNaN(position.coords.heading)) {
    state.user.headingDeg = normalizeAngleDeg(position.coords.heading);
    state.user.hasHeading = true;
  }
  updateMapUserState();
  updateTargetOverlay();
}

function getGeolocationErrorMessage(error) {
  if (!error || typeof error.code !== "number") {
    return "Unable to read location.";
  }

  if (error.code === error.PERMISSION_DENIED) {
    return "Location permission denied by browser/device settings.";
  }
  if (error.code === error.POSITION_UNAVAILABLE) {
    return "Location unavailable on this device right now.";
  }
  if (error.code === error.TIMEOUT) {
    return "Location request timed out before first fix.";
  }
  return error.message || "Unable to read location.";
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
    state.ui.statusLine.textContent = "Live position tracking active.";
  } catch (error) {
    throw new Error(getGeolocationErrorMessage(error));
  }

  state.watchers.geolocation = navigator.geolocation.watchPosition(
    (position) => {
      applyPositionUpdate(position);
      state.ui.statusLine.textContent = "Live position tracking active.";
    },
    (error) => {
      state.ui.statusLine.textContent = `Location error: ${getGeolocationErrorMessage(error)}`;
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
    state.ui.xrSummary.textContent = "WebXR AR: not available on this device/browser.";
    return;
  }
  try {
    const supported = await navigator.xr.isSessionSupported("immersive-ar");
    state.ui.xrSummary.textContent = supported
      ? "WebXR AR: supported. Current UI uses 2D overlay mode."
      : "WebXR AR: API available, immersive-ar not supported.";
  } catch (error) {
    state.ui.xrSummary.textContent = `WebXR AR check failed: ${error.message}`;
  }
}

async function startExperience() {
  state.ui.startButton.disabled = true;
  state.ui.startButton.textContent = "Starting...";
  state.ui.statusLine.textContent = "Requesting camera, location, and orientation permissions...";

  try {
    // Orientation permission should be requested as early as possible in the user gesture path.
    const orientationEnabled = await enableOrientation();
    state.capabilities.orientationForArrows = orientationEnabled;
    await enableCamera();
    await enableGeolocation();

    if (!orientationEnabled) {
      clearArrowOverlay();
      state.ui.statusLine.textContent =
        "Camera and location active. Device orientation unavailable/denied, live-view arrows disabled.";
    } else {
      enableArrowOverlay();
      state.ui.statusLine.textContent =
        "Camera, location, and orientation active. If arrows are missing, rotate device to initialize compass.";
    }
    updateTargetOverlay();
  } catch (error) {
    const secureHint = !window.isSecureContext
      ? " HTTPS is required for geolocation."
      : " On Quest, also verify headset Location Services are enabled.";
    state.ui.statusLine.textContent = `Setup failed: ${error.message}.${secureHint}`;
    state.ui.startButton.disabled = false;
    state.ui.startButton.textContent = "Retry start";
  }
}

async function init() {
  state.ui = {
    cameraView: byId("cameraView"),
    overlayArrows: byId("overlayArrows"),
    mapFollowButton: byId("mapFollowButton"),
    mapEdgeTargets: byId("mapEdgeTargets"),
    statusLine: byId("statusLine"),
    distanceSummary: byId("distanceSummary"),
    xrSummary: byId("xrSummary"),
    startButton: byId("startButton")
  };

  await loadTargets();
  setupMap();
  updateXrSupportLabel();

  state.ui.startButton.addEventListener("click", startExperience);
  state.ui.mapFollowButton.addEventListener("click", () => {
    state.mapControl.followUser = true;
    state.ui.mapFollowButton.classList.remove("off");
    state.ui.mapFollowButton.textContent = "Following";
    updateMapUserState();
  });
}

init().catch((error) => {
  const statusLine = byId("statusLine");
  if (statusLine) {
    statusLine.textContent = `Initialization failed: ${error.message}`;
  }
});
