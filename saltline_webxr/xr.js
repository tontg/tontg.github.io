/* Saltline WebXR adapter. No runtime downloads, build step, or server API. */
(function () {
  'use strict';
  const PROFILES = {
    balanced: { scale: 0.85, foveation: 0.7, hz: 72, rain: 0.25 },
    sharp: { scale: 1, foveation: 0.5, hz: 72, rain: 0.35 },
    performance: { scale: 0.7, foveation: 1, hz: 72, rain: 0.12 }
  };

  function attach(g) {
    if (g.showcase || !g.player || !g.weapon.root) return;
    const T = g.THREE, renderer = g.renderer, input = g.input;
    const controls = new SaltlineXRInput.TouchInput();
    const rig = new T.Group();
    rig.name = 'XR locomotion rig';
    const trackedCamera = new T.PerspectiveCamera(74, 1, 0.06, 180);
    // Keep the original camera as a world-space proxy for audio, AI, rain and FX.
    // Only this camera receives WebXR poses; desktop systems never own its transform.
    rig.add(trackedCamera);
    rig.visible = false;
    g.scene.add(rig);
    const head = new T.Vector3(0, 1.65, 0), lastHead = new T.Vector3();
    const headRotation = new T.Quaternion(), worldRotation = new T.Quaternion();
    const physicalDelta = new T.Vector3(), offset = new T.Vector3();
    const direction = new T.Vector3(), muzzle = new T.Vector3(), toMuzzle = new T.Vector3();
    const up = new T.Vector3(0, 1, 0), weapon = g.weapon.root;
    const hands = [], labels = [];
    const xr = g.xr = {
      active: false, focused: false, poseValid: false, session: null,
      rig, camera: trackedCamera, controls, dominantHand: 'right',
      beforeFrame, afterFrame, updatePlayerCamera, render, aim,
      stats: () => ({ active: xr.active, profile: profileName, targetHz: profile.hz,
        frameRate: xr.session?.frameRate || null, foveation, framebufferScale: profile.scale,
        calls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
        frameMs: +(frameMs || 0).toFixed(2), tracking: xr.poseValid }),
      end: () => xr.session?.end()
    };
    let yaw = 0, trackingBaseline = false, headingBaseline = false, seatedLift = 0, crouchDrop = 0;
    let gameplayEnabled = false, pending = false, snapshot = null;
    let profileName = 'balanced', profile = PROFILES.balanced, foveation = profile.foveation;
    let frameMs = 0, qualityTime = 0, slowFrames = 0, hudTime = 0, aimTime = 0;
    let startedAt = 0, flashUntil = 0, status = '', message = '', messageUntil = 0;
    let prompt = '', promptProgress = 0;
    let previousState = '', previousPlayerPos = new T.Vector3();
    const panel = createLauncher();
    const canvas = document.createElement('canvas');
    canvas.width = 1024; canvas.height = 384;
    const ctx = canvas.getContext('2d');
    const texture = new T.CanvasTexture(canvas);
    texture.colorSpace = T.SRGBColorSpace;
    texture.minFilter = T.LinearFilter;
    texture.generateMipmaps = false;
    const hud = new T.Mesh(new T.PlaneGeometry(1.05, 0.394),
      new T.MeshBasicMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false, toneMapped: false }));
    hud.name = 'XR status and radio'; hud.renderOrder = 1000; hud.frustumCulled = false;
    hud.visible = false;
    g.scene.add(hud);
    const reticle = new T.Mesh(new T.SphereGeometry(1, 8, 6),
      new T.MeshBasicMaterial({ color: 0xffc977, toneMapped: false }));
    reticle.name = 'XR weapon aim'; reticle.visible = false;
    g.scene.add(reticle);

    renderer.xr.enabled = true;
    renderer.xr.setReferenceSpaceType('local-floor');
    renderer.xr.addEventListener('sessionend', () => { if (!xr.active) g.render.resize(); });
    for (let index = 0; index < 2; index++) {
      const ray = renderer.xr.getController(index), grip = renderer.xr.getControllerGrip(index);
      rig.add(ray, grip);
      const body = new T.Mesh(new T.CylinderGeometry(0.022, 0.027, 0.11, 8),
        new T.MeshStandardMaterial({ color: 0x7a858b, roughness: 0.9 }));
      body.rotation.x = -0.3; body.position.y = -0.035;
      grip.add(body);
      const hand = { ray, grip, body, source: null };
      hands.push(hand);
      ray.addEventListener('connected', event => { hand.source = event.data; controls.reset(); mountWeapon(); });
      ray.addEventListener('disconnected', () => {
        hand.source = null; controls.reset(); reticle.visible = false;
        if (weapon.parent === ray) rig.attach(weapon);
      });
    }

    const base = {};
    for (const key of ['update', 'endFrame', 'down', 'pressed', 'requestLock', 'describeMode', 'setGameplay']) base[key] = input[key]?.bind(input);
    input.update = dt => {
      if (!xr.active) return base.update(dt);
      input.look.dx = input.look.dy = 0;
      input.mode = 'xr'; input.locked = false;
      controls.update(xr.focused && xr.poseValid ? xr.session.inputSources : [], xr.dominantHand, gameplayEnabled && xr.focused && xr.poseValid);
      if (controls.turn) { yaw += controls.turn; updatePlayerCamera(); }
      input.move.x = controls.move.x; input.move.y = controls.move.y;
      const gun = gunHand();
      const tracked = !!gun?.ray.visible && xr.focused && xr.poseValid;
      input.fire = controls.fire && tracked;
      input.ads = controls.ads && tracked;
      input.sprint = controls.sprint;
      input.crouch = controls.crouch || (gameplayEnabled && head.y + seatedLift < 1.25);
      if (g.game.state === 'paused' && controls.pressed('reload')) { void xr.end(); return; }
      if (controls.pressed('fire') && xr.focused && xr.poseValid && ['paused', 'dead', 'complete'].includes(g.game.state)) {
        if (g.game.state === 'paused') g.game.resume();
        else { g.game.start({ skipIntro: true }); resetTracking(); }
        controls.reset(); input.fire = false;
      }
    };
    input.endFrame = () => xr.active ? controls.endFrame() : base.endFrame();
    input.down = action => xr.active ? (xr.focused && (gameplayEnabled || action === 'pause') && controls.down(action)) : base.down(action);
    input.pressed = action => xr.active ? (xr.focused && (gameplayEnabled || action === 'pause') && controls.pressed(action)) : base.pressed(action);
    input.requestLock = () => { if (!xr.active) return base.requestLock(); };
    input.describeMode = () => xr.active ? 'Touch controllers active' : base.describeMode();
    input.setGameplay = enabled => { gameplayEnabled = !!enabled; base.setGameplay(enabled); if (xr.active) controls.reset(); };

    // The visible feedback is shared with the game; no HTML overlay is required in VR.
    for (const [key, capture] of [
      ['setObjective', text => { status = text || ''; }],
      ['setPrompt', (text, progress = 0) => { prompt = text || ''; promptProgress = progress; }],
      ['message', (text, duration = 3) => { message = text || ''; messageUntil = performance.now() + duration * 1000; }],
      ['radio', (text, duration = 5) => { message = typeof text === 'string' ? text : text?.text || ''; messageUntil = performance.now() + duration * 1000; }]
    ]) {
      const original = g.hud[key]?.bind(g.hud);
      if (original) g.hud[key] = (...args) => { capture(...args); return original(...args); };
    }
    g.events.on('weapon:fire', () => pulse(xr.dominantHand, 0.28, 28));
    g.events.on('player:hitEnemy', event => { flashUntil = performance.now() + 130; pulse(xr.dominantHand, event.killed ? 0.65 : 0.4, 45); });
    g.events.on('player:hit', () => { pulse('left', 0.6, 100); pulse('right', 0.6, 100); });
    g.events.on('weapon:reload', event => { if (event.phase === 'done') pulse(xr.dominantHand, 0.4, 65); });
    g.events.on('objective:done', () => { pulse('left', 0.6, 140); pulse('right', 0.6, 140); });
    g.events.on('game:state', () => {
      if (!xr.active) return;
      controls.reset(); input.fire = input.ads = false;
      if (g.game.state === 'playing') resetTracking();
    });
    document.addEventListener('visibilitychange', () => {
      if (xr.active && document.hidden) loseFocus();
    });
    navigator.xr?.addEventListener('devicechange', detect);
    void detect();

    function createLauncher() {
      const box = document.createElement('section');
      box.id = 'xr-launcher'; box.setAttribute('aria-label', 'Virtual reality');
      box.innerHTML = '<button id="xr-enter" type="button" disabled>Checking VR support…</button>' +
        '<p id="xr-status" role="status">WebXR · Meta Quest 3 / Touch Plus</p>' +
        '<details><summary>VR controls & comfort</summary>' +
        '<label>Rendering <select id="xr-profile"><option value="balanced">Balanced</option><option value="sharp">Sharp</option><option value="performance">Performance</option></select></label>' +
        '<label><input id="xr-left" type="checkbox"> Left-handed weapon (swaps sticks and actions)</label>' +
        '<label><input id="xr-seated" type="checkbox"> Seated height assist</label>' +
        '<small>Off hand: stick moves, stick click sprints, trigger / grip / primary face button holds USE, secondary face button pauses.</small>' +
        '<small>Weapon hand: trigger fires, grip steadies aim, stick turns 30° (release to turn again), stick down crouches, primary face button jumps, secondary reloads.</small>' +
        '<small>Right-handed: A jump · B reload · X use · Y pause. While paused: trigger resumes, B exits VR. Trigger retries after death or extraction.</small>' +
        '<small>Movement follows your head. You can also walk and crouch physically within your boundary. Seated assist raises your view to standing height.</small></details>';
      document.getElementById('app').appendChild(box);
      box.querySelector('button').addEventListener('click', enter);
      return box;
    }

    async function detect() {
      const button = panel.querySelector('button');
      if (!window.isSecureContext) {
        button.textContent = 'VR requires HTTPS';
        panel.querySelector('#xr-status').textContent = 'Use HTTPS (GitHub Pages works), or localhost for development.';
        return;
      }
      if (!navigator.xr) {
        button.textContent = 'VR unavailable in this browser';
        panel.querySelector('#xr-status').textContent = 'Open this page in Meta Quest Browser to enter VR. Desktop play is available.';
        return;
      }
      try {
        const supported = await navigator.xr.isSessionSupported('immersive-vr');
        button.disabled = !supported;
        button.textContent = supported ? 'ENTER VR' : 'No VR headset detected';
      } catch {
        button.textContent = 'VR access unavailable';
        panel.querySelector('#xr-status').textContent = 'Open the page directly and allow immersive VR access in your browser.';
      }
    }

    async function enter() {
      if (pending || xr.active) return;
      pending = true;
      const button = panel.querySelector('button');
      button.disabled = true;
      profileName = panel.querySelector('#xr-profile').value;
      profile = PROFILES[profileName]; foveation = profile.foveation;
      xr.dominantHand = panel.querySelector('#xr-left').checked ? 'left' : 'right';
      renderer.xr.setFramebufferScaleFactor(profile.scale);
      renderer.xr.setFoveation(foveation);
      // requestSession is invoked directly inside the user gesture.
      try {
        const session = await navigator.xr.requestSession('immersive-vr', {
          requiredFeatures: ['local-floor'], optionalFeatures: ['bounded-floor', 'layers']
        });
        xr.session = session;
        session.addEventListener('end', cleanup, { once: true });
        session.addEventListener('visibilitychange', () => {
          xr.focused = session.visibilityState === 'visible';
          if (!xr.focused) loseFocus(); else resetTracking();
        });
        saveAndOptimize();
        xr.active = true; xr.focused = session.visibilityState === 'visible';
        document.documentElement.classList.add('in-xr');
        input.exitLock();
        input.mode = 'xr';
        if (g.game.state === 'playing') gameplayEnabled = true;
        else if (g.game.state === 'paused') g.game.resume();
        else g.game.start({ skipIntro: true });
        yaw = g.player.yaw;
        rig.visible = hud.visible = true;
        startedAt = performance.now();
        frameMs = qualityTime = slowFrames = hudTime = 0;
        seatedLift = crouchDrop = 0;
        resetTracking(); mountWeapon();
        await renderer.xr.setSession(session);
        renderer.xr.getReferenceSpace()?.addEventListener('reset', resetTracking);
        if (session.supportedFrameRates && session.updateTargetFrameRate) {
          const rates = Array.from(session.supportedFrameRates);
          if (rates.includes(profile.hz)) await session.updateTargetFrameRate(profile.hz).catch(() => {});
        }
        g.audio.resume?.();
      } catch (error) {
        if (xr.session) { try { await xr.session.end(); } catch {} }
        cleanup();
        panel.querySelector('#xr-status').textContent = 'Could not enter VR: ' + error.message + '. Try again or continue on desktop.';
      } finally { pending = false; button.disabled = false; }
    }

    function saveAndOptimize() {
      snapshot = {
        shadows: renderer.shadowMap.enabled, toneMapping: renderer.toneMapping, exposure: renderer.toneMappingExposure,
        parent: weapon.parent, position: weapon.position.clone(), quaternion: weapon.quaternion.clone(), visible: weapon.visible,
        mode: input.mode, rain: g.ground.rainLevel, reflections: g.ground.planar?.enabled,
        layers: [], lights: [], textures: [], hands: [], quality: { ...g.quality }
      };
      for (const hand of g.weapon.desktopHands || []) { snapshot.hands.push([hand, hand.visible]); hand.visible = false; }
      weapon.traverse(object => { snapshot.layers.push([object, object.layers.mask]); object.layers.set(0); });
      renderer.shadowMap.enabled = false;
      renderer.toneMapping = T.ACESFilmicToneMapping;
      // Fixed material light counts, but no per-fragment work from temporary lights.
      g.scene.traverse(object => {
        if (object.isPointLight || object.isSpotLight) { snapshot.lights.push([object, object.visible]); object.visible = false; }
        const materials = object.material ? (Array.isArray(object.material) ? object.material : [object.material]) : [];
        for (const material of materials) for (const value of Object.values(material)) {
          if (value?.isTexture && value.anisotropy > 2 && !snapshot.textures.some(item => item[0] === value)) {
            snapshot.textures.push([value, value.anisotropy]); value.anisotropy = 2; value.needsUpdate = true;
          }
        }
      });
      g.ground.setReflections?.(false);
      if (g.ground.uniforms?.uReflOn) g.ground.uniforms.uReflOn.value = 0;
      g.ground.setRain?.(profile.rain);
      g.quality.planar = 0;
      g.quality.motionBlur = false;
      const originalStats = g.render.stats.bind(g.render);
      snapshot.stats = originalStats;
      g.render.stats = () => xr.active ? { ...originalStats(), calls: renderer.info.render.calls, tris: renderer.info.render.triangles, advanced: false, xr: xr.stats() } : originalStats();
    }

    function cleanup() {
      if (!snapshot && !xr.active) { xr.session = null; return; }
      const wasActive = xr.active;
      if (wasActive) g.game.pause();
      xr.active = xr.focused = xr.poseValid = false;
      controls.reset();
      input.fire = input.ads = input.sprint = input.crouch = false;
      input.move.x = input.move.y = input.look.dx = input.look.dy = 0;
      rig.visible = hud.visible = reticle.visible = false;
      for (const label of labels) label.mesh.visible = false;
      document.documentElement.classList.remove('in-xr');
      if (snapshot) {
        snapshot.parent.add(weapon);
        weapon.position.copy(snapshot.position); weapon.quaternion.copy(snapshot.quaternion);
        weapon.visible = snapshot.visible;
        for (const [hand, visible] of snapshot.hands) hand.visible = visible;
        for (const [object, mask] of snapshot.layers) object.layers.mask = mask;
        for (const [light, visible] of snapshot.lights) light.visible = visible;
        for (const [texture, anisotropy] of snapshot.textures) { texture.anisotropy = anisotropy; texture.needsUpdate = true; }
        renderer.shadowMap.enabled = snapshot.shadows;
        renderer.shadowMap.needsUpdate = true;
        renderer.toneMapping = snapshot.toneMapping;
        renderer.toneMappingExposure = snapshot.exposure;
        g.ground.setRain?.(snapshot.rain);
        g.ground.setReflections?.(snapshot.reflections);
        Object.assign(g.quality, snapshot.quality);
        g.render.stats = snapshot.stats;
        input.mode = snapshot.mode;
        snapshot = null;
      }
      xr.session = null;
      resetTracking();
      g.render.resize();
      panel.querySelector('button').textContent = 'ENTER VR';
      panel.querySelector('#xr-status').textContent = 'VR ended. Desktop play is paused; resume from the menu.';
    }

    function loseFocus() {
      xr.focused = false; xr.poseValid = false;
      controls.reset(); input.fire = input.ads = false;
      if (g.game.state === 'playing') g.game.pause();
      resetTracking();
    }
    function resetTracking() {
      trackingBaseline = false; headingBaseline = false;
      controls.reset(); previousPlayerPos.copy(g.player.pos);
    }
    function gunHand() { return hands.find(hand => hand.source?.handedness === xr.dominantHand && !hand.source.hand); }
    function mountWeapon() {
      if (!xr.active) return;
      const gun = gunHand();
      if (gun) {
        gun.ray.add(weapon);
        weapon.position.set(0, 0.015, -0.03); weapon.quaternion.identity();
      }
      for (const hand of hands) hand.body.visible = hand !== gun;
    }

    function beforeFrame(dt, frame) {
      if (!xr.active || !frame) return;
      const space = renderer.xr.getReferenceSpace();
      const pose = space && frame.getViewerPose(space);
      xr.poseValid = !!pose;
      if (!pose) {
        trackingBaseline = false; controls.reset();
        if (g.game.state === 'playing') g.game.pause();
        return;
      }
      head.copy(pose.transform.position);
      headRotation.copy(pose.transform.orientation);
      if (!headingBaseline) {
        direction.set(0, 0, -1).applyQuaternion(headRotation);
        yaw = g.player.yaw - Math.atan2(-direction.x, -direction.z);
        if (panel.querySelector('#xr-seated').checked && seatedLift === 0) seatedLift = Math.max(0, 1.65 - head.y);
        headingBaseline = true;
      }
      // A restart/rescue is a virtual teleport: don't replay tracking deltas across it.
      if (previousPlayerPos.distanceToSquared(g.player.pos) > 9) trackingBaseline = false;
      if (trackingBaseline) {
        physicalDelta.subVectors(head, lastHead); physicalDelta.y = 0;
        if (physicalDelta.lengthSq() < 0.25) {
          physicalDelta.applyAxisAngle(up, yaw);
          const feetY = g.player.pos.y;
          g.physics.moveCapsule(g.player.pos, physicalDelta, 1, 0.32, head.y + seatedLift < 1.25 ? 1 : 1.8, g.player.onGround);
          // Physics owns vertical movement; physical crouching changes eye height only.
          g.player.pos.y = feetY;
        }
      }
      lastHead.copy(head); trackingBaseline = true;
      updatePlayerCamera();
      mountWeapon();
      // Foveation can change during a session; framebuffer scale cannot.
      if (dt > 0 && dt < 0.1 && xr.focused) {
        frameMs = frameMs ? frameMs * 0.96 + dt * 1000 * 0.04 : dt * 1000;
        qualityTime += dt;
        if (dt * 1000 > 1000 / (xr.session.frameRate || profile.hz) * 1.25) slowFrames++;
        if (qualityTime > 3) {
          if (slowFrames > 25 && foveation < 1) { foveation = Math.min(1, foveation + 0.1); renderer.xr.setFoveation(foveation); }
          slowFrames = 0; qualityTime = 0;
        }
      }
    }

    function updatePlayerCamera() {
      if (!xr.active) return;
      offset.set(head.x, 0, head.z).applyAxisAngle(up, yaw);
      rig.position.set(g.player.pos.x - offset.x, g.player.pos.y + seatedLift - crouchDrop, g.player.pos.z - offset.z);
      rig.rotation.set(0, yaw, 0);
      rig.updateMatrixWorld(true);
      if (renderer.xr.isPresenting && xr.poseValid) {
        renderer.xr.updateCamera(trackedCamera);
        trackedCamera.updateMatrixWorld(true);
        trackedCamera.matrixWorld.decompose(g.camera.position, g.camera.quaternion, offset);
        g.camera.updateMatrixWorld(true);
        g.player.eye.copy(g.camera.position);
        g.camera.getWorldDirection(g.player.forward);
        if (Math.hypot(g.player.forward.x, g.player.forward.z) > 0.01) g.player.yaw = Math.atan2(-g.player.forward.x, -g.player.forward.z);
        g.player.pitch = Math.asin(Math.max(-1, Math.min(1, g.player.forward.y)));
      }
    }

    function aim(origin, rayDirection) {
      weapon.updateWorldMatrix(true, false);
      weapon.getWorldQuaternion(worldRotation);
      rayDirection.applyQuaternion(worldRotation).normalize();
      g.weapon.muzzleWorld(origin);
      // Prevent a muzzle pushed through cover from bypassing the collision surface.
      toMuzzle.subVectors(origin, g.player.eye);
      const distance = toMuzzle.length();
      if (distance > 0.01) {
        toMuzzle.multiplyScalar(1 / distance);
        const wall = g.physics.raycast(g.player.eye, toMuzzle, distance);
        if (wall) origin.copy(wall.point).addScaledVector(toMuzzle, -0.025);
      }
    }

    function afterFrame(dt) {
      if (!xr.active) return;
      const crouchTarget = input.crouch && head.y + seatedLift >= 1.25 ? 0.6 : 0;
      crouchDrop += (crouchTarget - crouchDrop) * Math.min(1, dt * 14);
      updatePlayerCamera();
      previousPlayerPos.copy(g.player.pos);
      const playing = g.game.state === 'playing';
      const gun = gunHand();
      reticle.visible = playing && xr.focused && xr.poseValid && !!gun?.ray.visible;
      weapon.visible = g.player.alive && !!gun?.ray.visible && xr.poseValid;
      aimTime -= dt;
      if (reticle.visible && aimTime <= 0) {
        aimTime = 1 / 30;
        direction.set(0, 0, -1); aim(muzzle, direction);
        const wall = g.physics.raycast(muzzle, direction, 70);
        const enemy = g.enemies.raycast(muzzle, direction, wall?.dist || 70);
        const hit = enemy || wall;
        const distance = hit?.dist || 35;
        reticle.position.copy(muzzle).addScaledVector(direction, distance);
        reticle.scale.setScalar(Math.max(0.008, Math.min(0.07, distance * 0.0017)));
        reticle.material.color.setHex(performance.now() < flashUntil ? 0xffffff : 0xffc977);
      }
      hud.position.set(0, playing ? -0.48 : -0.03, -1.45).applyQuaternion(g.camera.quaternion).add(g.camera.position);
      hud.quaternion.copy(g.camera.quaternion);
      hudTime -= dt;
      if (hudTime <= 0 || previousState !== g.game.state) {
        hudTime = 0.1; previousState = g.game.state;
        drawHUD(); updateMarkers();
      }
    }

    function drawHUD() {
      const now = performance.now(), state = g.game.state;
      ctx.clearRect(0, 0, 1024, 384);
      ctx.fillStyle = 'rgba(11,13,15,.84)'; ctx.fillRect(0, 0, 1024, 384);
      ctx.fillStyle = g.player.health < 30 ? '#ff7050' : '#ffb347'; ctx.fillRect(0, 0, 5, 384);
      ctx.textBaseline = 'top'; ctx.fillStyle = '#ffb347'; ctx.font = 'bold 30px sans-serif';
      ctx.fillText('SALTLINE / ' + (state === 'playing' ? 'UPLINK' : state.toUpperCase()), 28, 18);
      ctx.fillStyle = '#e8e4da'; ctx.font = 'bold 42px sans-serif';
      if (state === 'playing') {
        ctx.fillText('HP ' + Math.ceil(g.player.health) + '     ' + g.weapon.ammo + ' / ' + g.weapon.reserve, 28, 60);
        ctx.font = '30px sans-serif';
        const run = g.game.run;
        wrap(status || (run.allCut ? 'Get to the boat' : 'Cut the three uplink relays'), 28, 117, 960, 37, 2);
        ctx.fillStyle = '#ffb347';
        let line = g.weapon.state === 'reloading' ? 'RELOADING…' : 'RELAYS ' + run.cut + ' / ' + run.relays.length;
        if (prompt) line = 'HOLD OFF-HAND GRIP / TRIGGER: ' + prompt;
        wrap(line, 28, 198, 960, 34, 2);
        if (prompt) {
          ctx.fillStyle = '#3b4246'; ctx.fillRect(28, 270, 960, 5);
          ctx.fillStyle = '#ffb347'; ctx.fillRect(28, 270, 960 * Math.max(0, Math.min(1, promptProgress)), 5);
        }
        ctx.fillStyle = '#e8e4da'; ctx.font = '25px sans-serif';
        const help = 'Move: off-hand stick · Turn: weapon stick · Pause: off-hand upper button';
        wrap(now < messageUntil ? message : now - startedAt < 14000 ? help : 'Grip steadies · Lower face button jumps · Upper face button reloads', 28, 282, 960, 31, 3);
      } else {
        ctx.fillText(state === 'dead' ? 'SIGNAL LOST' : state === 'complete' ? 'EXTRACTION COMPLETE' : 'PAUSED', 28, 74);
        ctx.font = '32px sans-serif';
        wrap(state === 'paused' ? 'Weapon trigger: resume\nWeapon upper face button: exit VR\nOff-hand upper face button: resume' : 'Release, then pull the weapon trigger to redeploy.', 28, 153, 960, 46, 4);
      }
      texture.needsUpdate = true;
    }
    function wrap(text, x, y, width, spacing, lines) {
      const paragraphs = String(text || '').split('\n');
      let count = 0;
      for (const paragraph of paragraphs) {
        let line = '';
        for (const word of paragraph.split(/\s+/)) {
          const next = line ? line + ' ' + word : word;
          if (ctx.measureText(next).width > width && line) {
            ctx.fillText(line, x, y + count++ * spacing); line = word;
            if (count >= lines) return;
          } else line = next;
        }
        ctx.fillText(line, x, y + count++ * spacing);
        if (count >= lines) return;
      }
    }

    function updateMarkers() {
      const targets = g.game.run.relays.filter(relay => !relay.cut).map(relay => ({ pos: relay.o.pos, text: relay.short }));
      if (g.game.run.allCut && g.level.extraction) targets.push({ pos: g.level.extraction.pos, text: 'BOAT' });
      while (labels.length < targets.length) {
        const c = document.createElement('canvas'); c.width = 256; c.height = 128;
        const map = new T.CanvasTexture(c); map.colorSpace = T.SRGBColorSpace; map.generateMipmaps = false; map.minFilter = T.LinearFilter;
        const mesh = new T.Sprite(new T.SpriteMaterial({ map, depthTest: false, depthWrite: false, toneMapped: false }));
        mesh.renderOrder = 900; mesh.scale.set(1.2, 0.6, 1); g.scene.add(mesh);
        labels.push({ canvas: c, mesh, map, last: '' });
      }
      labels.forEach((label, index) => {
        const target = targets[index];
        label.mesh.visible = !!target && g.game.state === 'playing';
        if (!target) return;
        const distance = Math.round(g.player.pos.distanceTo(target.pos));
        label.mesh.visible &&= distance > 2;
        label.mesh.position.copy(target.pos); label.mesh.position.y += 2.3;
        label.mesh.scale.setScalar(Math.max(1, Math.min(2.5, distance / 18)));
        label.mesh.scale.y *= 0.5;
        const text = target.text + '  ' + distance + 'm';
        if (label.last === text) return;
        label.last = text;
        const c = label.canvas.getContext('2d');
        c.clearRect(0, 0, 256, 128); c.fillStyle = 'rgba(11,13,15,.8)'; c.fillRect(0, 20, 256, 84);
        c.fillStyle = '#ffb347'; c.font = 'bold 36px sans-serif'; c.textAlign = 'center'; c.fillText(text, 128, 75);
        label.map.needsUpdate = true;
      });
    }

    function render(dt) {
      renderer.info.reset();
      g.render.lightPool.update(dt);
      const uniforms = g.render.sky?.material?.uniforms;
      if (uniforms?.uTime) uniforms.uTime.value = g.time.t;
      renderer.toneMapping = T.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 0.6 * g.render.exposure;
      renderer.clear();
      renderer.render(g.scene, trackedCamera);
    }
    function pulse(handedness, strength, milliseconds) {
      if (!xr.active || !xr.focused) return;
      const source = Array.from(xr.session.inputSources).find(source => source.handedness === handedness);
      const actuator = source?.gamepad?.hapticActuators?.[0];
      if (actuator?.pulse) {
        try { const result = actuator.pulse(strength, milliseconds); result?.catch?.(() => {}); } catch {}
      }
    }
  }

  window.SaltlineXR = { attach };
})();
