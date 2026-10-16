// Driving Sim: vehicles you can get into (car, truck, motorcycle, plane) and the flat test ground they live on.
// Loaded after the main game script, so it uses the game's globals (scene, camera, P, keys, TG, groundAt, toonMat, ...).
// The game calls into VEH (declared in index.html) from its loop, input and camera; everything here is local to the host
// for now (no multiplayer yet).
//
// Conventions: a vehicle's yaw y points it along (sin y, 0, cos y), like the trucks; the driver's right is
// (-cos y, 0, sin y), so steering right turns the yaw down. Models are built facing +Z with their left side on +X.
(() => {
  const EDGE_M = 990; // the ground is 2 km square; ground vehicles bounce off its edge
  const G = 14; // vehicles fall a little slower than people (GRAV 22): jumps hang long enough to enjoy
  const DEFS = {
    car: {
      name: 'Car', kind: 'ground', len: 4.2, wid: 1.85, wheelbase: 2.6, track: 1.6, wheelR: 0.34, mass: 1200,
      accel: 10, top: 46, rev: 11, revAccel: 5, brake: 11, roll: 0.5, drag: 0.0008, grip: 8, slide: 1.6, steer: 0.6, steerFall: 18, maxLat: 15,
      cam: [7, 2.3, 1.1], eye: [0.38, 1.12, -0.1], snd: [55, 95, 12], seatShow: false, colY: 0.65,
    },
    truck: {
      name: 'Truck', kind: 'ground', len: 6.6, wid: 2.4, wheelbase: 4.0, track: 2.0, wheelR: 0.5, mass: 4500,
      accel: 5, top: 32, rev: 7, revAccel: 3, brake: 7, roll: 0.7, drag: 0.0014, grip: 6.5, slide: 2.2, steer: 0.5, steerFall: 14, maxLat: 8,
      cam: [10.5, 3.6, 2.0], eye: [0.5, 2.3, 2.1], snd: [38, 60, 9], seatShow: false, colY: 1.2,
    },
    bike: {
      name: 'Motorcycle', kind: 'bike', len: 2.1, wid: 0.75, wheelbase: 1.45, track: 0, wheelR: 0.33, mass: 230,
      accel: 13, top: 54, rev: 3, revAccel: 2, brake: 10, roll: 0.4, drag: 0.001, grip: 10, slide: 2.4, steer: 0.75, steerFall: 12, maxLat: 14,
      cam: [5, 1.9, 1.0], eye: [0, 1.55, -0.15], snd: [70, 150, 14], seatShow: true, colY: 0.6,
    },
    plane: {
      name: 'Plane', kind: 'plane', len: 8.2, wid: 1.4, span: 10.4, mass: 900, gearH: 1.25,
      thrust: 9, drag: 0.0021, liftK: 0.0062, rotate: 24, cam: [13, 3.2, 0.6], eye: [0, 0.75, 0.9], snd: [42, 70],
    },
  };
  // Where they wait at the start (and go back to after a crash): [type, x, z, yaw]
  const LOT = [['car', -12, 8, 0], ['truck', -3, 9, 0], ['bike', 6, 7, 0], ['car', 13, 8, 0], ['plane', -20, -40, Math.PI / 2]];

  const list = [];
  let cur = null, view = 'chase', camYaw = 0, camPitch = 0, lookIdle = 9, stick = { x: 0, y: 0 };
  const camPos = new V3(), camLook = new V3();

  // ---------------------------------------------------------------- models
  const mat = c => toonMat({ color: c });
  const M = { dark: mat(0x1d1f22), glass: mat(0x24323d), chrome: mat(0xb9c0c6), light: mat(0xfff3c4), tail: mat(0xb3261e), tyre: mat(0x18191b), rim: mat(0x8a9097) };
  function part(g, geo, m, x, y, z) { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = true; o.receiveShadow = true; g.add(o); return o; }
  const box = (g, w, h, d, m, x, y, z) => part(g, new THREE.BoxGeometry(w, h, d), m, x, y, z);
  function wheel(g, r, w, x, y, z) { // a pivot (for steering) holding a spinner (for rolling)
    const piv = new THREE.Group(); piv.position.set(x, y, z); g.add(piv);
    const spin = new THREE.Group(); piv.add(spin);
    part(spin, new THREE.CylinderGeometry(r, r, w, 16).rotateZ(Math.PI / 2), M.tyre, 0, 0, 0);
    part(spin, new THREE.BoxGeometry(w * 1.05, r * 0.9, r * 0.25), M.rim, 0, 0, 0);
    return { piv, spin };
  }
  function buildCar(color) {
    const g = new THREE.Group(), paint = mat(color), wh = [];
    box(g, 1.85, 0.62, 4.2, paint, 0, 0.62, 0);
    box(g, 1.6, 0.56, 2.1, paint, 0, 1.2, -0.25);
    box(g, 1.62, 0.42, 0.06, M.glass, 0, 1.18, 0.82); box(g, 1.62, 0.4, 0.06, M.glass, 0, 1.18, -1.32);
    for (const s of [-1, 1]) { box(g, 0.06, 0.38, 1.8, M.glass, s * 0.81, 1.2, -0.25); box(g, 0.3, 0.14, 0.05, M.light, s * 0.6, 0.72, 2.11); box(g, 0.34, 0.14, 0.05, M.tail, s * 0.6, 0.76, -2.11); }
    box(g, 1.9, 0.2, 0.2, M.dark, 0, 0.4, 2.12); box(g, 1.9, 0.2, 0.2, M.dark, 0, 0.4, -2.12);
    for (const [x, z] of [[0.83, 1.3], [-0.83, 1.3], [0.83, -1.3], [-0.83, -1.3]]) wh.push(wheel(g, 0.34, 0.24, x, 0.34, z));
    return { g, wheels: wh, steerN: 2 };
  }
  function buildTruckV() {
    const g = new THREE.Group(), cab = mat(0x2f5f9e), body = mat(0xe9e6df), wh = [];
    box(g, 2.3, 1.7, 2.2, cab, 0, 1.55, 2.1);
    box(g, 2.2, 0.7, 0.06, M.glass, 0, 1.95, 3.21); for (const s of [-1, 1]) box(g, 0.06, 0.65, 1.0, M.glass, s * 1.15, 1.95, 2.4);
    box(g, 2.4, 2.4, 4.1, body, 0, 2.0, -1.15);
    box(g, 2.3, 0.3, 6.6, M.dark, 0, 0.75, -0.1);
    for (const s of [-1, 1]) { box(g, 0.35, 0.2, 0.05, M.light, s * 0.85, 1.1, 3.21); box(g, 0.3, 0.2, 0.05, M.tail, s * 1.0, 1.0, -3.22); }
    for (const [x, z] of [[1.0, 2.1], [-1.0, 2.1], [1.0, -1.9], [-1.0, -1.9], [1.0, -2.9], [-1.0, -2.9]]) wh.push(wheel(g, 0.5, 0.34, x, 0.5, z));
    return { g, wheels: wh, steerN: 2 };
  }
  function buildBike() {
    const g = new THREE.Group(), paint = mat(0xc9342b), wh = [];
    const fork = new THREE.Group(); fork.position.set(0, 0.33, 0.72); g.add(fork);
    wh.push(wheel(fork, 0.33, 0.12, 0, 0, 0)); wh[0].piv.position.set(0, 0, 0);
    box(fork, 0.06, 0.75, 0.06, M.chrome, 0, 0.42, -0.08).rotation.x = -0.35;
    box(fork, 0.7, 0.05, 0.05, M.dark, 0, 0.85, -0.22);
    wh.push(wheel(g, 0.33, 0.14, 0, 0.33, -0.72));
    box(g, 0.28, 0.32, 0.6, paint, 0, 0.82, 0.22); box(g, 0.24, 0.12, 0.62, M.dark, 0, 0.86, -0.3);
    box(g, 0.2, 0.3, 0.9, M.dark, 0, 0.52, 0); box(g, 0.08, 0.08, 0.7, M.chrome, 0.16, 0.42, -0.45);
    box(g, 0.12, 0.12, 0.04, M.light, 0, 0.82, 0.86);
    return { g, wheels: wh, steerN: 0, fork };
  }
  function buildPlane() {
    const g = new THREE.Group(), paint = mat(0xe8b62c), trim = mat(0xb8321f), wh = [];
    part(g, new THREE.CylinderGeometry(0.62, 0.42, 6.4, 12).rotateX(Math.PI / 2), paint, 0, 0, 0.2);
    part(g, new THREE.CylinderGeometry(0.16, 0.62, 1.1, 12).rotateX(Math.PI / 2), trim, 0, 0, 3.95);
    part(g, new THREE.CylinderGeometry(0.42, 0.12, 1.6, 10).rotateX(-Math.PI / 2), paint, 0, 0.05, -3.8);
    box(g, 0.9, 0.5, 1.6, M.glass, 0, 0.62, 0.6);
    box(g, 10.4, 0.14, 1.7, paint, 0, -0.28, 0.5); for (const s of [-1, 1]) box(g, 0.9, 0.15, 1.72, trim, s * 4.8, -0.27, 0.5);
    box(g, 3.6, 0.1, 1.0, paint, 0, 0.1, -4.0); box(g, 0.1, 1.3, 1.1, trim, 0, 0.75, -4.1);
    const prop = new THREE.Group(); prop.position.set(0, 0, 4.55); g.add(prop);
    box(prop, 0.18, 2.3, 0.08, M.dark, 0, 0, 0); box(prop, 2.3, 0.18, 0.08, M.dark, 0, 0, 0);
    for (const [x, z] of [[1.3, 0.6], [-1.3, 0.6], [0, 2.7]]) { box(g, 0.08, 0.8, 0.08, M.chrome, x, -0.65, z); wh.push(wheel(g, 0.25, 0.16, x, -1.0, z)); }
    return { g, wheels: wh, steerN: 0, prop };
  }
  const BUILD = { car: () => buildCar(0x3d8b5a), truck: buildTruckV, bike: buildBike, plane: buildPlane };
  const CAR_COLORS = [0x3d8b5a, 0x2e63b8];

  function spawnLot() {
    for (const v of list) scene.remove(v.g); list.length = 0; cur = null;
    let cars = 0;
    for (const [type, x, z, yaw] of LOT) {
      const def = DEFS[type], m = type === 'car' ? buildCar(CAR_COLORS[cars++ % 2]) : BUILD[type]();
      const v = { type, def, ...m, home: [x, z, yaw], pos: new V3(), vel: new V3(), q: new THREE.Quaternion(), yaw, pitch: 0, roll: 0, lean: 0, vy: 0,
        pitchRate: 0, steer: 0, spin: 0, onGround: true, thr: 0, dead: 0 };
      scene.add(v.g); list.push(v); place(v);
    }
  }
  function place(v) {
    const [x, z, yaw] = v.home, g = groundAt(x, z, 50) || 0;
    v.pos.set(x, g + (v.def.kind === 'plane' ? v.def.gearH : 0), z); v.vel.set(0, 0, 0); v.yaw = yaw; v.pitch = v.roll = v.lean = v.vy = v.pitchRate = v.steer = v.thr = 0;
    v.onGround = true; v.dead = 0; v.g.visible = true; v.speed = 0; v.slip = 0; v.q.setFromEuler(new THREE.Euler(0, yaw, 0, 'YXZ'));
    pose(v, 0);
  }

  // ---------------------------------------------------------------- ground vehicles
  const fwdOfYaw = y => [Math.sin(y), Math.cos(y)];
  function hAt(x, z, top) { const g = groundAt(x, z, top); return g === null ? -1e3 : g; }
  function driveGround(v, dt, inp) {
    const d = v.def;
    let [fx, fz] = fwdOfYaw(v.yaw), vf = v.vel.x * fx + v.vel.z * fz;
    if (v.onGround) {
      const sMax = d.steer / (1 + Math.abs(vf) / d.steerFall);
      v.steer += (inp.steer * sMax - v.steer) * Math.min(1, dt * 7);
      let yr = vf * Math.tan(v.steer) / d.wheelbase;
      const cap = d.maxLat / Math.max(1, Math.abs(vf)); // the tyres only hold so much cornering force (maxLat, m/s²)
      yr = inp.hand ? yr * 1.3 : Math.max(-cap, Math.min(cap, yr)); // on the handbrake the back steps out instead
      v.yaw -= yr * dt;
    } else v.steer *= 1 - Math.min(1, dt * 3);
    [fx, fz] = fwdOfYaw(v.yaw); const rx = -fz, rz = fx;
    vf = v.vel.x * fx + v.vel.z * fz; let vr = v.vel.x * rx + v.vel.z * rz;
    if (v.onGround) {
      if (inp.thr > 0) vf += (vf < -0.5 ? d.brake : d.accel * Math.max(0, 1 - (vf / d.top) ** 2)) * inp.thr * dt; // pulls hard until near top speed
      else if (inp.thr < 0) vf -= (vf > 0.5 ? d.brake : d.revAccel * Math.max(0, 1 + vf / d.rev)) * -inp.thr * dt;
      const res = (d.roll + (inp.hand ? 4 : 0)) * dt; vf -= Math.sign(vf) * Math.min(Math.abs(vf), res);
      vr *= Math.exp(-(inp.hand ? d.slide : d.grip) * dt);
    }
    vf -= d.drag * vf * Math.abs(vf) * dt;
    v.vel.x = fx * vf + rx * vr; v.vel.z = fz * vf + rz * vr;
    v.pos.x += v.vel.x * dt; v.pos.z += v.vel.z * dt;
    for (const ax of ['x', 'z']) if (Math.abs(v.pos[ax]) > EDGE_M) { v.pos[ax] = Math.sign(v.pos[ax]) * EDGE_M; v.vel[ax] *= -0.3; } // the edge of the world
    v.slip = Math.abs(vr); v.speed = vf;
    // Suspension: follow the ground under the wheels; leave it off the end of a ramp, land on whatever is below
    const L = d.wheelbase / 2, W = (d.track || 0.3) / 2, top = v.pos.y + 1.4;
    const hf = Math.max(hAt(v.pos.x + fx * L + rx * W, v.pos.z + fz * L + rz * W, top), hAt(v.pos.x + fx * L - rx * W, v.pos.z + fz * L - rz * W, top));
    const hb = Math.max(hAt(v.pos.x - fx * L + rx * W, v.pos.z - fz * L + rz * W, top), hAt(v.pos.x - fx * L - rx * W, v.pos.z - fz * L - rz * W, top));
    const hr = Math.max(hAt(v.pos.x + rx * W, v.pos.z + rz * W, top), hAt(v.pos.x + rx * W + fx * L, v.pos.z + rz * W + fz * L, top));
    const hl = Math.max(hAt(v.pos.x - rx * W, v.pos.z - rz * W, top), hAt(v.pos.x - rx * W + fx * L, v.pos.z - rz * W + fz * L, top));
    const gc = Math.max((hf + hb) / 2, Math.min(hf, hb) + 0.02), pT = Math.atan2(hf - hb, 2 * L), rT = d.track ? Math.atan2(hl - hr, 2 * W) : 0;
    if (v.onGround) {
      if (gc < v.pos.y - 0.4 || (v.vy > 1.5 && gc < v.pos.y + v.vy * dt - 0.04)) { v.onGround = false; v.pitchRate = Math.max(-1.5, Math.min(1.5, v.pitchRate)); }
      else {
        const vy = (gc - v.pos.y) / Math.max(dt, 1e-3); v.vy += (Math.min(25, vy) - v.vy) * Math.min(1, dt * 20); v.pos.y = gc;
        const np = v.pitch + (pT - v.pitch) * Math.min(1, dt * 12); v.pitchRate = (np - v.pitch) / Math.max(dt, 1e-3); v.pitch = np;
        v.roll += (rT - v.roll) * Math.min(1, dt * 12);
      }
    }
    if (!v.onGround) {
      v.vy -= G * dt; v.pos.y += v.vy * dt;
      v.pitchRate += (-inp.thr * 2.2 - v.pitchRate * 0.6) * dt; v.pitch += v.pitchRate * dt; // lean on the throttle in the air to dip the nose
      v.pitch = Math.max(-1.1, Math.min(1.1, v.pitch));
      if (v.pos.y <= gc) {
        const hit = -v.vy; v.pos.y = gc; v.vy = 0; v.onGround = true; v.pitch += (pT - v.pitch) * 0.6;
        if (hit > 5) { if (v === cur) shake = Math.max(shake, Math.min(0.09, hit * 0.006)); v.vel.multiplyScalar(Math.max(0.75, 1 - hit * 0.012)); thud(v, hit); }
      }
    }
    // Motorcycle: lean into turns (what keeps it up), sit on the kickstand when stopped
    if (d.kind === 'bike') {
      const yawRate = vf * Math.tan(v.steer) / d.wheelbase, want = Math.abs(vf) > 1.5 ? Math.atan(vf * yawRate / 9.8) : 0.22;
      v.lean += (Math.max(-0.85, Math.min(0.85, want)) - v.lean) * Math.min(1, dt * 6);
      v.roll = v.lean;
    }
    v.spin += vf / d.wheelR * dt;
  }

  // ---------------------------------------------------------------- plane
  const _f = new V3(), _u = new V3(), _r = new V3(), _a = new V3(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
  function axes(v) { _f.set(0, 0, 1).applyQuaternion(v.q); _u.set(0, 1, 0).applyQuaternion(v.q); _r.set(-1, 0, 0).applyQuaternion(v.q); }
  function flyPlane(v, dt, inp) {
    const d = v.def;
    v.thr = Math.max(0, Math.min(1, v.thr + inp.thr * 0.7 * dt));
    axes(v);
    const speed = v.vel.length(), vf = v.vel.dot(_f), auth = Math.max(0.12, Math.min(1, vf / 30));
    // Controls: the mouse is the stick (pitch and roll), A/D the rudder in the air and the nose wheel on the ground
    const pitchIn = Math.max(-1, Math.min(1, stick.y + inp.pitch)), rollIn = Math.max(-1, Math.min(1, stick.x + inp.roll));
    if (v.onGround) {
      // On the wheels: steer with the nose wheel, wings level, and the nose comes up only near flying speed
      _e.setFromQuaternion(v.q, 'YXZ'); let yaw = _e.y, pitch = -_e.x;
      yaw -= inp.steer * Math.min(1, Math.abs(vf) / 6) * 0.9 * dt * Math.sign(vf || 1);
      const want = vf > d.rotate * 0.8 ? Math.max(0, pitchIn) * 0.28 : 0;
      pitch += (want - pitch) * Math.min(1, dt * 3);
      v.q.setFromEuler(_e.set(-pitch, yaw, 0, 'YXZ'));
    } else {
      _q.setFromEuler(_e.set(-pitchIn * 1.5 * auth * dt, -inp.steer * 0.25 * auth * dt, rollIn * 2.6 * auth * dt, 'YXZ'));
      v.q.multiply(_q);
      // Banking turns you: the tilted lift swings the nose round (a level turn's rate is g tan(bank) / speed)
      const bank = Math.asin(Math.max(-1, Math.min(1, -_r.y))), lift = Math.min(1, d.liftK * vf * vf / 9.8);
      if (speed > 8) v.q.premultiply(_q.setFromAxisAngle(_a.set(0, 1, 0), -9.8 * Math.sin(bank) * lift / Math.max(speed, 15) * 1.6 * dt));
      // Slow and the nose drops (a stall); the nose always drifts toward where it's going
      if (speed > 1) { _a.copy(v.vel).normalize(); const k = Math.min(1, dt * (0.4 + 1.6 * (1 - auth))); const t = new THREE.Quaternion().setFromUnitVectors(_f, _a); _q.identity().slerp(t, k); v.q.premultiply(_q); }
    }
    v.q.normalize(); axes(v);
    // Forces: thrust, lift (grows with speed squared and with the nose up), drag, gravity
    _a.set(0, -9.8, 0).addScaledVector(_f, v.thr * d.thrust);
    if (vf > 0) {
      const aoa = speed > 1 ? Math.max(-0.2, Math.min(0.3, -v.vel.dot(_u) / speed)) : 0;
      _a.addScaledVector(_u, Math.min(2.6 * 9.8, d.liftK * vf * vf * (1 + 5 * aoa)));
    }
    _a.addScaledVector(v.vel, -d.drag * speed);
    v.vel.addScaledVector(_a, dt);
    // The wings bite: velocity swings round toward the nose, sideways slip dies away
    if (speed > 1) { const s = v.vel.length(); _a.copy(v.vel).normalize().lerp(_f, Math.min(1, 1.6 * auth * dt)).normalize(); v.vel.copy(_a).multiplyScalar(s); }
    v.vel.addScaledVector(_r, -v.vel.dot(_r) * Math.min(1, 2 * dt));
    if (v.onGround) { // rolling: brakes on Space (or S with the throttle closed), a little rolling friction, no sideways skid
      const brake = inp.hand || (inp.thr < 0 && v.thr === 0);
      const h = new V3(_f.x, 0, _f.z).normalize(), hv = v.vel.dot(h); let nv = hv - Math.sign(hv) * Math.min(Math.abs(hv), (brake ? 9 : 0.4) * dt);
      v.vel.set(h.x * nv, v.vel.y, h.z * nv);
    }
    v.pos.addScaledVector(v.vel, dt);
    const g = groundAt(v.pos.x, v.pos.z, v.pos.y + 0.5), floor = (g === null ? -1e3 : g) + d.gearH;
    if (v.pos.y <= floor) {
      _e.setFromQuaternion(v.q, 'YXZ');
      const sink = -v.vel.y, roll = Math.abs(_e.z), nose = -_e.x;
      if (!v.onGround && (sink > 7 || roll > 0.4 || nose < -0.2)) return crash(v);
      v.pos.y = floor; if (v.vel.y < 0) v.vel.y = 0; v.onGround = true;
    } else if (v.pos.y > floor + 0.08) v.onGround = false;
    v.speed = vf; v.slip = 0;
  }
  function crash(v) {
    const p = v.pos.clone(); _boomFx(p, 7); sBoom(vol(p, 160)); v.g.visible = false; v.dead = 5; v.vel.set(0, 0, 0);
    if (v === cur) { leave(true); damage(P, 999, P, 'fall', false); note('Crashed the plane', 3); }
  }

  // ---------------------------------------------------------------- bumping into things
  function spheres(v) { // body as spheres along its length: [x, y, z, r]
    const d = v.def, r = d.kind === 'plane' ? 0.7 : Math.min(d.wid / 2, 1.0), n = Math.max(2, Math.ceil(d.len / (2 * r)) + 1), out = [];
    axes2(v);
    const y = v.pos.y + (d.kind === 'plane' ? 0 : d.colY);
    for (let i = 0; i < n; i++) { const s = -d.len / 2 + r + (d.len - 2 * r) * i / (n - 1); out.push([v.pos.x + _f.x * s, y + _f.y * s, v.pos.z + _f.z * s, r]); }
    if (d.kind === 'plane') for (const s of [-1, 1]) out.push([v.pos.x + _r.x * s * 4.2, v.pos.y - 0.28 + _r.y * s * 4.2, v.pos.z + _r.z * s * 4.2, 0.5]);
    return out;
  }
  function axes2(v) { if (v.def.kind === 'plane') { axes(v); return; } _f.set(Math.sin(v.yaw), 0, Math.cos(v.yaw)); _r.set(-Math.cos(v.yaw), 0, Math.sin(v.yaw)); }
  const _c = new V3();
  function hitWalls(v) {
    let worst = 0;
    for (const [x, y, z, r] of spheres(v)) {
      _c.set(x, y, z);
      sphereTris(_c, r, (t, q, dist) => {
        if (Math.abs(TG.NR[t * 3 + 1]) >= FLOOR_NY) return; // floors are the suspension's business
        if (v.def.kind !== 'plane' && q.y < v.pos.y + 0.45) return; // nor anything below the axles (a ramp's lip as you leave it)
        let nx = _c.x - q.x, nz = _c.z - q.z, l = Math.hypot(nx, nz); if (l < 1e-5) { nx = TG.NR[t * 3]; nz = TG.NR[t * 3 + 2]; l = Math.hypot(nx, nz) || 1; }
        nx /= l; nz /= l; const push = r - dist;
        v.pos.x += nx * push; v.pos.z += nz * push; _c.x += nx * push; _c.z += nz * push;
        const vn = v.vel.x * nx + v.vel.z * nz;
        if (vn < 0) { v.vel.x -= nx * vn * 1.25; v.vel.z -= nz * vn * 1.25; worst = Math.max(worst, -vn); }
      });
    }
    if (worst > 4) { if (v === cur) shake = Math.max(shake, Math.min(0.1, worst * 0.008)); thud(v, worst); }
    if (worst > 12 && v.def.kind === 'plane' && !v.onGround) crash(v);
  }
  function bumpVehicles() {
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j]; if (a.dead || b.dead || a.pos.distanceTo(b.pos) > 14) continue;
      const sa = spheres(a), sb = spheres(b);
      for (const [ax, ay, az, ar] of sa) for (const [bx, by, bz, br] of sb) {
        let nx = ax - bx, nz = az - bz; const d = Math.hypot(nx, nz); if (d >= ar + br || d < 1e-4 || Math.abs(ay - by) > 1.6) continue;
        nx /= d; nz /= d; const pen = ar + br - d, ma = a.def.mass, mb = b.def.mass, s = ma + mb;
        a.pos.x += nx * pen * mb / s; a.pos.z += nz * pen * mb / s; b.pos.x -= nx * pen * ma / s; b.pos.z -= nz * pen * ma / s;
        const vn = (a.vel.x - b.vel.x) * nx + (a.vel.z - b.vel.z) * nz;
        if (vn < 0) { const j2 = -1.2 * vn / (1 / ma + 1 / mb); a.vel.x += nx * j2 / ma; a.vel.z += nz * j2 / ma; b.vel.x -= nx * j2 / mb; b.vel.z -= nz * j2 / mb; if (-vn > 4) thud(a, -vn); }
      }
    }
  }
  // People on foot can't walk through vehicles
  function blockBody(e) {
    if (!list.length || e === P && cur) return;
    for (const v of list) {
      if (v.dead || v.pos.distanceTo(e.pos) > 12) continue;
      for (const [x, y, z, r] of spheres(v)) {
        if (e.pos.y > y + r || e.pos.y + e.h < y - r - 0.3) continue;
        let nx = e.pos.x - x, nz = e.pos.z - z; const d = Math.hypot(nx, nz), min = r + R; if (d >= min || d < 1e-4) continue;
        nx /= d; nz /= d; e.pos.x += nx * (min - d); e.pos.z += nz * (min - d);
        const vn = e.vel.x * nx + e.vel.z * nz; if (vn < 0) { e.vel.x -= nx * vn; e.vel.z -= nz * vn; }
        const sp = v.vel.x * -nx + v.vel.z * -nz; if (sp > 3) { e.vel.x += nx * sp; e.vel.z += nz * sp; e.vel.y = Math.max(e.vel.y, sp * 0.4); } // run over: knocked aside
      }
    }
  }

  // ---------------------------------------------------------------- drawing
  function pose(v, dt) {
    if (v.def.kind === 'plane') { v.g.position.copy(v.pos); v.g.quaternion.copy(v.q); if (v.prop) v.prop.rotation.z += (6 + v.thr * 60) * dt; }
    else {
      v.g.position.copy(v.pos); v.g.rotation.set(-v.pitch, v.yaw, v.roll, 'YXZ');
      v.wheels.forEach((w, i) => { w.spin.rotation.x = v.spin; if (i < v.steerN) w.piv.rotation.y = v.steer * -1; });
      if (v.fork) v.fork.rotation.y = -v.steer;
    }
  }

  // ---------------------------------------------------------------- sound: an engine note that climbs through the gears, and tyre squeal
  const S = { on: false };
  function soundStart(v) {
    initAudio(); if (!AC) return;
    soundStop();
    const o = AC.createOscillator(), o2 = AC.createOscillator(), f = AC.createBiquadFilter(), gn = AC.createGain();
    o.type = 'sawtooth'; o2.type = 'square'; f.type = 'lowpass'; f.frequency.value = 700; gn.gain.value = 0;
    o.connect(f); o2.connect(f); f.connect(gn); gn.connect(master); o.start(); o2.start();
    const n = AC.createBufferSource(), nf = AC.createBiquadFilter(), ng = AC.createGain();
    n.buffer = noiseBuf; n.loop = true; nf.type = 'bandpass'; nf.frequency.value = 1900; nf.Q.value = 4; ng.gain.value = 0;
    n.connect(nf); nf.connect(ng); ng.connect(master); n.start();
    Object.assign(S, { on: true, o, o2, gn, f, n, ng, v });
  }
  function soundStop() { if (!S.on) return; try { S.o.stop(); S.o2.stop(); S.n.stop(); } catch (e) {} S.on = false; }
  function soundTick() {
    if (!S.on || !AC) return; const v = S.v, d = v.def, t = AC.currentTime;
    if (!isFinite(v.speed) || !isFinite(v.slip)) return;
    let fr;
    if (d.kind === 'plane') fr = d.snd[0] + v.thr * d.snd[1] + Math.abs(v.speed) * 0.25;
    else { const sp = Math.abs(v.speed), gear = Math.min(5, Math.floor(sp / d.snd[2])), frac = (sp - gear * d.snd[2]) / d.snd[2]; fr = d.snd[0] + (gear ? 0.35 : 0) * d.snd[1] + frac * d.snd[1] * 0.65 + (keys.KeyW ? 6 : 0); }
    S.o.frequency.setTargetAtTime(fr, t, 0.05); S.o2.frequency.setTargetAtTime(fr * 0.5, t, 0.05);
    S.gn.gain.setTargetAtTime(0.055 + (d.kind === 'plane' ? v.thr * 0.06 : (keys.KeyW ? 0.03 : 0)), t, 0.08);
    S.ng.gain.setTargetAtTime(v.onGround ? Math.min(0.12, Math.max(0, (v.slip - 3) / 40)) : 0, t, 0.05);
  }
  function thud(v, hit) { if (AC && hit > 4) { const p = v.pos; sBoom(vol(p, 60) * Math.min(0.5, hit / 40)); } }

  // ---------------------------------------------------------------- getting in and out
  function nearest() { // within reach of any part of the body
    let best = null, bd = 1.6;
    for (const v of list) {
      if (v.dead || Math.abs(v.pos.y - P.pos.y) > 3 || v.pos.distanceTo(P.pos) > 14) continue;
      for (const [x, , z, r] of spheres(v)) { const d = Math.hypot(x - P.pos.x, z - P.pos.z) - r; if (d < bd) { bd = d; best = v; } }
    }
    return best;
  }
  function enter(v) {
    cur = v; view = 'chase'; camYaw = camPitch = 0; stick.x = stick.y = 0; lookIdle = 9;
    camPos.copy(camera.position); camLook.copy(v.pos);
    if (v.def.kind === 'plane') v.thr = 0;
    soundStart(v); setSelf(v.def.seatShow);
    note(`${v.def.name}: ${v.def.kind === 'plane' ? 'W/S throttle, mouse to fly, A/D rudder, Space brakes' : 'W/S drive, A/D steer, Space handbrake'}. V view, E get out`, 4);
  }
  function leave(force) {
    const v = cur; if (!v) return false;
    const fast = Math.hypot(v.vel.x, v.vel.z) > 9;
    if (fast && !force && v.onGround) { note('Slow down to get out', 1.5); return false; }
    axes2(v);
    const d = v.def, side = d.kind === 'plane' ? 2.2 : d.wid / 2 + 0.7;
    let spot = null;
    for (const s of [1, -1]) { // the driver's side (left) first, then the other side, then the roof
      const x = v.pos.x - _r.x * s * side, z = v.pos.z - _r.z * s * side, g = groundAt(x, z, v.pos.y + 2);
      if (g !== null && !meshBlocked(x, g + 0.05, z, STAND_H)) { spot = new V3(x, g, z); break; }
    }
    if (!spot) spot = new V3(v.pos.x, v.pos.y + 2.6, v.pos.z);
    P.pos.copy(spot); P.vel.set(v.vel.x * 0.5, v.onGround ? 0 : v.vel.y * 0.5, v.vel.z * 0.5);
    P.yaw = Math.atan2(-_f.x, -_f.z); P.pitch = 0; P.viewY = spot.y + 1.6;
    cur = null; soundStop(); setSelf(false);
    return true;
  }
  // Your own body is normally only a shadow; on the motorcycle in the chase view you can see yourself riding
  function setSelf(on) {
    if (!P.rig) return;
    P.rig.root.traverse(o => { if (o.isMesh) { o.material.colorWrite = on; o.material.depthWrite = on; } });
  }

  // ---------------------------------------------------------------- the test ground
  function canvasTex(draw, size = 256) {
    const c = document.createElement('canvas'); c.width = c.height = size; draw(c.getContext('2d'), size);
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; return t;
  }
  function speckle(base, spots, n) { return canvasTex((g, s) => { g.fillStyle = base; g.fillRect(0, 0, s, s); for (let i = 0; i < n; i++) { g.fillStyle = spots[i % spots.length]; const r = 1 + Math.random() * 1.5; g.fillRect(Math.random() * s, Math.random() * s, r, r); } }); }
  function buildGround() {
    const draw = new THREE.Group(), col = new THREE.Group(), cm = new THREE.MeshBasicMaterial();
    const grass = toonMat({ map: speckle('#5f7a3c', ['#5a7439', '#64803f', '#587237', '#68843f'], 9000) });
    const asphalt = toonMat({ map: speckle('#3b3d40', ['#34363a', '#44474b', '#2e3033'], 2000) });
    const concrete = toonMat({ map: speckle('#7f7d77', ['#7a7872', '#86847e', '#76746f'], 5000) });
    const paint = toonMat({ color: 0xece8dc }), yellow = toonMat({ color: 0xe0b52a });
    const solid = (geo, m, x, y, z, ry = 0) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.rotation.y = ry; o.castShadow = o.receiveShadow = true; draw.add(o); const c = new THREE.Mesh(geo, cm); c.position.copy(o.position); c.rotation.copy(o.rotation); col.add(c); return o; };
    const decal = (w, d, m, x, y, z, ry = 0, rep = 0) => { const geo = new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2); if (rep) { const uv = geo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / rep, uv.getY(i) * d / rep); } const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.rotation.y = ry; o.receiveShadow = true; draw.add(o); return o; };
    // Ground: 2 km square in 100 m tiles
    const tile = new THREE.PlaneGeometry(100, 100).rotateX(-Math.PI / 2); { const uv = tile.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 10, uv.getY(i) * 10); }
    for (let i = -10; i < 10; i++) for (let j = -10; j < 10; j++) solid(tile, grass, i * 100 + 50, 0, j * 100 + 50).castShadow = false;
    // Vehicle lot
    decal(46, 34, concrete, 0, 0.015, 2, 0, 6);
    for (let x = -18; x <= 18; x += 9) decal(0.2, 6, paint, x - 4.5, 0.025, 9);
    // Runway along x, starting by the lot
    decal(640, 30, asphalt, 290, 0.02, -40, 0, 8);
    for (let x = 0; x < 600; x += 30) decal(15, 0.9, paint, x, 0.03, -40);
    for (const z of [-54, -26]) decal(620, 0.6, paint, 290, 0.03, z);
    for (let k = 0; k < 8; k++) for (const x of [-22, 600]) decal(10, 1.4, paint, x, 0.03, -52 + k * 3.4);
    decal(30, 80, asphalt, -55, 0.018, -15, 0, 8); // apron to the hangar
    // Loop track: a rounded rectangle 12 m wide
    const rr = (x0, z0, x1, z1, r) => { const s = new THREE.Shape(); s.moveTo(x0 + r, z0); s.lineTo(x1 - r, z0); s.quadraticCurveTo(x1, z0, x1, z0 + r); s.lineTo(x1, z1 - r); s.quadraticCurveTo(x1, z1, x1 - r, z1); s.lineTo(x0 + r, z1); s.quadraticCurveTo(x0, z1, x0, z1 - r); s.lineTo(x0, z0 + r); s.quadraticCurveTo(x0, z0, x0 + r, z0); return s; };
    const ring = rr(54, -226, 366, -54, 56); ring.holes.push(rr(66, -214, 354, -66, 44)); // shape y is -z, so it faces up once laid flat
    const tg = new THREE.ShapeGeometry(ring, 24).rotateX(-Math.PI / 2); { const uv = tg.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 8, uv.getY(i) / 8); }
    const track = new THREE.Mesh(tg, asphalt); track.position.y = 0.02; track.receiveShadow = true; draw.add(track);
    for (let x = 110; x < 320; x += 16) decal(8, 0.4, paint, x, 0.03, 60); // centre dashes on the straights
    for (let x = 110; x < 320; x += 16) decal(8, 0.4, paint, x, 0.03, 220);
    for (let k = 0; k < 6; k++) decal(1.5, 12, k % 2 ? paint : toonMat({ color: 0x222222 }), 200 + k * 1.5, 0.031, 60); // start line
    // Road from the lot to the track
    decal(10, 60, asphalt, 20, 0.018, 34, 0, 8); decal(70, 10, asphalt, 45, 0.019, 60, 0, 8);
    // Jump park: ramps of three sizes, and a kicker with a landing ramp
    const ramp = (x, z, ry, len, wid, rise) => {
      const g = new THREE.BufferGeometry(), hw = wid / 2;
      const v = [[-hw, 0, 0], [hw, 0, 0], [hw, 0, len], [-hw, 0, len], [hw, rise, len], [-hw, rise, len]];
      const f = [[0, 1, 2, 3], [3, 2, 4, 5], [0, 5, 4, 1], [1, 4, 2], [0, 3, 5]]; // wound to face outward
      const pos = [], uv = [];
      for (const q of f) { const tri = q.length === 4 ? [[q[0], q[1], q[2]], [q[0], q[2], q[3]]] : [q]; for (const t of tri) for (const k of t) { pos.push(...v[k]); uv.push(v[k][0] / 2, (v[k][2] + v[k][1]) / 2); } }
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.computeVertexNormals();
      solid(g, concrete, x, 0, z, ry);
    };
    ramp(-40, 40, 0, 7, 6, 1.2); ramp(-25, 40, 0, 12, 7, 2.6); ramp(-5, 40, 0, 20, 8, 5.0);
    ramp(-60, 70, Math.PI / 2, 10, 7, 2.2); ramp(-20, 70, -Math.PI / 2, 14, 7, 2.2); // a kicker, then 16 m of air to a landing ramp
    // Buildings to drive round (and into) and fly past
    const blds = [[-80, 0, 30, 18, 9, 14, 0x8c8478], [-90, 0, 120, 12, 22, 12, 0x6f7f8c], [140, 0, -120, 26, 12, 20, 0x8a6f5a], [0, 0, -220, 10, 46, 10, 0xb9b4a8], [420, 0, 140, 20, 15, 30, 0x7c8a6a], [-160, 0, -60, 16, 8, 26, 0x9a8f7a]];
    for (const [x, y, z, w, h, d, c] of blds) solid(new THREE.BoxGeometry(w, h, d), toonMat({ color: c }), x, h / 2, z);
    // Hangar by the runway, open at the front
    const hm = toonMat({ color: 0x7d858c });
    solid(new THREE.BoxGeometry(24, 0.6, 20), hm, -55, 9.7, -5); solid(new THREE.BoxGeometry(24, 10, 0.5), hm, -55, 5, 5);
    solid(new THREE.BoxGeometry(0.5, 10, 20), hm, -67, 5, -5); solid(new THREE.BoxGeometry(0.5, 10, 20), hm, -43, 5, -5);
    // Cones along the track's inside and a pair of pylons to fly between
    const cone = new THREE.ConeGeometry(0.3, 0.75, 10); const orange = toonMat({ color: 0xe86a1c });
    for (let x = 110; x <= 310; x += 25) for (const z of [72, 208]) { const o = new THREE.Mesh(cone, orange); o.position.set(x, 0.38, z); o.castShadow = true; draw.add(o); }
    for (const z of [-130, -100]) { solid(new THREE.BoxGeometry(3, 34, 3), yellow, 300, 17, z); solid(new THREE.BoxGeometry(3.4, 1.5, 3.4), toonMat({ color: 0xc8302f }), 300, 34.7, z); }
    draw.updateMatrixWorld(true); col.updateMatrixWorld(true);
    LEVEL_SCENES.DriveFlat = draw; LEVEL_SCENES.DriveFlat_col = col;
  }
  buildGround();

  // ---------------------------------------------------------------- HUD
  const hud = document.createElement('div');
  hud.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:6;color:#eef3ea;font:600 15px/1.35 system-ui,sans-serif;text-align:right;text-shadow:0 1px 4px #000;pointer-events:none;display:none';
  const prompt = document.createElement('div');
  prompt.style.cssText = 'position:fixed;left:50%;top:62%;transform:translateX(-50%);z-index:6;color:#fff;font:600 16px system-ui,sans-serif;text-shadow:0 1px 5px #000;pointer-events:none;display:none';
  document.body.append(hud, prompt);
  function hudTick() {
    const on = !!(LV && LV.vehicles) && locked;
    if (cur && on) {
      const v = cur, kmh = Math.round(Math.abs(v.speed) * 3.6);
      hud.innerHTML = v.def.kind === 'plane'
        ? `<div style="font-size:30px">${kmh} km/h</div>Throttle ${Math.round(v.thr * 100)}% · Altitude ${Math.max(0, Math.round(v.pos.y - v.def.gearH))} m${v.onGround ? ' · on the ground' : ''}${Math.max(Math.abs(v.pos.x), Math.abs(v.pos.z)) > 1000 ? '<br><b>Past the edge of the test ground: turn back</b>' : ''}<br><small>W/S throttle · mouse fly · A/D rudder · Space brakes · V view · E out</small>`
        : `<div style="font-size:30px">${kmh} km/h</div>${v.def.name}${v.speed < -0.5 ? ' · reverse' : ''}<br><small>W/S drive · A/D steer · Space handbrake · V view · E out</small>`;
      hud.style.display = '';
    } else hud.style.display = 'none';
    const nv = on && !cur && P.alive ? nearest() : null;
    prompt.style.display = nv ? '' : 'none'; if (nv) prompt.textContent = `E  ${nv.def.kind === 'plane' ? 'Fly' : nv.def.kind === 'bike' ? 'Ride' : 'Drive'} the ${nv.def.name.toLowerCase()}`;
  }

  // ---------------------------------------------------------------- hooks the game calls
  const input = () => ({
    thr: (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0),
    steer: (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0),
    hand: !!keys.Space, pitch: 0, roll: 0,
  });
  const idle = { thr: 0, steer: 0, hand: false, pitch: 0, roll: 0 };
  Object.defineProperty(VEH, 'cur', { get: () => cur, configurable: true });
  Object.assign(VEH, {
    list,
    onLevel() { if (LV && LV.vehicles) spawnLot(); else { for (const v of list) scene.remove(v.g); list.length = 0; if (cur) { cur = null; soundStop(); setSelf(false); } } },
    update(dt) {
      if (!list.length) return;
      for (const v of list) {
        if (v.dead) { if ((v.dead -= dt) <= 0) place(v); continue; }
        const inp = v === cur && locked ? input() : idle;
        if (v.def.kind === 'plane') { if (v === cur || !v.onGround || v.vel.lengthSq() > 0.01 || v.thr > 0) flyPlane(v, dt, inp); }
        else driveGround(v, dt, inp);
        if (!v.dead) hitWalls(v);
      }
      bumpVehicles();
      for (const v of list) if (!v.dead) pose(v, dt);
      stick.x *= Math.exp(-2.5 * dt); stick.y *= Math.exp(-2.5 * dt);
      if (cur) { // you ride along: the game still sees you where the vehicle is
        P.pos.set(cur.pos.x, cur.pos.y + (cur.def.kind === 'plane' ? -0.6 : 0.2), cur.pos.z); P.vel.copy(cur.vel); P.onGround = true;
        if (cur.pos.y < KILL_Y) { const v = cur; leave(true); place(v); }
      }
      soundTick();
    },
    block: blockBody,
    // Mouse: free look round a car (it settles back behind you); in the plane the mouse is the stick
    mouse(dx, dy) {
      if (!cur) return false;
      if (cur.def.kind === 'plane' && view === 'chase' || cur.def.kind === 'plane' && view === 'cockpit') { stick.x = Math.max(-1, Math.min(1, stick.x + dx * 0.004)); stick.y = Math.max(-1, Math.min(1, stick.y - dy * 0.004)); return true; }
      camYaw -= dx * SENS; camPitch = Math.max(-0.6, Math.min(0.9, camPitch - dy * SENS)); lookIdle = 0; return true;
    },
    key(code) {
      if (!LV || !LV.vehicles) return false;
      if (code === 'KeyE') { if (cur) leave(false); else { const v = nearest(); if (!v || !P.alive) return false; enter(v); } return true; }
      if (!cur) return false;
      if (code === 'KeyV') { view = view === 'chase' ? 'cockpit' : 'chase'; setSelf(view === 'chase' && cur.def.seatShow); return true; }
      return ['KeyR', 'KeyF', 'KeyG', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'KeyC'].includes(code); // no guns at the wheel
    },
    // Camera: a chase view that swings round behind, or the driver's seat
    camera(dt) {
      if (!cur) return;
      const v = cur, d = v.def; axes2(v);
      lookIdle += dt; if (lookIdle > 1.2) { const k = Math.min(1, dt * 2.5); camYaw -= camYaw * k; camPitch -= camPitch * k; }
      const sp = Math.abs(v.speed || 0);
      camera.fov = 72 + Math.min(14, sp * 0.25); camera.updateProjectionMatrix();
      if (view === 'cockpit') {
        const [ex, ey, ez] = d.eye;
        camera.position.copy(v.pos).addScaledVector(_f, ez).addScaledVector(_r, -ex);
        if (d.kind === 'plane') { camera.position.addScaledVector(_u, ey); camera.quaternion.copy(v.q).multiply(_q.setFromEuler(_e.set(0, Math.PI, 0))); }
        else { camera.position.y += ey; camera.quaternion.setFromEuler(_e.set(v.pitch + camPitch, v.yaw + Math.PI + camYaw, -v.roll, 'YXZ')); }
        camera.updateMatrixWorld(); return;
      }
      const [dist, h, lookH] = d.cam, target = new V3(v.pos.x, v.pos.y + lookH, v.pos.z);
      let want;
      if (d.kind === 'plane') want = target.clone().addScaledVector(_f, -dist).add(new V3(0, h, 0));
      else { const y = v.yaw + camYaw, cp = Math.cos(camPitch); want = target.clone().add(new V3(-Math.sin(y) * dist * cp, h + Math.sin(camPitch) * dist, -Math.cos(y) * dist * cp)); }
      // Keep the camera out of walls and the ground
      const dir = want.clone().sub(target), len = dir.length(); dir.divideScalar(len);
      const hit = tgRay(target.x, target.y, target.z, dir.x, dir.y, dir.z, len); if (hit < len) want.copy(target).addScaledVector(dir, Math.max(1, hit - 0.4));
      const gy = groundAt(want.x, want.z, want.y + 1); if (gy !== null && want.y < gy + 0.5) want.y = gy + 0.5;
      camPos.lerp(want, 1 - Math.exp(-(d.kind === 'plane' ? 6 : 9) * dt));
      camLook.lerp(target.addScaledVector(_f, d.kind === 'plane' ? 12 : 3), 1 - Math.exp(-14 * dt));
      camera.position.copy(camPos); camera.up.set(0, 1, 0); camera.lookAt(camLook); camera.updateMatrixWorld();
    },
    after(dt) {
      hudTick();
      for (const id of ['ammo', 'c1', 'c2', 'c3', 'c4']) { const e = $(id); if (e) e.style.visibility = cur ? 'hidden' : ''; }
      if (!cur) return;
      vm.visible = false; knifeVM.visible = false; // no gun in your hands at the wheel, and none of the on-foot HUD
      if (P.rig) {
        const r = P.rig, v = cur;
        if (v.def.seatShow && view === 'chase') { r.wrap.visible = true; axes2(v); r.wrap.position.set(v.pos.x - _f.x * 0.25, v.pos.y + 0.3, v.pos.z - _f.z * 0.25); r.wrap.rotation.set(0, v.yaw, v.roll, 'YXZ'); animRig(r, dt, 0, true, 0.3); }
        else r.wrap.visible = false;
      }
    },
    exit: () => leave(true),
  });
})();
