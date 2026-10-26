# From the Protoboard parts library workspace (library/cad/py/catalog/adafruit-381-ds18b20-probe.py,
# commit 9a80317). Changed in the smart-bottle project (2026-10-03): only the rigid part of the
# probe is drawn (the stainless tube and the first 6 mm of the heat shrink over the tube-to-cable
# joint); the rest of the heat shrink and the cable bend, so they are the project's routed harness
# (src/harnesses: bottle-probe-cable). Runs with the copied helpers in parts/local/_cadkit:
#   PYTHON=<python with build123d> $PYTHON parts/local/adafruit-381-ds18b20-probe/adafruit-381-ds18b20-probe.py
"""Adafruit 381 waterproof DS18B20 probe (stainless tube, PVC cable): representative geometry.

Adafruit publishes no CAD for product 381 (the product page links only the
DS18B20 datasheet, and adafruit/Adafruit_CAD_Parts has no entry for it), so
the probe is generated from the product page (sources.json src_product):

  "Stainless steel tube 6mm diameter by 30mm long";
  "Cable is 36" long / 91cm, 4mm diameter"; PVC jacket; waterproofed with heat shrink;
  three wires: red 3-5 V, blue/black ground, yellow/white data.

Coordinates: probe axis on Z. The closed tip of the stainless tube is at
z = 0 and the probe runs up +Z: exposed tube 0-30, heat-shrink sleeve,
narrower sleeve over the cable, cable jacket, then the three wires broken
out of the jacket with stripped ends. Wire positions inside the jacket:
red (VDD) at +Y, blue/black (GND) at 210 degrees, yellow/white (DQ) at 330
degrees, on a 0.9 mm radius.

Assumptions (also `assumption` traits on the part), because Adafruit
dimensions only the tube and the cable. Read from photo 381-02 (src_photos),
scaled by the 6 mm tube (25 px) and the 4 mm cable (16 px), about
0.245 mm/px:
  - the 30 mm tube length is the exposed stainless (photo: about 33 mm);
  - heat-shrink sleeve behind the tube O6.3 x 24 (photo: about the tube
    diameter, 99 px); narrower sleeve over the cable O4.8 x 25 (19-20 px,
    103 px);
  - wires broken out 35 mm beyond the jacket, insulation O1.5, stranded
    conductor drawn as a O0.6 rod stripped 15 mm (photos 381-01, 381-02:
    stranded copper, untinned; gauge not stated);
  - the cable is drawn shortened to 50 mm of jacket, not the delivered
    910 mm, because a project cuts it to its routed length; the part states
    the full length.
"""
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "_cadkit"))

from build123d import Cylinder, Pos  # noqa: E402

from partkit import MIN, GeneratedPart  # noqa: E402

PART_ID = "adafruit-381-ds18b20-probe"

TUBE_D, TUBE_L = 6.0, 30.0  # src_product: "6mm diameter by 30mm long"
CABLE_D = 4.0  # src_product: "4mm diameter"
SLEEVE_D, SLEEVE_L = 6.3, 24.0  # assumption (photo)
SLEEVE2_D, SLEEVE2_L = 4.8, 25.0  # assumption (photo)
CABLE_DRAWN = 50.0  # assumption: drawn stub; the delivered cable is 910 mm
WIRE_D, WIRE_L = 1.5, 35.0  # assumption (photo): insulated length beyond the jacket
CU_D, STRIP_L = 0.6, 15.0  # assumption (photo): stranded, untinned
WIRE_R = 0.9  # assumption: the three wires on a 0.9 mm radius inside the O4 jacket

Z_SHOULDER = TUBE_L  # 30: exposed stainless ends, sleeve begins
RIGID_SLEEVE = 6.0  # assumption (smart-bottle): the stiff length of heat shrink over the tube-to-cable joint
Z_RIGID = Z_SHOULDER + RIGID_SLEEVE  # 36: where the flexible run (sleeve, cable) begins
STUB = 1.0  # assumption (smart-bottle): wire ends drawn as 1 mm stubs on the cut face; the harness carries the rest
Z_SLEEVE2 = Z_SHOULDER + SLEEVE_L  # 54
Z_CABLE = Z_SLEEVE2 + SLEEVE2_L  # 79: bare jacket leaves the sleeve
Z_BREAKOUT = Z_CABLE + CABLE_DRAWN  # 129: jacket end
Z_STRIP = Z_BREAKOUT + WIRE_L - STRIP_L  # 149: insulation ends
Z_TIP = Z_BREAKOUT + WIRE_L  # 164: stripped wire ends

# (feature name, body label, angle in degrees from +X)
WIRES = [("wire_vdd", "red", 90.0), ("wire_gnd", "blue_or_black", 210.0), ("wire_dq", "yellow_or_white", 330.0)]


def rod(x: float, y: float, z0: float, z1: float, d: float):
    """A cylinder on a Z-parallel axis through (x, y), from z0 to z1."""
    return Pos(x, y, z0) * Cylinder(d / 2, z1 - z0, align=MIN)


def cyl_faces(shape):
    return [f for f in shape.faces() if f.geom_type.name == "CYLINDER"]


def plane_faces(shape, nz: float, z: float):
    return [f for f in shape.faces() if f.geom_type.name == "PLANE" and f.normal_at().Z * nz > 0.9 and abs(f.center().Z - z) < 0.01]


def build() -> None:
    a = GeneratedPart(PART_ID, "adafruit-381-ds18b20-probe", __file__)

    tube = rod(0, 0, 0, Z_SHOULDER, TUBE_D)  # stainless tube, closed tip at z = 0
    sleeve = rod(0, 0, Z_SHOULDER, Z_RIGID, SLEEVE_D)  # the stiff start of the heat shrink over the tube end and cable joint

    a.body(tube, "stainless_tube")
    a.body(sleeve, "heat_shrink_sleeve")

    tips = {}
    for name, colour, deg in WIRES:
        x, y = WIRE_R * math.cos(math.radians(deg)), WIRE_R * math.sin(math.radians(deg))
        tips[name] = a.body(rod(x, y, Z_RIGID, Z_RIGID + STUB, WIRE_D), f"wire_{colour}")

    # the exposed stainless: the surface a rod seal or gland closes on, and the sensing element
    a.feature("tube", cyl_faces(tube), axis=(0, 0, 1))
    a.feature("tube_tip", plane_faces(tube, -1, 0.0))
    # where the flexible run (heat shrink, then the jacket) leaves the stiff joint: the harness starts here
    a.feature("cable_exit", plane_faces(sleeve, 1, Z_RIGID))
    # the three wires, as stubs on the cut face: where the harness's conductors begin
    for name, shape in tips.items():
        a.feature(name, plane_faces(shape, 1, Z_RIGID + STUB))
    a.write()


if __name__ == "__main__":
    build()
