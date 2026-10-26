/**
 * Bills of materials by unit and the whole-product ordering list (PK2,
 * release-package-and-evals.md §2 "Bill of materials").
 *
 * Unit BOM: the unit's module breakdown in tree order (sub-assembly → board →
 * components), one row per instance, quantities per build of the unit. A
 * board's components are its UHD children; the circuit provider's `bom.csv`
 * (keyed by UHD instance path) is merged in by that key for value, package
 * and MPN where the model does not state them. A series passive's value and
 * MPN are the placement's (`ChildModuleRef.overrides`, resolved by UHD's
 * `passiveInstance`), not the definition's default.
 *
 * Ordering list (root unit only): every item to obtain for the whole
 * product, one line per definition, or per definition and MPN for a series
 * passive placed at several values. The quantity rule:
 *
 *   needed = quantity per product × release.build
 *   spares = max(ceil(needed × percent / 100), min) by the first matching rule:
 *            release.spares[definition id], release.spares[tag or category],
 *            then the defaults (SPARE_DEFAULTS): mechanical hardware 10 %, at
 *            least 2 (small parts are lost at the bench); components placed on
 *            a board 5 %, at least 2 (placement attrition); everything else 0.
 *   order  = needed + spares, rounded up to whole packs (the offer's own,
 *            else the pack_quantity the model states) and to the chosen
 *            offer's minimum order quantity; more where a later price break
 *            makes more pieces cost less in all.
 *
 * A bought line is quoted the way the bill of materials quotes it
 * (docs/specs/bom.md; ext-sourcing `quoteHeldLines`): the offers the project
 * holds, the offer a person chose for the line in parts/bom.json, else the
 * best by the bill's rules; every price in US dollars, an offer in another
 * currency converted with the project's dated rate table and marked
 * (`supplier_unit_price`, `supplier_currency`, `fx_rate`, `fx_date`). The
 * only difference from the bill is the quantity: a release adds spares.
 *
 * Parts that ship with another part (`usage_note` with `included_with`) are
 * listed with order 0. Custom parts (a capability provider designs them) and
 * cables not included with a part are fabrication lines; boards are
 * fabrication lines and their components are bought.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { overridableKeys, type ModuleDef } from "@deltarobotics/uhd";
import { boardChildRole, boardOptions, formatPassive, parseCsv, placementPart, revisionLabel, type BoardChildRole, type CapabilityBinding, type Instance, type Project, type ReleaseConfig } from "@protoboardai/core";
import { DEFAULT_FX, fxRate, type FxTable } from "@protoboardai/core/fx";
import { bomLineKey, quoteHeldLines, type HeldLine } from "@protoboardai/ext-sourcing/lib/cost.ts";
import { isCable } from "./cutlist.ts";
import { unitOfInstance } from "./units.ts";
import { readOffersFile, sourcingFor, type OffersFile } from "./offers.ts";
import type { Unit } from "./types.ts";
import { byCode, num, toCsv } from "./util.ts";

export const SPARE_DEFAULTS: { match: string; percent: number; min: number; why: string }[] = [
  { match: "hardware", percent: 10, min: 2, why: "mechanical hardware: small parts are lost at the bench" },
  { match: "board-component", percent: 5, min: 2, why: "components placed on a board: placement attrition" },
];

export type ItemKind = "unit" | "assembly" | "kit" | "board" | "group" | "component" | "custom" | "cable" | "part";
export type Action = "build" | "fabricate" | "buy" | "included";

export interface UnitBomRow {
  level: number;
  path: string;
  item: string;
  definition: string;
  kind: ItemKind;
  action: Action;
  manufacturer: string;
  mpn: string;
  value: string;
  package: string;
  qty_per_unit: number;
  qty_per_product: number;
  tier: string;
  origin: string;
  note: string;
}

export const UNIT_BOM_COLUMNS = ["level", "path", "item", "definition", "kind", "action", "manufacturer", "mpn", "value", "package", "qty_per_unit", "qty_per_product", "tier", "origin", "note"];

export interface OrderLine {
  line: number;
  definition: string;
  item: string;
  manufacturer: string;
  mpn: string;
  /** A passive's value as placed, e.g. "4.7 kΩ ±1 %". */
  value: string;
  action: Exclude<Action, "build">;
  process: string;
  qty_per_product: number;
  build: number;
  needed: number;
  spares: number;
  spares_rule: string;
  order: number;
  pack_qty: number | null;
  packs: number | null;
  moq: number | null;
  supplier: string;
  supplier_sku: string;
  /** Per piece, in US dollars. */
  unit_price: number | null;
  /** "USD" on a priced line: an ordering list is in one currency. */
  currency: string;
  /** order × unit_price, in US dollars. */
  extended: number | null;
  /** The price as the supplier states it, when it was converted. */
  supplier_unit_price: number | null;
  supplier_currency: string;
  /** Dollars per unit of the supplier's currency, and the date of the rate table. */
  fx_rate: number | null;
  fx_date: string;
  stock: number | null;
  lead_time_weeks: number | null;
  offer_as_of: string;
  offer_source: string;
  offer_url: string;
  /** What to know about the quote: converted, a stale price, a full reel, chosen by a person in the bill, raised to a price break, or no offer that fits (a reel for fewer than a reel). */
  offer_flag: string;
  /** Full reels held but not quoted. */
  offer_alternatives: string;
  alternates: string;
  lifecycle: string;
  lifecycle_source: string;
  tier: string;
  origin: string;
  units: string;
  note: string;
}

