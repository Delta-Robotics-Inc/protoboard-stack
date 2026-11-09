# @protoboardai/board

The board core of Protoboard's PCB editor: the board document (placement, copper, zones,
outline, rules, locks), the operation registry every writer goes through, transactions with
per-actor undo, versions and leases, the journal, the on-disk format and the headless board
service. No browser code.

The contract is [docs/specs/pcb-editor/phase1-board-core.md](../../docs/specs/pcb-editor/phase1-board-core.md).

```ts
import { openBoardService, HUMAN } from "@protoboardai/board";

const svc = openBoardService({ dir: "src/modules/main/board" });
svc.apply({ batchId: "move-1", label: "move the LDO right", ops: [{ op: "footprint.move", ids: ["fp:U2"], dx: 1_000_000, dy: 0 }] }, HUMAN);
svc.save();
```

Lengths are integer nanometers, angles integer millidegrees, origin at the board center, +Y up.

Apache 2.0. Protoboard is a trademark of Delta Robotics, Inc.
