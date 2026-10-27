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

## Descriptions and design notes

A module's `description` says what the module is, in a sentence or two. The
Inspector shows its first five lines. Long design notes go in the project's
docs (`docs/`, for example `docs/<module>.md`), not in the description: the
sub-modules and their part numbers, layout and assembly notes, the reasons
behind a choice.

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
level without an entry is laid out automatically, as a block around the
module most things connect to. Keep the file's other entries (`spatial`,
below) as they are when you change the diagram.

The first thing a person does with your build is look at its diagram. Before
you call a build (or a level of it) done:

1. Lay it out by function: the module most things connect to in the middle,
   what feeds it (connectors, power) on the left, what it drives on the
   right, parts that belong together next to each other. Keep it compact and
   about the shape of a screen: never one long row or column of parts.
2. Run `protoboard layout` (`project_layout` on the MCP server). It measures
   every level as the viewer draws it: line crossings, overlapping cards, the
   longest row or column of cards, the aspect ratio, lines under cards.
3. Fix what it reports. `protoboard layout <level> --apply` lays a level out
   afresh, `--tidy` keeps your arrangement and fixes it, `--pin <card>` keeps
   a card where you put it; or move cards in `.protoboard/display.json`. Run
   it again. If a level cannot get under the limits after two tries, say so
   and show it, rather than going round again.
4. Look at it (the viewer in VS Code, or `protoboard dev`) before you say it
   is done. `protoboard check` lists a level that still needs it as
   `PB_DIAGRAM_LAYOUT`.

A board with dozens of parts reads better split into sub-modules by
function, each a level of its own: model them, and the diagram follows.

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
