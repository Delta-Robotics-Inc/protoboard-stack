"""What a drawing file is (PB-1190, `drawing.inspect`): vector or raster, pages or sheets, units, scale and
projection hints, the title block's text, and for a PDF its encryption and permission flags (a PDF that forbids
extraction is refused before this runs unless --ignore-pdf-permissions is passed, DEFAULT at the wave 4 gate; see the
licence note in docs/reference/drawings.md).

Named `inspect` because the brief names it; inside this package it is always imported relatively
(`from . import inspect`), so it never shadows the standard library's `inspect` (the package folder itself is
never on sys.path: see __main__.py).
"""
from __future__ import annotations

import re
from pathlib import Path

from . import r3, r3v
from .sheet import Sheet, union
from .views import find_views, projection_hint

SCALE = re.compile(r"\bSCALE\b\s*[:=]?\s*(\d+(?:\.\d+)?)\s*[:/]\s*(\d+(?:\.\d+)?)", re.I)
NOT_TO_SCALE = re.compile(r"\b(NOT\s+TO\s+SCALE|N\.?T\.?S\.?|DO\s+NOT\s+SCALE)\b", re.I)
UNIT_WORDS = [("mm", re.compile(r"\b(MILLIMET(ER|RE)S?|UNITS?\s*[:=]?\s*MM|DIMENSIONS?\s+(ARE\s+)?IN\s+MM|\[MM\])\b", re.I)), ("in", re.compile(r"\b(INCH(ES)?|UNITS?\s*[:=]?\s*IN\b|DIMENSIONS?\s+(ARE\s+)?IN\s+INCH)", re.I))]


def scale_hint(sheet: Sheet) -> dict | None:
    """The sheet's stated scale: {ratio, factor (part mm per paper mm), notToScale, source}; None when silent."""
    nts = next((t for t in sheet.texts if NOT_TO_SCALE.search(t.text)), None)
    joined = [(t, t.text) for t in sheet.texts]
    # a "SCALE" label and its value can be two runs on one line: join each run with the next one too
    for i, t in enumerate(sheet.texts[:-1]):
        joined.append((t, t.text + " " + sheet.texts[i + 1].text))
    for t, text in joined:
        m = SCALE.search(text)
        if m:
            a, b = float(m.group(1)), float(m.group(2))
            if a > 0 and b > 0:
                return {"ratio": f"{m.group(1)}:{m.group(2)}", "factor": b / a, "notToScale": nts is not None, "source": t.src}
    if nts:
        return {"ratio": None, "factor": None, "notToScale": True, "source": nts.src}
    return None


def unit_hint(sheet: Sheet) -> dict:
    text = sheet.all_text()
    for unit, rx in UNIT_WORDS:
        if rx.search(text):
            return {"unit": unit, "source": "text"}
    if sheet.kind == "dxf":
        return {"unit": sheet.unit, "source": "$INSUNITS"}
    return {"unit": "mm", "source": "DEFAULT (the sheet does not say)"}


def title_block(sheet: Sheet, views: dict | None = None) -> dict:
    if views and views.get("titleBlock"):
        return {"text": views["titleBlock"]["text"], "box_mm": views["titleBlock"]["box_mm"], "how": "a framed cluster with title-block words"}
    x0, y0, x1, y1 = sheet.box
    corner = [t for t in sheet.texts if t.center[0] > x0 + 0.55 * (x1 - x0) and t.center[1] < y0 + 0.3 * (y1 - y0)]
    if not corner:
        return {"text": [], "how": "none found"}
    corner.sort(key=lambda t: (-t.box[3], t.box[0]))
    return {"text": [t.text for t in corner][:40], "box_mm": r3v(union(t.box for t in corner)), "how": "DEFAULT: the text in the bottom-right corner (x > 55 %, y < 30 % of the sheet)"}


