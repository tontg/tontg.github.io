import { freshCompass, navigationPositionAvailable } from './navigation.js';
function serialize(value) {
    const seen = new WeakSet();
    return JSON.stringify(value, (_key, item) => {
        if (item instanceof Error || Object.prototype.toString.call(item) === '[object DOMException]') {
            return { name: item.name, message: item.message, stack: item.stack ?? null };
        }
        if (item?.nodeType === 1)
            return { tag: item.tagName, id: item.id };
        if (item && typeof item === 'object') {
            if (seen.has(item))
                return '[Circular]';
            seen.add(item);
        }
        return item;
    });
}
const rounded = (value) => value != null && Number.isFinite(value) ? Math.round(value * 10000) / 10000 : null;
const xyz = (value) => value ? { x: rounded(value.x), y: rounded(value.y), z: rounded(value.z) } : null;
const quaternion = (value) => value ? { ...xyz(value), w: rounded(value.w) } : null;
export function xrSnapshot(state, THREE) {
    const xr = state.xr, user = state.user, pose = xr.viewerPose;
    const describe = (object) => {
        if (!object || !THREE)
            return null;
        const position = object.getWorldPosition(new THREE.Vector3());
        const rotation = object.getWorldQuaternion(new THREE.Quaternion());
        let visible = object.visible;
        for (let parent = object.parent; parent; parent = parent.parent)
            visible &&= parent.visible;
        let relative = null;
        if (pose) {
            const head = pose.transform;
            relative = position.clone().sub(new THREE.Vector3(head.position.x, head.position.y, head.position.z))
                .applyQuaternion(new THREE.Quaternion(head.orientation.x, head.orientation.y, head.orientation.z, head.orientation.w).invert());
        }
        return { name: object.name, parent: object.parent?.name || object.parent?.type, visible,
            worldPosition: xyz(position), worldQuaternion: quaternion(rotation), viewerRelativePosition: xyz(relative) };
    };
    const hasPosition = navigationPositionAvailable(user);
    const hasNorth = xr.northOffsetDeg != null;
    const cache = Array.from(xr.mapTileCache.values());
    const session = xr.session;
    const nextId = state.journey.sequence[state.journey.activeStepIndex] ?? null;
    return {
        browser: { userAgent: navigator.userAgent, secureContext: window.isSecureContext, visibility: document.visibilityState },
        session: session ? { visibility: session.visibilityState, environmentBlendMode: session.environmentBlendMode,
            interactionMode: session.interactionMode, frameRate: session.frameRate,
            enabledFeatures: session.enabledFeatures ? Array.from(session.enabledFeatures) : null,
            domOverlayActive: xr.domOverlayActive, referenceSpace: 'local', referenceSpaceClass: xr.reference?.constructor?.name,
            depthNear: session.renderState?.depthNear, depthFar: session.renderState?.depthFar,
            layers: Array.from(session.renderState?.layers || []).map((layer) => layer.constructor?.name),
            inputs: Array.from(session.inputSources || []).map((source) => ({ handedness: source.handedness,
                targetRayMode: source.targetRayMode, profiles: Array.from(source.profiles || []), handTracking: !!source.hand })) } : null,
        tracking: { hasPose: !!pose, emulatedPosition: pose?.emulatedPosition ?? null,
            position: xyz(pose?.transform.position), orientation: quaternion(pose?.transform.orientation),
            yawDeg: rounded(xr.viewerYawDeg),
            views: Array.from(pose?.views || []).map((view) => ({ eye: view.eye, position: xyz(view.transform.position),
                orientation: quaternion(view.transform.orientation), projectionMatrix: Array.from(view.projectionMatrix || []).map(rounded) })) },
        navigation: { hasPosition, source: user.locationSource, latitude: user.latitude, longitude: user.longitude,
            accuracyMeters: user.accuracyMeters, positionAgeMs: user.lastPositionTs ? Math.max(0, Date.now() - user.lastPositionTs) : null,
            compassAllowed: state.capabilities.orientationForArrows, compassFresh: freshCompass(user),
            compassHeadingDeg: user.hasHeading ? rounded(user.headingDeg) : null, compassSource: user.headingSource,
            compassAgeMs: user.lastHeadingTs ? Math.max(0, Date.now() - user.lastHeadingTs) : null,
            northOffsetDeg: rounded(xr.northOffsetDeg), northSource: xr.northSource ?? null,
            calibrationArmed: !!state.tools?.calibration.armed, paused: !!state.journey.paused,
            nextId, activeStep: state.journey.activeStepIndex, steps: state.journey.sequence.length,
            hiddenReasons: [!hasPosition && 'no-valid-position', !hasNorth && 'north-not-aligned',
                state.journey.paused && 'journey-paused'].filter(Boolean) },
        anchors: { panelsInitialized: xr.anchors?.initialized ?? false, panels: describe(xr.anchors?.panels),
            targetOrigin: xr.anchors?.origin ? { ...xr.anchors.origin, position: xyz(xr.anchors.origin.position) } : null },
        objects: { hud: describe(xr.hudPlane), map: describe(xr.mapPlane), toolbar: describe(xr.controls?.plane),
            blueWaitingMarker: describe(xr.waitingMesh), yellowWaistCompass: describe(xr.closestArrowMesh),
            blueTargetCount: xr.arrowMeshes.size,
            blueTargets: Array.from(xr.arrowMeshes).slice(0, 5).map(([id, mesh]) => ({ id, ...describe(mesh) })) },
        rendering: { threeRevision: THREE?.REVISION ?? null, canvas: xr.renderer ? {
                width: xr.renderer.domElement.width, height: xr.renderer.domElement.height,
                contextLost: xr.renderer.getContext().isContextLost(), attributes: xr.renderer.getContext().getContextAttributes()
            } : null, drawCalls: xr.renderer?.info.render.calls ?? null,
            geometries: xr.renderer?.info.memory.geometries ?? null, textures: xr.renderer?.info.memory.textures ?? null,
            mapTextureVersion: xr.mapTexture?.version ?? null, hudTextureVersion: xr.hudTexture?.version ?? null,
            tiles: { total: cache.length, ready: cache.filter((entry) => entry.status === 'ready').length,
                failed: cache.filter((entry) => entry.status === 'error').length } }
    };
}
// Immutable JSON records are easier to copy from remote DevTools than live objects.
export class XrDebug {
    constructor(version, snapshot, { output = console, intervalMs = 2000, limit = 120 } = {}) {
        this.version = version;
        this.readSnapshot = snapshot;
        this.output = output;
        this.intervalMs = intervalMs;
        this.limit = limit;
        this.enabled = true;
        this.records = [];
        this.frames = 0;
        this.lastSample = null;
        this.sampleFrames = 0;
    }
    log(level, event, data = null) {
        if (!this.enabled && level !== 'error')
            return;
        const record = serialize({ version: this.version, time: new Date().toISOString(), level, event, data });
        this.records.push(JSON.parse(record));
        if (this.records.length > this.limit)
            this.records.shift();
        (this.output[level] || this.output.log).call(this.output, `[XR] ${event} ${record}`);
    }
    beginSession() {
        this.frames = this.sampleFrames = 0;
        this.lastSample = null;
    }
    frame(time) {
        this.frames++;
        if (!this.enabled || (this.lastSample != null && time - this.lastSample < this.intervalMs))
            return;
        const elapsed = this.lastSample == null ? null : time - this.lastSample;
        try {
            this.snapshot({ frames: this.frames, sampledFps: elapsed ? Math.round((this.frames - this.sampleFrames) * 1000 / elapsed) : null });
        }
        catch (error) {
            // Diagnostics must not stop the XR render loop if a browser getter fails.
            this.log('error', 'Could not collect XR snapshot', error);
        }
        this.lastSample = time;
        this.sampleFrames = this.frames;
    }
    snapshot(extra = {}) {
        const snapshot = { ...this.readSnapshot(), ...extra };
        this.log('info', 'Snapshot', snapshot);
        return JSON.parse(serialize(snapshot));
    }
    dump(count = this.limit) {
        const size = Number.isFinite(count) ? Math.max(1, Math.min(this.limit, Math.floor(count))) : this.limit;
        return JSON.stringify({ version: this.version, records: this.records.slice(-size) }, null, 2);
    }
    setInterval(milliseconds) {
        if (!Number.isFinite(milliseconds) || milliseconds < 250 || milliseconds > 60000) {
            throw new RangeError('XR debug interval must be between 250 and 60000 ms.');
        }
        this.intervalMs = milliseconds;
    }
}
//# sourceMappingURL=xr-debug.js.map