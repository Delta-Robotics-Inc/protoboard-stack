# Lane 01: FDM/FFF Geometric Design Rules

Research lane for the "DFM for 3D printing" playbook. Scope: geometric design rules for material-extrusion (FDM/FFF) parts, written so an AI CAD agent can apply them while modeling.

Accessed: 2026-11-12 (all sources unless noted).

## Notation and default machine

- `N` = nozzle diameter. Default 0.4 mm.
- `W` = extrusion line width. Slicers default to about 1.1 to 1.125 x N. PrusaSlicer uses 0.45 mm on a 0.4 mm nozzle (Prusa KB); Bambu/Orca profiles use about 0.42 mm. When a rule below says "W," use 0.45 mm unless the slicer profile says otherwise.
- `L` = layer height. Default 0.2 mm. First layer is often 0.2 to 0.3 mm.
- Rules are given as "value at default machine (formula)" so they recompute for a 0.25, 0.6 or 0.8 mm nozzle.
- Confidence tags: **[MEASURED]** = from a physical test with numbers; **[VENDOR]** = a printer or service-bureau guideline; **[PRACTITIONER]** = experienced designer advice without published test data; **[DERIVED]** = geometry I worked out from a sourced fact, flagged so it can be checked; **UNVERIFIED** = could not confirm at a primary source.
- Where sources disagree, both values are listed and the conservative one is named.

---

## 1. Wall thickness

- **Minimum printable wall = 1 line width (about 0.45 mm at N = 0.4; 1 x W).** A wall thinner than one perimeter is not printable; one perimeter is printable. [VENDOR] Source: https://help.prusa3d.com/article/modeling-with-3d-printing-in-mind_164135
- **Walls should be whole multiples of line width: 1 perimeter = 0.45 mm, 2 = 0.9 mm, 3 = 1.35 mm, 4 = 1.8 mm (n x W).** Prusa's table marks "more than one perimeter but less than two" as not printable (with the classic wall generator), and "more than two" as printable. Reason: the slicer can only fill the space between perimeter loops with whole beads or gap fill, so in-between thicknesses leave voids, gap-fill zigzags, or overlaps. [VENDOR] Source: same Prusa page.
- **Recommended minimum structural wall = 2 x W (about 0.9 mm).** Thinner walls print poorly and are weak; perimeters are the main source of strength, so add perimeters beyond 2 when strength matters. [VENDOR] Source: https://www.hydraresearch3d.com/design-rules
- **Other published minimums (for comparison):**
  - 0.8 mm, and use multiples of nozzle size (0.4, 0.8, 1.2 mm). [VENDOR] https://www.unionfab.com/blog/2026/03/design-for-manufacturing-3d-printing
  - 1.0 to 1.2 mm minimum for FDM. [VENDOR] https://simplemachining.com/blogs/dfm-for-3d-printing-a-practical-design-guide (most conservative)
  - Minimum wall at least equal to the nozzle diameter (1 x N). [VENDOR] https://ultimaker.com/wp-content/uploads/2024/06/How-to-design-for-FFF-1.pdf (least conservative)
  - Hubs network service lists a 2.0 mm minimum feature size for FDM orders (service-bureau conservatism). [VENDOR] https://www.hubs.com/3d-printing/fdm/ (search excerpt)
  - **Conflict resolution:** for a single-nozzle consumer machine use 2 x W (0.9 mm) as the floor and 3 to 4 x W (1.2 to 1.8 mm) as the default for load-bearing walls; 1.0 to 1.2 mm (Simple Machining) is the conservative choice when the printer is unknown or the part goes to a service bureau.
- **Rule of thumb from Simple Machining: design to about 3 x L around features (0.6 mm at L = 0.2).** [VENDOR] https://simplemachining.com/blogs/dfm-for-3d-printing-a-practical-design-guide
- **What happens at 0.5 x N (a 0.2 mm wall on a 0.4 mm nozzle):**
  - Classic generator: the inset polygon collapses and no wall path is generated, so the feature disappears, unless "Detect thin wall" is on, which shrinks the inset and can create overlapping or broken paths. [VENDOR] https://wiki.bambulab.com/en/software/bambu-studio/wall-generator
  - Arachne: anything thinner than the **Minimum feature size (default 25% of N = 0.1 mm)** is dropped; features above that threshold but still too thin are **widened to the Minimum wall width (85% of N = 0.34 mm)**. [VENDOR] Same Bambu page.
  - **Consequence [DERIVED]:** a modeled 0.2 mm wall prints as roughly a 0.34 mm single bead (70% oversize) under Arachne, or vanishes under Classic. Neither is what the CAD says. Never model a wall below 1 x W unless the slicer and outcome are verified.
- **Arachne (variable-width perimeters) changes:** it varies bead width and uses wedge-shaped "wall transitions" so a space that is not a whole multiple of W is filled without gaps or overlaps. Key parameters: Minimum wall width (% of N), Minimum feature size (default 25% of N), Wall transition threshold angle (1 to 59 degrees), Wall transitioning filter margin, Wall transitioning length, Wall distribution count. [VENDOR] https://wiki.bambulab.com/en/software/bambu-studio/wall-generator
  - **Design implication:** Arachne makes non-multiple walls printable, but whole multiples of W still give the most uniform beads and predictable strength. Arachne may perform worse than Classic in some cases (Bambu has a separate article on choosing). [VENDOR] https://wiki.bambulab.com/en/software/bambu-studio/WallGenerator (search excerpt)
- **Wider extrusions are stronger:** CNC Kitchen hook test (PLA, 0.4 mm nozzle, 0.16 mm layers): 2 perimeters at 100% width failed at 20 kg; 4 perimeters at 100% at 33 kg; 3 perimeters at 133% at 37 kg; 2 perimeters at 200% width at 39 kg. Layer adhesion peaked around 150% width. Visual quality unchanged up to about 140% width; overhang artifacts start near 160%. [MEASURED] https://www.cnckitchen.com/blog/the-effect-of-extrusion-width-on-strength-and-quality-of-3d-prints
  - Design implication: wall strength tracks total wall thickness, not perimeter count. If a design needs a thick wall quickly, it can be printed with a larger nozzle or wider lines; size walls so the count works with the line width you plan to use.

## 2. Overhangs

