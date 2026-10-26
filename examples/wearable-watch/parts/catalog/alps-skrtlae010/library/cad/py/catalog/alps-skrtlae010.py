"""Alps Alpine SKRTLAE010 side-push TACT switch — representative geometry (PB-796).

Alps publishes a STEP (SKRTLA.STEP in product_3dcad_skrtlae010_en_*.zip) but
states no licence for it, so it is not redistributed. The body is generated
from the catalog drawing (SKRT series, Drawing No.1, update 2510):

  width                                   4.5
  height above the mounting face          3.3
  stem                                    dia 2, axis 1.7 above the mounting face
  depth                                   0.84 stem beyond the front frame face + 2.56 body = 3.4
  guide bosses (2)                        0.7 +- 0.05 wide, 0.45 below the mounting face,
                                          4.25 apart, 2.05 +- 0.1 behind the stem tip
  fixing legs (2)                         0.8 +- 0.1 wide, at the front corners
  terminals 1 / 2 / 3                     0.65 / 0.5 / 0.65 wide, 3.0 across the outside of 1 and 3

The drawing does not place the terminals along the depth, or give the boss
and leg thickness. Those come from measuring the vendor STEP (evidence only):
bosses and legs 0.21 thick, leg x 1.45-2.25, terminal feet 1.34-2.67 behind
the frame face (terminal 2 from 1.54), body underside 0.05 above the
terminal undersides.

Assumed (neither source gives them): terminal feet 0.15 thick and flat on
the mounting face, legs 0.8 tall and their undersides on the mounting face
(the STEP has them 0.05 lower), the housing a plain 4.5 x 2.56 box. Recorded
as assumption traits on the part.

Coordinates: mm. Z up, z = 0 the mounting face (terminal undersides);
y = 0 the front frame face, the stem pointing to -Y (the press direction is
+Y); x across the switch, terminal 1 at -X (the left looking at the stem,
from the drawing's bottom view).
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import build123d as bd  # noqa: E402
from build123d import Align, BuildPart, Cylinder, Locations  # noqa: E402

from partkit import GeneratedPart, block  # noqa: E402

PART = "alps-skrtlae010"

WIDTH, DEPTH, HEIGHT = 4.5, 2.56, 3.3
BODY_Z0 = 0.05
STEM_D, STEM_Z, STEM_LEN = 2.0, 1.7, 0.84
BOSS_X, BOSS_Y, BOSS_W, BOSS_T, BOSS_DROP = 2.125, 2.05 - 0.84, 0.7, 0.21, 0.45
LEG_X0, LEG_X1, LEG_T, LEG_H = 1.45, 2.25, 0.21, 0.8
TERM_T = 0.15
# terminal: (x min, x max, y min, y max)
TERMINALS = {
    1: (-1.5, -0.86, 1.34, 2.67),
    2: (-0.25, 0.25, 1.54, 2.67),
    3: (0.86, 1.5, 1.34, 2.67),
}


def faces_along(shape, normal, at: float, axis: str) -> list:
    """Planar faces of `shape` facing `normal` whose centre lies at `at` on `axis`."""
    n = bd.Vector(*normal)
    return [
        f
        for f in shape.faces()
        if f.geom_type == bd.GeomType.PLANE and f.normal_at().dot(n) > 0.99 and abs(getattr(f.center(), axis) - at) < 1e-6
    ]


def stem():
    """The dia 2 stem on an axis along Y, from the frame face out to the tip at y = -0.84."""
    with BuildPart() as s:
        with Locations(bd.Location((0, 0, STEM_Z), (90, 0, 0))):  # cylinder axis Z -> -Y
            Cylinder(STEM_D / 2, STEM_LEN, align=(Align.CENTER, Align.CENTER, Align.MIN))
    return s.part


def build() -> None:
    a = GeneratedPart(PART, "alps-skrtlae010", __file__)
    housing = block(0, DEPTH / 2, BODY_Z0, WIDTH, DEPTH, HEIGHT - BODY_Z0)
    a.body(housing, "housing")

    st = stem()
    a.body(st, "stem")
    a.feature("stem_tip", faces_along(st, (0, -1, 0), -STEM_LEN, "Y"))

    bosses, legs = [], []
    for side, label in ((-1, "left"), (1, "right")):
        boss = block(side * BOSS_X, BOSS_Y, -BOSS_DROP, BOSS_T, BOSS_W, BOSS_DROP + BODY_Z0)
        a.body(boss, f"guide_boss_{label}")
        bosses += faces_along(boss, (0, 0, -1), -BOSS_DROP, "Z")
        leg = block(side * (LEG_X0 + LEG_X1) / 2, LEG_T / 2, 0, LEG_X1 - LEG_X0, LEG_T, LEG_H)
        a.body(leg, f"fixing_leg_{label}")
        legs += faces_along(leg, (0, 0, -1), 0, "Z")
    a.feature("guide_bosses", bosses)
    a.feature("fixing_legs", legs)

    for n, (x0, x1, y0, y1) in TERMINALS.items():
        t = block((x0 + x1) / 2, (y0 + y1) / 2, 0, x1 - x0, y1 - y0, TERM_T)
        a.body(t, f"terminal_{n}")
        a.feature(f"pin_{n}", faces_along(t, (0, 0, -1), 0, "Z"))
    a.write()


if __name__ == "__main__":
    build()
