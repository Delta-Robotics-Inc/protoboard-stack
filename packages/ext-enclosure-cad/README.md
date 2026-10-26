# @protoboardai/ext-enclosure-cad

A `cad` capability provider for enclosures: cases, caps and back covers.
It generates a printed or machined enclosure with build123d from two things
the project already knows:

- **the features the enclosure must provide**, as the interfaces of its UHD
  module (an opening for a USB-C receptacle, plungers for two switches, an
  O-ring groove, strap lugs, …);
- **what goes inside it**, from the assembly: the board's standard outputs,
  the cell, the display, every other placed body.

It then exports the `cad` standard outputs, extracts the feature frames, and
checks the design against the model and against what it holds. The contract
it implements is in [tool integrations](../../docs/specs/tool-integrations.md)
and the [provider guide](../../docs/guides/writing-a-capability-provider.md).

The skill **enclosure-cad** (`skills/enclosure-cad/SKILL.md`) is the
procedure an agent follows; this README is its reference.

## The model

An enclosure is an ordinary UHD module. Each feature is a mechanical
interface carrying an `enclosure_feature` trait: its kind, its sizes in mm,
the standard part it takes, and, for features that give access to something
inside, the part it serves. The builders in `lib/features.ts` write these
interfaces; the data they write names no tool, so another provider (Onshape,
Zoo) reads the same module.

```ts
// src/enclosures/case/case.uhd.ts
import { Button, InsertBosses, Joint, Opening, M2X6_PAN, RUTHEX_RX_M2X4, USB_C_PLUG } from "@protoboardai/ext-enclosure-cad/lib/index.ts";

export const CASE = {
  id: "watch-case",
  name: "Watch case",
  interfaces: [
    Opening({ id: "usb_opening", serves: { child: "board", interfaceId: "usb" }, widthMm: 9.6, heightMm: 3.9, cornerRadiusMm: 1.2, maxRecessMm: 2.0, plug: USB_C_PLUG, assumption: "…" }),
    Button({ id: "btn_a", serves: { child: "board", interfaceId: "btn_a" }, holeDiameterMm: 2.5, travelMm: 0.2 }),
    InsertBosses({ id: "board_mount", shape: "rectangle", spacingMm: 25, spacingYmm: 19, holeCount: 4, fastener: "M2", fastenerDiameterMm: 2, insert: RUTHEX_RX_M2X4, frame: { origin: [0, 0, 6], normal: [0, 0, 1] } }),
    Joint({ id: "lid_joint", screw: M2X6_PAN, insert: RUTHEX_RX_M2X4, count: 4 }),
  ],
  traits: [{ type: "design_envelope", params: { max_mm: { length: 50, width: 45, height: 20 } } }],
};
```

`serves` names an interface of a sibling module in the system the enclosure
sits in. The feature is placed on that interface's axis and checked against
it. The frame comes from the served module's geometry manifest when it has
one (a circuit provider's `board.manifest.json` names every connector, with
its normal), else from the interface's UHD frame. This relation is a
candidate for a UHD link kind; until UHD has one it is a trait parameter.

### Features

