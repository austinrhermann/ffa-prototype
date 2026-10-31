# Sewer (Mike's map, from his iso drafts): a bare blockout to play-test, drawn like the arena levels (the game restyles it,
# see arenaStyle). A walled hall over a sewer channel, three floors:
#   L1 (0 m): a walkway each side of the water, two crossings, so three pools
#   L2 (+5 m): an open floor under the platform (west) and an east floor with six crates, split by an opening down to
#     the sewer with a bridge across the middle
#   L3 (+10 m): a platform at the west end with two crates and two long ramps down to L2, a rocket room off the west wall
# Outside the hall: a long curved stair (enclosed) from the platform corner down to L2; a square stairwell shaft from L1 to
#   L3 round an open well; the perch tower: from the sewer a lift up to L2, then a ladder up through a hatch to the perch,
#   whose window looks back into the hall. The lift and the ladder are made by the game (levelSewer: lifts, ladders).
#
# Run (from the game folder):
#   /Applications/Blender.app/Contents/MacOS/Blender -b --python tools/build_sewer.py -- [scale] [file.blend]
# Writes models/Sewer.glb (what's drawn) and models/Sewer_col.glb (what everything collides with); with a .blend path,
# saves the blockout there too.
#
# Plan coordinates as in the drawings: X east 0..48, Y north 0..24 (the hall), Z up. Floors at 0, 5 and 10 m.
# SCALE stretches the map across (X and Y) but keeps the heights, so stairs and jumps stay the same; levelSewer in
# index.html has the same number and must match. Blender is Z up; the game is Y up: game (x, y, z) = ((X - 24) * SCALE, Z,
# (12 - Y) * SCALE).
import bpy, bmesh, math, os, sys

args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
SCALE = float(args[0]) if args else 1.0
BLEND = args[1] if len(args) > 1 else None
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'models')

bpy.ops.wm.read_factory_settings(use_empty=True)
PARTS = {}   # kind -> list of (bottom ring, top ring) prisms; one mesh object per kind


def prism(kind, ring, z0, z1):
    PARTS.setdefault(kind, []).append(([(x, y, z0) for x, y in ring], [(x, y, z1) for x, y in ring]))


def box(kind, x0, x1, y0, y1, z0, z1):
    if x1 - x0 > 1e-6 and y1 - y0 > 1e-6 and z1 - z0 > 1e-6: prism(kind, [(x0, y0), (x1, y0), (x1, y1), (x0, y1)], z0, z1)


def wall_with_holes(axis, f0, f1, r0, r1, z0, z1, holes):
    """A straight wall: along X (axis 'x', f = its Y range) or Y (axis 'y', f = its X range), from r0 to r1 along its run.
    holes = [(a, b, hz0, hz1)]: doorways and windows."""
    cuts = sorted({r0, r1, *[h[0] for h in holes], *[h[1] for h in holes]})
    for a, b in zip(cuts, cuts[1:]):
        over = sorted((h[2], h[3]) for h in holes if h[0] <= a + 1e-6 and h[1] >= b - 1e-6)
        cur = z0
        for hz0, hz1 in over + [(z1, z1)]:
            if hz0 > cur:
                if axis == 'x': box('wall', a, b, f0, f1, cur, hz0)
                else: box('wall', f0, f1, a, b, cur, hz0)
            cur = max(cur, hz1)


# ---------------------------------------------------------------- the hall's walls (15 m, all the way round)
wall_with_holes('x', -0.4, 0, -0.4, 48.4, -1.6, 15, [(1.2, 6.2, 10, 13),       # curved stair, top (L3)
                                                     (32, 37, 5, 8)])           # curved stair, bottom (L2)
wall_with_holes('x', 24, 24.4, -0.4, 48.4, -1.6, 15, [(10.1, 14.4, 10, 13),     # stairwell: L3
                                                      (0.3, 4.1, 5, 8),         # stairwell: L2
                                                      (0.3, 4.1, 0, 3),         # stairwell: L1
                                                      (37, 40, 0, 3),           # perch tower: L1 (to the lift)
                                                      (41, 44, 5, 8),           # perch tower: L2
                                                      (35.4, 47.7, 10.9, 13.4)])  # the perch's window over the hall
wall_with_holes('y', -0.4, 0, 0, 24, -1.6, 15, [(8.5, 15.8, 10, 13)])           # hallway to the rocket room
wall_with_holes('y', 48, 48.4, 0, 24, -1.6, 15, [])

# ---------------------------------------------------------------- L1: the sewer
box('floor', 0, 48, 18, 24, -1.6, 0)          # north walkway
box('floor', 0, 48, 0, 6, -1.6, 0)            # south walkway
box('floor', 0, 48, 6, 18, -1.6, -1.0)        # channel bed (the water is knee deep)
box('floor', 11, 16, 6, 18, -1.6, 0)          # two crossings, leaving three pools
box('floor', 30.5, 35.5, 6, 18, -1.6, 0)
box('water', 0, 48, 6, 18, -1.0, -0.42)       # drawn only: you wade through it

