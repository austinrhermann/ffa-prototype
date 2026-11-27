# Builds models/Crashed_Truck.glb, the wrecked truck stuck in the hill on the road up to the Fortress's gate (Austin's drawing,
# 2026-11-26): the asset library's damaged Cargo Truck (Cargo_Truck_v4_damage.blend, container on) with both front wheels
# blown off, the right cab door hanging wide open and the left one (taken from the intact truck: the damaged one has lost it)
# loose, to lie on the ground beside it. Nobody drives it: it's cover, with ammo and guns in the back.
# What's in it, in game axes like Cargo_Truck.glb (x across with +x the truck's left, y up, z forward), origin on the ground
# halfway between where the axles were:
#   Truck                 the wreck, merged by material
#   Door                  the left door lying flat, its outside up, origin under its middle on the floor
#   Box_Cab, Box_Back, Box_Under   empties whose position and scale (half sizes) are boxes round the cab, the container and
#                         the chassis (what the game makes solid)
#   Tailgate              the middle of the container's open back, at floor height
#   Wheel_RL              the rear wheel centres' empty (its scale: the wheel's radius)
# Run (from the game folder):
#   /Applications/Blender.app/Contents/MacOS/Blender -b --python tools/build_crashed_truck.py -- "<SE4_Asset Library>/Vehicles/Cargo Truck" models
import bpy, bmesh, sys, os, tempfile, math
import numpy as np
from mathutils import Vector, Matrix

SRC, OUT = sys.argv[-2], sys.argv[-1]
INTACT, WRECK = os.path.join(SRC, 'Cargo_Truck_v3.blend'), os.path.join(SRC, 'Cargo_Truck_v4_damage.blend')
LIBRARY = os.path.dirname(os.path.dirname(SRC))
TMP = tempfile.mkdtemp()
TEX = 512
DECIMATE = {'empty_5': 1500}
WHEELBASE = 3.0433  # the intact truck's (tools/build_truck.py): the wreck has one front wheel, so the rear axle and this place the front
DOOR_OPEN = math.radians(70)  # how far the right door has swung out on its hinge
CAB = {'Cab', 'Hood', 'Bumper', 'Fender', 'Door Right', 'Cab interior', 'Chairs'}
BACK = {'Containter', 'Container liner', 'Seats locker'}
UNDER = {'Chassis', 'Bed', 'Fuel Tank', 'Container bed spacer', 'Tail LIghts'}


def find_textures():
    files = {}
    for root, _, names in os.walk(LIBRARY):
        for f in names: files.setdefault(os.path.splitext(f)[0].lower(), os.path.join(root, f))
    for img in bpy.data.images:
        if img.source != 'FILE' or img.packed_file or os.path.exists(bpy.path.abspath(img.filepath)): continue
        path = files.get(os.path.splitext(bpy.path.basename(img.filepath))[0].lower())
        if path: img.filepath = path; img.reload()


def plain(objs):
    """objs as plain meshes: modifiers applied, unparented, transforms applied, one UV map."""
    vl = bpy.context.view_layer
    for o in objs:
        o.hide_viewport = False; o.hide_select = False; o.hide_set(False)
        for m in o.modifiers: m.show_viewport = m.show_render
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs: o.select_set(True)
    vl.objects.active = objs[0]
    bpy.ops.object.convert(target='MESH')
    for o in objs:
        if o.parent: mw = o.matrix_world.copy(); o.parent = None; o.matrix_world = mw
        o.data = o.data.copy()
        uvs = o.data.uv_layers
        if len(uvs):
            use = next((u for u in uvs if u.active_render), uvs[0]).name
            for u in [u for u in uvs if u.name != use]: uvs.remove(u)
            uvs[0].name = 'UVMap'
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs: o.select_set(True)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)


def load(path):
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
    plain(keep)
    names = {o.name for o in keep}
    for o in [o for o in bpy.data.objects if o.name not in names]: bpy.data.objects.remove(o, do_unlink=True)
    for o in [o for o in bpy.data.objects if not any(o.data.materials) or not len(o.data.polygons)]: bpy.data.objects.remove(o, do_unlink=True)
    for o in bpy.data.objects:
        t = DECIMATE.get(o.name)
        n = sum(len(p.vertices) - 2 for p in o.data.polygons)
        if t and n > t:
            m = o.modifiers.new('dec', 'DECIMATE'); m.ratio = t / n
            with bpy.context.temp_override(object=o, active_object=o): bpy.ops.object.modifier_apply(modifier=m.name)


def wheel_parts():
    """The wheels in 'Truck Wheel' (one mesh): the faces of each, keyed FL, FR, RL, RR (whichever are there), with centre and radius."""
    o = bpy.data.objects['Truck Wheel']
    bm = bmesh.new(); bm.from_mesh(o.data); bm.faces.ensure_lookup_table()
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
    wheels = {}
    for ids, lo, hi in [p for p in parts if p[2][2] - p[1][2] > 0.8]:
        c = (lo + hi) / 2
        wheels[('F' if c[1] < 0 else 'R') + ('L' if c[0] > 0 else 'R')] = {'c': c, 'r': (hi[2] - lo[2]) / 2, 'faces': set(ids)}
    for ids, lo, hi in parts:  # nuts and hubs go with the nearest tyre
        if (hi[2] - lo[2]) > 0.8: continue
        c = (lo + hi) / 2
        k = min(wheels, key=lambda k: np.linalg.norm(wheels[k]['c'] - c)); wheels[k]['faces'] |= set(ids)
    bm.free()
    return wheels


