# PCB editor, Phase 2: the editing kernel (contract)

Package owners: `@protoboardai/board` (`packages/board/`, new operations, proposals, drag hold, service
additions), `@protoboardai/board-edit` (`packages/board-edit/`, the interactive routing and drag kernel, live
checks, diagnosis), `@protoboardai/board-checks` (incremental mode). The screen (`packages/views/`) and the CLI and
MCP bindings (`packages/cli/`) build against this file. If the code and this document disagree, the exported types
win and this document is fixed. Units are those of the Phase 1 contract (`phase1-board-core.md`, section 2):
integer nanometers and millidegrees, +Y up.

## 0. What is stable when

| Part | Section | State |
|---|---|---|
| Operation names, inputs and effects | 2 | **built and stable** (2026-11-09) |
| Reply additions (`reports`, `proposal` on a refusal, `held`) | 3 | **built and stable** |
| Bindings P2-D must add (CLI, MCP, wire) | 9 | **stable**; the wire methods are built in `@protoboardai/board` |
| Proposal mode | 4 | **built and stable**; the stored file may gain fields (additive only) |
| Drag hold | 5 | **built and stable** |
| Live checks and the derived-state event | 6 | **built and stable** event shape; timings reported, not promised |
| Interactive routing session | 7 | **built and stable** API; candidate quality may improve without API change |
| Drag session | 8 | **built and stable** |
| Incremental checks (`board-checks`) | 6.2 | **built and stable** |
| Diagnosis through the service | 6.3 | **built and stable** |
| Shove | 7.6 | **not built**: an extension point only; see section 10 |

Section 10 says what is built and what is specified only, and is updated when the build lands.

## 1. Shape of the work

- Every change is still an operation in a transaction (Phase 1, section 8). Phase 2 adds operations, a proposal
  store in the service, a drag hold, and derived state published after each commit.
- The interactive kernel (`@protoboardai/board-edit`) never writes. A route or drag in progress is a **draft**: it
  reads a snapshot and returns candidates; it touches nothing until the screen commits the one operation the
  session hands back (`track.route`, `track.drag`, `footprint.move`) as one transaction. Draft and commit agree
  because the kernel calls the same pure planning functions the operations call.
- The kernel's entry (`@protoboardai/board-edit`) is browser-safe: it imports only `@protoboardai/board/browser`.
  The screen may run it in the page against its own snapshot. Node-only parts (live checks, diagnosis, router
  proposals, wire methods) come from `@protoboardai/board-edit/service`.

## 2. Operations

All are registered in `@protoboardai/board` with zod inputs, exact inverses (`record.put`, `record.remove`, and
`netlist.sync` for the netlist), an example on the Airnode C3 fixture and test cases, like the Phase 1 set. `phase:
2`. `audience: "all"` unless marked system. Ids of new records come from the owner (`handle`s map to ids in the
reply), as in Phase 1.

### 2.1 Copper

| Name | Input | Effect |
|---|---|---|
| `footprint.move` | `ids`, `dx`, `dy`, `tracks?: "attached" \| "stay"` | **default is now `attached`.** Footprints translate. Copper attached to their pads follows (2.1.1). `stay` keeps Phase 1 behavior. |
| `track.drag` | `id` (a track segment or a via), `dx`, `dy`, `posture?: "45" \| "90"` (default `45`) | A segment slides along its normal by the projection of (dx, dy) and its neighbors re-form their corners; a via moves by (dx, dy) and each attached segment re-forms at the posture (2.1.2). Refused (`invalid`) when the result would short another net. |
| `track.route` | `net`, `width`, `points: [{ x, y, layer }]` (2 to 2000), `via?: { outer_diameter, hole_diameter }`, `viaSpan?: "through" \| "pair"` (default `through`), `handle?`, `locked?` | Commit of an interactive route in one operation: consecutive points on one layer make a segment; two consecutive points at the same x, y on different layers make a via there (`through`: the full stack; `pair`: from the upper to the lower of the two layers). Handles in the reply: `<handle>_s<i>` for segments, `<handle>_v<i>` for vias, numbered from 0 in path order (`handle` default `r`). A person's route is locked unless `locked: false`. No clearance check in the op (checks report); the kernel only hands out legal walk-around routes. |
| `track.set_width` | `ids?` (tracks) or `net?` (every track of the net), `width`, `neck?: boolean` | Sets the width. With `neck: true`, a segment ending on a pad narrower than the new width keeps a short neck at the pad entry: the part within one pad length of the pad keeps `min(new width, pad's smaller side)`; the report lists necked tracks. |
| `copper.rip` | `nets?`, `region?` (a contour), `layers?`, `kinds?: ("track" \| "via")[]` | Removes unlocked tracks and vias of those nets and/or touching the region. Locked copper is never removed; the report lists it (`skippedLocked`). At least one of `nets`, `region`. |

