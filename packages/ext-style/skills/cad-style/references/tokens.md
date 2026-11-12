# CAD tokens

Every token of the 3D CAD branch, written by hand from `themes/cad/tokens.json` and
`themes/cad/hazard-protocol.json` (keep the three consistent; the package's test checks that every theme value fits
its token's type). Lengths are millimeters, angles degrees. "Default" is the plain, conventional value a part gets
with no theme (an assumption, not a house value); "Hazard Protocol" is the shipped house theme, where `(default)`
means it keeps the default and `{core.…}` means it follows a core token. Each theme number's source or label is in
the theme file's `notes`.

A bound is a formula over the resolved DFM profile: the token keeps its value, and the effective value is raised to
the floor or lowered to the ceiling, with the reason reported (see the style model,
`../../style-system/references/model.md`). The DFM paths a bound may name are the dfm resolver's contract.

Classes: `process` (bounded by the process), `structural` (never changed for looks), `layout` (changed only when
asked), `cosmetic` (free).

Count: 69 tokens (29 cosmetic, 30 process, 6 layout, 4 structural).

## Form language and edges

| Path | Class | Type | Unit | Default | Hazard Protocol | Bound | Meaning |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `form.language` | cosmetic | enum: chamferRoundedCorners, fillet, chamfer, sharp |  | fillet | chamferRoundedCorners |  | The edge vocabulary of the whole product. chamferRoundedCorners: chamfers where faces meet, rounded corners in plan view (angular but smooth); fillet: soft rounds on outer edges; chamfer: chamfers everywhere; sharp: no treatment. |
| `edge.top.treatment` | cosmetic | enum: chamfer, fillet, sharp |  | fillet | chamfer |  | Treatment of the edges where an upward-facing or side face meets another face (the edge loop around the top of a body). |
| `edge.vertical.treatment` | cosmetic | enum: round, chamfer, sharp |  | round | round |  | Treatment of the vertical edges, the corners of the body seen from above. Rounds here print in the XY plane as a smooth toolpath. |
| `edge.chamfer.angle` | cosmetic | number 30 to 60 | deg | 45 | 45 |  | Angle of every chamfer on upper and side edges, measured from the face it cuts (45 is symmetric). One angle per product. |
| `edge.chamfer.sizes` | process | lengths | mm | [0.5] | [0.6, 1.2, 2] | floor `max(line.width, 2 * layer.height)` | The few chamfer sizes a product uses, smallest first. Every chamfer is one of them. |
| `edge.chamfer.bottom` | process | length 0 to 5 | mm | 0 | 0.6 | floor `chamfer.bed.edge` | Chamfer on the edges that sit on the build plate. Bed edges are chamfered, never filleted: a bottom fillet is an overhang, a bottom chamfer prints cleanly and hides first-layer squish. |
| `edge.chamfer.bottom.angle` | process | number 30 to 60 | deg | 45 | 45 | floor `90 - overhang.max.angle` | Angle of the bed edge chamfer face from the build plate. |
| `edge.break` | process | length 0 to 2 | mm | 0.2 | 0.4 | floor `max(line.width / 2, layer.height)` | The small edge break on secondary details (bosses, tabs, port openings) that are not part of the main edge vocabulary. |
| `corner.radius.set` | process | lengths | mm | [2] | [2, 4, 6] | floor `line.width` | The small family of plan-view corner radii a product uses, smallest first, chosen by eye. Every plan-view corner is one of them. |
| `corner.radius.inside` | process | length 0 to 20 | mm | 0.5 | 1 | floor `line.width / 2` | Fillet on inside (concave) corners that do not carry load: pocket corners, recess corners. |
| `corner.inset.rule` | cosmetic | enum: outerMinusOffset, free |  | free | outerMinusOffset |  | outerMinusOffset: a feature inset from a rounded outline at a constant offset (a lid, a recess, a bezel) has corner radius equal to the outer radius minus the offset, so the gap reads as constant; when that falls below the smallest radius in the family, use the smallest. |
| `edge.vocabulary.break` | cosmetic | enum: functionalOnly, free |  | free | functionalOnly |  | functionalOnly: an edge leaves the form language only to signal function (a touch point, a release, a warning, a mating face), never because another edge was easier to model. |
| `continuity.policy` | cosmetic | enum: g1, g2ShowFaces |  | g1 | (default) |  | g1: tangent blends everywhere; g2ShowFaces: curvature-continuous blends on large show faces that will be painted or polished. On as-printed parts layer lines hide the difference on small radii. |
| `proportion.system` | cosmetic | enum: none, goldenRatio, thirds, integerRatios |  | none | none |  | An optional diagnostic aid for checking overall block proportions. Never a generator of dimensions; none means no proportion system is used or reported. |

## Layout

| Path | Class | Type | Unit | Default | Hazard Protocol | Bound | Meaning |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `layout.margin` | layout | length 0 to 50 | mm | 3 | 4 |  | Offset from a face edge (or from the nearest secondary form) to every hole, vent, label, button and pattern zone on that face. One margin per face family. |
| `layout.gutter` | layout | length 0 to 50 | mm | 2 | (default) |  | Spacing between related features inside a group (a light and its label, a row of ports); unrelated groups sit farther apart than this. |
| `layout.snap` | layout | length 0 to 2 | mm | 0.5 | (default) |  | Feature edges or centerlines closer than this to a datum or to each other, but not on it, are near misses to snap together. |
| `layout.symmetry` | layout | enum: mirrorPrimary, free |  | free | mirrorPrimary |  | mirrorPrimary: the primary form is mirror-symmetric about its main axis; asymmetric features (ports, switches) form one deliberate group on one side. |
| `layout.datums` | layout | texts (12) |  | [centerline-x, centerline-y] | [centerline-x, centerline-y, inner-wall, board-baseline] |  | The named lines feature edges and centerlines land on (centerlines, the inner wall line, the board's baseline, a port baseline). |
| `layout.heights.layerMultiple` | process | bool |  | false | true |  | Horizontal steps, grooves, chamfer starts and color-change heights land on multiples of the layer height, so their edges print crisp. |

## Splits and seams

| Path | Class | Type | Unit | Default | Hazard Protocol | Bound | Meaning |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `split.placement` | layout | enum: existingEdge, free |  | free | existingEdge |  | existingEdge: a split between two parts sits on an existing edge or change of direction, never mid-face, with each half printable without support. |
| `split.style` | cosmetic | enum: shadowLine, reveal, recessedLid, butt |  | butt | shadowLine |  | shadowLine: one half laps over the other so the seam reads as a deliberate dark line and the halves self-locate; reveal: an intentional gap; recessedLid: a flat lid sunk in a recess; butt: faces meet. |
| `split.reveal.width` | process | length 0 to 3 | mm | 0.3 | 0.6 | floor `feature.min.gap` | Visible width of the shadow line or reveal at a split. |
| `split.reveal.depth` | process | length 0 to 5 | mm | 0.5 | 1 | floor `line.width` | Depth of the shadow line or reveal groove. |
| `seam.placement` | cosmetic | enum: rearInsideCorner, rearGroove, aligned, slicerDefault |  | slicerDefault | rearInsideCorner |  | Where the slicer's layer-start seam goes on a cosmetic part; recorded in the part's metadata for the slicer step. |
| `cosmetic.face` | cosmetic | enum: decidePerPart, top, bed, side |  | decidePerPart | (default) |  | Which face is the show face. decidePerPart: the agent names the show face of each part and orients it (top surface, textured plate, or vertical wall), and records it. |

## Fasteners

| Path | Class | Type | Unit | Default | Hazard Protocol | Bound | Meaning |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `fastener.visible` | cosmetic | enum: hidden, recessed, flush, exposed |  | exposed | recessed |  | How fasteners on show faces appear: hidden (under feet or labels, on the bottom), recessed (counterbored to one depth), flush (countersunk), exposed. |
| `fastener.head` | cosmetic | enum: socketCap, buttonHead, countersunk, panHead, any |  | any | socketCap |  | The head style of visible fasteners; one style per product. |
| `fastener.kinds.max` | cosmetic | number 1 to 10, whole | count | 4 | 1 |  | Most distinct fastener types and sizes in one product; each extra kind needs a reason. |

## Text and marks

| Path | Class | Type | Unit | Default | Hazard Protocol | Bound | Meaning |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `text.font` | cosmetic | text (60) |  | sans-serif | {core.type.family.display} |  | The face of embossed or engraved text; a bold sans-serif prints best. Usually a reference to a core typography token. |
| `text.case` | cosmetic | enum: upper, asis |  | asis | {core.voice.tags.case} |  | Case of text on parts. |
| `text.style` | cosmetic | enum: emboss, engrave, inlay |  | engrave | emboss |  | emboss: raised; engrave: cut in; inlay: a color change on the first layers of the bed face. |
| `text.height.min` | process | length 0 to 50 | mm | 4 | 5 | floor `text.min.height` | The smallest cap height the style uses for text on parts, sized by cap height, not by the text box. |
| `text.stroke.min` | process | length 0 to 5 | mm | 0.8 | 1 | floor `text.min.stroke` | The thinnest stroke of text and icons on parts. |
| `text.emboss.height` | process | length 0 to 5 | mm | 0.6 | (default) | floor `text.emboss.height` | Height of raised text and marks. |
| `text.engrave.depth` | process | length 0 to 5 | mm | 0.6 | 0.8 | floor `text.engrave.depth` | Depth of engraved text and marks. |
| `marks.logo` | cosmetic | asset |  | none | {core.marks.logo} |  | The logo asset embossed or engraved on parts; usually a reference to the core logo, gated by core brand.mode. |
| `marks.placement` | cosmetic | enum: secondaryFace, bottom, rear, none |  | none | secondaryFace |  | Where a mark goes: on a secondary face or in a dedicated recess, aligned to a datum, never floating on the show face. |
| `marks.height` | process | length 0 to 100 | mm | 10 | 12 | floor `2 * text.min.height` | Height of a logo or mark on a part. |
| `marks.clearSpace` | cosmetic | number 0 to 4 | share | 1 | {core.marks.clearSpace} |  | Clear zone around a mark on a part, as a share of the mark's height. |

## Patterns

| Path | Class | Type | Unit | Default | Hazard Protocol | Bound | Meaning |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `pattern.default` | cosmetic | enum: none, isogrid, voronoi, hex |  | none | isogrid |  | The pattern used when a part gets one: lightening, stiffening or flair in a bounded zone. none: no pattern unless asked. |
| `pattern.zone.border` | process | length 0 to 20 | mm | 2 | 2.5 | floor `wall.structural` | Solid band around every pattern zone, merged into the edges and bosses around it; also at least twice the rib or strut width (checked by the agent). |
| `pattern.pocket.ceiling.span` | process | length 0 to 30 | mm | 5 | 6 | ceiling `bridge.max.span` | Longest horizontal ceiling a pattern may leave on a vertical wall (a flat-top hex, an apex-down isogrid pocket); a longer pocket gets a pointed top or turns so its ceiling slopes. |
| `pattern.recess.depth` | process | length 0 to 5 | mm | 0.6 | (default) | floor `2 * layer.height` | Depth of a pattern recessed into a skin as texture rather than cut through. |
| `pattern.structural.claim` | structural | enum: roleStated, analyzed |  | roleStated | (default) |  | roleStated: the part note names the wall the pattern replaces and its role from the patterns reference (stiffens a thinner wall, carries local loads, or styling against a same-depth closed wall), with no load rating; analyzed: a load rating, set only with a calculation, simulation or coupon test linked. |
| `pattern.isogrid.cell` | process | length 2 to 200 | mm | 15 | 15 |  | Height h of each equilateral triangle cell (side a = 2h divided by the square root of 3). |
| `pattern.isogrid.rib.width` | process | length 0.2 to 20 | mm | 1.25 | 1.25 | floor `2 * line.width` | Rib (wall) width b; pick a width the slicer fills with whole perimeters. |
| `pattern.isogrid.rib.depth` | process | length 0 to 50 | mm | 4 | 4 |  | Rib depth d measured from the skin. |
| `pattern.isogrid.skin` | process | length 0 to 20 | mm | 1.2 | 1.2 | floor `wall.min` | Skin thickness t under a skinned isogrid. |
| `pattern.isogrid.backing` | process | enum: skinned, open |  | skinned | (default) |  | skinned: ribs on one side of a continuous skin (the skin is the show face and the seal); open: a through lattice for brackets loaded in plane and visible panels. |
| `pattern.isogrid.corner.radius.rule` | cosmetic | enum: equalsRibWidth, fixed, none |  | fixed | equalsRibWidth |  | equalsRibWidth: each triangular pocket's corners are rounded with a radius equal to the rib width, capped at 0.4 times the pocket's inscribed radius; fixed: one radius from the radius family; none: sharp corners. |
| `pattern.isogrid.node.circle` | cosmetic | bool |  | true | false |  | Whether a boss with a hole sits where ribs meet. Machined isogrids have them because the cutter leaves material there; a printed one needs a boss only where something mounts. |
| `pattern.isogrid.orientation` | process | enum: ribFamilyHorizontal, free |  | free | ribFamilyHorizontal |  | ribFamilyHorizontal: on vertical walls one rib family runs horizontal, so every pocket ceiling is either self-supporting or a short bridge. |
| `pattern.isogrid.pocket.min` | process | enum: dropUnderTwoRibWidths, keepAll |  | keepAll | dropUnderTwoRibWidths |  | dropUnderTwoRibWidths: a pocket whose inscribed radius is under two rib widths (cut short by a border, a boss or an edge) is left solid instead of filleted. |
| `pattern.voronoi.strut` | process | length 0.2 to 20 | mm | 1.2 | 1.2 | floor `2 * line.width` | Constant width of the walls between Voronoi cells (offset each cell inward by half of it). |
| `pattern.voronoi.cell` | process | length 1 to 100 | mm | 8 | 8 | floor `max(3, 6 * line.width)` | Mean opening across a Voronoi cell; about five to ten strut widths reads well. |
| `pattern.voronoi.corner.radius.rule` | cosmetic | enum: equalsStrutWidth, fixed, none |  | none | equalsStrutWidth |  | equalsStrutWidth: every cell corner is rounded with a radius equal to the strut width; fixed: one radius from the radius family; none: sharp corners. |
| `pattern.voronoi.relaxation` | cosmetic | number 0 to 40, whole | count | 0 | 5 |  | Centroid relaxation passes on the seeds: 0 is raw random cells, a few passes give even but organic cells, many converge toward hexagons. |
| `pattern.hex.cell` | process | length 1 to 100 | mm | 6 | (default) | floor `max(3, 6 * line.width)` | Across-flats size of each hexagonal opening. |
| `pattern.hex.wall` | process | length 0.2 to 20 | mm | 1.2 | (default) | floor `2 * line.width` | Wall width between hexagonal openings. |

Guards checked by the agent rather than by a bound (from `tokens.json`): `pattern.isogrid.cell` keeps at least three
cells across the panel's shortest span; `pattern.isogrid.rib.depth` stays at most about five rib widths (a rib with a
free top edge reaches local buckling near the material's strength around d = 5b, derived; thin deep ribs also wobble
while printing), and shallow ribs still stiffen a thin skin (d = t gives about twice the skin's stiffness), with most
of the gain coming from depth.

## Structure

| Path | Class | Type | Unit | Default | Hazard Protocol | Bound | Meaning |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `structure.wall` | structural | length 0 to 20 | mm | 2 | (default) | floor `wall.structural` | The wall thickness the style prefers for load-bearing walls. Style may thicken a wall, never thin it below what the process and the loads need. |
| `structure.fillet.root` | structural | length 0 to 20 | mm | 0.5 | (default) | floor `line.width / 2` | Fillet where load-bearing walls, ribs and bosses meet a base (about half a rib width under an isogrid rib). |
| `structure.loadPaths.keep` | structural | bool |  | true | (default) |  | A restyle never removes or thins a rib, gusset, boss or wall that carries load; a pattern zone never cuts through one. |

## Color, material, finish and process

| Path | Class | Type | Unit | Default | Hazard Protocol | Bound | Meaning |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `color.body` | cosmetic | color |  | #BDBDBD | {core.palette.body} |  | Color of the primary parts (the filament or finish color named by its role). |
| `color.secondary` | cosmetic | color |  | #5A5A5A | {core.palette.bodySecondary} |  | Color of supporting and structural parts. |
| `color.accent` | cosmetic | color |  | #3B6EA8 | {core.palette.accent} |  | Accent parts and details; a color change sits at a geometric break (a step, a groove, a chamfer start), never mid-face. |
| `finish.surface` | cosmetic | enum: matte, silk, gloss, asMaterial |  | asMaterial | matte |  | The surface look asked of the material and the print: matte hides layer lines, silk and gloss show them. |
| `material.preference` | process | text (120) |  | any | matte filament in the body and accent colors, where the material dfm chooses comes in them |  | A preference for how the material looks. The material itself is chosen for loads, heat and environment by the process skill; style never overrides that choice. |
| `manufacturing.default` | process | enum: fdm, sla, sls, cnc, sheet, any |  | any | fdm |  | The manufacturing process the style assumes when a part says nothing else; the DFM profile the resolver checks against should be for this process. |
