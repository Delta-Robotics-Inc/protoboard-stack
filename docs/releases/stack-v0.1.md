# Protoboard Stack v0.1 — release notes

The 0.1 line, from 0.1.0 (2026-10-03) to 0.1.7, before the stack was public.
The [0.2 release notes](stack-v0.2.md) come after it.

Protoboard Stack is a framework for agents and people to develop, check and
release hardware projects, "Next.js for hardware": initialize a project,
install capabilities from npm, work in VS Code with an agent, view the UHD
model locally, drive native engineering tools, and cut a versioned
Manufacturing Package. v0.1 was the first release: the framework, the
CLI, twelve extensions, the VS Code extension, a local parts library, and
three reference projects that go from brief to release.

Start with the [quickstart](../quickstart.md).

## 0.1.7 (2026-10-17)

The round after two real projects were built on the stack (a nebuliser demo
and a large board made on Windows): the PCB goes from UHD through
tscircuit to KiCad, a board can be grouped into sub-modules, projects made on
Windows open on a Mac or Linux, and every agent gets one install story.
Install the new `.vsix`, or `npm install -g @protoboardai/cli`; a project
moves as for 0.1.5. A project with vendored parts runs `protoboard parts
migrate` once (until then it still loads, and `check` says so).

- **The PCB tab.** A routed board is drawn from its provider's result, never
  routed again: each copper layer, silkscreen, courtyard and fabrication
  layer on each side, drills, edge and keep-outs, each on and off by itself;
  zoom and pan as on the canvas, and the board seen from below. A net lights
  up across the board on hover or click; a component shows its reference,
  part and footprint, and picked, it shows in the Inspector with an **On the
  board** section (side, position). The board check's findings are drawn
  where they are: every `circuit:check` finding now says its place (position,
  layer, the components, pads and nets it concerns).
- **KiCad 10 at design lock.** tscircuit is the layout while the design
  changes; KiCad is the layout once you lock the board. `circuit:kicad`
  writes a KiCad project of the current build as a preview. `circuit:lock`
  writes the KiCad project into the board's `kicad/` folder with a handoff
  record, all or nothing; `circuit:unlock` archives it and returns the board
  to tscircuit. On a locked board, `circuit:check` compares the record, the
  model and the KiCad files and says what changed on which side (a part
  added in the model, a net renamed in KiCad, fields to update), and writes
  nothing back. A locked board's fabrication outputs come from `kicad-cli`
  (Gerbers, drills, pick-and-place, STEP and GLB in the stack's board frame,
  SVGs, DRC); a DRC error stops the export and says how to fix or force it.
  Reference designators are stable: recorded once per part, kept through
  lock, unlock and moves into a group, and by kind (R, C, L, FB, D, Q, Y, F,
  BT, LS, J, SW, U). Two KiCad skills (layout review, `kicad-cli`) ship with
  the circuit provider; agents ask before locking or unlocking.
- **Nested boards.** A board may group its parts into sub-modules to any
  depth, so the diagram stays readable while the PCB has every part. The
  circuit provider, `check` and `release` read the same expanded board: a
  bus or net crossing into a sub-module is one conductor, designators and
  placements follow the part's path, each sub-module is a KiCad group, and a
  child board or a daughterboard stays a separate PCB. A flat board reads
  exactly as before.
- **The circuit provider.** A pin with several pads (an ESP32-C3's ground
  pads) has every pad netted, joined and checked; the two example boards
  now join all of theirs. Parts' 3D bodies and supplier numbers (LCSC
  first) go into the board, the BOM and pick-and-place; land patterns match
  by package family and a misfit is reported. New board settings: routing
  off, trace widths per net and per class, a via policy and a hole
  clearance. On Windows, part bodies load in `board.glb`; a large board's
  STEP export no longer fails; an export that fails leaves the last good
  `out/` in place. The build notices changes to the JSON a hand-written
  layout imports, and `out/` goes stale only when what the board depends on
  changes (not a description or a price).
- **Projects across systems.** Every path the stack writes into a project
  uses forward slashes, and paths written with backslashes are read: a
  project made on Windows checks clean on macOS and Linux. Vendored parts go
  to short folders (`protoboard parts migrate` moves an earlier project), so
  a nested project stays within Windows' path limit.
- **Agents.** `protoboard init` writes a `CLAUDE.md` that imports
  `AGENTS.md` (Claude Code does not read `AGENTS.md` by itself) and keeps
  one that is already there. `AGENTS.md` and the MCP server tell one install
  story (the Protoboard on the machine; no `npm install` unless you asked for
  a project-local stack), list skills by name (`protoboard skills read
  <name>`) instead of one machine's paths, say how a project nested in a
  company workspace stands to it, and how parts are placed in the 3D view.
  The stack's MCP server is named `protoboard-stack` in every agent;
  `protoboard agents setup` renames its earlier `protoboard` entry and never
  touches the alpha web app's. `protoboard doctor` says how to refresh an old
  project's guidance.
- **Blank projects and extensions.** A blank project includes the hardware
  extension and its skills. `protoboard extensions add` adds an extension
  without npm.
