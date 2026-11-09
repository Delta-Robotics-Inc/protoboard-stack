# PCB editor, Phase 1: the board core (contract)

Status: **stable for Phase 1 builders** (2026-11-09). Package: `@protoboardai/board` in
`packages/board/`. This document is the interface other packages build against: importers,
checks, the renderer, the agent scene exporter, and the CLI and MCP bindings. If the code and
this document disagree, the code's exported types win and this document is fixed.

## 1. What the core is

- One **board document**: the stored intent of a printed circuit board (placement, copper,
  zones, outline, rules, locks). Derived data (zone fill, ratsnest, check results, renders) is
  never stored in it.
- One **operation registry**: every change is a named, typed operation with a zod input
  schema, a pure apply function and an inverse. The editor, the CLI, MCP tools, routers and
  importers all write through it. There is no other writer.
- One **board service** per board: the single owner of the live document. It applies
  transactions, keeps versions, leases, per-actor undo and the journal, and saves files. Every
  window, CLI call and agent is a client of it.
- No browser code. The package runs in Node; a browser reaches it through the service's wire
  protocol (section 9.3).

Package layout:

| Path | Contents |
|---|---|
| `src/units.ts` | `mm`, `toMm`, `deg`, `toDeg`, `normAngle` |
| `src/schema.ts` | record types and zod schemas, ids, layers, file of each kind |
| `src/canonical.ts`, `src/keys.ts` | canonical JSON, hashes, `deterministicKey` |
| `src/document.ts` | the immutable document, derived nets, pad ids, net classes |
| `src/geometry.ts` | boxes, the footprint transform, world pads, box and layers per record |
| `src/ops/` | the registry and every operation |
| `src/transaction.ts` | the transaction engine (preconditions, locks, leases, versions, undo) |
| `src/leases.ts` | leases with fencing tokens (ported from the 3D viewer's store) |
| `src/journal.ts` | the on-disk journal and crash recovery |
| `src/format.ts` | load and save of the on-disk files |
| `src/paths.ts` | the project root, board key, local state and derived data folders (section 7) |
| `src/derived.ts` | the shared derived data types: zone fill (section 4.3) |
| `src/index-spatial.ts` | the query index (region, point, net) |
| `src/service.ts` | the board service |
| `src/extensions.ts` | importer, check, renderer and finding types |
| `src/fixtures/airnode-c3.ts` | the synthetic Airnode C3 test board |

Import everything from `@protoboardai/board` (`src/index.ts`).

## 2. Units and coordinates

- **Lengths are integer nanometers** in the document, on disk and in operation inputs. 1 mm is
  1,000,000. Integers make saves byte-stable, make apply-then-inverse exact, and leave room
  for 9,000 km at full precision. Helpers: `mm(1.5) === 1_500_000`, `toMm(nm)`.
- **Angles are integer millidegrees**, counterclockwise positive, seen from the top. Rotations
  are normalized to `[0, 360000)`. Arc sweeps are signed, `(-360000, 360000]`, nonzero.
  Helpers: `deg(90) === 90000`, `toDeg(mdeg)`.
- Other physical scalars (relative permittivity, loss tangent, costs) are plain finite numbers.
- **Origin at the board center by default**; **+Y up**; X to the right, seen from the top. A
  KiCad importer negates Y. The outline is normally centered on (0, 0); nothing breaks if it is
  not, but generators and importers center it.
- **Bottom side**: a footprint on the bottom is mirrored left to right in its own frame, then
  rotated. A point `p` of a footprint lands at `T(x, y) * R(rotation) * M(side) * p`, with
  `M(top) = identity` and `M(bottom) = (x, y) -> (-x, y)`. Flipping keeps `x, y`, toggles
  `side` and negates `rotation`, so flipping twice is the identity.
- **Pads on both faces**: an SMD pad's `layer` names its side in the footprint frame: `top` (absent means
  `top`) is the footprint's own side, `bottom` the opposite side. Its copper lands on
  `padWorldSide(fp, pad)`: the footprint's side for `top`, the other outer layer for `bottom`. Every pad,
  either face, goes through the same transform above, so a flip moves both faces to the other side and
  flipping twice is still the identity.
- **Rotations of footprint children in the world**: a pad's or text's frame rotation `r` shows at
  `rotation + r` on a top footprint and `rotation - r` on a bottom one (`padsOf` gives pads' world rotation;
  texts follow the same rule, which is the angle KiCad and Circuit JSON report for mirrored text).

### 2.1 Field names and Circuit JSON

Field names follow Circuit JSON where the concept exists; units differ (Circuit JSON is mm and
degrees). The projection is a field copy with `toMm` and `toDeg`.

