# Builds models/Cargo_Truck.glb, the pirates' truck on the Fortress level (and the Truck in Test Drive), from the asset
# library's Cargo Truck: the intact truck with its container back (Cargo_Truck_v3.blend with Container Mod switched on) and
# the wrecked one (Cargo_Truck_v4_damage.blend). What's in it, in game axes (x across with +x the truck's left, which is the
# driver's side; y up; z forward), origin on the ground halfway between the axles:
#   Body                  the truck without its wheels and steering wheel, merged by material
#   Wreck                 the wrecked truck, wheels and all
#   Wheel_L, Wheel_R      one wheel for each side (the hub faces out), centred on the axle, which runs along x
#   SteeringWheel         an empty on the column (its local z), holding the steering wheel
#   Wheel_FL ... Wheel_RR empties at the wheel centres
#   Seat_0, Seat_1        the driver's and the passenger's seat (where you sit); Seat_2 ... Seat_7 on the benches in the
#                         container, three a side
#   Tailgate              the middle of the container's open back, at floor height
#   Box_Cab, Box_Back, Box_Under   empties whose position and scale (half sizes) are boxes around the cab, the container and
#                         the chassis: what bullets and eyes can't get through
# Run (from the game folder):
#   /Applications/Blender.app/Contents/MacOS/Blender -b --python tools/build_truck.py -- "<SE4_Asset Library>/Vehicles/Cargo Truck" models
import bpy, bmesh, sys, os, tempfile
import numpy as np
from mathutils import Vector, Matrix

SRC, OUT = sys.argv[-2], sys.argv[-1]
INTACT, WRECK = os.path.join(SRC, 'Cargo_Truck_v3.blend'), os.path.join(SRC, 'Cargo_Truck_v4_damage.blend')
LIBRARY = os.path.dirname(os.path.dirname(SRC))  # the asset library, searched for textures that have moved
TMP = tempfile.mkdtemp()
TEX = 512  # largest texture size
DECIMATE = {'empty_5': 1500}  # the slatted bed under the container: hidden detail, 13k triangles
CAB = {'Cab', 'Hood', 'Bumper', 'Fender', 'Door Left', 'Door Right', 'Cab interior', 'Chairs'}
BACK = {'Containter', 'Container liner', 'Seats locker'}
UNDER = {'Chassis', 'Bed', 'Fuel Tank', 'Container bed spacer', 'Tail LIghts'}


def find_textures():
    files = {}
    for root, _, names in os.walk(LIBRARY):
        for f in names: files.setdefault(os.path.splitext(f)[0].lower(), os.path.join(root, f))
    for img in bpy.data.images:
        if img.source != 'FILE' or img.packed_file or os.path.exists(bpy.path.abspath(img.filepath)): continue
        path = files.get(os.path.splitext(bpy.path.basename(img.filepath))[0].lower())
        if path: img.filepath = path; img.reload(); print(f'FOUND {img.name}: {path}')


def load(path):
    """Open a truck file with the container on and leave the truck's renderable parts as plain meshes, modifiers applied."""
    bpy.ops.wm.open_mainfile(filepath=path)
    find_textures()
    vl = bpy.context.view_layer
    def walk(lc):
        if lc.collection.name == 'Container Mod': lc.exclude = False
        if lc.collection.name == 'Flatbed Mod': lc.exclude = True
        lc.hide_viewport = False; lc.collection.hide_viewport = False
        for ch in lc.children: walk(ch)
    walk(vl.layer_collection)
    keep = [o for o in vl.objects if o.type == 'MESH' and not o.hide_render and not o.name.startswith('WGT')
            and not any(c.hide_render for c in o.users_collection)]
    for o in keep:
        o.hide_viewport = False; o.hide_select = False; o.hide_set(False)
        for m in o.modifiers: m.show_viewport = m.show_render
    bpy.ops.object.select_all(action='DESELECT')
    for o in keep: o.select_set(True)
    vl.objects.active = keep[0]
    bpy.ops.object.convert(target='MESH')
    names = {o.name for o in keep if o.name in bpy.data.objects}
    for o in [bpy.data.objects[n] for n in names]:
        if o.parent: mw = o.matrix_world.copy(); o.parent = None; o.matrix_world = mw
    for o in [o for o in bpy.data.objects if o.name not in names]: bpy.data.objects.remove(o, do_unlink=True)
    for o in [o for o in bpy.data.objects if not any(o.data.materials) or not len(o.data.polygons)]: bpy.data.objects.remove(o, do_unlink=True)
    for o in bpy.data.objects:
        o.data = o.data.copy()
        uvs = o.data.uv_layers
        if len(uvs):
            use = next((u for u in uvs if u.active_render), uvs[0]).name
            for u in [u for u in uvs if u.name != use]: uvs.remove(u)
            uvs[0].name = 'UVMap'
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    for o in bpy.data.objects:
        t = DECIMATE.get(o.name)
        if t and sum(len(p.vertices) - 2 for p in o.data.polygons) > t:
            m = o.modifiers.new('dec', 'DECIMATE'); m.ratio = t / sum(len(p.vertices) - 2 for p in o.data.polygons)
            with bpy.context.temp_override(object=o, active_object=o): bpy.ops.object.modifier_apply(modifier=m.name)


