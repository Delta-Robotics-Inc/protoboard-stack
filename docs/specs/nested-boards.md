# Nested boards: sub-modules on one PCB

Status: spec for Stack 0.1.7, built there (nested UHD modules were not read by
the provider before). Built on the
reference designators (pcb-kicad-handoff.md §2.1).

UHD references below are to `@deltarobotics/uhd` v0.2.1 (`src/…`, `docs/…`),
except where a section says 0.3.0. **Updated for UHD 0.3.0 (Stack 0.2.0):** net ports (§4.2), the board marker (§2 rule 3), derivation
through ports (§4.3), and what that changes in §5, §10–§12.
Protoboard references are to this repository. Everything here is a
Protoboard convention for reading UHD; nothing changes UHD. Where UHD is
silent this spec says so (**UHD is silent**) and states the smallest
convention; UHD changes worth making are listed separately in §12.

## 1. The problem

A UHD board module's children are its components (`docs/boards-and-nets.md:60`,
"Components are children, the same `ChildModuleRef`s any assembly uses").
Engineers group parts into sub-modules ("power stage", "UV driver") so the
system diagram stays readable: the viewer drills into a sub-module and shows
its exports as sheet ports.
Until now `boardNetlist` (core `src/board-netlist.ts`) read only the direct
children as parts, so a sub-module became one pinless "ic" and its parts
vanished from the PCB. A large field project kept a grouped twin for the
diagram and a flat copy for the PCB (`flattenBoard`), and `check`,
`circuit:check` and `release` saw different boards.

After this change a board may be grouped to any depth; the circuit provider,
`check` and `release` read the **same expanded board**, and a flat board
reads exactly as before.

## 2. Which children are expanded

`boardNetlist` classifies every child of the board, and recursively every
child of an expanded sub-module, by the first rule that applies
(`boardChildRole`, core `src/board-netlist.ts`):

| # | The child is | Role | Why (UHD) |
| --- | --- | --- | --- |
| 1 | `kind: "harness"` | **harness**: never expanded. Without children it is read as today (a component, when its pins have designators); with children it is a boundary (§2.1). | A harness is "a physical carrier of interface links between modules (cable, bus backbone…)" (`src/types/module.ts:62-65`); derivation walks its conductors, it never treats its contents as parts (`src/system/derive.ts:229-245`). |
| 2 | a definition that states a **package** (mechanical domain `package`) or a **`part_number`** | **part**, placed whole, even when it has children (a bought module modelled with its contents) | A component is what has a package and pin designators (`docs/boards-and-nets.md:27-33`, `:283-309`); a part number is what is ordered. |
| 3 | a definition marked **`kind: "board"`** (UHD 0.3.0, `isBoard`), one the project binds to a `circuit` provider, or one that states a **`design_envelope`** trait | **board**: a separate PCB, a boundary | `design_envelope` is "what the design must fit, before any layout exists" on *the board* (`docs/boards-and-nets.md:164-179`): it marks a PCB to be designed. A circuit binding is the project saying the same. |
| 4 | joined at its parent by a **connector link** (a stored link whose two ends resolve to `connector` composites, one of them on or below this child) | **mated**: a daughterboard, a boundary | Two connectors that mate are on two bodies: a link between connectors "mates positions" (`docs/connectors-and-harnesses.md:60-72`). Two connectors on one PCB do not mate. |
| 5 | `kind: "group"`, or a definition with children | **sub-module**: expanded, its parts placed on this board | A group is "an organisational module" (`src/types/module.ts:58-61`); a module with children is an assembly of them (`docs/architecture.md` §2.4, the fractal hierarchy). |
| 6 | anything else | **part** (as today: a part without a package still fails generate with "states no package") | |

Rules 3 and 4 run before rule 5, so a child board or a daughterboard that has
children is never flattened into this PCB. `kind: "board"` is read first in
rule 3 and needs no children; the binding and `design_envelope` stay as
fallbacks for definitions written before UHD 0.3.0. Rule 2 runs before 3 and 4: a
bought module with a part number is a part even when it carries a body of its
own (an ESP32 module).

