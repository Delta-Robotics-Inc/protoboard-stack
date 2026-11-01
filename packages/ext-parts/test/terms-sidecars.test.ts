/**
 * The build writes view sidecars beside every body GLB (X.view.glb, X.view.coarse.glb, X.view.json; PB-1173),
 * also inside a part's vendor folder. They are derived and gitignored: the terms check must not ask for a terms
 * record for them as if they were downloads.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ModuleDef } from "@deltarobotics/uhd";
import { describe, expect, it } from "vitest";
import { checkTerms } from "../lib/terms.ts";

describe("terms check and view sidecars", () => {
  it("asks for terms for the vendor GLB, not for the sidecars the build wrote beside it", () => {
    const root = mkdtempSync(join(tmpdir(), "pb-terms-sidecars-"));
    try {
      const dir = join(root, "parts", "local", "gps", "vendor");
      mkdirSync(dir, { recursive: true });
      for (const f of ["GPS.glb", "GPS.view.glb", "GPS.view.coarse.glb", "GPS.view.json"]) writeFileSync(join(dir, f), "x");
      const def = { id: "gps", artifacts: [] } as unknown as ModuleDef;
      const findings = checkTerms(def, { layout: "project", root, id: "gps", definition: "parts/local/gps.uhd.ts", evidence: "parts/evidence/gps", research: "parts/evidence/gps/.research", artifacts: "parts/local/gps" });
      const named = findings.map((f) => f.message);
      expect(named.some((m) => m.startsWith("parts/local/gps/vendor/GPS.glb:"))).toBe(true);
      expect(named.filter((m) => /\.view\./.test(m))).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
