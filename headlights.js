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
  const LAMP_FAR = 40, RES = LITE ? 256 : 512, COLS = 4, _white = new V3(1, 1, 1);
  // With LITE graphics: every lamp still lights (up to FLASH_MAX), but people are drawn into a lamp's map only within BODY_NEAR of it. The glow in the air shows for
  // every lamp in view, your own in first person too (since 2026-11-25; down a tunnel it covers the screen, so it skips the shadow lookup: from your eyes, the
  // depth test alone stops it at walls, as the lamp's own map would; see beamVols)
  const LAMP_CAP = FLASH_MAX, BODY_NEAR = LITE ? 14 : Infinity;
  // The victory spotlight: a small hard lamp just off the front of the roof (SPOT_OUT ahead of the top scorer, toward the view, SPOT_LOW up), aimed up at
  // their middle (SPOT_AIM of their height): a sharp-edged oval (SPOT_EDGE up and down, SPOT_ASP as wide) that takes in all of them, full bright, and a little of those beside them
  const SPOT_OUT = 1.6, SPOT_LOW = 0.1, _spotCol = new V3(1, 0.96, 0.86);
  const SPOT_EDGE = 33, SPOT_ASP = 1.3, SPOT_BAND = 0.05, SPOT_AIM = 0.45, SPOT_HAZE = 0.35; // (wide enough to light the faces of 2nd and 3rd, 1 m to each side; 4th, 2 m along, is past its edge)
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
  // (the Lighting panel's Haze) and darker light; your own flashlight's too, in first person as well. Nothing else sees them: no shadows, no hits, no paint
  // (BEAM_SEG: round the cone; 28 until 2026-11-24 showed as stripes down the beam)
  // Where beams cross, or you see a cone's near and far sides at once, the brightest one shows (max blending), not their sum: since 2026-11-25 (added up, two
  // lights crossing glowed white). And the glow is dithered like the PS1 look (a 4x4 ordered dither in BEAM_STEPS steps, coarse so it shows), in cells about as big as a
  // 300-line picture's pixels (bCell), so it reads as a soft retro haze at any Graphics level
  const BEAM_STEPS = 6, BEAM_LIFT = '1.4', BEAM_K_MAX = '1.0', BEAM_CELL = { value: 1 }, _bufSz = new THREE.Vector2(); // (BEAM_LIFT: as it now replaces what's behind it where brighter, rather than adding to it, it's drawn that much stronger to show as much over the
  // dark; BEAM_K_MAX: the glow the steps span, brighter keeps stepping)
  const BEAM_SEG = 96, cone = new THREE.ConeGeometry(1, 1, BEAM_SEG, 10, true);
  cone.translate(0, -0.5, 0); cone.rotateX(-Math.PI / 2); // (apex at the origin, opening along +z, 1 long and 1 across at the far end)
  const beamMat = i => new THREE.ShaderMaterial({
    uniforms: Object.assign(FLASH_UNIFORMS(), { bIdx: { value: i }, bK: { value: 0 }, bCell: BEAM_CELL, bPos: { value: new V3() }, bDir: { value: new V3(0, 0, 1) }, bFar: { value: 1 }, bCol: { value: new V3(1, 1, 1) } }),
    vertexShader: `varying vec3 vW; varying vec3 vN; varying vec3 vV;
      void main() { vec4 w = modelMatrix * vec4(position, 1.0), mv = viewMatrix * w; vW = w.xyz; vN = normalMatrix * normal; vV = -mv.xyz; gl_Position = projectionMatrix * mv; }`, // (normalMatrix: right under the cone's stretch)
    fragmentShader: DARK_GLSL + FLASH_GLSL + `uniform float bIdx; uniform float bK; uniform float bCell; uniform vec3 bPos; uniform vec3 bDir; uniform float bFar; uniform vec3 bCol; varying vec3 vW; varying vec3 vN; varying vec3 vV;
      void main() {
        vec3 pos = bPos, dir = bDir, col = bCol; float far = bFar, seen = 1.0; // (its own lamp's numbers; bIdx: its slot among the lamps that light, -1 for one that only glows)
        for (int i = 0; i < ${FLASH_MAX}; i++) if (float(i) == bIdx && flShad[i] > 0.5) seen = flSeen(i, vW, far);
        float t = clamp(dot(vW - pos, dir) / far, 0.0, 1.0);
        float fall = (1.0 - t) * (1.0 - t) * smoothstep(0.0, 0.04, t);           // bright by the lamp, gone at its reach
        float side = pow(abs(dot(normalize(vN), normalize(vV))), 2.0); // soft at the cone's edges as you see it
        float k = bK * fall * side * seen * ${BEAM_LIFT};
        vec2 q = mod(floor(gl_FragCoord.xy / bCell), 4.0); // (the 4x4 Bayer matrix, 0-15, by cell)
        vec4 r = q.y < 1.0 ? vec4(0.0, 8.0, 2.0, 10.0) : q.y < 2.0 ? vec4(12.0, 4.0, 14.0, 6.0) : q.y < 3.0 ? vec4(3.0, 11.0, 1.0, 9.0) : vec4(15.0, 7.0, 13.0, 5.0);
        float th = (dot(r, vec4(equal(vec4(q.x), vec4(0.0, 1.0, 2.0, 3.0)))) + 0.5) / 16.0;
        k = floor(k / ${BEAM_K_MAX} * float(${BEAM_STEPS}) + th) / float(${BEAM_STEPS}) * ${BEAM_K_MAX};
        gl_FragColor = vec4(col * k, 1.0);
      }`,
    transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendEquation: THREE.MaxEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, side: THREE.DoubleSide, fog: false,
  });
  // (GLOW_MAX: every lit lamp in view keeps its glow, near or far, not only the ones lighting things (FLASH_MAX); since 2026-11-25: with LITE only the nearest two
  // glowed, so a far bot's beam vanished as soon as anyone was nearer)
  const GLOW_MAX = 16, vols = [...Array(GLOW_MAX)].map((_, i) => { const m = new THREE.Mesh(cone, beamMat(-1)); m.visible = false; m.renderOrder = 5; m.raycast = () => {}; m.name = 'Beam'; scene.add(m); return m; });
  const BEAM_K = 0.4, _ax = new V3(), _proj = new THREE.Matrix4(), _frus = new THREE.Frustum(), _ball = new THREE.Sphere();
  function beamVols(glows) {
    const haze = typeof LOOK === 'object' && LOOK.haze != null ? LOOK.haze : 1, night = nightOn();
    BEAM_CELL.value = Math.max(1, Math.floor(renderer.getDrawingBufferSize(_bufSz).y / 300));
    const list = LAMP_Q.beams && haze > 0.01 ? glows : [];
    vols.forEach((m, j) => {
      const b = list[j]; if (!b) { m.visible = false; return; }
      const far = b.far || LAMP_FAR, cn = b.cone || 0.935, asp = b.asp || 1, r = far * Math.tan(Math.acos(Math.min(0.999, cn))), u = m.material.uniforms;
      m.position.copy(b.o); _ax.copy(b.o).add(b.d); m.lookAt(_ax); m.scale.set(r * asp, r, far); m.visible = true; // (asp: an oval, wider than tall)
      u.bIdx.value = b.e === P && !tpOn ? -1 : beams.indexOf(b); u.bPos.value.copy(b.o); u.bDir.value.copy(b.d); u.bFar.value = far; u.bCol.value.copy(b.col || _white);
      const dark = night ? 1 : darkNear(b.o, 2) ? 0.55 : 0.2; // (by day out in the open, only a faint shaft in the haze)
      m.material.uniforms.bK.value = BEAM_K * haze * dark * (b.hz || 1); // (yours as strong as anyone's: looking down it, at a third it only showed at its rim, 2026-11-25)
    });
  }

  // Flashlight lenses: where each lit flashlight's beam starts, a small bright disc flat to their chest at the end of a short black tube (the light's body,
  // running back into the chest), and a soft glow round it (brighter the more it points your way), like the headlights' lenses. Only while the light is on and
  // lighting something (at dusk and night, or in a dark place); never your own in first person (it's by your eyes)
  const LENS_R = 0.03, HALO = 0.32, TUBE_R = 0.036, TUBE_L = 0.08;
  // The glow: a smooth falloff, drawn finely (128 across, 64 until 2026-11-24) with a little noise in it so its faint edge has no rings
  const haloTex = (() => {
    const N = 128, c = document.createElement('canvas'); c.width = c.height = N; const x = c.getContext('2d'), img = x.createImageData(N, N), px = img.data;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const r = Math.hypot(i + 0.5 - N / 2, j + 0.5 - N / 2) / (N / 2), core = Math.exp(-r * r * 40), glow = Math.exp(-r * r * 7) * (1 - r * r);
      const a = Math.max(0, Math.min(1, r >= 1 ? 0 : core + glow * 0.6)), n = (Math.random() - 0.5) * 2, k = (j * N + i) * 4;
      px[k] = 255; px[k + 1] = 245 - 10 * (1 - core); px[k + 2] = 220 - 30 * (1 - core); px[k + 3] = Math.max(0, Math.min(255, Math.round(a * 255 + (a > 0.002 ? n : 0))));
    }
    x.putImageData(img, 0, 0); return new THREE.CanvasTexture(c);
  })();
  const lensGeo = new THREE.CircleGeometry(LENS_R, 20), lensMat = new THREE.MeshBasicMaterial({ color: 0xfff6d8, fog: false });
  const tubeGeo = new THREE.CylinderGeometry(TUBE_R, TUBE_R, TUBE_L, 16); tubeGeo.rotateX(Math.PI / 2); tubeGeo.translate(0, 0, -TUBE_L / 2 - 0.001); // (along -z, behind the lens)
  const tubeMat = new THREE.MeshBasicMaterial({ color: 0x141414 });
  const lensPool = [], _toCam = new V3();
  function lensAt(k) {
    if (lensPool[k]) return lensPool[k];
    const g = new THREE.Group(), disc = new THREE.Mesh(lensGeo, lensMat), tube = new THREE.Mesh(tubeGeo, tubeMat); g.add(tube);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
    halo.scale.set(HALO, HALO, 1); halo.renderOrder = 6; g.add(disc, halo); g.name = 'FlashlightLens';
    g.traverse(o => { o.raycast = () => {}; }); g.userData.halo = halo; g.visible = false; scene.add(g);
    return (lensPool[k] = g);
  }
  function lenses() {
    let k = 0;
    for (const b of beams) {
      if (!b.e || (b.e === P && !tpOn)) continue;
      const g = lensAt(k++);
      // the disc stands flat to the chest, facing the way the body does (not tipped down along the beam)
      const fw = b.face; g.position.copy(b.o); _ax.copy(g.position).add(fw); g.lookAt(_ax); g.visible = true;
      const f = Math.max(0, fw.dot(_toCam.copy(camera.position).sub(g.position).normalize()));
      g.userData.halo.material.opacity = 0.3 + 0.7 * f * f;
    }
    for (; k < lensPool.length; k++) lensPool[k].visible = false;
  }

  // The level's tunnels and rooms underground (tunnelKit's 'Tunnel' groups): all a lamp down there can see
  let tunKey = null, tunList = [];
  function tunnelSets() {
    const k = levelGroup.children[0] || null; if (k === tunKey && tunList.length) return tunList;
    tunKey = k; tunList = []; levelGroup.traverse(o => { if (o.name === 'Tunnel') tunList.push(o); });
    return tunList;
  }

  const beams = [];
  function after() {
    beams.length = 0;
    const night = nightOn();
    // The victory screen at night: a hard spotlight from just off the front of the roof up at the top scorer (first, so it's always one of the lamps); it lights
    // only what faces it (soft -1), and the winners throw hard shadows up the mast behind. (Until 2026-11-24 it hung 11 m up in front of the roof: a wide,
    // bright cone down on the middle of the whole line)
    if (night && VIC.on && VIC.c && VIC.rigs && VIC.rigs[0]) {
      const r = VIC.rigs[0], w = r.wrap.position, o = new V3(w.x, VIC.c.y + SPOT_LOW, w.z + SPOT_OUT), d = new V3(w.x, VIC.c.y + r.model.headY * SPOT_AIM, w.z).sub(o).normalize();
      beams.push({ o, d, far: 22, fov: SPOT_EDGE * 2 + 6, asp: SPOT_ASP, cone: Math.cos(SPOT_EDGE * Math.PI / 180), band: SPOT_BAND, soft: -1, col: _spotCol, hz: SPOT_HAZE, vic: true });
    }
    for (const b of VEH.lampBeams()) beams.push(b); // headlights that are on, day or night (only at dusk and night until 2026-11-24)
    // flashlights: anyone who has switched theirs on (people, day or night, since 2026-11-24); the bots' at dusk and night, and by day in (or at the door of) a dark place, the bunker
    for (const e of ents) { const b = flashBeam(e); if (b && (night || e.isPlayer || e.isRemote || e.isReplica || darkNear(b.o, 2))) beams.push(b); }
    lenses(); // (every lit flashlight shows its lens, even the ones past FLASH_MAX)
    if (LAMP_Q.mode === 'dots') for (let i = beams.length - 1; i >= 0; i--) if (beams[i].e !== P && !beams[i].vic) beams.splice(i, 1); // (only yours lights anything)
    // Only lamps that light something in view: a cone whose bounding ball is off the screen lights nothing you can see and has no glow there either (since 2026-11-24:
    // every lamp drew its map of the level each frame, behind you or not). The victory spotlight always stays
    _proj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); _frus.setFromProjectionMatrix(_proj);
    for (let i = beams.length - 1; i >= 0; i--) {
      const b = beams[i]; if (b.vic) continue;
      const far = b.far || LAMP_FAR, t = Math.tan(Math.acos(Math.min(0.999, b.cone || 0.935))) * (b.asp || 1);
      _ball.center.copy(b.o).addScaledVector(b.d, far * 0.5); _ball.radius = far * Math.sqrt(0.25 + t * t);
      if (!_frus.intersectsSphere(_ball)) beams.splice(i, 1);
    }
    if (beams.length > 1) { const c = camera.position; beams.sort((a, b) => a.o.distanceToSquared(c) - b.o.distanceToSquared(c)); }
    const glows = beams.slice(); if (beams.length > LAMP_CAP) beams.length = LAMP_CAP; // (every lamp in view glows, nearest first; the nearest LAMP_CAP also light) // (nearest first, so the glows LITE keeps are the near ones)
    FLASH.n.value = 0; if (!beams.length) { beamVols(glows); return; } // (no light while its own map is drawn)
    const rt = renderer.getRenderTarget(), au = renderer.shadowMap.autoUpdate, ac = renderer.autoClear;
    renderer.shadowMap.autoUpdate = false; renderer.autoClear = false;
    try {
      beams.forEach((b, i) => {
        const shad = LAMP_Q.mode === 'full' || b.vic || (LAMP_Q.mode !== 'flat' && b.e === P); FLASH.shad.value[i] = shad ? 1 : darkNear(b.o) ? -1 : 0; // (-1: a shadowless lamp inside a dark place, 0: one outside)
        if (!shad) { FLASH.pos.value[i].copy(b.o); FLASH.dir.value[i].copy(b.d); FLASH.far.value[i] = b.far || LAMP_FAR; FLASH.col.value[i].copy(b.col || _white); FLASH.cone.value[i] = b.cone || 0.935; FLASH.band.value[i] = b.band || 0.035; FLASH.asp.value[i] = b.asp || 1; FLASH.soft.value[i] = b.soft || 0; return; } // (no map of its own to draw)
        const cam = cams[i], far = b.far || LAMP_FAR, fov = b.fov || 46;
        const asp = b.asp || 1; // (an oval lamp: its map as much wider as the oval is)
        if (cam.far !== far || cam.fov !== fov || cam.aspect !== asp) { cam.far = far; cam.fov = fov; cam.aspect = asp; cam.updateProjectionMatrix(); }
        cam.position.copy(b.o); cam.lookAt(b.o.x + b.d.x, b.o.y + b.d.y, b.o.z + b.d.z); cam.updateMatrixWorld();
        target.viewport.set((i % COLS) * RES, Math.floor(i / COLS) * RES, RES, RES); target.scissor.copy(target.viewport); target.scissorTest = true;
        renderer.setRenderTarget(target); renderer.clear(false, true, false);
        if (LITE && darkNear(b.o)) for (const t of tunnelSets()) drawDepth(t, cam); // (a lamp in the bunker or the cellar: only their walls, not the whole level, 300k triangles, again)
        else drawDepth(levelGroup, cam);
        drawDepth(propGroup, cam);
        // (only what's within the lamp's reach and not behind it: each one drawn is a pass of its own, and with eight lamps and everyone that was a hundred a frame)
        const near = Math.min(far, BODY_NEAR), reach = (p, r) => { _ax.copy(p).sub(b.o); const d2 = _ax.lengthSq(); return d2 < (near + r) * (near + r) && (d2 < r * r || _ax.dot(b.d) > -r); };
        for (const v of VEH.list || []) if (v !== b.v && v.g && reach(v.pos, 4)) drawBody(v.g, cam);
        if (VIC.on) for (const r of VIC.rigs) drawBody(r.wrap, cam); // (the winners on the roof: they throw shadows too; everyone else is out of sight)
        else for (const o of ents) if (o.alive && o !== b.e && reach(o.pos, 2.5)) drawBody(o === P ? P.rig && P.rig.wrap : o.mesh, cam); // (not the one holding the flashlight: the light is in their head)
        FLASH.mat.value[i].multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
        FLASH.pos.value[i].copy(b.o); FLASH.dir.value[i].copy(b.d); FLASH.far.value[i] = far;
        FLASH.col.value[i].copy(b.col || _white); FLASH.cone.value[i] = b.cone || 0.935; FLASH.band.value[i] = b.band || 0.035; FLASH.asp.value[i] = b.asp || 1; FLASH.soft.value[i] = b.soft || 0; // (band: how gradually its edge fades in; asp: how many times wider than tall)
      });
    } finally { renderer.setRenderTarget(rt); renderer.shadowMap.autoUpdate = au; renderer.autoClear = ac; }
    FLASH.n.value = beams.length;
    beamVols(glows);
  }
  Object.assign(LAMPS, { after });
})();
