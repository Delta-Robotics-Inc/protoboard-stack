"""GCT USB4720-03-A (USB Type-C receptacle, USB 2.0, SMT, mid-mount, IP67) — representative geometry.

No usable manufacturer CAD: GCT links its 3D models from
https://gct.co/connector/usb4720, which answers every fetch with a
Cloudflare challenge (HTTP 403), as do guessed STEP paths under
gct.co/files/; SnapEDA and Ultra Librarian need a login and forbid
redistribution. So the receptacle is generated from GCT drawing USB4720
rev B (02/01/25), https://gct.co/files/drawings/usb4720.pdf:

  overall depth                    7.60 ref, tongue tip to the rear stake tabs (side, bottom views)
  tongue                           6.69 (+0.045/-0.055) wide (top view), 0.70 ±0.05 thick,
                                   0.80 in front of the gasket face (side view)
  LIM gasket                       9.54 wide (bottom view) x 3.75 high (front view)
  receptacle opening               8.34 (+0.06/-0.02) x 2.56 ±0.04, axis 0.35 ref above the
                                   seating plane, top 1.63 above it (front view)
  shell height                     2.13 above the seating plane (front view), 1.13 ref below
                                   (rear view), 3.26 ref overall (side view)
  body depth                       6.50 from the tongue tip to the body rear (bottom view)
  contact tails                    16; 8x 0.25 singles at 0.50 pitch (centres ±0.25 .. ±1.75)
                                   and 4x 0.60 pair groups at ±2.425 / ±3.275 (2x 0.85, 2x 3.275);
                                   tail line 0.75 and tips 0.89 behind the body rear (bottom view)
  stake legs                       4, 0.30 ±0.05 thick (X), 1.30 long (Y), 11.30 ±0.15 overall
                                   width (front view); front pair 2.95 behind the tongue tip,
                                   rear pair 4.00 further back (side view); 0.60 ±0.15 below the
                                   tail plane and 0.75 ±0.15 below the wing (rear view)
  grounding tags                   2, 8.20 ±0.10 apart (rear view), 0.30 ±0.03 wide, on the tail
                                   line (recommended PCB layout: 2x Ø0.50 holes on 8.20)

Assumed (not dimensioned; recorded as an assumption trait on the part):
  - the shell is a stadium 8.94 x 3.26 (the 8.34 opening plus a 0.30 wall each
    side; it fits the layout's 9.05 board cut-out), Z -1.13 .. 2.13, from the
    gasket's rear face to the body rear;
  - the gasket is 1.40 thick (Y), its top level with the shell's 2.13 (the
    front view's 2.13 and 3.75 share the top line), so it reaches 1.62 below
    the seating plane;
  - cavity 4.30 deep from the gasket face;
  - wings 0.30 thick, their underside 0.15 above the tail plane (rear view
    0.15 ±0.10); all four legs reach 0.60 below the tail plane;
  - tails 0.10 thick; pair tails 0.25 wide, 0.10 apart inside their 0.60 group;
  - grounding tags Ø0.30 pins reaching 0.60 below the tail plane, on a 0.30
    wide bracket from the body rear.

Coordinates: mm. X across the receptacle (A1/B12 tails at -X, B1/A12 at +X,
as in the drawing's recommended PCB layout), Y from the gasket's front face
(Y = 0, normal -Y, the face that seals against the panel) to the rear (+Y),
Z up from the seating plane (Z = 0, the tail plane on the board's top
surface; the board is cut out under the body, mid-mount).
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import build123d as bd  # noqa: E402

from partkit import GeneratedPart, block  # noqa: E402

PART = "gct-usb4720-03-a"

AXIS_Z = 0.35
TONGUE_PROTRUDE = 0.80  # tongue tip in front of the gasket face
TONGUE_W, TONGUE_T = 6.69, 0.70
BODY_REAR = 6.50 - TONGUE_PROTRUDE  # 5.70

GASKET_W, GASKET_H, GASKET_T = 9.54, 3.75, 1.40  # thickness: assumption
GASKET_ZC = 2.13 - GASKET_H / 2  # top level with the shell (assumption)

SHELL_W = 8.94  # assumption: 8.34 opening + 2 x 0.30 wall
SHELL_Z0, SHELL_Z1 = -1.13, 2.13
IN_W, IN_H = 8.34, 2.56
CAVITY = 4.30  # assumption

TAIL_W, TAIL_T = 0.25, 0.10
TAIL_Y0 = BODY_REAR
TAIL_TIP = BODY_REAR + 0.89

LEG_T, LEG_L, LEG_DROP = 0.30, 1.30, 0.60
LEG_X = 11.30 / 2 - LEG_T / 2  # leg centres, 11.30 over the outer faces
LEG_Y = [2.95 - TONGUE_PROTRUDE, 2.95 + 4.00 - TONGUE_PROTRUDE]  # 2.15, 6.15
WING_Z0, WING_T = 0.15, 0.30

TAG_X, TAG_D, TAG_DROP = 8.20 / 2, 0.30, 0.60
TAG_Y = BODY_REAR + 0.75  # on the tail line

# Contact tails, -X to +X: (designator, x centre). Pairs share a 0.60 group.
HALF = (0.60 - TAIL_W) / 2  # pair tails at group centre ± 0.175
TAILS = {
    "A1": -3.275 - HALF, "B12": -3.275 + HALF,
    "A4": -2.425 - HALF, "B9": -2.425 + HALF,
    "B8": -1.75, "A5": -1.25, "B7": -0.75, "A6": -0.25,
    "A7": 0.25, "B6": 0.75, "A8": 1.25, "B5": 1.75,
    "B4": 2.425 - HALF, "A9": 2.425 + HALF,
    "B1": 3.275 - HALF, "A12": 3.275 + HALF,
}


def stadium(width: float, height: float, y0: float, length: float, zc: float):
    """A stadium (slot) prism along +Y from y0, centred on X = 0, Z = zc."""
    plane = bd.Plane(origin=(0, y0, zc), x_dir=(1, 0, 0), z_dir=(0, 1, 0))
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
    a = GeneratedPart(PART, "gct-usb4720", __file__)

    shell_zc = (SHELL_Z0 + SHELL_Z1) / 2
    opening = stadium(IN_W, IN_H, -0.01, CAVITY + 0.01, AXIS_Z)
    gasket = stadium(GASKET_W, GASKET_H, 0, GASKET_T, GASKET_ZC).cut(stadium(SHELL_W, SHELL_Z1 - SHELL_Z0, -0.01, GASKET_T + 0.02, shell_zc))
    shell = stadium(SHELL_W, SHELL_Z1 - SHELL_Z0, 0, BODY_REAR, shell_zc).cut(opening)
    tongue_y0 = -TONGUE_PROTRUDE
    tongue = block(0, (tongue_y0 + CAVITY) / 2, AXIS_Z - TONGUE_T / 2, TONGUE_W, CAVITY - tongue_y0, TONGUE_T)
    a.body(shell, "shell")
    a.body(gasket, "lim_gasket")
    a.body(tongue, "tongue")
    # the gasket's front face seals against the panel; the plug enters the shell opening there
    seal_face = planar(gasket, (0, -1, 0), 0.0, "Y")
    a.feature("panel_seal", seal_face)
    a.feature("usb_c", planar(shell, (0, -1, 0), 0.0, "Y"))

    leg_bottoms = []
    for sx in (-1, 1):
        for y in LEG_Y:
            leg = block(sx * LEG_X, y, -LEG_DROP, LEG_T, LEG_L, LEG_DROP + WING_Z0 + WING_T)
            x_in, x_out = SHELL_W / 2 - 0.05, 11.30 / 2
            wing = block(sx * (x_in + x_out) / 2, y, WING_Z0, x_out - x_in, LEG_L, WING_T)
            a.body(leg.fuse(wing), f"stake_{'l' if sx < 0 else 'r'}_{'front' if y < 4 else 'rear'}")
            leg_bottoms += planar(leg, (0, 0, -1), -LEG_DROP, "Z")
    a.feature("shell", leg_bottoms)

    tag_bottoms = []
    for sx in (-1, 1):
        pin = bd.Pos(sx * TAG_X, TAG_Y, -TAG_DROP) * bd.Cylinder(TAG_D / 2, TAG_DROP + 0.30, align=(bd.Align.CENTER, bd.Align.CENTER, bd.Align.MIN))
        bracket = block(sx * TAG_X, (BODY_REAR - 0.05 + TAG_Y) / 2, 0, TAG_D, TAG_Y - BODY_REAR + 0.05, 0.30)
        a.body(pin.fuse(bracket), f"ground_tag_{'l' if sx < 0 else 'r'}")
        tag_bottoms += planar(pin, (0, 0, -1), -TAG_DROP, "Z")
    a.feature("ground_tags", tag_bottoms)

    feet = []
    for name, x in TAILS.items():
        foot = block(x, (TAIL_Y0 - 0.05 + TAIL_TIP) / 2, 0, TAIL_W, TAIL_TIP - TAIL_Y0 + 0.05, TAIL_T)
        a.body(foot, f"tail_{name.lower()}")
        faces = planar(foot, (0, 0, -1), 0.0, "Z")
        feet += faces
        a.feature(f"pin_{name.lower()}", faces)
    a.feature("pcb_mount", feet + leg_bottoms + tag_bottoms)
    a.write()


if __name__ == "__main__":
    build()
