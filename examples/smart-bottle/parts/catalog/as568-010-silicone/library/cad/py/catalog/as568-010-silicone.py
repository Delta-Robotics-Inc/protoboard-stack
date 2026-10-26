"""AS568-010 O-ring (ID 6.07 x CS 1.78 mm), silicone 70A: representative geometry.

An O-ring is a standard size, not a vendor design: no supplier publishes a
CAD model for this ring (sources.json; .research/gaps.json), so the body is
generated from the AS568 size table as Parker (src_parker, ORD 5700A
Sizes, 2-010) and Apple Rubber (src_apple) print it:

  ID 6.07 +-0.13, CS 1.78 +-0.08 (mm); OD 9.63 (reference, ID + 2 CS).

Modelled at nominal size, free state (not installed): a torus with its axis
on Z, centred on the origin, mid-plane at z = 0. Tube (minor) radius
CS / 2 = 0.89, centre-line radius (ID + CS) / 2 = 3.925. Parker gives a
basic volume of .0037 cu in (60.6 mm^3) for the -010; the torus is
2 pi^2 R r^2 = 61.4 mm^3.

The cross-section circle is drawn as four quarter arcs split at 45 deg, so
the revolved torus has four faces, one per contact zone:
  - bore:   the inner quarter (radius 3.035 at the mid-plane), which seals
            on the rod (the smart-bottle probe's Ø6.0 tube);
  - outer:  the outer quarter (radius 4.815), which sits on the bottom of a
            female (bore) gland;
  - flank_a (+Z) and flank_b (-Z): the axial quarters, which touch the gland
            side walls in a radial seal, or the two faces in a face seal.
The 45 deg split is a modelling choice, not a sealing fact (assumption trait
"generated body" on the part).
"""
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import build123d as bd  # noqa: E402

from partkit import GeneratedPart  # noqa: E402


class TorusPart(GeneratedPart):
    """GeneratedPart that re-exports the interface GLBs at the body's mesh tolerance.

    common.Artifact writes interfaces/<feature>.glb at the exporter's default
    tolerance, which meshes a thickened torus face at about 390 KB; the body's
    own tolerance (0.05 mm, 0.3 rad) is ample for a highlight.
    """

    def write(self) -> None:
        super().write()
        for n, s in self.interface_shapes.items():
            path = self.out / "interfaces" / f"{n}.glb"
            bd.export_gltf(bd.Compound(label=n, children=[s]), str(path), binary=True, linear_deflection=0.05, angular_deflection=0.3)

PART_ID = "as568-010-silicone"

ID = 6.07  # AS568 -010 inside diameter (Parker 2-010, Apple Rubber)
CS = 1.78  # AS568 -010 cross-section
R = (ID + CS) / 2  # 3.925, centre-line radius
r = CS / 2  # 0.89


def section_point(deg: float) -> tuple[float, float, float]:
    """A point on the cross-section circle in the XZ plane; 0 deg points radially out (+X)."""
    t = math.radians(deg)
    return (R + r * math.cos(t), 0.0, r * math.sin(t))


def body():
    """Revolve the four-arc cross-section about Z, giving one torus with four faces."""
    arcs = [
        bd.ThreePointArc(section_point(a0), section_point(a0 + 45), section_point(a0 + 90))
        for a0 in (-45, 45, 135, 225)
    ]
    section = bd.Face(bd.Wire(arcs))
    # Solid.revolve keeps the four edges as four faces (bd.revolve would clean them into one)
    return bd.Solid.revolve(section, 360, bd.Axis.Z)


def faces_at(shape, radial: float, z: float) -> list:
    """The torus face whose centre of the quarter arc lies at (radial, z) in the XZ section."""
    out = []
    for f in shape.faces():
        # sample the face at its parametric centre; a quarter of a torus revolved 360 deg
        p = f.position_at(0.5, 0.5)
        rad = math.hypot(p.X, p.Y)
        if abs(rad - radial) < 0.05 and abs(p.Z - z) < 0.05:
            out.append(f)
    return out


def build() -> None:
    a = TorusPart(PART_ID, "as568-010-silicone", __file__)
    shape = a.body(body(), "o_ring")
    assert len(shape.faces()) == 4, f"expected 4 torus faces, got {len(shape.faces())}"
    # bore: inner quarter, the rod-sealing surface (ring axis Z)
    a.feature("bore", faces_at(shape, R - r, 0.0))
    # outer: outer quarter, seats on a female gland's groove bottom
    a.feature("outer", faces_at(shape, R + r, 0.0))
    # flanks: the axial quarters (+Z, -Z)
    a.feature("flank_a", faces_at(shape, R, r))
    a.feature("flank_b", faces_at(shape, R, -r))
    a.write()


if __name__ == "__main__":
    build()
