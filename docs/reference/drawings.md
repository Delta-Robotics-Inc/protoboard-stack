# Drawings to CAD (`protoboard drawing`)

Read a 2D drawing (a vendor datasheet's mechanical drawing as a vector PDF, or a DXF), find its views and
dimensions, crop a view to PNG, and check a model against the drawing's numbers by re-projecting it through
the same views. PB-1190. The research behind it is
`docs/specs/cad-view-research/review-round-1/round-2-notes/drawings-to-cad.md`.

The main use is **verification**: does a sourced or generated body agree with the maker's drawing (round 1
found an EasyEDA USB-C model about 5x too large). Making a body from a drawing stays behind the user's
approval, as the part-file spec says.

## Commands

| Command | What it gives |
| --- | --- |
| `protoboard drawing inspect <file>` | vector or raster per page, page size, text runs, units, the stated scale (or Not To Scale), the projection note, the title block's text, the PDF's encryption and permission flags, whether OCR ran |
| `protoboard drawing views <file> [--page N]` | the orthographic views: id, box (sheet mm, and page points for a PDF), label (TOP VIEW, SECTION A-A, ...), role (front, top, right, left, bottom, back, pcb-layout, section, detail, other), the projection guess with its reason, the title block |
| `protoboard drawing crop <file> --view vN \| --bbox x0,y0,x1,y1 [--dpi 200] [--out x.png]` | a PNG of a view (with a margin that takes its dimensions in) or of a box in sheet mm, plus an overview of the whole sheet with the crop outlined; pixel to page and pixel to mm transforms |
| `protoboard drawing dimensions <file> [--part <id> --write]` | every dimension (table `protoboard.drawing-dimensions/v0`, below); `--write` keeps it as `parts/evidence/<id>/drawing-dimensions.json` |
| `protoboard drawing compare <file> --part <instance> \| --model <x.step> [--view-map v1=front,v2=top] [--tolerance mm] [--no-overlay]` | the model re-projected through each principal view; per-dimension and per-view extents deltas, a verdict, overlay PNGs |

Every command takes `--json` (the whole reply, `protoboard.drawing/v0`) and `--page N` (a PDF page, or a DXF
layout: 1 is model space). `--ocr` lets `inspect` read a raster page when pytesseract and a tesseract binary
are already installed (off by DEFAULT; never installed by Protoboard). `--part` on `compare` resolves the
instance's source STEP from `.protoboard/build/resolved.json`, as `protoboard geometry` does.

The worker is the `drawing` Python package of `@protoboardai/ext-parts` (`scripts/drawing`), run on the
project's CAD runtime (`PROTOBOARD_PYTHON`, else `protoboard tools install cad`) as
`python -I <ext-parts>/scripts/drawing <op> --json --root <project> <file> ...`. The runtime declaration pins
`ezdxf==1.4.5` and `pdfplumber==0.11.10` beside `build123d==0.13.0`.

## Rules the tool keeps

- **Containment and caps.** Every file read or written (the drawing, the model, the crop) must resolve inside
  the project (links followed); outside a project the current folder is the root (DEFAULT). A drawing over
  64 MB, a PDF over 200 pages, a STEP over 256 MB and a crop over 40 megapixels are refused before parsing.
- **Nothing in a file runs.** PDF JavaScript, actions and forms are never executed (pdfplumber and pypdfium2
  only read and rasterise); a DXF is read as data (no ODA converter, no add-on that starts a process); DWG is
  refused (export a DXF or PDF from the source tool). The worker runs isolated (`python -I`) with its working
  folder in the package, never the project.
- **Values come from the text, never from scaled geometry.** Geometry places the anchors and checks
  consistency; a number the drawing does not give is not invented.
- **Provenance.** Every dimension row carries `provenance: {method: "measured-from-drawing", file, sha256,
  page | sheet, entity, reading}`; `entity` names what the value came from (`DIMENSION:<handle>`, or the PDF
  text run and line indices such as `text:7,line:6`).
- **Disagreement is shown, never resolved.** A DXF override text that disagrees with its definition points, a
  PDF value that disagrees with its line at the stated scale, and a model outside tolerance are all flagged
  for a person.

## How each reading works

**DXF.** Each `DIMENSION` entity: the value is the text the drawing shows (the override text, else the
measurement recomputed from the definition points times `DIMLFAC`, rounded to `DIMDEC`). The second reading is
that recomputed geometry, so `agree` is a real check. Tolerances come from the dimension style override
(`DIMTOL`, `DIMTP`, `DIMTM`, `DIMLIM`) or the text (`%%p`, `+a/-b`). `$INSUNITS` gives the unit (0 is taken as
mm, DEFAULT, and said). Blocks are expanded four levels deep.

**PDF.** A page has no dimension semantics. Text is grouped into runs along each character's own direction
(so text rotated 90 degrees reads in order). A run that reads as a dimension (`100`, `60±0.1`, `4X Ø8`,
`R2.5`, `(12)`, a stacked `+0.06` / `-0.02` beside it) is tied to the nearest thin line parallel to it (joined
across the gap its text leaves), whose ends are the anchors; arrowheads (small filled shapes) at both ends raise
the confidence. `Ø` and `R` follow their leader to the tip and the circle there. Thin means the thinnest stroke
width class holding at least 5 % of the page's strokes (DEFAULT, ISO 128 weights); dashed strokes stay
geometry. The second reading is the line's length times the stated scale; on a sheet with no stated scale or
Not To Scale, the page's median value/length ratio is reported and, unless the sheet says Not To Scale, rows
more than 5 % off it are flagged.