def wheel_parts():
    """The four wheels in 'Truck Wheel' (one mesh): the faces of each, keyed FL, FR, RL, RR, with centre and radius."""
    o = bpy.data.objects['Truck Wheel']; me = o.data
    bm = bmesh.new(); bm.from_mesh(me); bm.faces.ensure_lookup_table()
    parts, seen = [], set()
    for f0 in bm.faces:
        if f0.index in seen: continue
        stack, ids = [f0], []
        seen.add(f0.index)
        while stack:
            f = stack.pop(); ids.append(f.index)
            for e in f.edges:
                for g in e.link_faces:
                    if g.index not in seen: seen.add(g.index); stack.append(g)
        pts = np.array([v.co[:] for i in ids for v in bm.faces[i].verts])
        parts.append((ids, pts.min(0), pts.max(0)))
    big = [p for p in parts if p[2][2] - p[1][2] > 0.8]
    wheels = {}
    for ids, lo, hi in big:
        c = (lo + hi) / 2
        key = ('F' if c[1] < 0 else 'R') + ('L' if c[0] > 0 else 'R')  # Blender: the front is -y, the left +x
        wheels[key] = {'c': c, 'r': (hi[2] - lo[2]) / 2, 'faces': set(ids)}
    for ids, lo, hi in parts:  # nuts and hubs go with the nearest tyre
        if (hi[2] - lo[2]) > 0.8: continue
        c = (lo + hi) / 2
        k = min(wheels, key=lambda k: np.linalg.norm(wheels[k]['c'] - c)); wheels[k]['faces'] |= set(ids)
    bm.free()
    return wheels


def flatten_materials():
    """One colour texture per material: fold Mix (and Multiply) of a texture and a colour into a texture of its own; a lost
    texture leaves just the colour."""
    def lin(c): return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    def srgb(c): return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(np.maximum(c, 0), 1 / 2.4) - 0.055)
    for m in bpy.data.materials:
        nt = m.node_tree
        if not nt: continue
        for n in [n for n in nt.nodes if n.type == 'MIX' and n.data_type == 'RGBA' and n.blend_type in ('MIX', 'MULTIPLY') and n.outputs[2].is_linked]:
            fac, a, b = n.inputs[0], n.inputs[6], n.inputs[7]
            tex = lambda s: s.links[0].from_node if s.is_linked and s.links[0].from_node.type == 'TEX_IMAGE' else None
            t, col = (tex(a), b) if tex(a) else (tex(b), a)
            if not t or col.is_linked or fac.is_linked: continue
            f, c = fac.default_value, np.array(col.default_value[:3], np.float32)
            img = t.image
            if not img or not img.size[0]:
                out = c if n.blend_type == 'MULTIPLY' else c  # the texture is lost: its tint is all that's left
                for l in list(n.outputs[2].links): l.to_socket.default_value = (*out, 1); nt.links.remove(l)
                nt.nodes.remove(n); print(f'FLAT {m.name}: colour only'); continue
            px = np.empty(img.size[0] * img.size[1] * 4, np.float32); img.pixels.foreach_get(px); px = px.reshape(-1, 4)
            tl = lin(px[:, :3]) if img.colorspace_settings.name == 'sRGB' else px[:, :3]
            res = tl * (1 - f + f * c) if n.blend_type == 'MULTIPLY' else (c * (1 - f) + tl * f if t == tex(b) else tl * (1 - f) + c * f)
            px[:, :3] = srgb(res); px[:, 3] = 1
            new = bpy.data.images.new(img.name + ' flat', img.size[0], img.size[1]); new.pixels.foreach_set(px.ravel())
            path = os.path.join(TMP, new.name.replace('/', '_') + '.png'); new.filepath_raw = path; new.file_format = 'PNG'; new.save()
            node = nt.nodes.new('ShaderNodeTexImage'); node.image = bpy.data.images.load(path); bpy.data.images.remove(new)
            for l in list(n.outputs[2].links): nt.links.new(node.outputs['Color'], l.to_socket)
            nt.nodes.remove(n); print(f'FLAT {m.name}: {img.name}')


