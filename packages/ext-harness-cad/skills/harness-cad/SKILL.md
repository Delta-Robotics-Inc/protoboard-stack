---
name: harness-cad
description: Generate a wire harness's routed 3D geometry (conductors along an obstacle-free route through the assembled model, twisted or flat, plug housings, solder joints) through the cad capability (`protoboard run cad:generate|export --module <harness>`, or the harness-cad alias), bind it to the frames its ends land on, and read the route report (length fit, bend radius, clearance). Use after harness-author has the cable (ends, conductors, length, gauge), whenever a part it connects moves, or when HARNESS_NOT_ROUTED / HARNESS_ROUTE_STALE / HARNESS_EXPORT_STALE / HARNESS_ROUTE_LENGTH / HARNESS_ROUTE_WARNING / HARNESS_NOT_CONFIGURED fire.
---

# Harness CAD

A wire harness in UHD is a module (`kind: "harness"`) whose ends are
connector composites linked to the parts' sockets or to link-scoped
compositions of pads (see **harness-author**). This skill gives it geometry.

How every cable of the reference quadcopter was worked out, modelled, routed
and drawn: `examples/quadcopter-5in/docs/harnesses-and-cad.md`.

## Purpose

Route each cable through the assembled model, so its length is checked
against a real path, its bend radius and clearance are known, and the
assembly guide, the viewer and the Manufacturing Package's harness files
show it. Use it after **harness-author** has the cable, whenever a part it
connects moves (a board, an enclosure, a plate), and when a `HARNESS_*`
finding fires. In **build-a-project** it is stage 7, after boards,
enclosures and structures are placed.

## Inputs

| Input | Where | From |
| --- | --- | --- |
| The cable: ends, conductors, `performance` (`length_mm`, `conductors`, `wire_gauge_awg`), `cable_build` | the harness definition in `src/harnesses/` | **harness-author** |
| Frames on every part the cable lands on | sockets' mating faces (xAxis pin 1 → pin N), pads' frames; a board's from `out/board.manifest.json` | the parts, **circuit-board** |
| Placement of every part | mates, or display placements (`spatial.placements` in `.protoboard/display.json`) for parts nothing mates | **system-compose** |
| Bodies the cable must clear | each placed part's GLB, designed modules' `out/` | the parts, the providers |
| The `cad` runtime (build123d + scipy) | `npx protoboard doctor` | `npx protoboard tools install cad` |

## Steps

### 1. Give the cable what it needs

On the harness definition:

- `performance` trait `{ kind: "cable", length_mm, conductors, wire_gauge_awg? }`
  — the length the geometry is fitted to (bought length, or the length you cut it to);
- `cable_build` trait — how it is built:
  `{ colors: [...per position of the first end], bundle: "twisted" | "parallel", twist_pitch_mm?, od_mm?, bare?, strip_mm?, spacing_mm?, note, source }`.
  Give `od_mm` when the gauge is not known, and an `assumption` trait saying so.

Every part it lands on needs frames: a socket's frame on its mating face
(xAxis from pin 1 to pin N), each pad's frame on the pad. Parts that no
mechanical link places (a taped receiver, a capacitor hanging on its leads)
need a display placement in `.protoboard/display.json`.

### 2. Configure it

This extension is a provider of the `cad` capability
(`docs/specs/tool-integrations.md`). Each cable gets a provider directory with
a `cad.config.ts`. Cables are usually declared together in one file, so the
config sits in a folder of its own and names the cable:

```ts
// src/harnesses/<harness id>/cad.config.ts
import { defineCapabilityConfig } from "@protoboardai/core";

export default defineCapabilityConfig({ provider: "@protoboardai/ext-harness-cad", module: "<harness id>" });
```

