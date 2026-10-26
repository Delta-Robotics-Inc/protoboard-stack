---
name: circuit-board
description: Design a custom PCB through the circuit capability — the board as a UHD module (components as children, nets as links, its edge as exports), a circuit.config.ts naming @protoboardai/ext-tscircuit and its constraints (outline, layers, mounting holes, fixed placements, keep-outs), then protoboard run circuit:generate / circuit:export / circuit:extract / circuit:check --module <board> for a routed board and its standard outputs (Gerber, drill, BOM, pick-and-place, GLB, STEP, geometry manifest, netlist), and fix what the check finds (DRC, netlist drift, unrouted nets, outline, keep-outs, moved placements). This is the only sanctioned PCB path in a Protoboard project: never run tsci dev/build/export on a stack board; the fallback to tsci or KiCad tooling, when the official path fails and a board is needed anyway, is announced and recorded first. A KiCad 10 preview (circuit:kicad) and, when a person decides, the handoff to KiCad (circuit:lock / circuit:unlock). Use when a project needs a custom board, when the board module or its config changes, or when CIRCUIT_* diagnostics fire.
---

# Circuit board

```
board module (components, nets, exports) + circuit.config.ts (outline, layers, placements, keep-outs)
        │  protoboard run circuit:generate --module <board>
        ▼
tscircuit/board.gen.tsx ─► local autorouter ─► tscircuit/circuit.json, build.json          (native design)
        │  protoboard run circuit:export --module <board>
        ▼
out/gerber/, bom.csv, pnp.csv, board.glb, board.step, board.manifest.json, netlist.json   (standard outputs)
        │  protoboard run circuit:extract --module <board>   → frames for the enclosure
        └─ circuit:check (in protoboard check): DRC, copper netlist vs UHD nets, outline, keep-outs, placements
```

The board is UHD; the PCB is the provider's. The board module says what is
on the board and how it is connected, in tool-neutral terms. The provider,
`@protoboardai/ext-tscircuit`, owns land patterns, placement and routing, in
its own folder next to the module. Swapping to another `circuit` provider is
an edit to `circuit.config.ts`. Full reference: the package README
(`node_modules/@protoboardai/ext-tscircuit/README.md`); complete example:
`packages/ext-tscircuit/test/fixtures/imu-tile` in the stack repository (an
RP2040, a BMI270 and a TPS63020 on a 30 mm round board).

**The official path** is the stack's: model the board in UHD, then
`circuit:generate`, `circuit:check`, `circuit:export`, and view it in VS Code
(the Protoboard viewer). Never run `tsci dev`, `tsci build` or `tsci export` on
a stack board or at the project root: tsci rebuilds the board with another
tscircuit core, re-routes it, and crashes on the files the provider rewrites
(as happened on a large field project), and its outputs escape every check. The flow
is UHD → tscircuit → KiCad: tscircuit while the design changes, KiCad for the
final hand placement once a person locks the design (step 8: `circuit:kicad`,
`circuit:lock`, `circuit:unlock`; after lock the **kicad-layout-review** and
**kicad-cli** skills). Why, and the fallback policy:
[references/pcb-workflow.md](references/pcb-workflow.md).

## Purpose

Turn a UHD board module into a routed PCB and its standard outputs, and keep
the copper and the model in agreement. Use it when a project needs a custom
board (no purchased module fits: **build-a-project** decision points), when
the board module or its `circuit.config.ts` changes, or when `protoboard
check` reports `CIRCUIT_*` findings. In **build-a-project** it is stage 5:
after **system-compose** and the parts, before **enclosure-cad**, which fits
the case around `out/board.glb` and aligns openings to the frames in
`out/board.manifest.json`.

## Inputs

| Input | Where | From |
| --- | --- | --- |
| Board module | `src/boards/<module>/<module>.uhd.ts` | this SOP, step 1 (with **system-compose**) |
| Parts with package facts and pin designators | `parts/catalog/`, `parts/local/` | `protoboard parts add`, **uhd-part-author** |
| Size limit | a `design_envelope` trait on the board, from the brief | **system-compose** |
| Positions the enclosure fixes (connectors, buttons, displays, sensor windows) | the product's layout decisions | the brief, **enclosure-cad** |
| Provider config | `src/boards/<module>/circuit.config.ts` | step 2 |
| The provider | `npx protoboard doctor` shows `tscircuit-node` ✓ | `@protoboardai/ext-tscircuit` listed in `extensions` (the Protoboard installed on the machine carries it and every tscircuit package it pins; nothing to install with `tools install`) |

