# FFA Pose Kit: author hold poses, weapon grips, crouch and death poses for the FFA prototype characters in Blender,
# using the Rigify controls in the source .blend files, and export them as small per-character pose files the game reads
# alongside its T-pose character GLBs (see README.md, "Posing characters").
#
# Works two ways:
#  - Blender add-on: install this file (Preferences > Add-ons > Install), enable it, then find the "FFA Pose Kit" tab
#    in the 3D viewport's N-panel.
#  - CLI:
#      /Applications/Blender.app/Contents/MacOS/Blender -b --python tools/ffa_pose_kit.py -- setup|export \
#          "<00_Exports folder>" "<game folder>" [Char ...]
#    With no character names, every character in CHARS is processed.
bl_info = {
    'name': 'FFA Pose Kit',
    'author': 'ffa-prototype',
    'version': (1, 0, 0),
    'blender': (4, 4, 0),
    'location': 'View3D > N-panel > FFA Pose Kit',
    'description': 'Author hold poses, weapon grips, crouch and death poses for FFA prototype characters',
    'category': 'Animation',
}

import bpy, sys, os, math, json, struct
from mathutils import Matrix

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from chars import CHARS, select_only, unhide, reparent_extra_bones, restore_bone_parents

POSE_NAMES = ['hold_pistol', 'hold_carbine', 'hold_rifle', 'hold_shotgun', 'crouch', 'death']
WEAPON_IDS = ['pistol', 'carbine', 'rifle', 'shotgun']
WEAPON_GLB = {'pistol': 'Laser_Pistol.glb', 'carbine': 'Midas_Carbine.glb', 'rifle': 'Master_Rifle.glb'}
SOCKET_BONE = 'DEF-Wrist.R'
# Rough seed, in the socket bone's local (tail-relative) space: a bit past the wrist, down into the palm.
# Austin adjusts these by hand per character once previews are in.
SOCKET_SEED = {
    'pistol':  (0.0, 0.07, 0.015),
    'carbine': (0.0, 0.10, 0.02),
    'rifle':   (0.0, 0.10, 0.02),
    'shotgun': (0.0, 0.10, 0.02),
}
PREVIEW_COLLECTION = 'PoseKit_Preview'
ANCHOR_NAME = 'PoseKit_Anchor'
README_NAME = 'PoseKit_README'

README_TEXT = """FFA Pose Kit

Posing a character for the game (hold poses, crouch, death):

1. Install this add-on (Preferences > Add-ons > Install > tools/ffa_pose_kit.py) and enable it, or run its `setup`
   CLI command once per character:
     Blender -b --python tools/ffa_pose_kit.py -- setup "<00_Exports folder>" "<game folder>" <Char>
   This saves a copy of the character's .blend as Poses/<Char>_poses.blend (the source .blend is never touched),
   with six empty actions (hold_pistol, hold_carbine, hold_rifle, hold_shotgun, crouch, death), one weapon socket
   empty per gun parented to DEF-Wrist.R, preview copies of the real guns, and this text block. Safe to re-run.
2. Open Poses/<Char>_poses.blend in Blender and find the "FFA Pose Kit" tab in the 3D viewport's N-panel.
3. Pick a weapon button to pose holding that gun: it shows only that weapon's preview and jumps to frame 1. Pose
   the character with the Rigify controls (FK/IK, fingers, etc). Move and rotate the Socket_<weapon> empty to seat
   the gun in the hand exactly where you want it — the preview gun follows the socket, so you can see it live.
   Don't move the preview gun itself, only its socket.
4. Press "Key Pose" to record the pose onto frame 1 of the current action. Repeat for each weapon.
5. Pose Crouch and Death the same way (no socket to place for these). Death is posed standing upright — the
   game tips the corpse over itself, so just author the limp/falling arm and leg shapes standing up.
6. Press "Export Poses" (set the game folder once in the panel) or run the CLI:
     Blender -b --python tools/ffa_pose_kit.py -- export "<00_Exports folder>" "<game folder>" <Char>
   This writes <game folder>/models/poses/<Char>.glb.
7. Run `python3 tools/inspect_poses.py <Char>` to sanity-check the export, then reload the game with `?posecheck`
   to see the character hold each gun, crouch and die into these poses.

Naming rules the exporter and game both rely on: no dots or spaces in socket, action or track names (three.js's
GLTFLoader strips them). Don't rename the character's DEF- bones.
"""


