---
name: cad-style
description: Apply the 3D CAD style to parts, enclosures, brackets and panels - resolve the CAD branch with the DFM profile so process floors apply, then the form language (chamfers with rounded plan-view corners in the house style), radii and chamfer ladder, datums and margins, splits and seams, fasteners, text and marks, bounded isogrid or Voronoi patterns, color, material and finish, and a style self-check that reports drift and never blocks. Use whenever a 3D part is designed or restyled.
---

# CAD style

The 3D branch of the style system: how a printed or machined part should look, in tokens the agent applies
consistently, bounded by what the process can make.

```text
dfm resolved profile ──┐
                       ▼
style-system resolver --domain cad --item <module> --dfm <profile>
   │   effective values (preference, or the process floor/ceiling, with the reason)
   ▼
form language -> layout -> splits and seams -> fasteners -> text and marks -> patterns -> color and finish
   │
   ▼
self-check: drift report (information and warnings, never blocking) -> "I'd rather" becomes a decision
```

**The balance rule.** Style proposes; the manufacturing limit sets the effective value; the agent tells the user
where a preference was adjusted. A `process` token carries its limit as a formula over the DFM profile, so this SOP
never restates a manufacturing number: process questions (wall, overhang, bridge, text, clearance, material) go to
**dfm** and **dfm-3d-printing**.

## Purpose

Give every 3D part the same intentional look, so a product reads as designed rather than merely engineered, without
ever trading away printability or strength for it. Use it when a part, an enclosure, a bracket, a frame or a panel is
modeled or restyled, when the user asks for the house look or their own, or when they say "I'd rather it look like
this" about a 3D part. Do not use it to choose a process, a material or a wall; that is **dfm-3d-printing**. In
**build-a-project** it runs inside the enclosure and structure stage, with **enclosure-cad** and **frame-cad**, after
**dfm** has resolved a profile for the process, and before **dfm-review**.

## Inputs

| Input | Where | From |
| --- | --- | --- |
| The part's module | `src/enclosures/<module>/`, `src/modules/<module>/` (its `*.uhd.ts` and `cad.config.ts`) | **enclosure-cad**, **frame-cad** |
| A resolved DFM profile for the part's process | the dfm resolver's JSON (`protoboard.dfm.resolved/v1`) | **dfm** |
| The resolved CAD style | the style resolver (step 1) | **style-system** |
| Token meanings | [the CAD token reference](references/tokens.md) | this package |
| The house look, explained | [Hazard Protocol in 3D](references/hazard-protocol-cad.md) | this package |
| Patterns | [the patterns reference](references/patterns.md) | this package |
| Product design checklist (optional) | [the product design reference](references/product-design.md) | this package |
| Layers, decisions, examples | see [the model](../style-system/references/model.md) | **style-system** |

## Steps

### 1. Resolve the CAD style with the process

```bash
node node_modules/@protoboardai/ext-style/skills/style-system/scripts/resolve-style.mjs --domain cad --item src/enclosures/<module> --dfm <resolved dfm profile>.json --format table
```

Read every line marked `adjusted` and the `DFM:` line. Each adjusted token keeps the user's preference as `value`
and uses the process bound as `effective`; tell the user which ones moved and why (the reason quotes the formula and
the DFM values). Lines marked `not-checked` mean no profile was given: get one from **dfm** before final geometry.
Use `--format json` when you take values programmatically; always use `effective`.

### 2. Choose the form language and apply it everywhere

Read `form.language`, `edge.top.treatment`, `edge.vertical.treatment`, `edge.chamfer.angle`, `edge.chamfer.sizes`,
`corner.radius.set`, `corner.radius.inside`, `corner.inset.rule`, `edge.chamfer.bottom` and its angle,
`edge.break`, `edge.vocabulary.break`. Then, per body:

1. Sketch the plan outline with plan-view corners from `corner.radius.set` (the largest for the main body, smaller
   for secondary forms). Extrude.
2. Treat the top edge loop with one size from `edge.chamfer.sizes` at `edge.chamfer.angle`; the chamfer sweeps around
   the rounded corners as a conical band. Keep the chamfer smaller than the smallest corner radius it sweeps.
3. Chamfer the bed edge with `edge.chamfer.bottom` at `edge.chamfer.bottom.angle`; never fillet it.
4. Inside corners take `corner.radius.inside`; insets follow `corner.inset.rule` (outer radius minus the offset).
5. Secondary details (bosses, tabs, port openings) get `edge.break`.
6. Break the vocabulary only where `edge.vocabulary.break` allows (a touch point, a release, a warning).

The house look and how to model it are in [Hazard Protocol in 3D](references/hazard-protocol-cad.md).

### 3. Lay out on shared datums and margins

