# Local telemetry

Protoboard records crash and performance data of its viewer **on your machine only**. Nothing is sent. A report leaves the machine only after you have seen exactly what it carries and approved it, and in this release the send step is a stub that sends nothing (PB-1181).

## What is recorded, and where

| Writer | When | File |
|---|---|---|
| The VS Code extension host | a viewer tab posts its session record (the webview cannot write files) | `<project>/.protoboard/local/telemetry/<yyyy-mm-dd>.jsonl` |
| `protoboard dev` | the browser viewer's page posts its session record (`POST /__protoboard/telemetry`, with the session token) | same |
| The CLI | the process dies of an uncaught exception or rejection | same, or `<config dir>/telemetry/<yyyy-mm-dd>.jsonl` outside a project |

`.protoboard/local/` is git-ignored by every project `protoboard init` makes. Dates are UTC. One JSON object per line.

- **Viewer session** (`pb.render-session/v0`): one line when the page closes, plus a partial line (`"partial": true`) each time the page is hidden, after an uncaught error or a lost WebGL context (at most one every 5 s), and when the last 3D view closes. A crash therefore still leaves a record. Readers keep the last line of each session.
- **Crash** (`pb.crash/v0`): the CLI's uncaught exceptions; the command name, never its arguments.

The session record's fields:

| Field | What |
|---|---|
| `session` | a random id for the page's session |
| `start`, `end`, `durationMs` | timestamps |
| `host` | `vscode-webview`, `dev-web`, `vite-web`, `render-service` |
| `versions` | stack, extension, viewer |
| `project` | the project's path as a salted hash (`h:` + 16 hex); the salt is a random value in the project's telemetry folder that never leaves it |
| `gpu` | backend, vendor and renderer strings (`WEBGL_debug_renderer_info`; blank where the browser hides them), software rasteriser or not |
| `viewport` | canvas width and height in CSS pixels, device pixel ratio |
| `load` | GLB count and bytes; the slowest load's whole, fetch, parse and shader-compile times; first frame after the first model (ms from the session start) |
| `scene` | `renderer.info` counts, the most in one frame: draw calls, triangles, points, lines, programs, geometries, textures |
| `frameMs` | frame-time histogram over the edges 8, 16.7, 33, 50 and 100 ms (six counts), p50, p95, frames counted; gaps over 250 ms are idle time (render on demand), not frames |
| `longFrames` | frames over 50 ms (and long animation frames where the browser reports them), the longest |
| `memory` | `performance.memory` peak where Chromium offers it, else `none` |
| `contextLost` | WebGL context lost and restored counts |
| `errors` | count, and the first five: kind, class, a redacted message, a hash of the stack |
| `exit` | `closed`, `hidden`, `crash`, `contextLost` |

**Never recorded**: source text, file contents, geometry, names of parts, file names, text you typed, full paths, environment variables, tokens. Every writer rebuilds each record from the known fields only (`sanitizeRecord` in `packages/core/src/telemetry.ts`); unknown fields are dropped, and every string is redacted: paths become `<path:…>` (salted hash), URLs `<url>`, e-mail addresses `<email>`, quoted strings `<str>` (they carry names), long tokens `<secret>`, at most 160 characters.

**Retention**: 30 days or 50 MB per project, whichever comes first; the oldest day files go first, on every write. A single record is at most 64 kB.

## Turning it off

Recording is on by default. Any one of these turns it off, and nothing turns it back on against another:

| Switch | Where |
|---|---|
| `protoboard.telemetry.local: false` | VS Code settings (the extension) |
| VS Code's `telemetry.telemetryLevel: off` | VS Code settings: VS Code's own telemetry off also stops Protoboard's local recording. `crash` or `error` keeps crash records and sessions that crashed only |
| `protoboard telemetry off` | the CLI and `protoboard dev` (writes `<config dir>/telemetry.json`: `{ "local": false }`) |
| `PROTOBOARD_TELEMETRY=off` | the environment of the CLI, `protoboard dev` or VS Code (`crash`: crash records only) |
| `DO_NOT_TRACK=1` | the environment |