| Kind | Builder | The generator makes | The check verifies |
| --- | --- | --- | --- |
| `opening` | `Opening` | A rectangular (rounded) or round cut through the wall where the served part's axis leaves the shell | Axis offset ≤ 0.3 mm and ≤ 2° from the served part; recess ≤ `max_recess_mm`; what each part keeps above and below the cut; with `plug` (`USB_C_PLUG`), that the plug passes and its overmold has a flat seat (clear of the case edges and the screw columns' bulges) |
| `button` | `Button` | A bore, and a separate printed plunger: shaft to `gap_mm` short of the actuator, `protrude_mm` outside, and a flange behind the wall, trimmed (a polygon around the axis) to keep the design clearance from the walls and from every body inside | Alignment; gap ≥ 0 (not pressed at rest) and gap + switch travel ≤ protrusion (it can press the switch); room for the flange; after trimming, the flange overlaps the wall by ≥ 0.5 mm over ≥ half its edge (assumption: enough that it cannot tilt out through the bore); the plunger intersects no wall (exact) and no body inside (voxel) |
| `window` | `Window` | An aperture and a pocket for the cover (glass, lens, IR window), outside (flush) or inside | Alignment; the ledge holding the cover and the wall left under the pocket |
| `light_pipe` | `LightPipe` | A hole for the pipe plus clearance | Alignment; edge margins |
| `boss` | `InsertBosses` | Bosses from the floor to the frame (a structure bolt pattern), with heat-set insert holes; the floor is lowered if the insert hole needs it | Boss wall ≥ the insert's minimum wall; skin under the hole; the board mated to them sits on them (contact there is by design) |
| `seal_gland` | `SealGland` | Face groove in the base rim at the lid joint (`at: "joint"`, flat joint), a radial groove round a twist lid's collar (radial, `at: "joint"`), a face groove ring at a frame, or a static radial (female) gland around a rod or tube, with a boss when the wall is too thin | Squeeze within the gland table's range; installed stretch ≤ 5 %; face groove within +1 % of the O-ring's I.D. (external pressure) or −1 % of its O.D. (internal); rim ledges |
| `thread` | `Thread` | An internal single-start thread in a skirt under the floor (a cap on a neck) | Skirt wall; turns of engagement are reported |
| `strap_lugs` | `StrapLugs` | Two lugs at the ±Y end with blind spring-bar holes; the bar clears the case by `strap_gap_mm` at the strap's centre line | Lug wall and edge beyond the holes |
| `joint` | `Joint` | The split into base and lid: a rabbet (tongue on the base, skirt on the lid, each (wall − joint clearance) / 2 wide) or a flat joint; with screws, four columns with insert holes and lid clearance holes | Tongue and skirt widths; column wall around the insert; the screw does not bottom out |
| `twist_lid` | `TwistLid` | A lid that closes without screws on a round shell: the base's wall steps in to a collar at the top, the lid's skirt (the shell's own outer diameter) slides over it and locks. `lock: "bayonet"`: lugs low on the collar, 45° underneath, into L-slots in the skirt whose lower faces hold the lid down; the slot ends fix the lid's angle, and a key lug (`keyLugWidthMm`, the lug on +Y wider than a slot for the others) lets the lid go on in one position only, so features in the lid (light pipes) stand over what they serve. Equal lugs let it go on in as many positions as there are lugs: the build refuses that unless `orientation: "any"`. `lock: "thread"`: an external thread on the collar, the lid's internal one offset by half a pitch, 30° flanks. With a `SealGland` radial `at: "joint"`, an O-ring groove round the collar (above the lugs, or under the thread, so the skirt's bore that seals it is never slotted or threaded), and a 19° lead-in on the bore. `boreAllowanceMm` draws the bore that much (radial) over the size it should print at, for a printed bore's undersize; the groove's depth is from the printed bore. Facts: radii, levels, lug angles and widths, the positions the lid goes on in (`lid_positions`), or the thread, the drawn and printed bore, and each part's print orientation | Base wall behind the groove and at the lock; skirt wall behind the slots or the thread (≥ minimum wall); a bayonet's lid goes on one way (or `orientation: "any"`), its key wider than a slot for the others, and the skirt between neighbouring slots ≥ minimum wall; the collar fits above the floor; no opening, window or button cuts the side wall where the skirt covers the collar (the lid turns); the seal's squeeze against Parker's radial chart (the collar off centre by the radial clearance) and the groove's stretch of the O-ring (0-5 %); with a bore allowance, the squeeze if the bore prints at its drawn size (info) |

The standard parts these take are cited in `lib/standards.ts`:

| Data | Source |
| --- | --- |
| AS568 O-ring sizes (I.D., cross-section, tolerances) | Parker O-Ring Handbook ORD 5700A/US (2001), Series 2-XXX sizes, metric columns |
| Face seal glands | Parker ORD 5700 Design Chart 4-2 |
| Static radial glands | Parker ORD 5700 Design Chart 4-1 |
| 5 % maximum installed stretch | Parker ORD 5700 §3.3 |
| Face groove sized by the O-ring's I.D. (+1 %) or O.D. (−1 %) | Parker ORD 5700 Design Chart 4-2 notes |
| ruthex RX-M2x4 insert (Ø3.6 × 4.0, hole Ø3.2, wall ≥ 1.3) | ruthex product data, as read by the watch and bottle projects |
| CNC Kitchen M2 insert (Ø3.6 × 3.0, hole Ø3.2, wall ≥ 1.3) | 3DJake product page |
| M2 × 6 pan head screw; Ø2.4 clearance hole | Accu SPP-M2-6-A2 data; ISO 273 medium series |
| Esslinger 82.2225 spring bar (Ø1.5, tips Ø0.8, 25.0 overall, 21.8 compressed) | Esslinger product page |
| USB Type-C plug, `USB_C_PLUG` (overmold 12.35 × 6.5 max, plug 8.25 × 2.40, length 6.65) | USB Type-C Compliance Document rev 1.2, Appendix B, Figure B-1 |

