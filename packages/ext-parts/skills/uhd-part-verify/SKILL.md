---
name: uhd-part-verify
description: Verify a purchased part's UHD definition, in a Protoboard project or the cloud part library — automated structural, citation, vocabulary, pin, CAD and file-terms checks plus pair DRC (protoboard run part-verify, or scripts/verify-part.ts), then an independent evidence audit that re-checks facts against the cited sources. Loops with uhd-part-author (max 5 repairs), writes an acceptance report and records verification.json. Use after authoring and before the part is used in a release or published to the catalog.
---

# UHD part verify

This is the quality gate between authoring and registration. It has two
stages: automated checks, then an evidence audit by an agent that did not
author the part. `<evidence>` is `parts/evidence/<id>/` in a project and
`library/parts/<id>/` in the part library.

## Purpose

Establish that the definition is structurally sound and that its facts are
what the sources say, and record that in a committed `verification.json` the
`evidence` check reads. Use it after **uhd-part-author**, after every repair,
and before a project-researched part is published with `protoboard parts
publish`. In **build-a-project** it closes stage 3 for each project-researched
part.

## Inputs

| Input | Where | From |
| --- | --- | --- |
| The definition and its CAD | `parts/local/<id>.uhd.ts`, `parts/local/<id>/` (project); `library/parts/<id>.ts` (library) | **uhd-part-author** |
| Sources | `<evidence>/sources.json`, `.research/downloads/` | **uhd-part-research** |
| Gaps | `<evidence>/.research/gaps.json` | **uhd-part-research** |
| Mating parts for pair DRC | their ids | the research summary |
| `<ext-parts>` (library only) | this package, e.g. `../protoboard-stack/packages/ext-parts` | the stack checkout |

## Steps

### 1. Stage 1: automated checks (the author runs these)

In a project:

```bash
"${PROTOBOARD_PYTHON:-.protoboard/tools/cad/bin/python}" parts/local/<id>/<script>.py   # regenerate the part's CAD + manifest
npx protoboard run part-verify --input part=<id>             # structure, vocabulary, sources, CAD
npx protoboard run part-verify --input part=<id> --input mate=<other-id>[,<id>]   # plus pair DRC
npx protoboard check                                         # the part loads, links and rails check
npx tsc --noEmit                                             # when the project type-checks
```

In the part library (protoboard-cloud, from its root):

```bash
.venv-cad/bin/python library/cad/py/build_all.py <id>                  # regenerate the part's CAD + manifest
npx tsx <ext-parts>/scripts/verify-part.ts <id> --root .               # typecheck, structure, vocabulary, sources, CAD, text
npx tsx <ext-parts>/scripts/verify-part.ts <id> --root . --mate <a>,<b>   # plus pair DRC against each mate
npx tsx <ext-parts>/scripts/verify-part.ts <id> --root . --all         # pair DRC against every part; lists the pairs that connect
npm run typecheck && npm test                                          # the library builds and its checks pass
```

The script also works in a project (`--root` defaults to the current
directory and the layout is detected); `--json` prints the report.
`--no-typecheck` skips the typecheck; `--refetch` downloads every pinned
source again (stage 2 uses it).

The checks:

- **Typecheck:** the root's `tsc --noEmit` (its own TypeScript and
  tsconfig). A type error in the part's own files is an error: tsx runs a
  part without checking its types, so a part can load and still be wrong.
  Errors elsewhere in the root are one warning.
- **Categories:** every path is in the taxonomy (with the library's
  extension); an unknown or legacy path is an error that names the paths to
  use. When the part's tags or interfaces point at a category it does not
  list, a warning names it and why (`lib/categories.ts`): a breakout tagged
  `imu` but filed only under `expansion.breakout`, a motor with an encoder
  output and no `sensor.encoder`, an `frc` part without `robotics.frc`, a
  part tagged `ic` without `component.ic`, a drone motor or battery without
  `robotics.rc`. A pass-through part (its own `links` join its
  interfaces: a cable, an adapter, a socket breakout) is not what it carries,
  so its tags and interfaces suggest no sensor, actuator, display or storage
  category; nor do memory tags on a sensor or a microcontroller board, or an
  SSD tag on a PCIe carrier. In a library with kit manifests (`library/kits/<kit>.json`),
  a part a manifest lists must be filed under the kit, and a part filed under
  a kit must be in its manifest. The
  warning says when the part has a single category. Add the category, or
  justify leaving it out in the modelling notes.