def poses_blend_path(src, char):
    return os.path.join(src, 'Poses', char + '_poses.blend')


def ensure_pose_actions(rig):
    if rig.animation_data is None:
        rig.animation_data_create()
    ad = rig.animation_data
    existing_tracks = {t.name for t in ad.nla_tracks}
    for name in POSE_NAMES:
        act = bpy.data.actions.get(name)
        if act is None:
            act = bpy.data.actions.new(name)
        act.use_fake_user = True
        act.use_frame_range = True
        act.frame_start = 1
        act.frame_end = 1
        if not act.slots:
            act.slots.new(id_type='OBJECT', name=rig.name)
        if name in existing_tracks:
            continue
        track = ad.nla_tracks.new()
        track.name = name
        strip = track.strips.new(name, 1, act)
        strip.action_slot = act.slots[0]
        strip.frame_end = strip.frame_start + 0.001   # keep the exporter's bake to exactly frame 1
        track.mute = True


def ensure_sockets(rig):
    sockets = {}
    for wid in WEAPON_IDS:
        name = 'Socket_' + wid
        obj = bpy.data.objects.get(name)
        if obj is None:
            obj = bpy.data.objects.new(name, None)
            bpy.context.collection.objects.link(obj)
            obj.empty_display_type = 'ARROWS'
            obj.empty_display_size = 0.1
            obj.parent = rig
            obj.parent_type = 'BONE'
            obj.parent_bone = SOCKET_BONE
            obj.matrix_parent_inverse = Matrix.Identity(4)
            obj.location = SOCKET_SEED[wid]
        sockets[wid] = obj
    return sockets


def ensure_preview_collection():
    coll = bpy.data.collections.get(PREVIEW_COLLECTION)
    if coll is None:
        coll = bpy.data.collections.new(PREVIEW_COLLECTION)
        bpy.context.scene.collection.children.link(coll)
    return coll


def move_to_collection(objs, coll):
    for o in objs:
        for c in list(o.users_collection):
            c.objects.unlink(o)
        coll.objects.link(o)


def parent_identity(obj, socket):
    obj.parent = socket
    obj.parent_type = 'OBJECT'
    obj.matrix_parent_inverse = Matrix.Identity(4)
    obj.location = (0.0, 0.0, 0.0)
    obj.rotation_euler = (0.0, 0.0, 0.0)


def import_weapon_preview(game, coll, wid, glbname, socket):
    name = 'Preview_' + wid
    if name in bpy.data.objects:
        return bpy.data.objects[name]
    before = set(bpy.data.objects.keys())
    bpy.ops.import_scene.gltf(filepath=os.path.join(game, 'models', glbname))
    new_objs = [bpy.data.objects[n] for n in bpy.data.objects.keys() if n not in before]
    if not new_objs:
        return None
    top = next((o for o in new_objs if o.parent is None), new_objs[0])
    top.name = name
    move_to_collection(new_objs, coll)
    parent_identity(top, socket)
    return top


# Rebuilds tools/ffa_pose_kit's reference, makeShotgun() (index.html, ~L1241), converting three's (x, y, z) to
# Blender's (x, -z, y): a box/cylinder-only proxy, just for lining up Socket_shotgun since the shotgun has no GLB.
SHOTGUN_PARTS = [
    ('cyl', 0.021, 0.62, -0.023, 0.02, -0.33, math.pi / 2),
    ('cyl', 0.021, 0.62, 0.023, 0.02, -0.33, math.pi / 2),
    ('box', (0.075, 0.07, 0.16), 0.0, 0.005, 0.03, 0.0),
    ('box', (0.07, 0.04, 0.24), 0.0, -0.022, -0.2, 0.0),
    ('box', (0.058, 0.09, 0.36), 0.0, -0.05, 0.27, 0.18),
    ('box', (0.012, 0.05, 0.05), 0.0, -0.045, 0.06, 0.0),
]


