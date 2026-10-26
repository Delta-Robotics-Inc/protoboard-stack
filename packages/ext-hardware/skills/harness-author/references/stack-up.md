# Stack-up worked examples (quadcopter-5in)

All positions in mm along the structure-side frame's normal, from the
structure face (z = 0), as `fastenerStack` states them and as
`scripts/stackup.ts` prints them. Plate thicknesses: bottom plate 5, top plate
2 (frame module metadata `plate_thickness_mm`).

## Stack hardware — M3 × 30, spacers, grommets, nyloc (bus: ESC and FC share the bolts)

| z from … to | Item | Source of the thickness |
| --- | --- | --- |
| −5 … 0 | bottom plate (screw head under it) | frame design value |
| −5 … 25 | M3 × 30 screw (`atMm: -5`, up) | ISO 4762 length |
| 0 … 6 | 6 mm nylon spacer | Ettinger 005.83.060 listing |
| 6 … 10 | ESC in its M3 grommet (4 mm clamp) | assumption on the grommet clamp (DolphinRC stack) |
| 10 … 16 | 6 mm nylon spacer | Ettinger listing |
| 16 … 20 | FC in its grommet | as the ESC |
| 20 … 24 | M3 nyloc nut, 0.3 N·m (snug: soft grommets) | ISO 10511 nominal height |

Grip = 5 + 6 + 4 + 6 + 4 + 4 = 29 mm; the M3 × 30 ends at 25: **1 mm beyond
the nut's far face**. An M3 × 25 would stop 4 mm short: the nut check fails.
The mates follow the same numbers: the 1.6 mm ESC PCB sits centred in its
4 mm grommet, so its underside is at 6 + (4 − 1.6) / 2 = 7.2 mm
(`gapMm: 7.2`), the FC's at 17.2.

## GPS hardware — M2 × 12 down through the board into a nut under the top plate

| z | Item |
| --- | --- |
| −2 … 0 | top plate |
| −4.8 … −2 | M2 nyloc nut (`atMm: -2`, `direction: -1`) — 2.8 mm nominal (the listing gives no M2 dimensions: assumption) |
| 0 … 5 | 5 mm nylon spacer (the GH6P sockets stand 4.35 mm proud; vendor STEP) |
| 5 … 5.62 | GPS PCB, 0.62 mm |
| 5.62 … −6.38 | M2 × 12 screw, head on the board (`atMm: 5.62`, `direction: -1`) |

Grip 0.62 + 5 + 2 + 2.8 = 10.42 mm. M2 × 12 leaves **1.58 mm beyond the far
face**; M2 × 10 would stop 0.42 mm inside the nut (`UHD_ASSEMBLY … ends 0.4 mm
short`; the `short-gps-screws` fault scenario). Torque 0.1 N·m, an assumption
well under the M2 class 4.6 table value (0.17 N·m) so the PCB and spacers are
not crushed.

## Air-unit hardware — M2 × 18 up through the plate, airflow spacers, module, nut

−5 … 0 plate · −5 … 13 M2 × 18 · 0 … 3 spacer · 3 … 9 module mounting ear
(6 mm) · 9 … 11.8 nut. Grip 16.8 mm: **1.2 mm beyond**. The 3 mm spacer is the
DJI airflow requirement (mate `gapMm: 3`).

## Frame hardware — two blind threads in a 30 mm standoff

−5 … 3 M3 × 8 from below: 3 mm into the standoff's thread · 0 … 30 standoff ·
30 … 32 top plate · 24 … 32 M3 × 8 from above (`direction: -1`): 6 mm into the
standoff. No nut: the check is the thread depth, which the standoff listing
must give. Torque 0.6 N·m, derated for the aluminium thread from the A2-70
steel-nut table value (0.95 N·m).

## Motor hardware — M3 × 8 up into the motor base (included with the motor)

−5.5 … 2.5: 5 mm plate + 0.5 mm raised pad, then 2.5 mm into the motor base,
whose thread depth (3 mm) the part note records; longer screws reach the
windings. `included_with` the motor, so no separate listing.

## Camera hardware — M2 × 5 into the O4 camera, both side plates

Side plates' outer faces at ±9 (plates ±7 … ±9 around the 14 mm camera),
screws at `atMm: ∓9` with `positions: [[0, -8], [0, 8]]`. A 5 mm screw through
a 2 mm plate leaves 3.0 mm for the camera's thread; DJI's maximum engagement
is 3.10 mm. The part's own note says "2.2 mm into the camera": reconcile the
two before building (washer? thread depth?). A 0.1 mm margin to a maker's
maximum is worth a second look — this is the kind of finding
**harness-verify** exists for.
