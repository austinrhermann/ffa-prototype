# The extra ground for the Fortress level (pure numpy: build_fortress_ext.py feeds it the Fortress set's triangles and turns what comes back
# into meshes and a painted texture). Everything is in game world metres: x right, z toward the gate side (the south), y up.
#
# The land follows Austin's drawing of the bigger island (DESIGN below, traced from it): the island grows south around its old southern half,
# out to a new coast; a mountain divider runs on south from the old south hill; two spawn clearings, A (west) and B (east), each with a road
# up to the old ground. The new ground is a second mesh that sits over the old one: where it is higher it covers it (the old coast cliffs go
# under it), where it is lower it hides 0.6 m under it, so the two meet without a seam. The roads are levelled to a smooth grade the vehicles
# can drive: on the new ground here, on the old ground by the game itself at load (it shifts the old ground's vertices to the same profile,
# see regradeGround in index.html), so both agree.
import numpy as np

DESIGN = dict(
    # the new coast, west end to east end (the old coast closes the shape in the north)
    coast=[[-62.9, 45.2], [-63.4, 47.5], [-63.9, 61.5], [-61.9, 76.5], [-63.4, 83.3], [-63.2, 89.1], [-60.9, 100.5], [-60.4, 106.3], [-58.4, 111.8], [-56.0, 114.2],
           [-45.6, 115.7], [-40.1, 117.4], [2.9, 121.5], [38.9, 118.3], [65.7, 117.8], [67.8, 116.7], [71.5, 112.3], [72.4, 110.2], [72.2, 92.7], [70.8, 85.8],
           [70.3, 75.4], [59.5, 54.7], [56.4, 51.2], [51.0, 46.8], [43.2, 38.1]],
    # the mountain divider's crest, from the old south hill's tip down to the south coast
    divider=[[-3.0, 92.0], [-3.1, 99.2], [-3.4, 101.5], [-1.9, 104.6], [-1.8, 108.0], [0.4, 112.1], [0.7, 121.0]],
    # the roads to the spawn clearings, each branching off the road from the fort's gate (the painted path that runs down the valley to the truck)
    roadA=[[-7.5, 45.5], [-11.0, 47.5], [-14.5, 49.3], [-18.1, 51.2], [-21.5, 53.3], [-24.7, 55.6], [-27.7, 58.2], [-30.4, 61.2], [-32.3, 64.7], [-32.5, 68.6],
           [-31.0, 72.3], [-29.1, 75.8], [-27.5, 79.5], [-26.8, 83.4], [-27.4, 87.3], [-29.9, 90.2], [-31.5, 91.5]],
    roadB=[[23.5, 61.5], [22.7, 65.4], [23.0, 69.4], [24.2, 73.2], [26.1, 76.7], [28.4, 79.9], [31.1, 83.0], [33.8, 85.8], [36.7, 88.7], [38.5, 90.5]],
    spawnA=dict(c=[-39.3, 95.4], r=8.8, level=26.5), spawnB=dict(c=[46.1, 96.2], r=9.8, level=24.5),   # (the ground's level in each clearing)
)
LAND = 26.0          # level of the new ground (the island's valley floor is 23 to 26, its hills 30 to 45)
ROAD_W = 3.8         # the drawn road
FLAT, BLEND = 2.2, 4.0   # the ground is level this far from a road's centre, and eases back to the land over this much more
MAX_GRADE = 0.08     # the steepest a road may climb
PADS = [(15.5, 58.5, 7.0, 4.5, 23.0)]   # level ground, to widen the valley where the truck parks: x, z, radius, blend, height (the game levels the old ground to them too: FORT_EXT.pads)
CREST = ([0.0, 0.25, 1.0], [41.0, 47.0, 44.0])  # the divider's crest height along it (north end, a quarter of the way, the coast)
DIVIDER_TOP, DIVIDER_FOOT = 2.5, 7.0   # half the width of its flat top, and how far the flank then falls to the ground: steep enough that nobody walks over it
MOUNDS = [(-50, 70, 8, 5), (60, 70, 9, 7), (62, 108, 8, 5), (-22, 112, 8, 4), (25, 112, 9, 5), (-52, 101, 7, 3)]  # x, z, radius, height
BOUNDS = (-80.0, 84.0, 34.0, 136.0)  # x0, x1, z0, z1 of the work area
RES = 0.5
HIDE = 0.6           # how far under the old ground the new one hides
COLLAR = 9.0         # how far inside the old coast the new ground reaches: it fills the old coast's bank, easing back under the old ground by the inner edge

