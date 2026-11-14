# 10 - Slant 3D videos: a production print farm's design advice

Research record for the FDM playbook (`packages/ext-dfm/skills/dfm-3d-printing/`)
from the Slant 3D YouTube channel, accessed 2026-11-12. Slant 3D runs a large
FDM print farm with automated part ejection and sells mass-production printing
and a print-on-demand service; its videos give opinionated design advice for
that kind of production. What the playbook adopted is in its references,
chiefly `references/production-runs.md`; this file records everything found,
how it was weighed, and what was not adopted.

Tags: **PRACTITIONER** (every item: one practitioner's advice), **CLAIMED-TEST**
(the video shows or describes a comparison print or a load test, usually one
print per variant and no published data), **OPINION** (a preference or a
business claim), **CAPTION** (a number reconstructed from context because the
auto-captions dropped a leading decimal or garbled the figure). Labels against
the playbook as it stood before this pass: **NEW**, **CONFIRMS** (rule id),
**REFINES** (adds a number, condition or reason), **CONFLICTS** (both values and
which is more conservative). Clearances in these videos are almost never stated
per side or diametral; a "gap" below is a single gap (a slot width or a layer
gap), neither per side nor diametral, unless it says otherwise. Quotes are under
15 words; everything else is paraphrased.

## 1. Scope

| Item | Count |
| --- | --- |
| Non-podcast videos on the channel | 528 |
| Classified by title as design content, maybe, or not design (business, news, promotion) | 182, 132, 214 |
| Read in full from their captions | **234** (172 design, 62 maybe; one maybe video has no speech) |
| Not read | 294 (10 design, 70 maybe, 214 not design) |
| Podcast episodes | 121, **none read** |

The 10 design videos not read: two were already playbook sources before this
pass (https://www.youtube.com/watch?v=9Hp-VRO1hVQ and
https://www.youtube.com/watch?v=vsHpiHhB3RU), two are segments of compilations
that were read, and six were left for a later pass (section 7).

**Caption quality.** All numbers come from auto-generated captions, which
routinely drop leading decimals (a 0.2 mm brim heard as "2 mm", a 0.4 mm nozzle
as "4 mm", a 0.2 to 0.4 mm blade tip as "2 to .4 mm") and sometimes garble a
figure ("4 mm or maybe .5"). Where the context (one layer, one nozzle width, the
same value said clearly elsewhere) makes the meaning plain, the value is given
corrected and tagged CAPTION; it enters the playbook only with status
`unverified` and must be checked against the video or a coupon. Several videos
are live CAD sessions where dimensions appear on screen but are never spoken;
those are recorded as "not stated". The captions carry no timestamps, so items
are located only by video. A few videos were read through an automatic
translation of their caption track; none of their numbers depend on it.

## 2. How the source is weighed

- **One practitioner with a commercial interest.** Slant 3D designs for its own
  automated farm and sells that service. Several rules (small bed contact,
  parts stood on edges, no supports, no multicolor) serve automated ejection
  and labor cost, not adhesion on a single desktop printer. The playbook
  therefore adds these as a separate **production-run mode**
  (`references/production-runs.md`) rather than changing its single-printer
  defaults.
- **Techniques go in; numbers go in as practitioner values.** How to shape a
  feature (a designed support fin, a raft gap, a grip fin) is valuable. Its
  numbers never replace a measured or multi-source value already adopted.
- **Looser than the playbook:** the playbook keeps its value and records the
  source's figure as a production alternative or its stated position (bridges
  of 25 to 50 mm, supports from 50 deg, text down to about 3 mm, engraving
  0.5 mm everywhere, a 0.1 mm gap between halves, insert boss walls of 1 to
  2 mm, 0.3 mm layers on a 0.4 mm nozzle for strong parts).
- **More conservative than the playbook:** recorded as the cautious option and
  adopted where no measured value contradicts it (1.0 mm minimum wall, about
  6 mm landing flat for a peaked part upside down, about 2 mm land for an
  edge-standing part, side-wall emboss and engrave at most 0.5 mm, a 1 mm
  spring floor in its context).
- **Self-contradictions** (section 5) keep the playbook's position.
- **Claims that conflict with measured or sourced data** are listed in section 6
  and not adopted.
- **Status in `profiles/fdm.json`:** `typical` only for a value stated clearly
  in more than one video or agreeing with another cited source; otherwise
  `unverified`. Every CAPTION number is `unverified`.

## 3. Findings by topic

Duplicates across videos are merged; every supporting video is listed. URLs
use the form https://www.youtube.com/watch?v=ID.

### 3.1 Production mode, bed contact and ejection

| Item | Value and condition | Reason | Tags | Label | Videos |
| --- | --- | --- | --- | --- | --- |
| Minimize bed contact for release | production with automated ejection; a large solid first layer sticks like glue and stops the machine | release, ejection, first-layer cosmetics, staining | PRACTITIONER, OPINION | CONFLICTS with SKILL step 2 (large flat face down): mode-dependent, added as production mode | https://www.youtube.com/watch?v=SZwXREFoWKA, https://www.youtube.com/watch?v=1n_R8shlGcs, https://www.youtube.com/watch?v=X8kqMaxwB4M, https://www.youtube.com/watch?v=9ERY20MRJPo, https://www.youtube.com/watch?v=rJZQ3lTIkpw |
| One-layer recess under the bottom | depth one layer (0.2 mm at 0.2 layers); first layer prints as a ring; recessed face shows raster lines | release | PRACTITIONER, CLAIMED-TEST (slicer preview) | NEW | https://www.youtube.com/watch?v=SZwXREFoWKA |
| Deeper bottom pocket with a domed roof | exterior unchanged, no supports; roof domed by a fillet (dialog values not interpretable) | release, looks intentional | PRACTITIONER, CLAIMED-TEST | NEW; the filleted dome conflicts with FDM-OVH-4, so the playbook uses a 45 deg cone roof | https://www.youtube.com/watch?v=SZwXREFoWKA |
| Conical recess, ring-only contact | ring down to 1 mm in PLA (one statement); a lamp used a conical chamfer of about 40 to 50 (unit unclear) | no overhang, sits level despite warp, ejects, no staining | PRACTITIONER, CLAIMED-TEST | NEW | https://www.youtube.com/watch?v=kIFGtNMmxuM, https://www.youtube.com/watch?v=X8kqMaxwB4M, https://www.youtube.com/watch?v=xEjtyA2b5I0, https://www.youtube.com/watch?v=cBVgwIjP02w, https://www.youtube.com/watch?v=PbGnxQifEq0, https://www.youtube.com/watch?v=-gm6hzbAqLk |
| Do not cut contact with a large outer bottom chamfer | | a steep outer chamfer is an overhang that warps | PRACTITIONER | REFINES FDM-BED-2 | https://www.youtube.com/watch?v=SZwXREFoWKA |
| Center of gravity over the contact; symmetric stance | | an asymmetric lean detaches | PRACTITIONER | NEW | https://www.youtube.com/watch?v=9ERY20MRJPo, https://www.youtube.com/watch?v=YMk7EfbemGY |
| Cosmetic holes blind from above | | first layer one region | PRACTITIONER | NEW | https://www.youtube.com/watch?v=X8kqMaxwB4M |
| Flat discs need depth (a dome) | | a flat disc cannot be ejected | PRACTITIONER | NEW | https://www.youtube.com/watch?v=d6bt-QtZhqI |
| Bowls rim down | | uniform layers, no internal support, small contact; top deforms slightly | PRACTITIONER | NEW | https://www.youtube.com/watch?v=rgV_mtfRLB0 |
| Simple first layer, ideally a solid circle; no text; not customer-facing | | auto-ejection and cosmetics | PRACTITIONER | CONFIRMS FDM-BED-5 | https://www.youtube.com/watch?v=iiCsQIN_PyQ, https://www.youtube.com/watch?v=1n_R8shlGcs, https://www.youtube.com/watch?v=X8kqMaxwB4M |
| Model production-critical features in CAD: brims, ears, rafts, textures, supports | generic settings at the farm, control stays with the designer | repeatability | PRACTITIONER, OPINION | NEW (extends FDM-HOLE-3's policy) | https://www.youtube.com/watch?v=rszX16LFW3U |
| Service baseline settings, stated aloud | 0.2 mm layers, 1 mm walls, 25 percent infill, supports past 50 deg, no brim; first layer 0.3 mm (CAPTION reading) | what a part must print on | PRACTITIONER | NEW; closes the sources gap of a settings table published as an image; the 50 deg threshold CONFLICTS with FDM-OVH-1 | https://www.youtube.com/watch?v=f4fJ5AbUF6Q |
| Fuzzy skin cannot be forced by a service | it changes dimensions | | PRACTITIONER | NEW | https://www.youtube.com/watch?v=f4fJ5AbUF6Q |
| Lay the model flat in the slicer | a model not flat grows stray supports | | PRACTITIONER | NEW (related to FDM-ORI-9) | https://www.youtube.com/watch?v=sZZyOd1iYcM |
| One part per bed; design for no brim, skirt or raft | raft only when bottom dimensions must be exact | | PRACTITIONER, OPINION | REFINES SKILL step 8 | https://www.youtube.com/watch?v=qpo4WsEeYJo |
| Moving-bed printers shake tall, thin or heavy parts and small pads loose | | | PRACTITIONER, OPINION | NEW | https://www.youtube.com/watch?v=iWHBH_T-xqI, https://www.youtube.com/watch?v=8TIhkxQNINY, https://www.youtube.com/watch?v=3Acks3Wzjjo |
| Production size sweet spot | about 25 to 50 mm, up to fist size | cost | PRACTITIONER, OPINION | NEW (context) | https://www.youtube.com/watch?v=ZE2fM1YIvGM |

### 3.2 Brims, rafts and mouse ears modeled in CAD

| Item | Value and condition | Reason | Tags | Label | Videos |
| --- | --- | --- | --- | --- | --- |
| Brim one first layer thick | 0.2 mm, at most 0.3; about 1 mm is treated as part of the part by a service | removability | PRACTITIONER (CAPTION in one video) | NEW | https://www.youtube.com/watch?v=4GxZXxNraY0, https://www.youtube.com/watch?v=3AZWuVRUh2c |
| Brim shape | a circle beats a square; an outer ring touching the extremities cuts trimming | no peel corners; labor | PRACTITIONER | NEW | same |
| Break chamfer where the brim joins | 0.5 mm on the part's bottom edge | brim attaches inboard, guides the blade, no lip | PRACTITIONER | REFINES FDM-BED-2 (same 0.5) | same |
| A modeled brim prints as one continuous first layer | | grips better than loops plus raster | PRACTITIONER, OPINION | NEW | same |
| Brim thick away from the part, thin at the joint | not dimensioned | pops off | PRACTITIONER | NEW | same |
| Label scrap | REMOVE on brims, SUPPORT on supports | operators know what to cut | PRACTITIONER | REFINES FDM-SUP-5 ("R") | https://www.youtube.com/watch?v=4GxZXxNraY0, https://www.youtube.com/watch?v=3AZWuVRUh2c, https://www.youtube.com/watch?v=4wRKmcWXEkw |
| Mouse ears one layer thick, as a sprue | 0.2 mm disc tied to the corner tip by a short neck, close to the corner | one snip; a long neck stretches and the corner lifts | PRACTITIONER | REFINES FDM-BED-7 | https://www.youtube.com/watch?v=MCcFMDv_4eo, https://www.youtube.com/watch?v=f4fJ5AbUF6Q |
| Raft gap | 0.2 mm (one layer at 0.2 layers), slightly less for more grip; 0.1 fuses and slicers may fill it; 0.15 for a tighter hold; matte filament 0.15, glossy PLA and PETG 0.2; claimed universal at a 0.4 mm nozzle | release | PRACTITIONER, CLAIMED-TEST (0.1 vs 0.2) | NEW | https://www.youtube.com/watch?v=4LTkVb6rP84, https://www.youtube.com/watch?v=7KVh19WpOcc, https://www.youtube.com/watch?v=3AZWuVRUh2c |
| Raft gap for loose batch release | 0.2 to 0.3 mm (CAPTION) | | PRACTITIONER | NEW, unverified | https://www.youtube.com/watch?v=ZpmiK0aY9VM |
| Raft thickness and outline | 1 mm, solid, round or a circle; thicker resists warp | | PRACTITIONER | NEW | https://www.youtube.com/watch?v=4LTkVb6rP84, https://www.youtube.com/watch?v=ZpmiK0aY9VM, https://www.youtube.com/watch?v=7KVh19WpOcc |
| Tie the part to the raft | 1 mm struts or 1 mm pins at the corners, snipped | corners cannot lift | PRACTITIONER, CLAIMED-TEST | NEW | https://www.youtube.com/watch?v=7KVh19WpOcc, https://www.youtube.com/watch?v=4LTkVb6rP84, https://www.youtube.com/watch?v=3AZWuVRUh2c |
| Break the raft's shrink streaks | a central disc recessed one layer (CAPTION in one video), an X cut, or slots under the raft | only the rim grips; helps ejection; slots suit high-warp materials | PRACTITIONER, CLAIMED-TEST | NEW | https://www.youtube.com/watch?v=7KVh19WpOcc, https://www.youtube.com/watch?v=4LTkVb6rP84, https://www.youtube.com/watch?v=3AZWuVRUh2c |
| Raft as a Z datum | bed leveling can move part height by about 0.25 mm; raft bottom is the B-side | | PRACTITIONER | NEW | https://www.youtube.com/watch?v=4LTkVb6rP84 |
| Raft as a kit card | outlines, numbers, QR code, assembly order; ejects as one unit | | PRACTITIONER | NEW | https://www.youtube.com/watch?v=ZpmiK0aY9VM, https://www.youtube.com/watch?v=4LTkVb6rP84 |
| Raft cheaper than a brim | no trimming labor | | OPINION | NEW | https://www.youtube.com/watch?v=4LTkVb6rP84 |
| Hemisphere raft interface | contact size garbled ("4 mm or maybe .5", CAPTION) | | PRACTITIONER | NEW, not used | https://www.youtube.com/watch?v=7KVh19WpOcc, https://www.youtube.com/watch?v=3AZWuVRUh2c |
| Solid back plate as a raft under a see-through mechanism | about 1 mm | simple first layer | PRACTITIONER | NEW | https://www.youtube.com/watch?v=O33g62Kwq9s |
| Tiny compliant tabs linking small parts on the bed | | succeed or fail together | PRACTITIONER | NEW | https://www.youtube.com/watch?v=BWsUk1xSSn4 |

### 3.3 Designed supports

| Item | Value and condition | Reason | Tags | Label | Videos |
| --- | --- | --- | --- | --- | --- |
| Never leave production supports to the slicer | design them in CAD | same result on any slicer | PRACTITIONER, OPINION | CONFIRMS FDM-SUP-1, -5 | https://www.youtube.com/watch?v=4wRKmcWXEkw, https://www.youtube.com/watch?v=6DkCCOc5O1Y, https://www.youtube.com/watch?v=WYQbxIVLz6Y, https://www.youtube.com/watch?v=3WyRaZF5Dig, https://www.youtube.com/watch?v=wTuWXqdfJ7s |
| Tines lie flat in the layer plane | one continuous extrusion through tine and part; tines perpendicular to the face are one-layer islands that break and leave balls | | PRACTITIONER, CLAIMED-TEST | CONFIRMS FDM-SUP-5 with the reason | https://www.youtube.com/watch?v=vnn4XeKQobs, https://www.youtube.com/watch?v=6gPPAiqSkBc |
| Tine size | about 0.5 thick by 0.5 to 1 wide; one video goes smaller (one layer by 0.4 to 0.8, "about 0.5 by 0.5"); 1 mm tines left visible nubs; 0.5 wide works if the fin is stiffer | | PRACTITIONER, CLAIMED-TEST | REFINES FDM-SUP-5 | https://www.youtube.com/watch?v=vnn4XeKQobs, https://www.youtube.com/watch?v=3VUQd_Tl5x0, https://www.youtube.com/watch?v=3AZWuVRUh2c |
| Fin foot and top | foot a disc or ellipse about 1 mm thick; round the fin top | clean peel, no point to print | PRACTITIONER | REFINES FDM-SUP-5 (1 to 2 mm) | https://www.youtube.com/watch?v=vnn4XeKQobs |
| Fin placement | about five tines, dense near the bed; near an edge or corner, not mid-face; both ends of a long part; merged slightly inboard of corners so nubs cut flush | holds both ends against warp | PRACTITIONER | NEW | https://www.youtube.com/watch?v=vnn4XeKQobs, https://www.youtube.com/watch?v=3VUQd_Tl5x0 |
| A separate fin 0.2 mm from the part holds one direction only | | the part can fall away | PRACTITIONER, CLAIMED-TEST | REFINES FDM-SUP-5 | https://www.youtube.com/watch?v=vnn4XeKQobs |
| Fin parallel to a tilted part | gap 0.5 to 1 mm, horizontal sprues with a break notch near the part | generated supports flex there | PRACTITIONER | REFINES FDM-SUP-5 | https://www.youtube.com/watch?v=8NKVNwVaZU0 |
| Designed support gap | 0.2 mm (cup under a sphere; fin beside a part); 0.3 mm (posts under fan blades); "2 to 3" read as 0.2 to 0.3 (CAPTION); "A3" spacing likely 0.3 (CAPTION) | | PRACTITIONER, CLAIMED-TEST | NEW | https://www.youtube.com/watch?v=m3Cxw-j19bU, https://www.youtube.com/watch?v=vnn4XeKQobs, https://www.youtube.com/watch?v=SWOnmWCi6bY, https://www.youtube.com/watch?v=3AZWuVRUh2c, https://www.youtube.com/watch?v=_R2E8VwyNz0, https://www.youtube.com/watch?v=6gPPAiqSkBc, https://www.youtube.com/watch?v=4wRKmcWXEkw |
| Pointed towers | 0.5 mm contact; snap off, or fall off when tumbled | | PRACTITIONER | REFINES FDM-SUP-5 | https://www.youtube.com/watch?v=B6r8m93MNGQ, https://www.youtube.com/watch?v=Iauvzy5mR90 |
| Thumbtack supports | 1 mm stem (two lines plus room), wide flat head; spherical, multi-spine and comb variants; on non-show faces; sized for a 0.4 mm nozzle, scaled far the slicer stops seeing it | small downward points slicers miss | PRACTITIONER | NEW | https://www.youtube.com/watch?v=YL5lYEXbLDo, https://www.youtube.com/watch?v=3AZWuVRUh2c |
| Mushroom support under a dome | wide cap 0.5 mm or more below the dome top, thin stem | | PRACTITIONER | NEW | https://www.youtube.com/watch?v=udEeJjzEQZI |
| Tapered hollow block | slightly rounded contact, not so round it teeters | less friction | PRACTITIONER | NEW | https://www.youtube.com/watch?v=WYQbxIVLz6Y |
| Support comb for tall thin parts | post close to the part, 1 mm horizontal fingers trimmed to the profile and pushed slightly in, stop below the top; snip with flush cutters | tall thin parts wobble and band | PRACTITIONER | NEW | https://www.youtube.com/watch?v=3Acks3Wzjjo, https://www.youtube.com/watch?v=uCxRJxvsoe0 |
| Removable block in a channel | 0.2 above, 0.2 to 0.3 below; crush hole; chamfered edges; labeled | print-in-place slides, tunnels | PRACTITIONER | NEW | https://www.youtube.com/watch?v=3AZWuVRUh2c, https://www.youtube.com/watch?v=4wRKmcWXEkw |
| Breakaway outrigger fins | one or two thin fins on the back of a tall panel | wobble, Z banding | PRACTITIONER | NEW | https://www.youtube.com/watch?v=DnPu7slvBVk |
| Sprue under a snap tab | 1 mm, can be left to break on first assembly | | PRACTITIONER | REFINES FDM-SUP-5 | https://www.youtube.com/watch?v=6DkCCOc5O1Y |
| Tree supports baked into the mesh | generate thick tree supports in a slicer, export them as part of the model | every printer gets the same support | PRACTITIONER | NEW (workflow) | https://www.youtube.com/watch?v=3AZWuVRUh2c, https://www.youtube.com/watch?v=f4fJ5AbUF6Q |
| Generated supports can use less material on large domes | flatten the inside apex so they release | | OPINION | NEW | https://www.youtube.com/watch?v=udEeJjzEQZI |
| Permanent support rings | thin outer and intermediate rings on a fan | support and stiffen | PRACTITIONER | NEW | https://www.youtube.com/watch?v=SWOnmWCi6bY |
| A part needing a lot of support may not be an FDM part | | | OPINION | NEW | https://www.youtube.com/watch?v=iiCsQIN_PyQ |

### 3.4 Overhangs, edges and fillets

| Item | Value and condition | Reason | Tags | Label | Videos |
| --- | --- | --- | --- | --- | --- |
| Chamfer, never fillet, downward edges; a chamfer is the most manufacturable fix; make it steeper at high volume | | a fillet ends horizontal | PRACTITIONER | CONFIRMS FDM-OVH-4, -5 | https://www.youtube.com/watch?v=FMs-VGAu_PQ, https://www.youtube.com/watch?v=IrvxX0MtGMM, https://www.youtube.com/watch?v=WYQbxIVLz6Y, https://www.youtube.com/watch?v=DnPu7slvBVk, https://www.youtube.com/watch?v=aih9ctXS0uU, https://www.youtube.com/watch?v=aWz1mz4hhu8 |
| Fillet under a ledge only if large and with a rounded tip | | | PRACTITIONER | not adopted (chamfer stays) | https://www.youtube.com/watch?v=FMs-VGAu_PQ |
| Rounded-look bottom edge | a curve meeting the bed at an angle; truncated arcs; internal teeth less than a semicircle | no horizontal start | PRACTITIONER | NEW | https://www.youtube.com/watch?v=IrvxX0MtGMM, https://www.youtube.com/watch?v=m20UPm0TOto, https://www.youtube.com/watch?v=tb1yqVOyAM8 |
| Islands grown from the body | a block joining a chin to a neck replaced its support | islands on supports get knocked off; support islands warp and catch the nozzle | PRACTITIONER, CLAIMED-TEST | NEW | https://www.youtube.com/watch?v=ZgrlGfftm0k |
| Round profiles lying down | octagon (45 deg facets), hex up to about 10 sides with a flat down; a flat cut on a round rod with the tangent "at least 35 deg" (axis unclear); vertical rods only short, chamfered foot | a round on the bed needs a brim and fails often | PRACTITIONER | NEW | https://www.youtube.com/watch?v=WfP-ZOnlFPM, https://www.youtube.com/watch?v=YMk7EfbemGY |
| Dome interiors | pointed or egg-shaped inside, true dome outside | the inside crown drags and strings | PRACTITIONER | NEW | https://www.youtube.com/watch?v=udEeJjzEQZI |
| Sphere on the bed | truncate at about the 60 deg latitude; or lift it on a thin pin or a cup support; a slightly egg-shaped body helps a little | tiny unreliable contact, flat spot, shrink ring | PRACTITIONER, CLAIMED-TEST | NEW | https://www.youtube.com/watch?v=m3Cxw-j19bU, https://www.youtube.com/watch?v=Iauvzy5mR90 |
| Thin tabs stay steep | a color change alone flipped a marginal tab | | PRACTITIONER | REFINES FDM-OVH-1 | https://www.youtube.com/watch?v=EoIlALcMJB8 |
| Fillet vertical edges | at least about 1 mm; 3 mm fillets cut a cube's slicer estimate by 4 to 5 min of 2 h 49 min; less ringing; less nozzle catch on worn machines | print time, surface | PRACTITIONER, CLAIMED-TEST (one estimate) | REFINES FDM-BED-4 | https://www.youtube.com/watch?v=C0H_4fOm9CQ, https://www.youtube.com/watch?v=3VUQd_Tl5x0, https://www.youtube.com/watch?v=1n_R8shlGcs, https://www.youtube.com/watch?v=Wd0MR4sPcK0, https://www.youtube.com/watch?v=xEjtyA2b5I0, https://www.youtube.com/watch?v=-gm6hzbAqLk |
| Fillet top edges of a flat-printed part | | walls merge into the top skin | PRACTITIONER | REFINES FDM-FEAT-6 | https://www.youtube.com/watch?v=NaQ_Sa1BaqU |
| Edge breaks at holes | small fillet where a side hole meets its wall; chamfer (better) or 1 mm fillet at a vertical hole's top rim | toolpath ripple, poor loop bonding, tiny holes stay open | PRACTITIONER, CLAIMED-TEST | NEW | https://www.youtube.com/watch?v=Bd7Yyn61XWQ, https://www.youtube.com/watch?v=3BIvSiuQVWQ, https://www.youtube.com/watch?v=aWz1mz4hhu8, https://www.youtube.com/watch?v=DnPu7slvBVk |
| Blunt knife edges and tips | to about one nozzle width, 0.2 to 0.4 mm (CAPTION); tips overheat because the layers below a point cannot cool | flakes break off | PRACTITIONER | NEW | https://www.youtube.com/watch?v=oz51t5p9gXo, https://www.youtube.com/watch?v=Iauvzy5mR90 |
| Features at least one nozzle width | texture features under 0.4 mm print wispy | | PRACTITIONER, CLAIMED-TEST | CONFIRMS FDM-WALL-1 | https://www.youtube.com/watch?v=aWz1mz4hhu8, https://www.youtube.com/watch?v=ZgrlGfftm0k |
| Overhang angles stated | 30 deg as a maximum and a chamfer "minimum of 30" (axis unstated); 35 deg (axis unstated); 45 deg "best"; 60 deg chamfers "generally fine" but risky | | PRACTITIONER | CONFLICTS, self-contradicting; FDM-OVH-1 stands | https://www.youtube.com/watch?v=IrvxX0MtGMM, https://www.youtube.com/watch?v=uCxRJxvsoe0, https://www.youtube.com/watch?v=8NKVNwVaZU0, https://www.youtube.com/watch?v=FMs-VGAu_PQ |
| Overhang chamfers about 35 to 45 deg; side holes chamfered rather than filleted at the entry | | constant step | PRACTITIONER, CLAIMED-TEST | CONFIRMS FDM-OVH-4 | https://www.youtube.com/watch?v=aWz1mz4hhu8 |
| Cooling off curls overhangs into the nozzle | | | PRACTITIONER | CONFIRMS FDM-OVH-3 | https://www.youtube.com/watch?v=ZgrlGfftm0k |

### 3.5 Orientation

| Item | Value and condition | Reason | Tags | Label | Videos |
| --- | --- | --- | --- | --- | --- |
| Box turned 45 deg about one horizontal axis | interior faces all at 45 deg; a chamfered landing ("five", unit not stated, CAPTION-like) on the new base edge | no interior supports, uniform finish, small contact | PRACTITIONER, CLAIMED-TEST (sliced) | NEW | https://www.youtube.com/watch?v=8TIhkxQNINY |
| Boxes diagonal, lids about 35 deg, fin behind | the part's center of mass overhangs the contact | | PRACTITIONER | REFINES FDM-ORI-8 | https://www.youtube.com/watch?v=8NKVNwVaZU0 |
| Maximum strength in every feature at 45 deg | | layers loop through every feature | OPINION | CONFLICTS FDM-ORI-3 (measured 40 vs 63 MPa); not adopted | https://www.youtube.com/watch?v=8NKVNwVaZU0 |
| Enclosures on an edge or corner | a large edge chamfer with a rib behind; corner chamfers about 7 to 10 mm | ejection, finish, build volume | PRACTITIONER, OPINION | NEW (production mode) | https://www.youtube.com/watch?v=lGnpz8q4STw, https://www.youtube.com/watch?v=jNguIjkLo6g, https://www.youtube.com/watch?v=9ERY20MRJPo, https://www.youtube.com/watch?v=31FVZIg4rDs, https://www.youtube.com/watch?v=1n_R8shlGcs |
| Cube on an edge or corner | all faces alike | | PRACTITIONER | NEW | https://www.youtube.com/watch?v=3VUQd_Tl5x0, https://www.youtube.com/watch?v=-gm6hzbAqLk, https://www.youtube.com/watch?v=vnn4XeKQobs |
| Edge-standing land | about 2 mm wide chamfer (a failed print without it shown) | | PRACTITIONER, CLAIMED-TEST | CONFLICTS FDM-SUP-6 (about 1 mm); the source is more conservative; adopted as the cautious option | https://www.youtube.com/watch?v=vnn4XeKQobs, https://www.youtube.com/watch?v=ip70-Tw6tBE, https://www.youtube.com/watch?v=6gPPAiqSkBc |
| Peaked part on a cropped apex | flat strip about 1/4 in (6 mm) | stands upside down | PRACTITIONER | CONFLICTS FDM-SUP-6; source more conservative; adopted unverified | https://www.youtube.com/watch?v=reIXSlL6mKA |
| Three-way bracket on a cropped corner | | layers loop around the joint | PRACTITIONER | REFINES FDM-ORI-8 | https://www.youtube.com/watch?v=csUGcIPNNkk |
| Brackets: layers loop around the screw holes; standing on end is best if it does not topple | | | PRACTITIONER | REFINES FDM-ORI-2 | https://www.youtube.com/watch?v=NLeTvSaPJIs |
| Tilted parting plane for enclosure halves | 35 to 45 deg or subtler; or a dog-leg cut | both halves get the same texture, no supports | PRACTITIONER | NEW | https://www.youtube.com/watch?v=W5WdUF4Y_FI |
| Parting line below the ports | shift so cutouts are in one half | | PRACTITIONER | NEW | https://www.youtube.com/watch?v=31FVZIg4rDs |
| Seam-thin bed contact on a side-printed part | sharp chamfers to a seam about 1/8 in (3 mm; one video spoke it unclearly) | bed face does not mark a show face | PRACTITIONER | NEW | https://www.youtube.com/watch?v=Jps5YPF2iRU, https://www.youtube.com/watch?v=WVTJOAeZLQ8, https://www.youtube.com/watch?v=d6bt-QtZhqI |
| Every face a side wall | no distinct top skin | uniform look | PRACTITIONER | NEW | https://www.youtube.com/watch?v=JuJEnuLlJgk |
| Thin parts in vertical racks | standing on a support comb; needs a bed that does not move front to back | ejection | PRACTITIONER | NEW | https://www.youtube.com/watch?v=uCxRJxvsoe0 |
| Long parts across the bed diagonal | | build volume | PRACTITIONER | NEW | https://www.youtube.com/watch?v=yFUBXBoDT4I |
| Load along the layers | propellers hub down, slats lengthwise, golf tees on the side, plungers flat, hooks on the side, impact punches upright | | PRACTITIONER | CONFIRMS FDM-ORI-2, -10 | https://www.youtube.com/watch?v=SWOnmWCi6bY, https://www.youtube.com/watch?v=bO39lWkaspA, https://www.youtube.com/watch?v=WVTJOAeZLQ8, https://www.youtube.com/watch?v=uvnJ9E7_VWA, https://www.youtube.com/watch?v=W45TqjY51Zg, https://www.youtube.com/watch?v=yFUBXBoDT4I, https://www.youtube.com/watch?v=YMk7EfbemGY |
| Angled walls make layers cross the load diagonally | | cracks cross more layers | OPINION (no test) | REFINES FDM-ORI-3 in spirit; not adopted as a number | https://www.youtube.com/watch?v=YMk7EfbemGY |
| Strap slots parallel to the layers | | layers loop around the strap | PRACTITIONER | NEW | https://www.youtube.com/watch?v=lGnpz8q4STw |

### 3.6 Walls, ribs, strength and microfeatures

| Item | Value and condition | Reason | Tags | Label | Videos |
| --- | --- | --- | --- | --- | --- |
| Minimum wall and feature | 1.0 mm in XY at a 0.4 mm nozzle (two lines plus squash); Z down to one layer | | PRACTITIONER | CONFLICTS FDM-WALL-3 (0.9); source more conservative; adopted as `wall.min.cautious` | https://www.youtube.com/watch?v=1n_R8shlGcs, https://www.youtube.com/watch?v=qpo4WsEeYJo, https://www.youtube.com/watch?v=f4fJ5AbUF6Q |
| Thick and solid; no molding shells, draft or ribs; start from a block | | strength in the skin; volume is cheap | PRACTITIONER, OPINION | CONFIRMS FDM-STR-4 | https://www.youtube.com/watch?v=iiCsQIN_PyQ, https://www.youtube.com/watch?v=NaQ_Sa1BaqU, https://www.youtube.com/watch?v=as84ZBjdmxU, https://www.youtube.com/watch?v=AURCtaRrUGM, https://www.youtube.com/watch?v=t122wEA5Aj8, https://www.youtube.com/watch?v=ylqsMbUyYs4, https://www.youtube.com/watch?v=p-GuXDxQYkA, https://www.youtube.com/watch?v=F3ViXSLH_ZM, https://www.youtube.com/watch?v=uvnJ9E7_VWA, https://www.youtube.com/watch?v=MiCRp2uV1MM |
| Cavities do not lighten a print | they add walls, time and surface; enclosed cavities can force walls where stiffness is wanted | | PRACTITIONER | CONFIRMS FDM-STR-4; REFINES FDM-STR-10 | https://www.youtube.com/watch?v=AURCtaRrUGM |
| Self-supporting ribs | triangular, chamfered or rounded underside; diagonal layout; cross members shorten shelves | | PRACTITIONER | REFINES FDM-STR-5 | https://www.youtube.com/watch?v=8vz9b0zNMVg |
| Shear web on an upright arm; small rib at a hinge flange | | stops a snap across layers | PRACTITIONER, CLAIMED-TEST | NEW | https://www.youtube.com/watch?v=GDEMxa4WdRw, https://www.youtube.com/watch?v=SiGoPAGXuKM, https://www.youtube.com/watch?v=boN1uiaIdVA |
| Blend a 90 deg bracket junction with a big chamfer or loft | | layer-line breaks | PRACTITIONER, CLAIMED-TEST | REFINES FDM-STR-6 | https://www.youtube.com/watch?v=as84ZBjdmxU, https://www.youtube.com/watch?v=qDcskdl16UM |
| Truss as internal slots | 0.2 mm slots in the truss pattern inside a solid block, very low infill | | PRACTITIONER | CONFIRMS FDM-STR-10 | https://www.youtube.com/watch?v=OcxfQeeKn-s |
| Microfeature width | about 0.2 mm (one video "2 mm" and "4 mm", CAPTION); 0.1 to 0.2 because slicers close gaps near 0.05; wide enough for two walls makes a sleeve | | PRACTITIONER, CLAIMED-TEST | REFINES FDM-STR-10 | https://www.youtube.com/watch?v=Lq-SoGgKOcQ, https://www.youtube.com/watch?v=ip70-Tw6tBE, https://www.youtube.com/watch?v=81qmDc5unYM, https://www.youtube.com/watch?v=iiCsQIN_PyQ |
| Microfeatures around a hole | ring of small holes or a hexagonal slot about 2 mm from the hole wall; start 1 to 2 mm below the top; never a full ring slot (isolates a loose cylinder); slot depth sets the induced wall | | PRACTITIONER | REFINES FDM-STR-10 | https://www.youtube.com/watch?v=3BIvSiuQVWQ, https://www.youtube.com/watch?v=ip70-Tw6tBE, https://www.youtube.com/watch?v=Lq-SoGgKOcQ |
| Ribbed rod about 3 times a plain rod with a 1 mm wall | load case: cantilever; material and count not stated | | CLAIMED-TEST | REFINES FDM-STR-10 | https://www.youtube.com/watch?v=Lq-SoGgKOcQ, https://www.youtube.com/watch?v=81qmDc5unYM |
| Molded section redesigned for print at equal mass | rounded, material away from the neutral axis; claimed near molded strength (masses quoted inconsistently, no load test) | | PRACTITIONER | REFINES FDM-STR-4 | https://www.youtube.com/watch?v=p-GuXDxQYkA |
| Screw heads clamp solid material | counterbore: example 5 mm hole, 15 mm counterbore, 6 mm web with 1 to 2 mm skins; or a 2 mm back wall "basically solid" | cracks start where walls are backed by infill | PRACTITIONER | NEW | https://www.youtube.com/watch?v=Wd0MR4sPcK0, https://www.youtube.com/watch?v=YMk7EfbemGY |
| Strength in the skin, infill a core | | | PRACTITIONER, OPINION | CONFIRMS FDM-STR-1 | https://www.youtube.com/watch?v=NaQ_Sa1BaqU, https://www.youtube.com/watch?v=SiGoPAGXuKM |
| Corrugated walls stiffen vase-mode parts and rings without infill | | | PRACTITIONER, CLAIMED-TEST | REFINES FDM-STR-2 | https://www.youtube.com/watch?v=d6bt-QtZhqI, https://www.youtube.com/watch?v=y9EBTua_lss, https://www.youtube.com/watch?v=mHRQkreuuDA |
| Very low infill for cosmetic bulk | 3 to 5 percent in lightly loaded chunky bodies | | PRACTITIONER | CONFLICTS FDM-STR-2 (15 to 20); fine only for cosmetic bulk | https://www.youtube.com/watch?v=Jps5YPF2iRU, https://www.youtube.com/watch?v=WVTJOAeZLQ8 |
| Variable infill for ballast | dense in the tip or base, sparse elsewhere | | PRACTITIONER | NEW | https://www.youtube.com/watch?v=O33g62Kwq9s, https://www.youtube.com/watch?v=VUjzKhgDdzk |
| Check walls after scaling down | | | PRACTITIONER | CONFIRMS FDM-WALL | https://www.youtube.com/watch?v=Iauvzy5mR90 |

### 3.7 Test data (all CLAIMED-TEST, mostly one specimen)

| Test | Result | Caveats | Videos |
| --- | --- | --- | --- |
| Infill vs cantilever strength, 20 mm PLA rods loaded 40 mm out, rectilinear, three per density | 10% 71 N, 20% 96, 30% 130, 40% about 140, 50% 165, 60% 175, 70% 202, 80% 232, 90% 330, 100% 520; strength per weight about constant (9 to 10) to 80 percent, then 12.6 and 18.8 | walls, layer and orientation not stated; the narration's "infill barely matters below 100 percent" contradicts the table (3.3 times from 10 to 80) | https://www.youtube.com/watch?v=ZNX7Mzjq_fk |
| Infill vs compression, 30 mm PLA cube on its side, grid | about 0.2 kN at 10%, 1 at 30, 1.7 at 40, 3.5 at 60, over 6 (sensor limit) at 70; conclusion: about 50 percent is the most normally needed | one specimen each; units partly inconsistent at 50 percent | https://www.youtube.com/watch?v=-LHQtlxYQII |
| Infill pattern crush, 20 percent | cubic strongest by a clear margin; lines and gyroid fail progressively | no forces given | https://www.youtube.com/watch?v=IIS9UagZaWI |
| Infill pattern crush, 25 percent | grid or triangle "best and most reliable"; hexagon strong then catastrophic | no forces; contradicts the cubic result | https://www.youtube.com/watch?v=SEfEicLNAfc |
| Wall thickness vs compression, 40 mm PLA cubes, no infill | 1 mm 70 lb (buckled), 2 mm 384 lb, 3 mm 609 lb, 5 mm over 1,330 lb (limit) | the narrator's newtons are wrong (70 lb is about 311 N, not 36; 384 lb about 1,708 N, not 176): they look like kilogram-force; pound values only; 4 mm uncertain | https://www.youtube.com/watch?v=PQHKQH5imkI |
| Compression by material | PLA 530 lb, PETG 485, ABS 472, PA6 nylon 200 (conversion about 5 percent off), TPU 47 before buckling | one sample each, geometry and settings not stated, nylon moisture unknown | https://www.youtube.com/watch?v=5CFVcPYFEiE |
| TPU 95A cubes vs infill, 30 mm, compression | 10% plateau 40 to 60 N, 20% about 150 N, 30% 400 to 600 N, 50% about 2,000 N, 100% barely deforms at 6,000 N; recovers | walls not stated, one per density | https://www.youtube.com/watch?v=3gxsLZITN2c |
| Impact and abrasion in a blender | PLA shattered; PETG and ABS broke into strandy shards; TPU held together best; nylon held up but shattered | qualitative | https://www.youtube.com/watch?v=rYjZvSz2O_M |
| Fillets and print time | 3 mm vertical fillets saved 4 to 5 min of 2 h 49 min | one slicer estimate | https://www.youtube.com/watch?v=C0H_4fOm9CQ |
| Molding vs printing quote | section 3.15 | two real quotes for one part | https://www.youtube.com/watch?v=t0mCGcM2w7g |

### 3.8 Warping, shrink lines and the first layer

| Item | Value and condition | Reason | Tags | Label | Videos |
| --- | --- | --- | --- | --- | --- |
| Shrink and the longest streak | about 1 percent (0.1 mm over 10 mm, 1 mm over 100 mm); the longest continuous streak drives warp | | PRACTITIONER | REFINES FDM-BED-6; the 1 percent is the source's figure, not adopted over the calculator table | https://www.youtube.com/watch?v=iPZoDltS30A |
| Checkerboard relief under a base | slits about 0.5 mm into the base (wording garbled, CAPTION) at about 25 mm (1 in) pitch, first layer continuous; smaller cells safer | | PRACTITIONER, CLAIMED-TEST | NEW (partly closes the warping gap) | https://www.youtube.com/watch?v=iPZoDltS30A |
| Ripple or bow long walls | ripples about 1 mm or finer; slits up walls weaken (cosmetic only) | slack absorbs shrink | PRACTITIONER, CLAIMED-TEST | NEW | https://www.youtube.com/watch?v=iPZoDltS30A |
| Internal cavities at corners | break long infill lines | gyroid pulls less (OPINION) | PRACTITIONER | NEW | https://www.youtube.com/watch?v=iPZoDltS30A |
| Round footprint corners | as large as allowed; 5 to 10 mm better than 1 mm; ideally a circle | | PRACTITIONER | CONFIRMS FDM-BED-3 | https://www.youtube.com/watch?v=iPZoDltS30A, https://www.youtube.com/watch?v=X8kqMaxwB4M |
| Shrink line fix | groove about 1 mm deep around the inside of a thick floor where it meets the wall; texture the outside; thicker walls and a central cutout did nothing; a raised grid must be continuous | | PRACTITIONER, CLAIMED-TEST (one print each) | REFINES FDM-BRG-6 | https://www.youtube.com/watch?v=d61u_lKFa-U, https://www.youtube.com/watch?v=cdyqNocFCpQ |
| Tie first-layer islands | small sprues into one ring; 0.3 mm connectors back to the body for spring tips | islands knocked over or lift | PRACTITIONER | NEW | https://www.youtube.com/watch?v=SSHoQLuVJFk, https://www.youtube.com/watch?v=rsfZgT3ZEI8, https://www.youtube.com/watch?v=Iauvzy5mR90 |
| Mouse ear on a tendril tip | | | PRACTITIONER | CONFIRMS FDM-BED-7 | https://www.youtube.com/watch?v=f4fJ5AbUF6Q, https://www.youtube.com/watch?v=fsCu2GKvoWI |
| ABS on an open bed with these measures | | | OPINION, no data | not adopted | https://www.youtube.com/watch?v=iPZoDltS30A |
| Bed edges: chamfer 1 mm; or 0.5 with a brim | | elephant's foot | PRACTITIONER | CONFIRMS FDM-BED-2 | https://www.youtube.com/watch?v=f4fJ5AbUF6Q, https://www.youtube.com/watch?v=-gm6hzbAqLk, https://www.youtube.com/watch?v=aih9ctXS0uU, https://www.youtube.com/watch?v=4GxZXxNraY0 |

### 3.9 Holes and pins

| Item | Value and condition | Reason | Tags | Label | Videos |
| --- | --- | --- | --- | --- | --- |
| Horizontal holes: pointed top, teardrop or hex | the teardrop "adds slop at the top" in one video; a shallow peak in others | top sag | PRACTITIONER | CONFIRMS FDM-OVH-6 | https://www.youtube.com/watch?v=Bd7Yyn61XWQ, https://www.youtube.com/watch?v=Iyxp_Rjz3wo, https://www.youtube.com/watch?v=ip70-Tw6tBE, https://www.youtube.com/watch?v=aWz1mz4hhu8 |
| Side holes printed diagonally | the loops encircle the hole, no flat roof | rounder, cannot split | PRACTITIONER, CLAIMED-TEST | REFINES fits section 4 | https://www.youtube.com/watch?v=ip70-Tw6tBE |
| Side holes modeled slightly tall | amount not stated | sag | PRACTITIONER | REFINES FDM-OVH-7 | https://www.youtube.com/watch?v=sza8wg5FIxQ |
| Hole reinforcement slits | 0.1 to 0.2 mm disc cuts at mid-thickness; or 0.2 mm planes off-center and angled; never one plane through the center | the slicer fills them with walls; a center plane acts as a zipper | PRACTITIONER | REFINES FDM-ORI-6 | https://www.youtube.com/watch?v=UfJIMn4nvsA, https://www.youtube.com/watch?v=ip70-Tw6tBE, https://www.youtube.com/watch?v=81qmDc5unYM |
| Other hole fixes | threads in the hole, a local boss, raised rings, struts beside the hole | each lengthens contact around the hole | PRACTITIONER | NEW | https://www.youtube.com/watch?v=UfJIMn4nvsA |
| Proud ridges inside a screw hole; relief slits (they admit dirt) | | | PRACTITIONER | CONFIRMS hardware section 6 | https://www.youtube.com/watch?v=3BIvSiuQVWQ |
| Wrinkled hole wall | radial cutouts force the wall thicker | | PRACTITIONER | REFINES FDM-STR-10 | https://www.youtube.com/watch?v=3BIvSiuQVWQ |
| Vertical pins | hole about 0.25 mm larger, up to 0.5 for high shrink (per side or total not stated); funnel fillet at the mouth; fatter, short, filleted base, round tip; cross section or wrinkled outline with 0.2 mm internal slots; slight taper | | PRACTITIONER | CONFIRMS FDM-ORI-7, REFINES | https://www.youtube.com/watch?v=uMA-Wt-z_BU |
| Horizontal pins | keyhole pin chamfered top and bottom, fit on the sides; tapered tab in a slot; two offset tabs; split tab | XY is accurate | PRACTITIONER | NEW | https://www.youtube.com/watch?v=Iyxp_Rjz3wo |
| Small horizontal holes hold size better than large; square holes bridge until the bridge gets long | | | PRACTITIONER, CLAIMED-TEST | CONFIRMS FDM-HOLE-7 | https://www.youtube.com/watch?v=aWz1mz4hhu8 |
| Model the hole; drilling is a secondary process | | | PRACTITIONER | CONFIRMS | https://www.youtube.com/watch?v=Iauvzy5mR90 |

### 3.10 Fits, grip fins, lids, locating features and joints

| Item | Value and condition | Reason | Tags | Label | Videos |
| --- | --- | --- | --- | --- | --- |
| Grip fins instead of friction fits | | expansion, tuning, flow and temperature vary; printed parts interlock their layers | PRACTITIONER | CONFIRMS FDM-HOLE-9 | https://www.youtube.com/watch?v=yzg_NXM-NRs, https://www.youtube.com/watch?v=7SY4Vd8Gb80, https://www.youtube.com/watch?v=1n_R8shlGcs |
| Fins free-cut along their length; a disc cut under the roots | | stiffen with depth and bind otherwise | PRACTITIONER | REFINES hardware section 7 | https://www.youtube.com/watch?v=yzg_NXM-NRs, https://www.youtube.com/watch?v=6gPPAiqSkBc |
| Chamfered fin starts above the first layer | | thin fin footprints delaminate; funnel lead-in | PRACTITIONER | REFINES | https://www.youtube.com/watch?v=yzg_NXM-NRs |
| Trapezoid fins higher up | | self-supporting | PRACTITIONER | REFINES | https://www.youtube.com/watch?v=yzg_NXM-NRs |
| Thinner or longer is softer | longer adds slop and cocking; thinner adds fatigue risk; fewer fins stiffer; absorb 0.1 to 0.2 mm; work for inserts | | PRACTITIONER | REFINES | https://www.youtube.com/watch?v=yzg_NXM-NRs, https://www.youtube.com/watch?v=3BIvSiuQVWQ, https://www.youtube.com/watch?v=6gPPAiqSkBc |
| Fin material | PETG and ABS preferred; PLA flexes less (another video: PLA flexes enough) | | PRACTITIONER, OPINION | NEW | https://www.youtube.com/watch?v=yzg_NXM-NRs, https://www.youtube.com/watch?v=GRlX27WgySQ |
| Undercut gap behind fins | 0.3 minimum, 0.5 maximum; 0.2 above and below side-hole fins in one video; under 0.2 mesh repair may close gaps | | PRACTITIONER, CLAIMED-TEST | CONFIRMS `fitfeature.compliant.gap.*`; the 0.2 not adopted | https://www.youtube.com/watch?v=XKrDUnZCmQQ, https://www.youtube.com/watch?v=IZKh6lo9SP4, https://www.youtube.com/watch?v=3BIvSiuQVWQ, https://www.youtube.com/watch?v=ip70-Tw6tBE, https://www.youtube.com/watch?v=m3Cxw-j19bU |
| Grip-fin interference example | 12 mm rod, fin inner diameter 11 mm: 0.5 per side, 1.0 diametral | | PRACTITIONER | REFINES FDM-HOLE-9; large, unverified, coupon C24 | https://www.youtube.com/watch?v=Bd7Yyn61XWQ |
| Studs as teardrops with grip fins, 10 percent over nominal | | constant force, no wear | PRACTITIONER, CLAIMED-TEST | REFINES FDM-HOLE-9 | https://www.youtube.com/watch?v=7SY4Vd8Gb80 |
| Bought molded parts vary | by molder and fill; fins sized to a pull-out spec (1 to 2 lb) | in-house fit failed at the customer | PRACTITIONER, field experience | REFINES FDM-HOLE-9 | https://www.youtube.com/watch?v=PbGnxQifEq0, https://www.youtube.com/watch?v=cBVgwIjP02w |
| Grip fins creep little | each deflects little | | OPINION | NEW | https://www.youtube.com/watch?v=XKrDUnZCmQQ |
| Locating fins in slots instead of pins; cone pins for pure locators ("within 30 degrees", axis unstated); at most two locators; one fin can be enough | example fins 7 mm deep on a 40 mm block; slot clearance not stated | pins break on layers and need enlarged holes | PRACTITIONER | NEW | https://www.youtube.com/watch?v=xog9YlMt9UU |
| Fewest fasteners | one screw where the mating part constrains; two screws plus locators on a lid | | PRACTITIONER, OPINION | NEW | https://www.youtube.com/watch?v=Wd0MR4sPcK0, https://www.youtube.com/watch?v=YMk7EfbemGY, https://www.youtube.com/watch?v=31FVZIg4rDs |
| Lid lips | thin lip holds size, solid lip shrank more; slight taper; star lip; reduce contact with holes or nubs; U-shaped spring thumbs; latches travel about 2 mm and the bridge over a latch can sag and jam | | PRACTITIONER, CLAIMED-TEST | REFINES fits section 9 | https://www.youtube.com/watch?v=XKrDUnZCmQQ, https://www.youtube.com/watch?v=IZKh6lo9SP4 |
| Press-on and plug lids | lead-in chamfer, slight taper, internal ripples; amount not stated | coarse layers interlock | PRACTITIONER | REFINES | https://www.youtube.com/watch?v=7YAylxQFe3k |
| Joints | sprung T-slot entered at an angle; round slot; twin tongues with bumps; S-clip in symmetric slots; C-clip; diamond pegs; slab and slot with a tapered lead | | PRACTITIONER | NEW, CONFIRMS fits section 9 | https://www.youtube.com/watch?v=RTQjvYENR7w, https://www.youtube.com/watch?v=djm5tCFn9S0 |
| Loose housing for a bought box | about 1 mm per side; leave more room on a first design | | PRACTITIONER | CONFIRMS the drop-in tray value | https://www.youtube.com/watch?v=Wd0MR4sPcK0, https://www.youtube.com/watch?v=xEjtyA2b5I0 |
| Two halves printed upright about 0.1 mm apart | an idea, not shown | | OPINION | CONFLICTS `feature.min.gap` (0.5); not adopted | https://www.youtube.com/watch?v=31FVZIg4rDs |
| Drawer printed with its case | upright, bottom chamfer keeps them apart; no gap stated; shipping sprue | | PRACTITIONER | NEW | https://www.youtube.com/watch?v=cdyqNocFCpQ, https://www.youtube.com/watch?v=CpQGNRWWXs8 |
| Leaf-spring retention | one printed leaf spring tensions a row of bits; a sprung socket grips varying shafts | | PRACTITIONER | REFINES FDM-HOLE-9 | https://www.youtube.com/watch?v=-Ryo2uWkC4I, https://www.youtube.com/watch?v=qXHjM_L3vi0 |
| Wider tolerances lower long-run cost | no secondary inspection | | PRACTITIONER, OPINION | NEW | https://www.youtube.com/watch?v=GRlX27WgySQ |

### 3.11 Snaps, hinges, springs and flexures

| Item | Value and condition | Reason | Tags | Label | Videos |
| --- | --- | --- | --- | --- | --- |
| Snap tabs and clips flex in the layer plane | a molding cantilever printed upright splits | | PRACTITIONER, CLAIMED-TEST | CONFIRMS FDM-ORI-11 | https://www.youtube.com/watch?v=rsfZgT3ZEI8, https://www.youtube.com/watch?v=6DkCCOc5O1Y, https://www.youtube.com/watch?v=0mti_RY2WnA, https://www.youtube.com/watch?v=cbtVDk3R6XI |
| Ring with clips | printed on its side with clips at 45 deg to horizontal; or tilted; chamfered clip roots move the flex to the ring | | PRACTITIONER | REFINES FDM-ORI-11 | https://www.youtube.com/watch?v=_y8Yvu1FQIE, https://www.youtube.com/watch?v=81qmDc5unYM |
| Leaf-spring snaps | horizontal leaf springs; symmetric pair; progressive detents in slots; four-way snap rotated so every flange is in plane | | PRACTITIONER | NEW | https://www.youtube.com/watch?v=rsfZgT3ZEI8 |
| Chamfering under a snap finger stiffens it | retune the flex | | PRACTITIONER | REFINES | https://www.youtube.com/watch?v=FF4D_Moywgk |
| Single-loop snap rooted inside the block | loop 0.5 to 1 mm, rooted about 1 cm in | longer, softer, no root crack | PRACTITIONER | NEW | https://www.youtube.com/watch?v=EoIlALcMJB8 |
| Compliant hinges | notch hinge fatigues in a few PLA cycles; leaf, arch, serpentine spread strain; spring back to the as-printed angle; symmetric double hinge; leaf 0.5 minimum, 1.0 stiffer, taper 1 to 0.5 | | PRACTITIONER, CLAIMED-TEST | CONFIRMS `flexure.leaf.*`; NEW rest angle | https://www.youtube.com/watch?v=YG_8wYoxVfs |
| Living hinge types | thin flap only in TPU or PP, printed on its side; loop hinge; grooved loop; zigzag chain; kerf lattice designed to the bend radius | | PRACTITIONER | NEW | https://www.youtube.com/watch?v=TiEyFle6lTM, https://www.youtube.com/watch?v=AAKsl8zW-Ds, https://www.youtube.com/watch?v=BWsUk1xSSn4 |
| PLA sheet hinge kinks; use PETG or a long loop | | | PRACTITIONER | CONFIRMS materials section 5 | https://www.youtube.com/watch?v=BWsUk1xSSn4, https://www.youtube.com/watch?v=31FVZIg4rDs |
| Print-in-place pin hinges | pin in the layer plane when flat; cone and double cones (about 2 mm) when upright, with fixes for a sagging upper knuckle; axle vertical smooth but torsion-weak, horizontal strong but oval and rough; chunky knuckles | | PRACTITIONER | NEW | https://www.youtube.com/watch?v=BWsUk1xSSn4, https://www.youtube.com/watch?v=AAKsl8zW-Ds, https://www.youtube.com/watch?v=TiEyFle6lTM |
| Peaked or chamfered ceilings in print-in-place gaps | | sag jams motion | PRACTITIONER | REFINES hardware section 9 | https://www.youtube.com/watch?v=4wRKmcWXEkw, https://www.youtube.com/watch?v=cdyqNocFCpQ |
| Offset fold pivot about 1 cm so halves fold parallel | | | PRACTITIONER | NEW | https://www.youtube.com/watch?v=GDEMxa4WdRw, https://www.youtube.com/watch?v=SiGoPAGXuKM |
| Print-in-place works at any layer, infill and material | 0.1 to 0.3 or 0.12 to 0.3 mm layers | | OPINION | CONFLICTS the measured printer dependence; not adopted | https://www.youtube.com/watch?v=AAKsl8zW-Ds, https://www.youtube.com/watch?v=BWsUk1xSSn4 |
| Print-in-place raises reject rate; clips vary by machine | | | PRACTITIONER, OPINION | NEW | https://www.youtube.com/watch?v=TiEyFle6lTM, https://www.youtube.com/watch?v=d6bt-QtZhqI |
| Planar springs | no coil springs; planar zigzag with rounded bends; about 1 mm for soft; thicker in Z for force; membrane and spiral springs; force in the layer plane; printable inside a part | layers split; stress at square bends | PRACTITIONER | NEW; the 1 mm floor differs from the 0.5 mm leaf by application | https://www.youtube.com/watch?v=wpriGP45Unw, https://www.youtube.com/watch?v=AAKsl8zW-Ds, https://www.youtube.com/watch?v=4wRKmcWXEkw |
| Flat mechanisms scale by thickness | rippled fins act thicker | | PRACTITIONER | NEW | https://www.youtube.com/watch?v=O33g62Kwq9s |
| In-plane flexing resists crack growth | | | OPINION | not adopted | https://www.youtube.com/watch?v=cbtVDk3R6XI |
| Mechanical latches over compliant ones, which wear | | | OPINION | NEW | https://www.youtube.com/watch?v=-Ryo2uWkC4I |

### 3.12 Hardware: nuts, inserts, magnets, screws, threads

| Item | Value and condition | Reason | Tags | Label | Videos |
| --- | --- | --- | --- | --- | --- |
| Magnet paired with steel | a ball bearing or a screw head on one side | half the magnets, no polarity errors | PRACTITIONER | NEW | https://www.youtube.com/watch?v=BwUzOJ8B_H0 |
| Press-fit discs in PLA creep loose; cylinders (2 x 9 mm) hold | | sidewall friction, lead-in tip | PRACTITIONER | REFINES hardware section 4 | https://www.youtube.com/watch?v=BwUzOJ8B_H0 |
| Side-entry magnet past center | axis 0.5 to 1 mm below the face, small fillet, slightly loose to self-orient; sphere magnets in a free cavity; sliding pairs angled; cover plug | | PRACTITIONER | REFINES hardware section 4 | https://www.youtube.com/watch?v=BwUzOJ8B_H0 |
| Pause embedding costs pull | 0.5 mm skin each side, 1 mm gap | | PRACTITIONER | CONFIRMS the cover-vs-pull data | https://www.youtube.com/watch?v=BwUzOJ8B_H0 |
| No pauses | idle printer, resume line, contamination, rattle; a 10 minute part waits hours | | PRACTITIONER, OPINION | REFINES hardware section 5 | https://www.youtube.com/watch?v=WMbmDfGEygk, https://www.youtube.com/watch?v=F3ViXSLH_ZM, https://www.youtube.com/watch?v=d0BGz4nRjus |
| Captive nut dropped into an internal channel | narrow top slot, channel about nut size, settles about 2 mm below the face, the screw draws it up | no pause | PRACTITIONER | NEW | https://www.youtube.com/watch?v=WMbmDfGEygk |
| Nuts loaded from the back with a jig; side slot with friction lock; halves capturing the nut on hex pegs | | | PRACTITIONER | NEW | https://www.youtube.com/watch?v=WMbmDfGEygk, https://www.youtube.com/watch?v=F3ViXSLH_ZM |
| Side nut slot is a crack starter | | | PRACTITIONER | CONFIRMS hardware section 3 | https://www.youtube.com/watch?v=WMbmDfGEygk |
| Embedded nut beats a heat-set insert | | | OPINION | CONFIRMS in direction (measured 166 vs 119 kg) | https://www.youtube.com/watch?v=WMbmDfGEygk, https://www.youtube.com/watch?v=sza8wg5FIxQ |
| Insert boss wall | about 1 to 2 mm in a nearly solid part | | PRACTITIONER | CONFLICTS from M4 up (poster 2.1 to 4.5; full-strength M5 3.6); playbook kept | https://www.youtube.com/watch?v=sza8wg5FIxQ |
| Screw hole wall from the top | at least 1 mm | | PRACTITIONER | CONFLICTS boss OD 2 to 2.5 d (unverified); playbook kept | https://www.youtube.com/watch?v=sza8wg5FIxQ |
| Collar around mounting holes | about 2 mm more material | breakout, vibration fatigue | PRACTITIONER | REFINES FDM-ORI-6 | https://www.youtube.com/watch?v=lGnpz8q4STw, https://www.youtube.com/watch?v=4wRKmcWXEkw |
| 1 mm fillet at a hole's top rim as an insert lead-in | | | PRACTITIONER, CLAIMED-TEST | CONFLICTS the 0.3 to 0.5 lead-in cap; playbook kept | https://www.youtube.com/watch?v=aWz1mz4hhu8 |
| Large screws | M10 needs an undersize hole that splits, one use; relief slats | | PRACTITIONER | CONFIRMS hardware section 6 | https://www.youtube.com/watch?v=WMbmDfGEygk |
| Heat-set insert for a premium metal-mating thread | | plastic threads strip and wear | PRACTITIONER | CONFIRMS hardware section 10 | https://www.youtube.com/watch?v=F3ViXSLH_ZM |
| Thread size floor | modeled threads under about 1/8 in fastener do not print; side-hole threads cut flat top and bottom; fine ripples for small screws | | PRACTITIONER | CONFIRMS `thread.min.modeled`, hardware section 10 | https://www.youtube.com/watch?v=sza8wg5FIxQ, https://www.youtube.com/watch?v=ip70-Tw6tBE, https://www.youtube.com/watch?v=csUGcIPNNkk |
| Thread profile | triangular, about 45 deg flanks; overhangs under 30 deg from horizontal unreliable | | PRACTITIONER | CONFLICTS mildly with trapezoidal or buttress (unverified); both kept, coupon | https://www.youtube.com/watch?v=7YAylxQFe3k |
| Thumb screws flat with a cropped side | layers along the axis | | PRACTITIONER | REFINES hardware section 10 (relevant to C20) | https://www.youtube.com/watch?v=csUGcIPNNkk |
| Printed threads in backstopped compression | threads only retain | | PRACTITIONER | REFINES hardware section 10 | https://www.youtube.com/watch?v=Lmr4LKI0Hfc |
| Small printed threads in a knob base | size not stated | | PRACTITIONER | CONFLICTS `thread.min.modeled` if under M5; playbook kept | https://www.youtube.com/watch?v=qXHjM_L3vi0 |
| Weight by capsule | a cavity with a threaded, filled capsule; or a void for a bought jar | | PRACTITIONER | NEW | https://www.youtube.com/watch?v=d0BGz4nRjus |
| Metal wear face | an embedded bolt as a striking face | | PRACTITIONER | NEW | https://www.youtube.com/watch?v=qDcskdl16UM |

### 3.13 Glue

| Item | Value and condition | Tags | Label | Videos |
| --- | --- | --- | --- | --- |
| Glue injected after assembly | entry hole, central bore, exit holes along the joint; more for long pegs | PRACTITIONER | NEW | https://www.youtube.com/watch?v=Nsv3YSTDYmA |
| Spiral indicator groove | glue climbs the spiral and shows at the top when full | PRACTITIONER | NEW | https://www.youtube.com/watch?v=Nsv3YSTDYmA |
| Glue columns as rebar across layers | untested | PRACTITIONER | NEW, not adopted as strength | https://www.youtube.com/watch?v=Nsv3YSTDYmA |
| Grooves on a glued peg | more area | PRACTITIONER | REFINES fits section 9 | https://www.youtube.com/watch?v=Nsv3YSTDYmA |
| Many small undercut pits; relief cuts; marked glue pads; hot-glue bead channel; internal channel for glue or thread locker | | PRACTITIONER | CONFIRMS and REFINES fits section 9 | https://www.youtube.com/watch?v=qV1xXXbzM4Y |
| Glue is a secondary process; prefer built-in retention | | OPINION | NEW | https://www.youtube.com/watch?v=xEjtyA2b5I0, https://www.youtube.com/watch?v=BwUzOJ8B_H0 |

### 3.14 Text, texture and color

| Item | Value and condition | Reason | Tags | Label | Videos |
| --- | --- | --- | --- | --- | --- |
| Side walls are the best place for text | a side wall resolves one layer (0.2), a top or bottom face one nozzle width (0.4, CAPTION "4 mm") | twice as crisp | PRACTITIONER | REFINES FDM-TXT-7 | https://www.youtube.com/watch?v=upf9ixYtDG4, https://www.youtube.com/watch?v=TH82TSjI67I, https://www.youtube.com/watch?v=0mti_RY2WnA |
| Side-wall emboss | at most 0.5 mm; 1 mm sagged; 0.5 to 0.75 in one video | | PRACTITIONER, CLAIMED-TEST | CONFLICTS FDM-TXT-4, -6 (0.6, 0.9); source more conservative; adopted on vertical faces | https://www.youtube.com/watch?v=upf9ixYtDG4, https://www.youtube.com/watch?v=TH82TSjI67I, https://www.youtube.com/watch?v=aWz1mz4hhu8, https://www.youtube.com/watch?v=DnPu7slvBVk |
| Side-wall engrave | 0.25 to 0.5, never deeper; about 0.5, not shallower; 0.5 to 1 at most in one video | deeper made defects | PRACTITIONER, CLAIMED-TEST | CONFLICTS FDM-TXT-5 (0.8); adopted on vertical faces | https://www.youtube.com/watch?v=upf9ixYtDG4, https://www.youtube.com/watch?v=TH82TSjI67I, https://www.youtube.com/watch?v=aWz1mz4hhu8, https://www.youtube.com/watch?v=0mti_RY2WnA |
| Text height | 3 mm minimum on a side wall, 4 to 5 preferred; 1/8 in minimum; about 1 mm illegible; 2 mm on a top face unreadable | | PRACTITIONER, CLAIMED-TEST | CONFLICTS FDM-TXT-3 (5 mm); playbook kept, 3 mm a production alternative | https://www.youtube.com/watch?v=upf9ixYtDG4, https://www.youtube.com/watch?v=aWz1mz4hhu8, https://www.youtube.com/watch?v=TH82TSjI67I |
| Stroke | 0.5 to 1 mm, never under 0.5; bold fonts | | PRACTITIONER | CONFIRMS FDM-TXT-1, -2 | https://www.youtube.com/watch?v=TH82TSjI67I |
| Top-face text | engrave, not emboss | islands, retractions, stringing | PRACTITIONER | REFINES FDM-TXT-7 | https://www.youtube.com/watch?v=upf9ixYtDG4, https://www.youtube.com/watch?v=TH82TSjI67I |
| Bottom-face text or logo | engrave one layer (CAPTION "2 mm"), connected glyphs; a logo if one continuous motion; a one-layer logo for contrast | | PRACTITIONER | CONFLICTS FDM-TXT-7, FDM-BED-5; playbook kept | https://www.youtube.com/watch?v=upf9ixYtDG4, https://www.youtube.com/watch?v=-Ryo2uWkC4I, https://www.youtube.com/watch?v=eDgY9_JC7sM |
| Never text on the bottom face | | | PRACTITIONER | CONFIRMS FDM-BED-5 | https://www.youtube.com/watch?v=X8kqMaxwB4M, https://www.youtube.com/watch?v=iiCsQIN_PyQ |
| Contrast without multicolor | textured text floor, a pressed-in text plate, backing paper, a clear sticker; smooth text on a textured face; dark filament | multicolor not scalable | PRACTITIONER, OPINION | NEW | https://www.youtube.com/watch?v=upf9ixYtDG4, https://www.youtube.com/watch?v=DnPu7slvBVk |
| Hidden subsurface text and codes | readable against a light; depth not stated | | PRACTITIONER | NEW | https://www.youtube.com/watch?v=TH82TSjI67I |
| Logo placement | lower rim or back; a logo on a curved face as a watermark | | PRACTITIONER | NEW | https://www.youtube.com/watch?v=upf9ixYtDG4 |
| Texture as the cosmetic default | CAD texture about 0.2 mm (one video) to 0.5 or 1 mm (others) with a solid border about 10 mm; CAD before height map before fuzzy skin; fine patterns hide more but cost time; texture catalog (knurl, diamond plate, hexes, triangles with channels, organic lines, hemispheres) | free in printing, costly in molds | PRACTITIONER, OPINION | REFINES FDM-SEAM-3; styling belongs to cad-style | https://www.youtube.com/watch?v=f4fJ5AbUF6Q, https://www.youtube.com/watch?v=aWz1mz4hhu8, https://www.youtube.com/watch?v=YMk7EfbemGY, https://www.youtube.com/watch?v=jIanWhvsWMc, https://www.youtube.com/watch?v=pUabxkiJAdE, https://www.youtube.com/watch?v=FVZ5wAzNAB0, https://www.youtube.com/watch?v=RAn2FP-d21I, https://www.youtube.com/watch?v=1n_R8shlGcs |
| Relief patterns, not through-cuts; angled vent slots, not hole grids | | islands, weak lines | PRACTITIONER | NEW | https://www.youtube.com/watch?v=31FVZIg4rDs, https://www.youtube.com/watch?v=YMk7EfbemGY, https://www.youtube.com/watch?v=vcgsQyMSSiY |
| One continuous outline per layer | fin and bulb handles over loop handles | | PRACTITIONER | NEW | https://www.youtube.com/watch?v=rUUq4kgi7t4, https://www.youtube.com/watch?v=ofUlxe7GfKI |
| Light colors | white, yellow, light blue show residue, stains and defects and scrap more; white worst | | PRACTITIONER, OPINION | NEW | https://www.youtube.com/watch?v=NaQ_Sa1BaqU, https://www.youtube.com/watch?v=scv4am8kbqs, https://www.youtube.com/watch?v=iiCsQIN_PyQ, https://www.youtube.com/watch?v=m20UPm0TOto |
| Titanium dioxide white | abrasive on brass nozzles, pasty, needs tuned retraction; carbon black much finer (particle size misstated) | | PRACTITIONER | NEW | https://www.youtube.com/watch?v=22p4ThOfEO0, https://www.youtube.com/watch?v=ZgrlGfftm0k |
| Matte looks better but is weaker than gloss | | | PRACTITIONER, OPINION | CONFIRMS materials (Matte weak layers) | https://www.youtube.com/watch?v=scv4am8kbqs |
| 0.2 mm layers default, 0.3 draft or industrial | | | PRACTITIONER | CONFIRMS `layer.height` | https://www.youtube.com/watch?v=FVZ5wAzNAB0, https://www.youtube.com/watch?v=m20UPm0TOto |

### 3.15 Materials

| Item | Value and condition | Tags | Label | Videos |
| --- | --- | --- | --- | --- |
| TPU softness by structure | section 3.7 data; specify a shape and target hardness, tune with samples; impact enclosure 15 to 20 percent base | PRACTITIONER, CLAIMED-TEST | REFINES materials TPU row | https://www.youtube.com/watch?v=3gxsLZITN2c, https://www.youtube.com/watch?v=XtU0p-bdZMo, https://www.youtube.com/watch?v=pZLxi9OaFLg, https://www.youtube.com/watch?v=3WvN8uVnSpU |
| TPU cannot be auto-ejected | removal is manual | PRACTITIONER | NEW | https://www.youtube.com/watch?v=3WvN8uVnSpU |
| PETG overhangs vs bonding | fan cooling for overhangs weakens PETG layer bonds; fewer overhangs | PRACTITIONER | NEW | https://www.youtube.com/watch?v=vE0806yUq7U |
| PETG strings, harder to eject, gloss varies by color | | PRACTITIONER | CONFIRMS, NEW | https://www.youtube.com/watch?v=vE0806yUq7U |
| Color changes flow and expansion | prove fits per color; one robust profile after about 100 iterations | PRACTITIONER | NEW | https://www.youtube.com/watch?v=PbGnxQifEq0, https://www.youtube.com/watch?v=EoIlALcMJB8, https://www.youtube.com/watch?v=upf9ixYtDG4 |
| Spool-to-spool color varies | colorimeter-checked supply or lot control | PRACTITIONER | NEW | https://www.youtube.com/watch?v=DiupjIdI3KQ, https://www.youtube.com/watch?v=uIYkOlyEXJM |
| Carbon fiber wears a brass or plain steel nozzle in about 500 g; fine CF features brittle; grit smooths layer lines | | PRACTITIONER, OPINION | CONFIRMS hardened nozzle; NEW wear figure | https://www.youtube.com/watch?v=0rdIIvhLghw, https://www.youtube.com/watch?v=kQ8FkVi-Kes |
| Abrasive pigment (a green dye) wore a nozzle wide | | PRACTITIONER | NEW | https://www.youtube.com/watch?v=ZgrlGfftm0k |
| UV | PLA fades fast; ABS and PETG fairly resistant; ASA, TPU and some nylons UV-rated | PRACTITIONER | REFINES materials section 4 | https://www.youtube.com/watch?v=nF5k_tmQ7k0 |
| ESD-safe and flame-rated grades for enclosures | | PRACTITIONER | NEW | https://www.youtube.com/watch?v=MiCRp2uV1MM, https://www.youtube.com/watch?v=9ERY20MRJPo, https://www.youtube.com/watch?v=jNguIjkLo6g |
| PLA grades from brittle to tough | grade numbers spoken, unverified | PRACTITIONER | NEW | https://www.youtube.com/watch?v=GRlX27WgySQ |
| PLA not outdoors or in a hot car; PLA brittle in impact; ABS or nylon for striking faces | | PRACTITIONER | CONFIRMS materials section 7 | https://www.youtube.com/watch?v=GRlX27WgySQ, https://www.youtube.com/watch?v=qDcskdl16UM |
| PLA or PETG cheaper to mass-produce than ABS; PETG can stand in for ABS | | PRACTITIONER, OPINION | CONFIRMS ease ranking | https://www.youtube.com/watch?v=0zLWaEarbj4, https://www.youtube.com/watch?v=ELnO2c1nF8U |
| PETG for aquarium parts (inert) | | OPINION | NEW, unverified | https://www.youtube.com/watch?v=tGfErEfxXeA |
| PETG over costly CF nylon for production | | PRACTITIONER, OPINION | NEW | https://www.youtube.com/watch?v=boN1uiaIdVA, https://www.youtube.com/watch?v=SiGoPAGXuKM |
| Food safety decided per product; a food-safe resin does not make a food-safe part; a liner for hot drinks or liquids | | PRACTITIONER | CONFIRMS materials section 4 | https://www.youtube.com/watch?v=g6U5jQXlWU4, https://www.youtube.com/watch?v=vE0806yUq7U, https://www.youtube.com/watch?v=hVPvaLmO8bo, https://www.youtube.com/watch?v=7-LP9UcdAWc |
| Not adopted | food-safe-by-design, lead, outdoor PETG default, CF as aluminum, PETG drop, PLA near hot liquids, PP absorbs water, watertight | | section 6 | |

### 3.16 Enclosures, vents, loops, feet and mounting

| Item | Value and condition | Tags | Label | Videos |
| --- | --- | --- | --- | --- |
| Board standoffs | as thick as the solder points allow; chamfered (never filleted) bases; ribs to the wall; merged into a plate; chunky, shelf-like | PRACTITIONER | NEW | https://www.youtube.com/watch?v=9ERY20MRJPo, https://www.youtube.com/watch?v=31FVZIg4rDs, https://www.youtube.com/watch?v=m20UPm0TOto, https://www.youtube.com/watch?v=jNguIjkLo6g, https://www.youtube.com/watch?v=lGnpz8q4STw |
| Board pocket | a pocket tracing the board's underside leads, extruded to the tallest lead (3 mm example): seats and locates the board | PRACTITIONER | NEW | https://www.youtube.com/watch?v=9ERY20MRJPo |
| Inside corners filleted large | 5 mm example | PRACTITIONER | REFINES FDM-STR-6 | https://www.youtube.com/watch?v=9ERY20MRJPo |
| One negative body for the interior | board pocket, standoffs, holes and split plane subtracted from many outer shells | PRACTITIONER | NEW (CAD practice) | https://www.youtube.com/watch?v=mV-FWHjlwBk, https://www.youtube.com/watch?v=KbKeCcvn6_s |
| Rain-shedding vents | offset overlapping slat rows, no line of sight; drain only at the bottom; directional; layers along slats; slats 1.5 mm in the demo, 0.5 suggested (not adopted) | PRACTITIONER, CLAIMED-TEST (spray demo) | NEW | https://www.youtube.com/watch?v=bO39lWkaspA |
| Cooling vents | angled slots through a thickened wall, S-channels, mid ribs; grilles following the layers; no grids of small holes | PRACTITIONER | NEW | https://www.youtube.com/watch?v=vcgsQyMSSiY, https://www.youtube.com/watch?v=m20UPm0TOto |
| Gasketless rain lid | inset groove under an outer lip, a drain channel and corner egress holes; a labyrinth, not a seal | PRACTITIONER, CLAIMED-TEST (demo) | NEW | https://www.youtube.com/watch?v=prMUfQ9y7Rk |
| Feet | print feet-bottom parts on the side or a diagonal; chamfer feet; inset pockets for rubber feet; three small feet | PRACTITIONER | NEW | https://www.youtube.com/watch?v=hSP9CkqhZSQ, https://www.youtube.com/watch?v=31FVZIg4rDs |
| Side loops and zip-tie lugs | a plate as large as possible with a hole, outer rib or T-flange | PRACTITIONER | NEW | https://www.youtube.com/watch?v=m1HG1nBTD0E, https://www.youtube.com/watch?v=81qmDc5unYM |
| Lanyard and cord loops | in the layer plane, or internal channels between flush holes; hanging holes as revolved channels | PRACTITIONER | NEW | https://www.youtube.com/watch?v=oYEV-ndgwdk, https://www.youtube.com/watch?v=Iauvzy5mR90 |
| Wire-retaining loops | two chamfers, front face then inner edge | PRACTITIONER | NEW | https://www.youtube.com/watch?v=FF4D_Moywgk |
| Mounting tabs | chamfered into the wall; monolithic lugs; rounded free tabs; keyholes in the layer plane with chamfered bosses | PRACTITIONER | CONFIRMS FDM-OVH-5, NEW lug | https://www.youtube.com/watch?v=FF4D_Moywgk, https://www.youtube.com/watch?v=lGnpz8q4STw, https://www.youtube.com/watch?v=SSHoQLuVJFk |
| DIN-rail and extrusion features integrated; brackets wrapping an extrusion | | PRACTITIONER | NEW | https://www.youtube.com/watch?v=lGnpz8q4STw, https://www.youtube.com/watch?v=NLeTvSaPJIs |
| Adhesive strips | pockets as deep as the strip; pads forward so pull is direct | PRACTITIONER | NEW | https://www.youtube.com/watch?v=tb1yqVOyAM8 |
| Cord exits | hook-shaped one-way slot, 5.5 mm for a 5 mm cord | PRACTITIONER | NEW | https://www.youtube.com/watch?v=xEjtyA2b5I0 |
| Slots over round cutouts | flexible, rounded ends | PRACTITIONER | NEW | https://www.youtube.com/watch?v=Wd0MR4sPcK0 |
| Lamp shades | shell about 1 mm for light; standard profile, not vase mode; thicken or chamfer a flat top; 2 mm inner sleeves for an opaque base | PRACTITIONER, CLAIMED-TEST | NEW | https://www.youtube.com/watch?v=4WIfbKN-vkg |
| Watertight parts | a tuned profile; several perimeters on a sealing wall; no overhangs or support interfaces; fist size for pressure | PRACTITIONER, OPINION | method only; general claim not adopted | https://www.youtube.com/watch?v=Yk0I4Tf-E8c, https://www.youtube.com/watch?v=cbxD8Oz9L8Q |
| A liner or bladder for liquids | | PRACTITIONER | REFINES hardware section 12 | https://www.youtube.com/watch?v=7-LP9UcdAWc, https://www.youtube.com/watch?v=hVPvaLmO8bo |
| Thick sections resist UV | | OPINION | not adopted | https://www.youtube.com/watch?v=SSHoQLuVJFk |

### 3.17 Production consistency, quality, consolidation and cost

| Item | Value and condition | Tags | Label | Videos |
| --- | --- | --- | --- | --- |
| Consistency | one machine model, controlled suppliers, a climate-controlled room | PRACTITIONER | NEW | https://www.youtube.com/watch?v=wuoF0xLxZcM |
| Quality checklist | per part, agreed with the customer: cosmetics, surface, tolerances, strength; sampling per batch or machine; checks for warp (a disc slid under), shift, under-extrusion, color, staining; a written standard | PRACTITIONER | NEW | https://www.youtube.com/watch?v=vpKJZOfMO0c, https://www.youtube.com/watch?v=qD0vnoo5kh0, https://www.youtube.com/watch?v=wuoF0xLxZcM, https://www.youtube.com/watch?v=PbGnxQifEq0 |
| Reject rate | mass production needs about 1 in 10,000; the farm says it is not there yet; poka-yoke assemblies | PRACTITIONER | NEW | https://www.youtube.com/watch?v=9JC8KOVKoIE |
| Sample production first | order samples, write measurable requirements, run a sample batch | PRACTITIONER | CONFIRMS SKILL steps 11, 12 | https://www.youtube.com/watch?v=6pO9gcTnSb0, https://www.youtube.com/watch?v=sQflKQHDGsI, https://www.youtube.com/watch?v=EWFushoVoc4, https://www.youtube.com/watch?v=f4fJ5AbUF6Q |
| Redesign for printing, never print a molded design | | PRACTITIONER | CONFIRMS FDM-STR-4 | https://www.youtube.com/watch?v=6pO9gcTnSb0, https://www.youtube.com/watch?v=7MujrVzznRY, https://www.youtube.com/watch?v=rKCWJj4E2gg, https://www.youtube.com/watch?v=F9k8MFvd-5g, https://www.youtube.com/watch?v=aV2tv7GJ1-s |
| Part consolidation | 5 molded parts and 2 screws to 2; 6 to 1; about 35 to 55 to under 20; clamp halves and pin to 1; 3 printed to 1; brackets on one rod; internal ledges and channels | PRACTITIONER | NEW | https://www.youtube.com/watch?v=uvnJ9E7_VWA, https://www.youtube.com/watch?v=BTIoITF3P8U, https://www.youtube.com/watch?v=plzcdgsNn4M, https://www.youtube.com/watch?v=u52ypRRQV3c, https://www.youtube.com/watch?v=cbtVDk3R6XI, https://www.youtube.com/watch?v=boN1uiaIdVA, https://www.youtube.com/watch?v=KbKeCcvn6_s, https://www.youtube.com/watch?v=VUjzKhgDdzk, https://www.youtube.com/watch?v=B6r8m93MNGQ |
| Keep a few bought parts | about two distinct items; where they add value | PRACTITIONER | NEW | https://www.youtube.com/watch?v=9qe-_ClObaw, https://www.youtube.com/watch?v=cBVgwIjP02w, https://www.youtube.com/watch?v=Jps5YPF2iRU, https://www.youtube.com/watch?v=EoIlALcMJB8 |
| Labor dominates cost | support removal and cleanup, not machine time or material | PRACTITIONER | CONFIRMS FDM-SUP-1 | https://www.youtube.com/watch?v=MCcFMDv_4eo, https://www.youtube.com/watch?v=FaFY1mIVBvw, https://www.youtube.com/watch?v=0zLWaEarbj4 |
| Cost-driven geometry | chamfer the first layer, minimize surface area and size, lower infill; near a sphere is cheapest | PRACTITIONER, OPINION | NEW | https://www.youtube.com/watch?v=AQKGvPmz0eQ, https://www.youtube.com/watch?v=Iauvzy5mR90 |
| The quoted cost case | 50 mm PLA cube, two real quotes: at 500 units molding 13 USD, printing 5.12; at 10,000 molding 1.42 (tool included, near 1 at 100,000), printing 1.55; 5,700 USD per mold change, 150 USD print setup | CLAIMED-TEST | NEW (context for the dfm process choice) | https://www.youtube.com/watch?v=t0mCGcM2w7g |
| Illustrative per-part cost model | part price plus tool amortization, freight, warehousing (2 to 10 USD per month per item) and unsold stock (10 to 25 percent) | OPINION | NEW (context) | https://www.youtube.com/watch?v=qhxlT4hIm94 |
| Monthly batches over one lot | utilization, per-batch QC, design changes between batches | PRACTITIONER, OPINION | NEW (supply) | https://www.youtube.com/watch?v=5GnzmeDFNGk, https://www.youtube.com/watch?v=t0mCGcM2w7g, https://www.youtube.com/watch?v=bgHToGAuU4E |
| Break-even with molding | about 100,000; 100,000 to 250,000; 10 to 25 percent dearer per part at 10,000; "cheaper forever" for a small cube | OPINION | self-contradicting; not adopted | https://www.youtube.com/watch?v=FaFY1mIVBvw, https://www.youtube.com/watch?v=CbdLP8wiJ6M, https://www.youtube.com/watch?v=rKCWJj4E2gg, https://www.youtube.com/watch?v=ZE2fM1YIvGM |
| Mesh integrity | a detached region on a clean print means a mesh defect; zero-thickness features drop out | PRACTITIONER | NEW, CONFIRMS FDM-WALL-6 | https://www.youtube.com/watch?v=ZgrlGfftm0k |

## 4. Conflicts with the playbook

| Topic | Source value | Playbook value (rule id or profile path) | More conservative | Decision |
| --- | --- | --- | --- | --- |
| Bridge span | 25 to 50 mm "readily"; vent slots supported past about 25 mm | 10 mm design, 5 mm cosmetic (FDM-BRG-1, -2; `bridge.max.span`, `bridge.conservative.span`) | playbook | keep; recorded as the source's stated position |
| Supports generated from | 50 deg (service setting) | 45 deg (FDM-OVH-1, `overhang.max.angle`) | playbook | keep |
| Text height | 3 mm on a side wall (1/8 in) | 5 mm (FDM-TXT-3, `text.min.height`) | playbook | keep; 3 mm a production alternative after C26 |
| Engraved text on a vertical face | about 0.5, never deeper | 0.8 (FDM-TXT-5, `text.engrave.depth`); under 0.9 on vertical (FDM-TXT-6) | source on vertical faces | adopt on vertical faces (`text.sidewall.engrave.max`); 0.8 stays on top faces |
| Raised text on a vertical face | at most 0.5 | 0.6 (FDM-TXT-4, `text.emboss.height`); up to 0.9 (FDM-TXT-6) | source | adopt on vertical faces (`text.sidewall.emboss.max`) |
| Text or logo on the bed face | one layer deep, connected | never (FDM-TXT-7, FDM-BED-5) | playbook | keep |
| Minimum wall | 1.0 mm | 0.9 (FDM-WALL-3, `wall.structural`) | source | add `wall.min.cautious` for production runs; 0.9 stays the single-printer floor |
| Edge-standing land | about 2 mm | about 1 mm (FDM-SUP-6) | source | add `landing.edge.width` (cautious) |
| Peaked part, apex land | about 6 mm | about 1 mm (FDM-SUP-6) | source | add `landing.apex.width` (unverified) |
| Insert boss wall | 1 to 2 mm | datasheet 1.3 to 4.5; 3.6 full-strength M5 (`insert.mN.wall`, `insert.m5.wall.full_strength`) | playbook from M4 up | keep |
| Screw hole wall from the top | at least 1 mm | boss OD 2 to 2.5 x d1 (hardware section 6, unverified) | playbook | keep |
| Insert lead-in | 1 mm fillet at the rim | 0.3 to 0.5 mm lead-in at most (hardware 2.1) | playbook | keep |
| Gap between co-printed halves | 0.1 mm | `feature.min.gap` 0.5; print in place 0.35 per side | playbook | keep |
| Layer height for strong parts | 0.3 on a 0.4 mm nozzle | at most 0.5 N (FDM-ORI-4, `layer.max.structural`, MEASURED) | playbook | keep |
| Soft spring floor | about 1 mm | `flexure.leaf.min` 0.5 (from another video of the same channel) | source | both kept, each for its use (spring vs hinge leaf) |
| Microfeature size | about 0.5 mm holes (one video) | 0.2 (FDM-STR-10) | n/a | keep 0.2; add `microfeature.slot.width` |
| Grip-fin gap | 0.2 (one video) | 0.3 to 0.5 (`fitfeature.compliant.gap.min`, `.max`, from the same channel) | playbook | keep |
| Grip-fin interference | 0.5 per side example | "slightly under the shaft" (FDM-HOLE-9) | n/a | record `fitfeature.gripfin.interference.side.example` (unverified); coupon C24 |
| Bed contact | as small as possible | large flat face down (SKILL step 2) | playbook for adhesion, source for ejection | mode-dependent: production runs only |
| Bed-edge treatment | fillet in some videos; chamfer optional in one | chamfer, never fillet (FDM-BED-2, FDM-OVH-4) | playbook | keep |
| Bottom pocket roof | filleted dome | chamfer, never fillet (FDM-OVH-4) | playbook | use a 45 deg cone roof |
| Teardrop | "adds slop", prefers hex or diagonal printing | teardrop (FDM-OVH-6) | n/a | keep the teardrop; hex and diagonal recorded as options |
| Very low infill | 3 to 5 percent cosmetic bulk | 15 to 20 typical (FDM-STR-2) | playbook | recorded for unloaded cosmetic bulk only |
| Best infill pattern | grid or triangle (one video) | cubic (FDM-STR-3, MEASURED at equal mass) | playbook | keep |
| Diagonal printing | strongest in every feature at 45 deg | FDM-ORI-3 (MEASURED 40 vs 63 MPa) | playbook | keep |
| Threaded lid profile | triangular, 45 deg flanks | trapezoidal or buttress (hardware 10, unverified) | unclear | both recorded; prove with a slice |
| Small printed threads | in a knob base, size not stated | no modeled threads under M5 (`thread.min.modeled`) | playbook | keep |
| Print-in-place robustness | any layer, infill, material | printer-dependent gaps, coupon C3 (hardware 9) | playbook | keep |
| Rod flat | tangent at least 35 deg, axis unclear | 45 deg from vertical (FDM-OVH-1) | playbook | octagon instead (FDM-OVH-12) |
| Shrink | about 1 percent | PLA +0.3 percent (materials section 2, secondary) | n/a | stated position; calibrate with a test part |
| First layer | 0.3 mm (service, CAPTION reading) | `layer.first` 0.2 | n/a | a setting; not adopted |
| Vent slats | 0.5 mm suggested for vertical printing | `wall.min.cautious` 1.0; `wall.structural` 0.9 | playbook | not adopted |

## 5. Self-contradictions in the source

| Topic | One position | The other | Playbook position kept |
| --- | --- | --- | --- |
| Bed-edge fillet vs chamfer | fillet the bed edge (https://www.youtube.com/watch?v=_y8Yvu1FQIE, https://www.youtube.com/watch?v=SSHoQLuVJFk); bed chamfer "not really necessary" (https://www.youtube.com/watch?v=Wd0MR4sPcK0) | never fillet the bottom; chamfer 45 deg (https://www.youtube.com/watch?v=IrvxX0MtGMM, https://www.youtube.com/watch?v=DnPu7slvBVk, https://www.youtube.com/watch?v=tb1yqVOyAM8, https://www.youtube.com/watch?v=-gm6hzbAqLk) | chamfer, never fillet (FDM-BED-2) |
| Bed chamfer size | 1 mm (https://www.youtube.com/watch?v=-gm6hzbAqLk, https://www.youtube.com/watch?v=f4fJ5AbUF6Q) | 0.5 mm with a brim (https://www.youtube.com/watch?v=4GxZXxNraY0) | 0.5 house, 1 unknown printer |
| Brim vs fin foot thickness | brim one layer, never about 1 mm (https://www.youtube.com/watch?v=4GxZXxNraY0) | fin foot disc 1 mm (https://www.youtube.com/watch?v=vnn4XeKQobs; 1 to 2 mm in an older video) | different features: brim one layer, fin foot about 1 mm |
| Raft gap | 0.15 to 0.2 (https://www.youtube.com/watch?v=4LTkVb6rP84) | 0.2 to 0.3, CAPTION (https://www.youtube.com/watch?v=ZpmiK0aY9VM) | `production.raft.gap` 0.2, coupon C23 |
| Flexure thickness | 0.5 mm leaf minimum (https://www.youtube.com/watch?v=YG_8wYoxVfs) | about 1 mm for soft springs (https://www.youtube.com/watch?v=wpriGP45Unw) | both, each for its use |
| Logo and text placement | side walls, never the bottom (https://www.youtube.com/watch?v=upf9ixYtDG4, https://www.youtube.com/watch?v=0mti_RY2WnA, https://www.youtube.com/watch?v=X8kqMaxwB4M) | a logo on the bed face is fine if continuous; one-layer logo (https://www.youtube.com/watch?v=-Ryo2uWkC4I, https://www.youtube.com/watch?v=eDgY9_JC7sM) | never on the first layer |
| Grip-fin gap | 0.2 mm (https://www.youtube.com/watch?v=ip70-Tw6tBE) | 0.3 minimum, 0.5 maximum (https://www.youtube.com/watch?v=XKrDUnZCmQQ, https://www.youtube.com/watch?v=IZKh6lo9SP4, https://www.youtube.com/watch?v=3BIvSiuQVWQ) | 0.3 to 0.5 |
| Microstructure size | 0.2 mm slots (https://www.youtube.com/watch?v=Lq-SoGgKOcQ and others) | about 0.5 mm holes (https://www.youtube.com/watch?v=boN1uiaIdVA) | 0.2 |
| Overhang angle | 30 deg maximum and "minimum 30" chamfer (https://www.youtube.com/watch?v=IrvxX0MtGMM); 35 (https://www.youtube.com/watch?v=uCxRJxvsoe0) | 45 "best" (https://www.youtube.com/watch?v=8NKVNwVaZU0); supports past 50 (https://www.youtube.com/watch?v=f4fJ5AbUF6Q); 60 "generally fine" (https://www.youtube.com/watch?v=FMs-VGAu_PQ) | 45 deg from vertical |
| Best infill pattern | cubic strongest (https://www.youtube.com/watch?v=IIS9UagZaWI) | grid or triangle best (https://www.youtube.com/watch?v=SEfEicLNAfc) | cubic |
| Infill and strength | "infill hardly matters below 100 percent" (narration) | the same video's table: 3.3 times from 10 to 80 percent (https://www.youtube.com/watch?v=ZNX7Mzjq_fk) | the table; perimeters first |
| Molding break-even | about 100,000 (https://www.youtube.com/watch?v=FaFY1mIVBvw); 100,000 to 250,000, mold from 1,000 USD (https://www.youtube.com/watch?v=CbdLP8wiJ6M) | 10 to 25 percent dearer at 10,000, mold from 5,000 USD (https://www.youtube.com/watch?v=rKCWJj4E2gg); "cheaper forever" (https://www.youtube.com/watch?v=ZE2fM1YIvGM) | none adopted; one quoted case recorded |
| Ribs | never: fill solid (https://www.youtube.com/watch?v=iiCsQIN_PyQ, https://www.youtube.com/watch?v=OcxfQeeKn-s, https://www.youtube.com/watch?v=8vz9b0zNMVg) | thin webs and hinge ribs added (https://www.youtube.com/watch?v=SiGoPAGXuKM, https://www.youtube.com/watch?v=GDEMxa4WdRw, https://www.youtube.com/watch?v=boN1uiaIdVA) | solid first; self-supporting ribs where needed (FDM-STR-4, -11) |
| Edge-standing land | about 1 mm (the older video behind FDM-SUP-6) | about 2 mm (https://www.youtube.com/watch?v=vnn4XeKQobs) | 1 mm minimum, 2 mm cautious |
| Side-wall engrave maximum | 0.5 (https://www.youtube.com/watch?v=upf9ixYtDG4) | 1 mm at most (https://www.youtube.com/watch?v=aWz1mz4hhu8) | 0.5 on vertical faces |
| Support tine size | as small as possible, 0.4 to 0.8 wide (https://www.youtube.com/watch?v=vnn4XeKQobs) | up to 1 mm, easier (https://www.youtube.com/watch?v=3VUQd_Tl5x0, https://www.youtube.com/watch?v=3AZWuVRUh2c) | 0.5 to 1 wide, 0.5 default |
| Designed vs generated supports | designed almost always better (https://www.youtube.com/watch?v=4wRKmcWXEkw, https://www.youtube.com/watch?v=Iauvzy5mR90) | generated use less material on large domes (https://www.youtube.com/watch?v=udEeJjzEQZI) | designed by default; generated only as the decision table allows |
| Teardrop holes | adds slop (https://www.youtube.com/watch?v=ip70-Tw6tBE) | pointed top or teardrop (https://www.youtube.com/watch?v=Iyxp_Rjz3wo, https://www.youtube.com/watch?v=Bd7Yyn61XWQ, https://www.youtube.com/watch?v=aWz1mz4hhu8) | teardrop |
| Across-layer strength | about 15 percent loss (https://www.youtube.com/watch?v=FaFY1mIVBvw) | about 50 percent (https://www.youtube.com/watch?v=9LZwEYIS0cA) | 0.5 (MEASURED) |
| PLA for grip fins | flexes enough (https://www.youtube.com/watch?v=GRlX27WgySQ) | flexes less, PETG and ABS preferred (https://www.youtube.com/watch?v=yzg_NXM-NRs) | either, proven with C24 |

## 6. Claims not adopted

| Claim | Videos | Reason | The playbook's sourced position |
| --- | --- | --- | --- |
| Printed parts are food safe if well designed (a cohesive outer wall); PLA "biocompatible"; lead from brass nozzles a non-issue | https://www.youtube.com/watch?v=fsCu2GKvoWI, https://www.youtube.com/watch?v=oz51t5p9gXo, https://www.youtube.com/watch?v=2lccrQTAu5A | layer ridges harbor bacteria (the channel says so itself in https://www.youtube.com/watch?v=g6U5jQXlWU4); the lead estimate is back-of-envelope, with a figure corrected on camera, and ignores hygiene and colorants | not food safe by default; certified grade, stainless nozzle, indirect contact (materials section 4; https://formlabs.com/blog/guide-to-food-safe-3d-printing/, SNIPPET) |
| PETG, or PETG or PLA with a UV clear coat, as the default outdoor material; PLA outdoors with a coat | https://www.youtube.com/watch?v=prMUfQ9y7Rk, https://www.youtube.com/watch?v=nF5k_tmQ7k0, https://www.youtube.com/watch?v=reIXSlL6mKA | no UV data; a coat does nothing for PLA's heat and creep limits | ASA outdoors; PLA out for heat and creep (materials sections 4 and 7; Bambu filament guide) |
| Carbon-fiber nylon as strong as aluminum | https://www.youtube.com/watch?v=kQ8FkVi-Kes | no test | chopped fiber is stiffer, not stronger, usually weaker than the base polymer (materials section 3; https://www.youtube.com/watch?v=ct-n2lI0I9g) |
| PETG survives a 6 ft drop, as an impact claim | https://www.youtube.com/watch?v=vE0806yUq7U | no test described; depends on design | PETG is not much better than PLA in notched impact (materials section 5 item 4; CNC Kitchen, Polymaker data) |
| Only about 15 percent strength loss across layers | https://www.youtube.com/watch?v=FaFY1mIVBvw | contradicted by the channel's own 50 percent and by measurement | across-layer strength about 0.5 (FDM-ORI-1, `strength.z.fraction`, MEASURED) |
| Accuracy below 0.1 mm with enough system control | https://www.youtube.com/watch?v=FaFY1mIVBvw | no test; the channel elsewhere says about 0.2 mm (https://www.youtube.com/watch?v=GRlX27WgySQ, https://www.youtube.com/watch?v=yzg_NXM-NRs) | plus or minus 0.2 mm tuned (`accuracy.tuned`, Prusa) |
| Printing at a 45 deg diagonal gives maximum strength in every feature | https://www.youtube.com/watch?v=8NKVNwVaZU0 | measured tilt curve: 45 deg 40 MPa against 63 flat | FDM-ORI-3 (MEASURED); tilts are used for supports and finish |
| PLA parts near hot liquids (a coffee maker with insulating fins) | https://www.youtube.com/watch?v=QBg63t-Gk7s | PLA softens at about 55 to 60 C; the channel itself uses a steel liner for hot drinks (https://www.youtube.com/watch?v=hVPvaLmO8bo) | leave PLA above about 45 to 50 C (materials section 7) |
| Polypropylene absorbs water from the air and bubbles | https://www.youtube.com/watch?v=ELnO2c1nF8U | contradicts common guidance; no source | PP drying light (materials section 2, Bambu filament guide) |
| Watertight pressure parts as a general claim | https://www.youtube.com/watch?v=Yk0I4Tf-E8c, https://www.youtube.com/watch?v=cbxD8Oz9L8Q | no pressure or test numbers; profile not disclosed | layer lines leak; sealing unproven without post-processing; prove with a coupon (hardware section 12) |
| Printing is cheaper than molding forever (a small cube) | https://www.youtube.com/watch?v=ZE2fM1YIvGM | contradicted by the channel's own quote (molding cheaper per part at 10,000) and break-even statements | process choice belongs to **dfm**; the one quoted case recorded |
| All plastics last about a thousand years outdoors | https://www.youtube.com/watch?v=nF5k_tmQ7k0 | contradicts UV embrittlement | ASA outdoors |
| Print-in-place works at any layer, infill and material | https://www.youtube.com/watch?v=AAKsl8zW-Ds, https://www.youtube.com/watch?v=BWsUk1xSSn4 | measured gap depends on the printer | coupon C3 (hardware section 9, MEASURED) |
| ABS prints on an open bed with warp-relief geometry | https://www.youtube.com/watch?v=iPZoDltS30A | no data | ABS needs an enclosure (materials section 2) |
| Thicker sections let a less UV-resistant material serve | https://www.youtube.com/watch?v=SSHoQLuVJFk | no data | ASA outdoors |
| TPU very UV and chemical resistant | https://www.youtube.com/watch?v=3gxsLZITN2c | no data | no change |
| PLA "one of the strongest" for gears in shear | https://www.youtube.com/watch?v=vsYtffk44J0 | no data | no change |

## 7. Not read: worth a later pass

Unread videos judged worth reading later, by id
(https://www.youtube.com/watch?v=ID):

| Id | Title | Why |
| --- | --- | --- |
| sVajcUicFjs | We Stole This YouTuber's Product...To Optimize It | design case study |
| Ilw96xcxDz4 | I Made a Round Ruler, Design for 3D Printing | design case study |
| vkMYsbhfVbg | We Redesigned This YouTuber's Product, [a creator] | design case study |
| rNTBjT49OqU | Designing Everyday Products for 3D Printing | 30 min design session |
| O7uwXBGHN3g | We Designed the Perfect Snack Tray for Oreos and Milk | design case study |
| R0w4GmVX7xM | Make Prints Super Strong without Slicer Settings, Compilation of Micro Features | 41 min; content recurs in four read videos, low priority |
| Uu6qM7bsunw | Answering Frequently Asked Questions About our Teleport 3D Printing Service | may restate the service settings |
| MK90srPx8wI | How to Make a Good Product...with Calculators | 29 min; may hold cost math |
| A88dY3EFZZ4 | Tips from Million Dollar Stores, Reviewing Etsy Products | 42 min product reviews |
| VaYoKDKv3No | 3D Printed Shoes Worth $15M | lattice product |
| 4VU59XYuyhw | How Strong is a 3D Printed Ax? | possible strength test |
| NUdVFoPgNOU | 452-Piece Building Kit for Amazon / Snaphouse | snap kit design |
| yz8bgl1qnMc | 3D Printed Golf Tees | small-part production |
| fcaFITl27t4 | Onboarding Process | may list the design review checklist |
| _3XYHbOjfcQ | Quoting Process | may list the design review checklist |
| -zpe5HqNeug | How 3D Printing Saves Ford Millions at One Factory | jigs and fixtures |
| udWS6ZKoKZY | Every Primary 3D Printing Process Explained | process overview, low priority |
| Neop_O2jMkk | 10 Hours of How to Design for Mass Production Printing | a 656 min compilation, believed to be re-cuts of single videos |

Not worth a later pass: CjDpfGzLTmY and QcqTncnBDAw (segments of read
compilations), and H5zCxJJy3Ks, abFAQGlhTgk and Z-HMXuXWBfk (short clips that
appear to be cut from a troubleshooting video that was read; inferred from
titles). The other unread videos are business, news, filament supply,
hiring, software and service promotion.

**Podcast episodes.** The channel's 121 podcast episodes were not read and are
not itemized here. They were left out because the pass targeted design
videos; whether they hold design content is unknown.

## 8. Index of videos read

234 videos, each listed once under its main topic. Titles are as published,
except that a person's name, or a channel named after a person, is replaced
by a bracketed description.

### 8.1 Production mode, bed contact, brims, rafts and first layer (21)

| URL | Title |
| --- | --- |
| https://www.youtube.com/watch?v=SZwXREFoWKA | How to Design 3D Printed Parts for Auto Ejection |
| https://www.youtube.com/watch?v=X8kqMaxwB4M | Optimizing Your First Layer For Mass Production |
| https://www.youtube.com/watch?v=kIFGtNMmxuM | Sell MagSafe Charger Stands with 3D Print On Demand |
| https://www.youtube.com/watch?v=rgV_mtfRLB0 | This Bowl Holds Your Nuts but Hides the Shells |
| https://www.youtube.com/watch?v=4GxZXxNraY0 | STOP Using Brims. CAD is So Much Better |
| https://www.youtube.com/watch?v=3AZWuVRUh2c | Brims, Rafts and Supports, The RIGHT Way to Design 3D Printed Parts |
| https://www.youtube.com/watch?v=7KVh19WpOcc | Design Rafts in CAD |
| https://www.youtube.com/watch?v=4LTkVb6rP84 | 6 Rafts You Have Never Seen, Design for Additive Manufacturing |
| https://www.youtube.com/watch?v=ZpmiK0aY9VM | STOP Filling Your Build Plate |
| https://www.youtube.com/watch?v=MCcFMDv_4eo | Stop Using Brims, Do This Instead |
| https://www.youtube.com/watch?v=rszX16LFW3U | CAD vs Slicer. What to rely on when mass producing a part |
| https://www.youtube.com/watch?v=f4fJ5AbUF6Q | How to Prepare Your Parts for 3D Print on Demand & Reduce Costs |
| https://www.youtube.com/watch?v=1n_R8shlGcs | 8 Essential Design Rules for Mass Production 3D Printing |
| https://www.youtube.com/watch?v=iiCsQIN_PyQ | The Seven Deadly Sins of 3D Printing |
| https://www.youtube.com/watch?v=iWHBH_T-xqI | The Problem With "Bed Slinger" 3D Printers |
| https://www.youtube.com/watch?v=qpo4WsEeYJo | Walkthrough of Cura 4.0 Print Settings |
| https://www.youtube.com/watch?v=NaQ_Sa1BaqU | Best Design Tips for 3D Printing Production |
| https://www.youtube.com/watch?v=-gm6hzbAqLk | Basic Design Tips to Lower Costs |
| https://www.youtube.com/watch?v=sZZyOd1iYcM | 3D Printer Problems: How To Deal With Overhangs |
| https://www.youtube.com/watch?v=fYOHFutTgT0 | 3D Printer Problems: How To Fix Prints Not Sticking To The Print Bed |
| https://www.youtube.com/watch?v=ZgrlGfftm0k | Troubleshooting 21 Different 3D Printing Problems |

### 8.2 Designed supports (12)

| URL | Title |
| --- | --- |
| https://www.youtube.com/watch?v=vnn4XeKQobs | How to Design Better Support Fins for 3D Printing |
| https://www.youtube.com/watch?v=_R2E8VwyNz0 | Stop Using Slicer Supports |
| https://www.youtube.com/watch?v=6gPPAiqSkBc | You Don't Use Fins Enough |
| https://www.youtube.com/watch?v=3VUQd_Tl5x0 | How a Pro Designs a Cube for 3D Printing |
| https://www.youtube.com/watch?v=YL5lYEXbLDo | These Free STL's are Better than Tree Supports |
| https://www.youtube.com/watch?v=3Acks3Wzjjo | Stop Tall Prints From Falling Over |
| https://www.youtube.com/watch?v=WYQbxIVLz6Y | Understanding and Managing Support Material |
| https://www.youtube.com/watch?v=FMs-VGAu_PQ | Easiest Way to Eliminate Supports |
| https://www.youtube.com/watch?v=SWOnmWCi6bY | 3D Print Better Fan Blades Without Wasting Filament |
| https://www.youtube.com/watch?v=udEeJjzEQZI | Secrets to Better 3D Printed Domes |
| https://www.youtube.com/watch?v=m3Cxw-j19bU | Can We 3D Print a Perfect Sphere? |
| https://www.youtube.com/watch?v=4wRKmcWXEkw | Print in Place Latch Mechanism |

### 8.3 Overhangs, edges, orientation, walls and ribs (18)

| URL | Title |
| --- | --- |
| https://www.youtube.com/watch?v=C0H_4fOm9CQ | How to Improve The Design of Your 3D Printed Parts Using Fillets |
| https://www.youtube.com/watch?v=IrvxX0MtGMM | Design Better Fillets |
| https://www.youtube.com/watch?v=8TIhkxQNINY | The Power of Diagonals: Design for Mass Production 3D Printing 1 |
| https://www.youtube.com/watch?v=8NKVNwVaZU0 | The Correct Orientation to Print Boxes |
| https://www.youtube.com/watch?v=WfP-ZOnlFPM | Rods |
| https://www.youtube.com/watch?v=ujAwxSx63FE | Improving Curved Surfaces |
| https://www.youtube.com/watch?v=csUGcIPNNkk | We Made Tinker Toys for Adults (Extrusion Brackets) |
| https://www.youtube.com/watch?v=NLeTvSaPJIs | Corner Brackets |
| https://www.youtube.com/watch?v=FF4D_Moywgk | Better Horizontal Mounting Features |
| https://www.youtube.com/watch?v=8vz9b0zNMVg | Ribs |
| https://www.youtube.com/watch?v=OcxfQeeKn-s | Ribs and Trusses are Made Wrong in 3D Printing |
| https://www.youtube.com/watch?v=as84ZBjdmxU | You're Designing Parts Too Thin |
| https://www.youtube.com/watch?v=AURCtaRrUGM | Cavities Don't Help |
| https://www.youtube.com/watch?v=81qmDc5unYM | 20+ Ways to Make Your 3D Prints Stronger |
| https://www.youtube.com/watch?v=Lq-SoGgKOcQ | 3x Part Strength Without Slicer Settings |
| https://www.youtube.com/watch?v=p-GuXDxQYkA | 3D Printed Parts as Strong As Molded |
| https://www.youtube.com/watch?v=t122wEA5Aj8 | 3D Printing VS Injection Molding: Manufacturing Solid Objects |
| https://www.youtube.com/watch?v=ylqsMbUyYs4 | Is 3D Printing Worse Than Injection Molding? Not At All |

### 8.4 Test data (8)

| URL | Title |
| --- | --- |
| https://www.youtube.com/watch?v=ZNX7Mzjq_fk | Impact of Infill Density on Beams, Bending Test |
| https://www.youtube.com/watch?v=-LHQtlxYQII | From 10% to 100%: Infill Compression Strength |
| https://www.youtube.com/watch?v=IIS9UagZaWI | Which Infill Pattern is the STRONGEST? |
| https://www.youtube.com/watch?v=SEfEicLNAfc | How Infill Patterns Behave Under Stress |
| https://www.youtube.com/watch?v=PQHKQH5imkI | Wall Thickness and Strength |
| https://www.youtube.com/watch?v=5CFVcPYFEiE | How Strong Are Common Materials? |
| https://www.youtube.com/watch?v=3gxsLZITN2c | Making TPU Hard and Soft |
| https://www.youtube.com/watch?v=rYjZvSz2O_M | Materials in a Blender |

### 8.5 Warping and shrink lines (3)

| URL | Title |
| --- | --- |
| https://www.youtube.com/watch?v=iPZoDltS30A | NEVER Let Your Parts Warp Again |
| https://www.youtube.com/watch?v=d61u_lKFa-U | How to Eliminate Shrink Lines |
| https://www.youtube.com/watch?v=SSHoQLuVJFk | Optimizing Wall Mounted Electrical Enclosures |

### 8.6 Holes, pins, fits, joints, lids and snaps (17)

| URL | Title |
| --- | --- |
| https://www.youtube.com/watch?v=3BIvSiuQVWQ | 10 Ways to Make Perfect 3D Printed Holes |
| https://www.youtube.com/watch?v=ip70-Tw6tBE | The Correct Way to Design Holes for 3D Printing |
| https://www.youtube.com/watch?v=UfJIMn4nvsA | Holes That Won't Break |
| https://www.youtube.com/watch?v=Bd7Yyn61XWQ | Design Better Holes / Improve Tolerances / Reduce Sagging |
| https://www.youtube.com/watch?v=uMA-Wt-z_BU | Design Unbreakable Pins with Perfect Tolerances |
| https://www.youtube.com/watch?v=Iyxp_Rjz3wo | Horizontal Pins with Perfect Tolerance |
| https://www.youtube.com/watch?v=xog9YlMt9UU | Alternative to Pins and Holes: Design for Mass Production 3D Printing |
| https://www.youtube.com/watch?v=XKrDUnZCmQQ | How to Design a Print with Perfect Tolerance EVERY Time |
| https://www.youtube.com/watch?v=IZKh6lo9SP4 | Design Compliant Lids for Perfect Tolerance Every Time, Lids Vol. 2 |
| https://www.youtube.com/watch?v=7YAylxQFe3k | Types of Lids |
| https://www.youtube.com/watch?v=yzg_NXM-NRs | Design for 3D Printing: Grip Fins |
| https://www.youtube.com/watch?v=6DkCCOc5O1Y | Design Snap Fits |
| https://www.youtube.com/watch?v=rsfZgT3ZEI8 | 6 Ways To Make Snap Fits for 3D Printing |
| https://www.youtube.com/watch?v=_y8Yvu1FQIE | Stop Snapping Your Snap Fits |
| https://www.youtube.com/watch?v=RTQjvYENR7w | Joining Features |
| https://www.youtube.com/watch?v=djm5tCFn9S0 | Connect 3D Printed Parts |
| https://www.youtube.com/watch?v=7SY4Vd8Gb80 | We Made a Better LEGO (For 3D Printing) |

### 8.7 Hardware, glue, hinges and springs (12)

| URL | Title |
| --- | --- |
| https://www.youtube.com/watch?v=sza8wg5FIxQ | Threaded Holes & Inserts |
| https://www.youtube.com/watch?v=BwUzOJ8B_H0 | Stop Gluing Magnets Into Your 3D Prints |
| https://www.youtube.com/watch?v=WMbmDfGEygk | Stop Pausing to Insert Stuff |
| https://www.youtube.com/watch?v=Nsv3YSTDYmA | Stop Gluing Your Prints the Old Way |
| https://www.youtube.com/watch?v=qV1xXXbzM4Y | Simplify Assembly with Glue Slots |
| https://www.youtube.com/watch?v=d0BGz4nRjus | How-to Make Your 3D Prints Heavy (Without Wasting Filament) |
| https://www.youtube.com/watch?v=YG_8wYoxVfs | Compliant Hinges: Design for Mass Production 3D Printing |
| https://www.youtube.com/watch?v=TiEyFle6lTM | 5 Living Hinges for Mass Production 3D Printing |
| https://www.youtube.com/watch?v=BWsUk1xSSn4 | How-to Design Print in Place Hinges |
| https://www.youtube.com/watch?v=AAKsl8zW-Ds | Learn 15 Print-in-Place Mechanisms in 15 Minutes |
| https://www.youtube.com/watch?v=wpriGP45Unw | Top 4 Springs You Can Design with 3D Printing |
| https://www.youtube.com/watch?v=O33g62Kwq9s | 3D Printed Nerf Blaster / Design of Compliant Mechanisms |

### 8.8 Text, texture and color (10)

| URL | Title |
| --- | --- |
| https://www.youtube.com/watch?v=upf9ixYtDG4 | How to Design Text for Mass Production 3D Printing |
| https://www.youtube.com/watch?v=TH82TSjI67I | Designing Text for Mass Production |
| https://www.youtube.com/watch?v=aWz1mz4hhu8 | Slant 3D Sample Brick Explained |
| https://www.youtube.com/watch?v=pUabxkiJAdE | 10 Ways to Hide Layer Lines, Design 3D Printed Textures |
| https://www.youtube.com/watch?v=scv4am8kbqs | The Easiest Way to Instantly 10x Your Print Quality |
| https://www.youtube.com/watch?v=jIanWhvsWMc | Layer Lines Don't Matter, Design Textures |
| https://www.youtube.com/watch?v=FVZ5wAzNAB0 | Surface Finishes for Mass Production |
| https://www.youtube.com/watch?v=RAn2FP-d21I | 3D Printing VS Injection Molding: Manufacturing Textures |
| https://www.youtube.com/watch?v=22p4ThOfEO0 | White Filament Will Destroy Your 3D Printer |
| https://www.youtube.com/watch?v=JuJEnuLlJgk | Is This the Perfect 3D Print? |

### 8.9 Materials (13)

| URL | Title |
| --- | --- |
| https://www.youtube.com/watch?v=vE0806yUq7U | How To Use PETG in Mass Production 3D Printing |
| https://www.youtube.com/watch?v=GRlX27WgySQ | Things to Consider When Using PLA For Mass Production 3D Printing |
| https://www.youtube.com/watch?v=nF5k_tmQ7k0 | Mass Production 3D Printing With Ultraviolet Resistant Materials |
| https://www.youtube.com/watch?v=0rdIIvhLghw | What are the Benefits of Carbon Fiber Printing? |
| https://www.youtube.com/watch?v=kQ8FkVi-Kes | Are Carbon Fiber 3D Prints as strong as Aluminum? |
| https://www.youtube.com/watch?v=ELnO2c1nF8U | What are the Most Common Materials Used in 3D Printing? |
| https://www.youtube.com/watch?v=XtU0p-bdZMo | Mass Producing Rubber Parts with 3D Printing |
| https://www.youtube.com/watch?v=pZLxi9OaFLg | How 3D Printing Can Use the Same Material but Create Different Properties |
| https://www.youtube.com/watch?v=g6U5jQXlWU4 | Is 3D Printing Food Safe? |
| https://www.youtube.com/watch?v=2lccrQTAu5A | Is There Lead in 3D Printed Cookie Cutters? |
| https://www.youtube.com/watch?v=Yk0I4Tf-E8c | Can 3D Printed Parts be Waterproof? |
| https://www.youtube.com/watch?v=DiupjIdI3KQ | 3D Printing Has A BIG Supply Problem |
| https://www.youtube.com/watch?v=uIYkOlyEXJM | 5 Filament Flaws Killing the 3D Printing Industry |

### 8.10 Enclosures, vents, loops, feet and mounting (18)

| URL | Title |
| --- | --- |
| https://www.youtube.com/watch?v=lGnpz8q4STw | Mounted Enclosure Boxes |
| https://www.youtube.com/watch?v=jNguIjkLo6g | Why You Should 3D Print Your Electrical Enclosures |
| https://www.youtube.com/watch?v=mV-FWHjlwBk | Camouflaging Electrical Enclosures |
| https://www.youtube.com/watch?v=3WvN8uVnSpU | Design Indestructible Enclosures |
| https://www.youtube.com/watch?v=9ERY20MRJPo | Design Custom Electrical Enclosures for Mass Production 3D Printing |
| https://www.youtube.com/watch?v=MiCRp2uV1MM | Mass Producing Custom Electronics Enclosures With 3D Printing Farms |
| https://www.youtube.com/watch?v=W5WdUF4Y_FI | Better Surface Finish for Electrical Enclosures |
| https://www.youtube.com/watch?v=m20UPm0TOto | Rounded Electrical Enclosures |
| https://www.youtube.com/watch?v=DnPu7slvBVk | Designing Panel Covers |
| https://www.youtube.com/watch?v=31FVZIg4rDs | Engineer Reacts To Raspberry Pi Cases |
| https://www.youtube.com/watch?v=bO39lWkaspA | Water-Resistant Vents for Industrial Applications |
| https://www.youtube.com/watch?v=prMUfQ9y7Rk | This Box Keeps Out Water Without a Seal |
| https://www.youtube.com/watch?v=vcgsQyMSSiY | These Cooling Vents are Impossible |
| https://www.youtube.com/watch?v=Wd0MR4sPcK0 | Design for Mass Production 3D Printing: Ethernet Switch Bracket |
| https://www.youtube.com/watch?v=YMk7EfbemGY | Design for Mass Production 3D Printing: Spool Holder Exploration |
| https://www.youtube.com/watch?v=m1HG1nBTD0E | Reinforce Your Side Loops for Durable 3D Printed Parts |
| https://www.youtube.com/watch?v=hSP9CkqhZSQ | How to Make 3D Printed Feet for Your Designs |
| https://www.youtube.com/watch?v=oYEV-ndgwdk | Lid Loops |

### 8.11 Product redesigns and case studies (70)

| URL | Title |
| --- | --- |
| https://www.youtube.com/watch?v=F3ViXSLH_ZM | We Made a Knob for [a creator's channel] to Print Millions |
| https://www.youtube.com/watch?v=uvnJ9E7_VWA | We Redesigned This Injection Molded Product for Mass-Production 3D Printing |
| https://www.youtube.com/watch?v=cbtVDk3R6XI | We Redesigned This Viral 3D Printed Koozie |
| https://www.youtube.com/watch?v=cdyqNocFCpQ | I Tried to Design the Perfect 3D Printed Drawer |
| https://www.youtube.com/watch?v=oz51t5p9gXo | How to Design a Cookie Cutter for Mass Production 3D Printing |
| https://www.youtube.com/watch?v=EoIlALcMJB8 | Hacking the IKEA SKADIS Pegboard |
| https://www.youtube.com/watch?v=SiGoPAGXuKM | Redesigning YouTuber Products for 3D Print on Demand |
| https://www.youtube.com/watch?v=Lmr4LKI0Hfc | Perry Parts are a Masterclass in 3D Printing Design |
| https://www.youtube.com/watch?v=-Ryo2uWkC4I | We 3D Printed a Screwdriver Case for [a creator's channel] |
| https://www.youtube.com/watch?v=qXHjM_L3vi0 | Design Custom Cabinet Knobs Using 3D Printing |
| https://www.youtube.com/watch?v=mHRQkreuuDA | Design Stronger Vase Mode Prints Using This Secret Technique |
| https://www.youtube.com/watch?v=0mti_RY2WnA | We Created a Belt Holster for Your ZYN Can |
| https://www.youtube.com/watch?v=yFUBXBoDT4I | Can We 3D Print Better Pumpkin Carving Tools? |
| https://www.youtube.com/watch?v=boN1uiaIdVA | We Fixed [a creator]'s OneWheel Stand for Mass Production |
| https://www.youtube.com/watch?v=GDEMxa4WdRw | We Solved [a creator]'s Problem (Folding Hanger) |
| https://www.youtube.com/watch?v=fsCu2GKvoWI | Designing an Ice Cream Scoop for Mass Production |
| https://www.youtube.com/watch?v=aih9ctXS0uU | Design Perfect Scoops for Mass Production |
| https://www.youtube.com/watch?v=BTIoITF3P8U | This Failed Shark Tank Product Could've Saved $750,000 (Lugbug) |
| https://www.youtube.com/watch?v=4WIfbKN-vkg | Watch This Before You Sell 3D Printed Lamps |
| https://www.youtube.com/watch?v=enj80Vc7i0s | Make the Best Organizer |
| https://www.youtube.com/watch?v=WVTJOAeZLQ8 | 5 Everyday Products Redesigned with 3D Printing |
| https://www.youtube.com/watch?v=Jps5YPF2iRU | Minimalist Coffee Stand |
| https://www.youtube.com/watch?v=Y0bk47STUf0 | Create 3D Printed Clocks Easily |
| https://www.youtube.com/watch?v=QBg63t-Gk7s | We 3D Printed a Coffee Maker |
| https://www.youtube.com/watch?v=KbKeCcvn6_s | We made a Better Piggy Bank |
| https://www.youtube.com/watch?v=uCxRJxvsoe0 | We Made a Better Spoon |
| https://www.youtube.com/watch?v=gPLX-qVDc-o | We Made a Better Football |
| https://www.youtube.com/watch?v=hVPvaLmO8bo | We Made a Better Stanley Cup |
| https://www.youtube.com/watch?v=id_b-5kcIpo | Designing Wheels with Parametric Modeling |
| https://www.youtube.com/watch?v=B6r8m93MNGQ | Designing a Tape Dispenser |
| https://www.youtube.com/watch?v=Iauvzy5mR90 | Christmas Ornaments |
| https://www.youtube.com/watch?v=vsYtffk44J0 | Impossible Gears (printed pulley) |
| https://www.youtube.com/watch?v=VUjzKhgDdzk | Dyson's Bladeless Fan for $25 |
| https://www.youtube.com/watch?v=W45TqjY51Zg | Command Strip Wall Hooks |
| https://www.youtube.com/watch?v=CpQGNRWWXs8 | Customizable Organizer Drawers |
| https://www.youtube.com/watch?v=7-LP9UcdAWc | Can you 3D Print a Water Bottle? |
| https://www.youtube.com/watch?v=WnkdxhW6TN0 | Premium Retail Packaging |
| https://www.youtube.com/watch?v=tb1yqVOyAM8 | Command Strip Handles |
| https://www.youtube.com/watch?v=reIXSlL6mKA | Birdhouses |
| https://www.youtube.com/watch?v=ofUlxe7GfKI | Handle Variations Part 2 |
| https://www.youtube.com/watch?v=lae6pyQQhrs | Design Stronger 3D Printed Handles |
| https://www.youtube.com/watch?v=rUUq4kgi7t4 | Unique Handle Variations |
| https://www.youtube.com/watch?v=0wXasxfPBi4 | Make any Wheel You Need |
| https://www.youtube.com/watch?v=u97dyLy_FuE | Product for Kickstarter / Massage Roller Kits |
| https://www.youtube.com/watch?v=qDcskdl16UM | 3D Printed a Hammer that Actually Works |
| https://www.youtube.com/watch?v=d6bt-QtZhqI | Engineer Reacts to Phone Stands |
| https://www.youtube.com/watch?v=xEjtyA2b5I0 | Design a Lamp for Mass Production 3D Printing |
| https://www.youtube.com/watch?v=y9EBTua_lss | Filament Spools Suck. So We Made a Better One |
| https://www.youtube.com/watch?v=9GF9I_6FVdw | Design Your Own Snow Globes Using 3D Printing |
| https://www.youtube.com/watch?v=tGfErEfxXeA | Printed Reef's Aquarium Accessories |
| https://www.youtube.com/watch?v=eDgY9_JC7sM | How 3D Printing Reinvented the Fishing Reel (GoReel) |
| https://www.youtube.com/watch?v=b1RBo7f0Zb0 | A Closer Look at [a creator]'s 3D Printed iPhone Dock |
| https://www.youtube.com/watch?v=XzcIRxbbICI | How Wooj is Designing Premium Lamps with 3D Printing |
| https://www.youtube.com/watch?v=chULpzksGSQ | We Fixed the Dune Popcorn Bucket |
| https://www.youtube.com/watch?v=esmf3iOvtGo | Military $10k Toilet Seat |
| https://www.youtube.com/watch?v=wK-C1fznLZA | $1 Million 3D Printed Pistol Grips |
| https://www.youtube.com/watch?v=G0QAsBj7j5k | Stress Nut into Walmart |
| https://www.youtube.com/watch?v=AM4AvCb-KKE | Most Profitable Products, Vision Pro Stand |
| https://www.youtube.com/watch?v=PbGnxQifEq0 | Urban Outfitters product, Jointlockers |
| https://www.youtube.com/watch?v=9qe-_ClObaw | Real 3D Printed Products: Tons Cycling Stands |
| https://www.youtube.com/watch?v=cbxD8Oz9L8Q | Real 3D Printed Products: Wacky Bobbers |
| https://www.youtube.com/watch?v=plzcdgsNn4M | Real 3D Printed Products: LittleBots |
| https://www.youtube.com/watch?v=tlol_taTNnU | Real 3D Printed Products Using Vase Mode, Bene bFRIENDS |
| https://www.youtube.com/watch?v=m9LJfxrodKc | Worlds 1st 3D Printed Boxing Glove, Medical Grade 3D Printing |
| https://www.youtube.com/watch?v=YIoWGJ5rK78 | We are Mass Producing 3D Printed Foam |
| https://www.youtube.com/watch?v=mO5FyRsFh3A | Awesome 3D Printed Lamps, Gantri |
| https://www.youtube.com/watch?v=aV2tv7GJ1-s | That Time FDM 3D Printing Saved Tesla's Model Y |
| https://www.youtube.com/watch?v=cBVgwIjP02w | 5 Companies Making Real Products with 3D Printing |
| https://www.youtube.com/watch?v=bWz7eJBvFpc | Going Full-time with 3D Printed Coffee Accessories |
| https://www.youtube.com/watch?v=F9k8MFvd-5g | Reacting to the [a creator's channel] Screwdriver: Making Products |

### 8.12 Production, quality, consolidation and cost (32)

| URL | Title |
| --- | --- |
| https://www.youtube.com/watch?v=vpKJZOfMO0c | How Parts are Made in a Giant 3D Print Farm, Quality Checks |
| https://www.youtube.com/watch?v=wuoF0xLxZcM | How Does Slant 3D Keep Products Consistent? |
| https://www.youtube.com/watch?v=qD0vnoo5kh0 | How Does Slant 3D Ensure Part Quality? |
| https://www.youtube.com/watch?v=9JC8KOVKoIE | The Engineering Miracle of Mass Production |
| https://www.youtube.com/watch?v=6pO9gcTnSb0 | Minimize Risks in Mass Production 3D Printing |
| https://www.youtube.com/watch?v=sQflKQHDGsI | AVOID These Common Mistakes with 3D Printed Products |
| https://www.youtube.com/watch?v=EWFushoVoc4 | Avoid These Common Mistakes for a Better Manufacturing Partnership |
| https://www.youtube.com/watch?v=u52ypRRQV3c | Reduce Your Tooling Costs with Mass Production 3D Printing |
| https://www.youtube.com/watch?v=t0mCGcM2w7g | 3D Printing vs Injection Molding: From Design to Price |
| https://www.youtube.com/watch?v=qhxlT4hIm94 | Calculating the REAL Per Part Cost for Injection Molding vs 3D Printing |
| https://www.youtube.com/watch?v=0zLWaEarbj4 | The Cost of Mass Production 3D Printing Explained |
| https://www.youtube.com/watch?v=5GnzmeDFNGk | How to Lower Your Mass Production 3D Printing Costs |
| https://www.youtube.com/watch?v=FaFY1mIVBvw | Debunking 3 Common Myths About Mass Production 3D Printing |
| https://www.youtube.com/watch?v=9LZwEYIS0cA | Filament Update, 3D Printed Molds are Silly, Comments on Layer Lines Video |
| https://www.youtube.com/watch?v=bgHToGAuU4E | How to Make a Million Parts with 3D Printing |
| https://www.youtube.com/watch?v=AQKGvPmz0eQ | Step-by-Step: How-to Turn Your 3D Printed Design into a REAL PRODUCT |
| https://www.youtube.com/watch?v=rKCWJj4E2gg | 3D Printing is 1000x Better Than Injection Molding |
| https://www.youtube.com/watch?v=CbdLP8wiJ6M | Is 3D Printing Cheaper than Injection Molding? |
| https://www.youtube.com/watch?v=ZE2fM1YIvGM | How Many Parts Can Be Made with 3D Printing? |
| https://www.youtube.com/watch?v=Hg0YVPPnf_0 | Why is 3D Printing So Much Cheaper Than Injection Molding? |
| https://www.youtube.com/watch?v=wTuWXqdfJ7s | Why FDM is the Cheapest Form of 3D Printing |
| https://www.youtube.com/watch?v=3WyRaZF5Dig | Why FDM Printer Farms For Mass Production |
| https://www.youtube.com/watch?v=rJZQ3lTIkpw | Robots that Run 3D Printer Farms |
| https://www.youtube.com/watch?v=0flrGublPIE | There Is Not A 3D Printer Made For 3D Printer Farms |
| https://www.youtube.com/watch?v=nfXzj2zNclc | Giant Machine or Giant 3D Print Farm? Which Wins? |
| https://www.youtube.com/watch?v=S_FUH5VnFPE | Challenges of Creating a Hardware Startup (conference talk) |
| https://www.youtube.com/watch?v=bgiAxMEjr2I | Manufacturing Promotional Items with 3D Printing |
| https://www.youtube.com/watch?v=s-S4AFi2HX8 | Cut Costs and Reduce Waste: Toy Manufacturing |
| https://www.youtube.com/watch?v=nZBrXPMydEI | Projects We Killed, Iterations at a Startup |
| https://www.youtube.com/watch?v=7MujrVzznRY | The Thing Stopping 3D Printed Spare Parts |
| https://www.youtube.com/watch?v=J6CN1ybkVs8 | I Hated 3D Printing Until I Learned This |
| https://www.youtube.com/watch?v=x8rkRHyLr9c | This 3D Printed Squirt Gun Puts a New Spin on Water Fights (no speech) |
