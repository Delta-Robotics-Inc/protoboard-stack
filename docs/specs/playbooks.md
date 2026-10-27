# Playbooks, skills and the Handbook

Status: design spec, accepted in direction on 2026-10-26; nothing here is built
yet. Builds on the extension model (architecture.md, "Extension model"), the
project templates (`packages/core/src/init.ts`, `packages/core/templates/`)
and the project structure (protoboard-project-structure.md).

## 1. The problem

Different kinds of hardware projects run different lifecycles. A class project
ends in a demo and a report on a fixed date; a robot iterates between subsystem
prototypes and field tests; an IoT device needs firmware updates, radio
certification and a fleet; a product goes through EVT, DVT and PVT builds
before mass production. Today the stack gives an agent skills (procedures for
one task) and templates (a starting system), but nothing that says which phase
a project is in, what that phase must produce, or what has to be true before
the next one starts. Engineers carry that in their heads; agents guess.

Software agents have converged on three layers of context, and on
spec-driven development for the lifecycle:

- **always-on project context**: `AGENTS.md` (or `CLAUDE.md`) at the root;
- **on-demand procedures**: Agent Skills (`SKILL.md`, an open standard most
  agents load), disclosed progressively: names and descriptions always,
  the body when a task matches, `references/` and `scripts/` only when the
  procedure needs them;
- **tools**: MCP servers and CLIs;
- **the lifecycle as documents**: spec, plan, tasks, implementation, each
  stage leaving a file the next one traces back to.

