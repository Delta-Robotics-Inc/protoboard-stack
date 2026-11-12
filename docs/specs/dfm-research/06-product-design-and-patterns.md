# 06 - Product Design Principles and Structural-Decorative Patterns (FDM focus)

Lane 6 of the DFM research set. Audience: an AI CAD agent designing mostly FDM-printed mechanical parts (0.4 mm nozzle assumed unless noted).

Labels used throughout:
- **[SRC n]** = verified at the cited source (see Sources list).
- **UNVERIFIED** = seen only in a search snippet or secondary summary, not confirmed at the primary source.
- **DERIVED** = my own reasoning or arithmetic from sourced facts; treat as a starting value to test, not a published rule.

Direct quotes are kept under 15 words; everything else is paraphrase.

---

## A. Product and industrial design principles, translated into checkable CAD rules

### A.0 Framing: Rams's ten principles as a review checklist

Dieter Rams's ten principles (Vitsoe's official list [SRC 1]): innovative, useful, aesthetic, understandable, unobtrusive, honest, long-lasting, thorough, environmentally friendly, and as little design as possible. Rams frames them as criteria for judgment, not rules (several commentaries agree; dates of formulation differ between sources, and the wording was revised over time) [SRC 1, SRC 2].

Translation into checks an agent can run on a model (DERIVED):

| Principle | Checkable translation for a CAD model |
|---|---|
| Useful | Every feature maps to a requirement (fastening, airflow, grip, cable exit, label). Delete features with no requirement. |
| Understandable | Interaction points (buttons, ports, latches, release tabs) are visually distinct from structure: recess, frame, or a different edge treatment. Orientation of the product is readable (a clear "front" and "bottom"). |
| Unobtrusive | Secondary and tertiary features (screws, vents, seams) are subordinate: smaller, recessed, aligned, grouped, or placed on non-primary faces. |
| Honest | No fake vents, fake screws, or decorative isogrid/Voronoi presented as structure when it is not structural. *Correction 2026-11-12: structural relative to the wall it replaces; see [09](09-isogrid-fdm-recheck.md).* |
| Thorough | Every edge has an intentional treatment from the defined edge vocabulary; no default-radius leftovers; no unresolved three-edge corners. |
| As little design as possible | Count distinct radii, chamfer sizes, hole sizes, fastener types, and text sizes. Lower counts are better; each extra value needs a reason. |
| Long-lasting / environmentally friendly | Avoid trend textures on structural faces; minimize support material and print time; keep parts separable by material. |

### A.1 Form language (edge vocabulary, radii families, motifs)

**Rules (agent-applicable):**

1. **Pick one edge vocabulary per product and record it in the style definition.** Typical vocabularies:
   - *Soft:* fillets on all outer edges (friendly, consumer feel).
   - *Crisp/technical:* chamfers on outer edges (precise, instrument or industrial feel). Chamfers read as crisp and technical; fillets read as organic and soft [SRC 3, UNVERIFIED as primary; consistent across several manufacturing blogs].
   - *Hybrid "angular but smooth":* chamfered faces whose plan-view (vertical) corners are rounded, or a chamfer with a small fillet on its upper edge (an Onshape forum user calls this a "chamlet") [SRC 4, UNVERIFIED single forum post]. This hybrid also prints well because the bottom edge stays a chamfer (no support) while vertical corners are rounds (printed in XY, smooth toolpath) [SRC 4, SRC 5].
2. **Use a small radii family, not a radius per edge.** DERIVED recommendation: three sizes for outer edges (large = main body plan-view corners, medium = edges of primary faces, small = edge breaks on secondary details), plus one internal-corner fillet size. Name them as tokens (R_L, R_M, R_S, R_in). Digital design systems make the same argument (a documented set of radius roles beats ad hoc rounding; do not mix unrelated radii in one visual group; nested radii should look concentric) [SRC 6, UNVERIFIED, digital-UI sources applied by analogy].
3. **Nested/concentric radii:** when a feature sits inside a rounded outline at a constant offset (a recessed panel, a lid inset, a bezel), its corner radius should be the outer radius minus the offset, so the gap reads as constant width (DERIVED from the nested-radii rule in [SRC 6]). If the result is below the small-radius token, clamp to R_S.
4. **Chamfers: one angle, few sizes.** Use 45 degrees as the default chamfer angle (it is the self-supporting limit and the standard print chamfer) [SRC 7]. Allow at most two chamfer sizes on outer edges. Manufacturing guides recommend standard radii and common chamfer angles throughout a design for consistency and cost [SRC 3, UNVERIFIED].
5. **Repeating motifs:** a product family should reuse a small number of signature elements (a specific corner treatment, a groove, a vent shape, a badge recess). Industry visual-design-language practice lists signature geometries, surface behaviors, material hierarchies, and color/finish strategies as the repeatable building blocks [SRC 8]; DCA's phrase for the goal is a "family photo, not a series of clones" [SRC 9].
6. **When to break the rule:** break the vocabulary only to signal function: a touch point, a release, a warning, or a mating interface. Example: an outer body that is all chamfer, with one filleted thumb recess, makes the recess read as "touch here" (DERIVED). Don't break it because a fillet failed to build or because a different edge was easier to model.

### A.2 Proportion and visual hierarchy

The person this is for does not design with ratio or proportion systems, so the rules below avoid them. Proportion systems are listed at the end only as optional diagnostics.

**Rules:**

1. **Primary, secondary, tertiary forms.** Primary = the overall mass (the box, the puck, the bracket body). Secondary = large features that change the silhouette (a handle, a stand, a raised display deck, a large chamfer band). Tertiary = details (screws, vents, text, buttons, seams). Automotive design education uses an explicit form hierarchy and sketches each level separately [SRC 10, abstract only]. DERIVED check: the silhouette should read correctly with all tertiary features suppressed. If a tertiary feature changes the silhouette, either promote it to a deliberate secondary form or reduce it.
2. **Shared datums and alignment.** Feature edges and centerlines should land on a few shared lines: centerlines of the part, the inner wall line, the PCB centerline, a common baseline for ports. DERIVED check: list the X and Z positions of all features on a face; the number of unique values should be small, and near-misses (values within about 0.5 mm of each other that are not equal) are errors to snap together.
3. **Consistent margins.** Holes, vents, labels, and buttons keep the same offset from the face edge or from the nearest secondary form, set by a margin token (DERIVED). Uneven margins are the most visible "engineered, not designed" tell.
4. **Grouping.** Related features (status LED plus its label; ports on one end) cluster with equal spacing; unrelated features keep more distance than the in-group spacing (DERIVED, standard Gestalt proximity).
5. **Symmetry.** Default to mirror symmetry about the primary axis for the primary form; place asymmetric features (ports, switches) as a single deliberate group on one side, not scattered (DERIVED).
6. **Visual weight and stance.** A chamfer or undercut at the base creates a shadow line that makes the part appear to float and hides elephant's foot; a heavier lower section or a wider footprint reads as stable (DERIVED; the base chamfer itself is a common print recommendation [SRC 11, SRC 12]).
7. **Avoid CAD-dictated form.** A design education study found students drifted toward forms that were easier to model in CAD, which flattened their designs; the fix was resolving the intended form before entering CAD [SRC 13]. For an AI agent: decide the form vocabulary and hierarchy first, then model; never pick a shape only because the kernel builds it easily.

**Optional proportion aids (diagnostic only, not a design method):** golden ratio, rule of thirds, and simple integer ratios are sometimes used to sanity-check overall block proportions or the position of a horizontal break line. Use them only to flag something that looks off, never as a generator. (General knowledge; not researched further by design.)

### A.3 Edges and transitions

1. **Outside vs inside edges.**
   - Outside edges carry the edge vocabulary (A.1).
   - Inside corners get fillets for strength and toolpath smoothness; fillets at the base of walls strengthen them [SRC 7].
   - Bottom (bed-side) outside edges: chamfer, never fillet. A bottom fillet becomes an overhang that needs support or sags; a bottom chamfer prints cleanly and hides elephant's foot [SRC 11, SRC 12, SRC 14].
   - Edges in the XY plane (plan-view corners) can be any radius; rounding them lets the printer avoid slowing at sharp corners [SRC 7].
