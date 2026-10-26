/**
 * PB-825: the sourcing extension installs like any other.
 *   - its manifest loads in a fresh project, its six skills are discoverable
 *     through `protoboard skills` and `doctor`, and export to an agent host
 *     with their references and scripts;
 *   - every file a skill points at exists, every skill it names is installed,
 *     and no company-specific supplier, credential or policy leaked in;
 *   - the `sourcing` check reports malformed, forbidden and disqualified
 *     records through `protoboard check`, and the handoff layout
 *     (parts/local + parts/evidence) checks clean;
 *   - scripts: compare.ts ranks offers at the needed quantity; quote-check.ts
 *     grounds quotes deterministically against a text layer and a real PDF.
 * Parts, suppliers and datasheet text here are fictional fixtures (ACME).
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { initProject, loadProject, resolveSkills } from "@protoboardai/core";
import { chooseOffer, compareOffers, isFullReel, unitPriceAt, validateSourcing, type Offer, type SourcingRecord } from "../lib/sourcing.ts";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const PKG = join(HERE, "..");
const REPO = join(PKG, "../..");
const CLI = join(REPO, "packages/cli/bin/protoboard.mjs");
const TMP = join(HERE, ".tmp");
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

const SKILLS = ["part-search", "datasheet-extract", "supplier-compare", "lifecycle-alternates", "part-handoff", "sourcing-verify"];
const EXTENSIONS = ["@protoboardai/ext-hardware", "@protoboardai/ext-parts", "@protoboardai/ext-sourcing"];
const NOW = new Date("2026-10-02T00:00:00Z");

const pb = (dir: string, args: string[]) => {
  const r = spawnSync(process.execPath, [CLI, ...args, "--format", "json", "--cwd", dir], { encoding: "utf8" });
  return { status: r.status, json: JSON.parse(r.stdout || "null"), stderr: r.stderr };
};
const tsx = (cwd: string, script: string, args: string[], env: Record<string, string> = {}) =>
  spawnSync(process.execPath, ["--import", "tsx", script, ...args], { cwd, encoding: "utf8", env: { ...process.env, ...env } });
const write = (file: string, data: unknown) => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, typeof data === "string" ? data : JSON.stringify(data, null, 2) + "\n");
};
const frontmatter = (file: string) => {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(readFileSync(file, "utf8"));
  return Object.fromEntries((m?.[1] ?? "").split("\n").map((l) => [l.slice(0, l.indexOf(":")), l.slice(l.indexOf(":") + 1).trim()]));
};
const sha256 = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");

/** A sourcing record that passes every rule except the single source a named person accepted. */
const goodRecord = (): SourcingRecord => ({
  schema: "protoboard.sourcing/v0",
  part: "acme-ldo3300-33",
  manufacturer: "ACME",
  mpn: "LDO3300-33SOT-TR",
  need: { quantity: 20 },
  offers: [
    {
      supplier: "Distributor A",
      mpn: "LDO3300-33SOT-TR",
      url: "https://distributor-a.example/product/LDO3300-33SOT-TR",
      as_of: "2026-09-26",
      via: "api",
      authorized: true,
      stock: 4210,
      moq: 1,
      price_breaks: [
        { quantity: 1, unit_price: 0.62, currency: "USD" },
        { quantity: 10, unit_price: 0.48, currency: "USD" },
        { quantity: 100, unit_price: 0.35, currency: "USD" },
      ],
    },
    { supplier: "Distributor B", mpn: "LDO3300-33SOT-TR", url: "https://distributor-b.example/p/LDO3300-33SOT-TR", as_of: "2026-09-26", via: "web", authorized: true, stock: 0, lead_time_weeks: 16, price_breaks: [{ quantity: 1, unit_price: 0.66, currency: "USD" }] },
  ],
  lifecycle: { status: "active", source: "https://acme.example/products/ldo3300", as_of: "2026-09-26" },
  risks: [{ code: "single-source", reason: "B is out of stock; A covers 20 units 200x", accepted_by: "J. Engineer", date: "2026-09-26" }],
  capability: [
    { source: "Distributor A API", available: true, used: true },
    { source: "Aggregator API", available: false, used: false, note: "no key" },
  ],
});

