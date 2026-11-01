"""Re-project a model through the drawing's views and compare it with the drawing's numbers (PB-1190,
`drawing.compare`): the differential check, with the drawing itself as the reference.

1. The drawing's views (views.py) and dimensions (dimensions.py) on one sheet.
2. The model (a STEP, mm, Z up) loaded with build123d and projected per view with `project_to_viewport`
   (OCCT hidden-line removal, orthographic). DEFAULT view directions, Z-up model frame:
     front looks along +Y (X right, Z up)      back  looks along -Y
     top   looks down -Z  (X right, Y up)      bottom looks up +Z
     right looks along -X (Y right, Z up)      left  looks along +X
   `--view-map v1=front,v2=top` overrides the roles views.py guessed.
3. Registration per view, sheet mm to model mm: the scale is the median value / drawn length of the view's
   dimensions (`dimensions`), else the sheet's stated scale, else 1 for DXF model space, else the box ratio
   (`extents`, which cannot see a uniformly wrong size and says so). The view's box centre maps to the model's
   projected centre; the four mirrorings are tried and the one whose anchors land closest to model features is
   kept (first and third angle side views mirror each other).
4. Each linear dimension's two anchors are snapped, along the dimension's direction, to the nearest model
   vertex or circle extreme; the model's value is the distance between the snapped features. A diameter or
   radius snaps its circle's centre to the nearest projected model circle. A snap farther than SNAP_MM (or 3 %
   of the view) is `unmatched`, not a delta.
5. The view's extents (drawing box x scale against the model's projected box) are compared too: that is what
   catches a model several times too large (round 1's USB-C).

delta = model - drawing (mm). A dimension is within when -minus <= delta <= plus, with its own tolerance, else
--tolerance, else DEFAULT_TOL_MM. Verdict: `disagrees` when any compared number is out, else `incomplete`
when something could not be compared, else `agrees`. Overlay PNGs (model edges in red, hidden in orange, over
the drawing) go to the cache unless --no-overlay.
"""
from __future__ import annotations

import math
import statistics
import time
from pathlib import Path

from . import DrawingError, cache_dir, r3, r3v
from .crop import MARGIN_FRACTION, MARGIN_MM, part_scale, render_dxf
from .dimensions import dimensions as read_dimensions
from .sheet import Sheet

DEFAULT_TOL_MM = 0.1  # DEFAULT: a dimension without its own tolerance is compared within +/-0.1 mm
SNAP_MM = 1.0  # DEFAULT: a snap is accepted within max(1 mm, 3 % of the view's size)
SNAP_FRACTION = 0.03
OVERLAY_DPI = 100.0  # DEFAULT

# (direction from the target to the camera, up), Z-up model frame: DEFAULT conventions (see the module note)
CAMERAS = {
    "front": ((0.0, -1.0, 0.0), (0.0, 0.0, 1.0)),
    "back": ((0.0, 1.0, 0.0), (0.0, 0.0, 1.0)),
    "top": ((0.0, 0.0, 1.0), (0.0, 1.0, 0.0)),
    "bottom": ((0.0, 0.0, -1.0), (0.0, -1.0, 0.0)),
    "right": ((1.0, 0.0, 0.0), (0.0, 0.0, 1.0)),
    "left": ((-1.0, 0.0, 0.0), (0.0, 0.0, 1.0)),
}
FLIPS = [(1, 1), (-1, 1), (1, -1), (-1, -1)]


def load_model(path: Path):
    suffix = path.suffix.lower()
    if suffix not in (".step", ".stp"):
        raise DrawingError("compare reads a STEP model (.step or .stp); export a build123d script's body first (`protoboard run cad:export`)")
    from build123d import import_step

    try:
        return import_step(str(path))
    except Exception as e:
        raise DrawingError(f"{path.name}: the STEP could not be read ({type(e).__name__}: {str(e)[:160]})")


