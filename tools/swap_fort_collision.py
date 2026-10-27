# Puts a hand-made fort collision mesh into models/Fortress_v5_col.glb, keeping the rest of the collision set:
# terrain, water, props as boxes, the Front_Gate box and the old door. The old fort pieces and stair ramps go; the rock
# around the old fort is kept only outside the new fort's footprint (the display still shows it there).
# Run (from the game folder), after tools/build_fortress.py if you rebuild the set:
#   "/Applications/Blender 5.2.app/Contents/MacOS/Blender" -b --python tools/swap_fort_collision.py -- <fort .glb> models/Fortress_v5_col.glb
import bpy, bmesh, sys

FORT, COL = sys.argv[-2], sys.argv[-1]
OLD_FORT = {'fort_sculpt_2', 'fort_sculpt_2.001', 'Fort Tower', 'Stairs', 'Stairs.001'}
MARGIN = 0.2  # rock this close to the new fort's footprint goes too
DEEP = 0.5  # and so do rock faces with a corner this far inside it (long slivers reaching over the walls)


def imp(path):
    before = set(bpy.data.objects); bpy.ops.import_scene.gltf(filepath=path)
    return [o for o in bpy.data.objects if o not in before]


bpy.ops.wm.read_factory_settings(use_empty=True)
old = imp(COL)
new = [o for o in imp(FORT) if o.type == 'MESH' and not o.name.startswith('Plane')]  # Plane.*: stray helper planes
for o in [o for o in bpy.data.objects if o.type == 'MESH' and o.name.startswith('Plane')]: bpy.data.objects.remove(o, do_unlink=True)
# The new fort's footprint (Blender x, y)
pts = [o.matrix_world @ v.co for o in new for v in o.data.vertices]
x0, x1 = min(p.x for p in pts) - MARGIN, max(p.x for p in pts) + MARGIN
y0, y1 = min(p.y for p in pts) - MARGIN, max(p.y for p in pts) + MARGIN
for o in old:
    if o.name.startswith('Ramp') or o.name in OLD_FORT - {'fort_sculpt_2'}: bpy.data.objects.remove(o, do_unlink=True)
    elif o.name == 'fort_sculpt_2':  # the fort on its rock: keep the rock that lies outside the new fort
        bm = bmesh.new(); bm.from_mesh(o.data); mw = o.matrix_world
        inside = lambda p, m: x0 + m <= p.x <= x1 - m and y0 + m <= p.y <= y1 - m
        doomed = [f for f in bm.faces if inside(mw @ f.calc_center_median(), 0) or any(inside(mw @ v.co, MARGIN + DEEP) for v in f.verts)]
        bmesh.ops.delete(bm, geom=doomed, context='FACES'); bm.to_mesh(o.data); bm.free(); o.name = 'Fort Rock'
        print(f'ROCK kept {len(o.data.polygons)} faces, cut {len(doomed)}')
for i, o in enumerate(new):
    o.name = 'Fort' if i == 0 else f'Fort.{i:03d}'
bpy.ops.export_scene.gltf(filepath=COL, export_format='GLB', use_selection=False, export_apply=True, export_cameras=False, export_lights=False,
                          export_animations=False, export_skins=False, export_morph=False, export_extras=False,
                          export_materials='PLACEHOLDER', export_texcoords=False, export_normals=False)
print('BUILT', COL, ', '.join(sorted(o.name for o in bpy.data.objects if not o.name.startswith('Cube'))))