smooth = lambda t: (lambda u: u * u * (3 - 2 * u))(np.clip(t, 0, 1))


def raster_up(tris, X0, Z0, nx, nz, res, ny_min=0.02):
    """Height of the highest upward-facing surface in each cell (cell centres), NaN where none."""
    H = np.full((nz, nx), -np.inf)
    n = np.cross(tris[:, 1] - tris[:, 0], tris[:, 2] - tris[:, 0]); nl = np.linalg.norm(n, axis=1)
    for t in tris[(n[:, 1] / np.maximum(nl, 1e-12)) > ny_min]:
        px = (t[:, 0] - X0) / res; pz = (t[:, 2] - Z0) / res
        i0, i1 = int(max(np.floor(pz.min()), 0)), int(min(np.ceil(pz.max()), nz)); j0, j1 = int(max(np.floor(px.min()), 0)), int(min(np.ceil(px.max()), nx))
        if i0 >= i1 or j0 >= j1: continue
        jj, ii = np.meshgrid(np.arange(j0, j1) + 0.5, np.arange(i0, i1) + 0.5)
        d = (pz[1] - pz[2]) * (px[0] - px[2]) + (px[2] - px[1]) * (pz[0] - pz[2])
        if abs(d) < 1e-9: continue
        a = ((pz[1] - pz[2]) * (jj - px[2]) + (px[2] - px[1]) * (ii - pz[2])) / d
        b = ((pz[2] - pz[0]) * (jj - px[2]) + (px[0] - px[2]) * (ii - pz[2])) / d
        c = 1 - a - b; inside = (a >= -1e-6) & (b >= -1e-6) & (c >= -1e-6)
        y = a * t[0, 1] + b * t[1, 1] + c * t[2, 1]
        H[i0:i1, j0:j1] = np.maximum(H[i0:i1, j0:j1], np.where(inside, y, -np.inf))
    return np.where(np.isfinite(H), H, np.nan)


def _dil(m):
    o = m.copy(); o[1:] |= m[:-1]; o[:-1] |= m[1:]; o[:, 1:] |= m[:, :-1]; o[:, :-1] |= m[:, 1:]; return o


def _ero(m): return ~_dil(~m)


def dist_to_points(P, X, Z, chunk=2048):
    """Distance from each (X, Z) to the nearest of the points P (n, 2)."""
    out = np.empty(X.size); xf, zf = X.ravel(), Z.ravel()
    for k in range(0, xf.size, chunk):
        out[k:k + chunk] = np.sqrt(((xf[k:k + chunk, None] - P[None, :, 0]) ** 2 + (zf[k:k + chunk, None] - P[None, :, 1]) ** 2).min(1))
    return out.reshape(X.shape)


def dist_to_polyline(poly, X, Z):
    """(distance, arclength fraction 0..1 of the nearest point) to a polyline."""
    P = np.array(poly, float); seg = P[1:] - P[:-1]; L = np.hypot(seg[:, 0], seg[:, 1]); cum = np.r_[0, np.cumsum(L)]
    best = np.full(X.shape, np.inf); arc = np.zeros(X.shape)
    for k in range(len(seg)):
        v = seg[k]; w = np.stack([X - P[k, 0], Z - P[k, 1]], -1); t = np.clip((w @ v) / max(L[k] ** 2, 1e-9), 0, 1)
        d = np.hypot(X - (P[k, 0] + t * v[0]), Z - (P[k, 1] + t * v[1])); m = d < best
        best = np.where(m, d, best); arc = np.where(m, (cum[k] + t * L[k]) / cum[-1], arc)
    return best, arc


def in_polygon(poly, X, Z):
    P = np.array(poly, float); inside = np.zeros(X.shape, bool)
    for k in range(len(P)):
        a, b = P[k], P[(k + 1) % len(P)]
        cond = ((a[1] > Z) != (b[1] > Z)) & (X < (b[0] - a[0]) * (Z - a[1]) / (b[1] - a[1] + 1e-12) + a[0])
        inside ^= cond
    return inside