`<config dir>` is `%APPDATA%\protoboard` on Windows, `$XDG_CONFIG_HOME/protoboard` or `~/.config/protoboard` elsewhere, or `PROTOBOARD_CONFIG_DIR`.

## Reading it

```bash
protoboard telemetry            # whether it records, why, and what is stored
protoboard telemetry show       # the records, one JSON line each (--days <n>)
protoboard telemetry clear      # remove the records (consents stay)
```

The files are plain JSON lines: DuckDB reads them as they are (`SELECT * FROM read_json('.protoboard/local/telemetry/*.jsonl')`).

## Consent to send

```bash
protoboard telemetry export                   # prints the redacted bundle whole and writes it to a file (--out <file>, --days <n>)
protoboard telemetry export --send            # the same, then the send step (a stub in this release)
```

`export` assembles the bundle (`pb.telemetry-bundle/v0`), prints every byte of it, writes it to `--out` or `.protoboard/local/telemetry/export-<time>.json`, and prints its SHA-256. `--send` is the consent to send that exact bundle: it records the consent in `.protoboard/local/telemetry/consents.jsonl` (`pb.telemetry-consent/v0`: date, bundle SHA-256, record count, destination, `sent`) and prints the request below. **In this release nothing is sent** (`sent: false`): the service endpoint does not exist yet. There is no standing "always send".

Agents use the MCP tool `telemetry_export` the same way: without `send` it returns the bundle; with `send: true` it also needs `confirm: true`, given only after the person has seen that bundle.

### The bundle

```json
{
  "schema": "pb.telemetry-bundle/v0",
  "createdAt": "2026-11-01T12:00:00.000Z",
  "project": "h:1f2e3d4c5b6a7980",
  "inventory": { "stack": "0.2.2", "cli": "0.2.2", "viewer": "0.2.1", "extension": "0.2.2", "node": "24.11.0", "os": "win32", "arch": "x64" },
  "range": { "from": "2026-10-28T09:12:44.120Z", "to": "2026-11-01T11:58:02.004Z" },
  "counts": { "sessions": 12, "crashes": 1 },
  "records": [ { "schema": "pb.render-session/v0", "...": "as above" }, { "schema": "pb.crash/v0", "...": "as above" } ]
}
```

The SHA-256 is taken over the bundle's canonical JSON (keys sorted at every level, no whitespace).

### Send request

The request the client is built against (the service side is not built yet):

```
POST https://api.protoboard.ai/v1/reports
content-type: application/json
x-protoboard-bundle-sha256: <hex>
```

```json
{
  "kind": "telemetry",
  "bundleSha256": "<hex, the bundle's SHA-256>",
  "consent": { "at": "<ISO time the person approved>", "recordCount": 13 },
  "bundle": { "schema": "pb.telemetry-bundle/v0", "...": "as above" }
}
```

The service is expected to:

- recompute the SHA-256 over the canonical JSON of `bundle` and refuse (`422`) when it differs from `bundleSha256` or the header;
- refuse bundles over 5 MB (`413`) and unknown `schema` values (`422`); re-apply the field allow-list of `sanitizeRecord` server-side;
- rate-limit per machine (no account is needed to report a crash);
- answer `201` with `{ "id": "<report id>" }`, which the client stores as the consent's `receipt`.

### The consent line

```json
{ "schema": "pb.telemetry-consent/v0", "at": "2026-11-01T12:00:00.000Z", "bundleSha256": "<hex>", "recordCount": 13, "destination": "https://api.protoboard.ai/v1/reports", "sent": false }
```

## For hosts embedding the viewer

The viewer (`@deltarobotics/uhd-viewer`, `src/telemetry/`) dispatches each record as a `uhd-viewer:telemetry` event on `window` (`detail`: the record) and, in a frame, posts `{ "type": "uhd-viewer:telemetry", "record": … }` to the parent over the host channel. A host page that does not listen records nothing. A host that writes records passes them through `appendTelemetry` (`@protoboardai/core`), which sanitises and prunes, after `enrichViewerRecord` adds the host, the project hash and the versions the page does not know.