/** A fresh project with the local part, its evidence, and three faulty sourcing records. */
function project(): string {
  const dir = join(TMP, "proj");
  rmSync(dir, { recursive: true, force: true });
  initProject(dir, { name: "Sourcing Rig" });
  const cfg = join(dir, "protoboard.config.ts");
  writeFileSync(
    cfg,
    readFileSync(cfg, "utf8")
      .replace('sources: ["src/**/*.uhd.ts"],', 'sources: ["src/**/*.uhd.ts", "parts/local/**/*.uhd.ts"],')
      .replace('extensions: ["@protoboardai/ext-hardware"],', `extensions: ${JSON.stringify(EXTENSIONS)},`),
  );
  write(
    join(dir, "src/sourcing-rig.uhd.ts"),
    `import type { ModuleDef } from "@deltarobotics/uhd";

export const SOURCING_RIG: ModuleDef = {
  id: "sourcing-rig",
  name: "Sourcing Rig",
  kind: "module",
  interfaces: [],
  children: [{ id: "ldo", moduleDefId: "acme-ldo3300-33" }],
  links: [],
};
`,
  );
  write(
    join(dir, "parts/local/acme-ldo3300-33.uhd.ts"),
    `import type { ModuleDef } from "@deltarobotics/uhd";

/** ACME LDO3300-33SOT-TR: a fictional regulator, the handoff fixture. Sources: ../evidence/acme-ldo3300-33/sources.json */
export const ACME_LDO3300_33: ModuleDef = {
  id: "acme-ldo3300-33",
  name: "ACME LDO3300 3.3 V regulator",
  kind: "module",
  manufacturer: "ACME",
  part_number: "LDO3300-33SOT-TR",
  interfaces: [],
};
`,
  );
  const ev = join(dir, "parts/evidence");
  write(join(ev, "acme-ldo3300-33/sources.json"), [{ id: "src_datasheet", title: "ACME LDO3300 datasheet, Rev. 3", url: "https://acme.example/ldo3300.pdf", type: "datasheet", authority: "manufacturer", fetched_at: "2026-09-26T10:00:00Z", sha256: null, supports: ["identity"] }]);
  write(join(ev, "acme-ldo3300-33/verification.json"), { partId: "acme-ldo3300-33", recorded_at: "2026-09-26T12:00:00Z", audit: { method: "fixture", checked: 12, confirmed: 12, wrong: 0, unsupported: 0 }, repairs: null, assumptions: [], data_gaps: [], vocabulary_gaps: [] });
  write(join(ev, "acme-ldo3300-33/sourcing.json"), goodRecord());
  write(join(ev, "acme-widget/sourcing.json"), {
    schema: "protoboard.sourcing/v0",
    part: "acme-widget",
    manufacturer: "ACME",
    mpn: "W-1",
    need: { quantity: 50 },
    order_id: "12345",
    offers: [
      { supplier: "Distributor A", mpn: "W-1", url: "https://distributor-a.example/w-1", via: "web", stock: 30 },
      { supplier: "Distributor A", mpn: "W-1", url: "https://api.distributor-a.example/search?keyword=W-1&apiKey=abc", as_of: "2026-09-01", via: "api", stock: 40 },
    ],
    lifecycle: { status: "nrnd", source: "https://acme.example/w-1", as_of: "2026-09-01" },
  });
  write(join(ev, "misplaced/sourcing.json"), { ...goodRecord() });
  write(join(ev, "broken/sourcing.json"), "{ not json");
  return dir;
}

