# Builds the Minimal level from James's blockout (Collisions_Minimal.glb: the fort collision and the terrain collision) as
# two files: models/Minimal.glb, what's drawn (the game restyles it like the arena levels, see arenaStyle), and models/Minimal_col.glb, what everything collides with.
# Run (from the game folder):
#   "/Applications/Blender 5.2.app/Contents/MacOS/Blender" -b --python tools/build_minimal.py -- ../Collisions_Minimal.glb models
import bpy, sys, os

SRC, OUT = sys.argv[-2], sys.argv[-1]
COLOURS = {'Fort': (0.55, 0.53, 0.5, 1), 'Terrain': (0.33, 0.42, 0.26, 1)}  # stone, grass


def export(path, **kw):
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=False, export_apply=True, export_cameras=False, export_lights=False,
                              export_animations=False, export_skins=False, export_morph=False, export_extras=False, export_texcoords=False, **kw)


bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)
for o in [o for o in bpy.data.objects if o.type != 'MESH' or o.name.startswith('Plane')]: bpy.data.objects.remove(o, do_unlink=True)  # a stray screen plane
for o in bpy.data.objects:
    kind = 'Fort' if o.name.startswith('Fort') else 'Terrain'
    m = bpy.data.materials.get(kind) or bpy.data.materials.new(kind); m.diffuse_color = COLOURS[kind]
    m.use_nodes = True; m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = COLOURS[kind]
    o.data.materials.clear(); o.data.materials.append(m); o.name = kind
export(os.path.join(OUT, 'Minimal.glb'), export_materials='EXPORT', export_normals=True)
export(os.path.join(OUT, 'Minimal_col.glb'), export_materials='PLACEHOLDER', export_normals=False)
print('BUILT', ', '.join(o.name for o in bpy.data.objects))
