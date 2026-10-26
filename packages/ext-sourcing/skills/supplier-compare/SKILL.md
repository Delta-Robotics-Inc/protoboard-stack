---
name: supplier-compare
description: Record what suppliers offer for one exact ordering code — stock, MOQ, packaging, price breaks, lead time, authorized or not, each with its URL, date and how it was read — in parts/evidence/<id>/sourcing.json, then compare offers at the needed quantity with scripts/compare.ts and let the sourcing check flag single-source and low-stock lines. Evidence only: it never places, prepares or quotes an order. Use after part-search picks a candidate, before a part is authored or a BOM is costed, and whenever price or stock is about to be quoted to someone.
---

# Supplier compare

Price and availability are observations with a date, not engineering facts.
They go in the part's sourcing record, never in its UHD definition, and they
go stale on month timescales. This skill records them so a reader can see
where each figure came from and when, and compares them at the quantity the
project actually needs.

Record format: [references/sourcing-record.md](references/sourcing-record.md).

## Purpose

Record what suppliers offer for one exact ordering code, dated and sourced,
and compare the offers at the quantity the project needs, so that price and
availability reach a BOM or a decision with their provenance. Use it when
**part-search** has picked a candidate, before a part is authored or a BOM is
costed, and whenever price or stock is about to be quoted to someone. In
**build-a-project** it is stage 2; the Manufacturing Package's ordering list
reads these records. It is evidence only: it never orders.

## Inputs

| Input | Where | From |
| --- | --- | --- |
| The chosen part and ordering code | `docs/sourcing/<need>.md` | **part-search** |
| The quantity needed | units per build × builds + spares, from the brief | **system-compose**, the person |
| The lanes where the part was found | the search record's candidates and capability table | **part-search** |
| Supplier APIs configured here | the user's setup | the person |
| The record format | [references/sourcing-record.md](references/sourcing-record.md) | this skill |

## Steps

### 1. Lock the ordering code

The record is for one exact ordering code, packaging suffix included: the
same die on reel, tray, tube or cut tape is a different orderable part and a
different assembly feeder. An offer for a sibling code (other temperature
grade, other packaging) is not evidence about this one: record it as an
alternate (**lifecycle-alternates**) or as its own record.

Set `need.quantity` from the build: units per build × builds, plus the
spares the project plans for attrition. Stock coverage is judged against it.

### 2. Read the offers

For each supplier lane that **part-search** found the part in, and at least
two independent authorized distributors when they exist:

- prefer the supplier's API (`via: "api"`) to a page read (`via: "web"`); a
  figure a person read out to you is `via: "human"` with their name in `note`;
- read stock **on the supplier's own part page or API, at the quantity you
  need**, the same day you record it. Stock figures for one part disagree
  between official data, mirrors and warehouse views (by up to 8× on one day,
  observed 2026-09-20); a mirror is a shortlist tool, not the evidence;
- record MOQ, packaging and every price break shown, with the currency;
- record lead time when stock is short; prototype availability says nothing
  about production quantities (40–52 week lead times at thousands for parts
  easy to buy in tens are on record);
- record `authorized: true` only when the supplier is a franchised
  distributor for that manufacturer (the manufacturer's distributor list says
  so); `false` for brokers and marketplaces; `null` when you could not tell;
- record the market or storefront (`market`) when you searched more than one;
- note anything the supplier attaches to the line: special handling fees,
  "not available for assembly", region restrictions.

Missing sources go in `capability` with `available: false`. Say in the turn
that coverage is partial and which source would close it.

### 3. Compare

```sh
npx tsx node_modules/@protoboardai/ext-sourcing/skills/supplier-compare/scripts/compare.ts   # [part-id ...] [--qty <n>] [--json]
```

For each record it prints the offers at the needed quantity in the order a
quote takes them: cut tape or an offer whose minimum order fits before a full
reel (a reel for fewer than a reel last: `fit: "reel-over"`, never quoted),
the project's currency (`currency` in protoboard.config.ts, default USD)
before others, then cheapest extended cost, with the price break actually reached
(an MOQ above the need raises the quantity bought), whether stated stock
covers it, how and when each figure was read, and the record's issues. An
offer for another ordering code is shown but ranked last (`mpn_matches:
false`), so a sibling code's price never reads as the cheapest offer.

`protoboard check` runs the same rules as the `sourcing` check:

