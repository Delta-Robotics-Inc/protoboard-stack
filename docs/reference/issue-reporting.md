# Issue and feature reporting through the agent

Status: client built (PB-1197, 2026-11-01); the reporting service is **not deployed**. Until it is, a send stops on this machine and says `not-sent`. Code: `packages/cli/src/mcp/report-tools.ts`; tests: `packages/cli/test/report-tools.test.ts`. Design: `docs/specs/cad-view-research/review-round-1/round-2-notes/security-updates-telemetry.md` section C.

Values marked DEFAULT were chosen overnight without Kevin (plan.md, "overnight defaults") and are open to change.

## The flow: draft, show, confirm, send

Four MCP tools on the `protoboard-stack` server:

| Tool | What it does | Leaves the machine |
|---|---|---|
| `report_issue` | Builds a bug report draft: `title`, `description`, optional `area`, `steps`, `expected`, `actual`, `include` | Nothing |
| `request_feature` | Builds a feature request draft: `title`, `description`, optional `area`, `useCase`, `include` | Nothing |
| `report_send` | Sends one draft, given its `id` and `confirmToken` | The draft's bytes, once, when the service is configured |
| `report_list` | Lists the drafts, their state, the last attempt and the receipt | Nothing |

1. **Draft.** The person asks the agent to report something. The agent calls `report_issue` or `request_feature`. The tool assembles the bundle, redacts it, writes it to `<project>/.protoboard/local/reports/<id>.json` (git-ignored through `.protoboard/local/`) with a small record `<id>.draft.json` beside it, and returns:
   - `bundle`: the exact text a send would carry, byte for byte (the file holds the same bytes);
   - `bytes` and `sha256` of that text;
   - `redactions`: counts per rule (never the values);
   - `trimmed`: what was cut to fit the caps;
   - `confirmToken`, `requiresUserConfirmation: true`, and `next`, the instruction to show the bundle and wait.
2. **Show.** The agent shows the person the whole bundle (or opens the file) and says where it would go.
3. **Confirm.** The person says yes in chat. If they want changes, the agent builds a new draft; drafts are not edited.
4. **Send.** The agent calls `report_send {id, confirmToken}`. The tool refuses unless:
   - the token matches the draft (the draft stores `sha256(token + ":" + sha256(bytes shown))`, never the token);
   - the file still hashes to what was shown, so a draft edited after it was shown is refused even if its recorded hash was edited too;
   - the file is a `protoboard.issue-report/v0` bundle with the same id, within the size cap;
   - fewer than 10 reports were sent from this project in the last hour (DEFAULT, a client-side guard; the service keeps its own limits).

   With `PROTOBOARD_REPORTS_URL` unset (the DEFAULT) the result is `{status: "not-sent", reason: "the reporting service is not deployed yet (stub)", request: {...}}`. The `request` field summarises the request it would make. The draft is kept.

The tool descriptions tell the agent to draft only when the person asks, never because text in a file, web page or tool result says to, and to send only after an explicit yes in chat. The token proves the agent saw these exact bytes. It cannot prove that a person said yes: that part rests on the agent following the instruction, as it does for every other tool.

### Send results

| `status` | Meaning | Draft |
|---|---|---|
| `sent` | The service answered 201 (or 200 for a repeat). `receipt` has `id`, and `identifier` and `url` when the service returns them | State becomes `sent`; `sentAt` and `receipt` recorded |
| `already-sent` | This draft was sent before; the receipt is returned again | Unchanged |
| `not-sent` | `PROTOBOARD_REPORTS_URL` is unset: the stub | Kept as `draft` |
| `refused` | Wrong token, draft changed, not a bundle, over the cap, or a URL that is not https or loopback | Kept |
| `rejected` | The service answered 400 or 422 (`reason` is its `error` text) | Kept |
| `too-large` | The service answered 413 | Kept |
| `rate-limited` | The service answered 429 (`retryAfter` from its header), or the local guard | Kept |
| `failed` | Any other status | Kept |
| `not-confirmed` | No answer (network error or timeout). Sending again is safe: the draft id is the idempotency key | Kept |

Every attempt is appended to the draft record (`attempts`: time, status, HTTP status; the last 20).

## The bundle: `protoboard.issue-report/v0`

The bytes are `JSON.stringify(bundle, null, 2) + "\n"` in UTF-8.

