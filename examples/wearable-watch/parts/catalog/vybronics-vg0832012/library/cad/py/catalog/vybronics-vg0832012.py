"""Vybronics VG0832012 8 mm Z-axis coin LRA: representative geometry.

Vybronics links a 3D file (RAR) from the product page but states no licence,
and the site terms reserve all rights, so it is not used (sources.json
src_cad, src_terms). The body is generated from the datasheet outline view
(src_datasheet p.10 §7, version A/1):

  can Φ8 ± 0.1 x 3.25 ± 0.1 mm; lead tab end 5.6 mm from the can centre;
  UV adhesive over the lead exit, 1.8 max high, 2.1 max beyond the can edge,
  2.4 max across both leads; UL3302 AWG32 leads 10 ± 2 mm beyond the tab end,
  stripped and tinned 1.5 ± 0.5 mm; '+' red, '-' blue.

Coordinates: can axis +Z, the bottom face (the face the taped variant
VG0832013D carries its tape on, and the side with the lead tab) at z = 0,
leads along +X. The drawing is first-angle: the view below the side view is
the top, and in it red '+' is at +Y and blue '-' at -Y.

Assumptions (also `assumption` traits on the part), scaled from the drawing
rather than dimensioned:
  - lead tab 2.4 mm wide, 0.25 mm thick, from inside the can to x = 5.6;
  - adhesive drawn at its maximum envelope (to x = 6.1, 1.8 high, 2.4 wide);
  - lead centres 1.15 mm apart, 0.46 mm above the bottom face, insulation
    Ø0.45 mm; tinned conductor Ø0.20 mm (AWG32 nominal);
  - nominal lengths: lead ends at x = 5.6 + 10 = 15.6, strip 1.5 mm.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from build123d import Box, BuildPart, Cylinder, Locations, Mode, Pos, Rot  # noqa: E402

from partkit import MIN, GeneratedPart, block  # noqa: E402

PART_ID = "vybronics-vg0832012"

CAN_D, CAN_H = 8.0, 3.25  # p.10 Φ8±0.1, 3.25±0.1
TAB_END = 5.6  # p.10, centre to the end of the lead tab
LEAD_L, STRIP_L = 10.0, 1.5  # p.10, 10±2 and 1.5±0.5 (nominal)
GLUE_REACH, GLUE_H, GLUE_W = 2.1, 1.8, 2.4  # p.10 maxima
TAB_W, TAB_T = 2.4, 0.25  # assumption (scaled)
LEAD_PITCH, LEAD_Z, LEAD_OD, CU_D = 1.15, 0.46, 0.45, 0.20  # assumption (scaled; AWG32 nominal)

LEAD_END = TAB_END + LEAD_L  # 15.6
STRIP_START = LEAD_END - STRIP_L  # 14.1
GLUE_END = CAN_D / 2 + GLUE_REACH  # 6.1


def wire(y: float, x0: float, x1: float, d: float):
    """A round wire along +X from x0 to x1 at (y, LEAD_Z)."""
    with BuildPart() as w:
        with Locations(Pos(x0, y, LEAD_Z) * Rot(0, 90, 0)):
            Cylinder(d / 2, x1 - x0, align=MIN)
    return w.part


def build() -> None:
    a = GeneratedPart(PART_ID, "vybronics-vg0832012", __file__)

    with BuildPart() as can:
        Cylinder(CAN_D / 2, CAN_H, align=MIN)
    x0 = CAN_D / 2 - 1.0  # tab and adhesive start under the can edge
    tab = block((x0 + TAB_END) / 2, 0, 0, TAB_END - x0, TAB_W, TAB_T)
    with BuildPart() as glue:
        with Locations(Pos((x0 + GLUE_END) / 2, 0, 0)):
            Box(GLUE_END - x0, GLUE_W, GLUE_H, align=MIN)
        Cylinder(CAN_D / 2, CAN_H, align=MIN, mode=Mode.SUBTRACT)

    y_pos, y_neg = LEAD_PITCH / 2, -LEAD_PITCH / 2
    red = wire(y_pos, TAB_END - 1.0, STRIP_START, LEAD_OD)
    blue = wire(y_neg, TAB_END - 1.0, STRIP_START, LEAD_OD)
    red_tin = wire(y_pos, STRIP_START, LEAD_END, CU_D)
    blue_tin = wire(y_neg, STRIP_START, LEAD_END, CU_D)

    a.body(can.part, "can")
    a.body(tab, "lead_tab")
    a.body(glue.part, "uv_adhesive")
    a.body(red, "lead_red")
    a.body(blue, "lead_blue")
    a.body(red_tin, "lead_red_tinned")
    a.body(blue_tin, "lead_blue_tinned")

    # bottom face of the can: bonded to the housing (normal -Z)
    a.feature("mount_face", [f for f in can.part.faces() if f.geom_type.name == "PLANE" and f.normal_at().Z < -0.9])
    # tinned lead ends: where the harness / board pads are soldered
    a.feature("lead_pos", [f for f in red_tin.faces() if f.geom_type.name == "CYLINDER"], axis=(1, 0, 0))
    a.feature("lead_neg", [f for f in blue_tin.faces() if f.geom_type.name == "CYLINDER"], axis=(1, 0, 0))
    a.write()


if __name__ == "__main__":
    build()
