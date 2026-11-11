"""One page or sheet of a drawing as plain primitives, in mm with y up (PB-1190).

PDF: page points become paper mm (x * 25.4 / 72, y measured up from the page's bottom). Text comes from the
page's characters (pdfplumber), grouped into runs along each character's own direction, so text rotated 90
degrees reads in order. Lines, rectangles and curves become segments; a small filled shape becomes a `Fill`
(an arrowhead, usually); a closed curve whose box is square becomes a `Circ`.

DXF: a layout's entities, blocks expanded (INSERT, and the anonymous block each DIMENSION draws) to a fixed
depth and count, in model units converted to mm by $INSUNITS. DIMENSION entities are kept as they are for
`dimensions.py`; what they draw is kept as annotation primitives.

`anno` marks a primitive that is annotation (dimension, text, leader, thin line work) rather than the part's
geometry; `views.py` clusters only the geometry.
"""
from __future__ import annotations

import math
import statistics
from dataclasses import dataclass, field
from pathlib import Path

from . import MAX_DXF_ENTITIES, MAX_PAGES, PT_TO_MM, DrawingError

THIN_SHARE = 0.05  # DEFAULT: a stroke width class needs 5 % of the strokes to count as the thin (annotation) class


@dataclass
class Seg:
    a: tuple[float, float]
    b: tuple[float, float]
    width: float = 0.0
    dashed: bool = False
    src: str = ""
    anno: bool = False

    @property
    def length(self) -> float:
        return math.hypot(self.b[0] - self.a[0], self.b[1] - self.a[1])

    def bbox(self):
        return (min(self.a[0], self.b[0]), min(self.a[1], self.b[1]), max(self.a[0], self.b[0]), max(self.a[1], self.b[1]))


@dataclass
class Circ:
    c: tuple[float, float]
    r: float
    width: float = 0.0
    full: bool = True
    src: str = ""
    anno: bool = False

    def bbox(self):
        return (self.c[0] - self.r, self.c[1] - self.r, self.c[0] + self.r, self.c[1] + self.r)


@dataclass
class Fill:
    box: tuple[float, float, float, float]
    src: str = ""

    @property
    def center(self):
        return ((self.box[0] + self.box[2]) / 2, (self.box[1] + self.box[3]) / 2)


@dataclass
class Text:
    text: str
    box: tuple[float, float, float, float]
    angle: float  # degrees, the reading direction
    size: float  # mm, the text height
    src: str = ""

    @property
    def center(self):
        return ((self.box[0] + self.box[2]) / 2, (self.box[1] + self.box[3]) / 2)


@dataclass
class Sheet:
    kind: str  # pdf | dxf
    index: int  # 1-based page number, or layout index
    name: str  # "page 1", or the DXF layout name
    box: tuple[float, float, float, float]  # the sheet's extent, mm
    unit: str  # the drawing's length unit: mm or in (PDF: from the text, DEFAULT mm)
    unit_to_mm: float
    segs: list[Seg] = field(default_factory=list)
    circs: list[Circ] = field(default_factory=list)
    fills: list[Fill] = field(default_factory=list)
    texts: list[Text] = field(default_factory=list)
    dims: list = field(default_factory=list)  # DXF DIMENSION entities
    images: list = field(default_factory=list)  # PDF: raster images on the page (box mm)
    page_pt: tuple[float, float] | None = None  # PDF: page width and height, pt
    notes: list[str] = field(default_factory=list)
    raw: object = None  # pdfplumber page, or the ezdxf layout

    def pt_box(self, box_mm):
        """A y-up mm box as pdfplumber's (x0, top, x1, bottom) in points from the top-left."""
        H = self.page_pt[1]
        x0, y0, x1, y1 = box_mm
        return (x0 / PT_TO_MM, H - y1 / PT_TO_MM, x1 / PT_TO_MM, H - y0 / PT_TO_MM)

    def all_text(self) -> str:
        return "\n".join(t.text for t in self.texts)


def union(boxes):
    boxes = list(boxes)
    if not boxes:
        return None
    return (min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes))


# ------------------------------------------------------------------------------------------------
# PDF
# ------------------------------------------------------------------------------------------------

