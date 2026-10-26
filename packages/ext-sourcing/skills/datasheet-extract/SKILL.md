---
name: datasheet-extract
description: Take values out of a datasheet with proof attached — the manufacturer's current revision saved and hashed, parsed once, a question set written from the design question, extraction for one exact ordering code with a verbatim quote and page per value (absent is a valid answer), drawing dimensions read twice by independent readers, then scripts/quote-check.ts decides deterministically what may be cited. Use whenever a pin, rating, limit, timing or dimension is about to come out of a datasheet into a part, a decision or a BOM; it is how uhd-part-research's extract step reads a PDF.
---

# Datasheet extract

The question is never "can I read this PDF". It is "can anyone check, six
months from now, that I read it right". Every value leaves the document with a
verbatim quote and a page, and ordinary code, not a model, checks that the
quote and the number are really there.

**uhd-part-research** says *what* to collect for a part (identity, pin table,
electrical, mechanical, thermal facts) and where its notes go. This skill is
*how* a value gets out of a datasheet with proof. Its output feeds the
research extract files; nothing goes from an extraction straight into a
definition, a schematic or a BOM.

File format and verdicts: [references/extraction.md](references/extraction.md).

## Purpose

Get each value a design depends on out of a datasheet with a verbatim quote
and a page, checked by code, so the part, the decision or the BOM that uses
it can be audited later. Use it whenever a pin, rating, limit, timing or
dimension is about to come out of a datasheet into a part, a decision or a
BOM. In **build-a-project** it runs in stages 2 and 3: after **part-search**
picks candidates, and as the way **uhd-part-research** reads a PDF. Its output
never goes straight into a definition: **uhd-part-research** and
**part-handoff** decide what enters UHD.

## Inputs

| Input | Where | From |
| --- | --- | --- |
| The part and its exact ordering code | `docs/sourcing/<need>.md` | **part-search** |
| The design question | the requirement in `docs/brief.md`, the neighbours | **system-compose**, **part-search** |
| The manufacturer's datasheet, current revision | saved to `parts/evidence/<id>/.research/<source-id>.pdf` | step 1 |
| `pdftotext` (poppler) | `npx protoboard doctor` shows `pdftotext` ✓ | the system package manager |
| A second, independent reader for drawing values | another agent or a person | the person running the work |

## Steps

### 1. Get the right document, on disk

- The **manufacturer's** current revision, not a distributor or aggregator
  copy (it can be a revision behind). Record the document title, revision and
  date read.
- Save the bytes before asking anything about them:
  `parts/evidence/<id>/.research/<source-id>.pdf`, and its sha256 in the
  `sources.json` row (schema in **uhd-part-research**). Never work from a URL
  or a file in Downloads.
- Committing the PDF is the project's decision. It keeps numbers checkable
  when the URL rots, but most datasheets grant no redistribution: a private
  repository may commit them (Git LFS); a public one keeps the URL and the
  sha256. `.research/` is gitignored either way (**part-handoff**).
- **Confidential or NDA datasheets:** parsing and the quote check run fully
  locally. Do not send the document to any third-party service, model API or
  hosted parser without the agreement allowing it; that decision is the
  person's, not the agent's. Put a one-line `CONFIDENTIAL.txt` naming the
  agreement in the evidence folder. Never paste one into a chat.

### 2. Parse

```sh
pdftotext -layout <source.pdf> parts/evidence/<id>/.research/<source-id>.txt
```

or let the checker do it (`--pdf`, cached as `parsed-<sha prefix>.txt`).
Pages are separated by form feeds; read the text one page at a time.
`protoboard doctor` reports whether `pdftotext` is installed. Without it, say
so: no text layer means no quote can be checked, and every value stays at
sign-off.

A structure-aware parser (for example Docling) recovers tables and cell
positions better; use it when available, but run the quote check against the
`pdftotext` text, which is what the checker reads.

**Know what the parse cannot see** (each was observed on real datasheets in a
24-document corpus run, 2026-09-22):

- **A dropped table.** One parser returned a whole one-page spec sheet as a
  single picture block with no text, while `pdftotext` read all 18 rows; another
  returned two package-dimension tables with zero rows. An `absent` on such a
  page is the parser's silence, not the datasheet's. When a value matters, or a
  page parses suspiciously empty, parse with a second parser and compare before
  trusting any `absent`.
- **Values printed only in drawings.** Package outlines, hole spacing, pitch,
  leader-line dimensions: 14 of the 24 parts lost at least one field this way.
  No text matcher will find them (step 5).
- **Scanned pages.** No text layer; OCR introduces its own errors. Never better
  than weak; a person confirms.
- **Rotated or split tables.** A pin table across pages often parses as
  unrelated fragments. Spot-check the first and last rows.