- **The extension.** Signed out, the buttons and menus VS Code draws itself
  look disabled too. The Inspector and the DRC panel keep their size through
  a sign-out and a sign-in. A viewer tab of a folder that is gone closes
  itself, and a project whose folder is gone is no longer the current
  project.
- **The parts library.** Search finds parts by the words people use:
  nebulizer, inhaler, breath, pump and level sensor find the atomiser,
  airflow, pump and level-sensing parts. The downloads list shows only the
  newest version of each product.
- **Smaller things.** Releases live in `release/<version>/` everywhere. A
  provider can declare operations of its own beside the four, and `--force`
  reaches those that take it. The `display.json` format (diagram layout, 3D
  placements, camera) is documented.

Packages: the stack's packages and the VS Code extension are 0.1.7;
`@deltarobotics/uhd-viewer` stays 0.1.4 and `@protoboardai/cloud` 0.1.2
(neither package changed; the library service gained search synonyms and
the downloads list), `@deltarobotics/uhd` 0.2.1.

Not verified in this release: Windows and macOS beyond what CI covers
, and the KiCad steps anywhere but Linux with KiCad 10.

## 0.1.6 (2026-10-11)

Three fixes on 0.1.5, found by the Windows run and in review. Install the new
`.vsix`, or `npm install -g @protoboardai/cli`; a project moves as for 0.1.5.

- **Windows: Open in Viewer from a source file.** In a new project, opening
  the viewer from a `.uhd.ts` file did nothing: the build recorded source
  files with backslashes and the file's modules were not found. The build
  now records them with forward slashes on every system, and the extension
  also reads the records an earlier version wrote.
- **Windows: stopping a dev server leaves no stale record.** The server's
  process ended before it could remove its record, so the next start could
  be told a server was already running.
- **Wording.** Signed in, the welcome of a window without a project no
  longer says to sign in first; the settings page and the sign-in pages no
  longer say that browsing needs no account.

Packages: the stack's packages and the VS Code extension are 0.1.6;
`@deltarobotics/uhd-viewer` stays 0.1.4, `@protoboardai/cloud` 0.1.2 and
`@deltarobotics/uhd` 0.2.1.

## 0.1.5 (2026-10-11)

The round after the first builds by teammates on a Mac and on Windows:
installing Protoboard and opening a project no longer needs npm, VS Code
starts and initialises projects itself, a signed-out window keeps everything
in view, and the canvas is worked as a canvas. Install it with the new
`.vsix` alone (it carries the stack), or with `npm install -g
@protoboardai/cli` and `protoboard setup`. An existing project moves by
installing the new `.vsix` and **Protoboard: Update Project to the Stack This
Extension Carries** (a linked project), or by `npm update` (a project
installed by npm; its ranges admit this version).

- **Installing.** There is one installation guide, for people and for their
  agents, with two routes (the website, the command line) and no version
  numbers to copy; the downloads site serves it as a page and as plain text.
  The site is one column with the agent's route first. The extension is
  downloaded signed in, from the site, by an invited account. The catalog
  snapshot is no longer offered for download.
- **Global by default.** A project uses the Protoboard installed for the
  user (`~/.protoboard/stack/<version>`), through links; nothing is
  installed into a project unless you ask (`protoboard init --stack
  project`). A CLI that npm installed installs that copy once per version,
  not once per project. `protoboard stack link` works from any CLI.
- **`protoboard setup`.** Installs the extension into VS Code, Cursor and
  Windsurf (it asks about each; `--yes` does not; `--editor` names one),
  from `--vsix <file>` or, signed in, from the downloads site with its
  checksum checked; then offers to put `protoboard` on your `PATH` and to
  connect your agents. It never runs by itself.
- **VS Code starts and sets up projects.** The extension is active in every
  window. In an empty folder its views offer **New Project** (one command:
  blank or from a template, no npm, no registry). In a project that is not
  set up they offer **Initialize**. No message asks you to run a command:
  the tool runtimes, the `PATH` entry and the registry pass have buttons. A
  new project ends by offering to open it in a new window. When several
  projects appear in a window at once, only the current one gets a viewer
  tab and a server.
- **Signed out, everything is still there.** The views keep their state and
  say that signing in unlocks them; the canvas opens under an overlay with
  the sign-in action on it; nothing can be changed until you sign in. A
  sign-in made anywhere (the terminal, another window) is noticed within
  two seconds, and the status bar says who is signed in.
- **Sign-in fixes.** On Windows the sign-in link reaches the browser whole
  (it was cut at its first `&`: "This sign-in link is not valid"). A project
  that cannot load no longer has its sign-in checked against an address on
  your own machine, so a signed-in person is not shown as signed out. An
  npm `E401` or `E403` from the registry says its cause (the one-hour
  registry pass ran out) and the fix.
- **The canvas.** Select and pan tools in the toolbar; drag a box to select
  several modules; pan with the middle button or space and drag; keys and a
  menu on modules and on the background, with **Inspect**. A module that
  holds modules shows a chevron: a click on it expands the module in place,
  a double-click on the module opens it; a part with nothing inside no
  longer opens an empty tab. The diagram fits the view when it first opens.
  A module card grows as wide as its interface labels need, and a label that
  is still cut says its whole name on hover. Tooltips follow the theme, wrap
  and are capped; icon-only buttons and the status bar's counters have
  labels.
