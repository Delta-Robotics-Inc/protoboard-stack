# Copied from the Protoboard parts library workspace (library/cad/py/common.py, commit 9a80317);
# ROOT, PARAMS and part_dir changed for the project layout (parts/local/<id>/).
"""Shared helpers for the build123d generators (PB-775).

Every generator produces, per module:
  <name>.step / <name>.glb        the body, with each interface feature as a
                                   named sub-shape (direction D1 "feature")
  <name>.coarse.glb                the body tessellated coarser (0.1 mm / 0.5 rad),
                                   the coarse tier of the 3D view
  <name>.manifest.json             feature name -> geometric signature, plus
                                   provenance (tool, version, source digest)
  interfaces/<interface>.glb       one artifact per interface (direction D2)
Direction D3 ("procedural") needs no file: the viewer derives geometry from
the interface parameters and the frame stored in UHD.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

import build123d as bd
from build123d import Compound, Face, Shape, export_gltf, export_step

ROOT = Path(__file__).resolve().parents[3]  # the project root (parts/local/_cadkit/common.py)
PARAMS = json.loads((Path(__file__).with_name("params.json")).read_text())


# ---------------------------------------------------------------------------
# glTF export: located shapes, reproducible meshing, the coarse tier
# (PB-1112, PB-1142, PB-1173)
# ---------------------------------------------------------------------------

#: linear (mm, relative to edge size as build123d meshes) and angular (rad) deflection of the body GLB
FINE = (0.05, 0.3)
#: the coarse tier (README §9: 0.1 mm / 0.5 rad), written as <name>.coarse.glb beside <name>.glb; the
#: build's view sidecar uses it as its coarse tier
COARSE = (0.1, 0.5)
#: build123d's own export_gltf defaults, which the interface pads were always exported with
DEFAULT = (0.001, 0.1)


def bake_location(shape: Shape) -> Shape:
    """`shape` with its own top-level Location moved down into its children.

    export_gltf turns OCCT's Z-up into glTF's Y-up by appending a rotation to
    the top-level shape's location, which leaves a non-identity location's
    translation un-rotated: a located part lands offset and turned (PB-1112).
    A child's location is written correctly, so the location goes one level
    down. A shape with an identity location comes back unchanged.
    """
    loc = shape.location
    if loc is None:
        return shape
    p, o = loc.position, loc.orientation
    if max(abs(p.X), abs(p.Y), abs(p.Z), abs(o.X), abs(o.Y), abs(o.Z)) < 1e-12:
        return shape
    kids = list(getattr(shape, "children", ()) or ())
    if isinstance(shape, Compound) and kids:
        return Compound(label=shape.label, children=[k.located(loc * k.location) for k in kids])
    return Compound(label=shape.label, children=[shape])


def _mesh(shape: Shape, linear: float, angular: float) -> None:
    """Tessellate on one thread (build123d meshes in parallel, which a large shape does not repeat byte for byte, PB-1142)."""
    from OCP.BRepMesh import BRepMesh_IncrementalMesh
    from OCP.BRepTools import BRepTools

    BRepTools.Clean_s(shape.wrapped)
    BRepMesh_IncrementalMesh(shape.wrapped, linear, True, angular, False)


def export_glb(shape: Shape, path: Path | str, deflection: tuple[float, float] = FINE, coarse: bool = True) -> None:
    """export_gltf, binary, with the location baked and reproducible meshing; and <stem>.coarse.glb when `coarse`."""
    shape = bake_location(shape)
    _mesh(shape, *deflection)
    export_gltf(shape, str(path), binary=True, linear_deflection=deflection[0], angular_deflection=deflection[1])
    if coarse:
        p = Path(path)
        _mesh(shape, *COARSE)
        export_gltf(shape, str(p.with_name(f"{p.stem}.coarse.glb")), binary=True, linear_deflection=COARSE[0], angular_deflection=COARSE[1])


def part_dir(part_id: str) -> Path:
    return ROOT / "parts/local" / part_id


def system_dir(system_id: str) -> Path:
    return ROOT / "library/systems" / system_id / "artifacts/cad"


def digest(*paths: Path) -> str:
    h = hashlib.sha256()
    for p in paths:
        h.update(Path(p).read_bytes())
    h.update(json.dumps(PARAMS, sort_keys=True).encode())
    return h.hexdigest()


def signature(faces: list[Face]) -> dict:
    """Area, area-weighted centroid and (if all coplanar-parallel) the shared normal."""
    area = sum(f.area for f in faces)
    cx = sum(f.center(bd.CenterOf.MASS).X * f.area for f in faces) / area
    cy = sum(f.center(bd.CenterOf.MASS).Y * f.area for f in faces) / area
    cz = sum(f.center(bd.CenterOf.MASS).Z * f.area for f in faces) / area
    sig = {"area_mm2": round(area, 3), "centroid": [round(cx, 3) + 0.0, round(cy, 3) + 0.0, round(cz, 3) + 0.0], "faces": len(faces)}
    normals = []
    for f in faces:
        if f.geom_type == bd.GeomType.PLANE:
            n = f.normal_at()
            normals.append((round(n.X, 3) + 0.0, round(n.Y, 3) + 0.0, round(n.Z, 3) + 0.0))
    if normals and len(set(normals)) == 1 and len(normals) == len(faces):
        sig["normal"] = list(normals[0])
    return sig


class Artifact:
    """Collects a module's body plus its named interface features, then writes everything."""

    def __init__(self, name: str, out_dir: Path, generator: Path):
        self.name = name
        self.out = out_dir
        self.generator = generator
        self.parts: list[Shape] = []
        self.features: dict[str, list[Face]] = {}
        self.interface_shapes: dict[str, Shape] = {}

    def body(self, shape: Shape, label: str) -> Shape:
        shape.label = label
        self.parts.append(shape)
        return shape

    def feature(self, name: str, faces: list[Face], pad: float = 0.25) -> None:
        """Name an interface feature: its faces, and a thin named pad over them.

        The pad goes into the body compound (D1: a named sub-shape a viewer can
        highlight) and also into interfaces/<name>.glb (D2).
        """
        if not faces:
            raise ValueError(f"{self.name}: feature {name!r} selected no faces")
        self.features[name] = faces
        solids = []
        for f in faces:
            if f.geom_type == bd.GeomType.PLANE:
                solids.append(bd.Solid.extrude(f, f.normal_at() * pad))
            else:
                solids.append(bd.Solid.thicken(f, pad))
        shape = Compound(label=name, children=solids)
        self.interface_shapes[name] = shape

    def write(self) -> None:
        self.out.mkdir(parents=True, exist_ok=True)
        (self.out / "interfaces").mkdir(exist_ok=True)
        features = [Compound(label=n, children=[s]) for n, s in self.interface_shapes.items()]
        whole = Compound(label=self.name, children=[*self.parts, *features])
        export_step(whole, str(self.out / f"{self.name}.step"))
        export_glb(whole, self.out / f"{self.name}.glb")
        for n, s in self.interface_shapes.items():
            export_glb(Compound(label=n, children=[s]), self.out / "interfaces" / f"{n}.glb", DEFAULT, coarse=False)
        manifest = {
            "artifact": self.name,
            "tool": "build123d",
            "toolVersion": bd.__version__,
            "sourceDigest": digest(self.generator, Path(__file__)),
            "units": "mm",
            # PB-797: solid volume of the body (feature pads excluded), so a
            # module's mass can be computed as volume x declared material density
            "volume_mm3": round(sum(p.volume for p in self.parts), 3),
            "bodies": {p.label: round(p.volume, 3) for p in self.parts},
            "features": {n: signature(f) for n, f in self.features.items()},
        }
        (self.out / f"{self.name}.manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
        print(f"  {self.out.relative_to(ROOT)}/{self.name}.{{step,glb,manifest.json}} + {len(self.interface_shapes)} interface artifact(s)")
