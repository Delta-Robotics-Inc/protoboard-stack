/**
 * `protoboard release` and the Manufacturing Package (PB-839, PB-840), on a
 * small fixture: a watch whose sensor pod (a custom board and two screws) is
 * a unit built twice, in a custom case. The board and case are designed by
 * core's fake providers (minimal, valid files; not real designs).
 *
 *   - units: folding into the nearest unit, quantities, invalid entries;
 *   - BOM: unit breakdown, provider bom.csv merged by instance, ordering
 *     quantities with spares, packs, offers and included parts;
 *   - preconditions: check errors, edited or stale outputs, unexported
 *     modules and uncommitted changes each refuse the release;
 *   - the package: layout, files from standard outputs, manifest, and two
 *     releases with identical digests (needs Chrome; skipped without it).
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { findOperation, loadProject, parseCsv, probeTools, runCapabilityOperation, runOperation, sha256, type Project } from "@protoboardai/core";
import { bomLines } from "@protoboardai/core/bom";
import { projectBom } from "../../cli/src/bom.ts";
import { orderingCsv, orderingList, orderTotals, unitBom, type OrderLine } from "../lib/bom.ts";
import { cutList } from "../lib/cutlist.ts";
import { readOffersFile, sourcingFor } from "../lib/offers.ts";
import { blocksHtml } from "../lib/html.ts";
import { freshness, preconditions } from "../lib/preconditions.ts";
import { normalisePdf } from "../lib/render.ts";
import { buildRelease, listTree } from "../lib/release.ts";
import { resolveUnits } from "../lib/units.ts";
import { briefRequirements as requirements } from "@protoboardai/core";
import type { ProductStatement } from "@protoboardai/core";
import { productBlocks, productDiagnostics } from "../lib/product.ts";
import { idRanges } from "../lib/sections/workorder.ts";
import { docId, type DocSet } from "../lib/documents.ts";
import type { Unit } from "../lib/types.ts";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const PROVIDERS = join(HERE, "../../core/test/fixtures/providers");
const CLI = join(HERE, "../../cli/bin/protoboard.mjs");
const TMP = join(HERE, ".tmp");
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

const PARTS = `const power = (id: string, role: string, pin: number) => ({ id, name: id.toUpperCase(), domain: "electrical", exposed: true, pin, protocols: [{ type: "power", roles: [role] }] });
export const MCU = { id: "fixture-mcu", name: "Fixture MCU", manufacturer: "Acme", part_number: "MCU-1", interfaces: [power("vdd", "sink", 1)] };
export const LDO = { id: "fixture-ldo", name: "Fixture LDO", manufacturer: "Acme", part_number: "LDO-33", interfaces: [power("vin", "sink", 1), power("vout", "source", 2)] };
export const USB = { id: "fixture-usb-c", name: "Fixture USB-C receptacle", interfaces: [power("vbus", "source", 1), { id: "usb", name: "USB", domain: "electrical", exposed: true, protocols: [{ type: "usb", roles: ["device"] }] }] };
export const SCREW = { id: "fixture-screw-m2x4", name: "M2 x 4 screw", manufacturer: "Generic", part_number: "M2X4", categories: ["hardware"], tags: ["fastener"], interfaces: [],
  traits: [{ type: "performance", params: { kind: "packaging", pack_quantity: 100 } }] };
export const STRAP = { id: "fixture-strap", name: "Wrist strap", manufacturer: "Acme", part_number: "STRAP-20", interfaces: [] };
export const BUCKLE = { id: "fixture-buckle", name: "Strap buckle", interfaces: [], traits: [{ type: "usage_note", params: { note: "Ships with the strap.", included_with: "fixture-strap" } }] };
`;
const BOARD = `export const MAINBOARD = {
  id: "watch-mainboard",
  name: "Watch mainboard",
  interfaces: [{ id: "mount", name: "Mount", domain: "mechanical", exposed: true, protocols: [{ type: "mechanical", roles: ["mount"] }] }],
  children: [
    { id: "u1", moduleDefId: "fixture-mcu" },
    { id: "u2", moduleDefId: "fixture-ldo" },
    { id: "j1", moduleDefId: "fixture-usb-c", name: "USB-C, charging" },
  ],
  exports: [{ id: "usb", from: { child: "j1", interfaceId: "usb" } }],
  links: [
    { id: "vbus", a: { child: "j1", interfaceId: "vbus" }, b: { child: "u2", interfaceId: "vin" } },
    { id: "v3v3", a: { child: "u2", interfaceId: "vout" }, b: { child: "u1", interfaceId: "vdd" } },
  ],
};
`;
const CASE = `const opening = (id: string) => ({ id, name: id, domain: "mechanical", exposed: true, protocols: [{ type: "mechanical", roles: ["mount"] }] });
export const CASE = { id: "watch-case", name: "Watch case", interfaces: [opening("pod_a"), opening("pod_b")] };
`;
const SYSTEM = `export const POD = { id: "watch-pod", name: "Sensor pod", kind: "group", interfaces: [], children: [{ id: "board", moduleDefId: "watch-mainboard" }, { id: "screws", moduleDefId: "fixture-screw-m2x4", quantity: 2 }] };
export const WATCH = { id: "watch", name: "Fixture watch", version: "1.2.0", description: "A fixture watch: two sensor pods in a printed case.", interfaces: [], children: [
  { id: "case", moduleDefId: "watch-case" },
  { id: "pod_a", moduleDefId: "watch-pod", name: "Left pod" },
  { id: "pod_b", moduleDefId: "watch-pod", name: "Right pod" },
  { id: "case_screws", moduleDefId: "fixture-screw-m2x4", quantity: 4 },
  { id: "strap", moduleDefId: "fixture-strap" },
  { id: "buckle", moduleDefId: "fixture-buckle" },
] };
`;
const circuitConfig = `import { defineCapabilityConfig } from "@protoboardai/core";\nexport default defineCapabilityConfig({ provider: "@fixtures/fake-circuit-a", constraints: { width_mm: 38, height_mm: 30, layers: 2 } });\n`;
const cadConfig = `import { defineCapabilityConfig } from "@protoboardai/core";\nexport default defineCapabilityConfig({ provider: "@fixtures/fake-cad", process: "print", constraints: { wall_mm: 1.6, inner_mm: [40, 34, 9] } });\n`;
const config = (release: string) =>
  `import { defineConfig } from "@protoboardai/core";\nexport default defineConfig({ name: "watch", root: { source: "src/watch.uhd.ts", export: "WATCH" }, extensions: ["@protoboardai/ext-release"], release: ${release} });\n`;

let n = 0;
function write(dir: string, rel: string, content: string | Buffer) {
  mkdirSync(join(dir, rel, ".."), { recursive: true });
  writeFileSync(join(dir, rel), content);
}
/** A fresh watch project; `exported` runs generate and export for the board and the case (records in operations/). */
async function watch(o: { release?: string; files?: Record<string, string>; exported?: boolean } = {}): Promise<string> {
  const dir = join(TMP, `w${n++}`);
  rmSync(dir, { recursive: true, force: true });
  const files: Record<string, string> = {
    "package.json": JSON.stringify({ name: "watch", type: "module" }),
    "protoboard.config.ts": config(o.release ?? `{ units: ["watch-pod"] }`),
    "src/parts.uhd.ts": PARTS,
    "src/watch.uhd.ts": SYSTEM,
    "src/boards/mainboard/mainboard.uhd.ts": BOARD,
    "src/boards/mainboard/circuit.config.ts": circuitConfig,
    "src/enclosures/case/case.uhd.ts": CASE,
    "src/enclosures/case/cad.config.ts": cadConfig,
    ...o.files,
  };
  for (const [rel, content] of Object.entries(files)) write(dir, rel, content);
  mkdirSync(join(dir, "node_modules/@fixtures"), { recursive: true });
  for (const p of ["fake-circuit-a", "fake-cad"]) symlinkSync(join(PROVIDERS, p), join(dir, "node_modules/@fixtures", p), "dir");
  if (o.exported !== false) {
    const p = await loadProject(dir, { checks: false });
    for (const m of ["watch-mainboard", "watch-case"]) for (const op of ["generate", "export"]) expect((await runCapabilityOperation(p, m === "watch-case" ? "cad" : "circuit", op, m)).status).toBe("succeeded");
  }
  return dir;
}

