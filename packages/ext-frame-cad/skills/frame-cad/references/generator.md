# Generator reference (`@protoboardai/ext-frame-cad`)

Files: `lib/params.ts` (model + constraints → params), `py/frame_cad.py`
(params → CAD), `lib/plate.ts` (the `cad` capability's generate, export,
extract and check), `ops/cad.ts` (their entries), `ops/frame-cad.ts` (the
alias), `ops/rebind.ts`, `checks/frames.ts`; for hardware,
`lib/hardware.ts`, `py/hardware_cad.py`, `ops/hardware-cad.ts`,
`checks/hardware.ts`; `lib/artifacts.ts` (the files both write, as UHD
artifacts: `cadArtifacts`, `plateCadArtifacts`, `hardwareCadArtifacts`,
exported as `@protoboardai/ext-frame-cad/artifacts`).

`frame_cad.py` is the merged frame generator. UHD's library held the first
one, `library/cad/py/frame.py` with `common.py`, which built the reference
quadcopter's plates from hard-coded positions; `frame_cad.py` places the same
features (core holes, raised pads on arms, side clamps, slots) from any
module's bolt patterns, and generates the quadcopter's frame and top plate
from its interfaces. For the quadcopter frame, all eight interface features
have the same signatures as frame.py's (compared manifest to manifest); the
body differs in outline details, so its volume, and the mass computed from
it, is 57 154 mm³ against frame.py's 59 863 mm³. UHD's `frame.py` and `hardware.py` were removed from UHD
; `hardware.py` became `hardware_cad.py` below.

## Which modules

Local definitions used by the project whose mechanical domain metadata has
`plate_thickness_mm`, each with a `cad.config.ts` naming this provider. The
capability operations take one module (`--module <id>`); the `frame-cad`
alias takes every plate module, or `--input module=a,b`, and refuses a
plate module with no config. A catalog definition is refused (derive a local
variant). Bolt-pattern interfaces without a frame, patterns missing
`hole_spacing` / `fastener_diameter`, and frames that are neither vertical
nor horizontal fail the run with the reason.

## Constraints in `cad.config.ts` (all optional, mm)

| Key | Default | Meaning |
| --- | --- | --- |
| `outline_mm` | extent of the core holes and clamps + `margin_mm` | `{ x: [min, max], y: [min, max] }` of the core plate |
| `margin_mm` | 3 | outline margin around core holes and clamp plates |
| `corner_radius_mm` | 1.5 | fillet on vertical edges (skipped if the kernel rejects it) |
| `arm_width_mm` | 14 | arm from the core to each pad hub |
| `arm_slot_width_mm` | 5 | lightening slot down each arm, outside the core and ≥ 4 mm from hub and core; 0 = none |
| `hub_extra_mm` | 1 | hub disc radius beyond the pad |
| `pad_margin_mm` | 3 | pad radius beyond the pattern (circle: spacing/2 + 3) |
| `pad_height_mm` | 0.5 | raised pad height (its top is the mating face) |
| `pad_center_relief_mm` | 3.5 | centre hole radius in circle pads (shaft / circlip) |
| `pads` | circle patterns facing +Z | interface ids to build as raised pads |
| `hole_clearance_mm` | 0.1 | radial clearance (M3 → Ø 3.2) |
| `clamp_wall_mm` | 2 | side-plate thickness |
| `clamp_margin_mm` | 4 | side-plate width = spacing + margin; top = centre + spacing/2 + margin |
| `clamp_height_mm` | frame origin z − thickness | clamp centre above the plate top; state it explicitly so a thickness change moves the clamp with the plate |
| `slots_mm` | none | extra rectangular cut-outs `[{ center: [x, y], size: [dx, dy] }]` (strap slots) |

The quad frame sets `clamp_height_mm: 10, pad_height_mm: 0.5, arm_width_mm: 14`;
the top plate sets its outline (covers the battery), `corner_radius_mm: 4` and
two strap slots.

## Params file (`frame-cad/params.json`, schema `protoboard.frame-cad.params/v0`)

`plate` (thickness and the values above) and `interfaces[]`: `id`, `shape`,
`spacing`, `spacing_y`, `hole_count`, `fastener_d`, `placement`
(`holes_top | holes_bottom | pad | clamp`), `origin` (x, y), `normal`,
`x_axis`, `symmetry`, `height`, `holes` (world x, y). `name` is the module
id; it labels the STEP compound and seeds the DXF GUIDs. It is written by
`cad:generate` and read by `cad:check`: if recomputing it from the model and
constraints gives something different, the CAD is stale.

## Outputs

The generator writes `<name>.*` into a scratch folder; generate keeps the
frames, export copies the rest to the standard names.

| File | Content |
| --- | --- |
| `frame-cad/frames.json` | interface → `{ origin, normal, xAxis, symmetryDeg }` of the generated geometry (native design, with `params.json`) |
| `out/body.step` | compound: `plate`, `pads`, `clamps`, and one named sub-shape per interface feature (thin solid over its faces) |
| `out/body.glb` | the same, tessellated (glTF metres, Y-up) |
| `out/body.manifest.json` | `features: { <interface>: { area_mm2, centroid, faces, normal? } }`, tool, toolVersion, generator, params, `sourceDigest` = sha256(generator + params), `manufacturing`, and `exportedFrom` (the params file and its digest, for the export-stale check) |
| `out/body.dxf` | profiles: layer `plate`, layers `clamp_<interface>` |
| `out/interfaces/<id>.glb` | one file per interface feature (D2) |

Feature selection: hole patterns → the plate's cylindrical hole walls at the
pattern's positions and radius; pads → the pad's top face; clamps → the two
inner faces of the side plates. Signatures are rounded to 0.001.

Determinism: the STEP header time and the DXF timestamps and GUIDs are fixed
and the interpreter runs with `PYTHONHASHSEED=0`, so equal inputs give equal
bytes with the same build123d version.

## Hardware (`hardware-cad`)

Params file `<name>.params.json`, schema `protoboard.hardware-cad.params/v0`:
`part: { kind, diameter, length, head_diameter, head_height, outer }` (null
where the kind does not use it), read by `lib/hardware.ts` from the module
(see SKILL.md §5).

| Kind | Body (origin, +Z) |
| --- | --- |
| `screw` | head cylinder `head_diameter` × `head_height` below z = 0 with a hex socket (circumradius 0.45 d, 0.6 × head height deep); shank 0.95 d × `length` above |
| `nut` | hex prism, `outer` across flats, bore d, `length` high |
| `standoff` | hex prism, `outer` across flats, bore 0.85 d, `length` long |
| `spacer` | tube, `outer` diameter, bore d + 0.4, `length` long |

A stated `bore_mm` (the params' `bore`) replaces the nominal bore of a nut,
standoff or spacer.

Outputs: `<name>.step` (one body labelled with the kind), `<name>.glb`,
`<name>.manifest.json` (`volume_mm3`, `bodies`, empty `features`, tool,
generator, params, `sourceDigest` = sha256(generator + params)). One process
per module and a fixed STEP time, so equal inputs give equal bytes.