def vnoise(X, Z, wave, seed):
    """Smooth value noise in [-1, 1], one random value every `wave` metres."""
    rng = np.random.RandomState(seed); gx, gz = int(240 / wave) + 3, int(240 / wave) + 3; G = rng.uniform(-1, 1, (gz, gx))
    u = (X + 100) / wave; v = (Z + 20) / wave; i, j = np.floor(u).astype(int), np.floor(v).astype(int); fu, fv = smooth(u - i), smooth(v - j)
    i = np.clip(i, 0, gx - 2); j = np.clip(j, 0, gz - 2)
    return (G[j, i] * (1 - fu) + G[j, i + 1] * fu) * (1 - fv) + (G[j + 1, i] * (1 - fu) + G[j + 1, i + 1] * fu) * fv


def resample(poly, step):
    P = np.array(poly, float); d = np.r_[0, np.cumsum(np.hypot(*np.diff(P, axis=0).T))]; t = np.r_[np.arange(0, d[-1], step), d[-1]]
    return np.stack([np.interp(t, d, P[:, 0]), np.interp(t, d, P[:, 1])], 1)


def cliff_drop(d):
    """How far the ground falls short of the plateau at distance d inside the coast (the old coast's median bank); steeper beyond it."""
    return np.where(d >= 0, np.interp(d, [0, 0.5, 1, 2, 3, 4, 6], [12, 10.2, 6.4, 3.3, 1.9, 0.9, 0.0]), 12 + 12 * -np.minimum(d, 0))


class Fields:
    """The rasters the terrain is made from (cell (i, j) is x = X0 + (j + .5) * RES, z = Z0 + (i + .5) * RES)."""
    pass


def make_fields(old_vis, old_col):
    """old_vis: the old ground as drawn; old_col: as collided with (they differ a little, so the new ground hides under the lower of the two)."""
    x0, x1, z0, z1 = BOUNDS; nx, nz = int((x1 - x0) / RES), int((z1 - z0) / RES); F = Fields()
    F.x0, F.z0, F.nx, F.nz = x0, z0, nx, nz
    xs = x0 + (np.arange(nx) + 0.5) * RES; zs = z0 + (np.arange(nz) + 0.5) * RES; X, Z = np.meshgrid(xs, zs); F.X, F.Z = X, Z
    HOv = raster_up(old_vis, x0, z0, nx, nz, RES); HOc = raster_up(old_col, x0, z0, nx, nz, RES); HO = np.fmin(HOv, HOc); inside = np.isfinite(HO)
    inside = _ero(_dil(_dil(inside))); inside |= np.isfinite(HO)   # close pinholes
    sea = ~inside; out = np.zeros_like(sea); out[0] = sea[0]; out[-1] = sea[-1]; out[:, 0] = sea[:, 0]; out[:, -1] = sea[:, -1]
    while True:   # open sea around the island, so a sheer drop inside it still counts as island
        n = _dil(out) & sea
        if (n == out).all(): break
        out = n
    inside = ~out; F.HO = HO; F.inside = inside
    rim = inside & _dil(~inside); rp = np.stack([X[rim], Z[rim]], 1)
    dd = dist_to_points(rp, X, Z); F.dold = np.where(inside, dd, -dd)     # + inside the old island, - outside it
    # an extension of the old ground outward: inverse distance weights on the ring 7 to 9 m inside the old coast (south of z 40)
    ring = inside & (F.dold >= 7.0) & (F.dold <= 9.0) & (Z > 40) & np.isfinite(HO); rx, rz, rh = X[ring], Z[ring], HO[ring]
    need = (F.dold < COLLAR + 1) & (F.dold > -22) & (Z > 36); E = np.full(X.shape, np.nan); ii = np.nonzero(need)
    for k in range(0, ii[0].size, 4096):
        sl = (ii[0][k:k + 4096], ii[1][k:k + 4096]); d2 = (X[sl][:, None] - rx[None]) ** 2 + (Z[sl][:, None] - rz[None]) ** 2; wgt = 1 / (d2 + 1.0) ** 1.25
        E[sl] = (wgt * rh[None]).sum(1) / wgt.sum(1)
    F.E = E
    coast = np.array(DESIGN['coast']); closed = np.vstack([coast, [[coast[-1][0], -60.0], [coast[0][0], -60.0]]])
    # (the shape is closed by two straight sides running north from the coast's ends, through the old island)
    F.poly_in = in_polygon(closed, X, Z); dc, _ = dist_to_polyline(coast, X, Z); F.dcoast = np.where(F.poly_in, dc, -dc)
    # ---- the land
    wo = smooth(np.clip(-F.dold / 18.0, 0, 1))             # 0 on and inside the old coast, 1 eighteen metres out
    n1 = vnoise(X, Z, 28.0, 3); n2 = vnoise(X, Z, 11.0, 5); n3 = vnoise(X, Z, 5.5, 9)
    free = LAND + 2.4 * n1 + 1.1 * n2 + 0.35 * n3
    Ee = np.where(np.isfinite(E), E, free); base = wo * free + (1 - wo) * Ee
    dd, arc = dist_to_polyline(DESIGN['divider'], X, Z)
    crest = np.interp(arc, *CREST); k = smooth(1 - np.clip((dd - DIVIDER_TOP) / DIVIDER_FOOT, 0, 1))
    base = base + np.maximum(0, crest + 0.8 * n2 - base) * k
    for mx, mz, r, h in MOUNDS:
        d = np.hypot(X - mx, Z - mz); base = base + h * np.where(d < r, np.cos(np.pi / 2 * d / r) ** 2, 0.0)
    for key in ('spawnA', 'spawnB'):
        s = DESIGN[key]; d = np.hypot(X - s['c'][0], Z - s['c'][1]); c1 = smooth(1 - np.clip((d - (s['r'] + 1.5)) / 7.5, 0, 1))
        base = base * (1 - c1) + (s['level'] + 0.25 * n3) * c1
    F.base0 = base.copy()
    # the roads: each one's grade along it, then the ground levelled to it
    ground = np.where(inside & (F.dold > 0), HO, base)         # what's there before the road goes through: the old ground, or the new land
    F.roads = {}; HOg = HO.copy()                                  # (HOg: the old ground as it is once the game has levelled it along the roads)
    for key in ('roadA', 'roadB'):
        C, h = road_profile(F, key, ground); F.roads[key] = (C, h)
        dist = np.full(X.shape, np.inf); hh = np.zeros(X.shape)
        for q in range(len(C)):
            d = np.hypot(X - C[q, 0], Z - C[q, 1]); m = d < dist; dist = np.where(m, d, dist); hh = np.where(m, h[q], hh)
        c2 = smooth(1 - np.clip((dist - FLAT) / BLEND, 0, 1)); base = base * (1 - c2) + hh * c2; HOg = HOg * (1 - c2) + hh * c2
    for px, pz, pr, pb, ph in PADS:
        c3 = smooth(1 - np.clip((np.hypot(X - px, Z - pz) - pr) / pb, 0, 1)); HOg = HOg * (1 - c3) + ph * c3; base = base * (1 - c3) + ph * c3
    F.HOg = HOg; F.base = base
    F.land = np.maximum(base - cliff_drop(F.dcoast), -40.0)   # (well under the level's kill height, so no ledge out there can hold anyone)
    return F


