# Lane 04: Hardware in FDM prints, fits and tolerances, Bambu Lab specifics, calibration coupons

Research lane for the "DFM for 3D printing" playbook an AI CAD agent will follow.
Accessed 2026-11-12. American English. Quotes are kept under 15 words; everything else is paraphrased.
Tags used below:
- **[VERIFIED: source]** = number read on the cited page during this research.
- **[SNIPPET]** = number seen in a search-result excerpt of the cited page, page not opened in full.
- **UNVERIFIED** = common practice or my engineering inference, not confirmed at a source in this research.
- **CONSERVATIVE** = the value to use when sources disagree and the agent has no test print yet.

---

## 0. Ten rules the agent should always apply (summary)

1. **State every clearance as "per side (radial)" AND "diametral (total)".** Never write "0.2 mm clearance" alone. Diametral = 2 x per side for round features; for a rectangular lid each axis also gets 2 x per side.
2. **FDM holes print undersized**, typically 0.1 to 0.25 mm on the diameter on tuned machines (CNC Kitchen measured 0.1 mm on a Prusa MK2.5 and about 0.25 mm on a CORE One L). Model holes oversize, or use slicer XY hole compensation, never both without accounting for it.
3. **Bambu Studio "X-Y hole compensation" is a per-side value.** The Bambu wiki states the hole diameter grows by twice the entered value. Same for contour compensation.
4. **Heat-set insert holes:** use the insert maker's nominal finished hole (CNC Kitchen / ruthex M3 = 4.0 mm) and add about 0.2 to 0.3 mm in CAD for an as-printed hole; blind depth = insert length + at least 1 mm; respect the minimum wall; straight hole unless the insert is a tapered type.
5. **Captured nuts:** model the hex by its width across flats + 0.2 to 0.3 mm (diametral, i.e. +0.1 to 0.15 per flat), put a flat parallel to the bed, and prefer a nut loaded from the side opposite the load (bottom pocket), which CNC Kitchen found nearly 2x stronger than a side slot.
6. **Magnets:** pocket diameter = magnet + 0.1 to 0.15 mm (press) or + 0.2 to 0.3 mm (glue), depth = magnet + 0.1 to 0.5 mm; when fully enclosed, keep the cover to about 2 layers; secure it so it cannot jump to the steel nozzle; standard N grades are limited to about 80 C.
7. **Pause-at-layer:** in Bambu Studio and PrusaSlicer the pause is inserted *before* the selected layer prints. Pick the first layer that would close the cavity, then verify in the preview that the cavity is still open at the pause.
8. **Snap fits:** size with the cantilever equations below; use about 60% of the one-time allowable strain for repeated use, halve it again for beams loaded across layers (Z), never build the beam vertically if avoidable, fillet the root (R >= 0.5 t).
9. **Elephant's foot** makes the first 1 to 3 layers oversize. Chamfer bottom edges (about 0.4 to 1 mm or 45 degrees) on any mating face that touches the bed, and/or set elephant foot compensation.
10. **Before printing a large mating part, print a slice / unit test** of the critical interface (a thin ring, a 2 to 5 mm thick section through the joint), under the same printer, filament, profile and orientation.

---

## Part A. Hardware embedded in or joined to FDM prints

### A1. Heat-set threaded inserts

#### A1.1 Hole table (metric and common imperial)

Primary source: CNC Kitchen "Dimensions & Design Guidelines" poster PDF [VERIFIED]. D2 is the *finished* hole diameter (nominal), not the CAD diameter. CNC Kitchen states printed holes come out smaller and they personally add about 0.2 to 0.3 mm in CAD for small inserts [VERIFIED: "Are our heat-set insert datasheets wrong?"].

| Thread | Insert L (mm) | Insert OD D1 (mm) | Nominal hole D2 (mm) | Suggested CAD hole, as-printed (D2 + 0.2 to 0.3) | Min blind depth (L + 1) | Min wall W (mm) | Notes |
|---|---|---|---|---|---|---|---|
| M2 x 3 | 3.0 | 3.6 | 3.2 | 3.4 to 3.5 | 4.0 | 1.3 | |
| M2.5 x 4 | 4.0 | 4.6 | 4.0 | 4.2 to 4.3 | 5.0 | 1.6 | |
| M3 x 5.7 (standard) | 5.7 | 4.6 | 4.0 | 4.2 (tested sweet spot) | 6.7 | 1.6 | ruthex RX-M3x5.7 also 4.0 mm hole [VERIFIED via CNC Kitchen test text] |
| M3 x 3 (short) | 3.0 | 4.6 | 4.0 | 4.2 | 4.0 | 1.6 | |
| M3 x 5 x 4 ("Voron") | 4.0 | 5.0 | 4.4 | 4.6 to 4.7 | 5.0 | 1.6 | |
| M4 x 8.1 | 8.1 | 6.3 | 5.7 | 5.9 to 6.0 | 9.1 | 2.1 | ruthex M4 hole 5.6 [SNIPPET: ruthex drill set "5.6 + 6.4 + 8mm"] |
| M4 x 4 | 4.0 | 6.3 | 5.7 | 5.9 to 6.0 | 5.0 | 2.1 | |
| M5 x 9.5 | 9.5 | 7.1 | 6.5 | 6.7 to 6.8 | 10.5 | 2.6 | ruthex M5 hole 6.4 [SNIPPET] |
| M5 x 5.8 | 5.8 | 7.1 | 6.5 | 6.7 to 6.8 | 6.8 | 2.6 | |
| M6 x 12.7 | 12.7 | 8.7 | 8.1 | 8.3 to 8.4 | 13.7 | 3.3 | ruthex M6 hole 8.0 [SNIPPET] |
| M8 x 12.7 | 12.7 | 10.2 | 9.7 | 9.9 to 10.0 | 13.7 | 4.5 | |
| M10 x 12.7 | 12.7 | 12.6 | 12.0 | 12.2 to 12.3 | 13.7 | 6.0 | |
| #2-56 x 3.2 | 3.2 | 3.6 | 3.2 | 3.4 to 3.5 | 4.2 | 1.3 | |
| #4-40 x 5.7 | 5.7 | 4.6 | 4.0 | 4.2 | 6.7 | 1.6 | |
| #6-32 x 7.1 | 7.1 | 5.4 | 4.8 | 5.0 to 5.1 | 8.1 | 1.8 | |
| #8-32 x 8.2 | 8.2 | 6.3 | 5.7 | 5.9 to 6.0 | 9.2 | 2.1 | |
| #10-24 / #10-32 x 9.5 | 9.5 | 7.1 | 6.5 | 6.7 to 6.8 | 10.5 | 2.6 | |
| 1/4"-20 x 12.7 | 12.7 | 8.7 | 8.1 | 8.3 to 8.4 | 13.7 | 3.3 | camera thread |
| 5/16"-18 x 12.7 | 12.7 | 10.2 | 9.7 | 9.9 to 10.0 | 13.7 | 4.5 | |
| 3/8"-16 x 12.7 | 12.7 | 12.5 | 12.0 | 12.2 to 12.3 | 13.7 | 6.0 | |

Through holes need not be longer than the insert [VERIFIED: CNC Kitchen tips].

**Disagreements and alternatives:**
- Hole nominal: CNC Kitchen poster M4 = 5.7, M5 = 6.5, M6 = 8.1. ruthex / generic charts M4 = 5.6, M5 = 6.4, M6 = 8.0 [SNIPPET: ruthex listing; accu-components chart "5.6 mm (-0/+0.1)", "6.4", "8.0"]. Differences are 0.1 mm and track the specific insert OD. **Use the datasheet of the insert actually specified.** CONSERVATIVE (stronger hold): the smaller value; CONSERVATIVE (easier install, fewer burrs): the larger value.
- CAD offset: creative3dp tool recommends M3 4.24, M4 5.83, M5 6.63, M6 8.23 for PLA, slightly more for PETG/ABS/nylon [SNIPPET]. Hydra Research rule of thumb: model the insert hole at 98% of the insert OD [SNIPPET]. These all land near nominal + 0.2 mm.
- Depth: CNC Kitchen L + 1 mm [VERIFIED]; creative3dp L + 0.5 mm [SNIPPET]; Spirol (injection molding insert maker) L + 2 thread pitches minimum [VERIFIED: Spirol PDF]. CONSERVATIVE: L + 1 mm or more.
- Min wall: CNC Kitchen per-size W above [VERIFIED]; creative3dp 1.5 / 2.0 / 2.5 mm for M3 / M4 / M5+ [SNIPPET]; Markforged says consider a smaller insert if less than 2 mm of material surrounds and lies below it [VERIFIED]; Spirol boss OD = 2 to 3 x insert OD [VERIFIED]. CONSERVATIVE: boss OD >= 2 x insert OD and >= 2 mm wall, and set walls/perimeters in the slicer (or a modifier) so the wall is solid plastic, not infill.
- Chamfer: CNC Kitchen says normally no chamfer needed [VERIFIED]; creative3dp calls a 1 mm x 45 degree entry chamfer mandatory [SNIPPET]. A small lead-in does no harm on a straight hole. CONSERVATIVE: 0.3 to 0.5 mm chamfer, never so large that the knurl loses engagement at the top (UNVERIFIED sizing).
- Taper: CNC Kitchen holes should be straight, not tapered [VERIFIED]. Spirol: straight holes max 1 degree included; tapered inserts only in 8 degree included-angle tapered holes [VERIFIED]. Markforged uses a tapered counterbore for its (tapered) inserts [VERIFIED]. Rule: match the hole to the insert type; for the common 3D-print brass inserts (CNC Kitchen, ruthex) use straight holes.

