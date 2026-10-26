"""TI TPS7A0218PDBVR (DBV, 5-pin SOT-23) — representative package geometry.

No manufacturer STEP is redistributable: TI's product folder links CAD/3D
models only through Ultra Librarian
(https://vendor.ultralibrarian.com/TI/embedded/?gpn=TPS7A02&package=DBV&pin=5),
whose End User Subscription Agreement forbids redistribution. So the package
is generated from TI's drawing DBV0005A (4214839/K 08/2024), appended to
datasheet SBVS277C:

  body length (along the pin rows, Y)  2.75-3.05 -> 2.9   (nominal, midpoint)
  body width (X)                        1.45-1.75 -> 1.6
  lead span tip to tip (X)              2.6-3.0   -> 2.8
  pitch                                 0.95 (2X), pins 1-3 span 1.9
  lead width                            0.3-0.5   -> 0.4
  lead thickness                        0.08-0.22 -> 0.15
  foot length                           0.3-0.6   -> 0.45
  standoff                              0.00-0.15 -> 0.075
  height                                0.90-1.45 -> 1.175 (body (1.1) REF above the standoff)
  no exposed pad (JEDEC MO-178)

Assumed (the drawing gives only limits or nothing): body underside at
z = 0.075 (standoff midpoint), body top at z = 1.175 (standoff + the
1.1 mm reference body height, also the midpoint of 0.90-1.45), lead
shoulder top at z = 0.6 (about mid-body), pin-1 dimple 0.4 mm. Recorded as
an assumption trait on the part.

Coordinates: mm, body centred on the origin, seating plane z = 0, Z up.
Pins 1-3 on -X from +Y to -Y (pin 1 at +Y), pin 4 on +X opposite pin 3
(-Y) and pin 5 on +X opposite pin 1 (+Y), as in the datasheet top view
(Figure 5-2: IN 1, GND 2, EN 3, NC 4, OUT 5). There is no lead opposite
pin 2 (DBV0005A note 5: a support pin there "may differ or may not be
present"; it is not modelled).

The package is the same as ti-tps7a0230pdbv (TPS7A0230PDBVR); only the
output voltage differs, so the geometry matches that part's script.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import build123d as bd  # noqa: E402

from partkit import GeneratedPart, block  # noqa: E402

PART = "ti-tps7a0218pdbv"

BODY_X, BODY_Y = 1.6, 2.9
BODY_Z0, BODY_Z1 = 0.075, 1.175
SPAN = 2.8
PITCH = 0.95
LEAD_W, LEAD_T = 0.4, 0.15
FOOT = 0.45
SHOULDER_Z = 0.6
PIN1_MARK_D = 0.4  # pin-1 index drawn on the top face; size not dimensioned (cosmetic)

# (side, y): side -1 = pins 1-3 (-X), +1 = pins 4-5 (+X)
PINS = {1: (-1, PITCH), 2: (-1, 0.0), 3: (-1, -PITCH), 4: (1, -PITCH), 5: (1, PITCH)}


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
    a = GeneratedPart(PART, "ti-tps7a0218p-dbv5", __file__)
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
