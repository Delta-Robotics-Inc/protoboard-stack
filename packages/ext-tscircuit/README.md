# @protoboardai/ext-tscircuit

The first provider of the `circuit` capability
([tool integrations](../../docs/specs/tool-integrations.md)). It turns a UHD
board module into a routed PCB with [tscircuit](https://tscircuit.com), writes
the circuit capability's standard outputs, reads placements and frames back,
and checks the layout against the model. It runs inside Protoboard's own Node
process, offline.

A project selects it for one board, in the config next to the board module:

```ts
// src/boards/imu/circuit.config.ts
import { defineCapabilityConfig } from "@protoboardai/core";

export default defineCapabilityConfig({
  provider: "@protoboardai/ext-tscircuit",
  constraints: {
    layers: 2,
    thickness_mm: 1.0,
    outline: { circle: { diameter_mm: 30 } },
    mounting_holes: [{ id: "mount_left", at: [-11, -6], diameter_mm: 2.2 }],
    placements: { j1: { at: [0, 11.5], rotation_deg: 0 } }, // fixed by the enclosure
    keepouts: [{ name: "antenna", rect: { at: [0, -12], size: [8, 3] } }],
  },
});
```

```sh
protoboard run circuit:generate --module imu-tile-board
protoboard run circuit:export   --module imu-tile-board
protoboard run circuit:extract  --module imu-tile-board
protoboard check                # includes circuit:check for every bound board
```

The skill **circuit-board** (`skills/circuit-board/SKILL.md`) is the
procedure an agent follows: model the board, configure, generate, export,
extract, and act on each `CIRCUIT_*` finding.

`test/fixtures/imu-tile` is a complete example: an RP2040, a BMI270 and a
TPS63020 (test copies of UHD library parts in `test/fixtures/uhd-parts`, with
their origin noted there), with their decoupling, the regulator's inductor
and capacitors, and a JST SH header, on a 30 mm round board.

## How UHD maps to tscircuit

1. **Board netlist** (tool-neutral, in `@protoboardai/core`: `boardNetlist`).
   Each part on the board is a component with its UHD instance path, part
   id, kind, value, package facts and pin designators. A child that is a
   sub-module (`kind: "group"`, or children and no package or part number) is
   expanded: its parts are components under their paths (`led2/r1`), and its
   links join the board's (docs/specs/nested-boards.md); a child board or a
   daughterboard mated by connector stays off this PCB. Nets come from a
   union-find over the links of the board and its sub-modules between leaf
   pins and `Net` interfaces; a direct link between two functional ports
   (an I2C port to an I2C port) is copper, line by line as UHD pairs them.
   The board's exports are its edge. A KiCad or EasyEDA provider starts from
   the same step; only the land-pattern table and the writer differ.
2. **Source** (`lib/source.ts`). Each component becomes a `<chip>`,
   `<connector>`, `<resistor>`, `<capacitor>` or `<inductor>` named by its
   instance path. Its land pattern comes from the table below. Pad numbers are
   the part's designators; non-numeric ones (`EP`) follow the highest number.
   Each UHD pin is joined to its net by name (`<trace from=".u2 > .pin14"
   to="net.sda" />`). A pin with several pads (a module's grid of exposed
   ground pads) is one tscircuit port on its first pad and an internal port
   (`pinN_internal_k`) on each other pad; generate joins the pads to each other
   (see check), so every pad carries the net (`CIRCUIT_PAD_UNNETTED` otherwise). Supply, ground and no-connect pins get tscircuit pin
   attributes. Decoupling and pull-ups are components of the UHD board; the
   provider adds none.
3. **Constraints** (`lib/config.ts`). The outline (circle, rectangle or
   polygon; default: the board's `design_envelope`), mounting holes, keep-outs
   on each copper layer (an envelope keep-out takes `allow_bodies` from a
   config entry with its name and no shape), copper rules, and the positions the enclosure fixes
   (`pcbX`/`pcbY`/`pcbRotation`/`layer`; tscircuit does not move them). Later
   the enclosure's geometry manifest supplies the fixed positions.
   All of them are in the board frame (below), which is also the board
   module's own frame, so UHD regions on the board are read as they are. An
   outline taken from the `design_envelope` spans [0, length] × [0, width],
   the corner origin of UHD's example (`docs/boards-and-nets.md`). An envelope
   keep-out applies to each copper layer its z range reaches: top copper at
   z = +thickness/2, bottom at −thickness/2. A keep-out that misses the board,
   or reaches neither layer, is reported (`CIRCUIT_KEEPOUT`, warning) rather
   than silently doing nothing.
4. **Build** (`lib/runtime.ts`). The source is compiled with sucrase and
   rendered by `@tscircuit/core`: parts engine disabled, cloud autorouter off,
   a local autorouter preset (`auto_local` or `sequential_trace`). `fetch` is
   replaced during builds and exports by a guard that serves local files and
   refuses every network request.
5. **Stencil and silkscreen** (`lib/paste.ts`, `lib/silk.ts`), after every
   build. tscircuit prints paste at 70 % of each pad in each direction (49 %
   of its area), none on pill-shaped pads and on both sides of every plated
   hole; for every component with an authored land pattern those apertures
   are replaced by the pattern's own stencil (`paste`: 1:1 by default, a
   thermal pad's window-pane, none on bare test pads, pin-in-paste on plated
   slots on the part's side), placed and turned with the part. tscircuit draws
   silkscreen only for its built-in footprint strings, so each authored part
   also gets its reference (0.8 mm, else 0.6 mm, beside its courtyard where it
   clears every pad, hole, courtyard and the edge; a reference with no room is
   left off and logged) and a pin-1 dot. Paste apertures turned by other than a
   right angle are written to the paste Gerber as regions
   (circuit-json-to-gerber flashes them unrotated).

The provider directory, `src/boards/<module>/tscircuit/`:

| File | Owner | Content |
| --- | --- | --- |
| `board.gen.tsx` | generate (rewritten every time) | the generated source |
| `board.tsx` | you (written once) | the entry; wrap or replace the generated board here |
| `layout.json` | you | positions for parts the config does not fix: `{ <instance>: { at, rotation_deg, side } }` |
| `footprints.json` | you (optional) | land-pattern overrides: `{ packages: [entry…], instances: { <instance>: entry } }` |
| `circuit.json`, `build.json` | generate, export | the built board, the name map back to UHD, source and netlist digests, versions; `sourceFiles`, every file the build read besides the folder's own sources (JSON a hand file imports, a hand file in another folder), which the source digest covers |
| `models/` | export | box bodies for parts without a body artifact; copies of part bodies without their interface feature shapes |

**Bodies and supplier numbers in the source.** Generate writes each
component's body into `board.gen.tsx` as a `cadModel`: the part's STEP (the
copy in `models/` without its interface feature shapes), else its GLB or OBJ
(UHD GLBs are glTF metres, +Y up: `modelUnitToMmScale: 1000`,
`modelBoardNormalDirection: "y+"`), with the mount origin as
`modelOriginPosition`. Paths are relative to the `tscircuit/` folder with
forward slashes, so they mean the same on every OS and machine; no
`tsci dev` URL is ever written. tscircuit itself centres a model on the pads;
the provider's exports place every body by its mount frame on a copy of the
circuit JSON (below). Each component also gets `supplierPartNumbers` from the
offers the project holds (`parts/offers.json`, `parts/evidence/<part>/sourcing.json`),
for its own MPN, LCSC first (JLCPCB assembles from LCSC numbers), then DigiKey
and Mouser; they are generate inputs, so new offers make the board stale until
the next generate.

**Land patterns by package family.** An entry matches a package by its
normalised name, else by its family: `SOT-23-5`, `SOT23-5` and `SOT23-5L` are
one; `0402 (1005 metric) chip` is the 0402 chip; `QFN-32-EP`, `VQFN-32` and
`WQFN32` are `qfn-32`; `VSSOP-10` is `msop-10`. Either way every fact the entry
states (pin count, pitch, body size, maker) must agree. A family match is
reported (`CIRCUIT_FOOTPRINT_FAMILY`, info); a package whose name or family
has entries that do not fit is reported with why (`CIRCUIT_FOOTPRINT_MISMATCH`)
and generate stops on it, instead of picking one.

Parts missing from both the config and `layout.json` are placed by
tscircuit's packer. It fails on dense boards ("Unable to pack all PCB
components"), and placement errors stop routing; generate then fails and says
so. Add positions to `layout.json` and generate again.

## Standard outputs

Under `out/`, replaced by every export. The export writes into a staging
folder beside it (`.out.staging`), and core swaps the files in only when the
export succeeds: a failed export (a converter that throws) leaves the last
good `out/` in place, and nothing reading `out/` sees it half written:

| File | Content |
| --- | --- |
| `gerber/*.gbr`, `gerber/*.drl` | Gerber RS-274X with X2 attributes (copper, mask, paste, silk, `Edge_Cuts`) and Excellon (plated, non-plated). Creation timestamps are removed, so an unchanged board exports identical files. |
| `bom.csv` | `instance, part, name, kind, manufacturer, mpn, value, package, quantity, lcsc, supplier_part_numbers`, one row per component (`supplier_part_numbers`: `lcsc:C… digikey:… mouser:…`). tscircuit's own BOM lacks the MPN and is keyed by refdes, so it is not used. |
| `pnp.csv` | `instance, x_mm, y_mm, rotation_deg, side, part, mpn, package, lcsc`, at the pad bounding-box centre. |
| `board.glb` | glTF binary in glTF's own convention (metres, +Y up), like every other UHD body. One root node `board` maps tscircuit's frame to it; component nodes are named by instance path. |
| `board.step` | AP214, mm, board frame. One mapped item per component, named by instance path; model representations are named by artifact (`<part>#<artifact>`) or project-relative box path, and the header date is fixed, so an unchanged board exports an identical file. |
| `board.manifest.json` | UHD geometry manifest: `outline` (the underside), `board_top`, each mounting hole by its config id, each component by instance path, each board export by its id. Every feature also carries `frame` (origin, normal, xAxis). |
| `netlist.json` | `protoboard.netlist/v0`: the nets as the copper joins them, named by the UHD net each piece carries (`scl+sda` when a piece carries two). |
| `schematic.svg`, `pcb-top.svg`, `pcb-bottom.svg` | renders for the viewer. |

**Board frame:** mm, +X right and +Y up in the top view, +Z out of the top
copper, z = 0 on the board's mid-plane (tscircuit's convention). The top
surface is z = +thickness/2.

**Bodies** in `board.glb` and `board.step`, per component: the part's own UHD
body artifact (STEP), placed on the board by the part's mounting frame (the
interface facing −Z); else a box from the part's package facts
(`dimensions_mm`); else tscircuit's generated body for a built-in footprint,
or none. Export reports which one each component got, and names every body
`board.glb`'s converter could not load (it draws a box in its place; an
unfetched Git LFS file, say) instead of counting it as a body. Model files are
read through the offline guard, which takes absolute paths and `file://` URLs
on every platform (on Windows `C:\…`, `C:/…`, UNC paths and `file:///C:/…`). In both files a body's
origin goes to the footprint centre on the board surface (z = ±thickness/2).