- **Standard limit: 45 degrees from vertical without support.** At 45 degrees each new layer is supported by 50% of the one below; beyond 45 degrees, add support. [VENDOR] https://www.hubs.com/knowledge-base/how-design-parts-fdm-3d-printing/ ; also Simple Machining, Unionfab, UltiMaker white paper.
- **Why [DERIVED from the Hubs 50% statement]:** at overhang angle a (from vertical) each layer steps outward by L x tan(a). At 45 degrees and L = 0.2 the step is 0.2 mm, about half of W (0.45 mm), so half the bead rests on the layer below. Steeper angles mean less than half the bead is supported and it droops. Therefore the step-out per layer, not the angle alone, is the physical limit: **max reliable step per layer is about 0.5 x W**, which gives a max angle of atan(0.5 x W / L).
  - At L = 0.2, W = 0.45: atan(1.125) = about 48 degrees.
  - At L = 0.1, W = 0.45: about 66 degrees (thinner layers allow steeper overhangs).
  - At L = 0.3, W = 0.45: about 37 degrees.
  - This is consistent with Prusa saying smaller nozzles (0.25 mm) may manage less than 45 degrees, and with CNC Kitchen finding 0.15 mm layers the sweet spot for overhangs on a 0.4 mm nozzle (below). Treat the formula as a planning aid, not a guarantee.
- **Better cooling raises the limit:**
  - Prusa: 45 to 60 degrees depending on nozzle and settings; printers with 360-degree cooling (Nextruder MK4S, CORE One family) up to 75 degrees without support; 0.25 mm nozzles may manage less than 45 degrees. [VENDOR] https://help.prusa3d.com/article/modeling-with-3d-printing-in-mind_164135
  - Hydra Research: keep below 50 degrees, though many modern printers reach about 70 degrees acceptably. [VENDOR] https://www.hydraresearch3d.com/design-rules
  - **Conservative design value: 45 degrees.** Use up to 60 degrees only when the target machine is known to have strong part cooling.
- **Layer height for overhangs:** 0.15 mm layers were the sweet spot for overhangs and bridging on a 0.4 mm nozzle. [MEASURED] https://www.cnckitchen.com/blog/the-influence-of-layer-height-on-the-strength-of-fdm-3d-prints
- **Chamfers, not fillets, on downward-facing edges.** A fillet on a bottom or downward edge starts almost horizontal (close to a 90-degree overhang) so its first layers sag; a 45-degree chamfer holds a constant step. Fillets are fine on vertical (XY-plane) edges, where the nozzle traces the curve exactly. On upward-facing (top) edges, fillets also stair-step badly near the top; chamfers or variable layer height fix that. [PRACTITIONER, shown in G-code preview] Maker's Muse video transcript https://www.youtube.com/watch?v=XTvBOGgx48I ; also Hydra Research ("do not use downward facing fillets"), Prusa KB ("use chamfer instead of fillets if oriented towards the print bed"), Slant 3D https://www.youtube.com/watch?v=9Hp-VRO1hVQ
- **Make overhangs disappear by chamfering under them.** Replace a flat ledge with a chamfer under it, and make the chamfer as shallow (close to vertical) as the design allows; the part then needs no support and no cleanup. [PRACTITIONER] Slant 3D https://www.youtube.com/watch?v=9Hp-VRO1hVQ
- **Horizontal holes (axis parallel to the bed): use a teardrop or pointed "roof."**
  - The top of a horizontal round hole is a flat bridge that sags and makes the hole oval; add a point at the top (teardrop) so nothing exceeds 45 degrees. Also add small fillets where the hole meets the outer face so the toolpath is smooth. [PRACTITIONER] Slant 3D "Reduce Sagging" transcript https://www.youtube.com/watch?v=Bd7Yyn61XWQ
  - Teardrop = circle with a 45-degree point on top; small holes can just bridge with a little sag. [PRACTITIONER] https://printpal.io/docs/3d-printing-design-guide (search excerpt)
  - Hydra Research: model extra relief features with offset a = L (about 0.3 mm), or 2 x L when L is 0.1 mm, to absorb droop at the top and the flat stair-stepped bottom. [VENDOR] https://www.hydraresearch3d.com/design-rules
  - Gothic-arch or diamond hole shapes as alternatives: **UNVERIFIED** (commonly recommended; no primary source read in this lane).
- **Counterbores and holes that start in mid-air: sacrificial bridging (sequential bridging).**
  - Model two extra bridge layers over the hole: first a pair of rectangles tangent to the hole, 1 x L thick; then a second pair rotated 90 degrees, 2 x L thick (cumulative). Each layer bridges a straight span onto the previous one, so the printer never has to draw a circle over air. [VENDOR] https://www.hydraresearch3d.com/design-rules ("Unsupported Holes")
  - Alternative: a single sacrificial membrane (often about one layer, 0.1 to 0.2 mm) over the hole, opened later by drilling or pushing through. [PRACTITIONER] https://hackaday.com/2017/10/17/sacrificial-bridge-avoids-3d-printed-supports/ ; a 0.4 mm extruded step worked for layer heights up to 0.35 mm (four extrusions from two sketches). https://brentwerder.design/2019/12/14/tricking-my-printer-to-print-perfect-overhangs/
  - Caveat: a sacrificial layer leaves strands in the hole and can tear out the bottom layer when punched through; Slant 3D uses it only for small, non-structural holes and supports large ones. [PRACTITIONER] https://www.youtube.com/watch?v=Bd7Yyn61XWQ

## 3. Bridges

- **Reliable span: about 5 mm or less without sag or support marks (conservative).** [VENDOR] https://www.hubs.com/knowledge-base/how-design-parts-fdm-3d-printing/ ; Unionfab says unsupported spans "typically fail beyond ~5 mm." https://www.unionfab.com/blog/2026/03/design-for-manufacturing-3d-printing
- **Design limit up to 10 mm.** Hydra Research: horizontal bridges no longer than 10 mm; otherwise add vertical structures or supports. [VENDOR] https://www.hydraresearch3d.com/design-rules ; PrintPal also targets 10 mm or less (search excerpt).
- **Tuned machines: 20 to 25 mm** on a well-tuned desktop printer. [VENDOR, marketing] https://www.creality.com/blog/3d-printing-bridging (search excerpt). Treat as an upper bound, not a design value.
- **Conflict:** 5 mm (Hubs, Unionfab) is the most conservative; 10 mm (Hydra) is a reasonable default for internal or hidden surfaces; longer only with verification.
- **Tricks:**
  - Bridge straight spans between parallel walls; avoid curved bridge edges (the sacrificial-bridge method above converts curved overhangs into straight bridges). [VENDOR] Hydra Research.
  - Top solid layers over sparse infill are themselves bridges; the lower the infill density, the longer each span and the bigger the sag, so use enough top layers (see section 9). [VENDOR] https://help.prusa3d.com/article/layers-and-perimeters_1748
  - Long thin bridges that tie two independently printed walls cause a "shrink line" notch where the roof pulls the walls inward; printing at a slight angle spreads the roof over many layers and reduces it. [MEASURED/observed] CNC Kitchen orientation video https://www.youtube.com/watch?v=7aJ4dDyyf20

## 4. Supports: design strategies to eliminate them

