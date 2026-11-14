# Hazard Protocol in 3D

The house 3D look, as the shipped `hazard-protocol` CAD theme encodes it. It is the house style, not a rule for
everyone: a user or a project replaces any of it with a layer, a decision or a theme of their own. Numbers below are
the theme's starting values; each has a note in `themes/cad/hazard-protocol.json` saying where it comes from (a
house convention, research, or an assumption), and every `process` value is bounded by the DFM profile when the
style is resolved.

## The house conventions

- Most parts are FDM printed: printing is the default manufacturing assumption (`manufacturing.default = fdm`).
- The house form language is chamfers with rounded corners: chamfered edges where faces meet, rounded corners in
  plan view. The result reads angular but smooth, and professional.
- No ratio or proportion systems: no golden ratio, no fixed chamfer or draft ratios. Sizes are chosen by eye from a
  small family (`proportion.system = none`). A proportion aid may be offered as a diagnostic, never applied by
  default.
- The signature pattern is the isogrid, with rounded pocket corners (radius equal to the rib width) and no circle at
  the nodes; the same idea is used with Voronoi, every cell corner rounded. Patterns add flair and are sometimes
  structural, not always.
- Product design principles (how to make a product look good, not only work) inform the style as optional, checkable
  guidance ([the product design reference](product-design.md)).

## The form language: chamfers with rounded corners

### Which edges get what

| Edge | Treatment | Token |
| --- | --- | --- |
| Plan-view corners (vertical edges seen from above) | rounded, from the radius family | `edge.vertical.treatment = round`, `corner.radius.set = [2, 4, 6]` |
| The top edge loop and edges where side faces meet a top or a step | chamfered at one angle, from the chamfer ladder | `edge.top.treatment = chamfer`, `edge.chamfer.angle = 45`, `edge.chamfer.sizes = [0.6, 1.2, 2]` |
| Bed edges (where the part sits on the plate) | chamfered, never filleted | `edge.chamfer.bottom = 0.6`, `edge.chamfer.bottom.angle = 45` |
| Inside corners (pockets, recesses) | small fillet | `corner.radius.inside = 1` |
| Small details (bosses, tabs, port openings) | edge break | `edge.break = 0.4` |
| Insets that follow an outline (lid, recess, bezel) | outer radius minus the offset | `corner.inset.rule = outerMinusOffset` |
| Load roots (rib, wall and boss roots) | fillet, never reduced for looks | `structure.fillet.root` |

A different treatment is allowed only to signal function (`edge.vocabulary.break = functionalOnly`): one filleted
thumb recess on an all-chamfer body reads as "press here".

### The small set of sizes

- One chamfer angle, 45 degrees.
- A ladder of chamfer sizes: small (0.6 mm) for secondary forms and lids, medium (1.2 mm) for the main body of
  hand-sized parts, large (2 mm) for big panels. Research advises at most two chamfer sizes on the outer edges of one
  part; the third step is for a larger part, not for mixing.
- A family of plan-view radii: 2, 4 and 6 mm, picked by eye for hand-sized parts, not from a ratio. The largest goes
  on the primary body, smaller ones on secondary forms.
- Anything else needs a reason and a decision that adds it to the family.

### How to model it

1. Sketch the plan outline with its corners rounded at a radius from the family, then extrude.
2. Chamfer the whole top edge loop with one size from the ladder. Around a rounded corner the chamfer becomes a
   conical band, which is the characteristic look. Keep the chamfer smaller than the corner radius, or it
   self-intersects (a 2 mm chamfer needs at least the 4 mm radius).
3. Chamfer the bottom edge loop with the bed chamfer, at an angle the process allows (the resolver raises it when the
   overhang limit requires).
4. Fillet inside corners; give small details their edge break.
5. Where three edges meet at a corner, keep the plan radius clearly larger than the edge chamfer so the corner reads
   as a soft rounded rectangle with a crisp band, never two near-equal values.
6. Model the form first, then fit features to it; never pick a shape because the CAD kernel builds it more easily.

## How it stays printable

- Bed edges are chamfered: a fillet there is an overhang that sags; a chamfer prints cleanly and hides first-layer
  squish (dfm-research 06, A.3, citing several printing guides).
- Plan-view rounds are drawn in the XY plane as a smooth toolpath, so the printer does not slow at sharp corners.
- One chamfer angle at 45 degrees is self-supporting on most FDM setups; the bed chamfer angle carries a floor from
  the profile's maximum overhang angle.
- Chamfer sizes, radii, reveal widths, text sizes, rib and strut widths are `process` tokens with floors from the DFM
  profile: the house value is a preference, and the resolver reports when the process moves it.
- Heights land on layer multiples (`layout.heights.layerMultiple`), so steps and chamfer starts print crisp.
- The show face is named per part and the seam goes to a rear inside corner.

## On an enclosure

A rounded-rectangle shell with 6 mm plan corners and a 1.2 mm chamfer around the lid's top edge loop; a 0.6 mm bed
chamfer on the base; the base and lid meet at a shadow line on the split edge (0.6 mm wide, 1 mm deep); ports and
the status light sit on the centerlines with a 4 mm margin; one fastener kind, socket heads recessed to one depth or
hidden under the feet; the logo embossed on a secondary face on a datum; an isogrid zone on the inside of a large
wall or on the underside, bordered by a solid band; light gray body, dark gray structure, orange only on a button or
an indicator; matte filament.

Today's enclosure generator (ext-enclosure-cad) makes box or round shells, opening corner radii and joint styles,
but no chamfers, ribs or patterns. Apply what it exposes (opening corner radii from the family, the shell shape) and
report the rest as not applied; the full look needs a directly modeled part.

## On a bracket

A plate or L-bracket with 4 mm plan corners and 0.6 mm chamfers on its exposed edge loops, a bed chamfer on the
face that sits on the plate, generous load-root fillets that the style never trims, bolt holes on a shared pattern
at equal margins, and, where weight matters, a skinned isogrid web (open only for a bracket loaded in its own plane)
laid out from node to load point, with solid bosses only at the bolts; it usually prints slower than a solid web. Its
part note states the baseline and the role; a load rating needs a calculation or a coupon test.

## On a panel

A flat panel printed show face down on a textured plate: 2 mm plan corners, a 0.6 mm chamfer on its top loop, a
bed chamfer on the plate side, a skinned isogrid on the back (ribs up, no supports, one rib family parallel to the
long edge; it stiffens the thin panel, a structural role the part note states), a solid border around the pattern merged into the mounting holes, text embossed on the back or inlaid on
the first layers of the show face.

## What it is not

- Not filleted everywhere at one default radius, and not sharp.
- Not a proportion system.
- Not decoration pretending to be structure: a pattern's role is stated against the wall it replaces, and a load
  rating needs evidence. Where the pattern is styling, it is still part of the house look and says so.
- Not a reason to thin a wall, cut through a load path, or change a fit.