- **The Inspector and tabs.** Selecting a module reveals the Inspector,
  without taking the keyboard. A blank block (a module of the project with a
  name and interfaces, no part chosen yet) is drawn as a dashed gray ring
  and says **Blank block**. The Inspector's open-source action shows the
  file it opens; a viewer tab names its module, shows its source file in
  the header and opens it from there; a part's tab is named after the part.
- **Agents.** A new project's `AGENTS.md` has a glossary (module, interface,
  link, harness, DRC, and what people call them on screen), says that
  Protoboard is installed for the user, and lets an agent write the diagram's
  layout file. The build skill goes from concept to PCB in five levels and
  asks before each, asks plain scoping questions, looks at the real project
  before describing it, and asks whether to carry over or link another
  project's research. New projects list the sourcing extension.
- **The parts library.** Twenty parts for an ultrasonic mesh atomiser
  prototype (transducers, drivers, flow and breath sensing, pump options),
  with their evidence, generated CAD, thumbnails and supplier offers.
- **Windows.** The stack is built and tested on Windows on every push of a
  release branch: the installs and builds, the CLI from Git Bash and
  PowerShell, every template in a path with spaces, the extension in a real
  VS Code. The web viewer now builds at install there.
- **Smaller things.** The dev server takes any free port when its first
  twenty are taken. `login`, `logout`, `whoami` and `setup` never write into
  a project. In Protoboard Light, hierarchy rows with findings are readable
  (their words were yellow on light gray). The terminal UI that read board
  files of the older web app is removed.

Packages: the stack's packages and the VS Code extension are 0.1.5;
`@deltarobotics/uhd-viewer` is 0.1.4 (the canvas); `@protoboardai/cloud`
stays 0.1.2 (its client and service did not change; the library gained
parts); `@deltarobotics/uhd` stays 0.2.1.

Not verified in this release: the extension and `protoboard setup` on a
real Windows or macOS machine beyond what the CI runs cover (packaging the
extension on Windows is known not to work yet), and a completed sign-in
against the hosted service from the new build.

## 0.1.4 (2026-10-08)

Stage 2 of the pass after the first beta test: the extension is enough to
install, a sign-in is required, agents are connected, and the viewer, the
Inspector, the part cards and the bill of materials follow the reviews. Install
it with the `.vsix` alone (it carries the stack), or with
`@protoboardai/cli@0.1.4`. An existing project moves by installing the new
`.vsix` and **Protoboard: Update Project to the Stack This Extension
Carries** (a linked project), or by `npm update` (a project installed by npm;
its ranges admit 0.1.4).

- **The extension carries the stack.** `vscode-protoboard-0.1.4.vsix`
  holds the CLI, core, every `ext-*`, the viewers and UHD for six platforms,
  unpacks them once into `~/.protoboard/stack/0.1.4`, and puts `protoboard`
  on the `PATH` of VS Code's terminals. No Node.js, npm or registry access
  is needed: the CLI runs on VS Code's own runtime where the machine has no
  Node.js 22. A project without packages is linked to the stack copy the
  first time the CLI runs there. The CLI of a project is found in one order:
  the project's own, `protoboard.cliPath`, a stack copy matching the
  project's pin, the carried stack; a build that carries no stack still
  finds a global install on `PATH`. New commands: `protoboard stack`,
  **New Project…**, **Show Where the Stack Is Installed**, **Update
  Project…**, **Add the Stack from Another .vsix File…**, and a **Get
  Started** walkthrough.
- **Sign-in required, for now.** One switch in
  `packages/core/src/access.ts`. Signed out, every CLI command but `login`,
  `logout`, `whoami`, `doctor`, `stack`, `mcp` and `agents` exits 4 with
  `SIGN_IN_REQUIRED`; the VS Code views, viewer tabs and CAD tabs show a
  sign-in screen, in a window with no project too, and nothing of a project
  runs behind it. Offline, a sign-in is accepted for 7 days after the
  service last confirmed it. `PROTOBOARD_SIGN_IN=off` turns it off for
  development. It is a rule on the user's machine, not a security boundary.
