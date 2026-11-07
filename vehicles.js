// Vehicles: cars, trucks and motorcycles you can drive, ride in and tune (Tab), with multiplayer. Test Drive builds its
// stadium here and parks a lot of them in the infield; the fort parks some of its own.
// Loaded after the main game script, so it uses the game's globals (scene, camera, P, keys, TG, groundAt, toonMat, NET, ...).
// The game calls into VEH (declared in index.html) from its loop, input, camera and networking.
//
// Conventions: a vehicle's yaw y points it along (sin y, 0, cos y), like the trucks; the driver's right is
// (-cos y, 0, sin y), so steering right turns the yaw down. Models are built facing +Z with their left side on +X.
//
// Multiplayer: whoever drives a vehicle simulates it on their own machine and sends its state; the host simulates
// the parked ones and relays everything in its snapshots. In a crash each machine pushes the vehicles it simulates,
// using the other vehicle's reported speed, so both cars react.
(() => {
  // ---------------------------------------------------------------- tuning: what the Tab panel edits
  // [key, label, min, max, step, unit, which vehicles, section]
  const TUNE = [
    ['power', 'Acceleration', 2, 40, 0.5, 'm/s²', 'all', 'Engine'],
    ['top', 'Top speed', 40, 400, 5, 'km/h', 'all', 'Engine'],
    ['brake', 'Brakes', 2, 40, 0.5, 'm/s²', 'all', 'Engine'],
    ['rev', 'Reverse speed', 5, 80, 1, 'km/h', 'all', 'Engine'],
    ['steer', 'Steering lock', 8, 60, 1, '°', 'all', 'Steering and grip'],
    ['steerFall', 'Lock halves at', 20, 600, 10, 'km/h', 'all', 'Steering and grip'],
    ['steerRate', 'Steering speed', 1, 30, 0.5, '', 'all', 'Steering and grip'],
    ['maxLat', 'Grip (how hard it can corner)', 0.3, 8, 0.05, 'g', 'all', 'Steering and grip'],
    ['downforce', 'Downforce (extra grip at speed)', 0, 6, 0.1, 'g', 'all', 'Steering and grip'],
    ['grip', 'Slide recovery', 1, 40, 0.5, '', 'all', 'Sliding and handbrake'],
    ['hand', 'Handbrake power', 0, 25, 0.5, 'm/s²', 'all', 'Sliding and handbrake'],
    ['slide', 'Grip on the handbrake', 0.1, 10, 0.1, '', 'all', 'Sliding and handbrake'],
    ['mass', 'Weight', 100, 6000, 10, 'kg', 'all', 'Body'],
    ['wheelbase', 'Length (wheelbase)', 1, 6, 0.05, 'm', 'all', 'Body'],
    ['track', 'Width (track)', 0.8, 3, 0.05, 'm', 'car', 'Body'],
    ['wheelR', 'Wheel size (radius)', 0.15, 0.8, 0.01, 'm', 'all', 'Body'],
    ['spring', 'Suspension stiffness', 0.4, 8, 0.1, 'Hz', 'all', 'Suspension'],
    ['damp', 'Suspension damping', 0.05, 2, 0.05, '', 'all', 'Suspension'],
    ['travel', 'Body roll and dive', 0, 4, 0.1, '×', 'all', 'Suspension'],
    ['lean', 'Lean into turns', 0, 2, 0.05, '×', 'bike', 'Suspension'],
    ['gravity', 'Gravity', 2, 40, 0.5, 'm/s²', 'all', 'Air and crashes'],
    ['airPitch', 'Nose control in the air', 0, 10, 0.1, '', 'all', 'Air and crashes'],
    ['bounce', 'Bounce off walls', 0, 1.5, 0.05, '', 'all', 'Air and crashes'],
  ];
  const HELP = {
    steerFall: 'The steering lock fades as you go faster; this is the speed where you get half of it. Max it for full lock at any speed (grip still limits the turn).',
    steerRate: 'How quickly the wheels turn when you press A or D. Higher is twitchier.',
    downforce: 'Extra grip that grows with speed, like a race car\'s wings (0 is none): this many g more at 62 mph, four times as much at 124.',
    slide: 'How much the tyres still hold sideways on the handbrake. Low lets the back swing out into a drift.',
    maxLat: 'This is what limits turning once you\'re moving: past a walking pace the car turns only as hard as its grip allows, however far you steer. Raise it to turn harder at speed. 1.5 is a road car, 3 a race car, 6 and up a cartoon. (The banked turns add a little.)',
    grip: 'How quickly a sideways slide straightens out. Low is drifty, high snaps straight.',
    hand: 'How hard the handbrake stops you. It locks the back wheels and cuts the engine while you hold it.',
    mass: 'How hard you hit, and how far you get shoved, when vehicles collide.',
    travel: 'How far the body dives under braking, squats under power and leans in corners.',
  };
  const BASE_CAR = { power: 10, top: 170, brake: 11, rev: 40, hand: 9, slide: 1.6, steer: 34, steerFall: 65, grip: 8, maxLat: 2.2, mass: 1200,
    wheelbase: 2.6, track: 1.6, wheelR: 0.34, spring: 2, damp: 0.5, travel: 1, lean: 0, gravity: 14, airPitch: 2.2, bounce: 0.25, steerRate: 7, downforce: 0 };
  const BASE_BIKE = { power: 13, top: 190, brake: 10, rev: 10, hand: 7, slide: 2.4, steer: 40, steerFall: 45, grip: 10, maxLat: 2.0, mass: 230,
    wheelbase: 1.45, track: 0.3, wheelR: 0.33, spring: 2.4, damp: 0.5, travel: 0.8, lean: 1, gravity: 14, airPitch: 2.2, bounce: 0.3, steerRate: 7, downforce: 0 };
  const PRESETS = {
    kart: { kind: 'car', name: 'Kart', color: 0xd23a2a, p: { power: 12, top: 125, steer: 38, steerFall: 80, grip: 11, maxLat: 2.8, mass: 420, wheelbase: 1.75, track: 1.3, wheelR: 0.25, spring: 3.5, travel: 0.4 } },
    roadster: { kind: 'car', name: 'Roadster', color: 0x2e63b8, p: { top: 190 } },
    muscle: { kind: 'car', name: 'Muscle', color: 0xe08a1e, p: { power: 13, top: 215, grip: 6.5, maxLat: 1.8, slide: 1.1, mass: 1650, wheelbase: 2.95, track: 1.7, wheelR: 0.36, spring: 1.6, travel: 1.3 } },
    buggy: { kind: 'car', name: 'Buggy', color: 0x4e9a3a, p: { power: 9, top: 150, wheelR: 0.44, track: 1.8, wheelbase: 2.4, spring: 1.2, damp: 0.35, travel: 1.6, mass: 850, grip: 7, maxLat: 1.9 } },
    hauler: { kind: 'car', name: 'Hauler', color: 0xd9d4c7, p: { power: 6, top: 130, brake: 8, steer: 28, mass: 3200, wheelbase: 3.8, track: 2.1, wheelR: 0.45, maxLat: 1.3, spring: 1.4, travel: 1.2 } },
    roadster2: { kind: 'car', name: 'Roadster', color: 0xe3c02c, p: { top: 190 } },
    sport: { kind: 'bike', name: 'Sport bike', color: 0xc9342b, p: { steerFall: 210, maxLat: 3.7, wheelbase: 1.5, wheelR: 0.43, steerRate: 29.5 } }, // James's tuning
    // The truck (Austin's tuning, 2026-11-03, on James's jeep): two seats in front, six on benches in the back. Drawn from the Cargo Truck
    // model once it has loaded (setModel), which also sets its wheelbase, track and wheel size; until then built from boxes.
    truck: { kind: 'car', layout: 'truck', name: 'Truck', color: 0x5b6142, p: { power: 6.5, top: 55, brake: 2, rev: 40, hand: 9, slide: 4.3, steer: 34, steerFall: 65, grip: 3, maxLat: 2.75, mass: 4460, wheelbase: 3.0433, track: 1.9286, wheelR: 0.5704, spring: 1.6, damp: 0.6, travel: 0.5, lean: 0, gravity: 14, airPitch: 2.2, bounce: 0.25, steerRate: 9, downforce: 0 } },
    dirt: { kind: 'bike', name: 'Dirt bike', color: 0x3a6fd0, p: { power: 11, top: 140, wheelR: 0.36, spring: 1.5, travel: 1.3, grip: 8, maxLat: 1.7, mass: 150, wheelbase: 1.5 } },
  };
  // The parking lot in the infield: [preset, x, z, yaw]; the cars face the gap in the inner wall onto the front straight
  const LOT = [['kart', -25, -6, Math.PI], ['roadster', -16, -6, Math.PI], ['muscle', -7, -6, Math.PI], ['buggy', 2, -6, Math.PI],
    ['hauler', 11, -6, Math.PI], ['roadster2', 20, -6, Math.PI], ['truck', 29.5, -6, Math.PI], ['sport', -5, 6, Math.PI], ['dirt', 0, 6, Math.PI]];
  const defaults = key => Object.assign({}, PRESETS[key].kind === 'bike' ? BASE_BIKE : BASE_CAR, PRESETS[key].p);

  // ---------------------------------------------------------------- the track: an oval, front straight at -z (raced toward -x), turns to the left
  const TRK = { half: 60, R: 45, W: 16, bank: 8 * Math.PI / 180, wallIn: 1.0, wallOut: 1.4, fence: 6, gap: 18, door: 1.1 }; // gap: the opening onto the infield; door: the walkway through the outer wall to the stands
  TRK.len = 4 * TRK.half + 2 * Math.PI * TRK.R;
  // Centreline point, outward normal and banking factor at distance s along the lap (s = 0 at the start line, x = 0 on the front straight)
  function lap(s) {
    const { half, R, len } = TRK; s = ((s % len) + len) % len;
    const seg = [half, Math.PI * R, 2 * half, Math.PI * R, half]; // front straight (second half), left turn, back straight, right-hand end turn, front straight (first half)
    let d = s;
    if (d < seg[0]) return { x: -d, z: -R, nx: 0, nz: -1, b: bankRamp(half - d) };
    d -= seg[0];
    if (d < seg[1]) { const a = -Math.PI / 2 - d / R; return { x: -half + R * Math.cos(a), z: R * Math.sin(a), nx: Math.cos(a), nz: Math.sin(a), b: 1 }; }
    d -= seg[1];
    if (d < seg[2]) return { x: -half + d, z: R, nx: 0, nz: 1, b: bankRamp(Math.min(d, 2 * half - d)) };
    d -= seg[2];
    if (d < seg[3]) { const a = Math.PI / 2 - d / R; return { x: half + R * Math.cos(a), z: R * Math.sin(a), nx: Math.cos(a), nz: Math.sin(a), b: 1 }; }
    d -= seg[3];
    return { x: half - d, z: -R, nx: 0, nz: -1, b: bankRamp(d) };
  }
  function bankRamp(dist) { return Math.max(0, 1 - dist / 25); } // the banking eases in over the last 25 m of each straight
  const bankH = (b, u) => 0.02 + b * Math.tan(TRK.bank) * (u + TRK.W / 2); // u: -W/2 at the inner edge, +W/2 at the outer

  // ---------------------------------------------------------------- models from the asset library
  // A preset can be drawn from a model file once it has loaded (VEH.setModel): the fort's Cargo Truck, from
  // tools/build_truck.py, which describes its parts and markers. Its wheels go on the preset's axles, so the preset takes the
  // model's wheelbase, track and wheel size.
  const MODELS = {};
  function setModel(key, sc) {
    if (PRESETS[key].kind === 'bike') return setBikeModel(key, sc);
    const get = n => sc.getObjectByName(n), at = n => get(n).position.clone();
    const boxes = ['Box_Cab', 'Box_Back', 'Box_Under'].map(get).map(o => ({ c: o.position.clone(), h: o.scale.clone() }));
    let z0 = Infinity, z1 = -Infinity;
    for (const b of boxes) { z0 = Math.min(z0, b.c.z - b.h.z); z1 = Math.max(z1, b.c.z + b.h.z); }
    const fl = get('Wheel_FL'), rr = get('Wheel_RR');
    const m = { body: get('Body'), wreck: get('Wreck'), wheelLeft: get('Wheel_L'), wheelRight: get('Wheel_R'), steer: get('SteeringWheel'), seats: [], boxes,
      len: z1 - z0, mid: (z0 + z1) / 2, half: Math.max(boxes[1].h.x, boxes[2].h.x), // the cab box is wider: it takes in the mirrors
      wheelbase: fl.position.z - rr.position.z, track: fl.position.x - rr.position.x, wheelR: fl.scale.x };
    for (let k = 0; get('Seat_' + k); k++) { // the cab's two seats face forward; the benches face in
      const p = at('Seat_' + k), side = k < 2 ? 0 : Math.sign(p.x);
      m.seats.push({ p, eye: p.clone().add(new V3(-side * 0.15, k < 2 ? 1.05 : 0.8, k < 2 ? -0.02 : 0)), yaw: side * -Math.PI / 2 }); // the cab's eyes sit high, to see the road over the hood
    }
    // The bench seat nearest the cab on each side is wedged against the container's front wall: nobody can see from it, so it's never offered
    for (const sd of [-1, 1]) {
      const side = m.seats.filter((q, k) => k > 1 && Math.sign(q.p.x) === sd);
      if (side.length) side.reduce((a, b) => Math.abs(a.p.z - m.seats[0].p.z) < Math.abs(b.p.z - m.seats[0].p.z) ? a : b).blocked = true;
    }
    MODELS[key] = m;
    Object.assign(PRESETS[key].p, { wheelbase: m.wheelbase, track: m.track, wheelR: m.wheelR });
    refresh(key, { wheelbase: m.wheelbase, track: m.track, wheelR: m.wheelR });
  }
  // Vehicles already out when their model arrives (the level was up before the file came in, as on a slow connection or a
  // guest who joins at once) were built from boxes: build them again from the model, on its axles
  function refresh(key, axles) { for (const v of list) if (v.key === key) { Object.assign(v.p, axles); rebuild(v); } }
  // A motorcycle model (tools/build_motorcycle.py): the body, the steering parts under Steer (at the front axle, its y up the
  // steering axis), the two wheels and where the rider sits. Its wheels go on the preset's axles like the truck's.
  function setBikeModel(key, sc) {
    const get = n => sc.getObjectByName(n), at = n => get(n).position.clone(), wf = get('Wheel_Front'), wb = get('Wheel_Back');
    const m = { bike: true, body: get('Body'), steer: get('Steer'), wheelF: get('Wheel_F'), wheelB: get('Wheel_B'),
      seats: [0, 1].map(k => ({ p: at('Seat_' + k), peg: at('Peg_' + k) })), // the rider on the front of the saddle, a passenger behind
      wheelbase: wf.position.z - wb.position.z, wheelR: wf.scale.x };
    MODELS[key] = m;
    Object.assign(PRESETS[key].p, { wheelbase: m.wheelbase, wheelR: m.wheelR });
    refresh(key, { wheelbase: m.wheelbase, wheelR: m.wheelR });
  }
  function buildBikeModel(v, m) {
    const p = v.p, L = p.wheelbase, r = p.wheelR, k = r / m.wheelR, g = new THREE.Group(), body = new THREE.Group();
    g.add(body); body.add(m.body.clone());
    // The fork and bars turn on the steering axis with the body (on the suspension); the front wheel turns on the same axis at the axle
    const head = new THREE.Group(); head.position.copy(m.steer.position); head.quaternion.copy(m.steer.quaternion); body.add(head);
    const fork = new THREE.Group(); head.add(fork);
    for (const c of m.steer.children) fork.add(c.clone());
    const tilt = new THREE.Group(); tilt.position.set(0, r, L / 2); tilt.quaternion.copy(m.steer.quaternion); g.add(tilt);
    const piv = new THREE.Group(), spin = new THREE.Group(), wf = m.wheelF.clone(); tilt.add(piv); piv.add(spin); spin.add(wf);
    spin.quaternion.identity(); wf.position.set(0, 0, 0); wf.quaternion.copy(m.steer.quaternion).invert(); wf.scale.setScalar(k);
    const rp = new THREE.Group(), rs = new THREE.Group(), wb = m.wheelB.clone(); rp.position.set(0, r, -L / 2); g.add(rp); rp.add(rs); rs.add(wb);
    wb.position.set(0, 0, 0); wb.scale.setScalar(k);
    // Seats: p is just under the saddle's top (where a seated body's middle goes, like the cars'); peg is the left footpeg
    const seats = m.seats.map((s, k) => ({ p: s.p.clone().add(new V3(0, -0.03, 0)), eye: s.p.clone().add(new V3(0, k ? 0.72 : 0.68, k ? 0 : 0.1)), yaw: 0, peg: s.peg.clone(), saddle: s.p.clone() }));
    return { g, body, wheels: [{ piv, spin }, { piv: rp, spin: rs }], steerN: 1, fork, grips: ['Grip_L', 'Grip_R'].map(n => fork.getObjectByName(n)), seats };
  }
  // A vehicle drawn from its model: the body on the suspension, the wheels on the axles, the steering wheel turning on its
  // column. The wreck waits hidden until it's needed (darken).
  function buildModel(v, m) {
    const p = v.p, g = new THREE.Group(), body = new THREE.Group(), shell = m.body.clone(), wreck = m.wreck.clone();
    g.add(body); wreck.visible = false; body.add(shell, wreck);
    const col = new THREE.Group(), sw = new THREE.Group(); col.position.copy(m.steer.position); col.quaternion.copy(m.steer.quaternion); body.add(col); col.add(sw);
    for (const c of m.steer.children) sw.add(c.clone());
    const L = p.wheelbase, T = p.track, r = p.wheelR, wheels = [];
    for (const [x, z] of [[T / 2, L / 2], [-T / 2, L / 2], [T / 2, -L / 2], [-T / 2, -L / 2]]) {
      const piv = new THREE.Group(), spin = new THREE.Group(), w = (x > 0 ? m.wheelLeft : m.wheelRight).clone();
      piv.position.set(x, r, z); g.add(piv); piv.add(spin); w.scale.setScalar(r / m.wheelR); spin.add(w);
      wheels.push({ piv, spin });
    }
    return { g, body, wheels, steerN: 2, steerWheel: sw, model: m, shell, wreckMesh: wreck, seats: m.seats.map(s => ({ p: s.p.clone(), eye: s.eye.clone(), yaw: s.yaw, blocked: s.blocked })) };
  }
  // The body's length, and where its middle is (ahead of the point halfway between the axles)
  const lenOf = v => v.model ? v.model.len : v.p.wheelbase + (v.kind === 'bike' ? 0.6 : 0.9);
  const midOf = v => v.model ? v.model.mid : 0;

  // ---------------------------------------------------------------- materials and models
  const mat = c => toonMat({ color: c });
  const M = { dark: mat(0x1d1f22), seat: mat(0x2b2f35), chrome: mat(0xb9c0c6), light: mat(0xfff3c4), tail: mat(0xb3261e), tyre: mat(0x18191b), rim: mat(0x8a9097) };
  function part(g, geo, m, x, y, z) { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = true; o.receiveShadow = true; g.add(o); return o; }
  const box = (g, w, h, d, m, x, y, z) => part(g, new THREE.BoxGeometry(w, h, d), m, x, y, z);
  function wheel(g, r, w, x, y, z) { // a pivot (steering) holding a spinner (rolling)
    const piv = new THREE.Group(); piv.position.set(x, y, z); g.add(piv);
    const spin = new THREE.Group(); piv.add(spin);
    part(spin, new THREE.CylinderGeometry(r, r, w, 18).rotateZ(Math.PI / 2), M.tyre, 0, 0, 0);
    part(spin, new THREE.BoxGeometry(w * 1.05, r * 0.9, r * 0.22), M.rim, 0, 0, 0);
    part(spin, new THREE.BoxGeometry(w * 1.05, r * 0.22, r * 0.9), M.rim, 0, 0, 0);
    return { piv, spin };
  }
  // A car is a bare chassis: frame, floor, two seats, a steering wheel, four wheels. Nothing in front of the driver.
  function buildCar(v) {
    const p = v.p, g = new THREE.Group(), body = new THREE.Group(), paint = mat(v.color);
    g.add(body);
    const L = p.wheelbase, T = p.track, r = p.wheelR, floor = r * 0.7 + 0.06, len = L + 0.9, rail = T / 2 - 0.15;
    for (const s of [-1, 1]) box(body, 0.1, 0.12, len, paint, s * rail, floor, 0);
    for (const z of [L / 2, -L / 2, 0]) box(body, T - 0.2, 0.09, 0.1, paint, 0, floor, z);
    box(body, T - 0.3, 0.03, L * 0.75, M.dark, 0, floor - 0.03, -0.05);
    for (const z of [len / 2, -len / 2]) box(body, T * 0.85, 0.13, 0.12, paint, 0, floor + 0.05, z);
    for (const s of [-1, 1]) { box(body, 0.16, 0.08, 0.04, M.light, s * T * 0.3, floor + 0.1, len / 2 + 0.07); box(body, 0.16, 0.08, 0.04, M.tail, s * T * 0.3, floor + 0.1, -len / 2 - 0.07); }
    const sx = Math.min(0.36, T / 2 - 0.3), seatZ = -L * 0.12;
    for (const s of [1, -1]) {
      box(body, 0.46, 0.1, 0.48, M.seat, s * sx, floor + 0.12, seatZ);
      box(body, 0.46, 0.62, 0.08, M.seat, s * sx, floor + 0.46, seatZ - 0.27).rotation.x = -0.2;
    }
    // Steering wheel in front of the driver's seat (the left one), on a column down to the front cross member
    const col = new THREE.Group(); col.position.set(sx, floor + 0.62, seatZ + 0.46); col.rotation.x = -0.5; body.add(col);
    const sw = new THREE.Group(); col.add(sw);
    part(sw, new THREE.TorusGeometry(0.17, 0.022, 8, 22), M.dark, 0, 0, 0);
    box(sw, 0.32, 0.03, 0.02, M.dark, 0, 0, 0); box(sw, 0.03, 0.17, 0.02, M.dark, 0, -0.08, 0);
    box(col, 0.04, 0.04, 0.6, M.chrome, 0, 0, 0.32);
    const wheels = [];
    for (const [x, z] of [[T / 2, L / 2], [-T / 2, L / 2], [T / 2, -L / 2], [-T / 2, -L / 2]]) wheels.push(wheel(g, r, Math.max(0.16, r * 0.62), x, r, z));
    return { g, body, wheels, steerN: 2, steerWheel: sw, seats: [
      { p: new V3(sx, floor + 0.17, seatZ), eye: new V3(sx, floor + 1.2, seatZ - 0.02), yaw: 0 },
      { p: new V3(-sx, floor + 0.17, seatZ), eye: new V3(-sx, floor + 1.2, seatZ - 0.02), yaw: 0 }] };
  }
  // The truck: an open chassis with the two front seats and steering wheel well forward, and a bed behind with low sides, a
  // tailgate and a bench down each side (three seats a side, facing in). A roll bar behind the front seats.
  function buildTruck(v) {
    if (MODELS.truck) return buildModel(v, MODELS.truck);
    const p = v.p, g = new THREE.Group(), body = new THREE.Group(), paint = mat(v.color), wood = mat(0x6b4f33);
    g.add(body);
    const L = p.wheelbase, T = p.track, r = p.wheelR, floor = r * 0.7 + 0.08, len = L + 0.9, rail = T / 2 - 0.15;
    for (const s of [-1, 1]) box(body, 0.12, 0.16, len, paint, s * rail, floor, 0);
    for (const z of [L / 2, -L / 2, 0]) box(body, T - 0.2, 0.1, 0.12, paint, 0, floor, z);
    for (const z of [len / 2, -len / 2]) box(body, T * 0.9, 0.16, 0.14, paint, 0, floor + 0.05, z);
    for (const s of [-1, 1]) { box(body, 0.2, 0.1, 0.04, M.light, s * T * 0.32, floor + 0.12, len / 2 + 0.08); box(body, 0.18, 0.1, 0.04, M.tail, s * T * 0.36, floor + 0.12, -len / 2 - 0.08); }
    // Cab: floor, two seats, the wheel; a roll bar behind
    const sx = Math.min(0.42, T / 2 - 0.35), seatZ = L * 0.16;
    box(body, T - 0.3, 0.04, 1.6, M.dark, 0, floor + 0.02, seatZ + 0.25);
    for (const s of [1, -1]) {
      box(body, 0.5, 0.1, 0.5, M.seat, s * sx, floor + 0.14, seatZ);
      box(body, 0.5, 0.64, 0.08, M.seat, s * sx, floor + 0.5, seatZ - 0.28).rotation.x = -0.18;
    }
    const col = new THREE.Group(); col.position.set(sx, floor + 0.66, seatZ + 0.5); col.rotation.x = -0.55; body.add(col);
    const sw = new THREE.Group(); col.add(sw);
    part(sw, new THREE.TorusGeometry(0.19, 0.024, 8, 22), M.dark, 0, 0, 0);
    box(sw, 0.36, 0.03, 0.02, M.dark, 0, 0, 0); box(sw, 0.03, 0.19, 0.02, M.dark, 0, -0.09, 0);
    box(col, 0.05, 0.05, 0.7, M.chrome, 0, 0, 0.36);
    const barZ = seatZ - 0.5, barH = 1.25;
    for (const s of [-1, 1]) box(body, 0.08, barH, 0.08, M.dark, s * (T / 2 - 0.12), floor + barH / 2, barZ);
    box(body, T - 0.16, 0.08, 0.08, M.dark, 0, floor + barH, barZ);
    // Bed: plank floor, low sides, a tailgate; a bench down each side
    const bz0 = -len / 2 + 0.1, bz1 = barZ - 0.1, bl = bz1 - bz0, bm = (bz0 + bz1) / 2, side = 0.4;
    box(body, T - 0.12, 0.05, bl, wood, 0, floor + 0.06, bm);
    for (const s of [-1, 1]) box(body, 0.06, side, bl, paint, s * (T / 2 - 0.03), floor + 0.06 + side / 2, bm);
    box(body, T - 0.12, side, 0.06, paint, 0, floor + 0.06 + side / 2, bz0);
    const bx = T / 2 - 0.36, rear = [];
    for (const s of [1, -1]) {
      box(body, 0.36, 0.08, bl - 0.1, wood, s * bx, floor + 0.42, bm);
      for (let k = 0; k < 3; k++) { const z = bz1 - 0.35 - k * (bl - 0.4) / 2.2; rear.push({ p: new V3(s * bx, floor + 0.46, z), eye: new V3(s * (bx - 0.15), floor + 1.25, z), yaw: s > 0 ? -Math.PI / 2 : Math.PI / 2 }); }
    }
    const wheels = [];
    for (const [x, z] of [[T / 2, L / 2], [-T / 2, L / 2], [T / 2, -L / 2], [-T / 2, -L / 2]]) wheels.push(wheel(g, r, Math.max(0.2, r * 0.6), x, r, z));
    return { g, body, wheels, steerN: 2, steerWheel: sw, seats: [
      { p: new V3(sx, floor + 0.2, seatZ), eye: new V3(sx, floor + 1.22, seatZ - 0.02), yaw: 0 },
      { p: new V3(-sx, floor + 0.2, seatZ), eye: new V3(-sx, floor + 1.22, seatZ - 0.02), yaw: 0 }, ...rear] };
  }
  function buildBike(v) {
    if (MODELS[v.key] && MODELS[v.key].bike) return buildBikeModel(v, MODELS[v.key]);
    const p = v.p, g = new THREE.Group(), body = new THREE.Group(), paint = mat(v.color), L = p.wheelbase, r = p.wheelR;
    g.add(body);
    const fork = new THREE.Group(); fork.position.set(0, r, L / 2); g.add(fork);
    const front = wheel(fork, r, 0.12, 0, 0, 0);
    box(fork, 0.06, 0.8, 0.06, M.chrome, 0, 0.42, -0.1).rotation.x = -0.35;
    box(fork, 0.72, 0.05, 0.05, M.dark, 0, 0.86, -0.24);
    const rear = wheel(g, r, 0.15, 0, r, -L / 2);
    box(body, 0.28, 0.3, L * 0.42, paint, 0, r + 0.5, L * 0.12); box(body, 0.24, 0.12, L * 0.42, M.seat, 0, r + 0.52, -L * 0.2);
    box(body, 0.2, 0.28, L * 0.6, M.dark, 0, r + 0.2, 0); box(body, 0.08, 0.08, L * 0.5, M.chrome, 0.16, r + 0.1, -L * 0.3);
    box(body, 0.12, 0.12, 0.04, M.light, 0, r + 0.5, L / 2 + 0.12);
    return { g, body, wheels: [front, rear], steerN: 0, fork, seats: [{ p: new V3(0, r + 0.55, -L * 0.15), eye: new V3(0, r + 1.25, -L * 0.18), yaw: 0 }] }; // one rider
  }
  function rebuild(v) {
    if (v.g) scene.remove(v.g);
    v.model = v.shell = v.wreckMesh = null;
    Object.assign(v, v.kind === 'bike' ? buildBike(v) : v.layout === 'truck' ? buildTruck(v) : buildCar(v));
    v.lamps = lampsOf(v);
    if (!v.occ || v.occ.length !== v.seats.length) v.occ = v.seats.map((_, k) => (v.occ && v.occ[k]) || null); // occ[k]: who's in seat k (0 is the driver's, kept in owner)
    if (v.hit) v.g.add(v.hit); // a shootable box, if the game gave it one
    if (v.dead) darken(v);
    scene.add(v.g); pose(v, 0);
  }
  // ---------------------------------------------------------------- headlights (?dev: items.js draws them as flashlights)
  // Each one: where it sits in the part it's fixed to (the body; a bike's on the fork, so it turns with the bars) and the way
  // it points there: straight ahead and a little down (LAMP_DIP). The Cargo Truck's two and the motorcycle's one are measured
  // off the models; a vehicle built from boxes has them at the front of its shape
  const LAMP_DIP = 0.12;
  function lampsOf(v) {
    const o = (v.kind === 'bike' && v.fork) || v.body || v.g, bike = v.kind === 'bike';
    v.g.updateMatrixWorld(true);
    const M = new THREE.Matrix4().copy(o.matrixWorld).invert().multiply(v.g.matrixWorld);
    let at;
    if (v.model && v.layout === 'truck') at = [[0.62, 1.76, 3.6], [-0.62, 1.76, 3.6]];
    else if (bike && MODELS[v.key] && MODELS[v.key].bike) at = [[0, 1.06, 0.68]];
    else if (bike) at = [[0, v.p.wheelR + 0.5, v.p.wheelbase / 2 + 0.15]];
    else {
      const b = new THREE.Box3(), gi = new THREE.Matrix4().copy(v.g.matrixWorld).invert(), bb = new THREE.Box3();
      v.g.traverse(m => { if (m.isMesh && m.geometry) { if (!m.geometry.boundingBox) m.geometry.computeBoundingBox(); b.union(bb.copy(m.geometry.boundingBox).applyMatrix4(new THREE.Matrix4().multiplyMatrices(gi, m.matrixWorld))); } });
      if (b.isEmpty()) return [];
      at = [1, -1].map(sd => [sd * (b.max.x - b.min.x) * 0.3, b.min.y + (b.max.y - b.min.y) * 0.3, b.max.z + 0.05]);
    }
    const d = new V3(0, -Math.sin(LAMP_DIP), Math.cos(LAMP_DIP)).transformDirection(M);
    return at.map(a => ({ o, p: new V3(a[0], a[1], a[2]).applyMatrix4(M), d: d.clone() }));
  }
  // The lit ones, in the world: [{ o: where, d: which way, v: the vehicle }]. They're on while someone (or a bot) drives, unless the driver
  // has put them out (L at the wheel)
  function lampBeams() {
    const out = [];
    for (const v of list) {
      if (v.dead || !v.lamp || !v.lamps || !(v.owner || v.npc || v.npcBusy)) continue;
      for (const l of v.lamps) { l.o.updateWorldMatrix(true, false); out.push({ o: l.p.clone().applyMatrix4(l.o.matrixWorld), d: l.d.clone().transformDirection(l.o.matrixWorld), v }); }
    }
    return out;
  }

  // Wrecked: a model swaps to its wreck (burnt darker, on its own wheels); anything else just goes dark
  function darken(v) {
    if (v.wreckMesh) { v.shell.visible = false; v.wreckMesh.visible = true; v.steerWheel.parent.visible = false; v.wheels.forEach(w => { w.piv.visible = false; }); }
    (v.wreckMesh || v.g).traverse(o => { if (o.isMesh && o.material.color && !o.userData.dark) { o.material = o.material.clone(); o.material.color.multiplyScalar(v.wreckMesh ? 0.55 : 0.25); o.userData.dark = true; } });
  }

  // ---------------------------------------------------------------- armour: the parts of a body bullets and eyes can't get through
  // The Cargo Truck as solid boxes in its own frame, [x0, x1, y0, y1, z0, z1] (x to the driver's side, y up, z forward). The cab
  // is solid below the window line, with a roof and pillars round the windshield and the two door windows, which are open. The
  // container is closed but for its open back. Underneath, the chassis down to just above the ground.
  const TRUCK_ARMOR = [ // (the windows measured off the model: sills at 2.42, tops at 2.78)
    [-0.95, 0.95, 0.75, 2.42, 0.74, 2.25], [-0.95, 0.95, 0.75, 2.2, 2.25, 2.95], // cab doors and dash; the hood
    [-0.95, 0.95, 2.78, 2.95, 0.74, 2.25], // cab roof
    [0.87, 0.95, 2.42, 2.78, 0.74, 1.37], [-0.95, -0.87, 2.42, 2.78, 0.74, 1.37], // door pillars behind the windows
    [0.87, 0.95, 2.42, 2.78, 2.05, 2.25], [-0.95, -0.87, 2.42, 2.78, 2.05, 2.25], // and in front of them
    [0.85, 0.95, 2.42, 2.78, 2.05, 2.25], [-0.95, -0.85, 2.42, 2.78, 2.05, 2.25], // either side of the windshield
    [1.08, 1.17, 1.47, 3.72, -3.31, 0.87], [-1.17, -1.08, 1.47, 3.72, -3.31, 0.87], // container sides
    [-1.17, 1.17, 3.64, 3.72, -3.31, 0.87], [-1.17, 1.17, 1.47, 3.72, 0.79, 0.87], // its roof and front wall
    [-1.14, 1.14, 0.6, 1.6, -3.17, 2.64], // the chassis and the container's floor
  ];
  const _ai = new THREE.Matrix4(), _ao = new V3(), _ad = new V3(), _an = new V3();
  // First armour along a ray within far: { t, n (the face's normal, world), v }, or null. A box the ray starts inside doesn't
  // count, so whoever sits in a seat shoots (and sees) out through the windows, and the open back.
  function armorRay(o, d, far) {
    let best = null;
    for (const v of list) {
      if (!v.model || v.layout !== 'truck') continue;
      const cx = v.pos.x - o.x, cy = v.pos.y + 2 - o.y, cz = v.pos.z - o.z, along = cx * d.x + cy * d.y + cz * d.z; // skip it unless the ray passes within 4.5 m of its middle
      if (along < -4.5 || along > far + 4.5 || cx * cx + cy * cy + cz * cz - along * along > 20.25) continue;
      if (!v.armM) continue; _ai.copy(v.armInv);
      _ao.copy(o).applyMatrix4(_ai); _ad.copy(d).transformDirection(_ai);
      for (const b of TRUCK_ARMOR) {
        let t0 = -Infinity, t1 = Infinity, ax = -1, inside = true;
        for (let a = 0; a < 3; a++) {
          const oa = a === 0 ? _ao.x : a === 1 ? _ao.y : _ao.z, da = a === 0 ? _ad.x : a === 1 ? _ad.y : _ad.z, lo = b[a * 2], hi = b[a * 2 + 1];
          if (oa < lo || oa > hi) inside = false;
          if (Math.abs(da) < 1e-9) { if (oa < lo || oa > hi) { t0 = Infinity; break; } continue; }
          let ta = (lo - oa) / da, tb = (hi - oa) / da; if (ta > tb) { const q = ta; ta = tb; tb = q; }
          if (ta > t0) { t0 = ta; ax = a; } if (tb < t1) t1 = tb;
        }
        if (inside || t0 > t1 || t0 < 0 || t0 >= far || (best && t0 >= best.t)) continue;
        const da = ax === 0 ? _ad.x : ax === 1 ? _ad.y : _ad.z;
        _an.set(0, 0, 0).setComponent(ax, da > 0 ? -1 : 1).transformDirection(v.armM);
        best = { t: t0, n: _an.clone(), v };
      }
    }
    return best;
  }

  const list = [];
  // The chase camera starts a little above and behind (CAM_PITCH, Austin's angle: 2026-11-03) and stays wherever the mouse leaves it
  const CAM_PITCH = 0.25;
  let cur = null, ride = null, rideSeat = 0, view = 'chase', camYaw = 0, camPitch = CAM_PITCH, lookIdle = 9, tuneOpen = false; // ride: the vehicle you're a passenger in, in seat rideSeat
  const driveMode = () => MODE === 'drive'; // Test Drive: no guns, third person on foot
  const camPos = new V3(), camLook = new V3();
  const me = () => (NET.role === 'guest' ? NET.myId : P.id);
  const simulated = v => v.owner === me() || (!v.owner && NET.role !== 'guest'); // the driver runs their own vehicle; the host runs parked ones

  function make(key, x, z, yaw) {
    const pr = PRESETS[key];
    const v = { i: list.length, key, kind: pr.kind, layout: pr.layout, name: pr.name, color: pr.color, p: defaults(key), home: [x, z, yaw], pos: new V3(), vel: new V3(), yaw, pitch: 0, roll: 0, lean: 0, vy: 0,
      pitchRate: 0, steer: 0, spin: 0, onGround: true, owner: null, net: null, npc: null, npcBusy: false, dead: false, susp: { h: 0, hv: 0, p: 0, pv: 0, r: 0, rv: 0 }, prevV: new V3(), prevYaw: yaw, speed: 0, slip: 0 };
    v.lamp = true; list.push(v); rebuild(v); place(v); return v;
  }
  function clearAll() { for (const v of list) scene.remove(v.g); list.length = 0; if (cur) soundStop(); cur = null; ride = null; setTune(false); }
  function spawnLot(lot) { clearAll(); for (const [key, x, z, yaw] of lot) make(key, x, z, yaw); }
  // Take vehicles out: anyone in them gets out first; the rest keep their order
  function removeVehicles(vs) {
    for (const v of vs) { if (v === cur) leave(true); if (v === ride) unride(true); scene.remove(v.g); }
    for (let k = list.length - 1; k >= 0; k--) if (vs.includes(list[k])) list.splice(k, 1);
    list.forEach((v, k) => { v.i = k; });
  }
  function place(v, x = v.home[0], z = v.home[1], yaw = v.home[2], y) {
    const g = y !== undefined ? y : groundAt(x, z, 50) || 0;
    v.pos.set(x, g, z); v.vel.set(0, 0, 0); v.yaw = yaw; v.pitch = v.roll = v.lean = v.vy = v.pitchRate = v.steer = 0; v.onGround = true; v.speed = v.slip = 0;
    pose(v, 0);
  }

  // R (or stuck in the scenery): the nearest flat, open, dry spot, searched in rings out from where the vehicle is, at about its
  // height or a little above. Flat: the ground under all four corners within a hand's width; open: nothing above the wheels
  // along the body (walls, ceilings, the hill itself) and no other vehicle; not under the hill, not in the sea.
  function clearAt(v, x, g, z, yaw) {
    const len = lenOf(v), mid = midOf(v), r = v.kind === 'bike' ? 0.4 : v.model ? v.model.half : Math.min(v.p.track / 2 + 0.1, 1.05), fx = Math.sin(yaw), fz = Math.cos(yaw);
    const n = Math.max(2, Math.ceil(len / (2 * r)) + 1), c = new V3();
    for (let i = 0; i < n; i++) {
      const sd = mid - len / 2 + r + (len - 2 * r) * i / (n - 1);
      for (const h of [0.6, 1.5]) {
        let hit = false; c.set(x + fx * sd, g + h, z + fz * sd);
        sphereTris(c, r, (t, q) => { if (q.y > g + 0.35) hit = true; });
        if (hit) return false;
      }
    }
    return !list.some(o => o !== v && Math.hypot(o.pos.x - x, o.pos.z - z) < lenOf(o) / 2 + len / 2 + 0.5);
  }
  const openSky = (x, z, g) => { let open = true; tgEach(x, z, x, z, t => { const y = triYAt(TG.T, t * 9, x, z); if (y !== null && y > g + 0.35) open = false; }); return open; };
  function flatSpot(v, x0 = v.pos.x, z0 = v.pos.z, y0 = v.pos.y) {
    const L = v.p.wheelbase / 2 + 0.2, W = (v.kind === 'bike' ? 0.3 : v.p.track) / 2 + 0.1, top = Math.max(y0, v.lastGround ? v.lastGround[1] : -Infinity) + 6;
    for (let r = 0; r <= 40; r += 1) {
      const n = r ? Math.ceil(2 * Math.PI * r / 1.2) : 1;
      for (let i = 0; i < n; i++) {
        const a = v.yaw + 2 * Math.PI * i / n, x = x0 + Math.sin(a) * r, z = z0 + Math.cos(a) * r, g = groundAt(x, z, top);
        if (g === null || g < waterAt(x, z) + 0.3 || !openSky(x, z, g)) continue; // (nothing overhead: not under a floor, the hill or a tree)
        for (const yaw of [v.yaw, v.yaw + Math.PI / 2, v.yaw + Math.PI, v.yaw - Math.PI / 2]) {
          const fx = Math.sin(yaw), fz = Math.cos(yaw), rx = -fz, rz = fx;
          const flat = [[1, 1], [1, -1], [-1, 1], [-1, -1]].every(([a1, b1]) => { const h = groundAt(x + fx * L * a1 + rx * W * b1, z + fz * L * a1 + rz * W * b1, g + 0.5); return h !== null && Math.abs(h - g) < 0.2; });
          if (flat && clearAt(v, x, g, z, yaw)) return [x, z, yaw, g];
        }
      }
    }
    return null;
  }
  // Back where it was parked at the start (or the nearest clear spot to it, if something's parked there now)
  function respawn(v) {
    const [x, z, yaw] = v.home, g = groundAt(x, z, 50);
    if (g !== null && clearAt(v, x, g, z, yaw)) return place(v);
    const s = flatSpot(v, x, z, g === null ? 50 : g); if (s) place(v, ...s); else place(v);
  }
  function unstick(v) { const s = flatSpot(v); if (s) place(v, ...s); else respawn(v); }

  // ---------------------------------------------------------------- driving
  const fwdOfYaw = y => [Math.sin(y), Math.cos(y)];
  // The surface under a wheel: any slope counts (people can't walk up steep hillsides, but a wheel still sits on one)
  // The island's ground (its hillsides and rock), as opposed to buildings: the outdoor ground material, or the fort's terrain meshes
  function terrain() {
    const G = TG; if (G.vterr) return G.vterr;
    const k = new Uint8Array(G.NR.length / 3);
    for (let t = 0; t < k.length; t++) { const m = G.meshes[G.MESH[t]]; k[t] = G.OUT[t] || (m && /^(Terrain|Fort_Rock)/.test(m.name)) ? 1 : 0; }
    return (G.vterr = k);
  }
  function hAt(x, z, top, fallback, reach = 0) { // reach: how much higher the island's ground (only) may be, for steep hillsides
    let best = null, above = null; const G = TG, TR = terrain();
    tgEach(x, z, x, z, t => { const y = triYAt(G.T, t * 9, x, z); if (y === null) return; if (y <= top + (TR[t] ? reach : 0)) { if (best === null || y > best) best = y; } else if (y <= top + 2.5 && (above === null || y < above)) above = y; });
    // A surface just above the wheel (a steep bank, or we've dipped into the ground) beats one far below it: Minimal has a sheet
    // down at the sea floor under everything, and picking that dropped trucks straight through the hillsides
    if (above !== null && (best === null || best < top - 2.5)) return above;
    return best !== null ? best : fallback;
  }
  function drive(v, dt, inp) {
    const p = v.p, top = p.top / 3.6, rev = p.rev / 3.6, G = p.gravity;
    let [fx, fz] = fwdOfYaw(v.yaw), vf = v.vel.x * fx + v.vel.z * fz;
    if (v.onGround) {
      const sMax = p.steer * Math.PI / 180 / (1 + Math.abs(vf) / (p.steerFall / 3.6));
      v.steer += (inp.steer * sMax - v.steer) * Math.min(1, dt * p.steerRate);
      let yr = vf * Math.tan(v.steer) / p.wheelbase;
      // The tyres only hold so much cornering force: the cornering limit, plus downforce growing with speed, plus a share of
      // gravity on banking (the track leans into the turn)
      const lat = (p.maxLat + p.downforce * (vf / 27.8) ** 2) * 9.8 + G * Math.abs(Math.sin(v.roll)) * 0.8;
      const cap = lat / Math.max(1, Math.abs(vf));
      v.steerVis = v.steer;
      if (inp.hand) yr *= 1.3; // on the handbrake the back steps out and the car swings round
      else if (Math.abs(yr) > cap) { // past the grip: the car turns only as hard as the tyres hold, and the wheels show that
        yr = Math.sign(yr) * cap; v.steerVis = Math.sign(v.steer) * Math.atan(cap * p.wheelbase / Math.max(0.5, Math.abs(vf)));
      }
      v.yaw -= yr * dt;
    } else { v.steer *= 1 - Math.min(1, dt * 3); v.steerVis = v.steer; }
    [fx, fz] = fwdOfYaw(v.yaw); const rx = -fz, rz = fx;
    vf = v.vel.x * fx + v.vel.z * fz; let vr = v.vel.x * rx + v.vel.z * rz;
    const touching = v.onGround || v.pos.y - (v.gcPrev === undefined ? -1e3 : v.gcPrev) < 0.3; // a hop over a bump still has the tyres on the ground
    if (touching) {
      const up = Math.sin(v.pitch) > 0; // (rolling back down a hill on the gas, the engine pulls as well as the brakes)
      if (inp.thr > 0 && !inp.hand) vf += (vf < -0.5 ? Math.max(p.brake, up ? p.power : 0) : p.power * Math.max(0, 1 - (vf / top) ** 2)) * inp.thr * dt; // the handbrake cuts the engine
      else if (inp.thr < 0) vf -= (vf > 0.5 ? p.brake : p.power * 0.5 * Math.max(0, 1 + vf / rev)) * -inp.thr * dt;
      const sl = G * Math.sin(v.pitch); // rolling up and down slopes and ramps (before the brakes, so a handbrake holds on a hill)
      vf -= (sl > 0 && inp.thr > 0 ? Math.min(sl, p.power * 0.75) : sl) * dt; // (on the gas, a climb never takes more than 3/4 of the engine: every vehicle gets up every hill)
      const res = (0.5 + (inp.hand ? p.hand : 0)) * dt; vf -= Math.sign(vf) * Math.min(Math.abs(vf), res);
      vr *= Math.exp(-(inp.hand ? p.slide : p.grip) * dt);
    }
    vf -= 0.0009 * vf * Math.abs(vf) * dt;
    v.vel.x = fx * vf + rx * vr; v.vel.z = fz * vf + rz * vr;
    v.pos.x += v.vel.x * dt; v.pos.z += v.vel.z * dt;
    v.slip = Math.max(Math.abs(vr), inp.hand && v.onGround && Math.abs(vf) > 2 ? 9 : 0); v.speed = vf; // locked wheels squeal too
    // Wheels follow the ground; off the end of a ramp you fly, and land on whatever is below
    const L = p.wheelbase / 2, W = (v.kind === 'bike' ? 0.3 : p.track) / 2, top2 = v.pos.y + 0.5, fb = v.pos.y - 3; // wheels climb ramps, banking and hills, never up a wall
    const rh = Math.max(L, W) * 2.2; // up the island's hillsides the wheels find ground as steep as ~65° (steeper is a cliff: hitWalls)
    const hf = Math.max(hAt(v.pos.x + fx * L + rx * W, v.pos.z + fz * L + rz * W, top2, fb, rh), hAt(v.pos.x + fx * L - rx * W, v.pos.z + fz * L - rz * W, top2, fb, rh));
    const hb = Math.max(hAt(v.pos.x - fx * L + rx * W, v.pos.z - fz * L + rz * W, top2, fb, rh), hAt(v.pos.x - fx * L - rx * W, v.pos.z - fz * L - rz * W, top2, fb, rh));
    const hr = Math.max(hAt(v.pos.x + rx * W + fx * L, v.pos.z + rz * W + fz * L, top2, fb, rh), hAt(v.pos.x + rx * W - fx * L, v.pos.z + rz * W - fz * L, top2, fb, rh));
    const hl = Math.max(hAt(v.pos.x - rx * W + fx * L, v.pos.z - rz * W + fz * L, top2, fb, rh), hAt(v.pos.x - rx * W - fx * L, v.pos.z - rz * W - fz * L, top2, fb, rh));
    const gc = Math.max((hf + hb) / 2, Math.min(hf, hb) + 0.02), pT = Math.atan2(hf - hb, 2 * L), rT = v.kind === 'bike' ? 0 : Math.atan2(hl - hr, 2 * W);
    if (v.onGround) {
      if (gc < v.pos.y - 0.6 || (v.vy > 3 && gc < v.pos.y + v.vy * dt - 0.12)) { v.onGround = false; v.pitchRate = Math.max(-1.5, Math.min(1.5, v.pitchRate)); } // off a ramp's lip, or a real drop (not every bump)
      else {
        const vy = (gc - v.pos.y) / Math.max(dt, 1e-3); v.vy += (Math.min(25, vy) - v.vy) * Math.min(1, dt * 20); v.pos.y = gc;
        const np = v.pitch + (pT - v.pitch) * Math.min(1, dt * 12); v.pitchRate = (np - v.pitch) / Math.max(dt, 1e-3); v.pitch = np;
        v.roll += (rT - v.roll) * Math.min(1, dt * 12);
      }
    }
    if (!v.onGround) {
      v.vy -= G * dt; v.pos.y += v.vy * dt;
      v.pitchRate += (-inp.thr * p.airPitch - v.pitchRate * 0.6) * dt; v.pitch = Math.max(-1.1, Math.min(1.1, v.pitch + v.pitchRate * dt));
      if (v.pos.y <= gc) {
        const hit = -v.vy; v.pos.y = gc; v.vy = 0; v.onGround = true; v.pitch += (pT - v.pitch) * 0.6;
        v.susp.hv -= Math.min(4, hit * 0.25) * p.travel; // the body dips on landing
        if (hit > 5) { if (v === cur) shake = Math.max(shake, Math.min(0.09, hit * 0.006)); v.vel.multiplyScalar(Math.max(0.75, 1 - hit * 0.012)); thud(v, hit); }
      }
    }
    v.gcPrev = gc;
    if (v.onGround) { v.safe = v.safe || {}; Object.assign(v.safe, { x: v.pos.x, z: v.pos.z, yaw: v.yaw }); v.lastGround = [+v.pos.x.toFixed(1), +v.pos.y.toFixed(1), +v.pos.z.toFixed(1)]; }
    if (v.kind === 'bike') { // lean into turns (what keeps a bike up); on the kickstand when stopped
      const yawRate = vf * Math.tan(v.steer) / p.wheelbase, want = Math.abs(vf) > 1.5 ? Math.atan(vf * yawRate / 9.8) * p.lean : 0.22;
      v.lean += (Math.max(-0.85, Math.min(0.85, want)) - v.lean) * Math.min(1, dt * 6);
      v.roll = v.lean;
    }
    if (inp.reset) unstick(v); // R: onto the nearest flat, open ground
  }
  // Suspension: the body (not the wheels) dives, squats, rolls and bounces on springs. It's for the feel and the look;
  // the grip doesn't depend on it. Runs for every vehicle, driven by how its speed and heading change.
  function suspension(v, dt) {
    if (dt <= 0) return;
    const p = v.p, s = v.susp, [fx, fz] = fwdOfYaw(v.yaw);
    const aL = ((v.vel.x - v.prevV.x) * fx + (v.vel.z - v.prevV.z) * fz) / dt;
    const yawRate = -((v.yaw - v.prevYaw + Math.PI * 3) % (Math.PI * 2) - Math.PI) / dt, aLat = (v.vel.x * fx + v.vel.z * fz) * yawRate;
    v.prevV.copy(v.vel); v.prevYaw = v.yaw;
    const soft = (2 / p.spring) ** 2 * p.travel, w = 2 * Math.PI * p.spring, z = p.damp;
    const tp = v.kind === 'bike' ? 0 : Math.max(-0.15, Math.min(0.15, Math.max(-25, Math.min(25, aL)) * 0.011 * soft));
    const tr = v.kind === 'bike' ? 0 : Math.max(-0.14, Math.min(0.14, -Math.max(-25, Math.min(25, aLat)) * 0.009 * soft));
    const n = Math.max(1, Math.ceil(dt * 240)), h = dt / n; // small fixed steps keep a stiff spring stable
    for (let i = 0; i < n; i++) {
      s.pv += (w * w * (tp - s.p) - 2 * z * w * s.pv) * h; s.p += s.pv * h;
      s.rv += (w * w * (tr - s.r) - 2 * z * w * s.rv) * h; s.r += s.rv * h;
      s.hv += (w * w * (0 - s.h) - 2 * z * w * s.hv) * h; s.h += s.hv * h;
    }
    if (![s.p, s.pv, s.r, s.rv, s.h, s.hv].every(Number.isFinite)) Object.assign(s, { h: 0, hv: 0, p: 0, pv: 0, r: 0, rv: 0 });
    // at the end of its travel the body stops (and stops moving)
    if (s.h < -0.25 || s.h > 0.15) { s.h = Math.max(-0.25, Math.min(0.15, s.h)); s.hv = 0; }
    if (Math.abs(s.p) > 0.25) { s.p = Math.sign(s.p) * 0.25; s.pv = 0; }
    if (Math.abs(s.r) > 0.25) { s.r = Math.sign(s.r) * 0.25; s.rv = 0; }
  }

  // ---------------------------------------------------------------- bumping into things
  const _f = new V3(), _r = new V3(), _c = new V3();
  function axes(v) { _f.set(Math.sin(v.yaw), 0, Math.cos(v.yaw)); _r.set(-Math.cos(v.yaw), 0, Math.sin(v.yaw)); }
  function spheres(v) { // the body as spheres along its length: [x, y, z, r]
    const p = v.p, len = lenOf(v), mid = midOf(v), r = v.kind === 'bike' ? 0.4 : v.model ? v.model.half : Math.min(p.track / 2 + 0.1, 1.05), n = Math.max(2, Math.ceil(len / (2 * r)) + 1), out = [];
    axes(v); const y = v.pos.y + 0.55;
    for (let i = 0; i < n; i++) { const s = mid - len / 2 + r + (len - 2 * r) * i / (n - 1); out.push([v.pos.x + _f.x * s, y, v.pos.z + _f.z * s, r]); }
    return out;
  }
  function hitWalls(v) {
    let worst = 0; const bounce = 1 + v.p.bounce, edge = TRK.R + TRK.W / 2, TR = terrain();
    for (const [x, y, z, r] of spheres(v)) {
      if (driveMode() && Math.abs(x) < TRK.door + 1.5 && z < edge + 1 && z + r > edge) { // the walkway to the stands is for people only
        const push = z + r - edge; v.pos.z -= push; if (v.vel.z > 0) { worst = Math.max(worst, v.vel.z); v.vel.z *= -v.p.bounce; }
      }
      _c.set(x, y, z);
      sphereTris(_c, r, (t, q, dist) => {
        if (TG.leaf && TG.leaf.tris.length && t >= TG.leaf.tris[0]) return; // the gate doors stop people, not cars (they squeeze through)
        const ny = Math.abs(TG.NR[t * 3 + 1]); if (ny >= FLOOR_NY || (TR[t] && ny >= 0.3)) return; // floors, and the island's hillsides short of a cliff, are the suspension's business
        if (q.y < v.pos.y + 0.45) return; // nor anything below the axles (a ramp's lip as you leave it)
        let nx = _c.x - q.x, nz = _c.z - q.z, l = Math.hypot(nx, nz); if (l < 1e-5) { nx = TG.NR[t * 3]; nz = TG.NR[t * 3 + 2]; l = Math.hypot(nx, nz) || 1; }
        nx /= l; nz /= l; const push = r - dist;
        v.pos.x += nx * push; v.pos.z += nz * push; _c.x += nx * push; _c.z += nz * push;
        const vn = v.vel.x * nx + v.vel.z * nz;
        if (vn < 0) { v.vel.x -= nx * vn * bounce; v.vel.z -= nz * vn * bounce; worst = Math.max(worst, -vn); }
      });
    }
    if (worst > 4) { if (v === cur) shake = Math.max(shake, Math.min(0.1, worst * 0.008)); thud(v, worst); v.susp.rv += (Math.random() - 0.5) * worst * 0.05 * v.p.travel; }
  }
  // Each machine moves only the vehicles it simulates; the other one's reported speed goes into the push
  function bumpVehicles() {
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j], sa = simulated(a), sb = simulated(b);
      if ((!sa && !sb) || a.pos.distanceTo(b.pos) > 14) continue;
      for (const [ax, ay, az, ar] of spheres(a)) for (const [bx, by, bz, br] of spheres(b)) {
        let nx = ax - bx, nz = az - bz; const d = Math.hypot(nx, nz); if (d >= ar + br || d < 1e-4 || Math.abs(ay - by) > 1.6) continue;
        nx /= d; nz /= d; const pen = ar + br - d, ma = a.p.mass, mb = b.p.mass, s = ma + mb;
        if (sa) { a.pos.x += nx * pen * mb / s; a.pos.z += nz * pen * mb / s; }
        if (sb) { b.pos.x -= nx * pen * ma / s; b.pos.z -= nz * pen * ma / s; }
        const vn = (a.vel.x - b.vel.x) * nx + (a.vel.z - b.vel.z) * nz;
        if (vn < 0) {
          const j2 = -1.3 * vn / (1 / ma + 1 / mb);
          if (sa) { a.vel.x += nx * j2 / ma; a.vel.z += nz * j2 / ma; a.susp.rv += j2 / ma * 0.06 * a.p.travel; }
          if (sb) { b.vel.x -= nx * j2 / mb; b.vel.z -= nz * j2 / mb; b.susp.rv -= j2 / mb * 0.06 * b.p.travel; }
          if (-vn > 4) { thud(a, -vn); if (a === cur || b === cur) shake = Math.max(shake, Math.min(0.12, -vn * 0.01)); }
        }
      }
    }
  }
  // A vehicle with someone at the wheel hurts whoever it hits at speed (the driver's kill); parked and NPC ones just shove
  function runOver(v) {
    const driver = v === cur ? P : ents.find(e => e.id === v.owner); if (!driver || !driver.alive) return;
    const now = performance.now();
    for (const e of ents) {
      if (e === driver || !e.alive || (e.vehHitT && now - e.vehHitT < 450) || v.occ.includes(e.id) || (e === P && ride === v)) continue;
      if (v.pos.distanceTo(e.pos) > 12) continue;
      for (const [x, y, z, r] of spheres(v)) {
        if (e.pos.y > y + r || e.pos.y + e.h < y - r - 0.3) continue;
        const dx = e.pos.x - x, dz = e.pos.z - z, d = Math.hypot(dx, dz); if (d >= r + R + 0.15 || d < 1e-4) continue;
        const sp = (v.vel.x * dx + v.vel.z * dz) / d; if (sp < 4) continue; // the vehicle's own speed toward them (blockBody has already shoved them clear, which would cancel a relative speed)
        e.vehHitT = now; damage(e, Math.max(1, Math.round(Math.min(300, (sp - 2) * 14 * (v.layout === 'truck' || v.p.mass > 2500 ? 2.5 : 1)) * maxHp(e) / HP)), driver, 'car', false); break; // trucks hit much harder
      }
    }
  }
  // People on foot can't walk through vehicles, and a moving one knocks you aside
  function blockBody(e) {
    if (!list.length || (e === P && cur)) return;
    for (const v of list) {
      if (v.pos.distanceTo(e.pos) > 12) continue;
      for (const [x, y, z, r] of spheres(v)) {
        if (e.pos.y > y + r || e.pos.y + e.h < y - r - 0.3) continue;
        let nx = e.pos.x - x, nz = e.pos.z - z; const d = Math.hypot(nx, nz), min = r + R; if (d >= min || d < 1e-4) continue;
        nx /= d; nz /= d; e.pos.x += nx * (min - d); e.pos.z += nz * (min - d);
        const vn = e.vel.x * nx + e.vel.z * nz; if (vn < 0) { e.vel.x -= nx * vn; e.vel.z -= nz * vn; }
        const sp = v.vel.x * -nx + v.vel.z * -nz; if (sp > 3) { e.vel.x += nx * sp; e.vel.z += nz * sp; e.vel.y = Math.max(e.vel.y, sp * 0.4); }
      }
    }
  }

  // ---------------------------------------------------------------- drawing
  // The body's world matrix (and its inverse) for this frame, worked out straight away rather than at the next render: shots
  // and sight lines test against it
  function bodyMatrix(v) {
    v.armM = v.armM || new THREE.Matrix4(); v.armInv = v.armInv || new THREE.Matrix4();
    v.g.updateMatrix(); v.body.updateMatrix(); v.armM.multiplyMatrices(v.g.matrix, v.body.matrix); v.armInv.copy(v.armM).invert();
  }
  function pose(v, dt) {
    v.g.position.copy(v.pos); v.g.rotation.set(-v.pitch, v.yaw, v.roll, 'YXZ');
    const s = v.susp; v.body.position.y = s.h; v.body.rotation.set(-s.p, 0, s.r);
    v.spin += (v.speed || 0) / v.p.wheelR * dt;
    const sv = v.steerVis === undefined ? v.steer : v.steerVis;
    v.wheels.forEach((w, i) => { w.spin.rotation.x = v.spin; if (i < v.steerN) w.piv.rotation.y = -sv; });
    if (v.fork) v.fork.rotation.y = -sv;
    if (v.steerWheel) v.steerWheel.rotation.z = sv * 9;
  }
  // Someone else's vehicle: glide toward the latest reported state (extrapolated a little by its speed)
  function follow(v, dt) {
    const n = v.net; if (!n) return;
    const age = Math.min(0.25, (performance.now() - n.t) / 1000), k = Math.min(1, dt * 12);
    v.pos.lerp(_c.set(n.x + n.vx * age, n.y + n.vy * age, n.z + n.vz * age), k);
    v.vel.set(n.vx, n.vy, n.vz);
    v.yaw += ((n.yaw - v.yaw + Math.PI * 3) % (Math.PI * 2) - Math.PI) * k;
    v.pitch += (n.pitch - v.pitch) * k; v.roll += (n.roll - v.roll) * k; v.lean = v.roll; v.steer += (n.steer - v.steer) * k; v.steerVis = v.steer;
    const [fx, fz] = fwdOfYaw(v.yaw); v.speed = v.vel.x * fx + v.vel.z * fz;
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
    Object.assign(S, { on: true, o, o2, gn, n, ng, v });
  }
  function soundStop() { if (!S.on) return; try { S.o.stop(); S.o2.stop(); S.n.stop(); } catch (e) {} S.on = false; }
  function soundTick() {
    if (!S.on || !AC) return; const v = S.v, t = AC.currentTime;
    if (!isFinite(v.speed) || !isFinite(v.slip)) return;
    const base = v.kind === 'bike' ? [70, 150, 14] : v.p.mass > 2500 ? [38, 60, 9] : [55, 95, 12];
    const sp = Math.abs(v.speed), gear = Math.min(5, Math.floor(sp / base[2])), frac = (sp - gear * base[2]) / base[2];
    const fr = base[0] + (gear ? 0.35 : 0) * base[1] + frac * base[1] * 0.65 + (keys.KeyW ? 6 : 0);
    S.o.frequency.setTargetAtTime(fr, t, 0.05); S.o2.frequency.setTargetAtTime(fr * 0.5, t, 0.05);
    S.gn.gain.setTargetAtTime(0.055 + (keys.KeyW ? 0.03 : 0), t, 0.08);
    S.ng.gain.setTargetAtTime(v.onGround ? Math.min(0.12, Math.max(0, (v.slip - 3) / 40)) : 0, t, 0.05);
  }
  function thud(v, hit) { if (AC && hit > 4) sBoom(vol(v.pos, 60) * Math.min(0.5, hit / 40)); }

  // ---------------------------------------------------------------- getting in and out
  function nearest() { // within reach of any part of the body, and not someone else's
    let best = null, bd = 1.6;
    for (const v of list) {
      if (Math.abs(v.pos.y - P.pos.y) > 3 || v.pos.distanceTo(P.pos) > 14) continue;
      for (const [x, , z, r] of spheres(v)) { const d = Math.hypot(x - P.pos.x, z - P.pos.z) - r; if (d < bd) { bd = d; best = v; } }
    }
    return best;
  }
  // Where you're standing picks the seat: the left side is the driver's, the right side rides along, the back climbs in
  function zoneOf(v) {
    if (v.seats.length < 2) return 'driver';
    if (v.kind === 'bike') { axes(v); const lz = (P.pos.x - v.pos.x) * _f.x + (P.pos.z - v.pos.z) * _f.z; return (v.owner && v.owner !== me()) || lz < -0.5 ? 'passenger' : 'driver'; } // a bike: the back seat from behind, or once someone's riding it
    axes(v); const dx = P.pos.x - v.pos.x, dz = P.pos.z - v.pos.z, lz = dx * _f.x + dz * _f.z, lx = dx * _r.x + dz * _r.z;
    if (v.seats.length > 2 && lz < midOf(v) - lenOf(v) / 2 + 1.0) return 'rear';
    return lx > 0.2 ? 'passenger' : 'driver';
  }
  // The back fills from the tailgate in: the first one aboard sits at the open end, where they can see out and shoot
