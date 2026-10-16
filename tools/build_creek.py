# Creek: an original free-for-all map in the spirit of a classic two-base canyon map. Everything here is generated
# from scratch: terrain, creek, cliffs, rock arch, boulders, both bases and their textures.
#
#   /Applications/Blender\ 5.2.app/Contents/MacOS/Blender -b --python tools/build_creek.py
#
# Writes models/Creek.glb (what's drawn) and models/Creek_col.glb (what everything collides with).
# Blender is Z up; the game is Y up: game (x, y, z) = Blender (X, Z, -Y). Sizes are metres.
import bpy, bmesh, math, os, random, tempfile
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'models')
TMP = os.path.join(tempfile.gettempdir(), 'creek_tex')   # the generated textures, before they're packed into the .glb
os.makedirs(TMP, exist_ok=True)
random.seed(7)
rng = np.random.default_rng(7)

bpy.ops.wm.read_factory_settings(use_empty=True)

# ---------------------------------------------------------------- shapes of the land
A, B, P = 47.0, 24.0, 4.0           # canyon floor: a rounded rectangle (superellipse), half length and half width
EXT_X, EXT_Y = 54.0, 31.0           # terrain extent (it runs on under the cliffs)
MOUNDS = [(10, -13, 1.0, 4.0), (-10, 13, 1.0, 4.0), (15, 7, 0.7, 3.5), (-15, -7, 0.7, 3.5)]

def smooth(t): t = min(1.0, max(0.0, t)); return t * t * (3 - 2 * t)
def creek_x(y): return 2.0 * math.sin(y / 7.0) + 0.7 * math.sin(y / 2.9 + 1.0)
def rim(x, y): return (abs(x / A) ** P + abs(y / B) ** P) ** (1 / P)   # 1 at the foot of the cliffs

def height(x, y):
    d = abs(x - creek_x(y))
    bank = smooth((d - 1.5) / 1.8)                       # 0 in the creek bed, 1 up on the field
    z = -1.0 + bank
    field = smooth((d - 3.5) / 3) * (1 - smooth((abs(x) - 17) / 3))   # bumps only out in the open, not at the bases
    for mx, my, mh, mr in MOUNDS: z += field * mh * math.exp(-((x - mx) ** 2 + (y - my) ** 2) / mr ** 2)
    z += field * 0.12 * math.sin(x * 0.7 + y * 0.3) * math.sin(y * 0.5 - x * 0.2)
    z += 1.2 * smooth((rim(x, y) - 0.93) / 0.1) * bank   # the floor turns up a little at the foot of the cliffs
    return z

# ---------------------------------------------------------------- textures (numpy, tiling where they repeat)
def vnoise(w, h, cells, seed, tile=True):
    r = np.random.default_rng(seed); cx, cy = cells
    g = r.random((cy + 1, cx + 1))
    if tile: g[-1, :] = g[0, :]; g[:, -1] = g[:, 0]
    xs = np.linspace(0, cx, w, endpoint=False); ys = np.linspace(0, cy, h, endpoint=False)
    x0 = xs.astype(int); y0 = ys.astype(int); fx = xs - x0; fy = ys - y0
    fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy)
    a = g[np.ix_(y0, x0)]; b = g[np.ix_(y0, x0 + 1)]; c = g[np.ix_(y0 + 1, x0)]; d = g[np.ix_(y0 + 1, x0 + 1)]
    top = a + (b - a) * fx[None, :]; bot = c + (d - c) * fx[None, :]
    return top + (bot - top) * fy[:, None]

def fbm(w, h, base, seed, octaves=5, tile=True):
    out = np.zeros((h, w)); amp = 1.0; tot = 0.0
    for o in range(octaves):
        out += amp * vnoise(w, h, (base[0] * 2 ** o, base[1] * 2 ** o), seed + o, tile); tot += amp; amp *= 0.5
    return out / tot

def save_image(name, rgb):
    h, w, _ = rgb.shape
    img = bpy.data.images.new(name, w, h, alpha=False)
    px = np.ones((h, w, 4), dtype=np.float32); px[:, :, :3] = np.clip(rgb, 0, 1)
    img.pixels.foreach_set(px[::-1].ravel())            # Blender images start at the bottom row
    img.filepath_raw = os.path.join(TMP, name + '.png'); img.file_format = 'PNG'; img.save()
    return img

