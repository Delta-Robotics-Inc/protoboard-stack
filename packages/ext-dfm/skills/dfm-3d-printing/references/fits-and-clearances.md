# Fits and clearances

The most common fit mistake in printed parts is applying a clearance to one
side when it was meant for both, or to both when it was meant for one, so the
real gap ends up twice or half what was intended. This file makes every
clearance explicit **per side** and **diametral**, works the common cases, and
lists what else moves a fit: hole shrink, slicer compensation, elephant's foot,
material and stack-up.

Tags as in [FDM rules](fdm-rules.md). Profile paths are in `profiles/fdm.json`.

## 1. Definitions

- **Per side (radial):** the gap between one wall and its mate.
- **Diametral (total):** hole diameter minus shaft diameter, or slot width
  minus tongue width. **Diametral = 2 x per side**, for a round feature and for
  each axis of a rectangular one.
- **CAD clearance:** the gap drawn in the model, with slicer XY hole and contour
  compensation at 0. Every value in this file is a CAD clearance unless it says
  otherwise. The fit tables already absorb the typical hole shrink of a tuned
  printer: do not add `hole.compensation.diametral` on top of a fit clearance.

### The one-line rule

Whenever the agent applies a clearance, it states one line in this form, in
the design notes and in its reply:

> Clearance (sliding): 0.20 mm per side = 0.40 mm diametral. Hole for the
> 8.00 mm shaft modeled at 8.00 + 0.40 = 8.40 mm. Slicer XY hole compensation
> assumed 0.

Fit name, per-side value, diametral value, the arithmetic on the actual
dimension, and the slicer assumption. If any of the four is missing, the
clearance has not been applied yet.

## 2. Clearance table

House values for a tuned printer with a 0.4 mm nozzle, PLA. Add the material
adjustment (section 6) for other materials. Use the unknown-printer column when
the printer is unknown, untuned, or a print service.

