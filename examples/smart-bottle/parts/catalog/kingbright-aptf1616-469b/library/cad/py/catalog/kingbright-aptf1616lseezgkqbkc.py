"""Kingbright APTF1616LSEEZGKQBKC (1.6 x 1.6 mm RGB SMD LED): representative package geometry.

Kingbright publishes a STEP (https://www.kingbrightusa.com/images/catalog/3D/STEP/APTF1616.STEP)
but states no licence for it, and the datasheet says its contents may not be
reproduced or re-transmitted without permission, so it is not redistributed
(see library/parts/kingbright-aptf1616lseezgkqbkc/.research/gaps.json). It was
measured as evidence and agrees with the drawing.

Every dimension is from spec DSAO4453 Rev V.9B, page 1 (Package dimensions):
  top view:    body 1.6 x 1.6; pads 3 (upper left), 2 (lower left),
               4 (upper right), 1 (lower right); pad centres 0.85 apart along
               each side; lens base edges 0.2 in from the pad sides.
  side view:   overall height 0.7, substrate 0.25, lens 1.2 wide at the base
               and 1.1 at the top (across the pad columns, X here).
  bottom view: pads 0.35 (X) x 0.65 (Y) with their outer edges on the body
               edge, each with an edge castellation; the bottom view is the
               top view mirrored top to bottom.
  notes:       mm, tolerance +-0.2 unless noted; single mounting surface.

Assumed (the drawing gives no value; also `assumption` traits on the part):
  - castellation dia 0.26 mm, its centre 0.054 mm outside the body edge (a
    0.076 mm deep notch), both as measured on the vendor STEP;
  - pad metal 0.01 mm thick with its face on the seating plane (vendor STEP);
  - the lens is flush with the substrate's two pad-free edges (the top view
    shows no step there) and has sharp edges;
  - the printed polarity marks (top, under the lens near pin 2; underside
    centre) and the chips inside the lens are not modelled.

Coordinates: mm, body centred on the origin, seating plane (pad faces) at
z = 0, lens top (the light-output face) at z = 0.70, Z up, X and Y as the
datasheet's top view. Pin 1 (common anode) at (+0.625, -0.425), pin 2 (Red)
at (-0.625, -0.425), pin 3 (Green) at (-0.625, +0.425), pin 4 (Blue) at
(+0.625, +0.425).
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import build123d as bd  # noqa: E402
from build123d import BuildPart, Cylinder, Locations, Pos  # noqa: E402

from partkit import MIN, GeneratedPart, block  # noqa: E402

PART = "kingbright-aptf1616lseezgkqbkc"

L = 1.6  # body, both ways
H = 0.70  # overall height
SUBSTRATE = 0.25
LENS_BASE, LENS_TOP = 1.2, 1.1  # across X
PAD_X, PAD_Y = 0.35, 0.65
PITCH = 0.85  # pad centres along Y
PAD_T = 0.01  # assumption: pad metal thickness (vendor STEP)
CAST_D = 0.26  # assumption: castellation diameter (vendor STEP)
CAST_OUT = 0.054  # assumption: castellation centre outside the body edge (vendor STEP)

PAD_CX = L / 2 - PAD_X / 2  # 0.625
PINS = {
    1: (PAD_CX, -PITCH / 2),
    2: (-PAD_CX, -PITCH / 2),
    3: (-PAD_CX, PITCH / 2),
    4: (PAD_CX, PITCH / 2),
}


def faces_at(shape, z: float, nz: float) -> list:
    """Planar faces of `shape` at height z whose normal points along nz (+1 up, -1 down)."""
    return [
        f
        for f in shape.faces()
        if f.geom_type == bd.GeomType.PLANE and f.normal_at().Z * nz > 0.99 and abs(f.center().Z - z) < 1e-6
    ]


def castellation(x: float, y: float):
    """Vertical cylinder through the substrate at a pad's outer edge."""
    cx = (L / 2 + CAST_OUT) * (1 if x > 0 else -1)
    with BuildPart() as p:
        with Locations(Pos(cx, y, 0)):
            Cylinder(CAST_D / 2, SUBSTRATE, align=MIN)
    return p.part


def lens():
    """Water clear lens: a prism tapered across X (1.2 -> 1.1), full length along Y."""
    pts = [
        (-LENS_BASE / 2, SUBSTRATE),
        (LENS_BASE / 2, SUBSTRATE),
        (LENS_TOP / 2, H),
        (-LENS_TOP / 2, H),
    ]
    # Plane.XZ: local (x, y) = global (x, z); extrude along global Y both ways
    face = bd.Plane.XZ * bd.make_face(bd.Polyline(*pts, close=True))
    return bd.extrude(face, amount=L / 2, both=True)


def build() -> None:
    a = GeneratedPart(PART, "kingbright-aptf1616-smd-1616", __file__)

    cuts = [castellation(x, y) for x, y in PINS.values()]
    substrate = block(0, 0, 0, L, L, SUBSTRATE)
    for c in cuts:
        substrate = substrate.cut(c)
    a.body(substrate, "substrate")

    top = lens()
    a.body(top, "lens")

    pads = []
    for n, (x, y) in PINS.items():
        pad = block(x, y, 0, PAD_X, PAD_Y, PAD_T).cut(castellation(x, y))
        a.body(pad, f"pad_{n}")
        face = faces_at(pad, 0.0, -1)
        pads += face
        a.feature(f"pin_{n}", face)

    # pcb_mount: the four pad faces on the seating plane (normal -z)
    a.feature("pcb_mount", pads)
    # light output: the lens top face (normal +z, towards the light guide)
    a.feature("light_output", faces_at(top, H, 1))
    a.write()


if __name__ == "__main__":
    build()
