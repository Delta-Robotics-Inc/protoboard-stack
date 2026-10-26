# EV6 eval runs, 2026-10-03: analysis

Claude Code 2.1.288, `claude-opus-5-5`, `--host claude-code --judge claude-code --trials 3`, under the module
mirror and the guard. The runs used a clean detached checkout of the eval-harness branch, so that edits elsewhere
could not trip the guard. They used the harness from that branch: rules on the trial's absolute path, whole
files for the rubric judge, `--jobs`, `--no-skills`, and the `script` and diagnostic graders. The guard found
nothing changed outside any trial's copy, in any run.

| Run | Scorecard | Trials | Passed | Mean score | Agent cost |
| --- | --- | --- | --- | --- | --- |
| New and changed cases | [`2026-10-03-ev6-claude-code-new-and-changed.json`](2026-10-03-ev6-claude-code-new-and-changed.json) ([`.md`](2026-10-03-ev6-claude-code-new-and-changed.md)) | 15 | 15 | 1.00 | $7.52 |
| (its first run, before the datasheet rubric fix) | [`…-first-run.json`](2026-10-03-ev6-claude-code-new-and-changed-first-run.json) | 15 | 12 | 0.99 | $7.82 |
| Harder cases again, their scenarios hidden | [`2026-10-03-ev6-claude-code-harder-scenarios-hidden.json`](2026-10-03-ev6-claude-code-harder-scenarios-hidden.json) ([`.md`](2026-10-03-ev6-claude-code-harder-scenarios-hidden.md)) | 6 | 6 | 1.00 | $1.85 |
| Ablation: without the skills | [`2026-10-03-ev6-ablation-without-skills.json`](2026-10-03-ev6-ablation-without-skills.json) ([`.md`](2026-10-03-ev6-ablation-without-skills.md)) | 9 | 8 | 0.99 | $6.71 |
| Ablation control: with the skills, same harness | [`2026-10-03-ev6-ablation-with-skills.json`](2026-10-03-ev6-ablation-with-skills.json) ([`.md`](2026-10-03-ev6-ablation-with-skills.md)) | 9 | 9 | 0.99 | $7.90 |

The costs are the agents' costs. The judge's calls are not counted, in these runs or in the morning baseline. In
total the five runs cost $25.65, and one permissions probe session cost $0.14.

## New and changed cases

| Case | Change | Pass | Score | Mean time | Turns | Cost (3 trials) | Morning baseline |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `ext-hardware/find-reversed-cell-leads` | new: hidden seed | 3/3 | 1.00 | 38 s | 8 | $0.74 | — |
| `ext-hardware/fix-two-wiring-faults` | new: two faults at once | 3/3 | 1.00 | 42 s | 11 | $0.99 | — |
| `ext-hardware/compose-probe-cable` | a `script` grader on the scenarios script | 3/3 | 1.00 | 144 s | 25 | $2.34 | 3/3, 113 s, $1.88 |
| `ext-release/release-after-hand-edit` | `fixture.operations`; the solution no longer assumes a stale enclosure | 3/3 | 1.00 | 329 s | 27 | $2.07 | 3/3, 301 s, $2.31 |
| `ext-docs/build-datasheet` | the judge reads `values.json` whole; rubric fixed (below) | 3/3 | 0.99 | 80 s | 23.3 | $1.37 | 2/3, 66 s, $1.15 |

**Whole files changed the datasheet verdict, and showed a rubric defect.** In the first run, all three
datasheet trials failed the rubric (0.50 to 0.60). The judge now read the whole `values.json` and found 24 BOM
values with status `gap` and the text `—`. The uhd-tech-docs skill prescribes exactly this for a value the model
does not state ("a gap marker, never a typed value"). The rubric listed no `gap` status, so it counted the gap
markers as placeholders. With the 60 000-character cut, the morning judge never reached those entries. It marked
one trial down only because the file was cut. The rubric now allows `gap`, says that a gap marker is not a
placeholder, and judges the displayed units. The case ran again: 3/3, 0.99. The same full reading confirms three
generator defects in the `unit` metadata that the morning judge also noted: KV has unit `V`, the CRSF baud rate
has `Hz`, and the total thrust is shown in kg with unit `g`. They are ext-docs's to fix, not the agent's.

**The judge's reasons are whole now.** Every rubric result in these scorecards carries the judge's full reasons,
one paragraph per criterion. The morning scorecard cut them at 600 characters.