- **Source (library):** the part ships its TypeScript to projects,
  so its file and every library module it imports pass UHD's lint for
  library source: static imports of `@deltarobotics/uhd` and library modules
  only; no `fs`, network, `process`, timers, `eval`/`Function`,
  `import.meta`, dynamic `import()`, no reflection (`Reflect`, `Proxy`,
  `prototype`, `getPrototypeOf`, `defineProperty`, a string such as
  `"constructor"`), `this` only in a class, and no local named after a host
  global (`self`, `global`, `fetch`, …). A finding is an error. `npm run
  build:library` also checks, evaluating it confined (a child process that
  reads only the closure and UHD), that the published closure gives the
  part's definition digest.
- **Identity:** it imports cleanly, so `defineModule` passed (unique ids,
  profile bindings, groups). The definition file exports a `ModuleDef` with
  the id, and metadata is complete.
- **Citation:** the file header cites sources, `sources.json` exists and is
  well formed, and every artifact URL is listed in it.
- **Structure:** every interface has a domain, `snake_case` ids, and at least
  one protocol. Every slot sets `match.protocol`, and every composed interface
  has a profile.
- **Parameters:** units are present, each has a value or a range, and every
  range is ordered.
- **Vocabulary:** protocol types are known (from the builders and the other
  parts: the library, or the project's definitions). An unknown type is an
  error unless `.research/gaps.json` records it, then a warning.
- **Traits:** part-specific trait types trigger a warning to use the
  canonical set. Assumption traits are counted in the report.
- **Hygiene:** the file contains no `TODO` or `TBD`.
- **Connectors**: every connector composite has a connector trait
  whose `positions` equals its slot count, and each position binds an
  existing, non-connector interface. A pad (an interface with a `pin`) that
  carries a multi-position connector trait is a warning: declare the socket
  with `Connector()` instead.
- **Files**: every artifact with a `filePath` (body, source,
  manifest, or an interface's own geometry file) has that file, or its
  large-file pointer `<file>.blob.json`, under the root. A missing file is
  an **error**; the message names the interfaces that bind the artifact.
- **CAD** (`lib/cad-checks.ts`; the library keeps the same checks in
  `library/cad/checks.ts` for its tests):
  - the part has a body artifact (vendor or generated);
  - `checkGeometryBindings`: every ref's artifact is on the module, every
    feature is in its manifest, and every stored signature still matches
    (a missing manifest is a warning);
  - every bolt pattern and shaft has a frame with a unit normal and an
    x-axis perpendicular to it;
  - frames are plausible against the CAD: each hole the bolt pattern's
    parameters place through the frame lands within 0.5 mm of a hole axis
    in the manifest (a slot places no holes, so there is nothing to
    compare), and a shaft frame sits on the shaft axis;
  - vendor CAD is in `sources.json` as `type: "cad"` with a sha256 and a
    `licence`; generated geometry carries a `data_gap` trait for
    "manufacturer CAD".
- **Terms** (`lib/terms.ts`): `<evidence>/terms.json` records who
  may receive each file. It is an **error** when a manufacturer or
  downloaded file has no entry: anything under a `vendor/` folder, a vendor
  STEP the definition names and every file generated from it, licence texts
  and photos. It is also an error when an entry's `distribution` is not
  `redistributable`, `internal` or `unknown`, names a preset the library
  lacks, points `licensePath` at a missing file, or pins a `sha256` the file
  no longer has (the file changed since its terms were written). A
  downloaded file's entry without `sourceUrl`, `retrieved` or `summary`, an
  entry for a file the part does not have, and (when `terms.json` exists) a
  generated file with no entry are warnings.
- **Text** (`lib/lint.ts`): the part's prose describes this part.
  A warning when a description, note, discrepancy or manifest assumption
  says the geometry comes from a vendor model ("the Adafruit STEP") but the
  part has no manufacturer CAD; and when a CAD manifest's generator
  reference names nothing of this part (a generator's default reference) or
  comes from another library part with no `assumption` trait naming it.
- **Coverage:** a part with no operating temperature draws a warning, except
  a passive mechanical part (every interface mechanical: a fastener, a
  bracket, a shaft); a part with no mechanical interface draws one, except a
  fitting mounted by a threaded `FluidPort`.
- **Mates:** `--mate` (a comma-separated list, or repeated) runs
  `validatePair` and lists each connection with its state, sub-links, and
  unresolved slots; `--all` tries every other part and lists those that form
  a connection.

Exit 0 (the operation `succeeded`) means no errors. Warnings are listed and
must be either fixed or justified in the file's modelling notes.

### 2. Stage 2: independent evidence audit

A fresh agent with no authoring context (not the author, and not a session
that repaired the part):

1. Reads the part's definition and `<evidence>/sources.json`.
2. Decides how to read the sources: the pinned downloads, or a live
   re-fetch (below), and runs `verify-part.ts <id> --refetch` to see.
3. Picks at least **12 facts**, always including the pinout or pad labels,
   supply range, current ratings, mounting pattern, dimensions or mass, and
   any protocol claims (UART numbers, I2C address, DShot support), and at
   least **3 from the free text**: a `source_discrepancy` (which source is
   really wrong, and does the trait say what each source says?), a `data_gap`
   (search the sources for the value the gap says is missing: a gap whose
   value is in a datasheet table is wrong), and a
   `usage_note` or modelling note (does the text describe this part: right
   connector, right revision, no vendor-CAD claim on generated geometry, no
   sentence copied from a sibling).
4. Checks each fact against the cited source and records
   `{ fact, claimed, found, source, verdict: "confirmed" | "wrong" | "unsupported" }`.
   A drawing or pinout that is only an image is re-read visually from the
   same image; the record says `method: "visual"`.
4. Checks for **missing** interfaces: every pad in the source's pinout should
   exist as a leaf, or be explicitly omitted in the modelling notes.
5. Checks that every `assumption` trait really is unstated in the sources and
   is reasonable.
6. Checks the CAD (at least 3 facts, counted in the 12): the mounting-hole
   positions and diameter in the manifest (`centres`, `diameter_mm`) and
   the overall size (`bbox`) against the datasheet drawing; that the
   frame normals point out of the mounting face and connector refs sit on
   the right connector; that the `licence` in `sources.json` and the terms
   in `terms.json` match what the download page, the archive's licence file
   and the site's terms say, and that nothing is marked `redistributable`
   without a licence that clearly allows it (`unknown` when the terms could
   not be found). For generated geometry, it checks the generator's
   dimensions against the drawing instead. Measure with the shared helpers,
   not with code written for the part:

   ```bash
   $PROTOBOARD_PYTHON <ext-parts>/scripts/audit/step_measure.py <file.step> --axis z --max-d 6 --json   # envelope, hole axes
   $PROTOBOARD_PYTHON <ext-parts>/scripts/audit/step_measure.py <file.step> --section y=0                # a cut through a slot or flange
   python3 <ext-parts>/scripts/audit/eagle_brd.py <board.brd> --element '^(JP|CONN)' --nets              # header nets, mounting holes, outline
   ```

It writes `.research/audit.json` and returns the failures. `audit.json` says
who audited and how, in the auditor's own words; the record copies them:

```json
{ "independent": true,
  "auditor": "stage-2 agent for batch rev-03 (did not author the part)",
  "method": "re-fetched the drawing and STEP (sha256 match), read the GitBook pages live; measured the STEP with step_measure.py",
  "facts": [ { "fact": "...", "claimed": "...", "found": "...", "source": "src_drawing", "verdict": "confirmed" } ] }
```

**Pinned downloads or a live re-fetch.** `verify-part.ts <id> --refetch`
downloads every source whose `sha256` is pinned and compares:

| Result | Read the facts from |
| --- | --- |
| `match` | The pinned copy in `.research/downloads/`: it is what the publisher serves now. |
| `page` (an HTML page differs; most do on every request) | The live page's text, for each fact the row supports; the pinned copy only shows what the author read. |
| `changed` (a file now has other bytes) | The new file: audit against it, report the change, and have the author update the row. |
| `failed` (a login wall, a bot block, a dead link) | The pinned copy, after checking its sha256 against `sources.json`; say so in `method`. |
| `unpinned` (no sha256) | A live fetch; a fact whose source cannot be fetched or matched is `unsupported`. |

Re-fetch live whatever `--refetch` says for: the terms and licence of every
download (terms pages change), a "latest revision" or product-status claim,
and any source the author added after the first audit.

### 3. Repair loop

On any error, wrong fact, or unsupported fact:

- send a structured list to **uhd-part-author** in repair mode, containing
  `{ errors[], wrongFacts[], unsupportedFacts[], missing[], preserve[] }`;
- append one line per iteration to `.research/repair-history.jsonl`;
- escalate after 5 iterations. Vocabulary gaps and genuine source conflicts
  are escalated immediately rather than looped.

### 4. Acceptance and the verification record

On pass, write `.research/acceptance.json`:

```json
{
  "partId": "<id>",
  "accepted": true,
  "iterations": 1,
  "automated": { "errors": 0, "warnings": 2 },
  "audit": { "checked": 14, "confirmed": 14, "wrong": 0, "unsupported": 0 },
  "cad": { "status": "vendor", "bindings": "0 errors", "licence": "not stated", "distribution": "unknown" },
  "mates": ["<other-id>: bldc_3phase valid"],
  "gaps": ["vocabulary: video link"],
  "checked_at": "ISO-8601"
}
```

Then write the committed `<evidence>/verification.json` from the audit and
gaps (`.research/audit.json`, `.research/gaps.json`) and the part's assumption
traits:

```bash
npx protoboard run part-verification --input part=<id> --input independent=true --input repairs="<what was fixed>"   # project
npx tsx <ext-parts>/scripts/record-verification.ts <id> --root . --independent --auditor "<who>" --repairs "<text>"     # library
```

The record says whether the audit was independent (`audit.independent`),
who ran it (`auditor`) and how (`method`, from `audit.json`); a record whose
independence nobody states is not written. `--self-audit` (or
`independent=false`) records an author's own check honestly as one: it
counts as verification, but not as the independent audit, so the migration
does not mark the part `audited` and a project's check reports
`HW_VERIFICATION_SELF_AUDIT`. Never record a self-check, or a repair
session's second pass, as independent. (`repairs` is optional; give it when
the audit led to fixes.) Report back
with the gaps, and the part is ready to use. In a project, the `evidence`
check (`@protoboardai/ext-hardware`) reads the record: a wrong fact with no
recorded repair is an error.

## Decision points

| Decision | Rule |
| --- | --- |
| A warning from stage 1 | Fix it, or justify it in the definition's modelling notes. |
| Which facts to audit | At least 12, always the pinout, supply range, current ratings, mounting pattern, dimensions or mass, protocol claims, and 3 CAD facts. |
| Loop or escalate | Loop with the author up to 5 times; escalate vocabulary gaps and genuine source conflicts at once. |
| Who audits | An agent or person that did not author or repair the part; otherwise the record is `--self-audit`. |
| Pinned copy or live re-fetch | `--refetch` first: `match` reads the pinned copy; a differing page, a changed file and every licence are read live (the table above). |
| Which free text to sample | At least 3 of the 12 facts: a discrepancy, a gap (search for its value) and a note. |
| Ready to publish | Accepted, `verification.json` recorded, `check` clean; publishing is **part-handoff** step 5 and needs a person with the token. |

## Outputs

| Output | Where |
| --- | --- |
| Audit, repair history, acceptance (gitignored) | `<evidence>/.research/audit.json`, `repair-history.jsonl`, `acceptance.json` |
| The committed verification record | `<evidence>/verification.json` |

## Verification

```bash
npx protoboard run part-verify --input part=<id>         # succeeded
npx protoboard check --severity info --format json       # no HW_VERIFICATION_WRONG; HW_NOT_VERIFIED gone for this part
```

## Failure handling

| Code or symptom | Means | Do |
| --- | --- | --- |
| `part-verify` fails: citation | Header, `sources.json` or an artifact URL missing | Add the citation (**uhd-part-author**) |
| `part-verify` fails: vocabulary | An unknown protocol type | Use an existing one, or record the gap and escalate |
| `part-verify` fails: CAD frames off the holes | A frame is more than 0.5 mm from a hole axis | Fix the frame or regenerate the CAD and copy signatures |
| `part-verify` fails: files | An artifact's `filePath` (often an interface's own GLB) names a file that is not there | Regenerate the CAD so the file is written, or drop the artifact (and the interface's ref to it) if the generator no longer exports it |
| `part-verify` fails: terms | A downloaded or vendor file has no terms entry, or its bytes changed since the entry was written | Record its terms in `terms.json` (**uhd-part-research**, step 3); for changed bytes, check the new file's terms and update `sha256` |
| `UHD_GEOMETRY_BINDING` | A signature changed since binding | Copy the new signature from the manifest after reviewing the change |
| `HW_NOT_VERIFIED` | No `verification.json` | Run stage 2 and record it |
| `HW_VERIFICATION_WRONG` | A wrong fact with no recorded repair | Repair (**uhd-part-author** repair mode), re-audit, record with `repairs` |
| `HW_VERIFICATION_REPAIRED` | Wrong facts were found and fixed | Nothing; kept for traceability |
| `HW_VERIFICATION_SELF_AUDIT` | The record is a self-audit | Run stage 2 with a different agent and record it with `--independent` |
| `record-verification` exits 2: "say who audited" | Neither `audit.json` nor a flag says whether the audit was independent | Pass `--independent` or `--self-audit` (and `--auditor`), truthfully |
| `part-verify` warns: text | Prose claims a vendor model the part does not have, or a generator reference belongs to another part | Fix the text or pass the part's own reference to the generator (**uhd-part-author**) |
| `part-verify` fails: typecheck | A type error in the part's file | Fix it; tsx runs untyped code, the catalog build does not |
| Five repair rounds without passing | The evidence or the model is contested | Escalate to a person with the repair history |

Every other code: **system-compose** [diagnostic codes](../system-compose/references/diagnostic-codes.md).
