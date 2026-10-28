# quadcopter-5in

Protoboard reference project: a 5-inch 6S freestyle quadcopter. The system is
described in UHD (`@deltarobotics/uhd`); this project holds its sources,
parts and CAD.

## Layout

- `src/quadcopter.uhd.ts` — root system: instances, links, harness assignments
- `src/modules/` — modules designed here: custom frame (`frame/`) and top plate
  (`top-plate/`), each with a `cad.config.ts` naming its `cad` provider
  (@protoboardai/ext-frame-cad), the native design in `frame-cad/` and the
  standard outputs in `out/` (generated from their interfaces by
  `run cad:generate` and `cad:export`); the stack and arm sub-assemblies
- `src/harnesses/` — wire harnesses and mounting-hardware harnesses (fastener
  stacks, including each propeller's nut); each wire
  harness has a provider directory `<harness id>/` with its `cad.config.ts`
  (@protoboardai/ext-harness-cad), its route in `harness-cad/` and its routed
  geometry in `out/` (attached by `routes.ts`). How every cable was worked
  out, modelled, routed and drawn:
  [`docs/harnesses-and-cad.md`](docs/harnesses-and-cad.md)
- Parts, in three tiers (`docs/specs/tool-integrations.md` §6 in the stack repo):
  - `parts/catalog/<id>.json` + `parts/catalog/<id>/` — purchased parts from the
    Protoboard Cloud parts catalog: each definition and the files that came with
    its revision (CAD, evidence). Immutable; `parts/origins.json` pins the service,
    revision, envelope digest and every file digest, and `check` verifies them
    offline.
  - `parts/local/<id>.uhd.ts` — purchased parts researched in this project: the
    bulk capacitor and the mounting hardware (screws, nuts, spacers, standoffs,
    the stack's grommets, the prop nut; built with `parts/local/hardware.ts`).
    None is in the catalog; evidence and verification in `parts/evidence/<id>/`.
    Each has a `cad.config.ts` in `parts/local/<id>/`: the hardware's nominal
    bodies come from @protoboardai/ext-frame-cad, the capacitor's from its own
    script (`part-cad/bulk_capacitor.py`) run by @protoboardai/ext-parts.
  - everything in `src/` — designed here, plus the assembly materials
    (`src/materials.uhd.ts`: solder, flux, threadlocker, tape, sleeve, ties).
- `src/scenarios.ts` — fault scenarios (not definitions): each must be caught
- `firmware/`, `docs/bom.*` — generated outputs; `operations/` — their records
- `docs/brief.md` (requirements R1–R9, each with how it is shown),
  `docs/decisions.md` (D-Q*, warnings dispositioned), `docs/power-budget.md`
- `release/<version>/` — the Manufacturing Package (`protoboard release`; not committed)
- `docs/docspec.ts` — presentation spec of the technical documents;
  `docs/quadcopter-5in-{datasheet,assembly-guide}.{html,pdf,values.json}`,
  `docs/quadcopter-5in-bom.json`, `docs/images/`, `docs/test-data/` — built
  by `run tech-docs` (stand-in test data until measured files replace it)

## Commands

- `npx protoboard check` — resolve and run all validators (nonzero on errors)
- `npx protoboard inspect [arm_fl/motor]` — context for the system or one instance
- `npx protoboard build` — `.protoboard/build/resolved.json`
- `npx protoboard parts search <words>` / `parts add <id>[@rev]` — find and vendor
  catalog parts (needs the parts service: `PROTOBOARD_CLOUD_URL`, then `cloud.url`,
  default the hosted Protoboard library); `parts update` shows what the catalog recommends,
  `parts update <id> --to <rev>` re-pins deliberately; `parts publish
  parts/local/<file>` promotes a researched part (needs `PROTOBOARD_CLOUD_TOKEN`).
  Nothing else talks to the service: check, build and inspect work offline.
- `npx protoboard doctor` — extensions, tools (build123d for the CAD providers), runtimes, skills
- `npx protoboard tools install cad` — once per checkout: the Python runtime with
  build123d that ext-frame-cad and ext-harness-cad use (`.protoboard/tools/cad/`)
- `npx protoboard capabilities` — which provider designs which module
- `npx protoboard dev` — the UHD viewer on this project, live; dragged layout
  is saved to `.protoboard/display.json`
- `npx protoboard skills` — the installed skills; read the one for your task
  (`skills export --host claude-code` puts them in `.claude/skills/`).
  **build-a-project** is the top-level procedure: it gives the order of work
  from the brief to a release and names the skill for each stage
- `npx protoboard run cad:generate --module <id>` then `run cad:export
  --module <id>` — regenerate one module's CAD: a plate, a cable, a piece of
  hardware or the capacitor (needs Python with build123d: the `cad` runtime,
  or `PROTOBOARD_PYTHON=<interpreter>`). Every CAD body is made this way.
  `run frame-cad`, `run harness-cad` and `run hardware-cad` do both for every
  plate, cable or piece of hardware (the cables in one routing run), and each
  module still gets its own `cad:generate` and `cad:export` record, which the
  release traces its `out/` to. `run frame-cad-rebind` after a reviewed change; `run bom`; `run
  betaflight-cli`
- `npx protoboard run tech-docs` then `run tech-docs-verify` — the datasheet
  and assembly guide (needs Chrome and poppler; Kode Mono ships with
  ext-docs)
- `npx protoboard release --check`, then `npx protoboard release` — the
  Manufacturing Package in `release/<version>/` (gitignored here: it is
  rebuilt byte for byte from the committed project). Units: the flight stack
  (`units/stack/`, built and bench-tested first) and final assembly
  (`system/`), set by `release` in `protoboard.config.ts`. Each unit's work
  order, assembly guide and test plan follow the steps of `docs/docspec.ts`;
  the root's work order runs the bench test and the flight-controller
  configuration with the props off before the battery (`after: "test"`)
  and the propellers go on;
  the frame and top plate get cut orders, the cables their cut lengths and
  terminations, the bench test the project's own checks (`release.checks`)
  and the functional checks the brief's requirements table. Refused while `check` has errors, a generated output is stale or edited, or
  the tree has uncommitted changes (**release** skill; needs Chrome)
- `npx protoboard run part-verify --input part=<id>` — automated checks for a
  locally authored purchased part (**uhd-part-verify**)
- `npx tsx ../../node_modules/@protoboardai/ext-hardware/skills/system-compose/scripts/scenarios.ts`
  — run the fault scenarios (`node_modules` is the workspace's, two levels up);
  `.../harness-author/scripts/stackup.ts` — the fastener stack-ups

Add `--format json` for machine output.

## Rules

- Cite sources for every value; mark assumptions as `assumption` traits.
- Never edit anything under `parts/catalog/`; derive a local variant with its own id.
- Never edit generated files (frame and hardware CAD, `firmware/`, `docs/bom.*`,
  the technical documents); change the model or the doc spec and re-run the
  operation.
- Model checks passing is not flight readiness.
