# Hardware in and on FDM prints

Metal hardware raises the quality of a printed part: threads that survive
service, magnets that close a lid, weights, bearings. This file covers each
method's geometry, installation, strength and failure modes, and says where
the research found no numeric source. Findings from the follow-up pass
(`docs/specs/dfm-research/08-skipped-sources-addendum.md`) are folded in.

Tags as in [FDM rules](fdm-rules.md). Clearances are stated per side and
diametral as in [fits and clearances](fits-and-clearances.md). Installing
inserts, pausing a print and embedding parts are physical steps a person
performs; the design only prepares for them.

## 1. Which fastening method

| Method | Pull-out, M3 in PETG (MEASURED) | Torque-out | Reuse | Use when |
| --- | --- | --- | --- | --- |
| Heat-set insert | 119 kg | 3 Nm | many cycles (qualitative) | serviced joints, anything opened repeatedly, threads under M5 |
| Captured nut, bottom pocket | 166 kg | 2 Nm (PETG crushes) | many cycles | highest pull-out, nut can be loaded from the face opposite the load |
| Captured nut, side slot | 86 kg | 2 Nm | many cycles | easy loading, no pause, lower strength |
| Helicoil | 120 kg | 1 Nm | many cycles | |
| Screw straight into plastic | 118 kg | 1 Nm | few cycles | rarely opened joints, low torque |

