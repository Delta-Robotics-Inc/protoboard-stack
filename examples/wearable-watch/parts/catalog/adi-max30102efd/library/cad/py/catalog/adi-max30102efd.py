"""Analog Devices MAX30102EFD+T (14 OESIP, outline 21-1048): representative package geometry.

No manufacturer CAD: the ADI product page timed out from this machine;
SnapEDA, Digi-Key and the SamacSys component search engine returned 403 and
Mouser a bot-block page (see library/parts/adi-max30102efd/.research/gaps.json).

Every dimension is from package outline 21-1048 rev B ("PACKAGE OUTLINE, 14L
OLGA, 3.3x5.6x1.55mm"), printed on p.32 of datasheet 19-7740 Rev 0 (Rev 1
names the same outline and package code F143A5MK+1 on p.2):
  E = 3.3 (x), D = 5.6 (y), A = 1.55 (height); A3 = 0.20 (cover glass)
  pads: b = 0.30 (along y) x L = 0.7 (along x), e = 0.8 BSC, D1 = 4.8 BSC
        (pin 1 to pin 7), E1 = 2.4 BSC (column centres); no exposed pad
  top view: two windows 1.97 (REF) wide; 2.75 (REF) long centred 0.822
        towards the pin 1/14 end; 1.094 (REF) long centred 1.64 towards the
        pin 7/8 end; a 0.10 (REF) rim around the top.
The datasheet pin configuration (Rev 1 p.8) labels the pin 1/14 end SENSOR
and the pin 7/8 end LED, so the long window is the photodetector aperture and
the short one the LED aperture.

Coordinates: package centred on the origin, seating plane (pad face) at
z = 0, top of the cover glass at z = 1.55, x along E (3.3 mm), y along D
(5.6 mm). Top view: pins 1-7 down the -x column from y = +2.4 to -2.4,
pins 8-14 up the +x column from y = -2.4 to +2.4; pin 1 at -x/+y; sensor
window towards +y, LED window towards -y.

Assumptions (also `assumption` traits on the part):
  - the 0.10 rim is the cover-glass inset, so the glass is 3.1 x 5.4 x 0.20
    on a 3.3 x 5.6 housing 1.35 tall (A - A3); the (0.05) step in the side
    view is folded into the housing height;
  - window corners are drawn rounded but not dimensioned: modelled square;
  - pad thickness is not dimensioned: pads are 0.02 mm inside the body with
    their faces on the seating plane;
  - the bottom index mark (dia 0.25) and the two dia 0.20 (REF) marks are
    not modelled.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import build123d as bd  # noqa: E402

from partkit import GeneratedPart, block  # noqa: E402

PART = "adi-max30102efd"

E, D, A = 3.3, 5.6, 1.55
A3 = 0.20  # cover glass
RIM = 0.10  # top rim (REF): cover-glass inset (assumption)
HOUSING_Z = A - A3  # 1.35
PAD_B, PAD_L, PITCH = 0.30, 0.7, 0.8
E1 = 2.4
PAD_T = 0.02  # assumption: pad thickness not dimensioned

WIN_W = 1.97
SENSOR_LEN, SENSOR_Y = 2.75, 0.822
LED_LEN, LED_Y = 1.094, -1.64

# pin -> (x, y): pins 1-7 on -x from +y to -y, pins 8-14 on +x from -y to +y
PINS = {n: (-E1 / 2, 2.4 - PITCH * (n - 1)) for n in range(1, 8)}
PINS.update({n: (E1 / 2, -2.4 + PITCH * (n - 8)) for n in range(8, 15)})


def faces_at(shape, z: float, nz: float) -> list:
    """Planar faces of `shape` at height z whose normal points along nz (+1 up, -1 down)."""
    return [
        f
        for f in shape.faces()
        if f.geom_type == bd.GeomType.PLANE and f.normal_at().Z * nz > 0.99 and abs(f.center().Z - z) < 1e-6
    ]


def build() -> None:
    a = GeneratedPart(PART, "adi-max30102-oesip14", __file__)

    housing = block(0, 0, 0, E, D, HOUSING_Z)
    a.body(housing, "housing")

    sensor_win = block(0, SENSOR_Y, HOUSING_Z, WIN_W, SENSOR_LEN, A3)
    led_win = block(0, LED_Y, HOUSING_Z, WIN_W, LED_LEN, A3)
    glass = block(0, 0, HOUSING_Z, E - 2 * RIM, D - 2 * RIM, A3).cut(sensor_win).cut(led_win)
    a.body(glass, "cover_glass")
    a.body(sensor_win, "sensor_window")
    a.body(led_win, "led_window")

    pads = []
    for n, (x, y) in PINS.items():
        pad = block(x, y, 0, PAD_L, PAD_B, PAD_T)
        a.body(pad, f"pad_{n}")
        face = faces_at(pad, 0.0, -1)
        pads += face
        a.feature(f"pin_{n}", face)

    # pcb_mount: the 14 pad faces on the seating plane (normal -z)
    a.feature("pcb_mount", pads)
    # optical apertures: the window faces on top of the cover glass (normal +z, towards the skin)
    a.feature("sensor_window", faces_at(sensor_win, A, 1))
    a.feature("led_window", faces_at(led_win, A, 1))
    a.write()


if __name__ == "__main__":
    build()
