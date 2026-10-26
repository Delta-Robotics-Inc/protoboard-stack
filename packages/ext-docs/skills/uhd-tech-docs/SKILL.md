---
name: uhd-tech-docs
description: Produce presentation-grade technical documents (datasheet, assembly guide; later wiring guide, quick start, test report) for a Protoboard project's system with @protoboardai/ext-docs (protoboard run tech-docs), every value queried from the live UHD model, figures rendered from the CAD artifacts, stand-in test data watermarked until measured data replaces it. Use when asked for a datasheet, assembly/build guide, or other printed documentation of a system; follow with uhd-tech-docs-verify.
---

# UHD technical documents

Generate HTML + PDF documents for the project's root system. The model is the only source of
values: the document is a *presentation* of queries into it. Nothing numeric is
typed into a document by hand.

```
docs/docspec.ts ──► protoboard run tech-docs ──► docs/<id>-*.html, *.pdf, *.values.json, <id>-bom.json, images/
   (presentation)      │  model: the project's root system + definitions, assemble(), wiringChecklist, checkSystem
                       │  evidence: parts/evidence/<id>/, and the evidence a catalog revision vendored into parts/catalog/<id>/
                       │  test data: docs/test-data/<test-id>.json (standin | measured)
                       ▼
               protoboard run tech-docs-verify  (skill: uhd-tech-docs-verify) + visual review of page PNGs
```

## Purpose

Produce the datasheet and the assembly guide a person reads, built from the
model so they cannot disagree with it. Use it when asked for a datasheet,
assembly or build guide or other printed documentation of a system, and
whenever the model changes after documents were built (the verifier fails on
stale values). In **build-a-project** it is stage 10; the Manufacturing
Package's spec sheet and assembly guide sections come from the same
generator (**release**). **uhd-tech-docs-verify** follows.

## Inputs

| Input | Where | From |
| --- | --- | --- |
| The system, clean | `npx protoboard check` with 0 errors | **system-compose** and the stages before |
| Placed CAD bodies | parts' body artifacts, designed modules' `out/` (`body.glb`, `board.glb`) | the providers, the parts |
| Part evidence | `parts/evidence/<id>/`, catalog evidence in `parts/catalog/<id>/` | the part skills, `parts add` |
| The product statement | `docs/product.json` (summary, features, functions, requirements; or the requirements table of `docs/brief.md`) | **system-compose** step 1. The datasheet's first page after the cover is built from it; what it leaves empty the page says is not stated. Never fill it with text the brief does not support |
| The doc spec (presentation only) | `docs/docspec.ts` (a `DocConfig`) | this SOP, step 2 |
| Test data | `docs/test-data/<test-id>.json` | stand-ins from the build; measured from **test-and-measure** |
| Tools | `npx protoboard doctor`: `chrome`, `poppler` ✓ | a Chromium-family browser, run headless with SwiftShader WebGL (Google Chrome, Chromium, Microsoft Edge or Brave, found where each platform installs them; `$CHROME` names another), poppler (`pdftoppm`, `pdfinfo`, `pdffonts`) |
| Fonts | Kode Mono (regular to bold) ships with ext-docs | nothing to install |

The project lists `@protoboardai/ext-docs` in `extensions`. three.js is a
dependency of the extension (`$PROTOBOARD_THREE_DIR` overrides it).

## Steps

### 1. Read the system

1. Read the system: the root module (children, links, mates, harnesses), the hardware and
   harness sources (`fastenerStack`), the scenarios:

   ```bash
   npx protoboard inspect --format json
   npx protoboard doctor                                           # chrome and poppler available?
   ```

2. Dump what the documents will draw on:
   `assemble(root, lookup, { root })` — placements, mates, `hardware`, routes, unrouted, issues;
   `wiringChecklist` (and sub-assemblies' links); `checkSystem`; each part's
   `verification.json` / `sources.json`.
3. Read [style-study](references/style-study.md) ("Rules we adopt") and
   [house style](references/house-style.md).
4. Note what the model **does not** say that the document type needs (torque, frame mass,
   motor direction, thermal limits...). These become gap markers in the document and a list
   for the model author — never invented values.

### 2. Write the doc spec

`docs/docspec.ts` default-exports a `DocConfig` (`import type { DocConfig } from
"@protoboardai/ext-docs"`). It holds presentation only — see [docspec reference](references/docspec.md):

- `title`, `docId`, `revision`, `root` (assembly root), `camera` (house iso direction);
- `placementHints`: placements for strapped/free parts, from model constants (e.g. the frame's
  `BATTERY_PAD`), never from typed coordinates;
- `datasheet.keyFigures` / `specGroups`: labels + value queries + format;
  `mechanicalCallouts` (`<instance>.<interface>`), `hub` (module whose pinout is tabulated; a
  board hub also gets its own architecture figure and its controller's pinout, and its rails
  join the power-rails table);
- not a multirotor: `datasheet.envelope` (the Mechanical section's rows), `heroHints: true` (parts
  held inside an enclosure on the cover), and `datasheet.performance` (`rows` of queries and bar
  `charts` with target `refs`), with the figures stated as a `performance` trait on the system
  (the watch states its battery life from its power budget);
- `assembly.steps`: ordered groups of mate ids / wiring link ids (wildcards), `place` for
  unlinked parts, camera/explode per step, authored notes (may embed `{{query|format}}`), and
  `actions` for work the model cannot generate (fitting printed bodies of a module, a fold).
  A step with nothing in a release unit (no mate, link or placed part) is left out of that
  unit's guide and work order: give a step that matters a mate (a fastener harness on the
  joint it closes) or a part it places;
