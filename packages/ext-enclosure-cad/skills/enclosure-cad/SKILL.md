---
name: enclosure-cad
description: Design a custom enclosure (case, cap, back cover) as a UHD module of features, generate it with the @protoboardai/ext-enclosure-cad cad provider (build123d; protoboard run cad:generate / cad:export / cad:extract --module <id>), export print files, and fix what its check finds (collisions, clearance, thin walls, seal squeeze, misaligned openings and plungers, drift). Use when a project needs a printed or machined enclosure around a board and other parts, or when ENCLOSURE_* diagnostics fire.
---

# Enclosure CAD

An enclosure is a UHD module whose interfaces are the features it must
provide. The provider reads them, reads what the assembly puts inside, and
generates the enclosure. Full reference: the package README
(`node_modules/@protoboardai/ext-enclosure-cad/README.md`).

```
enclosure module (features) + assembly (what is inside) + cad.config.ts
        │  protoboard run cad:generate --module <id>
        ▼
build123d/<id>.job.json, <id>.py ─► build ─► <id>.report.json (fit, walls, seals)     (native design)
        │  protoboard run cad:export --module <id>
        ▼
out/body.step, body.glb, body.manifest.json, section.svg, <part>.stl / .3mf        (standard outputs)
```

## Purpose

Generate a case around a board and the other parts inside it, with every
opening, button, window, seal and fastening derived from the model, and a
check that says whether it fits. Use it when a project needs a printed or
machined enclosure, when anything inside it moves or changes size, and when
`ENCLOSURE_*` diagnostics fire. Plates and frames from bolt patterns are
**frame-cad**. In **build-a-project** it is stage 6, after the boards
(stage 5): the enclosure is fitted around `out/board.glb` and aligned to the
frames in `out/board.manifest.json`.

## Inputs

| Input | Where | From |
| --- | --- | --- |
| Everything inside, placed | mates to the enclosure (a board on insert bosses), or display placements in `.protoboard/display.json` (a cell held by tape) | **system-compose** |
| A body GLB for each placed part | a board's `out/board.glb`; a part's body artifact | **circuit-board**, the parts |
| Frames of what the enclosure serves (connectors, switches, LEDs, sensors), normal pointing out of the part | the board's `out/board.manifest.json`, or UHD frames | **circuit-board**, **uhd-part-author** |
| The size limit | a `design_envelope` trait from the brief | **system-compose** |
| Standard parts (O-rings, inserts, screws, spring bars, plugs) | the cited tables in `lib/standards.ts` | this provider |
| The `cad` runtime (build123d + scipy) | `npx protoboard doctor` | `npx protoboard tools install cad` |

## Steps

### 1. Before you start

- Everything that goes inside is placed in the assembly: mated to the
  enclosure (a board on insert bosses: a structure bolt pattern on the
  enclosure, a component bolt pattern on the board) or given a display
  placement in `.protoboard/display.json` (a cell held by tape).
- Each placed part has a body GLB: a board's `out/board.glb` from its
  circuit provider, a part's body artifact. A part without one is reported
  and not fitted.
- The connectors, switches, LEDs and sensors the enclosure serves have
  frames, with the normal pointing out of the part: in the board's geometry
  manifest (`out/board.manifest.json`), or as UHD frames.

```bash
npx protoboard check --format json         # no UHD_UNPLACED for parts that go inside; boards exported (no PB_OUTPUT_NOT_EXPORTED)
```

### 2. Describe the enclosure

In `src/enclosures/<module>/<module>.uhd.ts`, build its interfaces with the
builders from `@protoboardai/ext-enclosure-cad/lib/index.ts`: `Opening`,
`Button`, `Window`, `LightPipe`, `InsertBosses`, `SealGland`, `Thread`,
`StrapLugs`, `Joint`, `TwistLid`. Give a served feature `serves: { child, interfaceId }`
(a sibling in the system). Take standard parts from the cited tables
(`as568("AS568-138")`, `RUTHEX_RX_M2X4`, `M2X6_PAN`, `ESSLINGER_82_2225`,
`USB_C_PLUG` as an opening's `plug`; on a round wall add `seat: "flat"` so the overmold bears on a
flat seat instead of the curve) or
state your own values with a `source` or an `assumption`. Never write a
tool's name, document id or file layout into the module. Add a
`design_envelope` trait when the brief limits the size.

