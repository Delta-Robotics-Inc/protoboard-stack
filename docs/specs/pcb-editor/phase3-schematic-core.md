# PCB editor, Phase 3: the schematic core (contract)

Status: **stable for Phase 3 builders** (2026-11-09; the schematic screen builds against it). Package: `@protoboardai/schematic` in `packages/schematic/`. This document
is the interface the schematic screen, the CLI and MCP bindings and the agent tools build against. If the
code and this document disagree, the code's exported types win and this document is fixed.

The schematic core mirrors the board core ([phase1-board-core.md](phase1-board-core.md)): an immutable
document, a typed operation registry whose operations return their inverse, transactions with versions and
per-actor undo, deterministic files with one record per line, and a headless service. It reuses the board
package's generic pieces (canonical JSON, hashes, deterministic keys, the actor and call types, the finding
id) instead of copying them; section 14 lists the small additions the board package could export so the
transaction engine itself can be shared.

## 1. What the core is

- The schematic is **the system diagram zoomed in**: system, then board blocks, then pins and nets. At the
  pin level each UHD sub-module of a board is a **card** on a shared grid. A card grows to fit its circuit;
  a large part (an MCU module) makes its card wide and tall.
- **Connectivity comes from UHD, never from the schematic.** The circuit (parts, pins, nets, pin facts) is an
  input derived from the project's UHD board module on every load (`circuitFromUhd`, section 3). The
  schematic stores **presentation only**: where symbols, wires, labels, power symbols and cards are, and how
  they look. A wire names the UHD net it draws; it never makes or breaks a connection. Net changes are edits
  of the UHD source and always wait for a person.
- **Inside a card, wires; across cards, labels; ground and supply rails are symbols.** This is a computable
  rule (readability rule C08 and C09), enforced by the layout and measured by the score.
- **Layout is automatic** by an algorithm with rules and forces (section 7). Hand-placed items are pinned
  and stay put; an agent cleans up afterward with typed operations and proposals (section 8).
- A **flat export** writes ordinary multi-sheet schematics other tools import (section 12).
- No browser code. The package runs in Node; the screen reaches it through the service.

| Path | Contents |
|---|---|
| `src/units.ts` | the grid unit, `gu`, `guToMm`, `mmToGu` |
| `src/circuit.ts` | the circuit input: parts, pins, pin facts, nets, groups; validation and hash |
| `src/uhd.ts` | `circuitFromUhd(board, lookup)`: the circuit from a UHD board module (entry `@protoboardai/schematic/uhd`) |
| `src/schema.ts` | record kinds, zod schemas, ids, files |
| `src/document.ts` | the immutable schematic document and its derived indexes |
| `src/symbols.ts` | symbol resolution, pin binding, placement transforms |
| `src/geometry.ts` | world geometry of every record, boxes, the drawn netlist |
| `src/ops/` | the registry and every operation |
| `src/engine.ts` | transactions, versions, per-actor undo and redo |
| `src/format.ts` | load and save of the on-disk files |
| `src/service.ts` | the schematic service |
| `src/layout/` | the layout pipeline (classify, cards, patterns, settle, connect, route) |
| `src/score.ts` | the readability score and its numbered defects |
| `src/checks.ts` | the electrical checks (unconnected pins, single-pin nets, conflicting outputs, voltage) |
| `src/scene.ts` | the agent scene description |
| `src/render/` | the pure SVG renderer, dark and paper themes, PNG |
| `src/export/` | the flat KiCad export and the KiCad netlist reader |
| `src/fixtures/airnode-c3.ts` | the synthetic Airnode C3 circuit as UHD modules, and its 5 V fault variant |
| `src/fixtures/synthetic.ts` | synthetic circuits for the patterns: a 16-channel LED driver, an 8-LED addressable chain, a 48-pin microcontroller, a board of fifteen cards, and a 158-part board for the time budget |

## 2. Units, grid and coordinates

- **One grid unit (gu) is the symbol lattice unit**: 2.54 mm on paper, 5 frame pixels in a symbol file
  (`packages/symbols/STYLE.md`), 16 screen pixels at zoom 1. `GU_MM = 2.54`.
- **Every stored coordinate is an integer number of grid units**: symbol origins, wire vertices, label and
  power symbol anchors, card and frame boxes. Integers make saves byte-stable and keep every pin on the grid
  (rule C25 holds by construction). Derived geometry (body boxes, text boxes) may be fractional.
- **+X right, +Y down**, origin at the sheet's top-left: the convention of every schematic tool and of the
  symbol files. (The board document is +Y up; nothing is shared between the two frames.)
- **Rotation** is `0 | 90 | 180 | 270`, counterclockwise as seen on the sheet. **Mirror** flips the symbol
  left to right in its own frame, before rotation. A symbol's lattice point `p = [u, v]` lands at
  `(x, y) + R(rotation) * M(mirror) * p` with `M = (u, v) -> (-u, v)` when mirrored and
  `R(90) = (u, v) -> (v, -u)` (a pin that points right then points up).
- Pin anchors of every placed symbol are integer points, because pins sit on the lattice.

## 3. The circuit input (from UHD)

