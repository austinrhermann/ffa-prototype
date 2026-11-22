# Builds the Pirate faction GLBs: each is a Midas soldier GLB with the repaint from a USDZ that was made from it
# (exports/midas-characters, painted in Procreate):
#   models/Pirate_Zeli.glb  <- Zeli.usdz  on Soldier_2_heavy.glb      (Eli)
#   models/Pirate_Veto.glb  <- Veto.usdz  on Soldier_3_thin.glb       (Beto)
#   models/Pirate_Reke.glb  <- Reke.usdz  on Soldier_4_bigframe.glb   (Zeke)
#   models/Pirate_Heigo.glb <- Heigo.usdz on Soldier_5_smallframe.glb (Deigo)
# The soldier GLB is edited directly, never round-tripped through Blender, so the skeleton, skin, mesh and normals
# stay byte for byte what the game already poses. Only the look changes:
#   - Body and Head keep their UVs (checked against the USDZ) and get the new pictures.
#   - The worn gear (pouches, packs, canisters: several meshes with flat colours) becomes one mesh with the USDZ's atlas
#     UVs and its painted picture: one draw call instead of up to eight. Its triangles are matched to the USDZ's by position.
#   - Unused vertex colours are dropped (the game doesn't draw them), pictures are JPEG at body 1024, head and gear 512.
# Blender is only used to read the USDZ meshes and to resize the pictures.
# Run (from the game folder):
#   /Applications/Blender.app/Contents/MacOS/Blender -b --python tools/build_pirates.py -- "<folder with the .usdz files>" models [only-name ...]
import bpy, sys, os, json, struct, zipfile, tempfile
import numpy as np

PIRATES = {   # out: (usdz, soldier glb, label)
    'Pirate_Zeli': ('Zeli.usdz', 'Soldier_2_heavy', 'Zeli'),
    'Pirate_Veto': ('Veto.usdz', 'Soldier_3_thin', 'Veto'),
    'Pirate_Reke': ('Reke.usdz', 'Soldier_4_bigframe', 'Reke'),
    'Pirate_Heigo': ('Heigo.usdz', 'Soldier_5_smallframe', 'Heigo'),
}
TEX = {'Body': 1024, 'Head': 512, 'Gear': 512}
JPEG_Q = 85
args = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT, ONLY = args[0], args[1], set(args[2:])

CT = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}


# ---------- GLB in / out ----------
def read_glb(path):
    b = open(path, 'rb').read()
    jl = struct.unpack('<I', b[12:16])[0]
    j = json.loads(b[20:20 + jl])
    o = 20 + jl; bl = struct.unpack('<I', b[o:o + 4])[0]
    return j, b[o + 8:o + 8 + bl]


def read_acc(j, binb, i):
    a = j['accessors'][i]; bv = j['bufferViews'][a['bufferView']]
    dt = np.dtype(CT[a['componentType']]); n = NC[a['type']]; w = dt.itemsize * n
    start = bv.get('byteOffset', 0) + a.get('byteOffset', 0); stride = bv.get('byteStride') or w
    rows = [binb[start + k * stride:start + k * stride + w] for k in range(a['count'])]
    arr = np.frombuffer(b''.join(rows), dtype=dt).reshape(a['count'], n)
    if a.get('normalized'): arr = arr.astype(np.float32) / np.iinfo(dt).max
    return arr


class Packer:
    def __init__(self): self.bin = bytearray(); self.views = []; self.accs = []

    def view(self, data, target=None):
        while len(self.bin) % 4: self.bin.append(0)
        v = {'buffer': 0, 'byteOffset': len(self.bin), 'byteLength': len(data)}
        if target: v['target'] = target
        self.bin += data; self.views.append(v); return len(self.views) - 1

    def acc(self, arr, typ, target=None, minmax=False):
        arr = np.ascontiguousarray(arr)
        ct = {np.dtype(v): k for k, v in CT.items()}[arr.dtype]
        a = {'bufferView': self.view(arr.tobytes(), target), 'componentType': ct, 'count': len(arr), 'type': typ}
        if minmax: a['min'] = arr.min(0).tolist(); a['max'] = arr.max(0).tolist()
        self.accs.append(a); return len(self.accs) - 1


def write_glb(path, j, binb):
    js = json.dumps(j, separators=(',', ':')).encode()
    js += b' ' * (-len(js) % 4); binb = bytes(binb) + b'\0' * (-len(binb) % 4)
    total = 12 + 8 + len(js) + 8 + len(binb)
    with open(path, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, total)); f.write(struct.pack('<II', len(js), 0x4E4F534A)); f.write(js)
        f.write(struct.pack('<II', len(binb), 0x004E4942)); f.write(binb)


# ---------- the USDZ: triangles (glTF axes, glTF UVs) and pictures ----------
def usdz_meshes(path):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.wm.usd_import(filepath=path, import_textures_mode='IMPORT_NONE')
    out = {}
    for o in bpy.data.objects:
        if o.type != 'MESH': continue
        me = o.data; mw = o.matrix_world; me.calc_loop_triangles(); uv = me.uv_layers[0].data
        P = [], []
        for t in me.loop_triangles:
            for li in t.loops:
                c = mw @ me.vertices[me.loops[li].vertex_index].co; u = uv[li].uv
                P[0].append((c.x, c.z, -c.y)); P[1].append((u.x, 1 - u.y))
        out[o.name.split('.')[0]] = (np.array(P[0]).reshape(-1, 3, 3), np.array(P[1]).reshape(-1, 3, 2))
    return out


