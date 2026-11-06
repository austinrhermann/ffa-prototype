// Draw mode: P (or Draw on the pause screen) puts your weapons away and gives you a pen and a spray can.
//   - The pen draws a dot, or a line while the button is held, up to PEN_REACH away. The can puts down one big splatter
//     per click, up to SPRAY_REACH away, bigger and thinner the further away you spray from.
//   - Six colours (1-6), one per tool; Q or the wheel switches tool. Paint never runs out.
//   - Paint goes on everything: the level, its doors, vehicles (it rides along) and characters (it moves with them; when
//     they die it stays on the body and they come back clean). Each click is a new layer, drawn over the ones before.
//   - Everyone sees everyone's paint, players who join mid-round too, until the round resets or the level changes
//     (the oldest layers go past PAINT_MAX).
//   - Artists are safe: no damage (falls aside) and bots leave them be, and with no weapons they can't hurt anyone either.
//     Getting the tools out takes SWITCH seconds, and you're only safe once they're out; going back to weapons ends
//     the safety at once and takes the same time to get the gun up.
// Loaded after the main game script and range.js, so it uses the game's globals (scene, camera, P, ents, TG, VEH, ...).
// The game calls into ART (declared in index.html) from its loop, input, network and corpses.
(() => {
  const PALETTE = ['#B06455', '#E1B559', '#5A6490', '#455533', '#000000', '#FFFFFF'];
  const PAL = PALETTE.map(c => new THREE.Color(c));
  const PEN_R = 0.02, PEN_REACH = 3, PEN_STEP = 0.015, SPRAY_REACH = 8, SPRAY_CD = 0.2, SWITCH = 1;
  const sprayR = d => 0.3 + 0.1 * Math.min(SPRAY_REACH, d), sprayA = d => 1 - 0.35 * Math.min(SPRAY_REACH, d) / SPRAY_REACH;
  const BODY_R = 0.28; // the most a splatter covers on a character (a big one would swallow a head)
  const PAINT_MAX = 1500, VERT_MAX = 500000; // layers kept (the oldest tenth goes past either)
  const STROKE_MAX = 300; // points per pen layer; a longer line carries on as a new layer
  const LIFT_K = 0.008, PEN_LIFT_K = 0.15; // how far a mark sits off the surface, as a share of its radius (the polygon offset does the rest)
  const BATCH_MAX = 262144; // vertices per paint mesh before another one starts

  // ---------------------------------------------------------------- the paint's picture: 4 splatters and the pen's dot
  // A 4 x 2 atlas of 256 px cells, drawn the same on every machine (seeded), white: each layer's colour tints it
  const CELL = 256, ATLAS = (() => {
    const c = document.createElement('canvas'); c.width = CELL * 4; c.height = CELL * 2;
    const x = c.getContext('2d'); x.fillStyle = '#fff'; x.strokeStyle = '#fff';
    let seed = 1;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const dot = (cx, cy, r, a = 1) => { x.globalAlpha = a; x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.fill(); };
    // cell (col, row) as the UVs see it: the canvas is flipped onto the texture, so UV row 0 is the canvas's bottom half
    const at = (col, row) => [col * CELL + CELL / 2, (1 - row) * CELL + CELL / 2];
    const splat = (col, s, k) => {
      seed = s; const [cx, cy] = at(col, 0), R = CELL * 0.27;
      x.save(); x.translate(cx, cy); x.scale(k.sx || 1, 1);
      // a soft halo of overspray, then the wet middle (overlapping blobs, so its edge is ragged), lobes and droplets
      const g = x.createRadialGradient(0, 0, R * 0.6, 0, 0, R * 1.55); g.addColorStop(0, 'rgba(255,255,255,0.45)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      x.globalAlpha = 1; x.fillStyle = g; x.beginPath(); x.arc(0, 0, R * 1.55, 0, Math.PI * 2); x.fill(); x.fillStyle = '#fff';
      for (let i = 0; i < 26; i++) { const a = rnd() * Math.PI * 2, d = Math.pow(rnd(), 1.5) * R * 0.5; dot(Math.cos(a) * d, Math.sin(a) * d, R * (0.32 + rnd() * 0.3)); }
      for (let i = 0; i < k.lobes; i++) {
        const a = rnd() * Math.PI * 2, len = R * (0.75 + rnd() * k.reach);
        let r = R * (0.16 + rnd() * 0.1);
        for (let d = R * 0.5; d < len && r > 1.2; d += r * 0.55) { dot(Math.cos(a) * d, Math.sin(a) * d, r); r *= 0.9; }
        if (rnd() < 0.7) dot(Math.cos(a) * (len + R * 0.12), Math.sin(a) * (len + R * 0.12), Math.max(1.5, r * 1.3)); // a drop off the end
      }
      for (let i = 0; i < k.drops; i++) { const a = rnd() * Math.PI * 2, d = R * (0.85 + rnd() * 0.75); dot(Math.cos(a) * d, Math.sin(a) * d, 1 + rnd() * k.dropR, 0.6 + rnd() * 0.4); }
      x.restore(); x.globalAlpha = 1;
    };
    splat(0, 11, { lobes: 7, reach: 0.5, drops: 70, dropR: 3.5 });
    splat(1, 23, { lobes: 12, reach: 0.9, drops: 40, dropR: 3 });
    splat(2, 37, { lobes: 6, reach: 0.6, drops: 55, dropR: 4, sx: 1.18 });
    splat(3, 51, { lobes: 9, reach: 0.4, drops: 110, dropR: 2.5 });
    { // the pen: a round dot, solid to near its edge
      const [cx, cy] = at(0, 1), g = x.createRadialGradient(cx, cy, 0, cx, cy, CELL * 0.46);
      g.addColorStop(0, '#fff'); g.addColorStop(0.82, '#fff'); g.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = g; x.fillRect(cx - CELL / 2, cy - CELL / 2, CELL, CELL);
    }
    const t = new THREE.CanvasTexture(c); t.anisotropy = 4; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    return t;
  })();
  const PEN_CELL = [0, 1];

  // ---------------------------------------------------------------- the paint's material
  // Lit like everything else (the fort's sun grid, sampled a little in front of the surface so a wall's paint
  // takes the light of the air it faces). Each vertex says which atlas cell it shows and its colour and opacity; UVs run
  // 0-1 across the mark and anything outside that is dropped, so a splatter can keep whole triangles (no clipping)
  function patch(sh, r) {
    THREE.MeshToonMaterial.prototype.onBeforeCompile(sh, r);
    sh.vertexShader = 'attribute vec4 pcol; attribute vec2 pcell; varying vec4 vPcol; varying vec2 vPcell;\n' + sh.vertexShader
      .replace('#include <uv_vertex>', '#include <uv_vertex>\n  vPcol = pcol; vPcell = pcell;')
      .replace('vSunPos = (modelMatrix * sunWp).xyz;', 'vSunPos = (modelMatrix * sunWp).xyz + normalize((modelMatrix * vec4(objectNormal, 0.0)).xyz) * 0.3;');
    sh.fragmentShader = 'varying vec4 vPcol; varying vec2 vPcell;\n' + sh.fragmentShader.replace('#include <map_fragment>', `
      if (vUv.x < 0.0 || vUv.x > 1.0 || vUv.y < 0.0 || vUv.y > 1.0) discard;
      vec4 texelColor = texture2D(map, (vPcell + clamp(vUv, 0.01, 0.99)) * vec2(0.25, 0.5));
      diffuseColor *= vec4(texelColor.rgb * vPcol.rgb * 1.15, texelColor.a * vPcol.a);
      if (diffuseColor.a < 0.004) discard;`);
  }
  // A subclass so a copy (a fading body's) keeps the shader
  class PaintMat extends THREE.MeshToonMaterial {
    constructor(p) { super(p); this.onBeforeCompile = patch; }
    customProgramCacheKey() { return 'paint' + (this.skinning ? 's' : ''); }
  }
  const matOpts = { gradientMap: RAMP, map: ATLAS, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 };
  const MAT = new PaintMat(matOpts), MAT_SKIN = new PaintMat(Object.assign({ skinning: true }, matOpts));

  // ---------------------------------------------------------------- paint meshes
  // One mesh per thing painted (the level, a door, a vehicle part, a character's mesh), its triangles added in order:
  // nothing writes depth, so a later layer draws over the ones before in the same draw call.
  const SIZE = { position: 3, normal: 3, uv: 2, pcol: 4, pcell: 2, skinIndex: 4, skinWeight: 4 };
  const ARR = { position: Float32Array, normal: Float32Array, uv: Float32Array, pcol: Uint8Array, pcell: Uint8Array, skinIndex: Uint16Array, skinWeight: Float32Array };
  const world = new THREE.Group(); world.name = 'paint'; scene.add(world);
  const chains = new Map(); // the object painted -> its paint meshes, oldest first
  let order = 0; // render order 2 + a little more per paint mesh: after the scorches (1), before the bullet holes (3)
  let vertTotal = 0;
  class Batch {
    constructor(A, ro) {
      this.A = A; this.skin = A.skin || null; this.n = 0; this.cap = 0; this.parts = []; this.d0 = Infinity; this.d1 = -1;
      this.grow(this.skin ? 256 : 1024);
      const m = this.skin ? new THREE.SkinnedMesh(this.g, MAT_SKIN) : new THREE.Mesh(this.g, MAT);
      m.frustumCulled = false; m.renderOrder = ro; m.castShadow = false; m.receiveShadow = !this.skin; m.matrixAutoUpdate = A.obj !== world;
      if (this.skin) { const s = this.skin; m.bind(s.skeleton, s.bindMatrix); m.position.copy(s.position); m.quaternion.copy(s.quaternion); m.scale.copy(s.scale); s.parent.add(m); m.updateMatrixWorld(true); }
      else A.obj.add(m);
      this.mesh = m;
    }
    grow(cap) {
      const g = new THREE.BufferGeometry(), old = this.g;
      for (const k in SIZE) {
        if (!this.skin && (k === 'skinIndex' || k === 'skinWeight')) continue;
        const a = new ARR[k](cap * SIZE[k]); if (old) a.set(old.attributes[k].array.subarray(0, this.n * SIZE[k]));
        const at = new THREE.BufferAttribute(a, SIZE[k], k === 'pcol'); at.setUsage(THREE.DynamicDrawUsage); g.setAttribute(k, at);
      }
      g.setDrawRange(0, this.n); this.g = g; this.cap = cap; this.d0 = Infinity; this.d1 = -1;
      if (old) { this.mesh.geometry = g; old.dispose(); }
    }
    room(k) { if (this.n + k <= this.cap) return true; if (this.n + k > BATCH_MAX) return false; this.grow(Math.min(BATCH_MAX, Math.max(this.cap * 2, this.n + k))); return true; }
    // send the GPU just the vertices written since the last frame
    // (a range of -1 sends it all; after a cut, everything goes until the next frame is drawn)
    commit() {
      if (this.d1 < 0) return;
      const all = this.allAt === renderer.info.render.frame;
      for (const k in this.g.attributes) {
        const at = this.g.attributes[k], s = SIZE[k], r = at.updateRange, o = this.d0 * s, e = this.d1 * s;
        if (!all) { if (r.count === -1) { r.offset = o; r.count = e - o; } else { const lo = Math.min(r.offset, o), hi = Math.max(r.offset + r.count, e); r.offset = lo; r.count = hi - lo; } }
        at.needsUpdate = true;
      }
      this.g.setDrawRange(0, this.n); this.d0 = Infinity; this.d1 = -1;
    }
    // Cut out a part (the oldest layer going)
    cut(pt) {
      const s0 = pt.s, c = pt.c;
      for (const k in this.g.attributes) { const at = this.g.attributes[k], s = SIZE[k]; at.array.copyWithin(s0 * s, (s0 + c) * s, this.n * s); at.updateRange.offset = 0; at.updateRange.count = -1; at.needsUpdate = true; }
      this.n -= c; this.parts.splice(this.parts.indexOf(pt), 1); this.allAt = renderer.info.render.frame;
      for (const q of this.parts) if (q.s > s0) q.s -= c;
      this.g.setDrawRange(0, this.n);
    }
    dispose() { if (this.mesh.parent) this.mesh.parent.remove(this.mesh); this.g.dispose(); }
  }
  function batchFor(A, k) {
    let ch = chains.get(A.obj);
    if (!ch) { ch = []; chains.set(A.obj, ch); }
    let b = ch[ch.length - 1];
    if (!b || !b.room(k)) { b = new Batch(A, 2 + (order++) * 1e-5); ch.push(b); }
    return b;
  }

  // ---------------------------------------------------------------- layers
  // A layer is one click (one splatter, or one pen line). parts: where its vertices are, per paint mesh.
  const layers = [], byId = new Map();
  function newLayer(rec) { const L = { id: rec.i, rec, parts: [], verts: 0 }; layers.push(L); byId.set(rec.i, L); return L; }
  // Start writing k vertices of layer L onto anchor A
  let cur = null;
  function begin(L, A, k) {
    const b = batchFor(A, k);
    let pt = L.parts[L.parts.length - 1];
    if (!pt || pt.b !== b || pt.s + pt.c !== b.n) { pt = { b, s: b.n, c: 0, L }; L.parts.push(pt); b.parts.push(pt); }
    cur = pt; if (b.d0 > b.n) b.d0 = b.n;
    return b;
  }
  function vtx(b, px, py, pz, nx, ny, nz, u, v, rgba, cell, si, sw) {
    const i = b.n++, A = b.g.attributes;
    A.position.array[i * 3] = px; A.position.array[i * 3 + 1] = py; A.position.array[i * 3 + 2] = pz;
    A.normal.array[i * 3] = nx; A.normal.array[i * 3 + 1] = ny; A.normal.array[i * 3 + 2] = nz;
    A.uv.array[i * 2] = u; A.uv.array[i * 2 + 1] = v;
    A.pcol.array.set(rgba, i * 4); A.pcell.array[i * 2] = cell[0]; A.pcell.array[i * 2 + 1] = cell[1];
    if (si) { A.skinIndex.array.set(si, i * 4); A.skinWeight.array.set(sw, i * 4); }
    cur.c++; cur.L.verts++; vertTotal++; b.d1 = b.n;
  }
  function dropLayer(L) {
    for (const pt of L.parts) if (pt.b.parts.includes(pt)) { pt.b.cut(pt); vertTotal -= pt.c; }
    L.parts.length = 0; byId.delete(L.id);
    const i = layers.indexOf(L); if (i >= 0) layers.splice(i, 1);
    if (NET.role === 'host') { const j = log.indexOf(L.rec); if (j >= 0) log.splice(j, 1); }
    if (stroke && stroke.L === L) stroke = null;
  }
  function trim() {
    if (layers.length <= PAINT_MAX && vertTotal <= VERT_MAX) return;
    const keepL = Math.floor(PAINT_MAX * 0.9), keepV = VERT_MAX * 0.9;
    while (layers.length && (layers.length > keepL || vertTotal > keepV)) dropLayer(layers[0]);
  }

  // ---------------------------------------------------------------- what can be painted (anchors)
  // An anchor is how every machine finds the same thing: ['w'] the level (world coordinates), ['d', i] a door (its hinge's
  // frame), ['v', vehicle, mesh] a vehicle part (that mesh's frame), ['e', entity id, mesh] a character (that skinned
  // mesh's bind pose, so paint follows the body however it's posed)
  const hinges = () => [...levelSheds().map(s => s.door), ...(typeof DOORS !== 'undefined' && DOORS && DOORS.leaves ? DOORS.leaves.map(l => l.hinge) : []), LV && LV.towerDoor && TDOOR.hinge].filter(Boolean);
  const rigSkins = rig => rig._skins || (rig._skins = (() => { const s = []; rig.root.traverse(o => { if (o.isSkinnedMesh) s.push(o); }); return s; })());
  const vehMeshes = v => (v._pmG === v.g ? v._pm : (v._pmG = v.g, v._pm = (() => { const s = []; v.g.traverse(o => { if (o.isMesh) s.push(o); }); return s; })()));
  const entById = id => ents.find(o => o.id === id);
  function resolve(a) {
    if (!Array.isArray(a)) return null;
    if (a[0] === 'w') return { obj: world, kind: 'w' };
    if (a[0] === 'd') { const h = hinges()[a[1]]; return h ? { obj: h, kind: 'd' } : null; }
    if (a[0] === 'v') { const v = VEH.list[a[1]], m = v && v.g && vehMeshes(v)[a[2]]; return m ? { obj: m, kind: 'v' } : null; }
    if (a[0] === 'e') { const e = entById(a[1]), s = e && e.rig && rigSkins(e.rig)[a[2]]; return s ? { obj: s, kind: 'e', skin: s, rig: e.rig, e } : null; }
    return null;
  }
  const visibleChain = o => { for (; o; o = o.parent) if (!o.visible) return false; return true; };
  const attached = o => { while (o.parent) o = o.parent; return o === scene; };
  const drawn = h => h.face && visibleChain(h.object) && !(h.object.material && h.object.material.visible === false);

  // ---------------------------------------------------------------- building the marks
  const _t = new V3(), _b = new V3(), _up = new V3(0, 1, 0), _x = new V3(1, 0, 0), _pa = new V3(), _pb = new V3(), _pc = new V3(), _fn = new V3(), _q = new V3(), _tri = new THREE.Triangle(), _m4 = new THREE.Matrix4(), _m3 = new THREE.Matrix3();
  function basis(n, spin) {
    _t.crossVectors(Math.abs(n.y) < 0.9 ? _up : _x, n).normalize(); _b.crossVectors(n, _t);
    if (spin) { const c = Math.cos(spin), s = Math.sin(spin), tx = _t.x, ty = _t.y, tz = _t.z; _t.multiplyScalar(c).addScaledVector(_b, s); _b.multiplyScalar(c).addScaledVector(_q.set(tx, ty, tz), -s); }
  }
  const rgbaOf = (c, a) => [Math.round(PAL[c].r * 255), Math.round(PAL[c].g * 255), Math.round(PAL[c].b * 255), Math.round(Math.max(0, Math.min(1, a)) * 255)];
  // A flat dot (the pen): p and n in the anchor's frame
  function quad(L, A, p, n, r, rgba, lift, si, sw) {
    basis(n, 0); const b = begin(L, A, 6);
    const cs = [[-1, -1], [1, -1], [1, 1], [-1, -1], [1, 1], [-1, 1]];
    for (const [u, v] of cs) vtx(b, p.x + (_t.x * u + _b.x * v) * r + n.x * lift, p.y + (_t.y * u + _b.y * v) * r + n.y * lift, p.z + (_t.z * u + _b.z * v) * r + n.z * lift, n.x, n.y, n.z, (u + 1) / 2, (v + 1) / 2, rgba, PEN_CELL, si, sw);
  }
  // A splatter: every triangle near p that faces along n gets the splatter projected onto it along n
  function emitTri(L, A, a, bb, c, fn, p, r, rgba, cell, lift, nA, si, sw) {
    const b = begin(L, A, 3);
    for (let k = 0; k < 3; k++) {
      const v = k === 0 ? a : k === 1 ? bb : c, vn = nA ? nA[k] : fn;
      _q.copy(v).sub(p);
      vtx(b, v.x + vn.x * lift, v.y + vn.y * lift, v.z + vn.z * lift, vn.x, vn.y, vn.z, _q.dot(_t) / (2 * r) + 0.5, _q.dot(_b) / (2 * r) + 0.5, rgba, cell, si && si[k], sw && sw[k]);
    }
  }
  const FACING = 0.2;
  function splatWorld(L, A, p, n, r, rgba, cell) {
    const r2 = r * r;
    const tri = (a, b, c, fn, two) => {
      let f = fn.dot(n);
      if (f < 0 && two) { f = -f; _fn.copy(fn).negate(); fn = _fn; }
      if (f < FACING) return;
      if (_tri.set(a, b, c).closestPointToPoint(p, _q).distanceToSquared(p) > r2) return;
      emitTri(L, A, a, b, c, fn, p, r, rgba, cell, r * LIFT_K);
    };
    if (TG) {
      const G = TG, T = G.T, B = G.B, NR = G.NR, fnv = new V3();
      tgEach(p.x - r, p.z - r, p.x + r, p.z + r, t => {
        if (!G.SHOT[t] || G.MESH[t] < 0 || B[t * 6 + 1] > p.y + r || B[t * 6 + 4] < p.y - r) return;
        const m = G.meshes[G.MESH[t]], ud = m.userData; if (ud.toggle !== undefined || ud.lift !== undefined || ud.noHole || m === TDOOR.shot) return; // (doors move: they're painted as doors)
        const q = t * 9; _pa.set(T[q], T[q + 1], T[q + 2]); _pb.set(T[q + 3], T[q + 4], T[q + 5]); _pc.set(T[q + 6], T[q + 7], T[q + 8]);
        fnv.set(NR[t * 3], NR[t * 3 + 1], NR[t * 3 + 2]); tri(_pa, _pb, _pc, fnv, G.SIDE[t] === 2);
      });
    }
    // the levels made of boxes, and the tiled floors (no triangle grid)
    const sph = new THREE.Sphere(p, r), box = new THREE.Box3();
    for (const m of TG ? W.floors : [...W.meshes, ...W.floors]) {
      if (m.userData.noHole || m.userData.toggle !== undefined) continue;
      const g = m.geometry; if (!g.attributes.position) continue; if (!g.boundingBox) g.computeBoundingBox();
      if (!box.copy(g.boundingBox).applyMatrix4(m.matrixWorld).intersectsSphere(sph)) continue;
      eachTri(m, m.matrixWorld, (a, b, c, fn) => tri(a, b, c, fn, m.material.side === THREE.DoubleSide));
    }
  }
  // Every triangle of mesh m, in the frame mat takes it to
  const _ea = new V3(), _eb = new V3(), _ec = new V3(), _en = new V3(), _e1 = new V3(), _e2 = new V3();
  function eachTri(m, mat, fn) {
    const g = m.geometry, pa = g.attributes.position, idx = g.index, n = idx ? idx.count : pa.count;
    for (let i = 0; i + 2 < n; i += 3) {
      const i0 = idx ? idx.getX(i) : i, i1 = idx ? idx.getX(i + 1) : i + 1, i2 = idx ? idx.getX(i + 2) : i + 2;
      _ea.fromBufferAttribute(pa, i0).applyMatrix4(mat); _eb.fromBufferAttribute(pa, i1).applyMatrix4(mat); _ec.fromBufferAttribute(pa, i2).applyMatrix4(mat);
      _en.crossVectors(_e1.subVectors(_eb, _ea), _e2.subVectors(_ec, _ea)); const l = _en.length(); if (l < 1e-12) continue; _en.divideScalar(l);
      fn(_ea, _eb, _ec, _en, i0, i1, i2);
    }
  }
  // A door or a vehicle part: its own triangles, in its own frame (a door: every mesh under the hinge)
  function splatObject(L, A, p, n, r, rgba, cell) {
    const root = A.obj, inv = new THREE.Matrix4().copy(root.matrixWorld).invert(), r2 = r * r, sph = new THREE.Sphere(), lift = r * LIFT_K;
    const list = []; if (A.kind === 'v') list.push(root); else root.traverse(o => { if (o.isMesh && o.visible) list.push(o); });
    for (const m of list) {
      const mat = new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld), g = m.geometry; if (!g.attributes.position) continue;
      if (!g.boundingSphere) g.computeBoundingSphere();
      sph.copy(g.boundingSphere).applyMatrix4(mat); if (sph.center.distanceTo(p) > sph.radius + r) continue;
      const two = m.material.side === THREE.DoubleSide;
      eachTri(m, mat, (a, b, c, fn) => {
        let f = fn.dot(n); if (f < 0 && two) { f = -f; fn.negate(); }
        if (f < FACING || _tri.set(a, b, c).closestPointToPoint(p, _q).distanceToSquared(p) > r2) return;
        emitTri(L, A, a, b, c, fn, p, r, rgba, cell, lift);
      });
    }
  }
  // A character: the triangles of every one of its skinned meshes, in their bind pose, with their skin weights
  const _si = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], _sw = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], _vn = [new V3(), new V3(), new V3()];
  function skinOf(g, i, si, sw) { const I = g.attributes.skinIndex, Wt = g.attributes.skinWeight; si[0] = I.getX(i); si[1] = I.getY(i); si[2] = I.getZ(i); si[3] = I.getW(i); sw[0] = Wt.getX(i); sw[1] = Wt.getY(i); sw[2] = Wt.getZ(i); sw[3] = Wt.getW(i); }
  function splatBody(L, A, p, n, r, rgba, cell) {
    const src = A.skin, skins = rigSkins(A.rig), toBindWorld = src.bindMatrix, r2 = r * r;
    const pw = p.clone().applyMatrix4(toBindWorld), nw = n.clone().transformDirection(toBindWorld);
    for (const s of skins) {
      const g = s.geometry; if (!g.attributes.skinIndex) continue;
      // (not s.bindMatrixInverse: attached skins keep that as the inverse of their world matrix)
      const back = new THREE.Matrix4().copy(s.bindMatrix).invert(), pl = pw.clone().applyMatrix4(back), nl = nw.clone().transformDirection(back), na = g.attributes.normal;
      if (!g.boundingSphere) g.computeBoundingSphere();
      if (g.boundingSphere.center.distanceTo(pl) > g.boundingSphere.radius + r) continue;
      basis(nl, A.spin || 0);
      const As = s === src ? A : { obj: s, kind: 'e', skin: s, rig: A.rig, e: A.e };
      eachTri(s, _m4.identity(), (a, b, c, fn, i0, i1, i2) => {
        if (fn.dot(nl) < FACING || _tri.set(a, b, c).closestPointToPoint(pl, _q).distanceToSquared(pl) > r2) return;
        const ix = [i0, i1, i2];
        for (let k = 0; k < 3; k++) { skinOf(g, ix[k], _si[k], _sw[k]); if (na) _vn[k].fromBufferAttribute(na, ix[k]); else _vn[k].copy(fn); }
        emitTri(L, As, a, b, c, fn, pl, r, rgba, cell, r * LIFT_K, _vn, _si, _sw);
      });
      basis(n, A.spin || 0); // (the next mesh sets its own)
    }
  }

  // ---------------------------------------------------------------- applying a layer (mine, or one that came in)
  // rec: { i: id, a: anchor, s: 1 spray / 0 pen, c: colour, p, n, r, al, v, sp (spray) | q: points, pr: pen radius (pen) }
  // Pen points are [x, y, z, nx, ny, nz, broken (1: no line from the point before), skin vertex (characters)] in the anchor's frame
  const _p = new V3(), _n = new V3(), _p0 = new V3(), _n0 = new V3();
  function applyRec(rec, L) {
    const A = resolve(rec.a); if (!A) return false;
    if (!L) L = newLayer(rec);
    if (rec.s) {
      const rgba = rgbaOf(rec.c, rec.al / 100), cell = [rec.v & 3, 0];
      _p.fromArray(rec.p); _n.fromArray(rec.n).normalize(); basis(_n, rec.sp);
      if (A.kind === 'w') splatWorld(L, A, _p, _n, rec.r, rgba, cell);
      else if (A.kind === 'e') { A.spin = rec.sp; splatBody(L, A, _p, _n, rec.r, rgba, cell); }
      else splatObject(L, A, _p, _n, rec.r, rgba, cell);
      commitAll(L);
    } else penPoints(L, A, rec, 0);
    L.A = A; return L;
  }
  function commitAll(L) { for (const pt of L.parts) pt.b.commit(); }
  // Pen points from index k0 on: a dot at each, with dots every half radius along the line from the point before
  function penPoints(L, A, rec, k0) {
    const q = rec.q, S = A.kind === 'e' ? 8 : 7, rgba = rgbaOf(rec.c, 1), r = rec.pr, lift = r * PEN_LIFT_K;
    const g = A.skin && A.skin.geometry, si = [0, 0, 0, 0], sw = [0, 0, 0, 0];
    for (let k = k0; k * S + S <= q.length; k++) {
      const o = k * S; _p.set(q[o], q[o + 1], q[o + 2]); _n.set(q[o + 3], q[o + 4], q[o + 5]).normalize();
      if (g) { const vi = q[o + 7]; if (!(vi >= 0 && vi < g.attributes.position.count)) continue; skinOf(g, vi, si, sw); }
      if (k > 0 && !q[o + 6]) {
        const p = (k - 1) * S; _p0.set(q[p], q[p + 1], q[p + 2]); _n0.set(q[p + 3], q[p + 4], q[p + 5]).normalize();
        const d = _p0.distanceTo(_p), steps = Math.min(200, Math.ceil(d / (r * 0.5)));
        for (let j = 1; j < steps; j++) { const f = j / steps; quad(L, A, _q.copy(_p0).lerp(_p, f), _fn.copy(_n0).lerp(_n, f).normalize(), r, rgba, lift, g && si, g && sw); }
      }
      quad(L, A, _p, _n, r, rgba, lift, g && si, g && sw);
    }
    commitAll(L);
  }

  // ---------------------------------------------------------------- what the tools hit
  const ray = new THREE.Raycaster(), _o = new V3(), _d = new V3(), _w = new V3(), _wn = new V3();
  const worldNormal = (h) => _wn.copy(h.face.normal).applyMatrix3(_m3.getNormalMatrix(h.object.matrixWorld)).normalize();
  const _A = new V3(), _B = new V3(), _C = new V3(), _bc = new V3(), _inv = new THREE.Matrix4();
  // cheap: just how far (the crosshair), skipping the exact body and vehicle tests
  function paintCast(reach, cheap) {
    camera.getWorldPosition(_o); camera.getWorldDirection(_d);
    const back = _o.distanceTo(myEye); // (3rd person: the camera is behind you; the reach counts from your eyes)
    ray.set(_o, _d); ray.far = reach + back + 0.5; ray.camera = camera;
    let best = null;
    const near = (d, h) => { if (!best || d < best.d) best = Object.assign({ d }, h); };
    // the level (and the tower door's shape, a shed's or the bunker's door shape: those are doors)
    const wh = castShotLevel(ray, [...W.meshes, ...W.floors]);
    if (wh) near(wh.distance, { k: 'w', h: wh });
    // doors, exactly: the shed, cellar and bunker doors, the gate's leaves, the tower door
    const hs = hinges();
    if (hs.length) { const dh = ray.intersectObjects(hs, true).find(drawn); if (dh) near(dh.distance, { k: 'd', h: dh }); }
    // characters: their hit boxes, then the body itself
    for (const e of ents) {
      if (e === P || !e.alive || !e.hit || !e.rig || !e.mesh || !e.mesh.visible) continue;
      const bh = ray.intersectObjects(e.hit, false)[0]; if (!bh || (best && bh.distance > best.d)) continue;
      if (cheap) { near(bh.distance, { k: 'eb' }); continue; }
      const sh = ray.intersectObjects(rigSkins(e.rig), false)[0]; if (sh && sh.face) near(sh.distance, { k: 'e', h: sh, e });
    }
    // vehicles: the parts you can see
    if (!cheap) for (const v of VEH.list) {
      if (!v.g || !v.g.visible || ray.ray.distanceSqToPoint(v.pos) > 49 || v.pos.distanceTo(_o) > ray.far + 7) continue;
      const vh = ray.intersectObject(v.g, true).find(h => h.object.isMesh && drawn(h)); if (vh) near(vh.distance, { k: 'v', h: vh, v });
    }
    if (!best) return null;
    const pt = best.h ? best.h.point : _w.copy(_o).addScaledVector(_d, best.d), eyeD = pt.distanceTo(myEye);
    best.eyeD = eyeD; best.inReach = eyeD <= reach;
    if (cheap || !best.h) return best;
    best.wp = pt.clone();
    const n = worldNormal(best.h).clone(); if (n.dot(_d) > 0) n.negate(); best.wn = n;
    // a hit on a door's shape (in the triangle grid) is the door: paint it there, on the hinge
    if (best.k === 'w') {
      const hg = impactParent(best.h.object, pt), i = hg ? hs.indexOf(hg) : -1;
      if (hg && i < 0) return null; // a door we can't name for the others
      if (i >= 0) { best.k = 'd'; best.hinge = hg; best.di = i; }
    } else if (best.k === 'd') { let o = best.h.object; while (o && !hs.includes(o)) o = o.parent; if (!o) return null; best.hinge = o; best.di = hs.indexOf(o); }
    return best;
  }
  // The anchor, and the point, normal and scale in its frame, for a hit
  function anchorOf(hit) {
    if (hit.k === 'w') return { a: ['w'], p: hit.wp, n: hit.wn, s: 1 };
    const toLocal = (obj) => { obj.updateMatrixWorld(); const inv = _inv.copy(obj.matrixWorld).invert(); return { p: hit.wp.clone().applyMatrix4(inv), n: hit.wn.clone().transformDirection(inv), s: obj.matrixWorld.getMaxScaleOnAxis() }; };
    if (hit.k === 'd') return Object.assign({ a: ['d', hit.di] }, toLocal(hit.hinge));
    if (hit.k === 'v') { const m = hit.h.object, i = vehMeshes(hit.v).indexOf(m); if (i < 0) return null; return Object.assign({ a: ['v', hit.v.i, i] }, toLocal(m)); }
    if (hit.k === 'e') {
      // where on the triangle the ray landed, put back onto the bind pose
      const src = hit.h.object, f = hit.h.face, g = src.geometry, pa = g.attributes.position, skins = rigSkins(hit.e.rig), mi = skins.indexOf(src);
      if (mi < 0) return null;
      src.boneTransform(f.a, _A); src.boneTransform(f.b, _B); src.boneTransform(f.c, _C);
      const lp = hit.wp.clone().applyMatrix4(_inv.copy(src.matrixWorld).invert());
      _tri.set(_A, _B, _C).getBarycoord(lp, _bc);
      const RA = new V3().fromBufferAttribute(pa, f.a), RB = new V3().fromBufferAttribute(pa, f.b), RC = new V3().fromBufferAttribute(pa, f.c);
      const p = new V3().addScaledVector(RA, _bc.x).addScaledVector(RB, _bc.y).addScaledVector(RC, _bc.z), n = new THREE.Triangle(RA, RB, RC).getNormal(new V3());
      const vi = _bc.x >= _bc.y && _bc.x >= _bc.z ? f.a : _bc.y >= _bc.z ? f.b : f.c;
      const posed = _A.applyMatrix4(src.matrixWorld).distanceTo(_B.applyMatrix4(src.matrixWorld)) + _B.distanceTo(_C.applyMatrix4(src.matrixWorld)), raw = RA.distanceTo(RB) + RB.distanceTo(RC);
      return { a: ['e', hit.e.id, mi], p, n, s: raw > 1e-6 && posed > 1e-6 ? posed / raw : 1, vi };
    }
    return null;
  }

  // ---------------------------------------------------------------- the tools
  let on = false, safe = false, tool = 'pen', drawT = 0, sprayCd = 0, kick = 0, press = 0, seq = 0;
  const colOf = { pen: 0, spray: 2 };
  let stroke = null; // the pen line being drawn: { L, rec, last: point (world), lastN, sent: points sent }
  const r3 = v => Math.round(v * 1000) / 1000, r2 = v => Math.round(v * 100) / 100;
  const newId = () => `${NET.myId}.${++seq}`;
  function toggle() {
    if (!RANGE.on) return;
    if (!on) {
      if (!P.alive) return;
      on = true; safe = false; drawT = SWITCH; stroke = null;
      RANGE.stow(); mouseRight = false; tAim = false; clickQ = false;
      hint('draw', 'Draw: 1–6 colour, Q pen or spray can, P back to your weapons', 4.5);
    } else leave();
  }
  function leave() {
    endStroke(); on = false; safe = false; drawT = 0;
    if (RANGE.on && P.alive) { RANGE.unstow(); switchT = SWITCH; }
  }
  function setTool(t) { if (t === tool) return; endStroke(); tool = t; drawT = Math.max(drawT, 0.25); }
  function endStroke() { if (stroke) { flush(); stroke = null; } }
  // Your pen line's new points go out every 0.1 s
  let flushT = 0;
  function flush() {
    if (!stroke) return;
    const q = stroke.rec.q, from = stroke.sent;
    if (q.length > from) { netFx({ t: 'pa', i: stroke.rec.i, q: q.slice(from) }); stroke.sent = q.length; }
  }
  function startLayer(rec) { const L = applyRec(rec); if (!L) return null; if (NET.role === 'host') log.push(rec); trim(); return L; }
  function penTick() {
    const hit = paintCast(PEN_REACH);
    if (!hit || !hit.inReach || !hit.wp) { if (stroke) stroke.broken = true; return; }
    const an = anchorOf(hit); if (!an) return;
    const key = an.a.join(), body = an.a[0] === 'e', S = body ? 8 : 7;
    // a new layer: a new click, another thing under the pen, or this line's long enough
    if (!stroke || stroke.key !== key || stroke.rec.q.length >= STROKE_MAX * S) {
      endStroke();
      const rec = { i: newId(), a: an.a, s: 0, c: colOf.pen, pr: r3(PEN_R / an.s), q: [] };
      stroke = { rec, key, S, sent: 0, last: null, broken: false };
      pushPoint(an, hit, S, false);
      stroke.L = startLayer(rec); if (!stroke.L) { stroke = null; return; }
      netFx(Object.assign({ t: 'pt' }, rec)); stroke.sent = rec.q.length;
      return;
    }
    if (stroke.last && stroke.last.distanceTo(hit.wp) < PEN_STEP) return;
    const k = stroke.rec.q.length / S;
    pushPoint(an, hit, S, stroke.broken || (stroke.last && !sameSurface(stroke.last, stroke.lastN, hit.wp, hit.wn)));
    stroke.broken = false;
    if (stroke.L && byId.get(stroke.rec.i) === stroke.L) penPoints(stroke.L, stroke.L.A, stroke.rec, k);
  }
  // Two pen points join up when they're on one surface: near enough, facing the same way, and in the same plane
  // (not across a corner or a gap, or from a wall onto the floor behind it)
  function sameSurface(p0, n0, p1, n1) {
    const d = p0.distanceTo(p1); if (d > 1.5 || n0.dot(n1) < 0.7) return false;
    return Math.abs(_q.copy(p1).sub(p0).dot(n0)) < 0.15 * d + 0.02;
  }
  function pushPoint(an, hit, S, broken) {
    const q = stroke.rec.q;
    q.push(r3(an.p.x), r3(an.p.y), r3(an.p.z), r2(an.n.x), r2(an.n.y), r2(an.n.z), broken ? 1 : 0);
    if (S === 8) q.push(an.vi);
    stroke.last = hit.wp.clone(); stroke.lastN = hit.wn.clone();
  }
  function spray() {
    kick = 1; const hit = paintCast(SPRAY_REACH), from = nozzleOf(P) || myEye.clone();
    let to = hit && hit.wp && hit.inReach ? hit.wp : null;
    mist(from, to || from.clone().addScaledVector(_d, 1.4), colOf.spray, !!to); hiss(1);
    if (!to) { netFx({ t: 'pm', f: arr(from), d: arr(_d), c: colOf.spray }); return; }
    const an = anchorOf(hit); if (!an) return;
    const d = hit.eyeD, rw = an.a[0] === 'e' ? Math.min(BODY_R, sprayR(d)) : sprayR(d);
    const rec = { i: newId(), a: an.a, s: 1, c: colOf.spray, p: [r3(an.p.x), r3(an.p.y), r3(an.p.z)], n: [r2(an.n.x), r2(an.n.y), r2(an.n.z)], r: r3(rw / an.s), al: Math.round(sprayA(d) * 100), v: Math.floor(Math.random() * 4), sp: Math.round(Math.random() * 628) / 100, f: arr(from) };
    if (startLayer(rec)) netFx(Object.assign({ t: 'pt' }, rec));
  }
  function update(dt) {
    sprayCd -= dt;
    if (!RANGE.on) { if (on) leave(); return; }
    if (drawT > 0) { drawT -= dt; clickQ = false; endStroke(); if (drawT <= 0) safe = true; return; }
    if (!P.alive || monitorOpen || VEH.noGuns) { endStroke(); clickQ = false; return; }
    if (tool === 'pen') { const go = mouseDown || clickQ; clickQ = false; if (go) penTick(); else endStroke(); }
    else if (clickQ) { clickQ = false; if (sprayCd <= 0) { sprayCd = SPRAY_CD; spray(); } }
    if (stroke && (flushT -= dt) <= 0) { flushT = 0.1; flush(); }
  }

  // ---------------------------------------------------------------- the tools in your hand
  // Drawn like the knife: they point down -z with their middle in the palm. userData.tint is the coloured part,
  // userData.tip where the paint comes out
  function heldObject(kind, c) {
    const g = new THREE.Group(), tint = toonMat({ color: PAL[c || 0] }), o = new THREE.Group(); o.add(g);
    const cyl = (r, h, m, rt) => new THREE.Mesh(new THREE.CylinderGeometry(rt === undefined ? r : rt, r, h, 14), m);
    if (kind === 'pen') {
      const body = cyl(0.011, 0.12, toonMat({ color: 0x2b2d31 })), band = cyl(0.0115, 0.022, tint), cap = cyl(0.0105, 0.03, tint), tip = cyl(0.007, 0.022, tint, 0.0025);
      body.rotation.x = band.rotation.x = cap.rotation.x = tip.rotation.x = -Math.PI / 2; // along -z
      band.position.z = -0.035; cap.position.z = 0.072; tip.position.z = -0.071;
      [body, band, cap, tip].forEach(m => { m.castShadow = true; g.add(m); });
      const t = new THREE.Object3D(); t.position.z = -0.085; g.add(t); o.userData.tip = t;
      g.rotation.x = -0.25;
    } else {
      const body = cyl(0.033, 0.16, toonMat({ color: 0xb9bdc3 })), label = cyl(0.0335, 0.08, tint), sh = cyl(0.033, 0.025, toonMat({ color: 0xb9bdc3 }), 0.02), cap = cyl(0.02, 0.022, tint), noz = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.012, 0.016), toonMat({ color: 0x222222 }));
      sh.position.y = 0.0925; cap.position.y = 0.116; noz.position.set(0, 0.122, -0.012); label.position.y = -0.01;
      [body, label, sh, cap, noz].forEach(m => { m.castShadow = true; g.add(m); });
      const t = new THREE.Object3D(); t.position.set(0, 0.122, -0.022); g.add(t); o.userData.tip = t;
      g.position.y = -0.02;
    }
    o.userData.tint = tint; o.userData.kind = kind;
    return o;
  }
  // (setRigWeapon puts what you hold inside a holder of its own)
  const toolIn = gv => (gv && gv.children[0] && gv.children[0].userData.tint ? gv.children[0] : null);
  const nozzleOf = e => { const gv = e.rig && e.rig.gunVis, o = toolIn(gv); return o && gv.visible ? o.userData.tip.getWorldPosition(new V3()) : null; };
  // Floating viewmodel (?fpv=vm): the tool in front of you
  const artVM = new THREE.Group(); artVM.visible = false; vmScene.add(artVM);
  let vmKey = '';
  // First person: the hand reaches toward the middle of the view while the pen is down, and kicks with each spray
  const PRESS_AT = new V3(0.06, -0.08, -0.48);
  function pose(fh) {
    if (tool === 'pen') fh.lerp(PRESS_AT, press * 0.7);
    else { fh.z += kick * 0.04; fh.y += kick * 0.015; }
  }

  // ---------------------------------------------------------------- spray effects
  const mistTex = () => (GUN_FX.carbine && GUN_FX.carbine.smoke.tex) || null;
  function mist(from, to, c, landed) {
    const tex = mistTex(); if (!tex) return;
    const d = to.clone().sub(from), len = d.length(); d.divideScalar(len || 1);
    const n = 7, col = PAL[c].getHex();
    for (let i = 0; i < n; i++) {
      const k = (i + 1) / n * Math.min(1, 1.6 / Math.max(0.2, len));
      const at = from.clone().addScaledVector(d, len * k * 0.9 + 0.05);
      _puff(tex, at, 0.05 + 0.18 * k, 0.3 + Math.random() * 0.2, { color: col, vel: d.clone().multiplyScalar(2.2).add(new V3((Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.3)), grow: 0.4, opacity: 0.55, spin: 1 });
    }
    if (landed) for (let i = 0; i < 3; i++) _puff(tex, to.clone().addScaledVector(d, -0.08), 0.25 + Math.random() * 0.2, 0.35, { color: col, grow: 0.6, opacity: 0.35, spin: 1 });
  }
  function hiss(v) { if (!AC || v < 0.02) return; noise(AC.currentTime, 0.32, 0.16 * v, 9000, 4200); }

  // ---------------------------------------------------------------- the network
  // 'pt' a new layer (all of a splatter, the start of a pen line), 'pa' more points on a pen line, 'pm' a spray that hit
  // nothing; 'pl' the paint so far, to someone who just joined. The host keeps every layer (log) for the ones who join.
  const log = [], pending = []; // pending: layers on something not here yet (a character or vehicle just joining)
  let joinQ = null;
  const fin = (a, n) => Array.isArray(a) && a.length === n && a.every(Number.isFinite);
  function validRec(m) {
    if (typeof m.i !== 'string' || m.i.length > 24 || !Array.isArray(m.a) || !(m.c >= 0 && m.c < 6 && (m.c | 0) === m.c)) return false;
    const a = m.a;
    if (!(a[0] === 'w' && a.length === 1 || a[0] === 'd' && a.length === 2 && (a[1] | 0) === a[1] && a[1] >= 0 && a[1] < 64
      || a[0] === 'v' && a.length === 3 && (a[1] | 0) === a[1] && (a[2] | 0) === a[2] && a[1] >= 0 && a[2] >= 0 && a[2] < 4096
      || a[0] === 'e' && a.length === 3 && typeof a[1] === 'string' && a[1].length <= 12 && (a[2] | 0) === a[2] && a[2] >= 0 && a[2] < 64)) return false;
    if (m.s === 1) return fin(m.p, 3) && fin(m.n, 3) && m.r > 0 && m.r < 1000 && m.al >= 0 && m.al <= 100 && m.v >= 0 && m.v < 4 && Number.isFinite(m.sp);
    if (m.s === 0) return m.pr > 0 && m.pr < 100 && validPts(m.q, a[0] === 'e' ? 8 : 7);
    return false;
  }
  const validPts = (q, S) => Array.isArray(q) && q.length % S === 0 && q.length <= STROKE_MAX * S && q.every(Number.isFinite);
  const clean = m => (m.s ? { i: m.i, a: m.a, s: 1, c: m.c, p: m.p, n: m.n, r: m.r, al: m.al, v: m.v, sp: m.sp } : { i: m.i, a: m.a, s: 0, c: m.c, pr: m.pr, q: m.q.slice() });
  function take(rec) {
    if (byId.has(rec.i)) return;
    if (NET.role === 'host') log.push(rec);
    if (!applyRec(rec)) pending.push({ rec, t: 10 }); else trim();
  }
  function net(m) {
    if (m.t === 'pt') {
      if (!validRec(m)) return;
      const rec = clean(m); take(rec);
      if (m.s === 1) { // the spray's mist and hiss, from the sprayer's can
        const e = entById(m.i.split('.')[0]), from = (e && nozzleOf(e)) || (fin(m.f, 3) ? v3(m.f) : null), to = resolveWorld(rec);
        if (from && to) { mist(from, to, m.c, true); hiss(vol(to, 40)); }
      }
    } else if (m.t === 'pa') {
      const L = byId.get(m.i), pd = !L && pending.find(x => x.rec.i === m.i), rec = L ? L.rec : pd ? pd.rec : null; if (!rec) return;
      const S = rec.a[0] === 'e' ? 8 : 7; if (!validPts(m.q, S) || rec.q.length + m.q.length > STROKE_MAX * S) return;
      const k = rec.q.length / S; rec.q.push(...m.q);
      if (L && L.A) penPoints(L, L.A, rec, k);
    } else if (m.t === 'pm') {
      if (!fin(m.f, 3) || !fin(m.d, 3) || !(m.c >= 0 && m.c < 6)) return;
      const f = v3(m.f), d = v3(m.d).normalize(); mist(f, f.clone().addScaledVector(d, 1.4), m.c | 0, false); hiss(vol(f, 40));
    }
  }
  // where a splatter landed, in the world (for its mist)
  function resolveWorld(rec) {
    const A = resolve(rec.a); if (!A || !rec.p) return null;
    const p = v3(rec.p);
    if (A.kind === 'w') return p;
    if (A.kind === 'e') return A.e.pos.clone().setY(A.e.pos.y + 1.2); // near enough
    return p.applyMatrix4(A.obj.matrixWorld);
  }
  // The host: the paint so far to a guest who just joined, in pieces (one message over 64 KB closes the connection)
  function welcome(r) {
    let chunk = [], size = 0;
    for (const rec of log) {
      const s = JSON.stringify(rec).length;
      if (chunk.length && size + s > 24000) { sendTo(r, { t: 'pl', L: chunk }); chunk = []; size = 0; }
      chunk.push(rec); size += s;
    }
    if (chunk.length) sendTo(r, { t: 'pl', L: chunk });
  }
  function joinLog(m) { if (!Array.isArray(m.L)) return; for (const x of m.L.slice(0, 2000)) if (x && validRec(x)) { const rec = clean(x); if (joinQ) joinQ.push(rec); else take(rec); } }

  // ---------------------------------------------------------------- deaths, corpses, clearing
  const corpsePaint = []; // { w: the body's wrap, g: geometry } (disposed when the body goes)
  function dropBatches(test) {
    for (const [obj, ch] of chains) {
      if (!test(obj, ch)) continue;
      for (const b of ch) {
        for (const pt of b.parts.slice()) { const L = pt.L; vertTotal -= pt.c; L.parts.splice(L.parts.indexOf(pt), 1); if (!L.parts.length) dropLayer(L); }
        b.dispose();
      }
      chains.delete(obj);
    }
  }
  // A body takes its paint with it: the paint meshes move onto the corpse's own copy of the skeleton
  function toCorpse(id, rig) {
    const e = entById(id); if (!e || !e.rig || !rig) return;
    const from = rigSkins(e.rig), to = rigSkins(rig);
    for (const [obj, ch] of chains) {
      const i = from.indexOf(obj); if (i < 0) continue;
      const s = to[i];
      for (const b of ch) {
        if (s && b.n) {
          const m = new THREE.SkinnedMesh(b.g, MAT_SKIN); m.frustumCulled = false; m.renderOrder = b.mesh.renderOrder;
          m.bind(s.skeleton, s.bindMatrix); m.position.copy(s.position); m.quaternion.copy(s.quaternion); m.scale.copy(s.scale); s.parent.add(m);
          corpsePaint.push({ w: rig.wrap, g: b.g });
          b.mesh.parent && b.mesh.parent.remove(b.mesh); b.g = new THREE.BufferGeometry(); // (the body has the geometry now)
        }
        for (const pt of b.parts.slice()) { const L = pt.L; vertTotal -= pt.c; L.parts.splice(L.parts.indexOf(pt), 1); if (!L.parts.length) { byId.delete(L.id); const k = layers.indexOf(L); if (k >= 0) layers.splice(k, 1); if (stroke && stroke.L === L) stroke = null; } }
        b.parts.length = 0; b.dispose();
      }
      chains.delete(obj);
    }
    dropLog(id);
  }
  function dropLog(id) { if (NET.role !== 'host') return; for (let j = log.length - 1; j >= 0; j--) if (log[j].a[0] === 'e' && log[j].a[1] === id) log.splice(j, 1); }
  function clearEnt(e) { if (e.rig) { const s = rigSkins(e.rig); dropBatches(obj => s.includes(obj)); } }
  function clear() {
    for (const ch of chains.values()) for (const b of ch) b.dispose();
    chains.clear(); layers.length = 0; byId.clear(); log.length = 0; pending.length = 0; vertTotal = 0; stroke = null; order = 0;
    for (const c of corpsePaint) c.g.dispose(); corpsePaint.length = 0;
  }
  const alive = new Map();
  let pruneT = 0;

  // ---------------------------------------------------------------- HUD: the tool, the six colours, the crosshair
  const css = document.createElement('style');
  css.textContent = `
#arthud{position:fixed;right:18px;bottom:18px;z-index:5;display:none;flex-direction:column;align-items:flex-end;gap:8px;pointer-events:none;color:var(--hud)}
#arthud .at{font-size:15px;font-weight:600;background:var(--panel);padding:4px 10px;border-radius:4px;display:flex;gap:8px;align-items:center}
#arthud .at small{opacity:.6;font-weight:400}
#arthud .sw{display:flex;gap:6px;pointer-events:auto}
#arthud .sw b{position:relative;width:30px;height:30px;border-radius:4px;border:2px solid rgba(0,0,0,.55);box-sizing:border-box;cursor:pointer;font:600 10px system-ui;display:flex;align-items:flex-end;justify-content:flex-end;padding:1px 3px;color:rgba(255,255,255,.8);text-shadow:0 0 2px #000}
#arthud .sw b.on{outline:3px solid #fff;outline-offset:1px}
#arthud .sw b.alt:after{content:"";position:absolute;left:3px;top:3px;width:6px;height:6px;border-radius:50%;background:#fff;box-shadow:0 0 0 1px #000}
#artcross{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);border-radius:50%;pointer-events:none;display:none;box-sizing:border-box}
body.art-on #ammo,body.art-on #rslots,body.art-on #rcross,body.art-on .ch{display:none!important}
body.touch #arthud{right:calc(10px + env(safe-area-inset-right,0px));bottom:auto;top:calc(104px + env(safe-area-inset-top,0px))}
body.touch #arthud .sw{flex-direction:column}
body.touch #arthud .sw b{width:38px;height:38px}`;
  document.head.appendChild(css);
  const hud = document.createElement('div'); hud.id = 'arthud';
  hud.innerHTML = `<div class="at"><span id="arttool">Pen</span><small>${isTouch ? 'Swap switches' : 'Q switches'}</small></div><div class="sw">${PALETTE.map((c, i) => `<b data-c="${i}" style="background:${c}">${i + 1}</b>`).join('')}</div>`;
  document.body.appendChild(hud);
  const sws = [...hud.querySelectorAll('.sw b')], toolEl = hud.querySelector('#arttool');
  const pickCol = i => { colOf[tool] = i; };
  hud.querySelector('.sw').addEventListener('pointerdown', e => { const b = e.target.closest('b'); if (!b) return; e.preventDefault(); e.stopPropagation(); pickCol(+b.dataset.c); });
  hud.querySelector('.sw').addEventListener('touchstart', e => e.stopPropagation(), { passive: true });
  const crossEl = document.createElement('div'); crossEl.id = 'artcross'; $('hud').appendChild(crossEl);
  let hudKey = '', crossCss = '', aimT = 0, aim = null;
  // The pause screen's Draw / Weapons button
  const btn = document.createElement('button'); btn.type = 'button'; btn.id = 'drawbtn'; btn.className = 'wide'; btn.textContent = 'Draw'; btn.style.display = 'none';
  { const rs = $('restart'); rs.parentNode.insertBefore(btn, rs); }
  btn.onclick = () => { if (!P.alive) return; toggle(); $('play').click(); };

  function after(dt) {
    if (on && !RANGE.on) leave();
    document.body.classList.toggle('art-on', on);
    kick = Math.max(0, kick - dt * 6); press += ((on && tool === 'pen' && mouseDown && drawT <= 0 ? 1 : 0) - press) * Math.min(1, dt * 14);
    const inGame = $('tomenu').style.display !== 'none';
    btn.style.display = inGame && RANGE.on ? '' : 'none'; btn.textContent = on ? 'Weapons' : 'Draw';
    // what's in your hands
    if (on) { vm.visible = false; knifeVM.visible = false; if (typeof nadeVM !== 'undefined' && nadeVM) nadeVM.visible = false; }
    const out = on && drawT <= 0.15 && P.alive;
    const vk = out ? tool + colOf[tool] : '';
    if (vk !== vmKey) { vmKey = vk; artVM.clear(); if (out) { const o = heldObject(tool, colOf[tool]); o.position.set(0.2, -0.2, -0.42); o.rotation.set(0.15, 0.3, 0); artVM.add(o); } }
    artVM.visible = out; if (out) { artVM.position.set(-kick * 0.0, kick * 0.01, kick * 0.03 + press * -0.04); }
    const mine = toolIn(P.rig && P.rig.gunVis); if (mine) mine.userData.tint.color.copy(PAL[colOf[tool]]);
    // other people's tools
    for (const e of ents) {
      if (e === P || !e.rig) continue;
      const k = e.art > 0 ? (e.art === 1 ? 'pen' : 'spray') : null, rg = e.rig;
      if (k) {
        if (rg.artKind !== k || (rg.artVis && rg.gunVis !== rg.artVis)) { setRigWeapon(rg, k, heldObject(k, e.artC | 0)); rg.artKind = k; rg.artVis = rg.gunVis; }
        const t = toolIn(rg.gunVis); if (t) t.userData.tint.color.copy(PAL[e.artC | 0] || PAL[0]);
      } else if (rg.artKind) { rg.artKind = null; rg.artVis = null; if (e.wpn && WEAPONS[e.wpn]) setRigWeapon(rg, e.wpn); else if (rg.gunVis) { rg.gunBone.remove(rg.gunVis); rg.gunVis = null; } }
    }
    // your own body's paint shows when your body does
    if (P.rig && P.rig.body && P.rig.body.length) { const see = P.rig.body[0].material.colorWrite; for (const s of rigSkins(P.rig)) { const ch = chains.get(s); if (ch) for (const b of ch) b.mesh.visible = see; } }
    // deaths and comebacks
    for (const e of ents.includes(P) ? ents : [...ents, P]) {
      const was = alive.get(e); alive.set(e, e.alive);
      if (was === undefined) continue;
      if (was && !e.alive) dropLog(e.id);
      else if (!was && e.alive) clearEnt(e);
    }
    // late arrivals, and paint on things that have gone (a rebuilt vehicle or character, a body cleared away)
    if ((pruneT -= dt) <= 0) {
      pruneT = 0.5;
      for (let i = pending.length - 1; i >= 0; i--) { const pd = pending[i]; if (applyRec(pd.rec)) { pending.splice(i, 1); trim(); } else if ((pd.t -= 0.5) <= 0) pending.splice(i, 1); }
      dropBatches(obj => obj !== world && !attached(obj));
      for (let i = corpsePaint.length - 1; i >= 0; i--) if (!corpsePaint[i].w.parent) { corpsePaint[i].g.dispose(); corpsePaint.splice(i, 1); }
      for (const e of [...alive.keys()]) if (e !== P && !ents.includes(e)) alive.delete(e);
    }
    // HUD
    const show = on && locked && P.alive;
    hud.style.display = show ? 'flex' : 'none';
    if (show) {
      const k = tool + colOf.pen + colOf.spray;
      if (k !== hudKey) {
        hudKey = k; toolEl.textContent = tool === 'pen' ? 'Pen' : 'Spray can';
        const other = tool === 'pen' ? 'spray' : 'pen';
        sws.forEach((b, i) => { b.classList.toggle('on', i === colOf[tool]); b.classList.toggle('alt', i === colOf[other] && i !== colOf[tool]); });
      }
    }
    // The crosshair: the pen's dot, or the splatter's size where you're aiming, in the colour; faint out of reach
    let cssNow = 'display:none';
    if (show && drawT <= 0 && !VEH.noGuns) {
      if ((aimT -= dt) <= 0) { aimT = 0.05; aim = paintCast(tool === 'pen' ? PEN_REACH : SPRAY_REACH, true); }
      const reach = aim && aim.inReach, c = PALETTE[colOf[tool]], h = renderer.domElement.clientHeight || innerHeight;
      if (tool === 'pen') cssNow = `display:block;width:7px;height:7px;background:${c};border:1px solid rgba(255,255,255,.85);opacity:${reach ? 1 : 0.4}`;
      else {
        const d = aim ? Math.max(0.3, aim.eyeD) : SPRAY_REACH, rr = sprayR(d), px = Math.max(8, Math.min(240, rr / (Math.max(0.3, aim ? aim.d : d) * Math.tan(camera.fov * Math.PI / 360)) * h / 2 * 2));
        cssNow = `display:block;width:${px.toFixed(0)}px;height:${px.toFixed(0)}px;border:2px solid ${c};box-shadow:0 0 0 1px rgba(255,255,255,.6);opacity:${reach ? 0.9 : 0.35}`;
      }
    }
    if (cssNow !== crossCss) { crossCss = cssNow; crossEl.style.cssText = cssNow; }
  }

  // ---------------------------------------------------------------- keys
  function key(code) {
    if (!on) return false;
    const n = /^Digit([1-9])$/.exec(code);
    if (n) { if (+n[1] <= 6) pickCol(+n[1] - 1); return true; }
    if (code === 'KeyQ') { setTool(tool === 'pen' ? 'spray' : 'pen'); return true; }
    return code === 'KeyR' || code === 'KeyF' || code === 'KeyG' || code === 'KeyX';
  }

  Object.defineProperty(ART, 'on', { get: () => on, configurable: true });
  Object.defineProperty(ART, 'safe', { get: () => on && safe, configurable: true });
  Object.assign(ART, {
    toggle, update, after, key, pose, heldObject, net, welcome, joinLog, toCorpse, clear,
    swap() { if (on) setTool(tool === 'pen' ? 'spray' : 'pen'); },
    held: () => (on && drawT <= 0.15 && P.alive ? tool : null), // what your body holds
    state: () => (on && safe ? (tool === 'pen' ? 1 : 2) : 0), // what others see you hold (0: your weapons)
    colour: () => colOf[tool],
    hold() { joinQ = []; }, // a guest: the paint so far waits for the level
    release() { const q = joinQ || []; joinQ = null; q.forEach(take); },
    stats: () => ({ layers: layers.length, verts: vertTotal, meshes: [...chains.values()].reduce((n, c) => n + c.length, 0), log: log.length, pending: pending.length }),
  });
})();
