# Product design: an optional checklist

How to make a product look good, not only work, as checks an agent can run on a model. This is optional guidance:
use it when the user wants a product look or asks for a design review of a part's appearance. It never overrides a
token, a decision or a manufacturing limit. Synthesized from `docs/specs/dfm-research/06-product-design-and-patterns.md`
(section A), paraphrased. Labels: **source** (a cited document), **derived** (reasoning from sources),
**unverified** (seen only in secondary or community material).

## 1. Principles as review questions

The ten principles of good design that Vitsoe publishes (innovative, useful, aesthetic, understandable,
unobtrusive, honest, long-lasting, thorough, environmentally friendly, as little design as possible) are criteria
for judgment, not rules (source). Translated into checks (derived):

| Principle | Check on the model |
| --- | --- |
| Useful | Every feature answers a requirement (fastening, airflow, grip, cable exit, label); a feature with none is removed. |
| Understandable | Buttons, ports, latches and releases look different from structure (recess, frame, other edge treatment); the front and bottom are obvious. |
| Unobtrusive | Screws, vents and seams are smaller, recessed, aligned and grouped, or on secondary faces. |
| Honest | No fake vents or screws; a pattern is called structural only for what it does against the wall it replaces. |
| Thorough | Every edge has a treatment from the form language; no leftover default radius; no unresolved three-edge corner. |
| As little design as possible | Count distinct radii, chamfer sizes, hole sizes, fastener kinds and text sizes; each extra one needs a reason. |

## 2. Form language consistency

- One edge vocabulary per product (soft fillets, crisp chamfers, or the hybrid chamfer with rounded plan-view
  corners), recorded in the style (`form.language`). Chamfers read crisp and technical, fillets soft (unverified,
  consistent across several manufacturing guides).
- Break the vocabulary only to signal function (`edge.vocabulary.break`).
- Reuse a few signature elements across a product family (a corner treatment, a groove, a vent shape, a badge
  recess) so the family reads as related without cloning (source: visual design language practice).

## 3. A radii family

- A small family of plan-view radii and a short chamfer ladder instead of a radius per edge (`corner.radius.set`,
  `edge.chamfer.sizes`); one inside radius (`corner.radius.inside`).
- Nested outlines keep a constant gap: inner radius equals outer radius minus the offset (`corner.inset.rule`).
- One chamfer angle; at most two chamfer sizes on the outer edges of one part (unverified guidance).
- Where three edges meet, equal radii, or a plan radius clearly larger than the edge treatment; never two near-equal
  values (derived).
- Curvature-continuous (G2) blends matter on large glossy or painted show faces; on as-printed parts with small
  radii, tangent (G1) blends are enough (derived; `continuity.policy`).

## 4. Datums and margins

- Feature edges and centerlines land on a few shared lines (`layout.datums`); positions within about half a
  millimeter of each other that are not equal are near misses (derived; `layout.snap`).
- One margin from each face edge to every feature on it (`layout.margin`); uneven margins are the most visible sign of
  an engineered rather than designed part (derived).
- Related features cluster with equal spacing (`layout.gutter`); unrelated groups stand farther apart.
- The primary form is mirror-symmetric; asymmetric features form one deliberate group (`layout.symmetry`).

## 5. The silhouette test

Suppress every tertiary feature (screws, vents, text, buttons, seams): the primary and secondary forms alone should
read correctly. A tertiary feature that changes the silhouette is either promoted to a deliberate secondary form or
reduced (derived from form-hierarchy practice in design education). Decide the form before modeling; never choose a
shape because the CAD kernel builds it easily (source: a design-education study of CAD-led form).

## 6. Reveals and shadow lines

