// The new weapon system, and the Shooting Range to dial it in. Under ?dev every game uses it (not Test Drive or the fort's waves):
//   - Everyone has 40 health, shown as a colour from blue (full) to red (1 left). Every hit does a whole number of damage.
//     The game keeps its own health numbers (HP), so damage is scaled by HP / LIFE on the way in.
//   - Five guns (Pistol and Carbine take A batteries, Izu and Battery Gun D batteries, the Master Rifle its own rounds),
//     each set by the same few numbers: body and head damage, spread, spread growth (the only recoil), rate, clip, pellets.
//   - An F battery is a grenade or a mine, or a shell for the F tube (a mortar). A blast does its centre damage in the middle
//     ring and one less in each ring out; walls block it, and it hurts anyone in reach (you too).
//   - Three weapons and the knife (4 from the front, a kill from behind). Ammo is carried apart from the weapons.
//   - Tab opens the weapon settings, in the range and in a game.
// Loaded after the main game script, so it uses the game's globals (scene, camera, P, ents, WEAPONS, VMW, gun, ...).
// The game calls into RANGE (declared in index.html) from its loop, input, pickups, bots and blasts.
(() => {
  // ---------------------------------------------------------------- the weapons and their settings
  const LIFE = 40; // was 20 until 2026-11-02 (and 7, then 10, before that)
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
    { id: 'pistol', name: 'Pistol', kind: 'gun', model: 'pistol', sound: ['gun', 'laser'], ammo: 'A' },
    { id: 'carbine', name: 'Carbine', kind: 'gun', model: 'carbine', sound: ['gun', 'laser'], ammo: 'A' },
    { id: 'izu', name: 'Izu', kind: 'gun', model: 'uzi', ammo: 'D' },
    { id: 'battery', name: 'Battery Gun', kind: 'gun', model: 'shotgun', ammo: 'D' },
    { id: 'rifle', name: 'Master Rifle', kind: 'gun', model: 'rifle', ammo: 'R' },
    { id: 'throw', name: 'Grenade', kind: 'throw', ammo: 'F' },
    { id: 'mine', name: 'Mine', kind: 'mine', ammo: 'F' },
    { id: 'tube', name: 'F Tube', kind: 'tube', model: 'bazooka', ammo: 'F' },
  ];
  // The knife is always yours, in hand 4; you carry three weapons at most. The grenade and the mine aren't weapons you pick up:
  // an F battery IS one (hands 5 and 6, there whenever you carry an F battery). The F tube just launches it further.
  const KNIFE = { id: 'knife', name: 'Knife', kind: 'knife', ammo: '' }, HANDS = 3;
  // Ammo is carried apart from the weapons. A reload takes one battery and fills the clip (what was left in the old one is
  // thrown away); the rifle takes a round; a grenade, a mine or an F tube shot takes one F battery.
  const AMMO = { A: 'A battery', D: 'D battery', F: 'F battery', R: 'rifle round' };
  const AMMOS = { A: 'A batteries', D: 'D batteries', F: 'F batteries', R: 'rifle rounds' };
  const COL = { A: '#e8c33a', D: '#3a8ee8', F: '#e8553a', R: '#d9d9d9' };
  // Spread is how wide the shots land: spread N covers a circle N × 10 cm across at 10 m (twice that at 20 m).
  // grow: extra spread built up by holding the trigger (all of it after 8 shots in a row); it settles once you let go.
  // aim: aiming down the sights multiplies the spread by this (1: no help). moving: how much of the walk/run/jump spread the gun takes.
  // aimMove: what aiming does to that moving spread (1: nothing, so you have to stop to be accurate).
  // Pistol and Carbine are the same gun but for the barrel: the Pistol shoots well on the move, the Carbine when you stand and aim.
  const DEFAULTS = {
    guns: {
      pistol:  { body: 2,  head: 4,  spread: 6,  grow: 0,  rate: 5,   clip: 10, count: 1,  reload: 1,   aim: 0.5,  moving: 0.1,  aimMove: 0.5, auto: false },
      carbine: { body: 2,  head: 4,  spread: 4,  grow: 0,  rate: 5,   clip: 10, count: 1,  reload: 2,   aim: 0.15, moving: 3,    aimMove: 1,   auto: false },
      izu:     { body: 1,  head: 2,  spread: 6,  grow: 20, rate: 12,  clip: 20, count: 1,  reload: 2,   aim: 1,    moving: 0.6,  aimMove: 1,   auto: true },
      battery: { body: 1,  head: 2,  spread: 23, grow: 0,  rate: 0.5, clip: 1,  count: 20, reload: 2,   aim: 1,    moving: 0.3,  aimMove: 1,   auto: false },
      rifle:   { body: 10, head: 20, spread: 2,  grow: 0,  rate: 2,   clip: 1,  count: 1,  reload: 1,   aim: 0.1,  moving: 4.05, aimMove: 1,   auto: false },
    },
    blast: { max: 20, ring: 0.3, show: true }, // max: damage in the centre ring; ring: width of each ring (m); show: draw them where a blast goes off
    throw: { fuse: 2.25 },                   // seconds from pulling the pin (hold to cook)
    mine: { arm: 1.5, radius: 2, warn: 1 },  // arms after placing; anyone within radius sets it off, then it beeps for warn seconds
    tube: { launch: 40, reload: 4.5, slow: 0.5 }, // launch: how hard it lobs the shell (the grenade throw is 25); slow: your speed while you carry it
    knife: { front: 4, back: LIFE, reach: 2 },
    move: { walk: 5, run: 20.5, jump: 12, crouch: 0.5 }, // spread added walking, running, in the air; crouching multiplies it
    targets: { strafe: 0.5, heal: 3 },       // strafe: lane dummies pace side to side at this speed (m/s); heal: your damage wears off after this long
    cross: { ease: 0.2 },                    // how long the crosshair circle takes to catch up with the spread (s), easing in and out
    // Batteries in a pack and the most you can carry, by type; packs (and weapons nobody has) come back after respawn seconds
    ammo: { A: { pack: 4, max: 4 }, D: { pack: 4, max: 4 }, F: { pack: 2, max: 4 }, R: { pack: 4, max: 4 }, respawn: 5, infinite: false },
    // In a game: you spawn with the Pistol loaded and startA spare A batteries; packs come back after packs seconds (rifle
    // rounds after rifle), weapons on their spots after weapons seconds
    game: { startA: 1, packs: 30, rifle: 60, weapons: 25 },
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
    if (o && o.knife && typeof o.knife.back === 'number') o.knife.back = o.knife.back >= was ? LIFE : o.knife.back;
    return o;
  }
  // Aiming used to be one setting for every gun (move.aim); a save from then gives it to the guns that aim.
  function aimPerGun(o) {
    if (o && o.move && typeof o.move.aim === 'number') for (const id of ['pistol', 'carbine', 'rifle']) { const g = o.guns && o.guns[id]; if (g && g.aim === undefined) g.aim = o.move.aim; }
    return o;
  }
  const S = (() => { try { return merge(clone(DEFAULTS), aimPerGun(JSON.parse(localStorage.getItem(SAVE) || 'null') || oldSave())); } catch (e) { return clone(DEFAULTS); } })();
  if (S.knife.back === 20) S.knife.back = LIFE; // a knife from behind saved at the old full health still kills
  function save() { try { localStorage.setItem(SAVE, JSON.stringify(S)); } catch (e) {} }

  const on = () => MODE === 'range'; // the Shooting Range itself
  const live = () => on() || (DEV && MODE !== 'drive' && MODE !== 'defend'); // the new weapons: the range, and every ?dev game
  const K = () => maxHp(P) / LIFE; // our damage in the game's health (1: under ?dev everyone has LIFE)
  let cur = HANDS, heat = 0, cooking = -1, beepT = 0, shotN = 0, panelOpen = false, built = false;
  const held = [null, null, null], bats = { A: 0, D: 0, F: 0, R: 0 }; // your three hands (cur === HANDS is the knife), and your batteries
  const byId = id => SLOTS.find(x => x.id === id);
  const handSlot = i => (i < HANDS ? held[i] : [KNIFE, byId('throw'), byId('mine')][i - HANDS]); // hands 0-5
  const slot = () => handSlot(cur) || KNIFE;
  const has = t => S.ammo.infinite || bats[t] > 0;
  const canPick = i => (i < HANDS ? !!held[i] : i === HANDS || (i <= HANDS + 2 && has('F')));
  const spend = t => { if (S.ammo.infinite) return true; if (bats[t] <= 0) return false; bats[t]--; return true; };
  const gunOf = s => S.guns[s.id];
  const blastR = () => S.blast.max * S.blast.ring; // how far a blast reaches
  const ringDmg = d => d >= blastR() ? 0 : S.blast.max - Math.floor(d / S.blast.ring);

  // ---------------------------------------------------------------- the yard (built once, like Test Drive's stadium)
  function canvasTex(w, h, draw) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.anisotropy = 4; return t; }
  function speckle(base, spots, n) { const t = canvasTex(256, 256, (g, s) => { g.fillStyle = base; g.fillRect(0, 0, s, s); for (let i = 0; i < n; i++) { g.fillStyle = spots[i % spots.length]; const r = 1 + Math.random() * 1.5; g.fillRect(Math.random() * s, Math.random() * s, r, r); } }); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t; }
  const textTex = (txt, color = '#f4f1e6') => canvasTex(256, 96, (g, w, h) => { let fs = 64; g.font = `700 ${fs}px system-ui,sans-serif`; while (g.measureText(txt).width > w - 12 && fs > 24) g.font = `700 ${fs -= 4}px system-ui,sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = color; g.fillText(txt, w / 2, h / 2); });
  // Lanes: [x, distance from the firing line (m)]; the line is z = 0 and the dummies stand down -z. Mixed up so that,
  // from the middle of the line, every dummy is in view and none stands in front of another.
  const LANES = [[-6, 30], [-3, 5], [0, 20], [3, 10], [6, 45]];
  // The blast pit: dummies set round a mark, measured to the nearest face of each; the last one stands behind a wall
  const PIT = { x: -26, z: -16 };
  const PIT_DUMMIES = [[0, 1.5, '1.5 m'], [3.5, 0, '3.5 m'], [-5.5, 0, '5.5 m'], [0, -3.5, 'behind a wall']];
  // Where the weapons lie: a row behind the firing line (Pistol on the left as you turn round to it), each with its ammo pack
  // just past it, and one more F pack on its own for grenades and mines
  const SPOTS = [...SLOTS.filter(sl => sl.kind !== 'throw' && sl.kind !== 'mine').map(sl => ({ id: sl.id, pack: sl.ammo, label: sl.name })), { id: null, pack: 'F', label: 'F batteries' }]
    .map((sp, i) => Object.assign(sp, { x: 9 - i * 3, z: 6, t: 0 }));
  const weaponSpots = () => SPOTS.filter(sp => sp.id);
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
    // Each weapon's name on the floor in front of it, the right way up when you turn round to the row
    for (const sp of SPOTS) {
      const o = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.95).rotateX(-Math.PI / 2).rotateY(Math.PI), new THREE.MeshBasicMaterial({ map: textTex(sp.label, '#1e1e1e'), transparent: true, depthWrite: false }));
      o.position.set(sp.x, 0.03, sp.z - 1.3); draw.add(o);
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
    g.beginPath(); g.arc(w / 2, 54, 40, 0, Math.PI * 2); g.fillStyle = hpColour(t.dead > 0 ? 0 : LIFE - t.dmg); g.fill();
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
    if (t.dead > 0 || dmg <= 0) return false;
    const now = performance.now() / 1000;
    if (!t.dmg) { t.firstT = now; t.shot0 = shotN; t.hits = 0; t.heads = 0; }
    t.dmg = Math.min(LIFE, t.dmg + dmg); t.hits += n; t.heads += nh; t.lastT = now; t.flashT = 0.07;
    t.last = `+${dmg}${head ? ' head' : ''}`;
    if (t.dmg >= LIFE) {
      t.dead = 1.1; tint(t, DUMMY.dead);
      const shots = shotN - t.shot0 + 1, secs = now - t.firstT;
      lastKill = `<b>${t.label}</b> down with the ${src}: ${plural(shots, unit)}, ${plural(t.hits, n > 1 ? 'pellet' : 'hit')}${n > 1 ? ' on it' : ''}${t.heads ? ` (${t.heads} head)` : ''}, ${secs < 0.005 ? 'instant' : secs.toFixed(2) + ' s'}`;
      history.unshift(lastKill); history = history.slice(0, 4);
    } else tint(t, DUMMY.hit);
    drawPips(t);
    return t.dead > 0; // a kill
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
    // The host runs every mine, so everyone sees them and they hurt everyone: a guest asks the host to set it
    if (NET.role === 'guest') { if (NET.conn && NET.conn.open) NET.conn.send({ t: 'mine', p: arr(p) }); }
    else addMine(p, P);
    note('Mine set: it arms in ' + S.mine.arm + ' s', 1.2);
  }
  let mineN = 0;
  function mineMesh(p) {
    const g = new THREE.Group(); g.position.copy(p);
    if (NADE_MODEL) { const c = NADE_MODEL.clone(true); c.rotation.z = Math.PI / 2; c.position.y = 0.09; g.add(c); }
    else { const c = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.06, 14), toonMat({ color: 0x3d4a2a })); c.position.y = 0.03; g.add(c); }
    const light = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff2a1a })); light.position.y = 0.2; g.add(light);
    scene.add(g); return { g, light };
  }
  // owner: who set it (the kill is theirs)
  function addMine(p, owner) {
    const id = ++mineN; mines.push(Object.assign(mineMesh(p), { pos: p, state: 'arming', t: S.mine.arm, blink: 0, owner, id }));
    netFx({ t: 'mn', i: id, p: arr(p) });
  }
  // A guest's copy of the host's mine: it only blinks and beeps (rep); the host says when it arms, warns and goes off
  const MINE_STATES = ['arming', 'armed', 'warn'];
  function setMine(m, state, t) { m.state = state; m.t = t; if (!m.rep) netFx({ t: 'ms', i: m.id, s: MINE_STATES.indexOf(state) }); }
  function updateMines(dt) {
    for (let i = mines.length - 1; i >= 0; i--) {
      const m = mines[i]; m.t -= dt; m.blink += dt;
      if (m.state === 'arming') { m.light.visible = m.blink % 0.5 < 0.1; if (m.t <= 0 && !m.rep) { setMine(m, 'armed', 0); sBeep(1800); } continue; }
      if (m.state === 'armed') {
        m.light.visible = m.blink % 1.2 < 0.12;
        if (m.rep) continue;
        const close = e => Math.hypot(e.x - m.pos.x, e.z - m.pos.z) < S.mine.radius && Math.abs(e.y - m.pos.y) < 2;
        if ((on() ? close(P.pos) : ents.some(e => e.alive && close(e.pos))) || dummies.some(t => t.dead <= 0 && close(t.g.position))) setMine(m, 'warn', S.mine.warn);
        continue;
      }
      // Warning: beeps faster and faster, then the blast
      m.light.visible = m.blink % 0.12 < 0.06; m.beep = (m.beep || 0) - dt;
      if (m.beep <= 0) { sBeep(2200); m.beep = Math.max(0.07, 0.25 * m.t / Math.max(0.2, S.mine.warn)); }
      if (m.t <= 0 && !m.rep) { scene.remove(m.g); mines.splice(i, 1); netFx({ t: 'mx', i: m.id }); blast(m.pos.clone().setY(m.pos.y + 0.1), m.owner && (m.owner === P || ents.includes(m.owner)) ? m.owner : P, 'mine'); }
    }
  }
  function clearMines(tell) { for (const m of mines) scene.remove(m.g); mines.length = 0; if (tell && NET.role === 'host') netFx({ t: 'mc' }); }
  // The host's word on its mines, on a guest
  function mineFx(m) {
    const i = mines.findIndex(x => x.rep && x.id === m.i);
    if (m.t === 'mn' && i < 0 && Array.isArray(m.p)) mines.push(Object.assign(mineMesh(v3(m.p)), { pos: v3(m.p), state: 'arming', t: 99, blink: 0, rep: true, id: m.i }));
    else if (m.t === 'ms' && i >= 0) { mines[i].state = MINE_STATES[m.s] || 'armed'; mines[i].t = mines[i].state === 'warn' ? S.mine.warn : 99; }
    else if (m.t === 'mx' && i >= 0) { scene.remove(mines[i].g); mines.splice(i, 1); }
    else if (m.t === 'mc') clearMines();
  }

  // ---------------------------------------------------------------- blasts
  // Damage in rings round the blast: 10 at the centre, one less each ring out. Anyone with a clear line to it is hurt.
  function blast(pos, owner, src) {
    const R = blastR();
    addScorch(pos, Math.min(4, R * 0.3)); _boomFx(pos, src === 'tube' ? 6.5 : R * 0.6); sBoom(vol(pos, 90));
    const o = pos.clone(); o.y += 0.3;
    showRings(o);
    const name = { throw: 'grenade', mine: 'mine', tube: 'F tube' }[src] || 'blast';
    for (const t of dummies) {
      const d = distTo(t, o), dmg = ringDmg(d);
      if (dmg > 0 && centres(t).some(c => losPts(o, c))) hitFeedback(false, hitDummy(t, dmg, false, name, 1, 0, 'blast'));
    }
    const gap = e => Math.hypot(Math.max(0, Math.abs(o.x - e.pos.x) - 0.3), Math.max(0, e.pos.y - o.y, o.y - (e.pos.y + e.h)), Math.max(0, Math.abs(o.z - e.pos.z) - 0.3));
    const seen = e => losPts(o, new V3(e.pos.x, e.pos.y + e.h * 0.6, e.pos.z));
    if (on()) { // You: blasts hurt you too (your health circle shows it); the range doesn't kill you, it just fills you back up
      const mine = ringDmg(gap(P));
      if (mine > 0 && seen(P)) hurtMe(mine, name);
    } else {
      for (const e of ents) {
        const d = e.alive ? ringDmg(gap(e)) : 0;
        if (d <= 0 || !seen(e)) continue;
        const kill = e.health - d * K() <= 0;
        damage(e, d * K(), owner, 'frag', false);
        if (owner === P && e !== P) hitFeedback(false, kill);
      }
      // gas cans and trucks, as the game's blasts did
      for (const g of GASCANS) if (g.alive && g.pos.distanceTo(o) < R * 0.6 && !pendingGas.some(q => q.g === g)) pendingGas.push({ g, owner, t: 0.12 + Math.random() * 0.15 });
      for (const tr of trucks) { const d = Math.max(0, tr.pos.distanceTo(o) - 1.5); if (tr.alive && d < R) damageTruck(tr, ringDmg(d) * K() * TRUCK.blastK); }
      netFx({ t: 'bm', p: arr(pos), s: R * 0.6 });
    }
    // Other mines in reach go off too
    for (const m of mines) if (!m.rep && m.state !== 'warn' && m.pos.distanceTo(o) < R * 0.6 && losPts(o, m.pos.clone().setY(m.pos.y + 0.2))) setMine(m, 'warn', 0.15);
    const pd = P.pos.distanceTo(pos); if (pd < 14) punch += 0.06 * (1 - pd / 14);
  }

  let myHp = LIFE, myLastT = 0, myDownT = 0;
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
    // Aiming tightens the gun's own spread (aim) and the spread from moving (aimMove) separately
    const own = (g.spread + heat * g.grow) * (1 - (1 - g.aim) * adsK);
    const moving = g.moving * (!P.onGround ? m.jump : hs > 5 ? m.run : hs > 0.5 ? m.walk : 0) * (1 - (1 - g.aimMove) * adsK);
    return (own + moving) * (P.h < STAND_H ? m.crouch : 1);
  }
  function fireGun(s) {
    const g = gunOf(s), w = WEAPONS[s.model], q = aimQ(), half = spreadNow(g) * 0.005; // spread N: N × 0.01 rad across
    const targets = [...W.meshes, ...W.floors, ...dummyParts()], start = vmMuzzleWorld(), byT = new Map(), byE = new Map(), holes = [];
    if (!on()) {
      for (const e of ents) if (e !== P && e.alive && e.hit) targets.push(...e.hit);
      for (const gc of GASCANS) if (gc.alive) targets.push(gc.px);
      for (const tr of trucks) if (tr.veh !== VEH.riding) targets.push(...tr.hits);
    }
    for (let i = 0; i < g.count; i++) {
      const r = half * Math.sqrt(Math.random()), th = Math.random() * Math.PI * 2;
      const dir = new V3(Math.cos(th) * r, Math.sin(th) * r, -1).normalize().applyQuaternion(q);
      ray.set(camera.position, dir); ray.far = 250;
      const hit = ray.intersectObjects(targets, false)[0];
      if (i < 4) tracer(start, hit ? hit.point : camera.position.clone().addScaledVector(dir, 250), w.tracer, w.trW, w.trLife, true);
      if (!hit) continue;
      const ud = hit.object.userData;
      if (ud.rangeT) { const head = ud.part === 'head', a = byT.get(ud.rangeT) || { d: 0, n: 0, nh: 0 }; a.d += head ? g.head : g.body; a.n++; if (head) a.nh++; byT.set(ud.rangeT, a); }
      else if (ud.ent) { const head = ud.part === 'head', a = byE.get(ud.ent) || { d: 0, head: false }; a.d += head ? g.head : g.body; a.head = a.head || head; byE.set(ud.ent, a); }
      else if (ud.gas) shootGas(ud.gas, P);
      else if (ud.truck) { shootTruck(ud.truck, w); impact(hit.point); }
      else { const h = holeFromHit(hit, dir); if (h) holes.push(h); else impact(hit.point); }
    }
    addHoles(holes);
    let kill = false; for (const [t, a] of byT) kill = hitDummy(t, a.d, a.nh > 0, s.name, a.n, a.nh) || kill;
    for (const [e, a] of byE) { kill = e.health - a.d * K() <= 0 || kill; damage(e, a.d * K(), P, 'gun', a.head); }
    if (byT.size || byE.size) hitFeedback([...byT.values()].some(a => a.nh > 0) || [...byE.values()].some(a => a.head), kill);
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
    throwNade(P, camera.position.clone().addScaledVector(dir, 0.6), v, 15, true);
    punch += WEAPONS.bazooka.kick * 0.8; vmKick = 1; flashT = GUN_FX.bazooka.flash.life;
    muzzleFx('bazooka', start, dir, true, P.id); sfx('bazooka', 1); netFx({ t: 'sf', k: 'bazooka', p: arr(P.pos), r: 90, g: 1 });
  }
  // A point touching a dummy
  function onDummy(p) {
    for (const t of dummies) for (const o of t.parts) { const h = o.userData.half; if (Math.abs(p.x - t.g.position.x) < h.x + 0.05 && Math.abs(p.y - t.g.position.y - o.position.y) < h.y + 0.05 && Math.abs(p.z - t.g.position.z) < h.z + 0.05) return true; }
    return false;
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
    let ent = null;
    if (!on()) for (const e of ents) {
      if (e === P || !e.alive || Math.abs(e.pos.y - P.pos.y) > 1.2) continue;
      const dx = e.pos.x - P.pos.x, dz = e.pos.z - P.pos.z, d = Math.hypot(dx, dz);
      if (d < bd && (dx * fx + dz * fz) / Math.max(d, 1e-3) > 0.7) { ent = e; best = null; bd = d; }
    }
    if (ent) { // behind them: they face the way you're stabbing
      const back = fwdOf(ent).dot(new V3(ent.pos.x - P.pos.x, 0, ent.pos.z - P.pos.z).normalize()) > 0.5, d = knifeDmg(back);
      const kill = ent.health - d <= 0; damage(ent, d, P, 'knife', false); hitFeedback(false, kill);
      return;
    }
    if (!best) return;
    // The dummies face the firing line (+z): you're behind one when you're on its -z side
    const back = (best.g.position.z - P.pos.z) / Math.max(bd, 1e-3) > 0.5;
    hitFeedback(false, hitDummy(best, back ? S.knife.back : S.knife.front, false, back ? 'knife (from behind)' : 'knife', 1, 0, 'stab'));
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
    throwNade(P, camera.position.clone().addScaledVector(dir, 0.4), v, fuse);
    throwT = 0.4; gun.cd = 0.6; shotN++;
  }
  // Replaces the game's updateGun in the range
  function updateGun(dt) {
    gun.cd -= dt; knifeCd -= dt; gun.spray = 0; gun.burstLeft = 0;
    heat = Math.max(0, heat - dt * (mouseDown ? 0.6 : 2.5));
    if (cur > HANDS && !has('F') && cooking < 0 && throwT <= 0) pick(HANDS); // that was your last F battery
    const s = slot();
    if (!s.model) { mouseRight = false; tAim = false; } // nothing to aim down
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
    if (s.kind === 'mine') { if (clickQ && gun.cd <= 0) { clickQ = false; if (!spend('F')) { outOf('F'); return; } gun.cd = 0.5; throwT = 0.3; shotN++; placeMine(); } return; }
    // Grenade: hold to cook (it beeps faster as the fuse runs down), let go to throw
    clickQ = false;
    if (cooking < 0) { if (mouseDown && gun.cd <= 0 && throwT <= 0) { if (!spend('F')) { outOf('F'); gun.cd = 0.5; return; } cooking = 0; beepT = 0.5; sPin(); } return; }
    cooking += dt; beepT -= dt;
    if (beepT <= 0) { const rem = S.throw.fuse - cooking; beepT = rem > 1.5 ? 0.5 : rem > 0.75 ? 0.25 : 0.12; sBeep(1300 + (1 - rem / S.throw.fuse) * 1000); }
    if (cooking >= S.throw.fuse) { cooking = -1; gun.cd = 0.8; shotN++; blast(new V3(P.pos.x, P.pos.y + 1.2, P.pos.z), P, 'throw'); note('Held it too long', 1.5); return; }
    if (!mouseDown) throwNow();
  }

  // ---------------------------------------------------------------- picking a weapon
  // i: a hand (0-2), HANDS for the knife, then the grenade and the mine
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
  // In the range you start with the knife and nothing else; in a game with the Pistol loaded and a spare A battery or so
  function kit() {
    held.fill(null); for (const k in bats) bats[k] = 0; P.nades = 0; cooking = -1;
    P.ammoBy = {}; for (const sl of SLOTS) if (sl.model) P.ammoBy[sl.model] = { mag: 0, res: 0 };
    curW = 'pistol'; P.ammo = 0; P.reserve = 0; cur = HANDS;
    if (!on()) { held[0] = byId('pistol'); P.ammoBy.pistol.mag = clipOf(held[0]); bats.A = Math.min(S.ammo.A.max, S.game.startA); }
    syncInv(); pick(on() ? HANDS : 0, true);
  }
  // A weapon from a pickup in a game (model: the game's weapon id; ammo: rounds it carries, or none for a full clip)
  const BY_MODEL = { pistol: 'pistol', carbine: 'carbine', uzi: 'izu', shotgun: 'battery', rifle: 'rifle', bazooka: 'tube' };
  function give(model, ammo) {
    const sl = byId(BY_MODEL[model]); if (!sl) return false;
    if (held.some(h => h === sl)) return false;
    if (held.indexOf(null) < 0) { if (fullT <= 0) { fullT = 2; note('Your hands are full (3 weapons): Q drops the one you hold', 1.8); } return false; }
    return take({ id: sl.id, load: ammo === undefined ? clipOf(sl) : Math.min(clipOf(sl), ammo) });
  }
  // A pack of batteries (k: A, D, F or R); returns how many you could carry
  function addBats(k) {
    const a = S.ammo[k]; if (!a) return 0;
    const n = Math.min(a.pack, a.max - bats[k]); if (n <= 0) return 0;
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
  const spotPos = sp => { const y = groundAt(sp.x, sp.z, 5); return new V3(sp.x, y === null ? 0 : y, sp.z); };
  function packMesh(t) {
    const g = new THREE.Group(), m = toonMat({ color: new THREE.Color(COL[t]).getHex() });
    for (let k = 0; k < (t === 'F' || t === 'R' ? 2 : 4); k++) { // the batteries themselves, side by side
      const b = new THREE.Mesh(t === 'R' ? new THREE.CylinderGeometry(0.035, 0.035, 0.32, 10) : new THREE.CylinderGeometry(0.08, 0.08, t === 'F' ? 0.36 : 0.26, 14), m);
      b.position.x = (k - (t === 'F' || t === 'R' ? 0.5 : 1.5)) * (t === 'R' ? 0.1 : 0.19); b.castShadow = true; g.add(b);
    }
    const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d');
    x.font = '800 92px system-ui,sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillStyle = COL[t]; x.fillText(t, 64, 68);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false })); sp.scale.set(0.45, 0.45, 1); sp.position.y = 0.55; g.add(sp);
    return g;
  }
  function buildGround() {
    for (const sp of SPOTS) {
      const mesh = packMesh(sp.pack), p = spotPos(sp); p.z += 1.6;
      mesh.position.copy(p); scene.add(mesh); packs.push({ t: sp.pack, pos: p, mesh, active: true, wait: 0 });
    }
  }
  // Every weapon back on its spot (any you're not holding) and every pack back
  function resetGround() {
    for (const it of items) scene.remove(it.mesh); items.length = 0;
    for (const sp of weaponSpots()) { sp.t = 0; if (!held.some(h => h && h.id === sp.id)) makeItem(sp.id, spotPos(sp), fresh(byId(sp.id))); }
    for (const pk of packs) { pk.active = true; pk.mesh.visible = true; }
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
    if (it.pos.y < -20) { if (!on()) { it.gone = true; return; } const sp = SPOTS.find(q => q.id === it.id); it.pos.copy(spotPos(sp)); it.vel = null; return; } // off the world: back to its spot
    if (ground && Math.hypot(it.vel.x, it.vel.z) < 0.4) {
      it.vel = null; it.pos.y -= 0.12;
      if (!on()) { const sl = byId(it.id); addPickup(sl.model, it.pos, { dropped: true, ammo: it.load, life: 30 }); it.gone = true; }
    }
  }
  const near = (p, r) => Math.hypot(P.pos.x - p.x, P.pos.z - p.z) < r && Math.abs(P.pos.y - p.y) < 1.3;
  function updateGround(dt, now) {
    fullT -= dt; outT -= dt;
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i];
      if (it.vel) { fly(it, dt); it.mesh.position.set(it.pos.x, it.pos.y + 0.12, it.pos.z); it.mesh.rotation.y += dt * 7; if (it.gone) { scene.remove(it.mesh); items.splice(i, 1); } continue; }
      if (!on()) continue;
      it.mesh.rotation.y += dt * 1.5; it.mesh.position.set(it.pos.x, it.pos.y + 0.45 + Math.sin(now / 350) * 0.06, it.pos.z);
      if (!near(it.pos, 1.1)) { it.armed = true; continue; } // one you dropped waits until you've stepped off it
      if (!it.armed || !P.alive) continue;
      if (take(it)) { scene.remove(it.mesh); items.splice(i, 1); }
      else if (fullT <= 0) { fullT = 2; note('Your hands are full (3 weapons): Q drops the one you hold', 1.8); }
    }
    if (!on()) return;
    // A weapon nobody has, held or on the ground, comes back to its spot
    for (const sp of weaponSpots()) {
      if (items.some(it => it.id === sp.id) || held.some(h => h && h.id === sp.id)) { sp.t = S.ammo.respawn; continue; }
      if ((sp.t -= dt) <= 0) makeItem(sp.id, spotPos(sp), fresh(byId(sp.id)));
    }
    for (const pk of packs) {
      if (!pk.active) { if ((pk.wait -= dt) <= 0) { pk.active = true; pk.mesh.visible = true; } continue; }
      pk.mesh.rotation.y += dt; pk.mesh.position.y = pk.pos.y + 0.3 + Math.sin(now / 400) * 0.05;
      const a = S.ammo[pk.t], room = a.max - bats[pk.t];
      if (!P.alive || room <= 0 || !near(pk.pos, 1)) continue;
      const n = Math.min(a.pack, room); bats[pk.t] += n;
      pk.active = false; pk.wait = S.ammo.respawn; pk.mesh.visible = false;
      note(`+${n} ${n === 1 ? AMMO[pk.t] : AMMOS[pk.t]}`, 1);
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
  #rcross i{position:absolute;left:50%;top:50%;width:2px;height:20px;margin:-10px 0 0 -1px;background:#e51c1c;display:none}#rcross i:first-child{transform:rotate(45deg)}#rcross i:last-child{transform:rotate(-45deg)}
  #rcross.kill i{display:block}
  body.range-on .ch{display:none}
  body.touch #rslots,body.touch #rcard,body.touch #rhp{display:none!important}`;
  document.head.append(css);
  const slotsEl = document.createElement('div'); slotsEl.id = 'rslots';
  const card = document.createElement('div'); card.id = 'rcard';
  const panel = document.createElement('div'); panel.id = 'rpanel';
  const cross = document.createElement('div'); cross.id = 'rcross';
  const hpEl = document.createElement('div'); hpEl.id = 'rhp';
  document.body.append(slotsEl, card, panel, hpEl); ($('hud') || document.body).append(cross);
  let crossR = 0, crossV = 0, hitT = 0, hitCol = '#fff', killT = 0;
  cross.innerHTML = '<i></i><i></i>'; // the kill X's two strokes
  // A health circle over each player's head (and over their name when it shows), so you can see who's hurt
  function hpDot(e) {
    if (!e.hpDot) {
      const c = document.createElement('canvas'); c.width = c.height = 64;
      e.hpDot = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), sizeAttenuation: false, transparent: true, depthWrite: false }));
      e.hpDot.scale.set(0.03, 0.03, 1); e.hpDot.center.set(0.5, -0.8); e.hpDot.renderOrder = 11; e.hpDot.userData.c = c; e.hpDot.userData.k = -1;
    }
    const d = e.hpDot, show = live() && !on() && e.mesh && e.alive;
    if (e.mesh && d.parent !== e.mesh) e.mesh.add(d);
    d.visible = !!show; if (!show) return;
    d.position.y = e.tag ? e.tag.position.y : (e.rig ? e.rig.model.headY : 1.7) + 0.5;
    d.center.y = e.tagA > 0.05 ? -0.8 : 0.5; // above the name while it shows
    const h = Math.ceil(e.health / K() - 1e-6);
    if (h !== d.userData.k) { d.userData.k = h; const x = d.userData.c.getContext('2d'); x.clearRect(0, 0, 64, 64); x.beginPath(); x.arc(32, 32, 28, 0, Math.PI * 2); x.fillStyle = hpColour(h); x.fill(); d.material.map.needsUpdate = true; }
  }
  function hitFeedback(head, kill) { if (kill) killT = 0.5; else { hitT = 0.12; hitCol = head ? '#e51c1c' : '#ffcc00'; } }
  const batsTxt = t => (S.ammo.infinite ? '∞' : bats[t]);
  let slotsKey = '';
  function drawSlots() {
    const hands = [0, 1, 2, 3, 4, 5].map(i => { const s = handSlot(i); return s ? `<div class="${i === cur ? 'on' : canPick(i) ? '' : 'no'}">${i + 1}&nbsp; ${s.name}${s.ammo ? ` <small>${s.ammo === 'R' ? 'rounds' : s.ammo} ×${batsTxt(s.ammo)}</small>` : ''}</div>` : `<div class="no">${i + 1}&nbsp; —</div>`; });
    const am = ['A', 'D', 'F', 'R'].map(t => `<b style="color:${COL[t]}">${t === 'R' ? 'Rifle' : t}</b> ${batsTxt(t)}`).join(' · ');
    slotsEl.innerHTML = hands.join('') + `<div class="am">${am}</div>`;
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
  let aimT = null, cardT = 0;
  function drawCard() {
    const s = slot();
    let line = '';
    if (s.kind === 'gun') { const g = gunOf(s); line = `<span class="k">Body</span> ${g.body} · <span class="k">Head</span> ${g.head} · <span class="k">Spread</span> ${fmt(spreadNow(g), 0.1)}${g.count > 1 ? ` · ${g.count} pellets` : ''} · <span class="k">Clip</span> ${g.clip}<br>${killMath(g)}`; }
    else if (s.kind === 'knife') line = `${S.knife.front} from the front, ${S.knife.back} from behind, ${fmt(S.knife.reach, 0.1)} m reach`;
    else if (s.kind === 'tube') line = `Lobs an F battery in an arc; it goes off where it lands. You move at ${fmt(S.tube.slow, 0.05)}× speed while you carry it. ${blastMath()}`;
    else line = `${s.kind === 'throw' ? 'Hold to cook, let go to throw. ' : s.kind === 'mine' ? 'Click to set one at your feet. ' : ''}${blastMath()}`;
    const aim = aimT ? `<div class="k">On the crosshair: ${aimT.label}, ${aimT.d.toFixed(1)} m away</div>` : '';
    card.innerHTML = `<div class="w">${cur + 1} · ${s.name}${s.ammo ? ` <span class="k">(${AMMOS[s.ammo]}: ${S.ammo.infinite ? 'infinite' : bats[s.ammo]})</span>` : ''}</div>${line}${aim}${history.length ? `<div class="h">${history.map(h => `<div>${h}</div>`).join('')}</div>` : ''}<div class="k" style="margin-top:4px">Walk over a weapon to pick it up (3 at most) · Q: drop · Tab: weapon settings</div>`;
  }

  // ---------------------------------------------------------------- the Tab panel
  // Projectile rows: [key, label, min, max, step, unit, help, only this gun]
  const GUN_ROWS = [
    ['body', 'Body damage', 1, LIFE, 1, '', ''],
    ['head', 'Head damage', 1, LIFE, 1, '', ''],
    ['spread', 'Spread', 0, 30, 0.5, '', 'How wide the shots land: N covers a circle N × 10 cm across at 10 m (twice that at 20 m). 0 goes exactly where you aim.'],
    ['grow', 'Spread growth (recoil)', 0, 20, 0.5, '', 'Extra spread you build up holding the trigger: all of it after 8 shots in a row. It settles back once you stop.'],
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
      ['blast.max', 'Centre damage', 1, LIFE, 1, '', 'What a blast does in its middle ring. Each ring out does one less.'],
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
      ['knife.front', 'From the front', 1, LIFE, 1, '', ''],
      ['knife.back', 'From behind', 1, LIFE, 1, '', ''],
      ['knife.reach', 'Reach', 1, 4, 0.1, 'm', ''],
    ]],
    ['Moving (each gun takes its share: Moving penalty)', [
      ['move.walk', 'Walking adds', 0, 20, 0.5, 'spread', ''],
      ['move.run', 'Running adds', 0, 30, 0.5, 'spread', ''],
      ['move.jump', 'In the air adds', 0, 30, 0.5, 'spread', ''],
      ['move.crouch', 'Crouching multiplies by', 0.1, 1, 0.05, '×', ''],
    ]],
    ['Ammo', [
      ['ammo.A.pack', 'A batteries in a pack', 1, 10, 1, '', 'Pistol and Carbine: one battery fills the clip.'],
      ['ammo.A.max', 'Most A batteries you can carry', 1, 30, 1, '', ''],
      ['ammo.D.pack', 'D batteries in a pack', 1, 10, 1, '', 'Izu and Battery Gun.'],
      ['ammo.D.max', 'Most D batteries you can carry', 1, 30, 1, '', ''],
      ['ammo.F.pack', 'F batteries in a pack', 1, 10, 1, '', 'Each one is a grenade or a mine (hands 5 and 6), or an F tube shot.'],
      ['ammo.F.max', 'Most F batteries you can carry', 1, 30, 1, '', ''],
      ['ammo.R.pack', 'Rifle rounds in a pack', 1, 10, 1, '', ''],
      ['ammo.R.max', 'Most rifle rounds you can carry', 1, 30, 1, '', ''],
      ['ammo.respawn', 'Packs come back after', 1, 60, 1, 's', 'And a weapon nobody has, held or lying around, comes back to its spot.'],
    ], 'ammo'],
    ['Crosshair', [
      ['cross.ease', 'Circle smoothing', 0.02, 0.5, 0.01, 's', 'How long the circle takes to follow the spread, easing in and out. The spread itself changes at once.'],
    ]],
    ['In a game', [
      ['game.startA', 'Spare A batteries you spawn with', 0, 4, 1, '', 'Besides the Pistol, loaded.'],
      ['game.packs', 'Packs come back after', 5, 120, 5, 's', 'Every weapon spot has its pack, and the level\'s ammo boxes are A or D packs (F where the grenades were).'],
      ['game.rifle', 'Rifle rounds come back after', 5, 180, 5, 's', ''],
      ['game.weapons', 'Weapons come back to their spot after', 5, 120, 5, 's', 'Weapons people drop lie there for 30 s.'],
    ]],
    ['Dummies', [
      ['targets.strafe', 'Lane dummies strafe at', 0, 7, 0.5, 'm/s', 'Side to side, 1.5 m each way. 0 stands still; 4.2 is walking pace, 6.8 running.'],
      ['targets.heal', 'Your health comes back after', 0.5, 10, 0.5, 's', 'With no new hits, you go back to full health. Dummies keep their damage until they go down.'],
    ]],
  ];
  const getP = p => p.split('.').reduce((o, k) => o[k], S);
  const setP = (p, v) => { const ks = p.split('.'), last = ks.pop(); ks.reduce((o, k) => o[k], S)[last] = v; };
  function buildPanel() {
    const s = slot();
    let html = `<h2>Weapon settings</h2><p class="sub">Changes take effect as you drag, and are saved in this browser. Damage is out of ${LIFE} health.${on() ? '' : ' The game carries on while this is open. Everyone\'s shots use their own settings.'}</p>`;
    if (!on()) html += `<div class="math">${[...ents].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths).map(e => `${e === P ? '<b>' : ''}${esc(e.name)}${e === P ? '</b>' : ''} ${e.kills}/${e.deaths}`).join(' · ')}</div>`;
    for (const sl of SLOTS) if (sl.kind === 'gun') {
      const g = gunOf(sl);
      html += `<details data-sec="${sl.id}"${sl === s ? ' open' : ''}><summary>${sl.name}<small>${AMMOS[sl.ammo]}</small></summary><div class="math" id="rm-${sl.id}">${killMath(g)}</div>`;
      for (const [k, label, min, max, step, unit, help, only] of GUN_ROWS) if (!only || only === sl.id)
        html += `<div class="row"><label for="rg-${sl.id}-${k}">${label}</label><output id="ro-${sl.id}-${k}">${fmt(g[k], step)} ${unit}</output><input type="range" id="rg-${sl.id}-${k}" data-g="${sl.id}" data-k="${k}" min="${min}" max="${max}" step="${step}" value="${g[k]}">${help ? `<div class="help">${help}</div>` : ''}</div>`;
      html += `<label class="chk"><input type="checkbox" data-g="${sl.id}" data-k="auto"${g.auto ? ' checked' : ''}> Full auto (hold to keep firing)</label><button type="button" class="sm" data-reset="${sl.id}">Reset ${sl.name}</button></details>`;
    }
    for (const [title, rows, math] of OTHER) {
      if (title === 'Dummies' && !on()) continue; // (the range's)
      const open = (math === 'blast' && !s.model) || (math === 'blast' && s.kind === 'tube') || (title === 'Knife' && s.kind === 'knife');
      html += `<details${open ? ' open' : ''}><summary>${title}</summary>${math === 'blast' ? `<div class="math" id="rm-blast">${blastMath()}</div><label class="chk"><input type="checkbox" data-p="blast.show"${S.blast.show ? ' checked' : ''}> Show the rings where a blast goes off</label>` : ''}${math === 'ammo' ? `<label class="chk"><input type="checkbox" data-p="ammo.infinite"${S.ammo.infinite ? ' checked' : ''}> Infinite ammo (to test a gun on its own)</label>` : ''}`;
      for (const [p, label, min, max, step, unit, help] of rows)
        html += `<div class="row"><label for="rp-${p}">${label}</label><output id="rq-${p}">${fmt(getP(p), step)} ${unit}</output><input type="range" id="rp-${p}" data-p="${p}" min="${min}" max="${max}" step="${step}" value="${getP(p)}">${help ? `<div class="help">${help}</div>` : ''}</div>`;
      html += '</details>';
    }
    html += `<div class="btns"><button type="button" class="go" id="r-go">Back to shooting (Tab)</button>${on() ? '<button type="button" id="r-items">Put the weapons back</button>' : ''}<button type="button" id="r-mines">Clear mines</button><button type="button" id="r-reset">Reset everything</button><button type="button" id="r-copy">Copy settings</button></div>
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
    if (on()) panel.querySelector('#r-items').onclick = e => { resetGround(); e.target.textContent = 'Weapons back'; };
    panel.querySelector('#r-mines').onclick = e => { clearMines(true); e.target.textContent = 'Mines cleared'; };
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
    for (const it of items) scene.remove(it.mesh); items.length = 0; for (const pk of packs) scene.remove(pk.mesh); packs.length = 0;
    if (pitRings) { scene.remove(pitRings); pitRings = null; }
    for (const k in realReload) WEAPONS[k].reload = realReload[k]; // the reload animation's length goes back to the game's
    setPanel(false); built = false; history = []; lastKill = '';
  }

  Object.defineProperty(RANGE, 'on', { get: live, configurable: true }); // the new weapons are in charge
  Object.defineProperty(RANGE, 'range', { get: on, configurable: true }); // the Shooting Range itself
  Object.defineProperty(RANGE, 'panelOpen', { get: () => panelOpen, configurable: true });
  Object.assign(RANGE, {
    onLevel() {
      if (!on()) {
        if (built) teardown();
        clearMines(); for (const it of items) scene.remove(it.mesh); items.length = 0; setPanel(false);
        if (!live()) for (const k in realReload) WEAPONS[k].reload = realReload[k];
        return;
      }
      if (!built) {
        buildDummies();
        buildGround();
        pitRings = ringMesh(); pitRings.position.set(PIT.x, 0.045, PIT.z); pitRings.scale.setScalar(blastR()); pitRings.material.opacity = 0.55; scene.add(pitRings);
        built = true;
      }
      dummies.forEach(resetDummy); clearMines(); resetGround(); myHp = LIFE; myDownT = 0;
    },
    kit() { if (live()) kit(); },
    life: LIFE, give, addBats, packMesh, knifeDmg,
    mine(p, owner) { if (live() && p.distanceTo(owner.pos) < 5) addMine(p, owner); }, // a guest set one (host)
    fx: mineFx, // the host's mines, on a guest
    // What a box gives: the pack for a weapon spot's gun (rifle rounds by the rifle), and how long it takes to come back
    ammoOf: model => { const sl = byId(BY_MODEL[model]); return sl ? sl.ammo : null; },
    packWait: k => (k === 'R' ? S.game.rifle : S.game.packs),
    weaponWait: () => S.game.weapons,
    // A bot's gun under the new numbers (the game's own aim and timing, these damages, rates and clips)
    botW(model) {
      const w = WEAPONS[model], sl = byId(BY_MODEL[model]); if (!sl || sl.kind !== 'gun') return w;
      const g = gunOf(sl);
      return Object.assign({}, w, { auto: g.auto, burst: 0, rate: 1 / g.rate, mag: g.clip, reload: g.reload, pellets: g.count > 1 ? g.count : 0, dmg: g.body * K(), head: g.head * K(), botHead: 0, zones: false, oneShot: false, falloff: null, rangeSpread: 0, live: true });
    },
    updateGun,
    next(dir) { if (!P.alive) return; const can = [0, 1, 2, 3, 4, 5].filter(canPick), i = can.indexOf(cur); pick(can[(i + dir + can.length) % can.length]); },
    key(code) {
      if (!live()) return false;
      const n = /^Digit([1-9])$/.exec(code);
      if (n) { if (P.alive && +n[1] <= HANDS + 3) pick(+n[1] - 1); return true; }
      if (code === 'KeyQ') { if (P.alive) drop(); return true; }
      if (code === 'KeyR') { startReload(); return true; }
      return (on() && code === 'KeyE') || code === 'KeyF' || code === 'KeyG'; // no knife or grenade hotkeys: they're weapons you switch to
    },
    tab() { if (!live() || !(locked || panelOpen)) return false; setPanel(!panelOpen, true); return true; },
    // The game's blasts (grenades and the tube's rockets) land here in the range
    boom(pos, owner, src) { blast(pos, owner || P, src || 'throw'); }, // grenades and F tube shells (the game's), gas cans
    solid(p) { return onDummy(p); },
    speedK() { return live() && held.some(h => h && h.kind === 'tube') ? S.tube.slow : 1; },
    update(dt) {
      if (!live()) return;
      const now = performance.now() / 1000;
      if (!on()) { updateMines(dt); updateGround(dt, now * 1000); return; }
      for (const t of dummies) {
        if (t.flashT > 0 && (t.flashT -= dt) <= 0 && t.dead <= 0) tint(t);
        if (t.dead > 0) { if ((t.dead -= dt) <= 0) resetDummy(t); }
        // Strafing: lane dummies pace 1.5 m each side of their spot
        const sp = t.lane ? S.targets.strafe : 0;
        if (sp > 0) { t.g.position.x += t.dir * sp * dt; if (Math.abs(t.g.position.x - t.home.x) > 1.5) { t.g.position.x = t.home.x + Math.sign(t.g.position.x - t.home.x) * 1.5; t.dir = -t.dir; } }
        else if (t.g.position.x !== t.home.x) t.g.position.x += (t.home.x - t.g.position.x) * Math.min(1, dt * 4);
        // You can't walk through them
        const dx = P.pos.x - t.g.position.x, dz = P.pos.z - t.g.position.z, d = Math.hypot(dx, dz);
        if (d < 0.6 && d > 1e-4 && P.pos.y < t.g.position.y + 2) { P.pos.x = t.g.position.x + dx / d * 0.6; P.pos.z = t.g.position.z + dz / d * 0.6; }
      }
      updateMines(dt); updateGround(dt, now * 1000);
      if (myDownT > 0) { if ((myDownT -= dt) <= 0) myHp = LIFE; }
      else if (myHp < LIFE && now - myLastT > S.targets.heal) myHp = LIFE;
    },
    after(dt) {
      const show = live() && (locked || panelOpen) && P.alive;
      slotsEl.style.display = show ? 'flex' : 'none'; card.style.display = show && on() ? 'block' : 'none'; // the card is the range's
      document.body.classList.toggle('range-on', live());
      cross.style.display = show ? 'block' : 'none'; hpEl.style.display = show ? 'block' : 'none';
      for (const e of ents) if (e !== P && (e.hpDot || live())) hpDot(e);
      if (!live()) return;
      hpEl.style.backgroundColor = hpColour(on() ? myHp : Math.ceil(P.health / K() - 1e-6));
      const k = held.map(h => h && h.id).join() + cur + Object.values(bats).join() + S.ammo.infinite; if (k !== slotsKey) { slotsKey = k; drawSlots(); }
      if (on()) { scene.background.setHex(0x000000); scene.fog.color.setHex(0x000000); } // (each level load sets the sky back)
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
      if (killT > 0) cross.style.cssText = dsp + ';width:0;height:0;background:none;border:0'; // the X stands in for the circle
      else if (crossR < 2.5) cross.style.cssText = `${dsp};width:5px;height:5px;background:${col};border:0`;
      else { const d = (2 * crossR).toFixed(1) + 'px'; cross.style.cssText = `${dsp};width:${d};height:${d};background:none;border:1.5px solid ${col}`; }
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
      if (show && on() && (cardT -= dt) <= 0) {
        cardT = 0.1; aimT = null;
        ray.set(camera.position, new V3(0, 0, -1).applyQuaternion(aimQ())); ray.far = 250;
        const hit = ray.intersectObjects([...W.meshes, ...dummyParts()], false)[0];
        if (hit && hit.object.userData.rangeT) aimT = { label: hit.object.userData.rangeT.label, d: hit.distance };
        drawCard();
      }
    },
  });
})();