UHD CAD bodies carry one named sub-shape per interface feature (thin marker
solids on the faces an interface binds to; for an SMD part, 0.25 mm under its
seating plane). They are not part of the body, so export writes a copy of the
part's STEP without the sub-shapes named after the part's interfaces, under
`models/`, and uses that.

`circuit-json-to-step` 0.0.43 places a model by recentring it on the bounding
box of every point in its file (axis placements included) and lifts it by
half the board thickness above a position that is already the board surface.
Export sets each mapped item's origin back to the component's position
afterwards, keeping the converter's axes. The test resolves every body's
world bounding box in `board.step` and checks it against the pick-and-place
centre and the board top.

## extract

Frames for the board's exports and interfaces, taken from the manifest
features of the same id: a connector's frame is its mouth, with the mating
direction as the normal; a component's is the top of its body; a pin export's
is its pad. A mechanical interface of the board binds to its underside. Also
the artifacts to reference (outputs and the native source, `format:
"tscircuit"`) and, outside UHD, the placements, outline and routing totals.
Writing frames into the module is a separate step, as for CAD.

## check

Pure: it reads the last build and writes nothing.

| Code | Severity | Finding |
| --- | --- | --- |
| `CIRCUIT_NOT_BUILT` | info | no build yet |
| `CIRCUIT_BOARD_GROUPING` | warning | a sub-module's export the board leaves unconnected (not marked `unconnected` on the child), or a sub-module with no parts |
| `CIRCUIT_STALE` | warning | the native source changed since the build (export rebuilds); the UHD board changed since generate; or `layout.json`, `footprints.json` or the config's constraints changed since generate (generate bakes them into `board.gen.tsx`, so only generate catches up; export says so in its summary); or `out/` was exported from other inputs than the current ones (the built board, what the board depends on in UHD, a body file, the provider's code, a converter version: `tscircuit/export.json` records what each export read, and the message names what changed), or by an earlier provider that kept no such record. What the board depends on is a projection of the board module: its components (part, name, maker, MPN, value, package, pins, bodies and mount frames, the interface ids stripped from bodies), nets, edge and the edge parts' mating frames, and its design envelope; descriptions, prices and documents are not in it, so editing them does not make `out/` stale. The constraints (outline, mounting holes, keep-outs) are fingerprinted with the config. Export is reproducible: the same inputs give the same `board.step` and `board.glb` |
| `CIRCUIT_DRC` | error | an error tscircuit recorded while building, or one `@tscircuit/checks` finds |
| `CIRCUIT_NET_OPEN`, `_SHORT`, `_EXTRA`, `CIRCUIT_UNROUTED`, `CIRCUIT_PIN_MISSING` | error | the copper's nets differ from the UHD nets (core's `netlistDrift`) |
| `CIRCUIT_PAD_UNNETTED` | error | a pin with several pads has pads the copper does not join to its net (boards generated before 0.1.7 netted only the first pad: the smart-bottle and wearable-watch ESP32-C3 ground pads) |
| `CIRCUIT_FINGERPRINT_FORMAT` | info | `tscircuit/export.json` is from a provider that fingerprinted the whole UHD module; such a record is not compared for the board (no false stale) until the next export writes the new format |
| `CIRCUIT_FOOTPRINT_FAMILY` | info | a land pattern chosen by the package's family, its facts agreeing |
| `CIRCUIT_FOOTPRINT_MISMATCH` | error | land patterns of the package's name or family exist but none fits its pin count, pitch or size (reported, not guessed) |
| `CIRCUIT_VIA_TOUCHING_PAD`, `CIRCUIT_VIA_UNDER_BODY` | error | a via whose ring touches an SMD pad / a via inside a courtyard, when `via_touching_pad` / `via_under_body` is `avoid` |
| `CIRCUIT_HOLE_CLEARANCE` | error | copper nearer a non-plated hole's wall than `rules.hole_clearance_mm`, or inside it; round holes are circles, pill holes stadiums, never bounding boxes |
| `CIRCUIT_TRACE_WIDTH` | warning | a net routed narrower than `trace_widths` asks |
| `CIRCUIT_COMPONENT_MISSING`, `_EXTRA` | error | a UHD component is not on the board, or the board has one UHD lacks |
| `CIRCUIT_OUTSIDE_OUTLINE` | error / warning | a pad off the board / a body overhanging the edge |
| `CIRCUIT_KEEPOUT` | error / warning | pads, traces or vias inside a keep-out on its layer / a keep-out off the board or reaching neither copper layer |
| `CIRCUIT_PLACEMENT_MOVED` | error | a part the config fixes is somewhere else |
| `CIRCUIT_FOOTPRINT_UNVERIFIED` | warning | a land pattern the board uses has no verification record against its maker's recommended land pattern, or its pads, pitch, rows, slots, holes, courtyard, paste or mask differ from the record (`verifyEntry`, below); the work order then opens with a hold |
| `CIRCUIT_VIA_RULES` | error | a via whose pad or drill is smaller than `rules.via_pad_mm` / `rules.via_drill_mm` (the router keeps to them; a via written by hand may not). A locked board's KiCad project carries the same minimums as custom rules (`<board>.kicad_dru`), so KiCad's DRC finds them too |
| `CIRCUIT_HAND_PAD_JOIN` | warning | a trace written by hand (in `board.tsx`) joins pads of one pin, which generate joins itself since 0.1.7; in KiCad it becomes copper on no net. Remove it. generate logs the same |
| `CIRCUIT_VIA_IN_PAD` | error / info | a via inside an SMD pad / the same with `via_in_pad: "fill_and_cap"` (the order asks for IPC-4761 type VII) |

