// The weapon system, and the Shooting Range to dial it in. Every game uses it (not Test Drive or the fort's waves, which keep the old one):
//   - Everyone has 32 health (was 40 until 2026-11-03), shown as a colour from blue (full) to red (1 left). Every hit does a whole number of damage.
//     The game keeps its own health numbers (HP), so damage is scaled by HP / LIFE on the way in.
//   - Five guns (Pistol, Carbine, Izu and Battery Gun all take D batteries, the Master Rifle clips of 5 rounds; A batteries are gone since 2026-11-20),
//     each set by the same few numbers: body and head damage, spread, spread growth (the only recoil), rate, clip, pellets.
//   - An F battery is a grenade or a mine, or a shell for the F tube (a mortar). A blast does its centre damage in the middle
//     ring and one less in each ring out; walls block it, and it hurts anyone in reach (you too).
//   - Three weapons and the knife (4 from the front, a kill from behind). Ammo is carried apart from the weapons.
//   - Tab opens the weapon settings, in the range and in a game (the host's; they're sent to everyone as they change).
//   - The weapons you aren't holding hang on your back (the Pistol at your hip), your batteries on your belt.
// Loaded after the main game script, so it uses the game's globals (scene, camera, P, ents, WEAPONS, VMW, gun, ...).
// The game calls into RANGE (declared in index.html) from its loop, input, pickups, bots and blasts.
(() => {
  // ---------------------------------------------------------------- the weapons and their settings
  const LIFE0 = 29; let LIFE = LIFE0; // everyone's health: the host's setting (game.life), 32 by default. Was 40 until 2026-11-03: 20% less (before that 20 until 2026-11-02, and 7, then 10)
  // Health colours, from 1 left (red) to full (blue), James's ten; the health in between gets a blend of its two neighbours
  const HEALTH = ['#e51c1c', '#ff3300', '#ff6600', '#ff9900', '#ffcc00', '#9cc00d', '#4da823', '#289751', '#0d88aa', '#0066cc'].map(c => new THREE.Color(c));
  const _hc = new THREE.Color();
  function hpColour(h) {
    if (h <= 0) return '#2a2a2a';
    const f = (Math.min(LIFE, h) - 1) / (LIFE - 1) * (HEALTH.length - 1), i = Math.floor(f);
    return '#' + _hc.copy(HEALTH[i]).lerp(HEALTH[Math.min(i + 1, HEALTH.length - 1)], f - i).getHexString();
  }
  // Every weapon, as it lies on the ground. model: which gun the game draws and plays the sounds of (sound: different sounds,
  // played together). ammo: the batteries it takes (AMMO).
  const SLOTS = [
    { id: 'pistol', name: 'Pistol', kind: 'gun', model: 'pistol', sound: ['gun', 'laser'], ammo: 'D' },
    { id: 'carbine', name: 'Carbine', kind: 'gun', model: 'carbine', sound: ['gun', 'laser'], ammo: 'D' },
    { id: 'izu', name: 'Izu', kind: 'gun', model: 'uzi', ammo: 'D' },
    { id: 'battery', name: 'Battery Gun', kind: 'gun', model: 'shotgun', ammo: 'D' },
    { id: 'rifle', name: 'Master Rifle', kind: 'gun', model: 'rifle', ammo: 'R' },
    { id: 'throw', name: 'Grenade', kind: 'throw', ammo: 'F' },
    { id: 'mine', name: 'Mine', kind: 'mine', ammo: 'F' },
    { id: 'tube', name: 'F Tube', kind: 'tube', model: 'bazooka', ammo: 'F' },
  ];
  // The knife is always yours, in hand 4 and on F; you carry three weapons at most. The grenade isn't a weapon you pick up:
  // an F battery IS one (hand 5, there whenever you carry an F battery), and it's a mine if you hold right-click and click.
  // The F tube just launches it further.
  const KNIFE = { id: 'knife', name: 'Knife', kind: 'knife', ammo: '' }, HANDS = 3;
  // Ammo is carried apart from the weapons. A reload takes one battery and fills the clip (what was left in the old one is
  // thrown away); the rifle takes a round; a grenade, a mine or an F tube shot takes one F battery.
  const AMMO = { A: 'A battery', D: 'D battery', F: 'F battery', R: 'rifle clip' };
  const AMMOS = { A: 'A batteries', D: 'D batteries', F: 'F batteries', R: 'rifle clips' };
  const COL = { A: '#e8c33a', D: '#ffb703', F: '#d9261c', R: '#d9d9d9' }; // D: construction-vehicle yellow; F: red
  // Spread is how wide the shots land: spread N covers a circle N × 10 cm across at 10 m (twice that at 20 m).
  // grow: extra spread built up by holding the trigger (all of it after 8 shots in a row); it settles once you let go.
  // aim: aiming down the sights multiplies the spread by this (1: no help). moving: how much of the walk/run/jump spread the gun takes.
  // aimMove: what aiming does to that moving spread (1: nothing, so you have to stop to be accurate).
  // Pistol and Carbine are the same gun but for the barrel: the Pistol shoots well on the move, the Carbine when you stand and aim.
  const DEFAULTS = {
    guns: {
      pistol:  { body: 3,  head: 6,  spread: 6,  grow: 0,  rate: 5,   clip: 10, count: 1,  reload: 1,   aim: 0.5,  moving: 0.1,  aimMove: 0.5, auto: false, fall: 0,   fallMin: 0.25 },
      carbine: { body: 6,  head: 7,  spread: 4,  grow: 0,  rate: 5,   clip: 18, count: 1,  reload: 2,   aim: 0.15, moving: 3,    aimMove: 1,   auto: false, fall: 140, fallMin: 0.55 },
      izu:     { body: 6,  head: 5,  spread: 6,  grow: 20, rate: 12,  clip: 20, count: 1,  reload: 2,   aim: 1,    moving: 5,    aimMove: 1,   auto: true,  fall: 0,   fallMin: 0.4 },
      battery: { body: 5,  head: 6,  spread: 30, grow: 20, rate: 3,   clip: 1,  count: 20, reload: 1.7, aim: 1,    moving: 0.3,  aimMove: 1,   auto: false, fall: 60,  fallMin: 0.1 },
      rifle:   { body: 12, head: 18, spread: 2,  grow: 0,  rate: 1,   clip: 5,  count: 1,  reload: 3,   aim: 0.1,  moving: 4.05, aimMove: 1,   auto: false, fall: 0,   fallMin: 0.25 },
    },
    blast: { max: 25, ring: 0.5, show: false }, // max: damage in the centre ring; ring: width of each ring (m); show: draw them where a blast goes off
    throw: { fuse: 2.25 },                   // seconds from pulling the pin (hold to cook)
    mine: { arm: 1.5, radius: 2, warn: 1 },  // arms after placing; anyone within radius sets it off, then it beeps for warn seconds
    tube: { launch: 40, reload: 1.6, slow: 1 }, // launch: how hard it lobs the shell (the grenade throw is 25); slow: your speed while you carry it
    knife: { front: 4, back: 29, reach: 2 },
    move: { walk: 5, run: 20.5, jump: 12, crouch: 0.5 }, // spread added walking, running, in the air; crouching multiplies it
    targets: { strafe: 0.5, heal: 3 },       // strafe: lane dummies pace side to side at this speed (m/s); heal: your damage wears off after this long
    cross: { ease: 0.2, opacity: 45 },       // ease: how long the crosshair circle takes to catch up with the spread (s); opacity: 0-100 (yours alone: the host's value isn't sent on)
    // Batteries in a pack and the most you can carry, by type; packs (and weapons nobody has) come back after respawn seconds
    ammo: { A: { pack: 4, max: 4 }, D: { pack: 4, max: 8 }, F: { pack: 2, max: 4 }, R: { pack: 1, max: 2 }, respawn: 5, infinite: false }, // (A: no longer used; R: rifle clips of 5, and only the rifle itself brings them)
    // In a game: you spawn with the Pistol and the Carbine loaded, startD D batteries and startF F batteries; packs come back after packs seconds (rifle
    // rounds after rifle), weapons on their spots after weapons seconds. dropD, dropF: the most of each the dead drop (half what they carried, rounded up; all of it until 2026-11-21)
    game: { startD: 4, startF: 2, dropD: 2, dropF: 1, dropLife: 20, packs: 30, rifle: 60, weapons: 25, life: 29, gateHp: 900, doorHp: 240 }, // life: everyone's health; gateHp, doorHp: the fort's gate and the bunker door
  };
  const MAXLIFE = 200;
  const clone = o => JSON.parse(JSON.stringify(o));
  const merge = (base, over) => { for (const k in base) if (over && over[k] !== undefined) { if (typeof base[k] === 'object') merge(base[k], over[k]); else if (typeof over[k] === typeof base[k]) base[k] = over[k]; } return base; };
  const SAVE = 'tse.range.v5', SAVE_X = 'tse.range.cross';
  const S = (() => { try { return merge(clone(DEFAULTS), JSON.parse(localStorage.getItem(SAVE) || 'null')); } catch (e) { return clone(DEFAULTS); } })();
  try { merge(S.cross, JSON.parse(localStorage.getItem(SAVE_X) || 'null')); } catch (e) {} // (a guest's own crosshair, kept apart from the host's numbers)
  if (S.knife.back === 20) S.knife.back = LIFE0; // a knife from behind saved at the old full health still kills
  // damage saved when health was bigger can't be more than the health now (more than all of it kills just the same; the sliders stop at LIFE)
  LIFE = Math.max(4, Math.min(MAXLIFE, S.game.life));
  for (const g of Object.values(S.guns)) for (const f of ['body', 'head']) if (g[f] > LIFE) g[f] = LIFE;
  S.knife.front = Math.min(S.knife.front, LIFE); S.knife.back = Math.min(S.knife.back, LIFE); S.blast.max = Math.min(S.blast.max, LIFE);
  // Saved in this browser; the host also sends them to everyone in the game (a moment after the last change)
  let sendT = 0;
  function save() {
    try { if (NET.role !== 'guest') localStorage.setItem(SAVE, JSON.stringify(S)); localStorage.setItem(SAVE_X, JSON.stringify(S.cross)); } catch (e) {}
    if (NET.role === 'host' && remotes.length) { clearTimeout(sendT); sendT = setTimeout(() => netFx({ t: 'wset', s: S }), 120); }
  }
  // A guest plays by the host's settings (in memory only: their own saved ones are back next time they play alone)
  function useSettings(o) {
    if (!o || typeof o !== 'object') return;
    const mine = S.cross; // the crosshair is yours
    for (const k in DEFAULTS) S[k] = merge(clone(DEFAULTS[k]), o[k]);
    S.cross = mine; setLife(S.game.life);
    drawRings();
  }

  // Everyone's health: changing it keeps each one's share of it
  function setLife(n) {
    n = Math.max(4, Math.min(MAXLIFE, Math.round(+n) || LIFE0)); const was = LIFE; S.game.life = n; if (n === was) return;
    LIFE = n; const f = n / was;
    for (const e of ents) if (e.health > 0) e.health = Math.min(n, e.health * f);
    for (const g of Object.values(S.guns)) for (const k of ['body', 'head']) g[k] = Math.min(g[k], n);
  }
  const fallK = (g, d) => (g.fall > 0 ? 1 - (1 - g.fallMin) * Math.min(1, d / g.fall) : 1); // damage left at distance d
  const live = () => MODE !== 'drive'; // the new weapons: the range and every game (since 2026-11-02; ?dev first)
  const K = () => (live() ? 1 : maxHp(P) / LIFE); // our damage in the game's health (1 when everyone has LIFE, as in every game but Test Drive)
  let cur = HANDS, heat = 0, cooking = -1, beepT = 0, shotN = 0, panelOpen = false, built = false;
  const held = [null, null, null], heldU = [null, null, null], bats = { A: 0, D: 0, F: 0, R: 0 };
  let hot = null, hotPrev = 0, hotMine = false, hotBack = 0, lightOn = false; // hot: the F grenade in hand (and the hand to go back to) // your three hands (cur === HANDS is the knife), and your batteries
  const byId = id => SLOTS.find(x => x.id === id);
  const handSlot = i => (i < HANDS ? held[i] : [KNIFE, byId('throw')][i - HANDS]); // hands 0-4
  const slot = () => handSlot(cur) || KNIFE;
  const has = t => S.ammo.infinite || bats[t] > 0;
  const canPick = i => (i < HANDS ? !!held[i] : i === HANDS || (i === HANDS + 1 && has('F')));
  const mineMode = () => mouseRight || tAim; // the grenade, with right-click held: a mine
  const spend = t => { if (S.ammo.infinite) return true; if (bats[t] <= 0) return false; bats[t]--; return true; };
  const gunOf = s => S.guns[s.id];
  const DOOR_K = 5, DOOR_BLAST_K = 10; // what a shut gate or the locked bunker door takes: damage in the game's health times these (gate hp 800, the door 240)
  const blastR = () => S.blast.max * S.blast.ring; // how far a blast reaches
  const ringDmg = d => d >= blastR() ? 0 : S.blast.max - Math.floor(d / S.blast.ring);

  // ---------------------------------------------------------------- the blast rings
  function canvasTex(w, h, draw) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.anisotropy = 4; return t; }

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
  const flashes = []; // rings drawn where a blast went off, fading out
  function showRings(p) {
    if (!S.blast.show) return;
    const m = ringMesh(), g = groundAt(p.x, p.z, p.y + 0.5);
    m.position.set(p.x, (g === null ? p.y : g) + 0.05, p.z); m.scale.setScalar(blastR()); scene.add(m); flashes.push({ m, t: 2.5 });
  }

  // ---------------------------------------------------------------- mines
  const mines = [];
  // A mine sticks to whatever you're looking at within reach: a floor, a wall or a ceiling (only floors until 2026-11-21), facing out of it (n). Nothing in
  // reach (or a vehicle): on the ground in front of you
  const MINE_REACH = 3.5, UP = new V3(0, 1, 0);
  function placeMine() {
    const q = aimQ(), dir = new V3(0, 0, -1).applyQuaternion(q);
    ray.set(myEye, dir); ray.far = MINE_REACH;
    const hit = castShot(ray, [...W.meshes, ...W.floors]);
    let p, n = UP.clone();
    if (hit && hit.face && hit.object !== ARMOR_HIT) {
      p = hit.point.clone(); n.copy(hit.face.normal);
      if (!hit.object.userData.tgShot) n.transformDirection(hit.object.matrixWorld); // (the level's own hits come in world terms already)
      if (n.dot(dir) > 0) n.negate(); // the side you're looking at
    } else { const fx = -Math.sin(P.yaw), fz = -Math.cos(P.yaw), x = P.pos.x + fx * 1.2, z = P.pos.z + fz * 1.2, gy = groundAt(x, z, P.pos.y + 1); p = new V3(x, gy === null ? P.pos.y : gy, z); }
    // The host runs every mine, so everyone sees them and they hurt everyone: a guest asks the host to set it
    if (NET.role === 'guest') { if (NET.conn && NET.conn.open) NET.conn.send({ t: 'mine', p: arr(p), n: arr(n) }); }
    else addMine(p, P, n);
    note('Mine set: it arms in ' + S.mine.arm + ' s', 1.2);
  }
  const mineN3 = a => { const v = Array.isArray(a) && a.length === 3 && a.every(Number.isFinite) ? v3(a) : UP.clone(); return v.lengthSq() > 0.01 ? v.normalize() : UP.clone(); }; // a surface's way out, from the net
  const minePt = (m, d) => m.pos.clone().addScaledVector(m.n, d); // a point d out from the mine's surface
  let mineN = 0;
  function mineMesh(p, n) { // n: the surface's way out (its top points along it)
    const g = new THREE.Group(); g.position.copy(p).addScaledVector(n, 0.005); g.quaternion.setFromUnitVectors(UP, n);
    if (NADE_MODEL) { const c = NADE_MODEL.clone(true); c.rotation.z = Math.PI / 2; c.position.y = 0.09; g.add(c); }
    else { const c = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.06, 14), toonMat({ color: 0x3d4a2a })); c.position.y = 0.03; g.add(c); }
    const light = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff2a1a })); light.position.y = 0.2; g.add(light);
    const hit = new THREE.Mesh(MINE_HIT_GEO, MINE_HIT_MAT); hit.position.y = 0.1; hit.userData.noHole = true; g.add(hit); // what a shot lands on (a little bigger than the mine)
    scene.add(g); g.updateMatrixWorld(true); return { g, light, hit };
  }
  const MINE_HIT_GEO = new THREE.BoxGeometry(0.4, 0.3, 0.4), MINE_HIT_MAT = new THREE.MeshBasicMaterial({ visible: false });
  // owner: who set it (the kill is theirs)
  function addMine(p, owner, n = UP.clone()) {
    const id = ++mineN, m = Object.assign(mineMesh(p, n), { pos: p, n, state: 'arming', t: S.mine.arm, blink: 0, owner, id }); m.hit.userData.mine = id; mines.push(m);
    netFx({ t: 'mn', i: id, p: arr(p), n: arr(n) });
  }
  // A shot hit a mine (any time after it's set): it goes off at once, and the kill is the shooter's. The host runs the mines, so a guest's shot asks the host
  function shootMine(id, by) {
    if (NET.role === 'guest') { if (NET.conn && NET.conn.open) NET.conn.send({ t: 'mshot', i: id }); return; }
    const m = mines.find(x => !x.rep && x.id === id); if (!m || (m.state === 'warn' && m.t <= 0.05)) return;
    m.owner = by; setMine(m, 'warn', 0);
  }
  // A guest's copy of the host's mine: it only blinks and beeps (rep); the host says when it arms, warns and goes off
  const MINE_STATES = ['arming', 'armed', 'warn'];
  const MINE_HEAR = { arm: 15, warn: 30 }; // how far off (m) a mine's beeps carry: it arming, and the warning once it's set off
  function setMine(m, state, t) { m.state = state; m.t = t; if (!m.rep) netFx({ t: 'ms', i: m.id, s: MINE_STATES.indexOf(state) }); }
  function updateMines(dt) {
    for (let i = mines.length - 1; i >= 0; i--) {
      const m = mines[i]; m.t -= dt; m.blink += dt;
      if (m.state === 'arming') { m.light.visible = m.blink % 0.5 < 0.1; if (m.t <= 0 && !m.rep) { setMine(m, 'armed', 0); sBeep(1800, vol(m.pos, MINE_HEAR.arm)); } continue; }
      if (m.state === 'armed') {
        m.light.visible = m.blink % 1.2 < 0.12;
        if (m.rep) continue;
        // anyone whose body (feet to head) comes within its trigger distance, and that it can see: one on a ceiling or a wall goes off for whoever passes
        // under or by it, not for someone on the far side
        const close = e => { const y = Math.max(e.pos.y, Math.min(e.pos.y + e.h, m.pos.y)); return Math.hypot(e.pos.x - m.pos.x, y - m.pos.y, e.pos.z - m.pos.z) < S.mine.radius && losPts(minePt(m, 0.15), new V3(e.pos.x, y, e.pos.z)); };
        if (ents.some(e => e.alive && close(e))) setMine(m, 'warn', S.mine.warn);
        continue;
      }
      // Warning: beeps faster and faster, then the blast
      m.light.visible = m.blink % 0.12 < 0.06; m.beep = (m.beep || 0) - dt;
      if (m.beep <= 0) { if (m.t > 0) sBeep(2200, vol(m.pos, MINE_HEAR.warn)); m.beep = Math.max(0.07, 0.25 * m.t / Math.max(0.2, S.mine.warn)); }
      // (the blast starts out from the surface: blast() looks from 0.3 above where it's given, which must still be on the mine's side of a ceiling)
      if (m.t <= 0 && !m.rep) { scene.remove(m.g); mines.splice(i, 1); netFx({ t: 'mx', i: m.id }); blast(minePt(m, m.n.y > 0.5 ? 0.1 : m.n.y < -0.5 ? 0.5 : 0.25), m.owner && (m.owner === P || ents.includes(m.owner)) ? m.owner : P, 'mine'); }
    }
  }
  function clearMines(tell) { for (const m of mines) scene.remove(m.g); mines.length = 0; if (tell && NET.role === 'host') netFx({ t: 'mc' }); }
  // The host's word on its mines, on a guest
  function mineFx(m) {
    const i = mines.findIndex(x => x.rep && x.id === m.i);
    if (m.t === 'mn' && i < 0 && Array.isArray(m.p)) { const n = mineN3(m.n), r = Object.assign(mineMesh(v3(m.p), n), { pos: v3(m.p), n, state: 'arming', t: 99, blink: 0, rep: true, id: m.i }); r.hit.userData.mine = m.i; mines.push(r); }
    else if (m.t === 'ms' && i >= 0) { const r = mines[i], was = r.state; r.state = MINE_STATES[m.s] || 'armed'; r.t = r.state === 'warn' ? S.mine.warn : 99; if (r.state === 'armed' && was === 'arming') sBeep(1800, vol(r.pos, MINE_HEAR.arm)); }
    else if (m.t === 'mx' && i >= 0) { scene.remove(mines[i].g); mines.splice(i, 1); }
    else if (m.t === 'mc') clearMines();
  }

  // ---------------------------------------------------------------- blasts
  // Damage in rings round the blast: 10 at the centre, one less each ring out. Anyone with a clear line to it is hurt.
  function blast(pos, owner, src) {
    const R = blastR();
    bulbsBlast(pos, Math.min(R, 6));
    addScorch(pos, Math.min(4, R * 0.3)); _boomFx(pos, src === 'tube' ? 6.5 : R * 0.6); sBoom(vol(pos, 90));
    const o = pos.clone(); o.y += 0.3;
    showRings(o);
    const name = { throw: 'grenade', mine: 'mine', tube: 'F tube' }[src] || 'blast';
    const gap = e => Math.hypot(Math.max(0, Math.abs(o.x - e.pos.x) - 0.3), Math.max(0, e.pos.y - o.y, o.y - (e.pos.y + e.h)), Math.max(0, Math.abs(o.z - e.pos.z) - 0.3));
    const seen = e => losPts(o, new V3(e.pos.x, e.pos.y + e.h * 0.6, e.pos.z));
    {
      for (const e of ents) {
        const d = e.alive ? ringDmg(gap(e)) : 0;
        if (d <= 0 || !seen(e)) continue;
        const kill = e.health - d * K() <= 0;
        damage(e, d * K(), owner, 'frag', false);
        if (owner === P && e !== P) hitFeedback(false, kill);
      }
      netFx({ t: 'bm', p: arr(pos), s: R * 0.6 });
      if (NET.role !== 'guest') { // the shut gate and the locked bunker door wear down too
        if (gateSiegeOn()) { const dr = LV.gate.doors, dd = Math.max(0, new V3((dr.x0 + dr.x1) / 2, dr.y0 + 1.5, dr.z).distanceTo(o) - 1.5), dm = ringDmg(dd); if (dm > 0) damageGate(dm * K() * DOOR_BLAST_K); }
        const bs = lockableDoor();
        if (bs && bs.locked) {
          const mid = new V3(bs.p.x, bs.y + 1.05, bs.p.z), dd = Math.max(0, mid.distanceTo(o) - 0.8), dm = ringDmg(dd);
          if (dm > 0 && (losPts(o, mid.clone().setX(mid.x - 0.3)) || losPts(o, mid.clone().setX(mid.x + 0.3)))) damageBunker(dm * K() * DOOR_BLAST_K);
        }
      }
    }
    // Other mines in reach go off too
    for (const m of mines) if (!m.rep && m.state !== 'warn' && m.pos.distanceTo(o) < R * 0.6 && losPts(o, minePt(m, 0.2))) setMine(m, 'warn', 0.15);
    const pd = P.pos.distanceTo(pos); if (pd < 14) punch += 0.06 * (1 - pd / 14);
  }

  // ---------------------------------------------------------------- shooting
  const ray = new THREE.Raycaster(), _e = new THREE.Euler(0, 0, 0, 'YXZ'), _q = new THREE.Quaternion();
  const aimQ = () => _q.setFromEuler(_e.set(P.pitch, P.yaw, 0, 'YXZ')); // where you're aiming (the camera's kick is just for show)
  // A shot leaves your eyes. In 3rd person the camera is behind your shoulder, so first find what the crosshair is on from
  // there (starting level with you, not behind you), then shoot your eyes at that.
  function shotLine(dir, targets) {
    const c = camera.position; if (c.distanceToSquared(myEye) < 1e-4) return [myEye, dir];
    const s = c.clone().addScaledVector(dir, Math.max(0, myEye.clone().sub(c).dot(dir)));
    ray.set(s, dir); ray.far = 250; const h = castShot(ray, targets);
    const p = h ? h.point : s.addScaledVector(dir, 250);
    return [myEye, p.sub(myEye).normalize()];
  }
  function spreadNow(g) {
    const m = S.move, hs = Math.hypot(P.vel.x, P.vel.z);
    // Aiming tightens the gun's own spread (aim) and the spread from moving (aimMove) separately
    const own = (g.spread + heat * g.grow) * (1 - (1 - g.aim) * adsK);
    const moving = g.moving * (!P.onGround ? m.jump : hs > 5 ? m.run : hs > 0.5 ? m.walk : 0) * (1 - (1 - g.aimMove) * adsK);
    return (own + moving) * (P.h < STAND_H ? m.crouch : 1);
  }
  function fireGun(s) {
    const g = gunOf(s), w = WEAPONS[s.model], q = aimQ(), half = spreadNow(g) * 0.005; // spread N: N × 0.01 rad across
    statShot(P); // (one trigger pull, however many pellets: the end-of-match accuracy)
    const targets = [...W.meshes, ...W.floors], start = vmMuzzleWorld(), byE = new Map(), holes = [];
    for (const e of ents) if (e !== P && e.alive && e.hit) targets.push(...e.hit);
    // A shut gate and the bunker's door (while it's locked) take damage from anyone's bullets: each pellet's body damage times DOOR_K, as one hit on the door per shot
    if (DOORS && DOORS.hit && gateSiegeOn()) targets.push(DOORS.hit);
    const bdh = lockedDoorHit(); if (bdh) targets.push(bdh);
    for (const m of mines) targets.push(m.hit); // a shot sets a mine off
    let gateDmg = 0, bdoorDmg = 0; const minesHit = new Set();
    for (let i = 0; i < g.count; i++) {
      const r = half * Math.sqrt(Math.random()), th = Math.random() * Math.PI * 2;
      const [o, dir] = shotLine(new V3(Math.cos(th) * r, Math.sin(th) * r, -1).normalize().applyQuaternion(q), targets);
      ray.set(o, dir); ray.far = 250;
      const hit = castShot(ray, targets);
      if (i < 4) tracer(start, hit ? hit.point : o.clone().addScaledVector(dir, 250), w.tracer, w.trW, w.trLife, true);
      if (!hit) continue;
      const ud = hit.object.userData;
      const fk = fallK(g, hit.distance);
      if (ud.ent) { const head = ud.part === 'head', a = byE.get(ud.ent) || { d: 0, head: false }; a.d += (head ? g.head : g.body) * fk; a.head = a.head || head; byE.set(ud.ent, a); }
      else if (ud.gate) { gateDmg += g.body * fk * K() * DOOR_K; impact(hit.point, hit.object); }
      else if (ud.bdoor) { bdoorDmg += g.body * fk * K() * DOOR_K; impact(hit.point, hit.object); }
      else if (ud.bulb) { bulbShot(hit); }
      else if (ud.mine) { minesHit.add(ud.mine); impact(hit.point, hit.object); }
      else { const h = holeFromHit(hit, dir); if (h) holes.push(h); else impact(hit.point, hit.object); }
    }
    addHoles(holes);
    if (gateDmg) shootGateAmt(gateDmg); if (bdoorDmg) shootBunker(bdoorDmg);
    for (const id of minesHit) shootMine(id, P);
    let kill = false;
    for (const [e, a] of byE) { kill = e.health - a.d * K() <= 0 || kill; damage(e, a.d * K(), P, 'gun', a.head); }
    if (byE.size) hitFeedback([...byE.values()].some(a => a.head), kill);
    if (g.grow > 0) heat = Math.min(1, heat + 1 / 8);
    const k = (P.h < STAND_H ? 0.7 : 1) * (1 - 0.3 * adsK);
    punch += w.kick * 0.6 * k; vmKick = 1; flashT = GUN_FX[s.model] ? GUN_FX[s.model].flash.life : 0.04;
    muzzleFx(s.model, start, new V3(0, 0, -1).applyQuaternion(q), true, P.id);
    for (const k of [].concat(s.sound || w.sound)) { sfx(k, 1); netFx({ t: 'sf', k, p: arr(P.pos), r: 60, g: 1 }); }
  }
  // The F tube: a mortar. It lobs an F battery like a grenade throw, only harder, and it goes off where it lands
  // (the game's grenades, with impact set)
  function fireTube() {
    const dir = new V3(0, 0, -1).applyQuaternion(aimQ()), start = vmMuzzleWorld();
    const v = dir.clone().multiplyScalar(S.tube.launch); v.y += 4.5; v.x += P.vel.x * 0.5; v.z += P.vel.z * 0.5; // as throwNow
    throwNade(P, myEye.clone().addScaledVector(dir, 0.6), v, 15, true);
    punch += WEAPONS.bazooka.kick * 0.8; vmKick = 1; flashT = GUN_FX.bazooka.flash.life;
    muzzleFx('bazooka', start, dir, true, P.id); sfx('bazooka', 1); netFx({ t: 'sf', k: 'bazooka', p: arr(P.pos), r: 90, g: 1 });
  }
  function knife() {
    knifeCd = 0.75; knifeT = 0.6;
    const fx = -Math.sin(P.yaw), fz = -Math.cos(P.yaw);
    let bd = S.knife.reach + 0.3, ent = null;
    for (const e of ents) {
      if (e === P || !e.alive || Math.abs(e.pos.y - P.pos.y) > 1.2) continue;
      const dx = e.pos.x - P.pos.x, dz = e.pos.z - P.pos.z, d = Math.hypot(dx, dz);
      if (d < bd && (dx * fx + dz * fz) / Math.max(d, 1e-3) > 0.7) { ent = e; bd = d; }
    }
    if (ent) { // behind them: they face the way you're stabbing
      const back = fwdOf(ent).dot(new V3(ent.pos.x - P.pos.x, 0, ent.pos.z - P.pos.z).normalize()) > 0.5, d = knifeDmg(back);
      const kill = ent.health - d <= 0; damage(ent, d, P, 'knife', false); hitFeedback(false, kill);
    }
  }
  // F: a quick stab with whatever you're holding
  function quickKnife() {
    if (!P.alive || knifeCd > 0 || cooking >= 0 || P.reloading > 0 || monitorOpen || VEH.noGuns) return;
    shotN++; knife();
  }
  const knifeDmg = back => (back ? S.knife.back : S.knife.front) * K(); // in the game's health
  const clipOf = s => (s.kind === 'tube' ? 1 : s.kind === 'gun' ? gunOf(s).clip : 0);
  const reloadOf = s => (s.kind === 'tube' ? S.tube.reload : gunOf(s).reload);
  let outT = 0;
  function outOf(t) { if (outT > 0) return; outT = 1; note(`Out of ${AMMOS[t]}: walk over a pack`, 1.2); }
  function startReload() {
    const s = slot(); if (!s.model || P.reloading > 0 || P.ammo >= clipOf(s)) return;
    if (!has(s.ammo)) { outOf(s.ammo); return; }
    P.reloading = reloadOf(s); WEAPONS[s.model].reload = P.reloading; heat = 0;
  }
  function throwNow() {
    const fuse = Math.max(0.05, S.throw.fuse - cooking); cooking = -1;
    const dir = new V3(0, 0, -1).applyQuaternion(aimQ()), v = dir.clone().multiplyScalar(25); v.y += 4.5; v.x += P.vel.x * 0.5; v.z += P.vel.z * 0.5;
    throwNade(P, myEye.clone().addScaledVector(dir, 0.4), v, fuse);
    throwT = 0.4; gun.cd = 0.6; shotN++;
  }
  // Replaces the game's updateGun in the range
  function updateGun(dt) {
    gun.cd -= dt; knifeCd -= dt; gun.spray = 0; gun.burstLeft = 0;
    heat = Math.max(0, heat - dt * (mouseDown ? 0.6 : 2.5));
    if (!hot && hotBack > 0 && (hotBack -= dt) <= 0) backFromNade(); // (after a grenade off F, or the touch Frag button)
    if (cur > HANDS && !has('F') && cooking < 0 && throwT <= 0 && !hot && hotBack <= 0) pick(HANDS); // that was your last F battery
    const s = slot();
    if (!s.model && s.kind !== 'throw' && s.kind !== 'spray') { mouseRight = false; tAim = false; } // nothing to aim down (the grenade's right-click makes a mine; the spray can's a fine line)
    if (s.kind === 'spray') return; // art.js paints with it
    if (!P.alive || monitorOpen || VEH.noGuns) return;
    if (P.reloading > 0) { P.reloading -= dt; if (P.reloading <= 0) { P.reloading = 0; if (spend(s.ammo)) P.ammo = clipOf(s); } return; }
    if (switchT > 0) { if (s.kind !== 'throw') clickQ = false; return; }
    if (s.model && P.ammo <= 0) { if (has(s.ammo)) startReload(); else if (clickQ || mouseDown) { clickQ = false; outOf(s.ammo); } return; }
    if (s.kind === 'gun' || s.kind === 'tube') {
      const g = s.kind === 'gun' ? gunOf(s) : null, want = g && g.auto ? mouseDown : clickQ;
      if (!want || gun.cd > 0) return;
      clickQ = false; gun.cd = s.kind === 'tube' ? 0.3 : 1 / g.rate; P.ammo--; shotN++;
      if (s.kind === 'tube') fireTube(); else fireGun(s);
      if (P.ammo <= 0) startReload();
      return;
    }
    if (s.kind === 'knife') { if (clickQ && knifeCd <= 0) { clickQ = false; shotN++; knife(); } return; }
    // Grenade: hold to cook (it beeps faster as the fuse runs down), let go to throw. With right-click held, a click sets it as a mine.
    if (hot) { clickQ = false; cookHot(dt); return; } // touch's Frag button: a grenade straight from an F battery (hotDown / hotUp)
    const fresh = clickQ; clickQ = false;
    if (cooking < 0 && mineMode()) { if (fresh && gun.cd <= 0 && throwT <= 0) { if (!spend('F')) { outOf('F'); return; } gun.cd = 0.5; throwT = 0.3; shotN++; placeMine(); } return; }
    if (cooking < 0) { if (fresh && mouseDown && gun.cd <= 0 && throwT <= 0) { if (!spend('F')) { outOf('F'); gun.cd = 0.5; return; } cooking = 0; beepT = 0.5; sPin(); } return; }
    cooking += dt; beepT -= dt;
    if (beepT <= 0) { const rem = S.throw.fuse - cooking; beepT = rem > 1.5 ? 0.5 : rem > 0.75 ? 0.25 : 0.12; sBeep(1300 + (1 - rem / S.throw.fuse) * 1000); }
    if (cooking >= S.throw.fuse) { cooking = -1; gun.cd = 0.8; shotN++; blast(new V3(P.pos.x, P.pos.y + 1.2, P.pos.z), P, 'throw'); note('Held it too long', 1.5); return; }
    if (!mouseDown) throwNow();
  }

  // ---------------------------------------------------------------- ?dev: the grenade on F
  // F down takes out an F battery and pulls the pin; right-click before it goes off makes it a mine (the fuse stops);
  // F up throws it, or sets the mine down where you're looking. Then back to what you had in your hands.
  function hotDown() {
    if (!P.alive || hot || hotBack > 0 || cooking >= 0 || throwT > 0 || monitorOpen || VEH.noGuns || P.reloading > 0) return;
    if (!has('F')) { outOf('F'); return; }
    hot = { back: cur }; hotPrev = cur; pick(HANDS + 1, true); spend('F');
    cooking = 0; beepT = 0.5; hotMine = false; sPin();
    hint('hotnade', typeof isTouch !== 'undefined' && isTouch ? 'Let go of Frag to throw' : 'Let go of F to throw. Right-click while holding F to make it a mine: it sticks to the floor, wall or ceiling you look at', 4, 6);
  }
  function cookHot(dt) {
    if (hotMine) return;
    if (mineMode()) { hotMine = true; sBeep(1500); return; }
    cooking += dt; beepT -= dt;
    if (beepT <= 0) { const rem = S.throw.fuse - cooking; beepT = rem > 1.5 ? 0.5 : rem > 0.75 ? 0.25 : 0.12; sBeep(1300 + (1 - rem / S.throw.fuse) * 1000); }
    if (cooking >= S.throw.fuse) { cooking = -1; hot = null; hotBack = 0.6; shotN++; blast(new V3(P.pos.x, P.pos.y + 1.2, P.pos.z), P, 'throw'); note('Held it too long', 1.5); }
  }
  function hotUp() {
    if (!hot) return;
    if (P.alive && hotMine) { cooking = -1; throwT = 0.3; gun.cd = 0.5; shotN++; placeMine(); }
    else if (P.alive && cooking >= 0) throwNow();
    cooking = -1; hot = null; hotMine = false; hotBack = 0.35;
  }
  function backFromNade() {
    hotBack = 0; const b = hotPrev; hot = null;
    const want = [b, ...held.map((h, i) => i)].find(i => i < HANDS ? !!held[i] : i === HANDS);
    pick(want === undefined ? HANDS : want, true);
  }

  // ---------------------------------------------------------------- items (items.js runs them; these are your hands' side)
  const itemSlot = u => (u[0] === 's' ? byId('spray' + u.slice(1)) : null);
  // Something off the ground (the host says it's yours): into a free hand, or the flashlight
  function giveItem(u) {
    const sl = itemSlot(u); if (!sl) return false;
    if (held.includes(sl) || heldU.includes(u)) return false;
    const i = held.indexOf(null); if (i < 0) { if (fullT <= 0) { fullT = 2; note('Your hands are full (3 things): Q drops the one you hold', 1.8); } return false; }
    held[i] = sl; heldU[i] = u; syncInv();
    note(`Picked up the ${sl.name}${sl.kind === 'spray' ? ' can: click sprays, right-click draws a fine line' : ''}`, 2);
    if (cur === HANDS && !hot) pick(i); else drawSlots();
    return true;
  }
  // The host took it back (you died, the round started again, or it went to someone else first)
  function loseItem(u) {
    const i = heldU.indexOf(u); if (i < 0) return;
    held[i] = null; heldU[i] = null; syncInv();
    if (i === cur) { const next = held.findIndex(Boolean); pick(next < 0 ? HANDS : next, true); } else drawSlots();
  }

  // ---------------------------------------------------------------- picking a weapon
  // i: a hand (0-2), HANDS for the knife, then the grenade
  function pick(i, instant) {
    if (!canPick(i)) return;
    if (i === cur && !instant) return;
    const was = slot();
    if (cooking >= 0) throwNow(); // switching away lobs a cooked grenade rather than losing it
    if (!was.model && P.ammoBy[curW]) { P.ammo = P.ammoBy[curW].mag; P.reserve = 0; } // (P.ammo means nothing in the hands slots)
    cur = i; heat = 0; gun.cd = 0; clickQ = false;
    const s = slot();
    if (s.model) { selectWeapon(s.model, instant); P.ammo = Math.min(P.ammo, clipOf(s)); P.reserve = 0; }
    else { syncAmmo(); for (const k in VMW) VMW[k].holder.visible = false; P.ammo = 0; P.reserve = 0; P.reloading = 0; if (!instant) switchT = 0.3; }
    drawSlots();
  }
  const syncInv = () => { P.inv = held.filter(h => h && h.model).map(h => h.model); };
  // In the range you start with the knife and nothing else; in a game with the Pistol and Carbine loaded, D and F batteries and your flashlight
  function kit() {
    held.fill(null); heldU.fill(null); hot = null; lightOn = nightOn(); // everyone has a flashlight: on to start at dusk and night (L)
    if (lightOn) hint('flashlight', 'L turns your flashlight on or off', 3);
    hot = null; hotMine = false; hotBack = 0; for (const k in bats) bats[k] = 0; P.nades = 0; cooking = -1;
    P.ammoBy = {}; for (const sl of SLOTS) if (sl.model) P.ammoBy[sl.model] = { mag: 0, res: 0 };
    curW = 'pistol'; P.ammo = 0; P.reserve = 0; cur = HANDS;
    held[0] = byId('pistol'); P.ammoBy.pistol.mag = clipOf(held[0]); bats.D = Math.min(S.ammo.D.max, S.game.startD); bats.F = Math.min(S.ammo.F.max, S.game.startF);
    held[1] = byId('carbine'); P.ammoBy.carbine.mag = clipOf(held[1]); // everyone starts with the Pistol and the Carbine, both loaded (the rest are found on the map)
    syncInv(); pick(1, true);
  }
  // A weapon from a pickup in a game (model: the game's weapon id; ammo: rounds it carries, or none for a full clip)
  const BY_MODEL = { pistol: 'pistol', carbine: 'carbine', uzi: 'izu', shotgun: 'battery', rifle: 'rifle', bazooka: 'tube' };
  function give(model, ammo) {
    const sl = byId(BY_MODEL[model]); if (!sl) return false;
    if (held.some(h => h === sl)) return false;
    if (held.indexOf(null) < 0) { if (fullT <= 0) { fullT = 2; note('Your hands are full (3 weapons): Q drops the one you hold', 1.8); } return false; }
    // ammo: rounds that come with it (none given: from its spot, a full clip, and the rifle a spare clip as well). The rifle's
    // rounds past the clip in it are spare clips
    const c = clipOf(sl), total = ammo === undefined ? (sl.ammo === 'R' ? 2 * c : c) : Math.max(0, ammo);
    if (!take({ id: sl.id, load: Math.min(c, total) })) return false;
    if (sl.ammo === 'R' && c > 0) { const spare = Math.round((total - Math.min(c, total)) / c); if (spare > 0) { bats.R = Math.min(S.ammo.R.max, bats.R + spare); note(`Picked up the ${sl.name}, with ${spare + (total >= c ? 1 : 0)} clips of ${c}`, 2); } }
    return true;
  }
  // A pack of batteries (k: D, F or R; size: how many are in it, a full pack if not given); returns how many you could carry
  function addBats(k, size) {
    const a = S.ammo[k]; if (!a) return 0;
    const n = Math.min(size === undefined ? a.pack : size, a.max - bats[k]); if (n <= 0) return 0;
    bats[k] += n; note(`+${n} ${n === 1 ? AMMO[k] : AMMOS[k]}`, 1);
    return n;
  }
  // A weapon off the ground into your first free hand; you take it in hand if you were holding the knife
  function take(it) {
    const i = held.indexOf(null); if (i < 0) return false;
    const sl = byId(it.id); held[i] = sl; syncInv();
    if (sl.model) P.ammoBy[sl.model] = { mag: it.load, res: 0 };
    note(`Picked up the ${sl.name}`, 1.2);
    if (cur === HANDS) pick(i); else drawSlots();
    return true;
  }
  // Q: throw the weapon in your hands a few metres ahead (with what's left in its clip), then take the next one
  function drop() {
    const s = slot(); if (cur >= HANDS || !held[cur] || cooking >= 0) return;
    syncAmmo();
    const load = s.model ? P.ammoBy[s.model].mag : 0;
    const f = new V3(-Math.sin(P.yaw), 0, -Math.cos(P.yaw));
    const it = makeItem(s.id, new V3(P.pos.x + f.x * 0.5, P.pos.y + 1.3, P.pos.z + f.z * 0.5), load);
    it.vel = f.multiplyScalar(7).setY(3.5); it.armed = false;
    held[cur] = null; syncInv(); P.reloading = 0;
    const next = held.findIndex(Boolean); pick(next < 0 ? HANDS : next);
  }

  // ---------------------------------------------------------------- weapons and ammo packs on the ground
  const items = [], packs = [];
  let fullT = 0;
  function itemMesh(sl) {
    if (sl.model && WEAPONS[sl.model] && WEAPONS[sl.model].scene) { const g = centeredClone(WEAPONS[sl.model].scene, WEAPONS[sl.model].yaw); g.scale.setScalar(1.2); return g; }
    const g = new THREE.Group();
    if (NADE_MODEL) { const c = NADE_MODEL.clone(true); c.scale.setScalar(2.2); c.position.y = -0.15; if (sl.kind === 'mine') c.rotation.z = Math.PI / 2; g.add(c); }
    else g.add(new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), toonMat({ color: 0x3d4a2a })));
    if (sl.kind === 'mine') { const l = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff2a1a })); l.position.y = 0.16; g.add(l); }
    return g;
  }
  function makeItem(id, pos, load) {
    const mesh = itemMesh(byId(id)); mesh.position.copy(pos); scene.add(mesh);
    const it = { id, pos: pos.clone(), mesh, load, vel: null, armed: true }; items.push(it); return it;
  }
  const fresh = sl => (sl.model ? clipOf(sl) : 0); // a weapon from its spot comes with its clip full
  function packMesh(t) {
    const g = new THREE.Group(), m = toonMat({ color: new THREE.Color(COL[t]).getHex() });
    const len = t === 'R' ? 0.32 : t === 'F' ? 0.36 : 0.26;
    for (let k = 0; k < (t === 'F' || t === 'R' ? 2 : 4); k++) { // the batteries themselves, side by side, standing on the group's origin (it sits on the ground)
      const b = new THREE.Mesh(t === 'R' ? new THREE.CylinderGeometry(0.035, 0.035, len, 10) : new THREE.CylinderGeometry(0.08, 0.08, len, 14), m);
      b.position.set((k - (t === 'F' || t === 'R' ? 0.5 : 1.5)) * (t === 'R' ? 0.1 : 0.19), len / 2, 0); b.castShadow = true; g.add(b);
    }
    return g;
  }
  // A dropped weapon flies, lands and slides to a stop (in a game it then becomes one of the game's pickups)
  function fly(it, dt) {
    const sub = Math.max(1, Math.min(12, Math.ceil(it.vel.length() * dt / 0.1))), h = dt / sub;
    let ground = false;
    for (let k = 0; k < sub; k++) {
      it.vel.y -= GRAV * h;
      for (const ax of ['x', 'y', 'z']) {
        const p = it.pos.clone(); p[ax] += it.vel[ax] * h;
        if (solidPt(p.x, p.y, p.z, 0.12)) { if (ax === 'y' && it.vel.y < 0) ground = true; it.vel[ax] = 0; for (const o of ['x', 'z']) if (o !== ax) it.vel[o] *= 0.85; }
        else it.pos[ax] = p[ax];
      }
    }
    if (it.pos.y < -20) { it.gone = true; return; } // off the world
    if (ground && Math.hypot(it.vel.x, it.vel.z) < 0.4) {
      it.vel = null; it.pos.y -= 0.12;
      { // the host keeps the pickups, so a guest's dropped weapon is handed to it
        const sl = byId(it.id);
        if (NET.role === 'guest') { if (NET.conn && NET.conn.open) NET.conn.send({ t: 'drop', id: sl.model, p: arr(it.pos), a: it.load }); }
        else addPickup(sl.model, it.pos, { dropped: true, ammo: it.load, life: S.game.dropLife });
        it.gone = true;
      }
    }
  }
  const near = (p, r) => Math.hypot(P.pos.x - p.x, P.pos.z - p.z) < r && Math.abs(P.pos.y - p.y) < 1.3;
  function updateGround(dt, now) {
    fullT -= dt; outT -= dt;
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i];
      if (it.vel) { fly(it, dt); it.mesh.position.set(it.pos.x, it.pos.y + 0.12, it.pos.z); it.mesh.rotation.y += dt * 7; if (it.gone) { scene.remove(it.mesh); items.splice(i, 1); } continue; }
    }
  }

  // ---------------------------------------------------------------- HUD: the weapon list and the numbers
  const css = document.createElement('style');
  css.textContent = `
  #rslots{position:fixed;left:14px;top:50%;transform:translateY(-50%);z-index:6;display:none;flex-direction:column;gap:3px;font:600 13px/1.2 system-ui,sans-serif;color:#e8ece6;pointer-events:none}
  #rslots div{background:rgba(0,0,0,.45);padding:4px 9px;border-radius:3px;border-left:3px solid transparent}
  #rslots div.on{background:rgba(0,0,0,.75);border-left-color:#f0874d;color:#fff}
  #rslots div.no{opacity:.4}#rslots div.am{margin-top:4px;font-weight:500}#rslots b{font-weight:700}
  #rslots small{opacity:.6;font-weight:500}
  #rhp{position:fixed;left:14px;top:14px;z-index:6;width:46px;height:46px;border-radius:50%;display:none;transition:background-color .15s;pointer-events:none}
  body.range-on #hpbar{visibility:hidden}
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
  #rcross i{position:absolute;left:50%;top:50%;width:2px;height:20px;margin:-10px 0 0 -1px;background:#e51c1c;display:none}#rcross i:first-child{transform:rotate(45deg)}#rcross i:last-child{transform:rotate(-45deg)}
  #rcross.kill i{display:block}
  body.range-on .ch{display:none}
  body.touch #rslots,body.touch #rhp{display:none!important}`;
  document.head.append(css);
  const slotsEl = document.createElement('div'); slotsEl.id = 'rslots';

  const panel = document.createElement('div'); panel.id = 'rpanel';
  const cross = document.createElement('div'); cross.id = 'rcross';
  const hpEl = document.createElement('div'); hpEl.id = 'rhp';
  document.body.append(slotsEl, panel, hpEl); ($('hud') || document.body).append(cross);
  let crossR = 0, crossV = 0, hitT = 0, hitCol = '#fff', killT = 0, crossCss = '';
  cross.innerHTML = '<i></i><i></i>'; // the kill X's two strokes
  // A health circle over each player's head (and over their name when it shows), so you can see who's hurt
  function hpDot(e) {
    if (!e.hpDot) {
      const c = document.createElement('canvas'); c.width = c.height = 64;
      e.hpDot = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), sizeAttenuation: false, transparent: true, depthWrite: false }));
      e.hpDot.scale.set(0.024, 0.024, 1); e.hpDot.center.set(0.5, -0.8); e.hpDot.renderOrder = 11; e.hpDot.userData.c = c; e.hpDot.userData.k = -1; // (the circle fills 56 of the 64 pixels: about the height of the name's letters)
    }
    const d = e.hpDot, shown = live() && e.mesh && e.alive && e.tagA > 0.01;   // only while the name shows: after the crosshair has rested on them a moment
    if (e.mesh && d.parent !== e.mesh) e.mesh.add(d);
    d.visible = !!shown; if (!shown) return;
    d.material.opacity = Math.min(1, e.tagA / TAG_MAX * 0.9); // and it fades in and out with the name
    d.position.y = e.tag ? e.tag.position.y : (e.rig ? e.rig.model.headY : 1.7) + 0.5; // (above the name)
    const h = Math.ceil(e.health / K() - 1e-6);
    if (h !== d.userData.k) { d.userData.k = h; const x = d.userData.c.getContext('2d'); x.clearRect(0, 0, 64, 64); x.beginPath(); x.arc(32, 32, 28, 0, Math.PI * 2); x.fillStyle = hpColour(h); x.fill(); d.material.map.needsUpdate = true; }
  }
  // ---------------------------------------------------------------- what everyone carries, on their character
  // The weapons not in their hands hang on their back (the Pistol in a holster at the right hip); their batteries ride on the
  // belt. A first pass for other players to read at a glance, until the art and animation do it properly.
  // Bots carry rounds rather than batteries, so they only show their grenades (as F batteries).
  function gearOf(e) {
    if (e === P) return { inv: P.inv || [], cur: curW, b: [bats.A, bats.D, bats.F, bats.R] };
    if (e.isReplica) return { inv: e.gInv || [], cur: e.wpn, b: e.gBats || [0, 0, 0, 0] };
    return { inv: e.inv || [], cur: e.wpn, b: e.isRemote ? e.gBats || [0, 0, 0, 0] : [0, 0, e.nades | 0, 0] };
  }
  const gearMat = {}, GEAR_BAT = { A: [0.025, 0.08], D: [0.035, 0.1], R: [0.012, 0.075] };
  const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion(), _ax = { x: new V3(1, 0, 0), y: new V3(0, 1, 0), z: new V3(0, 0, 1) };
  function gear(e) {
    const r = e.rig; if (!r || !r.root) return;
    const g = gearOf(e), keep = g.inv.filter(id => id !== g.cur && WEAPONS[id]);
    const key = live() ? keep.join() + '|' + g.b.join() : '';
    if (r.gearKey === key) return;
    r.gearKey = key;
    if (r.gear) { if (r.gear.parent) r.gear.parent.remove(r.gear); r.gear = null; }
    if (!key) return;
    const sp = r.root.getObjectByName('DEF-Spine1'), up = r.upper && r.upper.find(u => u.b === sp); if (!sp || !up) return;
    // The spine's rest pose, once: gear hangs in the body's own frame (forward +z, up +y), from the spine joint
    if (!r.gearM) {
      const pos = sp.position.clone(), q = sp.quaternion.clone();
      sp.position.copy(up.pos); sp.quaternion.copy(up.rest); r.wrap.updateMatrixWorld(true);
      const rel = new THREE.Matrix4().copy(r.wrap.matrixWorld).invert().multiply(sp.matrixWorld), at = new V3().setFromMatrixPosition(rel);
      r.gearM = rel.clone().invert().multiply(new THREE.Matrix4().makeTranslation(at.x, at.y, at.z)); r.gearY = at.y;
      sp.position.copy(pos); sp.quaternion.copy(q); r.wrap.updateMatrixWorld(true);
    }
    const holder = new THREE.Group(); holder.matrixAutoUpdate = false; holder.matrix.copy(r.gearM);
    const body = new THREE.Group(); body.rotation.y = RIG_TURN; holder.add(body); // turned with the body
    const headY = r.model.headY || 1.7, backY = headY * 0.78 - r.gearY, beltY = headY * 0.56 - r.gearY; // (by proportion: the characters differ in size)
    const gun = id => { const w = WEAPONS[id], m = centeredClone(w.scene, w.yaw); m.traverse(o => { if (o.isMesh) o.castShadow = true; }); return m; };
    // Back: barrels up, flat side out, crossed when there are two
    const back = keep.filter(id => id !== 'pistol'), slots = back.length === 1 ? [[0, 0.15]] : [[0.06, 0.4], [-0.06, -0.4], [0, 0]];
    back.slice(0, 3).forEach((id, i) => {
      const m = gun(id), [x, roll] = slots[i];
      m.quaternion.copy(_q1.setFromAxisAngle(_ax.z, roll)).multiply(_q2.setFromAxisAngle(_ax.y, Math.PI / 2)).multiply(_q3.setFromAxisAngle(_ax.x, Math.PI / 2));
      m.position.set(x, backY, -0.19 - i * 0.03); body.add(m);
    });
    if (keep.includes('pistol')) { const m = gun('pistol'); m.rotation.x = -Math.PI / 2; m.position.set(-0.23, beltY - 0.05, 0.03); body.add(m); }
    // Belt: the batteries round the back, A then D then F then rifle rounds
    const list = []; ['A', 'D', 'F', 'R'].forEach((k, j) => { for (let n = 0; n < Math.min(4, g.b[j] | 0); n++) list.push(k); });
    const arc = Math.min(1.4, list.length * 0.16);
    list.forEach((k, i) => {
      const mat = gearMat[k] || (gearMat[k] = toonMat({ color: new THREE.Color(COL[k]).getHex() }));
      const m = k === 'F' ? new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), mat) : new THREE.Mesh(new THREE.CylinderGeometry(GEAR_BAT[k][0], GEAR_BAT[k][0], GEAR_BAT[k][1], 10), mat);
      const th = Math.PI + (list.length > 1 ? (i / (list.length - 1) - 0.5) * 2 * arc : 0);
      m.position.set(Math.sin(th) * 0.2, beltY, Math.cos(th) * 0.2); m.castShadow = true; body.add(m);
    });
    sp.add(holder); r.gear = holder;
  }
  function hitFeedback(head, kill) { if (kill) killT = 0.5; else { hitT = 0.12; hitCol = head ? '#e51c1c' : '#ffcc00'; } }
  const batsTxt = t => (S.ammo.infinite ? '∞' : bats[t]);
  let slotsKey = '';
  function drawSlots() {
    const keyOf = i => (i < HANDS ? i + 1 : i === HANDS ? 'X' : 'F');
    const hands = [0, 1, 2, 3, 4].map(i => { const s = handSlot(i); return s ? `<div class="${i === cur ? 'on' : canPick(i) ? '' : 'no'}">${keyOf(i)}&nbsp; ${s.kind === 'throw' && i === cur && (hot ? hotMine : mineMode()) ? 'Mine' : s.name}${s.ammo ? ` <small>${s.ammo === 'R' ? 'clips' : s.ammo} ×${batsTxt(s.ammo)}</small>` : ''}</div>` : `<div class="no">${i + 1}&nbsp; —</div>`; });
    const am = ['D', 'F', ...(bats.R || held.some(h => h && h.ammo === 'R') ? ['R'] : [])].map(t => `<b style="color:${COL[t]}">${t === 'R' ? 'Rifle clips' : t}</b> ${batsTxt(t)}`).join(' · ');
    const hk = '';;
    slotsEl.innerHTML = hands.join('') + hk + `<div class="am">${am}</div>`;
  }
  drawSlots();
  const fmt = (n, step) => (step >= 1 ? String(Math.round(n)) : step >= 0.1 ? (+n).toFixed(1) : (+n).toFixed(2));
  const plural = (n, a) => `${n} ${a}${n === 1 ? '' : 's'}`;
  // How long n shots take from the first to the last, reloading whenever the clip runs out
  function shotsTime(g, n) { if (n <= 1) return 0; const reloads = Math.floor((n - 1) / g.clip); return (n - 1 - reloads) / g.rate + reloads * g.reload; }
  function killMath(g) {
    if (g.count > 1) {
      const nb = Math.ceil(LIFE / g.body), nh = Math.ceil(LIFE / g.head);
      return `All ${g.count} pellets on the body do ${g.count * g.body}. One shot kills with ${nb} of them on the body (or ${nh} on the head)${nb > g.count ? `, so it takes ${Math.ceil(nb / g.count)} shots (${shotsTime(g, Math.ceil(nb / g.count)).toFixed(2)} s)` : ''}.`;
    }
    const nb = Math.ceil(LIFE / g.body), nh = Math.ceil(LIFE / g.head), t = n => (n === 1 ? 'instant' : shotsTime(g, n).toFixed(2) + ' s');
    return `Body: ${plural(nb, 'shot')} to kill (${t(nb)}). Head: ${plural(nh, 'shot')} (${t(nh)}).`;
  }
  function blastMath() { const r = S.blast.ring, n = S.blast.max, h = Math.ceil(n / 2); return n === 1 ? `1 within ${fmt(r, 0.1)} m, nothing past that.` : `${n} within ${fmt(r, 0.1)} m, then one less every ${fmt(r, 0.1)} m: ${h} at ${fmt((n - h) * r, 0.1)} m, 1 at ${fmt((n - 1) * r, 0.1)} m, nothing past ${fmt(n * r, 0.1)} m.`; }

  // ---------------------------------------------------------------- the Tab panel
  // Projectile rows: [key, label, min, max, step, unit, help, only this gun]
  const GUN_ROWS = [
    ['body', 'Body damage', 1, 'life', 1, '', ''],
    ['head', 'Head damage', 1, 'life', 1, '', ''],
    ['spread', 'Spread', 0, 30, 0.5, '', 'How wide the shots land: N covers a circle N × 10 cm across at 10 m (twice that at 20 m). 0 goes exactly where you aim.'],
    ['grow', 'Spread growth (recoil)', 0, 20, 0.5, '', 'Extra spread you build up holding the trigger: all of it after 8 shots in a row. It settles back once you stop.'],
    ['fall', 'Damage falls off over', 0, 200, 5, 'm', 'Distance at which the damage has dropped to the amount below. 0: full damage at any range (the Master Rifle), a Battery Gun might use 30.'],
    ['fallMin', 'Damage left at that range', 0, 1, 0.05, '×', 'Of the body and head damage above. It falls off in a straight line from point blank; past that range it stays here.'],
    ['rate', 'Rate of fire', 0.5, 20, 0.5, 'shots/s', ''],
    ['clip', 'Clip size', 1, 60, 1, 'shots', 'Shots per battery (or per load) before a reload.'],
    ['count', 'Pellets per shot', 1, 20, 1, '', 'Each pellet does the damage above.', 'battery'],
    ['reload', 'Reload time', 0.3, 6, 0.1, 's', ''],
    ['moving', 'Moving penalty', 0, 5, 0.05, '×', 'Multiplies the walking, running and in-the-air spread (under Moving) for this gun. 0: as steady on the move as standing still; above 1: worse than the usual penalty.'],
    ['aim', 'Aiming down sights multiplies spread by', 0.1, 1, 0.05, '×', '1: aiming doesn\'t tighten it.'],
    ['aimMove', 'Aiming multiplies the moving penalty by', 0.1, 1, 0.05, '×', 'The spread from walking, running and jumping while you aim. 1: aiming doesn\'t help on the move, so you have to stop to be accurate.'],
  ];
  // Other rows: [path, label, min, max, step, unit, help]
  const OTHER = [
    ['Explosive (F batteries, all three ways)', [
      ['blast.max', 'Centre damage', 1, 'life', 1, '', 'What a blast does in its middle ring. Each ring out does one less.'],
      ['blast.ring', 'Ring width', 0.3, 3, 0.1, 'm', ''],
      ['throw.fuse', 'Grenade fuse', 0.5, 5, 0.25, 's', 'From pulling the pin. Hold the button to cook it.'],
      ['mine.arm', 'Mine arms after', 0, 5, 0.25, 's', ''],
      ['mine.radius', 'Mine trigger distance', 0.5, 6, 0.25, 'm', 'Anyone this close sets it off (you too).'],
      ['mine.warn', 'Mine warning beeps', 0, 3, 0.1, 's', 'Time to run between setting it off and the blast.'],
      ['tube.launch', 'F tube launch speed', 10, 80, 1, 'm/s', 'How hard it lobs the F battery (the grenade throw is 25). It goes off where it lands.'],
      ['tube.reload', 'F tube reload', 0.5, 8, 0.1, 's', ''],
      ['tube.slow', 'Carrying the F tube, you move at', 0.2, 1, 0.05, '×', 'Of your usual speed, whichever weapon is in your hands.'],
    ], 'blast'],
    ['Knife', [
      ['knife.front', 'From the front', 1, 'life', 1, '', ''],
      ['knife.back', 'From behind', 1, 'life', 1, '', ''],
      ['knife.reach', 'Reach', 1, 4, 0.1, 'm', ''],
    ]],
    ['Moving (each gun takes its share: Moving penalty)', [
      ['move.walk', 'Walking adds', 0, 20, 0.5, 'spread', ''],
      ['move.run', 'Running adds', 0, 30, 0.5, 'spread', ''],
      ['move.jump', 'In the air adds', 0, 30, 0.5, 'spread', ''],
      ['move.crouch', 'Crouching multiplies by', 0.1, 1, 0.05, '×', ''],
    ]],
    ['Ammo', [
      ['ammo.D.pack', 'D batteries in a pack', 1, 10, 1, '', 'Every gun but the Master Rifle: one battery fills the clip.'],
      ['ammo.D.max', 'Most D batteries you can carry', 1, 30, 1, '', ''],
      ['ammo.F.pack', 'F batteries in a pack', 1, 10, 1, '', 'Each one is a grenade or a mine (hands 5 and 6), or an F tube shot.'],
      ['ammo.F.max', 'Most F batteries you can carry', 1, 30, 1, '', ''],
      ['ammo.R.max', 'Most spare rifle clips you can carry', 1, 10, 1, '', 'The rifle comes with one in it and one spare.'],
      ['ammo.respawn', 'Packs come back after', 1, 60, 1, 's', 'And a weapon nobody has, held or lying around, comes back to its spot.'],
    ], 'ammo'],
    ['Crosshair', [
      ['cross.opacity', 'Opacity', 0, 100, 5, '%', 'How solid the crosshair is: 0 hides it. Yours alone.'],
      ['cross.ease', 'Circle smoothing', 0.02, 0.5, 0.01, 's', 'How long the circle takes to follow the spread, easing in and out. The spread itself changes at once.'],
    ]],
    ['In a game', [
      ['game.life', 'Everyone\'s health', 4, MAXLIFE, 1, '', 'The same for everyone, you, the bots and anyone who joins (the host\'s number). Damage above is out of this.'],
      ['game.gateHp', 'Fort gate health', 50, 5000, 50, '', 'How much the gate takes to break (a gun\'s body damage counts five times, a blast ten). Takes effect the next time it\'s shut.'],
      ['game.doorHp', 'Bunker door health', 20, 2000, 20, '', 'The same for the locked bunker door, from the next time it\'s locked.'],
      ['game.startD', 'D batteries you spawn with', 0, 8, 1, '', 'Besides the Pistol and the Carbine, loaded.'],
      ['game.startF', 'F batteries you spawn with', 0, 4, 1, '', 'Grenades and mines.'],
      ['game.packs', 'Packs come back after', 5, 120, 5, 's', 'The level\'s ammo spots are D packs (F where the grenades were). What falls from the dead never goes away.'],
      ['game.dropD', 'Most D batteries the dead drop', 0, 8, 1, '', 'They drop half of what they carried (rounded up), up to this many.'],
      ['game.dropF', 'Most F batteries the dead drop', 0, 4, 1, '', 'The same for F batteries.'],
      ['game.dropLife', 'Dropped weapons lie there for', 5, 120, 5, 's', 'Then a Pistol or Carbine is gone, and anything else goes back to its spot on the map.'],
    ]],
  ];
  const getP = p => p.split('.').reduce((o, k) => o[k], S);
  const setP = (p, v) => { const ks = p.split('.'), last = ks.pop(); ks.reduce((o, k) => o[k], S)[last] = v; };
  function buildPanel() {
    const s = slot();
    let html = `<h2>Weapon settings</h2><p class="sub">${NET.role === 'guest' ? 'The host\'s settings apply to everyone in this game; only the crosshair is yours to change.' : 'Changes take effect as you drag, and are saved in this browser' + (NET.role === 'host' && remotes.length ? '; everyone in the game plays by them' : '') + '.'} Damage is out of ${LIFE} health. The game carries on while this is open.</p>`;
    html += `<div class="math">${[...ents].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths).map(e => `${e === P ? '<b>' : ''}${esc(e.name)}${e === P ? '</b>' : ''} ${e.kills}/${e.deaths}`).join(' · ')}</div>`;
    for (const sl of SLOTS) if (sl.kind === 'gun') {
      const g = gunOf(sl);
      html += `<details data-sec="${sl.id}"${sl === s ? ' open' : ''}><summary>${sl.name}<small>${AMMOS[sl.ammo]}</small></summary><div class="math" id="rm-${sl.id}">${killMath(g)}</div>`;
      for (const [k, label, min, max0, step, unit, help, only] of GUN_ROWS) if (!only || only === sl.id) { const max = max0 === 'life' ? LIFE : max0;
        html += `<div class="row"><label for="rg-${sl.id}-${k}">${label}</label><output id="ro-${sl.id}-${k}">${fmt(g[k], step)} ${unit}</output><input type="range" id="rg-${sl.id}-${k}" data-g="${sl.id}" data-k="${k}" min="${min}" max="${max}" step="${step}" value="${g[k]}">${help ? `<div class="help">${help}</div>` : ''}</div>`; }
      html += `<label class="chk"><input type="checkbox" data-g="${sl.id}" data-k="auto"${g.auto ? ' checked' : ''}> Full auto (hold to keep firing)</label><button type="button" class="sm" data-reset="${sl.id}">Reset ${sl.name}</button></details>`;
    }
    for (const [title, rows, math] of OTHER) {
      const open = (math === 'blast' && !s.model) || (math === 'blast' && s.kind === 'tube') || (title === 'Knife' && s.kind === 'knife');
      html += `<details${open ? ' open' : ''}><summary>${title}</summary>${math === 'blast' ? `<div class="math" id="rm-blast">${blastMath()}</div><label class="chk"><input type="checkbox" data-p="blast.show"${S.blast.show ? ' checked' : ''}> Show the rings where a blast goes off</label>` : ''}${math === 'ammo' ? `<label class="chk"><input type="checkbox" data-p="ammo.infinite"${S.ammo.infinite ? ' checked' : ''}> Infinite ammo (to test a gun on its own)</label>` : ''}`;
      for (const [p, label, min, max0, step, unit, help] of rows) { const max = max0 === 'life' ? LIFE : max0;
        html += `<div class="row"><label for="rp-${p}">${label}</label><output id="rq-${p}">${fmt(getP(p), step)} ${unit}</output><input type="range" id="rp-${p}" data-p="${p}" min="${min}" max="${max}" step="${step}" value="${getP(p)}">${help ? `<div class="help">${help}</div>` : ''}</div>`; }
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
      if (p === 'game.life') { setLife(S.game.life); buildPanel(); panel.querySelector('[data-p="game.life"]').focus(); }
      const bm = panel.querySelector('#rm-blast'); if (bm) bm.textContent = blastMath();
      if (p === 'blast.ring' || p === 'blast.max') drawRings();
      save();
    });
    panel.querySelectorAll('[data-reset]').forEach(b => b.onclick = () => { S.guns[b.dataset.reset] = clone(DEFAULTS.guns[b.dataset.reset]); save(); buildPanel(); });
    if (NET.role === 'guest') { // the host's numbers: everything but your own crosshair is read-only
      panel.querySelectorAll('input,button.sm,#r-reset').forEach(el => { if (!(el.dataset.p || '').startsWith('cross.')) el.disabled = true; });
    }
    panel.querySelector('#r-go').onclick = () => setPanel(false, true);
    panel.querySelector('#r-mines').onclick = e => { clearMines(true); e.target.textContent = 'Mines cleared'; };
    panel.querySelector('#r-reset').onclick = () => { if (!confirm('Put every weapon setting back to the starting numbers?')) return; for (const k in DEFAULTS) S[k] = clone(DEFAULTS[k]); save(); drawRings(); buildPanel(); };
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
    clearMines(); for (const f of flashes) scene.remove(f.m); flashes.length = 0;
    for (const it of items) scene.remove(it.mesh); items.length = 0; for (const pk of packs) scene.remove(pk.mesh); packs.length = 0;
    for (const k in realReload) WEAPONS[k].reload = realReload[k]; // the reload animation's length goes back to the game's
    setPanel(false); built = false;
  }

  Object.defineProperty(RANGE, 'on', { get: live, configurable: true }); // the new weapons are in charge
  Object.defineProperty(RANGE, 'life', { get: () => LIFE, configurable: true }); // the Shooting Range itself
  Object.defineProperty(RANGE, 'panelOpen', { get: () => panelOpen, configurable: true });
  Object.assign(RANGE, {
    onLevel() {
      if (built) teardown();
      clearMines(); for (const it of items) scene.remove(it.mesh); items.length = 0; setPanel(false);
    },
    kit() { if (live()) kit(); },
    doorHp: (kind, base) => (live() ? (kind === 'gate' ? S.game.gateHp : S.game.doorHp) : base), give, addBats, packMesh, knifeDmg,
    mine(p, owner, n) { if (live() && p.distanceTo(owner.pos) < MINE_REACH + 2.5) addMine(p, owner, mineN3(n)); }, // a guest set one (host): within reach of their eyes, on whatever surface (n)
    mineShot(id, by) { if (live()) shootMine(id, by); }, // a guest shot one (host)
    fx(m) { if (m.t === 'wset') useSettings(m.s); else mineFx(m); }, // the host's settings and mines, on a guest
    cfg: () => S,
    bats: () => [bats.A, bats.D, bats.F, bats.R],
    // What a box gives, and how long it takes to come back
    ammoOf: model => { const sl = byId(BY_MODEL[model]); return sl ? sl.ammo : null; },
    batMax: k => (S.ammo[k] ? S.ammo[k].max : 0),
    dropBats: (k, n) => Math.min(Math.ceil(n / 2), k === 'D' ? S.game.dropD : k === 'F' ? S.game.dropF : 0), // what the dead leave of the n they carried
    clipOf: model => { const sl = byId(BY_MODEL[model]); return sl ? clipOf(sl) : 0; },
    packWait: k => (k === 'R' ? S.game.rifle : S.game.packs),
    weaponWait: () => S.game.weapons, dropLife: () => (live() ? S.game.dropLife : 30),
    // A bot's gun under the new numbers (the game's own aim and timing, these damages, rates and clips)
    botW(model) {
      const w = WEAPONS[model], sl = byId(BY_MODEL[model]); if (!sl || sl.kind !== 'gun') return w;
      const g = gunOf(sl);
      return Object.assign({}, w, { auto: g.auto, burst: 0, rate: 1 / g.rate, mag: g.clip, reload: g.reload, pellets: g.count > 1 ? g.count : 0, dmg: g.body * K(), head: g.head * K(), botHead: 0, zones: false, oneShot: false, falloff: null, rangeSpread: 0, live: true });
    },
    updateGun,
    // Draw mode (art.js) puts your weapons away (a cooked grenade is thrown, a reload stops) and brings them back as they were
    stow() { if (cooking >= 0) throwNow(); P.reloading = 0; heat = 0; clickQ = false; },
    unstow() { pick(cur, true); },
    handKind: () => slot().kind, // 'knife', 'throw' (the grenade), 'mine', 'gun', 'tube'
    inHand: () => slot().model || null, // the game's weapon id in your hands (none for the knife and the grenade)
    zooms: () => slot().id === 'carbine' || slot().id === 'rifle', // aiming goes down the barrel (the others just aim)
    next(dir) {
      if (!P.alive || hot) return;
      const can = [0, 1, 2].filter(canPick); if (!can.length) return; // just your weapons: the knife is X, the grenade F
      const i = can.indexOf(cur); pick(can[i < 0 ? (dir > 0 ? 0 : can.length - 1) : (i + dir + can.length) % can.length]);
    },
    hotDown, hotUp, quickKnife, giveItem, loseItem,
    items: () => heldU.filter(Boolean), // what you carry of items.js's things
    handItem: () => (cur < HANDS ? heldU[cur] : null),
    handsUsed: () => held.filter(Boolean).length,
    paint: () => (slot().kind === 'spray' && P.alive ? slot().c : -1), // the colour of the spray can in your hands
    lightOn: () => lightOn && P.alive && live(), // your flashlight (everyone has one: L)
    toggleLight() { if (!P.alive || !live()) return; lightOn = !lightOn; sBeep(lightOn ? 1500 : 1100); },
    keyUp() { return false; },
    key(code) {
      if (!live()) return false;
      const n = /^Digit([1-9])$/.exec(code);
      if (n) { if (P.alive && +n[1] <= HANDS) pick(+n[1] - 1); return true; } // 1-3: your weapons (the knife and the grenade have their own keys)
      if (code === 'KeyQ') { if (P.alive && !hot) drop(); return true; }
      if (code === 'KeyR') { startReload(); return true; }
      if (code === 'KeyX') { quickKnife(); return true; }
      if (code === 'KeyL') { this.toggleLight(); return true; } // the flashlight // a stab, without putting the gun away
      if (code === 'KeyF') { hotDown(); return true; } // out comes a grenade, pin pulled: let go to throw; right-click while it's out makes it a mine (keyup: releaseCook)
      return code === 'KeyG';
    },
    tab() { if (!live() || NET.role === 'guest' || !(locked || panelOpen)) return false; setPanel(!panelOpen, true); return true; }, // only the host tunes the weapons
    // The game's blasts (grenades and the tube's rockets) land here in the range
    boom(pos, owner, src) { blast(pos, owner || P, src || 'throw'); }, // grenades and F tube shells (the game's), gas cans
    solid() { return false; },
    speedK() { return live() && held.some(h => h && h.kind === 'tube') ? S.tube.slow : 1; },
    update(dt) {
      if (!live()) return;
      const now = performance.now() / 1000;
      updateMines(dt); updateGround(dt, now * 1000);
    },
    after(dt) {
      const show = live() && (locked || panelOpen) && P.alive;
      slotsEl.style.display = show && !VEH.noGuns ? 'flex' : 'none'; // (no weapon slots while you drive)
      document.body.classList.toggle('range-on', live());
      cross.style.display = show && !VEH.noGuns ? 'block' : 'none'; hpEl.style.display = show ? 'block' : 'none'; // no crosshair while you can't shoot (driving)
      for (const e of ents) { if (e !== P && (e.hpDot || live())) hpDot(e); if (e.rig && (e.rig.gearKey || live())) gear(e); }
      if (!live()) return;
      hpEl.style.backgroundColor = hpColour(Math.ceil(P.health / K() - 1e-6));
      const k = held.map(h => h && h.id).join() + cur + Object.values(bats).join() + S.ammo.infinite + mineMode() + hotMine; if (k !== slotsKey) { slotsKey = k; drawSlots(); }
      // The crosshair: the spread cone as it lands on screen, which is the same at any distance. Eased, so it breathes.
      const g = slot().kind === 'gun' ? gunOf(slot()) : null;
      const half = g ? spreadNow(g) * 0.005 : 0, h = renderer.domElement.clientHeight || innerHeight;
      const want = Math.tan(half) / Math.tan(camera.fov * Math.PI / 360) * h / 2;
      // A critically damped spring: it speeds up and slows down smoothly instead of jumping (only the drawing; the spread
      // itself changes at once)
      const om = 2 / Math.max(0.01, S.cross.ease), x = om * dt, ex = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x), ch = crossR - want, tmp = (crossV + om * ch) * dt;
      crossV = (crossV - om * tmp) * ex; crossR = Math.max(0, want + (ch + tmp) * ex);
      hitT -= dt; killT -= dt;
      const col = hitT > 0 ? hitCol : '#fff', dsp = 'display:' + cross.style.display;
      cross.classList.toggle('kill', killT > 0);
      let css;
      if (killT > 0) css = dsp + ';width:0;height:0;background:none;border:0'; // the X stands in for the circle
      else if (crossR < 2.5) css = `${dsp};width:5px;height:5px;background:${col};border:0`;
      else { const d = (2 * crossR).toFixed(1) + 'px'; css = `${dsp};width:${d};height:${d};background:none;border:1.5px solid ${col}`; }
      css += `;opacity:${S.cross.opacity / 100}`;
      if (css !== crossCss) { crossCss = css; cross.style.cssText = css; } // (only when it changes: a style write every frame makes the page redo its layout)
      for (let i = flashes.length - 1; i >= 0; i--) { const f = flashes[i]; f.t -= dt; f.m.material.opacity = Math.min(0.9, f.t / 1.2); if (f.t <= 0) { scene.remove(f.m); f.m.material.dispose(); flashes.splice(i, 1); } }
      const s = slot();
      // What's in your hands: a gun is the game's own viewmodel; the knife, the grenade and the mine are drawn here
      if (!s.model) vm.visible = false;
      if (s.kind === 'knife' && P.alive && !knifeVM.visible) {
        knifeVM.visible = switchT <= 0.15; knifeVM.rotation.order = 'YXZ';
        knifeVM.position.set(0.26, -0.22, -0.52); knifeVM.rotation.set(0.3, 0.45, 0); // blade up and in, its flat side toward you
      }
      if (nadeVM && s.kind === 'throw' && P.alive && throwT <= 0.2) {
        nadeVM.visible = switchT <= 0.15 && gun.cd <= 0.25;
        nadeVM.position.set(0.15, -0.17 + (cooking >= 0 ? 0.04 : 0), -0.4); nadeVM.rotation.set(mineMode() && cooking < 0 ? 1.2 : 0.5, 0.4, -0.3);
      }
    },
  });
})();
