# Builds the Fortress level's extension: the island grown south (new ground in the Fortress ground's own painted palette, a mountain divider, two
# spawn clearings with levelled roads). Reads models/Fortress_v5.glb (the ground as drawn) and models/Fortress_v5_col.glb (as collided with) and writes
# models/Fortress_ext.glb (the new ground with its painted texture, and the roads) and models/Fortress_ext_col.glb (the new ground, for collision). The
# game adds both to the Fortress set when it loads. The shape of the land is in fortress_ext_terrain.py (DESIGN is traced from Austin's drawing); the
# roads' levelled profiles are printed at the end, for FORT_EXT in index.html (the game levels the old ground along them at load).
# Run (from the game folder):
#   /Applications/Blender.app/Contents/MacOS/Blender -b --python tools/build_fortress_ext.py -- models
import bpy, sys, os, json
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fortress_ext_terrain as T

MODELS = sys.argv[-1]
TEX_BOX = (-68.0, 76.0, 40.0, 126.0)   # the world rectangle the ground's painted texture covers


def export(path, **kw):
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=False, export_apply=True, export_cameras=False, export_lights=False,
                              export_animations=False, export_skins=False, export_morph=False, export_extras=False, **kw)


def fresh(glb=None):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    if glb: bpy.ops.import_scene.gltf(filepath=os.path.join(MODELS, glb))


def game_tris(o):
    me = o.data; me.calc_loop_triangles(); m = np.array(o.matrix_world)
    v = np.array([p.co[:] for p in me.vertices]); v = (np.c_[v, np.ones(len(v))] @ m.T)[:, :3]
    g = np.stack([v[:, 0], v[:, 2], -v[:, 1]], 1)                      # game: x, y up, z = -blender y
    return g[np.array([lt.vertices[:] for lt in me.loop_triangles])] if len(me.loop_triangles) else np.zeros((0, 3, 3))


def add_mesh(name, verts, faces, material, uv=None):
    me = bpy.data.meshes.new(name)
    me.from_pydata([(x, -z, y) for x, y, z in verts], [], [tuple(int(i) for i in f) for f in faces]); me.update()
    if uv is not None:
        layer = me.uv_layers.new(name='UVMap')
        for poly in me.polygons:
            for li in poly.loop_indices: layer.data[li].uv = tuple(uv[me.loops[li].vertex_index])
    if material: me.materials.append(material)
    o = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(o); return o


def textured(name, rgb):
    """A material showing the image rgb (rows top to bottom)."""
    h, w = rgb.shape[:2]; img = bpy.data.images.new(name, w, h, alpha=False)
    px = np.ones((h, w, 4), np.float32); px[..., :3] = np.flipud(rgb).astype(np.float32) / 255.0
    img.pixels.foreach_set(px.ravel()); img.pack(); img.colorspace_settings.name = 'Non-Color'
    m = bpy.data.materials.new(name); m.use_nodes = True; nt = m.node_tree; bsdf = nt.nodes['Principled BSDF']
    tex = nt.nodes.new('ShaderNodeTexImage'); tex.image = img; tex.interpolation = 'Linear'
    nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color']); bsdf.inputs['Roughness'].default_value = 1.0
    return m


# the old ground, as drawn and as collided with
fresh('Fortress_v5.glb')
ground = max([o for o in bpy.data.objects if o.type == 'MESH'], key=lambda o: len(o.data.vertices))   # the island's ground: far the biggest piece
vis = game_tris(ground)
fresh('Fortress_v5_col.glb')
col = np.concatenate([t for t in (game_tris(o) for o in bpy.data.objects if o.type == 'MESH' and not o.name.startswith('Water')) if len(t)])
print('old ground', len(vis), 'triangles drawn,', len(col), 'collision')

F = T.make_fields(vis, col)
land = T.face_up(*T.build_land(F)); print('new ground', len(land[1]), 'triangles')
x0, x1, z0, z1 = TEX_BOX
uv = np.stack([(land[0][:, 0] - x0) / (x1 - x0), 1 - (land[0][:, 2] - z0) / (z1 - z0)], 1)       # (blender's v runs up the image)
paint, _ = T.paint_ground(F, TEX_BOX)
ribs = [T.road_ribbon(F, k) for k in ('roadA', 'roadB')]
rib = T.merge(*[(v, f) for v, f, _ in ribs]); rib_uv = np.vstack([u for _, _, u in ribs])

fresh()
add_mesh('Terrain_ext', *land, None)
export(os.path.join(MODELS, 'Fortress_ext_col.glb'), export_materials='PLACEHOLDER', export_normals=False, export_texcoords=False)

fresh()
add_mesh('Ground_ext', *land, textured('Ground_ext', paint), uv)
add_mesh('Road_ext', rib[0], rib[1], textured('Road_ext', T.road_texture()), np.stack([rib_uv[:, 0], 1 - rib_uv[:, 1]], 1))
export(os.path.join(MODELS, 'Fortress_ext.glb'), export_materials='EXPORT', export_normals=True, export_texcoords=True, export_image_format='JPEG', export_jpeg_quality=90)

# the roads' profiles, for the game to level the old ground to: every 2 m, [x, z, height]
roads = {k: [[round(float(x), 2), round(float(z), 2), round(float(h), 2)] for (x, z), h in zip(C[::2], hh[::2])] for k, (C, hh) in F.roads.items()}
print('FORT_EXT_ROADS', json.dumps(roads, separators=(',', ':')))
print('BUILT Fortress_ext, Fortress_ext_col')