const codes = (ds: { code: string; severity: string }[]) => ds.filter((d) => d.severity === "error").map((d) => d.code);

describe("units", () => {
  let p: Project;
  beforeAll(async () => {
    p = await loadProject(await watch({ exported: false }), { checks: false, extensions: false });
  });

  it("folds every instance into the nearest unit above it; a module id is one unit built per instance", () => {
    const { units, diagnostics } = resolveUnits(p, ["watch-pod"]);
    expect(codes(diagnostics)).toEqual([]);
    expect(units.map((u) => [u.id, u.folder, u.kind, u.perProduct])).toEqual([
      ["watch-pod", "units/watch-pod", "module", 2],
      ["system", "system", "root", 1],
    ]);
    const pod = units[0];
    expect(pod.instances).toEqual(["pod_a", "pod_b"]);
    expect(pod.parents).toEqual(["system"]);
    expect(pod.members.map((m) => [m.path, m.quantity, m.depth])).toEqual([
      ["board", 1, 0],
      ["board/u1", 1, 1],
      ["board/u2", 1, 1],
      ["board/j1", 1, 1],
      ["screws", 2, 0],
    ]);
    const root = units[1];
    // the pods are sub-units of the root: listed, nothing below them
    expect(root.members.filter((m) => m.unit).map((m) => m.path)).toEqual(["pod_a", "pod_b"]);
    expect(root.members.some((m) => m.path.startsWith("pod_a/"))).toBe(false);
    expect(root.members.find((m) => m.path === "case_screws")!.quantity).toBe(4);
  });

  it("by instance path, only that instance is a unit; the others fold into the root", () => {
    const { units } = resolveUnits(p, ["pod_a"]);
    expect(units.map((u) => [u.id, u.perProduct])).toEqual([["pod_a", 1], ["system", 1]]);
    const root = units.find((u) => u.kind === "root")!;
    expect(root.members.filter((m) => m.path.startsWith("pod_b")).map((m) => m.path)).toEqual(["pod_b", "pod_b/board", "pod_b/board/u1", "pod_b/board/u2", "pod_b/board/j1", "pod_b/screws"]);
    expect(root.members.find((m) => m.path === "pod_b/screws")!.quantity).toBe(2);
  });

  it("nested units are built first; the root is always last", () => {
    const { units, diagnostics } = resolveUnits(p, ["pod_a", "pod_a/board"]);
    expect(codes(diagnostics)).toEqual([]);
    expect(units.map((u) => u.id)).toEqual(["pod_a.board", "pod_a", "system"]);
    expect(units[0].parents).toEqual(["pod_a"]);
    expect(units[1].members.find((m) => m.path === "board")!.unit).toBe("pod_a.board");
  });

  it("reports unknown, unused, duplicate and ambiguous entries; the root needs no entry", () => {
    expect(codes(resolveUnits(p, ["nope"]).diagnostics)).toEqual(["REL_UNIT_INVALID"]);
    expect(codes(resolveUnits(p, ["watch-pod", "pod_a"]).diagnostics)).toEqual(["REL_UNIT_INVALID"]);
    // one build of a module unit cannot hold a unit the other builds lack
    expect(resolveUnits(p, ["watch-pod", "pod_a/board"]).diagnostics.map((d) => d.message).join()).toMatch(/name it by module id \(watch-mainboard\)/);
    const root = resolveUnits(p, ["watch"]);
    expect(root.diagnostics.map((d) => [d.code, d.severity])).toEqual([["REL_UNIT_ROOT", "info"]]);
    expect(root.units.map((u) => u.id)).toEqual(["system"]);
  });
});

