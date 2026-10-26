# The SOP format for skills

Every skill an extension ships is a **standard operating procedure** (SOP):
a procedure an agent, or a person, can follow from start to finish without
having been told how the stack works. The format is one of the agreements in
[releases, package, SOPs and evals](../specs/release-package-and-evals.md#4-standard-operating-procedures)
. The top-level SOP, **build-a-project** in `@protoboardai/ext-hardware`,
takes an agent from a brief to a release by delegating to the others in order.

This page defines the format, gives a template, and walks through one skill
written in it. `packages/cli/test/skills-sop.test.ts` checks every skill in
this repository against it.

## 1. Where skills live

A skill is a folder in an extension package, declared in its manifest:

```text
packages/ext-<name>/
  protoboard-extension.json      "skills": [{ "id", "summary", "path", "verifiedBy"? }]
  skills/<skill id>/
    SKILL.md                     the SOP
    references/                  long tables and worked examples the SOP links to
    scripts/                     helpers the SOP runs (npx tsx node_modules/@protoboardai/ext-<name>/skills/<id>/scripts/…)
    templates/                   files the SOP copies
```

- The folder name, the manifest `id` and the frontmatter `name` are the same.
- `verifiedBy` names the paired verification skill, when there is one.
- The package's `package.json` `files` includes `skills`, so npm ships them.
- `protoboard skills` lists the installed skills (`--format json` for agents);
  `protoboard skills export --host claude-code` copies each skill folder to
  `.claude/skills/<id>/`, and `--host agents-md` indexes them in `AGENTS.md`.
  Skills are exported side by side, so one skill may link to another's files
  as `../<other id>/references/…`.

## 2. The sections

`SKILL.md` starts with host frontmatter, a title and a short lead (a diagram
is welcome), then these `##` sections, in this order, all present:

| Section | Holds | Rules |
| --- | --- | --- |
| **Purpose** | What the procedure achieves, **when** to use it (and when not), and where it sits in build-a-project | One or two paragraphs. Name the step before and after. |
| **Inputs** | What it needs and where each input lives | A table: input, where (path or command), produced by (skill or person). Missing inputs stop the procedure; say which skill makes them. |
| **Steps** | Numbered `### 1. …` subsections, each with the exact commands and what to look at in their output | Commands in fenced `bash` blocks, written `npx protoboard …` as a user runs them in the project. Every command and flag must exist (`npx protoboard --help`); every operation must be declared by an extension (`protoboard doctor`). After each command, say what to read in its output (a field of `--format json`, a summary line, a file). |
| **Decision points** | The choices the procedure forces and the rule for each | A table: decision, rule. A rule says what to do, not "use judgement". Where a person decides, say so. |
| **Outputs** | What the procedure leaves and where | A table: output, path. Name generated files that must never be hand-edited. |
| **Verification** | The commands and checks that prove it is done, and the paired verification skill | Runnable checks first (`protoboard check`, operation exit codes, scripts), then the independent review skill (`verifiedBy`). |
| **Failure handling** | What each common failure means and what to do | A table: diagnostic code or symptom, meaning, action. Codes are explained in full in **system-compose**'s [diagnostic codes](../../packages/ext-hardware/skills/system-compose/references/diagnostic-codes.md) reference; the SOP lists the ones it meets and links there for the rest. |

Optional sections go **after** Failure handling: **Hard rules** (the
non-negotiables, kept short and numbered) and reference material that does not
fit a step. A skill that is a reference rather than a procedure (UHD's
`uhd-authoring`, shipped by `@deltarobotics/uhd`) is outside this format.

### Writing rules

- **Commands are exact.** Copy flags from `--help`. `--input key=value` keys
  must be inputs the operation declares. A capability operation is
  `npx protoboard run <circuit|cad>:<generate|export|extract|check> --module <id>`.
- **Commands planned but not built yet** are written as their spec defines
  them and marked as planned, with what to do meanwhile (`protoboard release`,
  `protoboard evals`, the `firmware` capability). The test keeps a list of
  them; when one lands, it is removed from the list and checked like the rest.
- **Name other skills in bold** (`**harness-author**`); every bold
  hyphenated name must be an installed skill.
- **Paths are project-relative** and use the tiers of
  [tool integrations](../specs/tool-integrations.md#6-parts-three-tiers):
  `parts/catalog/` (cloud catalog, via `protoboard parts add`), `parts/local/`
  with `parts/evidence/` (project-researched), `src/` (project-specific, with
  each designed module's provider directory holding its `*.config.ts`, native
  folder and `out/`).
- **Standard outputs are what downstream reads.** A skill that needs a
  board's or a part's geometry reads `out/` (`board.glb`,
  `board.manifest.json`, `body.step` …), never a provider's native folder.
- **No real-world actions.** No orders, uploads, prints, accounts, cloud
  autorouting or credentials in files. A step with physical effects says that
  a person performs or authorises it.
- Plain, direct prose. Numbers carry their source or are labelled targets or
  assumptions.

## 3. Template

````markdown
---
name: <skill id>
description: <What it does, in one sentence with the key nouns an agent searches for>. Use when <trigger>; follow with <verification skill>.
---

# <Title>

<One paragraph: what this procedure turns into what. A small diagram helps.>

## Purpose

<What it achieves.> Use it when <situations>. Do not use it for <near
misses>; that is **<other-skill>**. In **build-a-project** it is step <n>,
after **<previous>** and before **<next>**.

## Inputs

| Input | Where | From |
| --- | --- | --- |
| <the module> | `src/<kind>/<module>/<module>.uhd.ts` | **system-compose** |
| <a runtime> | `npx protoboard doctor` shows `<tool>` ✓ | `npx protoboard tools install <cad\|circuit>` |

## Steps

### 1. <First action>

```bash
npx protoboard <command> --format json
```

Look at `<field>`: <what it means and what to do with it>.

### 2. <Next action>

…

## Decision points

| Decision | Rule |
| --- | --- |
| <choice> | <rule> |

## Outputs

| Output | Where |
| --- | --- |
| <native design> | `<dir>/<native>/` (generated; never edit) |
| <standard outputs> | `<dir>/out/` |

## Verification

```bash
npx protoboard check --format json     # 0 errors; <validator> ran
```

Then **<verification-skill>**, by an agent that did not do the work.

## Failure handling

| Code or symptom | Means | Do |
| --- | --- | --- |
| `<CODE>` | <meaning> | <action> |

Every other code: **system-compose** [diagnostic codes](../system-compose/references/diagnostic-codes.md).

## Hard rules

1. <rule>
````

## 4. Worked example

The circuit capability's SOP, **circuit-board** in `@protoboardai/ext-tscircuit`
(`packages/ext-tscircuit/skills/circuit-board/SKILL.md`), abridged. Each
section is shown with why it is written that way.

**Purpose** names the trigger and the neighbours in build-a-project, so an
agent that lands on the skill knows whether it is in the right place:

> Turn a UHD board module into a routed PCB and its standard outputs, and
> keep the copper and the model in agreement. Use it when a project needs a
> custom board, when the board module or its `circuit.config.ts` changes, or
> when `protoboard check` reports `CIRCUIT_*` findings. In
> **build-a-project** it is stage 5: after **system-compose** and the parts,
> before **enclosure-cad**, which fits the case around `out/board.glb`.

**Inputs** says where each input lives and which skill makes it:

> | Input | Where | From |
> | --- | --- | --- |
> | Board module | `src/boards/<module>/<module>.uhd.ts` | **system-compose** |
> | Parts with `package` and pin designators | `parts/catalog/`, `parts/local/` | `parts add`, **uhd-part-author** |
> | Provider config | `src/boards/<module>/circuit.config.ts` | this SOP, step 2 |

**Steps** give exact commands and what to read:

> ```bash
> npx protoboard run circuit:generate --module <module> --format json
> ```
>
> Look at `status` and `summary` (components placed, nets routed). A
> `failed` run with "Unable to pack all PCB components" needs positions in
> `tscircuit/layout.json`: add them and generate again.

**Decision points** turn judgement into rules:

> | Decision | Rule |
> | --- | --- |
> | 2 or 4 layers | 2 unless routing fails with every part placed, or a part's datasheet asks for a solid ground plane (a radio, a fine-pitch BGA, a high-speed bus). |
> | Fixed placement | A connector, button, display or sensor window the enclosure serves is fixed in `placements`; everything else may move |

**Outputs** separate what is generated from what the operator owns:

> | Output | Where |
> | --- | --- |
> | Native design | `src/boards/<module>/tscircuit/` (`board.gen.tsx` generated; `board.tsx`, `layout.json`, `footprints.json` yours) |
> | Standard outputs | `src/boards/<module>/out/` (Gerber, drill, `bom.csv`, `pnp.csv`, `board.glb`, `board.step`, `board.manifest.json`, `netlist.json`) |

**Verification** is runnable first:

> ```bash
> npx protoboard check --format json   # circuit:check ran for the board with 0 errors; standard-outputs ran
> ```

**Failure handling** maps codes to actions:

> | Code | Means | Do |
> | --- | --- | --- |
> | `CIRCUIT_STALE` | The board, `layout.json`, `footprints.json` or the constraints changed since generate, or the native source since the build | `run circuit:generate`, then `circuit:export` |
> | `CIRCUIT_NET_OPEN`, `CIRCUIT_NET_SHORT`, … | The copper's nets differ from the UHD nets | Regenerate; if routing cannot complete, move parts or add layers. Never change the UHD nets to match the copper |

## 5. What the test checks

`packages/cli/test/skills-sop.test.ts`, for every `SKILL.md` under
`packages/*/skills/`:

- it is declared in its manifest (and every declared skill exists), its
  package ships `skills`, and frontmatter `name` = id = folder;
- the seven sections are present, in order, non-empty, with other `##`
  sections only after them; Purpose says *when*; Steps are numbered;
  Failure handling has a table;
- every `protoboard …` command in a code block or inline code span, and every
  inline `run <operation>`, exists in the CLI's `--help` (commands,
  subcommands, runtimes, flags), every operation is declared by an extension
  in this repository with the `--input` keys it declares, and every
  capability operation is one the framework defines, except the planned
  commands listed in the test;
- every `node_modules/@protoboardai/…` script, `references/`, `templates/` and
  `scripts/` link, `../<skill>/…` link and bold skill name resolves;
- every diagnostic code the stack emits is in the diagnostic-codes reference,
  and every code a skill names is real.

It also installs every extension in a fresh project and checks that
`protoboard skills` lists every skill and that both export hosts write them.
