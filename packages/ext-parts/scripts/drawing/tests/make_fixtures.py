"""Two drawing fixtures, generated here so no third-party drawing is ever copied into the repo (PB-1190).

    python -I make_fixtures.py <out_dir> [--models]   writes <out_dir>/plate.dxf and plate.pdf (and, with --models,
                                                     plate.step, plate-wrong.step and plate-5x.step for compare)

Both draw the same part: a 100 x 60 x 5 mm plate with four 8 mm holes at (15, 15), (85, 15), (15, 45) and
(85, 45), drawn at 1:1 in third-angle projection: the top view (the plate's XY face) above the front view
(its XZ face), a title block at the bottom right.

- plate.dxf (ezdxf, R2010, $INSUNITS = mm): three DIMENSION entities: the 100 width, the 60 height (with a
  +/-0.1 tolerance in its dimension style override) and the 8 mm hole diameter.
- plate.pdf (written by hand below, PDF 1.4, uncompressed, standard Helvetica font, no library): the same
  views as stroked paths, the dimensions as thin lines with filled arrowheads and real text: "100" upright,
  "60±0.1" rotated 90 degrees, "4X Ø8" on a leader to a hole. 1 drawing mm = 72 / 25.4 pt.
"""
from __future__ import annotations

import math
import sys
from pathlib import Path

PLATE = (100.0, 60.0, 5.0)
HOLES = [(15.0, 15.0), (85.0, 15.0), (15.0, 45.0), (85.0, 45.0)]
HOLE_D = 8.0
FRONT_Y = -30.0  # the front view's bottom edge in drawing mm (third angle: below the top view)
TITLE_LINES = ["TITLE: PLATE-01", "UNITS: MM", "SCALE 1:1", "THIRD ANGLE PROJECTION", "REV A"]


def write_dxf(path: Path) -> None:
    import ezdxf

    doc = ezdxf.new("R2010", setup=True)
    doc.header["$INSUNITS"] = 4  # mm
    doc.header["$MEASUREMENT"] = 1  # metric
    doc.layers.add("OUTLINE")
    doc.layers.add("HIDDEN", linetype="DASHED")
    doc.layers.add("DIMS")
    doc.layers.add("TEXT")
    msp = doc.modelspace()
    MM = {"dimlfac": 1.0, "dimtzin": 8, "dimtxt": 3.5, "dimasz": 2.5, "dimexe": 1.5, "dimexo": 1.0}  # the EZDXF style shows metres as cm (DIMLFAC 100): this drawing is mm, shown as is
    w, h, t = PLATE
    # top view
    msp.add_lwpolyline([(0, 0), (w, 0), (w, h), (0, h)], close=True, dxfattribs={"layer": "OUTLINE"})
    for x, y in HOLES:
        msp.add_circle((x, y), HOLE_D / 2, dxfattribs={"layer": "OUTLINE"})
    # front view, with the holes as hidden lines
    msp.add_lwpolyline([(0, FRONT_Y), (w, FRONT_Y), (w, FRONT_Y + t), (0, FRONT_Y + t)], close=True, dxfattribs={"layer": "OUTLINE"})
    for x in sorted({x for x, _ in HOLES}):
        for dx in (-HOLE_D / 2, HOLE_D / 2):
            msp.add_line((x + dx, FRONT_Y), (x + dx, FRONT_Y + t), dxfattribs={"layer": "HIDDEN"})
    msp.add_text("TOP VIEW", height=3.5, dxfattribs={"layer": "TEXT"}).set_placement((38, 80))
    msp.add_text("FRONT VIEW", height=3.5, dxfattribs={"layer": "TEXT"}).set_placement((36, FRONT_Y - 8))
    # dimensions
    msp.add_linear_dim(base=(w / 2, h + 10), p1=(0, h), p2=(w, h), angle=0, dimstyle="EZDXF", override=MM, dxfattribs={"layer": "DIMS"}).render()
    tall = msp.add_linear_dim(base=(-12, h / 2), p1=(0, 0), p2=(0, h), angle=90, dimstyle="EZDXF", override=MM, dxfattribs={"layer": "DIMS"})
    tall.set_tolerance(0.1, 0.1, hfactor=0.7)  # +/-0.1
    tall.render()
    hx, hy = HOLES[3]
    msp.add_diameter_dim(center=(hx, hy), radius=HOLE_D / 2, angle=45, dimstyle="EZDXF", override=MM, dxfattribs={"layer": "DIMS"}).render()
    # title block
    msp.add_lwpolyline([(130, -48), (215, -48), (215, -14), (130, -14)], close=True, dxfattribs={"layer": "TEXT"})
    for i, line in enumerate(TITLE_LINES):
        msp.add_text(line, height=3.0, dxfattribs={"layer": "TEXT"}).set_placement((133, -20 - 6 * i))
    doc.saveas(path)


