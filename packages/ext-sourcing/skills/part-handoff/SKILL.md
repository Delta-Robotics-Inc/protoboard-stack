---
name: part-handoff
description: Hand a sourced purchased part to local UHD authoring in the project-researched tier — parts/local/<id>.uhd.ts for the definition, parts/evidence/<id>/ for sources.json, sourcing.json, the datasheet extraction and verification.json — handing it to the uhd-part-research/author/verify skills (@protoboardai/ext-parts) in the project layout, deciding which facts become UHD (identity, package name as the manufacturer states it, pins, ratings, dimensions) and which stay evidence (offers, prices, stock, supplier numbers, footprints never), then protoboard check. Use when part-search has a chosen candidate that is not in the catalog, and before system-compose instantiates it.
---

# Part handoff

A purchased part that is not in the cloud catalog is authored in the project:
the *project-researched* tier (`docs/specs/tool-integrations.md` §6 in the
Protoboard Stack repository). It is an ordinary UHD module definition whose
provenance is the project's own evidence, versioned in Git, and it can later be
promoted to the catalog by publishing a revision (step 5).

The part pipeline itself is `@protoboardai/ext-parts`: **uhd-part-research** →
**uhd-part-author** ↻ **uhd-part-verify**, with UHD's **uhd-authoring**
reference. They work in the project layout below as well as in the cloud
part library. This skill says what the sourcing skills add and where their
records go.

## Purpose

Move a sourced part into the project-researched tier with its evidence in the
right place, and decide which facts become UHD and which stay evidence. Use
it when **part-search** has a chosen candidate that is not in the cloud
catalog (`protoboard parts search` did not find the exact variant), and
before **system-compose** instantiates it. In **build-a-project** it opens
stage 3 for project-researched parts; the part pipeline itself is
`@protoboardai/ext-parts`.

## Inputs

| Input | Where | From |
| --- | --- | --- |
| The chosen part, its id and the search record | `docs/sourcing/<need>.md`, `docs/decisions.md` | **part-search** |
| Datasheet extractions | `parts/evidence/<id>/datasheet/` | **datasheet-extract** |
| Offers, lifecycle, alternates | `parts/evidence/<id>/sourcing.json` | **supplier-compare**, **lifecycle-alternates** |
| The sourcing audit | `parts/evidence/<id>/.research/sourcing-audit.json` (`result: accepted`) | **sourcing-verify** |
| The project config | `protoboard.config.ts` (`sources`, `extensions`) | `protoboard init` |

## Steps

### 1. Project layout

```
parts/
  local/<id>.uhd.ts            the ModuleDef (uhd-part-author)
  evidence/<id>/
    sources.json               every source: datasheet, pages, CAD (uhd-part-research schema)
    sourcing.json              offers, lifecycle, alternates, accepted risks (supplier-compare, lifecycle-alternates)
    datasheet/                 questions.json, extraction.json, quote-check.json, figures/ (datasheet-extract)
    verification.json          the verification record (uhd-part-verify)
    .research/                 working memory: downloads, parsed text, notes, audit (gitignored)
docs/sourcing/<need>.md        the search that chose it (part-search)
```

| In the part library | In a project |
| --- | --- |
| `library/parts/<id>.ts` | `parts/local/<id>.uhd.ts` (an exported `ModuleDef`) |
| `library/parts/<id>/sources.json` | `parts/evidence/<id>/sources.json` |
| `library/parts/<id>/verification.json` | `parts/evidence/<id>/verification.json` |
| `library/parts/<id>/.research/` | `parts/evidence/<id>/.research/` |
| `library/parts/<id>/artifacts/` | `parts/local/<id>/` next to the definition |
| `verify-part.ts <id> --root .`, `record-verification.ts <id>` | `protoboard run part-verify --input part=<id>`, `protoboard run part-verification --input part=<id>` (or the same scripts, `--root` the project) |

Once per project:

- `protoboard.config.ts` `sources` must include the local parts:
  `sources: ["src/**/*.uhd.ts", "parts/local/**/*.uhd.ts"]`. Without it the
  definition is never loaded and the instance reports an unresolved definition.
- `.gitignore` gets `parts/evidence/*/.research/`.
- `extensions` lists `@protoboardai/ext-parts` (the part skills and the
  `part-verify` / `part-verification` operations), `@protoboardai/ext-hardware`
  (the `evidence` check) and `@protoboardai/ext-sourcing` (this skill set and
  the `sourcing` check).

