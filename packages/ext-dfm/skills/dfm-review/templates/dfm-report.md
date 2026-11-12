# DFM review: <part>

| | |
| --- | --- |
| Date | <YYYY-MM-DD> |
| Reviewer | <agent session, or "fresh pass"; never a person's name unless the user asks> |
| Model | <file or document, and its revision or commit> |
| Process | <fdm, ...> (stated by <user, project layer, inferred: why>) |
| Printer, nozzle | <machine.family>, <machine.nozzle> mm |
| Material | <material.default or the part's material> |
| Profile | <profile.id>; layers: <shipped, user, project, part, session> |
| Resolver | exit <0/1/2>; errors: <none, or the paths> |
| Playbook | <dfm-3d-printing, or "no playbook: headline rules"> |
| Stage | <prototype or end-use> |

## Summary

<clear | findings | incomplete>: <n> OK, <n> FAILED (<n> critical, <n> major, <n> minor), <n> WAIVED, <n> NOT CHECKED.

<Two to four lines for the user: what would fail, what was not checked, what each change takes. Findings are advice; the user decides.>

## Facts

| Fact | Value | Location | Method |
| --- | --- | --- | --- |
| wall.thinnest | <value> mm | <where> | <source / step / mesh / inspection / not measured> |
| wall.loadbearing.thinnest | | | |
| overhang.steepest | <deg from vertical> | | |
| bridge.longest | mm | | |
| hole.smallest | mm | | |
| orientation.load | <load direction against layers> | | |
| bed.contact | <face, area, edge treatment> | | |
| feature.smallest | mm | | |
| text.smallest | <height, stroke, depth> mm | | |
| part.envelope | <x by y by z> mm | | |

## Findings

| Id | Check | Rule | Value | Limit | Limit status | Source | Location | Method | Result | Severity | Consequence | Hint (target) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| F1 | Process and profile | process.stated | | stated | | | | | | | | |
| F2 | Walls | | | | | | | | | | | |
| F3 | Overhangs and supports | | | | | | | | | | | |
| F4 | Bridges | | | | | | | | | | | |
| F5 | Holes | | | | | | | | | | | |
| F6 | Orientation against load | | | | | | | | | | | |
| F7 | Bed contact | | | | | | | | | | | |
| F8 | Fits (see Fits) | | | | | | | | | | | |
| F9 | Embedded hardware | | | | | | | | | | | |
| F10 | Small features and text | | | | | | | | | | | |
| F11 | Material against service | | | | | | | | | | | |
| F12 | Waivers (see Waivers) | | | | | | | | | | | |
| F13 | Coupons (see Coupons) | | | | | | | | | | | |
| F14 | DfX short list | | | | | | | | | | | |
| F15 | Style against limits | | | | | | | | | | | |

Add a row per instance when a check finds more than one (F2a, F2b, ...).

## Fits

| Fit | Intended per side | Intended diametral | Model difference | Check | Limit status |
| --- | --- | --- | --- | --- | --- |
| <lid in rim> | mm | mm | mm | <OK / per side applied to a diameter / diametral applied per side / NOT CHECKED> | |

## Waivers

| Rule | Feature | Recorded (value, limit, bound) | Now | Status | Decided by |
| --- | --- | --- | --- | --- | --- |
| | | | | <valid / out of bound / stale / awaiting confirmation> | <user / agent> |

## Coupons

| Fit or pocket | Limit status | Coupon or slice | State |
| --- | --- | --- | --- |
| | | <from test-coupons.md> | <planned / done: result / missing> |

## Style adjustments

| Style value | Limit (path, value, status) | Effective value | Reported by the designer |
| --- | --- | --- | --- |
| | | | <yes / no> |

## DfX short list

| Question | Answer | Changes the design? |
| --- | --- | --- |
| Manufacturing | | |
| Assembly | | |
| Reliability | | |
| Testability | | |
| Serviceability | | |
| Cost | | |

## Not checked

<Each NOT CHECKED item, and what would measure it.>
