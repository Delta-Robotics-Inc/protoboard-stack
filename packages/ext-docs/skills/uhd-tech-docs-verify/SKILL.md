---
name: uhd-tech-docs-verify
description: Verify UHD technical documents (datasheet, assembly guide) against the live model — re-resolve every bound value, check units/format, placeholders, stand-in watermarks, images, pagination and overflow, typography, the BOM file against the model, and assembly coverage of every mate, hardware placement and wiring link (protoboard run tech-docs-verify) — then run a visual review of the page renders. Use after uhd-tech-docs builds, and before handing documents to anyone.
---

# UHD technical documents — verify

Two stages: the automated verifier, then a visual review of every page. Loop with
**uhd-tech-docs** until both pass.

## Purpose

Prove that every value in the documents is what the live model says, that
the layout is clean, and that every mate, hardware placement and wiring link
is in an assembly step. Use it after every **uhd-tech-docs** build, before
handing documents to anyone, and before a release packages them. In
**build-a-project** it closes stage 10.

## Inputs

| Input | Where | From |
| --- | --- | --- |
| Built documents | `docs/<system-id>-*.html`, `*.pdf`, `*.values.json`, `docs/<system-id>-bom.json` | **uhd-tech-docs** |
| The live model | the project | the project |
| Tools | `npx protoboard doctor`: `chrome`, `poppler` ✓ | Google Chrome, poppler |
| The visual checklist | [visual-review](references/visual-review.md) | this skill |

## Steps

### 1. Stage 1: automated

```bash
npx protoboard run tech-docs-verify                              # all documents
npx protoboard run tech-docs-verify --input only=assembly --format json
```

It loads each paginated HTML in headless Chrome, re-loads the project, and writes
`docs/.review/verify-report.json` plus fresh page PNGs (`docs/.review/<doc>/page-NN.png`, from the
PDF with pdftoppm). The run fails on any error; its record lists every finding.

| Check | Fails when |
| --- | --- |
| values | a `[data-q]` element's text differs from the query re-resolved and re-formatted with its `data-f`, or its status changed (model edited since the build: rebuild) |
| format | a numeric value lacks the space before its unit; a unit is spelled two ways (warning) |
| placeholders | visible text contains NaN, undefined, null, `[object Object]`, TODO, TBD, `{{ }}`, Infinity |
| standin | a stand-in value lacks its S marker; a chart drawn from stand-in data lacks the watermark, or a measured chart still has one; a chart names a missing test file; the legend is missing |
| images | an `<img>` is missing, fails to decode, or is blank (ink < 0.4 %, flat luminance) |
| layout | a page body overflows; a table/figure/list is wider than the body; a heading or keep-with-next block is last on a page; a table continuation has < 2 rows; PDF page count ≠ HTML pages; a PDF page is blank |
| typography | text in a font other than Kode Mono / Kode Mono Bold, fonts not loaded or not embedded, text below 5 pt, more than 16 sizes (warning), system-font fallback in the PDF (warning) |
| bom | a line of `docs/<id>-bom.json` is missing from the datasheet, the line count differs, or the file is stale against `buildBom()` of the live model |
| coverage | a mate from `assemble().mates`, a hardware placement from `assemble().hardware`, or a wiring link is in no step (steps record them in `data-mates / data-hardware / data-wiring`); a step lists hardware the model no longer places; automatic steps remain (warning) |

Fix the cause, not the symptom: a value mismatch means rebuild (or a builder computing a value
outside `values.ts`); a stale BOM means rebuild the documents; coverage gaps mean the
doc spec's step patterns miss something.

### 2. Stage 2: visual review

Open every PNG in `docs/.review/<doc>/` (an agent can read them as images; use a higher
`pdftoppm -r 110` render for detail) and walk [the checklist](references/visual-review.md).
Record findings as `{ doc, page, issue, fix }`, fix them in the builder / CSS / doc spec, rebuild,
re-verify, and look again. Do not accept a page that only passes the automated checks.

### 3. Report

Summarise: errors fixed, remaining warnings with reasons, the model gaps the documents expose
(gap markers "—", stand-in assumptions, missing torque/mass/direction data) for the model author.

## Decision points

| Decision | Rule |
| --- | --- |
| A value mismatch | Rebuild first; if it persists, a builder computes a value outside `values.ts`: move it into a query or a derivation. |
| A warning | Fix it, or state the reason in the report (a unit spelled two ways on purpose is rare). |
| A page that passes the checks but looks wrong | It fails the review; fix and rebuild. |
| Model gaps | Reported to the model author; never filled in the document. |

## Outputs

| Output | Where |
| --- | --- |
| The verifier's report | `docs/.review/verify-report.json` |
| Page renders | `docs/.review/<doc>/page-NN.png` |
| The review summary | the report back to the author (and `docs/reviews/` when the project keeps one) |

## Verification

`npx protoboard run tech-docs-verify` succeeds (exit 0, no errors in the
report), and every page PNG has been looked at with the checklist, with each
finding fixed or recorded with its reason.

## Failure handling

| Code or symptom | Means | Do |
| --- | --- | --- |
| values check fails | The model changed since the build | `npx protoboard run tech-docs`, then verify again |
| bom check fails (stale) | The BOM file is older than the model | Rebuild the documents |
| standin check fails | A watermark or S marker is missing, or a measured chart still has one | Rebuild; check the test-data file's `status` |
| coverage check fails | A mate, hardware placement or wiring link is in no step | Add it to `assembly.steps` in the doc spec |
| typography warnings: system-font fallback | A glyph Kode Mono lacks, or `assets/fonts` missing | Rebuild with `run tech-docs`; replace the glyph |
| `run` refused: tool `chrome` or `poppler` missing | No renderer | Install them, or set `$CHROME` |
| images check: blank figure | A body without CAD, or a camera that frames nothing | Check the part's artifact (`PB_ARTIFACT_UNAVAILABLE` is expected to show "not available", not blank) and the step's camera |

Every other code: **system-compose** [diagnostic codes](../system-compose/references/diagnostic-codes.md).
