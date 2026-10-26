# Releases, the Manufacturing Package, SOPs and evals

Status: agreed; sections 1–3 are implemented (section 6). Builds on [the architecture](architecture.md) and
[tool integrations](tool-integrations.md).

A project built with the stack must end with everything needed to **order,
make, assemble and check** it, and an agent using the stack must know how to
get there. This page defines the release and its Manufacturing Package, the
standard operating procedures (SOPs) that take an agent from a brief to a
release, and the evals that measure how well agents follow them.

## 1. `protoboard release`

A release is a fixed, reproducible snapshot of a project. `protoboard release
[--version <v>]` refuses to run while `protoboard check` reports errors or any
generated output is stale against its sources, then writes the project's
**Manufacturing Package**. Rebuilding the same release in a clean environment
produces the same manifest digests. The release records what was produced; it
does not order, upload or print anything.

## 2. The Manufacturing Package

A folder, not one long document. It has a short overview, separate documents
per concern, and one HTML view of the whole package. It is laid out by
**module**: the operator decides which modules (typically each major
subsystem) get their own sub-package, and the system-level package ties them
together.

### Splitting by module

`protoboard.config.ts` (or `release.config.ts`) names the package units:

```ts
release: {
  units: ["stack", "arm_fl", "watch_board", "case"],   // instance paths or module ids; default: the root only
}
```

Every unit gets its own folder with the same structure. The root system is
always a unit. A module that is not a unit is folded into the nearest unit
above it. Each unit's documents cover what is built in that unit; the root's
documents cover final assembly of the units and the whole-product ordering
list.

```
release/<version>/
  index.html                       the full package: one HTML, navigable by unit and by section
  manifest.json                    release manifest (section 3)
  00-overview.pdf                  what the product is, the units, the order of work, where everything is
  system/                          the root unit (final assembly)
    spec-sheet.pdf
    bom.pdf  bom.csv  ordering-list.csv
    work-order.pdf
    assembly-guide.pdf
    test-plan.pdf
    files/                         files specific to final assembly (model bundle, firmware config, ...)
  units/<unit>/                    one folder per unit, same layout
    spec-sheet.pdf  bom.pdf  bom.csv  work-order.pdf  assembly-guide.pdf  test-plan.pdf
    files/
      boards/<module>/             Gerber + drill, bom.csv, pnp.csv, board.step, board.glb
      mechanical/<module>/         STEP, STL/3MF (print), DXF (cut)
      harnesses/<module>/          routed STEP/GLB, cut list
```

Small projects (one unit) get the overview plus the `system/` folder.

### What each document holds

1. **Overview** (`00-overview.pdf`, package level only): the cover with the
   totals (cost estimate, part count, lead time); then **the product page**
   (2026-10-07): what the device is, its features, what it does
   (functions) and its requirements with how each is shown, so a reader
   understands the product before the component detail. It is built from the
   project's own statement, `docs/product.json` (`protoboard.product/v0`:
   `summary`, `features`, `functions`, `requirements`), with the requirements
   taken from the brief's requirements table when the file states none, and
   the functions from the brief's table under a Functions heading (ID, the
   function, and a Hardware or By column for what does it) when the file
   lists none; the page then names the brief as their source. What
   the project has not stated, the page says is not stated; nothing is
   written for it, and `release --check` reports `REL_PRODUCT_NOT_STATED` as
   a warning. Then the units and how they fit together, the order of work
   across units, and an index of every document and file. The datasheet
   (ext-docs) opens with the same page after its cover.
2. **Spec sheet**: what the unit is and its key figures, from the model.
3. **Bill of materials** (`bom.pdf` + `bom.csv`): the unit's module breakdown
   (sub-assembly → board → components). The root unit also carries the
   rolled-up **ordering list** for the whole product (`ordering-list.csv`):
   quantities with attrition and spares, MPNs, suppliers and offers from the
   catalog and sourcing evidence, alternates, lifecycle. A series passive
   placed at several values (`ChildModuleRef.overrides`) is one line per
   value and MPN, priced only by offers for that MPN. Custom parts appear
   as fabrication line items; fastener-stack hardware and harness materials
   are included.
4. **Work order**: the manufacturing process for the unit:
   - ordering checklist (what to buy, where, lead time, MOQ);
   - fabrication orders per custom part (PCB: fab profile, stack-up, finish,
     assembly side, files; printed parts: material, printer profile,
     orientation, supports, post-processing; cut parts: process and stock);
   - assembly operations in sequence, derived from the model (board assembly,
     solder joints, harnesses, mates, fastener stacks), each with tools,
     materials, torque, an inspection point and the test step that follows;
   - kitting per operation.