def flatten_materials():
    """One colour texture per material (as tools/build_truck.py): fold Mix/Multiply of a texture and a colour into a texture."""
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
                for l in list(n.outputs[2].links): l.to_socket.default_value = (*c, 1); nt.links.remove(l)
                nt.nodes.remove(n); continue
            px = np.empty(img.size[0] * img.size[1] * 4, np.float32); img.pixels.foreach_get(px); px = px.reshape(-1, 4)
            tl = lin(px[:, :3]) if img.colorspace_settings.name == 'sRGB' else px[:, :3]
            res = tl * (1 - f + f * c) if n.blend_type == 'MULTIPLY' else (c * (1 - f) + tl * f if t == tex(b) else tl * (1 - f) + c * f)
            px[:, :3] = srgb(res); px[:, 3] = 1
            new = bpy.data.images.new(img.name + ' flat', img.size[0], img.size[1]); new.pixels.foreach_set(px.ravel())
            path = os.path.join(TMP, new.name.replace('/', '_') + '.png'); new.filepath_raw = path; new.file_format = 'PNG'; new.save()
            node = nt.nodes.new('ShaderNodeTexImage'); node.image = bpy.data.images.load(path); bpy.data.images.remove(new)
            for l in list(n.outputs[2].links): nt.links.new(node.outputs['Color'], l.to_socket)
            nt.nodes.remove(n)


def shrink_textures():
    for img in list(bpy.data.images):
        if not img.users or img.type != 'IMAGE' or not img.size[0]: continue
        if max(img.size) > TEX: img.scale(min(TEX, img.size[0]), min(TEX, img.size[1]))
        path = os.path.join(TMP, img.name.replace('/', '_') + ' small.jpg')
        img.file_format = 'JPEG'; img.save(filepath=path, quality=85)
        new = bpy.data.images.load(path); new.colorspace_settings.name = img.colorspace_settings.name; new.name = img.name + ' small'
        img.user_remap(new)


def merge(objs, name):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT'); bpy.ops.mesh.separate(type='MATERIAL'); bpy.ops.object.mode_set(mode='OBJECT')
    root = bpy.data.objects.new(name, None); bpy.context.scene.collection.objects.link(root)
    for o in list(bpy.context.selected_objects):
        o.parent = root; o.name = f'{name} {o.data.materials[0].name}'
    return root


def empty(name, at, scale=(1, 1, 1)):
    o = bpy.data.objects.new(name, None); bpy.context.scene.collection.objects.link(o)
    o.empty_display_type = 'CUBE'; o.location = at; o.scale = scale
    return o


def bounds(objs):
    pts = np.array([v.co[:] for o in objs for v in o.data.vertices])
    return Vector(pts.min(0)), Vector(pts.max(0))


load(WRECK)
# The left door, from the intact truck (the wreck has lost it)
with bpy.data.libraries.load(INTACT, link=False) as (src, dst): dst.objects = ['Door Left']
door = dst.objects[0]; bpy.context.scene.collection.objects.link(door); door.parent = None
plain([door])
flatten_materials()
wh = wheel_parts()
rear = np.mean([w['c'][1] for k, w in wh.items() if k[0] == 'R'])
ground = min(w['c'][2] - w['r'] for w in wh.values())
shift = Vector((0, -(rear - WHEELBASE / 2), -ground))  # Blender's front is -y: the front axle is WHEELBASE ahead of (below) the rear one
for o in bpy.data.objects: o.data.transform(Matrix.Translation(shift))
# Both front wheels off (the wreck still has one)
wobj = bpy.data.objects['Truck Wheel']
gone = set().union(*[w['faces'] for k, w in wh.items() if k[0] == 'F'])
bm = bmesh.new(); bm.from_mesh(wobj.data); bm.faces.ensure_lookup_table()
bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.index in gone], context='FACES'); bm.to_mesh(wobj.data); bm.free()
rl = [w for k, w in wh.items() if k[0] == 'R'][0]
empty('Wheel_RL', Vector(rl['c']) + shift, (rl['r'],) * 3)
# Cover boxes (before the door swings out: they're the closed cab)
for name, group in (('Box_Cab', CAB), ('Box_Back', BACK), ('Box_Under', UNDER)):
    lo, hi = bounds([o for o in bpy.data.objects if o.name in group])
    empty(name, (lo + hi) / 2, (hi - lo) / 2)
floor = bounds([bpy.data.objects['Container liner']])[0].z
empty('Tailgate', (0, bounds([bpy.data.objects['Containter']])[1].y, floor))
# The right door (on the truck's -x side) swung wide open on its front edge
dr = bpy.data.objects['Door Right']; lo, hi = bounds([dr])
hinge = Vector((lo.x, lo.y, 0))
dr.data.transform(Matrix.Translation(hinge) @ Matrix.Rotation(DOOR_OPEN, 4, 'Z') @ Matrix.Translation(-hinge))
# The left door flat, its outside (+x) up, origin under its middle
door.data.transform(Matrix.Rotation(-math.pi / 2, 4, 'Y'))
lo, hi = bounds([door]); door.data.transform(Matrix.Translation(-Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z))))
door.name = 'Door Left'
merge([door], 'Door')
merge([o for o in bpy.data.objects if o.type == 'MESH' and o.parent is None and o.name != 'Door Left'], 'Truck')
shrink_textures()
out = os.path.join(OUT, 'Crashed_Truck.glb')
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_selection=False, export_apply=True, export_cameras=False, export_lights=False,
                          export_animations=False, export_skins=False, export_morph=False, export_extras=False, export_vertex_color='NONE',
                          export_image_format='JPEG', export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=6,
                          export_draco_position_quantization=14, export_draco_normal_quantization=10, export_draco_texcoord_quantization=12)
print(f'BUILT {out}: {os.path.getsize(out) / 1e6:.2f} MB, {sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in bpy.data.objects if o.type == "MESH")} triangles; wheels {sorted(wh)}; bed floor {floor:.2f}')
