"""ST USBLC6-2SC6 (SOT23-6L) — representative package geometry.

No manufacturer CAD could be reached: st.com refused every fetch (HTTP/2
stream error or timeout), SnapEDA returns HTTP 403 and Ultra Librarian
needs a login (see .research/gaps.json). So the package is generated from
the SOT23-6L mechanical data in ST datasheet DS4260 Rev 6, Table 3 /
Figure 18:

  body length D (along the pin rows, Y)  2.8-3.05  -> 2.9   (ST eStore size 2.9 x 2.8 x 1.18)
  body width E (X)                        1.5-1.75  -> 1.6   (midpoint 1.625, rounded)
  lead span H tip to tip (X)              2.6-3.0   -> 2.8
  pitch e                                 0.95, pins 1-3 span 1.9
  lead width b                            0.30-0.5  -> 0.4
  lead thickness c                        0.09-0.2  -> 0.15  (midpoint 0.145, rounded)
  foot length L                           0.3-0.6   -> 0.45
  standoff A1                             0-0.15    -> 0.075
  body thickness A2                       0.9-1.3   -> 1.1
  overall height A                        0.9-1.45  (top at 0.075 + 1.1 = 1.175; eStore 1.18)
  no exposed pad

Assumed (the drawing gives only limits or nothing): the midpoints above,
lead shoulder top at z = 0.6 (about mid-body), pin-1 dimple 0.4 mm.
Recorded as an assumption trait on the part.

Coordinates: mm, body centred on the origin, seating plane z = 0, Z up.
Pins 1-3 on -X from +Y to -Y (pin 1 at +Y), pins 4-6 on +X from -Y to +Y
(pin 6 opposite pin 1), as in the datasheet's top-view functional diagram
(I/O1 1, GND 2, I/O2 3, I/O2 4, VBUS 5, I/O1 6).
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import build123d as bd  # noqa: E402

from partkit import GeneratedPart, block  # noqa: E402

PART = "st-usblc6-2sc6"

BODY_X, BODY_Y = 1.6, 2.9
BODY_Z0, BODY_Z1 = 0.075, 1.175
SPAN = 2.8
PITCH = 0.95
LEAD_W, LEAD_T = 0.4, 0.15
FOOT = 0.45
SHOULDER_Z = 0.6
PIN1_MARK_D = 0.4  # pin-1 index on the top face; not dimensioned (cosmetic)

# (side, y): side -1 = pins 1-3 (-X), +1 = pins 4-6 (+X)
PINS = {1: (-1, PITCH), 2: (-1, 0.0), 3: (-1, -PITCH), 4: (1, -PITCH), 5: (1, 0.0), 6: (1, PITCH)}


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
    a = GeneratedPart(PART, "st-usblc6-2sc6-sot23-6l", __file__)
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
