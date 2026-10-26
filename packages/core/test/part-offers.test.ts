/**
 * One reader for the offers a project holds (PB-1033): parts/offers.json and
 * parts/evidence/<part>/sourcing.json, in one order of precedence, for the
 * BOM, the board's supplier numbers, the pick-and-place and the KiCad fields.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { lcscNumberOf, readProjectOffers, supplierKey, supplierNumbersOf } from "../src/part-offers.js";

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

function project(files: Record<string, unknown>): string {
  const root = mkdtempSync(join(tmpdir(), "pb-offers-"));
  roots.push(root);
  for (const [p, v] of Object.entries(files)) {
    mkdirSync(join(root, p, ".."), { recursive: true });
    writeFileSync(join(root, p), JSON.stringify(v));
  }
  return root;
}

const offersFile = (parts: Record<string, { supplier: string; sku?: string; mpn?: string }[]>) => ({ schema: "protoboard.offers/v0", service: "https://library.test", retrievedAt: "2026-10-01T00:00:00Z", parts });
const sourcing = (mpn: string, offers: { supplier: string; supplier_sku?: string; mpn?: string }[]) => ({ schema: "protoboard.sourcing/v0", part: "x", mpn, offers });
const origins = (ids: string[]) => ({ schema: "protoboard.origins/v0", definitions: Object.fromEntries(ids.map((id) => [id, { file: `parts/catalog/${id}/part.uhd.json` }])) });

describe("readProjectOffers", () => {
  it("a project part with only evidence: its sourcing record's offers, LCSC named the way JLCPCB lists it", () => {
    const root = project({ "parts/evidence/ao3401a/sourcing.json": sourcing("AO3401A", [{ supplier: "LCSC / JLCPCB assembly", supplier_sku: "C15127" }, { supplier: "DigiKey", supplier_sku: "785-1001-1-ND" }]) });
    const o = readProjectOffers(root);
    const set = o.forPart("ao3401a");
    expect(set.library).toBe(false);
    expect(set.offers.map((x) => [x.origin, x.sku, x.mpn])).toEqual([
      ["project", "C15127", "AO3401A"],
      ["project", "785-1001-1-ND", "AO3401A"],
    ]);
    expect(set.record?.file).toBe("parts/evidence/ao3401a/sourcing.json");
    expect(lcscNumberOf(o, "ao3401a", "AO3401A")).toBe("C15127");
    expect(supplierNumbersOf(set, "AO3401A")).toEqual({ lcsc: ["C15127"], digikey: ["785-1001-1-ND"] });
    // an offer for another ordering code is not this placement's
    expect(lcscNumberOf(o, "ao3401a", "AO3400A")).toBeUndefined();
  });

  it("a library part with only library offers: parts/offers.json, per MPN for a series part", () => {
    const root = project({
      "parts/origins.json": origins(["yageo-rc0402"]),
      "parts/offers.json": offersFile({ "yageo-rc0402": [{ supplier: "LCSC", sku: "C25744", mpn: "RC0402FR-0710KL" }, { supplier: "LCSC", sku: "C25076", mpn: "RC0402FR-07100RL" }] }),
    });
    const o = readProjectOffers(root);
    expect(o.forPart("yageo-rc0402").library).toBe(true);
    expect(lcscNumberOf(o, "yageo-rc0402", "RC0402FR-07100RL")).toBe("C25076");
    expect(lcscNumberOf(o, "yageo-rc0402", "RC0402FR-0710KL")).toBe("C25744");
    expect(o.libraryParts).toEqual(["yageo-rc0402"]);
    expect(o.forPart("nothing").offers).toEqual([]);
  });

  it("a part with both: a project part's own evidence first, a library part's library offers first", () => {
    const root = project({
      "parts/origins.json": origins(["lib-part"]),
      "parts/offers.json": offersFile({ "lib-part": [{ supplier: "LCSC", sku: "C1" }], "own-part": [{ supplier: "LCSC", sku: "C2" }] }),
      "parts/evidence/lib-part/sourcing.json": sourcing("LIB", [{ supplier: "LCSC", supplier_sku: "C3" }]),
      "parts/evidence/own-part/sourcing.json": sourcing("OWN", [{ supplier: "JLCPCB", supplier_sku: "C4" }]),
    });
    const o = readProjectOffers(root);
    expect(o.forPart("lib-part").offers.map((x) => x.origin)).toEqual(["library", "project"]);
    expect(lcscNumberOf(o, "lib-part", "LIB")).toBe("C1");
    expect(supplierNumbersOf(o.forPart("lib-part"), "LIB").lcsc).toEqual(["C1", "C3"]);
    // own-part is in offers.json but not vendored (origins lists only lib-part): still read as a library part,
    // since the library vendors offers only for its own parts; the evidence follows
    expect(o.forPart("own-part").library).toBe(true);
    // without an offers.json entry it is a project part: its evidence first
    const root2 = project({
      "parts/origins.json": origins(["lib-part"]),
      "parts/offers.json": offersFile({ "lib-part": [{ supplier: "LCSC", sku: "C1" }] }),
      "parts/evidence/own-part/sourcing.json": sourcing("OWN", [{ supplier: "JLCPCB", supplier_sku: "C4" }, { supplier: "Mouser", supplier_sku: "M-1" }]),
    });
    const o2 = readProjectOffers(root2);
    expect(o2.forPart("own-part").library).toBe(false);
    expect(supplierNumbersOf(o2.forPart("own-part"), "OWN")).toEqual({ lcsc: ["C4"], mouser: ["M-1"] });
  });

  it("ignores files of another schema and names the suppliers a fab uses", () => {
    const root = project({ "parts/offers.json": { schema: "other", parts: { a: [{ supplier: "LCSC", sku: "C9" }] } }, "parts/evidence/a/sourcing.json": { schema: "other", offers: [] } });
    const o = readProjectOffers(root);
    expect(o.libraryFile).toBeUndefined();
    expect(o.forPart("a").offers).toEqual([]);
    expect(supplierKey("Digi-Key")).toBe("digikey");
    expect(supplierKey("Mouser Electronics")).toBe("mouser");
    expect(supplierKey("Arrow")).toBeUndefined();
  });
});
