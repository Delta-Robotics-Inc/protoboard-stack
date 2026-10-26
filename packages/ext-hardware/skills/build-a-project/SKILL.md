---
name: build-a-project
description: The top-level SOP for taking a Protoboard hardware project from an idea or a written brief to a release and its Manufacturing Package, one level of detail at a time (concept, blocks, parts, definitions verified, schematic and PCB), asking before each level deeper — a rough draft or concept is 3 to 6 capability blocks, nothing more — then brief and requirements, sourcing, parts by tier (cloud catalog via parts search/add, project-researched via the part skills, publish), system composition and harnesses, custom boards (circuit capability), enclosures and structures (cad capability), harness CAD, checks and fault scenarios, firmware configuration, documents, `protoboard release` by package units, and evals — delegating each stage to the extension SOP that owns it. Use when starting a project from an idea or a brief, when asked for a rough draft, a concept or a block diagram, when resuming a project and deciding what to do next, or when asked "build this" end to end.
---

# Build a project

```
brief ─► requirements ─► sourcing ─► parts (catalog │ project-researched) ─► system + harnesses
                                                                                  │
 evals ◄─ release (Manufacturing Package) ◄─ documents ◄─ firmware ◄─ checks ◄─ boards ─► enclosures/structures ─► harness CAD

how far, one level at a time, asking before each:
 concept (3–6 blocks) ─► blocks ─► parts ─► definitions verified ─► schematic and PCB
```

This SOP owns the order of work and the hand-offs. Each stage is done by the
SOP named in it; this one says when to start a stage, what must be true
before moving on, and where to go back to when something fails. The UHD model
is the design record throughout: every stage reads it, and every finding is
fixed in the model or in a provider's config, never in a generated file.

Worked example: `examples/quadcopter-5in` (purchased modules, a custom frame
and top plate, ten routed cables, Betaflight configuration, datasheet and
assembly guide). Its `AGENTS.md` and `docs/harnesses-and-cad.md` show the
standard the result should meet.

## Purpose

Take an agent from a brief to a release that someone could order, make,
assemble and check from, without skipping the evidence each stage needs. Use
it when starting a project from a brief, when picking up a project and
deciding what comes next (run the stage checks in **Verification** to find
the first stage that is not done), or when asked to build something end to
end. For one stage alone, go straight to that stage's SOP.

It does not run to the end by itself. The work goes down a ladder of five
levels of detail (step 0), it starts at the level the person asked for (a
"rough draft" or a "concept" is the first: three to six blocks), and it asks
before going a level deeper.

It stops at manufacturing-ready files. It never orders, uploads, prints,
creates accounts or runs cloud services, and physical tests are prepared for
a person, not performed.

## Inputs

| Input | Where | From |
| --- | --- | --- |
| The brief | `docs/brief.md` (purpose, operating envelope, constraints, acceptance targets) | the person asking; write it with them if it does not exist |
| How far to go | one of the five levels in step 0 | the person asking; concept when they did not say |
| A project | `protoboard.config.ts` at the project root; the top-level module under `src/` | `npx protoboard init <dir>` (step 0) |
| The extensions the project needs | `extensions` in `protoboard.config.ts`; the Protoboard installed on the machine carries them | step 0 |
| Earlier work to build on | another project's research, where the person says it is | the person asking (step 0) |
| Tool runtimes | `.protoboard/tools/` (`npx protoboard doctor`) | `npx protoboard tools install cad` / `circuit` |
| The parts service, for catalog parts | `PROTOBOARD_CLOUD_URL` or `cloud.url` in the config (default `http://localhost:8787`) | the operator; only `parts` commands use it |

## Steps

### 0. Look, ask, agree how far to go, set up

**Look first.** When a project already exists, read its real state before
you say anything about it:

```bash
npx protoboard inspect                       # what the project holds now: instances, definitions by tier, links
npx protoboard check                         # what the rules find
npx protoboard doctor                        # extensions, tools, skills, the sign-in
```

With Protoboard's MCP server connected, `project_status` first. Describe
what these report. Never answer "what is in this project" from memory, from
an earlier session or from the template's description: a project that
started empty may hold a whole system by now.

