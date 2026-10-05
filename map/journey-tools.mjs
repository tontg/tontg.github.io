import { validCoordinates, freshPosition, freshCompass, restartJourney, confirmManualArrival } from './navigation.mjs';
import { createJourneyStore, routeDocument } from './journey-store.mjs';
import { ArrivalFeedback } from './feedback.mjs';
import { RouteEditor } from './route-editor.mjs';

const byId = (id) => document.getElementById(id);
export class JourneyTools {
  constructor(state, t, callbacks) {
    this.state = state;
    this.t = t;
    this.callbacks = callbacks;
    let storage;
    try { storage = localStorage; } catch { storage = { getItem() { throw new Error('Storage unavailable'); } }; }
    this.store = createJourneyStore(storage, new URL('.', location.href).pathname);
    this.feedback = new ArrivalFeedback(this.store.loadPreferences());
    this.positionMode = 'gps';
    this.latestGps = null;
    this.notice = null;
    this.message = null;
    this.defaultRoute = null;
    this.restored = false;
    this.pickingPosition = false;
    this.calibration = { armed: false, deadline: null, bearing: 0 };
    this.confirmAction = null;
    this.editor = new RouteEditor({ t, getRoute: () => routeDocument(state.targets, state.journey),
      onApply: (data) => this.applyRoute(data) });
    this.bind();
  }

  bind() {
    byId('toolsButton').onclick = () => { this.render(); byId('toolsDialog').showModal(); };
    byId('toolsClose').onclick = () => byId('toolsDialog').close();
    byId('journeyPause').onclick = () => this.togglePause();
    byId('journeyRestart').onclick = () => { if (confirm(this.t('journey.confirmRestart'))) this.restart(); };
    byId('manualArrival').onclick = () => { if (confirm(this.t('journey.confirmManualArrival'))) this.manualArrival(); };
    byId('editorOpen').onclick = () => { byId('toolsDialog').close(); this.editor.open(); };
    byId('defaultRoute').onclick = () => {
      if (!confirm(this.t('editor.confirmDefault'))) return;
      this.applyRoute(this.defaultRoute, true);
    };
    byId('manualWaypoint').onchange = (event) => {
      const point = this.state.targetsById.get(event.target.value);
      if (point) this.fillPosition(point.latitude, point.longitude);
    };
    byId('manualPositionForm').onsubmit = (event) => {
      event.preventDefault();
      this.setManualPosition(Number(byId('manualLatitude').value), Number(byId('manualLongitude').value));
    };
    byId('pickPosition').onclick = () => {
      this.pickingPosition = true;
      byId('mapContainer').classList.add('picking');
      byId('toolsDialog').close();
      this.callbacks.status('position.pickHelp');
    };
    byId('useGps').onclick = () => this.useGps();
    byId('calibrateNorth').onclick = () => {
      const input = byId('calibrationBearing');
      if (!input.reportValidity() || input.value === '') return;
      this.armCalibration(Number(input.value));
    };
    for (const [id, key] of [['soundEnabled', 'sound'], ['hapticsEnabled', 'haptics']]) {
      byId(id).checked = this.feedback.preferences[key];
      byId(id).onchange = () => {
        this.feedback.preferences[key] = byId(id).checked;
        this.store.savePreferences(this.feedback.preferences);
        void this.feedback.unlock().then(() => this.render());
      };
    }
    byId('testFeedback').onclick = () => {
      void this.feedback.unlock().then(() => this.feedback.play(false, this.state.xr.session))
        .catch(() => { this.feedback.lastResult = 'feedback.unavailable'; }).finally(() => this.render());
    };
  }

  routeChanged() {
    byId('manualWaypoint').replaceChildren(new Option(this.t('position.choose'), ''),
      ...this.state.targets.map((point) => new Option(point.id, point.id)));
    this.render();
  }

  applyRoute(data, configured = false) {
    this.callbacks.replaceRoute(data);
    this.state.journey.paused = true;
    if (configured) this.store.clearRoute();
    else this.store.saveRoute(data);
    this.restored = false;
    this.notice = null;
    this.save();
    this.message = { key: 'editor.applied' };
    this.routeChanged();
    this.callbacks.render();
  }

  save() { this.store.saveProgress(this.state.targets, this.state.journey); }

  togglePause() {
    const journey = this.state.journey;
    if (!journey.sequence.length || journey.activeStepIndex >= journey.sequence.length) return;
    journey.paused = !journey.paused;
    this.restored = false;
    this.save();
    void this.feedback.unlock();
    this.render();
    this.callbacks.render();
  }

