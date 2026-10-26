---
name: uhd-part-author
description: Write a purchased part's UHD ModuleDef from researched evidence — in a Protoboard project (project-researched tier, parts/local/<id>.uhd.ts) or the cloud part library (library/parts/<id>.ts) — with UHD's builders and defineModule, a citation header, typed parameters, pin designators and package facts, explicit assumption traits, and CAD bound to its physical interfaces. Use after uhd-part-research, and in repair mode when uhd-part-verify reports failures.
---

# UHD part author

Turn `<evidence>/.research/` into the part's definition: a single exported
`ModuleDef` wrapped in `defineModule` (and `withGeometry`), plus its CAD.

| | Project | Part library (protoboard-cloud) |
| --- | --- | --- |
| Definition | `parts/local/<id>.uhd.ts` | `library/parts/<id>.ts` |
| Evidence `<evidence>` | `parts/evidence/<id>/` | `library/parts/<id>/` |
| Part artifacts (CAD, thumbnail) | `parts/local/<id>/` | `library/parts/<id>/artifacts/` |
| CAD script | `parts/local/<id>/<script>.py` | `library/cad/py/catalog/<id>.py` |
| Imports | `@deltarobotics/uhd`; `@protoboardai/ext-frame-cad/artifacts` for the CAD layout | `@deltarobotics/uhd`; `../cad/artifacts.js` |
| Peers to mirror | `parts/catalog/<id>/<id>.uhd.ts` (the vendored source; `*.json` when vendored `--compiled`), other local parts | `library/parts/*.ts` |

**How to model** (interfaces, pin tables, buses, connectors, parameters,
traits, domains and package, geometry frames and refs) is UHD's reference
skill **uhd-authoring**, shipped with `@deltarobotics/uhd`, with its
[vocabulary](../uhd-authoring/references/vocabulary.md) and
[mapping rules](../uhd-authoring/references/mapping-rules.md). Read it first.
This skill adds where the files go, how the CAD is made, and the rules of the
pipeline.

## Purpose

Write a datasheet-honest definition of one purchased part that the system,
the checks, the circuit provider and the documents can all rely on. Use it
after **uhd-part-research** has the evidence, and in repair mode when
**uhd-part-verify** returns failures. In **build-a-project** it is stage 3,
project-researched tier. It never edits catalog files: a catalog part that is
wrong for the project becomes a local variant with its own id.

## Inputs

| Input | Where | From |
| --- | --- | --- |
| Research summary and extracts | `<evidence>/.research/summary.md`, `extract-*.json`, `gaps.json` | **uhd-part-research** |
| Source record | `<evidence>/sources.json` | **uhd-part-research** |
| The modelling reference | **uhd-authoring** (`npx protoboard skills` shows its path) | `@deltarobotics/uhd` |
| Peer parts | the table above | the project, the catalog or the library |
| Repair list (repair mode) | `{ errors[], wrongFacts[], unsupportedFacts[], missing[], preserve[] }` | **uhd-part-verify** |
| CAD Python (project) | `npx protoboard doctor` shows `python-build123d` ✓ | `npx protoboard tools install cad` |

## Steps

### 1. Before writing

- Read `.research/summary.md` and the `extract-*.json` files.
- Read **uhd-authoring** and its references.
- Open one or two peer parts with a similar category and mirror their
  structure and naming (library: `rev-21-1652-neo-vortex-brushless-motor.ts`
  for motors, `bme280.ts` for I2C sensors, `esp32-devkitc-v4.ts` for boards,
  `adafruit-4698-as7341.ts` for a STEMMA QT breakout; in a project, the
  vendored catalog source `parts/catalog/<id>/<id>.uhd.ts` is the same
  file as the library's, so it reads the same way).
- Mirror a peer's structure, never its facts or its prose. A note, a
  reference or a CAD generator copied from a sibling is checked against this
  part's sources line by line (verify-part's text lint flags generator
  references that name another part).

### 2. Write the definition