- **Agents and MCP.** `protoboard mcp` is an MCP server with the
  CLI's reading and checking commands as tools (`project_status` first);
  `protoboard agents` detects Claude Code, Cursor, Codex, Gemini CLI,
  Windsurf, Cline and others and adds or removes Protoboard's entry in their
  configuration, changing only that entry and keeping a backup. **Protoboard:
  Open Settings** is a page with the account, the version, the agents
  (Connect, Disconnect), the entry for any other MCP client, and links to
  the first steps, Create Project, the bill of materials and the stack's
  folder. The extension offers once to connect the agents it finds. The
  launcher an agent starts runs the CLI the extension itself would run. A
  machine that already has another server named `protoboard` (the alpha
  app's) gets this one as `protoboard-stack`.
- **A project made after the window opened.** The extension starts
  in every window. The Protoboard views of a window with no project offer
  **Create a Project**; a project that appears (that command, or an agent's
  `protoboard init`) comes up with no reload: views, Inspector, check, viewer
  tab. A `.uhd.ts` file has **Open in Viewer** above each module and in its
  title bar. A project that names parts it does not hold still draws, with
  placeholders and how to fetch them.
- **Viewer.** A click on a legend entry (a signal type or a
  domain) shows it alone and fades the rest; Escape shows everything again.
  A module's 3D tab shows that module alone, says what it shows, is lit for
  its background, and X-ray says when it has nothing to see through. A
  module expanded in place holds what is in it. The Inspector comes to the
  front once per workspace and then stays where it is put.
- **Inspector.** The VS Code Inspector shows a module the
  way the viewer's own inspector does (the same components), with every
  artifact as a card under its kind, evidence with its sources, and readable
  text in light and high-contrast themes. A part's Artifacts tab in the
  library uses the same cards.
- **Part cards and part detail.** A card turns through pictures and
  through pages of text (overview, specs, dimensions, interfaces, CAD,
  artifacts) without changing size. The part detail follows design 08, with
  tabs for the same sections, prices by source, and Alt+Left to go back.
  `protoboard dev` serves a part's pages and prices to the web viewer.
- **Bill of materials.** `protoboard bom` is the design's bill in US
  dollars (schema `protoboard.bom/v0`): packs, minimum orders and price
  breaks, the cost per unit and the cost of the order, `--units`, the offer
  chosen per line (`bom offers`, `bom choose`), JSON and CSV. The BOM editor
  is restyled after the alpha's. A quote may carry `raised` (the order went
  up to a price break that costs less). New files: `parts/bom.json`,
  `parts/fx-rates.json`. A release's `ordering-list.csv` is in USD with four
  new columns and follows the offers chosen in the BOM; `currency` in
  `protoboard.config.ts` no longer changes it. New diagnostics:
  `PB_BOM_SETTINGS_INVALID`, `PB_FX_RATES_INVALID`.
- **The package's first page.** `docs/product.json` states what the
  product is (summary, features, functions, requirements); the Manufacturing
  Package and the datasheet open with it. `release --check` warns
  `REL_PRODUCT_NOT_STATED` when it is empty.
- **Versions.** `@protoboardai/core`, `cli`, `views`, `web-viewer`, the
  twelve `ext-*` and the VS Code extension are 0.1.4.
  `@deltarobotics/uhd-viewer` is 0.1.3 (the CLI, views and web viewer need
  `^0.1.3`) and must be published before them. `@protoboardai/cloud` stays
  0.1.2 and the parts service is unchanged: nothing to deploy there. The CLI
  now depends on `@modelcontextprotocol/sdk`. UHD stays 0.2.1.

Known limits of 0.1.4:

- Two commands make a project by hand: **Create Project…** (in the open
  folder, asks about a template's parts first) and **New Project…** (a named
  folder anywhere). They are to become one.
- The `iot` and `wearable` templates' board shows "no 3D model yet" until its
  outputs are generated; the template lists no artifacts for it.
- The bill of materials adds no spares; a release does, so the two totals
  differ.
- The downloads site served the small `.vsix` without the stack.
- Nothing here was run on macOS or Windows by a person; see
  `docs/specs/distribution.md` for what was verified and how.

## 0.1.3 (2026-10-07)

What the first beta test found on a Mac (2026-10-06), and the parts views.
Nothing in a project changes: no part, digest, output or config key. Install
it with `@protoboardai/cli@0.1.3`; an existing project moves by `npm update`
(its ranges admit 0.1.3) and installs the new `.vsix`.

- **One version number.** The VS Code extension is 0.1.3 too, and moves with
  the stack from now on. The downloads site, `protoboard --version`, the
  extension's page, the first line of **Protoboard: Show Log** and the new
  **Protoboard: About** show the same number. UHD keeps its own (0.2.1).
- **Viewer tabs reach the dev server.** In VS Code 1.106 to at least
  1.120 a webview cannot open the dev server's event stream, so a tab stayed
  on "The dev server is unreachable" or "Waiting for the project's dev
  server…". A tab now asks the server where it has no stream, recovers by
  itself after a restart or a reload, says what failed in the middle of the
  tab with **Show Log**, and the extension's log records the versions, the
  machine and the window's `PATH`.
- **macOS.** `tools install cad` tries every Python on the machine
  (PATH, Homebrew, python.org, uv, pyenv) and uses the first that can create
  the environment; when a Python's pins do not install it tries another
  minor version, and when none works it prints what to run. Documents and
  the Manufacturing Package find Google Chrome, Chromium, Microsoft Edge or
  Brave where each platform installs them (`CHROME` still wins). `doctor`
  gives a first, cold probe time. A macOS workflow runs in GitHub Actions
  (`docs/ci.md`).
