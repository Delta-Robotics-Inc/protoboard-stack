"""Dimensions on a drawing (PB-1190, `drawing.dimensions`), one row per dimension:

    {id, kind (linear|aligned|diameter|radius|angle|ordinate), value, unit, value_mm, tolerance {plus, minus,
     source}, multiplicity, reference, text, anchors_mm (the two measured points, or the leader tip), direction,
     view, readings {text, geometry}, agree, confidence, notes, provenance {method: measured-from-drawing,
     file, sha256, page|sheet, entity}}

DXF: every DIMENSION entity. The value is the text the drawing shows: the override text when there is one,
else the measurement recomputed from the definition points, times DIMLFAC, rounded to DIMDEC. The two readings
are that text and the recomputed geometry; a hand-edited override that disagrees with the geometry is flagged,
never silently trusted. Tolerances come from the dimension style override (DIMTOL/DIMTP/DIMTM, DIMLIM) or the
text (%%p, +a/-b).

PDF: the page has no dimension entities. A text run that reads as a dimension (`100`, `60±0.1`, `4X Ø8`,
`R2.5`, `(12)`, `+0.06/-0.02` stacked beside it) is tied to the thin line parallel to it and nearest it (the
dimension line, joined across the gap the text leaves), whose ends are the anchors; `Ø` and `R` follow their
leader to its tip and the circle there. The second reading is the line's paper length times the sheet's
stated scale (or, for a sheet that does not state one or says Not To Scale, the median value/length ratio of
the page, which only checks consistency).

Values are always the drawing's text, never scaled geometry. Anchors are mm, y up, sheet coordinates.
"""
from __future__ import annotations

import math
import re
import statistics

from . import DIMENSIONS_SCHEMA, PROVENANCE, r3, r3v
from .inspect import scale_hint
from .sheet import Sheet
from .views import find_views, view_for_point

NUM = r"(?:\d+(?:[.,]\d+)?|[.,]\d+)"
DIM_TEXT = re.compile(
    rf"^\s*(?:(?P<count>\d+)\s*[Xx×]\s*)?(?P<ref>\()?\s*(?P<prefix>Ø|⌀|%%[cC]|SR|R|M)?\s*(?P<val>{NUM})\s*(?P<deg>°|%%[dD])?"
    rf"\s*(?:(?:±|%%[pP]|\+/-)\s*(?P<pm>{NUM})|\+\s*(?P<up>{NUM})\s*/?\s*-\s*(?P<lo>{NUM}))?\s*(?P<unit>mm|in|\")?\s*\)?\s*(?P<suffix>TYP\.?|THRU|MAX\.?|MIN\.?|REF\.?)?\s*$"
)
STACKED = re.compile(rf"^\s*(?P<sign>[+-])\s*(?P<v>{NUM})\s*$")
AGREE_FRACTION = 0.02  # DEFAULT: text and geometry readings agree within 2 % (or the tolerance, when larger)
OUTLIER_FRACTION = 0.05  # DEFAULT: a value/length ratio 5 % off the page median is flagged


def num(s: str | None) -> float | None:
    if s is None:
        return None
    s = s.replace(",", ".")
    return float("0" + s if s.startswith(".") else s)


def parse_text(text: str) -> dict | None:
    """A dimension's text as {value, kind hint, tolerance, multiplicity, reference}; None when it is not one."""
    m = DIM_TEXT.match(text.replace("−", "-"))
    if not m:
        return None
    pre = (m.group("prefix") or "").upper()
    out = {"value": num(m.group("val")), "multiplicity": int(m.group("count")) if m.group("count") else 1, "reference": bool(m.group("ref")) or (m.group("suffix") or "").upper().startswith("REF")}
    out["kindHint"] = "angle" if m.group("deg") else "diameter" if pre in ("Ø", "⌀", "%%C") else "radius" if pre in ("R", "SR") else "thread" if pre == "M" else "linear"
    if m.group("pm"):
        out["tolerance"] = {"plus": num(m.group("pm")), "minus": num(m.group("pm")), "source": "explicit"}
    elif m.group("up"):
        out["tolerance"] = {"plus": num(m.group("up")), "minus": num(m.group("lo")), "source": "explicit"}
    if m.group("unit"):
        out["unit"] = "in" if m.group("unit") in ("in", '"') else "mm"
    if m.group("suffix"):
        out["suffix"] = m.group("suffix").upper()
    return out


def _u(deg: float):
    return (math.cos(math.radians(deg)), math.sin(math.radians(deg)))


def _dot(a, b):
    return a[0] * b[0] + a[1] * b[1]


