---
name: frame-cad
description: Generate a custom structure's CAD (plates, arms, raised pads, side clamps) from its UHD interfaces with ext-frame-cad, a provider of the cad capability (build123d) — bolt patterns and frames in, STEP/GLB/DXF plus a feature manifest out (protoboard run cad:generate / cad:export --module <id>, or the frame-cad alias) — keep geometry bindings honest, re-bind explicitly after a reviewed change, generate nominal fastener bodies (hardware-cad), and export for manufacturing (DXF/STEP for CNC-routed carbon). Use when a custom frame, plate or bracket needs geometry, when its interfaces change, or when `protoboard check` reports FRAME_CAD_* or UHD_GEOMETRY_BINDING findings; follow with frame-cad-verify.
---

# Frame CAD from interfaces

```
module interfaces (bolt patterns + frames) + cad.config.ts constraints
        │  protoboard run cad:generate --module <id>
        ▼
frame-cad/params.json ─► py/frame_cad.py (build123d) ─► frame-cad/frames.json      (native design)
        │  protoboard run cad:export --module <id>
        ▼
out/body.step / body.glb / body.manifest.json / body.dxf / interfaces/*.glb       (standard outputs)
        │
        └── cad:check: model frames == generated frames, params and export current
            geometry bindings: feature signatures == manifest
```

This extension is a provider of the `cad` capability
(`docs/specs/tool-integrations.md`): each plate module has a provider
directory, the folder of its `cad.config.ts`, with the native design in
`frame-cad/` and the standard outputs (the only files anything downstream
reads) in `out/`.

