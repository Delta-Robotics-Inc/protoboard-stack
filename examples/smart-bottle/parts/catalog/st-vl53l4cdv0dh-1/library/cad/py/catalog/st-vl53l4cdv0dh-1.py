"""ST VL53L4CDV0DH/1 (VL53L4CD, Optical LGA12, 4.4 x 2.4 x 1 mm): representative package geometry.

No manufacturer CAD: st.com (the product page's CAD resources) refused every
fetch from this machine, and the STEP on Ultra Librarian needs an account and
its terms forbid redistributing it in a library (see
library/parts/st-vl53l4cdv0dh-1/.research/gaps.json).

Every dimension is from datasheet DS13812 Rev 8, section 7:
  Figure 17: body 4.40 x 2.40, height 1 (+0.05/-0.10) to the cap top,
             substrate 0.31; Rx aperture 0.665 from the short edge, Tx 3.00
             from Rx, both on the long centreline (1.20 from the long edge).
  Figure 18: Rx hole dia 0.20 (0.201 on the second cap supplier), Tx hole
             dia 0.40.
  Figure 19 (bottom view): 12 pads 0.50 square; pad left edges at x = 0,
             0.80, 1.60, 2.40, 3.20 and bottom edges at y = 0, 0.80, 1.60
             from pad 1's corner; substrate edge 0.35 left of and 0.15 below
             pad 1; pad 1 carries a 0.08 x 0.25 extension on its outer edge
             (upper half) as the pin-1 mark.
  Figure 21: Rx on the pins 5-7 end, Tx on the pin 1 end.
The pad array (3.70 x 2.10) is centred on the body: 0.35 + 3.70 + 0.35 = 4.40
and 0.15 + 2.10 + 0.15 = 2.40.

Coordinates: body centred on the origin, seating plane (pad faces) at z = 0,
cap top (datum A of the exclusion cones) at z = 1.00, x along 4.40 mm, viewed
from the top (the bottom view mirrored). Pin 1 at +x/-y; pins 1-5 along
y = -0.80 from x = +1.60 to -1.60, pin 6 at (-1.60, 0), pins 7-11 along
y = +0.80 from x = -1.60 to +1.60, pin 12 at (+1.60, 0). Tx aperture at
x = +1.465, Rx aperture at x = -1.535.

Assumptions (also `assumption` traits on the part):
  - the cap has the substrate's 4.40 x 2.40 outline; the side recesses and
    the 0.035 mm marks (Figure 18) and the draft are not modelled;
  - each aperture is a 0.05 mm deep recess in the cap top whose disc (the
    aperture body) sits flush with the cap top; the real depth to the lens is
    not dimensioned;
  - pads are 0.02 mm thick inside the substrate with their faces on the
    seating plane (no pad thickness is dimensioned);
  - the protective liner of the V0DH/1 (Figure 20, 0.05 mm) is removed
    before the cover glass is fitted, so it is not modelled.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import build123d as bd  # noqa: E402
from build123d import BuildPart, Cylinder, Locations, Pos  # noqa: E402

from partkit import MIN, GeneratedPart, block  # noqa: E402

PART = "st-vl53l4cdv0dh-1"

L, W, H = 4.40, 2.40, 1.00
SUBSTRATE = 0.31
PAD, PITCH = 0.50, 0.80
PAD_T = 0.02  # assumption: pad thickness not dimensioned
MARK_W, MARK_H = 0.08, 0.25  # pin-1 pad extension (Figure 19)

RX_X, TX_X = -L / 2 + 0.665, -L / 2 + 0.665 + 3.00  # -1.535, +1.465
RX_D, TX_D = 0.20, 0.40
APT_DEPTH = 0.05  # assumption: aperture recess depth not dimensioned

# pin -> pad centre (x, y), top view
PINS = {n: (1.60 - PITCH * (n - 1), -PITCH) for n in range(1, 6)}
PINS[6] = (-1.60, 0.0)
PINS.update({n: (-1.60 + PITCH * (n - 7), PITCH) for n in range(7, 12)})
PINS[12] = (1.60, 0.0)


def faces_at(shape, z: float, nz: float) -> list:
    """Planar faces of `shape` at height z whose normal points along nz (+1 up, -1 down)."""
    return [
        f
        for f in shape.faces()
        if f.geom_type == bd.GeomType.PLANE and f.normal_at().Z * nz > 0.99 and abs(f.center().Z - z) < 1e-6
    ]


def disc(x: float, d: float, z0: float, h: float):
    with BuildPart() as p:
        with Locations(Pos(x, 0, z0)):
            Cylinder(d / 2, h, align=MIN)
    return p.part


def build() -> None:
    a = GeneratedPart(PART, "st-vl53l4cd-optical-lga12", __file__)

    a.body(block(0, 0, 0, L, W, SUBSTRATE), "substrate")

    rx = disc(RX_X, RX_D, H - APT_DEPTH, APT_DEPTH)
    tx = disc(TX_X, TX_D, H - APT_DEPTH, APT_DEPTH)
    cap = block(0, 0, SUBSTRATE, L, W, H - SUBSTRATE).cut(rx).cut(tx)
    a.body(cap, "cap")
    a.body(rx, "rx_aperture")
    a.body(tx, "tx_aperture")

    pads = []
    for n, (x, y) in PINS.items():
        pad = block(x, y, 0, PAD, PAD, PAD_T)
        if n == 1:
            # extension on the outer (+x) edge, upper half (towards the body centre)
            pad = pad.fuse(block(x + PAD / 2 + MARK_W / 2, y + PAD / 2 - MARK_H / 2, 0, MARK_W, MARK_H, PAD_T)).clean()
        a.body(pad, f"pad_{n}")
        face = faces_at(pad, 0.0, -1)
        pads += face
        a.feature(f"pin_{n}", face)

    # pcb_mount: the 12 pad faces on the seating plane (normal -z)
    a.feature("pcb_mount", pads)
    # optical apertures: the aperture discs flush with the cap top (normal +z, towards the target)
    a.feature("rx_aperture", faces_at(rx, H, 1))
    a.feature("tx_aperture", faces_at(tx, H, 1))
    a.write()


if __name__ == "__main__":
    build()
