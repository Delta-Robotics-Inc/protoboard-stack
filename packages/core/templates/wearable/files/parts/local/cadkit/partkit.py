"""Representative part geometry for this project's researched parts (parts/local).

A project has no shared part-CAD kit (ext-parts skill uhd-part-author, "In a
project"), so this is a self-contained copy of the helpers the part library's
generators use (library/cad/py/common.py, partkit.py and the axis helpers of
vendor_step.py in the parts workspace, commit 9a80317), with one change: the
files go next to the part's own script, in parts/local/<id>/, the project's
layout for part artifacts.

Each part script (parts/local/<id>/<id>.py) models the part from cited
datasheet dimensions and writes, through `GeneratedPart`:

  parts/local/<id>/<name>.step / <name>.glb   the body, each interface feature a named sub-shape
  parts/local/<id>/<name>.manifest.json       feature name -> signature (area, centroid, normal),
                                              hole/shaft axes, volume, tool and source digest
  parts/local/<id>/interfaces/<feature>.glb   one artifact per interface

Run one with the project's CAD Python:

  "${PROTOBOARD_PYTHON:-.protoboard/tools/cad/bin/python}" parts/local/<id>/<id>.py
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

import build123d as bd
from build123d import Align, Box, BuildPart, Compound, Cylinder, Face, Locations, Mode, Pos, Shape, export_gltf, export_step

PROJECT = Path(__file__).resolve().parents[3]  # the project root (parts/local/cadkit/partkit.py)
MIN = (Align.CENTER, Align.CENTER, Align.MIN)


def part_dir(part_id: str) -> Path:
    return PROJECT / "parts/local" / part_id


def digest(*paths: Path) -> str:
    h = hashlib.sha256()
    for p in paths:
        h.update(Path(p).read_bytes())
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


def radius_of(f: Face) -> float | None:
    """Cylinder radius, or None when build123d can't give one (some trimmed/boolean-cut faces)."""
    try:
        r = f.radius
    except Exception:
        return None
    return r if r else None


def hole_axes(faces: list[Face], axis=(0, 0, 1)) -> dict:
    """Distinct axis positions of cylindrical faces, projected on the plane normal to `axis`.

    Returns {"centres": [[x, y, z], ...], "diameter_mm": d}. z is the mean
    position along the axis of the faces sharing that centre.
    """
    groups: dict[tuple[float, float, float], list[tuple[bd.Vector, float]]] = {}
    n = bd.Vector(*axis).normalized()
    for f in faces:
        if f.geom_type != bd.GeomType.CYLINDER:
            continue
        p = f.axis_of_rotation.position
        c = f.center(bd.CenterOf.MASS)
        along = c.dot(n)
        q = p - n * p.dot(n)
        key = (round(q.X, 1), round(q.Y, 1), round(q.Z, 1))
        groups.setdefault(key, []).append((q, along))
    centres = []
    for items in groups.values():
        q = items[0][0]
        along = sum(a for _, a in items) / len(items)
        pt = q + n * along
        centres.append([round(pt.X, 3) + 0.0, round(pt.Y, 3) + 0.0, round(pt.Z, 3) + 0.0])
    centres.sort()
    radii = [r for f in faces if f.geom_type == bd.GeomType.CYLINDER and (r := radius_of(f))]
    return {"centres": centres, "diameter_mm": round(2 * sum(radii) / len(radii), 3) if radii else None}


class GeneratedPart:
    """A part's body plus its named interface features; `write()` writes the common layout."""

    def __init__(self, part_id: str, name: str, generator: str | Path):
        self.name = name
        self.out = part_dir(part_id)
        self.generator = Path(generator)
        self.parts: list[Shape] = []
        self.features: dict[str, list[Face]] = {}
        self.interface_shapes: dict[str, Shape] = {}
        self.axes: dict[str, dict] = {}

    def body(self, shape: Shape, label: str) -> Shape:
        shape.label = label
        self.parts.append(shape)
        return shape

    def feature(self, name: str, faces: list[Face], pad: float = 0.25, axis=None) -> None:
        """Name an interface feature: its faces, and a thin named pad over them."""
        if not faces:
            raise ValueError(f"{self.name}: feature {name!r} selected no faces")
        self.features[name] = faces
        solids = []
        for f in faces:
            if f.geom_type == bd.GeomType.PLANE:
                solids.append(bd.Solid.extrude(f, f.normal_at() * pad))
            else:
                solids.append(bd.Solid.thicken(f, pad))
        self.interface_shapes[name] = Compound(label=name, children=solids)
        if axis is not None:
            self.axes[name] = hole_axes(faces, axis)

    def write(self) -> None:
        self.out.mkdir(parents=True, exist_ok=True)
        (self.out / "interfaces").mkdir(exist_ok=True)
        features = [Compound(label=n, children=[s]) for n, s in self.interface_shapes.items()]
        whole = Compound(label=self.name, children=[*self.parts, *features])
        export_step(whole, str(self.out / f"{self.name}.step"))
        export_gltf(whole, str(self.out / f"{self.name}.glb"), binary=True, linear_deflection=0.05, angular_deflection=0.3)
        for n, s in self.interface_shapes.items():
            export_gltf(Compound(label=n, children=[s]), str(self.out / "interfaces" / f"{n}.glb"), binary=True)
        manifest = {
            "artifact": self.name,
            "tool": "build123d (representative geometry from datasheet dimensions, parts/local/cadkit/partkit.py)",
            "toolVersion": bd.__version__,
            "sourceDigest": digest(self.generator, Path(__file__)),
            "units": "mm",
            "volume_mm3": round(sum(p.volume for p in self.parts), 3),
            "bodies": {p.label: round(p.volume, 3) for p in self.parts},
            "features": {n: signature(f) for n, f in self.features.items()},
        }
        for n, extra in self.axes.items():
            manifest["features"][n].update(extra)
        (self.out / f"{self.name}.manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
        print(f"  {self.out.relative_to(PROJECT)}/{self.name}.{{step,glb,manifest.json}} + {len(self.interface_shapes)} interface artifact(s)")


# ---------------------------------------------------------------------------
# Shape helpers
# ---------------------------------------------------------------------------


def cylinders(shape: Shape, diameter: float, tol: float = 0.05) -> list[Face]:
    """Cylindrical faces of `shape` with the given diameter (holes or shafts)."""
    return [f for f in shape.faces() if f.geom_type == bd.GeomType.CYLINDER and (r := radius_of(f)) is not None and abs(2 * r - diameter) <= tol]


def extreme_face(shape: Shape, normal=(0, 0, 1)) -> list[Face]:
    """The planar face(s) of `shape` furthest along `normal` (e.g. a board's top)."""
    n = bd.Vector(*normal).normalized()
    fs = [f for f in shape.faces() if f.geom_type == bd.GeomType.PLANE and f.normal_at().dot(n) > 0.99]
    best = max(f.center(bd.CenterOf.MASS).dot(n) for f in fs)
    return [f for f in fs if abs(f.center(bd.CenterOf.MASS).dot(n) - best) < 0.05]


def block(x: float, y: float, z0: float, lx: float, ly: float, lz: float):
    """An axis-aligned box whose bottom face is centred at (x, y, z0)."""
    with BuildPart() as b:
        with Locations(Pos(x, y, z0)):
            Box(lx, ly, lz, align=MIN)
    return b.part