def build_shotgun_proxy(coll, socket):
    name = 'Preview_shotgun'
    if name in bpy.data.objects:
        return bpy.data.objects[name]
    root = bpy.data.objects.new(name, None)
    root.empty_display_size = 0.01
    coll.objects.link(root)
    for i, part in enumerate(SHOTGUN_PARTS):
        kind = part[0]
        if kind == 'cyl':
            _, r, h, x, y, z, rx = part
            bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=h, vertices=12)
        else:
            _, dims, x, y, z, rx = part
            bpy.ops.mesh.primitive_cube_add(size=1)
            bpy.context.object.dimensions = (dims[0], dims[2], dims[1])
        obj = bpy.context.object
        obj.name = f'{name}_{i}'
        obj.rotation_euler = (rx, 0.0, 0.0)
        obj.location = (x, -z, y)
        move_to_collection([obj], coll)
        obj.parent = root
        obj.matrix_parent_inverse = Matrix.Identity(4)
    parent_identity(root, socket)
    return root


def ensure_anchor_mesh(rig):
    obj = bpy.data.objects.get(ANCHOR_NAME)
    if obj is not None:
        return obj
    mesh = bpy.data.meshes.new(ANCHOR_NAME)
    mesh.from_pydata([(0.0, 0.0, 0.0), (0.01, 0.0, 0.0), (0.0, 0.01, 0.0)], [], [[0, 1, 2]])
    mesh.update()
    obj = bpy.data.objects.new(ANCHOR_NAME, mesh)
    bpy.context.collection.objects.link(obj)
    obj.hide_render = True
    obj.parent = rig
    vg = obj.vertex_groups.new(name='DEF-Spine1')
    vg.add([0, 1, 2], 1.0, 'REPLACE')
    mod = obj.modifiers.new('Armature', 'ARMATURE')
    mod.object = rig
    return obj


def ensure_readme_text():
    if README_NAME in bpy.data.texts:
        return
    t = bpy.data.texts.new(README_NAME)
    t.write(README_TEXT)


def setup_char(src, game, name, spec):
    blend, rigname = spec[0], spec[1]
    outfile = poses_blend_path(src, name)
    if os.path.exists(outfile):
        bpy.ops.wm.open_mainfile(filepath=outfile)
    else:
        os.makedirs(os.path.dirname(outfile), exist_ok=True)
        bpy.ops.wm.open_mainfile(filepath=os.path.join(src, blend))
        bpy.ops.wm.save_as_mainfile(filepath=outfile)

    rig = bpy.data.objects[rigname]
    unhide(rig)
    bpy.context.view_layer.objects.active = rig

    ensure_pose_actions(rig)
    sockets = ensure_sockets(rig)
    coll = ensure_preview_collection()
    for wid, glbname in WEAPON_GLB.items():
        import_weapon_preview(game, coll, wid, glbname, sockets[wid])
    build_shotgun_proxy(coll, sockets['shotgun'])
    ensure_anchor_mesh(rig)
    ensure_readme_text()

    bpy.ops.wm.save_mainfile()
    print('SETUP', name, '->', outfile)


def find_rig(context=None):
    # Rigify files keep the metarig around alongside the generated rig; only the generated one has DEF- bones.
    armatures = [o for o in (context or bpy.context).scene.objects if o.type == 'ARMATURE']
    for o in armatures:
        if any(b.name.startswith('DEF-') for b in o.data.bones):
            return o
    return armatures[0] if armatures else None


def resolve_rig(char):
    spec = CHARS.get(char)
    if spec is not None and spec[1] in bpy.data.objects:
        return bpy.data.objects[spec[1]]
    return find_rig()


# Blender's glTF exporter (5.0.1) silently drops objects bone-parented to a deform bone that isn't a direct child of the
# armature's own Blender-bone root - which every DEF- bone here is, on these Rigify rigs. So the sockets are computed and
# patched into the GLB ourselves (see socket_local_trs/inject_sockets) instead of relying on Blender to export them.
# The -90deg X correction is Blender's fixed "edit-bone rest matrix" -> "exported joint node" convention.
BONE_GLTF_CORRECTION = Matrix.Rotation(math.radians(-90), 4, 'X')


def socket_local_trs(rig, bone_name, socket):
    saved = rig.data.pose_position
    rig.data.pose_position = 'REST'
    bpy.context.view_layer.update()
    reference = rig.matrix_world @ rig.data.bones[bone_name].matrix_local @ BONE_GLTF_CORRECTION
    socket_world = socket.matrix_world.copy()
    rig.data.pose_position = saved
    bpy.context.view_layer.update()
    pos, rot, _scale = (reference.inverted() @ socket_world).decompose()
    return (pos.x, pos.z, -pos.y), (rot.x, rot.z, -rot.y, rot.w)


