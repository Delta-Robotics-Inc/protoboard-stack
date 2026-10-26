---
name: release
description: Cut a release of a Protoboard project with `protoboard release` — choose the package units, clear every precondition (check errors, stale generated outputs, uncommitted changes), write the Manufacturing Package (overview, per-unit spec sheet, BOM and ordering list, work order, assembly guide, test plan, manufacturing files, index.html, manifest) and inspect it. Use when a design is ready to hand to purchasing, fabrication, assembly or test, or before physical tests that must trace to an identified revision.
---

# Release

## Purpose

A release is a fixed, reproducible snapshot of the project and the
Manufacturing Package made from it: everything needed to order, make,
assemble and check the product, laid out by unit. `protoboard release`
writes it to `release/<version>/`. It never orders, uploads or prints
anything. Design: `docs/specs/release-package-and-evals.md` in the stack
repository; the package's contracts are in this extension's README.

Use it at the end of build-a-project, and again for every revision a
fabricator, assembler or tester will see.

## Inputs

| Input | Where |
| --- | --- |
| The model, parts, providers' standard outputs (`<module>/out/`) | the project |
| Operation records of every generated file | `operations/` |
| Package units, products to build, spare rules | `release` in `protoboard.config.ts`, or `release.config.ts` |
| Offers (offline only) | `parts/offers.json` (`protoboard parts offers`), `parts/evidence/<id>/sourcing.json` (ext-sourcing) |
| Version | `--version <v>`, default the root module's `version` |
| Assembly order, cameras, step notes | `docs/docspec.ts` (ext-docs); without one, steps follow the model's mates then connections |
| What the product is | `docs/product.json` (summary, features, functions, requirements): the overview's first page. Empty parts are a warning (`REL_PRODUCT_NOT_STATED`) and the page says they are not stated |
| Requirements and power budget | `docs/product.json` requirements, else the table in `docs/brief.md` (functional checks); `docs/power-budget.md` (named in bring-up) |
| Fab and print settings | each module's `circuit.config.ts` / `cad.config.ts` constraints (finish, copper, mask, material, wall) |
| Tools | Google Chrome (`$CHROME`), probed by `protoboard doctor`; Kode Mono from ext-docs; poppler (`pdftoppm`) to review pages |

## Steps

### 1. Choose the units

In `protoboard.config.ts`:

```ts
release: {
  units: ["stack", "quadcopter-5in-arm"], // instance paths or module ids
  build: 1,                                // products to build (ordering quantities × build)
},
```

An instance path makes that one instance a unit; a module id makes every
instance of it one unit built that many times. The root is always the
`system/` unit (final assembly). Everything else folds into the nearest
unit above it.

### 2. Bring generated outputs up to date

For each module with a
`circuit.config.ts`, `cad.config.ts` or `firmware.config.ts`: `npx protoboard run
<capability>:generate --module <id>` then `:export`. Re-run other
generators whose files the package carries (`npx protoboard run
betaflight-cli`). Never edit generated files.

Order matters: an enclosure is designed around the boards and parts it
holds, so re-exporting a board (or changing a part it holds) can make the
enclosure stale. After any board export, regenerate and re-export every
enclosure or cad module around it (`cad:generate`, then `cad:export`),
then run `check` again; `ENCLOSURE_*_STALE` or `REL_STALE` naming the
enclosure means this step was skipped.

After any change to UHD itself (a stack developer working on
`@deltarobotics/uhd`), rebuild its `dist` (`npm run build` in the uhd
checkout) before trusting `check` or `release`: the stack reads the built
package, not the sources, so an unbuilt change is not in the result.

### 3. Check

`npx protoboard check` must report 0 errors. Read every
warning: the manifest records them, and the reader of the package will
see them in the traceability appendix.

### 4. Commit

`git status` must be clean outside `release/` and
`operations/`.

### 5. Dry run

`npx protoboard release --check` lists every blocking
problem and writes nothing. Fix each (see Failure handling) and repeat.

### 6. Release

