---
name: frame-cad-verify
description: Verify a frame-cad structure before it is cut — bindings and frames clean, regeneration reproducible, every mating part placed on the generated faces, and the DXF manufacturable (hole edge distance, webs, router-bit limits, stock thickness) — and record the findings. Run by a fresh agent after frame-cad and before any manufacturing order or release; never edits the model.
---

# Frame CAD verify

## Purpose

Prove that a generated plate is what the model says, reproducible from it,
assembles with its mating parts, and can be cut. Use it after **frame-cad**,
after any change to a plate's interfaces or design values, and before a
release puts its DXF in the Manufacturing Package. In **build-a-project** it
closes stage 6 for structures. It records findings; it never edits the model
or the CAD.

## Inputs

| Input | Where | From |
| --- | --- | --- |
| Plate modules and their configs | `src/modules/<module>/<module>.uhd.ts`, `cad.config.ts` | **frame-cad** |
| Generated CAD | `<module dir>/frame-cad/`, `<module dir>/out/` | **frame-cad** |
| The router bit and stock | the shop's bit diameter and sheet thicknesses | the person or the chosen fabricator's published capability |
| Fastener stacks on the plates | `src/harnesses/` | **harness-author** |
| The `cad` runtime | `npx protoboard doctor` shows `python-build123d` ✓ | `npx protoboard tools install cad` |

## Steps

### 1. Automated

```bash
npx protoboard doctor                                   # python-build123d available
npx protoboard check --format json                      # 0 errors; each plate's cad:check and standard-outputs ran with 0 findings; geometryBindings ran
npx protoboard run frame-cad --format json              # (generate + export of every plate) every modules[].rebind list empty
git status --short src/                                 # no generated file changed: the committed CAD is what the model produces
"${PROTOBOARD_PYTHON:-.protoboard/tools/cad/bin/python}" node_modules/@protoboardai/ext-frame-cad/skills/frame-cad-verify/scripts/dxf_report.py <module dir>/out/body.dxf --bit <router bit mm>
```

A file that changes on regeneration means the committed CAD was not produced
from the committed model: find out why before anything else.

`dxf_report.py` prints each layer's extent, holes by diameter, the smallest
hole-to-edge distance and web, and flags: a hole closer to an edge than its
diameter (breakout risk in carbon), webs under 1 mm, straight cut-outs
narrower than the bit, and holes smaller than the bit (to be drilled; noted,
not failed). Exit 1 on the hard rules.

### 2. Review

1. **Interfaces.** Each plate interface still mirrors its mating part's
   interface (spacing, fastener, pattern shape) and cites it.
2. **Placement.** `protoboard check` placed every mating part through the
   generated frames (no `UHD_ASSEMBLY`); look at the assembly in the viewer
   (`npx protoboard dev --open`, stop it with `Ctrl+C`) or the documents if
   available: motors on pads, props clear (brief: ≥ 5 mm), stack centred,
   camera between its plates.
3. **Stack-ups.** Every fastener stack on this structure uses the current
   plate thickness (**harness-verify**).
4. **Manufacturing.** Thickness is a stock item of the chosen supplier;
   minimum features fit the bit; what the DXF leaves out (raised pads, clamp
   joints) has a decision (frame-cad `references/manufacturing.md`).

### 3. Calibrate on the reference quadcopter

Running the report on `examples/quadcopter-5in` (3 mm bit) finds, in the
geometry inherited from the UHD generator:

- the 16 motor-pad holes sit 2.39 mm from the hub edge (hub radius 12 mm,
  holes on an 8 mm radius, Ø 3.2): under one diameter;
- the top plate's four standoff holes are 2.4 mm from its long edges
  (y ± 24 in a 56 mm plate);
- each camera side plate's lower hole is 0.9 mm from the plate's bottom edge
  (hole 2 mm above the frame's top face);
- the M2 holes (Ø 2.2) are below a 3 mm bit: drill them.

None of these moves an interface; each is a design decision (`hub_extra_mm`,
the top plate's `outline_mm`, the clamp height or margin) for the design
owner, with a regenerate + verify after.

### 4. Write the findings

`docs/reviews/frame-cad-verify-<YYYY-MM-DD>.md`: the automated results
(commands, exit codes, report JSON) and findings
`{ id, severity, module, layer/feature, finding, evidence, fix }`.

## Decision points

| Decision | Rule |
| --- | --- |
| Severity | **blocker** for anything that cannot be made or will not assemble; **major** for a margin under the rule (hole under one diameter from an edge); **minor** otherwise. |
| A hole smaller than the bit | Not a failure: noted to be drilled. |
| A finding that needs a design change | The fix names the constraint to change; the design owner decides and regenerates. |

## Outputs

| Output | Where |
| --- | --- |
| The verification report | `docs/reviews/frame-cad-verify-<YYYY-MM-DD>.md` |

## Verification

The report lists every plate module, the exit code of each step-1 command,
and the `dxf_report.py` JSON per DXF; every finding cites a layer or feature
and its evidence. `git status --short src/` was clean after regeneration.

## Failure handling

| Code or symptom | Means | Do |
| --- | --- | --- |
| A generated file changed on regeneration | The committed CAD is not the model's output | Stop; find the changed input (config, interfaces, tool version) before reviewing |
| `FRAME_CAD_STALE`, `FRAME_CAD_EXPORT_STALE` | The CAD is behind the model | Hand back to **frame-cad** to regenerate; do not review stale CAD |
| `FRAME_CAD_FRAME_MISMATCH`, `UHD_GEOMETRY_BINDING` | Model and CAD disagree | Finding (blocker) until the author reviews and re-binds |
| `UHD_ASSEMBLY` | A mating part does not seat | Finding (blocker) |
| `dxf_report.py` exit 1 | A hard manufacturing rule failed | Finding per flagged item, with the constraint to change |
| `doctor` shows `python-build123d` ✗ | No runtime to regenerate or read the DXF | `npx protoboard tools install cad` |

Every other code: **system-compose** [diagnostic codes](../system-compose/references/diagnostic-codes.md).