#### A1.2 Installation method (step by step)

1. Print the part with extra perimeters around the boss (local modifier mesh is fine) [VERIFIED: CNC Kitchen transcript recommends modifier meshes for local walls].
2. Set the iron 10 to 20 C above the print temperature: about 225 C PLA, 245 C PETG, 265 C ABS [VERIFIED: CNC Kitchen tips]. (Markforged recommends 343 to 399 C for its nylon-based materials [VERIFIED], which shows the range is material-specific.)
3. Pre-seat the insert by its pilot in the hole (a correct hole lets it sit with slight resistance) [VERIFIED].
4. Use a dedicated insert tip with a centering pin; melt in with light force.
5. Stop at about 90% depth, remove the iron, press the last part flush with a flat tool (screwdriver, insert straightener) and hold a few seconds until solid, because inserts creep back out right after melting [VERIFIED].
6. Large inserts (M5, 1/4"-20): thicker tip, slightly more temperature, maximize contact [VERIFIED].
7. Inspect the back of a through hole for a burr; a burr means the hole was too small [VERIFIED].
8. Resin prints: inserts cannot be melted; glue them (thick CA or epoxy) into a stepped hole, enlarging in 0.1 mm steps if tight [VERIFIED].

#### A1.3 Load side versus pull side

- Markforged: put inserts on the face *opposite* the mating part, so bolt load pushes the insert deeper into the part instead of pulling it out; the tapered body then bears against the hole [VERIFIED: Markforged heat-set insert blog].
- Spirol: the clearance hole in the mating part must be larger than the screw but smaller than the insert pilot/face so the insert cannot "jack out" through it [VERIFIED].
- Rule for the agent: when the joint carries significant tension, install the insert from the side away from the clamped part, or ensure the mating part covers the insert face.

#### A1.4 Strength data (M3 and M5, PLA and PETG)

| Test | Result | Source |
|---|---|---|
| M3 insert pull-out vs hole size, PolySonic PLA, CORE One L | about 1400 N (about 150 kg) at small holes; 4.2 mm CAD hole retains about 90% of max; strength falls off a cliff when too large (drilled-hole drop between 4.1 and 4.2 mm) | CNC Kitchen "datasheets wrong" [VERIFIED] |
| M3 pull-out, Prusament PLA, 100% infill | ruthex 181 kg, eBay 157 kg, cheap molding insert 39 kg, screw directly into undersized 2.7 mm hole 142 kg | CNC Kitchen cheap vs expensive [VERIFIED] |
| M3 torque-out, PLA | all inserts 3 to 4 Nm (bolt head sheared first); direct screw about 1 Nm | same [VERIFIED] |
| M3 in PETG, 4 perimeters, 100% infill | torque-out: direct screw 1 Nm, Helicoil 1 Nm, nut pockets 2 Nm, insert 3 Nm. Pull-out: direct 118 kg, insert 119 kg, Helicoil 120 kg, side-slot nut 86 kg, bottom-pocket nut 166 kg | CNC Kitchen helicoils vs inserts vs nuts [VERIFIED] |
| M5 threads, 8 mm length, PLA | direct, tapped, modeled threads all just under 2000 N pull-out; inserts up to almost 3000 N; torque-out plastic threads 3 to 4 Nm vs inserts about 10 Nm (brass failed first) | CNC Kitchen YouTube transcript "Threaded inserts in 3D prints - how strong" [VERIFIED] |
| Context | 1 Nm on an M3 bolt already gives more than 1500 N pretension (friction 0.14) | CNC Kitchen helicoils [VERIFIED] |

Failure modes: insert spins (shallow knurl in soft ASA) [VERIFIED]; burr below insert blocks screw (hole too small) [VERIFIED]; only partial knurl engagement (hole too big) [VERIFIED]; boss splits (thin wall) [SNIPPET: creative3dp]; insert proud or crooked (no final flat press) [VERIFIED].

### A2. Captured nuts

| Item | Rule | Source |
|---|---|---|
| Pocket size | Model across flats (not across corners) + clearance. M3 nut 5.5 mm AF -> 5.8 mm pocket; M5 8.3 mm | Loftsmith [SNIPPET] |
| Clearance alternatives | 0.2 to 0.4 mm total (0.1 to 0.2 per side) | 3dprintcalcs [SNIPPET] |
| | 0.05 mm per side (0.1 diametral) for a close fit (Markforged machine) | Markforged embedding nuts [SNIPPET] |
| | 0.2 to 0.3 mm lateral + 0.1 mm vertical headroom | createit3d [SNIPPET] |
| | M3 AF 5.74 mm in PLA on 0.4 nozzle | creative3dp tool [SNIPPET] |
| Depth | nut height + 0.2 to 0.3 mm (M3: about 2.7 mm) | Loftsmith, creative3dp [SNIPPET] |
| Orientation | Flat toward the bed so the pocket roof bridges as a straight edge, not a pointed corner | Loftsmith [SNIPPET] |
| Strength | Bottom pocket (nut bears against the bulk of the part) 166 kg vs side slot 86 kg in PETG M3; both nut types torque-out at about 2 Nm by crushing PETG | CNC Kitchen [VERIFIED] |
| Annoyance | Nuts fall out of loose pockets; tight pockets are hard to load | CNC Kitchen [VERIFIED] |

CONSERVATIVE pocket: AF + 0.3 mm diametral (0.15 per flat) for a drop-in nut held by the screw; AF + 0.1 to 0.15 mm for a press-in nut. Validate with a nut-pocket ladder coupon (section D).

Methods:
- **Side slot ("nut trap")**: slot from the side, width = AF + clearance, extends past the bolt axis. Easy, no pause, weaker (shear plane is short) [VERIFIED weaker].
- **Bottom/back pocket**: pocket opens on the face opposite the load; strongest [VERIFIED].
- **Embedded with pause**: model a closed hex cavity, pause at the first layer over the cavity, drop the nut, resume. A YouTube commenter describes erasing support in the cavity and pausing at the top of the cavity [SNIPPET]. The bolt hole above the nut must bridge: use the **sacrificial bridging / stepped "hole over hole" trick**: one layer-height rectangle tangent to the hole, then a second, rotated 90 degrees, at twice the layer height, so each layer bridges straight [SNIPPET: Hydra Research "unsupported holes" steps].
- **Square nuts**: slot fits square nuts well and they do not need a flat-down orientation; same clearance logic across flats (UNVERIFIED, no 3D-print-specific source found).

### A3. Embedded magnets

| Parameter | Value | Source |
|---|---|---|
| Press-fit pocket | magnet dia + 0.1 to 0.15 mm (diametral) | totalElement [VERIFIED] |
| Glue pocket | magnet dia + 0.2 to 0.3 mm (diametral) | totalElement [VERIFIED] |
| Test result, 6 x 2 mm disc | 6.1 too tight; 6.2 firm press, stayed put while printed over; 6.3 loose, pulled out by the nozzle | DraftID [VERIFIED] |
| Starting point | +0.1 mm clearance, then test | dphacks [SNIPPET] |
| Pocket depth (open pocket, flush) | magnet + 0.1 to 0.2 mm | totalElement [VERIFIED] |
| Pocket depth (enclosed, pause) | magnet + 0.4 to 0.5 mm (2.4 to 2.5 mm for a 2 mm magnet) so the nozzle never scrapes | DraftID [VERIFIED] |
| Cover thickness | at least 2 layers (0.4 mm at 0.2 mm layers); 2 to 4 layers | DraftID, totalElement [VERIFIED] |
| Cover vs pull force | 6 x 2 mm N52 to steel: 0.4 mm skin leaves about 45% of pull; 1 mm skin about 21% | totalElement [VERIFIED] |
| Temperature | standard N magnets rated about 80 C; beds above 80 C, heated enclosures, annealing and nozzle contact are risks | totalElement [VERIFIED] |
| Grades | M about 100 C, H about 120 C, SH about 150 C, UH about 180 C, EH about 200 C max working temperature | Apex Magnets, Stanford Magnets [SNIPPET] |
| Jump to nozzle | magnets must be firmly seated or glued, or they stick to the print head | Prusa KB [VERIFIED snippet of KB]; Prusa forum: even 5 mm below the nozzle a magnet can be pulled up; steel nozzles attract [SNIPPET] |
| Polarity | mark one face of the whole stack with a marker before separating; decide "marked face out" per part and write it on the design; use a finished part as a jig | totalElement, DraftID [VERIFIED] |

Rules for the agent:
- The pocket diameter values above are **diametral**. Per side they are 0.05 to 0.075 (press) and 0.1 to 0.15 (glue).
- Magnets near the bed: PLA bed 55 to 65 C is under the N-grade 80 C limit; ABS/ASA/PC beds at 90 to 110 C, or 50 to 65 C heated chambers plus bed heat, can partially demagnetize standard N grades (inference from the 80 C rating; UNVERIFIED as measured loss). Insert magnets after printing (open pocket + glue) or specify H/SH grade for hot materials.
- Hardened-steel nozzles (standard on P2S, X2D, H2D, H2S, H2C, H3C per their spec pages) are magnetic; brass/stainless less so (UNVERIFIED for stainless grade). Always press-fit or glue the magnet before resuming.
- Design the cover so the attracting face is on the thin skin side, and the 2-layer skin is printed as a solid top layer.

### A4. Other items embedded with a pause (bearings, weights, nuts, rods, RFID, springs)

General method (applies to all):
1. Model a closed cavity = item size + clearance (press values for items that must not move, glue values otherwise) and depth = item height + 0.2 to 0.5 mm so nothing protrudes above the current layer (derived from the magnet rules; UNVERIFIED for each item type).
2. Avoid support inside the cavity (block it); the cavity roof must bridge or be a 45 degree / teardrop roof.
3. Slice, scroll the layer slider to the first layer that would cover the cavity, and add the pause there.
   - **Bambu Studio**: right-click the layer slider "+" and choose Add Pause. The printer stops *before* printing that layer and waits for a manual resume [VERIFIED: Bambu wiki "View slicing information"]. The pause G-code used by Bambu printers is `M400 U1` [SNIPPET: Bambu forum].
   - **PrusaSlicer**: right-click the orange "+" and choose Insert pause print (M601); inserted before the selected layer; needs PrusaSlicer 2.2+; does not work with sequential printing; MK3 firmware 3.9.1+ [VERIFIED: Prusa KB]. Custom G-code at layer is also available (for example M300 beep) [SNIPPET].
   - **OrcaSlicer**: same slider workflow as Bambu Studio (UNVERIFIED in this research).
4. **Disagreement on which layer**: Bambu wiki says pause on layer N stops before N prints [VERIFIED]. DraftID tells users to step back one layer from the first covering layer [VERIFIED]. Some Prusa users report the pause landing one layer late [SNIPPET: Prusa KB comments]. CONSERVATIVE: pause one layer early if the cavity is 0.4 mm or more deeper than the item (the item still sits below the top), and always check in preview that the cavity is open at the pause layer.
5. During the pause: bed heat is kept so the part does not release [SNIPPET: Bambu forum]; users report the nozzle cooling while paused (for example to about 90 C) and needing to reheat on resume [SNIPPET, UNVERIFIED]. Ooze during long pauses can leave an incomplete first resumed layer [SNIPPET: Prusa KB comments]. Do not touch or shift the part; insert items quickly.
6. Weights (steel shot, washers), RFID tags (thin, keep metal away), springs (compress and capture under a lid or keep within the cavity) follow the same rule (UNVERIFIED item-specific numbers).

Bearings and rods with a pause: a bearing pressed in during a pause must not protrude; full-height captive bearings need their own cavity clearance; for press-fits after printing see A6.

### A5. Screws directly into plastic and printed threads

| Approach | Pilot / geometry | Source |
|---|---|---|
| Self-tap machine screw (M3) | 2.7 mm hole (CNC Kitchen default); 2.6 mm (Loftsmith) | [VERIFIED CNC Kitchen], [SNIPPET Loftsmith] |
| Self-tap machine screw (M5) | minor diameter modeled, 4.5 mm (tap or direct) | CNC Kitchen transcript [VERIFIED]; Loftsmith 4.4 [SNIPPET] |
| Rule of thumb | tap: 90% of major dia; self-tap: 96% of major dia; insert: 98% of insert OD | Hydra Research [SNIPPET] |
| Thread-forming plastic screws (EJOT PT / DELTA PT) | hole = 0.8 x d1 (up to 0.88 x d1 for filled/strong plastics), tolerance +/- 0.05 mm; engagement depth 2 x d1; draft in core hole max 1 degree | EJOT brochures [SNIPPET] |
| Boss OD for thread-forming screws | about 2 to 2.5 x d1 (common molding guideline) | UNVERIFIED (not shown in fetched snippet) |
| Modeled (printed) threads | Hydra Research: only for M5 / #10 and larger; never in horizontal holes. CNC Kitchen: printed M3 worked without offsets in both orientations, but horizontal printed threads were weakest | [SNIPPET], [VERIFIED] |
| Layer height vs pitch | layer height 1/4 to 1/2 of pitch | JLC3DP [SNIPPET] |
| Side holes with threads | cut away the top and bottom of the thread profile (flats) so no sagging overhang; or use a hex hole that the screw cuts into, relief in corners | Slant 3D transcript [VERIFIED] |

Rules and failure modes:
- Direct screwing adds hoop stress that can split the part; CNC Kitchen recommends plastic-specific screws for direct fastening [VERIFIED transcript]. Slant 3D: use hexagonal holes (screw bites flats, debris falls into corners), vertical relief slots about 0.2 mm, or reinforcement micro-features (0.1 to 0.2 mm slots that force extra walls; most slicers close gaps under 0.05 mm) [VERIFIED].
- Torque limit for direct M3 in PLA/PETG is about 1 Nm [VERIFIED]; overtightening strips threads and the pull-out strength is lost [VERIFIED].
- Reuse count: CNC Kitchen states plastic threads wear quickly with repeated assembly, inserts do not [VERIFIED qualitative]. No numeric cycle count was found; UNVERIFIED rule: plan for under about 10 cycles for direct-to-plastic machine screws, use inserts for anything serviced regularly.

### A6. Press-fit dowels, bearings, shafts

| Case | Guidance | Source |
|---|---|---|
| 608 bearing (22 mm OD) | design 22.1 to 22.4 mm hole (diametral +0.1 to +0.4) to get a near-22 mm printed hole | 3D Printing StackExchange [SNIPPET] |
| Bearing press | about 0.05 to 0.10 mm interference per side on the printed result | meshra [SNIPPET] |
| Crush ribs | make the hole slightly too large and add small ribs the bearing crushes; tolerant of printer variation | newscrewdriver [SNIPPET]; AON3D: about 2 degree taper plus 0.2 mm crush ribs [SNIPPET] |
| Metal pin in plastic | 3 mm pin -> 3.2 mm printed hole (0.1 per side, "some force") | StackExchange [SNIPPET] |
| Side holes for pins | grip fins: cut slots beside the hole to create two flexing fins, 0.2 mm gap top and bottom, about 1 mm space behind; thicker or shorter fins grip harder | Slant 3D [VERIFIED] |

D-shafts: model the D flat with the same per-side clearance as the round portion; orient the hole vertical so the flat is an accurate wall (UNVERIFIED, no dedicated source). Shafts printed horizontally sag at the top; for a horizontal hole use a teardrop/roof or print the part at 45 degrees with a support rib (Slant 3D prints the brick on a diagonal with a 2 mm bottom chamfer and a 1 mm rib with 0.5 mm tines) [VERIFIED].

### A7. Snap fits

**Equations (rectangular, constant cross-section cantilever; Bayer/Covestro and BASF guides):**
- Permissible deflection: y = 0.67 x eps x L^2 / h (eps = allowable strain, L = beam length, h = root thickness) [SNIPPET: Synectic citing Bayer; BASF].
- Deflection force: P = b x h^2 x E_s x eps / (6 L) (b = width, E_s = secant modulus) [SNIPPET].
- Mating (push-on) force: W = P x (mu + tan alpha) / (1 - mu x tan alpha), alpha = lead angle; same with return angle alpha' for pull-off; 90 degree return = non-releasable [SNIPPET: BASF, Fictiv].
- BASF form with deflection magnification factor Q: eps = 1.5 x t x Y / (L^2 x Q) [SNIPPET: BASF].
- Tapered beam (thickness falling linearly to half at the tip) gives more uniform strain; Bayer says a constant section uses 17% more material with 46% higher strain than the optimal taper [SNIPPET: Bayer].
- Repeated use: Bayer example uses 60% of the one-time permissible strain (2.5% -> 1.5% for PC/ABS) [SNIPPET].

**Allowable strain (one-time, molded) and FDM adjustments:**

| Material | BASF (unfilled) | Fictiv (3D printed) | Notes |
|---|---|---|---|
| ABS | 6 to 7% | 7% | Bayer PC/ABS one-time 2.5% |
| PC | 4 to 9.2% | | |
| Nylon 6 | 8% (use 4% for mating force) | 4 to 15% | |
| Acetal (POM) | 7% | | |
| PLA | | 4 to 8% | Hubs: PLA is brittle, prefer ABS/PETG/nylon |

Fictiv: Z-axis cantilevers lose about 50% elongation and 20 to 30% tensile strength; halve allowable stress/strain for Z-built beams [SNIPPET]. CONSERVATIVE for FDM: eps = 1% (PLA) to 2% (PETG/ABS) for multi-use XY beams; half that if the beam bends across layers (UNVERIFIED numbers, derived from the above).

**FDM rules:**
- Print the beam lying in XY so bending is along filaments; avoid vertical (Z) cantilevers [VERIFIED: Hubs].
- Fillet the root, radius at least 0.5 x root thickness [VERIFIED: Hubs]; BASF stress concentration factor drops from 1.78 at R/h = 0.4 to 1.41 at R/h = 1.0 [SNIPPET].
- Minimum width 5 mm, taper toward the tip, deflect only during assembly (no preload in service), add lugs to carry shear [VERIFIED: Hubs].
- Clearance: Hubs nominal 0.5 mm for FDM snap fits (0.3 SLS/SLA/MJF) [VERIFIED; per side vs total not stated]; Fictiv 0.3 mm close-fit snap, 0.2 tight, 0.4 slide/pivot [SNIPPET].
- Lead angle under 45 degrees for manufacturability/usability [SNIPPET: Synectic]; friction mu for ABS 0.5 to 0.65, PC 0.45 to 0.55, nylon 0.3 to 0.4 [SNIPPET: Bayer].

### A8. Living hinges, print-in-place hinges, flexures

| Feature | Value | Source |
|---|---|---|
| FDM living hinge | 0.4 to 0.6 mm thick, at least 2 layers; best in nylon | Hubs [SNIPPET] |
| PLA living hinge | 0.4 mm survives about 50 to 100 folds | uavmodel blog [SNIPPET] (low confidence) |
| PLA / PETG living hinge thickness | 0.3 to 0.6 PLA, 0.4 to 0.8 PETG | printstack [SNIPPET] |
| Print-in-place hinge (PLA, 0.4 nozzle, 0.2 layer) | 0.25 mm radial per side (0.50 diametral) | Sovol [SNIPPET] |
| Moving clip arms vs guide | 0.20 to 0.25 mm radial | 3dprintbook [SNIPPET] |
| Maker's Muse gauge | 0.2 mm gap freed on a tuned Prusa MK3; 0.15 partly welded where seams start/stop | Maker's Muse transcript [VERIFIED] |
| MJF reference | 0.4 mm mating gap, about 0.7 mm for printed-in moving joints | rapidmade citing HP [SNIPPET] |

Rules: print living hinges so filaments run across the hinge (bend line perpendicular to extrusion direction), flat on the bed (UNVERIFIED wording, standard practice). Print-in-place Z gaps (between a top surface and the underside of the part above) need at least one full layer, preferably 2 layers, and the overhanging face should be 45 to 60 degrees, since Maker's Muse gauge uses 60 degree overhangs top and bottom [VERIFIED 60 degrees]; the 2-layer figure is UNVERIFIED. Seams (start/stop blobs) weld tight gaps first [VERIFIED Maker's Muse].

