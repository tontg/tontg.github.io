// XR-native controls work even when the browser has no DOM-overlay support.
export class XrControls {
  constructor(THREE, scene, session, { labels, onAction }) {
    this.THREE = THREE;
    this.scene = scene;
    this.session = session;
    this.labels = labels;
    this.onAction = onAction;
    this.canvas = document.createElement('canvas');
    this.canvas.width = 1024;
    this.canvas.height = 300;
    this.context = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.plane = new THREE.Mesh(new THREE.PlaneGeometry(1.08, 1.08 * 300 / 1024),
      new THREE.MeshBasicMaterial({ map: this.texture }));
    scene.add(this.plane);
    this.raycaster = new THREE.Raycaster();
    this.direction = new THREE.Vector3();
    this.orientation = new THREE.Quaternion();
    this.rays = new Map();
    this.reference = null;
    this.selected = (event) => {
      if (!this.reference) return;
      const hit = this.intersection(event.frame, event.inputSource);
      if (!hit) return;
      const column = Math.min(2, Math.floor(hit.uv.x * 3));
      const row = Math.min(1, Math.floor((1 - hit.uv.y) * 2));
      const action = this.labels()[row * 3 + column];
      if (action && !action.disabled) this.onAction(action.id);
      this.draw();
    };
    session.addEventListener('select', this.selected);
    this.draw();
  }

  intersection(frame, input) {
    if (!input?.targetRaySpace) return null;
    const pose = frame.getPose(input.targetRaySpace, this.reference);
    if (!pose) return null;
    const { position, orientation } = pose.transform;
    this.orientation.set(orientation.x, orientation.y, orientation.z, orientation.w);
    this.direction.set(0, 0, -1).applyQuaternion(this.orientation);
    this.raycaster.ray.origin.set(position.x, position.y, position.z);
    this.raycaster.ray.direction.copy(this.direction);
    this.plane.updateMatrixWorld(true);
    return this.raycaster.intersectObject(this.plane)[0] || null;
  }

  update(frame, reference, pose) {
    this.reference = reference;
    const { position, orientation } = pose.transform;
    this.orientation.set(orientation.x, orientation.y, orientation.z, orientation.w);
    this.plane.position.set(-0.35, -0.49, -1.6).applyQuaternion(this.orientation);
    this.plane.position.x += position.x;
    this.plane.position.y += position.y;
    this.plane.position.z += position.z;
    this.plane.quaternion.copy(this.orientation);
    const sources = new Set(this.session.inputSources || []);
    for (const [source, line] of this.rays) {
      if (!sources.has(source)) { this.scene.remove(line); line.geometry.dispose(); line.material.dispose(); this.rays.delete(source); }
    }
    for (const source of sources) {
      const hit = this.intersection(frame, source);
      let line = this.rays.get(source);
      if (!line) {
        const geometry = new this.THREE.BufferGeometry();
        geometry.setAttribute('position', new this.THREE.BufferAttribute(new Float32Array(6), 3));
        line = new this.THREE.Line(geometry, new this.THREE.LineBasicMaterial({ color: 0x4fd5ff, depthTest: false }));
        line.frustumCulled = false;
        this.scene.add(line);
        this.rays.set(source, line);
      }
      line.visible = !!hit;
      if (hit) {
        const positions = line.geometry.attributes.position;
        positions.setXYZ(0, this.raycaster.ray.origin.x, this.raycaster.ray.origin.y, this.raycaster.ray.origin.z);
        positions.setXYZ(1, hit.point.x, hit.point.y, hit.point.z);
        positions.needsUpdate = true;
      }
    }
    if (!this.lastDraw || performance.now() - this.lastDraw >= 150) {
      this.draw();
      this.lastDraw = performance.now();
    }
  }

  draw() {
    const buttons = this.labels();
    const signature = JSON.stringify(buttons);
    if (signature === this.signature) return;
    this.signature = signature;
    const ctx = this.context;
    ctx.fillStyle = '#071520';
    ctx.fillRect(0, 0, 1024, 300);
    ctx.textAlign = 'center';
    ctx.font = '28px sans-serif';
    buttons.forEach((button, index) => {
      const x = (index % 3) * 1024 / 3, y = Math.floor(index / 3) * 150;
      ctx.fillStyle = button.disabled ? '#25313a' : '#174458';
      ctx.fillRect(x + 6, y + 6, 1024 / 3 - 12, 138);
      ctx.fillStyle = button.disabled ? '#8b969e' : '#ffffff';
      const words = button.label.split(' ');
      const middle = Math.ceil(words.length / 2);
      ctx.fillText(words.slice(0, middle).join(' '), x + 1024 / 6, y + 66, 310);
      ctx.fillText(words.slice(middle).join(' '), x + 1024 / 6, y + 106, 310);
    });
    this.texture.needsUpdate = true;
  }

  detach() { this.session.removeEventListener('select', this.selected); }
}
