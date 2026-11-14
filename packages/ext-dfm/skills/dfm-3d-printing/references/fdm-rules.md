# FDM design rules

Every geometric rule the playbook applies to a fused-filament (FDM/FFF) part,
with a stable id, the value at the house default machine, the formula that recomputes
it for another nozzle or layer height, the reason, the evidence tag and the
source. The matching profile paths are in `profiles/fdm.json`
(`machine.nozzle`, `line.width`, `layer.height`, ...).

Notation: **N** nozzle diameter (house 0.4 mm), **W** line width (0.45 mm =
1.125 N, PrusaSlicer's default; Bambu Studio's stock profile uses 0.42 mm for
the outer wall and 0.45 mm for inner walls, VENDOR, see
[Bambu Lab](bambu-lab.md) section 2), **L** layer height (house 0.2 mm),
**L1** first layer (0.2 mm).

Tags, carried over from the research honestly:

| Tag | Means |
| --- | --- |
| MEASURED | a physical test with numbers |
| VENDOR | a printer maker's or service bureau's guideline |
| PRACTITIONER | experienced designer advice without published test data |
| DERIVED | worked out from a sourced fact; check before treating as fact |
| UNVERIFIED | not confirmed at a primary source |
| SNIPPET | the number was seen only in a search excerpt of the cited page |

Every value is a default and a recommendation. A value the user states (a
tested clearance, a datasheet, a different nozzle) replaces it.

Source keys used in the tables (full list: [sources](sources.md)):

| Key | URL |
| --- | --- |
| PRUSA-MODEL | https://help.prusa3d.com/article/modeling-with-3d-printing-in-mind_164135 |
| PRUSA-EF | https://help.prusa3d.com/article/elephant-foot-compensation_114487 |
| PRUSA-LAYERS | https://help.prusa3d.com/article/layers-and-perimeters_1748 |
| PRUSA-SEAM | https://help.prusa3d.com/article/seam-position_151069 |
| PRUSA-WARP | https://help.prusa3d.com/article/warping_2011 |
| BAMBU-WALL | https://wiki.bambulab.com/en/software/bambu-studio/wall-generator |
| BAMBU-HOLE | https://wiki.bambulab.com/en/software/bambu-studio/xy-hole-contour-compensation |
| HYDRA | https://www.hydraresearch3d.com/design-rules |
| HUBS-FDM | https://www.hubs.com/knowledge-base/how-design-parts-fdm-3d-printing/ |
| HUBS-WHAT | https://www.hubs.com/knowledge-base/what-is-fdm-3d-printing/ |
| SIMPLE | https://simplemachining.com/blogs/dfm-for-3d-printing-a-practical-design-guide |
| UNIONFAB | https://www.unionfab.com/blog/2026/03/design-for-manufacturing-3d-printing |
| PROTOLABS-GAP | https://www.protolabs.com/resources/design-tips/how-to-solve-for-size-constraints-small-gaps-and-thin-walls-in-3d-printed-parts/ |
| ULTIMAKER | https://ultimaker.com/wp-content/uploads/2024/06/How-to-design-for-FFF-1.pdf |
| CNCK-WIDTH | https://www.cnckitchen.com/blog/the-effect-of-extrusion-width-on-strength-and-quality-of-3d-prints |
| CNCK-LAYER | https://www.cnckitchen.com/blog/the-influence-of-layer-height-on-the-strength-of-fdm-3d-prints |
| CNCK-CMP | https://www.cnckitchen.com/blog/comparing-pla-petg-amp-asa-feat-prusament |
| CNCK-ORIENT | https://www.youtube.com/watch?v=7aJ4dDyyf20 |
| CNCK-INFILL | https://www.youtube.com/watch?v=AmEaNAwFSfI |
| SLANT-MASS | https://www.youtube.com/watch?v=9Hp-VRO1hVQ |
| SLANT-HOLES | https://www.youtube.com/watch?v=Bd7Yyn61XWQ |
| SLANT-CURVE | https://www.youtube.com/watch?v=ujAwxSx63FE |
| MUSE-CHAMFER | https://www.youtube.com/watch?v=XTvBOGgx48I |
| POLYHOLES | https://hydraraptor.blogspot.com/2011/02/polyholes.html |
| HACKADAY | https://hackaday.com/2017/10/17/sacrificial-bridge-avoids-3d-printed-supports/ |
| TEXTCALC | https://3dprintcalcs.uk/design/text-emboss-calculator/ |
| HLH | https://hlhrapid.com/knowledge/design-guide-fdm-3d-printing/ |
| MAKELAB | https://www.makelab.com/insights/3d-printing-tolerances-explained |
| CREALITY | https://www.creality.com/blog/3d-printing-bridging |
| XOM-FDM | https://cdn2.hubspot.net/hubfs/340051/Design_Guides/Xometry_DesignGuide_FDM.pdf (public PDF, v2.1) |
| XOM-KB | https://community.xometry.com/kb/articles/745-fdm-3d-printing |
| XOM-STD | https://www.xometry.com/manufacturing-standards/ |
| XOM-EU | https://xometry.pro/en-eu/3d-printing-design-guide/quick-guide/ |
| PROTOLABS-FDM | https://www.protolabs.com/services/3d-printing/fused-deposition-modeling/ |
| MWL-INFILL | https://www.youtube.com/watch?v=nV3GbN6hLjg |
| MWL-STRENGTH | https://www.youtube.com/watch?v=a6m_GnN5j4c |
| MAKER-HACKS | https://www.youtube.com/watch?v=ct-n2lI0I9g |
| SLANT-CONNECT | https://www.youtube.com/watch?v=vsHpiHhB3RU |
| SLANT-TOL | https://www.youtube.com/watch?v=XKrDUnZCmQQ |
| SLANT-MICRO | https://www.youtube.com/watch?v=Lq-SoGgKOcQ |

Rules added from the production-farm pass (FDM-WALL-8 and later ids in each
section) cite their videos by full URL; the research record, with every video,
the conflicts and the claims not adopted, is
`docs/specs/dfm-research/10-slant-3d-videos.md`. That source is one print farm
designing for its own automated production; its numbers are practitioner
values and never replace a measured or multi-source value. Designing for a
production run as a mode of its own is [production runs](production-runs.md).

## 1. Walls (FDM-WALL)