The id is the one **part-search** gave it: kebab-case
`<manufacturer>-<product>-<variant>`, unique across `src/`, `parts/local/` and
`parts/catalog/`. A local variant of a catalog part gets its own id; the
catalog file is never edited.

### 2. What becomes UHD, and what stays evidence

UHD holds facts that are true of the hardware whatever tool or supplier is
used. The test: could someone with only the UHD file use this fact without
running any tool or asking any supplier?

| Into the definition | Stays in `parts/evidence/<id>/` |
| --- | --- |
| `manufacturer`, `part_number` (the exact ordering code) | Supplier names, supplier SKUs, URLs of offers |
| Interfaces, protocols, ratings and rails from the datasheet | Prices, price breaks, stock, MOQ, lead time |
| Pin designators (`pin`, e.g. `42` or `"A7"`) on leaf interfaces, for the exact package | Lifecycle observations, PCNs, accepted risks |
| Package name as the manufacturer states it ("QFN-48 6×6 mm"), body dimensions, mass, material | Alternates and near-misses |
| Mounting patterns, frames, connector positions | The datasheet extraction and quote-check reports |
| `artifacts` referencing the datasheet URL and CAD files, with provenance | Search records, capability tables |
| `assumption` traits for what no source states | |

**Never in UHD:** footprint or land-pattern names, symbol or library
references, layer stacks, routing, CAD feature trees or document ids, or any
field named after a tool. A vendor footprint or symbol download is a source row
(`type: "cad"`, with its licence) for the `circuit` provider to use; the
mapping from package to footprint is that provider's table, never the part's.

Facts enter the definition only at the level the evidence supports
(**datasheet-extract** step 6): grounded and agreed-visual facts are cited
in the file header and `sources.json`; weak, ungrounded and single-reading
values are resolved by a person first, or left out, or carried as an
`assumption` trait that says what is unknown and why.

### 3. Author and verify

1. **uhd-part-research**, with the project paths above. Use
   **datasheet-extract** for every value taken from a PDF; its grounded rows
   become the `extract-<domain>.json` facts with `source` and `where` (page and
   quote).
2. **uhd-part-author** writes `parts/local/<id>.uhd.ts`: citation header
   naming each `sources.json` id, builders from `@deltarobotics/uhd`, typed
   parameters, `assumption` traits. Follow a peer part in the project or the
   catalog (`parts/catalog/*.json`) for structure. Geometry follows its
   geometry section: vendor CAD when the licence allows, otherwise
   representative geometry from the drawing with a `data_gap` trait.
3. **uhd-part-verify**: stage 1 is `npx protoboard run part-verify --input
   part=<id>` and `protoboard check` in the project (step 4), plus
   `npx tsc --noEmit` when the project type-checks; stage 2, the independent
   evidence audit of at least 12 facts, runs as written.
4. Record `parts/evidence/<id>/verification.json` from the audit with
   `npx protoboard run part-verification --input part=<id> --input
   independent=true` (`false` when the authoring agent audited its own part:
   the record then says self-audit, and nothing reads it as independent).
   It has this shape:

```json
{
  "partId": "<id>",
  "recorded_at": "<ISO-8601>",
  "audit": { "method": "<how the auditor checked the sources, in its own words>", "independent": true, "auditor": "<who audited>", "checked": 14, "confirmed": 14, "wrong": 0, "unsupported": 0 },
  "repairs": "<what was fixed after the audit, or null>",
  "assumptions": ["<assumption trait subjects>"],
  "data_gaps": ["<facts no source states>"],
  "vocabulary_gaps": ["<UHD vocabulary that was missing>"]
}
```

The `evidence` check reads it: a wrong fact with no recorded repair is an
error.

### 4. Check

```sh
npx protoboard check --severity info
```

- `PB_*` and `UHD_*`: the definition loads, ids are unique, links and rails
  check. Unresolved definition usually means the `sources` glob is missing.
- `HW_NO_SOURCES`, `HW_NOT_VERIFIED`, `HW_VERIFICATION_WRONG` (`evidence`
  check): sources and verification are in place.
- `SRC_*` (`sourcing` check): the sourcing record is well formed and its
  disqualifiers are fixed or accepted (**supplier-compare** step 3).