An outside `Window`'s cover is generated as a part of its own
(`out/cover_<window>.step|glb|dxf`, in the cover's frame): when it is bought or
cut separately (a lens), give it a module whose artifacts are
`coverArtifacts(out, windowId)` and a seat interface (custom peer, capability
`window_cover`, frame at its outer face, normal into the body), and link it to
the window, so the BOM and the assembly guide carry it. A `Joint` that screws a
lid on links to itself (`case.back_joint` ↔ `case.back_joint`) with
`harness: <screw harness>`; that harness's `fastenerStack` places the inserts
and screws at the columns the build report gives (`features.<joint>.columns`).

### 3. Configure and generate

`src/enclosures/<module>/cad.config.ts`:

```ts
export default defineCapabilityConfig({
  provider: "@protoboardai/ext-enclosure-cad",
  process: "print",
  constraints: { wall_mm: 1.7, clearance_mm: 0.3, material: "PETG", fasteners: "screws", joint: { style: "rabbet", clearance_mm: 0.1 } },
});
```

A rabbet joint needs `wall_mm` ≥ 2 × the minimum wall + the joint
clearance (print: 2 × 0.8 + 0.1 = 1.7 mm). The full list of constraints is
in the README, "Configuration".

```bash
npx protoboard tools install cad   # once per checkout: the shared cad runtime (or PROTOBOARD_PYTHON=<python with build123d and scipy>)
npx protoboard capabilities        # the enclosure is bound to @protoboardai/ext-enclosure-cad ✓
npx protoboard run cad:generate --module <instance or module id>
npx protoboard run cad:export --module <instance or module id>
npx protoboard check
npx protoboard run cad:extract --module <instance or module id> --format json   # frames and artifacts to reference
```

Read the generate summary: the parts, every body's fit status (clear,
tight, collision) and any generator problem.

Commit the native design (`build123d/<id>.job.json`, `<id>.py`,
`<id>.report.json`, `<id>.source.json`) and `out/`. `build123d/build/` is a
cache the repository ignores; `check` works from the report and `out/`.

### 4. Bind what extract returns

`cad:extract` returns the generated frame of every feature, keyed by
interface id, and the artifacts the module should reference (`cad_source`,
`cad_step`, `cad_glb`, `cad_manifest`, `<part>_stl`, `<part>_3mf`). Writing
them into the module source is a manual re-binding step for now (no
`enclosure-cad-rebind` operation yet): copy the artifacts and frames into
the module, then `npx protoboard check` must show no
`ENCLOSURE_FRAME_MISMATCH` or `UHD_GEOMETRY_BINDING`.

### 5. Look at it

```bash
npx protoboard dev --open          # the assembled enclosure with its contents, live; Ctrl+C stops it
```

`out/section.svg` is a section through the case for a quick look at walls and
clearances.

## Decision points

| Decision | Rule |
| --- | --- |
| `process` | `print` (STL and 3MF per printed part) or `machine` (STEP). `cut` is refused: cut panels are **frame-cad**. |
| Wall and joint | `wall_mm` ≥ 2 × minimum wall + joint clearance for a rabbet; a joint O-ring makes the joint flat. |
| Screws or a twist lid | When the size limit leaves no room for screw columns outside the lid seal (they bulge past the shell), a round enclosure closes with a `TwistLid` and a `SealGland` radial `at: "joint"` (`fasteners: "none"`). Bayonet when a feature in the lid must line up with what is under it (light pipes, a window): the slot ends fix the angle, and a key lug (`keyLugWidthMm`) makes it go on one way only (equal lugs let it go on n ways, which the build refuses unless `orientation: "any"`); thread otherwise. Printed: give the seal bore a `boreAllowanceMm` (about 0.1 mm radial for FDM PETG), since Parker's bore clearance (under 0.1 mm diametral) is tighter than a print holds, and measure the first printed bore. The collar (O-ring groove plus lock, about 8-10 mm) must sit above every cut through the side wall, since the lid turns: raise the cavity top if it does not. |
| Standard part or own values | A cited table entry when one fits; otherwise your values with a `source` or an `assumption`. |
| An intended contact | Only bosses declare contact zones; other intended contact needs the cavity clearance or the body excluded (`exclude`), said in the module. |
| Hand-edit the native design | Allowed (`export` rebuilds from it), but `check` then reports drift until `generate` writes it again from the model; prefer changing the module or the config. |