  restart() {
    restartJourney(this.state.journey);
    this.restored = false;
    this.notice = null;
    this.save();
    this.render();
    this.callbacks.render();
  }

  arrived(id) {
    this.notice = { id, completed: this.state.journey.activeStepIndex >= this.state.journey.sequence.length, until: Date.now() + 6000 };
    this.save();
    void this.feedback.play(this.notice.completed, this.state.xr.session).catch(() => { this.feedback.lastResult = 'feedback.unavailable'; });
    this.render();
  }

  manualArrival() {
    const id = this.state.journey.sequence[this.state.journey.activeStepIndex];
    if (!confirmManualArrival(this.state.journey, this.state.targetsById, this.state.user)) return;
    this.callbacks.positionChanged();
    this.arrived(id);
  }

  fillPosition(latitude, longitude) {
    byId('manualLatitude').value = latitude.toFixed(7);
    byId('manualLongitude').value = longitude.toFixed(7);
  }

  pickedPosition(latitude, longitude) {
    if (!this.pickingPosition) return;
    this.pickingPosition = false;
    byId('mapContainer').classList.remove('picking');
    this.fillPosition(latitude, ((longitude + 180) % 360 + 360) % 360 - 180);
    this.message = { key: 'position.confirmPicked' };
    this.render();
    byId('toolsDialog').showModal();
  }

  setManualPosition(latitude, longitude) {
    if (!validCoordinates(latitude, longitude)) return false;
    this.positionMode = 'manual';
    Object.assign(this.state.user, { latitude, longitude, locationSource: 'manual', accuracyMeters: null, lastPositionTs: Date.now() });
    this.message = { key: 'position.manualActive' };
    this.callbacks.positionChanged();
    this.render();
    return true;
  }

  useGps() {
    this.positionMode = 'gps';
    const latest = this.latestGps;
    this.latestGps = null;
    Object.assign(this.state.user, { latitude: null, longitude: null, locationSource: 'none', lastPositionTs: 0, accuracyMeters: null });
    if (latest && Date.now() - latest.timestamp <= 20000) this.callbacks.applyGps(latest);
    this.callbacks.positionChanged();
    void this.callbacks.enableGps().catch(() => {}).finally(() => this.render());
    this.message = { key: 'position.gpsRequested' };
    this.render();
  }

  armCalibration(bearing = this.calibration.bearing) {
    this.calibration = { bearing, armed: true, deadline: null };
    this.message = { key: this.state.xr.session ? 'calibration.faceNow' : 'calibration.queued', values: { bearing } };
    this.render();
  }

  updateCalibration(yaw, now) {
    if (!this.calibration.armed) return;
    if (yaw == null) { this.calibration.deadline = null; return; }
    this.calibration.deadline ??= now + 3000;
    if (now < this.calibration.deadline) return;
    this.state.xr.northOffsetDeg = ((this.calibration.bearing - yaw) % 360 + 360) % 360;
    this.state.xr.northSource = 'manual';
    this.calibration.armed = false;
    this.calibration.deadline = null;
    this.message = { key: 'calibration.aligned', values: { bearing: this.calibration.bearing } };
    this.render();
  }

  resetCalibration() {
    this.state.xr.northOffsetDeg = null;
    this.state.xr.northSource = null;
    this.calibration.armed = false;
    this.calibration.deadline = null;
  }

  xrLabels() {
    const { journey, user } = this.state;
    const complete = !journey.sequence.length || journey.activeStepIndex >= journey.sequence.length;
    const confirming = this.confirmAction && performance.now() < this.confirmAction.until ? this.confirmAction.id : null;
    return [
      { id: 'pause', label: this.t(journey.paused ? 'journey.resume' : 'journey.pause'), disabled: complete },
      { id: 'restart', label: this.t(confirming === 'restart' ? 'journey.confirmButton' : 'journey.restart'), disabled: !journey.sequence.length },
      { id: 'arrival', label: this.t(confirming === 'arrival' ? 'journey.confirmButton' : 'journey.confirmArrival'), disabled: journey.paused || complete || user.locationSource !== 'manual' },
      { id: 'north', label: this.t(this.calibration.armed ? 'calibration.cancel' : 'calibration.start') },
      { id: 'sound', label: this.t(this.feedback.preferences.sound ? 'feedback.soundOn' : 'feedback.soundOff') },
      { id: 'haptics', label: this.t(this.feedback.preferences.haptics ? 'feedback.hapticsOn' : 'feedback.hapticsOff') }
    ];
  }