**The harder variants do not separate good runs from bad ones yet.** Both new cases passed 3 of 3, quickly and
cheaply. The transcripts show why:

- *Hidden seed.* `check` does not report the reversed cell leads. Every agent still found the fault in 7
  to 9 turns, from three clues that the fixture leaves in place:
  - the one extra `HARNESS_ROUTE_STALE` on `battery_leads` (the route was generated for other ends);
  - the harness's straight-through pin order (`["+", "-"]`);
  - `src/scenarios.ts`, whose `cell-leads-reversed` scenario has exactly the same compose as the seed.

  All three agents named that match in their answer. No agent took the trap of regenerating the route: the
  route's digest grader passed in every trial.
- *Two faults at once.* Both seeds are also scenarios in `src/scenarios.ts` (`o4-on-vbat`,
  `gnss-rx-tx-swapped`), and `check` names both links. Every agent fixed both faults in the designed way. No
  agent re-pointed the O4 at another rail. Every agent named both faults.

To make these cases discriminate, use a seed that no scenario describes, and a fixture that does not carry a
"before" state that matches the fault: a scenarios file without the seeded scenario, or a fault in another
domain (a strap, a passive value, a mate gap). Once the link-state check landed, the reversed leads show as `UHD_LINK_STATE`, and the
first case becomes easier, not harder. Its graders already expect that state: the fault is gone, there is no link
error on the BAT pads, and the nominal scenario is clean.

**Rerun with the scenarios hidden.** After review, both harder cases changed so that the fixture no longer
gives the seed away. A seeding step takes the matching scenarios out of the copy's `src/scenarios.ts`
(`cell-leads-reversed`; `o4-on-vbat` and `gnss-rx-tx-swapped`), and `docs/`, whose datasheets list the
scenarios, is not copied. No file in either fixture's project names the seeds now; only the system-compose
skill's own example in the module mirror still mentions `gnss-rx-tx-swapped`. The reversed-cell fault grader is
also narrowed to the battery pads (subject `/bat/`), so once the link-state check lands an unrelated `UHD_LINK_STATE` elsewhere in
the bottle cannot fail it. The two cases ran again, 3 trials each, claude-code host:

| Case | Pass | Score | Mean time | Turns | Cost (3 trials) | With the scenarios in place (above) |
| --- | --- | --- | --- | --- | --- | --- |
| `ext-hardware/find-reversed-cell-leads` | 3/3 | 1.00 | 30 s | 7.3 | $0.65 | 3/3, 38 s, 8 turns |
| `ext-hardware/fix-two-wiring-faults` | 3/3 | 1.00 | 45 s | 13.7 | $1.20 | 3/3, 42 s, 11 turns |

They still do not separate good runs from bad ones, and the transcripts now say why without the scenario
shortcut. No answer mentions a matching scenario. The agents found the reversed leads by tracing the lead end to
end (the cell end's `lead_pos`/`lead_neg`, the harness's straight-through `["+", "-"]`, the board end's compose)
and by the extra `HARNESS_ROUTE_STALE` on `battery_leads`. In the quad, `check` names both faults, and the GNSS
lead's own usage note says which way the UART crosses. So hiding the scenarios is not enough: the remaining
clues (the stale route, the pin order, check's own errors, the part's notes) are what a good engineer would use
too. A case that separates runs needs a fault that none of these show: one check does not name, whose route
is not regenerated from the faulty link, in a domain the parts' notes do not spell out (a strap, a passive
value, a mate gap). Five of the six answers again say the scenarios script was denied (the `AGENTS.md` path,
below); the `script` grader ran it and it passed.

**What blocked the agents was the documentation's script path.** The host denied 25 shell lines in the three
system cases. In 16 of them, the agent ran the scenarios script by the path in `AGENTS.md`,
`npx tsx ../../node_modules/@protoboard/ext-hardware/skills/system-compose/scripts/scenarios.ts`, alone or after
`check`, and the host's `..` rule denied it. Most of the other denied lines were inline Python edits. In two of the three two-fault trials, the
agent reported that it could not confirm the scenarios. The `script` grader ran the script for them, and it
passed. The fix for the docs belongs with the skills and docs. No trial hit the
`cd`-into-the-mirror problem: the rules on the absolute path held (probe below).

## Ablation: with and without the skills