export const ORDER_COLUMNS = [
  "line", "definition", "item", "manufacturer", "mpn", "value", "action", "process", "qty_per_product", "build", "needed", "spares", "spares_rule", "order", "pack_qty", "packs", "moq",
  "supplier", "supplier_sku", "unit_price", "currency", "extended", "supplier_unit_price", "supplier_currency", "fx_rate", "fx_date", "stock", "lead_time_weeks", "offer_as_of", "offer_source", "offer_url", "offer_flag", "offer_alternatives", "alternates", "lifecycle", "lifecycle_source", "tier", "origin", "units", "note",
];

const params = (def: ModuleDef) => (def.traits ?? []).map((t) => (t.params ?? {}) as Record<string, unknown>);
/** The part this one ships with, when the model says so. */
export const includedWith = (def: ModuleDef) => params(def).find((x) => typeof x.included_with === "string")?.included_with as string | undefined;
const isHardware = (def: ModuleDef) => (def.categories ?? []).includes("hardware") || (def.tags ?? []).includes("fastener");

export function originLabel(p: Project, id: string): { tier: string; origin: string } {
  const rec = p.definitions.get(id);
  if (!rec) return { tier: "", origin: "" };
  const o = rec.origin;
  return { tier: o.tier, origin: o.kind === "catalog" ? `catalog ${o.provider ?? ""}@${revisionLabel(o.revision) ?? o.version ?? "?"}`.trim() : `${o.source.file}${o.source.line ? `:${o.source.line}` : ""}` };
}

interface Classified {
  kind: ItemKind;
  action: Action;
  process: string;
  binding?: CapabilityBinding;
}

/** What an instance of `def` is in a BOM. `onBoard`: a direct child of a circuit-bound board. */
export function classify(p: Project, def: ModuleDef, opts: { onBoard?: boolean; unit?: boolean } = {}): Classified {
  if (opts.unit) return { kind: "unit", action: "build", process: "" };
  const binding = p.capabilities.find((b) => b.module === def.id && !b.problem);
  if (binding?.capability === "circuit") return { kind: "board", action: "fabricate", process: "PCB fabrication and assembly", binding };
  const incl = includedWith(def);
  if (isCable(def)) return { kind: "cable", action: incl ? "included" : "fabricate", process: incl ? "" : "cable assembly", ...(binding ? { binding } : {}) };
  if (def.children?.length) return { kind: def.kind === "harness" ? "kit" : "assembly", action: "build", process: "" };
  // a purchased part researched in the project (parts/local) has its body drawn through a cad provider, but it
  // is bought (or ships with another part), not made: its CAD is a model of the part, not a fabrication file
  if (binding && p.definitions.get(def.id)?.origin.tier === "project-researched") return { kind: "part", action: incl ? "included" : "buy", process: "" };
  if (binding) return { kind: "custom", action: "fabricate", process: binding.process ? `${binding.process} (${binding.provider.replace(/^@[^/]+\//, "")})` : "custom part", binding };
  if (opts.onBoard) return { kind: "component", action: incl ? "included" : "buy", process: "" };
  return { kind: "part", action: incl ? "included" : "buy", process: "" };
}

