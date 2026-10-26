/**
 * A part's pages (PB-918) and its prices by source: what the cards' text
 * carousel and the part detail show, computed from one revision; where the
 * cards of a list are; and the order the suppliers are listed in.
 */
import { describe, expect, it } from "vitest";
import type { PartRevisionEnvelope } from "@protoboardai/cloud/client";
import { PagerStore, PagesSource, stepIn } from "../src/parts/carousel.js";
import { dimensionRows, fitChips } from "../src/parts/CardPages.js";
import { projectCard } from "../src/parts/library-data.js";
import type { PartDetailModel, PartPages, PartPriceSource } from "../src/parts/model.js";
import { artifactGroups, availablePages, cadInfo, dimensionFacts, fileSize, interfaceChips, keyLabel, metadataFacts, pageImages, partPages, specFacts } from "../src/parts/part-pages.js";
import { detailTabs } from "../src/parts/PartDetail.js";
import { breaksOf, money, usdFirst } from "../src/parts/Prices.js";

const sha = (c: string) => c.repeat(64);

/** A breakout board as the development catalog holds one: a vendor STEP, its mesh, interface geometry, a licence, a thumbnail. */
const BOARD = {
  revision: 3,
  evidence: [{ kind: "sources", title: "Sources" }],
  artifacts: [
    { artifactId: "cad_vendor_manifest", role: "source", mediaType: "application/json", path: "cad/board-vendor.manifest.json", sha256: sha("1"), size: 2941, terms: { license: "LicenseRef-Example-Library" } },
    { role: "license", mediaType: "text/plain", path: "cad/LICENSE.txt", sha256: sha("2"), size: 1076, terms: { license: "MIT" } },
    { role: "attachment", mediaType: "model/3mf", path: "cad/vendor/board.3mf", sha256: sha("3"), size: 332426, terms: { license: "MIT" } },
    { artifactId: "cad_vendor_step", role: "source", mediaType: "model/step", path: "cad/vendor/board.step", sha256: sha("4"), size: 849321, terms: { license: "MIT" } },
    { artifactId: "cad_vendor_glb", role: "body", mediaType: "model/gltf-binary", path: "cad/vendor/board.glb", sha256: sha("5"), size: 792916, terms: { license: "MIT" } },
    { artifactId: "cad_vendor_if_mount", role: "interface", mediaType: "model/gltf-binary", path: "cad/vendor/interfaces/mount.glb", sha256: sha("6"), size: 162548 },
    { artifactId: "cad_vendor_if_qt", role: "interface", mediaType: "model/gltf-binary", path: "cad/vendor/interfaces/qt.glb", sha256: sha("7"), size: 473256 },
    { role: "thumbnail", mediaType: "image/png", path: "thumbnail.png", sha256: sha("8"), size: 212744 },
    { role: "attachment", mediaType: "image/png", path: "renders/top-view.png", sha256: sha("9"), size: 50000 },
  ],
  definition: {
    id: "board",
    name: "Sensor board",
    domains: [
      {
        domain: "electrical",
        metadata: {
          current_note: "Figures at 1.8 V; treat them as indicative.",
          regulator: "AP2112K-3.3 (U2)",
          sensor_average_current_mA: { continuous: 12, low_power: 0.9 },
          idle_current_A_max: 1.6,
          source: "https://example.test/datasheet.pdf",
          level_shifter: "x".repeat(90),
        },
        power_domains: [{ id: "vin", name: "VIN (3-5 V)", voltage_range_V: [3, 5] }],
      },
      { domain: "mechanical", dimensions_mm: { length: 25.4, width: 17.78, height: 4.53 }, weight_g: 1.7, metadata: { board_thickness_mm: 1.6, cad: "vendor STEP" } },
      { domain: "thermal", operating_temperature_C: [-40, 85], metadata: { note: "Sensor range." } },
    ],
    interfaces: [
      { id: "vin", name: "VIN", domain: "electrical", protocols: [{ type: "power" }] },
      { id: "gnd", name: "GND", domain: "electrical", protocols: [{ type: "power" }] },
      { id: "sck", name: "SCK", domain: "electrical", protocols: [{ type: "digital" }] },
      { id: "sdi", name: "SDI", domain: "electrical", protocols: [{ type: "digital" }] },
      { id: "i2c", name: "I2C (level shifted)", domain: "electrical", protocols: [{ type: "i2c" }] },
      { id: "qt1", name: "STEMMA QT socket (left)", domain: "electrical", protocols: [{ type: "connector" }] },
      { id: "qt2", name: "STEMMA QT socket (right)", domain: "electrical", protocols: [{ type: "connector" }] },
      { id: "mount", name: "Mounting holes", domain: "mechanical", protocols: [{ type: "bolt_pattern" }] },
    ],
    artifacts: [
      { id: "ds", name: "Sensor datasheet", type: "datasheet", url: "https://example.test/ds.pdf" },
      { id: "page", name: "Product page", type: "documentation", url: "https://example.test/p" },
      { id: "guide", name: "Guide", type: "documentation", url: "https://example.test/guide.pdf" },
      { id: "js", name: "Bad", type: "documentation", url: "javascript:alert(1)" },
      { id: "cad_vendor_step", name: "STEP", type: "3d_model", role: "source", filePath: "cad/vendor/board.step" },
    ],
  },
} as unknown as PartRevisionEnvelope;

