# Patterns: isogrid, Voronoi, hex and others

How the house patterns are drawn, what each one does structurally, and when it is styling. Labels: **source** (a
cited document, via `docs/specs/dfm-research/06-product-design-and-patterns.md`, sections B and C), **derived**
(reasoning or arithmetic from sourced facts: a starting value to prove with a printed coupon), **model** (a
calculation in `docs/specs/dfm-research/09-isogrid-fdm-recheck.md`, medium confidence, not a test), **house** (a house
convention). Manufacturing limits (minimum wall, line width, overhang, bridge) are the DFM profile's, applied
by the resolver as floors and ceilings; this page never replaces them.

## The rule for every pattern

1. A pattern sits in a bounded zone on one face, with a solid border (`pattern.zone.border`, also at least twice the
   rib or strut width) merged into the edges, bosses and holes around it.
2. It never crosses a load path: ribs, gussets, bosses and walls that carry load stay whole
   (`structure.loadPaths.keep`).
3. Its role is stated (`pattern.structural.claim = roleStated`): the part note names the wall the pattern replaces,
   says whether the pattern is structural or styling (see [structural or styling](#structural-or-styling)), and why.
   A load rating needs a calculation, a simulation or a coupon test (`analyzed`). Presenting styling as structure is
   dishonest design; calling ribs that stiffen a thin wall decoration undersells them.
4. It does a job: stiffening a thin wall or lid, carrying local loads to nodes, lightening, airflow, grip, or a
   deliberate signature on a chosen face. Styling is a job: the pattern is part of the house look and good styling in
   its own right.

## Isogrid

A lattice of ribs forming equilateral triangles, on a skin (skinned) or as an open lattice. Its smeared stiffness is
the same in every direction in the plane, which is where the name comes from (source: NASA CR-124075, the Isogrid
Design Handbook, 1973).

### Parameters

| Symbol | Meaning | Token |
| --- | --- | --- |
| h | triangle height (cell) | `pattern.isogrid.cell` |
| a | triangle side, 2h divided by the square root of 3 | derived from h |
| b | rib width | `pattern.isogrid.rib.width` |
| d | rib depth, from the skin | `pattern.isogrid.rib.depth` |
| t | skin thickness | `pattern.isogrid.skin` |

Two ratios govern it (source): alpha = b d / (t h), the rib-to-skin material ratio, and delta = d / t. The handbook
reports that many optimum aerospace designs land near alpha about one third, which gives about four thirds of the
skin's extensional stiffness and a very large gain in bending stiffness for twice the skin's weight. Those optima are
for thin metal skins in compression buckling, not for printed parts (derived: they imply ribs over twelve times as
deep as the skin and cells dozens of rib widths tall).

### The house convention

- **Pocket corners rounded at a radius equal to the rib width** (house;
  `pattern.isogrid.corner.radius.rule = equalsRibWidth`). Supported by the research (derived): a corner radius at
  least one extrusion width lets the slicer run a smooth perimeter around the pocket instead of a sharp 60 degree
  turn, and lowers the stress where ribs meet. Cap the radius at about 0.4 times the pocket's inscribed radius
  (h/3 - b/2).
- **No circle at the nodes** (house; `pattern.isogrid.node.circle = false`). In machined isogrid the cutter cannot
  reach the middle of a rib intersection, so material is left there and a hole is drilled through it to save weight;
  those holes then serve as attachment points (source: the handbook, section 5). A printer has no cutter, so there
  is nothing to drill out. Keep a boss only at a node where something mounts.
- **Small pockets are left solid** (derived; `pattern.isogrid.pocket.min`): when a border, a boss or an edge cuts a
  pocket down to an inscribed radius under about two rib widths, fill it instead of filleting it.
- **A root fillet** of about half the rib width where a rib meets the skin (derived; `structure.fillet.root`).

### Stiffness: the baseline decides the answer

**A one-sided isogrid is about 4 to 25 times stiffer than the thin wall it sits on and about 1.75 to 3.6 times
stiffer than any plain printed wall of the same mass, but a normally printed closed wall of the same overall depth
(two skins over sparse infill) is about 2.5 to 4 times stiffer than the isogrid in whole-panel bending at about the
same mass; the isogrid wins that comparison only at short spans (about 30 mm or less) or under point loads.**

| Compared with | Stiffer in panel bending | Mass | Confidence |
| --- | --- | --- | --- |
| The bare skin it sits on | isogrid, about 4 to 25 times (rib depth 1.5 to 4 skins) | isogrid about 1.3 to 2.1 times heavier | high |
| A plain wall of the same mass, made thinner (printed or machined) | isogrid, about 1.75 to 3.6 times | equal | high |
| A normally printed closed wall of the same depth (two skins over 10 to 20 percent infill), spans of 50 mm or more | closed wall, about 2.5 to 4 times | about equal (see material, below) | medium (model) |
| The same closed wall at a span of about 30 mm or less, or under a point load | isogrid equal or stiffer: sparse infill is soft in shear | about equal | low to medium (model) |
| A machined billet or a 100 percent printed wall of the same depth | solid, about 4.6 to 6.7 times | solid 2 to 2.7 times heavier | high |

**A printed "solid" wall is not solid.** It is perimeters and top and bottom skins around sparse infill, so the
handbook's comparison with a machined billet of the same thickness does not transfer to FDM directly. That printed
wall gets its bending stiffness from its two skins held apart by the infill: dense material on both faces, far from
the neutral axis (an I-beam). A one-sided isogrid has dense material on one face only and spreads its rib material
down the depth (a T-beam), which is why the closed wall of the same depth stays stiffer even though it is mostly air.

**Filament direction.** Ribs sized in whole line widths (see the design rules) slice entirely as perimeters, with
the filament running along the rib. Along-bead strength is much higher than across-bead or crossed-raster strength
(source, measured: 1.6 to 7 times), so ribs are strong at nodes, bosses and local loads. The stiffness gain from
direction is small, about 10 percent, because crossed-raster skins are nearly isotropic in modulus (source,
measured). In whole-panel bending the rib tips sit far from the neutral axis, so a printed isogrid fails at roughly a
quarter of the bending moment of the same-depth printed wall (model, low to medium confidence).

**Material.** An isogrid is not automatically lighter, and with heavy ribs it is heavier. Against the thin wall it
replaces it always adds mass. Against a same-depth printed wall it uses slightly less material (about 3 to 19 percent
less in the model) when the cells are large; it is lighter when

h > h* = 3 b d (1 + f) / [ (t_top + t_bot - t) + rho (T - t_top - t_bot) ]

where f is about 0.1 for the corner and root fillets, t_top + t_bot are the printed wall's top and bottom skins
(about 1.8 mm at common slicer defaults), rho is the actual infill density (about 1.1 times the nominal) and
T = t + d. For a 4 mm lid with 1.25 mm ribs, h* is about 12.5 mm against 15 percent infill; with 1.7 mm ribs on a
1.6 mm skin, 6 mm deep, it is about 28 mm, so a 25 mm cell is already heavier (model).

**Print time.** An isogrid usually prints slower than a closed wall of the same depth, roughly 1.4 times in the model
(many short loops, seams and travels; a rough estimate). Check it in the slicer.

**Worked numbers (model).** A 150 x 100 mm lid 4 mm deep (1.2 mm skin, 1.25 mm ribs, 15 mm cells) is about 8 times
as stiff as its bare skin and about 1.75 times as stiff as a plain printed wall of the same mass (2.0 mm). A printed
wall 4 mm thick with normal skins and 10 to 20 percent infill is about 3.7 times stiffer than the isogrid, at about
the same mass. With fewer than three cells across a panel the smeared formulas over-predict.

**How sure this is.** The same-depth and short-span comparisons are model calculations (layered bending stiffness,
with skin and infill moduli taken from measured sources), medium confidence, not tests; no source found tested this
exact comparison in either direction. The test that settles it: two coupon pairs printed in one material and process,
same outline, three-point bend, every coupon weighed. Pair A is the same depth (an isogrid 4 mm deep against a plain
4 mm wall at slicer defaults); pair B is the same mass (the same isogrid against a plain wall thinned to its measured
mass). The coupon is proposed in `docs/specs/dfm-research/09-isogrid-fdm-recheck.md`, section 10; it is not yet in
the DFM coupon list. If pair A shows the isogrid within about 1.5 times of the plain wall, revise this section.

### Structural or styling

State the role of each patterned zone in the part note: the wall it replaces, structural or styling, and why.

**Structural** when:

- it stiffens a thin wall or lid that would otherwise flex, with depth added on one side only;
- the back face must stay open: access, cooling, cable routing, mounting at nodes, a visible signature face;
- local loads and bosses land on nodes, or loads are short-span (knobs, buttons, screw bosses, hand pressure);
- near-isotropic stiffness is wanted under unknown or multi-direction loads.

If bending is one-way (a long, narrow panel), put more rib material along the load: ribs in one direction, or an
orthogrid.

**Styling** when:

- a closed wall of the same depth was the alternative and the open face does no job;
- the pattern is shallow: a recessed texture, or ribs under about one skin thickness deep on a wall that is already
  stiff enough;
- fewer than three cells cross the span;
- it is a through-cut lattice in a thin wall;
- it is a thin Voronoi (thin struts or large cells).

**When maximum stiffness at a fixed depth is the requirement**, use a closed two-skin wall (the slicer default, or
with internal rib walls or 0.2 mm slits along the rib lines so the slicer prints walls there) and offer the pattern
as styling on it, for example recessed on the show face at `pattern.recess.depth`. Styling is a legitimate role,
recorded as such.

### Design rules that make a printed isogrid structural

1. **Rib width in whole line widths**, so each rib slices entirely as perimeters. A wall of n lines is
   n w - (n - 1) l (1 - pi/4) wide, with w the line width and l the layer height (adjacent beads overlap). At the DFM
   profile's 0.45 mm line width (a 0.4 mm nozzle) and 0.2 mm layers: 2 lines 0.86 mm, 3 lines 1.26 mm, 4 lines
   1.67 mm (derived). Use three lines for parts that get handled. The house rib, 1.25 mm, is the three-line width
   rounded down by 0.01 mm: the Arachne perimeter generator prints it as three slightly narrowed beads; on the
   Classic generator model 1.26 mm so the third line is not replaced by gap fill. The resolver's floor, two line
   widths (0.9 mm at 0.45 mm lines), is a simple bound 0.04 mm above the true two-line width: under that profile a
   two-line rib is modeled at 0.9 mm and still slices as two slightly widened perimeters. For another nozzle or layer
   height, recompute the ladder from the profile's values.
2. **Rib depth at most about five rib widths** (d/b up to about 5): near that slenderness a rib with a free top edge
   buckles locally at about the material's strength (derived), and thin deep ribs wobble while printing. That is about
   6 mm for the 1.25 mm rib and about 4.3 mm for a 0.86 mm rib. Aim for d of at least 2 t; shallower ribs still
   stiffen a thin skin (d = t about doubles it), but most of the gain comes with depth (bending stiffness grows
   roughly with d squared to d cubed).
3. **Skin at least 1.2 mm** (six layers flat, three perimeters on a vertical wall). Keep the pocket's inscribed
   diameter, 2 (h/3 - b/2), under about 20 to 25 t so the skin does not drum or dent.
4. **At least three cells across the shortest span**, preferably four or more. To hit a mass target m (as an
   equivalent thickness), h = 3 b d (1 + f) / (m - t); compare h with h* when the alternative is a same-depth printed
   wall.
5. **Fillets** per the house convention: pocket corners at r = b, capped at 0.4 times the pocket inradius; rib roots
   about 0.5 b; no node circles except bosses at fastener nodes; pockets with an inradius under 2 b left solid.
6. **Orientation.** Flat panels print skin on the bed, ribs up, no supports. Run ribs continuously into a solid border
   at least 2 b wide; avoid free rib ends (they peel across layers). On vertical walls one rib family is horizontal
   (below). Put bosses on nodes.
7. **Load direction.** Where possible the main load puts the skin in tension and the rib tips in compression;
   otherwise accept the lower rib-tip strength. Check d/b at most 5 when the tips are in compression.
8. **Warping.** On large flat panels in shrink-prone materials (ABS, ASA, PC) a one-sided rib field cups the panel
   toward the ribs. Mitigate with the border, a brim, a slightly thicker skin, or ribs on both faces.
9. **Print time.** Check it in the slicer; expect a slower print than a plain wall.

### Orientation on vertical walls

Lay one rib family horizontal (house; `pattern.isogrid.orientation = ribFamilyHorizontal`). Then every pocket either
points up, with sides at 60 degrees from horizontal that support themselves, or points down, with a horizontal
ceiling that bridges one pocket side. With a rib family vertical, the pocket ceilings slope at 30 degrees from
horizontal and droop (derived geometry). Keep any horizontal ceiling within `pattern.pocket.ceiling.span`, which the
resolver bounds by the profile's bridge limit. Flat panels print skin down, ribs up, with no supports. On a vertical
wall only the horizontal family is laid along the bead; the two 60 degree families are stair-stepped stacks whose
strength is limited by layer adhesion (their stiffness is close to full).

### FDM starting values (derived, prove with a coupon)

| Parameter | Small enclosure wall (60 to 150 mm panels) | Small bracket web |
| --- | --- | --- |
| Skin t | 1.2 mm | open, or 1.2 to 1.6 mm |
| Rib width b | 0.86 mm (two lines) or 1.26 mm (three lines; house 1.25 mm, see rule 1) at 0.45 mm lines | 1.26 to 1.67 mm (three or four lines) |
| Rib depth d | 3 to 5 mm, at most about five rib widths | the bracket's thickness (open) or 4 to 8 mm, at most about five rib widths |
| Triangle height h | 10 to 20 mm (house default 15), at least three cells across the shortest span | 12 to 25 mm, laid out node to load point |
| Pocket corner radius | equal to b, capped at 0.4 times the pocket inradius | same |
| Node circles | none, except bosses at fastener nodes | bosses at bolt and load nodes only |
| Border | solid band at least 2 b | at least 2 b around holes and edges |

Variants: an orthogrid (square cells) suits boxy, rectilinear or one-way loads but is weak in in-plane shear without
a skin; flanged ribs are overhangs on FDM and are skipped.

### When a closed wall is better

Use a closed wall instead when the part fails by layer splitting (tension across layers), when bending stiffness or
strength at a fixed depth is the goal (a two-skin printed wall of the same depth is stiffer at about the same mass),
when a one-sided rib field would warp the part, when the panel is too small for three cells, or when print time
matters (isogrids usually print slower). The pattern can still go on that wall as styling.

## Voronoi

### Generation

Scatter seed points in the zone; each cell is the region closer to its seed than to any other. Raw random seeds give
cells of very uneven size. Centroid relaxation moves each seed to its cell's centroid and
rebuilds; a few passes (house default 5; derived range 3 to 10) give even but organic cells, many passes converge
toward hexagons (`pattern.voronoi.relaxation`). For constant-width struts, offset each cell inward by half the strut
width, then round its corners (offset in, then out, or a sum with a circle). Some generators draw lines of uneven
width; offset their output before use.

### House convention

Every cell corner is rounded, at a radius about equal to the strut width
(house; `pattern.voronoi.corner.radius.rule = equalsStrutWidth`), for the same toolpath reason as the isogrid.

### Minimums (derived, unverified: no FDM source gave numbers)

| Parameter | Starting value | Token |
| --- | --- | --- |
| Strut width | two extrusion widths, about 0.86 to 0.9 mm; 1.2 mm or more for handled parts | `pattern.voronoi.strut` |
| Cell opening | at least about 3 mm across; mean cell about five to ten strut widths | `pattern.voronoi.cell` |
| Corner radius | at least one extrusion width, ideally the strut width | the corner rule |
| Border | at least two strut widths | `pattern.zone.border` |
| Blind (recessed) depth | two to four layers reads well | `pattern.recess.depth` |

### Structural or styling

Constant-width struts also slice as perimeters, with the same along-bead strength and the same peel weakness as
isogrid ribs, and the same structural logic: a one-sided strut field stiffens a thin skin a lot and does not beat a
closed two-skin wall of the same depth. It is less predictable: stiffness varies with the seeds, the largest cells
set the skin span, and the weakest strut and node govern strength. Call it structural (a skin stiffener) when the
struts are at least two to three lines wide, deep (d at least 2 t) and dense (at least about four cells across the
span); otherwise, and always as a shallow recessed texture, it is styling (derived, medium to low confidence; no
printed Voronoi-on-skin bending data was found).

### Caveats

Use it for looks under low load, or grade the seed density (denser near loads and holes) to make it somewhat
structural. Through-cut Voronoi in a thin printed wall leaves many struts bonded only at layer lines. On vertical
faces random edges leave ceilings at shallow angles that sag: stretch the seeds vertically (about 1.5 to 2 times),
round the cell tops into arches, keep cells small, or recess the pattern as texture instead of cutting through. On
faces printed flat it is only a toolpath and prints well.

## Hex and others

| Pattern | Use when | Notes |
| --- | --- | --- |
| Hex (`pattern.hex.cell`, `pattern.hex.wall`) | vents, grilles, decorative relief, sandwich cores | regular and technical, suits the chamfer look; on vertical walls a flat-top hex has a bridge ceiling (keep it within the pocket ceiling span), a pointy-top hex has ceilings at 30 degrees from horizontal |
| Round-hole perforation | speaker grilles, vents, lightening | staggered at 60 degrees packs densest (a catalog example: 3.2 mm holes at 5 mm pitch, about 37 percent open, unverified); teardrop or slot holes on vertical walls |
| Orthogrid | loads aligned with a boxy form, one-way bending | not isotropic |
| Gyroid and other minimal surfaces | sculptural panels, air paths, energy absorbers | model the solid and void explicitly rather than relying on slicer infill |

## Choosing

1. Stiffening a thin wall or lid, where one face may be open or seen, loads are local or at nodes, or a mounting grid
   is useful: isogrid. Use ribs in one direction when bending is one-way. Maximum bending stiffness at a fixed depth:
   a closed two-skin wall, optionally with internal rib walls, with the pattern as styling if the look is wanted.
2. Airflow or sound: perforation or hex, sized for the open area wanted.
3. Brand look: match the edge vocabulary. The house chamfer-and-round look takes isogrid or hex; a soft filleted
   product takes rounded Voronoi or round holes. The house uses rounded Voronoi as its organic alternative.
4. Always a bounded zone with a solid border at the margin token, its role stated against the wall it replaces.