const freeRear = v => { let best = -1; for (let k = 2; k < v.seats.length; k++) if (!v.occ[k] && !v.seats[k].blocked && (best < 0 || v.seats[k].p.z < v.seats[best].p.z)) best = k; return best; };
  // What pressing E here would do: [text, action or null]
  function offer(v) {
    const n = v.name.toLowerCase();
    if (v.dead) return [`The ${n} is wrecked`, null];
    if (v.npcBusy) return [`Wait for the ${n} to park`, null];
    const z = zoneOf(v);
    if (z === 'rear') { const k = freeRear(v); return k > 0 ? [`E  Climb in the back of the ${n}`, () => rideAlong(v, k)] : [`The back of the ${n} is full`, null]; }
    if (z === 'passenger') return !v.occ[1] ? [`E  ${v.kind === 'bike' ? 'Ride on the back of' : 'Ride along in'} the ${n}`, () => rideAlong(v, 1)] : [`The passenger seat is taken`, null];
    if (v.owner && v.owner !== me()) return v.seats.length > 1 ? [`Someone is driving: go round to the other side to ride along`, null] : [`Someone is riding the ${n}`, null];
    return [`E  ${v.kind === 'bike' ? 'Ride' : 'Drive'} the ${n}`, () => enter(v)];
  }
  function use(v) { const [text, act] = offer(v); if (act) act(); else note(text, 1.5); }
  function rideAlong(v, k) {
    ride = v; rideSeat = k; v.occ[k] = me(); view = driveMode() ? 'chase' : 'seat'; camYaw = 0; camPitch = view === 'chase' ? CAM_PITCH : 0; lookIdle = 9; // in the fort you ride in your seat, ready to shoot
    camPos.copy(camera.position); camLook.copy(v.pos);
    if (NET.role === 'guest' && NET.conn && NET.conn.open) NET.conn.send({ t: 'vride', i: v.i, s: k });
    note(`${k > 1 ? 'In the back of' : 'Riding along in'} the ${v.name.toLowerCase()}. V changes view, E gets out`, 3);
  }
  // Out beside your seat: the driver on the left, the front passenger on the right, the back over the tailgate
  function spotFor(v, k) {
    axes(v);
    const side = (v.kind === 'bike' ? 0.4 : v.model ? v.model.half : v.p.track / 2) + 0.7, back = lenOf(v) / 2 - midOf(v) + 0.8;
    const tries = k > 1 ? [[0, -back], [-side, -back + 1], [side, -back + 1]] : k === 1 ? [[side, 0], [-side, 0]] : [[-side, 0], [side, 0]];
    for (const [sr, sf] of tries) { // sr: toward the driver's right, sf: forward
      const x = v.pos.x + _r.x * sr + _f.x * sf, z = v.pos.z + _r.z * sr + _f.z * sf, g = groundAt(x, z, v.pos.y + 2);
      if (g !== null && !meshBlocked(x, g + 0.05, z, STAND_H)) return new V3(x, g, z);
    }
    return new V3(v.pos.x, v.pos.y + 1.5, v.pos.z);
  }
  function unride(force) {
    const v = ride; if (!v) return false;
    if (Math.hypot(v.vel.x, v.vel.z) > 9 && !force) { note('Wait till it slows down to get out', 1.5); return false; }
    const spot = spotFor(v, rideSeat);
    P.pos.copy(spot); P.vel.set(0, 0, 0); P.yaw = Math.atan2(-_f.x, -_f.z); P.pitch = -0.1; P.viewY = spot.y + 1.6;
    if (v.occ[rideSeat] === me()) v.occ[rideSeat] = null;
    if (NET.role === 'guest' && NET.conn && NET.conn.open) NET.conn.send({ t: 'vunride', i: v.i, s: rideSeat });
    ride = null;
    return true;
  }
  function enter(v) {
    if (v.owner && v.owner !== me()) { note(`Someone is already in the ${v.name.toLowerCase()}`, 1.5); return; }
    v.owner = me(); v.net = null; v.npc = null; cur = v; view = 'chase'; camYaw = 0; camPitch = CAM_PITCH; lookIdle = 9; lapReset();
    camPos.copy(camera.position); camLook.copy(v.pos);
    if (NET.role === 'guest' && NET.conn && NET.conn.open) NET.conn.send({ t: 'vreq', i: v.i });
    soundStart(v);
    if (driveMode()) hint('tune', 'Tab tunes this vehicle: acceleration, brakes, steering, weight, suspension and more', 5);
    note(`${v.name}: W/S drive, A/D steer, Space handbrake, R puts you back on your wheels. V changes view, E gets out`, 4);
  }
  function leave(force) {
    const v = cur; if (!v) return false;
    if (Math.hypot(v.vel.x, v.vel.z) > 9 && !force && v.onGround) { note('Slow down to get out', 1.5); return false; }
    const spot = spotFor(v, 0);
    P.pos.copy(spot); P.vel.set(v.vel.x * 0.5, 0, v.vel.z * 0.5);
    P.yaw = Math.atan2(-_f.x, -_f.z); P.pitch = -0.1; P.viewY = spot.y + 1.6;
    cur = null; v.owner = null; setTune(false); soundStop();
    if (NET.role === 'guest' && NET.conn && NET.conn.open) NET.conn.send({ t: 'vfree', i: v.i, s: stateOf(v) });
    return true;
  }

  // ---------------------------------------------------------------- lap times (start line at x = 0 on the front straight, raced toward -x)
  const LAP = { start: 0, half: false, last: null, best: null, prevX: 0, prevZ: 0, on: false };
  function lapReset() { Object.assign(LAP, { on: false, half: false, last: null }); }
  function lapTick(v) {
    const x = v.pos.x, z = v.pos.z, now = performance.now();
    if (LAP.prevX > 0 && x <= 0 && z < -TRK.R + TRK.W / 2 && v.vel.x < 0) { // crossing the line on the front straight, racing the right way
      if (LAP.on && LAP.half && now - LAP.start > 8000) { LAP.last = (now - LAP.start) / 1000; if (!LAP.best || LAP.last < LAP.best) LAP.best = LAP.last; note(`Lap ${LAP.last.toFixed(2)} s${LAP.last === LAP.best ? ' (best)' : ''}`, 2.5); }
      LAP.on = true; LAP.half = false; LAP.start = now;
    }
    if (LAP.prevX < 0 && x >= 0 && z > TRK.R - TRK.W / 2 && v.vel.x > 0) LAP.half = true; // halfway, on the back straight
    LAP.prevX = x; LAP.prevZ = z;
  }

  // ---------------------------------------------------------------- the stadium
  function canvasTex(draw, size = 256) {
    const c = document.createElement('canvas'); c.width = c.height = size; draw(c.getContext('2d'), size);
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; return t;
  }
  function speckle(base, spots, n) { return canvasTex((g, s) => { g.fillStyle = base; g.fillRect(0, 0, s, s); for (let i = 0; i < n; i++) { g.fillStyle = spots[i % spots.length]; const r = 1 + Math.random() * 1.5; g.fillRect(Math.random() * s, Math.random() * s, r, r); } }); }
  // Quads into one geometry: q(a, b, c, d) with corners counter-clockwise seen from the side that should show
  function Geo() {
    const pos = [], uv = [];
    return {
      q(a, b, c, d, scale = 4, uvf) {
        for (const p of [a, b, c, a, c, d]) { pos.push(p[0], p[1], p[2]); const t = uvf ? uvf(p) : [(p[0] + p[2]) / scale, p[1] / scale]; uv.push(t[0], t[1]); }
      },
      mesh(m, shadow = true) {
        const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.computeVertexNormals();
        const o = new THREE.Mesh(g, m); o.castShadow = shadow; o.receiveShadow = true; return o;
      },
    };
  }
  function buildStadium() {
    const draw = new THREE.Group(), col = new THREE.Group(), cm = new THREE.MeshBasicMaterial();
    const both = (o) => { draw.add(o); const c = new THREE.Mesh(o.geometry, cm); c.position.copy(o.position); c.rotation.copy(o.rotation); col.add(c); };
    const grass = toonMat({ map: speckle('#5f7a3c', ['#5a7439', '#64803f', '#587237', '#68843f'], 9000) });
    const asphalt = toonMat({ map: speckle('#3b3d40', ['#34363a', '#44474b', '#2e3033'], 6000) });
    const concrete = toonMat({ map: speckle('#a3a19a', ['#9a9891', '#acaaa3', '#93918b'], 5000) });
    const paint = toonMat({ color: 0xece8dc }), red = toonMat({ color: 0xc8302f }), fenceM = toonMat({ color: 0x5d646b });
    const decal = (w, d, m, x, y, z, ry = 0, rep = 0) => { const geo = new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2); if (rep) { const uv = geo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / rep, uv.getY(i) * d / rep); } const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.rotation.y = ry; o.receiveShadow = true; draw.add(o); return o; };
    // Ground (infield and everything outside the wall)
    const ground = new THREE.PlaneGeometry(420, 320).rotateX(-Math.PI / 2); { const uv = ground.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 42, uv.getY(i) * 32); }
    const gm = new THREE.Mesh(ground, grass); gm.receiveShadow = true; both(gm);
    // Track surface, banked through the turns, plus the walls along both edges
    const N = 240, half = TRK.W / 2, track = Geo(), wallI = Geo(), wallO = Geo(), fence = Geo(), doorEnds = [];
    const pts = []; for (let k = 0; k <= N; k++) { const s = TRK.len * k / N, c = lap(s); pts.push({ s, ...c, hi: bankH(c.b, -half), ho: bankH(c.b, half) }); }
    for (let k = 0; k < N; k++) {
      const a = pts[k], b = pts[k + 1];
      const ai = [a.x - a.nx * half, a.hi, a.z - a.nz * half], ao = [a.x + a.nx * half, a.ho, a.z + a.nz * half];
      const bi = [b.x - b.nx * half, b.hi, b.z - b.nz * half], bo = [b.x + b.nx * half, b.ho, b.z + b.nz * half];
      track.q(ai, ao, bo, bi, 0, p => [p[0] / 6, p[2] / 6]); // faces up (inner, outer, next outer, next inner, going round to the left)
      // Outer wall: concrete on the track side, up to the catch fence; its back drops to the ground outside.
      // A walkway through it on the back straight leads to the grandstands (people only: vehicles are held back in hitWalls)
      const mid = (a.x + b.x) / 2, front = a.z < -TRK.R + 1 && b.z < -TRK.R + 1, door = a.z > TRK.R - 1 && b.z > TRK.R - 1 && Math.abs(mid) < TRK.door;
      const t = TRK.wallOut, ao2 = [ao[0] + a.nx * 0.5, ao[1], ao[2] + a.nz * 0.5], bo2 = [bo[0] + b.nx * 0.5, bo[1], bo[2] + b.nz * 0.5];
      if (!door) {
        wallO.q([ao[0], ao[1] - 0.3, ao[2]], [bo[0], bo[1] - 0.3, bo[2]], [bo[0], bo[1] + t, bo[2]], [ao[0], ao[1] + t, ao[2]]);
        wallO.q([ao[0], ao[1] + t, ao[2]], [bo[0], bo[1] + t, bo[2]], [bo2[0], bo2[1] + t, bo2[2]], [ao2[0], ao2[1] + t, ao2[2]]);
        wallO.q([ao2[0], ao2[1] + t, ao2[2]], [bo2[0], bo2[1] + t, bo2[2]], [bo2[0], 0, bo2[2]], [ao2[0], 0, ao2[2]]);
        fence.q([ao[0], ao[1] + t, ao[2]], [bo[0], bo[1] + t, bo[2]], [bo[0], bo[1] + TRK.fence, bo[2]], [ao[0], ao[1] + TRK.fence, ao[2]]);
      } else doorEnds.push(ao, bo);
      // Inner wall, with a gap on the front straight onto the infield
      if (!(front && Math.abs(mid) < TRK.gap)) {
        const h = TRK.wallIn, ai2 = [ai[0] - a.nx * 0.5, ai[1], ai[2] - a.nz * 0.5], bi2 = [bi[0] - b.nx * 0.5, bi[1], bi[2] - b.nz * 0.5];
        wallI.q([bi[0], bi[1] - 0.3, bi[2]], [ai[0], ai[1] - 0.3, ai[2]], [ai[0], ai[1] + h, ai[2]], [bi[0], bi[1] + h, bi[2]]);
        wallI.q([bi[0], bi[1] + h, bi[2]], [ai[0], ai[1] + h, ai[2]], [ai2[0], ai2[1] + h, ai2[2]], [bi2[0], bi2[1] + h, bi2[2]]);
        wallI.q([bi2[0], bi2[1] + h, bi2[2]], [ai2[0], ai2[1] + h, ai2[2]], [ai2[0], -0.3, ai2[2]], [bi2[0], -0.3, bi2[2]]);
      }
    }
    const wallM = toonMat({ map: concrete.map, side: THREE.DoubleSide }); // walls show from both faces
    both(track.mesh(asphalt, false)); both(wallI.mesh(wallM)); both(wallO.mesh(wallM));
    col.add(new THREE.Mesh(fence.mesh(cm).geometry, cm)); // the catch fence stops cars; drawn below as posts and cables
    for (let k = 0; k < N; k += 4) { const a = pts[k], x = a.x + a.nx * half, z = a.z + a.nz * half; const o = new THREE.Mesh(new THREE.BoxGeometry(0.12, TRK.fence - TRK.wallOut, 0.12), fenceM); o.position.set(x, a.ho + (TRK.fence + TRK.wallOut) / 2, z); draw.add(o); }
    for (const hgt of [2.6, 3.8, 5.0, 5.9]) {
      const cable = Geo();
      for (let k = 0; k < N; k++) { const a = pts[k], b = pts[k + 1]; if (a.z > TRK.R - 1 && Math.abs((a.x + b.x) / 2) < TRK.door) continue; const A = [a.x + a.nx * half, a.ho + hgt, a.z + a.nz * half], B = [b.x + b.nx * half, b.ho + hgt, b.z + b.nz * half]; cable.q(A, B, [B[0], B[1] + 0.04, B[2]], [A[0], A[1] + 0.04, A[2]]); }
      const cm2 = cable.mesh(fenceM, false); cm2.material = toonMat({ color: 0x5d646b, side: THREE.DoubleSide }); draw.add(cm2);
    }
    // The walkway's ends: concrete posts to the top of the fence
    if (doorEnds.length) {
      const xs = doorEnds.map(q => q[0]), z = doorEnds[0][2];
      for (const x of [Math.min(...xs), Math.max(...xs)]) { const o = new THREE.Mesh(new THREE.BoxGeometry(0.5, TRK.fence + 0.3, 0.6), wallM); o.position.set(x, (TRK.fence - 0.3) / 2, z + 0.25); o.castShadow = o.receiveShadow = true; both(o); }
    }
    // Start and finish line, and the lane stripes
    for (let k = 0; k < 8; k++) for (let j = 0; j < 2; j++) decal(0.8, TRK.W / 8, (k + j) % 2 ? paint : toonMat({ color: 0x1a1a1a }), 0.4 - j * 0.8, 0.03, -TRK.R - TRK.W / 2 + TRK.W / 16 + k * TRK.W / 8);
    for (const z of [-TRK.R, TRK.R]) for (let x = -TRK.half + 6; x < TRK.half - 6; x += 10) decal(5, 0.25, paint, x, 0.03, z);
    // Ramps: on the back straight one on the inside lane and one on the outside, and one on the outside of the front straight
    const ramp = (x, z, ry, len, wid, rise) => {
      const g = new THREE.BufferGeometry(), hw = wid / 2;
      const v = [[-hw, 0, 0], [hw, 0, 0], [hw, 0, len], [-hw, 0, len], [hw, rise, len], [-hw, rise, len]];
      const f = [[0, 1, 2, 3], [3, 2, 4, 5], [0, 5, 4, 1], [1, 4, 2], [0, 3, 5]];
      const pos = [], uv = [];
      for (const q of f) { const tri = q.length === 4 ? [[q[0], q[1], q[2]], [q[0], q[2], q[3]]] : [q]; for (const t of tri) for (const k of t) { pos.push(...v[k]); uv.push(v[k][0] / 2, (v[k][2] + v[k][1]) / 2); } }
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.computeVertexNormals();
      const o = new THREE.Mesh(g, toonMat({ map: speckle('#c9b04a', ['#bfa543', '#d3ba52', '#b39b3d'], 3000) })); o.position.set(x, 0.02, z); o.rotation.y = ry; o.castShadow = o.receiveShadow = true; both(o);
      for (const s of [-1, 1]) { const st = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.02, len), red); st.position.set(s * (hw - 0.1), 0, len / 2); st.rotation.x = -Math.atan2(rise, len); st.position.y = rise / 2 + 0.01; o.add(st); }
    };
    ramp(-26, TRK.R - 4.2, Math.PI / 2, 10, 5.4, 1.5); ramp(14, TRK.R + 4.2, Math.PI / 2, 12, 5.4, 2.0); ramp(26, -TRK.R - 4.2, -Math.PI / 2, 11, 5.4, 1.7); // a clear 3 m lane down the middle
    // Infield: the parking lot
    decal(66, 30, asphalt, -2, 0.015, 0, 0, 6);
    for (let x = -29.5; x <= 24.5; x += 9) decal(0.18, 6, paint, x, 0.025, -6);
    for (let x = -9.5; x <= 4.5; x += 5) decal(0.18, 4, paint, x, 0.025, 6);
    decal(TRK.gap * 2 - 2, 14, asphalt, 0, 0.016, -TRK.R + 9, 0, 6); // the lane out to the track
    // Grandstand behind the back straight, through the walkway: rows low enough to climb (each a step up), seats on each row
    const seat = [toonMat({ color: 0x3a6fd0 }), toonMat({ color: 0xc8302f }), toonMat({ color: 0xe3c02c })], conc = toonMat({ color: 0x9a978f });
    const rowH = 0.45, rowD = 0.8, z0 = TRK.R + half + 3, rows = 12;
    for (let k = 0; k < rows; k++) {
      const o = new THREE.Mesh(new THREE.BoxGeometry(110, rowH * (k + 1), rowD), conc); o.position.set(0, rowH * (k + 1) / 2, z0 + rowD * (k + 0.5)); o.castShadow = o.receiveShadow = true; both(o);
      for (const [x0, x1, m] of [[-54, -2, seat[k % 3]], [2, 54, seat[(k + 1) % 3]]]) { const b = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 0.12, 0.35), m); b.position.set((x0 + x1) / 2, rowH * (k + 1) + 0.06, z0 + rowD * (k + 0.75)); b.receiveShadow = true; draw.add(b); }
    }
    { const back = new THREE.Mesh(new THREE.BoxGeometry(110, rowH * rows + 1.6, 0.4), conc); back.position.set(0, (rowH * rows + 1.6) / 2, z0 + rowD * rows + 0.2); back.castShadow = back.receiveShadow = true; both(back); }
    for (const x of [-55.2, 55.2]) { const o = new THREE.Mesh(new THREE.BoxGeometry(0.4, rowH * rows + 1.6, rowD * rows + 0.4), conc); o.position.set(x, (rowH * rows + 1.6) / 2, z0 + rowD * rows / 2); o.castShadow = o.receiveShadow = true; both(o); }
    // Invisible walls round the outside, so nobody walks off the edge of the world
    for (const [w, d, x, z] of [[300, 1, 0, -100], [300, 1, 0, 100], [1, 200, -150, 0], [1, 200, 150, 0]]) { const o = new THREE.Mesh(new THREE.BoxGeometry(w, 6, d), cm); o.position.set(x, 3, z); col.add(o); }
    for (const [x, z] of [[-90, -70], [90, -70], [-90, 70], [90, 70], [0, -75]]) {
      const pole = new THREE.Mesh(new THREE.BoxGeometry(0.6, 26, 0.6), conc); pole.position.set(x, 13, z); draw.add(pole);
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(5, 2.2, 0.8), toonMat({ color: 0xf2efe2 })); lamp.position.set(x, 26, z); lamp.lookAt(0, 0, 0); draw.add(lamp);
    }
    draw.updateMatrixWorld(true); col.updateMatrixWorld(true);
    LEVEL_SCENES.DriveFlat = draw; LEVEL_SCENES.DriveFlat_col = col;
  }
  buildStadium();

  // ---------------------------------------------------------------- HUD and the tuning panel
  const css = document.createElement('style');
  css.textContent = `
  #vhud{position:fixed;right:18px;bottom:18px;z-index:6;color:#eef3ea;font:600 15px/1.35 system-ui,sans-serif;text-align:right;text-shadow:0 1px 4px #000;pointer-events:none;display:none}
  #vhud b{font-size:30px}
  #vprompt{position:fixed;left:50%;top:62%;transform:translateX(-50%);z-index:6;color:#fff;font:600 16px system-ui,sans-serif;text-shadow:0 1px 5px #000;pointer-events:none;display:none}
  #vtune{position:fixed;top:0;right:0;bottom:0;width:min(360px,100vw);z-index:40;background:rgba(18,22,27,.94);color:#e8ece6;font:14px/1.35 system-ui,sans-serif;overflow-y:auto;padding:16px 16px 24px;box-sizing:border-box;display:none;border-left:1px solid #2f3742}
  #vtune h2{margin:0 0 2px;font-size:20px}#vtune .sub{color:#9aa5b1;margin:0 0 10px;font-size:13px}
  #vtune h3{margin:16px 0 6px;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#f0874d}
  #vtune .row{display:grid;grid-template-columns:1fr auto;gap:2px 8px;margin:7px 0}
  #vtune .row label{font-size:13px}#vtune .row output{font:600 13px ui-monospace,Menlo,monospace;color:#fff}
  #vtune input[type=range]{grid-column:1/-1;width:100%;accent-color:#f0874d}
  #vtune .help{grid-column:1/-1;color:#8b96a2;font-size:12px}
  #vtune .btns{display:flex;flex-wrap:wrap;gap:6px;margin-top:16px}
  #vtune button{flex:1 1 auto;padding:8px 10px;border-radius:4px;border:1px solid #3a4450;background:#232a33;color:#e8ece6;font:600 13px system-ui,sans-serif;cursor:pointer}
  #vtune button.go{background:#f0874d;color:#1a1208;border-color:#f0874d}
  #vtune .info{color:#9aa5b1;font-size:12px;margin-top:10px}`;
  document.head.append(css);
  const hud = document.createElement('div'); hud.id = 'vhud';
  const prompt = document.createElement('div'); prompt.id = 'vprompt';
  const panel = document.createElement('div'); panel.id = 'vtune';
  document.body.append(hud, prompt, panel);
  const fmt = (n, step) => (step >= 1 ? Math.round(n) : step >= 0.1 ? n.toFixed(1) : n.toFixed(2));
  function buildPanel() {
    const v = cur; if (!v) return;
    let html = `<h2>Tune: ${v.name}</h2><p class="sub">Changes take effect as you drag. Only this ${v.kind === 'bike' ? 'bike' : 'car'} changes, for everyone in the game.</p>`;
    let sec = '';
    for (const [k, label, min, max, step, unit, kinds, section] of TUNE) {
      if (kinds !== 'all' && kinds !== v.kind) continue;
      if (section !== sec) { html += `<h3>${section}</h3>`; sec = section; }
      html += `<div class="row"><label for="vt-${k}">${label}</label><output id="vo-${k}">${shown(v.p[k], step, unit)}</output>
        <input type="range" id="vt-${k}" data-k="${k}" min="${min}" max="${max}" step="${step}" value="${v.p[k]}">${HELP[k] ? `<div class="help">${HELP[k]}</div>` : ''}</div>`;
      if (k === 'downforce') html += `<div class="help" id="vturn" style="color:#cfd6dd"></div>`;
    }
    html += `<div class="btns"><button type="button" class="go" id="vt-go">Drive (Tab)</button><button type="button" id="vt-reset">Reset to ${v.name} defaults</button>
      <button type="button" id="vt-all">Use these on every ${v.kind === 'bike' ? 'bike' : 'car'}</button><button type="button" id="vt-copy">Copy settings</button></div>
      <p class="info">Copy settings puts the numbers on your clipboard, to paste to Claude or a friend.</p>`;
    panel.innerHTML = html; turnInfo();
    panel.querySelectorAll('input[type=range]').forEach(el => el.oninput = () => {
      const k = el.dataset.k, row = TUNE.find(t => t[0] === k); cur.p[k] = +el.value;
      panel.querySelector('#vo-' + k).textContent = shown(cur.p[k], row[4], row[5]);
      if (['steer', 'wheelbase', 'maxLat', 'downforce', 'top'].includes(k)) turnInfo();
      paramsChanged(cur, ['wheelbase', 'track', 'wheelR'].includes(k));
    });
    panel.querySelector('#vt-go').onclick = () => setTune(false, true);
    panel.querySelector('#vt-reset').onclick = () => { cur.p = defaults(cur.key); paramsChanged(cur, true); buildPanel(); };
    panel.querySelector('#vt-all').onclick = () => { for (const o of list) if (o !== cur && o.kind === cur.kind) { o.p = Object.assign({}, cur.p); paramsChanged(o, true); } note(`Every ${cur.kind === 'bike' ? 'bike' : 'car'} now uses these settings`, 2); };
    panel.querySelector('#vt-copy').onclick = e => { const txt = JSON.stringify({ vehicle: cur.name, ...cur.p }); navigator.clipboard.writeText(txt).then(() => { e.target.textContent = 'Copied'; }).catch(() => prompt2(txt)); };
  }
  function prompt2(txt) { const ta = document.createElement('textarea'); ta.value = txt; ta.style.cssText = 'width:100%;height:90px;margin-top:8px'; panel.append(ta); ta.select(); }
  // What the steering and grip add up to: the tightest turn, and the speed where grip (not the steering) becomes the limit
  // Speeds are tuned in km/h (the stored numbers, and Copy settings, stay so) but shown in miles per hour
  const MPH = 0.621371, shown = (val, step, unit) => unit === 'km/h' ? `${Math.round(val * MPH)} mph` : `${fmt(val, step)} ${unit}`;
  function turnInfo() {
    const el = panel.querySelector('#vturn'); if (!el || !cur) return;
    const p = cur.p, tan = Math.tan(p.steer * Math.PI / 180), full = Math.sqrt(p.maxLat * 9.8 * p.wheelbase / tan) * 3.6;
    const turn = R => Math.sqrt((p.maxLat * 9.8) * R) * 3.6;
    el.textContent = `Tightest turn: ${(p.wheelbase / tan).toFixed(1)} m radius. Full lock works up to about ${Math.round(full * MPH)} mph; faster than that, grip decides how hard you turn. These turns can be taken flat out at about ${Math.round(Math.min(p.top, turn(45)) * MPH)} mph${p.downforce ? ' (more with downforce)' : ''}.`;
  }
  function paramsChanged(v, shape) {
    if (shape) { clearTimeout(v.rebuildT); v.rebuildT = setTimeout(() => rebuild(v), 120); }
    clearTimeout(v.sendT); v.sendT = setTimeout(() => sendParams(v), 250);
  }
  // Tab in a vehicle opens the panel (the mouse is freed to use it); Tab again, or Drive, goes back to driving
  function setTune(on, relock) {
    if (on === tuneOpen) return;
    tuneOpen = on; panel.style.display = on ? 'block' : 'none';
    if (on) { buildPanel(); if (document.pointerLockElement) document.exitPointerLock(); }
    else if (relock && !matchOver) renderer.domElement.requestPointerLock();
  }
  addEventListener('keydown', e => { if (tuneOpen && e.code === 'Escape') { setTune(false); setPlaying(false); } });
  function hudTick() {
    const on = list.length > 0 && (locked || tuneOpen);
    if (cur && on) {
      const v = cur, mph = Math.round(Math.abs(v.speed) * 2.23694), t = LAP.on ? ((performance.now() - LAP.start) / 1000).toFixed(1) : '–';
      const lapLine = driveMode() ? `<br>Lap ${t} s · last ${LAP.last ? LAP.last.toFixed(2) : '–'} · best ${LAP.best ? LAP.best.toFixed(2) : '–'}` : '';
      hud.innerHTML = `<b>${mph} mph</b><br>${v.name}${v.speed < -0.5 ? ' · reverse' : ''}${lapLine}<br><small>Tab tune · R back on your wheels · V view · E out</small>`;
      hud.style.display = 'block';
    } else if (ride && on) {
      const v = ride, mph = Math.round(Math.abs(v.speed) * 2.23694), d = ents.find(e => e.id === v.owner && e !== P);
      hud.innerHTML = `<b>${mph} mph</b><br>${rideSeat > 1 ? 'In the back of' : 'Riding along in'} the ${v.name.toLowerCase()}${d ? ` with ${esc(d.name)}` : ''}<br><small>V view · E out</small>`;
      hud.style.display = 'block';
    } else hud.style.display = 'none';
    const nv = on && !cur && !ride && P.alive ? nearest() : null;
    prompt.style.display = nv ? 'block' : 'none';
    if (nv) prompt.textContent = offer(nv)[0];
  }

  // ---------------------------------------------------------------- networking
  const r3 = n => Math.round(n * 1000) / 1000;
  const stateOf = v => [v.i, r3(v.pos.x), r3(v.pos.y), r3(v.pos.z), r3(v.yaw), r3(v.pitch), r3(v.roll), r3(v.vel.x), r3(v.vel.y), r3(v.vel.z), r3(v.steerVis === undefined ? v.steer : v.steerVis)];
  function setNet(v, s) {
    const [, x, y, z, yaw, pitch, roll, vx, vy, vz, steer] = s.map(Number);
    if (![x, y, z, yaw].every(Number.isFinite)) return;
    v.net = { x, y, z, yaw, pitch: pitch || 0, roll: roll || 0, vx: vx || 0, vy: vy || 0, vz: vz || 0, steer: steer || 0, t: performance.now() };
  }
  function applyParams(v, p) {
    if (!v || !p || typeof p !== 'object') return;
    let shape = false;
    for (const [k, , min, max] of TUNE) if (Number.isFinite(+p[k])) { const n = Math.max(min, Math.min(max, +p[k])); if (['wheelbase', 'track', 'wheelR'].includes(k) && n !== v.p[k]) shape = true; v.p[k] = n; }
    if (shape) rebuild(v);
  }
  function sendParams(v) {
    const m = { t: 'vp', i: v.i, p: v.p };
    if (NET.role === 'guest') { if (NET.conn && NET.conn.open) NET.conn.send(m); } else broadcast(m);
  }

  // ---------------------------------------------------------------- hooks the game calls
  const input = () => ({
    thr: (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0),
    steer: (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0),
    hand: !!keys.Space, reset: false,
  });
  const idle = { thr: 0, steer: 0, hand: false, reset: false }, parked = { thr: 0, steer: 0, hand: true, reset: false }; // nobody aboard: the handbrake's on
  let resetQ = false, selfOn = false, selfRig = null;
  function setSelf(on) { // your own body is normally only a shadow; in Test Drive it's drawn (third person, or riding in the open)
    if (!P.rig) return; selfOn = on; selfRig = P.rig; // set every frame: the game's first-person body view (on foot) switches the same materials
    for (const o of P.rig.body || []) if (o.material.colorWrite !== on) { o.material.colorWrite = on; o.material.depthWrite = on; } // (only the body: the gun it holds shares its materials)
  }
  // Seat someone's body in a vehicle seat (crouched, which reads as sitting)
  const seatWorld = (v, k) => { v.body.updateMatrixWorld(true); return v.seats[k].p.clone().applyMatrix4(v.body.matrixWorld); };
  function seat(rig, wrap, v, dt, k, who) {
    rig.amp = 0; // (the game walks your body at the vehicle's speed: sitting, the legs stay still)
    if (v.seats[k].peg && rig.bones.thighL && rig.piv1) return seatBike(rig, wrap, v, dt, k, who);
    const p = seatWorld(v, k);
    wrap.position.set(p.x, p.y - 0.5, p.z); wrap.rotation.set(-v.pitch, v.yaw + v.seats[k].yaw, v.roll, 'YXZ'); wrap.visible = true;
    animRig(rig, dt, 0, true, 0.2);
  }
  // Astride a bike: hips on the saddle and feet on the pegs; the rider leans to the grips with both hands (the gun put away:
  // shots still go from the eyes), a passenger behind turns at the waist toward where they aim, gun up
  const _bq = new THREE.Quaternion(), _bq2 = new THREE.Quaternion(), _bq3 = new THREE.Quaternion(), _bm = new THREE.Matrix4(), _bm2 = new THREE.Matrix4();
  const _b1 = new V3(), _b2 = new V3(), _b3 = new V3(), _b4 = new V3(), _b5 = new V3(), _UP = new V3(0, 1, 0);
  const _unturn = new THREE.Quaternion().setFromAxisAngle(new V3(0, 1, 0), -RIG_TURN);
  const bikeQ = (v, q) => q.setFromEuler(new THREE.Euler(-v.pitch, v.yaw, v.roll, 'YXZ'));
  const hipsOf = (rig, out) => out.copy(rigBone(rig, 'DEF-Thigh_1L').getWorldPosition(_b4)).add(rigBone(rig, 'DEF-Thigh_1R').getWorldPosition(_b5)).multiplyScalar(0.5);
  function seatBike(rig, wrap, v, dt, k, who) {
    const s = v.seats[k], rider = k === 0, pass = !rider && who && who.alive !== false;
    v.body.updateMatrixWorld(true); bikeQ(v, _bq);
    wrap.quaternion.copy(_bq).multiply(_unturn); wrap.position.copy(s.saddle).applyMatrix4(v.body.matrixWorld); wrap.visible = true; // (the rig is drawn turned 10° right: square it up)
    animRig(rig, dt, 0, true, pass ? who.pitch || 0 : 0.15);
    // Legs: the hinge angles that put the ankles over the pegs, worked out once per character and seat
    const legs = rig.model.bikeLegs || (rig.model.bikeLegs = {}), lk = v.key + k;
    if (!legs[lk]) { wrap.updateMatrixWorld(true); legs[lk] = solveLegs(rig, v, s); }
    wrap.updateMatrixWorld(true);
    for (const side of ['L', 'R']) legPose(rig, side, legs[lk][side], _bq);
    // A passenger turns at the waist (everything above the hips, about the spine's base) toward the aim
    if (pass && rig.upper.length) {
      const yaw = Math.max(-2.6, Math.min(2.6, wrapA(who.yaw + Math.PI - v.yaw)));
      wrap.updateMatrixWorld(true);
      const up = _b1.copy(_UP).applyQuaternion(_bq).applyQuaternion(rig.upper[0].b.parent.getWorldQuaternion(_bq2).invert());
      _bq3.setFromAxisAngle(up, yaw);
      for (const u of rig.upper) { u.b.position.sub(rig.piv1).applyQuaternion(_bq3).add(rig.piv1); u.b.quaternion.premultiply(_bq3); }
    }
    // Hips onto the saddle
    wrap.updateMatrixWorld(true);
    const want = _b2.copy(s.saddle).add(_b3.set(0, 0.1, 0)).applyMatrix4(v.body.matrixWorld);
    wrap.position.add(want.sub(hipsOf(rig, _b3))); wrap.updateMatrixWorld(true);
    if (rider && v.grips && v.grips[0]) { // lean in over the tank until the grips are in reach, then hands on them
      armsBack(rig); rig.root.updateMatrixWorld(true);
      const lean = rig.model.bikeLean || (rig.model.bikeLean = {});
      if (lean[lk] === undefined) lean[lk] = leanToReach(rig, v, _bq);
      else bendUpper(rig, lean[lk], _bq);
      for (const [side, gi] of [['L', 0], ['R', 1]]) reach(rig, side, v.grips[gi], _bq);
      if (rig.gunVis) { rig.gunVis.visible = false; rig.bikeHid = true; }
    }
  }
  // Everything above the hips bends forward about the spine's base (the bike's side-to-side axis)
  function bendUpper(rig, ang, q) {
    if (!ang) return;
    const ax = _b1.set(1, 0, 0).applyQuaternion(q).applyQuaternion(rig.upper[0].b.parent.getWorldQuaternion(_bq2).invert());
    _bq3.setFromAxisAngle(ax, ang);
    for (const u of rig.upper) { u.b.position.sub(rig.piv1).applyQuaternion(_bq3).add(rig.piv1); u.b.quaternion.premultiply(_bq3); }
    rig.wrap.updateMatrixWorld(true); rig.root.updateMatrixWorld(true);
  }
  function leanToReach(rig, v, q) {
    const arm = s => { const S = rigBone(rig, 'DEF-UpperArm_1' + s).getWorldPosition(new V3()), E = rigBone(rig, 'DEF-Forearm_1' + s).getWorldPosition(new V3()), W = rigBone(rig, 'DEF-Wrist' + s).getWorldPosition(new V3());
      return [S, S.distanceTo(E) + E.distanceTo(W)]; };
    let total = 0;
    for (let i = 0; i < 3; i++) { // (at most ~9° on top of the sitting lean: the rider sits up, arms reaching out to the bars)
      const far = Math.max(...[['L', 0], ['R', 1]].map(([s, gi]) => { const [S, len] = arm(s); return S.distanceTo(v.grips[gi].getWorldPosition(_b2)) / len; }));
      if (far < 1.05) break; // (the wrist sits a little short of the grip: the hand makes up the rest)
      bendUpper(rig, 0.05, q); total += 0.05;
    }
    return total;
  }
  const wrapA = a => ((a % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI) - Math.PI;
  // A leg: thigh and knee bent on their hinges, then the whole leg swung out at the hip (about the bike's length) to clear the tank
  function legPose(rig, side, [a, b, out], q) {
    const th = rig.bones['thigh' + side]; setBone(th, a); setBone(rig.bones['knee' + side], b);
    th.b.updateWorldMatrix(false, true);
    turnWorld(th.b, _bq3.setFromAxisAngle(_b5.set(0, 0, 1).applyQuaternion(q), side === 'L' ? out : -out));
  }
  // Thigh, knee and splay (a grid, then a finer one) that put each ankle just above and behind its peg, in the bike's frame
  function solveLegs(rig, v, s) {
    const q = bikeQ(v, new THREE.Quaternion()), inv = q.clone().invert(), hip = hipsOf(rig, new V3()), res = {};
    for (const [side, sx] of [['L', 1], ['R', -1]]) {
      const tgt = new V3(sx * (s.peg.x - 0.02), s.peg.y + 0.08, s.peg.z - 0.09).sub(new V3(0, s.saddle.y + 0.1, s.saddle.z)); // the ankle, from the hips
      const foot = rigBone(rig, 'DEF-Foot' + side), d = new V3();
      const err = p => { legPose(rig, side, p, q); d.copy(foot.getWorldPosition(_b1)).sub(hip).applyQuaternion(inv); return (d.x - tgt.x) ** 2 + (d.y - tgt.y) ** 2 + (d.z - tgt.z) ** 2; };
      let best = [-1.2, 1.2, 0.1], be = Infinity;
      for (const [r, n] of [[[[-2.4, 0], [0, 2.6], [0, 0.6]], [16, 16, 6]], [null, [10, 10, 6]]]) {
        const c = best, rg = r || [[c[0] - 0.15, c[0] + 0.15], [c[1] - 0.15, c[1] + 0.15], [c[2] - 0.1, c[2] + 0.1]];
        for (let i = 0; i <= n[0]; i++) for (let j = 0; j <= n[1]; j++) for (let l = 0; l <= n[2]; l++) {
          const p = [0, 1, 2].map((m, x) => rg[m][0] + (rg[m][1] - rg[m][0]) * [i, j, l][x] / n[m]), e = err(p);
          if (e < be) { be = e; best = p; }
        }
      }
      res[side] = best;
    }
    return res;
  }
  // Two-bone reach: the upper arm and forearm turn so the wrist lands at the grip, the elbow out and down; the hand comes
  // along, and the fingers (loose bones in this rig) follow the wrist
  // The reach bends the forearms and wrists, which nothing else poses: keep how they were, and put them back before each pose
  // (or the bends pile up frame on frame) and once off the bike (or the arms stay bent for holding a gun)
  const IK_BONES = ['DEF-Forearm_1L', 'DEF-WristL', 'DEF-Forearm_1R', 'DEF-WristR'];
  function armsBack(rig) {
    if (!rig.ikRest) return;
    for (const [b, q] of rig.ikRest) b.quaternion.copy(q);
    rig.ikBent = false;
  }
  function reach(rig, side, grip, q) {
    const sh = rigBone(rig, 'DEF-UpperArm_1' + side), fa = rigBone(rig, 'DEF-Forearm_1' + side), wr = rigBone(rig, 'DEF-Wrist' + side);
    if (!sh || !fa || !wr) return;
    if (!rig.ikRest) rig.ikRest = IK_BONES.map(n => rigBone(rig, n)).filter(Boolean).map(b => [b, b.quaternion.clone()]);
    rig.ikBent = true;
    const S = sh.getWorldPosition(new V3()), E = fa.getWorldPosition(new V3()), W = wr.getWorldPosition(new V3()), a = S.distanceTo(E), b = E.distanceTo(W);
    const sx = side === 'L' ? 1 : -1, right = new V3(sx, 0, 0).applyQuaternion(q), up = new V3(0, 1, 0).applyQuaternion(q), fwd = new V3(0, 0, 1).applyQuaternion(q);
    const T = grip.getWorldPosition(new V3()).addScaledVector(fwd, -0.12).addScaledVector(right, -0.07).addScaledVector(up, 0.05); // the wrist, just behind and above the grip (the hand closes over it)
    const n = T.clone().sub(S), dist = Math.max(Math.abs(a - b) + 0.01, Math.min(a + b - 0.005, n.length())); n.normalize();
    const pole = right.clone().multiplyScalar(0.7).addScaledVector(up, -0.6).addScaledVector(fwd, -0.3); pole.addScaledVector(n, -pole.dot(n)).normalize();
    const ca = (a * a + dist * dist - b * b) / (2 * a * dist), E2 = S.clone().addScaledVector(n, a * ca).addScaledVector(pole, a * Math.sqrt(Math.max(0, 1 - ca * ca)));
    const before = wr.matrixWorld.clone(), wq0 = wr.getWorldQuaternion(new THREE.Quaternion());
    const F0 = rigBone(rig, 'DEF-Finger_Middle1' + side).getWorldPosition(new V3()).sub(W), T0 = rigBone(rig, 'DEF-Finger_Thumb1' + side).getWorldPosition(new V3()).sub(W);
    turnWorld(sh, _bq2.setFromUnitVectors(E.clone().sub(S).normalize(), E2.clone().sub(S).normalize()));
    const E3 = fa.getWorldPosition(new V3()), W3 = wr.getWorldPosition(new V3()), T2 = S.clone().addScaledVector(n, dist);
    turnWorld(fa, _bq2.setFromUnitVectors(W3.sub(E3).normalize(), T2.sub(E3).normalize()));
    // The hand over the grip: knuckles forward and a little down, thumb in toward the tank
    const dq = wr.getWorldQuaternion(new THREE.Quaternion()).multiply(wq0.invert());
    const frame = (f, t) => { f = f.clone().normalize(); t = t.clone().addScaledVector(f, -t.dot(f)).normalize(); return new THREE.Matrix4().makeBasis(f, t, f.clone().cross(t)); };
    const now = frame(F0.applyQuaternion(dq), T0.applyQuaternion(dq));
    const want = frame(fwd.clone().multiplyScalar(0.75).addScaledVector(up, -0.55), right.clone().multiplyScalar(-0.8).addScaledVector(fwd, 0.4).addScaledVector(up, -0.3));
    turnWorld(wr, new THREE.Quaternion().setFromRotationMatrix(want.multiply(now.transpose())));
    _bm.copy(wr.matrixWorld).multiply(_bm2.copy(before).invert()); // how the wrist moved
    for (const f of sh.parent.children) if (f.isBone && f.name.startsWith('DEF-Finger_') && f.name.endsWith(side)) {
      const m = _bm2.copy(f.parent.matrixWorld).invert().multiply(_bm).multiply(f.matrixWorld);
      m.decompose(f.position, f.quaternion, _b1); f.updateWorldMatrix(false, true);
    }
  }
  function turnWorld(bone, dq) { // turn a bone (and so its children) by dq in world space
    const w = bone.getWorldQuaternion(new THREE.Quaternion()), pw = bone.parent.getWorldQuaternion(new THREE.Quaternion());
    bone.quaternion.copy(pw.invert().multiply(dq.clone().multiply(w))); bone.updateWorldMatrix(false, true);
  }
  // In a seat you aim where the camera looks, from your eyes (the game's shots take your yaw and pitch, and start at myEye)
  const _cd = new V3();
  function aimFromCamera(v, k) {
    camera.getWorldDirection(_cd); P.yaw = Math.atan2(-_cd.x, -_cd.z); P.pitch = Math.asin(Math.max(-1, Math.min(1, _cd.y)));
    if (v.armM) myEye.copy(v.seats[k].eye).applyMatrix4(v.armM);
  }
  Object.defineProperty(VEH, 'cur', { get: () => cur, configurable: true });
  Object.defineProperty(VEH, 'tuneOpen', { get: () => tuneOpen, configurable: true });
  Object.defineProperty(VEH, 'riding', { get: () => cur || ride, configurable: true }); // you're in a vehicle, any seat
  Object.defineProperty(VEH, 'noGuns', { get: () => driveMode() || !!cur || (!!ride && view === 'chase'), configurable: true }); // passengers shoot from their seat; drivers (a bike's rider too: hands on the bars) don't, and get no crosshair
  Object.assign(VEH, {
    list,
    rides: id => list.some(v => v.owner === id || (v.occ && v.occ.includes(id))), // someone (a guest, by id) is in a seat
    onLevel() {
      if (LV && LV.vehicles) spawnLot(LV.vehicles === true ? LOT : LV.vehicles);
      else { clearAll(); setSelf(false); }
    },
    spawn: (key, pos, yaw) => { const v = make(key, pos.x, pos.z, yaw); return v; },
    remove: removeVehicles,
    // A vehicle is wrecked: nobody can drive it, and anyone in it bails out
    wreck(v) { if (!v || v.dead) return; v.dead = true; v.npc = null; v.npcBusy = false; darken(v); },
    update(dt) {
      if (!list.length) return;
      for (const v of list) {
        if (![v.pos.x, v.pos.y, v.pos.z, v.vel.x, v.vel.z, v.yaw, v.pitch, v.roll].every(Number.isFinite)) place(v);
        if (simulated(v)) { // fell out of the world, or sank in the sea: back where it was parked
          v.wet = v.pos.y < waterAt(v.pos.x, v.pos.z) - 0.6 ? (v.wet || 0) + dt : 0;
          if (v.pos.y < KILL_Y || v.wet > 2) { console.warn('Vehicle fell out of the world; last on the ground at [x, y, z]:', v.lastGround, v.name); v.wet = 0; respawn(v); }
        }
        if (simulated(v)) { drive(v, dt, v.dead ? parked : v === cur && locked ? Object.assign(input(), { reset: resetQ }) : v.npc || (v === cur ? idle : parked)); hitWalls(v); }
        else follow(v, dt);
      }
      resetQ = false;
      bumpVehicles();
      for (const v of list) if (simulated(v) && v.owner && !v.dead && !matchOver) runOver(v);
      for (const v of list) { suspension(v, dt); pose(v, dt); bodyMatrix(v); }
      // Dying in a vehicle leaves it where it is (you come back at a spawn point, on foot)
      if (!P.alive) { if (cur) leave(true); if (ride) unride(true); }
      if (cur && cur.dead) { leave(true); note('Bail out! It\'s wrecked', 2); }
      if (ride && ride.dead) { unride(true); note('Bail out! It\'s wrecked', 2); }
      if (cur) { // the game still sees you where you're sitting
        const p = seatWorld(cur, 0); P.pos.set(p.x, p.y - 0.5, p.z); P.vel.copy(cur.vel); P.onGround = true;
        if (driveMode()) lapTick(cur);
      }
      if (ride) {
        if (ride.occ[rideSeat] !== me()) { ride = null; note('You were let out', 1.5); }
        else { const p = seatWorld(ride, rideSeat); P.pos.set(p.x, p.y - 0.5, p.z); P.vel.copy(ride.vel); P.onGround = true; }
      }
      soundTick();
    },
    block: blockBody,
    armorRay,
    inArmour: id => list.some(v => v.model && v.layout === 'truck' && (v.owner === id || v.occ.includes(id))), // someone sits in a truck (behind its armour)
    setModel,
    lampBeams, // (?dev) the headlights: on or off, for items.js and its messages
    lampsOff: () => list.filter(v => !v.lamp).map(v => v.i),
    setLamps(off) { for (const v of list) if (v !== cur) v.lamp = !off.includes(v.i); },
    driving: () => cur,
    rearOf: v => lenOf(v) / 2 - midOf(v), // how far the back of the body is behind the vehicle's position
    lenOf,
    // Boxes round the body ({ c: centre, h: half sizes }, in the vehicle's frame)
    boxesOf: v => v.model ? v.model.boxes : [{ c: new V3(0, 1.1, 0), h: new V3((v.p.track + 0.1) / 2, 1, (v.p.wheelbase + 1) / 2) }],
    mouse(dx, dy) {
      if (!cur && !ride) return false;
      camYaw -= dx * SENS * CTL.sens; camPitch = Math.max(-0.6, Math.min(0.9, camPitch - dy * SENS * CTL.sens)); lookIdle = 0; return true;
    },
    key(code) {
      if (!list.length) return false;
      if (code === 'KeyE') { // in or out; with no vehicle in reach E does its usual job (in Test Drive, nothing)
        if (cur) { leave(false); return true; } if (ride) { unride(false); return true; }
        const v = P.alive ? nearest() : null; if (v) { use(v); return true; } return driveMode();
      }
      if ((cur || ride) && code === 'KeyV') { view = view === 'chase' ? 'seat' : 'chase'; camYaw = 0; camPitch = view === 'chase' ? CAM_PITCH : 0; return true; } // (each view starts from its own default)
      if (cur && code === 'KeyR') { resetQ = true; return true; }
      if (cur && code === 'KeyL' && typeof DEV !== 'undefined' && DEV) { cur.lamp = !cur.lamp; sBeep(cur.lamp ? 900 : 600); return true; } // (?dev) the headlights
      const gunKeys = ['KeyR', 'KeyF', 'KeyG', 'KeyQ', 'KeyX', 'Digit1', 'Digit2', 'Digit3', 'Digit4'];
      return (VEH.noGuns && gunKeys.includes(code)) || (!!cur && code === 'KeyC');
    },
    tab() { if (!list.length || !cur) return false; setTune(!tuneOpen, true); return true; },
    camera(dt) {
      if (!list.length) return;
      if (!cur && !ride) { // on foot: third person in Test Drive, your own eyes everywhere else
        if (!driveMode()) return;
        const fx = -Math.sin(P.yaw), fz = -Math.cos(P.yaw), cp = Math.cos(P.pitch), sp = Math.sin(P.pitch);
        const head = new V3(P.pos.x, P.pos.y + 1.65, P.pos.z), dir = new V3(fx * cp, sp, fz * cp);
        const want = head.clone().addScaledVector(dir, -3.4).add(new V3(-fz * 0.55, 0.25, fx * 0.55));
        const d = want.clone().sub(head), len = d.length(); d.divideScalar(len);
        const hit = tgRay(head.x, head.y, head.z, d.x, d.y, d.z, len); if (hit < len) want.copy(head).addScaledVector(d, Math.max(0.3, hit - 0.25));
        camera.position.copy(want); camera.up.set(0, 1, 0); camera.lookAt(head.clone().addScaledVector(dir, 12)); camera.fov = 72; camera.updateProjectionMatrix(); camera.updateMatrixWorld();
        return;
      }
      const v = cur || ride, k0 = cur ? 0 : rideSeat; axes(v);
      lookIdle += dt; // (the view stays where you leave it: it no longer settles back behind the vehicle)
      camera.fov = 72 + Math.min(14, Math.abs(v.speed || 0) * 0.25); camera.updateProjectionMatrix();
      if (view === 'seat') { // the driver's eyes: open chassis, nothing in the way
        if (!v.armM) bodyMatrix(v);
        camera.position.copy(v.seats[k0].eye).applyMatrix4(v.armM); // (the same eyes you shoot from)
        const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-v.pitch - v.susp.p, v.yaw, v.roll + v.susp.r, 'YXZ'));
        camera.quaternion.copy(q).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(camPitch, Math.PI + camYaw + v.seats[k0].yaw, 0, 'YXZ')));
        camera.updateMatrixWorld(); aimFromCamera(v, k0); return;
      }
      const dist = 3.6 + v.p.wheelbase * 1.1, h = 1.5 + v.p.wheelbase * 0.25, target = new V3(v.pos.x, v.pos.y + 0.9, v.pos.z);
      const y = v.yaw + camYaw, c = Math.cos(camPitch), want = target.clone().add(new V3(-Math.sin(y) * dist * c, h + Math.sin(camPitch) * dist, -Math.cos(y) * dist * c));
      const dir = want.clone().sub(target), len = dir.length(); dir.divideScalar(len);
      const hit = tgRay(target.x, target.y, target.z, dir.x, dir.y, dir.z, len); if (hit < len) want.copy(target).addScaledVector(dir, Math.max(1, hit - 0.4));
      const gy = groundAt(want.x, want.z, want.y + 1); if (gy !== null && want.y < gy + 0.5) want.y = gy + 0.5;
      if (![camPos.x, camPos.y, camPos.z, camLook.x].every(Number.isFinite)) { camPos.copy(want); camLook.copy(target); }
      camPos.lerp(want, 1 - Math.exp(-9 * dt)); camLook.lerp(target.addScaledVector(_f, 3), 1 - Math.exp(-14 * dt));
      camera.position.copy(camPos); camera.up.set(0, 1, 0); camera.lookAt(camLook); camera.updateMatrixWorld();
      aimFromCamera(v, k0);
    },
    after(dt) {
      hudTick();
      const noGun = VEH.noGuns && (driveMode() || cur || ride);
      for (const id of ['ammo', 'c1', 'c2', 'c3', 'c4']) { const e = $(id); if (e) e.style.visibility = noGun ? 'hidden' : ''; }
      if (!list.length && !driveMode()) return;
      if (noGun) { vm.visible = false; knifeVM.visible = false; }
      if (driveMode()) for (const e of ents) if (e.rig && e.rig.gunVis) e.rig.gunVis.visible = false; // nobody carries a gun in Test Drive
      // Your body: in Test Drive drawn on foot (third person); in a vehicle drawn in the chase view, hidden in your seat's view
      if (driveMode()) setSelf(!(cur || ride) || view === 'chase'); else if (cur || ride) setSelf(view === 'chase'); // (on foot the game's own body view decides)
      for (const e of ents) if (e.rig) { // off the bike, the gun comes back and the arms straighten (a rider's are posed again below)
        if (e.rig.bikeHid) { e.rig.bikeHid = false; if (e.rig.gunVis && !driveMode()) e.rig.gunVis.visible = true; }
        if (e.rig.ikBent) armsBack(e.rig);
      }
      if ((cur || ride) && P.rig && P.rig.gear) P.rig.gear.visible = view === 'chase'; // the guns you carry show on your body in the chase view (not in your seat's view)
      if (cur && P.rig) seat(P.rig, P.rig.wrap, cur, dt, 0, P);
      if (ride && P.rig) seat(P.rig, P.rig.wrap, ride, dt, rideSeat, P);
      // Everyone else sits in their seats
      for (const v of list) v.occ.forEach((id, k) => {
        const who = k === 0 ? v.owner : id; if (!who || who === me()) return;
        const e = ents.find(x => x.id === who && x !== P); if (e && e.rig && e.mesh) seat(e.rig, e.mesh, v, dt, k, e);
      });
    },
    exit: () => (cur ? leave(true) : unride(true)),
    // Networking: the host's snapshot carries every vehicle; a guest's state message carries the one they drive
    // vh entry: [preset, driver, x, y, z, yaw, pitch, roll, vx, vy, vz, steer, status (1 wrecked, 2 an NPC has it), who's in seat 1, seat 2, ...]
    netSnapshot: () => list.map(v => [v.key, v.owner || 0, ...stateOf(v).slice(1), v.dead ? 1 : v.npcBusy ? 2 : 0, ...v.occ.slice(1).map(o => o || 0)]),
    myState: () => (cur && simulated(cur) ? stateOf(cur) : null),
    applyNet(vh) {
      if (!Array.isArray(vh)) return;
      // Match the host's vehicles: rebuild from the first one that differs
      let k = 0; while (k < list.length && k < vh.length && Array.isArray(vh[k]) && list[k].key === vh[k][0]) k++;
      if (k < list.length) removeVehicles(list.slice(k));
      for (let j = k; j < vh.length; j++) { const s = vh[j]; if (Array.isArray(s) && PRESETS[s[0]]) make(s[0], +s[2] || 0, +s[4] || 0, +s[5] || 0); else break; }
      vh.forEach((s, i) => {
        const v = list[i]; if (!v || !Array.isArray(s)) return;
        if (s[12] === 1 && !v.dead) VEH.wreck(v);
        v.npcBusy = s[12] === 2;
        for (let q = 1; q < v.seats.length; q++) if (!(v === ride && q === rideSeat)) v.occ[q] = s[12 + q] || null; // (our own seat stands until the host says otherwise)
        if (v === cur) return; // ours: we're the authority (the host says no with 'vdeny')
        v.owner = s[1] || null; setNet(v, [i, ...s.slice(2, 12)]);
      });
    },
    remoteState(r, s) { if (!Array.isArray(s)) return; const v = list[s[0] | 0]; if (v && v.owner === r.id) setNet(v, s); },
    welcome(r) { sendTo(r, { t: 'vpall', ps: list.map(v => v.p) }); },
    onLeave(r) { for (const v of list) v.occ.forEach((o, q) => { if (q && o === r.id) v.occ[q] = null; }); for (const v of list) if (v.owner === r.id) { v.owner = null; if (v.net) { v.pos.set(v.net.x, v.net.y, v.net.z); v.vel.set(v.net.vx, 0, v.net.vz); } v.net = null; } },
    onGuestMsg(r, m) { // host side
      const v = list[m.i | 0];
      if (m.t === 'vreq' && v) { if ((!v.owner || v.owner === r.id) && !v.dead && !v.npcBusy) { v.owner = r.id; v.net = null; v.npc = null; } else sendTo(r, { t: 'vdeny', i: v.i }); }
      else if (m.t === 'vfree' && v && v.owner === r.id) { if (Array.isArray(m.s)) { setNet(v, m.s); v.pos.set(v.net.x, v.net.y, v.net.z); v.yaw = v.net.yaw; v.vel.set(v.net.vx, 0, v.net.vz); } v.owner = null; v.net = null; }
      else if (m.t === 'vp' && v && v.owner === r.id) { applyParams(v, m.p); broadcast({ t: 'vp', i: v.i, p: v.p }, r.conn); }
      else if (m.t === 'vride' && v) { const q = m.s | 0; if (q > 0 && q < v.seats.length && (!v.occ[q] || v.occ[q] === r.id) && !v.dead && !v.npcBusy) v.occ[q] = r.id; else sendTo(r, { t: 'vdeny', i: v.i, ride: 1 }); }
      else if (m.t === 'vunride' && v) { const q = m.s | 0; if (v.occ[q] === r.id) v.occ[q] = null; }
    },
    onHostMsg(m) { // guest side; true when handled
      if (m.t === 'vdeny') { const v = list[m.i | 0]; if (v && m.ride && v === ride) { if (v.occ[rideSeat] === me()) v.occ[rideSeat] = null; ride = null; note('Someone got there first', 2); } else if (v && v === cur) { leave(true); note('Someone got there first', 2); } return true; }
      if (m.t === 'vp') { const v = list[m.i | 0]; if (v && v !== cur) applyParams(v, m.p); return true; }
      if (m.t === 'vpall') { (m.ps || []).forEach((p, i) => applyParams(list[i], p)); return true; }
      return false;
    },
  });
})();
