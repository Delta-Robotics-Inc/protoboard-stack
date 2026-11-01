# The 3D view's state and the live-tab bridge

How an agent (the CLI's MCP server, a script) reads and sets what a person
sees in the 3D view: one view-state schema, an op log with version
preconditions, and a local channel from the project's `protoboard dev`
server to the viewer tab that is open. PB-1178; the first slice of the
collaboration design (`docs/specs/cad-view-research/review-round-1/round-2-notes/multi-agent-collaboration.md`,
section D). The agent's view verbs (observe, select, highlight, isolate,
camera, callout, capture) are built on this in PB-1179.

## The view state

One object, schema `uhd-viewer.view-state/v1` (uhd-viewer `src/api.ts`,
`ViewState`; implemented in `src/cad/state/`). The URL, the host's messages,
`window.__cad` and the bridge all read and write the same store.

| Key | What it is | Saved where |
| --- | --- | --- |
| `camera` | `{ position, target, up, fov? }`, mm, the root's coordinates (Z up); `null` until the view has placed one | live |
| `selection` | `{ body?, iface?, component?, mate?, harness? }`, instance paths from the root (a body may be `path#artifact`) | live |
| `highlight` | instance paths drawn with a glow besides the selection (what an agent points at) | live |
| `isolation` | instance paths drawn alone, or `null` | live |
| `visibility` | `labels`, `labelKinds`, `frames`, `wires`, `hardware`, `findings` (`null`: automatic), `xray`, `hidden` (paths) | live |
| `direction` | interface geometry by `feature`, `artifact` or `procedural` binding | live |
| `sections` | section planes `{ axis: 0..2, at: 0..1, flip? }` (the view cuts with the first) | live |
| `explode` | `{ t: 0..1, step: n | null }`; the view eases to `t` | live |
| `namedViews` | saved views by name (camera, and optionally explode, sections, hidden, isolation) | display file, on an explicit save |
| `annotations` | reserved (callouts and marks, wave 3) | display file, on an explicit save |
| `scope` | read-only: the module the view shows (`""` the whole assembly) | |
| `loading` | read-only: `{ phase, total, done, failed }` | |
| `quality` | read-only: `{ mode }`, the render quality curve's state (PB-1176) | |

The live keys are kept **per scope**: a module opened on its own has its own
camera, selection, sections and explode (visibility and direction follow the
person across scopes).

### Where it is saved