Assumptions are stated where they are made: insert hole depth (insert length
+ 1 mm), lug hole size (tip + 0.2 mm, tip length + 0.3 mm), the minimum wall
by process (print 0.8 mm: two 0.4 mm extrusions; machine 0.5 mm), the
alignment tolerance (0.3 mm, 2°), the plunger flange's hold (0.5 mm over
half its edge). A module states its own values where it knows better, with a
`source` or an `assumption`.

### Cuts across the lid joint

A cut through a side wall (an opening, a bore, a pocket) is checked part by
part, across the wall in bands: for a rabbet, the lid's skirt outside, the
joint clearance, and the base's tongue inside, each with the z span the base
and the lid hold there. What each part keeps above and below the cut, in each
band, is a wall. Where a cut leaves a sliver thinner than the minimum wall at
the joint inside the wall (the tongue over a USB opening that stops just
under its top, say), the generator cuts the sliver away: the other part
closes the gap there and nothing shows from outside (`margins_mm.cleared` in
the report). A sliver on the outer face, or at the top or bottom of the case,
is left as designed and reported as `ENCLOSURE_THIN_WALL`.

A rabbet needs a wall of at least two minimum walls plus the joint clearance
(1.7 mm at 0.8 mm and 0.1 mm); a thinner one is reported.

### What goes inside

The job (`lib/job.ts`) assembles the system the way the viewer and
ext-harness-cad do (UHD `assemble` with the project's display placements;
`projectAssembly` is imported from ext-harness-cad) and takes every placed
body except:

- the enclosure itself;
- what its outside features hold (a bottle on the thread, spring bars in the lugs);
- instance paths listed in `exclude`;
- a part already inside a placed parent's body (a board's components).

A module designed by a capability provider contributes its standard output
(`out/board.glb` for a board); any other module its body GLB artifact. A
placed module with no GLB is reported, because the fit check cannot see it.
Fastener hardware is not included yet.

## Configuration

```ts
// src/enclosures/case/cad.config.ts
import { defineCapabilityConfig } from "@protoboardai/core";

export default defineCapabilityConfig({
  provider: "@protoboardai/ext-enclosure-cad",
  process: "print",
  constraints: { wall_mm: 1.7, clearance_mm: 0.3, material: "PETG", fasteners: "screws", joint: { style: "rabbet", clearance_mm: 0.1 } },
});
```

| Constraint | Default | Meaning |
| --- | --- | --- |
| `wall_mm` | required | Side wall thickness |
| `floor_mm`, `lid_mm` | `wall_mm` | Floor and lid thickness |
| `clearance_mm` | 0.3 | Gap between what goes inside and the walls |
| `clearance_top_mm` | `clearance_mm` | Gap above the tallest part |
| `min_wall_mm` | print 0.8, machine 0.5 | Thinnest wall allowed anywhere |
| `material` | — | Recorded in the manifest (mass = volume × density) |
| `shape` | `box` | `box` (rounded rectangle) or `round` |
| `cavity_mm` | sized from the contents | Fixed cavity: `{ min, max }` (box) or `{ centre, radius, z }` (round) |
| `split_z_mm` | under the lid | Split plane between base and lid |
| `joint` | rabbet, 1.5 mm lip, 0.15 mm clearance | `{ style: "rabbet" \| "flat" \| "twist", lip_height_mm, clearance_mm }`; a joint O-ring makes it flat, a `TwistLid` twist (`fasteners: "none"`). The tongue and the skirt are each (wall − clearance) / 2 wide |
| `fasteners` | `screws` if a joint states screws | `screws` or `none` |
| `exclude` | — | Placed instance paths that are not inside |
| `resolution_mm` | 0.25 | Voxel size of the fit analysis |

`process` decides the manufacturing exports: `print` gives an STL and a 3MF
per printed part (the report marks the parts `printed`), `machine` the STEP
alone. `cut` is refused: cut panels are
a plate provider's job (ext-frame-cad).

## Operations and files

```
src/enclosures/case/
  case.uhd.ts                 the enclosure as a UHD module (its features)
  cad.config.ts               this provider and its constraints
  build123d/                  native design (provider-owned)
    fixture-case.job.json     the generator's inputs: contents placed in the case's coordinates, features, design values
    fixture-case.py           the build script; runs the generator on the job
    fixture-case.report.json  what the build found: cavity, parts, feature facts, walls, problems, fit
    fixture-case.source.json  digests of the job and script the build came from
    build/                    what the script built: parts/<part>.step|glb|stl|3mf, body.step, body.glb,
                              body.manifest.json, section.svg (a cache: export rebuilds it)
  out/                        standard outputs (export)
```

