# @protoboardai/board-3d

The 3D model of a board and its export for mechanical CAD, renders and the 3D viewer. It reads the board document
(`@protoboardai/board`) and runs in plain Node; the stack's CAD runtime (Python with OCP over OCCT) is optional and
only needed to re-read STEP through OCCT and to place part STEP models.

```ts
import { exportBoard3d } from "@protoboardai/board-3d";
const report = await exportBoard3d(doc, { outDir: "out/3d", tier: "full" });
// report.files: STEP, STL (one mesh, and one per body in a ZIP), 3MF, GLB; report.sidecar; report.images (iso, top)
```

## The scene

`buildBoard3d(doc, options)` makes a neutral scene in millimeters: origin at the board center, X right and Y up seen
from the top, Z out of the top face, z = 0 on the board's bottom face.

- **Board**: the outline extruded to the stackup thickness, cutouts and drilled holes (plated holes, slots and vias
  as real holes) cut through it.
- **Components**: one per footprint, placed by `T(x, y, face) R(rotation)`, bottom-side parts turned half a turn about
  Y. Each body comes from, in order: a supplied model (`loadModels`, from a part's UHD definition or a footprint's
  model reference), a parametric body made in code from the recognized package (chip passives, SOT, SOIC, TSSOP,
  MSOP, QFP, QFN/DFN/LGA, modules with shield can and antenna end, USB-C, headers, tactile switches, crystals), else a
  box from the courtyard with a stated default height (a placeholder). Heights come from a table with a source for
  each value (`packages.ts`), or from a size in the library name. Every body says where it came from.
- **Seating**: each body is measured against its footprint (`seating.ts`): the seating plane against the board face
  (floating, sunk), contacts against pads, a better fit turned or mirrored (wrong model axes or pin 1), the courtyard.
  `seat: "fix"` moves a supplied model onto the face and records the move. Per-part overrides (`height`, `offset`,
  `rotate`, `body`, `midMountMm`, `color`) are recorded in the sidecar.

## Tiers and options

| Tier | Board | Components |
|---|---|---|
| `full` | every drilled hole (`vias: false` leaves vias out) | every part its own named solid |
| `mechanical` | unplated holes and plated holes of at least `minHoleMm` (1.5) | envelope boxes; connectors kept as they are |
| `envelope` | as mechanical | a keep-out slab per side to the tallest part, and a height map in the sidecar |
| `board` | every drilled hole | none |

`render: true` adds copper, solder mask openings and silkscreen as thin colored bodies, for marketing renders. It is
off by default: the mechanical model has one solid for the board and one per part.

## Files

- **STEP AP214** (`writeStep`): an assembly with one product per body, named by reference designator and value, one
  manifold solid each (exact planes, cylinders, lines and circles), colors on solids and on faces where a part has a
  second color. `instances: "shared"` shares one product between identical bodies.
- **STL** (`writeStl`, `writeStlZip`): one binary mesh, and one file per body in a ZIP with `bodies.json` (colors).
- **3MF** (`write3mf`): named objects, base-material colors, millimeters.
- **GLB** (`writeGlb`): for the 3D viewer; meters, Y up; component nodes carry `extras.protoboard.partInstanceId`
  (the UHD instance path), `refdes`, `definition`, `placeholder`.
- **Sidecar** (`<name>.board3d.json`, `protoboard.board-3d/v0`): frame, outline, stackup, holes and mounting holes,
  and for every component its transform, name, color, body source, seating result and mating points.
- **Images**: an isometric and a top PNG of every export, drawn from the same triangles (no GPU).

Every file is read back after writing (`validateFile`): solids or objects counted against the tier, names, bounding
box, overlap of each body with the board; with `validate: "occt"` STEP is also read by OCCT.

## Supplied models

`loadModels(doc, resolver, { python })` loads STL and GLB here and tessellates STEP through the CAD runtime.
`composeStepModels` then places each model's own STEP geometry into the board STEP, fused into one solid per part
where its solids touch. The export inherits the most restrictive terms of the models it holds (`terms` in the sidecar).

## Bindings

`BOARD_3D_BINDINGS` lists the CLI commands and MCP tools with names, descriptions and zod input schemas:
`board_export_3d` (`protoboard board export3d`), `board_seating_check` (`protoboard board seating`) and
`board_inspect_3d` (`protoboard board inspect3d`).
