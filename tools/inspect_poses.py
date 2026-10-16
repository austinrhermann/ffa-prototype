#!/usr/bin/env python3
"""Inspects an authored character's pose kit GLB against its base character GLB.

Parses the GLB container by hand (12-byte header + chunks) and reads only the JSON chunk - no
glTF library, no deps. Node TRS and matrices live directly in the JSON, so the binary chunk is
never needed here.

Reports:
  - animation clips: track count and the bones each one touches
  - Socket_* nodes: parent node and local TRS
  - rest check: every node name shared by both files must have the same default (bind-pose)
    transform within 1e-4, as a 4x4 matrix comparison (robust to the rotation/-rotation quaternion
    double-cover that a raw component compare would flag as a false mismatch). This is the
    guarantee that the poses line up with the character's skeleton; a mismatch means the exporter
    settings drifted between the two GLBs, not something to patch around in the game.

Usage:
  python3 tools/inspect_poses.py <CharName> [models_dir]

Exits non-zero if either file is missing or the rest check fails.
"""
import json
import os
import struct
import sys

TOLERANCE = 1e-4


def load_glb_json(path):
    with open(path, 'rb') as f:
        data = f.read()
    if len(data) < 12:
        raise ValueError(f'{path}: too short to be a GLB')
    magic, version, length = struct.unpack_from('<4sII', data, 0)
    if magic != b'glTF':
        raise ValueError(f'{path}: not a GLB file (bad magic {magic!r})')
    offset = 12
    while offset + 8 <= length:
        chunk_len, chunk_type = struct.unpack_from('<I4s', data, offset)
        offset += 8
        chunk_data = data[offset:offset + chunk_len]
        offset += chunk_len
        if chunk_type == b'JSON':
            return json.loads(chunk_data)
    raise ValueError(f'{path}: no JSON chunk found')


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


def rest_check(base_doc, poses_doc):
    base_by_name = {n['name']: node_matrix(n) for n in base_doc.get('nodes', []) if 'name' in n}
    pose_by_name = {n['name']: node_matrix(n) for n in poses_doc.get('nodes', []) if 'name' in n}
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

    base_doc = load_glb_json(base_path)
    poses_doc = load_glb_json(poses_path)
    parent_of = build_parent_map(poses_doc)

    print(f'=== {char} ===')
    print(f'base:  {base_path} ({os.path.getsize(base_path)} bytes)')
    print(f'poses: {poses_path} ({os.path.getsize(poses_path)} bytes)')

    print('\nClips:')
    report_clips(poses_doc)

    print('\nSockets:')
    report_sockets(poses_doc, parent_of)

    print(f'\nRest check (poses vs base, tol={TOLERANCE}):')
    common, mismatches = rest_check(base_doc, poses_doc)
    print(f'  {len(common)} shared node names checked')
    if mismatches:
        print(f'  FAIL: {len(mismatches)} mismatch(es):')
        for name, diff in mismatches:
            print(f'    {name}: max abs diff {diff:.6f}')
        sys.exit(1)
    print('  OK: all shared nodes match within tolerance')


if __name__ == '__main__':
    main()
