/**
 * The interactive tools of the layout screen as pure functions (no DOM, no React): what the route tool's callout
 * says about the active segment (the limiting rule, its tier and where it came from), the operations the via,
 * zone, keep-out, rip-up, width, outline and silkscreen tools commit, and the reports the screen shows after a
 * commit (DXF import, rip-up). The kernel (`@protoboardai/board-edit`) plans routes and drags; this module only
 * names what it planned and builds the one transaction each gesture sends.
 */
import { parsePadId, recordsOfKind, type BoardDocument, type BoardRecord, type CopperLayer, type Vertex } from "../board.js";
import type { PageOpCall } from "../types.js";

/** The kernel's candidate, as far as the screen reads it (structural: `RouteCandidate` of @protoboardai/board-edit). */
export interface RouteDraft {
  ok: boolean;
  points: { x: number; y: number; layer: CopperLayer }[];
  head: { x: number; y: number; layer: CopperLayer }[];
  layer: CopperLayer;
  net: string;
  reached?: { kind: string; id: string };
  snapped?: { kind: string; id: string; x: number; y: number };
  width: { value: number; rule?: string; tier?: string; source: "rule" | "default" | "given" };
  clearance: { value: number; rule?: string; tier?: string; source: "rule" | "default" };
  limiting?: { check: string; rule?: string; tier?: string; required: number; actual: number; against: string };
  length: { total: number; head: number };
  collisions: { id: string; layer: CopperLayer; required: number; actual: number; rule?: string }[];
  stuck?: { at: { x: number; y: number }; blockers: string[] };
  timing: { ms: number; budgetHit: boolean; expanded: number };
}

const NM = 1e-6;
/** Millimeters as the screen writes them: at most three decimals, no trailing zeros. */
export const mmText = (nm: number, digits = 3): string => String(Number((nm * NM).toFixed(digits)));

export const TIER_WORDS: Record<string, string> = { floor: "fab floor", target: "design target", policy: "policy", no_go: "no-go" };

/** Where a value the head honors comes from, in words: the chip (who set it) and the source (where it is written). */
export interface ValueSource {
  value: number;
  /** The chip: "design target", "fab floor", "net class", "net", "default", "you". */
  by: string;
  /** Where it is written: the rule's source location or note, the class name, or "editor default". */
  from: string;
  rule?: string;
  tier?: string;
}

/** Name the source of a width or clearance the kernel resolved. */
export function valueSource(doc: BoardDocument, v: { value: number; rule?: string; tier?: string; source: string }): ValueSource {
  if (v.source === "given") return { value: v.value, by: "you", from: "set while drawing (W)" };
  if (v.source === "default" || !v.rule) return { value: v.value, by: "default", from: "editor default (no rule gives one)" };
  const r = doc.records.get(v.rule);
  const tier = v.tier ?? (r?.kind === "rule" ? r.tier : undefined);
  const base = { value: v.value, rule: v.rule, ...(tier ? { tier } : {}) };
  if (r?.kind !== "rule") return { ...base, by: TIER_WORDS[tier ?? ""] ?? "rule", from: v.rule };
  const from = r.provenance?.from ?? r.note ?? r.id;
  if (r.applies.classes?.length) return { ...base, by: "net class", from: r.provenance?.from ?? `${r.applies.classes.join(", ")}${r.note ? ` · ${r.note}` : ""}` };
  if (r.applies.nets?.length) return { ...base, by: "net", from: r.provenance?.from ?? `${r.applies.nets.slice(0, 2).join(", ")}${r.note ? ` · ${r.note}` : ""}` };
  return { ...base, by: TIER_WORDS[r.tier] ?? r.tier, from };
}

/** An object id as a person reads it: "U3 pad 2", "GND track", "board edge", a keep-out's name. */
export function objectName(doc: BoardDocument, id: string): string {
  const pad = parsePadId(id);
  if (pad) {
    const fp = doc.records.get(pad.footprint);
    return fp?.kind === "footprint" ? `${fp.ref} pad ${pad.pad}` : id;
  }
  const r = doc.records.get(id);
  if (!r) return id === "outline" || id.startsWith("edge") ? "board edge" : id;
  if (r.kind === "track" || r.kind === "via") return `${r.net ?? "unassigned"} ${r.kind}`;
  if (r.kind === "footprint") return r.ref;
  if (r.kind === "keepout") return r.name ? `keep-out ${r.name}` : "a keep-out";
  if (r.kind === "zone") return `${r.net ?? "unassigned"} zone`;
  if (r.kind === "outline") return "board edge";
  if (r.kind === "cutout") return "a cutout edge";
  return r.kind;
}

