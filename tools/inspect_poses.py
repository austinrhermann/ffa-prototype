#!/usr/bin/env python3
"""Inspects an authored character's pose kit GLB against its base character GLB.

Parses the GLB container by hand (12-byte header + JSON + optional BIN chunk) - no glTF library,
no deps. Node TRS and hierarchy live in the JSON chunk; animation keyframe values live in the BIN
chunk via accessors, which the posed-vs-rest report reads directly (FLOAT accessors only, no
sparse accessors, no byteStride beyond standard tight packing - all true of Blender's GLB export).

Reports:
  - animation clips: track count and the bones each one touches
  - Socket_* nodes: parent node and local TRS
  - posed-vs-rest: per clip, how many of its bones differ from that node's default (rest) value
    at the clip's first keyframe. 0 means the clip hasn't been posed yet.
  - reachability check: every one of the skin's joints must be reachable from scenes[0].nodes by
    walking "children" arrays. A glTF consumer (three.js's GLTFLoader included) only instantiates
    nodes it can reach from the scene root; a joint that technically exists in the JSON but isn't
    wired into that tree is invisible to the game even though this file's rest check and clip data
    look fine. Blender 5.0.1's exporter has been seen doing exactly this - keeping a few non-deform
    Rigify control bones in the output without attaching them (or the DEF bones under them) to
    anything - so this check exists specifically to catch that class of bug again.
  - rest check: every node name shared by both files must land at the same default (bind-pose)
    position in *model space* (its own local transform composed with every ancestor's, up to the
    scene root) within 1e-4, as a 4x4 matrix comparison (robust to the rotation/-rotation
    quaternion double-cover that a raw component compare would flag as a false mismatch).
    Model space, not local space: the poses file keeps Rigify control bones (HIP-Spine1,
    CHST-Spine1, FK-OS-Spine3, FK-Shoulder.R) as parents of several root-level DEF bones, while
    the character file parents those same DEF bones directly to the rig, so comparing local
    transforms would be comparing numbers expressed relative to different parents. Model space
    is the guarantee that actually matters: that the poses line up with the character's skeleton
    in world terms. A mismatch means the exporter settings drifted between the two GLBs, not
    something to patch around in the game.

Usage:
  python3 tools/inspect_poses.py <CharName> [models_dir]

Exits non-zero if either file is missing, a skin joint is unreachable from the scene root, or the
rest check fails.
"""
import json
import os
import struct
import sys

TOLERANCE = 1e-4
ROT_TOLERANCE = 1e-4

COMPONENT_TYPES = {5120: ('b', 1), 5121: ('B', 1), 5122: ('h', 2), 5123: ('H', 2), 5125: ('I', 4), 5126: ('f', 4)}
TYPE_COUNTS = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}


def load_glb(path):
    with open(path, 'rb') as f:
        data = f.read()
    if len(data) < 12:
        raise ValueError(f'{path}: too short to be a GLB')
    magic, version, length = struct.unpack_from('<4sII', data, 0)
    if magic != b'glTF':
        raise ValueError(f'{path}: not a GLB file (bad magic {magic!r})')
    offset = 12
    doc, bin_chunk = None, None
    while offset + 8 <= length:
        chunk_len, chunk_type = struct.unpack_from('<I4s', data, offset)
        offset += 8
        chunk_data = data[offset:offset + chunk_len]
        offset += chunk_len
        if chunk_type == b'JSON':
            doc = json.loads(chunk_data)
        elif chunk_type == b'BIN\x00':
            bin_chunk = chunk_data
    if doc is None:
        raise ValueError(f'{path}: no JSON chunk found')
    return doc, bin_chunk


def read_accessor_values(doc, bin_chunk, idx):
    acc = doc['accessors'][idx]
    num_comp = TYPE_COUNTS[acc['type']]
    fmt_char, comp_size = COMPONENT_TYPES[acc['componentType']]
    bv = doc['bufferViews'][acc['bufferView']]
    base_offset = bv.get('byteOffset', 0) + acc.get('byteOffset', 0)
    stride = bv.get('byteStride') or num_comp * comp_size
    return [struct.unpack_from('<' + fmt_char * num_comp, bin_chunk, base_offset + i * stride)
            for i in range(acc['count'])]