- **Live state**: the viewer hands it to its host 400 ms after the last
  change, and at once when the page hides, only when it changed
  (`onViewStateChange`). `protoboard dev` and the VS Code extension host write
  it to `.protoboard/local/viewer-state.json` (git-ignored; schema
  `protoboard.viewer-state/v0`; one entry per scope; two tabs on two modules
  keep each other's). A VS Code tab also keeps it in the webview's own state,
  so a hidden, moved or restored tab comes back where it was. It comes back
  when the view opens again; URL parameters and writes made since the page
  opened win over it. `views check` and the render service keep nothing of
  a person's view.
- **Presentation** (named views, annotations): written to the display file
  (`spatial.views`, `spatial.annotations`, [display.md](display.md)) only on an
  explicit save (`saveView`, `deleteView`), and only when it changed. A camera
  drag never touches a committed file. Diagram positions are written to the
  display file when a drag is dropped, never during it, and only when they
  changed.

### The URL

The 3D view reads (and `toUrlParams` writes) `explode=1`, `dir=`, `labels=1`,
`labelkinds=`, `frames=1`, `wires=0`, `hardware=0`, `findings=0|1`, `xray=1`,
`section=x|y|z`, `at=`, `flip=0|1`, `body=`, `iface=`, `component=`, `mate=`,
`harness=`, `hide=a,b`, `isolate=a,b`, `highlight=a,b`; it opens on `cam=px,py,pz,tx,ty,tz[,ux,uy,uz]`
(exact), `view3d=<named view>`, or `az=`, `el=`, `dist=` (about `up`), and
`focus=1` frames the selection.

## Verbs and batches

Writes are typed verbs (no code is evaluated, no link is followed; text an
agent writes is data):

| Verb | Fields |
| --- | --- |
| `set` | `path` (`"selection"`, `"visibility.labels"`, `["namedViews", "Front"]`), `value` (`undefined` removes an entry) |
| `camera` | `camera` |
| `select` | `selection` |
| `highlight` | `paths` |
| `isolate` | `paths` or `null` |
| `hide` | `paths`, `hidden` (default true; false shows them again) |
| `explode` | `t`, `step?` |
| `section` | `sections` |
| `saveView` | `name`, `view?` (default: the camera, explode, sections, hidden and isolation now) |
| `deleteView` | `name` |
| `applyView` | `name` |

A **batch** is `{ batchId, label, ops, expectSeq?, expectVersions?, state? }`:

- `batchId`: chosen by the caller (1 to 128 of `A-Z a-z 0-9 _ . : -`). A
  resend with the same id returns the first answer (`duplicate: true`); the
  viewer never applies one id twice.
- `label`: 3 to 8 words saying what it does; it goes in the op log.
- `ops`: the verbs, applied in order, all or nothing: every value is checked
  first, and one bad op refuses the batch (`invalid`, with its `index`).
  Empty `ops` is a read.
- `expectSeq`: the `seq` the caller read the whole state at; refused
  (`stale-seq`) when anything was committed since, with the missed range.
- `expectVersions`: `{ key: version }` for the keys the caller read or will
  touch (top-level keys; one named view is `namedViews.<name>`); refused
  (`stale-versions`) when any changed, with each conflict's current value
  and who changed it. Unrelated writes since do not refuse it.

### The op log

Every committed write, the person's own gestures included, appends
`{ seq, time, actor, batchId?, label, ops, inverse, keys, baseSeq? }`. `seq`
is the document version (it rises by one per entry); each key has a
`version` that rises when its value changes. `actor` is `{ kind: "human" | "agent" | "system" | "host", id, session? }`;
a bridge batch is always logged as its session's agent. `inverse` is what puts
the replaced values back (undo per actor, PB-1196, builds on it). A repeated
gesture (a camera drag) replaces its own last entry with a new seq while it
lasts, so seq numbers can have gaps; `missed` lists the entries kept. Facts
(`loading`, `quality`, `scope`) do not take a seq.

### Replies

| `status` | Meaning |
| --- | --- |
| `applied` | `seq`, the `applied` set operations, the `changed` keys, `versions`, and the `state` after it (unless `state: false`) |
| `read` | `seq`, `versions`, `state` (and `observation` when asked: what is drawn, `__cad.observe()` without components) |
| `refused` | `reason` `stale-seq` or `stale-versions`; `missed: { from, to, entries }`; `conflicts` per key. Re-observe, then decide again |
| `invalid` | `error`, and the `index` of the op that could not run |
| `not-run` | from the bridge: nothing reached a tab (no tab open, the delivery failed before it left, the server is not running) |
| `may-have-run` | from the bridge: the batch was delivered and no answer came in time, or the tab closed. Resend with the same `batchId` to learn the outcome |

Replies through the bridge also carry `tab` (which tab answered) and `view`
(`3d` or `diagram`: a batch sent while the diagram is shown still lands and
shows when the 3D view opens).

## The live-tab bridge

```text
agent (MCP server, script)
   │ 1. read .protoboard/local/dev.json  →  url, bridge.key
   │ 2. POST /__protoboard/bridge/session   x-protoboard-bridge-key: <key>   →  { token, session, actor }
   │ 3. POST /__protoboard/bridge           x-protoboard-bridge: <token>     { batchId, label, ops, ... }
   ▼
protoboard dev  ──(event stream, `bridge` event)──▶  the dev page (?tab=<id>)  ─┐
       │                                                                         │ viewer.bridge(envelope)
       └──(event stream /__protoboard/bridge/relay)──▶ VS Code extension host ──▶ the tab's webview
                                                                                 │
       ◀── POST /__protoboard/bridge/reply  (the page's token, or the key) ──────┘
```

- **One endpoint per project**: the dev server. The VS Code extension host
  opens no port of its own; it relays its tabs (one event stream per
  project, authenticated with the key) and posts their replies (DEFAULT).
- **Discovery**: `.protoboard/local/dev.json` (`protoboard.dev/v0`, written
  while a person's `protoboard dev` runs, removed when it stops) has `url`
  and `bridge: { key, version: 1 }`. The key is random per run and lives
  only in that git-ignored file; it grants minting sessions, nothing else.
- **Sessions**: `POST /__protoboard/bridge/session` with the key and
  `{ "name": "..." }` returns a token; every batch carries it in
  `x-protoboard-bridge`. The token names the actor the viewer logs
  (`agent:<session>`), so an agent can never write as the person. Sessions
  expire after 8 hours unused (DEFAULT) and end with the server. Batch ids
  are per session: two agents' `b1` never collide.
- **Which tab**: a batch may name `tab`; otherwise it goes to the tab the
  person used last (a focus or a click in the dev page; the focused VS Code
  viewer tab). `GET /__protoboard/bridge/state` (token or key) lists the
  tabs, the default marked.
- **Timeouts**: the tab has 8 s by default (`timeoutMs`, 1 to 60 s, per
  batch) before the bridge says `may-have-run`. A reply that comes later is
  kept, and a resend of that `batchId` gets it.
- **Refused requests**: a wrong key or token (403, 401), a request with a
  foreign `Origin` (403: a web page cannot set the headers without a
  preflight, which is never granted), a body over 256 kB (413), a bad batch
  (400 `invalid`). `views check`'s own server offers no bridge (404).

### From the CLI

`packages/cli/src/dev/bridgeClient.ts` (inside the CLI package; the MCP
server's view tools import it, it is not a public export):

```ts
import { connectBridge } from "./dev/bridgeClient.js";
const agent = await connectBridge(projectRoot, { name: "claude: frame the FC" });
const seen = await agent.call({ batchId: "r1", label: "read the user's selection and camera", ops: [], observe: true });
// seen.status === "read": seen.state.selection, seen.state.camera, seen.seq
const done = await agent.call({
  batchId: "w1",
  label: "highlight the flight controller",
  ops: [{ op: "highlight", paths: ["stack/fc"] }],
  expectVersions: { highlight: seen.versions.highlight ?? 0 },
});
```

`call` never throws for a transport problem: a refused connection is
`not-run`, a failure after the request left is `may-have-run`.

### In the page, without the bridge

The same store answers `window.__cad`: `get()` (the state), `apply(batch)`
(as the bridge applies it, logged as `__cad`), `log(since)`, `presentation()`,
`observe()` (its `seq` is the view state's; `frame` counts frames drawn;
`placeholders` is "N of M components are placeholders"; `root` the
instance the assembly is placed from), and `set({ ... })`, which also takes
view-state keys. A host uses the handle (`viewState()`, `setViewState()`,
`restoreViewState()`, `bridge()`, `presentation()`) or the messages
`uhd-viewer:setViewState`, `uhd-viewer:restoreViewState` and
`uhd-viewer:bridge` (reply `uhd-viewer:bridgeReply`), and hears
`uhd-viewer:viewState` and `uhd-viewer:presentation`.

## Not yet

- Leases with fencing tokens, presence and intent, undo per actor and the
  journal on disk (`.protoboard/local/scene-oplog.jsonl`) are PB-1196; the
  agent's verbs over MCP are PB-1179. The log lives in the tab's memory: a
  reload starts a new log at seq 0 (callers see `stale-seq` and re-observe).
- A view written while the tab is hidden is applied at once, but a throttled
  webview may answer late (`may-have-run`, then a resend).