| Code | Severity | Means |
| --- | --- | --- |
| `SRC_RECORD_INVALID`, `SRC_OFFER_INCOMPLETE` | error | Malformed, or a figure without supplier, MPN, URL, date or method |
| `SRC_FORBIDDEN_FIELD`, `SRC_CREDENTIAL_IN_URL` | error | An order, cart or credential field, or a key in any URL anywhere in the record (offers, lifecycle source, alternates' evidence, notes) |
| `SRC_SINGLE_SOURCE` | warning | One independent supplier only, and nobody accepted the risk. Offers marked `authorized: false` (brokers, marketplaces) do not count toward independence; `null` (not known) does |
| `SRC_LOW_STOCK` | warning | Best single-supplier stock under 10× the need, and no usable alternate named. A near-miss does not count: it lost to this part |
| `SRC_LIFECYCLE` | warning | Not active (NRND, LTB, EOL, obsolete), not accepted |
| `SRC_NO_OFFER` | warning | No offer with stock other than zero |
| `SRC_OFFER_MPN_MISMATCH` | warning | An offer for another ordering code |
| `SRC_PART_MISMATCH`, `SRC_UNKNOWN_PART` | warning | Record in the wrong folder, or for an id the project does not define |
| `SRC_RISK_ACCEPTED` | info | A disqualifier a named person accepted, with the reason |
| `SRC_STALE` | info | Newest offer older than 90 days (the extension's default, not a sourced figure) |
| `SRC_UNVERIFIED`, `SRC_NO_CAPABILITY` | info | Searched without some sources, or coverage not recorded |
| `SRC_LIFECYCLE_UNKNOWN`, `SRC_STOCK_UNKNOWN` | info | Not established yet |

The 10× coverage rule and the two-distributor rule are selection practice from
the source procedures (a part that went out of stock between design and order
cost one project a new footprint, pinout, enclosure pocket and firmware port).
They are warnings, not errors: a person may accept the risk, in writing, in
`risks[]`, with their name, the date and the reason.

### 4. Report

When price or availability reaches anyone (a summary, a BOM, a decision),
carry the date and source with it: "USD 0.41 each at 100 from <supplier>,
read 2026-09-26". A figure without its date will be believed and planned
around after it has changed.

The cheapest offer is not automatically the choice. Authorized distribution
first for anything that matters (counterfeit risk is in
**lifecycle-alternates**), stock that covers the build, then price. The
choice of supplier, if the project records one, is a decision in
`docs/decisions.md`; the record stays evidence.

## Decision points

| Decision | Rule |
| --- | --- |
| Which offers count | Offers for the exact ordering code, packaging suffix included; a sibling code is an alternate or its own record. |
| API or page | The supplier's API (`via: "api"`) before a page read (`via: "web"`); a figure read out by a person is `via: "human"` with their name. |
| `authorized` | `true` only when the manufacturer's distributor list names the supplier; `false` for brokers and marketplaces; `null` when unknown. |
| Different currencies | Quote in the project's currency (`currency`, default USD); offers in other currencies stay alternatives (flagged when one is quoted because no offer in the project's currency exists). Never convert or add across currencies. |
| Full reels | A reel-only offer (packaging says reel, sold in whole reels) is quoted only when the quantity fills a reel, and flagged; for fewer it is an alternative and the line stays unpriced until a cut-tape or small-MOQ offer is found. |
| A disqualifier (single source, low stock, lifecycle) | Name an alternate (**lifecycle-alternates**), or a named person accepts the risk in `risks[]` with the date and the reason. |
| Which offer to prefer | Authorized distribution first for anything that matters, stock that covers the build, then price. |

## Outputs

| Output | Where |
| --- | --- |
| The sourcing record | `parts/evidence/<id>/sourcing.json` |
| A supplier choice, if the project records one | `docs/decisions.md` |

## Verification

```bash
npx tsx node_modules/@protoboardai/ext-sourcing/skills/supplier-compare/scripts/compare.ts <id> --json
npx protoboard check --severity info --format json         # the sourcing check: no SRC_* error; every warning fixed or accepted
```

- [ ] One exact ordering code, packaging suffix included.
- [ ] `need.quantity` from the build, spares included.
- [ ] Two independent authorized distributors read where they exist; other lanes as found.
- [ ] Every offer has supplier, MPN, canonical URL, date and method; stock read on the supplier's own page or API.
- [ ] Missing sources recorded in `capability` and said out loud.
- [ ] `compare.ts` and `protoboard check` reviewed; every warning fixed or accepted by a named person.
- [ ] No order, cart, account, login or credential anywhere.

Then **sourcing-verify** re-reads the offers that decide the choice.

## Failure handling

| Code | Means | Do |
| --- | --- | --- |
| `SRC_RECORD_INVALID`, `SRC_OFFER_INCOMPLETE` | Malformed record, or a figure without its provenance | Fix the record against the reference |
| `SRC_FORBIDDEN_FIELD`, `SRC_CREDENTIAL_IN_URL` | An order or credential field, or a key in a URL | Remove it; store the public product URL |
| `SRC_SINGLE_SOURCE`, `SRC_LOW_STOCK`, `SRC_LIFECYCLE` | A disqualifier nobody accepted | Read another supplier, name an alternate, or record a named acceptance |
| `SRC_NO_OFFER`, `SRC_OFFER_MPN_MISMATCH` | No usable offer for this code | Read more suppliers; record a sibling code as an alternate |
| `SRC_STALE` | Offers older than 90 days | Re-read before quoting anything |
| `SRC_PART_MISMATCH`, `SRC_UNKNOWN_PART` | The record is in the wrong folder or for an unknown id | Move or rename it |

The full table with severities is in step 3. Every other code:
**system-compose** [diagnostic codes](../system-compose/references/diagnostic-codes.md).

## Hard rules

This skill never does any of these:

- Place an order, add to a cart, start a checkout, request a quote that commits
  anyone, create a supplier account or log in to one. Reading public pages and
  supplier APIs the user has configured is the whole job.
- Write a key, token, session or cookie into any file. If a supplier API takes
  its key as a URL parameter, the URL you store is the public product URL,
  never the request URL. The `sourcing` check rejects records with order or
  credential fields and URLs with key-like parameters.
- Convert currencies. Offers in different currencies are compared within each
  currency; a person decides across them.
