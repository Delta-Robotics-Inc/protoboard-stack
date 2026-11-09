# PCB regression set

The reference boards every phase of the PCB editor overhaul is measured
against (Phase 0 of the overhaul). For each
board the runner records, and later compares:

- from the board file, read with the stack's own S-expression reader (no KiCad
  needed): copper layers, footprints, tracks (segments and arcs), vias, zones,
  nets and the Edge.Cuts outline's size;
- from `kicad-cli` (KiCad 10), when installed: DRC with the stack's one DRC
  command with every error of each track (`pcb drc --format json --severity-all
  --schematic-parity --all-track-errors`), counted
  as errors, warnings, unconnected, schematic parity and each severity and
  type; `pcb export stats` (size, components, vias, pads); a top-side render
  (`render-top.png`) and one SVG per copper, silkscreen, mask and outline layer
  (`layers/*.svg`) as golden images.

Every kicad-cli call runs on a copy of the board's folder in the system's
temporary folder, never on the board in place.

## Run it

```bash
npm run test:pcb-regression                       # every board that is present
npm run test:pcb-regression -- --board airnode-c3 # one board (repeat --board for more)
npm run test:pcb-regression -- --update           # record the baselines again
npm run test:pcb-regression -- --no-kicad         # board-file numbers only
npm run test:pcb-regression -- --jobs 1 --verbose # one board at a time, every row
```

It prints a summary table, then only the rows that differ, then what it
skipped and why. Exit 0 when nothing regressed, 1 when something did or a
board failed to measure, 2 on a usage error. Rules:

- Board structure (layers, footprints, tracks, vias, zones, nets, size, KiCad's
  stats) must not change at all: `CHANGED`.
- Check findings (DRC errors, warnings, unconnected, parity, each DRC type) may
  go down (`improved`, still a pass; record it with `--update`) but never up:
  `REGRESSED`.
- Golden images must match: identical bytes (an SVG's dated title ignored), or
  at most 0.1 % different pixels (`--threshold 0.001`). KiCad's PNG bytes vary
  between runs with identical pixels.

The images of the last run, and a diff image for each failed one, are written
to `packages/ext-tscircuit/test/.tmp/pcb-regression/<board>/` (Git-ignored).

At most two boards run at once by default (`--jobs`, or
`PB_PCB_REGRESSION_JOBS`; never more than four), which keeps an 8 GB laptop
comfortable. A handful of boards takes one to two minutes with KiCad 10.0.5.

The vitest file `test/pcb-regression.test.ts` (part of `npm test`) checks the
comparison rules and the tracked board's file numbers against its baseline,
without KiCad.

## What is tracked and what is local only

| Board | Where | What |
|---|---|---|
| `airnode-c3` | tracked: `test/fixtures/pcb-regression/airnode-c3/`, baseline in `baselines/airnode-c3/` | The sample board: ESP32-C3-MINI-1, USB-C, AP2112K-3.3, SHT40 on I2C, two LEDs, BOOT button; 40 x 30 mm, 2 layers. tscircuit source in `tscircuit/` (how it was built is at the top of `index.circuit.tsx`), its Circuit JSON, and the KiCad board and schematic exported from it. Placed, not routed. Not for fab. |
| any other | local only, listed in `local/manifest.json` | Internal or confidential boards. Their ids, names and paths are written only in the Git-ignored manifest, never in a tracked file. |

Local boards live in `test/fixtures/pcb-regression/local/` (Git-ignored, see
the root `.gitignore`): `local/manifest.json` says where each board's folder
and file are, `local/boards/` holds the copies, `local/baselines/` their
baselines and golden images, and `local/corpus/` any research material kept
beside them. The runner adds every board the manifest lists; when a board's
file is missing, it skips that board and says why. Without a manifest only
the tracked boards run. `PB_PCB_REGRESSION_LOCAL` points the runner at another
local folder.

## Add a board

1. Copy the board's KiCad folder somewhere the runner can read it, with every
   footprint library and 3D model its `fp-lib-table` and footprints refer to
   (the folder is copied whole for each run, so `${KIPRJMOD}/../lib` must be
   inside it: point `root` at the parent).
2. A board that may be shared: put the folder in
   `test/fixtures/pcb-regression/<id>/` and add an entry with
   `"tracked": true`, `root` and `pcb` to `boards.json`. A client or internal
   board: put it under `local/boards/<id>/` and add `"<id>": { "root", "pcb",
   "name", "source" }` to `local/manifest.json`. Do not add it to
   `boards.json` or name it in any tracked file.
3. Record its baseline: `npm run test:pcb-regression -- --update --board <id>`,
   then run it twice without `--update` to check KiCad gives it the same
   numbers every time. A board with copper of different nets overlapping does
   not: KiCad's DRC then counts clearance and shorting items differently from
   run to run (why Airnode C3 is unrouted).
4. A tracked board's baseline (`baselines/<id>/`) is committed with it; a local
   board's stays in `local/baselines/<id>/`.