`npx protoboard release [--version <v>]` (`--version <v>` is this
release's version, default the root module's; `npx protoboard --version`
alone still prints the CLI's). The output lists each document with its
page count; `--format json` gives the operation
record with `data.packageDigest` and `data.manifestDigest`.

### 7. Inspect

(see Verification): render the pages and read the work
order, assembly guide and test plan of every unit as the person who will
use them, in build order: a sub-unit must not do work that final assembly
undoes or repeats (an enclosure unit ends at the printed parts with its
inserts set; O-rings, plungers and the lid are fitted where the contents go
in), and each bring-up row must be a measurement that can pass or fail on
this board (rails at their design values, the programming port the board
exports, a scan of each bus).

## Decision points

| Question | Rule |
| --- | --- |
| Which modules are units? | A module built, tested or bought as a separate sub-assembly (a flight stack, a board, an arm built four times, an enclosure). Not a single purchased part. |
| Instance path or module id? | Module id when every instance is built the same way (four arms); instance path when only that one is a separate build. A unit named by path cannot sit inside one build of a module unit built several times. |
| `--allow-dirty`? | Only for a trial package nobody will build from. The manifest lists the uncommitted files. |
| Version | A new version for every change anyone downstream will see. Rebuilding an existing version replaces its folder; that is only right when nothing changed (the manifest digests show it). |
| Spares | The defaults (mechanical hardware 10 %, at least 2; board components 5 %, at least 2) unless the build calls for more: `release.spares` by part id, tag or category. |
| A sub-assembly that holds a part fitted last (propellers, a battery)? | Not a unit: a unit is built and tested before final assembly. Leave it folded into the root, where the doc spec fits the part last. A step that fits propellers follows the bench test by itself; mark any other such step `after: "test"` in `docs/docspec.ts`. |
| A module unit whose builds differ (an arm whose motor spins CW at two positions and CCW at two)? | The documents list the variant per build where a step depends on it. On `REL_BUILDS_DIFFER` no step does: name each instance as its own unit, or keep the part out of the unit. |
| A step title that reads wrong in a unit (a doc spec step split across units) | Split the step in `docs/docspec.ts` into one per unit (by link patterns), so each unit's guide and work order get their own title. |
| The test plan misses what only the project knows how to test (a display pattern, a charge current, a sleep current) | Add `release.checks` in protoboard.config.ts: `{ unit?, group?, phase?, check, subject, how, pass, record, trace }`, with the expected value cited in `trace`. They follow the generated bring-up (or functions) of that unit; bring-up checks are numbered power-phase first, then those that need firmware. Keep process rules out of the brief's requirement sections, or they become functional checks. |
| A functional check's method is guessed from the requirement's wording ("Measure, with the instrument the value calls for") | State how each requirement is shown: `how`, `pass` and `record` on each requirement of `docs/product.json`, or a requirements table in the brief with the columns ID, Requirement, How, Pass and Record (examples/quadcopter-5in/docs/brief.md). Each FN check takes them as written. |
| `REL_PRODUCT_NOT_STATED`: the first page says "The project has not stated …" | Fill `docs/product.json` from the brief (the system-compose skill, step 1). Do not write what the brief does not say; ask the person whose product it is. |
| "unknown" supplier, lead time or MOQ on the checklist | Record offers (`protoboard parts offers`, or ext-sourcing `sourcing.json`) before ordering; never type them into the package. |
| A fab or print default is wrong for this build (finish, copper, material) | State it in the module's config constraints and regenerate; the order says which values are defaults. |

## Outputs

`release/<version>/`: `00-overview.pdf`, `index.html`, `manifest.json`
(`protoboard.release/v0`), `system/` and `units/<unit>/` with
`spec-sheet.pdf`, `bom.pdf`, `bom.csv`, `work-order.pdf`,
`assembly-guide.pdf`, `test-plan.pdf` and `files/` (boards, mechanical,
harnesses, firmware, model), and `system/ordering-list.csv`. An operation
record in `operations/` lists every file with its digest.

## Verification

1. Rebuild in a clean clone (or rerun after deleting `release/`) and compare
   `manifest.json`: the same inputs give the same bytes.
2. Open `index.html`: every unit has five sections and its files; the
   traceability page names the source commit, model digest, part revisions
   and provider outputs.
3. Read `system/ordering-list.csv`: no "no offer recorded" line you did not
   expect; included parts at order 0; custom parts as `fabricate`.
4. Page through the PDFs: no `REL_PAGE_OVERFLOW` warning in the output.
   `pdftoppm -r 60 -png release/<v>/system/work-order.pdf /tmp/wo` renders
   pages to look at; check that no heading is left alone at a page foot and
   no figure is blank.
5. Work order: the bench test (and any configuration, e.g. ext-drone's
   flash and load) comes before every operation that must follow it
   (propellers, the battery strapped on) and a final check ends the root's
   work; every operation names an inspection point and a test id that
   exists in the same unit's test plan; the kitting table covers every part
   of the unit's bill of materials; each made part has its provider's order
   details (board, cut, print, cables).
6. Assembly guide: every step has a figure where the model has CAD for its
   parts, letters on the figure match the parts strip, and the coverage
   table lists every mate and connection the unit makes.
7. Test plan: bring-up rails and addresses match the parts' datasheets; the
   functional checks cover every requirement of `docs/brief.md`. It is basic
   (v0.1): refine methods and tolerances before a qualification run.

## Failure handling

| Diagnostic | Meaning | Do |
| --- | --- | --- |
| `REL_CHECK_ERRORS` | `protoboard check` has errors | Fix them; `protoboard check` lists each with its source line. |
| `REL_STALE` (`<path> was changed after <op> wrote it`) | A generated file was edited | Re-run the operation; never edit generated files. |
| `REL_STALE` (`… is not from the last export` / `… is missing`) | `out/` differs from the last export's record | Re-run `<capability>:export --module <id>`. |
| `REL_STALE` (`<config> changed since the last export`, `<module> changed since its last export`) | The design moved on | `generate`, then `export`. |
| `REL_STALE` (`<CODE>_STALE …`) | A provider's check reports its design out of date | Do what the provider's message says. |
| `REL_STALE` on an enclosure right after a board export | The enclosure was designed around the board's previous outputs | `cad:generate`, then `cad:export` for the enclosure. |
| `REL_STALE` from a gitignored native folder (a provider's `build/`, older than its operation record) | A native build folder that git does not track is older than the record of the last export, so the check sees the design as behind | Regenerate the native design and export again (`cad:generate`, then `cad:export --module <id>`); do not edit or touch the folder by hand. |
| `check` or `release` disagrees with a UHD change you just made | The stack reads UHD's built `dist`, not its sources | `npm run build` in the uhd checkout, then run `check` again. |
| `REL_FRESHNESS_UNKNOWN` | A provider's check was skipped (tool missing) | Install the tool (`protoboard doctor`, `protoboard tools install <runtime>`). |
| `REL_NOT_EXPORTED` | A bound module has no `out/` | Run its `export`. |
| `REL_DIRTY` | Uncommitted changes | Commit, or `--allow-dirty` for a trial. |
| `REL_UNIT_INVALID` | A `release.units` entry is unknown, duplicated or ambiguous | Use an instance path from `protoboard inspect` or a module id the system uses. |
| `REL_SECTION_FAILED`, `REL_SECTION_FILE`, `DRONE_CLI_STALE`, … | An extension's section failed or refused | Read the message; `DRONE_CLI_STALE`: `protoboard run betaflight-cli`. |
| `REL_SECTION_FAILED` … `figure "…" was already rendered from another spec` | Two contributions use one figure name | A contributor's bug: report it with the extension's name. |
| A step without a figure, or a "CAD file not available" kit item | The part's body file is not in the checkout (vendor CAD not redistributed) | Expected for such parts; the step's table and actions still hold. |
| Bring-up lists no rails or no bus scan you expected | The parts state no voltage on their outputs, or no `i2c_address` | Add the facts to the part (with a source) and release again. |
| `REL_AFTER_TEST_IN_SUBUNIT` (warning) | A unit built before final assembly fits something that must follow the product's bench test (propellers) | Do not make that module a unit; the root then fits it after the test. |
| `REL_BUILDS_DIFFER` (warning) | A module unit's builds differ in what their parent sets, and no step says which build gets what | Name each instance as its own unit, or check every build by hand. |
| Operation refused: `required tool(s) unavailable: chrome` | No Chrome | Install it or set `CHROME`. |

## After the release

Physical units and test results name the release version and the unit
(test-data `conditions`: "Release", "Unit"; **test-and-measure**). A problem
found later is a change in the next version; a released folder is never
edited.
