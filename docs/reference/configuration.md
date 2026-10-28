# Configuration reference

What a Protoboard project is made of, the configuration files the CLI reads,
and the environment variables it honours. The types are in
`packages/core/src/types.ts` (`ProtoboardConfig`, `ReleaseConfig`,
`LibraryConfig`) and `packages/core/src/capabilities.ts`
(`CapabilityConfig`); the folder layout is specified in
[project structure](../specs/protoboard-project-structure.md).

## Project layout

```text
my-project/
  protoboard.config.ts        the project (below)
  release.config.ts           optional: `release` as its own file
  package.json                UHD, @protoboardai/core, @protoboardai/cli and the extensions, by version; UHD and TypeScript pinned exactly
  AGENTS.md                   instructions for agents; `protoboard skills export` adds the skill list (by name)
  CLAUDE.md                   `@AGENTS.md`: Claude Code reads CLAUDE.md, not AGENTS.md (a CLAUDE.md already in the folder is kept)
  src/                        project-specific modules: the system, boards, enclosures, structures, harnesses
    <module>/<capability>.config.ts   which provider designs the module (below)
    <module>/<native>/        the provider's native design (tscircuit/, build123d/, frame-cad/, zephyr/ …)
    <module>/out/             the provider's standard outputs
  parts/
    catalog/<id>.json         catalog definitions vendored from a library, byte-for-byte
    catalog/<short>/          their files (CAD, evidence), vendored without the library's own folders, and their source: <id>.uhd.ts and the library modules it imports; <short> is the id cut to 24 characters (`protoboard parts migrate` moves parts vendored by 0.1.6)
    origins.json              protoboard.origins/v0: library, service, revision and every digest per part
    offers.json               protoboard.offers/v0: supplier offers vendored by `parts offers` (prices by source)
    local/<id>.uhd.ts         purchased parts researched in this project
    evidence/<id>/            their sources.json, verification.json, terms.json, sourcing.json
  docs/                       brief.md, product.json (what the product is, for the documents' first page), decisions.md and the project's documents
  operations/                 one JSON record per operation run (commit them: `release` checks against them)
  release/<version>/          the Manufacturing Package (ignored by git; `releases/<version>/`, an earlier name, is read too)
  .protoboard/
    display.json              the diagram layout `protoboard dev` saves and the 3D placements (commit it; [format](display.md))
    build/                    resolved.json, uhd-bundle.json, sources.json (derived; ignored)
    local/dev.json            the running dev server's record (ignored)
    tools/<runtime>/          installed tool runtimes, tools.json (machine-specific; ignored)
    evals/<run>/              eval scorecards (ignored)
```

`protoboard init <dir>` writes the minimum of this (config, a root system,
the parts folders, brief and decisions, `.gitignore`, `AGENTS.md`,
`CLAUDE.md`); a blank project lists `@protoboardai/ext-hardware`, and
`protoboard extensions add <name>` adds another extension. The
command looks for `protoboard.config.ts` in `--cwd` (default the current
directory) and the folders above it.

### UHD and TypeScript versions

Catalog parts ship their `.uhd.ts` source, and each declares the
`@deltarobotics/uhd` range it is written against (like a peerDependency) and
the TypeScript it is written for. A project pins both exactly in
`package.json`, as `protoboard init` writes them:

```json
{
  "dependencies": { "@deltarobotics/uhd": "0.3.0" },
  "devDependencies": { "typescript": "7.0.2" }
}
```

`check` compares the installed versions (or, when none is installed, the
declared ones) with each vendored part's ranges: a UHD outside a part's range
is an error (`PB_SOURCE_UHD_RANGE`), a TypeScript outside it or not pinned a
warning (`PB_SOURCE_TS_RANGE`, `PB_SOURCE_TS_UNPINNED`). The stack's own
pins are `protoboard.toolchain` in `@protoboardai/core`'s package.json.

A UHD patch release keeps the schema, so parts written for `^0.2.0` work
under every 0.2.x and a project moves its pin from 0.2.0 to 0.2.1 without
touching its parts. When the exact pin and the installed UHD differ (a
project pinned at 0.2.0 run where 0.2.1 is installed, or the other way
round), `check` still runs, with the installed one, and says so in a warning
(`PB_UHD_PIN`): run `npm install` to get the pinned version, or move the pin.

A minor release before UHD 1.0 may change the schema, and a `^0.2.0` range
does not admit 0.3.0. UHD 0.3.0 only widened it (its changelog: definitions
written for 0.2.x are valid 0.3.0 definitions unchanged), so the stack runs
a part whose source declares a 0.2 range under UHD 0.3.x as well, without a
`PB_SOURCE_UHD_RANGE` error. A project on Stack 0.2.0 moves its pin to 0.3.0.

## `protoboard.config.ts`