def open_pdf(path: Path):
    import pdfplumber

    try:
        pdf = pdfplumber.open(str(path))
        n = len(pdf.pages)
    except Exception as e:  # pdfminer raises many types on a damaged or password-protected file
        raise DrawingError(f"{path.name}: not a PDF that can be read ({type(e).__name__}: {str(e)[:160]})")
    if n > MAX_PAGES:
        pdf.close()
        raise DrawingError(f"{path.name} has {n} pages, over the {MAX_PAGES} page cap")
    return pdf


def _char_runs(chars, H: float) -> list[Text]:
    """Group characters into runs along their own direction (rotated text included), y-up mm."""
    items = []
    for c in chars:
        a, b = c["matrix"][0], c["matrix"][1]
        ang = round(math.degrees(math.atan2(b, a))) % 360
        u = (math.cos(math.radians(ang)), math.sin(math.radians(ang)))
        v = (-u[1], u[0])
        x0, x1, y0, y1 = c["x0"], c["x1"], H - c["bottom"], H - c["top"]
        corners = [(x0, y0), (x1, y0), (x0, y1), (x1, y1)]
        su = [p[0] * u[0] + p[1] * u[1] for p in corners]
        sv = [p[0] * v[0] + p[1] * v[1] for p in corners]
        items.append({"ch": c["text"], "ang": ang, "s0": min(su), "s1": max(su), "t0": min(sv), "t1": max(sv), "box": (x0, y0, x1, y1)})
    runs: list[Text] = []
    by_angle: dict[int, list] = {}
    for it in items:
        by_angle.setdefault(it["ang"], []).append(it)
    for ang, its in sorted(by_angle.items()):
        its.sort(key=lambda i: (i["t0"] + i["t1"]) / 2)
        lines: list[list] = []
        for it in its:
            size = it["t1"] - it["t0"] or 1.0
            tm = (it["t0"] + it["t1"]) / 2
            if lines:
                last = lines[-1]
                ltm = statistics.fmean((i["t0"] + i["t1"]) / 2 for i in last)
                lsize = max(i["t1"] - i["t0"] for i in last) or size
                if abs(tm - ltm) <= 0.35 * max(size, lsize):
                    last.append(it)
                    continue
            lines.append([it])
        for line in lines:
            line.sort(key=lambda i: i["s0"])
            cur: list = []
            for it in line:
                size = it["t1"] - it["t0"] or 1.0
                if cur and it["s0"] - cur[-1]["s1"] > 0.8 * size:
                    runs.append(_run(cur, ang))
                    cur = []
                cur.append(it)
            if cur:
                runs.append(_run(cur, ang))
    return [r for r in runs if r.text.strip()]


def _run(its, ang) -> Text:
    text = "".join(i["ch"] for i in its).strip()
    box = union(i["box"] for i in its)
    size = statistics.median(i["t1"] - i["t0"] for i in its if i["ch"].strip()) if any(i["ch"].strip() for i in its) else 0.0
    m = PT_TO_MM
    return Text(text=text, box=(box[0] * m, box[1] * m, box[2] * m, box[3] * m), angle=float(ang), size=size * m)


def _pts_mm(pts, H):
    return [(x * PT_TO_MM, (H - y) * PT_TO_MM) for x, y in pts]


def _dashed(obj) -> bool:
    d = obj.get("dash")
    return bool(d and d[0])


