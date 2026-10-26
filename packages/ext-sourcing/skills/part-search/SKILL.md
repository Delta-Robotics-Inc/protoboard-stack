---
name: part-search
description: Find candidate purchased parts for a written requirement — look in the project, its local parts and the cloud catalog first, then search manufacturers, distributors, assembler catalogs and other-language storefronts in parallel lanes, API before web search, with every lane, candidate and near-miss recorded in docs/sourcing/<need>.md. Use when a brief or system-compose needs a part that is not already in the project or catalog; follow with datasheet-extract, supplier-compare and lifecycle-alternates, and sourcing-verify.
---

# Part search

Finding a part properly is expensive once: a datasheet read, a pin table, a
supplier sweep. After that it is free for every project that reuses the
record. So the search starts with "has this already been done" and ends with a
record the next person can trust without repeating it.

This skill finds and shortlists candidates. It does not author the part
(**part-handoff** → **uhd-part-author**) and it never buys anything.

Source reference card (what each kind of source is good for, and its traps):
[references/sources.md](references/sources.md).

## Purpose

Turn a requirement into a chosen part with a record of where else was looked
and what nearly fit. Use it when a brief or **system-compose** needs a
purchased part that the project and the cloud catalog do not already have,
when a chosen part becomes unbuyable, and when an alternate is needed. In
**build-a-project** it is stage 2, before the part tiers of stage 3.

## Inputs

| Input | Where | From |
| --- | --- | --- |
| The need and its numbers | `docs/brief.md`, the requirement mapping | **system-compose** step 1 |
| The neighbours it connects to | the system in `src/`, `npx protoboard inspect` | **system-compose** |
| Earlier searches and evidence | `docs/sourcing/*.md`, `parts/evidence/*/` | earlier runs of this skill |
| The cloud catalog | `npx protoboard parts search` (needs the parts service) | Protoboard Cloud |
| Supplier APIs and search tools available here | the user's setup; ask, never assume a key | the person |

## Steps

### 1. Write the requirement first

Before any search, write the need at the top of `docs/sourcing/<need>.md`
(`<need>` is a short kebab-case name, e.g. `buck-5v-2a`):

- the function and the interfaces it must offer (protocols, rails, connector);
- the numbers that decide it: voltage, current, accuracy, temperature range,
  size or mounting, each with its source in `docs/brief.md` or marked a target;
- the quantity per build and the build count (stock coverage is judged
  against it);
- the neighbours it connects to. A part is chosen to connect to particular
  parts; name them now, because those pairs are what the UHD checks will test.

Search with the requirement, not with a part number from a tutorial or a
reference BOM. Picking the part first and bending the system to it is the
classic selection mistake.

### 2. Look before you search

In order, and do not skip a step because the next is more interesting:

1. **This project:** definitions already in `src/`, `parts/local/` and
   `parts/catalog/`:

   ```bash
   npx protoboard inspect --format json      # definitions used, by tier
   ```

   Reusing a part costs nothing.
2. **Its evidence:** `parts/evidence/*/` and `docs/sourcing/*.md` hold earlier
   searches, datasheet extractions and near-misses.
3. **The cloud catalog:** parts published for reuse.

   ```bash
   npx protoboard parts search <words> --format json           # --protocol, --domain, --tag, --limit narrow it
   npx protoboard parts add <id>                               # vendor the one that fits (its closure, files and .uhd.ts source)
   ```

   A catalog part that is wrong for you is a local variant with its own id,
   not a second definition of the same part.
4. Only then outward (step 3).

### 3. Search outward in lanes

**API before web search.** When a supplier or data API can answer (stock,
price breaks, a parametric filter, a datasheet link), use it: it returns a
figure with a source and a timestamp. A web page is the rung below. Which APIs
are available depends on the user's setup; ask or check, never assume a key.

**Run lanes in parallel, not one query.** Catalogs are localised by market and
language, and the best part can be invisible to an English-only sweep. One
observed case: a purpose-made connector that exhaustive English distributor
searches missed surfaced only through a Chinese-language search of a Chinese
storefront, in stock and assemblable (observed 2026-09; the general point is
the reason for the lanes, not that market).

| Lane | What it answers | Notes |
| --- | --- | --- |
| Manufacturer sites | The authority: datasheets, revisions, errata, ordering codes, lifecycle | Always, whoever sells the part |
| Authorized distributors | Parametric search, stock, price breaks, MOQ, packaging, lifecycle field | Use two independent ones: one listing cannot show single-sourcing |
| The project's assembler catalog | Whether the assembler stocks and can place it, and its part tier | Only when the build uses assembly; the project names its assembler |
| Other markets and languages | Parts and terms the home market does not list | Generate native-language terms per category; the useful word is often the physical feature, not the part name |
| Marketplaces | Module and dev-board SKUs that no distributor lists | Listings rarely give an MPN; never infer one from a title |
| Mechanical suppliers | Fasteners, bearings, extrusion, shop hardware, with drawings | Usually web-only: record a dated snapshot (step 5) |
| Aggregators | Secondary distributors, after the lanes above | Often metered; use last and sparingly |

A URL the user gave wins: search that supplier first to lock the exact part
they mean, then widen.

