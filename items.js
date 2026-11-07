// ?dev items: things to find in the level that aren't guns. The host keeps track of every one (where it lies, who has it)
// and tells everyone; a player picks one up by walking over it, as with a weapon.
//   - Spray cans: one per colour (art.js's six), each a thing on its own, so a picture in several colours takes some
//     finding. One takes a hand (range.js); click sprays, right-click draws a fine line.
//   - Flashlights (FLASHLIGHTS of them): don't take a hand; L turns yours on and off, whatever you hold, so you can see and
//     shoot in the dark. A cone from your eyes shows what it falls on in its own colours, with none of the light and shadow
//     (the shaders' flashAt, index.html), and each cone has a small shadow map so it stops at what's really in the way.
//   - Radios (RADIOS of them): don't take a hand either. With proximity voice chat on, two people carrying radios hear each
//     other wherever they are.
// Whatever someone carries drops where they die. A new round puts everything back where it started.
// Loaded after the main game script, range.js and art.js; it uses their globals (scene, P, ents, NET, RANGE, ART, ...).
// The game calls into ITEMS (declared in index.html) from its loop, network, voice and the computer's map.
(() => {
  const FLASHLIGHTS = 4, RADIOS = 4, SPRAYS = 6;
  const PAINT = ['#B06455', '#E1B559', '#5A6490', '#455533', '#000000', '#FFFFFF']; // art.js's palette, in its order
  // Their ids: s0-s5 the cans (by colour), f0-f3 the flashlights, r0-r3 the radios. The order they're laid out in, so each
  // kind ends up spread across the level
  const ORDER = ['s0', 'f0', 's1', 'r0', 's2', 'f1', 's3', 'r1', 's4', 'f2', 's5', 'r2', 'f3', 'r3'].filter(u => +u.slice(1) < { s: SPRAYS, f: FLASHLIGHTS, r: RADIOS }[u[0]]);
  const kindOf = u => ({ s: 'spray', f: 'light', r: 'radio' }[u[0]]);
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
  function radioMesh() {
    const g = new THREE.Group(), box = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.13, 0.035), mat(0x3a4a3a));
    const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.12, 6), mat(0x111111));
    const grill = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.04, 0.004), mat(0x1c1c1c));
    ant.position.set(0.024, 0.12, 0); grill.position.set(0, 0.02, 0.019);
    [box, ant, grill].forEach(m => { m.castShadow = true; g.add(m); });
    return g;
  }
  function groundMesh(u) {
    const k = kindOf(u), o = new THREE.Group();
    if (k === 'spray') { const c = ART.heldObject('spray', +u.slice(1)); if (c) { c.scale.setScalar(2.4); o.add(c); } }
    else if (k === 'light') { const l = lightMesh(); l.scale.setScalar(2.4); l.rotation.y = Math.PI / 2; o.add(l); }
    else { const r = radioMesh(); r.scale.setScalar(2.4); o.add(r); }
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
    build();
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
        if (it.kind !== 'spray' ? carried(e.id, it.kind) > 0 : (e === P ? RANGE.handsUsed() : (e.inv || []).length + carried(e.id)) >= 3) continue; // one radio and one flashlight each
        if (e === P) { if (!RANGE.giveItem(it.u)) continue; }
        else sendTo(e, { t: 'itg', u: it.u });
        it.holder = e.id; it.hand = false; sendT = 0;
        break;
      }
    }
    // your own flashlight: on or off
    const lit = RANGE.lightOn();
    for (const it of items) if (it.holder === 'h' && it.kind === 'light') it.hand = lit;
    if ((sendT -= dt) <= 0 && remotes.length) {
      sendT = 0.15;
      broadcast({ t: 'its', l: items.map(it => [it.u, it.holder || '', +it.pos.x.toFixed(2), +it.pos.y.toFixed(2), +it.pos.z.toFixed(2), it.hand ? 1 : 0]) });
    }
  }
  function hostMsg(r, m) {
    const it = byU(String(m.u || ''));
    if (m.t === 'itd') { // a guest put it down (or couldn't take it)
      if (!it || it.holder !== r.id) return;
      const p = Array.isArray(m.p) && m.p.length === 3 && m.p.every(Number.isFinite) ? new V3(m.p[0], m.p[1], m.p[2]) : null;
      it.pos.copy(p && p.distanceTo(r.pos) < 4 ? p : r.pos); it.holder = null; it.hand = false; it.noPick = r.id; sendT = 0;
    } else if (m.t === 'ith') { // its flashlight: on or off
      for (const x of items) if (x.holder === r.id && x.kind === 'light') x.hand = !!m.l;
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
    const lit = RANGE.lightOn(), key = lit ? 'on' : 'off';
    if (key !== lastHand && NET.conn && NET.conn.open) { lastHand = key; NET.conn.send({ t: 'ith', l: lit ? 1 : 0 }); }
    for (const it of items) if (it.holder === meId() && it.kind === 'light') it.hand = lit; // (yours shows at once)
  }

  // Q with an item in your hands (range.js has already taken it out of them)
  function drop(u) {
    const it = byU(u); if (!it) return;
    const p = dropSpot(P, 1.2);
    if (NET.role === 'guest') { if (NET.conn && NET.conn.open) NET.conn.send({ t: 'itd', u, p: [p.x, p.y, p.z] }); it.holder = null; it.pos.copy(p); return; }
    it.pos.copy(p); it.holder = null; it.hand = false; it.noPick = 'h'; sendT = 0;
    note('Dropped the spray can', 1);
  }

  // ---------------------------------------------------------------- flashlights
  // Each lit one: a cone from its holder's eyes the way they look. What the light can see is drawn from there, depth only,
  // into one quarter of a small target (FLASH.depth): the level, the props and everyone but the holder, so the cone stops at
  // what you see (walls, corners, posts, people), not at the walking shapes
  const FAR = 28, RES = 256, _d = new V3(), _o = new V3(), _q = new THREE.Quaternion(), _eu = new THREE.Euler(0, 0, 0, 'YXZ');
  const target = new THREE.WebGLRenderTarget(RES * 2, RES * 2, { depthBuffer: true, stencilBuffer: false });
  target.depthTexture = new THREE.DepthTexture(RES * 2, RES * 2); target.depthTexture.type = THREE.UnsignedIntType;
  target.depthTexture.minFilter = target.depthTexture.magFilter = THREE.NearestFilter; target.texture.generateMipmaps = false;
  FLASH.depth.value = target.depthTexture; FLASH.texel.value = 1 / (RES * 2);
  // one material for all of it: depth only, both sides (a wall seen from behind still blocks), bodies posed (skinning only
  // takes on a skinned mesh)
  const depthMat = new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide, skinning: true });
  depthMat.onBeforeCompile = () => {}; // (not the flashlight's own shader: it reads the target it's drawing into)
  const cams = [...Array(FLASH_MAX)].map(() => new THREE.PerspectiveCamera(46, 1, FLASH_NEAR, FAR)); // (46°: the cone, 41°, with a little over)
  function aimOf(e, o, d) {
    if (e === P) { o.copy(myEye); d.set(0, 0, -1).applyQuaternion(_q.setFromEuler(_eu.set(P.pitch, P.yaw, 0, 'YXZ'))); return; }
    const cp = Math.cos(e.pitch || 0);
    o.set(e.pos.x, e.pos.y + (e.h || 1.8) * 0.85, e.pos.z);
    d.set(Math.sin(e.yaw) * cp, Math.sin(e.pitch || 0), Math.cos(e.yaw) * cp).normalize();
  }
  // Draw a group as if it were a scene, with the depth material over everything (only a scene takes an override)
  function drawDepth(root, cam) {
    if (!root || !root.visible) return;
    const was = root.isScene; root.isScene = true; root.overrideMaterial = depthMat;
    try { renderer.render(root, cam); } finally { root.isScene = was; delete root.overrideMaterial; }
  }
  function updateBeams() {
    const lit = [];
    if (on()) for (const it of items) {
      if (it.kind !== 'light' || !it.holder || !it.hand || lit.length >= FLASH_MAX) continue;
      const e = entOf(it.holder); if (e && e.alive) lit.push(e);
    }
    FLASH.n.value = 0; if (!lit.length) return; // (no light while its own map is drawn)
    const rt = renderer.getRenderTarget(), au = renderer.shadowMap.autoUpdate, ac = renderer.autoClear;
    renderer.shadowMap.autoUpdate = false; renderer.autoClear = false;
    lit.forEach((e, i) => {
      aimOf(e, _o, _d);
      const cam = cams[i]; cam.position.copy(_o); cam.lookAt(_o.x + _d.x, _o.y + _d.y, _o.z + _d.z); cam.updateMatrixWorld();
      target.viewport.set((i % 2) * RES, (i >> 1) * RES, RES, RES); target.scissor.copy(target.viewport); target.scissorTest = true;
      renderer.setRenderTarget(target); renderer.clear(false, true, false);
      drawDepth(levelGroup, cam); drawDepth(propGroup, cam);
      for (const o of ents) if (o !== e && o.alive) drawDepth(o === P ? P.rig && P.rig.wrap : o.mesh, cam);
      FLASH.mat.value[i].multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
      FLASH.pos.value[i].copy(_o); FLASH.dir.value[i].copy(_d); FLASH.far.value[i] = FAR;
    });
    renderer.setRenderTarget(rt); renderer.shadowMap.autoUpdate = au; renderer.autoClear = ac;
    FLASH.n.value = lit.length;
  }

  // ---------------------------------------------------------------- what you see
  function after(dt) {
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
    if (!built) { if (!READY) return; onLevel(); } // (once the level is in: its spots and ground aren't ready before)
    if (NET.role === 'host') hostUpdate(dt); else guestUpdate();
  }

  // ---------------------------------------------------------------- for the computer's map and the voice chat
  const mapMarks = () => (on() ? items.filter(it => it.kind !== 'radio').map(it => ({ kind: it.kind, colour: it.kind === 'spray' ? PAINT[it.c] : '#ffd23f', x: it.pos.x, z: it.pos.z })) : []);
  const radioOf = id => items.some(it => it.kind === 'radio' && it.holder === id);
  const radioPair = e => on() && !!e && radioOf(meId()) && radioOf(e.id);

  Object.defineProperty(ITEMS, 'on', { get: on, configurable: true });
  Object.assign(ITEMS, { update, after, drop, onLevel, reset, hostMsg, guestMsg, mapMarks, radioPair });
})();
