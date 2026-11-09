/**
 * The KiCad cross-check: our counts beside KiCad's by category, with matched and unmatched items by location. It
 * never hides a difference: every KiCad item we did not match and every finding of ours KiCad did not report is
 * listed, and every KiCad category we do not check is listed with its count.
 *
 * Coordinates: KiCad reports millimeters with +Y down from its page origin; the board document is nanometers with
 * +Y up. `x = kx * 1e6 + tx`, `y = -ky * 1e6 + ty`. The importer may state `tx, ty`; otherwise
 * `estimateTransform` finds them from footprint positions (the median offset over footprints matched by
 * reference). Without a transform, items are compared by count only and the result says so.
 */
import { byCodeUnit, recordsOfKind, toMm, type BoardDocument, type Finding } from "@protoboardai/board";
import { CHECKS } from "../checks.js";
import type { BoardCheckResult } from "../run.js";
import type { KicadDrcReport, KicadViolation } from "./drc.js";
import { readKicadPlacements } from "./sexpr.js";

/** Which of our checks a KiCad violation type corresponds to. Types not listed have no counterpart here. */
export const KICAD_CATEGORY: Record<string, string> = {
  unconnected_items: "unconnected",
  shorting_items: "short",
  clearance: "clearance",
  track_width: "track_width",
  via_diameter: "via_diameter",
  drill_out_of_range: "via_hole",
  annular_width: "annular_ring",
  hole_clearance: "hole_clearance",
  hole_to_hole: "hole_to_hole",
  drilled_holes_too_close: "hole_to_hole",
  holes_co_located: "hole_to_hole",
  copper_edge_clearance: "edge_clearance",
  courtyards_overlap: "courtyard_overlap",
  silk_over_copper: "silk_to_pad",
  track_dangling: "dangling",
  via_dangling: "dangling",
  isolated_copper: "isolated_copper",
  items_not_allowed: "keepout",
};

/** How each category's numbers differ by construction (stated beside the counts so a difference can be read). */
export const CATEGORY_NOTES: Record<string, string> = {
  unconnected: "both count missing links of a minimum spanning tree per net; KiCad's zone fill comes from the file, ours from the fill given",
  via_hole: "KiCad's drill_out_of_range covers pad holes too; ours covers vias only",
  silk_to_pad: "KiCad tests silkscreen against solder mask openings and real text strokes; ours against pad copper, with text as boxes",
  dangling: "KiCad's track_dangling and via_dangling together",
  unassigned_copper: "KiCad has no direct counterpart",
  via_in_pad: "a policy check; KiCad has no direct counterpart",
  via_under_footprint: "a policy check; KiCad has no direct counterpart",
};

/** A finding this close to its limit (nm) is borderline: within rounding of KiCad's own geometry. */
export const BORDERLINE_NM = 1000;

export interface KicadTransform {
  tx: number;
  ty: number;
  /** How it was found. */
  source: "given" | "footprints";
  /** Footprints used for the estimate, and the largest disagreement among them (nm). */
  matched?: number;
  spread?: number;
}

/** The transform from KiCad's frame to the document's, from footprint positions matched by reference. */
export function estimateTransform(doc: BoardDocument, kicadPcbText: string): KicadTransform | undefined {
  const ours = new Map(recordsOfKind(doc, "footprint").map((f) => [f.ref, f]));
  const dx: number[] = [];
  const dy: number[] = [];
  for (const p of readKicadPlacements(kicadPcbText)) {
    const f = ours.get(p.ref);
    if (!f) continue;
    dx.push(f.x - p.x * 1e6);
    dy.push(f.y + p.y * 1e6);
  }
  if (!dx.length) return undefined;
  const med = (v: number[]) => {
    const s = [...v].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  };
  const tx = med(dx);
  const ty = med(dy);
  let spread = 0;
  for (let i = 0; i < dx.length; i++) spread = Math.max(spread, Math.hypot(dx[i] - tx, dy[i] - ty));
  return { tx, ty, source: "footprints", matched: dx.length, spread: Math.round(spread) };
}

export interface KicadEntry {
  category: string;
  /** KiCad's violation type. */
  type: string;
  severity: string;
  description?: string;
  /** Item positions in board coordinates (nm), when a transform is known. */
  points: { x: number; y: number; description?: string }[];
  /** For unconnected items: the net named in KiCad's item descriptions. */
  net?: string;
}

export interface CategoryRow {
  category: string;
  /** Our counts, or null when we do not check this category. */
  ours: { errors: number; warnings: number } | null;
  /** KiCad's counts, or null when KiCad has no counterpart. */
  kicad: { errors: number; warnings: number; excluded: number } | null;
  /** KiCad types in this row. */
  kicadTypes: string[];
  matched: number;
  oursOnly: number;
  kicadOnly: number;
  note?: string;
}

