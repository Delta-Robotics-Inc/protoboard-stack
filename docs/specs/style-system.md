# The style system

Status: design spec, first package built (2026-11-12): `@protoboardai/ext-style` with the `style-system` and
`cad-style` skills, the core and CAD token lists, the shipped Hazard Protocol and Conventional themes, and the
resolver. The PCB branch is the existing `@protoboardai/board-style`, left as it is and mapped into the model below.
Research behind it: a review of the `@protoboardai/board-style` package, and
`docs/specs/dfm-research/06-product-design-and-patterns.md` (product design principles and patterns). Its counterpart is
[the DFM system](dfm-system.md).

## 1. Intent

The goal is a style system that is universal across domains, with domain-specific branches. It guides the agent on
how to properly style something, comes preloaded with the Protoboard hazard style, and lets the user tune, adjust, or
bring in their own styles as they see fit.

- **Shared across every domain:** how the system operates, how style files are stored and layered, reference
  images, examples, SVGs, logos, fonts and themes, and one Hazard Protocol style for the entire stack.
- **Branches where things do not transfer:** 3D CAD has its own conventions because it is 3D; silkscreen on a printed
  circuit board has very different ones.
- **Flexible:** style is personal, in the eye of the beholder.
- **Balanced against manufacturing:** some style choices have physical consequences (designing a part to be 3D
  printed is not designing a graphic), so style sits beside a separate design-for-manufacturing (DFM) system. Style
  proposes, the manufacturing limit sets the effective value, and the agent reports where a preference was adjusted.
  This is board-style's fab floor generalized: the token keeps its value, the effective value is the floor, and the
  resolved style says why.

The Protoboard house look for 3D parts is the shipped Hazard Protocol CAD theme, stated as the house style and not as
rules for everyone: FDM printing as the default process; chamfers where faces meet with rounded plan-view corners (angular but
smooth); no ratio or proportion systems (offered only as an optional aid); the isogrid as the signature pattern, with
pocket corners rounded at a radius equal to the rib width and no node circles, and the same idea with Voronoi; and
product design principles as optional, checkable guidance.

## 2. The model