def _read_glb(path):
    with open(path, 'rb') as f:
        data = f.read()
    _magic, _version, length = struct.unpack('<4sII', data[0:12])
    off, gltf, bin_chunk = 12, None, None
    while off < length:
        clen, ctype = struct.unpack('<I4s', data[off:off + 8])
        chunk = data[off + 8:off + 8 + clen]
        if ctype == b'JSON':
            gltf = json.loads(chunk)
        elif ctype == b'BIN\x00':
            bin_chunk = chunk
        off += 8 + clen
    return gltf, bin_chunk


def _write_glb(path, gltf, bin_chunk):
    json_bytes = json.dumps(gltf, separators=(',', ':')).encode('utf-8')
    json_bytes += b' ' * ((4 - len(json_bytes) % 4) % 4)
    body = struct.pack('<I4s', len(json_bytes), b'JSON') + json_bytes
    if bin_chunk is not None:
        bin_bytes = bin_chunk + b'\x00' * ((4 - len(bin_chunk) % 4) % 4)
        body += struct.pack('<I4s', len(bin_bytes), b'BIN\x00') + bin_bytes
    with open(path, 'wb') as f:
        f.write(struct.pack('<4sII', b'glTF', 2, 12 + len(body)))
        f.write(body)


def attach_orphan_bones(path, rig_name):
    """Blender 5.0.1's glTF exporter, with pose_position='POSE' + export_rest_position_armature=True + NLA-track animations
    (what a posed, animated export needs), keeps a handful of non-deform Rigify control bones in the output to preserve the
    DEF bones' true parent chain - but fails to attach some of them as a child of anything, including the armature's own
    root node. Three.js's GLTFLoader (like any correct glTF consumer) only instantiates nodes reachable from scene.nodes, so
    those bones - and every DEF bone beneath them - are invisible to the game, even though the GLB technically "has" them.

    The orphaned bones' own local transforms are still correct: inspect_poses.py's model-space rest check, which treats an
    unparented node as already being in its own root space, matches the character GLB on every shared bone name regardless.
    So the fix is purely structural - reattach each orphan under the rig root without touching any transform."""
    gltf, bin_chunk = _read_glb(path)
    nodes = gltf['nodes']
    rig_idx = next((i for i, n in enumerate(nodes) if n.get('name') == rig_name), None)
    if rig_idx is None:
        print('WARNING:', rig_name, 'not found in', path, '- cannot fix orphan bones'); return

    def reachable():
        roots = gltf['scenes'][gltf.get('scene', 0)]['nodes']
        seen, stack = set(), list(roots)
        while stack:
            i = stack.pop()
            if i in seen: continue
            seen.add(i)
            stack.extend(nodes[i].get('children', []))
        return seen

    reattached = []
    for _ in range(len(nodes)):
        seen = reachable()
        if len(seen) == len(nodes):
            break
        child_of = {c for n in nodes for c in n.get('children', [])}
        orphan_roots = [i for i in range(len(nodes)) if i not in seen and i not in child_of and i != rig_idx]
        if not orphan_roots:
            break   # nodes are unreachable but all have a (likewise unreachable) parent - nothing safe to patch
        for i in orphan_roots:
            nodes[rig_idx].setdefault('children', []).append(i)
            reattached.append(nodes[i].get('name'))
    if reattached:
        print('  reattached orphaned bone node(s) under', rig_name + ':', reattached)
        _write_glb(path, gltf, bin_chunk)


def inject_sockets(path, socket_data):
    gltf, bin_chunk = _read_glb(path)
    nodes = gltf['nodes']
    index_by_name = {n.get('name'): i for i, n in enumerate(nodes)}
    for wid, data in socket_data.items():
        bone_idx = index_by_name.get(data['bone'])
        if bone_idx is None:
            print('WARNING: bone', data['bone'], 'not in', path, '- Socket_' + wid, 'not written'); continue
        node = {'name': 'Socket_' + wid}
        if any(abs(v) > 1e-6 for v in data['pos']):
            node['translation'] = list(data['pos'])
        rx, ry, rz, rw = data['rot']
        if abs(rx) > 1e-6 or abs(ry) > 1e-6 or abs(rz) > 1e-6 or abs(rw - 1.0) > 1e-6:
            node['rotation'] = [rx, ry, rz, rw]
        nodes[bone_idx].setdefault('children', []).append(len(nodes))
        nodes.append(node)
    _write_glb(path, gltf, bin_chunk)