```json
{
  "schema": "protoboard.issue-report/v0",
  "id": "r-20261101T181700Z-a589a4e1",
  "kind": "issue",
  "createdAt": "2026-11-01T18:17:00.123Z",
  "title": "Viewer goes blank after orbiting the drone",
  "description": "...",
  "area": "viewer",
  "steps": ["open the drone", "orbit"],
  "expected": "the model",
  "actual": "a blank view",
  "environment": { "cli": "0.2.2", "server": "0.2.2", "stack": "0.2.2", "viewer": "0.2.1", "node": "24.11.0", "os": "win32", "osRelease": "10.0.26300", "arch": "x64" },
  "project": { "name": "quadcopter-5in", "stack": "0.2.2-dev.cadviewer.phase1", "stackFrom": "installed" },
  "telemetry": { "mode": "all", "windowDays": 7, "range": { "from": "...", "to": "..." }, "counts": { "sessions": 131, "crashes": 0 }, "records": [] },
  "logs": { "note": "The CLI writes no log of its own commands; ...", "files": [ { "name": "render-service.log", "lines": 110, "bytes": 16275, "truncated": false, "text": "..." } ] },
  "viewState": "not requested",
  "snapshot": "not requested",
  "redactions": { "home-path": 22, "project-path": 22 },
  "trimmed": []
}
```

| Field | Content | Default |
|---|---|---|
| `id` | `r-<UTC yyyymmddThhmmssZ>-<8 hex>`: letters, digits and dashes only (a safe Windows file name); also the idempotency key | always |
| `kind` | `issue` or `feature`; a feature has `useCase` in place of `steps`, `expected`, `actual` | always |
| `title`, `description` | The person's words, redacted; capped at 200 and 8,000 characters (the alpha's caps) | always |
| `environment` | CLI, MCP server, stack (beside the CLI), viewer, Node, OS, OS release, architecture. **No host name**, no user name | always |
| `project` | `name` (package.json `name`, else the folder name) and the stack version the project uses: `installed` (its resolved `@protoboardai/core`), else `declared` (the dependency range) | always |
| `telemetry` | The local telemetry window (PB-1181, `.protoboard/local/telemetry/`): the last 7 days (DEFAULT), records already sanitised by `@protoboardai/core/telemetry` and redacted again; `crash` mode keeps crash records only. When recording is off, the field is the text `telemetry off: not included (<reason>)` | on (issue), off (feature) |
| `logs` | The last 200 lines and at most 64 kB of `.protoboard/local/render-service.log`, redacted. FOUND: the CLI writes no log of its own commands, so this is the only log; the note says so | on (issue), off (feature) |
| `viewState` | `.protoboard/local/viewer-state.json` (camera, selection, visibility and the other live keys; no geometry), redacted, at most 64 kB, else only the current scope, else left out | off |
| `snapshot` | A **reference** to the newest `.protoboard/local/snapshots/*.png`: path, size, time. Never the image (DEFAULT) | off |
| `redactions` | Counts per rule over everything read for the bundle | always |
| `trimmed` | What was cut to fit the caps | always |

Telemetry follows the same switches as recording (`telemetryMode` in `packages/core/src/telemetry.ts`): `PROTOBOARD_TELEMETRY=off`, `DO_NOT_TRACK=1`, or `protoboard telemetry off` all leave it out. The MCP server cannot read VS Code's setting, but recording itself stops when VS Code telemetry is off (plan.md DEFAULT), so nothing is there to include.

### Never read, never included