## Steps

### 0. Where a fix belongs: say it before you edit

Protoboard is the orchestrator. The board module and its parts own the
data, and the build steps (`circuit:generate`, `circuit:kicad`,
`circuit:lock`, `circuit:export`) turn UHD into tscircuit's and KiCad's
formats. Work in Protoboard: do not manage symbols, footprints, libraries or
models at the KiCad or tscircuit level, unless the job needs something
Protoboard cannot do (a SPICE model, for example). Then say so first, as the
fallback rule asks (Decision points).

Before any edit to a board, say in one line where the fix belongs, and make
it at the first of these levels that can hold it:

1. **The UHD model**: parts, connections, values, designators, MPN and LCSC
   fields, test pads, the board's edge (step 1).
2. **The tscircuit stage**: placement (`placements` in `circuit.config.ts`,
   `tscircuit/layout.json`), trace widths and rules, keep-outs, land patterns
   (`tscircuit/footprints.json`), hand polish in `board.tsx` (steps 2 to 3).
3. **The stack itself**: a converter or provider bug (a garbled schematic,
   mangled pin names, wrong silkscreen text) is reported as Protoboard
   feedback, with the command and its output. Do not hand-patch its output.
4. **KiCad, last**, and only on a locked board: the hand finish the stages
   above cannot produce (routing touch-ups, final placement nudges,
   silkscreen; **kicad-layout-review**).

**A locked board is not fixed in place.** When the change belongs upstream
(levels 1 to 3), propose an unlock and a re-lock instead of editing KiCad.
Say plainly which KiCad work would be lost: `circuit:unlock` moves `kicad/`
to `kicad-archive/<stamp>/`, and nothing in it comes back by itself (the hand
routing, moved parts and silkscreen done since `lockedAt`). Unlocking is the
person's decision: ask. A small model change can instead be brought into
KiCad by hand (**kicad-layout-review** step 6).

**Separate design choices from mistakes.** When you list what to fix, mark
each item: a mistake (a wrong net, a value against the datasheet, a check
finding) or a design choice (where a part sits, a layer, a trade-off someone
made on purpose). Fix mistakes at the level they belong. Propose design
choices and ask before you change them.

**Edits that must survive a re-lock.** A KiCad edit the stack cannot make
yet (a logo, a zone the provider does not draw) is written down as a
post-lock step in `docs/post-lock.md`: what, why, the exact edit, how to
verify it. It is applied from that list after every lock. Never leave it as a
silent hand edit. When the stack can do it upstream, move it there.

#### How to work on a board

- **Say what a long process will do before you start it**: hand-routing, a
  regroup of many parts, a sweep of several builds, a large part search. Say
  what it does, roughly how long it takes (one build of this board takes
  about as long as the last `circuit:generate`), and what it changes. When
  the step is optional, ask first.
- **When the router fails, step back before routing by hand.** Find the
  cause first. Parts may be too close (courtyards touching, no room for
  vias), the rules may not fit (widths, clearances, via sizes for the pin
  pitch), or the placement may force crossings (a connector on the wrong
  side, a part turned against its nets). Propose that fix first: space or
  move parts in `layout.json`, change a rule, give more room or layers.
- **Do not over-optimise small areas.** Before you polish a corner (a few
  tenths of a millimetre on a trace, a perfect fan-out), ask whether it
  needs doing at all for this board.
- **No placeholder CAD.** Never make a placeholder land pattern, CAD or 3D
  model from a datasheet while the part's UHD artifacts or its JLC/LCSC
  source has one. When no source has one, ask the person first.

### 1. Model the board

A board is an ordinary UHD module (UHD `docs/boards-and-nets.md`):

- **components** are its children, each a part with a `package` fact as the
  manufacturer states it ("QFN-56 7×7 mm") and a pin designator (`pin`) on
  every leaf interface. Decoupling capacitors, pull-ups, the regulator's
  inductor and feedback divider are components too: the provider adds none;
- **generic passives** are the catalog's series parts (`yageo-rc0402`,
  `yageo-rc0603`, `murata-grm155`, `murata-grm188`, `murata-blm15px`), one
  part for every value: place each with its value in the child's
  `overrides` (`{ id: "r3", moduleDefId: "yageo-rc0402", overrides: {
  resistance: 4700 } }`; a capacitor sets `capacitance` and, for Murata GRM,
  names the exact `part_number`). The part's `usage_note` (topic
  `instance`) and its `overridable` list say which keys it takes. The
  netlist, BOM, pick-and-place and the release use the placement's value and
  MPN; `UHD_PASSIVE_OVERRIDE` reports a key the part does not take, a value
  outside a tolerance grade's range, or an MPN that disagrees;
