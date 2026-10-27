# Builds the two game files for the Fortress level straight from the render set .blend (no intermediate export):
#   models/Fortress_v5.glb      what players see: everything the render camera sees, with every modifier and geometry-node
#                                scatter applied as in the render, heavy plants simplified, objects merged by material,
#                                textures shrunk to JPEG, geometry Draco-compressed
#                                with the render's sun baked in (see Sun below)
#   models/Fortress_v5_sun.png  where the sun reaches, every 0.5 m over the play area: what lights characters, trucks and
#                                anything else that moves (see Sun below)
#   models/Fortress_v5_col.glb  what the game collides with (and shoots, sees and walks on): simplified terrain and fort,
#                                props as boxes, no plants, plus the closed front gate as a box named Front_Gate
# Run (from the game folder):
#   /Applications/Blender.app/Contents/MacOS/Blender -b "<SE4_Asset Library>/Sets/Fortress/RENDER_set_v05_sky.blend" --python tools/build_fortress.py -- models
import bpy, bmesh, sys, os, tempfile, math, struct, zlib
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

OUT = sys.argv[-1]
SRC = bpy.data.filepath
TMP = tempfile.mkdtemp()  # shrunk and flattened textures, only needed while exporting
# Where to look for textures the .blend points at but that have moved: the set's own Textures folder, tools/textures
# (copies of ones no longer in the asset library, like the computer screen's map), then the whole asset library
LIBRARY = os.path.dirname(os.path.dirname(os.path.dirname(SRC)))
TEXTURE_DIRS = [os.path.join(os.path.dirname(SRC), 'Textures'), os.path.join(os.path.dirname(os.path.abspath(__file__)), 'textures'), LIBRARY]

SCENE = 'Scene'  # the render scene (Scene.001 is a character close-up)
# Not part of the level: cameras and lights, the characters posed for the shots, the wrecked truck on the road (the game's
# trucks come from tools/build_truck.py) and the render-only cannons (the game builds its own on the wall over the gate)
DROP_COLLECTIONS = {'Cameras', 'Characters', 'Vehicles', '04_080', '04_090', 'Cannon 01.001', 'Cannon 01', 'Roof Cannon', 'Lights'}
DROP_NAMES = {'Temp Land', 'Hill for shadow', 'Plane.002',  # render helpers: a stand-in coast, a far hill that only casts shadow
              'Scrap Truck'}  # a grey placeholder box in the courtyard
GEOMETRY = {'MESH', 'CURVE', 'SURFACE', 'META', 'FONT'}
KEEP_APART = {'Water', 'Important Computer'}  # the game looks these up by name
# Display: simplify the heaviest plants (name prefix -> target triangles). The fort, the terrain and the props stay whole.
DISPLAY_TRIS = {'Flame': 4000, 'Palm leaf 2': 3000, 'Morel': 2500, 'Bush': 2500, 'Pear': 2500}
# Display: largest texture size per image (name prefix -> pixels); everything else gets DEFAULT_TEX
TEX_SIZE = {'LM ': 4096, 'Terrain': 2048, 'Fort_': 2048, 'Ground': 1024, 'ephemera': 1024, 'Screen_Map': 1024, 'theshining': 1024, 'Midas_Battery': 1024}
DEFAULT_TEX = 512
# Sun. The renders' look comes from their compositor: a surface is lit where the sun's light on it passes a soft threshold
# (the direct light, screened with the bounced light at 42%, through an ease ramp from 0 to 0.149; the sun lamp is pure red
# so its light can be picked out), and is dark otherwise. The same mask is baked here into a texture per object on a second
# UV map ('Lightmap'), exported as the material's occlusion texture, and the game lights the fort by it. Metres per texel:
LM_TEXEL, LM_TEXEL_COARSE = 0.05, 0.12  # the fort and its props; the terrain and plants
LM_COARSE = ('Material.00', 'Material_', 'tree balls', 'Ground')  # the terrain's and the plants' materials
LM_MIN, LM_MAX, LM_PACK = 64, 2048, 0.55  # texture sizes, and how much of a lightmap the islands fill
BOUNCE, EDGE = 0.423, 0.149  # the compositor's bounced-light curve and threshold
# The sun grid: (lowest corner x, y, z), cells along x, y, z, and metres per cell, in game coordinates. index.html reads the
# same numbers (levelFortress, sun).
SUN_GRID = ((-56.0, 18.0, -12.0), (197, 81, 177), 0.5)
SUN_COLS = 9  # slices (one per height) laid out this many to a row in the PNG
# Collision: structure kept as (simplified) meshes; everything else becomes a box or is left out
COL_TRIS = {'Terrain': 20000}  # the fort itself stays exact: simplifying narrows its doorways and landings
COL_MESHES = {'Terrain', 'fort_sculpt_2', 'fort_sculpt_2.001', 'Fort Tower', 'Stairs', 'Door Old Wood', 'Water'}
STAIRS = {'Stairs'}  # the tower's two flights: inside a ramp's footprint they're replaced whole, sides and all
# Collision: the props on the wall walk over the gate are walked through (they're drawn, but nobody snags on them)
WALK_THROUGH = {'Crate', 'Crate.001', 'Midas Battery', 'Midas Battery.001', 'Midas Battery.002', 'Yellow box',
                'Stairs.001'}  # the computer room's metal steps: their ramp replaces them, rails and all
