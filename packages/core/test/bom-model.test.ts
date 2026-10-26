/**
 * The bill of materials' arithmetic (PB-933, docs/specs/bom.md): packs and
 * minimum orders, the price break the bought quantity reaches, one currency
 * with a dated rate table, the offer the rules choose and the one a person
 * pins, both totals.
 */
import { describe, expect, it } from "vitest";
import { BOM_CSV_COLUMNS, bomChoices, bomCsv, bomLines, bomSettingsProblems, formatUnitUsd, formatUsd, isFullReel, offerPackSize, packSizeOf, priceBom, quoteOffer, repriceBom, type BomInput, type BomLineInput, type BomOffer } from "../src/bom-model.js";
import { DEFAULT_FX, fxProblems, fxRate, type FxTable } from "../src/fx-rates.js";

const NOW = "2026-10-07T12:00:00Z";
const FX: FxTable = { schema: "protoboard.fx/v0", base: "EUR", date: "2026-10-01", source: "test table", rates: { USD: 1.2, GBP: 0.8 } };

const offer = (o: Partial<BomOffer> & { supplier: string }): BomOffer => ({ id: `library:${o.supplier}:${o.sku ?? ""}`, origin: "library", currency: "USD", breaks: [{ quantity: 1, unitPrice: 1 }], observedAt: "2026-10-01", file: "parts/offers.json", ...o });
const line = (l: Partial<BomLineInput> & { key: string }): BomLineInput => ({ definition: l.key, item: l.key, manufacturer: "", mpn: "", kind: "buy", quantity: 1, group: "", instances: [], offers: [], ...l });
const input = (lines: BomLineInput[]): BomInput => ({ project: "p", source: { kind: "design" }, lines, groups: [{ path: "", name: "System", quantity: 1 }] });
const price = (lines: BomLineInput[], opts: { units?: number; choices?: Record<string, string> } = {}) => priceBom(input(lines), { now: NOW, fx: FX, ...opts });

