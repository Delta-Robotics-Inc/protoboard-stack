"""Alpha & Omega AO3400A (SOT23, 3 leads) — representative package geometry.

No manufacturer STEP exists to redistribute: the AOS product page
(https://www.aosmd.com/products/mosfets/low-voltage-mosfets-12v-30v/ao3400a)
offers the datasheet, marking, reliability report, package outline and tape
& reel documents only. So the package is generated from the AOS SOT23
package outline, document PO-00001 version N
(https://www.aosmd.com/sites/default/files/res/package/SOT23.pdf):

  body length D (along the lead rows, Y)  2.80 / 2.90 / 3.10 -> 2.90 (nominal)
  body width E1 (X)                       1.40 / 1.60 / 1.80 -> 1.60
  lead span E, tip to tip (X)             2.60 / 2.80 / 3.00 -> 2.80
  pitch e / e1                            0.95 BSC / 1.90 BSC
  lead width b                            0.30 / 0.40 / 0.50 -> 0.40
  lead thickness c                        0.08 / 0.13 / 0.20 -> 0.13
  foot length L (gauge plane)             0.30-0.60          -> 0.45
  standoff A1                             0.00-0.15          -> 0.075
  body thickness A2                       0.70 / 1.05 / 1.20 -> 1.05
  overall height A                        0.85-1.25 (top at 0.075 + 1.05 = 1.125)
  no exposed pad

Assumed (the outline gives only limits or nothing): body underside at
z = 0.075 (A1 midpoint), lead shoulder top at z = 0.55 (about mid-body),
square lead bends (the drawing's 0-8 degree foot angle is drawn flat),
pin-1 dimple 0.4 mm. Recorded as an assumption trait on the part.

Coordinates: mm, body centred on the origin, seating plane z = 0, Z up.
Pins 1 and 2 on -X (pin 1 at +Y, pin 2 at -Y, 1.90 apart), pin 3 on +X
centred (y = 0), counter-clockwise seen from the top. Datasheet p.1 top
view: G and S on one side with the pin-1 dot at G, D alone opposite, so
pin 1 G, pin 2 S, pin 3 D.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import build123d as bd  # noqa: E402

from partkit import GeneratedPart, block  # noqa: E402

PART = "aos-ao3400a"

BODY_X, BODY_Y = 1.6, 2.9
BODY_Z0, BODY_Z1 = 0.075, 1.125
SPAN = 2.8
E1_PITCH = 1.9
LEAD_W, LEAD_T = 0.4, 0.13
FOOT = 0.45
SHOULDER_Z = 0.55
PIN1_MARK_D = 0.4  # pin-1 index on the top face; size not dimensioned (cosmetic)

# (side, y): side -1 = pins 1-2 (-X), +1 = pin 3 (+X)
PINS = {1: (-1, E1_PITCH / 2), 2: (-1, -E1_PITCH / 2), 3: (1, 0.0)}


def lead(side: int, y: float):
    """Gull-wing lead: shoulder out of the body, a drop, and a foot on the seating plane."""
    edge = BODY_X / 2
    tip = SPAN / 2
    knee = tip - FOOT  # inner end of the foot
    shoulder = block(side * (edge + knee) / 2, y, SHOULDER_Z - LEAD_T, knee - edge, LEAD_W, LEAD_T)
    drop = block(side * (knee + LEAD_T / 2), y, LEAD_T, LEAD_T, LEAD_W, SHOULDER_Z - LEAD_T)
    foot = block(side * (knee + tip) / 2, y, 0, FOOT, LEAD_W, LEAD_T)
    return foot, shoulder.fuse(drop).fuse(foot)


def bottom(shape) -> list:
    return [f for f in shape.faces() if f.geom_type == bd.GeomType.PLANE and f.normal_at().Z < -0.99 and abs(f.center().Z) < 1e-6]


def build() -> None:
    a = GeneratedPart(PART, "aos-ao3400a-sot23", __file__)
    body = block(0, 0, BODY_Z0, BODY_X, BODY_Y, BODY_Z1 - BODY_Z0)
    mark = bd.Pos(-BODY_X / 2 + 0.4, BODY_Y / 2 - 0.45, BODY_Z1) * bd.Cylinder(PIN1_MARK_D / 2, 0.05, align=(bd.Align.CENTER, bd.Align.CENTER, bd.Align.MAX))
    body = body.cut(mark)
    a.body(body, "package")
    a.feature("package_top", [f for f in body.faces() if f.geom_type == bd.GeomType.PLANE and f.normal_at().Z > 0.99 and abs(f.center().Z - BODY_Z1) < 1e-6])
    feet = []
    for n, (side, y) in PINS.items():
        foot, whole = lead(side, y)
        a.body(whole, f"lead_{n}")
        faces = bottom(foot)
        feet += faces
        a.feature(f"pin_{n}", faces)
    a.feature("pcb_mount", feet)
    a.write()


if __name__ == "__main__":
    build()