2. **Curvature continuity (G0/G1/G2) and highlights.** G0 = edges meet; G1 = tangent; G2 = curvature continuous. Tangency alone is not enough for clean highlights: where a flat face meets a constant radius, curvature jumps from zero, which shows as an abrupt highlight break [SRC 15, SRC 16]. Apple's hardware is a commonly cited example of curvature-continuous corners shaped to control the highlight [SRC 16]. Check with zebra stripes or curvature combs [SRC 15, SRC 16].
   - **Printed-part reality (DERIVED):** on FDM parts, layer lines and matte filament scatter light enough that G1 vs G2 is rarely visible on small radii. G2 is worth it on large, smooth, glossy or painted faces (for example a 10 mm+ blend between two broad faces), and on parts that will be sanded and painted. For small edge radii (under about 3 mm) on as-printed parts, plain G1 fillets are fine. Do not spend modeling complexity on G2 that the finish cannot show.
   - Not every designer wants G2 everywhere; some deliberately accept G1 for the way it "lights up" an edge [SRC 15].
3. **Corner blends where three edges meet.** Three fillets meeting at a vertex is where default fillet features look worst [SRC 17]. Options: (a) fillet all three edges in one feature with equal radii (produces a clean spherical corner); (b) use a setback/vertex blend (setback larger than the edge radius [SRC 17]); (c) fillet the two vertical edges first, then the top edge (a sequence that can avoid a vertex blend [SRC 17]). DERIVED rule: on outer corners use equal radii for all three edges, or make the vertical (plan-view) radius at least 1.5 to 2 times the top-edge radius so the corner reads as a soft rounded rectangle with a smaller edge roll. Never leave a three-way corner where one radius is only slightly different from the others (it looks like an error).
4. **Chamfered faces with rounded plan-view corners (angular but smooth).** Build order (DERIVED): sketch the plan outline with the R_L corner radius, extrude, then apply a constant chamfer around the top edge loop. The chamfer will then sweep around the rounded corners as a conical band, which is the characteristic look. Check that the chamfer size is smaller than R_L, or the chamfer will self-intersect at the corners.
5. **Break lines, shadow gaps, and reveals.** Two printed or molded halves are never perfectly flat, so a plain butt joint shows a varying gap [SRC 18, SRC 19]. Use a shadow line (one half's lip laps over the other's rim) so the seam reads as a deliberate dark line and the halves self-locate [SRC 18, SRC 19]. One published printed-enclosure recipe for 1.6 mm walls: overlap band from 0.2 mm to 1.8 mm offset inside the wall, lip height 1.6 mm, a 1.8 mm chamfer under the base for printability, and a 0.4 mm chamfer on the outside edges of both halves so misalignment does not show as a step [SRC 18]. Production practice also uses an intentional reveal gap to hide warp on large plastic parts; a zero-reveal line-to-line fit needs alignment features and early molder review [SRC 20, UNVERIFIED]. Dissent worth noting: some users prefer a flat lid sunk in a shallow recess, which self-centers with no dirt-catching groove [SRC 19].
6. **Parting line (split) placement.** Place the split on an existing edge or change of direction, never mid-face [SRC 20, UNVERIFIED forum advice]. For prints (DERIVED): choose the split plane so each half prints with its primary cosmetic face down on the textured plate or up as a clean top surface, and so neither half needs support. Put the shadow line at the split.

### A.4 Details

1. **Fasteners.**
   - Use one fastener type and size per product where possible (DERIVED; mirrors the "fewer distinct values" rule; the MIT CAD standard similarly restricts fastener choices [SRC 21]).
   - Visible fasteners: place them on a shared grid or symmetric pattern, equal margin from edges, all heads the same type and finish, counterbored or countersunk so heads sit flush or at a consistent recess depth (DERIVED).
   - Hidden fasteners: under feet, labels, or on the bottom face (DERIVED).
   - Countersinks in FDM: model the countersink on top-facing or vertical faces; a countersink on the bed face is an overhang cone that prints poorly unless the angle is at most 45 degrees from vertical (DERIVED).
   - Printed screw-head pockets facing the bed need bridging: a one-layer sacrificial plug or two thin bridges across the hole are common tricks [SRC 22].
2. **Logo and text.**
   - FDM text with 0.4 mm nozzle: stroke width at least 0.8 to 1.0 mm, cap height at least 4 to 6 mm for reliable legibility (about 2.4 to 2.5 mm is the practical floor with tuning), bold sans-serif fonts, embossed (raised) text prints more reliably than engraved; depth about 3 layers raised, 4 layers engraved (about 0.6 to 0.8 mm at 0.2 mm layers) [SRC 23, UNVERIFIED; consistent across several community sources]. CAD tools may size text by bounding box, so a nominal 4 mm can produce about 2.9 mm actual cap height; size by cap height [SRC 23, UNVERIFIED].
   - Placement (DERIVED): logos on a secondary face or in a dedicated recess, aligned to a shared datum (centerline or a margin line), never floating. Use a minimum clear zone around the logo equal to the logo height (a common brand-guide rule; one hardware brand guide states it as a hard minimum [SRC 24]).
   - Cleanest text on prints: on the top face (horizontal) or as first-layer inlay on the bed face (see A.5). Text on vertical faces works but shows layer stepping on curved letterforms.
3. **Icons:** same stroke weight as the text, same depth, from one icon set (DERIVED).
4. **Vents and perforation patterns:** use one hole shape and one pitch, in a rectangular or circular field aligned to the face datums, with the field margin equal to the margin token (DERIVED). For round holes the 60-degree staggered layout packs densest; example open areas: 3.2 mm holes at 5.0 mm pitch give about 37 percent open area [SRC 25, UNVERIFIED catalog snippet]. On vertical walls, prefer slots or teardrop/diamond holes so the top of each hole is self-supporting (see C.4).
5. **Grip textures:** model knurls or ribs on vertical faces (they print as clean layer-defined grooves) or use slicer fuzzy skin painted onto grip zones (PrusaSlicer defaults: 0.3 mm thickness, 0.8 mm point distance) [SRC 26, UNVERIFIED from Prusa help summary]. Confine texture to a clearly bounded zone with a crisp border (DERIVED).
6. **Feet:** recessed pockets sized for commercial bumpers (DERIVED); a non-slip base and non-slip feet are standard design elements in an open assistive-tech design guide [SRC 18 nav]. Feet also hide bottom fasteners.
7. **Cable exits:** exit on the rear face or the bottom, through a strain relief feature, aligned with the port group (DERIVED; strain relief is a documented design element in [SRC 18 nav]).
8. **Light pipes:** align with the LED's center (shared datum with the PCB), give the outer face the same edge break as other small details, and keep the pipe face flush or uniformly recessed (DERIVED; dimensions not found, page 404).

### A.5 CMF for printed parts

CMF means color, material, finish; any color looks different on a different material, and any material looks different with a different finish, so they are specified together [SRC 27]. Injection-molding finish standards (SPI A to D: gloss to matte to blasted) and Pantone/RAL color references are how production CMF is specified [SRC 27].

**Printed-part CMF levers:**

