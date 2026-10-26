# Interface bundling: modelled composites between modules

Status: **proposal, nothing built**.
Test case: a large grouped field board (`field-cap-board`), a client project's
board with ten sub-modules.

UHD references are to `@deltarobotics/uhd` 0.2.1 (`src/…`, `docs/…`), the
baseline this stack builds against. Stack references are to this repository.
Builds on [nested-boards.md](nested-boards.md) (grouped boards, exports, net
ports in §12).

## 1. The problem and the decision

Agents link interfaces one at a time. On the grouped field board the ESP32
reaches its ten sub-modules GPIO by GPIO, enable by enable, fault by fault,
and every rail crosses each group boundary as its own port, so the board's
diagram is a wall of parallel single-pin lines.

Decision: **bundling is modelled, not a viewer trick.**
No display-only grouping of parallel links. The model carries composite
interfaces and the diagram shows what is modelled. A few composites per group
carry the same connections: a control interface per group, I2C, SPI and UART
as ports, and one power interface (VBAT, VIN, GND together).

## 2. Measurements

Method: a throwaway script (not in any repo) loads
each project with the stack's own loader (`loadProject(dir, { checks: false,
extensions: false })` from `packages/core`, run with this checkout's `tsx`),
walks the `links` of every local definition that has children, and resolves
each end with UHD's `resolveEndpoint`. A link is a **net membership** (one end
a `Net`; always a single pin, `src/system/nets.ts:53-55`), a **single-pin
link** (both ends one interface, no slots), a **protocol composite** link
(both ends have slots: I2C, SPI…), or a **connector/composed** link (connector
composites or a link-scoped composition). "Parallel connections" between two
children count the signal nets of that level whose members are exactly those
two children, plus single-pin electrical links between them; supply and ground
nets (a stated voltage or a power pin on them) are counted separately. Only
pairs where at least one side is a sub-module are counted: a flat board's
part-to-part nets cannot be regrouped by the author.

| Project, level | Children | Links | Net memberships | Single-pin links | Protocol composite | Connector / composed | Pairs > 3 parallel | Pairs > 5 |
|---|---|---|---|---|---|---|---|---|
| field board `field-cap-board` (grouped) | 11 | 112 | 112 | 0 | 0 | 0 | **3** | 0 |
| field board, its 10 groups (inside) | 6–38 | 365 | 363 | 2 (optical, thermal) | 0 | 0 | n/a (flat) | n/a |
| field board root `field-board` | 3 | 4 | 0 | 4 (optical) | 0 | 0 | 0 electrical | 0 |
| smart-bottle board (flat) | 61 | 254 | 254 | 0 | 0 | 0 | n/a (flat) | n/a |
| smart-bottle root | 11 | 6 | 0 | 2 (mechanical) | 0 | 4 | 0 | 0 |
| wearable-watch board (flat) | 49 | 198 | 196 | 2 (mechanical) | 0 | 0 | n/a (flat) | n/a |
| wearable-watch root | 15 | 9 | 0 | 5 (mechanical) | 0 | 4 | 0 | 0 |
| uno-motor-bench root | 3 | 5 | 0 | 3 (1 mechanical, power + GND) | 2 (I2C) | 0 | 0 | 0 |
| quadcopter-5in root | 37 | 28 | 0 | 10 (mechanical) | 0 | 18 | 0 | 0 |
| quadcopter-5in stack, arm | 3, 3 | 2, 1 | 0 | 1 (mechanical) | 0 | 2 | 0 | 0 |

On the cap board specifically:

- The ten groups export **57 single-pin ports**: 31 signal ports (29 to ESP32
  nets, 2 to `uv_en` between interlock and uv_driver) and 26 rail ports. Every
  group has 2 to 4 rail ports; 5 groups have 3 or more.
- The ESP32 is joined to 9 of the 10 groups by 1 to 5 two-member signal nets
  each (interlock 5, imu 4, tof 4, mcu_support 3, uv_driver 3, usb 2,
  charger 2, ring 2). Two more nets (`uv_fault_n`, `ring_fault_n`) join three
  modules (ESP32, a pull-up in mcu_support, the driver).
- The viewer draws one grouped line per component and net
  (uhd-viewer `src/model/nets.ts`): **89 lines to 36 net junctions** at the
  board level (11 of them GND).
- Counted over every net a pair shares (three-module nets included), more
  than 3 parallel signal nets join 5 pairs and more than 5 join none; with
  rails, 7 and 4.

What this says about agents: the only bundles in these projects are the ones
a physical connector forces (harness ends and `compose` on soldered pads, 28
links) and two I2C links on the bench. Where nothing forces a composite
(board nets, group ports, a sensor's power and ground on the bench), every
connection is single-pin. On flat boards UHD derives buses over the nets
(`src/system/derive.ts`); across a group boundary it does not
(`docs/boards-and-nets.md:335-337`), so a grouped board gets neither.

## 3. What the skills say today

No skill asks for bundling, and none shows an example of it.

- **circuit-board** (`packages/ext-tscircuit/skills/circuit-board/SKILL.md:87-95`):
  "sub-modules group parts so the diagram stays readable … A sub-module's nets
  join the board's through a pin it exports (an export cannot reuse its own net
  id: `gnd_port`); a bus crosses whole, as one link between the two ports
  (`{ a: u1:i2c0, b: sensor:i2c }`)". This is the only composite advice; it
  teaches one port per net, which is the field board's pattern.
- **system-compose** (`packages/ext-hardware/skills/system-compose/SKILL.md:109-112`):
  "Links: `{ id, name, a: { child, interfaceId }, b: { child, interfaceId } }`.
  Only link what the hardware actually connects." Sub-assemblies (`:105-108`)
  export interfaces; nothing on grouping them. Decision table `:216`: "Link
  two interfaces | Only when the hardware connects them".
- **harness-author** (`packages/ext-hardware/skills/harness-author/SKILL.md:44-52`):
  cable ends are connector composites, soldered ends a link-scoped
  composition. The one place agents are told to compose.
- **uhd-part-author** (`packages/ext-parts/skills/uhd-part-author/SKILL.md:185-192`):
  "Connectors are `Connector()` composites"; `:138-147` lists the protocol
  builders. Composites for parts, by protocol or connector only.
- **build-a-project**, **system-review**, **uhd-part-research**,
  **uhd-part-verify**: no mention of composites, ports or bundles.

## 4. What UHD can express today, and what it cannot

**Can:**

- Protocol composites on a part (I2C, SPI, UART, USB, PCIe…): slots with
  protocol sub-roles, paired line by line by the role tables
  (`docs/links-and-buses.md:10-27`, `src/matching/roles.ts`).
- A group exporting a child's composite whole and the parent linking it to
  another composite: copper line by line on a board (nested-boards.md §4.4).
  The field board's two I2C buses could cross this way today.
- Connector composites (`Connector()`, `src/protocols/connector.ts:106`) and
  link-scoped compositions (`compose`, `src/types/module.ts:76-86`), paired by
  position (`src/system/connectors.ts:49-56`). These do group unrelated pads.

**Cannot** (why existing composites do not carry a group's control lines):

| Need | Why not today |
|---|---|
| A composite on a group, over its children's pins | Profile bindings map slots to "interface IDs on the same module" (`src/types/interface.ts:32-33`); a group has no leaves of its own. An export is one child interface (`src/types/module.ts:89-94`); implicit group exports are one per interface (`src/system/index.ts:114-153`). |
| A composite of unrelated signals (enable, fault, ADC sense, NTC bias) | A protocol composite pairs only the protocol and role pairs its table lists, "with no generic fallback" (`docs/links-and-buses.md:26-27`). There is no protocol for "UV driver control". |
| Using a connector composite for it | A connector means a physical connector: type, gender and position checks (`src/system/connectors.ts:59-93`), `harness_connector`, and the stack reads a connector link as a mated daughterboard boundary (nested-boards.md §2 rule 4) and refuses connector links and compositions on a board (§4.4). UHD's own rule: "Use a composition only when the part really has no connector there" (`docs/connectors-and-harnesses.md:98`). |
| Pins already bound by a part's composite (ESP32 GPIO10-13 in SPI2) | Bound leaves are off the module's boundary (`primaryInterfaces`, `src/system/index.ts:51-73`), so a group around the ESP32 cannot export them (the field board keeps the ESP32 ungrouped for this reason). |
| A power bundle (VBAT, VIN, GND) | A net joins leaf pins only (`net_member_composite`, `src/system/nets.ts:53-55`); a module cannot export its own net (`net_not_own`, `:56-57`; exports come from a child). So each rail crosses as its own pin port. OpenUHD #16 (net ports, nested-boards.md §12.1) fixes the per-rail export, not the bundling. |
| `interfaceGroups` | An exclusivity policy over a module's interfaces (`one_of`/`any_of`/`all_of`, `src/types/module.ts:140-145`), not a link endpoint. |

## 5. Proposal

### 5.1 (a) Guidance for the skills

**Rule.** Model the connection between two modules as composite interfaces
when the lines belong together: one bus per bus (I2C, SPI, UART, USB as the
protocol composites the parts already have), one **control bundle** per
module pair for the remaining control and status lines, and one **power
bundle** per module for its rails and ground. Rule of thumb: when more than 3
separate links or single-pin ports join the same two modules, or a sub-module
takes 3 or more rails, they must be bundles; 2 or 3 lines that serve one
function should be one too. A conductor that joins three or more modules
stays a net. The diagram is read from the model; never ask the viewer to
group lines.

Where it goes:

- **circuit-board**, sub-modules paragraph (`SKILL.md:87-95`): replace "a
  sub-module's nets join the board's through a pin it exports" by the rule
  above, with the worked example below; keep the bus link.
- **system-compose**, Links bullet (`SKILL.md:109-112`) and the decision table
  (`:216`): one row "Several links between the same two modules → bundles (a
  bus, a control bundle, a power bundle), linked once each".
- **uhd-part-author**: one line: a part's pins are bundled by the module that
  uses them (a board, a group), not by editing a part; parts keep protocol and
  connector composites only.
- **system-review**: a review item: every pair of modules joined by more than
  3 single-pin links, and every `PB_LINKS_UNBUNDLED`, is either bundled or has
  a recorded reason.
- `diagnostic-codes.md`: the new code.

**Worked example** (the field board's UV driver; the builder is the UHD change of 5.3):

```ts
// src/boards/field-cap/modules/uv-driver.uhd.ts: the group declares its two bundles
interfaces: [
  Bundle({ id: "ctl", name: "UV driver control", lines: {
    pwr_en: ":uv_pwr_en",       // the group's own net: TPS2553D EN pin 3 + its 100 k pull-down (a net line)
    temp: ":uv_temp",           // the NTC divider's mid-point net
    ntc_bias: "uv_r4:pin_1",    // a single pin below the group (a leaf line)
  } }),
  Bundle({ id: "pwr", name: "UV driver power", lines: { vbat: ":vbat", vbat_sw: ":vbat_sw", gnd: ":gnd" } }),
],