The ablation ran three representative cases with `--no-skills`, and a control arm ran the same cases with the
skills under the same harness:

- `fix-gnss-uart-swap`: a system fault;
- `author-ldo-regulator`: part authoring, the most skill-heavy case;
- `record-ldo-offers`: sourcing records with honesty rules.

In the ablation arm, no skills were exported, the mirror left out every skill document, and the session had no
Skill tool.

| Case | Without skills: pass, score | time, turns, cost | With skills: pass, score | time, turns, cost |
| --- | --- | --- | --- | --- |
| `fix-gnss-uart-swap` | 3/3, 1.00 | 27 s, 7, $0.53 | 3/3, 1.00 | 26 s, 7.7, $0.72 |
| `author-ldo-regulator` | 2/3, 0.97 | 210 s, 45, $4.87 | 3/3, 0.98 | 266 s, 50.7, $6.13 |
| `record-ldo-offers` | 3/3, 1.00 | 68 s, 24.7, $1.32 | 3/3, 1.00 | 46 s, 20, $1.05 |
| **Total** | **8/9, 0.99** | $6.71 | **9/9, 0.99** | $7.90 |

What the skills do, from the transcripts:

- **The GNSS case does not use them.** With the skills exported, no agent called the Skill tool. The case is
  `check`, read the lead, swap two pads. The arms differ only by noise.
- **The authoring case uses them, and quality drops without them.** With the skills, every agent loaded
  uhd-part-research and uhd-part-author. Without them, the agents worked from the extension's README, the part
  API and the example parts, and one of three failed the rubric (0.50). That trial had:
  - no modelling notes in the header;
  - the assumed lead span as a free-text field, not an `assumption` trait;
  - no sha256 or licence on the CAD artifacts.

  The skill's checklist asks for each of these. Both arms passed every deterministic grader (`part-verify`, the
  facts, the sources). The difference is in the conventions the rubric checks.
- **The sourcing case is faster with them.** Every agent with the skills loaded supplier-compare and its
  `sourcing-record.md` reference. It finished in 46 s and $1.05, against 68 s and $1.32 without the skills, where
  the agents read `inputs/README.md`, the package READMEs and the compare script. Both arms recorded the offers
  honestly. The case's instruction and its inputs spell out most of the rules: keep the marketplace
  unauthorized, keep the bulk code apart, accept no risk.

The ablation says that, for these cases, the instructions, the project and the package READMEs carry most of
what an agent needs. The skills add conventions and speed: the rubric-level detail in authoring, and fewer turns
in sourcing. They do not decide pass or fail on the deterministic graders. A larger difference needs cases whose
instruction does not restate the procedure, or many more trials: one failure in nine is within run-to-run noise.
The package READMEs stay readable in the ablation arm, and they describe some of the same procedures. A stricter
arm could leave them out too.

## Harness checks made for this run

- **Rules on the absolute path.** A probe session (`claude -p` with the host's arguments, cwd the trial)
  checked the rules. After `cd` into the module mirror, a Write and an Edit by absolute path in the trial were
  allowed. These were denied: a Write into the mirror, a Write into the trial's `node_modules`, and a Write to a
  relative path (which then named the mirror). Before the fix, `./**` followed the `cd`.
- **`--jobs`.** The new-and-changed run used `--jobs 4`, and the ablation arms used `--jobs 3` each. The three
  processes ran at the same time, with up to 10 trials at once. One scorecard per run, in the cases' order. The
  guard watched each trial and found nothing.
- **The release case on today's stack.** Its scripted solution failed on the Stack v0.1 branch before this change:
  re-running circuit:export no longer made the enclosure stale (that bug appears fixed there), so its
  `release --check` step, which expected a refusal, got a pass. The solution now regenerates the enclosure
  whether or not it is stale. All three agents released cleanly and named the hand-edited BOM.

## Follow-ups

- Harder variants that separate runs: with the scenarios hidden the two cases still pass 3/3, from the stale
  route, the pin order and check's errors. A fault none of these show is the next step.
- The `AGENTS.md` script paths (`../../node_modules/…`), which the host denies (skills and docs).
- The datasheet generator's `unit` fields (`V` for KV, `Hz` for baud, `g` for thrust in kg) (ext-docs).
- A stricter ablation arm that also leaves out the package READMEs, and more trials per arm.
- Judge costs in the scorecard.
