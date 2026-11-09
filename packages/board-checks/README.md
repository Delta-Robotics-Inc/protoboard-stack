# @protoboardai/board-checks

Copper connectivity, design rule checks and the status line ("N unconnected, M errors") of
Protoboard's PCB editor, computed headless and deterministically from the board document of
`@protoboardai/board`, with a cross-check against KiCad's DRC when KiCad is installed.

The contract is [docs/specs/pcb-editor/phase1-board-core.md](../../docs/specs/pcb-editor/phase1-board-core.md)
(sections 4.3, 5 and 11: derived data, rule tiers, `Check` and `Finding`).

```ts
import { runBoardChecks, crossCheckWithKicad, formatCrossCheck } from "@protoboardai/board-checks";

const result = runBoardChecks(service.snapshot(), { fills }); // fills: optional derived zone fill
result.summary.line;          // "3 unconnected, 2 errors, 5 warnings"
result.findings;              // the contract's Finding[], sorted by severity then id
result.connectivity;          // ratsnest links, islands, shorts, dangling ends, ...
result.inputHash;             // what the result was computed from (staleness)

const cross = crossCheckWithKicad(result, { pcbPath: "board.kicad_pcb", doc, transform });
console.log(formatCrossCheck(cross)); // or "KiCad cross-check not run: <reason>"
```

`createBoardChecks({ fills })` gives the same checks as contract `Check` objects for
`runChecks(snapshot, checks, ctx)`.

## What is checked

| Check id | What | Severity |
|---|---|---|
| `unconnected` | a missing link of a net's ratsnest (minimum spanning tree over its islands) | error, counted apart from errors |
| `short` | copper of two nets touching, directly or through copper without a net | error |
| `unassigned_copper` | copper without a net touching a net | warning |
| `dangling` | a track end touching nothing; a via meeting copper on fewer than two layers | warning |
| `isolated_copper` | a zone fill island touching no pad, track or via of its net | warning |
| `clearance` | copper of different nets on one layer (pads, tracks, arcs, vias, zone fill) | by rule tier |
| `track_width`, `via_diameter`, `via_hole`, `annular_ring` | sizes (annular ring: vias and plated pads) | by rule tier |
| `hole_to_hole`, `hole_clearance` | drill edge to drill edge; drill to copper of another net | by rule tier |
| `edge_clearance` | copper to the outline and cutouts | by rule tier; copper across or outside the edge is an error by default |
| `courtyard_overlap` | positive-area overlap of courtyards on one side | error by default |
| `silk_to_pad` | silkscreen to pads on its side | warning for overlap by default |
| `via_in_pad`, `via_under_footprint` | policy checks, only with a rule | by rule tier |
| `keepout` | tracks, vias, fill or footprints inside a keep-out that blocks them | `no_go` error, `policy` warning |

Rules resolve in the four tiers of the contract (`src/rules.ts`): the floor is the largest
matching `min`, the target the most specific matching rule, every policy and no-go rule applies
on its own, `severity` overrides and `ignore` drops. A region rule applies when the measurement
point or a measured object reaches into the region. Measurements compare at whole nanometers.
A check whose rule is missing does not run and the result says so (`notRun`, and the summary's
`caveats`); a check that runs on a built-in default says that too (`defaults`).

A filled zone's own `clearance` is checked for its fill against other nets: a warning when the
fill is nearer than the zone asks and no clearance rule already reports the pair.

## Connectivity semantics

- Copper on one layer touches when the shapes meet (gap at most 1 nm). Touching copper of two
  nets is a short, whatever the shapes.
- Touching copper of one net joins (`join: "ends"`, the default) when a track's end cap (the
  half-width disc at its end) touches the other copper, or the center of a pad or via lies in
  the track; pads, vias and zone fill join anything they overlap. A track that only grazes a pad
  or crosses another track along its length does not join it. This is how KiCad's ratsnest
  counts, which is what lets the cross-check match unconnected items one by one. `join:
  "overlap"` joins any touching copper instead.
- A track, via or fill without a net that joins copper of exactly one net carries that net (as
  KiCad does on load); it is still reported as `unassigned_copper`, and `connectivity.carried`
  lists it. Clearance and hole clearance treat carried nets as the object's net.