- **nets** are `Net(...)` interfaces of the board, joined to leaf pins by
  links (`netLinks("sda", ["u1:pin_2", "u2:pin_14", "r3:pin_2"])`);
- the **edge** is its `exports` (the connector the cable mates, a debug port);
- a `design_envelope` trait carries the size limit with its reason;
- sub-modules group parts so the diagram stays readable (a power stage,
  one LED channel used twice): a child that is `kind: "group"` or has children,
  and states no package or part number, is expanded onto this PCB, its parts
  under their paths (`led2/r1`). A sub-module's nets join the board's through a
  pin it exports (an export cannot reuse its own net id: `gnd_port`); a bus
  crosses whole, as one link between the two ports (`{ a: u1:i2c0, b:
  sensor:i2c }`), because a pin bound into a port cannot be exported alone. A
  child board (its own `circuit.config.ts` or `design_envelope`) or a
  daughterboard mated by connector is never flattened (docs/specs/nested-boards.md).

**Regrouping a board that already exists** moves parts to new instance paths
(`u3` becomes `power/u3`). Say before you start what it changes and roughly
how long it takes (step 0). Then:

- designators stay: every `circuit:generate` records them per instance in
  `tscircuit/refdes.json` (commit it), and a part that moved keeps its
  designator when its id is unambiguous. Generate once before regrouping if
  the board has no `refdes.json` yet;
- the hand-owned keys follow the paths: `layout.json`, `placements` in
  `circuit.config.ts`, the instances in `footprints.json`, the nets in
  `trace_widths`, selectors in `board.tsx`. Generate and check name a stale
  key with the path it probably means;
- **the project's own scripts** that write those files (a placement or
  net-width generator under `scripts/`) still write the old flat keys:
  update them to the paths, or retire them with a note, before you run them
  again. Re-running one undoes the regroup. The stack does not know about
  them;
- outputs keyed by instance are stale until the board is generated and
  exported again (`CIRCUIT_STALE`).

Every value comes from the parts' datasheets (cite them in the header:
the regulator's application circuit, the MCU's decoupling table). Never put a
footprint name, a layer or a tool name into the module.

The board is a child of the system (or a sub-assembly) like any part, so it
has an instance path and its exports link to cables (**harness-author**).

```bash
npx protoboard check --format json      # UHD_NET, UHD_BUS_PULLUP, UHD_SUPPLY_BUDGET on the board's nets, UHD_PASSIVE_OVERRIDE on placements; no CIRCUIT_BOARD_UNREADABLE
```

### 2. Configure the provider

```ts
// src/boards/<module>/circuit.config.ts
import { defineCapabilityConfig } from "@protoboardai/core";

export default defineCapabilityConfig({
  provider: "@protoboardai/ext-tscircuit",
  constraints: {
    layers: 2,
    thickness_mm: 1.0,
    outline: { circle: { diameter_mm: 30 } },
    mounting_holes: [{ id: "mount_left", at: [-11, -6], diameter_mm: 2.2 }],
    placements: { j1: { at: [0, 11.5], rotation_deg: 0 } }, // fixed by the enclosure
    keepouts: [{ name: "antenna", rect: { at: [0, -12], size: [8, 3] }, reason: "chip antenna clearance (datasheet §…)" }],
  },
});
```

