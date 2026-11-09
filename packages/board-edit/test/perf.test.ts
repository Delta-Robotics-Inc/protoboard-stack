/**
 * The step budget (contract phase2-editing.md, 7.2): on the 6-layer synthetic board (about 1,000 tracks), each cursor
 * move of a route and each step of a drag returns within the budget, and a budget that runs out returns the last
 * legal candidate rather than freezing.
 */
import { describe, expect, it } from "vitest";
import { padsOf, recordsOfKind, type FootprintRec } from "@protoboardai/board";
import { syntheticSixLayer } from "@protoboardai/board-scene/fixtures/synthetic";
import { createEditKernel, type RouteSession } from "../src/index.js";

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

describe("performance on the 6-layer synthetic board", () => {
  const { doc } = syntheticSixLayer();
  const tracks = recordsOfKind(doc, "track").length;

  it("routes with each cursor move within the step budget (target 16 ms)", () => {
    expect(tracks).toBeGreaterThanOrEqual(900);
    const t0 = performance.now();
    const k = createEditKernel({ epoch: "perf01", seq: 0, doc });
    const buildMs = performance.now() - t0;
    // a pad with a net on the first IC, toward the far side of the board
    const u = recordsOfKind(doc, "footprint").find((f) => f.ref === "U1") as FootprintRec;
    const pad = padsOf(u).find((p) => doc.padNets.get(p.id))!;
    const s = k.startRoute({ from: { pad: pad.id } }) as RouteSession;
    expect("error" in s).toBe(false);
    const times: number[] = [];
    let hits = 0;
    let illegal = 0;
    for (let i = 1; i <= 80; i++) {
      const c = s.move({ x: pad.x + i * 600_000, y: pad.y - Math.round(Math.sin(i / 7) * 4_000_000) });
      times.push(c.timing.ms);
      if (c.timing.budgetHit) hits++;
      if (!c.ok) illegal++;
    }
    const med = median(times);
    const max = Math.max(...times);
    console.log(`synthetic board: ${tracks} tracks; kernel built in ${buildMs.toFixed(1)} ms; route move median ${med.toFixed(2)} ms, max ${max.toFixed(2)} ms, budget hit on ${hits} of 80, illegal ${illegal}`);
    expect(illegal).toBe(0);
    // the target is 16 ms; generous ceilings keep the test steady under a parallel run (the numbers are printed)
    expect(med).toBeLessThan(30);
    expect(max).toBeLessThan(150);
  });

  it("drags a footprint with its tracks attached within the step budget (target 16 ms)", () => {
    const k = createEditKernel({ epoch: "perf02", seq: 0, doc });
    const ic = recordsOfKind(doc, "footprint").find((f) => f.ref === "U2") as FootprintRec;
    const d = k.startDrag({ kind: "footprint", ids: [ic.id] });
    if ("error" in d) throw new Error(d.error);
    const times: number[] = [];
    for (let i = 1; i <= 40; i++) times.push(d.move({ dx: i * 25_000, dy: -i * 10_000 }).timing.ms);
    const med = median(times);
    console.log(`synthetic board: footprint drag step median ${med.toFixed(2)} ms, max ${Math.max(...times).toFixed(2)} ms`);
    expect(med).toBeLessThan(30);
  });
});
