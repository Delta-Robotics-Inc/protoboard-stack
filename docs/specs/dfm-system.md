# The DFM system

Status: design spec, first package built (2026-11-12): `@protoboardai/ext-dfm`
with the `dfm`, `dfm-3d-printing` and `dfm-review` skills, the FDM profile and
the profile resolver. Research behind it: `docs/specs/dfm-research/`.

## 1. Purpose and intent

Agents make short-sighted manufacturing decisions. They draw a 0.5 mm wall
because it looks clean, put a per-side clearance on a diameter, model a
bracket that needs supports on every face, or design a first prototype as if
it were going to an injection molder. The DFM system is a body of context
that corrects this: it gets the agent caught up on how the part will be made
before it designs, keeps the limits in view while it designs, and is the
cross-check afterward.

The design intent:

- The manufacturing process is asked ("are you 3D printing or CNC machining
  this?") or inferred from the session and the project (a quick prototype
  enclosure implies 3D printing).
- The cheapest accessible method comes first: "make it work before you make
  it pretty." FDM printing is the default, then laser cutting, UV printing,
  small-volume molding with printed molds and so on, up to production
  methods where tolerance, certification and material selection matter more.
- The rules are recommendations for the user and defaults for the agent,
  never hard blocks. Anything the user states overrides them.
- DFM is separate from style, and both must exist and be balanced.
- Design for Excellence (DfX: manufacturing, assembly, reliability, cost,
  sustainability, testability, serviceability) stays in view.
- 3D printing is the first package; laser cutting, CNC and others slot in
  later without restructuring.

## 2. When it is invoked

The `dfm` skill's description makes a host load it for any mechanical design
request: "help me 3D model something", "design a bracket", "design an
enclosure for this board", "move this PCB into Onshape so I can build an
enclosure", any jig, mount, case or fixture, choosing how to make a part,
and reviewing a model before it is made. It applies inside a Protoboard
project and outside one. In **build-a-project** it applies at the enclosures
and structures stage, before the CAD providers generate; `dfm-review` runs
before a release or any manufacturing hand-off.

The flow:

```
establish process ─► resolve profile ─► load playbook ─► read style, balance ─► design (waivers)
   ─► coupon or slice for risky fits ─► DfX cross-check ─► dfm-review
```

## 3. DFM against style: the balance rule

| | Style | DFM |
| --- | --- | --- |
| What it is | Personal or house taste: proportions, fillets, wall look, text | What the machine and material can physically do |
| Where it lives | `@protoboardai/ext-style` (`cad-style`, `style-system`) | `@protoboardai/ext-dfm` profiles and playbooks |
| Flexibility | Flexible; changes with the user and the product | Changes only with the process, machine, material or a measurement |

The rule: **style proposes, the process limit sets the effective value, and
the agent reports each place a preference was floored or changed.** A style
preference never overrides a limit. A statement by the user does; it is then
recorded as a waiver. With no style available, the profile alone applies.

## 4. The profile cascade and the status vocabulary

A DFM profile holds the limits as paths (`machine.nozzle`, `wall.structural`,
`clearance.sliding.side`). Every entry has a value or a formula, a unit, a
status and a source. The cascade, last wins:

| Order | Scope | File |
| --- | --- | --- |
| 1 | shipped | `profiles/<process>.json` in the package; chosen by `--process`, the nearest layer's `extends`, or `fdm` |
| 2 | user | `<config>/dfm/profile.json`; `<config>` resolved as `packages/board-style/src/paths.ts` resolves it |
| 3 | project | `<project>/dfm/profile.json` |
| 4 | part | `<part folder>/dfm.json` |
| 5 | session | `--set path=value` for what was said in the session |

A layer replaces a whole entry. Formulas (arithmetic, `min`, `max`, `round`)
are evaluated after the merge, so a user who sets the nozzle to 0.6 mm gets
every dependent width recomputed, while a value set explicitly in a later
layer beats an earlier formula. The resolver is plain Node with its own
expression parser (no `eval`), reports cycles and unknown paths as errors
naming the path, and passes recorded waivers through to the review.

Status vocabulary:

| Status | Means |
| --- | --- |
| `house` | The shipped house default, chosen by the project maintainers |
| `typical` | From a cited source |
| `derived` | Computed or reasoned, not sourced |
| `assumption` | A stated assumption |
| `unverified` | Seen but not confirmed at the source |
| `proven` | Measured on this user's machine with a coupon (the note names the coupon and date) |
| `failed` | Tried and did not work (the note says what happened) |
| `user` | Stated by the user |