```ts
/**
 * <Manufacturer> <Product> (<part number / variant>) — datasheet-honest UHD part.
 *
 * Sources (see <evidence>/sources.json):
 *   - src_datasheet: <title> — <url>
 *   - src_product:   <title> — <url>
 *
 * Modelling notes:
 *   - <what each interface represents and why>
 *   - <what was omitted, and why>
 *   - <assumptions and conflicts, each pointing at an `assumption` or
 *     `source_discrepancy` trait>
 */
import type { ModuleDef } from "@deltarobotics/uhd";
import { defineModule, PowerIn, Ground, UART /* ... */ } from "@deltarobotics/uhd";

const SRC = { datasheet: "<url>", product: "<url>" } as const;

// leaves → composed interfaces → module
export const <CONST_NAME>: ModuleDef = defineModule({ ... });
```

- The export name is the id in SCREAMING_SNAKE_CASE (`MATEK_M10Q_5883`).
- `id` equals the file name (without `.uhd.ts` / `.ts`). Also set `name`,
  `version: "1.0.0"`, `manufacturer`, `part_number`, `description`, `tags`,
  and `categories`.
- `categories` lists **every** UHD taxonomy path that fits the part, each the
  most specific that applies (UHD `docs/taxonomy.md`). Consider three kinds:
  - what the part is (`sensor.distance`, `actuator.motor_controller`);
  - the form it comes in (`expansion.breakout`, `expansion.arduino_shield`,
    `microcontroller.module`, `microcontroller.chip`);
  - the platform it belongs to (`robotics.frc`, `robotics.ftc`,
    `robotics.drone`, `robotics.rc`), and a kit it ships in (`kit.<kit>`).

  A part usually has more than one. A time-of-flight breakout is
  `["sensor.distance", "expansion.breakout"]`; a motor with a built-in
  encoder is `["actuator.motor.dc_motor", "sensor.encoder"]`; an FPV 4-in-1
  ESC is `["actuator.motor_controller", "robotics.drone", "robotics.rc"]`; an
  IMU with a magnetometer is `["sensor.motion", "sensor.magnetic"]`. Some
  forms always apply, so file them every time:
  - a bare packaged IC that is not a microcontroller (a regulator, charger,
    driver, ESD array or sensor chip) also gets `component.ic` and the tag
    `ic`; a microcontroller or SoC chip gets `microcontroller.chip` instead;
  - a microcontroller board programmed over USB with its pins on headers
    also gets `microcontroller.development_board` and the tag `dev-board`,
    next to its brand family;
  - a drone motor, battery, ESC or receiver also gets `robotics.rc`;
  - a part that a kit ships is filed under that kit, and the library's kit
    manifest (`library/kits/<kit>.json`) lists it with its `part_id`.

  Never
  list an ancestor next to its descendant. A path a source library used that
  the taxonomy does not have may be a legacy alias:
  `validateCategories` names the paths to use instead.
- Use the vocabulary builders for what they cover (**uhd-authoring**
  vocabulary): `StepperPhases` and `StepDir` for steppers and their drivers,
  `BrushedMotorTerminals` for brushed motors and H-bridge outputs,
  `QuadratureEncoder` for encoders and encoder inputs, `ServoPort` for servo
  leads and channels, `CAN` / `CANLogic` for CAN, `ShieldHeader` for shield
  and HAT headers, `BoltPattern` with shape `cross` for two-diagonal motor
  bases, `row` for holes in a line on a pitch and `slot` for T-slots and
  slotted brackets (not a rectangle with `spacingYmm: 0` or a spacing
  range), `Shaft` with `gender` and `profile` for shafts and bores (a
  hollow motor output is an `output` bore; a loose shaft or spacer that
  carries torque is `bidirectional`), `LinearMotion` for actuator and lead
  screw outputs, `minSupplyCurrentA` for the least rating an input needs
  from its source, and `FluidPort` for pneumatic and hydraulic ports. The
  pair checks are in UHD's `docs/mechanical-interfaces.md`.
