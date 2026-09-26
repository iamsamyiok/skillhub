#!/usr/bin/env python3
"""
Build-time transpiler: glTF/GLB  ->  engine asset.js (+ definition.json draft).

Reads a glTF file (or GLB) with its companion .bin and image files, decodes
mesh primitives at build time, and emits a self-contained asset.js whose
createAsset(params) builds the same geometry/materials at runtime with all
binary data and textures embedded as base64. No GLTFLoader, no async asset
fetch at runtime -- the generated module loads synchronously like every other
procedural asset in the engine.

Usage:
  python3 glb-to-asset.py <input.gltf|input.glb> <asset_id> <out_dir>
      [--name "Wooden Pier"] [--normal-flip-y] [--max-tri N]

The output directory receives:
  - asset.js            (createAsset factory, THREE-injected)
  - definition.json     (draft: bbox/footprint/height/max_triangles, editable)

Contract (matches engine/lib/validate-assets.mjs + viewer-template):
  - factory = new Function('THREE', src + ';return createAsset;')(THREE)
  - createAsset(params) returns THREE.Group (or Mesh)
  - Origin contract: bbox.min.y ~= 0, center xz ~= 0 (we bake the offset)
  - Node has THREE but no DOM; texture creation is guarded by typeof Image
"""

import argparse
import base64
import io
import json
import os
import struct
import sys
from math import inf

try:
    from PIL import Image as PILImage
except ImportError:
    PILImage = None


# --- glTF accessor decoding -------------------------------------------------

# componentType -> (struct char, item size in bytes)
COMPONENT = {
    5120: ('b', 1),  # BYTE (signed)
    5121: ('B', 1),  # UNSIGNED_BYTE
    5122: ('h', 2),  # SHORT (signed)
    5123: ('H', 2),  # UNSIGNED_SHORT
    5125: ('I', 4),  # UNSIGNED_INT
    5126: ('f', 4),  # FLOAT
}

# accessor.type -> number of components
TYPE_NCOMP = {
    'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16,
}


def load_buffers(gltf, base_dir, glb_bin=None):
    """Return list of raw byte buffers (bytes each), indexed like gltf.buffers."""
    out = []
    for i, b in enumerate(gltf.get('buffers', [])):
        if b.get('uri', '').startswith('data:'):
            # embedded data URI
            header, _, data = b['uri'].partition(',')
            mime = header.split(';')[0] if ';' in header else header
            if 'base64' in header:
                out.append(base64.b64decode(data))
            else:
                out.append(data.encode('latin-1'))
        elif 'uri' in b:
            out.append(open(os.path.join(base_dir, b['uri']), 'rb').read())
        else:
            # GLB BIN chunk
            out.append(glb_bin or b'')
    return out


def decode_accessor(gltf, buffers, idx):
    """Decode accessor idx into a flat list of floats/ints (Python numbers)."""
    acc = gltf['accessors'][idx]
    bv = gltf['bufferViews'][acc['bufferView']]
    buf = buffers[bv['buffer']]
    ctype = acc['componentType']
    fmt, size = COMPONENT[ctype]
    ncomp = TYPE_NCOMP[acc['type']]
    count = acc['count']
    offset = bv.get('byteOffset', 0) + acc.get('byteOffset', 0)
    stride = bv.get('byteStride', 0) or (ncomp * size)
    vals = []
    for i in range(count):
        pos = offset + i * stride
        item = struct.unpack_from('<' + fmt * ncomp, buf, pos)
        vals.extend(item)
    # apply normalized for integer types if needed (skip -- we use raw)
    return vals


def resolve_image_bytes(gltf, base_dir, buffers, img_idx):
    """Return (bytes, mime) for image img_idx, or (None, None)."""
    img = gltf['images'][img_idx]
    if 'bufferView' in img:
        bv = gltf['bufferViews'][img['bufferView']]
        buf = buffers[bv['buffer']]
        data = buf[bv.get('byteOffset', 0): bv.get('byteOffset', 0) + bv['byteLength']]
        mime = img.get('mimeType', 'image/png')
        return data, mime
    if 'uri' in img:
        u = img['uri']
        if u.startswith('data:'):
            header, _, data = u.partition(',')
            mime = header.split(';')[0].replace('data:', '') if ';' in header else 'image/png'
            if 'base64' in header:
                return base64.b64decode(data), mime
            return data.encode('latin-1'), mime
        path = os.path.join(base_dir, u)
        if os.path.exists(path):
            ext = os.path.splitext(u)[1].lower()
            mime = 'image/jpeg' if ext in ('.jpg', '.jpeg') else 'image/png'
            return open(path, 'rb').read(), mime
    return None, None


