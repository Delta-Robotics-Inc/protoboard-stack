"""Representative CAD for the bulk capacitor (Panasonic EEU-FR1V471, ø10 x 16 mm radial).

The part's native design for the `cad` capability (@protoboardai/ext-parts,
parts/local/panasonic-eeu-fr1v471/cad.config.ts), run by it:

    npx protoboard run cad:generate --module panasonic-eeu-fr1v471
    npx protoboard run cad:export --module panasonic-eeu-fr1v471

or by hand: python bulk_capacitor.py <out_dir>.

Can ø10 x 16 mm, leads ø0.6 mm on a 5 mm lead space (datasheet
ABA0000C1259, EEUFR1V471( ) row and dimension drawing). The can's axis is
+Z; the leads leave the base (z = 0) toward -Z. Only 1 mm of each lead is
part geometry: the bent, trimmed leads soldered into the ESC pads are the
capacitor-lead harness. Writes body.step, body.glb and body.manifest.json
into <out_dir>, features `pos` and `neg` on the lead exit faces.
"""
import hashlib
import json
import re
import sys
from pathlib import Path

import build123d as bd

OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent
OUT.mkdir(parents=True, exist_ok=True)
NAME = "panasonic-eeu-fr1v471"
D, L, LEAD_D, F = 10.0, 16.0, 0.6, 5.0

with bd.BuildPart() as can:
    bd.Cylinder(D / 2, L, align=(bd.Align.CENTER, bd.Align.CENTER, bd.Align.MIN))
    bd.fillet(can.edges().group_by(bd.Axis.Z)[-1], radius=0.6)
can_part = can.part
can_part.label = "can"
parts = [can_part]
features = {}
for name, x in (("pos", F / 2), ("neg", -F / 2)):
    with bd.BuildPart() as lead:
        with bd.Locations(bd.Pos(x, 0, -1.0)):
            bd.Cylinder(LEAD_D / 2, 1.0, align=(bd.Align.CENTER, bd.Align.CENTER, bd.Align.MIN))
    lp = lead.part
    lp.label = f"lead_{name}"
    parts.append(lp)
    face = lp.faces().sort_by(bd.Axis.Z)[0]
    c = face.center()
    features[name] = {"area_mm2": round(face.area, 3), "centroid": [round(c.X, 3) + 0.0, round(c.Y, 3) + 0.0, round(c.Z, 3) + 0.0], "faces": 1, "normal": [0.0, 0.0, -1.0]}

whole = bd.Compound(label=NAME, children=parts)
step = OUT / "body.step"
bd.export_step(whole, str(step))
# deterministic STEP: the export's timestamp is fixed
step.write_text(re.sub(r"FILE_NAME\('([^']*)','[^']*'", lambda m: f"FILE_NAME('{m.group(1)}','2000-01-01T00:00:00'", step.read_text(), count=1))
bd.export_gltf(whole, str(OUT / "body.glb"), binary=True, linear_deflection=0.05, angular_deflection=0.3)
manifest = {
    "artifact": NAME,
    "tool": "build123d",
    "toolVersion": bd.__version__,
    "sourceDigest": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
    "units": "mm",
    "volume_mm3": round(sum(p.volume for p in parts), 3),
    "bodies": {p.label: round(p.volume, 3) for p in parts},
    "features": features,
}
(OUT / "body.manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
print(json.dumps(features))
