# G-code viewer

The G-code tab shows a sliced FDM print the way slicers preview it: every extrusion as a bead coloured by feature type, travel moves on request, a two-ended layer slider, a legend that is also the filter, and time and filament estimates (PB-1192).

Code: uhd-viewer `src/gcode/` (parser, draw, layer range) and `src/cad/GcodeView.tsx` (the tab). Tests: uhd-viewer `test/gcode.test.ts` with hand-written fixtures in `test/fixtures/gcode/` (one per comment style; no slicer output is copied).

Clean room: written from the G-code and comment formats only. No code from any G-code viewer or slicer was read for it or copied (PrusaSlicer, OrcaSlicer, Bambu Studio and most web viewers are GPL or AGPL). The rendering idea (all toolpath data static on the GPU, the view changes only which segments draw) is the one round 1 described in its own words (`docs/specs/cad-view-research/review-round-1/slicers-orca-bambu.md` §2.6). No new dependency: three.js r187 `InstancedBufferGeometry` is all it uses.

## What it reads

Plain FDM `.gcode` (not `.bgcode`, not `.gcode.3mf` yet):

| Input | Read as |
| --- | --- |
| `G0`, `G1` | moves; with a positive extrusion: a bead, else a travel. A move with no length (a retract, an unretract, a feed change) is no segment |
| `G2`, `G3` | arcs in the XY plane, from `I`/`J` (centre offsets) or `R` (radius; negative for the long way round); split into straight pieces within 0.01 mm of the arc, Z and E spread along it. Arcs outside the XY plane (`G18`, `G19`) are drawn straight and counted as warnings |
| `G90`, `G91`, `M82`, `M83` | absolute or relative axes and extruder (`G90`/`G91` set the extruder too; `M82`/`M83` after them win) |
| `G92`, `G28` | set position; home (to 0) |
| `G20`, `G21` | inches, millimetres |
| `;TYPE:` (PrusaSlicer, OrcaSlicer, Cura) and `; FEATURE:` (Bambu Studio, Orca for Bambu printers) | the feature type, mapped by keyword onto 16 types (`src/gcode/features.ts`); an unknown name is "Other", never an error |
| `;LAYER:` (Cura), `;LAYER_CHANGE` (PrusaSlicer, Orca), `; CHANGE_LAYER` (Bambu) | layer starts. Without them, a layer starts at each extruding move at a new Z; a Z hop on a travel never starts one |
| `;WIDTH:`, `; LINE_WIDTH:`, `;HEIGHT:`, `; LAYER_HEIGHT:` | the bead's width and height; without them the width comes from the volume pushed (filament area × E over length × layer height) |
| `;TIME:`, `estimated printing time`, `total estimated time`, the first `M73 … R` | the slicer's own time estimate, shown beside ours |
| `filament_diameter` | for widths and filament use (1.75 mm when the file does not say, DEFAULT) |

Line numbers (`N…`), checksums (`*…`) and parenthesis comments are skipped. Nothing in a file is executed; commands it does not draw are ignored.

Units and frame: millimetres, Z up, the printer's own coordinates. The 3D view's scene is millimetres and Z up as well, so nothing converts.

## The model

`parseGcode(text)` or `parseGcodeStream(stream)` returns a `GcodeModel`:

- two column stores in file order, one for extrusions and one for travel: start xyz and end xyz (Float32), feature (Uint8), layer (Uint32), width and height in 0.01 mm (Uint8), source line (Uint32): 35 bytes a segment;
- a layer table: Z, height, the segment window of each layer in both stores, a 16-bit mask of the types present, time;
- per-feature totals (segments, length, time, filament), our time estimate (lengths over feed rates, no acceleration: a lower bound), the slicer's when present, the slicer's name.

Parsing streams the file in chunks and yields to the page between them (DEFAULT: on the main thread; a Web Worker is the next step once the viewer's four build configurations agree on worker bundling).

## Drawing

- **One instanced draw** for every extrusion: each segment is an instance of an 8-corner prism (8 triangles), placed by the vertex shader from the parser's arrays, which go to the GPU as they are (no copy). A second draw only for travel moves, when they are shown.
- **The layer range is a window.** Layers are contiguous in file order, so a range is one run of segments: the draw's attributes start at the run's first segment (an attribute over the same buffer with a moved offset; nothing is uploaded again) and the instance count is the run's length. Layers outside the range cost nothing.
- **Feature toggles** are a 16-entry uniform; hidden segments are moved out of the clip volume in the vertex shader.
- **Layers under the top one** are dimmed (toggle).
- Colours: a fixed data palette (`features.ts`, DEFAULT, our own values, not a slicer's); travel takes the theme's faint text colour. Panels use the viewer's theme tokens.
- The scene is the 3D view's own (`createScene`), without batching, toon bands or ink (they are for CAD bodies). The interaction quality curve runs as everywhere; the tab only reads its state to say when it draws at reduced quality.

## The layer slider

Two ends (top and bottom) over the layers that hold a **visible** segment: hide every type but support, and the slider steps only through layers with support in them. When the toggles change, the chosen layers are kept where they still exist.

## Size caps

| Cap | DEFAULT | Past it |
| --- | --- | --- |
| File size | 256 MB | joining starts at once: up to 2, 4, 8 … contiguous moves of the same feature and layer become one segment |
| Segments | 20,000,000 | the stores are compacted (contiguous pairs joined), and joining doubles from there; if that is not enough, every other segment is dropped (never a layer's first) |

Either way the model's `decimation` says how much and why, and the tab shows it. Nothing is cut silently.

## Measured (W4-B, 2026-11-01)

Headless Chrome 1440 × 900, dpr 1, ANGLE Direct3D 11 on an Intel UHD (0x9BC4); numbers and commands in `docs/specs/cad-view-research/phase-1/progress.md`, section W4-B.

| File | Segments | Parse | Draws (+ grid) | Frame, all layers | Frame, top layer |
| --- | ---: | ---: | ---: | ---: | ---: |
| `prusa-style.gcode` fixture | 60 | 1.5 ms (Node) | 1 | 4.0 ms | 3.2 ms |
| synthetic, print-like density | 1,996,516 | 0.88 s Node, 1.09 s Chrome | 1 | 110 ms | 3.0 ms |

Frame = draw plus a GPU sync (a 1-pixel read). A two-million-segment print on this integrated GPU is vertex-bound at about 9 frames a second with every layer shown; next steps are a display simplification that joins nearly collinear moves (perimeters of curved parts) and drawing in a worker.

## Mounting

`<GcodeView url="…" />` (or `text`, or `file`), from `src/cad/GcodeView.tsx`. The tab's mount line in the 3D view's toolbar and the `components` export belong to W4-D (shared files; `docs/specs/cad-view-research/phase-1/handoffs.md`, 2026-11-01). The agent surface (`gcode.summary`, `gcode.capture`) and `.bgcode` / `.gcode.3mf` reading are not built yet.
