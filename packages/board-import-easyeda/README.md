# @protoboardai/board-import-easyeda

Imports EasyEDA Pro project exports into the board document of Protoboard's PCB editor
(contract: [docs/specs/pcb-editor/phase1-board-core.md](../../docs/specs/pcb-editor/phase1-board-core.md),
section 11). Both export formats are read:

- `.epro2`: file format 3, a ZIP holding one project log (`*.epru`, key-value records) and `project2.json`;
- `.epro`: file format 2, a ZIP holding `project.json` and one file per document (`PCB/`, `FOOTPRINT/`, `POUR/`),
  each line a positional JSON array. Records are turned into the format 3 keyed form, so one converter reads both.

```ts
import { easyedaImporter, createEasyEdaImporter, importEasyEdaPro, listEasyEdaPcbs } from "@protoboardai/board-import-easyeda";

listEasyEdaPcbs(bytes);                          // the PCB documents of a project
const r = importEasyEdaPro(bytes, { pcb: "Main" }); // by title or uuid; default: the first board's PCB
r.document; r.netlist; r.report;                 // ImportResult
r.fill;                                          // derived zone fill (protoboard.zone-fill/v1)
r.offset;                                        // what was subtracted to center the board (nm)
r.recordTypes;                                   // every record type read, with counts and handling
```

`easyedaImporter` (and `createEasyEdaImporter(options)`) is the `Importer` object for a registry
(`id: "easyeda-pro"`). Everything it creates has provenance `{ by: "imported", tool: "easyeda-pro" }`.

## Clean room: sources

Written only from EasyEDA's published file-format documentation and from exports. No EasyEDA code, no notes on
its internals, and no inspection of the application were used.

- File format index (English): https://prodocs.easyeda.com/en/format/index (mirror:
  https://prodocs.lceda.cn/en/format/index/), PCB pages https://prodocs.easyeda.com/en/format/pcb/index/ and
  https://prodocs.easyeda.com/en/format/pcb/common/
- File format 3 specification, 2025-10-21 (Chinese):
  https://image.lceda.cn/files/lceda-pro-file-format-v3_2025.10.21.md (also `.pdf` and `.zip`)
- File format 2.2 specification, 2022-12-15 (PDFs: common format, PCB document format):
  https://image.lceda.cn/files/lceda-pro-file-format-v2.2_2022.12.15.zip

Where exports differ from the documentation, the reader follows the exports, and each difference is listed below
so it can be checked.

## Units and axes

- **Lengths are read as mils** (0.001 inch, 25,400 nm). The documentation says 0.01 inch, but every export
  checked uses mils: a 0.5 mm track is 19.685, 1 oz copper is 1.378 (35 um), and the physical layers of a 1.6 mm
  board sum to 62.99.
- **+Y is up and angles are counterclockwise positive** in the file's own coordinates, as documented. The stored
  text outlines (left-bottom aligned glyph cache) extend into +Y with letters upright, so no axis is negated.
- **Footprints**: a component at (x, y) with angle a puts a footprint point p at (x, y) + R(a) p on the top and
  at (x, y) + R(a) (px, -py) on the bottom. This was checked against the track ends that land on pad centers in
  every local export. The board document mirrors bottom footprints left to right, so a bottom footprint gets
  rotation a + 180 and its pads keep their footprint-frame coordinates.
- **Recentering**: the board is shifted so the bounding box of its outline is centered on the origin; the shift
  is in the report and in `offset`.
- Rectangles `["R", x, y, w, h, rot, round]` start at their top-left corner (checked against outlines); a rotated
  rectangle is turned about that corner (the pivot is not documented; reported).

## What is mapped

