"""Import an existing CAD file as a module's body (PB-1143, PB-1174).

Run by @protoboardai/ext-parts for a module whose cad.config.ts has
`constraints.import` (written by `protoboard parts import`), in place of a
hand-written part-cad script:

    python import_cad.py <out_dir> --source <file> --format step|stl|3mf [--sha256 <hex>]

Writes the cad capability's standard outputs into <out_dir>: body.step,
body.glb and body.manifest.json. The body keeps the source file's own frame:
nothing is re-centred, rotated or scaled. A mesh source (STL, 3MF) keeps its
own triangles; its STEP is AP242 tessellated geometry.

Also: `python import_cad.py --convert <step> <out.glb>` writes a viewer mesh of
a STEP (a fetched vendor model), nothing else.

Deterministic: a fixed STEP timestamp and fixed tessellation, so the same
source gives the same files. Units: STEP and the manifest in mm, Z up; the
GLB in glTF metres, Y up (build123d's export_gltf converts at the boundary).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import struct
import sys
from pathlib import Path

STEP_TIMESTAMP = "2026-01-01T00:00:00"
LINEAR_DEFLECTION_MM = 0.05
ANGULAR_DEFLECTION_RAD = 0.3
AP214_SCHEMA = b"FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));"
AP242_SCHEMA = b"FILE_SCHEMA(('AP242_MANAGED_MODEL_BASED_3D_ENGINEERING_MIM_LF { 1 0 10303 442 1 1 4 }'));"


def file_sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def binary_stl_volume_mm3(path: Path) -> float | None:
    """Enclosed volume of a binary STL by signed tetrahedra (exact for a closed mesh); None for ASCII STL."""
    data = path.read_bytes()
    if len(data) < 84:
        return None
    (count,) = struct.unpack_from("<I", data, 80)
    if 84 + 50 * count != len(data):
        return None
    total = 0.0
    for i in range(count):
        ax, ay, az, bx, by, bz, cx, cy, cz = struct.unpack_from("<9f", data, 84 + 50 * i + 12)
        total += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)
    return abs(total) / 6.0


def r(x: float) -> float:
    return round(float(x), 4)


def load(src: Path, fmt: str):
    """The source as a build123d shape, and whether it is a mesh."""
    if fmt == "step":
        from build123d import import_step

        return import_step(src), False
    if fmt == "stl":
        from build123d import import_stl

        return import_stl(src), True
    if fmt == "3mf":
        from build123d import Compound, Mesher

        shapes = Mesher().read(str(src))
        return (shapes[0] if len(shapes) == 1 else Compound(children=list(shapes))), True
    raise SystemExit(f"unknown format {fmt}")


def write_step(shape, path: Path, mesh: bool) -> None:
    from build123d import export_step

    if mesh:
        from OCP.Interface import Interface_Static
        from OCP.STEPCAFControl import STEPCAFControl_Controller
        from OCP.STEPControl import STEPControl_Controller

        STEPCAFControl_Controller.Init_s()
        STEPControl_Controller.Init_s()
        Interface_Static.SetIVal_s("write.step.schema", 5)  # AP242: the schema with tessellated geometry
        Interface_Static.SetIVal_s("write.step.tessellated", 1)
    export_step(shape, path, timestamp=STEP_TIMESTAMP)
    if mesh:  # OCCT writes the AP242 entities under an AP214 header; name the schema the file uses
        data = path.read_bytes()
        path.write_bytes(data.replace(AP214_SCHEMA, AP242_SCHEMA, 1))


def write_glb(shape, path: Path) -> None:
    from build123d import Unit, export_gltf

    export_gltf(shape, path, unit=Unit.MM, binary=True, linear_deflection=LINEAR_DEFLECTION_MM, angular_deflection=ANGULAR_DEFLECTION_RAD)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("out_dir", nargs="?")
    ap.add_argument("--source")
    ap.add_argument("--format", choices=["step", "stl", "3mf"])
    ap.add_argument("--sha256")
    ap.add_argument("--module", default="body")
    ap.add_argument("--convert", nargs=2, metavar=("STEP", "GLB"))
    a = ap.parse_args()

    import build123d

    if a.convert:
        shape, _ = load(Path(a.convert[0]), "step")
        write_glb(shape, Path(a.convert[1]))
        return 0
    if not a.out_dir or not a.source or not a.format:
        ap.error("out_dir, --source and --format are required")
    src = Path(a.source)
    if not src.is_file():
        print(f"{a.module}: source {src} not found", file=sys.stderr)
        return 2
    digest = file_sha256(src)
    if a.sha256 and digest != a.sha256.removeprefix("sha256:"):
        print(f"{a.module}: {src.name} changed (sha256 {digest}, recorded {a.sha256}); check the new file, then `protoboard parts import` it again", file=sys.stderr)
        return 2
    out = Path(a.out_dir)
    out.mkdir(parents=True, exist_ok=True)
    shape, mesh = load(src, a.format)
    if mesh:
        volume = binary_stl_volume_mm3(src) if a.format == "stl" else None
        solids = 0
    else:
        volume, solids = shape.volume, len(shape.solids())
    bb = shape.bounding_box()
    write_step(shape, out / "body.step", mesh)
    # the GLB last: export_gltf cleans the shape's triangulation when it is done
    write_glb(shape, out / "body.glb")
    manifest = {
        "artifact": "body",
        "tool": "build123d",
        "toolVersion": build123d.__version__,
        "units": "mm",
        "volume_mm3": r(volume) if volume is not None else 0,
        "bodies": {a.module: r(volume) if volume is not None else 0},
        "solids": solids,
        "features": {},
        "source": {"file": src.name, "sha256": digest, "format": a.format, "provenance": "imported"},
        "frame": "the source file's own coordinate frame, unchanged (no re-centring, rotation or scaling)",
        "bbox_mm": {"min": [r(bb.min.X), r(bb.min.Y), r(bb.min.Z)], "max": [r(bb.max.X), r(bb.max.Y), r(bb.max.Z)], "size": [r(bb.size.X), r(bb.size.Y), r(bb.size.Z)]},
    }
    (out / "body.manifest.json").write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
