# @protoboardai/board-style

A design system for printed circuit boards, the way Tailwind is one for UI: a theme of typed tokens that ships with
Protoboard and that the agent uses by default, a cascade where the user, the project and the board change it, tools
that draw the theme on a board through the board core's operations, a style check that reports drift and never
blocks, and a decisions log that grows when the user says "I'd rather it look like this". Version 1 is for agents:
there is no theme editor screen yet.

```ts
import { resolveStyle, planRestyle, proposeStyleChange, checkStyle, applyCorrection, renderAsBuilt } from "@protoboardai/board-style";

const style = resolveStyle({ doc, dir: boardDir });            // every token, with the layer and decision that set it
const plan = planRestyle(doc, style, { nameplate: { rev: "2" } }); // change sets, in order, planned on a scratch copy
for (const cs of plan.steps) proposeStyleChange(svc, cs);        // a person accepts each proposal
checkStyle(doc, style).summary.line;                             // "style Hazard Protocol: 0 drift warnings, 0 fab errors, ..."
renderAsBuilt(doc, style, { side: "bottom" });                   // SVG of the side as the fab makes it
```

## Tokens

Each token has a path, a class, a typed value with units and allowed values, and a default (a plain board). Lengths
are millimeters in tokens and files; tools convert to the board's nanometers.

| Class | What it is | Guard |
|---|---|---|
| `fab` | mask, silkscreen and finish the fab makes (`fab.mask.color.top`, `fab.finish`, ...) | must be offered by the fab profile (JLCPCB, CircuitHub); mask color sets the minimum mask web, checked against fine-pitch pads; finish has a cost class |
| `electrical` | style preferences that change copper (`copper.angle`, `copper.widthLadder`, ...) | never changed for looks: a correction refuses them |
| `placement` | alignment to a grid or frames (`placement.grid`, ...) | only when asked, before routing unless told otherwise; moves that lengthen a critical net past a limit are reported, not made |
| `cosmetic` | type classes, frames, hazard pattern, designator policy, nameplate, edge text, marks | printable sizes are floored at the fab's minimums (the token keeps its value; the effective value is the floor, and the resolved style says why) |

`TOKENS` lists them all; `explainToken(style, path)` says why one has its value.

## Themes and the cascade

A theme is a deterministic, hand-editable JSON file (`protoboard.board-style.theme/v1`: id, name, extends,
description, tokens by path, notes). Three ship in `src/themes/`:

- `hazard-protocol` (the default): matte black mask, white silkscreen, ENIG; 45 degree chamfered group frames with
  knockout title tags; one stripe pattern (0.45 mm stripes and gaps at 45 degrees, no outline) used only on declared
  no-go zones; sparse designators where a person at the bench needs them; a bottom nameplate with name and revision,
  no date, a decorative barcode and crosshairs; an edge text ring on round boards; marks are placeholders.
- `neutral` ("Conventional"): green mask, lead-free HASL, every designator that fits, plain text, name, revision and
  date on top.
- `arcade`: a playful theme (purple mask, rounded frames, text all around the edge, an easter egg) that extends
  `neutral`.

Resolution order: token defaults, the shipped theme (and the themes it extends), the user's layer
(`<config folder>/pcb-style/theme.json`), the project's (`<project>/style/pcb/theme.json`), the board's
(`<board folder>/style.json`), then in-memory overrides (a correction being previewed). A layer file
(`protoboard.board-style.layer/v1`) may name the base theme with `extends`; the nearest one wins.

## Tools

Each drawing tool returns a change set (`ops`, `provenance`, a report of what it added, changed, removed, kept and
skipped, with reasons). It never writes: an agent proposes it, a person accepts it. Records carry
`provenance.tool = board-style/<tool>`, so a re-run updates what the tool drew before (a second run on an unchanged
board is empty) and `removeStyle` takes it all off. A record a person edited by hand is kept and reported unless the
call says `force`.

| Tool | Draws |
|---|---|
| `styleFrames` | a frame around each UHD group's parts per side (offset from courtyards, around other parts, open along the board edge, corners per `frame.style`), titles as knockout tags or plain text |
| `styleHazard` | the stripe pattern on declared no-go keep-outs of the kinds in `hazard.zones`, with the kind's tag, clear of pads |
| `styleNameplate` | name and revision (date only when the theme asks and the call gives one), tag or plain, with decor |
| `styleEdgeText` | text runs along a round or straight outline, sliding around pads and parts |
| `styleMarks` | maker, company, open hardware (only when the call says so) and easter egg marks from the asset registry, and the motto |
| `styleDesignators` | the designators the policy shows, placed clear of pads, vias, silk and other parts |
| `alignParts` | only on request: footprint moves to the grid and rows, guarded by critical net length |

`planRestyle` runs them in that order (alignment excepted), each on the board the earlier ones leave. Footprints'
own reference texts leave the silkscreen when designators run; the board core has no operation for footprint texts
yet, so that part comes back as `hostOps` (`record.put`), which a host applies (`applyStyleChange`) and a
person-accepted proposal cannot carry.

## Style check

`checkStyle(doc, style)` returns `findings` (check ids `style.*`, warnings and information only: tool drift, missing
frames, hidden designators the policy wants, silkscreen on pads, designator sizes, odd-angle copper, widths off the
ladder, the fab record against the theme) and `guards` (check ids `style.fab.*`: text under the fab floor, a mask web
the fab cannot hold, a color or finish it does not offer are errors). `clean` means no guard errors and no style
warnings outside copper (the style tools never change copper).

## Memory: decisions, STYLE.md, examples, assets

- `applyCorrection(said, tokenChanges, ctx)`: the agent restates the user's words as token changes; this refuses
  electrical tokens changed for looks, lets fab floors act, renders before and after on a scratch copy, asks the
  scope (board, project, user) or, given one, records the decision and writes the tokens into that layer.
- `recordDecision`, `listDecisions`: an append-only `decisions.jsonl` per layer (board decisions go in the project's
  log); later decisions supersede earlier ones. `promotionCandidates` finds a project change made twice (here or in
  another project the user recorded decisions in); `promoteDecision` records it for all the user's boards after the
  person agrees.
- `writeStyleGuide`: `STYLE.md`, the agent-facing guide, generated from the resolved style, decisions, examples and
  assets.
- Examples: images in an `examples/` folder with `<name>.md` captions (title, tags, copy, avoid); `indexExamples`,
  `searchExamples`. Each shipped theme has renders of the synthetic Airnode C3 sample (also the golden images).
- Assets: `assets/registry.json` beside polygon files, each with its SHA-256, source, license and status. The
  shipped registry holds placeholders only; `registerAsset` adds the user's own marks to their layer. An unknown
  license is `unresolved` and is never drawn unless the call allows it.

## Binding

`STYLE_API` lists every tool for the CLI and MCP with its name, CLI command, title, description, zod input and what it
may change (`none`, `proposes`, or `files`: style files, never board files).

## Built and specified only

Built: everything above. Specified only (tokens carried and resolved, no tool acts on them): polygon fonts, arc corners
and teardrops, pour connection, via sizes and stitching, copper art, board corner dressing, polarity marks, the tick
bezel, SVG import for assets, full-color silkscreen export, and a theme editor screen.