# --- PDF, by hand -------------------------------------------------------------------------------

PT = 72.0 / 25.4
PAGE = (842.0, 595.0)  # A4 landscape, pt
ORIGIN = (60.0 * PT, 70.0 * PT)  # where drawing (0, 0) sits on the page, pt from the bottom-left


def P(x: float, y: float) -> tuple[float, float]:
    return ORIGIN[0] + x * PT, ORIGIN[1] + y * PT


def f(v: float) -> str:
    return ("%.3f" % v).rstrip("0").rstrip(".")


def pdf_text(s: str) -> bytes:
    out = s.encode("cp1252")  # WinAnsiEncoding: the "±" (0xB1) and "Ø" (0xD8) glyphs exist in it
    return out.replace(b"\\", b"\\\\").replace(b"(", b"\\(").replace(b")", b"\\)")


class Content:
    def __init__(self) -> None:
        self.ops: list[bytes] = []

    def op(self, s: str) -> None:
        self.ops.append(s.encode("ascii"))

    def width(self, w: float) -> None:
        self.op(f"{f(w)} w")

    def line(self, a, b) -> None:
        (x0, y0), (x1, y1) = P(*a), P(*b)
        self.op(f"{f(x0)} {f(y0)} m {f(x1)} {f(y1)} l S")

    def poly(self, pts, close=True) -> None:
        q = [P(*p) for p in pts]
        self.op(f"{f(q[0][0])} {f(q[0][1])} m " + " ".join(f"{f(x)} {f(y)} l" for x, y in q[1:]) + (" h S" if close else " S"))

    def circle(self, c, r) -> None:
        k = 0.5523 * r
        cx, cy = c
        pts = [(cx + r, cy), (cx + r, cy + k), (cx + k, cy + r), (cx, cy + r), (cx - k, cy + r), (cx - r, cy + k), (cx - r, cy), (cx - r, cy - k), (cx - k, cy - r), (cx, cy - r), (cx + k, cy - r), (cx + r, cy - k), (cx + r, cy)]
        q = [P(*p) for p in pts]
        s = f"{f(q[0][0])} {f(q[0][1])} m"
        for i in range(1, 13, 3):
            s += " " + " ".join(f"{f(q[i + j][0])} {f(q[i + j][1])}" for j in range(3)) + " c"
        self.op(s + " S")

    def arrow(self, tip, toward) -> None:
        """A filled arrowhead, 3 mm long, 1 mm wide, at `tip`, pointing away from `toward`."""
        dx, dy = tip[0] - toward[0], tip[1] - toward[1]
        n = math.hypot(dx, dy)
        ux, uy = dx / n, dy / n
        bx, by = tip[0] - 3 * ux, tip[1] - 3 * uy
        a, b, c = P(*tip), P(bx - 0.5 * uy, by + 0.5 * ux), P(bx + 0.5 * uy, by - 0.5 * ux)
        self.op(f"{f(a[0])} {f(a[1])} m {f(b[0])} {f(b[1])} l {f(c[0])} {f(c[1])} l h f")

    def text(self, s: str, at, size: float = 10.0, rotate90: bool = False) -> None:
        x, y = P(*at)
        m = f"0 1 -1 0 {f(x)} {f(y)}" if rotate90 else f"1 0 0 1 {f(x)} {f(y)}"
        self.ops.append(b"BT /F1 " + f(size).encode() + b" Tf " + m.encode() + b" Tm (" + pdf_text(s) + b") Tj ET")