def export_current_file(game, char):
    rig = resolve_rig(char)
    if rig is None:
        raise RuntimeError('no armature found for ' + str(char))

    sockets = {w: bpy.data.objects[n] for w in WEAPON_IDS for n in ['Socket_' + w] if n in bpy.data.objects}
    socket_data = {w: dict(zip(('pos', 'rot'), socket_local_trs(rig, SOCKET_BONE, o))) for w, o in sockets.items()}
    for w in socket_data:
        socket_data[w]['bone'] = SOCKET_BONE

    if rig.animation_data:
        rig.animation_data.action = None
    rig.data.pose_position = 'POSE'
    # export_current_file can run against the artist's already-open <Char>_poses.blend (the add-on's Export Poses button), so
    # the reparenting this needs for a correct export must not stick around afterwards - restore it once the export is done.
    reparented = reparent_extra_bones(rig)

    anchor = bpy.data.objects.get(ANCHOR_NAME)
    select_only([rig] + ([anchor] if anchor else []))

    outdir = os.path.join(game, 'models', 'poses')
    os.makedirs(outdir, exist_ok=True)
    outpath = os.path.join(outdir, char + '.glb')
    bpy.ops.export_scene.gltf(
        filepath=outpath, export_format='GLB', use_selection=True,
        export_apply=False, export_cameras=False, export_lights=False,
        export_skins=True, export_def_bones=True,
        export_animations=True, export_animation_mode='NLA_TRACKS',
        export_force_sampling=True, export_optimize_animation_size=False,
        export_rest_position_armature=True, export_yup=True, export_materials='NONE')
    attach_orphan_bones(outpath, rig.name)
    inject_sockets(outpath, socket_data)
    restore_bone_parents(rig, reparented)

    clips = [t.name for t in rig.animation_data.nla_tracks] if rig.animation_data else []
    print('WROTE', outpath, os.path.getsize(outpath))
    print('CLIPS', clips)
    print('SOCKETS', list(socket_data.keys()))
    return outpath


def cli_main():
    usage = 'Usage: Blender -b --python tools/ffa_pose_kit.py -- setup|export "<00_Exports folder>" "<game folder>" [Char ...]'
    argv = sys.argv
    if '--' not in argv:
        print(usage); return
    args = argv[argv.index('--') + 1:]
    if len(args) < 3:
        print(usage); return
    mode, src, game = args[0], args[1], args[2]
    names = args[3:] or list(CHARS.keys())
    for name in names:
        if name not in CHARS:
            print('Unknown character', name, '- skipping'); continue
        if mode == 'setup':
            setup_char(src, game, name, CHARS[name])
        elif mode == 'export':
            bpy.ops.wm.open_mainfile(filepath=poses_blend_path(src, name))
            export_current_file(game, name)
        else:
            print(usage); return


# ---- Add-on: N-panel to pose interactively inside a <Char>_poses.blend file ----

def char_from_blend_path():
    base = os.path.basename(bpy.data.filepath)
    if base.endswith('_poses.blend'):
        return base[:-len('_poses.blend')]
    return None


def set_active_pose(rig, action_name):
    act = bpy.data.actions.get(action_name)
    if act is None:
        return False
    if rig.animation_data is None:
        rig.animation_data_create()
    rig.animation_data.action = act
    if act.slots:
        rig.animation_data.action_slot = act.slots[0]
    return True


def show_only_preview(weapon):
    coll = bpy.data.collections.get(PREVIEW_COLLECTION)
    if coll is None:
        return
    for obj in coll.objects:
        wid = obj.name[len('Preview_'):] if obj.name.startswith('Preview_') else None
        obj.hide_set(wid != weapon)


def key_whole_character(context, rig):
    ks = context.scene.keying_sets_all.get('Whole Character')
    if ks is not None:
        try:
            with context.temp_override(active_object=rig, selected_objects=[rig], object=rig):
                bpy.ops.anim.keyframe_insert_by_name(type='Whole Character')
            return
        except RuntimeError:
            pass
    for pb in rig.pose.bones:
        pb.keyframe_insert('location', frame=1)
        pb.keyframe_insert('rotation_quaternion' if pb.rotation_mode == 'QUATERNION' else 'rotation_euler', frame=1)
        pb.keyframe_insert('scale', frame=1)