def resize_texture(data, mime, max_size, quality):
    """Downscale a JPEG/PNG to <= max_size px and re-encode as JPEG bytes."""
    if PILImage is None or max_size <= 0:
        return data, mime
    try:
        im = PILImage.open(io.BytesIO(data))
        im = im.convert('RGB')
        w, h = im.size
        scale = min(1.0, max_size / max(w, h))
        if scale < 1.0:
            im = im.resize((int(w * scale), int(h * scale)), PILImage.LANCZOS)
        out = io.BytesIO()
        im.save(out, format='JPEG', quality=quality, optimize=True)
        return out.getvalue(), 'image/jpeg'
    except Exception:
        return data, mime


# --- scene traversal ---------------------------------------------------------

def node_local_matrix(gltf, node):
    if 'matrix' in node:
        m = node['matrix']  # 16 floats, column-major
        return m
    t = node.get('translation', [0, 0, 0])
    r = node.get('rotation', [0, 0, 0, 1])  # quaternion xyzw
    s = node.get('scale', [1, 1, 1])
    return ('trs', t, r, s)


def matmul(a, b):
    """Multiply two 4x4 matrices stored as flat 16-lists (column-major)."""
    # treat as row-major for clarity: A[r][c]
    def get(m, r, c):
        return m[c * 4 + r]
    out = [0.0] * 16
    for r in range(4):
        for c in range(4):
            out[c * 4 + r] = sum(get(a, r, k) * get(b, k, c) for k in range(4))
    return out


def trs_to_matrix(t, r, s):
    """Build column-major 4x4 from TRS."""
    x, y, z, w = r
    # rotation matrix from quaternion
    xx, yy, zz = x * x, y * y, z * z
    xy, xz, yz = x * y, x * z, y * z
    wx, wy, wz = w * x, w * y, w * z
    rm = [
        1 - 2 * (yy + zz), 2 * (xy + wz), 2 * (xz - wy), 0,
        2 * (xy - wz), 1 - 2 * (xx + zz), 2 * (yz + wx), 0,
        2 * (xz + wy), 2 * (yz - wx), 1 - 2 * (xx + yy), 0,
        0, 0, 0, 1,
    ]
    sm = [s[0], 0, 0, 0, 0, s[1], 0, 0, 0, 0, s[2], 0, 0, 0, 0, 1]
    tm = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, t[0], t[1], t[2], 1]
    return matmul(tm, matmul(rm, sm))


def collect_world_matrices(gltf):
    """Walk scene nodes, return list of (primitives, world_matrix_16)."""
    scenes = gltf.get('scenes', [])
    if not scenes:
        return []
    roots = scenes[gltf.get('scene', 0)].get('nodes', [])
    nodes = gltf.get('nodes', [])
    result = []

    def walk(nidx, parent_mat):
        node = nodes[nidx]
        local = node_local_matrix(gltf, node)
        if isinstance(local, tuple) and local[0] == 'trs':
            mat = trs_to_matrix(local[1], local[2], local[3])
        else:
            mat = local[:]
        world = matmul(parent_mat, mat)
        if 'mesh' in node:
            mesh = gltf['meshes'][node['mesh']]
            result.append((mesh['primitives'], world))
        for child in node.get('children', []):
            walk(child, world)

    for r in roots:
        walk(r, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
    return result


# --- primitive extraction ----------------------------------------------------

def transform_vertex(m, x, y, z):
    """Apply column-major 4x4 matrix to a point (w=1)."""
    rx = m[0] * x + m[4] * y + m[8] * z + m[12]
    ry = m[1] * x + m[5] * y + m[9] * z + m[13]
    rz = m[2] * x + m[6] * y + m[10] * z + m[14]
    return rx, ry, rz


def transform_normal(m, x, y, z):
    """Apply upper-left 3x3 of column-major matrix to a direction."""
    rx = m[0] * x + m[4] * y + m[8] * z
    ry = m[1] * x + m[5] * y + m[9] * z
    rz = m[2] * x + m[6] * y + m[10] * z
    return rx, ry, rz


def extract_primitives(gltf, buffers, world_mats):
    """Return list of meshes, each with baked-world position/normal/uv/index + material idx."""
    meshes = []
    for primitives, world in world_mats:
        for prim in primitives:
            attrs = prim.get('attributes', {})
            if 'POSITION' not in attrs:
                continue
            pos = decode_accessor(gltf, buffers, attrs['POSITION'])
            norm = decode_accessor(gltf, buffers, attrs['NORMAL']) if 'NORMAL' in attrs else None
            uv = decode_accessor(gltf, buffers, attrs['TEXCOORD_0']) if 'TEXCOORD_0' in attrs else None
            col = decode_accessor(gltf, buffers, attrs['COLOR_0']) if 'COLOR_0' in attrs else None
            ncomp_col = TYPE_NCOMP.get(gltf['accessors'][attrs['COLOR_0']]['type'], 3) if col else 3
            # bake world transform into positions + normals
            vcount = len(pos) // 3
            wpos = []
            wnorm = []
            for i in range(vcount):
                x, y, z = pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]
                rx, ry, rz = transform_vertex(world, x, y, z)
                wpos.extend([rx, ry, rz])
                if norm:
                    nx, ny, nz = norm[i * 3], norm[i * 3 + 1], norm[i * 3 + 2]
                    tx, ty, tz = transform_normal(world, nx, ny, nz)
                    wnorm.extend([tx, ty, tz])
            # indices
            indices = None
            if 'indices' in prim:
                idx = decode_accessor(gltf, buffers, prim['indices'])
                indices = [int(v) for v in idx]
            mat_idx = prim.get('material', 0)
            meshes.append({
                'positions': wpos, 'normals': wnorm, 'uvs': uv,
                'colors': col, 'color_ncomp': ncomp_col,
                'indices': indices, 'material': mat_idx,
            })
    return meshes


