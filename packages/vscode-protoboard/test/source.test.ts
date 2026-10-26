import { describe, expect, it } from "vitest";
import type { ProjectIndex } from "../src/model.js";
import { definitionSource } from "../src/source.js";

const TS = `import type { ModuleDef } from "@deltarobotics/uhd";\n\nexport const SENSOR: ModuleDef = {\n  id: "acme-sensor",\n  name: "Acme sensor",\n};\n`;
const index = (origin: object) => ({ defs: new Map([["acme-sensor", { id: "acme-sensor", origin }]]) }) as unknown as ProjectIndex;

describe("Open source on a catalog part (PB-906, PB-910)", () => {
  it("opens the vendored .uhd.ts at the line naming the part, not the pinned JSON", () => {
    const idx = index({ kind: "catalog", source: { file: "parts/catalog/acme-sensor.json" }, definitionSource: { file: "parts/catalog/acme-sensor/acme-sensor.uhd.ts" } });
    expect(definitionSource(idx, "acme-sensor", () => TS)).toEqual({ file: "parts/catalog/acme-sensor/acme-sensor.uhd.ts", line: 4 });
    // without a reader, the file alone
    expect(definitionSource(idx, "acme-sensor")).toEqual({ file: "parts/catalog/acme-sensor/acme-sensor.uhd.ts" });
  });

  it("keeps the JSON for a part vendored without source, and a project part's own line", () => {
    expect(definitionSource(index({ kind: "catalog", source: { file: "parts/catalog/acme-sensor.json" } }), "acme-sensor")?.file).toBe("parts/catalog/acme-sensor.json");
    expect(definitionSource(index({ kind: "local", source: { file: "src/sensor.uhd.ts", line: 12 } }), "acme-sensor", () => TS)).toEqual({ file: "src/sensor.uhd.ts", line: 12 });
  });
});