- **Default: design for zero generated supports.** Every removed support saves post-processing and cost; in mass production a part should come off the printer finished. [PRACTITIONER] Slant 3D https://www.youtube.com/watch?v=9Hp-VRO1hVQ
- **Chamfer under overhangs (45 degrees or shallower)** so they self-support (section 2).
- **Split the part** into pieces that each print flat and support-free, then glue or fasten; add mating pins and holes at the cut. [VENDOR] Prusa KB https://help.prusa3d.com/article/modeling-with-3d-printing-in-mind_164135 ; Protolabs "cut and bind" https://www.protolabs.com/resources/design-tips/how-to-solve-for-size-constraints-small-gaps-and-thin-walls-in-3d-printed-parts/
- **Print-flat-then-fold:** split a part and join the halves with a thin printed hinge or bridge, print flat, fold after printing (example: Multiboard parts). [PRACTITIONER] CNC Kitchen https://www.youtube.com/watch?v=7aJ4dDyyf20
- **Designed (built-in) breakaway supports, "support fins":** a thin triangular fin under the overhang, joined to the part only by small sprues.
  - Sprues about 0.5 to 1 mm wide, oriented **horizontally in the layer plane** (not stacked vertically), so they fuse to the part within a layer and peel off leaving a small dimple.
  - Give the fin a wide foot: a small disc 1 to 2 mm thick at its base for bed adhesion.
  - Where a part rests on an edge or corner, chamfer it to create a flat contact (about 1 mm).
  - Label removable material (for example, an "R").
  - [PRACTITIONER] Slant 3D https://www.youtube.com/watch?v=9Hp-VRO1hVQ
  - Warning: loosely attached generated supports under an angled part can let warping stress build until the part springs loose and the nozzle hits it; designed supports rigidly attached at a few points avoid this. [MEASURED anecdote] CNC Kitchen https://www.youtube.com/watch?v=7aJ4dDyyf20
- **Rotate for appearance and support:** a cube printed on a corner or edge (diagonal) gets the same surface on all faces; it needs a support fin and a chamfered contact edge. [PRACTITIONER] Slant 3D https://www.youtube.com/watch?v=9Hp-VRO1hVQ
- **Self-supporting arches, gothic arches, diamond or teardrop cutouts:** teardrop is sourced (section 2). Gothic arch and diamond windows: **UNVERIFIED** at a primary source in this lane.
- **Threads:**
  - Do not model threads smaller than M5 or #10 UNC; post-process instead.
  - Never model threads in horizontal holes; they do not print cleanly even with supports.
  - [VENDOR] https://www.hydraresearch3d.com/design-rules
  - Support-free horizontal thread profiles (truncated or 45-degree flank): **UNVERIFIED** (no primary source read).
- **When supports are acceptable:** large holes that must have a crisp profile (Slant prefers supporting a large horizontal-axis hole from below over sacrificial layers); one-off prototypes; surfaces that are hidden or will be machined. [PRACTITIONER] https://www.youtube.com/watch?v=Bd7Yyn61XWQ

## 5. Print orientation and anisotropy

- **Across-layer (Z) strength is about 50% of in-plane strength.**
  - Tensile coupons, PLA, 0.2 mm layers: flat 63 MPa vs upright 31 MPa (49%). [MEASURED] CNC Kitchen https://www.youtube.com/watch?v=7aJ4dDyyf20
  - Hooks, PLA, 0.05 to 0.4 mm layers: every standing (across-layer) value was at least 50% below the lying ones. [MEASURED] https://www.cnckitchen.com/blog/the-influence-of-layer-height-on-the-strength-of-fdm-3d-prints
  - By material (Prusament hooks, vertical as % of horizontal): PLA 55% (40 kg), PETG 46% (25 kg), ASA 29% (17 kg). A 30 C enclosure raised ASA by 20%. [MEASURED] https://www.cnckitchen.com/blog/comparing-pla-petg-amp-asa-feat-prusament (search excerpt with full text)
  - Design value: **assume Z strength = 0.5 x XY for PLA/PETG and 0.3 x XY for ABS/ASA** unless tested.
- **Angling a part between flat and upright:** 30 degrees = 44 MPa, 45 degrees = 40 MPa (+27% over vertical), 60 degrees = 36 MPa, vs 63 flat and 31 upright. The curve is S-shaped: small tilts from the weak direction barely help. If tilting to fix layer adhesion, **tilt at least 45 degrees.** [MEASURED] CNC Kitchen https://www.youtube.com/watch?v=7aJ4dDyyf20
- **Layer height vs strength:** strength drops once L exceeds 0.5 x N; with a 0.4 mm nozzle stay at 0.2 mm or below for strong parts. At 0.3 mm, standing hooks held half the load; at 0.4 mm almost nothing. [MEASURED] https://www.cnckitchen.com/blog/the-influence-of-layer-height-on-the-strength-of-fdm-3d-prints
- **Orient so the main load runs along the layers (in the XY plane), and the highest-stress region is not a layer boundary.** A bracket printed on its big face has layer boundaries at the bend where it fails; printed on its side, stresses align with the lines. [MEASURED/explained] CNC Kitchen https://www.youtube.com/watch?v=7aJ4dDyyf20
- **Layer joints are stress concentrators:** round-ended bead cross-sections leave small valleys between layers that start cracks. [VENDOR] https://www.hubs.com/knowledge-base/how-design-parts-fdm-3d-printing/
- **Holes through layer lines split:** a hole in a side wall whose axis is horizontal, loaded by a screw, cracks along the layer at the hole's equator; countersunk wood screws in such holes wedge layers apart. [PRACTITIONER/MEASURED] Slant 3D https://www.youtube.com/watch?v=9Hp-VRO1hVQ ; CNC Kitchen https://www.youtube.com/watch?v=7aJ4dDyyf20
  - Slant 3D fixes, in increasing strength:
    1. Add small relief slots around the hole for compliance.
    2. Add a hidden 2 mm hole next to it so extra perimeters reinforce the area.
    3. Add hidden thin slits about 1 mm below (and optionally above) the hole's center line, so the slicer builds solid top/bottom skins (about 1 mm) flanking the hole's weak plane.
  - [PRACTITIONER] https://www.youtube.com/watch?v=9Hp-VRO1hVQ
- **Bosses and pins:** a pin standing vertically (axis Z) is weakest in bending at its base because layer boundaries cross it. Pins under 5 mm diameter print as perimeters only, with no infill; add a small fillet at the base. [VENDOR] https://www.hubs.com/knowledge-base/how-design-parts-fdm-3d-printing/ . For load-bearing pins, print them lying down (axis in XY) or use store-bought metal pins with holes on both sides. [VENDOR] Hydra Research.
- **Multi-direction parts (corner brackets, hose adapters):** no orientation is good for every arm; either compromise (for example tip it 45 degrees so no arm is purely across-layer) or split the part. [MEASURED/explained] CNC Kitchen https://www.youtube.com/watch?v=7aJ4dDyyf20
- **Export the STL in the intended print orientation** so the downstream printer uses the orientation the design assumed. [PRACTITIONER] CNC Kitchen, same video.

## 6. First layer and bed contact

