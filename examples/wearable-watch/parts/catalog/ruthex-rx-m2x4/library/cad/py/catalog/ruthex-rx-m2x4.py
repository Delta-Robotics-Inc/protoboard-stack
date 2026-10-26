"""ruthex RX-M2x4 brass heat-set insert (M2, L 4.0): representative geometry.

ruthex publishes a STEP for this insert (sources.json src_cad), but its pages
state no terms, so the file is not redistributed. The body here is generated
from the ruthex dimension drawing (src_drawing: D1 3.6, D2 3.1, D3 3.2,
L 4.0) and from
measurements of the ruthex STEP (src_cad), taken with vendor_step.py and
build123d face queries. The STEP is turned 180° about X here: it has the
entry face at z = 0 and the body at z -4..0.

Coordinates: insert axis on Z, entry face (the face left flush with the host
part, where the screw enters) at z = 0, body at z 0..4. This matches the
nut convention (iso-10511-m3-nyloc-nut): the part's own +Z runs away from the
face the screw comes from, so a fastener stack's span is [atMm, atMm + L].

Profile from the entry face (all from the ruthex STEP unless noted):
  - upper knurl z 0..1.0: 12 flat-crested teeth, crest ø3.6 (D1, drawing;
    STEP crest ø3.57), root ø3.06, twisted 50° over the band;
  - groove ø3.03, z 1.0..1.6;
  - lower knurl z 1.6..2.8: 12 teeth, crest ø3.47, root ø3.05, twisted the
    opposite way (48.7° over 1.12 mm), with a lead-out cone to ø2.9 over
    z 2.5..2.8;
  - groove ø2.90, z 2.8..3.4;
  - pilot ø3.20 (STEP; equal to D3, the hole), z 3.4..3.9, chamfered to
    ø3.0 at z 4.0. The ruthex drawing gives this far-end pilot as D2 = 3.1;
    the body follows the STEP (source_discrepancy trait on the part);
  - bore: the M2 x 0.4 thread runs the full length (STEP minor ø1.623,
    major ø2.074). Modelled as a plain bore at the nominal ø2.0, with no
    thread form, as the library's nut does (ø3.0 for M3), so a modelled M2
    screw shank fits it without overlap; 45° chamfer to ø2.15 at the entry
    (STEP). The far-end chamfer (STEP ø2.02) is below the nominal bore and
    is not modelled.
Representative, recorded as `assumption` traits on the part: the knurl tooth
shape (flat crest 4°, V root) and a constant twist rate; the lower knurl band
is modelled as a straight twisted band to z 2.5, then a plain cone.
"""
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import build123d as bd  # noqa: E402
from build123d import Align, Cone, Cylinder, Pos, Solid  # noqa: E402

from partkit import GeneratedPart, cylinders  # noqa: E402

PART_ID = "ruthex-rx-m2x4"

L = 4.0  # L, drawing and STEP
D1 = 3.6  # D1, drawing (upper knurl crest)
D3 = 3.2  # D3, the hole (drawing); also the STEP pilot diameter (the drawn D2 is 3.1)

UPPER = (0.0, 1.0, D1, 3.06, -50.0)  # z0, z1, crest, root, twist (deg) — STEP
GROOVE_1 = (1.0, 1.6, 3.03)
LOWER = (1.6, 2.5, 3.47, 3.05, 40.0)  # straight part of the lower band; 48.7° / 1.12 mm x 0.9 mm
LOWER_CONE = (2.5, 2.8, 3.47, 2.90)
GROOVE_2 = (2.8, 3.4, 2.90)
PILOT = (3.4, 3.9, D3)
END_CHAMFER = (3.9, 4.0, D3, 3.0)

BORE_D = 2.0  # nominal M2 (STEP thread minor ø1.623, major ø2.074)
ENTRY_CHAMFER_D = 2.15  # STEP cone ø2.15 at the entry face

TEETH = 12
CREST_DEG = 4.0  # assumption: flat crest width (STEP crest edges ~4° apart)
MIN = (Align.CENTER, Align.CENTER, Align.MIN)


def rod(z0: float, z1: float, d: float):
    return Pos(0, 0, z0) * Cylinder(d / 2, z1 - z0, align=MIN)


def cone(z0: float, z1: float, d0: float, d1: float):
    return Pos(0, 0, z0) * Cone(d0 / 2, d1 / 2, z1 - z0, align=MIN)


def knurl(z0: float, z1: float, crest: float, root: float, twist: float):
    """A band of TEETH straight-knurl teeth, twisted by `twist` degrees from z0 to z1."""
    pts = []
    pitch = 360.0 / TEETH
    for i in range(TEETH):
        a = i * pitch
        for deg, r in ((a - CREST_DEG / 2, crest / 2), (a + CREST_DEG / 2, crest / 2), (a + pitch / 2, root / 2)):
            t = math.radians(deg)
            pts.append((r * math.cos(t), r * math.sin(t), z0))
    section = bd.Face(bd.Wire.make_polygon(pts, close=True))
    return Solid.extrude_linear_with_rotation(section, (0, 0, z0), (0, 0, z1 - z0), twist)


def body():
    outer = (
        knurl(*UPPER)
        + rod(*GROOVE_1)
        + knurl(*LOWER)
        + cone(*LOWER_CONE)
        + rod(*GROOVE_2)
        + rod(*PILOT)
        + cone(*END_CHAMFER)
    )
    entry = (ENTRY_CHAMFER_D - BORE_D) / 2  # 45°
    bore = rod(-0.1, L + 0.1, BORE_D) + cone(-0.001, entry, ENTRY_CHAMFER_D + 0.002, BORE_D)
    return outer - bore


def entry_face(shape):
    """The annular entry face at z = 0, facing -Z (flush with the host part's surface)."""
    return [
        f
        for f in shape.faces()
        if f.geom_type == bd.GeomType.PLANE and f.normal_at().Z < -0.99 and abs(f.center(bd.CenterOf.MASS).Z) < 1e-3
    ]


def build() -> None:
    a = GeneratedPart(PART_ID, "ruthex-rx-m2x4", __file__)
    shape = a.body(body(), "insert")
    # thread: the nominal ø2.0 bore, axis Z, entry at z = 0
    a.feature("thread", cylinders(shape, BORE_D, tol=0.02), axis=(0, 0, 1))
    # seat: the ø3.20 pilot that locates in the D3 hole, axis Z (the knurls melt into the wall)
    a.feature("seat", cylinders(shape, D3, tol=0.02), axis=(0, 0, 1))
    # entry_face: the flush face, normal -Z
    a.feature("entry_face", entry_face(shape))
    a.write()


if __name__ == "__main__":
    build()
