# Mates, joint limits and static interference

PB-1185, the part that needs no UHD schema change. A mate says how two part instances meet and how one may move against the other. Mates come from three sources, and the build, the assembly sequence and the CLI read all three:

| Source | Written by | Where | Drives the sequence? |
|---|---|---|---|
| `protoboard.mate` trait | a person or an agent, in the project's UHD | on the definition that declares the two instances (or the link), or on an interface as the part's own joint hint | yes |
| `<model>.mates.json` sidecar | a vendor, a measuring tool, a person | next to the model file it describes, bound to its bytes by sha256 | yes |
| inferred suggestion | `protoboard mates suggest` | `.protoboard/build/mates-suggested.json` only, never source | no, until a person writes a trait or a sidecar from it |

**Merge rule: trait beats sidecar beats inferred.** For one mate id the higher source wins. An inferred suggestion between two instances that a trait or a sidecar already mates is dropped as shadowed. `protoboard mates list` names what was shadowed and by what.

Code: `packages/core/src/mates/` (reader, merge, validator, suggestions, BVH, interference, voxel field), `packages/core/src/sequence/{mates,limits,keyframes,assemble}.ts`, `packages/cli/src/{mates,interference}.ts`; in uhd-viewer, `src/cad/sequence/{resolve,player}.ts`.

## Units and frames

Every frame is mm and Z up, in the instance's own body frame: the frame UHD's `GeometryFrame` uses. glTF (metres, Y up) is converted only at the boundary: where face geometry is read from a GLB (`mates/mesh.ts`), and where a sidecar says its frames were measured in glTF space (`target.units: "m"` or `target.upAxis: "+Y"`). The map is the viewer's `cadWrapper`: (x, y, z) m Y up becomes (1000 x, -1000 z, 1000 y) mm Z up. Limits are degrees for rotation and mm for slides after normalisation; a limit may be written in `rad` or `m` and is converted.

A frame is `{ origin, zAxis, xAxis? }`. `zAxis` is the joint axis (revolute, prismatic, cylindrical, coaxial) or the contact normal (planar), pointing out of the part toward its mate, as `GeometryFrame.normal` does. `xAxis` is the zero of a rotation. In a mate, `b` moves relative to `a`: a revolute joint turns `b` about `a`'s z axis through `a`'s origin.

## Kinds

| Kind | Degrees of freedom | Limits it takes | Fusion | Onshape | URDF |
|---|---|---|---|---|---|
| `fixed` | none | none | Rigid | Fastened | `fixed` |
| `revolute` | rotate about z | `rotate` | Revolute | Revolute | `revolute` / `continuous` |
| `prismatic` | slide along z | `slide` | Slider | Slider | `prismatic` |
| `cylindrical` | rotate and slide on z | `rotate`, `slide` | Cylindrical | Cylindrical | chain of two |
| `coaxial` | axes coincide (a constraint, like a concentric mate) | `rotate`, `slide` | (Cylindrical) | (Cylindrical) | none |
| `planar` | slide in the plane, rotate about its normal | `rotate`, `slide` | Planar | Planar | `planar` |

Not covered yet: pin-slot and ball (both exist in Fusion and Onshape), couplings (gear, rack and pinion, screw), and effort and velocity. They are on the Mark agenda in `docs/specs/cad-view-research/phase-1/for-mark.md`.

**Compared with Fusion (2026-11-01).** The Fusion connector was not reachable from the build session (connection refused; recorded in progress.md), so this comparison uses the round 2 research (`review-round-1/round-2-notes/mates-joints-animation.md` A.2 and A.3), not a live design. Fusion's joint types are Rigid, Revolute, Slider, Cylindrical, Pin-Slot, Planar and Ball. Each joint's Motion Limits has a minimum, a maximum and a **rest** value per degree of freedom. The API works in centimetres and radians. Our limit shape (`dof`, `min`, `max`, `rest`, `unit`) maps one to one onto Fusion's limits; only the unit conversion differs (we keep mm and degrees, and accept rad and m). Gaps: pin-slot, ball, Fusion's rigid groups (a set of components welded together, which we express as `fixed` mates pair by pair), and motion links (couplings).

## The trait

