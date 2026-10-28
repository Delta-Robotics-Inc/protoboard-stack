# The Protoboard VS Code extension

Status: built; the cloud views wait for the cloud features they show. Builds
on the minimal extension (commands for the viewer, check and artifacts, a
status bar item) and takes its interaction model from the earlier Protoboard
web app (its inspector, parts library and board review), adapted to an
editor.

The extension is the everyday home of a Protoboard project: browse and focus
modules, see design-rule findings, find and add parts from libraries, and see
what the project costs and where it stands in Protoboard Cloud. The viewer
stays the place where the system is drawn; the extension adds navigation,
lists and actions around it, and never edits geometry itself.

> **v3 (2026-10-05):** the layout below uses VS Code's own slots. The viewer is editor tabs (one module and view each, a custom
> editor; several at once; the top-level system opens on a project's first
> visit, then VS Code restores the tabs). The Explorer becomes the hierarchy
> of the **Protoboard Inspector** in the secondary side bar, with a
> **Selection** card under it that follows the focused viewer tab. The DRC
> panel is the only DRC. The viewer tab holds only the logo, the view tabs,
> a toolbar, the legend and the canvas; its layout is saved explicitly
> (Ctrl+S, a dirty tab). Optional **Protoboard Dark** and **Light** colour
> themes ship with the extension. Details: `docs/specs/viewer-stack.md`
> (VS Code shell) and the extension's README.

> **Since 0.2.0:** the hierarchy moved into each viewer tab: each viewer has its own hierarchy, docked at the
> left of the tab and scoped to it, and the Inspector is the right side bar, scoped to whichever viewer has the
> focus. Each tab has the uhd-viewer's `ViewerHierarchy`
> docked at its left (the tab's project only, synced with its canvas; VS Code's `webview/context` menu on its rows);
> the Protoboard Inspector holds one view, the Inspector, following the focused tab and keeping the last one's
> while another editor has the focus. Section 2.1 describes it; the tree model (`tree.ts`) stays in the extension
> for the commands and the Inspector's cards.

## 1. Layout

| Place | What | Built on |
| --- | --- | --- |
| Activity bar: **Protoboard Library**, **Protoboard Project Parts** and **Protoboard Cloud** containers | One view each: **Library**, **Project Parts** and **Cloud** (section 2.5) | Webview views (Library, Cloud) and a tree view (Project Parts) |
| Secondary side bar: **Protoboard Inspector** container | One view, the **Inspector**: what the focused viewer tab selects, as the viewer's own inspector shows it (the hierarchy is in each viewer tab, section 2.1) | A webview view (the extension's React page); needs VS Code 1.106 or later (`engines.vscode`) |
| Panel area (next to Problems, Output, Terminal): **DRC** | Design-rule findings, grouped and short; the only DRC (none in the canvas) | A webview view in the panel area |
| Editor area | The viewer as editor tabs (a custom editor: one module and view per tab, several at once), source files, artifacts | The VS Code shell (`packages/web-viewer/src/vscode`), section 3 |
| Status bar | Check summary (errors/warnings), dev server state, **account status** | The minimal extension's status item, extended |

Before v3 (2026-10-03 proposal), the Explorer sat in the activity-bar
container and the viewer was one webview tab framing the dev page; the
sections below keep their original numbering and describe the views as they
work now where v3 changed them.

## 2. Views

### 2.1 Hierarchy (in each viewer tab, since 0.2.0)

Since 0.2.0 the hierarchy is a panel docked at the left of each viewer tab
(`ViewerHierarchy` in uhd-viewer, so `protoboard dev` has it too), scoped to
that tab's project: the module tree (root, sub-modules, parts, harnesses;
harnesses, cables and fastener stacks folded into one **Harnesses & links**
group), kind icons, part status dots and the worst finding. A click selects
on the level that holds the module (a harness drawn along its lines: the
line that carries its name tab, its lines framed), a double-click drills, a canvas
selection reveals its row; it folds to a rail, resizes, filters as you type,
and is an ARIA tree. Its rows carry `data-vscode-context`, so their
right-click menu is VS Code's (`webview/context`: Open in New Viewer Tab,
Focus in Viewer, Open Source, Open Artifact, Run Operation, Filter). Its
open/closed state, width and open rows are the tab's webview state.
Interfaces and links are no longer rows of the tree: they are in the
Inspector's card. What follows is the native tree it replaced.