- **Elephant's foot:** the first layer is squished against the bed and comes out wider than designed. Slicer compensation about 0.2 mm usually works for a 0.4 mm nozzle (it shrinks the first layer). [VENDOR] https://help.prusa3d.com/article/elephant-foot-compensation_114487
- **Bottom-edge chamfer to absorb elephant's foot (design-side, slicer-independent):**
  - Hydra Research: about 0.3 mm chamfer (first-layer height + one layer) on all bed-contact edges. [VENDOR] https://www.hydraresearch3d.com/design-rules
  - Slant 3D: 1 mm chamfer on every first-layer edge; a chamfer, not a fillet. [PRACTITIONER] https://www.youtube.com/watch?v=9Hp-VRO1hVQ
  - Hubs: 45-degree chamfer or radius on all bed-contact edges (no size stated). [VENDOR] https://www.hubs.com/knowledge-base/how-design-parts-fdm-3d-printing/
  - **Conflict:** 0.3 mm (Hydra) is the minimum that hides the lip; 1 mm (Slant) is more robust against machine variation and is the conservative choice for parts made on unknown printers. Recommended default: 0.5 to 1 mm x 45 degrees; at least L_first + L.
- **Round vertical corners, especially at the bed.** Sharp corners concentrate warping shrink forces at one point; round them. Hydra recommends R greater than 4 mm on bed-contact corners of larger parts. [VENDOR] https://www.hydraresearch3d.com/design-rules . Slant 3D: fillet every vertical edge; a sharp corner forces an abrupt nozzle direction change that can tug the first-layer line loose. [PRACTITIONER] https://www.youtube.com/watch?v=9Hp-VRO1hVQ
- **Keep the first layer simple:** no text, logos or fine detail on the bed face (isolated islands such as the center bar of an "E" do not stick and shift). Keep the first layer on a hidden or bottom face; do not make it a cosmetic face for production parts. [PRACTITIONER] Slant 3D https://www.youtube.com/watch?v=9Hp-VRO1hVQ
- **Point or edge contacts need a flat:** a corner or edge resting on the bed comes loose; chamfer it to give a flat contact pad (1 mm is enough). [PRACTITIONER] Slant 3D, same video.
- **Warping and geometry:** large flat bases are prone to warping because uneven cooling lifts the edges. [VENDOR] Unionfab. High-temperature materials (ABS, ASA, PC) warp most; ABS is more prone than PLA. [VENDOR] https://help.prusa3d.com/article/warping_2011 ; Hubs.
- **Brims and mouse ears:** use a brim; if that is not enough, add small geometry such as a thin disc ("mouse ear") at the corner that lifts. [VENDOR] https://help.prusa3d.com/article/warping_2011 . Common practice is a single-layer disc overlapping each corner by about a quarter. [PRACTITIONER] Prusa forum (search excerpt). Designed-in ears are 1 x L thick and snap off.
- **Ribs and large solid bases:** splitting a large flat part, or adding chamfered bases and rounded corners, reduces warp-lift; quantified warp-vs-geometry data: **UNVERIFIED** (no measured study found in this lane).

## 7. Holes and pins

- **Why printed holes come out undersized:**
  1. **Faceting:** STL polygons have vertices on the circle so the flats sit inside it; diameter shrinks by cos(pi/n). 10 sides gives 5% error and 22 sides gives 1%. [MEASURED/derived] https://hydraraptor.blogspot.com/2011/02/polyholes.html
  2. **Arc shrinkage and corner cutting:** a bead bent into an arc has excess plastic on the inside, and the filament cuts corners as it is dragged around, so small circles print smaller. [PRACTITIONER] Same source.
  3. Material shrinkage, first-layer squish, moist filament, poorly tuned flow, holes close to nozzle size (under 1 mm hard to tune), lack of lead-in chamfers, and seams. [VENDOR] https://wiki.bambulab.com/en/software/bambu-studio/xy-hole-contour-compensation
  4. The nozzle compresses each layer, widening the bead into the hole; worse for small holes. [VENDOR] https://www.hubs.com/knowledge-base/how-design-parts-fdm-3d-printing/
- **Compensation values:**
  - Model holes under 5 mm 0.2 to 0.4 mm larger than nominal. [VENDOR] https://simplemachining.com/blogs/dfm-for-3d-printing-a-practical-design-guide
  - Export with enough facets (32+ sides, under 0.5% polygon error) and circumscribe the polygon: r_model = r / cos(180 deg / n). [PRACTITIONER] https://printpal.io/docs/3d-printing-design-guide (search excerpt)
  - Polyhole rule: n = max(round(2 x d_mm), 3) sides, radius increased by 1/cos(180/n); all test holes over 1 mm then fit their drills on two different machines. [MEASURED] https://hydraraptor.blogspot.com/2011/02/polyholes.html
  - Slicer-side: Bambu "X-Y hole compensation" grows hole diameter by 2 x the value; "X-Y contour compensation" changes outer size only; it only works on closed loops, and on layers where the hole is open to the side it causes visible layer separation. [VENDOR] https://wiki.bambulab.com/en/software/bambu-studio/xy-hole-contour-compensation
  - Composite formula (shrink % + slicer comp 0.08 to 0.30 mm + 0.10 mm for vertical-axis holes): **UNVERIFIED** (search excerpt only) https://tools.creative3dp.com/blog/3d-printed-holes-too-small/
  - **Agent rule:** for slicer-independent fit, either add +0.2 mm (holes up to 10 mm) to +0.3 mm on diameter in CAD, or model undersize and drill or ream; never rely on the slicer's hole compensation, because it changes per user (Slant 3D advises tuning fit in the design, not the slicer). https://www.youtube.com/watch?v=9Hp-VRO1hVQ
- **Minimum hole size: 2 mm diameter.** Below this, holes may close up. For accurate holes of any size, print undersize and drill. [VENDOR] Hydra Research ; UltiMaker learn page (search excerpt) https://ultimaker.com/learn/design-for-fff-3d-printing-maximize-your-success/
- **Vertical (axis Z) vs horizontal (axis XY) holes:** vertical holes are round but undersized; horizontal holes are oval (sagging top, stair-stepped bottom) and need a teardrop or flat-top modification (section 2).
- **Drill or ream when:** the diameter is critical (bearing, dowel, press fit). Print it undersized and drill to size. [VENDOR] Hubs; Hydra.
- **Tapped and self-tapped holes and heat-set inserts (pilot as % of size):** tap = 90% of thread major diameter; self-tapping screw = 96%; heat-set insert = 98% of insert OD. [VENDOR] https://www.hydraresearch3d.com/design-rules
- **Fit-tolerant hole and pin features (avoid relying on exact diameters):**
  - **Tapered pin:** about a 1 to 2 degree taper, so the pin wedges tighter as it goes in.
  - **Split, compliant pin:** a pin with a slot that compresses into the hole.
  - **Lead-in chamfer** at the hole mouth.
  - **Crush ribs:** small internal ribs that deform or shave on insertion, for a one-time press fit.
  - **Grip fins:** thin angled fins around the hole about 1 mm long, sized slightly under the shaft (example: 11 mm ID for a 12 mm rod), with a 0.3 mm gap left at the hole bottom so they can flex.
  - [PRACTITIONER] Slant 3D https://www.youtube.com/watch?v=9Hp-VRO1hVQ and https://www.youtube.com/watch?v=Bd7Yyn61XWQ