/** What an instance is in its parent's board reading (core boardChildRole), when its parent is a board or a sub-module on one. */
function roleInParent(p: Project, inst: Instance, byPath: Map<string, Instance>): BoardChildRole | undefined {
  const parent = inst.parent !== undefined ? byPath.get(inst.parent) : undefined;
  const parentDef = parent ? p.lookup(parent.definition) : undefined;
  const def = p.lookup(inst.definition);
  const ref = parentDef?.children?.find((c) => c.id === inst.path.split("/").pop());
  return def && parentDef && ref ? boardChildRole(def, ref, parentDef, p.lookup, boardOptions(p)) : undefined;
}

/**
 * The circuit-bound board an instance sits on, through the sub-modules expanded onto it
 * (docs/specs/nested-boards.md §10), and its path below that board (the key of the provider's bom.csv).
 * Undefined for an instance not on a board, or on a boundary (a daughterboard, a child board).
 */
export function boardPlacement(p: Project, path: string): { binding: CapabilityBinding; rel: string; role: BoardChildRole } | undefined {
  const byPath = new Map(p.instances.map((i) => [i.path, i]));
  const self = byPath.get(path);
  if (!self) return undefined;
  const role = roleInParent(p, self, byPath);
  let cur = self;
  const segs: string[] = [];
  while (cur.parent !== undefined) {
    segs.unshift(cur.path.split("/").pop()!);
    const parent = byPath.get(cur.parent);
    const parentDef = parent ? p.lookup(parent.definition) : undefined;
    if (!parent || !parentDef) return undefined;
    const binding = p.capabilities.find((b) => b.module === parentDef.id && b.capability === "circuit" && !b.problem);
    if (binding) return role && role !== "harness" && role !== "board" && role !== "mated" ? { binding, rel: segs.join("/"), role } : undefined;
    // keep walking only through a sub-module expanded onto its own parent
    if (roleInParent(p, parent, byPath) !== "submodule") return undefined;
    cur = parent;
  }
  return undefined;
}

/** A circuit provider's bom.csv rows by instance (relative to the board). */
function boardBom(p: Project, b: CapabilityBinding): Map<string, Record<string, string>> {
  const f = join(p.root, b.out, "bom.csv");
  if (!existsSync(f)) return new Map();
  const [header = [], ...rows] = parseCsv(readFileSync(f, "utf8")).rows;
  return new Map(rows.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""]))).map((r) => [r.instance, r]));
}

const pick = (row: Record<string, string> | undefined, ...keys: string[]) => keys.map((k) => row?.[k]).find((v) => v) ?? "";

/** One unit's module breakdown. */
export function unitBom(p: Project, unit: Unit): UnitBomRow[] {
  const rows: UnitBomRow[] = [];
  const byPath = new Map(p.instances.map((i) => [i.path, i]));
  const boards = new Map<string, Map<string, Record<string, string>>>();
  for (const m of unit.members) {
    const def = p.lookup(m.definition);
    if (!def) continue;
    // on a board, directly or inside its sub-modules (docs/specs/nested-boards.md §10)
    const placed_ = m.unit ? undefined : boardPlacement(p, m.instance);
    const parentBinding = placed_?.binding;
    const group = placed_?.role === "submodule";
    const c: Classified = group ? { kind: "group", action: "build", process: "" } : classify(p, def, { onBoard: !!parentBinding, unit: !!m.unit });
    let provider: Record<string, string> | undefined;
    if (parentBinding && !group) {
      if (!boards.has(parentBinding.module!)) boards.set(parentBinding.module!, boardBom(p, parentBinding));
      provider = boards.get(parentBinding.module!)!.get(placed_!.rel);
    }
    const incl = includedWith(def);
    const placed = placementPart(def, byPath.get(m.instance)?.overrides);
    rows.push({
      level: m.depth,
      path: m.path,
      item: m.name,
      definition: def.id,
      kind: c.kind,
      action: c.action,
      manufacturer: def.manufacturer ?? pick(provider, "manufacturer"),
      mpn: placed.mpn ?? pick(provider, "mpn", "manufacturer_part_number", "mfr_part_number"),
      value: placed.value ? formatPassive(placed.value) : pick(provider, "value"),
      package: pick(provider, "package"),
      qty_per_unit: m.quantity,
      qty_per_product: m.quantity * unit.perProduct,
      ...originLabel(p, def.id),
      note: m.unit ? `built as unit ${m.unit} (units/${m.unit}/)` : group ? `a group of ${parentBinding!.module}'s components, placed with the board` : incl ? `included with ${incl}` : c.action === "fabricate" ? c.process : "",
    });
  }
  return rows;
}