Commit the native design (job, script, report, source) and `out/`. The
repository ignores `build/` directories; `check` needs only the report, the
job and, to re-analyse the fit when what goes inside has changed, the parts
in `out/body.glb` (one node per part), so a fresh clone is checked without
rebuilding.

| Operation | What it does |
| --- | --- |
| `cad:generate` | Builds the job from the model, the assembly and the config; writes the job and the script; runs the script; writes the report and the source digests next to the job, and the parts and body under `build/` |
| `cad:export` | Copies `body.step`, `body.glb`, `body.manifest.json`, `section.svg` and, for print, `<part>.stl` and `<part>.3mf` into `out/`. If the job or the script was edited since the last build, it rebuilds from them first |
| `cad:extract` | Returns the generated frame of every feature, keyed by interface id, and the artifacts the module should reference (`cad_source`, `cad_step`, `cad_glb`, `cad_manifest` (the ids the other cad providers use), `<part>_stl`, `<part>_3mf`) |
| `cad:check` | Pure. Drift, fit, walls, seals, alignment, envelope (below) |

```bash
npx protoboard tools install cad    # once: the cad runtime it shares with ext-frame-cad and ext-harness-cad
npx protoboard run cad:generate --module case   # PROTOBOARD_PYTHON=<python> overrides the runtime
npx protoboard run cad:export --module case
npx protoboard run cad:extract --module case --format json
npx protoboard check
```

`body.manifest.json` is a UHD geometry manifest: one feature per interface
id (area, centroid, normal, face count, from the faces the feature's tool
made), the volume of each printed part, and the generated frames. The STEP
holds each part and one thin named sub-shape per feature, so a UHD
`feature("<id>", { … })` reference can bind to it.

Generation is deterministic for a fixed job and build123d version: STEP
timestamps, 3MF entry times and 3MF object UUIDs are normalised.

**Hand edits.** The job and the script are the native design. Edit them to
change the enclosure directly; `export` rebuilds from them, and `check`
reports `ENCLOSURE_STALE` (the design no longer matches the model) and
`ENCLOSURE_NATIVE_EDITED` (not rebuilt yet). `generate` writes both files
again from the model.

## Checks

The fit analysis (`py/fit.py`) samples every body inside on its surface and
looks the samples up two ways:

- **Exact**, against the primitives the generator built the inside from: the
  cavity (a box or a cylinder) and the solids standing in it (insert bosses,
  lid screw columns, radial-gland bosses; finite cylinders). Exact on flat
  faces, good to the sampling step (half a voxel) on curved edges. No
  tolerance: below 0 mm is a collision, below the design clearance is tight.
- **Voxel**, in the signed clearance field of the parts as built, from
  ext-harness-cad's obstacle map (`py/route.py`) and GLB reader
  (`py/glb.py`), imported from that package: the parts are voxelised and
  filled, the distance transform of free space is the clearance field the
  harness router uses, and the same grid gives the depth of points inside a
  wall. This sees what the primitives do not (a hand-edited script). It is
  good to about one cell, so it has a one-cell band: a collision only past one
  cell of penetration, tight only one cell under the clearance.

The report says which analysis found the worst point (`basis`), and so do the
messages ("exact", or "±0.25 mm voxels"). Containment in the cavity is exact
too (mesh vertices against the box or cylinder). The same grid gives a voxel
estimate of the local wall thickness (twice the depth on the solid's medial
surface); the exact per-feature walls come from the generator.

Button plungers go through a wall by design, so they are checked apart:
against the walls exactly (the plunger's solid intersected with the base and
the lid), and against every body inside in a voxel field of the contents
around the plunger (its tip, which meets the switch by design, is left out;
the tip gap is checked exactly from the served frame).

When what goes inside has changed since generation, `check` re-runs the fit
analysis on the current bodies against the parts as built (from
`out/body.glb`, else `build/parts/`; the spec goes to Python on stdin;
nothing is written). Otherwise it reads the results recorded at generation,
and needs no Python.

