"""Raytac MDBT50Q-1MV2 (nRF52840 module, chip antenna): representative body.

Raytac's design-guide archive (MDBT50Q & MDBT50Q-P & MDBT50Q-U
Footprint_Design Guide 230606) has a STEP, but no licence is stated, so it is
not redistributed; it is a single envelope solid without pads and was used
only to measure (see library/parts/raytac-mdbt50q-1mv2/.research/gaps.json).

Dimensions:
  module 10.5 (x) x 15.5 (y) x 2.05 mm             approval sheet Ver. L §2.1
  shield 9.7 x 11.1 mm, top at 2.0 mm              2D drawing MDBT50Q_v1.1-230606
  PCB 0.8 mm (shield 1.2 mm, antenna 1.25 mm high) STEP 'MDBT50Q 3D Drawing_20180620'
  antenna chip 8.0 x 1.0 mm at x 1.618-9.618, 0.617-1.617 mm from the
  antenna-end edge                                 STEP (agrees with §2.1 top view)
  61 pads 0.6 x 0.4 mm at the centres below        §2.2 recommended solder pad layout
Assumptions (also `assumption` traits on the part):
  - module pads are the 0.6 x 0.4 mm recommended pads at the same centres,
    drawn 0.02 mm thick inside the PCB so their faces lie on the seating plane;
  - shield centred in x, 0.4 mm from the pad edge (measured off the §2.1
    Ver. L top view; the drawing does not dimension the offset);
  - the 1.9 x 0.5 mm slot through the PCB (STEP) is not modelled.

Coordinates: module centred on the origin, pad (seating) plane z = 0, top of
the antenna at z = 2.05, x along the 10.5 mm width, y along the 15.5 mm length
with the antenna at +y. Viewed from the top (+z) this is Raytac's §2.1 top
view. Raytac's pad table origin (lower-left corner, pad edge at y = 0) maps to
(x - 5.25, y - 7.75).
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import build123d as bd  # noqa: E402

from partkit import GeneratedPart, block  # noqa: E402

PART = "raytac-mdbt50q-1mv2"
W, L, H = 10.5, 15.5, 2.05
PCB_T = 0.8
SHIELD_W, SHIELD_L, SHIELD_TOP = 9.7, 11.1, 2.0
SHIELD_Y0 = 0.4  # assumption: offset from the pad edge, measured off the drawing
ANT_X0, ANT_X1, ANT_Y0, ANT_Y1 = 1.618, 9.618, L - 1.617, L - 0.617
PAD_LONG, PAD_SHORT, PAD_T = 0.6, 0.4, 0.02

# pin -> (x, y) in Raytac's §2.2 top-view coordinates, and pad orientation:
# "h" = 0.6 mm along x (side columns), "v" = 0.6 mm along y (bottom and centre rows)
PADS: dict[int, tuple[float, float, str]] = {}
for n, y in {1: 11.5, 2: 10.4, 3: 9.6, 4: 8.0, 6: 7.2, 8: 6.4, 10: 5.6, 12: 4.8, 14: 4.0}.items():
    PADS[n] = (0.6, y, "h")
for n, y in {5: 7.6, 7: 6.8, 9: 6.0, 11: 5.2, 13: 4.4}.items():
    PADS[n] = (1.5, y, "h")
for n, x in {15: 0.45, 16: 1.25, 17: 2.05, 18: 2.85, 20: 3.65, 22: 4.45, 24: 5.25,
             26: 6.05, 28: 6.85, 30: 7.65, 31: 8.45, 32: 9.25, 33: 10.05}.items():
    PADS[n] = (x, 0.6, "v")
for n, x in {19: 3.25, 21: 4.05, 23: 4.85, 25: 5.65, 27: 6.45, 29: 7.25}.items():
    PADS[n] = (x, 1.5, "v")
for n, y in {34: 1.6, 35: 2.4, 37: 3.2, 39: 4.0, 41: 4.8, 44: 6.4, 46: 7.2, 48: 8.0,
             51: 9.6, 53: 10.4, 55: 11.5}.items():
    PADS[n] = (9.9, y, "h")
for n, y in {36: 2.8, 38: 3.6, 40: 4.4, 42: 5.2, 43: 6.0, 45: 6.8, 47: 7.6, 49: 8.4,
             50: 9.2, 52: 10.0, 54: 10.8}.items():
    PADS[n] = (9.0, y, "h")
for n, x in {56: 3.25, 57: 4.05, 58: 4.85, 59: 5.65, 60: 6.45, 61: 7.25}.items():
    PADS[n] = (x, 7.2, "v")
assert sorted(PADS) == list(range(1, 62)), "61 pads, numbered 1-61"


def bottom(shape) -> list:
    return [f for f in shape.faces() if f.geom_type == bd.GeomType.PLANE and f.normal_at().Z < -0.99 and abs(f.center().Z) < 1e-6]


def top(shape) -> list:
    zmax = shape.bounding_box().max.Z
    return [f for f in shape.faces() if f.geom_type == bd.GeomType.PLANE and f.normal_at().Z > 0.99 and abs(f.center().Z - zmax) < 1e-6]


def build() -> None:
    a = GeneratedPart(PART, "raytac-mdbt50q-1mv2", __file__)
    pcb = block(0, 0, 0, W, L, PCB_T)
    shield = block(0, SHIELD_Y0 + SHIELD_L / 2 - L / 2, PCB_T, SHIELD_W, SHIELD_L, SHIELD_TOP - PCB_T)
    antenna = block((ANT_X0 + ANT_X1) / 2 - W / 2, (ANT_Y0 + ANT_Y1) / 2 - L / 2, PCB_T,
                    ANT_X1 - ANT_X0, ANT_Y1 - ANT_Y0, H - PCB_T)
    a.body(pcb, "pcb")
    a.body(shield, "shield")
    a.body(antenna, "chip_antenna")

    # one body for the 61 pads (one solid per pad would triple the STEP); one
    # feature per pad, so each pin leaf binds its own pad
    pads = None
    for n, (x, y, o) in PADS.items():
        lx, ly = (PAD_LONG, PAD_SHORT) if o == "h" else (PAD_SHORT, PAD_LONG)
        pad = block(x - W / 2, y - L / 2, 0, lx, ly, PAD_T)
        a.feature(f"pin_{n}", bottom(pad))
        pads = pad if pads is None else pads.fuse(pad)
    a.body(pads, "pads")
    # pcb_mount: the module underside (seating plane), not the 61 pad faces again
    a.feature("pcb_mount", bottom(pcb))
    a.feature("antenna", top(antenna))
    a.write()


if __name__ == "__main__":
    build()