5. **Assembly guide**: illustrated build steps for a person at a bench.
6. **Test and validation plan** (basic for v0.1): first-article inspection
   (dimensions, fits, seals), board bring-up (rails, current against the power
   budget, programming and boot, bus scans with expected addresses, peripheral
   smoke tests), functional checks per brief requirement, and the records to
   capture. Measured results are attached to the release later as evidence.

`index.html` contains all of it, with navigation by unit and by section, so
the package can be read in one place and printed in pieces. Traceability (the
release manifest in readable form) is a page in `index.html` and an appendix
of the overview.

### Section contract

An extension contributes content through a declared operation
(`package:<section>`) returning structured content for a given unit
(headings, tables, figures from artifacts, steps) plus the files it adds to
that unit's `files/`. The release operation decides the units, orders and
renders sections into the PDFs and the HTML; extensions never render whole
documents. Section ids: `spec`, `bom`, `work-order`, `assembly`, `test-plan`.
Several extensions may contribute to one section (the circuit provider adds
board fabrication orders and board assembly operations to `work-order`;
ext-harness-cad adds harness operations).

## 3. Release manifest

`protoboard.release/v0`: project id and version, UHD bundle digest, every
part's tier and pinned revision (catalog parts with service and envelope
digest), every provider output with the provider, its version, tool versions
and input digests, firmware configuration digest, the package's document digests, and the
check summary at release time.

## 4. Standard operating procedures

Every extension's skills follow one SOP format:

- **Purpose** and when to use it;
- **Inputs** it needs and where they live;
- **Steps**, each with the exact commands and what to look at in their output;
- **Decision points** with the rule for each choice;
- **Outputs** and where they go;
- **Verification**: the commands/checks that prove the step is done, and the
  paired verification skill where one exists;
- **Failure handling**: what each common diagnostic means and what to do.

A top-level SOP, **build-a-project**, takes an agent from a brief to a
release and delegates to the extensions' SOPs in order: brief and
requirements → sourcing → part research/author/verify (by tier) → system
composition → boards (circuit capability) → enclosures and structures (cad
capability) → harnesses and harness CAD → checks and fault scenarios →
firmware configuration → documents → Manufacturing Package → release.

## 5. Evals

`protoboard evals` runs eval cases that each extension ships in `evals/`:

- **Case:** a fixture project state, an instruction for the agent, the tools
  allowed, a time/turn budget, and graders.
- **Graders:** deterministic first (check/build results, files present and
  well-formed, digests, facts against reference values, seeded fault caught),
  rubric graders for documents (an LLM judge with a written rubric).
- **Runner:** an agent-host adapter (Claude Code headless first; the
  interface is agent-agnostic), one isolated copy of the fixture per trial,
  repeated trials, scorecards (JSON + summary), and a CI hook.
- **Suites:** every extension, plus end-to-end cases (a small project from
  brief to package). Baseline scores are recorded and weaknesses filed.

Implemented in Stack 0.1: the case format, graders, runner, scripted and
Claude Code hosts, scorecards and the CI hook are described in the
[evals guide](../guides/evals.md). The first suites have 15 cases, at least one per extension (ext-zephyr and ext-esp-idf included),
system composition, circuit generation, release, and an end-to-end case from
a brief to a Manufacturing Package; the Claude Code baseline of every case,
three trials each with the rubric judge, is recorded in `docs/evals/` and
summarised in the guide.

## 6. Clarifications from the implementation

Sections 1–3 are implemented by `@protoboardai/ext-release` (its
[README](../../packages/ext-release/README.md) has the details) with the
`protoboard release` command in the CLI. Building them settled these points.

- **Units.** `release.units` entries are instance paths (that instance) or
  module ids (every instance of the module: one unit built once per
  instance). A unit folder is named by the entry, with `/` as `.`. A unit
  named by path may not sit inside one build of a module unit built several
  times. The order of work builds nested units first and the root last.
- **Stale means proven stale or not proven current.** A release is refused
  when a provider reports a `*_STALE` finding or its check was skipped; when a
  bound module has no recorded export, or its `out/` differs from what that
  record lists, or the export was made with another config, provider or
  (recorded since Stack 0.1) module digest; when any recorded output was edited;
  and when the git work tree has uncommitted changes outside `release/` and
  `operations/` (`--allow-dirty` records them instead).
- **Reproducible bytes.** The release date comes from `SOURCE_DATE_EPOCH` or
  the source commit, never the clock; the PDFs' print time and Chrome's
  element ids are normalised; the model bundle's artifact bases are
  project-relative. The manifest lists the fonts the PDFs were printed with.