### 3. Write the question set from the design question

Start from what the design needs, not from the datasheet. "Can this regulator
hold 3.3 V at 500 mA at 85 °C" is four questions; "extract the datasheet" is a
bill. Save it as `parts/evidence/<id>/datasheet/questions.json`: a list of
`{ path, label, hint?, expect_unit? }`.

- One field per question, named the way the design names it
  (`electrical.vin_max`, not "supply stuff"). Paths are letters, digits,
  underscores and dots.
- Ask for the qualifier, not just the number: conditions, footnotes, and which
  column. A footnote saying "guaranteed by design, not tested" or "at 25 °C
  only" makes it a different fact.
- Name the pitfall in the hint: min versus typ versus max; absolute maximum
  versus recommended operating conditions; one column per variant; a value that
  exists only as a curve.
- Say which questions may correctly be `absent`. A set that implies every field
  has a value invites invention.
- Pin tables come first (the order **uhd-part-research** sets), for the exact
  package.

### 4. Extract

You are the extractor. Read the parsed text page by page and write
`parts/evidence/<id>/datasheet/extraction.json` (format in the reference):

- Every stated value carries a **verbatim quote and its page**. For a table
  value the quote is the row as printed, label through unit.
- Copy numbers and signs as printed (a P-channel part prints negative
  voltages). Never round.
- `conditions` is for measurement qualifiers only (`TA = 25 °C`,
  `IF = 1.0 A`). Where the value was found and which variant it applies to go
  in `note`.
- Record the document's own symbol for the value (`VDS`, `RθJA`) in `symbol`.
- A list answer (approval marks, supported bus speeds) is an array of verbatim
  strings, each grounded on its own, never one joined string.
- `derived` values list their inputs (`derived_from`) and the arithmetic
  (`working`).

### 5. Drawings: read twice, independently

For a dimension that exists only in a drawing:

1. Render the region at 200 dpi or more (below about 150 dpi leader-line
   dimensions stop being legible):
   `pdftoppm -r 200 -f <page> -l <page> -png <source.pdf> <out-prefix>`, then
   crop to the figure. Record the crop's path and sha256.
2. Read it off the image, not off a memory of the part. Cite it as figure
   evidence with the reading copied exactly as printed (`0.034 (0.86) DIA.`).
3. Get a **second independent reading**: a different agent or person given
   only the crop and the question, never the first answer. Each reading goes
   in `readings[]` under its own reader id. One model asked twice is one
   reading.
4. The checker reports `visual` with `readings_agree`: true only when two or
   more readers agree with the value within 0.5 %. Disagreement is never
   averaged.

| Readings | Non-critical dimension | A dimension that sets a fit, a mate or a land pattern |
| --- | --- | --- |
| two or more agree | cite, with the figure reference | sign-off by a person |
| one, or none | sign-off | sign-off |
| disagree | sign-off | sign-off |

### 6. Run the quote check

```sh
npx tsx node_modules/@protoboardai/ext-sourcing/skills/datasheet-extract/scripts/quote-check.ts \
  --extraction parts/evidence/<id>/datasheet/extraction.json \
  --pdf parts/evidence/<id>/.research/<source-id>.pdf \
  --out parts/evidence/<id>/datasheet/quote-check.json
```

(`--text <file>` instead of `--pdf` when the text is already cached.) No key,
no network, no model. Exit 5 means a field is ungrounded or malformed; exit 3
means `pdftotext` is missing and prints a payload to relay as written.

What each verdict obliges you to do:

| Verdict | Means | Do |
| --- | --- | --- |
| `grounded` | Quote on the cited page; every number of the field in the quote | May be cited: value, unit, conditions, page, quote, date |
| `visual` | Figure citation checks out (crop hash, readings) | See the table in step 5 |
| `weak` | Quote on another page, a case-only match, a number missing from the quote, readers disagree, or a figure crop that could not be hashed on this machine | Open the page yourself; fix the extraction and re-run, or send it to sign-off. Never record it as grounded |
| `ungrounded` | Quote not in the document, or no evidence | Stop. Back to the page; if it cannot be grounded, a person decides. It never enters the part silently |
| `absent` | The document does not state it | Record as absent; `TBD:` if the design needs it |
| `derived` | Computed from stated fields | Check the inputs and the arithmetic |
| `invalid` | The field breaks the format | Fix the extraction |

The check is page-level against the text layer: it proves the quote and the
number are on the page, not that they sit in the right table cell or column.
For a multi-variant table, confirm the column yourself; that is the error most
likely to reach a build. A grounded value whose quote has conditions or a
footnote marker the extraction lacks is suspect.

A model-based verifier, if the project has one, is advisory: it never
extracts, corrects or fills a value, and it never overrides the deterministic
verdict.

