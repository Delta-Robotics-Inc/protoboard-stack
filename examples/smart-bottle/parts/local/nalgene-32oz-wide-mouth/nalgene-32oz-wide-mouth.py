# Copied unchanged from the Protoboard parts library workspace (library/cad/py/catalog/nalgene-32oz-wide-mouth.py,
# commit 9a80317), where it runs with the library's partkit helpers (library/cad/py/partkit.py)
# and wrote the STEP, GLB, manifest and interfaces/ beside this file. Kept as the record of how
# the representative body was made; regenerate it in the library, then copy the outputs here.
"""Nalgene 32 oz Wide Mouth bottle (Tritan Renew), 63 mm finish: representative geometry.

Nalgene publishes no CAD or drawing for the consumer bottle (nalgene.com
product and cap pages: a spec table and photos only), so the bottle is
generated from the stated dimensions (sources.json):

  body Ø3.5 in (88.9), height 8.25 in (209.55) [src_product];
  63 mm cap, "continuous, straight shouldered semi-buttress threads"
  [src_product, src_cap, src_brochure];
  SPI 63 mm finish: T 2.426-2.461 in (61.62-62.51), E 2.332-2.367 in
  (59.23-60.12), S 0.031-0.061 in (0.79-1.55), I >= 1.972 in (50.09),
  6 threads per inch (4.233 pitch) [src_spi];
  the linerless closure's seal ring seats on the bevelled inner edge
  (chamfer) of the neck [src_brochure].

Coordinates: Z up on the bottle axis, the standing face at z = 0, the top
of the neck finish (the lip land) at z = 209.55. The cap comes from +Z.

Not in the sources, recorded as `assumption` traits on the part (measure the
purchased bottle before the cap thread is frozen, OQ-B4):
  - 8.25 in is the bottle without its cap, to the top of the lip;
  - T and E are the SPI mid-tolerance values (62.07, 59.67); the thread
    depth is (T - E) / 2 = 1.2;
  - the bore is Ø53, as on Thermo's 1 L wide-mouth HDPE bottle with the
    same 63 mm finish [src_lab_bottle]; the SPI minimum is 50.09;
  - finish height H 10.36 (the SPI 400-series mid value: the table gives no
    415-series H for 63 mm); S 1.17 (mid);
  - the thread is a right-hand single start of 1.5 turns whose top end
    (the lead-in) is on +X;
    profile: upper (load) flank 10 deg from radial, lower flank 45 deg,
    crest 0.8 wide; no run-out taper;
  - lip: flat land from the bore to the root diameter with a 1.0 x 45 deg
    inner chamfer (the seal ring's seat); the outer edge is left sharp;
  - below the finish a plain Ø59.67 neck 8 long (where the stock cap's leash
    ring sits), then a conical shoulder 28 tall to the body;
  - wall 2.5 thick on the body, 3.33 at the neck (bore to root); the base
    has a 4 x 4 chamfer standing in for the moulded radius.
"""
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "_cadkit"))

import build123d as bd  # noqa: E402
from build123d import Axis, Polyline, Rot, make_face, revolve  # noqa: E402

from partkit import GeneratedPart  # noqa: E402
from vendor_step import radius_of  # noqa: E402

PART_ID = "nalgene-32oz-wide-mouth"
IN = 25.4

BODY_D = 3.5 * IN  # 88.9, src_product "Diameter 3.5 inches (89mm)"
HEIGHT = 8.25 * IN  # 209.55, src_product "Height 8.25 in (21cm)"
T = (2.426 + 2.461) / 2 * IN  # 62.07, src_spi 63 mm T (mid)
E = (2.332 + 2.367) / 2 * IN  # 59.67, src_spi 63 mm E (mid)
S = (0.031 + 0.061) / 2 * IN  # 1.17, src_spi 63 mm S (mid)
PITCH = IN / 6  # 4.233, src_spi 6 threads per inch

BORE_D = 53.0  # assumption: src_lab_bottle "Inner Neck 53 mm"
H_FINISH = (0.393 + 0.423) / 2 * IN  # 10.36, assumption: SPI 400-series H (mid)
TURNS = 1.5  # assumption
CHAMFER = 1.0  # assumption: inner lip chamfer (the seal ring's seat, src_brochure)
NECK_BELOW = 8.0  # assumption: plain neck below the finish
SHOULDER_H = 28.0  # assumption
WALL = 2.5  # assumption
BASE_CH = 4.0  # assumption

