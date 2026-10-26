/**
 * View tabs are scoped to the module being viewed (PB-920, the 2026-10-05
 * review): on the reference projects, each level offers the views that apply
 * to that module and no others. The shells ask the registry the same way, for
 * the definition at the drill path (registry.forModule(levelDef, bundle, path)).
 */
import { fileURLToPath } from "node:url";
import type { ModuleDef, UhdBundle } from "@deltarobotics/uhd";
import { loadProject, uhdBundle } from "@protoboardai/core";
import { beforeAll, describe, expect, it } from "vitest";
import { createViewRegistry } from "../src/builtins.js";
import { BUILTIN_VIEWS } from "../src/builtins.js";
import { SCHEMATIC_ICON } from "../src/icons.js";

const EXAMPLES = fileURLToPath(new URL("../../../examples/", import.meta.url));

/** The definition shown at a drill path ("" is the root), as the shells find it. */
function levelAt(bundle: UhdBundle, path: string): ModuleDef {
  let def = bundle.definitions.find((d) => d.id === bundle.root)!;
  for (const id of path ? path.split("/") : []) {
    const child = def.children?.find((c) => c.id === id);
    if (!child) throw new Error(`no ${id} in ${def.id}`);
    def = bundle.definitions.find((d) => d.id === child.moduleDefId)!;
  }
  return def;
}

const bundles = new Map<string, UhdBundle>();
const tabs = (example: string, path: string) => {
  const bundle = bundles.get(example)!;
  return createViewRegistry()
    .forModule(levelAt(bundle, path), bundle, path)
    .map((v) => v.id);
};

beforeAll(async () => {
  for (const example of ["smart-bottle", "quadcopter-5in", "wearable-watch"])
    bundles.set(example, (await uhdBundle(await loadProject(`${EXAMPLES}${example}`))) as UhdBundle);
}, 180_000);

describe("view tabs on the reference projects", () => {
  it("smart-bottle: the system has no schematic or PCB; the cap board has both, and its own BOM", () => {
    expect(tabs("smart-bottle", "")).toEqual(["diagram", "3d", "bom", "pair", "library"]);
    // the board lists no artifacts: the circuit provider's outputs are attached at load (PB-1030)
    expect(tabs("smart-bottle", "board")).toEqual(["diagram", "3d", "schematic", "pcb", "bom", "pair"]);
    // a part on the board, and the enclosure: the diagram and their model only
    expect(tabs("smart-bottle", "board/u1")).toEqual(["diagram", "3d"]);
    expect(tabs("smart-bottle", "cap")).toEqual(["diagram", "3d"]);
  });

  it("quadcopter: the system and the flight controller (a bought board, no drawings) have no schematic or PCB", () => {
    expect(tabs("quadcopter-5in", "")).toEqual(["diagram", "3d", "bom", "pair", "library"]);
    expect(tabs("quadcopter-5in", "stack")).toEqual(["diagram", "3d", "pair"]);
    expect(tabs("quadcopter-5in", "stack/fc")).toEqual(["diagram", "3d"]);
  });

  it("wearable-watch: the drawings and the board's own BOM are on the main board only", () => {
    expect(tabs("wearable-watch", "")).toEqual(["diagram", "3d", "bom", "pair", "library"]);
    expect(tabs("wearable-watch", "board")).toEqual(["diagram", "3d", "schematic", "pcb", "bom", "pair"]);
    expect(tabs("wearable-watch", "case")).toEqual(["diagram", "3d"]);
  });
});

describe("view tab icons (PB-920)", () => {
  it("PCB has the circuit board, the schematic a schematic symbol, the BOM its sheet", () => {
    const icon = (id: string) => BUILTIN_VIEWS.find((v) => v.id === id)!.icon;
    expect(icon("pcb")).toBe("circuit-board");
    expect(icon("schematic")).toBe(SCHEMATIC_ICON);
    expect(icon("bom")).toBe("sheet");
  });
});
