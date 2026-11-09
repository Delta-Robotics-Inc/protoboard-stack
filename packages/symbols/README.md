# @protoboardai/symbols

Schematic symbols and component icons in one style: one file per symbol holding the body drawing, the pins and the
metadata, so the same drawing serves a schematic (thin stroke, on the grid) and an icon (Lucide's 2 px stroke at
24 px). Code-built symbols come from a part's pin list, so every part has a readable symbol on day one.

Status: **draft for review** (2026-11-09). Every symbol's `provenance.review` is `draft` until approved.

## What is here

| Path | What |
|---|---|
| `STYLE.md` | The rule book: frame, grid, stroke, leads, marks, spacing, conventions, variants, format |
| `pack/*.symbol.json` | 77 drawn symbols (US default, `iec` variants where the forms differ, other variants inside each file) |
| `src/types.ts` | The `protoboard.symbol/v0` format |
| `src/check.ts` | The checker: format, metadata, lattice, leads, bounds, 2 px icon gaps, schematic gaps |
| `src/render.ts` | Schematic and icon SVG renderings, `currentColor` throughout |
| `src/generate/` | The box engine and code-built families (IC box, MCU, module, sheet, regulators, headers, terminal block, USB-C, micro-B, DIP switch, servo, IEC gates, net label) |
| `scripts/check.ts` | `node packages/symbols/scripts/check.ts`: check the pack and the code-built samples (exit 1 on errors) |
| `scripts/sheet.ts` | `node packages/symbols/scripts/sheet.ts`: contact sheets, dark and light, into `sheets/` |
| `scripts/format.ts` | `node packages/symbols/scripts/format.ts [--check]`: rewrite pack files in the canonical form |
| `test/` | The same checks as tests (`npx vitest run packages/symbols`) |
| `sheets/` | The latest contact sheets (PNG and SVG) |

## Using it

```ts
import { iconSvg, schematicSvg, icBox, regulator, usbC } from "@protoboardai/symbols";
import { readPack } from "@protoboardai/symbols/pack";

const pack = new Map(readPack().map((f) => [f.def.id, f.def]));
const r = pack.get("resistor")!;
schematicSvg(r, { unitPx: 16 });                // the IEEE zigzag; { variant: "iec" } for the box
iconSvg(r, (id) => pack.get(id));                // Lucide-form icon

icBox([{ name: "VDD", type: "power_in" }, { name: "GND" }, { name: "SDA", type: "bidirectional", group: "I2C" }]);
regulator("linear", [{ name: "VIN" }, { name: "GND" }, { name: "EN" }, { name: "VOUT" }]);
usbC();
```

Colors come from the host: set `color` on the element that holds the SVG (dark canvas ink, paper print ink).

## Adding a symbol

1. Read `STYLE.md`. Draw on the 24 px frame, pins on the lattice, leads starting on their anchors.
2. Write `pack/<id>.symbol.json` and run `scripts/format.ts`, then `scripts/check.ts` until it is clean.
3. Run `scripts/sheet.ts` and look at the dark and light sheets: schematic size and the 16 px and 24 px icons.
4. Leave `provenance.review` at `draft`; a person approves it.

Never convert or trace KiCad library symbols (CC-BY-SA 4.0 would bind the whole pack) or copy another library's
paths. Use them only as a checklist of what exists.

## Relation to the KiCad export

`src/generate/box.ts` mirrors the side rule (`sides()`) and the pin-name rule (`pinName()`) of
`packages/ext-tscircuit/lib/kicad/schematic.ts` without changing that file: `kicadBox()` lays a part out exactly as
the KiCad export does, and a test checks the pin-name rule against the export's own function. The export can later
import these instead of keeping its copy.

## Not yet in the workspace

This folder is not yet listed in the root `package.json` workspaces or `typecheck` script (other work was editing
that file). Its tests run with the root `vitest` (the `packages/*/test` pattern), and
`npx tsc --noEmit -p packages/symbols` typechecks it.

## License

Apache-2.0 (see LICENSE and NOTICE). The drawing rules follow Lucide's conventions; Lucide's ISC notice is in
`licenses/LUCIDE-ISC.txt`.
