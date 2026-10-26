# Nested 3D assemblies: options

Status: options for a decision. Nothing here is built beyond the filter
fallback described in "What 0.1.7 does".

## The question

On the quadcopter, the "FC + ESC stack" sub-module's 3D tab showed an empty
grid. Its parts have models, but nothing inside the stack says where they
sit: the two boards are mated to the **frame** by links the **drone**
declares (`stack_mount`, `fc_mount` in `src/quadcopter.uhd.ts`), so the
only assembly that places them is the drone's.

The base requirement: opening the 3D view of a module whose parts have 3D
models must show those models. How assemblies nest is the open decision:
one segmented assembly filtered per sub-module, or assemblies that mirror
the UHD structure.

## How placement works today

- **Mates.** A mechanical link between two interfaces that both carry a
  geometry frame places one module against the other (UHD `assemble`,
  `uhd/src/system/geometry.ts`). The assembly starts at one root module at
  the origin and walks the mates. Link ids carry the path of the module that
  declares them.
- **Display placements.** `.protoboard/display.json` `spatial.placements`
  hold a matrix per instance path from the top level, for what no mate
  reaches (the quadcopter's battery, receiver and bulk capacitor), and
  `spatial.root` names the structure to start from
  ([reference/display.md](../reference/display.md)). It is presentation, not
  topology, and the one non-generated file under `.protoboard/`.
- **A module's own view** builds the assembly of that module alone,
  in its own coordinates, using only the mates it (and its descendants)
  declare, and the display placements under its path.
- **Who else assembles**: the harness router (`ext-harness-cad/lib/job.ts`,
  the whole system's assembly as obstacles), the release's assembly guide
  (`ext-docs/lib/package`, one unit at a time, by filtering the root
  assembly to the unit's instances: already option (a) in effect), `check`'s
  `UHD_UNPLACED` (`core/src/project.ts`), and the viewer.
- **CAD extensions**: `ext-frame-cad` writes a part's own body
  (`out/body.step`, `.glb`, manifest with named features); `ext-harness-cad`
  routes cables in the assembled system and writes each harness's body.
  Neither writes an assembly file. There is no assembled STEP export today;
  the KiCad handoff exports boards, not the mechanical assembly
  ([pcb-kicad-handoff.md](pcb-kicad-handoff.md)).

## What 0.1.7 does (built)

The viewer's `scopedModel` (`uhd-viewer/src/cad/scope.ts`):

1. the module's own assembly, as before;
2. when that leaves parts unplaced and the module has no body of its own,
   the **nearest ancestor** whose assembly places more of them: that
   assembly, cut down to the module's sub-tree and re-keyed to it, framed to
   fit, captioned "placed as in <ancestor>";
3. what still has no placement but has a model is drawn **side by side**,
   and the caption says "unplaced".

An empty state is one line ("No 3D model for <module> yet."), with the
host's how-to behind a disclosure. The root's view is unchanged. This is a
read-only fallback in the viewer; it changes no file and no format, and it
works the same under every option below.

## Option (a): one segmented root assembly, filtered per sub-module

The product has one assembly: the root's mates and placements. A
sub-module's 3D is always that assembly filtered to the sub-tree (what 0.1.7
does as a fallback becomes the rule).

- **Authoring by agents.** Simplest: one place to put every mate and every
  placement, keyed by paths from the top. An agent never decides "which
  level owns this mate". It does have to reason about the whole product to
  place a part inside a sub-module.
- **Reuse in two products.** Weak. The stack's internal arrangement (FC
  17.2 mm above the frame, ESC 7.2 mm) is written against the drone's frame,
  so a second product re-states it, and the two copies drift. Shown alone
  (no ancestor), a reused module has nothing to filter from and falls back
  to side by side.
- **CAD extensions.** No change: `ext-harness-cad` and the release already
  work from the root assembly and filter by unit.
- **STEP and KiCad export.** A single flat assembly STEP is easy (one
  placement per body). A per-sub-module STEP is a filtered copy in root
  coordinates, not in the sub-module's own frame, so it does not drop into
  another product's CAD at the origin. KiCad is unaffected (boards).
- **Migration.** None: the quadcopter already works this way.
- **Cost.** Low. The concept "a sub-module's own coordinates" stays only for
  modules that happen to mate their own parts (the arms).

## Option (b): assemblies mirror the UHD structure

Every module with children owns its placement: its own root, its mates, and
placements keyed from itself. The parent places the sub-module **as a
unit** through the sub-module's mounting interfaces (frames exported on
the sub-module's boundary), never its parts one by one.

- **Authoring by agents.** One more rule to follow, but local: "mate the
  parts where their module is defined; mate the module where its parent is
  defined." It matches how UHD is already written (children, exports,
  links per module), so an agent working in the stack's file never touches
  the drone. It needs one new thing: a sub-module's **mount frame**
  exported on its boundary (the stack's bottom standoff pattern), so the
  parent has something to mate.
- **Reuse in two products.** Strong. The stack is assembled once, in its own
  coordinates; each product mates the stack by its mount. This is the
  reason to choose (b).
- **CAD extensions.** `assemble` becomes recursive: assemble each child
  module in its own frame, then place it by its exported mount, compose the
  matrices. `ext-harness-cad` keeps working on the composed result (it only
  needs world positions). `ext-frame-cad` could offer a "sub-assembly"
  output (the module's parts as one placed group). Display placements are
  keyed per owning module (`placements` under the module that owns them, or
  a key prefix that the owning module defines).
- **STEP and KiCad export.** Natural hierarchy: one STEP per module with
  sub-assemblies as STEP sub-assemblies (`NEXT_ASSEMBLY_USAGE_OCCURRENCE`),
  which is how mechanical CAD tools expect a product; a module's STEP drops
  into another product at its own origin. KiCad is unaffected (boards).
- **Migration.** The quadcopter's `stack_mount`/`fc_mount` move: the stack
  gains a standoff mate between FC and ESC (inside the stack) and an
  exported mount frame; the drone mates the stack's mount to the frame.
  Projects whose parent mates a sub-module's parts directly keep working
  through the fallback (a parent mating `stack/fc` still places it), and
  `check` can report "mated across a module boundary" as info, to migrate
  over time. `display.json` keys stay paths from the top (unchanged
  meaning), so nothing breaks.
- **Cost.** Medium: recursive `assemble` in UHD (the open protocol; a
  minor, additive change), the mount-frame convention, a `check` finding,
  and guidance in the agents' skills.

## Option (c): hybrids

- **(c1) Mirror where the module owns it, filter where it does not.** (b)
  as the model, with today's fallback kept permanently: a module that mates
  its own parts shows its own assembly; one that does not shows the nearest
  ancestor's, filtered. No migration is forced; `check` nudges.
  **This is what 0.1.7 already does at view time**, so (c1) is (b) built
  incrementally.
- **(c2) Segmented root with named segments.** (a), plus a declared segment
  per sub-module (its own origin as a frame in the root assembly), so a
  filtered sub-assembly can be re-expressed in the sub-module's frame for
  export. Gets (b)'s export benefit without moving mates, but reuse still
  re-states the arrangement per product.
- **(c3) Per-module placements file.** Keep mates as they are, but let a
  module carry its own `display` placements (a sibling `module.display.json`)
  for hand-placed parts. Helps reuse of hand placements only; it does not
  answer where mates live.

## Comparison

| | (a) segmented root | (b) mirror UHD | (c1) mirror + fallback |
| --- | --- | --- | --- |
| Agent authoring | one place, whole-product reasoning | local rule per module, needs mount frames | as (b), nothing forced |
| Reuse in two products | re-state per product | assemble once | assemble once where adopted |
| CAD extensions | none | recursive `assemble` | recursive `assemble` |
| Assembly STEP | flat, root coordinates | hierarchical, per module | hierarchical where adopted |
| KiCad export | unaffected | unaffected | unaffected |
| Migration | none | move cross-boundary mates | optional, `check` info |
| Cost | low | medium | medium, spread out |

## Recommendation

**(c1): adopt (b) as the model, keep the 0.1.7 filter fallback for good.**

(b) is the one that makes a sub-module a reusable product part: assembled
once, mated by its mount, exported as a STEP sub-assembly, which is what
the orchestrator principle (modules own their data; build steps turn UHD
into each tool's format) asks of geometry too. The fallback means nothing
breaks while projects move over, and the base requirement ("click 3D on
something with models and see them") holds either way.

Proposed order, if chosen:

1. UHD: a module may export a mount frame; `assemble` composes child
   assemblies (additive, behind the current behaviour when nothing exports a
   mount).
2. `check`: `UHD_MATE_ACROSS_MODULE` (info) for a parent mating a child's
   parts directly.
3. Skills and `AGENTS.md`: mate parts where their module is defined.
4. The quadcopter migrated as the example; then an assembly STEP export per
   module.

## Open questions

1. (b) or (a) as the model? (c1) is the recommendation.
2. Should the root's view also show unplaced parts side by side (today it
   lists them as "not placed" and draws only what is placed)?
3. For a reused module, is a mount frame on its boundary acceptable as the
   one new authoring requirement?
