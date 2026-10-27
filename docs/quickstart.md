# Quickstart

From nothing to a checked, viewed and released hardware project with
Protoboard Stack 0.2.

What you get at each step is shown from the three reference projects
(`examples/quadcopter-5in`, `examples/wearable-watch`, `examples/smart-bottle`).
The [CLI reference](reference/cli.md) lists every command and flag; the
[reference index](reference/README.md) has the rest.

## 1. Install

**To use Protoboard**, install the **Protoboard** extension in VS Code
(Visual Studio Marketplace), Cursor or Windsurf (Open VSX): it carries the
whole stack and gives your terminals the `protoboard` command. Or install the
command line alone (Node.js 22 or later):

```sh
npm i -g @protoboardai/cli
protoboard --version          # 0.2.0
protoboard agents setup       # connect your agents (optional)
```

The [installation guide](guides/installation.md) covers each operating
system and agent. The optional tools are Python 3.12 (CAD), Google Chrome
(documents and the Manufacturing Package) and poppler-utils (document
checks).

**To work on the stack itself**, clone it beside UHD and the viewer (see
[CI](ci.md) and [CONTRIBUTING.md](../CONTRIBUTING.md)):

```sh
mkdir ~/src && cd ~/src
git clone https://github.com/Delta-Robotics-Inc/uhd.git
git clone https://github.com/Delta-Robotics-Inc/uhd-viewer.git
git clone https://github.com/Delta-Robotics-Inc/protoboard-stack.git
(cd uhd && npm install && npm run build)
(cd uhd-viewer && npm install && npm run build)    # the viewer `protoboard dev` serves
cd protoboard-stack && npm install
npx protoboard --version                           # 0.2.0
```

Inside the repository, `npx protoboard` runs the CLI from the workspace;
every example project under `examples/` uses it, and the packages are linked
to each other, so edits are live. To try the packages as a user installs
them, publish them to a registry on your own machine first ([local
registry](guides/local-registry.md)).

## 2. Create a project

### From a template