describe("facts from a definition's own keys", () => {
  it("reads the unit and the qualifier from a key", () => {
    expect(keyLabel("max_power_W")).toEqual({ label: "Max power", unit: "W" });
    expect(keyLabel("idle_current_A_max")).toEqual({ label: "Idle current, max", unit: "A" });
    expect(keyLabel("internal_resistance_mohm")).toEqual({ label: "Internal resistance", unit: "mΩ" });
    expect(keyLabel("soc")).toEqual({ label: "SoC" });
    // a lower-case `a` is no ampere, and a lone unit is a word
    expect(keyLabel("phase_a")).toEqual({ label: "Phase a" });
    expect(keyLabel("mm")).toEqual({ label: "Mm" });
  });

  it("gives one fact per value with a short form, and keeps remarks and sources out", () => {
    const notes: string[] = [];
    const facts = metadataFacts((BOARD.definition as any).domains[0].metadata, notes);
    expect(facts).toEqual([
      { label: "Regulator", value: "AP2112K-3.3 (U2)" },
      { label: "Sensor average current, continuous", value: "12 mA" },
      { label: "Sensor average current, low power", value: "0.9 mA" },
      { label: "Idle current, max", value: "1.6 A" },
    ]);
    expect(notes).toEqual(["Figures at 1.8 V; treat them as indicative."]);
  });

  it("specifications: the supply and the operating range first, nothing mechanical", () => {
    const { facts, notes } = specFacts(BOARD.definition as never);
    expect(facts.slice(0, 3)).toEqual([
      { label: "VIN", value: "3 to 5 V", icon: "zap" },
      { label: "Operating temperature", value: "-40 to 85 °C" },
      { label: "Regulator", value: "AP2112K-3.3 (U2)" },
    ]);
    expect(facts.some((f) => /thickness|size|mass/i.test(f.label))).toBe(false);
    expect(notes).toEqual(["Figures at 1.8 V; treat them as indicative.", "Sensor range."]);
  });

  it("dimensions: the outline, the size, the mass (weight_g) and the mechanical figures", () => {
    expect(dimensionFacts(BOARD.definition as never)).toEqual({
      outline: { length: 25.4, width: 17.78, height: 4.53 },
      rows: [
        { label: "Size", value: "25.4 × 17.78 × 4.53 mm", icon: "ruler" },
        { label: "Mass", value: "1.7 g", icon: "weight" },
        { label: "Board thickness", value: "1.6 mm" },
      ],
    });
    expect(dimensionFacts({ domains: [{ domain: "electrical" }] })).toBeUndefined();
    // beside a card's outline: the height the drawing does not show, never the size again
    expect(dimensionRows(dimensionFacts(BOARD.definition as never)!).map((r) => r.label)).toEqual(["Height", "Mass", "Board thickness"]);
  });
});

