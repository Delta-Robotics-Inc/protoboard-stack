/**
 * `protoboard bom` (PB-904, PB-933): the bill of materials from the design,
 * grouped by top-level module and priced in dollars from the offers the
 * project holds, the same way the BOM views and the Cloud view price it;
 * units to build, the offer chosen per line, a release's lines on request.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { loadProject } from "@protoboardai/core";
import { bomLines } from "@protoboardai/core/bom";
import { chooseOffer, formatBom, formatOffers, projectBom } from "../src/bom.js";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const TMP = join(HERE, ".tmp-bom");
const CLI = join(HERE, "../bin/protoboard.mjs");
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

function project(files: Record<string, string>): string {
  const dir = join(TMP, `p${Math.random().toString(36).slice(2, 8)}`);
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(join(dir, rel, ".."), { recursive: true });
    writeFileSync(join(dir, rel), content);
  }
  return dir;
}

const BASE = {
  "protoboard.config.ts": `import { defineConfig } from "@protoboardai/core";\nexport default defineConfig({ root: { source: "src/sys.uhd.ts", export: "SYS" } });\n`,
  "src/sys.uhd.ts": [
    `const motor = { id: "motor", name: "Motor", manufacturer: "Acme", part_number: "M-1", interfaces: [] };`,
    `const prop = { id: "prop", name: "Propeller", manufacturer: "Acme", part_number: "P-5", interfaces: [] };`,
    `const battery = { id: "battery", name: "Battery", manufacturer: "Cell Co", part_number: "B-6S", interfaces: [] };`,
    `export const DEFS = [motor, prop, battery];`,
    `export const ARM = { id: "arm", name: "Propulsion", interfaces: [], children: [{ id: "motor", moduleDefId: "motor" }, { id: "prop", moduleDefId: "prop" }] };`,
    `export const SYS = { id: "sys", name: "Quad", interfaces: [], children: [{ id: "arm", moduleDefId: "arm", quantity: 4 }, { id: "battery", moduleDefId: "battery" }] };`,
    "",
  ].join("\n"),
  "parts/offers.json": JSON.stringify({
    schema: "protoboard.offers/v0",
    parts: {
      motor: [
        { supplier: "RaceDayQuads", sku: "RDQ-1", unitPrice: 17.99, currency: "USD", observedAt: "2026-10-03", url: "https://example.com/m", stock: 40 },
        { supplier: "Motors UK", sku: "UK-1", unitPrice: 12, currency: "GBP", observedAt: "2026-10-02", url: "https://example.co.uk/m" },
      ],
      battery: [{ supplier: "CNHL", unitPrice: 34.99, currency: "USD", observedAt: "2026-10-01", url: "https://example.com/b", minQuantity: 2, packaging: "2-pack" }],
    },
  }),
};

const NOW = "2026-10-07T00:00:00Z";
const FX = JSON.stringify({ schema: "protoboard.fx/v0", base: "USD", date: "2026-10-01", source: "test table", rates: { GBP: 0.8 } });
const cli = (dir: string, ...args: string[]) => spawnSync(process.execPath, [CLI, ...args, "--cwd", dir], { encoding: "utf8", timeout: 120000 });

describe("protoboard bom", () => {
  it("lists the design by top-level module, priced in dollars from the offers held, with both totals", async () => {
    const dir = project({ ...BASE, "parts/fx-rates.json": FX });
    const t = projectBom(await loadProject(dir, { checks: false }), { now: NOW });
    expect(t.source).toEqual({ kind: "design" });
    expect(t.currency).toBe("USD");
    // the UK offer is 12 GBP = 15.00 USD at the project's table: cheaper than 17.99, so it is used, and marked
    expect(t.groups.map((g) => [g.name, g.quantity, g.lines.map((l) => [l.key, l.quantity, l.status, l.quote?.buy, l.perUnitCost, l.orderCost])])).toEqual([
      ["Propulsion", 4, [["motor", 4, "priced", 4, 60, 60], ["prop", 4, "unpriced", undefined, undefined, undefined]]],
      ["Quad", 1, [["battery", 1, "priced", 2, 34.99, 69.98]]],
    ]);
    expect(t.totals).toEqual({ perUnit: 94.99, order: 129.98, orderPerUnit: 129.98, surplus: 34.99 });
    expect(t.counts).toMatchObject({ lines: 3, buy: 3, priced: 2, unpriced: 1, make: 0, included: 0, converted: 1, suppliers: 2 });
    expect(t.fx).toMatchObject({ date: "2026-10-01", source: "test table", project: true, used: [{ currency: "GBP", rate: 1.25 }] });
    const motor = bomLines(t)[0];
    expect(motor.quote!.native).toEqual({ unitPrice: 12, currency: "GBP", rate: 1.25 });
    expect(motor.partStatus).toBe("local");
    const text = formatBom(t);
    expect(text).toMatch(/Propulsion ×4 \(2 lines, \$60\.00\)\n {2}Motor .* \$15\.00 +\$60\.00 +4 +\$60\.00 {2}Motors UK\n {6}converted from GBP at 1\.25 \(2026-10-01\)/);
    expect(text).toMatch(/Per unit: {2}\$94\.99 /);
    expect(text).toMatch(/Order: {5}\$129\.98 {2}for 1 unit; \$34\.99 of it buys pieces left over/);
    expect(text).toMatch(/Converted: 1 line\(s\), with the test table \(parts\/fx-rates\.json\) of 2026-10-01: 1 GBP = 1\.25 USD/);
    // nothing says how a price was fetched
    expect(JSON.stringify(t)).not.toMatch(/"source":"https|"note"|via/);
  });

  it("builds N units, and keeps the number when asked", async () => {
    const dir = project(BASE);
    const p = await loadProject(dir, { checks: false });
    const t = projectBom(p, { units: 10, now: NOW });
    expect(t.units).toBe(10);
    expect(bomLines(t).map((l) => [l.key, l.needed, l.quote?.buy])).toEqual([["motor", 40, 40], ["prop", 40, undefined], ["battery", 10, 10]]);
    expect(t.totals.surplus).toBe(0);
    expect(() => projectBom(p, { units: 0 })).toThrow(/--units is a whole number/);

    const saved = cli(dir, "bom", "units", "3", "--format", "json");
    expect(saved.status).toBe(0);
    expect(JSON.parse(readFileSync(join(dir, "parts/bom.json"), "utf8"))).toEqual({ schema: "protoboard.bom-settings/v0", units: 3 });
    expect(JSON.parse(cli(dir, "bom", "--format", "json").stdout).units).toBe(3);
    // --units for one run wins over the setting and does not change it
    expect(JSON.parse(cli(dir, "bom", "--units", "7", "--format", "json").stdout).units).toBe(7);
    expect(JSON.parse(readFileSync(join(dir, "parts/bom.json"), "utf8")).units).toBe(3);
  });

  it("chooses a line's offer by supplier or id, and goes back to the rules", async () => {
    const dir = project(BASE);
    const load = () => loadProject(dir, { checks: false });
    expect(bomLines(projectBom(await load(), { now: NOW }))[0]).toMatchObject({ chosen: "library:Motors UK:UK-1", choice: "auto" });
    expect(chooseOffer(await load(), "motor", "racedayquads")).toEqual({ line: "motor", offer: "library:RaceDayQuads:RDQ-1", supplier: "RaceDayQuads" });
    expect(JSON.parse(readFileSync(join(dir, "parts/bom.json"), "utf8"))).toEqual({ schema: "protoboard.bom-settings/v0", units: 1, offers: { motor: "library:RaceDayQuads:RDQ-1" } });
    const t = projectBom(await load(), { now: NOW });
    expect(bomLines(t)[0]).toMatchObject({ chosen: "library:RaceDayQuads:RDQ-1", choice: "pinned", orderCost: 71.96 });
    expect(formatBom(t)).toMatch(/RaceDayQuads \(chosen\)/);
    expect(formatOffers(t, bomLines(t)[0])).toMatch(/▸ library:RaceDayQuads:RDQ-1 .*chosen · stock 40/);
    // by ordering code, by id
    expect(chooseOffer(await load(), "M-1", "library:Motors UK:UK-1").supplier).toBe("Motors UK");
    expect(chooseOffer(await load(), "motor", "auto")).toEqual({ line: "motor", offer: null });
    expect(JSON.parse(readFileSync(join(dir, "parts/bom.json"), "utf8")).offers).toBeUndefined();
    await expect(async () => chooseOffer(await load(), "motor", "Nobody")).rejects.toThrow(/motor holds no offer "Nobody" \(offers: library:RaceDayQuads:RDQ-1, library:Motors UK:UK-1\)/);
    await expect(async () => chooseOffer(await load(), "wing", "auto")).rejects.toThrow(/no line "wing"/);
  });

  it("exports CSV and refuses malformed settings", async () => {
    const dir = project(BASE);
    const csv = cli(dir, "bom", "--format", "csv");
    expect(csv.status).toBe(0);
    const rows = csv.stdout.trimEnd().split("\n");
    expect(rows[0]).toMatch(/^line,module,item,definition,.*unit_price_usd,per_unit_cost_usd,order_cost_usd,supplier_unit_price,supplier_currency,fx_rate,fx_date/);
    expect(rows).toHaveLength(4);
    expect(rows[3]).toMatch(/^3,Quad,Battery,battery,Cell Co,B-6S,,buy,priced,1,1,1,2,2,1,2,CNHL,,34\.99,34\.99,69\.98,/);
    expect(existsSync(join(dir, "parts/bom.json"))).toBe(false);

    writeFileSync(join(dir, "parts/bom.json"), JSON.stringify({ schema: "protoboard.bom-settings/v0", units: -1 }));
    const bad = cli(dir, "bom");
    expect(bad.status).not.toBe(0);
    expect(bad.stderr).toMatch(/parts\/bom\.json: units must be a whole number above 0/);
  });

  it("protoboard check reports a malformed parts/bom.json or parts/fx-rates.json before anyone opens the bill", async () => {
    const dir = project({ ...BASE, "parts/bom.json": JSON.stringify({ schema: "protoboard.bom-settings/v0", units: -1 }), "parts/fx-rates.json": "{" });
    const p = await loadProject(dir, { checks: false, extensions: false });
    expect(p.diagnostics.filter((d) => /^PB_(BOM|FX)_/.test(d.code)).map((d) => [d.code, d.severity, d.source?.file])).toEqual([
      ["PB_BOM_SETTINGS_INVALID", "error", "parts/bom.json"],
      ["PB_FX_RATES_INVALID", "error", "parts/fx-rates.json"],
    ]);
    const check = cli(dir, "check");
    expect(check.status).not.toBe(0);
    expect(check.stdout + check.stderr).toMatch(/PB_BOM_SETTINGS_INVALID[\s\S]*parts\/bom\.json: units must be a whole number above 0/);
    // valid files say nothing
    const ok = await loadProject(project({ ...BASE, "parts/bom.json": JSON.stringify({ schema: "protoboard.bom-settings/v0", units: 3 }), "parts/fx-rates.json": FX }), { checks: false, extensions: false });
    expect(ok.diagnostics.filter((d) => /^PB_(BOM|FX)_/.test(d.code))).toEqual([]);
  });

  it("lists a release's ordering list on request, priced from the offers held, and says when a release is missing", async () => {
    const header = "line,definition,item,manufacturer,mpn,action,process,qty_per_product,needed,spares,order,unit_price,currency,extended,supplier,offer_as_of,offer_url,offer_source,note";
    const dir = project({
      ...BASE,
      "release/0.1.0/manifest.json": JSON.stringify({ version: "0.1.0", date: "2026-10-04T00:00:00Z" }),
      "release/0.1.0/system/ordering-list.csv": [header, "1,battery,Battery,Cell Co,B-6S,buy,,1,1,0,1,30.00,USD,30.00,CNHL,2026-10-02,,,", "2,motor,Motor,Acme,M-1,buy,,4,4,0,4,,,,,,,,", "3,frame,Frame,,,fabricate,cut,1,1,0,1,,,,,,,,"].join("\n") + "\n",
    });
    // the design is the default source, whatever releases exist
    expect(JSON.parse(cli(dir, "bom", "--format", "json").stdout).source).toEqual({ kind: "design" });
    const r = cli(dir, "bom", "--release", "0.1.0", "--format", "json");
    expect(r.status).toBe(0);
    const t = JSON.parse(r.stdout);
    expect(t.source).toEqual({ kind: "release", version: "0.1.0", file: "release/0.1.0/system/ordering-list.csv" });
    const lines = t.groups.flatMap((g: { lines: { key: string; status: string; orderCost?: number; source?: { file: string; line: number } }[] }) => g.lines);
    // today's held offer, not the price the release wrote down
    expect(lines.find((x: { key: string }) => x.key === "battery")).toMatchObject({ status: "priced", orderCost: 69.98, source: { file: "release/0.1.0/system/ordering-list.csv", line: 2 } });
    expect(lines.find((x: { key: string }) => x.key === "motor")).toMatchObject({ status: "priced" });
    expect(lines.find((x: { key: string }) => x.key === "frame")).toMatchObject({ status: "make" });

    const missing = cli(dir, "bom", "--release", "9.9.9");
    expect(missing.status).not.toBe(0);
    expect(missing.stderr).toMatch(/no release 9\.9\.9 in release\/ \(releases: 0\.1\.0\)/);
  });
});
