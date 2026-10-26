---
name: system-compose
description: Turn a hardware brief into a checked UHD system in a Protoboard project — requirements, module selection by part tier (cloud catalog, project-researched in parts/local, or designed in src/), a root system with instances, links, harnesses and mates, fault scenarios that prove the checks catch real mistakes — then loop on `protoboard check` until every diagnostic is fixed or dispositioned. Use when starting a system, adding a subsystem, or when `protoboard check` reports errors you need to act on; follow with system-review.
---

# System compose

```
brief ─► requirements ─► module selection ─► system (instances, links, harnesses, mates)
                                                   │
                        fault scenarios ◄──────────┤
                                                   ▼
                               protoboard check ↻ fix / disposition ─► system-review
```

The UHD model is the design record. Every number in it traces to a source, a
cited design decision, or an `assumption` trait. A passing check validates the
model; it never establishes physical readiness.

Worked example throughout: `examples/quadcopter-5in` (root
`src/quadcopter.uhd.ts`, sub-assemblies `src/modules/assemblies.uhd.ts`,
harnesses `src/harnesses/`, scenarios `src/scenarios.ts`).

## Purpose

Produce the root system: which modules the product is made of, how they
connect electrically and mechanically, and the checks that prove the model
says what the hardware will do. Use it when starting a system from a brief,
when adding or replacing a subsystem, and whenever `protoboard check`
reports errors you need to act on. In **build-a-project** it is stage 1
(requirements) and stage 4 (composition), after the parts exist and before
boards, enclosures and harness CAD; its check loop (step 5) is also stage 8.

## Inputs

| Input | Where | From |
| --- | --- | --- |
| The brief | `docs/brief.md` | the person asking (with **build-a-project** step 1) |
| Parts | `parts/catalog/` (cloud catalog), `parts/local/` (project-researched) | `protoboard parts add`, **part-handoff** → **uhd-part-author** |
| The project config | `protoboard.config.ts`: `root`, `sources` (must include `parts/local/**/*.uhd.ts`), `scenarios` | `protoboard init` |
| Decisions so far | `docs/decisions.md`, `docs/sourcing/` | **part-search** |

## Steps

### 1. Brief → requirements

1. Read or write `docs/brief.md`: purpose, operating envelope, constraints,
   acceptance targets. Every number gets its source or is labelled a target.
   When the brief has to be written with the person, ask as **build-a-project**
   step 0 says: plain words, every abbreviation spelled out, a typed answer
   always possible, and the level of detail they want agreed first. Before
   describing an existing system to anyone, read it (`npx protoboard inspect`).
2. Split it into requirements you can check. For each, decide *how* it will be
   shown: a UHD rule (supply budget, link DRC, bus address, propulsion current,
   fastener checks), an assembly check (mates, nut engagement), a document
   value, or a test (see **test-and-measure**). Write that mapping down; the
   review and the test plan both use it.
3. State the product in `docs/product.json` (schema `protoboard.product/v0`):
   it is what the Manufacturing Package and the datasheet open with, so a
   person can read what the device is before the component detail.

   ```json
   {
     "schema": "protoboard.product/v0",
     "summary": "Two or three sentences: what it is and who it is for.",
     "features": ["What a user gets, one line each"],
     "functions": [{ "id": "F1", "text": "What the system does", "by": "the parts that do it" }],
     "requirements": [{ "id": "R1", "text": "What it must meet", "how": "how it is shown", "pass": "the criterion", "record": "what is written down" }]
   }
   ```

   Write it from the brief, in the brief's words; do not write a claim the
   brief does not make. The requirements may stay in the brief instead, as a
   table with the columns ID, Requirement, How, Pass and Record: the
   documents read that table when `requirements` is empty. Keep one of the
   two, not both. Whatever is left empty, the first page says is not stated,
   and `protoboard release --check` warns (`REL_PRODUCT_NOT_STATED`).