Two printed halves are never perfectly flat, so a plain butt joint shows a wandering gap. A shadow line (one half's
lip over the other's rim) turns the seam into a deliberate dark line and locates the halves; a reveal is an
intentional gap that hides warp (source: an open design guide for printed assistive devices and an enclosure
article; `split.style`, `split.reveal.width`, `split.reveal.depth`). Some designers prefer a flat lid sunk in a
recess, which has no groove to collect dirt.

## 7. Seams, show faces and finish

- Splits sit on an existing edge or change of direction, never mid-face, each half printable without support
  (`split.placement`).
- Every cosmetic part has a named show face, oriented to print well (top surface, textured plate, or vertical wall),
  and a designated seam location, ideally an inside vertical corner or a rear groove (`cosmetic.face`,
  `seam.placement`).
- Color changes sit at a geometric break; matte filament hides layer lines better than silk or gloss
  (unverified vendor guidance; `finish.surface`).

## 8. Text and marks

Bold sans-serif, sized by cap height, raised rather than engraved where possible; logos on a secondary face or in a
recess, aligned to a datum, with a clear zone about as wide as the logo is tall (source: a published hardware brand
guide; `marks.clearSpace`). Icons share the text's stroke and depth. The process minimums are the DFM profile's.

## 9. Prototype-looking versus product-looking

| Looks like a prototype | Looks like a product |
| --- | --- |
| Sharp edges, or one default fillet everywhere | One edge vocabulary from a small family |
| A flared bottom edge, brim marks on show faces | A bed chamfer; show faces up, on the sides or on a textured plate |
| Butt-jointed halves with a wandering gap | A shadow line or a deliberate reveal |
| A random seam on the front | The seam in a rear inside corner or groove |
| Support scars on show faces | Geometry that needs no support (chamfers, pointed holes, bridges) |
| Glossy filament showing every layer | Matte filament, modeled texture |
| Features at arbitrary positions, uneven margins | Features on shared datums with equal margins |
| Mixed screws with proud heads | One fastener kind, flush or uniformly recessed, or hidden |
| Thin serif text engraved on a wall | Bold sans-serif, embossed or inlaid, sized by cap height |
| Patterns pasted everywhere | Patterns in bordered zones where they do a job |

## 10. Common mistakes to detect

1. One default fillet radius on every edge, bed edges included.
2. Many slightly different radii on neighboring edges.
3. Mixed chamfer angles or sizes on one part.
4. Pinched or bulging three-edge corners.
5. Features a fraction of a millimeter off a shared line; uneven margins.
6. Butt-jointed halves with no shadow line or reveal.
7. Show faces on support interfaces or on shallow slopes that stair-step.
8. No seam plan.
9. Text too thin or too small, serif faces, engraving on vertical walls.
10. A pattern on a face that carries no load presented as structure, a pattern claimed stiffer than the closed wall
    of the same depth it replaced, or a pattern cutting through a wall.
11. Shapes chosen because they were easy to model.
12. Bosses or screw towers poking through the primary form.
13. Over-detailing.
14. Visible fasteners of mixed kinds at uneven spacing.
15. Uneven wall thickness that shows as waviness on large faces.

## 11. Proportion systems: optional, off by default

The golden ratio, the rule of thirds and simple integer ratios can be used to sanity-check overall block proportions
or where a horizontal break line falls. In the house style they are off (`proportion.system = none`): the house convention
uses no ratio or proportion systems. Offer one only when the user asks how proportions read, use it only to
flag something that looks off, and never let it generate a dimension.

## Sources

Through `docs/specs/dfm-research/06-product-design-and-patterns.md`, which lists the full references, all accessed
2026-11-12:

- Vitsoe, "Good design" (the ten principles), vitsoe.com.
- Melbourne School of Design, fillets and chamfers for 3D printing (knowledge base page).
- Whipsaw, visual design language for hardware products; DCA Design, visual brand language.
- Design Society publications on form hierarchy and on teaching form and detail aesthetics.
- Hackaday articles on hiding layer lines, shadow lines and printed enclosures.
- Makers Making Change, OpenAT Design Guide, shadow lines.
- Formlabs, color, material and finish for 3D printing.
- OrcaSlicer documentation on seams.
- A published physical-goods brand guideline (Verdigris).
- Autodesk Alias and other CAD documentation on curvature continuity and corner blends (search snippets).