describe("bill of materials", () => {
  let p: Project;
  beforeAll(async () => {
    const dir = await watch({
      files: {
        // dated offers for the MCU (ext-sourcing record) and the strap (vendored catalog offers)
        "parts/evidence/fixture-mcu/sourcing.json": JSON.stringify({
          schema: "protoboard.sourcing/v0",
          part: "fixture-mcu",
          manufacturer: "Acme",
          mpn: "MCU-1",
          offers: [
            { supplier: "Distributor A", mpn: "MCU-1", url: "https://distributor-a.example/mcu-1", as_of: "2026-09-30", via: "web", stock: 500, moq: 1, price_breaks: [{ quantity: 1, unit_price: 2.5, currency: "USD" }, { quantity: 10, unit_price: 2, currency: "USD" }], lead_time_weeks: 3 },
            { supplier: "Distributor B", mpn: "MCU-1", url: "https://distributor-b.example/mcu-1", as_of: "2026-09-30", via: "web", stock: 100, price_breaks: [{ quantity: 1, unit_price: 3, currency: "USD" }] },
          ],
          lifecycle: { status: "active", source: "https://acme.example/mcu-1", as_of: "2026-09-30" },
          alternates: [{ mpn: "MCU-2", manufacturer: "Acme", relation: "pin-compatible", differences: "more flash" }],
        }),
        "parts/offers.json": JSON.stringify({ schema: "protoboard.offers/v0", service: "http://localhost:8787", retrievedAt: "2026-10-01T00:00:00Z", parts: { "fixture-strap": [{ supplier: "Strap Shop", sku: "S20", url: "https://straps.example/s20", unitPrice: 4, currency: "USD", minQuantity: 5, observedAt: "2026-10-01", source: "https://straps.example/s20" }] } }),
      },
    });
    p = await loadProject(dir);
  });

  it("each unit's breakdown follows its module tree; the board's components come from UHD with the provider's bom.csv merged by instance", () => {
    const { units } = resolveUnits(p, ["watch-pod"]);
    const pod = unitBom(p, units[0]);
    expect(pod.map((r) => [r.level, r.path, r.kind, r.action, r.qty_per_unit, r.qty_per_product])).toEqual([
      [0, "board", "board", "fabricate", 1, 2],
      [1, "board/u1", "component", "buy", 1, 2],
      [1, "board/u2", "component", "buy", 1, 2],
      [1, "board/j1", "component", "buy", 1, 2],
      [0, "screws", "part", "buy", 2, 4],
    ]);
    expect(pod.find((r) => r.path === "board/u2")!.mpn).toBe("LDO-33");
    const root = unitBom(p, units[1]);
    expect(root.filter((r) => r.kind === "unit").map((r) => [r.path, r.note])).toEqual([
      ["pod_a", "built as unit watch-pod (units/watch-pod/)"],
      ["pod_b", "built as unit watch-pod (units/watch-pod/)"],
    ]);
    expect(root.find((r) => r.path === "case")!.kind).toBe("custom");
    expect(root.find((r) => r.path === "buckle")!.action).toBe("included");
  });

  it("the ordering list rolls quantities up the whole tree, adds spares by the documented rule, and rounds to packs and MOQ", () => {
    const { units } = resolveUnits(p, ["watch-pod"]);
    const lines = new Map(orderingList(p, units, { units: ["watch-pod"], build: 3 }).map((l) => [l.definition, l]));
    // screws: 4 on the case + 2 in each of 2 pods = 8 per product, × 3 products = 24; hardware 10 %, at least 2 → 3; packs of 100
    expect(lines.get("fixture-screw-m2x4")).toMatchObject({ action: "buy", qty_per_product: 8, needed: 24, spares: 3, spares_rule: "default hardware 10 %, min 2", order: 100, pack_qty: 100, packs: 1, units: "system watch-pod" });
    // board components: 2 per product × 3; 5 %, at least 2
    expect(lines.get("fixture-mcu")).toMatchObject({ action: "buy", needed: 6, spares: 2, order: 8 });
    // the cheapest dated offer at the order quantity, its price break, lifecycle and alternates from the sourcing record
    expect(lines.get("fixture-mcu")).toMatchObject({ supplier: "Distributor A", unit_price: 2.5, currency: "USD", extended: 20, lead_time_weeks: 3, lifecycle: "active", alternates: "Acme MCU-2 (pin-compatible)", offer_source: "parts/evidence/fixture-mcu/sourcing.json" });
    // vendored catalog offer: its minimum quantity raises the order
    expect(lines.get("fixture-strap")).toMatchObject({ needed: 3, spares: 0, order: 5, supplier: "Strap Shop", unit_price: 4, extended: 20 });
    expect(lines.get("fixture-strap")!.offer_source).toMatch(/^catalog offers \(parts\/offers.json, 2026-10-01\)/);
    // custom parts are fabrication lines; parts that ship with another part are listed, never ordered
    expect(lines.get("watch-mainboard")).toMatchObject({ action: "fabricate", needed: 6, order: 6 });
    expect(lines.get("watch-case")).toMatchObject({ action: "fabricate", needed: 3 });
    expect(lines.get("fixture-buckle")).toMatchObject({ action: "included", order: 0, note: "included with fixture-strap" });
    expect(lines.has("watch-pod")).toBe(false); // an assembly: its contents are the lines
    expect(lines.get("fixture-usb-c")!.note).toMatch(/no offer recorded/);
  });

  it("quantities do not depend on how the package is split; release.spares overrides by id or tag", () => {
    const split = orderingList(p, resolveUnits(p, ["watch-pod"]).units, {});
    const whole = orderingList(p, resolveUnits(p, []).units, {});
    expect(whole.map((l) => [l.definition, l.needed, l.order])).toEqual(split.map((l) => [l.definition, l.needed, l.order]));
    const own = new Map(orderingList(p, resolveUnits(p, []).units, { spares: { fastener: { percent: 50, min: 0 }, "fixture-mcu": { min: 0 } } }).map((l) => [l.definition, l]));
    expect(own.get("fixture-screw-m2x4")).toMatchObject({ needed: 8, spares: 4, spares_rule: "release.spares.fastener" });
    expect(own.get("fixture-mcu")).toMatchObject({ spares: 0, spares_rule: "release.spares.fixture-mcu" });
  });

  it("a cable's cut list comes from its UHD facts", async () => {
    const { Connector } = await import("@deltarobotics/uhd");
    const rows = cutList({
      id: "lead",
      name: "Lead",
      kind: "harness",
      topology: "wire",
      interfaces: [Connector({ id: "end_a", name: "A end", connector: "jst_gh_2", pins: ["5V", "GND"] }), Connector({ id: "end_b", name: "B end", connector: "solder_leads", pins: ["+", "-"] })],
      links: [{ id: "wires", a: { self: true, interfaceId: "end_a" }, b: { self: true, interfaceId: "end_b" } }],
      traits: [
        { type: "performance", params: { kind: "cable", length_mm: 60, conductors: 2, wire_gauge_awg: 26 } },
        { type: "cable_build", params: { colors: ["red", "black"], bundle: "twisted", twist_pitch_mm: 20, strip_mm: 2 } },
      ],
    } as never);
    expect(rows.map((r) => [r.conductor, r.from, r.to, r.colour, r.length_mm, r.gauge_awg, r.lay])).toEqual([
      [1, "A end 5V", "B end +", "red", 60, 26, "twisted, 20 mm pitch"],
      [2, "A end GND", "B end -", "black", 60, 26, "twisted, 20 mm pitch"],
    ]);
  });
});

describe("per-placement passive values", () => {
  // the catalog's Yageo RC0402 series part (a test copy, core/test/fixtures/catalog) at two values on the mainboard
  const RC0402 = readFileSync(join(HERE, "../../core/test/fixtures/catalog/yageo-rc0402.json"));
  const board = BOARD.replace(
    `{ id: "j1", moduleDefId: "fixture-usb-c", name: "USB-C, charging" },`,
    `{ id: "j1", moduleDefId: "fixture-usb-c", name: "USB-C, charging" },
    { id: "r1", moduleDefId: "yageo-rc0402", name: "CC1 pull-down", overrides: { resistance: 5100 } },
    { id: "r2", moduleDefId: "yageo-rc0402", name: "CC2 pull-down", overrides: { resistance: 5100 } },
    { id: "r3", moduleDefId: "yageo-rc0402", name: "Reset pull-up" },`,
  );
  const origins = { schema: "protoboard.origins/v0", definitions: { "yageo-rc0402": { file: "parts/catalog/yageo-rc0402.json", tier: "catalog", provider: "protoboard-cloud (test copy)", library: "protoboard", partId: "yageo-rc0402", revision: 2, digest: sha256(RC0402), retrievedAt: "2026-10-03T00:00:00.000Z" } } };
  let p: Project;
  beforeAll(async () => {
    const dir = await watch({
      files: {
        "src/boards/mainboard/mainboard.uhd.ts": board,
        "parts/catalog/yageo-rc0402.json": RC0402.toString("utf8"),
        "parts/origins.json": JSON.stringify(origins),
        // the catalog's offers are for the default MPN; a sourcing record names the 5.1 kΩ one
        "parts/offers.json": JSON.stringify({ schema: "protoboard.offers/v0", service: "http://localhost:8787", retrievedAt: "2026-10-01T00:00:00Z", parts: { "yageo-rc0402": [{ supplier: "Chip Shop", sku: "10K", url: "https://chips.example/10k", unitPrice: 0.01, currency: "USD", minQuantity: 10, observedAt: "2026-10-01", source: "https://chips.example/10k" }] } }),
        "parts/evidence/yageo-rc0402/sourcing.json": JSON.stringify({
          schema: "protoboard.sourcing/v0",
          part: "yageo-rc0402",
          manufacturer: "Yageo",
          mpn: "RC0402FR-075K1L",
          offers: [{ supplier: "Chip Shop", mpn: "RC0402FR-075K1L", url: "https://chips.example/5k1", as_of: "2026-10-01", via: "web", stock: 10000, moq: 10, price_breaks: [{ quantity: 10, unit_price: 0.02, currency: "USD" }] }],
        }),
      },
    });
    p = await loadProject(dir);
  });

  it("the unit BOM shows each placement's value and MPN", () => {
    const pod = unitBom(p, resolveUnits(p, ["watch-pod"]).units[0]);
    expect(pod.filter((r) => r.definition === "yageo-rc0402").map((r) => [r.path, r.mpn, r.value, r.kind])).toEqual([
      ["board/r1", "RC0402FR-075K1L", "5.1 kΩ ±1 %", "component"],
      ["board/r2", "RC0402FR-075K1L", "5.1 kΩ ±1 %", "component"],
      ["board/r3", "RC0402FR-0710KL", "10 kΩ ±1 %", "component"],
    ]);
  });

  it("the ordering list has one line per value, priced only by offers for that MPN", () => {
    const lines = orderingList(p, resolveUnits(p, ["watch-pod"]).units, { units: ["watch-pod"], build: 1 }).filter((l) => l.definition === "yageo-rc0402");
    expect(lines.map((l) => [l.mpn, l.value, l.qty_per_product, l.needed, l.spares, l.order, l.supplier, l.unit_price])).toEqual([
      // 2 pods × 1 = 2 needed, 5 %, at least 2 spares, raised to the offer's minimum of 10
      ["RC0402FR-0710KL", "10 kΩ ±1 %", 2, 2, 2, 10, "Chip Shop", 0.01],
      // 2 per pod × 2 pods = 4
      ["RC0402FR-075K1L", "5.1 kΩ ±1 %", 4, 4, 2, 10, "Chip Shop", 0.02],
    ]);
    expect(lines[1].offer_url).toBe("https://chips.example/5k1");
    expect(lines[0].offer_url).toBe("https://chips.example/10k");
    const csv = parseCsv(orderingCsv(lines)).rows;
    expect(csv[0].slice(3, 6)).toEqual(["manufacturer", "mpn", "value"]);
    expect(csv.slice(1).map((r) => r.slice(4, 6))).toEqual([
      ["RC0402FR-0710KL", "10 kΩ ±1 %"],
      ["RC0402FR-075K1L", "5.1 kΩ ±1 %"],
    ]);
  });

  it("the bill of materials prices each value the same way: never by another value's offer (PB-933)", () => {
    const lines = bomLines(projectBom(p, { now: "2026-10-07T00:00:00Z" })).filter((l) => l.definition === "yageo-rc0402");
    expect(lines.map((l) => [l.key, l.mpn, l.offers.map((o) => o.url), l.quote?.unitPrice]).sort()).toEqual([
      ["yageo-rc0402#RC0402FR-075K1L", "RC0402FR-075K1L", ["https://chips.example/5k1"], 0.02],
      // an offer that names no ordering code is for the definition's own
      ["yageo-rc0402", "RC0402FR-0710KL", ["https://chips.example/10k"], 0.01],
    ]);
  });

  it("a value with no offer for its own ordering code stays unpriced in the list and in the bill", () => {
    const file = join(p.root, "parts/evidence/yageo-rc0402/sourcing.json");
    const before = readFileSync(file, "utf8");
    rmSync(file);
    try {
      const l = orderingList(p, resolveUnits(p, ["watch-pod"]).units, { units: ["watch-pod"], build: 1 }).find((x) => x.mpn === "RC0402FR-075K1L")!;
      expect([l.supplier, l.unit_price, l.extended]).toEqual(["", null, null]);
      const b = bomLines(projectBom(p, { now: "2026-10-07T00:00:00Z" })).find((x) => x.mpn === "RC0402FR-075K1L")!;
      expect([b.status, b.offers.length]).toEqual(["unpriced", 0]);
    } finally {
      writeFileSync(file, before);
    }
  });
});

