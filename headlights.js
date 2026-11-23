// Headlights and tail lights: when the host's lighting is dark (dusk or night, index.html's nightOn()), every vehicle with
// someone aboard lights the way ahead. Flashlights (index.html's flashBeam: everyone has one, L) are lamps the same way, and by day too in the dark places (DARK: the
// bunker, its tunnel, the cellar and the stairs up). Each lamp is a cone (vehicles.js's lampBeams: where,
// which way, how far, how wide and its colour). Inside a cone a surface shows its own colour times the lamp's, without the
// look's light and shadow (index.html's flashAt, in every toon material's shader).
// What a lamp can see is drawn from there, depth only, into one tile of a small target (FLASH.depth, four tiles across, two
// down): the level, the props, the vehicles and everyone, so the cone stops at what's really in the way (walls, posts,
// people). More than FLASH_MAX at once: the ones nearest you.
// Loaded after the main game script and vehicles.js; it uses the game's globals (scene, renderer, camera, VEH, FLASH, ...).
(() => {
  const LAMP_FAR = 40, RES = 256, COLS = 4, _white = new V3(1, 1, 1);
  const target = new THREE.WebGLRenderTarget(RES * COLS, RES * 2, { depthBuffer: true, stencilBuffer: false });
  target.depthTexture = new THREE.DepthTexture(RES * COLS, RES * 2); target.depthTexture.type = THREE.UnsignedIntType;
  target.depthTexture.minFilter = target.depthTexture.magFilter = THREE.NearestFilter; target.texture.generateMipmaps = false;
  FLASH.depth.value = target.depthTexture; FLASH.texel.value.set(1 / (RES * COLS), 1 / (RES * 2));
  // Depth only, both sides (a wall seen from behind still blocks). Two of them: three.js r128 makes a material's shader for the
  // first thing it draws and never looks again at whether the next one is skinned, so one material for the level and the
  // bodies drew the bodies in their rest pose (a T). Bodies get the skinned one, mesh by mesh, so their shadows take their pose
  const depthOpts = { colorWrite: false, side: THREE.DoubleSide };
  const depthMat = new THREE.MeshBasicMaterial(depthOpts), depthSkin = new THREE.MeshBasicMaterial(Object.assign({ skinning: true }, depthOpts));
  depthMat.onBeforeCompile = depthSkin.onBeforeCompile = () => {}; // (not the lamps' own shader: it reads the target it's drawing into)
  const cams = [...Array(FLASH_MAX)].map(() => new THREE.PerspectiveCamera(46, 1, FLASH_NEAR, LAMP_FAR)); // (46°: the cone, 41°, with a little over)

  // Draw a group as if it were a scene (only a scene renders on its own), with the depth material over everything
  function asScene(root, cam, over) {
    const was = root.isScene; root.isScene = true; root.overrideMaterial = over; // (null, not missing: three.js takes anything but null as an override)
    try { renderer.render(root, cam); } finally { root.isScene = was; delete root.overrideMaterial; }
  }
  function drawDepth(root, cam) { if (root && root.visible) asScene(root, cam, depthMat); }
  // A body (or a vehicle and whoever rides it): each mesh gets the depth material that suits it for the moment it's drawn.
  // (A mesh that isn't drawn, a hit box, stays out)
  const swapped = [];
  function drawBody(root, cam) {
    if (!root || !root.visible) return;
    root.traverseVisible(o => {
      if (!o.isMesh || !o.material) return;
      const m = o.material; if (Array.isArray(m) ? !m.some(x => x.visible) : !m.visible) return;
      swapped.push(o, m); o.material = o.isSkinnedMesh ? depthSkin : depthMat;
    });
    try { asScene(root, cam, null); } finally { for (let k = 0; k < swapped.length; k += 2) swapped[k].material = swapped[k + 1]; swapped.length = 0; }
  }

  // The beams in the air: each lamp's cone drawn as a soft glow, added over the scene (light in the haze). Brightest down its middle and near the lamp, fading out to its
  // far end and at its sides; where the lamp's own depth map says something's in the way, the beam stops (flSeen), and walls in front hide it. Stronger in thicker haze
  // (the Lighting panel's Haze) and darker light; your own flashlight's is fainter, since you look down it. Nothing else sees them: no shadows, no hits, no paint
  const BEAM_SEG = 28, cone = new THREE.ConeGeometry(1, 1, BEAM_SEG, 10, true);
  cone.translate(0, -0.5, 0); cone.rotateX(-Math.PI / 2); // (apex at the origin, opening along +z, 1 long and 1 across at the far end)
  const beamMat = i => new THREE.ShaderMaterial({
    uniforms: Object.assign(FLASH_UNIFORMS(), { bIdx: { value: i }, bK: { value: 0 } }),
    vertexShader: `varying vec3 vW; varying vec3 vN; varying vec3 vV;
      void main() { vec4 w = modelMatrix * vec4(position, 1.0), mv = viewMatrix * w; vW = w.xyz; vN = normalMatrix * normal; vV = -mv.xyz; gl_Position = projectionMatrix * mv; }`, // (normalMatrix: right under the cone's stretch)
    fragmentShader: FLASH_GLSL + `uniform float bIdx; uniform float bK; varying vec3 vW; varying vec3 vN; varying vec3 vV;
      void main() {
        vec3 pos = vec3(0.0), dir = vec3(0.0, 0.0, 1.0), col = vec3(1.0); float far = 1.0, seen = 0.0;
        for (int i = 0; i < ${FLASH_MAX}; i++) if (float(i) == bIdx) { pos = flPos[i]; dir = flDir[i]; far = flFar[i]; col = flCol[i]; seen = flSeen(i, vW, far); }
        float t = clamp(dot(vW - pos, dir) / far, 0.0, 1.0);
        float fall = (1.0 - t) * (1.0 - t) * smoothstep(0.0, 0.04, t);           // bright by the lamp, gone at its reach
        float side = pow(abs(dot(normalize(vN), normalize(vV))), 2.0); // soft at the cone's edges as you see it
        float k = bK * fall * side * seen;
        gl_FragColor = vec4(col * k, 1.0);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
  });
  const vols = [...Array(FLASH_MAX)].map((_, i) => { const m = new THREE.Mesh(cone, beamMat(i)); m.visible = false; m.renderOrder = 5; m.raycast = () => {}; m.name = 'Beam'; scene.add(m); return m; });
  const BEAM_K = 0.4, _ax = new V3();
  function beamVols() {
    const n = FLASH.n.value, haze = typeof LOOK === 'object' && LOOK.haze != null ? LOOK.haze : 1, dark = nightOn() ? 1 : 0.55;
    vols.forEach((m, i) => {
      if (i >= n) { m.visible = false; return; }
      const b = beams[i], far = FLASH.far.value[i], r = far * Math.tan(Math.acos(Math.min(0.999, FLASH.cone.value[i])));
      m.position.copy(b.o); _ax.copy(b.o).add(b.d); m.lookAt(_ax); m.scale.set(r, r, far); m.visible = haze > 0.01;
      m.material.uniforms.bK.value = BEAM_K * haze * dark * (b.e === P && !tpOn ? 0.35 : 1); // (yours, looking down it: fainter)
    });
  }

  const beams = [];
  function after() {
    beams.length = 0;
    const night = nightOn();
    if (night) for (const b of VEH.lampBeams()) beams.push(b);
    for (const e of ents) { const b = flashBeam(e); if (b && (night || darkNear(b.o, 2))) beams.push(b); } // flashlights: at dusk and night, and by day in (or at the door of) a dark place, the bunker
    if (beams.length > FLASH_MAX) { const c = camera.position; beams.sort((a, b) => a.o.distanceToSquared(c) - b.o.distanceToSquared(c)); beams.length = FLASH_MAX; }
    FLASH.n.value = 0; if (!beams.length) { beamVols(); return; } // (no light while its own map is drawn)
    const rt = renderer.getRenderTarget(), au = renderer.shadowMap.autoUpdate, ac = renderer.autoClear;
    renderer.shadowMap.autoUpdate = false; renderer.autoClear = false;
    try {
      beams.forEach((b, i) => {
        const cam = cams[i], far = b.far || LAMP_FAR, fov = b.fov || 46;
        if (cam.far !== far || cam.fov !== fov) { cam.far = far; cam.fov = fov; cam.updateProjectionMatrix(); }
        cam.position.copy(b.o); cam.lookAt(b.o.x + b.d.x, b.o.y + b.d.y, b.o.z + b.d.z); cam.updateMatrixWorld();
        target.viewport.set((i % COLS) * RES, Math.floor(i / COLS) * RES, RES, RES); target.scissor.copy(target.viewport); target.scissorTest = true;
        renderer.setRenderTarget(target); renderer.clear(false, true, false);
        drawDepth(levelGroup, cam); drawDepth(propGroup, cam);
        for (const v of VEH.list || []) if (v !== b.v && v.g) drawBody(v.g, cam);
        for (const o of ents) if (o.alive && o !== b.e) drawBody(o === P ? P.rig && P.rig.wrap : o.mesh, cam); // (not the one holding the flashlight: the light is in their head)
        FLASH.mat.value[i].multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
        FLASH.pos.value[i].copy(b.o); FLASH.dir.value[i].copy(b.d); FLASH.far.value[i] = far;
        FLASH.col.value[i].copy(b.col || _white); FLASH.cone.value[i] = b.cone || 0.935; FLASH.band.value[i] = b.band || 0.035; // (band: how gradually its edge fades in)
      });
    } finally { renderer.setRenderTarget(rt); renderer.shadowMap.autoUpdate = au; renderer.autoClear = ac; }
    FLASH.n.value = beams.length;
    beamVols();
  }
  Object.assign(LAMPS, { after });
})();
