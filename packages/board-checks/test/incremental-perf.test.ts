/**
 * The incremental target: on the synthetic 6-layer board (about 1,000 tracks, 230 vias, two plane fills), the
 * update after a single track move takes under 50 ms (median over 20 moves after the initial full run), where a
 * full run takes several times that; and the same for a via move whose antipads move in both plane fills (the
 * refill a live checker passes). Timings are printed; each result is compared with a full run at the end.
 */
import { describe, expect, it } from "vitest";
import { createEngine, HUMAN, recordsOfKind } from "@protoboardai/board";
import { createIncrementalChecks, runBoardChecks, type ZoneFill } from "../src/index.js";
import { makeDoc } from "./helpers.js";
import { syntheticSixLayer } from "./synthetic.js";

describe("incremental performance", () => {
  it("rechecks a single track move on the 6-layer board (target 50 ms, median of 20 moves)", () => {
    const { records, nets, fills } = syntheticSixLayer();
    const doc = makeDoc(records, nets);
    let t = performance.now();
    const first = runBoardChecks(doc, { fills });
    const fullMs = performance.now() - t;
    t = performance.now();
    const inc = createIncrementalChecks(doc, { fills });
    const createMs = performance.now() - t;
    expect(inc.result.findings).toEqual(first.findings);
    const engine = createEngine(doc);
    const tracks = recordsOfKind(doc, "track").map((r) => r.id);
    const times: number[] = [];
    for (let k = 0; k < 20; k++) {
      const id = tracks[(k * 97) % tracks.length];
      const reply = engine.apply({ batchId: `move-${k}`, label: "move one track a little", ops: [{ op: "track.move", ids: [id], dx: k % 2 ? 60_000 : -40_000, dy: k % 3 ? 30_000 : -50_000 }] }, HUMAN);
      expect(reply.status).toBe("applied");
      const u = inc.update(engine.doc, reply.status === "applied" ? reply.changed : []);
      expect(u.mode).toBe("incremental");
      times.push(u.ms);
    }
    t = performance.now();
    const last = runBoardChecks(engine.doc, { fills });
    const warmFullMs = performance.now() - t;
    expect(inc.result.findings).toEqual(last.findings);
    expect(inc.result.summary.line).toBe(last.summary.line);
    const sorted = [...times].sort((a, b) => a - b);
    const median = (sorted[9] + sorted[10]) / 2;
    const max = sorted[sorted.length - 1];
    console.log(
      `synthetic 6-layer board, single track moves: median ${median.toFixed(1)} ms, max ${max.toFixed(1)} ms over ${times.length} updates (${times.map((x) => x.toFixed(1)).join(", ")}); ` +
        `full run ${fullMs.toFixed(0)} ms cold, ${warmFullMs.toFixed(0)} ms warm; createIncrementalChecks ${createMs.toFixed(0)} ms; ${last.summary.line}`,
    );
    // the target is 50 ms (the median is printed above); a generous ceiling keeps the test steady under a parallel run
    expect(median).toBeLessThan(150);
  });

  it("rechecks a via move with its antipads moved in both plane fills (target 50 ms, median of 20 moves)", () => {
    const { records, nets, fills } = syntheticSixLayer();
    const doc = makeDoc(records, nets);
    let t = performance.now();
    const first = runBoardChecks(doc, { fills });
    const fullMs = performance.now() - t;
    const inc = createIncrementalChecks(doc, { fills });
    expect(inc.result.findings).toEqual(first.findings);
    const engine = createEngine(doc);
    const vias = recordsOfKind(doc, "via").map((v) => v.id);
    // the antipad hole around a point: the hole whose center (the mean of its points) is nearest
    const center = (h: readonly { x: number; y: number }[]) => [h.reduce((s, v) => s + v.x, 0) / h.length, h.reduce((s, v) => s + v.y, 0) / h.length];
    let current: ZoneFill[] = fills;
    const times: number[] = [];
    for (let k = 0; k < 20; k++) {
      const id = vias[(k * 41) % vias.length];
      const v = engine.doc.records.get(id);
      if (v?.kind !== "via") throw new Error(`${id} is not a via`);
      const dx = k % 2 ? 50_000 : -50_000;
      const dy = k % 3 ? 40_000 : -30_000;
      const reply = engine.apply({ batchId: `via-${k}`, label: "move one via a little", ops: [{ op: "via.move", ids: [id], dx, dy }] }, HUMAN);
      if (reply.status !== "applied") throw new Error(JSON.stringify(reply));
      // the refill: in each plane the via's antipad moves with it, every other ring stays as it was
      current = current.map((f) => ({
        ...f,
        polygons: f.polygons.map((p) => {
          if (!("outline" in p)) return p;
          const holes = [...(p.holes ?? [])];
          let best = 0;
          let bestD = Infinity;
          holes.forEach((h, i) => {
            const [cx, cy] = center(h);
            const d = Math.hypot(cx - v.x, cy - v.y);
            if (d < bestD) [best, bestD] = [i, d];
          });
          holes[best] = holes[best].map((q) => ({ x: q.x + dx, y: q.y + dy }));
          return { ...p, holes };
        }),
      }));
      const u = inc.update(engine.doc, reply.changed, { fills: current, fillChanged: current.map((f) => f.zone) });
      expect(u.mode).toBe("incremental");
      times.push(u.ms);
    }
    t = performance.now();
    const last = runBoardChecks(engine.doc, { fills: current });
    const warmFullMs = performance.now() - t;
    expect(inc.result.findings).toEqual(last.findings);
    expect(inc.result.connectivity).toEqual(last.connectivity);
    expect(inc.result.summary.line).toBe(last.summary.line);
    const sorted = [...times].sort((a, b) => a - b);
    const median = (sorted[9] + sorted[10]) / 2;
    const max = sorted[sorted.length - 1];
    console.log(
      `synthetic 6-layer board, via moves with both plane fills changed: median ${median.toFixed(1)} ms, max ${max.toFixed(1)} ms over ${times.length} updates (${times.map((x) => x.toFixed(1)).join(", ")}); ` +
        `full run ${fullMs.toFixed(0)} ms cold, ${warmFullMs.toFixed(0)} ms warm; ${last.summary.line}`,
    );
    // the target is 50 ms (the median is printed above); a generous ceiling keeps the test steady under a parallel run
    expect(median).toBeLessThan(150);
  });
});