- Vias join the copper layers they span only; plated pads join every layer.
- Ratsnest nodes are islands holding a pad, a track or a via; `k` islands need `k - 1` links.
  Ties between equal links are broken by island order, so two tools can pick different but
  equally short pairs (the cross-check matches those by net and length).

## Zone fill input

Zone fill is derived data. Without it, zones connect nothing: the result's `zoneFill` is
`absent` or `partial`, `zonesWithoutFill` lists them, the status line says `incomplete`, and a
track end or via inside an unfilled zone of its own net is not called dangling (`undecided`).
`fills` accepts:

- the board importer's derived fill (`protoboard.zone-fill/v1`): `{ fills: [{ zone?, source, net?,
  layer, polygons: [{ outer: [x0, y0, x1, y1, ...], holes: [[...], ...] }] }] }`, rings as flat
  integer nanometer arrays in board coordinates (+Y up, centered). An entry without `zone` is
  copper of its `net` under the id `fill:<source>`;
- `ZoneFill[]`: `{ zone: "zone:<key>", layer, polygons: [{ outline: Vertex[], holes?: Vertex[][] }] }`,
  points may carry `sweep` (flattened to 0.5 micrometers);
- a record or `Map` keyed by zone id then layer, with polygons as `[outline, ...holes]`.

One entry per zone and copper layer. Rings close implicitly; winding does not matter (even-odd).

## Geometry kernel

Every shape is a core grown by a radius: a point (round pads, vias, holes), a segment (tracks,
ovals, slots), an arc (arc tracks, never flattened), or a polygon with holes (rectangles at any
rotation; rounded rectangles as the inset rectangle plus the corner radius; polygon pads, fill,
courtyards). Distances between cores are exact for every pair (`src/geom/prims.ts` documents why
each candidate set is complete) and property-tested against a brute-force reference. Large
polygons get an edge grid. Items sit in a uniform grid per layer with insert and remove, so a
Phase 2 recheck of the neighborhood of a changed object can update the grid in place.

Approximations, each reported in the result's `notes`: arcs inside contours (polygon pads,
fill, outlines for inside tests, courtyards) are flattened to 0.5 micrometers; silkscreen text
is checked as its box (0.6 of the height per character); a rounded rectangle without a corner
radius is checked as a sharp rectangle.

## Staleness

`inputHash` is SHA-256 over the checks version, every record (each record's hash is cached on
its frozen object), the netlist and the fill. `isStale(hash, doc, fills)` compares. Results also
carry the snapshot's `epoch` and `seq`.

## KiCad cross-check

`findKicadCli()` looks at `PROTOBOARD_KICAD_CLI`, then PATH, then `Program Files\KiCad\<version>\bin`
(newest first) on Windows, the app bundle on macOS, `/usr/bin` and `/usr/local/bin` on Linux.
`runKicadDrc` copies the board's folder to the system's temporary folder and runs

    kicad-cli pcb drc --format json --severity-all --all-track-errors --units mm

(no schematic parity). `compareWithKicad` lines up our counts beside KiCad's per category, matches
items by location (KiCad's item positions against our finding's box, 0.1 mm tolerance), and lists
every unmatched item on both sides, every KiCad category we do not check, per-net unconnected
differences, and our findings within 1 micrometer of their limit (`borderline`). The transform
from KiCad millimeters (+Y down) to board nanometers is the importer's offset
(`tx = -offset.x, ty = -offset.y`) or, without it, estimated from footprint positions by
reference. Without KiCad or a board file, the result is `{ ran: false, reason }`.

## Tests

`npx vitest run packages/board-checks` runs unit and property tests of the geometry, connectivity
and each check on hand-built boards, the Airnode C3 fixture, a 6-layer performance board (about
1,000 tracks and 230 vias, target under 2 s), and the cross-check on the tracked sample KiCad board
when the importer and kicad-cli are present. `test/real-boards.local.test.ts` runs the boards of
the Git-ignored local regression manifest, when present, under generic labels.

Apache 2.0. Protoboard is a trademark of Delta Robotics, Inc.
