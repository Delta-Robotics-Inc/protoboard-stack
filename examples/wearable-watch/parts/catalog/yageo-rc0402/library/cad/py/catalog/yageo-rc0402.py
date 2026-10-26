"""Yageo RC0402 thick-film chip resistor (RC_L series, 0402 / 1005 metric) — representative package geometry.

No manufacturer CAD is published for the RC series; the chip is generated from
Table 1 of the RC_L data sheet (Product specification V.14, 2025-11-14):

  L  1.00 +/- 0.05     W  0.50 +/- 0.05     H  0.35 +/- 0.05
  I1 0.20 +/- 0.10 (top termination length)
  I2 0.25 +/- 0.10 (bottom termination length)  -> CAP 0.25

Assumed (recorded as an assumption trait on the part): each termination is
one block I2 long over the full width and height (the drawing's top length
I1 is 0.05 shorter, and the overcoat and marking layer are not modelled).

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

PART = "yageo-rc0402"
LENGTH, WIDTH, HEIGHT, CAP = 1.00, 0.50, 0.35, 0.25


def build() -> None:
    chip_two_terminal(PART, "yageo-rc0402", __file__, LENGTH, WIDTH, HEIGHT, CAP, core_label="ceramic_substrate")


if __name__ == "__main__":
    build()
