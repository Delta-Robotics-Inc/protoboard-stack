"""Texas Instruments LP5024RSMR (32-pin VQFN, RSM0032B): representative package geometry.

No manufacturer CAD is usable here: the TI product folder links the 3D model
only through Ultra Librarian, whose download needs its terms accepted and
states no redistribution licence (see
library/parts/ti-lp5024rsm/.research/gaps.json). So the package is generated
from the RSM0032B outline (TI drawing 4219108/B 08/2019) at the end of
datasheet SLVSEB8C:

  body D x E          3.9-4.1 x 3.9-4.1     -> 4.00 x 4.00 (Device Information nominal)
  height A            1 MAX                 -> 1.00 (assumption: no nominal given)
  standoff A1         0.00-0.05
  32 terminals        8 per side, pitch e 0.4 (28X 0.4), row span 2.8 (2X 2.8)
  terminal width b    0.15-0.25             -> 0.20
  terminal length L   0.25-0.45             -> 0.35, flush with the body edge
  exposed pad 33      2.8 +-0.05 square (GND), no pin-1 chamfer drawn

Assumed (the drawing gives no value): terminal and exposed-pad thickness
0.02 mm below the body (inside the A1 0-0.05 range), and a 0.40 mm pin-1
dimple 0.03 mm deep on the top face in the "pin 1 index area" (cosmetic).
Recorded as an assumption trait on the part.

Coordinates: mm, body centred on the origin, seating plane z = 0, Z up.
Top view as datasheet Figure 5-2 (pads down): pins 1-8 down the -x edge
(pin 1 at +y), pins 9-16 along the -y edge left to right, pins 17-24 up the
+x edge, pins 25-32 along the +y edge right to left (pin 32 at the pin-1
corner). This matches the drawing's bottom view (the top view mirrored
about x).
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import build123d as bd  # noqa: E402

from partkit import GeneratedPart, block  # noqa: E402

PART = "ti-lp5024rsm"

BODY = 4.0
A = 1.0  # assumption: RSM0032B gives 1 mm max only
PITCH = 0.4
PER_SIDE = 8
LEAD_B, LEAD_L = 0.20, 0.35
EP = 2.8
PAD_T = 0.02  # assumption: terminal thickness not dimensioned
PIN1_MARK_D, PIN1_MARK_DEPTH = 0.40, 0.03  # assumption: cosmetic pin-1 mark

EDGE = BODY / 2 - LEAD_L / 2  # terminal centre distance from the body centre
OFFS = [(PER_SIDE - 1) / 2 * PITCH - i * PITCH for i in range(PER_SIDE)]  # +1.4 .. -1.4


def pin_xy(n: int) -> tuple[float, float, float, float]:
    """(x, y, size_x, size_y) of terminal n in the top view."""
    side, i = divmod(n - 1, PER_SIDE)
    o = OFFS[i]
    if side == 0:  # 1-8: -x edge, top to bottom
        return -EDGE, o, LEAD_L, LEAD_B
    if side == 1:  # 9-16: -y edge, left to right
        return -o, -EDGE, LEAD_B, LEAD_L
    if side == 2:  # 17-24: +x edge, bottom to top
        return EDGE, -o, LEAD_L, LEAD_B
    return o, EDGE, LEAD_B, LEAD_L  # 25-32: +y edge, right to left


def bottom(shape) -> list:
    """Planar faces of `shape` on the seating plane, facing down."""
    return [f for f in shape.faces() if f.geom_type == bd.GeomType.PLANE and f.normal_at().Z < -0.99 and abs(f.center().Z) < 1e-6]


def build() -> None:
    a = GeneratedPart(PART, "ti-lp5024-rsm32", __file__)
    body = block(0, 0, PAD_T, BODY, BODY, A - PAD_T)
    corner = BODY / 2 - 0.45
    mark = bd.Pos(-corner, corner, A) * bd.Cylinder(
        PIN1_MARK_D / 2, PIN1_MARK_DEPTH, align=(bd.Align.CENTER, bd.Align.CENTER, bd.Align.MAX)
    )
    body = body.cut(mark)
    a.body(body, "package")
    a.feature("package_top", [f for f in body.faces() if f.geom_type == bd.GeomType.PLANE and f.normal_at().Z > 0.99 and abs(f.center().Z - A) < 1e-6])

    feet = []
    for n in range(1, 4 * PER_SIDE + 1):
        x, y, sx, sy = pin_xy(n)
        lead = block(x, y, 0, sx, sy, PAD_T)
        a.body(lead, f"lead_{n}")
        faces = bottom(lead)
        feet += faces
        a.feature(f"pin_{n}", faces)

    ep = block(0, 0, 0, EP, EP, PAD_T)
    a.body(ep, "exposed_pad")
    ep_faces = bottom(ep)
    a.feature("pin_33", ep_faces)
    a.feature("pcb_mount", feet + ep_faces)
    a.write()


if __name__ == "__main__":
    build()