**Say when a lane was unavailable.** If a key, a tool or a site was missing,
say so in one line in the turn it happens (what was missing, what it costs on
this search, what would fix it) and record it in the capability table. Never
degrade silently: a thin search that looks complete is worse than one that
says it is thin.

Web search tools: a semantic search tool is best for discovery when you do
not know the words; filter by its domain parameter, not `site:` in the query
text (that poisons a semantic query). Fetch known pages with the host's fetch
or a browser tool for JavaScript-walled pages. Never cite a search-result URL
or a redirector; follow it to the canonical page.

### 4. Shortlist and qualify roughly

For each plausible candidate, read enough to keep or drop it: the
manufacturer's product page, the ordering table, the headline ratings. Drop
it, with one line why, if it fails a hard requirement or a disqualifier
(**lifecycle-alternates** step 2). Do the full datasheet read only for the
two or three survivors (**datasheet-extract**).

**Keep the near-misses.** A part that almost fit is the cheapest alternate you
will ever find. It stays in the table with the reason it lost.

### 5. Record

`docs/sourcing/<need>.md`:

```markdown
# <need>: <one-line function>

Requirement: … (sources: docs/brief.md §…; targets marked)
Quantity: <per build> × <builds>; neighbours: <parts it connects to>

## Capability
| Source / tool | Available | Used | Note |
| --- | --- | --- | --- |
| Manufacturer sites (web) | yes | yes | |
| Distributor A API (parametric) | no | no | no key in this environment |
| … | | | |

## Candidates
| Manufacturer | Ordering code | Status | Why / why not | Source (URL, date read) |
| --- | --- | --- | --- | --- |
| … | … | chosen / shortlisted / near-miss / rejected | … | … |

## Not checked
- <lanes or facts not looked at, and why> ("I did not look at X" is not "I found nothing at X")
```

Rules for the record:

- Every URL carries the date it was read. A URL with no date is not evidence.
- Record enough to re-find the page without the link: supplier, ordering code,
  document title and revision. URLs change shape; part numbers do not.
- Store the canonical product URL the API or page gives, never one you built,
  and never one with a key or a session token in it. Strip tracking and
  affiliate parameters from evidence; a project's link policy applies when
  links are published, not in the record.
- A mechanical supplier part with no API gets a dated snapshot: part number,
  the dimensions relied on, material, finish, price, URL, date read. Nothing
  can re-query it later, and the page can change under you.
- Name the variant. "BME280 breakout" is a search term; the record names the
  exact board and ordering code.

### 6. Hand on

The chosen candidate gets a part id (`<manufacturer>-<product>-<variant>`,
kebab-case) and moves on to **datasheet-extract**, **supplier-compare** and
**lifecycle-alternates**, then **part-handoff**. Selecting it for the system is
an engineering decision: write it in `docs/decisions.md` with the requirement
it meets and the evidence.

## Decision points

| Decision | Rule |
| --- | --- |
| Search outward or not | Only after the project, its evidence and the catalog came up empty or wrong. |
| Catalog part close but not exact | A local variant with its own id (project-researched tier), never an edit of the catalog file. |
| Which lanes | All that apply, in parallel; the manufacturer always; two independent authorized distributors when they exist. |
| A lane is unavailable | Say so in the turn and record it in the capability table; continue with the others. |
| Drop a candidate | When it fails a hard requirement or a disqualifier; keep it as a near-miss with the reason. |
| Choose | The candidate that meets every requirement with evidence, then the disqualifiers, then cost; record it in `docs/decisions.md`. |

## Outputs

| Output | Where |
| --- | --- |
| The search record | `docs/sourcing/<need>.md` |
| The selection decision | `docs/decisions.md` |
| A vendored catalog part (when the catalog had it) | `parts/catalog/<id>.json`, `parts/catalog/<id>/`, pinned in `parts/origins.json` |

## Verification

The record has the requirement with sources, the capability table, every
candidate with status, reason, URL and date, and a "Not checked" list. Then
**sourcing-verify**, by someone who did not run the search, checks it.

## Failure handling

| Code or symptom | Means | Do |
| --- | --- | --- |
| `parts search` fails (exit 2, service unreachable) | The parts service is not running or `PROTOBOARD_CLOUD_URL` is wrong | Say so; record the catalog lane as unavailable; continue outward |
| `parts add` reports `conflict` | The id is defined locally, or pinned at another revision | Rename the local part, or update deliberately (`protoboard parts update <id> --to <rev>`) |
| `SRC_NO_CAPABILITY`, `SRC_UNVERIFIED` (later, in `check`) | The record does not say which sources were available | Fill the capability table |
| No candidate meets the requirement | The requirement or the architecture is wrong for the market | Report the best near-misses with what each misses; the person decides |
| A key or tool is missing | A lane cannot run | Say so in the turn and in the record |

Every other code: **system-compose** [diagnostic codes](../system-compose/references/diagnostic-codes.md).

## Hard rules

1. Requirement before search; neighbours named.
2. Project, evidence and catalog before going outward.
3. API before web search; lanes in parallel; every unavailable lane said and recorded.
4. Every figure dated and sourced; "typical for this class" is not a source.
5. Near-misses kept with the reason they lost.
6. No orders, carts, quotes requested, accounts created or logins used. Reading public pages and APIs only.
