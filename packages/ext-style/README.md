# @protoboardai/ext-style

The style system for agents: one house style across every domain, with a branch per domain. It guides the agent on
how to style what it makes. It comes preloaded with the Protoboard house style, **Hazard Protocol**, and the user can
tune it, adjust it, or bring their own.

- **Core** (domain neutral): identity words and reference images, the palette (Hazard Orange accent on N-scale
  neutrals), typography, voice (uppercase tags, orthogonal callouts), marks and fonts in an asset registry, examples
  and the decisions log.
- **Branches**: `cad` (this package: form language, radii and chamfers, layout, splits, fasteners, text, patterns,
  color and finish) and `pcb` (`@protoboardai/board-style`). Documents, renders, packaging and UI keep their own
  styles today and are named as future branches.
- **Style and DFM**: style proposes, the manufacturing limit sets the effective value, and the agent reports where a
  preference was adjusted. CAD tokens carry floors and ceilings as formulas over the resolved DFM profile.

The design is in `docs/specs/style-system.md` in the Protoboard Stack repository.

## Contents

| Path | What |
| --- | --- |
| `themes/core/tokens.json`, `hazard-protocol.json`, `neutral.json` | core token definitions and the two shipped core themes |
| `themes/cad/tokens.json`, `hazard-protocol.json`, `neutral.json` | 69 CAD tokens (process, structural, layout, cosmetic) and the two shipped CAD themes |
| `assets/registry.json` | the shipped asset registry: the repository's brand SVGs and the Kode Mono fonts, by relative path and SHA-256 |
| `skills/style-system/` | the universal SOP, the model and domains references, the resolver, templates |
| `skills/cad-style/` | the 3D CAD branch SOP and its references (tokens, the house look, patterns, product design) |
| `test/resolve-style.test.ts` | the resolver's tests |

## The resolver

```bash
node node_modules/@protoboardai/ext-style/skills/style-system/scripts/resolve-style.mjs \
  --domain cad --project . --item src/enclosures/case --dfm dfm.resolved.json --format table
```

Options: `--domain core|cad`, `--project <dir>`, `--item <dir>` (CAD), `--user <config dir>` or `--no-user`,
`--set path=value` (repeatable; `core.<path>` sets a core token while resolving a branch), `--theme <id>`,
`--dfm <resolved DFM profile JSON>`, `--explain <path>`, `--format json|table`. Plain Node, no dependencies; it reads
files and never writes. The cascade, last wins: token defaults, the shipped theme chain, the user layer, the project
layer, the item layer, then `--set`. A theme is found by id in the project's `themes/` folder, then the user's, then
the shipped ones.

## Files a user or project keeps

| Scope | Core | CAD |
| --- | --- | --- |
| user | `<config>/style/theme.json`, `themes/`, `decisions.jsonl`, `assets/`, `examples/` | `<config>/cad-style/...` |
| project | `<project>/style/theme.json`, `themes/`, `decisions.jsonl`, `assets/`, `examples/` | `<project>/style/cad/...` |
| item | none | `<module folder>/style.json` |

`<config>` is the Protoboard config folder (`PROTOBOARD_CONFIG_DIR`, else `%APPDATA%\protoboard` on Windows, else
`$XDG_CONFIG_HOME/protoboard` or `~/.config/protoboard`).

## Built and not built

Built: token lists, shipped themes, the resolver with core references, bring-your-own themes, DFM floors and
ceilings, decision attribution and promotion candidates, asset checks, the two SOPs. Not built: writing decisions and
layers from a tool (the SOP does it by hand), a generated `STYLE.md` (a template ships), a geometric style checker for
CAD models, and the documents, renders, packaging and UI branches.