def _sub(a, b):
    return (a[0] - b[0], a[1] - b[1])


def _box_gap(box, p) -> float:
    dx = max(box[0] - p[0], 0.0, p[0] - box[2])
    dy = max(box[1] - p[1], 0.0, p[1] - box[3])
    return math.hypot(dx, dy)


# ------------------------------------------------------------------------------------------------
# DXF
# ------------------------------------------------------------------------------------------------

DXF_KINDS = {0: "linear", 1: "aligned", 2: "angle", 3: "diameter", 4: "radius", 5: "angle", 6: "ordinate"}


def _plain(text: str) -> str:
    from ezdxf.tools.text import plain_mtext

    return plain_mtext(text).replace("%%c", "Ø").replace("%%C", "Ø").replace("%%p", "±").replace("%%P", "±").replace("%%d", "°").replace("%%D", "°")


def dxf_dimensions(sheet: Sheet, file: dict, views: list[dict]) -> list[dict]:
    rows = []
    k = sheet.unit_to_mm
    for n, e in enumerate(sheet.dims, start=1):
        handle = e.dxf.get("handle", "?")
        kind = DXF_KINDS.get(e.dimtype, "linear")
        notes = []
        ov = e.override()
        lfac = float(ov.get("dimlfac") or 1.0)
        dec = int(ov.get("dimdec") if ov.get("dimdec") is not None else 4)
        try:
            meas = e.get_measurement()
        except Exception as ex:
            meas = None
            notes.append(f"the measurement could not be recomputed ({type(ex).__name__})")
        is_angle = kind == "angle"
        measured = None
        if isinstance(meas, (int, float)):
            measured = float(meas) if is_angle else float(meas) * lfac
        raw = str(e.dxf.get("text", "") or "")
        shown = _plain(raw) if raw not in ("", "<>") else ""
        if "<>" in raw and measured is not None:
            shown = _plain(raw.replace("<>", f"{round(measured, dec):g}"))
        parsed = parse_text(shown) if shown else None
        if shown and not parsed:
            notes.append(f"the override text {shown!r} is not a number: kept as text, value from the geometry")
        value = parsed["value"] if parsed else (round(measured, dec) if measured is not None else None)
        source = "override text" if parsed else "measured (definition points)"
        tol = None
        if int(ov.get("dimtol") or 0):
            tol = {"plus": float(ov.get("dimtp") or 0.0), "minus": float(ov.get("dimtm") or 0.0), "source": "explicit (dimension style)"}
        elif int(ov.get("dimlim") or 0):
            tol = {"plus": float(ov.get("dimtp") or 0.0), "minus": float(ov.get("dimtm") or 0.0), "source": "limits (dimension style)"}
        if parsed and parsed.get("tolerance"):
            tol = parsed["tolerance"]
        agree = None
        if parsed and measured is not None:
            # the override must say what the geometry rounds to (one unit in the last shown decimal)
            agree = abs(parsed["value"] - round(measured, dec)) <= 10 ** -dec + 1e-9
            if not agree:
                notes.append(f"the override text says {parsed['value']:g} but the geometry measures {measured:.{dec}f}: hand-edited or not to scale; a person decides")
        P = lambda v: (float(v[0]) * k, float(v[1]) * k)  # noqa: E731
        d = e.dxf
        anchors, direction, glen = None, None, None
        if kind in ("linear", "aligned") and d.hasattr("defpoint2") and d.hasattr("defpoint3"):
            a, b = P(d.defpoint2), P(d.defpoint3)
            u = _u(float(d.get("angle", 0.0))) if kind == "linear" else _unit(_sub(b, a))
            anchors, direction = [a, b], u
            glen = abs(_dot(_sub(b, a), u))
        elif kind == "diameter" and d.hasattr("defpoint4"):
            a, b = P(d.defpoint), P(d.defpoint4)
            anchors, glen = [a, b], math.dist(a, b)
            direction = _unit(_sub(b, a))
        elif kind == "radius" and d.hasattr("defpoint4"):
            a, b = P(d.defpoint), P(d.defpoint4)
            anchors, glen = [a, b], math.dist(a, b)
            direction = _unit(_sub(b, a))
        mid = ((anchors[0][0] + anchors[1][0]) / 2, (anchors[0][1] + anchors[1][1]) / 2) if anchors else P(d.get("text_midpoint", (0, 0, 0)))
        unit = (parsed or {}).get("unit") or sheet.unit
        umm = 25.4 if unit == "in" else 1.0 if unit == "mm" else k
        row = {
            "id": f"s{sheet.index}-d{n}",
            "kind": kind,
            "value": value,
            "unit": "deg" if is_angle else unit,
            "value_mm": None if is_angle or value is None else r3(value * umm),
            "tolerance": tol,
            "multiplicity": (parsed or {}).get("multiplicity", 1),
            "reference": (parsed or {}).get("reference", False),
            "text": shown or None,
            "anchors_mm": [r3v(p) for p in anchors] if anchors else None,
            "direction": r3v(direction) if direction else None,
            "geometryLength_mm": r3(glen) if glen is not None else None,
            "view": view_for_point(views, mid) if views else None,
            "readings": {"text": parsed["value"] if parsed else None, "geometry": None if measured is None else round(measured, max(dec, 3)), "valueFrom": source},
            "agree": agree,
            "confidence": "high" if (agree is not False and measured is not None) else "low",
            "provenance": {"method": PROVENANCE, "file": file["path"], "sha256": file["sha256"], "sheet": sheet.name, "entity": f"DIMENSION:{handle}", "reading": "vector-dxf"},
        }
        if lfac != 1.0:
            notes.append(f"DIMLFAC {lfac:g}: the value is {lfac:g} x the drawn length")
        if notes:
            row["notes"] = notes
        rows.append(row)
    return rows