describe("installation and discovery", async () => {
  const dir = project();
  const p = await loadProject(dir);
  const skills = resolveSkills(p, p.extensions).filter((s) => s.extension === "@protoboardai/ext-sourcing");

  it("the manifest loads and passes the framework's validation", () => {
    expect(p.extensions.map((e) => e.manifest.id)).toEqual(EXTENSIONS);
    expect(p.diagnostics.filter((d) => d.code.startsWith("PB_EXTENSION"))).toEqual([]);
  });

  it("every skill resolves to a SKILL.md with host frontmatter (name = id, a description)", () => {
    expect(skills.map((s) => s.id)).toEqual(SKILLS);
    for (const s of skills) {
      expect(s.file, s.id).toBeDefined();
      const fm = frontmatter(s.file!);
      expect(fm.name, s.id).toBe(s.id);
      expect(fm.description?.length, s.id).toBeGreaterThan(80);
      if (s.verifiedBy) expect(SKILLS).toContain(s.verifiedBy);
    }
  });

  it("protoboard skills and doctor list them (headless discovery), and doctor probes pdftotext", () => {
    const { status, json } = pb(dir, ["skills"]);
    expect(status).toBe(0);
    const ours = json.filter((s: { extension: string }) => s.extension === "@protoboardai/ext-sourcing");
    expect(ours.map((s: { id: string }) => s.id)).toEqual(SKILLS);
    for (const s of ours) expect(existsSync(s.file)).toBe(true);
    const doctor = pb(dir, ["doctor"]).json;
    expect(doctor.skills.filter((s: { extension: string; found: boolean }) => s.extension === "@protoboardai/ext-sourcing" && s.found)).toHaveLength(SKILLS.length);
    expect(doctor.tools.find((t: { id: string }) => t.id === "pdftotext")).toMatchObject({ extension: "@protoboardai/ext-sourcing" });
  });

  it("skills export --host claude-code copies each skill with its references and scripts", () => {
    const { status, json } = pb(dir, ["skills", "export", "--host", "claude-code"]);
    expect(status).toBe(0);
    expect(json.skipped).toEqual([]);
    const root = join(dir, ".claude/skills");
    for (const id of SKILLS) expect(frontmatter(join(root, id, "SKILL.md")).name).toBe(id);
    expect(existsSync(join(root, "part-search/references/sources.md"))).toBe(true);
    expect(existsSync(join(root, "datasheet-extract/scripts/quote-check.ts"))).toBe(true);
    expect(existsSync(join(root, "supplier-compare/scripts/compare.ts"))).toBe(true);
    expect(readFileSync(join(root, "part-handoff/.protoboard-source"), "utf8")).toMatch(/^@protoboardai\/ext-sourcing/);
  });

  it("every file a skill points at exists, and every skill it names in bold is installed", () => {
    const installed = new Set(resolveSkills(p, p.extensions).map((s) => s.id));
    for (const s of skills) {
      const text = readFileSync(s.file!, "utf8");
      const skillDir = dirname(s.file!);
      for (const [, rel] of text.matchAll(/\((references\/[\w./-]+\.md)\)/g)) expect(existsSync(join(skillDir, rel)), `${s.id}: ${rel}`).toBe(true);
      for (const [, rel] of text.matchAll(/node_modules\/@protoboardai\/ext-sourcing\/([\w./-]+\.ts)/g)) expect(existsSync(join(PKG, rel)), `${s.id}: ${rel}`).toBe(true);
      for (const [, id] of text.matchAll(/\*\*([a-z][a-z0-9]*(?:-[a-z0-9]+)+)\*\*/g)) expect(installed.has(id), `${s.id} names **${id}**`).toBe(true);
    }
  });

  it("supplier-compare documents exactly the codes the sourcing check can emit", () => {
    const codes = (text: string, re: RegExp) => [...new Set([...text.matchAll(re)].map((m) => m[1]))].sort();
    const emitted = codes(readFileSync(join(PKG, "lib/sourcing.ts"), "utf8") + readFileSync(join(PKG, "checks/sourcing.ts"), "utf8"), /"(SRC_[A-Z_]+)"/g);
    expect(codes(readFileSync(join(PKG, "skills/supplier-compare/SKILL.md"), "utf8"), /`(SRC_[A-Z_]+)`/g)).toEqual(emitted);
  });

  it("no company-specific suppliers, credentials or policies in the skills", () => {
    const files = readdirSync(join(PKG, "skills"), { recursive: true, withFileTypes: true }).filter((f) => f.isFile());
    const banned = /Delta Robotics|ProtoPart|tag=protoboard|CANOPY_API_KEY|TYPESAFE_API_KEY|DIGIKEY_CLIENT|search_library/;
    for (const f of files) {
      const text = readFileSync(join(f.parentPath, f.name), "utf8");
      expect(banned.exec(text)?.[0], join(f.parentPath, f.name)).toBeUndefined();
    }
  });
});