- Links, buses and radios (UHD `docs/links-and-buses.md`): `PCIe` (root on
  the host side, endpoint on the card; lane pairs named from the part's own
  side) and `M2` (socket or card, key, sizes, carried interfaces) for PCIe
  and M.2; `CSI2` and `DSI` for MIPI camera and display ports (camera and
  host display output transmit); `Ethernet` for RJ45 jacks, PHY MDI pins and
  fibre ports, with `poe` for PSE and PD ports, and `SFP` for cages and
  modules; `I2S` / `PCM` for digital audio (clock role, data direction,
  formats); `DVP` for parallel cameras, data pins MSB first; `SDCard` for SD
  slots, SDMMC peripherals and cards; `USB` for USB data ports (VBUS stays a
  `PowerIn` / `PowerOut`); `WiFi`, `Bluetooth` and `IEEE802154` (Zigbee,
  Thread, Matter) for radios, with the antenna as an `rf` interface named in
  `radio`. These replace the `custom` interfaces wave 1 used for them.
- LEDs, relays and storage: `Led()` for a two-terminal LED, `ledTrait` and
  `LedDrive({ role: "led" })` per driven terminal for RGB and addressable
  LEDs and displays, `LedDrive({ role: "driver", mode, output })` for LED
  driver channels; `relayTrait` (every contact rating row) with
  `RelayCoil` and `RelayContacts`; `storageTrait` (medium, `capacity_bytes`,
  interfaces) on memory chips, cards and SSDs. Taxonomy 1.2.0 adds
  `component.storage.memory`, `.memory_card`, `.ssd`,
  `connectivity.wired.ethernet`, `connectivity.wireless.ieee802154`,
  `expansion.pcie`, `mechanical.fastener.standoff`,
  `component.ic.analog_switch` and `component.ic.led_driver`.
- Drive train and fastening (UHD `docs/mechanical-interfaces.md`): `Gear`
  for teeth (module or diametral pitch, pressure angle, tooth count, face
  width; the bore stays a `Shaft`); `Bearing` (its outside plus a `Shaft`
  bore; plain bearings too) and `BearingSeat` for the pocket that holds one,
  never a `Shaft` bore standing in for a seat; `BoltPattern` shape `grid`
  for a hole lattice (rectangular or triangular, rows × columns or a disc)
  and `arc` for a partial bolt circle (count, angular pitch, start angle);
  `Thread` for screws, nuts, set screws, tapped holes and inserts; `TSlot`
  for an extrusion's slot (track) and the screw head or T-nut in it
  (insert), keeping the slot's `BoltPattern` for brackets; `AxialFace` for
  spacer, collar and hub end faces; `Shaft({ clampsOn })` for a round bore
  that clamps on a hex shaft; `Wheel` for a wheel's tread.
- Serial links, IR, mains and coils (UHD `docs/links-and-buses.md`): `RS485`
  (half or full duplex), `RS232` (DTE or DCE, at line levels, never a
  `UART`), `SWD` (target or probe), `PPM`, `InfraredRemote` (carrier,
  wavelength), `AcPower` for a mains inlet or outlet (never `PowerIn`), and
  `InductiveLoad` / `InductiveDrive` for a solenoid or valve coil and the
  channel that switches it. These replace the `custom` interfaces and gaps
  the bulk migration logged for them.
- Every file an artifact names must exist: an interface GLB is written under
  the generator's feature name, so bind `cadArtifacts({ interfaces })` to
  that name (verify-part reports a missing file as a `[files]` error).
- `artifacts[]` lists the primary sources, each with an `id`, `name`, `type`,
  and `url`. Every artifact URL must also appear in `sources.json`.
- A part that goes on a custom board needs the facts a circuit provider
  reads: the package name as the manufacturer states it, body dimensions, and
  a pin designator (`pin`) on every leaf interface for the exact package.
- **Connectors are `Connector()` composites.** A socket or header with more
  than one position (a STEMMA QT / Qwiic JST-SH-4, a JST-GH, a pin header,
  a shield header) is a `Connector()` whose positions bind the leaf
  interfaces, one composite per physical socket, even when two sockets are
  wired in parallel (`adafruit-4698-as7341`, `matek-m9n-5883`). The older
  `adafruit-5396-vl53l4cd` records its STEMMA QT sockets as connector traits
  on the leaves; it predates `Connector()` and is not a precedent:
  verify-part warns on that pattern.
- **Borrowing from a sibling SKU.** When a value comes from another product's
  source (the BME680 board files for the BME688 breakout, a series drawing
  for one length of extrusion, another package's terminal drawing for a
  generated body), say so in an `assumption` trait that names the sibling,
  the source and why it applies ("same PCB, stated by the product page";
  "the drawing covers the whole series"). Never present a sibling's value as
  this part's own.
