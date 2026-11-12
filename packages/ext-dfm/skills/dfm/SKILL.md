---
name: dfm
description: Design for manufacturing for any mechanical CAD work. Load it before and while you 3D model a part, enclosure, case, bracket, mount, jig or fixture; when a board is moved into a CAD tool (Onshape, build123d, Fusion) to build around it; when choosing how to make a part (3D printing, laser cutting, CNC, molding); and before a model is made. It sets the manufacturing process (asked or inferred, FDM by default, cheapest accessible method first), resolves the layered DFM profile of machine and material limits, loads the process playbook, balances style against what the process can do, records waivers, proves risky fits with a coupon or a printed slice, and cross-checks with DfX; follow with dfm-review.
---

# Design for manufacturing

```
process (asked or inferred) ─► DFM profile (shipped ◄ user ◄ project ◄ part ◄ session)
        │                                   │
        ▼                                   ▼
 process playbook ──► style balanced against the limits ──► design with defaults, waivers recorded
                                                                    │
                     dfm-review ◄── DfX cross-check ◄── coupon or printed slice for risky fits
```

This is the method and the router for mechanical design. It gets the agent
caught up on how the part will be made before the first feature is drawn,
keeps the process limits in view while designing, and hands the result to an
independent check. The limits are recommendations to the user and defaults
for the agent, never hard blocks: anything the user states overrides them,
and every departure is written down.

Design for manufacturing (DFM) and style are separate. Style is taste and is
flexible (**cad-style**). DFM is what the machine and the material can
physically do. Where a style preference meets a physical limit, the limit
sets the effective value and the agent says so.

## Purpose

Make parts that can be made on the cheapest method that answers the question
at hand, first time, with every rule the design leans on visible and every
exception recorded. Use it when someone asks to 3D model something, design a
bracket, enclosure, mount, jig, case or fixture, move a board into a CAD tool
to build an enclosure around it, decide how a part should be made, or review
a model before it is printed, cut or machined. Use it inside a Protoboard
project and outside one alike.

Do not use it for the generation mechanics of a specific provider; that is
**enclosure-cad** (printed or machined cases) or **frame-cad** (cut plates),
which this skill sits beside: run this one first so their constraints start
from the right process limits. In **build-a-project** it applies at the
enclosures and structures stage, before **enclosure-cad** or **frame-cad**
generate, and its paired check, **dfm-review**, runs before any release or
manufacturing hand-off.

## Inputs

| Input | Where | From |
| --- | --- | --- |
| What the part must do, and for how many units | the session; `docs/brief.md` in a project | the user; **build-a-project** writes the brief |
| The manufacturing process, printer and material | the session; the project layer `dfm/profile.json`; the user layer `<config>/dfm/profile.json` | the user, or inferred in step 1 |
| The shipped process profiles | `node_modules/@protoboardai/ext-dfm/profiles/` (`fdm.json`; more as playbooks land) | this package |
| The resolver | `node_modules/@protoboardai/ext-dfm/skills/dfm/scripts/resolve-profile.mjs` | this package (plain Node, no install) |
| The process playbook | **dfm-3d-printing** for printing; [moving up the ladder](references/moving-up-the-ladder.md) otherwise | this package |
| The style for the domain | **cad-style**, resolved as **style-system** describes | `@protoboardai/ext-style`; optional (no style: the profile alone) |
| The CAD source, when it exists | the model script, the CAD document (an Onshape link), or the module's `out/body.step` | the person or the CAD skill in use |

`<config>` is the Protoboard config folder: `PROTOBOARD_CONFIG_DIR`, else
`%APPDATA%\protoboard` on Windows, else `$XDG_CONFIG_HOME` (or `~/.config`)
followed by `/protoboard`, the same folder the CLI uses for sign-ins and PCB
style. The layer format is in [the profile format](references/profile-format.md).

## Steps

### 1. Establish the manufacturing process

Read what is already known before asking anything: the session (did the user
name a process, a printer, a material, a quantity, a deadline?), the project
(`docs/brief.md`, an existing `dfm/profile.json`, an enclosure module's
`process` constraint), and the user layer.

