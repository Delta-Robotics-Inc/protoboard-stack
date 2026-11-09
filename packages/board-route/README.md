# @protoboardai/board-route

Routing for Protoboard's PCB editor: one router interface, an orchestrator that turns router runs
into scored, verified proposals, and the router adapters.

- **Routers never change a board.** A router gets a job (a board snapshot, a scope, constraints
  resolved from the four rule tiers, the locked copper, a time budget, a seed, thread and memory
  caps) and returns operations for the board core (`track.add`, `via.add`) with provenance
  `routed`, the tool and version, and the run id.
- **The orchestrator** runs each router on a copy, checks that locked copper came back byte for
  byte, scores the result with the checks it is handed (open connections, then errors, then vias,
  then length) and compares it with the current board. A result worse than the current board on
  open connections or errors is marked rejected, with the reasons. When a router leaves nets
  open, times out or fails, the next one routes what is still open, and the proposal says so.
  When nets stay open, the rules-or-placement diagnostic reruns them with the floor and no-go
  tiers only, on a copy, and reports which target rules, if relaxed, let each net route.
- **Policies are costs, not walls.** Policy rules and policy keep-outs never enter a router's
  input as obstacles; what a router cannot express is listed in the job and checked after.

```ts
import { routeBoard, defaultRouters, applyProposal } from "@protoboardai/board-route";
import { runBoardChecks } from "@protoboardai/board-checks";

const scorer = (doc) => {
  const r = runBoardChecks(doc);
  return { open: r.summary.unconnected, errors: r.summary.errors };
};
const proposal = await routeBoard(service.snapshot(), { scope: { kind: "open" }, routers: defaultRouters(), scorer });
if (proposal.status === "proposed") applyProposal(service, proposal); // after a person or agent accepts it
```

## Routers

| Router | How it runs |
|---|---|
| `tscircuit` (first) | `@tscircuit/capacity-autorouter`, pinned at the stack's version, in a worker thread with a heap cap, a time budget and the network off. Existing copper is passed as obstacles; locks are verified after the run. |
| `freerouting` (fallback) | An installed Freerouting, found through a setting, `PROTOBOARD_FREEROUTING`, the PATH or its default install folders. This package writes the Specctra DSN and reads the SES. Every run is headless with analytics off, a private user folder, a time limit, a thread cap, a heap cap and HTTP blocked. Freerouting is GPL-3.0: it is never bundled or linked. |
| `builtin` | Straight or L-shaped connections where the corridor is free. For tests, and for trivial connections. |

Lengths are integer nanometers, as in the board core.

Apache 2.0. Protoboard is a trademark of Delta Robotics, Inc.
