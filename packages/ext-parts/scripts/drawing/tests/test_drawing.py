"""The drawing package on its two generated fixtures (PB-1190). unittest, since pytest is not in the CAD runtime:

    <cad python> -I -m unittest discover -s <ext-parts>/scripts/drawing/tests -t <ext-parts>/scripts -v

Every file is written under a fresh temporary folder that serves as --root.
"""
from __future__ import annotations

import json
import os
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from drawing import DrawingError, cli, contained, sniff
from drawing.dimensions import parse_text
from drawing.tests import make_fixtures


def run(*argv: str) -> dict:
    return cli.run(cli.parse(list(argv)))


class DrawingFixtures(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.root = Path(tempfile.mkdtemp(prefix="drawing-test-"))
        cls.fx = cls.root / "fx"
        cls.fx.mkdir()
        make_fixtures.write_dxf(cls.fx / "plate.dxf")
        make_fixtures.write_pdf(cls.fx / "plate.pdf")
        for name, m in make_fixtures.MODELS.items():
            make_fixtures.write_step(cls.fx / name, m["size"], m["hole_d"], m["scale"])
        cls.r = str(cls.root)

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.root, ignore_errors=True)

    def f(self, name: str) -> str:
        return str(self.fx / name)

    # --- safety -----------------------------------------------------------------------------------

    def test_kinds_from_bytes(self):
        self.assertEqual(sniff(self.fx / "plate.pdf"), "pdf")
        self.assertEqual(sniff(self.fx / "plate.dxf"), "dxf")
        dwg = self.fx / "x.bin"
        dwg.write_bytes(b"AC1032" + b"\0" * 100)
        self.assertEqual(sniff(dwg), "dwg")
        with self.assertRaisesRegex(DrawingError, "DWG is a closed format"):
            run("views", "--root", self.r, str(dwg))

    def test_paths_stay_inside_the_root(self):
        outside = Path(tempfile.mkdtemp(prefix="drawing-outside-"))
        try:
            shutil.copy(self.fx / "plate.pdf", outside / "plate.pdf")
            with self.assertRaisesRegex(DrawingError, "outside the project root"):
                run("inspect", "--root", self.r, str(outside / "plate.pdf"))
            with self.assertRaisesRegex(DrawingError, "outside the project root"):
                run("crop", "--root", self.r, self.f("plate.pdf"), "--out", str(outside / "x.png"))
        finally:
            shutil.rmtree(outside, ignore_errors=True)

    def test_size_and_page_caps(self):
        with self.assertRaisesRegex(DrawingError, "over the 100 byte cap"):
            contained(self.root, self.f("plate.pdf"), max_bytes=100)
        with mock.patch("drawing.sheet.MAX_PAGES", 0):
            with self.assertRaisesRegex(DrawingError, "page cap"):
                run("inspect", "--root", self.r, self.f("plate.pdf"))
        with self.assertRaisesRegex(DrawingError, "pixel cap"):
            run("crop", "--root", self.r, self.f("plate.pdf"), "--dpi", "2400")

    def test_cli_json_error_and_exit_code(self):
        import contextlib
        import io

        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            code = cli.main(["views", "--json", "--root", self.r, self.f("nope.pdf")])
        self.assertEqual(code, 2)
        self.assertEqual(json.loads(buf.getvalue())["ok"], False)

    def test_pdf_that_forbids_extraction_is_refused_unless_overridden(self):
        # wave 4 gate DEFAULT: the flags as a vendor PDF sets them (the GCT drawing: /P -1340, print yes, extract no)
        import contextlib
        import io

        flags = {"encrypted": True, "P": -1340, "permissions": {"print": True, "modify": False, "extract": False}}
        with mock.patch("drawing.sheet.pdf_permissions", return_value=dict(flags)):
            for op in ("inspect", "views", "dimensions"):
                with self.assertRaisesRegex(DrawingError, "forbid extracting its content.*--ignore-pdf-permissions"):
                    run(op, "--root", self.r, self.f("plate.pdf"))
            buf = io.StringIO()
            with contextlib.redirect_stdout(buf):
                code = cli.main(["dimensions", "--json", "--root", self.r, self.f("plate.pdf")])
            self.assertEqual(code, 2)
            err = json.loads(buf.getvalue())
            self.assertEqual((err["ok"], err["pdf"]["permissions"]["extract"]), (False, False))
            out = run("dimensions", "--root", self.r, self.f("plate.pdf"), "--ignore-pdf-permissions")
            self.assertEqual(out["file"]["pdf"]["override"], True)
            self.assertEqual(out["file"]["pdf"]["P"], -1340)
            self.assertEqual(len(out["result"]["dimensions"]), 3)
        # a PDF that permits extraction is read as before; the record says no override was needed
        plain = run("dimensions", "--root", self.r, self.f("plate.pdf"), "--ignore-pdf-permissions")
        self.assertEqual((plain["file"]["pdf"]["encrypted"], plain["file"]["pdf"]["override"]), (False, False))

    # --- inspect and views ------------------------------------------------------------------------

    def test_inspect_pdf(self):
        out = run("inspect", "--root", self.r, self.f("plate.pdf"))
        self.assertEqual(out["file"]["path"], "fx/plate.pdf")
        self.assertEqual(len(out["file"]["sha256"]), 64)
        r = out["result"]
        self.assertEqual(r["pages"], 1)
        self.assertFalse(r["security"]["encrypted"])
        s = r["sheets"][0]
        self.assertTrue(s["vector"])
        self.assertEqual(s["unit"]["unit"], "mm")
        self.assertEqual(s["scale"]["ratio"], "1:1")
        self.assertEqual(s["projection"]["guess"], "third")
        self.assertIn("TITLE: PLATE-01", s["titleBlock"]["text"])
        self.assertEqual(s["views"], 2)
        self.assertEqual(out["ocr"]["used"], False)
        self.assertIn("off by DEFAULT", out["ocr"]["reason"])

    def test_inspect_dxf(self):
        r = run("inspect", "--root", self.r, self.f("plate.dxf"))["result"]
        self.assertEqual(r["insunits"], 4)
        s = r["sheets"][0]
        self.assertEqual(s["counts"]["dimensions"], 3)
        self.assertEqual(s["unit"]["unit"], "mm")
        self.assertIn("SCALE 1:1", s["titleBlock"]["text"])

    def test_views_both_formats(self):
        for f in ("plate.pdf", "plate.dxf"):
            r = run("views", "--root", self.r, self.f(f))["result"]
            roles = {v["role"]: v for v in r["views"]}
            self.assertEqual(set(roles), {"top", "front"}, f)
            self.assertEqual(roles["top"]["label"], "TOP VIEW")
            self.assertAlmostEqual(roles["top"]["size_mm"][0], 100.0, places=1)
            self.assertAlmostEqual(roles["top"]["size_mm"][1], 60.0, places=1)
            self.assertAlmostEqual(roles["front"]["size_mm"][1], 5.0, places=1)
            self.assertEqual(r["projection"]["confidence"], "high")
            self.assertIn("titleBlock", r)

    def test_projection_default_without_hints(self):
        import ezdxf

        doc = ezdxf.new("R2010")
        msp = doc.modelspace()
        msp.add_lwpolyline([(0, 0), (100, 0), (100, 60), (0, 60)], close=True)
        msp.add_circle((50, 30), 5)
        msp.add_lwpolyline([(0, -30), (100, -30), (100, -25), (0, -25)], close=True)
        msp.add_line((45, -30), (45, -25))
        doc.saveas(self.fx / "bare.dxf")
        r = run("views", "--root", self.r, self.f("bare.dxf"))["result"]
        self.assertEqual(r["projection"]["guess"], "third")
        self.assertEqual(r["projection"]["confidence"], "low")
        self.assertIn("DEFAULT", r["projection"]["reason"])
        self.assertEqual(sorted(v["role"] for v in r["views"]), ["bottom", "front"])

    # --- dimensions -------------------------------------------------------------------------------

    def test_parse_text(self):
        self.assertEqual(parse_text("4X Ø8")["multiplicity"], 4)
        self.assertEqual(parse_text("4X Ø8")["kindHint"], "diameter")
        self.assertEqual(parse_text("60±0.1")["tolerance"], {"plus": 0.1, "minus": 0.1, "source": "explicit"})
        self.assertEqual(parse_text("8.34 +0.06/-0.02")["tolerance"]["minus"], 0.02)
        self.assertTrue(parse_text("(12.5)")["reference"])
        self.assertEqual(parse_text("R2.5")["kindHint"], "radius")
        self.assertEqual(parse_text("45°")["kindHint"], "angle")
        self.assertEqual(parse_text("0,65")["value"], 0.65)
        self.assertIsNone(parse_text("SCALE 1:1"))
        self.assertIsNone(parse_text("REV A"))

    def check_rows(self, rows, fmt):
        by = {(d["kind"], d["value"]): d for d in rows}
        self.assertEqual(set(by), {("linear", 100.0), ("linear", 60.0), ("diameter", 8.0)}, fmt)
        for d in rows:
            self.assertEqual(d["provenance"]["method"], "measured-from-drawing")
            self.assertEqual(len(d["provenance"]["sha256"]), 64)
            self.assertTrue(d["provenance"]["entity"])
            self.assertEqual(d["view"], "v1", f"{fmt} {d['id']} is on the top view")
            self.assertTrue(d["agree"], f"{fmt} {d['id']}: {d.get('notes')}")
            self.assertEqual(d["confidence"], "high", f"{fmt} {d['id']}")
        self.assertEqual(by[("linear", 60.0)]["tolerance"]["plus"], 0.1)
        self.assertAlmostEqual(by[("linear", 100.0)]["geometryLength_mm"], 100.0, places=2)
        return by

    def test_dimensions_dxf(self):
        r = run("dimensions", "--root", self.r, self.f("plate.dxf"))["result"]
        self.assertEqual(r["schema"], "protoboard.drawing-dimensions/v0")
        by = self.check_rows(r["dimensions"], "dxf")
        self.assertTrue(by[("linear", 100.0)]["provenance"]["entity"].startswith("DIMENSION:"))
        self.assertEqual(r["scaleConsistency"]["medianRatio"], 1.0)

    def test_dimensions_pdf(self):
        r = run("dimensions", "--root", self.r, self.f("plate.pdf"))["result"]
        by = self.check_rows(r["dimensions"], "pdf")
        self.assertEqual(by[("diameter", 8.0)]["multiplicity"], 4)
        self.assertEqual(by[("linear", 60.0)]["direction"], [0.0, 1.0])  # the rotated text reads along y
        self.assertEqual(by[("linear", 100.0)]["arrowheads"], 2)
        self.assertEqual(by[("diameter", 8.0)]["feature"]["circle"]["r_mm"], 4.0)

    def test_hand_edited_dxf_override_is_flagged(self):
        import ezdxf

        doc = ezdxf.new("R2010", setup=True)
        msp = doc.modelspace()
        msp.add_lwpolyline([(0, 0), (50, 0), (50, 20), (0, 20)], close=True)
        msp.add_linear_dim(base=(25, 30), p1=(0, 20), p2=(50, 20), text="49", dimstyle="EZDXF", override={"dimlfac": 1.0}).render()
        doc.saveas(self.fx / "edited.dxf")
        d = run("dimensions", "--root", self.r, self.f("edited.dxf"))["result"]["dimensions"][0]
        self.assertEqual(d["value"], 49.0)
        self.assertEqual(d["readings"]["geometry"], 50.0)
        self.assertFalse(d["agree"])
        self.assertIn("hand-edited", " ".join(d["notes"]))

    # --- crop -------------------------------------------------------------------------------------

    def test_crop_both_formats(self):
        from PIL import Image

        for f in ("plate.pdf", "plate.dxf"):
            r = run("crop", "--root", self.r, self.f(f), "--view", "top", "--dpi", "100")["result"]
            png = self.root / r["png"]
            self.assertTrue(png.is_file(), f)
            self.assertTrue((self.root / r["overview"]).is_file())
            self.assertTrue(r["png"].startswith(".protoboard/cache/drawing/"))
            with Image.open(png) as im:
                self.assertEqual(list(im.size), r["size_px"])
                # 100 mm view + margins at 100 dpi: about 500 px wide
                self.assertGreater(im.size[0], 450)
            self.assertAlmostEqual(r["partMmPerPx"], 0.254, places=4)
        out = run("crop", "--root", self.r, self.f("plate.pdf"), "--bbox", "50,60,170,140", "--dpi", "72", "--out", self.f("box.png"))["result"]
        self.assertEqual(out["png"], "fx/box.png")
        self.assertEqual(out["transform"]["pxToPt"]["ptPerPx"], 1.0)

    # --- compare ----------------------------------------------------------------------------------

    def test_compare_agrees_with_the_right_model(self):
        for f in ("plate.pdf", "plate.dxf"):
            r = run("compare", "--root", self.r, self.f(f), "--model", self.f("plate.step"), "--no-overlay")["result"]
            self.assertEqual(r["verdict"], "agrees", f"{f}: {json.dumps(r['perDimension'])}")
            self.assertEqual(len(r["perDimension"]), 3)
            for d in r["perDimension"]:
                self.assertAlmostEqual(d["delta"], 0.0, places=3)
            self.assertEqual({e["role"] for e in r["extents"]}, {"top", "front"})

    def test_compare_finds_the_wrong_numbers(self):
        r = run("compare", "--root", self.r, self.f("plate.dxf"), "--model", self.f("plate-wrong.step"))["result"]
        self.assertEqual(r["verdict"], "disagrees")
        deltas = {(d["kind"], d["drawing"]): d for d in r["perDimension"]}
        self.assertAlmostEqual(deltas[("linear", 100.0)]["delta"], 2.0, places=3)
        self.assertFalse(deltas[("linear", 100.0)]["within"])
        self.assertAlmostEqual(deltas[("diameter", 8.0)]["delta"], 2.0, places=3)
        self.assertTrue(deltas[("linear", 60.0)]["within"])
        self.assertTrue(all((self.root / p).is_file() for p in r["overlays"].values()))

    def test_compare_catches_a_model_five_times_too_large(self):
        r = run("compare", "--root", self.r, self.f("plate.pdf"), "--model", self.f("plate-5x.step"), "--no-overlay")["result"]
        self.assertEqual(r["verdict"], "disagrees")
        top = next(e for e in r["extents"] if e["role"] == "top")
        self.assertAlmostEqual(top["model_mm"][0], 500.0, places=2)
        self.assertFalse(top["within"])

    def test_compare_needs_a_step(self):
        with self.assertRaisesRegex(DrawingError, "needs --model"):
            run("compare", "--root", self.r, self.f("plate.pdf"))
        with self.assertRaisesRegex(DrawingError, "STEP"):
            run("compare", "--root", self.r, self.f("plate.pdf"), "--model", self.f("plate.dxf"))


if __name__ == "__main__":
    os.environ.setdefault("PYTHONHASHSEED", "0")
    unittest.main()