def pdf_sheet(pdf, index: int) -> Sheet:
    page = pdf.pages[index - 1]
    W, H = float(page.width), float(page.height)
    s = Sheet(kind="pdf", index=index, name=f"page {index}", box=(0.0, 0.0, W * PT_TO_MM, H * PT_TO_MM), unit="mm", unit_to_mm=1.0, page_pt=(W, H), raw=page)
    for i, ln in enumerate(page.lines):
        p = _pts_mm(ln["pts"], H)
        for j in range(len(p) - 1):
            s.segs.append(Seg(p[j], p[j + 1], float(ln.get("linewidth") or 0), _dashed(ln), f"line:{i}"))
    for i, rc in enumerate(page.rects):
        x0, y0, x1, y1 = rc["x0"] * PT_TO_MM, rc["y0"] * PT_TO_MM, rc["x1"] * PT_TO_MM, rc["y1"] * PT_TO_MM
        if rc.get("fill") and not rc.get("stroke") and max(x1 - x0, y1 - y0) < 4.0:
            s.fills.append(Fill((x0, y0, x1, y1), f"rect:{i}"))
            continue
        w = float(rc.get("linewidth") or 0)
        corners = [(x0, y0), (x1, y0), (x1, y1), (x0, y1), (x0, y0)]
        for j in range(4):
            s.segs.append(Seg(corners[j], corners[j + 1], w, _dashed(rc), f"rect:{i}"))
    for i, cv in enumerate(page.curves):
        p = _pts_mm(cv["pts"], H)
        if not p:
            continue
        xs, ys = [q[0] for q in p], [q[1] for q in p]
        bw, bh = max(xs) - min(xs), max(ys) - min(ys)
        w = float(cv.get("linewidth") or 0)
        if cv.get("fill") and max(bw, bh) < 4.0:
            s.fills.append(Fill((min(xs), min(ys), max(xs), max(ys)), f"curve:{i}"))
            continue
        has_bezier = any(op[0] == "c" for op in (cv.get("path") or []))
        closed = math.dist(p[0], p[-1]) < 0.05 * max(bw, bh, 1e-6)
        if has_bezier and closed and bw > 0 and abs(bw - bh) <= 0.1 * max(bw, bh):
            cx, cy = (max(xs) + min(xs)) / 2, (max(ys) + min(ys)) / 2
            r = (bw + bh) / 4
            if all(abs(math.dist(q, (cx, cy)) - r) <= 0.08 * r for q in p):
                s.circs.append(Circ((cx, cy), r, w, True, f"curve:{i}"))
                continue
        for j in range(len(p) - 1):
            s.segs.append(Seg(p[j], p[j + 1], w, _dashed(cv), f"curve:{i}"))
    s.texts = _char_runs(page.chars, H)
    for k, t in enumerate(s.texts):
        t.src = f"text:{k}"
    for i, im in enumerate(page.images):
        s.images.append({"box": (im["x0"] * PT_TO_MM, (H - im["bottom"]) * PT_TO_MM, im["x1"] * PT_TO_MM, (H - im["top"]) * PT_TO_MM), "src": f"image:{i}", "px": [im.get("srcsize", (0, 0))[0], im.get("srcsize", (0, 0))[1]]})
    # the drawing's unit, from its text (DEFAULT mm)
    low = s.all_text().upper()
    if any(k in low for k in ("INCHES", "UNITS: IN", "UNIT: IN", "DIMENSIONS IN IN")):
        s.unit, s.unit_to_mm = "in", 25.4
    _mark_annotation(s)
    return s


def _mark_annotation(s: Sheet) -> None:
    """PDF has no 'this is a dimension' tag. DEFAULT rule (ISO 128 line weights): when the page uses more
    than one stroke width, solid strokes of the thin class are dimension, extension and leader lines; dashed
    strokes stay geometry (hidden and centre lines); small filled shapes are arrowheads. The thin class is the
    thinnest width that carries at least THIN_SHARE of the strokes (a handful of hairlines does not count),
    and anything thinner goes with it."""
    from collections import Counter

    strokes = [x for x in s.segs + s.circs if x.width > 0]
    widths = Counter(round(x.width, 2) for x in strokes)
    if len(widths) < 2:
        s.notes.append("one stroke width on the page: dimension lines cannot be told from outlines by weight")
        return
    total = sum(widths.values())
    ranked = sorted(widths)
    thin = next((w for w in ranked[:-1] if widths[w] >= THIN_SHARE * total), None)
    if thin is None:
        s.notes.append("no thin stroke class with a real share of the page: dimension lines cannot be told from outlines by weight")
        return
    for x in s.segs + s.circs:
        if 0 < round(x.width, 2) <= thin and not getattr(x, "dashed", False):
            x.anno = True


# ------------------------------------------------------------------------------------------------
# DXF
# ------------------------------------------------------------------------------------------------

INSUNITS = {0: ("unitless", 1.0), 1: ("in", 25.4), 2: ("ft", 304.8), 4: ("mm", 1.0), 5: ("cm", 10.0), 6: ("m", 1000.0), 8: ("microinch", 25.4e-6), 9: ("mil", 0.0254), 10: ("yd", 914.4), 14: ("dm", 100.0)}