A tree of the project as UHD sees it: the root system, then its instances by
hierarchy (sub-assemblies, boards, enclosures, harnesses, fastener stacks),
each module's interfaces and the links between them, grouped in short
sections. Badges: part tier (catalog / project-researched / project-specific),
check state (worst diagnostic), and whether generated outputs are stale.

Actions per node: **Focus in viewer** (the viewer drills to the module and
selects it), **Open source** (the `.uhd.ts` file at the definition, or the
instance in the parent system), **Open artifact** (CAD, datasheet, board
outputs), **Run operation** (the capability operations that apply: circuit,
cad, firmware). Selection syncs both ways: selecting in the viewer reveals the
node; moving the cursor in a `.uhd.ts` file reveals and highlights the module
being edited. A search box filters the tree.

Kept deliberately short: the details are in the **Selection** view under the
tree (the viewer tab has no inspector of its own); the tree is for finding and
jumping.

**Selection**. What the focused viewer tab has selected, else the
level it shows, a part picked in Project Parts or the Library, or an
interface picked in the tree. It is one of the extension's React pages
(`webview/views-app`, screen `inspector`): `SelectionInspector` of
`@protoboardai/views/inspector`, which draws the extension's header (icon
actions with tooltips, the part status, the findings) around
`@deltarobotics/uhd-viewer`'s `SelectionDetails`, the same components the web
viewer's inspector is drawn with. The extension posts the card
(`src/inspector.ts`) and what the details show: a module by its path, a link
by its owner and ids, or a definition; the page reads the build's UHD bundle
itself.

- Every artifact is a card (images, 3D and STEP models, schematics, PCBs,
  datasheets, documents, design files, data), with a picture, the title, the
  kind and its source; a click opens it through `protoboard.openArtifact`'s
  path. Evidence and datasheets carry their source (host, authority, when
  fetched).
- The page loads pictures only (`src/inspectorFiles.ts`): images, a model's
  exported preview (`docs/images/part-<id>.png`), or a model of at most 2 MB
  drawn once as a still thumbnail; lazily; through webview URLs whose roots
  are the projects, their artifact packages and the library cache
  (`resourceRoots`). Nothing from the network.
- The DRC panel is the same kind of page (screen `drc`, `DrcPanel`). Neither
  has a page of HTML strings any more: `inspectorPage.ts`, `drcPage.ts` and
  `webviewKit.ts` are gone.

### 2.2 DRC (bottom panel)

The project's findings from `protoboard check` (UHD system checks, extension
checks, capability checks), refreshed on save and after operations.

- Two lanes like the earlier web app's board review: **Blocking** (errors) and **Warnings**;
  information hidden behind a toggle. Configured items are counted, not listed.
