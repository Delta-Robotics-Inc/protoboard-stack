# Atlas: the project index

Status: built. The index (written by `protoboard build` and by `protoboard
dev`'s builds), the `protoboard index` queries, three MCP tools, the dev
server's Atlas routes, and the Atlas tab in the web viewer and in VS Code.
What is not built yet is listed under [Deferred](#deferred).

A Protoboard project holds more than its model: CAD bodies and their
generators, board files, renders, photos, concept sketches, documents, test
data and firmware images. Atlas is one index of all of it, written by the
build to `.protoboard/build/atlas.json`:

- a **census** of every asset file in the project, and whether something links
  it (an artifact, a folder artifact, an operation record) or nothing does;
- a **graph** at definition level: one node per definition (module or part),
  one per file an artifact names or the census lists, and the edges between
  them (contains, uses, has, made-from, link, harness);
- the **inputs**: every enumerated file with its size, mtime and sha256, so a
  reader can tell whether the index still describes the project.

The index is derived data: it is never committed, and nothing reads it to
decide whether a design is valid. It is how agents and people find their way
around a project ("where is the frame's STEP?", "which renders are not linked
to anything?") without walking the folder themselves.

## Where it lives

| Piece | Module |
|---|---|
| Types, the kind table, `classifyFile`, `isSensitiveName`, `isUnlinkedFile`, `displayForBundle`, `atlasGraph` | `packages/core/src/atlas/model.ts`, browser-safe, also at `@protoboardai/core/atlas` |
| Enumeration, hashing, census, graph, the atomic write | `packages/core/src/atlas/build.ts` (`enumerateProject`, `buildAtlasIndex`, `writeAtlasIndex`) |
| Reading the index, freshness | `packages/core/src/atlas/fresh.ts` (`readAtlasIndex`, `atlasFreshness`) |
| `protoboard index census`, `where`, `search` | `packages/cli/src/atlas.ts` |
| The MCP tools `project_census`, `project_where`, `project_search` | `packages/cli/src/mcp/tools.ts` |
| The dev server's Atlas routes, the layout save | `packages/cli/src/dev/atlas.ts`, `packages/cli/src/dev/server.ts` |
| The Atlas view: simulation, camera, drawing, labels, inspector, time-lapse | `packages/views/src/atlas/` (`@protoboardai/views`; `timeline.ts` for the time-lapse's order, pacing and curves, `timelapse.ts` for a run) |
| The view's data in the shells | `packages/web-viewer/src/atlasData.ts` (the dev page), `packages/web-viewer/src/vscode/atlasData.ts` (a VS Code tab) |
| Saving positions and opening files from VS Code | `packages/vscode-protoboard/src/display.ts`, `viewerEditor.ts` |

The core pieces are exported from `@protoboardai/core` as well.

## Read-only by design

The builder reads project files and writes exactly one file: `atlas.json` in
`.protoboard/build/` (or the folder given as `outDir`), through a temporary
file and a rename that is retried on `EPERM`/`EBUSY` (a reader holding the
file on Windows). It never changes, moves or deletes a project file.

A failure on one file never throws out of the build. The file is recorded
with `status: "failed"` and a reason, listed in `problems`, and every other
file is indexed as usual.

## Enumeration

1. When the project folder is in a git work tree and the repository does not
   ignore the folder itself, the files are
   `git ls-files -z --cached --others --exclude-standard`, run from the
   project folder: a project nested in a larger repository lists only its own
   files, by paths relative to the project. Otherwise the folder is walked,
   skipping `node_modules`, `__pycache__`, `dist`, `build` and dot-folders.
   The index records which (`enumerator: "git" | "walk"`). When `git ls-files`
   fails in a work tree, the folder is walked and the index carries an
   `ENUMERATION_FALLBACK` problem.
2. Always left out: `.protoboard/**`, `release/**`, `releases/**`, dot-files
   and dot-folders, and files no longer on disk.
3. Sensitive names are never listed, hashed or searched: `.env*`, `*.pem`,
   `*.key`, `*.p12`, `*.pfx`, `*.keystore`, `id_rsa*`, `id_ed25519*`,
   `credentials*.json`. They are only counted, in `counts.census.excluded`.
4. A link whose target lies outside the project is `OUTSIDE_PROJECT` and its
   target is not read; a dangling link is `BROKEN_LINK`. A name that is not
   valid text is left out with a `NAME_UNREADABLE` problem.

Every recorded path is project-relative, with forward slashes on every system.

## Hashing

Every enumerated file is hashed (streamed sha256, `"sha256:<hex>"`), code
included, so freshness can tell a source file that was only touched from one
that changed. The previous index's hash is reused when a file's size and
mtime are unchanged; a previous index from another schema or stack version
is not used. Hashing errors map to reasons: `EBUSY`/`EPERM` is `LOCKED`,
`EACCES` is `PERMISSION_DENIED`, anything else `READ_FAILED` (`STAT_FAILED`
when the file cannot even be stat'ed).

## Kinds

Every node has a kind. Definitions are `module` (tier project-specific, the
project's own design) or `part` (catalog or project-researched). Files are
classified by `classifyFile`, in this order:

1. **Tag.** A linked artifact whose `tags` contain `concept`, `render` or
   `photo` gives that kind.
2. **Extension.**

   | Kind | Extensions |
   |---|---|
   | `model` | glb gltf stl 3mf obj ply fbx usdz |
   | `cad` | step stp iges igs brep kcl f3d f3z sldprt sldasm slddrw ipt iam fcstd scad dxf dwg 3dm skp |
   | `board` | kicad_pcb kicad_sch kicad_pro kicad_sym kicad_mod brd sch gbr gtl gbl gts gbs gto gbo gko gm1 drl xln; and the files named schematic.svg, pcb-top.svg, pcb-bottom.svg, circuit.json, netlist.json, pnp.csv |
   | `doc` | md markdown pdf txt rst adoc html htm docx doc odt rtf pptx |
   | `data` | csv tsv xlsx xls parquet |
   | `firmware` | bin hex elf uf2 |

3. **Images** (png jpg jpeg webp gif svg heic heif tif tiff bmp avif) by the
   words of their path, lower-cased and split on `/ _ - .` and spaces:
   - `concept(s)`, `sketch(es)`, `idea(s)`, `moodboard`, `whiteboard`, `inspiration`: `concept`;
   - `render(s)`, `rendering`, `hero`: `render`;
   - `photo(s)`, `pic(s)`, `camera`, and camera file names (`IMG_0042`, `DSC01234`, `PXL_…`): `photo`, as are `.heic` and `.heif`;
   - otherwise an image an operation record produced is a `render`;
   - otherwise `image`.
4. A file an artifact names that is not an asset by extension (a feature
   manifest, a generator script) is `data`, or `cad` when the artifact has
   `role: "source"`. It gets a node but no census entry.
5. Video and any other extension is `other`; an artifact's `type` breaks the
   tie (`3d_model` is `model`, `pcb` and `schematic` are `board`, `datasheet`
   and `documentation` are `doc`). Code, configuration and records (`.ts`,
   `.js`, `.py`, `.json`, `.yaml`, `.toml`, `.lock`, files without an
   extension, …) are not assets: they are inputs for freshness only.

The extension wins over the artifact's `type`: a STEP body typed `3d_model`
is `cad`. Each node and census entry records where its kind came from
(`kindFrom`: `tag`, `extension`, `path`, `operation` or `artifact`).

## The census

Every enumerated file that is an asset by extension (rules 2, 3 and 5) has a
census entry:

- `linked` when an artifact names it (`artifact:<definition>#<id>`), a folder
  artifact contains it (`dir-artifact:<definition>#<id>`), or a readable
  operation record lists it in `outputs[].path` (`operation:<record path>`,
  the newest record);
- `unlinked` when nothing does;
- `failed`, with a reason, when it could not be stat'ed or read.

An operation record that cannot be read or parsed is skipped with an
`OPERATION_RECORD_UNREADABLE` problem.

**One rule for "unlinked".** A file is unlinked when no artifact, folder
artifact or operation record points to it, and only then. A file an
operation produced that no module names (a tech-docs image, a BOM export)
is linked by its record: it has no edge in the graph, but it is not
unlinked. The view tells the two apart from the graph alone with
`isUnlinkedFile(node)`: a project file (`file:`, not a package's) that is
not failed, has no edge (`degree` 0) and no `file.producedBy`. An artifact
or a folder artifact always gives a file a `has` edge, and an operation
record always gives it `file.producedBy`, so over an index's nodes the
count of `isUnlinkedFile` equals `counts.census.unlinked`. The census, the
`--status unlinked` query, the view's "Unlinked" chip and group, and its
dashed nodes all use this rule.

## The graph

Nodes, by id:

| Id | Node |
|---|---|
| `def:<definition id>` | A definition in the project, used or not (`status: "unused"` when no instance uses it). Its `path` is the file that defines it, `definition.instances` the instance paths that use it (four motors are one node), `definition.root` marks the root system. |
| `file:<path>` | A file an artifact names, or a census file. Several definitions naming one file share one node (`file.owners`, `file.artifacts`). A file in an installed package is `file:package:<name>/<path>` and is not hashed. |
| `dir:<path>/` | A folder an artifact names. |
| `url:<definition>#<artifact id>` | An artifact with a URL and no file (`status: "remote"`, folder `(remote)`). |

An artifact with neither file nor URL (a recorded reference) has no node. A
named file that does not exist is `status: "missing"`. A catalog or vendored
artifact whose path could leave its part's folder (the test of
`artifactPathEscape`, PB-1048) is `status: "failed", reason: "UNSAFE_PATH"`,
and a project artifact that resolves outside the project is
`OUTSIDE_PROJECT`; neither is resolved or read.

Edges:

| Type | From, to |
|---|---|
| `has` | A definition to each artifact node it names (`via`: artifact ids); a folder node to each asset file below it. |
| `made-from` | A derived artifact's node to the node of the artifact it was generated from (`provenance.generatedFrom` on the same definition). No edge when the source has no node (a packaged generator). |
| `contains` | A definition to each child definition that is a module. |
| `uses` | A definition to each child definition that is a part. |
| `link`, `harness` | Between the definitions of the two instances a link joins (a `harness` edge when the link runs through a harness), one edge per unordered pair and type, with `count` and the link ids in `via`. A link between two instances of one definition draws nothing. |

Every node has `degree` (its edge count) and `folder` (the directory of its
path, `""` at the root): the view can pull nodes together by folder, and
files with no edges (the unlinked ones, and those only an operation
produced) drift to the edge of the graph.

## Creation times

Nodes carry when their file came into being, so a view can replay how the
project grew: `created: { at, from }`, `at` in integer milliseconds since
the Unix epoch (UTC), `from` the source (`CreatedSource`):

| `from` | When |
|---|---|
| `git` | The project was enumerated with git and the file has an add commit: the author time (`%at`) of the newest commit that added it, so a file deleted and added again has the time of its current incarnation. |
| `birthtime` | No add commit (untracked or only staged, a walked project, or a file whose newest history event is a delete): the file system's birth time, when it is a finite number above 0. |
| `mtime` | No birth time (0, absent or not finite, as on some Linux file systems): the mtime, recorded as such. |

Which nodes have one:

- every `file:` node of an enumerated project file, unless it is failed
  (a file a package holds, `file:package:…`, a missing file, `UNSAFE_PATH`
  and `OUTSIDE_PROJECT` have none);
- every `def:` node whose `path` (the module's or part's source file) is
  an enumerated project file: that file's time;
- every `dir:` node: the earliest time among the enumerated files below it,
  with that file's `from`.

`url:` nodes have none: a URL artifact is a link declared in a part's or
module's file, not a file of its own, so neither git nor the file system
can date it (the time-lapse brings it in with its definition, which it is
linked to by `has`). A census entry carries the same `created` as its
file's node. `counts.created` counts the nodes by source:
`{ git, birthtime, mtime, none }`, `none` being the nodes with no
`created`; the four add up to `counts.nodes`.

The history is read in one pass for the whole project, never once per
file, run from the project folder (so a project nested in a larger
repository gets paths relative to itself and only its own history):

```text
git -c core.quotepath=off -c log.follow=false -c log.showRoot=true log
    --no-show-signature --no-renames --diff-filter=AD --name-status
    --relative -z --format=%x01%at -- .
```

With `-z` the output is NUL-separated tokens: a commit header (`\x01`
then the author time in seconds), then a status (`A` or `D`, the first
after a header preceded by the newline git puts there) and a path, pair
after pair, newest commit first. It is read as a small state machine, so a
path (spaces, non-ASCII, even a newline) is never taken for a header or a
status. The first event seen for a path decides: an add gives its time, a
delete gives none (the file there now is untracked) and it falls through to
the birth time. In a shallow clone, files older than the cut take the time
of the oldest commit there is. When `git log` fails in a work tree, the
times come from the file system and the index carries a `HISTORY_FALLBACK`
problem. Nothing here writes: git log and stat only.

## The file

`.protoboard/build/atlas.json`, schema `protoboard.atlas/v0`:

```ts
interface AtlasIndex {
  schema: "protoboard.atlas/v0";
  stack: string;                       // the stack version that built it
  project: { name: string; root: string | null };
  enumerator: "git" | "walk";
  counts: { nodes; edges; byKind; census: { total; linked; unlinked; failed; excluded }; created?: { git; birthtime; mtime; none } };
  nodes: AtlasNode[];                  // sorted by id; created?: { at, from } (see Creation times)
  edges: AtlasEdge[];                  // sorted by from, to, type
  census: CensusEntry[];               // sorted by path
  instances: Record<string, string>;   // instance path -> definition id ("" is the root)
  inputs: [path, size, mtimeMs, sha256 | null][];
  problems: { path?; reason; message }[];
}
```

The full types are in `packages/core/src/atlas/model.ts`. The file has no
clocks, its keys are sorted and every list is sorted by code unit (never by
locale, which differs between ICU builds), so equal inputs give equal bytes.
The creation times are inputs too (the history and the file system's
times), never the clock of the build. `created` on nodes and census entries
and `counts.created` are optional in the types, so an index written before
they existed still reads (it is stale, `reason: "history"`).
A view needs only `atlasGraph(index)`: the project, counts, nodes and edges.

The Atlas layout a view saves lives in `.protoboard/display.json` under the
key `atlas`. The UHD bundle embeds display.json without that key
(`displayForBundle`), so saving the layout never changes the bundle.

## Freshness

`readAtlasIndex(root)` gives the index and the sha256 of its bytes, or a
refusal: `INDEX_MISSING` (no file), `INDEX_INVALID` (not JSON, or fields
missing), `INDEX_SCHEMA` (another schema).

`atlasFreshness(root, index)` says whether the index still describes the
project:

1. Built by another stack version: stale (`reason: "stack"`).
2. Built before creation times were recorded (no `counts.created`): stale
   (`reason: "history"`).
3. The files are enumerated again. Another enumerator than the index's (git
   appeared or went): stale (`reason: "enumerator"`).
4. A file added or removed: stale (`reason: "files"`).
5. Each other file: size and mtime equal, unchanged. Otherwise it is
   re-hashed, within a budget of 64 MB per check; equal bytes (a file only
   touched) are unchanged, different bytes or a spent budget are `changed`.

`added`, `removed` and `changed` name at most 20 paths each; `checked` counts
the files compared. The check reads only; it never rebuilds or writes. A
stale index of reason `stack`, `history` or `enumerator` compares no files:
its lists are empty, and what reports it says why instead of counting files.

Creation times are history, not content: the check never reads the
history. A commit that only records history (a file committed, or a
commit made, with no file's bytes changing) leaves the index fresh, though
the next build may give some files a `git` time where they had a birth
time.

## Who writes it

`protoboard build` writes the index after the resolved project and the UHD
bundle, and prints one line for it (`wrote …/atlas.json (project index: 234
asset files, 196 linked, 38 unlinked; 411 nodes)`); with `--format json`
the result carries it under `atlas`. `protoboard dev` writes it with every
build, and the MCP tool `project_build` runs `protoboard build`. `protoboard
check` does not write it.

Indexing never changes the exit code of `protoboard build`: an index that
cannot be written is reported (`atlas: { error }` in JSON, a line in text),
and the build's own result stands.

## The `protoboard index` commands

```text
protoboard index census [--kind <kind>] [--status linked|unlinked|failed]
protoboard index where <ref> [--kind <kind>]
protoboard index search <text>
```

Each takes `--limit <1-200>` (default 20) and `--cursor <c>`, and
`--format json` for machine output (schema `protoboard.atlas-query/v0`:
the query, `total`, `items` and, when there is more, `nextCursor`). Items
come in a stable order. A cursor is bound to the index it came from (its
digest): once a build has changed the index, an old cursor is a usage error.

- `census`: every census entry, filtered by kind and status, sorted by
  path, with the definitions that own each file; the counts (total, linked,
  unlinked, failed, excluded, and by kind) are of the whole census.
- `where <ref>`: the node a ref names, resolved in this order: an instance
  path (`arm_fl/motor`), a definition id, a node id or project-relative
  file path, an exact name (case-insensitive; a name several nodes share is
  a usage error that lists them). Then every node one edge away, with its
  relation (`has`, `made-from`, `source-of`, `contains`, `uses`,
  `contained-by`, `used-by`, `owned-by`, `link`, `harness`), and the
  instance paths that use the definition. `--kind` keeps only related nodes
  of that kind. An unknown ref is a usage error that names the closest ones.
- `search <text>`: hits in tiers, each node once at its best tier: an exact
  id, name, path or instance path; a name holding every word, then a path;
  every node of a kind the text names (`renders`, `cad file`); then the
  lines of the project's plain-text documents (`md`, `markdown`, `txt`,
  `rst`, `adoc`, up to 1 MB each) holding every word, as path, line number
  and a snippet of at most 160 characters. PDFs and HTML are not searched.

Creation times come with every answer. In JSON, a census item carries the
`created` of its census entry (the builder writes it there, the same as on
the file's node), a `where` answer's `node` and each related item carry
their node's `created`, and a search hit carries its node's (a text hit,
its file's). In text, a short fragment in the UTC date says it:
`created 2026-11-03 (git)`, a column of its own in census, `where` and
search rows, and after the head line of a `where` answer. A node with no
creation time shows nothing there.

**The refusal rule.** Every query reads the index and nothing else of the
model: no query loads `protoboard.config.ts` or runs any of the project's
code; only the project root is located. Before answering, the index is
checked for freshness. An index that is missing, unreadable, from another
schema or stale is refused, with no partial answer: the refusal names why
(a stale one names up to five changed files, or the other version, or the
other file listing, or that the index was built before creation times were
recorded) and says to run `protoboard build`.

| Exit | When |
|---|---|
| 0 | Answered, an empty result included. |
| 2 | A usage error or an unknown reference. |
| 3 | The index cannot be used: `INDEX_MISSING`, `INDEX_INVALID`, `INDEX_SCHEMA` or `INDEX_STALE`; run `protoboard build`. |

With `--format json`, a refusal is `{ error, code }` on stdout (and
`freshness` for a stale index). The commands are local: they need no
account (`packages/cli/src/gate.ts`).

## The MCP tools

The MCP server (`protoboard mcp`) has three tools that run those queries
through the project's CLI:

| Tool | Runs | Input |
|---|---|---|
| `project_census` | `protoboard index census` | `kind` (a file kind), `status`, `limit`, `cursor` |
| `project_where` | `protoboard index where <ref>` | `ref`, `kind`, `limit`, `cursor` |
| `project_search` | `protoboard index search <text>` | `text`, `limit`, `cursor` |

`limit` is 1 to 100 (default 20). A ref or a text is passed after `--`, so
it is always a value, never an option. A refusal of the index comes back as
an error with its `code`, the stale index's `freshness`, and the action
"Call project_build (it writes the index), then call this tool again."
`project_build`'s description says it writes the index these tools read. A
project whose own CLI predates the index (its help comes back instead of an
answer) is told so, and pointed at `project_inspect` meanwhile. The
server's instructions tell an agent to ask these tools before opening
files, and that they refuse a stale index until `project_build` runs.

## The dev server's routes

`protoboard dev` serves the view's data (`packages/cli/src/dev/atlas.ts`):

- `GET /__protoboard/atlas`: `{ graph, layout?, stale? }`. `graph` is
  `atlasGraph(index)`; `layout` is the positions the display file keeps
  (`{ positions }`, read leniently: an entry that is not `[x, y]` is left
  out); `stale`, when the index no longer describes the project, is
  `{ changed, reason, rebuilding }`, where `reason` is `files` (`changed`
  counts the files added, removed or changed, at most 20 of each), `stack`,
  `history` or `enumerator` (`changed` is 0). Paths and metadata only, never a file's
  contents. A missing or unusable index answers 503 with `{ error, code,
  rebuilding }`.
- A stale or missing index found by that route starts a rebuild, at most
  once every 10 s (a request inside the interval waits for its end); after
  three rebuilds in a row that left it stale, or when the index could not
  be written, `rebuilding` is false and the view says to build by hand. The
  dev server adds no file watcher for this.
- `POST /__protoboard/atlas/layout` with `{ positions: { <node id>: [x, y] } }`
  keeps the positions. It needs the session token the page carries, a
  same-site origin and a JSON body of at most 4 MB, like a diagram layout
  save. At most
  50 000 ids, each a node id (`def:`, `file:`, `dir:`, `url:` …) of at most
  512 characters, with finite coordinates within ±1e9.
- `GET /__protoboard/atlas/image?path=<project-relative path>` sends one
  image for the inspector's preview: only a file the index's census lists
  (so never a sensitive name, a file out of the project, `.protoboard/` or
  a dot-folder), of a type a browser draws (png, jpg, jpeg, webp, gif, svg,
  avif, bmp, ico, apng; anything else is 415), read only when its real path
  is still inside the project (403 otherwise). It goes out like an artifact:
  `x-content-type-options: nosniff` and a sandboxing
  `content-security-policy`. A path that is absolute, has `..`, `.`, an
  empty segment or a backslash is 400; one the census does not list, 404.
- The read routes (the data and the image) get CORS headers for the host
  origins (VS Code webviews), as the bundle does; the write route does
  not.

## Where positions are saved

In `.protoboard/display.json`, under the key `atlas`:
`{ "atlas": { "positions": { "<node id>": [x, y] } } }`, integers, keys in
code-unit order. A save replaces `atlas.positions` and leaves every other
key (and any other key of `atlas`) as it was. The UHD bundle embeds
display.json without the `atlas` key (`displayForBundle`), so a save never
changes the bundle: nothing is rebuilt or reloaded.

- On the dev page, the view posts to the layout route.
- In VS Code, the tab sends its positions to the extension (`atlasLayout`),
  which writes the display file at once, with no Ctrl+S and no dirty tab
  (the same `applyAtlasLayout` as the dev server). The tab reads the graph
  from the dev server the extension runs, and never holds its write token.
- The view saves 800 ms after the layout settles, when the settle followed
  new nodes, a drag, a shake or a change of grouping, and only when a node
  moved by more than a unit or the saved ids differ from the graph's. It
  never saves while a time-lapse plays or while the map glides back from
  one.
- A save never feeds back into the view: a reload of the same graph (any
  rebuild that changed no node or link) leaves the simulation as it is.
- The grouping and the camera are kept per tab in session storage, not in
  the file.

## The view

The Atlas tab (`atlas`, at the project's root only; it hides the hierarchy
panel) draws the graph as a force-directed graph on a canvas, with its
controls and an inspector in HTML over it. The reference for its feel is
Obsidian's graph view.

- **One graph, one simulation.** An in-house simulation (`sim.ts`),
  deterministic: centering, repulsion (exact below 500 nodes, a Barnes-Hut
  quadtree above), collision, springs by link type, and a speed limit
  (`SIM.maxSpeed`, 14 units a tick) so nothing ever bursts apart. It lives
  as long as the view. "Pull together by" Links, Kind or Folder changes only
  the force rules: by kind or folder each node is also pulled toward its
  group and the springs are weakened. A switch keeps every node where it is
  with its velocity, blends the old rules into the new over
  `SIM.blendTicks` (60 ticks, about a second), warms the layout to
  `SIM.modeReheat` (0.8), and the nodes drift into their new groups. Links
  are drawn in every mode (see Links). Nothing is re-seeded or remounted and
  the camera does not move.
- **A rebuild** of the index with the same graph (same node ids and links,
  `graphShape`) changes nothing on the map: the simulation only takes the
  new details. One that adds or removes nodes builds a new simulation from
  every node's live position and velocity: the others do not move, new
  nodes settle in beside their neighbors.
- **Size and mass.** A node's radius is its kind's base (module 5.2, part
  3.4, file 3.8) times `degreeScale(degree)` = min(2.4, 1 + 0.3 √degree);
  the root system is never smaller than 12. The same scale is its mass: the
  repulsion a node gives scales with it, so hubs keep more room and read as
  heavier. Collision uses the radius.
- **Opening.** The map grows: nodes start gathered at the center (5 % of
  where they end) and the physics expands them over `SIM.introTicks` (120
  ticks, about 2 s). Nodes with a saved position are steered onto it (an
  anchor that grows over the motion, then a blend that lands exactly on it,
  so no save is due); a project with no saved layout settles freely and the
  camera glides to fit it once it has mostly cooled. Unlinked files drift
  to the perimeter as part of it.
- **Animations** always play, and there is no switch for them: the
  opening, the camera's fits and flies, the hover highlight's fade (below)
  and the time-lapse's live physics and pop. The system's reduced-motion
  setting (`prefers-reduced-motion`, which Windows reports when its
  animation effects are off) is not followed: with it a time-lapse read as
  frozen. A stored `animations` value from an earlier build is ignored.
- **Toolbar.** Centered at the bottom of the map, as in every Protoboard
  view; the time-lapse controls sit just above it while a time-lapse plays,
  and the Appearance popover opens above its center.
- **Drag.** A press on a node becomes a drag only once it moves (a click
  never wakes the layout). While dragging, the rest of the layout answers
  (alpha held at 0.3). On release the node is let go where it is and the
  physics eases everything back to rest. Nothing settles at once: a
  synchronous settle is what made the map jump on release.
- **Nodes.** Every kind is a hexagon by default (pointed top and bottom,
  corners at 1.12 r), each in its own theme color (theme tokens only;
  high-contrast themes draw outlines), so the color alone tells kinds
  apart: modules take the strongest neutral (`text`), parts and other files
  the two grays below it (`textMuted`, `textFaint`), the rest a hue each
  (`KIND_STYLE`: concept images `signalCan`, renders `signalSpi`, photos
  `signalAnalog`, images `domainPneumatic`, 3D models `domainNetwork`, CAD
  `domainSoftware`, board files `signalRf`, documents `domainHydraulic`,
  data `signalDigital`, firmware `domainThermal`). No kind is the accent:
  orange is reserved for the hover and the selection (the oranges beside it,
  `signalPower`, `domainElectrical` and `signalPwm`, amber-brown in light,
  are not used). The closest pairs the theme's data tokens leave, by OKLab
  distance (x100) in the Protoboard themes: images and data (5.6 in light,
  6.7 in dark, cyan and sky), renders and firmware in light (6.5, pink and
  rose), 3D models and documents in light (7.5, violet and indigo), renders
  and board files in dark (9.9, pink and fuchsia); firmware's rose is the
  kind color nearest the accent (9.7 in dark). Unlinked files, by the rule above, are hollow with a dashed
  outline; a file only an operation produced is drawn solid. The shapes and
  colors can be changed per person (Appearance, below).
- **Links.** By default only the core links are drawn: in Links the
  structure family (`has`, `contains`), in Kind and Folder the links whose
  two ends are in the same group (`isCoreLink`). "All links" (a toolbar
  toggle, network icon, `aria-pressed`, off by default) adds the rest as a
  thinner (0.6 px), fainter web under them; the minimap follows it. A
  hovered or selected node always shows all of its links in the accent,
  toggle or not. The physics uses every link either way, so the toggle
  never moves a node. The choice is kept in `protoboard.atlas:ui`
  (`allLinks`).
- **Highlight.** Hover a node (or select one): it keeps its own fill and
  gets an accent outline in its own shape just outside it (r + 2.5 px on
  screen, a 1.5 px line; the selected node r + 3.5 px, 2 px; hollow and
  high-contrast nodes the same), its links turn the accent, its direct
  neighbors stay lit and everything else dims to 0.12. There is no accent
  fill, ring, glow or growth. The timing, measured from Obsidian's graph
  view, is in one place (`HOVER`, hover.ts) and runs on real elapsed time,
  whatever the frame rate: each value approaches its target exponentially
  (an ease-out that turns back from wherever it is when the target changes,
  never a snap); the others dim with a time constant of 220 ms
  (`dimTauMs`: 90 % at about 550 ms, settled by about 900 ms) and come back
  with 250 ms (`restoreTauMs`); the outline is in within 150 ms
  (`accentInMs`, a time constant of a third of it) and goes with the
  restore. Dimming, outline and label start on the frame the pointer
  reaches a node (no enter delay). Hover intent keeps a sweeping pointer
  from flickering: leaving a node for empty canvas holds the dimming for
  160 ms (`holdMs`) before the restore starts, and reaching another node
  meanwhile (or directly) hands the focus straight over, so a node dimmed
  under both stays dimmed (Obsidian has no hold and bounces back about
  half way between nodes). The fade always runs: it is not tied to the
  system's reduced-motion setting (the renderer
  has no instant mode). A frame after the loop has idled counts as one
  frame, and a stalled frame as at most 100 ms, so a pause never jumps a
  fade to its end.
- **Labels by zoom.** Far out and in the middle, only the titles of groups
  large enough on screen (spanning 90 px): the kind's name in Kind, the
  folder's last path segment in Folder (with its parent segment first, in
  the faint text color, only when two titles shown share a name; the whole
  path is in a tooltip above the title and in the group's card), and a
  module's name for its cluster in Links. Group titles are uppercase,
  weight 600, on a backing plate: centered on the group far out (13 px)
  and above it closer in (11.5 px, once a base-size file spans 3 px on
  screen, `titleAbove`). Close in, file labels fade in, muted, as a node's
  on-screen radius grows from 5.5 to 9 px (`fileLabelAlpha`, a bounded
  ramp). A node's label sits to the right of the node, vertically centered
  on it, 5 px past its right side, on a backing plate in the canvas color
  at 0.82 opacity. At the closest tier (a radius of 9 px or more on
  screen) or on the focus, a small boxed chip follows the name (9.5 px
  muted text, a 1 px border, the surface fill): the node's version when the
  Atlas data has one for it, else its file's extension in capitals (STEP,
  PNG), nothing when it has neither (`chipText`; the index records no
  versions yet, so today it is the extension). A label that does not fit
  with its chip is placed without it. The hovered or selected node is
  always labeled, whole, weight 600 in the accent's text color
  (`accentHover`); search matches are labeled. Labels are cut to 26
  characters with an ellipsis, placed greedily in screen space by priority
  (the focus, then group titles by size, then the rest by degree) and never
  over each other or anything floating over the canvas (the panels, the
  minimap, the toolbar, the Appearance popover). Widths are measured once
  per font and text, and only for labels that may be drawn.
- **Appearance.** A palette button in the toolbar opens a popover above it
  (the legend card; Escape, a press elsewhere or the button closes it):
  "Color by type" (a switch, on by default; off, every node is the neutral
  `textFaint` and the hubs, the modules and any node with 8 links or more,
  a step stronger, `textMuted`); the shape presets "All hexagons" (the
  default) and "Shapes by type" (modules hexagons, images squares, board
  files diamonds, the rest dots: the earlier mapping); per kind present, a
  shape (hexagon, square, diamond, dot) and a color, one of a row of
  swatches from the theme's text and data tokens (so it follows light and
  dark; the accent and the oranges beside it are not offered) or a custom
  color from the native color picker (the same in every theme); and Reset.
  It is kept per person in `protoboard.atlas:ui` (`appearance`: `colorByType`
  and, per kind, only what differs from the default), read when the Atlas
  opens and validated (an unknown kind, shape or color is ignored); nothing
  is written to the project. The left panel's kind list and the minimap
  draw the chosen colors, and the kind list the chosen shapes (the
  minimap's one- and two-pixel dots are too small to show a shape).
- **Interaction.** Click a node: it is selected and the inspector shows it.
  Click the empty canvas: the selection clears. Double-click a node: the
  view flies to it and its neighbors. Click a group title or a kind in the
  legend to select a group.
- **Camera.** Drag the empty canvas with the left button, or anywhere with
  the right or middle button, to pan (no context menu over the map); a pan
  let go while moving flings on and slows by friction. The wheel zooms
  about the pointer with inertia: each turn gives the zoom a velocity that
  eases in and coasts out over a few frames, to the same zoom a turn gave at
  once before (`wheelImpulse`, `INERTIA`). Keys F (fit), + and -, 0
  (100 %), the arrows (pan), Escape. Fits and flies glide.
- **The inspector** (the right panel) shows a preview at its top: an image
  file's own pixels, fetched as every view fetches a project file (the
  artifact that names it, through the host's `artifactUrl`: the dev
  server's artifact route, on the dev page and in VS Code), else, for an
  image no artifact names, the Atlas data's `imageUrl` (the dev server's
  image route, above); anything else gets a large glyph, a file (or folder)
  outline with the kind's Lucide icon inside. An image with no URL (a host
  with neither route, a format browsers cannot draw) or one that fails to
  load shows the glyph and says why. Then
  the kind, status, path, size, creation time and its source, owner
  modules, the producing operation, the artifacts that name it, its links;
  Open in VS Code, Copy path on the web; Open source and Show in diagram
  for a definition. A file no module names gets a line saying why:
  "Produced by the <operation> operation, attached to no module", or
  "Unlinked: no artifact, folder artifact or operation points to it".
- **Panels.** The left panel (the grouping, the search, the kinds) and the
  right one (the inspector) each fold away with their own button and come
  back with a button in their corner (the hierarchy panel's look). The
  minimap shows or hides from the toolbar. All three,
  "All links" and the appearance are remembered in local storage
  (`protoboard.atlas:ui`, settings.ts `parseUi`). With both panels folded,
  fits use the whole width.
- **Tooltips** never sit on the row they describe: a legend row's opens to
  the right of the panel, a search result's (its path) to the right, a
  linked node's or a group member's (its path) to the left of the
  inspector, a long property value's above its row, a folder title's above
  the title. A tooltip that would only repeat visible text is left out.
- **The Unlinked chip** counts the unlinked files and selects them.
- **The minimap** sits at the top right, in a panel with the app's panel
  radius and inset (the hierarchy dock's: 4 px in, below the host's bar),
  above the inspector. It draws each link faintly (the core ones, or all
  with "All links"), each node as a one-pixel dot in its color as chosen (a
  module two), and the view as a framed box in the accent. The dev page's status toast (bottom center) no longer covers
  it.
- **The time-lapse.** "Animate" in the toolbar replays how the project grew
  from the creation times the index records (see Creation times), modeled
  on Obsidian's graph time-lapse (its parameters measured from a screen
  recording). Every number is in `TIMELAPSE` (timeline.ts), in one place.
  - *Order.* Every node gets its own place in a strict sequence: by
    creation time, then, within a batch that shares one timestamp (one
    commit), owners before what they own (a module before its child
    modules and artifacts, a part before its files, through `has`,
    `contains` and `uses`; a CAD source before the models `made-from` it),
    each owner followed by its own files so a cluster grows in one place;
    ties by kind (the root, modules, parts, files), folder and path. The
    order does not depend on how the index lists nodes. A node without a
    time of its own (a URL artifact: it has no file, so neither git nor
    the file system dates it) takes its earliest neighbor's (its part's),
    else the start; no node is left out.
  - *Pacing.* Playback runs by sequence with the calendar as a guide: each
    arrival is one step, and a calendar gap of d days adds
    `gapStepsPerLog` x ln(1 + d) steps, at most `gapMaxSteps` (14), so a
    month without files is a short pause and a batch of hundreds of files
    from one commit arrives one after another at an even rate. The first
    node arrives `leadInMs` (0.5 s) after play; the run lasts
    `msPerSqrtNode` x sqrt(nodes), between 6 and 30 s at 1x (about 20 s
    for 411 nodes, about 20 arrivals a second). The play bar shows the
    calendar date as it passes (interpolated through a gap), how many
    nodes are on the map, a scrubber over the playback clock and the speed
    (0.5x, 1x, 2x, 4x).
  - *Live.* The map empties in one frame and the camera
    never moves. The physics runs for the whole time-lapse, only the nodes
    that have arrived taking part; the layout is kept warm (`playAlpha`)
    while arrivals run and each arrival warms it a little more
    (`arrivalKick`, up to `kickMax`), so the nodes near it get pushed aside.
    The map is heavily damped (`restDamping`: velocity kept 0.5 a tick), so
    nodes far from an arrival barely move. A node with a present neighbor
    is born beside it (the one that owns it, else its best-linked present
    neighbor), just past both radii, heading outward from the map's center
    through that neighbor; the new link's spring carries it out to the
    link's length. It and that neighbor are loose for `looseMs` (0.6 s,
    `linkedDamping` 0.75), so the newcomer travels into place with momentum
    and the neighbor, yanked by the new spring, wobbles and settles: real
    spring physics, not a keyframe. A node with no present neighbor is born
    just outside the cloud (its group's in Kind and Folder, else the map's:
    1.1 x the cloud's 95th-percentile radius) and drifts inward about four
    of its diameters with an exponential ease-out of its own (half the way
    in about 140 ms), with no bounce.
  - *Its look.* A node fades in as measured (`entryOpacity`: half at once,
    then 1 - 0.5 e^(-t/230 ms), full by 750 ms) with a subtle pop on top
    (`popScale`: from 0.6 of its size to full over 300 ms with one
    overshoot of about 8 %; Obsidian has none, the owner asked for one).
    It is drawn at its size for the links shown so far: the smallest on
    arrival, growing as its links come in. A link starts 150 ms after both
    its ends are on the map (`linkDelayMs`), at full length, fading in over
    500 ms (`linkAlpha`), while its spring ramps in from nothing over the
    same 500 ms (`springRamp`, the simulation's `edgeScale`), so it never
    snaps. After the last arrival the layout cools on its own (no snap to
    the saved layout).
  - *Clock.* The run steps on a fixed clock (`stepMs`, one simulation tick
    a step, at most four steps a frame), so the same project gives the same
    run at any frame rate. Pausing freezes the arrivals while the physics
    and the fades go on and settle; scrubbing back takes the nodes past the
    new time off the map at once, scrubbing on brings them in as arrivals;
    play from the end starts again from an empty map.
  - *Leaving.* Nothing is saved while it plays; leaving it (its close
    button, the toolbar button again, or Escape) shows every node again and
    glides each back to where it was when the time-lapse started (over at
    least a second, longer for a long way, so no node moves more than about
    `SIM.glideStep` units a tick on top of the physics), so there is no
    jump and no save is due. An index without creation times disables the
    button and says to build.
  - *The round-3 freeze.* The view's animation loop used to request a
    second frame whenever something in a frame had already woken it (each
    time-lapse frame did), so the chains of frames doubled every frame
    until a frame took seconds: the map froze, and by the next drawn frame
    every node had arrived. The loop is now one chain (a frame never
    schedules a second one).
- **Fits** keep clear of what floats over the canvas, measured after each
  render: on a wide canvas the left panel and the right column (the
  minimap, the card), the toolbar and the time-lapse controls, the host's
  bar, the stale notice, and room for the group titles.
- **A stale index** shows a notice: "N files changed since the last
  build", or "The project index was built by a different version of
  Protoboard", or "… listed the files another way (with or without git)",
  or "… was built before creation times were recorded"; with "rebuilding…"
  while the dev server rebuilds, else "run `protoboard build`".
- The animation loop stops once nothing moves, eases or coasts; a frame
  never re-renders React (the time-lapse's date and scrubber are written to
  the DOM directly).
- Without a data provider (a static page) the tab says it needs the dev
  server or the VS Code extension.

## Privacy

The index lists paths, sizes and hashes, never file contents, and stays in
the ignored `.protoboard/build`. Sensitive names are never listed, hashed or
searched. Links out of the project are not followed. The dev data route
serves paths and metadata only, to the same origins as the bundle; the
image route serves the bytes of images the census lists, and nothing else. A file the view
opens in VS Code must lie inside the project once every link is followed,
and never have a sensitive name (`projectFileOf`).

## Deferred

- "Mention" edges (a document that names a module).
- A kind for video, and photos recognized by their EXIF data.
- Image kinds in UHD itself (`ArtifactType` values or a tag vocabulary):
  today a render, photo or concept image is known by its tag, path or
  producing operation only.
- Full-text search of PDFs and HTML.
- One hash cache shared with other builders of `.protoboard/build`.
- Very large projects: a Web Worker for the layout, or folders collapsed
  into aggregate nodes, past a few thousand nodes.
- Saving the Atlas in VS Code through Ctrl+S like the diagram's layout
  (it saves at once instead).