Seal squeeze is checked against the row of Parker's chart for the O-ring's
cross-section (`lib/standards.ts`), not the copy of it in the job, so a hand
edit to the job's table is caught. The squeeze uses the gap the joint leaves
and the message states its basis: a flat joint with lid screws closes face to
face (contact); a face gland at a frame (a bottle lip on a cap) assumes the
mating face bears on it, because what presses it (the thread's engagement) is
not modelled; a radial gland's rod may sit off centre by the radial
clearance, so its squeeze is checked over that range.

| Code | Severity | When |
| --- | --- | --- |
| `ENCLOSURE_NOT_GENERATED` | info | No generated design yet |
| `ENCLOSURE_FEATURE_INVALID` | error | A feature interface the provider cannot read |
| `ENCLOSURE_INPUT` | error | The model does not say enough (a served part with no frame, the enclosure not placed, …) |
| `ENCLOSURE_STALE` | warning | Contents, features, design values or the job changed since generation; lists what |
| `ENCLOSURE_NATIVE_EDITED` | info | The native design was edited after its last build |
| `ENCLOSURE_GENERATOR_STALE` | warning | Built by another version of the generator (`py/enclosure_cad.py` or `py/fit.py` changed): the recorded `sourceDigest` differs from the one recomputed for the job; release refuses it |
| `ENCLOSURE_FEATURE_MISSING` | error | An interface with no generated feature, or the reverse |
| `ENCLOSURE_FRAME_MISMATCH` | error | A declared frame differs from the generated one |
| `ENCLOSURE_GENERATOR` | error | A problem the generator reported (no room for a plunger flange, a feature that cut nothing, …) |
| `ENCLOSURE_COLLISION` | error | A body inside intersects a wall, boss or column (exact: any depth; voxel: past one cell); a plunger intersects a wall (exact) or a body inside (voxel, past one cell) |
| `ENCLOSURE_NOT_CONTAINED` | error | A body reaches outside the cavity (exact) |
| `ENCLOSURE_CLEARANCE` | warning | A body is closer to a wall than the design clearance (exact: by any amount; voxel: by more than one cell), or a plunger is closer than that to a body inside (voxel) |
| `ENCLOSURE_FIT_UNCHECKED` | warning | The contents changed and Python is not available to re-analyse the fit |
| `ENCLOSURE_THIN_WALL` | error / warning | Below the minimum wall: exact per feature (error), or a voxel estimate anywhere (warning) |
| `ENCLOSURE_MISALIGNED` | error | An opening, window, light pipe or plunger off the axis of what it serves |
| `ENCLOSURE_RECESS` | error | The served part sits deeper behind an opening than allowed |
| `ENCLOSURE_PLUNGER` | error | A plunger presses its switch at rest, cannot reach it, or its trimmed flange no longer holds it in |
| `ENCLOSURE_PLUG_FIT` | error / warning | The plug a socket opening takes does not pass it (error); its overmold has no flat seat (warning) |
| `ENCLOSURE_SEAL_SQUEEZE` | error | O-ring squeeze outside the range of Parker's chart row for its cross-section |
| `ENCLOSURE_SEAL_FIT` | error / warning | Stretch over 5 % (error); a face groove not sized to the O-ring (warning) |
| `ENCLOSURE_ENVELOPE` | error | Bigger than the module's `design_envelope` |

Core adds `protoboard/standard-outputs` (the files in `out/`) and, when the
module references the manifest, `uhd/geometryBindings`.

## In the Manufacturing Package

With @protoboardai/ext-release, `protoboard release` calls `ops/package.ts` for
each unit that builds an enclosure this provider designs:

- `package:work-order`: the print order of a `print` enclosure: material,
  a printer profile (0.4 mm nozzle and 0.2 mm layers, stated as assumptions:
  the minimum wall is two 0.4 mm extrusions; perimeters from `wall_mm`),
  each printed part with its volume, orientation and supports (a side-wall
  cut wider than 10 mm, an assumption for a tuned printer, needs them), and
  post-processing: heat-set inserts, O-rings, plungers, lid screws.
- `package:test-plan`: the enclosure's own checks from the build report: seal
  squeeze against the gland table, buttons, plugs, the lid joint, and every
  body the fit analysis found tight.

`test/package.test.ts` checks both on a written build report.

## Limits

- Box and round shapes, one horizontal split plane, cuts square to a wall
  (within 10°). No ribs, draft, chamfers or print-orientation analysis.
- Lid screws: four columns at the cavity's corners (box) or at 45° (round),
  which bulge out of the outline; a round shell can close with a twist lid
  instead (bayonet or thread), which stays inside it. Snap fits are not
  generated. A twist lid's lug and thread sizes and clearances are for a
  printed fit (defaults 0.2 mm radial, 0.15 mm axial), not from a standard:
  check them on a first print. A bayonet's slots slide over the O-ring as the
  lid goes on (grease it); there is no detent holding the turned lid.
- Threads: one start, a symmetric trapezoid approximating the semi-buttress
  profile, no lead-in or run-out. Values for a real neck must come from a
  measured or cited finish; the bottle project's open question OQ-B4 applies.
- Plungers need room for a flange between the wall and the switch; a switch
  flush with the cavity wall is reported, not solved. A flange trimmed until
  it no longer holds is reported; the generator does not add another
  retainer. The flange is trimmed against sampled surfaces (0.1 mm apart,
  with half that added to the clearance).
- The exact fit knows the cavity and the cylinders standing in it; anything
  else inside the cavity (a hand-edited rib) is seen only by the voxel field,
  within one cell.
- Only bosses declare contact zones; other intended contact (a cell taped to
  the floor) needs the cavity clearance, or the body to be excluded.
- Fastener hardware is not part of the fit analysis.
- `extract` returns frames; writing them into the module source is a manual
  re-binding step for now (no `enclosure-cad-rebind` operation yet).
- The fit analysis caps the grid at 6 million cells and coarsens the
  resolution for large enclosures.
- lib3mf writes 3MF as ZIP64; core's structural 3MF check does not read
  ZIP64, so the generator repacks each 3MF as a plain ZIP.

## How an Onshape provider would implement the same capability

The capability contract does not change; only the native design does.

- **Native design.** A Part Studio driven by a FeatureScript feature that
  reads the same inputs this provider writes to `<id>.job.json`: contents as
  imported meshes or STEP placed by the job's matrices, the features with
  their served frames, the design values. The provider directory holds
  `onshape/` with the document, workspace and element ids and the
  FeatureScript source; those ids never go into UHD.
- **generate** creates or updates the document through the Onshape REST
  API. That is an upload to a cloud service, so the operation would declare
  an external effect and need `--authorize`; credentials come from the
  environment, never from project files.
- **export** requests translations: STEP and GLB of the Part Studio, STL and
  3MF per part (or DXF for flat parts with `process: "cut"`), into `out/`
  under the same names.
- **body.manifest.json** comes from FeatureScript queries: each feature tags
  its faces with an attribute holding the interface id, and an evaluated
  function returns their area, centroid and normal.
- **extract** reads the same attributes for frames.
- **check** compares the document's microversion and the recorded job with
  the model (drift), reports Onshape's own feature errors, and can reuse this
  package's `py/fit.py` on the exported meshes for fit, walls and
  containment, so both providers judge fit the same way.

Swapping is an edit to `cad.config.ts`; the module and everything
downstream of `out/` stay as they are.

## Tests

`test/enclosure-cad.test.ts` runs the provider contract on a synthetic
device (`test/fixture.ts`: a 30 × 24 mm board on four insert bosses, a cell,
a USB-C opening, two buttons): a two-part printed case whose fit checks
pass, with its STEP files probed exactly (`test/probe.py`): the plungers do
not touch the board or the cell, and no cut leaves a base or lid bridge
thinner than the minimum wall; a board 1 mm larger than the cavity is caught; a moved connector is
caught as misaligned; generation is byte-for-byte repeatable; a hand-edited
native design is rebuilt and reported; and the job that the other builders
(window, light pipe, lugs, thread, seal glands) produce through
`loadProject` is what the generator reads. `test/features.test.ts` builds a
round case (windows, a light pipe, lugs, a joint O-ring, screws), a bottle
cap (thread, lip and probe seals), a bayonet and a threaded twist lid on an
80 mm shell (the shell stays 80 mm across, the collar's levels, the seal's
stretch and squeeze through the check, and no volume shared by the built base
and lid), and a box case whose openings cross the lid joint, and runs the
check rules on a fabricated report. The generator tests need Python with build123d and scipy
(`PROTOBOARD_PYTHON`, else the quadcopter example's `tools install cad`
runtime, else the older `../uhd/.venv-cad`; see `packages/core/test/cad-python.ts`);
they are skipped, and say so,
otherwise.

## Evals

`evals/fit-grown-board`: the board in the synthetic device grows 2 mm and the
case no longer holds it; the agent makes the enclosure fit without touching
the board (needs Python with build123d). Run it with `protoboard evals
--extension enclosure-cad`; see the [evals guide](../../docs/guides/evals.md).