describe("interfaces as chips", () => {
  it("buses first, connectors and power by name, signal pins folded, the same chip counted", () => {
    expect(interfaceChips(BOARD.definition as never)).toEqual({ chips: ["I2C", "STEMMA QT socket ×2", "VIN", "GND", "Mounting holes", "Signal pins ×2"], count: 8 });
    expect(interfaceChips({})).toEqual({ chips: [], count: 0 });
  });

  it("a card shows as many as fit and counts the rest", () => {
    expect(fitChips(["I2C", "SPI", "STEMMA QT socket ×2", "VIN"], 20)).toEqual({ shown: ["I2C", "SPI"], more: 2 });
    expect(fitChips(["A very long interface name indeed"], 10)).toEqual({ shown: ["A very long interface name indeed"], more: 0 });
  });
});

describe("pictures, CAD and artifacts from the revision's files", () => {
  it("the catalog picture first, then the others; a list is never given a model", () => {
    expect(pageImages(BOARD).map((i) => [i.sha256[0], i.label])).toEqual([
      ["8", "Catalog picture"],
      ["9", "Top view"],
    ]);
    const pages = partPages(BOARD, { urls: { [sha("8")]: "u/thumb.png", [sha("9")]: "u/top.png" } });
    expect(pages.images).toEqual([
      { url: "u/thumb.png", label: "Catalog picture" },
      { url: "u/top.png", label: "Top view" },
    ]);
    // the files are listed by name; none comes with an address a list could load
    expect(pages.artifacts.flatMap((g) => g.items).filter((i) => /\.(glb|step|3mf)$/.test(i.name)).every((i) => i.url === undefined)).toBe(true);
    expect(pages.cad).toEqual({ preview: "u/thumb.png", file: "STEP · 0.85 MB", origin: "Vendor CAD · MIT", features: 2, mesh: 792916 });
    // a picture the host could not fetch is left out
    expect(partPages(BOARD, { urls: { [sha("9")]: "u/top.png" } }).images).toEqual([{ url: "u/top.png", label: "Top view" }]);
  });

  it("a generated model says its tool; a part without CAD has no CAD page", () => {
    const generated = {
      definition: { artifacts: [{ id: "cad_step", provenance: { tool: "build123d 0.13.0" } }] },
      artifacts: [
        { artifactId: "cad_step", role: "body", mediaType: "model/step", path: "cad/motor.step", sha256: sha("a"), size: 728057, terms: { license: "LicenseRef-Example-Library" } },
        { artifactId: "cad_kcl", role: "source", mediaType: "text/plain", path: "cad/motor.kcl", sha256: sha("b"), size: 1503 },
      ],
    } as never;
    expect(cadInfo(generated)).toEqual({ file: "STEP · 0.73 MB", origin: "Generated · KCL", features: 0 });
    expect(cadInfo({ definition: {}, artifacts: [] } as never)).toBeUndefined();
  });

  it("artifacts by kind with counts: links, then the files, then the evidence", () => {
    const groups = artifactGroups(BOARD);
    expect(groups.map((g) => [g.kind, g.items.length, g.summary, g.note])).toEqual([
      ["datasheet", 1, "Sensor datasheet", "PDF"],
      ["documentation", 2, "Documentation", "2 links"],
      ["cad-model", 2, "CAD models · 3MF · STEP", "2 files"],
      ["mesh", 1, "board.glb", "0.79 MB"],
      ["interface-geometry", 2, "Interface geometry · GLB", "2 files"],
      ["manifest", 1, "board-vendor.manifest.json", "2.9 kB"],
      ["image", 1, "top-view.png", "50 kB"],
      ["license", 1, "LICENSE.txt", "1.1 kB"],
      ["evidence", 1, "Sources", "sources"],
    ]);
    // only http(s) links are offered; the library's own licence reads as its terms
    expect(JSON.stringify(groups)).not.toContain("javascript:");
    expect(groups.find((g) => g.kind === "manifest")!.items[0].license).toBe("library terms");
  });

  it("sizes", () => {
    expect([995, 2941, 849321, 13270704, 77627469].map(fileSize)).toEqual(["995 B", "2.9 kB", "0.85 MB", "13.3 MB", "77.6 MB"]);
  });
});

