"""EastRising ER-TFT1.28-1 (1.28-inch round TFT, 12-pin 0.7 mm hollow-out FPC): representative geometry.

No usable manufacturer CAD: the BuyDisplay product page lists no 3D model for
this panel, and the BuyDisplay model on GrabCAD states no licence and needs a
login (see parts/evidence/eastrising-er-tft128-1/.research/gaps.json).

Dimensions are from the ER-TFT1.28-1 datasheet §2.2 and §3.1 outline drawing
(current issue, drawing dated 2025-02-07, read as text; the 2019 issue read as
a rendered drawing):
  backlight (LCM) 35.60 (W) x 37.80 (H); active area dia 32.40, 1.60 from the
  backlight edges, so the backlight circle is dia 35.60 on the active-area
  centre and its tab ends 37.80 - 17.80 = 20.00 from it;
  LCD glass 35.2 x 37.24; polarizer 34.74 (W) x 34.32 (H); thickness 1.5 (§2.2);
  FPC 0.13 thick, tail 11.4 wide, 12 contacts 0.35 wide at 0.7 pitch (7.7 span)
  in a 2.00 window at the tail end (front view; the rear view gives 1.70, the
  window on the other side of the tail), 2 x dia 1.0 alignment holes 10.00
  apart, the pin-12 hole centre 1.00 in from the pin-12 side edge of the tail
  (a sideways dimension); folded, the tail end sits 10.24 in from the outer
  edge and the fold stands at most 0.50 proud of the backlight frame.

Assumptions (also `assumption` traits on the part):
  - layer split: backlight 0.80, glass 0.60, polarizer 0.10 (only the 1.5
    total is given);
  - hole position along the tail: centres 4.0 from the tail end, 2.0 beyond
    the 2.00 window. No dimension places them along the tail, so this is
    scaled from the 2019 drawing rendered at 1200 dpi. The drawing (marked
    not to scale) is stretched: 50.0 px/mm along the tail (from the 38.10,
    32.40 and 2.00 dimensions) and 45.6 px/mm across it (35.60, 32.40, 10.00,
    11.4). The hole centres sit 200 px from the tail end, so 4.0 mm; at the
    cross-tail scale they would read 4.4 mm (2.4 beyond the window);
  - tail widening on the pin-1 side: the drawn tail pad is 0.9 wider than the
    11.4 on the pin-1 side, from 3.8 in from the tail end to the end of the
    10.0 long pad, chamfered over 2.6..3.8 from the tail end (scaled). Without
    it the pin-1 hole (centre y = +5.30) would break through the 11.4 edge;
  - tab outline: flat end 14.0 wide, chamfered back to the circle at
    +-8.6 (scaled from the drawing; not dimensioned);
  - FPC neck 8.7 wide through the fold (scaled; the notches are not modelled);
  - polarizer concentric with the active area;
  - contacts drawn the full FPC thickness, flush with its rear face;
  - the FPC is modelled folded behind the backlight (the installed state; it
    ships unfolded), front side (the 2.00 window side) towards the board. The
    tail lies under the backlight, not recessed into it, and the fold stands
    the drawing's 0.50 maximum proud, so the body envelope is 38.30 (x) x
    35.60 x 1.63 (z -0.13..1.50). The §2.2 folded outline 37.80 x 35.60 x 1.5
    is the backlight outline and the stack thickness, and leaves out both. The
    backlight lead region (drawing note: H = 0.45 max) is not modelled.

Coordinates: active-area centre on the origin; x towards the FPC tab (H),
y across (W), pin 1 at +y; z = 0 is the backlight rear face, z = 1.5 the
viewing face (+z out of the screen). Installed state (wearable watch, see DROP
below): the FPC tail lies 4.65 mm behind the rear face, at z = -4.78 .. -4.65,
on the board behind the cell, with its contacts facing -z (towards the board).
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "cadkit"))

from build123d import (  # noqa: E402
    Axis,
    Box,
    BuildPart,
    BuildSketch,
    Circle,
    Cylinder,
    Ellipse,
    Locations,
    Mode,
    Polygon,
    Pos,
    add,
    extrude,
)

from partkit import GeneratedPart, cylinders  # noqa: E402

# datasheet §2.2 / §3.1
BL_D, BL_TAB_X = 35.60, 37.80 - 35.60 / 2  # backlight circle, tab end x = 20.00
GLASS_D, GLASS_TAB_X = 35.2, 37.24 - 35.2 / 2  # glass circle, tab end x = 19.64
POL_X, POL_Y = 34.32, 34.74  # polarizer (H along x, W along y)
FPC_T = 0.13  # overall thickness 1.5 (§2.2) = BL_T + GLASS_T + POL_T below
TAIL_W = 11.4
PITCH, N, PAD_W, WINDOW = 0.7, 12, 0.35, 2.00  # WINDOW: front-view (board-side) window; rear view 1.70
HOLE_D, HOLE_SPACING, HOLE_FROM_EDGE = 1.0, 10.00, 1.00  # HOLE_FROM_EDGE: pin-12 hole centre from the pin-12 side edge
FOLD_IN, FOLD_PROUD = 10.24, 0.50

# assumptions (see docstring)
BL_T, GLASS_T, POL_T = 0.80, 0.60, 0.10
TAB_END_HALF, TAB_ROOT_HALF = 7.0, 8.6
NECK_W = 8.7
WINDOW_HALF = 4.3
HOLE_FROM_END = 4.0  # scaled: hole centres from the tail end (2.0 beyond the window)
PAD_LEN, WIDEN, WIDEN_C0, WIDEN_C1 = 10.0, 0.9, 2.6, 3.8  # scaled: pin-1 side widening and its chamfer

# Installed state in the wearable watch (display / cell / board, open question
# OQ-W5): the tail does not fold flat behind the backlight but drops past the
# 4.0 mm cell to the board's rear face and runs inwards along it. DROP is the
# panel rear face to the FPC contact face: 0.25 foam tape + 4.0 cell + 0.53
# left for the cell to swell (13 % of its thickness; the watch's D-W15), less
# the 0.13 FPC. The tail's path length is kept: the shipped (unfolded) tail ends
# 12.24 beyond the backlight edge (§3.1), and in the flat-folded state the
# bridge (0.86) + fold (1.06) + tail (10.74) give the same 12.66 from the
# glass tab. Dropped, the vertical run is BL_T + 2 FPC_T + DROP, so the tail
# keeps 12.66 - 0.86 - (BL_T + 2 FPC_T + DROP) on the board. Assumption: square
# bends; the +-0.3 tail tolerance moves the contacts by as much.
DROP = 4.65
PATH = (FOLD_X_ := BL_TAB_X + FOLD_PROUD) - GLASS_TAB_X + (BL_T + 2 * FPC_T) + (FOLD_X_ - (BL_TAB_X - FOLD_IN))  # 12.66 folded
TAIL_RUN = PATH - (FOLD_X_ - GLASS_TAB_X) - (BL_T + 2 * FPC_T + DROP)
TAIL_END_X = FOLD_X_ - TAIL_RUN  # 14.41
WINDOW_X1 = TAIL_END_X + WINDOW  # 16.41
HOLE_X = TAIL_END_X + HOLE_FROM_END  # 18.41
HOLE_Y = (-TAIL_W / 2 + HOLE_FROM_EDGE + HOLE_SPACING, -TAIL_W / 2 + HOLE_FROM_EDGE)  # (+5.30 pin 1 side, -4.70 pin 12 side)
FOLD_X = BL_TAB_X + FOLD_PROUD  # 20.50, outer face of the fold

PIN_Y = {n: (N - 1) / 2 * PITCH - (n - 1) * PITCH for n in range(1, N + 1)}  # pin 1 at +3.85


def outline(d: float, tab_x: float, z0: float, t: float):
    """Round panel layer with its flat FPC tab, bottom at z0."""
    r = d / 2
    root_x = (r**2 - TAB_ROOT_HALF**2) ** 0.5
    with BuildPart() as p:
        with BuildSketch(Pos(0, 0, z0)):
            Circle(r)
            Polygon((0, TAB_ROOT_HALF), (root_x, TAB_ROOT_HALF), (tab_x, TAB_END_HALF),
                    (tab_x, -TAB_END_HALF), (root_x, -TAB_ROOT_HALF), (0, -TAB_ROOT_HALF), align=None)
        extrude(amount=t)
    return p.part


def build() -> None:
    a = GeneratedPart("eastrising-er-tft128-1", "eastrising-er-tft128-1", __file__)

    backlight = outline(BL_D, BL_TAB_X, 0, BL_T)
    glass = outline(GLASS_D, GLASS_TAB_X, BL_T, GLASS_T)
    with BuildPart() as pol:
        with BuildSketch(Pos(0, 0, BL_T + GLASS_T)):
            Ellipse(POL_X / 2, POL_Y / 2)
        extrude(amount=POL_T)

    # FPC: bridge off the glass tab, the drop past the cell, and the tail on the board
    with BuildPart() as fpc:
        with Locations(Pos((GLASS_TAB_X + FOLD_X) / 2, 0, BL_T + FPC_T / 2)):
            Box(FOLD_X - GLASS_TAB_X, NECK_W, FPC_T)  # bridge off the glass tab, z = BL_T .. BL_T + FPC_T
        with Locations(Pos(FOLD_X - FPC_T / 2, 0, (BL_T - DROP) / 2)):
            Box(FPC_T, NECK_W, BL_T + 2 * FPC_T + DROP)  # drop, z = -DROP - FPC_T .. BL_T + FPC_T
        e = TAIL_W / 2
        with BuildSketch(Pos(0, 0, -DROP - FPC_T)):  # tail, widened on the pin-1 side over the hole end of the pad
            # the 10.0 pad widening ends at the drop in the installed state (only 6.09 of tail lies on the board)
            pad_end = min(TAIL_END_X + PAD_LEN, FOLD_X - FPC_T)
            Polygon((TAIL_END_X, -e), (FOLD_X, -e), (FOLD_X, e), (pad_end, e),
                    (pad_end, e + WIDEN), (TAIL_END_X + WIDEN_C1, e + WIDEN),
                    (TAIL_END_X + WIDEN_C0, e), (TAIL_END_X, e), align=None)
        extrude(amount=FPC_T)
        with Locations(Pos((TAIL_END_X + WINDOW_X1) / 2, 0, -DROP - FPC_T / 2)):
            Box(WINDOW, 2 * WINDOW_HALF, FPC_T, mode=Mode.SUBTRACT)  # hollow-out window
        with Locations(*(Pos(HOLE_X, y, -DROP - FPC_T / 2) for y in HOLE_Y)):
            Cylinder(HOLE_D / 2, FPC_T, mode=Mode.SUBTRACT)

    pads = {}
    for n, y in PIN_Y.items():
        with BuildPart() as pad:
            with Locations(Pos((TAIL_END_X + WINDOW_X1) / 2, y, -DROP - FPC_T / 2)):
                Box(WINDOW, PAD_W, FPC_T)
        pads[n] = pad.part

    a.body(backlight, "backlight")
    a.body(glass, "lcd_glass")
    a.body(pol.part, "polarizer")
    a.body(fpc.part, "fpc")
    with BuildPart() as all_pads:
        for p in pads.values():
            add(p)
    a.body(all_pads.part, "fpc_contacts")

    def rear(shape):
        return shape.faces().filter_by(Axis.Z).sort_by(Axis.Z)[:1]

    # viewing face: the polarizer front face (normal +z)
    a.feature("display_face", pol.part.faces().filter_by(Axis.Z).sort_by(Axis.Z)[-1:])
    # FPC contact plane: the 12 contact faces towards the board (normal -z)
    a.feature("fpc_tail", [f for p in pads.values() for f in rear(p)])
    # FPC alignment holes (axis along z)
    a.feature("fpc_holes", cylinders(fpc.part, HOLE_D), axis=(0, 0, 1))
    for n, p in pads.items():
        a.feature(f"pin_{n}", rear(p))
    a.write()


if __name__ == "__main__":
    build()