# ---------------------------------------------------------------- L2: second floor
box('floor', 0, 20, 0, 24, 4.5, 5)            # under the platform
box('floor', 30, 48, 0, 24, 4.5, 5)           # east floor
box('floor', 20, 30, 11, 14, 4.7, 5)          # bridge over the opening (no rails)
for cx in (36.5, 42.5):                       # six crates for cover
    for cy in (8.5, 13.5, 18.5): box('crate', cx - 1.1, cx + 1.1, cy - 1.1, cy + 1.1, 5, 6.2)

# ---------------------------------------------------------------- L3: top floor
box('floor', 0, 14.7, 0, 24, 9.5, 10)         # the platform
box('crate', 5.85, 9.35, 6.15, 9.65, 10, 11.4)
box('crate', 5.85, 9.35, 15.85, 19.35, 10, 11.4)
for y0, y1 in ((17.4, 22.1), (3.5, 8.9)):     # two long ramps down to L2 (about 17 degrees)
    top = [(14.7, y0, 10), (31.5, y0, 5), (31.5, y1, 5), (14.7, y1, 10)]
    PARTS.setdefault('floor', []).append(([(x, y, z - 0.4) for x, y, z in top], top))
# rocket room, through a short hallway in the west wall
box('floor', -13.6, -2.6, 3.2, 20.7, 9.5, 10)
box('wall', -13.6, -2.6, 20.4, 20.7, 10, 13.5)
box('wall', -13.6, -13.3, 3.2, 20.4, 10, 13.5)
box('wall', -13.3, -2.6, 3.2, 3.5, 10, 13.5)
box('wall', -2.9, -2.6, 3.5, 8.5, 10, 13.5)
box('wall', -2.9, -2.6, 15.8, 20.4, 10, 13.5)
box('floor', -2.6, 0, 8.5, 15.8, 9.5, 10)
box('wall', -2.6, 0, 15.5, 15.8, 10, 13.5)
box('wall', -2.6, 0, 8.5, 8.8, 10, 13.5)
box('crate', -9.3, -7.7, 11.4, 12.6, 10, 10.9)  # the bazooka sits on this

# ---------------------------------------------------------------- square stairwell (north-west): a shaft from L1 to L3
# Two U-shaped loops round an open well (X 4.1..10.1): L3 (east, by the door) -> north -> west -> south to L2, then along
# the L2 walkway back east and round again to L1. Each loop sits 5 m under the one above it.
box('floor', 0, 14.7, 24.4, 37.6, -0.5, 0)
box('wall', 0, 14.7, 37.3, 37.6, -0.5, 13.5)
box('wall', 0, 0.3, 24.4, 37.3, -0.5, 13.5)
box('wall', 14.4, 14.7, 24.4, 37.3, -0.5, 13.5)
box('stair', 10.1, 14.4, 24.4, 29.0, 9.6, 10)              # L3 landing, off the platform
box('floor', 0.3, 14.4, 24.4, 27.4, 4.6, 5)                # L2 walkway along the south side, to the L2 door
box('stair', 10.1, 14.4, 27.4, 29.0, 4.6, 5)               # and its east landing


def loop(top, solid):
    """One U of stairs coming down 5 m from top (east side, by the landing) to top - 5 (west side, south end)."""
    th = lambda t: 0 if solid else t - 0.4            # steps under another loop are slabs, so there's headroom below
    for k in range(10):                                # east flight, down going north
        y = 29.0 + k * 0.54; t = top - (k + 1) * 0.17; box('stair', 10.1, 14.4, y, y + 0.54, th(t), t)
    t = top - 1.7; box('stair', 10.1, 14.4, 34.4, 37.3, th(t), t)
    for k in range(10):                                # north run, down going west
        x = 10.1 - (k + 1) * 0.6; t = top - 1.7 - (k + 1) * 0.17; box('stair', x, x + 0.6, 34.4, 37.3, th(t), t)
    t = top - 3.4; box('stair', 0.3, 4.1, 34.4, 37.3, th(t), t)
    for k in range(10):                                # west flight, down going south
        y = 34.4 - (k + 1) * 0.84; t = top - 3.4 - (k + 1) * 0.16; box('stair', 0.3, 4.1, y, y + 0.84, th(t), t)


loop(10, False)
loop(5, True)