#### 2.1.1 `footprint.move` with attached copper

The planning function is exported: `planFootprintMove(doc, ids, dx, dy, { actor })` returns `{ puts, removes,
detached, followed }` and the operation applies exactly that.

- **Attached**: a track whose start or end lies on the copper of a moved pad, on that pad's layer, on the pad's net
  (or with no net when the pad has none). A via whose center lies on a moved pad is attached too.
- **Follows rigidly**: a track with both ends attached to moved pads (or to copper that moves rigidly), and attached
  vias, translate with the footprint.
- **Stretches**: a track with one end attached moves that end. When the original segment was at 0, 45 or 90 degrees
  and the stretched one is not, it becomes two segments at the 45 degree posture (the new corner gets a new id).
- **Never a short**: every moved or new segment is tested against other nets' copper (pads, tracks, vias, through
  holes) for overlap. A track that would short is **detached**: left where it was. Locked copper is detached for
  agent and router actors (they never change it). The operation never silently breaks a connection: each detached
  track is reported.
- Report (`reports[].report`): `{ followed: string[], stretched: string[], detached: { track: string, pad: string,
  reason: "short" | "locked", with?: string }[] }`.

#### 2.1.2 `track.drag`

Exported planner: `planTrackDrag(doc, id, dx, dy, { posture })` returns `{ puts, removes, report }` or throws an
`OpError` naming the short. Segment: the segment's line moves along its normal; each neighbor connected at a shared
end (same layer, same net) keeps its direction and its shared end moves to the intersection of its line with the
moved line; where the lines are parallel or the intersection would reverse the neighbor, a connecting segment is
inserted at the posture. Via: the via moves; each attached segment end moves with it, re-formed as a two-segment
posture from its far end (`90`: horizontal then vertical, `45`: diagonal then straight). Report: `{ moved:
string[], added: string[], removed: string[] }`.

### 2.2 Drawing, footprints, outline