class FFAPK_OT_weapon_pose(bpy.types.Operator):
    bl_idname = 'ffapk.weapon_pose'
    bl_label = 'Pose Weapon'
    weapon: bpy.props.StringProperty()

    def execute(self, context):
        rig = find_rig(context)
        if rig is None:
            self.report({'ERROR'}, 'No armature in this file'); return {'CANCELLED'}
        set_active_pose(rig, 'hold_' + self.weapon)
        context.scene.frame_set(1)
        show_only_preview(self.weapon)
        sock = bpy.data.objects.get('Socket_' + self.weapon)
        if sock:
            select_only([sock])
        return {'FINISHED'}


class FFAPK_OT_named_pose(bpy.types.Operator):
    bl_idname = 'ffapk.named_pose'
    bl_label = 'Pose'
    action: bpy.props.StringProperty()

    def execute(self, context):
        rig = find_rig(context)
        if rig is None:
            self.report({'ERROR'}, 'No armature in this file'); return {'CANCELLED'}
        set_active_pose(rig, self.action)
        context.scene.frame_set(1)
        show_only_preview(None)
        return {'FINISHED'}


class FFAPK_OT_key_pose(bpy.types.Operator):
    bl_idname = 'ffapk.key_pose'
    bl_label = 'Key Pose'

    def execute(self, context):
        rig = find_rig(context)
        if rig is None or not rig.animation_data or not rig.animation_data.action:
            self.report({'ERROR'}, 'Pick a pose first'); return {'CANCELLED'}
        key_whole_character(context, rig)
        return {'FINISHED'}


class FFAPK_OT_export(bpy.types.Operator):
    bl_idname = 'ffapk.export_poses'
    bl_label = 'Export Poses'

    def execute(self, context):
        char = char_from_blend_path()
        if not char:
            self.report({'ERROR'}, 'Open a <Char>_poses.blend file first'); return {'CANCELLED'}
        game = context.scene.ffapk_game_path
        if not game:
            self.report({'ERROR'}, 'Set the game folder above first'); return {'CANCELLED'}
        try:
            outpath = export_current_file(bpy.path.abspath(game), char)
        except RuntimeError as e:
            self.report({'ERROR'}, str(e)); return {'CANCELLED'}
        self.report({'INFO'}, 'Wrote ' + outpath)
        return {'FINISHED'}


class FFAPK_PT_panel(bpy.types.Panel):
    bl_label = 'FFA Pose Kit'
    bl_idname = 'FFAPK_PT_panel'
    bl_space_type = 'VIEW_3D'
    bl_region_type = 'UI'
    bl_category = 'FFA Pose Kit'

    def draw(self, context):
        layout = self.layout
        rig = find_rig(context)
        if rig is None:
            layout.label(text='No armature in this file', icon='ERROR')
            return
        col = layout.column(align=True)
        col.label(text='Weapon hold pose:')
        row = col.row(align=True)
        for wid, label in zip(WEAPON_IDS, ['Pistol', 'Carbine', 'Rifle', 'Shotgun']):
            row.operator('ffapk.weapon_pose', text=label).weapon = wid
        col.separator()
        row = col.row(align=True)
        row.operator('ffapk.named_pose', text='Crouch').action = 'crouch'
        row.operator('ffapk.named_pose', text='Death').action = 'death'
        col.separator()
        col.operator('ffapk.key_pose', text='Key Pose', icon='KEY_HLT')
        col.separator()
        col.prop(context.scene, 'ffapk_game_path', text='Game folder')
        col.operator('ffapk.export_poses', text='Export Poses', icon='EXPORT')


classes = (FFAPK_OT_weapon_pose, FFAPK_OT_named_pose, FFAPK_OT_key_pose, FFAPK_OT_export, FFAPK_PT_panel)


def register():
    for c in classes:
        bpy.utils.register_class(c)
    bpy.types.Scene.ffapk_game_path = bpy.props.StringProperty(name='Game folder', subtype='DIR_PATH')


def unregister():
    del bpy.types.Scene.ffapk_game_path
    for c in reversed(classes):
        bpy.utils.unregister_class(c)


if __name__ == '__main__':
    if '--' in sys.argv:
        cli_main()
    else:
        register()