- `testData.standins`: the stand-in recipe (`lib/standins/<name>.ts` in the extension).

Anything the spec leaves out still appears: the builder appends automatic steps for uncovered
mates and links, and the verifier warns so you can order them.

### 3. Values: queries, formats, markers

Every value goes through `doc.v(query, format)` and renders as
`<span class="v" data-q="…" data-f="…" data-s="status">`. The verifier re-resolves each one.
Query forms ([value-queries](references/value-queries.md)):

| Query | Example |
| --- | --- |
| `def:<moduleId>:<path>` | `def:cnhl-black-series-1100mah-6s-100c:domains[domain=mechanical].weight_g` |
| `inst:<instance path>:<path>` | `inst:stack/fc:interfaces[id=bec_5v].parameters[id=voltage].value` |
| `sys:<path>` | `sys:checks.diagnostics[rule=propulsion_current].details.totalPeak`, `sys:bom[line=3].quantity` |
| `derived:<name>` / `derived:<fn>(args)` | `derived:mass.all_up`, `derived:frameDistance(frame.motor_mount_fl,frame.motor_mount_fr)` |
| `ver:<partId>:<path>` | `ver:meps-neon-2207-v2-1950kv:audit.confirmed` |
| `test:<test-id>:<path>` | `test:hover-current:summary[id=hover_current_A].value` |

Formats (`lib/format.ts`): `d1` decimals, `s3` significant digits, `si` SI prefix,
`u=<unit>` unit override, `hex`, `pct`, `nounit`. Always value, space, unit (`22.2 V`);
ranges `3.7–13.2 V`; thousands grouped `30 342 rpm`.

Status markers (superscripts, legend auto-inserted): none = cited source or model design value;
**D** derived (formula listed in the provenance appendix); **A** the model marks it an
assumption; **S** stand-in data; **M** measured; **—** not in model (gap). Add a derivation in
`lib/derived.ts` (with its input queries) rather than computing in a builder.

### 4. Figures from the CAD

`lib/render/` renders GLB artifacts placed by `assemble()` matrices in headless
Chrome (three.js), returning a PNG plus projected anchor points; callouts, leaders and
dimensions are drawn as vector SVG over the image (`blocks.ts: callouts, dimension`).

- **Modes:** `lineart` (flat light fills + screen-space outlines from object id, depth and
  normal edges — assembly steps and drawings), `shaded` (PBR + soft outlines — covers).
- **Styles per body:** `normal` (fitted in this step), `context` (already assembled, grey),
  `accent` (hardware / interface features to find, orange), `ghost`, `hidden`;
  `accentNodes` highlights named GLB nodes (interface feature sub-shapes such as
  `motor_mount_fr`, pad groups such as `motor_2_pads`).
- **Exploded views** (`figures.ts: explode`): mates sharing a structure interface form a joint;
  every part on it (mounted modules at their mate gap, hardware at its `fastenerStack.atMm`) is
  ranked by position along the structure normal and offset by rank × distance, so the explosion
  order *is* the stacking order. Dashed accent axes run through each hole. Nested joints carry
  their parent's offset.
- **Cameras:** orthographic, fitted to the projected geometry; one house iso direction held
  across steps; top (`dir [0,0,1], up [1,0,0]`) and side views for drawings.
- Thumbnails of every part for the kit page and parts strips (`common.ts: thumbnail`).

A body whose CAD file is not in the checkout (vendor CAD whose redistribution
is not cleared, `PB_ARTIFACT_UNAVAILABLE`) is left out of the assembly
figures, shown as "CAD file not available" in the kit, never as a blank image.

### 5. Test data and graphs

Convention: `docs/test-data/<test-id>.json`, one file per test, schema
[`templates/test-data.schema.json`](templates/test-data.schema.json), guide
[test-data](references/test-data.md). `status: "standin"` files are generated from the model by
the stand-in recipe (they list `provenance.derivedFrom` queries and every `assumption`) and are
drawn with a **STAND-IN DATA — NOT MEASURED** watermark and S markers. Drop in a file with
`status: "measured"` (same id, same columns) and the next build uses it unmarked; stand-in
generation never overwrites a measured file. Charts are inline SVG (`charts.ts`: line, bar,
meter) following the style rules; a chart records `data-test` and `data-status` for the verifier.

### 6. Document types