export const unitBomCsv = (rows: UnitBomRow[]) => toCsv(UNIT_BOM_COLUMNS, rows as unknown as Record<string, unknown>[]);

function spareRule(def: ModuleDef, onBoard: boolean, config: ReleaseConfig): { percent: number; min: number; rule: string } {
  const own = config.spares ?? {};
  if (own[def.id]) return { percent: own[def.id].percent ?? 0, min: own[def.id].min ?? 0, rule: `release.spares.${def.id}` };
  for (const k of [...(def.tags ?? []), ...(def.categories ?? [])]) if (own[k]) return { percent: own[k].percent ?? 0, min: own[k].min ?? 0, rule: `release.spares.${k}` };
  if (onBoard && own["board-component"]) return { percent: own["board-component"].percent ?? 0, min: own["board-component"].min ?? 0, rule: "release.spares.board-component" };
  const d = isHardware(def) ? SPARE_DEFAULTS[0] : onBoard ? SPARE_DEFAULTS[1] : undefined;
  return d ? { percent: d.percent, min: d.min, rule: `default ${d.match} ${d.percent} %, min ${d.min}` } : { percent: 0, min: 0, rule: "none" };
}

/**
 * The whole-product ordering list. Quantities come from the instance tree
 * (each instance's quantity multiplied through its ancestors), so they do not
 * depend on how the package is split into units; `units` names the units
 * that consume each line.
 */