Flexures/compliant mechanisms: no numeric FDM source found in this research (see Gaps). Slant 3D's grip fins are an example of a compliant feature [VERIFIED].

### A9. Dovetails and sliding joints

- Offset the cut-out 0.2 mm for small parts, 0.4 mm for larger parts (Formlabs, interlocking joints; offset meaning not specified as per side) [SNIPPET].
- Markforged: angled sliding geometry (flared walls) prints without support and can include a detent at the end [SNIPPET].
- Bambu Studio cut connectors (plug, dowel, snap): set cut tolerance 0.15 to 0.3 mm if connectors do not fit [VERIFIED: Bambu wiki large files]; a Reddit tester used 0.10 [SNIPPET]. Per side vs total is not stated by Bambu (see Gaps).
- Long sliding fits bind from Z misalignment; give extra clearance on long joints [SNIPPET: StackExchange].

### A10. Glue joints, solvent welding, staking

| Material | Method | Source |
|---|---|---|
| PLA | cyanoacrylate (small close joints), epoxy (gaps, more working time); PLA itself is often the weak point | BigRep, Formfutura [SNIPPET] |
| PETG | CA or epoxy; Bambu wiki recommends 2-part epoxy for PETG/ABS | BigRep [SNIPPET], Bambu wiki [VERIFIED] |
| ABS / ASA | solvent welding with acetone (ventilate, flammable); not reliable for PLA or PETG | BigRep, Formfutura [SNIPPET] |
| Prep | sand and clean joint faces before gluing | Bambu wiki [VERIFIED] |
| Soldering-iron / friction welding | possible for all three; useful for large prints and repair | Formfutura [SNIPPET] |

