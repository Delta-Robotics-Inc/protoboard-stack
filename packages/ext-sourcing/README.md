# @protoboardai/ext-sourcing

Protoboard extension for sourcing purchased parts: finding candidates outside
the catalog, getting facts out of datasheets with checked quotes, recording
supplier offers and lifecycle as dated evidence, naming alternates, and
handing the part to local UHD authoring (the project-researched tier,
[tool integrations](../../docs/specs/tool-integrations.md) §6).

It reads public pages and the supplier APIs a user has configured. It never
places, prepares or quotes an order, and nothing it writes holds a credential.
Supplier observations stay in `parts/evidence/`, never in UHD.

## Contents

| Kind | Id | What it does |
| --- | --- | --- |
| Skill | `part-search` | Requirement first; project, evidence and catalog before going outward; parallel lanes (manufacturer, distributors, assembler catalog, other markets and languages, marketplaces, mechanical suppliers, aggregators), API before web search; search record in `docs/sourcing/<need>.md` |
| Skill | `datasheet-extract` | Manufacturer revision on disk with its sha256; parse once; questions from the design question; one ordering code; verbatim quote and page per value, `absent` allowed; drawing values read by two independent readers; `scripts/quote-check.ts` decides what may be cited |
| Skill | `supplier-compare` | Offers in `parts/evidence/<id>/sourcing.json` (stock, MOQ, packaging, price breaks, authorized or not, each dated with its method); `scripts/compare.ts` ranks them at the needed quantity |
| Skill | `lifecycle-alternates` | Lifecycle at the manufacturer, the selection disqualifiers, alternates by relation (family variant, form-fit-function, pin-compatible, near-miss), counterfeit exposure |
| Skill | `part-handoff` | `parts/local/<id>.uhd.ts` + `parts/evidence/<id>/`; what becomes UHD and what stays evidence; the hand-off to the part skills; `protoboard check` |
| Skill | `sourcing-verify` | Independent audit: deterministic re-runs, a re-read sample, coverage, a recorded result |
| Check | `sourcing` | Every `parts/evidence/*/sourcing.json`: well formed, dated, no order or credential fields or key-bearing URLs; single-source, low-stock and lifecycle warnings unless a named person accepted the risk |
| Tool | `pdftotext` | Probed by `protoboard doctor`; the quote check's text layer |

The part pipeline itself (research, author, verify) is `@protoboardai/ext-parts`,
and the evidence check is `@protoboardai/ext-hardware`'s; install all three:

```ts
// protoboard.config.ts
sources: ["src/**/*.uhd.ts", "parts/local/**/*.uhd.ts"],
extensions: ["@protoboardai/ext-hardware", "@protoboardai/ext-parts", "@protoboardai/ext-sourcing"],
```

```sh
npx protoboard skills                       # the skills and their SKILL.md paths
npx protoboard check --severity info        # includes the sourcing check
npx tsx node_modules/@protoboardai/ext-sourcing/skills/supplier-compare/scripts/compare.ts
npx tsx node_modules/@protoboardai/ext-sourcing/skills/datasheet-extract/scripts/quote-check.ts --extraction <file> --pdf <file>
```

## What it leaves out

The skills are procedures an agent follows, not supplier integrations. The
extension has no vendor API clients, no datasheet parser beyond `pdftotext`,
and no model-based extraction or verification: those hold keys, affiliate and
quota policy, or paid third-party services, and belong in their own providers
when they are built. No supplier is a default; the project chooses its lanes.

`scripts/quote-check.ts` works on the `pdftotext` text layer at page level: it
checks that a quote is on the cited page, that the value is in the quote,
numeric equality (`3` = `3.0`), part-number guards (`AD1000`), dimension
chains, a figure crop's hash, reader independence and 0.5 % agreement. It has
no table-cell provenance, unit check or parse-quality guard. Committing the
datasheet PDFs is left to the project.

The 90-day staleness threshold for supplier observations is this extension's
default.

## Tests

`test/sourcing.test.ts` (run from the repository root with `npm test`): the
manifest loads in a fresh project; the six skills are listed by `protoboard
skills` and `doctor` and export to `.claude/skills` with their references and
scripts; every file and skill a SKILL.md names exists; no organisation's supplier,
credential or policy appears in the skills; the sourcing rules on fixture
records; `protoboard check` in a project with a handed-off local part and
faulty records; `compare.ts`; and `quote-check.ts` on a two-page fixture text,
on a generated PDF through the real `pdftotext` (skipped, and says so, when
`pdftotext` is absent), and with `pdftotext` missing. Parts, suppliers and
datasheet text in the fixtures are fictional.

## Evals

`evals/record-ldo-offers`: record a fictional regulator's offers and
lifecycle from saved supplier pages, keeping the marketplace seller
unauthorized, the bulk ordering code apart and the single-source warning
standing. Run it with `protoboard evals --extension sourcing`; see the
[evals guide](../../docs/guides/evals.md).