def col(hexstr): return np.array([int(hexstr[i:i + 2], 16) / 255 for i in (0, 2, 4)])

# Terrain: one image over the whole floor, painted from the land itself (grass, worn dirt, creek gravel)
TW, TH = 1024, 640
def terrain_image():
    xs = np.linspace(-EXT_X, EXT_X, TW); ys = np.linspace(EXT_Y, -EXT_Y, TH)   # row 0 is +Y (top of the image)
    Z = np.array([[height(x, y) for x in xs] for y in ys])
    D = np.array([[abs(x - creek_x(y)) for x in xs] for y in ys])
    X, Y = np.meshgrid(xs, ys)
    n1 = fbm(TW, TH, (16, 10), 11, tile=False); n2 = fbm(TW, TH, (64, 40), 12, 3, tile=False); n3 = fbm(TW, TH, (6, 4), 13, 3, tile=False)
    grass = col('5f7038')[None, None] * (0.8 + 0.4 * n1[..., None]) + (col('7c8a45') - col('5f7038'))[None, None] * n3[..., None]
    dirt = col('8a7556')[None, None] * (0.85 + 0.3 * n2[..., None])
    gravel = col('6b665c')[None, None] * (0.7 + 0.5 * n2[..., None])
    rock = col('77706a')[None, None] * (0.8 + 0.3 * n2[..., None])
    wear = np.clip(1.2 - D / 4.0, 0, 1)                                   # bare dirt along the creek banks
    path = np.clip(1 - np.abs(Y) / 3.5, 0, 1) * np.clip((np.abs(X) - 4) / 3, 0, 1) * np.clip((24 - np.abs(X)) / 3, 0, 1) * 0.8
    pad = np.clip((np.abs(X) - 19) / 2, 0, 1) * np.clip((14 - np.abs(Y)) / 2, 0, 1)   # trodden ground around the bases
    mix = np.clip(np.maximum(np.maximum(wear, path), pad * 0.7) + (n1 - 0.5) * 0.6, 0, 1)[..., None]
    rgb = grass * (1 - mix) + dirt * mix
    bed = np.clip((-Z - 0.55) / 0.3, 0, 1)[..., None]; rgb = rgb * (1 - bed) + gravel * bed
    R = (np.abs(X / A) ** P + np.abs(Y / B) ** P) ** (1 / P)
    foot = np.clip((R - 0.94) / 0.06, 0, 1)[..., None]; rgb = rgb * (1 - foot) + rock * foot
    rgb *= (0.92 + 0.16 * n2[..., None])
    return save_image('Creek_Ground', rgb)

def rock_image():
    S = 512; n = fbm(S, S, (8, 8), 21); m = fbm(S, S, (32, 32), 22, 3)
    v = np.linspace(0, 1, S, endpoint=False)[:, None]
    strata = 0.5 + 0.5 * np.sin((v * 14 + n * 2.2) * 2 * math.pi)
    crack = np.clip(1 - np.abs(fbm(S, S, (6, 10), 23, 4) - 0.5) * 40, 0, 1)
    base = col('8a8076')[None, None] * (0.75 + 0.25 * strata[..., None]) * (0.85 + 0.3 * m[..., None])
    base = base * (1 - 0.3 * crack[..., None]) + (col('6f6a52') - col('8a8076'))[None, None] * np.clip(n - 0.62, 0, 1)[..., None] * 2
    return save_image('Creek_Rock', base)

def metal_image(name, tint, seams=4):
    S = 512; n = fbm(S, S, (16, 16), 31, 4); m = fbm(S, S, (64, 64), 32, 2)
    rgb = col(tint)[None, None] * (0.88 + 0.16 * n[..., None] + 0.06 * m[..., None])
    step = S // seams; idx = np.arange(S)
    seam = ((idx % step) < 3) | ((idx % step) > step - 3)
    rgb[seam, :] *= 0.6; rgb[:, seam] *= 0.6
    for i in range(seams):                                              # rivets near the panel corners
        for j in range(seams):
            for dx, dy in ((10, 10), (step - 10, 10), (10, step - 10), (step - 10, step - 10)):
                cy, cx = i * step + dy, j * step + dx
                rgb[max(0, cy - 2):cy + 2, max(0, cx - 2):cx + 2] *= 0.7
    streak = fbm(S, S, (24, 3), 33, 3)[..., None]                          # rain streaks
    return save_image(name, rgb * (0.9 + 0.12 * streak))