The route (native design) goes to `<dir>/harness-cad/route.json`, the bodies
(standard outputs) to `<dir>/out/body.{glb,step,manifest.json}`, in
assembly-root coordinates. Declare them on the harness with
`harnessCadArtifacts({ dir, name, tool })` from
`@protoboardai/ext-harness-cad/artifacts`, or let `routedHarness(def, { dir,
route: readRoute(<route.json>) })` from the same module do it: it declares
the artifacts and gives each end interface the frame it was routed to and a
feature ref to its plug or solder joints, so UHD `assemble` places the cable
from its first end and flags any other end that no longer meets its part
(the quadcopter's `routed(def)` in `src/harnesses/routes.ts`). It reads the
route only, never the exported manifest: an export then leaves the
definition as generate made it, and its record matches the module. Routes are written per definition: a cable used twice
needs two definitions.

```bash
npx protoboard capabilities              # each cable ✓ bound to @protoboardai/ext-harness-cad
```

### 3. Run it

```bash
npx protoboard tools install cad     # once per checkout, if doctor reports python-build123d missing
                                     # (PROTOBOARD_PYTHON=<python with build123d + scipy> overrides the runtime)
npx protoboard run cad:generate --module <harness id or instance path>   # route → harness-cad/route.json
npx protoboard run cad:export --module <harness id or instance path>     # route → out/ (emptied first)
npx protoboard run harness-cad --input harness=<id>,<id>                 # alias: both, for the named cables (every cable without --input), in one routing run
npx protoboard check     # each cable's cad:check + UHD assemble: every routed end still meets its part
```

`cad:extract` returns the end frames the route was generated for and the
cable's artifacts, as facts; it does not edit the model.

Routing order is the system's (hard rule 2). Generating one cable routes the
cables before it again, in memory (`data.context` lists them), and writes
only its own route, so a cable's route is the one a run over the whole
system gives, whatever was generated before. Regenerating a cable can
therefore change the cables after it: regenerate those too (the alias does
all of them in one run).

### 4. Read the report (manifest and op output)

| Field | Meaning | Act on |
| --- | --- | --- |
| `length_fit.route_mm` | shortest clear route | a cut-to-length cable: set `length_mm` to about this |
| `length_fit.method` | `shortest`, `bow`, `service loop` (slack laid out in clear space) | `… (not clear)`: the slack does not fit; shorten or re-place |
| `bend_radius_mm.centreline` | tightest bend away from the terminations | under `minimum` (2.5 × stiffness diameter) is a warning |
| `clearance_mm.min_conductor_surface` | closest any conductor comes to a solid (negative: inside) | under −0.2 mm is a warning naming the body |
| `notes` | every finding above, in words | each becomes `HARNESS_ROUTE_WARNING` |

Fix the model, not the geometry: move a part (display placement), change the
socket or pad a cable uses, change the length (cut, or a different cable),
or change how it is built (flat instead of twisted where it has to pass under
something). Never edit the generated files (`harness-cad/`, `out/`).

## Decision points

| Decision | Rule |
| --- | --- |
| One cable or all | The alias (`run harness-cad`) after any change that moves parts: one routing run, and each cable still gets its own `cad:generate` and `cad:export` record (the release traces each cable's `out/` to its `cad:export` record). `cad:generate` then `cad:export` for one cable re-routes the cables before it in memory, so it costs a routing run each. |
| Cut length | A cut-to-length cable takes `length_fit.route_mm` plus the service loop; a bought cable keeps its listed length and the route must fit it. |
| A route warning | Change the model (placement, socket, length, build); never accept a conductor inside a solid. |
| Twisted or parallel | Twisted for signal pairs and where the maker twists them; parallel (flat) where the cable must pass under something. State the choice in `cable_build.note` with its source. |

## Outputs

| Output | Where |
| --- | --- |
| Route (native design; generated) | `src/harnesses/<harness id>/harness-cad/route.json` |
| Routed bodies (standard outputs; generated) | `src/harnesses/<harness id>/out/body.glb`, `body.step`, `body.manifest.json` |
| End frames on the harness | through `routed(def)` / `harnessCadArtifacts` in the harness source |

## Verification

```bash
npx protoboard check --format json     # every cable's cad:check ran with no HARNESS_* warning; no UHD_ASSEMBLY on cable ends
npx protoboard run harness-cad         # a re-run changes no committed file (git status --short src/harnesses)
```

**harness-verify** compares each cable's modelled length with
`length_fit.route_mm`.

## Failure handling

| Code | Means | Do |
| --- | --- | --- |
| `HARNESS_NOT_CONFIGURED` (info, the `routes` check) | A wire harness has no `cad.config.ts` | Add one (step 2) |
| `HARNESS_NOT_ROUTED` (info) | No route yet | `run cad:generate --module <id>`, then `cad:export` |
| `REL_STALE` "<cable> changed since its last export" | The cable's definition changed after its export: its model, or (with a hand-written helper) something it reads from its own `out/` | Regenerate and export it; take the end geometry from the route with `routedHarness`, not from `out/body.manifest.json` |
| `HARNESS_ROUTE_STALE` | The route was generated for other ends, conductors, length or build, or an end no longer meets its part | Regenerate the cable and the ones routed after it (`run harness-cad`) |
| `HARNESS_EXPORT_STALE` | `out/` is older than the route | `run cad:export --module <id>` |
| `HARNESS_ROUTE_LENGTH` | Modelled and routed length differ | Regenerate, or set `length_mm` from the route |
| `HARNESS_ROUTE_WARNING` | Clearance, bend radius or slack | Fix the model (step 4), regenerate |
| `HARNESS_NOT_ROUTABLE` | The config names a module this provider cannot route | Point it at a wire harness with a `cable_build` trait |
| `UHD_ASSEMBLY` on a cable end | An end no longer meets its part | Regenerate; if it persists, the part's frame moved: check the part |
| `UHD_UNPLACED` for a part the cable reaches | Nothing places it | A display placement in `.protoboard/display.json` |
| `run` refused: tool `python-build123d` missing | No `cad` runtime | `npx protoboard tools install cad` |

Every other code: **system-compose** [diagnostic codes](../system-compose/references/diagnostic-codes.md).

## Hard rules

1. Harness ends are generated frames: do not hand-edit them; regenerate.
2. Order is rigid first (plug ends and component leads), then flying leads
   thickest first; a cable routed later keeps clear of the earlier ones.
3. Every length, gauge and colour is cited on the harness or an `assumption`.
