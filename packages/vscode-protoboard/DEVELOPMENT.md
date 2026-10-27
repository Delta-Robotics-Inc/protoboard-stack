# Protoboard for VS Code: developer reference

How the extension behaves, how it is built and how it is tested. The store
page is [README.md](README.md); the design is
`docs/specs/vscode-extension.md` and `docs/specs/viewer-stack.md`. It runs
the project's own `protoboard` CLI and lives in VS Code's own places:

| Where | What |
| --- | --- |
| Editor tabs | **The viewer**: one tab per module and view, as many as you like (below), each with its own **hierarchy** at its left: the tab's project as a tree, synced with its canvas (below). Source files and artifacts. |
| Secondary side bar (right): **Protoboard Inspector** | One view: what the focused viewer tab has selected, shown as the viewer's own inspector shows it, every artifact a card (below). |
| Activity bar: **Protoboard Library**, **Protoboard Project Parts**, **Protoboard Cloud** | **Library**: every active parts library, searched and filtered, with a preview and Add to project (below). **Project Parts**: the project's parts by library, each with its part status (gray local, yellow unverified, green verified, blue official) and its sync with the library (in sync, update available, diverged, local only); its heading opens the **Project Parts page**, the same parts as cards in an editor tab (below). **Cloud**: the account, the project, its releases and what it costs (below), and under it **Help**: Documentation, Feedback and Issues, Discord, in every window (also in the palette, `Protoboard: Open Documentation` and the rest, and in the status bar item's tooltip). Each container's main view has the container's name, so the side bar's title is that one name (not "PROTOBOARD LIBRARY: LIBRARY"). |
| Panel (next to Problems): **DRC** | The project's findings in severity lanes, one line each (below). Shown when a project opens. The only DRC: the viewer has none of its own. |
| Problems panel | Every finding at its source file and line. |
| Status bar | The Protoboard **0** mark and **Protoboard**, then one mark for the last check of the active editor's project (a check mark, a warning or an error; the counts are in the tooltip and in VS Code's own Problems item; click to check again), and the Protoboard Cloud account. |
| Icons | The Protoboard "0" (the zero of PR0TOBOARD) is the extension's icon, the Inspector's container and views, the viewer tabs' icon, the status bar's mark (`$(protoboard-logo)`, an icon font the extension contributes) and the viewer's header. `scripts/logo-assets.py` writes every file from the brand's drawing; each is one colour VS Code tints, except the extension's icon (orange on a dark tile). |
| Colour themes | **Protoboard Dark** and **Protoboard Light** (below), offered once, the first time the extension starts (it starts in a folder with a Protoboard project). |

| Command | What it does |
| --- | --- |
| **Protoboard: Open Viewer** | Opens the project's viewer tab at the top-level system (or reveals it), attaching to the project's running `protoboard dev` or starting one. |
| **Protoboard: Check** | Runs `protoboard build --format json` (every validator, as `protoboard check` runs them, plus `.protoboard/build/resolved.json` and the UHD bundle) and updates the Problems panel, the DRC view and the Inspector from that one run. |
| **Protoboard: Open Artifact** | Picks a part, then one of its artifacts: STEP and GLB open in the **Protoboard CAD Viewer** tab, PDF and other CAD or fabrication files in the system's application, sources and data (`.py`, `.kcl`, `.json`, `.csv`, images) in VS Code, links in the browser. |
| **Protoboard: Stop Dev Server** | Stops a dev server the extension started. For one started elsewhere it offers to send it SIGTERM. |
| **Protoboard: Show Log** | The **Protoboard** output channel: the dev server's log, each check's summary, operations run, library calls, layout saves. Its first line names the extension's version, which is also the stack's. |
| **Protoboard: About** | The same line in a message, with **Copy**. The extension and the stack (the CLI and its packages) share one version number; the build reads it from `packages/core/package.json` and stops when this package's own differs. |
| **Protoboard: Manage Libraries** | Opens the Library view's libraries panel: the active libraries in order, add by URL, remove, reorder. |
| **Protoboard: Back from Part Detail** | In a part's detail tab: back to the list it was opened from (the Library or the Project Parts page). **Alt+Left** while the tab is active; the same as the arrow at its top left. |
| **Protoboard: Add Part…** | `protoboard parts add <id>[@rev]`, from the first library that has the id. |
| **Protoboard: Generate Deployment Artifacts** | Runs `protoboard release` (the Manufacturing Package): the preconditions first, then the package, with progress in a notification and the CLI's output in the log. Then offers index.html, the overview PDF and the folder. |
| **Protoboard: Open Manufacturing Package** | The newest release's `index.html` in a VS Code tab. |
| **Protoboard: Get Catalog Offers** | `protoboard parts offers`: the library's supplier offers for the vendored catalog parts, into `parts/offers.json` (what the cost and a release quote). |

A project is checked when the window opens (`protoboard.check.onOpen`) and
again when one of its files is saved (`protoboard.check.onSave`) or after an
operation runs from the hierarchy. A build made elsewhere (`protoboard build`
in a terminal) updates the views too. Closing VS Code stops the dev servers
the extension started; servers it attached to keep running.