- **Onboarding.** `init --registry` and the onboarding document no
  longer write `always-auth` (npm 11 warns about it on every command). The
  document covers `gcloud` not found after a Homebrew install. The downloads
  site has two themes, light and dark, both Protoboard's. `npm run
  templates:parts` prints a note when a
  template's part revisions are behind the library; templates may be behind.
- **Parts views.** Revisions read "v4"
  everywhere. An update is a download symbol and the view says what an
  update is. Project Parts is a themed side bar and a page of cards with
  each part's status (local, unverified, verified, official); the status is
  also in the Inspector and as a corner mark on a module in the diagram.
  The library's categories are a list. The breadcrumb of a part goes to the
  Project Parts page. The activity-bar 0 sits in the bottom-left corner.
- **Search order.** `parts search --sort
  relevance|name|manufacturer|updated`, and the same control in the library
  view. `sort` goes to a library that declares the `x-sort` capability; for
  another, the view orders what it has loaded by name or manufacturer.
  Across several libraries, name and manufacturer merge their pages;
  relevance and updated keep each library's own order, one library after
  another. Results carry each part's `relevance`.
- **Relevance and usage.** The Protoboard library ranks parts by a
  seed (set by judgment for 128 parts) and by how often a part is added to a
  project. It keeps counts per part and day, never who.
  `protoboard parts usage` shows them to the library's publishers.
- **Prices by source.** `protoboard parts prices <id>` lists a
  part's prices per supplier. Offers carry the result of pricing only:
  nothing about how a price was fetched is served, vendored into
  `parts/offers.json` or written into a release. Running `protoboard parts
  offers` again rewrites an older `parts/offers.json` without those fields.
- **Versions.** `@protoboardai/core`, `cli`, `views`, `web-viewer`, the
  twelve `ext-*` and the VS Code extension are 0.1.3. `@protoboardai/cloud`
  is 0.1.2 (the client has `sorts()`, `usage()` and the relevance calls;
  core needs `^0.1.2`) and `@deltarobotics/uhd-viewer` is 0.1.2 (marks on
  modules; the CLI, views and web viewer need `^0.1.2`). UHD stays 0.2.1.
  Publish cloud and the viewer before core and the CLI.

Not verified on a Mac yet: the macOS workflow's stack job had not run, so the viewer fix, `tools
install cad` and a release are proven on Linux and by unit tests with
stand-in interpreters and file systems only.

## 0.1.2 (2026-10-06)

A patch release with what the first fresh-machine test found. Nothing in a
project changes: no part, digest, output or config key. Install it with
`@protoboardai/cli@0.1.2`; a project made by 0.1.1 moves by `npm update` (its
ranges, `^0.1.1`, admit 0.1.2).

- **Sign-in outside a project goes to the hosted library.** In a folder with
  no project, `protoboard login`, `logout` and `whoami` used
  `http://localhost:8787` and stopped at `GET
  http://localhost:8787/.well-known/uhd-library: fetch failed`, so 0.1.1
  needs `--url` there. They now use the hosted Protoboard library, the one
  `protoboard init` writes into a new project. `--url` and
  `PROTOBOARD_CLOUD_URL` still win, and inside a project the commands follow
  its `cloud.url` as before (localhost when it sets none). The `parts`
  commands are unchanged.
- **A service that does not answer is explained.** `login` and `whoami
  --check` say `Cannot reach <url>` with the request and the reason behind
  "fetch failed" (`ECONNREFUSED`, `ENOTFOUND`), where the URL came from
  (`--url`, `PROTOBOARD_CLOUD_URL`, the project's `cloud.url`, or the
  default) and how to use another. `whoami --check` used to report only "Not
  signed in" for a service that was down. A project whose config does not
  load is said so instead of being taken for localhost.
- **A new project's `npm install` exports the skills.** `init` writes a
  `postinstall` that puts the skills of the project's extensions in
  `.claude/skills/` and lists them at the end of `AGENTS.md`; it prints one
  line and never fails an install. `npm run skills:export` (now
  `protoboard skills export --host all`) does it again after an extension is
  added; `init --no-skills` leaves the `postinstall` out. A project made by
  0.1.1 keeps its scripts: add `"postinstall": "protoboard skills export
  --host all --on-install || exit 0"` to its `package.json` to get the same.
- **`AGENTS.md` opens with what an agent does first** (all templates and the
  plain init): read the file, then the `build-a-project` skill, run `doctor`
  and `check`, and where the UHD reference and its `uhd-authoring` skill are.
- **The skills list in `AGENTS.md` is rewritten on export.** It was written
  once and never updated, so skills of an extension added later did not
  appear.
- **Reference project.** `examples/smart-bottle` is exported again under the
  `@protoboardai` names, with `coilcraft-xfl4020-152me` at catalog revision
  4; the `iot` template is unchanged.
- **Versions.** `@protoboardai/core`, `cli`, `views`, `web-viewer` and the
  twelve `ext-*` are 0.1.2 (their ranges on each other stay `^0.1.1`). Not
  changed, and still 0.1.1: `@protoboardai/cloud` and
  `@deltarobotics/uhd-viewer`; UHD stays 0.2.1 and the VS Code extension
  0.1.0. A new project depends on the stack at `^0.1.2`.

## 0.1.1 (2026-10-06)

