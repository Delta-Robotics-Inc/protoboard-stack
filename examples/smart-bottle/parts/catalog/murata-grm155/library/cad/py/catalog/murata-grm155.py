"""Murata GRM155 multilayer ceramic chip capacitor (1005M / 0402, T 0.5 mm) — representative package geometry.

Generated from the Type & Dimension table of the default instance's
reference sheet, GRM155R71C104KA88-01A (product specifications as of
2026-06-17), which the other GRM155 sheets cited by the part repeat:

  L 1.0 +/- 0.05     W 0.5 +/- 0.05     T 0.5 +/- 0.05
  e 0.15 to 0.35 (termination length)   -> CAP 0.25 (mid-range)
  g 0.3 min (gap between terminations)  -> 1.0 - 2 x 0.25 = 0.5

Assumed (recorded as an assumption trait on the part): the termination is
one block at the middle of the e range over the full width and height.
Thicker or looser-tolerance GRM155 parts (GRM155R60J106ME15: +/-0.15) keep
this nominal body.

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

PART = "murata-grm155"
LENGTH, WIDTH, HEIGHT, CAP = 1.0, 0.5, 0.5, 0.25


def build() -> None:
    chip_two_terminal(PART, "murata-grm155-1005", __file__, LENGTH, WIDTH, HEIGHT, CAP, core_label="ceramic_body")


if __name__ == "__main__":
    build()