- One line per finding: code, a one-line message, the module it concerns.
  Expanding a row shows the reasons (the diagnostic's detail) and a short
  "what to do" taken from the extension's diagnostic-codes reference.
- Group by module, rule, or source (UHD / extension / provider); filter by
  text and severity.
- Row actions, as icon buttons with tooltips (the same actions as the
  Hierarchy's): **Locate** (focus in the viewer), **Open source** (the
  diagnostic's source location), **Explain** (the diagnostic-codes entry).
  Severity and grouping are themed segmented filters with counts.
- The VS Code Problems panel keeps receiving the same diagnostics;
  the DRC panel is the concise, model-shaped view of them.

### 2.3 Library

A parts browser over every **active library**.

- Search bar (debounced), a **Category** filter that drills one taxonomy
  level at a time with a breadcrumb and an "All in …" row (the earlier web
  app's `TaxonomyFilter`), and filters for domain and protocol.
- A paginated list (load more on scroll). Each item: thumbnail, name,
  manufacturer and MPN, revision, the library it comes from, and whether the
  project already uses it (and at which revision).
- Selecting an item opens a **preview** (webview): key facts, interfaces,
  CAD preview, datasheet link, revisions. Actions: **Add to project**
  (`protoboard parts add <id>@<rev>`), **Update** (when a newer revision
  exists), **Open in viewer** after adding.
- **Manage libraries**: the active libraries in order, with the Protoboard
  library as the default; add a library by URL, remove, reorder (drag a row
  by its handle within its scope, or the up/down arrows), sign in where
  a library requires it. Stored in the project config (and user settings for
  personal libraries).

Libraries speak an open protocol (section 4.2), so a library hosted by anyone
can appear here next to Protoboard's.

Status 2026-10-03: built as a webview view. The active
libraries and their URLs come from `protoboard libraries --format json`;
searching, the taxonomy and part details use the CLI's own library code
(`@protoboardai/core/library-client`, bundled: one merge, one cursor over every
library, the same error messages), so the extension and the CLI agree. Add
and Update run `protoboard parts add|update --library`; project libraries
are edited with `protoboard libraries add|remove|move`. Personal libraries
are the `protoboard.libraries` user setting, passed to the CLI as
`PROTOBOARD_USER_LIBRARIES` (the CLI reads it too) and searched after the
project's. The CLI gained `parts search --cursor/--facets` and `parts
taxonomy`. Sign-in waits for CL1: credentials are environment variable names
(`authEnv`) only.

### 2.4 Cloud

The project's relation to Protoboard Cloud and what it costs.

- **Account**: signed in or not, which account and organisation (also in the
  status bar). *Blocked by cloud accounts.*
- **Project**: whether the project is published, its releases in the cloud,
  their status. *Blocked by cloud project publishing.* **Open** beside
  Publish opens the project's system in the viewer, or brings its tab to the
  front when one is open.
- **Quotes**: active quotes and their status (the earlier web app's quote pipeline: submitted
  through done), what each covers. *Blocked by cloud quoting.*
- **Cost**: total = **bill of materials** + **manufacturing**. The BOM cost is
  computed locally from the release's ordering list (`ordering-list.csv`,
  offers from the catalog and sourcing evidence), each line linking back to
  the BOM row it comes from; unpriced lines are listed, not guessed.
  Manufacturing cost comes from a quote. *The BOM part is buildable now; the
  manufacturing part is blocked by quoting.*
- **Generate deployment artifacts**: one button that runs `protoboard release`
  (Manufacturing Package by units) and shows the result: the package folder,
  `index.html`, the overview PDF. **Publish** and **Request quote** sit next to
  it and stay disabled until the cloud supports them.

Status 2026-10-03: built as a webview view of floating cards.
Account, Project and Quotes say "not available yet"; the status bar has an
account item ("not signed in"). The cost is the project's bill of materials
(docs/specs/bom.md): the design's lines from the last build, each
priced in dollars from the offers the project holds (`parts/offers.json`,
sourcing records), with the cost per unit and the cost of the order;
unpriced lines are listed; made lines are manufacturing and need a quote. Each line focuses its module and opens its
row. Generate runs `protoboard release` (preconditions first) and opens
`index.html` in a tab or the browser, the overview PDF, or the folder.

### 2.5 The parts views

Status 2026-10-05, built from the first-pass designs
(`design/pb-vs-code-views.pen`, exports in `design/exports/pb-vs-code-views/`).
The views are `@protoboardai/views/parts` components (viewer-stack.md, "The
parts views"), drawn in the extension by one React bundle
(`dist/views-app.js`, Vite and Tailwind like the web shell) and following the
VS Code theme, high contrast included. The registration lives in
`src/partsViews.ts`, apart from the shell.

| Surface | Where | Data |
| --- | --- | --- |
| **Library** | Its own activity-bar container (not stacked with Cloud). Search, the category breadcrumb, the categories as a list that drills in and out with counts (it folds away), the order of the results, and the part cards with their carousels (viewer-stack.md): pictures, the title, a text carousel (Overview, Specs, Dimensions, Interfaces, CAD, Artifacts) in a box of fixed size, icon actions (Add part, Preview, Compare, more). A switch beside the order turns all cards together | As 2.3; a card's pages by a `pages` message (the revision from its library, pictures through the verified cache) |
| **Part detail** | An editor tab: the back control (Alt+Left, a contributed keybinding while the tab is active: **Protoboard: Back from Part Detail**) and the category trail, the pictures as a carousel, identifiers, state pills, actions as icon buttons (Add part, Compare, Open source, Datasheet, product page, Show in viewer, Copy id), and the sections as tabs (Overview, Specs, Dimensions, Interfaces, CAD with the model, Artifacts, Prices by source, Revisions; one the part has nothing for is left out). The model is fetched with the detail up to 25 MB, on request above | As 2.3; prices by a `prices` message (`partPrices`) |
| **Full library** | An editor tab sharing the sidebar's search: the same category list with counts, libraries, show-only filters, the order, grid or list | As 2.3 |
| **Manage libraries** | A settings tab: the account, the libraries in search order with URL, size and access, add by URL (a token by environment variable name only) | `protoboard libraries`, the user setting |
| **Project parts** | The side bar in its own container (a React webview, so its colours follow the theme): updates first, each library's parts at their pinned revision, then researched and designed parts; each row with its part status dot and its sync with the library, a badge for updates; Update, Restore, Compare, Submit for verification, Open source. A click on a row opens a library part's detail, and one of the project's own parts in the viewer where the system uses it (its source when nothing uses it yet). Its heading opens the page | `protoboard parts list` (offline), then `--check` |
| **Project Parts page** | An editor tab that looks like the library: the same cards with pictures and carousels (a library part's pages are its pinned revision's), grouped by tier (from libraries, researched, designed), each with its sync status (in sync, update available with the revision, diverged, local only) and part status; filters by sync status, grid or list. A part's "Project parts" breadcrumb returns here | The same list; pictures from the parts' libraries |
| **Cloud** | Its own container: the account (the CLI's sign-in), the project (name, description, libraries, parts, publishing), the releases and Generate Manufacturing Package, the cost as a preview, quotes | As 2.4, plus `whoami` |
| **BOM editor** | The project's bill of materials (docs/specs/bom.md), styled after the earlier Protoboard web app's: summary cards (parts, prices, per unit, order), lines grouped by module (or supplier) with a supplier chip that chooses among the offers held, a stock badge, need and buy (packs, minimum orders), unit, per-unit and order cost in dollars; units to build, Refresh offers, Export CSV; a list below 1080 px. **Open Bill of Materials** opens the design's bill (a tab that comes back after a window reload: `onWebviewPanel:protoboard.bomProject`, the page's saved state names the project); a release's `system/ordering-list.csv` opens in the same editor. Fits a 300 px wide tab | The shared cost model (`@protoboardai/ext-sourcing/lib/cost.ts`, also `protoboard bom`) |

**Words and colours every parts view shares.**

- **Revisions** are written `v4` (buttons, pills, lists, tooltips, the
  Revisions tab): `rev()` in `@protoboardai/views` (`parts/revision.ts`). The
  CLI's `id@rev` argument form and the file formats keep theirs.
- **Updating** is drawn with a download symbol, checking the libraries with a
  refresh symbol; an arrow pointing up is kept for submitting a part.
- **Sync status** (a project part against its library): in sync, update
  available with the revision, diverged (vendored files edited), local only,
  and pinned while the library has not been asked: `partSync()` in
  `parts/library-data.ts`.
- **Part status**: gray local, yellow unverified, green verified,
  blue official. The states and the one mapping from a library's data are
  `@protoboardai/core`'s `part-trust.ts`, which also says what today's data
  cannot tell apart (nothing a library serves says who maintains a part, so
  `official` only appears when a library reports it). The colours per colour
  scheme and the dot are `@protoboardai/views`' `parts/part-status.ts` and
  `PartStatusDot`; the same definition colours the dot on a module in the
  diagram (the viewer takes it as a generic mark, `nodeMarks`), the Project
  Parts side bar and page, a part's detail and the Inspector's cards. Every
  dot has a tooltip that says the state and what it means.
- **The order of the library's results**: the `sort` request parameter
  (`relevance`, `name`, `manufacturer`, `updated`) goes to every library. A
  library that lists capability `x-sort` in its discovery document orders
  its pages itself; for one that does not, the control offers by name and by
  manufacturer, made over the parts loaded so far, and says so
  (`sortState()` in `parts/library-data.ts`). It never offers an order that
  cannot be made.

## 3. Viewer integration

(v3: the tabs load the VS Code shell from the extension and read the bundle
and live rebuilds from `protoboard dev` over HTTP; the dev page is no longer
framed. The messages are the same, plus `openModule` and `openPair`: a
link's pair view opens as a viewer tab of its own at the link's level, its
`link`, `a` and `b` in the tab's URI and passed to the view as `params`. A
viewer's BOM tab opens the BOM editor, a VS Code editor of its own, rather
than drawing it in the viewer. The viewer has no Library tab (PB-1070): the
library is the Library side bar's, with its full page and part pages.)

The viewer runs as before (`protoboard dev`), with a host message
channel added to its embedding API (`mountViewer`):

- host → viewer: `focus(instancePath)`, `select(ids)`, `drill(path)`,
  `setView('diagram'|'3d')`;
- viewer → host: `selectionChanged`, `openSource(defId|instancePath)`,
  `openArtifact(...)`.

The extension relays between the viewer webview and its views. The viewer
remains usable alone (a browser tab with `protoboard dev`) and stays free of
VS Code specifics.

### 3.1 Starting, and a project made later

- **Activation.** `onStartupFinished`, besides `workspaceContains`: the
  extension runs in every window. It did not, and a `protoboard.config.ts`
  created after the window opened (an agent's `protoboard init`) was never
  noticed: VS Code reads `workspaceContains` when the window opens. The
  watcher for that file now exists in every window.
- **Context keys.** `protoboard.hasProject` and `protoboard.noProject`, both
  unset until the extension has looked. Every view needs one of them, so a
  window opened on a project never shows the start views first.
- **Context keys.** Besides the two above, `protoboard.needsSetup`: the
  current project's packages are neither installed nor linked.
- **A window with no project.** Each Protoboard container (Library, Project
  Parts, Cloud, the Inspector) has a start view, `protoboard.start.*`, shown
  under `protoboard.noProject || protoboard.needsSetup`: a tree view with
  nothing in it, whose `viewsWelcome` (VS Code's own pattern) offers **New
  Project** (`protoboard.newProject`), or **Initialize**
  (`protoboard.setupProject`) for a project that is not set up. The DRC panel
  has none: it stays away until there is a project.
- **New Project** (one command; Create Project… and New Project…
  were two before 0.1.7). What to start from (blank is the default, first; then the
  CLI's `init --list`, else the templates the stack ships) and a folder (the
  open one when empty, a new one inside it, or another), then `protoboard
  init`, which sets the project up from the Protoboard installed for the
  user: no terminal, no `npm install`. The former id, `protoboard.init`,
  still answers for callers, with the same implementation; it is not in the
  manifest. A build that carries no stack and finds no CLI says so instead
  of typing commands into a terminal.
- **Initialize.** `protoboard stack link` with the CLI the window resolves
  for the project. When no copy fits, the two ways to get one are buttons
  (a `.vsix` of that version, a registry).
- **Arrival.** A project found when the window opens, or appearing later,
  starts the same way (`arrive`): the Inspector's views gathered and brought
  to the front once per workspace (`protoboard.inspector.shownOnce` in the
  workspace state; never again by itself), the last build, the first viewer
  tab, and, signed in, the DRC panel, the first check and the dev server. A
  project that is not set up waits: the start views offer Initialize, and
  the folder is looked at every 3 s (an agent may be setting it up; file
  watchers leave `node_modules` out).
- **Notifications.** At most one unasked per window: Initialize for a
  project that is not set up, or New Project for an empty folder, once per
  folder. No other folder gets one; the theme offer waits for a project.
- **Buttons, not commands**. No message of the extension
  tells the user to run a command (a unit test reads the sources for it).
  Tool runtimes install from **Protoboard: Install a Tool Runtime (CAD,
  Circuit)…**, offered as a button where a failure names one; agents connect
  from the settings page and its offer; the PATH line from **Add the
  protoboard Command to PATH**.
- **Signed out**. The views and the viewer tabs stay and are
  not interactive. The extension posts one message to every page it draws,
  `{ type: "protoboard:access", signedOut, reason, message }`, and writes
  pages with `data-signed-out` when the user is signed out already. The
  overlay is the extension's own page code: `webview/signed-out.ts` in a
  viewer tab (loaded before the shell; it makes `#viewer` inert and posts the
  tab's `devAction` for its buttons) and the gate around every screen of
  `webview/views-app/main.tsx` except the settings page. The viewer's canvas
  code is not involved. The native tree views say it in their welcome and
  message, and every view's title has Sign In.
- **A `.uhd.ts` file in the viewer.** `protoboard.openSourceInViewer`: in
  `editor/title` (the Protoboard mark), `editor/context`,
  `editor/title/context` and `explorer/context` for `*.uhd.ts`, and a
  CodeLens above each definition the last build places in the file
  (`sourceModules.ts`; the lens follows the definition's id when the file
  was edited since). The tab opens beside the file on the first instance
  that uses the definition: on its own level when it has modules, else on
  its parent's with a `focus` message, so the part is selected.

## 4. Open protocol pieces (UHD)

Two parts of this belong to the open-source protocol, so other hosts and
libraries can take part:

### 4.1 Taxonomy

UHD today has free-form `categories` and `tags`. Port ProtoPart's taxonomy as
UHD's standard: a versioned tree of nodes (`id`, `name`, `description`,
`path` as dotted ids, links, agent notes) defined in a data file with a schema;
a module's `categories` hold taxonomy paths (any depth); consumers derive the
ancestor paths for subtree filtering. ProtoPart's tree (77 nodes, 11 roots,
version 2.1.0) is the starting point; kit membership (`kit.*`) carries over.
Libraries declare which taxonomy version they use and may extend it with
their own namespaced nodes. Validation flags unknown paths.

### 4.2 Library protocol

The parts service's HTTP API (search with facets and pagination, part detail,
revisions, exact-revision envelope, dependency closure, content-addressed
files) is written up as an open UHD specification, `uhd-library/v1`, with the
revision envelope as its data contract. Protoboard Cloud implements it; any
host can. The CLI and the extension accept several libraries in order (first
match wins for an id unless pinned to a library), each with its own URL and
optional credentials kept outside project data. Search across libraries
merges results and keeps the source library visible.

