# System Map: what the stack can do

Status: built and wired. The schema, the builder, the history reader and
the freshness check are in `packages/core/src/sysmap/`; `protoboard map`,
the `stack_map` MCP tool, the dev server's `/__protoboard/sysmap` route and
the System Map view use them (see [Wiring](#wiring) and [The view](#the-view)).

[Atlas](atlas.md) indexes one project's files. The System Map indexes the
stack itself: every package, extension, skill, capability and operation,
check, external tool, CLI command, MCP tool, view, template, example project
and doc, grouped into disciplines ("islands"), with the version of each
item, the last release it changed in, and the links between items. It
answers "what can Protoboard do for this job, and which pieces work
together", for people and for agents, without anyone keeping a list by hand.

Everything in it is read from the stack's own files. A fact the files do
not give is left empty and, where it matters, listed as a problem; nothing is
guessed.

## Where it lives

| Piece | Module |
|---|---|
| Types, the item types, link kinds, disciplines and their rule tables, `sysmapGraph` | `packages/core/src/sysmap/model.ts`, browser-safe |
| The text readers (frontmatter, code spans, the CLI's help and switch, MCP tool specs, view tabs, stages, release notes) | `packages/core/src/sysmap/parse.ts`, browser-safe |
| Release tags, what changed between them, a file at a tag | `packages/core/src/sysmap/history.ts` (`readHistory`, `historyFingerprint`) |
| Collecting the files, assembling items and links, writing the map | `packages/core/src/sysmap/build.ts` (`collectStack`, `buildSystemMap`, `writeSystemMap`, `serializeSystemMap`) |
| Reading a map back, freshness | `packages/core/src/sysmap/fresh.ts` (`readSystemMap`, `sysmapFreshness`) |
| The command, its queries | `packages/cli/src/sysmap.ts` (`protoboard map`, `stackRootOf`) |
| The dev server's route | `packages/cli/src/dev/sysmap.ts` |
| The view | `packages/views/src/sysmap/` (`SystemMapView`, `SystemMap`, its logic in `model.ts`), drawn by the Atlas's renderer (`packages/views/src/atlas/`) |
| VS Code | `packages/vscode-protoboard/src/systemMap.ts` (which stack, building it, opening a file), `systemMapPanel.ts` (the panel) |

## Read-only by design

The builder reads files and asks git (`rev-parse`, `for-each-ref`,
`ls-tree`, `diff --name-only`, `ls-files --others`, `show`); it never
checks out, fetches or writes. `writeSystemMap` writes one file, the map,
through a temporary file and a rename. A file that cannot be read is a
problem, never an exception out of the build.

## Stack roots

| Layout | Recognized by | Packages |
|---|---|---|
| `monorepo` | the root `package.json` has `workspaces` | every workspace folder, and every `packages/<name>/` with a `package.json` (the VS Code extension is built apart from the workspaces) |
| `installed` | a `node_modules/@protoboardai/` folder (for example a stack copy under `~/.protoboard/stack/<version>`) | every folder under `node_modules/@protoboardai/` |

Anything else is `STACK_NOT_FOUND`: an empty map with the problem listed.
Docs, release notes and example projects are read in the monorepo layout
only; an installed stack does not carry them.

## Items and where they are read from

| Type | Id | Read from | Version |
|---|---|---|---|
| `package` | `pkg:<npm name>` | each package's `package.json` (not extensions, not examples) | its own `version` |
| `package` (outside) | `pkg:@deltarobotics/<name>` | `@deltarobotics/*` dependencies of stack packages, and packages a manifest names as a skill's `package`; their installed `node_modules/<name>/package.json` | the installed copy's (`installed`); the toolchain pin in `protoboard.toolchain` is kept as `facts.pinned` |
| `extension` | `ext:<manifest id>` | `protoboard-extension.json` | the manifest's `version` |
| `skill` | `skill:<id>` | the manifest's `skills[]`, and the SKILL.md at its `path` (frontmatter, body) | frontmatter `version` if any, else the manifest's; a skill another package ships takes that package's installed version |
| `capability` | `cap:<id>` | `capabilities[]` of every manifest (one item per capability id, shared by its providers) | none |
| `capability-operation` | `capop:<ext id>#<cap>:<op>` | `capabilities[].operations` | the manifest's |
| `operation` | `op:<ext id>#<op>` | `operations[]` | the manifest's |
| `check` | `check:<ext id>#<check>` | `checks[]` | the manifest's |
| `tool` | `tool:<id>` | `tools[]` (one item per tool id, shared by every extension that declares it) | `runtime.packages` pins (`build123d 0.13.0`), else none |
| `cli-command` | `cli:<name>` | the cases of the top-level `switch (command)` in `@protoboardai/cli`'s `src/index.ts`, with the purpose and forms from the "Commands" section of its help text | the CLI package's |
| `mcp-tool` | `mcp:<name>` | the tool specs (`name`, `title`, `description`, `cliArgs([...])`) in `@protoboardai/cli`'s `src/mcp/tools.ts` | the CLI package's |
| `view` | `view:<id>` | `BUILTIN_TABS` in `@protoboardai/views`'s `src/tabs.ts` | the views package's |
| `template` | `template:<id>` | `templates/<id>/template.json` in any package | the shipping package's |
| `example` | `example:<folder>` | workspace folders holding `protoboard.config.ts` | its own `package.json` version |
| `doc` | `doc:<path>` | `docs/specs/*.md`, `docs/guides/*.md`, `docs/reference/*.md` (title from the first heading, purpose from the first paragraph, `Status:` as `facts.specStatus`) | none |

Every SOP is a skill (docs/guides/sop-format.md), so SOPs are counted once,
as skills. `versionFrom` says where each version came from: `own`,
`manifest`, `package`, `installed`, `none`, or `unreleased` (below).

The CLI's sources are read as text, by their formatting (the switch by its
indentation, the help text by its four-space command lines). A file whose
shape is not found is `SOURCE_UNPARSED`, and its items are missing rather
than guessed.

## Status and changes

When the stack root is in a git work tree with release tags
(`v<major>.<minor>.<patch>`), every item has a status and a last change:

- **status**: `released` when the item exists at the last release tag,
  `wip` when it was added since (its version is then `null`,
  `versionFrom: "unreleased"`), `outside` for what a package outside the
  stack ships.
- **changed**: `{ in, date?, why, from }`, the last release (or
  `"unreleased"`) in which the item changed. An item is compared through
  what defines it: its manifest entry, its SKILL.md and the files in its
  skill folder, its case and help line in the CLI, its spec in `tools.ts`,
  its registration in `tabs.ts`, its template folder, its package folder, its
  doc. A manifest whose version moved but whose entry did not leaves the
  entry's items unchanged. `why` is the line of a release-notes bullet
  (`docs/releases/*.md`, the section for that version or "Unreleased") that
  names the item, else what the history shows ("SKILL.md changed", "Its entry
  in protoboard-extension.json changed", "New in v0.2.2"). An item unchanged
  since the earliest tag says so.

Without history (no git, no tags: an installed stack), every item is
`released`, `changed` is `null`, and `HISTORY_UNAVAILABLE` says why.

## Stages

The stages are the `### <n>. <title>` sections under `## Steps` of the
build-a-project skill. An item's `stage` is the stage section that names it
most: skills in bold, CLI commands as `protoboard <command>` in code,
operations as `protoboard run <op>` (only when one extension declares that
operation). A mention in a table row counts half, because tables list where
prose hands work off; a tie goes to the earliest stage. `stages` lists every
stage that names the item. An extension's stage is the earliest of its
skills'; an operation, capability operation or check that no stage names
takes its extension's (`stageFrom` says which).

## Disciplines

The thirteen disciplines, in island order: project, research, parts,
system, pcb, cad, firmware, docs, mfg, simulation, packaging, protocols,
playbooks. Each item gets one, and `disciplineFrom` says how, in this order:

1. `declared`: a `discipline` field on the manifest or its entry (no
   manifest has one yet; an invalid value is `MANIFEST_INVALID`).
2. `stage`: the discipline of the item's stage, read from words in the stage
   heading (`STAGE_DISCIPLINE_RULES`: "Boards" is pcb, "Harness CAD" cad).
   An extension takes the majority of the stages that name what it ships,
   ties to the earliest stage.
3. `inherited`: an unstaged skill, operation or check takes its
   extension's; a capability its providers' majority; a tool the majority of
   what needs it; an MCP tool the majority of the commands it wraps.
4. `rule`: the classification tables in `model.ts` (`DISCIPLINE_RULES`), for
   items whose files say nothing: CLI commands, views, packages, templates,
   examples, and build-a-project itself (it spans every stage).
5. `links`: a doc takes the majority of the items it mentions, cites or is
   cited by, then of the docs it links to.

An item none of these resolves keeps `discipline: null` and is
`DISCIPLINE_UNRESOLVED`. A discipline no item resolves to is still reported,
as an empty island, with what the stack holds about it: protocols and
playbooks name `docs/specs/playbooks.md` and the missing `handbook/` and
`playbooks/` folders; simulation and packaging have nothing.

## Links

Each link is `{ from, to, kind, via }`, `via` the file the reference was
read from. Links are deduplicated by `(from, to, kind)`; self-links are
dropped.

| Kind | From → to | Read from |
|---|---|---|
| `ships` | package or extension → what it ships | manifests, the CLI and views sources, template folders |
| `declares` | extension → a skill another package ships | a manifest skill with `package` |
| `depends-on` | package or extension → package or extension | `dependencies`, `peerDependencies` |
| `provides` | extension → capability | `capabilities[]` |
| `operation-of` | capability operation → capability | `capabilities[].operations` |
| `needs` | extension, operation → tool | `tools[]`, `requires` |
| `verified-by` | skill → skill | `verifiedBy` |
| `refers-to` | skill → skill | a skill id in bold in the SKILL.md body |
| `runs` | skill → operation, capability operation or capability | `protoboard run <op>` in code; `<cap>:<op>` anywhere in the SKILL.md. The skill's own extension's operation first, else the only one; a capability operation several providers have resolves to the capability; a plain operation several extensions have is `REFERENCE_AMBIGUOUS` |
| `runs-command` | skill → CLI command | `protoboard <command>` in code |
| `calls` | skill → MCP tool | a code span that is exactly the tool's name |
| `wraps` | MCP tool → CLI command | `cliArgs(["<command>", ...])` in its spec |
| `serves` | CLI command → MCP tool | the command's case imports the module that imports `tools.ts` (`mcp` → `./mcp/server.js` → `./tools.js`) |
| `installs` | template → extension | `template.json` `extensions` |
| `derived-from` | template → example | `template.json` `derivedFrom` |
| `uses` | example → package or extension | its `package.json` dependencies |
| `cites` | skill, package (README), CLI command, MCP tool, doc → doc | a `docs/specs|guides|reference/<name>.md` path; relative markdown links between docs |
| `mentions` | doc → skill, extension, package, CLI command, MCP tool | bold skill ids, exact code spans, `protoboard <command>` in code |

A reference in code that names nothing (`protoboard frobnicate`, a
`requires` no manifest declares, a doc path that is not there) is
`REFERENCE_UNRESOLVED`. Bold words that are not skill ids (**minor**) and
qualified tokens whose prefix is not a capability (`node:fs`) are not
references and are ignored.

## Problems

| Reason | When |
|---|---|
| `STACK_NOT_FOUND` | the root is neither layout |
| `PACKAGE_UNREADABLE`, `MANIFEST_UNREADABLE`, `MANIFEST_INVALID` | a `package.json` or manifest cannot be read, has no id or name, an id that is not its package's, an invalid `discipline` |
| `VERSION_MISMATCH` | a manifest's version is not its `package.json`'s; one tool declared with different pins |
| `VERSION_MISSING` | a package or example has no version |
| `OUTSIDE_NOT_INSTALLED`, `OUTSIDE_VERSION_DRIFT` | an outside package is not installed; its installed version is not the toolchain pin |
| `SKILL_FILE_MISSING`, `SKILL_UNDECLARED`, `SKILL_NAME_MISMATCH`, `FRONTMATTER_MISSING` | a declared SKILL.md cannot be read; a skill folder no manifest declares (never installed); a frontmatter `name` that is not the declared id; no frontmatter |
| `DUPLICATE_ID` | two items with one id; the first is kept |
| `SOURCE_UNPARSED` | the command switch, the tool specs or `BUILTIN_TABS` not found |
| `CLI_UNDOCUMENTED`, `CLI_HELP_ORPHAN` | a command with no help line; a help line with no command |
| `REFERENCE_UNRESOLVED`, `REFERENCE_AMBIGUOUS` | see Links |
| `STAGES_MISSING`, `STAGE_UNCLASSIFIED` | no build-a-project stages; a stage heading no rule classifies |
| `DISCIPLINE_UNRESOLVED` | see Disciplines |
| `DOCS_ABSENT` | a monorepo with no docs |
| `HISTORY_UNAVAILABLE` | no git, no commits or no release tags |

Problems never stop the build. A caller that wants to fail loudly (a CI
check, a `--check` flag) exits non-zero when `problems` is not empty.

## The file

Schema `protoboard.sysmap/v0`. `SYSMAP_FILE` names `.protoboard/build/sysmap.json`
under the stack root (derived data, ignored by git like the Atlas index) as
the place for one, but nothing writes it there by default: `protoboard map`
writes a file only with `--out`, and the dev server and the VS Code
extension keep the map in memory (an installed stack copy is never written
into).

```ts
interface SystemMap {
  schema: "protoboard.sysmap/v0";
  stack: string;                         // the stack version that built it
  layout: "monorepo" | "installed";
  counts: { items; links; byType; byDiscipline; byStatus; byLinkKind; problems };
  islands: { id; name; gloss; items; empty; note? }[];   // every discipline, in island order
  stages: { n; title; discipline }[];
  releases: { version; tag; date }[];    // oldest first; empty without history
  items: SysmapItem[];                   // sorted by id
  links: SysmapLink[];                   // sorted by from, to, kind
  inputs: [path, size, mtimeMs, sha256][];  // every file read
  history: { head; tags; dirty } | null; // what freshness compares
  problems: { reason; message; path?; item? }[];
}
```

The full types are in `model.ts`. The bytes are stable: keys sorted, every
list sorted by code unit, no clocks (dates are the release tags'), paths
relative to the stack root with forward slashes. Two builds of the same
stack give the same file. A view needs only `sysmapGraph(map)`: the stack
version, the layout, the counts, islands, stages, release tags, items, links
and problems, without the freshness inputs or the history fingerprint.

## Freshness

`readSystemMap(file)` gives the map and the sha256 of its bytes, or
`MAP_MISSING`, `MAP_INVALID` or `MAP_SCHEMA`.

`sysmapFreshness(root, map)`:

1. Built by another stack version: stale (`stack`).
2. The root is now the other layout: stale (`layout`).
3. Built with history, and HEAD, the release tags or the set of paths that
   differ from the last tag moved: stale (`history`). This catches a change
   to a file the builder does not read but history compares (a package's
   source, a skill's reference file).
4. The files collected again as the builder reads them, compared by
   sha256: one added, removed or with other bytes is stale (`files`), with
   up to 20 paths per list. A file only touched stays fresh.

It reads only, and never rebuilds.

## Wiring

| File | What it does |
|---|---|
| `packages/core/src/index.ts`, `package.json` | export the builder, the reader, freshness, history and the model; `@protoboardai/core/sysmap` is the browser-safe model |
| `packages/cli/src/sysmap.ts`, `index.ts`, `gate.ts` | `protoboard map` (below); no project and no sign-in needed |
| `packages/cli/src/mcp/tools.ts`, `instructions.ts` | `stack_map`: the map's overview, one island's or one type's items, or one item with its links (`protoboard map --format json` and its queries) |
| `packages/cli/src/dev/sysmap.ts`, `server.ts`, `page.ts` | `GET /__protoboard/sysmap` answers `{ graph: sysmapGraph(map) }` for the stack the dev server's CLI runs from; built in memory on the first request, freshness checked again at most every 10 s, a stale map rebuilt; shared with the host origins (CORS) like the Atlas data; the dev page gives it to the view (`createDevSysmapData`) |
| `packages/views/src/tabs.ts`, `builtins.tsx` | the built-in tab `sysmap` ("System Map", beside the Atlas, at the root) |
| `packages/web-viewer/src/sysmapData.ts`, `vscode/sysmapData.ts`, `vscode/systemMapPage.tsx` | the view's data on the dev page (the route) and in VS Code (the extension, by message), and the panel's page |
| `packages/vscode-protoboard/src/systemMap.ts`, `systemMapPanel.ts`, `extension.ts`, `viewerEditor.ts` | **Protoboard: Open System Map**, and the viewer tabs' System Map tab: the map of the stack the extension runs |

### `protoboard map`

Builds the map of the stack this CLI runs from (`stackRootOf`: walking up
from the CLI's own file, the first `node_modules` folder means an installed
stack at its parent, the first `package.json` with `workspaces` a monorepo);
`--root <dir>` maps another. It writes nothing unless `--out <file>` is
given. Text prints a summary (islands with counts, types, problems);
`--format json` prints the map. `--island <id>`, `--type <type>` or
`--item <id>` ask one question (schema `protoboard.sysmap-query/v0`): an
island's or a type's items, or one item with every link grouped by kind,
both directions. `--check` exits 1 when the map lists problems; a usage
error is exit 2.

### Where VS Code takes the map from

The map is always of the stack the extension itself runs, never of the open
project's own packages. A development build whose folder lies inside the
stack's repository (a `package.json` with `workspaces` and
`packages/cli/bin/protoboard.mjs`, found walking up from the extension's
folder) maps that repository with its own CLI; otherwise the extension maps
the stack its `.vsix` carries, in its unpacked copy, unpacking it first if
needed. It runs that stack's `protoboard map --root <stack> --format json`
once per session; pages that ask during a build share it; the panel's
Rebuild builds again and keeps the last map if that fails. Open checks the
path lies inside the stack, exists and is not a sensitive name. Like every
command, it is off in Restricted Mode (it starts a process).

## The view

`packages/views/src/sysmap/` draws the map with the Atlas's renderer: the
same simulation, engine, canvas, labels, hover timing, minimap and opening
(`packages/views/src/atlas/engine.ts`, moved out of `AtlasView.tsx` so both
views run one engine). The renderer takes any graph (`MapGraph`,
`atlas/graph.ts`) and a vocabulary (`MapSpec`: kind names, group titles);
the Atlas gives it the project index unchanged.

- **Islands.** Items pull together by discipline: the renderer's Folder
  grouping, each item's folder its discipline (`none` for an item none
  resolves). No borders are drawn; each island's name is its title, centered
  far out and above it closer in, and every island is titled however small.
  An empty island is listed in the side panel ("nothing here yet", its note
  in the tooltip) and never drawn.
- **Nodes.** Hexagons sized by their links. Released filled; work in
  progress (`wip`) hollow and dashed; outside this repository hollow and
  solid. The Appearance popover (Color by type, each type's color and
  shape, two presets) is the Atlas's, keyed by item type and kept apart from
  the Atlas's (local storage `protoboard.sysmap:ui`); it starts with Color
  by type off, the map in neutral grays with the best-linked items a step
  stronger, as in the approved design.
- **Labels.** The name beside the hexagon, the boxed chip after it: the
  item's own version, `unreleased` for work in progress, nothing for an item
  with none. The Atlas's zoom tiers: island names far out, item names closer,
  chips closest or on the focus.
- **Links.** Within an island by default (core links); **All links** adds
  the links across islands as the muted web; a hovered or selected item's
  links are all drawn in the accent.
- **Show changes.** A toolbar switch: every item whose last change is in the
  chosen release is ringed in the text color (outside the node, where the
  hover's outline would not hide it), its chip reads `changed <version>` at
  every zoom, and the rest dims as for a search (a search typed while it is
  on wins). The release picker lists every version some item last changed in,
  newest first, `unreleased` on top, each with its count; it starts on the
  latest release. The side panel lists the items with their one-line why.
- **Side panel (left).** The title, the stack's version boxed, the counts and
  Rebuild (when the host can); search (names, ids, paths, types, purposes);
  what changed (with Show changes on); the islands with counts (a click
  flies to the island and opens its card); the types with counts (a click
  lights them).
- **Inspector (right).** Type, version, status, island, stage, purpose, the
  file it is defined in, the release it last changed in and why, the
  builder's problems about it, and every link grouped by kind and direction,
  each a button to the item at the other end. **Open file** (VS Code: an
  editor) or, on the web, **Copy path**.
- **Problems.** The builder's problems sit at the top center where the Atlas
  says its index is stale: a count and the first reason, opening to the
  list (an item named there is a link to it).
- Node positions are the person's own (local storage
  `protoboard.sysmap:layout`), the camera per tab (session storage). No
  time-lapse.

## Not covered yet

- Firmware targets the extensions write configuration for (ESP-IDF 5.3,
  Zephyr 4.2, Betaflight): their manifests name them only in prose
  (`capabilities[].native`, summaries), so they are not tool items.
- Versions of tools that declare no `runtime` pins (`tscircuit-node`,
  `kicad-cli`): their pins live in prose or in a `package.json`.
- Links the code makes but no file states as a reference: which view shows
  which operation's output, `protoboard release` running the release
  operation, `protoboard run` dispatching to capabilities, `protoboard init`
  using the templates, `protoboard tools install` installing runtimes.
- VS Code commands (`contributes.commands` of the extension's
  `package.json`) and eval cases (`evals/` of each extension).

## Open questions

1. Should manifests declare `discipline` (and `stage`) per skill and
   operation, so the rule tables shrink to a fallback?
2. Protocols and playbooks are kinds of content more than disciplines: once
   `handbook/` and `playbooks/` exist, should they be item types placed on the
   islands their steps touch, rather than islands of their own?
3. Should the release-notes match also accept a plain mention in prose (not
   in backticks or bold), at the risk of matching words like `release`?
4. Where should the map live for an installed stack: next to the copy
   (`~/.protoboard/stack/<version>/`), or only in memory, built on demand?
   (For now: in memory, built on demand, in the dev server and VS Code.)
5. Should `build-a-project`'s stage 0 table (extensions and what they are
   for) count at all toward stages, or only its prose?
6. Should a `package:*` operation (a Manufacturing Package section) be
   placed in mfg whatever extension ships it?
7. Should the System Map start with Color by type on, like the Atlas? It
   starts neutral, as the approved design did.