# ---------------------------------------------------------------- perch tower (north-east): L1 to the roof
# L1: in from the north walkway; the lift pad sits in a pit in the north-east corner (the game makes the pad) and rides up
# through a hole in the L2 floor. L2: the lift stops here; out to the east floor, or up the ladder (on a short wall under
# the hatch's east edge) to the perch.
LIFT = (43, 47.7, 32.6, 37.3)
box('floor', 35.1, 43, 24.4, 37.6, -0.5, 0)
box('floor', 43, 48, 24.4, 32.6, -0.5, 0)
box('floor', 43, 47.7, 32.6, 37.3, -0.8, -0.3)             # the lift pit
box('wall', 35.1, 48, 37.3, 37.6, -0.8, 13.5)
box('wall', 35.1, 35.4, 24.4, 37.3, -0.8, 13.5)
box('wall', 47.7, 48, 24.4, 37.3, -0.8, 13.5)
box('floor', 35.4, 43, 24.4, 37.3, 4.6, 5)                 # L2, round the lift hole
box('floor', 43, 47.7, 24.4, 32.6, 4.6, 5)
box('wall', 37.2, 37.5, 29, 31, 5, 10)                     # the ladder's wall, under the hatch
box('floor', 35.4, 47.7, 24.4, 29, 9.6, 10)                # the perch floor, round the hatch (X 35.4..37.2, Y 29..31)
box('floor', 35.4, 47.7, 31, 37.3, 9.6, 10)
box('floor', 37.2, 47.7, 29, 31, 9.6, 10)
box('wall', 35.1, 48, 24.4, 37.6, 13.5, 13.8)              # roof

# ---------------------------------------------------------------- long curved stair (outside the south wall), enclosed
# From the platform's south-west corner (L3) out along the front and back in to the east floor (L2): half an ellipse.
CX, RX, RY, WID, NST = 19.1, 15.4, 9.0, 5.0, 40


def ell(a, off):   # point on the centre line at angle a, pushed off metres outward
    x, y = CX + RX * math.cos(a), RY * math.sin(a)
    nx, ny = math.cos(a) / RX, math.sin(a) / RY; l = math.hypot(nx, ny)
    return x + nx / l * off, y + ny / l * off


for k in range(NST):
    a0, a1 = math.radians(180 + k * 180 / NST), math.radians(180 + (k + 1) * 180 / NST)
    prism('stair', [ell(a0, -WID / 2), ell(a0, WID / 2), ell(a1, WID / 2), ell(a1, -WID / 2)], 4.5, 10 - (k + 1) * 5 / NST)
for k in range(60):
    a0, a1 = math.radians(180 + k * 3), math.radians(183 + k * 3)
    for r0, r1 in ((-WID / 2 - 0.3, -WID / 2), (WID / 2, WID / 2 + 0.3)):
        prism('wall', [ell(a0, r0), ell(a0, r1), ell(a1, r1), ell(a1, r0)], 4.5, 13.5)

# ---------------------------------------------------------------- build the meshes, centred and scaled for the game
COLOURS = {'floor': (0.62, 0.62, 0.6), 'wall': (0.55, 0.58, 0.62), 'stair': (0.6, 0.6, 0.58), 'crate': (0.5, 0.42, 0.32), 'water': (0.2, 0.36, 0.42)}
NAMES = {'water': 'Sewer_Water'}
objs = []
for kind, prisms in PARTS.items():
    bm = bmesh.new()
    for bot, top in prisms:
        b = [bm.verts.new(((x - 24) * SCALE, (y - 12) * SCALE, z)) for x, y, z in bot]
        t = [bm.verts.new(((x - 24) * SCALE, (y - 12) * SCALE, z)) for x, y, z in top]
        n = len(b); bm.faces.new(list(reversed(b))); bm.faces.new(t)
        for i in range(n): bm.faces.new([b[i], b[(i + 1) % n], t[(i + 1) % n], t[i]])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    name = NAMES.get(kind, 'Sewer_' + kind.title())
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    m = bpy.data.materials.new(name); m.use_nodes = True; m.diffuse_color = (*COLOURS[kind], 1)
    m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (*COLOURS[kind], 1)
    me.materials.append(m)
    ob = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(ob); objs.append(ob)


def export(path, **kw):
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=False, export_apply=True, export_cameras=False, export_lights=False,
                              export_animations=False, export_skins=False, export_morph=False, export_extras=False, export_texcoords=False, **kw)
    print(f'BUILT {os.path.basename(path)}: {os.path.getsize(path) / 1e3:.0f} kB')


if BLEND: bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(BLEND))
export(os.path.join(OUT, 'Sewer.glb'), export_materials='EXPORT', export_normals=True)
bpy.data.objects.remove(bpy.data.objects['Sewer_Water'])   # the collision file: only what's solid
export(os.path.join(OUT, 'Sewer_col.glb'), export_materials='PLACEHOLDER', export_normals=False)
print('SCALE', SCALE, 'triangles', sum(len(o.data.polygons) for o in bpy.data.objects))