```bash
npx protoboard inspect                     # in a project: the modules, and any enclosure or plate already modeled
node node_modules/@protoboardai/ext-dfm/skills/dfm/scripts/resolve-profile.mjs --format table
```

Look at the `layers:` line (which layer files exist) and at `machine.*` and
`material.*` rows (what a layer already states). Then decide:

- **Stated.** The user or a layer named the process: use it.
- **Inferred.** The evidence is clear (a quick prototype enclosure, a one-off
  bracket, "I'll print it tonight", a Bambu Lab printer mentioned): infer, and
  say in one line what was inferred and from what. A quick prototype implies
  FDM printing.
- **Unknown.** Ask one short question and wait, for example: "Are you 3D
  printing this, or having it laser cut or CNC machined? If printing, which
  printer and material?" Ask only for what changes the design.
- **Nothing known and nobody to ask.** Default to FDM, the first rung of the
  [process ladder](references/process-ladder.md), and say so.

Record the process, printer and material the user states in the project
layer (`dfm/profile.json`, a bare value per path, status `user`) or, when they
are the user's standing setup, offer to put them in the user layer. Copy
[the layer template](templates/profile.layer.json) to start one.

### 2. Resolve the DFM profile

```bash
node node_modules/@protoboardai/ext-dfm/skills/dfm/scripts/resolve-profile.mjs --part <part folder> --format table
node node_modules/@protoboardai/ext-dfm/skills/dfm/scripts/resolve-profile.mjs --part <part folder> --set machine.nozzle=0.6 --format json
node node_modules/@protoboardai/ext-dfm/skills/dfm/scripts/resolve-profile.mjs --explain <path> --format table
```