A custom structure is designed interface-first: it exists as requirements and
mating interfaces (each mirroring a selected part's pattern, cited) before it
has geometry. The generator derives the plate from those interfaces, so the
CAD cannot drift from the model silently: a change in either is a finding.

Worked example: `examples/quadcopter-5in/src/modules/frame/` — the frame
(stack, standoff and air-unit hole patterns, four raised motor pads on arms,
camera side clamp) — and `src/modules/top-plate/` (standoffs, GPS pattern,
strap slots, explicit outline): each a `.uhd.ts`, a `cad.config.ts`, the
native `frame-cad/` and the exported `out/`.

## Purpose

Give a plate-like structure (frame, top plate, bracket, side clamp) its
geometry from the interfaces it must hold, and keep the model and the CAD
honest about each other. Use it when a custom frame, plate or bracket needs
geometry, when its interfaces or design values change, and when `protoboard
check` reports `FRAME_CAD_*` or `UHD_GEOMETRY_BINDING`. Cases and covers
around a board are **enclosure-cad**; routed cables are **harness-cad**. In
**build-a-project** it is stage 6 (structures), after the system is composed;
**frame-cad-verify** follows.

## Inputs

| Input | Where | From |
| --- | --- | --- |
| The plate module: `plate_thickness_mm`, bolt-pattern interfaces with frames | `src/modules/<module>/<module>.uhd.ts` | **system-compose** |
| The mating parts' patterns (cited) | the parts' interfaces (`npx protoboard inspect <instance>`) | catalog or **uhd-part-author** |
| Provider config and design values | `src/modules/<module>/cad.config.ts` | this SOP, step 2 |
| The `cad` runtime | `npx protoboard doctor` shows `python-build123d` ✓ | `npx protoboard tools install cad` |

## Steps

### 1. Runtime

```bash
npx protoboard doctor          # python-build123d: ✓ build123d 0.13.0, or ✗ with the install hint
npx protoboard tools install cad   # if missing: a project venv with the pinned build123d (.protoboard/tools/cad)
```

`PROTOBOARD_PYTHON=/path/to/python` overrides the project runtime (default
without either: `python3`).

If the tool is missing, `run cad:generate`, `cad:export` and `frame-cad` are
refused before anything runs (`cad:check` and `extract` need no runtime). Do
not hand-write CAD to work around it; install the runtime or report it.

### 2. Model the structure

A **plate module** is a local definition whose mechanical metadata states
`plate_thickness_mm`. Coordinates: module frame, mm, Z up, origin on the
plate's underside. Each bolt-pattern interface (`BoltPattern(...)`) needs a
frame (`withGeometry`):

| Interface frame | Becomes | Frame the generator writes back |
| --- | --- | --- |
| normal +Z, square/rectangle | through holes, on the top face | `origin z = thickness` |
| normal −Z | through holes, on the underside | `origin z = 0` |
| normal +Z, circle (or listed in the config's `pads` constraint) | a raised pad on a hub, joined to the core by an arm (motor mounts); the pad top is the mating face | `z = thickness + pad height` |
| horizontal normal, `hole_spacing_y` | two vertical side plates `hole_spacing_y` apart (the clamped width), holes `hole_spacing` apart vertically (camera clamp) | `z = thickness + clamp height` (mid-plane of the clamp) |

X/Y positions and axes come from the frames; hole positions follow UHD's
`boltPatternHoles` (a circle's first hole on the frame's xAxis). Design values
(outline, fillets, arm width, pad and clamp heights, clearances, slots) are
generator defaults overridden per module by the constraints in its
`cad.config.ts`: see [generator reference](references/generator.md). Put
every design value there with a comment; it is part of the design record, and
it is this provider's, so it stays out of the UHD module.

```ts
// src/modules/frame/cad.config.ts, next to frame.uhd.ts
import { defineCapabilityConfig } from "@protoboardai/core";

export default defineCapabilityConfig({
  provider: "@protoboardai/ext-frame-cad",
  process: "cut", // CNC-routed plate: DXF is the manufacturing export
  constraints: { clamp_height_mm: 10, pad_height_mm: 0.5, arm_width_mm: 14 },
});
```

The config's folder must declare one module (or name it with `module`).
`process` is `cut` or `machine`; `print` is refused (this provider writes no
STL or 3MF). A constraint key the provider does not know is a warning.

Declare the generated files on the module so checks and releases see them:
`withGeometry(def, geometry, plateCadArtifacts({ dir, name, interfaces }))`,
with `plateCadArtifacts` from `@protoboardai/ext-frame-cad/artifacts` and `dir`
the folder of the config (body, manifest, per-interface GLBs and DXF in
`out/`; params and frames in `frame-cad/`). `withGeometry`, `feature`, `own`
and `procedural` are UHD's pure helpers; the file layout is this extension's.

```bash
npx protoboard capabilities                                  # the module is bound to @protoboardai/ext-frame-cad ✓
```

### 3. Generate and export

```bash
npx protoboard run cad:generate --module <id> --format json  # native design: frame-cad/params.json, frames.json
npx protoboard run cad:export --module <id>                  # standard outputs: out/ (emptied first)
npx protoboard run frame-cad --input module=<id>,<id>        # alias: generate + export for the named plate modules (every one without --input)
```

Every file written is listed, with digests, in the operation record under
`operations/`. For fixed params and build123d version the output is
byte-identical, so a re-run that changes files means an input changed.
`cad:extract` returns the generated frames and the module's artifacts as
facts; it never edits the module (that is `frame-cad-rebind`, step 4).

`data.rebind` (`data.modules[].rebind` for the alias) is the worklist:
`signatures` (bound feature signatures that no longer match the generated
ones) and `frames` (model frame origins that differ from the generated ones).
Empty lists: nothing to do.

### 4. Bindings and re-binding

Each interface binds to its geometry three ways (UHD geometry artifacts):
`feature("<id>", signature)` — a named sub-shape in the STEP/GLB with an area /
centroid / normal signature (D1, primary); `own("<id>")` — the per-interface
GLB (D2); `procedural("bolt_pattern")` — derived from parameters (D3).

After a change, `protoboard check` reports, and never silently accepts
(`ext:@protoboardai/ext-frame-cad/cad:check`, one run per module): see
**Failure handling**.

Review the change first: does the new geometry still mate (stack-ups, prop
clearance, standoff lengths)? Then re-bind explicitly:

```bash
npx protoboard run frame-cad-rebind --input module=<id>     # out/ signatures and frame-cad/ frame origins into the module source
npx protoboard check                                        # 0 errors again
```

It edits only the module's own `withGeometry(...)` block, lists every change
(`data.changes`), and leaves an operation record. Commit the source change
with the regenerated CAD and say why in the commit. Then revisit what depends
on the moved faces: fastener stacks (**harness-author** step 3), mate gaps,
documents.

Worked through in the extension's tests: raising the frame's
`plate_thickness_mm` from 5 to 6 → `FRAME_CAD_STALE` → `cad:generate` (16
changed bindings: hole areas 201.1 → 241.3 mm², pads and frames up 1 mm;
`FRAME_CAD_EXPORT_STALE` until exported) → `cad:export` → 8
`UHD_GEOMETRY_BINDING` + 8 `FRAME_CAD_FRAME_MISMATCH` errors → rebind → 0
errors. The stack's M3 × 30 then has 1 mm less grip; re-derive it.

### 5. Manufacturing export

`out/body.dxf` holds the profiles to cut, in mm: layer `plate` (outline with
every through hole: the bottom face of the plate) and one layer per side-clamp
plate (`clamp_<interface>`, drawn beside the plate). The manifest's
`manufacturing` block lists layers, quantities (clamp plates × 2) and
thicknesses, and what is not in the DXF (raised pads). The STEP is the 3D
reference for the shop and for inspection. Carbon routing specifics:
[manufacturing](references/manufacturing.md). The Manufacturing Package
copies these into the unit's `files/mechanical/<module>/` (**release**).

### 6. Mounting hardware (the `cad` capability)

Screws, nuts, standoffs and spacers that are local modules (bought parts
researched in the project, `parts/local/`; catalog parts bring their own
CAD) get nominal bodies from their sizes through the `cad` capability, so
`assemble()` can place them and their mass follows from volume × material.
Each has a `cad.config.ts` in a folder of its own,
`parts/local/<id>/cad.config.ts`:

```ts
export default defineCapabilityConfig({ provider: "@protoboardai/ext-frame-cad", module: "<id>" });   // bought: no process
```

```bash
npx protoboard run cad:generate --module <id>     # frame-cad/params.json from the module's sizes
npx protoboard run cad:export --module <id>       # out/body.step, body.glb, body.manifest.json (volume)
npx protoboard run hardware-cad [--input module=<id>,<id>]   # alias: both, for every hardware module (or the named ones)
```

The release traces each module's `out/` to its own `cad:export` record. The
aliases (`hardware-cad`, `frame-cad`, `harness-cad`) run `cad:generate` and
`cad:export` for each module and leave those per-module records (their own
record lists them in `data.steps`), so either way is traced.

A hardware module is tagged `fastener` and one of `screw`, `nut`, `standoff`,
`spacer`; an interface states `fastener_diameter` and `length`; mechanical
metadata states `head_diameter_mm` and `head_height_mm` (screw) or `outer_mm`
(across flats, or a tube's diameter), and `bore_mm` when the maker states a
nut's, standoff's or spacer's bore (otherwise the nominal bore below). A missing size fails the run; nothing
is defaulted. Shapes are nominal (plain shank at 0.95 d, no thread form):
see the [generator reference](references/generator.md). Declare the files with
`hardwareCadArtifacts({ dir: "parts/local/<id>", name: "<id>" })` from
`@protoboardai/ext-frame-cad/artifacts`. Export reports each body's volume and
the one it replaced. A bought part's body is a model of it, not a
fabrication file: the release lists it as bought (or included), never as a
fabrication order. Worked example: the quadcopter's `parts/local/*.uhd.ts`
(built with `parts/local/hardware.ts`), each with `parts/local/<id>/cad.config.ts`.

## Decision points

| Decision | Rule |
| --- | --- |
| This provider or another | Plates and frames whose features are bolt patterns: here. A case or cover around a board: **enclosure-cad**. |
| `process` | `cut` for routed sheet (DXF required); `machine` for a machined part (STEP). Never `print` with this provider. |
| A design value | A constraint in `cad.config.ts` with a comment saying why; never UHD metadata, never a hand edit of `frame-cad/`. |
| Re-bind | Only after reviewing what moved and what depends on it (stack-ups, mate gaps, clearances). |
| A structure change | Re-derive every fastener stack on the moved faces before moving on. |

## Outputs

| Output | Where |
| --- | --- |
| Native design (generated; never edit) | `<module dir>/frame-cad/params.json`, `frames.json` |
| Standard outputs (generated; never edit) | `<module dir>/out/body.step`, `body.glb`, `body.manifest.json`, `body.dxf`, `interfaces/*.glb` |
| Re-bound module source | `<module dir>/<module>.uhd.ts` (`withGeometry` block, by `frame-cad-rebind`) |
| Fastener bodies | next to the hardware definitions (the quad: `src/harnesses/cad/`) |
| Operation records | `operations/` |

## Verification

```bash
npx protoboard check --format json     # 0 errors; the module's cad:check and protoboard/standard-outputs ran with no findings
npx protoboard run frame-cad --format json   # every modules[].rebind list empty; git status shows no changed generated file
```

Then **frame-cad-verify**, by a fresh agent, before anything is cut.

## Failure handling

| Code | Means | Do |
| --- | --- | --- |
| `FRAME_CAD_NOT_CONFIGURED` (info, the `frames` check) | A plate module has no `cad.config.ts` | Add one naming `@protoboardai/ext-frame-cad` in its folder |
| `FRAME_CAD_NOT_A_PLATE` | The config points at a module without `plate_thickness_mm` | Add the plate metadata, or use another `cad` provider |
| `FRAME_CAD_NOT_GENERATED` | No generated CAD yet | `run cad:generate --module <id>`, then `cad:export` |
| `FRAME_CAD_STALE` (warning) | Interfaces or design values changed since generation | `run cad:generate`, then `cad:export`; review the re-bind list |
| `FRAME_CAD_EXPORT_STALE` (warning) | `out/` was exported from other parameters than `frame-cad/params.json` | `run cad:export` |
| `FRAME_CAD_FRAME_MISMATCH` (error) | A model frame differs from the generated plate | Review; `run frame-cad-rebind` if the new plate is right; check dependent stack-ups |
| `FRAME_CAD_UNKNOWN_INTERFACE` | Generated frames name an interface the module no longer has | Regenerate |
| `FRAME_CAD_FRAME_MISSING` | Generated geometry for an interface without a model frame | Re-bind |
| `UHD_GEOMETRY_BINDING` (error) | "changed since binding; re-bind explicitly" | Review, then `run frame-cad-rebind` |
| `HARDWARE_CAD_PARAMS`, `HARDWARE_CAD_STALE`, `HARDWARE_CAD_EXPORT_STALE` | A fastener module lacks a size, changed since its body was made, or its `out/` is older than its params | Add the size from the listing; `run cad:generate` then `cad:export --module <id>` |
| `HARDWARE_CAD_NOT_CONFIGURED` (info) | A local fastener module has no body and no `cad.config.ts` | Add `parts/local/<id>/cad.config.ts` naming this provider |
| `PB_CAPABILITY_CONSTRAINT_UNKNOWN` | A constraint this provider does not know | Check the name in the [generator reference](references/generator.md) |
| `PB_OUTPUT_MISSING` (`body.dxf`) | `process: cut` without a DXF | Re-export; check the plate has profiles to cut |
| `run` refused: tool `python-build123d` missing | No `cad` runtime | `npx protoboard tools install cad` |

Every other code: **system-compose** [diagnostic codes](../system-compose/references/diagnostic-codes.md).

## Hard rules

1. Never edit generated files (`frame-cad/`, `out/`); change the module
   (interfaces, frames) or its `cad.config.ts` constraints and regenerate.
2. Never re-bind to make a check pass without reviewing what moved.
3. Keep the frames in the model: they are how every mating part is placed.
4. A generated plate is geometry, not a strength, stiffness or
   manufacturability claim; those need their own checks or tests.
