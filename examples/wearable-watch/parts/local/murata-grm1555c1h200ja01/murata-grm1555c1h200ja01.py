"""Murata GRM1555C1H200JA01D (1005M / 0402, C0G, 20 pF, DC 50 V): representative chip geometry.

Murata's reference sheet links no 3D model, so the chip is generated from its
Type & Dimension table (GRM1555C1H200JA01-01A, specifications as of
2026-06-13; parts/evidence/murata-grm1555c1h200ja01/sources.json):

  L 1.0 +/- 0.05     W 0.5 +/- 0.05     T 0.5 +/- 0.05
  e 0.15 to 0.35 (termination length)   -> 0.25 (middle of the range)
  g 0.3 min (gap between terminations)  -> 1.0 - 2 x 0.25 = 0.5

Assumed (also an `assumption` trait on the part): each termination is one
block at the middle of the e range over the full width and height.

Coordinates: mm, chip centred on the origin, seating plane z = 0, length
along X. pin_1 is the -X termination, pin_2 the +X one; the chip has no
polarity and Murata numbers neither end.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "cadkit"))

import build123d as bd  # noqa: E402

from partkit import GeneratedPart, block  # noqa: E402

PART = "murata-grm1555c1h200ja01"
L, W, T, E = 1.0, 0.5, 0.5, 0.25


def bottom(shape) -> list:
    return [f for f in shape.faces() if f.geom_type == bd.GeomType.PLANE and f.normal_at().Z < -0.99 and abs(f.center().Z) < 1e-6]


def build() -> None:
    a = GeneratedPart(PART, PART, __file__)
    core = block(0, 0, 0, L - 2 * E, W, T)
    t1 = block(-(L - E) / 2, 0, 0, E, W, T)
    t2 = block((L - E) / 2, 0, 0, E, W, T)
    a.body(core, "ceramic_body")
    a.body(t1, "termination_1")
    a.body(t2, "termination_2")
    a.feature("pin_1", bottom(t1))
    a.feature("pin_2", bottom(t2))
    a.feature("pcb_mount", bottom(t1) + bottom(t2))
    a.write()


if __name__ == "__main__":
    build()