def road_profile(F, key, ground):
    """(centre line every metre, height of the road at each point): the ground along it smoothed, kept to MAX_GRADE, starting on the road it branches
    from and ending on the clearing."""
    C = resample(DESIGN[key], 1.0); s = DESIGN['spawnA' if key == 'roadA' else 'spawnB']
    C = resample(np.vstack([C, resample([C[-1], s['c']], 1.0)[1:]]), 1.0)   # on into the clearing, a point every metre
    gi = np.clip(((C[:, 0] - F.x0) / RES).astype(int), 0, F.nx - 1); gj = np.clip(((C[:, 1] - F.z0) / RES).astype(int), 0, F.nz - 1)
    g = ground[gj, gi].copy(); g = np.where(np.isfinite(g), g, LAND)
    h = g.copy()
    for _ in range(4): h = np.convolve(np.pad(h, 7, mode='edge'), np.ones(15) / 15, 'valid')
    h[0] = g[0]; n = len(h); end = np.hypot(*(C - np.array(s['c'])).T) < s['r'] * 0.8
    h = np.where(end, s['level'], h)
    pin = np.zeros(n, bool); pin[0] = True; pin[end] = True
    for _ in range(60):                                                  # keep the grade down, forward and back, leaving the pinned ends alone
        for i in range(1, n):
            if not pin[i]: h[i] = np.clip(h[i], h[i - 1] - MAX_GRADE, h[i - 1] + MAX_GRADE)
        for i in range(n - 2, -1, -1):
            if not pin[i]: h[i] = np.clip(h[i], h[i + 1] - MAX_GRADE, h[i + 1] + MAX_GRADE)
    return C, h