IMG = {'ground': terrain_image(), 'rock': rock_image(), 'metal': metal_image('Creek_Metal', '8e98a1'), 'floor': metal_image('Creek_Floor', '5d6166', 2)}

def srgb_lin(c): return tuple(x ** 2.2 for x in c)
def material(name, img=None, color=(1, 1, 1)):
    m = bpy.data.materials.new(name); m.use_nodes = True; m.use_backface_culling = False
    bsdf = m.node_tree.nodes['Principled BSDF']; bsdf.inputs['Roughness'].default_value = 0.9
    if img:
        t = m.node_tree.nodes.new('ShaderNodeTexImage'); t.image = img
        m.node_tree.links.new(t.outputs['Color'], bsdf.inputs['Base Color'])
    else: bsdf.inputs['Base Color'].default_value = (*srgb_lin(color), 1)
    return m

MAT = {
    'ground': material('Ground', IMG['ground']), 'rock': material('Rock', IMG['rock']),
    'metal': material('Base_Metal', IMG['metal']), 'floor': material('Base_Floor', IMG['floor']),
    'trim': material('Base_Trim', color=(0.24, 0.26, 0.29)),
    'orange': material('Accent_Orange', color=(0.85, 0.45, 0.12)), 'teal': material('Accent_Teal', color=(0.12, 0.6, 0.62)),
    'water': material('Creek_Water', color=(0.25, 0.45, 0.52)),
    'pine': material('Pine', color=(0.2, 0.32, 0.2)), 'bark': material('Bark', color=(0.32, 0.24, 0.17)),
}

# ---------------------------------------------------------------- mesh building
class Builder:
    """Collects faces per material; each face gets UVs from world position (box projection) unless given."""
    def __init__(s): s.parts = {}
    def face(s, mat, pts, uvs=None, uvscale=4.0):
        p = s.parts.setdefault(mat, ([], [], []))
        base = len(p[0]); p[0].extend(pts)
        if uvs is None:
            a, b, c = pts[0], pts[1], pts[2]
            n = np.cross(np.subtract(b, a), np.subtract(c, a)); ax = int(np.argmax(np.abs(n)))
            uvs = [((q[1], q[2]) if ax == 0 else (q[0], q[2]) if ax == 1 else (q[0], q[1])) for q in pts]
            uvs = [(u / uvscale, v / uvscale) for u, v in uvs]
        p[2].extend(uvs); p[1].append(list(range(base, base + len(pts))))
    def box(s, mat, x0, x1, y0, y1, z0, z1, uvscale=6.0):
        v = [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0), (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]
        for f in ((0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)):
            s.face(mat, [v[i] for i in f], uvscale=uvscale)
    def build(s, name, collection):
        objs = []
        for mat, (verts, faces, uvs) in s.parts.items():
            me = bpy.data.meshes.new(f'{name}_{mat}'); me.from_pydata([tuple(map(float, v)) for v in verts], [], faces)
            uvl = me.uv_layers.new(name='UV')
            for poly in me.polygons:
                for li in poly.loop_indices: uvl.data[li].uv = uvs[me.loops[li].vertex_index]
            me.materials.append(MAT[mat]); me.validate(); me.update()
            ob = bpy.data.objects.new(f'{name}_{mat}', me); collection.objects.link(ob); objs.append(ob)
        return objs

draw = bpy.data.collections.new('Draw'); bpy.context.scene.collection.children.link(draw)
both = bpy.data.collections.new('Solid'); bpy.context.scene.collection.children.link(both)   # drawn and collided with