**Views.** The part's geometry (not the thin annotation strokes, not the sheet frame) is clustered on a grid of
half-gap cells (gap: 1.5 % of the sheet diagonal, DEFAULT). A cluster whose text reads like a title block is the
title block. Each view takes the nearest label. The projection is read from the sheet's words first (THIRD
ANGLE / FIRST ANGLE), then from labelled views (TOP above FRONT is third angle), else third angle is assumed
(DEFAULT, confidence low, with the reason). Unlabelled views get a role from where they sit relative to FRONT
(the largest unlabelled view, DEFAULT).

**Compare.** The STEP (mm, Z up) is projected per view with build123d `project_to_viewport` (OCCT hidden-line
removal, orthographic). Cameras (DEFAULT): front looks along +Y, top looks down -Z, right looks along -X; back,
bottom and left are the opposites; `--view-map` corrects a role. Registration per view: the scale is the median
value/drawn length of the view's dimensions, else the stated scale, else 1 for DXF model space, else the box
ratio (which cannot see a uniformly wrong size, and says so); centres are matched and the four mirrorings are
tried, keeping the one whose anchors land closest to model features. A linear dimension's anchors snap, along
its direction, to the nearest model vertex or circle extreme; a diameter or radius snaps to the nearest
projected circle. A snap farther than max(1 mm, 3 % of the view) is `unmatched`. The view's extents (drawing box
times the scale against the model's projected box) are compared too: that is what catches a model several
times too large. `delta = model - drawing` in mm; within when `-minus <= delta <= plus`, with the dimension's
tolerance, else `--tolerance`, else ±0.1 mm (DEFAULT). Verdict: `disagrees` if anything is out, else
`incomplete` if something could not be compared, else `agrees`.

## The dimensions table (`protoboard.drawing-dimensions/v0`)

```json
{
  "id": "p1-d3", "kind": "linear", "value": 60.0, "unit": "mm", "value_mm": 60.0,
  "tolerance": {"plus": 0.1, "minus": 0.1, "source": "explicit"},
  "multiplicity": 1, "reference": false, "text": "60±0.1",
  "anchors_mm": [[48.0, 70.0], [48.0, 130.0]], "direction": [0.0, 1.0], "geometryLength_mm": 60.0,
  "arrowheads": 2, "view": "v1",
  "readings": {"text": 60.0, "geometry": 60.0001, "valueFrom": "text"}, "agree": true, "confidence": "high",
  "provenance": {"method": "measured-from-drawing", "file": "fx/plate.pdf", "sha256": "…", "page": 1,
                 "entity": "text:9,line:9", "reading": "vector-pdf"}
}
```

`kind` is `linear`, `aligned`, `diameter`, `radius`, `angle` or `ordinate`. Anchors are sheet mm, y up (DXF:
model units converted to mm). `confidence` is `high` when the reading is tied to geometry and checked (DXF:
override and geometry agree; PDF: arrowheads at both ends, or a leader reaching a circle), `low` when nothing
ties it to geometry or a check failed.

## Licences and confidentiality

Vendor drawings often carry a confidentiality notice and PDF permission flags that forbid copying or
extracting content (the GCT USB4110 drawing in ClientX's folder is encrypted with `/P -1340`: print yes,
extract no). Every op refuses a PDF whose flags forbid content extraction unless `--ignore-pdf-permissions` is
passed (DEFAULT, the orchestrator's conservative ruling at the wave 4 gate; Kevin decides, and the question for
counsel in the research note stands). The flags, and whether the override was used, are recorded in the reply's
file record (`file.pdf`: `encrypted`, `P`, `permissions`, `override`) and so in a `--write` table's `source`. With
the override, or for a PDF that permits extraction, the tool reads the values for engineering use and:

- never commits a drawing, a crop or an overlay (crops and overlays go to `.protoboard/cache/drawing/`, which is
  gitignored);
- commits only the dimensions table, which is facts with citations (`--write`);
- never sends a drawing to a third-party service (no hosted OCR, no APS).

Test fixtures are generated by `scripts/drawing/tests/make_fixtures.py` (a plate drawn by hand as DXF and as a
PDF); no third-party drawing is in the repository.

## Limits (today)

- PDF circles are found only when drawn as one closed Bézier path; circles split into arcs are not, so a
  `Ø` on such a drawing falls back to the nearest circle or none (confidence low).
- Projection symbols are not read as pictures; only the words THIRD/FIRST ANGLE and labelled view layout.
- Views on dense vendor sheets (several part views, a PCB layout, an ordering table) are a heuristic; check
  `views` and correct roles with `--view-map` before trusting `compare`.
- Angles and ordinates are read but not compared; GD&T frames, stacked MTEXT tolerances in an override text
  (only the dimension style's tolerance is read), LEADER/MULTILEADER callouts in DXF and
  letter-table (IC package) rows are not read yet.
- No vision reading: the crops are made for a person or a vision model to read; agreement between the vector
  reading and a vision reading is the next step (research §C.1).
