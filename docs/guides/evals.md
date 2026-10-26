# Evals

An eval measures how well an agent follows an extension's skills: it gets a
project in a known state and an instruction, works with the tools it is
allowed, and graders decide what it achieved. Every extension ships its
cases in `evals/`; `protoboard evals` runs them through an agent host and
writes a scorecard. The design is in
[releases, package, SOPs and evals](../specs/release-package-and-evals.md) §5;
the code is `packages/core/src/evals/` and the `evals` command in
`packages/cli`. The EV6 round added parallel runs, the ablation arm, script
and diagnostic graders, and harder cases.

## Running evals

```sh
npx protoboard evals --list                      # the installed cases, budgets, graders, tools they need
npx protoboard evals                             # every case, scripted host, one trial each
npx protoboard evals --extension parts           # one extension (@protoboardai/ext-parts, ext-parts or parts)
npx protoboard evals --case 'author-*'           # cases by id or pattern
npx protoboard evals --host claude-code --extension hardware --trials 3
npx protoboard evals --host claude-code --judge claude-code --model sonnet
npx protoboard evals --host claude-code --trials 3 --jobs 6    # every case, six trials at a time, one scorecard
npx protoboard evals --host claude-code --case fix-gnss-uart-swap --no-skills   # the ablation arm
npx protoboard evals --ci                        # the CI hook: scripted host only
```

Run it anywhere the extensions are installed: in a project, or at the root of
this repository, where every extension is. Cases are discovered in every
installed package that has a `protoboard-extension.json` and an `evals/`
folder.

For each case the runner:

1. probes the tools the case `requires` (declared by the extensions, as for
   `doctor`); a missing one skips the case and says which and how to install
   it;
2. builds the fixture once in a scratch folder (`<tmp>/protoboard-evals/<run>/`,
   or `--work-dir`): copies the fixture folder, links `node_modules` to the
   run's module mirror (below), runs the recipe and the seeding steps, and,
   when the case has a `fault` grader, runs `protoboard check` to confirm the
   seeded fault shows (a seed that does not show is a broken case, reported
   as an error, and no trial runs);
3. for each trial, copies the fixture again, exports the skills where the host
   finds them (`protoboard skills export --host claude-code` for Claude Code),
   lets the host's agent work in that copy within the budget, and grades the
   copy and the agent's final answer;