describe("which pages a part has", () => {
  const pages = partPages(BOARD);
  it("every page before the pages are known, then only those with data", () => {
    expect(availablePages(undefined)).toEqual(["overview", "specs", "dimensions", "interfaces", "cad", "artifacts"]);
    expect(availablePages(pages)).toEqual(["overview", "specs", "dimensions", "interfaces", "cad", "artifacts"]);
    const bare: PartPages = { revision: 1, images: [], specs: [], specNotes: [], interfaces: { chips: [], count: 0 }, artifacts: [] };
    expect(availablePages(bare)).toEqual(["overview"]);
    expect(availablePages({ ...bare, artifacts: pages.artifacts })).toEqual(["overview", "artifacts"]);
  });

  it("the detail offers the sections it has something for; prices only where the host can ask", () => {
    const model = { facts: [], interfaces: [], links: [], evidence: [], pages: { ...pages, specs: [] }, hasPrices: true } as unknown as PartDetailModel;
    expect(detailTabs(model, {}).map((t) => t.id)).toEqual(["overview", "dimensions", "cad", "artifacts", "revisions"]);
    expect(detailTabs(model, { prices: async () => ({ partId: "x", sources: [], offers: 0 }) }).map((t) => t.id)).toContain("prices");
  });

  it("a library part of the project asks for its pinned revision's pages; a part of the project's own has none", () => {
    expect(projectCard({ id: "bme", name: "BME", tier: "catalog", status: "pinned", file: "f", library: "protoboard", revision: 2, instances: 1 }).pages).toEqual({ key: "protoboard/bme", revision: 2 });
    expect(projectCard({ id: "mine", name: "Mine", tier: "project-specific", status: "designed", file: "f", instances: 1 }).pages).toBeUndefined();
  });
});

describe("where the cards are", () => {
  it("each card keeps its own page and picture", () => {
    const s = new PagerStore();
    expect(s.page("a")).toBe("overview");
    s.setPage("a", "specs");
    s.setImage("a", 2);
    expect([s.page("a"), s.page("b"), s.image("a"), s.image("b")]).toEqual(["specs", "overview", 2, 0]);
  });

  it("turned together, one pager moves them all; apart again, each is where it was", () => {
    const s = new PagerStore();
    s.setPage("a", "cad");
    s.setLinked(true);
    // they go to the page a card was last turned to
    expect([s.page("a"), s.page("b")]).toEqual(["cad", "cad"]);
    s.setPage("b", "dimensions");
    expect([s.page("a"), s.page("b"), s.sharedPage]).toEqual(["dimensions", "dimensions", "dimensions"]);
    s.setShared("specs");
    expect(s.page("zzz")).toBe("specs");
    s.setLinked(false);
    expect([s.page("a"), s.page("b")]).toEqual(["cad", "dimensions"]);
    // never turned: the switch shows the specs
    const fresh = new PagerStore();
    fresh.setLinked(true);
    expect(fresh.page("x")).toBe("specs");
  });

  it("tells its listeners", () => {
    const s = new PagerStore();
    let n = 0;
    const off = s.subscribe(() => n++);
    s.setPage("a", "specs");
    s.setLinked(true);
    off();
    s.setImage("a", 1);
    expect(n).toBe(2);
  });

  it("steps go round at the ends", () => {
    expect(stepIn(["a", "b", "c"], "c", 1)).toBe("a");
    expect(stepIn(["a", "b", "c"], "a", -1)).toBe("c");
    expect(stepIn(["a", "b", "c"], "zz", 1)).toBe("b");
  });
});