| Id | Rule | Value at N 0.4, L 0.2 | Formula | Why | Tag | Source |
| --- | --- | --- | --- | --- | --- | --- |
| FDM-WALL-1 | Thinnest printable wall is one perimeter | 0.45 mm | 1 W (`wall.min`) | A wall thinner than one bead has no toolpath | VENDOR | PRUSA-MODEL |
| FDM-WALL-2 | Make walls whole multiples of line width | 0.45, 0.9, 1.35, 1.8 mm | n W (`wall.unit`) | The slicer fills between loops with whole beads or gap fill; in-between thicknesses leave voids or zigzag gap fill | VENDOR | PRUSA-MODEL |
| FDM-WALL-3 | Minimum structural wall | 0.9 mm | 2 W (`wall.structural`) | Thinner walls print poorly and are weak | VENDOR | HYDRA |
| FDM-WALL-4 | Load-bearing wall | 1.35 to 1.8 mm | 3 to 4 W (`wall.loadbearing` = 4 W) | Perimeters carry most of the strength | VENDOR, MEASURED | HYDRA, CNCK-INFILL |
| FDM-WALL-5 | Wall for an unknown printer or a service | 1.2 mm; 1.5 mm for a load-bearing wall sent to a service bureau | constant (`wall.unknown.printer`) | Machine variation; bureaus recommend 1.5 for supporting walls and design to 1.5 x the process minimum | VENDOR | SIMPLE; XOM-FDM (1.2 to 1.5, 1.5 recommended); PROTOLABS-FDM (0.8 service minimum) |
| FDM-WALL-6 | Never model a wall under 1 W unless the slicer result is checked | see section 1.1 | under 1 W | The slicer drops or widens it | VENDOR, DERIVED | BAMBU-WALL |
| FDM-WALL-7 | Wall strength tracks total thickness, not loop count | 2 loops at 200 percent width held 39 kg vs 4 loops at 100 percent 33 kg (PLA hook) | | Wider beads bond better (peak about 150 percent width) | MEASURED | CNCK-WIDTH |
| FDM-WALL-8 | Cautious production floor: every wall and standalone feature at least 1.0 mm in XY | 1.0 mm | constant (`wall.min.cautious`) | Two lines plus side squash survive machine variation across a farm; 2 W (0.9) stays the floor on one tuned printer | PRACTITIONER (agrees with SIMPLE 1.0 to 1.2) | https://www.youtube.com/watch?v=1n_R8shlGcs, https://www.youtube.com/watch?v=qpo4WsEeYJo |
| FDM-WALL-9 | Blunt every modeled knife edge, blade or tip to a flat at least one line width wide; never a true point | 0.45 mm | 1 W (`edge.blunt.min`, status unverified) | A point makes the slicer thin the flow, so the tip flakes off; the layers under a point have no time to cool and the tip deforms | PRACTITIONER (the spoken 0.2 to 0.4 was reconstructed from auto-captions; the floor used is FDM-WALL-1's) | https://www.youtube.com/watch?v=oz51t5p9gXo, https://www.youtube.com/watch?v=Iauvzy5mR90, https://www.youtube.com/watch?v=aWz1mz4hhu8 |

Also from the production source: check the thinnest wall again after scaling a
model down, since a wall that printed at one size can fall under 1 W
(PRACTITIONER, https://www.youtube.com/watch?v=Iauvzy5mR90).

Published minimums disagree. The playbook keeps them as tiers rather than one
number:

| Source | Minimum wall | Note |
| --- | --- | --- |
| UltiMaker | 1 N (0.4 mm) | least conservative (ULTIMAKER) |
| Prusa | 1 W (0.45 mm) printable | (PRUSA-MODEL) |
| Unionfab | 0.8 mm, multiples of N | (UNIONFAB) |
| Hydra Research | 2 W (0.9 mm) structural | (HYDRA) |
| Simple Machining | 1.0 to 1.2 mm | most conservative common value (SIMPLE) |
| Hubs service | 2.0 mm minimum feature for orders | bureau margin (SNIPPET, https://www.hubs.com/3d-printing/fdm/) |

**Adopted:** below 1 W is an error (it will not print as drawn); 1 W to under
2 W prints but is flagged; 2 W is the structural floor; 3 to 4 W for load
paths; 1.2 mm when the printer is unknown.

### 1.1 What the slicer does with a 0.2 mm wall on a 0.4 mm nozzle

A 0.2 mm wall is half the nozzle width. Some CNC-machined materials hold a
0.2 mm wall; an FDM nozzle cannot lay one. In Bambu Studio (BAMBU-WALL,
VENDOR):

- **Classic wall generator:** the inset polygon collapses and no wall path is
  generated, so the wall is missing from the print, unless "Detect thin wall"
  is on, which shrinks the inset and can make overlapping or broken paths.
- **Arachne (variable-width) generator:** anything thinner than the minimum
  feature size (default 25 percent of N = 0.1 mm) is dropped; anything above
  that but still too thin is widened to the minimum wall width (85 percent of
  N = 0.34 mm).
- **Consequence (DERIVED):** the 0.2 mm wall prints as a single bead about
  0.34 mm wide, 70 percent oversize, or vanishes. It is technically sliceable
  and wrong either way. The fix is a 0.45 mm (1 W) or 0.9 mm (2 W) wall, or a
  different process (resin SLA resolves 0.2 mm walls on small parts: see
  [other processes](other-processes.md)).

The same arithmetic recomputes for other nozzles: at N 0.2 mm the Arachne
floor is 0.17 mm and 1 W is about 0.23 mm; at N 0.6 mm they are 0.51 and
0.68 mm.

## 2. Overhangs (FDM-OVH)

| Id | Rule | Value | Formula | Why | Tag | Source |
| --- | --- | --- | --- | --- | --- | --- |
| FDM-OVH-1 | Unsupported overhang limit, from vertical | 45 deg | constant (`overhang.max.angle`) | At 45 deg each layer rests half on the one below | VENDOR | HUBS-FDM; also SIMPLE, UNIONFAB, ULTIMAKER, XOM-FDM |
| FDM-OVH-2 | Physical limit is step-out per layer, about half a bead | about 48 deg at L 0.2; 66 deg at L 0.1; 37 deg at L 0.3 | atan(0.5 W / L) | Thinner layers allow steeper overhangs | DERIVED (from the Hubs 50 percent statement; not measured) | HUBS-FDM |
| FDM-OVH-3 | With strong part cooling | up to 60 deg | constant (`overhang.cooled.max.angle`) | Prusa: 45 to 60 deg by nozzle and settings; 360-degree cooling up to 75 deg; Hydra: under 50, many printers about 70 | VENDOR | PRUSA-MODEL, HYDRA |
| FDM-OVH-4 | Chamfer, never fillet, a downward-facing edge | 45 deg chamfer | | A fillet starts nearly horizontal, so its first layers sag; a chamfer keeps a constant step | PRACTITIONER (shown in G-code), VENDOR | MUSE-CHAMFER, HYDRA, PRUSA-MODEL, SLANT-MASS |
| FDM-OVH-5 | Remove a ledge by chamfering under it, as steep as the design allows | 45 deg or steeper | | Self-supporting, no cleanup | PRACTITIONER | SLANT-MASS |
| FDM-OVH-6 | Horizontal round hole: teardrop or pointed roof | 45 deg point on top | | The flat top of a round hole is a bridge that sags and ovals the hole | PRACTITIONER | SLANT-HOLES |
| FDM-OVH-7 | Horizontal hole without a teardrop: add droop relief at the top | 0.2 mm | 1 L (2 L at L 0.1) (`hole.horizontal.droop`) | Absorbs top droop and the stair-stepped bottom | VENDOR | HYDRA |
| FDM-OVH-8 | Hole that starts in mid-air (counterbore from below): sequential sacrificial bridges | first pair 0.2 mm, second pair at 0.4 mm | 1 L then 2 L cumulative (`bridge.sacrificial.first`, `.second`) | Each layer bridges a straight span instead of a circle over air | VENDOR | HYDRA; HACKADAY (PRACTITIONER) |
| FDM-OVH-9 | Sacrificial membranes only for small, non-structural holes | | | Strands left in the hole; punching through can tear the bottom layer | PRACTITIONER | SLANT-HOLES |
| FDM-OVH-10 | A horizontal ledge overhang (past 45 deg) stays short | 2 mm maximum length; anything over 5 mm long needs support even if narrower | | Bureau limit for unsupported overhang length | VENDOR | XOM-EU |
| FDM-OVH-11 | Grow every island from the main body: a feature that would start in mid-air on supports (a chin, a hand, a hanging lip) gets a joining block back to the part | | | An island on supports gets knocked off its support; many support islands warp, catch the nozzle and shift layers | PRACTITIONER (a production change described) | https://www.youtube.com/watch?v=ZgrlGfftm0k |
| FDM-OVH-12 | A round profile lying on its side (rod, axle, arm) gets an octagon (45 deg facets) or a hexagon with a flat down, or a flat cut on the bed side; a vertical rod only when short, with a chamfered foot | octagon meets 45 deg exactly | | A round on the bed is a line contact that needs a brim, and its underside overhangs past 45 deg | PRACTITIONER | https://www.youtube.com/watch?v=WfP-ZOnlFPM, https://www.youtube.com/watch?v=YMk7EfbemGY |
| FDM-OVH-13 | Dome interiors: keep the outside a true dome and make the inside pointed (a cone) or egg-shaped; printing does not need a constant wall | | | The inside crown of a hemisphere is a near-flat overhang that drags and strings, and on a thin wall it shows outside | PRACTITIONER | https://www.youtube.com/watch?v=udEeJjzEQZI |
| FDM-OVH-14 | A bottom edge that must look round: a curve that meets the bed at an angle, or an arc truncated before it turns horizontal (internal teeth less than a semicircle), never a fillet tangent to the bed | | | A tangent fillet starts horizontal, sags and warps | PRACTITIONER | https://www.youtube.com/watch?v=IrvxX0MtGMM, https://www.youtube.com/watch?v=m20UPm0TOto, https://www.youtube.com/watch?v=tb1yqVOyAM8 |
| FDM-OVH-15 | Thin or flexing overhanging features (snap tabs, lips) stay steeper than 45 deg | as steep as the design allows | | A filament color change alone flipped a marginal thin tab between sag and no sag | PRACTITIONER | https://www.youtube.com/watch?v=EoIlALcMJB8 |

On FDM-OVH-4 the production source offers one escape the playbook does not
adopt: fill the corner under a ledge with a large fillet and round its tip so
nothing ends horizontal
(https://www.youtube.com/watch?v=FMs-VGAu_PQ). The chamfer stays the rule; the
same video calls a chamfer the most manufacturable fix and says to make it as
steep as possible at high volume. On FDM-OVH-12, a flat cut on a round rod
leaves the underside next to the flat past 45 deg; the source's "tangent at
least 35 deg" for that flat does not say from which axis and is not adopted.
For a dome that must stay round inside, use the mushroom support of FDM-SUP-9,
or flatten the inside apex so generated supports meet a flat and release
(same dome video).

Overhang angles stated by the production source range from 30 to 60 deg
across its videos, mostly without saying from which axis, and its print
service generates supports only past 50 deg
(https://www.youtube.com/watch?v=f4fJ5AbUF6Q). None of these replaces
FDM-OVH-1.

A diamond hole (a square turned 45 deg) is a practitioner alternative to the
teardrop for horizontal holes and pegs: no flat roof, and the matching peg
prints lying down (PRACTITIONER, SLANT-CONNECT). Gothic-arch profiles remain
UNVERIFIED (no primary source read).

**Adopted:** 45 deg from vertical. 50 to 60 deg only on a printer known to
cool strongly, after an overhang-fan coupon.

## 3. Bridges (FDM-BRG)

| Id | Rule | Value | Formula | Why | Tag | Source |
| --- | --- | --- | --- | --- | --- | --- |
| FDM-BRG-1 | Bridge with no visible sag | 5 mm or less | constant (`bridge.conservative.span`) | Longer spans sag and show support marks | VENDOR | HUBS-FDM, UNIONFAB, XOM-EU |
| FDM-BRG-2 | Bridge design limit | 10 mm | constant (`bridge.max.span`) | Beyond this add vertical structure or supports | VENDOR | HYDRA; Xometry Europe also 10 |
| FDM-BRG-3 | Tuned printers reach farther | 20 to 25 mm | | Marketing upper bound, not a design value | VENDOR (SNIPPET) | CREALITY |
| FDM-BRG-4 | Bridge straight spans between parallel walls | | | Curved bridge edges droop; sacrificial bridging converts curves to straight spans | VENDOR | HYDRA |
| FDM-BRG-5 | Low infill under a flat top needs more top layers | about 0.9 mm skin | (`skin.top.min`) | Top skin bridges between infill lines; too few layers pillow | VENDOR | PRUSA-LAYERS |
| FDM-BRG-6 | A long thin roof tying two walls pulls them in ("shrink line") | | | Tilting spreads the roof over many layers | MEASURED (observed) | CNCK-ORIENT |
| FDM-BRG-7 | Shrink line where a thick solid floor meets a thin wall: cut a groove around the inside of the floor along the wall (an offset of the interior outline), or texture the outer wall; thicker walls did not help; a raised grid on the floor must be continuous, never islands | groove about 1 mm deep | constant (`shrinkline.groove.depth`, status unverified) | The groove disconnects the floor's top skin from the wall; the line nearly vanished | PRACTITIONER, one print per variant | https://www.youtube.com/watch?v=d61u_lKFa-U, https://www.youtube.com/watch?v=cdyqNocFCpQ |

**Adopted:** 10 mm for hidden or internal bridges; 5 mm on cosmetic or mating
faces and for an unknown printer. Bambu's data sheets list 30 mm for PLA and
PETG and 20 mm for TPU (VENDOR, see [materials](materials.md)); treat those as
best case. The production source says most machines bridge 25 to 50 mm and
supports vent slots only past about 25 mm
(https://www.youtube.com/watch?v=3AZWuVRUh2c,
https://www.youtube.com/watch?v=bO39lWkaspA,
https://www.youtube.com/watch?v=vcgsQyMSSiY): its stated position, not
adopted. Where a span is long, add a mid rib or cross member to shorten it.

## 4. Supports by design (FDM-SUP)

| Id | Rule | Value | Why | Tag | Source |
| --- | --- | --- | --- | --- | --- |
| FDM-SUP-1 | Design for zero generated supports | | Every support costs time, cleanup and a scarred face | PRACTITIONER | SLANT-MASS |
| FDM-SUP-2 | Chamfer under overhangs (FDM-OVH-4, -5) | 45 deg or steeper | Self-supporting | PRACTITIONER, VENDOR | SLANT-MASS, HYDRA |
| FDM-SUP-3 | Split the part so each piece prints flat and support-free; add pins at the cut | | Cut and bind | VENDOR | PRUSA-MODEL, PROTOLABS-GAP |
| FDM-SUP-4 | Print flat, then fold: two halves joined by a thin printed hinge | | | PRACTITIONER | CNCK-ORIENT |
| FDM-SUP-5 | Designed breakaway fins where something must overhang | sprues 0.5 to 1 mm wide, horizontal in the layer plane; foot disc 1 to 2 mm thick; label "R" | Peel off leaving a small dimple; rigid attachment stops warping stress popping the part loose | PRACTITIONER | SLANT-MASS; CNCK-ORIENT (MEASURED anecdote) |
| FDM-SUP-6 | A part resting on an edge or corner gets a flat chamfer pad | about 1 mm | A line contact comes loose | PRACTITIONER | SLANT-MASS |
| FDM-SUP-7 | Supports are acceptable for a large horizontal hole that must be crisp, one-off prototypes, and hidden or machined faces | | | PRACTITIONER | SLANT-HOLES |
| FDM-SUP-8 | A designed support fin, in detail: tines (sprues) flat in the layer plane, one continuous extrusion through tine and part, never tines standing perpendicular to the face; fin foot a disc or ellipse about 1 mm thick; fin top rounded; about five tines, dense near the bed then every few layers; fins near an edge or corner, not mid-face, and at both ends of a long part, merged slightly inboard of the corners so nubs cut flush; a small break notch in each tine at the part | gap where support and part are not joined 0.2 mm (`support.designed.gap`); tine 0.5 thick (`support.designed.tine.height`) by 0.5 to 1 wide (`support.designed.tine.width`); round sprue or stem 1 mm (`support.designed.sprue.diameter`) | Perpendicular tines are stacks of one-layer islands that break and leave balls; 1 mm wide tines left visible nubs; a separate fin 0.2 mm away holds the part in one direction only | PRACTITIONER, some CLAIMED-TEST | https://www.youtube.com/watch?v=vnn4XeKQobs, https://www.youtube.com/watch?v=3VUQd_Tl5x0, https://www.youtube.com/watch?v=3AZWuVRUh2c, https://www.youtube.com/watch?v=8NKVNwVaZU0, https://www.youtube.com/watch?v=6gPPAiqSkBc |
| FDM-SUP-9 | Designed support shapes for other cases: pointed towers under an undercut; a thumbtack (1 mm stem, wide flat head) under a small downward point; a mushroom (wide cap, thin stem) under a dome, cap 0.5 mm or more below it; a cup with 0.2 mm gap all round under a sphere; a small hollow block tapering to a slightly rounded contact; a support comb for a tall thin part (FDM-SUP-13) | tower tip 0.5 mm (`support.designed.point`, status unverified) | Each lets the slicer print the support with no generated support of its own and leaves one small mark on a non-show face | PRACTITIONER | https://www.youtube.com/watch?v=B6r8m93MNGQ, https://www.youtube.com/watch?v=YL5lYEXbLDo, https://www.youtube.com/watch?v=udEeJjzEQZI, https://www.youtube.com/watch?v=m3Cxw-j19bU, https://www.youtube.com/watch?v=WYQbxIVLz6Y |
| FDM-SUP-10 | Designed supports are sized for one nozzle (the values above are for 0.4 mm): never scale them with the part; redraw them for another nozzle and prove them with coupon C22 | | Scaled down, the slicer stops printing the stem or tine; scaled up, the gap fuses or the mark grows | PRACTITIONER | https://www.youtube.com/watch?v=YL5lYEXbLDo |
| FDM-SUP-11 | Landing pads, cautious: a part stood on an edge gets a flat chamfer about 2 mm wide (FDM-SUP-6's 1 mm stays the minimum); a peaked part printed upside down gets its apex cropped to a flat strip about 6 mm wide; keep the center of gravity over the pad and the stance symmetric | edge 2 mm (`landing.edge.width`); apex 6 mm (`landing.apex.width`, status unverified) | A failed print on a narrow land is shown; an asymmetric stance tips and detaches | PRACTITIONER | https://www.youtube.com/watch?v=vnn4XeKQobs, https://www.youtube.com/watch?v=ip70-Tw6tBE, https://www.youtube.com/watch?v=reIXSlL6mKA, https://www.youtube.com/watch?v=9ERY20MRJPo |
| FDM-SUP-12 | A channel or tunnel that would otherwise need support (a print-in-place slide, a long bridge) gets a removable block modeled in it: gap above and below, edges chamfered so it twists out, a hole through it so pliers can crush it, and the word SUPPORT or REMOVE embossed on it | gap above 0.2, below 0.2 to 0.3 mm | The block prints on generic settings and comes out in one piece | PRACTITIONER | https://www.youtube.com/watch?v=3AZWuVRUh2c, https://www.youtube.com/watch?v=4wRKmcWXEkw |
| FDM-SUP-13 | A tall, thin part printed upright (a panel, a fin, a near-vertical plate) gets one or two thin breakaway fins on its back as outriggers, or a support comb: a post close to the part with 1 mm horizontal fingers trimmed to its profile and pushed slightly into it, stopping below the top | fingers 1 mm (`support.designed.sprue.diameter`) | Tall thin parts wobble and band near the top, worst on moving-bed printers; generated support cannot reach a vertical plate | PRACTITIONER | https://www.youtube.com/watch?v=DnPu7slvBVk, https://www.youtube.com/watch?v=3Acks3Wzjjo |

The production source's offset support gap was also spoken as "2 to 3" in
several videos, read as 0.2 to 0.3 mm because the auto-captions drop leading
decimals (UNVERIFIED reading); its in-channel block gap was spoken in a garbled
form most likely meaning 0.3 mm (UNVERIFIED). Its preferred workflow for a
part a designed fin cannot serve is to generate thick tree supports in a
slicer and export them as part of the mesh, so every printer gets the same
support (https://www.youtube.com/watch?v=3AZWuVRUh2c). A 1 mm sprue under a
snap tab on a part assembled once can be left to break on first assembly
(https://www.youtube.com/watch?v=6DkCCOc5O1Y). Generated supports can use less
material than designed ones on a large dome (FDM-OVH-13).

## 5. Orientation and anisotropy (FDM-ORI)

| Id | Rule | Value | Why | Tag | Source |
| --- | --- | --- | --- | --- | --- |
| FDM-ORI-1 | Assume across-layer (Z) strength is half of in-layer strength | PLA 0.5, PETG 0.45, ABS 0.5, ASA 0.3 (open printer); on untuned stock profiles PLA 0.40 to 0.48 and PETG 0.35 (use 0.35 for PETG on an unknown printer) | Layer bonds are weaker than filament | MEASURED | CNCK-ORIENT (PLA tensile 63 vs 31 MPa), CNCK-LAYER, CNCK-CMP (PLA 55, PETG 46, ASA 29 percent), MWL-STRENGTH (stock profiles, single samples) |
| FDM-ORI-2 | Orient so the main load runs along the layers and the highest-stress region is not a layer boundary | | A bracket printed on its big face fails at the bend along a layer line | MEASURED (explained) | CNCK-ORIENT |
| FDM-ORI-3 | If tilting to help layer adhesion, tilt at least 45 deg | 30 deg 44 MPa, 45 deg 40 MPa, 60 deg 36 MPa vs flat 63 and upright 31 | The curve is S-shaped; small tilts barely help | MEASURED | CNCK-ORIENT |
| FDM-ORI-4 | Layer height at most half the nozzle for strong parts | 0.2 mm | 0.5 N (`layer.max.structural`) | Standing hooks at 0.3 mm held half the load | MEASURED | CNCK-LAYER |
| FDM-ORI-5 | Holes whose axis runs through layer lines split under screw load | | Wedge forces split layers at the hole equator | PRACTITIONER, MEASURED | SLANT-MASS, CNCK-ORIENT |
| FDM-ORI-6 | Reinforce such holes: relief slots; a hidden 2 mm hole beside it to force perimeters; hidden slits about 1 mm above and below the centerline to force solid skins | | Extra walls flank the weak plane | PRACTITIONER | SLANT-MASS |
| FDM-ORI-7 | Pins standing in Z are weakest at the base; under 5 mm diameter they are perimeters only | add a base fillet; print load-bearing pins lying down or use metal pins | Layer boundaries cross the bending plane | VENDOR | HUBS-FDM, HYDRA |
| FDM-ORI-8 | Multi-direction parts (corner brackets): compromise at 45 deg or split | | No orientation suits every arm | MEASURED (explained) | CNCK-ORIENT |
| FDM-ORI-9 | Export the mesh in the intended print orientation | | The person slicing gets the orientation the design assumed | PRACTITIONER | CNCK-ORIENT, SLANT-MASS |
| FDM-ORI-10 | Impact and drop loads must never cross the layers | across-layer impact about 0.25 of in-layer (`strength.z.impact.fraction`; PLA 0.23 to 0.26, PETG 0.23 to 0.31, Izod) | Impact is far more anisotropic than tensile strength | MEASURED | MWL-STRENGTH (Prusa MK3, stock profiles, single samples) |
| FDM-ORI-11 | Snap fits and gear or ratchet teeth print lying on their side | | No layer boundary crosses the flexing or loaded section | VENDOR | https://markforged.com/resources/blog/joinery-onyx |
| FDM-ORI-12 | Put critical dimensions in the XY plane; use metal pins, shoulder bolts or bushings for wear, alignment and concentricity | | XY is the accurate plane; printed bores wear | VENDOR | https://markforged.com/resources/learn/design-for-additive-manufacturing-plastics-composites/3d-printing-strategies-for-composites/composites-3d-printing-design-tips |
| FDM-ORI-13 | Reinforcing a screw hole whose axis crosses the layers: thin disc cuts around the hole at mid-thickness of the tab (repeat for a thick tab), or slits placed off the hole's center plane and angled; never a single slit plane through the hole center | cuts 0.1 to 0.2 mm wide (`microfeature.slot.width`) | The slicer fills the cuts with walls so the ring around the hole prints solid; one plane through the center acts as a zipper along which the layers split | PRACTITIONER | https://www.youtube.com/watch?v=UfJIMn4nvsA, https://www.youtube.com/watch?v=ip70-Tw6tBE |
| FDM-ORI-14 | Strap and belt slots run parallel to the layer lines; lanyard and cord loops lie in the layer plane (flush with a face) or run as an internal channel between two flush holes | | The layers then form continuous loops around the strap; a loop standing across the layers snaps at a layer line | PRACTITIONER | https://www.youtube.com/watch?v=lGnpz8q4STw, https://www.youtube.com/watch?v=oYEV-ndgwdk, https://www.youtube.com/watch?v=Iauvzy5mR90 |
| FDM-ORI-15 | Orientation by cropping: a three-way corner bracket is cropped at the corner and stands on that crop so its layers loop around the joint; a box or enclosure turned 45 deg about one horizontal axis on a chamfered landing has every interior face at 45 deg and needs no support | | Removes interior supports and gives every outside face the same finish; the strength claim is in FDM-ORI-3's terms, not "strongest in every feature" | PRACTITIONER, CLAIMED-TEST (sliced, no supports generated) | https://www.youtube.com/watch?v=csUGcIPNNkk, https://www.youtube.com/watch?v=8TIhkxQNINY, https://www.youtube.com/watch?v=8NKVNwVaZU0 |

Refinements from the production source. FDM-ORI-6: the slits it lists are
placed off the center plane for the reason in FDM-ORI-13. FDM-ORI-8 and
FDM-ORI-11: a ring with snap clips printed flat snaps its clips; printed on its
side with the clips at 45 deg to horizontal, no clip has layers across its
flex plane; chamfering the clip roots moves the flexing into the ring
(https://www.youtube.com/watch?v=_y8Yvu1FQIE). Springs, snap tabs and
flexures put all their force in the layer plane; a spring printed at an angle
loses most of its return ([hardware](hardware.md) section 9). FDM-ORI-3: the
source's claim that a part printed at 45 deg is strongest in every feature
(https://www.youtube.com/watch?v=8NKVNwVaZU0) and that angled walls stop
cracks (https://www.youtube.com/watch?v=YMk7EfbemGY) are not adopted beyond
the measured curve; a 45 deg tilt measured 40 MPa against 63 flat.

## 6. Bed contact, first layer, warping (FDM-BED)

| Id | Rule | Value | Formula | Why | Tag | Source |
| --- | --- | --- | --- | --- | --- | --- |
| FDM-BED-1 | Elephant's foot: the first layer prints wider than drawn | slicer compensation about 0.2 mm on a 0.4 mm nozzle | | The first layer is squashed and soft | VENDOR | PRUSA-EF |
| FDM-BED-2 | Chamfer every bed-contact edge, 45 deg | 0.5 mm adopted (sources 0.3 to 1 mm) | max(0.5, L1 + L) (`chamfer.bed.edge`) | Hides the lip without depending on slicer settings | VENDOR (Hydra 0.3), PRACTITIONER (Slant 1.0), VENDOR (Hubs, no size) | HYDRA, SLANT-MASS, HUBS-FDM |
| FDM-BED-3 | Round vertical corners of large footprints | R over 4 mm | (`corner.bed.radius.large`) | Sharp corners concentrate warping force | VENDOR | HYDRA |
| FDM-BED-4 | Fillet vertical edges generally | | Smoother motion, better first layer | PRACTITIONER | SLANT-MASS |
| FDM-BED-5 | No text, logos or fine islands on the first layer; keep the first layer on a hidden or bottom face for production parts | | Small islands do not stick and shift | PRACTITIONER | SLANT-MASS |
| FDM-BED-6 | Large flat bases warp; ABS, ASA, PC warp most | | Uneven cooling lifts edges | VENDOR | UNIONFAB, PRUSA-WARP, HUBS-FDM |
| FDM-BED-7 | Brim first; designed mouse ears if needed | ears 1 L thick, snap off; for severe curl 10 to 20 mm diameter and 3 to 5 layers thick (thin brims tear off) | 1 L | Holds lifting corners | VENDOR, PRACTITIONER | PRUSA-WARP; MAKER-HACKS (severe-warp alternative, PRACTITIONER) |
| FDM-BED-8 | Keep the first layer one simple region: cosmetic holes stop short of the bed face (blind from above); thin isolated spines, bosses or spring tips on the bed are tied into one continuous outline by small sprues or about 0.3 mm connectors, snipped later or left | | | Islands on the first layer get knocked over or lift; one outline prints as a continuous path | PRACTITIONER | https://www.youtube.com/watch?v=X8kqMaxwB4M, https://www.youtube.com/watch?v=SSHoQLuVJFk, https://www.youtube.com/watch?v=Iauvzy5mR90, https://www.youtube.com/watch?v=rsfZgT3ZEI8 |
| FDM-BED-9 | Warp countermeasures in the geometry of a large flat base: round its corners; cut shallow relief slits up into the underside in a checkerboard (first layer left continuous); ripple or slightly bow long walls; add small internal cavities at the corners to break long infill paths | slits about 0.5 mm deep at about 25 mm pitch (`warp.relief.depth`, `warp.relief.pitch`, both status unverified) | The longest continuous shrink path drives warp; breaking it lowers the pull on the corners | PRACTITIONER, CLAIMED-TEST (one demo plate), no measurement | https://www.youtube.com/watch?v=iPZoDltS30A |
| FDM-BED-10 | A mouse ear as a sprue: a one-layer disc joined to the corner tip by a short neck, kept as close to the corner as possible | disc 1 L thick (`production.brim.thickness`) | One snip removes it with little residue; a long neck stretches under warp and the corner still lifts | PRACTITIONER | https://www.youtube.com/watch?v=MCcFMDv_4eo |

Refinements from the production source. FDM-BED-3: make footprint corners as
large as the design allows, 5 to 10 mm better than 1 mm, ideally a round
footprint (https://www.youtube.com/watch?v=X8kqMaxwB4M). FDM-BED-4: fillet
vertical edges at least about 1 mm; 3 mm fillets on a cube cut the slicer's
estimate by about 2.5 to 3 percent (one slicer estimate), reduce ringing where
the head stops and reverses at a sharp corner, and keep a part from catching
the nozzle and being knocked loose (PRACTITIONER, CLAIMED-TEST,
https://www.youtube.com/watch?v=C0H_4fOm9CQ,
https://www.youtube.com/watch?v=3VUQd_Tl5x0,
https://www.youtube.com/watch?v=Wd0MR4sPcK0). FDM-BED-5: the source allows
text one layer deep on the bed face and a logo there if it is one continuous
motion; not adopted, the first layer stays free of text and logos. FDM-BED-2:
the source also fillets bed edges in some videos and calls the bed chamfer
optional in one; not adopted, the chamfer stays. The source reports parts
shrinking about 1 percent (0.1 mm over 10 mm); the calculator values in
[materials](materials.md) section 2 stay the reference, and a test part
calibrates either.

A production run that must release from the bed shapes and reduces bed contact
on purpose: [production runs](production-runs.md) section 2.

Elephant's foot range: 0.3 mm (Hydra) is the smallest chamfer that hides the
lip; 1 mm (Slant 3D) is robust against machine variation. **Adopted:** 0.5 mm
on the house default machine, 1 mm for an unknown printer, and always a chamfer, never
a fillet. A mating face on the bed gets the chamfer whatever the cosmetic
preference ([fits](fits-and-clearances.md)).

Quantified warp versus footprint size: no measured study found (UNVERIFIED).
A flat ABS, ASA or PC plate over about 100 mm on an open printer is high risk
(UNVERIFIED heuristic from `docs/specs/dfm-research/03-materials.md`). FDM-BED-9
gives practitioner geometry against warp, still without a measurement.

## 7. Holes and pins (FDM-HOLE, FDM-PIN)

| Id | Rule | Value | Formula | Why | Tag | Source |
| --- | --- | --- | --- | --- | --- | --- |
| FDM-HOLE-1 | Printed holes come out small | 0.1 to 0.25 mm small on diameter on tuned printers | | Facet chords, arc shrink and corner cutting, bead squash, material shrink | MEASURED, VENDOR | https://www.cnckitchen.com/blog/are-our-heat-set-insert-datasheets-wrong, POLYHOLES, BAMBU-HOLE, HUBS-FDM |
| FDM-HOLE-2 | Add diametral compensation in CAD to a hole that must come out at a stated size | +0.2 mm diametral (0.1 per side); +0.4 diametral (0.2 per side) as the unknown-printer or small-hole alternative | (`hole.compensation.diametral`) | Sources: +0.2 to +0.4 under 5 mm (SIMPLE); +0.2 to +0.3 (research agent rule); +0.4 on small holes, one method only (Teaching Tech, PRACTITIONER, https://www.youtube.com/watch?v=yP7_qZ_Mi78) | VENDOR | SIMPLE |
| FDM-HOLE-3 | Do not stack slicer hole compensation on a modeled offset | slicer XY hole compensation = 0 | | It is per side and changes per user; tune fit in CAD | VENDOR, PRACTITIONER | BAMBU-HOLE, SLANT-MASS |
| FDM-HOLE-4 | Export round holes with at least 32 facets, circumscribed | r_model = r / cos(180 deg / n) | n at least 32 (`hole.facets.min`) | 10 facets lose 5 percent of diameter, 22 facets 1 percent | MEASURED (derived) | POLYHOLES; https://printpal.io/docs/3d-printing-design-guide (SNIPPET) |
| FDM-HOLE-5 | Minimum hole | 2.0 mm; labeled alternative, not adopted: 1.0 mm diametral as Xometry's industrial roundness floor (holes over 1.0 stay round, best printed vertical), not a functional minimum | constant (`hole.min.diameter`) | Smaller holes close up | VENDOR | HYDRA; PROTOLABS-FDM (2.0); https://ultimaker.com/learn/design-for-fff-3d-printing-maximize-your-success/ (SNIPPET); XOM-FDM, XOM-STD (1.0 roundness floor) |
| FDM-HOLE-6 | Critical diameters (bearing, dowel, press fit): print undersize and drill or ream | | Printing cannot hold it | VENDOR | HUBS-FDM, HYDRA |
| FDM-HOLE-7 | Vertical holes are round but small; horizontal holes are oval (top sag, stepped bottom) | | | VENDOR | HUBS-FDM |
| FDM-HOLE-8 | Pilot holes as a fraction of size: tap 90 percent of major diameter; self-tapping screw 96 percent; heat-set insert 98 percent of insert OD | | | VENDOR (SNIPPET in research file 04) | HYDRA |
| FDM-HOLE-9 | Fit-tolerant features instead of exact diameters: 1 to 2 deg tapered pin, split compliant pin, lead-in chamfer, crush ribs, grip fins (about 1 mm, slightly under the shaft, undercut slot gap 0.3 mm minimum and 0.5 mm maximum, `fitfeature.compliant.gap.min`, `.max`) | | Fit survives printer variation; under 0.3 some CAD or STL tools close the slot, over 0.5 the feature deforms | PRACTITIONER | SLANT-MASS, SLANT-HOLES, SLANT-TOL |
| FDM-PIN-1 | Minimum pin diameter | 1.8 mm | 4 W (`pin.min.diameter`) | At least two full perimeters form | VENDOR | HYDRA |
| FDM-PIN-2 | Pins under 5 mm are perimeters only: base fillet | | | VENDOR | HUBS-FDM |

A composite formula (shrink percent + slicer compensation + 0.10 mm for
vertical holes) seen in a search excerpt is UNVERIFIED and not used
(https://tools.creative3dp.com/blog/3d-printed-holes-too-small/).

Refinements from the production source. FDM-HOLE-7: model a side hole slightly
tall (oval) so it sags round; no amount is given
(https://www.youtube.com/watch?v=sza8wg5FIxQ); the teardrop and the droop
relief stay the sized methods. FDM-HOLE-9: grip fins in detail, locating fins
instead of pins, keyhole and tab pins: [fits and clearances](fits-and-clearances.md)
sections 10 and 11. Vertical pins: a cross-shaped or wrinkled section with
0.2 mm internal slots carried into the base prints nearly solid; a slight
taper (root wider than the hole, tip narrower) presses in and wears in
(PRACTITIONER, https://www.youtube.com/watch?v=uMA-Wt-z_BU).

Fits and clearances between mating parts: [fits and clearances](fits-and-clearances.md).

## 8. Small features and text (FDM-FEAT, FDM-TXT)

| Id | Rule | Value | Formula | Why | Tag | Source |
| --- | --- | --- | --- | --- | --- | --- |
| FDM-FEAT-1 | Minimum standalone feature in XY | 1.8 mm | 4 W (`feature.min.size`) | Xometry industrial FDM: 0.89 resolvable, 1.14 safest, 1.2 to 1.5 recommended; Protolabs gives both 0.2 and 2.0 (one is a decimal slip, UNVERIFIED which) | VENDOR | HYDRA; XOM-KB, XOM-FDM; PROTOLABS-FDM |
| FDM-FEAT-2 | Features must exceed 2 L in Z and twice the XY resolution laterally | | | | VENDOR | SIMPLE |
| FDM-FEAT-3 | Gap between features that must stay separate (a single gap, not a fit) | 0.5 mm adopted; 0.75 for an unknown printer | constant (`feature.min.gap`) | They fuse | VENDOR | UNIONFAB (0.4 to 0.5); XOM-EU (0.5 capability, 1.0 recommended); PROTOLABS-GAP (0.75, a multi-process advisory that never names FDM and equals its SLS/MJF gap) |
| FDM-FEAT-4 | Outside vertical corners always have a radius of about N/2 | | Round nozzle | VENDOR | HUBS-FDM |
| FDM-FEAT-5 | Inside vertical corners can be sharp; Z edges are limited by L (stair steps) | | | VENDOR, PRACTITIONER | HUBS-FDM, SLANT-CURVE |
| FDM-FEAT-6 | Fillets at least 1 mm where used; never on downward-facing edges | 1 mm | | | VENDOR | HYDRA |
| FDM-FEAT-7 | Break the edge where a hole meets a face: a small fillet where a side hole meets its wall; a chamfer (or a fillet) at the rim of a vertical hole in a top face; a fillet on the top edges of a part printed flat | about 1 mm on a top-face hole rim | | A sharp hole edge ripples the toolpath and a plain hole's loop bonds poorly to the top skin; a tiny hole with an edge break stays open; rounded top edges let the walls merge into the top skin | PRACTITIONER | https://www.youtube.com/watch?v=Bd7Yyn61XWQ, https://www.youtube.com/watch?v=3BIvSiuQVWQ, https://www.youtube.com/watch?v=aWz1mz4hhu8, https://www.youtube.com/watch?v=NaQ_Sa1BaqU |
| FDM-FEAT-8 | Decorative patterns as relief (embossed or debossed about 1 mm, with a solid border), not through-cuts; vents as slots cut at an angle through a thickened wall, or slots following the layers, not grids of small round holes; aim for one continuous outline per layer (a fin handle rather than a loop handle) | texture about 1 mm deep, border about 10 mm (7 where proportions need it) | Through-cuts and hole grids make islands, retractions, stringing and a weak perforated line; one outline per layer prints without retractions | PRACTITIONER | https://www.youtube.com/watch?v=31FVZIg4rDs, https://www.youtube.com/watch?v=YMk7EfbemGY, https://www.youtube.com/watch?v=vcgsQyMSSiY, https://www.youtube.com/watch?v=m20UPm0TOto, https://www.youtube.com/watch?v=rUUq4kgi7t4 |
| FDM-TXT-1 | Embossed stroke width | 0.9 mm | 2 W (`text.min.stroke`) | | VENDOR | HYDRA |
| FDM-TXT-2 | Engraved stroke width | 0.5 mm | constant | | VENDOR | HYDRA, HLH (SNIPPET) |
| FDM-TXT-3 | Character height, bold sans-serif | 5 mm | constant (`text.min.height`) | Calculator: about 4.5 mm bold, 6 mm regular at N 0.4 (stroke times 5.6 to 6); Xometry Europe 5 recommended, 3.5 capability | DERIVED | TEXTCALC (SNIPPET), HYDRA, XOM-EU |
| FDM-TXT-4 | Raised height | 0.6 mm; at least 1.0 mm on an industrial FDM order | 3 L (`text.emboss.height`) | Industrial FDM prints 0.254 mm layers | DERIVED | TEXTCALC (SNIPPET); HLH 0.3 mm min (SNIPPET); UNIONFAB 0.5 mm; XOM-FDM 0.5 minimum, 1.0 industrial; Protolabs 0.3048 all processes |
| FDM-TXT-5 | Engraved depth | 0.8 mm; at least 1.0 mm on an industrial FDM order | 4 L (`text.engrave.depth`) | | DERIVED | TEXTCALC (SNIPPET); HLH 0.5 mm min (SNIPPET); XOM-FDM |
| FDM-TXT-6 | On vertical faces: embossed at most about 0.9 mm out, engraved under 0.9 mm deep | | Larger features sag | VENDOR | HYDRA |
| FDM-TXT-7 | Text on vertical walls or top faces, never on the first layer | | | PRACTITIONER | SLANT-MASS |
| FDM-TXT-8 | Text on a vertical face, cautious depths: raised at most 0.5 mm, engraved about 0.5 mm and no deeper; side walls are the best place for text | 0.5 mm each (`text.sidewall.emboss.max`, `text.sidewall.engrave.max`) | caps `text.emboss.height` and `text.engrave.depth` on vertical faces only | Raised 1 mm sagged at the letter bottoms; deeper engraving made defects; a side wall resolves one layer (0.2) where a top face resolves one nozzle width, so side text is about twice as crisp | PRACTITIONER, CLAIMED-TEST | https://www.youtube.com/watch?v=upf9ixYtDG4, https://www.youtube.com/watch?v=TH82TSjI67I, https://www.youtube.com/watch?v=aWz1mz4hhu8, https://www.youtube.com/watch?v=DnPu7slvBVk |
| FDM-TXT-9 | Text on a top face: engrave rather than emboss; avoid it unless the letters are large and bold | | | Raised letters on a top face are islands with retractions, stringing and smearing | PRACTITIONER | https://www.youtube.com/watch?v=upf9ixYtDG4, https://www.youtube.com/watch?v=TH82TSjI67I |

Other text guides range from 3 mm height with a 0.8 mm stroke to 5 to 6 mm
raised (VENDOR, SNIPPET). The nozzle-relative formula halves every value at a
0.2 mm nozzle. The production source puts its minimum at 3 mm on a side wall
(about 1/8 in), 4 to 5 mm preferred, strokes 0.5 to 1 mm
(https://www.youtube.com/watch?v=upf9ixYtDG4,
https://www.youtube.com/watch?v=aWz1mz4hhu8): a production alternative to
prove with coupon C26, not a replacement for `text.min.height` (5 mm). Its
other text advice: dark filament for text (light colors give low contrast);
leave raised text smooth on a textured face for contrast; part numbers or
codes can sit just under the skin, readable against a light
(https://www.youtube.com/watch?v=DnPu7slvBVk,
https://www.youtube.com/watch?v=TH82TSjI67I).

## 9. Strength (FDM-STR)

| Id | Rule | Value | Why | Tag | Source |
| --- | --- | --- | --- | --- | --- |
| FDM-STR-1 | Add perimeters before infill | 6 perimeters at 15 percent infill matched 2 perimeters at 100 percent; at equal mass a thicker shell always beat more infill (PETG, bending) | Bending stress peaks at the outer fibers | MEASURED | CNCK-INFILL, MWL-INFILL |
| FDM-STR-2 | Practical ceiling for strong parts | about 4 perimeters and 50 percent infill; CNC Kitchen's functional default is 3 perimeters, 30 percent (`perimeters.structural` = 3); infill 15 to 20 percent, rarely over 30 (exceptions: large flat parts, corrugated walls). Small, thin or detailed parts may use 100 percent infill | 100 percent infill is uneconomical on large parts | MEASURED, PRACTITIONER | CNCK-INFILL, MWL-INFILL; MAKER-HACKS (small-part exception, PRACTITIONER) |
| FDM-STR-3 | Infill pattern at 30 percent: triangular 60 kg, honeycomb 57, grid 52, rectilinear 48, wiggle 45 (PLA hooks). Alternative at equal mass: cubic strongest by a clear margin, gyroid third; lightning, Hilbert, Archimedean chords and octagram unsuitable for load; honeycomb, gyroid and similar print about a third slower | Default to cubic or adaptive cubic | The ranking depends on the comparison: equal percentage (CNC Kitchen) vs equal mass (Made with Layers, PETG, one geometry) | MEASURED | CNCK-INFILL, MWL-INFILL |
| FDM-STR-4 | Design solid shapes and let the slicer fill them; do not copy molding-style thin shells with ribs and draft | | Ribs remove a wall and weaken a printed part; no draft needed | PRACTITIONER | SLANT-MASS |
| FDM-STR-5 | Ribs, where used: whole multiples of W, at least 2 W, in the XY plane | | Strands along the load | DERIVED | `docs/specs/dfm-research/01-fdm-design-rules.md` section 9 (no FDM rib ratio source; molding ratios do not transfer) |
| FDM-STR-6 | Fillet internal corners in XY (at least 1 mm); chamfer downward-facing internal corners | | Stress relief without overhang | VENDOR | HYDRA, HUBS-FDM |
| FDM-STR-7 | Top skin at least about 0.9 mm (3 layers at 0.3, 9 at 0.1) | 0.9 mm | Prusa profiles always use at least 2 perimeters | VENDOR | PRUSA-LAYERS |
| FDM-STR-8 | A plate thinner than top plus bottom skin (about 1.6 to 2 mm) prints solid | | | DERIVED | PRUSA-LAYERS |
| FDM-STR-9 | Gradient infill: about 30 percent more stiffness per weight | | | MEASURED (SNIPPET) | https://www.cnckitchen.com/blog/gradient-infill-for-3d-prints |
| FDM-STR-10 | Microfeatures: cut slots, holes or ribs about 0.2 mm wide into the model to force fused extra perimeters | 0.2 mm at N 0.4; if wide enough to print as two walls they make a weak sleeve | Designs strength in independent of slicer settings; ribs tested best | PRACTITIONER | SLANT-MICRO |
| FDM-STR-11 | Where a rib is needed, make it self-supporting: a triangular, chamfered or rounded underside, a diagonal layout on a flat sheet, or cross members that shorten a molded-style shelf; a thin rib on one side of an upright thin arm acts as a shear web | | A molding rib leaves horizontal shelves that sag; a web stops an upright arm snapping across layers | PRACTITIONER, one CLAIMED-TEST (squeeze demo) | https://www.youtube.com/watch?v=8vz9b0zNMVg, https://www.youtube.com/watch?v=GDEMxa4WdRw, https://www.youtube.com/watch?v=as84ZBjdmxU |
| FDM-STR-12 | A screw head clamps solid material: counterbore or countersink so the web under the head is all walls and skins, not infill | example: 5 mm hole, 15 mm counterbore, 6 mm web with 1 to 2 mm skins | Cracks start where walls backed by infill take the clamp load | PRACTITIONER | https://www.youtube.com/watch?v=Wd0MR4sPcK0, https://www.youtube.com/watch?v=YMk7EfbemGY |
| FDM-STR-13 | Microfeature sizing (refines FDM-STR-10): slots 0.1 to 0.2 mm (slicers may close gaps near 0.05); around a screw hole, a ring of small holes or slots about 2 mm from the hole wall, starting 1 to 2 mm below the top face; never a full ring slot, which isolates a loose cylinder; the slot depth sets the depth of the induced wall | 0.2 mm (`microfeature.slot.width`); 2 mm (`microfeature.hole.offset`) | A ribbed rod was claimed about 3 times as strong as a plain one with a 1 mm wall (no data shown) | PRACTITIONER, CLAIMED-TEST | https://www.youtube.com/watch?v=3BIvSiuQVWQ, https://www.youtube.com/watch?v=ip70-Tw6tBE, https://www.youtube.com/watch?v=Lq-SoGgKOcQ, https://www.youtube.com/watch?v=81qmDc5unYM, https://www.youtube.com/watch?v=OcxfQeeKn-s |
| FDM-STR-14 | Infill density data from the production source (section 9.1) supports the existing rules: strength rose about in proportion to mass from 10 to 80 percent and jumped at 90 and 100; about 50 percent is the most a part normally needs | | Use the tables, not the narration, which says infill hardly matters below 100 percent | PRACTITIONER, CLAIMED-TEST | https://www.youtube.com/watch?v=ZNX7Mzjq_fk, https://www.youtube.com/watch?v=-LHQtlxYQII |
| FDM-STR-15 | Wall thickness data from the same source (section 9.1) confirms FDM-STR-1: compression strength of an empty cube rose steeply with wall thickness | | Only the pound values are data; the stated newtons are wrong | PRACTITIONER, CLAIMED-TEST | https://www.youtube.com/watch?v=PQHKQH5imkI |

The same source uses enclosed internal cavities on purpose to force thick
walls where it wants local stiffness, keeping a skin over them
(https://www.youtube.com/watch?v=AURCtaRrUGM); and argues against lightening
cavities, which add walls, time and surface area. It contradicts itself on
ribs ("no ribs, fill solid" in most videos, thin webs added in others) and on
microfeature size (0.2 mm here; tiny holes of about 0.5 mm in
https://www.youtube.com/watch?v=boN1uiaIdVA, which can print as separate walls
and form the weak sleeve FDM-STR-10 warns of): 0.2 stays.

### 9.1 Test data from the production source, with caveats

PRACTITIONER, CLAIMED-TEST throughout: PLA unless stated, mostly one specimen
per condition, wall count, layer height and print orientation often not
stated. Read them as trends, never as design values.

Cantilever bending, 20 mm PLA rods loaded 40 mm from the pivot, rectilinear
infill, three tests per density (https://www.youtube.com/watch?v=ZNX7Mzjq_fk):

| Infill | Average break force | Strength per weight (as stated) |
| --- | --- | --- |
| 10% | 71 N | about 9 to 10 |
| 20% | 96 N | about 9 to 10 |
| 30% | 130 N | about 9 to 10 |
| 40% | about 140 N (one break quoted) | 9.9 |
| 50% | 165 N | 9.7 |
| 60% | 175 N | 9.3 |
| 70% | 202 N | 9.6 |
| 80% | 232 N | 9.9 |
| 90% | 330 N | 12.6 |
| 100% | 520 N | 18.8 |

20 percent infill took about 25 percent more print time than 10 percent. The
jump at 90 and 100 percent is the source's hypothesis of better bonding from
overlap and retained heat; it supports the small-part 100 percent exception in
FDM-STR-2 without changing "perimeters before infill" (walls were not varied).

Compression, 30 mm PLA cube on its side, grid infill
(https://www.youtube.com/watch?v=-LHQtlxYQII): about 0.2 kN at 10 percent,
1 kN at 30, 1.7 kN at 40, 3.5 kN at 60, over 6 kN (the load cell's limit) at
70; one specimen each, and the narration's units are partly inconsistent at
50 percent. The source concludes that about 50 percent is the most a part
normally needs, consistent with FDM-STR-2. Its two crush tests of infill
patterns disagree with each other (cubic strongest in
https://www.youtube.com/watch?v=IIS9UagZaWI; grid or triangle "best" in
https://www.youtube.com/watch?v=SEfEicLNAfc, no forces shown): FDM-STR-3's
cubic default stands.

Compression, 40 mm PLA cubes with 0 percent infill
(https://www.youtube.com/watch?v=PQHKQH5imkI): 1 mm wall 70 lb (buckled),
2 mm 384 lb, 3 mm 609 lb, 5 mm over 1,330 lb (load cell limit). The narrator's
newton figures do not match the pounds (70 lb is about 311 N, not the 36 N
stated; 384 lb is about 1,708 N, not 176 N); they look like kilogram-force, so
only the pound values are data and the 4 mm figure is uncertain.

Compression by material, one sample each, geometry not stated
(https://www.youtube.com/watch?v=5CFVcPYFEiE): PLA 530 lb, PETG 485 lb, ABS
472 lb, PA6 nylon 200 lb (moisture state not stated), TPU 47 lb before its
walls buckled. TPU 95A stiffness by infill is in [materials](materials.md)
section 9.

## 10. Accuracy, seams, curved tops (FDM-ACC, FDM-SEAM)

| Id | Rule | Value | Why | Tag | Source |
| --- | --- | --- | --- | --- | --- |
| FDM-ACC-1 | Tuned known printer | plus or minus 0.2 mm (`accuracy.tuned`) | | VENDOR | PRUSA-MODEL |
| FDM-ACC-2 | Unknown desktop printer | plus or minus 0.5 mm or 0.5 percent (`accuracy.unknown`) | | VENDOR (now confirmed: Protolabs prototyping FDM 0.5 percent, 0.5 mm floor) | PROTOLABS-FDM, HUBS-WHAT (SNIPPET) |
| FDM-ACC-3 | Other published values | plus or minus 0.2 small features, 0.5 over 200 mm (Makelab, SNIPPET); 0.3 to 0.5 under 100 mm (Simple Machining); long parts: 0.2 mm for the first inch plus 0.05 mm per further inch (Xometry desktop standard) | | VENDOR | MAKELAB, SIMPLE, XOM-STD |
| FDM-ACC-4 | The base edge and holes are the least accurate features | | Elephant's foot, hole shrink, seams | VENDOR | sections 6, 7 |
| FDM-SEAM-1 | Give cosmetic parts a seam home: a concave vertical corner or groove on a hidden side | | "Nearest" hides seams in concave corners; smooth cylinders have nowhere to hide them; scarf seams help on curves but add time | VENDOR (seam modes), DERIVED (design rule) | PRUSA-SEAM |
| FDM-SEAM-2 | Seams weaken hole precision and may start cracks on round bosses | | | VENDOR (precision), UNVERIFIED (cracks) | BAMBU-HOLE |
| FDM-SEAM-3 | Shallow curved tops terrace; fixes in order: print the curve on its side, replace with facets or chamfers, intentional 1 mm steps, texture, variable layers (about 50 percent slower) | | | PRACTITIONER | SLANT-CURVE, MUSE-CHAMFER |

Expect no better than plus or minus 0.2 mm without post-machining. The
production source's claim that FDM holds below 0.1 mm with enough system
control (https://www.youtube.com/watch?v=FaFY1mIVBvw) is not adopted; its own
other videos give about 0.2 mm.

FDM-SEAM-3, refined: the production source uses texture as its general
cosmetic default rather than finer layers, a CAD texture about 0.2 to 1 mm
deep, or slicer noise. Fuzzy skin changes the part's dimensions, so a print
service may not apply it and it never goes on a mating face; a CAD texture
enlarges the mesh file (PRACTITIONER, https://www.youtube.com/watch?v=f4fJ5AbUF6Q,
https://www.youtube.com/watch?v=FVZ5wAzNAB0,
https://www.youtube.com/watch?v=jIanWhvsWMc). Texture styling belongs to
**cad-style**; the dimension effect is a DFM fact.

## 11. Comparison with other published thresholds

Other tools and guides publish FDM thresholds too. This section compares them
with what the playbook adopts. Named sources: the open-source text-to-cad
project's DFM rule table (https://github.com/earthtojake/text-to-cad/pull/816;
its numbers are "as cited there", UNVERIFIED at their original pages),
ForgeCAD's built-in print check, and this repository's own **enclosure-cad**
and **frame-cad** extensions. Vendor values carry the source keys above. Where
a value is common across DfAM checkers rather than tied to one published
source, it is described as such. The playbook's choice and the reason:

| Topic | Values published elsewhere | Playbook adopts | Why |
| --- | --- | --- | --- |
| Minimum wall | ForgeCAD's built-in print check 1.2 fail / 2.0 warn; enclosure-cad 0.8 (two 0.4 mm extrusions); text-to-cad 0.8 standing, 0.4 lying skin; service guides 1.0 to 1.2 (SIMPLE) and 1.2 to 1.5 (XOM-FDM) | Tiers: under 1 W (0.45) error; 2 W (0.9) structural floor; 3 to 4 W for load; 1.2 for an unknown printer | The values answer different questions ("prints at all" vs "robust"); tiers keep both, as ForgeCAD's check and text-to-cad already do. enclosure-cad's 0.8 is 2 N, within 0.1 mm of 2 W |
| Overhang | 45 deg in every checker and guide compared | 45 deg | Consistent |
| Maximum bridge | HYDRA 10; enclosure-cad 10 (unsupported side-wall cut, assumption); text-to-cad 5 (Hubs, as cited) | 10 design, 5 conservative or cosmetic | Both sourced (Hydra 10, Hubs 5); keep both as tiers |
| Minimum hole | HYDRA, Protolabs and UltiMaker (SNIPPET) 2.0; text-to-cad 1.0 (Xometry, as cited) | 2.0 | The 1.0 value is now confirmed at Xometry (VENDOR) as an industrial roundness floor, not a functional minimum, and is kept only as a labeled alternative |
| M3 screw clearance hole | ISO 273 medium 3.4 (a drilled-hole standard); frame-cad 3.2 (CNC carbon, M3 + 2 x 0.1) | Printed: 3.6 (3.4 + 0.2 diametral print compensation, `screw.clearance.m3`); machined or cut: the process's own value | 3.4 is a drilled-hole standard; a printed hole comes out 0.1 to 0.25 small, so the printed value adds the compensation (DERIVED) |
| Printed fit clearance | enclosure-cad interior gap 0.3; rabbet 0.15 default but 0.1 in its SKILL example (internal inconsistency); twist lid 0.2 radial, 0.15 axial; Sovol sliding per side by material: PLA 0.15 to 0.25, PETG 0.20 to 0.30, ABS and ASA 0.25 to 0.35 (VENDOR) | Sliding 0.2 per side (house), 0.3 per side for an unknown printer, plus the material adjustment | The tested house standard, inside Sovol's PLA range; the enclosure rabbet values do not say per side or total, so read them as per side when reusing, and resolve its 0.1 vs 0.15 by a coupon |
| Heat-set insert hole (M2) | enclosure-cad 3.2 (ruthex and CNC Kitchen nominal) | CAD 3.4 = nominal 3.2 + 0.2 (`insert.m2.hole`) | 3.2 is the finished hole on the datasheet; a printed hole needs the compensation to finish there (CNC Kitchen adds 0.2 to 0.3 in CAD). Aligning the enclosure library is for that extension's maintainers to decide |
| Insert depth | enclosure-cad length + 1.0 (assumption) | length + 1 (`insert.mN.depth`) | Same; now sourced to the CNC Kitchen poster |
| Perimeter count | enclosure-cad max(2, round(wall / 0.45)) | walls in multiples of W = 0.45 | Consistent |
| Support budget | ForgeCAD's built-in print check: 5 percent unsupported overhang area; other DfAM checkers commonly suggest reorienting above a support-volume share (about 30 percent) | No numeric budget: any generated support is a finding to remove by design; supports the decision table allows are recorded | Policy is "avoid"; the two kinds of budget measure different things |
| SLA self-supporting angle | other DfAM checkers commonly use 30 deg from horizontal; text-to-cad 19 deg (confirmed at Xometry Europe as 19 deg from vertical, VENDOR) | Plan supports for SLA (see [other processes](other-processes.md)) | Resin needs supports for most geometry regardless |

## 12. Common mistakes, mapped to rules

1. Walls under 1 W, such as 0.2 mm on a 0.4 mm nozzle (FDM-WALL-6, section 1.1).
2. Walls between whole multiples of W in load paths (FDM-WALL-2).
3. Fillets on downward-facing or bed edges (FDM-OVH-4, FDM-BED-2).
4. Flat-topped horizontal holes; counterbores floating over air (FDM-OVH-6, -8).
5. Exact-size holes and pins; too few facets (FDM-HOLE-1 to -4).
6. Loads that pull layers apart; screw holes through layer lines; upright pins in bending (FDM-ORI-1, -5, -7).
7. Raising infill instead of perimeters (FDM-STR-1).
8. Bridges over 10 mm; overhangs past 45 deg without a plan (FDM-BRG-2, FDM-OVH-1).
9. Text or detail on the first layer; sharp corners on big footprints (FDM-BED-3, -5).
10. Edge or point contact with the bed after rotating (FDM-SUP-6).
11. Molding conventions (draft, thin ribbed shells) copied into prints (FDM-STR-4).
12. Layer height over 0.5 N for structural parts (FDM-ORI-4).
13. Modeled threads under M5 or in horizontal holes ([hardware](hardware.md)).
14. Gaps under 0.5 mm meant to stay open (FDM-FEAT-3).
15. Shallow domes and smooth cylinders on cosmetic faces (FDM-SEAM-1, -3).
16. Expecting better than plus or minus 0.2 mm (FDM-ACC-1).
17. Sharp modeled points and knife edges (FDM-WALL-9).
18. Generated supports where a designed one would do, or a designed one
    scaled with the part (FDM-SUP-8 to -10).
19. A single reinforcing slit through a hole's center plane (FDM-ORI-13).
20. Screw heads clamping infill (FDM-STR-12).
21. Islands that start in mid-air, and through-cut decorative patterns
    (FDM-OVH-11, FDM-FEAT-8).

## 13. Production-farm positions recorded but not adopted

The production source (one print farm,
`docs/specs/dfm-research/10-slant-3d-videos.md`) is looser than the playbook
on these; the playbook keeps its value and records the source's figure as its
stated position or a production alternative:

| Topic | Source's position | Playbook keeps | Why |
| --- | --- | --- | --- |
| Overhang before supports | its service supports past 50 deg; 30 to 60 deg elsewhere, axis mostly unstated | 45 deg (FDM-OVH-1) | Multi-source vendor value; the source contradicts itself |
| Bridge span | 25 to 50 mm "readily" | 10 mm design, 5 mm cosmetic (FDM-BRG-1, -2) | Vendor values; the source's figure is an unmeasured claim |
| Text height | 3 mm minimum on a side wall | 5 mm (FDM-TXT-3) | Production alternative only, after coupon C26 |
| Text on the bed face | one layer deep, connected glyphs | never on the first layer (FDM-TXT-7, FDM-BED-5) | Islands and cosmetic risk on any printer |
| Layer height for strong parts | 0.3 mm on a 0.4 mm nozzle | at most 0.5 N (FDM-ORI-4) | MEASURED: standing hooks at 0.3 held half the load |
| Gap between two halves printed together | 0.1 mm | `feature.min.gap` 0.5, print in place 0.35 per side | At 0.1 the halves fuse |
| Insert boss wall | 1 to 2 mm | the insert datasheet wall; 3.6 mm for a full-strength M5 | VENDOR and MEASURED values |
| Bed contact | as small as possible | a large flat face down on one printer (SKILL step 2) | Different mode: [production runs](production-runs.md) |

