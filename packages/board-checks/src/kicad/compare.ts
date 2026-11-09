/**
 * The KiCad cross-check: our counts beside KiCad's, like with like. Every check of ours and every KiCad violation
 * type falls in exactly one of three groups (`CATEGORY_ROWS`, `OURS_ONLY`, anything else KiCad reports):
 *
 * - comparable rows: one or more of our checks and the KiCad types that measure the same thing. The comparable
 *   errors and warnings are the sums over these rows, on both sides;
 * - ours only: checks KiCad has no counterpart for (copper without a net touching a net, via-in-pad policy, ...);
 * - KiCad only: types we do not check (text height, footprint library mismatch, silkscreen clipped by mask, ...).
 *
 * KiCad's items are counted once per distinct report: KiCad, run with `--all-track-errors`, reports a track once per
 * place along it and a hole clearance once per copper layer, where we report one finding per object pair. A KiCad
 * report whose rule the importer could not express (`notEvaluated`) is listed as not evaluated and not counted.
 * It never hides a difference: every KiCad item we did not match and every finding of ours KiCad did not report is
 * listed by location.
 *
 * Coordinates: KiCad reports millimeters with +Y down from its page origin; the board document is nanometers with
 * +Y up. `x = kx * 1e6 + tx`, `y = -ky * 1e6 + ty`. The importer may state `tx, ty`; otherwise
 * `estimateTransform` finds them from footprint positions (the median offset over footprints matched by
 * reference). Without a transform, items are compared by count only and the result says so.
 */
import { byCodeUnit, padsOf, recordsOfKind, toMm, type BoardDocument, type Finding } from "@protoboardai/board";
import type { BoardCheckResult } from "../run.js";
import type { KicadDrcReport, KicadViolation } from "./drc.js";
import { readKicadPlacements } from "./sexpr.js";

/** A comparable category: our checks and the KiCad violation types that measure the same thing. */
export interface CategoryRowDef {
  row: string;
  ours: string[];
  kicad: string[];
  note?: string;
}

export const CATEGORY_ROWS: readonly CategoryRowDef[] = [
  { row: "unconnected", ours: ["unconnected"], kicad: ["unconnected_items"], note: "both count missing links of a minimum spanning tree per net" },
  { row: "short", ours: ["short"], kicad: ["shorting_items"] },
  { row: "clearance", ours: ["clearance", "physical_clearance"], kicad: ["clearance"], note: "KiCad reports clearance and physical_clearance rules both as clearance" },
  { row: "track_width", ours: ["track_width"], kicad: ["track_width"] },
  { row: "via_diameter", ours: ["via_diameter"], kicad: ["via_diameter"] },
  { row: "hole_size", ours: ["hole_size", "via_hole"], kicad: ["drill_out_of_range"], note: "via and pad holes" },
  { row: "annular_ring", ours: ["annular_ring"], kicad: ["annular_width"] },
  { row: "hole_clearance", ours: ["hole_clearance"], kicad: ["hole_clearance"], note: "KiCad reports a hole once per copper layer; counted once per pair" },
  { row: "hole_to_hole", ours: ["hole_to_hole"], kicad: ["hole_to_hole", "drilled_holes_too_close", "holes_co_located"] },
  { row: "edge_clearance", ours: ["edge_clearance"], kicad: ["copper_edge_clearance"], note: "KiCad reports a track once per place along it; counted once per copper item" },
  { row: "courtyard_overlap", ours: ["courtyard_overlap"], kicad: ["courtyards_overlap"] },
  { row: "silk_to_pad", ours: ["silk_to_pad"], kicad: ["silk_over_copper"], note: "KiCad tests silkscreen against solder mask openings and real text strokes; ours against pad copper, with text as boxes" },
  { row: "dangling", ours: ["dangling"], kicad: ["track_dangling", "via_dangling"] },
  { row: "isolated_copper", ours: ["isolated_copper"], kicad: ["isolated_copper"] },
  { row: "keepout", ours: ["keepout", "disallow"], kicad: ["items_not_allowed"], note: "keep-out areas and disallow rules" },
];

/** Our checks KiCad has no counterpart for. */
export const OURS_ONLY: Record<string, string> = {
  unassigned_copper: "copper without a net touching a net; KiCad has no counterpart",
  via_in_pad: "a policy check; KiCad has no direct counterpart",
  via_under_footprint: "a policy check; KiCad has no direct counterpart",
};