COL_SKIP = ('Flame', 'Morel', 'Bush', 'Pear', 'Palm', 'Cypress', 'Mball', 'Ball trees', 'Big tree', 'Courtyard tree', 'ball flower',
            'Trunks', 'Red LED', 'Yellow LED', 'Catenary', 'GPencil', 'Window', 'Mill work', 'Sign', 'theshining', 'Gauge', 'Dails', 'Botton Box',
            'Keyboard', 'Rack spacing', 'A', 'B', 'B.001')
# The closed gate in the passage under the wall walk, in game coordinates (x, y up, z toward the attackers)
GATE = ((-3.55, 33.45, 2.95), (-0.25, 36.5, 3.55))
# Collision: every staircase becomes a smooth ramp, so you walk up instead of hopping step to step.
# (x0, x1, z where it starts, floor y there, z where it ends, floor y there), game coordinates
# Each is 10 cm wider a side than its stairs, so the walking map's nodes along a staircase's edge are on the ramp.
RAMPS = [
    (-5.05, -3.35, 0.15, 33.51, -4.05, 37.15),  # courtyard up to the back corridor (west stairs)
    (6.2, 7.7, 3.75, 37.07, -0.15, 40.52),      # tower: lower floor up to the landing
    (3.02, 4.3, 0.5, 40.52, 4.3, 43.95),        # tower: landing up to the computer room
    (4.85, 5.85, -0.25, 43.94, -1.3, 44.95),    # computer room: metal steps up to the ledge
]
# Collision: clear the way from the back corridor up the west walkway to the wall walk. The rock that pokes into the
# passage by the wall walk is cut away, and the narrow doorway from the corridor into the walkway is widened to fit a body.
# (material or None for any, (x0, x1), (z0, z1), (y0, y1)), game coordinates
TRIM = [('Rock', (-7.6, -4.6), (2.6, 4.6), (37.0, 40.6)),
        (None, (-6.75, -5.45), (-5.05, -3.85), (37.15, 39.4))]


def cut_faces(o, inside):
    """Delete the faces of o for which inside(game points of the face, material name) is true."""
    bm = bmesh.new(); bm.from_mesh(o.data); mw = o.matrix_world
    mats = [m.name if m else '' for m in o.data.materials]
    doomed = []
    for f in bm.faces:
        pts = [mw @ v.co for v in f.verts]
        if inside([(p.x, p.z, -p.y) for p in pts], mats[f.material_index] if f.material_index < len(mats) else ''): doomed.append(f)
    if doomed: bmesh.ops.delete(bm, geom=doomed, context='FACES')
    bm.to_mesh(o.data); bm.free(); o.data.update()
    return len(doomed)