| Ours (record.field) | Circuit JSON | Notes |
|---|---|---|
| `footprint.x, y, rotation, side` | `pcb_component.center.{x,y}`, `rotation`, `layer` | `side` is `top` or `bottom` |
| `footprint.ref` | `source_component.name` | reference designator |
| `pad` (`smd`, rect, circle) | `pcb_smtpad` `shape, x, y, width, height, radius, layer` | pad x, y are footprint-relative here, world in Circuit JSON; Circuit JSON's `layer` is the world side (`padWorldSide`), ours the frame side |
| `pad` (`th`) | `pcb_plated_hole` `outer_diameter, hole_diameter` or `outer_width, outer_height, hole_width, hole_height` | |
| `pad` (`np`) | `pcb_hole` `hole_diameter` | |
| `track` | `pcb_trace.route[]` wire points `x, y, width, layer` | ours is one record per segment; connected segments of a net chain into one `pcb_trace` |
| `track.sweep` (arc) | none | projected as a polyline, 1 degree steps |
| `via` | `pcb_via` `x, y, outer_diameter, hole_diameter, from_layer, to_layer, layers` | |
| `zone` | `pcb_copper_pour` | ours is intent; Circuit JSON pours are fill results and are not imported as zones |
| `keepout` | `pcb_keepout` `outline` or `center, width, height`, `layers` | `blocks` maps to `allow_traces` and `allow_placements` where it can |
| `outline` | `pcb_board.outline`, `width`, `height`, `center` | |
| `graphic` on silkscreen | `pcb_silkscreen_line, _path, _rect, _circle` | |
| `text` | `pcb_silkscreen_text`, `pcb_text` | |
| copper layer names | `layer_ref`: `top`, `inner1` to `inner8`, `bottom` | same strings |
| nets | `source_net.name` | |

Concepts without a Circuit JSON home (rule tiers, net classes, zone priorities, keep-out
`blocks`, locks, provenance, stackup materials) are additive in our schema. Only an adapter
package imports `circuit-json` or `@tscircuit/*`; this package does not.

## 3. Ids

Every stored record has a string `id`, unique across the document, of the form `<prefix>:<key>`.
Keys use letters, digits and `_ . - / + ~`; a colon never appears in a key except in net names.

| Kind | Id | Key source |
|---|---|---|
| board | `board` | singleton |
| layer | `layer:<name>` | stackup layer name (`top`, `inner1`, `core1`, `top_mask`) |
| outline | `outline` | singleton |
| cutout | `cutout:<key>` | owner-issued or importer key |
| footprint | `fp:<key>` | the UHD instance path when known (`fp:power/ldo`), else the reference designator (`fp:U2`) |
| track (segment or arc) | `trk:<key>` | owner-issued, or deterministic for generated copper |
| via | `via:<key>` | as track |
| zone | `zone:<key>` | owner-issued or chosen by a host |
| keepout | `kpo:<key>` | as zone |
| graphic | `gfx:<key>` | as zone |
| text | `txt:<key>` | as zone |
| net class | `class:<name>` | class name |
| rule | `rule:<name>` | rule name, chosen by the writer |

Derived ids, never stored as records: pads `pad:<footprint key>:<pad key>` (pad key is the pad
number; a repeated number gets `~2`, `~3` in file order), nets `net:<name>`.

- **Owner-issued keys** are `<epoch>.<n>`: `epoch` is six random base-36 characters per service
  session, `n` rises and is never reused. Agents never choose ids for new copper, zones,
  keep-outs, graphics or text: they pass a `handle` and the reply maps handles to ids. Later ops
  in the same transaction may refer to `"$<handle>"` wherever an id is expected.
- **Deterministic keys** for generated and imported objects: `g.<hash>` where `hash` is the
  first 12 hex digits of SHA-1 over the canonical JSON of the record's identity fields (net,
  layer, geometry), via `deterministicKey(prefix, fields)`. Regenerating identical copper
  yields identical ids.
- **Ids never repeat**: owner-issued keys come from a counter that only rises within an epoch,
  and each epoch is new, so a removed id is never reissued to a different object. Only hosts
  (importers) choose ids, and only undo, redo and `record.put` bring a removed id back.
- **Surviving regeneration**: footprints match by UHD path, then by reference designator; pads
  by number; nets by name. Owner-issued copper lives only in our files, so a regeneration never
  touches it. Generated copper is replaced only where it is unlocked and still has
  `provenance.by === "generated"`. Net renames upstream are mapped by pin membership (Phase 2,
  `netlist.sync`).

## 4. The board document

`BoardDocument` is immutable (records are frozen) and holds:

```ts
interface BoardDocument {
  readonly records: ReadonlyMap<string, BoardRecord>;   // every stored record by id
  readonly netlist: Netlist | undefined;                  // the input netlist, if any
  readonly nets: ReadonlyMap<string, NetInfo>;            // derived: name -> pads, class
  readonly padNets: ReadonlyMap<string, string>;          // derived: pad id -> net name
}
```

Every record has `kind` and `id`. Optional fields are omitted, never `null`. Common optional
fields: `locked?: true` and `provenance`.

### 4.1 Record kinds

**board** (`board`): `name`, `thickness` (nm), `copper_layers` (1 to 10), `origin:
"center"`, `simulation?` (reserved), `workflow?: { order: "cad-first" | "board-first" }`.

**layer** (stackup, top to bottom): `name`, `type: "copper" | "dielectric" | "soldermask"`,
`order` (0 is the top), `thickness` (nm), `material?`, `epsilon_r?`, `loss_tangent?`,
`copper_weight_oz?`. Copper names are `top`, `inner1` up to `inner8`, `bottom`, in order. The
non-stack drawing layers are a fixed vocabulary, not records: `top_silkscreen`,
`bottom_silkscreen`, `top_soldermask`, `bottom_soldermask`, `top_paste`, `bottom_paste`,
`top_fabrication`, `bottom_fabrication`, `top_courtyard`, `bottom_courtyard`, `edge_cuts`,
`user_notes`.

**outline** (`outline`): `outline: Vertex[]` (closed, at least 3 vertices), `source: { kind:
"board" } | { kind: "cad", ref: string }`. A CAD-driven outline is read-only to
`outline.set` unless the input says `detach: true`.