def open_dxf(path: Path):
    import ezdxf
    from ezdxf import recover

    try:
        doc, auditor = recover.readfile(str(path))
    except (IOError, ezdxf.DXFStructureError) as e:
        raise DrawingError(f"{path.name}: not a DXF that can be read ({type(e).__name__}: {str(e)[:160]})")
    return doc, auditor


def dxf_layouts(doc) -> list:
    """Model space first, then the paper space layouts that have entities."""
    out = [doc.modelspace()]
    for name in doc.layout_names_in_taborder():
        if name.lower() == "model":
            continue
        lay = doc.layouts.get(name)
        if lay is not None and len(lay):
            out.append(lay)
    return out


def dxf_sheet(doc, index: int = 1) -> Sheet:
    from ezdxf import path as epath

    layouts = dxf_layouts(doc)
    if not 1 <= index <= len(layouts):
        raise DrawingError(f"sheet {index} does not exist (the file has {len(layouts)}: {', '.join(l.name for l in layouts)})")
    lay = layouts[index - 1]
    code = int(doc.header.get("$INSUNITS", 0) or 0)
    unit, k = INSUNITS.get(code, ("unitless", 1.0))
    s = Sheet(kind="dxf", index=index, name=lay.name, box=(0, 0, 0, 0), unit="mm" if unit == "unitless" else unit, unit_to_mm=k, raw=lay)
    if unit == "unitless":
        s.notes.append("$INSUNITS is 0 (unitless): DEFAULT mm")
    count = [0]

    def P(v):
        return (float(v[0]) * k, float(v[1]) * k)

    def add_text(e, anno=True):
        t = e.dxftype()
        try:
            if t == "MTEXT":
                lines = [ln for ln in e.plain_text().split("\n") if ln.strip()]
                h = float(e.dxf.get("char_height", 2.5)) * k
                ang = float(e.get_rotation())
                ins = P(e.dxf.insert)
            else:
                lines = [e.plain_text()] if hasattr(e, "plain_text") else [e.dxf.get("text", "")]
                h = float(e.dxf.get("height", 2.5)) * k
                ang = float(e.dxf.get("rotation", 0.0))
                ins = P(e.dxf.insert)
        except Exception:
            return
        u = (math.cos(math.radians(ang)), math.sin(math.radians(ang)))
        v = (-u[1], u[0])
        for n, line in enumerate(lines):
            line = line.strip()
            if not line:
                continue
            # DEFAULT box: 0.6 x height per character along the text; MTEXT lines stack downward
            off = -n * 1.5 * h if t == "MTEXT" else 0.0
            base = (ins[0] + v[0] * off, ins[1] + v[1] * off)
            if t == "MTEXT":
                base = (base[0] - v[0] * h, base[1] - v[1] * h)
            wlen = 0.6 * h * len(line)
            pts = [base, (base[0] + u[0] * wlen, base[1] + u[1] * wlen), (base[0] + v[0] * h, base[1] + v[1] * h), (base[0] + u[0] * wlen + v[0] * h, base[1] + u[1] * wlen + v[1] * h)]
            s.texts.append(Text(line, union([(p[0], p[1], p[0], p[1]) for p in pts]), ang % 360, h, f"{t}:{e.dxf.get('handle', '?')}"))

    def walk(entities, depth: int, anno: bool, owner: str | None):
        for e in entities:
            count[0] += 1
            if count[0] > MAX_DXF_ENTITIES:
                raise DrawingError(f"layout {lay.name} has over {MAX_DXF_ENTITIES} entities with blocks expanded: refused")
            t = e.dxftype()
            handle = owner or e.dxf.get("handle", "?")
            layer = str(e.dxf.get("layer", "")).upper()
            a = anno or "DIM" in layer
            if t == "INSERT":
                if depth < 4:
                    try:
                        walk(e.virtual_entities(), depth + 1, a, handle)
                    except Exception as ex:
                        s.notes.append(f"INSERT {handle}: block not expanded ({type(ex).__name__})")
                for att in getattr(e, "attribs", []):
                    add_text(att)
            elif t == "DIMENSION" or t == "ARC_DIMENSION":
                if depth == 0:
                    s.dims.append(e)
                try:
                    walk(e.virtual_entities(), depth + 1, True, handle)
                except Exception:
                    pass
            elif t in ("TEXT", "MTEXT", "ATTRIB", "ATTDEF"):
                add_text(e)
            elif t == "CIRCLE":
                s.circs.append(Circ(P(e.dxf.center), float(e.dxf.radius) * k, 0.0, True, f"CIRCLE:{handle}", a))
            elif t in ("LINE", "LWPOLYLINE", "POLYLINE", "ARC", "ELLIPSE", "SPLINE", "SOLID", "TRACE", "LEADER"):
                if t == "ARC":
                    s.circs.append(Circ(P(e.dxf.center), float(e.dxf.radius) * k, 0.0, False, f"ARC:{handle}", a))
                try:
                    pts = [P(v) for v in epath.make_path(e).flattening(0.05)]
                except Exception:
                    continue
                if t == "SOLID" and len(pts) >= 3:
                    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
                    if max(max(xs) - min(xs), max(ys) - min(ys)) < 4.0:
                        s.fills.append(Fill((min(xs), min(ys), max(xs), max(ys)), f"SOLID:{handle}"))
                        continue
                dashed = "HIDDEN" in layer or "DASH" in str(e.dxf.get("linetype", "")).upper() or "CENTER" in layer
                for j in range(len(pts) - 1):
                    s.segs.append(Seg(pts[j], pts[j + 1], 0.0, dashed, f"{t}:{handle}", a or t == "LEADER"))

    walk(lay, 0, False, None)
    boxes = [x.bbox() for x in s.segs + s.circs] + [t.box for t in s.texts] + [f.box for f in s.fills]
    s.box = union(boxes) or (0, 0, 0, 0)
    return s