- **Pin minimum diameter: 1.8 mm (4 x W)** so at least two full perimeters form. [VENDOR] Hydra Research. Pins under 5 mm are perimeter-only; add a base fillet. [VENDOR] Hubs.
- **Clearances between mating printed parts (per side unless stated):**
  - Hydra: about 0.2 mm loose fit, about 0.1 mm tight fit. [VENDOR]
  - Prusa: start at least 0.3 mm for movable parts. [VENDOR]
  - Simple Machining: at least 0.3 mm per side. [VENDOR]
  - Unionfab: at least 0.3 mm for parts that fit or slide; 0.2 to 0.5 mm gaps. [VENDOR]
  - Makelab: slip and snap fits 0.2 to 0.3 mm per side; printed shaft into a machined hole, undersize the shaft 0.2 to 0.3 mm. [VENDOR] (search excerpt) https://www.makelab.com/insights/3d-printing-tolerances-explained
  - UltiMaker: 0.6 mm gap for parts printed together that must move. [VENDOR] (search excerpt)
  - **Conflict resolution:** 0.1 mm (Hydra tight fit) is least conservative; 0.3 mm per side is the consensus starting point for sliding fits; 0.5 to 0.6 mm for print-in-place moving parts is conservative.

## 8. Small features

- **Minimum feature size:**
  - Hydra: greater than 1.8 mm, or 4 x W. [VENDOR]
  - Simple Machining: features must exceed 2 x L in Z and 2 x XY resolution laterally. [VENDOR]
  - Hubs service: 2.0 mm. [VENDOR]
  - Arachne drops anything under 25% of N (0.1 mm) and widens anything under 85% of N to 0.34 mm. [VENDOR] Bambu
  - **Agent rule:** standalone features at least 4 x W (1.8 mm) in XY; anything structural at least 2 perimeters thick.
- **Minimum gaps between separate features:**
  - Unionfab: keep at least 0.4 to 0.5 mm between features to stop them fusing. [VENDOR]
  - Protolabs flags gaps under 0.75 mm (multi-process advisory) as likely to fuse. [VENDOR] https://www.protolabs.com/resources/design-tips/how-to-solve-for-size-constraints-small-gaps-and-thin-walls-in-3d-printed-parts/
  - **Conservative: 0.75 mm.** Practical FDM floor about 1 x W plus clearance (0.5 mm).
- **Embossed and engraved text and detail:**
  - Hydra Research (horizontal surfaces): embossed strokes at least 0.9 mm wide (2 x W); engraved at least 0.5 mm wide; height or depth up to about 2 mm for visibility. On vertical surfaces, embossed strokes at least 0.9 mm wide, about 0.9 mm or less out; engraved at least 0.5 mm wide and under 0.9 mm deep; larger features start to sag. [VENDOR] https://www.hydraresearch3d.com/design-rules
  - HLH Rapid: embossed at least 0.3 mm high; engraved at least 0.5 mm deep and 0.5 mm wide. [VENDOR] (search excerpt) https://hlhrapid.com/knowledge/design-guide-fdm-3d-printing/
  - Unionfab: at least 0.5 mm depth or height for legibility. [VENDOR]
  - Nozzle-relative formula: minimum stroke = 2 x N (bold) to 2.5 x N (regular); readable character height about 4.5 mm bold / 6 mm regular at 0.4 mm (stroke x 5.6 to 6); depth = 3 x L raised or 4 x L engraved. A 0.2 mm nozzle halves these. [PRACTITIONER calculator] https://3dprintcalcs.uk/design/text-emboss-calculator/ (search excerpt)
  - Other text guides range from 3 mm minimum height with 0.8 mm stroke to 5 to 6 mm raised and 3 to 4 mm engraved. [VENDOR] (search excerpts, Dwart, Mandarin3D)
  - **Agent rule:** stroke at least 2 x W (0.9 mm), character height at least 5 mm (bold sans-serif), raised 2 to 3 layers (0.4 to 0.6 mm), engraved 3 to 4 layers (0.6 to 0.8 mm). Text goes on vertical walls or top faces, never on the first layer (Slant 3D).
- **Sharp corners in XY vs Z:**
  - **XY:** the nozzle is round, so outside vertical corners always have a radius of about N/2 or more; perfectly sharp external corners are not achievable. [VENDOR] Hubs ("corners and edges have a radius equal to the nozzle size"). Inside (concave) vertical corners can be sharp, which is also where seams hide well (section 10). Slant 3D still recommends filleting vertical edges for smoother motion and better first layers.
  - **Z:** edge sharpness is limited by L (stair-stepping); shallow curved tops show pronounced terraces. [PRACTITIONER] Slant 3D curved-surface transcript https://www.youtube.com/watch?v=ujAwxSx63FE
  - Fillets: at least 1 mm where used; never on downward-facing edges. [VENDOR] Hydra.

## 9. Strength: infill vs perimeters, ribs, fillets, top/bottom layers