```ts
import { defineConfig } from "@protoboardai/core";

export default defineConfig({
  name: "quadcopter-5in",
  root: { source: "src/quadcopter.uhd.ts", export: "QUADCOPTER_5IN" },
  sources: ["src/**/*.uhd.ts", "parts/local/**/*.uhd.ts"],
  catalog: "parts/catalog",
  scenarios: { source: "src/scenarios.ts", export: "SCENARIOS" },
  extensions: ["@protoboardai/ext-hardware", "@protoboardai/ext-parts", "@protoboardai/ext-release"],
  release: { units: ["stack"] },
});
```

| Field | Type | Default | Meaning |
| --- | --- | --- | --- |
| `name` | string | the folder name | The project's name. |
| `root` | `{ source, export }` | required | The root system: a project source file and the export holding its UHD `ModuleDef`. |
| `sources` | glob[] | `src/**/*.uhd.ts`, `parts/local/**/*.uhd.ts` | Files whose exported `ModuleDef`s (or arrays of them) are local definitions. Capability configs are found in the folders these cover. |
| `catalog` | path | `parts/catalog` | Folder of vendored catalog definitions; `origins.json` sits next to it. |
| `cloud` | `{ url? }` | the hosted Protoboard library | The Protoboard library's URL for the `parts` commands, the Library in VS Code and for `protoboard login`, `logout` and `whoami` in this project (never used by check or build). `PROTOBOARD_CLOUD_URL` and `--url` override it. `protoboard init` writes the hosted library's URL here (`--local`: `http://localhost:8787`, a parts service on this machine). A project that sets none, and `login`, `logout` and `whoami` outside any project, use the hosted library (since 0.2.2; before, a project without `cloud.url` used `http://localhost:8787`). A service on this machine is used only when `cloud.url`, `PROTOBOARD_CLOUD_URL` or `--url` names it. |
| `libraries` | `LibraryConfig[]` | `[{ id: "protoboard" }]` | Part libraries in order (below). Managed with `protoboard libraries add / remove / move`. |
| `extensions` | string[] | `[]` | Installed extension packages to load (each has a `protoboard-extension.json`). A capability provider named by a module config loads without being listed here. |
| `scenarios` | `{ source, export }` | none | Named variants of the system (fault scenarios, options): `{ id, label, description?, system?, overrides? }[]`, carried into the UHD bundle for viewers. |
| `display` | path | `.protoboard/display.json` | Viewer display hints and the saved diagram layout (`uhd.display/v0`). |
| `currency` | ISO 4217 | `USD` | The currency the sourcing extension's supplier comparison quotes in. The bill of materials (`protoboard bom`, the BOM views) and a release's ordering list are always in US dollars, converted with a dated rate table (docs/specs/bom.md); this setting does not change them. |
| `release` | `ReleaseConfig` | root unit only | The Manufacturing Package (below). May instead be the default export of `release.config.ts`. |

### `libraries`

```ts
libraries: [
  { id: "protoboard" },                                                   // Protoboard Cloud at the cloud URL
  { id: "acme", url: "https://parts.acme.example", authEnv: "PROTOBOARD_ACME_TOKEN" },
],
```

| Field | Meaning |
| --- | --- |
| `id` | Short id (lower-case letters, digits, `-`, `_`), shown in search results and recorded in `parts/origins.json`. |
| `url` | The library's URL; its discovery document is at `<url>/.well-known/uhd-library` or `<url>/v1`. Optional only for `protoboard`. |
| `authEnv` | The name of the environment variable holding the library's read token: `PROTOBOARD_<NAME>_TOKEN`, never `PROTOBOARD_CLOUD_TOKEN` (so a project cannot have another of your variables sent to its library). A value that looks like a token is refused; tokens are never written to the project. No token is sent to a library whose URL is plain `http` on another machine. |

The first library in order that has a part id provides it, unless `--library`
names one or `parts/origins.json` already pins the part to one. A library
before it that cannot be reached is an error, not skipped. Personal
libraries (not in the project) come from `PROTOBOARD_USER_LIBRARIES` and are
searched after the project's. The protocol: [library protocol](library-protocol.md).

### `release`

```ts
release: {
  units: ["stack"],                              // instance paths or module ids; the root is always a unit
  build: 1,                                      // products to build: ordering quantities × build
  spares: { fastener: { percent: 20, min: 4 } }, // by part id, tag or category; overrides the defaults
  checks: [{ unit: "stack", check: "…", subject: "…", how: "…", pass: "…", record: "…", trace: "…" }],
},
```

| Field | Default | Meaning |
| --- | --- | --- |
| `units` | `[]` (root only) | Package units. An instance path makes that instance a unit; a module id makes every instance of it one unit, built once per instance. Everything else folds into the nearest unit above it. |
| `build` | 1 | Products to build; every ordering quantity is multiplied by it. |
| `spares` | hardware 10 % (min 2), board components 5 % (min 2) | `{ percent?, min? }` by part id, tag or category. |
| `checks` | `[]` | The project's own test steps, added after the generated ones: `unit?` (default root), `group?` (`bringup` or `function`), `phase?` (`power` or `running`), `check`, `subject`, `how`, `pass`, `record`, `trace?`. |

The package itself: [Manufacturing Package](manufacturing-package.md).

## Module capability configs

