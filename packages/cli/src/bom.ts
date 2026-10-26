/**
 * `protoboard bom` (PB-904, PB-933): the project's bill of materials, the
 * structured model the BOM views draw (`@protoboardai/core/bom`): what one
 * unit needs, the offers the project holds, the offer chosen for each line,
 * what must be bought for N units (whole packs, minimum orders), and both
 * costs in dollars. Lines come from the design, or from a release's
 * ordering list with `--release`. Offline: it reads what the project holds
 * and fetches nothing.
 */
import { definitionTrust, formatPassive, placementPart, type Project } from "@protoboardai/core";
import { bomLines, formatUnitUsd, formatUsd, type Bom, type BomLine } from "@protoboardai/core/bom";
import { bomFileProblems, listReleases, projectBom as sharedBom, writeBomSettings, type CostIndex } from "@protoboardai/ext-sourcing/lib/cost.ts";

/** The bill's view of a loaded project. */
export function projectCostIndex(p: Project): CostIndex {
  const caps = new Map<string, { capability: string; provider: string }>();
  for (const b of p.capabilities) if (b.module && !b.problem && !caps.has(b.module)) caps.set(b.module, { capability: b.capability, provider: b.provider });
  const byPath = new Map(p.instances.map((i) => [i.path, i]));
  let trust: ReturnType<typeof definitionTrust> | undefined;
  return {
    instances: p.instances,
    definition: (id) => p.definitions.get(id)?.def as ReturnType<CostIndex["definition"]>,
    // a researched part's CAD config models a bought part; only the project's own designs are made
    capability: (id) => (p.definitions.get(id)?.origin.tier === "project-specific" ? caps.get(id) : undefined),
    placement: (path) => {
      const inst = byPath.get(path);
      const def = inst && p.lookup(inst.definition);
      if (!def) return undefined;
      const placed = placementPart(def, inst.overrides);
      return { ...(placed.mpn ? { mpn: placed.mpn } : {}), ...(placed.value ? { value: formatPassive(placed.value) } : {}) };
    },
    partStatus: (id) => (trust ??= definitionTrust(p))[id]?.trust,
  };
}

/** The bill, or why there is none. `release` takes the lines of that release's ordering list instead of the design. */
export function projectBom(p: Project, options: { release?: string; units?: number; now?: string } = {}): Bom {
  if (options.units !== undefined && !(Number.isInteger(options.units) && options.units > 0)) throw new Error("--units is a whole number, 1 or more");
  const problems = bomFileProblems(p.root);
  if (problems.length) throw new Error(problems.map((x) => `${x.file}: ${x.message}`).join("\n"));
  let release;
  if (options.release) {
    const all = listReleases(p.root);
    release = all.find((r) => r.version === options.release);
    if (!release) throw new Error(`no release ${options.release} in release/ (releases: ${all.map((r) => r.version).join(", ") || "none"})`);
    if (!release.hasOrderingList) throw new Error(`release ${options.release} has no ordering list (release/${options.release}/system/ordering-list.csv)`);
  }
  const bom = sharedBom(p.root, p.name, projectCostIndex(p), { ...(release ? { release } : {}), ...(options.units ? { units: options.units } : {}), ...(options.now ? { now: options.now } : {}) });
  if (!bom || !bom.counts.lines) throw new Error("nothing to list: the system has no parts yet");
  return bom;
}

/** The line a person names: its key, its definition id, or its ordering code. */
export function findLine(bom: Bom, name: string): BomLine {
  const lines = bomLines(bom);
  const hit = lines.filter((l) => l.key === name);
  const found = hit.length ? hit : lines.filter((l) => l.definition === name || (l.mpn && l.mpn.toLowerCase() === name.toLowerCase()));
  if (found.length === 1) return found[0];
  if (!found.length) throw new Error(`no line "${name}" in the bill of materials (lines: ${lines.map((l) => l.key).join(", ")})`);
  throw new Error(`"${name}" names ${found.length} lines; use one of: ${found.map((l) => l.key).join(", ")}`);
}

/** Choose a line's offer by its id or its supplier's name; `auto` goes back to the best offer by the rules. Writes parts/bom.json. */
export function chooseOffer(p: Project, lineName: string, offerName: string): { line: string; offer: string | null; supplier?: string } {
  const bom = projectBom(p);
  const line = findLine(bom, lineName);
  if (line.kind !== "buy") throw new Error(`${line.key} is ${line.kind === "make" ? "made, not bought" : "included with another part"}: it has no offers`);
  if (offerName === "auto") {
    writeBomSettings(p.root, { offer: { line: line.key, offer: null } });
    return { line: line.key, offer: null };
  }
  const byId = line.offers.filter((o) => o.id === offerName);
  const found = byId.length ? byId : line.offers.filter((o) => o.supplier.toLowerCase() === offerName.toLowerCase());
  if (!found.length) throw new Error(`${line.key} holds no offer "${offerName}" (offers: ${line.offers.map((o) => o.id).join(", ") || "none; fetch them with `protoboard parts offers`"})`);
  if (found.length > 1) throw new Error(`"${offerName}" names ${found.length} offers of ${line.key}; use an id: ${found.map((o) => o.id).join(", ")}`);
  writeBomSettings(p.root, { offer: { line: line.key, offer: found[0].id } });
  return { line: line.key, offer: found[0].id, supplier: found[0].supplier };
}

