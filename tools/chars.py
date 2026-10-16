# Shared character table and Blender helpers, used by build_characters.py and ffa_pose_kit.py.
import bpy, os
from mathutils import Vector

# name: (blend file, rig name, meshes to keep, {material: texture file} to replace with a plain textured material)
CHARS = {
    'Soldier_2_heavy': ('Soldier_2_Eli.blend', 'RIG-Soldier2',
                        ['Body', 'Head', 'Back Canister', 'Backpack', 'Flare', 'Front Pouch', 'radio', 'Side Pouch'], {}),
    'Soldier_3_thin': ('Soldier_3_Beto.blend', 'RIG-Soldier3', ['Body', 'Head', 'Cube'], {}),
    'Soldier_4_bigframe': ('Soldier_4_Zeke.blend', 'RIG-Soldier 4', ['Body', 'Head', 'Largo Hand v3', 'pouch'], {}),
    'Soldier_5_smallframe': ('Soldier_10_Deigo.blend', 'RIG-Soldier 10', ['Body', 'Head', 'Cube'], {}),
    'Apprentice': ('C_Apprentice.blend', 'RIG-Cloud_Human', ['Body Apprentice', 'Apprentice Head v3.001'],
                   {'Head and Eyes': 'Apprentice_Head_base.png'}),
    'Master': ('Master_v2.blend', 'RIG-Cloud_Master', ['Body Master', 'head master v2', 'Cigarette', 'Glasses'],
               {'Mat_Master': 'master_head_color.png'}),
    'Officer': ('Officer.blend', 'RIG-Cloud_Officer', ['Officer Body', 'Officer Head'],
                {'Officer Head': 'Officer_Head-Color_v2.png'}),
}


def select_only(objs):
    for o in bpy.context.view_layer.objects: o.select_set(False)
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]


def unhide(o):
    o.hide_set(False); o.hide_viewport = False; o.hide_render = False


def relink_images(texdir):
    for im in bpy.data.images:
        if im.packed_file or im.source != 'FILE': continue
        base = os.path.basename(bpy.path.abspath(im.filepath)).replace('\\', '/')
        p = os.path.join(texdir, base)
        if os.path.exists(p): im.filepath = p; im.reload()


def nearest_def_bone(rig, o):
    pts = [o.matrix_world @ Vector(c) for c in o.bound_box]
    ctr = sum(pts, Vector()) / 8
    best, bd = None, 1e9
    for b in rig.data.bones:
        if not b.name.startswith('DEF-') or 'Finger' in b.name: continue
        c = rig.matrix_world @ ((b.head_local + b.tail_local) / 2)
        d = (c - ctr).length
        if d < bd: best, bd = b.name, d
    return best


def reparent_extra_bones(rig):
    """Deform bones that aren't DEF- bones (the Master's Sleeve.L/R) hang off control bones that don't get exported, so they'd
    sit still at the rig root. Parent each to the nearest DEF bone so it follows the arm.

    Returns the bones' original parent names (None for no parent), so a caller that must leave the open file as it found it
    (ffa_pose_kit's export, which can run against the artist's open _poses.blend) can pass this to restore_bone_parents."""
    extra = [b.name for b in rig.data.bones if b.use_deform and not b.name.startswith('DEF-')]
    if not extra: return []
    defs = [b.name for b in rig.data.bones if b.name.startswith('DEF-') and 'Finger' not in b.name]
    select_only([rig]); bpy.ops.object.mode_set(mode='EDIT')
    eb = rig.data.edit_bones
    saved = [(n, eb[n].parent.name if eb[n].parent else None) for n in extra]
    for n in extra:
        head = eb[n].head
        eb[n].parent = eb[min(defs, key=lambda d: (eb[d].head - head).length)]
        print('  reparented', n, '->', eb[n].parent.name)
    bpy.ops.object.mode_set(mode='OBJECT')
    return saved


def restore_bone_parents(rig, saved):
    """Undoes reparent_extra_bones using the list it returned."""
    if not saved: return
    select_only([rig]); bpy.ops.object.mode_set(mode='EDIT')
    eb = rig.data.edit_bones
    for n, parent_name in saved:
        eb[n].parent = eb[parent_name] if parent_name else None
    bpy.ops.object.mode_set(mode='OBJECT')
    print('  restored', len(saved), 'bone parent(s)')
