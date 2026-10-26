"""Microchip MCP73831T-2ACI/OT (5-lead SOT-23, OT) — representative package geometry.

No manufacturer STEP is redistributable: Microchip's product page
(https://www.microchip.com/en-us/product/MCP73831) offers CAD only through a
third-party library link, and the SnapEDA model for MCP73831T-2ACI/OT is under
SnapMagic's Terms of Service, which forbid redistributing Design Files
(5.1(a), 5.1(f), 5.1(g)). So the package is generated from Microchip drawing
C04-091-OT Rev F, in data sheet DS20001984H pp.22-23:

  overall length D (along the pin rows, Y)   2.90 BSC
  molded package width E1 (X)                1.60 BSC
  overall width E, lead tip to tip (X)       2.80 BSC
  pitch e                                    0.95 BSC (pins 1-3 span e1 1.90)
  overall height A                           0.90-1.45
  molded package thickness A2                0.89-1.30 -> 1.095 (midpoint)
  standoff A1                                <= 0.15   -> 0.075 (midpoint of 0-0.15)
  foot length L                              0.30-0.60 -> 0.45
  lead thickness c                           0.08-0.26 -> 0.17
  lead width b                               0.20-0.51 -> 0.355
  no exposed pad

Assumed (the drawing gives only limits or nothing): the single values above
(midpoints), body top at z = A1 + A2 = 1.17 (inside 0.90-1.45), lead shoulder
top at z = 0.60 (about mid-body), pin-1 dimple 0.3 mm. Recorded as an
assumption trait on the part.

Coordinates: mm, body centred on the origin, seating plane z = 0, Z up.
Pins 1-3 on -X from +Y to -Y (pin 1 at +Y), pins 4-5 on +X, pin 4 opposite
pin 3 (-Y) and pin 5 opposite pin 1 (+Y), as in the data sheet top view
(STAT 1, VSS 2, VBAT 3, VDD 4, PROG 5). The +X side has no lead at y = 0.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import build123d as bd  # noqa: E402

from partkit import GeneratedPart, block  # noqa: E402

PART = "microchip-mcp73831t-2aci-ot"

BODY_X, BODY_Y = 1.60, 2.90  # E1, D
BODY_Z0 = 0.075  # A1 midpoint
BODY_Z1 = BODY_Z0 + 1.095  # + A2 midpoint
SPAN = 2.80  # E
PITCH = 0.95  # e
LEAD_W, LEAD_T = 0.355, 0.17  # b, c
FOOT = 0.45  # L
SHOULDER_Z = 0.60
PIN1_MARK_D = 0.3  # pin-1 dimple on the top face; not dimensioned (cosmetic)

# (side, y): side -1 = -X row, +1 = +X row
PINS = {
    1: (-1, PITCH),
    2: (-1, 0.0),
    3: (-1, -PITCH),
    4: (1, -PITCH),
    5: (1, PITCH),
}


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
    a = GeneratedPart(PART, "microchip-mcp73831-sot23-5", __file__)
    body = block(0, 0, BODY_Z0, BODY_X, BODY_Y, BODY_Z1 - BODY_Z0)
    mark = bd.Pos(-BODY_X / 2 + 0.35, BODY_Y / 2 - 0.45, BODY_Z1) * bd.Cylinder(PIN1_MARK_D / 2, 0.05, align=(bd.Align.CENTER, bd.Align.CENTER, bd.Align.MAX))
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