def project(shape, role: str) -> dict:
    """The model seen from `role`: visible and hidden polylines, vertices and circles in view coordinates (mm)."""
    from build123d import GeomType

    d, up = CAMERAS[role]
    bb = shape.bounding_box()
    c = bb.center()
    dist = 10.0 * max(bb.diagonal, 1.0)
    origin = (c.X + d[0] * dist, c.Y + d[1] * dist, c.Z + d[2] * dist)
    vis, hid = shape.project_to_viewport(origin, viewport_up=up, look_at=(c.X, c.Y, c.Z))
    verts, circles, lines = [], [], {"visible": [], "hidden": []}
    for which, edges in (("visible", vis), ("hidden", hid)):
        for e in edges:
            gt = e.geom_type
            n = 1 if gt == GeomType.LINE else 32
            pts = [e.position_at(i / n) for i in range(n + 1)]
            lines[which].append([(p.X, p.Y) for p in pts])
            verts.append((pts[0].X, pts[0].Y))
            verts.append((pts[-1].X, pts[-1].Y))
            if gt == GeomType.CIRCLE:
                ac = e.arc_center
                circles.append({"c": (ac.X, ac.Y), "r": float(e.radius), "full": e.is_closed, "hidden": which == "hidden"})
    allp = [p for pl in lines["visible"] + lines["hidden"] for p in pl]
    if not allp:
        raise DrawingError(f"the model projects to nothing in the {role} view")
    box = (min(p[0] for p in allp), min(p[1] for p in allp), max(p[0] for p in allp), max(p[1] for p in allp))
    return {"verts": verts, "circles": circles, "lines": lines, "box": box}


def _center(b):
    return ((b[0] + b[2]) / 2, (b[1] + b[3]) / 2)


def _map(p, bc, s, flip, mc):
    return ((p[0] - bc[0]) * s * flip[0] + mc[0], (p[1] - bc[1]) * s * flip[1] + mc[1])


def _unmap(q, bc, s, flip, mc):
    return ((q[0] - mc[0]) / (s * flip[0]) + bc[0], (q[1] - mc[1]) / (s * flip[1]) + bc[1])


def _coords_along(proj: dict, u) -> list[float]:
    out = [p[0] * u[0] + p[1] * u[1] for p in proj["verts"]]
    for c in proj["circles"]:
        a = c["c"][0] * u[0] + c["c"][1] * u[1]
        out += [a, a - c["r"], a + c["r"]]
    return out


def _snap(x: float, cands: list[float]) -> tuple[float, float]:
    best = min(cands, key=lambda c: abs(c - x))
    return best, abs(best - x)


def _measure(dim: dict, proj: dict, reg: dict) -> dict:
    """The model's value for one dimension under a registration; {model, residual} or {skip}."""
    bc, s, flip, mc = reg["bc"], reg["s"], reg["flip"], reg["mc"]
    kind = dim["kind"]
    anchors = dim.get("anchors_mm")
    if kind in ("linear", "aligned"):
        if not anchors or len(anchors) < 2 or not dim.get("direction"):
            return {"skip": "no anchors (the text is not tied to a dimension line)"}
        u0 = dim["direction"]
        u = (u0[0] * flip[0], u0[1] * flip[1])
        cands = _coords_along(proj, u)
        a, b = (_map(p, bc, s, flip, mc) for p in anchors[:2])
        ca, ra = _snap(a[0] * u[0] + a[1] * u[1], cands)
        cb, rb = _snap(b[0] * u[0] + b[1] * u[1], cands)
        return {"model": abs(cb - ca), "residual": max(ra, rb)}
    if kind in ("diameter", "radius"):
        feat = (dim.get("feature") or {}).get("circle")
        if feat:  # PDF: the circle the leader reaches
            center = feat["center_mm"]
        elif anchors and kind == "radius":  # DXF radius: defpoint is the centre
            center = anchors[0]
        elif anchors and len(anchors) >= 2:  # DXF diameter: the two ends of the diameter
            center = ((anchors[0][0] + anchors[1][0]) / 2, (anchors[0][1] + anchors[1][1]) / 2)
        else:
            return {"skip": "no circle tied to the dimension"}
        m = _map(center, bc, s, flip, mc)
        if not proj["circles"]:
            return {"skip": "the model shows no circle in this view"}
        best = min(proj["circles"], key=lambda c: math.dist(c["c"], m))
        return {"model": 2 * best["r"] if kind == "diameter" else best["r"], "residual": math.dist(best["c"], m)}
    return {"skip": f"{kind} dimensions are not compared yet"}


