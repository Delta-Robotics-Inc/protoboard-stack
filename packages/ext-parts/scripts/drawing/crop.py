"""Render a crop of a view or a box to PNG (PB-1190, `drawing.crop`), with an overview of the whole sheet that
outlines the crop, so a number is never read without the drawing around it.

PDF: pdfplumber's page rendering (pypdfium2, which rasterises only: no JavaScript, forms or actions run).
DXF: drawn here with Pillow from the sheet's primitives (lines, arcs, circles, the dimensions' own blocks, text
at its insertion point in Pillow's default font); no matplotlib or PyMuPDF backend is used (PyMuPDF is AGPL).

Scale: `paperMmPerPx` is 25.4 / dpi. `partMmPerPx` is that times the part-per-paper factor when it is known:
1 for DXF model space (drawn at real size), the stated scale for a PDF sheet that states one and does not say
Not To Scale, else null with the reason. `pxToPt` (PDF) maps a crop pixel back to page points from the top-left:
pt = origin + px * 72 / dpi.
"""
from __future__ import annotations

import math
import re
from pathlib import Path

from . import MAX_PIXELS, DrawingError, cache_dir, contained, r3, r3v
from .inspect import scale_hint
from .sheet import Sheet
from .views import find_views

MARGIN_FRACTION = 0.12  # DEFAULT: a view's crop grows by 12 % of its size plus MARGIN_MM, to take its dimensions in
MARGIN_MM = 8.0
OVERVIEW_LONG_EDGE = 1600  # DEFAULT px: the overview's long edge


def region(sheet: Sheet, view: str | None, bbox: str | None) -> tuple[tuple[float, float, float, float], str]:
    if bbox:
        try:
            x0, y0, x1, y1 = (float(v) for v in re.split(r"[,\s]+", bbox.strip()))
        except ValueError:
            raise DrawingError("--bbox wants x0,y0,x1,y1 in sheet mm (y up), as `views` reports box_mm")
        return (min(x0, x1), min(y0, y1), max(x0, x1), max(y0, y1)), "bbox"
    if view:
        vr = find_views(sheet)
        v = next((v for v in vr["views"] if v["id"] == view or (v.get("role") == view)), None)
        if v is None:
            raise DrawingError(f"no view {view} on {sheet.name} (views: {', '.join(x['id'] + ' ' + x['role'] for x in vr['views']) or 'none'})")
        b = v["box_mm"]
        m = MARGIN_FRACTION * max(b[2] - b[0], b[3] - b[1]) + MARGIN_MM
        return (b[0] - m, b[1] - m, b[2] + m, b[3] + m), f"view {v['id']} ({v['role']})"
    return sheet.box, "whole sheet"


def _clip(box, sheet_box):
    return (max(box[0], sheet_box[0]), max(box[1], sheet_box[1]), min(box[2], sheet_box[2]), min(box[3], sheet_box[3]))


def part_scale(sheet: Sheet) -> tuple[float | None, str]:
    if sheet.kind == "dxf":
        return 1.0, "DXF model space is drawn at real size"
    sc = scale_hint(sheet)
    if sc and sc.get("factor") and not sc.get("notToScale"):
        return sc["factor"], f"the sheet states scale {sc['ratio']}"
    if sc and sc.get("notToScale"):
        return None, "the sheet says Not To Scale: measure nothing off the picture"
    return None, "the sheet states no scale"


def _png_path(root: Path, rec: dict, sheet: Sheet, what: str, dpi: float, out: str | None) -> Path:
    if out:
        p = contained(root, out, must_exist=False)
        if p.suffix.lower() != ".png":
            raise DrawingError("--out must name a .png file")
    else:
        p = cache_dir(root, rec["sha256"]) / f"crop-{sheet.kind}{sheet.index}-{re.sub(r'[^A-Za-z0-9]+', '-', what).strip('-')}-{int(dpi)}dpi.png"
    p.parent.mkdir(parents=True, exist_ok=True)
    return p


def _check_pixels(w_mm: float, h_mm: float, dpi: float) -> tuple[int, int]:
    w, h = max(1, round(w_mm / 25.4 * dpi)), max(1, round(h_mm / 25.4 * dpi))
    if w * h > MAX_PIXELS:
        best = math.floor(dpi * math.sqrt(MAX_PIXELS / (w * h)))
        raise DrawingError(f"a {w} x {h} px crop is over the {MAX_PIXELS} pixel cap: crop a smaller box or use --dpi {best} or less")
    return w, h


# ------------------------------------------------------------------------------------------------
# DXF rasteriser (Pillow)
# ------------------------------------------------------------------------------------------------

