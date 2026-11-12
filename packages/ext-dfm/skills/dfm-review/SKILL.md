---
name: dfm-review
description: Independent design-for-manufacturing review of a 3D model (part, enclosure, bracket, mount, jig, case or fixture) before it is printed, cut or machined. Measures or reads each value first (from the CAD source, a STEP or mesh measurement, or inspection, saying which), then compares it with the resolved DFM profile and the process playbook; every finding carries rule, value, limit, the limit's status, source, location and a result of OK, FAILED, NOT CHECKED or WAIVED, with the consequence and a redesign target. Advisory, never blocking. Run after dfm or dfm-3d-printing and before anything is made.
---

# DFM review

```
resolved profile + playbook ─┐
                             ├─► facts (measured or read, method stated) ─► compare ─► findings ─► report
model (source, STEP, mesh) ──┘                                               OK | FAILED | NOT CHECKED | WAIVED
```

Facts first, verdict second. The reviewer measures or reads every value
before looking at what the designer intended, then compares each fact with
the limit the profile and the playbook give. Findings advise; they never
block. The user decides what to change.

## Purpose

Catch what would fail on the machine, or fail in use, while it is still a
change to a model. Use it when a model is ready to be made (printed, cut,
machined, sent to a bureau), when a model or its process, printer or
material changed since the last review, and when **dfm** step 8 hands a part
over. Run it as an agent that did not design the part, or as a fresh pass
that measures before reading the design notes. In **build-a-project** it is
the check after **dfm** and the CAD skill (**enclosure-cad**, **frame-cad**)
and before a release or any manufacturing hand-off. It never edits the model
and never makes anything.

## Inputs

