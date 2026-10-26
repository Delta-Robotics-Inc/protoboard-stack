# PCB handoff: UHD → tscircuit → KiCad

Status: built in Stack 0.1.7. Decisions: KiCad is the final hand-placement step. tscircuit is the layout of
record while the design changes; KiCad is the layout of record after the board
is **locked**. Locking is an explicit command and a human decision. The files
target the **KiCad 10** format.

```
UHD board module ──generate──▶ tscircuit (circuit.json) ──lock──▶ KiCad project (kicad/)
      ▲  model of truth             layout of record              layout of record
      │                             while unlocked                after lock
      └────────────── circuit:check compares all three (no write-back) ─────┘
```

## 1. Operations

All are operations of the `circuit` capability of `@protoboardai/ext-tscircuit`,
run as `protoboard run circuit:<op> --module <board>`. Core accepts operations a
provider declares beyond the required four (generate, export, extract, check);
each states its own effect. `--force` on the command line is passed to an
operation that declares a `force` input.

| Operation | Effect | What it does |
| --- | --- | --- |
| `circuit:kicad` | export | A KiCad project of the current build into `tscircuit/kicad/` (a preview, rewritten each time, never the layout of record). Works locked or not. |
| `circuit:lock` | export | Exports the KiCad project into `<board dir>/kicad/` (committed) and writes the handoff record `kicad/handoff.json`; the board is then locked. Refuses on a locked board, and on a board whose tscircuit build is stale or missing. `--input refresh=true` on a locked board re-records the handoff from the model and the KiCad files as they are now, without exporting (after the KiCad side was brought up to date by hand). |
| `circuit:unlock` | export | Moves `kicad/` to `kicad-archive/<UTC stamp>/` (the handoff record inside says when and that it was unlocked) and returns the board to tscircuit. |
| `circuit:generate` | export | Locked: refuses (it would replace the routing of record) unless `--force`; with `--force` it runs and the lock stays, so `check` then reports how the new tscircuit build differs from KiCad. |
| `circuit:export` | export | Locked: fabrication outputs come from KiCad (`kicad-cli`, below). Unlocked: unchanged. |
| `circuit:check` | pure | Locked: the comparisons of §4 in place of the tscircuit checks. |

A board is locked exactly when `<board dir>/kicad/handoff.json` exists with
`state: "locked"`. Nothing is written into `circuit.config.ts`.

## 2. The KiCad project

`<board dir>/kicad/` (lock) or `tscircuit/kicad/` (preview), named after the
board module id `<b>`:

| File | Content |
| --- | --- |
| `<b>.kicad_pro` | project: net classes from the config's rules (track, via, clearance) |
| `<b>.kicad_pcb` | footprints at their tscircuit positions, tracks, vias, zones (pours), `Edge.Cuts` outline, mounting holes, copper layers (2 or 4) and the stack-up with the config's thickness |
| `<b>.kicad_sch` | the provider's own schematic of the board, one sheet laid out for a person (§2.2) |
| `<b>.pretty/` | the board's footprints, one `.kicad_mod` per land pattern (named by the land-pattern entry id) |
| `<b>.kicad_sym` | the board's symbols |
| `<b>.kicad_dru` | custom DRC rules: the config's via pad and drill as minimums for every via (KiCad's net class via size is only what new vias get), and each keep-out with `allow_bodies`: its KiCad areas are named after it and allow footprints, and a rule forbids every footprint but the allowed ones there (KiCad's keep-out areas forbid all footprints or none). Tracks, vias, pads and pours stay forbidden in the area |
| `fp-lib-table`, `sym-lib-table` | the two project libraries, `${KIPRJMOD}`-relative |
| `3d/*.step` | each part's body (the copy without its interface feature shapes, as export uses) or its package box; footprints link `${KIPRJMOD}/3d/<file>.step`. Each source file gets its own name: `<part id>-<file name>` (a project's bodies are all `body.step`), with the source path's digest added if that name is taken by another file |
| `handoff.json` | lock only (§3) |

