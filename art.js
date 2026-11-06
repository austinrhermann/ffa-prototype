// Draw mode: P (or Draw on the pause screen) puts your weapons away and gives you a pen and a spray can.
//   - Both draw while the button is held (a click leaves a dot): the pen a thin line up to PEN_REACH away, the can a
//     broad one (the same round mark, SPRAY_R across) up to SPRAY_REACH away.
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
  const PEN_R = 0.02, SPRAY_R = 0.15; // radius of the mark (metres): the pen's line is 4 cm wide, the can's 30 cm
  const PEN_REACH = 3.6, SPRAY_REACH = 9.6; // how far from your eyes each one paints
  const PEN_STEP = 0.015, SWITCH = 1;
  const PAINT_MAX = 1500, VERT_MAX = 600000; // layers kept (the oldest tenth goes past either)
  const STROKE_MAX = 300; // points per layer; a longer line carries on as a new layer
  const PEN_LIFT_K = 0.15, SPRAY_LIFT_K = 0.02; // how far a mark sits off the surface, as a share of its radius (the polygon offset does the rest)
  const BATCH_MAX = 262144; // vertices per paint mesh before another one starts
  const radiusOf = t => (t === 'pen' ? PEN_R : SPRAY_R), reachOf = t => (t === 'pen' ? PEN_REACH : SPRAY_REACH);
  const PEN = 0, SPRAY = 2; // a layer's tool (rec.s)

  // ---------------------------------------------------------------- the mark: a round dot, solid to near its edge, white
  // (each layer's colour tints it)
  const DOT = (() => {
    const S = 128, c = document.createElement('canvas'); c.width = c.height = S;
    const x = c.getContext('2d'), g = x.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    g.addColorStop(0, '#fff'); g.addColorStop(0.8, '#fff'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, S, S);
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; return t;
  })();

  // ---------------------------------------------------------------- the paint's material
  // Lit like everything else (the fort's sun grid, sampled a little in front of the surface so a wall's paint takes the
  // light of the air it faces). Each vertex carries its colour; UVs run 0-1 across the dot and anything outside that is
  // dropped (a character's paint keeps whole triangles)
  function patch(sh, r) {
    THREE.MeshToonMaterial.prototype.onBeforeCompile(sh, r);
    sh.vertexShader = 'attribute vec4 pcol; varying vec4 vPcol;\n' + sh.vertexShader
      .replace('#include <uv_vertex>', '#include <uv_vertex>\n  vPcol = pcol;')
      .replace('vSunPos = (modelMatrix * sunWp).xyz;', 'vSunPos = (modelMatrix * sunWp).xyz + normalize((modelMatrix * vec4(objectNormal, 0.0)).xyz) * 0.3;');
    sh.fragmentShader = 'varying vec4 vPcol;\n' + sh.fragmentShader.replace('#include <map_fragment>', `
      if (vUv.x < 0.0 || vUv.x > 1.0 || vUv.y < 0.0 || vUv.y > 1.0) discard;
      vec4 texelColor = texture2D(map, vUv);
      diffuseColor *= vec4(texelColor.rgb * vPcol.rgb * 1.15, texelColor.a * vPcol.a);
      if (diffuseColor.a < 0.004) discard;`);
  }
  // A subclass so a copy (a fading body's) keeps the shader
  class PaintMat extends THREE.MeshToonMaterial {
    constructor(p) { super(p); this.onBeforeCompile = patch; }
    customProgramCacheKey() { return 'paint' + (this.skinning ? 's' : ''); }
  }
  const matOpts = { gradientMap: RAMP, map: DOT, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 };
  const MAT = new PaintMat(matOpts), MAT_SKIN = new PaintMat(Object.assign({ skinning: true }, matOpts));

  // ---------------------------------------------------------------- paint meshes
  // One mesh per thing painted (the level, a door, a vehicle part, a character's mesh), its triangles added in order:
  // nothing writes depth, so a later layer draws over the ones before in the same draw call.
  const SIZE = { position: 3, normal: 3, uv: 2, pcol: 4, skinIndex: 4, skinWeight: 4 };
  const ARR = { position: Float32Array, normal: Float32Array, uv: Float32Array, pcol: Uint8Array, skinIndex: Uint16Array, skinWeight: Float32Array };
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
      paintOnly(m);
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
    // Send the GPU just the vertices written since the last frame (a range of -1 sends it all; after a cut, everything
    // goes until the next frame is drawn)
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
  // Paint is never aimed at: the tools' rays go through it to the surface under it (so a new coat goes on over the last,
  // on the same part), and it's left out of a model's list of parts
  function paintOnly(m) { m.raycast = () => {}; m.userData.paint = true; }
  function batchFor(A, k) {
    let ch = chains.get(A.obj);
    if (!ch) { ch = []; chains.set(A.obj, ch); }
    let b = ch[ch.length - 1];
    if (!b || !b.room(k)) { b = new Batch(A, 2 + (order++) * 1e-5); ch.push(b); }
    return b;
  }

  // ---------------------------------------------------------------- layers
  // A layer is one click (one line, held down). parts: where its vertices are, per paint mesh.
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
  function vtx(b, px, py, pz, nx, ny, nz, u, v, rgba, si, sw) {
    const i = b.n++, A = b.g.attributes;
    A.position.array[i * 3] = px; A.position.array[i * 3 + 1] = py; A.position.array[i * 3 + 2] = pz;
    A.normal.array[i * 3] = nx; A.normal.array[i * 3 + 1] = ny; A.normal.array[i * 3 + 2] = nz;
    A.uv.array[i * 2] = u; A.uv.array[i * 2 + 1] = v;
    A.pcol.array.set(rgba, i * 4);
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
  // frame), ['v', vehicle, mesh name, n] a vehicle part (that mesh's frame), ['e', entity id, mesh name, n] a character
  // (that skinned mesh's bind pose, so paint follows the body however it's posed). Meshes go by name (n: which of the
  // ones with that name), not by place: a model's parts can load in a different order on each machine
  const hinges = () => [...levelSheds().map(s => s.door), ...(typeof DOORS !== 'undefined' && DOORS && DOORS.leaves ? DOORS.leaves.map(l => l.hinge) : []), LV && LV.towerDoor && TDOOR.hinge].filter(Boolean);
  const rigSkins = rig => rig._skins || (rig._skins = (() => { const s = []; rig.root.traverse(o => { if (o.isSkinnedMesh && !o.userData.paint) s.push(o); }); return s; })());
  // a vehicle's meshes, in a fixed order, and a sphere round all of them in its own frame (for a quick miss)
  function vehInfo(v) {
    if (v._pmG === v.g) return v._pi;
    v._pmG = v.g; v.g.updateMatrixWorld(true);
    const meshes = []; v.g.traverse(o => { if (o.isMesh && !o.userData.paint) meshes.push(o); });
    const box = new THREE.Box3(); for (const m of meshes) { const g = m.geometry; if (!g.boundingBox) g.computeBoundingBox(); box.union(g.boundingBox.clone().applyMatrix4(m.matrixWorld)); }
    const sph = box.getBoundingSphere(new THREE.Sphere()); sph.applyMatrix4(new THREE.Matrix4().copy(v.g.matrixWorld).invert());
    return (v._pi = { meshes, sph });
  }
  const entById = id => ents.find(o => o.id === id);
  const nameOf = (list, m) => { let k = 0; for (const o of list) { if (o === m) return [m.name, k]; if (o.name === m.name) k++; } return null; };
  const byName = (list, name, k) => { for (const o of list) if (o.name === name && k-- === 0) return o; return null; };
  function resolve(a) {
    if (!Array.isArray(a)) return null;
    if (a[0] === 'w') return { obj: world, kind: 'w' };
    if (a[0] === 'd') { const h = hinges()[a[1]]; return h ? { obj: h, kind: 'd' } : null; }
    if (a[0] === 'v') { const v = VEH.list[a[1]], m = v && v.g && byName(vehInfo(v).meshes, a[2], a[3]); return m ? { obj: m, kind: 'v' } : null; }
    if (a[0] === 'e') { const e = entById(a[1]), s = e && e.rig && byName(rigSkins(e.rig), a[2], a[3]); return s ? { obj: s, kind: 'e', skin: s, rig: e.rig, e } : null; }
    return null;
  }
  const visibleChain = o => { for (; o; o = o.parent) if (!o.visible) return false; return true; };
  const attached = o => { while (o.parent) o = o.parent; return o === scene; };
  const drawn = h => h.face && visibleChain(h.object) && !(h.object.material && h.object.material.visible === false);

  // ---------------------------------------------------------------- the marks
  const _t = new V3(), _b = new V3(), _up = new V3(0, 1, 0), _x = new V3(1, 0, 0), _q = new V3(), _fn = new V3(), _tri = new THREE.Triangle(), _m3 = new THREE.Matrix3();
  function basis(n) { _t.crossVectors(Math.abs(n.y) < 0.9 ? _up : _x, n).normalize(); _b.crossVectors(n, _t); }
  const rgbaOf = c => [Math.round(PAL[c].r * 255), Math.round(PAL[c].g * 255), Math.round(PAL[c].b * 255), 255];
  // The pen: a flat dot (p and n in the anchor's frame)
  const CORNERS = [[-1, -1], [1, -1], [1, 1], [-1, -1], [1, 1], [-1, 1]];
  function flatDot(L, A, p, n, r, rgba, lift, si, sw) {
    basis(n); const b = begin(L, A, 6);
    for (const [u, v] of CORNERS) vtx(b, p.x + (_t.x * u + _b.x * v) * r + n.x * lift, p.y + (_t.y * u + _b.y * v) * r + n.y * lift, p.z + (_t.z * u + _b.z * v) * r + n.z * lift, n.x, n.y, n.z, (u + 1) / 2, (v + 1) / 2, rgba, si, sw);
  }
  // Every triangle of a geometry, once: corners (in its own frame), and a sphere round each for a quick miss
  const triCache = new WeakMap();
  function trisOf(g) {
    let c = triCache.get(g); if (c) return c;
    const pa = g.attributes.position, idx = g.index, n = Math.floor((idx ? idx.count : pa.count) / 3);
    const T = new Float32Array(n * 9), S = new Float32Array(n * 4), I = new Uint32Array(n * 3), a = new V3(), b = new V3(), d = new V3(), m = new V3();
    for (let t = 0; t < n; t++) {
      for (let k = 0; k < 3; k++) { const vi = idx ? idx.getX(t * 3 + k) : t * 3 + k; I[t * 3 + k] = vi; T[t * 9 + k * 3] = pa.getX(vi); T[t * 9 + k * 3 + 1] = pa.getY(vi); T[t * 9 + k * 3 + 2] = pa.getZ(vi); }
      a.fromArray(T, t * 9); b.fromArray(T, t * 9 + 3); d.fromArray(T, t * 9 + 6); m.copy(a).add(b).add(d).divideScalar(3);
      S[t * 4] = m.x; S[t * 4 + 1] = m.y; S[t * 4 + 2] = m.z; S[t * 4 + 3] = Math.sqrt(Math.max(m.distanceToSquared(a), m.distanceToSquared(b), m.distanceToSquared(d)));
    }
    c = { n, T, S, I }; triCache.set(g, c); return c;
  }
  // A triangle cut down to the dot's square (projected along n), drawn as a fan: the spray's mark wraps over what it
  // lands on (onto a curb, round a wheel) without hanging off an edge
  const _poly = [], _poly2 = [];
  function clipDot(L, A, a, bb, c, fn, p, r, rgba, lift) {
    let P = _poly; P.length = 0;
    for (const v of [a, bb, c]) { _q.copy(v).sub(p); P.push([v.x, v.y, v.z, _q.dot(_t) / (2 * r) + 0.5, _q.dot(_b) / (2 * r) + 0.5]); }
    for (let side = 0; side < 4; side++) {
      const ax = side < 2 ? 3 : 4, keepHi = side % 2 === 0, lim = keepHi ? 0 : 1, out = P === _poly ? _poly2 : _poly; out.length = 0;
      for (let i = 0; i < P.length; i++) {
        const s = P[i], e = P[(i + 1) % P.length], sIn = keepHi ? s[ax] >= lim : s[ax] <= lim, eIn = keepHi ? e[ax] >= lim : e[ax] <= lim;
        if (sIn) out.push(s);
        if (sIn !== eIn) { const f = (lim - s[ax]) / (e[ax] - s[ax]); out.push(s.map((x, k) => x + (e[k] - x) * f)); }
      }
      P = out; if (P.length < 3) return;
    }
    const b = begin(L, A, (P.length - 2) * 3);
    for (let i = 1; i + 1 < P.length; i++) for (const v of [P[0], P[i], P[i + 1]]) vtx(b, v[0] + fn.x * lift, v[1] + fn.y * lift, v[2] + fn.z * lift, fn.x, fn.y, fn.z, v[3], v[4], rgba);
  }
  const FACING = 0.2;
  const _pa = new V3(), _pb = new V3(), _pc = new V3(), _fnv = new V3(), _m4 = new THREE.Matrix4(), _inv = new THREE.Matrix4(), _lp = new V3(), _sph = new THREE.Sphere(), _box = new THREE.Box3();
  // The spray's dot on the level: the triangle grid's triangles near p that face along n
  function sprayWorld(L, A, p, n, r, rgba) {
    const r2 = r * r, lift = r * SPRAY_LIFT_K;
    const tri = (a, b, c, fn, two) => {
      let f = fn.dot(n);
      if (f < 0 && two) { f = -f; _fn.copy(fn).negate(); fn = _fn; }
      if (f < FACING || _tri.set(a, b, c).closestPointToPoint(p, _q).distanceToSquared(p) > r2) return;
      clipDot(L, A, a, b, c, fn, p, r, rgba, lift);
    };
    if (TG) {
      const G = TG, T = G.T, B = G.B, NR = G.NR;
      tgEach(p.x - r, p.z - r, p.x + r, p.z + r, t => {
        if (!G.SHOT[t] || G.MESH[t] < 0 || B[t * 6 + 1] > p.y + r || B[t * 6 + 4] < p.y - r) return;
        const m = G.meshes[G.MESH[t]], ud = m.userData; if (ud.toggle !== undefined || ud.lift !== undefined || ud.noHole || m === TDOOR.shot) return; // (doors move: they're painted as doors)
        const q = t * 9; _pa.set(T[q], T[q + 1], T[q + 2]); _pb.set(T[q + 3], T[q + 4], T[q + 5]); _pc.set(T[q + 6], T[q + 7], T[q + 8]);
        _fnv.set(NR[t * 3], NR[t * 3 + 1], NR[t * 3 + 2]); tri(_pa, _pb, _pc, _fnv, G.SIDE[t] === 2);
      });
    }
    // the levels made of boxes, and the tiled floors (no triangle grid)
    _sph.set(p, r);
    for (const m of TG ? W.floors : [...W.meshes, ...W.floors]) {
      if (m.userData.noHole || m.userData.toggle !== undefined || !m.geometry.attributes.position) continue;
      const g = m.geometry; if (!g.boundingBox) g.computeBoundingBox();
      if (!_box.copy(g.boundingBox).applyMatrix4(m.matrixWorld).intersectsSphere(_sph)) continue;
      meshTris(m, m.matrixWorld, p, r, (a, b, c, fn) => tri(a, b, c, fn, m.material.side === THREE.DoubleSide));
    }
  }
  // The triangles of mesh m near p (p in the frame mat takes m to), handed over in that frame
  const _ea = new V3(), _eb = new V3(), _ec = new V3(), _en = new V3(), _e1 = new V3(), _e2 = new V3();
  function meshTris(m, mat, p, r, fn) {
    const C = trisOf(m.geometry), T = C.T, S = C.S, sc = mat.getMaxScaleOnAxis();
    _lp.copy(p).applyMatrix4(_inv.copy(mat).invert()); const rl = r / sc;
    for (let t = 0; t < C.n; t++) {
      const dx = S[t * 4] - _lp.x, dy = S[t * 4 + 1] - _lp.y, dz = S[t * 4 + 2] - _lp.z, R = S[t * 4 + 3] + rl;
      if (dx * dx + dy * dy + dz * dz > R * R) continue;
      _ea.fromArray(T, t * 9).applyMatrix4(mat); _eb.fromArray(T, t * 9 + 3).applyMatrix4(mat); _ec.fromArray(T, t * 9 + 6).applyMatrix4(mat);
      _en.crossVectors(_e1.subVectors(_eb, _ea), _e2.subVectors(_ec, _ea)); const l = _en.length(); if (l < 1e-12) continue; _en.divideScalar(l);
      fn(_ea, _eb, _ec, _en, t, C);
    }
  }
  // A door or a vehicle part: its own triangles, in its own frame (a door: every mesh under the hinge)
  function sprayObject(L, A, p, n, r, rgba) {
    const root = A.obj, inv = new THREE.Matrix4().copy(root.matrixWorld).invert(), r2 = r * r, lift = r * SPRAY_LIFT_K;
    const list = []; if (A.kind === 'v') list.push(root); else root.traverse(o => { if (o.isMesh && o.visible && !o.userData.paint) list.push(o); });
    for (const m of list) {
      const mat = m === root ? _m4.identity() : new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld), two = m.material.side === THREE.DoubleSide;
      meshTris(m, mat, p, r, (a, b, c, fn) => {
        let f = fn.dot(n); if (f < 0 && two) { f = -f; fn.negate(); }
        if (f < FACING || _tri.set(a, b, c).closestPointToPoint(p, _q).distanceToSquared(p) > r2) return;
        clipDot(L, A, a, b, c, fn, p, r, rgba, lift);
      });
    }
  }
  // A character: the triangles of every one of its skinned meshes near p, in their bind pose, whole (they're small),
  // with their skin weights
  const _si = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], _sw = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], _vn = [new V3(), new V3(), new V3()];
  function skinOf(g, i, si, sw) { const I = g.attributes.skinIndex, Wt = g.attributes.skinWeight; si[0] = I.getX(i); si[1] = I.getY(i); si[2] = I.getZ(i); si[3] = I.getW(i); sw[0] = Wt.getX(i); sw[1] = Wt.getY(i); sw[2] = Wt.getZ(i); sw[3] = Wt.getW(i); }
  function sprayBody(L, A, p, n, r, rgba) {
    const src = A.skin, r2 = r * r, lift = r * SPRAY_LIFT_K;
    const pw = p.clone().applyMatrix4(src.bindMatrix), nw = n.clone().transformDirection(src.bindMatrix);
    for (const s of rigSkins(A.rig)) {
      const g = s.geometry; if (!g.attributes.skinIndex) continue;
      // (not s.bindMatrixInverse: attached skins keep that as the inverse of their world matrix)
      const back = new THREE.Matrix4().copy(s.bindMatrix).invert(), pl = pw.clone().applyMatrix4(back), nl = nw.clone().transformDirection(back), na = g.attributes.normal;
      if (!g.boundingSphere) g.computeBoundingSphere();
      if (g.boundingSphere.center.distanceTo(pl) > g.boundingSphere.radius + r) continue;
      basis(nl);
      const As = s === src ? A : { obj: s, kind: 'e', skin: s, rig: A.rig, e: A.e };
      meshTris(s, _m4.identity(), pl, r, (a, b, c, fn, t, C) => {
        if (fn.dot(nl) < FACING || _tri.set(a, b, c).closestPointToPoint(pl, _q).distanceToSquared(pl) > r2) return;
        const bt = begin(L, As, 3);
        for (let k = 0; k < 3; k++) {
          const v = k === 0 ? a : k === 1 ? b : c, vi = C.I[t * 3 + k]; skinOf(g, vi, _si[k], _sw[k]); if (na) _vn[k].fromBufferAttribute(na, vi); else _vn[k].copy(fn);
          _q.copy(v).sub(pl);
          vtx(bt, v.x + _vn[k].x * lift, v.y + _vn[k].y * lift, v.z + _vn[k].z * lift, _vn[k].x, _vn[k].y, _vn[k].z, _q.dot(_t) / (2 * r) + 0.5, _q.dot(_b) / (2 * r) + 0.5, rgba, _si[k], _sw[k]);
        }
      });
    }
  }
  // One dot of a layer at p (anchor's frame)
  function dot(L, A, tool, p, n, r, rgba, si, sw) {
    if (tool === PEN) { flatDot(L, A, p, n, r, rgba, r * PEN_LIFT_K, si, sw); return; }
    basis(n);
    if (A.kind === 'w') sprayWorld(L, A, p, n, r, rgba);
    else if (A.kind === 'e') sprayBody(L, A, p, n, r, rgba);
    else sprayObject(L, A, p, n, r, rgba);
  }

  // ---------------------------------------------------------------- applying a layer (mine, or one that came in)
  // rec: { i: id, a: anchor, s: PEN or SPRAY, c: colour, pr: the mark's radius (in the anchor's frame), q: points }
  // Points are [x, y, z, nx, ny, nz, broken (1: no line from the point before), skin vertex (characters only)] in the anchor's frame
  const _p = new V3(), _n = new V3(), _p0 = new V3(), _n0 = new V3(), _ip = new V3(), _in = new V3();
  function applyRec(rec, L) {
    const A = resolve(rec.a); if (!A) return false;
    if (!L) L = newLayer(rec);
    L.A = A; drawPoints(L, A, rec, 0);
    return L;
  }
  function commitAll(L) { for (const pt of L.parts) pt.b.commit(); }
  // Points from index k0 on: a dot at each, with dots every half radius along the line from the point before
  function drawPoints(L, A, rec, k0) {
    const q = rec.q, S = A.kind === 'e' ? 8 : 7, rgba = rgbaOf(rec.c), r = rec.pr, tool = rec.s;
    const g = A.skin && A.skin.geometry, si = [0, 0, 0, 0], sw = [0, 0, 0, 0], pen = tool === PEN && g;
    for (let k = k0; k * S + S <= q.length; k++) {
      const o = k * S; _p.set(q[o], q[o + 1], q[o + 2]); _n.set(q[o + 3], q[o + 4], q[o + 5]).normalize();
      if (pen) { const vi = q[o + 7]; if (!(vi >= 0 && vi < g.attributes.position.count)) continue; skinOf(g, vi, si, sw); }
      if (k > 0 && !q[o + 6]) {
        const pp = (k - 1) * S; _p0.set(q[pp], q[pp + 1], q[pp + 2]); _n0.set(q[pp + 3], q[pp + 4], q[pp + 5]).normalize();
        const d = _p0.distanceTo(_p), steps = Math.min(200, Math.ceil(d / (r * 0.5)));
        for (let j = 1; j < steps; j++) { const f = j / steps; dot(L, A, tool, _ip.copy(_p0).lerp(_p, f), _in.copy(_n0).lerp(_n, f).normalize(), r, rgba, pen && si, pen && sw); }
      }
      dot(L, A, tool, _p, _n, r, rgba, pen && si, pen && sw);
    }
    commitAll(L);
  }

  // ---------------------------------------------------------------- what the tools hit
  const ray = new THREE.Raycaster(), _o = new V3(), _d = new V3(), _w = new V3(), _wn = new V3(), _vc = new V3();
  const worldNormal = h => _wn.copy(h.face.normal).applyMatrix3(_m3.getNormalMatrix(h.object.matrixWorld)).normalize();
  const _A = new V3(), _B = new V3(), _C = new V3(), _bc = new V3();
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
    for (const v of VEH.list) {
      if (!v.g || !v.g.visible) continue;
      const vi = vehInfo(v); _sph.copy(vi.sph).applyMatrix4(v.g.matrixWorld);
      if (!ray.ray.intersectsSphere(_sph) || _sph.distanceToPoint(_o) > ray.far) continue;
      const vh = ray.intersectObject(v.g, true).find(h => h.object.isMesh && drawn(h));
      if (vh) near(vh.distance, cheap ? { k: 'vb' } : { k: 'v', h: vh, v });
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
  // The anchor, and the point, normal and scale (world metres per anchor unit) in its frame, for a hit
  function anchorOf(hit) {
    if (hit.k === 'w') return { a: ['w'], p: hit.wp, n: hit.wn, s: 1 };
    const toLocal = obj => { obj.updateMatrixWorld(); const inv = _inv.copy(obj.matrixWorld).invert(); return { p: hit.wp.clone().applyMatrix4(inv), n: hit.wn.clone().transformDirection(inv), s: obj.matrixWorld.getMaxScaleOnAxis() }; };
    if (hit.k === 'd') return Object.assign({ a: ['d', hit.di] }, toLocal(hit.hinge));
    if (hit.k === 'v') { const m = hit.h.object, nk = nameOf(vehInfo(hit.v).meshes, m); if (!nk) return null; return Object.assign({ a: ['v', hit.v.i, ...nk] }, toLocal(m)); }
    if (hit.k === 'e') {
      // where on the triangle the ray landed, put back onto the bind pose
      const src = hit.h.object, f = hit.h.face, pa = src.geometry.attributes.position, nk = nameOf(rigSkins(hit.e.rig), src);
      if (!nk) return null;
      src.boneTransform(f.a, _A); src.boneTransform(f.b, _B); src.boneTransform(f.c, _C);
      const lp = hit.wp.clone().applyMatrix4(_inv.copy(src.matrixWorld).invert());
      _tri.set(_A, _B, _C).getBarycoord(lp, _bc);
      const RA = new V3().fromBufferAttribute(pa, f.a), RB = new V3().fromBufferAttribute(pa, f.b), RC = new V3().fromBufferAttribute(pa, f.c);
      const p = new V3().addScaledVector(RA, _bc.x).addScaledVector(RB, _bc.y).addScaledVector(RC, _bc.z), n = new THREE.Triangle(RA, RB, RC).getNormal(new V3());
      const vi = _bc.x >= _bc.y && _bc.x >= _bc.z ? f.a : _bc.y >= _bc.z ? f.b : f.c;
      const mw = src.matrixWorld, posed = _A.applyMatrix4(mw).distanceTo(_B.applyMatrix4(mw)) + _B.distanceTo(_C.applyMatrix4(mw)), raw = RA.distanceTo(RB) + RB.distanceTo(RC);
      return { a: ['e', hit.e.id, ...nk], p, n, s: raw > 1e-6 && posed > 1e-6 ? posed / raw : 1, vi };
    }
    return null;
  }

  // ---------------------------------------------------------------- the tools
  let on = false, safe = false, tool = 'pen', drawT = 0, press = 0, spraying = 0, seq = 0, fxT = 0, hissT = 0;
  const colOf = { pen: 0, spray: 2 };
  let stroke = null; // the line being drawn: { L, rec, key, S, sent: points sent, last: point (world), lastN, broken }
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
  // Your line's new points go out every 0.1 s
  let flushT = 0;
  function flush() {
    if (!stroke) return;
    const q = stroke.rec.q, from = stroke.sent;
    if (q.length > from) { netFx({ t: 'pa', i: stroke.rec.i, q: q.slice(from) }); stroke.sent = q.length; }
  }
  function startLayer(rec) { const L = applyRec(rec); if (!L) return null; if (NET.role === 'host') log.push(rec); trim(); return L; }
  // Two points join up when they're on one surface: near enough, facing the same way, and in the same plane
  // (not across a corner or a gap, or from a wall onto the floor behind it)
  function sameSurface(p0, n0, p1, n1) {
    const d = p0.distanceTo(p1); if (d > 1.5 || n0.dot(n1) < 0.7) return false;
    return Math.abs(_q.copy(p1).sub(p0).dot(n0)) < 0.15 * d + 0.02;
  }
  function drawTick(dt) {
    const reach = reachOf(tool), r = radiusOf(tool), hit = paintCast(reach);
    if (tool === 'spray') sprayFx(dt, hit && hit.inReach && hit.wp ? hit.wp : null);
    if (!hit || !hit.inReach || !hit.wp) { if (stroke) stroke.broken = true; return; }
    const an = anchorOf(hit); if (!an) return;
    const key = an.a.join(), S = an.a[0] === 'e' ? 8 : 7, s = tool === 'pen' ? PEN : SPRAY;
    // a new layer: a new click, another thing under the tool, or this line's long enough
    if (!stroke || stroke.key !== key || stroke.rec.q.length >= STROKE_MAX * S) {
      endStroke();
      const rec = { i: newId(), a: an.a, s, c: colOf[tool], pr: r3(r / an.s), q: [] };
      stroke = { rec, key, S, sent: 0, last: null, broken: false };
      pushPoint(an, hit, S, false);
      stroke.L = startLayer(rec); if (!stroke.L) { stroke = null; return; }
      netFx(Object.assign({ t: 'pt' }, rec)); stroke.sent = rec.q.length;
      return;
    }
    if (stroke.last && stroke.last.distanceTo(hit.wp) < Math.max(PEN_STEP, r * 0.3)) return;
    const k = stroke.rec.q.length / S;
    pushPoint(an, hit, S, stroke.broken || (stroke.last && !sameSurface(stroke.last, stroke.lastN, hit.wp, hit.wn)));
    stroke.broken = false;
    if (stroke.L && byId.get(stroke.rec.i) === stroke.L) drawPoints(stroke.L, stroke.L.A, stroke.rec, k);
  }
  function pushPoint(an, hit, S, broken) {
    const q = stroke.rec.q;
    q.push(r3(an.p.x), r3(an.p.y), r3(an.p.z), r2(an.n.x), r2(an.n.y), r2(an.n.z), broken ? 1 : 0);
    if (S === 8) q.push(an.vi);
    stroke.last = hit.wp.clone(); stroke.lastN = hit.wn.clone();
  }
  function update(dt) {
    if (!RANGE.on) { if (on) leave(); return; }
    spraying = 0;
    if (drawT > 0) { drawT -= dt; clickQ = false; endStroke(); if (drawT <= 0) safe = true; return; }
    if (!P.alive || monitorOpen || VEH.noGuns) { endStroke(); clickQ = false; return; }
    const go = mouseDown || clickQ; clickQ = false;
    if (go) { if (tool === 'spray') spraying = 1; drawTick(dt); } else endStroke();
    if (stroke && (flushT -= dt) <= 0) { flushT = 0.1; flush(); }
  }

  // ---------------------------------------------------------------- the tools in your hand
  // Held upright in the fist (both stand along +y, the can's nozzle facing -z, the way the guns point), the pen's tip end
  // out the top. userData.tint is the coloured part, userData.tip where the paint comes out
  function heldObject(kind, c) {
    const g = new THREE.Group(), tint = toonMat({ color: PAL[c || 0] }), o = new THREE.Group(); o.add(g);
    const cyl = (r, h, m, rt) => new THREE.Mesh(new THREE.CylinderGeometry(rt === undefined ? r : rt, r, h, 14), m);
    if (kind === 'pen') {
      // a fat marker: light barrel, a coloured band, cap and tip
      const body = cyl(0.014, 0.13, toonMat({ color: 0xe6e6e2 })), band = cyl(0.0145, 0.03, tint), cap = cyl(0.0135, 0.034, tint), tip = cyl(0.003, 0.024, tint, 0.009);
      band.position.y = 0.03; cap.position.y = -0.078; tip.position.y = 0.077;
      [body, band, cap, tip].forEach(m => { m.castShadow = true; g.add(m); });
      const t = new THREE.Object3D(); t.position.y = 0.092; g.add(t); o.userData.tip = t;
      g.position.y = 0.045; // (more of it out the top of the fist)
    } else {
      const body = cyl(0.033, 0.16, toonMat({ color: 0xb9bdc3 })), label = cyl(0.0335, 0.08, tint), sh = cyl(0.033, 0.025, toonMat({ color: 0xb9bdc3 }), 0.02), cap = cyl(0.02, 0.022, tint), noz = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.012, 0.016), toonMat({ color: 0x222222 }));
      sh.position.y = 0.0925; cap.position.y = 0.116; noz.position.set(0, 0.122, -0.012); label.position.y = -0.01;
      [body, label, sh, cap, noz].forEach(m => { m.castShadow = true; g.add(m); });
      const t = new THREE.Object3D(); t.position.set(0, 0.122, -0.022); g.add(t); o.userData.tip = t;
      g.position.y = -0.026; g.scale.setScalar(1.3); // (30% up on the first cut)
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
  // First person: the hand low on the right (HELD_HIP), the forearm coming up from the corner (ARM_TURN: the arm turned
  // about the tool, in the camera's frame), and the tool stood upright in the view whatever the grip (FPV_UP: its axis,
  // in the camera's frame). The pen pushes in a little while it's down, the can shakes while it sprays
  const ARM_TURN = { pen: new THREE.Quaternion().setFromEuler(new THREE.Euler(0.25, 0, -0.55, 'YZX')), spray: new THREE.Quaternion().setFromEuler(new THREE.Euler(0.25, 0, -0.55, 'YZX')) };
  const armTurn = held => ARM_TURN[held] || null;
  const FPV_UP = { pen: new V3(-0.22, 1, 0.12).normalize(), spray: new V3(-0.12, 1, 0.08).normalize() }, _fq = new THREE.Quaternion(), _fq2 = new THREE.Quaternion(), _fx = new V3(), _fz = new V3(), _fmb = new THREE.Matrix4();
  function fpvTool(gv, k) {
    const o = toolIn(gv), up = o && FPV_UP[o.userData.kind]; if (!up) return;
    _fz.set(0, 0, 1).addScaledVector(up, -up.z).normalize(); _fx.crossVectors(up, _fz);
    _fq.setFromRotationMatrix(_fmb.makeBasis(_fx, up, _fz)).premultiply(camera.quaternion); // where it should face, in the world
    gv.updateMatrixWorld(true); gv.getWorldQuaternion(_fq2).invert();
    o.quaternion.identity().slerp(_fq.premultiply(_fq2), k); o.updateMatrixWorld(true);
  }
  function pose(fh) {
    if (tool === 'pen') fh.z -= press * 0.03;
    else { const t = performance.now() / 1000; fh.x += Math.sin(t * 47) * 0.003 * spraying; fh.y += Math.sin(t * 61) * 0.003 * spraying; }
  }

  // ---------------------------------------------------------------- spray effects
  const mistTex = () => (GUN_FX.carbine && GUN_FX.carbine.smoke.tex) || null;
  function mist(from, to, c, n = 3) {
    const tex = mistTex(); if (!tex || !from) return;
    const d = to.clone().sub(from), len = d.length(); d.divideScalar(len || 1);
    const col = PAL[c].getHex();
    for (let i = 0; i < n; i++) {
      const k = Math.random() * Math.min(1, 1.4 / Math.max(0.2, len));
      _puff(tex, from.clone().addScaledVector(d, len * k + 0.04), 0.04 + 0.16 * k, 0.25 + Math.random() * 0.15, { color: col, vel: d.clone().multiplyScalar(2).add(new V3((Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.3)), grow: 0.4, opacity: 0.45, spin: 1 });
    }
  }
  function hiss(v) { if (!AC || v < 0.02) return; noise(AC.currentTime, 0.3, 0.12 * v, 9000, 5000); }
  // yours, while you hold the button
  function sprayFx(dt, to) {
    if ((fxT -= dt) <= 0) { fxT = 0.06; const from = nozzleOf(P) || myEye.clone(); mist(from, to || from.clone().addScaledVector(_d, 1.4), colOf.spray); }
    if ((hissT -= dt) <= 0) { hissT = 0.26; hiss(1); }
  }
  // someone else's, as their line comes in
  function remoteFx(L) {
    const now = performance.now(); if (L.fxAt && now - L.fxAt < 90) return; L.fxAt = now;
    const q = L.rec.q, S = L.rec.a[0] === 'e' ? 8 : 7; if (!q.length || !L.A) return;
    const k = q.length - S, A = L.A, to = A.kind === 'e' ? A.e.pos.clone().setY(A.e.pos.y + 1.2) : new V3(q[k], q[k + 1], q[k + 2]).applyMatrix4(A.kind === 'w' ? _m4.identity() : A.obj.matrixWorld);
    const e = entById(L.id.split('.')[0]); mist(e && nozzleOf(e), to, L.rec.c, 6);
    if (!L.hissAt || now - L.hissAt > 250) { L.hissAt = now; hiss(vol(to, 40)); }
  }

  // ---------------------------------------------------------------- the network
  // 'pt' a new layer (the start of a line), 'pa' more points on a line; 'pl' the paint so far, to someone who just
  // joined. The host keeps every layer (log) for the ones who join.
  const log = [], pending = []; // pending: layers on something not here yet (a character or vehicle just joining, a truck still loading its model)
  const WAIT = 30; // seconds a pending layer waits
  let joinQ = null;
  const fin = (a, n) => Array.isArray(a) && a.length === n && a.every(Number.isFinite);
  const validPts = (q, S) => Array.isArray(q) && q.length % S === 0 && q.length <= STROKE_MAX * S && q.every(Number.isFinite);
  function validRec(m) {
    if (typeof m.i !== 'string' || m.i.length > 24 || !Array.isArray(m.a) || !(m.c >= 0 && m.c < 6 && (m.c | 0) === m.c)) return false;
    const a = m.a;
    if (!(a[0] === 'w' && a.length === 1 || a[0] === 'd' && a.length === 2 && (a[1] | 0) === a[1] && a[1] >= 0 && a[1] < 64
      || a[0] === 'v' && a.length === 4 && (a[1] | 0) === a[1] && a[1] >= 0 && a[1] < 256 && typeof a[2] === 'string' && a[2].length <= 80 && (a[3] | 0) === a[3] && a[3] >= 0 && a[3] < 64
      || a[0] === 'e' && a.length === 4 && typeof a[1] === 'string' && a[1].length <= 12 && typeof a[2] === 'string' && a[2].length <= 80 && (a[3] | 0) === a[3] && a[3] >= 0 && a[3] < 64)) return false;
    return (m.s === PEN || m.s === SPRAY) && m.pr > 0 && m.pr < 100 && validPts(m.q, a[0] === 'e' ? 8 : 7);
  }
  const clean = m => ({ i: m.i, a: m.a, s: m.s, c: m.c, pr: m.pr, q: m.q.slice() });
  function take(rec) {
    if (byId.has(rec.i)) return null;
    if (NET.role === 'host') log.push(rec);
    const L = applyRec(rec); if (!L) pending.push({ rec, t: WAIT }); else trim();
    return L || null;
  }
  function net(m) {
    if (m.t === 'pt') {
      if (!validRec(m)) return;
      const L = take(clean(m)); if (L && m.s === SPRAY) remoteFx(L);
    } else if (m.t === 'pa') {
      const L = byId.get(m.i), pd = !L && pending.find(x => x.rec.i === m.i), rec = L ? L.rec : pd ? pd.rec : null; if (!rec) return;
      const S = rec.a[0] === 'e' ? 8 : 7; if (!validPts(m.q, S) || rec.q.length + m.q.length > STROKE_MAX * S) return;
      const k = rec.q.length / S; rec.q.push(...m.q);
      if (L && L.A) { drawPoints(L, L.A, rec, k); if (rec.s === SPRAY) remoteFx(L); }
    }
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
  function forgetParts(b) {
    for (const pt of b.parts.slice()) {
      const L = pt.L; vertTotal -= pt.c; L.parts.splice(L.parts.indexOf(pt), 1);
      if (!L.parts.length) { byId.delete(L.id); const k = layers.indexOf(L); if (k >= 0) layers.splice(k, 1); if (stroke && stroke.L === L) stroke = null; }
    }
    b.parts.length = 0;
  }
  // Paint on things that match test goes. requeue: draw it again on whatever has taken their place (a vehicle or a
  // character rebuilt: the same names), else it's gone for good (a character coming back clean)
  function dropBatches(test, requeue) {
    for (const [obj, ch] of chains) {
      if (!test(obj, ch)) continue;
      for (const b of ch) {
        for (const pt of b.parts) {
          if (pt.L.parts.length !== 1) continue; // (the layer's last piece)
          if (requeue) { if (!pending.some(x => x.rec === pt.L.rec)) pending.push({ rec: pt.L.rec, t: WAIT }); }
          else { const j = log.indexOf(pt.L.rec); if (j >= 0) log.splice(j, 1); }
        }
        forgetParts(b); b.dispose();
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
          const m = new THREE.SkinnedMesh(b.g, MAT_SKIN); m.frustumCulled = false; m.renderOrder = b.mesh.renderOrder; paintOnly(m);
          m.bind(s.skeleton, s.bindMatrix); m.position.copy(s.position); m.quaternion.copy(s.quaternion); m.scale.copy(s.scale); s.parent.add(m);
          corpsePaint.push({ w: rig.wrap, g: b.g });
          if (b.mesh.parent) b.mesh.parent.remove(b.mesh); b.g = new THREE.BufferGeometry(); // (the body has the geometry now)
        }
        forgetParts(b); b.dispose();
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
    press += ((on && tool === 'pen' && mouseDown && drawT <= 0 ? 1 : 0) - press) * Math.min(1, dt * 14);
    const inGame = $('tomenu').style.display !== 'none';
    btn.style.display = inGame && RANGE.on ? '' : 'none'; btn.textContent = on ? 'Weapons' : 'Draw';
    // what's in your hands
    if (on) { vm.visible = false; knifeVM.visible = false; if (typeof nadeVM !== 'undefined' && nadeVM) nadeVM.visible = false; }
    const out = on && drawT <= 0.15 && P.alive;
    const vk = out ? tool + colOf[tool] : '';
    if (vk !== vmKey) { vmKey = vk; artVM.clear(); if (out) { const o = heldObject(tool, colOf[tool]); o.position.set(0.22, -0.2, -0.5); o.rotation.set(0.1, 0.3, 0.15); artVM.add(o); } }
    artVM.visible = out;
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
      dropBatches(obj => obj !== world && !attached(obj), true);
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
    // The crosshair: the mark's size where you're aiming, in the colour (the pen's is a dot); faint out of reach
    let cssNow = 'display:none';
    if (show && drawT <= 0 && !VEH.noGuns) {
      if ((aimT -= dt) <= 0) { aimT = 0.05; aim = paintCast(reachOf(tool), true); }
      const reach = aim && aim.inReach, c = PALETTE[colOf[tool]], h = renderer.domElement.clientHeight || innerHeight;
      if (tool === 'pen') cssNow = `display:block;width:7px;height:7px;background:${c};border:1px solid rgba(255,255,255,.85);opacity:${reach ? 1 : 0.4}`;
      else {
        const d = aim ? Math.max(0.3, aim.d) : SPRAY_REACH, px = Math.max(8, Math.min(240, SPRAY_R / (d * Math.tan(camera.fov * Math.PI / 360)) * h));
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
    toggle, update, after, key, pose, armTurn, fpvTool, heldObject, net, welcome, joinLog, toCorpse, clear,
    swap() { if (on) setTool(tool === 'pen' ? 'spray' : 'pen'); },
    held: () => (on && drawT <= 0.15 && P.alive ? tool : null), // what your body holds
    state: () => (on && safe ? (tool === 'pen' ? 1 : 2) : 0), // what others see you hold (0: your weapons)
    colour: () => colOf[tool],
    hold() { joinQ = []; }, // a guest: the paint so far waits for the level
    release() { const q = joinQ || []; joinQ = null; q.forEach(take); },
    stats: () => ({ layers: layers.length, verts: vertTotal, meshes: [...chains.values()].reduce((n, c) => n + c.length, 0), log: log.length, pending: pending.length }),
  });
})();