/** Which comparable row a KiCad violation type is in (undefined: KiCad only). */
export const KICAD_CATEGORY: Record<string, string> = Object.fromEntries(CATEGORY_ROWS.flatMap((r) => r.kicad.map((t) => [t, r.row])));
/** Which comparable row one of our checks is in (undefined: ours only). */
export const OUR_CATEGORY: Record<string, string> = Object.fromEntries(CATEGORY_ROWS.flatMap((r) => r.ours.map((c) => [c, r.row])));
/** Notes per category, kept for older readers. */
export const CATEGORY_NOTES: Record<string, string> = { ...Object.fromEntries(CATEGORY_ROWS.filter((r) => r.note).map((r) => [r.row, r.note!])), ...OURS_ONLY };

/** A finding this close to its limit (nm) is borderline: within KiCad's own tolerance of it. */
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
  /** The comparable row, or `kicad:<type>` for a type we do not check. */
  category: string;
  /** KiCad's violation type. */
  type: string;
  severity: string;
  description?: string;
  /** Item positions in board coordinates (nm), when a transform is known. */
  points: { x: number; y: number; description?: string }[];
  /** KiCad's item positions in its own frame (mm), for reading a difference against the KiCad board. */
  kicadPoints?: { x: number; y: number; description?: string }[];
  /** For unconnected items: the net named in KiCad's item descriptions. */
  net?: string;
  /** The custom rule KiCad names in the description, when it names one. */
  rule?: string;
  /** How many of KiCad's reports this entry stands for (repeats of one item set under --all-track-errors). */
  reports: number;
}

export interface CategoryRow {
  category: string;
  /** Our counts, or null when we do not check this category. */
  ours: { errors: number; warnings: number } | null;
  /** KiCad's counts (distinct items), or null when KiCad has no counterpart. */
  kicad: { errors: number; warnings: number; excluded: number } | null;
  /** KiCad's raw report count in this row (repeats included). */
  kicadReports?: number;
  /** Our checks and KiCad types in this row. */
  checks: string[];
  kicadTypes: string[];
  /** `comparable`, `ours only` or `KiCad only`. */
  group: "comparable" | "ours only" | "KiCad only";
  matched: number;
  oursOnly: number;
  kicadOnly: number;
  note?: string;
}

export interface Counts {
  unconnected: number;
  errors: number;
  warnings: number;
}

export interface CrossCheck {
  ran: true;
  kicad: { version?: string; command?: string; durationMs?: number };
  transform?: KicadTransform;
  /** Raw totals as each tool reports them (KiCad's include every type and every repeat). */
  totals: { ours: Counts; kicad: Counts & { excluded: number } };
  /** Like with like: the comparable rows only, KiCad's items counted once (errors and warnings exclude unconnected). */
  comparable: { ours: Counts; kicad: Counts };
  /** Findings of ours in categories KiCad has no counterpart for. */
  oursOnlyCategories: { count: number; byCheck: Record<string, number> };
  /** KiCad items in types we do not check (distinct items, and KiCad's raw reports). */
  kicadOnlyCategories: { count: number; reports: number; byType: Record<string, number> };
  /** Our findings on an object the source shares its identity with (a pad sharing a UUID): KiCad reports the group once. Not counted. */
  folded: Finding[];
  /** Rules the importer could not express, and the KiCad items that name one of them (not counted anywhere else). */
  notEvaluated: { rules: { name: string; reason: string }[]; kicadItems: KicadEntry[] };
  categories: CategoryRow[];
  /** Per net, where the unconnected counts differ. */
  unconnectedByNet: { net: string; ours: number; kicad: number }[];
  /** `tie`: an unconnected link of the same net and length that the two trees chose differently among equals. */
  matched: { finding: string; kicad: KicadEntry; distance: number; tie?: true }[];
  /** Our findings in comparable rows that KiCad did not report at that place. */
  oursOnly: Finding[];
  /** Of `oursOnly`: measured within 1 micrometer of the limit. */
  borderline: Finding[];
  /** KiCad's items in comparable rows that we did not report at that place. */
  kicadOnly: KicadEntry[];
  /** One plain sentence per difference. Empty only when every comparable count and item matched. */
  differences: string[];
  /** Board hash the comparison is about. */
  inputHash: string;
}

export type CrossCheckResult = CrossCheck | { ran: false; reason: string; inputHash: string };

/** A cross-check that was not run, with the reason. */
export const notRun = (reason: string, inputHash: string): CrossCheckResult => ({ ran: false, reason, inputHash });