Design glue joints with registration (dowels, tongue and groove) and a controlled 0.1 to 0.2 mm bond gap for epoxy (UNVERIFIED gap number). Heat staking / ultrasonic: CNC Kitchen inserts can be installed ultrasonically [VERIFIED]; no FDM heat-staking design source was fetched (Gaps).

### A11. Zip-tie features, gaskets/O-rings, threaded lids

No 3D-print-specific numeric sources were fetched for these (Gaps). Interim guidance, all UNVERIFIED:
- Zip-tie slots: slot width = tie width + 0.5 mm, height = tie thickness + 0.5 mm, bridge length short, round the edges.
- O-ring grooves: use a standard gland calculator (20 to 30% squeeze for static seals is the general elastomer guideline [SNIPPET: general gland references]); FDM groove walls are rough and layer lines leak, so print the groove in a top surface or the sealing land vertical, use 100% infill/extra walls around the groove, and test with water. Treat FDM gland sealing as not guaranteed without post-processing.
- Threaded lids: use coarse pitch (3 to 5 mm), trapezoidal or buttress profile, thread axis vertical, 0.3 to 0.5 mm radial clearance, start the thread with a lead-in chamfer.

### A12. Multi-part design for a small bed

From the Bambu wiki large-file guide [VERIFIED]:
- Cut where the seam is least visible / structurally sensible (example: horizontal cut through the midsection).
- Orient each piece to minimize supports, maximize strength and surface quality; flat cut faces on the bed give the cleanest result.
- Add connectors (plug, dowel, snap) in the cut tool; give pegs extra wall thickness; same profile, layer height and filament on every piece for matching texture.
- Avoid supports on cut faces (paint them off or put the face on the bed).
- Glue: CA for PLA, 2-part epoxy for PETG/ABS; sand and clean.
- Space parts on the plate or use separate plates.

Additional rules (UNVERIFIED but standard): put alignment features (dowel holes for metal pins, tongue/groove, dovetail keys) on every cut; keep cuts out of high-stress regions; split along a plane parallel to the bed for one part and perpendicular for the other only when strength allows (layer direction matters); budget the tolerance stack across every joint (see B6).

---

## Part B. Fits, clearances and tolerances

### B1. Achievable accuracy on modern consumer FDM

| Claim | Source |
|---|---|
| Well-calibrated FDM: about +/- 0.2 mm XY, +/- 0.1 to 0.2 mm Z | GrandpaCAD calculator [SNIPPET] |
| Budget printer: +/- 0.3 to 0.5 mm | cc3dlabs citing 3dput [SNIPPET] |
| Holes print 0.1 mm undersize (Prusa MK2.5, Prusament) and about 0.25 mm undersize (CORE One L, PolySonic PLA) in diameter | CNC Kitchen [VERIFIED] |
| Bambu user report: holes consistently 0.25 mm small; compensating 0.25 oversized them by 0.25 (shows the per-side doubling) | Reddit r/BambuLab [SNIPPET] |
| Bambu X2D: 50 micron accuracy across the build volume; H2D: 50 um motion accuracy (motion, not part accuracy) | Bambu product pages [VERIFIED] |
| Causes of undersize holes: material shrink, STL facet chords inside the true circle, bead laying | CNC Kitchen [VERIFIED], nophead polyholes (linked) |

Protolabs' 3D printing tolerance page did not expose FDM numbers in the fetched text (Gaps).

### B2. Clearance table: PER SIDE and DIAMETRAL

"Per side" = radial gap between one wall and its mate. "Diametral" = hole dia minus shaft dia (round) or slot width minus tongue width (prismatic) = 2 x per side. Values are **design (CAD) clearances on a calibrated printer with no slicer hole compensation**, unless noted.

| Fit | Per side (mm) | Diametral (mm) | Use | Sources and how they stated it |
|---|---|---|---|---|
| Interference / press (permanent) | 0 to +0.05 CAD (printed result about -0.05 to -0.10 interference) | 0 to +0.1 CAD | dowels, bearings, magnets, press nuts | Sovol 0.05 to 0.15 "per side"; Markforged press 0.00 to 0.05 (unstated); totalElement magnet +0.1 to 0.15 diametral; DraftID 6.0 magnet in 6.2 hole = +0.1 diametral; meshra 0.05 to 0.10 interference per side (printed); cc3dlabs -0.1 to -0.2 interference (unstated) |
| Snug / location (push by hand, no play) | 0.1 | 0.2 | locating pins, lids that must not rattle | StackExchange 0.1 per side "fit with some force"; Prusa forum "0.2 mm difference" reasonable fit (diametral); Markforged close fit 0.05 to 0.10 (unstated) |
| Slip / sliding | 0.15 to 0.25 | 0.3 to 0.5 | drawers, rails, removable lids, pins that rotate slowly | StackExchange 0.2 per side "without force"; Sovol 0.2 to 0.3 per side (PLA 0.15 to 0.25, PETG 0.2 to 0.3, ASA 0.25 to 0.35); GrandpaCAD sliding 0.3 to 0.5 on diameter; Fictiv 0.4 slide/pivot (unstated) |
| Free running / clearance | 0.25 to 0.4 | 0.5 to 0.8 | shafts that spin, loose assemblies | GrandpaCAD clearance 0.5 to 0.8 on diameter; cc3dlabs 0.4+ "for free movement" |
| Print-in-place (parts printed assembled) | 0.25 to 0.4 XY; Z gap >= 1 to 2 layers | 0.5 to 0.8 | hinges, chains, gears printed assembled | Sovol PIP hinge 0.25 per side (0.5 dia); Maker's Muse 0.2 frees on tuned printer, 0.3+ on average machines; xzw test spans 0.2 to 0.6 |
| Snap-fit mating clearance | 0.25 to 0.5 | 0.5 to 1.0 | clearance around the snap body | Hubs 0.5 (unstated); Fictiv 0.3 close fit |
| Cut connectors (Bambu Studio) | 0.15 to 0.3 setting | unknown | plug/dowel connectors | Bambu wiki (unstated whether per side) |

