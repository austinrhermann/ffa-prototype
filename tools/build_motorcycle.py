# Builds models/Motorcycle.glb, the motorcycle in the Fortress courtyard (and the Sport bike in Test Drive), from the rigged
# Motorcycle.blend (Motorcycle.zip, 2026-11-05). What's in it, in game axes (x across with +x the bike's left; y up; z forward),
# origin on the ground halfway between the axles:
#   Body                  the frame, tank, seat, engine, exhaust and rear suspension, merged by material
#   Steer                 an empty at the front axle, its local y up the steering axis (the head tube's rake), holding the
#                         fork, the front shock, the handlebars, the headlight and dash: what turns with the bars
#   Wheel_F, Wheel_B      the front and back wheels, centred on the axle, which runs along x
#   Wheel_Front, Wheel_Back  empties at the axles, scaled by the wheel radius
#   Grip_L, Grip_R        under Steer: the middle of each handlebar grip, where the rider's hands go
#   Seat_0, Seat_1        on top of the saddle: the rider (front) and a passenger (back)
#   Peg_0, Peg_1          the left (+x) footpeg for each seat; the right ones mirror them
# Run (from the game folder):
#   /Applications/Blender.app/Contents/MacOS/Blender -b --python tools/build_motorcycle.py -- "<unzipped>/Motorcycle" models
import bpy, sys, os, tempfile
import numpy as np
from mathutils import Vector, Matrix

SRC, OUT = sys.argv[-2], sys.argv[-1]
BLEND = next(os.path.join(SRC, f) for f in os.listdir(SRC) if f.endswith('.blend'))
TMP = tempfile.mkdtemp()
TEX = 512  # largest texture size
STEER = {'Fork', 'Metal', 'Accessories', 'handle bars', 'shock rubber front', 'shock front', 'brake cables'}
WHEELS = {'wheel front': 'Wheel_F', 'wheel back': 'Wheel_B'}

bpy.ops.wm.open_mainfile(filepath=BLEND)
vl = bpy.context.view_layer
rig = bpy.data.objects['Motorcycle Rig']
fork_bone = rig.data.bones['Fork']
head, tail = rig.matrix_world @ fork_bone.head_local, rig.matrix_world @ fork_bone.tail_local  # down the steering axis

# Every drawn part as a plain mesh in world space, modifiers (and the rig's pose) applied
keep = [o for o in vl.objects if o.type in ('MESH', 'CURVE') and not o.hide_render]
bpy.ops.object.select_all(action='DESELECT')
for o in keep: o.hide_set(False); o.hide_select = False; o.select_set(True)
vl.objects.active = keep[0]
bpy.ops.object.convert(target='MESH')
names = {o.name for o in keep}
for o in [bpy.data.objects[n] for n in names]:
    mw = o.matrix_world.copy(); o.parent = None; o.constraints.clear(); o.matrix_world = mw
for o in [o for o in bpy.data.objects if o.name not in names]: bpy.data.objects.remove(o, do_unlink=True)
for o in bpy.data.objects:
    o.data = o.data.copy()
    # The textures read each part's render UV map, which is 'UVW' on some parts and 'UVMap' on others: keep only that one, all
    # under one name, so joining the parts keeps each one's mapping
    uvs = o.data.uv_layers if o.type == 'MESH' else []
    if len(uvs):
        use = next((u for u in uvs if u.active_render), uvs[0]).name
        for u in [u for u in uvs if u.name != use]: uvs.remove(u)
        uvs[0].name = 'UVMap'
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