def in_ramp(pts, r, whole=False):
    # a step face: its middle is over the ramp, and it lies between the ramp's ends (a little past them: the edges of the
    # floors they meet, which the ramp's ends cover) and heights; it may poke out sideways. whole: any height (a staircase
    # replaced outright)
    x0, x1, za, ya, zb, yb = r
    cx = sum(p[0] for p in pts) / len(pts)
    past_lo, past_hi = (0.25, 0.1) if zb < za else (0.1, 0.25)  # past the top end as far as the ramp's lip, the bottom a little
    return x0 - 0.05 <= cx <= x1 + 0.05 and all(min(za, zb) - past_lo <= z <= max(za, zb) + past_hi for x, y, z in pts) and (
        whole or all(min(ya, yb) - 0.05 <= y <= max(ya, yb) + 0.05 for x, y, z in pts))


def riser_at_top(pts, r):
    # the steep front edge of the floor a ramp climbs to, just under the ramp's top: feet catch on it. Often one face across
    # the whole landing, so it goes if it overlaps the ramp at all.
    x0, x1, za, ya, zb, yb = r
    e1 = [pts[1][i] - pts[0][i] for i in range(3)]; e2 = [pts[2][i] - pts[0][i] for i in range(3)]
    n = (e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0])
    l = sum(c * c for c in n) ** 0.5
    if l < 1e-9 or abs(n[1]) / l >= 0.64: return False
    lo, hi = (zb - 0.3, zb + 0.15) if zb < za else (zb - 0.15, zb + 0.3)
    return (min(p[0] for p in pts) < x1 and max(p[0] for p in pts) > x0 and all(lo <= p[2] <= hi for p in pts)
            and all(yb - 0.4 <= p[1] <= yb + 0.05 for p in pts))


def add_ramp(r):
    x0, x1, za, ya, zb, yb = r
    d = 1 if zb > za else -1  # direction of travel up the ramp
    # slope plus a short flat lip onto the top landing; the bottom edge dips just under the floor so there's no lip there;
    # a wall down each side to the bottom's floor height, so nobody walks under the ramp or steps onto it from the side
    g = [(x0, ya - 0.05, za - d * 0.1), (x1, ya - 0.05, za - d * 0.1), (x1, yb, zb), (x0, yb, zb), (x1, yb, zb + d * 0.25), (x0, yb, zb + d * 0.25),
         (x0, ya - 0.05, zb + d * 0.25), (x1, ya - 0.05, zb + d * 0.25)]
    me = bpy.data.meshes.new('Ramp'); me.from_pydata([(x, -z, y) for x, y, z in g], [], [(0, 1, 2, 3), (3, 2, 4, 5), (0, 3, 5, 6), (1, 7, 4, 2)])
    o = bpy.data.objects.new('Ramp', me); bpy.context.scene.collection.objects.link(o)


def rendered_collections(vl):
    """Names of the collections the render sees: included in the view layer, renderable, and not one we drop."""
    out = set()
    def walk(lc, ok):
        c = lc.collection
        ok = ok and not lc.exclude and not c.hide_render and c.name not in DROP_COLLECTIONS
        if ok: out.add(c.name)
        for ch in lc.children: walk(ch, ok)
    walk(vl.layer_collection, True)
    return out


def unhide(vl):
    def walk(lc):
        lc.hide_viewport = False; lc.collection.hide_viewport = False; lc.collection.hide_select = False
        for ch in lc.children: walk(ch)
    walk(vl.layer_collection)


def find_textures():
    """Point images whose file has moved at a file with the same name (any extension) in TEXTURE_DIRS."""
    files = {}
    for d in reversed(TEXTURE_DIRS):  # earlier folders win
        for root, _, names in os.walk(d):
            for f in names: files[os.path.splitext(f)[0].lower()] = os.path.join(root, f)
    for img in bpy.data.images:
        if img.source != 'FILE' or img.packed_file or os.path.exists(bpy.path.abspath(img.filepath)): continue
        path = files.get(os.path.splitext(bpy.path.basename(img.filepath))[0].lower())
        if path: img.filepath = path; img.reload(); print(f'FOUND {img.name}: {path}')