A coupon promotes a value from `typical` to `proven` (or records it as
`failed`) in the user or project layer. Waivers are bounded: each records
the rule, the value, the limit and a bound past which it stops applying, so a
waiver for a 0.6 mm lip never covers a later 0.4 mm lip.

## 5. Package layout

```text
packages/ext-dfm/
  protoboard-extension.json   skills: dfm (verifiedBy dfm-review), dfm-3d-printing (verifiedBy dfm-review), dfm-review
  profiles/                   fdm.json (protoboard.dfm.profile/v1); reference tables materials-fdm.json, printers-bambu-lab.json
  skills/dfm/                 SKILL.md; references: process-ladder, moving-up-the-ladder, dfx-checklist, profile-format, design-aids;
                              scripts/resolve-profile.mjs; templates/profile.layer.json
  skills/dfm-3d-printing/     SKILL.md; references: fdm-rules, materials, fits-and-clearances, hardware, other-processes,
                              bambu-lab, test-coupons, sources
  skills/dfm-review/          SKILL.md; references/report-format.md; templates/dfm-report.md
  test/resolve-profile.test.ts
```

The review's findings carry rule, measured value, limit, the limit's status,
source, location and method, with results OK, FAILED, NOT CHECKED (never a
pass) or WAIVED; severities describe consequences and never block. Facts
are measured before verdicts are given.

## 6. Adding a process

A new process slots in without touching the others:

1. A skill `dfm-<process>` (for example `dfm-laser-cutting`) in this
   package's manifest with `verifiedBy: dfm-review`, written in the SOP
   format, with its rule tables and sources under `references/`.
2. A shipped profile `profiles/<process>.json` (schema
   `protoboard.dfm.profile/v1`, `id` equal to the file name), its values
   formulas over a few machine inputs (kerf, stock thickness, cutter
   diameter) where they depend on them.
3. The ladder entry in `skills/dfm/references/process-ladder.md` points at
   the new playbook, and its headline rules leave `moving-up-the-ladder.md`.
4. `dfm` step 3 names the playbook; `dfm-review` gains the process's checks
   (for laser: kerf compensation, tab and slot fit, hole and slot minimums
   against stock thickness).
5. A coupon kit for the process (laser: kerf comb, tab and slot ladder,
   living hinge pitch) in the design aids.

## 7. Roadmap

1. Playbooks and profiles for laser cutting, then CNC (routing and
   machining), sheet metal, urethane casting and molding with printed molds;
   packaging later.
2. A measuring check: an automated rule check over STEP (the stack's
   build123d measurement, `protoboard geometry`) and meshes, returning the
   same findings format with fact-only measurement, so `dfm-review` compares
   instead of measuring by hand.
3. Wiring: **build-a-project** names `dfm` at the enclosure and structure
   stage; the CAD providers (`enclosure-cad`, `frame-cad`) read the resolved
   profile for their defaults (wall, clearance, insert sizes) instead of
   their own constants, and report waivers in the same form.
4. The calibration kit's coupon models and the branded test print
   (`docs/reference/design-aids.md`), with a writer that records a coupon
   result into the right layer.
5. Printer and material selection that copies values from the reference
   tables (`printers-bambu-lab.json`, `materials-fdm.json`) into a layer.

## 8. Open questions

1. Should the resolver merge printer and material tables (a `machine.family`
   that pulls build volume and temperatures), or should a layer copy them?
   Today a layer copies them.
2. Where do waivers live for parts that are not a module folder (an Onshape
   document)? Today the project layer, keyed by `feature`.
3. Should `proven` values carry an expiry (a new nozzle, a new slicer
   version) beyond the note?
4. How far should `dfm-review` go without a measuring tool? Today it marks
   what it cannot reach NOT CHECKED, which keeps it honest but can leave
   reviews `incomplete`.
5. Settled: `dfm` step 4 passes the resolved profile to the style resolver
   (`resolve-style.mjs --dfm <resolved.json>`), which returns each token's
   value, its effective value and whether it was adjusted, with the reason.
6. The package is in the root workspaces. Whether `protoboard extensions add
   @protoboardai/ext-dfm` works in an installed project has not been tried.