describe("sourcing records", () => {
  it("a complete record passes, with the accepted risk and partial coverage reported as info", () => {
    const issues = validateSourcing(goodRecord(), { now: NOW, knownPart: () => true });
    expect(issues.filter((i) => i.severity !== "info")).toEqual([]);
    expect(issues.map((i) => i.code).sort()).toEqual(["SRC_RISK_ACCEPTED", "SRC_UNVERIFIED"]);
  });

  it("orders, credentials, undated offers and unaccepted disqualifiers are reported", () => {
    const r = goodRecord();
    (r as unknown as Record<string, unknown>).cart = { id: "x" };
    r.offers[0].url += "?api_key=secret";
    delete (r.offers[1] as Partial<(typeof r.offers)[number]>).as_of;
    r.offers[1].stock = 5;
    r.offers.push({ supplier: "Broker C", mpn: "LDO3300-33SOT", url: "https://broker-c.example/x", as_of: "2026-09-26", via: "web", stock: 100 });
    r.risks = [];
    r.lifecycle = { status: "eol", source: "https://acme.example/pcn-17", as_of: "2026-09-20" };
    const codes = validateSourcing(r, { now: NOW, knownPart: () => false }).map((i) => `${i.severity}:${i.code}`);
    expect(codes).toEqual(
      expect.arrayContaining(["error:SRC_FORBIDDEN_FIELD", "error:SRC_CREDENTIAL_IN_URL", "error:SRC_OFFER_INCOMPLETE", "warning:SRC_UNKNOWN_PART", "warning:SRC_OFFER_MPN_MISMATCH", "warning:SRC_LIFECYCLE"]),
    );
    // two suppliers with stock: not single-source; best stock 4210 >= 10 x 20: not low stock
    expect(codes).not.toContain("warning:SRC_SINGLE_SOURCE");
    expect(codes).not.toContain("warning:SRC_LOW_STOCK");
  });

  it("low stock wants a usable alternate; a near-miss does not count, a family variant clears it", () => {
    const r = goodRecord();
    r.need = { quantity: 500 };
    expect(validateSourcing(r, { now: NOW }).map((i) => i.code)).toContain("SRC_LOW_STOCK");
    r.alternates = [{ mpn: "XYZ1117-3.3", manufacturer: "XYZ", relation: "near-miss", differences: "dropout 1.1 V", lost_because: "fails the 300 mV dropout requirement" }];
    expect(validateSourcing(r, { now: NOW }).map((i) => i.code)).toContain("SRC_LOW_STOCK");
    r.alternates.push({ mpn: "LDO3300-33DFN-TR", manufacturer: "ACME", relation: "family-variant", differences: "DFN-6 package, same die" });
    expect(validateSourcing(r, { now: NOW }).map((i) => i.code)).not.toContain("SRC_LOW_STOCK");
    delete r.alternates[0].lost_because;
    expect(validateSourcing(r, { now: NOW }).find((i) => i.code === "SRC_RECORD_INVALID")?.message).toMatch(/near-miss with no lost_because/);
  });

  it("a broker or marketplace listing is not a second independent source", () => {
    const r = goodRecord();
    r.risks = [];
    r.offers.push({ supplier: "Marketplace M", mpn: "LDO3300-33SOT-TR", url: "https://marketplace-m.example/i/991", as_of: "2026-09-26", via: "web", authorized: false, stock: 800 });
    const single = validateSourcing(r, { now: NOW }).find((i) => i.code === "SRC_SINGLE_SOURCE");
    expect(single?.message).toMatch(/one supplier only \(distributor a; marketplace m not authorized, so not counted\)/);
    r.offers[0].authorized = false;
    expect(validateSourcing(r, { now: NOW }).find((i) => i.code === "SRC_SINGLE_SOURCE")?.message).toMatch(/listed only by sellers that are not authorized/);
    r.offers[0].authorized = null; // not known: counts, so A plus a second distributor with stock is two sources
    r.offers[1].stock = 50;
    expect(validateSourcing(r, { now: NOW }).map((i) => i.code)).not.toContain("SRC_SINGLE_SOURCE");
  });

  it("a key-bearing URL anywhere in the record is reported with its path", () => {
    const r = goodRecord();
    r.lifecycle!.source = "https://m.example/x1?apiKey=SECRET";
    r.alternates = [{ mpn: "LDO3300-33DFN-TR", manufacturer: "ACME", relation: "family-variant", differences: "DFN-6", evidence: "https://d.example/s?q=LDO3300&token=t" }];
    r.offers[1].note = "read from https://api.d.example/v1?keyword=LDO3300&access_token=abc, page 1";
    r.offers[0].url = "https://distributor-a.example/product/LDO3300-33SOT-TR?q=LDO3300&utm_source=x";
    const keyed = validateSourcing(r, { now: NOW }).filter((i) => i.code === "SRC_CREDENTIAL_IN_URL");
    expect(keyed.map((i) => i.message.split(" ")[0])).toEqual(["offers[1].note", "lifecycle.source", "alternates[0].evidence"]);
    expect(keyed.every((i) => i.severity === "error")).toBe(true);
  });

  it("old observations are stale (info), and a record that is not a record is invalid", () => {
    expect(validateSourcing(goodRecord(), { now: new Date("2027-03-01") }).map((i) => i.code)).toContain("SRC_STALE");
    expect(validateSourcing({ part: "x" }).map((i) => i.code)).toEqual(["SRC_RECORD_INVALID"]);
  });

  it("offers are compared at the needed quantity, MOQ and price breaks applied, cheapest first", () => {
    const r = goodRecord();
    expect(unitPriceAt(r.offers[0], 20)).toEqual({ unit_price: 0.48, currency: "USD", buy: 20 });
    expect(unitPriceAt({ ...r.offers[0], moq: 100 }, 20)).toEqual({ unit_price: 0.35, currency: "USD", buy: 100 });
    const rows = compareOffers(r);
    expect(rows.map((o) => [o.supplier, o.extended, o.covers])).toEqual([
      ["Distributor A", 9.6, true],
      ["Distributor B", 13.2, false],
    ]);
  });

  it("an offer for a sibling ordering code is shown but ranked after every matching offer", () => {
    const r = goodRecord();
    r.offers.push({ supplier: "Distributor C", mpn: "LDO3300-33SOT", url: "https://distributor-c.example/LDO3300-33SOT", as_of: "2026-09-26", via: "web", stock: 9000, price_breaks: [{ quantity: 1, unit_price: 0.1, currency: "USD" }] });
    expect(compareOffers(r).map((o) => [o.supplier, o.mpn_matches])).toEqual([
      ["Distributor A", true],
      ["Distributor B", true],
      ["Distributor C", false],
    ]);
  });
});