def _unit(v):
    n = math.hypot(v[0], v[1])
    return (v[0] / n, v[1] / n) if n else (1.0, 0.0)


# ------------------------------------------------------------------------------------------------
# PDF
# ------------------------------------------------------------------------------------------------

def _parallel(seg, u, tol=0.05) -> bool:
    d = _unit(_sub(seg.b, seg.a))
    return abs(d[0] * u[1] - d[1] * u[0]) < tol


def _dimension_line(sheet: Sheet, t, u):
    """The dimension line for text `t` reading along `u`: (a, b, [seg srcs]) or None."""
    v = (-u[1], u[0])
    c = t.center
    size = max(t.size, 0.5)
    tlen = abs(_dot(_sub((t.box[2], t.box[3]), (t.box[0], t.box[1])), u))
    cands = []
    for s in sheet.segs:
        if not s.anno or s.length < 1e-6 or not _parallel(s, u):
            continue
        off = _dot(_sub(s.a, c), v)
        if abs(off) > 2.5 * size:
            continue
        s0, s1 = sorted((_dot(_sub(s.a, c), u), _dot(_sub(s.b, c), u)))
        reach = tlen / 2 + 2 * size
        if s1 < -reach or s0 > reach:
            continue
        cands.append((abs(off), off, s0, s1, s))
    if not cands:
        return None
    cands.sort(key=lambda x: x[0])
    off = cands[0][1]
    line = sorted([x for x in cands if abs(x[1] - off) < 0.2], key=lambda x: x[2])
    # all collinear thin segments on that offset, chained across gaps up to the text's length (a line broken for its text)
    same = sorted([(_dot(_sub(s.a, c), u), _dot(_sub(s.b, c), u), s) for s in sheet.segs if s.anno and s.length > 1e-6 and _parallel(s, u) and abs(_dot(_sub(s.a, c), v) - off) < 0.2], key=lambda x: min(x[0], x[1]))
    lo, hi = min(line[0][2], line[0][3]), max(line[0][2], line[0][3])
    srcs = {line[0][4].src}
    changed = True
    while changed:
        changed = False
        for a0, a1, s in same:
            s0, s1 = min(a0, a1), max(a0, a1)
            if s.src in srcs and lo <= s0 and s1 <= hi:
                continue
            if s1 >= lo - (tlen + 2 * size) and s0 <= hi + (tlen + 2 * size) and (s0 < lo or s1 > hi):
                lo, hi = min(lo, s0), max(hi, s1)
                srcs.add(s.src)
                changed = True
    a = (c[0] + u[0] * lo + v[0] * off, c[1] + u[1] * lo + v[1] * off)
    b = (c[0] + u[0] * hi + v[0] * off, c[1] + u[1] * hi + v[1] * off)
    return a, b, sorted(srcs)


def _arrows_at(sheet: Sheet, p, reach=3.5) -> int:
    return sum(1 for f in sheet.fills if math.dist(f.center, p) <= reach)


def _extension_end(sheet: Sheet, p, u):
    """The far end of a thin line perpendicular to `u` that touches `p` (an extension line), or None."""
    best = None
    for s in sheet.segs:
        if not s.anno or s.length < 1e-6 or _parallel(s, u, 0.9):
            continue
        d = _unit(_sub(s.b, s.a))
        if abs(_dot(d, u)) > 0.05:
            continue
        # p lies on the segment's line, within its span (or within 1 mm of it)
        w = _sub(p, s.a)
        if abs(w[0] * d[1] - w[1] * d[0]) > 0.3:
            continue
        ends = sorted([s.a, s.b], key=lambda q: math.dist(q, p))
        if math.dist(ends[0], p) > s.length + 1.0:
            continue
        far = ends[1]
        if best is None or math.dist(far, p) > math.dist(best, p):
            best = far
    return best