## Outputs

| Output | Where |
| --- | --- |
| The enclosure module | `src/enclosures/<module>/<module>.uhd.ts` |
| Native design (committed) | `src/enclosures/<module>/build123d/<id>.job.json`, `<id>.py`, `<id>.report.json`, `<id>.source.json` |
| Build cache (ignored) | `src/enclosures/<module>/build123d/build/` |
| Standard outputs | `src/enclosures/<module>/out/`: `body.step`, `body.glb`, `body.manifest.json`, `section.svg`, `<part>.stl`, `<part>.3mf` |

## Verification

```bash
npx protoboard check --format json     # the enclosure's cad:check ran: no ENCLOSURE_* error or warning; standard-outputs ran
npx protoboard run cad:generate --module <id>   # repeatable: a second run changes no committed file
```

## Failure handling

| Finding | Usual fix |
| --- | --- |
| `ENCLOSURE_NOT_GENERATED` | `run cad:generate`, then `cad:export` |
| `ENCLOSURE_COLLISION`, `ENCLOSURE_NOT_CONTAINED` | Something grew or moved since generation: regenerate. If it still collides, a boss, column or gland boss is in the way: move the part, add a board cutout, or set `cavity_mm`. A plunger in collision: the switch is too close to something else, or the native design was edited |
| `ENCLOSURE_CLEARANCE` | Raise `clearance_mm`, or accept it if the contact is intended (say so in the module) |
| `ENCLOSURE_THIN_WALL` | Thicker `wall_mm`/`lid_mm`, a smaller cut, or move the feature away from an edge or off the split plane (a ledge left on the outer face by a cut just under the split); for the rabbet's tongue and skirt, a thicker wall or a smaller joint clearance |
| `ENCLOSURE_MISALIGNED`, `ENCLOSURE_RECESS` | The served part moved: regenerate; if the recess is real, move the part to the wall or size the opening for the plug's overmold |
| `ENCLOSURE_PLUNGER` | Change `gapMm` or `protrudeMm`, or move the switch. A flange that no longer holds was trimmed to clear the board or the lid: move the switch further from the board's surface or the cavity's top, or use a smaller bore |
| `ENCLOSURE_PLUG_FIT` | Size the opening for the plug, or move it so the overmold sits on flat wall (away from the case's edges and the screw columns) |
| `ENCLOSURE_SEAL_SQUEEZE`, `ENCLOSURE_SEAL_FIT` | Choose the AS568 size whose I.D. matches the groove; do not edit gland depths away from Parker's table (the check compares with the table, not the job's copy) |
| `ENCLOSURE_STALE` | Review what changed (listed), then regenerate |
| `ENCLOSURE_NATIVE_EDITED` | The job or script was edited: `cad:export` rebuilds from it; `cad:generate` replaces it from the model |
| `ENCLOSURE_GENERATOR_STALE` | The provider's generator changed since the design was built: `cad:generate`, `cad:export`, review the diff and commit it with the run records |
| `ENCLOSURE_FIT_UNCHECKED` | The contents changed and Python is missing: `npx protoboard tools install cad`, then `check` |
| `ENCLOSURE_INPUT`, `ENCLOSURE_FEATURE_INVALID` | The model does not say enough: add the frame or placement the message names; build features with the builders |
| `ENCLOSURE_FEATURE_MISSING`, `ENCLOSURE_FRAME_MISMATCH` | Regenerate; re-bind the frames `cad:extract` returns |
| `ENCLOSURE_GENERATOR` | Read the message: no room for a plunger flange, a feature that cut nothing, a frame off its surface |
| `ENCLOSURE_ENVELOPE` | Thinner walls, a tighter cavity, or revisit the envelope with the brief's owner |
| `PB_OUTPUT_MISSING` (STL/3MF) | `process: print` without print files: re-export |

Every other code: **system-compose** [diagnostic codes](../system-compose/references/diagnostic-codes.md).

## Hard rules

1. Never write a tool's name, document id or file layout into the UHD module.
2. Never edit `out/`; change the module or the config and regenerate.
3. Do not print, upload or order anything: the provider stops at files.