const stripNumbers = (s: string) => s.replace(/-?\d+(?:\.\d+)?(?:e-?\d+)?/gi, "#");
const isEdge = (d: string | undefined) => /on Edge\.Cuts/.test(d ?? "");

/** KiCad's reports as entries, one per distinct item set (repeats folded, with their count). */
function entries(report: KicadDrcReport, t: KicadTransform | undefined): KicadEntry[] {
  const byKey = new Map<string, KicadEntry>();
  const out: KicadEntry[] = [];
  const add = (v: KicadViolation, unconnected: boolean) => {
    const category = KICAD_CATEGORY[v.type] ?? `kicad:${v.type}`;
    const items = v.items ?? [];
    // edge clearance: the copper item, whichever edge; otherwise every item
    const keyItems = (v.type === "copper_edge_clearance" ? items.filter((i) => !isEdge(i.description)) : items).map((i) => `${i.description ?? ""}@${i.pos?.x},${i.pos?.y}`).sort();
    const rule = /\(rule '([^']*)'/.exec(v.description ?? "")?.[1];
    const key = unconnected ? undefined : `${v.type}|${v.severity}|${stripNumbers(v.description ?? "")}|${keyItems.join("|")}`;
    const prev = key ? byKey.get(key) : undefined;
    if (prev) {
      prev.reports++;
      return;
    }
    // an Edge.Cuts item's position is its first corner, anywhere on the board: match by the other items
    const placed = items.filter((i) => i.pos && !isEdge(i.description));
    const points = t ? (placed.length ? placed : items.filter((i) => i.pos)).map((i) => ({ x: Math.round(i.pos!.x * 1e6 + t.tx), y: Math.round(-i.pos!.y * 1e6 + t.ty), ...(i.description ? { description: i.description } : {}) })) : [];
    const kicadPoints = items.filter((i) => i.pos).map((i) => ({ x: i.pos!.x, y: i.pos!.y, ...(i.description ? { description: i.description } : {}) }));
    let net: string | undefined;
    if (category === "unconnected") for (const i of items) net ??= /\[([^\]]*)\]/.exec(i.description ?? "")?.[1];
    const e: KicadEntry = { category, type: v.type, severity: v.severity, ...(v.description ? { description: v.description } : {}), points, kicadPoints, ...(net !== undefined ? { net } : {}), ...(rule !== undefined ? { rule } : {}), reports: 1 };
    if (key) byKey.set(key, e);
    out.push(e);
  };
  for (const v of report.violations ?? []) add(v, false);
  for (const v of report.unconnected_items ?? []) add({ ...v, type: v.type || "unconnected_items" }, true);
  return out;
}

const within = (p: { x: number; y: number }, f: Finding, tol: number) => {
  const b = f.box ?? { minX: f.location.x, minY: f.location.y, maxX: f.location.x, maxY: f.location.y };
  return p.x >= b.minX - tol && p.x <= b.maxX + tol && p.y >= b.minY - tol && p.y <= b.maxY + tol;
};

const sevCount = (xs: { severity: string }[]) => ({ errors: xs.filter((x) => x.severity === "error").length, warnings: xs.filter((x) => x.severity === "warning").length });

/**
 * Compare our result with a KiCad DRC report. `tolerance` (nm, default 0.1 mm) is how far a KiCad item position
 * may lie outside our finding's box (or from its location) and still match. `notEvaluated` names the source's
 * rules the importer could not express: KiCad items naming one are listed apart and not counted.
 */
