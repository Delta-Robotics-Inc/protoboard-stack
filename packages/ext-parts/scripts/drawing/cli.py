"""The one entry point (PB-1190):

    python -I <ext-parts>/scripts/drawing <inspect|views|crop|dimensions|compare> [--json] [--root DIR] FILE
        [--page N]                 PDF page or DXF layout (1 = model space); DEFAULT all pages (inspect), page 1 otherwise
        [--view vN] [--bbox x0,y0,x1,y1] [--dpi N] [--out FILE.png]       crop: a view (from `views`) or a box in sheet mm
        [--model FILE.step] [--view-map v1=front,v2=top] [--tolerance MM] [--no-overlay]   compare
        [--ocr]                    use OCR on raster pages when pytesseract and tesseract are installed (off by DEFAULT)
        [--ignore-pdf-permissions] read a PDF whose flags forbid extraction (refused by DEFAULT; recorded)

Every file named (the drawing, the model, the crop output) must resolve inside --root (DEFAULT: the current
folder); the drawing is capped at 64 MB and 200 pages. Prints one JSON object (`protoboard.drawing/v0`) with
--json, else a short summary; exits 2 on a refusal or error, with {"ok": false, "error": ...} under --json.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

from . import MAX_MODEL_BYTES, SCHEMA, DrawingError, contained, file_record, ocr_status, sniff

OPS = ("inspect", "views", "crop", "dimensions", "compare")


def parse(argv: list[str]) -> argparse.Namespace:
    ap = argparse.ArgumentParser(prog="drawing", add_help=True)
    ap.add_argument("op", choices=OPS)
    ap.add_argument("file")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--root", default=".")
    ap.add_argument("--page", type=int)
    ap.add_argument("--view")
    ap.add_argument("--bbox")
    ap.add_argument("--dpi", type=float, default=200.0)  # DEFAULT crop resolution
    ap.add_argument("--out")
    ap.add_argument("--model")
    ap.add_argument("--view-map", dest="view_map")
    ap.add_argument("--tolerance", type=float)
    ap.add_argument("--no-overlay", dest="overlay", action="store_false")
    ap.add_argument("--ocr", action="store_true")
    # DEFAULT (wave 4 gate): a PDF that forbids content extraction is refused unless this is passed
    ap.add_argument("--ignore-pdf-permissions", dest="ignore_pdf_permissions", action="store_true")
    return ap.parse_args(argv)


def run(a: argparse.Namespace) -> dict:
    root = Path(a.root).resolve()
    path = contained(root, a.file)
    kind = sniff(path)
    rec = file_record(root, path, kind)
    ocr = ocr_status(a.ocr)
    t0 = time.perf_counter()
    out: dict = {"schema": SCHEMA, "ok": True, "op": a.op, "file": rec, "ocr": ocr}
    if kind == "raster" and a.op != "inspect":
        raise DrawingError("a raster image has no vector drawing: `inspect` it (with --ocr when tesseract is installed), or ask for a vector PDF or DXF")
    if a.op == "inspect":
        from . import inspect as insp
        from .sheet import load_sheets

        sheets, doc = ([], None) if kind == "raster" else load_sheets(path, kind, a.page, a.ignore_pdf_permissions)
        _record_pdf(rec, kind, doc, a.ignore_pdf_permissions)
        try:
            out["result"] = insp.inspect(path, kind, sheets, doc, ocr)
        finally:
            _close(doc)
    else:
        from .sheet import load_sheets

        sheets, doc = load_sheets(path, kind, a.page or 1, a.ignore_pdf_permissions)
        _record_pdf(rec, kind, doc, a.ignore_pdf_permissions)
        try:
            out["result"] = _op(a, root, rec, sheets[0])
        finally:
            _close(doc)
    out["ms"] = round((time.perf_counter() - t0) * 1000, 1)
    return out


def _op(a: argparse.Namespace, root: Path, rec: dict, sheet) -> dict:
    if a.op == "views":
        from .views import find_views

        return find_views(sheet)
    if a.op == "dimensions":
        from .dimensions import dimensions

        return dimensions(sheet, rec)
    if a.op == "crop":
        from .crop import crop

        return crop(root, sheet, rec, view=a.view, bbox=a.bbox, dpi=a.dpi, out=a.out)
    from .compare import compare

    if not a.model:
        raise DrawingError("compare needs --model <STEP file> (the CLI's --part resolves one)")
    model = contained(root, a.model, max_bytes=MAX_MODEL_BYTES)
    return compare(root, sheet, rec, model, view_map=a.view_map, tolerance=a.tolerance, overlay=a.overlay)


def _record_pdf(rec: dict, kind: str, doc, ignore: bool) -> None:
    """A PDF's flags, and whether --ignore-pdf-permissions overrode them, in the file record (the provenance)."""
    if kind != "pdf" or doc is None:
        return
    from .sheet import pdf_permissions

    flags = pdf_permissions(doc)
    flags["override"] = bool(ignore and not flags["permissions"]["extract"])
    rec["pdf"] = flags


def _close(doc) -> None:
    close = getattr(doc, "close", None)
    if callable(close):
        try:
            close()
        except Exception:
            pass


def summary(out: dict) -> str:
    r = out.get("result", {})
    f = out["file"]
    head = f"{out['op']} {f['path']} ({f['kind']}, sha256 {f['sha256'][:12]}): {out['ms']} ms"
    if out["op"] == "inspect":
        return head + "\n" + "\n".join(f"  {s['name']}: {'vector' if s.get('vector') else 'raster'}, {s.get('counts', {}).get('texts', 0)} text runs, {s.get('views', 0)} views, unit {s.get('unit', {}).get('unit')}, scale {(s.get('scale') or {}).get('ratio')}" for s in r.get("sheets", []))
    if out["op"] == "views":
        return head + f"\n  projection {r['projection']['guess']} ({r['projection']['reason']})\n" + "\n".join(f"  {v['id']} {v['role']}{' ' + v['label'] if v.get('label') else ''}: {v['size_mm'][0]} x {v['size_mm'][1]} mm" for v in r["views"])
    if out["op"] == "dimensions":
        return head + "\n" + "\n".join(f"  {d['id']} {d['kind']} {d['text'] or d['value']} -> {d['value']} {d['unit']} ({d['view']}, {d['confidence']})" for d in r["dimensions"])
    if out["op"] == "crop":
        return head + f"\n  {r['png']} {r['size_px'][0]} x {r['size_px'][1]} px at {r['dpi']} dpi; overview {r.get('overview')}"
    if out["op"] == "compare":
        lines = [f"  {d['id']} {d['kind']}: drawing {d['drawing']} model {d['model']} delta {d['delta']} ({'ok' if d['within'] else 'OFF' if d['within'] is False else '?'})" for d in r["perDimension"]]
        return head + f"\n  verdict {r['verdict']}\n" + "\n".join(lines)
    return head


def main(argv: list[str]) -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    a = parse(argv)
    try:
        out = run(a)
    except DrawingError as e:
        if a.json:
            err = {"schema": SCHEMA, "ok": False, "op": a.op, "error": str(e)}
            if getattr(e, "pdf", None) is not None:
                err["pdf"] = e.pdf
            print(json.dumps(err))
        else:
            print(f"drawing {a.op}: {e}", file=sys.stderr)
        return 2
    if a.json:
        print(json.dumps(out, ensure_ascii=False))
    else:
        print(summary(out))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
