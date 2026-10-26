# Tool integrations: capabilities, providers and the UHD boundary

Status: agreed; built. Extends
[the UHD boundary](uhd-boundary.md) and [the architecture](architecture.md).

UHD is an open-source hardware description protocol. It must stand on its own: a UHD
file and its artifacts describe the hardware without naming the tools that
produced them. Protoboard integrates engineering tools (PCB, CAD, firmware,
fabrication) as **swappable providers** of a small set of **capabilities**.
Swapping a tool means installing another provider of the same capability, not
changing UHD or the projects built on it.

## 1. The rule

**UHD holds only facts that are true of the hardware whatever tool is used:**

- modules, interfaces, protocols, ratings and rails;
- links between them (a board's nets are links between its components);
- pin designators (`pin`, such as `42` or `A7`) on leaf interfaces;
- intrinsic physical facts about a part: body dimensions, mass, material,
  package name as the manufacturer states it (for example "QFN-48 6×6 mm");
- mechanical frames, mates, bolt patterns, fastener stacks;
- artifacts as references, with a format, role, units and provenance (a
  tscircuit source, a KiCad project, an Onshape document URL, a STEP file).

**UHD never holds tool knowledge:**

- footprint or land-pattern names, symbol or library references;
- layer stacks, copper rules, routing, placement;
- CAD feature trees, sketches, document or element ids;
- any field named after a tool (tscircuit, KiCad, EasyEDA, Onshape, build123d).

That knowledge belongs to the provider that needs it and is stored in the
provider's own files inside the project (section 4).

The test from the boundary document still applies: *could someone with only a
UHD file and its artifact files use this, without running any tool?* If a
datum only means something to one tool, it is not UHD.

## 2. Capabilities

A capability is a contract that any number of providers can implement. The
first two:

| Capability | Owns | First provider | Later providers |
| --- | --- | --- | --- |
| `circuit` | Turning a UHD board module (components as children, nets as links) into a manufacturable PCB, and reporting back what the board is | `@protoboardai/ext-tscircuit` | KiCad, EasyEDA |
| `cad` | Generating geometry for a custom mechanical module (plate, enclosure, cap, case) from the UHD interfaces it must hold, and reporting back where those interfaces are | `@protoboardai/ext-enclosure-cad` (build123d), `ext-frame-cad` | Onshape, Zoo |
| `firmware` | Configuring the firmware of a board's controller (pins, buses, devices, buttons, wake sources, clocks) from the board's nets and part facts, every setting citing the facts it comes from | `@protoboardai/ext-zephyr` (nRF52840), `@protoboardai/ext-esp-idf` (ESP32-C3) | other RTOSes and SoCs |

Existing extensions that already fit the pattern: `ext-frame-cad` (plates),
`ext-harness-cad` (routed wire harnesses). Later capabilities follow the same
shape: `fabrication` (printers, fab houses), `test`. `firmware` was added
later (section 8).

Every provider implements the same four operations for its capability:

| Operation | Input | Output |
| --- | --- | --- |
| `generate` | The UHD module (and the assembly it sits in), plus the provider's design constraints | The provider's native design files |
| `export` | The native design | **Standard outputs** (section 3), the only thing anything downstream reads |
| `extract` | The native design | Facts fed back to UHD as geometry frames and artifacts: outline, positions, connector/button/display frames, nets as laid out |
| `check` | Native design against UHD | Diagnostics: the tool's own rule checks, plus drift between the native design and the model ("the design no longer matches") |

Operations are ordinary Protoboard extension operations (`protoboard run
<capability>:<op> --module <instance path or module id>`), with structured
results and operation records.

A provider may declare operations of its own beside the four, under the same
`operations` object: `{ entry, summary, effect?, inputs?, requires? }` with an
effect of `pure` or `export` (default). They run like the four, on one module,
under the same write guard and with a record (`circuit:lock`, `circuit:unlock`
and `circuit:kicad` of ext-tscircuit: [pcb-kicad-handoff.md](pcb-kicad-handoff.md)).
`--force` on the command line becomes the input `force` of an operation that
declares it.

## 3. Standard outputs

Downstream consumers (the viewer, other capabilities, BOM, releases, the cloud)
read only standard outputs, never native files. This is what makes a provider
replaceable.

| Capability | Standard outputs |
| --- | --- |
| `circuit` | Gerber RS-274X + Excellon drill; BOM (CSV, UHD-keyed: each row names the UHD instance path); pick-and-place (CSV, same keys); board body as GLB + STEP; a **geometry manifest** (the UHD manifest schema) naming the board outline, mounting holes and every component and connector frame; a netlist report (UHD-keyed) for drift checks |
| `cad` | STEP + GLB body; a **geometry manifest** naming the features that carry UHD interfaces (openings, bosses, holes, mating faces); manufacturing exports chosen by process (STL/3MF for printing, DXF for cutting) |
| `firmware` | A **configuration directory** in the framework's own formats (devicetree, Kconfig, headers), and a **firmware manifest** listing every file with its digest and, for each setting line, the UHD facts it cites (nets, pins, part facts, links, config constraints) |

The geometry manifest is already a UHD contract (frames by feature, with
signatures). Binding a module's interfaces to a manifest is pure UHD; producing
the manifest is the provider's job.

## 4. Where provider data lives

Each custom module that a provider designs has a provider directory in the
project, named by the module:

```
src/boards/<module>/
  <module>.uhd.ts          UHD: the board as a module (components, nets, interfaces) — tool-neutral
  circuit.config.ts        which provider, plus its design constraints (board size limit, layer count, fab profile)
  tscircuit/               provider-owned: generated source, footprint choices, layout tweaks
  firmware.config.ts       firmware provider and constraints (wake sources, driver properties)
  zephyr/                  provider-owned: generated board definition
  out/                     standard outputs (Gerber, BOM, PnP, GLB, STEP, manifest; config/, firmware manifest)
src/enclosures/<module>/
  <module>.uhd.ts          UHD: the enclosure as a module (the interfaces it must hold)
  cad.config.ts            provider and constraints (process, wall, clearance, material)
  build123d/               provider-owned source
  out/                     STEP, GLB, STL/3MF, manifest
```

The UHD module references `out/` as artifacts. The provider directory is an
artifact too (`role: "source"`, format named by the provider). Choosing a
provider per module happens in the config file next to it.

Mapping data a provider needs from part facts (for example, which footprint
fits a "QFN-48 6×6 mm" package) is the provider's own table, shipped with the
provider and overridable per project. It is never written back into the part.

## 5. Swapping a provider

- **Regenerating is clean.** Point the module's config at another provider and
  run `generate`: it starts from the same UHD module and writes its own native
  files beside the old ones.
- **Native designs do not convert losslessly.** A hand-tuned tscircuit layout
  does not become an equally tuned KiCad layout; build123d history does not
  become Onshape features. A swap mid-design means regenerating and redoing
  tool-specific polish. Providers may offer import from another provider's
  native format as a migration aid (tscircuit's KiCad export is one).
- **Hand edits stay honest.** When someone edits a native design directly,
  `extract` and `check` compare it with UHD and report drift, the same way the
  geometry-binding and harness-route stale checks work today.

## 6. Parts: three tiers

Parts used by a project come from one of three places. All three are ordinary
UHD module definitions; the tier is provenance, recorded in the project's
origin records.

| Tier | What | Where it lives | Versioning |
| --- | --- | --- | --- |
| **Cloud catalog** | Purchased parts researched, verified and published for reuse | Protoboard Cloud parts service (`protoboard parts search\|add\|update`), vendored into `parts/catalog/`: the definition JSON and, by default, its `.uhd.ts` source and the library modules it imports (`--compiled` for JSON only) | Immutable revisions with content digests, pinned in `parts/origins.json`; the source must evaluate to the pinned definition digest (`check` reports drift) and declares the UHD and TypeScript ranges it needs; updates are deliberate; works offline once vendored (modelled on ProtoPart versioning in the Protoboard app) |
| **Project-researched** | Purchased parts researched for this project and not (yet) published | `parts/local/` in the project, with evidence in `parts/evidence/` | Git; can be promoted to the catalog by publishing a revision |
| **Project-specific** | Custom modules designed in the project: frames, enclosures, custom PCBs, harnesses | `src/` | Git; their artifacts come from capability providers |

The parts library is not open source and is not in this repository. It is
distributed only through the parts service; the open-source UHD repository keeps the schema, pure helpers
and test fixtures, not the library.

## 7. Consequences for the current code

- Remaining tool code in UHD moves to extensions: the build123d
  generators and `rebind.py`, the generator file-layout helper
  (`src/authoring/cad.ts`), the technical-docs generator. Done 2026-10-02:
  frame and hardware generators and the layout helper in `ext-frame-cad`, the
  documents in `ext-docs`, the part workflow in `ext-parts`; the part-body
  generators and `rebind.py` went with the library.
- The UHD part library moves into the parts service. UHD keeps
  fixtures for its tests. The curated source is now the cloud repository's
  `library/`; UHD's copy is removed once the CLI vendors from the
  service.
- `ext-frame-cad` and `ext-harness-cad` adopt the `cad` capability's
  operation names and standard outputs. Done 2026-10-02: both
  declare `cad`, write `out/body.{step,glb,manifest.json}` (plus `body.dxf`
  for the plates' `cut` process), keep `frame-cad` and `harness-cad` as
  aliases of generate + export, and the quadcopter's frame, top plate and ten
  cables are bound by `cad.config.ts` files; the plates' generator design
  values moved out of UHD metadata (`frame_cad`) into those configs'
  constraints. Since Stack 0.1 the fastener bodies are `cad` too: ext-frame-cad
  designs a local screw, nut, spacer or standoff bound by its own
  `cad.config.ts` (`hardware-cad` is now the alias of generate + export), and
  ext-parts provides `cad` for a researched part whose body its own script
  draws. A bought part's body is a model of it, not a fabrication file: the
  release lists the part as bought or included.
- Part facts that a PCB provider needs and that are true of the part (package
  name, body dimensions, pin designators per leaf interface) are added to parts
  as UHD facts; footprint selection is not.

## 8. Clarifications from the implementation

The contracts in sections 2–4 are implemented in `@protoboardai/core`
(`capabilities.ts`, `outputs.ts`) and the CLI. Building them settled these
points; the [provider guide](../guides/writing-a-capability-provider.md) has
the details.

- **The module config is enough to select a provider.** A provider named in
  `circuit.config.ts` or `cad.config.ts` loads like a configured extension
  without being listed in `protoboard.config.ts`. The config is the explicit
  configuration, so swapping a tool is an edit to that one file plus
  `npm install`.
- **Standard outputs have fixed names.** `out/` holds `gerber/` (layers and
  `.drl`/`.xln` drill files), `bom.csv`, `pnp.csv`, `board.glb`, `board.step`,
  `board.manifest.json` and `netlist.json` for `circuit`; `body.step`,
  `body.glb`, `body.manifest.json` and process-dependent STL/3MF/DXF for
  `cad`. BOM and pick-and-place rows are keyed by an `instance` column;
  pick-and-place adds `x_mm`, `y_mm`, `rotation_deg`, `side`. The netlist
  report is `protoboard.netlist/v0`, with pins as `<instance>:<interface>`.
  The circuit manifest names the outline `outline` and each component by its
  instance path. A component's value and MPN are the placement's: a series
  passive (one catalog part per manufacturer series, e.g. `yageo-rc0402`)
  takes them from the board child's `ChildModuleRef.overrides`, resolved by
  UHD's `passiveInstance` (`boardNetlist` does this for every provider).
- **`export` replaces what its capability owns in `out/`.** Native folders
  of different providers sit side by side (section 5), but `out/` holds
  exactly the last export of each capability, so no file from a previous
  provider is read downstream. `firmware` owns `out/config/` and
  `out/firmware.manifest.json`; `circuit` and `cad` own the rest of `out/`.
  A board's circuit and firmware therefore share one `out/` and neither
  export deletes the other's files. `circuit` and `cad` do not share a
  directory (a board and its enclosure are separate modules).
- **Effects.** `generate`, `export` and `extract` write and are recorded;
  they may write only inside the module's provider directory. `check` is pure.
- **`extract` returns facts; it does not edit UHD.** Its result is frames
  (keyed by the module's interface or export ids) and artifact references.
  Writing them into the module source is a separate, explicit re-binding step,
  as `frame-cad-rebind` is today.
- **cad configs state a `process`** (`print`, `cut`, `machine`), which decides
  the required manufacturing exports.
- **Three capabilities are defined: `circuit`, `cad` and `firmware`.** A
  manifest declaring another is rejected until a framework release defines
  its standard outputs.
- **`firmware`.** Configs are `firmware.config.ts` next to a board
  module. Standard outputs are `out/config/` (any layout, subfolders allowed)
  and `out/firmware.manifest.json` (`protoboard.firmware/v0`): the board
  module, the controller instance and part, the framework and the release the
  files were checked against, and every file with its sha256 and its cited
  lines (`{ line, cites }`). A cite is `net:<id>`, `link:<id>`,
  `pin:<instance>:<interface>`, `part:<part id>:<fact>`, `module:<fact>` or
  `constraint:<key>`; export validation checks that the files exist and match
  their digests, that every file in `config/` is listed, and that each cite
  names something the board has. Core reads a board into a tool-neutral
  firmware map (`boardFirmware`: controller, buses with their devices and
  addresses, buttons, controls, crystals, USB; devices that agree on every
  line they share are one bus, so a write-only display and a flash on one
  SCK/MOSI are one SPI bus) and applies the rules every
  provider shares (`checkBoardFirmware`: pins on the controller's pin table and
  used once, bus signals on pins with that function, I2C addresses unique per
  bus, strapping pins not driven by peripherals, wake sources valid). Providers
  implement only the framework mapping (`firmwareOperations` in core runs the
  four operations). Generated native files are not edited by hand: export
  refuses an edited file and check reports it, because its cites would no
  longer hold; project settings go in the application's own files. Export
  also refuses files the board no longer gives (the model changed since
  generate), and check reports them as errors. Wake
  sources and driver properties the model cannot state are config
  constraints, and lines derived from them cite `constraint:<key>`.