A patch release that moves the stack onto UHD 0.2.1 and renames its npm
packages. A project's parts do not change: vendored parts, their digests and
`parts/origins.json` stay as they are. The package names a project lists do
change (below).

- **The packages are `@protoboardai/…`.** Through 0.1.0 they were
  `@protoboard/…`. Someone else owns the `@protoboard` organisation on npmjs,
  so a machine without our private-registry line in its npm configuration
  could have installed that owner's code under our names. The scope became
  `@protoboardai` on 2026-10-06, before 0.1.1 was published anywhere:
  `@protoboardai/cli`, `core`, `views`, `web-viewer`, `cloud` and the twelve
  `ext-*`. Not renamed: `@deltarobotics/uhd` and `uhd-viewer`, the VS Code
  extension and its `protoboard.*` ids, the `protoboard` command, `.protoboard/`
  folders and `protoboard.config.ts`. To move a 0.1.0 project, see
  [Upgrading](#upgrading-from-earlier-snapshots).

- **UHD 0.2.1.** `protoboard init` pins `@deltarobotics/uhd` at 0.2.1 (it was
  0.2.0), and the reference projects pin it too. Parts declare `^0.2.0`,
  which admits 0.2.1, and the parts service accepts `uhdSchema` 0.2.x as
  before. A project pinned at 0.2.0 keeps working; to move it, change the pin
  in its `package.json` and run `npm install`.
- **`uhdSchema` is the schema of UHD's minor line.** A library seeded, or a
  part published with `parts publish`, records `0.2.0` under any UHD 0.2.x
  and its source declares `^0.2.0`. It used to record the installed package
  version, which would have made every part of an unchanged library a new
  revision after a UHD patch release.
- **`PB_UHD_PIN`.** `check` warns when the UHD a project pins exactly and the
  one installed differ, and says which one ran.
- **Versions.** Every `@protoboardai/*` package (`@protoboardai/cloud`
  among them) and `@deltarobotics/uhd-viewer` are 0.1.1 and depend on each other at `^0.1.1`.
  Extensions still declare `compatibility.protoboard: "^0.1.0"`, which 0.1.1
  meets, so an extension written for 0.1.0 loads unchanged. The stack version
  the CLI reports (`doctor`, `resolved.json`, the bundle, release manifests)
  now comes from `@protoboardai/core`'s `package.json`. The VS Code extension
  and the parts service's own version stay 0.1.0.

## What is in it

The table is the 0.1.0 release, under the names it had; 0.1.1 changes the
versions and the scope (`@protoboardai/…`) as above.

| Component | Version | Repository |
| --- | --- | --- |
| `@protoboard/core`, `@protoboard/cli` | 0.1.0 | protoboard-cli |
| 12 extensions `@protoboard/ext-*` | 0.1.0 each | protoboard-cli |
| VS Code extension `deltarobotics.vscode-protoboard` | 0.1.0 (`.vsix`) | protoboard-cli |
| `@deltarobotics/uhd` (UHD schema, validators, library protocol; no part library) | 0.2.0 | uhd (public) |
| `@deltarobotics/uhd-viewer` | 0.1.0 | uhd-viewer (private) |
| Protoboard Cloud parts service `@protoboard/cloud` | 0.1.0 | protoboard-cloud |

### Framework and CLI (M1, P1–P5)

- **Projects** (`protoboard.config.ts`): definitions from three tiers (catalog
  parts pinned by digest, parts researched in the project, modules designed in
  it), instance resolution, artifact resolution, and one aggregated
  `protoboard check` over Protoboard's, UHD's and every extension's validators
 . `inspect`, `artifacts`, `build` (byte-stable `resolved.json` and
  the UHD bundle), `doctor`, `operations`; `--format json` everywhere.
- **`protoboard dev`**: the UHD viewer served on the
  project, rebuilt on every change and pushed into the open page, diagram
  layout saved to `.protoboard/display.json`, a host-message API for editors,
  loopback-only by default, works behind code-server and Codespaces proxies.
- **Tool runtimes**: extensions declare tools and exact-pinned
  runtimes; `protoboard tools install cad` builds the project's Python venv;
  `doctor`, `check` and `run` find it without environment setup.
- **Capabilities**: `circuit`, `cad` and `firmware` providers chosen
  per module by a `<capability>.config.ts`, with fixed standard outputs that
  the framework validates, staleness tracked through operation records, and a
  provider contract test.

### Packages and templates

- Every package is published by version to a local Verdaccio registry
  (`registry/start.sh`, `scripts/registry/publish-stack.mjs`); projects and
  the reference projects depend on versions, never `file:` paths. The
  `@protoboard/*` packages stay `"private": true` and are only published
  from a staged copy to a loopback registry. See
  [Local registry and project templates](../guides/local-registry.md).
- `protoboard init <dir> --template drone|wearable|iot`: templates derived
  from the three reference projects, which check with no errors and no
  warnings straight after `init`. `scripts/registry/smoke.sh` is the exit
  check: the three examples and three templates installed from the registry
  outside the repositories, checked and built.
- UHD no longer carries a part library: parts come only from a library
  service over `uhd-library/v1`; UHD's own tests run on fixtures.

### Parts and libraries

- The Protoboard Cloud parts service, run locally: 113 parts, 282 immutable
  revisions, 105 supplier offers in the dev catalog.
- `protoboard parts search / taxonomy / add / update / offers / publish`:
  verified downloads with their whole closure, deliberate re-pinning, offline
  checks of every vendored byte.
- UHD's open library protocol `uhd-library/v1` and several libraries per
  project (`protoboard libraries`), tokens from environment variables only.
- The UHD taxonomy for search and the VS Code Library view.

### Extensions (M4, K1–K8)

| Area | Extensions |
| --- | --- |
| System and parts | ext-hardware (composition, harnesses, test, BOM, evidence check), ext-parts (part research, authoring, verification; part bodies), ext-sourcing (search, datasheet extraction, offers, lifecycle) |
| CAD (`cad`, build123d 0.13.0) | ext-frame-cad (plates, mounting hardware, DXF), ext-harness-cad (routed wire harnesses), ext-enclosure-cad (printed and machined cases with fit, wall and seal checks) |
| Boards (`circuit`) | ext-tscircuit (tscircuit core 0.0.2056 in process: generation, local autorouting, Gerber, drill, BOM, PnP, STEP, GLB, netlist, DRC and drift) |
| Firmware (`firmware`) | ext-zephyr (Zephyr 4.2, nRF52840), ext-esp-idf (ESP-IDF 5.3, ESP32-C3), ext-drone (Betaflight CLI for the flight controller); every setting cites the UHD fact it comes from |
| Documents and release | ext-docs (datasheet and assembly guide bound to the model), ext-release (`protoboard release`, the Manufacturing Package) |

The full list, with operations, checks, tools and skills:
[extensions and skills](../reference/extensions.md).

### Manufacturing Package (PK1–PK5)

`protoboard release` refuses a project with check errors, stale outputs or
uncommitted changes, then writes `release/<version>/`: an overview, per unit
a spec sheet, BOM, work order, assembly guide and test plan, the
manufacturing files from the providers' standard outputs, the ordering list
with quotes from vendored offers, `index.html` and a reproducible
`manifest.json`. [Format](../reference/manufacturing-package.md).

### Skills, SOPs and evals (EV1–EV6)

27 skills written as standard operating procedures, plus UHD's `uhd-authoring` reference, with **build-a-project**
as the top-level SOP from a brief to a release; `protoboard skills export`
for Claude Code or AGENTS.md. Seventeen eval cases across the extensions,
`protoboard evals` with a scripted host (replays the known-good solution, run
in CI) and a Claude Code host; baselines in `docs/evals/`.

### VS Code (P4, VS1–VS8)

The Protoboard activity bar (Explorer of the system, Library, Cloud), a DRC
panel, Problems integration, the viewer in an editor panel (focus, select,
open source from the diagram), artifacts opened in their applications,
**Generate Deployment Artifacts** (`release`) and the cost of the ordering
list. Installed from a `.vsix`.

### Reference projects

Each is checked, built and released from the merged tree; its release is
committed as an operation record.

| Project | What it is | Check | Release 0.1.0 |
| --- | --- | --- | --- |
| `examples/quadcopter-5in` | 5-inch FPV quadcopter: custom carbon frame and top plate, FC/ESC stack, 10 routed cables, 12 hardware parts, Betaflight configuration | 0 errors, 1 warning (`UHD_PROPULSION_CURRENT`, accepted) | 2 units, 11 documents (67 pages), 121 files |
| `examples/wearable-watch` | Smartwatch: 4-layer 41 mm round nRF52840 board (tscircuit), Zephyr board definition, printed case, two cables | 0 errors, 1 warning (`HARNESS_ROUTE_WARNING`, battery-lead slack) | 2 units, 11 documents (48 pages), 108 files |
| `examples/smart-bottle` | Smart water bottle cap: ESP32-C3 board (tscircuit), ESP-IDF configuration, sealed printed cap, probe cable | 0 errors, 2 warnings (`FW_STRAPPING_PIN`, accepted) | 3 units, 16 documents (48 pages), 99 files |

`examples/uno-motor-bench` is a smaller fixture, not part of the release set.

## Known limits

**Installation**

- **The registry is local to each machine.** The packages are published to a
  local Verdaccio registry (`registry/start.sh`, `127.0.0.1:4873`) from the
  four source checkouts with `scripts/registry/publish-stack.mjs`; there is
  no hosted private registry yet, so every beta machine clones the four
  repositories, starts its own registry and publishes into it before a
  project outside the repositories can `npm install`.
- **Packages ship TypeScript sources** run through tsx, as in the monorepo;
  UHD and the viewer ship built `dist/`.
- **The catalog comes as a snapshot file.** `protoboard init --template`
  vendors its catalog parts at pinned revisions (some at 3), and a fresh
  freshly seeded parts service has every part at revision 1, so a machine
  imported a snapshot of the development catalog instead; the import
  reproduces every revision digest.
- **No SSH key is needed to install.** `@tscircuit/pcb-trace-linter`, which
  `@tscircuit/capacity-autorouter` names as a GitHub dependency, resolves from
  the same commit's HTTPS tarball (an `overrides` entry in the workspace, the
  ext-tscircuit examples and templates). Cloning the private
  repositories still needs GitHub access.