**Ask, in plain words.** Before modelling, ask the few questions whose
answers change the work, in one short list, and wait for the answers:

1. What is it, in one sentence, and who uses it?
2. What must it do? The three or four things it cannot do without.
3. What is already fixed? A size, a battery, a part that must be used, a price.
4. How far should this go now? Offer the levels below by what the person
   gets from each, with the concept as the default.
5. Is there earlier work to build on, such as another project's research?

How to ask:

- Everyday words. Spell out every abbreviation the first time: "UV-C
  (ultraviolet light that disinfects)", "BLE (Bluetooth Low Energy)", "DRC
  (design rule check)".
- No labels from your own notes, no codenames, no marketing words
  ("positioning", "parity with model X"). Ask the question the label stands
  for: "Should it do everything the earlier model does, or only clean the
  water?"
- Say what each choice leads to, in a few words.
- **A free-text answer is always possible.** When your host shows questions
  as a card with options, add "something else: I will type it" to every
  question, and accept an answer typed in the chat in place of the card.
  Options are a convenience, never the only way to answer.
- At most five questions at once. When one stays unanswered, say which
  assumption you will work with and go on at the concept level: do not
  block the conversation on a card.

**Agree how far to go.** Five levels; each is complete and useful by itself.

| Level | People say | You build | You do not build yet | Done when |
| --- | --- | --- | --- | --- |
| 1. Concept | "rough draft", "concept", "sketch", "block diagram", "just the big pieces" | 3 to 6 top-level capability blocks (for example power, control, sensing, output, user controls, housing) as children of the top-level module, each with a name, one line saying what it is for, and only the interfaces that join it to the other blocks; the links between them. All in the top-level module's own file under `src/` | no circuit boards, no blank part for each board or component, no file or folder per board (`src/boards/…`), no provider configs, no sourcing, no harness modules, no CAD | `check` has 0 errors, the diagram shows 3 to 6 nodes, and the person has looked at it |
| 2. Blocks | "break it down", "what is inside each block" | each capability block opened into its functional blocks, still without part numbers ("microcontroller", "charger", "level sensor"): the interfaces carry their protocols and voltages, the links follow the functions, and each block is marked bought or designed here (**Decision points**) | no real parts, no board nets, no provider configs | every requirement of the brief lands on a block (stage 1); `check` has 0 errors |
| 3. Parts | "pick the parts", "a real bill of materials" | a real part behind every block (stages 2 and 3), each custom board as a module with its components as children in `src/boards/<name>/`, the harnesses (stage 4) | no PCB layout, no enclosure or cable CAD, no documents | no `PB_UNRESOLVED_DEFINITION`; `check` has 0 errors; `npx protoboard bom` prices it |
| 4. Definitions verified | "make sure it is right", "review it" | every researched part verified against its sources, the sourcing audited, the fault scenarios, the independent reviews (stage 8) | nothing generated for manufacture | stage 8's exit check |
| 5. Schematic and PCB | "make the board", "ready to build" | stages 5 to 11: boards, enclosures and structures, harness CAD, firmware configuration, documents, the release | | stage 11's exit check |

- Start at level 1 unless the person named a deeper one. "Rough draft",
  "concept", "first pass" and "just show me the idea" all mean level 1.
- A block without a part behind it is a blank part: name it for what it
  does, not for a part you have in mind, and say in its description that no
  part is chosen yet. At levels 1 and 2 the blocks live in the files that
  hold their parent; they get files of their own at level 3.
- At the end of a level, stop: show the diagram, say in two or three
  sentences what is there and what is assumed, and ask whether to go a
  level deeper. Do not go deeper unasked: a multi-board design in answer to
  "a rough draft" costs the person an hour to undo.
- When the request itself names the end ("down to parts", "to a release"),
  that is the level: say so at the start and work down to it, still
  finishing each level's check on the way.
- Going back up is allowed: a level-3 project can get a new block at level
  1 detail. Say which parts of the system are at which level.

**A project made from another.** When the new project builds on another
project's research (datasheets, teardowns, notes, part evidence), ask which
the person wants:

