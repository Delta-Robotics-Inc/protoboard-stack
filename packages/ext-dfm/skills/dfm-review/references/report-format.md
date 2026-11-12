# DFM review report format

A DFM review separates facts from verdicts. The facts table records what the
model holds and how it was found; the findings compare each fact with a
limit. The pattern follows measurement tools that keep the inspector
fact-only and leave the verdict to the reviewer, results with a third state
for what was not measured, and waivers bounded so they cannot cover a worse
value later.

## Facts

One row per measured or read value, written before any comparison.

| Field | Holds |
| --- | --- |
| `fact` | A short id, such as `wall.thinnest` or `fit.lid.difference` |
| `value`, `unit` | What the model holds |
| `location` | Where on the part: a feature name, a face index from a STEP measurement, a coordinate, or a view and description |
| `method` | `source` (read from the CAD source), `step` (measured on a STEP file, say with what), `mesh` (measured on a mesh, say with what tool), `inspection` (estimated by looking), or `not measured` |

## Findings

One row per check. Every result other than NOT CHECKED carries a value and a
limit.

| Field | Holds |
| --- | --- |
| `id` | `F1`, `F2`, ... in the order of the checks |
| `rule` | The rule id from the process playbook (for FDM, [FDM rules](../../dfm-3d-printing/references/fdm-rules.md)), or the profile path when the playbook has no id |
| `value` | The measured or intended value, with unit, from the facts table |
| `limit` | The resolved limit, with unit and the comparison (`>=`, `<=`, `=`), for example `>= 0.9 mm` |
| `limitStatus` | The limit's status from the resolved profile: `proven`, `user`, `house`, `typical`, `derived`, `assumption`, `unverified` (a `failed` value is never a limit) |
| `source` | The limit's source: a URL, "house default", "layer file", or the coupon that proved it |
| `location` | Where on the part |
| `method` | How the value was found (as in the facts table) |
| `result` | `OK`, `FAILED`, `NOT CHECKED` or `WAIVED` |
| `severity` | For a FAILED or WAIVED finding: `critical`, `major`, `minor` or `info` |
| `consequence` | For a FAILED finding: what happens if it is made as drawn |
| `hint` | For a FAILED finding: the redesign, with a target number, for example "thicken the lip to 0.9 mm (`wall.structural`)" or "print the lid fit coupon first" |
| `waiver` | For a WAIVED finding: which waiver, and its bound |

### Results

| Result | Means |
| --- | --- |
| `OK` | The value meets the limit |
| `FAILED` | The value does not meet the limit and no valid waiver covers it |
| `WAIVED` | The value does not meet the limit, and a recorded waiver covers it within its bound |
| `NOT CHECKED` | No method reached the value. Never counted as a pass; the finding says what would measure it |

### Severities

Severity describes the consequence, not an order to stop. Every finding is
advisory; the user decides.

| Severity | When |
| --- | --- |
| `critical` | It will not print, or the parts will not go together, as drawn (a fit with no clearance, a wall under one line width, a part larger than the build volume) |
| `major` | A likely defect or a weak part (an overhang past the limit with no support plan, a load across layers, an insert boss too thin, a material that softens at the service temperature) |
| `minor` | A margin or a cosmetic issue (text near the minimum, a bridge near its limit, an unchamfered bed edge) |
| `info` | Worth knowing, no change needed (a value resting on an `unverified` limit, a style adjustment made) |

### Summary

| Summary | When |
| --- | --- |
| `clear` | Every check is OK or WAIVED |
| `findings` | At least one check is FAILED |
| `incomplete` | No check is FAILED, but at least one is NOT CHECKED. A review with nothing checked is `incomplete` |

The summary line gives the counts: OK, FAILED (by severity), WAIVED, NOT
CHECKED.

## Waivers

Each waiver the resolver returned, with its check against the model:

| Field | Holds |
| --- | --- |
| `rule`, `feature` | As recorded |
| `recorded` | The waiver's value, limit and bound |
| `now` | The value measured in this review |
| `status` | `valid` (within its bound, limit unchanged), `out of bound` (the value moved past the bound), `stale` (the rule or the limit changed, or the feature is gone), `awaiting confirmation` (`decidedBy: agent`) |

## Fits

Each fit gets its own row so the doubling error is visible:

| Field | Holds |
| --- | --- |
| `fit` | The mating pair |
| `intended per side`, `intended diametral` | Both, from the design or the profile path used |
| `model difference` | Hole minus pin (or slot minus tongue), measured |
| `check` | `OK`, `per side applied to a diameter`, `diametral applied per side`, or `NOT CHECKED` |
| `limitStatus` | The clearance's status; anything but `proven` or `user` wants a coupon |

## Coupons

Each fit or pocket whose limit is not `proven` or `user`: the coupon or slice
that would prove it, and whether it is planned, done (with the result) or
missing.