export interface CrossCheck {
  ran: true;
  kicad: { version?: string; command?: string; durationMs?: number };
  transform?: KicadTransform;
  totals: { ours: { unconnected: number; errors: number; warnings: number }; kicad: { unconnected: number; errors: number; warnings: number; excluded: number } };
  categories: CategoryRow[];
  /** Per net, where the unconnected counts differ. */
  unconnectedByNet: { net: string; ours: number; kicad: number }[];
  /** `tie`: an unconnected link of the same net and length that the two trees chose differently among equals. */
  matched: { finding: string; kicad: KicadEntry; distance: number; tie?: true }[];
  oursOnly: Finding[];
  /** Of `oursOnly`: measured within 1 micrometer of the limit (exact geometry; KiCad passes these). */
  borderline: Finding[];
  kicadOnly: KicadEntry[];
  /** One plain sentence per difference. Empty only when every count and item matched. */
  differences: string[];
  /** Board hash the comparison is about. */
  inputHash: string;
}

export type CrossCheckResult = CrossCheck | { ran: false; reason: string; inputHash: string };

/** A cross-check that was not run, with the reason. */
export const notRun = (reason: string, inputHash: string): CrossCheckResult => ({ ran: false, reason, inputHash });

function entries(report: KicadDrcReport, t: KicadTransform | undefined): KicadEntry[] {
  const out: KicadEntry[] = [];
  const add = (v: KicadViolation) => {
    const category = KICAD_CATEGORY[v.type] ?? `kicad:${v.type}`;
    const points = t ? (v.items ?? []).filter((i) => i.pos).map((i) => ({ x: Math.round(i.pos!.x * 1e6 + t.tx), y: Math.round(-i.pos!.y * 1e6 + t.ty), ...(i.description ? { description: i.description } : {}) })) : [];
    let net: string | undefined;
    if (category === "unconnected") for (const i of v.items ?? []) net ??= /\[([^\]]*)\]/.exec(i.description ?? "")?.[1];
    out.push({ category, type: v.type, severity: v.severity, ...(v.description ? { description: v.description } : {}), points, ...(net !== undefined ? { net } : {}) });
  };
  for (const v of report.violations ?? []) add(v);
  for (const v of report.unconnected_items ?? []) add({ ...v, type: v.type || "unconnected_items" });
  return out;
}

const within = (p: { x: number; y: number }, f: Finding, tol: number) => {
  const b = f.box ?? { minX: f.location.x, minY: f.location.y, maxX: f.location.x, maxY: f.location.y };
  return p.x >= b.minX - tol && p.x <= b.maxX + tol && p.y >= b.minY - tol && p.y <= b.maxY + tol;
};

/**
 * Compare our result with a KiCad DRC report. `tolerance` (nm, default 0.1 mm) is how far a KiCad item position
 * may lie outside our finding's box (or from its location) and still match.
 */
