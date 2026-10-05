import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseRoute, advanceJourney, distanceMeters, compassHeading, freshCompass,
  sensorConfidence, viewerYawDegrees } from '../navigation.mjs';

const points = [
  { id: 'A', latitude: 0, longitude: 0, radiusMeters: 5 },
  { id: 'B', latitude: 0, longitude: 0.001, radiusMeters: 5 }
];
const now = 100000;
const user = (overrides = {}) => ({
  latitude: 0, longitude: 0, accuracyMeters: 3, lastPositionTs: now, locationSource: 'geolocation',
  headingDeg: 20, hasHeading: true, headingSource: 'compass', lastHeadingTs: now, ...overrides
});

test('validates coordinates, radii, IDs and journey references', () => {
  for (const invalid of [null, NaN, Infinity, 91, '12']) {
    assert.throws(() => parseRoute({ points: [{ ...points[0], latitude: invalid }] }));
  }
  assert.throws(() => parseRoute({ points: [null] }));
  assert.throws(() => parseRoute({ points: [points[0], points[0]] }));
  assert.throws(() => parseRoute({ points: [{ ...points[0], radiusMeters: 0 }] }));
  assert.throws(() => parseRoute({ points, journey: { sequence: ['missing'] } }));
  assert.deepEqual(parseRoute({ targets: points }).journey.sequence, ['A', 'B']);
});

test('precomputes repeated journey distances and supports empty routes', () => {
  const { journey } = parseRoute({ points, journey: { sequence: ['A', 'B', 'A'] } });
  const leg = distanceMeters(0, 0, 0, 0.001);
  assert.equal(journey.totalPlannedDistanceMeters, 2 * leg);
  assert.deepEqual(journey.legRemainders, [2 * leg, leg, 0]);
  assert.equal(parseRoute({ points: [] }).journey.totalPlannedDistanceMeters, 0);
  assert.ok(Number.isFinite(distanceMeters(89.1, 0, -89.1, 180)));
});

test('journey advances only on fresh precise geolocation, one step per fix', () => {
  const { journey, byId } = parseRoute({ points });
  for (const fix of [user({ locationSource: 'ip' }), user({ lastPositionTs: 1 }),
    user({ lastPositionTs: now + 1 }), user({ accuracyMeters: 500 }), user({ accuracyMeters: null })]) {
    assert.equal(advanceJourney(journey, byId, fix, now), false);
    assert.equal(journey.activeStepIndex, 0);
  }
  assert.equal(advanceJourney(journey, byId, user(), now), true);
  assert.equal(journey.activeStepIndex, 1);
});

test('overlapping or consecutive repeated points require leaving and re-entering', () => {
  const { journey, byId } = parseRoute({ points, journey: { sequence: ['A', 'A', 'B', 'A'] } });
  advanceJourney(journey, byId, user(), now);
  assert.equal(journey.activeStepIndex, 1);
  advanceJourney(journey, byId, user(), now);
  assert.equal(journey.activeStepIndex, 1);
  advanceJourney(journey, byId, user({ longitude: 0.0001 }), now);
  advanceJourney(journey, byId, user(), now);
  assert.equal(journey.activeStepIndex, 2);
  advanceJourney(journey, byId, user({ longitude: 0.001 }), now);
  advanceJourney(journey, byId, user(), now);
  assert.equal(journey.activeStepIndex, 4);
});

test('relative orientation, invalid compass readings and GPS course are not compass headings', () => {
  assert.equal(compassHeading({ alpha: 90, absolute: false }), null);
  assert.equal(compassHeading({ webkitCompassHeading: NaN }), null);
  assert.equal(compassHeading({ webkitCompassHeading: 20, webkitCompassAccuracy: -1 }), null);
  assert.equal(compassHeading({ webkitCompassHeading: 90 }), 90);
  assert.equal(compassHeading({ alpha: 90, absolute: true }), 270);
  assert.equal(freshCompass(user({ headingSource: 'geolocation' }), now), false);
});

test('confidence respects sensor ages and reported GPS accuracy', () => {
  assert.equal(sensorConfidence(user(), now).level, 'high');
  assert.equal(sensorConfidence(user(), now + 9000).level, 'med');
  assert.equal(sensorConfidence(user(), now + 21000).level, 'low');
  assert.equal(sensorConfidence(user({ accuracyMeters: 300 }), now).detail, 'poorAccuracy');
  assert.equal(sensorConfidence(user({ hasHeading: false }), now).detail, 'headingUnavailable');
  assert.equal(sensorConfidence(user(), 1000).level, 'low');
});

test('XR viewer yaw is horizontal and detects vertical singularities', () => {
  assert.equal(viewerYawDegrees({ x: 0, y: 0, z: 0, w: 1 }), 0);
  assert.ok(Math.abs(viewerYawDegrees({ x: 0, y: -Math.SQRT1_2, z: 0, w: Math.SQRT1_2 }) - 90) < 0.001);
  assert.equal(viewerYawDegrees({ x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 }), null);
});

test('shipped route is valid; translation keys and interpolation variables match', async () => {
  parseRoute(JSON.parse(await readFile(new URL('../data/targets.json', import.meta.url))));
  const messages = JSON.parse(await readFile(new URL('../data/i18n.json', import.meta.url)));
  assert.deepEqual(Object.keys(messages.en).sort(), Object.keys(messages.fr).sort());
  for (const key of Object.keys(messages.en)) {
    const placeholders = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
    assert.deepEqual(placeholders(messages.en[key]), placeholders(messages.fr[key]), key);
  }
  const source = await readFile(new URL('../app.js', import.meta.url), 'utf8');
  for (const match of source.matchAll(/\bt\("([\w.]+)"/g)) assert.ok(messages.en[match[1]], match[1]);
});