- **Perimeters beat infill for strength per gram:** at 15% infill, adding shells (2 to 6 perimeters) raised strength far more efficiently than raising infill; **6 perimeters + 15% infill was as strong as 2 perimeters + 100% infill.** Reason: bending stress is highest at the outer fibers, and perimeter strands run along the load path. Print time at equal strength was similar because perimeters print slower. [MEASURED] CNC Kitchen https://www.youtube.com/watch?v=AmEaNAwFSfI
- **Infill pattern (30%, 2 perimeters, 0.2 mm, PLA hooks):** wiggle 45 kg, rectilinear 48 kg, grid 52 kg, honeycomb 57 kg, triangular 60 kg (but triangular used about 45% actual material); per unit weight honeycomb led. From 15 to 75% infill, rectilinear and honeycomb gave about the same strength; above 50%, rectilinear printed much faster. [MEASURED] same video.
- **Practical ceiling for strong parts: about 4 perimeters and 50% infill;** 100% infill is uneconomical and sensitive to over-extrusion. [MEASURED + PRACTITIONER] same video. CNC Kitchen's own functional default is 0.2 mm, 3 perimeters, 30% infill. https://www.cnckitchen.com/blog/extrusion-system-benchmark-tool-for-fast-prints (search excerpt)
- **Design implication [DERIVED]:** strength comes from wall thickness at the surface. Put material where bending stress is (outer skin), keep walls at whole multiples of W, and prefer a solid closed shape over molding-style thin walls with internal ribs. Slant 3D: design a solid block and let the slicer fill it; molding-style ribs remove a wall and weaken the printed part; no draft angles are needed. [PRACTITIONER] https://www.youtube.com/watch?v=9Hp-VRO1hVQ
- **Ribs and gussets:** where ribs are used, make rib thickness a whole multiple of W (at least 2 x W) and keep them in the XY plane where possible so their strands run along the load. Specific FDM rib ratios: **UNVERIFIED** (no primary FDM source found; molding ratios do not transfer).
- **Gradient infill (denser near walls):** about 30% more stiffness per weight than uniform infill. [MEASURED] https://www.cnckitchen.com/blog/gradient-infill-for-3d-prints (search excerpt)
- **Fillets at stress risers:** use fillets (at least 1 mm) on internal corners in the XY plane to relieve stress concentrations; on downward-facing internal corners use chamfers. Add a small fillet at the base of pins under 5 mm. [VENDOR] Hydra Research; Hubs.
- **Top and bottom layers:**
  - At least 3 top layers at 0.3 mm layers and 9 at 0.1 mm, i.e. roughly 0.9 mm of top skin. Top solid infill bridges over sparse infill, so low infill needs more top layers to avoid sagging or "pillowing." Prusa profiles always use at least 2 perimeters. [VENDOR] https://help.prusa3d.com/article/layers-and-perimeters_1748
  - CNC Kitchen used 4 bottom / 5 top at 0.2 mm in strength tests. [MEASURED setup]
  - Community preference: 1 to 1.2 mm top and bottom skin. [PRACTITIONER] Prusa forum (search excerpt)
  - **Design implication:** horizontal plates thinner than top + bottom skin (about 1.6 to 2 mm) print fully solid; a plate thinner than about 2 x skin gains nothing from infill.

## 10. Dimensional accuracy and seams

- **Achievable accuracy:**
  - Prusa: an Original Prusa is accurate to at least 0.2 mm, but materials shrink and warp. [VENDOR] https://help.prusa3d.com/article/modeling-with-3d-printing-in-mind_164135
  - Makelab: about +/-0.2 mm on small features, +/-0.5 mm on dimensions over 200 mm. [VENDOR] (search excerpt)
  - Simple Machining: +/-0.3 to 0.5 mm for features under 100 mm. [VENDOR]
  - Hubs: desktop +/-0.5% with a +/-0.5 mm floor; industrial +/-0.15% with a +/-0.2 mm floor. [VENDOR] https://www.hubs.com/knowledge-base/what-is-fdm-3d-printing/ (search excerpt)
  - **Conflict:** +/-0.2 mm (Prusa, well-tuned own machine) vs +/-0.5 mm (Hubs, unknown machine). Use +/-0.2 mm for parts printed on a known, calibrated machine and +/-0.5 mm (or 0.5%) when the printer is unknown.
- **Elephant's foot, seams and hole shrink are the main local errors;** the base edge and holes are the least accurate features (sections 6 and 7).
- **Seams:** every perimeter loop starts and ends somewhere, leaving a visible seam (a zit or groove).
  - "Nearest" placement hides the seam in a concave, non-overhanging corner; "Aligned" or "Rear" stacks it in a line, preferably in corners; "Random" is pointless on models with corners; "Scarf" seams overlap the start and end to hide seams on smooth, curved surfaces but add print time and work poorly on sharp corners and overhangs. Seams are obvious on cylinders with no corners. [VENDOR] https://help.prusa3d.com/article/seam-position_151069 (search excerpt with full text)
  - **Design to hide seams [DERIVED from the above]:** give cosmetic parts a deliberate concave vertical corner, groove or parting line on a non-visible side where the seam can sit; avoid fully smooth cylinders on cosmetic faces, or accept a scarf seam. Note the tension with Slant 3D's "fillet every vertical edge": round outside corners for motion and adhesion, but keep or add one inside corner or groove as the seam home.
  - Seams also weaken hole precision (Bambu) and are a crack-start site on round bosses (practitioner knowledge, **UNVERIFIED** at a measured source).
- **Curved top surfaces terrace badly** because a shallow slope makes each layer step inward a long way. Fixes, in order of preference:
  1. Re-orient so the curve is printed on its side (needs a bottom chamfer).
  2. Replace curves with flat facets or chamfers (constant slope means even layer lines).
  3. Intentional stair steps (about 1 mm).
  4. Fuzzy skin or texture.
  5. Variable or thinner layers (costly; about 50% slower even when optimized).
  - [PRACTITIONER] Slant 3D https://www.youtube.com/watch?v=ujAwxSx63FE ; Maker's Muse (variable layer height) https://www.youtube.com/watch?v=XTvBOGgx48I

## 11. Designing for print time, material and mass production (Slant 3D style)

All from Slant 3D transcripts unless noted. [PRACTITIONER, print-farm operator]
- **No generated supports.** Chamfer overhangs away; if geometry must overhang, use designed breakaway support fins (section 4). https://www.youtube.com/watch?v=9Hp-VRO1hVQ
- **Single, stable orientation designed in from the first sketch;** export the STL in that orientation. (CNC Kitchen also says this.) https://www.youtube.com/watch?v=7aJ4dDyyf20
- **1 mm x 45-degree chamfer on all bed-contact edges; fillet all vertical edges; no text or detail on the first layer; first layer on a hidden face.** https://www.youtube.com/watch?v=9Hp-VRO1hVQ
- **Tune fit in CAD, not the slicer** (slicer settings differ between users and machines): tapers, lead-in chamfers, crush ribs, grip fins, compliant slots. https://www.youtube.com/watch?v=9Hp-VRO1hVQ
- **Avoid shallow domed and curved tops;** use facets, print on the side, or texture. https://www.youtube.com/watch?v=ujAwxSx63FE
- **Do not 3D print a molded design:** drop draft angles and molding-style rib-and-shell construction; use solid shapes with infill and add texture freely. https://www.youtube.com/watch?v=9Hp-VRO1hVQ
- **Embedding nuts and magnets without pausing the print:**
  - Nuts: a side slot (stop it about 0.5 mm, two layers, below the top) that the nut slides into, plus a through hole.
  - Magnets: tall cylindrical magnets pressed into a slightly narrower "over-center" slot (example: 1.5 mm slot for a 2 mm magnet) so they snap and lock. Avoid press-only friction fits and mid-print inserts, which hold printers idle.
  - https://www.youtube.com/watch?v=9Hp-VRO1hVQ
