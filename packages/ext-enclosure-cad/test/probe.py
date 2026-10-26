"""TEST HELPER: exact probes of built parts (build123d), for the generator tests.

    python probe.py <spec.json>

spec:
  overlaps  [{part: <step>, box: {min, max}}]                 volume of part ∩ box (mm³)
  bridges   [{feature, parts: {name: <step>}, origin, normal, width, height,
              wall, z_bottom, z_top, slices?}]                 the material each part keeps
                                                               above and below a cut through a
                                                               side wall: the wall is sliced
                                                               across its thickness (8 slices)
                                                               and every solid each slice of a
                                                               probe box over the cut holds is
                                                               listed with its z extent

Prints one JSON object: {overlaps: [mm³, ...], bridges: [{feature, part, side, solids: [dz, ...]}]},
`solids` being every slice's solids together.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from build123d import Box, Plane, Pos, Vector, import_step


def box(lo, hi):
    lo, hi = np.asarray(lo, dtype=float), np.asarray(hi, dtype=float)
    return Pos(*((lo + hi) / 2)) * Box(*(hi - lo))


def solids(shape):
    return [] if shape is None else list(shape.solids())


def main() -> None:
    spec = json.loads(Path(sys.argv[1]).read_text())
    out = {"overlaps": [], "bridges": []}
    for o in spec.get("overlaps", []):
        common = import_step(o["part"]) & box(o["box"]["min"], o["box"]["max"])
        out["overlaps"].append(round(sum(s.volume for s in solids(common)), 4))
    for b in spec.get("bridges", []):
        n = np.asarray(b["normal"], dtype=float)
        h = np.cross([0.0, 0.0, 1.0], n)
        h /= np.linalg.norm(h)
        # the middle 80 % of the cut's width, through the wall, from the cut's edge to the case's top (above) or bottom (below)
        pl = Plane(origin=Vector(*b["origin"]), x_dir=Vector(*h), z_dir=Vector(*n))
        half_w = 0.4 * b["width"]
        z_cut = (b["origin"][2] - b["height"] / 2, b["origin"][2] + b["height"] / 2)
        k = b.get("slices", 8)
        t = b["wall"] / k
        shapes = {name: import_step(step) for name, step in sorted(b["parts"].items())}
        for side, (z0, z1) in (("above", (z_cut[1], b["z_top"] + 1)), ("below", (b["z_bottom"] - 1, z_cut[0]))):
            for name, shape in shapes.items():
                dz = []
                for i in range(k):
                    probe = pl.location * (Pos(0, (z0 + z1) / 2 - b["origin"][2], -(i + 0.5) * t) * Box(2 * half_w, z1 - z0, t - 0.02))
                    dz += [round(s.bounding_box().size.Z, 3) for s in solids(shape & probe)]
                out["bridges"].append({"feature": b["feature"], "part": name, "side": side, "solids": dz})
    print(json.dumps(out))


if __name__ == "__main__":
    main()
