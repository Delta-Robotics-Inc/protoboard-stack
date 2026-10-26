# wearable-watch

Protoboard reference project: a round-display nRF52840 smartwatch with a
custom board (circuit capability), a printed case (cad capability) and a
Zephyr board definition (firmware capability). The system is described in UHD
(`@deltarobotics/uhd`). [README.md](README.md) gives the overview and the
rebuild order.

## Layout

- `src/watch.uhd.ts`: the root system. It holds the instances and the links
  (cell and LRA leads, spring bars).
- `src/boards/watch-main/`: the main board.
  - `watch-main.uhd.ts`: parts, nets, passives chosen by value with
    `overrides`, and the board edge (`exports`).
  - `lands.uhd.ts`: copper lands. These are the cell pads, the LRA pads and the
    SWD pads.
  - No artifact list: the circuit provider declares the board's outputs
    (`out/`, `tscircuit/circuit.json`) and Protoboard attaches them, which
    gives the board its Schematic, PCB, 3D and BOM tabs.
  - `circuit.config.ts` (ext-tscircuit), with the native design in
    `tscircuit/`. `footprints.json` and `layout.json` are edited by hand;
    `board.gen.tsx`, `circuit.json` and `build.json` are generated.
  - `firmware.config.ts` (ext-zephyr), with its output in `zephyr/`.
  - `out/`: the standard outputs.
  - `antenna-check.ts`.
- `src/enclosures/watch-case/`: the case.
  - Its features are in `watch-case.uhd.ts`.
  - `cad.config.ts` names ext-enclosure-cad.
  - `build123d/` and `out/` are generated.
  - `watch-case.bind.ts` holds the frames and artifacts from `cad:extract`.