def sample(F, A, x, z):
    """Bilinear sample of raster A at world (x, z) (arrays)."""
    u = (np.asarray(x) - F.x0) / RES - 0.5; v = (np.asarray(z) - F.z0) / RES - 0.5
    i = np.clip(np.floor(v).astype(int), 0, F.nz - 2); j = np.clip(np.floor(u).astype(int), 0, F.nx - 2); fu = np.clip(u - j, 0, 1); fv = np.clip(v - i, 0, 1)
    return (A[i, j] * (1 - fu) + A[i, j + 1] * fu) * (1 - fv) + (A[i + 1, j] * (1 - fu) + A[i + 1, j + 1] * fu) * fv


def grid_mesh(P, ok, flip_seed=1):
    """Triangles over a grid of points P (rows, cols, 3) wherever all four corners are ok. Returns (verts, faces) with unused points dropped."""
    R, C = ok.shape; rng = np.random.RandomState(flip_seed); faces = []
    for i in range(R - 1):
        for j in range(C - 1):
            if not (ok[i, j] and ok[i, j + 1] and ok[i + 1, j] and ok[i + 1, j + 1]): continue
            a, b, c, d = i * C + j, i * C + j + 1, (i + 1) * C + j, (i + 1) * C + j + 1
            if rng.rand() < 0.5: faces += [(a, c, b), (b, c, d)]
            else: faces += [(a, c, d), (a, d, b)]
    faces = np.array(faces, int).reshape(-1, 3); used = np.unique(faces); remap = -np.ones(R * C, int); remap[used] = np.arange(len(used))
    return P.reshape(-1, 3)[used], remap[faces]


def build_land(F, spacing=1.5, seed=11):
    """The new ground as a jittered grid mesh: (verts, faces)."""
    x0, x1, z0, z1 = BOUNDS; rng = np.random.RandomState(seed)
    xs = np.arange(x0, x1 + spacing, spacing); zs = np.arange(z0, z1 + spacing, spacing); GX, GZ = np.meshgrid(xs, zs)
    GX = GX + rng.uniform(-0.3, 0.3, GX.shape) * spacing; GZ = GZ + rng.uniform(-0.3, 0.3, GZ.shape) * spacing
    GX = np.clip(GX, x0 + 1, x1 - 1); GZ = np.clip(GZ, z0 + 1, z1 - 1)
    dc = sample(F, F.dcoast, GX, GZ); do = sample(F, F.dold, GX, GZ)
    ok = (dc >= -spacing * 1.2) & (do <= COLLAR) & (GZ >= np.where(GX < 0, 45.5, 38.3))   # (not north of where the coast starts, at either end)
    land = sample(F, F.land, GX, GZ); ho = sample(F, np.where(np.isfinite(F.HOg), F.HOg, -999.0), GX, GZ)
    # inside the old coast's collar the new ground follows the old (hiding under it) deep in, and eases up to its own level toward the coast
    b = smooth((do - (COLLAR - 4.0)) / 4.0); inold = (do > 0) & (ho > -900)
    H = np.where(inold, b * (ho - HIDE) + (1 - b) * land, land)
    return grid_mesh(np.stack([GX, H, GZ], -1), ok)


def face_up(v, f):
    """Flip any triangle that faces down, so every face of a ground mesh points up."""
    n = np.cross(v[f[:, 1]] - v[f[:, 0]], v[f[:, 2]] - v[f[:, 0]]); f = f.copy(); dn = n[:, 1] < 0; f[dn] = f[dn][:, [0, 2, 1]]; return v, f


def road_ribbon(F, key, width=ROAD_W, lift=0.08):
    """A strip along road `key` from where it branches to its clearing, lying on the levelled ground: (verts, faces, uv). v runs along it, a texture tile every 8 m."""
    C, h = F.roads[key]; s = DESIGN['spawnA' if key == 'roadA' else 'spawnB']
    keep = np.hypot(*(C - np.array(s['c'])).T) > s['r'] * 0.55; C, h = C[keep], h[keep]            # stop short of the middle of the clearing
    t = np.gradient(C, axis=0); t /= np.hypot(t[:, 0], t[:, 1])[:, None]; nrm = np.stack([-t[:, 1], t[:, 0]], 1); n = len(C)
    arc = np.r_[0, np.cumsum(np.hypot(*np.diff(C, axis=0).T))]
    V = []; UV = []
    for k, off in enumerate((-width / 2, 0, width / 2)):
        P = C + nrm * off; V.append(np.stack([P[:, 0], h + lift, P[:, 1]], 1)); UV.append(np.stack([np.full(n, k / 2.0), arc / 8.0], 1))
    V = np.vstack(V); UV = np.vstack(UV); Fc = []
    for q in range(n - 1):
        for col in (0, 1):
            a, b, c, d = col * n + q, col * n + q + 1, (col + 1) * n + q, (col + 1) * n + q + 1
            Fc += [(a, b, c), (b, d, c)]
    Fc = np.array(Fc, int); v, f = face_up(V, Fc)
    return v, f, UV


