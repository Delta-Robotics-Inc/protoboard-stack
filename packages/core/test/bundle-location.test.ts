/**
 * A provider's finding keeps its `location` in the bundle (gate 3, W3-B's request, PB-1184): the viewer pins
 * tscircuit's pad, via and component findings to the 3D model from it; before, `uhdBundle` dropped it and the
 * findings anchored by entity only.
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadProject } from "../src/project.ts";
import { uhdBundle } from "../src/bundle.ts";
import type { ProjectDiagnostic as Diagnostic } from "../src/types.ts";

const here = dirname(fileURLToPath(import.meta.url));

describe("bundle diagnostics", () => {
  it("keep a finding's location, and leave it out when there is none", async () => {
    const p = await loadProject(resolve(here, "../../../examples/quadcopter-5in"));
    const located: Diagnostic = {
      code: "TEST_PAD_CLEARANCE",
      severity: "warning",
      message: "pad too close",
      entity: { kind: "instance", id: "stack/fc" },
      validator: "test/provider",
      location: { at: [1.5, -2.25], points: [[1.5, -2.25], [3, 4]], layer: "top", components: ["stack/fc/u1"], pads: ["pcb_smtpad_1"], nets: ["gnd"], items: ["pcb_via_2"] },
    };
    const plain: Diagnostic = { code: "TEST_PLAIN", severity: "info", message: "no place", entity: { kind: "project", id: "quadcopter-5in" }, validator: "test/provider" };
    p.diagnostics.push(located, plain);
    const bundle = await uhdBundle(p);
    const out = (bundle.diagnostics ?? []) as unknown as (Record<string, unknown> & { code: string })[];
    const a = out.find((d) => d.code === "TEST_PAD_CLEARANCE");
    const b = out.find((d) => d.code === "TEST_PLAIN");
    expect(a?.location).toEqual(located.location);
    // a JSON round trip (the bundle is written as JSON) keeps it
    expect(JSON.parse(JSON.stringify(a)).location).toEqual(located.location);
    expect(b).toBeDefined();
    expect("location" in (b as object)).toBe(false);
  });
});
