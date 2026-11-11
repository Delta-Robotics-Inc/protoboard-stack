/**
 * R2 integration (2026-11-02), R2-D's handoff to `cli/src/index.ts`: `protoboard check` words every finding,
 * including the ones pushed after loading (the diagram's layout, the sequence patches, the mates). Before, the
 * drone's two `PB_DIAGRAM_LAYOUT` findings came out of `check --format json` without `title` and `summary`.
 */
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const CLI = join(HERE, "../bin/protoboard.mjs");
const DRONE = join(HERE, "../../../examples/quadcopter-5in");

describe("protoboard check words every finding (R2-D's handoff)", () => {
  it("the drone's findings, the diagram's layout included, carry a title and a summary", () => {
    const r = spawnSync(process.execPath, [CLI, "check", "--format", "json"], { cwd: DRONE, encoding: "utf8", env: process.env });
    const out = JSON.parse(r.stdout) as { diagnostics: { code: string; title?: string; summary?: string }[] };
    expect(out.diagnostics.length).toBeGreaterThan(0);
    const layout = out.diagnostics.filter((d) => d.code === "PB_DIAGRAM_LAYOUT");
    expect(layout.length).toBeGreaterThan(0);
    for (const d of out.diagnostics) {
      expect(d.title, d.code).toEqual(expect.any(String));
      expect(d.summary, d.code).toEqual(expect.any(String));
    }
    expect(layout[0].title).toBe("Diagram is hard to read");
  }, 60_000);
});
