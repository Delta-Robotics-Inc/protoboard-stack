# Designing for production runs

The default playbook designs a part for one printer and one person: it puts a
large flat face down so the part sticks, and leaves brims, rafts and the odd
support to the slicer settings of the day. A production run is a different
mode. When a part will be printed in quantity, on an automated farm, or by a
print service from one file on machines nobody tunes for it, the design
**minimizes and shapes bed contact so parts release and eject**, **models its
own brims, rafts and supports in CAD so every copy is identical**, and **avoids
anything that needs settings tuned per job** (fuzzy skin, multicolor, a
slicer brim, generated supports). Everything else in the playbook still
applies: walls, overhangs, fits and hardware do not change.

Use this file when the brief says production, a farm, a print service, a kit
of many identical parts, or automated ejection, and record the mode in the
print assumptions ("mode: production run"). Do not use it for a one-off or a
prototype: there the default steps hold, and a large flat face down is the
safer choice for adhesion.

**Source and trust.** Almost everything here comes from one print farm's
video channel: a company that designs for its own automated production and
sells that service, so it has a commercial interest in this mode. Its
techniques are valuable; its numbers are practitioner values (tag
PRACTITIONER, CLAIMED-TEST where it showed a test, mostly one print per
variant) and never replace a measured or multi-source value in the playbook.
Numbers reconstructed from auto-captions, which drop leading decimals, are
marked **unverified**: check them against the video or a coupon. The full
record, with the conflicts and the claims not adopted, is
`docs/specs/dfm-research/10-slant-3d-videos.md`. Profile paths are in
`profiles/fdm.json`; tags as in [FDM rules](fdm-rules.md).

## 1. Default mode and production mode

| Topic | Default (one printer) | Production run |
| --- | --- | --- |
| Bed contact | a large flat face down for adhesion (SKILL step 2) | as small and simple as release allows: a ring, a pad, an edge; center of gravity over it (section 2) |
| Brim, raft, mouse ears | slicer brim or designed ears for warping materials | modeled in CAD, one layer thick or a gapped raft, labeled as scrap (section 3) |
| Supports | none by design; generated supports only as the decision table allows | none by design; where unavoidable, modeled in CAD and sized for the production nozzle (section 4) |
| Orientation | load, cosmetic face, then bed contact | the same, plus release, uniform finish on every face and parts per plate (section 5) |
| Settings | the person slicing may tune | generic settings only; nothing that changes per job (section 7) |
| Proof | coupons for unproven values | coupons, then a sample batch on the production printer, filament and color (section 10) |

## 2. Ejection-friendly bases