/** The fab floor's clearance (the largest floor-tier clearance minimum that applies board-wide), if any. */
export function floorClearance(doc: BoardDocument): number | undefined {
  let best: number | undefined;
  for (const r of recordsOfKind(doc, "rule")) {
    if (r.check !== "clearance" || r.tier !== "floor" || r.enabled === false || r.min === undefined) continue;
    if (r.applies.nets?.length || r.applies.classes?.length || r.applies.region || r.applies.when) continue;
    best = Math.max(best ?? 0, r.min);
  }
  return best;
}

/** The vias of a draft: consecutive points at one spot on different layers. */
export function draftVias(points: readonly { x: number; y: number; layer: string }[]): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (let i = 1; i < points.length; i++) if (points[i].x === points[i - 1].x && points[i].y === points[i - 1].y && points[i].layer !== points[i - 1].layer) out.push({ x: points[i].x, y: points[i].y });
  return out;
}

/** The active segment: the last segment of the head (or of the fixed draft when the head is empty). */
export function activeSegment(d: RouteDraft): [{ x: number; y: number }, { x: number; y: number }] | undefined {
  const pts = d.points;
  for (let i = pts.length - 1; i > 0; i--) if (pts[i].layer === pts[i - 1].layer && (pts[i].x !== pts[i - 1].x || pts[i].y !== pts[i - 1].y)) return [pts[i - 1], pts[i]];
  return undefined;
}

export interface CalloutRow {
  label: string;
  value: string;
  chip?: string;
  from?: string;
  tone?: "fail" | "warn";
}

/** What the one callout on the active segment says (L3): layer and width, the limit, clearance, width, live length. */
export interface RouteCallout {
  shelf: string;
  head: string;
  mode: string;
  rows: CalloutRow[];
  note?: string;
  flag?: { tone: "fail" | "warn"; text: string };
  keys: string[];
}

export function routeCallout(doc: BoardDocument, d: RouteDraft, o: { mode: "walkaround" | "highlight"; posture: "45" | "90"; armed?: boolean; paused?: boolean }): RouteCallout {
  const cl = valueSource(doc, d.clearance);
  const w = valueSource(doc, d.width);
  const rows: CalloutRow[] = [];
  if (d.limiting) {
    const lim = d.limiting;
    const src = lim.rule ? valueSource(doc, { value: lim.required, rule: lim.rule, ...(lim.tier ? { tier: lim.tier } : {}), source: "rule" }) : { by: "default", from: "editor default" };
    const what = lim.check === "edge_clearance" ? "edge" : lim.check === "keepout" ? "keep-out" : "clearance";
    rows.push({ label: "Limit", value: `${what} ${mmText(lim.required)} to ${objectName(doc, lim.against)}`, chip: src.by, from: src.from, ...(lim.actual < lim.required ? { tone: "fail" as const } : {}) });
    rows.push({ label: "Gap", value: `${mmText(lim.actual)} mm now`, ...(lim.actual < lim.required ? { tone: "fail" as const } : {}) });
  }
  rows.push({ label: "Clearance", value: mmText(cl.value), chip: cl.by, from: cl.from });
  rows.push({ label: "Width", value: mmText(w.value), chip: w.by, from: w.from });
  const vias = draftVias(d.points).length;
  rows.push({ label: "Length", value: `${(d.length.total * NM).toFixed(2)} mm, live · vias ${vias}` });
  const floor = floorClearance(doc);
  const note = floor !== undefined && floor < cl.value ? `fab floor ${mmText(floor)} is not the limit here` : undefined;
  let flag: RouteCallout["flag"];
  if (o.mode === "highlight" && d.collisions.length) flag = { tone: "fail", text: `${d.collisions.length} collision${d.collisions.length === 1 ? "" : "s"} · ${o.armed ? "F again commits them as violations" : "F asks before committing"}` };
  else if (d.stuck) flag = { tone: "warn", text: `blocked by ${d.stuck.blockers.slice(0, 2).map((b) => objectName(doc, b)).join(", ") || "copper"} · the draft stops at the last legal spot` };
  else if (d.reached) flag = undefined;
  return {
    shelf: `${d.net} · active segment`,
    head: `${d.layer} · ${mmText(d.width.value)} mm`,
    mode: o.mode === "highlight" ? "highlight collisions" : "walk around",
    rows,
    ...(note ? { note } : {}),
    ...(flag ? { flag } : {}),
    keys: ["V via", "/ posture", "W width", d.reached ? "F finish ✓" : "F finish", "⌫ back", "Esc drop"],
  };
}

