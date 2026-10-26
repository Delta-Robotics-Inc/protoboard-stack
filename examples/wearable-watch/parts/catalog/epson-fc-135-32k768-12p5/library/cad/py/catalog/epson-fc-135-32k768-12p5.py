"""Epson FC-135 32.768 kHz crystal (3.2 x 1.5 mm SMD) — representative package geometry.

Epson publishes FC-135 3D CAD data only behind a click-through licence
(personal, non-transferable, no copying or distribution; see
.research/gaps.json), so it is not used. The package is generated from the
outline drawing in Epson data sheet FC-135_E_Ver2.0, section [7]:

  body length (X)                    3.2 +/- 0.1   -> 3.2
  body width (Y)                     1.5 +/- 0.1   -> 1.5
  height                             0.9 max       -> 0.9 (modelled at the maximum)
  terminals #1, #2 (bottom view)     0.65 (X) x 1.3 (Y), inner gap 1.7,
                                     0.1 from each body end
                                     (1.7 + 2 x 0.65 + 2 x 0.1 = 3.2)
  terminal metallization (end view)  0.35 high, at the two corner
                                     castellations of each end only; the
                                     middle of the end face is bare (end
                                     and side views)
  corner castellations               shown, not dimensioned; each pad runs
                                     out to the castellations at its end
                                     (bottom view)

Assumed (the drawing does not dimension them; scaled from the drawing and
recorded as an assumption trait on the part): terminal thickness 0.03,
ceramic base top at z = 0.6, lid 2.7 x 1.1 with 0.15 corner radius from
z = 0.6 to 0.9, castellation radius 0.2 (the end view's metallized blocks
are about 0.2 wide), castellation lining 0.02 thick. Each bottom pad is
the full dimensioned 0.65 x 1.3 rectangle; its outer corners run into the
two castellation linings at its end, which links the pad to its 0.35 mm
metallization. The linings sit inside the body outline, so the model is
3.2 x 1.5 x 0.9.

Coordinates: mm, body centred on the origin, length along X, seating plane
z = 0, Z up. Terminal #1 at -X, #2 at +X (the bottom view is a third-angle
projection about X, so X is kept). The crystal is non-polar.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import build123d as bd  # noqa: E402

from partkit import GeneratedPart, block  # noqa: E402

PART = "epson-fc-135-32k768-12p5"

BODY_X, BODY_Y, BODY_Z = 3.2, 1.5, 0.9
PAD_X, PAD_Y = 0.65, 1.3
PAD_GAP = 1.7
PAD_T = 0.03  # assumed
END_SETBACK = 0.1
WRAP_Z = 0.35
BASE_TOP = 0.6  # assumed
LID_X, LID_Y, LID_R = 2.7, 1.1, 0.15  # assumed
CASTELLATION_R = 0.2  # assumed
LINING_T = 0.02  # assumed

PAD_CX = PAD_GAP / 2 + PAD_X / 2  # 1.175
assert abs(BODY_X / 2 - (PAD_CX + PAD_X / 2) - END_SETBACK) < 1e-9  # 1.7 + 2 x 0.65 + 2 x 0.1 = 3.2
PINS = {1: -1, 2: 1}


def base():
    """Ceramic base with a castellation at each corner."""
    b = block(0, 0, PAD_T, BODY_X, BODY_Y, BASE_TOP - PAD_T)
    for sx in (-1, 1):
        for sy in (-1, 1):
            cut = bd.Pos(sx * BODY_X / 2, sy * BODY_Y / 2, PAD_T) * bd.Cylinder(
                CASTELLATION_R, BASE_TOP - PAD_T, align=(bd.Align.CENTER, bd.Align.CENTER, bd.Align.MIN)
            )
            b = b.cut(cut)
    return b


def lid():
    with bd.BuildPart() as p:
        with bd.Locations(bd.Pos(0, 0, BASE_TOP)):
            bd.Box(LID_X, LID_Y, BODY_Z - BASE_TOP, align=(bd.Align.CENTER, bd.Align.CENTER, bd.Align.MIN))
        bd.fillet(p.edges().filter_by(bd.Axis.Z), LID_R)
    return p.part


def lining(sx: int, sy: int):
    """Metallization lining one corner castellation, 0.35 high from the seating plane."""
    with bd.BuildPart() as p:
        with bd.Locations(bd.Pos(sx * BODY_X / 2, sy * BODY_Y / 2, 0)):
            bd.Cylinder(CASTELLATION_R, WRAP_Z, align=(bd.Align.CENTER, bd.Align.CENTER, bd.Align.MIN))
            bd.Cylinder(CASTELLATION_R - LINING_T, WRAP_Z, align=(bd.Align.CENTER, bd.Align.CENTER, bd.Align.MIN), mode=bd.Mode.SUBTRACT)
        bd.Box(BODY_X, BODY_Y, WRAP_Z, align=(bd.Align.CENTER, bd.Align.CENTER, bd.Align.MIN), mode=bd.Mode.INTERSECT)
    return p.part


def terminal(side: int):
    """Bottom pad and the two corner castellation linings at its end; the middle of the end face stays bare."""
    pad = block(side * PAD_CX, 0, 0, PAD_X, PAD_Y, PAD_T)
    whole = pad
    for sy in (-1, 1):
        whole = whole.fuse(lining(side, sy))
    return pad, whole


def pad_bottom(pad) -> list:
    return [f for f in pad.faces() if f.geom_type == bd.GeomType.PLANE and f.normal_at().Z < -0.99 and abs(f.center().Z) < 1e-6]


def build() -> None:
    a = GeneratedPart(PART, "epson-fc-135-32k768-12p5-smd3215", __file__)
    b = base()
    a.body(b, "ceramic_base")
    top = lid()
    a.body(top, "lid")
    a.feature("package_top", [f for f in top.faces() if f.geom_type == bd.GeomType.PLANE and f.normal_at().Z > 0.99 and abs(f.center().Z - BODY_Z) < 1e-6])
    feet = []
    for n, side in PINS.items():
        pad, whole = terminal(side)
        a.body(whole, f"terminal_{n}")
        faces = pad_bottom(pad)
        feet += faces
        a.feature(f"pin_{n}", faces)
    a.feature("pcb_mount", feet)
    a.write()


if __name__ == "__main__":
    build()
