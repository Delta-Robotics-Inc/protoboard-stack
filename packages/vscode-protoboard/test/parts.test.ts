/**
 * The item-6 surfaces' models and page (PB-912): the React webviews' page
 * loads nothing from the network; the Library's results become cards; a
 * part's preview becomes the detail; the project's parts group the way
 * Source Control does; the BOM exports as CSV; the account card reads the
 * CLI's sign-in.
 */
import { describe, expect, it } from "vitest";
import { accountView } from "../src/account.js";
import { appCsp, appHtml } from "../src/appPage.js";
import { bomCsv, cardModel, categoryTrail, detailModel, libraryViewModel, partGroups, partNote, partSync, previewTrust, projectCard, rev, shortDescription, sortLocally, sortState, tierGroups, type ItemModel, type PreviewModel } from "../src/libraryModel.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PART_STATUS_COLORS, PART_STATUS_CSS, PART_STATUS_TONE, PART_TRUST_STATES, nodeMarks } from "@protoboardai/views/part-status";
import { priceBom } from "@protoboardai/core/bom";
import type { BomModel, ProjectPartModel } from "@protoboardai/views/parts-model";

describe("the React webviews' page", () => {
  const page = { screen: "library" as const, title: "Library", cspSource: "https://file+.vscode-resource.test", script: "https://file+.vscode-resource.test/ext/dist/views-app.js", style: "https://file+.vscode-resource.test/ext/dist/views-app.css", nonce: "N0NCE" };
  it("loads only the extension's own bundle, by nonce, and names its screen", () => {
    const html = appHtml(page);
    const csp = /Content-Security-Policy" content="([^"]+)"/.exec(html)![1].replace(/&#39;/g, "'");
    expect(csp).toBe(appCsp(page));
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("script-src 'nonce-N0NCE'");
    expect(csp).not.toMatch(/https?:\/\/(?!file\+\.vscode-resource\.test)/);
    expect(html).toContain('<body data-screen="library" data-theme="vscode">');
    expect(html).toContain('<script type="module" nonce="N0NCE" src="https://file+.vscode-resource.test/ext/dist/views-app.js">');
    expect(html).not.toMatch(/cdn|unpkg|jsdelivr|googleapis/i);
  });
});

const item: ItemModel = {
  key: "protoboard/adafruit-5046-bme688",
  partId: "adafruit-5046-bme688",
  name: "Adafruit BME688",
  manufacturer: "Adafruit",
  mpn: "5046",
  revision: 2,
  latest: 2,
  library: "protoboard",
  used: { revision: 1, library: "protoboard", elsewhere: false },
  update: 2,
  thumbnail: { sha256: "a".repeat(64), size: 10, mediaType: "image/png" },
  categories: ["sensor.environmental.gas"],
  domains: ["electrical"],
  protocols: ["i2c", "spi"],
  description: "4-in-1 gas sensor with AI-ready scanning. Runs from 3 to 5 V.",
  tags: ["sensor.environmental.gas", "stemma-qt"],
};

describe("the Library's cards", () => {
  it("shows the category trail, the first sentence, protocols and free tags, and the project's state", () => {
    const names: Record<string, string> = { sensor: "Sensors", "sensor.environmental": "Environmental", "sensor.environmental.gas": "Gas" };
    expect(categoryTrail(item.categories, (p) => names[p])).toBe("Environmental · Gas");
    expect(shortDescription("One. Two.")).toBe("One.");
    expect(shortDescription("x".repeat(200), 20)).toHaveLength(20);
    const c = cardModel(item, { thumb: "https://wv/thumb.png", categoryName: (p) => names[p] });
    expect(c).toMatchObject({ key: item.key, name: "Adafruit BME688", category: "Environmental · Gas", description: "4-in-1 gas sensor with AI-ready scanning.", tags: ["I2C", "SPI", "stemma-qt"], thumbnail: "https://wv/thumb.png", used: { revision: 1, elsewhere: false }, update: 2 });
  });

  it("builds the sidebar's and the page's model from a search, with thumbnails and busy parts", () => {
    const m = libraryViewModel({
      query: { text: "bme", category: "", domain: "", protocol: "", sort: "relevance" },
      drill: { crumbs: [{ path: "", name: "All categories" }], all: { path: "", name: "All categories", count: 3 }, level: { path: "", name: "All categories", count: 3 }, rows: [{ path: "sensor", name: "Sensors", count: 3, more: true }] },
      top: [{ path: "sensor", name: "Sensors", count: 3, children: [] } as never, { path: "power", name: "Power", count: 0, children: [] } as never],
      items: [item],
      total: 1,
      more: false,
      sources: [{ id: "protoboard", total: 1 }],
      thumbs: { ["a".repeat(64)]: "https://wv/t.png" },
      busy: { [item.key]: "Adding" },
      loading: false,
    });
    // a category with sub-categories says so: choosing it drills in (PB-934)
    expect(m.categories).toEqual([{ path: "sensor", name: "Sensors", count: 3, more: true }]);
    expect(m.level).toEqual({ path: "", name: "All categories", count: 3 });
    expect(m.topCategories).toEqual([{ path: "sensor", name: "Sensors", count: 3 }]);
    expect(m.items[0]).toMatchObject({ thumbnail: "https://wv/t.png", busy: "Adding" });
    // a text query narrows the search: its total is not the catalog's
    expect(m.catalogTotal).toBeUndefined();
  });

  it("sizes the catalog from the unfiltered search or the host, never by summing categories", () => {
    const base = { items: [item], more: false, sources: [{ id: "protoboard" }], loading: false, top: [{ path: "a", name: "A", count: 300, children: [] } as never, { path: "b", name: "B", count: 325, children: [] } as never] };
    const all = libraryViewModel({ ...base, query: { text: "", category: "", domain: "", protocol: "", sort: "relevance" }, total: 318 });
    expect(all.catalogTotal).toBe(318);
    const narrowed = libraryViewModel({ ...base, query: { text: "", category: "a", domain: "", protocol: "", sort: "relevance" }, total: 300 });
    expect(narrowed.catalogTotal).toBeUndefined();
    expect(libraryViewModel({ ...base, query: { text: "", category: "a", domain: "", protocol: "", sort: "relevance" }, total: 300, catalogTotal: 318 }).catalogTotal).toBe(318);
    expect(libraryViewModel({ ...base, query: { text: "", category: "", domain: "", protocol: "", sort: "relevance" }, total: 0, loading: true }).catalogTotal).toBeUndefined();
  });
});

describe("a part's detail", () => {
  it("takes the preview's facts, revisions and action, with the category trail and identifiers", () => {
    const p = {
      key: item.key,
      partId: item.partId,
      library: "protoboard",
      libraryUrl: "https://parts.example",
      name: "Adafruit BME688",
      revision: 2,
      recommended: 2,
      latest: 2,
      categories: [{ path: "sensor.environmental.gas", name: "Gas" }],
      domains: [],
      protocols: ["i2c"],
      facts: [{ label: "Mass", value: "1.2 g" }],
      interfaces: [],
      interfaceCount: 0,
      links: [],
      revisions: [],
      action: { kind: "add", revision: 2 },
      dependencies: [],
      evidence: [],
      manufacturer: "Adafruit",
      mpn: "5046",
    } as PreviewModel;
    const d = detailModel(p, { thumb: "t", model: "m", busy: "Adding" });
    expect(d).toMatchObject({ crumbs: ["Sensor", "Environmental", "Gas"], identifiers: ["I2C"], thumbnail: "t", model: "m", busy: "Adding", action: { kind: "add", revision: 2 } });
    expect(detailModel(p, { noProject: true }).noProject).toBe(true);
  });
});

describe("the project's parts", () => {
  const part = (o: Partial<ProjectPartModel>): ProjectPartModel => ({ id: "x", name: "X", tier: "catalog", status: "pinned", file: "f", instances: 1, ...o });
  it("groups updates first, then each library, researched and designed", () => {
    const parts = [
      part({ id: "a", library: "protoboard", status: "up-to-date", revision: 2 }),
      part({ id: "b", library: "protoboard", status: "update-available", revision: 2, recommended: 3 }),
      part({ id: "c", library: "team", status: "diverged", revision: 1 }),
      part({ id: "d", tier: "project-researched", status: "local" }),
      part({ id: "e", tier: "project-specific", status: "designed", capability: { capability: "circuit", provider: "@protoboardai/ext-tscircuit" } }),
    ];
    expect(partGroups(parts).map((g) => [g.title, g.parts.map((p) => p.id)])).toEqual([
      ["Updates available", ["b"]],
      ["Library · protoboard", ["a"]],
      ["Library · team", ["c"]],
      ["Project · researched", ["d"]],
      ["Project · designed", ["e"]],
    ]);
    // revisions are written "v2" in every view (beta test 1, D2)
    expect(parts.map(partNote)).toEqual(["v2", "v2 → v3", "v1 · edited", "local", "circuit · tscircuit"]);
    expect(partNote(part({ tier: "project-specific", status: "designed", capability: { capability: "harness", provider: "harness" } }))).toBe("harness");
  });
});

describe("the order of the Library's results (beta test 1, F14)", () => {
  const items: { partId: string; name: string; manufacturer?: string; relevance?: number }[] = [
    { partId: "c", name: "Zeta", manufacturer: "Acme" },
    { partId: "a", name: "alpha", manufacturer: "Bosch" },
    { partId: "b", name: "Mid" },
  ];
  it("offers only the orders that work: the libraries' own, and name and manufacturer over the loaded parts", () => {
    // a library that does not sort: the order asked for cannot be made, so the nearest that can is shown, made here
    expect(sortState("relevance", [], items)).toEqual({ value: "name", options: ["name", "manufacturer"], local: true });
    expect(sortState("updated", [], items)).toEqual({ value: "name", options: ["name", "manufacturer"], local: true });
    expect(sortState("manufacturer", [], items)).toEqual({ value: "manufacturer", options: ["name", "manufacturer"], local: true });
    // a library that sorts (capability x-sort): every order, made by the library over every page
    expect(sortState("relevance", ["relevance", "name", "manufacturer", "updated"], items)).toEqual({ value: "relevance", options: ["relevance", "name", "manufacturer", "updated"], local: false });
    expect(sortState("updated", ["relevance", "name", "manufacturer", "updated"], items).local).toBe(false);
    // parts that carry a relevance can be ordered by it here, even when the library does not sort
    expect(sortState("relevance", [], [{ relevance: 20 }, { relevance: 0 }])).toEqual({ value: "relevance", options: ["relevance", "name", "manufacturer"], local: true });
  });

  it("orders the loaded parts by name and by manufacturer, parts without a manufacturer last", () => {
    expect(sortLocally(items, "name").map((x) => x.partId)).toEqual(["a", "b", "c"]);
    expect(sortLocally(items, "manufacturer").map((x) => x.partId)).toEqual(["c", "a", "b"]);
    expect(sortLocally([{ partId: "x", name: "X", relevance: 1 }, { partId: "y", name: "Y", relevance: 40 }], "relevance").map((x) => x.partId)).toEqual(["y", "x"]);
    // no date on a part summary: "recently updated" is the library's to make
    expect(sortLocally(items, "updated")).toBe(items);
  });

  it("the Library's model carries the order, and its items are in it", () => {
    const hit = (partId: string, name: string, manufacturer?: string): ItemModel => ({ key: `protoboard/${partId}`, partId, name, ...(manufacturer ? { manufacturer } : {}), revision: 1, latest: 1, library: "protoboard", categories: [], domains: [], protocols: [] });
    const input = { items: [hit("c", "Zeta", "Acme"), hit("a", "alpha", "Bosch"), hit("b", "Mid")], total: 3, more: false, sources: [{ id: "protoboard" }], loading: false };
    const byName = libraryViewModel({ ...input, query: { text: "", category: "", domain: "", protocol: "", sort: "name" } });
    expect(byName.sort).toEqual({ value: "name", options: ["name", "manufacturer"], local: true });
    expect(byName.items.map((x) => x.partId)).toEqual(["a", "b", "c"]);
    expect(libraryViewModel({ ...input, query: { text: "", category: "", domain: "", protocol: "", sort: "manufacturer" } }).items.map((x) => x.partId)).toEqual(["c", "a", "b"]);
    // the library sorted: its order is kept as it came
    const sorted = libraryViewModel({ ...input, sorts: ["relevance", "name", "manufacturer", "updated"], query: { text: "", category: "", domain: "", protocol: "", sort: "updated" } });
    expect(sorted.sort).toEqual({ value: "updated", options: ["relevance", "name", "manufacturer", "updated"], local: false });
    expect(sorted.items.map((x) => x.partId)).toEqual(["c", "a", "b"]);
  });
});

describe("a project part's sync with its library (PB-945)", () => {
  const part = (o: Partial<ProjectPartModel>): ProjectPartModel => ({ id: "x", name: "X", tier: "catalog", status: "pinned", file: "f", instances: 1, library: "protoboard", revision: 2, ...o });
  it("in sync, update available with the revision, diverged, local only, and pinned before the library was asked", () => {
    expect(partSync(part({ status: "up-to-date" }))).toMatchObject({ kind: "in-sync", label: "In sync", tone: "ok" });
    expect(partSync(part({ status: "update-available", recommended: 4 }))).toMatchObject({ kind: "update", label: "Update available · v4", tone: "info", icon: "download" });
    expect(partSync(part({ status: "update-available", recommended: 4 })).meaning).toMatch(/pins v2; the library recommends v4/);
    expect(partSync(part({ status: "diverged", edited: ["parts/catalog/x.json"] }))).toMatchObject({ kind: "diverged", label: "Diverged", tone: "warning" });
    expect(partSync(part({ status: "diverged", edited: ["parts/catalog/x.json"] })).meaning).toContain("parts/catalog/x.json");
    expect(partSync(part({ tier: "project-researched", status: "local" }))).toMatchObject({ kind: "local", label: "Local only", tone: "neutral" });
    expect(partSync(part({ tier: "project-specific", status: "designed" })).kind).toBe("local");
    expect(partSync(part({}))).toMatchObject({ kind: "pinned", label: "Pinned · v2" });
  });

  it("the page groups the parts by tier, and draws each as a library card", () => {
    const parts = [part({ id: "a" }), part({ id: "d", tier: "project-researched", status: "local" }), part({ id: "e", tier: "project-specific", status: "designed", capability: { capability: "circuit", provider: "@protoboardai/ext-tscircuit" } })];
    expect(tierGroups(parts).map((g) => [g.id, g.title, g.parts.map((p) => p.id)])).toEqual([
      ["library", "From libraries", ["a"]],
      ["researched", "Researched in the project", ["d"]],
      ["designed", "Designed in the project", ["e"]],
    ]);
    expect(tierGroups([parts[0]]).map((g) => g.id)).toEqual(["library"]);
    expect(projectCard(part({ id: "a", name: "BME688", manufacturer: "Bosch", description: "A gas sensor. More.", thumbnail: "https://wv/t.png", category: "sensor.gas" }))).toMatchObject({ key: "a", name: "BME688", manufacturer: "Bosch", description: "A gas sensor.", thumbnail: "https://wv/t.png", category: "Sensor · Gas", revision: 2 });
    // a designed part has no category: its capability says what it is
    expect(projectCard(parts[2]).category).toBe("circuit · tscircuit");
  });

  it("writes a revision as v4, never @4 or Rev 4, in every view's source", () => {
    expect(rev(4)).toBe("v4");
    expect(rev(undefined)).toBe("v?");
    const dir = fileURLToPath(new URL("../../views/src/parts/", import.meta.url));
    for (const f of ["PartCard.tsx", "PartDetail.tsx", "ProjectParts.tsx", "ProjectPartsPage.tsx", "LibraryBrowser.tsx", "LibraryPage.tsx", "views.tsx"]) {
      const src = readFileSync(dir + f, "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
      expect(src, f).not.toMatch(/@\{|@\$\{|\brev \{|\bRev \{|"rev |`rev /);
    }
    // the update action is a download, not an arrow pointing up (beta test 1, D4)
    for (const f of ["PartCard.tsx", "PartDetail.tsx", "ProjectParts.tsx", "ProjectPartsPage.tsx"]) expect(readFileSync(dir + f, "utf8"), f).not.toMatch(/circle-arrow-up|arrow-up-circle|"arrow-up"/);
  });
});

describe("the part status colours (PB-932)", () => {
  it("one definition: four states, a colour per scheme, a tone for the diagram", () => {
    expect(PART_TRUST_STATES).toEqual(["local", "unverified", "verified", "official"]);
    for (const scheme of ["dark", "light", "high-contrast", "high-contrast-light"] as const) {
      const c = PART_STATUS_COLORS[scheme];
      expect(Object.keys(c)).toEqual([...PART_TRUST_STATES]);
      expect(new Set(Object.values(c)).size).toBe(4);
      // every scheme's rule is in the one stylesheet, for a themed root and for a VS Code webview's body
      for (const t of PART_TRUST_STATES) expect(PART_STATUS_CSS).toContain(`--pb-status-${t}: ${c[t]};`);
      expect(PART_STATUS_CSS).toContain(`[data-uhd-scheme="${scheme}"]`);
    }
    // dark and light do not share a colour (the side bar's were identical in both; beta test 1, F15)
    for (const t of PART_TRUST_STATES) expect(PART_STATUS_COLORS.dark[t]).not.toBe(PART_STATUS_COLORS.light[t]);
    expect(PART_STATUS_TONE).toEqual({ local: "neutral", unverified: "warning", verified: "ok", official: "info" });
    for (const body of ["body.vscode-dark", "body.vscode-light", "body.vscode-high-contrast", "body.vscode-high-contrast-light"]) expect(PART_STATUS_CSS).toContain(`${body} {`);
    expect(PART_STATUS_CSS).toContain("--uhd-mark-ok: var(--pb-status-verified);");
  });

  it("marks the diagram's modules with a tone and a tooltip that says what the state means", () => {
    const marks = nodeMarks({ mcu: { trust: "verified", basis: "independent audit recorded" }, cap: { trust: "local" }, odd: { trust: "nonsense" as never } });
    expect(marks.mcu).toEqual({ tone: "ok", label: "Verified. In a library and verified: its facts went through the protocol's verification process. (Independent audit recorded.)" });
    expect(marks.cap).toEqual({ tone: "neutral", label: "Local. Only in this project: researched or designed here, not in a library." });
    expect(marks.odd).toBeUndefined();
    expect(nodeMarks(undefined)).toEqual({});
    // a blank block (no part chosen): the local gray as a ring, never a fifth colour, and its own words
    const blank = nodeMarks({ usb: { trust: "local", basis: "no part chosen", blank: true } }).usb;
    expect(blank).toEqual({ tone: "neutral", shape: "ring", label: "Blank block. No part chosen yet: a placeholder with a name and interfaces only. Pick a part from the library, or research one, to make it real." });
    expect(PART_STATUS_CSS).toContain(".pb-status-dot[data-blank]");
    expect(Object.keys(PART_STATUS_COLORS.dark)).toEqual([...PART_TRUST_STATES]);
  });

  it("a library part's detail reads the revision's verification record", () => {
    const p = { verification: { sha256: "a".repeat(64), size: 10, mediaType: "application/json" }, evidence: [{ kind: "verification" }] };
    expect(previewTrust(p, { audit: { independent: true, wrong: 0 } })).toEqual({ trust: "verified", trustBasis: "independent audit recorded" });
    expect(previewTrust(p, { audit: { independent: false } }).trust).toBe("unverified");
    // not read yet, or unreadable: never shown as verified
    expect(previewTrust(p)).toEqual({ trust: "unverified", trustBasis: "its verification record could not be read" });
    expect(previewTrust({ evidence: [{ kind: "sources" }] })).toEqual({ trust: "unverified", trustBasis: "no verification record" });
  });
});

describe("the BOM editor", () => {
  it("exports the bill as CSV (core's export), quoting what needs it", () => {
    const model: BomModel = priceBom(
      {
        project: "q",
        source: { kind: "design" },
        groups: [{ path: "arm", name: "Propulsion", quantity: 4 }],
        lines: [{ key: "m", definition: "m", item: 'Motor, "2207"', manufacturer: "Acme", mpn: "M-1", kind: "buy", quantity: 4, group: "arm", instances: [], offers: [{ id: "library:RDQ:", origin: "library", supplier: "RDQ", currency: "USD", breaks: [{ quantity: 1, unitPrice: 17.99 }], file: "parts/offers.json" }] }],
      },
      { now: "2026-10-07T00:00:00Z" },
    );
    const rows = bomCsv(model).split("\n");
    expect(rows[0]).toMatch(/^line,module,item,definition,manufacturer,mpn,value,kind,status,qty_per_unit,units,needed,buy,/);
    expect(rows[1]).toMatch(/^1,Propulsion,"Motor, ""2207""",m,Acme,M-1,,buy,priced,4,1,4,4,1,4,1,RDQ,,17\.99,71\.96,71\.96,/);
    expect(rows).toHaveLength(3);
  });
});

describe("the account the views show", () => {
  it("maps the CLI's sign-in", () => {
    expect(accountView({ state: "signed-in", service: "s", email: "a@b.c", store: "the OS keychain", publisher: true })).toEqual({ state: "signed-in", service: "s", email: "a@b.c", publisher: true, detail: "Publisher" });
    expect(accountView({ state: "open", service: "s" })).toEqual({ state: "open", service: "s" });
    expect(accountView({ state: "expired", service: "s", problem: "revoked" })).toEqual({ state: "expired", service: "s", problem: "revoked" });
    expect(accountView({ state: "unknown" })).toEqual({ state: "unknown" });
  });
});