describe("offer policy: reels and the quote currency (PB-872)", () => {
  const o = (x: Partial<Offer> & { supplier: string }): Offer => ({ mpn: "X-1", url: `https://${x.supplier.toLowerCase().replace(/\W+/g, "")}.example/x`, as_of: "2026-10-03", via: "web", ...x });
  const rec = (offers: Offer[]): SourcingRecord => ({ schema: "protoboard.sourcing/v0", part: "x", manufacturer: "Acme", mpn: "X-1", offers });
  const usd = (q: number, p: number) => [{ quantity: q, unit_price: p, currency: "USD" }];

  it("tells a full reel from cut tape and from LCSC's small-quantity tape and reel", () => {
    expect(isFullReel({ packaging: "REEL (unit pack 1300)", moq: 1300 })).toBe(true);
    expect(isFullReel({ packaging: "Tape & Reel (TR)", moq: 3000 })).toBe(true);
    expect(isFullReel({ packaging: "Tape & Reel (TR)", moq: 5 })).toBe(false);
    expect(isFullReel({ packaging: "Cut Tape (CT)", moq: 1 })).toBe(false);
    expect(isFullReel({ packaging: "Digi-Reel®", moq: 1 })).toBe(false);
    expect(isFullReel({ moq: 2000 })).toBe(false);
  });

  it("ranks cut tape before a reel, and the quote currency before a cheaper other currency (EUR no longer sorts before USD)", () => {
    const rows = compareOffers(rec([o({ supplier: "Reel", packaging: "REEL (unit pack 1300)", moq: 1300, price_breaks: usd(1300, 1.48) }), o({ supplier: "Euro", price_breaks: [{ quantity: 1, unit_price: 1, currency: "EUR" }] }), o({ supplier: "Cut", packaging: "Cut Tape (CT)", price_breaks: usd(1, 2.9) })]), 1);
    expect(rows.map((r) => [r.supplier, r.fit, r.in_currency])).toEqual([["Cut", "fits", true], ["Euro", "fits", false], ["Reel", "reel-over", true]]);
    const both = [o({ supplier: "Euro", price_breaks: [{ quantity: 1, unit_price: 1, currency: "EUR" }] }), o({ supplier: "Cut", price_breaks: usd(1, 2.9) })];
    expect(compareOffers(rec(both), 1, { currency: "EUR" })[0].supplier).toBe("Euro");
  });

  it("quotes a reel only when the quantity fills it, flagged; never for fewer", () => {
    const reel = o({ supplier: "Reel", packaging: "REEL (unit pack 1300)", moq: 1300, price_breaks: usd(1300, 1.48) });
    const one = chooseOffer(rec([reel]), 1);
    expect(one.quoted).toBeUndefined();
    expect(one.flag).toBe("no offer fits 1: Reel sells only a full reel of 1300 (1924.00 USD); not quoted");
    expect(one.alternatives.map((r) => r.supplier)).toEqual(["Reel"]);
    const full = chooseOffer(rec([reel]), 2600);
    expect([full.quoted?.supplier, full.quoted?.fit, full.flag]).toEqual(["Reel", "reel", "full reel: 2600 from Reel"]);
  });
});

