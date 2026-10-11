# Exports the Fortress set to models/Fortress.glb with modifiers applied.
# Run: /Applications/Blender.app/Contents/MacOS/Blender -b "<Asset Library>/Sets/Fortress/Fortress.blend" --python tools/export_fortress.py
import bpy, os

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'models', 'Fortress.glb')
KEEP = ['Ground', 'Fortress', 'Fort floor', 'Front wall', 'Front wall.001', 'Front Gate', 'Tower', 'Tower room', 'Roof', 'Cylinder',
        'Icosphere', 'Icosphere.001', 'Icosphere.002', 'Icosphere.003', 'Icosphere.004', 'Computer', 'Mainframe', 'Mainframe.001',
        'Mainframe.002', 'Mainframe.003', 'Table', 'Gun Cabinet', 'Workbench', 'Water'] + [f'Mball.{i:03d}' for i in range(1, 12)]

dg = bpy.context.evaluated_depsgraph_get()
img = bpy.data.images['Ground Color.jpg.001']
mats = {}

def mat(name):
    # Fresh node materials (some in the file have no node tree, which the glTF exporter rejects); the game recolours by name
    if name not in mats:
        m = bpy.data.materials.new('FX_' + name)
        if m.node_tree is None:
            m.use_nodes = True
        nt = m.node_tree
        if name == 'Ground':
            t = nt.nodes.new('ShaderNodeTexImage'); t.image = img
            nt.links.new(t.outputs['Color'], nt.nodes['Principled BSDF'].inputs['Base Color'])
        mats[name] = m
    return mats[name]

# Bake each object (modifiers applied) into a clean scene under its original name
baked = []
for n in KEEP:
    o = bpy.data.objects[n]
    me = bpy.data.meshes.new_from_object(o.evaluated_get(dg), preserve_all_data_layers=False, depsgraph=dg)
    names = [s.material.name if s.material else 'Fortress' for s in o.material_slots] or ['Fortress']
    me.materials.clear()
    for nm in names:
        me.materials.append(mat(nm))
    baked.append((n, me, o.matrix_world.copy()))
    o.name = n + '_src'
scn = bpy.data.scenes.new('Fortress')
objs = {}
for n, me, mw in baked:
    no = bpy.data.objects.new(n, me); no.matrix_world = mw; scn.collection.objects.link(no); objs[n] = no

def box(name, x0, y0, z0, x1, y1, z1, material):
    import bmesh
    me = bpy.data.meshes.new(name); bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co.x = x0 if v.co.x < 0 else x1; v.co.y = y0 if v.co.y < 0 else y1; v.co.z = z0 if v.co.z < 0 else z1
    bm.to_mesh(me); bm.free(); me.materials.append(mat(material))
    o = bpy.data.objects.new(name, me); scn.collection.objects.link(o); return o

# Game edits (Blender coordinates; the game's z is -y):
# a doorway in the tower's courtyard wall so players can reach the ladder up through the tower-room hatch
cutter = box('DoorCut', 2.3, -1.65, 33.4, 3.5, -0.35, 35.9, 'Fortress')
for n in ('Tower', 'Fortress'):
    o = objs[n]; m = o.modifiers.new('door', 'BOOLEAN'); m.operation = 'DIFFERENCE'; m.object = cutter; m.solver = 'EXACT'
    with bpy.context.temp_override(scene=scn, view_layer=scn.view_layers[0]):
        dg2 = bpy.context.evaluated_depsgraph_get(); dg2.update()
        nm = bpy.data.meshes.new_from_object(o.evaluated_get(dg2), preserve_all_data_layers=False, depsgraph=dg2)
    o.modifiers.clear(); o.data = nm
bpy.data.objects.remove(cutter)
# a floor over the open shaft in the east half of the tower base
box('Tower floor', 5.7, -6.1, 32.6, 7.6, 1.6, 33.52, 'dirt ground')

with bpy.context.temp_override(scene=scn, view_layer=scn.view_layers[0]):
    bpy.ops.export_scene.gltf(filepath=OUT, use_selection=False, use_active_scene=True, export_format='GLB',
                              export_animations=False, export_skins=False, export_morph=False, export_cameras=False,
                              export_lights=False, export_yup=True, export_image_format='JPEG', export_jpeg_quality=85)
print('Exported', OUT, {n: len(o.data.polygons) for n, o in objs.items() if n in ('Tower', 'Fortress')})