# semi-buttress profile (assumption), in (radial, axial) from the root at the upper flank
DEPTH = (T - E) / 2  # 1.2
UPPER_DROP = DEPTH * math.tan(math.radians(10))  # upper flank 10 deg from radial
CREST_W = 0.8
LOWER_RUN = DEPTH  # lower flank 45 deg
BASE_W = UPPER_DROP + CREST_W + LOWER_RUN  # ~2.21 axial width at the root
SINK = 0.05  # the ridge starts just inside the root cylinder so the two touch


def bottle_body():
    """Revolved wall section: base, body, shoulder, neck and lip, hollow."""
    R, Rb, Re = BODY_D / 2, BORE_D / 2, E / 2
    z_neck = HEIGHT - H_FINISH - NECK_BELOW  # shoulder meets the neck
    z_sh = z_neck - SHOULDER_H  # body meets the shoulder
    ri = R - WALL
    outer = [
        (0, 0),
        (R - BASE_CH, 0),
        (R, BASE_CH),
        (R, z_sh),
        (Re, z_neck),
        (Re, HEIGHT),
        (Rb + CHAMFER, HEIGHT),
        (Rb, HEIGHT - CHAMFER),
        (Rb, z_neck - 1.0),
        (ri, z_sh - 1.5),
        (ri, BASE_CH + 0.5),
        (ri - BASE_CH + 1.0, WALL),
        (0, WALL),
    ]
    section = make_face(Polyline(*[(x, 0, z) for x, z in outer], close=True))
    return revolve(section, Axis.Z, 360)


def thread_ridge():
    """Right-hand semi-buttress ridge on the root cylinder, its top S below the lip.

    The helix rises 1.5 turns from +X and ends on -X; the ridge is turned
    180 deg so its top end, where a closure first engages (the lead-in), is on
    +X: the part's neck_thread frame xAxis.
    """
    z_top_crest = HEIGHT - S  # top of the first thread (upper flank at the root)
    height = PITCH * TURNS
    z_start = z_top_crest - BASE_W - height  # the helix rises to the top end of the thread
    r0 = E / 2 - SINK
    helix = bd.Helix(pitch=PITCH, height=height, radius=r0, center=(0, 0, z_start))
    # profile in the XZ plane at the helix start (r0, 0, z_start): root at r0, crest at T/2
    pts = [
        (r0, 0, z_start + BASE_W),
        (T / 2, 0, z_start + BASE_W - UPPER_DROP),
        (T / 2, 0, z_start + LOWER_RUN),
        (r0, 0, z_start),
    ]
    profile = make_face(Polyline(*pts, close=True))
    return Rot(0, 0, 180) * bd.sweep(profile, path=helix, is_frenet=True)


def build() -> None:
    body = bottle_body()
    ridge = thread_ridge()
    a = GeneratedPart(PART_ID, "nalgene-32oz-wide-mouth", __file__)
    a.body(body, "bottle")
    a.body(ridge, "thread")

    faces = body.faces()
    planes = [f for f in faces if f.geom_type == bd.GeomType.PLANE]
    top = [f for f in planes if f.normal_at().Z > 0.99 and abs(f.center(bd.CenterOf.MASS).Z - HEIGHT) < 1e-6]
    chamfer = [
        f
        for f in faces
        if f.geom_type == bd.GeomType.CONE and abs(f.center(bd.CenterOf.MASS).Z - (HEIGHT - CHAMFER / 2)) < 0.3
    ]
    bore = [
        f
        for f in faces
        if f.geom_type == bd.GeomType.CYLINDER and (r := radius_of(f)) is not None and abs(r - BORE_D / 2) < 0.01
    ]
    root = [
        f
        for f in faces
        if f.geom_type == bd.GeomType.CYLINDER and (r := radius_of(f)) is not None and abs(r - E / 2) < 0.01
    ]
    bottom = [f for f in planes if f.normal_at().Z < -0.99 and abs(f.center(bd.CenterOf.MASS).Z) < 1e-6]

    # neck_thread: the ridge's flanks and crest plus the root cylinder of the finish (cap comes from +Z)
    ridge_faces = [f for f in ridge.faces() if f.geom_type != bd.GeomType.PLANE]
    a.feature("neck_thread", ridge_faces + root)
    # lip_seal: the top land and the inner chamfer the closure's seal ring seats on
    a.feature("lip_seal", top + chamfer)
    # mouth: the Ø53 bore of the neck, the opening into the bottle (axis Z)
    a.feature("mouth", bore, axis=(0, 0, 1))
    # base: the standing face (normal -Z)
    a.feature("base", bottom)
    a.write()


if __name__ == "__main__":
    build()