def write_pdf(path: Path) -> None:
    w, h, t = PLATE
    c = Content()
    # sheet border (the frame: wider than any view)
    c.width(1.0)
    c.op(f"14 14 {f(PAGE[0] - 28)} {f(PAGE[1] - 28)} re S")
    # views: thick outline
    c.width(0.7)
    c.poly([(0, 0), (w, 0), (w, h), (0, h)])
    for hole in HOLES:
        c.circle(hole, HOLE_D / 2)
    c.poly([(0, FRONT_Y), (w, FRONT_Y), (w, FRONT_Y + t), (0, FRONT_Y + t)])
    c.op("[2 2] 0 d")
    c.width(0.35)
    for x in sorted({x for x, _ in HOLES}):
        for dx in (-HOLE_D / 2, HOLE_D / 2):
            c.line((x + dx, FRONT_Y), (x + dx, FRONT_Y + t))
    c.op("[] 0 d")
    # dimensions: thin lines, filled arrowheads, real text
    c.width(0.25)
    # 100 across the top
    c.line((0, h + 2), (0, h + 13))
    c.line((w, h + 2), (w, h + 13))
    c.line((0, h + 10), (w, h + 10))
    c.arrow((0, h + 10), (w, h + 10))
    c.arrow((w, h + 10), (0, h + 10))
    c.text("100", (w / 2 - 3, h + 11))
    # 60 +/-0.1 on the left, text rotated 90 degrees
    c.line((-2, 0), (-15, 0))
    c.line((-2, h), (-15, h))
    c.line((-12, 0), (-12, h))
    c.arrow((-12, 0), (-12, h))
    c.arrow((-12, h), (-12, 0))
    c.text("60±0.1", (-13, h / 2 - 6), rotate90=True)
    # 4X diameter 8 on a leader from the top-right hole at 45 degrees
    hx, hy = HOLES[3]
    tip = (hx + HOLE_D / 2 * math.cos(math.pi / 4), hy + HOLE_D / 2 * math.sin(math.pi / 4))
    knee = (tip[0] + 8, tip[1] + 8)
    c.line(tip, knee)
    c.line(knee, (knee[0] + 10, knee[1]))
    c.arrow(tip, knee)
    c.text("4X Ø8", (knee[0] + 1, knee[1] + 1))
    # labels
    c.text("TOP VIEW", (38, h + 20))
    c.text("FRONT VIEW", (36, FRONT_Y - 8))
    # title block
    c.width(0.5)
    c.poly([(130, -48), (215, -48), (215, -14), (130, -14)])
    for i, line in enumerate(TITLE_LINES):
        c.text(line, (133, -20 - 6 * i), size=8)
    stream = b"\n".join(c.ops) + b"\n"

    objs = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
        b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"endstream",
        b"<< /Title (PLATE-01 test drawing) /Producer (protoboard drawing test fixture) >>",
    ]
    out = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = []
    for i, body in enumerate(objs, start=1):
        offsets.append(len(out))
        out += f"{i} 0 obj\n".encode() + body + b"\nendobj\n"
    xref = len(out)
    out += f"xref\n0 {len(objs) + 1}\n0000000000 65535 f \n".encode()
    for o in offsets:
        out += f"{o:010d} 00000 n \n".encode()
    out += f"trailer\n<< /Size {len(objs) + 1} /Root 1 0 R /Info 6 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    path.write_bytes(bytes(out))


# --- models for compare (build123d) ---------------------------------------------------------------

MODELS = {
    "plate.step": {"size": PLATE, "hole_d": HOLE_D, "scale": 1.0},  # what the drawing says
    "plate-wrong.step": {"size": (102.0, 60.0, 5.0), "hole_d": 10.0, "scale": 1.0},  # 2 mm too wide, 10 mm holes
    "plate-5x.step": {"size": PLATE, "hole_d": HOLE_D, "scale": 5.0},  # round 1's USB-C failure: 5x too large
}


def write_step(path: Path, size, hole_d: float, scale: float) -> None:
    from build123d import Align, Box, BuildPart, Hole, Locations, export_step, scale as scaled

    w, h, t = size
    with BuildPart() as p:
        Box(w, h, t, align=(Align.MIN, Align.MIN, Align.MIN))
        # holes keep their distance from the near edges (15 mm), so a wider plate moves the right-hand pair
        with Locations(*[(x if x < PLATE[0] / 2 else w - (PLATE[0] - x), y) for x, y in HOLES]):
            Hole(hole_d / 2)
    shape = p.part if scale == 1.0 else scaled(p.part, by=scale)
    export_step(shape, str(path), timestamp="2026-01-01T00:00:00")


def main(argv: list[str]) -> int:
    args = [a for a in argv[1:] if not a.startswith("--")]
    if len(args) != 1:
        print("usage: python -I make_fixtures.py <out_dir> [--models]", file=sys.stderr)
        return 2
    out = Path(args[0])
    out.mkdir(parents=True, exist_ok=True)
    write_dxf(out / "plate.dxf")
    write_pdf(out / "plate.pdf")
    written = [out / "plate.dxf", out / "plate.pdf"]
    if "--models" in argv:
        for name, m in MODELS.items():
            write_step(out / name, m["size"], m["hole_d"], m["scale"])
            written.append(out / name)
    for w in written:
        print(str(w))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