**UHD is silent** on what "a sub-module of a board" is: UHD has no notion of
"on the same PCB". Rules 3–5 are the Protoboard convention; rule 4 is the one
that follows from UHD alone.

### 2.1 Boundaries

A boundary child (a harness with children, a child board, a daughterboard) is
not on this PCB: none of its parts become components. It is listed in the
netlist's `boundaries` (instance, module, reason). A net of this board that
reaches into a boundary (a membership link to a child board's export, say) is
an error: a separate board joins this one only through a connector on this
board, mated to the other board's connector by a connector link.

## 3. Instance paths

A part inside sub-modules is identified by its UHD canonical path below the
board, `<sub-module>/…/<part>` (`formatPath`, `src/system/index.ts:28-37`):
`power/u1`, `led1/r1`. A part of the board itself keeps its id (`u1`), so a flat
board's instance ids are unchanged.

Every keyed output uses the path: `bom.csv`, `pnp.csv`, `netlist.json`
(`<instance>:<interface>`), the manifest's features, the GLB node names and the
STEP item names, the name map (`build.json`), `refdes.json`, `layout.json` and
`placements` keys, the KiCad `UHD_Instance` field and the handoff record.

The native (tscircuit) component name is `safeName(path)` (`led1_r1`), with
`_` appended on a collision (`a_b/c` and `a/b_c`); the name map records the
path.

## 4. Nets across the sub-module boundary

### 4.1 One conductor, read at every level

Each module in the expanded tree contributes its own links, read in its own
scope, exactly as a flat board's links are read today:

- **membership links** (pin → a `Net` the module declares; `netLinks`,
  `src/protocols/net.ts:51-70`) and **pin-to-pin links** join pins;
- an end is resolved with UHD's `resolveEndpoint` (`src/system/index.ts:183-201`),
  which follows exports down to the part that owns the interface. A net member
  may be "an interface or export of a direct child" (`src/protocols/net.ts:52-53`),
  so a parent's net reaches a part inside a sub-module through the sub-module's
  export.

The conductors of the board are the union of all of these (union-find over
pins `<instance>:<leaf>` and nets `<module path>:<net>`). Nothing else joins
two pins: two nets with the same id in two modules are two nets, as in UHD.

### 4.2 Exported and aliased interfaces

| At the sub-module | At the parent | Result |
| --- | --- | --- |
| a declared export of a **pin** (`exports: [{ id: "vin", from: { child: "u1", interfaceId: "pin_5" } }]`) | a membership link `power:vin → :v5` | `power/u1:pin_5` is on `v5` |
| a `kind: "group"` child's **implicit export** `<child>__<interface>` (`src/system/index.ts:114-153`) | `power:u1__pin_5 → :v5` | the same |
| the exported pin is also on the sub-module's **own net** (`Net "v5"` inside `power`, with `u1:pin_5`, `c1:pin_1`) | `power:vin → :v5` | one conductor: `power/u1:pin_5`, `power/c1:pin_1` and the parent's pins. The sub-module's net is an **alias** of the parent's (§5). This is UHD's idiom for a net shared across children (as a large field project's groups use it): the pin on both nets is the hierarchical port. |
| an export of an export (a sub-module re-exporting its own sub-module's pin) | any | followed to the part, at any depth |
| an export of a **composite** (an I2C port, a USB connector) | re-exported at the board edge | the edge entry lists the part's leaves (`usb/j1:pin_a6`, …) |
| an export of a composite | linked by the parent to a net, or to a pin | an error, as on a flat board: a net joins leaves (`net_member_composite`, `src/system/nets.ts:53-55`) |
| an export of a functional composite (the sensor's `i2c`) | linked directly to another functional composite (the controller's `i2c0`) | copper, line by line as UHD pairs the two ports (§4.4) |
| the sub-module's own `Net` | a link from the parent to `power:v5` | an error: a net joins pins on the module that declares it (`net_not_own`, `src/system/nets.ts:56-58`) |

**Net ports (UHD 0.3.0).** A module may export its own `Net`:
`exports: [{ id: "vdd", from: { self: true, interfaceId: "vdd" } }]`. The port
may take the net's id. At the parent it is linked as a pin is: a membership
link to a parent net, or a pin linked straight to the port. The board netlist
reads either as one more union-find edge to the sub-module's net
(`<path>:<net>`), at any depth and through re-exports, so the conductor,
its name and its aliases are what the exported-pin idiom below gives (the
provider's test holds the lamp fixture to the same netlist digest and the
same generated source both ways). A child's net reached without a port is
still `net_not_own`. A net port on the board's own edge is an edge entry
whose pins are the whole conductor (`edge[].net` names it; `instance` is the
module declaring the net, `""` for the board). Prefer net ports in new
definitions; the idiom below keeps working.

Before UHD 0.3.0, **UHD was silent** on exporting a module's own net (an
export came from a child), so a net reaches the parent through one of its
pins. And UHD decides which pins can be that port: only a module's
**primary** interfaces are on its boundary, and a pin bound into a composite
(the sensor's SDA inside its `i2c` port) is not (`primaryInterfaces`,
`src/system/index.ts:51-73`; power and ground pins stay primary). An export id
cannot repeat one of the module's own net ids either (`define-module.ts:39`), so
the port of net `vdd` is named otherwise (`vdd_port`, say). §12
recommends a net port.