- **Verified on Linux** (Node 22 in CI, Node 24 for these notes, Python 3.12, Chrome 154). macOS has
  not been run end to end; Windows is not supported in v0.1.

**Tools**

- CAD generation needs Python 3.12 with build123d (`protoboard tools install
  cad`, about 1 GB of wheels). Without it everything else works and the CAD
  operations are refused with an install hint.
- Documents and the Manufacturing Package need Google Chrome. Their font,
  Kode Mono (OFL), ships in `@protoboard/ext-docs`; ProtoMono, the display
  font, is a licensed webfont and is not shipped, so by default display text
  is in Kode Mono on every machine. `PROTOBOARD_DOC_FONTS` adds
  ProtoMono from a licensed copy, and then only matches machines that do the
  same. Byte-identical PDFs need the same Chrome version; every other file of
  a package is reproducible regardless.
- tscircuit's local autorouter is slow on dense boards (the watch board takes
  about 90 s) and its routes are what the release ships; there is no
  interactive PCB editing. `tools install circuit` has nothing to install
  (tscircuit is an exact npm dependency of ext-tscircuit).
- Firmware providers write configuration only (devicetree, Kconfig, pin
  header, sdkconfig, Betaflight CLI). Building and flashing firmware is not
  part of the stack. Two controller families are supported (nRF52840 with
  Zephyr 4.2, ESP32-C3 with ESP-IDF 5.3).

