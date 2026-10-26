---
name: harness-verify
description: Independently audit a project's harnesses — re-derive every fastener stack-up from cited thicknesses, re-check thread engagement, torques and hardware listings, and every cable's connectors, conductor map, gauge and length against the sources. Run by a fresh agent after harness-author, and after any structure change; records findings, never edits the model.
---

# Harness verify

The author's arithmetic is a claim. Re-derive it from the sources, not from
the model's own numbers.

## Purpose

Prove that every joint will assemble and hold and every cable connects what
the manuals say, by re-deriving the facts independently. Use it after
**harness-author**, after any structure change (a plate, enclosure or
standoff that moved), and before a release. In **build-a-project** it closes
stage 4 and is repeated in stage 8. It records findings; it never edits the
model.

## Inputs

| Input | Where | From |
| --- | --- | --- |
| Harness modules and hardware parts | `src/harnesses/` | **harness-author** |
| Structure thicknesses | plate and enclosure modules' metadata and `out/body.manifest.json` | **frame-cad**, **enclosure-cad** |
| Sources | supplier listings (`usage_note` sources), part datasheets and manuals (`parts/evidence/`, `parts/catalog/<id>/`) | **harness-author**, the part skills |
| Check results and the stack-up report | the commands in step 1 | the project |

## Steps

### 1. Automated

```bash
npx protoboard check --format json          # UHD_ASSEMBLY, UHD_HARNESS_CONNECTOR, UHD_FASTENER_TORQUE, PB_UNKNOWN_HARNESS
npx tsx node_modules/@protoboardai/ext-hardware/skills/harness-author/scripts/stackup.ts --json
```

Both must be clean (the script exits 1 when a screw stops inside a nut or no
screw passes through one). Clean is necessary, not sufficient: the checks
compare the model with itself.

### 2. Fastener stacks, per harness

1. Rebuild the stack-up from the structure face using thicknesses taken from
   the **sources** (plate thickness from the structure module, spacer and nut
   heights from the listings, board thickness from the datasheet, grommet
   clamp from the stack manual). Mark each as sourced or assumed.
2. Compare with the model's `fastenerStack` positions. Any difference over
   0.1 mm is a finding.
3. Thread: nut joints need the screw at least flush with the nut's far face
   (the check) plus about a pitch; blind threads need engagement within the
   thread depth and any maker maximum. Re-derive; note the margin.
4. Heads: a screw head must bear on a face, not sit inside a plate or a pad
   that grew (the checks do not see this).
5. Torque: the value is on the turned item, cites a source or states an
   assumption with reference rows, and is plausible for the weakest material
   in the clamp.
6. Hardware: open each supplier listing (the `usage_note` source); size,
   length, material and part number match the part; quantities × packs cover
   the harness quantities.

### 3. Cables

Each end is a connector composite whose type, gender and position order match
the mating socket and the manual; a soldered end's composition (`compose`)
puts each wire on the pad the manual names. The conductors (internal link,
`childLinks` for a crossover) match the manual's pinout. List the derived
links (`deriveLinks` from `@deltarobotics/uhd`) and confirm each expected
connection is there and `configured`, and that nothing unexpected is (a wire
on the wrong pad shows up as an extra or incompatible derived link, or
`harness_wiring`). The gauge carries the peak current of the derived links
per a cited table or the maker; the length reaches between the placed ends
with a service loop. Where **harness-cad** has routed the cable, compare the
modelled length with `length_fit.route_mm` in its `out/body.manifest.json`.

### 4. Write the findings

`docs/reviews/harness-verify-<YYYY-MM-DD>.md` with a table per harness:
`item | model | re-derived | source | margin | finding`, then the findings
list `{ id, severity, harness, finding, evidence, fix }`.

## Decision points

| Decision | Rule |
| --- | --- |
| Severity | **blocker** for anything that would not assemble or would strip or crush; **major** for a claim not supported by a source; **minor** for traceability. |
| A difference between model and re-derivation | Over 0.1 mm in a stack, or any wrong conductor, is a finding. |
| A source and the model's own note disagree | A finding either way: name both. The quad's camera screws are a good calibration case: the model's positions leave 3.0 mm of thread in the camera against DJI's 3.10 mm maximum, while the part's note says 2.2 mm. |

## Outputs

| Output | Where |
| --- | --- |
| The verification report | `docs/reviews/harness-verify-<YYYY-MM-DD>.md` |

## Verification

The report has a table for every harness in `src/harnesses/`, every row
cites its source, and step 1's commands were clean when it was written (say
so, with their exit codes). No model file changed.

## Failure handling

| Code or symptom | Means | Do |
| --- | --- | --- |
| `UHD_ASSEMBLY` or `stackup.ts` exit 1 | The model does not assemble | Stop; hand back to **harness-author** before auditing |
| `UHD_FASTENER_TORQUE` | A joint without a sourced or assumed torque | Finding (major) |
| `UHD_HARNESS_CONNECTOR`, `UHD_LINK_STATE` on a cable link | An end does not fit, or a conductor is on the wrong pad | Finding (blocker) |
| `HARNESS_ROUTE_LENGTH` | Modelled and routed length differ | Finding; the author regenerates or fixes the length (**harness-cad**) |
| A supplier listing no longer loads | The source is gone | Record it unverifiable, with the date; the author replaces the source |

Every other code: **system-compose** [diagnostic codes](../system-compose/references/diagnostic-codes.md).
