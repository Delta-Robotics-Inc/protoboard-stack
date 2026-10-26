"""ISO 7045 M2 x 6 pan head screw, type Z (Pozi) recess, A2 (Accu SPP-M2-6-A2): representative geometry.

Accu offers STL/STP/IGS only behind an account login, and ISO publishes a
drawing, not CAD, so the screw is generated from ISO 7045:1994 Table 1
(sources.json src_iso) and the Accu technical data sheet (src_spec):

  thread M2 x 0.4, l = 6 under the head, threaded up to the head (Table 1
  footnote 3: l = 6 is above the dotted line);
  head dk 4.0 (Accu "4 mm +0/-0.3", ISO 4.0 max);
  head height 1.72 (Accu "1.72 mm +0/-0.26"; ISO 7045 gives 1.60 max:
  Accu stocks to DIN 7985 Z, and the part models the screw bought);
  head top radius rf 3.2 (ISO, approximate);
  recess No. 0 (PZ0), type Z m = 2.1 (ref), penetration 1.17-1.42.

Coordinates follow the other fasteners (library/cad/py/parts.py): the screw
axis is Z, the origin is on the axis in the under-head bearing plane, the
shank runs from z = 0 to z = +6 and the head sits in z < 0 with its crown at
z = -1.72. A fastener stack places the screw by this origin and +Z.

The head is a Ø4.0 cylinder capped by a sphere of radius rf whose apex is
the crown: at r = 2.0 the dome meets the side at z = -(1.72 - (3.2 -
sqrt(3.2^2 - 2^2))) = -1.018.

Not in the sources, recorded as `assumption` traits on the part:
  - the shank is a plain Ø2.0 cylinder (the thread major diameter, no thread
    form) with a flat end (ISO shows an "as rolled end" without dimensions);
  - the under-head radius (r min 0.1) and the transition diameter (da max
    2.6) are not modelled: the shank meets the head square;
  - the Pozi recess is a plain cross of two slots, 2.1 long (m) and 0.45
    wide, 1.3 deep from the crown (mid of the 1.17-1.42 penetration); the
    real type Z form (ISO 4757) is not modelled.
"""
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import build123d as bd  # noqa: E402
from build123d import Align, Box, Cylinder, Pos, Sphere  # noqa: E402

from partkit import GeneratedPart, cylinders  # noqa: E402

PART_ID = "iso-7045-m2x6-a2"

D = 2.0  # thread M2 (src_spec "M2 (2 mm)")
L = 6.0  # length under the head (src_spec "Length (L) 6 mm")
DK = 4.0  # head diameter (src_spec "4 mm", src_iso dk max 4.0)
K = 1.72  # head height of the part bought (src_spec "1.72 mm"; ISO k max 1.60)
RF = 3.2  # head top radius (src_iso rf approx. 3.2)
M = 2.1  # type Z recess width across the arms (src_iso m ref 2.1)

SLOT_W = 0.45  # assumption: recess slot width (ISO 4757 not consulted)
RECESS_DEPTH = 1.3  # assumption: mid of the 1.17-1.42 type Z penetration (src_iso)

MIN = (Align.CENTER, Align.CENTER, Align.MIN)
SIDE_Z = -(K - (RF - math.sqrt(RF**2 - (DK / 2) ** 2)))  # -1.018: where the dome meets the side


def head():
    """Ø4.0 x 1.72 pan head: cylinder intersected with the rf dome, crown at z = -K."""
    side = Pos(0, 0, -K) * Cylinder(DK / 2, K, align=MIN)
    dome = Pos(0, 0, -K + RF) * Sphere(RF)
    h = side & dome
    # plain cross recess from the crown
    z0 = -K - 0.1
    depth = RECESS_DEPTH + 0.1
    for w, l in ((M, SLOT_W), (SLOT_W, M)):
        h = h - Pos(0, 0, z0) * Box(w, l, depth, align=MIN)
    return h


def shank():
    return Cylinder(D / 2, L, align=MIN)


def build() -> None:
    screw = head() + shank()
    a = GeneratedPart(PART_ID, "iso-7045-m2x6", __file__)
    a.body(screw, "screw")

    planes = [f for f in screw.faces() if f.geom_type == bd.GeomType.PLANE]
    # thread: the Ø2.0 shank surface (axis Z), threaded up to the head
    a.feature("thread", cylinders(screw, D), axis=(0, 0, 1))
    # head_bearing: the annular under-head face at z = 0 that clamps the fastened part (normal +Z)
    a.feature(
        "head_bearing",
        [f for f in planes if f.normal_at().Z > 0.99 and abs(f.center(bd.CenterOf.MASS).Z) < 1e-6],
    )
    # drive: the cross recess walls and floor, opening at the crown (driver comes from -Z)
    a.feature("drive", [f for f in planes if f.center(bd.CenterOf.MASS).Z < -0.3])
    a.write()


if __name__ == "__main__":
    build()