def parse_materials(gltf):
    """Return list of {baseColor, metallic, roughness, alpha, doubleSided,
    baseColorImg, normalImg, normalTexIdx} per material."""
    out = []
    for m in gltf.get('materials', []):
        pbr = m.get('pbrMetallicRoughness', {})
        bcf = pbr.get('baseColorFactor', [1, 1, 1, 1])
        bct = pbr.get('baseColorTexture', {}).get('index', None)
        nt = m.get('normalTexture', {}).get('index', None)
        out.append({
            'baseColor': list(bcf),
            'metallic': pbr.get('metallicFactor', 1.0),
            'roughness': pbr.get('roughnessFactor', 1.0),
            'alphaMode': m.get('alphaMode', 'OPAQUE'),
            'doubleSided': m.get('doubleSided', False),
            'baseColorTex': bct,
            'normalTex': nt,
        })
    return out


# --- normalization + stats ---------------------------------------------------

def compute_bbox(meshes):
    mn = [inf, inf, inf]
    mx = [-inf, -inf, -inf]
    tri = 0
    for mesh in meshes:
        p = mesh['positions']
        for i in range(0, len(p), 3):
            x, y, z = p[i], p[i + 1], p[i + 2]
            if x < mn[0]: mn[0] = x
            if y < mn[1]: mn[1] = y
            if z < mn[2]: mn[2] = z
            if x > mx[0]: mx[0] = x
            if y > mx[1]: mx[1] = y
            if z > mx[2]: mx[2] = z
        if mesh['indices'] is not None:
            tri += len(mesh['indices']) // 3
        else:
            tri += len(p) // 3 // 3
    return mn, mx, tri


def normalize_meshes(meshes, offx, offy, offz):
    for mesh in meshes:
        p = mesh['positions']
        for i in range(0, len(p), 3):
            p[i] += offx
            p[i + 1] += offy
            p[i + 2] += offz


# --- emission ----------------------------------------------------------------

def b64_f32(vals):
    buf = struct.pack('<%df' % len(vals), *vals)
    return base64.b64encode(buf).decode('ascii')


def b64_u32(vals):
    buf = struct.pack('<%dI' % len(vals), *vals)
    return base64.b64encode(buf).decode('ascii')