| Constraint | Meaning |
| --- | --- |
| `layers` | 2 or 4 (default 2) |
| `thickness_mm` | board thickness (default 1.6) |
| `outline` | `{ circle: { diameter_mm } }`, `{ rect: { width_mm, height_mm } }` or `{ polygon: [[x, y], …] }` (mm, board frame); default: the board's `design_envelope` |
| `mounting_holes` | `[{ id, at: [x, y], diameter_mm }]` |
| `placements` | `{ <instance>: { at: [x, y], rotation_deg, side } }`: positions the enclosure fixes |
| `keepouts` | `[{ name, rect: { at, size } \| circle: { at, diameter_mm }, layers?, reason?, allow_bodies? }]`; on 4 layers `layers` may name `inner1`/`inner2`. A pour stays out of every keep-out on every layer. `allow_bodies: ["u1"]` lets that part's body (courtyard) lie over it, for the module whose own antenna the keep-out clears; its copper must still stay out. A keep-out the board's `design_envelope` states takes the same list from an entry with its name and no shape: `{ name: "antenna", allow_bodies: ["u1"] }` |
| `via_in_pad` | `avoid` (default: no via inside an SMD pad; check reports any as `CIRCUIT_VIA_IN_PAD`) or `fill_and_cap` (allowed; the order asks the fab to fill and cap them, IPC-4761 type VII) |
| `pours` | `[{ net, layers: (top\|bottom\|inner1\|inner2)[], clearance_mm?, reason? }]`: a copper pour (ground plane), filled after routing around the other nets, written to the Gerbers as regions. A keep-out must reach the board edge (a pour outline cannot hold a hole) |
| `rules` | `{ trace_width_mm, power_trace_width_mm, via_drill_mm, via_pad_mm, edge_clearance_mm, hole_clearance_mm? }`; `hole_clearance_mm` is checked: copper nearer a non-plated hole's wall is `CIRCUIT_HOLE_CLEARANCE` (round holes as circles) |
| `autorouter` | `auto_local` (default) or `sequential_trace`; cloud routing is refused |
| `routing` | `on` (default) or `off`: placement only, no autorouting; unrouted nets are then info |
| `trace_widths` | `{ nets?: { <net id>: mm }, classes?: { signal?, power?, ground?: mm } }`: width per net, else per class, else the rules'; a net routed narrower is `CIRCUIT_TRACE_WIDTH` |
| `via_touching_pad`, `via_under_body` | `allow` (default) or `avoid`: no via ring touching an SMD pad / no via inside a courtyard. The router has no such rule; check reports each (`CIRCUIT_VIA_TOUCHING_PAD`, `CIRCUIT_VIA_UNDER_BODY`) |

Board frame: mm, +X right and +Y up in the top view, +Z out of the top
copper, z = 0 on the board's mid-plane.

```bash
npx protoboard doctor                    # tscircuit-node ✓
npx protoboard capabilities              # circuit: the board ✓ bound to @protoboardai/ext-tscircuit
```

### 2b. Land patterns, verified against the makers' drawings

Every part's land pattern comes from the provider's table
(`lib/land-patterns.ts`, matched by package, pin count, pitch, size and
maker) or from `tscircuit/footprints.json`. A land pattern is fab-ready only
when it is **verified**: its entry carries a `verification` record (document,
page, figure, date, and the drawing's values: pad groups with size, pitch and
row spacing; every pad centre where the drawing gives them; plated slots
and round holes with the centres the drawing puts them at; courtyard,
stencil, mask) and the copper matches it.

```bash
npx protoboard run circuit:check --module <board> --format json   # no CIRCUIT_FOOTPRINT_UNVERIFIED
```

