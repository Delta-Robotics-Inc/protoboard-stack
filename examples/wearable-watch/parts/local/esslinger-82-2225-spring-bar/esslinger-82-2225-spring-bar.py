"""Esslinger 82.2225 spring bar (22 mm, Ø1.50 mm, double flange): representative geometry.

Esslinger publishes no CAD or drawing for its spring bars (the product pages
carry photos and a size table only), so the bar is generated from the
Esslinger 1.50 mm double-flange size table (sources.json src_size_table):

  fits 22 mm lugs, compressed length 21.8, overall length 25.0,
  body length 18.6, tip ø0.80, bar ø1.50 ("1.50mm bar diameter").

Modelled in the free (as-supplied) state, plungers fully extended.
Coordinates: bar axis on X, centred on the origin; end "a" at +X, end "b"
at -X. Each end extends (25.0 - 18.6) / 2 = 3.2 past the body; the
compression travel per end is (25.0 - 21.8) / 2 = 1.6.

Not in the table, estimated from Esslinger's 1.50 mm double-flange photo
(src_photo, the 82.2185 image, scaled by the 1.50 mm body = 32 px) and
recorded as `assumption` traits on the part:
  - tip length 0.8 beyond the outer flange (photo: 17 px);
  - flanges ø1.2 x 0.25 wide, separated by a ø0.9 x 0.25 groove
    (photo: 25-26 px and 19 px across, 4-5 px wide);
  - plunger shank ø1.0 (photo: 21-22 px), running from the inner flange
    into the tube; inside the tube it continues 1.5 (hidden, for a closed
    model; the spring is not modelled);
  - tube wall 0.2 (bore ø1.1) and 0.3 long tapered ends down to ø1.2
    (photo: the crimped tube ends); the wall is not visible in any source.
The photo-measured tip (16 px = 0.75) agrees with the table's ø0.80, and
the shank outside the tube (1.65) matches the 1.6 compression travel: fully
compressed, the inner flange reaches the tube end.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "cadkit"))

from build123d import Align, Cone, Cylinder, Mode, Pos, Rot  # noqa: E402

from partkit import GeneratedPart  # noqa: E402

PART_ID = "esslinger-82-2225-spring-bar"

OVERALL_L = 25.0  # size table "Overall Length"
BODY_L = 18.6  # size table "Body Length"
COMPRESSED_L = 21.8  # size table "Compressed Length" (not modelled: free state)
BAR_D = 1.50  # "1.50mm bar diameter"
TIP_D = 0.80  # size table "Tip Diameter"

TIP_L = 0.8  # assumption (photo)
FLANGE_D, FLANGE_W = 1.2, 0.25  # assumption (photo)
GROOVE_D, GROOVE_W = 0.9, 0.25  # assumption (photo)
SHANK_D = 1.0  # assumption (photo)
SHANK_IN = 1.5  # assumption: hidden length inside the tube
BORE_D = 1.1  # assumption: 0.2 wall
TAPER_L, TAPER_D = 0.3, 1.2  # assumption (photo)

END_X = OVERALL_L / 2  # 12.5
BODY_X = BODY_L / 2  # 9.3
SHOULDER_X = END_X - TIP_L  # 11.7: outer flange face, seats on the lug's inner face
MIN = (Align.CENTER, Align.CENTER, Align.MIN)


def rod(x0: float, x1: float, d: float):
    """A cylinder on the X axis from x0 to x1 (x0 < x1)."""
    return Pos(x0, 0, 0) * Rot(0, 90, 0) * Cylinder(d / 2, x1 - x0, align=MIN)


def cone(x0: float, x1: float, d0: float, d1: float):
    """A cone frustum on the X axis, ø d0 at x0 to ø d1 at x1."""
    return Pos(x0, 0, 0) * Rot(0, 90, 0) * Cone(d0 / 2, d1 / 2, x1 - x0, align=MIN)


def mirror_x(shape):
    return Rot(0, 0, 180) * shape


def plunger():
    """The +X plunger: shank (from inside the tube), inner flange, groove, outer flange, tip."""
    x = SHOULDER_X
    return (
        rod(BODY_X - SHANK_IN, x - 2 * FLANGE_W - GROOVE_W, SHANK_D)
        + rod(x - 2 * FLANGE_W - GROOVE_W, x - FLANGE_W - GROOVE_W, FLANGE_D)  # inner flange
        + rod(x - FLANGE_W - GROOVE_W, x - FLANGE_W, GROOVE_D)
        + rod(x - FLANGE_W, x, FLANGE_D)  # outer flange
        + rod(x, END_X, TIP_D)
    )


def tube():
    """The ø1.50 body tube with tapered (crimped) ends and a ø1.1 bore."""
    t = rod(-BODY_X + TAPER_L, BODY_X - TAPER_L, BAR_D)
    t = t + cone(BODY_X - TAPER_L, BODY_X, BAR_D, TAPER_D) + mirror_x(cone(BODY_X - TAPER_L, BODY_X, BAR_D, TAPER_D))
    return t - rod(-BODY_X, BODY_X, BORE_D)


def walls(x0: float, x1: float, d: float):
    """Lateral face of an untrimmed cylinder (hole_axes needs a readable radius)."""
    return [f for f in rod(x0, x1, d).faces() if f.geom_type.name == "CYLINDER"]


def shoulder(sign: int):
    """The annular outer-flange face (ø1.2 minus the ø0.80 tip) facing out along sign·X."""
    x = sign * SHOULDER_X
    x0, x1 = (x - 0.1, x) if sign > 0 else (x, x + 0.1)
    ring = rod(x0, x1, FLANGE_D) - rod(x0, x1, TIP_D)
    return [f for f in ring.faces() if f.geom_type.name == "PLANE" and f.normal_at().X * sign > 0.9]


def build() -> None:
    a = GeneratedPart(PART_ID, "esslinger-82-2225", __file__)
    a.body(tube(), "tube")
    a.body(plunger(), "plunger_a")
    a.body(mirror_x(plunger()), "plunger_b")

    # tip_a / tip_b: the ø0.80 tips that enter the lug holes (axis X)
    a.feature("tip_a", walls(SHOULDER_X, END_X, TIP_D), axis=(1, 0, 0))
    a.feature("tip_b", walls(-END_X, -SHOULDER_X, TIP_D), axis=(1, 0, 0))
    # flange_a / flange_b: outer-flange shoulder faces that seat on the lug's inner faces
    a.feature("flange_a", shoulder(1))
    a.feature("flange_b", shoulder(-1))
    # strap_bar: the ø1.50 tube surface the strap's spring-bar tunnel slides over
    a.feature("strap_bar", walls(-BODY_X + TAPER_L, BODY_X - TAPER_L, BAR_D), axis=(1, 0, 0))
    a.write()


if __name__ == "__main__":
    build()
