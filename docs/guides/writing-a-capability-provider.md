# Writing a capability provider

A capability provider connects one engineering tool (a PCB tool, a CAD kernel)
to Protoboard. It is an ordinary extension that declares a capability and
implements its four operations. Projects choose it per module, in a config
file next to the module. This guide covers what to write, how to test it and how to ship it.
The design is in [tool integrations](../specs/tool-integrations.md); the code
is `packages/core/src/capabilities.ts` and `packages/core/src/outputs.ts`.

Keep the [UHD boundary](../specs/tool-integrations.md#1-the-rule) in mind
throughout: your tool's knowledge (footprints, layer stacks, feature trees,
document ids) stays in your native folder and your own tables. Nothing you
write goes into a UHD definition except through `extract`'s facts, and those
are tool-neutral.

## 1. Declare the capability

Add `capabilities` to `protoboard-extension.json`. All four operations are
required. An entry is a string, or an object with the same options as an
ordinary operation (`summary`, `requires`, `inputs`). The example is a
simplified version of `@protoboardai/ext-tscircuit`'s manifest
(`packages/ext-tscircuit`, the first real provider).

```json
{
  "schema": "protoboard.extension/v0",
  "id": "@protoboardai/ext-tscircuit",
  "version": "0.1.0",
  "compatibility": { "protoboard": "^0.2.0" },
  "tools": [{ "id": "tscircuit-node", "purpose": "tscircuit libraries, pinned, on Node 22+", "probe": ["node", "-e", "require(require.resolve('@protoboardai/ext-tscircuit/lib/probe.cjs', { paths: [process.cwd()] }))"] }],
  "capabilities": [
    {
      "id": "circuit",
      "summary": "PCBs from UHD boards with tscircuit",
      "native": "tscircuit",
      "operations": {
        "generate": { "entry": "./ops/circuit.ts#generate", "requires": ["tscircuit-node"] },
        "export": { "entry": "./ops/circuit.ts#exportOutputs", "requires": ["tscircuit-node"] },
        "extract": "./ops/circuit.ts#extract",
        "check": "./ops/circuit.ts#check"
      },
      "constraints": {
        "layers": { "description": "copper layer count", "required": true },
        "width_mm": { "description": "board width limit" }
      }
    }
  ]
}
```

- `id` is `circuit`, `cad` or `firmware`. Other capabilities (`fabrication`,
  `test`) need a framework release that defines their standard outputs; until
  then the manifest is rejected.
- `native` names your folder inside each module's provider directory. The
  default is your package name without scope and `ext-` prefix.
- `constraints` is optional. When you declare it, a module config with a key
  you do not know gets a warning, and a missing `required` key is an error.
- `artifacts` is optional: the files you make for each module, as its
  artifacts. Each entry has an `id`, `name`, `type` (a UHD
  `ArtifactType`), optional `role`, `format`, `units` and `generatedFrom` (the
  id of the declared artifact it is made from), and a `path` that starts with
  `{out}/`, `{native}/` or `{dir}/` (the provider directory) and may name the
  module with `{module}`. When the project loads, core gives each bound module
  every declared artifact whose file exists, before the model checks run, so
  the viewer's tabs find the files (the schematic, PCB and BOM views by file
  name, the 3D view by `.glb`) and no project lists them by hand. An artifact
  the module lists itself with the same id or file path wins: explicit
  artifacts are the override. The attached artifacts are not part of the
  module's digest (an export is not a design change). ext-tscircuit declares
  its standard outputs, the routed `circuit.json` and its build record, and a
  locked board's `{dir}/kicad/{module}.kicad_pro`.
- A manifest without `capabilities` is a plain v0 extension, unchanged.

An invalid declaration is reported as `PB_EXTENSION_MANIFEST_INVALID` and the
extension does not load.

## 2. How a project selects you

A module's folder holds its UHD source and one config per capability:

```text
src/boards/mainboard/
  mainboard.uhd.ts      the board as a module (components, nets, interfaces)
  circuit.config.ts     provider + constraints
  tscircuit/            yours: native design files
  out/                  standard outputs
```