- **Link it**: the research stays where it is and is read from there.
  Nothing is duplicated; the new project depends on that folder staying
  put. Record every linked path in the new project's `AGENTS.md`, under a
  heading `## Linked research`, one line each: the path, what it holds, the
  date. Read from it; never edit the other project's files.
- **Carry it over**: copy it into the new project (`docs/research/<source
  project>/`, part evidence into `parts/evidence/`). The project stands
  alone; the copy can go stale. Record where it came from and when in
  `docs/decisions.md`.
- **Neither**: start clean, and say that the earlier findings are not used.

Do not decide this silently: a new project that lacks the earlier research
looks finished and is not.

**Set up the project.** A folder is a project when it has a
`protoboard.config.ts`. When there is none, ask whether to start one now and
from which template, then:

```bash
npx protoboard init --list                       # the templates and what each starts from
npx protoboard init <dir> --template <id>        # without --template: an empty project
```

The project uses the Protoboard installed on the machine, which is the
default: there is no install step in the project, and you never tell the
person to run npm there. A copy of the stack inside the project
(`npx protoboard init <dir> --stack project`) is the exception: ask before you do
it, and say that it needs Node.js with npm and access to the package
registry. The top-level module lives under `src/` (`root` in
`protoboard.config.ts` names its file); keep it there. When the new project
opens in VS Code, VS Code asks whether the person trusts the folder: tell
them to expect that and to choose **Yes, I trust the authors**, because the
Protoboard views stay off until they do.

List the extensions in `protoboard.config.ts`. A project that designs its
own boards, enclosures or cables needs their providers; one that only
composes purchased modules does not.

| Extension | For |
| --- | --- |
| `@protoboardai/ext-hardware` | this SOP, system composition, harnesses, tests, BOM |
| `@protoboardai/ext-release` | `protoboard release` and the Manufacturing Package (**release**) |
| `@protoboardai/ext-sourcing`, `@protoboardai/ext-parts` | sourcing and the project-researched part tier |
| `@protoboardai/ext-tscircuit` | custom PCBs (`circuit`; selected by a board's `circuit.config.ts`) |
| `@protoboardai/ext-enclosure-cad`, `@protoboardai/ext-frame-cad`, `@protoboardai/ext-harness-cad` | enclosures, plates and frames, routed cables (`cad`) |
| `@protoboardai/ext-zephyr`, `@protoboardai/ext-esp-idf` | firmware configuration of a board's controller (`firmware`; selected by a board's `firmware.config.ts`): Zephyr board definition (nRF52840), ESP-IDF pins header and `sdkconfig.defaults` (ESP32-C3) |
| `@protoboardai/ext-drone` | flight-controller configuration (Betaflight CLI) |
| `@protoboardai/ext-docs` | datasheet and assembly guide |

```bash
npx protoboard doctor                        # extensions ✓, tools ✓/✗ with install hints, skills found
npx protoboard tools install cad             # if a cad provider is used: the shared Python runtime (~1 GB, once per checkout)
npx protoboard skills export --host all            # only when .claude/skills/ is missing: put every SOP where the agent host finds it
```

Look at `doctor`'s Tools: every tool a stage needs must be ✓ before that
stage, or the stage's operations are refused (`run`) and its checks skipped
(`check`), which is unknown, not passed.

### 1. Brief and requirements

