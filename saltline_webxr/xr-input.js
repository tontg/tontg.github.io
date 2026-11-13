/* Shared, dependency-free Touch controller mapping. Also exercised by Node tests. */
(function (scope) {
  'use strict';
  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

  function stick(gamepad, deadzone = 0.18) {
    if (!gamepad || gamepad.mapping !== 'xr-standard') return { x: 0, y: 0 };
    const x = Number.isFinite(gamepad.axes[2]) ? gamepad.axes[2] : 0;
    const y = Number.isFinite(gamepad.axes[3]) ? gamepad.axes[3] : 0;
    const length = Math.hypot(x, y);
    if (length <= deadzone) return { x: 0, y: 0 };
    const magnitude = clamp((length - deadzone) / (1 - deadzone), 0, 1);
    return { x: x / length * magnitude, y: -y / length * magnitude };
  }

  function button(gamepad, index) {
    if (!gamepad || gamepad.mapping !== 'xr-standard') return false;
    const b = gamepad.buttons[index];
    return !!b && (b.pressed || b.value > 0.55);
  }

  class TouchInput {
    constructor() { this.reset(); }
    reset() {
      this.held = new Set();
      this.edges = new Set();
      this.turnLatched = false;
      this.armed = false;
      this.move = { x: 0, y: 0 };
      this.turn = 0;
      this.fire = this.ads = this.sprint = this.crouch = false;
    }
    update(sources, dominantHand = 'right', enabled = true) {
      let gun = null, off = null;
      for (const source of sources) {
        if (source.targetRayMode !== 'tracked-pointer' || source.hand || source.gamepad?.mapping !== 'xr-standard') continue;
        if (source.handedness === dominantHand) gun = source.gamepad;
        else if (source.handedness === (dominantHand === 'right' ? 'left' : 'right')) off = source.gamepad;
      }
      const motion = stick(off), turn = stick(gun);
      const actions = new Set();
      if (button(gun, 0)) actions.add('fire');
      if (button(gun, 1)) actions.add('ads');
      if (button(gun, 4)) actions.add('jump');
      if (button(gun, 5)) actions.add('reload');
      if (button(off, 0) || button(off, 1) || button(off, 4)) actions.add('interact');
      if (button(off, 5)) actions.add('pause');
      if (button(off, 3)) actions.add('sprint');
      if (turn.y < -0.65) actions.add('crouch');
      // Session entry, focus loss, and resume require release before accepting buttons.
      if (!this.armed) {
        this.armed = actions.size === 0 && Math.abs(turn.x) < 0.25 && Math.hypot(motion.x, motion.y) < 0.1;
        actions.clear();
      }
      this.edges.clear();
      for (const action of actions) if (!this.held.has(action)) this.edges.add(action);
      this.held = actions;
      this.move.x = enabled && this.armed ? motion.x : 0;
      this.move.y = enabled && this.armed ? motion.y : 0;
      this.fire = enabled && actions.has('fire');
      this.ads = enabled && actions.has('ads');
      this.sprint = enabled && actions.has('sprint');
      this.crouch = enabled && actions.has('crouch');
      this.turn = 0;
      if (Math.abs(turn.x) < 0.25) this.turnLatched = false;
      if (enabled && this.armed && !this.turnLatched && Math.abs(turn.x) > 0.65) {
        this.turn = -Math.sign(turn.x) * Math.PI / 6;
        this.turnLatched = true;
      }
      return this;
    }
    down(action) { return this.held.has(action); }
    pressed(action) { return this.edges.has(action); }
    endFrame() { this.edges.clear(); }
  }

  const api = { TouchInput, stick, button };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else scope.SaltlineXRInput = api;
})(globalThis);