describe("catalog offers per MPN", () => {
  // the same board as above, priced only by vendored catalog offers that each name their MPN
  const RC0402 = readFileSync(join(HERE, "../../core/test/fixtures/catalog/yageo-rc0402.json"));
  const board = BOARD.replace(
    `{ id: "j1", moduleDefId: "fixture-usb-c", name: "USB-C, charging" },`,
    `{ id: "j1", moduleDefId: "fixture-usb-c", name: "USB-C, charging" },
    { id: "r1", moduleDefId: "yageo-rc0402", name: "CC1 pull-down", overrides: { resistance: 5100 } },
    { id: "r2", moduleDefId: "yageo-rc0402", name: "CC2 pull-down", overrides: { resistance: 5100 } },
    { id: "r3", moduleDefId: "yageo-rc0402", name: "Reset pull-up" },`,
  );
  const origins = { schema: "protoboard.origins/v0", definitions: { "yageo-rc0402": { file: "parts/catalog/yageo-rc0402.json", tier: "catalog", provider: "protoboard-cloud (test copy)", library: "protoboard", partId: "yageo-rc0402", revision: 2, digest: sha256(RC0402), retrievedAt: "2026-10-03T00:00:00.000Z" } } };
  const offer = (o: Record<string, unknown>) => ({ supplier: "Chip Shop", currency: "USD", observedAt: "2026-10-01", source: "test fixture, not a real offer", ...o });
  let p: Project;
  beforeAll(async () => {
    const dir = await watch({
      files: {
        "src/boards/mainboard/mainboard.uhd.ts": board,
        "parts/catalog/yageo-rc0402.json": RC0402.toString("utf8"),
        "parts/origins.json": JSON.stringify(origins),
        "parts/offers.json": JSON.stringify({
          schema: "protoboard.offers/v0",
          service: "http://localhost:8787",
          retrievedAt: "2026-10-02T00:00:00Z",
          parts: {
            "yageo-rc0402": [
              offer({ mpn: "RC0402FR-0710KL", sku: "10K", url: "https://chips.example/10k", unitPrice: 0.004, priceBreaks: [{ quantity: 100, unitPrice: 0.004 }, { quantity: 1000, unitPrice: 0.002 }], minQuantity: 100, stock: 50000, leadTimeWeeks: 0, packaging: "cut tape" }),
              // cheaper, but the supplier has none: quoted only when no offer has stock
              offer({ supplier: "Reel Shop", mpn: "RC0402FR-0710KL", url: "https://reels.example/10k", unitPrice: 0.001, minQuantity: 100, stock: 0 }),
              offer({ mpn: "RC0402FR-075K1L", sku: "5K1", url: "https://chips.example/5k1", unitPrice: 0.006, priceBreaks: [{ quantity: 100, unitPrice: 0.006 }], minQuantity: 100, stock: 9000, leadTimeWeeks: 2 }),
            ],
          },
        }),
      },
    });
    p = await loadProject(dir);
  });

  it("each value is priced by its own MPN's offers, with their price breaks, MOQ, stock and lead time", () => {
    const lines = orderingList(p, resolveUnits(p, ["watch-pod"]).units, { units: ["watch-pod"], build: 1 }).filter((l) => l.definition === "yageo-rc0402");
    expect(lines.map((l) => [l.mpn, l.order, l.supplier, l.supplier_sku, l.unit_price, l.extended, l.stock, l.lead_time_weeks, l.moq])).toEqual([
      ["RC0402FR-0710KL", 100, "Chip Shop", "10K", 0.004, 0.4, 50000, 0, 100],
      ["RC0402FR-075K1L", 100, "Chip Shop", "5K1", 0.006, 0.6, 9000, 2, 100],
    ]);
    expect(lines[0].offer_source).toMatch(/^catalog offers \(parts\/offers.json, 2026-10-02\)/);
  });

  it("a cost in several currencies sets each currency apart on the overview", () => {
    const html = blocksHtml([{ kind: "figures", items: [{ label: "Cost estimate", value: "299.81 USD + 105.25 EUR + 41.88 GBP" }, { label: "Lead time", value: "3 wk" }] }], (x) => x);
    expect(html).toContain('<span class="n">299.81</span>\u00a0<span class="u">USD</span> + <span class="n">105.25</span>\u00a0<span class="u">EUR</span> + <span class="n">41.88</span>\u00a0<span class="u">GBP</span>');
    expect(html).toContain('<span class="n">3</span>\u00a0<span class="u">wk</span>');
  });

  it("totals each currency by summing the lines, then rounding to cents", () => {
    const lines = orderingList(p, resolveUnits(p, ["watch-pod"]).units, { units: ["watch-pod"], build: 1 });
    const priced = lines.filter((l) => l.extended !== null && l.currency === "USD");
    const exact = priced.reduce((t, l) => t + l.extended!, 0);
    expect(orderTotals(lines).cost.USD).toBe(Number(exact.toFixed(2)));
    // three lines of 0.004 each are 0.01, not three roundings of 0.00 or 0.01
    const third = (n: number) => ({ ...lines[0], action: "buy" as const, extended: 0.004, currency: "USD", line: n });
    expect(orderTotals([third(1), third(2), third(3)]).cost).toEqual({ USD: 0.01 });
  });

  it("gives the cost in one currency, dollars, with the sums per currency and the rate table's date beside it (PB-933)", () => {
    const fx = { schema: "protoboard.fx/v0" as const, base: "USD", date: "2026-10-01", source: "test table", rates: { GBP: 0.8, EUR: 0.9 } };
    const l = (extended: number, currency: string) => ({ action: "buy", extended, currency, needed: 1, lead_time_weeks: null }) as unknown as OrderLine;
    expect(orderTotals([l(10, "USD"), l(8, "GBP")], fx)).toMatchObject({ cost: { USD: 10, GBP: 8 }, costText: "20 USD", costNote: "10 USD + 8 GBP, converted at the rates of 2026-10-01 (test table)" });
    expect(orderTotals([l(10, "USD")], fx)).toMatchObject({ costText: "10 USD", costNote: "" });
    expect(orderTotals([l(10, "USD"), l(5, "SEK")], fx)).toMatchObject({ costText: "10 USD + 5 SEK", costNote: "no rate for every currency: not totalled" });
  });

  it("an offer with no stock is quoted only when no offer has any", () => {
    const tenK = () => orderingList(p, resolveUnits(p, ["watch-pod"]).units, { units: ["watch-pod"], build: 1 }).find((l) => l.mpn === "RC0402FR-0710KL")!;
    expect(tenK().supplier).toBe("Chip Shop");
    const file = join(p.root, "parts/offers.json");
    const before = readFileSync(file, "utf8");
    const data = JSON.parse(before);
    data.parts["yageo-rc0402"] = data.parts["yageo-rc0402"].filter((o: { supplier: string }) => o.supplier === "Reel Shop");
    writeFileSync(file, JSON.stringify(data));
    try {
      expect([tenK().supplier, tenK().offer_flag]).toEqual(["Reel Shop", "Reel Shop showed 0 in stock"]);
    } finally {
      writeFileSync(file, before);
    }
    expect(sourcingFor(p, p.lookup("yageo-rc0402")!, readOffersFile(p.root), "RC0402FR-0710KL").offers.map((o) => o.supplier)).toEqual(["Chip Shop", "Reel Shop"]);
  });
});