| Name | Input | Effect |
|---|---|---|
| `text.add` | `text` (text fields of Phase 1 4.1 without `kind`, `id`, `provenance`), `handle?` | add board text |
| `text.edit` | `id`, `patch`, `unset?` | edit; `kind`, `id`, `layer`... as zone.edit |
| `text.delete` | `ids` | remove |
| `graphic.add` | `graphic` (graphic fields without `kind`, `id`, `provenance`), `handle?` | add a board graphic (silkscreen, fabrication, user, copper layers) |
| `graphic.edit` | `id`, `patch`, `unset?` | edit |
| `graphic.delete` | `ids` | remove |
| `footprint.add` | `footprint` (footprint fields without `kind`, `id`, `provenance`) | place a new footprint; its id is `fp:<path>` when `path` is given, else `fp:<ref>` (Phase 1 section 3); refused when the id or reference is taken |
| `footprint.remove` | `ids`, `copper?: "keep" \| "remove"` (default `keep`) | remove footprints; attached copper is kept (and reported as orphaned) or removed with them (unlocked only for agents) |
| `outline.import_dxf` | `dxf` (the file's text), `units?: "mm" \| "in" \| "auto"` (default `auto`: `$INSUNITS`, else mm), `layers?: string[]` (DXF layer names; default all), `tolerance?` (nm, default 10,000), `origin?: "center" \| "keep"` (default `center`), `cutouts?: boolean` (default true), `detach?` | Reads LINE, ARC, CIRCLE, LWPOLYLINE and POLYLINE (bulges become arcs), joins ends within the tolerance into closed loops, takes the largest loop as the outline and loops inside it as cutouts (existing cutouts are replaced; their ids are `cutout:dxf.<n>`). Report: `{ entities, loops, outline: { vertices, area }, cutouts, skipped: { type, count, reason }[], open: number, units }`. Anything not used is in `skipped` with a reason; nothing is dropped silently. |

### 2.3 Netlist (system)

`netlist.sync` (audience `system`: hosts and the engine; never a CLI or MCP tool): `netlist`, `rename?: "pins" \|
"none"` (default `pins`). Sets the document's netlist. With `pins`, a net that disappears by name is mapped to the
new net sharing the most of its pins (at least half of the old net's pins found on the board); copper, zones and
net-class `nets` entries on the old name are renamed. Copper on a net that vanished with no mapping is **orphaned**:
its net is cleared and it is reported. Report: `{ renamed: Record<old, new>, orphaned: string[], added: string[],
removed: string[], missingFootprints: string[], unusedFootprints: string[] }` (footprints are added and removed by
`footprint.add` and `footprint.remove`, never by this operation). The commit event carries `netlist: true`; a board
whose folder has `netlist.jsonl` writes it on save.

`PLANNED_OPERATIONS` is empty once all of section 2 is registered; bindings list operations from the registry only.

## 3. Reply additions

```ts
// applied and valid replies may carry what an operation reported (footprint.move, track.drag, copper.rip, ...)
reports?: { index: number; op: string; report: Record<string, unknown> }[];
// refused with reason needs-person (an agent's net change or unlock): stored as a proposal for a person
proposal?: string;                        // the proposal id
// refused with reason held: the hold and when to retry
hold?: Hold; retryAfterMs?: number;
// applied or valid: the transaction changed the netlist (netlist.sync)
netlist?: true;
// new refusal reasons
type RefusalReason = ... | "held" | "stale-proposal" | "not-a-person";
```

`acceptProposal` returns the reply plus `proposalState: Proposal` (the proposal after the accept). The log entry of an
accept carries `proposal: <id>`; the commit event's `entry.proposal` names it too.

A dry run (`dryRun: true`) returns the same `reports`, so a screen previews what will detach before the drop.

## 4. Proposal mode (board service)

A proposal is a change set stored, not applied. Storage: `<project root>/.protoboard/local/board/<board
key>/proposals/<id>.json` (`proposalsDir`), one file per proposal, written on every state change; an in-memory
board keeps them in memory. Ids: `p.<epoch>.<n>` (safe in file names).

```ts
interface ProposalItemInput { key?: string; label: string; ops: OpCall[] }     // key default "i<n>"
interface ProposeInput {
  title: string;                      // 3 to 12 words
  items: ProposalItemInput[];         // 1 to 200; each applies alone on the base board
  changeSet?: { id: string; title?: string };
  scores?: Record<string, unknown>;   // e.g. a router's { current, candidate } scores
  provenance?: Provenance;            // routers and hosts only: what accepted records carry
  expectSeq?: number;                 // computed on this seq (default: the current seq)
}
interface ChangeSummary { added: Record<string, number>; removed: Record<string, number>; changed: Record<string, number>; length: { added: number; removed: number } }
interface Proposal {
  id: string; title: string; actor: Actor; source: "agent" | "router" | "host" | "needs-person";
  base: { epoch: string; seq: number };
  status: "open" | "stale" | "accepted" | "partial" | "rejected";
  items: { key: string; label: string; ops: OpCall[]; status: "open" | "stale" | "accepted" | "rejected"; nets: string[]; summary: ChangeSummary; acceptedSeq?: number }[];
  summary: ChangeSummary;             // all items together, on the base board
  before: { records: number; tracks: number; vias: number };  // counts on the base board
  after: { records: number; tracks: number; vias: number };   // counts with every item applied
  touched: string[];                  // ids the items change on the base board
  areas: { box: Box; layers: string[] }[];   // read set: boxes of what changes, before and after, grown by the clearance
  scores?: Record<string, unknown>;
  provenance: Provenance;
  changeSet: { id: string; title?: string };
  stale?: { seq: number; actor: Actor; changed: string[] };   // the commit that made it stale
  reason?: string;                    // needs-person: why it waits for a person
}
```

| Service call | Effect |
|---|---|
| `svc.propose(actor, input)` | Validates every item alone and all together on the current board (a scratch engine; nothing is applied), stores the proposal, emits `{ type: "proposal", change: "created", proposal }`. Returns `{ status: "proposed", proposal }` or `{ status: "invalid", error, item? }`. Any actor kind except `system`. |
| `svc.proposals(filter?: { status? })` | Proposals, newest first. |
| `svc.proposal(id)` | One proposal or undefined. |
| `svc.previewProposal(id, { items? })` | The diff against the **current** document: `{ id, seq, stale, valid, error?, created: Record<handle, id>, added: BoardRecord[], removed: BoardRecord[], changed: { before, after }[] }`. Ids of new records in a preview are the scratch engine's, not the ids an accept will issue. |
| `svc.acceptProposal(actor, id, { items?, allowStale?, batchId? })` | Person only (`not-a-person` otherwise). Applies the open items asked (default all) as **one ordinary transaction by the accepting person**: undoable by that person, label `accept <title>` (cut to 8 words), handles of several items prefixed `<key>_<n>_`, change set of the proposal, records created carry the proposal's provenance (agent or routed, not hand) and are not locked by default, the log entry names the proposal (`proposal: id`). A stale proposal is refused (`stale-proposal`) unless `allowStale` (then it is revalidated and applied if its ops still apply). Returns the reply plus `proposal`. Partial accept leaves the other items open; accepting the last open item makes the proposal `accepted` (`partial` when some were rejected). |
| `svc.rejectProposal(actor, id, { items?, reason? })` | Marks items (default all) rejected. |
| automatic stale marking | After every commit that is not this proposal's own accept, a proposal whose `touched` ids changed, or whose `areas` meet the commit's changed areas on a shared layer, becomes `stale` (open items too) with `stale` naming the commit. |

**Agent net changes and unlocks arrive as proposals.** When an agent's transaction (not a dry run) is refused with
`needs-person`, the service stores it as a proposal (`source: "needs-person"`, one item with the transaction's ops,
`reason` the refusal message) and the refusal carries `proposal: <id>`. The engine itself still refuses; only the
service stores. **Router results arrive as proposals**: `proposeRouteResult(svc, routeProposal)` from
`@protoboardai/board-edit/service` turns a `board-route` `RouteProposal` into one proposal with one item per net
(router provenance kept, the scores in `scores`).

## 5. Drag hold (the person always wins)

```ts
svc.hold(actor, { ids: string[]; margin?: number; ttlMs?: number }): { status: "held"; hold: Hold } | { status: "invalid"; error: string }
svc.releaseHold(actor, id?: string): Hold[]
interface Hold { id: string; holder: Actor; ids: string[]; box: Box; layers: string[]; margin: number; until: number }
```

Only a `human` actor holds. `margin` default: the board's largest clearance minimum (any tier) plus 0.1 mm; `ttlMs`
default 10 s, at most 60 s, renewed by calling `hold` again with the same ids (the screen calls it on drag start and
every few seconds while dragging). While a hold is live, an agent, router or host transaction that changes a held
object, or any object whose box (before or after) meets the held box grown by the margin on a shared layer, is
refused with reason `held`, the hold in `hold`, and `retryAfterMs`. Proposals that would touch the hold can still be
created and accepted (the accept is the person's). The person's own commit that touches the held ids releases the
hold. `presence()` lists holds (`holds: Hold[]`) and a `presence` event fires on hold and release.

## 6. Live checks and derived state

### 6.1 The derived-state event

`attachLiveChecks(svc, options?)` from `@protoboardai/board-edit/service` subscribes to commits and, after each one,
rechecks only the neighborhood of what changed (6.2), refills only the affected zones through `board-fill`, and
publishes:

```ts
{ type: "derived"; epoch: string; seq: number;
  summary: { line: string; unconnected: number; errors: number; warnings: number; infos: number; incomplete: boolean; caveats: string[] };
  findings: { added: Finding[]; removed: string[]; total: number };   // finding ids are stable across runs
  fill: { refilled: string[]; stale: string[] };                      // zone ids
  stale: { checks: boolean; fill: string[] };                         // what is behind the document right now
  timing: { checksMs: number; fillMs: number; totalMs: number; mode: "incremental" | "full" } }
```

`svc.publishDerived(state)` is how a host emits it (the board service owns the event stream) and `svc.derived()`
returns the last one; `live.current()` returns the whole current result (`result`: findings, summary, connectivity;
`fill`: the board-fill result; `derived`). Options: `fills: "compute"` (default: board-fill computes every zone at
attach, then refills incrementally) or `"none"`. One state is published at attach (`mode: "full"`) and one after
every commit. Over the wire the event arrives as `board.event`, and `board.derived` (a core method) returns the last
state or null.

### 6.2 Incremental checks (`@protoboardai/board-checks`)

```ts
createIncrementalChecks(doc, { fills?, join? }): IncrementalChecks
interface IncrementalChecks {
  readonly result: BoardCheckResult;                   // as runBoardChecks returns
  update(next: BoardDocument, changed: readonly string[], options?: { fills?: ZoneFillInput; fillChanged?: string[] }): IncrementalUpdate;
}
interface IncrementalUpdate { result: BoardCheckResult; added: Finding[]; removed: string[]; mode: "incremental" | "full"; ms: number }
```

The findings after `update` equal a full `runBoardChecks(next, { fills })` run (tested on random edit sequences).
It falls back to a full run (`mode: "full"`) when a change has board-wide reach (rules, net classes, the outline,
the stackup, the netlist).

### 6.3 Diagnosis

`diagnoseNet(snapshot, net, { routers?, scorer?, budgetMs? })` from `@protoboardai/board-edit/service` runs
`board-route` on that one net. When it routes with the current rules: `{ net, routable: true, router, durationMs }`.
When it stays open, `board-route`'s rules-or-placement rerun answers: `{ net, routable: false, verdict: "rules" |
"placement" | "unknown", relaxed: string[], crossedPolicies: string[], floorViolations: number, router, durationMs,
messages }` (`unknown` when the rerun did not report the net; the messages say why). Default routers are
`board-route`'s defaults (tscircuit, then an installed Freerouting); tests pass the built-in router.
The service attachment exposes it as `editing.diagnose(net)` and over the wire as `board.diagnose`.

## 7. Interactive routing session (`@protoboardai/board-edit`)

```ts
const kernel = createEditKernel(snapshot, { budgetMs?: number /* default 12 */ });
kernel.update(snapshot, changed?);                       // after a commit: re-indexes what changed (diffed when not given)
const s = kernel.startRoute({
  from: { pad: string } | { via: string } | { track: string; end: "start" | "end" } | { x: number; y: number; layer: CopperLayer },
  net?: string,                // default: the start object's net
  layer?: CopperLayer,         // default: the start object's layer (a through pad: the top)
  width?: number,              // default: the resolved plan width for the net and layer
  mode?: "walkaround" | "highlight",   // default walkaround
  posture?: "45" | "90",       // default 45
}): RouteSession | { error: string };
```

| Call | Returns |
|---|---|
| `s.move(cursor: { x, y })` | `RouteCandidate`: the whole draft with the head re-planned to the cursor (snapped) |
| `s.click(cursor?)` | fixes the head up to the cursor; the next moves start there |
| `s.changeLayer(layer?)` | places a via at the head's end on a legal spot (the end itself, else the nearest legal spot within twice the via diameter) and continues on `layer` (default: the other outer layer); `{ ok, via?: { x, y }, reason? }` |
| `s.back()` | retracts the last fixed piece (and its via) |
| `s.setWidth(w)`, `s.setMode(m)`, `s.flipPosture()` | change the head's parameters |
| `s.finish()` | `{ call, tx, complete }`: the `track.route` call and a transaction around it (`expectRegion`: the draft's box grown by the clearance on its layers, at the session's seq, so the commit is refused `stale-region` when the neighborhood changed); `complete` is true when the route ended on target copper of its net |
| `s.cancel()` | ends the draft; nothing was written |

```ts
interface RouteCandidate {
  ok: boolean;                                    // the whole draft is legal (always true in walkaround unless stuck)
  points: { x: number; y: number; layer: CopperLayer }[];   // fixed part plus head, vias as repeated x, y
  head: { x: number; y: number; layer: CopperLayer }[];     // the live part only
  layer: CopperLayer; net: string;
  snapped?: { kind: "pad" | "via" | "track"; id: string; x: number; y: number };
  reached?: { kind: "pad" | "via" | "track"; id: string };  // the head ends on same-net copper other than the start
  width: { value: number; rule?: string; tier?: RuleTier; source: "rule" | "default" | "given" };
  clearance: { value: number; rule?: string; tier?: RuleTier; source: "rule" | "default" };
  limiting?: { check: "clearance" | "edge_clearance" | "keepout"; rule?: string; tier?: RuleTier; required: number; actual: number; against: string };
  length: { total: number; head: number };
  collisions: { id: string; layer: CopperLayer; required: number; actual: number; rule?: string }[];  // highlight mode
  stuck?: { at: { x: number; y: number }; blockers: string[] };     // walkaround could not reach the cursor
  timing: { ms: number; budgetHit: boolean; expanded: number };
}
```

### 7.1 Rules the head honors

Width: the target tier's plan for the net and layer (its `preferred`, else `min`), never below the floor; the
`width.rule` names the rule. Clearance to each other net's object on the layer: the resolved target (else floor)
clearance for that pair (nets, classes, layers; contract section 5 precedence), plus the zone's own clearance
where relevant; `limiting` names the obstacle with the least slack along the active segment, the rule and its tier.
Edge clearance applies to the outline and cutouts, `no_go` keep-outs that block tracks are walls, `policy` ones are
not (the live checks report them). Rules with `region` or `when` conditions are not resolved by the head (they are
checked by the live checks after commit; the candidate says nothing about them).

### 7.2 Walk-around

Each move tries the direct posture first (straight plus 45 degrees, both orders), then a time-budgeted grid search
around obstacles (8 directions), then pulls the result taut into 45 and 90 degree segments, hugging obstacles at
legal clearance. Every segment of a candidate is verified with exact geometry before it is returned. When the
budget (`budgetMs`, default 12 ms) runs out, the last legal candidate is returned with `timing.budgetHit: true`; the
call never blocks longer than the budget plus one verification.

### 7.3 Snapping and finishing

The cursor snaps to pads, vias and track ends of the route's net within `max(0.5 mm, 2 x width)`; when the head
reaches one (other than the start), `reached` is set and `finish()` reports `complete: true`.

### 7.4 Highlight collisions

`mode: "highlight"` draws the head straight to the cursor at the posture and lists `collisions` (other nets'
objects closer than their required clearance) instead of avoiding them; `ok` is false while any remain. Committing
it is the screen's choice and is clearly flagged.

### 7.5 Spatial index

The kernel keeps per-layer grids of other nets' copper (pads, tracks, vias, holes), edges and keep-outs; `update`
re-indexes only changed records.

### 7.6 Shove (extension point)

The head planner is behind `HeadPlanner` (`plan(ctx, from, to) => Head`); walk-around and highlight are the two
built in. A shove planner would return moved neighbors as extra `puts` in the candidate and its `finish()` would
add their `track.drag` calls to the same transaction.

## 8. Drag session (`@protoboardai/board-edit`)

```ts
const d = kernel.startDrag({ kind: "footprint"; ids: string[]; tracks?: "attached" | "stay" } | { kind: "track"; id: string; posture?: "45" | "90" });
d.move({ dx, dy }): DragCandidate;
d.finish(): { call: OpCall; tx: Transaction };   // footprint.move or track.drag with the last legal delta
d.cancel(): void;
interface DragCandidate {
  ok: boolean; dx: number; dy: number;            // the delta the commit will use (the last legal one)
  puts: BoardRecord[]; removes: string[];         // the preview: records after the drag
  detached: { track: string; pad: string; reason: "short" | "locked"; with?: string }[];  // footprint drags
  collisions: { id: string; against: string; required: number; actual: number }[];      // new clearance violations
  timing: { ms: number; budgetHit: boolean };
}
```

A footprint drag with attached tracks previews exactly what `footprint.move` will do (same planner) and lists what
will detach. A track or via drag searches toward the requested delta for the largest legal one (no short, no new
clearance violation against other nets) within the budget. The screen holds the dragged ids (section 5) for the
length of the drag.

## 9. Bindings the CLI and MCP must add (P2-D)

**Operations**: `board apply` and the MCP `board_apply` tool take them from the registry already. The parity test
needs these updates: the system list becomes `["netlist.sync", "record.put", "record.remove"]`; `footprint.move`
without `tracks` now means `attached`; examples of the Phase 2 operations dry-run as a person and as an agent like
the others. `outline.import_dxf` takes the file's text: the CLI command should read a path (`board import-dxf
<dir> <file.dxf> [--units] [--layers] [--tolerance] [--json]`, which builds the op) and the MCP tool
`board_import_dxf` with `{ dir, path, units?, layers?, tolerance? }`, both CHANGES FILES.

**Wire methods** (core, in `METHOD_PARAMS`; built into the server, `callService`, and the client by `@protoboardai/board`; the client has typed methods of the same names): `board.propose` `{ actor, proposal }`, `board.proposals` `{ status? }`, `board.proposal` `{ id }`, `board.previewProposal` `{ id, items? }`, `board.acceptProposal` `{ actor, id, items?, allowStale?, batchId? }`, `board.rejectProposal` `{ actor, id, items?, reason? }`, `board.hold` `{ actor, ids, margin?, ttlMs? }`, `board.releaseHold` `{ actor, id? }`, `board.derived` `{}`. Extension method, registered by `attachEditing(svc).methods` and passed as `serveBoard(svc, { methods })` (the server now accepts `methods`, and a method may answer with a promise): `board.diagnose` `{ net }`; clients call it with `client.callExtension("board.diagnose", { net })` (service mode only). `board serve` should call `attachEditing(svc)` so live checks publish `derived` events and `board.diagnose` exists. A CLI command on a board with no running service calls `diagnoseNet(svc.snapshot(), net)` from `@protoboardai/board-edit/service` directly.

**CLI commands** (each with `--json`): `board proposals <dir> [--status]`, `board proposal <dir> <id> [--preview]`,
`board accept <dir> <id> [--items a,b] [--allow-stale]` (a person only), `board reject <dir> <id> [--items]
[--reason]`, `board propose <dir> <proposal.json>` (as the actor the CLI resolves), `board diagnose <dir> <net>`.

**MCP tools**: `board_propose` `{ dir, title, items, changeSet? }` (the agent's batch as a proposal), `board_proposals`
`{ dir, status? }` (read only), `board_proposal` `{ dir, id, preview? }` (read only), `board_diagnose` `{ dir, net }`
(read only). No MCP tool accepts or rejects a proposal (a person's call), and none takes a hold.

## 10. Built versus specified

Built (2026-11-09), with tests:

- Every operation of section 2, with exact inverses, examples and cases (`packages/board/test/op-cases-*.ts`), the
  DXF reader (`packages/board/src/dxf.ts`), the netlist change through the engine (journaled, undoable), and the
  copper geometry and planners (`copper-geom.ts`, `edit-plan.ts`).
- Reply additions (section 3), proposal mode with files, stale marking and agents' needs-person proposals (section
  4), the drag hold (section 5), the wire methods (section 9).
- `@protoboardai/board-edit`: the routing session (walk-around, highlight, snapping, vias, back, finish with a
  region precondition) and drag sessions; live checks, diagnosis and router proposals in `/service`.
- `@protoboardai/board-checks`: `createIncrementalChecks`, equal to a full run on random edit sequences, with
  localized fill changes.

Measured on a development machine (vitest; the tests print them), 6-layer synthetic board (1,019 tracks). Alone:
route cursor move median about 3 ms (max about 14 ms, target 16); footprint drag step median about 2.6 ms; live
recheck plus refill after a single track move median about 28 ms (checks about 15, fill about 12; target 50). Under a
parallel run of three test packages: route median 4.4 ms (max 53), drag median 2.9 ms, live recheck median about 86 ms
(over the 50 ms target). The timing tests assert generous ceilings and print the real numbers.

Specified only, not built:

- **Shove.** The head planner interface (7.6) is the place for it; no shove planner exists.
- Live checks do not debounce; every commit is rechecked.
- The head does not resolve rules with a `region` or `when` condition (7.1); the live checks report them.
- Arc tracks: `track.drag` refuses to drag an arc segment itself (its vias and neighbors may move its ends).