# Terrain: a height grid, trimmed to just past the foot of the cliffs
def terrain():
    bm = Builder(); S = 0.5
    nx, ny = int(2 * EXT_X / S) + 1, int(2 * EXT_Y / S) + 1
    xs = [-EXT_X + i * S for i in range(nx)]; ys = [-EXT_Y + j * S for j in range(ny)]
    Z = [[height(x, y) for x in xs] for y in ys]
    uv = lambda x, y: ((x + EXT_X) / (2 * EXT_X), (y + EXT_Y) / (2 * EXT_Y))
    for j in range(ny - 1):
        for i in range(nx - 1):
            x0, x1, y0, y1 = xs[i], xs[i + 1], ys[j], ys[j + 1]
            if rim((x0 + x1) / 2, (y0 + y1) / 2) > 1.12: continue
            pts = [(x0, y0, Z[j][i]), (x1, y0, Z[j][i + 1]), (x1, y1, Z[j + 1][i + 1]), (x0, y1, Z[j + 1][i])]
            bm.face('ground', pts, [uv(p[0], p[1]) for p in pts])
    return bm.build('Terrain', both)

# Cliffs: rings of rock leaning outward as they climb, all the way round the canyon
def cliffs():
    bm = Builder(); M = 180
    rows = [(-1.5, -0.6), (1.5, 0.0), (4.0, 0.7), (7.5, 1.8), (11.0, 3.0), (15.0, 4.6), (19.0, 6.8), (22.5, 9.5), (24.0, 15.0)]
    ph = [random.random() * 6.28 for _ in range(6)]
    def foot(t):  # radius scale at angle t: lumpy, so the walls aren't a clean oval
        return 1.0 + 0.025 * math.sin(3 * t + ph[0]) + 0.02 * math.sin(7 * t + ph[1]) + 0.012 * math.sin(13 * t + ph[2])
    grid = []
    for k, (z, out) in enumerate(rows):
        ring = []
        for i in range(M):
            t = 2 * math.pi * i / M; c, s = math.cos(t), math.sin(t)
            r = foot(t) / (abs(c / A) ** P + abs(s / B) ** P) ** (1 / P)
            j = 0 if k == 0 else random.uniform(-0.45, 0.45)
            zz = z + (0 if k in (0, len(rows) - 1) else random.uniform(-0.6, 0.6)) + (1.5 * math.sin(5 * t + ph[3]) + math.sin(11 * t + ph[4]) if k >= len(rows) - 2 else 0)
            ring.append((c * (r + out + j), s * (r + out + j), zz))
        grid.append(ring)
    arc = [0.0]
    for i in range(1, M + 1): arc.append(arc[-1] + math.dist(grid[1][i - 1][:2], grid[1][i % M][:2]))
    for k in range(len(rows) - 1):
        for i in range(M):
            a, b = grid[k][i], grid[k][(i + 1) % M]; c, d = grid[k + 1][(i + 1) % M], grid[k + 1][i]
            u0, u1 = arc[i] / 10, arc[i + 1] / 10
            bm.face('rock', [a, d, c, b], [(u0, a[2] / 10), (u0, d[2] / 10), (u1, c[2] / 10), (u1, b[2] / 10)])
    return bm.build('Cliffs', both), grid[-2]

# Rock arch: a natural bridge over the creek, walkable on top, with ramps of rock down to the field at both ends
def arch():
    bm = Builder(); p0, p1, top, NS = (-10.5, 5.5), (10.5, -5.5), 3.2, 56
    L = math.dist(p0, p1); dx, dy = (p1[0] - p0[0]) / L, (p1[1] - p0[1]) / L; nx, ny = -dy, dx
    rings = []
    for k in range(NS + 1):
        t = k / NS; x, y = p0[0] + dx * L * t, p0[1] + dy * L * t
        e = min(1.0, t / 0.33, (1 - t) / 0.33); deck = top * (0.5 - 0.5 * math.cos(math.pi * e)) - 0.15
        hole = 0.26 < t < 0.74; under = deck - 1.0 if hole else -1.6
        w = 1.7 + (0.5 if not hole else 0.25) * (1 - e)                # the legs flare out at the ends
        j = lambda: random.uniform(-0.12, 0.12)
        prof = [(-w + 0.2, deck - 0.25), (-w * 0.6, deck), (0, deck + 0.05), (w * 0.6, deck), (w - 0.2, deck - 0.25),
                (w + 0.25 + j(), (deck + under) / 2 + j()), (w * 0.7, under), (0, under - 0.15), (-w * 0.7, under), (-w - 0.25 + j(), (deck + under) / 2 + j())]
        rings.append([(x + nx * a, y + ny * a, z) for a, z in prof])
    n = len(rings[0])
    for k in range(NS):
        for i in range(n):
            a, b = rings[k][i], rings[k][(i + 1) % n]; c, d = rings[k + 1][(i + 1) % n], rings[k + 1][i]
            bm.face('rock', [a, b, c, d], uvscale=5)
    bm.face('rock', rings[0][::-1], uvscale=5); bm.face('rock', rings[-1], uvscale=5)
    return bm.build('Arch', both)