describe("the sourcing check and compare script in a project", () => {
  const dir = project();

  it("protoboard check runs the sourcing check: the handoff part is clean, faulty records are reported where they live", () => {
    const { json } = pb(dir, ["check", "--severity", "info"]);
    expect(json.checks.find((c: { validator: string }) => c.validator === "ext:@protoboardai/ext-sourcing/sourcing")).toMatchObject({ status: "ran" });
    const diags = json.diagnostics.filter((d: { validator: string }) => d.validator.startsWith("ext:"));
    const by = (id: string) => diags.filter((d: { entity: { id: string } }) => d.entity.id === id).map((d: { severity: string; code: string }) => `${d.severity}:${d.code}`);
    // the local part: evidence and verification present (ext-hardware), sourcing record acceptable
    expect(by("acme-ldo3300-33").filter((c: string) => !c.startsWith("info:"))).toEqual(["warning:SRC_PART_MISMATCH"]);
    expect(by("acme-widget")).toEqual(
      expect.arrayContaining(["error:SRC_FORBIDDEN_FIELD", "error:SRC_OFFER_INCOMPLETE", "error:SRC_CREDENTIAL_IN_URL", "warning:SRC_UNKNOWN_PART", "warning:SRC_LIFECYCLE", "warning:SRC_SINGLE_SOURCE", "warning:SRC_LOW_STOCK"]),
    );
    expect(by("broken")).toEqual(["error:SRC_RECORD_INVALID"]);
    const mismatch = diags.find((d: { code: string }) => d.code === "SRC_PART_MISMATCH");
    expect(mismatch.source.file).toBe("parts/evidence/misplaced/sourcing.json");
    expect(diags.find((d: { code: string }) => d.code === "SRC_CREDENTIAL_IN_URL").source.file).toBe("parts/evidence/acme-widget/sourcing.json");
  });

  it("compare.ts ranks the offers for one part at its needed quantity", () => {
    const r = tsx(dir, join(PKG, "skills/supplier-compare/scripts/compare.ts"), ["acme-ldo3300-33", "--json"]);
    expect(r.status, r.stderr).toBe(0);
    const [rec] = JSON.parse(r.stdout);
    expect(rec).toMatchObject({ part: "acme-ldo3300-33", quantity: 20, lifecycle: "active" });
    expect(rec.offers[0]).toMatchObject({ supplier: "Distributor A", unit_price: 0.48, extended: 9.6, covers: true });
    const text = tsx(dir, join(PKG, "skills/supplier-compare/scripts/compare.ts"), ["--qty", "100"]).stdout;
    expect(text).toMatch(/acme-ldo3300-33 {2}ACME LDO3300-33SOT-TR {2}×100/);
    expect(text).toMatch(/USD 0\.35 × 100 = 35/);
  });
});

// ---------------------------------------------------------------------------
// quote-check.ts against a fictional two-page datasheet
// ---------------------------------------------------------------------------

const PAGES = [
  ["ACME LDO3300 300 mA low-dropout regulator", "Ordering information", "LDO3300-33SOT-TR    3.3 V    SOT-23-5    tape and reel"],
  ["Absolute maximum ratings", "Input voltage    VIN    -0.3 to 6.5    V", "Operating junction temperature    TJ    −40 to 125    °C", "Dropout voltage   VDO   IOUT = 300 mA   250   mV", "Package body 2.9x1.6 mm", "Rated life    10,000    h"],
];

/** A minimal PDF (Helvetica text, one content stream per page) so the --pdf path runs the real pdftotext. WinAnsi has no U+2212, so minus signs are hyphens. */
function minimalPdf(pages: string[][]): Buffer {
  const esc = (s: string) => s.replace(/\u2212/g, "-").replace(/[\\()]/g, "\\$&");
  const objs: string[] = [];
  const kids = pages.map((_, i) => `${3 + i * 2} 0 R`).join(" ");
  objs.push("<< /Type /Catalog /Pages 2 0 R >>", `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
  const font = 3 + pages.length * 2;
  pages.forEach((lines, i) => {
    const stream = `BT /F1 11 Tf 72 720 Td ${lines.map((l) => `(${esc(l)}) Tj 0 -18 Td`).join(" ")} ET`;
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${4 + i * 2} 0 R /Resources << /Font << /F1 ${font} 0 R >> >> >>`);
    objs.push(`<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`);
  });
  objs.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  let out = "%PDF-1.4\n";
  const offsets = objs.map((o, i) => {
    const at = Buffer.byteLength(out, "latin1");
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
    return at;
  });
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

