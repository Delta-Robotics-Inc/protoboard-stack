"""Measure a STEP model for a part audit: envelope, hole and shaft axes, and plane sections.

    python step_measure.py <model.step> [--min-d MM] [--max-d MM] [--axis x|y|z|any]
                           [--section z=1.5 ...] [--solids] [--json]

  envelope   the tight (optimal) bounding box: min, max and size in mm
  axes       every cylindrical and conical face with a diameter in
             [--min-d, --max-d] (default 0.5..60 mm), merged into unique axes:
             kind, diameter, a point on the axis, the unit direction, and how
             many faces share it. --axis keeps the axes parallel to one
             direction (a board's holes are along z)
  sections   --section <x|y|z>=<value> cuts the model with that plane and
             reports the cut's bounding box, its circles (centre, diameter)
             and its straight edges (an extrusion's slot opening, a bracket's
             wall thickness)
  solids     --solids lists each solid with its volume and bounding box,
             largest first (which body is the board, which the connector)

Used by the uhd-part-verify audit to check a definition's dimensions, holes
and frames against the vendor's STEP (or the library's generated one) with
code the auditor did not write for the part. Needs build123d and OCP (the
CAD Python, $PROTOBOARD_PYTHON). The ext-parts tests
(test/audit-helpers.test.ts) check it on a model with known geometry.
"""
from __future__ import annotations

import argparse
import json
import math
import sys

from build123d import GeomType, import_step
from OCP.BRepAdaptor import BRepAdaptor_Curve, BRepAdaptor_Surface
from OCP.BRepAlgoAPI import BRepAlgoAPI_Section
from OCP.BRepBndLib import BRepBndLib
from OCP.Bnd import Bnd_Box
from OCP.GeomAbs import GeomAbs_Circle, GeomAbs_Line
from OCP.gp import gp_Dir, gp_Pln, gp_Pnt
from OCP.TopAbs import TopAbs_EDGE
from OCP.TopExp import TopExp_Explorer
from OCP.TopoDS import TopoDS

R = 4  # decimals in the output


def _r(v: float) -> float:
    return round(v, R) + 0.0  # never -0.0


def bbox(shape) -> dict:
    b = Bnd_Box()
    BRepBndLib.AddOptimal_s(shape, b, False, False)
    lo, hi = b.CornerMin(), b.CornerMax()
    mn = [lo.X(), lo.Y(), lo.Z()]
    mx = [hi.X(), hi.Y(), hi.Z()]
    return {"min": [_r(v) for v in mn], "max": [_r(v) for v in mx], "size": [_r(b - a) for a, b in zip(mn, mx)]}


def load(path: str):
    return import_step(path)


def _canonical_dir(d: tuple[float, float, float]) -> tuple[float, float, float]:
    """An axis direction with a fixed sign (first non-zero component positive)."""
    for c in d:
        if abs(c) > 1e-9:
            return d if c > 0 else (-d[0], -d[1], -d[2])
    return d


def _foot(p: tuple[float, float, float], d: tuple[float, float, float]) -> tuple[float, float, float]:
    """The point of the line (p, d) closest to the origin: one point per axis, whatever face it came from."""
    t = sum(a * b for a, b in zip(p, d))
    return (p[0] - t * d[0], p[1] - t * d[1], p[2] - t * d[2])


def axes(shape, min_d: float = 0.5, max_d: float = 60.0, along: str = "any", tol: float = 0.01) -> list[dict]:
    """Unique hole/shaft axes: cylinders and cones with a diameter in range, coaxial faces merged."""
    want = {"x": (1.0, 0.0, 0.0), "y": (0.0, 1.0, 0.0), "z": (0.0, 0.0, 1.0)}.get(along)
    found: list[dict] = []
    for f in shape.faces():
        if f.geom_type not in (GeomType.CYLINDER, GeomType.CONE):
            continue
        s = BRepAdaptor_Surface(f.wrapped)
        try:
            if f.geom_type == GeomType.CYLINDER:
                g = s.Cylinder()
                dia = 2 * g.Radius()
            else:
                g = s.Cone()
                dia = 2 * g.RefRadius()
        except Exception:  # noqa: BLE001 (a face OCP cannot type: skip it)
            continue
        if not (min_d <= dia <= max_d):
            continue
        ax = g.Axis()
        p, d = ax.Location(), ax.Direction()
        direction = _canonical_dir((d.X(), d.Y(), d.Z()))
        if want and abs(abs(sum(a * b for a, b in zip(direction, want))) - 1) > 1e-3:
            continue
        foot = _foot((p.X(), p.Y(), p.Z()), direction)
        kind = "cylinder" if f.geom_type == GeomType.CYLINDER else "cone"
        for a in found:
            if (
                a["kind"] == kind
                and abs(a["diameter"] - dia) < tol
                and all(abs(x - y) < 1e-3 for x, y in zip(a["_dir"], direction))
                and math.dist(a["_foot"], foot) < tol
            ):
                a["faces"] += 1
                break
        else:
            found.append({"kind": kind, "diameter": dia, "_foot": foot, "_dir": direction, "_point": (p.X(), p.Y(), p.Z()), "faces": 1})
    out = []
    for a in found:
        d = a["_dir"]
        # report the axis where it crosses the principal plane it is normal to (a z hole at z=0), else its foot
        i = max(range(3), key=lambda k: abs(d[k]))
        t = -a["_point"][i] / d[i]
        point = tuple(a["_point"][k] + t * d[k] for k in range(3))
        out.append({"kind": a["kind"], "diameter": _r(a["diameter"]), "point": [_r(v) for v in point], "direction": [_r(v) for v in d], "faces": a["faces"]})
    return sorted(out, key=lambda a: (a["kind"], a["diameter"], a["point"]))


