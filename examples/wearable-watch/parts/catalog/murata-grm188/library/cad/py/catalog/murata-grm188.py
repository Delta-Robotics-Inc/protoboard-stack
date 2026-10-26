"""Murata GRM188 multilayer ceramic chip capacitor (1608M / 0603, T 0.8 mm) — representative package geometry.

Generated from the Type & Dimensions table of the default instance's
reference sheet, GRM188R71C104KA01-01:

  L 1.6 +/- 0.1     W 0.8 +/- 0.1     T 0.8 +/- 0.1
  e 0.2 to 0.5 (termination length)     -> CAP 0.35 (mid-range)
  g 0.5 min (gap between terminations)  -> 1.6 - 2 x 0.35 = 0.9

Assumed (recorded as an assumption trait on the part): the termination is
one block at the middle of the e range over the full width and height.
GRM188 parts with wider tolerances (GRM188R61E106MA73: +/-0.2) keep this
nominal body.

Coordinates: mm, chip centred on the origin, seating plane z = 0, length
along X. Pin 1 is the -X termination, pin 2 the +X one; the chip has no
polarity and the manufacturer numbers neither end, so the designators are the
model's (the part's `pin_1` and `pin_2`). Geometry is written by
partkit.chip_two_terminal.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from partkit import chip_two_terminal  # noqa: E402

PART = "murata-grm188"
LENGTH, WIDTH, HEIGHT, CAP = 1.6, 0.8, 0.8, 0.35


def build() -> None:
    chip_two_terminal(PART, "murata-grm188-1608", __file__, LENGTH, WIDTH, HEIGHT, CAP, core_label="ceramic_body")


if __name__ == "__main__":
    build()
