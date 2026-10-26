"""Espressif ESP32-C3-MINI-1-H4X (PCB antenna): representative module body.

Espressif links a STEP from the datasheet (§11.1) and the product page
(ESP32-C3-MINI-1_20210903_0.STEP), but states no licence for it, and the
datasheet's copyright notice grants none, so it is not redistributed. It was
used only to measure the pad centres (see
library/parts/espressif-esp32-c3-mini-1-h4x/.research/gaps.json).

Dimensions (ESP32-C3-MINI-1 & MINI-1U datasheet v2.2):
  module 13.2 (x) x 16.6 (y) x 2.4 mm, PCB 0.8 mm      Figure 10-1
  shield 11.95 x 9.95 mm, 0.62 mm from the right and
  pad-end edges, top at 2.4 mm                         Figure 10-1 top view
  antenna area: the PCB beyond 11.2 mm from the
  pad-end edge                                         Figure 10-1 bottom view, Figure 11-1
  48 pads 0.4 x 0.8 mm at 0.8 mm pitch, 4 corner pads
  0.7 x 0.7 mm, centre pad 5.4 x 5.4 mm of 9 squares
  1.45 mm with the pin-1 corner chamfered 0.6 mm       Figure 10-1 bottom view, Figure 11-1
  pad centres (below)                                   measured in the STEP's solder_pad component;
                                                        they agree with the 12.6 x 10.6 mm pad field
                                                        and 5.4 mm centre pad of Figure 10-1
Assumptions (also `assumption` traits on the part):
  - pads are drawn 0.02 mm thick inside the PCB so their faces lie on the
    seating plane (the drawing gives no plating thickness; the STEP uses 0.035);
  - the PCB antenna is the top face of the antenna area (no trace modelled);
  - the shield's Ø0.5 marking and the SMD parts under it are not modelled.

Coordinates: module centred on the origin, pad (seating) plane z = 0, top of
the shield at z = 2.4, x along the 13.2 mm width, y along the 16.6 mm length
with the antenna at +y. Seen from +z this is Espressif's Figure 3-1 top view
(pin 1 at the upper left of the left column). The STEP's origin is the lower
left corner of the pad end, so a STEP point maps to (x - 6.6, y - 8.3).
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import build123d as bd  # noqa: E402

from partkit import GeneratedPart, block  # noqa: E402

PART = "espressif-esp32-c3-mini-1-h4x"
W, L, H = 13.2, 16.6, 2.4
PCB_T = 0.8
SHIELD_W, SHIELD_L, SHIELD_EDGE = 11.95, 9.95, 0.62
ANT_Y0 = 11.2  # antenna area starts 11.2 mm from the pad-end edge
PAD_LONG, PAD_SHORT, CORNER, EP_SQ, EP_CHAMFER = 0.8, 0.4, 0.7, 1.45, 0.6
PAD_T = 0.02  # assumption: plating thickness not dimensioned
PITCH = 0.8

# pin -> (x, y, orientation) in the STEP's corner-origin top-view coordinates.
# "h" = 0.8 mm along x (side columns), "v" = 0.8 mm along y (top and bottom rows), "c" = 0.7 mm corner pad
PADS: dict[int, tuple[float, float, str]] = {}
for n in range(1, 12):  # left column, top to bottom
    PADS[n] = (0.7, 9.6 - PITCH * (n - 1), "h")
for n in range(12, 25):  # bottom row, left to right
    PADS[n] = (1.8 + PITCH * (n - 12), 0.7, "v")
for n in range(25, 36):  # right column, bottom to top
    PADS[n] = (12.5, 1.6 + PITCH * (n - 25), "h")
for n in range(36, 49):  # top row, right to left
    PADS[n] = (11.4 - PITCH * (n - 36), 10.5, "v")
PADS[50] = (12.55, 10.55, "c")  # top right
PADS[51] = (12.55, 0.65, "c")  # bottom right
PADS[52] = (0.65, 0.65, "c")  # bottom left
PADS[53] = (0.65, 10.55, "c")  # top left
# pin 49: the 3 x 3 centre pad; the square at the upper left carries the chamfer
EP_X, EP_Y = (4.625, 6.6, 8.575), (3.625, 5.6, 7.575)
assert sorted(PADS) == [n for n in range(1, 54) if n != 49], "52 perimeter pads plus pin 49"


def at(x: float, y: float) -> tuple[float, float]:
    return x - W / 2, y - L / 2


def bottom(shape) -> list:
    return [f for f in shape.faces() if f.geom_type == bd.GeomType.PLANE and f.normal_at().Z < -0.99 and abs(f.center().Z) < 1e-6]


def top(shape) -> list:
    zmax = shape.bounding_box().max.Z
    return [f for f in shape.faces() if f.geom_type == bd.GeomType.PLANE and f.normal_at().Z > 0.99 and abs(f.center().Z - zmax) < 1e-6]


def chamfered_square(x: float, y: float) -> bd.Part:
    """A 1.45 mm square with its upper-left corner cut 0.6 mm (the pin-1 mark of the centre pad)."""
    h, c = EP_SQ / 2, EP_CHAMFER
    pts = [(-h, -h), (h, -h), (h, h), (-h + c, h), (-h, h - c)]
    with bd.BuildPart() as p:
        with bd.BuildSketch(bd.Plane.XY.offset(0)):
            with bd.Locations((x, y)):
                bd.Polygon(*pts, align=None)
        bd.extrude(amount=PAD_T)
    return p.part


def build() -> None:
    a = GeneratedPart(PART, PART, __file__)
    pcb = block(0, at(0, ANT_Y0 / 2)[1], 0, W, ANT_Y0, PCB_T)
    antenna = block(0, at(0, (ANT_Y0 + L) / 2)[1], 0, W, L - ANT_Y0, PCB_T)
    sx, sy = at(W - SHIELD_EDGE - SHIELD_W / 2, SHIELD_EDGE + SHIELD_L / 2)
    shield = block(sx, sy, PCB_T, SHIELD_W, SHIELD_L, H - PCB_T)
    a.body(pcb, "pcb")
    a.body(antenna, "pcb_antenna_area")
    a.body(shield, "shield")

    # one body for the pads; one feature per pad (pin 49: its nine squares),
    # so each pin leaf binds its own pad
    pads = None
    for n in sorted([*PADS, 49]):
        if n == 49:
            parts = []
            for j, y in enumerate(EP_Y):
                for i, x in enumerate(EP_X):
                    cx, cy = at(x, y)
                    parts.append(chamfered_square(cx, cy) if (i, j) == (0, 2) else block(cx, cy, 0, EP_SQ, EP_SQ, PAD_T))
            pad = parts[0]
            for p in parts[1:]:
                pad = pad.fuse(p)
        else:
            x, y, o = PADS[n]
            lx, ly = {"h": (PAD_LONG, PAD_SHORT), "v": (PAD_SHORT, PAD_LONG), "c": (CORNER, CORNER)}[o]
            pad = block(*at(x, y), 0, lx, ly, PAD_T)
        a.feature(f"pin_{n}", bottom(pad))
        pads = pad if pads is None else pads.fuse(pad)
    a.body(pads, "pads")
    # pcb_mount: the module underside (seating plane), not the pad faces again
    a.feature("pcb_mount", bottom(pcb) + bottom(antenna))
    a.feature("antenna", top(antenna))
    a.write()


if __name__ == "__main__":
    build()