`Vertex = { x, y, sweep? }`: `sweep` is the arc from this vertex to the next one; absent means
a straight edge.

**cutout**: `outline: Vertex[]`.

**footprint**: `ref`, `path?` (UHD instance path), `footprint` (library name, for example
`Airnode:SOT-23-5`), `value?`, `supplier_part?` (LCSC number, `C` and digits), `x, y,
rotation, side`, `pads: Pad[]`, `courtyard?: Vertex[]`, `graphics?: FootprintGraphic[]`,
`texts?: FootprintText[]` (each with `role?: "ref" | "value" | "user"`), `locked?`, `provenance`. Pad, graphic and text coordinates are in the
footprint frame; their layers name the footprint's own side (`top`, `top_silkscreen`) or, for an
SMD pad on the other face, the opposite side (`bottom`), and every one of them lands on the other
side when the footprint is on the bottom.

**Pad**: `number` (string), `type: "smd" | "th" | "np"`, `shape: "rect" | "roundrect" |
"circle" | "oval" | "polygon"`, `x, y`, `rotation?`, and per shape: `width, height` (rect,
roundrect, oval smd), `corner_radius?` (roundrect), `radius` (circle smd), `points?: Vertex[]`
(polygon); `layer?: "top" | "bottom"` for smd (footprint frame: `top`, the default when absent, is the
footprint's own side, `bottom` the opposite side; section 2; a drilled pad may not say `bottom`);
`outer_diameter, hole_diameter` (round
`th`), `outer_width, outer_height, hole_width, hole_height` (slotted `th`), `hole_diameter`
(`np`); `mask_margin?`, `paste_margin?`, `pin?` (UHD pin name). A pad never stores its net.

**track** (a segment, or an arc when `sweep` is set): `net?`, `layer` (copper), `width`,
`start: {x, y}`, `end: {x, y}`, `sweep?`, `locked?`, `provenance`. Arc endpoints are exact; the
center is derived. Copper without `net` is unassigned.

**via**: `net?`, `x, y`, `outer_diameter`, `hole_diameter`, `from_layer`, `to_layer` (copper,
`from` above `to`; a through via is `top` to `bottom`), `tented?: "both" | "top" | "bottom" |
"none"`, `locked?`, `provenance`.

**zone** (intent only): `net?`, `layers` (copper), `outline: Vertex[]`, `priority` (integer,
higher fills first), `clearance?`, `min_width?`, `pad_connection: "thermal" | "solid" |
"none"`, `thermal_gap?`, `thermal_spoke_width?`, `fill_mode: "solid" | "hatch"`,
`hatch_width?`, `hatch_gap?`, `remove_islands: "always" | "never" | "below_area"`,
`island_min_area?` (integer square nanometers; 1 mm squared is 1e12), `name?`, `locked?`,
`provenance`. The fill is derived (section 4.3).

A zone's and a keep-out's optional `holes: Vertex[][]` are contours inside the outline (clockwise); the area is
the outline less its holes (a ring-shaped area is an outline with one hole).

**keepout**: `outline: Vertex[]`, `holes?`, `layers` (copper layer names; at least one), `blocks: {
tracks, vias, pours, footprints }` (all four booleans required, so every keep-out states what
it blocks), `tier: "no_go" | "policy"`, `footprint?` (an `fp:` id it belongs to), `name?`,
`description?`, `locked?`, `provenance`.

**graphic**: `layer` (drawing or copper layer), `shape: "line" | "arc" | "circle" | "rect" |
"polygon" | "path"`, with `start, end, sweep?` (line, arc), `center, radius` (circle), `center,
width, height, rotation?` (rect), `points: Vertex[]` (polygon closed, path open),
`stroke_width`, `filled?`, `locked?`, `provenance`.

**text**: `layer`, `text`, `x, y`, `height`, `stroke_width?`, `rotation?`, `anchor?: "center" |
"left" | "right"`, `mirrored?`, `locked?`, `provenance`.

**netclass**: `name`, `nets?: string[]`, `patterns?: string[]` (glob, `*` and `?`),
`description?`. A net's class: an explicit `nets` entry, else the first class (by id) whose
pattern matches, else the netlist's `class`, else `default` (`netClassOf(doc, net)`).

**rule**: `tier`, `check`, `priority?` (integer 0 to 1,000,000; absent is 0), `applies`, `min?`, `max?`,
`preferred?`, `cost?`, `severity?`, `enabled?: false` (absent means enabled), `note?`, `provenance`. See section 5.
`provenance.from?` says where in the source an imported object came from, in the importer's words (`board
setup`, `board setup (KiCad default)`, `net class GND`, `custom rule 'Width GND'`).

### 4.2 Nets come from a netlist input

```ts
interface Netlist {
  source: string;                 // "uhd", "kicad", "circuit-json", "epro2", "fixture"
  nets: { name: string; class?: string; pins: string[] }[];   // pins as "<ref>.<pad number>"
}
```

The service is given a netlist (from the UHD build) or reads `netlist.jsonl` beside the board
files, which only importers of boards without UHD write. Operations never edit the netlist.
Derived: `doc.nets` (name to pad ids and class) and `doc.padNets`. A track or via whose `net`
is not in the netlist is refused when a netlist is loaded.

### 4.3 Derived data

Zone fills, ratsnest, copper connectivity and findings are derived. They are keyed by the
input they came from (`inputHash` over the records they read), cached under
`<root>/.protoboard/build/board/<board key>/` (`boardBuildDir`; section 7 says which root), and
marked stale when a commit changes any record they read. They never enter the board files or the
journal.

**Zone fill** (`src/derived.ts`, one definition for importers, checks and renderers): the copper each
zone is filled with, cached as `zone-fill.json` in that folder (`zoneFillPath(boardDir)`).

```ts
interface DerivedZoneFill {
  schema: "protoboard.zone-fill/v1";
  source: "kicad" | "easyeda-pro" | "circuit-json" | "computed";   // who produced it
  inputHash: string;              // zoneFillInputHash(doc) of the document it belongs to
  units: { length: "nm" };
  fills: {
    zone?: string;                // the zone record; absent for fill without one (a Circuit JSON pour), which takes `net`
    source: string;               // the producer's id of the filled object (KiCad zone uuid, EasyEDA record, pour id)
    net?: string;
    layer: CopperLayer;           // one entry per zone and copper layer
    polygons: { outer: number[]; holes: number[][] }[];   // flat x0, y0, x1, y1, ... in nm, board frame
  }[];
}
```

`outer` is counterclockwise, each hole clockwise; rings are implicitly closed and have at least three
points. `zoneFillInputHash(doc)` is SHA-256 over the canonical JSON of every zone record sorted by id; a
fill whose `inputHash` differs from the document's is stale (`zoneFillIsCurrent`). An imported fill is
the source tool's last fill: it goes stale only when a zone record changes, and copper moved under a zone
leaves it current but out of date, as in the source tool until it refills. A `computed` fill (a fill
engine, not built yet) uses the same hash. Helpers: `DerivedZoneFillSchema` (zod), `createZoneFill(doc,
source, fills)` (stamps the hash, drops rings under three points), `parseZoneFill`, `readZoneFill(path)`,
`writeZoneFill(boardDir, fill, projectRoot?)` (validated, canonical JSON, through a temporary file),
`loadZoneFill(boardDir, doc)` (`{ fill, current, path }` or undefined).

## 5. Rules in four tiers

| Tier | Meaning | Check treatment | Router treatment |
|---|---|---|---|
| `floor` | what the fab can build | error | hard limit; never relaxed by any other tier |
| `target` | design default | warning when below target but at or above floor | plans at target, may drop to floor locally and reports where |
| `policy` | preference (assembly, rework, signal integrity) | warning with `cost` | cost per violation; a wall only when promoted to `no_go` |
| `no_go` | true prohibition | error | hard, only within its `applies` |

`check` names what is measured: `clearance`, `track_width`, `via_diameter`, `via_hole`,
`annular_ring`, `hole_clearance`, `hole_to_hole`, `edge_clearance`, `silk_to_pad`,
`courtyard_overlap`, `via_in_pad`, `via_under_footprint`, `length`, `diff_pair_gap`, and (added with
precedence) `hole_size` (every drilled hole, vias and pads), `physical_clearance` (any two copper objects,
same net included) and `disallow` (the matching object is not allowed; `min` and `max` unused). Values
`min`, `max`, `preferred` are nm (`length` too). `applies = { nets?, classes?, layers?, between?:
[ObjectKind, ObjectKind], region?: Vertex[], when?: RuleCondition }`; absent fields match everything.

**Conditions.** `when` is an expression over the measured objects A and B: `{ all: [...] }`, `{ any: [...] }`,
`{ not: c }`, `{ same_net: true }`, and terms `{ side: "A" | "B", ... }` with one of `kind` (object kinds),
`pad_type` (`smd`, `th`, `np`), `net`, `class`, `layer`, `area` (inside a keep-out or rule area of that `name`;
`touch: true` for overlapping it), `courtyard` (overlapping the courtyard of a footprint with that reference; `*`
any), `footprint` (belonging to a footprint of that reference or library name; `*` and `?` wildcards), `pad`
(pad number), or `coord: "x" | "y", of: "at" | "start" | "end", gt?, lt?` (a position, board frame, nm). It is
tested with the objects as (A, B) and as (B, A) and matches when either holds; a check of one object has only
A, and a term about B is false. These are the terms KiCad custom rules use on real boards; an importer reports
any other term by name as not evaluated and drops nothing silently.

**Precedence.** Resolution for one check on one object (or pair): collect enabled rules whose `applies` match.
Within each tier, only the matching rules with the highest `priority` take part: a higher-priority rule
overrides lower ones (a smaller minimum relaxes a larger one), it does not combine with them. Then floor gives
the hard minimum (the largest `min` left); target gives the plan value from the most specific rule left
(region, then nets, then classes, then layers, then global; ties take the larger `min`); policy adds every
`cost` left; a `no_go` left refuses. `severity` overrides the tier's default (`error`, `warning`, `info`,
`ignore`); a winning rule set to `ignore` silences the rules it overrides. A zone's own `clearance` is a floor
at priority 0 for the gap between its fill and copper of other nets: it combines with priority-0 floors by the
largest minimum and gives way to a matching floor of a higher priority. A keep-out is a `disallow` at priority
0 for what it blocks: a matching `disallow` rule of a higher priority replaces it.

Importers state precedence with `priority`. KiCad (confirmed with `kicad-cli pcb drc` on test boards): the last
matching custom rule in the file wins over earlier ones and over net class and board setup values, and absent
one the largest of board setup minimum, net class clearance and zone clearance applies; the importer gives
board setup and net class floors priority 0 and custom rules 1000 plus their position in the file. Net class
track widths and via sizes, and a custom rule's `opt`, are routing values KiCad's DRC does not check: they are
`target` rules with only `preferred`.

**Comparison tolerance.** A distance (`clearance`, `physical_clearance`, `hole_clearance`, `hole_to_hole`,
`edge_clearance`, `silk_to_pad`, `diff_pair_gap`) passes when it is short of its minimum by at most 500 nm, as
KiCad 10 passes it (0.5 um short passes, 0.501 um fails); a size (`track_width`, `via_diameter`, `via_hole`,
`hole_size`, `annular_ring`, `length`) is compared exactly at whole nanometers, as KiCad compares sizes.

Geometric no-go areas are `keepout` records with `tier: "no_go"`; geometric preferences are
keep-outs with `tier: "policy"`. Every keep-out names its layers and what it blocks; an
exporter that cannot express a block type leaves the area out of that target and checks it
after.

## 6. Locks and provenance

- `locked: true` on footprints, tracks, vias, zones, keep-outs, the outline, graphics and text.
- A locked object refuses changes from `agent` and `router` actors (reason `locked`).
  `human`, `host` and `system` actors may change it; the lock stays.
- `lock` is open to every actor. `unlock` by an agent or router is refused with
  `needs-person` in Phase 1 (Phase 2: it becomes a proposal).
- Copper a person adds or edits is locked by default (`track.add`, `via.add`, `track.move`,
  `via.move` from a `human` actor set `locked: true` unless the input says `locked: false`).
- `provenance = { by, tool?, actor?, run?, edited? }`. `by` is how the object was made:
  `generated` (a generator such as tscircuit), `imported`, `routed` (a router; `tool` names it
  with version, `run` the job), `hand` (a person), `agent` (`actor` is `agent:<name>`),
  `system`. `edited` is set to `hand`, `agent` or `routed` when a different kind of actor later
  changes it. Hosts (importers, generators, routers) pass `provenance` explicitly; for other
  actors the engine fills it. No timestamps.

## 7. On-disk format

A board lives in a folder in the project, by default `<module folder>/board/` beside the
module's UHD file. Any folder holding `board.jsonl` is a board folder.

| File | Kinds | Committed |
|---|---|---|
| `board.jsonl` | board, layer, outline, cutout | yes |
| `placement.jsonl` | footprint | yes |
| `copper.jsonl` | track, via | yes |
| `zones.jsonl` | zone, keepout | yes |
| `graphics.jsonl` | graphic, text | yes |
| `rules.jsonl` | netclass, rule | yes |
| `netlist.jsonl` | net (input; only for boards without UHD) | yes when present |

Each file:

- line 1 is a header, itself canonical: `{"file":"copper","schema":"protoboard.board/v1","units":{"angle":"mdeg","length":"nm"}}`
  (`netlist.jsonl` adds `source`; its lines are `{"kind":"net","id":"net:<name>","name","class"?,"pins"}`, pins sorted);
- then one record per line, sorted by `id` (code-unit order);
- each line is canonical JSON: `kind` first, `id` second, then the remaining keys in
  code-unit order, recursively for nested objects; arrays keep their order; no spaces;
- a line that is unsorted, in the wrong file, or fails its schema is refused on load with the
  file and line number (`BoardFormatError`);
- integers only for lengths and angles; no timestamps, session ids or derived data;
- UTF-8, `\n` line ends, a final newline; a file with no records is still written (header
  only) so the set of files is fixed.

Loading then saving an unchanged board is byte-identical (a test). The loader reads only the files
above; anything else in a board folder (a `.protoboard` folder an older version left there, notes,
exports) is ignored. API: `loadBoardDir(dir)`,
`writeBoardDir(dir, doc, expected?)`, `serializeDocument(doc)`, `parseFile(file, text)`,
`serializeNetlist`, `parseNetlist`, `writeNetlist`, `filesHash(texts)`. Local, ignored state:

| What | Where |
|---|---|
| journal | `.protoboard/local/board/<board key>/journal.jsonl` |
| owner lock | `.protoboard/local/board/<board key>/owner.lock` |
| service endpoint | `.protoboard/local/board/<board key>/service.json` (`pid`, `port`, `token`, `epoch`) |
| proposals (Phase 2) | `.protoboard/local/board/<board key>/proposals/` |
| derived data | `.protoboard/build/board/<board key>/` |

`<board key>` is the board folder's path relative to the project root with `/` replaced by
`__` (`boardKey`).

**Which root** (`findProjectRoot(dir)`, `src/paths.ts`): the nearest folder at or above the board folder
holding `protoboard.config.ts`; without one (a board outside any project, such as a freshly imported
board), the board folder's **parent**. So the state of a lone board is a sibling `.protoboard` next to
its folder (`<parent>/.protoboard/local/board/<folder name>/`), never inside the board folder. A board
folder with no parent (the top of a drive) is its own root. The service, the transport, the importers'
fill cache and the CLI all use this one rule.

## 8. Operations

### 8.1 Shape

An operation call is flat: `{ "op": "footprint.move", "ids": ["fp:U2"], "dx": 1000000, "dy": 0 }`.
The registry entry:

```ts
interface OperationDef<I> {
  name: string;               // "footprint.move"
  title: string;              // "Move footprints"
  description: string;        // one paragraph, for CLI help and the MCP tool description
  input: z.ZodObject<...>;    // the call without `op`; MCP uses input.shape
  audience: "all" | "system"; // "system": hosts, undo and the engine only; never a CLI or MCP tool
  phase: 1 | 2;
  example: Record<string, unknown>;   // a valid call on the Airnode C3 fixture
  apply(doc: BoardDocument, input: I, ctx: ApplyContext): ApplyResult;
}
interface ApplyResult { doc: BoardDocument; inverse: OpCall[]; changed: string[]; created?: Record<string, string> }
```

`apply` is pure: it never mutates `doc`, reads no clock and no randomness (ids come from
`ctx.issueId(kind)`). `inverse` restores the exact prior records (`record.put` and
`record.remove`), so applying an operation then its inverse returns a document equal to the
original, record for record (a property test). `listOperations()` returns the registry;
`getOperation(name)` one entry.

### 8.2 The operation set

Phase 1 (implemented). `track.add`, `via.add`, `zone.add` and `keepout.add` also take `id` from
host actors only (importers); anyone else passes a `handle`.


| Name | Input | Effect |
|---|---|---|
| `footprint.move` | `ids`, `dx`, `dy`, `tracks?: "stay"` | translate. `tracks: "attached"` is Phase 2 and will become the default then; pass `tracks` explicitly |
| `footprint.place` | `id`, `x?`, `y?`, `rotation?`, `side?` | absolute placement (rotation normalized; `side` here does not mirror) |
| `footprint.rotate` | `ids`, `angle`, `about?: "each" \| "center" \| {x, y}` | rotate each about its origin (default), about the group's box center, or about a point |
| `footprint.flip` | `ids`, `about?: "each" \| "center"` | toggle side (section 2) |
| `track.add` | `segments: [{ handle?, net?, layer, width, start, end, sweep?, locked? }]` | add segments or arcs |
| `track.move` | `ids`, `dx`, `dy` | translate segments rigidly (Phase 2 adds `follow` for connected copper) |
| `track.delete` | `ids` | remove |
| `via.add` | `vias: [{ handle?, net?, x, y, outer_diameter, hole_diameter, from_layer?, to_layer?, tented?, locked? }]` | add (default through) |
| `via.move` | `ids`, `dx`, `dy` | translate |
| `via.delete` | `ids` | remove |
| `net.set` | `ids` (tracks, vias, zones), `net` (or `null` to clear) | reassign; agents get `needs-person` |
| `zone.add` | `zone` (fields of 4.1 without `kind`, `id`, `provenance`), `handle?` | add a zone |
| `zone.edit` | `id`, `patch` (zone fields), `unset?` (optional fields to remove) | edit; fill goes stale |
| `zone.delete` | `ids` | remove |
| `keepout.add`, `keepout.edit`, `keepout.delete` | as zone | |
| `outline.set` | `outline`, `source?`, `detach?` | replace the board outline |
| `lock`, `unlock` | `ids` | set or clear `locked` |
| `rule.set` | `rule` (fields of 4.1, `id` required, `provenance` optional) | create or replace |
| `rule.delete` | `ids` | remove |
| `netclass.set`, `netclass.delete` | as rule | |
| `record.put` | `records` | system: write whole records (importers, undo, recovery) |
| `record.remove` | `ids` | system: remove records (importers, undo) |

Phase 2 (registered now; inputs, effects, proposals, the drag hold and live checks are in `phase2-editing.md`,
and `PLANNED_OPERATIONS` is empty):
`footprint.move` with `tracks: "attached"` (default), `track.drag` (segment or via with
connected copper following), `track.route` (commit of an interactive route: a chain of segments
and vias in one op), `track.set_width`, `copper.rip` (`nets` or `region`, unlocked only),
`text.add`, `text.edit`, `text.delete`, `graphic.add`, `graphic.edit`, `graphic.delete`,
`outline.import_dxf`, `footprint.add`, `footprint.remove`, `netlist.sync` (system: apply a new
netlist, map renamed nets by pin membership).

## 9. Transactions, versions, undo, leases

### 9.1 Transaction

```ts
interface Transaction {
  batchId: string;            // 1 to 200 of [A-Za-z0-9_.:-]; a resent id returns the first reply with duplicate: true
  label: string;              // 3 to 8 words: what it does
  ops: OpCall[];              // 1 to 200
  changeSet?: { id: string; title?: string };  // groups transactions for review and revert
  expectEpoch?: string;
  expectSeq?: number;         // the writer read the whole document at this seq
  expectVersions?: Record<string, number>;     // per object id; 0 means "must not exist"
  expectRegion?: { box: Box; layers?: string[]; seq: number };  // spatial read set
  leaseToken?: number;
  dryRun?: boolean;           // validate everything, commit nothing: status "valid"
  provenance?: Provenance;    // hosts, routers, system only: provenance for what it creates
}
interface Actor { kind: "human" | "agent" | "router" | "host" | "system"; id: string; name?: string }
```

All operations in a transaction apply or none do. One transaction is one journal entry and one
undo step. A person's gesture (press to release) is one transaction.

### 9.2 Order of checks and the reply

1. envelope (batch id, label, op count), then a duplicate batch id returns its first reply;
2. `expectEpoch`, `expectSeq`, `expectVersions`, `expectRegion` (refused if any object whose
   box, before or after its change, meets the box on those layers changed after `seq`);
3. each op: known name, audience, input schema, then apply (an error names the op `index`);
4. record schema and references (layers exist, nets exist when a netlist is loaded);
5. locks (section 6) and net changes by agents;
6. leases: another actor's lease covering a changed object refuses; a stale or missing own
   token refuses; a person's change revokes agent and router leases it lands in.

```ts
type Reply =
  | { status: "applied" | "valid"; batchId; epoch; seq; changed: string[]; created: Record<string, string>;
      removed: string[]; versions: Record<string, number>; duplicate?: true }
  | { status: "refused"; batchId; epoch; seq; reason: RefusalReason; message: string;
      missed?: MissedEntry[]; conflicts?: Conflict[]; lease?: Lease; ids?: string[] }
  | { status: "invalid"; batchId; epoch; seq; error: string; index?: number; issues?: unknown };
type RefusalReason = "stale-epoch" | "stale-seq" | "stale-versions" | "stale-region" | "leased"
  | "lease-revoked" | "locked" | "needs-person" | "stale-undo" | "nothing-to-undo" | "nothing-to-redo";
```

Refusal messages are built from owner facts only (ids, seqs, actor ids); text an agent wrote
(labels, lease purposes) travels as data, never inside a message another agent reads.

### 9.3 Versions

`seq` is the document version: 0 at open, plus one per committed transaction. Every object has
a version: 1 for each object present at open, plus one each time it changes; a removed object
keeps its last version plus one. `epoch` names the service session; seq and versions restart
when it changes, and a client seeing a new epoch re-reads.

### 9.4 Undo and redo, per actor

`undo(actor)` applies the inverse of the actor's own last transaction that is not yet undone,
as a new entry (`undoOf`). It is refused with `stale-undo` and the conflicts when any object it
changed is no longer as it left it (compared by content, so an actor's own chain of undos and
redos never blocks itself). `redo(actor)` re-applies the actor's last undone transaction
while nothing it touched changed since the undo and the actor has not committed anything
newer. Undo and redo pass the same lock and lease checks as any write. A person's Ctrl+Z never
undoes an agent's work, and an agent's undo never removes the person's later edit.
`revertChangeSet(actor, id)` undoes a whole change set, newest first, all or nothing; it is
refused when an object of the set was last changed by a transaction outside the set.

### 9.5 Leases

Ported from the 3D viewer's lease table. `claim(actor, { roots?, nets?, region?, purpose,
ttlMs? })`: `roots` are UHD instance path subtrees (they cover footprints by `path`, or by
`ref` when there is no path), `nets` cover copper and zones of those nets, `region` covers
objects whose boxes meet `{ box, layers? }`. TTL 120 s by default, 1 s to 10 min, renewed by
each write that quotes the token. Only agents, routers and hosts take leases. The fencing
token rises on every grant and every revocation. A person's edit inside a lease revokes it;
`takeOver(human)` revokes all. Up to 64 live leases.

## 10. The board service

```ts
const svc = openBoardService({
  dir?,                    // board folder
  document?,               // or an in-memory board (no folder: save is refused)
  projectRoot?,            // default: nearest folder at or above dir with protoboard.config.ts, else dir's parent (section 7)
  netlist?: Netlist,       // else netlist.jsonl in dir, else none
  journal?: boolean,       // default true
  ownerLock?: boolean,     // default true: refuses to open a board another live process owns
  now?: () => number, epoch?: string,
});
svc.epoch; svc.seq;
svc.snapshot(): BoardSnapshot;     // { epoch, seq, doc, version(id), query } (immutable)
svc.query: BoardQuery;             // region(box, {layers, kinds}), at(point, {tolerance, layers}), net(name), byId(id)
svc.apply(tx, actor): Reply;
svc.undo(actor, meta?): Reply;  svc.redo(actor, meta?): Reply;
svc.revertChangeSet(actor, id, meta?): Reply;
svc.claim(actor, claim): ClaimReply;  svc.release(actor, leaseId?): EndedLease[];
svc.takeOver(by?): EndedLease[];
svc.presence(): Presence;          // leases and recent agent intents
svc.log(since?): LogEntry[];       // in-memory, last 1000 entries
svc.subscribe(listener): () => void;
svc.save(): SaveResult;            // writes changed files; refuses files changed on disk by someone else
svc.checkpoint(label): CheckpointResult;  // saves, then returns a commit message built from change sets
svc.recoverable(): number;         // journal entries of an earlier session not in the files
svc.recover(): { replayed, seq }; // replays them (opt-in; the host decides)
svc.close({ save? });              // saves unless save: false; releases the owner lock
```

Events: `{ type: "commit", epoch, seq, entry: { seq, actor, label, batchId, changeSet? },
changed, created, removed }`, `{ type: "presence", presence }`, `{ type: "saved", files }`,
`{ type: "external-change", files }`. A renderer holds the last snapshot and applies events;
`snapshot()` is cheap (structural sharing).

**One owner, many clients.** The process that opens a board takes the owner lock (exclusive
create, pid inside, taken over when the pid is gone). A second process does not open the board
as owner; it connects as a client. Phase 1 wire protocol (built by the CLI track): `protoboard
board serve <dir>` opens the service and listens on `127.0.0.1` on a free port, writing
`service.json`. Clients send JSON-RPC 2.0 over WebSocket with the token from `service.json`.
Methods mirror the API one to one: `board.snapshot`, `board.query`, `board.apply`, `board.undo`,
`board.redo`, `board.revertChangeSet`, `board.claim`, `board.release`, `board.takeOver`,
`board.presence`, `board.save`, `board.checkpoint`, `board.operations` (the registry metadata
with JSON schemas). Server notifications: `board.event` with the event above. The editor tab
connects through the dev server's proxy; CLI commands (`protoboard board apply <ops.json>`,
`board query`, `board inspect`) use a running service if `service.json` names a live one, else
open the board themselves for the one call. MCP tools run the CLI as today.

**Entry points.** The package index is safe to load anywhere. The transport lives in a
Node-only entry: `serveBoard` and `connectBoard` come from `@protoboardai/board/node`.
Browser code imports types and pure helpers from `@protoboardai/board/browser`.

**Saving.** Never automatic per transaction. The service saves on `save()`, on
`checkpoint()`, on close, and (host's choice) on idle 2 s after the last transaction. Each file
is written only when its content changed, through a temporary file and a rename, and only if
the file on disk still has the hash the service last read or wrote; otherwise that file is
refused and an `external-change` event names it (Phase 2: reload it as a system transaction).

**Journal.** `journal.jsonl`, one JSON object per line: `{"t":"open", epoch, files}`,
`{"t":"entry", epoch, seq, time, actor, batchId, label, changeSet?, ops, inverse, forward,
changed, created, removed, undoOf?, redoOf?}` (`ops` as applied with handles resolved;
`forward` and `inverse` are record-level, so replay is exact), `{"t":"saved", epoch, seq, files}`,
`{"t":"checkpoint", epoch, seq, label, files}`. `files` is the SHA-256 over the board files.
Appended on every commit. Over 4 MiB it is compacted to the lines from the last `open`, `saved` or `checkpoint` marker.
`recover()` replays the entries of the latest epoch whose `open` or `saved` hash equals the files
now on disk, after that marker.

**Checkpoints are Git commits made by the caller.** The service prepares the message (change
set titles, actors, seq range, counts) and never runs Git.

## 11. Extension points

```ts
interface Importer {
  id: string; title: string;
  accepts(source: ImportSource): boolean;               // { path?, bytes?, text?, kind? }
  import(source: ImportSource, ctx: ImportContext): Promise<ImportResult>;
}
interface ImportResult {
  document?: BoardDocument;         // a whole board (new board), or
  ops?: OpCall[];                   // operations applied as host actor `import:<id>`
  netlist?: Netlist;
  report: { level: "dropped" | "approximated" | "info"; message: string; source?: string; ids?: string[] }[];
}

interface Check {
  id: string; title: string;
  run(snapshot: BoardSnapshot, ctx: CheckContext): Finding[];
}
interface Finding {
  id: string;                        // stable: findingId(check, rule, objects, location) = f:<check>:<12 hex>
  check: string;                     // the check id
  rule?: string;                     // the rule id applied, when one was
  tier?: "floor" | "target" | "policy" | "no_go";
  severity: "error" | "warning" | "info";
  objects: string[];                 // object or pad ids, sorted
  location: { x: number; y: number; layer?: string };
  box?: Box;
  measured?: number; required?: number;   // nm
  message: string;                   // plain, from facts; no agent-written text
}

interface Renderer {               // and the agent scene exporter; never writes
  render(snapshot: BoardSnapshot): void;
  update?(event: Extract<BoardEvent, { type: "commit" }>, snapshot: BoardSnapshot): void;
}
```

**Importer registry.** `@protoboardai/board-import` exports `availableImporters(): Promise<Importer[]>`:
its own importers (`kicad`, `circuit-json`) then those of installed optional importer packages
(`easyeda-pro` from `@protoboardai/board-import-easyeda`), one per id; a host loads that one package and
picks the first importer whose `accepts` says yes. Importers of whole boards also return the derived zone
fill (`fill`, section 4.3); a host that saves the board writes it with `writeZoneFill`.

Helpers: `runChecks(snapshot, checks, ctx?)` validates each finding against `FindingSchema`, drops
duplicates by id and sorts by severity, then id. `findingId(...)` hashes the check, rule, sorted
objects and the location rounded to 1 µm. `importResultToTransaction(importerId, result, label?)`
builds the host transaction for `ops` (batch id from the content, provenance `imported`).
`boundsOf(record)` and `layersOf(doc, record)` give every record's box and layers;
`padsOf(footprint, copperLayers?)` gives world pads (id, center, rotation, layers, box; an SMD pad's one
layer is `padWorldSide(fp, pad)`, so read pad sides from it, not from `pad.layer`);
`padFrameSide(pad)` and `padWorldSide(fp, pad)` give an SMD pad's side in the frame and on the board;
`footprintToWorld(fp, point)` is the section 2 transform. The fixture is
`airnodeC3()` and `AIRNODE_C3_NETLIST` from `@protoboardai/board/fixtures/airnode-c3`, with its
files in `packages/board/test/fixtures/airnode-c3/`.

## 12. Implemented now, specified only

Implemented in Phase 1: everything in sections 2 to 9 (all 26 operations of the Phase 1 table),
the service API in section 10 except the wire transport, the owner lock, the journal with recovery, save with external-change
refusal, the query index, the finding and importer helpers, the shared zone fill type with its cache
(section 4.3), and the Airnode C3 fixture.
Specified only: the wire transport and `service.json` (CLI track), proposal mode and the ghost
overlay, drag hold (`busy` while a person drags), the Phase 2 operations, `netlist.sync`, computing
derived data (a fill engine, ratsnest, connectivity), and reload on external change.