**Parts and cloud**

- The parts service runs locally (`localhost:8787`); there is no hosted
  Protoboard Cloud in v0.1. Accounts and sign-in, publishing releases and
  quoting are not built: the VS Code Cloud view shows
  "not signed in" and the cost from vendored offers.
- Offers are vendored and quoted offline. No distributor API, no currency
  conversion, reel-only offers left unpriced.
- Library tokens come from environment variables; the system keychain is not
  read yet.
- The quadcopter pins revision 2 of eleven catalog parts while the catalog
  recommends 3 (`protoboard parts update` lists them); re-pinning is a
  deliberate change for its owner.
- Vendor files are served outside the team only when their terms are
  `redistributable`.

**Releases and documents**

- The test plan is basic (v0.1); measured test data replaces stand-in data,
  which documents watermark until then.
- A release never orders, uploads or prints, and no physical build has
  closed the loop yet (M5).
- A design built by an older enclosure generator is flagged
  (`ENCLOSURE_GENERATOR_STALE`, and `release` refuses it); `watch-case` was
  regenerated for it (only its `sourceDigest` changed). The frame and
  harness generators record the same kind of digest, which `check` does not
  recompute yet.
- Chrome's tagged-PDF element ids are renumbered in document order:
  two releases of one commit, on one machine or another with the same
  Chrome, are byte-identical.

**Agents and evals**

- The scripted eval host replays known-good solutions (free, deterministic,
  in CI). The Claude Code host needs Claude Code installed and costs API
  usage; rubric graders run only with `--judge claude-code`.
- The terminal UI (the `ui` command) reads alpha board files only. It was
  removed after 0.1.4, on 2026-10-08: the stack no longer reads that file type.

## Upgrading from earlier snapshots

- **From 0.1.0 to 0.1.1: rename the packages.** In the project, replace
  `@protoboard/` with `@protoboardai/` in `package.json`,
  `protoboard.config.ts` (the import and `extensions`), every
  `<capability>.config.ts` (the import and `provider`) and the imports of the
  `.uhd.ts` sources and scripts. In `.npmrc` (the project's or `~/.npmrc`)
  the scope line becomes `@protoboardai:registry=<registry>`. Run
  `npm install`, then `protoboard check`. Until then `check` reports
  `PB_PACKAGE_SCOPE_RENAMED` (or says the same when `protoboard.config.ts`
  cannot be imported), and the VS Code extension shows the same message
  instead of running a 0.1.0 CLI. Never `npm install` an `@protoboard/…`
  package. Each capability config changed, and the generators write their new
  name into what they generate, so run `<capability>:generate` and
  `<capability>:export` for every bound module again before a release
  (`protoboard release --check` lists them); the bodies come out the same
  bytes, their manifests and the generated text name the new packages.
  `check` itself stays free of errors meanwhile: a firmware provider's native
  files that differ from today's only in the package name of their header
  count as current; a circuit or enclosure built by the 0.1.0 generator gets
  a stale warning. Operation records written under 0.1.0 keep the old names.

- Catalog parts now come from the parts service (`parts/catalog`,
  `parts/origins.json`), not from the UHD package. Run `protoboard check`;
  `PB_ORIGIN_MISSING` or `PB_VENDORED_FILE_MISSING` means re-adding a part
  with `protoboard parts add <id>@<revision>`.
- The GNSS module (`matek-m9n-5883`) is revision 3 in the catalog, with its
  vendor CAD: the quadcopter's former `PB_ARTIFACT_UNAVAILABLE` warnings are
  gone.