def load():
    """Open the render set and leave only what the render sees, as plain meshes with every modifier applied."""
    bpy.ops.wm.open_mainfile(filepath=SRC)
    find_textures()
    for s in list(bpy.data.scenes):
        if s.name != SCENE: bpy.data.scenes.remove(s)
    sc = bpy.data.scenes[SCENE]; vl = sc.view_layers[0]
    sc.render.use_simplify = False
    global TO_SUN
    TO_SUN = (bpy.data.objects['Sun'].matrix_world.to_quaternion() @ Vector((0, 0, 1))).normalized()  # toward the sun, Blender axes
    cols = rendered_collections(vl)
    keep = [o for o in sc.objects if o.type in GEOMETRY and not o.hide_render and o.name not in DROP_NAMES
            and any(c.name in cols for c in o.users_collection)
            and not (o.type == 'MESH' and any(m and m.name == 'MAT Cannon' for m in o.data.materials))]
    # Convert evaluates the viewport: make it match the render (hidden things shown, render-only modifiers on)
    unhide(vl)
    for o in keep:
        o.hide_viewport = False; o.hide_select = False; o.hide_set(False)
        for m in o.modifiers:
            m.show_viewport = m.show_render
            if m.type == 'SUBSURF': m.levels = m.render_levels
    bpy.ops.object.select_all(action='DESELECT')
    for o in keep: o.select_set(True)
    vl.objects.active = keep[0]
    bpy.ops.object.convert(target='MESH')  # applies modifiers and realizes geometry-node instances (the plant scatters)
    keep = [o for o in keep if o.name in bpy.data.objects and o.type == 'MESH']
    names = {o.name for o in keep}
    for o in keep:  # free them from parents that are about to go, keeping their place
        if o.parent:
            mw = o.matrix_world.copy(); o.parent = None; o.matrix_world = mw
    for o in [o for o in bpy.data.objects if o.name not in names]: bpy.data.objects.remove(o, do_unlink=True)
    for o in [o for o in bpy.data.objects if not any(o.data.materials) or not len(o.data.polygons)]: bpy.data.objects.remove(o, do_unlink=True)
    # Single users, transforms applied: joining objects later keeps every face the right way round (mirrored ones too).
    # Each keeps only the UV map its textures use (the render one), under one shared name, or joining loses the others' UVs.
    for o in bpy.data.objects:
        o.data = o.data.copy()
        if o.data.shape_keys: o.shape_key_clear()
        uvs = o.data.uv_layers
        if len(uvs):
            use = next((u for u in uvs if u.active_render), uvs[0]).name
            for u in [u for u in uvs if u.name != use]: uvs.remove(u)
            uvs[0].name = 'UVMap'
    bpy.ops.object.select_all(action='SELECT')
    vl.objects.active = bpy.data.objects[0]
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)


def tris(o): return sum(len(p.vertices) - 2 for p in o.data.polygons)


def decimate(o, target):
    t = tris(o)
    if t <= target: return
    m = o.modifiers.new('dec', 'DECIMATE'); m.ratio = target / t
    with bpy.context.temp_override(object=o, active_object=o): bpy.ops.object.modifier_apply(modifier=m.name)


def prefix(name, table):
    for k, v in table.items():
        if name.startswith(k): return v
    return None


def to_srgb(c): return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(np.maximum(c, 0), 1 / 2.4) - 0.055)


