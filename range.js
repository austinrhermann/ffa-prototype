// Shooting Range: one player with every weapon and infinite ammo, dummies down the lanes, and a Tab panel to dial the
// weapons in. It runs the simpler weapon system the other games are moving to:
//   - Everyone has 20 health, shown as a colour from blue (full) to red (1 left). Every hit does a whole number of damage.
//   - Five guns (Pistol and Carbine take A batteries, Izu and Battery Gun take B batteries, the Master Rifle its own rounds),
//     each set by the same few numbers: body and head damage, spread, spread growth (the only recoil), rate, clip, pellets.
//   - One explosive used three ways: thrown, set as a mine, or fired from the tube. A blast does 7 in its centre ring and
//     one less in each ring out; walls block it, and it hurts anyone in reach (you too).
//   - The knife is a weapon you switch to, like the others: 4 from the front, a kill from behind.
// Loaded after the main game script, so it uses the game's globals (scene, camera, P, keys, WEAPONS, VMW, gun, ...).
// The game calls into RANGE (declared in index.html) from its loop, input and blasts; nothing changes outside the range.
(() => {
  // ---------------------------------------------------------------- the weapons and their settings
  const HP = 20;
  // Health colours, from 1 left (red) to full (blue), James's ten; the health in between gets a blend of its two neighbours
  const HEALTH = ['#e51c1c', '#ff3300', '#ff6600', '#ff9900', '#ffcc00', '#9cc00d', '#4da823', '#289751', '#0d88aa', '#0066cc'].map(c => new THREE.Color(c));
  const _hc = new THREE.Color();
  function hpColour(h) {
    if (h <= 0) return '#2a2a2a';
    const f = (Math.min(HP, h) - 1) / (HP - 1) * (HEALTH.length - 1), i = Math.floor(f);
    return '#' + _hc.copy(HEALTH[i]).lerp(HEALTH[Math.min(i + 1, HEALTH.length - 1)], f - i).getHexString();
  }
  // The weapon in each slot (1-9). model: which gun the game draws and plays the sounds of.
  const SLOTS = [
    { id: 'pistol', name: 'Pistol', kind: 'gun', model: 'pistol', ammo: 'A battery' },
    { id: 'carbine', name: 'Carbine', kind: 'gun', model: 'carbine', ammo: 'A battery' },
    { id: 'izu', name: 'Izu', kind: 'gun', model: 'uzi', ammo: 'B battery' },
    { id: 'battery', name: 'Battery Gun', kind: 'gun', model: 'shotgun', ammo: 'B battery' },
    { id: 'rifle', name: 'Master Rifle', kind: 'gun', model: 'rifle', ammo: 'Rifle rounds' },
    { id: 'throw', name: 'Grenade', kind: 'throw', ammo: 'Explosive' },
    { id: 'mine', name: 'Mine', kind: 'mine', ammo: 'Explosive' },
    { id: 'tube', name: 'Tube', kind: 'tube', model: 'bazooka', ammo: 'Explosive' },
    { id: 'knife', name: 'Knife', kind: 'knife', ammo: '' },
  ];
  // Spread is how wide the shots land: spread N covers a circle N × 10 cm across at 10 m (twice that at 20 m).
  // grow: extra spread built up by holding the trigger (all of it after 8 shots in a row); it settles once you let go.
  const DEFAULTS = {
    guns: {
      pistol:  { body: 3, head: 5, spread: 3,  grow: 0, rate: 5,  clip: 8,  count: 1,  reload: 1.4, auto: false },
      carbine: { body: 3, head: 5, spread: 1,  grow: 0, rate: 4,  clip: 8,  count: 1,  reload: 2.0, auto: false },
      izu:     { body: 1, head: 2, spread: 4,  grow: 4, rate: 16, clip: 32, count: 1,  reload: 1.8, auto: true },
      battery: { body: 1, head: 1, spread: 14, grow: 0, rate: 2,  clip: 1,  count: 12, reload: 2.4, auto: false },
      rifle:   { body: 5, head: 7, spread: 0,   grow: 0, rate: 1,  clip: 1,  count: 1,  reload: 2.6, auto: false },
    },
    blast: { max: 7, ring: 1.1, show: true }, // max: damage in the centre ring; ring: width of each ring (m); show: draw them where a blast goes off
    throw: { fuse: 2.25 },                   // seconds from pulling the pin (hold to cook)
    mine: { arm: 1.5, radius: 2, warn: 1 },  // arms after placing; anyone within radius sets it off, then it beeps for warn seconds
    tube: { speed: 38, reload: 4.5 },        // rocket speed (m/s)
    knife: { front: 4, back: HP, reach: 2 },
    move: { walk: 1, run: 16, jump: 12, crouch: 0.55, aim: 0.45 }, // spread added walking, running, in the air; crouching and aiming multiply it
    targets: { strafe: 0, heal: 3 },         // strafe: lane dummies pace side to side at this speed (m/s); heal: damage wears off after this long
  };
  const clone = o => JSON.parse(JSON.stringify(o));
  const merge = (base, over) => { for (const k in base) if (over && over[k] !== undefined) { if (typeof base[k] === 'object') merge(base[k], over[k]); else if (typeof over[k] === typeof base[k]) base[k] = over[k]; } return base; };
  const SAVE = 'tse.range.v3';
  // Older saves: damage stays as it was tuned with 7 health (v1); the brief 10-health version (v2) scaled it up by 10/7, so
  // that comes back down. A knife from behind that killed then still kills.
  function oldSave() {
    const read = k => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } };
    let o = read('tse.range.v2'), was = 10;
    if (o) {
      const k = v => Math.max(1, Math.round(v * 7 / 10));
      for (const g of Object.values(o.guns || {})) for (const f of ['body', 'head']) if (typeof g[f] === 'number') g[f] = k(g[f]);
      if (o.knife && typeof o.knife.front === 'number') o.knife.front = k(o.knife.front);
      if (o.blast && typeof o.blast.ring === 'number') o.blast.ring = Math.round(o.blast.ring * 100 / 7) / 10;
    } else { o = read('tse.range.v1'); was = 7; }
    if (o && o.knife && typeof o.knife.back === 'number') o.knife.back = o.knife.back >= was ? HP : o.knife.back;
    return o;
  }
  const S = (() => { try { return merge(clone(DEFAULTS), JSON.parse(localStorage.getItem(SAVE) || 'null') || oldSave()); } catch (e) { return clone(DEFAULTS); } })();
  function save() { try { localStorage.setItem(SAVE, JSON.stringify(S)); } catch (e) {} }

  const on = () => MODE === 'range';
  let cur = 0, heat = 0, cooking = -1, beepT = 0, shotN = 0, panelOpen = false, built = false;
  const slot = () => SLOTS[cur];
  const gunOf = s => S.guns[s.id];
  const blastR = () => S.blast.max * S.blast.ring; // how far a blast reaches
  const ringDmg = d => d >= blastR() ? 0 : S.blast.max - Math.floor(d / S.blast.ring);

  // ---------------------------------------------------------------- the yard (built once, like Test Drive's stadium)
  function canvasTex(w, h, draw) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.anisotropy = 4; return t; }
  function speckle(base, spots, n) { const t = canvasTex(256, 256, (g, s) => { g.fillStyle = base; g.fillRect(0, 0, s, s); for (let i = 0; i < n; i++) { g.fillStyle = spots[i % spots.length]; const r = 1 + Math.random() * 1.5; g.fillRect(Math.random() * s, Math.random() * s, r, r); } }); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t; }
  const textTex = (txt, color = '#f4f1e6') => canvasTex(256, 96, (g, w, h) => { g.font = '700 64px system-ui,sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = color; g.fillText(txt, w / 2, h / 2); });
  // Lanes: [x, distance from the firing line (m)]; the line is z = 0 and the dummies stand down -z. Mixed up so that,
  // from the middle of the line, every dummy is in view and none stands in front of another.
  const LANES = [[-6, 30], [-3, 5], [0, 20], [3, 10], [6, 45]];
  // The blast pit: dummies set round a mark, measured to the nearest face of each; the last one stands behind a wall
  const PIT = { x: -26, z: -16 };
  const PIT_DUMMIES = [[0, 1.5, '1.5 m'], [3.5, 0, '3.5 m'], [-5.5, 0, '5.5 m'], [0, -3.5, 'behind a wall']];
  const decals = [];
  function buildYard() {
    const draw = new THREE.Group(), col = new THREE.Group(), cm = new THREE.MeshBasicMaterial();
    const both = o => { draw.add(o); const c = new THREE.Mesh(o.geometry, cm); c.position.copy(o.position); c.rotation.copy(o.rotation); col.add(c); };
    const box = (w, h, d, x, y, z, m) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); o.castShadow = o.receiveShadow = true; both(o); return o; };
    const decal = (w, d, m, x, y, z) => { const o = new THREE.Mesh(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2), m); o.position.set(x, y, z); o.receiveShadow = true; draw.add(o); return o; };
    const tiled = (tex, rep) => { tex.repeat.set(rep[0], rep[1]); return toonMat({ map: tex }); };
    // A black world on a grey floor: nothing to look at but the dummies
    const floor = tiled(speckle('#6c6c6c', ['#666666', '#727272', '#606060', '#787878'], 9000), [40, 40]);
    const wallM = toonMat({ color: 0x0c0c0c }), dirt = wallM;
    const paint = toonMat({ color: 0xece8dc }), sand = toonMat({ map: speckle('#4e4e4e', ['#484848', '#545454', '#444444'], 5000) });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(300, 300).rotateX(-Math.PI / 2), floor); ground.receiveShadow = true; both(ground);
    // The firing area: a concrete pad, the line, and the lane stripes out to the berm
    const pad = speckle('#8a8a8a', ['#848484', '#909090', '#7e7e7e'], 5000); pad.repeat.set(8, 3);
    decal(34, 10, toonMat({ map: pad }), 0, 0.012, 4);
    decal(30, 0.18, paint, 0, 0.022, 0);
    for (const x of [-7.5, -4.5, -1.5, 1.5, 4.5, 7.5]) decal(0.1, 52, paint, x, 0.018, -26);
    // Each lane's distance, at the firing line and at the dummy's feet
    for (const [x, d] of LANES) {
      const m = () => new THREE.MeshBasicMaterial({ map: textTex(d + ' m'), transparent: true, depthWrite: false });
      decal(2.2, 0.8, m(), x, 0.03, -1.1); decal(2.6, 1, m(), x, 0.03, -d + 1.2);
    }
    // The berm behind the dummies, and walls round the rest
    box(90, 7, 5, 0, 3.5, -63, dirt);
    for (const x of [-40, 40]) box(0.6, 3.5, 80, x, 1.75, -25, wallM);
    box(80, 3.5, 0.6, 0, 1.75, 15, wallM);
    // The blast pit: sand, a mark in the middle, and a wall between the mark and its last dummy
    const sandDisc = new THREE.Mesh(new THREE.CircleGeometry(9.5, 48).rotateX(-Math.PI / 2), sand); sandDisc.position.set(PIT.x, 0.01, PIT.z); sandDisc.receiveShadow = true; draw.add(sandDisc);
    const mark = new THREE.Mesh(new THREE.RingGeometry(0.25, 0.38, 24).rotateX(-Math.PI / 2), toonMat({ color: 0xc8302f })); mark.position.set(PIT.x, 0.035, PIT.z); draw.add(mark);
    box(2.6, 2.4, 0.3, PIT.x, 1.2, PIT.z - 2, wallM);
    decal(4, 1.3, new THREE.MeshBasicMaterial({ map: textTex('blast pit'), transparent: true, depthWrite: false }), PIT.x, 0.04, PIT.z + 8.2);
    draw.updateMatrixWorld(true); col.updateMatrixWorld(true);
    LEVEL_SCENES.RangeYard = draw; LEVEL_SCENES.RangeYard_col = col;
  }
  buildYard();

  // The damage rings, as a picture: the centre damage in the middle band, 1 in the outer one (scaled to the ring width;
  // redrawn when the centre damage changes)
  const ringTex = canvasTex(1024, 1024, () => {}), ringN = { n: 0 };
  function drawRings() {
    const n = S.blast.max; if (n === ringN.n) return; ringN.n = n;
    const g = ringTex.image.getContext('2d'), w = 1024, c = w / 2, step = c / n; g.clearRect(0, 0, w, w);
    for (let k = n; k >= 1; k--) { g.beginPath(); g.arc(c, c, k * step - 2, 0, Math.PI * 2); g.fillStyle = `rgba(255,${120 + Math.round(130 * k / n)},60,${0.05 + 0.25 * (n - k) / n})`; g.fill(); g.lineWidth = 5; g.strokeStyle = 'rgba(255,240,220,.85)'; g.stroke(); }
    g.font = `700 ${Math.min(46, Math.round(step * 0.7))}px system-ui,sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#fff';
    for (let k = 0; k < n; k++) g.fillText(String(n - k), c, c - (k + 0.5) * step);
    ringTex.needsUpdate = true;
  }
  drawRings();
  const ringGeo = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
  const ringMesh = () => new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ map: ringTex, transparent: true, depthWrite: false, opacity: 0.9 }));
  let pitRings = null;
  const flashes = []; // rings drawn where a blast went off, fading out
  function showRings(p) {
    if (!S.blast.show) return;
    const m = ringMesh(), g = groundAt(p.x, p.z, p.y + 0.5);
    m.position.set(p.x, (g === null ? p.y : g) + 0.05, p.z); m.scale.setScalar(blastR()); scene.add(m); flashes.push({ m, t: 2.5 });
  }

  // ---------------------------------------------------------------- dummies
  // Same hit zones as a player (makeBotMesh): legs and torso are body, the cube on top is the head. What you see is what you hit.
  const DUMMY = { body: 0xcdb991, head: 0xe0743c, hit: 0xffffff, dead: 0x4ccf5a };
  const dummies = [];
  function makeDummy(x, z, label, lane) {
    const t = { lane, label, home: new V3(x, 0, z), dmg: 0, dead: 0, lastT: 0, firstT: 0, shot0: 0, hits: 0, heads: 0, flashT: 0, last: '', dir: 1 };
    const g = new THREE.Group(), y0 = groundAt(x, z, 5); t.home.y = y0 === null ? 0 : y0; g.position.copy(t.home); t.g = g;
    t.mats = { body: toonMat({ color: DUMMY.body }), head: toonMat({ color: DUMMY.head }) };
    t.parts = [];
    const part = (w, h, d, y, p) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), t.mats[p]); o.position.y = y; o.castShadow = o.receiveShadow = true; o.userData = { rangeT: t, part: p, half: new V3(w / 2, h / 2, d / 2) }; g.add(o); t.parts.push(o); return o; };
    part(0.6, 0.8, 0.4, 0.4, 'body'); part(0.7, 0.72, 0.45, 1.16, 'body'); part(0.4, 0.4, 0.4, 1.72, 'head');
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.05, 0.6), toonMat({ color: 0x3e4247 })); base.position.y = 0.025; base.receiveShadow = true; g.add(base);
    // Health over its head: a circle in the health colour (as over a player's name), the last hit written under it
    const c = document.createElement('canvas'); c.width = 192; c.height = 192; t.ctx = c.getContext('2d'); t.tex = new THREE.CanvasTexture(c);
    t.pips = new THREE.Sprite(new THREE.SpriteMaterial({ map: t.tex, transparent: true, depthWrite: false })); t.pips.scale.set(0.9, 0.9, 1); t.pips.position.y = 2.45; g.add(t.pips);
    drawPips(t); scene.add(g); dummies.push(t);
    return t;
  }
  function drawPips(t) {
    const g = t.ctx, w = 192; g.clearRect(0, 0, w, w);
    g.beginPath(); g.arc(w / 2, 54, 40, 0, Math.PI * 2); g.fillStyle = hpColour(t.dead > 0 ? 0 : HP - t.dmg); g.fill();
    if (t.last) { g.font = '700 34px system-ui,sans-serif'; g.textAlign = 'center'; g.fillStyle = '#fff'; g.strokeStyle = 'rgba(0,0,0,.8)'; g.lineWidth = 6; g.strokeText(t.last, w / 2, 150); g.fillText(t.last, w / 2, 150); }
    t.tex.needsUpdate = true;
  }
  const tint = (t, k) => { for (const p of ['body', 'head']) t.mats[p].color.setHex(k || DUMMY[p]); };
  // Nearest distance from a point to the dummy's boxes (0 inside)
  function distTo(t, p) {
    let best = Infinity;
    for (const o of t.parts) { const h = o.userData.half, cx = t.g.position.x, cy = t.g.position.y + o.position.y, cz = t.g.position.z;
      const dx = Math.max(Math.abs(p.x - cx) - h.x, 0), dy = Math.max(Math.abs(p.y - cy) - h.y, 0), dz = Math.max(Math.abs(p.z - cz) - h.z, 0); best = Math.min(best, Math.hypot(dx, dy, dz)); }
    return best;
  }
  const centres = t => t.parts.map(o => new V3(t.g.position.x, t.g.position.y + o.position.y, t.g.position.z));
  let lastKill = '', history = [];
  // n, nh: how many hits (pellets) and head hits this was; unit: what one use of the weapon is called
  function hitDummy(t, dmg, head, src, n = 1, nh = head ? 1 : 0, unit = 'shot') {
    if (t.dead > 0 || dmg <= 0) return;
    const now = performance.now() / 1000;
    if (!t.dmg) { t.firstT = now; t.shot0 = shotN; t.hits = 0; t.heads = 0; }
    t.dmg = Math.min(HP, t.dmg + dmg); t.hits += n; t.heads += nh; t.lastT = now; t.flashT = 0.07;
    t.last = `+${dmg}${head ? ' head' : ''}`;
    if (t.dmg >= HP) {
      t.dead = 1.1; tint(t, DUMMY.dead);
      const shots = shotN - t.shot0 + 1, secs = now - t.firstT;
      lastKill = `<b>${t.label}</b> down with the ${src}: ${plural(shots, unit)}, ${plural(t.hits, n > 1 ? 'pellet' : 'hit')}${n > 1 ? ' on it' : ''}${t.heads ? ` (${t.heads} head)` : ''}, ${secs < 0.005 ? 'instant' : secs.toFixed(2) + ' s'}`;
      history.unshift(lastKill); history = history.slice(0, 4);
    } else tint(t, DUMMY.hit);
    drawPips(t);
  }
  function resetDummy(t) { t.dmg = 0; t.dead = 0; t.last = ''; t.hits = t.heads = 0; tint(t); drawPips(t); }
  function buildDummies() {
    for (const [x, d] of LANES) makeDummy(x, -d, `${d} m dummy`, true);
    for (const [dx, dz, label] of PIT_DUMMIES) { // placed so the gap from the mark to the nearest face is the label's distance
      const x = PIT.x + (dx ? dx + Math.sign(dx) * 0.35 : 0), z = PIT.z + (dz ? dz + Math.sign(dz) * 0.225 : 0);
      makeDummy(x, z, `Pit dummy (${label})`, false);
    }
  }

  // ---------------------------------------------------------------- mines
  const mines = [];
  function placeMine() {
    const q = aimQ(), dir = new V3(0, 0, -1).applyQuaternion(q);
    ray.set(camera.position, dir); ray.far = 3.5;
    const hit = ray.intersectObjects([...W.meshes, ...W.floors], false)[0];
    let p;
    if (hit && hit.face && hit.face.normal.y > 0.5) p = hit.point.clone();
    else { const fx = -Math.sin(P.yaw), fz = -Math.cos(P.yaw), x = P.pos.x + fx * 1.2, z = P.pos.z + fz * 1.2, gy = groundAt(x, z, P.pos.y + 1); p = new V3(x, gy === null ? P.pos.y : gy, z); }
    const g = new THREE.Group(); g.position.copy(p);
    if (NADE_MODEL) { const c = NADE_MODEL.clone(true); c.rotation.z = Math.PI / 2; c.position.y = 0.09; g.add(c); }
    else { const c = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.06, 14), toonMat({ color: 0x3d4a2a })); c.position.y = 0.03; g.add(c); }
    const light = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff2a1a })); light.position.y = 0.2; g.add(light);
    scene.add(g); mines.push({ g, light, pos: p, state: 'arming', t: S.mine.arm, blink: 0 });
    note('Mine set: it arms in ' + S.mine.arm + ' s', 1.2);
  }
  function updateMines(dt) {
    for (let i = mines.length - 1; i >= 0; i--) {
      const m = mines[i]; m.t -= dt; m.blink += dt;
      if (m.state === 'arming') { m.light.visible = m.blink % 0.5 < 0.1; if (m.t <= 0) { m.state = 'armed'; sBeep(1800); } continue; }
      if (m.state === 'armed') {
        m.light.visible = m.blink % 1.2 < 0.12;
        const close = e => Math.hypot(e.x - m.pos.x, e.z - m.pos.z) < S.mine.radius && Math.abs(e.y - m.pos.y) < 2;
        if (close(P.pos) || dummies.some(t => t.dead <= 0 && close(t.g.position))) { m.state = 'warn'; m.t = S.mine.warn; }
        continue;
      }
      // Warning: beeps faster and faster, then the blast
      m.light.visible = m.blink % 0.12 < 0.06; m.beep = (m.beep || 0) - dt;
      if (m.beep <= 0) { sBeep(2200); m.beep = Math.max(0.07, 0.25 * m.t / Math.max(0.2, S.mine.warn)); }
      if (m.t <= 0) { scene.remove(m.g); mines.splice(i, 1); blast(m.pos.clone().setY(m.pos.y + 0.1), P, 'mine'); }
    }
  }
  function clearMines() { for (const m of mines) scene.remove(m.g); mines.length = 0; }

  // ---------------------------------------------------------------- blasts
  const myRockets = new Set();
  // Damage in rings round the blast: 10 at the centre, one less each ring out. Anyone with a clear line to it is hurt.
  function blast(pos, owner, src) {
    const R = blastR();
    addScorch(pos, Math.min(4, R * 0.3)); _boomFx(pos, src === 'tube' ? 6.5 : R * 0.6); sBoom(vol(pos, 90));
    const o = pos.clone(); o.y += 0.3;
    showRings(o);
    const name = { throw: 'grenade', mine: 'mine', tube: 'tube' }[src] || 'blast';
    for (const t of dummies) {
      const d = distTo(t, o), dmg = ringDmg(d);
      if (dmg > 0 && centres(t).some(c => losPts(o, c))) hitDummy(t, dmg, false, name, 1, 0, 'blast');
    }
    // You: blasts hurt you too (your health circle shows it); the range doesn't kill you, it just fills you back up
    const me = Math.max(0, Math.hypot(Math.max(0, Math.abs(o.x - P.pos.x) - 0.3), Math.max(0, P.pos.y - o.y, o.y - (P.pos.y + P.h)), Math.max(0, Math.abs(o.z - P.pos.z) - 0.3)));
    const mine = ringDmg(me);
    if (mine > 0 && losPts(o, new V3(P.pos.x, P.pos.y + P.h * 0.6, P.pos.z))) hurtMe(mine, name);
    // Other mines in reach go off too
    for (const m of mines) if (m.state !== 'warn' && m.pos.distanceTo(o) < R * 0.6 && losPts(o, m.pos.clone().setY(m.pos.y + 0.2))) { m.state = 'warn'; m.t = 0.15; }
    const pd = P.pos.distanceTo(pos); if (pd < 14) punch += 0.06 * (1 - pd / 14);
  }

  let myHp = HP, myLastT = 0, myDownT = 0;
  function hurtMe(d, name) {
    if (myDownT > 0) return;
    myHp = Math.max(0, myHp - d); myLastT = performance.now() / 1000;
    if (myHp <= 0) { myDownT = 1.5; note(`Your own ${name} would have killed you`, 2); }
    else note(`Your own ${name} hit you for ${d}`, 1.5);
  }

  // ---------------------------------------------------------------- shooting
  const ray = new THREE.Raycaster(), _e = new THREE.Euler(0, 0, 0, 'YXZ'), _q = new THREE.Quaternion();
  const aimQ = () => _q.setFromEuler(_e.set(P.pitch, P.yaw, 0, 'YXZ')); // where you're aiming (the camera's kick is just for show)
  const dummyParts = () => dummies.flatMap(t => t.parts);
  function spreadNow(g) {
    const m = S.move, hs = Math.hypot(P.vel.x, P.vel.z);
    let sp = g.spread + heat * g.grow + (!P.onGround ? m.jump : hs > 5 ? m.run : hs > 0.5 ? m.walk : 0);
    if (P.h < STAND_H) sp *= m.crouch;
    return sp * (1 - (1 - m.aim) * adsK);
  }
  function fireGun(s) {
    const g = gunOf(s), w = WEAPONS[s.model], q = aimQ(), half = spreadNow(g) * 0.005; // spread N: N × 0.01 rad across
    const targets = [...W.meshes, ...W.floors, ...dummyParts()], start = vmMuzzleWorld(), byT = new Map(), holes = [];
    for (let i = 0; i < g.count; i++) {
      const r = half * Math.sqrt(Math.random()), th = Math.random() * Math.PI * 2;
      const dir = new V3(Math.cos(th) * r, Math.sin(th) * r, -1).normalize().applyQuaternion(q);
      ray.set(camera.position, dir); ray.far = 250;
      const hit = ray.intersectObjects(targets, false)[0];
      if (i < 4) tracer(start, hit ? hit.point : camera.position.clone().addScaledVector(dir, 250), w.tracer, w.trW, w.trLife, true);
      if (!hit) continue;
      const ud = hit.object.userData;
      if (ud.rangeT) { const head = ud.part === 'head', a = byT.get(ud.rangeT) || { d: 0, n: 0, nh: 0 }; a.d += head ? g.head : g.body; a.n++; if (head) a.nh++; byT.set(ud.rangeT, a); }
      else { const h = holeFromHit(hit, dir); if (h) holes.push(h); else impact(hit.point); }
    }
    addHoles(holes);
    for (const [t, a] of byT) hitDummy(t, a.d, a.nh > 0, s.name, a.n, a.nh);
    if (byT.size) hitMarker([...byT.values()].some(a => a.nh > 0));
    if (g.grow > 0) heat = Math.min(1, heat + 1 / 8);
    const k = (P.h < STAND_H ? 0.7 : 1) * (1 - 0.3 * adsK);
    punch += w.kick * 0.6 * k; vmKick = 1; flashT = GUN_FX[s.model] ? GUN_FX[s.model].flash.life : 0.04;
    muzzleFx(s.model, start, new V3(0, 0, -1).applyQuaternion(q), true, P.id);
    sfx(w.sound, 1);
  }
  function fireTube() {
    const q = aimQ(), cdir = new V3(0, 0, -1).applyQuaternion(q), start = vmMuzzleWorld();
    ray.set(camera.position, cdir); ray.far = 250;
    const hit = ray.intersectObjects([...W.meshes, ...W.floors, ...dummyParts()], false)[0];
    const dir = hit && hit.point.distanceTo(start) > 1.5 ? hit.point.clone().sub(start).normalize() : cdir;
    const n = rockets.length; launchRocket(P, start, dir, Object.assign({}, WEAPONS.bazooka, { rocketSpeed: S.tube.speed }));
    if (rockets.length > n) myRockets.add(rockets[rockets.length - 1]);
    punch += WEAPONS.bazooka.kick * 0.8; vmKick = 1; flashT = GUN_FX.bazooka.flash.life;
    muzzleFx('bazooka', start, cdir, true, P.id); sfx('bazooka', 1);
  }
  function knife() {
    knifeCd = 0.75; knifeT = 0.6;
    const fx = -Math.sin(P.yaw), fz = -Math.cos(P.yaw);
    let best = null, bd = S.knife.reach + 0.3;
    for (const t of dummies) {
      if (t.dead > 0 || Math.abs(t.g.position.y - P.pos.y) > 1.2) continue;
      const dx = t.g.position.x - P.pos.x, dz = t.g.position.z - P.pos.z, d = Math.hypot(dx, dz);
      if (d < bd && (dx * fx + dz * fz) / Math.max(d, 1e-3) > 0.7) { best = t; bd = d; }
    }
    if (!best) return;
    // The dummies face the firing line (+z): you're behind one when you're on its -z side
    const back = (best.g.position.z - P.pos.z) / Math.max(bd, 1e-3) > 0.5;
    hitDummy(best, back ? S.knife.back : S.knife.front, false, back ? 'knife (from behind)' : 'knife', 1, 0, 'stab');
    hitMarker(false);
  }
  const clipOf = s => (s.kind === 'tube' ? 1 : s.kind === 'gun' ? gunOf(s).clip : 0);
  const reloadOf = s => (s.kind === 'tube' ? S.tube.reload : gunOf(s).reload);
  function startReload() { const s = slot(); if (!s.model || P.reloading > 0 || P.ammo >= clipOf(s)) return; P.reloading = reloadOf(s); WEAPONS[s.model].reload = P.reloading; heat = 0; }
  function throwNow() {
    const fuse = Math.max(0.05, S.throw.fuse - cooking); cooking = -1;
    const dir = new V3(0, 0, -1).applyQuaternion(aimQ()), v = dir.clone().multiplyScalar(25); v.y += 4.5; v.x += P.vel.x * 0.5; v.z += P.vel.z * 0.5;
    throwNade(P, camera.position.clone().addScaledVector(dir, 0.4), v, fuse);
    throwT = 0.4; gun.cd = 0.6; shotN++;
  }
  // Replaces the game's updateGun in the range
  function updateGun(dt) {
    gun.cd -= dt; knifeCd -= dt; gun.spray = 0; gun.burstLeft = 0;
    heat = Math.max(0, heat - dt * (mouseDown ? 0.6 : 2.5));
    const s = slot();
    if (!s.model) { mouseRight = false; tAim = false; } // nothing to aim down
    if (!P.alive || monitorOpen) return;
    if (P.reloading > 0) { P.reloading -= dt; if (P.reloading <= 0) { P.reloading = 0; P.ammo = clipOf(s); } return; }
    if (switchT > 0) { if (s.kind !== 'throw') clickQ = false; return; }
    if (s.model && P.ammo <= 0) { startReload(); return; }
    if (s.kind === 'gun' || s.kind === 'tube') {
      const g = s.kind === 'gun' ? gunOf(s) : null, want = g && g.auto ? mouseDown : clickQ;
      if (!want || gun.cd > 0) return;
      clickQ = false; gun.cd = s.kind === 'tube' ? 0.3 : 1 / g.rate; P.ammo--; shotN++;
      if (s.kind === 'tube') fireTube(); else fireGun(s);
      if (P.ammo <= 0) startReload();
      return;
    }
    if (s.kind === 'knife') { if (clickQ && knifeCd <= 0) { clickQ = false; shotN++; knife(); } return; }
    if (s.kind === 'mine') { if (clickQ && gun.cd <= 0) { clickQ = false; gun.cd = 0.5; throwT = 0.3; shotN++; placeMine(); } return; }
    // Grenade: hold to cook (it beeps faster as the fuse runs down), let go to throw
    clickQ = false;
    if (cooking < 0) { if (mouseDown && gun.cd <= 0 && throwT <= 0) { cooking = 0; beepT = 0.5; sPin(); } return; }
    cooking += dt; beepT -= dt;
    if (beepT <= 0) { const rem = S.throw.fuse - cooking; beepT = rem > 1.5 ? 0.5 : rem > 0.75 ? 0.25 : 0.12; sBeep(1300 + (1 - rem / S.throw.fuse) * 1000); }
    if (cooking >= S.throw.fuse) { cooking = -1; gun.cd = 0.8; shotN++; blast(new V3(P.pos.x, P.pos.y + 1.2, P.pos.z), P, 'throw'); note('Held it too long', 1.5); return; }
    if (!mouseDown) throwNow();
  }

  // ---------------------------------------------------------------- picking a weapon
  function pick(i, instant) {
    if (i === cur && !instant) return;
    const was = SLOTS[cur];
    if (cooking >= 0) throwNow(); // switching away lobs a cooked grenade rather than losing it
    if (!was.model && P.ammoBy[curW]) { P.ammo = P.ammoBy[curW].mag; P.reserve = 0; } // (P.ammo means nothing in the hands slots)
    cur = i; heat = 0; gun.cd = 0; clickQ = false;
    const s = SLOTS[i];
    if (s.model) { selectWeapon(s.model, instant); P.ammo = Math.min(P.ammo, clipOf(s)); P.reserve = 0; }
    else { syncAmmo(); for (const k in VMW) VMW[k].holder.visible = false; P.ammo = 0; P.reserve = 0; P.reloading = 0; if (!instant) switchT = 0.3; }
    drawSlots();
  }
  function kit() {
    P.inv = SLOTS.filter(s => s.model).map(s => s.model); P.nades = 0; cooking = -1;
    P.ammoBy = {}; for (const s of SLOTS) if (s.model) P.ammoBy[s.model] = { mag: clipOf(s), res: 0 };
    curW = 'pistol'; P.ammo = P.ammoBy.pistol.mag; P.reserve = 0;
    const keep = cur; cur = 0; pick(Math.min(keep, SLOTS.length - 1), true);
  }

  // ---------------------------------------------------------------- HUD: the weapon list and the numbers
  const css = document.createElement('style');
  css.textContent = `
  #rslots{position:fixed;left:14px;top:50%;transform:translateY(-50%);z-index:6;display:none;flex-direction:column;gap:3px;font:600 13px/1.2 system-ui,sans-serif;color:#e8ece6;pointer-events:none}
  #rslots div{background:rgba(0,0,0,.45);padding:4px 9px;border-radius:3px;border-left:3px solid transparent}
  #rslots div.on{background:rgba(0,0,0,.75);border-left-color:#f0874d;color:#fff}
  #rslots small{opacity:.6;font-weight:500}
  #rhp{position:fixed;left:14px;top:14px;z-index:6;width:46px;height:46px;border-radius:50%;display:none;transition:background-color .15s;pointer-events:none}
  body.range-on #hpbar{visibility:hidden}
  #rcard{position:fixed;left:72px;top:14px;z-index:6;display:none;max-width:min(430px,calc(100vw - 86px));background:rgba(0,0,0,.55);border-radius:4px;padding:8px 12px;font:13px/1.4 system-ui,sans-serif;color:#e8ece6;pointer-events:none}
  #rcard .w{font:700 15px system-ui,sans-serif;color:#fff}#rcard .k{color:#9aa5b1}#rcard .h{margin-top:4px;color:#cfd6dd}#rcard .h div:first-child{color:#8fe39a}
  #rpanel{position:fixed;top:0;right:0;bottom:0;width:min(400px,100vw);z-index:40;background:rgba(18,22,27,.95);color:#e8ece6;font:14px/1.35 system-ui,sans-serif;overflow-y:auto;padding:16px 16px 28px;box-sizing:border-box;display:none;border-left:1px solid #2f3742}
  #rpanel h2{margin:0 0 2px;font-size:20px}#rpanel .sub{color:#9aa5b1;margin:0 0 10px;font-size:13px}
  #rpanel details{border-top:1px solid #2f3742;padding:6px 0}
  #rpanel summary{cursor:pointer;font:700 13px system-ui,sans-serif;letter-spacing:.1em;text-transform:uppercase;color:#f0874d;padding:4px 0}
  #rpanel summary small{color:#9aa5b1;letter-spacing:0;text-transform:none;font-weight:500;margin-left:6px}
  #rpanel .row{display:grid;grid-template-columns:1fr auto;gap:2px 8px;margin:7px 0}
  #rpanel .row label{font-size:13px}#rpanel .row output{font:600 13px ui-monospace,Menlo,monospace;color:#fff}
  #rpanel input[type=range]{grid-column:1/-1;width:100%;accent-color:#f0874d}
  #rpanel .chk{display:flex;gap:8px;align-items:center;margin:8px 0;font-size:13px}#rpanel .chk input{accent-color:#f0874d}
  #rpanel .help{grid-column:1/-1;color:#8b96a2;font-size:12px}
  #rpanel .math{background:#232a33;border-radius:4px;padding:7px 9px;margin:8px 0 4px;font-size:12.5px;color:#d6dde4}
  #rpanel .btns{display:flex;flex-wrap:wrap;gap:6px;margin-top:16px}
  #rpanel button{flex:1 1 auto;padding:8px 10px;border-radius:4px;border:1px solid #3a4450;background:#232a33;color:#e8ece6;font:600 13px system-ui,sans-serif;cursor:pointer}
  #rpanel button.go{background:#f0874d;color:#1a1208;border-color:#f0874d}
  #rpanel button.sm{flex:0 0 auto;padding:4px 8px;font-size:12px;margin-top:4px}
  #rpanel .info{color:#9aa5b1;font-size:12px;margin-top:10px}
  #rcross{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);border-radius:50%;box-sizing:border-box;display:none}
  body.range-on .ch{display:none}
  body.touch #rslots,body.touch #rcard,body.touch #rhp{display:none!important}`;
  document.head.append(css);
  const slotsEl = document.createElement('div'); slotsEl.id = 'rslots';
  const card = document.createElement('div'); card.id = 'rcard';
  const panel = document.createElement('div'); panel.id = 'rpanel';
  const cross = document.createElement('div'); cross.id = 'rcross';
  const hpEl = document.createElement('div'); hpEl.id = 'rhp';
  document.body.append(slotsEl, card, panel, hpEl); ($('hud') || document.body).append(cross);
  let crossR = 0;
  function drawSlots() {
    slotsEl.innerHTML = SLOTS.map((s, i) => `<div class="${i === cur ? 'on' : ''}">${i + 1}&nbsp; ${s.name}${s.ammo ? ` <small>${s.ammo}</small>` : ''}</div>`).join('');
  }
  drawSlots();
  const fmt = (n, step) => (step >= 1 ? String(Math.round(n)) : step >= 0.1 ? (+n).toFixed(1) : (+n).toFixed(2));
  const plural = (n, a) => `${n} ${a}${n === 1 ? '' : 's'}`;
  // How long n shots take from the first to the last, reloading whenever the clip runs out
  function shotsTime(g, n) { if (n <= 1) return 0; const reloads = Math.floor((n - 1) / g.clip); return (n - 1 - reloads) / g.rate + reloads * g.reload; }
  function killMath(g) {
    if (g.count > 1) {
      const nb = Math.ceil(HP / g.body), nh = Math.ceil(HP / g.head);
      return `All ${g.count} pellets on the body do ${g.count * g.body}. One shot kills with ${nb} of them on the body (or ${nh} on the head)${nb > g.count ? `, so it takes ${Math.ceil(nb / g.count)} shots (${shotsTime(g, Math.ceil(nb / g.count)).toFixed(2)} s)` : ''}.`;
    }
    const nb = Math.ceil(HP / g.body), nh = Math.ceil(HP / g.head), t = n => (n === 1 ? 'instant' : shotsTime(g, n).toFixed(2) + ' s');
    return `Body: ${plural(nb, 'shot')} to kill (${t(nb)}). Head: ${plural(nh, 'shot')} (${t(nh)}).`;
  }
  function blastMath() { const r = S.blast.ring, n = S.blast.max, h = Math.ceil(n / 2); return n === 1 ? `1 within ${fmt(r, 0.1)} m, nothing past that.` : `${n} within ${fmt(r, 0.1)} m, then one less every ${fmt(r, 0.1)} m: ${h} at ${fmt((n - h) * r, 0.1)} m, 1 at ${fmt((n - 1) * r, 0.1)} m, nothing past ${fmt(n * r, 0.1)} m.`; }
  let aimT = null, cardT = 0;
  function drawCard() {
    const s = slot();
    let line = '';
    if (s.kind === 'gun') { const g = gunOf(s); line = `<span class="k">Body</span> ${g.body} · <span class="k">Head</span> ${g.head} · <span class="k">Spread</span> ${fmt(spreadNow(g), 0.1)}${g.count > 1 ? ` · ${g.count} pellets` : ''} · <span class="k">Clip</span> ${g.clip}<br>${killMath(g)}`; }
    else if (s.kind === 'knife') line = `${S.knife.front} from the front, ${S.knife.back} from behind, ${fmt(S.knife.reach, 0.1)} m reach`;
    else line = `${s.kind === 'throw' ? 'Hold to cook, let go to throw. ' : s.kind === 'mine' ? 'Click to set one at your feet. ' : ''}${blastMath()}`;
    const aim = aimT ? `<div class="k">On the crosshair: ${aimT.label}, ${aimT.d.toFixed(1)} m away</div>` : '';
    card.innerHTML = `<div class="w">${cur + 1} · ${s.name}${s.ammo ? ` <span class="k">(${s.ammo}, infinite)</span>` : ''}</div>${line}${aim}${history.length ? `<div class="h">${history.map(h => `<div>${h}</div>`).join('')}</div>` : ''}<div class="k" style="margin-top:4px">Tab: weapon settings</div>`;
  }

  // ---------------------------------------------------------------- the Tab panel
  // Projectile rows: [key, label, min, max, step, unit, help]
  const GUN_ROWS = [
    ['body', 'Body damage', 1, HP, 1, '', ''],
    ['head', 'Head damage', 1, HP, 1, '', ''],
    ['spread', 'Spread', 0, 30, 0.5, '', 'How wide the shots land: N covers a circle N × 10 cm across at 10 m (twice that at 20 m). 0 goes exactly where you aim.'],
    ['grow', 'Spread growth (recoil)', 0, 20, 0.5, '', 'Extra spread you build up holding the trigger: all of it after 8 shots in a row. It settles back once you stop.'],
    ['rate', 'Rate of fire', 0.5, 20, 0.5, 'shots/s', ''],
    ['clip', 'Clip size', 1, 60, 1, 'shots', 'Shots per battery (or per load) before a reload.'],
    ['count', 'Pellets per shot', 1, 20, 1, '', 'More than 1 makes a spread of pellets, each doing the damage above.'],
    ['reload', 'Reload time', 0.3, 6, 0.1, 's', ''],
  ];
  // Other rows: [path, label, min, max, step, unit, help]
  const OTHER = [
    ['Explosive (all three ways)', [
      ['blast.max', 'Centre damage', 1, HP, 1, '', 'What a blast does in its middle ring. Each ring out does one less.'],
      ['blast.ring', 'Ring width', 0.3, 3, 0.1, 'm', ''],
      ['throw.fuse', 'Grenade fuse', 0.5, 5, 0.25, 's', 'From pulling the pin. Hold the button to cook it.'],
      ['mine.arm', 'Mine arms after', 0, 5, 0.25, 's', ''],
      ['mine.radius', 'Mine trigger distance', 0.5, 6, 0.25, 'm', 'Anyone this close sets it off (you too).'],
      ['mine.warn', 'Mine warning beeps', 0, 3, 0.1, 's', 'Time to run between setting it off and the blast.'],
      ['tube.speed', 'Tube rocket speed', 10, 120, 1, 'm/s', ''],
      ['tube.reload', 'Tube reload', 0.5, 8, 0.1, 's', ''],
    ], 'blast'],
    ['Knife', [
      ['knife.front', 'From the front', 1, HP, 1, '', ''],
      ['knife.back', 'From behind', 1, HP, 1, '', ''],
      ['knife.reach', 'Reach', 1, 4, 0.1, 'm', ''],
    ]],
    ['Moving (every gun)', [
      ['move.walk', 'Walking adds', 0, 20, 0.5, 'spread', ''],
      ['move.run', 'Running adds', 0, 30, 0.5, 'spread', ''],
      ['move.jump', 'In the air adds', 0, 30, 0.5, 'spread', ''],
      ['move.crouch', 'Crouching multiplies by', 0.1, 1, 0.05, '×', ''],
      ['move.aim', 'Aiming down sights multiplies by', 0.1, 1, 0.05, '×', ''],
    ]],
    ['Dummies', [
      ['targets.strafe', 'Lane dummies strafe at', 0, 7, 0.5, 'm/s', 'Side to side, 1.5 m each way. 0 stands still; 4.2 is walking pace, 6.8 running.'],
      ['targets.heal', 'Damage wears off after', 0.5, 10, 0.5, 's', 'With no new hits, a dummy goes back to full health.'],
    ]],
  ];
  const getP = p => p.split('.').reduce((o, k) => o[k], S);
  const setP = (p, v) => { const ks = p.split('.'), last = ks.pop(); ks.reduce((o, k) => o[k], S)[last] = v; };
  function buildPanel() {
    const s = slot();
    let html = `<h2>Weapon settings</h2><p class="sub">Changes take effect as you drag, and are saved in this browser. Damage is out of ${HP} health.</p>`;
    for (const sl of SLOTS) if (sl.kind === 'gun') {
      const g = gunOf(sl);
      html += `<details data-sec="${sl.id}"${sl === s ? ' open' : ''}><summary>${sl.name}<small>${sl.ammo}</small></summary><div class="math" id="rm-${sl.id}">${killMath(g)}</div>`;
      for (const [k, label, min, max, step, unit, help] of GUN_ROWS)
        html += `<div class="row"><label for="rg-${sl.id}-${k}">${label}</label><output id="ro-${sl.id}-${k}">${fmt(g[k], step)} ${unit}</output><input type="range" id="rg-${sl.id}-${k}" data-g="${sl.id}" data-k="${k}" min="${min}" max="${max}" step="${step}" value="${g[k]}">${help ? `<div class="help">${help}</div>` : ''}</div>`;
      html += `<label class="chk"><input type="checkbox" data-g="${sl.id}" data-k="auto"${g.auto ? ' checked' : ''}> Full auto (hold to keep firing)</label><button type="button" class="sm" data-reset="${sl.id}">Reset ${sl.name}</button></details>`;
    }
    for (const [title, rows, math] of OTHER) {
      const open = (math === 'blast' && !s.model) || (math === 'blast' && s.kind === 'tube') || (title === 'Knife' && s.kind === 'knife');
      html += `<details${open ? ' open' : ''}><summary>${title}</summary>${math === 'blast' ? `<div class="math" id="rm-blast">${blastMath()}</div><label class="chk"><input type="checkbox" data-p="blast.show"${S.blast.show ? ' checked' : ''}> Show the rings where a blast goes off</label>` : ''}`;
      for (const [p, label, min, max, step, unit, help] of rows)
        html += `<div class="row"><label for="rp-${p}">${label}</label><output id="rq-${p}">${fmt(getP(p), step)} ${unit}</output><input type="range" id="rp-${p}" data-p="${p}" min="${min}" max="${max}" step="${step}" value="${getP(p)}">${help ? `<div class="help">${help}</div>` : ''}</div>`;
      html += '</details>';
    }
    html += `<div class="btns"><button type="button" class="go" id="r-go">Back to shooting (Tab)</button><button type="button" id="r-mines">Clear mines</button><button type="button" id="r-reset">Reset everything</button><button type="button" id="r-copy">Copy settings</button></div>
      <p class="info">Copy settings puts every number on your clipboard, to paste to Claude or a friend.</p>`;
    panel.innerHTML = html;
    panel.querySelectorAll('input[data-g]').forEach(el => el.oninput = el.onchange = () => {
      const id = el.dataset.g, k = el.dataset.k, g = S.guns[id];
      if (el.type === 'checkbox') g[k] = el.checked;
      else { g[k] = +el.value; const row = GUN_ROWS.find(r => r[0] === k); panel.querySelector(`#ro-${id}-${k}`).textContent = `${fmt(g[k], row[4])} ${row[5]}`; }
      panel.querySelector('#rm-' + id).textContent = killMath(g);
      if (k === 'clip' && slot().id === id) P.ammo = Math.min(P.ammo, g.clip);
      if (k === 'clip') { const sl = SLOTS.find(x => x.id === id); if (P.ammoBy && P.ammoBy[sl.model]) P.ammoBy[sl.model].mag = Math.min(P.ammoBy[sl.model].mag, g.clip); }
      save();
    });
    panel.querySelectorAll('input[data-p]').forEach(el => el.oninput = el.onchange = () => {
      const p = el.dataset.p;
      if (el.type === 'checkbox') setP(p, el.checked);
      else { setP(p, +el.value); const row = OTHER.flatMap(o => o[1]).find(r => r[0] === p); panel.querySelector(`#rq-${CSS.escape(p)}`).textContent = `${fmt(getP(p), row[4])} ${row[5]}`; }
      const bm = panel.querySelector('#rm-blast'); if (bm) bm.textContent = blastMath();
      if ((p === 'blast.ring' || p === 'blast.max') && pitRings) { drawRings(); pitRings.scale.setScalar(blastR()); }
      save();
    });
    panel.querySelectorAll('[data-reset]').forEach(b => b.onclick = () => { S.guns[b.dataset.reset] = clone(DEFAULTS.guns[b.dataset.reset]); save(); buildPanel(); });
    panel.querySelector('#r-go').onclick = () => setPanel(false, true);
    panel.querySelector('#r-mines').onclick = e => { clearMines(); e.target.textContent = 'Mines cleared'; };
    panel.querySelector('#r-reset').onclick = () => { if (!confirm('Put every weapon setting back to the starting numbers?')) return; for (const k in DEFAULTS) S[k] = clone(DEFAULTS[k]); save(); drawRings(); if (pitRings) pitRings.scale.setScalar(blastR()); buildPanel(); };
    panel.querySelector('#r-copy').onclick = e => {
      const txt = JSON.stringify(S, null, 1);
      navigator.clipboard.writeText(txt).then(() => { e.target.textContent = 'Copied'; }).catch(() => { const ta = document.createElement('textarea'); ta.value = txt; ta.style.cssText = 'width:100%;height:120px;margin-top:8px'; panel.append(ta); ta.select(); });
    };
  }
  function setPanel(open, relock) {
    if (open === panelOpen) return;
    panelOpen = open; panel.style.display = open ? 'block' : 'none';
    if (open) { buildPanel(); mouseDown = false; if (document.pointerLockElement) document.exitPointerLock(); }
    else if (relock && !matchOver) renderer.domElement.requestPointerLock();
  }
  addEventListener('keydown', e => { if (panelOpen && e.code === 'Escape') { setPanel(false); setPlaying(false); } });

  // ---------------------------------------------------------------- level changes
  const realReload = {}; for (const k in WEAPONS) realReload[k] = WEAPONS[k].reload;
  function teardown() {
    for (const t of dummies) scene.remove(t.g); dummies.length = 0;
    clearMines(); for (const f of flashes) scene.remove(f.m); flashes.length = 0;
    if (pitRings) { scene.remove(pitRings); pitRings = null; }
    for (const k in realReload) WEAPONS[k].reload = realReload[k]; // the reload animation's length goes back to the game's
    setPanel(false); built = false; history = []; lastKill = '';
  }

  Object.defineProperty(RANGE, 'on', { get: on, configurable: true });
  Object.defineProperty(RANGE, 'panelOpen', { get: () => panelOpen, configurable: true });
  Object.assign(RANGE, {
    onLevel() {
      if (!on()) { if (built) teardown(); return; }
      if (!built) {
        buildDummies();
        pitRings = ringMesh(); pitRings.position.set(PIT.x, 0.045, PIT.z); pitRings.scale.setScalar(blastR()); pitRings.material.opacity = 0.55; scene.add(pitRings);
        built = true;
      }
      dummies.forEach(resetDummy); clearMines(); myRockets.clear(); myHp = HP; myDownT = 0;
    },
    kit() { if (on()) kit(); },
    updateGun,
    next(dir) { if (P.alive) pick((cur + dir + SLOTS.length) % SLOTS.length); },
    key(code) {
      if (!on()) return false;
      const n = /^Digit([1-9])$/.exec(code);
      if (n) { if (P.alive) pick(+n[1] - 1); return true; }
      if (code === 'KeyQ') { RANGE.next(1); return true; }
      if (code === 'KeyR') { startReload(); return true; }
      return code === 'KeyE' || code === 'KeyF' || code === 'KeyG'; // no knife or grenade hotkeys: they're weapons you switch to
    },
    tab() { if (!on() || !(locked || panelOpen)) return false; setPanel(!panelOpen, true); return true; },
    // The game's blasts (grenades and the tube's rockets) land here in the range
    boom(pos) {
      let src = 'throw';
      for (const r of myRockets) if (!rockets.includes(r)) { myRockets.delete(r); src = 'tube'; }
      blast(pos, P, src);
    },
    solid(p) { // a rocket touching a dummy
      for (const t of dummies) for (const o of t.parts) { const h = o.userData.half; if (Math.abs(p.x - t.g.position.x) < h.x + 0.05 && Math.abs(p.y - t.g.position.y - o.position.y) < h.y + 0.05 && Math.abs(p.z - t.g.position.z) < h.z + 0.05) return true; }
      return false;
    },
    update(dt) {
      if (!on()) return;
      const now = performance.now() / 1000;
      for (const t of dummies) {
        if (t.flashT > 0 && (t.flashT -= dt) <= 0 && t.dead <= 0) tint(t);
        if (t.dead > 0) { if ((t.dead -= dt) <= 0) resetDummy(t); }
        else if (t.dmg > 0 && now - t.lastT > S.targets.heal) resetDummy(t);
        // Strafing: lane dummies pace 1.5 m each side of their spot
        const sp = t.lane ? S.targets.strafe : 0;
        if (sp > 0) { t.g.position.x += t.dir * sp * dt; if (Math.abs(t.g.position.x - t.home.x) > 1.5) { t.g.position.x = t.home.x + Math.sign(t.g.position.x - t.home.x) * 1.5; t.dir = -t.dir; } }
        else if (t.g.position.x !== t.home.x) t.g.position.x += (t.home.x - t.g.position.x) * Math.min(1, dt * 4);
        // You can't walk through them
        const dx = P.pos.x - t.g.position.x, dz = P.pos.z - t.g.position.z, d = Math.hypot(dx, dz);
        if (d < 0.6 && d > 1e-4 && P.pos.y < t.g.position.y + 2) { P.pos.x = t.g.position.x + dx / d * 0.6; P.pos.z = t.g.position.z + dz / d * 0.6; }
      }
      updateMines(dt);
      if (myDownT > 0) { if ((myDownT -= dt) <= 0) myHp = HP; }
      else if (myHp < HP && now - myLastT > S.targets.heal) myHp = HP;
    },
    after(dt) {
      const show = on() && (locked || panelOpen) && P.alive;
      slotsEl.style.display = show ? 'flex' : 'none'; card.style.display = show ? 'block' : 'none';
      document.body.classList.toggle('range-on', on());
      cross.style.display = show ? 'block' : 'none'; hpEl.style.display = show ? 'block' : 'none';
      if (!on()) return;
      hpEl.style.backgroundColor = hpColour(myHp);
      scene.background.setHex(0x000000); scene.fog.color.setHex(0x000000); // (each level load sets the sky back)
      // The crosshair: the spread cone as it lands on screen, which is the same at any distance. Eased, so it breathes.
      const g = slot().kind === 'gun' ? gunOf(slot()) : null;
      const half = g ? spreadNow(g) * 0.005 : 0, h = renderer.domElement.clientHeight || innerHeight;
      const want = Math.tan(half) / Math.tan(camera.fov * Math.PI / 360) * h / 2;
      crossR += (want - crossR) * Math.min(1, dt * 18);
      if (crossR < 2.5) cross.style.cssText = 'display:' + cross.style.display + ';width:5px;height:5px;background:#fff;border:0';
      else { const d = (2 * crossR).toFixed(1) + 'px'; cross.style.cssText = `display:${cross.style.display};width:${d};height:${d};background:none;border:1.5px solid #fff`; }
      for (let i = flashes.length - 1; i >= 0; i--) { const f = flashes[i]; f.t -= dt; f.m.material.opacity = Math.min(0.9, f.t / 1.2); if (f.t <= 0) { scene.remove(f.m); f.m.material.dispose(); flashes.splice(i, 1); } }
      const s = slot();
      // What's in your hands: a gun is the game's own viewmodel; the knife, the grenade and the mine are drawn here
      if (!s.model) vm.visible = false;
      if (s.kind === 'knife' && P.alive && !knifeVM.visible) {
        knifeVM.visible = switchT <= 0.15; knifeVM.rotation.order = 'YXZ';
        knifeVM.position.set(0.26, -0.22, -0.52); knifeVM.rotation.set(0.3, 0.45, 0); // blade up and in, its flat side toward you
      }
      if (nadeVM && (s.kind === 'throw' || s.kind === 'mine') && P.alive && throwT <= 0.2) {
        nadeVM.visible = switchT <= 0.15 && gun.cd <= 0.25;
        nadeVM.position.set(0.15, -0.17 + (cooking >= 0 ? 0.04 : 0), -0.4); nadeVM.rotation.set(s.kind === 'mine' ? 1.2 : 0.5, 0.4, -0.3);
      }
      // What the crosshair is on, for the card
      if (show && (cardT -= dt) <= 0) {
        cardT = 0.1; aimT = null;
        ray.set(camera.position, new V3(0, 0, -1).applyQuaternion(aimQ())); ray.far = 250;
        const hit = ray.intersectObjects([...W.meshes, ...dummyParts()], false)[0];
        if (hit && hit.object.userData.rangeT) aimT = { label: hit.object.userData.rangeT.label, d: hit.distance };
        drawCard();
      }
    },
  });
})();