def emit_asset_js(asset_id, name, meshes, materials, textures, normal_flip_y):
    """Generate the asset.js source."""
    lines = []
    lines.append('// Auto-generated by engine/tools/glb-to-asset.py')
    lines.append('// Source: %s' % name)
    lines.append('// asset_id: %s' % asset_id)
    lines.append('// Do not edit by hand; re-run the transpiler to regenerate.')
    lines.append('')
    lines.append('function createAsset(params) {')
    lines.append('  const THREE_ = THREE;')
    lines.append('  const root = new THREE_.Group();')
    lines.append('')
    # helpers
    lines.append('  function b64arr(b64, Ctor) {')
    lines.append('    let bin;')
    lines.append('    if (typeof Buffer !== "undefined") bin = Buffer.from(b64, "base64");')
    lines.append('    else { const s = atob(b64); bin = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) bin[i] = s.charCodeAt(i); }')
    lines.append('    return new Ctor(bin.buffer, bin.byteOffset, Math.floor(bin.byteLength / Ctor.BYTES_PER_ELEMENT));')
    lines.append('  }')
    lines.append('  function tex(dataUri, srgb) {')
    lines.append('    if (typeof Image === "undefined") return null;')
    lines.append('    const t = new THREE_.Texture();')
    lines.append('    const im = new Image();')
    lines.append('    im.onload = function () { t.image = im; t.needsUpdate = true; if (srgb) t.colorSpace = THREE_.SRGBColorSpace; };')
    lines.append('    im.src = dataUri; return t;')
    lines.append('  }')
    lines.append('')

    # textures
    for i, (data_uri, srgb, is_normal) in enumerate(textures):
        lines.append('  const T%d = tex("%s", %s);' % (i, data_uri, 'true' if srgb else 'false'))
        if is_normal and normal_flip_y:
            lines.append('  if (T%d) T%d.unpackAI8888ColorScale = 1;' % (i, i))
    lines.append('')

    # materials
    mat_var = []
    for i, m in enumerate(materials):
        r, g, b, a = m['baseColor']
        col = '0x%02x%02x%02x' % (int(r * 255), int(g * 255), int(b * 255))
        opts = ['color: %s' % col,
                'metalness: %s' % (m['metallic'] if m['metallic'] is not None else 0),
                'roughness: %s' % (m['roughness'] if m['roughness'] is not None else 1)]
        if m['baseColorTex'] is not None and m['baseColorTex'] < len(textures):
            opts.append('map: T%d' % m['baseColorTex'])
        if m['normalTex'] is not None and m['normalTex'] < len(textures):
            opts.append('normalMap: T%d' % m['normalTex'])
            if normal_flip_y:
                opts.append('normalScale: new THREE_.Vector2(1, -1)')
        if m['alphaMode'] == 'BLEND':
            opts.append('transparent: true')
            opts.append('opacity: %s' % a)
        if m['doubleSided']:
            opts.append('side: THREE_.DoubleSide')
        lines.append('  const M%d = new THREE_.MeshStandardMaterial({ %s });' % (i, ', '.join(opts)))
        mat_var.append('M%d' % i)
    lines.append('')

    # meshes
    for i, mesh in enumerate(meshes):
        lines.append('  // mesh %d: material %d, %d verts' % (i, mesh['material'], len(mesh['positions']) // 3))
        lines.append('  const g%d = new THREE_.BufferGeometry();' % i)
        lines.append('  g%d.setAttribute("position", new THREE_.BufferAttribute(b64arr("%s", Float32Array), 3));' % (i, b64_f32(mesh['positions'])))
        if mesh['normals']:
            lines.append('  g%d.setAttribute("normal", new THREE_.BufferAttribute(b64arr("%s", Float32Array), 3));' % (i, b64_f32(mesh['normals'])))
        else:
            lines.append('  g%d.computeVertexNormals();' % i)
        if mesh['uvs']:
            lines.append('  g%d.setAttribute("uv", new THREE_.BufferAttribute(b64arr("%s", Float32Array), 2));' % (i, b64_f32(mesh['uvs'])))
        if mesh['colors']:
            nc = mesh['color_ncomp']
            lines.append('  g%d.setAttribute("color", new THREE_.BufferAttribute(b64arr("%s", Float32Array), %d));' % (i, b64_f32(mesh['colors']), nc))
        if mesh['indices'] is not None:
            lines.append('  g%d.setIndex(new THREE_.BufferAttribute(b64arr("%s", Uint32Array), 1));' % (i, b64_u32(mesh['indices'])))
        lines.append('  const me%d = new THREE_.Mesh(g%d, %s);' % (i, i, mat_var[mesh['material']] if mesh['material'] < len(mat_var) else mat_var[0]))
        lines.append('  root.add(me%d);' % i)
        lines.append('')

    lines.append('  return root;')
    lines.append('}')
    return '\n'.join(lines) + '\n'


# --- main --------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('input')
    ap.add_argument('asset_id')
    ap.add_argument('out_dir')
    ap.add_argument('--name', default='')
    ap.add_argument('--normal-flip-y', action='store_true')
    ap.add_argument('--max-tri', type=int, default=0)
    ap.add_argument('--max-tex-size', type=int, default=512)
    ap.add_argument('--tex-quality', type=int, default=72)
    args = ap.parse_args()

    glb_bin = None
    if args.input.lower().endswith('.glb'):
        raw = open(args.input, 'rb').read()
        # GLB: 12-byte header (magic, version, length) then chunks
        magic, version, length = struct.unpack_from('<III', raw, 0)
        if magic != 0x46546C67:
            print('not a GLB file', file=sys.stderr); sys.exit(1)
        json_chunk_len, json_chunk_type = struct.unpack_from('<II', raw, 12)
        gltf = json.loads(raw[20:20 + json_chunk_len])
        base_dir = os.path.dirname(args.input)
        bin_chunk_len, bin_chunk_type = struct.unpack_from('<II', raw, 20 + json_chunk_len)
        glb_bin = raw[28 + json_chunk_len: 28 + json_chunk_len + bin_chunk_len]
    else:
        gltf = json.load(open(args.input))
        base_dir = os.path.dirname(args.input)

    buffers = load_buffers(gltf, base_dir, glb_bin)
    world_mats = collect_world_matrices(gltf)
    meshes = extract_primitives(gltf, buffers, world_mats)
    materials = parse_materials(gltf)

    # collect textures (dedup by image index)
    textures = []  # (data_uri, srgb, is_normal)
    img_idx_to_tex = {}
    for m in materials:
        for role, srgb, is_normal in (('baseColorTex', True, False), ('normalTex', False, True)):
            ii = m[role]
            if ii is None:
                continue
            if ii in img_idx_to_tex:
                m[role] = img_idx_to_tex[ii]
                continue
            data, mime = resolve_image_bytes(gltf, base_dir, buffers, ii)
            if data is None:
                m[role] = None
                continue
            data, mime = resize_texture(data, mime, args.max_tex_size, args.tex_quality)
            uri = 'data:%s;base64,%s' % (mime, base64.b64encode(data).decode('ascii'))
            img_idx_to_tex[ii] = len(textures)
            textures.append((uri, srgb, is_normal))
            m[role] = len(textures) - 1

    # normalize origin: min.y=0, center xz=0
    mn, mx, tri = compute_bbox(meshes)
    cx = (mn[0] + mx[0]) / 2
    cz = (mn[2] + mx[2]) / 2
    normalize_meshes(meshes, -cx, -mn[1], -cz)
    mn = [mn[0] - cx, 0, mn[2] - cz]
    mx = [mx[0] - cx, mx[1] - mn[1] if False else mx[1] - mn[1], mx[2] - cz]
    # recompute bbox after offset
    mn2, mx2, _ = compute_bbox(meshes)

    os.makedirs(args.out_dir, exist_ok=True)
    js = emit_asset_js(args.asset_id, args.name or args.input, meshes, materials, textures, args.normal_flip_y)
    open(os.path.join(args.out_dir, 'asset.js'), 'w').write(js)

    footprint_x = (mx2[0] - mn2[0]) / 2
    footprint_z = (mx2[2] - mn2[2]) / 2
    height = mx2[1] - mn2[1]
    max_tri = args.max_tri or max(int(tri * 1.5), tri + 100)

    def_draft = {
        'asset_id': args.asset_id,
        'name': args.name or args.asset_id,
        'source': os.path.basename(args.input),
        'license': 'CC0 (Poly Haven)',
        'footprint': {'half_width': round(footprint_x, 3), 'half_depth': round(footprint_z, 3)},
        'height': round(height, 3),
        'max_triangles': max_tri,
        'params_schema': {},
    }
    open(os.path.join(args.out_dir, 'definition.json'), 'w').write(json.dumps(def_draft, indent=2) + '\n')

    print('wrote %s/asset.js + definition.json' % args.out_dir)
    print('  meshes: %d  materials: %d  textures: %d' % (len(meshes), len(materials), len(textures)))
    print('  triangles: %d  (budget %d)' % (tri, max_tri))
    print('  bbox: %.2f x %.2f x %.2f' % (mx2[0] - mn2[0], mx2[1] - mn2[1], mx2[2] - mn2[2]))


if __name__ == '__main__':
    main()
