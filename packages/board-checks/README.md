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
| `clearance` | copper of different nets on one layer (pads, tracks, arcs, vias, zone fill), one finding per pair | by rule tier; a zone's own clearance is an error by default |
| `physical_clearance` | any two copper objects, same net included, only with a rule | by rule tier |
| `track_width`, `via_diameter`, `via_hole`, `annular_ring` | sizes (annular ring: vias and plated pads) | by rule tier |
| `hole_size` | every drilled hole, vias and pads (a slot by its narrow side for a minimum, wide side for a maximum) | by rule tier |
| `hole_to_hole`, `hole_clearance` | drill edge to drill edge; drill to copper of another net | by rule tier |
| `edge_clearance` | copper to the outline and cutouts | by rule tier; copper across or outside the edge is an error by default |
| `courtyard_overlap` | positive-area overlap of courtyards on one side | error by default |
| `silk_to_pad` | silkscreen to pads on its side, one finding per silkscreen element | warning for overlap by default |
| `via_in_pad`, `via_under_footprint` | policy checks, only with a rule | by rule tier |
| `keepout` | tracks, vias, fill or footprints inside a keep-out (holes respected) that blocks them | `no_go` error, `policy` warning |
| `disallow` | an object a `disallow` rule matches (KiCad's `disallow` constraint) | by rule tier |

Rules resolve in the four tiers of the contract (`src/rules.ts`), with explicit precedence:
within each tier only the matching rules of the highest `priority` take part, so a later, more
specific rule overrides rather than combines. Then the floor is the largest `min` left, the
target the most specific rule left, every policy and no-go rule left applies on its own,
`severity` overrides and `ignore` drops. `applies.when` conditions (object kind pairs, net,
class, layer, pad type and number, footprint, courtyard, named rule area, position) are tested
with the objects in both orders. A region rule applies when the measurement point or a measured
object reaches into the region. A check whose rule is missing does not run and the result says
so (`notRun`, and the summary's `caveats`); a check that runs on a built-in default says that
too (`defaults`).

A filled zone's own `clearance` is a floor at priority 0 for its fill against other nets: it
joins priority-0 floors (net classes, board setup) by the largest minimum and gives way to a
matching floor of a higher priority (a KiCad custom rule), at the error severity unless the
priority-0 floor it joins says otherwise. A keep-out is a disallow at priority 0: an object a
higher-priority `disallow` rule matches is reported by that rule (with its severity) instead.

**Tolerance.** A distance (clearance, physical clearance, hole clearance, hole to hole, copper
to edge, silkscreen to pad, diff pair gap) passes when it is short of its minimum by at most
500 nm (`DISTANCE_TOLERANCE_NM`); a size (track width, via diameter, hole size, annular ring)
compares exactly at whole nanometers. This is what KiCad 10 does, measured with `kicad-cli` on
test boards: a clearance 0.5 um short passes and 0.501 um short fails; a width 1 nm short fails.

### KiCad's precedence, as confirmed

Measured with `kicad-cli pcb drc` (KiCad 10.0.5) on small hand-written boards, read with KiCad's
public custom-rules and board-setup documentation; no KiCad source was read:

- For one constraint type on one object or pair, the last matching custom rule in the `.kicad_dru`
  wins: over earlier custom rules (a later, smaller minimum relaxes an earlier, larger one), over
  net class values and over board setup minimums (a custom clearance of 0.1 mm passes a gap a
  board minimum of 0.18 mm would fail). A rule's `(layer ...)` and `(condition ...)` decide whether
  it matches; its `(severity ...)` sets the severity, `ignore` silences.
- With no matching custom rule, clearance is the largest of the board setup minimum, the net class
  clearance of either object and a zone's own clearance ("zone clearance", an error).
- Net class track widths and via sizes are not checked by DRC; a custom rule's `opt` is not either.
- Board setup values absent from the project take KiCad's defaults: copper to edge 0.5 mm, track
  width 0.2, via diameter 0.5, hole 0.3, annular ring 0.1, hole clearance 0.25, hole to hole 0.25
  (clearance 0). The minimum hole and annular ring apply to plated pads too.
- Default severities: hole to hole is a warning; clearance, track width, via diameter, hole size,
  annular ring, hole clearance, copper to edge and items not allowed are errors.
- Keep-out rule areas act as disallow rules below every custom rule: a custom `disallow via` rule
  matching a via in a keep-out replaces the area's error with its own severity; a custom rule
  that disallows only tracks does not affect a via there.
- A zone's or rule area's polygons after the first are holes in it.
- KiCad identifies items by UUID: two pads sharing one are reported as one item.

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

## Incremental checks

For live checks while editing (contract `docs/specs/pcb-editor/phase2-editing.md`, section 6.2):

```ts
import { createIncrementalChecks } from "@protoboardai/board-checks";

const live = createIncrementalChecks(doc, { fills });  // a full run; live.result as runBoardChecks returns
const u = live.update(nextDoc, reply.changed);          // a transaction's changed ids
u.result;              // equals runBoardChecks(nextDoc, { fills }): findings, order, summary, connectivity
u.added; u.removed;    // findings by id against the previous result (a changed finding is in both)
u.mode; u.ms;          // "incremental" or "full"
live.update(nextDoc, changed, { fills: refilled, fillChanged: ["zone:gnd"] }); // a refill
```

The check model is kept per record (a footprint with its pads, holes, courtyard and silkscreen; a
track; a via; a silkscreen graphic or text). An update rebuilds the records that changed (the
given ids plus every record that is not the same frozen object as before, plus footprints whose
pads changed net), measures only the added copper against its neighbors, recomputes connectivity
from the kept pair scan (linear), and has each check measure again only where copper, pads,
holes or courtyards were added or removed within its search distance, or where an object's
carried net changed. New zone fill is compared with the kept fill polygon by polygon and hole by
hole (holes matched by content): copper pairs and per-object results away from the holes that
changed stand, and only copper near those holes is measured against the new fill.

A full run (`mode: "full"`) replaces it for edits with board-wide reach: rules and net classes,
the outline and cutouts, the board record and the stackup, zones and keep-outs, the netlist, any
record kind not rebuilt per record, and footprint changes while a rule condition tests
courtyards. For fill: fill going from absent to present (or back), a change in which zones have
fill or in the fill's notes, more than half of the rings changed (a new plane outline), new fill
while a rule tests an object's shape against an area (a region, a courtyard or area condition),
and `fillChanged` without new fill. `analyzeBoard`'s cache is never read or written.

The equality is a tested property (`test/incremental.test.ts`): random edit sequences applied
through the board engine (tracks, vias, footprints moved, rotated and flipped, nets set and
cleared, silkscreen, zones, rules and refills) on the Airnode C3 fixture and a small four-layer
board (antipad holes moved, added, removed and reordered in its plane fill), each step compared
with a full run. On the 6-layer performance board a single track move, and a via move whose
antipads move in both plane fills, update in under 50 ms (`test/incremental-perf.test.ts` prints
the timings).

## KiCad cross-check

`findKicadCli()` looks at `PROTOBOARD_KICAD_CLI`, then PATH, then `Program Files\KiCad\<version>\bin`
(newest first) on Windows, the app bundle on macOS, `/usr/bin` and `/usr/local/bin` on Linux.
`runKicadDrc` copies the board's folder to the system's temporary folder and runs

    kicad-cli pcb drc --format json --severity-all --all-track-errors --units mm

(no schematic parity). `compareWithKicad` compares like with like. `CATEGORY_ROWS` maps each of
our checks to the KiCad violation types that measure the same thing (`clearance` and
`physical_clearance` to `clearance`, `hole_size` and `via_hole` to `drill_out_of_range`,
`keepout` and `disallow` to `items_not_allowed`, and so on); the comparable errors and warnings
are the sums over those rows. Checks KiCad has no counterpart for (`unassigned_copper`, the
policy checks) are counted apart as ours only; KiCad types we do not check (text height,
footprint library mismatch, silkscreen overlap, copper slivers, ...) as KiCad only. KiCad's
reports are counted once per distinct item set: with `--all-track-errors` KiCad reports a track
once per place along it against the edge and a hole clearance once per copper layer, where we
report one finding per object pair (an edge item is matched by its copper item). KiCad items
under a rule the importer could not express (`notEvaluated`, from the import's
`rulesNotEvaluated`) are listed apart and counted nowhere. Items match by location (a KiCad item
position against our finding's box, 0.1 mm tolerance, an error only with an error), preferring
the finding whose object KiCad places there; every unmatched item on both sides is listed. The
transform from KiCad millimeters (+Y down) to board nanometers is the importer's offset
(`tx = -offset.x, ty = -offset.y`) or, without it, estimated from footprint positions by
reference. Without KiCad or a board file, the result is `{ ran: false, reason }`.

## Tests

`npx vitest run packages/board-checks` runs unit and property tests of the geometry, connectivity
and each check on hand-built boards, the Airnode C3 fixture, a 6-layer performance board (about
1,000 tracks and 230 vias, target under 2 s), and the cross-check on the tracked sample KiCad board
when the importer and kicad-cli are present. `test/real-boards.local.test.ts` runs the boards of
the Git-ignored local regression manifest, when present, under generic labels.

Apache 2.0. Protoboard is a trademark of Delta Robotics, Inc.