`protoboard init <dir> --template drone|wearable|iot` starts from a template
derived from a reference project: `protoboard.config.ts` with its
extensions, `package.json` (the stack's packages by version, and a
`postinstall` that exports the extensions' skills), `AGENTS.md`, `docs/brief.md`, the folder layout
(`src/boards`, `src/enclosures`, `src/harnesses`, `parts/catalog`,
`parts/local`, `parts/evidence`) and a small system that checks with no
errors and no warnings. `protoboard init --list` describes them.

| Template | Derived from | Starting system | Extensions |
| --- | --- | --- | --- |
| `drone` | `examples/quadcopter-5in` | F405 V3 + AM32 60A stack, 6S pack on its XT60 lead, ELRS receiver on UART2 | hardware, parts, docs, drone, frame-cad, harness-cad, release |
| `wearable` | `examples/wearable-watch` | nRF52840 main board (tscircuit, Zephyr) on a 200 mAh cell | hardware, parts, tscircuit, zephyr, enclosure-cad, harness-cad, docs, release |
| `iot` | `examples/smart-bottle` | ESP32-C3 main board (tscircuit, ESP-IDF) on a 1000 mAh cell | hardware, parts, tscircuit, esp-idf, enclosure-cad, harness-cad, frame-cad, docs, release |

`init` vendors the template's catalog parts at their pinned revisions from
the parts service (`--url`, then `PROTOBOARD_CLOUD_URL`, then `--local`'s
http://localhost:8787, else the hosted Protoboard library) and
writes that URL into the project's `cloud.url`. The hosted library needs a
sign-in first (`protoboard login`; [guides/installation.md](guides/installation.md));
signed out, `init` makes the project and says how to add the parts later.
`--no-parts` skips that and prints the `protoboard parts add` command to run
later. Run from the registry, or with `--registry <url>`, `init` also writes
the project's `.npmrc` for the two scopes.

```sh
mkdir ~/projects && cd ~/projects
protoboard login                                   # the template's library parts need an account
protoboard init my-drone --template drone
cd my-drone
protoboard check && protoboard build
```

`npm install` ends by exporting the skills of the project's extensions: they
are in `.claude/skills/` (ignored by git: they are copies of the installed
packages) and listed at the end of `AGENTS.md` (committed), whose first
lines tell an agent where to start. `init` cannot do this itself, because
the skills are read from the installed packages. `npm run skills:export`
does it again after an extension is added; `init --no-skills` leaves the
`postinstall` out.

Board outputs (`out/`, `tscircuit/board.gen.tsx`, Zephyr and ESP-IDF files)
are not in the templates: generate them with `protoboard run
circuit:generate --module main-board`, `circuit:export` and
`firmware:generate`.

### An empty project

```sh
npx protoboard init my-device
```

```text
Created /home/you/my-device
  package.json
  protoboard.config.ts
  src/my-device.uhd.ts
  parts/origins.json
  parts/catalog/.gitkeep
  parts/local/.gitkeep
  parts/evidence/.gitkeep
  docs/brief.md
  docs/decisions.md
  .gitignore
  AGENTS.md

Next: npm install, then `protoboard check`.
```

`package.json` depends on `@deltarobotics/uhd`, `@protoboardai/core` and
`@protoboardai/cli` by version, so `npm install` needs the registry (step 1):
add the scope lines to the project's `.npmrc` or to `~/.npmrc`. The
[configuration reference](reference/configuration.md) explains each file.

## 3. Check

`check` loads the project, resolves every definition and runs every validator
it can: Protoboard's (registry, artifacts, extensions, capabilities, standard
outputs), UHD's (system rules, assembly, geometry bindings) and each
extension's and provider's check. Exit code 1 on any error.

```sh
cd examples/quadcopter-5in
npx protoboard check                 # warnings and errors; --severity info for everything
npx protoboard check --format json   # { checks, diagnostics }
```

```text
WARNING UHD_PROPULSION_CURRENT  4 motors can peak at 171.88 A together, above the battery continuous rating 110 A but within its burst rating 220 A. …
        at src/quadcopter.uhd.ts:96  [uhd/checkSystem]

✓ protoboard/registry
✓ protoboard/resolve
…
✓ ext:@protoboardai/ext-frame-cad/cad:check [quadcopter-5in-top-plate]
0 error(s), 1 warning(s), 14 info
```

| Project | Result | Warnings |
| --- | --- | --- |
| quadcopter-5in | 0 errors, 1 warning, 14 info | `UHD_PROPULSION_CURRENT` (accepted: burst rating, `docs/decisions.md`) |
| wearable-watch | 0 errors, 1 warning, 19 info | `HARNESS_ROUTE_WARNING` on `battery_leads` (slack loop not laid clear by 0.15 mm) |
| smart-bottle | 0 errors, 2 warnings, 15 info | `FW_STRAPPING_PIN` ×2 (I2C on IO8 and IO2: pull-ups hold them high at reset, as boot needs) |

Every code is explained, with what to do, in the
[diagnostic codes reference](../packages/ext-hardware/skills/system-compose/references/diagnostic-codes.md).
A check marked `–` was skipped (a tool missing, an upstream error): its
result is unknown, not passed.

Other read-only views of the same model:

```sh
npx protoboard inspect                 # the system: instances, definitions by tier, links, checks
npx protoboard inspect arm_fl/motor    # one instance: definition, origin and revision, interfaces, links, artifacts
npx protoboard artifacts arm_fl/motor  # its files and where each resolves
npx protoboard build                   # .protoboard/build/resolved.json and uhd-bundle.json (byte-stable)
npx protoboard doctor                  # extensions, tools, runtimes, skills
```

## 4. `protoboard dev`: the viewer

```sh
npx protoboard dev                 # http://127.0.0.1:5180/ (the next free port if taken)
npx protoboard dev --port 5200 --open
```

It builds the project, serves the UHD viewer on it, and rebuilds when a
source, part, `protoboard.config.ts`, scenario or display file changes (the
open page updates in place and keeps its view). Dragging modules and link
waypoints saves the diagram to `.protoboard/display.json`: commit it.
`--format json` logs one JSON line per event:

```text
{"time":"…","level":"info","event":"build","message":"built in 5.3s: 0 errors · 1 warning","ms":5350,"counts":{"error":0,"warning":1,"info":19},…}
```

While it runs, `.protoboard/local/dev.json` records the URL, port, pid and
session (editors attach to it), and `GET /__protoboard/state` returns the
session and the last build's message. It answers loopback host names only
(another `Host` gets 403) unless `--allow-host` names more. `Ctrl+C` stops
it. A port you give with `--port` must be free; without it, taken ports are
skipped. The README's "Local viewer" section has the details.

## 5. VS Code

The extension is private and installed from a `.vsix`:

```sh
cd protoboard-stack/packages/vscode-protoboard
npm install && npm run package     # dist/vscode-protoboard.vsix (12 files, about 280 KB)
code --install-extension dist/vscode-protoboard.vsix
```

Open a project folder (or the repository root: it finds every
`protoboard.config.ts`) and use the Command Palette: **Protoboard: Open
Viewer** (attaches to or starts `protoboard dev` in a panel), **Protoboard:
Check** (findings in Problems and the DRC panel), **Protoboard: Open
Artifact**, **Protoboard: Add Part…**, **Protoboard: Generate Deployment
Artifacts** (`protoboard release`). The Protoboard activity bar has the
Explorer (the system tree), the Library and Cloud views. The extension
finds a Node.js 22 or later by itself, or runs the CLI on VS Code's own
runtime; `protoboard.nodePath` names one explicitly. A `.vsix` packaged with
the stack needs nothing else installed: **Protoboard: New Project…** makes a
project that works without `npm install` (the installation guide,
[guides/installation.md](guides/installation.md), is written for that
route). No account is needed to work on a project; the Protoboard library
(searching it, adding its parts, prices, publishing) needs a sign-in
(**Protoboard: Sign In**). Everything else is in its
[README](../packages/vscode-protoboard/DEVELOPMENT.md).

## 6. The parts library

Parts come in three tiers: catalog parts vendored from a library
(`parts/catalog`, pinned by digest in `parts/origins.json`), parts researched
in the project (`parts/local`, evidence in `parts/evidence`), and modules
designed in the project (`src`). Only the `parts` and `libraries` commands
talk to a library; `check`, `build`, `dev` and `release` work offline. The
hosted Protoboard library needs a sign-in for all of them, searching
included; a library someone else hosts may sign no one in.

Signed in (`protoboard login`), in a project:


```sh
npx protoboard libraries --check              # 1. protoboard  https://… ✓ Protoboard parts library (uhd-library/v1 …)
npx protoboard parts search 2207 motor        # protoboard  meps-neon-2207-v2-1950kv@3  MEPS NEON 2207 V2 1950KV …
npx protoboard parts taxonomy                 # the parts by category
npx protoboard parts add matek-m9n-5883       # Added matek-m9n-5883@3  11 file(s)
npx protoboard parts update                   # what the library recommends; writes nothing
npx protoboard parts update hqprop-ethix-s5 --to 3   # re-pin deliberately
npx protoboard parts offers                   # vendored supplier offers into parts/offers.json (what a release quotes)
npx protoboard parts prices <id>              # one part's prices by source: supplier, price breaks, stock, link, when observed
```

`parts add` verifies every byte against its digest before writing anything.
Further libraries speak UHD's open protocol and are added with
`protoboard libraries add <id> <url>` ([library protocol](reference/library-protocol.md)).
Publishing a researched part to a library (`protoboard parts publish
<path>`) needs a publisher's account or `PROTOBOARD_CLOUD_TOKEN`; try
`--dry-run` first.

## 7. Circuit and CAD operations

Custom modules choose a tool per module with a `circuit.config.ts`,
`cad.config.ts` or `firmware.config.ts` next to them. Each provider
implements `generate` (native design), `export` (standard outputs in
`out/`), `extract` and `check`.

```sh
cd examples/wearable-watch
npx protoboard capabilities              # providers, and which module uses which
npx protoboard tools install cad         # once per checkout: a Python venv with build123d (about 1 GB of wheels)
npx protoboard run circuit:generate --module watch-main-board   # tscircuit: 49 components, 37 nets → 159 traces, 129 vias (about 90 s)
npx protoboard run circuit:export --module watch-main-board     # out/: gerber/, bom.csv, pnp.csv, board.glb, board.step, manifest, netlist, SVGs
npx protoboard run firmware:generate --module watch-main-board  # Zephyr board definition, every line citing a UHD fact
npx protoboard run firmware:export --module watch-main-board    # out/config/ and out/firmware.manifest.json
npx protoboard run cad:generate --module watch-case             # enclosure (build123d)
npx protoboard run cad:export --module watch-case               # out/: body.step, body.glb, manifest, STL and 3MF prints
```

On the quadcopter, `npx protoboard run frame-cad` and `npx protoboard run
harness-cad` regenerate every plate and cable. Every run writes an operation
record in `operations/` (`protoboard operations` lists them), which
`release` uses to prove the outputs are current. Without `tools install cad`
you can point `PROTOBOARD_PYTHON` at a Python with `build123d==0.13.0`, numpy
and scipy; `protoboard doctor` shows which one it found.

Regenerating a committed design gives the same files, apart from timing
fields (the tscircuit build record's `build_ms`).

## 8. Release

`protoboard release` writes the Manufacturing Package: everything needed to
order, make, assemble and check the product.

```sh
cd examples/quadcopter-5in
npx protoboard release --check     # SUCCEEDED  release  ready to release 0.1.0: 2 unit(s), no blocking problems
npx protoboard release             # release/0.1.0/: 2 unit(s), 11 documents (67 pages), 121 files; package e046eaaada45
```

It refuses a project with check errors, stale or hand-edited outputs, a
skipped provider check or uncommitted changes (`REL_*` codes; `--check`
reports them and writes nothing). It needs Chrome. The package is
reproducible: the same commit gives the same bytes (the date is the commit's),
so the package digest changes with every commit. Its layout and manifest are
in the [Manufacturing Package reference](reference/manufacturing-package.md).
The release never orders, uploads or prints anything.

## 9. Agents: skills and evals

```sh
npx protoboard skills                              # the skills the configured extensions ship
npx protoboard skills export --host all            # .claude/skills/<id>/SKILL.md (claude-code) and the list in AGENTS.md (agents-md)
npx protoboard evals --list                        # eval cases the extensions ship
npx protoboard evals --extension hardware --case fix-gnss-uart-swap   # replay its known-good solution (scripted host, free): 1/1 passed
```

Start an agent on **build-a-project** (ext-hardware), the top-level SOP from
a brief to a release. The [extensions and skills index](reference/extensions.md)
lists every skill, and [the evals guide](guides/evals.md) how to run cases
against Claude Code.

## Next

- [Stack 0.2 release notes](releases/stack-v0.2.md): what is in the release, its known limits, and upgrading a 0.1 project.
- [Writing a capability provider](guides/writing-a-capability-provider.md).