def _registration_scale(sheet: Sheet, dims: list[dict], vbox, proj) -> tuple[float, str]:
    ratios = [d["value_mm"] / d["geometryLength_mm"] for d in dims if d.get("value_mm") and d.get("geometryLength_mm") and d["kind"] in ("linear", "aligned", "diameter", "radius")]
    if ratios:
        return statistics.median(ratios), f"dimensions (median value/drawn length of {len(ratios)})"
    k, why = part_scale(sheet)
    if k:
        return k, why
    w = max(vbox[2] - vbox[0], 1e-9)
    return (proj["box"][2] - proj["box"][0]) / w, "extents (DEFAULT: no dimension and no stated scale; a uniformly wrong size cannot be seen this way)"


def _tol(dim: dict, default: float) -> tuple[float, float, str]:
    t = dim.get("tolerance")
    umm = 25.4 if dim.get("unit") == "in" else 1.0
    if t and (t.get("plus") or t.get("minus")):
        return float(t.get("plus") or 0) * umm, float(t.get("minus") or 0) * umm, t.get("source", "explicit")
    return default, default, "--tolerance" if default != DEFAULT_TOL_MM else "DEFAULT +/-0.1 mm"


def _overlay(root: Path, rec: dict, sheet: Sheet, view: dict, proj: dict, reg: dict) -> str:
    from PIL import ImageDraw

    b = view["box_mm"]
    m = MARGIN_FRACTION * max(b[2] - b[0], b[3] - b[1]) + MARGIN_MM
    box = (b[0] - m, b[1] - m, b[2] + m, b[3] + m)
    ppm = OVERLAY_DPI / 25.4

    def to_px(p):
        return ((p[0] - box[0]) * ppm, (box[3] - p[1]) * ppm)

    if sheet.kind == "pdf":
        img = sheet.raw.crop(sheet.pt_box(box), strict=False).to_image(resolution=OVERLAY_DPI).original.convert("RGB")
    else:
        img = render_dxf(sheet, box, OVERLAY_DPI)
    d = ImageDraw.Draw(img)
    for which, colour in (("hidden", (255, 150, 0)), ("visible", (220, 0, 0))):
        for pl in proj["lines"][which]:
            pts = [to_px(_unmap(q, reg["bc"], reg["s"], reg["flip"], reg["mc"])) for q in pl]
            d.line(pts, fill=colour, width=2 if which == "visible" else 1)
    out = cache_dir(root, rec["sha256"]) / f"overlay-{sheet.kind}{sheet.index}-{view['id']}-{view['role']}.png"
    out.parent.mkdir(parents=True, exist_ok=True)
    img.save(str(out), format="PNG")
    return str(out.relative_to(root)).replace("\\", "/")


