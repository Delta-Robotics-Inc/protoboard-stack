# @protoboardai/board-export

Manufacturing outputs from the board document of `@protoboardai/board`: Gerber X2, Excellon drill, IPC-D-356, BOM
and placement files per fab profile, DXF, and IPC-2581 or ODB++ through `kicad-cli` when it is installed. The
industry files stay standard; Protoboard's context (manifest, origin, images, pre-flight) rides beside them. Every
file comes with an image of it, and everything written is read back and checked.

```ts
import { exportFabPackage } from "@protoboardai/board-export";

const r = await exportFabPackage("path/to/board", "jlcpcb", { outDir: "out/jlcpcb", parts, revision: "B" });
r.preflight.verdict;   // "ready", "overridden" or "not-ready"
r.preflight.items;     // pass, warn, fail, info, skip items, each with its proof image
```

One function per export: `exportGerbers`, `exportDrill`, `exportBom`, `exportPlacement`, `exportIpc356`,
`exportDxf`, `exportIpc2581`, and `exportFabPackage` for all of them. `EXPORT_COMMANDS` describes each for the CLI
and MCP bindings (name, title, description, zod input); `optionsFromInput` turns a command input into the call.

The package folder: `fab/files/` (Gerbers and drill, profile names), `fab/<name>-<profile>-upload.zip` (only when
ready or overridden), `assembly/` (the fab's BOM and CPL and generic ones), `netlist/` (IPC-D-356A), `mech/` (DXF),
`intelligent/` (IPC-2581, ODB++), `data/` (BOM and placement JSON), `images/` (an SVG and PNG per file, composites,
drill map, pre-flight), `manifest.json` (hashes, board revision and document hash, origin, fill, settings, override),
`preflight.json` and `summary.md`. The same board gives byte-identical files; nothing carries a date unless
`creationDate` is given (kicad-cli's own outputs excepted).

Details:

- Coordinates: format 4.6 millimeters, so a Gerber coordinate is the board's integer nanometers less the origin.
  The origin is the outline's center by default (`lower-left` or a point on request), the same in every file.
- Gerber: every pad flashed with `.AperFunction` and `.N`, `.P`, `.C` attributes; tracks and arcs drawn; zone fill as
  regions, one contour per polygon with holes joined by cut-ins; macros for rotated rectangles and ovals, rounded
  rectangles and polygon pads; silkscreen text as strokes in the stack's single-stroke font, optionally cleared from
  mask openings. Zone fill: a current imported or cached fill, else computed by `@protoboardai/board-fill`.
- Drill: plated and non-plated holes in separate files, one file per blind or buried span, slots routed or as `G85`.
- Assembly: part data (`PartData`) supplies LCSC numbers, library class, MPN, consigned, DNP and hand placement; the
  footprint's `supplier_part` is used otherwise. A line without a supplier part number is flagged, never guessed.
  Rotation corrections: the part's own, then an exact LCSC entry, then the longest package pattern of the profile's
  table plus the user's entries. The shipped JLCPCB table has no numeric entries yet; unverified rotations are
  flagged for the placement preview.
- Profiles (`jlcpcb`, `circuithub`, `generic`) are data in `src/profiles.ts`, with the pages each number came from.
- Validation: Gerbers and drill files are read back with this package's readers and compared with the board document
  (every pad, via and track once on its layers, fill area, outline closed, holes and sizes, registration, net
  attributes), placement rows against footprints, the fab's capability rules through `@protoboardai/board-checks`,
  and a `kicad-cli` cross-check when a matching KiCad board is given.

Tests: `test/writers.test.ts` (hand-computed expectations), `test/airnode.test.ts` (round trip, determinism, the
tracked golden package in `test/golden/airnode-c3-jlcpcb/`; update with `PB_UPDATE_GOLDEN=1`), and
`test/real-boards.local.test.ts` (local boards of the regression manifest; skips without it).