describe("the cards' pages from the host", () => {
  const pages = partPages(BOARD);
  it("asks once per part and revision, a few at a time, and keeps what it got", async () => {
    let running = 0;
    let most = 0;
    const calls: string[] = [];
    const release: (() => void)[] = [];
    const source = new PagesSource(async (ref) => {
      calls.push(ref.key);
      most = Math.max(most, ++running);
      await new Promise<void>((ok) => release.push(ok));
      running--;
      return pages;
    }, 2);
    for (const key of ["a", "b", "c", "a"]) source.want({ key, revision: 1 });
    expect(source.state({ key: "c", revision: 1 }).status).toBe("loading");
    expect(calls).toEqual(["a", "b"]);
    while (release.length) {
      release.shift()!();
      await new Promise((r) => setTimeout(r, 0));
    }
    expect(calls).toEqual(["a", "b", "c"]);
    expect(most).toBe(2);
    expect(source.state({ key: "a", revision: 1 })).toEqual({ status: "ready", pages });
    // another revision of the same part is another question
    expect(source.state({ key: "a", revision: 2 }).status).toBe("idle");
    source.want({ key: "a", revision: 1 });
    expect(calls).toHaveLength(3);
  });

  it("a failure is the card's to show, and asked again only when the reader says", async () => {
    let fail = true;
    const source = new PagesSource(async () => {
      if (fail) throw new Error("cannot reach the library");
      return pages;
    });
    source.want({ key: "a" });
    await new Promise((r) => setTimeout(r, 0));
    expect(source.state({ key: "a" })).toEqual({ status: "error", error: "cannot reach the library" });
    source.want({ key: "a" });
    expect(source.state({ key: "a" }).status).toBe("error");
    fail = false;
    source.want({ key: "a" }, true);
    await new Promise((r) => setTimeout(r, 0));
    expect(source.state({ key: "a" }).status).toBe("ready");
  });
});

describe("prices by source", () => {
  const src = (supplier: string, o: Partial<PartPriceSource> & { price?: [number, string] } = {}): PartPriceSource => ({
    supplier,
    observedAt: "2026-10-03",
    offers: o.price ? [{ mpn: "X", unitPrice: o.price[0], currency: o.price[1], observedAt: "2026-10-03" }] : [{ mpn: "X", observedAt: "2026-10-03" }],
    ...o,
  });

  it("US dollars first: current prices, then old ones, then suppliers with none", () => {
    const sources = [
      src("NoPrice"),
      src("OldEur", { price: [62.18, "EUR"] }),
      src("Conrad", { price: [60, "EUR"], from: { unitPrice: 60, currency: "EUR" } }),
      src("OldUsd", { price: [59, "USD"] }),
      src("DigiKey", { price: [1.88, "USD"], from: { unitPrice: 1.88, currency: "USD" } }),
      src("LCSC", { price: [0.92, "USD"], from: { unitPrice: 0.92, currency: "USD" } }),
    ];
    // the library's own order (lowest first) is kept within each
    expect(usdFirst(sources).map((s) => s.supplier)).toEqual(["DigiKey", "LCSC", "Conrad", "OldUsd", "OldEur", "NoPrice"]);
  });

  it("price breaks ascending; one price counts from the minimum order", () => {
    expect(breaksOf({ mpn: "X", observedAt: "", priceBreaks: [{ quantity: 10, unitPrice: 0.79 }, { quantity: 1, unitPrice: 0.91 }] }).map((b) => b.quantity)).toEqual([1, 10]);
    expect(breaksOf({ mpn: "X", observedAt: "", unitPrice: 1.88, minQuantity: 3000 })).toEqual([{ quantity: 3000, unitPrice: 1.88 }]);
    expect(breaksOf({ mpn: "X", observedAt: "" })).toEqual([]);
  });

  it("money in its own currency, below a cent when the break is", () => {
    expect(money(10.99, "USD")).toBe("$10.99");
    expect(money(0.5674, "USD")).toBe("$0.5674");
    expect(money(62.18, "EUR")).toBe("€62.18");
    expect(money(3, undefined)).toBe("3");
  });

  it("shows only what the library serves: no member of an offer says how a price was read", () => {
    // the views' offer has exactly the members of the service's public offer (protoboard-cloud PUBLIC_OFFER_FIELDS), less the ids
    const offer: Required<import("../src/parts/model.js").PartPriceOffer> = { mpn: "", sku: "", url: "", unitPrice: 0, currency: "", priceBreaks: [], minQuantity: 0, stock: 0, leadTimeWeeks: 0, packaging: "", market: "", authorized: true, observedAt: "", stale: false };
    expect(Object.keys(offer).sort()).toEqual(["authorized", "currency", "leadTimeWeeks", "market", "minQuantity", "mpn", "observedAt", "packaging", "priceBreaks", "sku", "stale", "stock", "unitPrice", "url"]);
    expect(Object.keys(offer)).not.toContain("source");
    expect(Object.keys(offer)).not.toContain("note");
  });
});