Source: https://www.cnckitchen.com/blog/helicoils-threaded-insets-and-embedded-nuts-in-3d-prints-strength-amp-strength-assessment
(M3, PETG, 4 perimeters, 100 percent infill). Context: 1 Nm on an M3 bolt
already gives more than 1500 N of preload (same source). In PLA, M3 inserts
pulled out at 157 to 181 kg and torqued out at 3 to 4 Nm (the bolt head sheared
first), a cheap molding insert at 39 kg, a screw in a 2.7 mm hole at 142 kg
(https://www.cnckitchen.com/blog/threaded-inserts-for-3d-prints-cheap-vs-expensive).
At M5 in PLA, direct, tapped and modeled threads all pulled out just under
2000 N; inserts reached almost 3000 N and about 10 Nm torque-out vs 3 to 4 Nm for
plastic threads (https://www.youtube.com/watch?v=iR6OBlSzp7I).

No numeric reuse count was found for screws straight into plastic; plan for
fewer than about 10 cycles (UNVERIFIED) and use inserts for anything serviced.

Torque to failure, M5 in PLA, averaged per insert type (MEASURED,
https://www.youtube.com/watch?v=lYXTiJo_FQQ): heat-set 2.26 Nm, zinc furniture
insert 2.03, rivnut melted in 1.6, rivnut riveted 1.2, helicoil in a modeled
thread 2.4, self-tapping (threaded) insert over 3.3. Self-tapping inserts have
to tear through the plastic to fail; heat-set inserts slip out by stretching
it. Related findings from the same channel (MEASURED, PLA, M3 to M8,
https://www.youtube.com/watch?v=eNMAFTeowFs):

- **Material matters for the insert type.** Heat-set inserts were weaker in
  PETG and a PC blend than in PLA, and self-tapping inserts were much stronger
  in the PC blend. In PETG, PC and ABS prefer self-tapping inserts or deeper
  engagement over heat-set inserts.
- **Never torque a screw in a print to the metal table value.** Every option
  failed at about one fifth or less of the grade 8.8 nominal torque (nominal
  M3 1.3, M4 3.0, M5 6.0 Nm).
- **Printed threads are weaker than an insert one size smaller** (an M5
  printed thread was often weaker than an M4 heat-set insert): go 1 to 2 sizes
  up or use an insert.
- Cheap injection-molding inserts without a guide sleeve reached about the same
  torque as print-specific heat-set inserts. CNC Kitchen's cheap molding insert
  pulled out at only 39 kg (above): the two tests measured different things
  (torque vs pull-out), so pick print-specific inserts where pull-out matters.

## 2. Heat-set threaded inserts

### 2.1 Hole table

From the CNC Kitchen dimensions poster
(https://www.cnckitchen.com/s/CNCKitchen_Heat-Set-Insert-Dimensions-and-Design-Guidelines.pdf,
VENDOR). "Nominal" is the finished hole; the CAD column adds
`hole.compensation.diametral` (0.2) because printed holes finish small; CNC
Kitchen adds 0.2 to 0.3 in CAD for small inserts
(https://www.cnckitchen.com/blog/are-our-heat-set-insert-datasheets-wrong).
All diameters are diametral.

| Thread | Insert L | Insert OD | Nominal hole | CAD hole | Blind depth (L + 1) | Min wall | Profile path |
| --- | --- | --- | --- | --- | --- | --- | --- |
| M2 x 3 | 3.0 | 3.6 | 3.2 | 3.4 | 4.0 | 1.3 | `insert.m2.*` |
| M2.5 x 4 | 4.0 | 4.6 | 4.0 | 4.2 | 5.0 | 1.6 | `insert.m2p5.*` |
| M3 x 5.7 | 5.7 | 4.6 | 4.0 | 4.2 | 6.7 | 1.6 | `insert.m3.*` |
| M3 x 3 (short) | 3.0 | 4.6 | 4.0 | 4.2 | 4.0 | 1.6 | |
| M3 x 5 x 4 (Voron) | 4.0 | 5.0 | 4.4 | 4.6 | 5.0 | 1.6 (ruthex 1.3; 1.6 kept, conservative) | |
| M4 x 8.1 | 8.1 | 6.3 | 5.7 | 5.9 | 9.1 | 2.1 | `insert.m4.*` |
| M5 x 9.5 | 9.5 | 7.1 | 6.5 | 6.7 | 10.5 | 2.6 | `insert.m5.*` |
| M6 x 12.7 | 12.7 | 8.7 | 8.1 | 8.3 | 13.7 | 3.3 | `insert.m6.*` |
| M8 x 12.7 | 12.7 | 10.2 | 9.7 | 9.9 | 13.7 | 4.5 | `insert.m8.*` |
| #4-40 x 5.7 | 5.7 | 4.6 | 4.0 | 4.2 | 6.7 | 1.6 | |
| #6-32 x 7.1 | 7.1 | 5.4 | 4.8 | 5.0 | 8.1 | 1.8 | |
| #8-32 x 8.2 | 8.2 | 6.3 | 5.7 | 5.9 | 9.2 | 2.1 | |
| 1/4"-20 x 12.7 | 12.7 | 8.7 | 8.1 | 8.3 | 13.7 | 3.3 | camera thread |

ruthex RX-series datasheet (ruthex GmbH, dated 2022-08-15, VENDOR, read in
full at a reseller:
https://www.igo3d.com/mediafiles/Sonstiges/Ruthex/ruthex_Datenblatt_RX-Serie.pdf;
it agrees with ruthex.de's own table): M2 hole 3.2 with a 4.0 mm long standard
insert (depth 5.0), M2.5 hole 4.0 with a 5.7 mm insert (depth 6.7), M3 4.0,
M4 5.6, M5 6.4, M6 8.0, M8 9.6 (OD 10.1, wall 4.5); walls as the poster except
the Voron-style M3 at 1.3; depth L + 1 minimum, blind or through, the same
rule as CNC Kitchen's drawing.

Other sizes, VENDOR, all holes diametral and finished: ruthex M4 short (L 4.0,
hole 5.6, wall 2.1), M5 short (L 5.8, hole 6.4, wall 2.6), M6 short (L 6.8,
hole 8.0, wall 3.3), M10 (L 12.7, OD 12.6, hole 12.0, wall 6.0), #2-56 (L 4.0,
hole 3.2, wall 1.3), #10-24 (L 9.5, hole 6.4, wall 2.6), 3/8"-16 (L 12.7, hole
11.9, wall 6.0). CNC Kitchen (store table, https://cnckitchenus.store/, matching
its poster): M4 x 4 (hole 5.7), M5 x 5.8 (hole 6.5), M10 x 12.7 (OD 12.6, hole
12.0, wall 6.0), #10-24 and #10-32 (L 9.5, hole 6.5), 5/16"-18 (as M8),
3/8"-16, G1/8"-28 (OD 12.5, hole 12.0). Add `hole.compensation.diametral` for
the CAD hole as above.

Disagreements:

- Nominal holes: the ruthex datasheet gives M4 5.6, M5 6.4, M6 8.0 and M8
  9.6 (VENDOR, now read, matching ruthex's own drill set), 0.1 mm under the
  CNC Kitchen poster. The profile keeps the CNC Kitchen values because its
  whole table (length, OD, wall) is that insert family; with ruthex inserts set
  the ruthex hole in a layer. **Use the datasheet of the insert actually
  specified**; the smaller hole holds harder, the larger installs easier.
- Length: the standard ruthex M2 (4.0) and M2.5 (5.7) are longer than CNC
  Kitchen's (3.0, 4.0) with the same holes and walls. `insert.m2.length` and
  `insert.m2p5.length` are CNC Kitchen's; set the length of the insert
  actually chosen and the depth follows.
- CAD offset: other tools land near nominal + 0.2 (creative3dp M3 4.24,
  SNIPPET; Hydra: 98 percent of insert OD, SNIPPET).
- Depth: L + 1 (CNC Kitchen and ruthex, both VENDOR); L + 0.5 (creative3dp,
  SNIPPET); L + 2 thread pitches minimum (Spirol, molding inserts,
  https://www.spirol.com/assets/files/ins-wp-how-to-design-the-proper-hole-for-heat-ultrasonic-inserts-us.pdf).
  Adopted: L + 1 or more. Through holes need not be longer than the insert.
- Wall: the poster's per-size minimum; creative3dp 1.5 / 2.0 / 2.5 for M3 /
  M4 / M5+ (SNIPPET); Markforged suggests a smaller insert when under 2 mm of
  material surrounds and lies below it (https://markforged.com/resources/blog/heat-set-inserts);
  Spirol boss OD 2 to 3 x insert OD. **Conservative:** boss OD at least 2 x
  insert OD and at least 2 mm wall, and the wall solid plastic (slicer walls or
  a modifier), not infill. The poster wall is a minimum; for the full strength
  of an M5 insert see section 2.4.
- Chamfer: CNC Kitchen says none needed; creative3dp calls a 1 mm x 45 deg
  lead-in mandatory (SNIPPET). Adopted: 0.3 to 0.5 mm lead-in at most, so the
  top of the knurl still engages (sizing UNVERIFIED).
- Taper: straight holes for the common 3D-print inserts (CNC Kitchen); tapered
  inserts need tapered holes (Spirol: 8 deg included; Markforged tapered
  counterbore). Match the hole to the insert type. Markforged's CAD method for
  a tapered insert: counterbore at the top diameter, then a distance-distance
  chamfer of (top - bottom) / 2 over the full depth; its M3 example is 5.31 mm
  top, 5.10 mm bottom, 3.8 mm deep (VENDOR,
  https://markforged.com/resources/blog/heat-set-inserts).

Hole size matters: in CNC Kitchen's M3 test (PolySonic PLA) pull-out was about
1400 N at small holes, a 4.2 mm CAD hole kept about 90 percent of the maximum,
and strength fell off sharply between finished 4.1 and 4.2 mm (MEASURED).

### 2.2 Orientation and load side

- Put the insert on the face **opposite** the mating part, so bolt tension
  pushes it deeper instead of pulling it out (Markforged, VENDOR).
- The mating part's clearance hole must be smaller than the insert's face so
  the insert cannot jack out through it (Spirol, VENDOR).
- Add extra perimeters around the boss (a local modifier is fine).
- The hole compensation depends on the print direction. The `insert.mN.hole`
  values (finished hole + `hole.compensation.diametral`) are for a hole whose
  axis is vertical in the print orientation: its circles lie in the layer
  plane and shrink evenly. A hole whose axis is horizontal is built from layer
  steps and sags at the top by about one layer (`hole.horizontal.droop`): do
  not apply the uniform diametral increase to it; teardrop or roof the top, or
  drill it to the finished size. Holes at other angles fall between; prove
  them with the insert pocket coupon (derived from FDM-HOLE rules in
  [FDM rules](fdm-rules.md)).

### 2.3 Installation (performed by a person)

1. Iron 10 to 20 C above the print temperature: about 225 C PLA, 245 C PETG,
   265 C ABS (https://www.cnckitchen.com/blog/tips-and-tricks-for-heat-set-inserts).
2. Pre-seat the insert by its pilot; a correct hole holds it with slight
   resistance.
3. Use an insert tip with a centering pin; melt in with light force.
4. Stop at about 90 percent depth, remove the iron, press flush with a flat
   tool and hold a few seconds: inserts creep back out right after melting.
5. Large inserts (M5, 1/4"-20): thicker tip, slightly hotter. Engineering
   composites (Onyx, nylon composite): iron at 343 to 399 C (650 to 750 F)
   (VENDOR, https://markforged.com/resources/blog/heat-set-inserts).
6. A burr below a through hole means the hole was too small.
7. Resin prints: inserts cannot be melted in; glue them into a stepped hole.

Failure modes: insert spins (shallow knurl in soft ASA); burr blocks the screw
(hole too small); partial knurl engagement (hole too big); boss splits (thin
wall, SNIPPET); insert proud or crooked (no final flat press).

Material: PLA and PLA+ creep under sustained clamp load; for inserts under
sustained load or when warm prefer PETG (to 60 C), PC, ASA or ABS
([materials](materials.md)). In PETG, PC and ABS a self-tapping insert or
deeper engagement holds better than a heat-set insert (section 1).

### 2.4 The boss around an insert: perimeters, not infill

- **Insert joints fail where the perimeter ring around the insert separates
  from the infill,** not at the insert: every sample failed this way (MEASURED,
  PLA, M3 to M8, https://www.youtube.com/watch?v=eNMAFTeowFs). Joint strength
  is set by the bond between infill and perimeters, so add perimeters or a
  solid modifier around the boss, or raise the infill/perimeter overlap.
- **Full-strength M5:** about 3.6 mm of solid perimeter around the hole (4
  shells of 0.9 mm lines) with at least 20 percent infill let the insert pull
  out before the part cracked; infill above 40 percent added nothing; 30
  percent infill and 4 shells was plenty (MEASURED, PLA, short M5 inserts,
  printed flat or on edge, https://www.youtube.com/watch?v=lYXTiJo_FQQ). This
  is `insert.m5.wall.full_strength` (3.6 mm), against the poster's 2.6 mm
  minimum.
- **Condition for other sizes:** only M5 was measured, so there is no
  per-size value. The rule for every insert: the band the poster calls the
  wall must print as perimeters or a solid modifier, and when the joint must
  outlast the insert, thicken it beyond the poster minimum and prove it with
  C9 plus a pull or torque test.

## 3. Captured nuts

| Item | Rule | Source |
| --- | --- | --- |
| Pocket | Model across flats (not corners) + clearance; M3 nut 5.5 AF gives 5.8 pocket; M5 8.3 | Loftsmith (SNIPPET) |
| Clearance | **0.3 diametral across flats** (0.15 per flat) for a drop-in nut held by the screw (`nut.pocket.clearance.af`); 0.1 to 0.15 diametral for a press-in nut. Other sources: 0.2 to 0.4 total; 0.2 to 0.3 lateral plus 0.1 vertical headroom | 3dprintcalcs, createit3d (SNIPPET) |
| Embedded (pause) nut | 0.05 to 0.08 per side on all faces over the **measured** nut (0.10 to 0.16 diametral), tight so it cannot spin | Markforged, read in full (VENDOR, https://markforged.com/resources/blog/embedding-nuts-3d-printing) |
| Measure the real nut | size the cavity from the measured nut, not the datasheet: a measured M5 nut was 7.85 AF x 3.85 vs nominal 8 x 4 | same (VENDOR) |
| Slip-in nut, M6 and up | slides in by hand and cannot rotate: M6 nut 9.8 AF modeled at 10.5, +0.7 diametral across flats (0.35 per flat) | Teaching Tech (PRACTITIONER, https://www.youtube.com/watch?v=yP7_qZ_Mi78) |
| Depth | nut height + 0.2 to 0.3 (`nut.pocket.depth.extra`); M3 about 2.7 | Loftsmith, creative3dp (SNIPPET) |
| Orientation | A flat of the hex parallel to the bed, so the pocket roof bridges as a straight edge, not a point | Loftsmith (SNIPPET) |
| Strength | Bottom pocket (nut bears on the bulk of the part) 166 kg vs side slot 86 kg in PETG M3: nearly 2x | CNC Kitchen (MEASURED) |
| Annoyance | Loose pockets drop nuts; tight pockets are hard to load | CNC Kitchen (MEASURED) |

Methods:

- **Side slot (nut trap):** a slot from the side, width = AF + clearance, past
  the bolt axis. No pause, easy, weaker. Slant 3D stops the slot about 0.5 mm
  (two layers) below the top (https://www.youtube.com/watch?v=9Hp-VRO1hVQ).
  Side nut slots are crack starters: one practitioner has seen many parts
  crack at the slot (PRACTITIONER, https://www.youtube.com/watch?v=HgEEtk85rAY);
  give the slot generous surrounding wall.
- **Bottom or back pocket:** opens on the face opposite the load; strongest.
- **Embedded with a pause:** a closed hex cavity, pause at the first layer that
  covers it, drop the nut, resume (section 5). The bolt hole above the nut must
  bridge: use sequential sacrificial bridging (one layer of tangent rectangles,
  then a second pair rotated 90 deg at twice the layer height; Hydra Research,
  https://www.hydraresearch3d.com/design-rules).
- **Square nuts are preferred over hex in side slots and embeds:** a hex nut
  tilts while it is pushed in and can spin or strip the cavity (PRACTITIONER,
  https://www.youtube.com/watch?v=HgEEtk85rAY; VENDOR, Markforged
  embedding-nuts page). They need no flat-down orientation. No print-specific
  square-nut clearance was found: use the same across-flats logic and prove it
  with C10.
- **Embedding rules** (pause and embed, VENDOR, Markforged embedding-nuts and
  https://markforged.com/resources/blog/embedding-components-in-3d-printed-parts):
  no fillet or chamfer inside the cavity, above all on the ceiling, which must
  be flat so the roof bridges; a part whose top is not flat (or a hex nut with
  its axis in XY) needs a printed filler piece to give the nozzle a flat
  surface.

## 4. Embedded magnets

| Parameter | Value | Source and tag |
| --- | --- | --- |
| Press pocket (printed over) | magnet + 0.10 to 0.15 diametral (0.05 to 0.075 per side); house 0.15 (`magnet.pocket.press.diametral`) | totalElement (VENDOR) |
| Glue pocket (after printing) | magnet + 0.2 to 0.3 diametral (0.1 to 0.15 per side); house 0.25 (`magnet.pocket.glue.diametral`) | totalElement (VENDOR) |
| Test, 6 x 2 mm disc | 6.1 too tight; 6.2 firm press, stayed put while printed over; 6.3 loose, pulled out by the nozzle | DraftID (MEASURED) |
| Open pocket depth | magnet + 0.1 to 0.2 (`magnet.pocket.depth.open`) | totalElement |
| Enclosed pocket depth | magnet + 0.4 to 0.5 so the nozzle never scrapes it (`magnet.pocket.depth.enclosed`) | DraftID |
| Cover | at least 2 layers (0.4 mm at 0.2 mm layers), 2 to 4 layers (`magnet.cover.layers`) | DraftID, totalElement |
| Cover vs pull | 6 x 2 mm N52 to steel: 0.4 mm skin keeps about 45 percent of the pull, 1 mm about 21 percent | totalElement (VENDOR test) |
| Temperature | standard N grades about 80 C (`magnet.max.temperature`); M about 100, H 120, SH 150, UH 180, EH 200 C | totalElement (VENDOR); Apex, Stanford Magnets (SNIPPET) |
| Jumping to the nozzle | magnets must be firmly seated or glued or they leap to the print head; a forum report says even 5 mm below the nozzle | Prusa KB (SNIPPET), Prusa forum (SNIPPET) |
| Polarity | mark one face of the whole stack before separating; decide "marked face out" per part and write it in the design; use a finished part as a jig | totalElement, DraftID |

Sources: https://totalelement.com/blogs/magnet-projects/how-to-embed-magnets-in-3d-prints,
https://draftid.com.au/how-to-embed-magnets-in-3d-prints/,
https://help.prusa3d.com/article/insert-pause-or-custom-g-code-at-layer_120490,
https://www.apexmagnets.com/n-grade-comparison.

Rules:

- Put the attracting face on the thin-skin side and print the cover as solid
  top layers.
- Hardened steel nozzles (standard on P2S, X2D, H2C, H3C) are magnetic; brass
  less so (UNVERIFIED for stainless). Always press-fit or glue before resuming.
- PLA bed temperatures (55 to 65 C) are under the 80 C limit. ABS, ASA and PC
  beds at 90 to 110 C, or heated chambers plus bed heat, may partly demagnetize
  N grades (inferred from the rating; no measured loss found, UNVERIFIED). For
  hot materials, glue magnets into open pockets after printing, or specify H
  or SH grade.
- Slant 3D's no-pause alternative: a tall cylindrical magnet pressed into a
  narrower "over-center" slot (1.5 mm slot for a 2 mm magnet) so it snaps and
  locks (PRACTITIONER, https://www.youtube.com/watch?v=9Hp-VRO1hVQ).
- Write the polarity in the design notes and on any assembly drawing.

## 5. Pause and embed: magnets, nuts, weights, bearings, RFID, springs

1. Model a closed cavity: item size + press clearance (glue clearance if the
   item may move), depth = item height + 0.2 to 0.5 mm so nothing stands above
   the current layer (DERIVED from the magnet rules; UNVERIFIED per item type).
   Markforged's offset for an embedded component is about 0.08 per side on
   every face, made by boolean-subtracting the part and offsetting (VENDOR,
   https://markforged.com/resources/blog/embedding-components-in-3d-printed-parts);
   the ceiling stays flat (section 3).
2. Keep supports out of the cavity; the roof must bridge (within
   `bridge.conservative.span`) or be a 45 deg or teardrop roof.
3. In the slicer, the pause goes on the first layer that would cover the
   cavity. Bambu Studio and PrusaSlicer insert the pause **before** the
   selected layer prints and wait for a manual resume
   (https://wiki.bambulab.com/en/software/bambu-studio/view-slicing-information;
   https://help.prusa3d.com/article/insert-pause-or-custom-g-code-at-layer_120490).
   Bambu's pause G-code is `M400 U1` (SNIPPET, Bambu forum).
4. Disagreement on which layer: Bambu says pause on layer N stops before N;
   DraftID tells users to step back one layer; some Prusa users report the
   pause landing a layer late (SNIPPET). Conservative: pause one layer early
   when the cavity is 0.4 mm or more deeper than the item, and always check in
   the slicer preview that the cavity is still open at the pause layer.
5. During the pause the bed stays heated (SNIPPET); users report the nozzle
   cooling and oozing, which can leave a weak first resumed layer (SNIPPET,
   UNVERIFIED). The person inserts items quickly and does not move the part.
6. Record each pause in the print assumptions: layer number, Z height, item,
   orientation and polarity.

Weights (steel shot, washers), RFID tags (thin; keep metal away from the
antenna) and springs (compress and capture under a lid) follow the same rule;
item-specific numbers were not found (UNVERIFIED). A bearing pressed in during
a pause must not protrude above the pause layer.

## 6. Screws straight into plastic

| Approach | Pilot or geometry | Source |
| --- | --- | --- |
| M3 machine screw, self-tapping | 2.7 mm hole (`screw.selftap.m3.pilot`); Loftsmith 2.6 | CNC Kitchen (MEASURED); Loftsmith (SNIPPET) |
| M5 | minor diameter, 4.5 mm (tap or direct); Loftsmith 4.4 | CNC Kitchen video (MEASURED); Loftsmith (SNIPPET) |
| Rule of thumb | tap 90 percent of major diameter; self-tap 96 percent; insert 98 percent of insert OD | Hydra Research (SNIPPET) |
| Thread-forming plastic screws (PT, DELTA PT style) | hole 0.8 x d1 (to 0.88 x d1 for filled plastics), engagement 2 x d1 | EJOT brochures (SNIPPET) |
| Boss OD for thread-forming screws | about 2 to 2.5 x d1 | molding guideline, UNVERIFIED |
| Printed clearance hole for the screw | ISO 273 medium + 0.2 diametral: M3 3.6 (`screw.clearance.m3`) | DERIVED |
| Easier-driving self-tap hole | tap drill + 0.4: M3 2.9, M4 3.9 diametral (2.7 stays adopted for M3, the measured pull-out value) | Teaching Tech (PRACTITIONER, https://www.youtube.com/watch?v=yP7_qZ_Mi78) |
| Self-forming (tapless) hole | a hole slightly larger than the screw with three internal ridges the screw deforms; up to M5, for joints tightened once; in a horizontal hole point one ridge straight down; ridge sizes are only in a linked CAD document, not published as text | Made with Layers (PRACTITIONER, https://www.youtube.com/watch?v=HgEEtk85rAY) |
| Long tapped thread in ABS or PC | about 20 mm engagement at M5 with 8 solid top and bottom layers and one extra perimeter came close to screw strength | PRACTITIONER, https://www.youtube.com/watch?v=Fgbxgz5S2dc |

- Direct screwing adds hoop stress that can split the boss; plastic-specific
  screws are better (CNC Kitchen).
- Slant 3D: hexagonal pilot holes (the screw bites the flats, debris falls into
  the corners), vertical relief slots about 0.2 mm, or 0.1 to 0.2 mm slots that
  force extra walls (https://www.youtube.com/watch?v=ip70-Tw6tBE).
- Torque limit about 1 Nm for M3 in PLA or PETG; overtightening strips the
  thread (MEASURED).
- Avoid wood screws and coarse plastic-thread screws in FDM parts with sparse
  infill: the deep thread cuts through the perimeter shell into mostly empty
  infill (PRACTITIONER, https://www.youtube.com/watch?v=HgEEtk85rAY).
- Tapping a printed hole removes most of the perimeter, and PLA melts on a
  power tap: about a third of power-tapped M3 threads in PETG were ruined
  (MEASURED, https://www.youtube.com/watch?v=eNMAFTeowFs). Prefer inserts.
- Holes whose axis crosses layer lines split under a wedging screw: see
  [FDM rules](fdm-rules.md) FDM-ORI-5 and -6.

## 7. Press fits: dowels, bearings, shafts

| Case | Guidance | Source |
| --- | --- | --- |
| 608 bearing (22 mm OD) | model 22.1 to 22.4 (diametral +0.1 to +0.4) for a near-22.0 printed hole | StackExchange (SNIPPET) |
| Bearing press | about 0.05 to 0.10 interference per side on the printed result | meshra (SNIPPET) |
| Crush ribs | hole slightly large plus small ribs the bearing crushes; tolerant of printer variation. About 2 deg taper plus 0.2 mm ribs | newscrewdriver, AON3D (SNIPPET) |
| Metal pin | 3 mm pin in a 3.2 mm printed hole (0.1 per side, "some force") | StackExchange (SNIPPET) |
| Grip fins (side holes) | slots beside the hole make two flexing fins; undercut slot gap 0.3 mm minimum, 0.5 mm maximum (`fitfeature.compliant.gap.min`, `.max`), about 1 mm behind; thicker or shorter fins grip harder | Slant 3D (PRACTITIONER, https://www.youtube.com/watch?v=ip70-Tw6tBE for the fins; https://www.youtube.com/watch?v=XKrDUnZCmQQ for the 0.3 to 0.5 gap, which replaces the 0.2 mm gap the first pass recorded) |

For a critical bore (bearing seat, dowel location), print undersize and ream;
or use crush ribs, which tolerate printer variation better than an exact
interference.

## 8. Snap fits

Cantilever equations (rectangular constant section; Bayer/Covestro and BASF
guides, SNIPPET via https://synectic.net/snap-fit-design/ and the Bayer/Covestro snap-fit guide, university-hosted copy listed as source 54 in docs/specs/dfm-research/04-hardware-fits-calibration.md (URL not repeated: its path carries a personal name)):

- Permissible deflection: y = 0.67 x eps x L^2 / h (eps allowable strain, L
  beam length, h root thickness).
- Deflection force: P = b x h^2 x E_s x eps / (6 L) (b width, E_s secant
  modulus).
- Mating force: W = P x (mu + tan a) / (1 - mu x tan a), a the lead angle; a
  90 deg return face is non-releasable.
- A beam tapering to half thickness at the tip spreads strain more evenly.
- Repeated use: 60 percent of the one-time allowable strain (Bayer example).

Allowable strain per material (one-time / repeated, `snapfit.strain.*` in
`profiles/materials-fdm.json`):

| Material | FDM value | Basis |
| --- | --- | --- |
| PLA | 2% / 1% | DERIVED (Mandarin 3D) |
| PLA Tough+ | about 2% / 1% | UNVERIFIED |
| PETG | 2.5% / 1.25% | DERIVED (Mandarin 3D) |
| ABS, ASA, PC | about 2% / 1.2% | UNVERIFIED: molded ABS 6 to 7 percent and PC 4 to 9.2 (BASF, SNIPPET), Fictiv 7 percent printed ABS (SNIPPET), conservatively reduced |
| Unfilled nylon | about 4% / 2.4% | UNVERIFIED: Fictiv 4 to 15 percent printed (SNIPPET); BASF uses 4 percent for PA6 mating force |
| CF-filled, Matte, Silk | avoid | |

Halve the allowable strain for a beam that bends across layers (Z-built beams
lose about half their elongation, Fictiv, SNIPPET).

FDM rules (Hubs, https://www.hubs.com/knowledge-base/how-design-snap-fit-joints-3d-printing/):

- Print the beam lying in XY so it bends along the filaments; avoid vertical
  cantilevers.
- Root fillet at least 0.5 x root thickness (`snapfit.root.radius.factor`); the
  BASF stress concentration factor falls from 1.78 at R/h 0.4 to 1.41 at R/h
  1.0 (SNIPPET).
- Width at least 5 mm, taper toward the tip, deflect only during assembly (no
  preload in service), add lugs to carry shear.
- Body clearance: `clearance.snapfit.side` (0.3 per side; sources do not say
  per side or total).
- Lead angle under 45 deg (SNIPPET); friction mu ABS 0.5 to 0.65, PC 0.45 to
  0.55, nylon 0.3 to 0.4 (Bayer, SNIPPET).

## 9. Hinges, print in place, flexures

| Feature | Value | Source and tag |
| --- | --- | --- |
| Living hinge | 0.4 to 0.6 mm thick, at least 2 layers; best in nylon or PP | Hubs (SNIPPET, https://www.hubs.com/knowledge-base/how-design-living-hinges-3d-printing/) |
| PLA / PETG hinge thickness | 0.3 to 0.6 PLA, 0.4 to 0.8 PETG | printstack (SNIPPET) |
| PLA living hinge life | about 50 to 100 folds at 0.4 mm (low confidence); Hubs example lasted 25 cycles | uavmodel (SNIPPET), Hubs |
| Print-in-place hinge | 0.25 per side (0.5 diametral), PLA, 0.4 nozzle, 0.2 layers | Sovol (SNIPPET) |
| Print-in-place gap test | 0.2 frees on a tuned printer; 0.15 partly welds at seams | Maker's Muse (MEASURED, https://www.youtube.com/watch?v=TYuLVN3YHw8) |
| Print-in-place Z gap | at least one layer, preferably two (`clearance.printinplace.z`); 45 to 60 deg overhangs top and bottom | Maker's Muse uses 60 deg (MEASURED); two layers UNVERIFIED |

Print living hinges flat with the filaments running across the hinge line
(standard practice, UNVERIFIED wording). Seam blobs weld tight gaps first: put
seams away from print-in-place joints.

Flexures and compliant mechanisms: practitioner numbers now exist
(PRACTITIONER; no source gives fatigue data, so every value still needs a
coupon). Check the result against the snap-fit strain limits above; material
choice is in [materials](materials.md) section 5.

| Rule | Value | Source |
| --- | --- | --- |
| Leaf thickness | about 0.5 mm minimum (two lines at a 0.4 mm nozzle, `flexure.leaf.min`); 1.0 mm for stiffer leaves (`flexure.leaf.root`); thicker in PETG | Slant 3D, https://www.youtube.com/watch?v=YG_8wYoxVfs |
| Taper | about 1.0 mm at the roots to 0.5 mm at the center, which fixes where it bends | same |
| Size in line-width multiples | 0.84 mm (one perimeter per side at a 0.42 line) or 1.68 mm (two per side); Arachne can starve a thin joint, so check the slicer preview with Classic perimeters | Teaching Tech, https://www.youtube.com/watch?v=xV36ITRjP_4 |
| Shape | long leaves, arcs or coils outlast notch hinges (a notch hinge fatigued in a few cycles in PLA; 40 deg over about 2 mm is a torture case) | both videos |
| Roots and symmetry | fillet every root; a symmetric double leaf gives equal spring-back | both videos |
| Material ranking | nylon best; PETG best practical; ASA works but whitens; PLA snapped after a few cycles; TPU too soft and takes a set | Teaching Tech |
| Single-use fold crease | about 0.2 mm (origami-style folds printed flat) | Teaching Tech |
| Process | keep seams off flex junctions; let the part cool fully before flexing | Teaching Tech |

## 10. Threads

- Do not model threads smaller than M5 (#10); never in horizontal holes
  (Hydra Research, `thread.min.modeled`). Below M5 use inserts, self-tapping
  screws, or a tapped hole. Prefer M6 or larger, and go 1 to 2 sizes up or
  use an insert where strength matters (Made with Layers: printed threads
  only at M6 and up, https://www.youtube.com/watch?v=HgEEtk85rAY; M5 printed
  weaker than an M4 insert, MEASURED, https://www.youtube.com/watch?v=eNMAFTeowFs).
- **Disputed, a coupon decides:** in one source's test, M5 and up threaded
  cleanly when printed flat while threads in holes standing in Z needed tap
  chasing even at M8, which suggests a vertical-axis thread is the worse case
  and may contradict "never in horizontal holes". The video does not make the
  axis unambiguous, so the rule stands until the thread-axis coupon C20 in
  [test coupons](test-coupons.md) is printed.
- Printed thread fit by scaling: shrink the male part 2 to 6 percent in XY,
  Z unchanged; about M12 turned freely at a 375 vs 400 percent scale
  (PRACTITIONER, https://www.youtube.com/watch?v=QF5aZz2k0bg). Printed screw
  heads: Phillips or slotted, not a hex socket, which strips (same source).
- CNC Kitchen found printed M3 threads worked without offsets in both
  orientations, but horizontal printed threads were weakest (MEASURED, insert
  hole test page).
- Layer height 1/4 to 1/2 of the pitch (JLC3DP, SNIPPET).
- Side holes with threads: cut flats top and bottom of the thread profile so
  nothing overhangs, or use a hex hole the screw cuts into (Slant 3D).
- Threaded lids: coarse pitch (3 to 5 mm), trapezoidal or buttress profile,
  axis vertical, 0.3 to 0.5 mm radial clearance, lead-in chamfer (UNVERIFIED,
  no print-specific numeric source). This repository's **enclosure-cad**
  twist lid uses 0.2 radial and 0.15 axial as printed-fit defaults to check on
  a first print.
- Never use a printed metric thread for a metal screw that is assembled more
  than a few times.

## 11. Joints for split parts

From Bambu's large-file guide (https://wiki.bambulab.com/en/bambu-studio/manual/3d-print-large-files, VENDOR):

- Cut where the seam is least visible and structurally sensible; flat cut
  faces on the bed print cleanest.
- Orient each piece for no supports, strength and surface.
- Add connectors at the cut (plug, dowel, snap); give pegs extra wall; same
  profile, layer height and filament on every piece.
- Glue: CA for PLA; two-part epoxy for PETG and ABS; sand and clean first.
  ABS and ASA can be solvent-welded with acetone (ventilate); not PLA or PETG
  (BigRep, Formfutura, SNIPPET).

Further rules (standard practice, UNVERIFIED): alignment features on every cut
(metal dowel pins, tongue and groove, dovetail keys); keep cuts out of
high-stress regions; budget the stack-up across every joint; glue joints with
registration and a 0.1 to 0.2 mm bond gap for epoxy (gap number UNVERIFIED).

## 12. No numeric source found

Heat staking, zip-tie slots, O-ring grooves in prints, threaded lids,
D-shafts, RFID and spring embedding, glue bond-line gap, reuse count for
screws in plastic, measured magnet loss on hot beds; fatigue data for
flexures; a print-specific square-nut clearance. Flexures (section 9) and
square nuts (section 3) now have practitioner and vendor guidance but no
measured numbers. Interim values above are labeled UNVERIFIED or PRACTITIONER;
prove them with a coupon ([test coupons](test-coupons.md)). For O-ring glands use a standard gland
calculator (this repository's **enclosure-cad** cites the Parker O-ring
handbook) and treat FDM sealing as unproven without post-processing: layer
lines leak.