def node_name(nodes, idx):
    if idx is None or idx >= len(nodes):
        return '<none>'
    return nodes[idx].get('name', f'<unnamed:{idx}>')


def build_parent_map(doc):
    parent_of = {}
    for i, n in enumerate(doc.get('nodes', [])):
        for c in n.get('children', []):
            parent_of[c] = i
    return parent_of


def trs_to_matrix(t, r, s):
    x, y, z, w = r
    sx, sy, sz = s
    xx, yy, zz = x * x, y * y, z * z
    xy, xz, yz = x * y, x * z, y * z
    wx, wy, wz = w * x, w * y, w * z
    m00, m01, m02 = (1 - 2 * (yy + zz)) * sx, (2 * (xy - wz)) * sy, (2 * (xz + wy)) * sz
    m10, m11, m12 = (2 * (xy + wz)) * sx, (1 - 2 * (xx + zz)) * sy, (2 * (yz - wx)) * sz
    m20, m21, m22 = (2 * (xz - wy)) * sx, (2 * (yz + wx)) * sy, (1 - 2 * (xx + yy)) * sz
    tx, ty, tz = t
    return (m00, m10, m20, 0.0, m01, m11, m21, 0.0, m02, m12, m22, 0.0, tx, ty, tz, 1.0)


def node_matrix(node):
    if 'matrix' in node:
        return tuple(node['matrix'])
    t = node.get('translation', [0.0, 0.0, 0.0])
    r = node.get('rotation', [0.0, 0.0, 0.0, 1.0])
    s = node.get('scale', [1.0, 1.0, 1.0])
    return trs_to_matrix(t, r, s)


def report_clips(doc):
    nodes = doc.get('nodes', [])
    anims = doc.get('animations', [])
    if not anims:
        print('  (no animation clips)')
        return
    for anim in anims:
        channels = anim.get('channels', [])
        bones = sorted({node_name(nodes, ch.get('target', {}).get('node')) for ch in channels})
        print(f"  {anim.get('name', '<unnamed>')!r}: {len(channels)} tracks, {len(bones)} bones")
        for b in bones:
            print(f'    - {b}')


def report_sockets(doc, parent_of):
    nodes = doc.get('nodes', [])
    found = False
    for i, n in enumerate(nodes):
        name = n.get('name', '')
        if not name.startswith('Socket_'):
            continue
        found = True
        parent = node_name(nodes, parent_of.get(i))
        t = n.get('translation', [0.0, 0.0, 0.0])
        r = n.get('rotation', [0.0, 0.0, 0.0, 1.0])
        s = n.get('scale', [1.0, 1.0, 1.0])
        print(f'  {name}: parent={parent!r}')
        print(f'    pos={t}')
        print(f'    quat={r}')
        print(f'    scale={s}')
    if not found:
        print('  (no Socket_* nodes found)')


def report_pose_diffs(doc, bin_chunk):
    nodes = doc.get('nodes', [])
    anims = doc.get('animations', [])
    if not anims:
        print('  (no animation clips)')
        return
    if bin_chunk is None:
        print('  (no binary chunk - cannot read keyframe values)')
        return
    for anim in anims:
        samplers = anim.get('samplers', [])
        posed, total = set(), set()
        for ch in anim.get('channels', []):
            target = ch.get('target', {})
            node_idx, path = target.get('node'), target.get('path')
            if node_idx is None or path not in ('translation', 'rotation', 'scale'):
                continue
            bname = node_name(nodes, node_idx)
            total.add(bname)
            values = read_accessor_values(doc, bin_chunk, samplers[ch['sampler']]['output'])
            if not values:
                continue
            first = values[0]
            default_key = path if path != 'rotation' else 'rotation'
            if path == 'rotation':
                default = tuple(nodes[node_idx].get('rotation', [0.0, 0.0, 0.0, 1.0]))
                dot = sum(a * b for a, b in zip(first, default))
                changed = abs(dot) < 1 - ROT_TOLERANCE
            else:
                default = tuple(nodes[node_idx].get(default_key, [0.0, 0.0, 0.0] if path == 'translation' else [1.0, 1.0, 1.0]))
                changed = max(abs(a - b) for a, b in zip(first, default)) > TOLERANCE
            if changed:
                posed.add(bname)
        note = ' (not posed yet)' if not posed else ''
        print(f"  {anim.get('name', '<unnamed>')!r}: {len(posed)}/{len(total)} bone(s) differ from rest{note}")


