# The 3D view's state and the live-tab bridge

How an agent (the CLI's MCP server, a script) reads and sets what a person
sees in the 3D view: one view-state schema, an op log with version
preconditions, and a local channel from the project's `protoboard dev`
server to the viewer tab that is open. PB-1178; the first slice of the
collaboration design (`docs/specs/cad-view-research/review-round-1/round-2-notes/multi-agent-collaboration.md`,
section D). The agent's view verbs (observe, select, highlight, isolate,
camera, callout, capture) are built on this in PB-1179: see
[view-tools.md](view-tools.md) for the MCP tools; leases, undo per actor,
owner-issued ids and the journal (PB-1196, first slice) are below.

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
| `explode` | `{ t: 0..1, step: id | null }`; the view eases to `t`. A step is named by its string id (`fit:arm_fl_mount`), never by index; a saved number reads as null | live |
| `namedViews` | saved views by name (camera, and optionally explode, sections, hidden, isolation) | display file, on an explicit save |
| `annotations` | callouts, marks and arrows (`uhd-viewer.annotation/v0` records: `id`, `kind`, `ref`, `author`, ...); at most 4,096 bytes of JSON each, 500, 512 kB in all (DEFAULT) | display file, on an explicit save |
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
  explicit save (`saveView`, `deleteView`), and only when it changed.
  Annotations (an agent's callouts and marks) are live until someone saves
  them on purpose: the dev server and the VS Code host write
  `spatial.annotations` only when the save says `saveAnnotations: true`
  (DEFAULT, W3-A; the viewer posts its presentation whenever it changes). A camera
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
| `annotate` | a new record: `handle`, `kind` (`callout`, `mark`, `arrow`), `ref`, and `title`, `rows`, `text`, `shape`, `tone`, `point`, `to`; the view issues its id (the reply's `ids` maps the handle). A change: `id` and the fields |
| `unannotate` | `ids` (retired: never given to another record) |
| `claim` | alone in its batch: `roots`, `purpose`, `ttlMs?` (a lease, below) |
| `release` | alone in its batch: `lease?` (default: all of the caller's) |
| `undo` | alone in its batch: the caller's own last batch (below) |

A **batch** is `{ batchId, label, ops, expectSeq?, expectVersions?, leaseToken?, state? }`:

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
- `leaseToken`: the fencing token of the writer's lease, when it writes
  inside a subtree it claimed.

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
| `refused` | `reason` `stale-seq` or `stale-versions` (`missed: { from, to, entries }`; `conflicts` per key), `leased` (`lease`), `lease-revoked`, `view-held` (`until`), `stale-undo`, `nothing-to-undo`; `message` says it in a sentence. Re-observe, then decide again |
| `invalid` | `error`, and the `index` of the op that could not run |
| `busy` | the person is mid-gesture (dragging): nothing was applied or remembered; the bridge delivers it again after `retryAfterMs` |
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
- **Tabs register through presence**: a dev page's event stream (`?tab=`)
  alone makes no tab; the page's authenticated presence POST (its token,
  its origin) names it, and only then is it a live tab (wave 2 gate). A
  VS Code tab is announced by its relay with the key.
- **Which tab**: a batch may name `tab`; otherwise it goes to the tab the
  person used last (a focus or a click in the dev page; the focused VS Code
  viewer tab). `GET /__protoboard/bridge/state` (token or key) lists the
  tabs, the default marked.
- **Timeouts**: the tab has 8 s by default (`timeoutMs`, 1 to 60 s, per
  batch) before the bridge says `may-have-run`. A reply that comes later is
  kept, and a resend of that `batchId` gets it, when it comes from the tab
  the batch went to and is a reply (checked like an on-time one).
- **Busy**: a tab answering `busy` gets the batch again after its
  `retryAfterMs` (100 ms to 2 s) until the timeout; a person still dragging
  then makes it `not-run` (nothing was applied).
- **Journal**: each delivery asks the tab for the log entries after the last
  one mirrored (`since`), and for a checkpoint every 200 entries; the server
  appends them to `.protoboard/local/scene-oplog.jsonl`. The agent's outcome
  says how many were logged (`logged`), not the entries.
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
instance the assembly is placed from; `sections`, with planes in force: the
planes in world mm, their scope, and once the view settled the cut per plane:
per-part polylines in mm, `closed`, `lengthMm`, `watertight`), and
`set({ ... })`, which also takes view-state keys. A host uses the handle (`viewState()`, `setViewState()`,
`restoreViewState()`, `bridge()`, `presentation()`) or the messages
`uhd-viewer:setViewState`, `uhd-viewer:restoreViewState` and
`uhd-viewer:bridge` (reply `uhd-viewer:bridgeReply`), and hears
`uhd-viewer:viewState` and `uhd-viewer:presentation`.

## Collaboration (PB-1196, first slice)

- **Owner-issued ids**: a record made with `annotate` gets `a.<epoch>.<n>`
  from the store; the epoch changes with every new store (a reload), so ids
  never repeat; removed ids are retired and refused if written back.
- **Per-record versions**: `annotations.<id>` beside the top-level keys.
- **Leases with fencing tokens**: `claim` grants a lease on subtrees
  (instance paths; `""` is everything) when no other actor's live lease
  overlaps; its token rises with every grant. Other agents' writes touching
  a path under it are refused (`leased`); a write quoting a token that is not
  live, or writing in a subtree the writer holds or held without its live
  token, is refused (`lease-revoked`). A person's edit inside a lease revokes
  it (DEFAULT), "take over" (`uhd-viewer:takeOver`) revokes every agent
  lease. Leases expire (120 s DEFAULT, renewed by a write with the token).
  Camera and selection touch no path; explode, sections and named views
  touch `""`.
- **Undo per actor** (DEFAULT): `undo` appends the inverse of the caller's
  own last batch (`undoOf`); refused (`stale-undo`) when what it changed was
  changed again since. The store's `undo(actor)` serves the person's Ctrl+Z.
- **Turn-taking**: an agent write while the person is mid-gesture answers
  `busy`; the camera is the person's for 25 s after their last input
  (`view-held`); an agent that stops writing hands it back after 25 s.
- **Presence and intent**: every reply carries `epoch` and `presence`
  (`control`: who holds the camera, the person's last input, `interacting`;
  `leases`; `intents`: each agent's leases and where it wrote in the last
  30 s). The viewer emits `uhd-viewer:presence` for a host to show "agent X
  is working on U3".
- **Journal**: the log is mirrored to `.protoboard/local/scene-oplog.jsonl`
  by the relaying process; uhd-viewer's `replayJournal` rebuilds the state
  from the newest checkpoint and the entries after it.

## Not yet

- The webview is still an owner when it is open (the live tab), and the
  headless render service is the owner when none is: one owner process for
  both (collaboration D1) is later work.
- The journal is replayed by `replayJournal`, but a reloaded tab does not
  restore its log from it (the headless route puts the last state back as
  the host instead).
- A view written while the tab is hidden is applied at once, but a throttled
  webview may answer late (`may-have-run`, then a resend).