Status 2026-10-03: the protocol is UHD `docs/library-protocol.md`
with its JSON Schema and conformance kit (`@deltarobotics/uhd/library`);
Protoboard Cloud serves it (discovery, taxonomy filter, cursors, facets) and
runs the kit in its tests; the CLI has `libraries` in `protoboard.config.ts`
(`protoboard libraries list|add|remove|move`), merged `parts search`, and
`parts add` choosing by `--library`, then the pin in `origins.json` (which
now records `library`), then the first library that has the id. Credentials
come from environment variables named by `authEnv`; the keychain is not
built yet. The cloud keeps minting `protoboard.part-revision/v1` envelopes
(the same format) so that pinned envelope digests stay valid; it serves both
identifiers.

## 5. What is blocked

Accounts and sign-in, project publishing, quotes and the manufacturing part of
the cost depend on Protoboard Cloud features that do not exist yet. Their
views ship with clear "not available yet" states and disabled actions, so the
layout is complete and the features switch on when the cloud does.

## Settings page and agents

**Protoboard: Open Settings** opens the settings page (the account, the
version, the agents on this machine with Connect and Disconnect, the entry
for other MCP clients). The page, the first-run offer to connect agents and
the launcher an agent's configuration points at are specified in
[agents-and-mcp.md](agents-and-mcp.md), section 6.