def shrink_textures():
    for img in list(bpy.data.images):
        if not img.users or img.type != 'IMAGE' or not img.size[0]: continue
        if max(img.size) > TEX: img.scale(min(TEX, img.size[0]), min(TEX, img.size[1]))
        path = os.path.join(TMP, img.name.replace('/', '_') + ' small.jpg')
        img.file_format = 'JPEG'; img.save(filepath=path, quality=85)
        new = bpy.data.images.load(path); new.colorspace_settings.name = img.colorspace_settings.name; new.name = img.name + ' small'
        img.user_remap(new)


def merge(objs, name):
    """Join objs, split them by material again (each material drawn once) and put them under an empty called name."""
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT'); bpy.ops.mesh.separate(type='MATERIAL'); bpy.ops.object.mode_set(mode='OBJECT')
    root = bpy.data.objects.new(name, None); bpy.context.scene.collection.objects.link(root)
    for o in list(bpy.context.selected_objects):
        o.parent = root; o.name = f'{name} {o.data.materials[0].name}'
    return root


def empty(name, at, scale=(1, 1, 1), rot=None):
    o = bpy.data.objects.new(name, None); bpy.context.scene.collection.objects.link(o)
    o.empty_display_type = 'CUBE'
    M = (rot or Matrix.Identity(3)).to_4x4(); M.translation = at; o.matrix_world = M; o.scale = scale
    return o


def export(path, **kw):
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=False, export_apply=True, export_cameras=False,
                              export_lights=False, export_animations=False, export_skins=False, export_morph=False, export_extras=False,
                              export_vertex_color='NONE', **kw)


def bounds(objs):
    pts = np.array([v.co[:] for o in objs for v in o.data.vertices])
    return Vector(pts.min(0)), Vector(pts.max(0))


# ---------- The wreck: its own file, kept for later ----------
load(WRECK)
flatten_materials()
shift = None
wh = wheel_parts()  # the wreck is missing a front wheel, so its rear axle and wheel bottoms set the ground
ground = min(w['c'][2] - w['r'] for w in wh.values())
wreck_rear_y = np.mean([w['c'][1] for k, w in wh.items() if k[0] == 'R'])
merge(list(bpy.data.objects), 'Wreck')
wreck_file = os.path.join(TMP, 'wreck.glb'); export(wreck_file, export_image_format='AUTO')

# ---------- The intact truck ----------
load(INTACT)
flatten_materials()
wh = wheel_parts()
front, rear = np.mean([wh['FL']['c'][1], wh['FR']['c'][1]]), np.mean([wh['RL']['c'][1], wh['RR']['c'][1]])
ground = min(w['c'][2] - w['r'] for w in wh.values())
shift = Vector((0, -(front + rear) / 2, -ground))  # origin on the ground between the axles
assert abs(wreck_rear_y - rear) < 0.05, 'the wreck and the truck should line up'
for o in bpy.data.objects: o.data.transform(Matrix.Translation(shift))
# Wheels: one left and one right wheel, each centred on its axle; empties where all four go
wobj = bpy.data.objects['Truck Wheel']
for side in ('L', 'R'):
    w = wh['F' + side]; c = Vector(w['c']) + shift
    bm = bmesh.new(); bm.from_mesh(wobj.data); bm.faces.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.index not in w['faces']], context='FACES')
    me = bpy.data.meshes.new('Wheel_' + side); bm.to_mesh(me); bm.free()
    me.transform(Matrix.Translation(-c))
    for mat in wobj.data.materials: me.materials.append(mat)
    o = bpy.data.objects.new('Wheel_' + side, me); bpy.context.scene.collection.objects.link(o)
