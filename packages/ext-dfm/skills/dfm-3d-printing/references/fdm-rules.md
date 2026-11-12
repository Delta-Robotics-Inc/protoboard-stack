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

**Adopted:** 10 mm for hidden or internal bridges; 5 mm on cosmetic or mating
faces and for an unknown printer. Bambu's data sheets list 30 mm for PLA and
PETG and 20 mm for TPU (VENDOR, see [materials](materials.md)); treat those as
best case.

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

Elephant's foot range: 0.3 mm (Hydra) is the smallest chamfer that hides the
lip; 1 mm (Slant 3D) is robust against machine variation. **Adopted:** 0.5 mm
on the house default machine, 1 mm for an unknown printer, and always a chamfer, never
a fillet. A mating face on the bed gets the chamfer whatever the cosmetic
preference ([fits](fits-and-clearances.md)).

Quantified warp versus footprint size: no measured study found (UNVERIFIED).
A flat ABS, ASA or PC plate over about 100 mm on an open printer is high risk
(UNVERIFIED heuristic from research lane 03).

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
| FDM-HOLE-8 | Pilot holes as a fraction of size: tap 90 percent of major diameter; self-tapping screw 96 percent; heat-set insert 98 percent of insert OD | | | VENDOR (SNIPPET in lane 04) | HYDRA |
| FDM-HOLE-9 | Fit-tolerant features instead of exact diameters: 1 to 2 deg tapered pin, split compliant pin, lead-in chamfer, crush ribs, grip fins (about 1 mm, slightly under the shaft, undercut slot gap 0.3 mm minimum and 0.5 mm maximum, `fitfeature.compliant.gap.min`, `.max`) | | Fit survives printer variation; under 0.3 some CAD or STL tools close the slot, over 0.5 the feature deforms | PRACTITIONER | SLANT-MASS, SLANT-HOLES, SLANT-TOL |
| FDM-PIN-1 | Minimum pin diameter | 1.8 mm | 4 W (`pin.min.diameter`) | At least two full perimeters form | VENDOR | HYDRA |
| FDM-PIN-2 | Pins under 5 mm are perimeters only: base fillet | | | VENDOR | HUBS-FDM |

A composite formula (shrink percent + slicer compensation + 0.10 mm for
vertical holes) seen in a search excerpt is UNVERIFIED and not used
(https://tools.creative3dp.com/blog/3d-printed-holes-too-small/).

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
| FDM-TXT-1 | Embossed stroke width | 0.9 mm | 2 W (`text.min.stroke`) | | VENDOR | HYDRA |
| FDM-TXT-2 | Engraved stroke width | 0.5 mm | constant | | VENDOR | HYDRA, HLH (SNIPPET) |
| FDM-TXT-3 | Character height, bold sans-serif | 5 mm | constant (`text.min.height`) | Calculator: about 4.5 mm bold, 6 mm regular at N 0.4 (stroke times 5.6 to 6); Xometry Europe 5 recommended, 3.5 capability | DERIVED | TEXTCALC (SNIPPET), HYDRA, XOM-EU |
| FDM-TXT-4 | Raised height | 0.6 mm; at least 1.0 mm on an industrial FDM order | 3 L (`text.emboss.height`) | Industrial FDM prints 0.254 mm layers | DERIVED | TEXTCALC (SNIPPET); HLH 0.3 mm min (SNIPPET); UNIONFAB 0.5 mm; XOM-FDM 0.5 minimum, 1.0 industrial; Protolabs 0.3048 all processes |
| FDM-TXT-5 | Engraved depth | 0.8 mm; at least 1.0 mm on an industrial FDM order | 4 L (`text.engrave.depth`) | | DERIVED | TEXTCALC (SNIPPET); HLH 0.5 mm min (SNIPPET); XOM-FDM |
| FDM-TXT-6 | On vertical faces: embossed at most about 0.9 mm out, engraved under 0.9 mm deep | | Larger features sag | VENDOR | HYDRA |
| FDM-TXT-7 | Text on vertical walls or top faces, never on the first layer | | | PRACTITIONER | SLANT-MASS |

Other text guides range from 3 mm height with a 0.8 mm stroke to 5 to 6 mm
raised (VENDOR, SNIPPET). The nozzle-relative formula halves every value at a
0.2 mm nozzle.

## 9. Strength (FDM-STR)

| Id | Rule | Value | Why | Tag | Source |
| --- | --- | --- | --- | --- | --- |
| FDM-STR-1 | Add perimeters before infill | 6 perimeters at 15 percent infill matched 2 perimeters at 100 percent; at equal mass a thicker shell always beat more infill (PETG, bending) | Bending stress peaks at the outer fibers | MEASURED | CNCK-INFILL, MWL-INFILL |
| FDM-STR-2 | Practical ceiling for strong parts | about 4 perimeters and 50 percent infill; CNC Kitchen's functional default is 3 perimeters, 30 percent (`perimeters.structural` = 3); infill 15 to 20 percent, rarely over 30 (exceptions: large flat parts, corrugated walls). Small, thin or detailed parts may use 100 percent infill | 100 percent infill is uneconomical on large parts | MEASURED, PRACTITIONER | CNCK-INFILL, MWL-INFILL; MAKER-HACKS (small-part exception, PRACTITIONER) |
| FDM-STR-3 | Infill pattern at 30 percent: triangular 60 kg, honeycomb 57, grid 52, rectilinear 48, wiggle 45 (PLA hooks). Alternative at equal mass: cubic strongest by a clear margin, gyroid third; lightning, Hilbert, Archimedean chords and octagram unsuitable for load; honeycomb, gyroid and similar print about a third slower | Default to cubic or adaptive cubic | The ranking depends on the comparison: equal percentage (CNC Kitchen) vs equal mass (Made with Layers, PETG, one geometry) | MEASURED | CNCK-INFILL, MWL-INFILL |
| FDM-STR-4 | Design solid shapes and let the slicer fill them; do not copy molding-style thin shells with ribs and draft | | Ribs remove a wall and weaken a printed part; no draft needed | PRACTITIONER | SLANT-MASS |
| FDM-STR-5 | Ribs, where used: whole multiples of W, at least 2 W, in the XY plane | | Strands along the load | DERIVED | research lane 01 section 9 (no FDM rib ratio source; molding ratios do not transfer) |
| FDM-STR-6 | Fillet internal corners in XY (at least 1 mm); chamfer downward-facing internal corners | | Stress relief without overhang | VENDOR | HYDRA, HUBS-FDM |
| FDM-STR-7 | Top skin at least about 0.9 mm (3 layers at 0.3, 9 at 0.1) | 0.9 mm | Prusa profiles always use at least 2 perimeters | VENDOR | PRUSA-LAYERS |
| FDM-STR-8 | A plate thinner than top plus bottom skin (about 1.6 to 2 mm) prints solid | | | DERIVED | PRUSA-LAYERS |
| FDM-STR-9 | Gradient infill: about 30 percent more stiffness per weight | | | MEASURED (SNIPPET) | https://www.cnckitchen.com/blog/gradient-infill-for-3d-prints |
| FDM-STR-10 | Microfeatures: cut slots, holes or ribs about 0.2 mm wide into the model to force fused extra perimeters | 0.2 mm at N 0.4; if wide enough to print as two walls they make a weak sleeve | Designs strength in independent of slicer settings; ribs tested best | PRACTITIONER | SLANT-MICRO |

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

Expect no better than plus or minus 0.2 mm without post-machining.

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
