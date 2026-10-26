# How Protoboard is distributed: npm packages and the VS Code extension

This page describes how the stack reaches a machine: the npm packages, the
VS Code extension that carries the whole stack, how a project finds its
packages, which CLI and which Node.js run, and what needs a Protoboard
account. The [installation guide](../guides/installation.md) is the
step-by-step version for users.

## In short

- **npm.** The stack is a set of npm packages under the `@protoboardai`
  scope (the CLI is `@protoboardai/cli`), published to the public npm
  registry together with [UHD](https://github.com/Delta-Robotics-Inc/uhd)
  (`@deltarobotics/uhd`) and the viewer (`@deltarobotics/uhd-viewer`).
- **One install.** A person can install one thing, the VS Code extension. Its
  `.vsix` carries the whole stack; a project uses it through links, with no
  Node.js, npm or registry on the machine. The npm route stays.
- **Open source.** Every package of the stack and the VS Code extension is
  Apache-2.0 ([LICENSE](../../LICENSE), [NOTICE](../../NOTICE)). The name and
  logo are trademarks ([TRADEMARKS.md](../../TRADEMARKS.md)).
- **Local first.** Only the hosted parts library needs a sign-in; local work
  runs with no account ("Sign-in for the cloud", below).

## The packages

Every package of this repository shares one version number with the VS Code
extension ([CONTRIBUTING.md](../../CONTRIBUTING.md#versions)). UHD and the
viewer are released from their own repositories and keep their own numbers.

| Package | Where | What it is |
| --- | --- | --- |
| `@deltarobotics/uhd` | [uhd](https://github.com/Delta-Robotics-Inc/uhd) | Universal Hardware Description: the open description language (modules, interfaces, harnesses), its schemas, checks and skills. |
| `@deltarobotics/uhd-viewer` | uhd-viewer | The viewer for UHD systems: a React component library and its standalone app (`uhd-viewer` command). |
| `@protoboardai/core` | `packages/core` | The framework core: project loading, the definition registry, resolution, aggregated checks, build, and the project templates. |
| `@protoboardai/cli` | `packages/cli` | The command-line interface (`protoboard`, `pb`). |
| `@protoboardai/cloud` | `packages/cloud` | The typed client of the parts service API v1, and of any `uhd-library/v1` library. No dependencies. |
| `@protoboardai/views` | `packages/views` | Protoboard's domain views as components, and the view registry the shells' tabs come from. |
| `@protoboardai/web-viewer` | `packages/web-viewer` | The shells over the viewer stack: the browser shell of `protoboard dev` and the shell the VS Code tabs load. |
| `@protoboardai/ext-hardware` | `packages/ext-hardware` | System composition, harness, test and release skills, BOM, evidence checks. |
| `@protoboardai/ext-parts` | `packages/ext-parts` | Purchased-part research, authoring and verification. |
| `@protoboardai/ext-sourcing` | `packages/ext-sourcing` | Part discovery, datasheet extraction with citations, supplier and lifecycle evidence. |
| `@protoboardai/ext-docs` | `packages/ext-docs` | Technical documents (datasheet, assembly guide) generated from a project's UHD model. |
| `@protoboardai/ext-release` | `packages/ext-release` | `protoboard release` and the Manufacturing Package. |
| `@protoboardai/ext-drone` | `packages/ext-drone` | Multirotor flight-controller configuration from UHD. |
| `@protoboardai/ext-tscircuit` | `packages/ext-tscircuit` | Circuit provider: PCBs from UHD board modules with tscircuit. |
| `@protoboardai/ext-esp-idf` | `packages/ext-esp-idf` | Firmware provider: ESP-IDF headers and `sdkconfig.defaults` for ESP32-C3 modules. |
| `@protoboardai/ext-zephyr` | `packages/ext-zephyr` | Firmware provider: Zephyr board definitions for nRF52840 modules. |
| `@protoboardai/ext-enclosure-cad` | `packages/ext-enclosure-cad` | CAD provider for enclosures: a printed or machined case from the UHD features it must provide. |
| `@protoboardai/ext-frame-cad` | `packages/ext-frame-cad` | Custom structure (plate) CAD from a module's UHD interfaces, with build123d. |
| `@protoboardai/ext-harness-cad` | `packages/ext-harness-cad` | Routed 3D geometry for wire harnesses, from the assembled UHD model. |
| `vscode-protoboard` (a `.vsix`) | `packages/vscode-protoboard` | The VS Code extension. |

The `@protoboardai/*` packages ship **readable TypeScript source**: where a
package declares `exports`, they point at `.ts` files, and the CLI runs them
through `tsx`. There is no compile step and there are no `.d.ts` files: the
types an extension author reads are the source itself
(`@protoboardai/web-viewer` also ships a built `dist/`). `@deltarobotics/uhd`
ships a compiled `dist/` with `.d.ts` files and its `src/`;
`@deltarobotics/uhd-viewer` ships a built `dist/` with `.d.ts` files. The VS
Code extension is bundled and minified.

In this repository every package is `"private": true`, so a plain `npm
publish` refuses it; `scripts/registry/publish-stack.mjs` publishes staged
copies (the [local registry guide](../guides/local-registry.md) shows it
against a registry on your own machine).

A project made by `protoboard init` has its own `package.json`. It depends on
`@deltarobotics/uhd` (pinned exactly), `@protoboardai/core`, the extensions
the project uses, and, as a development dependency, `@protoboardai/cli`, all
at `^` ranges of the stack version that made it. `protoboard upgrade` moves a
project to a newer stack line ([CLI reference](../reference/cli.md)).

## The VS Code extension: one install

A person installs the extension and nothing
else: no Node.js, no registry access, no lines in `~/.npmrc`, no global
package. They sign in, create a project from a template, see it in the
viewer, and `protoboard check` and `protoboard build` work in the project's
terminal, for them and for their agent. The CLI route (npm from a registry)
is unchanged and stays supported.

The goal is a test, run in a container with VS Code and nothing else,
without Node.js.

The extension starts with VS Code (`onStartupFinished`), in every window,
with or without a folder: it unpacks its stack the first time, shows its
account item in the status bar and gives terminals the `protoboard` command.
In a window that has no Protoboard project, a signed-in person's account item
is drawn from the service's last answer while that is recent, with no request
sent; signed out, the service is asked once whether it signs anyone in.

### What the .vsix carries

The whole stack as npm would install it for a project that uses every
extension: the nineteen packages at the versions that go together
(`@protoboardai/cli`, `core`, `views`, `web-viewer`, `cloud`, the twelve
`ext-*`, `@deltarobotics/uhd-viewer`, and `@deltarobotics/uhd` taken from
npmjs at the version core pins) and everything they depend on, as one
`node_modules` tree with one copy of UHD.

`packages/vscode-protoboard/scripts/build-stack.ts` (`npm run build:stack`;
`npm run package` runs it) builds it:

1. It packs each package from the workspace without running its scripts, so
   nothing is built into a checkout. UHD comes from npmjs.
2. It installs those tarballs into a staging folder with `npm install
   --omit=dev`, with the templates' `overrides` and `legacy-peer-deps`, from
   npmjs only (a user's `~/.npmrc` is not read).
3. It takes the native modules out of the tree and collects them for six
   platforms from the lockfile's `os` and `cpu` entries: esbuild (which `tsx`
   runs the TypeScript sources with), `@resvg/resvg-js` (ext-tscircuit) and,
   on macOS, `fsevents`.
4. It writes the tree as one Brotli archive and each platform's native
   modules as another, with `stack.json` (version, packages, platforms,
   sizes, a digest, and `build`: the protoboard-stack commit it was built
   from, whether that working tree had changes, and the branch). The carried
   CLI package gets the same stamp as `build-info.json`, and the unpacked
   copy's `protoboard-stack.json` keeps it, so `protoboard doctor` and
   `protoboard --version --json` can name the build an issue was seen on
   (`packages/core/src/build-info.ts`). A carried stack is never a release:
   only a build a registry installed at a published version is.

Measured for 0.1.3:

| | Size |
| --- | --- |
| The `.vsix` without the stack | 5.7 MB |
| The tree's archive (18,338 files) | 31.6 MB |
| Native modules, each of six platforms | 5.3 to 6.0 MB (33.9 MB together) |
| **The `.vsix` now** | **71.1 MB** |
| Unpacked on the user's disk, one platform | 284 MB of files (329 MB on disk) |
| Time to unpack | 2 s on the development machine, 6 s in the container |

How the size is kept down, and what was not done:

- Source maps are left out (about 50 MB; no code reads them).
- Four packages' carried `package.json` files leave out dependencies their
  shipped files never load in Node: the parts service's server libraries in
  `@protoboardai/cloud` (it ships only the client), and the viewers'
  browser-only libraries (they ship built bundles). Only the edge is removed;
  npm keeps whatever another package still needs. This takes the tree from
  500 MB to 380 MB. The packages published to a registry are not changed.
  A follow-up would be to fix this at the source: `@protoboardai/cloud`
  should not name `firebase-admin` as a dependency of its client.
- Most of what remains is tscircuit (about 110 MB unpacked), which
  `@protoboardai/ext-tscircuit` needs for boards.
- **One `.vsix` per platform, in the release.** `scripts/package.mjs
  --target <platform>` carries that platform's native modules only and
  passes `--target` to `vsce package`: six files of about 43 MB each instead
  of one of 71 MB, and the Marketplace and Open VSX give each editor its
  own. `npm run package` without it still makes the one file for every
  platform, simpler to hand to someone.
- **Not done: compiling the stack to JavaScript.** It would remove `tsx` and
  esbuild at run time, and with esbuild most of each platform's archive, and
  is the open "source or compiled" decision below. The carried copy is the
  packages as they are.

Platforms carried: `linux-x64`, `linux-arm64`, `darwin-arm64`, `darwin-x64`,
`win32-x64`, `win32-arm64`, with glibc on Linux. On another platform (Alpine,
for example) the extension says so and names the CLI route.

### Where it goes on the user's machine

The extension unpacks the carried stack once per version, with a progress
notification that names the folder, and says so again when it is done:

```
~/.protoboard/                     (PROTOBOARD_HOME overrides it)
  stack/0.1.3/                     the unpacked tree, with protoboard-stack.json
  stack/0.1.3/node_modules/…
  bin/protoboard, bin/pb           the command for terminals (and .cmd on Windows)
  runtime                          one line: the path of VS Code's own runtime
```

Each archive is first checked against the SHA-256 that `stack.json` names
for it: a `.vsix` cut short or changed on the way is refused, with a message
that says to install the extension again, before anything is unpacked.
It is written beside its final place and moved in when complete, so a window
closed halfway leaves nothing that looks installed. A rebuilt `.vsix` of the
same version replaces the copy (the digest differs); other versions stay.
Deleting `~/.protoboard/stack` is safe: the extension unpacks again.
**Protoboard: Show Where the Stack Is Installed** opens the folder, and
`protoboard stack` and `protoboard doctor` print it.

Why `~/.protoboard` and not the extension's own folder or VS Code's storage:
the extension's folder changes its name with every version (projects link to
the copy, below), and VS Code's storage path has a space in it on macOS and
is not where a person looks.

### How a project finds its packages

A project made by `protoboard init` has a `package.json` that names the stack
packages it uses, and its files import them (`@protoboardai/core` in
`protoboard.config.ts`, `@deltarobotics/uhd` in every `.uhd.ts`). On the CLI
route `npm install` puts them in the project's `node_modules`.

**Without npm, the project's packages are links to the carried copy.**
`linkProject` in `packages/core/src/stack.ts` puts one link in the project's
`node_modules` for each stack package its `package.json` names (a directory
symlink; a junction on Windows, which needs no privilege), writes
`node_modules/.bin/protoboard` and `pb`, and records what it did in
`node_modules/.protoboard-stack.json`. Node resolves a linked package at its
real location, so:

- each package's own dependencies come from the copy's tree;
- the project's sources and its vendored part sources (`parts/catalog/**.uhd.ts`)
  load `@deltarobotics/uhd` through the project's link, which is the same one
  copy core uses: vendored part source still evaluates against exactly one UHD;
- the editor finds the types, because the packages are TypeScript source.

Who links, and when (global by default):

- `protoboard init`, by default (`--stack global`): the new project is linked
  to the user's copy and its skills are exported at once, since no `npm
  install` will run the `postinstall` that does it. The copy is the one the
  CLI runs from (the extension's **New Project**, or `protoboard init` in a
  VS Code terminal), or one in `~/.protoboard/stack`, installed there once
  when a CLI that npm installed finds none.
- **Initialize** in VS Code (**Protoboard: Initialize Project**), for a
  project whose packages are missing (cloned from git, copied from another
  machine): `protoboard stack link`. The extension does not link a project
  unasked any more.
- Any project command of an installed CLI run in a terminal, in a project
  whose packages are missing: it links first, when a copy on the machine
  fits, and says so in one line on stderr. A command that is then refused
  for want of a sign-in takes its links back: the project is left as it was.
  The account's own commands (`login`, `logout`, `whoami`) and `setup` never
  link.
- `protoboard stack link` by hand. `--force` re-points links to another copy.

Which copy: a copy fits a project when the project's
range accepts its version and it holds every stack package the project
names. Among those, the copy the CLI runs from, then the copy of the CLI's
own version, then the newest. A carried copy that does not fit is not taken
(the extension then offers the .vsix and registry routes). When the copy is
not the CLI's version, `stack link` says why in one line ("the stack 0.1.7
(this CLI's) is not in ~/.protoboard/stack; linked 0.1.6 instead"), and
every later command run by a CLI of another version than the linked copy
warns on stderr; `protoboard stack` reports it too. The extension's **Update
Project to the Stack This Extension Carries** links its own copy whatever
package.json asks (`stack link --force --carried`).

`protoboard stack unpack [<extension folder | .vsix>]` unpacks the stack an
installed extension carries into `~/.protoboard/stack/<version>` with the
extension's own steps (core's `stack-unpack.ts`: each archive checked
against the SHA-256 its `stack.json` records before anything is unpacked),
for an agent or a terminal that has the extension installed but has not
started it, or has an older copy. With no path it takes the installed
extension of the CLI's version, else the newest, from the editors' folders
(VS Code, Insiders, VSCodium, Cursor, Windsurf and their remote servers).
In a project the copy fits, it then links the project.
`stack install --from-vsix <path>` is the same command. `protoboard stack`
lists the installed extensions and says which carry a stack that is not
unpacked yet.

What is kept:

- **A real folder is never replaced.** What npm installed stays, and a CLI
  that npm installed never links anything.
- **A project that pins another version still gets that version from a
  registry when it can reach one.** `npm install` in the project fetches from
  the registry every package whose range the linked version does not satisfy,
  and puts a real folder where the link was (the stack copy itself is not
  touched). Without changing the project, `protoboard stack install` (the
  extension's **Install the Stack Version the Project Pins**) installs the
  pinned version into `~/.protoboard/stack/<version>` with npm, using the
  project's `.npmrc`, and links the project to it. Both need npm and a
  registry that has the packages, and say so when either is missing.
- **`npm install` in a linked project whose ranges the links satisfy keeps
  the links** (npm 10 and 11). It adds what a stack copy
  does not provide (`typescript`, `@types/node`) from the public npm registry
  and runs the project's `postinstall`. So `npm run typecheck` needs Node.js
  with npm, and no access to the private registry. One thing to know: npm
  then writes a `package-lock.json` whose entries for the linked packages are
  relative paths to the stack copy on that machine. It is right there and
  wrong anywhere else, so a linked project's lock file is not committed.
- **The registry route stays, when asked for**: `init --stack project` (or
  `--registry <url>`) writes the same project and prints the same `npm
  install` step. Without the flag, a CLI that npm installed sets the project
  up from the user's copy.
- **`npx protoboard` and the agent's shell.** A linked project has
  `node_modules/.bin/protoboard`, so `npx protoboard` finds it locally where
  Node.js exists. The script itself needs no Node.js (next section), so
  `./node_modules/.bin/protoboard` always works.
- **Skills are exported** when a project is linked, as its `postinstall` does
  after `npm install`.

What a linked project does not have: `typescript` and `@types/node`, its two
development dependencies from npmjs. Only `npm run typecheck` needs them;
`init` says so, and that `npm install` brings them and keeps the links. TypeScript 7 is a native program of 27 MB per platform, so it
is not carried.

Rejected:

| Alternative | Why not |
| --- | --- |
| The extension runs `npm install` from bundled tarballs (an offline cache, or a `file:` registry it serves) | It needs npm, and so Node.js, on the machine: the thing we are removing. It also needs every third-party tarball carried (larger than the installed tree) and takes a minute per project instead of a moment. |
| Copying the packages into each project | 284 MB and several seconds per project, and every project then holds its own stale copy. |
| Resolution falling back to the carried copy with nothing in the project (a loader hook in the CLI) | `protoboard` would work, but the editor, `tsc` and anything else that resolves the project's imports would not find the packages: red squiggles in every file. A second resolution rule also makes "which UHD loaded" harder to answer. Links use Node's own rule. |
| One link for the whole `node_modules` | The project could then hold nothing of its own there (`.bin`, tool packages), and `npm install` could not take over. |

### Which CLI runs: the resolution order

Built in
`packages/vscode-protoboard/src/cli.ts` (`resolveCli`):

1. **The project's own installed CLI** (`node_modules/@protoboardai/cli`,
   looked up from the project folder upwards): installed by npm, or a link to
   a stack copy.
2. **The `protoboard.cliPath` setting.**
3. **A stack copy that matches the version the project pins**, when the
   carried stack does not satisfy the project's range. It is a folder
   `~/.protoboard/stack/<version>`, and there are three ways one gets there:
   - an earlier or later version of the extension unpacked it. Copies are
     never deleted, so after the extension updates, a project that pins the
     older version still finds its copy, with nothing to install;
   - **Protoboard: Add the Stack from Another .vsix File…** unpacks the stack
     a `.vsix` of that version carries, without installing that extension.
     It needs no Node.js, no npm and no registry: the person who invited the
     person who shares the project hands over the file. The archives are checked and unpacked the
     same way as the extension's own;
   - `protoboard stack install` (**Install the Stack Version the Project
     Pins (from a Registry)**) installs it with npm. This one needs Node.js
     with npm and access to a registry that has the packages, so it is the
     way for people on the CLI route, not for extension-only users.
4. **The stack carried in the `.vsix`**: the fallback that always works,
   offline, with no registry.

The project's own CLI wins over the setting, and `PATH` is not looked at. **Protoboard: Show Log** records, once per project
and choice, which of the four was used and with which Node.js, for example:

```
bottle-sensor: the CLI is 1 of 4, the project's own: …/node_modules/@protoboardai/cli/bin/protoboard.mjs,
a link to the stack copy /home/ada/.protoboard/stack/0.1.3. It runs with VS Code's own runtime as
Node.js 24.21.0 (/usr/share/code/code), because no Node.js was found on this machine
```

When a project pins a range the carried stack does not satisfy and no copy
matches, the carried stack runs it, and a warning says so and offers **Add
from a .vsix File…** and **Install from a Registry**, naming what the second
one needs.

### Which Node.js runs it

The stack needs Node.js 22 or later. VS Code brings one: its extension host
runs on the Node.js inside Electron, and the same executable runs any script
as Node when started with `ELECTRON_RUN_AS_NODE=1` (the way VS Code starts
its own helpers and language servers).

| VS Code | Electron | Node.js inside |
| --- | --- | --- |
| 1.106.0 (the oldest the extension supports) | 37.7.0 | 22.20.0 |
| 1.108.2 | 39.2.7 | 22.21.1 |
| 1.140.0 and 1.141.0 (stable in October 2026) | 43.7.3 | 24.21.0 |

Measured by running each build as Node. Every supported VS Code satisfies
Node 22. The native-module risk was checked on 1.106.0's runtime:

- **esbuild through `tsx`**: esbuild is a separate program that `tsx` starts;
  it does not load into Node. `init`, `check`, `build`, `doctor`, `skills
  export` and a full `circuit:generate` (53 s of routing) ran.
- **`@resvg/resvg-js`**: a Node-API module, which does not depend on the Node
  version; it loaded in the circuit run.
- **`node:sqlite`**: present in all three. Nothing the stack runs on a user's
  machine uses it (only the parts service does).

So the rule (`chooseRuntime`): the `protoboard.nodePath` setting as given;
else a Node.js 22 or later on the machine (on `PATH`, or where Homebrew, nvm,
Volta, fnm, mise or asdf put it, as before); else VS Code's own runtime. A
missing or old Node.js is therefore not an error, and nothing has to be
installed. In a remote window (SSH, WSL, a container) the extension runs on
the VS Code server's own `node`, which is used the same way.

**Terminals.** The extension adds `~/.protoboard/bin` to the end of `PATH`
for the window's terminals (VS Code's environment contribution; the setting
`protoboard.terminal.addCommand` turns it off). `protoboard` there is a small
script: in a folder whose project has `node_modules/.bin/protoboard` it runs
that one; otherwise the carried CLI. It runs on a Node.js 22 or later when
`node` is one, else on the runtime named in `~/.protoboard/runtime`, which the
extension rewrites at every start (VS Code's path changes when it updates).
It is at the end of `PATH`, so a `protoboard` the user installed stays first.

Limits, stated plainly:

- An agent that starts its own shell outside VS Code's terminals (some agent
  extensions do) does not get that `PATH`. In a project it runs
  `./node_modules/.bin/protoboard`, which is self-sufficient; the project's
  AGENTS.md and the onboarding document say so.
- `npx` needs Node.js. Without Node.js the command is `protoboard`.
- On VS Code's runtime the CLI's own process has `ELECTRON_RUN_AS_NODE=1` in
  its environment, and programs it starts inherit it (it needs that to start
  itself again, for tool probes and evals). The variable means something
  only to Electron programs, which would then start as Node. Protoboard
  starts none: Python, a browser for documents and esbuild are not affected.
- `protoboard tools install circuit` installs Node packages with npm and so
  needs Node.js with npm; it says so. The CAD runtime needs Python, as before.
  Tool runtimes stay per project (`.protoboard/tools/`) and are installed on
  demand, as before.

### Updating

A new `.vsix` carries a new stack and unpacks it beside the old one. A
project created with the older one keeps its links to the older copy, which
stays on disk, so it keeps working exactly as it was. The first time such a
project is opened the extension says "uses the stack 0.1.6, and this
extension carries 0.1.7", with **Update Project** (the command **Update
Project to the Stack This Extension Carries**: `protoboard stack link
--force` with the carried CLI). When the new version is outside the range in
the project's `package.json`, the message says which lines to change so a
later `npm install` agrees. Old copies are never deleted automatically;
`protoboard stack` lists them.

## Sign-in for the cloud

The stack is open source, and the hosted parts library is the service behind
an account. So the sign-in gates the cloud, never local work. The cloud is
the whole library, browsing included: signed out there is no library access
anywhere, in the CLI, the MCP tools or VS Code. (Up to 0.1.x one switch
gated every command; the switch, `SIGN_IN_REQUIRED`, and its environment
variable, `PROTOBOARD_SIGN_IN`, are gone in 0.2.0.)

**Where the protection is.** The parts service. With sign-in on (the
image's default) it refuses every read of the library without a valid
sign-in: search, facets and taxonomy counts, part pages and revision lists,
full revisions and closures, every file, kits, offers, downloads, and the
redistributable view (`/distributable/v1`, `?distribution=redistributable`);
publishing needs a publisher; an account off its invite list is refused
too. Only discovery (without the library's counts), the account, device
sign-in and the list of downloads are open.
What the client does is a courtesy: it says so before anything changes, in
one line. A fork that removes the client's check gets the service's 401.

### What needs an account

The CLI's table is `packages/cli/src/gate.ts`; the extension's is
`CLOUD_COMMANDS` in `packages/vscode-protoboard/src/account.ts`, and its
test checks each against the CLI's.

| | Before (0.1.x) | 0.2.0 |
| --- | --- | --- |
| `init` (blank), New Project, Initialize | refused | local |
| `init --template`: the project | refused | local |
| `init --template`: its library parts | refused | cloud (skipped signed out; `partsSkipped` names the command that adds them) |
| `inspect`, `artifacts`, `check`, `build`, `dev` and the viewer, `layout`, `views check` | refused | local |
| `run` (circuit generate, export, KiCad, lock; CAD; firmware), `operations`, `capabilities`, `release`, `bom` | refused | local |
| `tools`, `extensions`, `skills`, `evals`, `stack`, `setup`, `agents`, `mcp`, `doctor` | partly refused | local |
| `parts list`, `parts migrate` | refused | local |
| `parts search`, `parts taxonomy`, `libraries` | refused | cloud (the service needs an account for browsing too) |
| `parts add`, `parts update`, `parts list --check` | refused | cloud |
| `parts offers`, `parts prices`, `parts publish`, `parts usage` | refused | cloud |
| VS Code: viewer and CAD tabs, Inspector, hierarchy, DRC, Project Parts' list, BOM, Cloud view | covered, inert | local |
| VS Code: Library (side bar, page, part detail) | covered, empty | cloud: the card "Sign in to use the Protoboard library", no parts |
| VS Code: Fetch Parts, Add Part, update check, Update, Restore, Compare, offers, Submit for Verification | disabled | cloud: asks to sign in |
| MCP tools on the project | refused | local; `parts_search` and `parts_add` answer `signInRequired` |

### What it does

- **The CLI.** A cloud command signed out stops before it changes anything,
  with one line and exit code 4:

  ```
  protoboard: Adding library parts needs a Protoboard account: sign in with `protoboard login` (not signed in to https://…).
  ```

  With `--format json` the line carries `code: "SIGN_IN_REQUIRED"` and the
  account state. Local commands never mention a sign-in. `whoami` and
  `doctor` say what needs the account; signed out is not marked as a fault.
- **The VS Code extension.** Nothing is covered or disabled. The Library's
  screens show the sign-in card in place of the library (no parts
  listed signed out); the cloud's commands ask to sign in; Project Parts
  asks the libraries for updates only when the cloud can be used. The status
  bar shows **Sign in**, with a tooltip that says what it is for. The
  walkthrough's sign-in step is optional, after the project and the viewer.
  New Project signed out makes the project and leaves a template's library
  parts for later.
- **The MCP server.** `project_status` mentions the sign-in once, at the end
  of `next`. A tool whose command needs the cloud answers `signInRequired`
  with what to ask the user.

### The cases

The check runs only before a cloud command (and for `whoami`, `doctor` and
the extension's account state).

| Case | What happens |
| --- | --- |
| Signed in, the account is invited | Allowed. The service's answer is kept for 12 hours; cloud commands in that time ask nothing of `/v1/me`. |
| Offline after signing in | Allowed for 7 days after the service last confirmed the account; the command then says itself what it could not reach. |
| Signed in, not invited | Refused, with a line that names the account. |
| The sign-in no longer works | Refused: sign in again. |
| The service cannot be reached | Not a refusal: the command goes on and says what it could not reach. |
| A parts service that signs no one in (local development, or a library someone else hosts) | Open. |
| CI | `PROTOBOARD_CLOUD_TOKEN` (the service token) counts as signed in; the check sends it nowhere. A library with its own token (`authEnv`, set) is not asked. |

### What the check sends

Nothing about the project: `GET <service>/.well-known/uhd-library` without
credentials, `GET <service>/v1/me` with the account's ID token, and the
token refresh every signed-in command already makes. The answer is kept in
`access.json` beside the credentials (who and when; no token).

### Tests and CI

No switch is needed: local work asks nothing, and the repository's cloud
steps use local parts services that sign no one in. `vitest.config.ts` and
`scripts/ci-stack.sh` set `PROTOBOARD_CONFIG_DIR` to a temporary folder so
they never touch the developer's own sign-ins. `packages/cli/test/gate.test.ts`
checks the table; `packages/cli/test/access.test.ts` runs every case above
with the real CLI against a stand-in service; the extension's integration
test works on a project signed out and checks the Library's card and the
prompts.