Place holes, vents, labels, buttons and pattern zones on the lines in `layout.datums`, at `layout.margin` from the
face edge, with `layout.gutter` inside a group; respect `layout.symmetry`. List each face's feature positions:
values within `layout.snap` of a datum or of each other that are not equal are near misses. Report them; snap them
only when the user asks (layout tokens move features, which changes fits). With `layout.heights.layerMultiple`, put
steps and chamfer starts on multiples of the profile's layer height.

### 4. Splits and seams

Place splits by `split.placement` (on an existing edge, each half printable without support) and give them
`split.style` with `split.reveal.width` and `split.reveal.depth` (effective values). Name the show face of each part
(`cosmetic.face`) and the seam location (`seam.placement`), and record both in the part's notes for the print step.
Fits and clearances of the joint itself come from **dfm-3d-printing**, not from style.

### 5. Fasteners

Use at most `fastener.kinds.max` fastener kinds, heads per `fastener.head`, shown per `fastener.visible` (hidden
under feet or on the bottom, recessed to one depth, flush, or exposed). Visible fasteners sit on a shared pattern at
equal margins. Hole and insert sizes come from **dfm-3d-printing**.

### 6. Text and marks

Text uses `text.font`, `text.case`, `text.style`, cap height at least `text.height.min`, strokes at least
`text.stroke.min`, and `text.emboss.height` or `text.engrave.depth` (all effective values). Marks: `marks.logo` at
`marks.height`, placed per `marks.placement` on a datum, with a clear zone of `marks.clearSpace` times its height.
Check the resolver's `assets` list: an unregistered, unverified or unresolved-license mark is left off and reported.
Respect `core.brand.mode`: a client project gets no house logo.

### 7. Patterns in bounded zones

If the part gets a pattern (`pattern.default`, or the user asks), follow [the patterns reference](references/patterns.md):

1. Draw a zone on one face with a solid border of `pattern.zone.border` (also at least twice the rib or strut width),
   clear of bosses, holes and load paths (`structure.loadPaths.keep`).
2. Isogrid: cell `pattern.isogrid.cell`, rib `pattern.isogrid.rib.width`, depth `pattern.isogrid.rib.depth`, skin
   `pattern.isogrid.skin`, corners per `pattern.isogrid.corner.radius.rule`, nodes per
   `pattern.isogrid.node.circle`, orientation per `pattern.isogrid.orientation`, small pockets per
   `pattern.isogrid.pocket.min`. Voronoi: `pattern.voronoi.strut`, `pattern.voronoi.cell`,
   `pattern.voronoi.relaxation`, corners per `pattern.voronoi.corner.radius.rule`. Hex: `pattern.hex.cell`,
   `pattern.hex.wall`.
3. On vertical walls keep every pocket ceiling within `pattern.pocket.ceiling.span`.
4. Record in the part's notes what the pattern replaces and its role from the patterns reference
   (`pattern.structural.claim = roleStated`): structural (ribs stiffening a thin wall or lid, an open back face that
   does a job, local loads and bosses on nodes) or styling (a closed wall of the same depth was the alternative), and
   why. When stiffness at a fixed depth is the requirement, use a closed two-skin wall and offer the pattern as styling
   on it. Claim a load rating only when `pattern.structural.claim` is `analyzed` with evidence linked. Ask **dfm**
   before a through-cut pattern in a thin printed wall.

### 8. Color, material and finish

Assign `color.body` to primary parts, `color.secondary` to structural ones and `color.accent` only where the core's
`palette.accent.use` allows (functional emphasis). Put any color change at a geometric break. `finish.surface` and
`material.preference` state the look wanted; the material itself is chosen by **dfm-3d-printing**.

### 9. Self-check: report drift, never block

Run the checklist on the model and report each finding as information or a warning, with the token, the expected
and the actual value:

| Check | Token |
| --- | --- |
| Distinct outer radii and chamfer sizes are all in the families | `corner.radius.set`, `edge.chamfer.sizes` |
| One chamfer angle | `edge.chamfer.angle` |
| No filleted bed edge | `edge.chamfer.bottom` |
| Chamfer smaller than the corner radius it sweeps | `form.language` |
| Near-miss positions and uneven margins | `layout.snap`, `layout.margin` |
| Split on an edge, with the chosen style | `split.placement`, `split.style` |
| Fastener kinds and heads | `fastener.kinds.max`, `fastener.head` |
| Text at or above the effective minimums | `text.height.min`, `text.stroke.min` |
| Every pattern in a bordered zone, with its role and baseline stated | `pattern.zone.border`, `pattern.structural.claim` |
| A provider that cannot express a token | note it as not applied |

