# From the Protoboard parts library workspace (library/cad/py/catalog/lipol-lp503450.py, commit
# 9a80317). Changed in the smart-bottle project (2026-10-03): the leads are drawn as 2 mm stubs
# at the PCM end; their bent, cut-to-length run is the project's routed harness
# (src/harnesses: battery-leads). Runs with the copied helpers in parts/local/_cadkit:
#   PYTHON=<python with build123d> $PYTHON parts/local/lipol-lp503450/lipol-lp503450.py
"""LiPoly Batteries LP503450 1000 mAh LiPo with PCM and leads: representative geometry.

The maker publishes no drawing and no CAD for this cell (polybattery.com has a
specification table and a photo only; sources.json src_product,
src_product_photo), so the body is generated from the stated size and the
photo:

  5 x 34 x 50 mm ("Lipo Battery Dimension 5mm*34mm*50mm", src_product); the
  PCM is folded across one short end inside that outline, under kapton; two
  leads, red and black, leave the PCM end at the corner on the '+' side, ends
  stripped, no connector (src_product_photo).

Coordinates (as lipol-lp402030): body centred on the origin in X and Y,
bottom face at z = 0, length along X with the PCM end at +X, leads leaving the
PCM end face along +X. Seen from +Z (the labelled face), the '+' side edge is
at +Y.

Assumptions (also `assumption` traits on the part), because the maker does
not dimension them. The values come from LiPol Battery's drawing of its own
850 mAh LP503450 (src_ref_lipol_850, FD_3450_73), a different maker's cell of
the same size code, read from views that are not to scale:
  - the 50 mm length includes a PCM zone 5.0 mm deep along X, full width and
    height;
  - lead centres at mid-thickness (z = 2.5), red (+) at y = +15.5 and
    black (-) at y = +13.0;
  - leads 50 mm beyond the body end (drawing 50 +-3.0), straight, stripped
    2.0 mm at the end;
  - AWG28 UL1571 leads: insulation O0.90 mm, conductor O0.38 mm (7/0.127
    stranded, src_wire_xinya; src_wire_ess gives O0.60 mm for a thin-wall
    build).
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "_cadkit"))

from build123d import BuildPart, Cylinder, Locations, Pos, Rot  # noqa: E402

from partkit import MIN, GeneratedPart, block  # noqa: E402

PART_ID = "lipol-lp503450"

LENGTH, WIDTH, THICK = 50.0, 34.0, 5.0  # src_product: 5mm*34mm*50mm
PCM_DEPTH = 5.0  # assumption: read from src_ref_lipol_850 tab-side view; full width and height
LEAD_L = 50.0  # assumption: src_ref_lipol_850 50 +-3.0 beyond the body end (the harness carries it)
STUB_L = 2.0  # assumption (smart-bottle): drawn stub of each lead; the rest bends and is the harness
STRIP_L = 2.0  # assumption: drawn stripped, not dimensioned
LEAD_OD, CU_D = 0.90, 0.38  # assumption: UL1571 28 AWG 7/0.127 (src_wire_xinya)
Y_RED, Y_BLACK, LEAD_Z = 15.5, 13.0, THICK / 2  # assumption: corner on the '+' side (photo), not dimensioned

END_X = LENGTH / 2  # PCM end face
CELL_END = END_X - PCM_DEPTH
LEAD_END = END_X + STUB_L  # 27.0: the drawn stub ends here


def wire(y: float, x0: float, x1: float, d: float):
    """A round wire along +X from x0 to x1 at (y, LEAD_Z)."""
    with BuildPart() as w:
        with Locations(Pos(x0, y, LEAD_Z) * Rot(0, 90, 0)):
            Cylinder(d / 2, x1 - x0, align=MIN)
    return w.part


def build() -> None:
    a = GeneratedPart(PART_ID, "lipol-lp503450", __file__)

    cell = block((-END_X + CELL_END) / 2, 0, 0, CELL_END + END_X, WIDTH, THICK)  # pouch cell
    pcm = block((CELL_END + END_X) / 2, 0, 0, PCM_DEPTH, WIDTH, THICK)  # folded PCM under kapton tape

    red = wire(Y_RED, END_X, LEAD_END, LEAD_OD)
    black = wire(Y_BLACK, END_X, LEAD_END, LEAD_OD)

    a.body(cell, "pouch_cell")
    a.body(pcm, "pcm_zone")
    a.body(red, "lead_red")
    a.body(black, "lead_black")

    def bottom(shape):
        return [f for f in shape.faces() if f.geom_type.name == "PLANE" and f.normal_at().Z < -0.9]

    def end(shape):
        return [f for f in shape.faces() if f.geom_type.name == "PLANE" and f.normal_at().X > 0.9]

    # bottom face of cell and PCM zone: seated in the case pocket (normal -Z)
    a.feature("mount_face", bottom(cell) + bottom(pcm))
    # lead stub ends: where the harness (the rest of each lead) continues
    a.feature("lead_pos", end(red))
    a.feature("lead_neg", end(black))
    a.write()


if __name__ == "__main__":
    build()
