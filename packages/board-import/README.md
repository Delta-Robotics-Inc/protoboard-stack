# @protoboardai/board-import

Importers for Protoboard's PCB editor: KiCad boards (`.kicad_pcb`, KiCad 7 to 10) and
Circuit JSON into the board document of `@protoboardai/board`, and the board document back
to Circuit JSON. The contract is
[docs/specs/pcb-editor/phase1-board-core.md](../../docs/specs/pcb-editor/phase1-board-core.md)
(section 11).

```ts
import { availableImporters, importBoard, saveImportedBoard, exportCircuitJson } from "@protoboardai/board-import";

const r = await importBoard({ path: "board.kicad_pcb" }); // .kicad_pro and .kicad_dru beside it are read too
r.document;  // the board document (validated record by record)
r.netlist;   // nets from pad nets (KiCad) or source traces (Circuit JSON)
r.fill;      // the zone fill the file was saved with: derived data (the core's protoboard.zone-fill/v1)
r.report;    // what was dropped or approximated, with counts
r.offset;    // what was subtracted to center the board (nanometers, +Y up)
saveImportedBoard("src/main/board", r);
const { elements } = exportCircuitJson(r.document);

const importers = await availableImporters(); // KiCad, Circuit JSON, and EasyEDA Pro when installed
```

- KiCad: written from KiCad's published file-format documentation, with its own
  S-expression reader; no KiCad code. Y is negated and the board centered on its outline.
  Net classes and board constraints (`.kicad_pro`) and simple custom rules (`.kicad_dru`)
  become `target` and `floor` rules; every rule that does not map is reported.
- Circuit JSON: this package is the only one that touches `circuit-json` types. Footprints
  are keyed by component name; copper gets deterministic ids and provenance `generated`;
  copper pours become derived fill only. `test/conformance.test.ts` fails when a field the
  adapter reads or writes is missing from the installed `circuit-json`.

Apache 2.0. Protoboard is a trademark of Delta Robotics, Inc.
