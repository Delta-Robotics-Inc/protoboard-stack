/** The domain views' registrations and the pair view's model (PB-898, PB-905). */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { ModuleDef, UhdBundle } from "@deltarobotics/uhd";
import { describe, expect, it } from "vitest";
import { BUILTIN_VIEWS, createViewRegistry } from "../src/builtins.js";
import { boardsWith } from "../src/drawing/boards.js";
import { censusOf, findPair, pairsOf, potentialsOf } from "../src/pair/model.js";

const require = createRequire(import.meta.url);
const bundle = JSON.parse(readFileSync(require.resolve("@deltarobotics/uhd-viewer/package.json").replace(/package\.json$/, "fixtures/imu-pod/uhd-bundle.json"), "utf8")) as UhdBundle;
const def = (id: string) => bundle.definitions.find((d) => d.id === id)!;
const root = def(bundle.root);
const board = def("sample-imu-board");

describe("built-in domain views", () => {
  it("are working views now: schematic, PCB and pair, and the parts views' BOM and library", () => {
    const ready = BUILTIN_VIEWS.filter((v) => v.component).map((v) => v.id);
    expect(ready).toEqual(["diagram", "3d", "schematic", "pcb", "bom", "pair", "library"]);
  });

  it("offer the board drawings on the board that has them, by file name, never on a level above it", () => {
    const r = createViewRegistry();
    expect(r.forModule(board, bundle, "board").map((v) => v.id)).toEqual(expect.arrayContaining(["schematic", "pcb"]));
    // scoped to the module being viewed (the 2026-10-05 review): the system holding the board has no drawings of its own
    expect(r.forModule(root, bundle, "").map((v) => v.id)).toEqual(expect.arrayContaining(["pair"]));
    expect(r.forModule(root, bundle, "").map((v) => v.id)).not.toEqual(expect.arrayContaining(["schematic"]));
    expect(r.forModule(root, bundle, "").map((v) => v.id)).not.toEqual(expect.arrayContaining(["pcb"]));
    // a part without drawings or links below it: neither
    const part = def("fixture-imu-lga12");
    expect(r.forModule(part, bundle, "board/u2").map((v) => v.id)).toEqual(["diagram"]);
    expect(boardsWith(root, bundle, "", ["schematic.svg"]).map((b) => [b.path, b.def.id])).toEqual([["board", "sample-imu-board"]]);
  });

  it("offer the pair view only where links join two different modules", () => {
    const pair = BUILTIN_VIEWS.find((v) => v.id === "pair")!;
    const self: ModuleDef = { ...root, links: [{ id: "loop", a: { child: "board", interfaceId: "a" }, b: { child: "board", interfaceId: "b" } }] };
    expect(pair.applies(root, bundle)).toBe(true);
    expect(pair.applies(self, bundle)).toBe(false);
  });
});

describe("pair model", () => {
  const pairs = pairsOf(root, bundle, "");
  it("groups a level's links by the two modules they join, validated as the system checks validate them", () => {
    expect(pairs.map((p) => [p.a.child, p.b.child, p.links.length])).toEqual([["board", "enclosure", 1]]);
    expect(pairs[0].links[0].result.state).toBe("configured");
    expect(pairs[0].links[0].aIface.id).toBe("mount");
  });

  it("finds the pair a view was opened with, by link or by the two modules", () => {
    expect(findPair(pairs, { link: "board_mount" })?.key).toBe("board~enclosure");
    expect(findPair(pairs, { a: "enclosure", b: "board" })?.key).toBe("board~enclosure");
    expect(findPair(pairs, { a: "x", b: "board" })).toBeUndefined();
  });

  it("lists every interface of a side: linked here, elsewhere or free", () => {
    const a = censusOf(root, pairs[0], "a", (c) => c);
    const mount = a.find((e) => e.iface.id === "mount")!;
    expect(mount.status).toBe("here");
    expect(a.filter((e) => e.status === "free").length).toBeGreaterThan(0);
    expect(new Set(a.map((e) => e.group)).size).toBeGreaterThan(1);
    expect(potentialsOf(pairs[0]).shown.every((p) => p.a !== "mount")).toBe(true);
  });
});