export function orderingList(p: Project, units: Unit[], config: ReleaseConfig, offers: OffersFile | undefined = readOffersFile(p.root)): OrderLine[] {
  const build = config.build ?? 1;
  const byPath = new Map(p.instances.map((i) => [i.path, i]));
  const total = (path: string): number => (path === "" ? 1 : (byPath.get(path)?.quantity ?? 1) * total(byPath.get(path)?.parent ?? ""));
  const lines = new Map<string, { def: ModuleDef; c: Classified; qty: number; onBoard: boolean; units: Set<string>; mpn: string; value: string }>();
  for (const inst of p.instances) {
    if (inst.path === "") continue;
    const def = p.lookup(inst.definition);
    if (!def) continue;
    const placedOn = boardPlacement(p, inst.path);
    if (placedOn?.role === "submodule") continue; // a group on a board: its parts are the lines
    const onBoard = !!placedOn;
    const c = classify(p, def, { onBoard });
    if (c.action === "build") continue; // assemblies and kits: their contents are the lines
    const { mpn, value } = placementOf(def, inst);
    const key = `${def.id}\u0000${mpn || value}`;
    const line = lines.get(key) ?? { def, c, qty: 0, onBoard, units: new Set<string>(), mpn, value };
    line.qty += total(inst.path);
    line.units.add(unitOfInstance(units, inst.path)?.id ?? "system");
    lines.set(key, line);
  }
  const sorted = [...lines.values()].sort((a, b) => order(a.c.action) - order(b.c.action) || byCode(a.def.id, b.def.id) || byCode(a.mpn, b.mpn));
  // first the quantities, then every bought line quoted at once, the way the bill of materials quotes
  const rows = sorted.map((l) => {
    const needed = l.qty * build;
    const included = l.c.action === "included";
    const rule = included ? { percent: 0, min: 0, rule: "included" } : spareRule(l.def, l.onBoard, config);
    const spares = included ? 0 : Math.max(Math.ceil((needed * rule.percent) / 100), rule.min);
    const s = sourcingFor(p, l.def, offers, overridableKeys(l.def).length ? l.mpn : undefined);
    const key = bomLineKey(l.def.id, l.mpn || (l.def.part_number ?? ""), l.def.part_number);
    return { ...l, needed, included, rule, spares, s, key };
  });
  const quoted = quoteHeldLines(
    p.root,
    rows
      .filter((r) => r.c.action === "buy")
      .map((r): HeldLine => ({ key: r.key, definition: r.def.id, item: r.def.name ?? r.def.id, manufacturer: r.def.manufacturer ?? "", mpn: r.mpn || (r.def.part_number ?? ""), pieces: r.needed + r.spares, ...(r.s.packQuantity ? { packQuantity: r.s.packQuantity } : {}), ...(overridableKeys(r.def).length ? { exact: true } : {}) })),
  );
  const fx = quoted.bom.fx;
  const usd = (v: number) => `${v.toFixed(2)} USD`;
  const out: OrderLine[] = [];
  for (const { def, c, qty, units: used, mpn, value, needed, included, rule, spares, s, key } of rows) {
    const line = c.action === "buy" ? quoted.line(key) : undefined;
    const q = line?.status === "priced" ? line.quote : undefined;
    const offer = q ? line!.offers.find((o) => o.id === q.offer) : undefined;
    // without a price, the quantity is the need and its spares in the model's packs
    let orderQty = included ? 0 : needed + spares;
    let pack = s.packQuantity ?? null;
    let packs = pack && !included ? Math.ceil(orderQty / pack) : null;
    if (packs !== null) orderQty = packs * pack!;
    if (q) {
      orderQty = q.buy;
      pack = q.packSize > 1 ? q.packSize : null;
      packs = pack ? q.packs : null;
    }
    const reels = (line?.quotes ?? []).filter((x) => x !== q && x.orderCost !== undefined && (x.fit === "reel" || x.fit === "reel-over"));
    const supplierOf = (id: string) => line!.offers.find((o) => o.id === id)!.supplier;
    const unfit = !q && reels.length ? `no offer fits ${needed + spares}: ${supplierOf(reels[0].offer)} sells only a full reel of ${reels[0].buy} (${usd(reels[0].orderCost!)}); not quoted` : "";
    const flag = q
      ? [
          line!.choice === "pinned" ? "chosen in the bill of materials (parts/bom.json)" : "",
          q.native ? `converted from ${q.native.currency} at ${q.native.rate} (${fx.date})` : "",
          q.stale ? (q.ageDays !== undefined ? `price is ${q.ageDays} days old` : "the library marks this price as stale") : "",
          q.fit === "reel" || q.fit === "reel-over" ? "a full reel" : "",
          q.raised ? `raised from ${q.raised.from} to the price break: ${q.raised.from} would cost ${usd(q.raised.fromCost)}` : "",
          q.covers === false ? `${offer!.supplier} showed ${offer!.stock ?? 0} in stock` : "",
        ]
          .filter(Boolean)
          .join("; ")
      : unfit || (line?.offers.length ? line.notes.join("; ") : "");
    const rec = s.record;
    out.push({
      line: out.length + 1,
      definition: def.id,
      item: def.name ?? def.id,
      manufacturer: def.manufacturer ?? "",
      mpn,
      value,
      action: c.action as OrderLine["action"],
      process: c.process,
      qty_per_product: qty,
      build,
      needed,
      spares,
      spares_rule: rule.rule,
      order: orderQty,
      pack_qty: pack,
      packs,
      moq: offer?.minOrder ?? null,
      supplier: offer?.supplier ?? (!included && c.action === "buy" ? (s.listing?.supplier ?? "") : ""),
      supplier_sku: offer?.sku ?? "",
      unit_price: q?.unitPrice ?? null,
      currency: q ? quoted.bom.currency : "",
      extended: q?.orderCost ?? null,
      supplier_unit_price: q?.native?.unitPrice ?? null,
      supplier_currency: q?.native?.currency ?? "",
      fx_rate: q?.native?.rate ?? null,
      fx_date: q?.native ? fx.date : "",
      stock: offer?.stock ?? null,
      lead_time_weeks: offer?.leadTimeWeeks ?? null,
      offer_as_of: offer?.observedAt ?? "",
      offer_source: offer ? (offer.origin === "library" ? `catalog offers (${offerFileLabel(offers)})` : offer.file) : s.listing && c.action === "buy" ? "model: supplier listing (no price)" : "",
      offer_url: offer?.url ?? (c.action === "buy" ? (s.listing?.url ?? "") : ""),
      offer_flag: flag,
      offer_alternatives: reels.map((x) => `${supplierOf(x.offer)}: full reel ${x.buy} × ${x.unitPrice} USD = ${usd(x.orderCost!)}`).join("; "),
      alternates: (rec?.alternates ?? []).filter((a) => a.relation !== "near-miss").map((a) => `${a.manufacturer} ${a.mpn} (${a.relation})`).join("; "),
      lifecycle: rec?.lifecycle?.status ?? "",
      lifecycle_source: rec?.lifecycle ? `${rec.lifecycle.source} (${rec.lifecycle.as_of})` : "",
      ...originLabel(p, def.id),
      units: [...used].sort(byCode).join(" "),
      note: included
        ? `included with ${includedWith(def)}`
        : c.action === "buy" && !q
          ? flag || (s.listing ? "no dated offer recorded; listing only" : "no offer recorded (ext-sourcing supplier-compare, or protoboard parts offers)")
          : "",
    });
  }
  return out;
}

