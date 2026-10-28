# Local registry and project templates

The stack's packages are published to npmjs by the release workflow
([CI](../ci.md#releasing)). This guide is for trying them **as a user installs
them, before a release**: publish the workspace to a **local Verdaccio
registry** on `127.0.0.1:4873`, then install projects from it outside the
repository. Projects and the reference projects depend on **versions**
(`"@protoboardai/core": "^0.2.0"`), never on `file:../` paths; inside the
repository npm links the packages instead (dev-link mode, below).

## The packages

| Package | Repository | What ships |
| --- | --- | --- |
| `@deltarobotics/uhd` | uhd | `dist/` (built by `prepack`: `npm run build`), `src/`, schemas, skills, docs (no part library: parts come from a library service) |
| `@deltarobotics/uhd-viewer` | uhd-viewer | `dist/app`, `dist/lib` (built by `prepack`: `npm run build`), `bin/` |
| `@protoboardai/cloud` | this one, `packages/cloud` | the parts service client: `src/client.ts`, `api.ts`, `envelope.ts`, `taxonomy.ts`, `kits.ts` |
| `@protoboardai/core` | this one | `src/` and the project templates (`templates/`) |
| `@protoboardai/cli` | this one | `bin/protoboard.mjs` (`protoboard`, `pb`) and `src/` |
| `@protoboardai/ext-*` (12) | this one | `protoboard-extension.json`, `lib`, `ops`, `checks`, `py`, `skills`, `evals` as each package lists them |

The `@protoboardai` packages ship their TypeScript sources and run through tsx,
exactly as they do in the repository (there is no compile step; tsx loads
TypeScript under `node_modules` too). Each package's `exports` names the
entry points; deep imports outside them fail, as they would for a user.
`packages/vscode-protoboard` is a VS Code extension, packaged as a `.vsix`, and
is not published here.

## Running the registry

```sh
cd protoboard-stack
registry/start.sh          # Docker (container "protoboard-registry", verdaccio/verdaccio:6); else npx verdaccio@6
registry/start.sh --npx    # without Docker
registry/stop.sh           # stops it; the storage stays
PB_REGISTRY_PORT=4893 PB_REGISTRY_NAME=protoboard-registry-check registry/start.sh   # another one beside it
```

- Config: `registry/config.yaml`. Storage: `registry/storage/` (gitignored):
  the published packages, the npmjs packages proxied through it, and
  `htpasswd`. Delete the folder to start empty.
- The port is bound to `127.0.0.1` only. `PB_REGISTRY_PORT` and
  `PB_REGISTRY_NAME` change the port and the container name.
- `@protoboardai/*` and `@deltarobotics/*` are served from this registry only:
  no uplink, so they can never be fetched from (or confused with) npmjs
  (where `@deltarobotics/uhd` 0.1.0 is an older public release). Everything
  else is proxied from npmjs and cached.
- Anyone who can reach the port may publish the two scopes (a placeholder
  token satisfies npm); nothing else can be published. Verdaccio never
  forwards a publish to its uplink.

## Publishing the stack

With the four repositories side by side (as in [CI](../ci.md)) and their
dependencies installed:

```sh
node scripts/registry/publish-stack.mjs             # every package, dependencies first
node scripts/registry/publish-stack.mjs --replace   # republish versions already there (local development)
node scripts/registry/publish-stack.mjs --only @protoboardai/core,@protoboardai/cli
node scripts/registry/publish-stack.mjs --dry-run   # what each tarball would contain
```

Order: UHD, the viewer, the parts client, core, the extensions, the CLI. Each
package is packed (`npm pack`: UHD and the viewer build on pack, so their
`dist/` always matches their source), unpacked into a temporary folder and
published from it with `--ignore-scripts` and an explicit `--registry`.
A version already in the registry is skipped unless `--replace` (unpublish,
then publish). `--workspace <dir>` names another workspace; `--registry` (or
`PB_REGISTRY_URL`) another loopback registry.

**UHD's version.** UHD is released from its own repository: a tag
`v<version>` marks the release commit, and UHD's CI publishes that commit to
npmjs. Nobody publishes a release from a branch. `publish-stack.mjs` only
mirrors UHD into a registry of ours, and it holds the mirror to two rules
(`scripts/registry/uhd-version.mjs`):

- A plain version (`0.3.0`) means the commit tagged `v0.3.0`, with no changes
  to tracked files. The **local** registry is a scratch copy of the working
  trees, so it still takes any build under the plain version, and prints a
  note when that build is not the tagged one. A **hosted** registry refuses it.
- `--uhd-dev` publishes any other build as a dev build,
  `<next version>-dev.<short sha>`: `0.3.0-dev.1a2b3c4` before `v0.3.0` is
  tagged, `0.3.1-dev.1a2b3c4` for a commit after it. It goes under the
  dist-tag `dev`. The packages that depend on UHD get that exact version as
  their `@deltarobotics/uhd` dependency, and core gets it as the toolchain pin
  that `protoboard init` writes into new projects, in the **staged** copies
  only: no repository is edited.

```sh
node scripts/registry/publish-stack.mjs --uhd-dev --dry-run   # UHD as <next version>-dev.<short sha>, dependants pinned to it
```

**Replacing a version** changes the bytes behind a version number. Consumers
then need `npm install --prefer-online`, and an `npm exec` of the CLI may
reuse its earlier copy of the same version from `~/.npm/_npx`; bump the
version for anything that leaves your machine.

## Where the packages go

- `publish-stack.mjs` publishes to the loopback registry by default and
  refuses any other there; a hosted registry is an explicit `--target`
  (`verdaccio` or `artifact-registry`) with its own token. It refuses npmjs
  and every public registry whatever the target: npmjs gets the stack only
  from a release tag, through the release workflow.
- It packs each package and publishes the **staged** copy with an explicit
  `--registry`, so nothing in the repository points at your machine.
- The local registry gets UHD only through `publish-stack.mjs`, which packs
  `../uhd` and publishes the staged tarball; projects then install
  `@deltarobotics/uhd` from the local registry because their `.npmrc` maps the
  `@deltarobotics` scope there, with no uplink to npmjs. A UHD release reaches
  npmjs only from a tag, through UHD's own CI
  ([UHD's version](#publishing-the-stack)).

## Dev-link mode (the repositories)

Packages declare versions; inside the repositories npm links the siblings
instead, so edits are live:

- **This repository**: the root `package.json` has `@deltarobotics/uhd` and
  `@deltarobotics/uhd-viewer` as `devDependencies` on `file:../uhd` and
  `file:../uhd-viewer`, and the same two as `overrides`. Both apply only to
  the root project, so they never reach a consumer. The workspace packages
  (`packages/*`, the cloud client included, and `examples/*`) link each other.
- **uhd-viewer** resolves UHD from `../uhd/src` at build time, as before.

After changing UHD, run `npm run build` in `uhd` (the stack reads its
`dist/`); rebuild the viewer if it must show the change.

## Installing from the registry

A project outside the repositories points npm at the registry, either for the
two scopes (a project's `.npmrc`, or your `~/.npmrc`):

```ini
@protoboardai:registry=http://127.0.0.1:4873/
@deltarobotics:registry=http://127.0.0.1:4873/
```

or for everything (`registry=http://127.0.0.1:4873/`: npmjs packages come
through the registry's cache). Then `npm install`, `npx protoboard check`,
`npx protoboard build`.

## Project templates

`protoboard init <dir> --template drone|wearable|iot` starts a project from a
template derived from a reference project (`protoboard init --list` shows
them):

| Template | From | Starting system | Extensions |
| --- | --- | --- | --- |
| `drone` | `examples/quadcopter-5in` | F405 V3 + AM32 60A stack, 6S pack on its XT60 lead, ELRS receiver on UART2; stack sub-assembly, three cables | hardware, parts, docs, drone, frame-cad, harness-cad, release |
| `wearable` | `examples/wearable-watch` | main board (nRF52840 module, 3.0 V LDO, charger, USB-C, SWD pads) with `circuit.config.ts` and `firmware.config.ts` (Zephyr), on a researched 200 mAh cell by its own leads | hardware, parts, tscircuit, zephyr, enclosure-cad, harness-cad, docs, release |
| `iot` | `examples/smart-bottle` | main board (ESP32-C3 module, TPS63020 3V3, charger, IP67 USB-C, test pads) with `circuit.config.ts`, a hand placement and `firmware.config.ts` (ESP-IDF), on a researched 1000 mAh cell by its own leads | hardware, parts, tscircuit, esp-idf, enclosure-cad, harness-cad, frame-cad, docs, release |

Each writes `protoboard.config.ts` (extensions, release units), `package.json`
(the stack's packages by version, a `postinstall` that exports the skills and `skills:export` to do it again),
`AGENTS.md`, `docs/brief.md`, the folder layout (`src/boards`,
`src/enclosures`, `src/harnesses` with provider directories, `parts/catalog`,
`parts/local`, `parts/evidence`) and a small system that checks with no
errors and no warnings. The templates live in `@protoboardai/core`
(`packages/core/templates/<id>/`: `template.json` and `files/`).

Catalog parts are not copied into templates: `init` vendors the template's
pinned revisions from the parts service (`--url`, `PROTOBOARD_CLOUD_URL`,
`--local`'s http://localhost:8787, else the hosted Protoboard library), so
their files arrive with their terms and digests. `--no-parts` skips that and
prints the `protoboard parts add` command to run later. Run from the
registry (`npm exec`), or with `--registry <url>`, `init` also writes the
project's `.npmrc` for the two scopes.

```sh
mkdir ~/projects && cd ~/projects
printf 'registry=http://127.0.0.1:4873/\n' > .npmrc     # or the scope lines in ~/.npmrc
npm exec --package=@protoboardai/cli@0.2.0 -- protoboard init my-drone --template drone
cd my-drone && npm install
npx protoboard check && npx protoboard build
ls .claude/skills              # exported by npm install (its postinstall), and listed at the end of AGENTS.md
```

The boards' PCBs and firmware files are not generated by `init`; both boards
generate cleanly (`protoboard run circuit:generate --module main-board`,
`circuit:export`, `firmware:generate`: no DRC errors as of 2026-10-03).

## The exit check: `scripts/registry/smoke.sh`

```sh
registry/start.sh
node scripts/registry/publish-stack.mjs --replace
scripts/registry/smoke.sh --cloud http://localhost:8787          # a temporary folder outside the repositories
scripts/registry/smoke.sh --dir ~/scratch/smoke --cloud <url>    # kept; must not be inside a repository
registry/stop.sh
```

1. Copies `examples/quadcopter-5in`, `wearable-watch` and `smart-bottle`
   (their tracked files) outside the repositories, installs each from the
   registry only (`registry=` in its `.npmrc`), and runs `protoboard check`
   (fails on errors) and `protoboard build`.
2. Installs `@protoboardai/cli` from the registry and, for each template, runs
   `protoboard init --template <t>`, installs (which must leave the skills
   exported), checks, builds and runs `npm run skills:export`. Templates need a parts service to vendor from
   (`--cloud` or `PROTOBOARD_CLOUD_URL`); without one they are skipped.
3. Fails if any `@protoboardai/*` or `@deltarobotics/*` package in a lockfile
   resolved from anywhere but the registry (a `file:` or `link:` path), and
   if a check reports that it did not run (a dependency missing or
   mismatched in the installed project, such as `CIRCUIT_DRC`
   "@tscircuit/checks did not run").

Result on 2026-10-03, on the merged `mark/stack-v0.1` (registry from the
integration tree, the shared dev catalog read only, run from a scratch folder
outside the repositories): every step passed. The examples check exactly as
in the monorepo (0 errors; quadcopter-5in 1 warning, wearable-watch 1,
smart-bottle 2, the same warnings as there); the templates check with 0
errors and 0 warnings, type-check and export their skills. Every stack
package in each lockfile (13 to 15 per project) resolved from the registry.

Projects on `@protoboardai/ext-tscircuit` (the wearable and iot templates;
wearable-watch and smart-bottle take the override only) install the way the
workspace does:

- `legacy-peer-deps=true` in the project's `.npmrc` (`init` writes it from the
  template's `npmrc`). The examples do not track one: inside the workspace npm
  ignores it with a warning, and a copy installed from the registry keeps
  `circuit-json` at its top level with the override alone. Some tscircuit packages
  import `circuit-json` without declaring it, so it must sit at the project's
  top level; with peers installed, npm nests it out of their reach (the
  templates' `circuit:generate` failed: "Cannot find package 'circuit-json'")
  or, as a declared dependency, refuses circuit-json's TypeScript 5 peer
  against the templates' TypeScript 7.
- `"overrides": { "circuit-json": "0.0.510" }` in `package.json`, the version
  ext-tscircuit pins: `@tscircuit/checks` and `@tscircuit/core` take it as a
  peer, and an older copy hoisted next to them made `check` warn
  `CIRCUIT_DRC` "@tscircuit/checks did not run".

- `"@tscircuit/pcb-trace-linter": "https://codeload.github.com/tscircuit/pcb-trace-linter/tar.gz/4c035f9…"`
  in the same `overrides`: `@tscircuit/capacity-autorouter` names
  the linter as a GitHub dependency, which npm records as `git+ssh`; the
  override takes the same commit's HTTPS tarball, with an integrity hash, so
  installing needs no GitHub SSH key. The workspace's root `package.json` has
  the same entry, and its lockfile resolves it there (`npm ci` passes with
  `GIT_SSH_COMMAND=false`). (Inside the workspace `npm ls` calls the linter
  "invalid": npm compares it with the GitHub spec, not the override. The
  install is right.)

A project that adds ext-tscircuit itself needs all three. With them, the iot
template installed from the registry runs `circuit:generate` and
`circuit:export` (0 tscircuit errors) and checks with 0 errors and 0 warnings.

## CI

`scripts/ci-stack.sh --registry` adds three steps after the usual flow:
start the registry if none answers, publish the workspace's packages
(`--replace`), and run `smoke.sh` (the templates too when
`PROTOBOARD_CLOUD_URL` is set). In GitHub Actions, run the workflow by hand
with **registry** checked (Docker is on the runner). See [ci.md](../ci.md).

## Troubleshooting

- `ENEEDAUTH` on publish: publish through `publish-stack.mjs` (it passes the
  placeholder token), or add `//127.0.0.1:4873/:_authToken=local-registry`.
- `No matching version found for @deltarobotics/uhd@^0.2.1`, or `E404` for an
  `@protoboardai/…` package: npm is asking npmjs. npm reads the project's own
  `.npmrc`, not a parent folder's; add the scope lines there or to `~/.npmrc`.
- `E404` for an `@protoboard/…` package, or `PB_PACKAGE_SCOPE_RENAMED` from
  `protoboard check`: the project (or an `.npmrc` line) was written before
  the packages were renamed to `@protoboardai/…` on 2026-10-06 (the
  `@protoboard` name on npmjs belongs to someone else). Replace
  `@protoboard/` with `@protoboardai/` in the project's `package.json`,
  `protoboard.config.ts`, `*.config.ts` files and imports, change the
  `.npmrc` line to `@protoboardai:registry=…`, and run `npm install`. Never
  install an `@protoboard/…` package. A local registry that still holds the
  old names serves them from its own storage only (`registry/config.yaml`
  gives that scope no uplink and takes no publishes under it); clear them
  with `registry/stop.sh`, deleting `registry/storage/@protoboard`, and
  `registry/start.sh`.
- `EOVERRIDE ... conflicts with direct dependency`: an `overrides` entry on a
  package the root itself depends on. Dev links go on packages only
  workspaces depend on, or in the root's `devDependencies`.
- Do not run a plain `npm publish` in a package: it would go to npmjs. Publish
  to a local registry with `scripts/registry/publish-stack.mjs`; releases go to
  npmjs from the release workflow.