1. **Layer lines are the finish; orientation places them.** Bed face = plate texture; top faces = top-surface pattern (or ironing); vertical walls = layer lines; shallow slopes (under about 20 degrees from horizontal) = visible stair-step contour bands (DERIVED). Orient so the primary cosmetic face is either the bed face or a vertical wall, and avoid gentle domes on cosmetic faces.
2. **Align details to layers (DERIVED).** Make horizontal steps, grooves, chamfer starts, and color-change heights land on multiples of the layer height so edges are crisp, not half-layers.
3. **Seam placement.** OrcaSlicer seam modes: nearest, aligned, aligned back, back, random; aligned/back work best with painted seams; nearest hides seams on sharp corners; concave corners hide seams well [SRC 28]. Seam painting (enforcer on a rear edge or inside corner, blocker on show faces) and scarf seams further reduce visibility [SRC 28, UNVERIFIED forum guide]. DERIVED design rule: give every cosmetic part a designated seam location, ideally an inside vertical corner or a deliberate vertical groove on the rear, and record it in the part metadata.
4. **Textured build plate as the cosmetic face.** A textured PEI plate imprints a uniform textured finish on the bottom face; smooth PEI gives a flat, glossy underside [SRC 29, vendor]. Design the largest show face to sit on the plate when possible; first-layer squish (Z offset) affects how that face looks [SRC 29].
5. **Fuzzy skin and modeled textures.** Fuzzy skin can be limited to outside walls or painted regions; larger thickness = coarser, smaller point distance = finer, both add print time [SRC 26, UNVERIFIED]. Modeled textures (knurls, ribs, height maps) are deterministic and survive slicer changes; prefer them for brand-critical surfaces (DERIVED). Sanding a textured area makes it smooth and mismatched [SRC 11 comments].
6. **Multi-color by filament change at a layer.** Color bands should coincide with a geometric break (a step, groove, or chamfer start), not a flat mid-face line (DERIVED). For inlaid text use 2 to 3 layers depth; put the change a few layers below the text start for embedded text [SRC 30, UNVERIFIED community sources].
7. **Inlaid text on the first layer.** Works well for logos on the bed face, but slicers may reorder the first layer or prompt extra filament changes; a workaround is printing only the mirrored first-layer text, then the body over it [SRC 30, UNVERIFIED].
8. **Matte vs silk.** Matte PLA (mineral filled) scatters light and hides layer lines; silk's sheen highlights layer lines; both formulations reduce strength and layer adhesion versus plain PLA [SRC 31, UNVERIFIED vendor/blog]. Default for product-look parts: matte (DERIVED).
9. **Post-processing and dimensions.** Sanding removes material; primer/filler and paint add material; sanding silk removes its sheen layer [SRC 31]. No source gave numbers for dimensional change. DERIVED rule: mask or leave clearance on mating faces, holes, and snap features; budget roughly 0.1 to 0.2 mm per surface for sand-prime-paint (UNVERIFIED estimate, test before relying on it).

### A.6 What separates a "prototype-looking" print from a "product-looking" print

Observations gathered across sources (sourced where marked; the rest DERIVED from them):