describe("ordering list: reels, one currency, the bill's chosen offer (PB-872, PB-933)", () => {
  // one connector bought for one product: a full reel, cut tape, and offers in other currencies
  const offers = (list: Record<string, unknown>[], currency?: string) =>
    watch({
      files: {
        ...(currency ? { "protoboard.config.ts": config(`{ units: ["watch-pod"] }`).replace("defineConfig({", `defineConfig({ currency: "${currency}",`) } : {}),
        "parts/offers.json": JSON.stringify({ schema: "protoboard.offers/v0", service: "http://localhost:8787", retrievedAt: "2026-10-03T00:00:00Z", parts: { "fixture-strap": list } }),
      },
    });
  const reel = { supplier: "Reel House", mpn: "STRAP-20", url: "https://reel.example/strap", unitPrice: 1.48, currency: "USD", priceBreaks: [{ quantity: 1300, unitPrice: 1.48 }], minQuantity: 1300, packaging: "REEL (unit pack 1300)", observedAt: "2026-10-03", source: "test fixture, not a real offer" };
  const cut = { supplier: "Cut Tape Co", mpn: "STRAP-20", url: "https://cut.example/strap", unitPrice: 2.9, currency: "USD", priceBreaks: [{ quantity: 1, unitPrice: 2.9 }], packaging: "Cut Tape (CT)", observedAt: "2026-10-03", source: "test fixture, not a real offer" };
  const euro = { supplier: "Euro Parts", mpn: "STRAP-20", url: "https://euro.example/strap", unitPrice: 1.1, currency: "EUR", priceBreaks: [{ quantity: 1, unitPrice: 1.1 }], observedAt: "2026-10-03", source: "test fixture, not a real offer" };
  const line = async (dir: string) => orderingList(await loadProject(dir), resolveUnits(await loadProject(dir), []).units, {}).find((l) => l.definition === "fixture-strap")!;

  it("prefers cut tape to a full reel", async () => {
    const l = await line(await offers([reel, cut]));
    expect([l.supplier, l.order, l.unit_price, l.extended, l.offer_flag]).toEqual(["Cut Tape Co", 1, 2.9, 2.9, ""]);
    expect(l.offer_alternatives).toBe("Reel House: full reel 1300 × 1.48 USD = 1924.00 USD");
  });

  it("never quotes a full reel for fewer than a reel: the line stays unpriced, flagged, the reel an alternative", async () => {
    const l = await line(await offers([reel]));
    expect([l.supplier, l.order, l.unit_price, l.extended, l.moq]).toEqual(["", 1, null, null, null]);
    expect(l.offer_flag).toBe("no offer fits 1: Reel House sells only a full reel of 1300 (1924.00 USD); not quoted");
    expect(l.note).toBe(l.offer_flag);
    expect(l.offer_alternatives).toBe("Reel House: full reel 1300 × 1.48 USD = 1924.00 USD");
    expect(orderTotals([l]).cost).toEqual({});
  });

  it("quotes every line in dollars: a cheaper offer in another currency is used, converted and marked", async () => {
    const dir = await offers([euro, cut]);
    writeFileSync(join(dir, "parts/fx-rates.json"), JSON.stringify({ schema: "protoboard.fx/v0", base: "EUR", date: "2026-10-01", source: "test table", rates: { USD: 1.2 } }));
    const l = await line(dir);
    expect([l.supplier, l.currency, l.unit_price, l.extended]).toEqual(["Euro Parts", "USD", 1.32, 1.32]);
    expect([l.supplier_unit_price, l.supplier_currency, l.fx_rate, l.fx_date]).toEqual([1.1, "EUR", 1.2, "2026-10-01"]);
    expect(l.offer_flag).toBe("converted from EUR at 1.2 (2026-10-01)");
    const t = orderTotals([l], { schema: "protoboard.fx/v0", base: "EUR", date: "2026-10-01", source: "test table", rates: { USD: 1.2 } });
    expect(t).toMatchObject({ cost: { USD: 1.32 }, costText: "1.32 USD", costNote: "prices in EUR converted at the rates of 2026-10-01 (test table)" });
    const csv = parseCsv(orderingCsv([l])).rows;
    const col = (k: string) => csv[1][csv[0].indexOf(k)];
    expect([col("unit_price"), col("currency"), col("supplier_unit_price"), col("supplier_currency"), col("fx_rate"), col("fx_date")]).toEqual(["1.32", "USD", "1.1", "EUR", "1.2", "2026-10-01"]);
  });

  it("an offer in a currency the rate table lacks is not quoted", async () => {
    const dir = await offers([{ ...euro, currency: "XTS" }, cut]);
    const l = await line(dir);
    expect([l.supplier, l.currency, l.unit_price]).toEqual(["Cut Tape Co", "USD", 2.9]);
  });

  it("uses the offer chosen for the line in the bill of materials (parts/bom.json), and says so", async () => {
    const dir = await offers([euro, cut]);
    writeFileSync(join(dir, "parts/bom.json"), JSON.stringify({ schema: "protoboard.bom-settings/v0", units: 1, offers: { "fixture-strap": "library:Cut Tape Co:STRAP-20" } }));
    const l = await line(dir);
    expect([l.supplier, l.unit_price, l.supplier_currency, l.offer_flag]).toEqual(["Cut Tape Co", 2.9, "", "chosen in the bill of materials (parts/bom.json)"]);
  });

  it("raises the order to a price break when that costs less, and says so", async () => {
    const l = await line(await offers([{ ...cut, priceBreaks: [{ quantity: 1, unitPrice: 2.9 }, { quantity: 2, unitPrice: 1 }] }]));
    expect([l.needed, l.order, l.unit_price, l.extended, l.offer_flag]).toEqual([1, 2, 1, 2, "raised from 1 to the price break: 1 would cost 2.90 USD"]);
  });
});

