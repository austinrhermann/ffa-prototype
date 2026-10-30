# Builds models/Grenade.glb, models/Bazooka.glb and models/Shed.glb from the sketches, procedurally (no source .blend needed).
# Game axes after export: y up. Grenade stands on its base. The Bazooka's muzzle points down -z (Blender +y), like the other guns.
# The Shed's front (door and window) faces +z (Blender -y); origin on the ground in the middle of its footprint.
# Run (from the game folder):
#   /Applications/Blender.app/Contents/MacOS/Blender -b --python tools/build_new_props.py -- models
import bpy, bmesh, math, os, sys
from mathutils import Vector

OUT = sys.argv[-1]


def srgb(h):  # hex -> linear rgba (Blender material colours are linear)
    c = [int(h[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return tuple(x ** 2.2 for x in c) + (1,)


MATS = {}
def mat(name, hexcol, rough=0.8):
    if name not in MATS:
        m = bpy.data.materials.new(name); m.use_nodes = True
        b = m.node_tree.nodes['Principled BSDF']; b.inputs['Base Color'].default_value = srgb(hexcol); b.inputs['Roughness'].default_value = rough
        MATS[name] = m
    return MATS[name]


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    MATS.clear()


def finish(o, m, name):
    o.name = name; o.data.materials.append(m); return o


def box(name, m, size, loc, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    o = bpy.context.object; o.scale = size; return finish(o, m, name)


def cyl(name, m, r, depth, loc, rot=(0, 0, 0), verts=12, r2=None):
    if r2 is None:
        bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=depth, location=loc, rotation=rot)
    else:
        bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r, radius2=r2, depth=depth, location=loc, rotation=rot)
    return finish(bpy.context.object, m, name)


def torus(name, m, R, r, loc, rot=(0, 0, 0), segs=10, ring=4):
    bpy.ops.mesh.primitive_torus_add(major_radius=R, minor_radius=r, major_segments=segs, minor_segments=ring, location=loc, rotation=rot)
    return finish(bpy.context.object, m, name)


def flat(o):  # faceted look, like the rest of the game's props
    for p in o.data.polygons: p.use_smooth = False


def export(name):
    for o in bpy.data.objects:
        bpy.context.view_layer.objects.active = o
        o.select_set(True)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    for o in bpy.data.objects: flat(o)
    path = os.path.join(OUT, name + '.glb')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=False, export_apply=True, export_cameras=False,
                              export_lights=False, export_animations=False, export_skins=False, export_morph=False, export_extras=False)
    print(f'BUILT {name}.glb: {os.path.getsize(path) / 1e3:.1f} KB, {sum(len(p.vertices) - 2 for o in bpy.data.objects for p in o.data.polygons)} triangles')


# ---------- Grenade: a canister with a short neck, a pull ring and a safety lever (a metre is a metre: 17 cm tall) ----------
def grenade():
    reset()
    body, metal = mat('Grenade_Body', '#4d5a30'), mat('Grenade_Metal', '#8d9296', 0.4)
    cyl('Body', body, 0.038, 0.10, (0, 0, 0.05), verts=12)
    cyl('Shoulder', body, 0.038, 0.014, (0, 0, 0.107), verts=12, r2=0.028)
    cyl('Neck', metal, 0.0135, 0.052, (0, 0, 0.140), verts=12)
    cyl('Cap', metal, 0.0155, 0.01, (0, 0, 0.168), verts=12)
    torus('Ring', metal, 0.021, 0.0035, (0.0, -0.025, 0.138), (math.pi / 2, 0, 0))
    box('Pin', metal, (0.006, 0.026, 0.006), (0, -0.0125, 0.138))
    box('Lever', metal, (0.007, 0.018, 0.125), (0.047, 0, 0.098), (0, math.radians(-7), 0))
    box('LeverTop', metal, (0.03, 0.018, 0.007), (0.031, 0, 0.162))
    export('Grenade')


# ---------- Bazooka: a jointed tube, a flared tail, a bell mouth, two grips and a trigger (1.05 m long) ----------
def bazooka():
    reset()
    olive, dark, steel = mat('Bazooka_Olive', '#5d6842'), mat('Bazooka_Dark', '#26282b', 0.6), mat('Bazooka_Steel', '#757b80', 0.4)
    X = (math.pi / 2, 0, 0)   # cylinders along y
    cyl('Tube', olive, 0.055, 0.84, (0, 0, 0), X, verts=16)
    for i, y in enumerate((-0.16, 0.10, 0.31)):
        cyl(f'Band{i}', dark, 0.0605, 0.022, (0, y, 0), X, verts=16)
    # tail: a flared funnel (wide end last), three struts round it
    cyl('Tail', olive, 0.055, 0.1, (0, -0.47, 0), (-math.pi / 2, 0, 0), verts=16, r2=0.09)
    cyl('TailHole', dark, 0.07, 0.006, (0, -0.52, 0), X, verts=16)
    for i in range(3):
        a = i * 2 * math.pi / 3 + math.pi / 2
        box(f'Strut{i}', steel, (0.012, 0.11, 0.012), (math.cos(a) * 0.072, -0.465, math.sin(a) * 0.072), (0, math.sin(a) * 0.0, 0))
    # mouth: a bell with a dark opening
    cyl('Mouth', olive, 0.055, 0.1, (0, 0.47, 0), X, verts=16, r2=0.09)
    cyl('MouthLip', steel, 0.093, 0.016, (0, 0.52, 0), X, verts=16)
    cyl('MouthHole', dark, 0.074, 0.008, (0, 0.5265, 0), X, verts=16)
    # rear support under the tail (the triangle in the sketch), rear grip with a trigger, front grip, a sight on top
    cyl('Support', steel, 0.05, 0.016, (0, -0.30, -0.075), (0, math.pi / 2, math.pi / 2), verts=3)
    box('GripRear', dark, (0.038, 0.05, 0.15), (0, 0.0, -0.12), (math.radians(-8), 0, 0))
    box('Trigger', steel, (0.012, 0.014, 0.05), (0, 0.045, -0.095))
    box('TriggerGuard', dark, (0.03, 0.045, 0.012), (0, 0.04, -0.158))
    box('GripFront', dark, (0.034, 0.04, 0.13), (0, 0.255, -0.115), (math.radians(10), 0, 0))
    box('Sight', steel, (0.012, 0.03, 0.03), (0, 0.15, 0.07))
    box('SightRear', steel, (0.012, 0.012, 0.03), (0, -0.2, 0.07))
    export('Bazooka')


# ---------- Shed: a tin-roofed gabled hut you can walk into, 3.6 x 2.8 m, 2.3 m to the eaves. Hollow: 12 cm walls, a plank floor,
# a doorway on the left of the front (x -1.55 to -0.55, 2 m high) with a separate hinged "Door" (origin on its hinge, so the game
# can swing it), a window on the right and a stack of planks. Origin at floor level in the middle; front faces +z in the game. ----------
def shed():
    reset()
    wall, roof, rib = mat('Shed_Wall', '#b8b29e'), mat('Shed_Roof', '#9aa0a3', 0.5), mat('Shed_Rib', '#6f7578', 0.5)
    wood, frame, plank, glass, dark = mat('Shed_Door', '#6b4a2e'), mat('Shed_Frame', '#42301f'), mat('Shed_Plank', '#c49c62'), mat('Shed_Glass', '#26333d', 0.2), mat('Shed_Mark', '#4a463c')
    W, D, H, PK, T = 3.6, 2.8, 2.3, 3.15, 0.12   # width (x), depth (y), eave height, ridge height, wall thickness
    DX0, DX1, DH = -1.55, -0.55, 2.0            # the doorway
    fy = -D / 2
    # gable end walls: a pentagon in the y-z plane, extruded T along x
    for sx in (-1, 1):
        bm = bmesh.new()
        pts = [(-D / 2, 0), (D / 2, 0), (D / 2, H), (0, PK), (-D / 2, H)]
        x0 = sx * W / 2 - (T if sx > 0 else 0)
        f = bm.faces.new([bm.verts.new((x0, y, z)) for y, z in pts])
        r = bmesh.ops.extrude_face_region(bm, geom=[f])
        bmesh.ops.translate(bm, vec=(T, 0, 0), verts=[v for v in r['geom'] if isinstance(v, bmesh.types.BMVert)])
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        me = bpy.data.meshes.new('End'); bm.to_mesh(me); bm.free()
        o = bpy.data.objects.new('End', me); bpy.context.collection.objects.link(o); o.data.materials.append(wall)
    box('Back', wall, (W - 2 * T, T, H), (0, D / 2 - T / 2, H / 2))
    box('FrontL', wall, (DX0 + W / 2 - T, T, H), ((DX0 - W / 2 + T) / 2, fy + T / 2, H / 2))
    box('FrontR', wall, (W / 2 - T - DX1, T, H), ((DX1 + W / 2 - T) / 2, fy + T / 2, H / 2))
    box('FrontTop', wall, (DX1 - DX0, T, H - DH), ((DX0 + DX1) / 2, fy + T / 2, (H + DH) / 2))
    box('Floor', plank, (W - 2 * T, D - 2 * T, 0.1), (0, 0, -0.05))
    # roof: two sloped sheets overhanging the walls, with ribs running down each slope
    run, rise = D / 2 + 0.25, PK - H + 0.07
    L = math.hypot(run, rise); ang = math.atan2(rise, run)
    for s in (-1, 1):
        cy = s * (D / 2 + 0.25) / 2; cz = (H - 0.07 + PK + 0.02) / 2
        box(f'Roof{s}', roof, (W + 0.5, L, 0.05), (0, cy, cz), (-s * ang, 0, 0))
        n = 14
        for i in range(n + 1):
            x = -(W + 0.5) / 2 + 0.06 + i * ((W + 0.5 - 0.12) / n)
            box(f'Rib{s}_{i}', rib, (0.05, L, 0.04), (x, cy, cz + 0.035), (-s * ang, 0, 0))
    box('Ridge', rib, (W + 0.55, 0.22, 0.07), (0, 0, PK + 0.04))
    # the front: door frame round the doorway, a board across at lintel height, a window and a few marks
    box('FrameL', frame, (0.08, 0.1, DH), (DX0 + 0.04, fy - 0.02, DH / 2))
    box('FrameR', frame, (0.08, 0.1, DH), (DX1 - 0.04, fy - 0.02, DH / 2))
    box('FrameTop', frame, (DX1 - DX0, 0.1, 0.08), ((DX0 + DX1) / 2, fy - 0.02, DH - 0.04))
    box('Lintel', frame, (W + 0.04, 0.09, 0.14), (0, fy - 0.045, 2.12))
    box('WindowFrame', frame, (0.86, 0.07, 0.76), (0.85, fy - 0.02, 1.4))
    box('Window', glass, (0.7, 0.08, 0.6), (0.85, fy - 0.04, 1.4))
    box('WindowBar', frame, (0.04, 0.09, 0.62), (0.85, fy - 0.06, 1.4))
    box('WindowSill', frame, (0.98, 0.12, 0.05), (0.85, fy - 0.07, 1.0))
    for i, (x, z) in enumerate(((-0.2, 1.45), (-0.1, 1.2), (-0.22, 0.95), (-0.12, 0.7))):
        box(f'Mark{i}', dark, (0.14, 0.03, 0.06), (x, fy - 0.02, z))
    for i, (dx, ln) in enumerate(((0, 1.35), (0.08, 1.25), (-0.05, 1.4), (0.1, 1.3), (0.0, 1.2))):
        box(f'Plank{i}', plank, (ln, 0.34, 0.1), (W / 2 - 0.55 + dx, fy - 0.4, 0.06 + i * 0.105))
    # shelves inside, on the back wall
    box('Shelf', frame, (2.4, 0.3, 0.06), (0.5, D / 2 - T - 0.15, 1.2)); box('Shelf2', frame, (2.4, 0.3, 0.06), (0.5, D / 2 - T - 0.15, 0.6))
    # the door, hinged on its left edge: every part of it joined into one mesh whose origin is the hinge
    hx, hy = DX0 + 0.02, fy + T / 2
    parts = [box('Door', wood, (0.94, 0.06, 1.96), (hx + 0.47, hy, 0.99)),
             box('BraceA', frame, (0.08, 0.03, 1.5), (hx + 0.47, hy - 0.04, 0.99)),
             box('BraceB', frame, (0.94, 0.03, 0.08), (hx + 0.47, hy - 0.04, 0.35)),
             box('BraceC', frame, (0.94, 0.03, 0.08), (hx + 0.47, hy - 0.04, 1.6)),
             box('Knob', rib, (0.07, 0.1, 0.07), (hx + 0.84, hy - 0.04, 0.95))]
    bpy.ops.object.select_all(action='DESELECT')
    leaf = parts[0]; bpy.context.view_layer.objects.active = leaf
    for o in parts: o.select_set(True)
    bpy.ops.object.join()
    bpy.context.scene.cursor.location = (hx, hy, 0)
    bpy.ops.object.select_all(action='DESELECT'); leaf.select_set(True); bpy.context.view_layer.objects.active = leaf
    bpy.ops.object.origin_set(type='ORIGIN_CURSOR')
    leaf.name = 'Door'
    export('Shed')


for fn in (grenade, bazooka, shed): fn()