// ------------------------------------------------------------------ widths

/** Track widths the W key steps through (millimeters). */
export const WIDTH_STEPS_MM = [0.1, 0.127, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5, 0.6, 0.8, 1.0, 1.5, 2.0];

/** The next width step from the current one (nanometers), up or down. */
export function stepWidth(current: number, dir: 1 | -1): number {
  const mmNow = current * NM;
  if (dir > 0) return Math.round((WIDTH_STEPS_MM.find((w) => w > mmNow + 1e-6) ?? WIDTH_STEPS_MM[WIDTH_STEPS_MM.length - 1]) * 1e6);
  const down = [...WIDTH_STEPS_MM].reverse().find((w) => w < mmNow - 1e-6) ?? WIDTH_STEPS_MM[0];
  return Math.round(down * 1e6);
}

/** track.set_width on tracks or on a whole net, with or without a neck at pad entries. */
export function widthOps(target: { ids: readonly string[] } | { net: string }, widthMm: number, neck: boolean): PageOpCall[] {
  if (!Number.isFinite(widthMm) || widthMm <= 0) return [];
  const width = Math.round(widthMm * 1e6);
  if ("net" in target) return [{ op: "track.set_width", net: target.net, width, ...(neck ? { neck: true } : {}) }];
  return target.ids.length ? [{ op: "track.set_width", ids: [...target.ids], width, ...(neck ? { neck: true } : {}) }] : [];
}

// ------------------------------------------------------------------ polygons: zones, keep-outs, regions

export interface Pt {
  x: number;
  y: number;
}

/** A drawn polygon cleaned for a contour: integer nanometers, no repeated or closing point, at least 3 corners. */
export function contourOf(pts: readonly Pt[]): Vertex[] | undefined {
  const out: Vertex[] = [];
  for (const p of pts) {
    const v = { x: Math.round(p.x), y: Math.round(p.y) };
    const q = out[out.length - 1];
    if (q && q.x === v.x && q.y === v.y) continue;
    out.push(v);
  }
  while (out.length > 1 && out[0].x === out[out.length - 1].x && out[0].y === out[out.length - 1].y) out.pop();
  if (out.length < 3) return undefined;
  // a polygon with no area (all corners on one line) is not a contour
  let a = 0;
  for (let i = 0; i < out.length; i++) {
    const p = out[i];
    const q = out[(i + 1) % out.length];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) > 0 ? out : undefined;
}

