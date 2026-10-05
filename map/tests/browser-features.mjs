import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

export async function checkFeatures(page) {
  const parser = await page.evaluate(async () => {
    const { parseGpx } = await import('/gpx.mjs');
    const candidates = parseGpx('<g:gpx xmlns:g="http://www.topografix.com/GPX/1/1"><g:rte><g:name>Route</g:name><g:rtept lat="33" lon="-7"><g:name>A</g:name></g:rtept><g:rtept lat="33.1" lon="-7"><g:name>A</g:name></g:rtept></g:rte><g:trk><g:trkseg><g:trkpt lat="33" lon="-7"/></g:trkseg><g:trkseg><g:trkpt lat="34" lon="-7"/></g:trkseg></g:trk><g:wpt lat="35" lon="-7"/></g:gpx>');
    const rejected = [];
    for (const text of ['<!DOCTYPE gpx [<!ENTITY x "bad">]><gpx/>', '<gpx><rte>', '<gpx/>', '<gpx><wpt lat="91" lon="0"/></gpx>',
      '<gpx><wpt lat="" lon="0"/></gpx>', '<gpx>' + '<wpt lat="0" lon="0"/>'.repeat(501) + '</gpx>', ' '.repeat(2 * 1024 * 1024 + 1)]) {
      try { parseGpx(text); rejected.push(false); } catch { rejected.push(true); }
    }
    return { count: candidates.length, ids: candidates[0].points.map((point) => point.id), rejected };
  });
  assert.equal(parser.count, 4);
  assert.deepEqual(parser.ids, ['A', 'A-2']);
  assert.ok(parser.rejected.every(Boolean));

  await page.click('#toolsButton');
  if (process.env.REVIEW_SCREENSHOTS) await page.screenshot({ path: join(tmpdir(), 'geo-map-tools-0.8.png') });
  await page.selectOption('#manualWaypoint', 'A');
  await page.click('#manualPositionForm button[type=submit]');
  await page.waitForFunction(() => document.querySelector('#distanceSummary').textContent.includes('Manual estimate'));
  const manual = await page.evaluate(() => {
    const s = testApp.state;
    const before = { latitude: s.user.latitude, step: s.journey.activeStepIndex };
    testApp.applyPositionUpdate({ timestamp: Date.now(), coords: { latitude: 40, longitude: 2, accuracy: 3 } });
    return { before, latitude: s.user.latitude, step: s.journey.activeStepIndex, source: s.user.locationSource };
  });
  assert.equal(manual.source, 'manual');
  assert.equal(manual.latitude, manual.before.latitude);
  assert.equal(manual.step, manual.before.step);
  await page.fill('#calibrationBearing', '90');
  await page.click('#calibrateNorth');
  assert.equal(await page.evaluate(() => testApp.state.tools.calibration.armed), true);
  assert.equal(await page.evaluate(() => testApp.state.tools.calibration.bearing), 90);
  await page.check('#soundEnabled');
  await page.check('#hapticsEnabled');
  assert.deepEqual(await page.evaluate(() => testApp.state.tools.store.loadPreferences()), { sound: true, haptics: true });
  await page.uncheck('#soundEnabled');
  await page.uncheck('#hapticsEnabled');

  await page.click('#editorOpen');
  await page.waitForFunction(() => !!testApp.state.tools.editor.map);
  const before = await page.evaluate(() => testApp.state.targets.length);
  await page.evaluate(() => testApp.state.tools.editor.map.fire('click', { latlng: L.latLng(33.7, -7.4) }));
  assert.equal(await page.evaluate(() => testApp.state.tools.editor.draft.points.length), before + 1);
  assert.equal(await page.evaluate(() => testApp.state.targets.length), before);
  await page.fill('#editorPointId', 'New <point>');
  await page.fill('#editorRadius', '12');
  await page.click('#editorPointForm button[type=submit]');
  await page.click('#editorAddStep');
  const draft = await page.evaluate(() => testApp.state.tools.editor.draft);
  assert.equal(draft.points.at(-1).id, 'New <point>');
  assert.equal(draft.points.at(-1).radiusMeters, 12);
  assert.equal(draft.journey.sequence.at(-1), 'New <point>');
  assert.equal(draft.journey.sequence.at(-2), 'New <point>');
  assert.equal(await page.locator('#editorSteps point').count(), 0);
  await page.locator('#editorSteps li').last().locator('button').first().click();
  await page.locator('#editorSteps li').last().locator('button').last().click();
  assert.equal(await page.evaluate(() => testApp.state.tools.editor.draft.journey.sequence.length), draft.journey.sequence.length - 1);
  await page.evaluate(() => {
    const editor = testApp.state.tools.editor;
    const marker = editor.markers.getLayers().find((layer) => layer.dragging);
    marker.setLatLng([33.123, -7.321]);
    marker.fire('dragend');
  });
  assert.equal(await page.evaluate(() => testApp.state.tools.editor.draft.points[0].latitude), 33.123);

  const gpx = '<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1"><rte><name>Imported Tour</name><rtept lat="33.7" lon="-7.4"><name>First</name></rtept><rtept lat="33.8" lon="-7.3"><name>Second</name></rtept></rte></gpx>';
  await page.setInputFiles('#editorFile', { name: 'tour.gpx', mimeType: 'application/gpx+xml', buffer: Buffer.from(gpx) });
  await page.waitForFunction(() => !document.querySelector('#editorImportOptions').hidden);
  await page.click('#editorLoadImport');
  if (process.env.REVIEW_SCREENSHOTS) {
    await page.evaluate(() => { document.querySelector('#editorDialog').scrollTop = 0; });
    await page.screenshot({ path: join(tmpdir(), 'geo-map-editor-0.8.png') });
  }
  assert.deepEqual(await page.evaluate(() => testApp.state.tools.editor.draft.journey.sequence), ['First', 'Second']);
  const downloaded = page.waitForEvent('download');
  await page.click('#editorExport');
  assert.equal((await downloaded).suggestedFilename(), 'targets.json');
  page.once('dialog', (dialog) => dialog.accept());
  await page.click('#editorApply');
  await page.waitForFunction(() => !document.querySelector('#editorDialog').open);
  assert.equal(await page.evaluate(() => testApp.state.journey.name), 'Imported Tour');
  assert.equal(await page.evaluate(() => testApp.state.journey.paused), true);
  assert.equal(await page.evaluate(() => testApp.state.layers.targetCircles.length), 2);
  assert.equal(await page.locator('.target-arrow').count(), 0);
  await page.click('#journeyPause');
  assert.equal(await page.evaluate(() => testApp.state.journey.paused), false);
  await page.click('#toolsButton');
  page.once('dialog', (dialog) => dialog.accept());
  await page.click('#manualArrival');
  assert.equal(await page.evaluate(() => testApp.state.journey.activeStepIndex), 1);
  assert.equal(await page.evaluate(() => testApp.state.user.latitude), 33.7);
  await page.click('#toolsClose');
  await page.reload();
  await page.waitForFunction(() => testApp?.state.map && testApp.state.tools);
  const restored = await page.evaluate(() => ({ name: testApp.state.journey.name, step: testApp.state.journey.activeStepIndex,
    paused: testApp.state.journey.paused, restored: testApp.state.tools.restored, source: testApp.state.user.locationSource }));
  assert.deepEqual(restored, { name: 'Imported Tour', step: 1, paused: true, restored: true, source: 'none' });
  await page.selectOption('#languageSelect', 'fr');
  assert.match(await page.locator('#toolsButton').textContent(), /Outils/);
  assert.match(await page.locator('#journeyState').textContent(), /restaurée/);
  await page.selectOption('#languageSelect', 'en');
  await page.click('#toolsButton');
  page.once('dialog', (dialog) => dialog.accept());
  await page.click('#journeyRestart');
  assert.equal(await page.evaluate(() => testApp.state.journey.activeStepIndex), 0);
  assert.equal(await page.evaluate(() => testApp.state.journey.paused), true);
  await page.click('#toolsClose');
  console.log('Feature browser checks passed: GPX validation/segments, manual position, editor add/drag/reorder, import/export, feedback preferences, pause/restart, saved-route/progress restoration.');
}