The model is carried over faithfully from board-style ("a design system for printed circuit boards, the way
Tailwind is one for UI"). The full reference is `packages/ext-style/skills/style-system/references/model.md`.

| Piece | What it is |
| --- | --- |
| Token | One typed value with a dotted path, a class (its policy), a default (a plain, conventional result), a title, a description, an optional guard, and in a branch an optional floor or ceiling formula |
| Theme | A named set of token values with `id`, `name`, `extends`, `description`, `tokens`, `notes` (why a value is what it is) |
| Layer | Token values for a scope (user, project, item); may pick the base theme with `extends` |
| Cascade | Defaults, shipped (or brought) theme chain, user, project, item, in-session overrides; last wins; a layer replaces a whole value; each resolved token records its layer, file and decision |
| Core reference | A branch value written `{core.<path>}` follows the resolved core token, so one palette change reaches every domain |
| Decisions log | Append-only JSON lines: the user's words verbatim, token changes with from and to, scope, evidence images, supersedes, status; written into the scope's layer as well; a project change made twice is offered for promotion |
| Assets | A registry of logos, wordmarks, icons, fonts and pattern files, each with hash, source, license and status |
| Examples | Captioned reference images (title, tags, copy, avoid) in each scope's `examples/` folder |
| Style guide | `STYLE.md`, generated for agents from the resolved style, never edited by hand |

Schema ids: core `protoboard.style.theme/v1` and `protoboard.style.layer/v1`; CAD `protoboard.cad-style.theme/v1` and
`protoboard.cad-style.layer/v1`; tokens `protoboard.style.tokens/v1`; decisions `protoboard.style.decision/v1`;
assets `protoboard.style.assets/v1`; the resolver's output `protoboard.style.resolved/v1`.

Paths (`<config>` resolved exactly as `packages/board-style/src/paths.ts` resolves it):

| Scope | Core | CAD | PCB (board-style) |
| --- | --- | --- | --- |
| user | `<config>/style/theme.json` | `<config>/cad-style/theme.json` | `<config>/pcb-style/theme.json` |
| project | `<project>/style/theme.json`, with `assets/`, `examples/`, `decisions.jsonl` | `<project>/style/cad/theme.json` | `<project>/style/pcb/theme.json` |
| item | none | `<module folder>/style.json` | `<board folder>/style.json` |
| brought themes | `themes/<id>.json` beside `theme.json` in the user or project folder | same | not searched |

The nearest layer naming a base theme with `extends` picks it; otherwise `hazard-protocol`. Core and each branch
choose their base on their own.

## 3. Core versus domain

| Concern | Core | CAD branch | PCB branch | Why |
| --- | --- | --- | --- | --- |
| Identity words, reference images | yes | reads core | own examples | the look is one look |
| Palette roles | yes: accent, N-scale, body, ink, muted, warning | `color.*` reference core | preview colors; orange cannot print in standard silk | roles transfer, media differ |
| Typography | faces, weight, font files | `text.font` references core | stroke font only (v1) | one face family |
| Voice | tag case, description case, callout routing | `text.case` references core | uppercase tags already | one way of labeling |
| Marks, brand mode | logo, wordmark, clear space, house/client/neutral | `marks.logo` references core | polygon marks, own `brand.mode` | one mark, one representation per medium |
| Decisions, promotion, assets, examples | the format and rules | `D-CAD-` ids | `D-PCB-`, `D-USR-` ids | one memory mechanism |
| Classes | `cosmetic`, `brand` | `process`, `structural`, `layout`, `cosmetic` | `fab`, `electrical`, `placement`, `cosmetic` | policies are per medium |
| Manufacturing bounds | none | formulas over the DFM profile | fab profile floors in code | limits are per process |
| Form, radii, patterns, splits, fasteners | no | yes | no | 3D only |
| Frames, hazard stripes, designators, nameplate | no | no | yes | silkscreen only |

## 4. Mapping board-style into the model

Already neutral in board-style: the token definition shape and value kinds, theme and layer
files with canonical serialization and `extends`, the cascade with source tracing and overrides, `explainToken`, the
decisions log with supersede and promotion, captioned examples, the asset registry with hash, source and license,
the `STYLE.md` skeleton, the change-set and provenance pattern, and the rule that a guard clamps the effective value
and keeps the value.

PCB-specific: the token list and its enums, the four class names, fab profiles and guards, the drawing tools, check
and render, the decision prefix `D-PCB-`, and the place names.

Differences to reconcile later (none needs a change to board-style now):

- **Paths and names:** board-style uses `<config>/pcb-style` and `<project>/style/pcb`; this model adds
  `<config>/style` (core), `<config>/cad-style`, `<project>/style` and `<project>/style/cad`. The user folder
  naming (`pcb-style`, `cad-style` beside `style`) differs from the project naming (`style/pcb`, `style/cad`); it is
  kept to match board-style.
- **Themes by id:** board-style finds themes only among its shipped ones or in memory, so a user's own theme file is
  reachable only as a layer. This resolver also finds `themes/<id>.json` in the project's and the user's folders
  (project first).
- **Core references:** board-style has no core; its preview colors and fonts are its own tokens. Mapping it means
  pointing them at `{core.…}` tokens.
- **Decision lines:** board-style declares a decision schema id but writes none into each line; this model writes
  `schema` on every line.
- **Bounds:** board-style computes floors in code from a fab profile; this model writes them as formulas in the token
  list, so a branch without code is still bounded by its process.

## 5. The CAD branch

69 tokens in `packages/ext-style/themes/cad/tokens.json`: 30 `process`, 4 `structural`, 6 `layout`, 29 `cosmetic`.
They cover the form language (`form.language`, edge treatments, chamfer angle, chamfer ladder, bed chamfer and its
angle, edge break, plan-view radius family, inside radius, the nested-corner rule, when the vocabulary may break,
curvature continuity, proportion aid), layout (margin, gutter, near-miss distance, symmetry, datums, heights on layer
multiples, split placement), splits and seams (style, reveal width and depth, seam placement, show face), fasteners
(visibility, head, number of kinds), text and marks (face and case referencing core, style, minimum cap height and
stroke, emboss height, engrave depth, logo, placement, height, clear space), patterns (default, zone border, pocket
ceiling span, blind depth, structural claim, isogrid cell, rib width and depth, skin, backing, corner rule, node
circles, orientation, small-pocket rule; Voronoi strut, cell, corner rule, relaxation; hex cell and wall), structure
(wall preference, load root fillet, keep load paths) and color, material and finish (body, secondary and accent
referencing core, surface finish, material look, default process).

The `cad-style` SOP resolves the CAD style with the DFM profile, applies the form language consistently, lays out on
shared datums and margins, plans splits and seams, fasteners, text and marks, bounded patterns, and color, material
and finish, then runs a self-check that reports drift and never blocks, and records any "I'd rather" as a decision.

Today's enclosure generator (ext-enclosure-cad) makes box or round shells with opening corner radii and joint
styles, and no chamfers, ribs or patterns; the SOP applies what a provider exposes and reports the rest as not
applied rather than editing provider-owned files.

## 6. Style versus DFM: the balance rule and its mechanism

**Style proposes; the manufacturing limit sets the effective value; the agent reports where a preference was
adjusted.** The DFM system states the same rule from its side (dfm-system.md, section 3).

Mechanism:

1. A `process` token may carry a `floor` or `ceiling`: a formula over the resolved DFM profile's paths
   (`2 * line.width`, `90 - overhang.max.angle`, `bridge.max.span`). The formula language is numbers, paths,
   `+ - * /`, parentheses, `min`, `max` and `round`, parsed by a small evaluator (no `eval`). Allowed paths are the
   dfm resolver's contract: `machine.nozzle`, `layer.height`, `line.width`, `wall.min`, `wall.structural`,
   `wall.unit`, `overhang.max.angle`, `bridge.max.span`, `text.min.height`, `text.min.stroke`, `text.emboss.height`,
   `text.engrave.depth`, `chamfer.bed.edge`, `clearance.sliding.side`, `feature.min.gap`.
2. The style resolver takes `--dfm <resolved profile>` (`protoboard.dfm.resolved/v1`). For each bounded token it
   records the bound, the DFM inputs with their status and source, and either `met` or `applied`; the token keeps
   `value` and gets `effective`; `adjusted` lists every moved preference with its reason.
3. Without a profile the resolver reports those tokens as not checked against a process; it never invents limits.
4. A `structural` token is never changed for looks. A user who insists on a value below a limit overrides it through
   the DFM system, which records a waiver in the profile; the style resolver then reads the waived value.
5. The DFM skill reads the style through this resolver's JSON (`tokens.<path>.effective` and `adjusted`), which
   answers the DFM spec's open question on how style values reach its balance step.

Checked against the shipped FDM profile on 2026-11-12: every path above resolves, and the Hazard Protocol CAD
theme resolves with no preference adjusted.

## 7. Adding a domain branch

1. Write `themes/<domain>/tokens.json` with the branch's tokens, its classes and their policies, and any bounds over
   its process profile.
2. Ship `hazard-protocol` and `neutral` themes with a note for every number.
3. Add the domain to the resolver's table (schema ids, decision prefix, user and project folders, item layer) and its
   tests.
4. Write the branch's SOP: resolve first, apply through the domain's own tools, self-check without blocking, record
   decisions.
5. Reference core tokens for colors, faces, case and marks rather than copying them.

Named future branches, not built: documents (ext-docs keeps its own house style in `doc.css` and a reference page),
renders (the Hazard Protocol render style guide in the Blender protocols, where the name comes from), packaging
(nothing yet), and UI (`packages/views/src/theme.ts`).

## 8. Migration path

1. Now: this extension is data, SOPs and a small resolver in plain Node. board-style is untouched and keeps its own
   resolver.
2. When board-style settles: extract a shared `@protoboardai/style` core library from it (token schema and value
   checks, theme and layer files with canonical serialization, the cascade with source tracing, decisions and
   promotion, examples, assets, the style guide generator), make board-style the PCB branch on top of it, and move
   this resolver's domain table, core references, theme search and formula bounds into it.
3. Then bind the style tools to the CLI and MCP (board-style's `STYLE_API` shape), add a decision-recording tool, and
   generate `STYLE.md` per domain.
4. Point board-style's preview colors and future display font at core tokens, and its user folder at the same scheme.

## 9. Open questions

1. Decided (2026-11-12, by the project maintainers): Hazard Protocol is the default style in every domain, and it stays selectable:
   a user, project or item layer may name another theme with `extends`. The render guide still calls it a selected
   style for renders; that guide should be brought into line with this decision.
2. The render guide's mood rules discourage rounded, friendly shapes, while the house 3D look rounds plan-view
   corners. Is the 3D look an intended exception, or should the render guide be updated?
3. Should choosing `neutral` for one branch switch core too? Today each picks its base on its own.
4. Should the user folder for core be `<config>/style` beside `<config>/pcb-style` and `<config>/cad-style`, or
   should every domain move under `<config>/style/<domain>` to match the project layout?
5. Which house values do the project maintainers confirm? The form language, the isogrid conventions, no proportion systems and
   FDM as default are stated; the radius family, chamfer ladder, fastener heads, emboss over engrave and the show face
   are starting values labeled as assumptions.
6. Should the house logo be converted to board-style's polygon format so the PCB branch draws the real mark?
7. Where do decisions about parts that are not module folders (an external CAD document) live? Today the project
   layer.