| Prototype look | Product look |
|---|---|
| Sharp outer edges, or one default fillet on every edge | One edge vocabulary from a small radii/chamfer family [SRC 3, SRC 32] |
| Bottom edge flares (elephant's foot), brim marks on show faces | Bottom chamfer; show faces on top/sides or on a textured plate [SRC 11, SRC 12, SRC 14] |
| Butt-jointed halves with a wandering gap | Shadow line or deliberate reveal at the split [SRC 18, SRC 19] |
| Random Z-seam on the front | Seam painted to a rear inside corner or groove [SRC 28] |
| Support scars on cosmetic faces | Geometry designed to be support-free (chamfers, teardrops, bridges) [SRC 12] |
| Glossy filament exaggerating layer lines | Matte filament, fuzzy skin, or modeled texture [SRC 11, SRC 31] |
| Features at arbitrary positions, uneven margins | Features on shared datums with equal margins (DERIVED) |
| Mixed screws, protruding heads | One fastener type, flush or uniformly recessed, or hidden (DERIVED) |
| Thin wispy text, serif fonts, engraved on vertical faces | Bold sans-serif, embossed or first-layer inlay, sized by cap height [SRC 23] |
| Decorative patterns pasted everywhere | Patterns confined to bounded zones with a crisp border, used where they do a job (DERIVED) |
| Visible infill through thin top skins, pillowing | Enough top layers; flat show faces (DERIVED) |

### A.7 Common aesthetic mistakes in engineer-made and AI-made CAD

DERIVED from the sources above unless marked. Each is phrased as a detectable condition.

1. **Fillet-everything at one default radius**, including bottom edges (support needed, looks blobby). Fillets everywhere are "too much of something" [SRC 32].
2. **Radius soup:** many slightly different radii (2.0, 2.5, 3.0 mm) on adjacent edges with no hierarchy.
3. **Mixed chamfer angles** (30, 45, 60) and mixed chamfer sizes on one part.
4. **Unresolved three-edge corners** where default fillets pinch or bulge [SRC 17].
5. **Near-miss alignment:** features 0.2 to 0.5 mm off a shared line; uneven edge margins.
6. **Butt-joined enclosure halves** with no shadow line or reveal [SRC 18, SRC 19].
7. **Ignoring print orientation for appearance:** show face on a support interface or on a shallow slope with stair-stepping.
8. **No seam plan.**
9. **Unreadable text:** strokes under 0.8 mm, small serif text, engraved text on vertical walls [SRC 23].
10. **Decoration as fake structure:** isogrid or Voronoi on faces that carry no load, or patterns that cut through a wall and weaken it (see B.6, C.3). *Correction 2026-11-12: also a pattern claimed stiffer than the closed wall of the same depth; see [09](09-isogrid-fdm-recheck.md).*
11. **CAD-dictated form:** shapes chosen because they are easy to build in the kernel rather than designed [SRC 13].
12. **Tertiary features fighting the silhouette** (bosses, tabs, or screw towers poking through the primary form).
13. **Over-detailing** that violates "as little design as possible" [SRC 1].
14. **Visible random fasteners** (mixed heads, uneven spacing).
15. **Inconsistent wall thickness** with sink-like visual waviness on large faces (also blocks a later move to molding) [SRC 22].

---

## B. Isogrid and related lightweight stiffening patterns

### B.1 Primary source: NASA CR-124075, Isogrid Design Handbook (McDonnell Douglas, Feb 1973, Rev A)

Verified by reading the scanned PDF from NTRS [SRC 33]. Key facts (paraphrased, with handbook page numbers):

- **Definition.** A lattice of intersecting ribs forming contiguous equilateral (60 degree) triangles, either on a skin (skinned) or as an open lattice (p. 1.0.005, 3.0.001).
- **Why isotropic.** If each rib is assumed to carry uniaxial stress, the smeared-out elastic constants of the triangular grid are identical to those of an isotropic material in plane stress, with Poisson's ratio 1/3; it is the simplest bar arrangement that does this, hence the name (p. 2.0.001, 3.0.001). Table 1-1 summarizes: no directions of instability or weakness, efficient in compression and bending.
- **Stated advantages** (Table 1-1, Section 3): easily analyzed; optimizable over a wide load range; nodes form a standard attachment pattern (Skylab used them as a "pegboard"); easily reinforced locally for concentrated loads and cutouts; redundant load paths (fail-safe); less structural depth than rectangular stiffening for the same compressive capability; open isogrid is torsionally stiff because the rib lattice acts as a second surface of a torque box (p. 3.0.002 to 3.0.007).
- **Parameters** (Section 2.6, p. 2.0.019): triangle side a, triangle height h = (sqrt 3 / 2) a, rib width b, rib depth d (measured from skin), skin thickness t.
  - alpha = b d / (t h) (rib-to-skin material ratio)
  - delta = d / t (rib depth to skin thickness)
  - beta = sqrt[ 3 alpha (1 + delta)^2 + (1 + alpha)(1 + alpha delta^2) ]
  - Grid modulus E-bar = (b / h) E; Poisson's ratio 1/3 (p. 2.0.020).
  - Extensional stiffness K = E t (1 + alpha) / (1 - nu^2); bending stiffness D = [E t^3 / 12(1 - nu^2)] * beta^2 / (1 + alpha). The factors (1 + alpha) and beta^2/(1 + alpha) are the stiffness gains over the bare skin (p. 2.0.011).
  - Equivalent monocoque thickness t* = t beta / (1 + alpha); equivalent modulus E* = E (1 + alpha)^2 / beta (p. 2.0.017). Valid for stress resultants and deflections, not for local stresses.
  - Equivalent weight thickness t-bar = t (1 + 3 alpha) (p. 2.0.018).
- **Published "typical optimum" ratios** (p. 2.0.018): by experience, many optimum constructions have alpha about 1/3 and beta about 16. That means equal rib and skin material; extensional stiffness rises by a factor of 4/3 and bending stiffness by a factor of 192 compared with the skin alone, for the weight of twice the skin (p. 2.0.018 to 2.0.019).
  - DERIVED from those two numbers: delta about 12.6 (rib depth about 12.6 times skin thickness) and h/b about 38 (triangle height about 38 rib widths). These are aerospace, thin-skin, compression-buckling optima, not FDM values.
- **Worked optimum example** (cylinder in axial compression, p. 4.13.010): optimum h = 4.59 in, b = 0.0888 in, d = 1.594 in, t = 0.1092 in, alpha = 0.282, delta = 14.6. DERIVED ratios: h/b about 52, d/b about 18. The off-optimum rows show that larger cells (h = 10, 15 in) force thicker skins and wider ribs and cost weight.
- **Rib crippling check** (p. 4.13.011): critical load for rib crippling scales with (b/d)^2, so deep thin ribs cripple; this is the handbook's built-in limit on rib slenderness.
- **Skylab open lattice** (Figure 3-4, p. 3.0.005): open lattice 0.400 in thick, ribs 0.070 in wide, node holes 0.438 in diameter, a 0.22 in radius callout at the node (UNVERIFIED reading of a scanned figure), 4.200 in pitch dimension; weight equal to a 0.025 in aluminum sheet; carried 750 lb at a node in test against a 250 lb requirement (p. 3.0.002). DERIVED ratios: depth/width about 5.7; pitch/width about 60.

### B.2 Why the node circle exists, and what that means for FDM

- **Machining origin.** The handbook states that extra material is left at nodes because milling cutters cannot reach the center of the intersection without cutting into the ribs; the weight penalty of that leftover material is reduced by drilling a hole in each node; those holes are then handy attachment points (p. 5.0.001). Six triangular pockets, with corners rounded by the cutter radius, define each node; small pockets with large nodes carry severe weight penalties (p. 7.0.002). The cutter radius should be smaller than the pocket corner radius (Figure 7.2-1).
- **Node flexibility and stress.** The smeared analysis ignores node flexibility. In a photoelastic test (0.075 in skin, 0.045 in ribs with flanges, 5 in node spacing, 0.75 in node hole, 0.375 in cutter radius at the node), skin stresses were about 30 percent above monocoque prediction, rib stresses about 20 percent below, and the skin stress concentration at the node was about 2.1 under uniaxial load (p. 5.0.002 to 5.0.003). Lexan isogrid cylinders with node holes 60 percent of the distance across the node still buckled in good agreement with theory, so stiffness is not very sensitive to node holes (p. 5.0.003).

**Evaluation of the convention "corner radius equal to rib wall thickness, and no circle at the nodes" (DERIVED, built on the handbook facts above):**
- **No node circle: supported.** The node boss is a cutter artifact and the hole is a weight fix for that artifact. A printer has no cutter, so there is no leftover node mass to drill out. Omit node bosses and holes unless a node is used as a fastener point. Omitting them also removes many small perimeter loops (print time, seams, visual noise). Keep a node boss plus hole only where something mounts.
- **Corner radius = rib width b: reasonable, with limits.** A pocket corner radius at least as large as the extrusion width lets the slicer run a smooth perimeter around the pocket instead of a sharp 60 degree turn that tends to leave gap fill or blobs; r = b (with b at least two extrusion widths) satisfies that automatically. It also reduces the stress concentration at the rib junction. Limits: the radius must stay well below the pocket's inscribed radius, and very small cells should be dropped instead of filleted. Pocket inscribed radius = h/3 - b/2. Suggested cap: r no more than about 0.4 times the pocket inradius. If the pocket inradius is under about 2b, delete that pocket (leave solid), which matches how the Onshape community scripts drop sub-size pockets and unfilletable pockets [SRC 34] and how an NX adaptive-isogrid tool skips pockets where the fillet cannot fit [SRC 35, UNVERIFIED].
- **Fillet where ribs meet the skin:** a small base fillet (about 0.5 b) at the rib root helps strength and avoids sharp internal corners (fillets at the base of walls strengthen them [SRC 7]); it also hides small rib/skin bonding defects. Community OpenSCAD users note these root fillets are desirable but hard to generate in their tools [SRC 36].

### B.3 Variants

- **Orthogrid (waffle):** ribs at 0 and 90 degrees (square cells). Simpler to make but not isotropic; NASA notes such 4-bar patterns have little in-plane torsional (shear) resistance unless the skin prevents collapse (p. 1.0.001) [SRC 33]. Use when loads are clearly biaxial and aligned with the ribs, or when square cells match the part's rectilinear form language.
- **Anisogrid:** helical rib families at plus/minus an angle plus hoop ribs, filament-wound composite shells; developed by Vasiliev's group at CRISM; dozens of launches used them [SRC 37, UNVERIFIED snippet]. Relevant to printed cylinders only as an idea (tuning rib angle to the load).
- **Flanged isogrid** (T-section ribs) adds bending stiffness per weight; the handbook covers it separately (p. 1.0.003). For FDM a flange on the rib top is an overhang; skip it (DERIVED).

### B.4 Honest limits: when isogrid stiffens and when it is decoration

DERIVED from the handbook equations, worked for a printed case:

- Example small-enclosure wall: t = 1.2 mm skin, b = 0.9 mm ribs, d = 4 mm rib depth, h = 15 mm triangle height. Then alpha = 0.2, delta = 3.33, beta^2 about 15.1, bending stiffness about 12.6 times the bare skin; equivalent weight thickness about 1.92 mm. A solid 1.92 mm wall has only about 4.1 times the skin's bending stiffness, so the isogrid is about 3 times stiffer than a solid wall of equal weight. But the isogrid envelope is 5.2 mm deep, and a solid 5.2 mm wall would be roughly 80 times the skin stiffness, about 6.5 times stiffer than the isogrid.
  *Correction 2026-11-12: the arithmetic holds for isotropic material. A printed 5.2 mm wall with normal skins and 15% infill is about 3.5 to 4x stiffer than this isogrid at about the same mass ([09](09-isogrid-fdm-recheck.md), section 3).*
- **Rule:** isogrid beats a solid wall of equal weight, never a solid wall of equal envelope. Use it only when weight, material, or print time matters more than envelope depth.
  *Correction 2026-11-12: superseded by [09](09-isogrid-fdm-recheck.md), section 11 (i). The baseline decides the answer: a one-sided isogrid is about 4 to 25x stiffer than the thin wall it sits on and stiffer than any wall of the same mass made thinner; a normally printed closed wall of the same depth (two skins over sparse infill) is about 2.5 to 4x stiffer at about the same mass, except at short spans and under point loads. Call it structural when it replaces a thinner wall or carries local loads, styling when a closed wall of the same depth was the alternative. "Print time" is not a reason: isogrids usually print slower.*
- **FDM-specific catch:** a thick FDM wall with normal (15 to 25 percent) infill is already a stiffened sandwich (perimeters plus top/bottom skins plus infill), so an isogrid often gains little over simply making the wall thicker with sparse infill. Isogrid pays off mainly when (a) the wall is printed vertically as perimeters only, where infill cannot help; (b) the pattern is open-backed and visible by design; or (c) the ribs double as a mounting grid (Skylab-style nodes).
  *Correction 2026-11-12: a thick printed wall is a two-skin sandwich and is stiffer in bending than a one-sided isogrid of the same depth at about the same mass; printing perimeters only is not what limits it. Isogrid pays off when depth is available but a second skin is not wanted (an open or visible back, access, mounting at nodes), when it replaces a thinner wall, and for local or short-span loads where a sparse core is shear-soft. See [09](09-isogrid-fdm-recheck.md), sections 4 and 11.*
- **When it is decoration:** parts loaded mainly in local bending at a hole or tab, parts where the critical failure is a layer-line split (z-direction tension), and pockets so shallow (d/t under about 1.5) that the stiffness gain is negligible. In those cases, label the pattern as cosmetic in the model metadata (Rams: honest).
  *Correction 2026-11-12: shallow ribs give a modest gain, not a negligible one (d = 1.5 t is about 3.6x the skin), so they are worth it only if depth is constrained. The style guide now records each pattern's role against the wall it replaces instead of a cosmetic default; see [09](09-isogrid-fdm-recheck.md), section 3.*
- **When it is a weakness:** open (skinless) isogrid cut through a thin printed wall turns a continuous shell into ribs bonded only at layer lines; triangle tips create stress raisers; and many small perimeters make more seams. Also, the smeared theory assumes many cells across the panel; with only 2 or 3 cells across, local behavior dominates and the formulas over-predict.
- **Scientific FDM evidence:** printed isogrid panel studies identify rib thickness (depth), rib width, and cell height as the governing variables; buckling load rose with rib depth and fell as cell height grew; rib depth had the largest effect on strength [SRC 38, UNVERIFIED snippets of Springer and Univ. Politecnica delle Marche papers, which used 3 to 5 mm rib widths, far wider than hobby-scale ribs]. A Duke study compared printed isogrid and orthogrid panels at equal mass in bending and vibration [SRC 39, UNVERIFIED abstract].

### B.5 Adapting isogrid to FDM prints

- **Open-backed vs skinned.** Skinned (ribs on one side of a continuous skin) is the default for enclosures: the skin is the cosmetic face and the seal. Open-backed lattices suit brackets loaded in-plane (truss action) and visible decorative panels (DERIVED from handbook open-lattice discussion [SRC 33]).
- **Rib thickness as multiples of extrusion width.** Slicers do not produce walls of exactly n times the line width because adjacent perimeters overlap; PrusaSlicer shows a recommended wall thickness per perimeter count (example: about 0.86 mm for two perimeters at 0.45 mm width), and Arachne adapts widths to fit [SRC 40]. DERIVED: with a 0.4 mm nozzle, use b = 0.85 to 0.9 mm (2 perimeters), 1.25 to 1.3 mm (3), or 1.65 to 1.7 mm (4); avoid b between those values on Classic perimeter generators. A vase-mode isogrid wastebasket on Thingiverse ships variants with rib thickness matched to common nozzle sizes [SRC 41, UNVERIFIED].
- **Corner fillets and nodes:** see B.2 (r = b, no node circle, skip undersized pockets).
- **Printing orientation.**
  - Flat panels: skin on the bed (textured plate gives the show face), ribs grow upward; no supports needed (DERIVED).
  - Vertical walls with internal isogrid: orient the lattice so one rib family is horizontal. Then every pocket is either apex-up (sloped sides at 60 degrees from horizontal, self-supporting) or apex-down with a horizontal ceiling that prints as a short bridge equal to one pocket side. If instead one rib family is vertical, the pocket ceilings slope 30 degrees from horizontal, which is a 60 degree overhang from vertical (beyond the usual 45 degree rule) and tends to droop (DERIVED geometry).
  - Pocket floors on a vertical wall do not matter (the skin is the floor).
- **Print time (DERIVED, UNVERIFIED by test):** isogrids add many short perimeters, travels, and retractions; for small parts they can take longer than a solid wall with sparse infill. Estimate in the slicer before committing. *Correction 2026-11-12: [09](09-isogrid-fdm-recheck.md) estimates about 1.4 to 1.5x longer for two example panels (derived, low confidence).*
- **Parametric generators:**
  - Onshape FeatureScript: Julia's ISOgrid (fast, simple), Evan Reese's Grid Extrude (flexible, triangle option without node holes), TLamp's CheeseIt! (isogrid, hex, circle lightening), and a newer Engineering Grid script (iso or ortho, border thickness, small-pocket cutoff, pocket-floor fillets, remove-bad-fillets, edge alignment) [SRC 34, SRC 42].
  - OpenSCAD: no packaged isogrid library found; BOSL2 sweeps and cylindrical extrusion can build ribs on cylinders and other analytic surfaces; unwrap-and-remap for complex shapes [SRC 36].
  - CadQuery/build123d: no ready isogrid example found; build with a triangular point grid, offset triangles inward by b/2, 2D-fillet corners, extrude-cut to depth d, using interior-edge selectors for root fillets [SRC 43, UNVERIFIED approach summary].
  - CATIA has a visual-scripting isogrid operator for revolved surfaces [SRC 41, UNVERIFIED].

### B.6 Recommended FDM isogrid parameter set (0.4 mm nozzle) - DERIVED

No source gave cell sizes for small printed enclosures or brackets. Candidates below are derived from the handbook equations, the slicer facts above, and general FDM limits. Test before relying on them.

| Parameter | Small enclosure wall (about 60 to 150 mm panels) | Small bracket web (open or skinned) |
|---|---|---|
| Skin thickness t | 1.2 mm (3 perimeters if vertical; 4 to 6 layers if horizontal) | 0 (open) or 1.2 to 1.6 mm |
| Rib width b | 0.85 to 0.9 mm (2 perimeters); 1.25 mm for parts that get handled | 1.25 to 1.7 mm (3 to 4 perimeters) |
| Rib depth d | 3 to 5 mm; keep d/b at or below about 6 (Skylab 5.7) to avoid rib crippling and wobbly printing | equal to bracket thickness (open) or 4 to 8 mm |
| Triangle height h | 10 to 20 mm (about 12 to 22 rib widths); at least 3 cells across the shortest panel span | 12 to 25 mm, laid out node-to-load-point |
| alpha = b d / (t h) | about 0.15 to 0.35 | n/a for open |
| Pocket corner radius | r = b, capped at 0.4 times the pocket inradius (h/3 - b/2) | same |
| Rib root fillet | about 0.5 b | about 0.5 b |
| Node circles | none, except bosses at fastener nodes | bosses at bolt/load nodes only |
| Border | solid band of at least 2 b (or the margin token) around the field, merged into edges and bosses | solid band around holes and edges at least 2 b |
| Small-pocket cutoff | drop pockets with inradius under 2 b, or under about half the nominal pocket | same |
| Orientation | one rib family horizontal on vertical walls; skin on bed for flat panels | ribs parallel to the main load path where possible |

---

## C. Voronoi patterns and alternatives

### C.1 How Voronoi patterns are generated

- **Seeds and cells:** scatter seed points in the region; each cell is the set of points closer to its seed than to any other. Uniform random seeds give irregular cells of very uneven size (general knowledge).
- **Lloyd relaxation:** iteratively move each seed to its cell's centroid and rebuild; cells become more even in size and shape; published toolkits use 0 to 40 iterations to tune regularity [SRC 44, UNVERIFIED review snippet]. DERIVED: 3 to 10 iterations give "organic but even"; many iterations converge toward hexagon-like cells.
- **Struts with constant width and rounded cells:** offset each cell polygon inward by half the strut width, then round its corners (offset negative, then positive, or Minkowski with a circle) [SRC 45]. This gives constant-width walls, unlike some generators whose lines are not constant width [SRC 45].
- **Tools:** Fusion "Voronoi Sketch Generator" add-in (free, sketch output; lines not constant width, so offset afterward) and a paid 3D Voronoi Studio; OpenSCAD "Fast voronoi method" module with BOSL2 versions supporting rounded-edge extrusions (GPL) [SRC 45]; nTopology Voronoi lattice workflows for FDM, DLP, and powder bed [SRC 46, UNVERIFIED, numbers not retrieved].

### C.2 FDM minimums - mostly DERIVED (no FDM source gave numbers)

- Minimum strut width: 2 extrusion widths, about 0.85 to 0.9 mm; 1.2 mm or more for parts that get handled (DERIVED; one resin study printed Voronoi struts at 0.7 to 1.5 mm [SRC 46, UNVERIFIED]).
- Minimum cell size (opening inscribed diameter): at least about 3 mm for through-cut panels (small hex holes shrink badly; a 2 mm design printed as about 1 mm with a 0.4 mm nozzle [SRC 47, UNVERIFIED forum]); aim for mean cell size about 5 to 10 times strut width (DERIVED).
- Cell corner radius: at least the extrusion width, ideally about equal to strut width (DERIVED, same toolpath logic as B.2).
- Border: solid frame at least 2 strut widths, matching the margin token.
- Recessed (blind) Voronoi on a skin: depth 2 to 4 layers is enough to read visually; deeper gives little extra (DERIVED).

### C.3 Structural caveats

- Voronoi lattices are irregular, so stiffness and strength vary locally and with seed placement; the weakest strut governs (DERIVED; SLS Voronoi stiffening was tested in compression alongside periodic and topology-optimized patterns at UT Austin [SRC 39, UNVERIFIED]).
- For the same material, a regular isogrid is easier to analyze and more predictable; use Voronoi when the look matters and loads are low, or use graded seed density (denser near loads and holes) to make it somewhat structural (DERIVED).
- Through-cut Voronoi in thin printed walls creates many layer-line-bonded struts, weak in Z tension (DERIVED).

### C.4 Where Voronoi prints poorly

- **Vertical faces:** random edge angles create ceilings at shallow angles (roughly 10 to 40 degrees from horizontal) that are neither good bridges nor good overhangs, so they sag or curl (DERIVED; general overhang guidance: slow down, more cooling, chamfer or round sharp overhang edges [SRC 48]). Mitigations (DERIVED): stretch seeds vertically 1.5 to 2 times so cell edges skew steeper; round the cell tops so they act like arches; keep cells small on vertical faces; or apply the pattern only as a shallow recessed texture rather than a through-cut.
- **Horizontal faces printed flat:** fine; the pattern is just a 2D toolpath.
- **Hex holes on vertical walls:** a flat-top hex has a horizontal ceiling (a bridge); a pointy-top hex has two sloped ceiling edges at 30 degrees from horizontal (DERIVED; one source frames the general fix as teardrop or diamond tops [SRC 49]). Pick the orientation whose ceiling is either a short bridge or at least 45 degrees from horizontal, and test.

### C.5 Alternatives and how to choose

| Pattern | Use when | Notes |
|---|---|---|
| Isogrid | Structural stiffening of flat or cylindrical panels; mounting grid | Predictable, analyzable [SRC 33]; see B |
| Orthogrid | Loads aligned with rectilinear form; boxy form language | Not isotropic, weak in in-plane shear without skin [SRC 33] |
| Hex / honeycomb | Vents, grilles, decorative relief, sandwich cores | Regular, reads technical; mind hex orientation on vertical walls |
| Voronoi | Organic look, graded density, low loads | Hardest to print on vertical faces; least predictable |
| Gyroid / TPMS as a surface | Sculptural panels, fluid or air paths, energy absorbers | TPMS sheets are largely self-supporting, but large cells lose that property [SRC 50, UNVERIFIED]; model solid and void volumes explicitly rather than relying on slicer infill [SRC 50] |
| Round-hole perforation | Speaker grilles, vents, lightening holes | 60 degree stagger packs densest; 3.2 mm holes at 5.0 mm pitch give about 37 percent open area [SRC 25, UNVERIFIED]; use teardrop or slot holes on vertical walls |

DERIVED choice rule: (1) if the job is stiffness per weight, isogrid; (2) if it is airflow or sound, perforation or hex with the open-area target; (3) if it is brand look, pick the pattern that matches the edge vocabulary (chamfer/angular products: hex or isogrid; filleted/soft products: rounded Voronoi or round-hole perforation); (4) always confine the pattern to a bounded field with a solid border and the margin token. *Correction 2026-11-12 to (1): to stiffen a thin wall or lid with one open face, or to carry local loads, isogrid (ribs aligned with the load when bending is one-way); for maximum bending stiffness at a fixed depth, a closed two-skin wall. See [09](09-isogrid-fdm-recheck.md), section 11 (ii).*

---

## D. How design systems for physical products are documented

### D.1 Public examples found

- **Visual design language (VDL) playbooks (consultancy view).** Components: signature geometries, surface behaviors, material hierarchies, color and finish strategies, UI conventions, brand markers. Process: audit the existing portfolio for intentional vs accidental cues, define brand attributes, explore physical concepts (sketch, CAD, render), benchmark against products for manufacturability, then codify in a playbook used by design, engineering, packaging, marketing, and partners [SRC 8]. The article does not name radii or part-line tokens explicitly.
- **Visual brand language (VBL).** Translates brand values into form, detail, material, and color; guides rather than prescribes; deliverable is a flexible guideline set with sketches and product examples; aim is a family that reads as related without cloning [SRC 9].
- **Academic "design DNA" work:** product-family DNA systems (for example for phones), shape-grammar studies of automotive brand language (for example the Buick shape grammar paper), and perceived-family-look studies [SRC 10, SRC 13 refs, SRC 51 UNVERIFIED].
- **Hardware brand guidelines (physical goods).** One published brand guide for physical goods specifies: matte finishes, avoid high gloss on hardware; label materials (polyester or polycarbonate, UL-rated where needed); Pantone matches for brand colors with press proofs; accent color limited to accents and the logo; logo clear space equal to logo height; safe zone inside trim; minimum text 8 pt, 6 pt allowed on hardware labels; specific fonts and weights per use (including a monospace for serial numbers); QR quiet zones; and an explicit note on why physical goods deviate from the screen design system [SRC 24].
- **Color tokens mapped to physical tiers.** One color-system write-up maps a product line into tiers (surface, content/logo, outline/connectors) and assigns color tokens per tier per material (plastic, metal, cloth), with multiple "skins" (colorways) over one underlying design [SRC 52].
- **CMF specification practice.** Production CMF uses Pantone or RAL for color and process-specific finish standards (SPI A1 to D3 for molded plastics; ASME or ISO for metals); finish choice drives draft and protective packaging; textures can hide blemishes, improve grip, and reduce glare [SRC 27]. CMF practitioners also do color matching with spectrophotometers and gloss measurement [SRC 53, UNVERIFIED].
- **CAD modeling conventions (team standards).** MIT Rocket Team's CAD standard: part-number naming scheme with assembly codes, fully constrained and dimensioned sketches, inherit dimensions where possible, one sketch per plane, 2D sketches preferred, model fit tolerances, material and appearance on every part, explicit external threads, manufacturing files named by part number, restricted fastener set, no generic library parts on flight hardware [SRC 21]. Other team standards (UWARG, NER) and vendor best-practice guides repeat: fully defined sketches, one feature per sketch, holes via hole tools, standard naming [SRC 54, UNVERIFIED snippets]. Onshape advises prioritizing constraints over dimensions for fully defined production sketches [SRC 54, UNVERIFIED]. Companies rarely publish internal modeling standards [SRC 54].
- **Open design guide for 3D-printed products (closest public "style guide for printed CAD").** The OpenAT Design Guide (Makers Making Change) documents reusable printed design elements with dimensions: shadow lines, screw posts, threads, snap fits, twist locks, captured buttons, PCB capture, battery covers, non-slip bases, strain relief, plus commercial component interfaces (switches, jacks, LEDs, light pipes, USB) [SRC 18].

### D.2 What a reusable style definition should contain (synthesis, DERIVED from D.1 plus sections A to C)

A machine-readable "style" file the agent loads before modeling, plus reference images. Suggested structure:

1. **Identity and intent:** name, 3 to 5 attribute words (for example "precise, calm, durable"), product family, reference images (front 3/4, side, detail crops), do/don't image pairs.
2. **Edge vocabulary:** outer-edge type (fillet, chamfer, hybrid), rules for bottom edges (chamfer only), plan-view corner treatment, three-edge corner rule, when the vocabulary may be broken (functional signals only).
3. **Radius tokens:** R_L, R_M, R_S (outer), R_in (inner), R_rib (pattern corners), with roles; nested-radius rule (inner = outer minus offset, clamp to R_S).
4. **Chamfer tokens:** angle (default 45 degrees), C_L and C_S sizes, base chamfer size.
5. **Continuity policy:** where G2 is required (large show-face blends), where G1 is acceptable.
6. **Layout tokens:** margin (feature-to-edge), gutter (feature-to-feature within a group), group spacing, datum list (centerlines, baselines), symmetry policy.
7. **Split and seam rules:** split-line placement, shadow-line profile (overlap band, lip height, outer chamfers) or reveal width, Z-seam location policy.
8. **Fastener rules:** allowed types and sizes, head style, flush/recess depth, visible vs hidden policy, pattern grid.
9. **Text and marking:** fonts, minimum cap height and stroke width per process, emboss/engrave depth, inlay depth, logo artwork reference, logo clear space, allowed logo locations, icon set.
10. **Patterns:** allowed patterns (isogrid, hex, perforation, Voronoi), parameter sets (from B.6, C.2), border width, orientation rules on vertical faces, "structural or cosmetic" flag.
11. **Openings:** vent shapes and pitch, open-area target, cable exit style, port group framing, light-pipe face treatment, feet type and location.
12. **CMF:** color list with Pantone/RAL or filament product references, material list (PLA matte, PETG, ASA, TPU) per part role, finish per face (textured plate, top surface, fuzzy skin zones, modeled textures), multi-color layer breaks, post-processing allowed and clearance budget.
13. **Manufacturing tokens that affect appearance:** nozzle, line width, layer height (so details snap to layers), wall perimeter counts, minimum feature size.
14. **Modeling conventions:** feature and parameter naming (for example `R_L`, `C_base`, `margin`), sketch practices (fully constrained, constraints before dimensions, one plane per sketch), feature order (body, splits, edge treatments, details, patterns, text last), part naming and metadata (seam location, print orientation, show faces).
15. **Review checklist:** the A.0 Rams table and the A.7 mistake list as automated or visual checks (count of distinct radii, near-miss alignments, bottom-edge fillets, text below minimum, unbordered patterns).

Example token block (illustrative, DERIVED):

```yaml
style: calm-precise-v1
edges: {outer: hybrid, bottom: chamfer, plan_corner: fillet}
radius: {R_L: 6.0, R_M: 2.0, R_S: 0.6, R_in: 1.0, R_rib: rib_width}
chamfer: {angle_deg: 45, C_L: 1.2, C_S: 0.4, C_base: 0.6}
layout: {margin: 4.0, gutter: 2.0, datums: [centerline_x, centerline_y, pcb_baseline]}
split: {shadow_line: {wall: 1.6, overlap: [0.2, 1.8], lip: 1.6, outer_chamfer: 0.4}}
seam: {policy: rear_inside_corner}
text: {font: bold-sans, cap_min: 4.5, stroke_min: 0.9, emboss: 0.6, engrave: 0.8, inlay: 0.4}
fasteners: {allowed: [M3_socket_cap], visible: recessed_0.5}
patterns:
  isogrid: {b: 0.9, d: 4.0, h: 15.0, r: b, node_circles: false, border: 2b, vertical_wall: rib_family_horizontal}
cmf: {primary: matte_PLA_gray, accent: matte_PLA_orange, show_face: textured_plate}
process: {nozzle: 0.4, line_width: 0.45, layer: 0.2}
```

---

## Sources

All accessed 2026-11-12. "Read" = page or PDF read directly; "snippet" = only search-result text seen (treat claims as UNVERIFIED).

1. https://www.vitsoe.com/us/about/good-design - Rams ten principles, official list (read)
2. https://rams-foundation.org/?p=5140 and https://www.readingdesign.org/ten-principles - principles as criteria, version dates (snippet)
3. https://www.wevolver.com/article/fillet-vs-chamfer-a-comprehensive-technical-guide-for-engineers ; https://firstmold.com/tips/fillets-and-chamfers/ ; https://hmaking.com/chamfer-vs-fillet-in-cnc-design-cost-manufacturability-practical-design-rules - fillet vs chamfer character, standard radii (snippet)
4. https://forum.onshape.com/discussion/comment/123132 ; https://forum.prusa3d.com/forum/original-prusa-i3-mk3s-mk3-how-do-i-print-this-printing-help/curved-walls/ - "chamlet" hybrid, hybrid edges for print (snippet)
5. https://blog.geeetech.com/?p=13735 - chamfer outer bottom, fillet inside corners (snippet)
6. https://ink.carta.com/foundations/radii ; https://design.twoday.com/design-system-for-products/radius ; https://novedge.com/blogs/design-news/rhino-3d-tip-mastering-variable-radius-surface-blends-in-rhino - radius roles, nested radii, avoid abrupt radius jumps (snippet)
7. https://ms-kb.msd.unimelb.edu.au/next-lab/3d-printing/key-techniques/fillets-and-chamfers-from-design-consideration - fillets in XY, wall-base fillets, 45 degree chamfers (read)
8. https://www.whipsaw.com/latest/visual-design-language-hardware-products - VDL components and process (read)
9. https://www.dca-design.com/capabilities/industrial-design/visual-brand-language - VBL definition and deliverables (read)
10. https://www.designsociety.org/publication/39094/DISCOVERING+THE+MEANING+OF+FORM+BY+EXPLODED+SKETCHING - automotive form hierarchy (abstract read; levels not retrieved)
11. https://hackaday.com/2024/03/04/design-tips-to-hide-layer-lines-in-3d-printed-parts - texture, orientation, base chamfer, fuzzy skin comments (read)
12. https://printpal.io/docs/3d-printing-design-guide ; https://help.prusa3d.com/en/article/modeling-with-3d-printing-in-mind_164135/ ; https://www.digikey.kr/en/maker/blogs/2021/designing-for-3d-printing-tips-and-tricks - show faces off the bed, edge rounding, orientation (snippet)
13. https://www.designsociety.org/download-publication/28090/overcoming_the_complexity_of_teaching_form_and_detail_aesthetics_in_product_design_education - Berry 2008, CAD-dictated form, brand semantics (read)
14. https://robmiles.com/journal/2020/11/1/the-power-of-the-chamfer - base chamfer vs elephant's foot (snippet)
15. https://help.autodesk.com/cloudhelp/2014/ENU/Alias/files/GUID-9DD73E22-A5EF-4952-BB84-2CEE2109993C.htm ; https://discourse.mcneel.com/t/should-i-build-all-fillets-with-the-fillet-command/72324 - curvature continuity and highlights, designer dissent (snippet)
16. https://hackernoon.com/apples-icons-have-that-shape-for-a-very-good-reason-720d4e7c8a14 - tangency vs curvature continuity, highlights (read)
17. https://help.autodesk.com/cloudhelp/2024/ENU/Alias-Tool-Palette-Reference/files/Surfaces-palette/GUID-01C85806-6EE3-4CAD-8570-DF74C4CE3F85.html ; https://help.solidworks.com/2024/English/SolidWorks/Sldworks/r_Variable_Size_Fillet.htm ; https://www.tflex.com/help/eng/T-FLEX%20CAD/16/blending_edges.htm ; https://www.onshape.com/en/resource-center/tech-tips/how-to-blend-fillets-using-the-fill-surface-feature - three-edge corner blends, setbacks (snippet)
18. https://makersmakingchange.github.io/OpenAT_Design_Guide/Design_Elements_For_3D_Printed_Parts/Shadow-Lines.html - shadow line dimensions and guide navigation (read)
19. https://hackaday.com/2023/08/07/enhance-your-enclosures-with-a-shadow-line - shadow line rationale and reader debate (read)
20. https://www.mfgrobots.com/Article/mfg/mpm/1324.html - intentional reveal, parting line advice (snippet)
21. https://wikis.mit.edu/confluence/display/RocketTeam/Rocket+Team+CAD+Standard - CAD standard structure (read)
22. https://hackaday.com/2020/11/16/simple-tips-for-better-3d-printed-enclosures - enclosure tips, screw-pocket bridging (read)
23. https://3dprintcalcs.pages.dev/design/text-emboss-calculator/ ; https://madegooddesigns.com/tools/text-to-stl/ ; https://makerworld.com/en/models/49380 ; https://www.sovol3d.com/blogs/news/3d-printing-text-and-logos-how-to-emboss-engrave-and-print-clean-details - text size and depth (snippet)
24. https://design.verdigris.co/categories/physical-goods/guidelines - physical goods brand guidelines (read)
25. https://www.scribd.com/document/665250111/fielden-perf-catalogue ; https://docs.rs-online.com/bcc2/0900766b8023938f.pdf - perforation open area (snippet)
26. https://help.prusa3d.com/article/fuzzy-skin_246186 - fuzzy skin parameters (snippet)
27. https://formlabs.com/global/blog/what-is-cmf-color-material-finish-opportunities-for-3d-printing/ - CMF definition, Pantone/RAL, SPI finishes (read)
28. https://www.orcaslicer.com/wiki/print_settings/quality/quality_settings_seam ; https://3dprintingspace.com/t/how-to-fix-the-z-seam-on-3d-prints-hide-the-vertical-seam-line-bambu-lab-orca-prusa/10446 - seam modes and painting (snippet)
29. https://www.matterhackers.com/store/l/layerlock-powder-coated-pei-build-plate-steel-sheet - textured vs smooth PEI finish (snippet, vendor)
30. https://www.reprap.org/wiki/User:John_Cummings/draft ; https://jlc3dp.com/blog/how-to-add-different-color-text-to-a-3d-print ; https://forum.prusaprinters.org/forum/original-prusa-i3-mmu2s-mmu2-how-do-i-print-this-printing-help/printing-text-on-first-layer/ ; https://forum.bambulab.com/t/best-practice-for-printing-logo-in-first-layer-2-colors/17554 - inlay depth and first-layer color (snippet)
31. https://siddament.com.au/blogs/filament-guide-au/matte-vs-silk-pla ; https://zbotic.in/silk-pla-vs-matte-pla-filament-which-finish-looks-better/ ; https://www.amolen.com/blogs/blog/how-to-sand-paint-silk-pla - matte vs silk, sanding silk (snippet)
32. https://www.core77.com/posts/67156/ - when fillets help or are overused (read)
33. https://ntrs.nasa.gov/citations/19730011184 (PDF https://ntrs.nasa.gov/api/citations/19730011184/downloads/19730011184.pdf) - NASA CR-124075 Isogrid Design Handbook; pages 1.0.001 to 3.0.007, 2.0.010 to 2.0.021, 4.13.003, 4.13.010 to 4.13.011, 5.0.001 to 5.0.003, 7.0.001 to 7.0.002 read
34. https://forum.onshape.com/discussion/29309/new-featurescript-engineering-grid - Engineering Grid FeatureScript parameters (read); https://frcdesign-org.pages.dev/resources/featurescripts - FeatureScript list (snippet)
35. https://dalidou.tailc093af.ts.net/Antoine/Atomizer/src/commit/239e2f01a9b2bad788d7d5dac090a8ea6a419914/tools/adaptive-isogrid - pocket skip rule (snippet)
36. https://lists.openscad.org/empathy/thread/4RF2FIAYPOXA6BC37D4QIHEPV7UV2FBZ - OpenSCAD isogrid discussion (read)
37. https://icas.org/ICAS_ARCHIVE/ICAS2012/PAPERS/319.PDF ; https://mssanz.org.au/modsim2017/C1/morozov.pdf - anisogrid (snippet)
38. https://link.springer.com/10.1007/s00170-020-05770-4 ; https://iris.univpm.it/bitstream/11566/292112/2/unpaywall-bitstream-55485799.pdf ; https://www.scientific.net/KEM.926.115.pdf - FDM isogrid panel studies (snippet)
39. https://scholars.duke.edu/publication/1293902 ; https://utw10945.utweb.utexas.edu/sites/default/files/2019/157%20An%20Experimental%20Study%20of%20Design%20Strategies%20for%20Sti.pdf - printed isogrid/orthogrid and Voronoi stiffening studies (snippet)
40. https://forum.prusa3d.com/forum/prusaslicer/why-the-gap-fill?language=cs ; https://help.prusa3d.com/article/layers-and-perimeters_1748 ; https://forum.prusa3d.com/forum/prusaslicer/how-to-interpret-width-in-the-legend-prusaslicer - wall thickness vs perimeters (snippet)
41. https://stlfinder.com/model/isogrid-wastebasket-jxldmyWN/2286653 ; https://3dswym.3dexperience.3ds.com/post/catia-visual-scripting-xgenerative-design/isogrids-for-revolute-surfaces_WnO-i9cRSiOSuQOyf_7fuA - printed isogrid example, CATIA operator (snippet)
42. https://forum.onshape.com/discussion/comment/123289/ ; https://forum.onshape.com/discussion/comment/123328/ - Julia's ISOgrid, Grid Extrude comparison (snippet)
43. https://build123d.readthedocs.io/en/latest/introductory_examples.html ; https://gist.github.com/dov/a88df9453e85bef54bf1778e392206d1 - selectors and 2D triangle fillet (snippet)
44. https://pubs.rsc.org/aa/content/articlepdf/2024/me/d4me00036f ; https://discovery.ucl.ac.uk/10196940/1/ToddChinCoppens_MSDE24.pdf - Lloyd relaxation in Voronoi lattice toolkits (snippet; exact paper not confirmed)
45. https://www.github.com/hanskellner/Fusion360Voronoi ; https://printables.com/model/831732-fast-voronoi-method-for-openscad ; https://forums.autodesk.com/t5/fusion-360-design-validate/creating-a-flat-voronoi-pattern-with-constant-width-lines/td-p/8358642 ; https://lists.openscad.org/empathy/thread/IA54HOG73RLMXYB5QM2NCM5IX5TGP7DA - Voronoi tools and rounding (snippet)
46. https://workbench.grabcad.com/tutorials/how-to-create-complex-voronoi-lattices-in-ntopology-for-printing-in-fdm-dlp-and-powderbed ; https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/12685804 - nTop Voronoi workflow, resin strut sizes (snippet)
47. https://forum.prusaprinters.org/forum/original-prusa-i3-mk3s-mk3-general-discussion-announcements-and-releases/thin-honeycomb-grid-border-holes-too-small/ - small hex holes shrink (snippet)
48. https://wiki.bambulab.com/en/filament-acc/filament/print-quality/overhang ; https://www.snapmaker.com/blog/45-degree-rule-3d-printing/ - overhang guidance (snippet)
49. https://www.pollen.am/design_for_3d_printing_holes - teardrop holes on horizontal axes (snippet)
50. https://siraya.tech/blogs/news/3d-lattice-guide ; https://engrxiv.org/preprint/download/5827/version/7684/9703/8118 ; https://fab.cba.mit.edu/classes/863.22/EECS/people/Yang/week03 - TPMS self-supporting, gyroid CAD (snippet)
51. https://proceedings.emac-online.org/pdfs/A2019-10082.pdf ; https://www.inderscience.com/filter.php?aid=47923 ; https://designsociety.org/download-publication/28971/style-branding_aesthetic_design_dna - design DNA research (snippet)
52. https://www.pushing-pixels.org/?p=19839 - color tokens mapped to physical product tiers (read)
53. https://jtcps.journals.ekb.eg/article_340163.html - CMF practitioner tasks (snippet)
54. https://uwarg-docs.atlassian.net/wiki/spaces/MEC/pages/1651081227/CAD+Guidelines ; https://nerdocs.atlassian.net/wiki/spaces/NER/pages/759857163/CAD+Best+Practices ; https://www.onshape.com/cad-blog/3-common-mistakes-to-avoid-when-sketching ; https://www.eng-tips.com/threads/checklist-or-set-of-company-standards-for-making-models.365961 ; https://www.autodesk.com/autodesk-university/article/Developing-CAD-Standards-Complete-Guide-2019 - CAD standards practices (snippet)

Count: 18 sources read in full (or the relevant pages of the PDF); about 50 more consulted via search-result text only.

## Gaps

1. **No FDM source gives isogrid cell sizes or rib dimensions for small enclosures or brackets.** B.6 values are DERIVED and need a print-and-flex test (suggest a coupon set varying h at fixed b, d, t).
2. **No FDM source gives Voronoi minimum strut width or cell size.** C.2 values are DERIVED; the nTop tutorial likely has numbers but was not retrieved.
3. **NASA handbook figure details** (Skylab 0.22 R callout, the exact meaning of the 4.200 dimension) were read from a scanned figure; treat as UNVERIFIED readings. Sections 4.1 to 4.12 (curves, worked examples) and 7.3 to 7.4 were not read.
4. **No public industrial-design style guide with physical tokens** (radii, part lines, chamfer sets) was found; D.2 is a synthesis. Real company CMF and design-language documents are confidential.
5. **Form hierarchy level names** from the Delft automotive paper were not retrieved (abstract only).
6. **Dimensional change from sanding, priming, and painting** printed parts: no numbers found; the 0.1 to 0.2 mm per surface budget is an UNVERIFIED estimate.
7. **No head-to-head bending test** of isogrid vs honeycomb vs Voronoi printed plates at equal mass was found.
8. **Light pipe, feet, and cable exit dimensions:** the OpenAT light-pipe page returned 404; no other dimensioned source fetched.
9. **Core77 and YouTube industrial-design channels** were not mined in depth (search did not surface relevant Core77 posts beyond two Fictiv-sponsored articles); a follow-up could look for surfacing tutorials on radius hierarchy.
10. **Print-time impact of isogrid vs solid-with-infill** is asserted (DERIVED) but not measured.