A large solid first layer acts like a glued face: at tens of thousands of
parts a stuck part stops the machine for manual removal, and a big flat bottom
shows first-layer artifacts and stains (PRACTITIONER,
https://www.youtube.com/watch?v=SZwXREFoWKA,
https://www.youtube.com/watch?v=X8kqMaxwB4M,
https://www.youtube.com/watch?v=PbGnxQifEq0).

| Technique | Value and condition | Why and trade-off | Tag | Source |
| --- | --- | --- | --- | --- |
| One-layer recess under the bottom face | recess the whole bottom except a rim, `production.base.recess.depth` (one layer, 0.2 mm) | the first layer prints as a ring; the recessed face prints one layer up and shows distinct raster lines, like an unlevel bed | PRACTITIONER, CLAIMED-TEST (slicer preview) | https://www.youtube.com/watch?v=SZwXREFoWKA |
| Deeper bottom pocket with a self-supporting roof (preferred by the source) | the exterior is unchanged, the pocket reads as intentional, no supports, no added time | the source domes the roof with a fillet, which starts near horizontal at its crown (FDM-OVH-4). **Use a 45 deg cone roof instead:** it satisfies `overhang.max.angle` everywhere and closes to a point. A flat roof must stay within `bridge.max.span` | PRACTITIONER, CLAIMED-TEST | https://www.youtube.com/watch?v=SZwXREFoWKA |
| Conical recess so only an outer ring touches | a shallow cone under the part (the source's lamp used a large conical chamfer of about 40 to 50) | no overhang, sits level on a table despite slight warp, ejects easily, no staining on a large bottom | PRACTITIONER, CLAIMED-TEST (against a flat-bottom version) | https://www.youtube.com/watch?v=kIFGtNMmxuM, https://www.youtube.com/watch?v=xEjtyA2b5I0, https://www.youtube.com/watch?v=cBVgwIjP02w |
| Ring width | down to `production.contact.ring.min` (1 mm) in PLA, **unverified**: one statement, no test | narrower releases more easily but holds less; start wider and narrow it with coupon C25 | PRACTITIONER | https://www.youtube.com/watch?v=X8kqMaxwB4M |
| Center of gravity over the contact | keep the stance symmetric; never lean the part on an asymmetric chamfer | a part whose center of gravity is outside its contact tips and detaches | PRACTITIONER | https://www.youtube.com/watch?v=9ERY20MRJPo, https://www.youtube.com/watch?v=YMk7EfbemGY |
| Cosmetic holes blind from above | stop holes that are only for looks short of the bottom face | the first layer stays one solid region (FDM-BED-8) | PRACTITIONER | https://www.youtube.com/watch?v=X8kqMaxwB4M |
| No large outer bottom chamfer to cut contact | keep the bed-edge chamfer at `chamfer.bed.edge` | a large outer chamfer is itself an overhang that warps and changes the look | PRACTITIONER | https://www.youtube.com/watch?v=SZwXREFoWKA |
| Give flat discs depth | a dome or a pocket instead of a plain flat disc | a flat disc cannot be ejected | PRACTITIONER | https://www.youtube.com/watch?v=d6bt-QtZhqI |
| Bowls and cups rim down | print upside down on the rim | consistent layers, no internal support, little contact; the shallow upper surface deforms slightly | PRACTITIONER | https://www.youtube.com/watch?v=rgV_mtfRLB0 |

Bed contact is also cut by standing parts on an edge, a corner or a cropped
apex (section 5). Whatever the contact, keep the playbook's bed-edge chamfer
and first-layer rules (FDM-BED-2, FDM-BED-5).

## 3. Brims, rafts and mouse ears modeled in CAD

Slicer brims and rafts differ between machines and slicers (spacing, layer
counts, cooling), so a production file models them; the design owner then
controls them and the farm runs generic settings (PRACTITIONER,
https://www.youtube.com/watch?v=rszX16LFW3U,
https://www.youtube.com/watch?v=7KVh19WpOcc). Emboss the word REMOVE on every
modeled brim and SUPPORT on every modeled support, so whoever finishes the
part knows what is scrap (https://www.youtube.com/watch?v=4GxZXxNraY0,
https://www.youtube.com/watch?v=3AZWuVRUh2c).

**Brims**

| Rule | Value | Tag | Source |
| --- | --- | --- | --- |
| One first layer thick, never thicker | `production.brim.thickness` 0.2 mm, at most 0.3; at about 1 mm a print service treats it as part of the part | PRACTITIONER | https://www.youtube.com/watch?v=4GxZXxNraY0, https://www.youtube.com/watch?v=3AZWuVRUh2c |
| A circle under the part beats a square; an outer ring touching only the extremities (star tips) cuts trimming | | PRACTITIONER | https://www.youtube.com/watch?v=4GxZXxNraY0 |
| Chamfer the part's bottom edge where the brim joins, so the brim attaches inboard, the chamfer guides the trimming blade and a poor trim leaves no lip | `production.brim.break.chamfer` 0.5 mm | PRACTITIONER | https://www.youtube.com/watch?v=4GxZXxNraY0, https://www.youtube.com/watch?v=3AZWuVRUh2c |
| A modeled brim prints as one continuous first layer, where a slicer brim prints loops then raster and can separate | | PRACTITIONER, OPINION | same |
| Advanced: thick away from the part, thin at the joint, so it pops off | not dimensioned | PRACTITIONER | same |
| Mouse ear as a sprue: a one-layer disc tied to the corner tip by a short neck, as close to the corner as possible (FDM-BED-10) | disc 0.2 mm | PRACTITIONER | https://www.youtube.com/watch?v=MCcFMDv_4eo |

A brim is not the foot disc of a designed support fin (FDM-SUP-5, about 1 mm
thick): the brim is removable scrap on the first layer, the foot anchors a
fin. The source's videos differ on the two thicknesses because they are
different features.

**Rafts**

| Rule | Value | Tag | Source |
| --- | --- | --- | --- |
| A plate under the part, separated by a gap | `production.raft.gap` 0.2 mm (one layer at 0.2 mm layers); 0.1 fused in the source's test and slicers may fill it | PRACTITIONER, CLAIMED-TEST | https://www.youtube.com/watch?v=4LTkVb6rP84, https://www.youtube.com/watch?v=7KVh19WpOcc |
| Gap by filament finish | matte filament bonds to the raft less, so a smaller gap: `production.raft.gap.matte` 0.15 mm (**unverified**, one video); glossy PLA and PETG 0.2. For loose release of a batch one video gives 0.2 to 0.3 (**unverified**, reconstructed from auto-captions) | PRACTITIONER | https://www.youtube.com/watch?v=4LTkVb6rP84, https://www.youtube.com/watch?v=ZpmiK0aY9VM |
| Thickness | `production.raft.thickness` 1 mm, solid; thicker resists warp | PRACTITIONER | https://www.youtube.com/watch?v=4LTkVb6rP84, https://www.youtube.com/watch?v=ZpmiK0aY9VM |
| Outline | round, ideally a circle; sharp raft corners peel | PRACTITIONER | same |
| Tie the part down | small struts or pins about 1 mm (`support.designed.sprue.diameter`) from the part's corners into the raft, snipped off | PRACTITIONER | https://www.youtube.com/watch?v=7KVh19WpOcc, https://www.youtube.com/watch?v=4LTkVb6rP84 |
| Break the raft's long shrink paths | recess a central disc in the raft's underside by one layer (`production.base.recess.depth`), or cut an X or slots through it, so only the rim grips the bed; this also helps ejection | PRACTITIONER | https://www.youtube.com/watch?v=7KVh19WpOcc, https://www.youtube.com/watch?v=4LTkVb6rP84, https://www.youtube.com/watch?v=3AZWuVRUh2c |
| A raft is a Z datum | bed leveling can move part height by about 0.25 mm; the raft's rough bottom becomes the B-side | PRACTITIONER | https://www.youtube.com/watch?v=4LTkVb6rP84 |
| A raft as a kit card | small parts on one raft fail or succeed together and eject as one unit; modeled outlines, numbers, a QR code or assembly order on the raft show a missing piece | PRACTITIONER | https://www.youtube.com/watch?v=ZpmiK0aY9VM, https://www.youtube.com/watch?v=4LTkVb6rP84 |
| A raft is cheaper than a brim in production | it pops off without trimming labor | OPINION | https://www.youtube.com/watch?v=4LTkVb6rP84 |

A see-through mechanism with a busy first layer can print on a solid back
plate about 1 mm thick that acts as a raft, with the mechanism free above it
(https://www.youtube.com/watch?v=O33g62Kwq9s). Tiny compliant tabs can link
small parts on the bed for the same effect
(https://www.youtube.com/watch?v=BWsUk1xSSn4). A raft interface of
hemispheres was also shown, but its contact size was garbled in the
auto-captions (**unverified**, not used).

## 4. Designed supports

Never leave a production support to the slicer: model it, so any slicer and
printer produces the same support (PRACTITIONER,
https://www.youtube.com/watch?v=4wRKmcWXEkw,
https://www.youtube.com/watch?v=6DkCCOc5O1Y,
https://www.youtube.com/watch?v=rszX16LFW3U). The rules are in
[FDM rules](fdm-rules.md) FDM-SUP-8 to -13; in short:

| Form | Use | Values | Source |
| --- | --- | --- | --- |
| Fin with flat tines (sprues) | an overhang on a part printed on edge or tilted | tines flat in the layer plane, 0.5 thick (`support.designed.tine.height`) by 0.5 to 1 wide (`support.designed.tine.width`); foot disc about 1 mm thick; about five tines, dense near the bed; fins near edges and at both ends; nubs inboard of corners; a break notch in each tine at the part; round fin top | https://www.youtube.com/watch?v=vnn4XeKQobs, https://www.youtube.com/watch?v=3VUQd_Tl5x0, https://www.youtube.com/watch?v=8NKVNwVaZU0 |
| Separate fin or cup with a gap | a sphere, a tilted box's back | `support.designed.gap` 0.2 mm all round; a fin parallel to a tilted part at 0.5 to 1 mm with horizontal sprues | https://www.youtube.com/watch?v=m3Cxw-j19bU, https://www.youtube.com/watch?v=8NKVNwVaZU0 |
| Pointed towers | an undercut such as a hub; they snap off or fall off when tumbled | tip `support.designed.point` 0.5 mm (**unverified**) | https://www.youtube.com/watch?v=B6r8m93MNGQ, https://www.youtube.com/watch?v=Iauvzy5mR90 |
| Thumbtack (and spherical, multi-spine and comb variants) | a small downward point slicers miss | 1 mm stem (`support.designed.sprue.diameter`), wide flat head; pushed in until it touches, on non-show faces | https://www.youtube.com/watch?v=YL5lYEXbLDo, https://www.youtube.com/watch?v=3AZWuVRUh2c |
| Mushroom | the inside of a dome that must stay round | wide cap 0.5 mm or more below the dome, thin stem | https://www.youtube.com/watch?v=udEeJjzEQZI |
| Tapered hollow block | a general overhang | tapers to a slightly rounded contact (not so round it teeters) | https://www.youtube.com/watch?v=WYQbxIVLz6Y |
| Support comb | a tall thin part printed upright | a post close to the part, 1 mm horizontal fingers trimmed to the part's profile by a Boolean and pushed slightly in, stopping below the top; snipped with flush cutters | https://www.youtube.com/watch?v=3Acks3Wzjjo, https://www.youtube.com/watch?v=uCxRJxvsoe0 |
| Removable block in a channel | a print-in-place slide or a tunnel | gap 0.2 above, 0.2 to 0.3 below; chamfered edges, a crush hole, labeled SUPPORT (FDM-SUP-12) | https://www.youtube.com/watch?v=3AZWuVRUh2c, https://www.youtube.com/watch?v=4wRKmcWXEkw |
| Breakaway outrigger fins | a tall panel printed on end | one or two thin fins on the back; no dimensions given | https://www.youtube.com/watch?v=DnPu7slvBVk |
| Sprue left to break on assembly | a snap tab on a part assembled once | 1 mm sprue | https://www.youtube.com/watch?v=6DkCCOc5O1Y |

**Sized for one nozzle, never scaled** (FDM-SUP-10): every value above is
for a 0.4 mm nozzle. Scaled down with a part, the slicer stops printing the
stem or tine; scaled up, the gap fuses or the scar grows. Redraw supports for
another nozzle and prove them with coupon C22
(https://www.youtube.com/watch?v=YL5lYEXbLDo). Where no designed form fits,
the source generates thick tree supports in a slicer and exports them as part
of the mesh, so every printer gets the same support
(https://www.youtube.com/watch?v=3AZWuVRUh2c,
https://www.youtube.com/watch?v=f4fJ5AbUF6Q). Values spoken as "2 to 3" for
an offset support gap in two videos are read as 0.2 to 0.3 mm (**unverified**,
reconstructed from auto-captions).

## 5. Orientation tricks

| Technique | Condition and values | Tag | Source |
| --- | --- | --- | --- |
| Box or enclosure turned 45 deg about one horizontal axis, standing on a chamfered landing on the edge that becomes its base | every interior face is at 45 deg, so no supports; every outside face gets the same finish; the landing is small and non-cosmetic. The source's pad was spoken as "five" without a unit (**unverified**); use at least `landing.edge.width` (2 mm). A lid tilted about 35 deg; a designed fin behind a part whose center of gravity overhangs | PRACTITIONER, CLAIMED-TEST (sliced, no supports) | https://www.youtube.com/watch?v=8TIhkxQNINY, https://www.youtube.com/watch?v=8NKVNwVaZU0 |
| Enclosure standing on an edge or a corner | a large chamfer on the outer edge to stand on with a rib behind it; or corner chamfers of about 7 to 10 mm so the box stands on a corner | PRACTITIONER | https://www.youtube.com/watch?v=lGnpz8q4STw, https://www.youtube.com/watch?v=jNguIjkLo6g, https://www.youtube.com/watch?v=9ERY20MRJPo |
| Cube or block on an edge or a corner | all faces at the same angle to the layers, uniform texture, small contact | PRACTITIONER | https://www.youtube.com/watch?v=3VUQd_Tl5x0, https://www.youtube.com/watch?v=-gm6hzbAqLk |
| Bracket stood on a cropped corner | a three-way corner bracket cropped at the corner, so layers loop around the joint (FDM-ORI-15) | PRACTITIONER | https://www.youtube.com/watch?v=csUGcIPNNkk |
| Edge-standing land | at least `landing.edge.width` 2 mm (FDM-SUP-11) | PRACTITIONER | https://www.youtube.com/watch?v=vnn4XeKQobs |
| Peaked part on a cropped apex | a peaked roof printed upside down stands on a flat strip about `landing.apex.width` 6 mm wide (**unverified**, one video) | PRACTITIONER | https://www.youtube.com/watch?v=reIXSlL6mKA |
| Rods and round parts lying down | an octagon (45 deg facets), a hexagon with a flat down, or one flat cropped on the rim of a round hub; give a round product one flat datum face (FDM-OVH-12) | PRACTITIONER | https://www.youtube.com/watch?v=WfP-ZOnlFPM, https://www.youtube.com/watch?v=YMk7EfbemGY, https://www.youtube.com/watch?v=B6r8m93MNGQ, https://www.youtube.com/watch?v=m20UPm0TOto |
| Tilted parting plane for enclosure halves | cut the halves on a plane at about 35 to 45 deg (or shallower) so both print with the same layer texture and no supports; or a dog-leg cut with a flat lid and a body tilted on a back chamfer; keep port cutouts in one half | PRACTITIONER | https://www.youtube.com/watch?v=W5WdUF4Y_FI, https://www.youtube.com/watch?v=31FVZIg4rDs |
| Side-printed part with a seam-thin bed contact | bring the bed side to a sharp chamfered edge so the bed contact is a narrow seam (about 3 mm in one video) and no show face carries the bed texture; or bring both sides to a point so bed and top faces match | PRACTITIONER | https://www.youtube.com/watch?v=Jps5YPF2iRU, https://www.youtube.com/watch?v=WVTJOAeZLQ8, https://www.youtube.com/watch?v=d6bt-QtZhqI |
| Thin parts in a vertical rack | thin parts stand on a support comb and eject easily; needs a printer whose bed does not move front to back | PRACTITIONER | https://www.youtube.com/watch?v=uCxRJxvsoe0 |
| Long part across the diagonal | turn a long part 45 deg on a square bed to gain length | PRACTITIONER | https://www.youtube.com/watch?v=yFUBXBoDT4I |

These tilts serve support removal, finish and release. Their strength is
FDM-ORI-3's measured curve (a 45 deg tilt measured 40 MPa against 63 flat);
the source's claim that 45 deg is strongest in every feature is not adopted.

## 6. Warping and shrink lines, countered in the geometry

| Technique | Value and condition | Tag | Source |
| --- | --- | --- | --- |
| Round footprint corners as large as the design allows; ideally a round footprint | 5 to 10 mm better than 1 mm; `corner.bed.radius.large` (4 mm) is the floor | PRACTITIONER | https://www.youtube.com/watch?v=X8kqMaxwB4M, https://www.youtube.com/watch?v=iPZoDltS30A |
| Checkerboard relief slits cut up into a large flat base, first layer left continuous | `warp.relief.depth` 0.5 mm at `warp.relief.pitch` 25 mm, both **unverified** (wording partly garbled in the auto-captions); smaller cells safer | PRACTITIONER, CLAIMED-TEST (one demo plate) | https://www.youtube.com/watch?v=iPZoDltS30A |
| Ripple long walls (about 1 mm or finer) or bow them slightly; slits up a wall work too but weaken it (cosmetic parts only) | the slack absorbs shrink | PRACTITIONER | https://www.youtube.com/watch?v=iPZoDltS30A |
| Small internal cavities at the corners | break the long infill paths that pull on the walls | PRACTITIONER | https://www.youtube.com/watch?v=iPZoDltS30A |
| Shrink line where a thick floor meets a thin wall: a groove around the inside of the floor along the wall; or texture the outer wall | groove `shrinkline.groove.depth` about 1 mm (**unverified**, one print per variant); thicker walls did not help; a raised grid on the floor must be continuous | PRACTITIONER, CLAIMED-TEST | https://www.youtube.com/watch?v=d61u_lKFa-U, https://www.youtube.com/watch?v=cdyqNocFCpQ |
| Tie first-layer islands into one outline | small sprues or about 0.3 mm connectors (FDM-BED-8) | PRACTITIONER | https://www.youtube.com/watch?v=SSHoQLuVJFk, https://www.youtube.com/watch?v=rsfZgT3ZEI8, https://www.youtube.com/watch?v=Iauvzy5mR90 |
| Sprue mouse ears and modeled rafts | section 3 | PRACTITIONER | |

The source's claim that these together let ABS print on an open bed is not
adopted (no data); [materials](materials.md) section 2 still requires an
enclosure for ABS.

## 7. Consistency in production

- **No per-job settings.** A production file must print on generic settings:
  nothing in it may depend on fuzzy skin (which changes dimensions, so a
  service may not apply it), a slicer brim or raft, generated supports,
  multicolor or multiple materials (PRACTITIONER,
  https://www.youtube.com/watch?v=f4fJ5AbUF6Q,
  https://www.youtube.com/watch?v=d6bt-QtZhqI,
  https://www.youtube.com/watch?v=rszX16LFW3U). Texture belongs in CAD.
- **An example of generic settings.** One print service's baseline, stated
  aloud: 0.2 mm layers, 1 mm walls, 25 percent infill, supports generated only
  past 50 deg, no brim, and a 0.3 mm first layer (that last reading is
  **unverified**) (https://www.youtube.com/watch?v=f4fJ5AbUF6Q). Design so
  the part needs none of its supports: 45 deg (FDM-OVH-1) stays the design
  limit.
- **Light colors and pigment.** White and light colors scrap more and their
  titanium dioxide pigment flows like paste and wears brass nozzles; dark
  colors are the low-risk choice for cosmetic production parts
  ([materials](materials.md) section 9.3).
- **Prove tight fits per color.** Colorant changes flow and expansion, so a
  fit or a marginal overhang proven in one color can fail in another
  (https://www.youtube.com/watch?v=PbGnxQifEq0,
  https://www.youtube.com/watch?v=EoIlALcMJB8).
- **Lot control.** Color varies spool to spool within one product; for
  color-matched runs use a supplier that checks color with a colorimeter, or
  control lots (https://www.youtube.com/watch?v=DiupjIdI3KQ).
- **One machine model, controlled materials, a climate-controlled room** give
  the same shrink on every part (https://www.youtube.com/watch?v=wuoF0xLxZcM).
  So a `proven` value holds only on the printer, filament and color it was
  proven on.
- **Quality checklist.** Agree a written checklist per part with the
  customer: cosmetic appearance, surface consistency, tolerances, strength,
  and a sampling plan (every part, or samples per batch or per machine). The
  farm's checks: warp (a disc slid under the part against a standard), layer
  shift or skip, under-extrusion, color, staining; failed parts are reviewed
  for orientation, machine and filament run-out
  (https://www.youtube.com/watch?v=vpKJZOfMO0c,
  https://www.youtube.com/watch?v=qD0vnoo5kh0,
  https://www.youtube.com/watch?v=wuoF0xLxZcM,
  https://www.youtube.com/watch?v=PbGnxQifEq0). Write the acceptance criteria
  in the print assumptions. The source reports its own reject rate short of a
  mass-production target of about 1 in 10,000
  (https://www.youtube.com/watch?v=9JC8KOVKoIE).
- **Bought parts vary.** A fit around a mass-produced bought part cannot rely
  on its nominal size; use compliant grip fins with a stated pull-out force
  ([fits and clearances](fits-and-clearances.md) section 10).
- **Moving-bed printers.** On a printer whose bed moves, tall, thin or heavy
  parts and parts on a small pad (tilted parts) are shaken loose and print
  worse; prefer a fixed-bed printer for them, or add outrigger fins, a wider
  land or a modeled brim (https://www.youtube.com/watch?v=iWHBH_T-xqI,
  https://www.youtube.com/watch?v=8TIhkxQNINY,
  https://www.youtube.com/watch?v=3Acks3Wzjjo). Bambu Lab's open bed slingers
  are listed in [Bambu Lab](bambu-lab.md).
- **Mesh integrity.** A clean print with one detached region points to a
  mesh defect where two bodies meet; repair and close the mesh before
  release (https://www.youtube.com/watch?v=ZgrlGfftm0k). Gaps under 0.2 mm
  may be treated as errors by mesh repair
  (https://www.youtube.com/watch?v=m3Cxw-j19bU).
- **Wider tolerances lower cost.** Designing in compliance (grip fins, tapers)
  instead of exact sizes removes per-part inspection
  (https://www.youtube.com/watch?v=GRlX27WgySQ,
  https://www.youtube.com/watch?v=yzg_NXM-NRs).

## 8. Part consolidation

Printing makes undercuts, internal channels and print-in-place mechanisms
that a mold cannot, so a production design merges parts and removes
fasteners and secondary steps (PRACTITIONER):

| Case | From, to | Source |
| --- | --- | --- |
| Retaining lips in a housing replace a screwed cover plate | 5 molded parts and 2 screws to 2 printed parts | https://www.youtube.com/watch?v=uvnJ9E7_VWA |
| A print-in-place hinge and a latch with slight interference | 6 molded parts to 1 | https://www.youtube.com/watch?v=BTIoITF3P8U |
| A living hinge replaces pins and screws in a gripper | about 35 to 55 parts to under 20, counts from memory | https://www.youtube.com/watch?v=plzcdgsNn4M |
| A clamp's two molded halves and pin become one part | removes a supplier, stock and assembly | https://www.youtube.com/watch?v=u52ypRRQV3c |
| Separate brackets merged on one through rod; three printed parts to one | | https://www.youtube.com/watch?v=boN1uiaIdVA, https://www.youtube.com/watch?v=cbtVDk3R6XI |
| A hook-shaped cord slot replaces glue; DIN-rail features replace hardware; standoffs merged into one plate | | https://www.youtube.com/watch?v=xEjtyA2b5I0, https://www.youtube.com/watch?v=lGnpz8q4STw, https://www.youtube.com/watch?v=m20UPm0TOto |

Limits and trade-offs:

- Keep a bought part where it adds value (a metal filter, a wooden dowel, a
  metal hook) and keep the number of distinct bought items to about two, so
  assembly is obvious and tolerances are not critical
  (https://www.youtube.com/watch?v=9qe-_ClObaw,
  https://www.youtube.com/watch?v=Jps5YPF2iRU,
  https://www.youtube.com/watch?v=EoIlALcMJB8).
- Use the fewest features that do the job: two locating features, one screw
  where the mating part supplies the rest
  ([fits and clearances](fits-and-clearances.md) section 11).
- Print-in-place mechanisms raise the reject rate and their clearances vary
  from machine to machine; prove them with coupon C3 on the production
  printer (https://www.youtube.com/watch?v=TiEyFle6lTM,
  https://www.youtube.com/watch?v=d6bt-QtZhqI). A breakaway sprue can hold a
  moving part still in shipping (https://www.youtube.com/watch?v=CpQGNRWWXs8).
- Design assemblies so each step is simple and no part fits backwards
  (https://www.youtube.com/watch?v=9JC8KOVKoIE).
- At farm scale, labor after the print (support removal, trimming, cleanup),
  not machine time or material, dominates cost
  (https://www.youtube.com/watch?v=MCcFMDv_4eo,
  https://www.youtube.com/watch?v=FaFY1mIVBvw).

## 9. One quoted cost case against injection molding

A single quoted example, not a rule: the source obtained two real quotes for
one 50 mm cube in PLA at draft quality with a 30-day lead time, designed for
each process (the molded version with 1.5 deg draft and 2 mm walls, the
printed one solid) (CLAIMED-TEST, https://www.youtube.com/watch?v=t0mCGcM2w7g):

| Quantity | Injection molding, per part, tool included | Printing, per part |
| --- | --- | --- |
| 500 | 13 USD | 5.12 USD |
| 10,000 | 1.42 USD (near 1 USD at 100,000) | 1.55 USD |

Each design change cost 5,700 USD on the mold and 150 USD of print setup.
The channel's other break-even statements disagree with each other (about
100,000 parts; 100,000 to 250,000; printing 10 to 25 percent dearer at
10,000; a small cube "cheaper forever"), so none is adopted. Choosing between
printing and molding is the **dfm** skill's process decision; this example is
context for it.

## 10. What a production run proves with coupons before committing

Print these on the production printer, nozzle, filament and color before
the run depends on them ([test coupons](test-coupons.md)):

1. **C25 ejection base variants:** the chosen base holds through the print
   and releases (by hand or the ejector) without warping; sets the ring width
   instead of `production.contact.ring.min`.
2. **C23 CAD raft gap ladder** per filament finish, if a raft is modeled.
3. **C22 designed-support gap ladder** and the tine and stem sizes, for the
   production nozzle.
4. **C24 grip-fin interference ladder** on the real shaft or bought part,
   with the stated pull-out force, across several lots of the bought part.
5. **C26 side-wall text ladder** where text is on vertical faces.
6. **C3 print-in-place gauge** for any print-in-place joint.
7. **Per color:** every tight fit again in each production color.
8. **A sample batch:** a short run of the real part on the production
   printer, checked against the written quality checklist (section 7), before
   the full run.

Record each result as a `proven` or `failed` value through **dfm**.

## 11. Unverified values in this file

Prove before relying on any of these: `production.contact.ring.min` (1 mm,
one statement); `production.raft.gap.matte` (0.15, one video); the 0.2 to
0.3 raft and support gaps spoken as "2 to 3"; `support.designed.point`
(0.5, one video); `landing.apex.width` (6 mm, one video); the tilted box's
landing spoken as "five"; `warp.relief.depth` and `warp.relief.pitch`
(garbled wording, one demo); `shrinkline.groove.depth` (one print per
variant); the service's 0.3 mm first layer; the raft hemisphere interface
size. The `typical` values here are practitioner values stated in more than
one video; they are still one source's numbers and go through the coupons
above.
