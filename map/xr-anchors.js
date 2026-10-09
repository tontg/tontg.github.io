// Environment panels and geographic markers must not inherit the live head pose.
export class XrAnchors {
    constructor(THREE, scene) {
        this.THREE = THREE;
        this.panels = new THREE.Group();
        this.panels.name = 'environment-panels';
        this.panels.visible = false;
        scene.add(this.panels);
        this.initialized = false;
        this.origin = null;
        this.revision = 0;
    }
    initialize(pose, yawDegrees) {
        if (this.initialized || yawDegrees == null)
            return false;
        const { position } = pose.transform;
        this.panels.position.set(position.x, position.y, position.z);
        // Use initial yaw only: looking up/down must not tilt the panels.
        this.panels.rotation.set(0, -yawDegrees * Math.PI / 180, 0);
        this.panels.visible = this.initialized = true;
        return true;
    }
    targetOrigin(pose, user) {
        if (!this.origin) {
            const { position } = pose.transform;
            this.origin = {
                position: new this.THREE.Vector3(position.x, position.y, position.z),
                latitude: user.latitude, longitude: user.longitude, source: user.locationSource
            };
            this.revision++;
        }
        return this.origin;
    }
    invalidateTargets() {
        this.origin = null;
        this.revision++;
    }
    recenterPanels() {
        this.initialized = this.panels.visible = false;
    }
    reset(transform) {
        const matrix = transform?.matrix;
        if (!matrix || matrix.length !== 16 || !Array.from(matrix).every(Number.isFinite)) {
            this.recenterPanels();
            this.invalidateTargets();
            return false;
        }
        // WebXR describes the new origin in old coordinates; use its inverse.
        const inverse = new this.THREE.Matrix4().fromArray(matrix).invert();
        this.panels.updateMatrix();
        this.panels.applyMatrix4(inverse);
        this.origin?.position.applyMatrix4(inverse);
        return true;
    }
}
//# sourceMappingURL=xr-anchors.js.map