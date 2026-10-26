# UHD, UHD viewer and Protoboard: boundaries

Status: agreed after the quadcopter reference work; built.

Tool providers and capabilities: see [tool integrations](tool-integrations.md).

Protoboard is the hardware development tool that sits on top of UHD, CAD,
EDA and firmware tools. UHD stays a pure representation of hardware. The UHD
viewer is a standalone tool that loads UHD and displays it with its connected
artifacts. Protoboard hosts and extends the viewer through adapters; it
does not fork it.

## The test

> Could someone with only a UHD file and its artifact files use this, without
> running any tool?

- Yes → UHD (data, pure computation) or the UHD viewer (rendering).
- It runs, converts, talks to or writes a tool → Protoboard.

## Ownership

| | UHD core — pure data and maths | UHD viewer — standalone | Protoboard Stack |
|---|---|---|---|
| Model | Modules, interfaces, links, harnesses, groups/exports, traits, artifacts | Diagram and hierarchy views | Project loading, registry, origins, catalog, releases |
| Geometry | Frames; feature/artifact/procedural refs; `mateTransform`; `assemble`; fastener stacks; bolt-pattern holes; binding comparison against a manifest | 3D assembly, interface highlights, explode, labels, harness and wire rendering, procedural fallback geometry | CAD generation (frame-cad), STEP → GLB conversion, manifest production, re-binding, native tool adapters |
| Artifacts | `ArtifactDef` (format, role, units, provenance); the geometry-manifest schema as a contract | Loads formats it understands (GLB, images, links) through an artifact resolver | Resolvers for project, package and catalog bases, remote tools (Onshape, Zoo, KiCad), watching |
| Physical derivations | Mass (volume × material), torque, tool sizes, spin/handedness, propulsion tables | Displays them | Uses them in documents, checks and releases |
| Checks | Model rules (link DRC, supply budget, …), geometry-binding comparison | Overlays the diagnostics it is given | Aggregation, tool-backed and extension checks, operation records |
| Presentation | Intrinsic facts only: names, material, icon hint | Its own layout/display file, separate from UHD topology | Project display hints and viewer contributions |
| Workflows | — | — | Part research/authoring/verification, technical documents, firmware configuration, frame CAD, tests, releases |

## The viewer contract

The viewer takes a neutral input and needs nothing else to show a system:

1. **Model:** a UHD bundle (`@deltarobotics/uhd` `UhdBundle`): a root
   definition id, the definitions it references, and optional scenarios
   (named variants of the root and definitions).
2. **Artifact resolver:** `(definition, artifact) → URL`. The default resolves
   a bundle's per-definition artifact base; hosts replace or extend it.
3. **Format loaders:** GLB built in; others (STEP, native formats) are
   plug-ins. Protoboard converts server-side instead.
4. **Diagnostics:** the viewer runs UHD's own model checks. Hosts may add
   more (Protoboard's aggregate) and they are overlaid alongside.
5. **Display hints:** layout, label sets, placement hints, appearance and the
   3D view's opening (`spatial.view`: the direction drawn up, a saved camera)
   come from a display file keyed by instance paths, never from UHD topology.
6. **Contributions** (later): inspector panels, context actions ("Open in
   Onshape", "Regenerate frame") and overlays supplied by the host.

The viewer never edits geometry and never runs tools. Anything that writes
goes through a host contribution.

`protoboard build` writes the bundle (`.protoboard/build/uhd-bundle.json`)
with artifact bases resolved per origin; `protoboard dev` (M3b) serves the
viewer with a Protoboard adapter supplying resolver, diagnostics and
contributions, plus live reload.

## Moves (from the quadcopter work)

Status 2026-10-02: the part library is in the cloud
repository (`protoboard-cloud`, `library/`) and seeds the parts service
identically to UHD's copy, which stays, marked moved, until the CLI vendors
from the service. `frame.py` and `hardware.py` are `ext-frame-cad`
(`frame_cad.py`, `hardware-cad`); `cadArtifacts` is
`@protoboardai/ext-frame-cad/artifacts`; the technical-docs generator and skills
are `@protoboardai/ext-docs`; the part skills and scripts are
`@protoboardai/ext-parts`. UHD keeps the `uhd-authoring` reference skill. Still
to do: removing UHD's library copy, the viewer items below.

- Out of UHD into Protoboard extensions: the CAD generators
  (`library/cad/py/*`, `params.ts`, `rebind.py`; merge the two frame
  generators into ext-frame-cad), the technical-docs generator and skills,
  the part research/verification workflow (UHD keeps a schema-authoring
  reference), and `cadArtifacts` (a generator's file layout). Pure helpers
  (`withGeometry`, `feature`, `own`, `procedural`) stay in UHD.
- The part library moves behind the Protoboard cloud parts-library service and
  is distributed only through it (`protoboard parts add|update`); distribution
  stays under our control. No public npm package for now; npm-based downloads
  may be offered later as a controlled channel. UHD keeps the schema, pure
  helpers and test fixtures only.
- The quadcopter's canonical source is the Protoboard project; the UHD
  library copy is removed once the viewer loads bundles.
- Out of the viewer into data or adapters: quad imports (scenarios, battery
  pad, hand layout), the hand-written label list, material-by-id matching,
  the hard-coded assembly root and the wire floor.
- The battery strap becomes a real UHD harness with frames, so `assemble`
  places the battery and no hint is needed.