For a part with no entry, or an unverified one: open the maker's recommended
land pattern (the datasheet's "recommended land pattern / footprint /
soldering pattern", a separate land-pattern document such as Maxim's 90-xxxx,
or the connector's "recommended PCB layout"), author the pads in the part's
mounting frame (the frame its 3D body uses, so copper and body agree), and
write the record from the drawing, not from the pads. Include what the
drawing shows beyond pads: plated stake slots and peg holes (a USB-C shell,
a switch's guide bosses), paired contacts sharing one land (`merged`), the
thermal pad's stencil windows. Where the drawing gives no courtyard, mask or
stencil, say what you used (IPC-7351B nominal courtyard, 0.05 mm NSMD mask,
1:1 paste). A land pattern that only matches the part's CAD or package
outline is not verified. Board copper designed in the project (wire and test
pads) gets a record citing the pad part that states it.

### 3. Generate

```bash
npx protoboard run circuit:generate --module <board> --format json
```

Look at `status`, `summary` and `data`: components and how each was placed
(fixed, layout, packed), nets, traces and vias, build time, `notes`. One
build of a 21-part board takes about 35 s and 1.2 GB of memory: run one at a
time.

Every build also writes the stencil and silkscreen of the authored land
patterns (tscircuit's own are 70 % paste per side, none on pill pads, and no
silkscreen). The silkscreen prints each part's designator (R12, U3) from
`tscircuit/refdes.json`, which generate extends for new parts and the KiCad
handoff keeps; the summary's log names any reference with no room on the
silkscreen. Generate also writes each part's body into the source as a `cadModel`
(its STEP, else GLB or OBJ, by a path relative to `tscircuit/`) and its
supplier part numbers (LCSC first, from `parts/offers.json` and
`parts/evidence/<part>/sourcing.json`), which the BOM and pick-and-place
carry too. A package matches a land pattern by name or by family
(`SOT23-5L` is a `SOT-23-5`), its pin count, pitch and size agreeing;
when entries of its family do not fit, generate stops and check says why
(`CIRCUIT_FOOTPRINT_MISMATCH`). Generate writes `tscircuit/board.gen.tsx` (rewritten every time), and once
each `tscircuit/board.tsx` (your entry; wrap or replace the generated board
there) and `tscircuit/layout.json` (positions for parts the config does not
fix). Parts in neither are placed by tscircuit's packer, which fails on
dense boards ("Unable to pack all PCB components"); placement errors stop
routing and the run fails saying so. Add positions to `layout.json`
(`{ "<instance>": { "at": [x, y], "rotation_deg": 0 } }`) and generate
again. Land-pattern overrides for a package or one instance go in
`tscircuit/footprints.json`; a part with no package fact, or a package with
no entry in the provider's table, stops generate with a message saying which.

### 4. Export

```bash
npx protoboard run circuit:export --module <board>
```

`out/` is replaced (rebuilding first if the native source changed; the
export is staged, so a failed export leaves the last good `out/` in place): `gerber/*.gbr` and `gerber/*.drl`, `bom.csv` and `pnp.csv` keyed by
UHD instance path, `board.glb`, `board.step`, `board.manifest.json` (outline,
`board_top`, mounting holes, every component and export with its frame),
`netlist.json`, and `schematic.svg`, `pcb-top.svg`, `pcb-bottom.svg` for the
viewer. Read the summary for which body each component got (its part's STEP,
a box from package facts, or tscircuit's), and for any body `board.glb`
could not load (it names them; the converter drew a box instead).

### 5. Extract the frames

```bash
npx protoboard run circuit:extract --module <board> --format json
```

`data.frames` holds a frame for each of the board's exports and interfaces
(a connector's mouth with the mating direction as its normal; a component's
top; a mechanical interface on the underside), plus the board's artifacts
and the placements. It does not edit the module: copy the frames into the
board module's geometry by hand (there is no re-bind operation for boards
yet), then `protoboard check`. The artifacts need no copying: the provider
declares the board's outputs (`out/`, the routed `tscircuit/circuit.json`,
and a locked board's KiCad project), and Protoboard attaches each one on
disk to the board when the project loads. That is what gives the board its
Schematic, PCB, 3D and BOM tabs in the viewer. An artifact the board lists
itself with the same id or file overrides the provider's. **enclosure-cad** reads the same frames from
`out/board.manifest.json`.

### 6. Check

```bash
npx protoboard run circuit:check --module <board> --format json   # this board only
npx protoboard check --format json                                # all of it: circuit:check per board, standard-outputs, UHD rules
```

Look for `ext:@protoboardai/ext-tscircuit/circuit:check` in `checks[]` with
the board as `subject`, and `protoboard/standard-outputs` for its `out/`.
Hand polish (`<tracehint>`, `<pcbtrace>` in `board.tsx`) is allowed; check
then compares the result with the model like any other change.

### 7. View the board (the definition of done)

The board is done when the person can see it in the viewer, not when the
commands pass. Open the project in VS Code: the Protoboard viewer shows the
board's Diagram, 3D (`out/board.glb` with the parts' own bodies), Schematic,
PCB (top and bottom) and BOM tabs (`npx protoboard dev` serves the same
viewer in a browser). This is the viewer for a stack board; `tsci dev` is not
(it re-routes the board with another core).

Then check every view headless:

```bash
npx protoboard views check --module <board>                    # each tab opened once in a headless browser; exit 1 on an empty or erroring tab
npx protoboard views check --module <board> --out-dir <folder>  # also a PNG of every tab, to look at
```

It lists the tabs the board gets and fails on a tab that throws, shows an
empty state, or draws nothing. A board with no Schematic or PCB tab although
`out/` holds the drawings is reported by `protoboard check` as
`PB_VIEW_UNREACHABLE`, with the reason. Look at the PNGs before you say the
board is done: a tab that draws can still draw the wrong board.

### 8. Hand the board to KiCad (lock), when a person says so

KiCad is the final hand-placement step: tscircuit is the layout of record
while the design changes, KiCad after the board is locked (the spec:
`docs/specs/pcb-kicad-handoff.md` in the stack repository). **Locking is a human
decision: ask the person before `circuit:lock` or `circuit:unlock`, and never
lock to get past a failing check.**

```bash
npx protoboard run circuit:kicad  --module <board>   # a KiCad 10 preview in tscircuit/kicad/ (any time; nothing changes hands; not committed)
npx protoboard run circuit:lock   --module <board>   # asked first: kicad/ (committed) + kicad/handoff.json; KiCad is the layout of record
npx protoboard run circuit:unlock --module <board>   # asked first: kicad/ moves to kicad-archive/<stamp>/; back to tscircuit
```

The preview in `tscircuit/kicad/` is rewritten each time and is not
committed (the project's `.gitignore` leaves it out); the locked project in
`kicad/` is committed. `circuit:lock` needs KiCad 10 (`kicad-cli`) and a
build that follows the model (generate first). Reference designators are kept per instance in
`tscircuit/refdes.json`, so a re-lock keeps them. After lock:

- `circuit:generate` refuses (it would replace the routing of record);
  `--force` rebuilds tscircuit's copy without touching KiCad.
- `circuit:export` makes `out/` from KiCad with `kicad-cli` and stops on a
  KiCad DRC error (`--force` exports anyway; `out/drc.json` keeps the report).
- `circuit:check` compares the model, the handoff record and the KiCad files
  (`CIRCUIT_LOCKED`, `CIRCUIT_KICAD_*`); the review in KiCad is the
  **kicad-layout-review** skill.

## Decision points

| Decision | Rule |
| --- | --- |
| 2 or 4 layers | 2 unless routing fails with every part placed, or a part's datasheet asks for a solid ground plane (a radio, a fine-pitch BGA, a high-speed bus). |
| Fixed placement | A connector, button, display or sensor window the enclosure serves is fixed in `placements`; everything else may move (`layout.json` or the packer). |
| Outline | From the `design_envelope` unless the enclosure needs another shape; say why in the config comment. |
| Generated or hand-polished routing | Generated until the board is final; polish only in `board.tsx`, never in `board.gen.tsx` or `out/`. |
| A part with no land-pattern entry | Add an entry from the manufacturer's recommended land pattern with its verification record (step 2b): to the provider's table when the maker's pattern serves every project, else to `tscircuit/footprints.json`; never copy a library you do not hold the rights to. |
| Vias in pads | `avoid` (the default). Move parts (`layout.json`) until the router keeps them out; `fill_and_cap` only when a part's pitch leaves no room, and then the order carries the fill note. |
| The router leaves errors | Step back first (step 0, "How to work on a board"): parts too close, rules that do not fit, a placement that forces crossings. Fix that and propose it. Then, for a last few errors, the result depends on small position changes: try a few 0.1-0.3 mm moves of the part named in the finding, in parallel builds, and keep the clean one. Say how many builds and how long before you start. |
| KiCad files wanted | Fabrication needs only `out/gerber/`. A KiCad 10 project of the current build at any time: `circuit:kicad` (step 8; a preview, not committed). KiCad as the layout of record for the hand finish: `circuit:lock`, when the person decides (step 8), then **kicad-layout-review**. |
| A fix for the board | Say where it belongs before editing (step 0): the model, then the tscircuit stage, then a stack bug to report, then KiCad. On a locked board, propose unlock and re-lock for an upstream change, and say what KiCad work it would lose. |
| The official path fails and a board is needed anyway | Fix what can be fixed inside it first (land pattern, `layout.json`, keep-out frame). With a real blocker and a use case that needs the board regardless, you may fall back to `tsci` or KiCad tooling (`kicad-cli`, KiCad skills such as KiStack's), but **first** tell the user plainly that you are leaving the official path, why, and that it adds friction (the outputs leave the stack's checks and staleness tracking; changes must be carried back to the UHD model by hand); record it in the project's `worklog.md` and as Protoboard feedback; keep the UHD model the source of truth; and write the outputs only to `src/boards/<module>/fallback-<tool>/` with a README. Full policy: [references/pcb-workflow.md](references/pcb-workflow.md). |
| Ready for fabrication | 0 `CIRCUIT_*` findings (every land pattern verified, no via in a pad), and you have looked at the Gerber layers (copper, mask, paste, silkscreen, drill) and the 3D board. Then a second DRC with the fab's own rules: the provider's rules are looser than a fab's. Nothing is uploaded or ordered. |

## Outputs

| Output | Where |
| --- | --- |
| Board module and config | `src/boards/<module>/<module>.uhd.ts`, `circuit.config.ts` |
| Native design | `src/boards/<module>/tscircuit/`: `board.gen.tsx`, `circuit.json`, `build.json`, `models/` (generated); `board.tsx`, `layout.json`, `footprints.json` (yours) |
| Standard outputs (generated; never edit) | `src/boards/<module>/out/`: `gerber/`, `bom.csv`, `pnp.csv`, `board.glb`, `board.step`, `board.manifest.json`, `netlist.json`, SVG renders |
| Operation records | `operations/` |

## Verification

```bash
npx protoboard check --format json    # circuit:check ran for the board with 0 errors and no CIRCUIT_FOOTPRINT_UNVERIFIED; standard-outputs ran with no PB_OUTPUT_* finding
npx protoboard run circuit:export --module <board>   # a re-export of an unchanged board changes no file (git status --short src/boards)
npx protoboard views check --module <board>          # every tab of the board draws (Diagram, 3D, Schematic, PCB, BOM)
```

The board's `design_envelope`, fixed placements and keep-outs all hold
(no `UHD_DESIGN_ENVELOPE`, `CIRCUIT_PLACEMENT_MOVED`, `CIRCUIT_KEEPOUT`), and
**system-review** has looked at the board's nets.

## Failure handling

| Code or symptom | Means | Do |
| --- | --- | --- |
| `CIRCUIT_BOARD_UNREADABLE` | A part undefined, a pin without a designator, a composite linked to a pin or a net, two nets of one module joined, a link to a sub-module's own net or into a separate board, `quantity` on a sub-module | Fix the board module, or add designators to the part (**uhd-part-author**) |
| `CIRCUIT_BOARD_GROUPING` | A sub-module's export the board leaves unconnected, or a sub-module with no parts | Link the export, or mark it `unconnected` on the child with the reason |
| `CIRCUIT_NOT_BUILT` | No build yet | `run circuit:generate --module <board>` |
| `CIRCUIT_STALE` | The board, `layout.json`, `footprints.json` or the constraints changed since generate, or the native source (or a file it imports, JSON included) since the build | `run circuit:generate`, then `circuit:export` |
| `CIRCUIT_STALE` (`out/ was exported from other inputs`) | An input of the last export changed: the built board, what the board depends on in UHD (parts, pins, nets, packages, bodies, edge, envelope; not descriptions or prices), a body file, the provider's code or a converter (the message names it; `tscircuit/export.json` records them). The same inputs give the same `board.step` and `board.glb`, so this is the only way a re-export changes them | `run circuit:export`, then regenerate what is built around the board (enclosure) |
| `CIRCUIT_DRC` | tscircuit's DRC or `@tscircuit/checks` found an error | Give parts room (`layout.json`, a larger outline, 4 layers); regenerate |
| `CIRCUIT_NET_OPEN`, `CIRCUIT_NET_SHORT`, `CIRCUIT_NET_EXTRA`, `CIRCUIT_UNROUTED`, `CIRCUIT_PIN_MISSING` | The copper's nets differ from the UHD nets | Regenerate; if routing cannot complete, move parts or add layers. Never change the UHD nets to match the copper |
| `CIRCUIT_PAD_UNNETTED` | A pin with several pads (a module's exposed ground pads) has pads the copper does not join to its net (boards generated before 0.1.7 netted only the first) | `run circuit:generate` (it joins every SMD pad of the pin), then `circuit:export` |
| `CIRCUIT_FINGERPRINT_FORMAT` (info) | `tscircuit/export.json` is from a provider that fingerprinted the whole UHD module; the board's own dependencies are fingerprinted now, so a description or price edit no longer makes `out/` stale | `run circuit:export` once to record the new format |
| `tsci dev` shows another routing, sits at 95 %, or crashes with ENOENT | tsci rebuilds with its own core and watches files the provider rewrites | Stop it; view the board in the Protoboard viewer (step 7). Never run tsci on a stack board |
| `CIRCUIT_FOOTPRINT_MISMATCH` | Land patterns of the package's name or family exist, none fits its facts | Correct the part's package facts (**uhd-part-author**), or add a fitting entry to `tscircuit/footprints.json` |
| `CIRCUIT_FOOTPRINT_FAMILY` (info) | The land pattern was chosen by package family | Nothing; confirm it for an unusual part |
| `CIRCUIT_VIA_TOUCHING_PAD`, `CIRCUIT_VIA_UNDER_BODY` | A via against the config's via policy | Move parts (`layout.json`) a little and generate again |
| `CIRCUIT_HOLE_CLEARANCE` | Copper too near a non-plated hole | Move the part, the trace or the hole; a pour is cut by the router's clearance |
| `CIRCUIT_TRACE_WIDTH` | The router necked a net narrower than `trace_widths` asks | Give the net room, or accept it |
| `CIRCUIT_COMPONENT_MISSING`, `CIRCUIT_COMPONENT_EXTRA` | Board and model disagree on components | Regenerate; remove hand-added parts from `board.tsx` |
| `CIRCUIT_OUTSIDE_OUTLINE` | A pad off the board, or a body overhanging | Move the part or enlarge the outline |
| `CIRCUIT_KEEPOUT` | Copper in a keep-out, or a keep-out that misses the board | Move the part or trace; fix the keep-out |
| `CIRCUIT_PLACEMENT_MOVED` | A fixed part is elsewhere | Remove the override in `board.tsx` or `layout.json`; regenerate |
| `CIRCUIT_FOOTPRINT_UNVERIFIED` | A land pattern has no verification record, or differs from it | Step 2b; the message names the entry, the instances and what differs. The work order holds the board until none is left |
| `CIRCUIT_VIA_RULES` | A via is smaller than `rules.via_pad_mm` / `via_drill_mm` (written by hand) | Make it to the rules, or change the rules only if the fab can make it |
| `CIRCUIT_HAND_PAD_JOIN` | A trace written by hand in `board.tsx` joins pads of one pin, which generate joins itself (in KiCad it is copper on no net) | Remove it from `board.tsx`, then `run circuit:generate` |
| `CIRCUIT_VIA_IN_PAD` | The router put a via in an SMD pad | Move the part or its neighbours a little and generate again; or `via_in_pad: "fill_and_cap"` |
| `pcb_component_outside_board_error` for a part turned by an odd angle at the edge | @tscircuit/checks tests the part's axis-aligned box, not its pads | If every pad and the courtyard are inside, allow it off the board in `board.tsx` (`allowOffBoard`); `CIRCUIT_OUTSIDE_OUTLINE` still checks the pads |
| generate fails: "Unable to pack all PCB components" or "Not routed" | The packer or the router gave up | Add positions to `tscircuit/layout.json`; generate again |
| generate fails: no land pattern for a package | The provider's table has no entry | Add one to `tscircuit/footprints.json` (cited) |
| `PB_CAPABILITY_CONSTRAINT_UNKNOWN` | A constraint this provider does not take | Check the name against the table in step 2 |
| `PB_OUTPUT_UNKNOWN_INSTANCE`, `PB_OUTPUT_INCOMPLETE` | `out/` is from an older board | Re-export |
| `UHD_NET`, `UHD_BUS_PULLUP` | The board's nets are wrong or incomplete | Fix the board module (step 1) |
| generate or export keeps failing on a board that is otherwise done | tscircuit cannot finish it (placement, routing, an exporter fault) | Fallback: `run circuit:kicad` and inspect the preview with the **kicad-cli** skill; the model and tscircuit stay the truth. If KiCad should finish the board, ask the person whether to lock (step 8) |
| `CIRCUIT_LOCKED`, `CIRCUIT_KICAD_*` | The board is locked; KiCad is the layout of record | **kicad-layout-review** |

Every other code: **system-compose** [diagnostic codes](../system-compose/references/diagnostic-codes.md).

## Hard rules

1. The board module stays tool-neutral: no footprint names, layers or tool
   names in UHD; land patterns live in the provider's table and
   `footprints.json`.
2. Never edit `board.gen.tsx` or `out/`; change the module, the config,
   `layout.json` or `board.tsx` and regenerate.
3. No cloud routing, no uploads, no orders: the provider runs offline and
   stops at files.
4. No `tsci dev`, `tsci build` or `tsci export` on a stack board or at the
   project root; the provider's operations are the way.
5. Leaving the official path (tsci, KiCad tooling) is a fallback for a real
   blocker only: announced to the user first, recorded in the worklog and as
   Protoboard feedback, outputs in `fallback-<tool>/`, the UHD model kept the
   source of truth.
6. Locking and unlocking are the person's decisions: ask first. After lock,
   parts and connections still change in the board module first; nothing is
   written back from KiCad.
7. Say where a fix belongs before editing a board: the model, then the
   tscircuit stage, then a stack bug (reported, not patched), then KiCad. A
   locked board is not fixed in place: propose unlock and re-lock, and say
   what would be lost. A KiCad edit that must survive a re-lock is a
   post-lock step in `docs/post-lock.md`.
8. Never make placeholder CAD or 3D models from datasheets while the part's
   UHD artifacts or its JLC/LCSC source has one; ask first when none does.
