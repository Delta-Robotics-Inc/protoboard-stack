"""AS568-040 O-ring, silicone 70A: generated geometry (exact to nominal).

Marco's S1000-040 page offers no CAD, and none is needed: an O-ring is a
torus fully defined by its inside diameter and cross section. Dimensions (sources.json):

  ID 72.75 +/- 0.51 mm (2.864 +/- .020 in), CS 1.78 +/- 0.08 mm
  (.070 +/- .003 in), OD 76.31 mm; volume .0355 in3 (581.7 mm3)
  — Parker ORD 5700 AS568A size table row 2-040 (src_parker_handbook),
  Marco S1000-040 tech specs (src_marco_product).

Modelled at nominal, free (uncompressed, unstretched) state. The size table
is for AN-shrinkage compounds; a silicone from standard tooling can run a
little small (Parker S0604-70 class I: ID 72.31 +/- 0.58 mm). That is a
usage note on the part, not modelled.

Coordinates (the convention of the other AS568 parts, e.g. as568-138-silicone):
ring axis on Z, lying on z = 0, so the cross-section centre is at
z = CS / 2 = 0.89 and the ring spans z 0..1.78. The cross-section circle is
revolved as four 90-degree arcs, which gives four named faces, one per
contact zone:
  - seal_face  (-Z quadrant): bears on the flat counterface (the land);
  - gland_face (+Z quadrant): on the groove bottom;
  - inner_face (the ID quadrant): on the groove's inner wall, the locating
               wall when the pressure is from outside (Parker Design Chart
               4-2: groove ID = ring ID), as in the smart-bottle lid;
  - outer_face (the OD quadrant): on the groove's outer wall (pressure from
               inside: groove OD = ring OD).
The ring is symmetric, so which side is the seal face is a naming convention.
"""
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import build123d as bd  # noqa: E402

from partkit import GeneratedPart  # noqa: E402

PART_ID = "as568-040-silicone"

ID = 72.75  # AS568 -040 inside diameter (mm)
CS = 1.78  # AS568 -040 cross section (mm)
R = (ID + CS) / 2  # 37.265: centre-line radius
r = CS / 2  # 0.89


def quadrant(a0: float, a1: float) -> bd.Edge:
    """An arc of the cross-section circle (centre (R, 0, r)) in the XZ plane, from angle a0 to a1 (deg)."""
    pts = [bd.Vector(R + r * math.cos(math.radians(a)), 0, r + r * math.sin(math.radians(a))) for a in (a0, (a0 + a1) / 2, a1)]
    return bd.Edge.make_three_point_arc(*pts)


# angles of the cross-section circle, from +X (outward) toward +Z
ARCS = {"outer_face": (-45, 45), "gland_face": (45, 135), "inner_face": (135, 225), "seal_face": (225, 315)}


def ring() -> bd.Solid:
    profile = bd.Face(bd.Wire([quadrant(*a) for a in ARCS.values()]))
    return bd.Solid.revolve(profile, 360, bd.Axis.Z)


def surface(solid: bd.Solid, name: str) -> list[bd.Face]:
    """The revolved face swept by one quadrant arc, picked by a point on it."""
    a0, a1 = ARCS[name]
    mid = math.radians((a0 + a1) / 2)
    want_rho, want_z = R + r * math.cos(mid), r + r * math.sin(mid)

    def score(f: bd.Face) -> float:
        # a revolved face's mass centre lies on the axis, so probe a point on the face itself
        p = f.position_at(0.5, 0.5)
        return abs(math.hypot(p.X, p.Y) - want_rho) + abs(p.Z - want_z)

    faces = sorted(solid.faces(), key=score)
    assert score(faces[0]) < 0.3 * r, (name, score(faces[0]))
    return [faces[0]]


def build() -> None:
    body = ring()
    assert len(body.faces()) == 4, len(body.faces())
    a = GeneratedPart(PART_ID, "as568-040-silicone", __file__)
    a.body(body, "o_ring")
    for name in ARCS:
        a.feature(name, surface(body, name))
    a.write()
    print(f"  volume {body.volume:.1f} mm3 (Parker table .0355 in3 = {0.0355 * 25.4 ** 3:.1f} mm3)")


if __name__ == "__main__":
    build()