- Never put supplier offers, prices, stock, supplier SKUs (except a standard
  part's `part_number`), footprints, symbols or anything named after a tool in
  the definition (**uhd-authoring**, and **part-handoff** in a project).

### 3. Make the geometry (CAD)

Every part binds its physical interfaces to 3D geometry: bolt patterns and
shafts get a frame and refs, connectors a ref to their body (**uhd-authoring**,
Geometry). The geometry is made one of two ways.

**In the part library.** Both paths are a per-part script
`library/cad/py/catalog/<id>.py` with a `build()` function, run with
`.venv-cad/bin/python library/cad/py/build_all.py <id>`:

- **Vendor CAD** (research found a STEP): commit the download as research
  saved it under `artifacts/cad/vendor/` (the archive too, when the STEP
  came out of one), then configure `library/cad/py/vendor_step.py`. It reads
  the STEP from there, converts it to GLB under `artifacts/cad/vendor/` and
  writes the manifest `artifacts/cad/<id>-vendor.manifest.json`. Select features by the vendor's
  own component names (`label("J1")`) or by geometry (`holes(3.2)`,
  `planar((0, 0, 1))`, `within_box(...)`), because vendor names are often
  generic. Declare with `vendorCadArtifacts(...)`, `vendorFeature`,
  `vendorOwn` from `library/cad/artifacts.ts`.
- **Generated** (no usable CAD): model the outline, holes, shaft and
  connector bodies from the drawing dimensions with `library/cad/py/partkit.py`
  (`GeneratedPart`, `board`, `block`, `cylinders`) or a `generators.py`
  generator, committed under `artifacts/cad/`. Declare with `cadArtifacts({
  dir, name, generator: "library/cad/py/catalog/<id>.py", tool: "build123d
  0.13.0" })` and `feature(...)`. Add a `data_gap` trait for field
  "manufacturer CAD" that says where research looked, and an `assumption`
  trait for any dimension the drawing doesn't give. Pass the generator this
  part's own drawing as `references=`: a generator's default reference
  belongs to another part (the axial generator defaults to a resistor data
  sheet), and the manifest would cite it.
- **Vendor STEP kept internal, generated body bound.** When research found
  a vendor model but its terms keep it in the team (`internal` or
  `unknown`), and the part is simple enough to generate faithfully (a
  bracket, a shaft, a spacer, an extrusion, a plain enclosure), bind a
  generated body so the catalog can give the part out with geometry, and
  keep the vendor STEP as evidence: commit it under `artifacts/cad/vendor/`
  with its terms, keep its `cad` row in `sources.json`, measure it
  (`step_measure.py`) and take into the generator what the drawing leaves
  out (a slot's lip, a cavity floor), each such value named in the
  modelling notes. The `data_gap` "manufacturer CAD" then says that the
  model exists and why it is not the bound body
  (`rev-41-1568-15mm-extrusion-120mm`). The same applies when a vendor model
  cannot be bound (one fused solid with no separable features, a family
  model of several sizes). Never describe the generated body as the
  vendor's: prose that says "from the <maker> STEP" on a part with no vendor
  model is a verify-part text warning.

Pass `axis=` for holes and shafts (vendor `holes(...)` does this itself): the
manifest then records each hole axis, and verify checks the frame against it.
Copy signatures from the manifest with
`python library/cad/rebind.py library/parts/<id>.ts <manifest>` rather than by
hand.

**Terms.** Every file the part carries gets an entry in
`<evidence>/terms.json` (format in **uhd-part-research**, step 3). The
library keeps vendor files whatever their licence; their terms decide who
may receive them, and the catalog's redistributable view and
`npm run export-distributable` leave out anything not `redistributable`.

- The vendor files research recorded keep their entries; add one for each
  file you make from them (the GLB body and every interface GLB): the STEP's
  terms, a summary that says it was converted from that STEP, the download's
  `sourceUrl` and `sourceSha256`. No `sha256` on these, since the pipeline
  regenerates them.
- Your own work (generated STEP and GLB, interface GLBs, the catalog script,
  the manifest, `sources.json`, `verification.json`) is
  `{ "preset": "library" }` in the library (redistributable under the
  library's terms); in a project, write the terms in full.
- A thumbnail or product photo is `unknown` unless research found its terms.
- A file over 95 MB is not committed: `npm run large-files -- add <file>`
  stores it in the blob store and writes the pointer to commit.

Worked examples: `raspberry-pi-5` (vendor CAD, features selected by geometry
because the vendor's labels are generic), `ti-drv8871` (a package generated
from the drawing), `emax-rs2205-2300kv` (a motor with shaft and base holes).

**In a project.** There is no shared part-CAD kit in projects yet: the
library's `partkit.py` and `vendor_step.py` stay with the library. The
body is made through the `cad` capability, with this extension as the
provider: write a self-contained build123d script in the part's native
folder, `parts/local/<id>/part-cad/<script>.py`, which `python <script>
<out_dir>` runs to write into `<out_dir>`:

- `body.step`: the body, with each interface feature as a named sub-shape
  (deterministic: fix the STEP's timestamp);
- `body.glb`: the same, tessellated (glTF metres, Y-up);
- `body.manifest.json`: `{ artifact, tool, toolVersion, units: "mm",
  volume_mm3, bodies, features: { <feature>: { area_mm2, centroid, faces,
  normal? } } }`, with `centres` and `diameter_mm` on hole and shaft features
  so verify can check frames against them;
- optionally `interfaces/<id>.glb`.

Bind it with `parts/local/<id>/cad.config.ts`:

```ts
export default defineCapabilityConfig({ provider: "@protoboardai/ext-parts", module: "<id>", constraints: { generator: "<script>.py" } });
```

The quadcopter's `parts/local/panasonic-eeu-fr1v471/part-cad/bulk_capacitor.py`
is the example. Declare the files with `partCadArtifacts({ dir:
"parts/local/<id>", name: "<id>", generator: "<script>.py" })` from
`@protoboardai/ext-parts/artifacts`, and copy each signature from the manifest
into its `feature(...)` (generate lists the bound signatures that differ):

```bash
npx protoboard tools install cad                       # once per checkout (or PROTOBOARD_PYTHON=<python with build123d>)
npx protoboard run cad:generate --module <id>          # runs the script; part-cad/source.json records it
npx protoboard run cad:export --module <id>            # out/body.step, body.glb, body.manifest.json
```

Do not run the script by hand into the part's folder: the release traces
every body to its `cad:export` record, and `cad:check` reports a script
changed since its body was made (`PART_CAD_STALE`). Purchased fasteners
(screws, nuts, spacers, standoffs) need no script: `@protoboardai/ext-frame-cad`
generates their nominal bodies from their sizes (**frame-cad** step 6).

Vendor STEP in a project: record it in `sources.json` (with its licence) and
in `terms.json`, and measure it as evidence, but bind geometry generated from
the drawing, unless the part is authored in the library, where
`vendor_step.py` binds vendor CAD. Say which in the modelling notes.

### 4. Load it

In a project the config's `sources` must include `parts/local/**/*.uhd.ts`:

```bash
npx protoboard check --format json         # the part loads (no PB_SOURCE_LOAD_FAILED), links and rails check
npx protoboard inspect <instance using the part> --format json
```

### 5. Hand off

Run the automated verify (**uhd-part-verify**, stage 1) until it passes,
then hand off for the evidence audit. Registering is the integrator's step:
in the library, export the part from `library/parts/index.ts` and run
`npm test`, `npm run typecheck`, `npm run build:library`; in a project,
`protoboard check` loading it is registration.

## Decision points

| Decision | Rule |
| --- | --- |
| A value with no source | An `assumption` trait that says so, or leave it out; never a plain parameter. |
| No existing protocol type or role fits | Prefer `custom` plus a trait; a new one needs a `type: "vocabulary"` entry in `.research/gaps.json` and goes to the integrator. |
| Vendor CAD or generated | Library: vendor CAD when research found it, whatever its licence; a generated body with the vendor STEP kept internal as evidence when its terms keep it in the team and the part is simple to generate, or when it cannot be bound (step 3). Project: generated from the drawing, with the vendor STEP as evidence. |
| A value from a sibling product | An `assumption` trait naming the sibling, the source and why it applies. |
| A multi-position socket or header | A `Connector()` composite per physical socket, binding the leaves (not connector traits on the leaves). |
| Terms of a file you made | From a vendor file: that file's terms. Otherwise the library's own (`preset: "library"`). |
| Repair mode | Change only what verify flagged; keep everything in `preserve[]`. |
| A wrong catalog part | A local variant with its own id in `parts/local/`: copy its vendored `parts/catalog/<id>/<id>.uhd.ts` (and the helper modules it imports) as a starting point, give it the new id, and change it there. The catalog files are never edited: an edited vendored source is `PB_SOURCE_DRIFT`. |

## Outputs

| Output | Where |
| --- | --- |
| The definition | `parts/local/<id>.uhd.ts` (project) or `library/parts/<id>.ts` (library) |
| Part CAD and its script | `parts/local/<id>/` (project) or `library/parts/<id>/artifacts/` + `library/cad/py/catalog/<id>.py` (library) |
| Terms of every file | `<evidence>/terms.json` (`parts/evidence/<id>/` or `library/parts/<id>/`) |

## Verification

```bash
npx protoboard run part-verify --input part=<id>         # exit 0 (stage 1 of uhd-part-verify)
npx protoboard check                                     # the part loads; no UHD_GEOMETRY_BINDING error
```

Then **uhd-part-verify** stage 2, the independent evidence audit, by a
different agent. The author never audits its own part as stage 2: when no
second agent is available, record the self-check with
`record-verification.ts <id> --self-audit` and leave the part below
`audited`.

## Failure handling

| Code or symptom | Means | Do |
| --- | --- | --- |
| `PB_SOURCE_LOAD_FAILED` | The file throws on import (often `defineModule` rejecting duplicate ids or a bad profile binding) | Fix the error the message names |
| `PB_UNRESOLVED_DEFINITION` | The system uses the id but nothing loads it | Add `parts/local/**/*.uhd.ts` to `sources`; check the id matches the file name |
| `PB_DUPLICATE_DEFINITION` | The id is already defined (a catalog part) | Give the local variant its own id |
| `UHD_GEOMETRY_BINDING` | A ref names a missing artifact or feature, or a signature changed | Regenerate the CAD and copy signatures from the manifest |
| `PB_MISSING_ARTIFACT` | A declared CAD file is not on disk | Run the CAD script |
| `HW_NO_SOURCES` | No sources on the part | Cite them (header, `artifacts`, `sources.json`) |
| `CIRCUIT_BOARD_UNREADABLE` "pin(s) without a designator" | The part is on a custom board without pin designators | Add `pin` to each leaf interface for the exact package |
| `part-verify` errors | The automated checks failed | Fix each; see **uhd-part-verify** |

Every other code: **system-compose** [diagnostic codes](../system-compose/references/diagnostic-codes.md).

## Hard rules

1. No value without a source unless it's in an `assumption` trait.
2. No new protocol type or role without an entry in `.research/gaps.json`
   (`type: "vocabulary"`) explaining why no existing one fits. Prefer
   `custom` plus a trait over inventing vocabulary.
3. Don't edit UHD, the library index (`library/parts/index.ts`), shared CAD
   code, or other parts. Vocabulary changes are escalated to the integrator.
4. In repair mode, change only what verify flagged and keep everything else.
5. No part without geometry: every bolt pattern and shaft has a frame and a
   ref, and `checkGeometryBindings` reports no errors.
6. Library parts ship as source (projects vendor `<id>.uhd.ts` and
   the modules it imports), so the definition stays declarative: static
   imports of `@deltarobotics/uhd` and library modules only; no `fs`,
   network, `process`, timers, `eval`/`Function`, `import.meta` or dynamic
   `import()`, no reflection (`Reflect`, `Proxy`, `prototype`,
   `getPrototypeOf`, `defineProperty`, a string such as `"constructor"`),
   `this` only in a class, and no local named after a host global (`self`,
   `global`, `fetch`, …). The library build (`npm run build:library`) and
   the seed lint every part with UHD's `lintSource` and check, evaluating it
   confined, that its source gives its definition digest; a part that fails
   ships compiled only.
