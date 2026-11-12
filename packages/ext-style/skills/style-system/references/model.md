# The style model

One model for every domain, carried over from `@protoboardai/board-style` (the PCB branch, "a design system for
printed circuit boards, the way Tailwind is one for UI") and generalized: a shared core plus one branch per domain.
This page is the reference the **style-system** SOP points at. The design and its rationale are in the repository's
`docs/specs/style-system.md`.

## Tokens

A token is one typed style value with a dotted path. Each domain defines its tokens in
`themes/<domain>/tokens.json` (`protoboard.style.tokens/v1`):

| Field | Meaning |
| --- | --- |
| `path` | Dotted name, also the key in theme and layer files (`edge.chamfer.sizes`, `palette.accent`) |
| `class` | The policy the token follows (below) |
| `type` | `length` (mm, with `min`/`max`), `lengths` (a list of positive lengths), `number` (with `min`, `max`, `integer`, and a unit of `deg`, `share` or `count`), `enum` (one of `values`), `set`, `bool`, `color` (`#RRGGBB` or `#RRGGBBAA`), `text` (one line up to `max`), `texts` (a list), `asset` (`none` or an asset id) |
| `unit` | `mm`, `deg`, `share`, `count` or empty |
| `default` | The value with no theme: a plain, conventional result (assumption values, not house values) |
| `title`, `description` | Human text for explanations and the style guide |
| `guard` | What protects the token (process limits, load, fits), in words |
| `floor`, `ceiling` | Branch tokens only: a formula over DFM profile paths (below) |

Lengths are millimeters and angles degrees in every file. A value may instead be a reference to a core token,
written `"{core.<path>}"` (for example `"{core.palette.accent}"`); the resolver substitutes the core token's resolved
value and checks it against the referencing token's type. One change to the core palette reaches every branch that
references it.

## Token classes

Each class is a policy, as in board-style, where `fab`, `electrical`, `placement` and `cosmetic` are the PCB classes.

| Class | Domain | Policy |
| --- | --- | --- |
| `cosmetic` | core, cad | How things look. Free to change. |
| `brand` | core | Marks, fonts, brand mode: an asset token resolves only to a registered asset with a settled license; client work may turn house marks off with `brand.mode`. |
| `process` | cad | A preference bounded by what the process can make. It may carry a `floor` or `ceiling`; the token keeps its value, the effective value is the bound, and the resolved style says why. Without a DFM profile it is reported as not checked against a process. |
| `structural` | cad | Never changed for looks: a restyle refuses it, and a structural claim needs an analysis or a test. |
| `layout` | cad | Alignment, margins, datums, split placement: changed only when the user asks, because moving features changes fits and mates. |

How the classes line up with the PCB branch: `process` is PCB's `fab` plus the fab floors board-style puts on
cosmetic sizes; `structural` is PCB's `electrical` (both are refused for looks); `layout` is PCB's `placement`
(both only on request); `cosmetic` is `cosmetic`.

## Floors and ceilings: the style and DFM balance

Style proposes; the manufacturing limit sets the effective value; the agent reports where a preference was
adjusted. A `process` token names its limit as a formula over the resolved DFM profile:

```text
pattern.isogrid.rib.width   floor   2 * line.width
edge.chamfer.bottom         floor   chamfer.bed.edge
edge.chamfer.bottom.angle   floor   90 - overhang.max.angle
pattern.pocket.ceiling.span ceiling bridge.max.span
```

The formula language is numbers, DFM paths, `+ - * /`, parentheses, `min()`, `max()` and `round(x, digits)`. The
paths a formula may name are the DFM contract: `machine.nozzle`, `layer.height`, `line.width`, `wall.min`,
`wall.structural`, `wall.unit`, `overhang.max.angle`, `bridge.max.span`, `text.min.height`, `text.min.stroke`,
`text.emboss.height`, `text.engrave.depth`, `chamfer.bed.edge`, `clearance.sliding.side`, `feature.min.gap`. A list
value is bounded element by element. The resolver reads the DFM values (with their own status and source) from the
dfm resolver's output (`protoboard.dfm.resolved/v1`) and records them beside the bound, so the report says which
process number moved which preference.

## Themes

A theme is a named, shipped or brought set of token values: `protoboard.style.theme/v1` (core) or
`protoboard.cad-style.theme/v1` (cad), PCB's being `protoboard.board-style.theme/v1`.

```json
{ "schema": "protoboard.cad-style.theme/v1", "id": "workshop", "name": "Workshop", "extends": "hazard-protocol",
  "description": "What it looks like, in plain words.", "tokens": { "layout.margin": 5 }, "notes": { "layout.margin": "Why." } }
```

`id` is lowercase letters, digits and hyphens; `extends` names a base theme (the chain is walked base first, cycles
are refused); `notes` say why a value is what it is. Unknown fields are refused. The shipped themes are
`hazard-protocol` (the house style, the default) and `neutral` ("Conventional") in each of core and cad.

## Layers and the cascade

Resolution, lowest to highest (last wins), the same order as board-style with the board layer generalized to an item:

1. token defaults;
2. the shipped (or brought) theme and the themes it extends, base first;
3. the user layer;
4. the project layer;
5. the item layer (a module's own folder; branches only);
6. in-session overrides (`--set`, a correction being previewed; never written).

A layer file is `protoboard.style.layer/v1` or `protoboard.cad-style.layer/v1`: optional `extends`, `tokens`, `notes`.
The nearest layer that names a base theme with `extends` picks it; otherwise `hazard-protocol`. Core and each branch
pick their base on their own. A layer slot may hold a full theme file; it is read as a layer over that theme's base.
A layer replaces a whole token value (a list is never merged). Every resolved token records the `layer`, the `file`,
the shipped `theme` id when shipped, and the `decision` that set it (the newest accepted, live decision of that
scope whose value equals the layer's).

## Paths per scope and domain

`<config>` is the Protoboard config folder: `PROTOBOARD_CONFIG_DIR`, else `%APPDATA%\protoboard` on Windows, else
`$XDG_CONFIG_HOME/protoboard` or `~/.config/protoboard` (exactly as board-style's `paths.ts`). `<project>` is the
folder holding `protoboard.config.ts`.

| Scope | core | cad | pcb (board-style today) |
| --- | --- | --- | --- |
| user layer | `<config>/style/theme.json` | `<config>/cad-style/theme.json` | `<config>/pcb-style/theme.json` |
| user themes | `<config>/style/themes/<id>.json` | `<config>/cad-style/themes/<id>.json` | not searched (in memory only) |
| project layer | `<project>/style/theme.json` | `<project>/style/cad/theme.json` | `<project>/style/pcb/theme.json` |
| project themes | `<project>/style/themes/<id>.json` | `<project>/style/cad/themes/<id>.json` | not searched |
| item layer | none | `<module folder>/style.json` | `<board folder>/style.json` |
| decisions | `decisions.jsonl` beside each user or project layer (item decisions in the project's log) | same | same |
| assets | `<config>/style/assets/`, `<project>/style/assets/` (shared by every domain) | core's | `pcb-style/assets`, `style/pcb/assets` |
| examples | `examples/` beside each layer | same | same |

## Decisions

The decisions log is the memory that grows when the user says "I'd rather it look like this". One JSON line per
decision, appended and never edited:

| Field | Meaning |
| --- | --- |
| `schema` | `protoboard.style.decision/v1` (board-style declares a schema id but does not write it; this branch writes it) |
| `id` | `D-CAD-0001` (cad) or `D-STYLE-0001` (core), counting up per file; PCB uses `D-PCB-` and `D-USR-` |
| `date` | YYYY-MM-DD, from the session, never from file times |
| `domain`, `scope` | the domain; `item`, `project` or `user` |
| `item` | the item key for item decisions (the module folder relative to the project, separators as `__`) |
| `said` | the user's words, verbatim |
| `source` | where the words came from (a session, a review comment), when known |
| `tokens` | `[{ "path", "from", "to" }]` |
| `rule` | a rule that is not a token, read with the style guide |
| `evidence` | before and after image paths |
| `supersedes` | earlier decisions this one replaces |
| `status` | `accepted` or `proposed` |
| `promotedFrom` | for a user decision promoted from projects: `<project root>#<id>` entries |

Recording a decision also writes its token values into the scope's layer file, so the cascade picks them up. A
project change made twice (here or in another project listed in the user folder's `projects.json`) is offered for
promotion to the user layer; promotion is the user's call.

## Assets

`assets/registry.json` (`protoboard.style.assets/v1`) lists every logo, wordmark, icon, font or pattern file with
`id`, `kind`, `format`, `file` (relative to the registry), `sha256`, `source`, `license` (an SPDX id,
"proprietary (owner's own mark)", or "unknown"), `status` (`placeholder`, `ok`, `unresolved`, `traced`), `traced` and
the `domains` it suits. Registries resolve project over user over shipped, by id. The resolver reports an asset token
whose file is missing, whose hash does not match, or whose license is unresolved. A domain may need its own
representation of an asset (board-style uses polygon files for silkscreen; CAD embosses an outline); keep each
representation as its own registered file with the same source.

## Examples

An `examples/` folder holds reference images (`png`, `jpg`, `jpeg`, `webp`, `svg`), each with a caption file
`<name>.md`: front matter `title`, `tags`, `copy`, `avoid`, then free text. The agent searches the shipped theme's,
the user's and the project's folders and opens the images whose captions match the task.

## The style guide

`STYLE.md` is the agent-facing guide a project may generate from the resolved style, the decisions and the
examples (board-style generates one; this branch ships the skeleton in [the template](../templates/STYLE.md)). It is
generated, never edited by hand: change a token or record a decision, then regenerate.
