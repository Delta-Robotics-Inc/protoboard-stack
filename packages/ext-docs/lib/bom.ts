/**
 * The bill of materials the documents publish: the system tree walked
 * (children × quantity, through assemblies, groups and harnesses), one row
 * per part (per part and MPN for a series passive placed at several values,
 * from `ChildModuleRef.overrides`) with its primary manufacturer source and its verification
 * summary, so every line can be traced. Moved with the documents generator
 * from UHD's scripts/bom.ts; evidence comes from the project's evidence
 * folders (model.ts `evidenceDirs`). `tech-docs` writes it to
 * `docs/<system-id>-bom.json`, and `tech-docs-verify` checks it against the
 * live model. (The project's plain BOM export is ext-hardware's `bom`.)
 */
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import type { ModuleDef } from "@deltarobotics/uhd";
import type { ModuleLookup } from "@deltarobotics/uhd";
import { formatPassive, placementPart } from "@protoboardai/core";

export interface BomRow {
  line: number;
  partId: string;
  name: string;
  manufacturer?: string;
  partNumber?: string;
  /** A passive's value as placed, e.g. "4.7 kΩ ±1 %". */
  value?: string;
  quantity: number;
  /** Units per retail pack, when the part is sold in packs. */
  packQuantity?: number;
  buy: "purchase" | "included" | "fabricate";
  includedWith?: string;
  usedBy: string[];
  source?: string;
  verification?: string;
  assumptions: number;
  openGaps: number;
}

function trait(def: ModuleDef, type: string, key: string): unknown {
  for (const t of def.traits ?? []) {
    const params = t.params as Record<string, unknown> | undefined;
    if (t.type === type && params && key in params) return params[key];
  }
  return undefined;
}

function evidence(dirs: string[], def?: ModuleDef): { source?: string; verification?: string; assumptions: number; openGaps: number } {
  const find = (name: string) => dirs.map((d) => join(d, name)).find((f) => existsSync(f));
  // system-level hardware without a research folder cites its supplier listing in a usage_note
  let source: string | undefined = def?.traits?.find((t) => t.type === "usage_note" && typeof t.params?.source === "string")?.params?.source as string | undefined;
  const sources = find("sources.json");
  if (sources) {
    const rows = JSON.parse(readFileSync(sources, "utf8")) as Array<Record<string, unknown>>;
    source = String((rows.find((r) => r.authority === "manufacturer") ?? rows[0])?.url ?? "");
  }
  const verification = find("verification.json");
  if (!verification) {
    const count = (type: string) => def?.traits?.filter((t) => t.type === type).length ?? 0;
    return { source, assumptions: count("assumption"), openGaps: count("data_gap") };
  }
  const v = JSON.parse(readFileSync(verification, "utf8"));
  return {
    source,
    // older records state an audit without counts ({ by, result }); a self-audit
    // (PB-862: audit.independent false) is not shown as an audit
    verification: v.audit
      ? `${v.audit.independent === false ? "self-audited" : "audited"}${typeof v.audit.checked === "number" ? ` ${v.audit.confirmed}/${v.audit.checked}` : ""}`
      : "not audited",
    assumptions: v.assumptions?.length ?? 0,
    openGaps: v.data_gaps?.length ?? 0,
  };
}

/** `evidenceDirs(id)`: the folders that may hold a part's sources.json and verification.json. */
/** A module designed in the project: it carries its native design (an artifact with role "source"). */
export const designed = (def: ModuleDef) => (def.artifacts ?? []).some((a) => a.role === "source");

export function buildBom(system: ModuleDef, lookup: ModuleLookup, evidenceDirs: (id: string) => string[]): BomRow[] {
  const rows = new Map<string, BomRow>();

  const visit = (def: ModuleDef, multiplier: number, path: string) => {
    for (const ref of def.children ?? []) {
      const child = lookup(ref.moduleDefId);
      if (!child) throw new Error(`${path}/${ref.id}: unknown module ${ref.moduleDefId}`);
      const qty = multiplier * (ref.quantity ?? 1);
      const childPath = path ? `${path}/${ref.id}` : ref.id;
      if (child.children?.length) {
        // assemblies, groups and harness kits: their contents are the line items. A module designed in the project
        // (it has a native design: a board, a housing with its inserts) is made, so it is a line item too, with its parts
        if (designed(child)) add(child, ref, qty, childPath, "fabricate");
        visit(child, qty, childPath);
        continue;
      }
      add(child, ref, qty, childPath);
    }
  };
  const add = (child: ModuleDef, ref: { overrides?: Record<string, unknown> }, qty: number, childPath: string, buyAs?: BomRow["buy"]) => {
      const includedWith = trait(child, "usage_note", "included_with") as string | undefined;
      const custom = /\(custom\)/i.test(child.manufacturer ?? "");
      const placed = placementPart(child, ref.overrides);
      const value = placed.value ? formatPassive(placed.value) : undefined;
      const key = `${child.id}\u0000${placed.mpn ?? value ?? ""}`;
      const row = rows.get(key) ?? {
        line: 0,
        partId: child.id,
        name: child.name,
        manufacturer: child.manufacturer,
        partNumber: placed.mpn,
        ...(value ? { value } : {}),
        quantity: 0,
        packQuantity: trait(child, "performance", "pack_quantity") as number | undefined,
        buy: buyAs ?? (custom ? "fabricate" : includedWith ? "included" : "purchase"),
        includedWith,
        usedBy: [],
        ...evidence(evidenceDirs(child.id), child),
      };
      row.quantity += qty;
      row.usedBy.push(childPath);
      rows.set(key, row);
  };
  visit(system, 1, "");

  const order = { purchase: 0, fabricate: 1, included: 2 };
  return [...rows.values()]
    .sort((a, b) => order[a.buy] - order[b.buy] || a.name.localeCompare(b.name) || (a.partNumber ?? "").localeCompare(b.partNumber ?? ""))
    .map((row, i) => ({ ...row, line: i + 1 }));
}