def _edge(shape):
    """TopoDS.Edge (newer OCP) or TopoDS.Edge_s (older)."""
    cast = getattr(TopoDS, "Edge_s", None) or TopoDS.Edge
    return cast(shape)


def section(shape, plane: str) -> dict:
    """Cut the model with an axis plane ("z=1.5"): the cut's bbox, circles and straight edges."""
    axis, _, value = plane.partition("=")
    axis = axis.strip().lower()
    if axis not in ("x", "y", "z") or not value:
        raise ValueError(f"section must look like z=1.5, not {plane!r}")
    v = float(value)
    normal = {"x": gp_Dir(1, 0, 0), "y": gp_Dir(0, 1, 0), "z": gp_Dir(0, 0, 1)}[axis]
    origin = gp_Pnt(v if axis == "x" else 0, v if axis == "y" else 0, v if axis == "z" else 0)
    op = BRepAlgoAPI_Section(shape.wrapped, gp_Pln(origin, normal), False)
    op.Approximation(False)
    op.Build()
    cut = op.Shape()
    circles: list[dict] = []
    lines: list[dict] = []
    edges = 0
    exp = TopExp_Explorer(cut, TopAbs_EDGE)
    while exp.More():
        e = _edge(exp.Current())
        edges += 1
        c = BRepAdaptor_Curve(e)
        if c.GetType() == GeomAbs_Circle:
            ci = c.Circle()
            loc = ci.Location()
            key = (_r(loc.X()), _r(loc.Y()), _r(loc.Z()), _r(2 * ci.Radius()))
            if not any((x["centre"], x["diameter"]) == (list(key[:3]), key[3]) for x in circles):
                circles.append({"centre": list(key[:3]), "diameter": key[3]})
        elif c.GetType() == GeomAbs_Line:
            a, b = c.Value(c.FirstParameter()), c.Value(c.LastParameter())
            lines.append({"from": [_r(a.X()), _r(a.Y()), _r(a.Z())], "to": [_r(b.X()), _r(b.Y()), _r(b.Z())], "length": _r(a.Distance(b))})
        exp.Next()
    if edges == 0:
        return {"plane": plane, "edges": 0, "bbox": None, "circles": [], "lines": []}
    return {"plane": plane, "edges": edges, "bbox": bbox(cut), "circles": sorted(circles, key=lambda x: (x["diameter"], x["centre"])), "lines": sorted(lines, key=lambda x: -x["length"])}


def solids(shape) -> list[dict]:
    rows = []
    for i, s in enumerate(shape.solids()):
        rows.append({"index": i, "label": s.label or None, "volume": _r(s.volume), "bbox": bbox(s.wrapped)})
    return sorted(rows, key=lambda r: -r["volume"])


def measure(path: str, min_d: float = 0.5, max_d: float = 60.0, along: str = "any", sections: list[str] | None = None, with_solids: bool = False) -> dict:
    s = load(path)
    out = {"file": path, "envelope": bbox(s.wrapped), "axes": axes(s, min_d, max_d, along), "sections": [section(s, p) for p in sections or []]}
    if with_solids:
        out["solids"] = solids(s)
    return out


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("step")
    ap.add_argument("--min-d", type=float, default=0.5)
    ap.add_argument("--max-d", type=float, default=60.0)
    ap.add_argument("--axis", choices=["x", "y", "z", "any"], default="any")
    ap.add_argument("--section", action="append", default=[], help="axis=value, e.g. z=1.5 (repeatable)")
    ap.add_argument("--solids", action="store_true")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args(argv)
    m = measure(a.step, a.min_d, a.max_d, a.axis, a.section, a.solids)
    if a.json:
        print(json.dumps(m, indent=1))
        return 0
    e = m["envelope"]
    print(f"envelope min {e['min']} max {e['max']} size {e['size']} mm")
    for x in m["axes"]:
        print(f"{x['kind']:8s} d {x['diameter']:8.4f}  at {x['point']}  dir {x['direction']}  ({x['faces']} face(s))")
    for sec in m["sections"]:
        print(f"section {sec['plane']}: {sec['edges']} edge(s)" + (f", bbox min {sec['bbox']['min']} max {sec['bbox']['max']} size {sec['bbox']['size']}" if sec["bbox"] else ""))
        for c in sec["circles"]:
            print(f"    circle d {c['diameter']} at {c['centre']}")
        for ln in sec["lines"][:40]:
            print(f"    line {ln['length']:8.4f}  {ln['from']} -> {ln['to']}")
    for s in m.get("solids", []):
        print(f"solid #{s['index']} vol {s['volume']} size {s['bbox']['size']} min {s['bbox']['min']} {s['label'] or ''}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
