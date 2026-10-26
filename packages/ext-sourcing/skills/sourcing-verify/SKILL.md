---
name: sourcing-verify
description: Independent audit of a part's sourcing evidence by an agent or person who did not gather it — re-open a sample of offers and the lifecycle source, re-run the datasheet quote check and re-read weak or drawing-only values, re-test the disqualifiers, check the search record for lanes that were never searched — and record each item as confirmed, changed, wrong or unverifiable in parts/evidence/<id>/.research/sourcing-audit.json, starting from the evidence already there. Use after part-search, datasheet-extract, supplier-compare or lifecycle-alternates, before a part is authored or a BOM is frozen.
---

# Sourcing verify

Re-asking the agent that did the work is not a review: a wrong answer comes
back the second time more polished and still wrong. Verification means
re-reading the cited source, re-running deterministic checks, or a person who
will stand behind the result.

Start from what is there. Do not re-download a datasheet that is on disk with
its sha256, or discard a near-miss the search recorded; check them.

## Purpose

Check sourcing evidence independently before anyone relies on it: re-run what
is deterministic, re-read a sample against the sources, and say what was not
looked at. Use it after **part-search**, **datasheet-extract**,
**supplier-compare** or **lifecycle-alternates**, before a part is authored
or a BOM is frozen, and before a release quotes prices or stock. In
**build-a-project** it closes stage 2. The auditor is not the agent or person
who gathered the evidence.

## Inputs

| Input | Where | From |
| --- | --- | --- |
| The search record: requirement, lanes, candidates, capability table | `docs/sourcing/<need>.md` | **part-search** |
| Offers, lifecycle, alternates, risks | `parts/evidence/<id>/sourcing.json` | **supplier-compare**, **lifecycle-alternates** |
| Sources and datasheet extraction | `parts/evidence/<id>/sources.json`, `datasheet/` | **uhd-part-research**, **datasheet-extract** |
| Check results | `npx protoboard check --format json` | the project |
| The offers compared | `npx tsx node_modules/@protoboardai/ext-sourcing/skills/supplier-compare/scripts/compare.ts <id> --json` | **supplier-compare** |

## Steps

### 1. Re-run what is deterministic

- The quote check, on the cached text or the PDF:
  `npx tsx node_modules/@protoboardai/ext-sourcing/skills/datasheet-extract/scripts/quote-check.ts --extraction … --pdf …`.
  Its verdicts must match `quote-check.json`; any difference means the
  extraction or the document changed.
- The PDF's sha256 against `sources.json`. A different hash is a different
  document, whatever the file name says.
- `protoboard check`: every `SRC_*` warning is fixed or carries an accepted
  risk with a name, a date and a reason that is actually true.

### 2. Re-read a sample against the sources

At least **8 items**, always including:

- the ordering code against the manufacturer's ordering table (suffix,
  package, temperature grade);
- the lifecycle status at the manufacturer;
- the two offers that decide the choice (stock and the price break at the
  needed quantity), re-read on the supplier's page or API;
- every `weak` field from the quote check, read on its page;
- every drawing value that sets a fit, read independently from the crop
  without looking at the recorded readings first;
- one alternate's `differences` against its datasheet.

Record each as:

```json
{ "item": "offers[0].stock", "claimed": 4210, "found": 3980, "source": "<url>", "read_at": "<ISO-8601>",
  "verdict": "confirmed | changed | wrong | unverifiable", "note": "" }
```

`changed` is for observations that moved since they were recorded (stock,
price, lead time): update the record with the new figure and date. `wrong` is
for a figure that was never right (a different ordering code, a misread
column, a sandbox API, a mirror instead of the supplier). `unverifiable` names
the access that was missing.

### 3. Coverage

- Lanes the search never ran: compare the capability table with the lanes in
  **part-search**. "Found nothing" and "did not look" are different findings.
- Are the alternates real alternates, or near-misses relabelled? Is any
  `pin-compatible` alternate presented as a drop-in?
- Are any offers from non-authorized sellers without a note on inspection?
- Did any credential, order or cart detail reach a file? (The `sourcing` check
  catches field names and URL parameters; read free-text notes yourself.)

### 4. Record and hand back

Write `parts/evidence/<id>/.research/sourcing-audit.json`:

```json
{
  "part": "<id>",
  "audited_at": "<ISO-8601>",
  "auditor": "<agent or person, not the one who gathered the evidence>",
  "checked": 9, "confirmed": 7, "changed": 1, "wrong": 1, "unverifiable": 0,
  "items": [ ],
  "coverage": ["<lanes not searched, and what that leaves open>"],
  "result": "accepted | repair | escalate"
}
```

- `wrong` items go back to the skill that produced them (**datasheet-extract**,
  **supplier-compare**, **lifecycle-alternates**) as a list, then the audit
  runs again on those items. After two rounds, or on any genuine conflict
  between sources, escalate to a person.
- `accepted` means the evidence supports authoring the part
  (**part-handoff**). It does not approve buying anything.
- Summarise the result in the part's `verification.json` `audit` when the part
  is verified (**part-handoff** step 3), so the committed record says what
  was checked.

## Decision points

| Decision | Rule |
| --- | --- |
| Who audits | An agent or person that did not gather the evidence. Re-asking the original agent is not a review. |
| `changed` or `wrong` | `changed`: an observation that moved since it was recorded (stock, price, lead time); update it with the new date. `wrong`: a figure that was never right. |
| Loop or escalate | `wrong` items go back to the skill that produced them; after two rounds, or on a genuine conflict between sources, escalate to a person. |
| Result | `accepted` when every decisive item is confirmed or changed-and-updated and coverage is stated; `repair` when items are wrong; `escalate` on conflicts. `accepted` supports authoring, never buying. |

## Outputs

| Output | Where |
| --- | --- |
| The audit | `parts/evidence/<id>/.research/sourcing-audit.json` |
| Updated observations (`changed` items) | `parts/evidence/<id>/sourcing.json` |
| The audit summary, once the part is verified | `parts/evidence/<id>/verification.json` `audit` (**part-handoff** step 3) |

## Verification

```bash
npx tsx node_modules/@protoboardai/ext-sourcing/skills/datasheet-extract/scripts/quote-check.ts --extraction parts/evidence/<id>/datasheet/extraction.json --pdf parts/evidence/<id>/.research/<source-id>.pdf   # same verdicts as quote-check.json
npx protoboard check --severity info --format json      # every SRC_* warning fixed or accepted
```

Every audit ends with what was checked, what was not, what could not be
checked and why. No coverage statement, no acceptance.

## Failure handling

| Code or symptom | Means | Do |
| --- | --- | --- |
| Quote-check verdicts differ from `quote-check.json` | The extraction or the document changed | Find which; a different sha256 is a different document |
| `SRC_RISK_ACCEPTED` with a reason that is not true | An acceptance on false grounds | Item `wrong`; back to **lifecycle-alternates** |
| `SRC_STALE` | Offers older than 90 days | Re-read them; record `changed` with the new date |
| `SRC_CREDENTIAL_IN_URL`, `SRC_FORBIDDEN_FIELD` | A credential or order detail reached a file | Remove it at once; tell the person; it is a `wrong` item |
| A source cannot be reached | Access missing (paywall, login, region) | `unverifiable`, naming the access that was missing |
| Lanes in **part-search** never run | Coverage gap | Record it in `coverage`; "found nothing" and "did not look" are different findings |

Every other code: **system-compose** [diagnostic codes](../system-compose/references/diagnostic-codes.md).
