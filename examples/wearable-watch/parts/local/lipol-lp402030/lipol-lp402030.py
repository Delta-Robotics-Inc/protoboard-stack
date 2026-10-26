"""LiPol Battery LP402030 200 mAh LiPo with PCM and leads: representative geometry.

LiPol publishes no CAD for the LP402030 (no 3D link on the product page or in
the datasheet; sources.json src_product), so the body is generated from the
datasheet drawing (src_datasheet, drawing FD_2030_40, orig. 28.06.2021):

  thickness 4.0 +-0.3, width 20 +-0.5, length 30 +-1.0 mm; the 30 mm length
  runs to the end of the folded PCM zone ("PCM (3.2mm)"); two AWG30 UL1007
  leads, red (+) and black (-), 50 +-3 mm beyond the body end, ends stripped.

Coordinates: body centred on the origin in X and Y, bottom face at z = 0,
length along X with the PCM end at +X, leads leaving the PCM end face along
+X. Seen from +Z (the face with the '-' and '+' tab marks), the '+' side edge
is at +Y: the drawing's tab-side view has the PCM at the bottom and '+' to
the right, and both leads leave next to the '+' side edge, red outermost (the
assembled isometric view).

Assumptions (also `assumption` traits on the part), because the drawing is not
to scale and does not dimension them:
  - PCM zone 3.2 mm deep along X (the item-20 label), full width and height;
  - lead centres at mid-thickness (z = 2.0), red (+) at y = +9.0 and
    black (-) at y = +6.8;
  - lead insulation O1.1 mm and conductor O0.30 mm (third-party UL1007 30 AWG
    tables: src_wire_wontex 1.09 +-0.08 / 0.30 mm, src_wire_cnctech 1.13 mm);
  - installed state (wearable watch): leads drawn as 1 mm stubs out of the
    PCM end (1 mm); the supplied 50 mm leads continue as the project's harness.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "cadkit"))

from build123d import BuildPart, Cylinder, Locations, Pos, Rot  # noqa: E402

from partkit import MIN, GeneratedPart, block  # noqa: E402

PART_ID = "lipol-lp402030"

LENGTH, WIDTH, THICK = 30.0, 20.0, 4.0  # drawing: 30 +-1.0, 20 +-0.5, 4.0 +-0.3
PCM_DEPTH = 3.2  # item 20 "PCM (3.2mm)"; assumption: depth along X, full width and height
LEAD_L = 50.0  # drawing: 50 +-3.0 beyond the body end
STRIP_L = 2.0  # assumption: drawn stripped, not dimensioned
LEAD_OD, CU_D = 1.1, 0.30  # assumption from UL1007 30 AWG tables (src_wire_wontex, src_wire_cnctech)
Y_RED, Y_BLACK, LEAD_Z = 9.0, 6.8, THICK / 2  # assumption: read from the views, not dimensioned

END_X = LENGTH / 2  # PCM end face
CELL_END = END_X - PCM_DEPTH
# Installed state in the wearable watch: only the first STUB_L of each lead is
# part of the cell's body; the rest, cut to length and soldered to the board,
# is the project's harness watch-battery-leads (routed by ext-harness-cad). The
# lead_pos / lead_neg features are the last 0.5 mm of the stub, where the
# harness continues. LEAD_L stays the supplied length (the part's facts).
STUB_L = 1.0
STRIP_L = 0.5
LEAD_END = END_X + STUB_L  # 16.0
STRIP_START = LEAD_END - STRIP_L


def wire(y: float, x0: float, x1: float, d: float):
    """A round wire along +X from x0 to x1 at (y, LEAD_Z)."""
    with BuildPart() as w:
        with Locations(Pos(x0, y, LEAD_Z) * Rot(0, 90, 0)):
            Cylinder(d / 2, x1 - x0, align=MIN)
    return w.part


def build() -> None:
    a = GeneratedPart(PART_ID, "lipol-lp402030", __file__)

    cell = block((-END_X + CELL_END) / 2, 0, 0, CELL_END + END_X, WIDTH, THICK)  # pouch cell
    pcm = block((CELL_END + END_X) / 2, 0, 0, PCM_DEPTH, WIDTH, THICK)  # folded PCM under kapton tape

    red = wire(Y_RED, END_X, STRIP_START, LEAD_OD)
    black = wire(Y_BLACK, END_X, STRIP_START, LEAD_OD)
    red_tin = wire(Y_RED, STRIP_START, LEAD_END, CU_D)
    black_tin = wire(Y_BLACK, STRIP_START, LEAD_END, CU_D)

    a.body(cell, "pouch_cell")
    a.body(pcm, "pcm_zone")
    a.body(red, "lead_red")
    a.body(black, "lead_black")
    a.body(red_tin, "lead_red_stripped")
    a.body(black_tin, "lead_black_stripped")

    def bottom(shape):
        return [f for f in shape.faces() if f.geom_type.name == "PLANE" and f.normal_at().Z < -0.9]

    # bottom face of cell and PCM zone: seated in the case pocket (normal -Z)
    a.feature("mount_face", bottom(cell) + bottom(pcm))
    # stripped lead ends: where the harness or board pads are soldered
    a.feature("lead_pos", [f for f in red_tin.faces() if f.geom_type.name == "CYLINDER"], axis=(1, 0, 0))
    a.feature("lead_neg", [f for f in black_tin.faces() if f.geom_type.name == "CYLINDER"], axis=(1, 0, 0))
    a.write()


if __name__ == "__main__":
    build()