4. deletes the scratch copies and the mirror (`--keep` leaves them, and the
   scorecard names each trial's directory).

With `--jobs <n>`, fixtures and trials of several cases run at once, at most
`n` at a time (the fixtures first, in the cases' order, then the trials), and
one scorecard holds them in the cases' order; log lines carry the case id.
The guard below still watches everything outside each copy, but a change
made while several trials run fails every one of them: run an agent you
suspect of escaping with `--jobs 1`.

### Isolation

The user's checkout is never the working directory of an agent, and the
answers are not within its reach:

- **The module mirror.** A trial's `node_modules` links to a mirror the run
  builds once (`<work>/modules/<n>/node_modules`, about a second): the
  packages as an install from a registry would have them. Third-party
  packages (any folder inside a `node_modules`, also when a worktree's
  `node_modules` links its entries into another checkout's install) are hard
  links of all their files (copies on another file system). A linked package (a workspace member such as
  `@protoboardai/ext-parts`, or a sibling checkout such as
  `@deltarobotics/uhd`) is copied, so rebuilding it while evals run does not
  change what a running trial sees, and it carries only its published
  `files` (all of its top level when one of them is a pattern such as
  `**/*.js`), never its
  `evals/` (the cases and their solutions) or its tests. A linked package
  that is a Protoboard project (`protoboard.config.ts`: the examples the
  fixtures are copied from) is left out. Nothing in the mirror links back
  into the workspace, so a path that climbs with `..` from inside it stays in
  the scratch folder.
- **One CLI.** The fixture's and the trials' `protoboard` commands, the
  agent's `npx protoboard` and the graders all run the mirror's CLI, so the
  project, its extensions and the CLI share one `@protoboardai/core`.
- **The guard.** For every host that is not `trusted` (only the scripted
  host is), the runner records the size and modification time of every file
  in the workspace (without `node_modules`, `.git`, `.venv*`,
  `__pycache__`, the scratch folder and the scorecard folder), in the
  published files the mirror took from sibling checkouts (not their runtime
  data, such as a local parts service's database), in the fixture and in
  the mirror, before
  each trial, and compares after it. Anything added, removed or changed
  fails the trial, whatever the graders say, and the scorecard lists the
  paths (`outside`). Changes you make to the workspace while a real agent
  runs fail its trial too.

What the guard does not do: it does not stop a write, it detects it after
the trial. A shell command the case allows could still write outside the
copy (the permission rules below make that hard, not impossible). An
operating-system sandbox would stop it; see "Next".

| Option | Meaning |
| --- | --- |
| `--extension <id>` | One extension |
| `--case <id>` | Cases by id, a pattern with `*`, or several, comma-separated |
| `--trials <n>` | Trials per case (default 1) |
| `--jobs <n>` | Fixtures and trials to run at once, across cases, into one scorecard (default 1) |
| `--no-skills` | The ablation arm: no skills exported, their documents left out of the module mirror, no Skill tool (below) |
| `--host scripted\|claude-code` | The agent host (default `scripted`) |
| `--judge claude-code` | Score rubric graders with an LLM judge (default: off, rubric graders are skipped) |
| `--model <model>` | Model for the claude-code host and judge |
| `--keep` | Keep the fixture and trial directories |
| `--work-dir <dir>` | Scratch folder |
| `--out-dir <dir>` | Where scorecards go (default `.protoboard/evals` in the project) |
| `--list` | List the cases; exit 1 if one does not load |
| `--ci` | Scripted host only, no judge |

The exit code is 1 when a case is broken, a case does not load, or any trial
fails; 0 otherwise. Skipped cases do not fail the run.

### Hosts

A host is a thin adapter to an agent that already exists
(`AgentHost` in `packages/core/src/evals/hosts.ts`): it gets the trial
directory, the instruction, the tools the case allows and the budget, and
returns how the run ended, the agent's final answer, turns, time and cost.
The interface names no agent; a new host is one object with `probe` and
`run`, and may name the skill host it discovers skills from.

**scripted** replays the case's known-good `solution` steps. It tests the
harness and the cases themselves, deterministically and at no cost: a case
whose solution does not pass its own graders is broken.

**claude-code** runs Claude Code headless in the trial directory:

```sh
claude -p "<instruction>" --output-format stream-json --verbose \
  --max-turns <turns> --max-budget-usd <usd> \
  --tools Skill,Read,Glob,Grep,Edit,Write,Bash \
  --permission-mode dontAsk \
  --allowedTools "Skill,Read(//<trial>/**),Edit(//<trial>/**),Write(//<trial>/**),Bash(npx protoboard *)" \
  --disallowedTools "Edit(//<trial>/node_modules/**),Write(//<trial>/node_modules/**),Edit(//<mirror>/**),Write(//<mirror>/**),Bash(*--cwd*),Bash(*..*)" \
  --add-dir <mirror> \
  --strict-mcp-config --mcp-config '{"mcpServers":{}}' \
  --setting-sources project --no-session-persistence \
  --append-system-prompt "<nobody answers questions; summarize at the end>"
```

- Only the built-in tools the case needs exist in the session, and
  `dontAsk` denies anything the allow rules do not cover, so nothing waits
  for a person. Permissions are never bypassed.
- Reads (Read, Glob, Grep) reach the trial directory and the module mirror
  (`--add-dir`, so the skills' scripts and references under
  `node_modules/` can be read) and nothing else: a Read of an absolute path
  outside them is denied, and so is `cat` of one, even where a case allows
  `cat *`. Edits reach the trial directory outside `node_modules`.
- The Read, Edit and Write rules name the trial directory's absolute path
  (`//<trial>/**`, and its real path too where it has a symbolic link in it,
  as macOS's `/var`). Rules on `./**` follow the session's working
  directory: in the baseline, after an allowed `cd` into the module mirror,
  writes to the trial were denied and `./**` pointed into the mirror (only
  the mirror's deny rule kept it out). A probe session (Claude Code 2.1.288,
  2026-10-03) confirmed the absolute rules: after `cd` into the mirror, a
  Write and an Edit by absolute path in the trial were allowed, and a Write
  into the mirror, into the trial's `node_modules` and to a relative path
  (which then named the mirror) were denied.
- Shell commands are the case's `commands` patterns only, and none may name
  `--cwd` (another project directory) or `..` (a path that climbs out of the
  copy). Cases allow `npx tsx` only for the extension's own scripts
  (`npx tsx node_modules/@protoboardai/ext-parts/scripts/*`), never any file.
  We checked these rules against Claude Code 2.1.288 with a small probe
  session: the outside reads, `cat` of an outside path, a `..` path, the
  `--cwd` commands and a write into `node_modules` were all denied, and
  reads through the `node_modules` link worked.
- Claude Code's own sandbox (`sandbox.enabled` in `--settings`) would add an
  operating-system boundary for shell commands. It needs bubblewrap and
  socat on Linux and unprivileged user namespaces; on the machine the
  baseline ran on, socat is missing and AppArmor refuses the namespaces, so
  the host does not turn it on.
- No MCP server is started (the person running the evals may have servers
  that act on real accounts), and user and local settings files (hooks,
  permission rules) are not read.
- The transcript (stream-json) is saved next to the scorecard; the turns,
  cost and model come from it. The runner stops the process when the case's
  `seconds` run out.
- It needs `claude` on the PATH (or `PROTOBOARD_EVAL_CLAUDE`) signed in, or
  `ANTHROPIC_API_KEY`. `probe` checks `claude --version` and
  `claude auth status` before anything runs.
- Known gap: skills from the user's own `~/.claude/skills` and installed
  plugins are still listed in the session (`--setting-sources` does not hide
  them). They did not come up in the runs so far. A clean baseline needs a
  separate config directory or `--bare` with an API key; see "Next".

Real hosts cost money and vary from run to run. CI runs the scripted host
only.

### The ablation arm

`--no-skills` runs the same cases without the stack's skills, to measure what
the skills add:

- no `protoboard skills export` in the trial, so `.claude/skills/` stays
  empty;
- the module mirror leaves out every `.md` under a linked package's
  `skills/` (each SKILL.md and its references, in the stack's extensions and
  in UHD), so an agent can neither be given them nor find them by reading
  `node_modules`, and `protoboard skills export` in the trial finds none.
  The skills' scripts stay: they are tools the instructions may name;
- the claude-code host starts the session without the Skill tool, so the
  user's own skills and plugins (the known gap above) are not listed either.

The project's own documents (`AGENTS.md`, `README.md`, `docs/`) stay: they
are part of the project, as a user would have them. The scorecard records
`skills: "none"`, and the summary says it is the ablation arm.

### Scorecards

`.protoboard/evals/<run>/` under the project (or the directory evals run
from, or `--out-dir`) holds `scorecard.json` (`protoboard.eval-scorecard/v0`), `summary.md`
and one transcript per trial (`<extension>--<case>/trial-<n>.jsonl`).
`.protoboard/evals/latest.json` and `latest.md` are the last run. The folder
is ignored by git.

Per case: status (`ran`, `skipped`, `error` with the reason), the fixture's
build time and seeded codes, and per trial the host's outcome (status,
answer, turns, time, cost, model), what the guard found changed outside the
copy (`outside`, for hosts that are not trusted), every grader's result, the trial's score
(the weighted mean of the graders that ran) and whether it passed (every
grader that ran passed). Per case and in total: pass rate, mean score, mean
time and turns, cost.

### CI

`scripts/ci-stack.sh` runs `protoboard evals --ci` at the repository root as
its own step, after the tests (which then skip the same cases with
`PROTOBOARD_SKIP_EVAL_CASES=1`). On GitHub Actions the summary is added to the
job summary. Without `--with-cad` the CAD cases are skipped, and so is the
datasheet case where Chrome is missing; the circuit case runs (its packages
are npm dependencies).

## Writing a case

A case is a folder `evals/<case>/` in the extension, with `case.json`, or
`case.ts` whose default export is a `defineEvalCase({...})` (for a recipe
written in code). Add `evals` to the package's `files`.

```json
{
  "schema": "protoboard.eval-case/v0",
  "title": "Find and fix a GNSS lead soldered with RX and TX swapped",
  "skills": ["system-compose", "system-review"],
  "fixture": {
    "from": "../../../../examples/quadcopter-5in",
    "exclude": ["docs"],
    "steps": [{ "replace": { "file": "src/quadcopter.uhd.ts", "find": "p2: \"fc:uart1_tx\", p3: \"fc:uart1_rx\"", "with": "p2: \"fc:uart1_rx\", p3: \"fc:uart1_tx\"", "count": 1 } }]
  },
  "instruction": "`npx protoboard check` reports an error on this quadcopter since the GNSS lead was re-soldered …",
  "tools": { "read": true, "edit": true, "commands": ["npx protoboard *", "npx tsx node_modules/@protoboardai/ext-hardware/skills/*"] },
  "budget": { "turns": 20, "seconds": 600, "usd": 2 },
  "graders": [
    { "id": "fault-fixed-and-named", "kind": "fault", "code": "UHD_LINK_STATE", "caught": "(rx|tx)[^.]*(swap|revers|cross)" },
    { "id": "check-clean", "kind": "check", "maxErrors": 0 },
    { "id": "gnss-part-untouched", "kind": "digest", "file": "parts/catalog/matek-m9n-5883.json", "changed": false }
  ],
  "solution": [
    { "replace": { "file": "src/quadcopter.uhd.ts", "find": "p2: \"fc:uart1_rx\", p3: \"fc:uart1_tx\"", "with": "p2: \"fc:uart1_tx\", p3: \"fc:uart1_rx\"" } },
    { "protoboard": ["check"] },
    { "say": "The GNSS lead's RX and TX were swapped on the UART1 pads; …" }
  ]
}
```

| Key | Meaning |
| --- | --- |
| `title`, `skills`, `tags` | What the case exercises, for reading a scorecard |
| `fixture.from` | A project folder to copy, relative to the case folder. `node_modules`, `.claude/skills` and `.protoboard/{build,cache,tools,evals,local}` are never copied, and `operations/` only with `fixture.operations`; `exclude` adds paths. A `tsconfig.json` that extends a relative path is pointed at the absolute one. |
| `fixture.operations` | `true` copies the project's operation records (`operations/`) too. A fixture starts with no history by default; a case whose graders or skills need the records of the generated outputs (a release, a stale or edited output) says so here. |
| `fixture.recipe` | case.ts: `(dir, ctx) => …` after the copy; case.json: `"./recipe.ts#build"`. It may run steps itself (`runSteps(steps, ctx)`). |
| `fixture.steps` | Seeding steps, applied last: the moved part, the swapped wires |
| `instruction` | What a user would ask. Say what done looks like (check clean, outputs fresh) and what must not change; do not give away the fix. |
| `tools` | `read`, `edit` (default true), `commands`: shell patterns with `*` (default `npx protoboard *`). Allow scripts by path (`npx tsx node_modules/@protoboardai/<ext>/scripts/*`), never `npx tsx *`: with Write, that is any code. |
| `budget` | `turns`, `seconds` (for the whole trial, the scripted host's steps included), and `usd` where the host can enforce it |
| `requires` | Tool ids an installed extension declares (`python-build123d`, `tscircuit-node`, `chrome`, `poppler`); the case is skipped without them |
| `graders` | Below |
| `solution` | The known-good steps; the scripted host replays them |

### Steps

One vocabulary for seeding and for solutions. Paths are relative to the
project and may not leave it; `from` paths are relative to the case folder.

| Step | Does |
| --- | --- |
| `{ "protoboard": [args], "expect": { "exit", "status" } }` | The CLI in the project, with `--format json`; `exit` defaults to 0, `status` checks an operation record (`succeeded`) |
| `{ "command": [argv], "expect": { "exit" } }` | Any command in the project (`{node}` is the running Node) |
| `{ "replace": { "file", "find", "with", "count" } }` | Text replacement that must match (`count` times when given) |
| `{ "write": { "file", "content" \| "from" } }` | Write a file |
| `{ "copy": { "from", "to" } }` | Copy from the case folder |
| `{ "remove": "path" }` | Delete |
| `{ "json": { "file", "set": { "a.b.0": value } } }` | Set values in a JSON file |
| `{ "say": "text" }` | The scripted host's final answer |

A failing step stops the sequence; the error and every result so far are
recorded.

### Graders

Deterministic first. Each has an optional `id`, `description` and `weight`
(default 1). A trial passes when every grader that ran passed.

| Kind | Passes when |
| --- | --- |
| `check` | `protoboard check` has at most `maxErrors` errors (default 0) and `maxWarnings` warnings, none of the `absent` codes, all of the `present` codes, and the `ran` validators ran. `diagnostics` picks diagnostics by `code`, `severity`, `subject` (a regular expression on the entity: `video_power` or `link:video_power`) and `message` (a regular expression), each `present` (default) or `present: false`. One check run per trial is shared by every grader. |
| `operation` | `protoboard run <run…>` ends with `status` (default `succeeded`); `data` facts hold on the record's data. Runs after the agent; an operation that writes changes the project for later graders. |
| `files` | Every `exist` path exists and no `absent` path does |
| `outputs` | The module's standard outputs are present and valid: core's validators (`protoboard/standard-outputs`), and the module was exported |
| `format` | One file passes core's format check: `step`, `glb`, `stl`, `3mf`, `dxf`, `gerber`, `excellon`, `manifest`, plus `json` and `pdf` |
| `digest` | The file `changed: true` (differs from the fixture: it was regenerated), `changed: false` (identical: it was not touched), `equals` a sha256, or is the `sameAs` another project file (a reference an `operation` grader just wrote) |
| `facts` | Reference values hold in a JSON `file`, the JSON a `protoboard` command prints, or a `definition` as the project loads it |
| `fault` | The seeded `code` is gone after the trial (`fixed`, default true) and the answer matches `caught` (a regular expression, case-insensitive) when given. Before any trial, the fixture's check must show every `seeded` code (default `[code]`). `subject` and `message` narrow `code` to one diagnostic, before and after: two faults with one code are two graders. A hidden seed (one check does not report) lists what check does show in `seeded`, or `seeded: []`. |
| `text` | A project `file`, or the agent's answer when no file is named, matches every `matches` and none of the `notMatches` (case-insensitive) |
| `script` | An extension's script, run in the project after the agent: `node --import tsx node_modules/<extension>/<script> <args…>` (`extension` defaults to the case's own). Its `exit` code when given, `matches` and `notMatches` on its output, and `facts` on its output parsed as JSON. For what a skill's script reports (the fault scenarios caught, a stack-up). |
| `rubric` | An LLM judge scores the `files` (and the answer) against the written `rubric`, 0 to 1, pass at `threshold` (default 0.7). A folder gives every file under it. Files are read whole (up to 2 000 000 characters each; binary files are named, not shown), and the judge's reasons are kept whole in the scorecard and the summary. The claude-code judge reads up to 300 000 characters in one call; past that it reads the files in parts (a long file in numbered parts, cut at line ends), writes notes per criterion on each part, and gives the verdict on the notes. Skipped unless `--judge`. |

Fact paths: `a.b.0.c`, and `[key=value]` to pick an array element:
`offers[supplier=Distributor A].price_breaks[quantity=100].unit_price`,
`interfaces[pin=5].protocols[type=power].roles`,
`values[q=derived:mass.all_up].text`; `[key~=pattern]` picks the first element
whose key matches a case-insensitive regular expression, for names the agent
writes its own way (`offers[supplier~=^Marketplace C\b].authorized` also finds
"Marketplace C (independent seller)"). A fact checks `equals`, `approx` with
`tolerance` (element-wise for arrays), `min`, `max`, `matches`, `includes`,
`length`, or `exists: false`; a fact with none of them only requires the path
to resolve.

### What makes a case good

- **The seed is verified.** A `fault` grader makes the runner prove the fault
  shows before any agent sees it.
- **Doing nothing fails.** The tests run every shipped case twice: with an
  agent that does nothing, which must fail, and with the solution, which must
  pass.
- **Shortcuts fail.** If the fault can be cleared by undoing the change you
  asked for, grade that the change is kept (`text` or `facts` on the model).
  If a file is a given (a purchased part, the board the enclosure must fit),
  grade it unchanged with `digest`. If outputs must be regenerated, grade
  the digest changed and the outputs valid.
- **The answer matters where judgment does.** `caught` and `text` graders on
  the answer check that the agent says what it found (the swapped nets, the
  single-source risk), not only that a file changed.
- **Fixtures are fictional or ours.** Suppliers, datasheets and CAD in
  fixtures are fictional (ACME) or the stack's own examples; no credentials,
  no network.

## The suites

| Case | The agent must | Graders | Needs | Scripted |
| --- | --- | --- | --- | --- |
| `ext-hardware/fix-gnss-uart-swap` | Find and fix the GNSS lead's RX/TX swapped on the FC pads, and say what it was | fault (`UHD_LINK_STATE`, named), check, the pads restored, catalog parts unchanged | — | 1 s |
| `ext-parts/author-ldo-regulator` | Author a fictional ACME LDO from datasheet text and vendor CAD, with evidence, and pass `part-verify` | fault (`PB_UNRESOLVED_DEFINITION`), `part-verify`, check, pins and package as facts on the loaded definition, sources with sha256 and licence, rubric | — | 1 s |
| `ext-sourcing/record-ldo-offers` | Record offers and lifecycle from saved pages honestly: keep the marketplace unauthorized, the bulk code apart, the single-source warning standing, no invented acceptance | check (with `SRC_SINGLE_SOURCE` present), 12 facts, the risk stated in the answer, rubric | — | 1 s |
| `ext-drone/gps-moved-to-uart3` | Bring the Betaflight configuration up to date after the GPS moved to UART3 | the serial lines, `cli.txt` identical to the generator's output for the model, the answer, the model untouched | — | 1 s |
| `ext-frame-cad/regenerate-after-vtx-move` | Regenerate, export and re-bind the frame after the VTX mount moved 5 mm, keeping the move | fault (`FRAME_CAD_FRAME_MISMATCH`), check, outputs, STEP regenerated, DXF valid, the move kept, the top plate and cables untouched | `python-build123d` | 14 s |
| `ext-harness-cad/reroute-after-vtx-move` | Re-route the DJI cable whose socket moved (the frame already regenerated) | fault (`HARNESS_ROUTE_STALE`), check, outputs, route and body regenerated, model and other cables untouched | `python-build123d` | 41 s (+15 s fixture) |
| `ext-tscircuit/catch-swapped-nets` | Rebuild a hand-edited board, name the swapped nets (SDA/SCL on the BMI270), restore the board | fault (`CIRCUIT_STALE`, nets named), location, check, outputs, netlist facts, source restored, model untouched, the clean netlist again | `tscircuit-node` | 88 s (+45 s fixture) |
| `ext-enclosure-cad/fit-grown-board` | Make the case fit a board that grew 2 mm, without touching the board | fault (`ENCLOSURE_NOT_CONTAINED`), check, outputs, STL and 3MF valid, body regenerated, board unchanged, fit report facts | `python-build123d` | 31 s (+25 s fixture) |
| `ext-docs/build-datasheet` | Build and verify the datasheet only, and read two figures from it | files, PDF, `tech-docs-verify`, bound values, the answer, the assembly guide untouched, rubric | `chrome`, `poppler` | 14 s |
| `ext-hardware/compose-probe-cable` | Compose the smart bottle's temperature probe through its cable to the board's probe pads (both links removed), keeping the probe's fault scenario working | fault (`UHD_UNPOWERED`, with `HARNESS_ROUTE_STALE` seeded), check (no link error, nothing stale), the links through the cable, the scenario's link id, the scenarios script (the probe's fault caught, nominal clean), board, harnesses, scenarios and probe part untouched | `python-build123d` | 28 s |
| `ext-hardware/e2e-desk-rover` | **End to end**: from a brief and three vendored catalog parts to a composed system, a requirement trace and release 0.1.0 | fault (`PB_ROOT_NOT_FOUND`), check, the three agreed parts, the shield and sensor powered, package files, manifest, BOM MPNs, the bus scan (0x29, 0x60) in the test plan, the trace in `docs/decisions.md`, brief and parts untouched, rubric | `chrome` | 5 s |
| `ext-tscircuit/generate-imu-board` | Generate and export a board that was never built, after catching a fault in its model (the SCL pull-up's second pin on no net) | fault (`UHD_BUS_PULLUP`, named), check (built, current, nets match), outputs, STEP, manifest, netlist facts (r4 on SCL), the resistor kept, the constraints untouched | `tscircuit-node` | 44 s |
| `ext-esp-idf/wake-on-fuel-gauge` | Generate and export the bottle cap's ESP-IDF configuration when the requested wake source (the fuel gauge's alert on IO6) cannot wake the chip and the board is fixed | fault (`FW_WAKE_INVALID`, explained), check, outputs, firmware manifest, the wake mask, board and circuit outputs untouched | — | 17 s |
| `ext-zephyr/haptic-driver-mode` | Generate and export the watch's Zephyr board definition when the DRV2605 binding needs `actuator-mode`, which no part states (the actuator is an LRA) | fault (`FW_PROPERTY_MISSING`, named), check, outputs, `actuator-mode = "LRA"` in the devicetree, wake sources kept, manifest, board, driver part and circuit outputs untouched | — | 18 s |
| `ext-release/release-after-hand-edit` | Cut smart-bottle 0.1.1 when the board's generated BOM was edited by hand: re-export (which can make the enclosure stale), regenerate, release, inspect | package files, PDF, manifest facts, the BOM as exported (sha256), the MPN in the package, the blocker named, model and configs untouched, rubric | `chrome`, `python-build123d`, `tscircuit-node` | 141 s |
| `ext-hardware/find-reversed-cell-leads` | **Harder, hidden seed**: find the smart bottle's cell leads soldered the wrong way round, with the scenario that names them taken out; check reports `UHD_LINK_STATE` on the BAT pads beside the battery leads' route being stale, and regenerating the route would hide the stale route only | fault (`UHD_LINK_STATE` on the BAT pads, the reversal named; seeded: the stale route; the `cell-leads-reversed` scenario and `docs/` taken out of the fixture), check (no stale battery route, no link error on the BAT pads), the compose restored (facts on the loaded model), the scenarios script (nominal clean, the other faults caught), route, board, harnesses and scenarios untouched | — | 11 s |
| `ext-hardware/fix-two-wiring-faults` | **Harder, two faults at once**: the quadcopter's O4 powered straight from the pack (the 3-in-1 cable's VCC cut) and the GNSS RX and TX swapped, both `UHD_LINK_STATE`; the two matching scenarios and `docs/` are taken out of the fixture | two fault graders narrowed by subject (each fixed and named), check (no stale route, no O4 or UART1 error), the wiring as designed (facts on the loaded model: no lead to the pack, every cable position mated, TX1 and RX1), the scenarios script (exit 0), harnesses, scenarios and parts untouched | — | 3 s |

A fixture copied from an example leaves out `operations/` unless the case
sets `fixture.operations` (the release case does). `digest` `equals` takes the digest as core writes it, `sha256:<hex>`.

The whole set, scripted and idle, takes about 6 minutes with every tool
present (`packages/core/test/evals.test.ts`). The cases built on the
quadcopter, and the circuit and enclosure cases (whose fixtures come from
the extensions' tests), run in this workspace; a published extension
package does not carry those fixtures yet.

## Baseline

### EV6: new and changed cases, and the ablation (2026-10-03)

Claude Code 2.1.288, `claude-opus-5-5`, three trials per case with the rubric judge, the EV6 harness,
and a clean detached checkout. The analysis is in
[`docs/evals/2026-10-03-ev6-analysis.md`](../evals/2026-10-03-ev6-analysis.md).

- **New and changed cases: 15 of 15 trials passed, mean score 1.00, $7.52**
  ([scorecard](../evals/2026-10-03-ev6-claude-code-new-and-changed.json)). The cases were the two harder
  variants, the probe cable with its scenarios grader, the release with `fixture.operations`, and the
  datasheet.
  - The datasheet's first run failed 0 of 3: now that the judge read `values.json` whole, it found the `gap`
    status the uhd-tech-docs skill prescribes, which the rubric did not allow. With the rubric fixed, it passed
    3 of 3.
  - Both harder variants passed 3 of 3. Their seeds were also scenarios in `src/scenarios.ts`, which the agents
    compared against. Their fixtures now take those scenarios out (and leave out `docs/`), and a rerun
    passed 6 of 6 again, $1.85 ([scorecard](../evals/2026-10-03-ev6-claude-code-harder-scenarios-hidden.json)):
    the agents traced the lead's pin order and read the stale route and check's errors. The next variants need
    a fault none of those show.
- **Ablation, on `fix-gnss-uart-swap`, `author-ldo-regulator` and `record-ldo-offers`:** 8 of 9 trials passed
  without the skills ($6.71), and 9 of 9 with them under the same harness ($7.90).
  - The GNSS case does not use its skills.
  - In authoring, one trial without the skills missed the conventions the skill's checklist asks for (an
    assumption trait, digests and licences on the CAD), and the rubric caught it.
  - Sourcing took 46 s with the skills and 68 s without them.

### Every case, three trials (2026-10-03)

Claude Code 2.1.288, `claude-opus-5-5` (the account's default model; the
harness's `--model` was not needed, the whole run cost $34), `--host
claude-code --judge claude-code --trials 3`, under the module mirror and the
guard, from a clean detached checkout of this branch so edits elsewhere could
not trip the guard. The runner takes one case pattern, so the 15 cases ran as
15 processes, four at a time, and their scorecards were merged.

**44 of 45 trials passed (98 %), mean score 1.00, $34.16.** The guard found
nothing changed outside any trial's copy. Scorecard:
[`docs/evals/2026-10-03-claude-code-baseline.json`](../evals/2026-10-03-claude-code-baseline.json)
(summary: [`.md`](../evals/2026-10-03-claude-code-baseline.md)).

| Case | Pass | Score | Mean time | Turns | Cost (3 trials) |
| --- | --- | --- | --- | --- | --- |
| `ext-docs/build-datasheet` | 2/3 | 0.96 | 66 s | 20.7 | $1.15 |
| `ext-drone/gps-moved-to-uart3` | 3/3 | 1.00 | 36 s | 11.7 | $0.87 |
| `ext-enclosure-cad/fit-grown-board` | 3/3 | 1.00 | 58 s | 8.7 | $0.75 |
| `ext-esp-idf/wake-on-fuel-gauge` | 3/3 | 1.00 | 64 s | 14.7 | $1.12 |
| `ext-frame-cad/regenerate-after-vtx-move` | 3/3 | 1.00 | 53 s | 10.7 | $0.94 |
| `ext-hardware/compose-probe-cable` | 3/3 | 1.00 | 113 s | 17.7 | $1.88 |
| `ext-hardware/e2e-desk-rover` | 3/3 | 0.99 | 515 s | 89 | $13.18 |
| `ext-hardware/fix-gnss-uart-swap` | 3/3 | 1.00 | 22 s | 6 | $0.66 |
| `ext-harness-cad/reroute-after-vtx-move` | 3/3 | 1.00 | 350 s | 7.7 | $0.67 |
| `ext-parts/author-ldo-regulator` | 3/3 | 0.98 | 195 s | 40.3 | $5.25 |
| `ext-release/release-after-hand-edit` | 3/3 | 1.00 | 301 s | 32 | $2.31 |
| `ext-sourcing/record-ldo-offers` | 3/3 | 1.00 | 48 s | 19 | $1.03 |
| `ext-tscircuit/catch-swapped-nets` | 3/3 | 1.00 | 167 s | 15.7 | $1.41 |
| `ext-tscircuit/generate-imu-board` | 3/3 | 1.00 | 109 s | 15 | $1.29 |
| `ext-zephyr/haptic-driver-mode` | 3/3 | 1.00 | 100 s | 20.7 | $1.65 |

The first run of all 15 cases passed 38 of 45
([`…-first-run.json`](../evals/2026-10-03-claude-code-baseline-first-run.json)).
Every failure in it was a grader defect, not the agent: the sourcing case's
facts picked offers by the exact supplier name, and every agent wrote
"Marketplace C (independent seller)" with the right facts; the end-to-end
case required exactly three children, and every agent added the sensor lead
as a harness module, as **harness-author** asks. The graders were fixed (the
`[key~=pattern]` selector; the children are graded by part, the rubric
allows a harness) and those two cases ran three trials again; the table
above is the first run with those two cases replaced.

The one failure left is a rubric: the datasheet judge scored 0.6 on a
`values.json` the grader cut at 60 000 characters, and the two passing
trials were marked down for the generator's own unit fields (thrust shown in
kg with unit `g`, KV with unit `V`, a baud rate in `Hz`), which the agent
cannot change.

What the agents did well: every seeded fault was found and named, no trial
edited a generated file, part, or the board it was told to keep, the release
case's agents all found the second blocker (the re-exported board body made
the enclosure stale) and regenerated it, and both firmware cases took the
decision the project's own `docs/decisions.md` records. What they reported
that the stack gets wrong became follow-ups (tool bugs and skill gaps); among them: the release test plan's power-up rows for inputs
that are meant to stay unconnected, a `cut-list.csv` the work order names and
the package lacks, the smart bottle's `cell-leads-reversed` scenario no
longer caught, and the example docs' `../../node_modules` script paths.

Costs and times vary from run to run; most of the spread is in turns spent on
shell lines the allow rules deny (compound `cd …; grep …` lines and inline
scripts), after which the agents go on with Read and Grep.

### The first run of one case

One real Claude Code run, 2026-10-03: `ext-hardware/fix-gnss-uart-swap`,
Claude Code 2.1.288, `claude-opus-5-5`, one trial. It passed every grader in
10 turns, 25 s, $0.28: it ran `check`, read the GNSS lead's harness
definition, searched the GNSS module's definition for its pinout, crossed the
two pads in the `gnss_pads` link, re-ran check and the fault scenarios
script, and named the fault. One shell line that chained `sed`, `grep` and
`ls` was denied by the allow rules, and it went on with Read and Grep. The scorecard is
[`docs/evals/2026-10-03-claude-code-fix-gnss-uart-swap.json`](../evals/2026-10-03-claude-code-fix-gnss-uart-swap.json).

That run predates the module mirror and the guard: its `node_modules` was a
link to the workspace, where the unseeded quadcopter and every case's
solution could be read. The same case ran again after the change (same
version and model): it passed every grader in 9 turns, 23 s, $0.28, the
guard found nothing changed outside the copy, and the only denial was one
shell line that mixed `sed`, `grep` and an inline Python script; it went on
with Read and Grep. The scorecard is
[`docs/evals/2026-10-03-claude-code-fix-gnss-uart-swap-mirror.json`](../evals/2026-10-03-claude-code-fix-gnss-uart-swap-mirror.json).

## Claude Code's plugin evals

`claude plugin eval` (Claude Code 2.1.288) runs eval cases against a Claude
Code plugin: `evals/<case>/case.yaml`, or `prompt.md` with
`graders/*.md`; `max_turns`, `timeout_seconds` and allowed tools per case; a
`scaffold_script` (bash, run only with `--scaffold`) to set up the workspace;
graders `regex`, `tool_order`, `tool_used`, `file_exists`, `llm` and
`baseline`; repeated runs, a with/without-plugin ablation, and an HTML
report. What we took from it: the same budget fields (turns, seconds, allowed
tools per case), weighted graders, a judge for rubrics, deterministic graders
first.

What it does not fit, so it is not the runner or the format here:

- It evaluates a Claude Code plugin; our skills are installed by npm and
  exported per project, and the hosts must be agent-agnostic.
- Its fixtures are a bash scaffold; ours are a project copied, linked to the
  workspace and seeded, with the seed proved before any trial.
- Its graders cannot run `protoboard check`, read an operation record, apply
  core's standard-output validators, compare digests against the fixture or
  read facts from the loaded model.

It could become a host or an export later: write each case as a
`case.yaml` whose scaffold is `protoboard evals --keep`'s fixture and whose
graders call back into `protoboard evals` for grading; the ablation (skills
exported or not) is the comparison worth having.

## Next

- More cases per extension (EV3), and more harder variants like the two
  above for the cases that pass 3/3.
- A clean Claude Code environment for baselines: a separate config
  directory, or `--bare` with an API key, so user skills and plugins are not
  visible.
- An operating-system boundary for real-agent trials where the machine
  allows it: Claude Code's sandbox (bubblewrap and socat, writes only in the
  trial directory, reads denied for the workspace), or the whole `claude`
  process in a container. The guard would then catch only what the sandbox
  missed.
- Other hosts (Codex, OpenCode) as one adapter each.
- Fixtures that travel with a published package (a quadcopter template
  package, the test fixtures packed), so the suites run outside this
  workspace.