Install it from the [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=deltarobotics.vscode-protoboard)
(VS Code) or [Open VSX](https://open-vsx.org/extension/deltarobotics/vscode-protoboard)
(Cursor, Windsurf, VSCodium); see **Install** below.

**One install.** The `.vsix` carries the whole Protoboard stack (the
CLI, core, every `ext-*` package, the viewers and UHD; about 71 MB). It is
unpacked once per version into `~/.protoboard/stack/<version>`, with its
progress shown, and a project that has no packages of its own gets links to
it. No Node.js, npm or registry is needed; a project that was installed with
npm keeps using its own. The sections **Requirements**, **The stack the
extension carries** and **Sign-in** below say how; the design is
`docs/specs/distribution.md` in the repository.

| Command | What it does |
| --- | --- |
| **Protoboard: New Project…** | Asks for a template (`drone`, `wearable`, `iot`, or empty), a name and a folder, runs `protoboard init` and opens the project. Given `{ template, name, folder, open }` as its argument it asks only what is missing. |
| **Protoboard: Sign In** / **Sign In with a Code (Remote or Headless)** / **Sign Out** | `protoboard login` in a terminal: the browser sign-in, or a code to approve on another device (what a remote window uses by itself). They work before there is a project. |
| **Protoboard: Check the Account Again** | Asks the service again whether the account may use Protoboard. |
| **Protoboard: Show Where the Stack Is Installed** | Opens `~/.protoboard/stack/<version>`. |
| **Protoboard: Update Project to the Stack This Extension Carries** | Re-points a project's links from an older copy to the carried one (`protoboard stack link --force --carried`). |
| **Protoboard: Install the Stack Version the Project Pins (from a Registry)** | `protoboard stack install`: needs npm and a registry that has the packages. |
| **Protoboard: Add the Stack from Another .vsix File…** | Unpacks the stack another Protoboard `.vsix` carries into `~/.protoboard/stack/<version>`, without installing that extension: how a project that pins another version gets its stack with no npm and no registry. |

## Viewer tabs

The viewer is an editor tab (a custom editor, `protoboard.viewer`): the
module it shows, the view tabs that module supports, a toolbar and a legend,
and the canvas. Nothing else: the hierarchy and the inspection are the
Protoboard Inspector's, the design rule checks the DRC panel's.

- **Opens by default.** The first time a project is opened in a workspace,
  its viewer opens at the top-level system (`protoboard.viewer.openOnFirstVisit`).
  After that VS Code restores the tabs that were open, each on its module and
  view; a closed viewer stays closed. A project that appears later (an
  agent's `protoboard init`) gets the same once: see
  **A window with no project** below.
- **A `.uhd.ts` file in the viewer.** A `.uhd.ts` file opens as TypeScript.
  **Open in Protoboard Viewer** shows the module it defines, beside the file:
  the Protoboard mark in the editor's title bar, the entry in the editor's,
  the tab's and the Explorer's context menus, and an **Open in Viewer** lens
  above each definition (`protoboard.editor.codeLens`). The title button and
  the menus take the definition the cursor is in; a file with several, and no
  cursor in it, asks. A module with modules of its own opens on its own
  level; a part opens on its parent's level, selected. The modules of a file
  are the ones the project's last build knows: a definition nothing in the
  system uses yet has a lens that says so.
- **Isolate from the legend.** Every entry of the legend is a button: a
  click isolates that signal type, domain or DRC state (its links stay, with
  the interfaces and modules they touch; the rest fades). A click on it
  again, **Esc**, or the × in the legend's header shows everything; a click
  on another entry switches; Shift, Ctrl or Cmd holds several. It holds
  while the project rebuilds and from level to level.
- **3D shows the module of the tab.** A system's 3D tab shows the whole
  assembly; a module's shows that module alone (a board as its populated
  body). A card names what is shown and how much of it is placed. A module
  with no model says so, and how one is made (a board's is `out/board.glb`, written by
  `protoboard run circuit:generate --module <id>` and then `circuit:export`,
  and shown once the board's module lists it in its `artifacts`). **X-ray** sees through
  bodies that hold others; where none does, it is disabled and says why.
- **Several tabs.** Double-click a module (or **Open in New Viewer Tab** in
  its context menu, or in the hierarchy) to open it as a tab of its own;
  expanding it in place is in the context menu. The same module and view is
  always the same tab.
- **View tabs.** The header lists the views the module supports, from the
  view registry (`@protoboardai/views`): Diagram, 3D when there is a model,
  and the domain views (Schematic, PCB, BOM, Pair; planned ones show what is
  coming). Click switches the tab's view; Ctrl+click (or middle-click) opens
  the view in a new editor tab beside it. The library is not a viewer tab: it
  is the Library side bar, whose full page and part pages open as tabs of
  their own.
- **Hierarchy card.** The tab's hierarchy floats at its left, a card like the
  header, 4 px from the edges. The header's **Hierarchy** button opens and
  folds it (a short slide); folded, the canvas takes the whole tab.
- **Toolbar and legend.** Fit and zoom, then how links are drawn (one line
  per link or every conductor) and grounds. The legend holds the colouring
  (domain, DRC health, signal) it explains, and folds to its header; it
  starts folded on a narrow tab.
- **Layout.** Moving a module or a link marks the tab dirty (the tab's dot);
  **Save** (Ctrl+S) writes the edits to the project's display file
  (`.protoboard/display.json`, tracked in git, as the dev server would);
  undo and redo step through the edits; closing a dirty tab asks, and hot
  exit keeps unsaved edits. No layout is saved behind your back, and there is
  no reset button.
- **Keys.** Every key the viewer does not use reaches VS Code (Ctrl+J,
  Ctrl+B, Ctrl+P, Ctrl+S, …): the webview forwards key presses to the
  workbench, and the tab holds no frame that would swallow them.
- **Theme.** The tab follows the VS Code colour theme, high contrast
  included; the Protoboard faces (Kode Mono, bold Kode Mono for labels) and the orange appear
  only under a Protoboard colour theme. DRC colours are the same in every
  theme.

The page is the VS Code shell of `@protoboardai/web-viewer` (its
`src/vscode`), shipped in the extension (`dist/webview`), never loaded from a
server. It reads the project from `protoboard dev`: the bundle, its artifacts
and the state routes over HTTP (the dev server answers a VS Code webview's
origin with CORS headers, reads only), and the server's events for live
rebuilds. Its Content-Security-Policy allows the extension's own script by
nonce, and reading from the loopback dev server (and the forwarded origin in
a remote window); no frames.

### When a tab cannot read from the dev server

The dev server (`protoboard dev`) serves the project's model and files to the
viewer tabs and rebuilds them when the project changes. The extension starts
one per project, or attaches to one that runs already. When a tab cannot read
from it, the tab says so in the middle of the tab: what failed (the address
and the error), what the dev server is, and three buttons.

- **Retry** asks the extension whether the server still answers, starts a new
  one when it does not, and loads the tab again.
- **Reload Window** restarts the extension and every tab.
- **Show Log** opens the **Protoboard** output channel.

A tab also recovers by itself: a load that fails is tried again every few
seconds (under the other loopback name too: `localhost` for `127.0.0.1`), and
a page that VS Code loads again (a restored tab, a tab moved to another
window) is told where the server is again.

Rebuilds reach a tab on the server's event stream where the webview can open
one. VS Code 1.106 to at least 1.120 cannot (every attempt errors, though
plain requests work; 1.130 and later can),
and no VS Code reconnects a stream that was cut (a laptop that slept, a
network that changed). In both cases the tab asks the server for its state
every second instead and loads a newer build when it sees one; the log says
which way a tab follows the server. Only a server that does not answer at
all is a lost connection.

The log has what a report needs: the extension and VS Code versions, the
platform, the window's `PATH`, which Node.js and CLI run and how they were
found, the command and folder the server was started with, its process id,
the address and port it listens on, the address the tabs read from, and from
each tab every address it tried with the error it got. Copy the log into the
report.

## Protoboard Inspector

The secondary side bar's **Protoboard Inspector** is its only view
: the inspection of the selection. The hierarchy is in each viewer
tab (below). It follows whichever viewer tab has focus: with two tabs open
on two projects or modules, it switches with the focus. When another editor
takes the focus (a source file), it keeps the last tab's; with no viewer tab
open it says so in one line.

It comes to the front of the secondary side bar once: the first time a
project is open in a workspace. After that it stays where you put it; if you
keep an agent's chat in front there, it stays in front. Selecting something
in the viewer updates the Inspector's card and never takes the focus, or
brings the Inspector forward.

**Selection**. What the focused tab has selected, else the level it
shows, the way the viewer's own inspector shows it: the page is the
extension's React page with @deltarobotics/uhd-viewer's `SelectionDetails` in
it (the web viewer draws its inspector with the same components), read from
the build's UHD bundle.

- **The header** is the extension's: the kind's icon, the name, and icon
  buttons with tooltips (**Focus in the viewer**, **Open the pair view in a
  tab** for a link, **Open the part's page** for a part, **Open source**,
  **Run operation…**); then the kind, tier and part status as chips, and the
  findings here and below as counts and one bar.
- **The details** are the viewer's: kind, definition, manufacturer, part
  number and path; the description; the artifacts; the package; the evidence;
  the interfaces with a swatch in their colour, their protocol and what each
  is linked to; the pin table with the nets. A link shows its protocol,
  domain, state and harness, the pair it joins (its button opens the pair
  view), the harness's artifacts and its child links. A click on an end, a
  member or a functional link shows it in the viewer.
- **Every artifact is a card**, under its kind with a count: images, 3D and
  STEP models, a board's schematic and PCB drawings and its other outputs,
  datasheets, documents, design files (sources, print and cut files,
  firmware) and data (manifests, the geometry of single interfaces). None is
  left out and none is a plain row. A card shows a picture, the title, the
  kind and where the artifact comes from: a file's name and the tool that
  wrote it, or the host of its web address. A click opens it as **Open
  artifact…** does (a STEP or GLB in the CAD viewer, a drawing or source in
  an editor, a web address in the browser). Two cards a row where they fit;
  below 264 px one a row with the picture at the left.
- **Evidence**: whether the part's facts were audited, the performance its
  definition states, its assumptions, source conflicts and open data gaps,
  and its sources as cards (the kind of source, its host, its authority and
  when it was fetched). A datasheet's card says the same of its source when
  the evidence names its address. The files are the part's own:
  `parts/evidence/<id>/sources.json` and `verification.json` for a
  researched part, the files its revision carries for a catalog part
  (`parts/origins.json` says where).
- **After the details**: where a part is used, the modules below, the links
  the module declares (a click focuses one), and its blocking and warning
  findings (a click locates one; the question mark explains its code).

**What the page loads.** Pictures only, each lazily (a card that has not
scrolled into view asks for nothing), and only through webview URLs below
the page's roots: the projects, the packages their artifacts are in
(`package:<name>/…`) and the library's download cache. Not the workspace,
and not the network: a picture at a web address shows the kind's icon and
its host. A model's card shows the picture exported with the project's
documents where there is one (`docs/images/part-<id>.png`); else a model of
at most 2 MB is drawn once as a small still picture when its card comes
into view; a larger one is never loaded for the Inspector and shows an icon.
A datasheet or document shows its icon (no page is rendered). The
extension's log says when a picture did not load.

**Interfaces.** An interface picked in the Inspector's details has a card of its own
while the viewer keeps its module selected: its domain, protocols, roles and
parameters, what it is linked to on its module's level (a click focuses the
other end), and the geometry of its mating face as a card.

**Parts.** A part picked in **Project Parts** (a click or the keyboard) or
opened from the **Library** shows in the Inspector without taking the focus:
a project part with its part status and its sync with the library, where it
is used (a click focuses the instance), its findings, and its definition
shown as a module's is; a library part with its status, its revision's
definition shown the same way (the library's picture first, its body model
drawn small), its specs and whether the project uses it, and **Open the
part's page**. A selection in a viewer tab or the hierarchy takes the
Inspector back.

**One Inspector.** The Inspector is the container's one view, named as the
container. An earlier build's Hierarchy view (in this container, or dragged
somewhere else) is gone: VS Code drops a view no extension contributes.

### Hierarchy (in each viewer tab)

Each viewer tab has its own hierarchy, docked at its left beside the canvas
(the uhd-viewer's `ViewerHierarchy`, so the browser viewer of
`protoboard dev` has the same). It shows that tab's project only: the root
system, then its modules, parts and harnesses, each with an icon for its kind
(assembly, group, part, board, enclosure, structure, harness, fastener stack)
and a dot in its part status colour (gray local, yellow unverified, green
verified, blue official), with a legend at the bottom. Harnesses, cables and
fastener stacks are folded into one **Wiring & hardware** row at the bottom
with a count, so the tree shows the system's structure first. A row's icon
takes the colour of the worst error or warning here or below; a count beside
the name is the row's own.

- **Synced with the canvas.** A click selects the module on the level that
  holds it (the tab drills there); a double-click, or Enter on the selected
  row, drills into it. A selection on the canvas opens and highlights its
  row, and the level the tab shows is marked. The **Hierarchy** button at the
  left of the tab's toolbar opens and folds it; folded it is a thin rail. Its
  edge resizes it.
- **Keyboard.** Up and Down move, Right and Left open and close (or go to the
  child or the parent), Home and End, `*` opens the siblings, Enter and Space
  select. Typing filters (every word must be in a name, path or definition);
  Escape clears the filter. It is an ARIA tree for screen readers.
- **Right-click** on a row: VS Code's menu, with **Open in New Viewer Tab**,
  **Focus in Viewer**, **Open Source**, **Open Artifact of Module…** (when the
  definition lists artifacts), **Run Operation…** (the capability operations
  of a module with a provider config; runs `protoboard run <op> --module
  <id>`, then checks again) and **Filter Hierarchy…**.
- **Kept per tab**: open or folded, its width and its open rows stay with the
  tab (the webview's state), across a reload of the window.
- **Commands**: **Protoboard: Toggle Hierarchy** and **Filter Hierarchy…**
  act on the focused tab; **Reveal in Hierarchy** shows a module's row there.
  A module located from the DRC panel, a BOM line or a cost line is selected
  in the project's tab, and its row shown. Moving the cursor in a `.uhd.ts`
  file shows the module written there in the project's tab's hierarchy (the
  child declared on the cursor's line, else the definition above it).
- **Signed out**, the tab works the same: the viewer is local work.

## DRC

The findings of the last check, concise, in severity lanes: **Blocking**
(errors) and **Warnings** side by side, **Information** on request. Links
with no error or warning and the validators that ran are counted in the
summary line, not listed. A row is the code, the message's first clause and
the module; expanding it shows the whole message, its other clauses, what the
code means and what to do (from the installed extensions' code tables: the
`| Code | … |` tables in their READMEs and skill references, such as
ext-hardware's `diagnostic-codes.md`), and where it came from.

- **Filters**: themed segmented choices with counts, never the OS
  dropdown: severity (blocking and warnings, blocking only, warnings only),
  the information toggle, and grouping **by module** (a link's finding under
  the module that declares it), **by rule** (code) or **by source** (UHD,
  extension, provider, Protoboard); a text filter. Kept per workspace.
- **Row actions** are icon buttons with tooltips, the same as the
  hierarchy's and the Inspector's: **Locate in the viewer** (also reveals
  the module in the hierarchy), **Open source** (the finding's source file
  and line), **Explain** (the code's row in the extension's reference).
- The panel is @protoboardai/views' `DrcPanel` in the extension's React
  page, as the parts views are: Tailwind 4 over the theme's tokens,
  thin scroll bars that hide themselves, and on a light theme the deeper
  shades of the warning and information colours.
- **Check again** in the view's bar. The Problems panel keeps the same
  findings, each at its file and line; the DRC view is the model-shaped view
  of them.

## Colour themes

**Protoboard Dark** and **Protoboard Light** are VS Code colour
themes built from the Protoboard brand palette (`BRAND_TOKENS` in
`@protoboardai/views`) with the brand orange
(#FF5C00) as the accent: the workbench (bars, tabs, lists, inputs, buttons,
the status bar in orange), the editor, the terminal and syntax (TextMate and
semantic tokens), with the DRC colours for problems. The extension offers
them once in a notification; any answer, or closing it, is remembered. It
offers them when it first starts, and it starts only in a folder that holds a
Protoboard project (`protoboard.config.ts`): installed with no project open,
the offer waits until you open one. Both themes are always in **Preferences:
Color Theme** without it. They are the only place the orange appears in VS Code: every
Protoboard view follows whatever theme you use. `npm run themes` writes
`themes/*.json` from `src/themeColors.ts`; a test keeps them equal and checks
the contrast of text on its surfaces.

The same colours are also made for the terminal outside VS Code (not shipped
in the extension): `npm run themes` also writes Ghostty themes
(`themes/ghostty/Protoboard Dark` and `Protoboard Light`, from the integrated
terminal's palette) and herdr's `[theme]` tables (`themes/herdr/theme.toml`:
herdr follows Ghostty's palette and switches with the system's light or dark
setting, its own UI in Protoboard's surfaces and orange), from
`src/terminalThemes.ts`. `npm run themes:install` copies them into
`~/.config/ghostty/themes/`, sets Ghostty's `theme =` line and replaces
herdr's theme tables, saving each changed config as `<file>.<time>.bak`.
Reload Ghostty (ctrl+shift+, or cmd+shift+,) and herdr (prefix+shift+r).

## Library

A parts browser over every **active library** (spec § 2.3): the project's
libraries in `protoboard.config.ts` in their order (the Protoboard library
alone when the config lists none), then your personal ones.

- **Search** (debounced; Enter searches at once, Escape clears) across the
  libraries at once. Results are merged as `protoboard parts search` merges
  them: by part id, each with the library it comes from; a part whose id an
  earlier library also has says so on its library chip.
- **Category**: the libraries' taxonomy (`GET /v1/taxonomy`, merged by path),
  one level at a time with a breadcrumb and an **All in …** row. Counts follow
  the words, domain and protocol chosen (not the category, so siblings keep
  their counts). Category paths a library uses that the taxonomy lacks show
  too, from the search facets.
- **Domain** and **Protocol** filters, with counts from the search facets.
- **Results** in cards: thumbnail, name, manufacturer and MPN, the revision
  Add takes (the recommended one), the library, and `used @<rev>` when
  `parts/origins.json` pins the part (with `from <library>` when it came from
  another library); `update @<rev>` when that library recommends a newer
  revision. **Load more** (also on scrolling to the end) continues every
  library that has more, with one cursor (`nextCursor`) over all of them.
- **Pictures.** A render with a transparent background sits on the theme's
  surface; a photo shot on white sits on a light tile the white melts into
  (`mix-blend-mode: multiply`: white in light themes, a soft grey in dark
  ones; white tiles in high contrast). The kind is read from the picture's
  border once it has loaded; pictures are never re-rendered or keyed.
- **Card carousels.** A card turns without opening the part: under the
  title, a text carousel goes through **Overview, Specs, Dimensions,
  Interfaces, CAD** and **Artifacts** (the "‹ 2/6 ›" pager; with the card
  focused, ← and →), and the card stays the same size. A page the part has
  nothing for is left out. On top, the part's pictures (dots, and arrows on
  hover; Shift+← and → on a focused card) when it has more than one. The
  pages are read from the part's revision when the card is first rested on
  or turned; the CAD page shows a still picture, never the model. The link
  button beside the order **turns all cards together**, to compare one page
  (the specs, say) across the parts. The Project Parts page's cards do the
  same for library parts, at the revision the project pins.
- **Preview** (click a card): an editor tab with the part's pictures as a
  carousel (a larger view on the expand button) and its sections as tabs:
  the overview, specs, dimensions with an outline, interfaces, a **CAD
  preview** of its body GLB (three.js, bundled in the extension: nothing
  loads from a CDN; fetched with the detail up to 25 MB, on a button above
  that), artifacts by kind (datasheets, documents, CAD files with size and
  licence), **Prices**, and the revisions (view any of them).
  **Prices** lists what the part's library serves for it, by supplier: the
  price breaks per piece, currency (US dollars first, never converted),
  pack, minimum order, stock, the day the price was observed and a link to
  the supplier's page. They are read when the section is opened and need a
  signed-in account on the hosted library; signed out, the section says so
  and offers **Sign in**.
  Actions: **Add to project** (`protoboard parts add <id>@<rev> --library
  <id>`), **Update to v4** or **Pin v2** (`protoboard parts update <id>
  --to <n> --library <id>`; revisions are written "v4" in every view), **Open in viewer** (focuses the part's
  instances; a part no module uses yet opens the viewer and says so), **Open
  definition**. **Back** (top left, or **Alt+Left**) returns to the list the part was opened
  from (the full library or the Library view, scrolled where it was) and
  closes the detail; for a part opened from the project's parts it reads
  **Project parts** and opens the Project Parts page. After an add, the notification offers **Open in Viewer** too,
  and the project is checked again.
- **Categories and order.** The categories are a list that drills in and
  out: a row narrows the results and, when it has categories of its own,
  moves the list into it; the first row goes back up and **All in …** is the
  level itself; every row has its count, and the breadcrumb above jumps to
  any level. The order of the results offers what works: a library that
  sorts (capability `x-sort`) orders every page by relevance, name,
  manufacturer or most recently updated; for one that does not, by name and
  by manufacturer over the parts loaded so far, which the tooltip says.
- **Project Parts page** (**Protoboard: Open Project Parts Page**, the side
  bar's heading or its toolbar): the project's parts as the library's cards
  with their pictures, grouped by tier (from libraries, researched,
  designed). Each card carries its sync status with the library (in sync,
  update available with the revision, diverged when its vendored files were
  edited, local only) and its part status; the filters show one sync status,
  and the page says what an update is. **Update**, **Restore**, **Compare**,
  **Submit for verification** and **Open source** are on each card.
- **Manage Libraries** (the view's toolbar): the active libraries in order,
  each with its URL, scope (*default*, *project*, *personal*), the parts
  pinned to it, whether its token variable is set, and its discovery document
  (✓ name, version, open reads or token needed). Move up or down, remove, or
  add one by URL: its `/.well-known/uhd-library` document must answer and
  names the id (or give one); a library whose reads need a token needs the
  **name** of the environment variable that holds it. Project libraries are
  changed by `protoboard libraries add|remove|move` (the CLI rewrites
  `protoboard.config.ts`); personal ones are the `protoboard.libraries` user
  setting.

How it talks to libraries: the list and its URLs come from `protoboard
libraries --format json` (so the extension and the CLI cannot disagree about
which libraries are active, in which order, at which URL); searches, the
taxonomy, part details and files use the CLI's own library code
(`@protoboardai/core/library-client`: merge, cursor, error messages) and the
typed `uhd-library/v1` client, bundled into the extension. Personal libraries
reach every CLI run from VS Code as `PROTOBOARD_USER_LIBRARIES`, so `parts
add --library <personal id>` works and `origins.json` records it. Every
downloaded file (thumbnails, GLBs) is verified against its content address
and cached by it in the extension's global storage. Tokens are read from the
environment VS Code was started with, by the name in `authEnv`; they are
never written anywhere.

## Cloud

The project's relation to Protoboard Cloud and what it costs, as floating
cards (spec §2.4). What the cloud cannot do yet says so, with its actions
disabled and a tooltip that says why.

- **Account**: not signed in; cloud accounts are not available yet (also the
  status bar's account item).
- **Cost**: total = bill of materials + manufacturing. The bill of materials
  is the design's, from the last build: one line per part used, with what
  one unit needs. A line is priced from the offers the project holds: the
  library's in `parts/offers.json` (**Get the catalog's offers** runs
  `protoboard parts offers`) and the project's own sourcing records in
  `parts/evidence/<id>/sourcing.json`. Everything is in US dollars; a price
  in another currency is converted with a dated rate table and marked. The
  estimate shows what the parts of one unit cost and, when packs and minimum
  orders make it more, what the order costs. Lines with no price are listed
  under **Unpriced** and never estimated. Made lines (custom parts, boards,
  cable assembly) are listed under **Manufacturing (needs a quote)**: that
  cost comes from a quote. Each line's name focuses its module in the
  Explorer (and in the viewer when it is open).
- **Bill of materials** (**Protoboard: Open Bill of Materials**, the Cloud
  view, a viewer's BOM tab): summary cards, then the lines by top-level
  module. Per line: the supplier (a chip that lists the offers held; pick
  another and the project keeps it in `parts/bom.json`), a stock badge, the
  pieces needed and bought (whole packs and minimum orders, with a warning
  where pieces are left over), the unit price, the cost per unit and the
  cost of the order. **Units** sets how many to build. **Export CSV** writes
  the bill as shown. The same bill is `protoboard bom` in a terminal.
- **Deployment artifacts**: **Generate deployment artifacts** runs
  `protoboard release` (above). A refusal lists its problems; when the only
  one is uncommitted changes, the notification offers to release anyway
  (`--allow-dirty`, recorded in the manifest). The newest package is listed
  with **index.html** (a VS Code tab: its figures and fonts load from the
  package, in-page links scroll, links to the package's PDFs, CSVs and CAD
  open them), **in browser**, **00-overview.pdf** and **folder**. **Publish**
  and **Request quote** stay disabled until the cloud supports them.
- **Project** and **Quotes**: not available yet (cloud project publishing,
  cloud quoting).

The view refreshes when a release, `parts/offers.json` or a sourcing record
changes, and after each check.

Headings use Kode Mono (`media/fonts/`, SIL Open Font License,
`media/fonts/OFL.txt`); colours are VS Code's theme tokens, so light
and dark themes both work.

## Viewer host messages

The extension drives a viewer tab with the viewer's own host messages
(`uhd-viewer:focus` `{path}`, `uhd-viewer:select` `{ids}`, `uhd-viewer:drill`
`{path}`, `uhd-viewer:setView` `{view}`) and hears its events
(`uhd-viewer:ready`, `selectionChanged`, `openSource`, `openArtifact`,
`openModule`), wrapped in the tab's own messages (`@protoboardai/web-viewer`
`src/vscode/protocol.ts`: the dev server's address, view switches, layout
edits and saves, the tab's state), each checked field by field. Messages for
a tab wait until its page says it is ready.

Focus in Viewer and Locate send a module as `focus` with its instance path.
A link is drawn on the level of the module that declares it, so for a link
the extension sends `drill` to that module and then `select` with the link's
canonical path (`owner/local`; a root link by its plain id). A derived link
goes first by its own id, and the owner comes last, for a harness, whose
links show only when it is expanded in place. The viewer reports a link
selection by the same canonical path, which the hierarchy maps back to
resolved.json's `owner:local`.

## Requirements

- VS Code 1.106 or later. Nothing else for a `.vsix` that carries the stack.
- A development build of the extension (run from this repository, or
  packaged with `--no-stack`) carries no stack: its projects need their
  dependencies installed, so `node_modules/@protoboardai/cli` exists in the
  project or a folder above it (in this repository: `npm install` at the
  root).
- **Node.js.** The CLI needs Node.js 22 or later, and the extension finds one:
  a Node.js 22 or later on the window's `PATH`; else one where Homebrew
  (`/opt/homebrew/bin`, `/usr/local/bin`), Volta, nvm (the newest version
  installed), fnm, mise and asdf put `node` (a VS Code started from the macOS
  Dock or Finder does not have your shell's `PATH`); else **VS Code's own
  runtime**, run as Node (Node.js 22.20 in VS Code 1.106, newer in later
  versions). So a machine without Node.js, or with an older one, works. To
  choose one yourself, set `protoboard.nodePath` to its full path (`which
  node` in a terminal). **Protoboard: Show Log** says which Node.js and
  which CLI run, and why.
- For the viewer: the sibling `uhd-viewer` checkout built (`npm run build`
  there), as for `protoboard dev` itself.

## Install

Needs an editor built on VS Code 1.106 or later (`engines.vscode`): the
Protoboard Inspector is a secondary side bar container, a contribution point
VS Code finalized in 1.106. Older releases refuse to install the extension
rather than show it without its Inspector.

In the Extensions view, search for **Protoboard** (published by Delta
Robotics) and press **Install**: VS Code installs it from the Marketplace,
Cursor, Windsurf and VSCodium from Open VSX. Or from a terminal:

```sh
code --install-extension deltarobotics.vscode-protoboard
```

(`cursor` or `windsurf` in place of `code`.) The editor then keeps it up to
date. Each platform gets its own package (linux-x64, linux-arm64,
darwin-x64, darwin-arm64, win32-x64), which carries the stack's native
modules for that platform only. The full guide, by operating system and by
agent, is [docs/guides/installation.md](../../docs/guides/installation.md)
in the repository.

**Offline, or a build of your own:** install a `.vsix` file. The GitHub
release of each version has one per platform, with its SHA-256 beside it.
In the Extensions view: the `…` menu, **Install from VSIX…**, then the
file; or `code --install-extension <file>.vsix`. `protoboard setup --vsix
<file>` installs it into every editor it finds.

To build it yourself (`npm run package`, never published):

```sh
npm install                                  # at the repository root: the workspace, the viewer shell's dependencies
npm run build --prefix ../uhd-viewer         # the sibling uhd-viewer checkout, which the shell builds on
cd packages/vscode-protoboard
npm install                                  # its own dependencies; not part of the root workspace
npm run package                              # dist/vscode-protoboard.vsix, for every platform
code --install-extension dist/vscode-protoboard.vsix
```

`npm run package` builds the viewer shell (`npm run build -w
@protoboardai/web-viewer`), bundles the extension minified with the shell and
codicons in `dist/webview`, builds the stack it carries (`--platforms
<list>` for fewer platforms, `--no-stack` for none) and runs `vsce package
--no-dependencies`; the same steps every time. `--target <platform>`
(`linux-x64`, `darwin-arm64`, `win32-x64`, …) carries that platform's
native modules only and packages it for that platform (`vsce package
--target`): the release workflow (`.github/workflows/release.yml`) runs it
once per platform, each on a runner of that platform.

Reload the window when asked. To remove it: `code --uninstall-extension
deltarobotics.vscode-protoboard`. Then open a project folder (for example
`examples/quadcopter-5in`, or the repository root: the extension finds every
`protoboard.config.ts` outside `node_modules`, `.protoboard` and test scratch
folders): the viewer opens on the top-level system, the Inspector is in the
secondary side bar (View → Appearance → Secondary Side Bar, Ctrl+Alt+B, if
it is closed), the DRC in the panel.

## A window with no project

The extension runs in every window, so that it notices a project made after
the window opened.

- **No project yet.** The Protoboard Library, Project Parts and Cloud icons
  and the Protoboard Inspector are there, each with **New Project**: the one
  command that makes a project (it was two, Create Project… and New
  Project…). It asks what to start from (a blank project is the default, or
  a template: drone, IoT, wearable) and where (the open folder when it is
  empty, a new folder inside it, or another folder), and runs `protoboard
  init` with the CLI found in the one order (below). The project uses the
  Protoboard installed for your user: its packages are links to that copy,
  so nothing is installed into the project, and the viewer opens on it.
  A project made in another folder is offered to open, in a new window
  first; VS Code then asks whether you trust the folder.
- **A project that is not set up** (cloned, copied, or made where it could
  not be set up): the same views offer **Initialize** (**Protoboard:
  Initialize Project**). It links the project's packages to the Protoboard
  installed for your user (`protoboard stack link`): no npm, no registry,
  nothing downloaded. When no copy on the machine fits the version the
  project asks for, it offers the two ways to get one as buttons (from a
  `.vsix` of that version, or from a registry). Until then nothing of the
  project is checked or served, and nothing is put into it unasked.
- **One notification at most.** An empty folder is offered a new project,
  and a project that is not set up is offered Initialize: once per folder,
  never both in one window. A folder that is neither (someone's code,
  documents) gets no notification from Protoboard at all.
- **Signed out.** The views are there all the same, and say that signing in
  unlocks them (below).
- **A project appears.** When a `protoboard.config.ts` appears in the open
  folder (New Project, or an agent's `protoboard init`), the window comes up
  as if it had been opened on the project, with no reload: the views, the
  Inspector, the first check, the viewer tab and its dev server.

`protoboard init` makes a project only in an empty folder (or a new one): a
folder with a `.git` in it is not empty to it.

## The stack the extension carries

**Which CLI runs** for a project, in this order (the log says which one, as
"1 of 4" to "4 of 4"):

1. the project's own installed `@protoboardai/cli` (from `npm install`, or a
   link to a stack copy), looked up from the project folder upwards;
2. the `protoboard.cliPath` setting;
3. a stack copy in `~/.protoboard/stack` that matches the version the
   project pins, when the carried one does not;
4. the stack carried in the `.vsix`.

The project's own CLI now comes before the setting. A `protoboard` on `PATH`
(a global `npm install -g @protoboardai/cli`) is looked for only after these
four, so only in a build that carries no stack; its script is run with Node,
never through a `.cmd` shim.

The launcher an agent starts (**Protoboard: Open Settings**) records
the CLI found by the same order from the home folder, which is the carried
stack, with the Node.js the extension chose; it is recorded again when a
newer extension has unpacked its stack.

**A project without packages** (cloned, or copied from another machine) is
set up by **Initialize**: one link in the project's `node_modules` per
Protoboard package its `package.json` names, each to
`~/.protoboard/stack/<version>`, and `node_modules/.bin/protoboard`. A
project made by **New Project** or by `protoboard init` has them from the
start. In a terminal, a project command of the installed CLI links a project
that has none the same way, and says so in one line. Packages that npm
installed are never replaced. Where Node.js is installed, npm in a linked
project keeps each link whose version `package.json` accepts and adds what a
stack copy does not provide (TypeScript); a package whose range asks for
another version is fetched from a registry instead.

**Terminals** in VS Code get `~/.protoboard/bin` at the end of `PATH`
(`protoboard.terminal.addCommand`), so `protoboard check` works there, for
you and for an agent running in a terminal. In a project with its own CLI the
command runs that one. For terminals outside VS Code, and for an agent that
starts its own shell, **Protoboard: Add the protoboard Command to PATH** puts
the same folder on your PATH: one marked line at the end of your shell's
start file (`~/.zshrc`, `~/.bashrc` or `~/.bash_profile`, a fish `conf.d`
file, else `~/.profile`), or your user `Path` on Windows. It says what it
would change and changes it only on a yes; deleting the line undoes it.
Without it, `./node_modules/.bin/protoboard` in a project works anywhere and
needs no Node.js.

**A newer extension** unpacks its stack beside the older one. A project
linked to the older copy keeps working; the extension offers **Update
Project** once.

**Not carried:** TypeScript and `@types/node` (a project's own type check
needs them from npm), and tool runtimes, which stay per project and are
installed with a button: **Protoboard: Install a Tool Runtime (CAD,
Circuit)…**, also offered where a failure names a missing runtime (the
circuit runtime needs Node.js with npm, the CAD runtime Python).

## Sign-in

Only the Protoboard library needs an account (as decided on
2026-10-21: the stack is open source and only the hosted cloud is a paid
service), and all of it does, browsing and search included: signed out, the
extension asks the library nothing. The parts service enforces it (every
read of the library is `401` without a sign-in); the extension says so first.

**Signed out, local work is the same.** The viewer and CAD tabs, the
Inspector, the hierarchy, the DRC panel, Project Parts' list, the BOM and the
Cloud view work as signed in; the first check, the dev server and every local
command run; nothing is covered or disabled. **The cloud asks:** the
Library's side bar, its full page and a part's detail show **Sign in to use
the Protoboard library** (with **Sign In** and **Sign In with a Code**) in
place of the library, and list no parts. The commands in
`CLOUD_COMMANDS` (`src/account.ts`) ask to sign in instead of running:
**Fetch Parts**, **Add Part…**, **Check Libraries for Updates**, **Update
Part**, **Restore Pinned Revision**, **Compare with Library**, **Get Catalog
Offers** and **Submit for Verification…**. Project Parts asks the libraries
for updates only when the library can be used. The status bar shows **Sign
in** with a tooltip that says what it is for. **New Project** from a
template, signed out, offers to sign in first or to make the project without
its library parts, which **Fetch Parts** adds after a sign-in. The words
differ for: not signed in, a sign-in that no longer works, an account that is
not invited, and a library that cannot be reached.

The extension tells the views app's pages with one message, `{ type:
"protoboard:access", signedOut }`; only the Library's screens act on it (the
gate in `webview/views-app/main.tsx`).

**The sign-in is the user's, not a project's.** It is asked of the service
the project names, read from `protoboard.config.ts` as text when the project
cannot load (no packages yet), else of the service this machine is signed in
to, else of the hosted Protoboard library: never of localhost because a
project did not load. **A sign-in made anywhere is noticed at once** (in this
window, a terminal, an agent's shell): `protoboard login` and `logout` touch
a small file beside the credentials, which the extension looks at every
second and a half; the status bar, the views and the open viewer tabs
follow, with no reload and nothing to click.

A project whose library is a parts service without sign-in (local
development) is open. The extension's integration tests use their own,
empty config folder (signed out); one section signs out against a stand-in
service that requires an account.

## Which project

A command applies to the project that contains the active editor's file
(the innermost one), else the only project in the workspace, else the one used
last; otherwise it asks.

## Running a project's code

Checking, building and showing a project runs its code: its
`protoboard.config.ts` and model files, Initialize, the dev server, and the
project's own Protoboard CLI when it has one in `node_modules`. Before any of
that runs for a project folder the first time, Protoboard asks whether to run
that project's code, and remembers the answer for the folder (in
`trusted-projects.json` in your Protoboard config folder, readable by you
only). A project made with **Protoboard: New Project** is trusted, because you
made it. **Protoboard: Trust This Project's Code…** asks again. Protoboard does
not run in Restricted Mode, and `protoboard.cliPath` and `protoboard.nodePath`
are taken from your user or machine settings only, never from a workspace's
`.vscode/settings.json`.

## Protoboard settings and agents

**Protoboard: Open Settings** (also the gear in the Cloud view's title and the
account menu in the status bar) opens Protoboard's settings page in an editor
tab: the account, the version in use (the extension and the stack share one
number) and which CLI runs, the agents found on this machine, and the entry
for any other MCP client. VS Code's own `protoboard.*` settings are linked
from it, not repeated.

**Agents.** An agent that is connected knows Protoboard from the start: what
it is, how to start a project in an empty folder, and tools that run the
CLI's commands (status, init, check, inspect, build, parts search, add and
list, skills, the bill of materials, a release's preconditions). The page
lists Claude Code, Claude Desktop, Cursor, VS Code (Copilot agent mode),
Windsurf, Codex, Gemini CLI and Cline when they are installed, each with its
state and one button:

- **Connect** adds Protoboard's MCP server to that agent's configuration.
  Only that entry changes: the rest of the file keeps its comments, order and
  indentation, a copy of the file is kept beside it before the first change
  (`<file>.protoboard-backup`), and the row says what was written where.
- **Disconnect** removes that entry and nothing else.
- A file that does not parse is never written to; the row says so and opens it.
- Another server already named `protoboard` (the older web app's) is left as
  it is; this one is added beside it as `protoboard-stack`.

Nothing is changed without a click on that agent's row. Once, after the first
project or the first sign-in, a notification offers to connect the agents
found; **Connect…** shows them unchecked, and only the ones you check are
connected. `protoboard.agents.offerSetup` turns the offer off.
**Protoboard: Connect Agents (MCP)** shows the same list at any time.

**Other MCP clients** gives the entry as JSON, for VS Code's `mcp.json`, as
TOML, as a command and as a `claude mcp add` line, each with a copy button.

The entry runs a small launcher in Protoboard's per-user folder
(`~/.config/protoboard/agents`, `%APPDATA%\protoboard\agents` on Windows),
not a file of the extension or of a project, so it keeps working when the
extension updates. The same from a terminal: `protoboard agents`,
`protoboard agents setup`, `protoboard agents remove`, `protoboard agents
config`.

## Settings

| Setting | Default | Meaning |
| --- | --- | --- |
| `protoboard.cliPath` | empty | A particular CLI to run, used when the project has none of its own (the second of the four places above). A `.mjs`/`.js` path runs with `protoboard.nodePath`. User or machine settings only. |
| `protoboard.nodePath` | `node` | Node.js that runs the CLI (user or machine settings only). `node`: a Node.js 22 or later on the window's `PATH`, else one found where an installer or version manager puts it, else VS Code's own runtime. |
| `protoboard.terminal.addCommand` | `true` | Add the `protoboard` command to the window's terminals (`~/.protoboard/bin` at the end of `PATH`). |
| `protoboard.dev.port` | empty | Port for a dev server the extension starts. Empty: 5180 or the next free port. A port set here must be free. |
| `protoboard.check.onSave` | `true` | Check again when a file of a checked project is saved. |
| `protoboard.check.onOpen` | `true` | Check the project when the window opens, so the Explorer and the DRC view are current. |
| `protoboard.drc.revealOnOpen` | `true` | Show the DRC view in the panel when a project opens. |
| `protoboard.viewer.openOnFirstVisit` | `true` | Open the viewer at the top-level system the first time a project is opened in a workspace, or appears in it. |
| `protoboard.editor.codeLens` | `true` | Show **Open in Viewer** above each module a `.uhd.ts` file defines. |
| `protoboard.agents.offerSetup` | `true` | Offer once to connect the agents found on this machine to Protoboard's MCP server. Nothing changes without your choice per agent. |
| `protoboard.libraries` | `[]` | Your personal parts libraries, `[{ "id", "url", "authEnv"? }]`, searched after the project's. User settings only (never a workspace's). `authEnv` names an environment variable; a token is never stored. |

A project written for stack 0.1.0 has `node_modules/@protoboard/cli`: the
packages were renamed to `@protoboardai/…` in 0.1.1 (the `@protoboard` name
on npmjs belongs to someone else). The extension does not run that CLI. It
shows a warning that says what to change (replace `@protoboard/` with
`@protoboardai/` in `package.json`, `protoboard.config.ts`, the `*.config.ts`
files and the imports, point `@protoboardai:registry` in `.npmrc` at the
registry, run `npm install`), and `protoboard check` reports the same as
`PB_PACKAGE_SCOPE_RENAMED`.

## How it works

- **Attach or start.** A running `protoboard dev` records itself in
  `.protoboard/local/dev.json` (URL, port, pid, session) and its
  `/__protoboard/state` route returns the same session. Open Viewer attaches
  when the recorded server answers with the recorded session; a record left
  by a killed server does not answer and is ignored. Otherwise it starts
  `protoboard dev --format json` in the project and waits for the `listening`
  log line. Every log line goes to the output channel.
- **The tabs** load the VS Code shell from the extension and read the
  project from the dev server (bundle, artifacts, state, events), which
  answers a VS Code webview's origin with CORS headers for reads only;
  layout writes go through the extension (Save), never from the page. The
  URL goes through `vscode.env.asExternalUri`, so a remote window reaches the
  server through a forwarded port. In a browser-hosted window
  (code-server, Codespaces in the browser) the forwarded URL is the IDE's
  proxy, on another host and often under a path: the extension starts the
  server with `--allow-host '*' --host-origin self,vscode-webview://*,https://*`
  so it answers the proxy and takes the webview's https origin, and the dev
  page refers to everything relative to itself (a server attached to rather
  than started needs the same flags). This is covered by the CLI's tests, not
  yet tried in code-server itself. While a tab is open the extension looks
  for the server every 2 s: a restarted server (new session, same or another
  port) reloads the tabs; a stopped one is said over the canvas.
- **One build for every view.** Check runs `protoboard build --format json`
  and reads `.protoboard/build/resolved.json` (instances, links, origins and
  tiers, capability bindings, checks and diagnostics: the same findings
  `protoboard check` prints) and `uhd-bundle.json` next to it (interfaces,
  exports, fastener stacks). Both are derived data in an ignored folder. On
  opening, the last build is shown at once and replaced when the new one is
  done.
- **Problems.** Source paths in the check output are project-relative and
  lines 1-based; the range covers the line's text. A diagnostic without a
  source goes on `protoboard.config.ts`, line 1, with its entity named. The
  source column names the validator once (`protoboard/artifacts`,
  `protoboard uhd/checkSystem`, `@protoboardai/ext-hardware/evidence`); the
  code is the diagnostic code (`UHD_LINK_STATE`, `PB_ARTIFACT_UNAVAILABLE`,
  …). System findings sit at the link or instance they concern (a derived
  link at the first of its links), a catalog part's missing file at the
  part's entry in `parts/origins.json`.
- **Beside the viewer.** A file opened from the viewer, the Explorer, the
  DRC view or the Cloud view opens in the next editor group when the viewer
  is in the active one, so the viewer stays in sight.
- **Artifacts** come from `protoboard artifacts --format json`: every artifact
  of the parts in use, with the instances using each part and the absolute
  file it resolves to. Missing files and references without a file or URL are
  not offered. Each file in the picker has buttons to open it in VS Code
  instead, or reveal it in the file manager. STEP and GLB open in the CAD
  viewer; other files that are not text go to `vscode.env.openExternal`,
  the operating system's default application (`xdg-open` on Linux); when none
  opens the file, it is revealed instead.
- **The CAD viewer** (`src/cadEditor.ts`, `webview/cad-viewer.tsx`) is
  the default editor for `.step`, `.stp` and `.glb` (*Reopen Editor With…*
  still offers the text editor). It draws the model with the 3D view's own
  scene, lights and materials (uhd-viewer's `ModelView`) in the VS Code theme,
  high contrast included, with an icon toolbar: fit, isometric, top, front
  and right views, wireframe, x-ray, ground grid, turn, open in the system's
  application, reveal. A STEP exported together with a GLB of the same name
  (the stack's `body.step` and `body.glb`, `board.step` and `board.glb`) is
  drawn from that GLB; any other STEP is converted in the webview with
  occt-import-js (LGPL-2.1, shipped unmodified in `dist/` with its licences;
  nothing loads from a CDN). The viewer's inspector, the Explorer and the
  pair, schematic and PCB views open STEP and GLB artifacts here through the
  same path (`openArtifact`).

## Licence

The Protoboard extension and the stack it carries are open source under the
Apache License 2.0 (`LICENSE` and `NOTICE`, in the `.vsix`). The third-party
packages inside its bundles are listed with their licences in
`THIRD_PARTY_LICENSES.md`; occt-import-js and Open CASCADE (LGPL-2.1) ship
unmodified as separate files in `dist/` with their licences, and Kode Mono
under the SIL Open Font License (`media/fonts/OFL.txt`).

"Protoboard", its logo and the "0" mark are trademarks of Delta Robotics, Inc.
The code is free to fork, and a fork you distribute takes its own name and
icon: see `TRADEMARKS.md` in the Protoboard Stack repository (a draft under
legal review). The official extension is published only by Delta Robotics
(publisher `deltarobotics`).

**Open source and the Protoboard cloud.** The extension and the stack are
Apache-2.0. The hosted Protoboard cloud (the parts library and its content,
sign-in and accounts, the Library and Cloud views' service) is a separate
service run by Delta Robotics with its own terms, not covered by this licence.

## Development

```sh
npm run build              # dist/extension.cjs (esbuild, CommonJS; `vscode` is external)
npm run watch
npm run typecheck          # the root's TypeScript, with @types/vscode from this package
npm test                   # unit tests, run by the root's vitest (also part of the root `npm test`)
npm run test:integration   # VS Code itself, headless on Linux (below)
npm run package            # dist/vscode-protoboard.vsix (builds the viewer shell first)
npm run themes             # themes/*.json, Ghostty and herdr themes from src/themeColors.ts
npm run themes:install     # those Ghostty and herdr themes into this machine's configs
```

The viewer tabs' shell is `@protoboardai/web-viewer`'s `src/vscode`; `npm run
build` copies its build (`npm run build` at the root, which `npm install`
also runs) into `dist/webview`, so build the shell first after changing it.

**Visual captures** of the webviews as standalone pages, in the token sets a
real VS Code gives a webview (the integration test writes them):

```sh
PROTOBOARD_TOKENS_OUT=/tmp/tokens.json npm run test:integration
npx tsx test/visual/capture.ts --tokens /tmp/tokens.json --out /tmp/captures
```

The viewer tab (diagram, a selection, 3D, narrow), the Inspector (a module,
a catalog part's module, a researched part, a project part, a library part,
an interface, a link and nothing selected, at 320 and 220 px, scrolled
through) and the DRC panel (wide, narrow) in Dark Modern, Light Modern, both
High Contrast themes, Protoboard Dark and Protoboard Light. The Inspector's
pages get their files as the webview does, only from below their roots, and
the run reports the cards each selection drew and anything that was refused,
overflowed or failed.

To debug, open this folder in VS Code and run **Run Extension** from a launch
configuration of type `extensionHost` with
`"args": ["--extensionDevelopmentPath=${workspaceFolder}", "${workspaceFolder}/../../examples/quadcopter-5in"]`
after `npm run build`.

### Tests

The unit tests cover what does not need VS Code: mapping check output to
file, line and range (including the real CLI's check of the quadcopter, every
diagnostic placed in a file that exists on a line it has); finding the CLI;
the session record, the probe, and attaching to a real dev server from
`@protoboardai/cli`; starting a dev server (a stand-in script, and the real CLI
when the viewer is built) and stopping it; the monitor's stop and restart
reports; how each artifact opens; which project a command is about. For the
viewer tabs: their resources (project, module, view) and titles, the page and
its policy (the shipped script by nonce, reads from the dev server only, no
frames), the messages from the page checked field by field, a layout saved
into the display file as the dev server folds it (and refused without the
snapshot a level's first save needs), backups; the Inspector's card for a
module, a part and a link. The colour themes: equal to the generator's
output, the brand palette's surfaces and the orange, every text colour legible on its
surface. For the Explorer and the DRC view: the tree from a build
(hierarchy, kinds, sections, badges, findings placed on the right nodes, the
filter), where a module is written and which module a cursor is in, and the
same on the real CLI's build of the quadcopter; the DRC lanes, grouping,
filters, counted items and one-line messages; reading the code tables,
including the ones installed in this repository; the DRC page's themed
filters and icon actions. For the Cloud
view: the ordering list (CSV with quotes and rows' lines), pricing from the
list, catalog offers and sourcing evidence (price breaks, minimum orders,
per-currency totals), unpriced and made lines, the draft before a release,
finding releases, the view's model and page policy, a release run's outcome,
the package page (base, policy, which links open), and the quadcopter's own
ordering list when it has a release.

The integration test (`test/integration/suite.cjs`) downloads VS Code into
`.vscode-test/` (about 330 MB, once) and runs it with this extension on
`examples/quadcopter-5in`, with a throwaway profile:

1. the project is found;
2. **Check** fills the Problems panel, one entry per diagnostic, with
   `src/quadcopter.uhd.ts` among the files; the Explorer shows the system
   (with its fastener stacks) and the DRC view has every finding;
3. **Open Viewer** opens a viewer tab (a custom editor tab titled with the
   system's name) and starts the real `protoboard dev`; the tab's page loads
   the bundle from it and draws the diagram (its node count is reported), and
   lists the view tabs the registry offers; the Inspector shows the level;
   **Focus in Viewer** on a module selects it in the tab and the Inspector
   shows its card; a module opened as a new tab draws its own level, and the
   Inspector follows the focused tab; the same module again is the same tab;
4. the tab reports the `--vscode-*` token set in Dark Modern, Light Modern,
   both High Contrast themes, Protoboard Dark and Protoboard Light (the
   Protoboard ones carry the orange; `PROTOBOARD_TOKENS_OUT` writes them for
   the visual captures); **Stop Dev Server** stops the server and the record
   is removed;
5. the account item says "not signed in (cloud accounts not available yet)";
   **Generate deployment artifacts** runs the real `protoboard release` (the
   release record it writes in `operations/` is removed afterwards); the
   Cloud view lists the package with index.html and the overview PDF, and
   its cost comes from that release's ordering list, every line linked to its
   row and module; the package's index.html opens in a tab;
6. with a stand-in server that logs requests in place of the CLI (the
   test's own hook: the workspace's project has its own CLI, which comes
   before `protoboard.cliPath`), the tab loads the server's bundle (so the
   policy and CORS let it), and loads it again after the server restarts
   with a new session;
7. the **Library** lists the project's libraries through the real CLI,
   searches them, filters by a taxonomy root (the count matches the
   taxonomy's), loads a second page, and searches a personal library (the
   user setting) after the project's. It uses the library at
   `PROTOBOARD_TEST_LIBRARY_URL` when set (for example the dev catalog:
   `PB_CLOUD_DATA_DIR=.data/catalog PORT=8791 npx tsx src/server/main.ts` in
   protoboard-cloud, then `PROTOBOARD_TEST_LIBRARY_URL=http://127.0.0.1:8791`),
   and then also opens a part the quadcopter uses in the preview (pinned,
   with facts and revisions); otherwise a stand-in library
   (`test/integration/fake-library.mjs`).

On Linux without a display it runs VS Code with
`--ozone-platform=headless --disable-gpu`; no X server or `xvfb-run` is
needed. With a display, VS Code opens a window for the run. Extra arguments
go in `VSCODE_TEST_ARGS`, a VS Code version in `VSCODE_TEST_VERSION`.
`PROTOBOARD_TEST_QUICK=1` runs only the viewer steps.

`npm run test:integration` runs a second suite after the first
(`test/integration/run-new-project.mjs`, alone:
`npm run test:integration:new-project`): VS Code opens on a folder with no
project. The extension must start by itself; a project made there must come
up with no reload (found, checked, its viewer tab on a dev server, the
Inspector in front); a second project must not bring the Inspector back
after it was put away; and a `.uhd.ts` file must open in the viewer at the
level of the module it defines, from its lens and from the command.
`test/newproject.test.ts` covers the same without VS Code: the manifest
(activation, the start views and their welcomes, the menus), the choices of
Create Project, and the modules of a file.

### Manual checks

What the tests cannot see: dragging in a tab, keys, and files opened by other
applications. On `examples/quadcopter-5in`, with the `.vsix` installed:

1. **Open the folder.** The viewer tab opens on the quadcopter (first visit),
   the status bar says the dev server is starting, then the diagram shows.
   **Protoboard: Show Log** shows `starting protoboard dev …`, the build
   line and `serving quadcopter-5in at http://127.0.0.1:5180/`.
2. Drag a module in the tab: the tab shows the dirty dot. Ctrl+Z puts it
   back, Ctrl+Y moves it again; Ctrl+S writes `.protoboard/display.json`
   and the dot goes. Press Ctrl+J, Ctrl+B and Ctrl+P with the tab focused:
   the panel, the side bar and Quick Open toggle as in a text editor.
3. Edit `src/quadcopter.uhd.ts` (for example a module's `name`) and save: the
   diagram updates without reloading; the Problems panel updates too (on save).
4. In a terminal, stop the server (`kill <pid from .protoboard/local/dev.json>`):
   the tab says the dev server exited, in the middle of the tab; **Retry**
   (or **Open Viewer**) starts it again and the tab is back.
5. Close the tabs, run `npx protoboard dev` in a terminal, then **Open
   Viewer**: the log says `attached to protoboard dev … (pid …)` and no second
   server starts (one `dev.json`, one port). Stop the terminal's server: the
   tab says it stopped; start it again and the tab reloads by itself.
6. **Check.** The status bar shows *Protoboard* with a warning mark (the
   tooltip: 0 errors, 4 warnings, 20 info on the quadcopter) and the
   Problems panel lists the warnings at the links they concern in
   `src/quadcopter.uhd.ts` (`battery_pads`, line 90) and at the M9N's entry
   in `parts/origins.json`;
   clicking one opens the file at that line. Introduce an error (link a
   module to an interface that does not exist) and save: an error appears at
   that source.
7. **Open Artifact** → *MEPS NEON 2207 V2 1950KV Brushless Motor* → `cad_step`: the STEP file opens in
   the Protoboard CAD Viewer tab (drawn from the GLB exported with it);
   `cad_glb` in the same viewer; `cad_source` (`parts.py`) in a VS
   Code editor; `art_product_page` in the browser. The folder button reveals
   the file in the file manager.
8. Quit VS Code while a server it started is running: no `protoboard dev`
   process remains (`pgrep -fa "protoboard.mjs dev"`) and `dev.json` is gone.
9. The viewer tab's **hierarchy** at its left shows *5-inch 6S quadcopter*
   (`system`) with the frame, the arms (groups), the stack and the parts,
   each with its status dot; the harnesses and the hardware stacks are under
   **Wiring & hardware** at the bottom. The secondary side bar has the
   **Protoboard Inspector** only.
10. Type `motor` in the hierarchy: the arms and the motor leads stay, the
    rest goes. Escape clears it.
11. Click *FC + ESC stack* in the hierarchy: the tab selects it. Double-click
    it: the tab drills into the stack and the row is marked. Select a module
    on the canvas: its row opens and is highlighted.
12. Right-click `arm_fl/motor` → **Open Source** opens
    `src/modules/assemblies.uhd.ts` at `{ id: "motor", … }`; move the cursor
    in `src/quadcopter.uhd.ts` onto `{ id: "battery", … }`: the tab's
    hierarchy shows *6S battery*.
13. Right-click *Frame* → **Run Operation…** → `cad:check`: a notification with the
    result, then the views refresh.
14. The **DRC** tab in the panel: Blocking 0, Warnings 4; expand
    `UHD_PROPULSION_CURRENT`: the whole message and "What to do: Error:
    redesign. …"; **Explain** opens `diagnostic-codes.md` at its row; **Info**
    shows the 20 information findings; **By rule** groups them by code.
15. **Library** (with the dev catalog served and `PROTOBOARD_CLOUD_URL`
    pointing at it): 92 parts; **Category** → *Actuators* → *Motors* shows
    *All in Motors* and its sub-categories with counts; *Brushless Motors*
    lists the MEPS NEON with `used v2`. Type `esp32`: the list narrows as you
    type. Scroll to the end: the next page loads.
16. Click the MEPS NEON: the preview shows the motor turning in the CAD
    preview, its interfaces, the datasheet link (opens in the browser) and
    revisions v2 (recommended, pinned) and v1; **Show** on v1 offers
    **Pin v1**.
17. On a scratch copy of a project, **Add** a part from the list: the
    notification says `added`, `parts/origins.json` pins it, the card shows
    `used v1` (its revision), and **Open in Viewer** opens the viewer (saying that no module
    uses it yet).
18. **Manage Libraries**: the Protoboard library is listed as *default*; add
    the same URL again as *Personal* with id `mine`: it appears second, and
    results show both libraries; remove it. Switch to light and dark themes:
    both read well.
19. **Cloud.** Account: not signed in. Cost from `release/0.1.0`: the
    bill of materials has no price yet (no offers recorded: 20 unpriced lines
    listed), manufacturing needs a quote (frame and top plate). Click
    *DJI O4 Air Unit*: the Explorer selects `video`; **row 5** opens the
    ordering list at that line. **Generate deployment artifacts**: a
    notification with the steps; then **Open index.html** shows the package
    in a tab (figures and Kode Mono load; a link to `system/bom.csv` opens
    it). **Publish** and **Request quote** are greyed, with a tooltip.
