"""AS568-138 O-ring, silicone 70A FDA (The O-Ring Store S70138): representative geometry.

AS568 is a size standard, so there is no manufacturer CAD (sources.json; the
part's data_gap trait). The body is the nominal ring from the AS568 table:
ID 53.64 mm (2.112 in, ± 0.43) and cross-section 2.62 mm (0.103 in, ± 0.08)
[src_apple_as568, src_size_chart], so OD 58.88 mm and centre-line diameter
56.26 mm. It is a torus at nominal size: no tolerance, flash (Apple Rubber:
0.005 x 0.003 in on standard sizes) or parting line is modelled.

Coordinates: ring axis on Z, centred on the origin, free (uncompressed)
shape lying on z = 0, so the cross-section circle's centre is at
z = CS / 2 = 1.31 and the ring spans z 0..2.62. Convention (the part's
frames): the -Z side is the sealing side that bears on the counterface (the
bottle lip land), the +Z side sits on the bottom of the host's groove (the cap).
The ring is symmetric, so either side can serve; the convention only names
the features.

The section circle is split into four 90° arcs so the revolved torus has
four faces, one per contact zone:
  - seal_face:  the -Z quarter (bears on the counterface);
  - gland_face: the +Z quarter (groove bottom);
  - outer_face: the OD quarter (outer groove wall; with internal pressure the
    ring is pushed against it);
  - inner_face: the ID quarter (inner groove wall).
"""
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import build123d as bd  # noqa: E402

from partkit import GeneratedPart  # noqa: E402

PART_ID = "as568-138-silicone"

ID = 53.64  # AS568-138 inside diameter, mm (2.112 in)
CS = 2.62  # AS568-138 cross-section, mm (0.103 in)
R_CENTRE = (ID + CS) / 2  # 28.13: centre-line radius
R_SECTION = CS / 2  # 1.31


def section_point(deg: float) -> bd.Vector:
    """A point on the section circle in the XZ plane; 0° points outward (+X), 90° up (+Z)."""
    t = math.radians(deg)
    return bd.Vector(R_CENTRE + R_SECTION * math.cos(t), 0, R_SECTION + R_SECTION * math.sin(t))


def body():
    # quarter arcs centred on -90° (seal), 0° (outer), 90° (gland), 180° (inner)
    arcs = [bd.ThreePointArc(section_point(c - 45), section_point(c), section_point(c + 45)) for c in (-90, 0, 90, 180)]
    section = bd.Face(bd.Wire(arcs))
    return bd.Solid.revolve(section, 360, bd.Axis.Z)


def quarter(shape, direction: tuple[float, float, float]):
    """The toroidal quarter face on the side `direction` points to (±Z by height, ±X by radius).

    A full-revolution face has its centroid on the axis, so the faces are told
    apart by their bounding boxes: the seal and gland quarters by the box's
    mid-height, the outer and inner quarters by the box's diameter.
    """
    faces = list(shape.faces())
    if direction[2]:
        key = lambda f: f.bounding_box().center().Z * direction[2]  # noqa: E731
    else:
        key = lambda f: f.bounding_box().size.X * direction[0]  # noqa: E731
    return [max(faces, key=key)]


def build() -> None:
    a = GeneratedPart(PART_ID, "as568-138-silicone", __file__)
    shape = a.body(body(), "o_ring")
    a.feature("seal_face", quarter(shape, (0, 0, -1)))
    a.feature("gland_face", quarter(shape, (0, 0, 1)))
    a.feature("outer_face", quarter(shape, (1, 0, 0)))
    a.feature("inner_face", quarter(shape, (-1, 0, 0)))
    a.write()


if __name__ == "__main__":
    build()