// field-cap.uhd.ts: the board links each bundle once
interfaces: [..., Bundle({ id: "rails", name: "Board rails", lines: { vbat: ":vbat", vbat_sw: ":vbat_sw", v3v3: ":v3v3", gnd: ":gnd", /* … */ } })],
links: [
  { id: "uv_ctl", a: { child: "ctl_u1", interfaceId: "uv_ctl", compose: { pwr_en: "pin_34", temp: "pin_11", ntc_bias: "pin_21" } },
                  b: { child: "uv_driver", interfaceId: "ctl" } },
  { id: "uv_pwr", a: { self: true, interfaceId: "rails" }, b: { child: "uv_driver", interfaceId: "pwr" } },
]
```

Before: 8 ports and 8 board-level lines for this group. After: 2 links (plus
`uv_fault_n`, a three-module net, and `uv_en` to the interlock).

### 5.2 (b) Check: `PB_LINKS_UNBUNDLED` (info)

Validator `protoboard/bundling` in core's model checks, over every
**project-local** definition with children and links (never catalog parts).
Two triggers, one code:

1. **Parallel lines.** For each unordered pair of children A, B of module M,
   count the conductors at M's level that join a single leaf of A to a single
   leaf of B: stored links whose two ends are single electrical leaves (not
   composites, nets or bundles), plus signal nets of M whose members are
   exactly A and B. A signal net states no voltage and has no power or ground
   pin. Only pairs where A or B has children count. **Fires when the count is
   more than 3.**

   Message: `<M>: <A> and <B> are joined by <k> separate single-pin
   connections (<ids, first 6>). If they serve one function, model them as a
   bundle on <the side with children> and link it once (docs/specs/interface-bundling.md).`

2. **Separate rails.** For each child S of M that has children, count the
   distinct supply and ground nets of M that S joins through separate
   single-pin links. **Fires at 3 or more.**

   Message: `<M>: <S> takes <r> rails through separate ports (<ports>); carry
   them as one power bundle linked once.`

Entity: the module M and the pair (or S); source: M's file. Info, never a
warning: a reviewer may keep separate lines with a reason (the system-review
item). Excluded: mechanical, optical, thermal and fluid links (the field board's four
optical links cap↔mech are separate paths), flat boards' part-to-part nets
(no author grouping; UHD derives buses there), nets joining three or more
children.

What it reports today (simulated with a throwaway script): on `field-cap-board`,
3 pairs (ESP32↔interlock 5, ↔imu 4, ↔tof 4) and 5 groups (mcu_support,
charger, reg_3v3, interlock, uv_driver); with "more than 5" it would report
no pair, which is why N is 3. On the four examples: nothing.

### 5.3 (c) UHD change: bundle interfaces

Proposed for OpenUHD as one change (it subsumes the net-port half of #16 for
bundles; #16 stays useful on its own for single nets).

**Type.** A bundle is an `InterfaceDef` with protocol `{ type: "bundle",
roles: ["side"] }`, one slot per line (`required: true`, `match: {}`) and one
profile whose bindings are the lines. Builder `Bundle({ id, name, lines,
domain? })` in `src/protocols/bundle.ts`. A line's value is one of:

- a leaf below the declaring module: `"u2:pin_4"` or a deeper path
  `"sub/u2:pin_4"` (resolved like `compose` values, `resolveBelow`,
  `src/system/index.ts:208-219`), **bound leaves included** (a line is a
  conductor, not an outline interface, so `primaryInterfaces` does not apply);
- a net the declaring module declares: `":vbat"` (a **net line**).

This is the one relaxation of `InterfaceProfile.bindings`
(`src/types/interface.ts:32`): for protocol `bundle` only, a binding may be a
path below the module or an own net. Every other composite keeps
same-module ids.

**Endpoints.** A bundle is a primary interface of its module, so the parent
links `uv_driver:ctl` without an export, and a group may re-export it like any
interface. On a part that cannot be edited (a catalog ESP32), the link end
composes one: `compose` against a bundle end makes a bundle (today a
composition always makes a `connector`, `src/system/index.ts:225-243`); its
keys are the other end's line ids.

**Pairing.** A link between two bundles pairs lines **by line id** (`childLinks`
overrides, as for connectors, `src/system/connectors.ts:49-56`). Each pair is
one conductor:

- leaf with leaf: validated as a pin pair (`validateResolved` on the two
  leaves): a digital output against an input is fine, two outputs is
  `link_incompatible`;
- net line with a leaf or net line: the leaf is a member of the net, or the
  two nets are one conductor (the nested-boards §5 alias rule; within one
  module two nets joined stays an error);
- a line with no partner: `bundle_unpaired` (warning) when it is on a bundle
  whose lines are leaves; a bundle made only of net lines (a board's `rails`)
  may be linked by bundles that use a subset of its lines, and is reported
  only for lines of the other side it lacks.

**Rules kept.** A bundle linked to a net or to a single pin is an error (like
`net_member_composite`). A bundle is never a connector: no type, gender or
position checks, no `harness_connector`, and the stack never reads a bundle
link as a board boundary. A bundle may be carried by a harness only through
connector composites, as today.

**Derivation.** `deriveLinks` (`src/system/derive.ts:189`) adds each line pair
as a conductor edge (as it does for connector positions and nets), and walks
from a parent net into a child's net through a net line. Then the IMU's I2C
link and the ESP32↔TPS2553D enable are derived across the group boundary,
closing the known gap of nested-boards.md §4.3 and `docs/boards-and-nets.md:335-337`.

**Docs and tests.** `docs/boards-and-nets.md` gains "Bundles across a
boundary"; fixtures: a group with a control bundle and a power bundle, a
composition against a bundle on a part, an unpaired line, two outputs paired,
a bundle linked to a net.

**Stack changes that follow (not UHD):** `boardNetlist` unions each line
pair's conductors (`packages/core/src/board-netlist.ts`); a bundle is never a
boundary in rule 4 (nested-boards.md §2); the viewer draws a bundle link as
one line whose lanes are its lines, like a composite link today.

### 5.4 (d) Eval case outline

`packages/ext-tscircuit/evals/bundle-group-control/case.ts`, skills
`circuit-board`, `system-compose`.

- **Fixture:** a small grouped board (not the field board, which is a client's and cannot ship): an
  MCU module on the board plus three groups (a load switch with enable, fault
  and current sense; a sensor with I2C, interrupt and a rail switch; a
  regulator), and a fourth group's parts present but not connected.
- **Instruction:** connect the new group (a second load switch) to the MCU and
  the rails as `docs/board.md` describes, done when check is clean. It does
  not mention bundles.
- **Graders:** `check` with no errors and `PB_LINKS_UNBUNDLED` absent;
  `text` on the board file: the group declares `Bundle(` and the board links
  it once; `script`: the expanded netlist equals the expected pin sets (the
  same compare as 5.5); `digest`: parts and the three existing groups
  untouched.
- **Variant (remodel):** the fixture's three groups use single-pin ports;
  the instruction asks to make the board readable at group level without
  changing any part or connection; graders as above, plus the netlist
  unchanged.

### 5.5 (e) Acceptance: the field board

The test case, after 5.3 and the stack changes land (the field board is read only
until then):

1. **Remodel without moving any part.** Per group: a power bundle linked to the
   board's `rails`; a control bundle to the ESP32 (composed on `ctl_u1`) for
   mcu_support, usb (D+/D-: the series resistors sit between, so it is a
   bundle, not the USB composite), charger, imu (INT1/INT2), ring, uv_driver,
   tof, interlock; the two I2C buses as composite links (`ctl_u1:i2c0` ↔
   `imu:i2c`, possible today); `uv_en` (interlock↔uv_driver) as a one-line
   bundle or a net. `uv_fault_n` and `ring_fault_n` join three modules and
   stay board nets. Expected board level: about 30 lines instead of 89
   (estimate: 10 power links, 11 bus and control links, the two fault nets,
   the ESP32's own 3V3 and GND, the two UART test-pad nets).
2. **Readable at group level:** `protoboard dev`, capture the board level and
   each group, pan and zoom (visual-verification rule); each group shows its
   bundles, not its pins.
3. **Same parts and nets, proved with the stack:**
   - `boardNetlist` before (git HEAD) and after: the same 137 components by
     instance path, MPN and value, and the same 86 conductors by pin set
     (`<instance>.<pad>`); names may change. This is the comparison made
     by hand for the field board's regrouping; it becomes a script in the circuit-board skill (`scripts/netlist-diff.ts
     --base <ref>`), also used by the eval.
   - `protoboard run circuit:check --module field-cap-board`: no
     `CIRCUIT_NET_OPEN`, `CIRCUIT_NET_SHORT`, `CIRCUIT_NET_EXTRA` or
     `CIRCUIT_PIN_MISSING`. The board is locked to KiCad, and `netlistDrift`
     compares the model's pin sets with the copper of record
     (`packages/core/src/board-netlist.ts:651`), so this proves the remodel
     against the routed board, independent of net names.
   - `protoboard check`: no new errors; `PB_LINKS_UNBUNDLED` absent;
     `UHD_BUS_PULLUP` now runs on both I2C buses (derived across the boundary).

## 6. Not doing

- No viewer-only grouping of parallel links, no "collapse lines" display
  option, no `display` hints that merge links. The diagram shows the model.
- No bundling inside parts: catalog parts are immutable; bundles live on the
  board, group or system that uses the pins.
- No connector composites or compositions as a stand-in for bundles.
- No automatic regrouping by the stack: the check hints, the author models.
- No check on flat boards' part-to-part nets.

## 7. Open questions

- The name: `bundle` (and `Bundle()`) shares a word with the UHD bundle file
  format (`src/types/bundle.ts`); alternatives: `port`, `signal_group`.
- N = 3 for the check, or 2 (it would add mcu_support and uv_driver).
- Whether the remodel moves the two fault pull-ups out of mcu_support into
  uv_driver and ring, so the fault lines join the control bundles.