def flatten_materials():
    """The game reads one colour texture per material. Fold the set's Mix nodes into a texture of their own, and turn
    emission-only materials (the LEDs) into a black surface that glows its colour."""
    for m in bpy.data.materials:
        nt = m.node_tree
        if not nt: continue
        out = next((n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL' and n.inputs['Surface'].is_linked), None)
        if out and out.inputs['Surface'].links[0].from_node.type == 'EMISSION':
            em = out.inputs['Surface'].links[0].from_node
            col = em.inputs['Color'].links[0].from_node.outputs[0].default_value if em.inputs['Color'].is_linked else em.inputs['Color'].default_value
            b = nt.nodes.new('ShaderNodeBsdfPrincipled')
            b.inputs['Base Color'].default_value = (0, 0, 0, 1)
            b.inputs['Emission Color'].default_value = tuple(col); b.inputs['Emission Strength'].default_value = 1
            nt.links.new(b.outputs['BSDF'], out.inputs['Surface'])
            print(f'GLOW {m.name}')
        for n in [n for n in nt.nodes if n.type == 'MIX' and n.data_type == 'RGBA' and n.blend_type == 'MIX' and n.outputs[2].is_linked]:
            fac, a, b = n.inputs[0], n.inputs[6], n.inputs[7]
            tex = lambda s: s.links[0].from_node if s.is_linked and s.links[0].from_node.type == 'TEX_IMAGE' else None
            ta, tb = tex(a), tex(b)
            if ta and tb and not fac.is_linked:  # two textures, one picked
                keep = ta if fac.default_value < 0.5 else tb
            elif tb and not ta and not a.is_linked:  # a colour with the texture over it, by a fixed amount or by its alpha
                img = tb.image
                if not img or not img.size[0]:  # the texture is lost: just the colour
                    for l in list(n.outputs[2].links): l.to_socket.default_value = a.default_value; nt.links.remove(l)
                    nt.nodes.remove(n); print(f'FLAT {m.name}: colour only'); continue
                px = np.empty(img.size[0] * img.size[1] * 4, np.float32); img.pixels.foreach_get(px); px = px.reshape(-1, 4)
                if fac.is_linked and fac.links[0].from_node == tb and fac.links[0].from_socket.name == 'Alpha': f = px[:, 3:4]
                elif not fac.is_linked: f = np.full((len(px), 1), fac.default_value, np.float32)
                else: continue
                bg = to_srgb(np.array(a.default_value[:3], np.float32)) if img.colorspace_settings.name == 'sRGB' else np.array(a.default_value[:3], np.float32)
                px[:, :3] = bg * (1 - f) + px[:, :3] * f; px[:, 3] = 1
                new = bpy.data.images.new(img.name + ' flat', img.size[0], img.size[1])
                new.pixels.foreach_set(px.ravel())
                path = os.path.join(TMP, new.name.replace('/', '_') + '.png'); new.filepath_raw = path; new.file_format = 'PNG'; new.save()
                keep = nt.nodes.new('ShaderNodeTexImage'); keep.image = bpy.data.images.load(path); keep.image.name = new.name
                bpy.data.images.remove(new)
            else:
                continue
            for l in list(n.outputs[2].links): nt.links.new(keep.outputs['Color'], l.to_socket)
            nt.nodes.remove(n)
            print(f'FLAT {m.name}: {keep.image.name}')


def bake_sun():
    """Bake the render's lit-or-shadow mask (see Sun above) into a lightmap per object, as its occlusion texture."""
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    try:
        prefs = bpy.context.preferences.addons['cycles'].preferences
        prefs.compute_device_type = 'METAL'; prefs.get_devices()
        for d in prefs.devices: d.use = True
        sc.cycles.device = 'GPU'
    except Exception as e: print('BAKE on the CPU:', e)
    sc.world = bpy.data.worlds.new('Dark'); sc.world.color = (0, 0, 0)  # the renders' world lights nothing
    lamp = bpy.data.objects.new('BakeSun', bpy.data.lights.new('BakeSun', 'SUN')); sc.collection.objects.link(lamp)
    lamp.data.energy = 1; lamp.data.angle = 0
    lamp.rotation_euler = TO_SUN.to_track_quat('Z', 'Y').to_euler()  # a sun shines along its -Z
    objs = [o for o in bpy.data.objects if o.type == 'MESH' and o.name not in KEEP_APART]
    for o in bpy.data.objects:  # the computer keeps materials of its own (it isn't baked, and shares some with baked objects)
        if o.name == 'Important Computer':
            for sl in o.material_slots: sl.material = sl.material.copy()
    group = bpy.data.node_groups.new('glTF Material Output', 'ShaderNodeTree')
    group.interface.new_socket('Occlusion', in_out='INPUT', socket_type='NodeSocketFloat')
    imgs = {}
    for o in objs:
        area = sum(p.area for p in o.data.polygons)
        coarse = any(o.data.materials[0].name.startswith(c) for c in LM_COARSE)
        size = int(min(LM_MAX, max(LM_MIN, 2 ** math.ceil(math.log2(max(1, math.sqrt(area / LM_PACK) / (LM_TEXEL_COARSE if coarse else LM_TEXEL)))))))
        uv = o.data.uv_layers.new(name='Lightmap'); o.data.uv_layers.active = uv
        bpy.ops.object.select_all(action='DESELECT'); o.select_set(True); bpy.context.view_layer.objects.active = o
        bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=6 / size, area_weight=0, correct_aspect=True, scale_to_bounds=False)
        bpy.ops.object.mode_set(mode='OBJECT')  # (baking writes through the active UV map; the textures' own stay the render one)
        m = o.data.materials[0]; nt = m.node_tree
        direct, bounce = (bpy.data.images.new(f'{k} {o.name}', size, size, float_buffer=True) for k in ('Direct', 'Bounce'))
        nd, nb = nt.nodes.new('ShaderNodeTexImage'), nt.nodes.new('ShaderNodeTexImage'); nd.image, nb.image = direct, bounce
        uvn = nt.nodes.new('ShaderNodeUVMap'); uvn.uv_map = 'Lightmap'
        for n in (nd, nb): nt.links.new(uvn.outputs['UV'], n.inputs['Vector'])
        imgs[o.name] = (size, m, nd, nb, uvn)
    print(f'BAKE {len(objs)} objects, {sum(v[0] ** 2 for v in imgs.values()) / 1e6:.1f} M texels')
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    import time
    for which, passes, samples in ((2, {'DIRECT'}, 4), (3, {'INDIRECT'}, 64)):
        for v in imgs.values(): v[1].node_tree.nodes.active = v[which]
        sc.cycles.samples = samples; t = time.time()
        bpy.ops.object.bake(type='DIFFUSE', pass_filter=passes, margin=3, use_clear=True)
        print(f'BAKED {passes} in {time.time() - t:.0f} s')
    def channel(img):
        a = np.empty(img.size[0] * img.size[1] * 4, np.float32); img.pixels.foreach_get(a); return a.reshape(img.size[1], img.size[0], 4)[..., 0]
    def around(a, op):  # each texel and its 8 neighbours, combined by op
        p = np.pad(a, 1, mode='edge'); return op([p[1 + dy:p.shape[0] - 1 + dy, 1 + dx:p.shape[1] - 1 + dx] for dy in (-1, 0, 1) for dx in (-1, 0, 1)])
    soften = lambda a: around(a, lambda n: sum(n) / 9)  # the bounced light is noisy: a small blur
    # Specks of sun smaller than a few texels (pinholes between pieces of the set, lightmap seams) go, as the renders'
    # painterly filter takes them out: the mask's lit areas shrink a texel, then grow back
    unspeck = lambda a: around(around(a, lambda n: np.min(n, axis=0)), lambda n: np.max(n, axis=0))
    lit = []
    for name, (size, m, nd, nb, uvn) in imgs.items():
        d, b = channel(nd.image), soften(channel(nb.image))
        t = np.clip((1 - (1 - BOUNCE * b) * (1 - d)) / EDGE, 0, 1); mask = unspeck(t * t * (3 - 2 * t))
        gen = bpy.data.images.new('LM ' + name, size, size)
        px = np.ones((size, size, 4), np.float32); px[..., 0] = px[..., 1] = px[..., 2] = mask
        gen.pixels.foreach_set(px.ravel())
        path = os.path.join(TMP, 'LM ' + name + '.png'); gen.filepath_raw = path; gen.file_format = 'PNG'; gen.save(); bpy.data.images.remove(gen)
        img = bpy.data.images.load(path); img.name = 'LM ' + name; img.colorspace_settings.name = 'Non-Color'
        lit.append(f'{name[2:]} {100 * mask.mean():.0f}%')
        nt = m.node_tree; lm = nt.nodes.new('ShaderNodeTexImage'); lm.image = img; nt.links.new(uvn.outputs['UV'], lm.inputs['Vector'])
        sep = nt.nodes.new('ShaderNodeSeparateColor'); out = nt.nodes.new('ShaderNodeGroup'); out.node_tree = group
        nt.links.new(lm.outputs['Color'], sep.inputs['Color']); nt.links.new(sep.outputs['Red'], out.inputs['Occlusion'])
        for n in (nd, nb): bpy.data.images.remove(n.image); nt.nodes.remove(n)
    for o in objs: o.data.uv_layers.active = o.data.uv_layers[0]
    bpy.data.objects.remove(lamp, do_unlink=True)
    print('LIT (share of each lightmap):', ', '.join(lit[:12]))


def write_png(path, grey):
    """An 8-bit greyscale PNG from a 2D uint8 array."""
    h, w = grey.shape
    raw = b''.join(b'\x00' + grey[r].tobytes() for r in range(h))
    chunk = lambda t, d: struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    open(path, 'wb').write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 0, 0, 0, 0))
                           + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))