export function compareWithKicad(result: BoardCheckResult, report: KicadDrcReport, options: { transform?: KicadTransform; tolerance?: number; command?: string; durationMs?: number } = {}): CrossCheck {
  const tol = options.tolerance ?? 100_000;
  const t = options.transform;
  const theirs = entries(report, t);
  const ours = result.findings;
  const cats = new Set<string>([...theirs.map((e) => e.category), ...ours.map((f) => f.check)]);
  const matched: CrossCheck["matched"] = [];
  const usedOurs = new Set<string>();
  const usedTheirs = new Set<KicadEntry>();
  // anchors of every ratsnest island, for matching unconnected items by island rather than exact pad
  const islandAnchors = result.connectivity.islands.map((i) => i.anchors);
  const linkByFinding = new Map<string, (typeof result.connectivity.links)[number]>();
  for (const l of result.connectivity.links) {
    const f = ours.find((x) => x.check === "unconnected" && x.objects.length === 2 && x.objects.includes(l.from.object) && x.objects.includes(l.to.object));
    if (f) linkByFinding.set(f.id, l);
  }
  const nearIsland = (p: { x: number; y: number }, k: number) => islandAnchors[k]?.some((a) => Math.hypot(a.x - p.x, a.y - p.y) <= tol) ?? false;
  if (t)
    for (const cat of [...cats].sort(byCodeUnit)) {
      const os = ours.filter((f) => f.check === cat);
      const ts = theirs.filter((e) => e.category === cat);
      const pairs: { f: Finding; e: KicadEntry; d: number }[] = [];
      for (const e of ts) {
        if (!e.points.length) continue;
        const cx = e.points.reduce((s, p) => s + p.x, 0) / e.points.length;
        const cy = e.points.reduce((s, p) => s + p.y, 0) / e.points.length;
        for (const f of os) {
          let ok: boolean;
          if (cat === "unconnected") {
            const l = linkByFinding.get(f.id);
            ok = !!l && e.points.length >= 2 && (e.net === undefined || e.net === l.net) && ((nearIsland(e.points[0], l.islands[0]) && nearIsland(e.points[1], l.islands[1])) || (nearIsland(e.points[0], l.islands[1]) && nearIsland(e.points[1], l.islands[0])));
          } else ok = e.points.some((p) => within(p, f, tol));
          // KiCad places a zone at its outline's first corner, far from the fill it measured: the nearest point counts
          if (ok) pairs.push({ f, e, d: cat === "unconnected" ? Math.hypot(cx - f.location.x, cy - f.location.y) : Math.min(...e.points.map((p) => Math.hypot(p.x - f.location.x, p.y - f.location.y))) });
        }
      }
      pairs.sort((a, b) => a.d - b.d || byCodeUnit(a.f.id, b.f.id));
      for (const p of pairs) {
        if (usedOurs.has(p.f.id) || usedTheirs.has(p.e)) continue;
        usedOurs.add(p.f.id);
        usedTheirs.add(p.e);
        matched.push({ finding: p.f.id, kicad: p.e, distance: Math.round(p.d) });
      }
      if (cat !== "unconnected") continue;
      // equal-length alternatives: two minimum spanning trees may differ where links tie; the same net and length
      // within the tolerance is the same missing connection, chosen differently
      for (const f of os) {
        if (usedOurs.has(f.id)) continue;
        const l = linkByFinding.get(f.id);
        if (!l) continue;
        const e = ts.find((x) => !usedTheirs.has(x) && x.points.length >= 2 && x.net === l.net && Math.abs(Math.hypot(x.points[0].x - x.points[1].x, x.points[0].y - x.points[1].y) - l.length) <= tol);
        if (!e) continue;
        usedOurs.add(f.id);
        usedTheirs.add(e);
        matched.push({ finding: f.id, kicad: e, distance: Math.round(Math.hypot(f.location.x - (e.points[0].x + e.points[1].x) / 2, f.location.y - (e.points[0].y + e.points[1].y) / 2)), tie: true });
      }
    }
  const oursOnly = ours.filter((f) => !usedOurs.has(f.id));
  const borderline = oursOnly.filter((f) => f.measured !== undefined && f.required !== undefined && f.required > f.measured && f.required - f.measured <= BORDERLINE_NM);
  const kicadOnly = theirs.filter((e) => !usedTheirs.has(e));

  const categories: CategoryRow[] = [];
  const ourChecks = new Set(CHECKS.map((c) => c.id));
  for (const cat of [...cats].sort(byCodeUnit)) {
    const os = ours.filter((f) => f.check === cat);
    const ts = theirs.filter((e) => e.category === cat);
    const kicadKnown = cat.startsWith("kicad:") || Object.values(KICAD_CATEGORY).includes(cat);
    categories.push({
      category: cat,
      ours: !ourChecks.has(cat) ? null : { errors: os.filter((f) => f.severity === "error").length, warnings: os.filter((f) => f.severity !== "error").length },
      kicad: kicadKnown ? { errors: ts.filter((e) => e.severity === "error").length, warnings: ts.filter((e) => e.severity === "warning").length, excluded: ts.filter((e) => e.severity !== "error" && e.severity !== "warning").length } : null,
      kicadTypes: [...new Set(ts.map((e) => e.type))].sort(byCodeUnit),
      matched: matched.filter((m) => m.kicad.category === cat).length,
      oursOnly: oursOnly.filter((f) => f.check === cat).length,
      kicadOnly: kicadOnly.filter((e) => e.category === cat).length,
      ...(cat.startsWith("kicad:") ? { note: "not checked by Protoboard" } : CATEGORY_NOTES[cat] ? { note: CATEGORY_NOTES[cat] } : {}),
    });
  }

  // unconnected per net
  const kicadByNet = new Map<string, number>();
  for (const e of theirs) if (e.category === "unconnected") kicadByNet.set(e.net ?? "(unknown net)", (kicadByNet.get(e.net ?? "(unknown net)") ?? 0) + 1);
  const oursByNet = new Map<string, number>();
  for (const n of result.connectivity.nets) if (n.missing) oursByNet.set(n.net, n.missing);
  const unconnectedByNet = [...new Set([...kicadByNet.keys(), ...oursByNet.keys()])]
    .sort(byCodeUnit)
    .map((net) => ({ net, ours: oursByNet.get(net) ?? 0, kicad: kicadByNet.get(net) ?? 0 }))
    .filter((r) => r.ours !== r.kicad);

  const kv = report.violations ?? [];
  const totals = {
    ours: { unconnected: result.summary.unconnected, errors: result.summary.errors, warnings: result.summary.warnings },
    kicad: { unconnected: (report.unconnected_items ?? []).length, errors: kv.filter((v) => v.severity === "error").length, warnings: kv.filter((v) => v.severity === "warning").length, excluded: kv.filter((v) => v.severity !== "error" && v.severity !== "warning").length },
  };
  const differences: string[] = [];
  if (!t) differences.push("no coordinate transform: items were compared by count only, not by location");
  if (totals.ours.unconnected !== totals.kicad.unconnected) differences.push(`unconnected: ours ${totals.ours.unconnected}, KiCad ${totals.kicad.unconnected}`);
  if (totals.ours.errors !== totals.kicad.errors) differences.push(`errors: ours ${totals.ours.errors}, KiCad ${totals.kicad.errors}`);
  if (totals.ours.warnings !== totals.kicad.warnings) differences.push(`warnings: ours ${totals.ours.warnings}, KiCad ${totals.kicad.warnings}`);
  for (const r of categories) {
    if (r.ours === null) {
      differences.push(`${r.category}: KiCad reports ${r.kicad!.errors} error(s) and ${r.kicad!.warnings} warning(s); Protoboard does not check this`);
      continue;
    }
    if (r.kicad === null) {
      if (r.ours.errors || r.ours.warnings) differences.push(`${r.category}: ours ${r.ours.errors} error(s) and ${r.ours.warnings} warning(s); KiCad has no counterpart`);
      continue;
    }
    if (r.ours.errors !== r.kicad.errors || r.ours.warnings !== r.kicad.warnings) differences.push(`${r.category}: ours ${r.ours.errors} error(s), ${r.ours.warnings} warning(s); KiCad ${r.kicad.errors} error(s), ${r.kicad.warnings} warning(s)`);
    else if (t && (r.oursOnly || r.kicadOnly)) differences.push(`${r.category}: equal counts but ${r.oursOnly} of ours and ${r.kicadOnly} of KiCad's did not match by location`);
  }
  if (borderline.length) differences.push(`${borderline.length} of our findings only KiCad passes are within 1 micrometer of their limit (${[...new Set(borderline.map((f) => f.check))].sort(byCodeUnit).join(", ")}); ours measure exact geometry`);
  for (const n of unconnectedByNet) differences.push(`net ${n.net}: ours ${n.ours} unconnected, KiCad ${n.kicad}`);
  return {
    ran: true,
    kicad: { ...(report.kicad_version ? { version: report.kicad_version } : {}), ...(options.command ? { command: options.command } : {}), ...(options.durationMs !== undefined ? { durationMs: options.durationMs } : {}) },
    ...(t ? { transform: t } : {}),
    totals,
    categories,
    unconnectedByNet,
    matched,
    oursOnly,
    borderline,
    kicadOnly,
    differences,
    inputHash: result.inputHash,
  };
}