describe("quote-check.ts", () => {
  const dir = join(TMP, "datasheet");
  const script = join(PKG, "skills/datasheet-extract/scripts/quote-check.ts");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, "figures"), { recursive: true });
  write(join(dir, "parsed.txt"), PAGES.map((p) => p.join("\n") + "\n\f").join("")); // pdftotext ends every page with a form feed
  const crop = Buffer.from("fixture crop bytes");
  write(join(dir, "figures/outline.png"), crop.toString());
  const fig = (reading: string, sha = sha256(crop)) => [{ kind: "figure", page: 2, image: "figures/outline.png", image_sha256: sha, reading }];
  const stated = (path: string, value: unknown, quote: string, page: number, extra: object = {}) => ({ path, value, evidence: [{ quote, page }], status: "stated", ...extra });
  const fields = [
    stated("part.package", "SOT-23-5", "LDO3300-33SOT-TR 3.3 V SOT-23-5 tape and reel", 1),
    stated("ratings.vin", 6.5, "Input voltage VIN -0.3 to 6.5 V", 2, { min: -0.3, max: 6.5 }),
    stated("ratings.tj", null, "Operating junction temperature TJ -40 to 125 °C", 2, { min: -40, max: 125 }),
    stated("ratings.tj_wrong_page", null, "Operating junction temperature TJ -40 to 125 °C", 1, { min: -40, max: 125 }),
    stated("electrical.vdo", 250, "Dropout voltage VDO IOUT = 300 mA 250 mV", 2),
    stated("electrical.vdo_typo", 205, "Dropout voltage VDO IOUT = 300 mA 250 mV", 2),
    stated("electrical.vin_case", 6.5, "input voltage vin -0.3 to 6.5 v", 2),
    stated("electrical.iq", 25, "Quiescent current IQ 25 uA", 2),
    stated("mechanical.length", 2.9, "Package body 2.9x1.6 mm", 2),
    stated("mechanical.width", 1.6, "Package body 2.9x1.6 mm", 2),
    { path: "thermal.rth_ja", value: null, status: "absent" },
    { path: "electrical.p_drop", value: 0.075, status: "derived", derived_from: ["electrical.vdo"], working: "0.250 V × 0.300 A" },
    { path: "mechanical.pitch", value: 0.95, evidence: fig("e 0.95 BSC"), readings: [{ reader: "agent-a", value: 0.95 }], status: "stated" },
    { path: "mechanical.height", value: 1.1, evidence: fig("A 1.10 MAX"), readings: [{ reader: "agent-a", value: 1.1 }, { reader: "agent-b", value: 1.1 }], status: "stated" },
    { path: "mechanical.bad_crop", value: 1.1, evidence: fig("A 1.10 MAX", "0".repeat(64)), readings: [{ reader: "agent-a", value: 1.1 }, { reader: "agent-b", value: 1.1 }], status: "stated" },
    { path: "mechanical.same_reader", value: 1.1, evidence: fig("A 1.10 MAX"), readings: [{ reader: "agent-a", value: 1.1 }, { reader: "agent-a", value: 1.1 }], status: "stated" },
  ];
  const extraction = (fs: object[], sha = "0".repeat(64)) => ({ schema: "protoboard.extraction/v0", part: "acme-ldo3300-33", ordering_code: "LDO3300-33SOT-TR", source: { id: "src_datasheet", sha256: sha }, extractor: { name: "test", model: null, created_at: "2026-09-26T00:00:00Z" }, fields: fs });

  it("assigns each verdict deterministically and exits 5 when anything is ungrounded or invalid", () => {
    write(join(dir, "extraction.json"), extraction(fields));
    const r = tsx(dir, script, ["--extraction", join(dir, "extraction.json"), "--text", join(dir, "parsed.txt"), "--json", "--out", join(dir, "quote-check.json")]);
    expect(r.status, r.stderr).toBe(5);
    const report = JSON.parse(r.stdout);
    expect(JSON.parse(readFileSync(join(dir, "quote-check.json"), "utf8"))).toEqual(report);
    const v = Object.fromEntries(report.fields.map((f: { path: string; verdict: string }) => [f.path, f.verdict]));
    expect(v).toEqual({
      "part.package": "grounded",
      "ratings.vin": "grounded",
      "ratings.tj": "grounded", // the document prints U+2212 and the degree sign; normalisation makes them one
      "ratings.tj_wrong_page": "weak",
      "electrical.vdo": "grounded",
      "electrical.vdo_typo": "weak",
      "electrical.vin_case": "weak",
      "electrical.iq": "ungrounded",
      "mechanical.length": "grounded",
      "mechanical.width": "grounded",
      "thermal.rth_ja": "absent",
      "electrical.p_drop": "derived",
      "mechanical.pitch": "visual",
      "mechanical.height": "visual",
      "mechanical.bad_crop": "invalid",
      "mechanical.same_reader": "invalid",
    });
    const field = (p: string) => report.fields.find((f: { path: string }) => f.path === p);
    expect(field("ratings.tj_wrong_page").notes[0]).toMatch(/on page 2, not page 1/);
    expect(field("electrical.vdo_typo").notes[0]).toMatch(/value 205 is not in the quote/);
    expect(field("mechanical.pitch")).toMatchObject({ readings_agree: null });
    expect(field("mechanical.height")).toMatchObject({ readings_agree: true });
    expect(report.summary).toMatchObject({ grounded: 6, weak: 3, ungrounded: 1, absent: 1, derived: 1, visual: 2, invalid: 2 });
    expect(report.pages).toBe(2);
  });

  it("a figure cannot lift an ungrounded quote, and a crop that is not here is at best weak", () => {
    const missing = [{ kind: "figure", page: 2, image: "figures/nope.png", image_sha256: "aa", reading: "b" }];
    write(
      join(dir, "mixed.json"),
      extraction([
        { path: "x.fabricated", value: 5, evidence: [{ quote: "nonexistent quote 5", page: 2 }, ...missing], readings: [{ reader: "agent-a", value: 5 }], status: "stated" },
        { path: "x.no_crop", value: 1.1, evidence: missing, readings: [{ reader: "agent-a", value: 1.1 }, { reader: "agent-b", value: 1.1 }], status: "stated" },
        { path: "x.named_then_drawn", value: 1.1, evidence: [{ quote: "Package body 2.9x1.6 mm", page: 2 }, ...fig("A 1.10 MAX")], readings: [{ reader: "agent-a", value: 1.1 }, { reader: "agent-b", value: 1.1 }], status: "stated" },
        { path: "x.bad_page", value: 1.1, evidence: [{ ...fig("A 1.10 MAX")[0], page: 9 }], readings: [{ reader: "agent-a", value: 1.1 }, { reader: "agent-b", value: 1.1 }], status: "stated" },
      ]),
    );
    const r = tsx(dir, script, ["--extraction", join(dir, "mixed.json"), "--text", join(dir, "parsed.txt"), "--json"]);
    expect(r.status, r.stderr).toBe(5);
    const report = JSON.parse(r.stdout);
    expect(Object.fromEntries(report.fields.map((f: { path: string; verdict: string }) => [f.path, f.verdict]))).toEqual({
      "x.fabricated": "ungrounded",
      "x.no_crop": "weak",
      "x.named_then_drawn": "visual", // the quote names the part, the figure gives the number
      "x.bad_page": "invalid",
    });
    expect(report.fields[1].notes.join(" ")).toMatch(/nope\.png is not on this machine/);
  });

  it("a thousands-grouped figure is one number", () => {
    write(join(dir, "grouped.json"), extraction([stated("life.hours", 10000, "Rated life 10,000 h", 2), stated("life.text", "10,000", "Rated life 10,000 h", 2)]));
    const r = tsx(dir, script, ["--extraction", join(dir, "grouped.json"), "--text", join(dir, "parsed.txt"), "--json"]);
    expect(r.status, r.stderr).toBe(0);
    expect(JSON.parse(r.stdout).fields.map((f: { verdict: string }) => f.verdict)).toEqual(["grounded", "grounded"]);
  });

  it("a number glued to a word is a part number, not a value", () => {
    write(join(dir, "glued.json"), extraction([stated("x.n", 3300, "LDO3300-33SOT-TR 3.3 V SOT-23-5 tape and reel", 1)]));
    const r = tsx(dir, script, ["--extraction", join(dir, "glued.json"), "--text", join(dir, "parsed.txt"), "--json"]);
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout).fields[0]).toMatchObject({ verdict: "weak", value_in_quote: false });
  });

  const hasPdftotext = spawnSync("pdftotext", ["-v"]).status === 0;
  if (!hasPdftotext) console.warn("quote-check: pdftotext is not installed; the real-PDF test is skipped");
  it.skipIf(!hasPdftotext)("--pdf parses the real PDF once with pdftotext, caches it, and refuses a different document", () => {
    const pdfDir = join(dir, "pdf");
    const pdf = minimalPdf(PAGES);
    write(join(pdfDir, "source.pdf"), "");
    writeFileSync(join(pdfDir, "source.pdf"), pdf);
    const clean = fields.filter((f) => ["part.package", "ratings.vin", "ratings.tj", "electrical.vdo", "mechanical.length", "thermal.rth_ja"].includes(f.path));
    write(join(pdfDir, "extraction.json"), extraction(clean, sha256(pdf)));
    const r = tsx(pdfDir, script, ["--extraction", join(pdfDir, "extraction.json"), "--pdf", join(pdfDir, "source.pdf"), "--json"]);
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(JSON.parse(r.stdout)).toMatchObject({ pages: 2, summary: { grounded: 5, absent: 1, weak: 0, ungrounded: 0 } });
    expect(existsSync(join(pdfDir, `parsed-${sha256(pdf).slice(0, 12)}.txt`))).toBe(true);
    write(join(pdfDir, "other.json"), extraction(clean, "f".repeat(64)));
    const other = tsx(pdfDir, script, ["--extraction", join(pdfDir, "other.json"), "--pdf", join(pdfDir, "source.pdf")]);
    expect(other.status).toBe(1);
    expect(other.stderr).toMatch(/the extraction was made from f{64}/);
  });

  it("without pdftotext it exits 3 with a payload to relay", () => {
    const pdfDir = join(dir, "no-pdftotext");
    const pdf = minimalPdf(PAGES);
    mkdirSync(pdfDir, { recursive: true });
    writeFileSync(join(pdfDir, "source.pdf"), pdf);
    write(join(pdfDir, "extraction.json"), extraction([], sha256(pdf)));
    const r = tsx(pdfDir, script, ["--extraction", join(pdfDir, "extraction.json"), "--pdf", join(pdfDir, "source.pdf")], { PATH: join(pdfDir, "empty-path") });
    expect(r.status, r.stderr).toBe(3);
    expect(JSON.parse(r.stdout)).toMatchObject({ ok: false, error: "not-configured", missing: ["pdftotext"] });
  });
});
