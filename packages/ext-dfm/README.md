# @protoboardai/ext-dfm

Design for manufacturing playbooks for agents, starting with 3D printing.

Part of [Protoboard](https://github.com/Delta-Robotics-Inc/protoboard-stack), which designs hardware with your AI agent. This extension is a body of context an agent loads whenever it does mechanical design: 3D modeling a part, an enclosure, a bracket, a mount, a jig or a fixture, moving a board into a CAD tool to build around it, or choosing how to make a part. It gets the agent caught up on the manufacturing process before it designs, keeps the process limits in view while it designs, and checks the result before anything is made.

The rules are recommendations for the user and defaults for the agent, never hard blocks. Anything the user states overrides them, and every departure is recorded as a bounded waiver. DFM (what the machine and material can do) is kept separate from style (taste, in `@protoboardai/ext-style`): where a style preference meets a physical limit, the limit sets the effective value and the agent says so.

## Skills

| Skill | What it does |
| --- | --- |
| `dfm` | The router and the method: establish the process (asked or inferred; FDM by default, the cheapest accessible method first), resolve the DFM profile, load the process playbook, balance style against the limits, record waivers, prove risky fits with a coupon or a printed slice, cross-check with DfX, hand to the review |
| `dfm-3d-printing` | The printing playbook, FDM first: walls, overhangs, bridges, holes, orientation, materials, fits and clearances per side, heat-set inserts, captured nuts, embedded magnets, other printing processes, test coupons |
| `dfm-review` | The independent check before anything is made: facts measured or read first, then compared; findings carry rule, value, limit, status, source and location, with OK, FAILED, NOT CHECKED or WAIVED results that advise and never block |

Read one with `npx protoboard skills read dfm`.

## The DFM profile

Every value carries a unit, a status (`house`, `typical`, `derived`, `assumption`, `unverified`, `proven`, `failed`, `user`) and a source. Layers apply in order, last wins, and formulas are evaluated after the merge, so changing `machine.nozzle` recomputes every width that depends on it:

| Order | Layer | File |
| --- | --- | --- |
| 1 | Shipped process profile | `profiles/<process>.json` in this package (`fdm.json` today) |
| 2 | User | `<config>/dfm/profile.json` (`<config>`: `PROTOBOARD_CONFIG_DIR`, else `%APPDATA%\protoboard` on Windows, else `$XDG_CONFIG_HOME` or `~/.config`, then `protoboard`) |
| 3 | Project | `<project>/dfm/profile.json` |
| 4 | Part | `<part folder>/dfm.json` |
| 5 | Session | `--set path=value` |

The format is in `skills/dfm/references/profile-format.md`; a starting layer is `skills/dfm/templates/profile.layer.json`.

## Running the resolver

Plain Node, no dependencies:

```bash
node node_modules/@protoboardai/ext-dfm/skills/dfm/scripts/resolve-profile.mjs --format table
node node_modules/@protoboardai/ext-dfm/skills/dfm/scripts/resolve-profile.mjs --part src/enclosures/case --set machine.nozzle=0.6
node node_modules/@protoboardai/ext-dfm/skills/dfm/scripts/resolve-profile.mjs --explain clearance.sliding.side --format table
```

Options: `--process <id>`, `--project <dir>`, `--part <dir>`, `--user <dir>` or `--no-user`, `--set path=value` (repeatable), `--format json|table`, `--explain <path>`, `--profiles <dir>`. JSON output is `protoboard.dfm.resolved/v1`. Exit 0 resolved, 1 resolved with errors (each naming its path), 2 usage or file errors.

## Not done yet

- Playbooks for laser cutting, CNC, sheet metal, casting and molding. Until they land, `dfm` uses headline rules (`skills/dfm/references/moving-up-the-ladder.md`) and says so.
- A measuring check: `dfm-review` measures with the CAD source, a STEP measuring tool when one is available or a mesh tool when one is available, and marks the rest NOT CHECKED. An automated rule check built on mesh and STEP measurement is planned.
- The calibration kit's coupon models and the branded test print (the coupon list exists in the printing playbook).
- Wiring into `build-a-project` and the CAD providers (`enclosure-cad`, `frame-cad`) so they read the resolved profile directly.
- The resolver does not merge the reference tables beside the profiles (`materials-fdm.json`, `printers-bambu-lab.json`); the playbook reads them.

Design: `docs/specs/dfm-system.md` in the repository.

- [Source](https://github.com/Delta-Robotics-Inc/protoboard-stack/tree/main/packages/ext-dfm)
- [Report an issue](https://github.com/Delta-Robotics-Inc/protoboard-stack/issues)

Apache 2.0. Protoboard is a trademark of Delta Robotics, Inc.
