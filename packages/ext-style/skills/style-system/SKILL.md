---
name: style-system
description: Find and resolve the style for any domain (core, 3D CAD, PCB), explain why a token has its value, apply it through the domain's own skill, record a decision when the user says "I'd rather it look like this", promote a repeated project decision, add an asset or example image, bring or author a theme, and report style drift without ever blocking. Use before styling anything; the CAD branch is cad-style.
---

# Style system

The style system guides the agent on how to style what it makes. It ships preloaded with the house style,
**Hazard Protocol**, and the user can tune it, adjust it, or bring their own. One shared core (identity, palette,
typography, voice, marks, examples, decisions) carries across every domain; each domain branch adds the tokens,
classes and guards that only make sense there (3D CAD has its own; PCB silkscreen has very different ones).

```text
core theme (palette, type, voice, marks)        <- {core.<path>} references
   |                \
   cad branch        pcb branch (board-style)     documents, renders, packaging, UI (not yet connected)
   |
defaults < shipped theme chain < user < project < item < session overrides   (last wins)
   |
effective value = preference, bounded by the DFM floor or ceiling (the reason is reported)
```

Style is personal and flexible; manufacturing is not. Style proposes a value, the process limit sets the effective
value, and the agent tells the user where a preference was adjusted. The model is in
[the model reference](references/model.md); the branches are in [the domains reference](references/domains.md).

## Purpose

Resolve the style that applies to the thing being made, read why each value is what it is, hand it to the domain's
skill that applies it, and keep the style's memory: decisions the user states, promotions of repeated decisions,
assets, example images and themes. Use it when you are about to style anything (a part, an enclosure, a board's
silkscreen, a document), when the user states a style preference, asks why something looks the way it does, wants a
different look, or brings their own theme, logo, font or reference image. Do not use it for manufacturing limits;
those are **dfm** and **dfm-3d-printing**. In **build-a-project** it runs before each design stage that has a look
(enclosures and structures with **enclosure-cad** and **frame-cad**, boards with **circuit-board**, documents with
**uhd-tech-docs**), and again whenever the user corrects the look.

## Inputs

| Input | Where | From |
| --- | --- | --- |
| The domain | core, cad (this package); pcb is board-style | the task |
| Shipped themes and token lists | `node_modules/@protoboardai/ext-style/themes/<domain>/` | this package |
| User layers | `<config>/style/theme.json` (core), `<config>/cad-style/theme.json` (cad); `<config>` as the CLI resolves it | the user, or this SOP's step 6 |
| Project layers | `<project>/style/theme.json` (core), `<project>/style/cad/theme.json` (cad), `<project>/style/pcb/theme.json` (pcb) | this SOP |
| Item layer | `<module folder>/style.json` (cad) | this SOP |
| Themes brought by the user | `themes/<id>.json` beside `theme.json` in the user or project style folder | the user, or step 9 |
| Decisions, assets, examples | `decisions.jsonl`, `assets/registry.json`, `examples/` in each style folder | this SOP |
| A resolved DFM profile (for branches with floors) | the output of the dfm resolver, `protoboard.dfm.resolved/v1` | **dfm** |

## Steps

### 1. Name the domain and its branch

Decide what is being styled and which branch owns it, from [the domains reference](references/domains.md):

