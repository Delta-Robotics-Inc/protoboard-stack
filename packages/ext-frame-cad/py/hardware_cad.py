"""hardware-cad: nominal bodies for fastener modules (build123d).

    python hardware_cad.py <name>.params.json <out_dir>

Moved from the UHD library's quadcopter generator (library/cad/py/hardware.py
with the writer from common.py, @deltarobotics/uhd) and made generic: the
params file (written by lib/hardware.ts from the module) gives the kind and
the sizes, and nothing about a particular vehicle is in here.

Kinds and shapes (nominal; no thread form):
  screw     socket head (head_diameter x head_height, hex socket 0.6 deep)
            under z = 0, plain shank 0.95 d along +Z for `length`
  nut       hex, `outer` across flats, bore d, `length` high
  standoff  hex, `outer` across flats, bore 0.85 d, `length` long
  spacer    tube, `outer` diameter, bore d + 0.4, `length` long
A nut's, standoff's or spacer's `bore`, when the params give one (the maker
states it), replaces the nominal bore.
Each part's origin is where its fastenerStack position is measured: a
screw's is under its head, thread along +Z; the others sit on z = 0 and
extend along +Z.

Writes, into <out_dir>:
  <name>.step             body (label = kind)
  <name>.glb              the same for viewers (glTF: metres, Y-up)
  <name>.manifest.json    volume (mass = volume x the module's material
                          density), tool, version, source digest
and prints a JSON summary on the last stdout line. Outputs are deterministic
for fixed params and build123d version: the STEP timestamp is normalised.
"""
from __future__ import annotations

import hashlib
import json
import math
import re
import sys
from pathlib import Path

import build123d as bd
from build123d import Align, BuildPart, BuildSketch, Circle, Compound, Cylinder, Locations, Mode, Pos, RegularPolygon, export_gltf, export_step, extrude

MIN = (Align.CENTER, Align.CENTER, Align.MIN)
GENERATOR = Path(__file__)
FIXED_TIME = "2000-01-01T00:00:00"
KINDS = ("screw", "nut", "standoff", "spacer")


def body(part: dict) -> bd.Part:
    kind, d, length = part["kind"], part["diameter"], part["length"]
    bore = part.get("bore")
    with BuildPart() as p:
        if kind == "screw":
            with Locations(Pos(0, 0, -part["head_height"])):
                Cylinder(part["head_diameter"] / 2, part["head_height"], align=MIN)
                with BuildSketch():
                    RegularPolygon(d * 0.45, 6)
                extrude(amount=part["head_height"] * 0.6, mode=Mode.SUBTRACT)
            Cylinder(d / 2 * 0.95, length, align=MIN)
        elif kind == "nut":
            with BuildSketch():
                RegularPolygon(part["outer"] / math.sqrt(3), 6)
                Circle((bore or d) / 2, mode=Mode.SUBTRACT)
            extrude(amount=length)
        elif kind == "standoff":
            with BuildSketch():
                RegularPolygon(part["outer"] / math.sqrt(3), 6)
                Circle((bore or d * 0.85) / 2, mode=Mode.SUBTRACT)
            extrude(amount=length)
        elif kind == "spacer":
            Cylinder(part["outer"] / 2, length, align=MIN)
            Cylinder((bore or d + 0.4) / 2, length, align=MIN, mode=Mode.SUBTRACT)
        else:
            raise SystemExit(f"unknown hardware kind {kind!r} (one of {', '.join(KINDS)})")
    return p.part


def build(params: dict, out: Path) -> dict:
    name, part = params["name"], params["part"]
    shape = body(part)
    shape.label = part["kind"]
    whole = Compound(label=name, children=[shape])

    out.mkdir(parents=True, exist_ok=True)
    step = out / f"{name}.step"
    export_step(whole, str(step))
    step.write_text(re.sub(r"FILE_NAME\('([^']*)','[^']*'", lambda m: f"FILE_NAME('{m.group(1)}','{FIXED_TIME}'", step.read_text(), count=1))
    export_gltf(whole, str(out / f"{name}.glb"), binary=True, linear_deflection=0.05, angular_deflection=0.3)

    digest = hashlib.sha256(GENERATOR.read_bytes() + json.dumps(params, sort_keys=True).encode()).hexdigest()
    volume = round(shape.volume, 3)
    manifest = {
        "artifact": name,
        "tool": "build123d",
        "toolVersion": bd.__version__,
        "generator": "@protoboardai/ext-frame-cad py/hardware_cad.py",
        "params": f"{name}.params.json",
        "sourceDigest": digest,
        "units": "mm",
        # solid volume, so mass = volume x the module's declared material density
        "volume_mm3": volume,
        "bodies": {part["kind"]: volume},
        "features": {},
    }
    (out / f"{name}.manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    return {"name": name, "toolVersion": bd.__version__, "sourceDigest": digest, "volume_mm3": volume}


if __name__ == "__main__":
    params_path, out_dir = sys.argv[1], sys.argv[2]
    result = build(json.loads(Path(params_path).read_text()), Path(out_dir))
    print(json.dumps(result))