def sun_grid(path):
    """Where the sun reaches over the play area, for what moves (see SUN_GRID): 255 lit, 0 in shadow, as slices by height."""
    dg = bpy.context.evaluated_depsgraph_get(); verts, polys = [], []
    for o in bpy.data.objects:
        if o.type != 'MESH' or o.name == 'Water': continue
        me = o.evaluated_get(dg).to_mesh(); M = o.matrix_world; base = len(verts)
        verts += [M @ v.co for v in me.vertices]; polys += [[base + i for i in p.vertices] for p in me.polygons]
    tree = BVHTree.FromPolygons(verts, polys)
    (x0, y0, z0), (nx, ny, nz), cell = SUN_GRID
    lit = np.zeros((ny, nz, nx), np.uint8); unsure = np.zeros((ny, nz, nx), bool)
    for j in range(ny):
        for k in range(nz):
            for i in range(nx):
                o = Vector((x0 + i * cell, -(z0 + k * cell), y0 + j * cell)) + TO_SUN * 0.02
                hit = tree.ray_cast(o, TO_SUN, 400)[0]
                if hit is None: lit[j, k, i] = 255
                elif (hit - o).length < 0.35: unsure[j, k, i] = True  # right at (or inside) a surface: take the neighbours'
    for _ in range(2):
        nb = np.zeros_like(lit)
        for ax in range(3):
            for sh in (1, -1): nb = np.maximum(nb, np.where(np.roll(unsure, sh, ax), 0, np.roll(lit, sh, ax)))
        lit = np.where(unsure, nb, lit); unsure[:] = False
    rows = math.ceil(ny / SUN_COLS); atlas = np.zeros((rows * nz, SUN_COLS * nx), np.uint8)
    for j in range(ny): r, c = divmod(j, SUN_COLS); atlas[r * nz:(r + 1) * nz, c * nx:(c + 1) * nx] = lit[j]
    write_png(path, atlas)
    print(f'BUILT sun grid: {os.path.getsize(path) / 1e6:.2f} MB, {nx}x{ny}x{nz} cells, {100 * (lit > 127).mean():.0f}% lit')