def _leader_tip(sheet: Sheet, t):
    """Follow a leader from text `t` to its tip: (tip, [srcs]) or None."""
    size = max(t.size, 0.5)
    start, near = None, math.inf
    for s in sheet.segs:
        if not s.anno:
            continue
        for p, q in ((s.a, s.b), (s.b, s.a)):
            g = _box_gap(t.box, p)
            if g < min(1.2 * size, near):
                start, near = (s, p, q), g
    if not start:
        return None
    s, _, q = start
    srcs, tip = [s.src], q
    for _ in range(4):
        nxt = None
        for s2 in sheet.segs:
            if not s2.anno or s2.src in srcs:
                continue
            for p, q2 in ((s2.a, s2.b), (s2.b, s2.a)):
                if math.dist(p, tip) < 0.3:
                    nxt = (s2, q2)
        if not nxt:
            break
        srcs.append(nxt[0].src)
        tip = nxt[1]
    return tip, srcs


def pdf_dimensions(sheet: Sheet, file: dict, views_result: dict) -> list[dict]:
    views = views_result["views"]
    title = views_result.get("titleBlock", {}).get("box_mm")
    scale = scale_hint(sheet)
    factor = scale["factor"] if scale and scale.get("factor") and not scale.get("notToScale") else None
    used_stacks = set()
    rows = []
    texts = sheet.texts
    for k, t in enumerate(texts):
        if title and _box_gap(title, t.center) == 0.0:
            continue
        parsed = parse_text(t.text)
        if not parsed or k in used_stacks:
            continue
        u = _u(t.angle)
        notes, srcs = [], [t.src]
        tol = parsed.get("tolerance")
        if not tol:
            # a stacked tolerance: two smaller runs just after the value, along the text
            stack = []
            for j, t2 in enumerate(texts):
                if j == k or t2.angle != t.angle or t2.size > 0.9 * t.size:
                    continue
                m = STACKED.match(t2.text)
                if not m:
                    continue
                along = _dot(_sub(t2.center, t.center), u)
                if 0 < along < abs(_dot(_sub((t.box[2], t.box[3]), (t.box[0], t.box[1])), u)) / 2 + 2.5 * t.size and abs(_dot(_sub(t2.center, t.center), (-u[1], u[0]))) < 1.2 * t.size:
                    stack.append((j, m))
            if stack:
                plus = next((num(m.group("v")) for _, m in stack if m.group("sign") == "+"), None)
                minus = next((num(m.group("v")) for _, m in stack if m.group("sign") == "-"), None)
                tol = {"plus": plus or 0.0, "minus": minus or 0.0, "source": "explicit (stacked)"}
                for j, _ in stack:
                    used_stacks.add(j)
                    srcs.append(texts[j].src)
        kind = parsed["kindHint"]
        anchors, direction, glen, arrows, feature = None, None, None, 0, None
        if kind in ("diameter", "radius"):
            lead = _leader_tip(sheet, t)
            circ = None
            if lead:
                tip, lsrcs = lead
                srcs += lsrcs
                arrows = _arrows_at(sheet, tip)
                cands = [c for c in sheet.circs if not c.anno]
                if cands:
                    circ = min(cands, key=lambda c: abs(math.dist(c.c, tip) - c.r))
                    if abs(math.dist(circ.c, tip) - circ.r) > 1.0:
                        circ = None
                anchors = [tip]
            if circ is None:
                cands = [c for c in sheet.circs if not c.anno]
                if cands:
                    circ = min(cands, key=lambda c: math.dist(c.c, t.center))
                    notes.append("no leader reached a circle: the nearest circle was taken")
            if circ is not None:
                feature = {"circle": {"center_mm": r3v(circ.c), "r_mm": r3(circ.r), "src": circ.src}}
                glen = 2 * circ.r if kind == "diameter" else circ.r
                anchors = (anchors or []) + [circ.c]
                srcs.append(circ.src)
        else:
            line = _dimension_line(sheet, t, u)
            if line:
                a, b, lsrcs = line
                srcs += lsrcs
                anchors, direction, glen = [a, b], u, math.dist(a, b)
                arrows = _arrows_at(sheet, a) + _arrows_at(sheet, b)
                ea, eb = _extension_end(sheet, a, u), _extension_end(sheet, b, u)
                if ea or eb:
                    feature = {"extensionEnds_mm": [r3v(ea) if ea else None, r3v(eb) if eb else None]}
            else:
                notes.append("no dimension line found next to the text: a note or a table value, not tied to geometry")
        unit = parsed.get("unit") or sheet.unit
        umm = 25.4 if unit == "in" else 1.0
        geometry = None
        if glen is not None and factor and kind != "angle":
            geometry = glen * factor / umm
        agree = None
        if geometry is not None:
            slack = max(AGREE_FRACTION * parsed["value"], (tol or {}).get("plus") or 0.0)
            agree = abs(geometry - parsed["value"]) <= slack
            if not agree:
                notes.append(f"the line measures {geometry:.3f} {unit} at the stated scale {scale['ratio']}, not {parsed['value']:g}: not to scale, or the text is tied to the wrong line")
        if anchors is None:
            confidence = "low"
        elif kind in ("diameter", "radius"):
            confidence = "high" if feature and arrows else "medium" if feature else "low"
        else:
            confidence = "high" if arrows >= 2 else "medium" if arrows == 1 or feature else "low"
        if agree is False:
            confidence = "low"
        mid = anchors[0] if anchors and len(anchors) == 1 else ((anchors[0][0] + anchors[1][0]) / 2, (anchors[0][1] + anchors[1][1]) / 2) if anchors else t.center
        row = {
            "id": f"p{sheet.index}-d{len(rows) + 1}",
            "kind": kind,
            "value": parsed["value"],
            "unit": "deg" if kind == "angle" else unit,
            "value_mm": None if kind == "angle" else r3(parsed["value"] * umm),
            "tolerance": tol,
            "multiplicity": parsed["multiplicity"],
            "reference": parsed["reference"],
            "text": t.text,
            "textBox_mm": r3v(t.box),
            "anchors_mm": [r3v(p) for p in anchors] if anchors else None,
            "direction": r3v(direction) if direction else None,
            "geometryLength_mm": r3(glen) if glen is not None else None,
            "arrowheads": arrows,
            "view": view_for_point(views, mid) if views else None,
            "readings": {"text": parsed["value"], "geometry": None if geometry is None else round(geometry, 4), "valueFrom": "text"},
            "agree": agree,
            "confidence": confidence,
            "provenance": {"method": PROVENANCE, "file": file["path"], "sha256": file["sha256"], "page": sheet.index, "entity": ",".join(srcs), "reading": "vector-pdf"},
        }
        if feature:
            row["feature"] = feature
        if parsed.get("suffix"):
            row["suffix"] = parsed["suffix"]
        if notes:
            row["notes"] = notes
        rows.append(row)
    return rows


