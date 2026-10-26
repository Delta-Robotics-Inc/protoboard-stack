"""Minimal binary glTF (GLB) reader and writer for the harness router.

Reading: every triangle primitive of every mesh node, with node transforms
applied, in glTF coordinates (metres, Y up). Only what the build123d
exports and vendor conversions in this repo contain is supported: float32
positions, uint16/uint32 indices, TRS or matrix node transforms.

Writing: named meshes with PBR materials (base colour, metallic, roughness),
one node per mesh under named group nodes.
"""
from __future__ import annotations

import json
import struct
from pathlib import Path

import numpy as np

_COMPONENT = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
_COUNT = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}


def _quat_matrix(q):
    x, y, z, w = q
    return np.array(
        [
            [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
            [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
            [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
        ]
    )


def _node_matrix(node) -> np.ndarray:
    if "matrix" in node:
        return np.array(node["matrix"], dtype=float).reshape(4, 4).T  # column-major
    m = np.eye(4)
    s = np.array(node.get("scale", [1, 1, 1]), dtype=float)
    r = _quat_matrix(node.get("rotation", [0, 0, 0, 1]))
    m[:3, :3] = r * s
    m[:3, 3] = node.get("translation", [0, 0, 0])
    return m


def read_glb(path: str | Path) -> list[tuple[str, np.ndarray, np.ndarray]]:
    """(node name, vertices (N,3) in glTF world, triangles (M,3)) per primitive; an unnamed node is named after its nearest named ancestor."""
    data = Path(path).read_bytes()
    magic, _version, _length = struct.unpack_from("<III", data, 0)
    if magic != 0x46546C67:
        raise ValueError(f"{path}: not a GLB")
    off = 12
    doc, binary = None, b""
    while off < len(data):
        clen, ctype = struct.unpack_from("<II", data, off)
        chunk = data[off + 8 : off + 8 + clen]
        if ctype == 0x4E4F534A:
            doc = json.loads(chunk)
        elif ctype == 0x004E4942:
            binary = chunk
        off += 8 + clen
    assert doc is not None

    def accessor(i):
        a = doc["accessors"][i]
        bv = doc["bufferViews"][a["bufferView"]]
        dtype = _COMPONENT[a["componentType"]]
        n = _COUNT[a["type"]]
        start = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
        stride = bv.get("byteStride", 0)
        item = np.dtype(dtype).itemsize * n
        if stride and stride != item:
            raw = np.frombuffer(binary, dtype=np.uint8, count=stride * a["count"], offset=start).reshape(a["count"], stride)[:, :item]
            return np.frombuffer(raw.tobytes(), dtype=dtype).reshape(a["count"], n)
        return np.frombuffer(binary, dtype=dtype, count=a["count"] * n, offset=start).reshape(a["count"], n)

    out = []

    def visit(i, parent, inherited=""):
        node = doc["nodes"][i]
        m = parent @ _node_matrix(node)
        # an unnamed node takes its nearest named ancestor's name (a UHD body's interface feature
        # marker is an unnamed mesh under a node named after the interface)
        name = node.get("name") or inherited
        if "mesh" in node:
            for prim in doc["meshes"][node["mesh"]]["primitives"]:
                if prim.get("mode", 4) != 4:
                    continue
                v = accessor(prim["attributes"]["POSITION"]).astype(float)
                f = accessor(prim["indices"]).reshape(-1, 3).astype(np.int64) if "indices" in prim else np.arange(len(v)).reshape(-1, 3)
                v = v @ m[:3, :3].T + m[:3, 3]
                out.append((name, v, f))
        for c in node.get("children", []):
            visit(c, m, name)

    scene = doc["scenes"][doc.get("scene", 0)]
    for n in scene["nodes"]:
        visit(n, np.eye(4))
    return out


def to_cad_mm(v_gltf: np.ndarray) -> np.ndarray:
    """glTF (m, Y up) -> CAD (mm, Z up): the viewer's cadWrapper (rotate +90 deg about X, x1000)."""
    return np.stack([v_gltf[:, 0], -v_gltf[:, 2], v_gltf[:, 1]], axis=1) * 1000.0


def to_gltf_m(v_mm: np.ndarray) -> np.ndarray:
    return np.stack([v_mm[:, 0], v_mm[:, 2], -v_mm[:, 1]], axis=1) / 1000.0


def _hex_rgba(c: str) -> list[float]:
    c = c.lstrip("#")
    r, g, b = (int(c[i : i + 2], 16) / 255.0 for i in (0, 2, 4))
    # sRGB -> linear for glTF baseColorFactor
    lin = lambda x: x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4
    return [round(lin(r), 5), round(lin(g), 5), round(lin(b), 5), 1.0]


def write_glb(path: str | Path, groups: dict[str, list[dict]]) -> None:
    """groups: {group name: [{name, vertices (mm, CAD), faces, color, metallic, roughness}]}."""
    doc = {"asset": {"version": "2.0", "generator": "protoboard ext-harness-cad"}, "scene": 0, "scenes": [{"nodes": []}], "nodes": [], "meshes": [], "materials": [], "accessors": [], "bufferViews": [], "buffers": []}
    blob = bytearray()
    materials: dict[tuple, int] = {}

    def view(arr: np.ndarray, target: int) -> int:
        while len(blob) % 4:
            blob.append(0)
        off = len(blob)
        blob.extend(arr.tobytes())
        doc["bufferViews"].append({"buffer": 0, "byteOffset": off, "byteLength": arr.nbytes, "target": target})
        return len(doc["bufferViews"]) - 1

    for gname, meshes in groups.items():
        children = []
        for m in meshes:
            v = to_gltf_m(np.asarray(m["vertices"], dtype=float)).astype(np.float32)
            f = np.asarray(m["faces"], dtype=np.uint32).reshape(-1)
            # flat-ish normals per vertex (area weighted)
            tri = v[f.reshape(-1, 3)]
            fn = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
            vn = np.zeros_like(v)
            for k in range(3):
                np.add.at(vn, f.reshape(-1, 3)[:, k], fn)
            vn /= np.maximum(np.linalg.norm(vn, axis=1, keepdims=True), 1e-12)
            key = (m["color"], m.get("metallic", 0.0), m.get("roughness", 0.6))
            if key not in materials:
                doc["materials"].append({"name": m.get("material", m["color"]), "pbrMetallicRoughness": {"baseColorFactor": _hex_rgba(m["color"]), "metallicFactor": key[1], "roughnessFactor": key[2]}})
                materials[key] = len(doc["materials"]) - 1
            pv = view(v, 34962)
            doc["accessors"].append({"bufferView": pv, "componentType": 5126, "count": len(v), "type": "VEC3", "min": v.min(axis=0).tolist(), "max": v.max(axis=0).tolist()})
            pa = len(doc["accessors"]) - 1
            nv = view(vn.astype(np.float32), 34962)
            doc["accessors"].append({"bufferView": nv, "componentType": 5126, "count": len(vn), "type": "VEC3"})
            na = len(doc["accessors"]) - 1
            iv = view(f, 34963)
            doc["accessors"].append({"bufferView": iv, "componentType": 5125, "count": len(f), "type": "SCALAR"})
            ia = len(doc["accessors"]) - 1
            doc["meshes"].append({"name": m["name"], "primitives": [{"attributes": {"POSITION": pa, "NORMAL": na}, "indices": ia, "material": materials[key]}]})
            doc["nodes"].append({"name": m["name"], "mesh": len(doc["meshes"]) - 1})
            children.append(len(doc["nodes"]) - 1)
        doc["nodes"].append({"name": gname, "children": children})
        doc["scenes"][0]["nodes"].append(len(doc["nodes"]) - 1)
    while len(blob) % 4:
        blob.append(0)
    doc["buffers"].append({"byteLength": len(blob)})
    js = json.dumps(doc, separators=(",", ":")).encode()
    while len(js) % 4:
        js += b" "
    out = struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(blob))
    out += struct.pack("<II", len(js), 0x4E4F534A) + js
    out += struct.pack("<II", len(blob), 0x004E4942) + bytes(blob)
    Path(path).write_bytes(out)