### 7. Where results go

- Grounded and agreed-visual facts become rows in **uhd-part-research**'s
  extract files, with `source` (the `sources.json` id) and `where` (page and
  quote, or figure reference).
- A value that decides something goes into `docs/decisions.md` with its
  citation.
- Weak, ungrounded and single-reading values go to the person reviewing the
  part, with quote and page, before the part is authored. If the part is
  authored before they are resolved, they are left out or carried as
  `assumption` traits that say so.
- A question set you have written twice belongs in a shared place in the
  workspace, not copied into a third project.

## Decision points

| Decision | Rule |
| --- | --- |
| Which document | The manufacturer's current revision; a distributor copy only to corroborate. |
| Commit the PDF | The project decides: a private repository may (Git LFS); a public one keeps the URL and the sha256. Never a confidential document. |
| A value the document does not state | `absent`, plus `TBD:` and what would resolve it if the design needs it. Never a "typical" value. |
| A value only in a drawing | Two independent readings; one that sets a fit, a mate or a land pattern always goes to a person (the table in step 5). |
| What a verdict allows | The table in step 6: only `grounded` and agreed `visual` may be cited without a person. |
| A confidential datasheet | Local parsing and checking only; any third-party service needs the agreement's permission, which a person gives. |

## Outputs

| Output | Where |
| --- | --- |
| The datasheet bytes and parsed text (gitignored) | `parts/evidence/<id>/.research/<source-id>.pdf`, `.txt`, `parsed-<sha prefix>.txt` |
| The source row with its sha256 | `parts/evidence/<id>/sources.json` |
| Questions, extraction, quote-check report, figure crops | `parts/evidence/<id>/datasheet/questions.json`, `extraction.json`, `quote-check.json`, `figures/` |
| Cited facts | the research extract files (**uhd-part-research**), `docs/decisions.md` |

## Verification

```bash
npx tsx node_modules/@protoboardai/ext-sourcing/skills/datasheet-extract/scripts/quote-check.ts --extraction parts/evidence/<id>/datasheet/extraction.json --pdf parts/evidence/<id>/.research/<source-id>.pdf   # exit 0
```

- [ ] Manufacturer document, revision and date recorded; bytes on disk; sha256 in `sources.json`.
- [ ] One exact ordering code named in the extraction.
- [ ] Parsed once; suspiciously empty pages parsed a second way before any `absent` was trusted.
- [ ] Every stated value has a verbatim quote and page; `absent` used where the document is silent.
- [ ] Drawing dimensions read by two independent readers.
- [ ] Quote check run; every weak, ungrounded and invalid field acted on.
- [ ] Nothing went from the extraction straight into a definition or BOM.
- [ ] No confidential document sent to a third party without the agreement allowing it.

**sourcing-verify** re-runs the quote check and re-reads a sample
independently.

## Failure handling

| Code or symptom | Means | Do |
| --- | --- | --- |
| quote check exit 5 | A field is `ungrounded` or `invalid` | Back to the page; fix the extraction or send the field to a person (the verdict table in step 6) |
| quote check exit 3 | `pdftotext` is missing | Relay the payload it prints as written; install poppler; until then every value stays at sign-off |
| quote check exit 1 | Bad arguments or an unreadable file | Check the paths and the extraction's JSON |
| `weak` verdict | The quote is on another page, a number is missing from it, or the readers disagree | Open the page yourself; fix and re-run, or send to sign-off |
| A page parses empty | A dropped table, a scanned page or a value only in a drawing | Parse a second way before trusting any `absent`; drawings follow step 5 |
| Different sha256 for "the same" PDF | A different document | Treat it as a new source; re-run the extraction |
| `HW_VERIFICATION_WRONG` (later, in `check`) | A fact in the part does not match its source | Re-extract the field here, then repair the part (**uhd-part-author**) |

Every other code: **system-compose** [diagnostic codes](../system-compose/references/diagnostic-codes.md).

## Hard rules

1. **Parse once, cache.** A long datasheet can fill a context window. Convert
   it to text once, keyed by the file's sha256, and ask every later question of
   the text, page by page, never the whole document at once.
2. **Deterministic code checks provenance.** A model never grades its own
   provenance; asked "are you sure?", it answers with fluency, not evidence.
3. **Never invent a number. `absent` is a complete answer.** A value the
   document does not state is `status: "absent"`, and if the design needs it,
   `TBD:` plus what would resolve it.
4. **One ordering code.** One character in the ordering code can change the
   pinout, temperature range, package and absolute maximums. Every extraction
   names the exact code; a fact for one variant is not evidence about another.
5. **Nothing here signs a gate.** A grounded value may be cited. Anything weak,
   ungrounded or read only off a drawing that sets a fit goes to a person.
