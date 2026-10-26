---
name: lifecycle-alternates
description: Establish a part's lifecycle at the manufacturer (active, NRND, last-time-buy, EOL, obsolete, with PCNs and dates), apply the selection disqualifiers (NRND, single source, stock under 10× the need, reflow rating against the assembler's profile, MOQ), and name alternates with a form-fit-function comparison — family variants, true second sources, pin-compatible parts that are not drop-ins, and the near-misses kept from the search. Records go in sourcing.json; accepted risks carry a name and a reason. Use when a part is selected, before a BOM is frozen, and whenever stock or a lifecycle notice changes.
---

# Lifecycle and alternates

A part that is right on the bench and unbuyable at the order is the most
expensive mistake in sourcing, because it surfaces when everything else
works: the redesign is a new footprint, a firmware port and repeated
validation. This skill catches it at selection time and leaves a named way out.

Results go in the part's `sourcing.json` (`lifecycle`, `alternates`, `risks`;
format in **supplier-compare** `references/sourcing-record.md`).

## Purpose

Make sure every part can still be bought when the order is placed, and leave
a named way out when it cannot. Use it when a part is selected, before a BOM
is frozen or a release is made, and whenever stock or a lifecycle notice
changes. In **build-a-project** it is stage 2, with **supplier-compare**; the
alternates it names feed the ordering list of the Manufacturing Package.

## Inputs

| Input | Where | From |
| --- | --- | --- |
| The part and its exact ordering code | `parts/evidence/<id>/sourcing.json`, `docs/sourcing/<need>.md` | **part-search**, **supplier-compare** |
| Offers and stock at the needed quantity | `sourcing.json` `offers` | **supplier-compare** |
| Near-misses from the search | `docs/sourcing/<need>.md` candidates | **part-search** |
| The assembler's capability (reflow profile, placeable packages) | the assembler's published capability page | the project's choice of assembler |
| Datasheets of alternates | `parts/evidence/<alternate>/datasheet/` | **datasheet-extract** |

## Steps

### 1. Lifecycle

- Read the status on the **manufacturer's** product page or notices first;
  it is the authority. Then the distributors' lifecycle fields as
  corroboration (they lag and disagree).
- Record `status`, the `source` URL and `as_of`:

| Status | Means |
| --- | --- |
| `active` | In production, no discontinuation notice. |
| `nrnd` | Not recommended for new designs: a countdown with no visible end. |
| `ltb` | Last-time-buy announced: note the final order and ship dates. |
| `eol` | Discontinuation announced (PCN/EOL notice); still buyable for a window. |
| `obsolete` | No longer available from the manufacturer. |
| `unknown` | Could not be established; say why in `notes`. |

- Open any product change notices (PCNs) and summarise them in `notes`.
- EOL is not obsolete. Risk is highest in the decline before any formal
  notice; it shows as lead-time spikes, stock draining across suppliers, or an
  NRND flag.
- Manufacturer longevity programmes (published 10, 15 or 20-year commitments)
  are a real selection criterion: record one when it exists, with its URL.

### 2. Disqualifiers

Check every active part, connector and any passive that is not a generic
value. Each is allowed only when no alternative exists and a named person
accepts the risk in writing (`risks[]`):

| Disqualifier | Test | Recorded as |
| --- | --- | --- |
| Lifecycle | NRND, LTB, EOL or obsolete, and an alternative exists | `SRC_LIFECYCLE` unless accepted |
| Single source | One distributor lists it (two independent listings make this checkable; a broker or marketplace listing, `authorized: false`, is not an independent source); a single-factory part is worse | `SRC_SINGLE_SOURCE` unless accepted |
| Stock | Best single-supplier stock under about 10× the need, no alternate named (a near-miss does not count) | `SRC_LOW_STOCK` unless accepted or a family variant, form-fit-function or pin-compatible alternate is named |
| MOQ and packaging | Reel-only, or an MOQ far above the build | `note` on the offer; a decision |
| Assembly | Peak reflow rating below the assembler's profile; a package or pitch the chosen assembly tier cannot place (one fine-pitch part can move a whole board to a dearer tier) | A decision with the assembler's capability page cited |
| Library default | The part came from a CAD library suggestion, a tutorial BOM or an assembler's stock list and nobody checked its lifecycle | Check it; record it like any other |

Ask two questions per line: will the manufacturer still make this in five
years, and could the project buy ten times this quantity next quarter.

### 3. Alternates

Name an alternate now for every line with low coverage, a lifecycle flag or a
single source, and for anything unique to the design (MCUs, sensors, radios).