**CONSERVATIVE defaults for an agent with no test data, 0.4 mm nozzle, PLA/PETG, calibrated Bambu:** press 0.05 per side / 0.1 dia (then test), snug 0.1 / 0.2, sliding 0.2 / 0.4, free 0.3 / 0.6, print-in-place 0.35 / 0.7 with 0.3 to 0.4 mm Z gap. For PETG add 0.05 per side; for ASA/ABS add 0.05 to 0.1 per side (Sovol material deltas).

### B3. The per-side versus diametral error

Sources that show or explain the ambiguity:
- Bambu wiki: XY hole compensation increases the hole **diameter by twice** the entered value [VERIFIED] -> the setting is per side.
- Markforged nut embedding: about 0.05 mm on each side, so add 2 x 0.05 = 0.1 to the full dimension [SNIPPET].
- StackExchange answer: 3 mm pin needs 3 + 0.1 x 2 = 3.2 mm hole ("clearance from two sides") [SNIPPET].
- cc3dlabs: values are per side, so a 10 mm pin in a 10.4 mm hole has 0.2 mm each side [SNIPPET].
- Slant 3D-adjacent YouTube comment: unsure whether clearance means total gap or one gap; some apply the full clearance to one part, others half to each [SNIPPET].
- Sovol's own table labels the print-in-place value "~0.3 to 0.4 mm total" and also "per side, not total" [VERIFIED] -> even guides contradict themselves; the agent must normalize every number it reads.
- All3DP: printer tolerance is +/- half the clearance value [VERIFIED].

**Worked examples (0.2 mm per side target = sliding fit):**

1. **Shaft in hole.** 8.00 mm steel shaft, want sliding. Per side 0.2 -> diametral 0.4 -> CAD hole 8.40 mm.
   - Error A (treating 0.2 as diametral): hole 8.20 -> only 0.1 per side -> snug/tight; on a printer whose holes print 0.15 to 0.25 small it becomes a press or does not fit.
   - Error B (applying 0.2 per side to the radius *and* adding XY hole compensation 0.2): hole prints about 8.40 + 0.4 = 8.80 -> 0.4 per side -> sloppy.
   - If the slicer XY hole compensation is set to c (per side), model the hole at 8.40 - 2c.
2. **Lid on a box (two sides in each axis).** Box inner opening 60.00 x 40.00 mm; lid lip should slide in with 0.2 per side. Lid lip outer = 60.00 - 2 x 0.2 = 59.60 by 40.00 - 0.4 = 39.60 mm. Error: subtracting 0.2 total gives 59.80 x 39.80 -> 0.1 per side -> tight; then elephant's foot on the lip's first layers (+0.1 to 0.2 per side) makes it jam. Add a 0.5 mm 45 degree chamfer on the lip's bed edge or print the lip pointing up.
3. **Magnet pocket.** 6.00 x 2.00 mm disc, glue fit 0.1 to 0.15 per side -> pocket 6.20 to 6.30 dia; press fit 0.05 per side -> 6.10 to 6.15 (DraftID found 6.2 was the press on its machine: printer undersize shifts the optimum). Depth: open pocket 2.10 to 2.20; enclosed pocket 2.40 to 2.50 and 0.4 mm cover. Error: reading "+0.2" as per side gives 6.40 -> loose, magnet pulled out by the nozzle (DraftID saw this at 6.3).
4. **Heat-set insert pocket.** M3 x 5.7: nominal finished 4.0 dia; CAD 4.2 (= +0.1 per side). The insert datasheet number is already diametral. Error: adding "0.2 per side" -> 4.4 -> CNC Kitchen's drilled samples lost strength sharply above 4.1 to 4.2 finished.

### B4. How a 0.2 mm per-side clearance behaves on a well-tuned 0.4 mm nozzle printer

- As a gap between two printed surfaces (print-in-place): frees with a little force on a well-tuned machine; Maker's Muse's Prusa MK3 freed 0.2, partly welded 0.15 at seam blobs; an average printer needed 0.3; a poor one needed 0.4 to 0.5 [VERIFIED transcript]. Forum users report Maker's Muse gauge: 0.4 and 0.5 release cleanly, 0.3 needs force [SNIPPET].
- As a pin-in-hole clearance with a metal pin (0.4 mm diametral): "fits edge to edge without force" [SNIPPET StackExchange]; after the hole shrinks 0.1 to 0.25 on diameter it ends up 0.08 to 0.15 per side, a slip-to-sliding fit (inference from CNC Kitchen shrink data).
- In Bambu Studio, an XY hole compensation of 0.2 applied on top of a 0.2 per side model would double this.

### B5. Horizontal vs vertical holes, elephant's foot, compensation

- **Vertical holes** (axis along Z) are round but undersized by facets and shrink [VERIFIED CNC Kitchen]. Export STL with fine tessellation; use more segments on small holes.
- **Horizontal holes** (axis in XY) sag at the top (overhang/bridge), so the top is flattened and tight; CNC Kitchen saw horizontal insert holes come out smaller at the top and suggests a different CAD diameter or better cooling/bridging [VERIFIED]. Fixes: teardrop/roof top (adds slop), hexagonal hole, cut top/bottom flats, print at 45 degrees, relief slots [VERIFIED Slant 3D]. Hydra Research: overhangs under 50 degrees from vertical by default, many printers handle up to 70 [SNIPPET].
- CNC Kitchen insert test blocks include horizontal, vertical and angled holes because each orientation sizes differently [VERIFIED].
- **Elephant's foot**: first layer squashed and soft under bed heat plus weight of layers above; spoils fits on snaps, rails, shaft holes near the bed [VERIFIED Bambu wiki]. Bambu Studio: Process > Quality > Precision > Elephant foot compensation; value = average of (bottom X - top X) and (bottom Y - top Y) measured mid-side, not at corners [VERIFIED]. Design-side fix: chamfer every bed-contacting edge (Slant 3D chamfers the bottom and rounds vertical edges) [VERIFIED].
- **Slicer compensation vs modeling the offset:**
  - Bambu Studio XY hole compensation: per side; affects closed holes only; calibrate with an M6 screw and a hole ladder at 0 compensation, enter the snug-fit hole's offset, iterate; only works on closed paths (open-sided holes delaminate) [VERIFIED].
  - XY contour compensation: shrinks/grows outer contours, per side; calibrate with the Bambu spool center (55 mm) [VERIFIED].
  - Auto circle holes-contour compensation: only full horizontal-plane circles under 50 mm, only some Bambu dry filaments; prints those circles at 200 mm/s, max cooling and a scarf seam; fine-tune in 0.02 mm steps [VERIFIED].
  - Slant 3D argues for designing parts that print correctly in any slicer (geometry fixes rather than printer-specific settings) [VERIFIED].
  - Agent rule: for parts shared or published (MakerWorld), put the clearance in the model and leave compensation at 0; for in-house parts on a calibrated machine, either is fine, but record which was used in the part notes.

### B6. Tolerance stack-up across printed parts

- Worst-case method, illustrated by StackExchange: a 5 mm pin at +/- 0.2 and a hole at +/- 0.2 with 0.2 minimum clearance needs a 5.6 mm nominal hole; the max clearance then becomes 1.0 mm, which is sloppy [SNIPPET]. Each printed interface adds roughly +/- 0.1 to 0.2 mm in XY.
- Rule (standard engineering, UNVERIFIED for FDM specifically): worst case = sum of all tolerances in the chain; statistical (RSS) = sqrt(sum of squares) and is appropriate only with 4+ independent parts. For FDM assemblies, design with worst case, and add adjustment (slots, shims, compliant fins, crush ribs) rather than tighter nominal gaps.
- Protolabs: inaccuracy grows with part size (thermal effects, warp); small features stay accurate but their *position* on a large part drifts [SNIPPET].
- Same-printer effect: printing both mating parts on one printer does not cancel the error. Maker's Muse explains that a gap is needed because the printer makes parts bigger or smaller, so an exact-size fit fails [VERIFIED transcript]. For a printed boss in a printed hole the errors add, because over-extrusion grows the boss and shrinks the hole at the same time (inference, UNVERIFIED by measurement).

---

## Part C. Bambu Lab specifics (lineup as shown on bambulab.com, accessed 2026-11-12)

Models listed on the compare page metadata: H2D, X2D, P2S, P1S, A2L, H2C, H2S, A1, A1 mini, X1C, H3C [VERIFIED]. The buying guide also references H2D Pro and an R1 (no specs found) [VERIFIED names only].

### C1. Model table

