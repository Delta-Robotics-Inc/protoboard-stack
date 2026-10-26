"""Analog Devices MAX17048G+T10 (8 TDFN-EP, T822+3): representative package geometry.

No manufacturer CAD is downloadable here: the ADI product page links CAD
only to Ultra Librarian and SamacSys, which need an account and their own
terms (see library/parts/adi-max17048g-t10/.research/gaps.json). So the
package is generated from Maxim outline 21-0168 Rev M ("8L TDFN exposed
pad, 2x2x0.75 mm"), variation T822-3:

  body D x E          1.90-2.10 x 1.90-2.10 -> 2.00 x 2.00 (nominal)
  height A            0.70 / 0.75 / 0.80    -> 0.75 (nominal)
  standoff A1         0.00-0.05
  8 leads, pitch e    0.50, row span [(N/2)-1] x e = 1.50 REF
  lead width b        0.25 +-0.05           -> 0.25
  lead length L       0.20 / 0.30 / 0.40    -> 0.30, flush with the body edge
  exposed pad         E2 1.20 +-0.10 along the lead rows, D2 0.80 +-0.10 across,
                      C0.25 x 45 deg chamfer at the pin-1 corner

Assumed (the drawing gives no value): terminal and exposed-pad thickness
0.02 mm below the body (inside the A1 0-0.05 range), and a 0.30 mm pin-1
dimple 0.03 mm deep on the top face in the "pin 1 index area" (cosmetic).
Recorded as an assumption trait on the part.

Coordinates: mm, body centred on the origin, seating plane z = 0, Z up,
x along the lead rows (E), y across them (D). Top view (pad side down, as
the datasheet's TDFN pin configuration): pins 1-4 along the -y edge from
x = -0.75 to +0.75 (CTG 1, CELL 2, VDD 3, GND 4), pins 5-8 along the +y edge
from x = +0.75 back to -0.75 (ALRT 5, QSTRT 6, SCL 7, SDA 8).
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import build123d as bd  # noqa: E402

from partkit import GeneratedPart, block  # noqa: E402

PART = "adi-max17048g-t10"

D = E = 2.0
A = 0.75
PITCH = 0.5
LEAD_B, LEAD_L = 0.25, 0.30
EP_X, EP_Y, EP_CHAMFER = 1.20, 0.80, 0.25
PAD_T = 0.02  # assumption: terminal thickness not dimensioned
PIN1_MARK_D, PIN1_MARK_DEPTH = 0.30, 0.03  # assumption: cosmetic pin-1 mark

Y_LEAD = D / 2 - LEAD_L / 2
XS = [-1.5 * PITCH, -0.5 * PITCH, 0.5 * PITCH, 1.5 * PITCH]
PINS = {n: (XS[n - 1], -Y_LEAD) for n in range(1, 5)}
PINS.update({n: (XS[8 - n], Y_LEAD) for n in range(5, 9)})


def bottom(shape) -> list:
    """Planar faces of `shape` on the seating plane, facing down."""
    return [f for f in shape.faces() if f.geom_type == bd.GeomType.PLANE and f.normal_at().Z < -0.99 and abs(f.center().Z) < 1e-6]


def exposed_pad():
    """The exposed pad with its C0.25 chamfer at the pin-1 corner (-x, -y)."""
    hx, hy, c = EP_X / 2, EP_Y / 2, EP_CHAMFER
    outline = [(-hx + c, -hy), (hx, -hy), (hx, hy), (-hx, hy), (-hx, -hy + c)]
    with bd.BuildPart() as ep:
        with bd.BuildSketch():
            bd.Polygon(*outline, align=None)
        bd.extrude(amount=PAD_T)
    return ep.part


def build() -> None:
    a = GeneratedPart(PART, "adi-max17048-tdfn8", __file__)
    body = block(0, 0, PAD_T, E, D, A - PAD_T)
    mark = bd.Pos(XS[0], -Y_LEAD + 0.1, A) * bd.Cylinder(
        PIN1_MARK_D / 2, PIN1_MARK_DEPTH, align=(bd.Align.CENTER, bd.Align.CENTER, bd.Align.MAX)
    )
    body = body.cut(mark)
    a.body(body, "package")
    a.feature("package_top", [f for f in body.faces() if f.geom_type == bd.GeomType.PLANE and f.normal_at().Z > 0.99 and abs(f.center().Z - A) < 1e-6])

    feet = []
    for n, (x, y) in PINS.items():
        lead = block(x, y, 0, LEAD_B, LEAD_L, PAD_T)
        a.body(lead, f"lead_{n}")
        faces = bottom(lead)
        feet += faces
        a.feature(f"pin_{n}", faces)

    ep = exposed_pad()
    a.body(ep, "exposed_pad")
    ep_faces = bottom(ep)
    a.feature("ep", ep_faces)
    a.feature("pcb_mount", feet + ep_faces)
    a.write()


if __name__ == "__main__":
    build()
