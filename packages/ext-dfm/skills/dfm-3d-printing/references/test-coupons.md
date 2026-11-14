# Test coupons and printed slices

A profile value is a starting point. Before a long print depends on a fit, a
pocket or a span that is not proven on the user's printer, prove it with a
coupon (a small test print of one parameter) or a printed slice of the real
part. This file specifies a modular coupon kit and the "print a slice first"
procedure.

**Status:** the kit below is a specification. Its CAD models are not built
yet. Step values marked "proposed" are this playbook's synthesis, not copied
from an existing kit; ranges marked with a source mirror that source. Printing
a coupon is a physical action a person performs or authorizes.

## 1. Kit principles

- **One parameter per coupon** so a result means one thing.
- **Same conditions as the real part:** same printer, nozzle, material, walls,
  infill, layer height and orientation (CNC Kitchen prints its insert tests in
  the final material and walls, https://www.cnckitchen.com/blog/tips-and-tricks-for-heat-set-inserts).
- **Orientation matters:** holes are tested vertical, horizontal and, where it
  matters, at 45 deg, because each sizes differently (CNC Kitchen).
- **Labels say the unit and the type:** "+0.20D" for diametral, "0.10S" for
  per side, embossed on a top face at 5 mm or more (legibility threshold
  UNVERIFIED), with an arrow for the build direction and a small area for
  material and date.
- **Small and fast:** each coupon prints alone in roughly 5 to 15 minutes
  (proposed) or tiles onto one plate.
- **Record the result as a profile value** with status `proven` (or `failed`,
  with what to use instead), the coupon and date in its note, through the
  **dfm** skill's profile layers
  ([profile format](../../dfm/references/profile-format.md)).

## 2. The coupons

Sizes are approximate and proposed unless a source is named. C20 and C21a/b
are proposals added after the follow-up research pass
(`docs/specs/dfm-research/08-skipped-sources-addendum.md`): they test open
questions rather than prove a profile value. Flexure leaves
(`flexure.leaf.min`, `flexure.leaf.root`, practitioner values) are proved
with C14-style beams or a printed slice. C22 to C26 are proposals added with
the production-run guidance ([production runs](production-runs.md);
`docs/specs/dfm-research/10-slant-3d-videos.md`): they prove practitioner
values from one print farm on the user's own printer and filament before a
production run depends on them.

| # | Coupon | Purpose | Size | Steps | Read off | Proves |
| --- | --- | --- | --- | --- | --- | --- |
| C1 | Clearance ladder, vertical holes | Sliding, snug and free fits for holes with axis in Z | 60 x 15 x 5 mm bar, 8 holes for a reference pin (6 mm dowel or M6 screw) | per side 0, 0.05, 0.10, 0.15, 0.20, 0.25, 0.30, 0.40 (diametral 0 to 0.80) (range mirrors the Orca tolerance test and Bambu's M6 method) | the smallest step where the pin slides without force (sliding), goes in by hand without play (snug), spins freely (free) | `clearance.sliding.side`, `clearance.snug.side`, `clearance.free.side` |
| C2 | Clearance ladder, horizontal holes | Same, axis in XY, with and without a teardrop top | same bar printed on its side | same steps | same; compare with C1 | horizontal-hole adjustment; whether a teardrop is needed |
| C3 | Print-in-place gauge | Gap that frees after printing | 40 mm disc with rotating inserts, 60 deg overhangs top and bottom (Maker's Muse gauge) | per side 0.15, 0.20, 0.25, 0.30, 0.40, 0.50 | smallest gap that breaks free with a key and turns | `clearance.printinplace.side`, `clearance.printinplace.z` |
| C4 | Lid and slot fit | Prismatic fit in both axes | 30 x 20 mm box rim plus 4 tongues (proposed) | per side 0.10, 0.15, 0.20, 0.30 (proposed) | the tongue that slides in both axes without rocking; check its bed edge | `clearance.sliding.side` for prismatic fits; `chamfer.bed.edge` on lips |
| C5 | Wall thickness ladder | What the slicer does with thin and in-between walls | stepped fin (proposed) | 0.20, 0.40, 0.45, 0.80, 0.85, 0.90, 1.20, 1.35, 1.60, 1.80 mm (1 to 4 lines of 0.42 to 0.45, plus 0.20 to show the drop) | which walls print, which are widened or gap-filled (slicer preview and print) | `wall.min`, `wall.unit`, `line.width` |
| C6 | Overhang fan | Unsupported overhang limit | quarter arc of fins | 30 to 75 deg from vertical in 5 deg steps (Hydra Research recommends under 50, up to 70) | the steepest fin with no droop on the underside | `overhang.max.angle`, `overhang.cooled.max.angle` |
| C7 | Bridge ladder | Bridge span with acceptable sag | pillars | 5, 10, 15, 20, 30, 40 mm (proposed) | longest span with no visible sag (cosmetic) and with acceptable sag (hidden) | `bridge.conservative.span`, `bridge.max.span` |
| C8 | Text size and depth | Legible text | plate (proposed) | heights 4, 5, 6, 8 mm; raised and engraved 0.2, 0.4, 0.6, 0.8 mm; on a top face and a vertical wall | smallest legible size and depth per face | `text.min.height`, `text.emboss.height`, `text.engrave.depth`, `text.min.stroke` |
| C9 | Heat-set insert ladder | Insert hole for the user's inserts | one block per insert size | nominal -0.1 to +0.4 in 0.1 steps, vertical and horizontal (mirrors CNC Kitchen's 4.0 to 4.4 for M3) | the largest hole with full knurl engagement and no burr below; optionally pull-test | `insert.mN.hole`, `hole.compensation.diametral` |
| C10 | Nut pocket ladder | Drop-in and press-in nut pockets | block with M3 (and M4, M5) hex pockets, flat down | across flats +0.1, +0.2, +0.3, +0.4 diametral | the pocket the nut drops into and stays in; the one it presses into | `nut.pocket.clearance.af` |
| C11 | Magnet pocket ladder | Press and glue pockets for the project's magnets | discs for 6 x 2 and 10 x 3 mm (or the actual magnets) | +0.05, +0.10, +0.15, +0.20, +0.30 diametral; depth +0.1 and +0.4 (mirrors DraftID and totalElement) | the press pocket that holds while printed over (with a pause); the glue pocket that seats freely | `magnet.pocket.press.diametral`, `magnet.pocket.glue.diametral`, `magnet.pocket.depth.enclosed` |
| C12 | Self-tap pilot ladder | Pilot for screws straight into plastic | bosses for M2, M2.5, M3, M4 | 80, 85, 90, 96 percent of major diameter (Hydra Research, EJOT ranges) | the hole the screw drives into without splitting and holds at the intended torque | `screw.selftap.m3.pilot` and other sizes |
| C13 | Bottom edge: chamfer vs fillet | Elephant's foot and bed-edge finish | 4 small blocks (mirrors Slant 3D chamfer advice) | chamfer 0.4, 0.8, 1.2 mm at 45 deg vs a 1 mm fillet | the smallest chamfer with no visible lip; the fillet's droop | `chamfer.bed.edge` |
| C14 | Snap-fit coupon | Beam that snaps without cracking or setting | cantilever and catch (Hubs, BASF basis) | beam thickness 1.0, 1.2, 1.5 mm at fixed length and undercut; built in XY and in Z | which thickness snaps 10 times without whitening or cracking; XY vs Z difference | `snapfit.strain.*` in `profiles/materials-fdm.json` |
| C15 | Thread coupon | Modeled threads | M5, M6, M8, M10 bolts and nuts, vertical and horizontal | radial clearance 0.1, 0.2, 0.3 (CNC Kitchen, Hydra Research basis) | the smallest size and clearance that runs by hand | `thread.min.modeled` |
| C16 | Living hinge strip | Hinge thickness for the chosen material | strips | 0.3, 0.4, 0.5, 0.6 mm (Hubs, printstack ranges) | thinnest strip that survives the needed folds | living-hinge thickness in [hardware](hardware.md) |
| C17 | Elephant's foot cube | First-layer spread | 20 mm cube | measure bottom vs top width mid-side per Bambu's formula | elephant's foot per side | slicer compensation; `chamfer.bed.edge` |
| C18 | Sacrificial bridge counterbore | Hole starting in mid-air | block with a counterbore from below (proposed) | one-layer and two-layer sacrificial steps vs a plain circle over air | clean hole edge, removal effort | `bridge.sacrificial.first`, `bridge.sacrificial.second` |
| C19 | Pause-and-embed | Pause layer choice and cavity depth | block with a closed cavity for the actual item (proposed) | depth +0.2, +0.4, +0.5 mm; pause on the computed layer and one earlier | cavity still open at the pause; item flush and held; no nozzle strike | `magnet.pocket.depth.enclosed`, pause layer in the print assumptions |
| C20 | Thread axis strength (**proposal**) | Settle whether a modeled thread is weaker with its axis vertical (Z) or horizontal (XY): one source's test may contradict "never in horizontal holes" ([hardware](hardware.md) section 10) | one block per size with a modeled internal thread printed with its axis in Z and an identical block with the axis in XY; same profile, walls and infill (proposed) | M5, M6, M8; steel screw of grade 8.8 | whether the thread runs by hand without chasing; torque to failure with a torque wrench, three samples per orientation; failure mode (thread strip vs boss split) | `thread.min.modeled` and the horizontal-hole rule; the rule stands until this is printed |
| C21a | Stiffened panel, equal depth (**proposal**) | Whether an isogrid panel beats a closed two-skin printed wall of the same overall depth | two flat panels of equal footprint and total depth: an isogrid (skin plus ribs at house rib width) and a closed wall with top and bottom skins over sparse infill, both at house walls and infill (proposed) | one pair; weigh both | three-point bend: stiffness from load vs deflection and the failure load, each divided by measured mass | whether a patterned or ribbed wall may be counted as structural; reasoning in `docs/specs/dfm-research/09-isogrid-fdm-recheck.md` |
| C21b | Stiffened panel, equal mass (**proposal**) | The same comparison at equal mass | as C21a, with the closed wall thinned (or the isogrid deepened) until both weigh the same, checked on a scale (proposed) | one pair | three-point bend as C21a | as C21a |
| C22 | Designed-support gap ladder (**proposal**) | Gap and tine size for supports modeled in CAD | a 20 mm block with a 10 mm flat overhang held by a designed fin, one per step, plus a fin tied by tines (proposed) | gap 0.10, 0.15, 0.20, 0.25, 0.30 mm; tines 0.5 x 0.5 and 0.5 x 1.0 mm; one thumbtack and one pointed tower | the smallest gap that releases cleanly by hand with an acceptable underside; the tine that holds through the print and snaps flush | `support.designed.gap`, `support.designed.tine.height`, `support.designed.tine.width`, `support.designed.sprue.diameter`, `support.designed.point` |
| C23 | CAD raft gap ladder by filament finish (**proposal**) | Raft gap that holds during the print and releases after | 1 mm thick round raft under a 20 mm disc, one per step, in each filament finish used (glossy PLA, matte PLA, PETG) (proposed) | gap 0.10, 0.15, 0.20, 0.25, 0.30 mm | the gap that holds the part flat through the print and pops off without tools, per finish | `production.raft.gap`, `production.raft.gap.matte`, `production.raft.thickness` |
| C24 | Grip-fin interference ladder (**proposal**) | Interference a grip-fin hole can take on the real shaft | block with grip-fin holes for the actual shaft (or a 12 mm rod), fins cut free along their length, 0.3 mm undercut gap (proposed) | interference per side 0.1, 0.2, 0.3, 0.4, 0.5 mm (0.2 to 1.0 diametral); two fin thicknesses | insertion force by hand, hold (pull-out against a stated force), fin cracking or whitening after 10 insertions | `fitfeature.gripfin.interference.side.example`, `fitfeature.compliant.gap.min`, `.max` |
| C25 | Ejection base variants (**proposal**) | Bed contact shaped for release in a production run | the same 60 mm disc or the real part with a flat base, a one-layer recess, a deeper pocket with a 45 deg cone roof, and conical recesses leaving rings 1, 2 and 3 mm wide (proposed) | five variants, same printer, plate and filament | adhesion through the print (no lift, no shift), release force after cooling, warp measured with a feeler under the edge, first-layer cosmetics | `production.base.recess.depth`, `production.contact.ring.min` |
| C26 | Side-wall text depth ladder (**proposal**) | Legible text on a vertical face without sag | a vertical plate with the same word at each step, printed standing (proposed) | raised and engraved 0.25, 0.50, 0.75, 1.00 mm; heights 3, 4, 5 mm; bold sans-serif | the deepest raised text with no sag at the letter bottoms, the engraving depth with clean floors, the smallest legible height | `text.sidewall.emboss.max`, `text.sidewall.engrave.max`, `text.min.height` |

Existing tests worth reusing instead of new CAD where they fit: the Maker's
Muse tolerance gauge (gaps 0.15 to 0.5,
https://www.youtube.com/watch?v=TYuLVN3YHw8), the Orca tolerance test (hex
holes 0 to 0.4, https://www.orcaslicer.com/wiki/calibration/tolerance_calib,
per side not stated), Bambu's XY hole calibration with an M6 screw
(https://wiki.bambulab.com/en/software/bambu-studio/xy-hole-contour-compensation),
CNC Kitchen's insert hole blocks, and the Orca calibration suite, which
calibrates the printer itself in this order: temperature, max volumetric speed,
pressure advance, flow, retraction, then tolerance last
(https://www.orcaslicer.com/wiki/guides/calibration_guide). Printer
calibration belongs to the person who runs the printer; the coupons above test
the design values.

## 3. Print a slice first

A slice is the critical interface of the real part, cut out and printed alone.
Markforged's "unit test" is the source practice: isolate the critical feature
as its own body, make variations, print and test, then update the full model,
keeping the test under about six hours
(https://markforged.com/resources/learn/design-for-additive-manufacturing-plastics-composites/3d-printing-strategies-for-composites/composites-3d-printing-design-tips,
VENDOR). Sovol and BigRep give the same advice (SNIPPET). Bambu Studio's cut
tool can make the slice from the full model.

How to choose the slice (synthesized; UNVERIFIED as a sourced procedure beyond
Markforged's steps):

1. List every interface that mates with something else: bores, lids, snaps,
   insert bosses, magnet pockets, rails, split joints.
2. Cut a section that holds the full mating perimeter but little height: a
   ring 2 to 5 mm tall for a round lid or bore; a 5 to 10 mm segment for a rail
   or dovetail; a boss plus 3 mm of surrounding wall for an insert.
3. Keep the slice at the same Z position class as in the real part. If the fit
   is at the first layers, the slice starts on the bed (elephant's foot is part
   of the test). If the fit is mid-part, raise it on a short sacrificial base so
   first-layer squish does not affect it.
4. Keep orientation, profile, filament, walls and infill identical to the
   final print.
5. Test with the real hardware: the actual bearing, magnet, insert or mating
   part.
6. Adjust the model per side, state the one-line clearance rule again, and
   reprint the slice if the change exceeds 0.1 mm.

When a slice is enough and a coupon is not needed: the part uses only proven
profile values and the slice exercises every unproven interface at once.

## 4. When a value must be proven first

Prove with a coupon or slice before the full print when any of these holds:

- the fit is a press, a print-in-place joint, a snap fit or a living hinge;
- a magnet or other item is embedded with a pause;
- the material, nozzle or printer differs from the one the profile value was
  proven on;
- the value is tagged UNVERIFIED, SNIPPET or `assumption`, or its status is
  `unverified` or `assumption` (a `house` or `typical` value not yet `proven`
  on this printer counts when the fit is critical);
- the full print is long (more than a few hours) or uses expensive material;
- the design pushes past a `typical` limit (overhang over 45 deg, bridge over
  10 mm, wall under 2 lines);
- the part depends on a designed support, a CAD brim or raft, or a reduced
  bed contact (C22, C23, C25), on a printer or filament they were not proven
  on;
- a tight fit is printed in another color: pigment changes flow and
  expansion, so prove the fit per color
  (https://www.youtube.com/watch?v=PbGnxQifEq0).
