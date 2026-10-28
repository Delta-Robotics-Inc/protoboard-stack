# Continuous integration

The public repository's workflows are in `.github/workflows/`:

| Workflow | Runs on | What it does |
| --- | --- | --- |
| `ci.yml` | every pull request, pushes to `main`, by hand | The stack on Linux, macOS and Windows (below) |
| `dco.yml` | every pull request | Every commit is signed off by its author (`.github/scripts/dco.mjs`; CONTRIBUTING.md, "Sign your work") |
| `release.yml` | a tag `v<version>`, or by hand without publishing | Check, build, test; publish to npm, the Marketplace and Open VSX; the GitHub release ([Releasing](#releasing)) |

Every action is pinned by commit SHA (Dependabot, `.github/dependabot.yml`,
moves the SHA and its version comment together), every checkout keeps no
credentials (`persist-credentials: false`), the default token is read-only
(`permissions: contents: read`; only the release's jobs ask for more), and
no workflow runs on `pull_request_target`: a fork's pull request runs the
same jobs, with no secret.

## The workspace

The stack builds against two public repositories checked out beside it:

```
<workspace>/
  protoboard-stack/   this repository
  uhd/                Delta-Robotics-Inc/uhd           (@deltarobotics/uhd)
  uhd-viewer/         Delta-Robotics-Inc/uhd-viewer    (@deltarobotics/uhd-viewer)
```

The root `package.json` links them (`file:../uhd`, `file:../uhd-viewer`), and
the viewer resolves `@uhd/*` to `../uhd/src`. Both workflows set the workspace
up the same way, with the composite action `.github/actions/workspace`: UHD
and the viewer at the tags it pins (its `uhd-ref` and `uhd-viewer-ref`
defaults, one place for both workflows), built; the stack and the extension
installed with `npm ci`. Its last step (`.github/scripts/siblings.mjs`) fails
when a pinned tag does not satisfy what the stack's packages ask for: move the
tag there, in the same pull request as the dependency change. It also fails
while the root `package.json` links the private `../protoboard-cloud`: the
cloud client is a package of this repository.

## `ci.yml`

| Job | Runner | Required steps |
| --- | --- | --- |
| Linux | `ubuntu-latest` | type-check; the lints (brand spelling, npm scope, licence files, nothing presents the older web app); every test; the eval cases with the scripted host (their summary goes to the run's Summary); `check` and `build` on every example |
| macOS | `macos-latest` | the probe of what the Mac gives the stack (`scripts/macos/probe.mjs`); the tests of what differs on a Mac (viewer connection, Python selection, browser lookup, dev server, the agents' set-up, `protoboard setup`); every template in a path with spaces; the quadcopter example; the extension's integration test in VS Code stable |
| Windows | `windows-latest` | the CLI from Git Bash and PowerShell; the sign-in link's opener and the PATH entry; every template in a path with spaces, from both shells; the quadcopter example. The integration test and, on `main` and by hand, the whole suite run and report without failing the job (below) |

Run by hand with `cad` (Actions, CI, Run workflow) to add the Python CAD
steps: build123d installed, the CAD generator tests, `tools install cad` and
`doctor` (Linux), `tools install cad`, `doctor`, `check` and `build` on the
smart bottle (macOS).

```sh
gh workflow run ci.yml --repo Delta-Robotics-Inc/protoboard-stack --ref <branch> -f cad=true
gh run list --workflow ci.yml --repo Delta-Robotics-Inc/protoboard-stack --limit 5
gh run view <id> --repo Delta-Robotics-Inc/protoboard-stack --log-failed
```

**Branch protection on `main`** (Settings, Branches): require a pull request
with one approval from a code owner (`.github/CODEOWNERS`); require the status
checks `Linux (type-check, lints, every test, evals, examples)`, `macOS
(Mac-specific tests, templates, integration test)`, `Windows
(Windows-specific tests, templates, integration test)` and `Every commit is
signed off`; require branches to be up to date; no force pushes, no
deletions.

## Windows

What the Windows job has found, and what is still open:

**What the first runs found (2026-10-11 and 12, branch `mark/r5-guide`).**

| Found | Where | State |
| --- | --- | --- |
| uhd-viewer's build stopped at "Hexadecimal digit expected": a module path written with backslashes into `dist/components/index.d.ts` | uhd-viewer `scripts/build-components-types.mjs` | Fixed on uhd-viewer's branch `mark/r5-guide` (one commit, to merge with the round) |
| The web viewer was not built at install: `spawnSync npm.cmd EINVAL` (Node refuses to start a `.cmd` file without a shell) | `scripts/build-web-viewer.mjs` | Fixed. Every build and release script now starts npm as Node with npm's `npm-cli.js` (`scripts/npm-cli.mjs`), and `package.mjs` starts tsx and vsce by their JavaScript files, so the release packages win32-x64 on `windows-latest` (PB-1047) |
| The integration test starts in a real VS Code and fails on one comparison: VS Code gives the workspace folder with a lower-case drive letter (`d:\a\…`), the test expects `D:\a\…` | `packages/vscode-protoboard/test/integration/` | Open: the step reports without failing the job (`continue-on-error`) until the test compares paths as Windows does; then remove that |
| `protoboard setup` with no editor and no terminal exits 2 where the test expects 0; its PATH offer's test fails on an undefined value | `packages/cli/test/setup.test.ts` | Open: in the whole suite, reported |
| Suites that assume a POSIX file system in their own fixtures: the agents' set-up (file modes, `.local/bin/claude`), `tools install` with fake Pythons, the Inspector's and the artifacts' paths, New Project's folder comparison, the credential store's file mode | `packages/core/test/agents.test.ts`, `tools.test.ts`, `account.test.ts`, several in `packages/vscode-protoboard/test` | Open: in the whole suite, reported |
| The whole suite had not finished after 35 minutes (about 9 on Linux) | | The step stops after 45 minutes; which tests are slow there is still to find |

Passing on Windows: the installs and builds, the CLI from Git Bash and
PowerShell, the sign-in link's opener and the PATH entry, every template in
a path with spaces from both shells, and the quadcopter example.

**Reading a run.** The job's page lists the steps; a red one is where to
look. The whole suite's step never turns the run red: its result is in the
run's **Summary** (counts, then every failed test with the first lines of its
message, by file; `scripts/windows/suite-summary.mjs` writes it). The
`windows-logs` artifact holds VS Code's logs of the integration test, with
the extension's own log
(`window1/exthost/deltarobotics.vscode-protoboard/Protoboard.log`), and
`vitest.json`, the suite's full result.

**The whole suite is not required yet.** Much of it was written on Linux and
has never run on Windows: tests that start shell scripts (`.sh`), compare
paths written with `/`, or expect `python3` will fail there without the
product being wrong. After the first run: fix what is a product fault, make
the tests that assume Linux say so (`it.skipIf(process.platform === "win32")`
with the reason), and when the summary says nothing failed, remove
`continue-on-error` from the step so that it is required. Tests that are
found to matter on Windows meanwhile go into the required list of the "Unit
tests" step.

**The template script** runs the same on any system, so a change to it can
be tried before it is pushed:

```sh
node scripts/windows/template-project.mjs            # drone, iot, wearable
node scripts/windows/template-project.mjs iot
```

It creates each project inside the checkout, so that the project finds the
stack's packages in the checkout's `node_modules` as the examples do, and
installs nothing. CI has no parts service, so `init` runs with `--no-parts`
and the script copies the vendored parts of the reference project the
template is derived from (the same parts, possibly at an earlier revision
than the template pins). It does not test vendoring from a library:
`scripts/registry/smoke.sh` does, on Linux.

**Steps and shells.** Steps run in Git Bash (`defaults.run.shell: bash`), so
the scripts are those of the other workflows; the two PowerShell steps say
`shell: pwsh`. In Git Bash, `$RUNNER_TEMP` and `$GITHUB_WORKSPACE` hold
Windows paths (`D:\a\…`): quote them, and join with `/`, which Node and git
accept.

**What it does not do**: the CAD runtime (`tools install cad`), the
documents rendered to PDF and a release. The macOS job's `cad` run does
those; add them here once the steps above pass.

## Releasing

`release.yml` runs when a tag `v<version>` is pushed. The tag must be a
commit of `main` (or of a maintenance branch `release/*`), and every
`@protoboardai/*` package and the extension must have that version
(`node .github/scripts/release.mjs version --tag v<version>` says the same
locally). Then, in order:

1. **check**: the npm packages can be published from this repository (not
   private, no other registry, this repository as their `repository`,
   `LICENSE` and `NOTICE` in their files: `release.mjs packages`); the
   changelog has the version's section (`release.mjs notes <version>`, from
   `CHANGELOG.md`, else `docs/releases/`); type-check, lints, every test. The
   packages are packed once, the CLI with its build stamp
   (`packages/cli/build-info.json`), and those tarballs are what is published.
2. **vsix**: the extension for linux-x64, linux-arm64, darwin-x64,
   darwin-arm64 and win32-x64, each carrying only its platform's native
   modules (`scripts/package.mjs --target <target>`, which passes
   `--target` to `vsce package`), each built on a runner of that platform,
   win32-x64 on `windows-latest`. On each runner the carried stack is
   unpacked and its CLI run.
3. **npm**: each package, dependencies first, `npm publish --provenance`
   (npm 11.5 or later), under `latest`, or `next` for a prerelease. A version
   already on npmjs is skipped, so a failed run can be re-run. With the secret
   `NPM_TOKEN` set it publishes with that token; without it, through npm
   trusted publishing.
4. **extension**: `vsce publish --packagePath` (secret `VSCE_PAT`) and `ovsx
   publish --trusted-publishing --packagePath` (OIDC, no secret), duplicates
   skipped. A
   prerelease is not listed (the Marketplace takes major.minor.patch only).
5. **github**: the GitHub release, with the changelog's section, the `.vsix`
   files, a `.sha256` for each and `SHA256SUMS.txt`.

Run it by hand (Actions, Release, Run workflow) to build and check
everything without publishing.

**What must exist first** (owner's set-up):

- the GitHub environment `release` (Settings, Environments), with the
  maintainers as required reviewers: the publishing jobs wait for an
  approval;
- for the first release, the secret `NPM_TOKEN` in that environment: a
  granular npm token that may publish the `@protoboardai` packages, with
  bypass-2FA, short-lived. npm accepts a trusted publisher only for a package
  that exists, so the first release uses the token;
- after it, on npmjs, for each `@protoboardai/*` package: a trusted publisher
  with the organisation `Delta-Robotics-Inc`, the repository
  `protoboard-stack`, the workflow `release.yml` and the environment
  `release`; then delete `NPM_TOKEN`;
- `VSCE_PAT`: an Azure DevOps personal access token of the Marketplace
  publisher `deltarobotics` (organisation: All accessible organisations,
  scope Marketplace: Manage);
- on open-vsx.org, the namespace `deltarobotics` (`npx ovsx create-namespace
  deltarobotics` once) with a trusted publisher (Settings, Trusted
  publishers): the repository `Delta-Robotics-Inc/protoboard-stack`, the
  workflow `release.yml` and the environment `release`. No secret. Then set
  the repository variable `OPENVSX_PUBLISH` to `true`; until then the release
  skips Open VSX with a warning.

## The local flow: `scripts/ci-stack.sh`

The script below predates the public repository: it expects `protoboard-cloud/` beside the others, as the private workspace has it.

The clean-clone flow for the whole stack. GitHub Actions runs it in
protoboard-stack, and it runs the same way locally.

**No account is needed.** Local work (check, build, dev, layout, views,
operations, release) never asks for one, and the cloud steps here use
local parts services that sign no one in (`PB_CLOUD_AUTH=none`). Nothing has
to be turned off: the `PROTOBOARD_SIGN_IN` variable of 0.1.x is gone.
`ci-stack.sh` and `vitest.config.ts` set `PROTOBOARD_CONFIG_DIR` to a
temporary folder, so they never read or write the sign-ins or `access.json`
of the person running them. Nothing they run reaches the hosted Protoboard
library, which a project without `cloud.url` uses by default:
`scripts/test/no-hosted-service.mjs`, loaded into every Node process, fails
such a request as a service that does not answer, and the run lists the
requests it blocked at its end. A test that needs a service names its own
(`cloud.url`, `PROTOBOARD_CLOUD_URL` or `--url`). `packages/cli/test/access.test.ts` runs the
cloud commands signed out, signed in, not invited and against an open
service, all against a stand-in. A project's own CI that adds library parts
from the hosted library sets `PROTOBOARD_CLOUD_TOKEN` (the service token) or
signs in with `protoboard login --device`. The service token goes to the
hosted service's origin only; a CI that uses another service (a staging one,
or one on the runner) lists its origin in `PROTOBOARD_CLOUD_TOKEN_ORIGINS`.

```sh
scripts/ci-stack.sh [--with-cad] [--registry] [workspace]
```

`workspace` is the directory holding the four repositories (default: the
parent of this repository). The steps, in order:

1. **Workspace.** The four checkouts exist (their branch and commit are
   printed) and Node is 22 or later.
2. **uhd.** `npm ci`, `npm run build`, `npm run build:library`. UHD's own
   tests run in its own workflow, not here.
3. **protoboard-cloud.** `npm ci` at its root, for the service (the parts
   tests start it). Its own tests run in its own repository. The client the
   stack links, `client/`, has no dependencies and needs no install.
4. **protoboard-stack.** `npm ci` (its `overrides` link `../uhd`,
   `../protoboard-cloud/client` and `../uhd-viewer`, so uhd and the cloud come first).
5. **Every example** (`examples/*/protoboard.config.ts`): `protoboard check`
   fails on any error and lists every warning by code; `protoboard build`
   writes the build output.
6. **protoboard-stack.** `npm run typecheck`, `npm test`, and `protoboard
   evals --ci`: every extension's eval cases replayed with their known-good
   steps ([evals](guides/evals.md)). `npm test` skips those cases here
   (`PROTOBOARD_SKIP_EVAL_CASES=1`) so they run once; cases whose tools are
   missing (CAD without `--with-cad`, Chrome) are listed as skipped.
   Then the **brand spelling** check, in each of the four repositories:
   `scripts/check-brand-spelling.mjs --root <repo>` fails on the old spelling
   with a capital B (the name is "Protoboard") in any tracked file, apart from
   the occurrences the repository's `scripts/brand-spelling-allowlist.json`
   keeps on purpose, each with its reason. `npm run lint:brand` runs
   it alone, and `npm test` includes it in protoboard-stack and protoboard-cloud.
   Then the **npm scope** check, the same way:
   `scripts/check-npm-scope.mjs --root <repo>` fails on the stack's former
   npm scope, `@protoboard` (as `@protoboard/…`, an `.npmrc` line, or a quoted
   or escaped name), in any tracked text file. The packages are
   `@protoboardai/…` since 2026-10-06, because the `@protoboard` organisation
   on npmjs belongs to someone else. `scripts/npm-scope-allowlist.json`
   names each class kept on purpose with its reason: records of what ran under
   the old names (operation records, eval scorecards, the 0.1.0 release
   notes), and the code and documents that recognise the old scope to explain
   the rename. An entry
   that keeps nothing fails too. `npm run lint:scope` runs it alone, and
   `npm test` includes it in protoboard-stack and protoboard-cloud.
   Then the **licence files** check, in uhd-viewer and protoboard-stack:
   `scripts/check-licence-files.mjs --root <repo>` fails when the repository
   lacks `LICENSE` (the unchanged Apache-2.0 text), `NOTICE`,
   `CONTRIBUTING.md`, `DCO` or `TRADEMARKS.md`, when a tracked `package.json`
   does not say `"license": "Apache-2.0"`, or when a package that ships (it
   has a `files` list, or it is the VS Code extension) would not carry
   `LICENSE` and `NOTICE` in its tarball or `.vsix`. In protoboard-cloud
   only the client is open source (decided 2026-10-23), so the check runs per
   package there: `--root . --package client` fails when `client/` is not
   `"license": "Apache-2.0"`, lacks the unchanged Apache-2.0 `LICENSE` or a
   `NOTICE`, or does not list both in `files`, and when the root package (the
   service, `@protoboardai/cloud-service`) is not
   `"private": true` or has a `files` list. `npm run lint:licence` runs it alone,
   and `npm test` includes it in protoboard-stack.
   Then the **alpha superseded** check, in protoboard-stack:
   `scripts/check-alpha-superseded.mjs` fails when what is delivered to users
   or their agents (the project templates, the skills, the MCP server's text,
   the CLI's and the extension's messages, the downloads site, the documents
   handed to testers: the `DELIVERED` list in the script) presents the older
   web app, "the alpha", as part of how anything is built: its name, its
   sites, its `*.protoboard` board files, ProtoPart as a format, its MCP
   tools. It does not read `docs/specs`, `protocols/`, tests or code
   comments. `scripts/alpha-superseded-allowlist.json` lists what is kept on
   purpose, each with its reason (the warning that Protoboard is not the
   alpha web app; the same words meaning something else); an entry that keeps
   nothing fails too. `npm run lint:alpha` runs it alone, and
   `packages/cli/test/alpha-superseded.test.ts` runs it in `npm test`.
7. **CAD (optional).** See below.
8. **uhd-viewer.** `npm ci`, `npm run type-check`, `npm run build`.
9. **Registry (optional, `--registry`).** Starts the local Verdaccio registry
   if none answers (`registry/start.sh`, Docker), publishes every package
   (`scripts/registry/publish-stack.mjs --replace`) and runs
   `scripts/registry/smoke.sh`: the reference projects, copied outside the
   workspace, install from the registry only, check and build; with
   `PROTOBOARD_CLOUD_URL` set, each project template is initialised, checked
   and built the same way ([local registry](guides/local-registry.md)). In
   GitHub Actions, run the workflow by hand with **registry** checked.

Each step prints in its own section (a collapsible group on GitHub Actions).
The run ends with a summary table, also written to the Actions job summary.
Any failed step fails the run with exit code 1. Steps that depend on a failed
step are skipped and listed as skipped.

`npm ci` replaces each repository's `node_modules`. Run the script on a
workspace whose installs you can afford to rebuild.

### The Python CAD steps

The frame, hardware and harness generators need Python with build123d. Their
tests run only when the script is given `--with-cad` **and** finds such a
Python: `PROTOBOARD_PYTHON`, else the quadcopter example's project runtime
(`examples/quadcopter-5in/.protoboard/tools/cad/bin/python`, from `protoboard
tools install cad`), else the older shared venv `<workspace>/uhd/.venv-cad/bin/python`
(UHD ignores it; kept so existing machines keep working), else `python3`. The
tests find their Python the same way (`packages/core/test/cad-python.ts`). With both, the script exports `PROTOBOARD_PYTHON` for the tests
(the frame-cad and hardware-cad runtime tests, and the harness generator and
capability tests, run instead of being skipped) and checks that `protoboard doctor` finds the runtime for every
CAD extension. Without them, the script sets `PROTOBOARD_PYTHON` to an empty
value so the tests skip even when one of those venvs exists, and the summary lists
the CAD steps as skipped with the reason.

The other tools doctor lists (Chrome and poppler for `@protoboardai/ext-docs`)
are shown but not required. The documents test checks the committed documents
against the model either way, and runs the verifier only when both are
present.

On GitHub Actions the CAD steps are off for pull requests and pushes. Run the
protoboard-stack workflow by hand with **cad** ticked to install Python 3.12,
`build123d==0.13.0` and scipy into a temporary venv and pass `--with-cad`.

### Vendor CAD the catalog does not carry

The GNSS module's vendor CAD (Matek's M9N-5883 STEP and the GLBs converted
from it) is not distributed: its terms are not stated (UHD
`docs/geometry-artifacts.md`), UHD gitignores
`library/parts/*/artifacts/cad/vendor/` and `library/parts/*/.research/`, and
the parts service's revision of `matek-m9n-5883` lists those files under
`missingArtifacts` instead of carrying them. The Adafruit boards in
`uno-motor-bench` are in the same position. Since the examples vendor their
catalog parts from the parts service, every checkout lacks them:
`protoboard check` reports each one as a `PB_ARTIFACT_UNAVAILABLE` warning
that quotes the revision's reason, and the harness router has no GNSS body to
route around.

Two tests accept exactly that, and nothing else:

- `packages/core/test/project.test.ts` expects the quadcopter's only warning
  to be `UHD_PROPULSION_CURRENT`, apart from `PB_ARTIFACT_UNAVAILABLE` for an
  absent file under a `vendor/` or `.research/` directory. Any other new
  warning, or an unavailable artifact elsewhere, still fails.
- `packages/ext-harness-cad/test/harness-cad.test.ts` expects no routing-job
  problems, apart from a missing body whose GLB is such an absent vendor file.
  Its regeneration tests use cables routed before the GNSS lead (the SH8
  cable, the XT60 lead), whose routes do not depend on the GNSS body.

If a later catalog revision carries the files (once their redistribution is
cleared), the same tests see no such warnings and pass unchanged.

That has happened for the GNSS module: revision 3 of `matek-m9n-5883`
 carries its vendor files with their terms, and the
quadcopter pins it, so `protoboard check` on the quadcopter reports no
`PB_ARTIFACT_UNAVAILABLE` (0 errors, 1 warning: `UHD_PROPULSION_CURRENT`).
The Adafruit boards in `uno-motor-bench` still lack theirs (7 such
warnings), and the tests keep their allowance.

## Run it locally

```sh
mkdir stack && cd stack
git clone https://github.com/Delta-Robotics-Inc/uhd.git
git clone https://github.com/Delta-Robotics-Inc/uhd-viewer.git
git clone https://github.com/Delta-Robotics-Inc/protoboard-stack.git
(cd uhd && npm ci && npm run build)
(cd uhd-viewer && npm ci && npm run build)
cd protoboard-stack && npm ci
npm run typecheck && npm test
node .github/scripts/release.mjs version
node .github/scripts/release.mjs packages --repository Delta-Robotics-Inc/protoboard-stack
```