| Input | Where | From |
| --- | --- | --- |
| The model | the CAD source (a model script, an Onshape document, a UHD module's `out/body.step`), or a mesh (`.stl`, `.3mf`) | the designer; **enclosure-cad** or **frame-cad** for generated parts |
| The resolved profile, with waivers | `node node_modules/@protoboardai/ext-dfm/skills/dfm/scripts/resolve-profile.mjs --part <part folder> --format json` | **dfm** step 2 |
| The process playbook | **dfm-3d-printing**; for other processes the headline rules in [moving up the ladder](../dfm/references/moving-up-the-ladder.md) | this package |
| What the part must do, how many, and its service conditions | the session; `docs/brief.md` in a project | the user, **build-a-project** |
| Style adjustments made while designing | the designer's hand-off message or design notes | **dfm** step 4 |
| The finding format | [report format](references/report-format.md); the fill-in report [template](templates/dfm-report.md) | this skill |

## Steps

### 1. Collect the inputs and state the process

```bash
node node_modules/@protoboardai/ext-dfm/skills/dfm/scripts/resolve-profile.mjs --part <part folder> --format json
npx protoboard skills read dfm-3d-printing
```

From the resolver, read `process`, `profile.id`, `layers` (which files
applied), every value you will compare against with its `status` and
`source`, `waivers`, and `errors` (a non-empty list means the profile itself
is wrong: report it first). Write the process, printer, material and nozzle
at the top of the report. If the process is not stated anywhere, record a
FAILED finding `process.stated` and review against the FDM house defaults,
saying so.

### 2. Measure or read the facts, before any verdict

For each check in step 3, record the value as it is in the model, the place
on the part, and the method:

| Method | Use | How |
| --- | --- | --- |
| `source` | The model is a script or a parametric document | Read the dimension from the source (a parameter, a sketch constraint) |
| `step` | A STEP file of a project instance exists | `npx protoboard geometry bounds <instance>` for the envelope; `npx protoboard geometry faces <instance> --limit 200` for faces, radii and normals |
| `mesh` | Only a mesh exists, or a mesh checker is installed | A mesh measurement tool if one is available (wall thickness, overhang area, bed contact); say which tool |
| `inspection` | None of the above can reach the value | Look at the model or its views and estimate; say so, and treat the finding as weaker |

Do not compare yet. A value that none of the methods can reach is recorded
as not measured; it becomes NOT CHECKED in step 3, never OK.

### 3. Compare each fact with its limit

For every check below, compare the fact with the limit and record a finding
in the [report format](references/report-format.md): rule id, value, limit
(with its status and source), location, method and result. Rule ids and
rule reasons are in the playbook's
[FDM rules](../dfm-3d-printing/references/fdm-rules.md); when a rule has no
id there, use the profile path.

1. **Process and profile.** The process, printer, material and nozzle are
   stated; the resolver had no errors.
2. **Walls.** Thinnest standing wall and thinnest load-bearing wall against
   the profile's wall values; a wall that is not a whole number of line widths
   is noted.
3. **Overhangs and supports.** Faces steeper than the overhang limit, in the
   intended orientation; whether supports are planned or the design avoids
   them (chamfers, teardrops), per the profile's support policy.
4. **Bridges.** Longest unsupported span against the bridge limit.
5. **Holes.** Smallest hole; horizontal holes and their droop; holes printed
   to final size or meant to be drilled; compensation applied once.
6. **Orientation against load.** The main load direction against the weak
   direction between layers; snaps and clips bending in the layer plane.
7. **Bed contact.** The face on the bed, its area and edges (a bed-edge
   chamfer against the elephant's foot); tall thin parts and their footprint.
8. **Fits.** Each fit stated both per side and diametral; then the doubling
   check (step 4).
9. **Embedded hardware.** Heat-set insert holes, depths and boss walls; nut
   pockets (across flats, depth, orientation); magnet pockets (diameter,
   depth, cover layers, polarity noted); against
   [embedded hardware](../dfm-3d-printing/references/hardware.md).
10. **Small features and text.** Pins, gaps, text height, stroke, emboss and
    engrave depth against the profile's feature and text values.
11. **Material against service.** The material against the brief's heat,
    sunlight, load, moisture and chemicals, with
    [materials](../dfm-3d-printing/references/materials.md).
12. **Waivers.** Each recorded waiver still matches the model (step 5).
13. **Coupons.** Each fit or pocket whose limit is not `proven` or `user` has
    a fit-test coupon or a printed slice planned or done (step 6).
14. **DfX short list.** The six questions of the
    [DfX checklist](../dfm/references/dfx-checklist.md) short list (the full
    list when the brief says end-use).
15. **Style against limits.** Each place the designer reported a style value
    floored or changed by a limit; any style value below a limit that was not
    reported is a FAILED finding.

### 4. Check every fit for the doubling error

Clearance quoted per side (radial) applies twice across a diameter. For
each fit, write down the intended per-side clearance and the intended
diametral clearance, then compute what the model holds: hole diameter minus
pin diameter (or slot width minus tongue width). Compare:

- model difference equal to the diametral clearance: OK;
- model difference equal to the per-side value: FAILED, per-side clearance
  applied to a diameter (the fit is half as loose as meant);
- model difference equal to twice the diametral value: FAILED, a diametral
  value applied per side (the fit is twice as loose as meant);
- a sketch offset by a `.diametral` profile value, or a diameter enlarged by
  a `.side` value only once: FAILED, same error, found in the source.

Rules for clearances and their sides:
[fits and clearances](../dfm-3d-printing/references/fits-and-clearances.md).

### 5. Check the waivers

For each waiver from the resolver: the feature still exists; the measured
value is on the safe side of its `bound`; the limit has not changed since
the waiver was made. A waiver whose value moved past its bound, or whose rule
or limit changed, no longer applies: the finding is FAILED with the note
"waiver out of bound" or "waiver stale". A waiver with `decidedBy: agent` is
reported as awaiting the user's confirmation.

### 6. Check the coupons

For each fit and pocket whose limit has status `typical`, `house`, `derived`,
`assumption` or `unverified`: is a coupon or a printed slice planned or done
([design aids](../dfm/references/design-aids.md))? None planned: FAILED, with
the coupon to print named from
[test coupons](../dfm-3d-printing/references/test-coupons.md). A limit with
status `failed` used in the model is FAILED regardless.

### 7. Write the report

Copy the [template](templates/dfm-report.md) to
`docs/reviews/dfm-review-<part>-<YYYY-MM-DD>.md` in a project (beside the
model otherwise) and fill it: the header, the facts table, the findings with
consequence and a redesign hint that names a target number, the waivers, the
coupons, and the summary counts. Then tell the user the summary in a few
lines: the FAILED findings by severity, what was NOT CHECKED, and what each
change would take.

## Decision points

| Decision | Rule |
| --- | --- |
| Result of a check | OK: the measured value meets the limit. FAILED: it does not, and no valid waiver covers it. WAIVED: it does not, and a waiver covers it within its bound. NOT CHECKED: no method could reach the value; never counted as a pass. |
| Severity | From the consequence, per the [report format](references/report-format.md): `critical` when it will not print or not assemble as drawn, `major` for a likely defect or a weak part, `minor` for a margin or cosmetic issue, `info` for a note. |
| Overall summary | `clear` only when every check is OK or WAIVED; `findings` when any check is FAILED; `incomplete` when none is FAILED but any is NOT CHECKED. A review with nothing checked is `incomplete`, never `clear`. The summary advises; the user decides. |
| Two methods disagree | The more exact method wins (source and step over mesh, mesh over inspection); record both values. |
| The limit's status is weak | Compare anyway; a FAILED finding against an `unverified` or `assumption` limit says so and suggests a coupon instead of a redesign when the margin is small. |
| A user-stated value under a limit | It is a waiver with `decidedBy: user` when recorded; when not recorded, report it as FAILED with the note that the user chose it, and suggest recording the waiver. Do not argue for the default twice. |

## Outputs

| Output | Where |
| --- | --- |
| The review report | `docs/reviews/dfm-review-<part>-<YYYY-MM-DD>.md` (in a project), or beside the model |
| The summary for the user | the session |

The review writes nothing else: no model changes, no layer edits. A coupon
result or a confirmed waiver is recorded afterward by **dfm**, with the
user.

## Verification

```bash
node node_modules/@protoboardai/ext-dfm/skills/dfm/scripts/resolve-profile.mjs --part <part folder> --format json   # exit 0; errors []
npx protoboard check --format json                                                                                   # in a project: 0 errors
```

The report covers all fifteen checks of step 3, each with a result; every
OK, FAILED and WAIVED finding carries a value, a limit with its status and
source, a location and a method; every FAILED finding carries a consequence
and a redesign target; the counts in the summary match the findings.

## Failure handling

| Code or symptom | Means | Do |
| --- | --- | --- |
| No process stated | The design has no target | FAILED `process.stated`; review against the FDM house defaults and say so |
| Resolver exit 1 | The profile has errors (named paths) | Report them first; review the rest against the values that resolved |
| Resolver exit 2 or the resolver cannot run | No profile, a bad layer file, or no Node | Read the shipped `profiles/fdm.json` and the layer files by hand; say so in the header |
| No measurement method reaches a value | The fact is unknown | NOT CHECKED, with what would measure it; never OK |
| Only a mesh exists | Holes, fits and intent are hard to read | Measure what the mesh gives; mark fits and pockets NOT CHECKED unless the designer states their sizes |
| A waiver's value moved past its bound, or its limit changed | The waiver no longer applies | FAILED, "waiver out of bound" or "waiver stale" |
| A fit's model difference equals its per-side value | The doubling error | FAILED (critical when parts will not go together), with the corrected diameter |
| The design notes contradict the model | Intent and geometry disagree | Report the model's value; quote the note; the designer resolves it |
| A `failed` limit used in the model | A value known not to work on this machine | FAILED, with the alternative from the value's note |
| No playbook for the process | Headline rules only | Review against [moving up the ladder](../dfm/references/moving-up-the-ladder.md) and the vendor's guide; say the playbook is not written yet |

## Hard rules

1. Measure or read before judging; state the method of every fact.
2. NOT CHECKED is never a pass; nothing checked is not a pass.
3. Findings advise; they never block, and the review never edits the model.
4. Never order, upload, print, cut or start a machine; a coupon is printed by
   a person.
5. Cite the profile path or the playbook rule for every limit, with its
   status.