- `src/enclosures/watch-case/glazing.uhd.ts`: the display lens and the
  heart-rate cover (their geometry is the case provider's `cover_*` outputs).
- `src/materials.uhd.ts`: tapes and adhesive (no geometry; steps place them).
- `src/harnesses/`: the cell and LRA lead harnesses and the back-cover
  screw kit (its `fastenerStack` closes the case's `back_joint`). Each cable has a provider directory with its route and `out/`.
- Parts, in three tiers:
  - `parts/catalog/`: catalog parts, pinned in `parts/origins.json`. Never
    edit them.
  - `parts/local/`: parts researched in this project, with their CAD.
    `cadkit/` is the part CAD kit. Evidence is in `parts/evidence/<id>/`;
    `.research/` there is gitignored.
  - `src/`: everything designed here.
- `src/scenarios.ts` holds the fault scenarios; each must be caught.
  `src/power-budget.ts` checks battery life against the brief.
- `.protoboard/display.json`: placements of the board, cell and LRA inside the
  case. They are held and bonded, so no mate places them. It also holds the
  diagram layout. `check`, the viewer and the documents all use it.
- `docs/`: design documents.
  - Written by hand: brief, component selection, system, power budget,
    decisions, harnesses and CAD, open questions.
  - `docspec.ts`: the presentation spec for the technical documents.
  - Built by `run tech-docs`: `wearable-watch-{datasheet,assembly-guide}.*`,
    `wearable-watch-bom.json` and the figures in `docs/images/`.
  - `docs/images/viewer/`: viewer screenshots.
- `operations/`: records of every operation.
- `release/<version>/`: the Manufacturing Package. It is not committed.

<!-- protoboard:guidance:begin (written by Protoboard; `protoboard init --refresh-guidance` brings it up to date: edit outside it) -->
## Words

What things are called in the model, and what people call them when they look
at the diagram. People use both; treat them as the same thing.

| Word | What it is | What people see and say |
|---|---|---|
| **Module** | Anything with a boundary: the product, a sub-assembly, a circuit board, a bought part. A module holds other modules (its children) and the links between them. The top-level module is the whole product; its source lives under `src/`. | A **node**: a box in the diagram ("block", "box"). A node with something inside opens onto the next level. |
| **Part** | A module that is bought or made as one thing: a chip, a connector, a cell, a bought board. Library parts are in `parts/catalog/`, parts researched here in `parts/local/`. A **blank part** (a placeholder) has a name and interfaces and no real part chosen yet. | A node. |
| **Board** | A circuit board designed in this project: a module whose children are its components and whose links are its nets (`src/boards/<name>/`). | A node that opens onto its components. |
| **Interface** | A place where a module connects to something else: a power input, a UART, a hose port, a mounting face. It says what it carries (its domain and protocols) and its limits. | A **handle**: the dot on the edge of a node ("dot", "pin", "port"). |
| **Link** | A connection between two interfaces, written in the module that holds both ends. | An **edge**: the line between two handles ("line", "wire", "connection"). |
| **Harness** | The physical thing that carries links: a cable with its connectors and conductors, soldered leads, a stack of fasteners. A link says that two interfaces are connected; a harness says by what. | The lines that run together under one name and colour; the legend lists them by kind. |
| **DRC** | Design rule check: the rules `protoboard check` runs over the model and what they find (errors, warnings, info). For example: a voltage outside a part's limits, two interfaces that cannot talk to each other, a link that nothing carries. A clean DRC says the model is consistent; it does not say the hardware works. | The **DRC** panel, the counters in the status bar, and the health colours on nodes. |

When someone says "tidy the diagram", "move that box", "the dots are on the
wrong side" or "the lines cross", they mean the nodes, handles and edges of
the diagram: its layout (below), not the model. Change the model only when
they ask for a different design.

## Protoboard on this machine

- **Protoboard is installed once per machine (globally) by default**, and this
  project uses that install (its packages are links to it). There is nothing
  to install in the project.
  Never tell the person to run `npm install` (or any npm command) in a
  project, and do not run one yourself to fix something. When the packages
  are missing (`protoboard doctor` says so), `protoboard stack link` links
  them again.
- **An extension is added with `protoboard extensions add <name>`** (for
  example `protoboard extensions add ext-tscircuit`): it lists the extension
  in package.json and protoboard.config.ts, links it from the Protoboard on
  this machine and exports its skills. Never with `npm install`.
- **A project-local install is the exception**: the stack's packages inside
  this project's `node_modules` (`protoboard init --stack project`), for a project
  that must carry its own copy. Ask the person before doing it, and say what
  it costs (Node.js with npm, and access to the package registry). Never
  choose it for them.
- **Running the command.** It is `protoboard …`. If the shell does not find
  it, in this order: open a new terminal in VS Code (the extension adds the
  command there, and **Protoboard: Add the protoboard Command to PATH** adds
  it everywhere); `~/.protoboard/bin/protoboard …`
  (`%USERPROFILE%\.protoboard\bin\protoboard.cmd` on Windows); in a project
  installed locally, `./node_modules/.bin/protoboard …`
  (`node_modules\.bin\protoboard.cmd`). They are the same CLI. Some skills
  write `npx protoboard …`: read that as `protoboard …`. Never run a bare
  `npx protoboard`: outside a locally installed project npm would fetch an
  unrelated public package of that name. Where npx is the only way, the name
  is `npx @protoboardai/cli …`.
- `protoboard --version` prints the version in use; `protoboard stack` says
  where the command and the project's packages come from.
- **Sign-in.** Work on the project needs no account: init, check, build, dev,
  layout, views, run and release work signed out. The Protoboard library
  needs one, all of it: searching it and its categories, adding or updating
  library parts, prices and offers, publishing. When such a command
  answers "needs a Protoboard account" (exit code 4), ask the person to run
  `protoboard login` (or **Protoboard: Sign In** in VS Code), and carry on
  with the rest meanwhile. You cannot sign in for them, and you must not work
  around it.

## Skills

A skill is the procedure for one stage of the work (research a part, compose
the system, lay out a board, release). `protoboard skills` lists the ones this
project's extensions ship, and the list at the end of this file names them.
Read a skill before doing the task it covers, in any of these ways (the text
is the same):

- `protoboard skills read <name>` (a file it refers to:
  `protoboard skills read <name> references/<file>`);
- with the MCP server, the `skill_read` tool;
- `.claude/skills/<name>/SKILL.md`, once `protoboard skills export --host all`
  has copied them into this project (it is not committed; run it again after
  an extension is added).

Never point at a skill by a path into the Protoboard install
(`~/.protoboard/…`, `node_modules/…/skills/…`): such a path is one machine's
and breaks when the project moves. The UHD language's own skill,
**uhd-authoring**, is in `node_modules/@deltarobotics/uhd/skills/`.

## Protoboard's MCP server

This project's MCP server is the one `protoboard agents setup` registers,
named **protoboard-stack**; its tools work on these files (`project_status`
first). A server named **protoboard** whose tools are `list_boards`,
`open_board` or `connect_board` is the retired Protoboard web app (the
alpha), not this: do not use it for this project.

## When this project sits inside a larger workspace

This folder may be one part of a bigger repository, such as a company
workspace with a folder per engagement (`projects/<group>/<project>/protoboard/`).
Then two sets of guidance apply, each to its own work:

- **This file and the stack's skills govern the hardware work here**: the
  model, parts, checks, providers, CAD and circuit outputs, the engineering
  brief and decisions in `docs/`, and releases. If the workspace's guidance
  says otherwise about any of these, this file wins.
- **The workspace's guidance governs the process around it**: git (when to
  commit and push, branches), confidentiality, client communication, orders
  and purchases, sign-offs and the record of what was delivered. If this file
  says otherwise about any of those (for example "commit it"), the
  workspace's rule wins.
- A release is made here (`protoboard release` writes `release/<version>/`,
  which is not committed); the workspace records which one was delivered:
  its version, the commit and the digest of its `manifest.json`.
- The person's own instruction in the session comes before both.

Protoboard never assumes this folder is the root of a git repository:
commands run in this folder and write only inside it, its `.gitignore`
applies here, and every path this project records is relative to this
folder.

## Circuit boards (PCB)

Boards are designed the official way: the board is a UHD module with a
`circuit.config.ts`, and its layout and fabrication files come from
`protoboard run circuit:generate`, `circuit:export` and `circuit:check`
(the **circuit-board** skill, `protoboard skills read circuit-board`). Follow
that workflow and its commands. Do not run `tsci` on a Protoboard board,
and do not edit the provider's generated files.

Protoboard is the orchestrator: the modules own the data, and the build
steps turn the UHD model into tscircuit's and KiCad's files. Work in
Protoboard; do not manage KiCad or tscircuit libraries, symbols, footprints
or models yourself unless the job needs something Protoboard cannot do (a
SPICE model, for example), and then say so first, as the fallback below
asks.

**Before any edit to a board, say where the fix belongs**, in this order:

1. the UHD model (parts, connections, values, designators, MPN and LCSC
   fields, test pads);
2. the tscircuit stage (placement, trace widths, rules, keep-outs, land
   patterns, `circuit.config.ts`);
3. the stack itself (a converter or provider bug: report it, with the
   command and its output; do not hand-patch the output);
4. only then KiCad, for the hand finish the stages above cannot produce
   (routing touch-ups, final placement nudges, silkscreen).

- **A locked board is not fixed in place.** If the change belongs upstream,
  propose unlocking and re-locking, and say plainly which KiCad work would be
  lost: an unlock moves `kicad/` to `kicad-archive/<stamp>/`, and nothing
  comes back by itself. Unlocking is the person's decision: ask.
- **Separate design choices from mistakes** when you propose fixes; fix the
  mistakes where they belong and ask about the choices.
- **A KiCad edit that must survive a re-lock** is written down as a post-lock
  step in `docs/post-lock.md` (what, why, the exact edit, how to check it),
  never left as a silent hand edit.
- **Before a long process** (hand-routing, a regroup of many parts, a large
  search), say what it will do and roughly how long it takes; ask when it is
  optional.
- **When the autorouter fails, step back before routing by hand**: are the
  parts too close, the rules wrong, the placement the problem? Propose that
  fix first. Do not over-optimise a small area before asking whether it needs
  doing at all.
- **Never make placeholder CAD or 3D models** from datasheets while the
  part's UHD artifacts or its JLC/LCSC source has one. If none exists, ask
  the person first.
- **A board is done when the person can see it in the viewer**: its
  Schematic, PCB, 3D and BOM tabs draw. `protoboard views check --module
  <board>` opens each tab once headless and fails on one that is empty or
  throws.

Falling back to other tooling (`tsci`, KiCad and `kicad-cli`, or skills
derived from KiStack, an MIT KiCad skill pack) is allowed only when the
official path fails and the board is needed regardless. Then, before you
switch:

1. Tell the person plainly that the Protoboard path failed, name the failure
   (the command and what it said), and that you are about to leave it.
2. Warn them that it adds friction: what is made outside the stack is not
   checked by `protoboard check` and is not tracked as stale when the model
   changes, so it has to be kept in step by hand.
3. Record it: in the project's worklog or `docs/decisions.md`, and as
   feedback to Protoboard (what failed, with the command and its output).
4. Keep the UHD model authoritative: a change made in the other tool goes
   back into the model first, never only into the other tool's files.

## Look before you describe

Before you tell anyone what this project contains, how far along it is or
what is wrong with it, look: `protoboard inspect` (the system as it is now),
`protoboard check` (what the rules find) and `protoboard doctor` (extensions,
tools, skills, the sign-in); with the MCP server, `project_status`. Describe
what they report. Do not answer from memory, from an earlier session or from
the template's description: a project that started blank may hold a full
system by now.

## The diagram's layout

Where the nodes sit, and where the lines bend, is saved in
`.protoboard/display.json`. **You may write this file**: it is the one file
under `.protoboard/` that is not generated. Dragging in the viewer writes the
same file, so read it again before you change it, keep what is there for the
levels you do not touch, and commit it.

```json
{
  "schema": "uhd.display/v0",
  "diagram": {
    "layouts": {
      "": { "nodes": { "board": { "x": 460, "y": 370 }, "cell": { "x": 60, "y": 450 } } },
      "board": { "nodes": { ":u1": { "x": 320, "y": 200 } } }
    }
  }
}
```

`layouts` has one entry per level of the diagram, keyed by the instance path
of the module that level shows (`""` is the top level, `"board"` is inside
the instance `board`). `nodes` gives the position of each node of that level, in
diagram units (x to the right, y down). The keys are the ones the
viewer writes: move a node in the viewer once to see them for a level. A
level without an entry is laid out automatically. Keep the file's other
entries (`spatial`, below) as they are when you change the diagram.

When you lay a diagram out: put the module most things connect to in the
middle, the things that feed it on the left and what it drives on the right,
leave room between nodes for the lines and their labels, and keep lines from
crossing where you can. Then look at the result (the viewer in VS Code, or
`protoboard dev`) before you say it is done.

## Placing parts in the 3D view

Parts are placed in 3D by mates: a mechanical link between two interfaces
that carry geometry frames puts one against the other. A part that no mate
reaches (held, bonded, strapped, or not yet joined) is placed in the same
file, `.protoboard/display.json`, under `spatial`:

```json
{
  "schema": "uhd.display/v0",
  "spatial": {
    "root": "shell",
    "placements": {
      "pod": { "matrix": [1, 0, 0, 12.5, 0, 1, 0, 0, 0, 0, 1, 30, 0, 0, 0, 1], "note": "sits in the shell's pocket" }
    }
  }
}
```

- `root`: the instance path the assembly is placed from (the structure the
  others mount to); it sits at the origin. Without it the viewer picks the
  top-level module with the most frames. `protoboard check` counts a
  placement here (no `UHD_UNPLACED` for it) only when `root` names the first
  top-level module with interface frames, the one check places from.
- `placements`: by instance path from the top level (`"shell/pod"` inside
  `shell`; `"board#case"` for one body of a module with several). `matrix` is
  a 4×4 transform written row by row (16 numbers): the module's own
  coordinates into the root's, rotation in the first three columns and the
  translation in millimetres in the fourth (elements 4, 8 and 12). `note`
  says why it is placed by hand.
- A placement holds the module where it says, and a mate that reaches it is
  then checked against it (an over-constrained mate is an error). Use it only
  for what no mate reaches; when a part can be mated, mate it in the model.

The full format, with the view's labels, appearance and camera, is in the
stack's reference (`docs/reference/display.md` in the Protoboard repository).
Look at the 3D view (the viewer in VS Code, or `protoboard dev`) after a change.

Everything else under `.protoboard/` is generated (`build/`, `cache/`,
`tools/`, `local/`): never edit it.
<!-- protoboard:guidance:end -->

## Commands

- `npx protoboard check`: 0 errors and 1 warning (the cell leads' slack); the infos and the warning are explained in
  docs/decisions.md. Any other warning or error is new.
- `npx protoboard run circuit:generate|export --module watch-main-board`
  - Routing takes about 70 s.
  - Then run `npm run antenna-check`.
  - Then `npx protoboard views check --module watch-main-board`: every
    tab of the board draws.
- `npx protoboard run firmware:generate|export --module watch-main-board`
- `npx protoboard run cad:generate|export --module watch-case`
  - Needs build123d: `PROTOBOARD_PYTHON`, or `protoboard tools install cad`.
  - If frames moved, re-bind `watch-case.bind.ts` from `cad:extract`.
- `npx protoboard run cad:generate|export --module watch-battery-leads` (and
  `watch-lra-leads`)
- `npm run power-budget`, `npm run scenarios`
- `npx protoboard run tech-docs`, then `run tech-docs-verify` (needs Chrome and
  poppler)
- `npx protoboard release --check`, then `npx protoboard release`. It is
  refused on check errors, stale outputs or a dirty tree. Units: the main
  board (`units/board/`) and final assembly (`system/`).
- `npx protoboard dev`: the viewer.

## Rules

- Cite a source for every value, and mark choices as `assumption` traits.
- Never edit generated files: `out/`, `zephyr/`, `tscircuit/board.gen.tsx`,
  `circuit.json`, `build123d/`, and the technical documents. Change the model
  or the config, then re-run the operation.
- The board frame is the case frame seen from the back cover (+Z towards the
  wrist). The display is component `ds1`, on the bottom side.
- UHD stays free of tool data: provider settings belong in
  `*.config.ts`, never in a `.uhd.ts`.
- Passing model checks does not make the watch ready to wear. The open
  questions are in docs/open-questions.md.

<!-- protoboard:skills:begin (generated by `protoboard skills export`) -->
## Skills (the project's extensions)

Read a skill before doing the task it covers: `protoboard skills read <name>`, the MCP server's `skill_read`, or `.claude/skills/<name>/SKILL.md` after `protoboard skills export --host claude-code`.

- **build-a-project** (@protoboardai/ext-hardware) — Start here: the top-level SOP from an idea or a brief to a release, one level of detail at a time (concept of 3 to 6 blocks, blocks, parts, definitions verified, schematic and PCB), asking before each level deeper — sourcing, parts by tier, system and harnesses, boards, enclosures and structures, harness CAD, checks, firmware, documents, Manufacturing Package, evals — delegating to each extension's SOP
- **system-compose** (@protoboardai/ext-hardware) — Brief → requirements → module selection → UHD system (links, harnesses, mates) → fault scenarios → the protoboard check loop, with every diagnostic code explained; verify with **system-review**
- **system-review** (@protoboardai/ext-hardware) — Independent review of a composed system against its brief: requirement trace, link and harness justification, diagnostic dispositions, scenario coverage
- **harness-author** (@protoboardai/ext-hardware) — Wire harnesses (conductors, lengths, gauges, connectors) and fastener stacks (stack-up arithmetic, supplier-cited hardware, nut engagement, torque); verify with **harness-verify**
- **harness-verify** (@protoboardai/ext-hardware) — Independently re-derive every stack-up, thread engagement, torque and cable fact from the sources
- **test-and-measure** (@protoboardai/ext-hardware) — Test plan from requirements and the model, procedures, and measured test-data files (status standin|measured) that replace stand-in data in the documents
- **uhd-authoring** (@protoboardai/ext-parts) — UHD schema reference: model a module with UHD builders (interfaces, pin tables, buses, connectors, parameters, traits, package, geometry frames and refs); shipped by UHD
- **uhd-part-research** (@protoboardai/ext-parts) — Find and cite sources (datasheets, CAD) for a purchased part before modelling it
- **uhd-part-author** (@protoboardai/ext-parts) — Write a datasheet-honest UHD module definition from researched sources; verify with **uhd-part-verify**
- **uhd-part-verify** (@protoboardai/ext-parts) — Automated part checks, then an independent audit against the cited sources; record the verification
- **uhd-tech-docs** (@protoboardai/ext-docs) — Generate datasheets and assembly guides whose every value is a query into the UHD model; verify with **uhd-tech-docs-verify**
- **uhd-tech-docs-verify** (@protoboardai/ext-docs) — Verify generated technical documents: values, units, stand-in watermarks, layout, coverage
- **harness-cad** (@protoboardai/ext-harness-cad) — Generate and bind a wire harness's routed 3D geometry from the assembled model; read the route report (length fit, bend radius, clearance) and fix what it finds
- **release** (@protoboardai/ext-release) — Cut a release: choose the package units, clear every precondition (check errors, stale outputs, uncommitted changes), run `protoboard release`, and inspect the Manufacturing Package
- **circuit-board** (@protoboardai/ext-tscircuit) — Design a custom PCB through the circuit capability: the board as a UHD module, circuit.config.ts, circuit:generate/export/extract/check, and what each CIRCUIT_* finding means
- **kicad-layout-review** (@protoboardai/ext-tscircuit) — Review and finish a locked board's layout in KiCad 10: what to check, DRC/ERC reports, Update PCB from Schematic keeping placement, and acting on CIRCUIT_KICAD_* findings
- **kicad-cli** (@protoboardai/ext-tscircuit) — kicad-cli exports and checks for a KiCad 10 project (DRC, ERC, Gerber, drill, position, STEP/GLB, SVG/PDF, netlist, BOM, upgrade), and the fallback before lock
- **firmware-config-zephyr** (@protoboardai/ext-zephyr) — SOP: configure Zephyr for a UHD board with an nRF52840 module (firmware capability): config, generate, check, export, build hand-off; every setting cited
- **enclosure-cad** (@protoboardai/ext-enclosure-cad) — Describe an enclosure as a UHD module of features, configure the cad provider, generate, export and read the fit, wall, seal and alignment findings
<!-- protoboard:skills:end -->