**system-compose** step 1: turn `docs/brief.md` into checkable requirements,
each mapped to how it will be shown (a UHD rule, an assembly check, a
document value, or a test), state the product in `docs/product.json`
(summary, features, functions, requirements: the documents' first page),
and start `docs/decisions.md`. Decide which
functions are bought and which are designed here (**Decision points**).

### 2. Sourcing

For every function the brief needs, find the part before modelling it:

1. Look in the project and the catalog first:

   ```bash
   npx protoboard inspect                       # what the project already has
   npx protoboard parts search <words> --format json   # catalog; --protocol, --domain, --tag narrow it
   ```

2. Not there, or not right: **part-search** (requirement first, lanes,
   `docs/sourcing/<need>.md`), then **datasheet-extract** for every value
   that matters, **supplier-compare** and **lifecycle-alternates** for the
   chosen part, and **sourcing-verify** before authoring.

Record each selection in `docs/decisions.md` with the requirement it meets.

### 3. Parts, by tier

| Tier | How |
| --- | --- |
| Cloud catalog | `npx protoboard parts add <id>` (or `<id>@<rev>`): the revision, its closure and files into `parts/catalog/`, with its `.uhd.ts` source in `parts/catalog/<id>/` (`--compiled`: JSON only), pinned in `parts/origins.json` |
| Project-researched | **part-handoff** → **uhd-part-research** → **uhd-part-author** ↻ **uhd-part-verify**: `parts/local/<id>.uhd.ts`, evidence in `parts/evidence/<id>/`, verification recorded with `npx protoboard run part-verification --input part=<id>` |
| Project-specific | designed in `src/` in the next stages (system, boards, enclosures, structures, harnesses) |

```bash
npx protoboard parts add <id> --format json          # results[].status: added, unchanged, restored, conflict
npx protoboard run part-verify --input part=<id>     # stage 1 of uhd-part-verify, for a parts/local part
npx protoboard check --severity info                 # HW_* (evidence) and SRC_* (sourcing) findings
```

A verified project-researched part may be offered to the catalog once
someone with the publish token agrees (**part-handoff** step 5):

```bash
npx protoboard parts publish parts/local/<id>.uhd.ts --dry-run
```

### 4. System composition and harnesses

**system-compose** steps 2 to 5: the root system's instances, links,
sub-assemblies and mates, then the fault scenarios. **harness-author**: a
harness for every physical carrier (cables with connector ends and
conductors, soldered ends as compositions, fastener stacks for mechanical
joints).

```bash
npx protoboard check --format json
npx tsx node_modules/@protoboardai/ext-hardware/skills/system-compose/scripts/scenarios.ts
npx tsx node_modules/@protoboardai/ext-hardware/skills/harness-author/scripts/stackup.ts
# in an npm workspace (the stack's examples) node_modules is the workspace's: ../../node_modules/@protoboardai/...
npx protoboard dev --open                    # the system diagram and 3D view, live while you edit
```

Look at `checks[]` (every validator `ran`) and `diagnostics[]` (fix errors
in the order **system-compose** step 5 gives). Then look at the diagram as
the person will: lay it out so that it reads (the project's `AGENTS.md`,
"The diagram's layout": you may write `.protoboard/display.json`), and check
the result in the viewer before you call the level done. Stop the `dev` server
(`Ctrl+C`) when you no longer need it.

### 5. Boards (circuit capability)

For each custom PCB, **circuit-board**: the board as a UHD module in
`src/boards/<module>/` (components as children, nets as links), a
`circuit.config.ts` naming the provider and constraints, then:

```bash
npx protoboard capabilities                                  # the board is bound to its provider ✓
npx protoboard run circuit:generate --module <board>
npx protoboard run circuit:export --module <board>          # out/: Gerber, drill, BOM, PnP, GLB, STEP, manifest, netlist
npx protoboard run circuit:extract --module <board> --format json   # frames of connectors and buttons for the enclosure
npx protoboard run circuit:check --module <board> --format json
```

Boards come before enclosures: the enclosure is fitted around
`out/board.glb` and aligned to the frames in `out/board.manifest.json`.

A board is done when the person can see it in the viewer, not when the
commands pass. Its outputs reach the viewer by themselves (the provider's
artifacts); check that every tab draws:

```bash
npx protoboard views check --module <board>    # Diagram, 3D, Schematic, PCB and BOM each draw; exit 1 on an empty or erroring tab
```

Then the hand finish, when the person wants one: a KiCad preview with
`circuit:kicad` at any time, and the handoff to KiCad with `circuit:lock`
only when the person decides (**circuit-board** step 8), reviewed with
**kicad-layout-review**.

Before any change to a board, say where the fix belongs: the UHD model
first, then the tscircuit stage (placement, widths, rules,
`circuit.config.ts`), then the stack (a converter or provider bug to report,
never to hand-patch), and KiCad only for the hand finish. A locked board is
not fixed in place: for a change upstream, propose unlocking and re-locking,
and say which KiCad work it would lose. **circuit-board** step 0 has the whole rule, with mistakes and design choices and post-lock
steps.

### 6. Enclosures and structures (cad capability)

Each custom mechanical module gets a `cad.config.ts` naming its provider:

| Module | SOP | Provider |
| --- | --- | --- |
| Case, cap, back cover around a board | **enclosure-cad** | `@protoboardai/ext-enclosure-cad` (`process: print` or `machine`) |
| Plate, frame, bracket from bolt patterns | **frame-cad**, then **frame-cad-verify** | `@protoboardai/ext-frame-cad` (`process: cut` or `machine`) |
| Bought screw, nut, spacer or standoff researched in the project | **frame-cad** step 6 | `@protoboardai/ext-frame-cad` (no process: bought) |
| Body of another researched part, drawn from its drawing | **uhd-part-author** (In a project) | `@protoboardai/ext-parts`, running the part's own script (no process) |

```bash
npx protoboard run cad:generate --module <module>
npx protoboard run cad:export --module <module>
npx protoboard check
```

Every CAD body goes through the capability, a bought part's too: a script
run by hand is not traced by the release, which refuses a module whose
`out/` has no `cad:export` record. The aliases (`frame-cad`,
`hardware-cad`, `harness-cad`) run the capability for each module and leave
each its own `cad:generate` and `cad:export` record. After a structure changes, re-derive the
fastener stacks on its faces (**harness-author** step 3).

### 7. Harness CAD

**harness-cad** for every wire harness: a `cad.config.ts` per cable, then
the routes through the assembled model.

```bash
npx protoboard run harness-cad               # every cable, in the system's routing order
npx protoboard check                         # HARNESS_* findings, ends still meet their parts
```

Set a cut-to-length cable's `length_mm` from the route it reports, then
regenerate.

### 8. Checks and fault scenarios

The whole project, with nothing stale:

```bash
npx protoboard check --severity info --format json
npx tsx node_modules/@protoboardai/ext-hardware/skills/system-compose/scripts/scenarios.ts --json
npx protoboard build                         # .protoboard/build/resolved.json and the UHD bundle
```

0 errors; every warning dispositioned in `docs/decisions.md`; every
scenario `caught`; no `*_STALE`, `PB_OUTPUT_*` or `HARNESS_*_STALE` finding.
Then the independent reviews, each by a fresh agent: **system-review**,
**harness-verify**, **frame-cad-verify** (if plates), **sourcing-verify**
(if sourced parts).

### 9. Firmware configuration

The configuration is derived from the model's links and part facts, every
line cited. Two kinds:

- **A board you design** (a microcontroller on your own PCB): a `firmware`
  capability provider, chosen in the board's `firmware.config.ts`
  (`@protoboardai/ext-zephyr` for nRF52840, `@protoboardai/ext-esp-idf` for
  ESP32-C3; **firmware-config-zephyr**, **firmware-config-esp-idf**). The
  config holds only what the model cannot state (wake sources, a driver
  property, the board name).

  ```bash
  npx protoboard run firmware:generate --module <board>   # src/boards/<board>/zephyr/ or esp-idf/ (provider-owned)
  npx protoboard run firmware:export   --module <board>   # src/boards/<board>/out/config/ + out/firmware.manifest.json
  npx protoboard check                                     # includes firmware:check: FW_* findings, drift from the model
  ```

  `out/config/` is what the firmware build and the release read: a Zephyr
  board definition and Kconfig fragment, or an ESP-IDF `board_pins.h` and
  `sdkconfig.defaults`. `firmware.manifest.json` lists every file with its
  digest and the UHD facts each setting line cites. Re-run generate and
  export after any change to the board's nets or parts (`FW_*_STALE`).
- **A bought flight controller** (**firmware-config**, @protoboardai/ext-drone):

  ```bash
  npx protoboard run betaflight-cli            # firmware/betaflight/cli.txt, every hardware UART set
  ```

**firmware-verify** is a bench step a person performs.

### 10. Documents, BOM and test plan

```bash
npx protoboard run bom                       # docs/bom.md and docs/bom.json
npx protoboard run tech-docs                 # datasheet and assembly guide (uhd-tech-docs)
npx protoboard run tech-docs-verify          # then the visual review (uhd-tech-docs-verify)
```

**test-and-measure** writes `docs/test-plan.md` from the requirements, the
warnings and the stand-in data: inspection, bring-up (rails, current against
the budget, programming, bus scans), functional checks per requirement.

### 11. Release and the Manufacturing Package

Choose the package units (**Decision points**) and name them in
`protoboard.config.ts` (or `release.config.ts`):

```ts
release: { units: ["<sub-assembly instance or module id>", "<board>", "<enclosure>"] },  // the root is always a unit
```

Then follow **release** (`@protoboardai/ext-release`):

```bash
npx protoboard release --check          # the preconditions only; writes nothing
npx protoboard release [--version <v>]  # default version: the root module's `version`
```

`--version <v>` is the release version; `npx protoboard --version` alone
still prints the CLI's. The command refuses to run while `check` reports
errors, any generated output is stale or edited, or the tree has
uncommitted changes (`--allow-dirty` only for a trial package nobody builds
from), and writes `release/<v>/`: `index.html`, `manifest.json`,
`00-overview.pdf`, `ordering-list.csv`, `system/` and `units/<unit>/` (spec
sheet, BOM, work order, assembly guide, test plan, `files/`).

`release --check` passing does not make the package buildable. Read every
unit's work order and test plan end to end, in build order, as the person
who will use them: nothing done in a sub-unit is undone or repeated at
final assembly (an enclosure unit that closes its lid, inserts set twice),
every bring-up row is a real measurement on this board (its design values,
its programming port, each bus device), and every hold or deviation the
project knows (unverified land patterns, a missed requirement) is stated
where the reader acts on it (`fab_notes`, docs/decisions.md).

### 12. Evals

`npx protoboard evals` runs the eval cases the installed extensions ship in
`evals/` on scratch copies of their fixtures and writes a scorecard to
`.protoboard/evals/<run>/` (`--list` shows the cases; the default scripted
host replays each case's known-good solution; `--host claude-code` runs an
agent). Run it when the project is used as a reference or a fixture for
agent quality; it is not a gate for a release.

## Decision points

| Decision | Rule |
| --- | --- |
| How far to go | The level the person asked for; level 1 (concept) when they did not say or said "rough draft". Ask before each level deeper (step 0). |
| Research from another project | The person chooses: link (paths recorded in `AGENTS.md` under `## Linked research`), carry over, or neither (step 0). |
| Machine-wide or project-local install | Machine-wide, the default. Project-local only when the person asks for it or agrees to it. |
| Buy or design a function | Buy a module when one meets the requirement and fits the envelope (**part-search**). Design a board only when no module fits (size, connector placement, power, cost at the build quantity) and record why in `docs/decisions.md`. |
| Which part tier | Catalog first (`parts search`); project-researched (`parts/local/`) when the catalog lacks it or holds the wrong variant; never edit `parts/catalog/`. A local variant of a catalog part gets its own id. |
| Publish a researched part | Only after **uhd-part-verify** accepted it, `check` is clean, and someone holding the publish token agrees. The project keeps its local copy until it re-adds the catalog revision. |
| Which `cad` provider | Plates and frames from bolt patterns: ext-frame-cad. Cases around boards and parts: ext-enclosure-cad. Cables: ext-harness-cad. One config per module. |
| When to move to the next stage | Its exit check (**Verification**) passes. A stage that cannot pass (a missing tool, an unconfirmable part identity, a risk only a person can accept) stops the procedure: report what is missing and what would resolve it. |
| Order when something changes | Re-run every stage downstream of the change: a part change → system checks → boards → enclosures → harness routes → documents → release. `*_STALE` findings show which outputs are behind. |
| Package units | Each subsystem built or bought as one thing gets a unit (a sub-assembly, each custom board, each enclosure). A module that is not a unit folds into the nearest unit above it. A small project has only the root. |
| Long processes | Before one (hand-routing, a regroup of many parts, a sweep of several builds, a large search): say what it will do and roughly how long it takes; ask when it is optional. Do not over-optimise a small area before asking whether it needs doing at all. |
| Where the work happens | In Protoboard: the modules own the data, and the build steps write each tool's files. Do not manage KiCad or tscircuit libraries, symbols, footprints or models directly, unless the job needs something Protoboard cannot do (a SPICE model, for example); then say so first, as the fallback rule asks. |
| What needs a person | Accepting a sourcing risk, signing off a weak or drawing-only datasheet value, publishing to the catalog, every physical step (bench, flight, assembly), and any order. |

## Outputs

| Output | Where |
| --- | --- |
| Brief, product statement, requirements trace, decisions | `docs/brief.md`, `docs/product.json`, `docs/decisions.md`, `docs/sourcing/` |
| Linked research, when the person chose to link | `## Linked research` in `AGENTS.md` (paths, what each holds, the date) |
| Parts | `parts/catalog/` + `parts/origins.json`; `parts/local/` + `parts/evidence/` |
| The system and designed modules | `src/` (the top-level module, sub-assemblies, boards, enclosures, structures, harnesses), each designed module with its `*.config.ts`, native folder and `out/` |
| Fault scenarios | `src/scenarios.ts` |
| Diagram layout and display placements | `.protoboard/display.json` |
| Firmware configuration | a designed board's `src/boards/<board>/firmware.config.ts`, provider folder (`zephyr/`, `esp-idf/`) and `out/config/` + `out/firmware.manifest.json`; a bought flight controller's `firmware/betaflight/cli.txt` |
| BOM, documents, test plan | `docs/bom.*`, `docs/<system>-datasheet.*`, `docs/<system>-assembly-guide.*`, `docs/test-plan.md`, `docs/test-data/` |
| Reviews | `docs/reviews/` |
| Release | `release/<version>/` (the Manufacturing Package and manifest) |
| Operation records | `operations/` (commit them with the outputs they describe) |

## Verification

Run these in order; the first that fails is the stage to work on.

| Stage | Done when |
| --- | --- |
| 0 | the level is agreed; `npx protoboard doctor` exits 0 with every tool that level needs ✓ |
| Level 1 (concept) | `check` has 0 errors; the top-level module has 3 to 6 children and no `src/boards/`; the person has seen the diagram and was asked about level 2 |
| 1 | every requirement has a "shown by" entry; `docs/product.json` states the summary, features and functions (`protoboard release --check` has no `REL_PRODUCT_NOT_STATED`) |
| 2–3 | `npx protoboard check --severity info` has no `PB_UNRESOLVED_DEFINITION`, `HW_*` error or warning, or unaccepted `SRC_*` warning; every `parts/local` part has `verification.json` |
| 4 | `check` has 0 errors; `scenarios.ts` prints every scenario `caught`; `stackup.ts` exits 0; **system-review** and **harness-verify** files exist with no open blocker |
| 5–7 | `npx protoboard capabilities` shows every designed module ✓; `check` has no `PB_OUTPUT_*`, `PB_VIEW_UNREACHABLE`, `*_STALE`, `CIRCUIT_*`, `ENCLOSURE_*` or `HARNESS_*` error or warning; `npx protoboard views check` exits 0 (every tab of every level draws) and the person can see each board in the viewer |
| 8 | the full `check` is clean as above; every warning dispositioned |
| 9 | every board with a `firmware.config.ts` exported (`firmware:export`) with `check` showing no `FW_*` error or `*_STALE` finding; `firmware/betaflight/cli.txt` regenerated from the current model; open items listed |
| 10 | `tech-docs-verify` succeeds and the visual review is recorded |
| 11 | `release/<version>/manifest.json` exists; rebuilding in a clean clone gives the same digests |

## Failure handling

| Code or symptom | Means | Do |
| --- | --- | --- |
| `PB_EXTENSION_NOT_INSTALLED`, a `doctor` tool ✗ | The stage's extension or tool is missing | List the extension in `extensions` (the machine's Protoboard carries every extension; in a project with its own copy, ask the person before installing a package); `npx protoboard tools install <cad\|circuit>`; re-run `doctor` |
| The person asked for a rough draft and got boards, or cannot answer a question card | The level was not agreed, or the questions were not plain | Go back to step 0: cut the model back to the level asked for, ask again in plain words, accept a typed answer |
| An answer about the project turns out wrong ("it is still empty") | It was given from memory | `npx protoboard inspect`, then correct what was said |
| `PB_UNRESOLVED_DEFINITION` | A part the system uses is not in the project | stage 3: `parts add`, or author it in `parts/local/` |
| `PB_INVALID_ENDPOINT`, `UHD_LINK_STATE` error | The system is wired wrong, or a part fact is wrong | stage 4 (**system-compose** step 5) |
| `HW_NO_SOURCES`, `HW_VERIFICATION_WRONG`, `SRC_*` warnings | Part evidence missing or wrong | stages 2–3 |
| `PB_CAPABILITY_*`, `PB_PROVIDER_*` | A designed module's config is wrong or its provider missing | the module's SOP (**circuit-board**, **enclosure-cad**, **frame-cad**, **harness-cad**) |
| `*_STALE`, `PB_OUTPUT_NOT_EXPORTED` | Outputs behind the model | regenerate in stage order (boards, enclosures and structures, harnesses), then documents |
| A check `skipped` in `checks[]` | Unknown, not passed (a tool missing, an upstream error) | fix the reason it gives, re-run |
| `protoboard release` refuses | errors in `check`, stale or edited outputs, uncommitted changes | `release --check` names each; stage 8 or commit, then retry |
| `protoboard release` / `evals` not in `--help` | An older CLI, or `@protoboardai/ext-release` not installed | update the CLI or install the extension (`npx protoboard doctor`); otherwise skip and say so |
| A part's identity cannot be confirmed, or a risk needs accepting | Only a person can decide | stop and report, with the closest documented alternative |