def render_dxf(sheet: Sheet, box, dpi: float, extra=None):
    """The sheet's primitives inside `box` (mm) as a white-background RGB image; `extra(draw, to_px)` draws more."""
    from PIL import Image, ImageDraw, ImageFont

    w, h = _check_pixels(box[2] - box[0], box[3] - box[1], dpi)
    ppm = dpi / 25.4
    img = Image.new("RGB", (w, h), "white")
    d = ImageDraw.Draw(img)

    def to_px(p):
        return ((p[0] - box[0]) * ppm, (box[3] - p[1]) * ppm)

    def visible(b):
        return not (b[2] < box[0] or b[0] > box[2] or b[3] < box[1] or b[1] > box[3])

    lw = max(1, round(0.35 * ppm))  # DEFAULT stroke: 0.35 mm
    for s in sheet.segs:
        if visible(s.bbox()):
            d.line([to_px(s.a), to_px(s.b)], fill=(90, 90, 90) if s.anno else (0, 0, 0), width=max(1, lw // 2) if s.anno or s.dashed else lw)
    for c in sheet.circs:
        if c.full and visible(c.bbox()):
            x0, y1 = to_px((c.c[0] - c.r, c.c[1] - c.r))
            x1, y0 = to_px((c.c[0] + c.r, c.c[1] + c.r))
            d.ellipse([x0, y0, x1, y1], outline=(0, 0, 0), width=lw)
    for f in sheet.fills:
        if visible(f.box):
            a, b = to_px((f.box[0], f.box[3])), to_px((f.box[2], f.box[1]))
            d.rectangle([a, b], fill=(0, 0, 0))
    for t in sheet.texts:
        if not visible(t.box):
            continue
        size = max(6, round(t.size * ppm))
        try:
            font = ImageFont.load_default(size=size)
        except Exception:
            font = ImageFont.load_default()
        if abs(t.angle % 360) < 1:
            d.text(to_px((t.box[0], t.box[3])), t.text, fill=(0, 0, 160), font=font)
        else:
            # rotated text: render upright on its own layer, rotate, paste at the run's box
            tw = max(1, round(d.textlength(t.text, font=font)))
            layer = Image.new("RGBA", (tw + 4, size + 6), (255, 255, 255, 0))
            ImageDraw.Draw(layer).text((2, 0), t.text, fill=(0, 0, 160, 255), font=font)
            layer = layer.rotate(t.angle, expand=True)
            px = to_px((t.box[0], t.box[3]))
            img.paste(layer, (round(px[0]), round(px[1])), layer)
    if extra:
        extra(d, to_px)
    return img


def crop(root: Path, sheet: Sheet, rec: dict, view: str | None = None, bbox: str | None = None, dpi: float = 200.0, out: str | None = None) -> dict:
    if not 10 <= dpi <= 2400:
        raise DrawingError("--dpi must be between 10 and 2400")
    box, what = region(sheet, view, bbox)
    box = _clip(box, sheet.box) if sheet.kind == "pdf" else box
    if box[2] <= box[0] or box[3] <= box[1]:
        raise DrawingError("the crop box is empty (outside the sheet?)")
    png = _png_path(root, rec, sheet, what.split(" (")[0], dpi, out)
    k, why = part_scale(sheet)
    overview_png = png.with_name(png.stem + "-overview.png")
    long_edge = max(sheet.box[2] - sheet.box[0], sheet.box[3] - sheet.box[1]) or 1.0
    odpi = max(10.0, min(150.0, OVERVIEW_LONG_EDGE / (long_edge / 25.4)))
    if sheet.kind == "pdf":
        _check_pixels(box[2] - box[0], box[3] - box[1], dpi)
        page = sheet.raw
        pt = sheet.pt_box(box)
        im = page.crop(pt, strict=False).to_image(resolution=dpi)
        im.save(str(png), format="PNG")
        size = list(im.original.size)
        ov = page.to_image(resolution=odpi)
        ov.draw_rect(pt, fill=(255, 0, 0, 30), stroke=(255, 0, 0), stroke_width=3)
        ov.save(str(overview_png), format="PNG")
        transform = {"pxToPt": {"origin_pt": r3v(pt[:2]), "ptPerPx": r3(72.0 / dpi)}, "note": "pt from the page's top-left"}
    else:
        img = render_dxf(sheet, box, dpi)
        img.save(str(png), format="PNG")
        size = list(img.size)

        def outline(d, to_px):
            a, b = to_px((box[0], box[3])), to_px((box[2], box[1]))
            d.rectangle([a, b], outline=(255, 0, 0), width=3)

        render_dxf(sheet, sheet.box, odpi, extra=outline).save(str(overview_png), format="PNG")
        transform = {"pxToMm": {"origin_mm": [r3(box[0]), r3(box[3])], "mmPerPx": r3(25.4 / dpi), "yDown": True}, "note": "drawing mm, y up; pixel rows go down"}
    rel = lambda p: str(p.relative_to(root)).replace("\\", "/")  # noqa: E731
    return {
        "png": rel(png),
        "overview": rel(overview_png),
        "region": what,
        "box_mm": r3v(box),
        "size_px": size,
        "dpi": dpi,
        "paperMmPerPx": r3(25.4 / dpi) if sheet.kind == "pdf" else None,
        "partMmPerPx": None if k is None else round(25.4 / dpi * k, 6),
        "scaleReason": why,
        "transform": transform,
        "note": "crops are cache files: never commit them (a vendor drawing may carry a confidentiality notice)",
    }
