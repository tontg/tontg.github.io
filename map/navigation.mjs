// Shared, browser-independent navigation rules.
export const MAX_FIX_AGE_MS = 20000;
export const MAX_HEADING_AGE_MS = 20000;
export const radians = (degrees) => degrees * Math.PI / 180;
export const normalizeDegrees = (degrees) => ((degrees % 360) + 360) % 360;

export function validCoordinates(latitude, longitude) {
  return Number.isFinite(latitude) && Math.abs(latitude) <= 90 &&
    Number.isFinite(longitude) && Math.abs(longitude) <= 180;
}

export function distanceMeters(lat1, lon1, lat2, lon2) {
  const a = Math.sin(radians(lat2 - lat1) / 2) ** 2 +
    Math.cos(radians(lat1)) * Math.cos(radians(lat2)) *
    Math.sin(radians(lon2 - lon1) / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, a))));
}

export function parseRoute(data) {
  const points = data?.points ?? data?.targets;
  if (!Array.isArray(points)) throw new Error('Expected a points (or targets) array.');
  const ids = new Set();
  const targets = points.map((point, index) => {
    const id = point?.id ?? `target-${index + 1}`;
    if (typeof id !== 'string' || !id.trim() || ids.has(id)) {
      throw new Error(`Point ${index + 1}: ID must be a unique non-empty string.`);
    }
    if (!point || !validCoordinates(point.latitude, point.longitude) ||
        !Number.isFinite(point.radiusMeters) || point.radiusMeters <= 0) {
      throw new Error(`Point ${id}: invalid coordinates or radiusMeters.`);
    }
    ids.add(id);
    return { id, latitude: point.latitude, longitude: point.longitude, radiusMeters: point.radiusMeters };
  });
  const sequence = data.journey === undefined ? targets.map((point) => point.id) : data.journey?.sequence;
  if (!Array.isArray(sequence) || sequence.some((id) => !ids.has(id))) {
    throw new Error('Journey sequence must contain existing point IDs.');
  }
  const byId = new Map(targets.map((point) => [point.id, point]));
  const legRemainders = Array(sequence.length).fill(0);
  for (let i = sequence.length - 2; i >= 0; i -= 1) {
    const a = byId.get(sequence[i]);
    const b = byId.get(sequence[i + 1]);
    legRemainders[i] = legRemainders[i + 1] + distanceMeters(a.latitude, a.longitude, b.latitude, b.longitude);
  }
  return {
    targets, byId,
    journey: {
      name: typeof data.journey?.name === 'string' ? data.journey.name.trim() : '',
      sequence: [...sequence], activeStepIndex: 0, awaitingExit: false, paused: false,
      totalPlannedDistanceMeters: legRemainders[0] ?? 0, legRemainders
    }
  };
}

export function freshPosition(user, now = Date.now()) {
  const age = now - user.lastPositionTs;
  return user.locationSource === 'geolocation' && validCoordinates(user.latitude, user.longitude) &&
    age >= 0 && age <= MAX_FIX_AGE_MS;
}

export function freshCompass(user, now = Date.now()) {
  const age = now - user.lastHeadingTs;
  return user.hasHeading && user.headingSource === 'compass' && Number.isFinite(user.headingDeg) &&
    age >= 0 && age <= MAX_HEADING_AGE_MS;
}

export function navigationPositionAvailable(user, now = Date.now()) {
  return (user.locationSource === 'manual' && validCoordinates(user.latitude, user.longitude)) || freshPosition(user, now);
}

export function restartJourney(journey) {
  journey.activeStepIndex = 0;
  journey.awaitingExit = false;
  journey.paused = true;
}

export function confirmManualArrival(journey, byId, user) {
  const target = byId.get(journey.sequence[journey.activeStepIndex]);
  if (journey.paused || user.locationSource !== 'manual' || !target) return false;
  user.latitude = target.latitude;
  user.longitude = target.longitude;
  user.accuracyMeters = null;
  user.lastPositionTs = Date.now();
  journey.activeStepIndex += 1;
  journey.awaitingExit = false;
  return true;
}

// Call once per new location fix, never from rendering or language switching.
export function advanceJourney(journey, byId, user, now = Date.now()) {
  if (journey.paused || !freshPosition(user, now)) return false;
  const point = byId.get(journey.sequence[journey.activeStepIndex]);
  if (!point || !Number.isFinite(user.accuracyMeters) || user.accuracyMeters < 0 ||
      user.accuracyMeters > Math.max(25, point.radiusMeters)) return false;
  const distance = distanceMeters(user.latitude, user.longitude, point.latitude, point.longitude);
  if (journey.awaitingExit) {
    if (distance > point.radiusMeters) journey.awaitingExit = false;
    return false;
  }
  if (distance > point.radiusMeters) return false;
  journey.activeStepIndex += 1;
  const next = byId.get(journey.sequence[journey.activeStepIndex]);
  journey.awaitingExit = !!next && distanceMeters(user.latitude, user.longitude, next.latitude, next.longitude) <= next.radiusMeters;
  return true;
}

export function compassHeading(event) {
  if (Number.isFinite(event.webkitCompassHeading) && event.webkitCompassHeading >= 0 &&
      !(Number.isFinite(event.webkitCompassAccuracy) && event.webkitCompassAccuracy < 0)) {
    return normalizeDegrees(event.webkitCompassHeading);
  }
  return event.absolute === true && Number.isFinite(event.alpha) ? normalizeDegrees(360 - event.alpha) : null;
}

export function sensorConfidence(user, now = Date.now()) {
  if (user.locationSource === 'manual') return { level: 'low', detail: 'manualPosition' };
  if (!freshPosition(user, now)) return { level: 'low', detail: 'stale' };
  if (!freshCompass(user, now)) return { level: 'low', detail: 'headingUnavailable' };
  if (!Number.isFinite(user.accuracyMeters) || user.accuracyMeters > 25) return { level: 'low', detail: 'poorAccuracy' };
  if (user.accuracyMeters > 10 || now - user.lastPositionTs > 8000 || now - user.lastHeadingTs > 8000) {
    return { level: 'med', detail: 'someDrift' };
  }
  return { level: 'high', detail: 'stable' };
}

// Clockwise bearing of the headset's horizontal forward vector in local XR space.
export function viewerYawDegrees(q) {
  const x = -2 * (q.x * q.z + q.w * q.y);
  const z = -(1 - 2 * (q.x * q.x + q.y * q.y));
  return Math.hypot(x, z) < 0.001 ? null : normalizeDegrees(Math.atan2(x, -z) * 180 / Math.PI);
}