```ts
// circuit.config.ts
import { defineCapabilityConfig } from "@protoboardai/core";

export default defineCapabilityConfig({
  provider: "@protoboardai/ext-tscircuit",
  constraints: { layers: 4, width_mm: 38 },
});
```

- Configs are found in the folders the project's `sources` globs cover
  (default `src/`), named `circuit.config.ts`, `cad.config.ts` or
  `firmware.config.ts`.
- The module is the one definition declared in the same folder. If the folder
  declares several (a board file that also defines local parts), the config
  names it with `module: "<id>"`.
- A config may also sit in a folder of its own and name a module declared
  elsewhere: many small modules declared in one file, such as a project's
  cables, each get a folder (`src/harnesses/<id>/cad.config.ts` with
  `module: "<id>"`). The config's folder is still the module's provider
  directory, so the native folder and `out/` are there.
- `cad` configs may set `process`: `print` requires an STL or 3MF export,
  `cut` requires DXF, `machine` requires nothing beyond STEP.
- The provider named here is loaded like a configured extension. It does not
  have to be listed in `protoboard.config.ts`, so switching tools is an edit
  to this one file (and an `npm install`).

`protoboard capabilities` shows each capability, the installed providers, and
which module uses which. A provider that is not installed, or does not
provide the capability, is an error on the module's config line
(`PB_PROVIDER_NOT_INSTALLED`, `PB_PROVIDER_LACKS_CAPABILITY`) and `run`
refuses with the same message.

## 3. Implement the operations

Each entry receives a `CapabilityContext`: the usual operation context plus
the module.

```ts
import type { CapabilityOperationFn } from "@protoboardai/core";

export const generate: CapabilityOperationFn = (ctx) => {
  const board = ctx.module.definition; // the UHD ModuleDef
  // ctx.module.native = "src/boards/mainboard/tscircuit", ctx.module.out = ".../out"
  // ctx.constraints = { layers: 4, width_mm: 38 }
  ctx.writeOutput(`${ctx.module.native}/index.tsx`, source(board, ctx.constraints));
  return { status: "succeeded", summary: `${board.children?.length ?? 0} components` };
};
```