| Model | Build volume (mm, W x D x H) | Max nozzle (C) | Max bed (C) | Enclosure / chamber | Nozzles: included / supported | Toolhead count, multi-material | Max speed / accel | Source |
|---|---|---|---|---|---|---|---|---|
| A1 mini | 180 x 180 x 180 | 300 | 80 | open bed-slinger | 0.4 / 0.2, 0.6, 0.8 | 1; AMS lite (UNVERIFIED count on page) | 500 mm/s | tech specs [VERIFIED] |
| A1 | 256 x 256 x 256 | 300 | 100 | open bed-slinger | 0.4 / 0.2, 0.6, 0.8 | 1; AMS lite | 500 mm/s, 10,000 mm/s2 | tech specs [VERIFIED] |
| A2L | 330 x 320 x 325 | 300 | 80 (limited for household power) | open (UNVERIFIED wording) | stainless; 0.2, 0.4, 0.6, 0.8 | 1; AMS lite and 2nd-gen AMS, up to 19 colors | 500 mm/s, 10 m/s2 | specs, FAQ [SNIPPET] |
| P1S | 256 x 256 x 256 | 300 | 100 | enclosed, not actively heated | 0.4 (UNVERIFIED options) | 1; AMS | 500 mm/s, 20 m/s2 | P1 FAQ [SNIPPET], 3dmag [SNIPPET] |
| P2S | 256 x 256 x 256 | 300 | 110 | enclosed, "50 C chamber" via flap-controlled airflow, heat preservation (no active heater stated) | hardened steel 0.4 / 0.2, 0.4, 0.6, 0.8 | 1; AMS 2 Pro (4 spools, drying, RFID) | 600 mm/s, 20,000 mm/s2, 40 mm3/s | specs page, FAQ [SNIPPET]; marketing page [VERIFIED 50 C] |
| X1C | 256 x 256 x 256 | 300 | 120 @110 V / 110 @220 V | enclosed, passive | 0.4 | 1; AMS | 500 mm/s, 20 m/s2 | 3dmag, Bambu forum [SNIPPET] |
| X2D | main nozzle 256 x 256 x 260; auxiliary 235.5 x 256 x 256; dual 235.5 x 256 x 256 | 300 | 120 | enclosed, 65 C actively heated | hardened steel 0.4 / 0.2, 0.4, 0.6, 0.8 | 2 (main + auxiliary for easy-remove supports); AMS | 1000 mm/s, 20,000 mm/s2 | specs [SNIPPET], marketing [VERIFIED 65 C, 50 micron] |
| H2S | 340 x 320 x 340 | 350 | 120 | enclosed, active 65 C | 0.4 / 0.2, 0.4, 0.6, 0.8 | 1; AMS | 1000 mm/s, 20,000 mm/s2 | tech specs [VERIFIED] |
| H2D | single 325 x 320 x 325; dual 300 x 320 x 320; total 350 x 320 x 320 | 350 | 120 | enclosed, active 65 C, flame-retardant chamber | 0.4 / 0.2, 0.4, 0.6, 0.8 | 2 nozzles; AMS 2 Pro and AMS HT | 1000 mm/s, 20,000 mm/s2 | tech specs [VERIFIED] |
| H2C | left single 325 x 320 x 320; right single 305 x 320 x 325; dual 300 x 320 x 320; total 330 x 320 x 320 | 350 | UNVERIFIED (likely 120) | enclosed, active 65 C | hardened steel; 0.2, 0.4, 0.6, 0.8; mixed diameters in one print not supported | Vortek: 1 fixed left hotend + 6 induction hotends on the right (7); right side shares a feed path, AMS reloads on change; TPU down to 85A | 1000 mm/s, 20,000 mm/s2, 40 mm3/s | specs [SNIPPET], buying guide [VERIFIED] |
| H3C | 330 x 320 x 325 | 350 | 120 | enclosed, active 65 C, H11 HEPA + carbon | hardened steel 0.4 / 0.2, 0.4, 0.6, 0.8; mixed diameters supported | SwapTek 9-tool changer; AMS 3H (9 slots) + up to 4 external AMS units, up to 24 colors; 2.85 mm TPU 75A via bypass | 1400 mm/s, 25,000 mm/s2, 40 mm3/s | buying guide [VERIFIED] |

Plates: Textured PEI (standard on most models; textured bottom; glue may be needed for PC/PA/ABS/ASA), Smooth PEI (smooth matte bottom; Bambu says it improves Z precision and suits tight-fit parts), Dual-Texture PEI, Engineering Plate (smooth, all Bambu filaments), Cool Plate SuperTack [VERIFIED: Bambu wiki plates]. 256 mm plates are shared across X1/P1/A1/P2S/X2D [SNIPPET: FAQs]; H2C plates are not compatible with H2D plates per forum users [SNIPPET].

### C2. Slicing defaults relevant to DFM

- Default nozzle 0.4 mm on every model above.
- Layer height range for 0.4 mm nozzle: 0.08 to 0.28 mm; default first layer 0.2 mm [VERIFIED: Bambu wiki layer height, variable layer height].
- Line width: Bambu profiles typically 0.42 mm for 0.4 nozzle (0.62 / 0.82 for 0.6 / 0.8) [SNIPPET: calibr.pro]; Bambu-specific default not read on a Bambu page (UNVERIFIED).
- Design implication: minimum wall = multiples of about 0.42 to 0.45 mm (2 lines about 0.85 mm); layer-height-multiple Z features (0.2 mm steps) print cleanest.

### C3. AMS, purge waste and supports

- Purging volume = volume purged into the chute plus volume flushed into supports/infill/objects; prime tower wiping volume is separate [VERIFIED: prime tower wiki].
- Waste reduction: flush into objects' infill (light/transparent colors may show through), flush into objects' support (default on, needs prime tower), flush into a sacrificial object [VERIFIED: reduce waste wiki]. Users report waste exceeding the part mass (85 g print -> 250 g) [SNIPPET, anecdotal]. DFM rule: minimize color changes per layer; group colors by Z height; use separate-nozzle machines (H2D, H2C, H3C, X2D) to cut purge.
- Support interface material: Bambu "Support for PLA" (with PLA), "Support for PLA/PETG", PVA (water soluble) [VERIFIED snippet of Bambu filament support wiki]; PLA and PETG do not bond well and are used as interface for each other [SNIPPET: Bambu forum]. Interface layers are the layers touching the object [SNIPPET: Bambu wiki support]. X2D's auxiliary nozzle exists for easy-remove supports [VERIFIED].

### C4. Pause and filament change

- Add Pause on the layer slider; stops before that layer; manual resume [VERIFIED]. Tip from Bambu: pause at layer 1 to remove flow calibration lines for large first layers [VERIFIED].
- Pause G-code `M400 U1` [SNIPPET]. Bed remains heated while paused [SNIPPET]; nozzle temperature behavior during pause UNVERIFIED (user reports of cooling).
- Filament change at layer (color change) is offered on the same slider (UNVERIFIED in this research; standard Bambu Studio feature).

### C5. Files and input formats

- Bambu Studio imports .3mf, .stl, .stp/.step, .amf, .obj (plus SVG per the menu) [VERIFIED: H2D user manual snippet].
- A Bambu Studio 3MF ("project") stores geometry plus process/filament/printer settings, orientation and plate arrangement [VERIFIED: MakerWorld FAQ].
- DFM rule: deliver STEP for editing and 3MF for printing; keep the 3MF's plates named per variant.

### C6. MakerWorld conventions

From the Bambu wiki print-profile upload guide and MakerWorld FAQ [VERIFIED snippets]:
- A print profile = a Bambu Studio 3MF with geometry + settings; one print photo is required per profile or it may be taken down.
- Profiles are verified by MakerWorld cloud slicing, which also checks printer compatibility; uncheck printers known to fail.
- Put variants on separate, named plates.
- Prohibited: profiles without valid photos, quality problems, mismatched title/description vs file, incomplete files, duplicates, invalid edits, modifying geometry of No-Derivatives / Standard Digital File License models.
- If "exceeding avoidance area" after upload: move the model to the plate center or export from an H2-series printer profile.
- Class A profiles (designer) sort before Class B (MakerWorld official).
- Orientation: profiles carry the designer's chosen orientation, usually for best print result [VERIFIED FAQ].

---

## Part D. Calibration prints, fit-test coupons, design aids

### D1. Survey of existing tests

| Test | What it measures | Typical geometry / steps | Source |
|---|---|---|---|
| Calibration cube (20 mm) | XYZ scale, ringing, elephant foot | measure 3x per axis; letters mark axes | All3DP [VERIFIED] |
| Benchy / calibration cat | overall quality, overhangs, bridges | | All3DP [VERIFIED] |
| Maker's Muse tolerance gauge v2 | print-in-place gaps | rotating triangles at 0.15, 0.2, 0.3, 0.4, 0.5 (v1 0.05 to 0.5); key to break free; 60 degree overhangs top and bottom; doubles as fidget spinner | Maker's Muse transcript [VERIFIED] |
| Clearance tolerance test (3D Maker Noob, MakerWorld) | small Maker's Muse-style gauge | 0.2 mm layer, 2 walls, 10% infill reviews | MakerWorld page [VERIFIED meta] |
| Internal clearance test (xzw, Thingiverse 3003732) | knobs at 0.2, 0.3, 0.35, 0.4, 0.5, 0.6 | | [SNIPPET] |
| Orca Tolerance Test | hex holes at 0, 0.05, 0.1, 0.2, 0.3, 0.4 mm + hex tester or M6 Allen key; feeds XY hole/contour compensation | OrcaSlicer wiki [VERIFIED; per side not stated] |
| Bambu XY hole calibration | hole ladder with M6 screw, values like +0.1, +0.15, +0.2 | Bambu wiki [VERIFIED] |
| CNC Kitchen insert hole test | holes per insert size (M1.6 to M10) in horizontal, vertical, angled orientations; M3 4.0 to 4.4 in 0.1 steps | CNC Kitchen [VERIFIED] |
| CNC Kitchen threads test | M3+ modeled threads, horizontal and vertical | CNC Kitchen transcript [VERIFIED] |
| Orca temp tower | blocks at different temperatures | OrcaSlicer wiki [VERIFIED] |
| Orca max volumetric speed | 5 to 20 mm3/s, step 0.5; read height; use 10 to 20% below | OrcaSlicer wiki [VERIFIED] |
| Orca retraction tower | 0 to 2 mm step 0.1 (direct drive); 1 to 6 step 0.2 (Bowden) | OrcaSlicer GitHub wiki [VERIFIED] |
| Orca flow ratio, pressure advance, VFA, input shaping | calibration order: temp -> MVS -> PA -> flow -> retraction -> advanced -> tolerance last | OrcaSlicer calibration guide [VERIFIED] |
| Teaching Tech calibration site | E-steps, first layer, baseline print, flow, retraction, temperature, acceleration, linear advance (G-code generator) | teachingtechyt.github.io [SNIPPET] |
| Magnet hole ladder | 6.1 / 6.2 / 6.3 for 6 mm disc | DraftID [VERIFIED] |
| Protolabs design aids | physical design-aid cubes (molding); FDM minimum features: negative features 0.025 in (0.635 mm), etc. per process | Protolabs 7 mistakes [SNIPPET] |
| Unit test (Markforged) | isolate a critical feature as its own body, vary dimensions, print in under about 6 hours, update the main model | Markforged [VERIFIED] |