The cascade is shipped profile, user layer, project layer (found from the
current folder by `protoboard.config.ts`, or `--project <dir>`), part layer
(`<part folder>/dfm.json`), then `--set path=value` for what was said in this
session. Formulas are evaluated after the merge, so a different nozzle (for
example a user's 0.6 mm, an illustrative value) recomputes every width that
depends on it.

Read every value with its `status` and `source`: `proven` was measured on
this user's machine; `user` was stated by the user; `house` is the stack's
house default; `typical` comes from a cited source; `derived` and
`assumption` are reasoned, not sourced; `unverified` was seen but not
confirmed; `failed` was tried and did not work. A non-empty `errors` list
(exit 1) names the path at fault: fix the layer before designing. `waivers`
lists the departures already recorded.

### 3. Load the process playbook

For printing (FDM, resin, powder), read **dfm-3d-printing**:

```bash
npx protoboard skills read dfm-3d-printing
```

Its references hold the rule tables and their sources:
[FDM rules](../dfm-3d-printing/references/fdm-rules.md),
[materials](../dfm-3d-printing/references/materials.md),
[fits and clearances](../dfm-3d-printing/references/fits-and-clearances.md),
[embedded hardware](../dfm-3d-printing/references/hardware.md),
[other printing processes](../dfm-3d-printing/references/other-processes.md),
[Bambu Lab printers](../dfm-3d-printing/references/bambu-lab.md) and
[test coupons](../dfm-3d-printing/references/test-coupons.md).

For a process with no playbook yet (laser cutting, CNC routing or machining,
sheet metal, casting, molding), use [moving up the ladder](references/moving-up-the-ladder.md)
and say plainly to the user: "There is no playbook for this process yet; the
guidance is headline level, and the vendor's own design guide wins."

### 4. Read the style and apply the balance rule

Read the style for the domain with **cad-style** (how style layers resolve is
**style-system**). The style resolver applies the limits itself when it is
given the resolved profile:

```bash
node node_modules/@protoboardai/ext-dfm/skills/dfm/scripts/resolve-profile.mjs --part <part folder> --format json > <scratch>/dfm.resolved.json
node node_modules/@protoboardai/ext-style/skills/style-system/scripts/resolve-style.mjs --domain cad --item <part folder> --dfm <scratch>/dfm.resolved.json --format json
```

Each token comes back with its `value`, its `effective` value and whether it
was `adjusted`, with the reason. Then, for every style value that touches a
process limit (wall and shell thickness, fillet and chamfer sizes, text size
and depth, gaps, rib and boss proportions):

1. Style proposes the value.
2. The process limit from the resolved profile sets the floor or the ceiling.
3. The effective value is the style value clamped to the limit.
4. Report each place a preference was floored or changed, in one line each:
   preference, limit (path, value, status, source), effective value.

A style preference never overrides a limit; a statement by the user does
(step 5). With no style available, design from the profile alone and say so.

### 5. Design with the rules as defaults; record waivers

Model in the print (or cut, or machining) orientation from the first feature.
Use the resolved values as defaults: the agent does not invent a number the
profile holds, and cites the path when it uses one.

Every deliberate departure from a rule is a waiver, recorded in the part
layer's `waivers` list (or the project layer for a project-wide one):

| Field | Holds |
| --- | --- |
| `rule` | the rule id from the playbook, or the profile path |
| `feature` | where on the part |
| `value`, `unit` | the measured or intended value |
| `limit` | the limit it departs from, as resolved |
| `bound` | `{ "min": x }` or `{ "max": x }`: the waiver stops applying if the value moves past it |
| `reason` | why, in a sentence |
| `decidedBy` | `user` (stated by the user) or `agent` (proposed; the user should confirm) |
| `date` | when |

A waiver is bounded so that it covers the value that was judged and nothing
worse: for example (illustrative values), a lip waived at 0.6 mm with
`bound: { "min": 0.6 }` does not cover a later 0.4 mm lip.

When the user states a value that departs from a rule, use it; record it as a
waiver with `decidedBy: user`, and tell the user once what the rule protects
against. Do not argue twice.

### 6. Prove risky fits and features early

For each fit, pocket or feature whose limit is not `proven`, and for any part
that takes more than about an hour to print (an assumption, set by the user's
patience), propose a fit-test coupon or a printed slice before the full part.
How to choose the slice, the coupon kit and how a result promotes a value
from `typical` to `proven`: [design aids](references/design-aids.md); the
coupon list: [test coupons](../dfm-3d-printing/references/test-coupons.md).

The agent prepares the coupon or slice model and says what to measure; a
person prints it and reports the result. Record the result in the user layer
(the printer's behavior) or the project layer (this material and fit), with
status `proven` or `failed` and a note naming the coupon and the date.

### 7. Cross-check with DfX

Run the [DfX checklist](references/dfx-checklist.md) at the depth the stage
deserves: the short list for a prototype, the full list for an end-use or
sold product. Report the items that change the design; leave the rest as
checked.

### 8. Hand to dfm-review

Before anything is printed, cut, machined or ordered, hand the model to
**dfm-review**, run by an agent that did not design the part (or by the same
agent in a fresh pass that measures before it reads the design notes). Pass
the resolved profile output, the waivers and the style adjustments from
step 4.

## Decision points

| Decision | Rule |
| --- | --- |
| Ask or infer the process | Infer when the session or the project names it or makes it plain (a quick prototype enclosure, a printer mentioned); say what was inferred and why. Ask one short question when two processes are plausible and the choice changes the geometry. Default to FDM when nothing is known and nobody can be asked. |
| When to climb the ladder | Stay on the cheapest rung that can answer the current question. Climb only when a stated requirement forces it: quantity, strength or temperature the printable materials do not meet, a tolerance tighter than the profile's achievable accuracy, a cosmetic finish, or a certification. Name the requirement that forces the climb. See [the process ladder](references/process-ladder.md). |
| Prototype or end-use depth | A prototype, a jig or a one-off gets the profile defaults, coupons for risky fits and the short DfX list. An end-use part, anything sold, anything load-bearing near people, or anything with a stated life gets the full DfX list, a material check against service conditions, and a design that would survive the next rung up. The user says which; when unstated, a "quick", "test" or "prototype" request is a prototype. |
| A user statement against a default | The user wins. Use the stated value, record a waiver with `decidedBy: user`, state once what the rule protects against. |
| A style preference against a limit | The limit wins; the effective value is the clamped one; report it (step 4). If the user then insists on the preference, it is a user statement (row above). |
| A value with status `typical`, `unverified`, `assumption` or `derived` on a fit or a pocket | Propose a coupon (step 6) before the full part. `proven` or `user` values need none. A `failed` value is never used: use the alternative its note gives, or ask. |
| Two sources disagree | Use the conservative value the profile or playbook names, and say both values. |
| No playbook for the process | Headline rules from [moving up the ladder](references/moving-up-the-ladder.md), the vendor's own guide as the authority, and a plain statement that the playbook is not written yet. |

## Outputs

| Output | Where |
| --- | --- |
| The process, printer and material the user stated | project layer `dfm/profile.json` (or the user layer `<config>/dfm/profile.json`, with the user's agreement) |
| Part-specific values and waivers | part layer `<part folder>/dfm.json` |
| Coupon results | the user or project layer, status `proven` or `failed`, with a note |
| Style adjustments and the process decision | the design notes or the hand-off message to **dfm-review** |
| The model | wherever the CAD skill in use writes it (never a generated file edited by hand) |

The shipped profiles in `node_modules/@protoboardai/ext-dfm/profiles/` are
never edited in a project; a project changes values only through its layers.

## Verification

```bash
node node_modules/@protoboardai/ext-dfm/skills/dfm/scripts/resolve-profile.mjs --part <part folder> --format json   # exit 0; errors []
npx protoboard check --format json                                                                                   # in a project: 0 errors
```

Then **dfm-review**, by an agent that did not design the part. Its report is
in `docs/reviews/dfm-review-<part>-<YYYY-MM-DD>.md`.

## Failure handling

| Code or symptom | Means | Do |
| --- | --- | --- |
| Process unknown and the user cannot be asked | Nothing to infer from | Default to FDM, say so, and keep the design free of features that only another process could make |
| Printer unknown | No machine limits beyond the house defaults | Use the shipped values (`house`, `typical`); for size, assume the profile's build volume; ask once when the part is near a limit |
| Material unknown | Service conditions cannot be checked | Use the profile's default material; ask when the part sees heat, sunlight, load or chemicals |
| Conflicting statements (session against a layer, or two layers) | The cascade picks the last; the user may not know | Use the latest statement in the session; tell the user which layer it overrides, and offer to update that layer |
| A style preference below a process limit | The balance rule applies | Clamp, report the adjustment (step 4) |
| No playbook for the process | Headline guidance only | [Moving up the ladder](references/moving-up-the-ladder.md); say the playbook is not written yet |
| A value marked `unverified` or `assumption` drives a fit | The number is not confirmed | Treat it as a starting point; propose a coupon (step 6) |
| A value marked `failed` | It was tried on this machine and did not work | Do not use it; read its note for what happened and what to use |
| Resolver exit 1, `errors` names a path | A formula cycle, an unknown path, or a bad entry in a layer | `--explain <path>`; fix the named layer file |
| Resolver exit 2 | No such profile, or a layer file is not valid JSON or has the wrong `schema` | Fix the file; for a process with no profile, record it in the layer `notes` and leave out `extends` |
| The resolver cannot run (not installed, no Node) | No resolved values | Read `profiles/fdm.json` directly, evaluate the formulas by hand, and say so |
| The part does not fit the build volume | Too big for one print | Split with alignment features, or climb the ladder (bureau or another process) |

## Hard rules

1. Never order, upload, print, cut or start a machine. A step with physical
   effects (printing a coupon, slicing for a printer) is performed or
   authorized by a person.
2. Never present a `typical`, `house`, `derived` or `assumption` value as
   measured. Only `proven` is measured on this user's machine.
3. Rules are recommendations and defaults, never blocks; the user's statement
   wins, and every departure is a bounded waiver.
4. A limit always beats a style preference; the agent reports where it did.
5. Cite the profile path (and through it the source) for every number used
   in the design.