| Operation | Effect | Must |
| --- | --- | --- |
| `generate` | writes; recorded | Write the native design from the UHD module and constraints, under `ctx.module.native`. |
| `export` | writes; recorded | Write every standard output (section 4) under `ctx.module.out`. The framework first removes what this capability owns in `out/`, so `out/` holds exactly this export plus the latest export of any other capability bound in the same directory (a board's `circuit` and `firmware`). |
| `extract` | writes; recorded | Return `data: ExtractedFacts`: `frames` keyed by the module's interface or export ids (mm, module coordinates) and `artifacts` (paths must exist). The framework never writes these into UHD; re-binding is a separate, explicit step. |
| `check` | pure | Return `diagnostics`: your tool's rule checks and drift between the native design and the module. Return `[]` when they match. |

Writes go through `ctx.writeOutput(projectRelativePath, content)` and must stay
inside the module's provider directory; anything else fails the operation.
`check` cannot write. Results that fail validation (outputs, facts, a check
without a diagnostics array) turn a `succeeded` run into `failed`, with the
findings attached to the operation record.

Run them with `protoboard run circuit:generate --module <instance path or
module id>`. `--input key=value` passes declared inputs; `--format json`
prints the record.

### circuit providers: start from the board netlist

`boardNetlist(board, lookup)` in `@protoboardai/core` reads a UHD board module
(UHD `docs/boards-and-nets.md`) into what every PCB tool needs: components
(instance path, part id, kind, value, package facts, pin designators, body
artifacts), nets (a union-find over the board's links between leaf pins and
`Net` interfaces), the board's edge (its exports) and its design envelope.
It knows no tool. Map it to your native design with your own land-pattern
table, then compare your laid-out copper back to it with
`netlistDrift(intended, laidOut, present)`, which reports opens, shorts,
unrouted nets, stray connections and missing pins. `netlistReport` writes
the intended nets in the `netlist.json` shape.

### firmware providers: start from the board firmware map

`boardFirmware(board, lookup)` in `@protoboardai/core` reads a UHD board into
what a firmware configuration needs: the controller (the one component in
category `microcontroller`, or `constraints.controller`), buses with the
controller pin of each signal (I2C, SPI, UART from the peripherals' bus
composites; 1-Wire from a `onewire_dq` pin) and their devices with addresses
and clock limits, buttons (a switch between a controller net and ground or a
supply) with their polarity and pull, single control lines (interrupt,
reset, enable, D/C, status) by the peripheral pin's capabilities, crystals on
the controller's pins, and the controller's USB pins. Every item carries the
cites a configuration line should copy. `checkBoardFirmware` applies the
shared rules (codes below); a provider passes `canWake` for its chip's
deepest sleep.

Most providers need no more than a design function and a pin reader:

```ts
import { firmwareOperations, type FirmwareProviderSpec } from "@protoboardai/core";

const SPEC: FirmwareProviderSpec = {
  provider: "@protoboardai/ext-zephyr",
  framework: "zephyr",
  frameworkVersion: "4.2.0",
  design: (fw, board, controller, ctx) => ({ files: [/* { path, role, style, lines: [{ text, cites, why }] } */], warnings: [], findings: [] }),
  readPins: (files, controller) => [/* { file, line, ref: "P0.13", pin: "pin_37" } */],
  rules: () => ({ sleepName: "System OFF" }),
};
export const { generate, exportOutputs, extract, check } = firmwareOperations(SPEC);
```

`firmwareOperations` renders the files (a `why` becomes a comment beside a
devicetree or C line, or above a Kconfig line, where a value may not carry
one), writes them with `protoboard.lines.json` (digest and cites per file),
refuses to generate for a board with errors, exports `out/config/` and the
manifest, refuses to export a native file edited since generate or one the
board no longer gives (the board changed: run generate again), and in
`check` reports edited and stale files, pins the files name that are not on
the controller's pin table, and drift between those pins and the board.
`@protoboardai/ext-zephyr` and `@protoboardai/ext-esp-idf` are the two providers.

## 4. Standard outputs

Downstream reads only these files, so they are fixed per capability. Paths are
under the module's `out/`.

### circuit

| Path | Content and checks |
| --- | --- |
| `gerber/*` | Gerber RS-274X layers: every file in `gerber/` except drill files. Needs `%FS…*%`, `%MOMM*%` or `%MOIN*%`, and a final `M02*`. `%FST…`/`%FS.I…` (deprecated notation) is a warning. |
| `gerber/*.drl`, `gerber/*.xln` | Excellon drill: an `M48` header closed by `%` or `M95`, with `METRIC` or `INCH` and at least one `T<n>C<diameter>`; ends with `M30`. |
| `bom.csv` | RFC 4180 CSV with a header row. Column `instance` (UHD instance path relative to the board, e.g. `u1`) is required; one row per component; other columns are yours. Unknown instances are errors; a direct child of the board with no row is a warning. |
| `pnp.csv` | Columns `instance`, `x_mm`, `y_mm`, `rotation_deg`, `side` (`top` or `bottom`); numbers must parse. |
| `board.glb` | glTF 2.0 binary: magic, version 2, header length equal to the file size, a JSON chunk with `asset.version` `"2.0"`. |
| `board.step` | ISO 10303-21: `ISO-10303-21;`, a `HEADER` with `FILE_SCHEMA`, a `DATA` section with entities, `END-ISO-10303-21;`. |
| `board.manifest.json` | A UHD `GeometryManifest` (units `mm`, features with `area_mm2`, `centroid`, optional `normal`, `faces`). Features: `outline` (required), one per placed component keyed by instance path (warning if missing), and the board's mounting holes and connectors by the interface or export id they carry. |
| `netlist.json` | `{ "schema": "protoboard.netlist/v0", "nets": [{ "id", "link"?, "pins": ["u1:vdd", ":usb"] }] }`. Pins are `<instance>:<interface>` (`:<id>` for the board's own); instances, interfaces and `link` ids must exist in the board. |

### cad

| Path | Content and checks |
| --- | --- |
| `body.step`, `body.glb` | As for circuit. |
| `body.manifest.json` | A UHD `GeometryManifest` naming the features that carry the module's interfaces (openings, bosses, holes, mating faces). |
| `*.stl`, `*.3mf`, `*.dxf` | Manufacturing exports, checked wherever present: STL binary (size = 84 + 50 × triangles) or ASCII (`solid` … `facet` … `endsolid`); 3MF a ZIP with `_rels/.rels` and a `*.model` part; DXF ASCII from `0/SECTION` to `0/EOF`, or the binary sentinel. The config's `process` decides which are required. |

### firmware

| Path | Content and checks |
| --- | --- |
| `config/**` | The configuration files in the framework's formats, any layout. Every file must be listed in the manifest; an empty file is malformed. |
| `firmware.manifest.json` | `protoboard.firmware/v0`: `module` (the board), `provider`, `framework`, optional `frameworkVersion`, `controller: { instance, part }` (must be that component), `files: [{ path, digest, role?, lines: [{ line, cites }] }]`, optional `warnings`. Each file exists under `config/` and matches its `sha256:` digest; each line exists and cites at least one fact; each cite names something the board has: `net:<id>`, `link:<id>`, `pin:<instance>:<interface>`, `part:<part id>:<fact>` (a part used on the board), `module:<fact>`, `constraint:<key>`. |

These checks are structural. They catch missing, truncated, mislabelled and
wrongly keyed files; they do not prove the board or part is right. That is
your `check` and the model's validators.

## 5. What `protoboard check` shows

For every module with a config:

- `protoboard/capabilities`: the config itself (provider installed, module
  found, constraints known).
- `protoboard/standard-outputs`: the files above. A module never exported gets
  one info finding (`PB_OUTPUT_NOT_EXPORTED`, naming the capability) instead.
  Each output is also compared with the latest export record that wrote it:
  a file edited since, one the export did not write, or one it wrote that is
  gone is a `PB_OUTPUT_STALE` warning, which `release` refuses.
- `protoboard/views`: a module with files on disk that a viewer tab draws
  (`out/schematic.svg`, `pcb-top.svg`, `pcb-bottom.svg`, `bom.csv`, a GLB,
  the native `circuit.json`) and no artifact naming them gets
  `PB_VIEW_UNREACHABLE` (a warning on a circuit board, info otherwise), with
  the reason: the provider is not loaded, declares no `artifacts`, or the
  module's own artifact of that id names another file. `protoboard views
  check` opens every tab in a headless browser and fails on one that throws
  or draws nothing.
- `ext:<provider id>/<capability>:check`, once per module (`subject` in the
  JSON): your diagnostics, attributed to you. A diagnostic without `entity`
  or `source` gets the module and its config file. If your check throws, or a
  tool it `requires` is missing, the run is `skipped` with the reason: the
  result is unknown, not passed.

## 6. Test against the contract

`runProviderContract` runs generate, export, extract and check on one module
and reports every contract violation:

```ts
import { loadProject, runProviderContract } from "@protoboardai/core";

it("passes the circuit contract", async () => {
  const p = await loadProject(fixtureProject);
  const report = await runProviderContract(p, "circuit", "board");
  expect(report.steps.flatMap((s) => s.problems)).toEqual([]);
});
```

It requires each step to succeed, generate to write native files, export to
write standard outputs that validate, extract to return valid facts, and check
to find no errors in a design it has just generated.

`packages/core/test/fixtures/providers/` has three fake providers (two
`circuit`, one `cad`) that pass this contract with minimal, syntactically
valid files. They are test fixtures, not tools, but they show the shape of
each operation, and `packages/core/test/capabilities.test.ts` shows a project
switching between them.

The real providers in Stack v0.1 are the best examples to copy:

| Capability | Provider | Tool | Where to see it |
| --- | --- | --- | --- |
| `circuit` | `@protoboardai/ext-tscircuit` | tscircuit, in process (exact npm pins) | its test board `packages/ext-tscircuit/test/fixtures/imu-tile`; the watch and bottle boards |
| `cad` | `@protoboardai/ext-frame-cad` | build123d (`cad` runtime) | the quadcopter's frame, top plate and mounting hardware |
| `cad` | `@protoboardai/ext-harness-cad` | build123d, numpy, scipy | the quadcopter's ten cables; the watch's and bottle's cables |
| `cad` | `@protoboardai/ext-enclosure-cad` | build123d, numpy, scipy | the watch case and the bottle cap |
| `cad` | `@protoboardai/ext-parts` | the part's own build123d script | the quadcopter's bulk capacitor |
| `firmware` | `@protoboardai/ext-zephyr` | none (writes Zephyr 4.2 files) | `packages/ext-zephyr/test/fixtures/watch-core`; the watch board |
| `firmware` | `@protoboardai/ext-esp-idf` | none (writes ESP-IDF 5.3 files) | `packages/ext-esp-idf/test/fixtures/bottle-core`; the bottle board |

Their manifests (operations, constraints, tools and runtimes) are listed in
[extensions and skills](../reference/extensions.md), generated from the
`protoboard-extension.json` files.

## 7. Tool runtimes

A provider that needs Python or Node packages declares them as a tool with a
**runtime**, and the project installs them with `protoboard tools install
<runtime id>` into `.protoboard/tools/<runtime id>/`. Nobody installs them
globally or exports a variable.

```json
"tools": [
  {
    "id": "tscircuit",
    "purpose": "tscircuit core, checks and exporters (Node)",
    "probe": ["node", "-e", "require(require('path').join(process.env.PROTOBOARD_CIRCUIT_MODULES, '@tscircuit/core/package.json'))"],
    "runtime": {
      "id": "circuit",
      "kind": "node",
      "packages": [
        "@tscircuit/core@0.0.2056",
        "@tscircuit/props@0.0.677",
        "@tscircuit/checks@0.0.233",
        "@tscircuit/footprinter@0.0.430",
        "circuit-json@0.0.510",
        "circuit-json-to-gerber@0.0.111",
        "circuit-json-to-step@0.0.43",
        "circuit-json-to-gltf@0.0.141",
        "circuit-to-svg@0.0.438"
      ],
      "env": "PROTOBOARD_CIRCUIT_MODULES"
    }
  }
]
```

A Python runtime also says which Python versions its pins have wheels for,
as `"python": ">=3.11,<3.15"` beside `packages`. `protoboard tools install`
then creates the venv with a Python in that range that works: it tests every
Python it finds (`--python`, `PATH`, Homebrew, python.org, uv, pyenv, the
Windows launcher) for the version and for `venv`, `ensurepip`, `pyexpat`,
`ssl` and `zlib`, and lists the ones it refused with the reason. With none,
it says what to install on that platform. Several tools' ranges are
intersected.

A probe is a command whose zero exit means the tool is usable. The first
probe of a runtime's tool in a project may take up to three minutes (a cold
first import), later ones 20 seconds. One probe is built in, because a shell
one-liner cannot find a browser on every platform: `"probe":
["protoboard:browser"]` finds a Chromium-family browser the way the document
renderer does (`CHROME` wins).

The example shows the shape with tscircuit's versions as installed from npm on 2026-10-02.
`@protoboardai/ext-tscircuit` itself does not declare a runtime: it runs
tscircuit in Protoboard's process, so it pins the packages as exact npm
dependencies in its own `package.json` and declares only the `tscircuit-node`
tool (section 1). A runtime suits tools a provider spawns or loads from a
folder of its own: ext-frame-cad and ext-harness-cad share the `cad` Python
runtime.

| Field | Meaning |
| --- | --- |
| `id` | The runtime: what `protoboard tools install <id>` installs. Providers of one capability share it (`circuit`, `cad`); their pins are merged, and a package pinned at two versions is an error. Not `all`. |
| `kind` | `python`: a venv. `node`: a folder with its own `package.json` and `node_modules`. |
| `packages` | Exact pins only: `name==1.2.3` (pip) or `name@1.2.3` / `@scope/name@1.2.3` (npm). A range invalidates the manifest. |
| `env` | Optional variable the runtime sets when the user has not: the venv's interpreter for `python`, the `node_modules` folder for `node`. The runtime's bin folder also goes first on `PATH`. |

While your operations and checks run, the variables are set and `PATH`
includes the runtime, so a probe or a spawned tool finds it. In code, ask for
the folder directly:

```ts
import { createRequire } from "node:module";
import { join } from "node:path";
import { projectRuntime } from "@protoboardai/core";

const rt = projectRuntime(ctx.project.root, "circuit"); // undefined until installed
const load = createRequire(join(rt!.nodeModules!, "package.json"));
const { Circuit } = load("@tscircuit/core");
```

List the tool in each operation's `requires`, so a run without the runtime is
refused (and a check skipped) with the tool's `install` hint instead of
failing halfway. `protoboard doctor` shows where each tool was found: the
project runtime, a variable the user set (which wins), or the system.

## 8. Ship it

A provider is an npm package with `protoboard-extension.json` at its root and
the entries the manifest names. To make it usable:

- List the manifest, the operation and check entries, any Python or other
  files they load, `skills/` and `evals/` in `files` in its `package.json`,
  with `@protoboardai/core` (and `@deltarobotics/uhd`) as peer dependencies.
- Declare every external tool with a probe, and an exact-pinned runtime
  where `protoboard tools install` can provide it (section 7).
- Ship a skill (an SOP, [format](sop-format.md)) that says how a module is
  configured for it and what each of its diagnostic codes means, and add the
  codes to the [diagnostic codes reference](../../packages/ext-hardware/skills/system-compose/references/diagnostic-codes.md)
  (`packages/cli/test/skills-sop.test.ts` fails on an emitted code it does
  not list).
- Ship at least one eval case in `evals/` ([evals](evals.md)).
- If the Manufacturing Package should carry more than your standard outputs
  (a fabrication order, inspection steps), add `package:<section>`
  operations ([ext-release](../../packages/ext-release/README.md#section-contract)).
- Run `node scripts/reference-docs.mjs` in this repository so the extension
  index lists it.

Projects install it like any npm package, by version. In v0.1 the
first-party providers are published with the rest of the stack to the local
registry ([Local registry and project templates](local-registry.md)): a
provider in this workspace is picked up by `scripts/registry/publish-stack.mjs`
when it is a `packages/ext-*` package, stays `"private": true` in its
`package.json`, and names `http://127.0.0.1:4873/` in `publishConfig.registry`.
A provider outside the workspace is published to that registry with
`npm publish --registry http://127.0.0.1:4873/` under a scope the registry
accepts (`@protoboardai`, `@deltarobotics` in `registry/config.yaml`).

## Diagnostic codes

| Code | Severity | Meaning |
| --- | --- | --- |
| `PB_CAPABILITY_CONFIG_INVALID` | error | The config does not evaluate, has no default export or provider, or has an invalid `process`. |
| `PB_CAPABILITY_CONFIG_UNKNOWN_KEY` | warning | A top-level key other than `provider`, `module`, `constraints`, `process`. |
| `PB_CAPABILITY_MODULE_NOT_FOUND` / `_AMBIGUOUS` | error | No module, or several, in the config's folder; or `module` names an unknown id. |
| `PB_CAPABILITY_DUPLICATE` | error | Two configs of one capability for one module. |
| `PB_CAPABILITY_CONSTRAINT_UNKNOWN` / `_MISSING` | warning / error | Against the provider's declared constraints. |
| `PB_PROVIDER_NOT_INSTALLED` | error | The named package is not installed. |
| `PB_PROVIDER_UNAVAILABLE` | error | Installed, but its manifest did not load (see its `PB_EXTENSION_*` finding). |
| `PB_PROVIDER_LACKS_CAPABILITY` | error | The package does not declare this capability. |
| `PB_OUTPUT_NOT_EXPORTED` | info | No outputs of this capability in `out/` yet (the message names the capability, and the other capabilities' outputs `out/` holds). |
| `PB_OUTPUT_STALE` | warning | An output differs from what its latest export record wrote: edited by hand, not written by that export, or removed since. |
| `PB_OUTPUT_MISSING` | error | A required standard output is absent. |
| `PB_OUTPUT_MALFORMED` | error (some warnings) | A file fails its format check. |
| `PB_OUTPUT_UNKNOWN_INSTANCE` | error | A BOM, PnP or netlist key that is not in the module. |
| `PB_OUTPUT_INCOMPLETE` | warning | A component missing from the BOM or the manifest. |
| `PB_EXTRACT_INVALID` | error | Facts from `extract` that do not fit the module (on the operation record). |

Firmware providers built on `firmwareOperations` add these (from `check`, and
on a refused `generate`):

| Code | Severity | Meaning |
| --- | --- | --- |
| `FW_NO_CONTROLLER` / `FW_CONTROLLER_AMBIGUOUS` | error | No microcontroller on the board, or several (name one with `constraints.controller`). |
| `FW_PIN_NOT_GPIO` / `FW_PIN_UNKNOWN` | error | A signal on a controller pin that is not a GPIO (supply, NC, enable); a pin name in the native files that the controller's pin table does not have. |
| `FW_PIN_REUSED` / `FW_BUS_CROSSED` | error | A controller pin with two functions; two devices that disagree about one line (a peripheral's SDA and SCL swapped, or two SPI devices sharing SCK but not MOSI). Devices that agree on every line they share are one bus: a write-only display and a flash on one SCK/MOSI are one SPI bus with MISO. |
| `FW_BUS_PROTOCOL` | error | A bus signal on a pin the part does not list for it (`i2c_sda`, `spi_sck`, …), such as a low-frequency pad. |
| `FW_BUS_INCOMPLETE` | error | A peripheral's required bus line not wired to the controller. |
| `FW_BUS_INSTANCES` | error | More buses of a kind than the SoC has controllers. |
| `FW_BUS_SPEED` | error | A configured clock faster than a device or the controller allows. |
| `FW_I2C_ADDRESS_CONFLICT` / `FW_I2C_ADDRESS_UNKNOWN` | error / warning | Two devices at one address on one bus; a device that states no address (an error when the provider sets `i2cAddressRequired`, as Zephyr does: a devicetree I2C node needs `reg`). |
| `FW_STRAPPING_DRIVEN` / `FW_STRAPPING_PIN` / `FW_STRAPPING_BUTTON` | error / warning / info | A peripheral output on a strapping pin; another use of one; a button there (a BOOT button). |
| `FW_WAKE_INVALID` / `FW_WAKE_UNKNOWN` | error | A wake source on a pin that cannot wake the chip from its deepest sleep; one that is no input of the board. |
| `FW_PROPERTY_MISSING` / `FW_PROPERTY_INVALID` | error | A driver binding needs a value the model does not state (set it in `constraints.properties`). |
| `FW_NATIVE_EDITED` / `FW_NATIVE_STALE` / `FW_PIN_DRIFT` | warning / error / error | Native files edited by hand, or no longer matching the board (export refuses both); pins they name that the board does not wire, or the reverse. |
| `FW_SPI_CS_MISSING` / `FW_BUTTON_CODES` | error / warning | Zephyr: a device sharing an SPI bus with no chip select; more buttons than the provider has key codes for (36), so the extra ones get none. |
| `FW_BUS_SHARED` | error | Two devices on one UART's lines. |
| `FW_PINS_SHORTED` / `FW_BUTTON_FLOATING` / `FW_BOARD_UNREADABLE` | warning | Two controller pins on one net; a button with no ground or supply side; a board link the netlist cannot read. |
| `FW_NET_UNUSED` | info | A controller pin wired to something firmware does not configure. |
| `FW_LINE_UNCITED` | error | A generated setting line cites no fact (a provider defect). |
| `FW_NOT_GENERATED` | info | Nothing generated yet. |