const day = (iso?: string) => (iso ? iso.slice(0, 10) : "");

/** The offers a line holds, best first, for the units the bill is priced at. */
export function formatOffers(bom: Bom, line: BomLine): string {
  const out = [`${line.item} (${line.key}) · ${line.quantity} per unit × ${bom.units} = ${line.needed} needed`];
  if (!line.offers.length) out.push("  no offers held (`protoboard parts offers` fetches the library's)");
  for (const q of line.quotes) {
    const o = line.offers.find((x) => x.id === q.offer)!;
    const price = q.unitPrice !== undefined ? `${formatUnitUsd(q.unitPrice)} × ${q.buy} = ${formatUsd(q.orderCost!)}` : q.problem === "no-rate" ? `no rate for ${o.currency}` : "no price";
    const marks = [
      q.offer === line.chosen ? (line.choice === "pinned" ? "chosen" : "used") : "",
      q.native ? `from ${q.native.unitPrice} ${q.native.currency}` : "",
      q.packSize > 1 ? `pack of ${q.packSize}` : "",
      q.minOrder > 1 ? `min ${q.minOrder}` : "",
      typeof o.stock === "number" ? `stock ${o.stock}` : "",
      q.stale ? "stale" : "",
      q.fit === "reel-over" ? "full reel" : "",
      day(o.observedAt),
    ].filter(Boolean);
    out.push(`  ${q.offer === line.chosen ? "▸" : " "} ${o.id.padEnd(44)} ${price.padEnd(30)} ${marks.join(" · ")}`);
  }
  return out.join("\n");
}

/** The bill as text: one block per module, both totals last. */
export function formatBom(t: Bom): string {
  const src = t.source.kind === "design" ? "the design" : t.source.kind === "release" ? `release ${t.source.version} (${t.source.file})` : t.source.file;
  const cols = (l: BomLine) => {
    const o = l.offers.find((x) => x.id === l.chosen);
    const q = l.quote;
    const right =
      l.status === "priced"
        ? `${formatUnitUsd(q!.unitPrice!).padStart(9)} ${formatUsd(l.perUnitCost!).padStart(10)} ${String(q!.buy).padStart(6)} ${formatUsd(l.orderCost!).padStart(11)}  ${o!.supplier}${l.choice === "pinned" ? " (chosen)" : ""}`
        : l.status === "make"
          ? "needs a quote"
          : l.status === "included"
            ? "included"
            : "unpriced";
    return `  ${l.item.slice(0, 38).padEnd(38)} ${(l.mpn || "—").slice(0, 18).padEnd(18)} ${String(l.quantity).padStart(4)} ${right}`;
  };
  const notable = (l: BomLine) => (l.status === "priced" || l.status === "unpriced" ? l.notes : []);
  const lines = [
    `Bill of materials · ${t.project} · ${src} · ${t.units} unit${t.units === 1 ? "" : "s"} · ${t.currency}`,
    "",
    `  ${"Part".padEnd(38)} ${"MPN".padEnd(18)} ${"Qty".padStart(4)} ${"Unit".padStart(9)} ${"Per unit".padStart(10)} ${"Buy".padStart(6)} ${"Order".padStart(11)}  Supplier`,
    ...t.groups.flatMap((g) => [
      "",
      `${g.name}${g.quantity > 1 ? ` ×${g.quantity}` : ""} (${g.lines.length} line${g.lines.length === 1 ? "" : "s"}${g.orderCost ? `, ${formatUsd(g.orderCost)}` : ""})`,
      ...g.lines.flatMap((l) => [cols(l), ...notable(l).map((n) => `      ${n}`)]),
    ]),
    "",
    t.counts.priced
      ? `Per unit:  ${formatUsd(t.totals.perUnit)}  (the parts one unit uses)`
      : "Per unit:  nothing priced",
    ...(t.counts.priced
      ? [`Order:     ${formatUsd(t.totals.order)}  for ${t.units} unit${t.units === 1 ? "" : "s"}${t.units > 1 ? ` (${formatUsd(t.totals.orderPerUnit)} each)` : ""}${t.totals.surplus > 0 ? `; ${formatUsd(t.totals.surplus)} of it buys pieces left over (packs and minimum orders)` : ""}`]
      : []),
    `Lines:     ${t.counts.priced} of ${t.counts.buy} bought line(s) priced, ${t.counts.unpriced} unpriced, ${t.counts.make} made (need a quote), ${t.counts.included} included${t.counts.stale ? `; ${t.counts.stale} stale price(s)` : ""}`,
    ...(t.fx.used.length
      ? [`Converted: ${t.counts.converted} line(s), with the ${t.fx.source}${t.fx.project ? " (parts/fx-rates.json)" : ""} of ${t.fx.date}: ${t.fx.used.map((u) => `1 ${u.currency} = ${u.rate} USD`).join(", ")}`]
      : []),
    ...(t.prices.newest ? [`Prices:    observed ${day(t.prices.oldest)}${day(t.prices.oldest) !== day(t.prices.newest) ? ` to ${day(t.prices.newest)}` : ""}${t.offersRetrievedAt ? `; the library's offers were fetched ${day(t.offersRetrievedAt)}` : ""}. Tax and shipping are not included.`] : []),
    ...(t.unknownChoices.length ? [`Note:      parts/bom.json chooses offers for lines the bill no longer has: ${t.unknownChoices.join(", ")}`] : []),
  ];
  return lines.join("\n");
}
