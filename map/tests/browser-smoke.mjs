// Optional integration test: PLAYWRIGHT_MODULE may point to an existing playwright-core install.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve, extname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { checkFeatures } from './browser-features.mjs';

const require = createRequire(import.meta.url);
const playwright = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const root = fileURLToPath(new URL('../', import.meta.url));
const assets = process.env.TEST_ASSET_DIR || join(tmpdir(), 'geo-map-review-assets');
const bridge = `
window.testApp = { state, applyPositionUpdate, handleOrientationEvent, applyLanguage, updateTargetOverlay,
  updateMapUserState, loadThree, setupXrScene, teardownXrScene, updateXrViewerPose, updateXrArrows,
  updateXrHud, updateXrMiniMap, createEdgeBullet, ensureArrowNode, tooltipText, enableGeolocation,
  enableCamera, stopCamera, formatDistance, getJourneyRemainingDistanceMeters,
  createNativeControls(session) {
    state.xr.controls = new XrControls(THREE, state.xr.scene, session, {
      labels: () => state.tools.xrLabels(), onAction: (id) => state.tools.xrAction(id)
    });
    return state.xr.controls;
  },
  failXrLoading() { loadThree = async () => { throw new Error('Simulated Three.js failure'); }; }
};`;
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.ico': 'image/x-icon', '.svg': 'image/svg+xml' };
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const path = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!path.startsWith(root) || pathname.includes('..')) { res.writeHead(403).end(); return; }
    let body = await readFile(path);
    if (pathname === '/app.js') body = body.toString() + bridge;
    res.writeHead(200, { 'Content-Type': mime[extname(path)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(body);
  } catch { res.writeHead(404).end(); }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/`;
let browser;
const errors = [];
try {
  const engine = process.env.TEST_BROWSER || 'chromium';
  browser = await playwright[engine].launch(engine === 'chromium'
    ? { channel: 'chrome', headless: true, args: ['--enable-unsafe-swiftshader'] }
    : { headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'en-US', serviceWorkers: 'block' });
  const requests = [];
  await context.route('https://unpkg.com/**', async (route) => {
    const name = new URL(route.request().url()).pathname.split('/').at(-1);
    await route.fulfill({ body: await readFile(join(assets, name)), contentType: mime[extname(name)], headers: { 'access-control-allow-origin': '*' } });
  });
  await context.route('https://tile.openstreetmap.org/**', async (route) => {
    await route.fulfill({ body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=', 'base64'), contentType: 'image/png', headers: { 'access-control-allow-origin': '*' } });
  });
  await context.addInitScript(() => {
    window.cspViolations = [];
    document.addEventListener('securitypolicyviolation', (event) => cspViolations.push(event.violatedDirective));
    window.mockGeo = { watches: 0, clears: 0, success: null, error: null };
    Object.defineProperty(navigator, 'geolocation', { value: {
      watchPosition(success, error) { mockGeo.watches++; mockGeo.success = success; mockGeo.error = error; return mockGeo.watches; },
      clearWatch() { mockGeo.clears++; }
    } });
    Object.defineProperty(window, 'DeviceOrientationEvent', { value: class { static requestPermission() { return Promise.resolve('denied'); } } });
    Object.defineProperty(navigator, 'mediaDevices', { value: {
      getUserMedia: async () => { throw new Error('Simulated camera permission denial'); }
    } });
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => requests.push(request.url()));
  await page.goto(url);
  await page.waitForFunction(() => window.testApp?.state.map);
  assert.match(await page.locator('#versionLine').textContent(), /0\.8\.0/);
  assert.equal(requests.some((url) => url.includes('three.module') || url.includes('abstractapi')), false);
  assert.match(await page.locator('.leaflet-control-attribution').textContent(), /OpenStreetMap contributors/);
  assert.match(await page.locator('#distanceSummary').textContent(), /No location fix/);
  await page.selectOption('#languageSelect', 'fr');
  assert.equal(await page.locator('html').getAttribute('lang'), 'fr');
  assert.match(await page.locator('#statusLine').textContent(), /Touchez/);
  assert.match(await page.locator('#distanceSummary').textContent(), /Pas encore/);
  await page.selectOption('#languageSelect', 'en');
  for (const [width, height] of [[320, 568], [390, 844], [844, 390], [1440, 900]]) {
    await page.setViewportSize({ width, height });
    const status = await page.locator('#statusPanel').boundingBox();
    const map = await page.locator('#mapContainer').boundingBox();
    assert.ok(status.x + status.width < map.x, `Panels overlap at ${width}x${height}`);
    assert.ok(status.y >= 0, `Panel clipped at ${width}x${height}`);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.click('#aboutLink');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'aboutCloseButton');
  await page.keyboard.press('Shift+Tab');
  assert.match(await page.evaluate(() => document.activeElement.href), /flaticon/);
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'aboutLink');

  await page.click('#startButton');
  await page.waitForFunction(() => mockGeo.watches === 1);
  await page.evaluate(() => mockGeo.success({ timestamp: Date.now(), coords: { latitude: 33.56, longitude: -7.65, accuracy: 3, heading: 180 } }));
  await page.waitForFunction(() => !testApp.state.app.starting);
  await page.waitForFunction(() => document.querySelector('#distanceSummary').textContent.includes('Next step'));
  assert.equal(await page.evaluate(() => testApp.state.user.hasHeading), false);
  assert.equal(await page.locator('.user-heading-marker').count(), 0);
  assert.equal(await page.locator('#overlayArrows').isVisible(), false);
  assert.match(await page.locator('#distanceSummary').textContent(), /Next step/);
  await page.click('#startButton');
  await page.waitForFunction(() => !testApp.state.app.starting);
  assert.equal(await page.evaluate(() => mockGeo.watches), 1);

  await page.evaluate(() => {
    testApp.state.capabilities.orientationForArrows = true;
    testApp.handleOrientationEvent({ absolute: true, alpha: 270 });
  });
  await page.waitForFunction(() => document.querySelectorAll('.target-arrow').length === 3);
  assert.equal(await page.locator('.user-heading-marker').count(), 1);
  const counts = await page.evaluate(() => {
    const original = testApp.state.map.setView.bind(testApp.state.map);
    let calls = 0;
    testApp.state.map.setView = (...args) => { calls++; return original(...args); };
    const index = testApp.state.journey.activeStepIndex;
    for (let i = 0; i < 50; i++) {
      testApp.handleOrientationEvent({ absolute: true, alpha: i });
      testApp.updateTargetOverlay();
    }
    testApp.applyLanguage('fr');
    return { calls, index, after: testApp.state.journey.activeStepIndex };
  });
  assert.equal(counts.calls, 0);
  assert.equal(counts.index, counts.after);
  await page.evaluate(() => { testApp.state.user.lastHeadingTs = Date.now() - 21000; testApp.updateMapUserState(); testApp.updateTargetOverlay(); });
  assert.equal(await page.locator('.user-heading-marker').count(), 0);
  assert.equal(await page.locator('#overlayArrows').isVisible(), false);

  const injection = await page.evaluate(() => {
    const id = '\"][data-test="x"]<img src=x onerror=alert(1)>';
    const bullet = testApp.createEdgeBullet({ id }, 1, 1);
    const arrow = testApp.ensureArrowNode(id);
    const tooltip = testApp.tooltipText(id);
    return { bullet: bullet.textContent, hasImage: !!bullet.querySelector('img'), tooltip: tooltip.textContent, arrow: arrow.dataset.targetId };
  });
  assert.equal(injection.hasImage, false);
  assert.equal(injection.bullet, injection.tooltip);
  assert.equal(injection.arrow, injection.tooltip);

  const regression = await page.evaluate(() => {
    const app = testApp, s = app.state;
    const a = s.targets[0];
    s.journey.sequence = ['A', 'A'];
    s.journey.activeStepIndex = 0;
    s.journey.awaitingExit = false;
    s.journey.legRemainders = [0, 0];
    app.applyPositionUpdate({ timestamp: Date.now(), coords: { latitude: a.latitude, longitude: a.longitude, accuracy: 3, heading: 180 } });
    const afterFix = s.journey.activeStepIndex;
    app.updateTargetOverlay();
    app.applyLanguage('en');
    app.updateTargetOverlay();
    const afterRendering = s.journey.activeStepIndex;
    const timestamp = s.user.lastPositionTs;
    app.applyPositionUpdate({ timestamp, coords: { latitude: 0, longitude: 0, accuracy: 3 } });
    const duplicateIgnored = s.user.latitude === a.latitude;
    s.mapControl.followUser = false;
    s.map.setView([33, -8], 12);
    app.updateMapUserState();
    const zoom = s.map.getZoom(), latitude = s.map.getCenter().lat;
    s.user.lastPositionTs -= 21000;
    const remaining = app.getJourneyRemainingDistanceMeters(s.user.latitude, s.user.longitude);
    return { afterFix, afterRendering, duplicateIgnored, zoom, latitude, remaining,
      distances: [4.07, 999, 4070, 10000].map(app.formatDistance) };
  });
  assert.equal(regression.afterFix, 1);
  assert.equal(regression.afterRendering, 1);
  assert.equal(regression.duplicateIgnored, true);
  assert.equal(regression.zoom, 12);
  assert.equal(regression.latitude, 33);
  assert.equal(regression.remaining, null);
  assert.deepEqual(regression.distances, ['4 m', '999 m', '4.1 km', '10 km']);

  await checkFeatures(page);

  const xr = await page.evaluate(async () => {
    await testApp.loadThree();
    testApp.setupXrScene();
    const s = testApp.state;
    s.xr.session = {};
    Object.assign(s.user, { latitude: 33.56, longitude: -7.65, locationSource: 'geolocation', hasHeading: true, headingSource: 'compass', accuracyMeters: 3 });
    s.journey.paused = false;
    s.user.lastPositionTs = s.user.lastHeadingTs = Date.now();
    s.user.headingDeg = 0;
    s.xr.renderer.xr.getReferenceSpace = () => ({});
    let position = { x: 1, y: 2, z: 3 };
    let orientation = { x: 0, y: 0, z: 0, w: 1 };
    const frame = { getViewerPose: () => ({ transform: { position, orientation } }) };
    testApp.updateXrViewerPose(frame);
    testApp.updateXrArrows(1);
    const arrow = s.xr.closestArrowMesh;
    const first = { x: arrow.position.x, y: arrow.position.y, z: arrow.position.z, rotationX: arrow.rotation.x, rotationZ: arrow.rotation.z, inScene: arrow.parent === s.xr.scene };
    position = { x: 2, y: 2.1, z: 3.5 };
    orientation = { x: Math.sin(Math.PI / 8), y: 0, z: 0, w: Math.cos(Math.PI / 8) };
    testApp.updateXrViewerPose(frame);
    testApp.updateXrArrows(2);
    const moved = { x: arrow.position.x, y: arrow.position.y, z: arrow.position.z, rotationX: arrow.rotation.x, rotationZ: arrow.rotation.z };
    const source = { targetRaySpace: {} };
    const session = { inputSources: [source], addEventListener(name, callback) { this[name] = callback; }, removeEventListener(name) { delete this[name]; } };
    const controls = testApp.createNativeControls(session);
    frame.getPose = () => null;
    controls.update(frame, {}, s.xr.viewerPose);
    function selectButton(column, row) {
      controls.plane.updateMatrixWorld(true);
      const target = new controls.THREE.Vector3((column - 1) * 1.08 / 3, (0.5 - row) * (1.08 * 300 / 1024) / 2, 0)
        .applyMatrix4(controls.plane.matrixWorld);
      const origin = target.clone().add(new controls.THREE.Vector3(0, 0, 1).applyQuaternion(controls.plane.quaternion));
      frame.getPose = () => ({ transform: { position: origin, orientation: controls.plane.quaternion } });
      session.select({ frame, inputSource: source });
    }
    selectButton(0, 0);
    const pausedByRay = s.journey.paused;
    selectButton(0, 0);
    const resumedByRay = !s.journey.paused;
    selectButton(0, 1);
    const calibrationArmedByRay = s.tools.calibration.armed;
    selectButton(0, 1);
    testApp.updateXrHud(500);
    const firstHudVersion = s.xr.hudTexture.version;
    testApp.updateXrHud(1000);
    const secondHudVersion = s.xr.hudTexture.version;
    s.xr.northOffsetDeg = null;
    testApp.updateXrArrows(3);
    const hiddenWithoutNorth = !arrow.visible;
    let disposed = 0;
    s.xr.scene.traverse((object) => object.geometry?.addEventListener('dispose', () => disposed++));
    testApp.teardownXrScene();
    s.xr.session = null;
    return { first, moved, hiddenWithoutNorth, disposed, firstHudVersion, secondHudVersion, pausedByRay, resumedByRay, calibrationArmedByRay };
  });
  assert.equal(xr.first.inScene, true);
  assert.equal(xr.pausedByRay, true);
  assert.equal(xr.resumedByRay, true);
  assert.equal(xr.calibrationArmedByRay, true);
  assert.equal(xr.first.rotationX, 0);
  assert.equal(xr.first.rotationZ, 0);
  assert.ok(Math.abs(xr.first.y - 1.38) < 0.001);
  assert.ok(Math.abs(xr.moved.x - xr.first.x - 1) < 0.001);
  assert.ok(Math.abs(xr.moved.y - xr.first.y - 0.1) < 0.001);
  assert.equal(xr.moved.rotationX, 0);
  assert.equal(xr.moved.rotationZ, 0);
  assert.equal(xr.hiddenWithoutNorth, true);
  assert.ok(xr.disposed >= 7);
  assert.equal(xr.firstHudVersion, xr.secondHudVersion);

  await page.evaluate(() => {
    window.xrRequest = { calls: 0, ended: 0, active: false };
    testApp.state.xr.supported = true;
    document.querySelector('#enterArButton').disabled = false;
    Object.defineProperty(navigator, 'xr', { value: {
      async requestSession() {
        xrRequest.calls++; xrRequest.active = navigator.userActivation.isActive;
        const events = {};
        return { addEventListener(name, cb) { events[name] = cb; }, async end() { xrRequest.ended++; events.end?.(); } };
      }
    } });
    testApp.failXrLoading();
  });
  await page.click('#enterArButton');
  await page.waitForFunction(() => xrRequest.ended === 1);
  const lifecycle = await page.evaluate(() => ({ ...xrRequest, session: testApp.state.xr.session, starting: testApp.state.xr.starting }));
  assert.equal(lifecycle.active, true);
  assert.equal(lifecycle.calls, 1);
  assert.equal(lifecycle.session, null);
  assert.equal(lifecycle.starting, false);
  assert.deepEqual(await page.evaluate(() => cspViolations), []);
  assert.deepEqual(errors, []);
  console.log('Browser smoke checks passed: startup, lazy loading, i18n, 4 viewport sizes, modal focus, denied permissions, compass, injection, XR anchoring/disposal and failed-session cleanup.');
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