Fields on each symbol and footprint: `Reference` (§2.1), `Value`, `Footprint`
(`<b>:<entry>`), `MPN`, `Manufacturer`, `LCSC` (the first LCSC offer for the
placement's MPN among the offers the project holds, when there is one; see
below), `UHD_Instance`, `UHD_Part`, and
`UHD_Group` for a part inside a sub-module. Each sub-module is a KiCad group on
the board, named by its path (nested-boards.md §8). Symbol
and footprint are linked by the symbol's UUID (footprint `path`), so KiCad's
**Update PCB from Schematic** matches them; UUIDs are derived from the board
id and instance path, so a re-export writes the same ones.

**Supplier numbers.** One reader, core's `@protoboardai/core/offers`,
gives a part's offers to every place a supplier number is written: the
`LCSC` field here, the generated board's `supplierPartNumbers`, the board's
BOM and pick-and-place (unlocked and locked export alike) and the project's
bill of materials. It reads `parts/offers.json` (the library's offers) and
`parts/evidence/<part>/sourcing.json` (the project's own sourcing record),
in one order of precedence: a project part's own evidence first, a library
part's (one vendored from the catalog, listed in `parts/origins.json`)
library offers first. An offer counts for a placement when it names no MPN
or the placement's own (a series passive's offers are per value). A supplier
named "LCSC / JLCPCB assembly" is LCSC.

### 2.2 The schematic

The provider writes the schematic itself (`lib/kicad/schematic.ts`); the
converter's schematic was one auto-placed sheet with pin names sanitised
(`IN_`/`IN__4` for a comparator's IN+/IN−), every pin passive, nothing on
the grid, labels over pin names and wires through bodies (a large field board:
20 ERC errors, 1,060 warnings). What it writes instead:

- **Symbols**, one per part and pin set, in the project's `<b>.kicad_sym`:
  pins named as the model names them (`+`, `-` and `/` kept; a note in
  brackets dropped, so an LED's pins are `A` and `K`; pins of one name on one
  net keep the name, one on another net becomes `GND_2`), every pin on the
  1.27 mm grid. Electrical types come from the UHD leaf: ground and supply
  inputs `power_in`, supply outputs `power_out` (one source per rail per
  part; a connector on a rail a part drives is passive), digital and analog
  roles `input`, `output` or `bidirectional`, an output with `open_drain`
  `open_collector`, passive terminals `passive`, an unwired no-connect pin
  `no_connect`. Passives are two-pin symbols; everything else is a box with
  supplies and inputs on the left, outputs on the right, ground at the
  bottom left.
- **Layout**: one framed block per sub-module (titled by its path and name,
  in tree order), and one for the board's own parts. In a block each IC comes
  first with the passives it shares the most with (a signal net counts most,
  a supply less, ground not at all) in columns beside it.
- **Nets**: a 5.08 mm stub and a global label at every connected pin, named by
  the pad's net on the exported board, so Update PCB from Schematic changes
  nothing; a no-connect flag on a pin on no net; no long wires.
- **PWR_FLAG** on every net with a power input and no power output, so ERC's
  remaining findings mean something.
- **Sheet**: the smallest of A4 to A0 the blocks fit on, else a user size.

On a large field board (137 parts, 86 nets) KiCad's netlist of the schematic is
the same before and after (parts, values, footprints, every net's pins); ERC
goes from 20 errors and 1,040 warnings to 0 errors and 4 warnings, each a
real finding: two UART labels on one pin each, and two bidirectional pins
strapped to a supply rail.

**Converter.** tscircuit's own `circuit-json-to-kicad` (MIT, pinned exact)
writes the board and project from `circuit.json` (its schematic is not used). The provider
wraps it: it renames components to their reference designators before
conversion, sets the bodies on the circuit JSON as `circuit:export` does (so
the converter computes each model's offset and rotation), then edits the
S-expressions (libraries, model paths, fields, UUIDs, layers, stack-up) and
finally lets `kicad-cli pcb upgrade` / `sch upgrade` save both in KiCad 10's
own format. `kicad-cli` (KiCad 10) is a declared tool (`kicad-cli`) that
`circuit:lock` and `circuit:kicad` require; `circuit:export` of a locked board
looks for it when it runs and fails saying so when it is missing.

**Converter evaluation (0.0.237, 2026-10-17).** It writes all three files
and KiCad 10 opens them; on the smart-bottle cap board its raw output gave
KiCad 285 DRC findings and 208 schematic-parity findings. What the wrapper
fixes: footprints in a `tscircuit:` library that does not exist; no 3D models
for the parts' own bodies (paths only resolve under `tsci dev`); no LCSC
field; random UUIDs and no symbol–footprint link; pads of turned footprints
written board-aligned at angle 0 (right copper, but not the library pad
turned); a library symbol repeated per use; mounting holes without a
reference; extra pads of one pin left off its net; a schematic a person
cannot read and whose wires do not reach their pins (replaced, §2.2);
four copper layers listed on a two-layer board; KiCad's default 0.5 mm edge
clearance. After the wrapper: no parity finding, and what DRC still finds is
the tscircuit layout's own (stacked vias, overlapping courtyards, unrouted
extra pads), which is what the KiCad step is for. Footprints at other than
right angles may still differ from their library copy (a warning).

Board-only footprints (`(attr board_only …)`: the mounting holes, `H1…`)
are not components and are not compared. A footprint the converter writes
with nothing in it (its "Unknown" for a tscircuit `pcb_component` with no
source component) is left out, not written as an empty mounting hole (39 of
them on one large board).

### 2.1 Reference designators

Assigned once per instance path and recorded in `tscircuit/refdes.json`
(provider-owned, committed; kept across lock, unlock and re-lock):

1. An instance already recorded keeps its designator.
2. A new instance whose last path segment is that of exactly one recorded
   instance no longer on the board takes its designator (a part moved into or
   out of a sub-module; nested-boards.md §6).
3. A new instance whose id (the last segment of its path) reads as a
   designator of its kind's prefix (`r3`, `U1`, `led2/r1`) gets it
   upper-cased, when free.
4. Otherwise the kind's prefix (`R` resistor, `C` capacitor, `L` inductor,
   `FB` ferrite bead, `J` connector, `SW` switch, `U` IC) and the lowest free
   number, taking new instances in instance-path order.

A removed instance's designator is not reused while the record holds it.

## 3. Handoff record

`kicad/handoff.json`, schema `protoboard.kicad-handoff/v0`:

- `state` (`locked` | `unlocked`), `lockedAt`, `unlockedAt`
- `board`: the UHD board module id
- `netlist`: the digest of the board projection (core `boardNetlist`) and the
  projection as handed off: per component the instance, refdes, part,
  manufacturer, MPN, LCSC, value, land-pattern entry, and pin → pad; per net
  its id and its pins as `<instance>.<pad>`
- `board_shape`: digest of the outline, holes, layers and thickness constraints
- `tscircuit`: the build's source digest, `circuit.json` digest and core version
- `tools`: `kicad-cli` version, `circuit-json-to-kicad` version, provider version
- `files`: digests of the KiCad files as exported
- `positions`: where KiCad has each footprint at lock (board frame, by
  instance, from `kicad-cli pcb export pos`). Export measures a move made in
  KiCad from here: a footprint's origin (the pads' centre) is not always the
  body origin tscircuit's build records, so measuring from the build called
  unmoved parts moved. A record without it (0.1.7) is measured
  from the build, as before.

## 4. check on a locked board

Three netlists, each as parts (instance → footprint, fields) and
pin → net (`<instance>.<pad>`): **R** the handoff record, **M** the model now,
**K** the KiCad files now (`.kicad_pcb` footprints and pads, parsed as
S-expressions; the schematic's symbols, and its nets through
`kicad-cli sch export netlist` when KiCad is installed). Differences R→M are
model changes, R→K are KiCad changes; one found on both sides is applied.

| Code | Severity | Finding |
| --- | --- | --- |
| `CIRCUIT_LOCKED` | info | the board is locked; KiCad is the layout of record since `lockedAt` |
| `CIRCUIT_KICAD_STALE` | error | the model added or removed a part, changed a land pattern, or the outline, holes, layers or thickness changed, and KiCad does not have it yet: the layout must be updated in KiCad (or unlock and regenerate) |
| `CIRCUIT_KICAD_MODEL_CHANGED` | warning | connections between existing parts changed in the model (net renamed, pin moved), not yet in KiCad; the message gives the diff |
| `CIRCUIT_KICAD_FIELDS` | warning | MPN, manufacturer, value or LCSC changed in the model; update the fields in KiCad |
| `CIRCUIT_KICAD_APPLIED` | info | a model change already made in KiCad too; `circuit:lock --input refresh=true` records it |
| `CIRCUIT_KICAD_PART_MISSING` | error | KiCad lacks a part the model and the record have (deleted by hand) |
| `CIRCUIT_KICAD_PART_EXTRA` | warning | KiCad has a part the model does not (added by hand: a fiducial or test point belongs in the model) |
| `CIRCUIT_KICAD_FOOTPRINT_CHANGED` | warning | a footprint was swapped in KiCad |
| `CIRCUIT_KICAD_NET_RENAMED` | warning | a net was renamed in KiCad (same pins) |
| `CIRCUIT_KICAD_NET_CHANGED` | error | a pin was connected to another net in KiCad |
| `CIRCUIT_KICAD_PARITY` | warning | the KiCad schematic and board disagree (run Update PCB from Schematic) |
| `CIRCUIT_KICAD_UNREADABLE` | error | a KiCad file is missing or cannot be parsed |
| `CIRCUIT_KICAD_DRC` | error / warning / info | KiCad's own DRC of the board, run as export runs it (`kicad-cli pcb drc --format json --severity-all --schematic-parity`, on a copy; one runner and one count for both), cached by the files' digest in the system's temporary folder. Errors or unconnected items: error; warnings alone: warning. Without kicad-cli: from the last export's `out/drc.json`, said to be older than the board when it is; with neither: info |

Description, price and documents are not in the projection, so they never
appear. Nothing is written back in either direction.

## 5. Fabrication outputs of a locked board

`circuit:export` runs `kicad-cli` on `kicad/<b>.kicad_pcb`:

| Output | From |
| --- | --- |
| `gerber/` | `pcb export gerbers` and `pcb export drill` (Excellon) |
| `pnp.csv` | `pcb export pos`, re-keyed by UHD instance through the refdes record, with the part, MPN, package and LCSC number (§2, supplier numbers) |
| `board.step`, `board.glb` | `pcb export step` / `glb` (with the linked part bodies), moved into the stack's board frame (z = 0 on the mid-plane; KiCad's is the bottom face), GLB nodes named by instance path |
| `pcb-top.svg`, `pcb-bottom.svg`, `schematic.svg` | `pcb export svg`, `sch export svg` |
| `netlist.json` | the KiCad board's copper nets, keyed by instance and interface |
| `bom.csv` | the model, as before, with the supplier numbers the unlocked export gives (§2) |
| `board.manifest.json` | the tscircuit build at lock, with component positions and orientations from KiCad (the part's feature and the features of the exports it carries) |
| `drc.json` | `pcb drc` report (the run check makes too); export fails on a DRC error unless `--force`, saying how to fix it in KiCad or force it. A forced export does not silence check: `CIRCUIT_KICAD_DRC` still reports the errors |

`circuit:lock` is all or nothing: the project, the designators and the record
are staged and read back, and written into the project only when every step
has succeeded.

## 6. Skills

The `circuit-board` skill says locking is a human decision: an agent asks
before `circuit:lock` and `circuit:unlock`. KiCad skills derived from KiStack
(MIT, attribution in `NOTICE`) ship with ext-tscircuit: `kicad-layout-review`
and `kicad-cli`. They are the official path after lock, and the fallback the
circuit-board skill names when generate or export fails before lock.

## 7. Not in this round

Hierarchical sheets (sub-modules are KiCad groups and a `UHD_Group` field;
nested-boards.md §8); write-back from KiCad to UHD or tscircuit; importing a
KiCad board that was not exported by lock; panelization; KiCad libraries
(CC-BY-SA) stay unbundled.