| Domain | Branch | Applied by |
| --- | --- | --- |
| core (palette, type, voice, marks) | this package | every branch |
| cad (parts, enclosures, frames) | this package | **cad-style**, inside **enclosure-cad** or **frame-cad** |
| pcb (silkscreen, mask, finish) | `@protoboardai/board-style` | **circuit-board** (the library's tools are not bound to the CLI yet) |
| documents | the house style of ext-docs (not connected) | **uhd-tech-docs** |
| renders, packaging, UI | not connected | read the core tokens only |

For a domain that is not connected, still resolve core (step 2) and use its palette, type, voice and marks.

### 2. Resolve the style

```bash
node node_modules/@protoboardai/ext-style/skills/style-system/scripts/resolve-style.mjs --domain cad --project . --dfm <resolved dfm profile>.json --format json
# core only:   ... --domain core --project .
# one module:  ... --domain cad --item src/enclosures/<module>
# in an npm workspace (the stack's examples) node_modules is the workspace's: ../../node_modules/@protoboardai/...
```

Read in the JSON:

- `theme.chain` and `theme.where`: the base theme and where it came from (shipped, user, project).
- `tokens.<path>`: `value` (what the winning layer set), `effective` (what to use), `layer`, `file`, `decision`,
  `ref` (a core token it follows), `check` (`ok`, `adjusted`, `not-checked`, `unknown`) and `reason`.
- `adjusted`: every preference the process moved, with the reason. Tell the user about each one.
- `dfm.checked`: false means no process was checked; say so when you report.
- `assets`: a mark or font that is missing, unverified or has an unresolved license.
- `promotion`: project decisions made twice (step 7). `warnings`: anything the resolver could not read.

Use `--format table` to read it yourself; keep `json` for decisions you take from it.

### 3. Read why a token has its value

```bash
node node_modules/@protoboardai/ext-style/skills/style-system/scripts/resolve-style.mjs --domain cad --project . --explain edge.chamfer.sizes --format table
```

The paragraph names the layer and file that set it, the decision, the core token it references, and any floor or
ceiling with its formula and the DFM values used. In a branch, `--explain core.<path>` explains a core token. Quote
this to the user when they ask why something looks the way it does.

### 4. Read the look before you design

Read `identity.words`, the theme's description, the `notes` of the theme files in `theme.chain`, every accepted
decision (rules that are not tokens are in `rule`), and the captions in each `examples/` folder (shipped, user,
project); open the images whose captions match the task. When a project has a `STYLE.md` (generated from
[the STYLE.md template](templates/STYLE.md)), read it first.

### 5. Apply it through the domain's skill

Hand the effective values to the branch's procedure: **cad-style** for parts, enclosures and frames; for boards,
**circuit-board** with board-style's tokens. Never restate a domain's rules here, and never copy a process number
into a style file: style tokens point at DFM paths through their floors and ceilings.

### 6. Record a decision when the user states a preference

When the user says "I'd rather it look like this" (or shows an image):

1. Restate it as token changes, or as a rule when no token fits. Check each token's class
   ([the model reference](references/model.md#token-classes)): a `structural` token is never changed for looks
   (refuse and explain); a `layout` token moves features, so change it only because the user asked; a `process`
   token keeps its floor, so tell the user when the new value will be raised or lowered.
2. Preview with `--set <path>=<value>` (nothing is written) and show the user the effect.
3. Ask the scope unless it is obvious: this item, this project, or all their work (user).
4. Append one JSON line to the scope's `decisions.jsonl` (format: [the decision example](templates/decision.example.jsonl)):
   the user's words verbatim in `said`, `tokens` with `from` and `to`, `scope`, `item` for an item decision,
   `evidence` image paths, `supersedes` (earlier live decisions of the same scope that set the same token), `status`
   `accepted`, today's date. The id is the next `D-CAD-0001` (cad) or `D-STYLE-0001` (core) in that file.
   Item decisions go in the project's log.
5. Write the same values into the scope's layer file (`theme.json`, or the item's `style.json`) from
   [the layer template](templates/layer.json). A layer replaces a whole value: write the full list or value.
6. Resolve again: the token's `layer` is the scope and its `decision` is the new id.

### 7. Offer to promote a repeated project decision

When `promotion` lists a candidate (the same token and value in two live project decisions, here or in another
project listed in the user folder's `projects.json`), ask the user whether it should apply to all their work. Only
on a yes: record a user-scope decision with `promotedFrom` naming the project decisions, and write the value into the
user layer. Promotion into a shipped theme is a release decision for the maintainers, never this SOP.

### 8. Add an asset or an example image

- **Asset** (logo, wordmark, icon, font, pattern file): copy the file into the scope's `assets/` folder, compute its
  SHA-256, and add an entry to `assets/registry.json` with `id`, `kind`, `format`, `file`, `sha256`, `source`,
  `license` (an SPDX id, "proprietary (owner's own mark)", or "unknown"), `status` (`ok`, or `unresolved` when the
  license is not settled), `traced` (true when traced from a raster image) and `domains`. Then point a token at the
  id (`marks.logo`, `type.font.display`) by decision (step 6). An unresolved or unverified asset is reported by the
  resolver and never placed.
- **Example image**: put `<name>.png` (or jpg, webp, svg) in the scope's `examples/` folder with `<name>.md` beside
  it: front matter `title`, `tags`, `copy` (what to copy), `avoid` (what not to), then free text. Add the file name
  to `identity.references` when it defines the look.

### 9. Bring or author a theme

Copy [the theme template](templates/theme.json) to `themes/<id>.json` in the user's or the project's style folder
(`<config>/cad-style/themes/`, `<project>/style/cad/themes/`, `<config>/style/themes/`, `<project>/style/themes/`).
Set `id` (lowercase, digits, hyphens; the file name without `.json`), `name`, `description` (read like the shipped
ones: what it looks like, in plain words), `extends` (a base theme id, or leave it out for a complete theme), and the
tokens that differ. Then name it in the scope's layer (`"extends": "<id>"`) and resolve: `theme.chain` ends with
the new id and `theme.where` says where it was found. A theme in the project's folder wins over one with the same id
in the user's, which wins over a shipped one.

### 10. Report drift, never block

After the domain's skill has applied the style, compare the result with the resolved tokens and report each
difference as information or a warning with the token path, the expected and the actual value, and the layer or
decision that set the expectation. Style findings never block a build or a release. A DFM floor that the design
violates is not style drift: it is a manufacturing finding for **dfm-review**.

## Decision points

| Decision | Rule |
| --- | --- |
| Which base theme | The nearest layer (item, then project, then user) that names one with `extends`; otherwise hazard-protocol. Core and each branch choose their own base. |
| Scope of a new decision | Ask: item, project or user. Default to project when the user names this project's parts; user only when they say "always" or "everywhere". |
| A preference under a DFM floor | Keep the user's value in the layer; use the effective value; tell the user the floor, its formula and the DFM values behind it. Never edit the DFM profile to make a style fit; send that to **dfm**. |
| No DFM profile | Resolve anyway; report process tokens as not checked; ask **dfm** for a profile before final geometry. |
| A structural token in a style request | Refuse it for looks and say why; a structural change needs an analysis or a test. |
| A layout token | Change it only when the user asked for the move; it changes fits and mates. |
| Proportion systems | Off by default in the house style; offer one only as an optional diagnostic when the user asks how proportions read. |
| An asset with an unknown license | Register it as `unresolved`; do not place it; ask the user for the license. |
| Promotion | Only after the user agrees; never into a shipped theme. |
| A domain with no branch | Use the core tokens; record decisions in the core log; do not invent a branch's token list. |

## Outputs

| Output | Where |
| --- | --- |
| Resolved style (read only, never saved as a source) | the resolver's JSON or table on stdout |
| Layers | `<config>/style/theme.json`, `<config>/cad-style/theme.json`, `<project>/style/theme.json`, `<project>/style/cad/theme.json`, `<module folder>/style.json` |
| Decisions (append only, never edited) | `decisions.jsonl` beside each user or project layer |
| Themes brought or authored | `themes/<id>.json` in a user or project style folder |
| Assets and examples | `assets/registry.json` plus files, `examples/<name>.<ext>` plus `<name>.md` |
| Style guide (optional) | `<project>/style/STYLE.md` or `<project>/style/cad/STYLE.md` from [the template](templates/STYLE.md) |

## Verification

```bash
node node_modules/@protoboardai/ext-style/skills/style-system/scripts/resolve-style.mjs --domain cad --project . --format json
```

It exits 0 and prints JSON when every layer, theme and decision file is valid. Then check:

- a decision you recorded shows as the `decision` of its tokens, and its tokens' `layer` is its scope;
- `adjusted` lists every preference the process moved, and you told the user about each;
- `assets` is empty, or each listed asset is unplaced and explained;
- `npx protoboard check --format json` still passes for the project (style files are outside the model, so a new
  error here comes from the domain skill's changes, not from style).

## Failure handling

| Code or symptom | Means | Do |
| --- | --- | --- |
| exit 2, `unknown cad token <path>` | a layer or theme names a token the branch does not define | Fix the path (see the branch's token reference) or move a core token to the core layer |
| exit 2, `schema must be protoboard.cad-style.layer/v1` | a core layer in the CAD folder, or the other way round | Use the schema of the folder's domain |
| exit 2, `names no core token` | a `{core.<path>}` reference is misspelled | Fix the path; `--domain core --format table` lists the core tokens |
| exit 2, `resolves to ..., which does not fit` | a reference points at a core token of another type | Reference a token of the same type (a color to a color) |
| exit 2, `no cad theme <id>` | `extends` names a theme that is in no themes folder | Add `themes/<id>.json` (step 9) or fix the id |
| exit 2, `extends itself` | two themes extend each other | Break the loop |
| exit 2, `not a resolved DFM profile` | the `--dfm` file is not the dfm resolver's output | Ask **dfm** for the resolved profile JSON |
| `check: unknown` on a token | the DFM profile lacks a path the formula needs | Report the token as unchecked; ask **dfm** to fill the path |
| `warnings: decisions not read` | a `decisions.jsonl` line is not a decision | Fix the named line; never rewrite other lines |
| an asset listed in `assets` | missing file, hash mismatch, or unresolved license | Re-register the file with its hash and license, or leave the mark off |

## Hard rules

1. Style never overrides a manufacturing limit; the effective value is the process's, and the agent reports the
   adjustment.
2. Decisions are appended, never edited; a change supersedes an earlier decision by naming it.
3. The user's words are recorded verbatim; the agent's restatement goes in `tokens` and `rule`.
4. Shipped themes are never edited in a project; a user's look lives in their layers and themes.
5. Nothing here orders, uploads, prints or starts a machine.