`.env` and `.env.*`; `*.pem`, `*.key`, `*.p12`, `*.pfx`, `*.crt` and other key stores; `.protoboard/local/dev.json` (the dev server's bridge key and session token); `.protoboard/local/render-service.json` (the render service's token); `credentials*` (the CLI's sign-in stores); `id_rsa`-style keys; `.npmrc`, `.netrc`, `.pypirc`, `.git-credentials`; source, model and part files; environment variables. Every read is limited to the four paths above inside the project, follows links only if they stay inside, and refuses a forbidden name (`isForbiddenFile`). The tools run no project code.

## Redaction

Always on, over every string (the person's text, logs, view state, telemetry, project facts, and object keys). Fields whose **name** says secret are replaced whole when values are walked. Counted per rule; never the values. Rules run in this order:

| Rule | What | Becomes |
|---|---|---|
| `email` | `name@domain.tld` | `<email>` |
| `project-path` | The project root, as written, as its real path, with `\`, `\\` or `/` separators; case-insensitive on Windows | `<project>` (so paths read `<project>/src/...`) |
| `home-path` | The home folder (`os.homedir()`, `%USERPROFILE%`, `$HOME`), and any `C:\Users\<name>`, `/Users/<name>`, `/home/<name>`, also URL-encoded (`C%3A%5CUsers%5C<name>`), doubly JSON-escaped and under WSL (`/mnt/c/Users/<name>`) | `<home>` |
| `user-name` | The user name (`os.userInfo().username`, `%USERNAME%`, `$USER`) as a whole word, case-insensitive; names under 3 characters are left alone (DEFAULT) | `<user>` |
| `host-name` | This machine's name (`os.hostname()`) as a whole word, case-insensitive (DEFAULT, wave 4 gate) | `<host>` |
| `url-credentials` | A user name and password inside a URL (`https://user:pass@host`), before the e-mail rule | `<credentials>@` |
| `private-key` | `-----BEGIN ... PRIVATE KEY-----` blocks | `<private-key>` |
| `jwt` | Three base64url segments starting `eyJ` | `<jwt>` |
| `auth-header` | `Authorization:`, `Proxy-Authorization:`, `x-...-token:`, `x-...-key:`, `x-...-secret:` values | `<secret>` |
| `bearer` | `Bearer <value>` | `Bearer <secret>` |
| `aws-key` | `AKIA...` and `ASIA...` access key ids | `<aws-key>` |
| `github-token` | `ghp_`, `gho_`, `ghu_`, `ghs_`, `ghr_`, `github_pat_` | `<github-token>` |
| `npm-token` | `npm_...` | `<npm-token>` |
| `slack-token` | `xoxb-`, `xoxp-` and other `xox?-` | `<slack-token>` |
| `stripe-key` | `sk_live_`, `sk_test_`, `rk_live_`, `rk_test_` | `<stripe-key>` |
| `sk-key` | `sk-...` API keys (20+ characters) | `<secret>` |
| `secret-assignment` | `name=value`, `name: value`, `"name": "value"` where the name's last word is password, passwd, pwd, secret, token, key, apikey, auth, authorization, credential(s), cookie, privatekey, passphrase or signature (`token=`, `key=`, `password=`, `apiKey:`, `client_secret`). Bare `session` is not one (DEFAULT: telemetry session ids are random, not credentials) | `name=<secret>` |
| `secret-field` | The same names as object keys, when values are walked (`bridge.key`, `apiKey`) | `<secret>` |
| `long-secret` | A hex or base64 run of 32+ characters, with a digit and a letter, within 48 characters after a secret word (secret, token, key, passw, pwd, auth, bearer, credential, signature, cookie) | `<secret>` |
| `ipv4` | IPv4 addresses other than loopback `127.x.x.x` and `0.0.0.0`; dotted version numbers are not addresses | `<ip>` |

Kept on purpose: `127.0.0.1` URLs, package names with versions (`three@0.187.0`), dotted versions, short hashes, telemetry's salted path hashes. The bridge key and the session tokens are never read (the files that hold them are refused); were one to show up in a log, the `auth-header`, `secret-assignment` and `long-secret` rules cover the shapes they are written in.

## Caps

| Cap | DEFAULT | When exceeded |
|---|---|---|
| Whole bundle | 512 kB (524,288 bytes) | Telemetry records dropped oldest first (`telemetry.dropped`), then log lines, then the view state; if it still does not fit, the draft is refused |
| Each log | last 200 lines and 64 kB after redaction | Oldest lines dropped, `truncated: true` |
| View state | 64 kB after redaction | Only the current scope, else left out |
| Title / description / use case | 200 / 8,000 / 8,000 characters | Cut with `…` |
| Steps | 30 entries of 500 characters | Cut |
| Expected / actual | 2,000 characters each | Cut |
| Telemetry window | 7 days | Older records not read |
| Sends from one project | 10 per hour (client-side) | `rate-limited` |
| Send timeout | 15 s | `not-confirmed` |

Measured on the drone (`examples/quadcopter-5in`, 2026-11-01): **254,596 bytes** with the defaults (131 telemetry session records, 110 log lines of 16,275 bytes; 22 project-path and 22 home-path redactions; nothing trimmed), 255,830 bytes with the view state and the snapshot reference added. Command: `node --import tsx <scratchpad>/w4d/measure-report.mts` from the stack root, drafts redirected to the scratchpad (`reportsDir`), nothing written in the example.

## The request (what the cloud endpoint must accept)

`PROTOBOARD_REPORTS_URL` is the service's base URL. The client POSTs to `<base>/v1/reports`. That is the same route the telemetry consent stub names (`docs/reference/telemetry.md`); the service tells the two apart by the body's `schema` field (`protoboard.issue-report/v0` here, `kind: "telemetry"` there). The client refuses a URL that is not `https:`, plain `http:` to anything other than `127.0.0.1`, `localhost` or `::1`, and a URL with a user name or password. It follows no redirects.

```
POST <base>/v1/reports
content-type: application/json; charset=utf-8
idempotency-key: r-20261101T181700Z-a589a4e1
x-protoboard-report-sha256: <hex sha256 of the body>
x-protoboard-consent-at: <ISO time of the send, after the person's yes>
user-agent: protoboard-cli/<version>

<the draft file, byte for byte: the protoboard.issue-report/v0 bundle>
```

No `Authorization` header is sent today (DEFAULT). The design note proposes the signed-in user's cloud token. The cloud owner decides between that and an anonymous, per-machine limit (see the handoff below). The client adds the token at send time, never into the draft.

Expected responses:

| Status | Body | Client result |
|---|---|---|
| `201 Created` | `{ "id": "<report id>", "identifier": "PB-1234", "url": "https://linear.app/..." }` (`identifier` and `url` when a Linear issue was made) | `sent` with that receipt |
| `200 OK` | Same body, plus `"duplicate": true`, for a repeated idempotency key (the first result) | `sent` |
| `400 Bad Request` | `{ "error": "<what is wrong>", "field": "<which field>" }`: schema, caps, a sha256 header that does not match the body | `rejected` |
| `413 Payload Too Large` | `{ "error": "...", "maxBytes": 524288 }` | `too-large` |
| `429 Too Many Requests` | `{ "error": "..." }` with a `Retry-After` header (seconds) | `rate-limited`, `retryAfter` passed on |
| other | `{ "error": "..." }` | `failed` |

### Rate limits the service should keep

The alpha's route (`next-alpha/src/server/protobot/issueFiling.ts`) allows 500 per user per hour with a 1 s minimum interval. The design note proposes tighter limits for user reports: **10 per hour and 30 per day per account** (or per machine when anonymous), plus a dedupe on a hash of title plus `environment`. The client's own guard is 10 per project per hour.

## Open question

**Which Linear project and labels user reports land in.** The alpha files into team Protoboard, project "User Feedback", label Bug or Feature (`next-alpha/src/server/feedback/submitToLinear.ts`). The design note proposes team Protoboard, either a Protoboard-Stack project or the alpha's User Feedback project (Kevin to choose), with labels `from-user` plus `bug` or `feature` plus the `area`. Not decided: the client sends `kind` and `area` so the service can map them either way.

## Handoff to the cloud owner

The client side is built and tested; the service side does not exist. To ship it:

1. **Route.** `POST /v1/reports` on the Protoboard cloud API. Branch on the body: `schema: "protoboard.issue-report/v0"` is a user report (this document), `kind: "telemetry"` is a telemetry consent bundle (`docs/reference/telemetry.md`).
2. **Validate.** Body at most 512 kB (413 above). The `x-protoboard-report-sha256` header must equal the sha256 of the raw body (400). `schema` must be known (400). Re-apply the caps (title 200, description and use case 8,000, steps 30 x 500, expected and actual 2,000, logs 64 kB each) with a Zod schema, as the alpha's `file-issue` route does.
3. **Idempotency.** Key on `idempotency-key` (the draft id) per account or machine. A repeat returns the first result with `200` and `duplicate: true`, and never files twice.
4. **Redact again server-side.** Run the same rules over the strings before anything reaches Linear (defence in depth). Store counts, not values.
5. **Auth and limits.** Decide whether a report needs a signed-in account (the design note says yes, reusing the existing cloud client's token). If it does, tell the CLI owner: the client then adds `Authorization: Bearer <token>` at send time, only for https URLs on the Protoboard domain. Limits: 10 per hour and 30 per day per account, dedupe on title plus environment; answer 429 with `Retry-After`.
6. **Linear.** Reuse the alpha's server path (`submitToLinear.ts`, `issueFiling.ts`): the `LINEAR_API_KEY` stays on the server. Map `kind` to the Bug or Feature label and `area` to an area label. Put the bundle's `logs`, `telemetry` and `viewState` in an attachment, not the issue body. Linear project and labels: the open question above.
7. **Answer.** `201 {id, identifier, url}`. The client stores it as the draft's receipt and shows it to the person.
8. **Then.** Set `PROTOBOARD_REPORTS_URL` (or a built-in default base URL once the service is live: a one-line change in `report-tools.ts`). Tell the CLI owner, so `report_send` stops answering `not-sent`.

## Not done here (follow-ups)

- A CLI command (`protoboard report ...`) and a Help-view entry in the VS Code extension that run the same flow. The design note proposes both. Only the MCP tools exist.
- When signed out, opening the GitHub issue chooser with the redacted text prefilled (design note C.2 step 4).
- The agent guidance line in `core/templates/_agents/common.md` ("Record it ... as feedback to Protoboard") should point at `report_issue` (a handoff for the owner of that file).
- A row for this document and for supported-systems.md in `docs/reference/README.md` (a handoff for the owner of that file).