def reachable_from_scene(doc):
    nodes = doc.get('nodes', [])
    scenes = doc.get('scenes', [])
    roots = scenes[doc.get('scene', 0)]['nodes'] if scenes else []
    seen, stack = set(), list(roots)
    while stack:
        i = stack.pop()
        if i in seen: continue
        seen.add(i)
        stack.extend(nodes[i].get('children', []))
    return seen


def reachability_check(doc):
    nodes = doc.get('nodes', [])
    seen = reachable_from_scene(doc)
    unreachable = []
    for skin in doc.get('skins', []):
        for j in skin.get('joints', []):
            if j not in seen:
                unreachable.append(node_name(nodes, j))
    return unreachable


def mat_mul(a, b):
    # column-major 4x4, as glTF stores them
    return tuple(sum(a[k * 4 + r] * b[c * 4 + k] for k in range(4)) for c in range(4) for r in range(4))


def model_space_matrices(doc):
    """Each named node's matrix in the scene's space (parents walked up to the root). The poses export keeps a few Rigify
    control bones (HIP-Spine1, FK-OS-Spine3, ...) as extra parents that the character GLB doesn't have, so local transforms
    differ by parent while the bones still sit in the same place: compare where they are, not their raw local TRS."""
    nodes = doc.get('nodes', [])
    parent_of = build_parent_map(doc)
    cache = {}

    def world(i):
        if i not in cache:
            m = node_matrix(nodes[i])
            p = parent_of.get(i)
            cache[i] = mat_mul(world(p), m) if p is not None else m
        return cache[i]
    return {n['name']: world(i) for i, n in enumerate(nodes) if 'name' in n}


def rest_check(base_doc, poses_doc):
    base_by_name = model_space_matrices(base_doc)
    pose_by_name = model_space_matrices(poses_doc)
    common = sorted(set(base_by_name) & set(pose_by_name))
    mismatches = []
    for name in common:
        diff = max(abs(a - b) for a, b in zip(base_by_name[name], pose_by_name[name]))
        if diff > TOLERANCE:
            mismatches.append((name, diff))
    return common, mismatches


def main():
    if len(sys.argv) < 2:
        print('usage: inspect_poses.py <CharName> [models_dir]', file=sys.stderr)
        sys.exit(2)
    char = sys.argv[1]
    models_dir = sys.argv[2] if len(sys.argv) > 2 else 'models'
    base_path = os.path.join(models_dir, char + '.glb')
    poses_path = os.path.join(models_dir, 'poses', char + '.glb')

    for p in (base_path, poses_path):
        if not os.path.exists(p):
            print(f'ERROR: missing {p}', file=sys.stderr)
            sys.exit(1)

    base_doc, _base_bin = load_glb(base_path)
    poses_doc, poses_bin = load_glb(poses_path)
    parent_of = build_parent_map(poses_doc)

    print(f'=== {char} ===')
    print(f'base:  {base_path} ({os.path.getsize(base_path)} bytes)')
    print(f'poses: {poses_path} ({os.path.getsize(poses_path)} bytes)')

    print('\nClips:')
    report_clips(poses_doc)

    print('\nSockets:')
    report_sockets(poses_doc, parent_of)

    print('\nPosed vs rest (first keyframe vs node default, per clip):')
    report_pose_diffs(poses_doc, poses_bin)

    print('\nReachability check (every skin joint reachable from the scene root):')
    unreachable_joints = reachability_check(poses_doc)
    failed = False
    if unreachable_joints:
        failed = True
        print(f'  FAIL: {len(unreachable_joints)} joint(s) not reachable from scenes[0].nodes:')
        for name in unreachable_joints:
            print(f'    {name}')
    else:
        print('  OK: every joint is reachable')

    print(f'\nRest check (poses vs base, model space, tol={TOLERANCE}):')
    common, mismatches = rest_check(base_doc, poses_doc)
    print(f'  {len(common)} shared node names checked')
    if mismatches:
        failed = True
        print(f'  FAIL: {len(mismatches)} mismatch(es):')
        for name, diff in mismatches:
            print(f'    {name}: max abs diff {diff:.6f}')
    else:
        print('  OK: all shared nodes match within tolerance')

    if failed:
        sys.exit(1)


if __name__ == '__main__':
    main()