- **Diagonal (corner-down) orientation for boxes and cubes:** all faces look the same; needs a chamfered contact edge and support fins. Note the trade-off: a third party reports Slant tilts boxes 45 degrees so they auto-eject, at some cost in strength and time. **UNVERIFIED** (Reddit comment, search excerpt): https://www.reddit.com/r/3DPrintFarms/comments/1l5ak4y/review_of_slant_3d_print_farm_calls_them_out_of/
- **Automatic ejection, belt printers, avoiding large flat top surfaces for farm throughput:** **UNVERIFIED.** No Slant 3D page or transcript read in this lane states these rules explicitly; the Slant blog index lists no written design posts (it links to tools and videos).
- **Print-time levers that do not cost strength** [MEASURED, CNC Kitchen]:
  - Wider extrusion width gives more strength in the same or less time.
  - Rectilinear infill is the fastest pattern at a given strength above 50% infill.
  - Strength scales with material regardless of nozzle size: https://www.cnckitchen.com/blog/big-nozzles-how-do-they-make-your-3d-prints-stronger (search excerpt)
- **Minimize part count and use standard parts** (general DFM). [VENDOR] https://formlabs.com/blog/design-for-manufacturing-with-3d-printing/

## 12. Common mistakes (agents and beginners)

Each item maps to a rule above.
1. Modeling walls or features thinner than 1 x W (for example 0.2 mm on a 0.4 mm nozzle). They vanish (Classic) or come out 70% oversize (Arachne). (Section 1)
2. Walls that are not whole multiples of W, which leave gap fill and voids in load-bearing walls. (Section 1)
3. Fillets on downward-facing and bed-contact edges instead of chamfers. (Sections 2 and 6)
4. Flat-topped horizontal holes and circular counterbores floating over air, with no teardrop or sacrificial bridge. (Section 2)
5. Exact-size holes and pins with zero clearance; trusting nominal diameters; too few facets in the exported mesh. (Section 7)
6. Ignoring anisotropy: loads that pull layers apart, screw holes whose axis runs through layer lines, upright pins under bending. (Section 5)
7. Raising infill instead of perimeters for strength. (Section 9)
8. Bridges over about 10 mm, and overhangs past 45 to 50 degrees without a support strategy. (Sections 2 and 3)
9. Text, logos or fine detail on the first layer; sharp corners and no chamfer on large bed contacts (warping, elephant's foot). (Section 6)
10. Point or edge contact with the bed after rotating a part, with no flat pad. (Sections 4 and 6)
11. Copying injection-molding conventions (draft, thin ribbed shells) into printed parts. (Section 11)
12. Layer heights above 0.5 x N for structural parts. (Section 5)
13. Modeled threads under M5 or in horizontal holes. (Section 4)
14. Gaps under about 0.5 mm between features meant to stay separate (they fuse). (Section 8)
15. Shallow domes on cosmetic tops (terracing), and smooth cylinders on cosmetic faces (seams with nowhere to hide). (Section 10)
16. Expecting tighter than +/-0.2 mm without post-machining. (Section 10)

---

## Quick reference: formulas at a 0.4 mm nozzle and 0.2 mm layers

| Rule | Formula | Value at N = 0.4, L = 0.2, W = 0.45 |
|---|---|---|
| Min wall (printable) | 1 x W | 0.45 mm |
| Min structural wall | 2 x W | 0.9 mm |
| Load-bearing wall | 3 to 4 x W | 1.35 to 1.8 mm |
| Arachne drop threshold | 0.25 x N | 0.1 mm |
| Arachne min bead | 0.85 x N | 0.34 mm |
| Min pin or standalone feature | 4 x W | 1.8 mm |
| Min hole | constant | 2 mm (drill if accurate) |
| Max layer height for strength | 0.5 x N | 0.2 mm |
| Overhang (step per layer at most 0.5 x W) | atan(0.5 x W / L) | about 48 degrees; design 45 degrees |
| Bridge | constant | 5 mm conservative, 10 mm design max |
| Bottom chamfer | at least L_first + L | 0.3 mm min, 1 mm robust |
| Sacrificial bridge layers | 1 x L, then 2 x L | 0.2 mm, then 0.4 mm |
| Horizontal-hole droop allowance | 1 x L (2 x L if L is 0.1 or less) | 0.2 to 0.3 mm |
| Text stroke | 2 x W | 0.9 mm |
| Raised or engraved depth | 3 x L or 4 x L | 0.6 or 0.8 mm |
| Sliding clearance per side | constant | 0.3 mm (0.2 tight, 0.5 to 0.6 print-in-place) |
| Small-hole oversize (under 5 mm) | constant | +0.2 to 0.4 mm on diameter |
| Polygon facets | n at least 32, r / cos(180/n) | |
| Top skin | at least 3 layers and at least 0.9 mm | 5 layers at 0.2 mm |
| Z-strength knockdown | 0.5 (PLA/PETG), 0.3 (ASA/ABS) | |
| Tilt to improve Z strength | at least 45 degrees | +27% vs upright |
| Tap / self-tap / insert pilot | 90% / 96% / 98% | |

---

## Sources

All accessed 2026-11-12. "Read" = full page or full transcript fetched; "excerpt" = only the search-result highlight was read (lower confidence).

| # | URL | Used for | Depth |
|---|---|---|---|
| 1 | https://help.prusa3d.com/article/modeling-with-3d-printing-in-mind_164135 | Wall-per-perimeter table, overhang 45 to 75 degrees, accuracy 0.2 mm, 0.3 mm movable clearance, chamfer vs fillet, splitting | Read |
| 2 | https://help.prusa3d.com/article/elephant-foot-compensation_114487 | Elephant's foot cause, 0.2 mm compensation | Read |
| 3 | https://help.prusa3d.com/article/layers-and-perimeters_1748 | Top layer counts, top skin bridging, minimum 2 perimeters | Read |
| 4 | https://help.prusa3d.com/article/seam-position_151069 | Seam placement modes, scarf seams | Excerpt (full body in highlight) |
| 5 | https://help.prusa3d.com/article/warping_2011 | Warping causes, brim, helper geometry | Excerpt |
| 6 | https://wiki.bambulab.com/en/software/bambu-studio/wall-generator | Classic vs Arachne, min feature 25%, min wall 85% | Read |
| 7 | https://wiki.bambulab.com/en/software/bambu-studio/xy-hole-contour-compensation | Hole shrink causes, XY hole/contour compensation | Read |
| 8 | https://wiki.bambulab.com/en/software/bambu-studio/parameter/elephant-foot | Elephant's foot (no numbers extracted) | Read |
| 9 | https://www.cnckitchen.com/blog/the-effect-of-extrusion-width-on-strength-and-quality-of-3d-prints | Extrusion width vs strength | Read |
| 10 | https://www.cnckitchen.com/blog/the-influence-of-layer-height-on-the-strength-of-fdm-3d-prints | Layer height vs strength, anisotropy at least 50%, 0.15 mm sweet spot | Read |
| 11 | https://www.cnckitchen.com/blog/comparing-pla-petg-amp-asa-feat-prusament | Layer adhesion % by material | Excerpt (long) |
| 12 | https://www.cnckitchen.com/blog/gradient-infill-for-3d-prints | Gradient infill stiffness | Excerpt |
| 13 | https://www.cnckitchen.com/blog/big-nozzles-how-do-they-make-your-3d-prints-stronger | Strength proportional to material | Excerpt |
| 14 | https://www.youtube.com/watch?v=AmEaNAwFSfI (CNC Kitchen) | Infill pattern and density vs perimeters, quantified | Transcript |
| 15 | https://www.youtube.com/watch?v=7aJ4dDyyf20 (CNC Kitchen) | Orientation tests 0/30/45/60/90 degrees, shrink lines, split-and-fold | Transcript |
| 16 | https://www.youtube.com/watch?v=9Hp-VRO1hVQ (Slant 3D) | Mass-production rules: chamfers, fillets, support fins, fit features, hole reinforcement, inserts, first layer | Transcript |
| 17 | https://www.youtube.com/watch?v=Bd7Yyn61XWQ (Slant 3D) | Hole design: teardrop point, sacrificial layers, crush ribs, grip fins | Transcript |
| 18 | https://www.youtube.com/watch?v=ujAwxSx63FE (Slant 3D) | Curved-surface terracing fixes | Transcript |
| 19 | https://www.youtube.com/watch?v=XTvBOGgx48I (Maker's Muse) | Chamfers vs fillets explained in G-code | Transcript |
| 20 | https://www.hydraresearch3d.com/design-rules | Full FFF rule set (walls, chamfers, corners, bridges, clearances, text, features, holes, threads, sacrificial bridges) | Read |
| 21 | https://www.hubs.com/knowledge-base/how-design-parts-fdm-3d-printing/ | Overhang 45 degrees / 50%, bridges 5 mm, base chamfers, pins under 5 mm, vertical-hole undersizing, layer-joint cracking | Read |
| 22 | https://www.hubs.com/knowledge-base/key-design-considerations-3d-printing/ | Wall 0.8 mm, overhang about 45 degrees (table did not render) | Read (partial) |
| 23 | https://www.hubs.com/knowledge-base/what-is-fdm-3d-printing/ and https://www.hubs.com/3d-printing/fdm/ | Accuracy +/-0.5% / +/-0.5 mm, min feature 2.0 mm | Excerpt |
| 24 | https://simplemachining.com/blogs/dfm-for-3d-printing-a-practical-design-guide | Wall 1.0 to 1.2 mm, tolerances, clearance 0.3 mm, hole oversize 0.2 to 0.4 mm | Read |
| 25 | https://www.unionfab.com/blog/2026/03/design-for-manufacturing-3d-printing | Wall 0.8 mm multiples, bridges 5 mm, clearance, text 0.5 mm, spacing 0.4 to 0.5 mm, warping | Read |
| 26 | https://www.protolabs.com/resources/design-tips/how-to-solve-for-size-constraints-small-gaps-and-thin-walls-in-3d-printed-parts/ | Small-gap advisory 0.75 mm, cut and bind | Read |
| 27 | https://formlabs.com/blog/design-for-manufacturing-with-3d-printing/ | General DFM principles only (no FDM numbers) | Read |
| 28 | https://ultimaker.com/wp-content/uploads/2024/06/How-to-design-for-FFF-1.pdf | 45-degree rule, wall at least nozzle diameter | Read (PDF) |
| 29 | https://ultimaker.com/learn/design-for-fff-3d-printing-maximize-your-success/ | Min hole 2 mm, 0.6 mm print-together gap, elephant's foot | Excerpt |
| 30 | https://hydraraptor.blogspot.com/2011/02/polyholes.html | Hole-shrink physics, polyhole formula | Read |
| 31 | https://hackaday.com/2017/10/17/sacrificial-bridge-avoids-3d-printed-supports/ | Sacrificial bridge concept | Read |
| 32 | https://brentwerder.design/2019/12/14/tricking-my-printer-to-print-perfect-overhangs/ | Stepped bridge counterbore trick | Read |
| 33 | https://github.com/Ultimaker/Cura/issues/2656 | Sacrificial bridging context (little content) | Read |
| 34 | https://printpal.io/docs/3d-printing-design-guide | Teardrop, facets, circumscribed polygons, bridges 10 mm | Excerpt |
| 35 | https://hlhrapid.com/knowledge/design-guide-fdm-3d-printing/ | Emboss 0.3 mm, engrave 0.5 x 0.5 mm, wall 1.2 mm | Excerpt |
| 36 | https://3dprintcalcs.uk/design/text-emboss-calculator/ | Nozzle-relative text formula | Excerpt |
| 37 | https://www.makelab.com/insights/3d-printing-tolerances-explained | Tolerance +/-0.2 / +/-0.5 mm, slip-fit clearance | Excerpt |
| 38 | https://www.creality.com/blog/3d-printing-bridging | Bridge 20 to 25 mm upper bound | Excerpt |
| 39 | https://www.xometry.com/resources/design-guides/design-guide-fused-deposition-modeling-fdm-3d-printing/ | Gated behind a contact form; no rules extracted (not submitted) | Read (gated) |
| 40 | https://markforged.com/resources/blog/design-for-additive-manufacturing-dfam | No extractable FFF rules on the page | Read (empty) |
| 41 | https://www.slant3d.com/blog | Index only; no written design articles found | Read (index) |

Count: 28 sources read in full (pages, PDF or transcripts, including the gated or empty ones) and 13 used from search excerpts only.

## Gaps

- **Made with Layers / toms3d.org:** no design-rule video or article was located and read. One transcript fetched turned out to be from a different creator and was discarded. Teaching Tech, 3D Printing Nerd and Zack Freedman videos were not reached either. A follow-up should pull transcripts of specific titles (for example a Made with Layers infill or design video, and Zack Freedman's design-for-printing videos).
- **Slant 3D written blog:** the blog index lists tools and videos, not articles. Rules on automatic ejection, belt printers, and "avoid large flat tops" for farm throughput are **UNVERIFIED** at Slant itself.
- **Xometry FDM guide** is gated behind a lead form; **Markforged DfAM** page had no extractable FFF rules. Both are effectively unread.
- **Gothic-arch and diamond horizontal holes, and support-free thread profiles:** no primary source read (**UNVERIFIED**).
- **Quantified warping vs geometry** (footprint size, corner radius, rib layout vs measured lift): no measured study found.
- **FDM-specific rib and gusset ratios:** none found; injection-molding ratios should not be reused.
- **Overhang limit as a function of layer height:** the atan(0.5 x W / L) relation is DERIVED from the Hubs "50% support" statement, not measured; it needs test data (for example a CNC Kitchen or Teaching Tech overhang test) before being treated as a hard rule.
- **Hole compensation:** no single measured table of "add X mm for diameter D" from a primary tester; the Creative3DP formula was seen only as a search excerpt.
- **Seam crack initiation** on round bosses: practitioner lore, not verified with test data.
- **Modern high-speed machines** (CoreXY, input shaping): no source quantified how much faster speeds shift the overhang, bridge or accuracy numbers beyond Prusa's 75-degree claim for 360-degree cooling.