def boulders():
    objs = []
    spots = [(6, 12, 1.6), (12, -3, 1.3), (16, 15, 1.4), (18, -12, 1.2), (5.5, -15, 1.0), (8, 1.5, 0.9)]
    for k, (x, y, r) in enumerate(spots + [(-x, -y, r) for x, y, r in spots]):
        bm = bmesh.new(); bmesh.ops.create_icosphere(bm, subdivisions=2, radius=1.0)
        rot = random.uniform(0, 6.28)
        for v in bm.verts:
            f = 1 + random.uniform(-0.12, 0.12)
            vx, vy, vz = v.co.x * 1.25 * r * f, v.co.y * 0.95 * r * f, v.co.z * 0.75 * r * f
            v.co.x = x + vx * math.cos(rot) - vy * math.sin(rot); v.co.y = y + vx * math.sin(rot) + vy * math.cos(rot)
            v.co.z = height(x, y) + 0.35 * r + vz
        me = bpy.data.meshes.new(f'Boulder_{k}'); bm.to_mesh(me); bm.free()
        while me.uv_layers: me.uv_layers.remove(me.uv_layers[0])   # one UV set only (the icosphere comes with its own)
        uvl = me.uv_layers.new(name='UV')
        for poly in me.polygons:
            ax = int(np.argmax(np.abs(poly.normal)))
            for li in poly.loop_indices:
                q = me.vertices[me.loops[li].vertex_index].co
                uvl.data[li].uv = ((q.y, q.z) if ax == 0 else (q.x, q.z) if ax == 1 else (q.x, q.y))
                uvl.data[li].uv = (uvl.data[li].uv[0] / 4, uvl.data[li].uv[1] / 4)
        me.materials.append(MAT['rock'])
        for poly in me.polygons: poly.use_smooth = False
        ob = bpy.data.objects.new(f'Boulder_{k}', me); both.objects.link(ob); objs.append(ob)
    return objs

