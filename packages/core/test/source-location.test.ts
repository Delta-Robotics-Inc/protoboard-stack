/**
 * Where "open source" goes for a catalog part vendored with its .uhd.ts
 * (PB-906, PB-910): the readable source, not the pinned JSON. The build
 * records it in resolved.json (which the VS Code extension reads) and the
 * project parts list opens it.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadProject, projectParts, resolvedProject } from "../src/index.js";

const BOTTLE = fileURLToPath(new URL("../../../examples/smart-bottle", import.meta.url));

describe("a catalog part vendored with its source", () => {
  it("is recorded and listed at its .uhd.ts, and plain JSON parts keep their JSON", async () => {
    const p = await loadProject(BOTTLE);
    const resolved = resolvedProject(p);
    const catalog = resolved.definitions.filter((d) => d.origin.kind === "catalog");
    const sourced = catalog.filter((d) => "definitionSource" in d.origin);
    expect(sourced.length).toBeGreaterThan(0);
    for (const d of sourced) {
      const file = (d.origin as { definitionSource: { file: string } }).definitionSource.file;
      expect(file).toMatch(/^parts\/catalog\/.+\.uhd\.ts$/);
      expect(existsSync(join(BOTTLE, file)), file).toBe(true);
      // the canonical source stays the pinned JSON
      expect(d.origin.source.file).toMatch(/\.json$/);
    }
    const listed = new Map(projectParts(p).parts.map((x) => [x.id, x.file]));
    for (const d of sourced) expect(listed.get(d.id)).toMatch(/\.uhd\.ts$/);
  }, 120000);
});