```ts
interface SchematicCircuit {
  schema: "protoboard.schematic-circuit/v1";
  board: string;                 // UHD module id of the board
  parts: CircuitPart[];
  nets: CircuitNet[];
  groups: { path: string; name: string; module: string; parent?: string }[];   // UHD sub-modules
  edge?: { id: string; net?: string; pins: string[] }[];                       // board exports
}
interface CircuitPart {
  path: string;                  // UHD instance path below the board: "power/ldo"
  group: string;                 // the sub-module path it sits in ("" at the board's root)
  part: string;                  // UHD module definition id
  name: string;
  class: PartClass;              // resistor | capacitor | inductor | ferrite_bead | led | diode | switch
                                 //   | connector | crystal | transistor | regulator | mcu | module | ic
  value?: string;                // formatted with its unit: "10 kΩ", "1 µF"
  mpn?: string;
  ref?: string;                  // a designator the board already uses (cross-probe), else assigned
  categories?: string[];         // UHD taxonomy paths
  unconnected?: Record<string, string>;   // pin id -> why it is left open on purpose (UHD `unconnected`)
  pins: CircuitPin[];
}
interface CircuitPin {
  id: string;                    // UHD leaf interface id: "pin_23"
  number: string;                // package designator: "23", "A4", "EP"
  name: string;                  // datasheet name: "IO9"
  type: "power_in" | "power_out" | "ground" | "io" | "input" | "output" | "analog_in" | "analog_out" | "passive" | "nc";
  voltage?: { min?: number; max?: number; nominal?: number };   // volts, the pin's `voltage` parameter
  functions?: string;            // the pin_functions text, cited in UHD
  capabilities?: string[];
}
interface CircuitNet {
  name: string;                  // the conductor's name (its shallowest UHD net)
  kind: "ground" | "power" | "signal";
  voltage?: { min?: number; max?: number; nominal?: number };   // the Net's design voltage
  pins: string[];                // "<part path>:<pin id>", sorted
}
```

- `circuitFromUhd(board, lookup, { refs? })` (entry `@protoboardai/schematic/uhd`) reads the board through
  the stack's `boardNetlist` (`@protoboardai/core`), the same flattening every circuit provider uses, then
  reads each pin's facts from its UHD leaf interface: type from the pin's protocols (power roles, digital
  and analog roles, passive terminal, no-connect), `voltage` from the interface's `voltage` parameter
  (value, range), `functions` from its `pin_functions` trait, `capabilities` as stated. The part class
  comes from the passive trait, the taxonomy categories and the pin names (section 6.1).
- The circuit is **never stored**. A schematic folder records the hash of the circuit it was laid out
  against (`schematic.source.hash`); a different hash on load marks the layout stale (parts added or
  removed get placed by the next `layout.run`; records of parts that left the circuit are reported and
  dropped by it).
- **Ids** in the schematic are keyed by UHD instance path and pin: a part is `<path>`, a pin is
  `<path>:<pin id>` (`mcu/module:pin_13`), a net is its name.

## 4. The schematic document

```ts
interface SchematicDocument {
  readonly records: ReadonlyMap<string, SchematicRecord>;   // every stored record by id
  readonly circuit: SchematicCircuit;                        // the input, frozen
  readonly parts: ReadonlyMap<string, CircuitPart>;          // derived: path -> part
  readonly pinNets: ReadonlyMap<string, string>;             // derived: pin key -> net name
  readonly nets: ReadonlyMap<string, CircuitNet>;            // derived: name -> net
}
```

Every record has `kind` and `id`; optional fields are omitted, never `null`. Records are frozen; a change
makes a new document that shares the unchanged ones. Common optional fields: `pinned?: true` (hand placed;
the layout never moves it) and `provenance = { by, tool?, actor?, edited? }` with `by` one of `layout`
(the automatic layout), `hand` (a person), `agent` (`actor` is `agent:<name>`), `imported`, `system`.

### 4.1 Record kinds

