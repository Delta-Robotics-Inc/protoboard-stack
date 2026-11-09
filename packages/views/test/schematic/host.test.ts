/**
 * The schematic screen's host (Node, on the Airnode C3 sample): the page model is drawn by the schematic package's
 * renderer (no drift from the exported image); gestures bring wires along orthogonally; a feed lays a new folder out
 * in memory and writes nothing until a person saves; a person's writes, undo, a fix and a cleanup pass go through
 * the service with the right actors.
 */
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { geometryOf, recordsOfKind, renderSchematicSvg, withChanges, applyCalls, type ApplyContext } from "@protoboardai/schematic";
import { airnodeCircuit, airnodeSchematic } from "@protoboardai/schematic/fixtures/airnode-c3";
import { followCalls, moveCalls, rotateCalls } from "../../src/schematic/host/gestures.js";
import { SchematicFeed } from "../../src/schematic/host/feed.js";
import { itemsOf, modelOf } from "../../src/schematic/host/model.js";
import { orthogonal } from "../../src/schematic/paths.js";
import type { SchematicFeedMessage, XY } from "../../src/schematic/types.js";

const tmp = mkdtempSync(join(tmpdir(), "schematic-host-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
const ctx: ApplyContext = { actor: { kind: "human", id: "user" }, issueId: (k) => `${k}:t.1`, provenance: { by: "hand" }, edited: "hand", pinMoves: true };

describe("the page model", () => {
  it("draws every item with the renderer's own markup", async () => {
    const doc = await airnodeSchematic("ok");
    const full = renderSchematicSvg(doc, { theme: "dark" });
    const items = itemsOf(doc);
    expect(items.filter((i) => i.kind === "symbol").length).toBe(doc.circuit.parts.length);
    for (const it of items) {
      if (it.kind === "symbol") {
        expect(full).toContain(it.fields!);
        expect(full).toContain(it.svg.replace(/<\/g>$/, ""));
      } else expect(full).toContain(it.svg);
    }
    const m = modelOf(doc, { epoch: "e", seq: 0 });
    expect(m.nets.length).toBe(doc.circuit.nets.length);
    expect(m.bounds[2]).toBeGreaterThan(m.bounds[0]);
  });
});

describe("gestures", () => {
  it("a moved symbol's wires follow its pins, orthogonally", async () => {
    const doc = await airnodeSchematic("ok");
    const id = "sym:sensor/r_sda";
    const calls = moveCalls(doc, [id], 3, 2);
    const after = applyCalls(doc, calls as never, ctx);
    const pins = geometryOf(after).symbols.get(id)!.pins;
    const before = geometryOf(doc).symbols.get(id)!.pins;
    const ends = (d: typeof doc, at: XY) => recordsOfKind(d, "wire").filter((w) => [w.points[0], w.points[w.points.length - 1]].some((p) => p[0] === at[0] && p[1] === at[1])).length;
    for (const [i, p] of pins.entries()) expect(ends(after, p.at as XY)).toBeGreaterThanOrEqual(ends(doc, before[i].at as XY));
    for (const w of recordsOfKind(after, "wire")) expect(orthogonal(w.points as XY[])).toBe(true);
  });
  it("a rotation brings the wires to the pins' new places", async () => {
    const doc = await airnodeSchematic("ok");
    const id = "sym:status/r1";
    const after = applyCalls(doc, rotateCalls(doc, [id], 90) as never, ctx);
    for (const p of geometryOf(after).symbols.get(id)!.pins) if (p.net) expect(recordsOfKind(after, "wire").some((w) => w.points.some((q) => q[0] === p.at[0] && q[1] === p.at[1])) || recordsOfKind(after, "power").some((q) => q.x === p.at[0] && q.y === p.at[1]) || recordsOfKind(after, "label").some((q) => q.x === p.at[0] && q.y === p.at[1])).toBe(true);
  });
  it("nothing follows when nothing moved", async () => {
    const doc = await airnodeSchematic("ok");
    expect(followCalls(doc, withChanges(doc, []), ["sym:status/r1"])).toEqual([]);
  });
});

describe("the feed", () => {
  it("lays a new folder out in memory, writes nothing until saved, and takes a person's edits", async () => {
    const dir = join(tmp, "a", "schematic");
    const feed = await SchematicFeed.open({ dir, key: "a", name: "Airnode C3", circuit: () => airnodeCircuit("ok"), projectRoot: tmp });
    const msgs: SchematicFeedMessage[] = [];
    feed.subscribe((m) => msgs.push(m));
    const first = msgs[0];
    expect(first.type).toBe("snapshot");
    if (first.type === "snapshot") {
      expect(first.model.firstOpen).toBe(true);
      expect(first.model.items.some((i) => i.kind === "symbol")).toBe(true);
    }
    expect(existsSync(join(dir, "schematic.jsonl"))).toBe(false);

    const doc0 = feed.snapshot().doc;
    const s0 = doc0.records.get("sym:sensor/r_sda") as { x: number; y: number };
    let r = await feed.request({ method: "move", ids: ["sym:sensor/r_sda"], dx: 2, dy: 0 });
    expect(r.ok).toBe(true);
    await new Promise((x) => setTimeout(x, 50));
    expect((feed.snapshot().doc.records.get("sym:sensor/r_sda") as { x: number }).x).toBe(s0.x + 2);
    const commit = msgs.find((m) => m.type === "commit");
    expect(commit && commit.type === "commit" && commit.entry.actor.kind).toBe("human");
    r = await feed.request({ method: "undo" });
    expect(r.ok).toBe(true);
    await new Promise((x) => setTimeout(x, 50));
    expect((feed.snapshot().doc.records.get("sym:sensor/r_sda") as { x: number }).x).toBe(s0.x);

    // a wire to labels
    const doc1 = feed.snapshot().doc;
    const w = recordsOfKind(doc1, "wire").find((x) => doc1.nets.get(x.net)?.kind === "signal")!;
    r = await feed.request({ method: "apply", tx: { batchId: "t-label", label: "turn wires into labels", ops: [{ op: "wire.to_label", ids: [w.id] }] } });
    expect(r.ok).toBe(true);
    await new Promise((x) => setTimeout(x, 50));
    expect(feed.snapshot().doc.records.has(w.id)).toBe(false);

    // pinned parts stay through the layout
    const led = feed.snapshot().doc.records.get("sym:status/led1") as { x: number; y: number };
    await feed.request({ method: "apply", tx: { batchId: "t-pin", label: "pin one part by hand", ops: [{ op: "pin", ids: ["sym:status/led1"] }] } });
    await feed.request({ method: "apply", tx: { batchId: "t-lay", label: "lay out one card again", ops: [{ op: "layout.run", scope: ["card:status"], mode: "fresh" }] } });
    await new Promise((x) => setTimeout(x, 50));
    const led2 = feed.snapshot().doc.records.get("sym:status/led1") as { x: number; y: number; pinned?: true };
    expect([led2.x, led2.y, led2.pinned]).toEqual([led.x, led.y, true]);

    r = await feed.request({ method: "save" });
    expect(r.ok).toBe(true);
    expect(existsSync(join(dir, "schematic.jsonl"))).toBe(true);
    await feed.close();
  });

  it("previews a cleanup pass on a copy, applies it as the cleanup agent, and reverts it whole", async () => {
    const dir = join(tmp, "b", "schematic");
    const feed = await SchematicFeed.open({ dir, key: "b", circuit: () => airnodeCircuit("ok"), projectRoot: tmp });
    feed.subscribe(() => {});
    const drafted = await feed.applyAs({ batchId: "draft", label: "draft the sensor and MCU parts", ops: [{ op: "item.move", ids: ["sym:sensor/r_scl"], dx: -7, dy: 8 }, { op: "item.move", ids: ["sym:mcu/c_en"], dx: -6, dy: 7 }] }, { kind: "agent", id: "agent:drafter", name: "drafter" });
    expect(drafted.ok).toBe(true);
    await new Promise((x) => setTimeout(x, 50));
    const seq = feed.snapshot().seq;
    const p = await feed.request({ method: "cleanupPreview", budget: 60 });
    expect(p.ok).toBe(true);
    expect(feed.snapshot().seq).toBe(seq);
    expect(p.cleanup!.after.score).toBeGreaterThan(p.cleanup!.before.score);
    expect(p.cleanup!.ghost).toContain("data-ghost");
    const a = await feed.request({ method: "cleanupApply", id: p.cleanup!.id });
    expect(a.ok).toBe(true);
    await new Promise((x) => setTimeout(x, 50));
    expect(feed.snapshot().seq).toBeGreaterThan(seq);
    const v = await feed.request({ method: "cleanupRevert", id: p.cleanup!.id });
    expect(v.ok).toBe(true);
    await feed.close();
  });

  it("accepts one candidate fix as the person's change", async () => {
    const dir = join(tmp, "c", "schematic");
    const feed = await SchematicFeed.open({ dir, key: "c", circuit: () => airnodeCircuit("ok"), projectRoot: tmp });
    const msgs: SchematicFeedMessage[] = [];
    feed.subscribe((m) => msgs.push(m));
    await feed.applyAs({ batchId: "draft", label: "draft the MCU parts quickly", ops: [{ op: "item.move", ids: ["sym:mcu/c_en"], dx: -6, dy: 7 }] }, { kind: "agent", id: "agent:drafter", name: "drafter" });
    await new Promise((x) => setTimeout(x, 200));
    const d = [...msgs].reverse().find((m) => m.type === "derived");
    expect(d?.type).toBe("derived");
    let accepted = false;
    for (const defect of d && d.type === "derived" ? d.derived.defects : []) {
      const f = await feed.request({ method: "fixes", defect: defect.id });
      const best = (f.fixes ?? []).find((x) => x.delta > 0);
      if (!best) continue;
      const r = await feed.request({ method: "acceptFix", defect: defect.id, index: best.index });
      expect(r.ok).toBe(true);
      accepted = true;
      break;
    }
    expect(accepted).toBe(true);
    await new Promise((x) => setTimeout(x, 50));
    const last = [...msgs].reverse().find((m) => m.type === "commit");
    expect(last && last.type === "commit" && last.entry.actor.kind).toBe("human");
    await feed.close();
  });
});
