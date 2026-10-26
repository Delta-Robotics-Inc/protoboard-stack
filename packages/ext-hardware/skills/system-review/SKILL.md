---
name: system-review
description: Independent review of a composed UHD system against its brief — every requirement traced to a check, document value or test; every link, harness and mate justified by both parts' interfaces; every diagnostic dispositioned; fault scenarios caught. Run by a fresh agent after system-compose (or before a release); writes a findings file and never edits the model itself.
---

# System review

A fresh agent, with no memory of how the system was built, checks that it
does what the brief says and that the model says only what the sources
support. The composer's reasoning is not evidence; the files are.

## Purpose

Catch what the composer cannot see in their own work: requirements nothing
shows, links that pass only by inference, warnings quietly accepted, gaps
presented as facts. Use it when **system-compose** hands off (0 errors,
scenarios caught), before a release, and after any large change to the
system. In **build-a-project** it closes stage 4 and is repeated in stage 8.
It never edits the model; findings go back to the composer.

## Inputs

| Input | Where | From |
| --- | --- | --- |
| Brief, decisions, requirement → evidence mapping | `docs/brief.md`, `docs/decisions.md` (or the test plan) | **system-compose** step 1 |
| Check results | `npx protoboard check --format json` | the project |
| The system | `npx protoboard inspect --format json`, `npx protoboard inspect <instance> --format json` | the project |
| Scenario run | `npx tsx node_modules/@protoboardai/ext-hardware/skills/system-compose/scripts/scenarios.ts --json` | **system-compose** step 4 |
| Part evidence | `parts/evidence/<id>/`, catalog origins in `parts/origins.json`, catalog files in `parts/catalog/<id>/` | the part skills, `parts add` |

## Steps

### 1. Requirements

Each requirement in the brief has one of: a validator that ran and passes, a
document value, a planned test, or an explicit "not verified" entry. A
requirement with none is a finding. Model checks never count as physical
acceptance.

### 2. Coverage

```bash
npx protoboard check --severity info --format json
```

In `checks[]`, every validator ran. A skipped validator, or a check `reason`
about unchecked refs, is unknown coverage: list it.

### 3. Links

For a sample of links (all power links, every link to the main controller,
every mechanical mate), open both interfaces:

```bash
npx protoboard inspect <instance> --format json
```

Confirm the parameters that DRC compared come from the parts' sources, and
that the connection exists in the hardware (pinout, manual wiring diagram).
Links that pass only by inference (`valid_inferred`) or manual override need a
reason.

### 4. Harnesses

Every electrical link that leaves a board is carried by a harness or a stated
solder joint; every mechanical joint has a fastener stack whose arithmetic you
re-derive (**harness-verify**).

### 5. Diagnostics

Every warning has a disposition in `docs/decisions.md` or an open item; no
parameter was removed or widened to make a rule pass (compare with the part's
sources).

### 6. Scenarios

```bash
npx tsx node_modules/@protoboardai/ext-hardware/skills/system-compose/scripts/scenarios.ts --json
```

All caught; the nominal build raises no errors. Think of one realistic
mistake the scenarios do not cover and say whether the checks would catch it.

### 7. Assumptions and gaps

List every `assumption` and `data_gap` trait in local definitions:

```bash
npx protoboard build                       # then search .protoboard/build/resolved.json, or grep src/ and parts/local/
```

Each is either acceptable for this revision or an open item.

### 8. Write the review

`docs/reviews/system-review-<YYYY-MM-DD>.md`:

```md
# System review — <project> @ <git revision>
Reviewer: <agent/person> · check: <E> errors, <W> warnings · scenarios: <caught>/<total>

| id | severity | entity | finding | evidence | suggested fix |
| --- | --- | --- | --- | --- | --- |
| R1 | major | link dji_fc (derived bec_10v ↔ vcc) | ... | O4 manual p.x | ... |

## Requirement trace
| requirement | shown by | status |
```

Hand the file to the composer; do not edit the model in the review.

## Decision points

| Decision | Rule |
| --- | --- |
| Severity | **blocker**: wrong hardware would be built or damaged. **major**: a claim not supported by a source. **minor**: traceability, naming. |
| Sample size for links | All power links, all links to the main controller, all mates; plus at least three others chosen at random. |
| A requirement shown only by a model check | Acceptable for the model; list the physical test that would confirm it, or "not verified". |
| Unknown coverage | Always a finding (minor unless it hides a requirement). |

## Outputs

| Output | Where |
| --- | --- |
| The review | `docs/reviews/system-review-<YYYY-MM-DD>.md` |

## Verification

The review file exists, names the git revision and the check and scenario
counts, has a row for every requirement in the brief, and every finding cites
its evidence (a file and line, a source page, a command output). No model
file changed (`git status --short src/ parts/` shows nothing from the review).

## Failure handling

| Code or symptom | Means | Do |
| --- | --- | --- |
| `checks[]` has a `skipped` validator | Unknown coverage | Record it; ask the composer to fix the reason (a missing tool, an upstream error) |
| Errors in `check` | The system was not ready for review | Stop; hand back to **system-compose** |
| `UHD_LINK_STATE` warning (`valid_inferred`) | DRC matched by inference | Check the datasheets yourself; a finding unless a reason is recorded |
| A warning with no disposition | Accepted silently | Finding (major) |
| A scenario `MISSED` | The check the design relies on does not fire | Finding (major or blocker) |
| `HW_NO_SOURCES`, `HW_NOT_VERIFIED` | Part evidence missing | Finding; the part goes back to **uhd-part-research** / **uhd-part-verify** |

Every other code: **system-compose** [diagnostic codes](../system-compose/references/diagnostic-codes.md).