for k, w in wh.items(): empty('Wheel_' + k, Vector(w['c']) + shift, (w['r'],) * 3)
bpy.data.objects.remove(wobj, do_unlink=True)
# Steering wheel: an empty on the column (the wheel's thinnest direction), its local -y along it (z in the game)
sw = bpy.data.objects['Steering Wheel']
pts = np.array([v.co[:] for v in sw.data.vertices]); ctr = pts.mean(0)
axis = Vector(np.linalg.svd(pts - ctr)[2][2]).normalized()
if axis.z < 0: axis = -axis
x = axis.cross(Vector((0, 0, 1))).normalized(); y = -axis; z = x.cross(y)
rot = Matrix((x, y, z)).transposed()
col = empty('SteeringWheel', Vector(ctr), rot=rot)
sw.data.transform(Matrix.Translation(-Vector(ctr))); sw.data.transform(rot.inverted().to_4x4())
sw.matrix_world = Matrix.Identity(4); sw.parent = col
# Cover: boxes around the cab, the container and the chassis
for name, group in (('Box_Cab', CAB), ('Box_Back', BACK), ('Box_Under', UNDER)):
    lo, hi = bounds([o for o in bpy.data.objects if o.name in group])
    empty(name, (lo + hi) / 2, (hi - lo) / 2)
# Seats: the bench seat in the cab (driver on the left, under the steering wheel); three a side on the container's benches,
# from the bench tops; the container's open back
def tops(o, zmin, zmax):  # upward faces of o between two heights: [(z, x, y, area)]
    out = []
    for f in o.data.polygons:
        if f.normal.z > 0.9 and zmin < f.center.z < zmax: out.append((f.center.z, f.center.x, f.center.y, f.area))
    return out
ch = tops(bpy.data.objects['Chairs'], 0, 9); cz = max(ch, key=lambda t: t[3])[0]
cy = sum(t[2] * t[3] for t in ch if abs(t[0] - cz) < 0.05) / sum(t[3] for t in ch if abs(t[0] - cz) < 0.05)
sx = abs(Vector(ctr).x)
empty('Seat_0', (sx, cy, cz)); empty('Seat_1', (-sx, cy, cz))
lk = bpy.data.objects['Seats locker']
lo, hi = bounds([lk]); floor = bounds([bpy.data.objects['Container liner']])[0].z
bt = max(tops(lk, floor + 0.2, floor + 1.0), key=lambda t: t[3]); bz, bx = bt[0], abs(bt[1])
open_y = bounds([bpy.data.objects['Containter']])[1].y
for i, s in enumerate((1, -1)):
    for k in range(3):
        empty(f'Seat_{2 + i * 3 + k}', (s * bx, lo.y + (hi.y - lo.y) * (k + 0.5) / 3, bz))
empty('Tailgate', (0, open_y, floor))
print(f'TRUCK wheelbase {rear - front:.2f}  track {wh["FL"]["c"][0] - wh["FR"]["c"][0]:.2f}  wheel radius {wh["FL"]["r"]:.2f}  seats at {cz:.2f} and {bz:.2f}')
merge([o for o in bpy.data.objects if o.type == 'MESH' and not o.name.startswith('Wheel_') and o.name != 'Steering Wheel'], 'Body')
# The wreck, lined up the same way
before = set(bpy.data.objects.keys())
bpy.ops.import_scene.gltf(filepath=wreck_file)
for o in bpy.data.objects:
    if o.name not in before and o.parent is None: o.location += shift
shrink_textures()
out = os.path.join(OUT, 'Cargo_Truck.glb')
export(out, export_image_format='JPEG', export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=6,
       export_draco_position_quantization=14, export_draco_normal_quantization=10, export_draco_texcoord_quantization=12)
print(f'BUILT {out}: {os.path.getsize(out) / 1e6:.2f} MB, {sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in bpy.data.objects if o.type == "MESH")} triangles')