UHD puts traits on definitions and interfaces, not on a `ChildModuleRef` or an `InterfaceLink`. So a mate between two instances is a trait on the definition that declares them, and it names them by path relative to that definition (`"."` is the definition's own instance). The reader prefixes every path, and the id, with each instance path of the declaring definition, just as `assemble()` prefixes link ids.

```ts
// on the definition that declares "base" and "lid"
traits: [
  { type: "protoboard.mate", params: {
      id: "lid_hinge", kind: "revolute",
      a: { instance: "base", interface: "hinge" },                          // the frame from the interface's geometry frame
      b: { instance: "lid", frame: { origin: [0, 40, 12], zAxis: [-1, 0, 0] } },   // or a frame, mm, Z up, body frame
      limits: [{ dof: "rotate", min: 0, max: 110, rest: 0, unit: "deg", source: "hinge datasheet p. 2" }] } },
  // a link's mate: the ends and frames come from the link (the end assemble() placed through it moves)
  { type: "protoboard.mate", params: { link: "prop_on_shaft", kind: "revolute" } },
]
// on an interface: the part's own hint for any link that mates it
interfaces: [{ id: "hinge", /* ... */ traits: [{ type: "protoboard.mate", params: { kind: "revolute", limits: [/* ... */] } }] }]
```

Other params: `provenance` (`declared` by default, or `measured`), `suppressed: true` (the toggle: the mate is kept but moves and places nothing), `note`, `evidence`. A module trait that names a link beats an interface hint for the same link (`link:<id>`).

## The sidecar

`X.step` or `X.glb` has `X.mates.json` beside it (for example `model.lcsc-C393939.mates.json`). Schema `protoboard.mates/v0`:

```jsonc
{
  "schema": "protoboard.mates/v0",
  "target": { "file": "model.lcsc-C393939.step", "sha256": "sha256:…", "units": "mm", "upAxis": "+Z" },
  "part": "shouhan-type-c-16pin",
  "interfaces": { "usb": { "kind": "prismatic", "frame": { "origin": [0, 0, 0], "zAxis": [0, -1, 0] }, "limits": [{ "dof": "slide", "min": 0, "max": 4.8, "unit": "mm", "source": "GCT USB4105 drawing" }] } },
  "mates": [{ "id": "latch", "kind": "revolute", "a": { "instance": ".", "frame": {} }, "b": { "instance": "latch", "frame": {} } }]
}
```

The values above are illustrations, not measurements. Rules:

- **Binding.** The sidecar is used only while `target.sha256` matches the bytes of `target.file`. Otherwise it is `MATES_SIDECAR_STALE` (a warning) and ignored until the model is measured again.
- **Containment.** `target.file` is a file name in the same folder, never a path. A link out of the folder is refused (`MATES_SIDECAR_TARGET`).
- **Size.** A sidecar over 1 MB (DEFAULT) is not read (`MATES_SIDECAR_INVALID`).
- **Paths.** Instance paths in `mates` are relative to the instance whose model it is. `interfaces` entries are hints for every link that mates that interface on that instance.
- **Provenance.** Sidecar mates default to `measured`.

## Validator (`protoboard mates validate`)

| Code | Severity | Meaning |
|---|---|---|
| `MATE_KIND_UNKNOWN` | error | the kind is not one of the six above |
| `MATE_FRAME_INVALID` | error | an origin or axis that is not three finite numbers, or a zero axis |
| `MATE_FRAME_MISSING`, `MATE_END_MISSING` | error | a trait end with no usable frame; a trait with neither two ends nor a link |
| `MATE_FRAME_SKEW` | warning | xAxis more than 1° off perpendicular to zAxis (it is squared up when used) |
| `MATE_INSTANCE_UNKNOWN`, `MATE_SAME_INSTANCE` | error | an end names no instance, or both ends are one body |
| `MATE_LIMIT_UNIT`, `MATE_LIMIT_DOF`, `MATE_LIMIT_RANGE` | error | wrong unit for the dof; a dof the kind does not have; min above max |
| `MATE_REST_OUTSIDE` | warning | rest outside [min, max]: the sequence holds it at the stop |
| `MATE_LIMIT_UNSOURCED` | info | a declared limit cites no source and states no assumption (the torque rule) |
| `MATE_PROVENANCE`, `MATE_CONFIDENCE` | error, warning | an unknown provenance; an inferred mate without a confidence in [0, 1] |
| `MATE_LINK_UNKNOWN`, `MATE_DUPLICATE_ID` | warning | `link` names no mated link; two mates share an id |
| `MATES_SIDECAR_STALE`, `MATES_SIDECAR_TARGET`, `MATES_SIDECAR_INVALID` | warning, error, error | see the sidecar rules above |

The validator code is `protoboard/mates`. Wiring it into `project_check` is a handoff to the owner of the check (handoffs.md, W4-E).

## Mates in the assembly sequence

`buildSequence` (the build's `sequence.json`) reads the traits and the current sidecars (never inferred mates) after the patches:

- A driving mate of kind revolute, prismatic or cylindrical, or a coaxial or planar one with a rotate limit, becomes a `JointDef` on the moving end, with its limits as hard stops and `limitsFrom: "mate:trait"` or `"mate:sidecar"`. Its axis is a world line, a new `FrameRef` `{ at, axis }` in the assembly's mm, Z up.
- A body that only the stack planner placed (a `place:<key>` step), and that a mate joins to a placed body, gets a `fit:mate:<id>` step along the mate's axis instead. The mate now says how the body goes on.
- A joint the sequence already declares (an authored patch joint) is kept (`SEQUENCE_MATE_JOINT_AUTHORED`, info).

**Joint limits are hard stops.** A step may carry joint keyframes (`SeqStep.joints`, for example `{ "lid_hinge": 90 }` for "open the lid"). Set them with a patch: `{ step: "open", set: { joints: { lid_hinge: 90 } } }`. A keyframe beyond a stop is held at the stop and flagged on the step (`SeqStep.limits`: `{ joint, asked, held, stop }`). A rest beyond a stop is held and flagged on the joint (`JointDef.limited`). Both are `SEQUENCE_JOINT_LIMIT` warnings; a keyframe naming no joint is `SEQUENCE_JOINT_UNKNOWN`.

In the viewer, `resolveSequence` applies the same rule to any file, and `poseAt` plays keyframes in assembly order: the assembled model shows the last keyframe and fully apart shows rest. A driven value wins over the keyframe, and it too is held at the stops. The player reports a stop through the existing step API: `snapshot().steps[i].limits` for keyframes, `snapshot().joints[id].held` and `run({ action: "joint", ... }).held` for a drive or a clip sample, and `joints[id].limited` for a rest. `currentStep()` and `onStepChange()` are unchanged.

## Suggestions (`protoboard mates suggest`)

Every face of every placed body is fitted. A face is one view-sidecar face-range entry, which is one source primitive, which is one B-rep face in an OCCT export; without a current view sidecar, one primitive of the source GLB. Each face is fitted as a plane (every triangle normal within 1° of the mean) or a cylinder (the normals lie in one plane, a circle fit through the vertices, an arc of at least 90°). Then two bodies whose bounds come within 1 mm are read as one of:

| Reading | Kind | From |
|---|---|---|
| an aligned hole pattern, or two or more parallel coaxial hole lines | `fixed` | holes: inner cylinders whose faces on one axis together cover 300° or more. A STEP kernel often splits a hole into two half-cylinders, and these are merged. Every hole of one set lies on an axis of the other's set, with radii within 0.6 mm (an M3 clearance hole over a tapped hole). A seating face across the axis raises the confidence |
| one shaft-in-bore line with a seating face across it | `revolute` | a prop on a motor shaft. Read as a turning joint; a key, a nut or a press fit may hold it fixed, which a person decides |
| a shaft in a bore without a seat, or two coaxial cylinders | `coaxial` | |
| holes only congruent, not aligned in the assembled pose | `fixed`, low confidence | equal count, pairwise distances within 0.1 mm; the note says how far apart they are |
| a face contact alone | `planar` | opposed normals, offsets within 0.05 mm, outline bounds overlapping by at least 1 mm² (an upper estimate of the area) |

Each suggestion has provenance `inferred`, a confidence in [0, 1], evidence (instance, view node, feature id, fitted radius, arc, area), and frames in each instance's own body frame. A suggestion between bodies that a UHD link already joins (the link's ends, or a fastener stack's structure and mounted body) is counted as **covered**, not listed. Every tolerance is a DEFAULT, written into the output file as `tolerances`.

Bodies that are mesh-origin (an STL turned into one face) give no face-level evidence. Placeholders are skipped.

## Static interference (`protoboard interference`)

```
protoboard interference [--at <keyframe | t>] [--json] [--max-seconds N] [--contact-mm X] [--no-voxel] [--voxel-mm R] [--max-voxels N] [--all]
```

- **Keyframes.** `assembled`; `step:<id>` (just before that step is assembled, like the player's goto); `joint:<id>@min` and `@max` (assembled, that joint at its stop); or a number t from 0 to 1. Screw turns are left out, which a round fastener does not notice (DEFAULT). Parts the viewer's stack planner places are left out while their step is apart, because their exploded position is decided at view time (DEFAULT).
- **Walls: voxel.** When ext-enclosure-cad generated an enclosure and a CAD Python runtime is present, the enclosure is voxelised and its signed distance field built as its fit analysis does: ext-harness-cad's `ObstacleMap`, the EDT of free space minus the depth into solid, imported read-only from `fit.py`. Every other body's surface is sampled at each keyframe pose. Deeper than one cell inside a wall is interference. The field is capped at 6,000,000 cells (DEFAULT; the cell grows to fit, as fit.py does), with a 0.5 mm cell asked for (DEFAULT).
- **Everything else: BVH.** World boxes are swept first, then the two meshes' BVHs (own code, no new dependency). The penetration depth is estimated from up to 512 vertices and triangle centres of each mesh found inside the other (ray parity, majority of three rays), as their distance to the other surface. This is a **lower bound**. Below 0.1 mm a hit is `contact` (tessellation, modelled zero-clearance fits); above it, `interference` (DEFAULT).
- **Intended.** A hit between parts a link joins is marked `intended`: a link's two bodies, a fastener with the bodies its harness joins, two parts of one harness. Examples are a screw in its tapped hole and a board on its standoffs. Exit code 1 means an interference that no link intends.
- **Reuse.** A pair's result is reused at every keyframe where neither body moved relative to the other.
- **Budget.** The whole run has a 120 s budget (DEFAULT). Keyframes after it are left out, and the report says so.
- **Report.** The report always says which method ran: `method.pairs` is `bvh`, and `method.walls` is `voxel` or `bvh`.

Measured on 2026-11-01: see progress.md, "W4-E mates and interference".