def usdz_picture(path, part, size, tmp):
    with zipfile.ZipFile(path) as z:
        name = next(n for n in z.namelist() if n.endswith(f'_{part}_color.png'))
        src = os.path.join(tmp, f'{part}.png'); open(src, 'wb').write(z.read(name))
    img = bpy.data.images.load(src); img.colorspace_settings.name = 'sRGB'
    if max(img.size) > size: img.scale(size, size)
    dst = os.path.join(tmp, f'{part}.jpg'); img.file_format = 'JPEG'; img.save(filepath=dst, quality=JPEG_Q)
    return open(dst, 'rb').read()


def tri_normals(P):
    n = np.cross(P[:, 1] - P[:, 0], P[:, 2] - P[:, 0]); return n / np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-12)


# ---------- build one ----------
def build(out, usdz, soldier, label):
    print('BUILD', out)
    j, binb = read_glb(os.path.join(OUT, soldier + '.glb'))
    assert not j.get('animations'), 'soldier GLB has animations'
    usd = usdz_meshes(os.path.join(SRC, usdz))
    labels = list(usd); UP = np.concatenate([usd[k][0] for k in labels]); UU = np.concatenate([usd[k][1] for k in labels])
    ULab = np.concatenate([[k] * len(usd[k][0]) for k in labels]); UC = UP.mean(1); UN = tri_normals(UP)

    # match every soldier triangle to its USDZ triangle (same rest-pose position), corner by corner
    prims = []   # (node index, prim, label, per-corner UV (T,3,2), indices (T,3))
    for ni, node in enumerate(j['nodes']):
        if 'mesh' not in node: continue
        assert not any(k in node for k in ('matrix', 'translation', 'rotation', 'scale')), 'mesh node has a transform'
        for p in j['meshes'][node['mesh']]['primitives']:
            pos = read_acc(j, binb, p['attributes']['POSITION']); idx = read_acc(j, binb, p['indices']).reshape(-1, 3)
            T = pos[idx].astype(np.float64); C = T.mean(1); N = tri_normals(T)
            m = np.empty(len(T), int); err = 0
            for s in range(0, len(T), 256):   # (in chunks: a full distance table is a few hundred MB)
                d = np.linalg.norm(C[s:s + 256, None, :] - UC[None, :, :], axis=2)
                with np.errstate(all='ignore'): d += (N[s:s + 256] @ UN.T < 0) * 1e-3   # coincident back-to-back faces: the one facing the same way
                m[s:s + 256] = d.argmin(1); err = max(err, d.min(1).max())
            assert err < 1e-3, f'{out}: triangle not found in the USDZ ({err})'
            cd = np.linalg.norm(T[:, :, None, :] - UP[m][:, None, :, :], axis=3)   # (T, my corner, its corner)
            uv = UU[m][np.arange(len(m))[:, None], cd.argmin(2)]
            lab, cnt = np.unique(ULab[m], return_counts=True); lab = lab[cnt.argmax()]
            prims.append((ni, p, lab, uv, idx))
            if lab in ('Body', 'Head'):
                old = read_acc(j, binb, p['attributes']['TEXCOORD_0'])[idx]
                print(f'  {j["nodes"][ni]["name"]}: {lab}, {len(idx)} tris, UV drift {np.abs(old - uv).max():.2e}')
                assert np.abs(old - uv).max() < 1e-3, f'{out}: {lab} UVs changed in the USDZ'
            else:
                print(f'  {j["nodes"][ni]["name"]}: {lab}, {len(idx)} tris')

    pk = Packer()
    ibm = {}   # skin inverse bind matrices: copied as they are
    for s in j.get('skins', []):
        if 'inverseBindMatrices' in s:
            s['inverseBindMatrices'] = pk.acc(read_acc(j, binb, s['inverseBindMatrices']).astype(np.float32), 'MAT4')
    MAT = {'Body': 0, 'Head': 1, 'Gear': 2}

    def attrs(p):
        a = {}
        for k in ('POSITION', 'NORMAL', 'TEXCOORD_0', 'JOINTS_0', 'WEIGHTS_0'):
            if k in p['attributes']:
                acc = j['accessors'][p['attributes'][k]]; arr = read_acc(j, binb, p['attributes'][k])
                if k == 'WEIGHTS_0': arr = arr.astype(np.float32)
                a[k] = (arr, acc['type'])
        return a

    def put(a, idx):
        r = {}
        for k, (arr, typ) in a.items(): r[k] = pk.acc(arr, typ, 34962, minmax=(k == 'POSITION'))
        ii = idx.astype(np.uint16 if idx.max() < 65536 else np.uint32).reshape(-1, 1)
        return r, pk.acc(ii, 'SCALAR', 34963)

    # body and head: as they were, minus the vertex colours; the gear: one merged mesh
    meshes, node_mesh, gear = [], {}, []
    for ni, p, lab, uv, idx in prims:
        if lab == 'Gear': gear.append((p, uv, idx, ni)); continue
        a, ia = put(attrs(p), idx)
        if ni not in node_mesh: node_mesh[ni] = len(meshes); meshes.append({'name': j['nodes'][ni]['name'], 'primitives': []})
        meshes[node_mesh[ni]]['primitives'].append({'attributes': a, 'indices': ia, 'material': MAT[lab]})
    gear_node, drop = None, set()
    if gear:
        keymap, cols, new_idx = {}, {k: [] for k in ('POSITION', 'NORMAL', 'JOINTS_0', 'WEIGHTS_0', 'TEXCOORD_0')}, []
        jt = np.uint16 if any(j['accessors'][p['attributes']['JOINTS_0']]['componentType'] == 5123 for p, *_ in gear) else np.uint8
        for gi, (p, uv, idx, ni) in enumerate(gear):
            a = attrs(p)
            for t in range(len(idx)):
                tri = []
                for c in range(3):
                    v = int(idx[t, c]); u = uv[t, c]; key = (gi, v, round(u[0] * 1e5), round(u[1] * 1e5))
                    if key not in keymap:
                        keymap[key] = len(keymap)
                        cols['POSITION'].append(a['POSITION'][0][v]); cols['NORMAL'].append(a['NORMAL'][0][v])
                        cols['JOINTS_0'].append(a['JOINTS_0'][0][v]); cols['WEIGHTS_0'].append(a['WEIGHTS_0'][0][v]); cols['TEXCOORD_0'].append(u)
                    tri.append(keymap[key])
                new_idx.append(tri)
        g = {'POSITION': (np.array(cols['POSITION'], np.float32), 'VEC3'), 'NORMAL': (np.array(cols['NORMAL'], np.float32), 'VEC3'),
             'TEXCOORD_0': (np.array(cols['TEXCOORD_0'], np.float32), 'VEC2'), 'JOINTS_0': (np.array(cols['JOINTS_0']).astype(jt), 'VEC4'),
             'WEIGHTS_0': (np.array(cols['WEIGHTS_0'], np.float32), 'VEC4')}
        a, ia = put(g, np.array(new_idx))
        drop = {x[3] for x in gear} - set(node_mesh)   # nodes that held only gear: the first becomes the Gear node, the rest go
        assert drop, 'gear shares every node with the body or head'
        gear_node = min(drop); drop.discard(gear_node); node_mesh[gear_node] = len(meshes)
        meshes.append({'name': 'Gear', 'primitives': [{'attributes': a, 'indices': ia, 'material': MAT['Gear']}]})
        print(f'  gear: {len(gear)} pieces -> 1 mesh, {len(new_idx)} tris, {len(keymap)} verts')

    # nodes: mesh nodes point at the new meshes; the other gear nodes go (and every node index is renumbered)
    keep = [i for i in range(len(j['nodes'])) if i not in drop]; remap = {o: n for n, o in enumerate(keep)}
    nodes = []
    for i in keep:
        n = dict(j['nodes'][i])
        if 'mesh' in n: n['mesh'] = node_mesh[i]
        if i == gear_node: n['name'] = 'Gear'
        if 'children' in n: n['children'] = [remap[c] for c in n['children'] if c in remap]
        nodes.append(n)
    for s in j.get('skins', []):
        s['joints'] = [remap[x] for x in s['joints']]
        if 'skeleton' in s: s['skeleton'] = remap[s['skeleton']]
    for sc in j['scenes']: sc['nodes'] = [remap[x] for x in sc['nodes'] if x in remap]

    with tempfile.TemporaryDirectory() as tmp:
        pics = [usdz_picture(os.path.join(SRC, usdz), part, TEX[part], tmp) for part in ('Body', 'Head', 'Gear')]
    images = [{'name': f'{label}_{part}', 'mimeType': 'image/jpeg', 'bufferView': pk.view(data)} for part, data in zip(('Body', 'Head', 'Gear'), pics)]
    sampler = j['samplers'][0] if j.get('samplers') else {'magFilter': 9729, 'minFilter': 9987}
    j.update(nodes=nodes, meshes=meshes, accessors=pk.accs, bufferViews=pk.views, buffers=[{'byteLength': len(pk.bin)}], images=images,
             samplers=[sampler], textures=[{'sampler': 0, 'source': i} for i in range(3)],
             materials=[{'name': f'{label} {part}', 'pbrMetallicRoughness': {'baseColorTexture': {'index': i}, 'metallicFactor': 0}}
                        for i, part in enumerate(('Body', 'Head', 'Gear'))])
    for k in ('extensionsUsed', 'extensionsRequired'): j.pop(k, None)
    j['asset']['generator'] = 'tools/build_pirates.py'
    path = os.path.join(OUT, out + '.glb'); write_glb(path, j, pk.bin)
    print('WROTE', path, os.path.getsize(path), 'pictures', [len(p) for p in pics])


for out, spec in PIRATES.items():
    if not ONLY or out in ONLY: build(out, *spec)
