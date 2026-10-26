"""Coilcraft XFL4020-152ME 1.5 uH power inductor (4 x 4 x 2.1 mm) — representative package geometry.

No redistributable manufacturer CAD was found: Coilcraft's models are served
through partner libraries for design use only (see .research/gaps.json), so
the package is generated from the drawing in Coilcraft Document 745-3
(XFL4020 data sheet, revised 03/10/26):

  body length (X) and width (Y)      4.0 +/- 0.3 each   -> 4.0 x 4.0
  height                             2.10 max           -> 2.10 (modelled at the maximum)
  terminal width (X), each           0.82 +/- 0.05      -> 0.82
  gap between terminal inner edges   1.57 +/- 0.25      -> 1.57
  terminal length (Y)                3.25 typ           -> 3.25
  terminal thickness, -152           0.10 typ           -> 0.10 (below the moulded body)
  top marking bar                    "indicates direction of terminals and
                                     start (short) lead"; drawn parallel to
                                     the terminals near one edge

Assumed (drawn but not dimensioned; recorded as an assumption trait on the
part): body corner radius 0.2; terminals centred on the body in Y and placed
symmetrically in X (outer edges 0.395 in from the body ends, from
(4.0 - 2 x 0.82 - 1.57) / 2); marking bar 0.15 wide x 2.4 long, 0.5 in from
the start-lead end, recessed 0.02 into the top face so the model stays
inside 2.10.

Coordinates: mm, body centred on the origin, seating plane z = 0 (terminal
bottoms), Z up. Terminals run along Y. Pin 1 is the start (short) lead
terminal at -X, under the marking bar; pin 2 at +X. Coilcraft does not
number the terminals; the designators are this model's.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import build123d as bd  # noqa: E402

from partkit import GeneratedPart, block  # noqa: E402

PART = "coilcraft-xfl4020-152me"

BODY_X, BODY_Y, BODY_Z = 4.0, 4.0, 2.10
TERM_X, TERM_Y, TERM_T = 0.82, 3.25, 0.10
TERM_GAP = 1.57
CORNER_R = 0.2  # assumed
BAR_W, BAR_L, BAR_INSET, BAR_DEPTH = 0.15, 2.4, 0.5, 0.02  # assumed

TERM_CX = TERM_GAP / 2 + TERM_X / 2  # 1.195; centre-to-centre 2.39
END_SETBACK = BODY_X / 2 - (TERM_CX + TERM_X / 2)  # 0.395
assert abs(END_SETBACK - 0.395) < 1e-9
PINS = {1: -1, 2: 1}  # pin 1 = start (short) lead, under the marking bar


def body():
    """Moulded composite body above the terminals, with the start-lead marking bar recessed into the top."""
    with bd.BuildPart() as p:
        with bd.Locations(bd.Pos(0, 0, TERM_T)):
            bd.Box(BODY_X, BODY_Y, BODY_Z - TERM_T, align=(bd.Align.CENTER, bd.Align.CENTER, bd.Align.MIN))
        bd.fillet(p.edges().filter_by(bd.Axis.Z), CORNER_R)
        bar_x = PINS[1] * (BODY_X / 2 - BAR_INSET)
        with bd.Locations(bd.Pos(bar_x, 0, BODY_Z - BAR_DEPTH)):
            bd.Box(BAR_W, BAR_L, BAR_DEPTH, align=(bd.Align.CENTER, bd.Align.CENTER, bd.Align.MIN), mode=bd.Mode.SUBTRACT)
    return p.part


def planar(shape, z: float, up: bool) -> list:
    sign = 1 if up else -1
    return [f for f in shape.faces() if f.geom_type == bd.GeomType.PLANE and f.normal_at().Z * sign > 0.99 and abs(f.center().Z - z) < 1e-6]


def build() -> None:
    a = GeneratedPart(PART, "coilcraft-xfl4020-152me-4x4", __file__)
    b = body()
    a.body(b, "moulded_body")
    a.feature("package_top", planar(b, BODY_Z, up=True))
    bar_floor = [f for f in planar(b, BODY_Z - BAR_DEPTH, up=True)]
    a.feature("start_mark", bar_floor)
    feet = []
    for n, side in PINS.items():
        t = block(side * TERM_CX, 0, 0, TERM_X, TERM_Y, TERM_T)
        a.body(t, f"terminal_{n}")
        faces = planar(t, 0.0, up=False)
        feet += faces
        a.feature(f"pin_{n}", faces)
    a.feature("pcb_mount", feet)
    a.write()


if __name__ == "__main__":
    build()