export function compareWithKicad(
  result: BoardCheckResult,
  report: KicadDrcReport,
  options: { transform?: KicadTransform; tolerance?: number; command?: string; durationMs?: number; notEvaluated?: { name: string; reason: string }[]; doc?: BoardDocument; sharedIds?: string[][] } = {},
): CrossCheck {
  const tol = options.tolerance ?? 100_000;
  const t = options.transform;
  const notEval = options.notEvaluated ?? [];
  const notEvalNames = new Set(notEval.map((n) => n.name.replace(/^custom rule '(.*)'$/, "$1")));
  const all = entries(report, t);
  const skipped = all.filter((e) => e.rule !== undefined && notEvalNames.has(e.rule));
  const theirs = all.filter((e) => !skipped.includes(e));
  // objects the source gives one identity (pads sharing a UUID) are one item to KiCad: one finding per check stands
  // for the group, the others are folded (listed, not counted)
  const rep = new Map<string, string>();
  for (const g of options.sharedIds ?? []) for (const id of g) rep.set(id, g[0]);
  const folded: Finding[] = [];
  const ours: Finding[] = [];
  {
    const seenKey = new Set<string>();
    for (const f of [...result.findings].sort((a, b) => byCodeUnit(a.id, b.id))) {
      if (!f.objects.some((o) => rep.has(o))) {
        ours.push(f);
        continue;
      }
      const key = `${f.check}|${f.severity}|${f.objects.map((o) => rep.get(o) ?? o).sort(byCodeUnit).join("|")}`;
      if (seenKey.has(key)) folded.push(f);
      else {
        seenKey.add(key);
        ours.push(f);
      }
    }
  }
  const rowOf = (f: Finding) => OUR_CATEGORY[f.check] ?? f.check;
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
  // where KiCad places each of our objects (a track at its ends, a via, pad or footprint at its position), for
  // pairing a KiCad item with the finding about the same object when several findings' boxes hold it
  const anchors = objectAnchors(options.doc);
  const anchorDist = (f: Finding, e: KicadEntry): number | undefined => {
    let best: number | undefined;
    for (const id of f.objects) for (const a of anchors.get(id) ?? []) for (const p of e.points) best = Math.min(best ?? Infinity, Math.hypot(a.x - p.x, a.y - p.y));
    return best;
  };
  const nearIsland = (p: { x: number; y: number }, k: number) => islandAnchors[k]?.some((a) => Math.hypot(a.x - p.x, a.y - p.y) <= tol) ?? false;
  if (t)
    for (const def of CATEGORY_ROWS) {
      const cat = def.row;
      const os = ours.filter((f) => rowOf(f) === cat);
      const ts = theirs.filter((e) => e.category === cat);
      const pairs: { f: Finding; e: KicadEntry; d: number }[] = [];
      for (const e of ts) {
        if (!e.points.length) continue;
        const cx = e.points.reduce((s, p) => s + p.x, 0) / e.points.length;
        const cy = e.points.reduce((s, p) => s + p.y, 0) / e.points.length;
        for (const f of os) {
          // like with like: an error matches an error, a warning a warning
          if ((f.severity === "error") !== (e.severity === "error")) continue;
          let ok: boolean;
          if (cat === "unconnected") {
            const l = linkByFinding.get(f.id);
            ok = !!l && e.points.length >= 2 && (e.net === undefined || e.net === l.net) && ((nearIsland(e.points[0], l.islands[0]) && nearIsland(e.points[1], l.islands[1])) || (nearIsland(e.points[0], l.islands[1]) && nearIsland(e.points[1], l.islands[0])));
          } else ok = e.points.some((p) => within(p, f, tol));
          // KiCad places a zone at its outline's first corner, far from the fill it measured: the nearest point counts
          if (ok) pairs.push({ f, e, d: cat === "unconnected" ? Math.hypot(cx - f.location.x, cy - f.location.y) : (anchorDist(f, e) ?? Math.min(...e.points.map((p) => Math.hypot(p.x - f.location.x, p.y - f.location.y)))) });
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
  const comparableOurs = ours.filter((f) => OUR_CATEGORY[f.check] !== undefined);
  const comparableTheirs = theirs.filter((e) => !e.category.startsWith("kicad:"));
  const oursOnly = comparableOurs.filter((f) => !usedOurs.has(f.id));
  const borderline = oursOnly.filter((f) => f.measured !== undefined && f.required !== undefined && f.required > f.measured && f.required - f.measured <= BORDERLINE_NM);
  const kicadOnly = comparableTheirs.filter((e) => !usedTheirs.has(e));

  // rows: comparable ones in table order, then ours-only checks, then KiCad-only types
  const categories: CategoryRow[] = [];
  for (const def of CATEGORY_ROWS) {
    const os = ours.filter((f) => rowOf(f) === def.row);
    const ts = theirs.filter((e) => e.category === def.row);
    if (!os.length && !ts.length) continue;
    categories.push({
      category: def.row,
      ours: sevCount(os),
      kicad: { ...sevCount(ts), excluded: ts.filter((e) => e.severity !== "error" && e.severity !== "warning").length },
      kicadReports: ts.reduce((s, e) => s + e.reports, 0),
      checks: [...def.ours],
      kicadTypes: [...def.kicad],
      group: "comparable",
      matched: matched.filter((m) => m.kicad.category === def.row).length,
      oursOnly: oursOnly.filter((f) => rowOf(f) === def.row).length,
      kicadOnly: kicadOnly.filter((e) => e.category === def.row).length,
      ...(def.note ? { note: def.note } : {}),
    });
  }
  const oursOnlyChecks = [...new Set(ours.filter((f) => OUR_CATEGORY[f.check] === undefined).map((f) => f.check))].sort(byCodeUnit);
  const oursOnlyByCheck: Record<string, number> = {};
  for (const c of oursOnlyChecks) {
    const os = ours.filter((f) => f.check === c);
    oursOnlyByCheck[c] = os.length;
    categories.push({ category: c, ours: sevCount(os), kicad: null, checks: [c], kicadTypes: [], group: "ours only", matched: 0, oursOnly: os.length, kicadOnly: 0, note: OURS_ONLY[c] ?? "KiCad has no counterpart" });
  }
  const kicadOnlyTypes = [...new Set(theirs.filter((e) => e.category.startsWith("kicad:")).map((e) => e.type))].sort(byCodeUnit);
  const kicadOnlyByType: Record<string, number> = {};
  let kicadOnlyReports = 0;
  for (const type of kicadOnlyTypes) {
    const ts = theirs.filter((e) => e.type === type && e.category.startsWith("kicad:"));
    kicadOnlyByType[type] = ts.length;
    kicadOnlyReports += ts.reduce((s, e) => s + e.reports, 0);
    categories.push({ category: `kicad:${type}`, ours: null, kicad: { ...sevCount(ts), excluded: ts.filter((e) => e.severity !== "error" && e.severity !== "warning").length }, kicadReports: ts.reduce((s, e) => s + e.reports, 0), checks: [], kicadTypes: [type], group: "KiCad only", matched: 0, oursOnly: 0, kicadOnly: ts.length, note: "not checked by Protoboard" });
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
  const cmpOurs = comparableOurs.filter((f) => f.check !== "unconnected");
  const cmpTheirs = comparableTheirs.filter((e) => e.category !== "unconnected");
  const comparable = {
    ours: { unconnected: result.summary.unconnected, ...sevCount(cmpOurs) },
    kicad: { unconnected: comparableTheirs.filter((e) => e.category === "unconnected").length, ...sevCount(cmpTheirs) },
  };
  const differences: string[] = [];
  if (!t) differences.push("no coordinate transform: items were compared by count only, not by location");
  if (comparable.ours.unconnected !== comparable.kicad.unconnected) differences.push(`unconnected: ours ${comparable.ours.unconnected}, KiCad ${comparable.kicad.unconnected}`);
  if (comparable.ours.errors !== comparable.kicad.errors) differences.push(`errors: ours ${comparable.ours.errors}, KiCad ${comparable.kicad.errors} (comparable categories)`);
  if (comparable.ours.warnings !== comparable.kicad.warnings) differences.push(`warnings: ours ${comparable.ours.warnings}, KiCad ${comparable.kicad.warnings} (comparable categories)`);
  for (const r of categories) {
    if (r.group === "KiCad only") {
      differences.push(`${r.category}: KiCad only, ${r.kicad!.errors} error(s) and ${r.kicad!.warnings} warning(s); Protoboard does not check this`);
      continue;
    }
    if (r.group === "ours only") {
      differences.push(`${r.category}: ours only, ${r.ours!.errors} error(s) and ${r.ours!.warnings} warning(s); KiCad has no counterpart`);
      continue;
    }
    if (r.ours!.errors !== r.kicad!.errors || r.ours!.warnings !== r.kicad!.warnings) differences.push(`${r.category}: ours ${r.ours!.errors} error(s), ${r.ours!.warnings} warning(s); KiCad ${r.kicad!.errors} error(s), ${r.kicad!.warnings} warning(s)`);
    else if (t && (r.oursOnly || r.kicadOnly)) differences.push(`${r.category}: equal counts but ${r.oursOnly} of ours and ${r.kicadOnly} of KiCad's did not match by location`);
  }
  if (folded.length) differences.push(`${folded.length} of our findings are on objects that share one identity in the source (${[...new Set(folded.map((f) => f.check))].sort(byCodeUnit).join(", ")}); KiCad reports each such group as one item, so they are folded into one and not counted`);
  if (notEval.length) differences.push(`${notEval.length} rule(s) of the source not evaluated (${notEval.map((n) => n.name).join("; ")}); KiCad reports ${skipped.length} item(s) under them, not counted`);
  if (borderline.length) differences.push(`${borderline.length} of our findings only KiCad passes are within 1 micrometer of their limit (${[...new Set(borderline.map((f) => f.check))].sort(byCodeUnit).join(", ")})`);
  for (const n of unconnectedByNet) differences.push(`net ${n.net}: ours ${n.ours} unconnected, KiCad ${n.kicad}`);
  return {
    ran: true,
    kicad: { ...(report.kicad_version ? { version: report.kicad_version } : {}), ...(options.command ? { command: options.command } : {}), ...(options.durationMs !== undefined ? { durationMs: options.durationMs } : {}) },
    ...(t ? { transform: t } : {}),
    totals,
    comparable,
    oursOnlyCategories: { count: Object.values(oursOnlyByCheck).reduce((s, n) => s + n, 0), byCheck: oursOnlyByCheck },
    kicadOnlyCategories: { count: Object.values(kicadOnlyByType).reduce((s, n) => s + n, 0), reports: kicadOnlyReports, byType: kicadOnlyByType },
    folded,
    notEvaluated: { rules: notEval, kicadItems: skipped },
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

/** The points KiCad reports an object at: a track's ends, a via's, pad's or footprint's position. */
function objectAnchors(doc: BoardDocument | undefined): Map<string, { x: number; y: number }[]> {
  const out = new Map<string, { x: number; y: number }[]>();
  if (!doc) return out;
  for (const r of doc.records.values()) {
    if (r.kind === "track") out.set(r.id, [r.start, r.end]);
    else if (r.kind === "via") out.set(r.id, [{ x: r.x, y: r.y }]);
    else if (r.kind === "footprint") {
      out.set(r.id, [{ x: r.x, y: r.y }]);
      for (const wp of padsOf(r)) out.set(wp.id, [{ x: wp.x, y: wp.y }]);
    }
  }
  return out;
}

/** A short plain-text table of the comparison (for logs and the CLI). */
export function formatCrossCheck(c: CrossCheckResult): string {
  if (!c.ran) return `KiCad cross-check not run: ${c.reason}`;
  const lines = [`KiCad cross-check (KiCad ${c.kicad.version ?? "unknown"}${c.kicad.command ? `, ${c.kicad.command}` : ""})`];
  const k = c.comparable;
  lines.push(`  comparable: ours ${k.ours.unconnected} unconnected, ${k.ours.errors} errors, ${k.ours.warnings} warnings; KiCad ${k.kicad.unconnected} unconnected, ${k.kicad.errors} errors, ${k.kicad.warnings} warnings`);
  lines.push(`  ours only: ${c.oursOnlyCategories.count} (${Object.entries(c.oursOnlyCategories.byCheck).map(([x, n]) => `${x} ${n}`).join(", ") || "none"}); KiCad only: ${c.kicadOnlyCategories.count} items in ${c.kicadOnlyCategories.reports} reports (${Object.entries(c.kicadOnlyCategories.byType).map(([x, n]) => `${x} ${n}`).join(", ") || "none"})`);
  if (c.folded.length) lines.push(`  folded: ${c.folded.length} finding(s) on objects sharing one identity in the source (KiCad reports each group once)`);
  if (c.notEvaluated.rules.length) lines.push(`  not evaluated: ${c.notEvaluated.rules.length} rule(s), ${c.notEvaluated.kicadItems.length} KiCad item(s) under them`);
  lines.push(`  raw totals: ours ${c.totals.ours.unconnected} unconnected, ${c.totals.ours.errors} errors, ${c.totals.ours.warnings} warnings; KiCad ${c.totals.kicad.unconnected} unconnected, ${c.totals.kicad.errors} errors, ${c.totals.kicad.warnings} warnings`);
  for (const r of c.categories) {
    const o = r.ours ? `${r.ours.errors}E ${r.ours.warnings}W` : "-";
    const kk = r.kicad ? `${r.kicad.errors}E ${r.kicad.warnings}W` : "-";
    lines.push(`  ${r.category.padEnd(32)} ours ${o.padEnd(10)} KiCad ${kk.padEnd(10)} matched ${r.matched}, ours only ${r.oursOnly}, KiCad only ${r.kicadOnly}${r.note ? ` (${r.note})` : ""}`);
  }
  if (c.transform) lines.push(`  transform: tx ${toMm(c.transform.tx)} mm, ty ${toMm(c.transform.ty)} mm (${c.transform.source}${c.transform.matched ? `, ${c.transform.matched} footprints, spread ${toMm(c.transform.spread ?? 0)} mm` : ""})`);
  return lines.join("\n");
}
