import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseRoute, advanceJourney, restartJourney, confirmManualArrival, navigationPositionAvailable, sensorConfidence } from '../navigation.mjs';
import { createJourneyStore, routeDocument } from '../journey-store.mjs';
import { ArrivalFeedback } from '../feedback.mjs';
import { JourneyTools } from '../journey-tools.mjs';

const document = { points: [{ id: 'A', latitude: 33, longitude: -7, radiusMeters: 5 },
  { id: 'B', latitude: 33.01, longitude: -7, radiusMeters: 5 }], journey: { name: 'Test', sequence: ['A', 'B', 'A'] } };
function memoryStorage() {
  const values = new Map();
  return { values, getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
}

test('saved progress restores paused and is bound to exact route content', () => {
  const storage = memoryStorage(), store = createJourneyStore(storage, '/map/');
  const route = parseRoute(document);
  route.journey.activeStepIndex = 2;
  route.journey.awaitingExit = true;
  assert.equal(store.saveProgress(route.targets, route.journey), true);
  const restored = parseRoute(document);
  assert.equal(store.restoreProgress(restored.targets, restored.journey), true);
  assert.equal(restored.journey.activeStepIndex, 2);
  assert.equal(restored.journey.paused, true);
  assert.equal(restored.journey.awaitingExit, true);
  restored.targets[0].radiusMeters = 20;
  assert.equal(store.restoreProgress(restored.targets, restored.journey), false);
  assert.equal(createJourneyStore(storage, '/other/').restoreProgress(route.targets, route.journey), false);
});

test('corrupt, incompatible and out-of-range saves are ignored', () => {
  const storage = memoryStorage(), store = createJourneyStore(storage, '/map/');
  const route = parseRoute(document);
  store.saveProgress(route.targets, route.journey);
  const key = 'geo-map:/map/:progress', saved = JSON.parse(storage.values.get(key));
  for (const patch of [{ version: 99 }, { activeStepIndex: -1 }, { activeStepIndex: 100 }, { activeStepIndex: '1' }, { awaitingExit: 'true' }]) {
    storage.values.set(key, JSON.stringify({ ...saved, ...patch }));
    assert.equal(store.restoreProgress(route.targets, route.journey), false);
  }
  storage.values.set(key, 'broken');
  assert.equal(store.restoreProgress(route.targets, route.journey), false);
});

test('quota errors do not stop navigation or get hidden by another successful write', () => {
  const storage = memoryStorage();
  const original = storage.setItem;
  storage.setItem = (key, value) => { if (key.endsWith(':route')) throw new Error('quota'); original(key, value); };
  const store = createJourneyStore(storage, '/map/');
  const route = parseRoute(document);
  assert.equal(store.saveRoute(document), false);
  assert.equal(store.saveProgress(route.targets, route.journey), true);
  assert.equal(store.available, false);
  assert.equal(store.clearRoute(), true);
  assert.equal(store.available, true);
});

test('custom route and preferences round-trip without persisting live sensor coordinates', () => {
  const store = createJourneyStore(memoryStorage(), '/map/');
  const route = parseRoute(document);
  route.targets[0].metrics = { distance: 12 };
  assert.deepEqual(routeDocument(route.targets, route.journey), document);
  store.saveRoute(document);
  assert.deepEqual(store.loadRoute(), document);
  store.savePreferences({ sound: true, haptics: false });
  assert.deepEqual(store.loadPreferences(), { sound: true, haptics: false });
  store.clearRoute();
  assert.equal(store.loadRoute(), null);
});

test('pause blocks GPS progress, resume accepts a new fix, restart returns to a paused first step', () => {
  const { targets, byId, journey } = parseRoute(document);
  const user = { ...targets[0], locationSource: 'geolocation', lastPositionTs: Date.now(), accuracyMeters: 3 };
  journey.paused = true;
  assert.equal(advanceJourney(journey, byId, user), false);
  journey.paused = false;
  assert.equal(advanceJourney(journey, byId, user), true);
  restartJourney(journey);
  assert.equal(journey.activeStepIndex, 0);
  assert.equal(journey.paused, true);
  assert.equal(journey.awaitingExit, false);
});

test('manual position is usable but never auto-advances; explicit arrival accepts exactly one step', () => {
  const { targets, byId, journey } = parseRoute(document);
  const user = { ...targets[0], locationSource: 'manual', lastPositionTs: 1, accuracyMeters: 1 };
  assert.equal(navigationPositionAvailable(user), true);
  assert.equal(sensorConfidence(user).detail, 'manualPosition');
  assert.equal(advanceJourney(journey, byId, user), false);
  assert.equal(confirmManualArrival(journey, byId, user), true);
  assert.equal(journey.activeStepIndex, 1);
  journey.paused = true;
  assert.equal(confirmManualArrival(journey, byId, user), false);
  journey.paused = false;
  assert.equal(confirmManualArrival(journey, byId, user), true);
  assert.equal(user.latitude, targets[1].latitude);
  user.locationSource = 'geolocation';
  assert.equal(confirmManualArrival(journey, byId, user), false);
});

test('manual XR calibration requires a pose and countdown, and resets with the reference space', () => {
  const tools = Object.create(JourneyTools.prototype);
  tools.state = { xr: {} };
  tools.calibration = { armed: true, bearing: 90, deadline: null };
  tools.render = () => {};
  tools.updateCalibration(null, 1000);
  assert.equal(tools.calibration.deadline, null);
  tools.updateCalibration(45, 2000);
  tools.updateCalibration(45, 4999);
  assert.equal(tools.state.xr.northOffsetDeg, undefined);
  tools.updateCalibration(null, 4999);
  assert.equal(tools.calibration.deadline, null);
  tools.updateCalibration(45, 5000);
  assert.equal(tools.state.xr.northOffsetDeg, undefined);
  tools.updateCalibration(45, 8000);
  assert.equal(tools.state.xr.northOffsetDeg, 45);
  assert.equal(tools.state.xr.northSource, 'manual');
  tools.resetCalibration();
  assert.equal(tools.state.xr.northOffsetDeg, null);
  assert.equal(tools.calibration.armed, false);
});

test('arrival feedback defaults off and tolerates unsupported or rejecting XR actuators', async () => {
  const feedback = new ArrivalFeedback();
  await feedback.play();
  assert.equal(feedback.lastResult, 'feedback.off');
  feedback.preferences.haptics = true;
  await feedback.play(false, { inputSources: [{ gamepad: { hapticActuators: [{ pulse() { throw new Error('unsupported'); } }] } }] });
  assert.equal(feedback.lastResult, 'feedback.unavailable');
  let pulses = 0;
  await feedback.play(true, { inputSources: [{ gamepad: { hapticActuators: [{ async pulse(value, duration) {
    assert.equal(value, 0.5); assert.equal(duration, 250); pulses++; return true;
  } }] } }] });
  assert.equal(pulses, 1);
  assert.equal(feedback.lastResult, 'feedback.sent');
});

test('arrival sound schedules short oscillators and frees their audio nodes', async () => {
  const feedback = new ArrivalFeedback({ sound: true });
  let started = 0, disconnected = 0;
  feedback.audio = { state: 'running', currentTime: 0, destination: {},
    createGain: () => ({ gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, disconnect() { disconnected++; } }),
    createOscillator: () => ({ frequency: {}, connect(node) { return node; }, start() { started++; }, stop() { this.onended(); }, disconnect() { disconnected++; } })
  };
  await feedback.play(true);
  assert.equal(started, 3);
  assert.equal(disconnected, 6);
});

test('new UI and module translations exist in both languages', async () => {
  const messages = JSON.parse(await readFile(new URL('../data/i18n.json', import.meta.url)));
  for (const file of ['journey-tools.mjs', 'route-editor.mjs', 'feedback.mjs', 'index.html']) {
    const source = await readFile(new URL('../' + file, import.meta.url), 'utf8');
    const keys = new Set([...source.matchAll(/['"]((?:journey|tools|editor|position|point|calibration|diagnostics|feedback|arrival|storage|gpx)\.[a-zA-Z]+)['"]/g)].map((match) => match[1]));
    for (const key of keys) { assert.ok(messages.en[key], `${file}: ${key}`); assert.ok(messages.fr[key], `${file}: ${key}`); }
  }
});
