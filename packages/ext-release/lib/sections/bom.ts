/**
 * The bill-of-materials section (PK2): the unit's module breakdown as
 * bom.pdf and bom.csv, and for the root unit the whole product's ordering
 * list (ordering-list.csv) with its quantity rule and cost coverage.
 */
import { orderingCsv, orderingList, orderTotals, SPARE_DEFAULTS, unitBom, unitBomCsv, type OrderLine } from "../bom.ts";
import { readFx } from "@protoboardai/ext-sourcing/lib/cost.ts";
import type { Block, SectionContext, SectionContribution } from "../types.ts";
import { num } from "../util.ts";

const ACTION: Record<string, string> = { build: "build", fabricate: "make", buy: "buy", included: "included" };

export function sectionBom({ project: p, unit: u, units, release }: SectionContext): SectionContribution[] {
  const rows = unitBom(p, u);
  const indent = (level: number, text: string) => `${"· ".repeat(level)}${text}`;
  const breakdown: Block[] = [
    {
      kind: "paragraph",
      text: `One build of ${u.name}, in the order of its module tree (sub-assembly → board → components). Quantities are per build; ${u.kind === "root" ? "the product is built once per order" : `the product needs ${u.perProduct}`}. The same rows are in bom.csv, keyed by instance path.`,
    },
    {
      kind: "table",
      columns: [
        { key: "item", label: "Item" },
        { key: "qty", label: "Qty", align: "right" },
        { key: "action", label: "Make / buy" },
        { key: "mfr", label: "Manufacturer" },
        { key: "mpn", label: "MPN" },
        ...(rows.some((r) => r.value) ? [{ key: "value", label: "Value" }] : []),
        { key: "path", label: "Instance" },
      ],
      rows: rows.map((r) => ({ item: indent(r.level, r.item), qty: r.qty_per_unit, action: r.kind === "unit" ? "unit" : ACTION[r.action], mfr: r.manufacturer, mpn: r.mpn, value: r.value, path: r.path })),
      caption: "Module breakdown",
    },
  ];
  const out: SectionContribution[] = [{ blocks: breakdown, files: [{ path: "bom.csv", content: unitBomCsv(rows), role: "purchasing", description: "module breakdown of one build" }] }];
  if (u.kind !== "root") return out;

  const lines = orderingList(p, units, release.config);
  const fx = readFx(p.root).table;
  const t = orderTotals(lines, fx);
  const converted = [...new Set(lines.map((l) => l.supplier_currency).filter(Boolean))].sort();
  const blocks: Block[] = [
    {
      kind: "paragraph",
      text: `Everything to obtain for ${release.build} ${release.build === 1 ? "product" : "products"}, across all units, one line per part. The full list with suppliers, offers, alternates, lifecycle and sources is ordering-list.csv.`,
    },
    {
      kind: "figures",
      items: [
        { label: "Buy", value: String(t.buy), sub: `${t.priced} with a dated price` },
        { label: "Make", value: String(t.fabricate), sub: "custom parts and cables" },
        { label: "Included", value: String(t.included), sub: "ship with another part" },
        { label: "Cost (priced lines)", value: t.costText || "—", sub: [t.priced < t.buy ? `${t.buy - t.priced} bought line(s) unpriced` : "every bought line priced", t.costNote].filter(Boolean).join("; ") },
      ],
    },
    {
      kind: "table",
      columns: [
        { key: "item", label: "Item" },
        { key: "action", label: "Action" },
        { key: "needed", label: "Need", align: "right" },
        { key: "spares", label: "Spare", align: "right" },
        { key: "order", label: "Order", align: "right" },
        { key: "where", label: "Supplier / process" },
        { key: "price", label: "Unit price", align: "right" },
        { key: "life", label: "Lifecycle" },
      ],
      rows: groupLines(lines),
      caption: "Ordering list",
    },
    {
      kind: "note",
      level: "tip",
      text: `Order = need (per product × products) + spares, rounded up to whole packs and the offer's minimum order. Spares: ${SPARE_DEFAULTS.map((d) => `${d.why}: ${d.percent} %, at least ${d.min}`).join("; ")}; nothing else unless release.spares says so. Each bought line is quoted as the bill of materials quotes it: the offer chosen for it in the project (parts/bom.json), else the offer that costs least for the order among those the project holds. Every price is in US dollars${converted.length ? `; prices in ${converted.join(", ")} were converted at the rates of ${fx.date} (${fx.source}) and are marked` : ""}.`,
    },
  ];
  out.push({ title: "Ordering list", order: 10, blocks, files: [{ path: "ordering-list.csv", content: orderingCsv(lines), role: "purchasing", description: "whole-product ordering list" }] });
  return out;
}

function groupLines(lines: OrderLine[]) {
  const rows: (Record<string, string | number> | { group: string })[] = [];
  for (const [action, title] of [["fabricate", "Make"], ["buy", "Buy"], ["included", "Included with another part"]] as const) {
    const these = lines.filter((l) => l.action === action);
    if (!these.length) continue;
    rows.push({ group: title });
    for (const l of these)
      rows.push({
        item: `${l.item}${l.value ? `, ${l.value}` : ""}${l.mpn ? ` (${l.mpn})` : ""}`,
        action: l.action === "fabricate" ? "make" : l.action,
        needed: l.needed,
        spares: l.spares,
        order: l.packs ? `${l.order} (${l.packs} × ${l.pack_qty})` : l.order,
        where: l.action === "fabricate" ? l.process : l.action === "included" ? l.note : l.supplier || "no offer recorded",
        price: l.unit_price !== null ? `${num(l.unit_price, 4)} ${l.currency}${l.supplier_currency ? ` (from ${l.supplier_currency})` : ""}` : "",
        life: l.lifecycle,
      });
  }
  return rows;
}
