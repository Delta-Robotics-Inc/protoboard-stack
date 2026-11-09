# @protoboardai/schematic

The schematic core of Protoboard's PCB editor: the pin-level schematic as a document of cards, symbols, wires,
labels and power symbols; the operations every writer goes through; the automatic layout; the readability score;
the electrical checks; the agent scene; a pure SVG renderer in two themes; and a flat KiCad export. No browser code.

The contract is [docs/specs/pcb-editor/phase3-schematic-core.md](../../docs/specs/pcb-editor/phase3-schematic-core.md).

```ts
import { circuitFromUhd } from "@protoboardai/schematic/uhd";
import { openSchematicService, HUMAN } from "@protoboardai/schematic";

const circuit = circuitFromUhd(board, lookup);          // connectivity always comes from UHD
const svc = openSchematicService({ dir: "src/modules/main/schematic", circuit });
svc.apply({ batchId: "l1", label: "lay out the whole sheet", ops: [{ op: "layout.run" }] }, HUMAN);
svc.score();                                            // readability: rules C01 to C30, numbered defects
svc.checks();                                           // unconnected pins, single-pin nets, outputs, voltage
svc.scene({ card: "card:sensor", image: "png" });       // what an agent reads and sees
svc.save();
```

The layout recognizes repeated channels (drawn as an aligned array), chains such as addressable LEDs or cascaded
shift registers (rows of equal pitch), supply rows with capacitor banks on large parts, crystals with their load
capacitors, power paths through fuses and ferrites, and folds a generated symbol's unused pins (`hide_unused`).
Large sub-modules split into one card per nested sub-module; cards are packed for left-to-right signal flow, power
from the top and a readable aspect, and a sheet laid out before keeps its cards where they are. `paginateSchematic`
and `renderSchematicPages` print the sheet on pages; `renderSchematicSvg(doc, { ghost })` draws a proposal's
before and after as dashed ghosts. `src/fixtures/synthetic.ts` holds circuits that exercise each pattern.

Labels, power symbols and fields that land on something are placed by a search (candidate places on stubs of their
own net, scored against everything drawn), and a net whose wire fails keeps the part of its tree that routed and is
named only where it still fails. What the layout leaves, an agent finishes through typed tools: `listDefects`,
`proposeFixes` (candidate operations scored on a copy), `applyFix`, `explainDefect` and the bounded greedy
`cleanupPass`, whose change set `revertCleanup` undoes as a whole; `CLEANUP_TOOLS` names them for CLI and MCP bindings.

Coordinates are integer grid units (one symbol lattice unit, 2.54 mm), +Y down. `scripts/renders.ts <folder>`
lays out the synthetic Airnode C3 sample and writes both themes, the defect overlay, the 5 V fault variant, a card
crop, the scene and the KiCad export (verified with `kicad-cli` when it is installed).

Apache 2.0. Protoboard is a trademark of Delta Robotics, Inc.
