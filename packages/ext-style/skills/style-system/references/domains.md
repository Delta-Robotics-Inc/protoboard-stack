# Domains: the branches of the style system

The core carries what every domain shares; each branch adds what only makes sense in its own medium. This page says
which branches exist, where each one's style lives today, what carries over from the core and what does not.

## Which branches exist

| Branch | Status | Where it lives | Schema ids | Applied by |
| --- | --- | --- | --- | --- |
| core | built (this package) | `themes/core/` | `protoboard.style.theme/v1`, `protoboard.style.layer/v1` | every branch, by reference |
| cad | built (this package) | `themes/cad/` | `protoboard.cad-style.theme/v1`, `protoboard.cad-style.layer/v1` | **cad-style** inside **enclosure-cad** and **frame-cad** |
| pcb | built, separate | `@protoboardai/board-style` (`packages/board-style`) | `protoboard.board-style.theme/v1`, `protoboard.board-style.layer/v1` | the library's tools; boards follow **circuit-board** |
| documents | not connected | ext-docs house style: `packages/ext-docs/skills/uhd-tech-docs/references/house-style.md`, tokens in `packages/ext-docs/lib/templates/doc.css` | none (CSS custom properties) | **uhd-tech-docs** |
| renders | not connected | the Hazard Protocol render style guide in the Protoboard protocols collection (Blender, outside this repository) | none (a written guide with token roles) | the render procedures |
| packaging | not connected | nowhere yet | none | nothing yet |
| UI | not connected | `packages/views/src/theme.ts` (brand tokens mapped onto the viewer's tokens) | none (TypeScript) | the views |

Two more style rule books sit near these and are left as they are: the symbol pack's `packages/symbols/STYLE.md`
(with its own checker) and the 3D board viewer's default colors in `packages/board-3d/src/scene.ts`.

## What carries over and what does not

| Concern | Core (carries everywhere) | cad | pcb | documents, renders, UI |
| --- | --- | --- | --- | --- |
| Identity words, reference images, examples | yes | reads core | reads its own examples | reads core |
| Palette roles (accent, N-scale, body, ink, muted, warning) | yes | `color.*` reference core | preview colors only; the orange accent cannot print in standard silkscreen | the same roles, own syntax |
| Typography (faces, weights, font files) | yes | `text.font` references core | stroke font only in v1 | Kode Mono already |
| Voice (tag case, description case, callout routing) | yes | `text.case` references core | uppercase tags and titles already | callouts in renders and figures |
| Marks and brand mode | yes (asset ids, clear space, house/client/neutral) | `marks.logo` references core | own `brand.mode`, polygon marks | header logo, render marks |
| Decisions log, promotion, assets registry | yes (format and rules) | `D-CAD-` ids | `D-PCB-`, `D-USR-` ids | not connected |
| Token classes | `cosmetic`, `brand` | `process`, `structural`, `layout`, `cosmetic` | `fab`, `electrical`, `placement`, `cosmetic` | none yet |
| Manufacturing bounds | none | floors and ceilings over the DFM profile | fab profile floors (JLCPCB, CircuitHub) | none |
| Form (edges, radii, patterns, splits, fasteners) | no | yes | no (frames, hazard stripes, nameplate instead) | no |
| Silkscreen geometry (frames, designators, edge text) | no | no | yes | no |

What does not transfer, and why: a chamfer ladder means nothing on a silkscreen, a mask web means nothing on a
printed enclosure, and a document's type scale is in points while a part's text is a cap height in millimeters.
Only roles and names transfer: the accent is the accent everywhere, uppercase tags are uppercase everywhere, the logo
is the same file (in the representation each domain needs).

## Known differences between board-style and this model

- Paths: board-style's user folder is `<config>/pcb-style` and its project folder `<project>/style/pcb`; this model
  keeps those for PCB and adds `<config>/style` (core), `<config>/cad-style`, `<project>/style` (core) and
  `<project>/style/cad`. The PCB folder names already leave room for sibling domains.
- Themes by id: board-style finds a theme only among its shipped themes or in memory, so a theme file a user writes
  is reachable only as a layer. This branch also finds `themes/<id>.json` in the user's and the project's folders.
- Core references: board-style has no core; its accent and fonts are its own tokens. Mapping it into this model means
  pointing its preview colors and future display font at `{core.…}` tokens.
- Decision lines: board-style declares a decision schema id but does not write it into each line; this model writes
  `schema` on every line.
- Board-style computes bounds in code from a fab profile; this model writes them as formulas in the token list, so a
  branch without code (CAD today) can still be bounded by its process.

## Adding a branch

1. Write `themes/<domain>/tokens.json`: the branch's tokens, its classes with their policies, and any floors or
   ceilings over its process profile's paths.
2. Ship `hazard-protocol` and `neutral` themes for it, with notes for every number.
3. Add the domain to the resolver's domain table (schema ids, decision prefix, user and project folders, whether it
   has an item layer) and to the tests.
4. Write the branch's SOP, which resolves the style first and applies it through the domain's own tools.
5. Reference core tokens for every color, face, case and mark instead of copying them.