4. Put module-level requirements on the modules they constrain
   (`requirements: [{ type: "capability", description }]`, as on the custom
   frame), and project decisions in `docs/decisions.md` (context, options,
   choice, evidence).

### 2. Module selection

For each function the brief needs, in this order:

| Source | How | Notes |
| --- | --- | --- |
| Cloud catalog part | `npx protoboard parts search <words>`, then `npx protoboard parts add <id>` | Vendored from the Protoboard Cloud parts service into `parts/catalog/` (definition, closure and files, and the part's `.uhd.ts` source in `parts/catalog/<id>/`, which is what loads), digest-pinned in `parts/origins.json`. Immutable: read the source, but derive a local variant with its own id (copy the source to `parts/local/`) instead of editing it; `check` reports an edited vendored source as `PB_SOURCE_DRIFT`. The source declares the UHD and TypeScript it needs; the project pins both in `package.json`. Updates are deliberate (`protoboard parts update <id> --to <rev>`). |
| Purchased part not in the catalog | **part-search** first, then **part-handoff** → **uhd-part-research** → **uhd-part-author** → **uhd-part-verify** | The project-researched tier: `parts/local/<id>.uhd.ts`, its files in `parts/local/<id>/`, evidence in `parts/evidence/<id>/`. The `evidence` check reports parts without sources or verification. Once verified it can be promoted with `protoboard parts publish`. |
| Custom module (frame, bracket, enclosure, PCB) | design-intent `ModuleDef` in `src/` (`src/modules/`, `src/enclosures/<module>/`, `src/boards/<module>/`) | The project-specific tier. Interfaces first, each mirroring the mating part's interface (cite it). Geometry comes later from them through a capability provider (**frame-cad**, **enclosure-cad**, **circuit-board**). |
| Mounting hardware, cables | harness modules | See **harness-author**. |

Selection rules: lock the exact variant (KV, cell count, revision); prefer
parts whose interfaces are already modelled; record rejected options with the
reason in `docs/decisions.md`; never mark an illustrative rating as verified.

### 3. Compose the system

The root is one exported `ModuleDef` named in `protoboard.config.ts`.

- **Instances** (`children`): stable ids; they become instance paths
  (`arm_fl/motor`). Repeated modules get one child each when they are wired
  individually (four arms), or `quantity` when identical and unwired.
- **Sub-assemblies**: a module with `children`, `links` and `exports` groups
  what is bought or built together (the FC/ESC stack, an arm). Exported
  interfaces let the parent link to `arm_fl:motor__phases` without reaching in.
  A sub-assembly is also a natural Manufacturing Package unit (**release**).
- **Links**: `{ id, name, a: { child, interfaceId }, b: { child, interfaceId } }`.
  Only link what the hardware actually connects. If the two interfaces do not
  line up (a 3-wire function against 1), read the datasheets; the mismatch is
  information, not something to paper over.
- **Harnesses**: every physical carrier is a child `kind: "harness"` module.
  Cables are physical: link the parts' sockets to the cable's connector ends
  (or compose a soldered end's pads on the link, `compose`), and UHD derives
  the functional links through the conductors. Mechanical joints are harnesses
  too (fastener stacks); their links name them (`harness: "stack_hardware"`).
  Details in **harness-author**.
- **Mates**: a link between two mechanical interfaces with frames is a rigid
  mate. `mate: { gapMm, rotationDeg }`; rotations must be multiples of the
  structure's `symmetryDeg`. The assembly is built from links alone; parts
  nothing mates (strapped battery) are reported as unplaced, not guessed. Give
  them a display placement (`spatial.placements` in `.protoboard/display.json`)
  so the viewer, the CAD providers and the documents can place them.

Look at it as you go:

```bash
npx protoboard inspect                         # instances, definitions by tier, links, artifacts, validator coverage
npx protoboard dev --open                      # the system diagram and 3D view, rebuilt on every save; Ctrl+C stops it
```

Dragging modules and links in the viewer saves the diagram layout to
`.protoboard/display.json`. You may write that file yourself to lay the
diagram out (the project's `AGENTS.md`, "The diagram's layout"); everything
else under `.protoboard/` is generated. Commit it.

### 4. Fault scenarios

A check that has never failed proves little. For every rule the design leans
on, write the realistic mistake it must catch in `src/scenarios.ts` (not a
`*.uhd.ts` file, so the variants are never loaded as definitions):

```ts
export const SCENARIOS = [
  { id: "nominal", label: "Nominal build", expect: [] },
  { id: "gps-on-rx-uart", label: "GPS on the receiver's UART", expect: ["UHD_INTERFACE_REUSE"],
    system: recompose(QUADCOPTER_5IN, "gnss_pads", { p2: "fc:uart2_tx", p3: "fc:uart2_rx" }) },
  { id: "gnss-rx-tx-swapped", label: "GNSS lead with RX and TX swapped", expect: ["UHD_LINK_STATE"],
    system: recompose(QUADCOPTER_5IN, "gnss_pads", { p2: "fc:uart1_rx", p3: "fc:uart1_tx" }) },
  { id: "short-gps-screws", label: "M2 × 10 on the GPS", expect: ["UHD_ASSEMBLY"], overrides: [m2x10, gpsShortScrews] },
];
```

Name the file in `protoboard.config.ts` (`scenarios: { source:
"src/scenarios.ts", export: "SCENARIOS" }`) so viewers show them, and run
them:

```bash
npx tsx node_modules/@protoboardai/ext-hardware/skills/system-compose/scripts/scenarios.ts   # [src/scenarios.ts] [--json]
```

Every scenario must print `caught`; the nominal build must raise no errors. A
`MISSED` fault means a rule is missing, a parameter is absent (DRC cannot
compare what is not modelled), or the scenario is not the mistake you think.
Fix the model, not the scenario. Good sources of scenarios: wrong supply rail,
wrong pattern or fastener size, a shared UART, an address clash, a short screw,
a wrong-hand prop, a harness connector that does not mate, a board net
shorted to ground.

### 5. The check loop

```bash
npx protoboard check                       # people: errors and warnings, validator coverage
npx protoboard check --format json         # agents: { checks, diagnostics }
npx protoboard check --severity info       # include infos: what was not checked
npx protoboard inspect arm_fl/motor --format json   # one instance: definition, origin, links, artifacts, diagnostics
```

Read the JSON, not the text:

- `diagnostics[]`: `{ code, severity, entity: { kind, id }, message, source: { file, line }, validator }`.
  Go to `source` first; it points at the declaring line.
- `checks[]`: `{ validator, status: "ran" | "skipped", reason, counts, subject? }`.
  A skipped validator is **unknown, not passed** (e.g. assembly is skipped
  while endpoints are invalid; a provider check is skipped when its tool is
  missing). Fix blocking errors first, then re-run to see the rest.

Order of work: loader/registry errors (`PB_*` that stop resolution) → link and
endpoint errors → UHD rule errors → assembly → geometry bindings → capability
and extension checks → warnings → infos. After each fix, re-run; one fix often
clears or reveals others.

Every warning ends in one of: fixed; a cited explanation recorded in
`docs/decisions.md`; or a tracked open item. The quad's one warning,
`UHD_PROPULSION_CURRENT` (four motors can peak above the pack's continuous
rating but within its burst rating), is a real finding: it needs a decision
(accept bursts, limit current in firmware, or choose a higher-rated pack), not
a deleted parameter. Infos are coverage: read them, they tell you what was not checked.

### 6. Hand off

When `check` has 0 errors, the scenarios are all caught, and every warning is
dispositioned: run **system-review** with a fresh agent. Then continue with
**harness-author**, the designed modules (**circuit-board**,
**enclosure-cad**, **frame-cad**), **harness-cad**, **firmware-config** and
**test-and-measure**, in the order **build-a-project** gives.

## Decision points

| Decision | Rule |
| --- | --- |
| Which tier for a part | Catalog if `parts search` has the exact variant; project-researched if not; designed in `src/` only for what is made for this product. Never edit a catalog file. |
| One child per unit, or `quantity` | One child each when the units are wired or mated individually; `quantity` when identical and unconnected. |
| Sub-assembly or flat | Group what is bought or built together and what will be a package unit; keep ids stable once others refer to them. |
| Link two interfaces | Only when the hardware connects them; a mismatch sends you to the datasheets, never to a forced link. |
| A warning | Fix it, or record a cited disposition in `docs/decisions.md`, or open an item. Removing the parameter it compares is never an option. |
| A data gap | A `data_gap` trait plus an open item; not a guessed value. |

## Outputs

| Output | Where |
| --- | --- |
| The product statement (summary, features, functions, requirements) | `docs/product.json` |
| Requirements mapping and decisions | `docs/brief.md`, `docs/decisions.md` |
| Root system and sub-assemblies | `src/<system>.uhd.ts`, `src/modules/` |
| Custom module definitions (design intent) | `src/modules/`, `src/boards/<module>/`, `src/enclosures/<module>/` |
| Fault scenarios | `src/scenarios.ts` |
| Diagram layout and display placements | `.protoboard/display.json` |
| Resolved build | `.protoboard/build/resolved.json` (`npx protoboard build`; derived, not committed) |

## Verification

```bash
npx protoboard check --format json         # 0 errors; every validator in checks[] ran
npx tsx node_modules/@protoboardai/ext-hardware/skills/system-compose/scripts/scenarios.ts --json   # every scenario caught
```

Every warning has a disposition in `docs/decisions.md` or an open item. Then
**system-review**, by a fresh agent, writes
`docs/reviews/system-review-<date>.md`.

## Failure handling

| Code or symptom | Means | Do |
| --- | --- | --- |
| `PB_SOURCE_LOAD_FAILED` | A source threw on import | Fix the TypeScript error; nothing in that file loads until then |
| `PB_UNRESOLVED_DEFINITION` | A child's definition is nowhere | `parts add <id>`, author it in `parts/local/`, or fix the id; check `sources` covers `parts/local/**/*.uhd.ts` |
| `PB_INVALID_ENDPOINT` | A link names a child or interface that does not exist | Fix the id or add the sub-assembly's export |
| `UHD_LINK_STATE` | Link DRC found an incompatibility | Relink, change the part, or add the missing parameter from the datasheet |
| `UHD_SUPPLY_BUDGET`, `UHD_PROPULSION_CURRENT` | A supply or the battery is overloaded | Move loads or choose a stronger source; a warning needs a recorded decision |
| `UHD_INTERFACE_REUSE`, `UHD_BUS_ADDRESS` | Two devices on one interface or one address | Use a free interface, another bus or another address |
| `UHD_ASSEMBLY`, `UHD_UNPLACED` | A mate does not close, or a module is not placed | Fix frames, gaps, rotations, hardware lengths; give loose parts a display placement |
| Scenario `MISSED` | A rule or a parameter is missing | Add the parameter from a source, or accept that the rule does not exist and record it |
| A validator `skipped` | Unknown coverage | Fix the reason given, re-run |

Every other code: [diagnostic codes](references/diagnostic-codes.md).

## Hard rules

1. Never edit `parts/catalog/*.json`; derive a local variant.
2. Never silence a diagnostic by removing the parameter it compares. Missing
   data is a `data_gap` trait and an open item.
3. Never add a link to satisfy a rule (e.g. an "unpowered" warning) that the
   hardware does not have. An input that stays open on purpose is marked on
   its instance instead: `unconnected: [{ interfaceId: "dc_jack", reason:
   "runs from USB" }]`.
4. Keep ids stable; ids are how links, bindings, documents and releases refer
   to things.
