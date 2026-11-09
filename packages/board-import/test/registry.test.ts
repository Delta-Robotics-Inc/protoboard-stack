/** The importer registry: this package's importers plus installed optional importer packages. */
import { describe, expect, it } from "vitest";
import { availableImporters, IMPORTERS, loadOptionalImporters } from "../src/index.js";

describe("importer registry", () => {
  it("lists KiCad, Circuit JSON and, from the repository, EasyEDA Pro", async () => {
    const all = await availableImporters();
    expect(all.slice(0, IMPORTERS.length)).toEqual([...IMPORTERS]);
    expect(all.map((i) => i.id)).toEqual(["kicad", "circuit-json", "easyeda-pro"]);
    const pick = (path: string) => all.find((i) => i.accepts({ path }))?.id;
    expect(pick("a.kicad_pcb")).toBe("kicad");
    expect(pick("a.circuit.json")).toBe("circuit-json");
    expect(pick("a.epro2")).toBe("easyeda-pro");
  });

  it("skips an optional package that is not installed", async () => {
    expect(await loadOptionalImporters([{ package: "@protoboardai/no-such-importer", repoPath: "../../no-such-importer/src/index.ts" }])).toEqual([]);
  });
});
