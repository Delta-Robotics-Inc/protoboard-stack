---
name: test-and-measure
description: Plan and record physical tests for a UHD system — derive a test plan from the brief's requirements and the model (first-article inspection, board bring-up, functional checks; what each test proves, pass criteria from model values), write step-by-step procedures, and record results as measured test-data files (UHD tech-docs schema, status standin|measured) that replace stand-in data in the documents. Use when a design needs acceptance evidence, before building a prototype, and whenever measurements come back from the bench.
---

# Test and measure

```
brief requirements ─┐
UHD model values ───┼─► docs/test-plan.md ─► docs/procedures/<test-id>.md ─► bench / flight
stand-in data ──────┘                                                            │
                                   docs/test-data/<test-id>.json (status: measured) ◄┘
                                                │
                              documents rebuilt: stand-in watermark gone, values marked M
```

Model checks validate the model. Only measurements on a physical unit,
recorded against a release and a unit, establish that the hardware meets its
brief. Never write a measured file for a test that was not run.

## Purpose

Turn requirements and model claims into tests a person can run, and turn
their results into evidence the documents and the release carry. Use it when
a design needs acceptance evidence, before a prototype is built (the plan
goes into the Manufacturing Package's test and validation plan), and
whenever measurements come back. In **build-a-project** it is part of stage
10; recording results happens after the release, against it. This skill
plans and records; a person performs every physical test.

## Inputs

| Input | Where | From |
| --- | --- | --- |
| Requirements and their "shown by" mapping | `docs/brief.md`, `docs/decisions.md` | **system-compose** step 1 |
| Model values and warnings | `npx protoboard check --format json`, `npx protoboard inspect --format json` | the project |
| Stand-in data the documents use | `docs/test-data/*.json` with `status: "standin"` | **uhd-tech-docs** (`protoboard run tech-docs`) |
| Firmware items to verify | the firmware reference's UNVERIFIED list, the generator's warnings | **firmware-config** |
| Bench results | raw logs, CSVs, photos from the person who ran the test | the bench |

## Steps

### 1. Test plan from requirements and the model

`docs/test-plan.md`, one row per test ([template and the quad's plan](references/test-plan.md)):

| Column | Content |
| --- | --- |
| `id` | kebab-case; **the same id as its test-data file** (`hover-current`) |
| requirement | the brief line(s) it proves, quoted |
| model claim | the value queries it checks, e.g. `sys:checks.diagnostics[rule=propulsion_current].details.totalPeak`, `def:<part>:…` — the numbers the documents print |
| level | inspection · bench · propulsion · flight |
| pass criterion | from the requirement, or the model value with a stated tolerance; never invented after the result |
| depends on | tests that must pass first (power-up before props on) |
| status | planned · procedure written · run (pass/fail) · blocked |

Derive tests systematically:

- every requirement in the brief → at least one test or an explicit
  "not tested in this revision";
- every warning and every `assumption` / `data_gap` the model carries → a
  measurement that would retire it (fastener torques, frame mass, the
  propulsion-current warning → a current log at full throttle);
- every stand-in data file the documents use (`status: "standin"`) → the test
  that replaces it, with the same id and columns;
- every firmware setting marked verify (motor order, compass alignment) → a
  bench check (**firmware-verify**);
- the Manufacturing Package's basic validation plan
  (`docs/specs/release-package-and-evals.md` §2 in the stack repository):
  **first-article inspection** (dimensions, fits, seals against the CAD and
  the enclosure check's report); **board bring-up** for each custom board
  (rails against the board's nets, idle current against the supply budget,
  programming and boot, bus scans with the expected I2C addresses from the
  parts, a smoke test per peripheral); **functional checks** per requirement;
  and the records each one captures.

Order by risk and by what destroys hardware first: inspection → power-up with
a current limit, no props or loads → rails and peripherals → motor direction
and order → thrust stand → hover → endurance.

### 2. Procedures

`docs/procedures/<test-id>.md` ([template](references/procedure-template.md)):
preconditions (release/revision, unit serial, firmware dump hash, battery
state), equipment with calibration date, safety and abort criteria, numbered
steps, what to record and in which raw file, the pass criterion, and the
test-data columns the result fills. A procedure is runnable by someone who has
not read the model.

### 3. Recording results

One file per test: `docs/test-data/<test-id>.json`, schema
`uhd-test-data/1` (`node_modules/@protoboardai/ext-docs/skills/uhd-tech-docs/templates/test-data.schema.json`,
guide `…/uhd-tech-docs/references/test-data.md`).

- `status: "measured"`; `subject.system` and the tested `modules`;
- `conditions[]`: battery voltage, ambient, prop, firmware, all-up weight…
  as measured on the day (units, `""` for text);
- `provenance`: `method` (the procedure, one paragraph), `date` (ISO),
  `operator` and/or `instruments[]`, `rawFiles[]` (logs, CSVs, photos; keep
  them next to the file or in a data store they can be fetched from); no
  `derivedFrom` (that is stand-in provenance);
- `columns`, `rows`, `summary`: **the same ids and units as the stand-in it
  replaces**, so documents pick it up unchanged. A new test gets a new id.

Validate before committing:

```bash
npx tsx node_modules/@protoboardai/ext-hardware/skills/test-and-measure/scripts/test-data.ts docs/test-data
npx tsx node_modules/@protoboardai/ext-hardware/skills/test-and-measure/scripts/test-data.ts docs/test-data/hover-current.json --replaces <standin dir or file>
```

It fails on template placeholders (all-zero summaries, "EXAMPLE ONLY"
method), a missing date or operator, rows that do not match the columns, and
(with `--replaces`) changed ids, columns or units.

A failed test is data too: record it as measured with its conditions, then
open the design issue it exposes. Measured results never rewrite the design
specification; they feed the next revision (**system-compose**).

### 4. Replacing stand-ins in the documents

Documents are built by **uhd-tech-docs** (`@protoboardai/ext-docs`) from the
project's `docs/test-data/`; a measured file with the stand-in's id wins, the
stand-in generator never overwrites it, charts lose the STAND-IN watermark and
values get the **M** marker.

```bash
npx protoboard run tech-docs
npx protoboard run tech-docs-verify          # fails if a measured chart still carries a watermark
```

Then the visual review in **uhd-tech-docs-verify**.

### 5. Tie results to a release

Every measured file names what was tested: put the release revision and unit
serial in `conditions` (`{ "name": "Release", "value": "quad5-r1", "unit": "" }`,
`{ "name": "Unit", "value": "SN001", "unit": "" }`). See **release**: measured
results attach to a release later as evidence and never change its frozen
inputs.

## Decision points

| Decision | Rule |
| --- | --- |
| Test or "not tested" | Every requirement gets a test, or an explicit "not tested in this revision" with the reason. |
| Pass criterion | From the requirement, or the model value with a stated tolerance, written before the test is run. |
| Order | What can destroy hardware is tested last and behind its prerequisites; first power always through a current limit. |
| New id or same id | A result that replaces a stand-in keeps its id, columns and units; anything else is a new test with a new id. |
| A failed test | Record it as measured; open the design issue; do not edit the model to match it in the same revision. |

## Outputs

| Output | Where |
| --- | --- |
| Test plan | `docs/test-plan.md` |
| Procedures | `docs/procedures/<test-id>.md` |
| Measured results and raw files | `docs/test-data/<test-id>.json`, raw files next to them or in a fetchable store |

## Verification

```bash
npx tsx node_modules/@protoboardai/ext-hardware/skills/test-and-measure/scripts/test-data.ts docs/test-data   # exit 0
npx protoboard run tech-docs-verify                                                                        # succeeds after a rebuild
```

Every requirement has a row in the plan; every stand-in file has a test with
its id; every measured file names its release and unit.

## Failure handling

| Code or symptom | Means | Do |
| --- | --- | --- |
| `test-data.ts` fails on placeholders | A template value was left in | Replace it with the measurement, or do not commit the file |
| `test-data.ts --replaces` reports changed ids, columns or units | The result would not replace the stand-in | Match the stand-in's columns, or give the test a new id |
| `tech-docs-verify` "standin" finding | A measured chart still has a watermark, or a stand-in value lacks its marker | Rebuild the documents (`run tech-docs`) |
| `UHD_PROPULSION_CURRENT`, `UHD_SUPPLY_BUDGET` warnings | A model claim that needs a measurement | Plan the test that retires it |
| `UHD_FASTENER_TORQUE` warnings | Torques are assumptions | Plan the torque inspection |

Every other code: **system-compose** [diagnostic codes](../system-compose/references/diagnostic-codes.md).
