# Update and vulnerability check

Protoboard checks what is installed on your machine for newer Protoboard releases, known vulnerabilities and lookalike packages, and tells you. **It never installs or updates anything.** A finding names the command; you run it when you are ready (PB-1168).

Defaults marked DEFAULT were taken in the overnight build of 2026-11-01 and are open to review.

## Commands

| Command | What it does |
|---|---|
| `protoboard inventory [--json]` | What is installed, offline: the stack the project uses, the stack's npm dependency set, the managed runtimes, Node and Python, the VS Code extension. Schema `protoboard.inventory/v0`. |
| `protoboard update check [--json] [--force]` | The check for the project here. Without `--force`, a result from the last day is shown again with no network; `--force` checks now. Exit code 1 when something installed is vulnerable or on the deny list, else 0. |
| `protoboard update status [--json]` | Whether the check is on and why, the last run, when the next is due. |
| `protoboard update on` / `off` | The machine-wide switch, in `<config dir>/update-check.json`. |

`--json` prints the inventory or the result (schema `protoboard.update-check-result/v0`) on stdout. A notice after another command goes to stderr, never into `--json` output.

## What the inventory lists

| Component | Read from |
|---|---|
| `@protoboardai/*` and `@deltarobotics/*` the project uses, with versions (roles `stack`, `extension`, `uhd`) | the project's `node_modules` (through the stack copy's links); outside a project, the stack running the command |
| The stack's npm dependency set (role `dependency`; `dev: true` for a checkout's tooling) | npm's hidden lockfile `node_modules/.package-lock.json` when present, else a bounded scan of the `package.json` files in that `node_modules` (at most 20,000 packages, DEFAULT). Links are not followed except for our own scopes; a package marked `"private": true` is left out. |
| Managed runtimes: every Python package of the CAD runtime (role `runtime:cad`, `pinned: true` for the stack's exact pins), Node runtime pins, each interpreter's version | `<project>/.protoboard/tools/tools.json` |
| Node's version; `PROTOBOARD_PYTHON --version` when that variable is set (3 s timeout) | the running process |
| The VS Code extension's version | the extension itself when it asks, else the folder names under `~/.vscode/extensions`, `~/.vscode-insiders`, `~/.cursor`, `~/.windsurf`, `~/.vscode-oss` (names only) |

No path and no project name appears in the inventory. Every file read is size-capped (1 MB per JSON file, 32 MB for the hidden lockfile).

## Sources and request shapes

The check talks to two hosts only, over https; any other URL is refused before a request is made (DEFAULT). Each request has a 10 s timeout (DEFAULT) and the whole check a 30 s budget (DEFAULT). Every response body is read as a stream and cut at a size cap.

| Question | Request |
|---|---|
| Is there a newer Protoboard? | `GET https://registry.npmjs.org/-/package/<name>/dist-tags` for each installed `@protoboardai/*` and `@deltarobotics/*` package (scoped names as `@scope%2fname`). A 404 means not on the public registry (`notPublished` in the result). |
| Is an installed version vulnerable or malicious? | `POST https://api.osv.dev/v1/querybatch` with `{"queries":[{"package":{"ecosystem":"npm","name":"lodash"},"version":"4.17.20"}, ...]}`, up to 1000 queries per request, for every registry npm package and every Python runtime package (`"ecosystem":"PyPI"`). OSV answers with ids only. |
| How bad, and what fixes it? | `GET https://api.osv.dev/v1/vulns/<id>` for at most 50 ids per check (malicious `MAL-` ids first): summary, aliases (GHSA, CVE), severity from `database_specific.severity`, fixed versions from the affected ranges. |

What is sent: package names and versions, and a user-agent `protoboard-update-check/<stack version>`. Never project names, paths, file contents or tokens. Newer versions of third-party libraries the stack pins are not end-user findings (a pin moves only in a stack release, through the vetting gate) and the registry is not asked about them.

The request shapes were written from the public API documentation (google.github.io/osv.dev, the npm registry's dist-tags endpoint); no code was copied. They were run live once on 2026-11-01 (progress.md, W4-A).

## Findings

| Kind | When | Shown as |
|---|---|---|
| `vulnerable` | an OSV advisory names the installed exact version; `MAL-` ids rank as `malicious`, above any severity | a warning toast (any severity but `low`) naming the advisory id, the fix version when the advisory lists one |
| `lookalike` | a name on the deny list (severity `critical`), on the watch list, or close to a name we use (`warning`) | a warning toast for a deny-list hit; otherwise an info toast. Nothing is deleted. |
| `update-available` | a newer `latest` for a Protoboard package | an info toast, at most once a week (DEFAULT) |

The result's `status` is the worst finding (`vulnerable`, `lookalike`, `update-available`, `ok`), or `off` / `offline` when nothing was asked.

## When it runs

- On demand: `protoboard update check`.
- In VS Code: 2 to 10 minutes after the extension starts (random, DEFAULT), when due, then at most one toast. Buttons: **Show** (the details in a read-only Markdown preview), **Later** (quiet for a day, DEFAULT), **Don't show for this version** (kept per finding and version).
- After a CLI command (when the CLI wires it in): open findings are printed once each on stderr, and a due check starts as a detached background process. Never after `update`, `inventory`, `mcp`, `dev` or `telemetry`; the MCP server never puts it into tool text.
- Due means: the last success plus 24 h plus a random jitter of up to 6 h (DEFAULT). After a failure: 1 h, then 4 h, then the normal day.
- It never blocks or fails a build: the automatic run is a background task whose errors are swallowed. With no network it degrades silently (`status: "offline"`).

## State file

`<project>/.protoboard/local/update-check.json` (git-ignored by every project `protoboard init` makes), schema `protoboard.update-check/v0`:

| Field | What |
|---|---|
| `lastAttempt`, `lastSuccess`, `nextDue` | ISO times |
| `failures` | consecutive failed runs |
| `result` | the last result (the same JSON `update check --json` prints) |
| `dismissed` | finding key (`kind:ecosystem:name`) → the version the person said not to show again |
| `shown` | finding key → the version the CLI last printed |

The CLI and the VS Code toast read and write the same file. The toast's "Later" and weekly limit are kept in the extension's `globalState`.

## Turning it off

Any of these turns it off. Off means **nothing is sent**, even with `--force`; local lookalike findings are still reported by an explicit `update check`.

- VS Code setting `protoboard.updates.check: false` (default on)
- `protoboard update off`
- `PROTOBOARD_NO_UPDATE_CHECK=1`, `PROTOBOARD_UPDATE_CHECK=off`, or `NO_UPDATE_NOTIFIER` set

Automatic runs are also off when `CI` is set and under a test runner (`VITEST`, `NODE_ENV=test`). The check has no coupling to telemetry: the telemetry setting neither turns it on nor off, and it records nothing in the telemetry folder.

## The lookalike deny list

Data, not code: `packages/core/reference/lookalikes.json` (schema `protoboard.lookalikes/v0`, exported as `@protoboardai/core/reference/lookalikes.json`), updated each release. Every entry carries a comment citing its source.

- `deny`: exact names that impersonate a library we use (seeded from the renderer research note, section 4.1 item 6: `vaps-transform`, `cbim-three-mesh-bvh`, `@wendraw/three-bvh-csg`, `@sunbox/occt-import-js`, `@ohos-ports/gltf-transform-cli`, `@bitruvius/meshopt`, `@3dverse/livelink-camera-controls`). Install and fetch paths that consult `checkPackageName` refuse them.
- `watch`: reported, never refused.
- `protect`: the real names (`three`, `three-mesh-bvh`, `@gltf-transform/core`, `@gltf-transform/functions`, `meshoptimizer`, `occt-import-js`, `@deltarobotics/uhd`, `@protoboardai/*`, `build123d`, ...). The generic rule flags another name within edit distance 1 to 2 (1 for names under 6 characters), the same name under another scope, a `-js`/`.js` suffix change, or `<prefix>-<name>` around a name of 8 characters or more, and any scope within distance 2 of `@protoboardai`.
- `allow`: real packages that sit near a protected name.
- `repos`: pinned owners for repositories we point people at (REA must be `morluto/rea`).

The rule raised nothing on the stack's 553 real dependency names (2026-11-01).
