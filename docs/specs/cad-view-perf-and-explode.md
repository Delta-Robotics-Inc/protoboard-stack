# 3D view: render performance and directional explode

Status: PARKED. Context captured 2026-10-29 for work Kevin will pick up later.
Nothing below has been implemented or verified; the "leads" are places to look
first, not diagnoses.

## Where the code lives

The 3D CAD view is not in this repository. It is the `CadView` of the sibling
`uhd-viewer` repository, which this stack consumes as `@deltarobotics/uhd-viewer`
(`file:../uhd-viewer` at the root; `^0.2.1` in `packages/cli`, `packages/views`
and `packages/web-viewer`). The VS Code extension (`packages/vscode-protoboard`)
and the web viewer are shells around it, so a viewer fix lands in `uhd-viewer`
first and reaches the CLI, the extension and the MCP-served views through a
version bump here.

| Concern | File (uhd-viewer) |
| --- | --- |
| Scene, renderer, GLB loading, render loop | `src/cad/scene.ts` |
| The view: bodies, explode tween, labels, sections, camera | `src/cad/CadView.tsx` (~1900 lines) |
| Stack plan: assembly order and rise along the up axis (pure) | `src/cad/explode.ts` |
| Sampling parts by raycast for the stack plan | `src/cad/explodeSample.ts` |
| Which bodies and GLBs to load, from UHD | `src/cad/model.ts` |

Branch for this work: `kevin/cad-view-perf-explode` in both `protoboard-stack`
and `uhd-viewer`, each cut from `main` on 2026-10-29. The old `protoboard-cli`
repository is archived (GitHub rejects pushes to it) and must not be used.

## Item 1: render performance on large assemblies

Symptom (Kevin): unusable on large, complex assemblies and poor even on simple
ones. Suspected cause: polygon / mesh size of the body GLBs.

Leads, in the order worth checking:

1. **Triangle budget of the GLBs.** Measure first: triangles per body and in
   total for a slow model (`BufferGeometry` index counts after load). The GLBs
   are generated from STEP by build123d / the cad extensions, so the fix may
   be upstream (coarser tessellation tolerance, or a decimation pass in the
   generator) rather than in the viewer.
2. **Always-on render loop.** `scene.ts` renders every animation frame via
   `requestAnimationFrame`, whether or not anything changed. Rendering on
   demand (camera moved, tween running, labels dirty) is the usual first win
   for a static CAD scene.
3. **Renderer settings.** `WebGLRenderer({ antialias: true,
   preserveDrawingBuffer: true })` with pixel ratio up to 2. The preserved
   drawing buffer exists for screenshots and costs on every frame; MSAA at
   2x device pixels is expensive on integrated GPUs.
4. **Raycast sampling for the explode plan.** The stack plan is computed once
   per loaded model (cached in `stackPlan`), so it is not per-frame, but the
   first explode fires a 14x14 grid of rays per part against every triangle
   of that part with plain `THREE.Raycaster` (no BVH). On a heavy mesh this is
   a one-time stall that feels like a hang. `three-mesh-bvh` or sampling
   against a decimated proxy would fix it.
5. **No compressed-geometry decoders.** `GLTFLoader` is used without Draco or
   Meshopt, so there is no cheap path to smaller GLBs even if the generator
   produced them.
6. **Draw calls.** One mesh per GLB node; a board with many components, or
   many cable conductors (one node per conductor), can mean thousands of draw
   calls. Instancing or merging static geometry per material would help.

Measure before changing anything: a slow model, frame time with the stats
panel or `renderer.info`, triangle and draw-call counts, and time-to-first-
frame.

## Item 2: directional explode (outward along face normals)

Today (PB-899): the exploded view takes the model apart in assembly order
along a single axis, the model's up direction. Each part rises until it
clears what it sits on, parts held inside another come out through the
holder's open side, and a part placed by a mate across the up axis comes off
along that mate instead. The plan is a map `part key -> rise (mm)` along one
axis (`planStack` in `explode.ts`), applied in `applyExplode` in `CadView.tsx`.

Kevin's requirement: in his current project the parts must explode
**outward at discrete angles, normal to the faces of the model**, rather than
all along one vertical axis. Think of parts mounted on the several faces of a
body, each leaving perpendicular to its own face.

Design questions to settle when the work starts:

- **Source of the direction.** Options: the normal of the mate frame that
  placed the part (already available: `mate.frame.normal`, used today only to
  decide whether a part is "along" the up axis); the nearest face normal of
  the parent body under the part's footprint; or an explicit per-link or
  per-module explode hint in UHD. The mate normal is the natural first choice
  because it is already authored data and already drives the "across the
  axis" case.
- **Discrete angles.** Snap the chosen normal to a discrete set (the six axis
  directions, or the set of distinct face normals of the parent) so parts on
  the same face move together and the view reads cleanly.
- **Generalising the stack plan.** `planStack` is per-axis. The simplest
  extension is to group parts by their explode direction, run the existing
  stack plan once per direction group (with that direction as the axis), and
  compose. Parts with no mate keep the up-axis behaviour so existing models do
  not change.
- **Clearance across groups.** A part leaving along +X must still clear parts
  leaving along +Z that it overlaps; the current clearance test assumes one
  axis.
- **Camera and labels.** `toggleExploded` frames the exploded bounds and the
  label layout assumes columns either side; both need to work for a radial
  explode.
- **URL and host API.** `explode=` in the view URL and the host `set({
  explode })` call stay scalar (0..1); direction is a property of the model,
  not of the view state.

Tests live in `uhd-viewer/test/explode.test.ts` with `boxGrid` fixtures; the
new behaviour should get the same kind of pure-function tests before the
scene wiring.

## Not done yet

- No measurements taken, no profiling, no code changed in either repository.
- The `uhd-viewer` branch is identical to its `main`; it exists so the two
  branches share a name.