def export(path, **kw):
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=False, export_apply=True, export_cameras=False,
                              export_lights=False, export_animations=False, export_skins=False, export_morph=False, export_extras=False,
                              export_vertex_color='NONE', **kw)


def report(label, path):
    print(f'BUILT {label}: {os.path.getsize(path) / 1e6:.1f} MB, {len(bpy.data.objects)} objects, {sum(tris(o) for o in bpy.data.objects)} triangles')


# ---------- Display version ----------
load()
for o in sorted(bpy.data.objects, key=tris, reverse=True)[:20]: print(f'HEAVY {o.name}: {tris(o)}')
for o in bpy.data.objects:
    t = prefix(o.name, DISPLAY_TRIS)
    if t: decimate(o, t)
flatten_materials()
# Merge everything that shares a material into one object, so each material is drawn once
group = [o for o in bpy.data.objects if o.name not in KEEP_APART]
bpy.ops.object.select_all(action='DESELECT')
for o in group: o.select_set(True)
bpy.context.view_layer.objects.active = group[0]
bpy.ops.object.join()
bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT'); bpy.ops.mesh.separate(type='MATERIAL'); bpy.ops.object.mode_set(mode='OBJECT')
for o in bpy.data.objects:
    if o.name not in KEEP_APART and o.data.materials: o.name = 'M ' + o.data.materials[0].name
