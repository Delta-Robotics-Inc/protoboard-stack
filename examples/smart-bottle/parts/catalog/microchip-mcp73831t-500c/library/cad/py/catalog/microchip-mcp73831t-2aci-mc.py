"""Microchip MCP73831T-2ACI/MC (8-lead 2x3 DFN, MC) — representative package geometry.

No manufacturer STEP is redistributable: Microchip's product page
(https://www.microchip.com/en-us/product/MCP73831) offers CAD only through a
third-party library link, and SnapEDA models are under SnapMagic's Terms of
Service, which forbid redistributing Design Files (5.1(a), 5.1(f), 5.1(g)).
So the package is generated from Microchip drawing C04-123C, "8-Lead Plastic
Dual Flat, No Lead Package (MC) - 2x3x0.9 mm Body [DFN]", in data sheet
DS20001984H p.20:

  overall length D (along the pin rows, X)   2.00 BSC
  overall width E (across the rows, Y)       3.00 BSC
  pitch e                                    0.50 BSC
  overall height A                           0.80 / 0.90 / 1.00 -> 0.90 (nominal)
  standoff A1                                0.00 / 0.02 / 0.05 -> 0.02 (nominal)
  contact thickness A3                       0.20 REF
  contact width b                            0.20 / 0.25 / 0.30 -> 0.25 (nominal)
  contact length L                           0.30 / 0.40 / 0.50 -> 0.40 (nominal)
  exposed pad D2 (X)                         1.30-1.55 -> 1.425 (midpoint; no nominal given)
  exposed pad E2 (Y)                         1.50-1.75 -> 1.625 (midpoint; no nominal given)
  contact-to-exposed pad K                   0.20 min (1.50 - 0.40 - 0.8125 = 0.29 here)

Assumed (the drawing gives only limits or nothing): the exposed-pad
midpoints above, rectangular contacts (the drawing rounds their inner ends),
contacts and pad flush with the package edge/underside from z = 0 to A3, and
a 0.3 mm pin-1 dimple on the top face in the drawing's pin-1 quadrant (its
form "may vary"). Tie bars (note 2) are not modelled. Recorded as an
assumption trait on the part.

Coordinates: mm, body centred on the origin, seating plane z = 0, Z up,
X along D (2.00), Y along E (3.00). Top view as the drawing: pins 1-4 along
the -Y edge from x = -0.75 to +0.75 (pin 1 at -X), pins 5-8 back along the
+Y edge from x = +0.75 to -0.75 (counter-clockwise; pin 8 opposite pin 1).
Exposed pad (pin 9) centred on the underside.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import build123d as bd  # noqa: E402

from partkit import GeneratedPart, block  # noqa: E402

PART = "microchip-mcp73831t-2aci-mc"

D, E = 2.00, 3.00
A, A1, A3 = 0.90, 0.02, 0.20
PITCH = 0.50
B, L = 0.25, 0.40
D2, E2 = 1.425, 1.625
PIN1_MARK_D = 0.3  # top-face index dimple; form not dimensioned (note 1)

Y_PAD = E / 2 - L / 2
PINS = {n: (-0.75 + PITCH * (n - 1), -Y_PAD) for n in range(1, 5)}
PINS.update({n: (0.75 - PITCH * (n - 5), Y_PAD) for n in range(5, 9)})


def bottom(shape) -> list:
    return [f for f in shape.faces() if f.geom_type == bd.GeomType.PLANE and f.normal_at().Z < -0.99 and abs(f.center().Z) < 1e-6]


def build() -> None:
    a = GeneratedPart(PART, "microchip-mcp73831-dfn8-2x3", __file__)
    contacts = {n: block(x, y, 0, B, L, A3) for n, (x, y) in PINS.items()}
    ep = block(0, 0, 0, D2, E2, A3)

    # moulded body from the standoff to the top, with the contacts and pad set into it
    body = block(0, 0, A1, D, E, A - A1)
    for c in contacts.values():
        body = body.cut(c)
    body = body.cut(ep)
    mark = bd.Pos(-D / 2 + 0.4, -E / 2 + 0.55, A) * bd.Cylinder(PIN1_MARK_D / 2, 0.05, align=(bd.Align.CENTER, bd.Align.CENTER, bd.Align.MAX))
    body = body.cut(mark)

    a.body(body, "package")
    a.feature("package_top", [f for f in body.faces() if f.geom_type == bd.GeomType.PLANE and f.normal_at().Z > 0.99 and abs(f.center().Z - A) < 1e-6])
    feet = []
    for n, c in contacts.items():
        a.body(c, f"contact_{n}")
        faces = bottom(c)
        feet += faces
        a.feature(f"pin_{n}", faces)
    a.body(ep, "exposed_pad")
    a.feature("pcb_mount", feet)
    a.feature("thermal_pad", bottom(ep))
    a.write()


if __name__ == "__main__":
    build()