Hardware has mature lifecycle practice (systems engineering after
ISO/IEC/IEEE 15288, stage gates, IPC rules for boards), none of it written
for agents. Protoboard already has the spec (the UHD model) and the checks
(`protoboard check`, the extensions' checks); this spec adds the lifecycle.

## 2. Four kinds of content

| Kind | Answers | Example | Lives as |
|---|---|---|---|
| **Playbook** | What kind of project is this, what phase is it in, what must this phase produce, what closes it | `robotics`, `iot-device`, `product`, `class-project`, `teardown` | `playbooks/<id>/playbook.json` plus `README.md`, in an extension |
| **Skill** | How to do one task | `part-search`, `harness-verify`, `kicad-layout-review` | `skills/<id>/SKILL.md` (Agent Skills format), in an extension |
| **Handbook chapter** | What is true in this domain, with rulings and evidence levels | PCB core, Drones, Firmware, Research | Markdown, served to skills as references |
| **Extension** | Which of the above, plus tools, operations and checks, a project installs | `ext-drone`, `ext-hardware`, REH | An npm package with `protoboard-extension.json` |

Rules that keep them apart:

1. A playbook never contains a procedure. It names the skills that do the
   work and the checks that judge it.
2. A skill never decides the lifecycle. It does its task in whatever phase
   the playbook puts it.
3. A Handbook chapter is reference: it states rules and evidence, and is
   cited by skills and playbooks. It is never an instruction list an agent
   runs top to bottom.
4. Templates choose playbooks; they do not define phases (§6).

"Handbook" replaces the word "protocols" for this material: in a hardware
tool "protocol" means an interface or bus protocol (I²C, CAN), and the two
meanings collide.

The name "Handbook" is provisional: the team meeting of 2026-10-26 leaned
towards "workbook" (PB-1077), and Mark decides.

## 3. Playbooks

### 3.1 What a playbook declares

- **phases**, in order, each with:
  - **purpose**: one sentence;
  - **entry**: what must already exist;
  - **deliverables**: the artifacts the phase produces, as project paths or
    artifact kinds (a UHD system, a BOM, a test report, a build record);
  - **skills**: the skills that apply, by extension and id;
  - **gate**: what closes the phase, as checks (run by `protoboard check`)
    and sign-offs (a person records a decision);
- **extensions** the playbook needs, with version ranges;
- **handbook** chapters the phases cite;
- **composes**: other playbooks it layers on (§3.3).

### 3.2 Format (draft)

```json
{
  "schema": "protoboard.playbook/v0",
  "id": "robotics",
  "title": "Robotics project",
  "summary": "Requirements, a system architecture across mechanical, electrical and firmware, subsystem prototypes, integration and field tests, iterated.",
  "extensions": { "@protoboardai/ext-hardware": "^0.3.0", "@protoboardai/ext-parts": "^0.3.0" },
  "composes": [],
  "phases": [
    {
      "id": "requirements",
      "purpose": "Say what the robot must do, under what limits, and how each requirement will be checked.",
      "deliverables": [{ "path": "docs/requirements.md", "kind": "requirements" }],
      "skills": [],
      "handbook": ["robotics/requirements"],
      "gate": { "checks": ["@protoboardai/ext-hardware:requirements-present"], "signoff": "owner" }
    },
    {
      "id": "architecture",
      "purpose": "A UHD system covering power, compute, actuation, sensing and safety.",
      "entry": ["requirements"],
      "deliverables": [{ "kind": "uhd-system" }],
      "skills": ["@protoboardai/ext-hardware:system-compose", "@protoboardai/ext-hardware:system-review"],
      "handbook": ["pcb/core", "motion-control"],
      "gate": { "checks": ["core:uhd/assemble", "@protoboardai/ext-hardware:estop-path"], "signoff": "owner" }
    }
  ]
}
```

The format is data so that the CLI, the VS Code extension and an MCP client
read the same thing; `README.md` beside it is the version a person reads.
A gate names each check with the extension that provides it,
`<extension id>:<check id>` (as skills are named), because check ids are only
unique within one extension; it is the check `protoboard check` reports as
`ext:<extension id>/<check id>`. A check of the core is named `core:<validator>`
(`core:uhd/assemble`, `core:protoboard/catalog`). A gate naming a check no
installed extension (or the core) provides is a load error, not a silent pass.

### 3.3 Composition

Playbooks layer. `product` adds EVT/DVT/PVT, cost, compliance and supply
gates; it composes on top of a domain playbook (`robotics`, `iot-device`)
rather than repeating its phases. Composition rules:

1. Phases are merged by id; a layered playbook may add deliverables, skills
   and gate checks to an existing phase, and add phases. A phase it adds that
   the playbooks below do not have names where it goes: `"after": "<phase id>"`
   or `"before": "<phase id>"`, a phase of the merged lifecycle so far. A new
   phase without an anchor is a load error; phases anchored to the same place
   keep the layered playbook's own order. The merge is therefore one result
   for the same files, whichever tool reads them.
2. It may not remove a phase or a gate check of the playbook it composes on.
3. A project lists its playbooks in order; `protoboard doctor` shows the
   merged lifecycle.

### 3.4 State

The project records where it is in `protoboard/lifecycle.json`: the
playbooks, the current phase, and per phase the gate results and sign-offs
(who, when, what was decided). It is committed with the project. Sign-offs
are records like the review comments the owners already make; they are not
enforced locks, and a project may record a waiver with a reason.

## 4. How a project uses them

- `protoboard init --template drone` installs the template's extensions and
  playbooks (§6). `protoboard init --playbook robotics` does the same for a
  blank project. `protoboard playbook add product` layers one later.
- `protoboard check` reports, beside its findings, the current phase, its
  missing deliverables and failing gate checks. `protoboard phase` shows the
  lifecycle; `protoboard phase next` closes a gate when every gate check
  ran (status `ran`, as `protoboard check` records it) with no errors, and its
  sign-off is recorded. A check that was skipped (it threw, or its tool is
  unavailable) or did not run blocks the gate as a failure does; only a
  waiver recorded in `lifecycle.json`, with a reason, lets the phase close
  without it.
- The project's `AGENTS.md` gets a generated section: the playbooks, the
  current phase, the next deliverable and the skills that apply. Every command
  that changes the lifecycle (`phase next`, `playbook add`, a sign-off or
  waiver, an extension added or removed) rewrites that section in the same
  step, so `AGENTS.md`, `lifecycle.json`, MCP and VS Code never disagree;
  `init --refresh-guidance` rewrites it too, with the rest of the guidance.
- The MCP server exposes the lifecycle (`project_status` gains the phase and
  next deliverable), so an agent connected over MCP sees the same state.
- The VS Code extension shows the phase and its gate in the Inspector's
  project card. The copy stays terse: the phase name and what is missing.

## 5. The Handbook

- **Source**: Markdown chapters under `handbook/` in this repository
  (public chapters only), one folder per area (`pcb/`, `firmware/`,
  `research/`, `domains/drones/`, …). The format of a chapter (rulings,
  evidence levels, the "deviation from" convention for domain chapters) moves
  here from the internal authoring guide.
- **Delivery**: an extension declares the chapters its skills cite; the
  build copies them into each skill's `references/`, so agents load them only
  when the skill runs (progressive disclosure) and a skill works in any agent
  that reads Agent Skills.
- **Reading**: the docs site renders the whole Handbook for people.
- **Third-party material** (source notes on other people's videos, vendor
  guides) stays out of the public Handbook; chapters cite and link their
  sources instead.

## 6. Templates

Templates already declare their extensions and catalog parts
(`template.json`: `extensions`, `catalogParts`, `derivedFrom`). They gain
`playbooks`, an ordered list:

```json
{
  "title": "Drone: multirotor flight stack",
  "playbooks": ["robotics", "drone"],
  "extensions": ["@protoboardai/ext-hardware", "@protoboardai/ext-drone", "…"],
  "catalogParts": ["…"]
}
```

So a template is a starting system plus a lifecycle: the robotics template
uses the robotics playbook, a product template layers `product` on a domain
playbook, a class-project template uses `class-project` with a short
lifecycle. A blank project gets a default playbook (`hardware-project`: a
minimal requirements, design, build, test lifecycle) so every project has a
phase. Templates may also ship from extensions (architecture.md already
allows it), which lets a domain pack bring its own templates and playbooks
together.

## 7. Where things live

### 7.1 In this repository (the monorepo)

- the formats: `protoboard.playbook/v0` and the extension manifest's new
  `playbooks`, `handbook` and `templates` entries, with their loaders and
  checks in core;
- first-party extensions, and the playbooks and templates they ship:
  - general lifecycles (`hardware-project`, `product`, `class-project`) in
    `ext-hardware`, which every project installs;
  - domain lifecycles in their domain extension (`drone` in `ext-drone`;
    `robotics` and `iot-device` in new or existing domain packs);
- the public Handbook (`handbook/`).

Keeping these together means one release tests the formats, the loaders and
every first-party playbook end to end, which is the point of the monorepo
today.

### 7.2 In their own repositories

An extension belongs in its own repository when it has its own release
cadence, heavy tool requirements, contributors or users outside Protoboard,
or value as a standalone tool. Reverse Engineer Hardware (REH) is the first:
modelled on REA (Reverse Engineer Anything), useful to people who never run
the stack, with its own tools (instruments, firmware readers). It ships as an
npm package with `protoboard-extension.json` (its skills, operations, the
`teardown` playbook and its Handbook chapter), and its CI tests against the
published stack. Third-party extensions follow the same path.

The stack lists known extensions for `protoboard extensions add`; living in
another repository changes nothing for a project that installs one.

### 7.3 The format as a standard

The playbook format is meant to be adopted outside Protoboard. Once it has
settled (after two or three playbooks are in use), its schema and a short
specification move to their own document, possibly beside UHD, with Delta's
playbooks as the reference set. Until then it is versioned here (`v0`) and
may change.

## 8. First playbooks

| Playbook | Phases (sketch) | Notes |
|---|---|---|
| `hardware-project` | requirements → design → build → test | The default for a blank project |
| `class-project` | brief → concept → prototype → demo → report | Milestones are the course's; documentation is a deliverable |
| `robotics` | requirements → architecture → subsystem prototypes → integration → field test (iterated) | Safety gates: e-stop path, current limits |
| `iot-device` | requirements (power budget, connectivity) → architecture → prototype → firmware and OTA → certification → pilot → fleet | Composes with `product` |
| `product` | research → concept → EVT → DVT → PVT → mass production → sustaining | Layers on a domain playbook; gates on BOM cost, compliance, DFM/DFA, supply |
| `teardown` (REH) | target → evidence capture (seen / inferred / unknown) → dossier → rebuild spec | Feeds another playbook's research phase |
| `drone` | layers on `robotics` | Built first, from the quadcopter example |

## 9. Order of work

1. Format and loader: `protoboard.playbook/v0`, the manifest entries,
   `lifecycle.json`, `protoboard phase`, the phase in `check`, `doctor`,
   `AGENTS.md` and MCP. Tests with a fixture playbook.
2. `hardware-project`, `robotics` and `drone`, with the quadcopter example
   moved onto them and visually checked in VS Code.
3. The Handbook: rename the internal protocols, move the public chapters into
   `handbook/`, wire them into skills' references.
4. Templates gain `playbooks`; `class-project`, `iot-device` and `product`.
5. REH in its own repository, with the `teardown` playbook and the research
   chapter.

## 10. Open questions

1. Is a sign-off one owner or any maintainer, and does a team project need
   more than one?
2. Should a gate check be able to run an operation (a build, a render) or
   only read results already produced?
3. Does `lifecycle.json` belong in UHD (as project metadata other tools
   could read) or stay a Protoboard file? Default: Protoboard, per the UHD
   boundary (uhd-boundary.md).
4. How are a playbook's phases shown in the viewer, if at all?
