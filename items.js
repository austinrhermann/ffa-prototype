// ?dev items: things to find in the level that aren't guns. The host keeps track of every one (where it lies, who has it)
// and tells everyone; a player picks one up by walking over it, as with a weapon.
//   - Spray cans: one per colour (art.js's six), each a thing on its own, so a picture in several colours takes some
//     finding. One takes a hand (range.js); click sprays, right-click draws a fine line.
// And everyone's flashlight (not a thing to find: everyone has one, off to start with): L turns yours on and off, whatever you
// hold, so you can see and shoot in the dark (the bots put theirs on at night: DAY.dark, index.html). A cone from your eyes shows
// what it falls on in its own colours, with none of the light and shadow (the shaders' flashAt, index.html), and each cone has a
// small shadow map so it stops at what's really in the way. At the wheel your light is your headlights (vehicles.js).
// And the shower (the level's shower: the fort's is in a corner of the courtyard): E in it washes the paint off you. A
// mirror beside it, to see what you look like.
// Whatever someone carries drops where they die. A new round puts everything back where it started.
// Loaded after the main game script, range.js and art.js; it uses their globals (scene, P, ents, NET, RANGE, ART, ...).
// The game calls into ITEMS (declared in index.html) from its loop, network, voice and the computer's map.
(() => {
  const FLASHLIGHTS = 0, SPRAYS = 6; // (flashlights were things to find; everyone has one now)
  const PAINT = ['#B06455', '#E1B559', '#5A6490', '#455533', '#000000', '#FFFFFF']; // art.js's palette, in its order
  // Their ids: s0-s5 the cans (by colour), f0-f3 the flashlights. The order they're laid out in, so each kind ends up spread
  // across the level
  const ORDER = ['s0', 'f0', 's1', 's2', 'f1', 's3', 's4', 'f2', 's5', 'f3'].filter(u => +u.slice(1) < { s: SPRAYS, f: FLASHLIGHTS }[u[0]]);
  const kindOf = u => ({ s: 'spray', f: 'light' }[u[0]]);
  const on = () => typeof DEV !== 'undefined' && DEV && RANGE.on && !RANGE.range && MODE !== 'drive';

  // ---------------------------------------------------------------- what they look like
  const mat = c => toonMat({ color: c });
  function lightMesh() { // pointing down -z (the way a held thing points), lens at the front
    const g = new THREE.Group(), body = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.16, 12).rotateX(Math.PI / 2), mat(0x2b2d31));
    const head = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.026, 0.06, 14).rotateX(Math.PI / 2), mat(0x2b2d31));
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.032, 14), new THREE.MeshBasicMaterial({ color: 0xfff1a8 }));
    const sw = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.01, 0.022), mat(0xd1a53a));
    head.position.z = -0.1; lens.position.z = -0.131; lens.rotation.y = Math.PI; sw.position.set(0, 0.024, -0.01);
    [body, head, sw].forEach(m => { m.castShadow = true; g.add(m); }); g.add(lens);
    return g;
  }
  function groundMesh(u) {
    const k = kindOf(u), o = new THREE.Group();
    if (k === 'spray') { const c = ART.heldObject('spray', +u.slice(1)); if (c) { c.scale.setScalar(2.4); o.add(c); } }
    else { const l = lightMesh(); l.scale.setScalar(2.4); l.rotation.y = Math.PI / 2; o.add(l); }
    return o;
  }

  // ---------------------------------------------------------------- where they start
  // Spread over the level's own spots (ammo, spawns, weapons), each as far as it can be from the ones already taken,
  // and moved a step off the spot so it doesn't sit inside an ammo pack or a weapon
  function homes() {
    const cand = [...AMMO_SPOTS.map(a => a.pos), ...SPAWNS, ...STATIC_PICKUPS.map(p => p[1])].filter(Boolean);
    if (!cand.length) return [];
    const mid = cand.reduce((a, p) => a.add(p), new V3()).divideScalar(cand.length);
    const out = [cand.reduce((b, p) => (p.distanceTo(mid) < b.distanceTo(mid) ? p : b))];
    while (out.length < ORDER.length) {
      let best = null, bd = -1;
      for (const p of cand) { const d = Math.min(...out.map(o => o.distanceTo(p))); if (d > bd) { bd = d; best = p; } }
      out.push(best);
    }
    return out.map((p, i) => {
      for (let k = 0; k < 8; k++) {
        const a = (i * 2.4 + k) * Math.PI / 4, x = p.x + Math.cos(a) * 1.1, z = p.z + Math.sin(a) * 1.1, g = groundAt(x, z, p.y + 1);
        if (g !== null && Math.abs(g - p.y) < 0.6 && !solidPt(x, g + 0.5, z, 0.25)) return new V3(x, g, z);
      }
      return p.clone();
    });
  }

  // ---------------------------------------------------------------- the items (everyone's copy; the host's is the one that counts)
  // holder: the id of whoever carries it (null: on the ground at pos). hand: for a flashlight, it's on
  const items = ORDER.map(u => ({ u, kind: kindOf(u), c: u[0] === 's' ? +u.slice(1) : -1, home: new V3(), pos: new V3(), holder: null, hand: false, mesh: null, noPick: null, givenAt: 0 }));
  const byU = u => items.find(it => it.u === u);
  const meId = () => (NET.role === 'host' ? 'h' : NET.myId);
  const entOf = id => (id === meId() ? P : entityById(id));
  let built = false;
  function build() { if (built) return; built = true; for (const it of items) { it.mesh = groundMesh(it.u); it.mesh.visible = false; scene.add(it.mesh); } }
  function onLevel() {
    build(); placeShower(); placeMirror();
    const h = homes();
    items.forEach((it, i) => { it.home.copy(h[i] || new V3()); });
    reset();
  }
  function reset() { // everything back where it started (the host's word; a guest hears it in the next 'its')
    for (const it of items) { it.pos.copy(it.home); it.holder = null; it.hand = false; it.noPick = null; }
    if (NET.role === 'host') for (const u of RANGE.items()) RANGE.loseItem(u);
    sendT = 0;
  }

  // ---------------------------------------------------------------- the host
  let sendT = 0;
  const lit = new Set(), guestLit = new Set(); // ids whose flashlights are on (the host's word); the guests' own say (the host's copy)
  const near = (e, p) => Math.hypot(e.pos.x - p.x, e.pos.z - p.z) < 1.1 && Math.abs(e.pos.y - p.y) < 1.3;
  const carried = (id, k) => items.filter(it => it.holder === id && (k ? it.kind === k : it.kind === 'spray')).length; // (only a spray can takes a hand)
  // On the ground near where e is, a step ahead of them
  function dropSpot(e, ahead) {
    const f = e === P ? new V3(-Math.sin(P.yaw), 0, -Math.cos(P.yaw)) : fwdOf(e), x = e.pos.x + f.x * ahead, z = e.pos.z + f.z * ahead;
    const g = groundAt(x, z, e.pos.y + 1.2);
    return g !== null && Math.abs(g - e.pos.y) < 2 && !solidPt(x, g + 0.5, z, 0.2) ? new V3(x, g, z) : e.pos.clone();
  }
  function hostUpdate(dt) {
    const pickers = [P, ...remotes].filter(e => e.alive && !(e === P ? VEH.riding : VEH.rides(e.id)));
    for (const it of items) {
      if (it.holder) { // carried: it follows them; if they've gone or died, it falls where they were
        const e = entOf(it.holder);
        if (!e || !e.alive || (e !== P && !remotes.includes(e))) {
          if (e && e.pos) it.pos.copy(e.pos).add(new V3((Math.random() - 0.5) * 1.2, 0, (Math.random() - 0.5) * 1.2));
          const g = groundAt(it.pos.x, it.pos.z, it.pos.y + 1); if (g !== null) it.pos.y = g;
          it.holder = null; it.hand = false; it.noPick = null; sendT = 0;
          if (e === P) RANGE.loseItem(it.u);
        } else it.pos.copy(e.pos);
        continue;
      }
      if (it.noPick) { const e = entOf(it.noPick); if (!e || !near(e, it.pos) || !e.alive) it.noPick = null; } // you dropped it: step off it first
      for (const e of pickers) {
        if (e.id === it.noPick || !near(e, it.pos)) continue;
        if (it.kind !== 'spray' ? carried(e.id, it.kind) > 0 : (e === P ? RANGE.handsUsed() : (e.inv || []).length + carried(e.id)) >= 3) continue; // one flashlight each
        if (e === P) { if (!RANGE.giveItem(it.u)) continue; }
        else sendTo(e, { t: 'itg', u: it.u });
        it.holder = e.id; it.hand = false; sendT = 0;
        break;
      }
    }
    // Whose flashlights are on: yours, the guests' (as they say), the bots' at night
    lit.clear();
    if (RANGE.lightOn()) lit.add('h');
    for (const r of remotes) if (r.alive && guestLit.has(r.id)) lit.add(r.id);
    if (DAY.dark) for (const b of ents) if (b.bot && b.alive) lit.add(b.id);
    if ((sendT -= dt) <= 0 && remotes.length) {
      sendT = 0.15;
      broadcast({ t: 'its', l: items.map(it => [it.u, it.holder || '', +it.pos.x.toFixed(2), +it.pos.y.toFixed(2), +it.pos.z.toFixed(2), it.hand ? 1 : 0]), vo: VEH.lampsOff(), // (vo: vehicles with their headlights out)
        fl: [...lit], td: DAY.on ? +DAY.p.toFixed(5) : null }); // (fl: whose flashlights are on; td: the time of day)
    }
  }
  function hostMsg(r, m) {
    const it = byU(String(m.u || ''));
    if (m.t === 'itd') { // a guest put it down (or couldn't take it)
      if (!it || it.holder !== r.id) return;
      const p = Array.isArray(m.p) && m.p.length === 3 && m.p.every(Number.isFinite) ? new V3(m.p[0], m.p[1], m.p[2]) : null;
      it.pos.copy(p && p.distanceTo(r.pos) < 4 ? p : r.pos); it.holder = null; it.hand = false; it.noPick = r.id; sendT = 0;
    } else if (m.t === 'wash') { // a guest in the shower
      if (on() && r.alive && inShower(r)) { washed(r.id); broadcast({ t: 'wa', id: r.id }); }
    } else if (m.t === 'ith') { // its flashlight: on or off; and the headlights of what it drives (h: [vehicle, on])
      if (m.l) guestLit.add(r.id); else guestLit.delete(r.id);
      const v = Array.isArray(m.h) && VEH.list && VEH.list[m.h[0] | 0]; if (v && v.owner === r.id) v.lamp = !!m.h[1];
    }
  }

  // ---------------------------------------------------------------- a guest
  let lastHand = '';
  function guestMsg(m) {
    if (m.t === 'itg') { // the host says it's yours
      const it = byU(String(m.u || '')); if (!it) return;
      if (RANGE.giveItem(it.u)) { it.holder = meId(); it.givenAt = performance.now(); }
      else if (NET.conn && NET.conn.open) NET.conn.send({ t: 'itd', u: it.u, p: [P.pos.x, P.pos.y, P.pos.z] }); // no room after all
      return;
    }
    if (!Array.isArray(m.l)) return;
    if (Array.isArray(m.vo)) VEH.setLamps(m.vo.filter(Number.isInteger));
    if (Array.isArray(m.fl)) { lit.clear(); for (const id of m.fl) if (typeof id === 'string') lit.add(id); }
    if (Number.isFinite(m.td) && DAY.on) { const d = ((m.td - DAY.p + 1.5) % 1) - 0.5; DAY.p = (DAY.p + d + 1) % 1; } // (the host's time; it went on a moment while this was on its way, too little to matter)
    for (const x of m.l) {
      if (!Array.isArray(x)) continue;
      const it = byU(String(x[0])); if (!it) continue;
      it.holder = x[1] ? String(x[1]) : null; it.hand = !!x[5];
      if ([x[2], x[3], x[4]].every(Number.isFinite)) it.pos.set(x[2], x[3], x[4]);
    }
    // anything the host says isn't ours any more goes (a moment's grace for one just handed over)
    const now = performance.now();
    for (const u of RANGE.items()) { const it = byU(u); if (it && it.holder !== meId() && now - it.givenAt > 1500) RANGE.loseItem(u); }
  }
  function guestUpdate() {
    const lit = RANGE.lightOn(), v = VEH.driving && VEH.driving(), key = (lit ? 'on' : 'off') + (v ? v.i + (v.lamp ? '+' : '-') : '');
    if (key !== lastHand && NET.conn && NET.conn.open) { lastHand = key; NET.conn.send(Object.assign({ t: 'ith', l: lit ? 1 : 0 }, v ? { h: [v.i, v.lamp ? 1 : 0] } : {})); }
  }

  // Q with an item in your hands (range.js has already taken it out of them)
  function drop(u) {
    const it = byU(u); if (!it) return;
    const p = dropSpot(P, 1.2);
    if (NET.role === 'guest') { if (NET.conn && NET.conn.open) NET.conn.send({ t: 'itd', u, p: [p.x, p.y, p.z] }); it.holder = null; it.pos.copy(p); return; }
    it.pos.copy(p); it.holder = null; it.hand = false; it.noPick = 'h'; sendT = 0;
    note('Dropped the spray can', 1);
  }

  // ---------------------------------------------------------------- flashlights and headlights
  // Each lit one: a cone, from its holder's eyes the way they look, or from a headlight (vehicles.js) ahead and a little down.
  // What the light can see is drawn from there, depth only, into one tile of a small target (FLASH.depth, four tiles across,
  // two down): the level, the props, the vehicles and everyone but the holder, so the cone stops at what you see (walls,
  // corners, posts, people), not at the walking shapes. More than FLASH_MAX at once: the ones nearest you
  const FAR = 28, LAMP_FAR = 40, RES = 256, COLS = 4, _d = new V3(), _o = new V3(), _q = new THREE.Quaternion(), _eu = new THREE.Euler(0, 0, 0, 'YXZ');
  const target = new THREE.WebGLRenderTarget(RES * COLS, RES * 2, { depthBuffer: true, stencilBuffer: false });
  target.depthTexture = new THREE.DepthTexture(RES * COLS, RES * 2); target.depthTexture.type = THREE.UnsignedIntType;
  target.depthTexture.minFilter = target.depthTexture.magFilter = THREE.NearestFilter; target.texture.generateMipmaps = false;
  FLASH.depth.value = target.depthTexture; FLASH.texel.value.set(1 / (RES * COLS), 1 / (RES * 2));
  // Depth only, both sides (a wall seen from behind still blocks). Two of them: three.js r128 makes a material's shader for the
  // first thing it draws and never looks again at whether the next one is skinned, so one material for the level and the
  // bodies drew the bodies in their rest pose (a T). Bodies get the skinned one, mesh by mesh, so their shadows take their pose
  const depthOpts = { colorWrite: false, side: THREE.DoubleSide };
  const depthMat = new THREE.MeshBasicMaterial(depthOpts), depthSkin = new THREE.MeshBasicMaterial(Object.assign({ skinning: true }, depthOpts));
  depthMat.onBeforeCompile = depthSkin.onBeforeCompile = () => {}; // (not the flashlight's own shader: it reads the target it's drawing into)
  const cams = [...Array(FLASH_MAX)].map(() => new THREE.PerspectiveCamera(46, 1, FLASH_NEAR, FAR)); // (46°: the cone, 41°, with a little over)
  function aimOf(e, o, d) {
    if (e === P) { o.copy(myEye); d.set(0, 0, -1).applyQuaternion(_q.setFromEuler(_eu.set(P.pitch, P.yaw, 0, 'YXZ'))); return; }
    const cp = Math.cos(e.pitch || 0);
    o.set(e.pos.x, e.pos.y + (e.h || 1.8) * 0.85, e.pos.z);
    d.set(Math.sin(e.yaw) * cp, Math.sin(e.pitch || 0), Math.cos(e.yaw) * cp).normalize();
  }
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
  const beams = [];
  function updateBeams() {
    beams.length = 0;
    if (on()) {
      for (const e of ents) {
        if (!e.alive || !(e === P ? RANGE.lightOn() : lit.has(e.id))) continue;
        if (e === P ? VEH.driving && VEH.driving() : (VEH.list || []).some(v => v.owner === e.id)) continue; // a driver's light is the headlights
        const o = new V3(), d = new V3(); aimOf(e, o, d); beams.push({ o, d, far: FAR, skip: e, veh: null });
      }
      for (const b of VEH.lampBeams ? VEH.lampBeams() : []) beams.push({ o: b.o, d: b.d, far: LAMP_FAR, skip: null, veh: b.v });
      if (beams.length > FLASH_MAX) { const c = camera.position; beams.sort((a, b) => a.o.distanceToSquared(c) - b.o.distanceToSquared(c)); beams.length = FLASH_MAX; }
    }
    FLASH.n.value = 0; if (!beams.length) return; // (no light while its own map is drawn)
    const rt = renderer.getRenderTarget(), au = renderer.shadowMap.autoUpdate, ac = renderer.autoClear;
    renderer.shadowMap.autoUpdate = false; renderer.autoClear = false;
    try {
      beams.forEach((b, i) => {
        const cam = cams[i]; if (cam.far !== b.far) { cam.far = b.far; cam.updateProjectionMatrix(); }
        cam.position.copy(b.o); cam.lookAt(b.o.x + b.d.x, b.o.y + b.d.y, b.o.z + b.d.z); cam.updateMatrixWorld();
        target.viewport.set((i % COLS) * RES, Math.floor(i / COLS) * RES, RES, RES); target.scissor.copy(target.viewport); target.scissorTest = true;
        renderer.setRenderTarget(target); renderer.clear(false, true, false);
        drawDepth(levelGroup, cam); drawDepth(propGroup, cam);
        for (const v of VEH.list || []) if (v !== b.veh && v.g) drawBody(v.g, cam);
        for (const o of ents) if (o !== b.skip && o.alive) drawBody(o === P ? P.rig && P.rig.wrap : o.mesh, cam);
        FLASH.mat.value[i].multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
        FLASH.pos.value[i].copy(b.o); FLASH.dir.value[i].copy(b.d); FLASH.far.value[i] = b.far;
      });
    } finally { renderer.setRenderTarget(rt); renderer.shadowMap.autoUpdate = au; renderer.autoClear = ac; }
    FLASH.n.value = beams.length;
  }

  // ---------------------------------------------------------------- the shower
  // A tray, a pipe up the wall to a head, taps and a curtain on a rail. Stand in it and E washes every bit of paint off you
  // (art.js forgets it, for everyone, players who join later too). A guest asks the host, who checks they're in it and tells
  // everyone; the water runs for whoever washes, where everyone can see it
  const WASH_R = 0.9, WATER_T = 2.2;
  let shower = null; // { at: V3 (the middle of the tray, on the floor), g: the mesh, water, t: how long the water still runs }
  function showerMesh() {
    const g = new THREE.Group(), m = c => toonMat({ color: c });
    const chrome = m(0xaab2b8), add = (geo, mat, x, y, z) => { const o = new THREE.Mesh(geo, mat); o.position.set(x, y, z); o.castShadow = true; g.add(o); return o; };
    // (built facing -z with the wall behind at +z; the level's yaw turns it)
    add(new THREE.BoxGeometry(1.0, 0.07, 1.0), m(0xdfe6ea), 0, 0.035, 0).receiveShadow = true;
    add(new THREE.CylinderGeometry(0.06, 0.06, 0.012, 16), m(0x3a3f44), 0, 0.075, 0.05);
    add(new THREE.CylinderGeometry(0.022, 0.022, 2.2, 10), chrome, 0, 1.1, 0.45);
    add(new THREE.CylinderGeometry(0.018, 0.018, 0.34, 8).rotateX(Math.PI / 2), chrome, 0, 2.2, 0.28);
    add(new THREE.CylinderGeometry(0.06, 0.1, 0.05, 16), chrome, 0, 2.16, 0.11);
    [[-0.09, 0xc8463a], [0.09, 0x3a6ec8]].forEach(([x, c]) => add(new THREE.CylinderGeometry(0.035, 0.035, 0.05, 10).rotateX(Math.PI / 2), m(c), x, 1.15, 0.41));
    for (const [x, z, w, d] of [[0, -0.5, 1.02, 0.025], [-0.5, 0, 0.025, 1.0], [0.5, 0, 0.025, 1.0]]) add(new THREE.BoxGeometry(w, 0.025, d), chrome, x, 2.3, z);
    const curtain = add(new THREE.BoxGeometry(0.02, 1.85, 0.95), m(0x8fbcd0), -0.49, 1.33, -0.02); curtain.material.side = THREE.DoubleSide;
    // the water: streaks falling from the head to the tray
    const N = 36, pos = new Float32Array(N * 6), geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const water = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xcfeaff, transparent: true, opacity: 0.7 }));
    water.frustumCulled = false; water.visible = false; water.userData.seed = [...Array(N)].map(() => [Math.random() * 0.16 - 0.08, Math.random() * 0.16 - 0.08, Math.random()]);
    g.add(water);
    return { g, water };
  }
  function placeShower() {
    if (shower) { scene.remove(shower.g); shower = null; }
    const d = typeof LV !== 'undefined' && LV && LV.shower; if (!d) return;
    const { g, water } = showerMesh(); g.position.set(d[0], d[1], d[2]); g.rotation.y = d[3] || 0; scene.add(g);
    shower = { at: new V3(d[0], d[1], d[2]), g, water, t: 0 };
  }
  const inShower = e => !!shower && !!e && Math.hypot(e.pos.x - shower.at.x, e.pos.z - shower.at.z) < WASH_R && Math.abs(e.pos.y - shower.at.y) < 1.2;
  const nearShower = () => on() && P.alive && !VEH.riding && inShower(P);
  let washT = 0;
  function useShower() {
    if (!nearShower() || washT > 0) return false;
    washT = 1;
    if (NET.role === 'host') { washed('h'); broadcast({ t: 'wa', id: 'h' }); }
    else { if (NET.conn && NET.conn.open) NET.conn.send({ t: 'wash' }); runWater(); }
    return true;
  }
  function washed(id) { // the paint off whoever it is, and the water on
    const e = entOf(id); ART.wash(e, id);
    runWater(); if (e === P) note('All clean', 1.5);
  }
  function runWater() {
    if (!shower) return;
    shower.t = WATER_T;
    if (typeof AC !== 'undefined' && AC && typeof noiseBuf !== 'undefined') { const v = vol(shower.at, 30); if (v > 0.02) for (let k = 0; k < 4; k++) noise(AC.currentTime + k * 0.5, 0.7, 0.05 * v, 7000, 4000); }
  }
  function waterTick(dt) {
    if (mirror) mirror.g.visible = on();
    if (!shower) return;
    shower.g.visible = on();
    washT = Math.max(0, washT - dt);
    const w = shower.water; w.visible = shower.t > 0 && on(); if (!w.visible) return;
    shower.t -= dt;
    const p = w.geometry.attributes.position, now = performance.now() / 1000, top = 2.12;
    w.userData.seed.forEach(([x, z, ph], i) => {
      const f = (now * 1.6 + ph) % 1, y = top - f * (top - 0.1), sp = 1 + f * 2.2; // a streak falls and spreads a little
      p.setXYZ(i * 2, x * sp, y, 0.11 + z * sp); p.setXYZ(i * 2 + 1, x * sp, Math.max(0.08, y - 0.28), 0.11 + z * sp);
    });
    p.needsUpdate = true; w.material.opacity = 0.7 * Math.min(1, shower.t / 0.4);
  }

  // ---------------------------------------------------------------- the mirror
  // three.js's Reflector: before the mirror is drawn, a second camera, the main one flipped across the mirror's plane, draws
  // the scene into a picture the mirror shows. That's a second view of the scene, so it's only drawn when the mirror is in
  // view (three.js leaves out what's off screen), from the main camera, near enough to see (MIRROR_NEAR). In first person
  // your own body is never drawn (it only casts a shadow): for the reflection it is, with what's in your hands and on your back
  const MIRROR_NEAR = 16;
  let mirror = null;
  function placeMirror() {
    if (mirror) { scene.remove(mirror.g); mirror.glass.getRenderTarget().dispose(); mirror = null; }
    const d = typeof LV !== 'undefined' && LV && LV.mirror; if (!d || !THREE.Reflector) return;
    const [x, y, z, yaw, w, h] = d, g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = yaw;
    const px = Math.min(2, devicePixelRatio || 1) * 300;
    const glass = new THREE.Reflector(new THREE.PlaneGeometry(w, h), { textureWidth: Math.round(px * w), textureHeight: Math.round(px * h), color: 0xb8bcc0, clipBias: 0.003 });
    glass.position.z = 0.025; g.add(glass);
    const frame = toonMat({ color: 0x5b4632 });
    for (const [fw, fh, fx, fy] of [[w + 0.1, 0.05, 0, (h + 0.05) / 2], [w + 0.1, 0.05, 0, -(h + 0.05) / 2], [0.05, h, (w + 0.05) / 2, 0], [0.05, h, -(w + 0.05) / 2, 0]]) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(fw, fh, 0.04), frame); b.position.set(fx, fy, 0.02); b.castShadow = true; g.add(b);
    }
    const draw = glass.onBeforeRender;
    glass.onBeforeRender = function (r, sc, cam, ...rest) {
      if (cam !== camera || !on() || cam.position.distanceTo(g.position) > MIRROR_NEAR) return;
      const undo = showSelf();
      try { draw.call(this, r, sc, cam, ...rest); } finally { undo(); }
    };
    scene.add(g); mirror = { g, glass };
  }
  // Your body, your gun and your gear drawn for a moment (whatever they were before comes back after)
  function showSelf() {
    const r = P.rig; if (!r || !P.alive) return () => {};
    const was = r.body.map(o => [o.material.colorWrite, o.material.depthWrite]), gv = r.gunVis && r.gunVis.visible, gr = r.gear && r.gear.visible;
    for (const o of r.body) { o.material.colorWrite = true; o.material.depthWrite = true; }
    if (r.gunVis && !r.hideHeld) r.gunVis.visible = true; if (r.gear) r.gear.visible = true;
    return () => { r.body.forEach((o, i) => { o.material.colorWrite = was[i][0]; o.material.depthWrite = was[i][1]; }); if (r.gunVis) r.gunVis.visible = gv; if (r.gear) r.gear.visible = gr; };
  }

  // ---------------------------------------------------------------- what you see
  function after(dt) {
    waterTick(dt);
    const live = on(), now = performance.now();
    for (const it of items) {
      if (!it.mesh) continue;
      it.mesh.visible = live && !it.holder;
      if (it.mesh.visible) { it.mesh.position.set(it.pos.x, it.pos.y + 0.55 + Math.sin(now / 350 + it.home.x) * 0.06, it.pos.z); it.mesh.rotation.y += dt * 1.5; }
    }
    updateBeams();
  }
  function update(dt) {
    if (!on()) return;
    if (!built) { if (!READY || (LV && LV.mesh && !TG)) return; onLevel(); } // (once the level is in: its spots and ground aren't ready before)
    if (NET.role === 'host') hostUpdate(dt); else guestUpdate();
  }

  // ---------------------------------------------------------------- for the computer's map
  const mapMarks = () => (on() ? items.map(it => ({ kind: it.kind, colour: it.kind === 'spray' ? PAINT[it.c] : '#ffd23f', x: it.pos.x, z: it.pos.z })) : []);

  Object.defineProperty(ITEMS, 'on', { get: on, configurable: true });
  Object.assign(ITEMS, { update, after, drop, onLevel, reset, hostMsg, guestMsg, mapMarks, nearShower, useShower, washed });
})();