| Kind | Id | Fields |
|---|---|---|
| schematic | `schematic` | `name`, `source: { board, hash }`, `title_block?: { title?, rev?, date?, company?, comment? }`, `settings: { bend_limit, gutter, rails? }` |
| card | `card:<key>` | `group` (UHD sub-module path, `""` for the board's root), `title`, `subtitle?`, `x, y, w, h`, `pinned?`, `provenance` |
| symbol | `sym:<part path>` | `part`, `ref`, `card`, `x, y`, `rotation`, `mirror?`, `variant?`, `symbol?`, `hide_unused?`, `fields?: { dx, dy, anchor }`, `pinned?`, `provenance` |
| wire | `wire:<key>` | `net`, `card`, `points: [x, y][]` (2 or more, orthogonal, no zero-length segment), `pinned?`, `provenance` |
| label | `lbl:<key>` | `net`, `card`, `x, y`, `side: left \| right \| up \| down`, `scope: local \| port`, `pinned?`, `provenance` |
| power | `pwr:<key>` | `net`, `card`, `x, y`, `dir: up \| down`, `style: rail \| ground`, `pinned?`, `provenance` |
| noconnect | `nc:<pin key>` | `pin`, `provenance` |
| text | `txt:<key>` | `card?`, `x, y`, `text`, `role: note \| heading`, `pinned?`, `provenance` |
| frame | `frm:<key>` | `x, y, w, h`, `title?`, `provenance` |
| proposal | `prop:<key>` | `title`, `ops: OpCall[]`, `rule?`, `defects?: string[]`, `score?: { before, after }`, `provenance` |

- **schematic**: `settings.bend_limit` (default 4) is the most bends a wire may take inside a card before
  the layout labels the net instead; `settings.gutter` (default 4 gu) is the space between cards;
  `settings.rails` lists the nets drawn as power symbols (default: every `ground` and `power` net).
- **card** (a group mapped to a UHD sub-module): the box is in sheet units and holds its members, their
  fields, wires, labels and power symbols, a two-unit title band and a one-unit margin. Members are the
  symbols whose `card` names it. A card's `group` is where its parts sit in UHD; a symbol regrouped into
  another card (section 8, `card.regroup`) keeps a presentation override and is reported (rule C20 note)
  until the UHD source moves the part.
- **symbol** (a symbol instance): `x, y` is where the symbol's lattice point `[0, 0]` lands (section 2).
  `symbol` overrides the resolved symbol (`pack:<id>` or a code-built family: `box`, `mcu`, `module`,
  `regulator`, `connector`); `variant` picks a variant of a pack symbol (`iec`). `ref` is the reference
  designator, assigned once and kept (section 6.3). `hide_unused` folds pins on no net into a note inside
  the body (large modules). `fields` places a box symbol's reference (the value is the line below) at an offset
  from the symbol origin; the layout picks the first spot clear of stubs and parts. Two-terminal parts derive
  their fields: above and below when horizontal, to the right when vertical. The layout sets `hide_unused` on every
  generated symbol (not a pack symbol) that has pins on no net which UHD does not mark as left open.
- **wire**: an orthogonal polyline. Junctions are derived, never stored: a dot sits wherever a wire end or
  vertex lies on another wire of the same net, or three or more wire ends of one net meet.
- **Shown names.** A label or power symbol draws its net's *shown name* (`netLabel(doc, net)`): the name without a
  trailing note in brackets and without the sub-module path in front (`power/VBAT_SW` shows `VBAT_SW`, `2V8 (camera
  AVDD)` shows `2V8`) when no other net of the circuit would show the same, else the full name. Records, the drawn
  netlist and the export keep the full name; only the drawn text (and so its box) is shorter.
- **label**: `scope: port` joins the net across cards (a sheet port); `local` names a net inside one card
  (the layout's fallback when a wire would exceed the bend limit). `side` is the direction the text runs
  from the anchor, which sits on a pin or a wire end.
- **power**: a ground or supply symbol on a pin or wire end. `dir` is where it points: ground down,
  positive supplies up (rule C10).
- **noconnect**: an X on a pin left open on purpose. The layout places one on every pin whose UHD type is
  `nc` or that the UHD child lists in `unconnected`; anything else left open is a check finding.
- **proposal**: an agent's cleanup batch waiting for Accept (section 8.3). Proposals are local state:
  saved under `.protoboard/local/schematic/<key>/proposals.jsonl`, never committed.

### 4.2 Drawn connectivity

`drawnNetlist(doc)` computes connectivity from geometry alone: wire segments join where an end or vertex
lies on another segment; a pin anchor joins any wire through it; labels and power symbols join every item of
the same name. Its partition of pins must equal the UHD nets (gate C01). A wire whose geometry touches pins of
another net is an accidental merge (gate C06). This is how the schematic proves it draws UHD exactly.

## 5. On-disk format

A schematic lives in `<module folder>/schematic/`, beside the module's UHD file and its `board/` folder.

| File | Kinds |
|---|---|
| `schematic.jsonl` | schematic, card, frame, text |
| `symbols.jsonl` | symbol, noconnect |
| `wires.jsonl` | wire, label, power |

Each file follows the board core's rules exactly: a canonical header line
`{"file":"wires","schema":"protoboard.schematic/v1","units":{"length":"gu","gu_mm":2.54}}`, then one record per
line sorted by id (code-unit order), each line canonical JSON (`kind`, `id`, then keys sorted), integers
only, no timestamps, UTF-8, `\n`, a final newline, a file with no records still written. A line that is
unsorted, in the wrong file or fails its schema is refused on load with file and line
(`SchematicFormatError`). Load then save of an unchanged schematic is byte-identical (a test).

**Why not `display.json`.** The system diagram keeps its card positions in `.protoboard/display.json`, one
JSON object the viewer rewrites whole. A pin-level schematic holds hundreds of records edited by a person and
an agent at once; one record per line diffs and merges in Git, matches the board core, and lets the service
own and journal the folder like a board. The diagram's levels above the pin level keep using
`display.json`; the pin level reads the schematic folder. Zoom continuity is a view concern: the board-blocks
level draws the same card boxes.

Local state mirrors the board core: `.protoboard/local/schematic/<key>/` (journal, owner lock, service
endpoint, proposals) and `.protoboard/build/schematic/<key>/` (renders, scene, exports), `<key>` being the
schematic folder's path relative to the project root with `/` replaced by `__`.

## 6. Symbols

### 6.1 Part classes

`classOf(part)` decides the class, first rule that applies: the UHD passive trait (`resistor`, `capacitor`,
`inductor`, `ferrite_bead`); the taxonomy categories and names (`led`, `diode`, `switch`, `crystal`,
`transistor`, `connector`, `regulator` from `power.regulator`, `mcu` from `microcontroller.*`, `module` for a
bought module with more than 24 pins); else `ic`.

### 6.2 Resolution and binding

`resolveSymbol(part, { variant?, symbol? })` returns the symbol definition (`protoboard.symbol/v0`), the
form (frame, pins, body) and a **binding** from each part pin to a symbol pin:

1. **Pack symbol by class and variant**: resistor `resistor` (`iec` variant drawn on screen, the US zigzag
   in print), capacitor `capacitor`, inductor `inductor`, ferrite bead `ferrite-bead`, LED `led`, diode
   `diode`, switch `pushbutton`, crystal `crystal`. Binding: part pin to symbol pin by name or alias
   (`A`, `anode`), then by number; when the part has more pins than the symbol, pins of one name are one
   symbol pin listing their pads (a four-pad tact switch is two pins); otherwise distinct names in
   designator order. A pack symbol is used only when every part pin binds.
2. **Else the code-built box from pin data** (`packages/symbols/src/generate`): `regulator` for regulators,
   `mcu` for microcontrollers and modules (pins grouped by bank and function), `icBox` otherwise (supply
   inputs on top, ground at the bottom, inputs left, outputs right, groups together). Same-name supply and
   ground pins merge into one symbol pin listing every pad.
3. With `hide_unused`, pins on no net and not marked (not of type `nc`, not in UHD `unconnected`) are left out of the
   generated box and counted in a note inside the body (`29 unused`). The electrical checks still report them.
4. Connector contacts that read alike once the note in brackets is dropped (USB-C's `D+ (DP1, A6)` and
   `D+ (DP2, B6)`) are one symbol pin listing both pads.

### 6.3 Reference designators

A symbol's `ref` is set when the layout first places it and never changes after: the circuit's `ref` (the
board already uses it), else the instance id when it reads as a designator of the class's prefix, else the
prefix (`R C L FB D SW J Y Q U`) and the lowest free number in instance-path order. Designators are unique
over the schematic.

## 7. The layout pipeline

`layoutSchematic(doc, { scope?: "all" | string[] /* card ids */, mode?: "fresh" | "tidy", sheet?: "keep" | "repack" })`
returns `{ puts, removes, fallbacks, patterns }`: the records to write, the nets labeled because their wire failed,
and the patterns recognized per card (`chain:<n>`, `array:<n>`, `crystal`, `bank:top:<rails>`,
`bank:bottom:<rails>`). It is pure and deterministic (same circuit, same records, same pins in: same bytes out).
Pinned items never move; with a card scope, only those cards are laid out again and the rest is untouched
(their records and boxes stay). **A sheet laid out before keeps its cards where they are** (`sheet: "keep"`, the
default): a card keeps its box, grown to its new size; a card that now overlaps one placed before it moves down
just clear of it; new cards go below the sheet; so a small change never reshuffles the sheet, and a changed part
re-lays out only its own card's drawing (every other card's records come out byte-identical). `sheet: "repack"`
places every card anew. `layout.run` (section 8) is the operation that applies it.

| Stage | Input | Output |
|---|---|---|
| 1 classify | circuit, settings | net classes (`ground`, `rail`, `bus`, `signal`; local to one card or crossing), part roles (`anchor`: a part with more than one symbol pin that is not a two-terminal part; satellites `decoupling`, `pull_up`, `pull_down`, `series`, `power_series` (in line between two supply rails: a fuse, a ferrite, a reverse-polarity diode), `rail_shunt`, `probe` (a one-pin part: a test point)) with the pin each serves. Decoupling capacitors are shared out over the supply pins of their rail in their card in natural order of reference (sixteen LEDs and sixteen capacitors: each LED its own); a part with several supply pins on the rail takes that many shares. A signal satellite serves the pin of the anchor the layout reaches first (most pins, then path) |
| 2 group | circuit groups, existing cards | one card per first-level UHD sub-module; **a first-level sub-module of more than 20 parts with nested sub-modules splits into one card per nested sub-module** (its own parts keep the first-level card); nested sub-modules below that fold into theirs; the board's root parts get one card per anchor with its satellites (decided from the circuit alone, so a part's home card never depends on where it is drawn); regrouped symbols stay in their card |
| 3 clusters | each card's anchors | each anchor (most pins first) with what hangs on its pins is laid out on its own, in its own frame. Every side pin with something to hang is a **lane** along its lead. Shunts (decoupling, pull-ups, pull-downs, an LED, a button or a capacitor to a rail, a TVS from a rail to ground, a probe) stand on or hang from the lane with the rail pin toward the rail; series parts sit in line and the lane continues past them (an LED with its resistor; an RC filter); a **power path** continues in line through a fuse, ferrite or diode to the next rail, naming the rail it leaves before the series part and the rail it reaches at its end. On one side each shunt gets its own column (pitch 5); a shunt whose body would stand over a neighbor lane's row goes to a bank above (or below) the neighbors with a drop wire; labels-only lanes keep their label on the pin; power symbols on stubs go out until clear of their neighbors' labels. A satellite belongs to the first lane that reaches it. **Supply rows**: supply pins on top of a part (and ground pins at its bottom), when more than one or with capacitors, rise (drop) straight to one rail row per rail, stacked away from the body with the narrowest row nearest, each row's power symbol at its outer end; the row's capacitors hang from it in a bank, the first right of the last top pin and the second left of the first (both within reach of the pins), the rest further right, every row's bank in the same columns. **Crystal**: a crystal between two pins of one part on one side lies across below them, out from the part, the lower pin's net to its near end and the upper pin's to its far end (so the two wires never cross), each load capacitor beside its end hanging to ground. A port with no anchor pin in the card starts its own cluster from its label |
| 4 patterns and packing | the clusters | clusters with one anchor definition linked output to input (pin types, else names such as `DOUT`/`DIN`, `Q7S`/`SER`) form a **chain**, drawn in chain order in rows of equal whole-unit pitch, every member the same way round (the head and tail may carry extra parts). Clusters drawn exactly alike (same anchor definition, same members at the same offsets and rotations) that are not a chain form a **repeated-channel array**, drawn in rows of equal pitch in natural order of reference. The column count makes the block about twice as wide as tall, at most 8 per row, with few empty cells. Blocks and single clusters are packed in columns in signal-flow order (connectors first among equals, then the longest path from the cluster that drives each net), the column height chosen for an aspect near 1.4, with a 4-unit gap for the wires between them. With pinned content in the card, the main anchor is built where it was (the card's origin) and the rest packs beside the fixed content |
| 5 settle | parts no pattern placed, pinned items | a constrained force pass: strong springs for pin-to-pin signal nets, weak springs for shared rails, repulsion between all boxes, rail pins pulled toward their rail side, fixed iterations, then snap to the grid and resolve overlaps by the nearest free spot (pinned items are fixed obstacles) |
| 6 connect | nets per card | per net and card: a rail becomes power symbols (one per wired cluster: a decoupling capacitor shares its pin's symbol); a net whose pins in the card are two or more becomes wire; a net crossing cards gets one port label per card: when several clusters each labeled it, every pin of it in the card is wired and one label stays (at a lane's end, else on a short stub from the first pin); a net whose wire would exceed `bend_limit` bends becomes local labels |
| 7 route | card-local geometry | orthogonal wires by A* on a dense grid (step 1, bend 4, crossing 6, along a body 0.4; the heuristic is the distance to the tree's box), avoiding symbol bodies, text and other nets' pins; multi-pin nets grow a tree from the first pin (T junctions). Then a **tidy** pass: a power symbol or label that landed on something moves out along its own direction on a stub of its net to the first spot where it touches nothing and the stub crosses nothing |
| 8 cards | card sizes, cross-card nets | card sizes from content (bounding box, a 3-unit title band, a 2-unit margin). A fresh sheet: signal flow between two cards goes the way most of their output-to-input pin pairs go (else from the card that drives the net); ranks by the longest path; a card that makes a rail and drives no signal takes its supplier's rank, above the cards it feeds. Two packings are tried and the one that reads best kept: columns in rank order at a range of column heights (a column shares its width when that stretches a card by at most a quarter; the last card of a column reaches the tallest column's bottom when within 8 units), and a bottom-left fill in rank order where each card takes the free corner that keeps the sheet compact, right of the cards that feed it, below the cards that power it, and near the cards it shares nets with. "Reads best": area with an aspect penalty around 1.5, waste, the distance between cards weighted by the nets they share (label fan-out), and a heavy penalty per card pair whose signals flow right to left. A sheet laid out before keeps its places (above). Gutters of `settings.gutter` |
| 9 score | the result | the readability score (section 11) |

Determinism: no randomness, no clock; ties broken by id in code-unit order. The layout also fills the title
block's title with the sheet's name when it has none (revision and date are a person's to give). Time: a
158-part synthetic board lays out in about 0.4 s and the largest real board tried (197 parts) in about 1 s
(dense typed-array routing grid, a spatial index for placement, clusters built apart). A run with `mode: "tidy"` keeps
existing symbol positions and redraws the wiring, labels and power symbols. Pinned wires, labels and power
symbols stay, and the layout draws nothing more for their net in that card.

## 8. Operations

### 8.1 Shape

Calls are flat, as in the board core: `{ "op": "item.move", "ids": ["sym:sensor/r_sda"], "dx": 2, "dy": 0 }`.
The registry entry has the board core's shape (`name`, `title`, `description`, `input` zod schema,
`audience`, `phase`, `example` on the Airnode C3 schematic, `apply`). `apply` is pure and returns
`{ doc, inverse, changed, created? }`; the inverse is `record.put` and `record.remove` of the exact prior
records, so applying an operation then its inverse returns an equal document (a property test).

### 8.2 The operation set

| Name | Input | Effect |
|---|---|---|
| `symbol.place` | `id`, `x?`, `y?`, `rotation?`, `mirror?`, `variant?`, `symbol?` | absolute placement and look |
| `symbol.rotate` | `ids`, `angle: 90 \| 180 \| 270` | rotate each about its body center (snapped to the grid) |
| `symbol.mirror` | `ids` | mirror each left to right about its body center |
| `item.move` | `ids` (symbols, labels, power symbols, text, frames, cards), `dx`, `dy`, `pin?` | translate; a card moves with its members and their wires; a person's move pins what it moved unless `pin: false` |
| `wire.add` | `wires: [{ handle?, net, card, points }]` | add wires (the net must exist; orthogonal points) |
| `wire.edit` | `id`, `points` | replace a wire's path |
| `wire.delete` | `ids` | remove wires |
| `wire.to_label` | `ids` | replace wires with a label on each pin they reached |
| `label.to_wire` | `net`, `card` | replace the net's labels in a card with a routed wire (one port label stays when the net leaves the card) |
| `label.add`, `label.delete` | `labels: [{ handle?, net, card, x, y, side, scope }]`, `ids` | |
| `power.add`, `power.delete` | `symbols: [{ handle?, net, card, x, y, dir, style }]`, `ids` | |
| `noconnect.add`, `noconnect.delete` | `pins`, `ids` | |
| `text.add`, `text.edit`, `text.delete` | as label | notes and headings |
| `pin`, `unpin` | `ids` | set or clear `pinned` |
| `card.regroup` | `ids` (symbols), `card` | move symbols to another card (presentation; reported until UHD moves the part) |
| `card.edit` | `id`, `title?`, `subtitle?` | |
| `layout.run` | `scope: "all" \| card ids`, `mode?: "fresh" \| "tidy"` | run the pipeline and write its records |
| `proposal.add` | `title`, `ops`, `rule?`, `defects?`, `handle?` | an agent's cleanup batch, checked by a dry run and scored before and after |
| `proposal.accept` | `id`, `only?: number[]` | apply the proposal's operations (or those indices) and remove it |
| `proposal.reject` | `ids` | remove proposals |
| `record.put`, `record.remove` | `records`, `ids` | system: hosts, undo and recovery |

Ids are owner-issued (`<epoch>.<n>`) for records a person or agent creates with a `handle`; the layout's
records use deterministic keys (`deterministicKey` over net, card and geometry), so an unchanged layout
regenerates the same ids.

### 8.3 Proposals and the agent's cleanup loop

An agent never rewrites the sheet directly when cleaning up a person's view: it reads the scene and score,
sends `proposal.add` with a few operations, and the service answers with the score each proposal buys
(dry run). A person accepts all, some (`only`) or none. Accepting applies the operations as the person's
transaction, so the person's undo removes them. Net changes never travel in a proposal (they are UHD edits).

## 9. Transactions, versions, undo

The engine follows board core section 9: a transaction `{ batchId, label (3 to 8 words), ops (1 to 200),
changeSet?, expectSeq?, expectVersions?, dryRun? }`, all or nothing, one undo step; a resent batch id returns
the first reply. Versions: `seq` plus one per commit; each object's version from 1 at open. Replies are
`applied | valid | refused | invalid`, with refusal reasons `stale-seq`, `stale-versions`, `pinned`,
`needs-person`, `stale-undo`, `nothing-to-undo`, `nothing-to-redo`. `undo(actor)` and `redo(actor)` act on the
actor's own transactions and are refused when anything they touched changed since (compared by content).
**Pinned items refuse agent changes** (reason `pinned`); unpinning by an agent waits for a person
(`needs-person`); `layout.run` from anyone leaves pinned items alone by construction.

## 10. The service

```ts
const svc = openSchematicService({ dir?, document?, circuit, projectRoot?, ownerLock? });
svc.snapshot();                 // { epoch, seq, doc }
svc.apply(tx, actor);  svc.undo(actor);  svc.redo(actor);
svc.score();                    // the readability score of the current document (cached per seq)
svc.checks();                   // the electrical findings
svc.scene(options);             // the agent scene (section 10.2)
svc.subscribe(listener);        // { type: "commit", seq, changed } | { type: "saved", files }
svc.save();  svc.close({ save? });
```

Saving is never automatic per transaction; files are written only when their content changed, through a
temporary file and a rename. The journal, leases, the wire transport and reload on external change follow the
board core and are specified there; Phase 3 builds the in-process service (section 15).

### 10.1 Electrical checks

`electricalChecks(circuit, doc?)` returns findings `{ id, check, severity, objects, location?, path?,
measured?, required?, message }` with `id` from the board core's `findingId`. Messages are built from facts.

| Check | Severity | When |
|---|---|---|
| `unconnected_pin` | error for supply and ground pins, warning for inputs, info otherwise | a pin on no net, not of type `nc`, not listed in UHD `unconnected` and without a no-connect mark |
| `single_pin_net` | warning | a net with one pin that does not leave the board |
| `conflicting_outputs` | error (two supply outputs of different parts), warning (two push-pull outputs) | outputs that drive one net |
| `voltage` | error (warning when the level rests on a range only) | the highest voltage a net can reach exceeds a pin's allowed maximum, or a supply net stays below a supply input's minimum |

**The voltage check.** Each net gets the highest level it can reach and the path that explains it. A net's design
voltage (UHD `Net` voltage) decides, as in UHD: an adjustable regulator's output range says nothing by itself, and
the path starts at the supply output whose range holds the design value. Without a design voltage, a supply
output's nominal value counts; one that states only a range makes the level uncertain. Levels pass through
resistors, inductors and ferrite beads to the nets on their other side (a pull-up holds a high-impedance node at
its rail); capacitors, diodes and ICs do not carry a level (a diode's drop is not modeled). Ground nets are 0 V and
never reported against logic pins. A pin's limits come from its UHD `voltage` parameter. A level above a pin's
maximum is an error when certain and a warning when it rests on a range only (the message asks for a design
voltage on the net). The finding's `path` lists the driver, each net and part crossed, and the pin, for example
`J1 VBUS (supply out, 5 V) -> VBUS -> R8 10k -> BOOT -> U1 pin 13 IO9 (max 3.6 V)`.

### 10.2 The agent scene

`describeSchematic(doc, { card?, net?, image?: "svg" | "png" | "both", theme? })` returns `{ json, svg?, png? }`.
The JSON (`protoboard.schematic-scene/v1`) is sized for a model's context and shares its marker numbers with
the image, as `@protoboardai/board-scene` does:

- `sheet`: bounds, grid (`gu` and `gu_mm`), score, gates open, counts, seq;
- `cards`: id, title, group, box, members, anchor, `flowIn` and `flowOut` nets, neighbors by direction, score,
  and a one-paragraph `digest` ("power: U2 AP2112K at center; VBUS enters left, +3V3 leaves right; C1 and C2
  hang from VIN and VOUT; score 96; no defects");
- `parts`: id, ref, value, class, role and `serves` (the pin), card, box, rotation, mirror, pinned, field boxes,
  pins `[id, name, number, side, at, net, end]` (`end`: `wire`, `label`, `power`, `nc`, `open`), `near`
  (nearest part per direction with the gap);
- `nets`: name, class, cards, style per card (`wire`, `label`, `power`), wire polylines, junctions, labels;
- `defects`: `n` (the marker number), `id`, `rule`, `severity`, `card`, `at`, `objects`, `message`, `suggest`
  (operations that would fix it); `markers` lists `[n, id]`;
- `findings`: the electrical findings with their own marker numbers after the defects.

Units: grid units, +Y down, boxes `[x0, y0, x1, y1]`. The image draws every defect as a numbered ring at its
location, every part's reference, and (with `net`) one net highlighted with the rest faded. `card` crops to one
card with a one-card halo. Same document in, same bytes out.

## 11. The readability score

`scoreSchematic(doc)` returns `{ score, gates: { open, rules }, rules: RuleResult[], defects: Defect[],
cards: Record<card id, number> }`. Each rule measures a count over its opportunities; its failure fraction is
`f = min(1, count / opportunities)` (0 when there are no opportunities). Weights: **gate 10, error 5, warning 2,
info 0.5**. The score is `clamp(round(100 - 10 * sum(weight * f)), 0, 100)`; a card's score is the same sum over
the defects located in it and its own opportunities. A sheet with an open gate (C01 to C06) is not
presentable whatever its score.

| Id | Rule | Count | Opportunities | Severity |
|---|---|---|---|---|
| C01 | Drawn netlist equals UHD | nets whose drawn pin set differs, plus pins drawn on no net | nets | gate |
| C02 | No overlaps among symbol bodies, fields, labels, power symbols, card titles | overlapping box pairs (0.1 gu tolerance) | boxes | gate |
| C03 | No wire through a symbol body or text | segment and box intersections | wire segments | gate |
| C04 | No label or text on a foreign pin | labels or fields whose box holds a pin of another net | labels and fields | gate |
| C05 | No dangling wire end; every open pin marked | wire ends on nothing, plus unmarked open pins | wire ends and pins | gate |
| C06 | No accidental merge | wire vertices or ends on another net's wire or pin | wire vertices | gate |
| C07 | Rails drawn as power symbols | rail pins whose drawn conductor holds no power symbol | rail pins | error |
| C08 | Wire inside a card (no label islands) | nets drawn with labels between pins of one card | nets with two or more pins in one card | error |
| C09 | Labels across cards, not wires | wire segments crossing a card border | wire segments | warning |
| C10 | Ground points down, supplies up | power symbols pointing the wrong way | power symbols | error |
| C11 | Rail pin faces its rail | two-pin parts whose ground pin is not below or whose supply pin is not above | two-pin parts on a rail | warning |
| C12 | Decoupling beside its supply pin | decoupling capacitors whose body is farther than 6 gu from the pin, in another card, or not wired to it | decoupling capacitors | warning |
| C13 | Satellites beside the pin they serve | pull-ups, pull-downs and series parts whose body is farther than 8 gu from the pin (or port label) they serve | satellites | warning |
| C14 | Signal flow left to right | directed pin pairs (output to input) whose destination is left of the source (by card when they cross cards) | directed pairs | warning |
| C15 | Power flows down or right | a card fed a rail lying wholly left of the card making it, or wholly above it and not to its right | power edges between cards | warning |
| C16 | Few crossings | crossings beyond `max(2, nets / 10)` on the sheet | nets | warning |
| C17 | No four-way junctions | points where four wire directions of one net meet | junctions | error |
| C18 | Few bends | wires above 2 bends (mean target 2 or fewer) | wires | info |
| C19 | No long wires | wires longer than `max(12, 0.4 * card width)` or crossing another part's box | wires | warning |
| C20 | Every part in one card; cards apart | symbols outside their card, overlapping cards, gutters under `gutter`, regrouped parts | symbols and card pairs | error |
| C21 | Every card titled | cards without a title or whose title is wider than the card | cards | warning |
| C22 | Labels read outward | labels whose text runs back over their own wire or pin | labels | warning |
| C23 | Fields nearest their part | reference or value fields closer to another part's body | fields | warning |
| C24 | Designators unique; values with units | repeated or `?` designators, values without a unit | symbols | error |
| C25 | On grid | off-grid pins or wire vertices (0 by construction; still measured) | pins and vertices | error |
| C26 | Generated symbol pin sides | supply inputs not on top, ground not at the bottom, inputs not left, outputs not right | generated symbol pins | info |
| C27 | Repeated subcircuits alike | instances of one pattern on one card whose relative placement differs | pattern instances | warning |
| C28 | Net named once at a point | a wired conductor in one card carrying two labels, or a label and a power symbol | labels and power symbols | warning |
| C29 | Sheet fill | card whitespace outside 0.35 to 0.7 (ink: symbol boxes with a 1-unit halo, wires 1.5 units wide, labels, power symbols), sheet aspect outside 1.2 to 1.8 | cards plus one | info |
| C30 | Title block filled | missing title, rev, date or generator | 4 | info |

Each defect: `{ id, n, rule, severity, card?, at: [x, y], box?, objects, message, suggest? }`, numbered in a
stable order (gates, errors, warnings, info; then by card, rule and location). `suggest` holds operations in
the section 8 form when a fix is mechanical (a power symbol flipped, a satellite moved beside its pin).

## 12. The flat export (KiCad)

`exportKicad(doc, { dir, project })` writes an ordinary hierarchical KiCad schematic from KiCad's published
s-expression format (written from the documentation, version `20250114`): a root sheet holding one sheet box
per card (`<project>.kicad_sch`), one sub-sheet file per card (`<card key>.kicad_sch`), and a minimal
`<project>.kicad_pro`. It need not be pretty; it must import cleanly.

- Every sub-sheet embeds its symbols in `lib_symbols`, one library symbol per symbol form and orientation
  (the orientation is baked in, so placement is always angle 0 and unmirrored), drawn from the same
  `protoboard.symbol/v0` geometry the renderer uses; leads become pins of the same length and carry the part's
  own pad numbers; a symbol pin with several pads becomes stacked pins (the first typed, the rest hidden and
  passive). The project file sets ERC's library check (`lib_symbol_issues`) to ignore, since the symbols are
  embedded and no library holds them.
- Wires are copied, split wherever a pin, label, power symbol or another wire's end lies inside a segment (KiCad
  joins at segment ends), with the derived junctions; ports and local labels become **global labels** (a net keeps its
  UHD name on every sheet, so sheets join without hierarchical pins); power symbols become library power
  symbols whose value is the net name; no-connect marks are copied; a `PWR_FLAG` is added on each rail with
  supply inputs and no supply output, so ERC checks what matters.
- `readKicadNetlist(text)` reads `kicad-cli sch export netlist` output; `netlistsEqual(a, b)` compares two pin
  partitions. The equivalence test exports the Airnode C3 schematic, runs `kicad-cli` (found on `PATH`, in
  `KICAD_CLI`, or under the Program Files KiCad folders; the test is skipped when none is installed) for
  `sch export netlist`, `sch export svg` and `sch erc`, and asserts the exported netlist equals the circuit's.

## 13. Rendering and extension points

- `renderSchematicSvg(doc, { theme: "dark" | "paper", scale?, crop?, markers?, highlight?, tokens?, titleBlock?, notes? })` is pure
  (no DOM, no fonts: text is stroke paths from `@protoboardai/board-scene`), so the same document gives the
  same bytes. `svgToPng` rasterizes it with `@resvg/resvg-js`.
- **Dark** (on screen): chamfered cards with a knockout title tag, wires colored by signal class (power rose,
  ground warm gray, digital teal, I2C violet, USB sand, analog lime-gray), pill labels, IEC box resistors,
  defect rings. **Paper** (print): one ink on paper, thin card frames with the title inside, flag labels, US
  zigzag resistors, a title block and zones. The geometry is identical; only `ThemeTokens` differ.
- Extension points built: `ThemeTokens` (colors, strokes, label style, the variant drawn per class), passed
  whole or in part as `tokens`; `signalClassOf(doc, net)` (net to color class); `Marker` lists for any
  numbered overlay; `cardCrop(doc, card, halo)`. Specified for the screen and later phases: `SymbolResolver`
  (replace or extend section 6.2), `PatternDef` (a new circuit pattern for stage 3: `match(card, roles) ->
  placements`), `Renderer` (`render(snapshot)`, `update?(event, snapshot)` as in the board core), `RuleDef` (a
  new readability rule: `measure(ctx) -> { count, opportunities, defects }`).
- **Proposal ghosts** (built): `renderSchematicSvg(doc, { ghost: { proposal: id } | { ops } })` dry-runs the
  operations with `applyCalls`, diffs the result (`ghostDiff`), and draws the before state of each changed or
  removed item as faint dashed outlines and the after state of each added or changed item in the dashed blue ghost
  style (`ThemeTokens.ghost`), with a dashed arrow from a moved symbol's old center to its new one.
- **Pages for print** (built): `paginateSchematic(doc, { paper?: "A4" | "A3" | "A2", orientation?, margin? })` packs
  whole cards onto pages in reading order (a card larger than a page gets its own page, flagged `oversize`);
  `renderSchematicPages(doc, options)` draws one paper SVG per page with frame, zones and the title block's sheet
  field set to `n of N`; cards keep their sheet coordinates, so cross-card labels still read.

## 14. Reuse of the board package, and additions proposed

Used as exported today: `canonical`, `canonicalRecord`, `byCodeUnit`, `deepFreeze`, `sha1Hex`, `sha256Hex`,
`deterministicKey`, `newEpoch`, `findingId`, the `Actor` and `OpCall` types, `OpError`, `acquireOwnerLock`;
from `@protoboardai/board-scene`, `textPath`, `textWidth` and `svgToPng`; from `@protoboardai/symbols`, the
pack, the generators and the geometry helpers.

Proposed small additive exports from `@protoboardai/board` (not made; this package keeps a compact engine of
the same semantics until they land):

1. `createRecordEngine<D, R>(adapter)`: the transaction engine of `src/transaction.ts` with the document type,
   record schema check, lock rule and scope function passed in (`{ records(doc), withChanges(doc, puts,
   removes), problem(doc, rec), locked(rec), scope(doc, rec) }`). The board engine becomes one adapter.
2. `createRegistry<D>()`: the registry of `src/ops/registry.ts` as a factory, so another document type gets
   its own `registerOperation`, `getOperation`, `listOperations` and `change` without sharing the board's.
3. `writeJsonlFiles(dir, texts, expected)`: the temporary-file-and-rename writer with the on-disk hash guard
   from `src/format.ts`.

And from `@protoboardai/symbols`: export `elementPolylines` (and the other helpers of `src/geometry.ts`) from its
index; this package imports it by relative path until then.

## 15. Implemented now, specified only

Implemented: sections 2 to 14 except as listed here: the document, every operation of section 8.2 with its exact
inverse, the engine, the files, the in-process service (owner lock, save with the on-disk hash guard), the
circuit from UHD, symbol resolution, the layout pipeline, the score with all thirty rules measured, the four
electrical checks, the scene with shared marker numbers, the renderer in both themes with PNG, the KiCad export
with its netlist reader, and the Airnode C3 fixture with its 5 V fault variant.

Built in the second pass (Phase 3, scale): card splitting by nested sub-module; clusters, chains and
repeated-channel arrays; supply rows and capacitor banks for large parts; the crystal pattern; power paths
through series parts; TVS and probes on lanes; `hide_unused`; shown names; label merging across clusters; the
tidy pass; two-way card packing with flow, power, fan-out and aspect; sheet stability (`sheet: "keep"`); the
dense routing grid; proposal ghosts; pages for print. Dividers and RC filters are drawn by the lane rules (a
divider is a pull-up and a pull-down on one lane; a filter is a series part then a shunt) rather than a pattern
of their own; differential pairs stay together because their pins sit together on the generated symbol and their
lanes are adjacent, with no rule that measures it.

Specified only: the journal, leases, the wire transport and reload on external change (as the board core);
writing a regroup back to UHD; splitting a part with many pins into functional units (large parts get supply
rows, folded unused pins and function-ordered sides instead); a rail drawn once as a bus across an array (each
channel carries its own power symbols); the plug-in interfaces of section 13 marked as specified. Rule C27 still
measures satellite chains (a satellite serving a satellite), not the arrays above.

Measured on the Airnode C3 sample (`scripts/renders.ts`): the first working pipeline scored 44 with 17 open gates
(overlaps) and three rails labeled at each pin because their wiring failed; with the rules of section 7 as written
here it scores 93 with every gate closed, the drawn netlist equals UHD, the KiCad export's netlist equals the
circuit's (15 of 15 nets) and KiCad's ERC reports no violations.

Measured at scale (second pass): the synthetic fixtures score 92 (16-channel driver, every gate closed), 90 (8-LED
chain, every gate closed), 51 (48-pin microcontroller), 67 (fifteen cards) and 75 (158 parts, laid out in about
0.4 s); every fixture's KiCad export has the circuit's netlist exactly and no ERC wiring errors. On seven real
boards tried locally (23 to 197 parts) the drawn netlist now equals UHD with no accidental merge on every board,
and the scores rose from between 0 and 54 to between 12 and 67; no real board yet reaches 80 with every gate
closed. What keeps them below: rails and signals mixed on one side of a part at pitch 1 (connectors, small
transistors), where a power symbol has no room between its neighbors' labels; routes that fail and fall back to a
label at every pin, placed without a search; and rules with very few opportunities on a sheet (C14, C15, C27),
where one defect costs 10 to 20 points.