| Relation | What it is | What it needs before use |
| --- | --- | --- |
| `family-variant` | Same family, other grade, voltage, memory or packaging | Diff the ordering tables: pinout, ratings, temperature grade |
| `form-fit-function` | Another manufacturer's part meant to do the same job | A side-by-side of pinout, footprint dimensions, ratings, timing and support circuit, each from its datasheet (**datasheet-extract**) |
| `pin-compatible` | Fits the same footprint; clones of popular MCUs are the common case | **Not a drop-in.** Pin compatible says nothing about code, timing, ADC, USB, clocks or EMI. Use only with a validation build and a written plan |
| `near-miss` | A candidate from **part-search** that almost fit | One line on why it lost; it is the cheapest alternate you will find |

`differences` is required: "none" is a claim and needs the evidence that
supports it. Claimed drop-ins are hypotheses to test; genuine functional
alternates take engineering time to establish.

Design-time hedges worth recording in `docs/decisions.md`: a standard package
and pinout that several manufacturers make, a land pattern that accepts two
parts where the package allows, and buying the unique parts as soon as the
system is settled. Do not let a fabricator or assembler choose the substitute;
an assembler's substitution is a new part and goes through this skill.

An EOL substitution is rarely one for one: an obsolete crystal with built-in
load capacitors became a crystal plus two capacitors, two footprints and a
layout change in one recorded case. Compare the whole support circuit, not
only the part.

### 4. Counterfeit exposure

Record it, because it changes which offer is acceptable:

- Prefer authorized (franchised) distribution. It is safer, not safe: genuine
  parts returned as fakes and restocked, and a manufacturer shipping
  under-specified capacitors through major distributors, are both on record.
- Material from a broker or marketplace (`authorized: false`) needs incoming
  inspection and a functional test before it is trusted; say so in the offer's
  `note`. Some fakes are cheap to detect: read a sensor's chip-ID register
  rather than trusting its marking.
- Moisture-sensitive parts: note the MSL level from the datasheet; floor life
  after opening is set by J-STD-033 for that level, not by a supplier's house
  rule.

This skill records exposure. Inspection and test of received parts are
physical operations outside it (**test-and-measure** in
`@protoboardai/ext-hardware` for planning them).

## Decision points

| Decision | Rule |
| --- | --- |
| A disqualifier is present | Allowed only when no alternative exists and a named person accepts the risk in `risks[]`, with the date and the reason. |
| Which lines need an alternate | Every line with low coverage, a lifecycle flag or a single source, and anything unique to the design (MCUs, sensors, radios). |
| Pin-compatible alternate | Never a drop-in: needs a validation build and a written plan. |
| An assembler's substitution | A new part: through this skill again. |
| A broker or marketplace offer | Acceptable only with incoming inspection and a functional test noted on the offer. |

## Outputs

| Output | Where |
| --- | --- |
| Lifecycle, alternates, accepted risks | `parts/evidence/<id>/sourcing.json` (`lifecycle`, `alternates`, `risks`) |
| Design-time hedges | `docs/decisions.md` |

## Verification

```bash
npx protoboard check --severity info --format json      # sourcing check: SRC_LIFECYCLE, SRC_SINGLE_SOURCE, SRC_LOW_STOCK fixed or accepted
```

- [ ] Lifecycle from the manufacturer, with URL and date; PCNs read.
- [ ] Every disqualifier tested; each one present is fixed or accepted by a named person with a reason.
- [ ] An alternate named for every low-coverage, flagged or single-source line, with its relation and differences.
- [ ] Pin-compatible alternates marked as needing validation, never as drop-ins.
- [ ] Near-misses from the search kept with the reason they lost.
- [ ] Counterfeit exposure noted on non-authorized offers.

Then **sourcing-verify** re-reads the lifecycle source and one alternate's
differences.

## Failure handling

| Code | Means | Do |
| --- | --- | --- |
| `SRC_LIFECYCLE` | Not active, not accepted | An alternate, or a named acceptance with the reason |
| `SRC_SINGLE_SOURCE` | One independent supplier | A second source, an alternate, or a named acceptance |
| `SRC_LOW_STOCK` | Best stock under 10× the need, no usable alternate | Name a family variant, form-fit-function or pin-compatible alternate, or accept the risk by name |
| `SRC_LIFECYCLE_UNKNOWN` | Lifecycle not established | Read the manufacturer's page; record `unknown` with why if it says nothing |
| `SRC_RISK_ACCEPTED` | A disqualifier a person accepted | Nothing; kept for traceability |

Every other code: **system-compose** [diagnostic codes](../system-compose/references/diagnostic-codes.md).
