/**
 * Offer comparison for the project's sourcing records.
 *
 *   npx tsx <this file> [part-id ...] [--qty <n>] [--json]
 *
 * For each `parts/evidence/<id>/sourcing.json`: the offers at the needed
 * quantity (record `need.quantity`, or --qty) in the order a quote takes
 * them (cut tape or a fitting minimum order before a full reel, the
 * project's currency before others, then cheapest extended cost; currencies
 * are never converted), whether stated stock
 * covers the quantity, and the record's issues from the same rules as the
 * `sourcing` check. Reads files only; it never contacts a supplier.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { loadProject } from "@protoboardai/core";
import { compareOffers, DEFAULT_QUOTE_CURRENCY, validateSourcing, type SourcingRecord } from "@protoboardai/ext-sourcing/lib/sourcing.ts";

const args = process.argv.slice(2);
const json = args.includes("--json");
const qi = args.indexOf("--qty");
const qty = qi >= 0 ? Number(args[qi + 1]) : undefined;
const only = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--qty");
const p = await loadProject(process.cwd(), { checks: false, extensions: false });
const currency = p.config.currency ?? DEFAULT_QUOTE_CURRENCY;

const root = join(p.root, "parts", "evidence");
const ids = existsSync(root)
  ? readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory() && existsSync(join(root, d.name, "sourcing.json")) && (!only.length || only.includes(d.name)))
      .map((d) => d.name)
      .sort()
  : [];

const report = ids.map((id) => {
  let record: SourcingRecord;
  try {
    record = JSON.parse(readFileSync(join(root, id, "sourcing.json"), "utf8"));
  } catch (e) {
    return { part: id, mpn: null, manufacturer: null, quantity: qty ?? null, lifecycle: null, offers: [], alternates: [], issues: [{ code: "SRC_RECORD_INVALID", severity: "error", message: (e as Error).message }] };
  }
  const issues = validateSourcing(record, { knownPart: (x) => p.definitions.has(x) });
  const quantity = qty ?? record.need?.quantity ?? 1;
  const usable = Array.isArray(record.offers);
  return { part: id, mpn: record.mpn, manufacturer: record.manufacturer, quantity, lifecycle: record.lifecycle?.status ?? null, offers: usable ? compareOffers(record, quantity, { currency }) : [], alternates: Array.isArray(record.alternates) ? record.alternates : [], issues };
});

if (json) process.stdout.write(JSON.stringify(report, null, 2) + "\n");
else if (!report.length) process.stdout.write(`no sourcing records under parts/evidence/${only.length ? ` for ${only.join(", ")}` : ""}\n`);
else
  for (const r of report) {
    process.stdout.write(`\n${r.part}  ${r.manufacturer ?? "?"} ${r.mpn ?? "?"}  ×${r.quantity ?? "?"}  lifecycle ${r.lifecycle ?? "not recorded"}\n`);
    for (const o of r.offers) {
      const price = o.unit_price === undefined ? "no price breaks".padEnd(28) : `${o.currency} ${o.unit_price} × ${o.buy} = ${o.extended}`.padEnd(28);
      const stock = o.stock === null ? "stock ?" : `stock ${o.stock}${o.covers ? "" : " (short)"}`;
      process.stdout.write(`  ${o.supplier.padEnd(16)} ${(o.market ?? "").padEnd(3)} ${price} ${stock.padEnd(18)} ${o.via}@${o.as_of.slice(0, 10) || "undated"}${o.authorized === false ? "  non-authorized" : ""}${o.mpn_matches ? "" : `  other MPN ${o.mpn}, ranked last`}${o.fit === "reel-over" ? "  full reel only, not quoted" : o.fit === "reel" ? "  full reel" : ""}${o.in_currency ? "" : `  not ${currency}`}\n`);
    }
    for (const a of r.alternates) process.stdout.write(`  alt ${String(a.relation).padEnd(17)} ${a.manufacturer} ${a.mpn}: ${a.lost_because ?? a.differences}\n`);
    for (const i of r.issues) process.stdout.write(`  ${i.severity.toUpperCase().padEnd(7)} ${i.code}  ${i.message}\n`);
  }