| Fit | Per side (house) | Diametral (house) | Per side, unknown printer | Profile path | Use | Sourced range and tag |
| --- | --- | --- | --- | --- | --- | --- |
| Press (permanent) | 0.05 | 0.10 | test first | `clearance.press.side` | dowels, bearings, magnets, press nuts | 0 to 0.05 CAD, printing as about 0.05 to 0.10 interference per side (VENDOR: Sovol; totalElement magnets 0.1 to 0.15 diametral; meshra interference SNIPPET) |
| Snug, location | 0.10 | 0.20 | 0.15 | `clearance.snug.side` | locating pins, lids that must not rattle | 0.1 per side "with some force" (StackExchange, SNIPPET); 0.2 difference (Prusa forum, diametral, SNIPPET) |
| Sliding | **0.20** | **0.40** | **0.30** | `clearance.sliding.side`, `clearance.unknown.printer.side` | drawers, rails, removable lids, slow pivots | **House** 0.20 (the house standard). Sourced 0.15 to 0.25 per side (Sovol, VENDOR); 0.2 per side "without force" (StackExchange, SNIPPET); at least 0.3 per side (Prusa, Simple Machining, VENDOR); Unionfab writes only plus or minus 0.3 mm and does not say per side or diametral; Xometry 0.2 to 0.3, not stated either |
| Free running | 0.30 | 0.60 | 0.40 | `clearance.free.side` | spinning shafts, loose assemblies | 0.5 to 0.8 diametral (GrandpaCAD, SNIPPET); 0.4+ (cc3dlabs, SNIPPET) |
| Print in place | 0.35 XY; Z gap 2 layers | 0.70 | 0.45 | `clearance.printinplace.side`, `clearance.printinplace.z` | hinges, chains, gears printed assembled | 0.2 frees on a tuned printer, 0.3 on an average one, 0.4 to 0.5 on a poor one (MEASURED, Maker's Muse); 0.25 per side hinge (Sovol, SNIPPET); the 2-layer Z gap is UNVERIFIED. Service-bureau alternative: Xometry Europe 0.5 for moving parts, not stated per side or diametral (reading it as per side is UNVERIFIED) |
| Snap-fit body | 0.30 | 0.60 | 0.40 | `clearance.snapfit.side` | clearance around a snap body (not the undercut) | Hubs 0.5, Fictiv 0.3 close; neither says per side or total (UNVERIFIED normalization) |
| Mating face printed on support | add 0.07 | add 0.14 | add 0.07 | `clearance.support.face.extra.side` | any fit face that rests on support; added to the fit above | Markforged raises 0.08 to about 0.15 per side on such faces (VENDOR, Mark Two, https://markforged.com/resources/blog/joinery-onyx) |

Sources: https://www.sovol3d.com/blogs/news/fdm-3d-printing-tolerances-clearances-how-to-design-parts-that-fit,
https://3dprinting.stackexchange.com/questions/6576,
https://help.prusa3d.com/article/modeling-with-3d-printing-in-mind_164135,
https://simplemachining.com/blogs/dfm-for-3d-printing-a-practical-design-guide,
https://www.unionfab.com/blog/2026/03/design-for-manufacturing-3d-printing,
https://grandpacad.com/en/tools/tolerance-fit-calculator,
https://www.youtube.com/watch?v=TYuLVN3YHw8,
https://www.hubs.com/knowledge-base/how-design-snap-fit-joints-3d-printing/,
https://totalelement.com/blogs/magnet-projects/how-to-embed-magnets-in-3d-prints.
The unknown-printer column adds 0.05 to 0.1 per side to the house values
(DERIVED from the spread of the sources; the sliding 0.30 is sourced).
Unionfab's checklist also gives a mating-gap range of 0.2 to 0.5 mm without
saying per side or diametral (VENDOR).

How the house sliding fit behaves (`docs/specs/dfm-research/04-hardware-fits-calibration.md`,
B4): between two printed surfaces,
0.2 per side frees with a little force on a well-tuned machine (Maker's Muse's
tuned printer freed 0.2 and partly welded 0.15 where seams start). Around a
metal pin, 0.4 mm diametral fits "edge to edge without force"; after a printed
hole shrinks 0.1 to 0.25 on diameter, the real gap is about 0.08 to 0.15 per
side, a slip-to-sliding fit (DERIVED from CNC Kitchen's shrink data).

### 2.1 Comparison: Markforged's fit table (not adopted)

Markforged states that its listed fit dimensions are **diametral**. Converted
to per side for comparison with the house table (VENDOR,
https://markforged.com/resources/learn/design-for-additive-manufacturing-plastics-composites/3d-printing-strategies-for-composites/composites-3d-printing-design-tips):

| Markforged fit | Diametral (as published) | Per side (converted) | Nearest house fit, per side |
| --- | --- | --- | --- |
| Press | 0.00 to 0.05 | 0 to 0.025 | press 0.05 |
| Close | 0.05 to 0.10 | 0.025 to 0.05 | snug 0.10 |
| Free | 0.10 to 0.20 | 0.05 to 0.10 | free 0.30 |
| Sliding joinery (dovetails, sliders, Onyx on a Mark Two; https://markforged.com/resources/blog/joinery-onyx, published per side) | 0.16 | 0.08 | sliding 0.20 |

Markforged's values are 2 to 4 times tighter than the house values because
they describe calibrated industrial composite printers, and Markforged itself
calls them a starting point to verify with a unit test. **The house values
stay as they are** (press 0.05, snug 0.10, sliding 0.20, free 0.30, print in
place 0.35 per side; 0.30 per side for an unknown printer). What is adopted
from Markforged is the support-face allowance in the table above: a mating
face printed on support gets about 0.07 mm more per side (0.14 diametral).

## 3. The doubling error, worked

Sources that show the ambiguity: Bambu's wiki says XY hole compensation grows
the hole diameter by twice the entered value
(https://wiki.bambulab.com/en/software/bambu-studio/xy-hole-contour-compensation);
a StackExchange answer sizes a 3 mm pin hole as 3 + 0.1 x 2 = 3.2; a Sovol
table labels the same print-in-place value both "total" and "per side, not
total". Even published guides contradict themselves, so normalize every number
read to per side and diametral before using it.

### Example 1: shaft in a hole (sliding, house)

8.00 mm steel shaft, sliding fit, 0.20 per side.

- Correct: diametral 0.40, hole **8.40 mm**.
- Error A, 0.20 read as diametral: hole 8.20, only 0.10 per side, a snug fit;
  on a printer whose holes print 0.15 to 0.25 small it becomes a press or does
  not go in.
- Error B, 0.20 per side modeled and slicer hole compensation 0.20 also set:
  the slicer adds 0.40 to the diameter, hole prints about 8.80, 0.40 per side,
  sloppy.
- If the slicer XY hole compensation must stay at c (per side), model the hole
  at 8.40 - 2c.

Stated line: "Clearance (sliding): 0.20 mm per side = 0.40 mm diametral. Hole
for the 8.00 mm shaft modeled at 8.40 mm. Slicer XY hole compensation assumed
0."

### Example 2: lid on a box, both axes

A lid lip that drops inside a box opening of 60.00 x 40.00 mm, sliding fit.

- Each axis has two walls, so each axis loses 2 x 0.20 = 0.40.
- Lip outside: (60.00 - 0.40) x (40.00 - 0.40) = **59.60 x 39.60 mm**.
- Error: subtracting 0.20 per axis gives 59.80 x 39.80, only 0.10 per side, a
  tight fit; then elephant's foot on the lip's first layers (0.1 to 0.2 per
  side) jams it.
- Fix the elephant's foot too: a 0.5 mm x 45 deg chamfer on the lip's bed edge,
  or print the lid so the lip points up and is not on the bed.

The same lid fitting **over** the box (skirt outside): box outside 64.00 x
44.00 mm, skirt inside (64.00 + 0.40) x (44.00 + 0.40) = **64.40 x 44.40 mm**.
Height (Z) needs no fit clearance for a lid that seats on a face; it does need
one where a lid slides in a groove (one side above, one below: same per-side
rule, using Z accuracy, which is about one layer).

Stated line: "Clearance (sliding): 0.20 mm per side = 0.40 mm diametral, per
axis. Lip modeled at 59.60 x 39.60 mm for a 60.00 x 40.00 mm opening. Slicer
XY contour compensation assumed 0. Lip bed edge chamfered 0.5 mm."

### Example 3: pocket for a magnet

6.00 x 2.00 mm disc magnet.

- Press fit (the nozzle will print over it after a pause): 0.15 diametral
  (`magnet.pocket.press.diametral`), 0.075 per side: pocket **6.15 mm**. Depth
  for an enclosed pocket: 2.00 + 0.40 = **2.40 mm**, then two solid layers
  (0.40 mm) over it.
- Glue fit (inserted after printing, open pocket): 0.25 diametral
  (`magnet.pocket.glue.diametral`): pocket 6.25; depth 2.00 + 0.15 = 2.15.
- Error: reading "+0.2" as per side gives 6.40, loose; a test found the nozzle
  pulls a magnet out of a 6.3 mm pocket
  (https://draftid.com.au/how-to-embed-magnets-in-3d-prints/, MEASURED). The
  same test found 6.2 was the firm press on that printer, because its holes
  print small: prove the value with the magnet ladder coupon.

Stated line: "Clearance (press): 0.075 mm per side = 0.15 mm diametral. Magnet
pocket modeled at 6.15 mm for a 6.00 mm magnet, 2.40 mm deep, 0.40 mm cover.
Slicer XY hole compensation assumed 0."

### Example 4: heat-set insert hole

M3 x 5.7 insert. The datasheet's 4.0 mm is the **finished** hole and is already
diametral. The printed hole adds the print compensation, 0.2 diametral (0.1
per side): CAD **4.2 mm** (`insert.m3.hole`), depth 5.7 + 1 = 6.7 mm.

- Error: adding "0.2 per side" gives 4.4; CNC Kitchen's pull-out fell sharply
  once the finished hole passed about 4.1 to 4.2 mm (MEASURED,
  https://www.cnckitchen.com/blog/are-our-heat-set-insert-datasheets-wrong).

Stated line: "Insert hole: datasheet 4.0 mm finished + 0.2 mm diametral print
compensation (0.1 per side) = 4.2 mm, 6.7 mm deep. Slicer XY hole compensation
assumed 0."

## 4. Hole undersize, compensation and orientation

- **Printed holes come out small:** 0.1 mm small on a Prusa MK2.5 and about
  0.25 mm small on a CORE One L, on diameter (MEASURED, CNC Kitchen). Causes:
  facet chords inside the true circle, arc shrink and corner cutting, the
  nozzle squashing beads into the hole, material shrink, wet filament, seams
  (https://hydraraptor.blogspot.com/2011/02/polyholes.html,
  https://wiki.bambulab.com/en/software/bambu-studio/xy-hole-contour-compensation).
- **A hole that must finish at a stated size** (insert, screw clearance,
  machined-dowel location): model it at the stated size plus
  `hole.compensation.diametral` (0.2). For anything critical, model 0.2 to 0.3
  undersize and drill or ream. Alternative for an unknown printer or small
  holes: 0.4 diametral (0.2 per side; Teaching Tech, PRACTITIONER,
  https://www.youtube.com/watch?v=yP7_qZ_Mi78; Simple Machining +0.2 to 0.4
  under 5 mm, VENDOR). Use one method only: a model offset, a drill or slicer
  compensation, never two. Unionfab says holes print undersize in every
  process and suggests adding 0.1 to 0.2 or reaming, without saying per side
  or diametral (VENDOR).
- **Slicer hole compensation is per side.** Bambu Studio's "X-Y hole
  compensation" grows the diameter by twice the entered value, works only on
  closed loops, and on layers where the hole is open to the side it causes
  visible layer separation. "X-Y contour compensation" changes outer contours,
  also per side. "Auto circle holes-contour compensation" applies only to full
  circles under 50 mm on some Bambu filaments (VENDOR, Bambu wiki). A Bambu
  user reported that entering 0.25 to fix holes 0.25 small made them 0.25 too
  big: the doubling (SNIPPET, https://www.reddit.com/r/BambuLab/comments/1mg6pvj/xy_hole_compensation_madness/).
- **Policy:** put the clearance in the model and leave slicer compensation at
  0 for anything shared or published. For in-house parts on a calibrated
  printer either is fine, but record which one was used in the print
  assumptions; never both without the arithmetic.
- **Vertical holes** (axis along Z): round but small. Export with fine
  tessellation (32+ facets).
- **Horizontal holes** (axis in XY): the top sags flat and tight, the bottom
  stair-steps. Fixes: teardrop or pointed roof (the point adds clearance at
  the top only), a hexagonal hole, flats cut top and bottom, printing at 45
  deg, relief slots (Slant 3D, https://www.youtube.com/watch?v=ip70-Tw6tBE).
  CNC Kitchen saw horizontal insert holes come out smaller at the top. A
  horizontal hole that must fit a shaft gets the fit clearance on the sides
  and a teardrop on top, or is drilled.

## 5. Elephant's foot on mating faces

The first one to three layers print wider than drawn because they are squashed
and kept soft by the bed (https://wiki.bambulab.com/en/software/bambu-studio/parameter/elephant-foot).
It spoils fits on snaps, rails, lids and shaft holes near the bed.

- Any mating face that touches the bed gets a 45 deg chamfer on its bed edge
  (`chamfer.bed.edge`, 0.5 mm house, 1 mm unknown printer), on outer contours
  and on holes that open onto the bed.
- Or orient the part so the mating feature is not on the bed.
- Slicer elephant's foot compensation (about 0.2 mm for a 0.4 mm nozzle,
  https://help.prusa3d.com/article/elephant-foot-compensation_114487) is a
  second line of defense; Bambu measures it as the average of (bottom minus
  top) widths in X and Y, measured mid-side.

## 6. Material adjustment

Add per side to every fit clearance (VENDOR, Sovol; `clearance.adjust.side` in
`profiles/materials-fdm.json`):

| Material | Sliding per side | Add per side to the house PLA values |
| --- | --- | --- |
| PLA | 0.15 to 0.25 | 0 |
| PETG | 0.20 to 0.30 | +0.05 |
| ASA, ABS | 0.25 to 0.35 | +0.1 (source gives +0.05 to +0.1; larger used) |
| Others (TPU, nylon, PC, PP) | no source | prove with a coupon |

PETG oozes, so its holes print slightly small. Nylon changes size with
moisture: size holes after conditioning, or ream.

## 7. Tolerance stack-up

- **Worst case:** a 5 mm pin at plus or minus 0.2 in a hole at plus or minus
  0.2 with a minimum 0.2 diametral clearance needs a 5.6 mm nominal hole
  (5 + 0.2 + 0.2 + 0.2); the largest clearance is then 5.8 - 4.8 = 1.0 mm
  diametral, which is sloppy (StackExchange, SNIPPET). Each printed interface
  adds roughly plus or minus 0.1 to 0.2 mm in XY.
- Design with worst case. Statistical (root sum of squares) stacking is
  standard engineering only with four or more independent parts (UNVERIFIED for
  FDM specifically).
- Do not chase tighter nominal gaps; add adjustment instead: slots, shims,
  compliant fins, crush ribs, tapers.
- Printing both mating parts on one printer does not cancel the error: a printed
  boss grows and a printed hole shrinks with the same over-extrusion, so the
  errors add (Maker's Muse explains why a gap is needed; the "errors add"
  statement is DERIVED, not measured).
- Position drifts more than size on large parts: small features stay accurate
  but their location on a large part moves with thermal effects and warping
  (Protolabs, SNIPPET).

## 8. Achievable accuracy

| Situation | Accuracy | Source |
| --- | --- | --- |
| Known, calibrated printer | plus or minus 0.2 mm (`accuracy.tuned`) | Prusa (VENDOR) |
| Well-calibrated FDM generally | about plus or minus 0.2 XY, 0.1 to 0.2 Z | GrandpaCAD (SNIPPET) |
| Unknown or budget printer | plus or minus 0.3 to 0.5 mm, or 0.5 percent (`accuracy.unknown`) | Protolabs prototyping FDM plus or minus 0.5 percent with a 0.5 mm floor (VENDOR, https://www.protolabs.com/services/3d-printing/fused-deposition-modeling/); Xometry Europe 0.5 percent (VENDOR); Hubs, cc3dlabs (SNIPPET) |
| Industrial FDM service | plus or minus 0.3 percent, 0.3 mm floor | Protolabs (VENDOR, same page) |
| Long parts, desktop standard | plus or minus 0.2 mm (one layer) for the first inch, plus 0.05 mm per further inch | Xometry (VENDOR, https://www.xometry.com/manufacturing-standards/) |
| Bambu X2D, H2D motion accuracy | 50 micron | Bambu product pages (VENDOR); motion, not part accuracy |

Anything tighter than plus or minus 0.2 mm needs drilling, reaming or
machining after printing, or another process.

## 9. Sliding joints, dovetails, split connectors

- Dovetails: offset the cutout 0.2 mm for small parts, 0.4 mm for larger ones
  (Formlabs, SNIPPET, per side or total not stated:
  https://formlabs.com/blog/how-to-3d-print-interlocking-joints/).
  Markforged's dovetail offset ladder on one Mark Two found -0.05 mm per face
  snug and sliding, 0.00 too tight and -0.20 too loose (MEASURED, an example
  of the unit-test method; print the test in the final orientation:
  https://markforged.com/resources/blog/3d-printed-unit-tests).
- Prefer angled (V or dovetail) slots to T-slots and tongue-and-groove: the
  first layer stays simple and the bottom face has no overhang (PRACTITIONER,
  https://www.youtube.com/watch?v=vsHpiHhB3RU; VENDOR, Markforged joinery
  page). For horizontal pegs, a diamond peg in a diamond hole (a square turned
  45 deg) has no flat roof and the peg prints lying down (PRACTITIONER, same
  video).
- Compliant fit features (grip fins, flexing walls): the single undercut slot
  behind the feature is 0.3 mm minimum and 0.5 mm maximum
  (`fitfeature.compliant.gap.min`, `.max`; PRACTITIONER, Slant 3D,
  https://www.youtube.com/watch?v=XKrDUnZCmQQ). Under 0.3 some CAD or STL
  tools close it; over 0.5 the feature deforms. A slot width, not a fit
  clearance.
- Lids and bases (PRACTITIONER, same Slant 3D video): round every vertical
  corner of both mating parts, give the lip a slight taper or draft, make the
  lip a thin wall rather than solid, add relief pockets in the base's inside
  corners, and if the corners are split, cut the slits at 90 deg to each other
  with no more than about 0.5 mm splay. Flat sides print true; corners and
  infill-dependent shrink do not.
- Glue joints: small undercut pockets plus relief channels let the glue key in
  without jacking the parts apart (PRACTITIONER,
  https://www.youtube.com/watch?v=vsHpiHhB3RU).
- Fitting an odd-shaped object: print a 1 mm thick 2D template of the
  footprint first, under 10 minutes and about 2 g (PRACTITIONER,
  https://www.youtube.com/watch?v=noYuQlQN8pw). Loose drop-in trays and
  holders take about 1 mm per side (PRACTITIONER,
  https://www.youtube.com/watch?v=yP7_qZ_Mi78).
- Bambu Studio cut connectors (plug, dowel, snap): set the cut tolerance 0.15
  to 0.3 mm if they do not fit; Bambu does not say per side or total
  (https://wiki.bambulab.com/en/bambu-studio/manual/3d-print-large-files).
- Long sliding fits bind from Z misalignment; give long joints extra clearance
  (StackExchange, SNIPPET).
- D-shafts: give the flat the same per-side clearance as the round part and
  orient the hole vertical so the flat is an accurate wall (UNVERIFIED, no
  dedicated source). A socket that must take shafts of varying size can be two
  halves pressed together by internal leaf springs (PRACTITIONER,
  https://www.youtube.com/watch?v=qXHjM_L3vi0).
- Lids, more from the production source (PRACTITIONER): a solid lip shrank
  more and fit looser than a thin-walled lip of the same CAD size, so a thin
  lip holds its size (https://www.youtube.com/watch?v=XKrDUnZCmQQ); cut the
  lip's contact down with holes or a few nubs so layer lines do not interlock
  (https://www.youtube.com/watch?v=IZKh6lo9SP4); a press-on or plug lid gets
  a lead-in chamfer and a slight taper so it starts easily and tightens, and
  internal ripples to cut contact (https://www.youtube.com/watch?v=7YAylxQFe3k).
  Bayonet and threaded lids: [hardware](hardware.md) sections 10 and 13.
- Horizontal pins (PRACTITIONER, https://www.youtube.com/watch?v=Iyxp_Rjz3wo):
  a "keyhole" pin chamfered top and bottom prints without support and takes
  its fit on the side walls, which lie in the accurate XY plane; better, a
  chamfered rectangular tab in a slot, tapered so it tightens as it goes in;
  two offset tabs self-center; a split tab (two prongs) fits any machine.
- Other joints from the same source (PRACTITIONER): a sprung T-slot whose
  flanges act as springs, entered at an angle so the first layer is a plain
  square; a round tongue in a round slot (one dimension to control); two
  flexing tongues with bumps that click into grooves inside the hole
  (https://www.youtube.com/watch?v=RTQjvYENR7w); for broad flat faces a
  separate printed S-clip slid into symmetric slots sets the clamping force by
  its size (https://www.youtube.com/watch?v=djm5tCFn9S0). No dimensions are
  given; prove with a slice.
- A loose housing for a bought box: about 1 mm per side, with tall walls to
  keep the slop low (PRACTITIONER, https://www.youtube.com/watch?v=Wd0MR4sPcK0),
  the same as the drop-in tray value above. On a first design leave more room
  rather than less; adding material later is easier.

## 10. Grip fins in detail

Grip fins are thin compliant fins around a hole or on a tongue that flex to
take up size error, where a plain friction fit would depend on expansion,
machine tuning, flow and room temperature. Two printed parts in a friction
fit also interlock their layer lines and stick or wear. All PRACTITIONER
(one production print farm):

| Rule | Value or condition | Source |
| --- | --- | --- |
| Fins flex in the layer plane | so they flex within layers and last until the material fatigues | https://www.youtube.com/watch?v=yzg_NXM-NRs |
| Cut each fin free along its whole length, including at the back of the hole (a disc cut under the fin roots does this) | fins still joined at the top stiffen with depth and bind | https://www.youtube.com/watch?v=yzg_NXM-NRs, https://www.youtube.com/watch?v=6gPPAiqSkBc |
| Undercut gap behind or under the fins | 0.3 mm minimum, 0.5 maximum (`fitfeature.compliant.gap.min`, `.max`); one video uses 0.2 above and below side-hole fins, not adopted, because under 0.3 some CAD or mesh tools close the gap | https://www.youtube.com/watch?v=XKrDUnZCmQQ, https://www.youtube.com/watch?v=IZKh6lo9SP4, https://www.youtube.com/watch?v=ip70-Tw6tBE |
| Chamfer the start of each fin where the hole opens onto the bed, so the fin begins above the first layer | thin fin footprints on the first layer delaminate or warp; the chamfers also form a funnel lead-in | https://www.youtube.com/watch?v=yzg_NXM-NRs |
| Fins higher in a part get a trapezoid (chamfered) profile | they self-support | https://www.youtube.com/watch?v=yzg_NXM-NRs |
| Tuning | thinner or longer is softer; longer adds slop and lets the inserted part cock; thinner raises fatigue risk, so not for high-cycle insertion; fewer fins are stiffer | https://www.youtube.com/watch?v=yzg_NXM-NRs, https://www.youtube.com/watch?v=3BIvSiuQVWQ |
| What they absorb | about 0.1 to 0.2 mm of size error; they also suit heat-set inserts | https://www.youtube.com/watch?v=3BIvSiuQVWQ |
| Material | PETG and ABS preferred; PLA works but flexes less and is more brittle (another video of the same channel says PLA flexes enough) | https://www.youtube.com/watch?v=yzg_NXM-NRs, https://www.youtube.com/watch?v=GRlX27WgySQ |
| Interference | one example only: a 12 mm rod in fins with an 11 mm inner diameter, 0.5 mm per side = 1.0 mm diametral (`fitfeature.gripfin.interference.side.example`, status unverified). Large: prove with coupon C24 before using anything near it | https://www.youtube.com/watch?v=Bd7Yyn61XWQ |
| Around a bought molded part | the bought part's size varied by molder and fill level, so a fit verified in house failed at the customer; fins sized to a stated pull-out force (1 to 2 lb, about 4.5 to 9 N, in that case) replaced the bored hole | https://www.youtube.com/watch?v=PbGnxQifEq0 |
| Creep | small, because each fin deflects little (OPINION) | https://www.youtube.com/watch?v=XKrDUnZCmQQ |

Stated line for a grip-fin joint: "Grip fins: fin inner diameter <d> mm on a
<D> mm shaft, interference <(D - d) / 2> mm per side = <D - d> mm diametral;
undercut gap 0.3 mm; proven with C24: <yes or no>."

## 11. Locating features: fins in slots, cones, and at most two

From one production print farm (PRACTITIONER,
https://www.youtube.com/watch?v=xog9YlMt9UU), consistent with FDM-ORI-7 (pins
standing in Z are weakest at the base):

- Avoid printed cylindrical locating pins: upright they break along layer
  lines and lose precision, flipped they need support, and their holes must be
  enlarged.
- Prefer fins on one part that drop into slots in the other. A fin is
  supported along its length, so even printed upright it is stronger than a
  round pin; a cross-shaped fin locates in two directions; chamfer the fin
  ends so they are lead-ins and print upright without an overhang. The
  assembler finds a slot, not a hole. The example used 7 mm deep fins on a
  40 mm block with 5 mm margins. The slot clearance was not stated: take it
  from the clearance table (snug or sliding, per side and diametral, with the
  one-line rule).
- For a pure locator with no press or friction duty, turn the pin into a cone
  (a fully chamfered pin): it prints in any orientation and costs nothing,
  because the inside is infill. The source keeps the cone "within 30 degrees"
  without saying from which axis. Printed point up, a cone never overhangs;
  printed hanging point down, keep its flanks within 45 deg of vertical
  (FDM-OVH-1).
- Use the fewest locating features that constrain the part: a lid located in
  two directions needs two features, not four; one fin can be enough. Other
  videos of the same source apply the same rule to screws: one screw where
  the mating part supplies the other constraints
  (https://www.youtube.com/watch?v=Wd0MR4sPcK0,
  https://www.youtube.com/watch?v=YMk7EfbemGY).

## 12. Parts printed side by side or together

- Two halves of an enclosure printed standing up "about 0.1 mm apart" so they
  support each other was proposed as an idea by the production source
  (https://www.youtube.com/watch?v=31FVZIg4rDs), not shown. **Not adopted:**
  at 0.1 mm the halves fuse. Two separate parts on one plate keep at least
  `feature.min.gap` (0.5 mm) apart; parts meant to move after printing take
  the print-in-place clearance (0.35 per side, 0.70 diametral) and coupon C3.
- A drawer and its housing printed together upright, as one print-in-place
  assembly, with a bottom chamfer that keeps both on the bed without touching
  (https://www.youtube.com/watch?v=CpQGNRWWXs8,
  https://www.youtube.com/watch?v=cdyqNocFCpQ): no gap was stated; use the
  print-in-place clearance and coupon C3. A small breakaway sprue can tie the
  moving part to the frame for shipping.
- Small parts can be linked on the bed by tiny compliant tabs or one modeled
  raft so they succeed or fail together and eject as one unit
  ([production runs](production-runs.md) section 3).