Every other code: **system-compose** [diagnostic codes](../system-compose/references/diagnostic-codes.md).

## Hard rules

1. Follow the stage order; going back is normal, skipping a stage's exit
   check is not.
2. Fix findings in the model or a provider's config, never in generated
   files (`out/`, native folders, `firmware/`, generated documents).
3. Every number traces to a source, a recorded decision, or an `assumption`
   trait. A passing check validates the model, not the hardware.
4. No orders, uploads, prints, accounts or credentials; physical steps are
   for a person.
5. Work at the level asked for. A rough draft is the concept: 3 to 6
   blocks. Ask before going a level deeper.
6. Describe a project from what `inspect` and `check` report now, never
   from memory.
7. Never tell the person to run npm in a project. Ask before a
   project-local install.
8. Never make placeholder CAD or 3D models from datasheets while the part's
   UHD artifacts or its JLC/LCSC source has one; when none does, ask first.
9. A board change goes where it belongs (the model, the tscircuit stage, a
   stack bug, then KiCad), said before the edit; a locked board is unlocked
   and re-locked for an upstream change, by the person's decision.

## Diagram layout

The diagram is the first thing the person looks at, at every level of
detail. A level is not done until its diagram reads. At the end of
every level (concept, blocks, parts) and after any change that adds or
removes modules:

1. **Lay it out by function.** The module most things connect to (the
   processor, the flight controller, the power stage) in the middle; what
   feeds it (connectors, power) on the left; what it drives (sensors,
   outputs) on the right; parts that work together side by side. Compact and
   about the shape of a screen: never a long row or column of parts. Parts
   linked to nothing (seals, pads, consumables) go together below the rest.
2. **Measure it.** `npx protoboard layout` (`project_layout` on the MCP
   server) reports each level as the viewer draws it: line crossings,
   overlapping cards, the longest row or column of cards (a strip), the
   aspect ratio, lines under cards, and what to fix.
3. **Fix what it reports.** `npx protoboard layout <level> --apply` lays a
   level out afresh; `--tidy` keeps your arrangement and fixes it; `--pin
   <card>` keeps a card you placed on purpose. Or move cards in
   `.protoboard/display.json` (the project's `AGENTS.md`, "The diagram's
   layout") and measure again. Two tries per level: if it still does not
   pass, say what is left and show it, rather than going round again.
4. **Look at it** in the viewer (`npx protoboard dev`, or VS Code) as the
   person will, then report the numbers with the level. `check` lists a
   level of modules that still needs work as `PB_DIAGRAM_LAYOUT` (info).

A board's own sheet is laid out as a schematic. When a board of dozens of
parts reports a strip or many crossings, the fix is in the model, not the
file: group its parts into sub-modules by function (power, processor,
sensors, outputs), each a level of its own.