describe("preconditions", () => {
  const refusals = async (dir: string) => {
    const p = await loadProject(dir);
    return preconditions(p, freshness(p));
  };

  it("a clean project passes", async () => {
    expect(codes(await refusals(await watch()))).toEqual([]);
  });

  it("does not hold an earlier package against the project (a release replaces its folder)", async () => {
    const dir = await watch();
    write(dir, "release/1.0.0/index.html", "edited after the release");
    const record = { schema: "protoboard.operation/v0", operation: "release", extension: { id: "@protoboardai/ext-release", version: "0.1.0" }, effect: "export", inputs: {}, startedAt: "2026-01-01T00:00:00.000Z", status: "succeeded", summary: "", outputs: [{ path: "release/1.0.0/index.html", digest: "sha256:0000" }] };
    write(dir, "operations/2026-01-01T00-00-00-000Z-release.json", JSON.stringify(record));
    expect(codes(await refusals(dir))).toEqual([]);
  });

  it("refuses check errors", async () => {
    const dir = await watch({ files: { "src/watch.uhd.ts": SYSTEM.replace(`{ id: "strap", moduleDefId: "fixture-strap" }`, `{ id: "strap", moduleDefId: "no-such-part" }`) } });
    expect(codes(await refusals(dir))).toContain("REL_CHECK_ERRORS");
  });

  it("refuses an output edited after its export, a file the export did not write, and one it wrote that is gone", async () => {
    const dir = await watch();
    const out = "src/enclosures/case/out";
    write(dir, `${out}/body.stl`, readFileSync(join(dir, out, "body.stl")).subarray(0, 84 + 50)); // still a valid STL, not the exported bytes
    write(dir, `${out}/extra.dxf`, "0\nSECTION\n0\nEOF\n");
    rmSync(join(dir, "src/boards/mainboard/out/pnp.csv"));
    const msgs = (await refusals(dir)).filter((d) => d.code === "REL_STALE").map((d) => d.message);
    expect(msgs.some((m) => /body\.stl was changed after cad:export wrote it/.test(m))).toBe(true);
    expect(msgs.some((m) => /extra\.dxf is not from the last export of watch-case/.test(m))).toBe(true);
    expect(msgs.some((m) => /pnp\.csv from the last export of watch-mainboard is missing/.test(m))).toBe(true);
  });

  it("refuses outputs exported from another config or an earlier module", async () => {
    const dir = await watch();
    write(dir, "src/enclosures/case/cad.config.ts", cadConfig.replace("wall_mm: 1.6", "wall_mm: 2"));
    // the export record of an earlier board (edited here: this process caches the board's module, so it cannot be edited and reloaded)
    const ops = join(dir, "operations");
    const exp = readdirSync(ops).find((f) => f.endsWith("circuit-export.json"))!;
    const rec = JSON.parse(readFileSync(join(ops, exp), "utf8"));
    rec.capability.moduleDigest = "sha256:" + "0".repeat(64);
    writeFileSync(join(ops, exp), JSON.stringify(rec, null, 2));
    const msgs = (await refusals(dir)).map((d) => d.message);
    expect(msgs.some((m) => /src\/enclosures\/case\/cad\.config\.ts changed since the last export/.test(m))).toBe(true);
    expect(msgs.some((m) => /watch-mainboard changed since its last export/.test(m))).toBe(true);
  });

  it("refuses a module that was never exported", async () => {
    const dir = await watch({ exported: false });
    expect(codes(await refusals(dir))).toEqual(expect.arrayContaining(["REL_NOT_EXPORTED", "REL_STALE"]));
  });

  it("refuses uncommitted changes unless allowed, and writes nothing when refused", async () => {
    const dir = await watch();
    const git = (...a: string[]) => execFileSync("git", ["-C", dir, ...a], { stdio: "ignore", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com" } });
    write(dir, ".gitignore", "node_modules/\n");
    git("init", "-q");
    git("add", "-A");
    git("commit", "-q", "-m", "fixture");
    const check = async (allowDirty: boolean) => buildRelease(await loadProject(dir), { checkOnly: true, allowDirty, write: () => expect.unreachable("a check writes nothing") });
    expect((await check(false)).status).toBe("succeeded");
    write(dir, "src/parts.uhd.ts", PARTS + "\n// edited\n");
    const refused = await check(false);
    expect(refused.status).toBe("failed");
    expect(refused.diagnostics.find((d) => d.code === "REL_DIRTY")!.message).toMatch(/uncommitted changes in the project \(src\/parts\.uhd\.ts\)/);
    const allowed = await check(true);
    expect(allowed.status).toBe("succeeded");
    expect(allowed.summary).toMatch(/ready to release 1\.2\.0: 2 unit\(s\)/);
  });
});

describe("normalising Chrome's PDF", () => {
  it("sets the dates and numbers element ids in document order, the ID tree sorted again, without moving a byte", () => {
    const pdf = Buffer.from(
      "%PDF-1.4\n/CreationDate (D:20261003041350+00'00')\n/ModDate (D:20261003041350+00'00')\n5 0 obj\n<</S /TH /ID (node00000746)>>\n7 0 obj\n<</S /TH /ID (node00000012)>>\n8 0 obj\n<</S /TD /A [<</O /Table /Headers [(node00000012) (node00000746)]>>]>>\n9 0 obj\n<</Limits [(node00000012) (node00000746)]\n/Names [(node00000012) 7 0 R (node00000746) 5 0 R]>>\n",
    );
    const out = normalisePdf(pdf, "D:20261001120000+00'00'").toString("latin1");
    expect(out.length).toBe(pdf.length);
    expect(out).toContain("/CreationDate (D:20261001120000+00'00')");
    expect(out).toContain("<</S /TH /ID (node00000001)>>\n7 0 obj\n<</S /TH /ID (node00000002)>>");
    expect(out).toContain("/Headers [(node00000002) (node00000001)]");
    expect(out).toContain("/Limits [(node00000001) (node00000002)]\n/Names [(node00000001) 5 0 R (node00000002) 7 0 R]");
    // Chrome's counter in another order gives the same bytes
    const swapped = Buffer.from(pdf.toString("latin1").replaceAll("node00000746", "node00000003").replaceAll("node00000012", "node00000099").replace("/Limits [(node00000099) (node00000003)]", "/Limits [(node00000003) (node00000099)]").replace("/Names [(node00000099) 7 0 R (node00000003) 5 0 R]", "/Names [(node00000003) 5 0 R (node00000099) 7 0 R]"));
    expect(normalisePdf(swapped, "D:20261001120000+00'00'").toString("latin1")).toBe(out);
  });

  it("renumbers by rank, as before, when the ID tree could not be rewritten in place", () => {
    // in document order node800 becomes node1, whose entry (123 0 R) would move into the first, shorter leaf
    const pdf = "%PDF-1.4\n/ID (node00000800) /ID (node00000012) /ID (node00000746)\n/Limits [(node00000012) (node00000746)]\n/Names [(node00000012) 7 0 R (node00000746) 5 0 R]\n/Limits [(node00000800) (node00000800)]\n/Names [(node00000800) 123 0 R]\n";
    const out = normalisePdf(Buffer.from(pdf), "D:20261001120000+00'00'").toString("latin1");
    expect(out).toBe(
      "%PDF-1.4\n/ID (node00000003) /ID (node00000001) /ID (node00000002)\n/Limits [(node00000001) (node00000002)]\n/Names [(node00000001) 7 0 R (node00000002) 5 0 R]\n/Limits [(node00000003) (node00000003)]\n/Names [(node00000003) 123 0 R]\n",
    );
    // Chrome's raw counter values never reach the file: another counter base gives the same bytes
    const shifted = pdf.replaceAll("node00000800", "node00009800").replaceAll("node00000746", "node00009746").replaceAll("node00000012", "node00009012");
    expect(normalisePdf(Buffer.from(shifted), "D:20261001120000+00'00'").toString("latin1")).toBe(out);
  });
});

// ---------------------------------------------------------------------------
// The package (renders with Chrome)
// ---------------------------------------------------------------------------

describe("test plan and work order helpers", () => {
  it("reads requirements from a brief: ID tables, requirement tables and top-level or requirement bullets", () => {
    const md = readFileSync(join(HERE, "../../../examples/wearable-watch/docs/brief.md"), "utf8");
    const r = requirements(md);
    expect(r.filter((x) => x.id).map((x) => x.id)).toEqual(["F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8"]);
    expect(r.find((x) => x.id === "F1")).toMatchObject({ title: "Show time, notifications and sensor readings on a 1.28-inch round 240×240 colour display", how: "Demonstrate on the built product" });
    const battery = r.find((x) => x.title === "Battery life, typical use");
    expect(battery).toMatchObject({ text: expect.stringMatching(/≥ 5 days/), record: "measured value, instrument, conditions" });
    // Users is not a requirements section; Constraints is
    expect(r.some((x) => /Engineers evaluating/.test(x.text))).toBe(false);
    expect(r.some((x) => /^Agreed hardware/.test(x.text))).toBe(true);
    const quad = requirements(readFileSync(join(HERE, "../../../examples/quadcopter-5in/docs/brief.md"), "utf8"));
    // the quadcopter's requirements table states how, pass and record per row; its scope bullets are not requirements
    expect(quad.map((x) => x.id)).toEqual(["R1", "R2", "R3", "R4", "R5", "R6", "R7", "R8", "R9"]);
    expect(quad[0]).toMatchObject({ title: "True-X frame, 225 mm wheelbase", text: "True-X frame, 225 mm wheelbase", pass: "225 mm on both diagonals, within 1 mm (target)", record: "both diagonals" });
    expect(quad[0].how).toMatch(/^Calipers or a rule between the shaft centres/);
  });

  it("prints test ids as ranges", () => {
    expect(idRanges(["FAI-1", "FAI-2", "FAI-3", "BU-1", "BU-3", "JT-2"])).toBe("FAI-1…FAI-3, BU-1, BU-3, JT-2");
    expect(idRanges([])).toBe("");
  });

  it("document ids name the unit once, without repeating the project", () => {
    const set = { project: "quadcopter-5in" } as DocSet;
    const unit = (id: string, kind: Unit["kind"] = "module") => ({ id, kind }) as Unit;
    expect(docId(set, unit("quadcopter-5in-arm"), "work-order")).toBe("QUADCOPTER-5IN-ARM-WO");
    expect(docId(set, unit("stack", "instance"), "test-plan")).toBe("QUADCOPTER-5IN-STACK-TP");
    expect(docId(set, unit("system", "root"), "overview")).toBe("QUADCOPTER-5IN-SYS-OV");
  });
});

describe("the first page: what the product is (PB-935)", () => {
  const stated = { file: true, summary: "A watch.", features: ["Tells the time"], functions: [{ id: "F1", text: "Shows the time", by: "the display" }], requirements: [{ id: "R1", text: "5 days of battery", how: "Run it down", pass: "≥ 5 days" }], requirementsFrom: "docs/product.json", missing: [], problems: [] } satisfies ProductStatement;

  it("is built from the project's statement: what it is, features, functions, requirements with how each is shown", () => {
    const b = productBlocks(stated, "model description");
    expect(b.map((x) => (x.kind === "heading" ? x.text : x.kind))).toEqual(["What it is", "paragraph", "Features", "list", "What it does", "table", "Requirements", "table"]);
    expect(b[1]).toEqual({ kind: "paragraph", text: "A watch." });
    expect(b[5]).toMatchObject({ columns: [{ label: "ID" }, { label: "Function" }, { label: "Done by" }], rows: [{ id: "F1", text: "Shows the time", by: "the display" }] });
    expect(b[7]).toMatchObject({ columns: [{ label: "ID" }, { label: "Requirement" }, { label: "How it is shown" }, { label: "Pass" }], rows: [{ id: "R1", how: "Run it down", pass: "≥ 5 days" }] });
    expect(productDiagnostics(stated)).toEqual([]);
  });

  it("says plainly what the project has not stated, and invents nothing", () => {
    const none = { file: false, features: [], functions: [], requirements: [], missing: ["summary", "features", "functions", "requirements"], problems: [] } satisfies ProductStatement;
    const b = productBlocks(none, "A model description.");
    // the root module's own description is the project's words, so it is shown; the rest is said to be missing
    expect(b[1]).toEqual({ kind: "paragraph", text: "A model description." });
    const notes = b.filter((x) => x.kind === "note").map((x) => (x as { text: string }).text);
    expect(notes).toEqual([
      "The project has not stated what the device is. State it in docs/product.json (the system-compose skill, step 1).",
      "The project has not stated the device's features. State it in docs/product.json (the system-compose skill, step 1).",
      "The project has not stated the system's functions. State it in docs/product.json (the system-compose skill, step 1).",
      "The project has not stated its requirements. State it in docs/product.json (the system-compose skill, step 1).",
    ]);
    expect(b.some((x) => x.kind === "table" || x.kind === "list")).toBe(false);
    const d = productDiagnostics(none);
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ code: "REL_PRODUCT_NOT_STATED", severity: "warning" });
    expect(d[0].message).toMatch(/cannot say what the device is \(summary\), its features, the system's functions, its requirements: the project has no docs\/product\.json/);
    expect(productDiagnostics({ ...stated, file: true, missing: ["features"], problems: ["summary must be text"] }).map((x) => x.code)).toEqual(["REL_PRODUCT_INVALID", "REL_PRODUCT_NOT_STATED"]);
  });

  it("release --check reports it as a warning, not a refusal; a stated product gives none, and its requirements feed the test plan", async () => {
    const check = async (dir: string) => buildRelease(await loadProject(dir), { checkOnly: true, allowDirty: true, write: () => expect.unreachable("a check writes nothing") });
    const bare = await check(await watch());
    expect(bare.status).toBe("succeeded");
    expect(bare.diagnostics.filter((d) => d.code.startsWith("REL_PRODUCT")).map((d) => [d.code, d.severity])).toEqual([["REL_PRODUCT_NOT_STATED", "warning"]]);
    const product = JSON.stringify({ schema: "protoboard.product/v0", summary: "A watch.", features: ["Tells the time"], functions: [{ id: "F1", text: "Shows the time" }], requirements: [{ id: "R1", text: "Battery life ≥ 5 days", how: "Run it down from full", pass: "≥ 5 days", record: "days" }] });
    const dir = await watch({ files: { "docs/product.json": product } });
    const full = await check(dir);
    expect(full.status).toBe("succeeded");
    expect(full.diagnostics.filter((d) => d.code.startsWith("REL_PRODUCT"))).toEqual([]);
  });
});

const chrome = probeTools([{ manifest: { schema: "protoboard.extension/v0", id: "probe", version: "0", compatibility: { protoboard: "*" }, tools: [{ id: "chrome", purpose: "", probe: ["protoboard:browser"] }] }, root: "" }])[0].available;

describe.skipIf(!chrome)("the Manufacturing Package", () => {
  let dir: string;
  let first: { files: string[]; manifest: string; digests: Record<string, string> };
  const release = async () => {
    const p = await loadProject(dir);
    const found = findOperation(p.extensions, "release")!;
    return runOperation(p, found.ext, found.op, {}, { record: false });
  };
  const snapshot = () => {
    const files = listTree(join(dir, "release/1.2.0"));
    const manifest = readFileSync(join(dir, "release/1.2.0/manifest.json"), "utf8");
    return { files, manifest, digests: Object.fromEntries((JSON.parse(manifest).files as { path: string; digest: string }[]).map((f) => [f.path, f.digest])) };
  };

  beforeAll(async () => {
    dir = await watch();
    const rec = await release();
    expect(rec.summary).toMatch(/release\/1\.2\.0: 2 unit\(s\)/);
    expect(rec.status).toBe("succeeded");
    expect(existsSync(join(dir, "release/1.2.0/manifest.json"))).toBe(true);
    first = snapshot();
  }, 180000);

  it("lays the package out by unit, with files from the standard outputs", () => {
    const docs = ["spec-sheet.pdf", "bom.pdf", "bom.csv", "work-order.pdf", "assembly-guide.pdf", "test-plan.pdf"];
    for (const unit of ["system", "units/watch-pod"]) for (const d of docs) expect(first.files).toContain(`${unit}/${d}`);
    expect(first.files).toEqual(expect.arrayContaining(["00-overview.pdf", "index.html", "manifest.json", "system/ordering-list.csv", "system/files/model/uhd-bundle.json"]));
    expect(first.files.filter((f) => f.startsWith("units/watch-pod/files/"))).toEqual([
      "units/watch-pod/files/boards/watch-mainboard/board.glb",
      "units/watch-pod/files/boards/watch-mainboard/board.step",
      "units/watch-pod/files/boards/watch-mainboard/bom.csv",
      "units/watch-pod/files/boards/watch-mainboard/gerber/B_Cu.gbr",
      "units/watch-pod/files/boards/watch-mainboard/gerber/Edge_Cuts.gbr",
      "units/watch-pod/files/boards/watch-mainboard/gerber/F_Cu.gbr",
      "units/watch-pod/files/boards/watch-mainboard/gerber/board.drl",
      "units/watch-pod/files/boards/watch-mainboard/pnp.csv",
      "units/watch-pod/files/test/test-record.csv",
    ]);
    expect(first.files).toContain("system/files/test/test-record.csv");
    expect(first.files.filter((f) => f.startsWith("system/files/mechanical/"))).toEqual(["system/files/mechanical/watch-case/watch-case.step", "system/files/mechanical/watch-case/watch-case.stl"]);
    expect(readFileSync(join(dir, "release/1.2.0/units/watch-pod/files/boards/watch-mainboard/gerber/F_Cu.gbr"))).toEqual(readFileSync(join(dir, "src/boards/mainboard/out/gerber/F_Cu.gbr")));
    for (const f of first.files.filter((f) => f.endsWith(".pdf"))) expect(readFileSync(join(dir, "release/1.2.0", f)).subarray(0, 5).toString()).toBe("%PDF-");
    const bom = parseCsv(readFileSync(join(dir, "release/1.2.0/units/watch-pod/bom.csv"), "utf8")).rows;
    expect(bom[0].slice(0, 3)).toEqual(["level", "path", "item"]);
    expect(bom.length).toBe(6);
  });

  it("writes a manifest of the inputs and every file", () => {
    const m = JSON.parse(first.manifest);
    expect(m.schema).toBe("protoboard.release/v0");
    expect(m).toMatchObject({ project: { name: "watch", root: "watch" }, version: "1.2.0", source: null, build: 1 });
    expect(m.units.map((u: { id: string; perProduct: number }) => [u.id, u.perProduct])).toEqual([["watch-pod", 2], ["system", 1]]);
    expect(m.outputs.map((o: { module: string; provider: { id: string }; packaged: string[] }) => [o.module, o.provider.id, o.packaged.length])).toEqual([
      ["watch-case", "@fixtures/fake-cad", 2],
      ["watch-mainboard", "@fixtures/fake-circuit-a", 8],
    ]);
    expect(m.outputs[1].moduleDigest).toMatch(/^sha256:/);
    expect(m.parts.find((x: { id: string }) => x.id === "fixture-mcu")).toMatchObject({ tier: "project-specific", instances: 2 });
    expect(m.check.errors).toBe(0);
    expect(m.files.map((f: { path: string }) => f.path)).toEqual(first.files.filter((f) => f !== "manifest.json"));
    expect(m.sections.filter((s: { unit: string }) => s.unit === "system").map((s: { section: string }) => s.section)).toEqual(["spec", "bom", "work-order", "assembly", "test-plan"]);
    const html = readFileSync(join(dir, "release/1.2.0/index.html"), "utf8");
    for (const a of ["u-watch-pod-bom", "u-system-test-plan", "s-work-order", "traceability"]) expect(html).toContain(`id="${a}"`);
    // work order operations, test ids and the basic test plan
    for (const t of ["OP 10", "Kit and inspect incoming parts", "Assemble the Watch mainboard", "Ordering checklist", "Kitting", "FAI-1", "Basic test plan (v0.1)", "Records to capture"]) expect(html).toContain(t);
  });

  it("the CLI refuses a project with check errors and writes nothing", async () => {
    write(dir, "src/watch.uhd.ts", SYSTEM.replace(`moduleDefId: "fixture-strap"`, `moduleDefId: "no-such-part"`));
    const r = spawnSync(process.execPath, [CLI, "release", "--version", "9.9.9", "--format", "json", "--cwd", dir], { encoding: "utf8", timeout: 120000 });
    write(dir, "src/watch.uhd.ts", SYSTEM);
    expect(r.status).toBe(1);
    const rec = JSON.parse(r.stdout);
    expect(rec.status).toBe("failed");
    expect(rec.data.diagnostics.map((d: { code: string }) => d.code)).toContain("REL_CHECK_ERRORS");
    expect(existsSync(join(dir, "release/9.9.9"))).toBe(false);
  });

  it("rebuilding the same release gives identical bytes", async () => {
    rmSync(join(dir, "release"), { recursive: true, force: true });
    const rec = await release();
    expect(rec.status).toBe("succeeded");
    const second = snapshot();
    expect(second.files).toEqual(first.files);
    expect(second.manifest).toBe(first.manifest);
    expect(second.digests).toEqual(first.digests);
  }, 180000);
});