# ------------------------------------------------------------------------------------------------

class PermissionRefused(DrawingError):
    """A PDF whose permission flags forbid content extraction, read without --ignore-pdf-permissions."""

    def __init__(self, message: str, pdf: dict):
        super().__init__(message)
        self.pdf = pdf


def pdf_permissions(pdf) -> dict:
    """The PDF's encryption and permission flags as read (pdfminer's view of the /P bits)."""
    doc = pdf.doc
    enc = doc.encryption is not None
    out: dict = {"encrypted": enc}
    if enc:
        try:
            p = doc.encryption[1].get("P")
            out["P"] = int(p) if p is not None else None
        except Exception:
            pass
    out["permissions"] = {"print": bool(doc.is_printable), "modify": bool(doc.is_modifiable), "extract": bool(doc.is_extractable)}
    return out


def load_sheets(path: Path, kind: str, page: int | None = None, ignore_permissions: bool = False) -> tuple[list[Sheet], object]:
    """The sheets to work on (one when `page` is given, else all) and the open document.

    DEFAULT (orchestrator ruling at the wave 4 gate, conservative for terms compliance; Kevin decides): a PDF whose
    permission flags forbid content extraction is refused unless the caller passes `ignore_permissions`
    (`--ignore-pdf-permissions`); the flags and the override are recorded in the reply's file record either way.
    """
    if kind == "pdf":
        pdf = open_pdf(path)
        flags = pdf_permissions(pdf)
        if not flags["permissions"]["extract"] and not ignore_permissions:
            pdf.close()
            raise PermissionRefused(
                f"{path.name}: the PDF's permission flags forbid extracting its content (print {'yes' if flags['permissions']['print'] else 'no'}, "
                "extract no); refused by DEFAULT. Ask the vendor for a drawing you may read, or pass --ignore-pdf-permissions to read "
                "it for engineering use (recorded in the output; the file and its crops stay out of git)",
                flags,
            )
        n = len(pdf.pages)
        pages = [page] if page else list(range(1, n + 1))
        try:
            for p in pages:
                if not 1 <= p <= n:
                    raise DrawingError(f"page {p} does not exist ({path.name} has {n})")
            return [pdf_sheet(pdf, p) for p in pages], pdf
        except BaseException:
            pdf.close()
            raise
    if kind == "dxf":
        doc, _ = open_dxf(path)
        idx = [page] if page else [1]  # DEFAULT: model space only, unless a sheet is named
        return [dxf_sheet(doc, i) for i in idx], doc
    if kind == "dwg":
        raise DrawingError("DWG is a closed format and is not read here: export a DXF or PDF from the source tool (or convert with a tool you run yourself)")
    raise DrawingError(f"a {kind} file has no vector drawing to read here (supported: vector PDF, DXF)")
