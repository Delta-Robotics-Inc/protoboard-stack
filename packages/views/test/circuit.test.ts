/**
 * The routed board the PCB view draws (drawing/circuit.ts), read from a real
 * provider result: the wearable watch's four-layer board as circuit:generate
 * built and routed it.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { copperLabel, drawOrder, findingsLabel, locate, readCircuit, type CircuitElement } from "../src/drawing/circuit.js";

const file = fileURLToPath(new URL("../../../examples/wearable-watch/src/boards/watch-main/tscircuit/circuit.json", import.meta.url));
const cj = JSON.parse(readFileSync(file, "utf8")) as CircuitElement[];
const m = readCircuit(cj);
const layer = (id: string) => m.layers.find((l) => l.id === id)!;

describe("a routed board, as the PCB view reads it", () => {
  it("has each copper layer of the board, top first, and every layer the view turns on and off", () => {
    expect(m.copperLayers).toEqual(["top", "inner1", "inner2", "bottom"]);
    expect(m.copperLayers.map(copperLabel)).toEqual(["Top", "Inner 1", "Inner 2", "Bottom"]);
    expect(m.layers.map((l) => l.id)).toEqual(["edge", "copper:bottom", "copper:inner2", "copper:inner1", "copper:top", "courtyard:bottom", "fab:bottom", "silk:bottom", "drill", "courtyard:top", "fab:top", "silk:top", "keepout"]);
  });

  it("draws every trace, via and pad where the file puts them: nothing is routed again", () => {
    const wires = cj.filter((e) => e.type === "pcb_trace").flatMap((t) => (t.route as { route_type: string; layer?: string; x: number; y: number }[]).filter((p) => p.route_type === "wire"));
    const drawn = m.copperLayers.flatMap((l) => layer(`copper:${l}`).pieces).flatMap((p) => (p.shape.kind === "line" ? p.shape.points : []));
    // every routed point is a point of a drawn run (y negated: the drawing's y runs down)
    const key = (x: number, y: number) => `${x.toFixed(4)},${y.toFixed(4)}`;
    const have = new Set(drawn.map(([x, y]) => key(x, y)));
    expect(wires.every((p) => have.has(key(p.x, -p.y)))).toBe(true);
    const vias = cj.filter((e) => e.type === "pcb_via").length;
    expect(layer("copper:inner1").pieces.filter((p) => p.shape.kind === "circle").length).toBeGreaterThanOrEqual(vias);
    expect(layer("copper:top").pieces.filter((p) => p.pin).length + layer("copper:bottom").pieces.filter((p) => p.pin && p.shape.kind !== "circle").length).toBeGreaterThan(200);
  });

  it("knows each net by name and the pads on it", () => {
    const gnd = [...m.nets.values()].find((n) => n.name === "gnd")!;
    expect(gnd.pads.length).toBeGreaterThan(40);
    expect(gnd.pads.some((p) => p.startsWith("u1."))).toBe(true);
    // copper of one net carries the net's key: pads, traces, vias and the inner-layer pours
    const ofGnd = m.copperLayers.flatMap((l) => layer(`copper:${l}`).pieces).filter((p) => p.net === gnd.key);
    expect(new Set(ofGnd.map((p) => p.shape.kind))).toEqual(new Set(["rect", "line", "circle", "area"]));
  });

  it("knows each component: reference, side, place, part number", () => {
    expect(m.components.size).toBe(49);
    expect(m.components.get("u1")).toMatchObject({ ref: "u1", side: "top", mpn: "MDBT50Q-1MV2", w: 10, h: 11.4 });
    expect([...m.components.values()].some((c) => c.side === "bottom")).toBe(true);
    // silkscreen and the fabrication drawing name the component they belong to
    expect(layer("silk:top").pieces.some((p) => p.ref === "u1" && p.shape.kind === "text")).toBe(true);
    expect(layer("fab:top").pieces.filter((p) => p.ref === "u1").length).toBe(2);
  });

  it("puts a check's finding where its message says, and nowhere when it names no place", () => {
    expect(locate("a pad of u3 at (4.65, -14.50) lies outside the board outline", m)).toEqual([4.65, 14.5]);
    const u2 = m.components.get("u2")!;
    expect(locate("u2's footprint (2.5 × 3 mm) overhangs the board outline", m)).toEqual([u2.x, u2.y]);
    const via = cj.find((e) => e.type === "pcb_via")!;
    expect(locate(`1 copper item(s) inside keep-out ant: via ${String(via.pcb_via_id)}`, m, cj)).toEqual([via.x, -(via.y as number)]);
    expect(locate("the native source changed since the last build; run circuit:export", m)).toBeUndefined();
  });

  it("keeps the board's outline as its edge, and the board's box around it", () => {
    expect(layer("edge").pieces[0]!.shape.kind).toBe("area");
    expect(m.box[2]).toBeCloseTo(40.5, 0);
    expect(m.box[3]).toBeCloseTo(41, 0);
  });
});

describe("the layers in drawing order, from either side", () => {
  const ids = (side: "top" | "bottom") => drawOrder(m, side).map((l) => l.id);
  it("draws the board itself first from both sides, so its fill never covers the copper (the board seen from below was blank)", () => {
    expect(ids("top")[0]).toBe("edge");
    expect(ids("bottom")[0]).toBe("edge");
  });
  it("draws the copper from the far side to the near one, and the near side's drawings over it", () => {
    const top = ids("top");
    expect(top.indexOf("copper:bottom")).toBeLessThan(top.indexOf("copper:inner2"));
    expect(top.indexOf("copper:inner1")).toBeLessThan(top.indexOf("copper:top"));
    expect(top.indexOf("copper:top")).toBeLessThan(top.indexOf("silk:top"));
    expect(top.indexOf("silk:bottom")).toBeLessThan(top.indexOf("copper:bottom"));
    const bottom = ids("bottom");
    expect(bottom.indexOf("copper:top")).toBeLessThan(bottom.indexOf("copper:bottom"));
    expect(bottom.indexOf("copper:bottom")).toBeLessThan(bottom.indexOf("silk:bottom"));
    expect(bottom.indexOf("silk:top")).toBeLessThan(bottom.indexOf("copper:top"));
  });
  it("keeps every layer the board has, once", () => {
    for (const side of ["top", "bottom"] as const) expect([...ids(side)].sort()).toEqual(m.layers.map((l) => l.id).sort());
  });
});

describe("the PCB view's board check (B11)", () => {
  it("counts its marks against its findings, so the layer list and the card agree", () => {
    expect(findingsLabel(34, 34)).toBe("Findings · 34");
    expect(findingsLabel(33, 34)).toBe("Findings · 33 of 34");
  });
  it("starts folded on a laptop-sized viewer, and long codes wrap inside the card", () => {
    const view = readFileSync(fileURLToPath(new URL("../src/drawing/CircuitPcbView.tsx", import.meta.url)), "utf8");
    expect(view).toMatch(/useState\(\(\) => typeof window === "undefined" \|\| window\.innerWidth >= FINDINGS_OPEN_MIN_WIDTH\)/);
    expect(view).toContain("[overflow-wrap:anywhere]");
  });
});