### 4.3 Functions, power and ground, buses

- **Functional links** are derived by UHD per module, over the nets that module
  declares (`docs/boards-and-nets.md:181-234`, Limits `:335-337`). At the
  parent, derivation sees nested pads (`ownerPath` `power/u1`; "Parts may be
  nested", `src/system/derive.ts:40`), so a parent net joining the MCU's SDA to
  `sensors/imu:pin_1` derives the I2C link across the boundary. A bus wholly
  inside a sub-module is derived when the sub-module is checked: core checks
  every module that declares nets (`boardModules`, core `src/project.ts:360-383`).
- **Power and ground** are nets like any other: `gnd` at the board joined to
  each sub-module's `gnd` through an exported ground pin is one conductor. A
  net is a rail (`isPowerNet`, `isGroundNet`) by the pins on the whole
  conductor.
- **Closed by UHD 0.3.0 for net ports.** A bus line that crosses as a net
  port (the sub-module ports its `sda` and `scl` nets, the parent joins them
  with nets) is derived at the parent by UHD's `checkSystem`. A line that
  crosses as some other pin of the line (a pull-up resistor's, which is
  primary) is still not derived at either level: port the net instead, or
  use the bus link of §4.4.

### 4.4 Buses

Because a bus pin is not on its module's boundary (§4.2), a bus crosses into a
sub-module **whole**: the sub-module exports its port (`i2c`), and the parent
stores one direct link between that port and the other end's
(`{ a: u1:i2c0, b: sensor:i2c }`), the "direct 1:1 connection between two
interfaces" of `src/types/module.ts:110-114`. UHD validates it like any stored
link (`validateLink`, `src/system/index.ts:322-329`): the roles must pair
(controller with target) and the slots pair line by line (`LinkResult.children`:
SDA with SDA, SCL with SCL). The board reads each pair as copper: the
controller's SDA, the sensor's SDA and whatever the sensor's own `sda` net holds
(its pull-up) are one conductor, named by that net (`sensor:sda`).

- A link UHD finds incompatible (two controllers, an I2C port to a UART) is an
  error that quotes UHD's reason; a slot left unpaired is a warning.
- A link between connectors, a link-scoped composition, a link carried by a
  harness and a composite linked to a pin stay errors, as on a flat board.
- **This changes flat boards too**, deliberately: a direct link between two
  functional composites was refused on any board ("a board netlist needs leaf
  pins"); it is now copper on every board, one rule at every level. No example
  board has one, so none changes. Where a board also states nets for the same
  lines, they must agree, or the nets are reported joined.

The fixture `packages/ext-tscircuit/test/fixtures/nested-board` carries its
I2C bus from the controller on the board into the `sensor` sub-module this
way.

## 5. Net naming

- A conductor takes the id of its **shallowest declared net** (fewest path
  segments; ties broken by the canonical path). A board net keeps its id, so a
  flat board's net ids are unchanged.
- A conductor whose nets are all inside sub-modules takes the UHD canonical
  path of its net: `led1:k` (the interface `k` of instance `led1`,
  `src/system/index.ts:28-37`), name `led1/K`. A net declared only by
  pin-to-pin links takes the first link id, prefixed by the storing module's
  path: `led1/link_7`.
- The other declared nets on the conductor are its **aliases** (`aliases`,
  only when there are any), e.g. `gnd` with aliases `led1:gnd`, `led2:gnd`.
- **Two nets of one module joined** (directly, or through a sub-module that
  exports two pins of one of its nets) is an error, the rule a flat board has
  today ("nets a, b are joined by links into one conductor"). Two nets of
  different modules joined is the hierarchy working.
- **Design voltage**: the shallowest net that states one. A net of another
  module on the same conductor stating a different voltage is an error; a net
  that states none takes the conductor's.
- **Collisions** cannot happen between canonical paths. In the native design,
  `safeName` turns `led1:k` into `led1_k`; a collision gets `_` appended (as
  today). KiCad prints the same name; the netlist comparison normalises names
  (`/led1/k`, `led1:k` and `led1_k` are one name), so a hierarchical KiCad
  name would compare equal too.

## 6. Reference designators

Track D's scheme (pcb-kicad-handoff.md §2.1), extended:

1. An instance already recorded keeps its designator.
2. **Moved** (new): a new instance whose last path segment equals that of
   exactly one recorded instance that is no longer on the board, with a
   designator of its kind, takes that designator (and the old path leaves the
   record). Moving `r3` into `power/` keeps `R3`; ungrouping keeps it too.
3. A new instance whose **last path segment** reads as a designator of its
   kind (`led1/r1` → `R1`) gets it, when free.
4. Otherwise the kind's prefix and the lowest free number, new instances in
   path order.

Designators are unique across the whole board (one `taken` set). A definition
used twice gives two sets of designators: `led1/r1` → `R1`, `led2/r1` → the
next free `R` number, each recorded once and never renumbered. Adding a part to
one group does not renumber another: nothing recorded is ever reassigned.

Not adopted: KiCad's per-sheet hundreds (`R101`, `R201`). They tie numbers to
the grouping, which then cannot change without renumbering; the record already
keeps numbers stable. It stays an open option (§14).

## 7. Placement

UHD has no layout ("Layout itself is never UHD", `docs/boards-and-nets.md:179`),
so this is all provider convention (`circuit.config.ts` `placements` and
`tscircuit/layout.json`, both keyed by instance path):

- A key may name a **sub-module path** (`led1`): `{ at, rotation_deg, side }` is
  the sub-module's **frame** on the board (its placement group).
- A part inside a sub-module that has a frame is placed **in the sub-module's
  coordinates**: board = frame ∘ part. Rotation adds. A frame on the bottom
  turns the sub-module over about its own Y axis (as KiCad flips a group): a
  part's x is mirrored, its rotation negated and its side swapped. Frames
  compose through nested sub-modules.
- A part inside a sub-module without a frame is placed in board coordinates,
  as today.
- A part with no placement is placed by tscircuit, as today (not clustered by
  sub-module; a follow-up, §13).
- `placements` (config) wins over `layout.json` for the same key, as today. A
  key that names neither a component nor a sub-module is a problem
  (`placements`) or a note (`layout.json`) that names the path ending with the
  same id, if there is one (a part that moved into a group).

## 8. KiCad

**PCB.** One KiCad group per sub-module instance, named by its path (`led1`),
nested as the sub-modules nest (a group's members are its parts' footprints and
its sub-modules' groups). Group UUIDs are derived from the board and the path,
so a re-export writes the same ones. Moving a group in KiCad moves its parts.

**Schematic: flat, one sheet, one block per sub-module.** The provider lays
the sheet out itself (pcb-kicad-handoff.md §2.2): a framed block per
sub-module, titled by its path and name, with its ICs first and their
passives beside them. Every symbol carries `UHD_Instance` (the path) and,
inside a sub-module, `UHD_Group` (the sub-module's path); every connected pin
has a short stub and a global label named by the conductor's net. Why not
hierarchical sheets:

- Reusing one sheet file for two instances of a definition needs
  per-instance references in the sheet's `instances`, and the converter (no
  longer used for the schematic) had no sheets to start from.
- The handoff reads one schematic file (`readSchematicParts`), and the pin
  labels make the schematic's nets the board's (pcb-kicad-handoff.md); sheets would need
  hierarchical labels and pins in their place.
- What a sheet adds over the fields is the drawing. KiCad's symbol fields table
  groups by `UHD_Group`; the PCB groups carry the structure where it is used.

Hierarchical sheets per sub-module remain a possible follow-up; the blocks
give the same reading on one sheet.

## 9. Fingerprints, staleness and comparisons

`boardNetlist` is the one projection every consumer reads:

- the build's `netlistDigest`, `generate`'s stale build, `circuit:lock`'s
  refusal of a changed model;
- the export record's board fingerprint (`boardProjection`) and
  `CIRCUIT_STALE`: a regrouping changes instance paths, so the outputs keyed
  by them are stale, as they should be;
- the netlist drift of `circuit:check` and the KiCad comparison of a locked
  board (model, record, KiCad), by instance path and `<instance>.<pad>`.

New keys appear only on a board that has sub-modules or boundaries
(`components[].group`, `groups`, `boundaries`, `nets[].aliases`, `notes`), so a
flat board's projection, digests, generated source and outputs are byte for
byte what they were. The test `nested-boards.test.ts` holds the examples'
generated sources and netlists to that.

## 10. What check, circuit:check and release see

All three read the same tree and the same expanded board:

- **`protoboard check`**: UHD's `checkSystem` on the root and on every module
  that declares nets, sub-modules included (core `boardModules`); and each
  provider's check, so `circuit:check` over the expanded board. A board's
  own `unpowered` findings are skipped (its edge is fed from outside, which
  the system check decides), except UHD 0.3.0's `unpowered:<child>:<port>`:
  a sub-module's supply net port that nothing on the board feeds is the
  board's question.
- **`circuit:check`, generate, export, kicad, lock**: the expanded netlist; its
  warnings (§11) are `CIRCUIT_BOARD_GROUPING`.
- **`release`**: a sub-module instance on a board is a `group` row in the unit
  BOM (built with the board: not bought, not an assembly of its own); its parts
  are board components (spares, the provider's `bom.csv` row found by the path
  below the board). The ordering list is unchanged in kind.
- **firmware** (`boardFirmware`): the controller and its buses are found among
  the expanded components.
- **standard outputs**: `bom.csv` must have a row for every expanded component.

## 11. Error cases

Errors stop `generate`, `kicad` and `lock` (`netlist.problems`) and are
`CIRCUIT_BOARD_UNREADABLE` in `circuit:check`; warnings are `notes`
(`CIRCUIT_BOARD_GROUPING`).

| Case | Severity | Behaviour |
| --- | --- | --- |
| A sub-module with no parts (a `kind: "group"` with no children, or whose children are all boundaries) | warning | "contributes no parts to the board" |
| A declared export of a sub-module that its parent neither links nor re-exports, and the child does not mark `unconnected` (`ChildModuleRef.unconnected`, `src/types/module.ts:34-43`) | warning | "led2 exports en (led2/u1:pin_4), which led-board leaves unconnected; mark it unconnected on led2 if that is intended". Implicit group exports are never reported (every unlinked pin is one). |
| A sub-module used twice | fine | two sets of parts, paths `led1/…` and `led2/…`, distinct designators, distinct inner nets (`led1:k`, `led2:k`) unless an exported pin joins them to a parent net |
| `quantity > 1` on a sub-module | error | "a board places each part: give each copy its own child" (UHD: "Use separate children when units connect differently", `src/types/module.ts:15-18`) |
| A link to a sub-module's own net that it does not export as a net port | error | `net_not_own`, with the fix (export a net port) |
| A sub-module's net port its parent neither links nor re-exports | warning | as an unconnected pin export, "(a net port, `<child>:<port>`)" |
| A sub-module's supply net port that nothing on the board feeds | warning | UHD `unpowered:<child>:<port>`, reported by `check` at the board (§10) |
| A net reaching into a boundary child | error | §2.1 |
| Two nets of one module on one conductor | error | §5 (as flat boards today) |
| Declared voltages that differ on one conductor | error | §5 |
| A definition that contains itself | error | "nested more than 16 deep (a definition that contains itself?)" |
| A part in a sub-module without a package, an unknown definition, a pin without a designator | error | as on a flat board, with the path |

## 12. UHD changes recommended (made in UHD 0.3.0)

All three were released in UHD 0.3.0 (OpenUHD #16) and the stack reads them
from Stack 0.2.0: net ports (§4.2), derivation through them (§4.3) and the
board marker (§2). What remains a stack convention: the exported-pin idiom
(still read), the stack's own check of declared voltages that differ on one
conductor (§5; UHD's `net:<net>:port_voltage:<nested>` now reports the same for
ports, so both may appear), and the union-find check of two nets of one module
joined. Open: a `circuit`-bound module that is not marked `kind: "board"`
could get a `check` hint; whether UHD should refuse copper between two
boards' nets.

The original recommendation follows.

1. **Net ports.** Let a module export its own `Net` (an `InterfaceExport` whose
   `from` is `{ self: true, interfaceId }`), so a parent joins the sub-module's
   net, not an arbitrary pin of it. Today the exported pin is the port, and the
   choice of pin is arbitrary but visible to derivation (§4.3).
2. **Derivation through net ports.** With (1), let `deriveLinks` walk a parent
   net into a child's net, so a functional link whose pads sit on both sides of
   a boundary is derived once, at the parent, whatever pin is exported (the
   §4.3 gap; `docs/boards-and-nets.md:335-337`).
3. **A board marker.** Rule 3 relies on `design_envelope` or the project's
   binding. A `kind: "board"` (or a `pcb` trait) would say "this module is one
   PCB" without either, and would let UHD's own checks refuse a part spanning
   two boards.

## 13. KiCad follow-ups from the PCB handoff (defaults)

- **Board frame for KiCad's bodies.** KiCad's `pcb export step` and `glb` use
  the board frame in X and Y (drill origin, Y up) but put z = 0 on the board's
  bottom face; the stack puts it on the mid-plane (tscircuit's convention,
  `lib/layout.ts`). A locked board's `board.step` has each top-level placement
  of its assembly moved down by half the board's thickness (KiCad's own, from
  the `.kicad_pcb`), and `board.glb` gets one root node doing the same; GLB
  nodes are named by instance path and the export date is dropped, so an
  unchanged board exports the same files. Top-side parts then sit at
  +t/2 (KiCad seats them 5 µm lower than tscircuit's surface).
- **Parts turned in KiCad** carry KiCad's position and orientation into
  `board.manifest.json`: the component's feature and the features of the board
  exports it carries are moved and turned about the part's origin. A part moved
  to the other side in KiCad keeps tscircuit's side, with a note.
- **`circuit:lock` is all or nothing.** The KiCad project, the designators and
  the handoff record are written to a staging folder, read back there, and
  moved into the project only when every step has succeeded.
- **DRC errors** still stop a locked board's export unless `--force`; the
  message names the first errors, how to fix them in KiCad, and the command to
  export anyway. A drill file KiCad writes with no tool (no unplated holes) is
  left out.

## 14. Open questions

- Per-sheet designators (`R101`) instead of the record (§6).
- Auto-placement clustered by sub-module (tscircuit `<group>` packing) and
  layout reuse across instances of one definition (place `led-channel` once).
- Hierarchical KiCad sheets when the converter supports nested, reused sheets.
- The bus link of §4.4 makes a direct composite-to-composite link copper on
  flat boards too; confirm.
- A part's LED or transistor gets `U` (the handoff's prefixes have no `D` or `Q`).