Nothing here blocks a build or a release. A process bound the model breaks is a manufacturing finding: send it to
**dfm-review**.

### 10. Record what the user says

When the user reacts ("I'd rather the chamfers were bigger", "drop the node circles", an image), follow
**style-system** step 6: restate as token changes, preview with `--set`, ask the scope (this part, this project, all
their work), append the decision (`D-CAD-…`), write the layer, resolve again. A `structural` token is refused for
looks.

## Decision points

| Decision | Rule |
| --- | --- |
| Which form language | `form.language` as resolved. In the house style: chamfers where faces meet, rounded plan-view corners. |
| Which radius or chamfer from the family | Largest for the primary body's plan corners and main edge loop, smaller for secondary forms, `edge.break` for tertiary details. Never invent a value outside the family; add one to the family by decision. |
| A preference under a process floor | Use the effective value; tell the user; never lower the floor here. A user who wants the preference anyway overrides the limit through **dfm**, which records a waiver in the DFM profile; resolve again with the new profile and the floor follows it. |
| Proportions | No proportion system unless `proportion.system` names one, and then only as a diagnostic in the report. |
| The provider cannot express a token | Do not edit provider-owned native files; apply what the provider exposes (today ext-enclosure-cad has box or round shells, opening corner radii and joint styles, and no chamfers, ribs or patterns), report the rest as not applied, and ask the user whether to model the part directly instead. |
| Pattern or solid | Pattern only in a bounded zone where it does a job (lightening, stiffening, airflow, grip, flair) and never across a load path; isogrid to stiffen a thin wall or lid or carry local loads (a closed two-skin wall when stiffness at a fixed depth is the goal), Voronoi for an organic look under low load, hex or perforation for airflow. The pattern is also part of the house look and good styling in its own right. |
| Structural claim | The role is stated against the baseline: stiffer than the thinner wall it replaces, yes; stiffer than a closed printed wall of the same depth, no, except at short spans and under point loads. A load rating needs an analysis or a coupon test (`analyzed`). The claim is a `structural` token, never set for looks. |
| Scope of a correction | Ask: this part (item), this project, or all their work. |

## Outputs

| Output | Where |
| --- | --- |
| Styled geometry | the module's own source (`*.uhd.ts`, `cad.config.ts`, or a directly authored CAD script); never a provider's generated native folder |
| Part notes: show face, seam, pattern role (what it replaces, structural or styling, and why; `analyzed` only with evidence) | the module's notes or metadata |
| Style self-check report | in the reply to the user (information and warnings) |
| Decisions and layers | `<project>/style/cad/decisions.jsonl`, `<project>/style/cad/theme.json`, `<module folder>/style.json`, or the user's `<config>/cad-style/` |

## Verification

```bash
node node_modules/@protoboardai/ext-style/skills/style-system/scripts/resolve-style.mjs --domain cad --item src/enclosures/<module> --dfm <resolved dfm profile>.json --format json
npx protoboard check --format json
```

The resolver exits 0; `dfm.checked` is true; every `adjusted` entry was reported to the user. The project check
passes (style never adds a model error; a new one comes from the geometry change, so fix it with the domain skill).
Then **dfm-review** reviews the part's manufacturability, by an agent that did not do the work.

## Failure handling

| Code or symptom | Means | Do |
| --- | --- | --- |
| `check: not-checked` on process tokens | no DFM profile was passed | Get the resolved profile from **dfm**, resolve again |
| `check: unknown` | the profile lacks a path a floor needs | Ask **dfm** to fill it; meanwhile report the token as unchecked |
| A chamfer self-intersects at a rounded corner | chamfer size at or above the corner radius | Use a smaller chamfer from the ladder or a larger radius from the family |
| A fillet fails to build at a three-edge corner | unequal radii meeting at a vertex | Equal radii, or make the plan-view radius clearly larger than the edge treatment |
| A pocket too small to round | the inscribed radius is under two rib widths | Leave it solid (`pattern.isogrid.pocket.min`) |
| Pattern zone cuts a boss, hole or rib | the zone was drawn over a load path | Redraw the zone with its border around them |
| A provider has no parameter for a token | the generator does not model that feature | Report it as not applied; do not hand-edit generated files |
| `ENCLOSURE_*` codes after a change | an enclosure check failed | **enclosure-cad** failure handling; every code is explained in the diagnostic codes reference of the system-compose skill |

## Hard rules

1. Always use effective values; a style preference never overrides a process bound.
2. Never restate or change a manufacturing number here; ask **dfm** or **dfm-3d-printing**.
3. No proportion systems by default; never a generator of dimensions.
4. Patterns sit in bounded zones with a solid border, with their structural role stated against the wall they replace.
5. Never edit provider-owned generated files; nothing here prints, orders or uploads.