describe("rate table", () => {
  it("converts through the table's base, both ways, and says when it cannot", () => {
    expect(fxRate("USD", "USD", FX)).toBe(1);
    expect(fxRate("EUR", "USD", FX)).toBe(1.2);
    expect(fxRate("GBP", "USD", FX)).toBeCloseTo(1.5, 10);
    expect(fxRate("USD", "EUR", FX)).toBeCloseTo(1 / 1.2, 10);
    expect(fxRate("SEK", "USD", FX)).toBeUndefined();
  });

  it("ships a dated table that names its source", () => {
    expect(fxProblems(DEFAULT_FX)).toEqual([]);
    expect(DEFAULT_FX.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(DEFAULT_FX.source).toMatch(/European Central Bank/);
    expect(fxRate("EUR", "USD")).toBe(DEFAULT_FX.rates.USD);
  });

  it("reports a malformed table", () => {
    expect(fxProblems({})).toEqual(["not a protoboard.fx/v0 table"]);
    expect(fxProblems({ ...FX, date: "yesterday", rates: { usd: 1, GBP: -1 } })).toEqual([
      "date must be an ISO date (YYYY-MM-DD)",
      "rates.usd must be a positive number under an ISO 4217 code",
      "rates.GBP must be a positive number under an ISO 4217 code",
    ]);
  });
});

describe("one offer for a quantity", () => {
  it("rounds up to whole packs: one cent each, sold by the hundred, one used", () => {
    const q = quoteOffer(offer({ supplier: "A", packSize: 100, breaks: [{ quantity: 100, unitPrice: 0.01 }] }), 1, { now: NOW, fx: FX });
    expect(q).toMatchObject({ buy: 100, packs: 1, packSize: 100, surplus: 99, unitPrice: 0.01, orderCost: 1, fit: "overbuy" });
  });

  it("raises to the minimum order, then to whole packs", () => {
    expect(quoteOffer(offer({ supplier: "A", minOrder: 20 }), 8, { now: NOW, fx: FX })).toMatchObject({ buy: 20, packs: 20, packSize: 1, minOrder: 20, surplus: 12 });
    expect(quoteOffer(offer({ supplier: "A", minOrder: 25, packSize: 10 }), 8, { now: NOW, fx: FX })).toMatchObject({ buy: 30, packs: 3, surplus: 22 });
    expect(quoteOffer(offer({ supplier: "A", packSize: 15 }), 25, { now: NOW, fx: FX })).toMatchObject({ buy: 30, packs: 2, surplus: 5 });
  });

  it("uses the part's own pack size when the listing states none, and the listing's when it does", () => {
    expect(quoteOffer(offer({ supplier: "A" }), 3, { now: NOW, fx: FX, linePack: 4 })).toMatchObject({ buy: 4, packSize: 4 });
    expect(quoteOffer(offer({ supplier: "A", packSize: 10 }), 3, { now: NOW, fx: FX, linePack: 4 })).toMatchObject({ buy: 10, packSize: 10 });
  });

  it("prices at the break the bought quantity reaches; the first break is a minimum", () => {
    const o = offer({ supplier: "A", breaks: [{ quantity: 10, unitPrice: 0.5 }, { quantity: 100, unitPrice: 0.2 }] });
    expect(quoteOffer(o, 3, { now: NOW, fx: FX })).toMatchObject({ buy: 10, unitPrice: 0.5, orderCost: 5 });
    expect(quoteOffer(o, 39, { now: NOW, fx: FX })).toMatchObject({ buy: 39, unitPrice: 0.5 });
    // 99 at 0.50 would cost more than 100 at 0.20: the order goes to the break
    expect(quoteOffer(o, 99, { now: NOW, fx: FX })).toMatchObject({ buy: 100, unitPrice: 0.2, raised: { from: 99, fromCost: 49.5 } });
    expect(quoteOffer(o, 100, { now: NOW, fx: FX })).toMatchObject({ buy: 100, unitPrice: 0.2, orderCost: 20 });
  });

  it("buys up to a later price break when that costs less in all, and says what the smaller order would have cost", () => {
    // fasteners: 8 needed, sold in fives; 10 at the 10-piece price cost less than 10 at the 5-piece price
    const nut = offer({ supplier: "Fasteners", packSize: 5, minOrder: 5, breaks: [{ quantity: 5, unitPrice: 0.665 }, { quantity: 10, unitPrice: 0.396 }, { quantity: 100, unitPrice: 0.2 }] });
    expect(quoteOffer(nut, 8, { now: NOW })).toMatchObject({ buy: 10, packs: 2, unitPrice: 0.396, orderCost: 3.96, surplus: 2 });
    // three needed: 5 at 0.665 = 3.325 against 10 at 0.396 = 3.96: the smaller order stands
    expect(quoteOffer(nut, 3, { now: NOW })).toMatchObject({ buy: 5, unitPrice: 0.665 });
    expect(quoteOffer(nut, 3, { now: NOW }).raised).toBeUndefined();
    // steep breaks: 8 single pieces at 1.00 against 10 at 0.50
    const steep = offer({ supplier: "S", breaks: [{ quantity: 1, unitPrice: 1 }, { quantity: 10, unitPrice: 0.5 }, { quantity: 1000, unitPrice: 0.1 }] });
    expect(quoteOffer(steep, 8, { now: NOW })).toMatchObject({ buy: 10, unitPrice: 0.5, orderCost: 5, surplus: 2, raised: { from: 8, fromCost: 8 } });
    // the same cost is not a reason to buy more
    expect(quoteOffer(offer({ supplier: "T", breaks: [{ quantity: 1, unitPrice: 2.5 }, { quantity: 10, unitPrice: 2 }] }), 8, { now: NOW })).toMatchObject({ buy: 8, orderCost: 20 });
    // a break the stated stock cannot fill is not used
    expect(quoteOffer({ ...steep, stock: 9 }, 8, { now: NOW })).toMatchObject({ buy: 8, unitPrice: 1, covers: true });
    // whole packs still: a break at 25 sold in tens is 30
    expect(quoteOffer(offer({ supplier: "P", packSize: 10, breaks: [{ quantity: 10, unitPrice: 1 }, { quantity: 25, unitPrice: 0.2 }] }), 12, { now: NOW })).toMatchObject({ buy: 30, packs: 3, orderCost: 6, raised: { from: 20, fromCost: 20 } });
    // the line says so
    const l = bomLines(price([line({ key: "nut", quantity: 8, offers: [steep] })]))[0];
    expect(l.notes).toEqual(["buys 10 for 8 needed: at the price break 10 cost $5.00, 8 would cost $8.00"]);
    expect([l.perUnitCost, l.orderCost]).toEqual([4, 5]);
  });

  it("takes the minimum order as the pack when a listing sells only in multiples of it", () => {
    expect(offerPackSize("sale-quantity multiples", 5)).toBe(5);
    expect(offerPackSize("Sold in multiples of the minimum", 25)).toBe(25);
    expect(offerPackSize("bag of 100, sale-quantity multiples", 5)).toBe(100);
    expect(offerPackSize("sale-quantity multiples", null)).toBeUndefined();
    expect(offerPackSize("Cut Tape", 10)).toBeUndefined();
    expect(offerPackSize(undefined, 5)).toBeUndefined();
  });

  it("converts to dollars with the table and keeps the supplier's price and the rate", () => {
    const q = quoteOffer(offer({ supplier: "A", currency: "GBP", breaks: [{ quantity: 1, unitPrice: 2 }] }), 3, { now: NOW, fx: FX });
    expect(q.unitPrice).toBeCloseTo(3, 6);
    expect(q.orderCost).toBeCloseTo(9, 4);
    expect(q.native).toEqual({ unitPrice: 2, currency: "GBP", rate: 1.5 });
    expect(quoteOffer(offer({ supplier: "A" }), 1, { now: NOW, fx: FX }).native).toBeUndefined();
  });

  it("has no price without a rate or without breaks", () => {
    expect(quoteOffer(offer({ supplier: "A", currency: "SEK" }), 1, { now: NOW, fx: FX })).toMatchObject({ problem: "no-rate" });
    expect(quoteOffer(offer({ supplier: "A", breaks: [] }), 1, { now: NOW, fx: FX })).toMatchObject({ problem: "no-price" });
    expect(quoteOffer(offer({ supplier: "A", currency: undefined }), 1, { now: NOW, fx: FX })).toMatchObject({ problem: "no-price" });
  });

  it("marks a price stale by its age or by the library's word, and says whether the stock covers the order", () => {
    expect(quoteOffer(offer({ supplier: "A", observedAt: "2026-06-01" }), 1, { now: NOW, fx: FX })).toMatchObject({ stale: true, ageDays: 128 });
    expect(quoteOffer(offer({ supplier: "A", stale: true }), 1, { now: NOW, fx: FX })).toMatchObject({ stale: true, ageDays: 6 });
    expect(quoteOffer(offer({ supplier: "A" }), 1, { now: NOW, fx: FX })).toMatchObject({ stale: false, covers: null });
    expect(quoteOffer(offer({ supplier: "A", stock: 5 }), 6, { now: NOW, fx: FX }).covers).toBe(false);
    expect(quoteOffer(offer({ supplier: "A", stock: 6 }), 6, { now: NOW, fx: FX }).covers).toBe(true);
  });

  it("reads pack sizes from the sale unit as listed", () => {
    expect(["4-pack", "pack of 10", "set of 4 (2CW+2CCW)", "purchase unit 100 pcs", "1 PU = 70 pieces", "Tape & Reel (TR)", "sold in sale-quantity multiples", undefined].map(packSizeOf)).toEqual([4, 10, 4, 100, 70, undefined, undefined, undefined]);
  });

  it("knows a full reel from cut tape", () => {
    expect(isFullReel({ packaging: "Tape & Reel (TR)", minOrder: 3000 })).toBe(true);
    expect(isFullReel({ packaging: "Tape & Reel (TR)", minOrder: 5 })).toBe(false);
    expect(isFullReel({ packaging: "Cut Tape (CT)", minOrder: 3000 })).toBe(false);
    expect(isFullReel({ packaging: "reel, unit pack 1300" })).toBe(true);
  });
});

describe("the bill", () => {
  const screws = line({ key: "screw", quantity: 4, offers: [offer({ supplier: "Bolts", packSize: 100, minOrder: 100, breaks: [{ quantity: 100, unitPrice: 0.5 }] })] });
  const motor = line({ key: "motor", quantity: 4, offers: [offer({ supplier: "Shop", breaks: [{ quantity: 1, unitPrice: 37.5 }], stock: 50 })] });

  it("shows both costs: what a unit's parts cost, and what the order costs", () => {
    // the owners' case: the parts add up to 152, the order comes to 200
    const b = price([screws, motor]);
    expect(b.totals).toEqual({ perUnit: 152, order: 200, orderPerUnit: 200, surplus: 48 });
    expect(b.currency).toBe("USD");
    const [s, m] = bomLines(b);
    expect([s.needed, s.quote!.buy, s.perUnitCost, s.orderCost]).toEqual([4, 100, 2, 50]);
    expect([m.needed, m.quote!.buy, m.perUnitCost, m.orderCost]).toEqual([4, 4, 150, 150]);
    expect(s.notes).toEqual(["buys 100 for 4 needed (pack of 100)"]);
  });

  it("builds N units: the need multiplies, packs are shared, the order per unit falls", () => {
    const b = price([screws, motor], { units: 25 });
    expect(b.units).toBe(25);
    expect(bomLines(b).map((l) => [l.needed, l.quote!.buy])).toEqual([[100, 100], [100, 100]]);
    expect(b.totals).toEqual({ perUnit: 152, order: 3800, orderPerUnit: 152, surplus: 0 });
  });

  it("falls back to one unit for a number that is not a whole positive one", () => {
    expect(price([motor], { units: 0 }).units).toBe(1);
    expect(price([motor], { units: 2.5 }).units).toBe(1);
  });

  it("chooses the cheapest order in dollars, after conversion, among offers whose stock covers it", () => {
    const l = line({
      key: "x",
      quantity: 2,
      offers: [
        offer({ supplier: "Dear", sku: "1", breaks: [{ quantity: 1, unitPrice: 5 }] }),
        offer({ supplier: "Pounds", sku: "2", currency: "GBP", breaks: [{ quantity: 1, unitPrice: 3 }] }), // 4.50 USD
        offer({ supplier: "Empty", sku: "3", breaks: [{ quantity: 1, unitPrice: 1 }], stock: 0 }),
        offer({ supplier: "Old", sku: "4", breaks: [{ quantity: 1, unitPrice: 2 }], observedAt: "2026-01-01" }),
      ],
    });
    const b = price([l]);
    const [x] = bomLines(b);
    expect(x.quotes.map((q) => q.offer)).toEqual(["library:Pounds:2", "library:Dear:1", "library:Old:4", "library:Empty:3"]);
    expect(x.chosen).toBe("library:Pounds:2");
    expect(x.choice).toBe("auto");
    expect(x.notes).toEqual(["converted from GBP at 1.5 (2026-10-01)"]);
    expect(b.counts).toMatchObject({ priced: 1, converted: 1, stale: 0, pinned: 0, suppliers: 1 });
    expect(b.fx).toMatchObject({ date: "2026-10-01", source: "test table", used: [{ currency: "GBP", rate: 1.5 }] });
  });

  it("uses the offer a person chose, whatever the rules would pick, and says when it is gone", () => {
    const l = line({ key: "x", offers: [offer({ supplier: "Cheap", sku: "1" }), offer({ supplier: "Dear", sku: "2", breaks: [{ quantity: 1, unitPrice: 9 }], observedAt: "2026-01-01" })] });
    const pinned = bomLines(price([l], { choices: { x: "library:Dear:2" } }))[0];
    expect([pinned.chosen, pinned.choice, pinned.orderCost]).toEqual(["library:Dear:2", "pinned", 9]);
    expect(pinned.notes).toEqual(["price is 279 days old"]);
    const gone = price([l], { choices: { x: "library:Closed:9", other: "library:Cheap:1" } });
    expect([bomLines(gone)[0].chosen, bomLines(gone)[0].choice]).toEqual(["library:Cheap:1", "pinned-gone"]);
    expect(bomLines(gone)[0].notes[0]).toMatch(/no longer held/);
    expect(gone.unknownChoices).toEqual(["other"]);
  });

  it("never quotes a full reel for fewer than a reel by itself; a person may", () => {
    const reel = offer({ supplier: "Reels", packaging: "Tape & Reel (TR)", minOrder: 3000, breaks: [{ quantity: 3000, unitPrice: 0.01 }] });
    const auto = bomLines(price([line({ key: "c", quantity: 2, offers: [reel] })]))[0];
    expect(auto.status).toBe("unpriced");
    expect(auto.notes).toEqual(["only a full reel of 3000 is offered ($30.00); choose it to quote it"]);
    const chosen = bomLines(price([line({ key: "c", quantity: 2, offers: [reel] })], { choices: { c: reel.id } }))[0];
    expect([chosen.status, chosen.orderCost, chosen.quote!.fit]).toEqual(["priced", 30, "reel-over"]);
  });

  it("leaves a line unpriced rather than estimate it, and says why", () => {
    const b = price([
      line({ key: "none" }),
      line({ key: "listed", listing: { supplier: "shop.example", url: "https://shop.example/x" } }),
      line({ key: "krona", offers: [offer({ supplier: "S", currency: "SEK" })] }),
      line({ key: "blank", offers: [offer({ supplier: "S", breaks: [] })] }),
    ]);
    expect(bomLines(b).map((l) => [l.status, l.notes[0]])).toEqual([
      ["unpriced", "no offer held"],
      ["unpriced", "no price held; listed at shop.example"],
      ["unpriced", "an offer is in a currency the rate table lacks"],
      ["unpriced", "the offers held state no price"],
    ]);
    expect(b.totals).toEqual({ perUnit: 0, order: 0, orderPerUnit: 0, surplus: 0 });
    expect(b.counts).toMatchObject({ buy: 4, priced: 0, unpriced: 4 });
  });

  it("lists made and included lines without a price", () => {
    const b = price([line({ key: "pcb", kind: "make", process: "circuit (ext-tscircuit)" }), line({ key: "nut", kind: "included", includedWith: "the motor", offers: [offer({ supplier: "S" })] })]);
    expect(bomLines(b).map((l) => [l.status, l.orderCost, l.notes])).toEqual([
      ["make", undefined, ["made: circuit (ext-tscircuit)"]],
      ["included", undefined, ["ships with the motor"]],
    ]);
    expect(b.counts).toMatchObject({ lines: 2, buy: 0, make: 1, included: 1 });
  });

  it("groups by top-level module in the system's order, the system's own lines last", () => {
    const b = priceBom(
      { project: "p", source: { kind: "design" }, groups: [{ path: "arm", name: "Arm", quantity: 4 }, { path: "stack", name: "Stack", quantity: 1 }, { path: "", name: "Quad", quantity: 1 }], lines: [line({ key: "battery", group: "", offers: [offer({ supplier: "S" })] }), line({ key: "fc", group: "stack" }), { ...motor, group: "arm" }] },
      { now: NOW, fx: FX },
    );
    expect(b.groups.map((g) => [g.name, g.quantity, g.lines.map((l) => l.key), g.orderCost])).toEqual([
      ["Arm", 4, ["motor"], 150],
      ["Stack", 1, ["fc"], 0],
      ["Quad", 1, ["battery"], 1],
    ]);
  });

  it("is priced again by the views for other units and offers, exactly as from scratch", () => {
    const l = line({ key: "x", quantity: 3, offers: [offer({ supplier: "A", sku: "1", packSize: 10 }), offer({ supplier: "B", sku: "2", breaks: [{ quantity: 1, unitPrice: 2 }] })] });
    const first = price([l, screws]);
    const again = repriceBom(first, { units: 7, choices: { x: "library:B:2" } });
    expect(again).toEqual(price([l, screws], { units: 7, choices: { x: "library:B:2" } }));
    expect(bomChoices(again)).toEqual({ x: "library:B:2" });
    expect(repriceBom(again, { units: 1 }).totals).toEqual(price([l, screws], { choices: { x: "library:B:2" } }).totals);
  });

  it("exports CSV with both costs, the supplier's own price and the rate, quoted where needed", () => {
    const l = line({ key: "x", item: 'Screw, "long"', manufacturer: "Acme, Inc.", mpn: "S-1", quantity: 2, offers: [offer({ supplier: "Pounds", sku: "P1", currency: "GBP", url: "https://p.example/s", breaks: [{ quantity: 10, unitPrice: 0.2 }], minOrder: 10 })] });
    const rows = bomCsv(price([l, line({ key: "pcb", kind: "make" })], { units: 2 })).trimEnd().split("\n");
    expect(rows[0]).toBe(BOM_CSV_COLUMNS.join(","));
    expect(rows[1]).toBe('1,System,"Screw, ""long""",x,"Acme, Inc.",S-1,,buy,priced,2,2,4,10,1,10,10,Pounds,P1,0.3,0.6,3,0.2,GBP,1.5,2026-10-01,,2026-10-01,no,rules,https://p.example/s,converted from GBP at 1.5 (2026-10-01); buys 10 for 4 needed (minimum order 10)');
    expect(rows[2]).toBe("2,System,pcb,pcb,,,,make,make,1,2,2,,,,,,,,,,,,,,,,,,,made for this product");
    expect(rows).toHaveLength(3);
  });

  it("exports text a spreadsheet would run as a formula as text", () => {
    const csv = bomCsv(price([line({ key: "a", item: "=HYPERLINK(\"https://x.example\",\"part\")", manufacturer: "+1", mpn: "-5V-REG", value: "@home", quantity: 2, offers: [offer({ supplier: "\t=cmd", sku: "ok-1" })] })]));
    const row = csv.split("\n")[1];
    expect(row).toContain(`"'=HYPERLINK(""https://x.example"",""part"")"`);
    expect(row).toContain(",'+1,'-5V-REG,'@home,");
    expect(row).toContain("'\t=cmd");
    // numbers stay numbers, and ordinary text is untouched
    expect(row).toContain(",ok-1,1,2,2,");
  });

  it("formats dollars", () => {
    expect([formatUsd(0), formatUsd(1234.5), formatUsd(8689.851)]).toEqual(["$0.00", "$1,234.50", "$8,689.85"]);
    expect([formatUnitUsd(10.97), formatUnitUsd(0.0374), formatUnitUsd(0.01), formatUnitUsd(0.05594)]).toEqual(["$10.97", "$0.0374", "$0.01", "$0.0559"]);
  });

  it("validates the settings file", () => {
    expect(bomSettingsProblems({ schema: "protoboard.bom-settings/v0", units: 5, offers: { x: "library:A:1" } })).toEqual([]);
    expect(bomSettingsProblems({ schema: "protoboard.bom-settings/v0", units: 0, offers: { x: 1 } })).toEqual(["units must be a whole number above 0", "offers must map a line key to an offer id"]);
    expect(bomSettingsProblems([])).toEqual(["not a protoboard.bom-settings/v0 file"]);
  });
});