def compare(root: Path, sheet: Sheet, rec: dict, model_path: Path, view_map: str | None = None, tolerance: float | None = None, overlay: bool = True) -> dict:
    t0 = time.perf_counter()
    dr = read_dimensions(sheet, rec)
    views = dr["views"]
    if view_map:
        for pair in view_map.split(","):
            if "=" not in pair:
                raise DrawingError("--view-map wants v1=front,v2=top")
            vid, role = (x.strip() for x in pair.split("=", 1))
            v = next((v for v in views if v["id"] == vid), None)
            if v is None:
                raise DrawingError(f"--view-map names {vid}, which is not a view on {sheet.name}")
            v["role"], v["roleReason"] = role.lower(), "--view-map"
    t1 = time.perf_counter()
    import build123d  # noqa: F401  (timed apart: importing OCCT is most of a cold compare)

    t2 = time.perf_counter()
    shape = load_model(model_path)
    t3 = time.perf_counter()
    default = tolerance if tolerance is not None else DEFAULT_TOL_MM
    per, extents, skipped, overlays = [], [], [], {}
    from . import file_record

    model_rec = file_record(root, model_path, "step")
    for v in views:
        if v["role"] not in CAMERAS:
            skipped.append({"view": v["id"], "role": v["role"], "reason": "not an orthographic principal view (iso, section, detail or unplaced): not re-projected"})
            continue
        proj = project(shape, v["role"])
        vdims = [d for d in dr["dimensions"] if d.get("view") == v["id"]]
        vbox = v["box_mm"]
        s, how = _registration_scale(sheet, vdims, vbox, proj)
        bc, mc = _center(vbox), _center(proj["box"])
        best = None
        for flip in FLIPS:
            reg = {"bc": bc, "s": s, "flip": flip, "mc": mc}
            res = [m["residual"] for m in (_measure(d, proj, reg) for d in vdims) if "residual" in m]
            score = sum(res) if res else 0.0
            if best is None or score < best[0] - 1e-9:
                best = (score, reg)
        reg = best[1]
        size = max(proj["box"][2] - proj["box"][0], proj["box"][3] - proj["box"][1])
        snap_limit = max(SNAP_MM, SNAP_FRACTION * size)
        dw, dh = (vbox[2] - vbox[0]) * s, (vbox[3] - vbox[1]) * s
        mw, mh = proj["box"][2] - proj["box"][0], proj["box"][3] - proj["box"][1]
        ext = {"view": v["id"], "role": v["role"], "drawing_mm": [r3(dw), r3(dh)], "model_mm": [r3(mw), r3(mh)], "delta_mm": [r3(mw - dw), r3(mh - dh)], "within": abs(mw - dw) <= default and abs(mh - dh) <= default, "scale": round(s, 6), "scaleFrom": how, "mirror": list(reg["flip"])}
        if "extents" in how:
            ext["within"] = None
            ext["note"] = "registered on the extents themselves: not a check"
        extents.append(ext)
        for d in vdims:
            m = _measure(d, proj, reg)
            plus, minus, tsrc = _tol(d, default)
            row = {"id": d["id"], "view": v["id"], "role": v["role"], "kind": d["kind"], "text": d.get("text"), "drawing": d.get("value_mm"), "unit": "mm", "tolerance": {"plus": plus, "minus": minus, "source": tsrc}}
            if "skip" in m:
                row.update({"model": None, "delta": None, "within": None, "note": m["skip"]})
            elif m["residual"] > snap_limit:
                row.update({"model": None, "delta": None, "within": None, "residual_mm": r3(m["residual"]), "note": f"unmatched: the nearest model feature is {m['residual']:.2f} mm from the drawing's anchor (limit {snap_limit:.2f} mm); see the extents"})
            else:
                delta = m["model"] - d["value_mm"]
                row.update({"model": r3(m["model"]), "delta": r3(delta), "within": -minus - 1e-9 <= delta <= plus + 1e-9, "residual_mm": r3(m["residual"])})
            if d.get("multiplicity", 1) > 1:
                row["multiplicity"] = d["multiplicity"]
                row.setdefault("note", f"{d['multiplicity']}X on the drawing: the one feature it points at was compared")
            per.append(row)
        if overlay:
            overlays[v["id"]] = _overlay(root, rec, sheet, v, proj, reg)
    unplaced = [d["id"] for d in dr["dimensions"] if not any(p["id"] == d["id"] for p in per)]
    checks = [p["within"] for p in per] + [e["within"] for e in extents]
    if any(c is False for c in checks):
        verdict = "disagrees"
    elif not per or any(c is None for c in checks) or unplaced:
        verdict = "incomplete"
    else:
        verdict = "agrees"
    out = {
        "model": model_rec,
        "verdict": verdict,
        "perDimension": per,
        "extents": extents,
        "skippedViews": skipped,
        "notCompared": unplaced,
        "projection": dr["projection"],
        "cameras": "DEFAULT Z-up: front looks along +Y, top down -Z, right along -X (see compare.py)",
        "times_ms": {"dimensions": round((t1 - t0) * 1000, 1), "build123d_import": round((t2 - t1) * 1000, 1), "model_load": round((t3 - t2) * 1000, 1), "project_and_compare": round((time.perf_counter() - t3) * 1000, 1), "total": round((time.perf_counter() - t0) * 1000, 1)},
        "provenance": {"method": "measured-from-drawing", "drawing": {"file": rec["path"], "sha256": rec["sha256"], "page": sheet.index, "sheet": sheet.name}, "model": {"file": model_rec["path"], "sha256": model_rec["sha256"]}},
    }
    if overlays:
        out["overlays"] = overlays
    return out
