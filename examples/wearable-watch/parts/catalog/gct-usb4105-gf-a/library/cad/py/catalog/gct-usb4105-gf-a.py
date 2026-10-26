"""GCT USB4105-GF-A (USB Type-C receptacle, USB 2.0, SMT, PCB top mount) — representative geometry.

No usable manufacturer CAD: GCT links its 3D models from
https://gct.co/connector/usb4105, which answers every fetch with a
Cloudflare challenge (HTTP 403); SnapEDA and Ultra Librarian need a login
and forbid redistribution; the community KiCad model is CC-BY-SA 4.0 and
would carry share-alike into this library. So the receptacle is generated
from GCT drawing USB4105 rev B4 (18/12/23), https://gct.co/files/drawings/usb4105.pdf:

  outline (top view)               8.94 wide (X) x 7.35 deep (Y)
  height above the seating plane   3.31 (side view)
  mating axis height               1.73 (side view)
  opening                          8.34 (+0.06/-0.02) x 2.56 ±0.04 (front view)
  contact tails                    16x 0.20 wide, centres ±0.25 ±0.75 ±1.25 ±1.75 (single)
                                   and ±2.40 ±3.20 (pairs, 4x 0.45 wide); 0.38 past the body rear
  shell stakes                     4, on 8.64 across (X); front pair 2.60 behind the face,
                                   rear pair 4.18 further back; 0.80 / 1.10 wide (Y);
                                   S = 0.95 below the seating plane (blank suffix)
  locating pegs                    2x Ø0.50 on 5.78 (X), 3.68 behind the front stakes,
                                   0.60 below the seating plane (rear view)

Assumed (not dimensioned; recorded as an assumption trait on the part):
  - the shell is a stadium tube whose outer size is the 8.94 width by
    3.16 high (3.31 top minus the 0.15 implied bottom: 1.73 axis - 1.58),
    i.e. a 0.30 wall around the 8.34 x 2.56 opening, over the full 7.35 depth;
  - cavity depth 4.85 and tongue 6.78 x 0.70 starting 0.30 behind the face,
    scaled from the mating view and front view;
  - stake thickness 0.30 (the shell wall), centred on the 8.64 stake line;
  - tail foot 0.75 long (from the body rear minus 0.37 to the 0.38 tip),
    0.10 thick, with a 0.15 riser into the body; pair tails 0.05 apart
    inside their 0.45 group.

Coordinates: mm. X across the receptacle (A1/B12 tails at -X, B1/A12 at +X,
as in the drawing's component-side layout view), Y from the mating face
(Y = 0, normal -Y) to the rear (+Y), Z up from the seating plane (Z = 0).
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import build123d as bd  # noqa: E402

from partkit import GeneratedPart, block, cylinders  # noqa: E402

PART = "gct-usb4105-gf-a"

DEPTH = 7.35
AXIS_Z = 1.73
OUT_W, OUT_H = 8.94, 3.16  # outer shell (assumption, see docstring)
IN_W, IN_H = 8.34, 2.56  # opening (drawing)
CAVITY = 4.85  # assumption
TONGUE_W, TONGUE_T, TONGUE_Y0 = 6.78, 0.70, 0.30  # assumption

TAIL_W, TAIL_T = 0.20, 0.10
TAIL_TIP = DEPTH + 0.38
TAIL_FOOT = 0.75
RISER = 0.15

STAKE_X = 8.64 / 2
STAKE_T = 0.30  # assumption
STAKE_S = 0.95
STAKES = [(2.60, 0.80), (2.60 + 4.18, 1.10)]  # (y centre, width along Y)

PEG_D, PEG_DROP = 0.50, 0.60
PEG_X = 5.78 / 2
PEG_Y = 2.60 + 3.68

# Contact tails, -X to +X: (designators, x centre). Pairs share a 0.45 group.
HALF = (0.45 - TAIL_W) / 2  # pair tails at group centre ± 0.125
TAILS = {
    "A1": -3.20 - HALF, "B12": -3.20 + HALF,
    "A4": -2.40 - HALF, "B9": -2.40 + HALF,
    "B8": -1.75, "A5": -1.25, "B7": -0.75, "A6": -0.25,
    "A7": 0.25, "B6": 0.75, "A8": 1.25, "B5": 1.75,
    "B4": 2.40 - HALF, "A9": 2.40 + HALF,
    "B1": 3.20 - HALF, "A12": 3.20 + HALF,
}


def stadium(width: float, height: float, y0: float, length: float):
    """A stadium (slot) prism along +Y from y0, centred on X = 0, Z = AXIS_Z."""
    plane = bd.Plane(origin=(0, y0, AXIS_Z), x_dir=(1, 0, 0), z_dir=(0, 1, 0))
    with bd.BuildPart() as p:
        with bd.BuildSketch(plane):
            bd.SlotCenterToCenter(width - height, height)
        bd.extrude(amount=length)
    return p.part


def planar(shape, normal, at: float, axis: str) -> list:
    n = bd.Vector(*normal)
    return [
        f for f in shape.faces()
        if f.geom_type == bd.GeomType.PLANE and f.normal_at().dot(n) > 0.99 and abs(getattr(f.center(), axis) - at) < 1e-6
    ]


def build() -> None:
    a = GeneratedPart(PART, "gct-usb4105", __file__)

    shell = stadium(OUT_W, OUT_H, 0, DEPTH).cut(stadium(IN_W, IN_H, 0, CAVITY))
    tongue = block(0, TONGUE_Y0 + (CAVITY - TONGUE_Y0) / 2, AXIS_Z - TONGUE_T / 2, TONGUE_W, CAVITY - TONGUE_Y0, TONGUE_T)
    a.body(shell, "shell")
    a.body(tongue, "tongue")
    # usb_c: the shell's front ring (mating face), where the plug enters
    a.feature("usb_c", planar(shell, (0, -1, 0), 0.0, "Y"))

    stake_bottoms = []
    for sx in (-1, 1):
        for y, w in STAKES:
            stake = block(sx * STAKE_X, y, -STAKE_S, STAKE_T, w, STAKE_S + AXIS_Z - 0.5)
            a.body(stake, f"stake_{'l' if sx < 0 else 'r'}_{'front' if y < 4 else 'rear'}")
            stake_bottoms += planar(stake, (0, 0, -1), -STAKE_S, "Z")
    a.feature("shell", stake_bottoms)

    pegs = None
    for sx in (-1, 1):
        peg = bd.Pos(sx * PEG_X, PEG_Y, -PEG_DROP) * bd.Cylinder(PEG_D / 2, PEG_DROP + 0.3, align=(bd.Align.CENTER, bd.Align.CENTER, bd.Align.MIN))
        pegs = peg if pegs is None else pegs.fuse(peg)
    a.body(pegs, "locating_pegs")
    a.feature("locating_pegs", cylinders(pegs, PEG_D), axis=(0, 0, 1))

    feet = []
    for name, x in TAILS.items():
        y0 = TAIL_TIP - TAIL_FOOT
        foot = block(x, y0 + TAIL_FOOT / 2, 0, TAIL_W, TAIL_FOOT, TAIL_T)
        riser = block(x, y0 + RISER / 2, TAIL_T, TAIL_W, RISER, 0.5 - TAIL_T)
        a.body(foot.fuse(riser), f"tail_{name.lower()}")
        faces = planar(foot, (0, 0, -1), 0.0, "Z")
        feet += faces
        a.feature(f"pin_{name.lower()}", faces)
    a.feature("pcb_mount", feet + stake_bottoms)
    a.write()


if __name__ == "__main__":
    build()