/** A rectangle (nanometers, any two corners) as a contour. */
export function rectContour(a: Pt, b: Pt): Vertex[] {
  const x0 = Math.round(Math.min(a.x, b.x));
  const x1 = Math.round(Math.max(a.x, b.x));
  const y0 = Math.round(Math.min(a.y, b.y));
  const y1 = Math.round(Math.max(a.y, b.y));
  return [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
}

/** zone.add for a drawn polygon on one layer, for a net (or none). */
export function zoneOp(pts: readonly Pt[], o: { net?: string; layer: CopperLayer; priority?: number }): PageOpCall | undefined {
  const outline = contourOf(pts);
  if (!outline) return undefined;
  return { op: "zone.add", zone: { ...(o.net ? { net: o.net } : {}), layers: [o.layer], outline, priority: o.priority ?? 0, pad_connection: "thermal", fill_mode: "solid", remove_islands: "always" }, handle: "z" };
}

export type KeepoutTier = "no_go" | "policy";
export interface KeepoutBlocks {
  tracks: boolean;
  vias: boolean;
  pours: boolean;
  footprints: boolean;
}

/** keepout.add for a drawn polygon on the given layers, with its tier and what it blocks. */
export function keepoutOp(pts: readonly Pt[], o: { layers: CopperLayer[]; tier: KeepoutTier; blocks: KeepoutBlocks; name?: string }): PageOpCall | undefined {
  const outline = contourOf(pts);
  if (!outline || !o.layers.length || !Object.values(o.blocks).some(Boolean)) return undefined;
  return { op: "keepout.add", keepout: { outline, layers: [...o.layers], blocks: { ...o.blocks }, tier: o.tier, ...(o.name ? { name: o.name } : {}) }, handle: "k" };
}

/** via.add at a point (nanometers), on a net or none, with the board's via size. */
export function viaOp(at: Pt, o: { net?: string; outer: number; hole: number }): PageOpCall {
  return { op: "via.add", vias: [{ handle: "v", ...(o.net ? { net: o.net } : {}), x: Math.round(at.x), y: Math.round(at.y), outer_diameter: Math.round(o.outer), hole_diameter: Math.round(o.hole) }] };
}

/** The via size a person's via gets: the board's via rules (target, else floor), else 0.6 / 0.3 mm. */
export function viaSize(doc: BoardDocument): { outer: number; hole: number } {
  let outer: number | undefined;
  let hole: number | undefined;
  for (const tier of ["target", "floor"]) {
    for (const r of recordsOfKind(doc, "rule")) {
      if (r.tier !== tier || r.enabled === false || r.applies.nets?.length || r.applies.classes?.length || r.applies.region || r.applies.when) continue;
      const v = r.preferred ?? r.min;
      if (v === undefined) continue;
      if (r.check === "via_diameter" && outer === undefined) outer = v;
      if (r.check === "via_hole" && hole === undefined) hole = v;
    }
  }
  outer ??= 600_000;
  hole ??= 300_000;
  if (hole >= outer) hole = Math.round(outer / 2);
  return { outer, hole };
}

// ------------------------------------------------------------------ rip-up

/** Rip up the selection: unlocked tracks and vias are deleted; locked ones are reported, never removed. */
export function ripSelectionOps(doc: BoardDocument, ids: readonly string[]): { ops: PageOpCall[]; removed: string[]; skippedLocked: string[] } {
  const tracks: string[] = [];
  const vias: string[] = [];
  const skippedLocked: string[] = [];
  for (const id of new Set(ids)) {
    const r = doc.records.get(id);
    if (r?.kind !== "track" && r?.kind !== "via") continue;
    if (r.locked) skippedLocked.push(r.id);
    else (r.kind === "track" ? tracks : vias).push(r.id);
  }
  const ops: PageOpCall[] = [];
  if (tracks.length) ops.push({ op: "track.delete", ids: tracks });
  if (vias.length) ops.push({ op: "via.delete", ids: vias });
  return { ops, removed: [...tracks, ...vias], skippedLocked };
}

/** copper.rip of a whole net or of a drawn region (optionally on some layers). */
export function ripOp(target: { nets: string[] } | { region: Pt[]; layers?: CopperLayer[] }): PageOpCall | undefined {
  if ("nets" in target) return target.nets.length ? { op: "copper.rip", nets: [...target.nets] } : undefined;
  const region = contourOf(target.region);
  return region ? { op: "copper.rip", region, ...(target.layers?.length ? { layers: [...target.layers] } : {}) } : undefined;
}

/** The report of a reply (the first operation's), as the service returns it in `reports`. */
export function reportOf(reply: unknown, op?: string): Record<string, unknown> | undefined {
  const reps = (reply as { reports?: { op?: string; report: Record<string, unknown> }[] } | undefined)?.reports;
  if (!reps?.length) return undefined;
  return (op ? reps.find((r) => r.op === op) : reps[0])?.report;
}

/** A rip-up's report in words. */
export function ripSummary(report: Record<string, unknown> | undefined, local?: { removed: string[]; skippedLocked: string[] }): string {
  const removed = (report?.removed as string[] | undefined) ?? local?.removed ?? [];
  const locked = (report?.skippedLocked as string[] | undefined) ?? local?.skippedLocked ?? [];
  return `${removed.length} removed${locked.length ? ` · ${locked.length} locked kept (${locked.slice(0, 3).join(", ")}${locked.length > 3 ? ", …" : ""})` : " · nothing locked in reach"}`;
}

// ------------------------------------------------------------------ outline, silkscreen

/** The outline's corners (nanometers), if the board has one. */
export function outlineVertices(doc: BoardDocument): Vertex[] | undefined {
  const o = doc.records.get("outline");
  return o?.kind === "outline" ? o.outline : undefined;
}

/** The outline vertex nearest a point within `tol` nanometers. */
export function nearestVertex(vs: readonly Vertex[] | undefined, p: Pt, tol: number): number | undefined {
  if (!vs) return undefined;
  let best: number | undefined;
  let bd = tol;
  vs.forEach((v, i) => {
    const d = Math.hypot(v.x - p.x, v.y - p.y);
    if (d <= bd) {
      bd = d;
      best = i;
    }
  });
  return best;
}

/** outline.set with one vertex moved (the outline's other vertices and arcs kept). Detaches a CAD-driven outline only when asked. */
export function moveVertexOp(doc: BoardDocument, index: number, to: Pt, detach = false): PageOpCall | undefined {
  const vs = outlineVertices(doc);
  if (!vs || index < 0 || index >= vs.length) return undefined;
  const next = vs.map((v, i) => (i === index ? { ...v, x: Math.round(to.x), y: Math.round(to.y) } : { ...v }));
  return { op: "outline.set", outline: next, ...(detach ? { detach: true } : {}) };
}

/** Whether the outline is driven by a CAD source (a person's edit must detach it). */
export function outlineFromCad(doc: BoardDocument): string | undefined {
  const o = doc.records.get("outline");
  return o?.kind === "outline" && o.source.kind === "cad" ? (o.source as { ref?: string }).ref ?? "CAD" : undefined;
}

/** graphic.add of a silkscreen line (nanometers). */
export function lineOp(a: Pt, b: Pt, o: { layer?: string; stroke?: number } = {}): PageOpCall | undefined {
  if (Math.round(a.x) === Math.round(b.x) && Math.round(a.y) === Math.round(b.y)) return undefined;
  return { op: "graphic.add", graphic: { layer: o.layer ?? "top_silkscreen", shape: "line", start: { x: Math.round(a.x), y: Math.round(a.y) }, end: { x: Math.round(b.x), y: Math.round(b.y) }, stroke_width: o.stroke ?? 150_000 }, handle: "g" };
}

// ------------------------------------------------------------------ DXF

export interface DxfReport {
  entities: number;
  loops: number;
  outline?: { vertices: number; areaMm2: number };
  cutouts: number;
  open: number;
  units: string;
  skipped: { type: string; count: number; reason: string }[];
}

/** outline.import_dxf's report as the screen shows it (entities, loops, the outline, cutouts, what was skipped and why). */
export function dxfReport(report: Record<string, unknown> | undefined): DxfReport | undefined {
  if (!report) return undefined;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const o = report.outline as { vertices?: number; area?: number } | undefined;
  const cut = report.cutouts;
  return {
    entities: num(report.entities),
    loops: num(report.loops),
    ...(o ? { outline: { vertices: num(o.vertices), areaMm2: Number((num(o.area) / 1e12).toFixed(2)) } } : {}),
    cutouts: Array.isArray(cut) ? cut.length : num(cut),
    open: num(report.open),
    units: typeof report.units === "string" ? report.units : "?",
    skipped: Array.isArray(report.skipped) ? (report.skipped as { type?: string; count?: number; reason?: string }[]).map((s) => ({ type: String(s.type ?? "?"), count: num(s.count), reason: String(s.reason ?? "") })) : [],
  };
}

// ------------------------------------------------------------------ route start, timing

/** Where a route starts from what the pointer is on: a pad, a via, or the nearer end of a track. */
export function routeStartFor(doc: BoardDocument, hit: { id: string; kind: string } | undefined, at: Pt): { pad: string } | { via: string } | { track: string; end: "start" | "end" } | undefined {
  if (!hit) return undefined;
  if (hit.kind === "pad") return { pad: hit.id };
  const r: BoardRecord | undefined = doc.records.get(hit.id);
  if (r?.kind === "via") return { via: r.id };
  if (r?.kind === "track") return { track: r.id, end: Math.hypot(r.start.x - at.x, r.start.y - at.y) <= Math.hypot(r.end.x - at.x, r.end.y - at.y) ? "start" : "end" };
  return undefined;
}

/** Median, 95th percentile and maximum of samples (milliseconds, two decimals). */
export function latencyStats(samples: readonly number[]): { n: number; median: number; p95: number; max: number } {
  if (!samples.length) return { n: 0, median: 0, p95: 0, max: 0 };
  const s = [...samples].sort((a, b) => a - b);
  const at = (f: number) => s[Math.min(s.length - 1, Math.max(0, Math.ceil(f * s.length) - 1))];
  const r = (v: number) => Math.round(v * 100) / 100;
  return { n: s.length, median: r(s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2), p95: r(at(0.95)), max: r(s[s.length - 1]) };
}