def scale_consistency(rows: list[dict]) -> dict | None:
    """The value / drawn-length ratio across linear and diameter rows: the median, and the rows off it."""
    ratios = [(r["id"], r["value_mm"] / r["geometryLength_mm"]) for r in rows if r.get("value_mm") and r.get("geometryLength_mm") and r["kind"] in ("linear", "aligned", "diameter", "radius")]
    if not ratios:
        return None
    med = statistics.median(x for _, x in ratios)
    off = [i for i, x in ratios if abs(x - med) > OUTLIER_FRACTION * med]
    return {"medianRatio": round(med, 5), "rows": len(ratios), "outliers": off, "note": "part mm per drawn mm; 1.0 on a 1:1 sheet"}


def dimensions(sheet: Sheet, file: dict) -> dict:
    vr = find_views(sheet)
    rows = dxf_dimensions(sheet, file, vr["views"]) if sheet.kind == "dxf" else pdf_dimensions(sheet, file, vr)
    sc = scale_consistency(rows)
    stated = scale_hint(sheet)
    if sc and stated and stated.get("notToScale"):
        sc["note"] += "; the sheet says Not To Scale, so a spread is expected and no row is flagged for it"
        sc["flagged"] = False
    elif sc:
        sc["flagged"] = True
        for r in rows:
            if r["id"] in sc["outliers"]:
                r.setdefault("notes", []).append(f"its value/length ratio is off the page median {sc['medianRatio']}: check the reading or the line it is tied to")
    out = {"schema": DIMENSIONS_SCHEMA, "sheet": sheet.name, "page": sheet.index, "unit": sheet.unit, "dimensions": rows, "views": vr["views"], "projection": vr["projection"], "scale": stated, "scaleConsistency": sc}
    if not rows:
        out["note"] = "no dimensions found" + (" (no text layer: OCR or a person must read this sheet)" if not sheet.texts else "")
    return out