# Materials: just the colour texture on a plain BSDF (the game draws everything toon-shaded from the colour map)
for m in bpy.data.materials:
    nt = m.node_tree
    if not nt: continue
    col = next((n.image for n in nt.nodes if n.type == 'TEX_IMAGE' and n.image and 'Color' in n.image.name), None)
    bsdf = next((n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    base = tuple(bsdf.inputs['Base Color'].default_value) if bsdf else (0.05, 0.05, 0.05, 1)
    for n in list(nt.nodes): nt.nodes.remove(n)
    out = nt.nodes.new('ShaderNodeOutputMaterial'); b = nt.nodes.new('ShaderNodeBsdfPrincipled')
    nt.links.new(b.outputs[0], out.inputs[0])
    if col:
        t = nt.nodes.new('ShaderNodeTexImage'); t.image = col; nt.links.new(t.outputs['Color'], b.inputs['Base Color'])
    else: b.inputs['Base Color'].default_value = base
    print(f'MAT {m.name}: {col.name if col else base}')
for o in bpy.data.objects:  # the brake cables had no material
    if not any(o.data.materials): o.data.materials.append(bpy.data.materials['Rubber/Leather'])

def bounds(objs):
    pts = np.array([v.co[:] for o in objs for v in o.data.vertices])
    return Vector(pts.min(0)), Vector(pts.max(0))

# Wheels: centre and radius from their bounds (they're true circles, centred on their hubs). The blend has the bike a little
# nose up (the front axle 7.5 cm higher), so it's levelled first: turned about x until both hubs are at one height, then the
# origin goes on the ground halfway between them. Each wheel is centred on its own hub, so it spins true.
wc = {}
for src in WHEELS:
    lo, hi = bounds([bpy.data.objects[src]]); wc[src] = ((lo + hi) / 2, (hi.z - lo.z) / 2)
r = (wc['wheel front'][1] + wc['wheel back'][1]) / 2
front, back = wc['wheel front'][0], wc['wheel back'][0]
d = front - back
level = Matrix.Rotation(np.arctan2(d.z, -d.y), 4, 'X')  # (the front is -y)
front, back = level @ front, level @ back
shift = Vector((-(front.x + back.x) / 2, -(front.y + back.y) / 2, r - (front.z + back.z) / 2))
FIX = Matrix.Translation(shift) @ level
for o in bpy.data.objects: o.data.transform(FIX)
head, tail, front, back = FIX @ head, FIX @ tail, front + shift, back + shift
for src, name in WHEELS.items():
    o = bpy.data.objects[src]; c = front if src == 'wheel front' else back
    o.data.transform(Matrix.Translation(-c)); o.name = name; o.data.name = name
assert abs(front.z - r) < 1e-4 and abs(back.z - r) < 1e-4 and abs(front.x) < 0.01, 'both hubs should sit at axle height'
front.x = back.x = 0  # (the front wheel is 6 mm off the middle in the blend: the axles go on the centre line)
def empty(name, at, scale=(1, 1, 1), rot=None):
    o = bpy.data.objects.new(name, None); bpy.context.scene.collection.objects.link(o)
    M = (rot or Matrix.Identity(3)).to_4x4(); M.translation = at; o.matrix_world = M; o.scale = scale
    return o
empty('Wheel_Front', front, (r,) * 3); empty('Wheel_Back', back, (r,) * 3)

# Steering: an empty at the front axle, its local z (y in the game) up the steering axis; what turns goes under it
up = (head - tail).normalized(); x = Vector((1, 0, 0)); y = up.cross(x).normalized()
rot = Matrix((x, y, up)).transposed()
steer = empty('Steer', front, rot=rot)
inv = steer.matrix_world.inverted()
# Grips: the middle of each end of the bars (where the hands go), under Steer so they turn with it
hb = bpy.data.objects['handle bars']
for side, sg in (('L', 1), ('R', -1)):
    pts = np.array([v.co[:] for v in hb.data.vertices if sg * v.co.x > 0.3])
    g = empty('Grip_' + side, Vector(pts.mean(0))); g.parent = steer; g.matrix_parent_inverse = inv
bpy.ops.object.select_all(action='DESELECT')
parts = [bpy.data.objects[n] for n in STEER if n in bpy.data.objects]
for o in parts: o.data.transform(inv); o.select_set(True)
vl.objects.active = parts[0]; bpy.ops.object.join(); fk = vl.objects.active; fk.name = 'Fork'
bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT'); bpy.ops.mesh.separate(type='MATERIAL'); bpy.ops.object.mode_set(mode='OBJECT')
for o in list(bpy.context.selected_objects): o.parent = steer; o.matrix_parent_inverse = Matrix.Identity(4); o.name = f'Fork {o.data.materials[0].name}'

# Seats: the rider on the front of the saddle, a passenger on the back, on its top (dropped onto it); footpegs under each,
# measured from the blend (the rider's on the frame below the front of the saddle, the passenger's on the swingarm mounts)
sd = bpy.data.objects['Rubber leather']
for k, y in enumerate((0.17, 0.66)):
    y = (FIX @ Vector((0, y, 1))).y
    hit, loc, *_ = sd.ray_cast(Vector((0, y, 3)), Vector((0, 0, -1)))
    assert hit, 'the saddle should be under the seat'
    empty(f'Seat_{k}', loc)
for k, at in enumerate(((0.20, 0.01, 0.37), (0.215, 0.36, 0.36))): empty(f'Peg_{k}', FIX @ Vector(at))  # the +x (left) peg; the right one mirrors it
sy, tz = bpy.data.objects['Seat_0'].location.y, bpy.data.objects['Seat_0'].location.z

# Body: everything else, one object per material
body = [o for o in bpy.data.objects if o.type == 'MESH' and o.parent is None and o.name not in WHEELS.values()]
bpy.ops.object.select_all(action='DESELECT')
for o in body: o.select_set(True)
vl.objects.active = body[0]; bpy.ops.object.join()
bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT'); bpy.ops.mesh.separate(type='MATERIAL'); bpy.ops.object.mode_set(mode='OBJECT')
root = bpy.data.objects.new('Body', None); bpy.context.scene.collection.objects.link(root)
for o in list(bpy.context.selected_objects): o.parent = root; o.name = f'Body {o.data.materials[0].name}'

for img in list(bpy.data.images):
    if not img.users or img.type != 'IMAGE' or not img.size[0]: continue
    if max(img.size) > TEX: img.scale(min(TEX, img.size[0]), min(TEX, img.size[1]))
    path = os.path.join(TMP, img.name.replace('/', '_') + ' small.jpg')
    img.file_format = 'JPEG'; img.save(filepath=path, quality=85)
    new = bpy.data.images.load(path); new.name = img.name + ' small'; img.user_remap(new)

lo, hi = bounds([o for o in bpy.data.objects if o.type == 'MESH' and o.parent is root])
print(f'BIKE wheelbase {front.y - back.y:.3f} (front is -y)  wheel radius {r:.3f}  seat y {sy:.3f} z {tz:.3f}  rake {np.degrees(np.arccos(up.z)):.1f}  body y {lo.y:.2f}..{hi.y:.2f} z {lo.z:.2f}..{hi.z:.2f}')
out = os.path.join(OUT, 'Motorcycle.glb')
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_selection=False, export_apply=True, export_cameras=False,
                          export_lights=False, export_animations=False, export_skins=False, export_morph=False, export_extras=False,
                          export_vertex_color='NONE', export_image_format='JPEG', export_draco_mesh_compression_enable=True,
                          export_draco_mesh_compression_level=6, export_draco_position_quantization=14,
                          export_draco_normal_quantization=10, export_draco_texcoord_quantization=12)
print(f'BUILT {out}: {os.path.getsize(out) / 1e6:.2f} MB, {sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in bpy.data.objects if o.type == "MESH")} triangles')