/** A short plain-text table of the comparison (for logs and the CLI). */
export function formatCrossCheck(c: CrossCheckResult): string {
  if (!c.ran) return `KiCad cross-check not run: ${c.reason}`;
  const lines = [`KiCad cross-check (KiCad ${c.kicad.version ?? "unknown"}${c.kicad.command ? `, ${c.kicad.command}` : ""})`];
  lines.push(`  totals: ours ${c.totals.ours.unconnected} unconnected, ${c.totals.ours.errors} errors, ${c.totals.ours.warnings} warnings; KiCad ${c.totals.kicad.unconnected} unconnected, ${c.totals.kicad.errors} errors, ${c.totals.kicad.warnings} warnings`);
  for (const r of c.categories) {
    const o = r.ours ? `${r.ours.errors}E ${r.ours.warnings}W` : "-";
    const k = r.kicad ? `${r.kicad.errors}E ${r.kicad.warnings}W` : "-";
    lines.push(`  ${r.category.padEnd(32)} ours ${o.padEnd(10)} KiCad ${k.padEnd(10)} matched ${r.matched}, ours only ${r.oursOnly}, KiCad only ${r.kicadOnly}${r.note ? ` (${r.note})` : ""}`);
  }
  if (c.transform) lines.push(`  transform: tx ${toMm(c.transform.tx)} mm, ty ${toMm(c.transform.ty)} mm (${c.transform.source}${c.transform.matched ? `, ${c.transform.matched} footprints, spread ${toMm(c.transform.spread ?? 0)} mm` : ""})`);
  return lines.join("\n");
}
