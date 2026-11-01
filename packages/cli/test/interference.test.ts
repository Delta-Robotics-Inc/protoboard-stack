/**
 * `protoboard interference` (PB-1185) on the drone: the BVH path (no enclosure
 * there), one keyframe by --at, intended contact told apart from findings, the
 * exit code, the text report, and a keyframe that does not exist.
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { InterferenceReport } from "../../core/src/mates/index.ts";
import { formatInterference, interferenceCommand } from "../src/interference.ts";

const here = dirname(fileURLToPath(import.meta.url));
const drone = resolve(here, "../../../examples/quadcopter-5in");

describe("protoboard interference", () => {
  it("checks the assembled drone with the BVH path and tells intended contact from findings", async () => {
    const seen: InterferenceReport[] = [];
    const code = await interferenceCommand(drone, ["--at", "assembled", "--json"], (d) => seen.push(d as InterferenceReport));
    const r = seen[0];
    expect(r.schema).toBe("protoboard.interference/v0");
    expect(r.method).toEqual({ pairs: "bvh" });
    expect(r.keyframes.map((k) => k.id)).toEqual(["assembled"]);
    expect(r.bodies).toBeGreaterThan(50); // placed bodies and every fastener
    const hits = r.keyframes[0].hits;
    // a screw in its tapped hole is intended (the link's own parts), never a finding
    expect(hits.some((h) => !!h.intended)).toBe(true);
    for (const h of hits) {
      expect(h.method).toBe("bvh");
      expect(h.depthMm).toBeGreaterThanOrEqual(0);
    }
    // the exit code follows the findings no link intends
    expect(code).toBe(r.counts.interference ? 1 : 0);
  }, 180_000);

  it("formats the report and refuses an unknown keyframe", async () => {
    const fake: InterferenceReport = {
      schema: "protoboard.interference/v0",
      method: { pairs: "bvh", walls: "voxel", voxel: { resolutionMm: 0.5, cells: 1000, ms: 12 } },
      defaults: { contactMm: 0.1, samples: 512, maxSeconds: 120, voxel: { maxCells: 6_000_000, timeoutS: 120, resolutionMm: 0.5 } },
      bodies: 2,
      triangles: 24,
      timings: { loadMs: 1, bvhMs: 1, checkMs: 1 },
      keyframes: [{ id: "assembled", label: "assembled", t: 0, ms: 1, candidates: 1, tested: 1, reused: 0, hits: [{ a: "case", b: "board", status: "interference", depthMm: 0.75, at: [1, 2, 3], method: "voxel", wall: "base" }], excluded: [] }],
      counts: { interference: 1, intendedInterference: 0, contact: 0 },
      skipped: [],
    };
    const text = formatInterference(fake);
    expect(text).toMatch(/enclosure walls: voxel \(0\.5 mm cells/);
    expect(text).toMatch(/interference\s+0\.750 mm {2}case ~ board \(wall base\) at \[1, 2, 3\]/);
    await expect(interferenceCommand(drone, ["--at", "step:no-such-step"], () => undefined)).rejects.toThrow(/no keyframe "step:no-such-step"/);
    await expect(interferenceCommand(drone, ["--max-seconds", "-3"], () => undefined)).rejects.toThrow(/positive number/);
  }, 180_000);
});
