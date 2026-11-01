"""Drawings to CAD (PB-1190): read a 2D drawing (vector PDF, DXF), find its views and dimensions, crop views to
PNG, and re-project a STEP model through the same views to compare it with the drawing's numbers.

Run in the project's CAD runtime (PROTOBOARD_PYTHON, or `protoboard tools install cad`), with pdfplumber and
ezdxf pinned in `@protoboardai/ext-parts`' runtime declaration:

    python -I <ext-parts>/scripts/drawing <inspect|views|crop|dimensions|compare> --json --root <dir> <file> ...

(`python -m drawing ...` from the scripts folder does the same; `-I` keeps the user's site and the current
folder off the import path, since a drawing may have been downloaded.)

Safety rules every module keeps:
- Every file read or written is inside `--root` (links resolved), and a file over MAX_BYTES or a PDF over
  MAX_PAGES pages is refused before it is parsed.
- Nothing embedded in a file is executed: PDF JavaScript, actions and forms are never run (pdfplumber and
  pypdfium2 only read and rasterise the page), DXF is read as data (no ODA converter, no add-on that starts a
  process), DWG is refused.
- OCR is off by DEFAULT. It is used only when asked (`--ocr`) and when pytesseract and a tesseract binary are
  already installed; this package never installs either. The output always says whether OCR ran.

Values are taken from the drawing's text or its DIMENSION entities, never scaled off the geometry: geometry
only places the anchors and checks consistency. Every dimension carries provenance
`measured-from-drawing` with the file's sha256, the page or sheet, and the entity it came from.

Units: DXF model space is real size in the file's $INSUNITS (converted to mm where the code says so); PDF
coordinates are page points (1/72 in), reported both as points from the top-left (what a crop takes) and as
paper mm, y up. Paper mm is distance on the sheet, which is part mm only when the sheet is drawn to a known
scale. Models (STEP) are mm, Z up.
"""
from __future__ import annotations

import hashlib
import os
from pathlib import Path

SCHEMA = "protoboard.drawing/v0"
DIMENSIONS_SCHEMA = "protoboard.drawing-dimensions/v0"
PROVENANCE = "measured-from-drawing"

MAX_BYTES = 64 * 1024 * 1024  # DEFAULT: the largest drawing or model file read
MAX_PAGES = 200  # DEFAULT: a PDF with more pages is refused
MAX_PIXELS = 40_000_000  # DEFAULT: the largest crop rendered (about 6300 x 6300 px)
MAX_DXF_ENTITIES = 500_000  # DEFAULT: entities read from one DXF layout, blocks expanded
MAX_MODEL_BYTES = 256 * 1024 * 1024  # DEFAULT, as the geometry service: the largest STEP compared

PT_TO_MM = 25.4 / 72.0


class DrawingError(Exception):
    """A refusal or failure a person can act on (bad input, over a cap, outside the root)."""


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def inside(root: Path, path: Path) -> bool:
    try:
        path.relative_to(root)
        return True
    except ValueError:
        return False


def contained(root: str | Path, file: str | Path, must_exist: bool = True, max_bytes: int = MAX_BYTES) -> Path:
    """`file` (absolute, or relative to the current folder) resolved (links followed) and checked to be inside `root`; size-capped when it exists."""
    r = Path(os.path.realpath(root))
    p = Path(os.path.abspath(file))  # a relative path is relative to the current folder, as on any command line
    real = Path(os.path.realpath(p))
    if not inside(r, real):
        raise DrawingError(f"{file} resolves outside the project root ({r}): refused")
    if must_exist:
        if not real.is_file():
            raise DrawingError(f"{file} is not a file")
        size = real.stat().st_size
        if size > max_bytes:
            raise DrawingError(f"{file} is {size} bytes, over the {max_bytes} byte cap")
    return real


def sniff(path: Path) -> str:
    """The file's kind from its bytes: pdf, dxf, dwg, svg, raster, or unknown (the extension only breaks ties)."""
    with path.open("rb") as f:
        head = f.read(4096)
    if b"%PDF-" in head[:1024]:
        return "pdf"
    if head.startswith(b"AutoCAD Binary DXF"):
        return "dxf"
    if head[:2] == b"AC" and head[2:6].isdigit():  # DWG: "AC1015", "AC1032", ...
        return "dwg"
    if head.startswith(b"\x89PNG") or head.startswith(b"\xff\xd8\xff") or head[:4] in (b"II*\x00", b"MM\x00*"):
        return "raster"
    text = head.decode("latin-1").lstrip()
    if "<svg" in text[:2048]:
        return "svg"
    lines = [ln.strip() for ln in text.splitlines()[:8]]
    if len(lines) >= 2 and lines[0] in ("0", "999") and ("SECTION" in lines[1] or "SECTION" in text[:200]):
        return "dxf"
    ext = path.suffix.lower()
    return {".pdf": "pdf", ".dxf": "dxf", ".dwg": "dwg", ".svg": "svg", ".png": "raster", ".jpg": "raster", ".jpeg": "raster", ".tif": "raster", ".tiff": "raster"}.get(ext, "unknown")


def file_record(root: Path, path: Path, kind: str) -> dict:
    rel = os.path.relpath(path, root).replace("\\", "/")
    return {"path": rel, "sha256": sha256_file(path), "bytes": path.stat().st_size, "kind": kind}


def ocr_status(asked: bool) -> dict:
    """Whether OCR can run here. Never installs anything: pytesseract and a tesseract binary must already exist."""
    import importlib.util
    import shutil

    lib = importlib.util.find_spec("pytesseract") is not None
    binary = shutil.which("tesseract")
    available = lib and binary is not None
    if not asked:
        reason = "off by DEFAULT (pass --ocr for raster pages)"
    elif not available:
        reason = "asked for, but pytesseract and a tesseract binary are not both installed (this tool never installs them)"
    else:
        reason = "available"
    return {"asked": asked, "available": available, "used": False, "reason": reason}


def r3(x: float) -> float:
    return round(float(x), 3)


def r3v(v) -> list[float]:
    return [r3(c) for c in v]


def cache_dir(root: Path, sha: str) -> Path:
    """Where crops and overlays go by DEFAULT: regenerable, never committed (.protoboard/cache is gitignored)."""
    return root / ".protoboard" / "cache" / "drawing" / sha[:16]
