# @protoboardai/board-fill

Copper zone fills for the Protoboard PCB editor, computed from the board document of `@protoboardai/board`.
Zones are stored as intent; a fill is derived data (`protoboard.zone-fill/v1`, contract section 4.3), cached and
checked for staleness.

```ts
import { fillZones, refillZones, staleZones, verifyFill, writeComputedFill } from "@protoboardai/board-fill";

const r = fillZones(snapshot);                       // every zone, priority order; r.fill has source "computed"
verifyFill(snapshot, r.fill).ok;                     // exact distances: clearances, edge, keep-outs, width, islands
writeComputedFill(boardDir, r);                      // zone-fill.json and zone-fill-inputs.json in the build folder
staleZones(next, r.fill, r.inputs);                  // which zone layers are stale after a commit, and why
const r2 = refillZones(next, r, [...event.changed]); // only the zone layers (and windows) the change touches
```

What a fill keeps clear of, per zone and copper layer: the board edge and cutouts (edge clearance), copper of
other nets (pads of every shape and rotation, tracks and arcs, vias, copper graphics and text), drills and
non-plated holes (hole clearance), keep-outs that block pours, and higher-priority fills of other nets. Clearances
come from the board's rules with the contract's precedence and conditions; the zone's own clearance is a floor at
priority 0. Same-net pads connect solid, by thermal spokes (only where a spoke reaches copper and stays clear), or
not at all. `min_width` removes narrower parts (an inward then outward offset); islands are removed per the zone's
setting; hatched zones keep a solid border.

Correctness: curves are approximated within 5 micrometers, copper and holes from outside and the board and zone
outline from inside; every clearance is grown by a 10 nm margin, larger than the rounding to the nanometer grid, so
a check at exactly the clearance passes. The polygon boolean engine is written here (snap rounding on the integer
grid, exact orientation predicates, winding by a plane sweep) and has no third-party code.

Scripts: `scripts/time-synthetic.ts` (timing on a synthetic six-layer board), `scripts/soak.ts` (fill and verify
many random boards), `scripts/profile.ts`.