def sheet_summary(sheet: Sheet) -> dict:
    x0, y0, x1, y1 = sheet.box
    area = max((x1 - x0) * (y1 - y0), 1e-9)
    image_area = sum((b["box"][2] - b["box"][0]) * (b["box"][3] - b["box"][1]) for b in sheet.images)
    raster = not sheet.texts and len(sheet.segs) < 20 and image_area > 0.5 * area
    views = None if raster else find_views(sheet)
    proj, why = projection_hint(sheet)
    row = {
        "index": sheet.index,
        "name": sheet.name,
        "size_mm": [r3(x1 - x0), r3(y1 - y0)],
        "vector": not raster,
        "textLayer": "none" if not sheet.texts else "text",
        "counts": {"texts": len(sheet.texts), "segments": len(sheet.segs), "circles": len(sheet.circs), "arrowheads": len(sheet.fills), "images": len(sheet.images), "dimensions": len(sheet.dims)},
        "unit": unit_hint(sheet),
        "scale": scale_hint(sheet),
        "projection": {"guess": proj, "reason": why} if proj else (views or {}).get("projection"),
        "titleBlock": title_block(sheet, views),
        "views": len(views["views"]) if views else 0,
    }
    if sheet.kind == "pdf":
        row["size_pt"] = [r3(sheet.page_pt[0]), r3(sheet.page_pt[1])]
    if raster:
        row["note"] = "a scanned page: one image covers the page and there is no text layer; values need OCR or a person"
    if not sheet.texts and not raster:
        row["note"] = "no text layer: the numbers may be drawn as outlines (AutoCAD PDFSHX=0); only vision or OCR can read them"
    if sheet.notes:
        row["notes"] = sheet.notes
    return row


def pdf_security(pdf) -> dict:
    doc = pdf.doc
    enc = doc.encryption is not None
    out = {"encrypted": enc}
    if enc:
        try:
            p = doc.encryption[1].get("P")
            out["P"] = int(p) if p is not None else None
        except Exception:
            pass
    out["permissions"] = {"print": bool(doc.is_printable), "modify": bool(doc.is_modifiable), "extract": bool(doc.is_extractable)}
    if enc and not doc.is_extractable:
        out["note"] = "the file's flags do not permit copying or extracting text and graphics: the values are read for engineering use under the licence note in docs/reference/drawings.md; keep the file and its crops out of git"
    return out


def inspect_raster(path: Path) -> dict:
    from PIL import Image

    with Image.open(path) as im:
        w, h = im.size
        dpi = im.info.get("dpi")
    row = {"index": 1, "name": "image", "vector": False, "textLayer": "none", "size_px": [w, h], "note": "a raster image: values need OCR or a person"}
    if dpi:
        row["dpi"] = [r3(dpi[0]), r3(dpi[1])]
        row["size_mm"] = [r3(w / dpi[0] * 25.4), r3(h / dpi[1] * 25.4)]
    return row


def run_ocr(path: Path, kind: str, sheet: Sheet | None, ocr: dict) -> list[str]:
    """Raster OCR, only when asked and installed (never installed here). Returns the text lines it read."""
    if not (ocr["asked"] and ocr["available"]):
        return []
    import pytesseract  # noqa: F401  (present: checked by ocr_status)
    from PIL import Image

    if kind == "raster":
        img = Image.open(path)
    elif sheet is not None and sheet.kind == "pdf":
        img = sheet.raw.to_image(resolution=300).original
    else:
        return []
    text = pytesseract.image_to_string(img)
    ocr["used"] = True
    ocr["reason"] = "ran on the raster page (pytesseract)"
    return [ln for ln in text.splitlines() if ln.strip()]


def inspect(path: Path, kind: str, sheets: list[Sheet], doc, ocr: dict) -> dict:
    out: dict = {"kind": kind}
    if kind == "pdf":
        out["pages"] = len(doc.pages)
        out["metadata"] = {k: str(v)[:200] for k, v in (doc.metadata or {}).items() if isinstance(v, (str, int, float))}
        out["security"] = pdf_security(doc)
    elif kind == "dxf":
        from .sheet import dxf_layouts

        out["dxfVersion"] = doc.dxfversion
        out["layouts"] = [lay.name for lay in dxf_layouts(doc)]
        out["insunits"] = int(doc.header.get("$INSUNITS", 0) or 0)
    if kind == "raster":
        out["sheets"] = [inspect_raster(path)]
        lines = run_ocr(path, kind, None, ocr)
    else:
        out["sheets"] = [sheet_summary(s) for s in sheets]
        lines = []
        for s, row in zip(sheets, out["sheets"]):
            if not row["vector"]:
                got = run_ocr(path, kind, s, ocr)
                if got:
                    row["ocrText"] = got[:200]
                lines += got
    out["vector"] = any(s.get("vector") for s in out["sheets"])
    if lines:
        out["ocrLines"] = len(lines)
    return out