### D2. Modular calibration kit (proposed coupons)

Design principles drawn from the sources: one parameter per coupon; print in the same material, walls and infill as the final part (CNC Kitchen [VERIFIED]); test horizontal, vertical (and 45 degree) orientations where holes matter (CNC Kitchen [VERIFIED]); label each step with embossed or debossed values; each coupon prints alone in roughly 5 to 15 minutes or tiles onto one plate. Step values marked "proposed" are my synthesis; ranges cite the source they mirror.

| # | Coupon | Footprint (proposed) | Steps | Label | Basis |
|---|---|---|---|---|---|
| 1 | Hole/pin clearance ladder (vertical holes) | 60 x 15 x 5 mm bar with 6 to 8 holes for a reference pin (6 mm dowel or M6 screw) | per side 0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.4 (diametral 0 to 0.8) | deboss "+0.10/s" (per side, explicit) | Orca test 0 to 0.4; Bambu M6 method |
| 2 | Same ladder, horizontal holes | bar printed so hole axes lie in XY | same | same | CNC Kitchen orientation finding |
| 3 | Print-in-place gap gauge | 40 mm disc with rotating inserts | gaps 0.15, 0.2, 0.25, 0.3, 0.4, 0.5 per side; 60 degree top/bottom | gap value on each segment | Maker's Muse |
| 4 | Lid / slot fit | 30 x 20 mm box rim and 4 tongue widths | per side 0.1, 0.15, 0.2, 0.3 | per side value | proposed |
| 5 | Heat-set insert pocket ladder | one block per insert size | nominal D2 -0.1 to +0.4 in 0.1 steps, vertical and horizontal | diameter in CAD | CNC Kitchen hole test (4.0 to 4.4 for M3) |
| 6 | Nut pocket ladder | block with M3 (and M4/M5) hex pockets | AF +0.1, +0.2, +0.3, +0.4 diametral; flat down | AF value | Loftsmith / 3dprintcalcs |
| 7 | Magnet pocket ladder | 6 x 2 and 10 x 3 discs (or the project's magnets) | +0.05, +0.1, +0.15, +0.2, +0.3 diametral; depth +0.1 and +0.4 | diametral value | DraftID, totalElement |
| 8 | Self-tap pilot ladder | M2, M2.5, M3, M4 bosses | 80%, 85%, 90%, 96% of major dia | percentage | Hydra Research, EJOT |
| 9 | Wall thickness ladder | stepped fin | 0.4, 0.45, 0.8, 0.85, 1.2, 1.6 mm (1 to 4 lines of 0.42) | thickness | proposed, based on Bambu line width |
| 10 | Overhang fan | quarter-arc of fins | 30 to 75 degrees from vertical in 5 or 15 degree steps | angle | Hydra Research <50 recommended, up to 70 |
| 11 | Bridge span ladder | pillars | 5, 10, 20, 30, 40, 50 mm | span | proposed |
| 12 | Text size and depth | plate | 4, 5, 6, 8 mm text, emboss/deboss 0.2, 0.4, 0.6 mm | value | proposed |
| 13 | Bottom edge: chamfer vs fillet | 4 small blocks | 45 degree chamfer 0.4, 0.8, 1.2 vs fillet 1 mm | type | Slant 3D chamfer advice; elephant foot wiki |
| 14 | Snap-fit coupon | cantilever + catch | beam thickness 1.0, 1.2, 1.5 mm at fixed L and undercut; XY vs Z build | t value and orientation | Hubs, BASF |
| 15 | Thread coupon | modeled M5, M6, M8, M10 bolts and nuts, vertical and horizontal | radial clearance 0.1, 0.2, 0.3 | size and clearance | CNC Kitchen, Hydra Research |
| 16 | Living hinge strip | strips | 0.3, 0.4, 0.5, 0.6 mm | thickness | Hubs, printstack |
| 17 | Elephant-foot cube | 20 mm cube | measure bottom vs top per Bambu wiki formula | | Bambu wiki |

Labeling conventions to standardize: always print the unit and the type ("+0.20 D" diametral or "0.10 S" per side), emboss on a top surface at >= 5 mm height (UNVERIFIED legibility threshold), orient the arrow to show the build direction, include material and date tag area.

### D3. "Print a slice first"

- Markforged's "unit test": a small test print that confirms feature success before a long print; isolate critical features into their own body, make variations, print and test, then update the full model; aim under 6 hours [VERIFIED].
- Sovol's tolerance guide also recommends a simple test print before the final part [SNIPPET].
- BigRep (large-format): print critical sections first and run test fits [SNIPPET].
- Bambu Studio's cut tool can produce the slice directly from the full model [VERIFIED: tool exists].

How to choose the section (synthesized; UNVERIFIED as a sourced procedure beyond Markforged's steps):
1. Pick every interface that mates with something else (bores, lids, snaps, insert bosses, magnet pockets).
2. Cut a section that contains the full mating perimeter but minimal height: a ring 2 to 5 mm tall for a round lid or bore, a 5 to 10 mm long segment for a rail or dovetail, a boss plus 3 mm of surrounding wall for an insert.
3. Keep the slice at the same Z position class as in the real part: if the real fit is at the first layers, the slice must start on the bed too (elephant's foot); if the real fit is mid-part, add a short sacrificial base or raise it so it is not affected by first-layer squish.
4. Keep orientation, profile, filament, walls and infill identical to the final print.
5. Test with the real hardware (the actual bearing, magnet, insert, mating part); adjust the model per side, reprint the slice if the change exceeds 0.1 mm.

---

## Sources (accessed 2026-11-12)

Read in full (scrape or transcript):
1. https://www.cnckitchen.com/blog/tips-and-tricks-for-heat-set-inserts - install temps, design rules, test parts
2. https://www.cnckitchen.com/s/CNCKitchen_Heat-Set-Insert-Dimensions-and-Design-Guidelines.pdf - insert hole table
3. https://www.cnckitchen.com/blog/are-our-heat-set-insert-datasheets-wrong - hole size vs pull-out, offsets
4. https://www.cnckitchen.com/blog/threaded-inserts-for-3d-prints-cheap-vs-expensive - pull/torque data, hole shrink
5. https://www.cnckitchen.com/blog/helicoils-threaded-insets-and-embedded-nuts-in-3d-prints-strength-amp-strength-assessment - PETG nuts/inserts/helicoils
6. https://www.youtube.com/watch?v=iR6OBlSzp7I (CNC Kitchen, transcript) - M5 threads vs inserts
7. https://www.youtube.com/watch?v=ip70-Tw6tBE (Slant 3D, transcript) - side holes, hex holes, grip fins
8. https://www.youtube.com/watch?v=TYuLVN3YHw8 (Maker's Muse, transcript) - tolerance gauge results
9. https://www.hubs.com/knowledge-base/how-design-snap-fit-joints-3d-printing/ - snap-fit rules
10. https://bambulab.com/en/compare - lineup, H2D/X2D/P2S basics
11. https://bambulab.com/en/support/buying-guide - H3C specs, H2C comparison
12. https://bambulab.com/en/p2s - 50 C chamber, AMS 2 Pro
13. https://bambulab.com/en/x2d - 65 C chamber, 50 micron claim
14. https://bambulab.com/en/h2d - 65 C chamber, motion accuracy
15. https://bambulab.com/en/a1 - AMS lite
16. https://bambulab.com/en/a2l - AMS support, colors
17. https://bambulab.com/en/a1/tech-specs - A1 specs
18. https://bambulab.com/en/a1-mini/tech-specs - A1 mini specs
19. https://bambulab.com/en/h2s/tech-specs - H2S specs
20. https://bambulab.com/en/h2d/tech-specs - H2D specs
21. https://wiki.bambulab.com/en/software/bambu-studio/xy-hole-contour-compensation - per-side compensation
22. https://wiki.bambulab.com/en/software/bambu-studio/manual/auto-circle-contour-compensation - auto circle comp
23. https://wiki.bambulab.com/en/software/bambu-studio/parameter/elephant-foot - elephant foot
24. https://wiki.bambulab.com/en/bambu-studio/manual/3d-print-large-files - splitting, connectors, glue
25. https://www.ruthex.de/en/products/ruthex-gewindeeinsatz-m3-100-stuck-rx-m3x5-7-messing-gewindebuchsen - (no hole data on page)
26. https://www.ruthex.de/en/pages/dokumente-downloads - (no datasheets listed)
27. https://totalelement.com/blogs/magnet-projects/how-to-embed-magnets-in-3d-prints - magnet pockets, temp, polarity
28. https://draftid.com.au/how-to-embed-magnets-in-3d-prints/ - magnet test table, pause layer
29. https://www.protolabs.com/resources/design-tips/3d-printing-tolerances/ - (no FDM numbers in text)
30. https://markforged.com/resources/learn/design-for-additive-manufacturing-plastics-composites/3d-printing-strategies-for-composites/composites-3d-printing-design-tips - unit tests, fit values
31. https://www.sovol3d.com/blogs/news/fdm-3d-printing-tolerances-clearances-how-to-design-parts-that-fit - per-side table, material deltas
32. https://www.orcaslicer.com/wiki/calibration/tolerance_calib - Orca tolerance test
33. https://all3dp.com/2/3d-printing-tolerances-test-fdm/ - test survey
34. https://makerworld.com/en/models/423905-clearance-tolerance-test - clearance test listing
35. https://www.spirol.com/assets/files/ins-wp-how-to-design-the-proper-hole-for-heat-ultrasonic-inserts-us.pdf - insert hole taper, depth, boss
36. https://markforged.com/resources/blog/heat-set-inserts - insert side vs load, temps

Used from search-result excerpts:
37. https://tools.creative3dp.com/blog/heat-set-insert-hole-size-chart/ - alt insert chart, chamfer, wall
38. https://accu-components.com/us/p/488-threaded-insert-hole-size-charts-for-3d-printing-pla-petg-resin - insert holes
39. https://www.ruthex.de/en/collections/all?page=2 - ruthex drill sizes 5.6/6.4/8
40. https://loftsmith.com/guides/screw-holes-3d-printing - nut traps, self-tap holes
41. https://markforged.com/resources/blog/embedding-nuts-3d-printing - per side x2 explanation
42. https://3dprintcalcs.uk/mechanical/nut-trap-calculator/ - nut clearance
43. https://createit3d.co.za/blogs/news/how-to-design-captive-nuts-in-3d-printed-parts - nut clearance
44. https://www.hydraresearch3d.com/design-rules - threads, tap %, unsupported holes, overhang
45. https://3dprinting.stackexchange.com/questions/6576 - clearance rules, worked stack-up
46. https://3dprinting.stackexchange.com/questions/7651 - 608 bearing hole
47. https://cc3dlabs.com/print-tolerance-standards-explained-for-engineers/ - per-side example
48. https://grandpacad.com/en/tools/tolerance-fit-calculator - diametral fit table, accuracy
49. https://forum.prusa3d.com/forum/original-prusa-i3-mk2-s-others-archive/general-tolerances-for-part-design/ - 0.2 difference
50. https://www.youtube.com/watch?v=XKrDUnZCmQQ (comments) - per-side confusion
51. https://www.aon3d.com/applications/engineering-fits-how-to-design-for-3d-printed-assemblies/ - crush ribs
52. https://newscrewdriver.com/2020/12/31/accommodate-3d-printer-variation-with-crush-ribs/ - crush ribs
53. https://meshra.ai/blog/3d-printed-bearing-mount-that-fits - bearing interference
54. https://fab.cba.mit.edu/classes/S62.12/people/vernelle.noel/Plastic_Snap_fit_design.pdf - Bayer snap-fit guide
55. BASF Snap-Fit Design Manual (researchgate / uspto copies) - allowable strain, Q factor
56. https://synectic.net/snap-fit-design/ - cantilever equations
57. https://www.fictiv.com/articles/how-to-design-snap-fit-components - 3D printed strain, Z derating
58. https://www.hubs.com/knowledge-base/how-design-living-hinges-3d-printing/ - living hinge FDM
59. https://www.sovol3d.com/blogs/news/print-in-place-3d-printing-how-to-design-hinges-joints-and-moving-parts-that-actually-work - PIP 0.25 per side
60. https://3dprintbook.com/blog/designing-fdm-snap-fit-joints-living-hinges/ - clip clearance
61. https://printstack.org/blog/functional-3d-printed-parts - hinge thickness
62. https://blog.uavmodel.com/print-in-place-3d-designs-clearance-tolerances-hinge-design-and-fpv-accessories-2026/ - hinge cycles (low confidence)
63. https://rapidmade.com/designing-snap-fits-and-living-hinges-for-mjf-3d-printing-a-complete-guide-for-pa11-pa12-and-pp/ - MJF reference
64. https://help.prusa3d.com/article/insert-pause-or-custom-g-code-at-layer_120490 - PrusaSlicer pause, magnets
65. https://forum.prusa3d.com/forum/how-do-i-print-this-printing-help/how-to-safely-insert-magnets-into-a-print/ - magnet attraction
66. https://wiki.bambulab.com/en/software/bambu-studio/view-slicing-information - Bambu pause semantics
67. https://forum.bambulab.com/t/solved-custom-g-code-for-pause-wipe-resume/40620 - M400 U1
68. https://forum.bambulab.com/t/need-advice-for-paused-print-ran-out-of-filament-til-tokorrow/112783 - bed warm in pause
69. https://www.apexmagnets.com/n-grade-comparison and https://www.stanfordmagnets.com/list-of-magnets-that-can-withstand-high-temperatures.html - NdFeB grades
70. https://bambulab.com/en/p2s/specs and https://wiki.bambulab.com/en/p2s/manual/p2s-faq - P2S specs
71. https://bambulab.com/en/a2l/specs and https://wiki.bambulab.com/en/a2l/manual/a2l-faq - A2L specs
72. https://bambulab.com/en/h2c/specs - H2C specs
73. https://bambulab.com/en/x2d/specs and https://wiki.bambulab.com/en/x2d/manual/x2d-faq - X2D specs
74. https://wiki.bambulab.com/en/p1/manual/faq and https://www.3dmag.com/3d-printers-comparison/bambu-p1s-vs-x1-carbon/ - P1S, X1C
75. https://wiki.bambulab.com/en/software/bambu-studio/layer-height and /adaptive-layer-height - layer ranges
76. https://calibr.pro/tables/nozzle-size-layer-height-chart/ - line widths
77. https://wiki.bambulab.com/en/filament-acc/acc/plates - build plates
78. https://wiki.bambulab.com/en/software/bambu-studio/reduce-wasting-during-filament-change and /parameter/prime-tower - purge
79. https://wiki.bambulab.com/en/filament/support and /software/bambu-studio/support - support filaments, interface
80. https://csm.bblcdn.com/hub/4668d0ca43994ff3bff4b37f1a65c2e7.pdf - Bambu Studio import formats (H2D manual)
81. https://wiki.bambulab.com/en/makerworld/tutorials/print-profile-upload, https://wiki.bambulab.com/en/makerworld/tutorials/how-to-upload-models, https://makerworld.com/en/faq - MakerWorld rules
82. EJOT DELTA PT / PT brochures (ejot.pl, ejot-atf.com, apexfasteners.com) - thread-forming screw holes
83. https://jlc3dp.com/blog/considerations-for-3d-printing-threads - layer height vs pitch
84. https://formlabs.com/blog/how-to-3d-print-interlocking-joints/ and https://markforged.com/resources/blog/joinery-onyx - dovetails
85. https://bigrep.com/posts/gluing-3d-printed-parts-best-adhesives/ and https://www.formfutura.com/blog/blogs-1/how-to-glue-and-join-3d-printed-parts-complete-guide-50 - glue, solvent welding
86. https://www.orcaslicer.com/wiki/guides/calibration_guide, OrcaSlicer GitHub calibration wiki, /calibration/volumetric_speed_calib, /calibration/vfa_calib - calibration suite
87. https://teachingtechyt.github.io/calibration.html - calibration site
88. https://www.thingiverse.com/thing:3003732 - internal clearance test
89. https://www.protolabs.com/resources/design-tips/7-mistakes-to-avoid-when-designing-3d-printed-parts/ - min feature sizes, size effects
90. https://www.reddit.com/r/BambuLab/comments/1mg6pvj/xy_hole_compensation_madness/ - doubling anecdote

---

## Gaps

1. **ruthex official datasheet** (hole, depth, wall per size) was not reachable on ruthex.de; values come via CNC Kitchen's text and a ruthex drill-set listing. M2 / M2.5 / M8 ruthex holes unverified.
2. **Per side vs total is unstated** in Hubs (0.5 mm snap clearance), Markforged fit table, Fictiv, Orca Tolerance Test, Bambu cut-connector tolerance, and Maker's Muse gaps (gaps are physically per side). These were normalized by inference.
3. **Bambu**: H2C max bed temperature, P1S/X1C/A1 AMS color counts, A2L enclosure status, X2D included AMS, nozzle temperature behavior during pause, Bambu default line width, H2D Pro and R1 specs, and H3C retail availability were not verified.
4. **No numeric FDM sources** fetched for: flexure design, heat staking, zip-tie features, O-ring grooves in prints, threaded lids, D-shafts, square nuts, RFID/spring embedding, glue bond-line gap.
5. **Reuse cycle count** for screws directly in plastic: qualitative only.
6. **Protolabs FDM tolerance numbers and its physical design aids** did not appear in fetched text; Made with Layers (toms3d), 3D Printing Nerd and Prusa KB hole/tolerance articles were not read in this research.
7. **Magnet heat loss** in hot-bed or heated-chamber prints was not measured by any source; the 80 C N-grade limit is the only anchor.
8. **Snap-fit FDM allowable strain** is extrapolated from molding data plus Fictiv's Z derating; no FDM-specific fatigue data found.
9. Several coupon step values in D2 are proposals, not copied from an existing kit.