# A base: ground-floor rooms (front room, back room), side ramps up to a roof with a parapet, and a raised platform at
# the back of the roof. Built for the +X end facing the creek; the other base is the same turned half round.
def base(sign, accent):
    s = Builder(); d = Builder()
    def bx(b, mat, x0, x1, y0, y1, z0, z1):                 # base-local box -> world (turned half round for sign < 0)
        if sign < 0: x0, x1, y0, y1 = -x1, -x0, -y1, -y0
        b.box(mat, x0, x1, y0, y1, z0, z1)
    W, H, T, ROOF = 0.4, 3.4, 0.4, 3.8                      # wall thickness, room height, roof thickness, roof deck height
    X0, X1, Y0 = 22.0, 40.0, 10.0
    bx(s, 'floor', X0, X1, -Y0, Y0, -0.25, 0.05)
    bx(s, 'metal', X0, X1, -Y0, Y0, H, ROOF)                # roof slab
    # Front wall (toward the creek): a wide doorway in the middle and a window either side
    for y0, y1 in ((-Y0, -7.0), (-4.5, -1.6), (1.6, 4.5), (7.0, Y0)): bx(s, 'metal', X0, X0 + W, y0, y1, 0, H)
    for y0, y1 in ((-7.0, -4.5), (4.5, 7.0)): bx(s, 'metal', X0, X0 + W, y0, y1, 0, 1.2); bx(s, 'metal', X0, X0 + W, y0, y1, 2.3, H)
    bx(s, 'metal', X0, X0 + W, -1.6, 1.6, 2.6, H)
    bx(s, 'metal', X1 - W, X1, -Y0, Y0, 0, H)               # back wall
    for sy in (-1, 1):                                      # side walls, each with a door near the back
        y0, y1 = (Y0 - W, Y0) if sy > 0 else (-Y0, -Y0 + W)
        bx(s, 'metal', X0, 36.5, y0, y1, 0, H); bx(s, 'metal', 38.5, X1, y0, y1, 0, H); bx(s, 'metal', 36.5, 38.5, y0, y1, 2.6, H)
    # Inside: a dividing wall with a doorway, and low cover in the front room
    bx(s, 'metal', 30.8, 31.2, -Y0 + W, -1.6, 0, H); bx(s, 'metal', 30.8, 31.2, 1.6, Y0 - W, 0, H); bx(s, 'metal', 30.8, 31.2, -1.6, 1.6, 2.6, H)
    for y0, y1 in ((-4.6, -3.0), (3.0, 4.6)): bx(s, 'trim', 25.5, 27.0, y0, y1, 0, 1.1)
    # Ramps up the outside of both side walls, front to back, with a landing level with the roof
    for sy in (-1, 1):
        ya, yb = (Y0, Y0 + 2.6) if sy > 0 else (-Y0 - 2.6, -Y0)
        xa, xb, xc = X0, 33.0, 35.2
        quad = lambda pts: s.face('metal', [(-p[0], -p[1], p[2]) if sign < 0 else p for p in pts], uvscale=6.0)
        quad([(xa, ya, 0.0), (xb, ya, ROOF), (xb, yb, ROOF), (xa, yb, 0.0)])            # slope
        quad([(xa, ya, 0.0), (xa, yb, 0.0), (xb, yb, 0), (xb, ya, 0)])                  # underside
        quad([(xa, ya, 0.0), (xb, ya, 0), (xb, ya, ROOF)]); quad([(xa, yb, 0.0), (xb, yb, ROOF), (xb, yb, 0)])   # sides
        bx(s, 'metal', xb, xc, ya, yb, 0, ROOF)                                              # landing
    # Roof parapet, open where the ramps arrive
    PH = ROOF + 1.0
    bx(s, 'metal', X0, X0 + 0.3, -Y0, Y0, ROOF, PH); bx(s, 'metal', X1 - 0.3, X1, -Y0, Y0, ROOF, PH)
    for sy in (-1, 1):
        y0, y1 = (Y0 - 0.3, Y0) if sy > 0 else (-Y0, -Y0 + 0.3)
        bx(s, 'metal', X0, 32.6, y0, y1, ROOF, PH); bx(s, 'metal', 35.4, X1, y0, y1, ROOF, PH)
    # Raised platform at the back of the roof, a ramp up its middle, and its own low wall at the back and sides
    PT = 5.3
    bx(s, 'metal', 35.6, X1 - 0.3, -6.0, 6.0, ROOF, PT)
    q2 = lambda pts: s.face('floor', [(-p[0], -p[1], p[2]) if sign < 0 else p for p in pts], uvscale=6.0)
    q2([(31.0, -1.5, ROOF), (35.6, -1.5, PT), (35.6, 1.5, PT), (31.0, 1.5, ROOF)])
    q2([(31.0, -1.5, ROOF), (35.6, -1.5, ROOF), (35.6, -1.5, PT)]); q2([(31.0, 1.5, ROOF), (35.6, 1.5, PT), (35.6, 1.5, ROOF)])
    bx(s, 'metal', X1 - 0.6, X1 - 0.3, -6.0, 6.0, PT, PT + 0.9)
    for sy in (-1, 1): bx(s, 'metal', 35.6, X1 - 0.3, (5.7 if sy > 0 else -6.0), (6.0 if sy > 0 else -5.7), PT, PT + 0.9)
    # Decoration (drawn only): a coloured band round the top of the walls, door frames, roof lights
    bx(d, accent, X0 - 0.05, X0, -Y0, Y0, 2.9, 3.15)
    for sy in (-1, 1): bx(d, accent, X0, X1, (Y0 if sy > 0 else -Y0 - 0.05), (Y0 + 0.05 if sy > 0 else -Y0), 2.9, 3.15)
    bx(d, 'trim', X0 - 0.08, X0, -1.8, -1.6, 0, 2.8); bx(d, 'trim', X0 - 0.08, X0, 1.6, 1.8, 0, 2.8); bx(d, 'trim', X0 - 0.08, X0, -1.8, 1.8, 2.6, 2.8)
    for y in (-6, 6): bx(d, accent, X0 - 0.06, X0, y - 1.4, y + 1.4, 1.1, 1.2)
    name = 'BaseE' if sign > 0 else 'BaseW'
    return s.build(name, both) + d.build(name + '_Deco', draw)