| Source | Board document |
|---|---|
| `LAYER` (TOP, SIGNAL and PLANE in use, BOTTOM) | copper layers `top`, `inner1`..`inner8`, `bottom` |
| `LAYER_PHYS` (in stored order) | stackup: copper, soldermask and dielectric layers, thickness, material, permittivity, loss tangent; board thickness is their sum |
| outline-layer `POLY`, `LINE`, `ARC` | the outline (largest closed loop, counterclockwise) and cutouts (other loops) |
| `COMPONENT` + `ATTR` (Designator, Footprint, Device) + `FOOTPRINT` document | footprints: reference, footprint name, value and LCSC part from the device, placement, side, lock |
| footprint `PAD` | pads: rect, roundrect, circle, oval, polygon (and regular polygons); smd, plated (round or slotted hole), non-plated; mask and paste margins |
| footprint `LINE`, `ARC`, `POLY`, `FILL`, `STRING` on silk, mask, paste, assembly, document layers | footprint graphics and texts |
| visible component `ATTR` placed on the PCB | footprint texts (`ref` for the designator) in the footprint frame |
| footprint `REGION` | keep-outs tied to the footprint |
| `PAD_NET`, free `PAD`, `NET` | the netlist (`<ref>.<pad>` pins); `NET.netType` becomes net classes |
| copper `LINE`, `ARC`, `POLY` | tracks and arcs (a polyline becomes one track per segment) |
| `VIA` | through vias |
| `POUR` | zones (net, layer, outline, order as priority, minimum width, solid or hatch, islands) |
| `POURED` | derived fill of the pour's zone |
| copper `FILL` | a solid zone, with its exact shape as derived fill |
| `REGION` with prohibitions | keep-outs: TRACK to tracks, VIA to vias, COPPER, FILL, PLANE to pours, COMPONENT to footprints |
| drawing-layer `LINE`, `ARC`, `POLY`, `FILL`, `STRING` | graphics and text |
| `locked` | `locked: true` |

## Not supported (reported with counts on every import)

- Design rules: `RULE` contents are left to the editor by the documentation, so no rule, clearance or pad
  connection mode is imported; `RULE_SELECTOR` is dropped with them. Pours assume thermal pad connections.
- Footprint shapes on undocumented layer types (COMPONENT_SHAPE, COMPONENT_MARKING, PIN_SOLDERING, PIN_FLOATING,
  CUSTOM, and others) and drawings on the MULTI layer.
- Vias, pours and other copper inside footprint documents; PCB-level overrides of footprint shapes other than
  attributes.
- `DIMENSION`, `IMAGE`, `OBJ`, `TEARDROP`, `FPC_FILL`, 3D shell records, differential pairs and equal-length
  groups. Blind and buried via layer pairs (they live in rules) import as through vias.
- Approximations: elliptical pads become ovals; hole offsets are dropped; holes inside pour and fill outlines are
  kept only in the derived fill; text vertical alignment; Bezier spans become 16 segments; a free pad becomes a
  one-pad footprint `FREEPAD<n>`.
- Editor state (`CANVAS`, `PREFERENCE`, `PRIMITIVE`, `PANELIZE*`, `ELE_PLACEHOLDER`, ...) is skipped and counted.

## Seen in exports, not in the documentation

The reader accepts these because the exports use them; each is a candidate to recheck against a newer
specification:

- each log line ends with a `|` after the inner record; an empty inner record deletes, as `""` does;
- format 3 exports write enumerations as names (`"SOLID"`, `"LEFT_BOTTOM"`, `"SUTURE"`), booleans as
  `true`/`false`, positions as `x`/`y`, pad shapes as objects (`{ padType, width, height, radius }`,
  `{ holeType, width, height }`), pour types as `{ pourType, fineness }`, and ids of keyed records as JSON arrays
  (`["PAD_NET", component, pad number, pad id]`, `["POURED", pour id]` with a `pourFill` list);
- pad shapes `ELLIPSE`, `OVAL`, `POLYGON` and hole `SLOT` (the documentation names ROUND, RECT, NGON, POLY);
- the board outline as a `POLY` with `polyType: "BOARD_OUTLINE"`; a dielectric as a `LAYER_PHYS` whose id has no
  `LAYER` record, ordered by `zIndex`;
- format 2 PCB files carrying footprint documents named `<pcb uuid>_<component id>` in their HEAD line, and
  components that name their footprint only through their device.

## Derived fill

`r.fill` is the board core's shared `protoboard.zone-fill/v1` (`DerivedZoneFill` in `@protoboardai/board`: one
entry per zone and copper layer, `outer` counterclockwise and holes clockwise as flat `x, y` lists in nanometers,
`inputHash` over the zone records) with `source: "easyeda-pro"`; `writeZoneFill(boardDir, r.fill)` caches it. Stroked parts of pour results (thermal spokes, hatch lines) are not
included.

## Tests

`test/import.test.ts` and `test/geometry.test.ts` run on hand-written synthetic samples (`test/samples.ts`).
`test/local-samples.test.ts` imports real exports when there are any on the machine: it reads the Git-ignored PCB
regression folder and `PB_EASYEDA_SAMPLES` (paths, or a file listing paths), and is skipped otherwise. It writes
results with generic labels to `test/.tmp/local-results.json` (Git-ignored).

Apache 2.0. Protoboard is a trademark of Delta Robotics, Inc. EasyEDA is a trademark of its owner; this package
is not affiliated with it.
