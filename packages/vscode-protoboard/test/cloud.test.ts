/**
 * The Cloud view (spec §2.4): the cost of the design's bill of materials,
 * priced in dollars only from offers the project holds, with unpriced lines
 * listed; the units and offers the project keeps;
 * releases found newest first; the release outcome; the package page; then
 * the quadcopter example's own release, when it has one.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { ACCOUNT_PENDING, cloudPageModel, pageOrder, projectAuthor, releaseOutcome } from "../src/cloud.js";
import { bomFileProblems, compareVersions, designLines, listReleases, money, parseCsv, projectBom, projectCost, readBomSettings, readHeldOffers, writeBomSettings } from "../src/cost.js";
import { indexProject } from "../src/model.js";
import { packageHtml, packageLink } from "../src/packagePage.js";
import { bundle, resolved } from "./fixtures.js";

const REPO = fileURLToPath(new URL("../../..", import.meta.url));

const HEADER = "line,definition,item,manufacturer,mpn,action,process,qty_per_product,build,needed,spares,spares_rule,order,pack_qty,packs,moq,supplier,supplier_sku,unit_price,currency,extended,stock,lead_time_weeks,offer_as_of,offer_source,offer_url,alternates,lifecycle,lifecycle_source,tier,origin,units,note";
const row = (o: Record<string, string | number>) =>
  HEADER.split(",")
    .map((k) => {
      const v = String(o[k] ?? "");
      return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
    })
    .join(",");

const ORDERING = [
  HEADER,
  row({ line: 1, definition: "case", item: "Case (custom)", action: "fabricate", process: "print (ext-enclosure-cad)", qty_per_product: 1, order: 1 }),
  row({ line: 2, definition: "mcu", item: "MCU", manufacturer: "Acme", mpn: "MCU-1", action: "buy", qty_per_product: 1, order: 1, note: "no offer recorded (ext-sourcing supplier-compare, or protoboard parts offers)" }),
  row({ line: 3, definition: "led", item: "LED, red", manufacturer: "Lite", mpn: "L-1", action: "buy", qty_per_product: 3, order: 5, unit_price: 0.1, currency: "USD", extended: 0.5, supplier: "DigiKey", offer_source: "sourcing" }),
  row({ line: 4, definition: "pin", item: "Pin", action: "buy", qty_per_product: 2, order: 4 }),
  row({ line: 5, definition: "flex", item: 'Flex "A", 40 mm', action: "included", qty_per_product: 1, order: 0, note: "included with mainboard" }),
].join("\n");

let tmp: string | undefined;
afterEach(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
  tmp = undefined;
});

function project(files: Record<string, string>): string {
  tmp = mkdtempSync(join(tmpdir(), "pb-cloud-"));
  for (const [f, text] of Object.entries(files)) {
    mkdirSync(join(tmp, f, ".."), { recursive: true });
    writeFileSync(join(tmp, f), text);
  }
  return tmp;
}

describe("CSV", () => {
  it("reads quoted fields, doubled quotes and newlines inside quotes, with each row's line", () => {
    const { rows, lines } = parseCsv('a,b\n"x, y","say ""hi"""\n"two\nlines",z\n');
    expect(rows).toEqual([["a", "b"], ["x, y", 'say "hi"'], ["two\nlines", "z"]]);
    expect(lines).toEqual([1, 2, 3]);
    expect(parseCsv("a\r\n\r\nb").rows).toEqual([["a"], ["b"]]);
  });
});

const NOW = "2026-10-07T00:00:00Z";
const FX = JSON.stringify({ schema: "protoboard.fx/v0", base: "USD", date: "2026-10-01", source: "test table", rates: { GBP: 0.8, EUR: 0.9 } });
const OFFERS = {
  "parts/fx-rates.json": FX,
  "parts/offers.json": JSON.stringify({
    schema: "protoboard.offers/v0",
    service: "http://x",
    retrievedAt: "2026-10-02",
    parts: {
      pin: [{ supplier: "Mouser", unitPrice: 0.25, currency: "USD", minQuantity: 10, observedAt: "2026-10-02", url: "https://mouser.example/pin" }],
      led: [{ supplier: "Lite UK", sku: "L1", unitPrice: 0.08, currency: "GBP", observedAt: "2026-10-01", url: "https://lite.example/led", stock: 900 }],
    },
  }),
  "parts/evidence/mcu/sourcing.json": JSON.stringify({ schema: "protoboard.sourcing/v0", offers: [{ supplier: "Arrow", url: "https://arrow.example", as_of: "2026-09-30", price_breaks: [] }] }),
};

describe("cost", () => {
  const index = indexProject(resolved, bundle);

  it("prices the design from the offers held, in dollars; lists the rest as unpriced; made lines need a quote", () => {
    const root = project(OFFERS);
    const cost = projectCost(root, "watch", index, { now: NOW })!;
    expect(cost.source).toEqual({ kind: "design" });
    const by = Object.fromEntries(cost.lines.map((l) => [l.definition, l]));
    // 0.08 GBP at 1.25: converted, and said
    expect(by.led).toMatchObject({ kind: "priced", unitPrice: 0.1, extended: 0.3, currency: "USD", priceFrom: "the library", supplier: "Lite UK", note: "converted from GBP at 1.25 (2026-10-01)" });
    // the minimum order of 10 is bought, and said
    expect(by.pin).toMatchObject({ kind: "priced", unitPrice: 0.25, order: 10, extended: 2.5, note: "buys 10 for 2 needed (minimum order 10)" });
    expect(by.mcu).toMatchObject({ kind: "unpriced", note: "the offers held state no price", instances: ["board/mcu"] });
    expect(by.case).toMatchObject({ kind: "made", note: "made: cad (ext-enclosure-cad)" });
    expect(cost.bom.totals).toEqual([{ currency: "USD", amount: 2.8 }]);
    expect(cost.bill.totals).toEqual({ perUnit: 0.8, order: 2.8, orderPerUnit: 2.8, surplus: 2 });
    // the board is made too (its components are bought)
    expect(by.mainboard).toMatchObject({ kind: "made" });
    expect(cost.manufacturing).toEqual({ status: "needs-quote", made: 2 });
    expect(by.led.instances).toEqual(["board/led", "spare_led"]);
    expect(cost.offers).toEqual({ catalog: true, sourcing: 1 });
  });

  it("one currency: everything is dollars, converted with the dated table and marked", () => {
    const bill = projectBom(project(OFFERS), "watch", index, { now: NOW })!;
    expect(bill.currency).toBe("USD");
    expect(bill.fx).toMatchObject({ date: "2026-10-01", source: "test table", project: true, used: [{ currency: "GBP", rate: 1.25 }] });
    expect(bill.counts).toMatchObject({ priced: 2, converted: 1 });
    expect(bill.offersRetrievedAt).toBe("2026-10-02");
    // without a table of its own, the project converts with core's dated one
    const dflt = projectBom(project({ "parts/offers.json": OFFERS["parts/offers.json"] }), "watch", index, { now: NOW })!;
    expect(dflt.fx).toMatchObject({ project: false, base: "EUR" });
    expect(dflt.fx.source).toMatch(/European Central Bank/);
    expect(money(2.5, "USD")).toBe("$2.50");
  });

  it("the design's lines: assemblies left out, quantities through the tree, bound modules made, grouped by top-level module", () => {
    const { lines, groups } = designLines(index, "watch");
    const by = Object.fromEntries(lines.map((l) => [l.definition, l]));
    expect(Object.keys(by).sort()).toEqual(["case", "case-screws", "flex", "led", "mainboard", "mcu", "pin"]);
    expect(by.led.quantity).toBe(3); // 2 on the board and the spare
    expect(by.pin.quantity).toBe(2);
    expect(by.case).toMatchObject({ kind: "make", process: "cad (ext-enclosure-cad)" });
    expect(by.mcu).toMatchObject({ kind: "buy", group: "board" });
    // used by the board and placed on the system itself: the system's line
    expect(by.led.group).toBe("");
    expect(groups[groups.length - 1].path).toBe("");
    const root = project({ "src/x.ts": "" });
    expect(projectCost(root, "watch", index)!.source).toEqual({ kind: "design" });
    expect(projectCost(root, "watch", undefined)).toBeUndefined();
  });

  it("keeps the units to build and the chosen offers in parts/bom.json, and reports a malformed file", () => {
    const root = project(OFFERS);
    expect(readBomSettings(root)).toEqual({ settings: { schema: "protoboard.bom-settings/v0" }, problems: [] });
    writeBomSettings(root, { units: 20 });
    writeBomSettings(root, { offer: { line: "led", offer: "library:Lite UK:L1" } });
    expect(JSON.parse(readFileSync(join(root, "parts/bom.json"), "utf8"))).toEqual({ schema: "protoboard.bom-settings/v0", units: 20, offers: { led: "library:Lite UK:L1" } });
    const bill = projectBom(root, "watch", index, { now: NOW })!;
    expect(bill.units).toBe(20);
    expect(bill.counts.pinned).toBe(1);
    // 60 LEDs and 40 pins: nothing left over at this size
    expect(bill.totals).toEqual({ perUnit: 0.8, order: 16, orderPerUnit: 0.8, surplus: 0 });
    writeBomSettings(root, { offer: { line: "led", offer: null } });
    expect(readBomSettings(root).settings).toEqual({ schema: "protoboard.bom-settings/v0", units: 20 });
    expect(() => writeBomSettings(root, { units: 0 })).toThrow(/whole number from 1/);
    writeFileSync(join(root, "parts/bom.json"), "{");
    writeFileSync(join(root, "parts/fx-rates.json"), JSON.stringify({ schema: "protoboard.fx/v0", base: "USD", date: "2026-10-01", source: "", rates: {} }));
    expect(bomFileProblems(root).map((x) => `${x.file}: ${x.message.replace(/: .*/, "")}`)).toEqual(["parts/bom.json: not JSON", "parts/fx-rates.json: source must say who published the rates"]);
  });

  it("finds releases newest first; folders without a manifest or ordering list are not releases", () => {
    const root = project({
      "release/0.9.0/manifest.json": JSON.stringify({ date: "2026-09-01T00:00:00Z" }),
      "release/0.10.0/manifest.json": JSON.stringify({ date: "2026-09-02T00:00:00Z" }),
      "release/0.10.0/index.html": "<html></html>",
      "release/tmp/notes.txt": "",
    });
    const rs = listReleases(root);
    expect(rs.map((r) => r.version)).toEqual(["0.10.0", "0.9.0"]);
    expect(rs[0]).toMatchObject({ hasOrderingList: false, index: join(root, "release/0.10.0/index.html"), overview: undefined });
    expect(compareVersions("0.10.0", "0.9.1")).toBeGreaterThan(0);
    // without a manifest date, the folder's time
    utimesSync(join(root, "release/0.9.0"), new Date(), new Date());
    expect(listReleases(join(root, "nothing"))).toEqual([]);
  });

  const fileBill = (root: string, rows: Record<string, string | number>[]) => projectBom(root, "p", undefined, { now: NOW, file: { rel: "x.csv", text: [HEADER, ...rows.map(row)].join("\n") } })!;

  it("the library's offers carry their MPN and price breaks: a series part's value is priced by its own MPN", () => {
    const root = project({
      "parts/offers.json": JSON.stringify({
        schema: "protoboard.offers/v0",
        service: "http://x",
        retrievedAt: "2026-10-03",
        parts: {
          res: [
            { mpn: "R-10K", supplier: "LCSC", unitPrice: 0.004, currency: "USD", priceBreaks: [{ quantity: 100, unitPrice: 0.004 }, { quantity: 1000, unitPrice: 0.002 }], minQuantity: 100, observedAt: "2026-10-03", url: "https://lcsc.example/10k", source: "internal", note: "internal" },
            { mpn: "R-4K7", supplier: "LCSC", unitPrice: 0.009, currency: "USD", minQuantity: 100, observedAt: "2026-10-03", url: "https://lcsc.example/4k7" },
          ],
        },
      }),
    });
    const held = readHeldOffers(root, ["res"]).offers.get("res")!;
    expect(held.map((o) => [o.id, o.mpn, o.minOrder, o.breaks.map((b) => [b.quantity, b.unitPrice])])).toEqual([
      ["library:LCSC:R-10K", "R-10K", 100, [[100, 0.004], [1000, 0.002]]],
      ["library:LCSC:R-4K7", "R-4K7", 100, [[100, 0.009]]],
    ]);
    // how a price was read is not carried, even from a file that still holds it
    expect(JSON.stringify(held)).not.toMatch(/internal/);
    const bill = fileBill(root, [{ line: 1, definition: "res", mpn: "R-10K", action: "buy", qty_per_product: 1500 }, { line: 2, definition: "res", mpn: "R-4K7", action: "buy", qty_per_product: 3 }]);
    expect(bill.source).toEqual({ kind: "file", file: "x.csv" });
    expect(bill.groups[0].lines.map((l) => [l.key, l.mpn, l.quote?.unitPrice, l.quote?.buy, l.orderCost])).toEqual([
      ["res", "R-10K", 0.002, 1500, 3],
      ["res@2", "R-4K7", 0.009, 100, 0.9],
    ]);
  });

  it("chooses as the release does: cut tape before a full reel, never a reel for fewer than a reel; then the cheapest in dollars (PB-872, PB-933)", () => {
    const reel = { mpn: "USB-1", supplier: "Reel House", unitPrice: 1.48, currency: "USD", priceBreaks: [{ quantity: 1300, unitPrice: 1.48 }], minQuantity: 1300, packaging: "REEL (unit pack 1300)", observedAt: "2026-10-03" };
    const cut = { mpn: "USB-1", supplier: "Cut Tape Co", unitPrice: 2.9, currency: "USD", packaging: "Cut Tape (CT)", observedAt: "2026-10-03" };
    const euro = { mpn: "USB-1", supplier: "Euro Parts", unitPrice: 1.8, currency: "EUR", observedAt: "2026-10-03" };
    const quote = (list: unknown[]) => fileBill(project({ "parts/fx-rates.json": FX, "parts/offers.json": JSON.stringify({ schema: "protoboard.offers/v0", parts: { usb: list } }) }), [{ line: 1, definition: "usb", mpn: "USB-1", action: "buy", qty_per_product: 1 }]).groups[0].lines[0];
    expect(quote([reel, cut])).toMatchObject({ status: "priced", chosen: "library:Cut Tape Co:USB-1", orderCost: 2.9 });
    expect(quote([reel])).toMatchObject({ status: "unpriced", notes: ["only a full reel of 1300 is offered ($1,924.00); choose it to quote it"] });
    // 1.80 EUR is 2.00 USD: cheaper than 2.90, converted and marked
    expect(quote([euro, cut])).toMatchObject({ chosen: "library:Euro Parts:USB-1", orderCost: 2, notes: ["converted from EUR at 1.111111 (2026-10-01)"] });
  });

  it("a project's own record that sells in multiples of its minimum is bought in those multiples, like the library's (PB-933)", () => {
    const breaks = [{ quantity: 5, unit_price: 0.665, currency: "USD" }, { quantity: 10, unit_price: 0.396, currency: "USD" }];
    const root = project({
      "parts/evidence/nut/sourcing.json": JSON.stringify({ schema: "protoboard.sourcing/v0", part: "nut", manufacturer: "W", mpn: "N-M2", offers: [{ supplier: "Fasteners", mpn: "N-M2", url: "https://f.example/n", as_of: "2026-10-01", via: "web", moq: 5, packaging: "bag, sale-quantity multiples", stock: 1000, price_breaks: breaks }] }),
      "parts/offers.json": JSON.stringify({ schema: "protoboard.offers/v0", retrievedAt: "2026-10-02T00:00:00Z", parts: { nut: [{ supplier: "Library Shop", mpn: "N-M2", currency: "USD", unitPrice: 0.9, minQuantity: 5, packaging: "sale-quantity multiples", observedAt: "2026-10-01" }] } }),
    });
    const held = readHeldOffers(root, ["nut"]).offers.get("nut")!;
    expect(held.map((o) => [o.origin, o.packSize, o.minOrder])).toEqual([["library", 5, 5], ["project", 5, 5]]);
    // eight needed: never eight (not a quantity either sells); ten at the ten-piece price
    const l = fileBill(root, [{ line: 1, definition: "nut", mpn: "N-M2", action: "buy", qty_per_product: 8 }]).groups[0].lines[0];
    expect([l.quote?.buy, l.quote?.packs, l.quote?.unitPrice, l.orderCost]).toEqual([10, 2, 0.396, 3.96]);
    expect(l.quotes.map((q) => q.buy)).toEqual([10, 10]);
  });

  it("reads offers only in their schemas", () => {
    const root = project({ "parts/offers.json": JSON.stringify({ schema: "other", parts: { a: [{ supplier: "X", unitPrice: 1, currency: "USD" }] } }), "parts/evidence/a/sourcing.json": "{" });
    expect(readHeldOffers(root, ["a"])).toMatchObject({ library: false, project: 0 });
    expect(readHeldOffers(root, ["a"]).offers.size).toBe(0);
  });
});

describe("Cloud view model", () => {
  const index = indexProject(resolved, bundle);

  it("says what is not available yet, totals the BOM in dollars, and orders the lines unpriced first", () => {
    const root = project({ ...OFFERS, "release/0.1.0/manifest.json": "{}", "release/0.1.0/system/ordering-list.csv": ORDERING, "release/0.1.0/index.html": "x" });
    const releases = listReleases(root);
    const cost = projectCost(root, "watch", index, { now: NOW })!;
    const m = cloudPageModel({ project: "watch", cost, releases, release: { state: "idle" } });
    expect(m.account).toEqual(ACCOUNT_PENDING);
    expect(m.cost!.source).toEqual({ kind: "design" });
    expect(m.cost!.bom.totals).toEqual(["$2.80"]);
    expect(m.cost!.total).toBe("$2.80 + quote");
    expect([m.cost!.units, m.cost!.perUnit, m.cost!.order]).toEqual([1, "$0.80", "$2.80"]);
    expect(m.cost!.lines.map((l) => l.kind).sort()).toEqual(["made", "made", "priced", "priced", "unpriced", "unpriced", "unpriced"]);
    expect(m.cost!.lines[0].kind).toBe("unpriced");
    expect(m.cost!.lines.find((l) => l.item === "MCU")).toMatchObject({ price: "unpriced", module: "board/mcu", qty: "1/product" });
    expect(m.cost!.lines.find((l) => l.definition === "pin")).toMatchObject({ qty: "2/product, order 10", price: "$2.50" });
    // the page's index is the model's order
    expect(pageOrder(cost).map((l) => l.definition)).toEqual(m.cost!.lines.map((l) => l.definition));
    expect(m.releases).toHaveLength(1);
    expect(m.releases[0]).toMatchObject({ version: "0.1.0", index: true, overview: false });
  });

  it("without a build, says so", () => {
    const m = cloudPageModel({ project: "watch", costMissing: "no build", releases: [], release: { state: "idle" } });
    expect(m.cost).toBeUndefined();
    expect(m.costMissing).toBe("no build");
  });

  it("reads a release run: done, refused (uncommitted changes only), failed", () => {
    expect(releaseOutcome({ status: "succeeded", summary: "release/0.1.0: 2 unit(s)", outputs: [{ path: "release/0.1.0/00-overview.pdf" }] })).toMatchObject({ ok: true, folder: "release/0.1.0", problems: [] });
    const dirty = releaseOutcome({ status: "failed", summary: "release refused: 1 problem(s)", data: { diagnostics: [{ code: "REL_DIRTY", severity: "error", message: "uncommitted changes" }] } });
    expect(dirty).toMatchObject({ ok: false, dirtyOnly: true, problems: [{ code: "REL_DIRTY", message: "uncommitted changes" }] });
    const stale = releaseOutcome({ status: "failed", summary: "refused", data: { diagnostics: [{ code: "REL_DIRTY", severity: "error", message: "x" }, { code: "REL_STALE", severity: "error", message: "y" }] } });
    expect(stale.dirtyOnly).toBe(false);
  });

  it("draws the Cloud panel: the real account, the project, the release, the cost as a preview with both figures", () => {
    const root = project({ ...OFFERS, "release/0.1.0/manifest.json": JSON.stringify({ units: [{ id: "a" }, { id: "b" }] }), "release/0.1.0/system/ordering-list.csv": ORDERING, "release/0.1.0/index.html": "x" });
    const releases = listReleases(root);
    const cost = projectCost(root, "watch", index, { now: NOW })!;
    const m = cloudPageModel({
      project: "watch",
      cost,
      releases,
      release: { state: "idle" },
      accountState: { state: "signed-in", service: "https://parts.example", email: "ada@example.com", store: "the OS keychain" },
      facts: { name: "Watch", description: "A wearable.", libraries: 2, parts: 9 },
    });
    expect(m.view.account).toMatchObject({ state: "signed-in", email: "ada@example.com" });
    // where the sign-in is kept is for whoami and doctor, not the panel
    expect(m.view.account).not.toHaveProperty("detail");
    expect(m.view.project).toEqual({ name: "Watch", description: "A wearable.", libraries: 2, parts: 9, published: false });
    expect(m.view.releases[0]).toMatchObject({ version: "0.1.0", units: 2, index: true });
    expect(m.view.cost).toMatchObject({ total: "$0.80", order: "$2.80 to order 1", others: ["1 converted at the rates of 2026-10-01"], bought: 5, priced: 2, unpriced: 3, made: 2, top: [{ item: "Pin ×2", price: "$2.50" }, { item: "LED ×3", price: "$0.30" }], source: "the design" });
    expect(cloudPageModel({ project: "watch", costMissing: "no build", releases: [], release: { state: "idle" } }).view).toMatchObject({ account: { state: "unknown" }, costMissing: "no build" });
  });

});

describe("package page", () => {
  it("adds a base, a policy and the link script to the package's index.html", () => {
    const html = packageHtml('<!doctype html><html><head><meta charset="utf-8"><title>P</title></head><body><a href="#x">x</a></body></html>', { base: "https://wv/release/0.1.0", cspSource: "https://wv", nonce: "n1" });
    expect(html).toMatch(/<head><meta charset="utf-8">\n<meta http-equiv="Content-Security-Policy"[^>]*>\n<base href="https:\/\/wv\/release\/0.1.0\/">/);
    expect(html).toContain("script-src &#39;nonce-n1&#39;");
    expect(html).toContain('<script nonce="n1">');
    expect(html.indexOf("<script")).toBeGreaterThan(html.indexOf("<body>"));
  });

  it("opens files inside the package and http(s) links; nothing else", () => {
    expect(packageLink("system/bom.csv")).toEqual({ kind: "file", path: "system/bom.csv" });
    expect(packageLink("./units/stack/../stack/bom.pdf")).toEqual({ kind: "file", path: "units/stack/bom.pdf" });
    expect(packageLink("../../secrets.txt")).toBeUndefined();
    expect(packageLink("/etc/passwd")).toBeUndefined();
    expect(packageLink("javascript:alert(1)")).toBeUndefined();
    expect(packageLink("https://example.com/x")).toEqual({ kind: "url", url: "https://example.com/x" });
  });
});

describe("the quadcopter's release", () => {
  const root = join(REPO, "examples", "quadcopter-5in");
  const rel = listReleases(root).find((r) => r.hasOrderingList);
  it.skipIf(!rel)("lists every line of its ordering list on request, pricing none without an offer", () => {
    const cost = projectCost(root, "quadcopter-5in", undefined, { release: rel! })!;
    expect(cost.source.kind).toBe("release");
    expect(cost.lines.length).toBeGreaterThan(20);
    for (const l of cost.lines) expect(l.row?.file).toMatch(/^release\/.+\/system\/ordering-list\.csv$/);
    expect(cost.lines.filter((l) => l.kind === "made").map((l) => l.definition)).toContain("quadcopter-5in-frame");
    expect(cost.bom.priced + cost.bom.unpriced + cost.bom.included + cost.manufacturing.made).toBe(cost.lines.length);
  });
});

describe("the project's author", () => {
  it("reads package.json's author (string or object), else the first commit's, once per root", () => {
    const a = mkdtempSync(join(tmpdir(), "pb-author-"));
    const b = mkdtempSync(join(tmpdir(), "pb-author-"));
    const c = mkdtempSync(join(tmpdir(), "pb-author-"));
    try {
      writeFileSync(join(a, "package.json"), JSON.stringify({ author: "Ada Lovelace <ada@example.com> (https://example.com)" }));
      writeFileSync(join(b, "package.json"), JSON.stringify({ author: { name: "Grace" } }));
      let asked = 0;
      const git = () => (asked++, "First Committer");
      expect(projectAuthor(a, git)).toBe("Ada Lovelace");
      expect(projectAuthor(b, git)).toBe("Grace");
      expect(projectAuthor(c, git)).toBe("First Committer");
      expect(projectAuthor(c, git)).toBe("First Committer");
      expect(asked).toBe(1);
    } finally {
      for (const d of [a, b, c]) rmSync(d, { recursive: true, force: true });
    }
  });
});
