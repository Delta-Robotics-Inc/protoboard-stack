/** The performance target: a full check of a 6-layer board with about 1,000 tracks and 230 vias in under 2 seconds. */
import { describe, expect, it } from "vitest";
import { runBoardChecks } from "../src/index.js";
import { makeDoc } from "./helpers.js";
import { syntheticSixLayer } from "./synthetic.js";

describe("performance", () => {
  it("checks a 6-layer board with about 1,000 tracks and 230 vias in under 2 seconds", () => {
    const { records, nets, fills } = syntheticSixLayer();
    const doc = makeDoc(records, nets);
    const tracks = records.filter((r) => r.kind === "track").length;
    const vias = records.filter((r) => r.kind === "via").length;
    expect(tracks).toBeGreaterThanOrEqual(1000);
    expect(vias).toBe(230);
    const t0 = performance.now();
    const r = runBoardChecks(doc, { fills });
    const ms = performance.now() - t0;
    console.log(`synthetic 6-layer board: ${tracks} tracks, ${vias} vias, ${r.connectivity.nets.length} nets; ${r.summary.line}; ${ms.toFixed(0)} ms`, r.summary.timing!.stages);
    expect(r.connectivity.zoneFill).toBe("provided");
    // every routed net is joined; only the GND planes (no GND pads) and nothing else are islands
    expect(r.connectivity.unconnected).toBe(0);
    expect(r.connectivity.isolated).toHaveLength(2);
    expect(ms).toBeLessThan(2000);
  });
});