| Type | Builder | Sections |
| --- | --- | --- |
| Datasheet | `lib/docs/datasheet.ts` | cover (shaded hero, key figures) · the product (what it is, features, functions, requirements with how each is shown, from `docs/product.json`) · overview + architecture diagram from links · specifications · mechanical (top/side drawings with dimensions, interface callouts + table with D1/D2/D3 binding) · interfaces and pinout (hub allocation pad to pad) · electrical (rails, supply budget, propulsion vs battery) · performance (maker data + test-data charts) · design checks per scenario · BOM (`docs/<id>-bom.json`) · evidence and assumptions · value provenance |
| Assembly guide | `lib/docs/assembly.ts` | cover (exploded) · before you begin (contents, tools from hardware tags, figure key, safety) · kit (thumbnails, BOM qty) · hardware (fastener stack sections to scale) · steps (parts strip with letters + ×qty, exploded figure with callouts, generated actions in stacking order, wiring tables/diagrams, torque line, model notes) · coverage appendix |
| Later | add `lib/docs/<type>.ts` + an entry in `build.ts DOC_TYPES` | **wiring guide** (from `wiringRows`/`wiringDiagram` per harness), **quick start** (key figures, battery/props steps, safety), **test report** (one page per test-data file, table + chart + conditions + provenance) |

Assembly steps are *derived*: parts = bodies the step's mates place + hardware on those mates +
wiring ends not yet introduced + cables; actions come from joints (see `jointActions`), wiring
tables from `wiringChecklist` connections (crossovers flagged), notes from harness
`usage_note`s, `operating_conditions.cooling`, mounting metadata, plus authored spec notes.

### 7. Build

```bash
npx protoboard run tech-docs                                    # stand-ins, figures, HTML, PDF, page PNGs
npx protoboard run tech-docs --input only=datasheet --input pdf=false   # fast iteration
```

Figures are cached by content hash in `docs/images/.render-cache.json`, so a
rebuild only re-renders what changed. Each run leaves an operation record
listing every file the documents use. Fonts are copied to
`docs/assets/fonts/`, git-ignored (a build output).

The builder emits a flow of blocks; `templates/flow.js` paginates them into A4 frames in the
browser (keep-with-next headings, table splitting with repeated header, cover/full pages,
page numbers, contents), then the paginated DOM is saved as the final HTML and printed to PDF
with `preferCSSPageSize`. Theme: `templates/doc.css` (light pages, dark cover, Kode Mono body,
Kode Mono Bold display, orange accent, one type scale). Glyphs the fonts lack are mapped in
`format.ts: glyphSafe`.

### 8. Finish

Run **uhd-tech-docs-verify**, fix every error, do the visual review of the page PNGs in
`docs/.review/<doc>/`, iterate. Report the model gaps the documents exposed (gap markers,
stand-in assumptions) to the model author. Keep everything local: no pushing or publishing.

## Decision points

| Decision | Rule |
| --- | --- |
| A value the document needs and the model lacks | A gap marker (**—**) and an entry on the list for the model author; never a typed value. |
| A value computed from others | A derivation in `lib/derived.ts` with its input queries (**D** marker), not arithmetic in a builder. |
| Stand-in or measured | A measured file with the stand-in's id and columns replaces it; until then the stand-in carries its watermark. |
| Step order in the assembly guide | Authored in `assembly.steps`; anything uncovered is appended automatically and must be ordered before release. |
| Fast iteration | `--input only=<doc> --input pdf=false` while iterating; a full build before verifying. |

## Outputs

| Output | Where |
| --- | --- |
| The doc spec | `docs/docspec.ts` |
| Documents (generated; never edit) | `docs/<system-id>-datasheet.{html,pdf,values.json}`, `docs/<system-id>-assembly-guide.{html,pdf,values.json}` |
| BOM used by the documents | `docs/<system-id>-bom.json` |
| Figures and render cache | `docs/images/` |
| Stand-in test data | `docs/test-data/` (stand-ins never overwrite measured files) |

## Verification

```bash
npx protoboard run tech-docs-verify      # must succeed
```

Then **uhd-tech-docs-verify**'s visual review of every page.

## Failure handling

| Code or symptom | Means | Do |
| --- | --- | --- |
| `run` refused: tool `chrome` or `poppler` missing | No Chromium-family browser or no poppler (`doctor` says which, and where it looked) | Install them, or set `$CHROME` to a browser's executable |
| Verifier warns about fonts | Kode Mono did not load from `assets/fonts` | Rebuild the documents (`run tech-docs` copies the fonts); never commit them |
| `PB_ARTIFACT_UNAVAILABLE` | A body's CAD is not in the checkout | Expected for non-redistributable vendor CAD; it is shown as not available |
| `UHD_UNPLACED` | A part nothing mates | A `placementHints` entry from a model constant, or a display placement |
| `*_STALE`, `PB_OUTPUT_NOT_EXPORTED` | Figures would show outdated CAD | Regenerate the CAD (**frame-cad**, **enclosure-cad**, **circuit-board**, **harness-cad**) before building |
| A value renders as "—" | The model does not have it | Report it to the model author; do not type it |
| Coverage warnings (automatic steps) | The doc spec's steps miss mates or links | Add them to `assembly.steps` in order |

Every other code: **system-compose** [diagnostic codes](../system-compose/references/diagnostic-codes.md).
