# Builds the character and carbine GLBs from the Blender asset library exports (T-pose, Rigify rigs):
#   models/Soldier_2_heavy.glb      <- Soldier_2_Eli.blend
#   models/Soldier_3_thin.glb       <- Soldier_3_Beto.blend
#   models/Soldier_4_bigframe.glb   <- Soldier_4_Zeke.blend
#   models/Soldier_5_smallframe.glb <- Soldier_10_Deigo.blend
#   models/Apprentice.glb           <- C_Apprentice.blend
#   models/Master.glb               <- Master_v2.blend
#   models/Officer.glb              <- Officer.blend
#   models/Midas_Carbine.glb        <- midas-carbine-v2.blend
# Each character keeps only the body, head and worn gear, skinned to the deform (DEF-) bones of its rig, in rest pose
# (the game poses the arms itself). Handheld guns, the mortar and the shield are left out.
# Run (from the game folder):
#   /Applications/Blender.app/Contents/MacOS/Blender -b --python tools/build_characters.py -- "<00_Exports folder>" models [only-name ...]
import bpy, sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from chars import CHARS, select_only, unhide, relink_images, nearest_def_bone, reparent_extra_bones

args = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT, ONLY = args[0], args[1], set(args[2:])
TEXDIR = os.path.join(SRC, 'Textures')
TEX_MAX = 1024   # body textures; heads and gear get half


def textured_material(name, tex):
    m = bpy.data.materials.new(name + '_flat'); m.use_nodes = True
    img = bpy.data.images.load(os.path.join(TEXDIR, tex), check_existing=True)
    t = m.node_tree.nodes.new('ShaderNodeTexImage'); t.image = img
    m.node_tree.links.new(t.outputs['Color'], m.node_tree.nodes['Principled BSDF'].inputs['Base Color'])
    return m


def baked_material(o, slot, camera, size=1024):
    """The heads' faces are projected from a face camera through a pile of nodes glTF can't carry: bake the colour into the
    head's UVs and use that as a plain textured material."""
    scn = bpy.context.scene; scn.render.engine = 'CYCLES'; scn.cycles.samples = 1; scn.cycles.device = 'CPU'
    if camera in bpy.data.objects: scn.camera = bpy.data.objects[camera]
    src = slot.material; nt = src.node_tree
    img = bpy.data.images.new(src.name + '_bake', size, size, alpha=False)
    n = nt.nodes.new('ShaderNodeTexImage'); n.image = img; nt.nodes.active = n
    select_only([o])
    bpy.ops.object.bake(type='DIFFUSE', pass_filter={'COLOR'}, use_clear=True, margin=6)
    nt.nodes.remove(n)
    m = bpy.data.materials.new(src.name + '_flat'); m.use_nodes = True
    t = m.node_tree.nodes.new('ShaderNodeTexImage'); t.image = img
    m.node_tree.links.new(t.outputs['Color'], m.node_tree.nodes['Principled BSDF'].inputs['Base Color'])
    return m


def prep_mesh(o, rig):
    unhide(o)
    select_only([o])
    if o.data.shape_keys: bpy.ops.object.shape_key_remove(all=True, apply_mix=True)
    skinned = any(m.type == 'ARMATURE' and m.object == rig for m in o.modifiers)
    # modifiers: keep the armature that deforms with the character rig, bake everything else (in order), drop other armatures
    for m in list(o.modifiers):
        if m.type == 'ARMATURE':
            if m.object != rig: o.modifiers.remove(m)
        elif m.type == 'COLLISION' or m.type == 'CLOTH':
            o.modifiers.remove(m)
        else:
            try: bpy.ops.object.modifier_apply(modifier=m.name)
            except RuntimeError as e: print('  could not apply', o.name, m.name, e); o.modifiers.remove(m)
    # re-parent to the rig object, keeping the world position
    mw = o.matrix_world.copy(); o.parent = rig; o.parent_type = 'OBJECT'; o.matrix_world = mw
    if not skinned:   # rigid gear: weight everything to the nearest deform bone so it follows the body
        for vg in list(o.vertex_groups): o.vertex_groups.remove(vg)
        vg = o.vertex_groups.new(name=nearest_def_bone(rig, o)); vg.add(range(len(o.data.vertices)), 1.0, 'REPLACE')
        mod = o.modifiers.new('Armature', 'ARMATURE'); mod.object = rig
    return o


def shrink_images(objs):
    seen = set()
    for o in objs:
        for s in o.material_slots:
            if not s.material or not s.material.use_nodes: continue
            for n in s.material.node_tree.nodes:
                if n.type != 'TEX_IMAGE' or not n.image or n.image in seen: continue
                seen.add(n.image); im = n.image
                lim = TEX_MAX if o.name.startswith(('Body', 'Officer Body')) else TEX_MAX // 2
                if max(im.size) > lim: im.scale(lim, lim)


def export(path, objs, **kw):
    select_only(objs)
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_apply=False, export_cameras=False,
                              export_lights=False, export_animations=False, export_morph=False, export_extras=False,
                              export_image_format='JPEG', export_jpeg_quality=85, export_yup=True, **kw)
    print('WROTE', path, os.path.getsize(path))


def build_char(out, spec):
    blend, rigname, keep, retex = spec
    bpy.ops.wm.open_mainfile(filepath=os.path.join(SRC, blend))
    relink_images(TEXDIR)
    rig = bpy.data.objects[rigname]; unhide(rig)
    rig.data.pose_position = 'REST'   # T-pose; prop rigs stay posed so glasses and the like sit where they were placed
    bpy.context.view_layer.update()
    reparent_extra_bones(rig)
    objs = [prep_mesh(bpy.data.objects[n], rig) for n in keep]
    for o in objs:
        for s in o.material_slots:
            if s.material and s.material.name in retex: s.material = textured_material(s.material.name, retex[s.material.name])
    shrink_images(objs)
    export(os.path.join(OUT, out + '.glb'), [rig] + objs, export_skins=True, export_def_bones=True)


def build_carbine():
    bpy.ops.wm.open_mainfile(filepath=os.path.join(SRC, 'midas-carbine-v2.blend'))
    relink_images(TEXDIR)
    o = bpy.data.objects['Midas Carbine']; unhide(o); select_only([o])
    for m in list(o.modifiers):
        if m.type == 'ARMATURE': o.modifiers.remove(m); continue
        try: bpy.ops.object.modifier_apply(modifier=m.name)
        except RuntimeError as e: print('  could not apply', m.name, e); o.modifiers.remove(m)
    o.parent = None; o.matrix_world = o.matrix_world
    shrink_images([o])
    export(os.path.join(OUT, 'Midas_Carbine.glb'), [o], export_skins=False)


for out, spec in CHARS.items():
    if not ONLY or out in ONLY: build_char(out, spec)
if not ONLY or 'Midas_Carbine' in ONLY: build_carbine()
