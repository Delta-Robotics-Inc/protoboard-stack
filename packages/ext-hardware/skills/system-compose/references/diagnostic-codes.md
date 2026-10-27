# Diagnostic codes

`protoboard check --format json` returns every finding with a stable `code`.
Prefixes name the producer: `PB_` framework, `UHD_` UHD validators, `HW_`
ext-hardware checks, `FRAME_CAD_` and `HARDWARE_CAD_` ext-frame-cad,
`HARNESS_` ext-harness-cad, `ENCLOSURE_` ext-enclosure-cad, `CIRCUIT_`
ext-tscircuit, `SRC_` ext-sourcing. Codes are stable; messages are for
people. Act on the code, read the message for the detail.

This is the reference every SOP's **Failure handling** points at. A code you
do not find here comes from an extension outside this repository:
`protoboard doctor` lists the installed checks, and the extension's README
explains its codes.

## Framework: loading and resolution (`protoboard/*`)

| Code | Severity | Means | Do |
| --- | --- | --- | --- |
| `PB_SOURCE_LOAD_FAILED` | error | A `src/**/*.uhd.ts` or `parts/local/**/*.uhd.ts` file threw on import. | Fix the TypeScript error shown; nothing in that file is loaded until then. |
| `PB_DEFINITION_INVALID` | error | A definition's `interfaces` list holds something that is not one interface: most often a builder that returns several (`AcPower(...)`) placed without `...`. The definition is left out, so its instances also report `PB_UNRESOLVED_DEFINITION`. | Spread the builder (`...AcPower(...)`) or fix the entry the message names. |
| `PB_SOURCES_IN_CATALOG` | info | A `sources` glob in `protoboard.config.ts` matches files in the catalog folder (directly or through a link). They are not loaded as the project's code: a vendored part's source is evaluated confined, from `parts/origins.json`. | Narrow `sources` (the default is `src/**/*.uhd.ts` and `parts/local/**/*.uhd.ts`). |
| `PB_STACK_REPLACE_REFUSED` | error (a command's) | `protoboard stack unpack` (or the extension's "Add the Stack from Another .vsix File") found a copy of the same stack version from another build in `~/.protoboard/stack`, and replacing it was not agreed to. | Replace it only if you trust where the file came from: `protoboard stack unpack <file> --replace`, or answer the extension's question. |
| `PB_ROOT_NOT_FOUND` | error | `protoboard.config.ts` names a root export that does not exist. | Fix `root.source` / `root.export`. |
| `PB_DUPLICATE_DEFINITION` | error | Two definitions share an id (e.g. a catalog part and a local edit of it). | Give the local variant its own id; record what it derives from. |
| `PB_UNRESOLVED_DEFINITION` | error | A child's `moduleDefId` is defined nowhere. | `protoboard parts add <id>`, author it in `parts/local/` (**part-handoff**), or fix the id. Check that `sources` in `protoboard.config.ts` covers `parts/local/**/*.uhd.ts`. Blocks system checks. |
| `PB_CONTAINMENT_CYCLE` | error | A module contains itself through its children. | Break the cycle. Blocks system checks. |
| `PB_INVALID_ENDPOINT` | error | A link end names a child or interface that does not exist (or is not exported by a sub-assembly). | Fix the id, or add the export. Blocks system checks. |
| `PB_UNKNOWN_HARNESS` | error | A link's `harness` is not a child of the declaring module. | Add the harness child, or fix the name. |
| `PB_MISSING_ARTIFACT` | error | A local artifact file (CAD, generated body) is missing. | Regenerate it (e.g. `protoboard run cad:export --module <id>`) or fix the path. |
| `PB_ARTIFACT_PATH_UNSAFE` | error or warning | A catalog or vendored part's artifact `filePath` is not a normalised path inside the part's folder: error when it could lead out of it (absolute, `..`, a backslash, a drive, NUL, or a link that points outside), warning when it is only written oddly (`./x`). The file is not resolved, so nothing reads, serves or opens it. | Nothing to do for a warning on a library part. An error means the vendored part was changed or is hostile: `protoboard parts add <id>@<rev>` restores it; remove a link planted in its folder. |
| `PB_ARTIFACT_UNAVAILABLE` | warning | An optional artifact (vendor/research file, catalog-held, URL-backed) is not present locally. For a catalog part the message gives the revision's reason for not carrying it (redistribution not cleared, not in the source). | Fine offline; materialise it before a release if the release needs it. |
| `PB_PACKAGE_SCOPE_RENAMED` | error | The project names packages under the stack's former npm scope, `@protoboard/…`: in `package.json`, in `extensions` of `protoboard.config.ts`, or as the `provider` of a capability config. The packages are `@protoboardai/…` since stack 0.1.1; the old name on npmjs is not Protoboard's. One finding lists every place. An import of an old package fails with the same explanation (`protoboard.config.ts: Cannot find package …`, `PB_SOURCE_LOAD_FAILED`, `PB_CAPABILITY_CONFIG_INVALID`). | Replace `@protoboard/` with `@protoboardai/` in those files and in the project's imports, point `@protoboardai:registry` in `.npmrc` at the registry, run `npm install`, then export the bound modules again (their configs changed). Never `npm install` an `@protoboard/…` package. |
| `PB_BOM_SETTINGS_INVALID` | error | `parts/bom.json` (the units to build and the offers chosen for the bill of materials) is not JSON or not `protoboard.bom-settings/v0`. | Fix what the message names, or delete the file and set it again with `protoboard bom units <n>` and `protoboard bom choose <line> <offer>`. |
| `PB_FX_RATES_INVALID` | error | `parts/fx-rates.json` (the project's own currency rate table) is not JSON or not `protoboard.fx/v0` (base, date, source, rates). | Fix what the message names, or delete the file: the bill of materials then converts with the dated table the Stack ships. |
| `PB_EXTENSION_NOT_INSTALLED` | error | `protoboard.config.ts` lists an extension that is not in `node_modules`. | Check the name. The Protoboard installed on the machine carries every extension: `npx protoboard stack` says what the project is linked to. In a project with its own copy of the stack, ask the person before installing the package there. |
| `PB_EXTENSION_NO_MANIFEST` | error | The package has no `protoboard-extension.json`. | It is not a Protoboard extension; remove it from `extensions`. |
| `PB_EXTENSION_MANIFEST_INVALID` | error | The manifest breaks the schema: a missing field, a duplicate id, an operation requiring an undeclared tool, a tool runtime with a version range, an invalid capability or view (`contributes.views`) declaration. | Fix the extension (or report it to its author); `protoboard doctor` shows the message. |
| `PB_EXTENSION_INCOMPATIBLE` | error | The extension needs another framework or UHD version. | Install a compatible version of the extension or the framework. |
| `PB_EXTENSION_VIEW_DUPLICATE` | warning | Two extensions contribute a view with the same id; the second is ignored. | Rename one of the views (`<extension>.<view>`), or drop one of the extensions. |

## Framework: parts and the cloud catalog (`protoboard/catalog`)

| Code | Severity | Means | Do |
| --- | --- | --- | --- |
| `PB_ORIGIN_MISSING` | error | A catalog JSON has no origin record. | Add it with `protoboard parts add` rather than copying files in. |
| `PB_DIGEST_MISMATCH` | error | A catalog definition's bytes changed since download. | Re-download it; to change a part, derive a local variant. |
| `PB_CATALOG_PARSE`, `PB_CATALOG_FILE_MISSING` | error | Broken or missing catalog file. | Re-download with `protoboard parts add <id>@<rev>`. |
| `PB_VENDORED_FILE_MISMATCH` | error | A file vendored with a catalog revision (CAD, evidence) no longer matches the digest recorded in `parts/origins.json`. | `protoboard parts add <id>@<rev>` restores it; to change the part, derive a local variant. |
| `PB_VENDORED_FILE_MISSING` | warning | A file vendored with a catalog revision has been deleted. | `protoboard parts add <id>@<rev>` restores it. |
| `PB_CATALOG_LAYOUT_EARLIER` | info | Vendored parts are in the folder layout of Protoboard 0.1.6 and earlier, whose paths repeat the part id (too long for Windows in a nested project). They load as they are. | `protoboard parts migrate` (offline; the pins stay); commit the moves with `parts/origins.json`. |
| `PB_SOURCE_DRIFT` | error | A catalog part's vendored `.uhd.ts` source (or a module it imports) no longer evaluates to the definition pinned in `parts/origins.json`: it was edited, or the project's UHD gives another result. The project builds the pinned JSON, not the drifted source. | `protoboard parts add <id>@<rev>` restores the source; to change the part, copy it to `parts/local/` under a new id. |
| `PB_SOURCE_EDITED` | info | Vendored source differs from what was vendored but still evaluates to the pinned definition (a comment, formatting). | Nothing is wrong; `parts add <id>@<rev>` restores the original. |
| `PB_SOURCE_LOAD_FAILED` | error | A catalog part's vendored source does not evaluate; the pinned JSON is used. | Restore it with `protoboard parts add <id>@<rev>`. |
| `PB_SOURCE_LINT` | error | A catalog part's vendored source breaks UHD's lint (an import other than `@deltarobotics/uhd` and its own files, host access such as `process` or `fetch`, `eval`, reflection); it is not evaluated and the pinned JSON is used. | Restore it with `protoboard parts add <id>@<rev>`; to change the part, copy it to `parts/local/` under a new id. |
| `PB_SOURCE_FILE_MISSING` | warning | A file of a catalog part's vendored source was deleted; the pinned JSON is used. | `protoboard parts add <id>@<rev>` restores it. |
| `PB_SOURCE_UHD_RANGE`, `PB_SOURCE_UHD_UNKNOWN` | error | The project's `@deltarobotics/uhd` is outside the range the part's source requires (or the project has none). | Pin a UHD in that range, update the part to a revision written for yours, or vendor it `--compiled`. |
| `PB_SOURCE_TS_RANGE`, `PB_SOURCE_TS_UNPINNED` | warning | The project's TypeScript is outside the range the part's source is written for, or the project does not pin TypeScript. | Pin `typescript` in `package.json` devDependencies. |
| `PB_UHD_PIN` | warning | `package.json` pins `@deltarobotics/uhd` exactly and another version is installed; the check ran with the installed one. | Run `npm install` to get the pinned version, or move the pin to the installed one (within one minor line, such as 0.2.0 and 0.2.1, parts and definitions need no change). |

`parts search`, `parts add`, `parts update` and `parts publish` report
service problems (service unreachable, part or revision not found,
incompatible schema) as command errors with exit code 2, not as check
diagnostics: nothing else talks to the service.

## Framework: capabilities and standard outputs (`protoboard/capabilities`, `protoboard/standard-outputs`)

The contract behind them is in the stack repository's
`docs/guides/writing-a-capability-provider.md` ("Diagnostic codes").

| Code | Severity | Means | Do |
| --- | --- | --- | --- |
| `PB_CAPABILITY_CONFIG_INVALID` | error | A `circuit.config.ts` or `cad.config.ts` does not evaluate, has no default export or provider, or has an invalid `process`. | Fix the config; it is `export default defineCapabilityConfig({ provider, constraints?, module?, process? })`. |
| `PB_CAPABILITY_CONFIG_UNKNOWN_KEY` | warning | A top-level key other than `provider`, `module`, `constraints`, `process`. | Provider settings go in `constraints`. |
| `PB_CAPABILITY_MODULE_NOT_FOUND` | error | No module is declared in the config's folder, or `module` names an unknown id. | Put the module's `.uhd.ts` in the folder, or name it with `module: "<id>"`. |
| `PB_CAPABILITY_MODULE_AMBIGUOUS` | error | The folder declares several modules. | Name the one this config designs with `module: "<id>"`. |
| `PB_CAPABILITY_DUPLICATE` | error | Two configs of one capability for one module. | Keep one. |
| `PB_CAPABILITY_CONSTRAINT_UNKNOWN` | warning | A constraint the provider does not declare. | Check the spelling against the provider's README; remove it if it is not the provider's. |
| `PB_CAPABILITY_CONSTRAINT_MISSING` | error | A constraint the provider requires is absent. | Add it (the message names it). |
| `PB_PROVIDER_NOT_INSTALLED` | error | The config names a package that is not installed. | As for `PB_EXTENSION_NOT_INSTALLED`: check the name and `npx protoboard stack`; ask the person before installing a package in the project. |
| `PB_PROVIDER_UNAVAILABLE` | error | Installed, but its manifest did not load. | See its `PB_EXTENSION_*` finding. |
| `PB_PROVIDER_LACKS_CAPABILITY` | error | The package does not provide this capability. | Name a provider of it (`protoboard capabilities` lists them). |
| `PB_OUTPUT_NOT_EXPORTED` | info | The module has a config but no outputs of that capability in `out/` yet; the message names the capability (a board may have its circuit outputs and not its firmware's). | `protoboard run <capability>:generate --module <id>`, then `<capability>:export`. |
| `PB_OUTPUT_STALE` | warning | A file in `out/` is not what the latest export wrote (the record in `operations/`): edited by hand, added, or removed since. `release` refuses it. | Re-run the export the message names; never edit `out/` by hand. |
| `PB_OUTPUT_MISSING` | error | A required standard output is absent (for `cad`, `process: print` needs STL or 3MF, `cut` needs DXF). | Re-export; if it persists, the provider does not support the process: change `process` or the provider. |
| `PB_OUTPUT_MALFORMED` | error (some warnings) | A file in `out/` fails its format check (truncated Gerber, a GLB with a wrong header, a CSV without its key column). | Re-export; never edit `out/` by hand. A persistent one is a provider bug. |
| `PB_OUTPUT_UNKNOWN_INSTANCE` | error | A BOM, PnP or netlist row names an instance the module does not have. | The module changed since export: regenerate and re-export. |
| `PB_OUTPUT_INCOMPLETE` | warning | A component missing from the BOM or the manifest. | Regenerate and re-export; if it persists, the provider skipped the component (read its export summary). |
| `PB_EXTRACT_INVALID` | error | Facts from `extract` that do not fit the module (on the operation record, not in `check`). | Re-run `extract` after `generate`; a persistent one is a provider bug. |
| `PB_VIEW_UNREACHABLE` | warning (a board), info (other modules) | A module has outputs on disk that a viewer tab draws (`out/schematic.svg`, `pcb-top.svg`, `pcb-bottom.svg`, `bom.csv`, a GLB, the routed `circuit.json`) and no artifact names them, so the tab does not appear. The provider attaches its declared outputs by itself; the message says why that did not happen (provider not loaded, no declaration, or the module's own artifact of that id names another file). | Let the provider attach them (drop the module's own artifact of that id), or list them in the module's artifacts; then `protoboard views check --module <id>` shows the tabs. |

## Framework: the local viewer (`protoboard dev`)

Shown in the viewer's checks panel and the dev log, not by `check`.

| Code | Severity | Means | Do |
| --- | --- | --- | --- |
| `PB_DEV_BUILD_FAILED` | error | The last rebuild after a change failed; the viewer keeps the last good bundle. | Fix the error in the message (usually a source that does not load), save, and it rebuilds. |
| `PB_DEV_DISPLAY_INVALID` | error | `.protoboard/display.json` is not valid JSON; the viewer keeps the last valid layout. | Fix the file (or `git checkout` it). |
| `PB_DEV_LAYOUT_NOT_SAVED` | warning | A layout edit from the viewer could not be written to `display.json`. | Read the reason; the edit stays only in the open page until it is saved. |

## Framework: the diagram's layout (`protoboard/layout`)

From `check`, for the levels of modules (a board's own sheet is reported by
`protoboard layout` only).

| Code | Severity | Means | Do |
| --- | --- | --- | --- |
| `PB_DIAGRAM_LAYOUT` | info | A level of the diagram is hard to read as the viewer draws it: a long row or column of cards (a strip), cards on top of each other, a drawing far from a screen's shape, or many line crossings. The message names the level and the numbers. | `protoboard layout <level>` for the details; fix it with `--apply` (afresh), `--tidy` (your arrangement, fixed) or by moving cards, then look at it in the viewer. Two tries; then say what is left. |

## UHD system rules (`uhd/checkSystem`, code = `UHD_` + rule)

| Code | Severity | Means | Do |
| --- | --- | --- | --- |
| `UHD_LINK_STATE` | error / warning | Link DRC: the two interfaces are incompatible (error: ranges do not overlap, protocols do not match) or need configuration / were matched only by inference (warning). The message names the parameter. | Wrong endpoint → relink. Wrong part → change the part. Missing parameter on one side → add it from the datasheet. Never widen a range to pass. Cable links report here too: `connector_mismatch` / `connector_gender` / `connector_positions` (the plug does not fit the socket), `compose_unknown_slot` (a composition names a position the cable end lacks) and `harness_wiring` (a conductor lands on the wrong pad inside a UART/I2C). Diagnostics on a derived link name the cable links it runs through. |
| `UHD_SUPPLY_BUDGET` | error / warning / info | Known loads on a supply need more than 100 % (error) or 80 % (warning) of its power; the message lists loads that state no draw. Infos explain branch budgeting or a source with no current rating. | Move loads, choose a stronger rail, or add the missing draw/rating from a source. Unknown loads mean the budget is a lower bound. |
| `UHD_PROPULSION_CURRENT` | error / warning / info | Motors' combined peak current against the battery's continuous and burst ratings. | Error: redesign. Warning: decide and record (current limit, pack choice). |
| `UHD_BUS_ADDRESS` | error | Two devices share an address on one bus. | Change an address (if the part allows), use another bus, or drop the device. |
| `UHD_BUS_PULLUP` | warning | A board net carries I2C but no resistor pulls it up to a supply. | Add the pull-ups to the board module (as components linked to the net), or cite the part that has them on board. |
| `UHD_NET` | error / warning | A board net is wrong: driven by two supplies, joining ground to a supply (a short), a pin on two nets, a pin rated below the net's voltage, a passive with both terminals on one net, a part's output tied to its own input (VOUT on VIN), a strap pin (such as an address select) on a bus line, or (warning) a net with fewer than two members. | Fix the board's links or the part choice; a one-member net is unfinished or a test point to state. |
| `UHD_DESIGN_ENVELOPE` | error | A module is bigger than its `design_envelope` trait. | Shrink the design, or revisit the envelope with whoever set it (the brief). |
| `UHD_PASSIVE_OVERRIDE` | error | A placement's `overrides` on a passive are not ones the part allows, or disagree with its series: a key not in the part's `overridable`, a value outside the series range or not made at the tolerance grade, a value off a table series, an MPN that cannot be formed or that decodes to other parameters. | Fix the board child's `overrides` (the part's `usage_note` with topic `instance` says which keys it takes); name the exact `part_number` where the series cannot form it (Murata GRM). |
| `UHD_INTERFACE_REUSE` | error | An interface is linked more times than it supports (two devices on one UART). | Use a free interface. |
| `UHD_UNPOWERED` | warning | A power input has no supply link. | Link the real supply. If the part is powered through a connector modelled elsewhere, model that link. If the input stays open on purpose (a DC jack unused because the product runs from USB, a motor terminal waiting for a battery), mark it on the instance: `unconnected: [{ interfaceId, reason }]`; it is then reported as info with the reason, and the release's test plan does not power it. |
| `UHD_UNCONNECTED` | warning | An instance marks an interface as unconnected (`ChildModuleRef.unconnected`), but a link connects it, or the mark names an interface the part does not have. | Remove the mark or the link, whichever is wrong; fix the interface id. |
| `UHD_HARNESS_CONNECTOR` | error | A harness end's connector does not match the interface it mates. | Fix the harness end, or the connector choice. |
| `UHD_FASTENER_TORQUE` | warning | A fastener joint has no tightening torque, or a torque cites neither source nor assumption. | Add `torque` to the stack item with `source`, or an `assumption` plus the reference tables it was derated from (**harness-author**). |
| `UHD_PROP_HANDEDNESS` | error / warning | A prop's spin does not match its motor, or spin is not set. | Set `spin` on the instance (`ChildModuleRef.spin`, inherited down the tree: once per arm) and fit the variant that matches. |

## UHD assembly (`uhd/assemble`)

| Code | Severity | Means | Do |
| --- | --- | --- | --- |
| `UHD_ASSEMBLY` | error / warning | A mate is inconsistent: rotation outside the pattern's symmetry ("the holes will not line up"), over-constrained placement, a fastener stack that names a non-child, a nut no screw reaches or a screw that stops short of the nut's far face, harness quantity ≠ stack positions, a mechanical link without frames. | Fix the frame, gap, rotation or hardware length. Rework the stack-up arithmetic (**harness-author**). |
| `UHD_UNPLACED` | info | A module no mate reaches (strapped battery, receiver). | Expected for strapped/loose parts; give it a display placement (`spatial.placements` in `.protoboard/display.json`) so CAD providers and documents see it; otherwise add the missing mechanical link. |

## Geometry bindings (`uhd/geometryBindings`)

| Code | Severity | Means | Do |
| --- | --- | --- | --- |
| `UHD_GEOMETRY_BINDING` | error | A feature ref names an artifact the module lacks, a feature not in the manifest ("renamed or removed in the CAD?"), or a feature whose signature changed since binding ("re-bind explicitly"). | Review the CAD change. If intended: re-bind (**frame-cad**: `protoboard run frame-cad-rebind`; another `cad` provider: copy the frames `cad:extract` returns; hand-authored CAD: update the `feature(...)` signature). If not: fix the CAD. |

The check's `reason` also reports refs with no manifest (e.g. KCL sources):
those are unknown, not passed.

## ext-hardware (`ext:@protoboardai/ext-hardware/evidence`)

| Code | Severity | Means | Do |
| --- | --- | --- | --- |
| `HW_NO_SOURCES` | warning | A purchased part cites no sources. | **uhd-part-research**; or cite the supplier listing on hardware. |
| `HW_NOT_VERIFIED` | info | Sources but no recorded verification. | **uhd-part-verify**. |
| `HW_VERIFICATION_WRONG` | error | The audit found wrong facts with no recorded repair. | Repair with **uhd-part-author** (repair mode), re-verify. |
| `HW_VERIFICATION_REPAIRED` | info | Wrong facts were found and repaired. | Nothing; kept for traceability. |
| `HW_VERIFICATION_SELF_AUDIT` | info | The part's verification record is a self-audit (`audit.independent: false`): the agent that authored it checked it. | Run the independent stage-2 audit (**uhd-part-verify**) and record it with `--independent`. |

## ext-sourcing (`ext:@protoboardai/ext-sourcing/sourcing`)

Full table with the rules behind each: **supplier-compare** section 3.

| Code | Severity | Means | Do |
| --- | --- | --- | --- |
| `SRC_RECORD_INVALID`, `SRC_OFFER_INCOMPLETE` | error | A malformed `sourcing.json`, or a figure without supplier, MPN, URL, date or method. | Fix the record (**supplier-compare**). |
| `SRC_FORBIDDEN_FIELD`, `SRC_CREDENTIAL_IN_URL` | error | An order, cart or credential field, or a key in a URL. | Remove it; store the public product URL. Never commit a credential. |
| `SRC_SINGLE_SOURCE`, `SRC_LOW_STOCK`, `SRC_LIFECYCLE` | warning | A selection disqualifier nobody accepted. | Name an alternate (**lifecycle-alternates**), or a named person accepts the risk in `risks[]`. |
| `SRC_NO_OFFER`, `SRC_OFFER_MPN_MISMATCH` | warning | No offer with stock, or an offer for another ordering code. | Read more suppliers, or record the sibling code as an alternate. |
| `SRC_PART_MISMATCH`, `SRC_UNKNOWN_PART` | warning | A record in the wrong folder, or for an id the project does not define. | Move or rename the record. |
| `SRC_RISK_ACCEPTED` | info | A disqualifier a named person accepted. | Nothing; kept for traceability. |
| `SRC_STALE` | info | Newest offer older than 90 days. | Re-read offers before quoting anything (**supplier-compare**). |
| `SRC_UNVERIFIED`, `SRC_NO_CAPABILITY`, `SRC_LIFECYCLE_UNKNOWN`, `SRC_STOCK_UNKNOWN` | info | Coverage gaps. | Close them, or say in the record why they stay open. |

## ext-frame-cad (`ext:@protoboardai/ext-frame-cad/cad:check`, one run per plate; `…/frames`, `…/hardware`)

| Code | Severity | Means | Do |
| --- | --- | --- | --- |
| `FRAME_CAD_NOT_CONFIGURED` | info | A plate module has no `cad.config.ts` (the `frames` check). | Add one naming `@protoboardai/ext-frame-cad` in its folder (**frame-cad**). |
| `FRAME_CAD_NOT_A_PLATE` | error | The config points ext-frame-cad at a module that is not a plate (no `plate_thickness_mm`). | Add the plate's mechanical metadata, or name another `cad` provider (an enclosure: `@protoboardai/ext-enclosure-cad`). |
| `FRAME_CAD_NOT_GENERATED` | info | A plate module has no generated CAD yet. | `protoboard run cad:generate --module <id>`, then `cad:export`. |
| `FRAME_CAD_STALE` | warning | The interfaces or design values (config constraints) changed since the CAD was generated. | Regenerate; then review the returned re-bind list. |
| `FRAME_CAD_EXPORT_STALE` | warning | `out/` was exported from other parameters than the native design. | `protoboard run cad:export --module <id>`. |
| `FRAME_CAD_FRAME_MISMATCH` | error | A module frame differs from the generated plate's frame. | Review; `protoboard run frame-cad-rebind` if the new plate is right. Check dependent stack-ups. |
| `FRAME_CAD_UNKNOWN_INTERFACE` | error | Generated frames name an interface the module no longer has. | Regenerate after renaming/removing. |
| `FRAME_CAD_FRAME_MISSING` | warning | Generated geometry exists for an interface without a model frame. | Add the frame (re-bind). |
| `HARDWARE_CAD_PARAMS` | error | A local fastener module lacks a size the hardware generator needs (diameter, length, head or across-flats size). | Add it from the supplier listing (**harness-author** step 3); nothing is defaulted. |
| `HARDWARE_CAD_STALE` | warning | A fastener module's sizes changed since its body was generated. | `protoboard run cad:generate --module <id>`, then `cad:export` (or `run hardware-cad --input module=<id>` while iterating). |
| `HARDWARE_CAD_EXPORT_STALE` | warning | A fastener module's `out/` was exported from other params than its native `frame-cad/params.json`. | `protoboard run cad:export --module <id>`. |
| `HARDWARE_CAD_NOT_GENERATED`, `HARDWARE_CAD_NOT_CONFIGURED` | info | A bound fastener module has no params yet; a local fastener module has no body and no `cad.config.ts`. | Generate it; or add `parts/local/<id>/cad.config.ts` naming @protoboardai/ext-frame-cad (**frame-cad** step 6). |
| `PART_CAD_STALE`, `PART_CAD_EXPORT_STALE` | warning | A researched part's body script changed since generate, or its `out/` is from another generate. | `protoboard run cad:generate --module <id>`, then `cad:export` (**uhd-part-author**, In a project). |
| `PART_CAD_CONFIG`, `PART_CAD_NOT_GENERATED` | error, info | The part's `cad.config.ts` names no script in `part-cad/`, or it was never generated. | Fix `constraints.generator`; run generate and export. |

## ext-harness-cad (`ext:@protoboardai/ext-harness-cad/cad:check`, one run per cable; `…/routes`)

| Code | Severity | Means | Do |
| --- | --- | --- | --- |
| `HARNESS_NOT_CONFIGURED` | info | A wire harness has no `cad.config.ts` (the `routes` check). | Add one naming `@protoboardai/ext-harness-cad` (**harness-cad**). |
| `HARNESS_NOT_ROUTED` | info | No route yet. | `protoboard run cad:generate --module <id>`, then `cad:export`. |
| `HARNESS_ROUTE_STALE` | warning | The route was generated for other ends, conductors, length or build, or an end no longer meets its part. | Regenerate the cable (and the ones routed after it). |
| `HARNESS_EXPORT_STALE` | warning | `out/` was exported from an earlier route. | `protoboard run cad:export --module <id>`. |
| `HARNESS_ROUTE_LENGTH` | warning | Modelled and routed length differ. | Regenerate, or fix the length (**harness-cad**). |
| `HARNESS_ROUTE_WARNING` | warning | The router's own finding (clearance, bend radius, slack). | Fix the model, not the geometry (**harness-cad**). |
| `HARNESS_NOT_ROUTABLE` | error | The config names a module this provider cannot route. | Point the config at a wire harness with a `cable_build` trait. |

## ext-enclosure-cad (`ext:@protoboardai/ext-enclosure-cad/cad:check`, one run per enclosure)

Details of every check: the package README, "Checks". Usual fixes:
**enclosure-cad** "Failure handling".

| Code | Severity | Means | Do |
| --- | --- | --- | --- |
| `ENCLOSURE_NOT_GENERATED` | info | No generated design yet. | `protoboard run cad:generate --module <id>`, then `cad:export`. |
| `ENCLOSURE_FEATURE_INVALID` | error | A feature interface the provider cannot read. | Build the feature with the extension's builders (`Opening`, `Button`, …). |
| `ENCLOSURE_INPUT` | error | The model does not say enough (a served part with no frame, the enclosure not placed). | Add the frame or placement the message names. |
| `ENCLOSURE_STALE` | warning | Contents, features, design values or the job changed since generation (listed). | Review what changed, then regenerate. |
| `ENCLOSURE_NATIVE_EDITED` | info | The native design was edited after its last build. | `cad:export` rebuilds from it; `cad:generate` replaces it from the model. |
| `ENCLOSURE_GENERATOR_STALE` | warning | The design was built by another version of the generator: its recorded `sourceDigest` is not what `py/enclosure_cad.py` and `py/fit.py` give for its job now. `release` refuses it (`REL_STALE`). | `cad:generate` and `cad:export`, then review the diff (often only the digest lines change). |
| `ENCLOSURE_FEATURE_MISSING` | error | An interface with no generated feature, or the reverse. | Regenerate. |
| `ENCLOSURE_FRAME_MISMATCH` | error | A declared frame differs from the generated one. | Regenerate; take the frames from `cad:extract`. |
| `ENCLOSURE_GENERATOR` | error | A problem the generator reported (no room for a plunger flange, a feature that cut nothing, a frame off its surface). | Read the message; move the part or change the feature. |
| `ENCLOSURE_COLLISION` | error | A body inside intersects a wall, boss or column, or a plunger intersects a wall or a body. | Regenerate; if it persists, move the part, add a board cutout or set `cavity_mm`. |
| `ENCLOSURE_NOT_CONTAINED` | error | A body reaches outside the cavity. | As for a collision. |
| `ENCLOSURE_CLEARANCE` | warning | A body is closer to a wall than the design clearance. | Raise `clearance_mm`, or accept the contact and say so in the module. |
| `ENCLOSURE_FIT_UNCHECKED` | warning | The contents changed and Python is not available to re-analyse the fit. | `protoboard tools install cad`, then `protoboard check`. |
| `ENCLOSURE_THIN_WALL` | error / warning | Below the minimum wall. | Thicker `wall_mm`/`lid_mm`, a smaller cut, or move the feature. |
| `ENCLOSURE_MISALIGNED` | error | An opening, window, light pipe or plunger off the axis of what it serves. | The served part moved: regenerate. |
| `ENCLOSURE_RECESS` | error | The served part sits deeper behind an opening than allowed. | Move the part to the wall, or size the opening for the plug's overmold. |
| `ENCLOSURE_PLUNGER` | error | A plunger presses its switch at rest, cannot reach it, or its flange no longer holds. | Change `gapMm`/`protrudeMm`, or move the switch. |
| `ENCLOSURE_PLUG_FIT` | error / warning | The plug does not pass the opening, or its overmold has no flat seat. | Size or move the opening. |
| `ENCLOSURE_SEAL_SQUEEZE` | error | O-ring squeeze outside the chart row for its cross-section. | Choose the AS568 size that fits the groove; do not edit gland depths away from the table. |
| `ENCLOSURE_SEAL_FIT` | error / warning | Stretch over 5 %, or a face groove not sized to the O-ring. | Choose another AS568 size. |
| `ENCLOSURE_ENVELOPE` | error | Bigger than the module's `design_envelope`. | Thinner walls, a tighter cavity, or revisit the envelope with the brief's owner. |

## ext-tscircuit (`ext:@protoboardai/ext-tscircuit/circuit:check`, one run per board)

Details: the package README, "check". Usual fixes: **circuit-board**
"Failure handling".

| Code | Severity | Means | Do |
| --- | --- | --- | --- |
| `CIRCUIT_BOARD_UNREADABLE` | error | The UHD board cannot be read as a netlist: a component's part is undefined, a pin has no designator, a link joins a composite interface to a pin or a net (two functional ports linked directly are copper), two declared nets of one module are joined, a link reaches a sub-module's own net or a separate board, nets on one conductor state different voltages, or a sub-module has a quantity. | Fix the board module (or the part: **uhd-part-author** adds pin designators). |
| `CIRCUIT_BOARD_GROUPING` | warning | A board's sub-module declares an export the board neither links nor re-exports, or a sub-module contributes no parts (docs/specs/nested-boards.md §11). | Link the export, or mark it `unconnected` on the child with the reason. |
| `CIRCUIT_NOT_BUILT` | info | No build yet. | `protoboard run circuit:generate --module <id>`. |
| `CIRCUIT_STALE` | warning | The UHD board, `layout.json`, `footprints.json` or the constraints changed since generate, or the native source (or a file it imports, JSON included) since the build; or `out/` was exported from other inputs (what the board depends on in UHD, not descriptions or prices; a body; the provider; a converter). | `protoboard run circuit:generate --module <id>`, then `circuit:export`. |
| `CIRCUIT_DRC` | error | tscircuit's own DRC, or `@tscircuit/checks`, found an error. | Move parts (`layout.json`), widen the board, or change rules; regenerate. |
| `CIRCUIT_NET_OPEN`, `CIRCUIT_NET_SHORT`, `CIRCUIT_NET_EXTRA`, `CIRCUIT_UNROUTED`, `CIRCUIT_PIN_MISSING` | error | The copper's nets differ from the UHD board's nets. | Regenerate; if routing cannot complete, give parts room (`layout.json`, a larger outline, 4 layers). Never change the UHD nets to match the copper. |
| `CIRCUIT_PAD_UNNETTED` | error | A pin with several pads (a module's exposed ground pads) has pads the copper does not join to its net; boards generated before 0.1.7 netted only the first pad. | `protoboard run circuit:generate --module <id>` (it joins the pin's pads to each other), then `circuit:export`. |
| `CIRCUIT_FINGERPRINT_FORMAT` | info | `tscircuit/export.json` was written by a provider that fingerprinted the whole UHD module; the board's own dependencies are fingerprinted now, so the record is not compared for the board (no false stale). | `protoboard run circuit:export --module <id>` once. |
| `CIRCUIT_FOOTPRINT_FAMILY` | info | A part's land pattern was chosen by its package family (`SOT23-5L` → the `SOT-23-5` entry), its stated pin count, pitch and size agreeing. | Nothing; confirm the pattern when the part is unusual. |
| `CIRCUIT_FOOTPRINT_MISMATCH` | error | Land patterns of the part's package name or family exist, but none fits its facts (pin count, pitch, body size); the provider reports it instead of picking one. | Correct the part's package facts, or add a fitting entry to `tscircuit/footprints.json`. |
| `CIRCUIT_VIA_TOUCHING_PAD` | error | A via's ring touches an SMD pad it does not sit in, with `via_touching_pad: "avoid"`. | Move parts a little and regenerate. |
| `CIRCUIT_VIA_UNDER_BODY` | error | A via lies inside a component's courtyard, with `via_under_body: "avoid"`. | Give the parts room and regenerate. |
| `CIRCUIT_HOLE_CLEARANCE` | error | Copper (pad, plated hole, via, trace, pour) closer to a non-plated hole's wall than `rules.hole_clearance_mm` (or inside the hole); round holes are tested as circles. | Move the copper or the hole; regenerate. |
| `CIRCUIT_TRACE_WIDTH` | warning | A net is routed narrower than `trace_widths` asks for (the router necks traces down where the width does not fit). | Give the net room, or accept the neck-down. |
| `CIRCUIT_COMPONENT_MISSING`, `CIRCUIT_COMPONENT_EXTRA` | error | A UHD component is not on the board, or the board has one UHD lacks. | Regenerate; remove hand-added parts from `board.tsx`. |
| `CIRCUIT_OUTSIDE_OUTLINE` | error / warning | A pad off the board / a body overhanging the edge. | Move the part in `layout.json` or the config's `placements`, or enlarge the outline. |
| `CIRCUIT_KEEPOUT` | error / warning | Copper inside a keep-out / a keep-out that misses the board or both copper layers. | Move the part or trace; fix the keep-out's position or layers. |
| `CIRCUIT_PLACEMENT_MOVED` | error | A part the config fixes is somewhere else. | Remove the hand override in `board.tsx`/`layout.json`, regenerate. |
| `CIRCUIT_FOOTPRINT_UNVERIFIED` | warning | A land pattern the board uses has no verification record against its maker's recommended land pattern, or differs from it (pads, pitch, rows, slots, holes, courtyard, paste, mask). The board's work order holds while any is left. | Author the record from the maker's drawing (**circuit-board** step 2b), or fix the pads it names. |
| `CIRCUIT_VIA_IN_PAD` | error / info | A via inside an SMD pad / the same, with `via_in_pad: "fill_and_cap"` (the order asks the fab to fill and cap it). | Move parts and regenerate, or allow it with the fill-and-cap note. |
| `CIRCUIT_CONFIG_INVALID` | error | A `circuit.config.ts` constraint has the wrong type or value (outline, placements, keep-outs, or a fab-order key: `copper_oz` not a positive number, an empty `finish`, `solder_mask` or `silkscreen`, `assembly` not "fab" or "hand"). `circuit:generate` refuses it, and the release would print it wrong in the board order. | Fix the value the message names in `circuit.config.ts`, then regenerate. |
| `CIRCUIT_LOCKED` | info | The board is locked: KiCad (`<board dir>/kicad/`) is its layout of record since the handoff; tscircuit's build is not checked. | Review and finish it in KiCad (**kicad-layout-review**); `circuit:unlock` only when the person decides. |
| `CIRCUIT_KICAD_STALE` | error | Since lock the model added or removed a part or changed a land pattern, or the outline, holes, layers or thickness changed, and the KiCad board lacks it. | Make the change in KiCad (Update PCB from Schematic, place, route), or propose unlocking and regenerating. |
| `CIRCUIT_KICAD_MODEL_CHANGED`, `CIRCUIT_KICAD_FIELDS` | warning | Since lock connections between existing parts changed in the model (net renamed, pin moved), or an MPN, manufacturer, value or LCSC number. | Make the same change in the KiCad schematic and board; then `circuit:lock --input refresh=true`, asked first. |
| `CIRCUIT_KICAD_APPLIED` | info | A model change since lock is in KiCad too. | Ask, then `protoboard run circuit:lock --module <id> --input refresh=true` records it. |
| `CIRCUIT_KICAD_PART_MISSING`, `CIRCUIT_KICAD_NET_CHANGED` | error | A part was deleted, or a pin moved to another net, in KiCad, and the model does not say so. | Undo it in KiCad; if the change is wanted, make it in the UHD board module first. Nothing is written back. |
| `CIRCUIT_KICAD_PART_EXTRA`, `CIRCUIT_KICAD_FOOTPRINT_CHANGED`, `CIRCUIT_KICAD_NET_RENAMED`, `CIRCUIT_KICAD_PARITY` | warning | KiCad has a part the model lacks, a swapped footprint, a renamed net, or a schematic that disagrees with its board. | Add the part to the model or remove it in KiCad; restore the footprint or name; Update PCB from Schematic. |
| `CIRCUIT_KICAD_DRC` | error / warning / info | KiCad's own DRC of a locked board (`kicad-cli pcb drc --format json --severity-all --schematic-parity`, the same run and count as `circuit:export`): errors or unconnected items are an error, warnings alone a warning. Without kicad-cli it is read from the last export's `out/drc.json` (said when the board changed since), else info. | Fix the layout in KiCad (Inspect > Design Rules Checker; the kicad-layout-review skill). A forced export does not make it pass. |
| `CIRCUIT_VIA_RULES` | error | A via smaller than the config's `rules.via_pad_mm` / `via_drill_mm` (a via written by hand). | Make it to the rules, or change the rules if the fab can make it. |
| `CIRCUIT_HAND_PAD_JOIN` | warning | A trace written by hand in `board.tsx` joins pads of one pin, which generate joins itself (since 0.1.7); in KiCad it is copper on no net. | Remove the trace from `board.tsx`, then generate. |
| `CIRCUIT_KICAD_UNREADABLE` | error | A locked board's KiCad file is missing or cannot be parsed. | Restore it from git, or re-save it from KiCad 10. |

## Codes from firmware providers, releases and sections

Three more families come from operations rather than from the checks above;
their own references hold the full tables.

| Family | Where it shows | Reference |
| --- | --- | --- |
| `FW_*` | `ext:@protoboardai/ext-zephyr/firmware:check` and `ext:@protoboardai/ext-esp-idf/firmware:check` in `protoboard check` (one run per board), and a refused `firmware:generate` | [Writing a capability provider](../../../../../docs/guides/writing-a-capability-provider.md#diagnostic-codes) (firmware table), and the **firmware-config-zephyr** / **firmware-config-esp-idf** SOPs |
| `REL_*` | `protoboard release` and `protoboard release --check` (its preconditions and sections; nothing is written while any is an error) | [ext-release README](../../../../ext-release/README.md#preconditions) |
| `DRONE_CLI_MISSING`, `DRONE_CLI_STALE` | `protoboard release`: ext-drone's work-order section when `firmware/betaflight/cli.txt` is missing or no longer matches the model | Run `protoboard run betaflight-cli`, review the diff, commit, release again (**firmware-config**) |

## Reading a finding

```json
{ "code": "UHD_LINK_STATE", "severity": "error",
  "entity": { "kind": "link", "id": "video_power" },
  "message": "O4 10V: incompatible — voltage: 18–25.2 V vs 3.7–13.2 V (ranges do not overlap)",
  "source": { "file": "src/quadcopter.uhd.ts" }, "validator": "uhd/checkSystem" }
```

`entity` says what to open (`protoboard inspect <instance>` for instances;
the link id for links). `source` is the declaring file, with a line when the id can be located. `validator` tells you
which check to re-run mentally after the fix; a provider's check carries the
module in `subject` (`checks[]`). A check that was `skipped` (a missing tool,
a blocking error upstream) is unknown, not passed.