- **Files** are copied from standard outputs only and named by module
  (`<module>.step`, `.stl`, `.dxf`; boards keep the circuit output names). A
  cable's cut list is derived from its UHD facts. The model bundle goes in
  `system/files/model/`.
- **Section contract.** `package:<section>` operations are `pure`; their
  entry gets the unit and the units, the release version, date and
  configuration, and the unit's collected files, and returns one or more
  contributions (an optional titled part, blocks, files under the unit
  folder, diagnostics; an error stops the release). The release's own
  contribution comes first in every section. A work-order contribution may
  also return `operations` (stage `configure`, e.g. ext-drone's flash and
  load), which the release's own work order numbers with its own; the
  release's entry therefore runs after the others.
- **Ordering list.** Quantities come from the instance tree, so they do not
  depend on the units. The spares rule and its defaults are in the README.
  Offers are read offline only: `protoboard parts offers` vendors the parts
  service's offers into `parts/offers.json`; sourcing evidence
  (`parts/evidence/<id>/sourcing.json`) adds dated price breaks, lifecycle and
  alternates. A bought line is quoted by the bill of materials' model
  (2026-10-07; docs/specs/bom.md §3.8): the offer chosen for the
  line in `parts/bom.json`, else the best by the bill's rules, in US
  dollars. An offer in another currency is converted with the dated rate
  table and marked (`supplier_unit_price`, `supplier_currency`, `fx_rate`,
  `fx_date`, `offer_flag`). The totals are the sum of the lines; the note
  names the currencies converted and the table's date. A release differs
  from the bill only in quantity: it adds spares.
- **Offers per MPN (2026-10-03).** Every catalog offer names the MPN it is
  for, with every price break, MOQ, stock and lead time the supplier showed,
  so a series part placed at several values is priced value by value. The
  quoted offer is, in order: one for the line's MPN (a value with none stays
  unpriced), one whose stated stock covers the order (or that does not say),
  the lowest cost of the order in dollars; an offer with no stock is quoted
  only when no offer has any. The lines are summed and then rounded to
  cents.
- **One sequence (PK3–PK5).** The work order's assembly operations, the
  assembly guide's steps and the test plan's joint checks come from one plan
  per unit (`@protoboardai/ext-docs/plan`): the doc spec's steps, then
  automatic steps, scoped to the links the unit declares. A step whose links
  fall in two units is split and says so. A board's nets are made by its
  copper, so they are never steps.
- **Figures through the release.** A contribution asks the release to render
  a figure (`SectionContext.figure`, ext-docs' renderer); it never runs
  Chrome itself. Figures render before the documents, deterministically, so
  a rebuild stays byte-identical.
- **Work order.** Operations are numbered OP 10, 20, …; each names its
  parts, tools, materials, torque, inspection point and the test id that
  follows; a kitting table says where each part comes from. Lead time,
  supplier and minimum order are "unknown" unless an offline offer or
  sourcing record states them. The circuit provider states its fab profile
  with its defaults marked (finish follows the parts: ENIG when any is
  leadless); the print and cut orders mark their assumptions (nozzle and
  layer height, the widest unsupported bridge).
- **Bench test before the steps that follow it.** The work order runs the
  unit's bench test after the assembly steps, split around any contributed
  configuration (power-up checks, configure, the checks that need firmware).
  Steps that must follow it come after: steps that fit propellers, and doc
  spec steps marked `after: "test"` (the quadcopter's battery). A final check
  then carries the functional checks. A sub-unit holding such a step is
  warned about (`REL_AFTER_TEST_IN_SUBUNIT`): it is built before the
  product's test. This is why the quadcopter's arms are not units.
- **Builds that differ.** A module unit built several times has one plan.
  Where its instances differ in what the parent sets (`spin`, `overrides`),
  a step that depends on it lists each build (the propeller's hand per
  position), the documents say the builds differ, and a difference no step
  accounts for is warned about (`REL_BUILDS_DIFFER`).
- **Test plan (basic v0.1).** Checks are ids by group: FAI (first-article
  inspection from the CAD outputs and the interfaces), JT (one per assembly
  step), BU (bring-up: power-up current-limited, rails at their design
  voltage, current against the model's `supply_budget` and a project power
  budget document, programming and boot on reachable ports, I2C scans with
  the parts' addresses, a smoke test per signal link), FN (one per
  requirement of `docs/brief.md`, root only). Pass criteria come from the
  model; tolerances are the fabrication order's. Each unit gets
  `files/test/test-record.csv` to fill in.
- **The release's baseline steps aside** in the assembly guide when another
  extension contributes to it (`SectionContext.contributors`), so the guide
  is ext-docs' illustrated one wherever ext-docs is installed.
