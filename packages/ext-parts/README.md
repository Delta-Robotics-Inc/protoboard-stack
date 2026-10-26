# @protoboardai/ext-parts

Purchased parts as datasheet-honest UHD definitions: research and cite the
sources, author the `ModuleDef`, verify it automatically and by an
independent audit, record the verification. Moved out of UHD, where
the skills and `scripts/verify-part.ts` / `record-verification.ts` were
written for UHD's part library; they now work on both layouts that hold
purchased parts.

| Layout | Definition | Evidence (`sources.json`, `verification.json`, `.research/`) | Artifacts |
| --- | --- | --- | --- |
| Project (project-researched tier) | `parts/local/<id>.uhd.ts`, or wherever the project's `sources` declare it | `parts/evidence/<id>/` | `parts/local/<id>/` |
| Part library (protoboard-cloud `library/`) | `library/parts/<id>.ts` | `library/parts/<id>/` | `library/parts/<id>/artifacts/` |

A root with `protoboard.config.ts` is a project; one with
`library/parts/index.ts` is a library (`lib/layout.ts`).

| Kind | Id | What |
| --- | --- | --- |
| Skill | `uhd-authoring` | UHD's schema reference (shipped by `@deltarobotics/uhd`, declared here) |
| Skill | `uhd-part-research` | Identity, sources with sha256, CAD and the terms of every download, per-domain extracts |
| Skill | `uhd-part-author` | The definition and its CAD, per layout; verified by `uhd-part-verify` |
| Skill | `uhd-part-verify` | Automated checks, independent audit, acceptance, verification record |
| Operation | `part-verify` (pure) | The automated checks on a local part, with pair DRC against `mate` parts |
| Operation | `part-verification` (export) | Writes `parts/evidence/<id>/verification.json` from `.research/` |
| Script | `scripts/verify-part.ts <id> [--mate <id>[,<id>…]]… [--all] [--refetch] [--no-typecheck] [--json] [--root <dir>]` | The same checks plus the root's typecheck, in a project or a library; `--all` pairs with every part, `--refetch` re-downloads the pinned sources |
| Script | `scripts/record-verification.ts <id> (--independent \| --self-audit) [--auditor "<who>"] [--method "<how>"] [--repairs "<text>"] [--root <dir>]` | The same record, in either layout; it says who audited and whether that was independent |
| Audit helper | `scripts/audit/eagle_brd.py <board.brd> [--element RE] [--nets] [--json]` | An Eagle board's outline, mounting holes, pads (placed as Eagle places them) and nets |
| Audit helper | `scripts/audit/step_measure.py <file.step> [--axis z] [--section z=1.5] [--solids] [--json]` | A STEP's envelope, hole and shaft axes, and plane sections (CAD Python) |

```sh
# in a project
npx protoboard run part-verify --input part=<id> --input mate=<other-id>
npx protoboard run part-verification --input part=<id>

# in the part library (protoboard-cloud root)
npx tsx ../protoboard-stack/packages/ext-parts/scripts/verify-part.ts <id> --root .
```

The checks (`lib/verify.ts`, `lib/cad-checks.ts`, `lib/categories.ts`):
metadata, categories (known taxonomy paths, and a warning when the part's
tags, interfaces or kit manifests point at a category it does not list, so
that every category that fits is listed), citations
(header, `sources.json`, artifact URLs), structure, parameters, vocabulary
(builders plus every peer part's protocols; unknown types are errors unless
`.research/gaps.json` records them), connectors, pin designators, artifact
files (every `filePath` exists), CAD (a
body, bindings against the manifest, frames, holes and shafts on the CAD's
axes, vendor CAD licence), file terms (`lib/terms.ts`), hygiene,
and the root's typecheck (`lib/typecheck.ts`), the free-text lint
(`lib/lint.ts`: vendor-CAD wording on generated geometry, generator
references that are not the part's) and, on request, the live re-fetch of
pinned sources (`lib/refetch.ts`).

The verification record (`lib/record.ts`) says whether the audit was
independent, who ran it and how; `record-verification` refuses to write a
record whose independence nobody states. A self-audit is recorded as one,
and a project's `evidence` check reports it (`HW_VERIFICATION_SELF_AUDIT`).

The audit helpers in `scripts/audit/` are the shared tools for reading
manufacturer board files and measuring STEP models in research and in the
stage-2 audit (tested in `test/audit-helpers.test.ts`), so auditors do not
each write their own.

File terms: `terms.json` beside the part's `sources.json` (format
`protoboard.library-terms/v1`, defined by the cloud library's `src/terms.ts`)
records who may receive each file the part carries: its distribution class
(`redistributable`, `internal`, `unknown`), licence, source and retrieval
date, and links to models behind an account, a login or a click-through
licence. A manufacturer or downloaded file without an entry is an error, and
so is an entry whose `sha256` no longer matches its file. The research and
authoring skills say how to write them. `@protoboardai/ext-hardware`'s
`evidence` check reads the verification record in projects.

## Evals

`evals/author-ldo-regulator`: author a fictional ACME LDO regulator from its
datasheet text and vendor CAD, with evidence, and pass `part-verify`. Run it
with `protoboard evals --extension parts`; see the
[evals guide](../../docs/guides/evals.md).