def merge(*meshes):
    V = []; Fc = []; off = 0
    for m in meshes:
        v, f = m[0], m[1]; V.append(v); Fc.append(f + off); off += len(v)
    return np.vstack(V), np.vstack(Fc)


# ---- the painted ground texture: the Fortress ground's own palette (the dominant colours of its painted map), laid out as soft flat blobs
PALETTE = dict(dark_olive=(83, 77, 45), olive=(100, 91, 61), dark_green=(56, 74, 42), teal=(44, 70, 54), taupe=(123, 105, 89), pale=(163, 149, 149))


def blur(a, sigma):
    """Gaussian-ish blur of an image (three box passes along each axis; numpy only, since Blender's Python has no PIL)."""
    w = max(1, int(round(sigma * 1.73))) * 2 + 1; a = a.astype(np.float32)
    for ax in (0, 1):
        for _ in range(3):
            pad = [(0, 0)] * a.ndim; pad[ax] = (w // 2, w // 2); p = np.pad(a, pad, mode='edge'); c = np.cumsum(p, axis=ax, dtype=np.float64)
            hi = np.take(c, np.arange(w - 1, p.shape[ax]), axis=ax); lo = np.concatenate([np.zeros_like(np.take(c, [0], axis=ax)), np.take(c, np.arange(0, p.shape[ax] - w), axis=ax)], axis=ax)
            a = ((hi - lo) / w).astype(np.float32)
    return a


def paint_ground(F, box, size=(2048, 1024), seed=21):
    """RGB uint8 image of the new ground over world box (x0, x1, z0, z1): row 0 is z0, column 0 is x0. Returns (image, (x0, x1, z0, z1))."""
    x0, x1, z0, z1 = box; W, H = size
    xs = x0 + (np.arange(W) + 0.5) * (x1 - x0) / W; zs = z0 + (np.arange(H) + 0.5) * (z1 - z0) / H; X, Z = np.meshgrid(xs, zs)
    h = sample(F, F.land, X, Z); gz, gx = np.gradient(F.land, RES); slope = np.hypot(gx, gz); sl = sample(F, slope, X, Z)
    dc = sample(F, F.dcoast, X, Z)
    na, nb, nc, nd = vnoise(X, Z, 30.0, seed), vnoise(X, Z, 12.0, seed + 1), vnoise(X, Z, 5.0, seed + 2), vnoise(X, Z, 2.2, seed + 3)
    r = 0.55 * na + 0.33 * nb + 0.1 * nc + 0.05 * nd + 0.14 * (h - LAND) / 3.0
    out = np.zeros(X.shape + (3,), np.float32)
    P = PALETTE; cuts = [(-0.6, P['teal']), (-0.3, P['dark_green']), (0.05, P['dark_olive']), (0.4, P['olive']), (0.62, P['taupe']), (9, P['pale'])]
    lo = -9
    for hi, col in cuts:
        m = (r >= lo) & (r < hi); out[m] = col; lo = hi
    out[sl > 0.55] = P['taupe']; out[sl > 1.0] = P['pale']                       # steep ground is rock
    out[(dc < 2.5) & (sl > 0.35)] = P['taupe']
    return np.clip(blur(out, 1.6), 0, 255).astype(np.uint8), (x0, x1, z0, z1)


def road_texture(n=256, m=1024, seed=4):
    """A tile of the painted road: its pale colour with long soft streaks along it (v along m)."""
    rng = np.random.RandomState(seed); img = np.zeros((m, n, 3), np.float32); img[:] = (163, 149, 149)
    for _ in range(90):
        x = rng.randint(0, n); w = rng.randint(2, 9); y0 = rng.randint(0, m); L = rng.randint(60, 300); d = rng.choice([-14, -8, 8, 12])
        for yy in range(y0, y0 + L): img[yy % m, max(0, x - w // 2): x + w // 2 + 1] += d
    edge = 18; img[:, :edge] = img[:, :edge] * 0.85 + np.array(PALETTE['taupe']) * 0.15; img[:, -edge:] = img[:, -edge:] * 0.85 + np.array(PALETTE['taupe']) * 0.15
    return np.clip(blur(img, 1.0), 0, 255).astype(np.uint8)
