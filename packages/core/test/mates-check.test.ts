/**
 * The mate validator in `protoboard check` (PB-1185, wired at the wave 4 gate per W4-E's handoff):
 * runMateChecks adds a protoboard/mates entry, and a bad protoboard.mate trait becomes a diagnostic.
 */
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ModuleDef } from "@deltarobotics/uhd";
import { describe, expect, it } from "vitest";
import { loadProject } from "../src/project.ts";
import { runMateChecks } from "../src/sequence/index.ts";

const stackRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

describe("runMateChecks", () => {
  it("runs on the drone with nothing to report, and reports a bad trait under protoboard/mates", async () => {
    const drone = await loadProject(join(stackRoot, "examples", "quadcopter-5in"), { checks: false });
    const plain = { ...drone, diagnostics: [] as typeof drone.diagnostics, checks: [] as typeof drone.checks };
    await runMateChecks(plain);
    expect(plain.diagnostics).toEqual([]);
    expect(plain.checks).toEqual([{ validator: "protoboard/mates", status: "ran", counts: { error: 0, warning: 0, info: 0 } }]);
    // the same system with a protoboard.mate trait of an unknown kind on the root definition
    const rootId = drone.rootDef!.id;
    const lookup = (id: string) => {
      const d = drone.lookup(id);
      return id === rootId && d ? ({ ...d, traits: [...(d.traits ?? []), { type: "protoboard.mate", params: { kind: "hinge" } }] } as ModuleDef) : d;
    };
    const bad = { ...drone, lookup, diagnostics: [] as typeof drone.diagnostics, checks: [] as typeof drone.checks };
    await runMateChecks(bad);
    expect(bad.diagnostics.map((d) => [d.code, d.severity, d.validator])).toEqual([["MATE_KIND_UNKNOWN", "error", "protoboard/mates"]]);
    expect(bad.checks).toEqual([{ validator: "protoboard/mates", status: "ran", counts: { error: 1, warning: 0, info: 0 } }]);
  }, 60_000);
});