def barriers():
    s = Builder()
    for sg in (1, -1):
        for x0, x1, y0, y1 in ((11.5, 15.5, 9.4, 9.9), (19.5, 20.0, -6.0, -2.5)):
            if sg < 0: x0, x1, y0, y1 = -x1, -x0, -y1, -y0
            z = height((x0 + x1) / 2, (y0 + y1) / 2)
            s.box('trim', x0, x1, y0, y1, z - 0.3, z + 1.15, uvscale=2)
    return s.build('Barriers', both)

def water():
    s = Builder(); pts = []
    for j in range(-62, 63):
        y = j * 0.5; c = creek_x(y); pts.append((c - 3.0, y, -0.45)); pts.append((c + 3.0, y, -0.45))
    for k in range(0, len(pts) - 2, 2):
        a, b, c, d = pts[k], pts[k + 1], pts[k + 3], pts[k + 2]
        s.face('water', [a, b, c, d], [(a[0] / 6, a[1] / 6), (b[0] / 6, b[1] / 6), (c[0] / 6, c[1] / 6), (d[0] / 6, d[1] / 6)])
    return s.build('Creek_Water', draw)

def pines(top_ring):
    s = Builder()
    for i in range(0, len(top_ring), 4):
        if random.random() < 0.45: continue
        x, y, z = top_ring[i]; f = 1 + 0.06 * random.random(); x *= f; y *= f
        h = random.uniform(5, 9); r = h * 0.28; n = 7; z -= 0.3
        s.box('bark', x - 0.2, x + 0.2, y - 0.2, y + 0.2, z, z + 1.2, uvscale=2)
        for tier, (zb, rr) in enumerate(((z + 1.0, r), (z + 1.0 + h * 0.35, r * 0.75), (z + 1.0 + h * 0.6, r * 0.5))):
            apex = (x, y, zb + h * 0.5)
            ring = [(x + rr * math.cos(2 * math.pi * k / n), y + rr * math.sin(2 * math.pi * k / n), zb) for k in range(n)]
            for k in range(n): s.face('pine', [ring[k], ring[(k + 1) % n], apex])
            s.face('pine', ring[::-1])
    return s.build('Pines', draw)

terrain(); cl, top_ring = cliffs(); arch(); boulders(); barriers(); water(); pines(top_ring)
base(1, 'orange'); base(-1, 'teal')

# Tidy: merge coincident corners and drop any degenerate faces
for ob in list(bpy.data.objects):
    if ob.type != 'MESH': continue
    bm = bmesh.new(); bm.from_mesh(ob.data)
    bmesh.ops.dissolve_degenerate(bm, dist=1e-4, edges=bm.edges[:])
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-4)
    bm.to_mesh(ob.data); bm.free()
    if not len(ob.data.polygons): bpy.data.objects.remove(ob)

def tris(o): return sum(len(p.vertices) - 2 for p in o.data.polygons) if o.type == 'MESH' else 0
def export(path, **kw):
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=False, export_apply=True, export_cameras=False,
                              export_lights=False, export_animations=False, export_skins=False, export_morph=False, export_extras=False, **kw)
    print(f'BUILT {os.path.basename(path)}: {os.path.getsize(path) / 1e6:.2f} MB, {sum(tris(o) for o in bpy.data.objects)} triangles')

disp = os.path.join(OUT, 'Creek.glb'); colp = os.path.join(OUT, 'Creek_col.glb')
export(disp, export_image_format='JPEG', export_jpeg_quality=85, export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=6,
       export_draco_position_quantization=14, export_draco_normal_quantization=10, export_draco_texcoord_quantization=12)
for ob in list(draw.objects): bpy.data.objects.remove(ob)        # the collision file: only what's solid
export(colp, export_materials='PLACEHOLDER', export_texcoords=False, export_normals=False)