Every finding carries a `location` (core's `DiagnosticLocation`): `at` (mm,
board frame) and `points` where it has several, the copper `layer`, and the
`components`, `pads` (circuit.json pad ids), `nets` and other copper `items`
(traces, vias, holes, pours, keep-outs) it concerns; a finding about the whole
board has `scope: "design"`. The PCB view draws findings there.

A pin with several pads (a module's grid of exposed ground pads) is joined pad
to pad by the shortest tree over the SMD pads: a join clear of the part's
other pads is straight copper laid on the built board after routing (so it
cannot change the routing), any other is a routed trace. A pin's plated holes
(a receptacle's shell stakes) are joined by the part's own metal and not by
copper.

A body overhanging the edge is judged by its courtyard as placed (turned
with the part), not its axis-aligned box; a part the native entry lets off the
board (`allowOffBoard`: a mid-mount receptacle in its cut-out) is not reported
for its body, and its pads still are.

The copper netlist is built from `pcb_*` elements only. The connectivity
map's full mode also merges the source intent, which would make an unrouted
net look connected (spike §4).

## Land-pattern table

`lib/land-patterns.ts` (the table), `lib/land-geometry.ts` (the entry format),
`lib/footprints.ts` (lookup and verification). UHD parts state their package
as the manufacturer prints it; which copper fits that package is the
provider's knowledge, kept here and never written into a part. An entry
matches a package by name, and when it says so by pin count, pitch, body size
and maker (`match.manufacturer`, a case-blind prefix of the part's
manufacturer: Murata and Yageo recommend different 0402 lands). Names are
compared without case, spaces, underscores or dashes, and `×` reads as `x`.
An entry's frame is the part's mounting frame, so the copper and the part's
3D body agree.

**Verification.** An authored entry carries a `verification` record: the
document, page and figure it was read from, the date, and the values the
drawing gives, transcribed independently of the pads: pad groups (pins, size
or a range the drawing allows, pitch, row spacing; `merged` for paired
contacts that share one land, drawn as two touching halves so each designator
has a pad), optionally every pad centre the drawing dimensions, plated slots
(drill and ring), round holes (plated with their pad, or not), each with the
centres the drawing puts them at (`at`, so a moved slot or peg is caught), the courtyard,
the stencil (margin, window counts and sizes, coverage, pins with none,
pin-in-paste) and the mask margin. `verifyEntry` compares the copper with the
record; an entry is verified when it has a record and nothing differs.
`circuit:check` reports every land pattern a board uses that is not verified
(`CIRCUIT_FOOTPRINT_UNVERIFIED`), and the board's work order states how many
are verified and opens with a hold while any is not. Built-in footprint
strings cannot be verified (their copper is not stated in the entry).

| Entry | Package (maker) | Drawing |
| --- | --- | --- |
| `yageo-rc0402-reflow` | 0402 (Yageo) | Chip Resistors Mounting, Table 1 |
| `murata-grm15-reflow`, `murata-grm18-reflow` | 0402, 0603 (Murata) | GRM specification sheets, Land Dimensions Table 2: one land inside both tolerance rows |
| `lga-14-3x2.5-p0.5-bosch` | LGA-14 3.0 × 2.5 (BMI270) | BST-BMI270-DS000-08 §8.3 |
| `vson-14-dsj-4x3-p0.5` | VSON-14 DSJ (TPS63020) | 4210895-2/E with its stencil (four windows on the thermal pad), 4208549-3/G |
| `ti-dbv0005a`, `ti-dgs0010a`, `ti-rsm0032b` | SOT-23-5, VSSOP-10, VQFN-32 (TI) | 4214839/K, 4221984/A, 4219108/B (thermal pad stencil 4 × 1.23 mm, 77 %) |
| `microchip-c04-2091-ot`, `microchip-c04-2123b-mc` | SOT-23-5, DFN-8 2 × 3 (Microchip) | C04-2091-OT Rev F, C04-2123B |
| `maxim-90-0065-tdfn8`, `maxim-90-0602-olga14` | TDFN-8 2 × 2, OLGA-14 (Analog Devices/Maxim) | land patterns 90-0065 rev E, 90-0602 rev F |
| `st-sot23-6l`, `st-vl53l4cd-lga12` | SOT23-6L, Optical LGA12 (ST) | DS4260 Figure 19; DS13812 Figure 19 (pads 1:1: ST gives no separate land) |
| `aos-sot23-po00001` | SOT23 (AOS) | PO-00001 rev N |
| `coilcraft-xfl4020`, `epson-fc-135`, `kingbright-aptf1616` | XFL4020, FC-135, APTF1616 | 745-3, FC-135_E_Ver2.0 [7], DSAO4453 |
| `alps-skrt-guide-bosses` | SKRT side-push switch (Alps) | SKRT catalog Drawing No.1 (guide-boss holes Ø0.9 NPTH) |
| `gct-usb4720-midmount`, `gct-usb4105-topmount` | USB-C receptacles (GCT) | USB4720 rev B, USB4105 rev B4 (plated stake slots, tag holes or peg holes, paired contacts on one land) |
| `espressif-esp32-c3-mini-1`, `raytac-mdbt50q` | modules | ESP32-C3-MINI-1 v2.2 Figure 11-1 (3 × 3 ground pads); MDBT50Q-1MV2 Ver. L §2.2 (every pad centre) |
| `eastrising-er-tft128-1-fpc` | ER-TFT1.28-1 FPC tail | the tail's contacts (the maker gives no board land) |
| `qfn-56-7x7-p0.4-ep3.2` | QFN-56 (RP2040, test fixture) | RP2040 datasheet Figure 167; no record yet (unverified) |
| `builtin-0201` … `builtin-1206`, `builtin-sot23`, `builtin-sot23_5`, `builtin-jst4_p1mm_sh` | chip passives and SOT-23 from makers with no entry; JST SH | tscircuit footprinter (built in); unverified |

Authored entries are lists of pads (designator, centre, size; top view, mm),
non-plated holes, plated holes and slots (`drill` in a pad), the courtyard
(`courtyard_mm`, centred on `courtyard_at`), the stencil (`paste`) and the
mask (`mask`). Where the drawing gives no courtyard, mask or stencil the
record says what was used (IPC-7351B nominal courtyard 0.25 mm beyond pads,
holes and body; NSMD mask 0.05 mm; paste 1:1). For built-in entries, generate
checks that the pattern has a pad for every pin designator. A project adds or
overrides entries in `tscircuit/footprints.json`, for a package or one
instance, with the same record (board copper designed in the project cites
the pad part that states it). A part with no package fact, or a package with
no entry, stops generate with a message saying which.

## Routing controls

Constraints in `circuit.config.ts`, beside `layers`, `rules` and `autorouter`:

| Constraint | Effect |
| --- | --- |
| `routing` | `on` (default) or `off`: the board is placed but not routed (`routingDisabled`). Check reports the unrouted nets, unconnected ports and unjoined pads as info, not errors: a placement-only board for review or a hand route |
| `trace_widths` | `{ nets?: { <UHD net id>: mm }, classes?: { signal?, power?, ground?: mm } }`: each net's `nominalTraceWidth` is its own width, else its class's, else the rules' (`power_trace_width_mm` for power and ground nets). A net id the board lacks stops generate. Check reports a net whose narrowest routed segment is narrower than asked (`CIRCUIT_TRACE_WIDTH`, warning: the router necks down where the width does not fit) |
| `via_in_pad` | `avoid` (default; the router keeps vias out of SMD pads, `isViaInPadAllowed` off) or `fill_and_cap` |
| `via_touching_pad` | `allow` (default) or `avoid`: no via ring touching an SMD pad it does not sit in. tscircuit's router has no such rule, so it is checked only (`CIRCUIT_VIA_TOUCHING_PAD`) |
| `via_under_body` | `allow` (default) or `avoid`: no via inside a component's courtyard. Checked only (`CIRCUIT_VIA_UNDER_BODY`) |
| `rules.hole_clearance_mm` | least distance from a non-plated hole's wall to any copper (pads, plated holes, vias, traces, pours). Checked (`CIRCUIT_HOLE_CLEARANCE`); without it, only copper inside a hole is reported. Round holes are circles, not bounding boxes |

## KiCad: preview, lock and unlock

KiCad is the final hand-placement step ([spec](../../docs/specs/pcb-kicad-handoff.md)):
tscircuit is the layout of record while the design changes, KiCad after a
person locks the board.

```sh
protoboard run circuit:kicad  --module <board>   # KiCad 10 project of the current build in tscircuit/kicad/ (a preview)
protoboard run circuit:lock   --module <board>   # the project into <board dir>/kicad/ + handoff.json: KiCad is the layout of record
protoboard run circuit:unlock --module <board>   # kicad/ to kicad-archive/<stamp>/; tscircuit again
```

The project (`lib/kicad/`): tscircuit's `circuit-json-to-kicad` 0.0.237 (MIT)
writes the board, schematic and project from `circuit.json`; the provider
renames components to their reference designators first and sets the part
bodies as export does, then edits the result: the board's own footprint and
symbol libraries (`<board>.pretty`, `<board>.kicad_sym`, `fp-lib-table`,
`sym-lib-table`), bodies copied to `3d/` and linked through `${KIPRJMOD}`,
`MPN`, `Manufacturer`, `LCSC` (from `parts/offers.json`), `UHD_Instance` and
`UHD_Part` on every symbol and footprint, symbols and footprints linked by
UUIDs derived from the instance paths, pads turned with their footprint,
mounting holes as board-only footprints `H1…`, pads that share a netted pad's
number given its net, KiCad's `unconnected-(…)` nets on unconnected pins, a
global label with the board's net on every connected schematic pin (the
converter's wires do not always reach the pins), the config's layers,
thickness, stack-up and edge clearance, and the board frame's origin as the
drill/place origin. `kicad-cli pcb upgrade` / `sch upgrade` then save both in
KiCad 10's format. On the smart-bottle board KiCad's DRC finds no
schematic-parity problem in the exported project, and its ERC only the
board's own power-flag findings.

Reference designators (`lib/kicad/refdes.ts`) are kept per instance in
`tscircuit/refdes.json`: an id that already reads as a designator of its
kind (`r3`) keeps it, others take the kind's prefix and the lowest free
number; a removed instance keeps its designator reserved.

After lock, `circuit:generate` refuses without `--force`, `circuit:export`
makes `out/` with `kicad-cli` (DRC first, into `out/drc.json`; an error stops
the export without `--force`; Gerber and Excellon, the position file re-keyed
by UHD instance, STEP and GLB with the part bodies, SVG renders, the copper
netlist; the BOM from the model; the manifest from the build at lock with
component positions from KiCad), and `circuit:check` compares the model, the
handoff record and the KiCad files (`CIRCUIT_LOCKED`, `CIRCUIT_KICAD_*`, spec
§4). Check runs `kicad-cli sch export netlist` on a copy when KiCad is
installed (it writes nothing into the project) and reads the board file
itself otherwise.

Known limits: the GLB and STEP from KiCad are in KiCad's frame (board bottom at
z = 0, not the mid-plane); a component turned in KiCad keeps tscircuit's
orientation in the manifest; footprints at angles other than right angles may
differ from their library copy (`lib_footprint_mismatch`, a warning).

## In the Manufacturing Package

With @protoboardai/ext-release, `protoboard release` calls `package:work-order`
(`ops/package.ts`) for each unit that builds a board this provider designs.
It adds the board's fabrication and assembly order: quantity, layers,
thickness, copper, surface finish, solder mask and silkscreen, the stack-up
for the layer count, assembly sides and placements from `out/pnp.csv`, the
leadless packages (from the parts' package names) that want a stencil and
X-ray inspection, and the files to send. These order values are optional
constraints in `circuit.config.ts`; the order marks the defaults it used:

| Constraint | Default |
| --- | --- |
| `copper_oz` | the fab's standard (1 oz outer) |
| `finish` | ENIG when any part is leadless (QFN, DFN, LGA, BGA, CSP, SON), else lead-free HASL |
| `solder_mask`, `silkscreen` | green, white |
| `assembly` | `fab` (the fab places from `pnp.csv`); `hand` |
| `fab_notes` | none: a list of notes for the fab, numbered on the order after the provider's own |
| `via_in_pad` | `avoid`: the router keeps vias out of SMD pads, and check reports any as an error; `fill_and_cap` allows them and adds the fill-and-cap note (IPC-4761 type VII) |

The order's own notes come first: a hold while any land pattern the board
uses is unverified (naming them), and the fill-and-cap note when vias sit in
pads under `via_in_pad: "fill_and_cap"`. It also states how many land
patterns are verified and how many vias are in pads.

They do not change the design, but they are inputs to it, so changing one
makes `check` report the board stale until it is regenerated. They are
validated with the other constraints (`copper_oz` a positive number;
`finish`, `solder_mask`, `silkscreen` non-empty strings; `assembly` exactly
`fab` or `hand`; `fab_notes` a list of non-empty strings): `generate` refuses a bad value and `check` reports it as
`CIRCUIT_CONFIG_INVALID`.
`test/package.test.ts` checks the order, and the release's bring-up checks
for a custom board, on the IMU tile.

## Licensing

- tscircuit's libraries are MIT, `@tscircuit/footprinter` ISC (the built-in
  footprint strings are generated locally by it), `circuit-to-svg` ISC.
  `@tscircuit/checks` publishes no licence field or file (spike, Versions).
- **KiCad footprint and 3D-model libraries are not bundled and not fetched.**
  They are CC-BY-SA 4.0; shipping converted footprints as a set inside this
  Apache-2.0 provider would mix a share-alike collection into it. The
  authored entries are drawn from the manufacturers' recommended land
  patterns instead. A user may add footprints they hold the rights to in
  their project's `footprints.json`.
- Component bodies come from the project's own UHD parts, or are boxes.
- `circuit-json-to-kicad` and `kicadts` are MIT (tscircuit). The KiCad skills
  (`kicad-layout-review`, `kicad-cli`) are derived from KiStack (MIT); see
  `NOTICE`. KiCad itself is not bundled: `kicad-cli` is a declared tool.

## Tools and versions

Declared as the tool `tscircuit-node` (`protoboard doctor` probes it with
`lib/probe.cjs`): every tscircuit package is pinned to an exact version in
`package.json`, because they release `0.0.x` versions daily. An upgrade is a
deliberate change, checked by this package's end-to-end test.

- `@tscircuit/core` 0.0.2056, `@tscircuit/checks` 0.0.233,
  `@tscircuit/footprinter` 0.0.430, `circuit-json-to-gerber` 0.0.111,
  `circuit-json-to-gltf` 0.0.141, `circuit-json-to-step` 0.0.43,
  `circuit-to-svg` 0.0.438, and core's peers at the spike's versions.
- `circuit-json-to-gerber` declares the `tscircuit` meta-package (with the
  `tsci` CLI) as a peer. The repository's `.npmrc` sets
  `legacy-peer-deps=true` so that npm does not install it: it is never run,
  and its own nested copies of `@tscircuit/core` broke module resolution in
  the workspace. Missing peers are listed in `package.json` instead.
- **Projects outside the workspace** (installed from the registry, without
  the repository's `.npmrc`) need the workspace's `legacy-peer-deps=true` in
  their own `.npmrc` (some tscircuit packages import `circuit-json` without
  declaring it, so it must be at the top level) and
  `"overrides": { "circuit-json": "0.0.510" }` in `package.json`
  (`@tscircuit/checks` and `@tscircuit/core` take it as a peer; an older
  hoisted copy stops the checks: `CIRCUIT_DRC` "@tscircuit/checks did not
  run"). The templates that use this extension write both; keep the override
  equal to the pin above (`packages/core/test/templates.test.ts` checks the
  templates and examples).
- **Node.** Developed on Node 24.14.1. The full contract (generate, export,
  extract, check of the test board) also passed on Node 22.23.3, although
  `circuit-to-svg` declares `engines.node: 24.x`.
- `tsci` and Bun are not used. tscircuit's route cache is not used either.
  Agents never run `tsci dev`, `tsci build` or `tsci export` on a board this
  provider owns: tsci rebuilds it with another core, re-routes it, and its
  watcher crashes on files generate and export rewrite (seen on a large field
  project). The
  Protoboard viewer shows `out/`. The skill's `references/pcb-workflow.md`
  has the workflow, how to get KiCad files until the provider writes them
 , and the fallback policy.
- One build of the test board (21 parts, 12 nets) takes about 35 s and 1.2 GB.

## Limits

- **Fabrication needs a second DRC.** tscircuit's rules are looser than a
  fab's; the spike found same-net vias 0.1 mm apart and exporter defects that
  only KiCad's DRC reports (spike §6). Defaults here are 0.15 mm traces and
  0.3/0.6 mm vias; review before ordering. Nothing is uploaded or ordered.
- **Routing quality.** Routes are complete, not tidy: detours and many vias.
  Hand polish belongs in `board.tsx` (`<tracehint>`, `<pcbtrace>`).
- **Placement** is hand-assisted: dense boards need `layout.json`.
  Bottom-side parts and model offsets on rotated parts are untested.
- **Bodies.** Only STEP body artifacts are used (GLB-only parts get a box). A
  part's mounting frame is assumed to face −Z with its X axis along the
  footprint's X.
- **Manifest `frame`.** UHD's `GeometryManifest` has no `frame` per feature
  yet; it is written as an extra field, proposed for UHD (spike §9).
- **Fixed placements** are written in the config today; reading them from the
  enclosure's manifest is the `cad` provider's follow-up.
- The test board is a routing and export load, not a reviewed design: see
  the fixture's header comment for what it leaves out.

## Evals

`evals/catch-swapped-nets`: the IMU tile's tscircuit source is hand-edited
(SDA and SCL swapped on the BMI270); the agent rebuilds the board, names the
fault and restores a board that matches the model. Its fixture builds the
board once and the solution twice (about 2 minutes, 1.2 GB per build). `evals/generate-imu-board`: a board never built, with a fault in its model to
catch first. `evals/announce-pcb-fallback`: KiCad files wanted today for a
hand finish, which the provider cannot write yet; the agent must announce
that it is leaving the official path, why and at what cost, record it in the
worklog and as feedback, and leave the model, `out/` and the provider's files
alone. Run them with `protoboard evals --extension tscircuit`; see the
[evals guide](../../docs/guides/evals.md).