/** The MPN and value of one placement (a series passive's come from its overrides). */
function placementOf(def: ModuleDef, inst: Instance): { mpn: string; value: string } {
  const placed = placementPart(def, inst.overrides);
  return { mpn: placed.mpn ?? "", value: placed.value ? formatPassive(placed.value) : "" };
}

const order = (a: Action) => ({ fabricate: 0, buy: 1, included: 2, build: 3 })[a];
const offerFileLabel = (f?: OffersFile) => (f ? `parts/offers.json${f.retrievedAt ? `, ${f.retrievedAt.slice(0, 10)}` : ""}` : "");

/** The headline cost and the note under it. `converted`: the supplier currencies of lines already converted to dollars. */
function costIn(cost: Record<string, number>, fx: FxTable, converted: string[] = []): { costText: string; costNote: string } {
  const each = Object.entries(cost).map(([c, v]) => `${num(v)} ${c}`).join(" + ");
  const currencies = Object.keys(cost);
  if (!currencies.length || (currencies.length === 1 && currencies[0] === "USD"))
    return { costText: each, costNote: converted.length ? `prices in ${[...new Set(converted)].sort().join(", ")} converted at the rates of ${fx.date} (${fx.source})` : "" };
  const rates = currencies.map((c) => fxRate(c, "USD", fx));
  if (rates.some((r) => r === undefined)) return { costText: each, costNote: "no rate for every currency: not totalled" };
  const usd = currencies.reduce((s, c, i) => s + cost[c] * rates[i]!, 0);
  return { costText: `${num(Number(usd.toFixed(2)))} USD`, costNote: `${each}, converted at the rates of ${fx.date} (${fx.source})` };
}

export const orderingCsv = (lines: OrderLine[]) => toCsv(ORDER_COLUMNS, lines as unknown as Record<string, unknown>[]);

/**
 * Totals for the overview: pieces, priced coverage, and the cost. The
 * ordering list quotes every line in US dollars (PB-933), so the total is
 * their sum; the note names the currencies that were converted and the
 * rate table's date (`fx`: the project's parts/fx-rates.json, else core's).
 * Lines in another currency (an ordering list written before that) are
 * converted here, with the sums per currency kept beside the total; without
 * a rate for one of them there is no single total, and the sums stand alone.
 */
export function orderTotals(lines: OrderLine[], fx: FxTable = DEFAULT_FX) {
  const buy = lines.filter((l) => l.action === "buy");
  const cost: Record<string, number> = {};
  // summed, then rounded to cents once: rounding each running total would add up the lines' fractions of a cent
  for (const l of buy) if (l.extended !== null && l.currency) cost[l.currency] = (cost[l.currency] ?? 0) + l.extended;
  for (const c of Object.keys(cost)) cost[c] = Number(cost[c].toFixed(2));
  const leads = buy.map((l) => l.lead_time_weeks).filter((x): x is number => typeof x === "number");
  return {
    lines: lines.length,
    buy: buy.length,
    fabricate: lines.filter((l) => l.action === "fabricate").length,
    included: lines.filter((l) => l.action === "included").length,
    pieces: lines.reduce((s, l) => s + l.needed, 0),
    priced: buy.filter((l) => l.extended !== null).length,
    cost,
    ...costIn(cost, fx, buy.filter((l) => l.extended !== null && l.supplier_currency).map((l) => l.supplier_currency)),
    leadTimeWeeks: leads.length ? Math.max(...leads) : null,
  };
}