bake_sun()
sun_grid(os.path.join(OUT, 'Fortress_v5_sun.png'))
# Textures: shrink, and store as JPEG unless the material needs transparency
for img in list(bpy.data.images):
    if not img.users or img.type not in ('IMAGE', 'UV_TEST'): continue  # (a new, generated image is a 'UV_TEST')
    if img.size[0] == 0: print(f'MISSING texture {img.name} ({img.filepath})'); continue
    size = prefix(img.name, TEX_SIZE) or DEFAULT_TEX
    if max(img.size) > size: img.scale(min(size, img.size[0]), min(size, img.size[1]))
    alpha = img.name.startswith('theshining')
    path = os.path.join(TMP, img.name.replace('/', '_') + ' small' + ('.png' if alpha else '.jpg'))
    img.file_format = 'PNG' if alpha else 'JPEG'
    img.save(filepath=path, quality=85)
    new = bpy.data.images.load(path); new.colorspace_settings.name = img.colorspace_settings.name; new.name = img.name + ' small'
    img.user_remap(new)
disp = os.path.join(OUT, 'Fortress_v5.glb')
export(disp, export_image_format='AUTO', export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=6,
       export_draco_position_quantization=14, export_draco_normal_quantization=10, export_draco_texcoord_quantization=12)
report('display', disp)

# ---------- Collision version ----------
load()
for o in list(bpy.data.objects):  # stairs and stray rock out first, before anything is simplified
    if o.name in COL_MESHES and o.name != 'Water':
        n = cut_faces(o, lambda pts, mat: any(in_ramp(pts, r, o.name in STAIRS) or riser_at_top(pts, r) for r in RAMPS) or any(
            (m is None or mat == m) and xa <= sum(p[0] for p in pts) / len(pts) <= xb and za <= sum(p[2] for p in pts) / len(pts) <= zb
            and ya <= sum(p[1] for p in pts) / len(pts) <= yb for m, (xa, xb), (za, zb), (ya, yb) in TRIM))  # faces whose middle is in the box
        if n: print(f'CUT {o.name}: {n} faces')
for o in list(bpy.data.objects):
    if o.name in COL_MESHES:
        t = COL_TRIS.get(o.name)
        if t: decimate(o, t)
        continue
    name = o.name
    skip = name in WALK_THROUGH or any(name == s or name.startswith(s + ' ') or name.startswith(s + '.') or (len(s) > 2 and name.startswith(s)) for s in COL_SKIP)
    bb = [o.matrix_world @ Vector(c) for c in o.bound_box]
    lo = Vector([min(v[i] for v in bb) for i in range(3)]); hi = Vector([max(v[i] for v in bb) for i in range(3)])
    size = hi - lo
    bpy.data.objects.remove(o, do_unlink=True)
    if skip or size.z < 0.4 or max(size.x, size.y) < 0.3: continue
    bpy.ops.mesh.primitive_cube_add(location=(lo + hi) / 2); box = bpy.context.object; box.scale = size / 2
    bpy.ops.object.transform_apply(scale=True); box.name = 'Box ' + name
# The gate (game x, y, z -> Blender x, -z, y)
(gx0, gy0, gz0), (gx1, gy1, gz1) = GATE
bpy.ops.mesh.primitive_cube_add(location=((gx0 + gx1) / 2, -(gz0 + gz1) / 2, (gy0 + gy1) / 2)); gate = bpy.context.object
gate.scale = ((gx1 - gx0) / 2, (gz1 - gz0) / 2, (gy1 - gy0) / 2); bpy.ops.object.transform_apply(scale=True); gate.name = 'Front_Gate'
for r in RAMPS: add_ramp(r)
col = os.path.join(OUT, 'Fortress_v5_col.glb')
export(col, export_materials='PLACEHOLDER', export_texcoords=False, export_normals=False)
report('collision', col)