A module designed by a tool has one config per capability in its folder:
`circuit.config.ts`, `cad.config.ts` or `firmware.config.ts`.

```ts
import { defineCapabilityConfig } from "@protoboardai/core";

export default defineCapabilityConfig({
  provider: "@protoboardai/ext-tscircuit",
  module: "watch-main-board",              // optional when the folder declares one module
  constraints: { layers: 4, thickness_mm: 0.8 },
});
```

| Field | Meaning |
| --- | --- |
| `provider` | The provider extension's package. Switching tools is an edit here (and an `npm install`). |
| `module` | The module id, when the folder declares several, or the config sits in a folder of its own (`src/harnesses/<id>/cad.config.ts`). |
| `constraints` | The provider's design constraints. A key the provider does not declare is a warning; a missing required one an error. Each provider's constraints are listed in [extensions](extensions.md). |
| `process` | `cad` only: `print` (requires STL or 3MF), `cut` (requires DXF) or `machine` (STEP only). |

The config's folder is the module's provider directory: the native folder and
`out/` live there. `protoboard capabilities` shows which module uses which
provider. The contract: [writing a capability provider](../guides/writing-a-capability-provider.md).

## Environment variables

| Variable | Read by | Meaning |
| --- | --- | --- |
| `PROTOBOARD_CLOUD_URL` | `parts`, `libraries`, `login`, `logout`, `whoami`, `init` | The Protoboard library's URL (before `cloud.url`; `--url` wins). Without it and without a `cloud.url`: the hosted Protoboard library, in a project or outside one (since 0.2.2; before, `http://localhost:8787` in a project). `init` writes it into the new project's `cloud.url`. |
| `PROTOBOARD_CLOUD_TOKEN` | `parts publish` | The publish token for the Protoboard library. Read from the environment only, never written anywhere. Sent only to the hosted Protoboard service's origin, or to an origin `PROTOBOARD_CLOUD_TOKEN_ORIGINS` lists, whatever a project's `cloud.url` says. |
| `PROTOBOARD_CLOUD_TOKEN_ORIGINS` | `parts` | Comma-separated origins besides the hosted service that may receive `PROTOBOARD_CLOUD_TOKEN` (a staging service, `http://127.0.0.1:8787` for one on this machine). Plain `http` counts only for this machine. |
| `PROTOBOARD_USER_LIBRARIES` | `parts`, `libraries` | Personal libraries: a JSON array of `{ id, url, authEnv? }`, searched after the project's. |
| *a library's `authEnv`* | `parts`, `libraries` | That library's read token. |
| `PROTOBOARD_PYTHON` | CAD tools (probes, operations, checks) | The Python interpreter with build123d. Set by `tools install cad` for the project's runtime; one you set yourself wins. |
| `CHROME` | ext-docs, ext-release | The browser that renders figures and PDFs: a path, or a command on `PATH`. Unset (the default), the first of Google Chrome, Chromium, Microsoft Edge and Brave found where the platform installs them (`/Applications` on macOS, Program Files on Windows, `PATH` and `/usr/bin` on Linux). `doctor` says which one. |
| `PROTOBOARD_DOC_FONTS` | ext-docs, ext-release | Optional folder of document fonts on top of the bundled Kode Mono (`@protoboardai/ext-docs/fonts`, OFL): a `KodeMono-*.ttf` there replaces the bundled file. Unset (the default), every machine renders with the bundled Kode Mono only, so releases match byte for byte. `UHD_DOC_FONTS` is the older name. |
| `PROTOBOARD_THREE_DIR` | ext-docs | A `three@>=0.160` package folder for figure rendering, when the installed one cannot be found. |
| `SOURCE_DATE_EPOCH` | `release` | The release date; default the source commit's date. |
| `PB_CLOUD_DATA_DIR`, `PORT`, `PB_CLOUD_PUBLISH_TOKEN` | the parts service (`protoboard-cloud`) | Its data folder, port, and the token that enables publishing (unset: read-only). |

## Files the CLI writes

| File | Written by | Commit it? |
| --- | --- | --- |
| `parts/catalog/**`, `parts/origins.json` | `parts add`, `parts update --to` | Yes |
| `parts/offers.json` | `parts offers` | Yes (a release quotes from it offline) |
| `protoboard.config.ts` (`libraries` only) | `libraries add / remove / move` | Yes |
| `<module>/<native>/**`, `<module>/out/**` | `run <capability>:generate / export` | Yes |
| `operations/*.json` | every operation (`run`, `release`) | Yes |
| `.protoboard/display.json` | `dev` (diagram edits) | Yes |
| `.protoboard/build/**` | `build`, `dev`, the VS Code extension's check | No |
| `.protoboard/tools/**` | `tools install` | No |
| `release/<version>/**` | `release` | Your choice (this repository ignores it and commits the release record) |
| `.claude/skills/**` | `skills export` (a new project's `npm install` runs it) | No in a project made by `init` (its `.gitignore`): copies of the installed packages |
| `AGENTS.md` (its skills section) | `skills export` (a new project's `npm install` runs it) | Yes: the file is yours, the section is rewritten in place |
