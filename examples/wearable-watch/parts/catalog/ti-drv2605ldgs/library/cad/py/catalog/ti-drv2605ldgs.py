"""TI DRV2605LDGSR (DGS, 10-pin VSSOP) — representative package geometry.

No manufacturer STEP is redistributable: TI's product folder links CAD/3D
models only through Ultra Librarian
(https://vendor.ultralibrarian.com/TI/embedded/?gpn=DRV2605L&package=DGS&pin=10),
whose End User Subscription Agreement forbids redistribution. So the package
is generated from TI's drawing DGS0010A (4221984/A 05/2015), appended to
datasheet SLOS854D:

  body length (along the pin rows, Y)  2.9-3.1   -> 3.0   (nominal, midpoint)
  body width (X)                        2.9-3.1   -> 3.0
  lead span tip to tip (X)              4.75-5.05 -> 4.9
  pitch                                 0.5 (8X), pins 1-5 span 2.0 (2X)
  lead width                            0.17-0.27 -> 0.22
  lead thickness                        0.13-0.23 -> 0.18
  foot length                           0.4-0.7   -> 0.55
  standoff                              0.05-0.15 -> 0.10
  height                                1.1 MAX
  no exposed pad (JEDEC MO-187 variation BA)

Assumed (the drawing gives only limits or nothing): body underside at
z = 0.10 (standoff midpoint), body top at z = 1.0 (<= 1.1 max), lead
shoulder top at z = 0.55 (about mid-body). Recorded as an assumption trait
on the part.

Coordinates: mm, body centred on the origin, seating plane z = 0, Z up.
Pins 1-5 on -X from +Y to -Y (pin 1 at +Y), pins 6-10 on +X from -Y to +Y,
as in the datasheet top view (REG 1, SCL 2, SDA 3, IN/TRIG 4, EN 5,
VDD/NC 6, OUT+ 7, GND 8, OUT- 9, VDD 10).
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import build123d as bd  # noqa: E402

from partkit import GeneratedPart, block  # noqa: E402

PART = "ti-drv2605ldgs"

BODY_X, BODY_Y = 3.0, 3.0
BODY_Z0, BODY_Z1 = 0.10, 1.0
SPAN = 4.9
PITCH = 0.5
LEAD_W, LEAD_T = 0.22, 0.18
FOOT = 0.55
SHOULDER_Z = 0.55
PIN1_MARK_D = 0.4  # pin-1 dimple drawn on the top face; size not dimensioned (cosmetic)

# y of pins 1..5 (left, -X) and 6..10 (right, +X)
YS = [2 * PITCH, PITCH, 0.0, -PITCH, -2 * PITCH]
PINS = {n: (-1, YS[n - 1]) for n in range(1, 6)}
PINS.update({n: (1, YS[10 - n]) for n in range(6, 11)})


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
    a = GeneratedPart(PART, "ti-drv2605l-dgs10", __file__)
    body = block(0, 0, BODY_Z0, BODY_X, BODY_Y, BODY_Z1 - BODY_Z0)
    mark = bd.Pos(-BODY_X / 2 + 0.5, BODY_Y / 2 - 0.5, BODY_Z1) * bd.Cylinder(PIN1_MARK_D / 2, 0.05, align=(bd.Align.CENTER, bd.Align.CENTER, bd.Align.MAX))
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