  xrAction(id) {
    if (this.xrLabels().find((item) => item.id === id)?.disabled) return;
    void this.feedback.unlock();
    if (id === 'pause') this.togglePause();
    else if (id === 'north') {
      if (this.calibration.armed) { this.calibration.armed = false; this.calibration.deadline = null; }
      else this.armCalibration();
    } else if (id === 'restart' || id === 'arrival') {
      if (this.confirmAction?.id === id && performance.now() < this.confirmAction.until) {
        this.confirmAction = null;
        if (id === 'restart') this.restart(); else this.manualArrival();
      } else this.confirmAction = { id, until: performance.now() + 5000 };
    } else if (id === 'sound' || id === 'haptics') {
      this.feedback.preferences[id] = !this.feedback.preferences[id];
      this.store.savePreferences(this.feedback.preferences);
      void this.feedback.unlock();
    }
    this.render();
  }

  diagnostics() {
    const user = this.state.user, now = Date.now();
    const age = user.lastPositionTs ? Math.max(0, Math.floor((now - user.lastPositionTs) / 1000)) : '--';
    const accuracy = Number.isFinite(user.accuracyMeters) ? Math.round(user.accuracyMeters) : '--';
    const source = user.locationSource === 'manual' ? 'diagnostics.manual' : freshPosition(user) ? 'diagnostics.gps' : 'diagnostics.noGps';
    const heading = freshCompass(user) ? this.t('diagnostics.compassValue', { heading: Math.round(user.headingDeg),
      age: Math.floor((now - user.lastHeadingTs) / 1000) }) : this.t(this.state.capabilities.orientationForArrows ? 'diagnostics.compassWaiting' : 'diagnostics.compassUnavailable');
    const north = this.t(this.state.xr.northOffsetDeg == null ? 'diagnostics.northUnknown' :
      this.state.xr.northSource === 'manual' ? 'diagnostics.northManual' : 'diagnostics.northCompass');
    return { source: this.t(source), age, accuracy, heading, north };
  }

  xrDiagnosticText() {
    const data = this.diagnostics();
    return this.t('diagnostics.compact', data);
  }

  xrStatusText() {
    if (this.calibration.armed) return this.t('calibration.countdown', { bearing: this.calibration.bearing,
      seconds: Math.max(0, Math.ceil(((this.calibration.deadline ?? performance.now() + 3000) - performance.now()) / 1000)) });
    if (this.notice && Date.now() < this.notice.until) return this.t(this.notice.completed ? 'arrival.complete' : 'arrival.step', this.notice);
    if (!this.state.journey.sequence.length) return this.t('journey.notConfigured');
    if (this.state.journey.activeStepIndex >= this.state.journey.sequence.length) return this.t('distance.journeyComplete');
    return this.t(this.state.journey.paused ? 'journey.paused' : 'journey.running');
  }

  render() {
    const { journey } = this.state;
    document.querySelectorAll('[data-i18n]').forEach((node) => {
      const text = this.t(node.dataset.i18n);
      if (node.textContent !== text) node.textContent = text;
    });
    const complete = journey.activeStepIndex >= journey.sequence.length;
    byId('toolsButton').disabled = !!this.state.xr.session || !this.defaultRoute;
    byId('journeyPause').disabled = !journey.sequence.length || complete;
    byId('journeyPause').textContent = this.t(journey.paused ? 'journey.resume' : 'journey.pause');
    byId('journeyState').textContent = this.t(!journey.sequence.length ? 'journey.notConfigured' : complete ? 'distance.journeyComplete' : this.restored ? 'journey.restored' : journey.paused ? 'journey.paused' : 'journey.running');
    byId('manualArrival').disabled = journey.paused || complete || this.state.user.locationSource !== 'manual';
    byId('journeyRestart').disabled = !journey.sequence.length;
    byId('saveStatus').textContent = this.store.available ? '' : this.t('storage.unavailable');
    byId('soundEnabled').checked = this.feedback.preferences.sound;
    byId('hapticsEnabled').checked = this.feedback.preferences.haptics;
    byId('arrivalNotice').textContent = this.notice && Date.now() < this.notice.until ? this.t(this.notice.completed ? 'arrival.complete' : 'arrival.step', this.notice) : '';
    if (this.message) byId('toolsMessage').textContent = this.t(this.message.key, this.message.values);
    const data = this.diagnostics();
    byId('sensorLocation').textContent = this.t('diagnostics.position', data);
    byId('sensorCompass').textContent = data.heading;
    byId('sensorXr').textContent = data.north;
    byId('sensorFeedback').textContent = this.t(this.feedback.lastResult);
    byId('editorMap').setAttribute('aria-label', this.t('editor.mapLabel'));
    byId('editorImportChoice').setAttribute('aria-label', this.t('editor.importChoice'));
  }
}