A clean check says the model and its evidence are consistent. It does not say
the part is right for the job or available on the day of the order.

### 5. Promote to the catalog (optional)

Once the part is verified and someone with the parts service's publish token
agrees it belongs in the catalog:

```sh
npx protoboard parts publish parts/local/<id>.uhd.ts --dry-run   # the revision it would publish
PROTOBOARD_CLOUD_TOKEN=… npx protoboard parts publish parts/local/<id>.uhd.ts
```

It refuses a part with errors in `check`, without `sources.json` and
`verification.json`, or containing a part that is not itself in the catalog.
The revision carries the files the definition references, the files in
`parts/local/<id>/` and the evidence in `parts/evidence/<id>/`.
`sourcing.json` (offers, prices, stock) and `.research/` and `vendor/` files
stay in the project. The token comes from the environment and is never written
anywhere. `parts/origins.json` records the published revision under
`published`. The project keeps using its local copy; to switch to the catalog
copy, remove `parts/local/<id>.uhd.ts` and run `protoboard parts add
<id>@<revision>`.

## Decision points

| Decision | Rule |
| --- | --- |
| Catalog or local | The catalog has the exact variant: `protoboard parts add <id>`, no hand-off. Otherwise this tier. |
| Into UHD or evidence | The test in step 2: a fact true of the hardware whatever tool or supplier is used goes into the definition; offers, prices, stock, supplier numbers, footprints and tool names never do. |
| A weak or ungrounded value | Resolved by a person first, left out, or carried as an `assumption` trait that says what is unknown. |
| Publish to the catalog | Only after verification, a clean `check`, and agreement from someone with the publish token; always `--dry-run` first. |
| Use the catalog copy after publishing | Remove `parts/local/<id>.uhd.ts`, then `protoboard parts add <id>@<revision>`; until then the project keeps its local copy. |

## Outputs

| Output | Where |
| --- | --- |
| The definition | `parts/local/<id>.uhd.ts` (**uhd-part-author**) |
| Part files (CAD) | `parts/local/<id>/` |
| Evidence | `parts/evidence/<id>/`: `sources.json`, `sourcing.json`, `datasheet/`, `verification.json` (committed); `.research/` (gitignored) |
| A published catalog revision (optional) | the parts service; `parts/origins.json` records it under `published` |

## Verification

```bash
npx protoboard check --severity info --format json      # no PB_* or UHD_* errors; no HW_* or SRC_* left unexplained
npx protoboard run part-verify --input part=<id>         # succeeded
```

- [ ] `sources` includes `parts/local/**/*.uhd.ts`; `.research/` is gitignored.
- [ ] `parts/local/<id>.uhd.ts` cites every source id; no tool or supplier fields in it.
- [ ] `parts/evidence/<id>/` has `sources.json`, `sourcing.json`, the datasheet extraction with its quote check, and `verification.json`.
- [ ] Every fact in the definition is grounded, agreed-visual, signed off, or an `assumption` trait.
- [ ] The search record in `docs/sourcing/` and the selection decision in `docs/decisions.md`.
- [ ] `protoboard check`: no errors; every warning fixed or explained.

## Failure handling

| Code or symptom | Means | Do |
| --- | --- | --- |
| `PB_UNRESOLVED_DEFINITION` | The definition is not loaded | Add `parts/local/**/*.uhd.ts` to `sources`; check the id matches the file name |
| `PB_DUPLICATE_DEFINITION` | The id collides with a catalog or local part | A local variant gets its own id |
| `HW_NO_SOURCES` | No `sources.json` rows on the part | **uhd-part-research** |
| `HW_NOT_VERIFIED` | No `verification.json` | **uhd-part-verify**, then `npx protoboard run part-verification --input part=<id>` |
| `HW_VERIFICATION_WRONG` | A wrong fact with no recorded repair | **uhd-part-author** repair mode, re-verify, record the repair |
| `SRC_*` warnings | A sourcing disqualifier not fixed or accepted | **supplier-compare**, **lifecycle-alternates** |
| `parts publish` refuses | Check errors, missing `sources.json` or `verification.json`, or a child not in the catalog | Fix the reason it gives; publish children first |
| `parts publish` fails on the token | `PROTOBOARD_CLOUD_TOKEN` is not set | Only a person with the token publishes; never write it to a file |

Every other code: **system-compose** [diagnostic codes](../system-compose/references/diagnostic-codes.md).
