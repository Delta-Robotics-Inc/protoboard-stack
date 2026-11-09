/**
 * The checks: each turns the analysis of one board (model, rules, pair scan, connectivity) into findings of the
 * contract's `Finding` shape. Messages are built from facts only: ids, nets, layers, measured and required
 * values, rule ids and tiers. No rule note or other written text is copied into a message.
 */
import { byCodeUnit, findingId, toMm, type Box, type CopperLayer, type Finding, type RuleTier, type Vertex } from "@protoboardai/board";
import { CONTACT_EPS, type ConnectivityResult, type PairScan } from "./connectivity.js";
import { flattenContour, pointInPoly, polyCore, polygonsOverlap, shape, shapeGap, type Gap, type PolyCore, type Shape } from "./geom/shape.js";
import type { CheckModel, CopperItem, HoleItem } from "./model.js";
import type { ImplicitFloor, RuleBook, RuleCheckName, SubjectObject, Violation } from "./rules.js";

export interface Analysis {
  model: CheckModel;
  rules: RuleBook;
  scan: PairScan;
  connectivity: ConnectivityResult;
  inputHash: string;
  /** Checks that did not run, and why. */
  notRun: { check: string; reason: string }[];
  notes: string[];
}

export const fmt = (nm: number): string => `${toMm(Math.round(nm)).toFixed(4)} mm`;
const at = (x: number, y: number) => `(${toMm(Math.round(x)).toFixed(3)}, ${toMm(Math.round(y)).toFixed(3)}) mm`;
const netOf = (n: string | undefined) => (n === undefined ? "no net" : `net ${n}`);
/** The net an object is on for clearance and rule matching: its own, else the one it carries by contact. */
const netIs = (a: Analysis, id: string, net: string | undefined): string | undefined => net ?? a.connectivity.carried[id];
/** A net for messages: says when it is carried by contact rather than the object's own. */
const netSay = (a: Analysis, id: string, net: string | undefined): string => (net === undefined && a.connectivity.carried[id] !== undefined ? `no net; carries ${a.connectivity.carried[id]} by contact` : netOf(net));
const ruleText = (v: Violation) => (v.rule ? `${v.rule}, ${v.tier}` : v.implicit ? `${v.implicit}, ${v.tier}` : "built-in default");

/** A pad as a rule condition sees it: its footprint, number, type and position. */
function padInfo(a: Analysis, id: string): Partial<SubjectObject> {
  const wp = a.model.pads.get(id);
  if (!wp) return {};
  return { footprint: wp.footprint, pad: wp.pad.number, padType: wp.pad.type, at: { x: wp.x, y: wp.y } };
}

/** A copper item as a rule condition sees it. */
export function copperObj(a: Analysis, it: CopperItem): SubjectObject {
  const net = netIs(a, it.id, it.net);
  const o: SubjectObject = { id: it.id, kind: it.kind, layer: it.layer, shape: it.shape, ...(net !== undefined ? { net } : {}) };
  if (it.kind === "pad") return { ...o, ...padInfo(a, it.id) };
  const c = it.shape.core;
  if (it.kind === "via" && c.t === "pt") o.at = { x: c.x, y: c.y };
  if (it.kind === "track" && it.ends) {
    o.start = { x: it.ends[0], y: it.ends[1] };
    o.end = { x: it.ends[2], y: it.ends[3] };
  }
  return o;
}

/** A drilled hole as a rule condition sees it: its owner (the via or pad), with the hole's shape. */
function holeObj(a: Analysis, h: HoleItem): SubjectObject {
  const net = netIs(a, h.id, h.net);
  const o: SubjectObject = { id: h.id, kind: h.kind, shape: h.shape, ...(net !== undefined ? { net } : {}) };
  if (h.kind === "pad") return { ...o, ...padInfo(a, h.id) };
  const c = h.shape.core;
  if (c.t === "pt") o.at = { x: c.x, y: c.y };
  return o;
}
const costText = (v: Violation) => (v.cost !== undefined ? `, cost ${v.cost}` : "");

function listIds(ids: readonly string[], max = 5): string {
  if (ids.length <= max) return ids.join(", ");
  return `${ids.slice(0, max).join(", ")} and ${ids.length - max} more`;
}

const roundBox = (b: Box): Box => ({ minX: Math.floor(b.minX), minY: Math.floor(b.minY), maxX: Math.ceil(b.maxX), maxY: Math.ceil(b.maxY) });
const unionBox = (...bs: Box[]): Box => ({ minX: Math.min(...bs.map((b) => b.minX)), minY: Math.min(...bs.map((b) => b.minY)), maxX: Math.max(...bs.map((b) => b.maxX)), maxY: Math.max(...bs.map((b) => b.maxY)) });

export function makeFinding(
  check: string,
  severity: "error" | "warning" | "info",
  objects: readonly string[],
  loc: { x: number; y: number; layer?: string },
  message: string,
  extra: { rule?: string; tier?: RuleTier; box?: Box; measured?: number; required?: number } = {},
): Finding {
  const location = { x: Math.round(loc.x), y: Math.round(loc.y), ...(loc.layer ? { layer: loc.layer } : {}) };
  const objs = [...new Set(objects)].sort(byCodeUnit).slice(0, 1000);
  return {
    id: findingId(check, extra.rule, objs, location),
    check,
    ...(extra.rule ? { rule: extra.rule } : {}),
    ...(extra.tier ? { tier: extra.tier } : {}),
    severity,
    objects: objs,
    location,
    ...(extra.box ? { box: roundBox(extra.box) } : {}),
    ...(extra.measured !== undefined ? { measured: Math.round(extra.measured) } : {}),
    ...(extra.required !== undefined ? { required: Math.round(extra.required) } : {}),
    message: message.length > 500 ? `${message.slice(0, 497)}...` : message,
  };
}

function violationFindings(check: string, vs: Violation[], objects: string[], loc: { x: number; y: number; layer?: string }, measured: number | undefined, box: Box | undefined, what: (v: Violation) => string): Finding[] {
  return vs.map((v) =>
    makeFinding(check, v.severity, objects, loc, what(v), {
      ...(v.rule ? { rule: v.rule } : {}),
      ...(v.tier ? { tier: v.tier } : {}),
      ...(box ? { box } : {}),
      ...(measured !== undefined ? { measured } : {}),
      ...(v.required !== undefined ? { required: v.required } : {}),
    }),
  );
}

const bound = (v: Violation) => (v.bound === "max" ? "above" : "below");

// ---------------------------------------------------------------- connectivity findings

export function unconnectedFindings(a: Analysis): Finding[] {
  return a.connectivity.links.map((l) =>
    makeFinding("unconnected", "error", [l.from.object, l.to.object], { x: (l.from.x + l.to.x) / 2, y: (l.from.y + l.to.y) / 2, layer: l.from.layer }, `Net ${l.net} is not connected between ${l.from.object} at ${at(l.from.x, l.from.y)} on ${l.from.layer} and ${l.to.object} at ${at(l.to.x, l.to.y)} on ${l.to.layer}, ${fmt(l.length)} apart.`, {
      box: { minX: Math.min(l.from.x, l.to.x), minY: Math.min(l.from.y, l.to.y), maxX: Math.max(l.from.x, l.to.x), maxY: Math.max(l.from.y, l.to.y) },
      measured: l.length,
    }),
  );
}

export function shortFindings(a: Analysis): Finding[] {
  return a.connectivity.shorts.map((s) =>
    makeFinding(
      "short",
      "error",
      s.objects,
      { x: s.x, y: s.y, layer: s.layer },
      s.bridged
        ? `Nets ${s.nets[0]} and ${s.nets[1]} are joined through copper without a net (${listIds(s.objects)}) on ${s.layer} near ${at(s.x, s.y)}.`
        : `${s.objects[0]} and ${s.objects[1]} touch on ${s.layer} at ${at(s.x, s.y)}, joining nets ${s.nets[0]} and ${s.nets[1]}.`,
      { measured: 0, box: s.box },
    ),
  );
}

export function unassignedFindings(a: Analysis): Finding[] {
  return a.connectivity.unassigned.map((u) =>
    makeFinding("unassigned_copper", "warning", [u.object, u.touches], { x: u.x, y: u.y, layer: u.layer }, `${u.object} has no net and touches ${u.touches} of net ${u.net} on ${u.layer} at ${at(u.x, u.y)}.`, { box: u.box }),
  );
}

export function danglingFindings(a: Analysis): Finding[] {
  return a.connectivity.dangling.map((d) =>
    d.kind === "track"
      ? makeFinding("dangling", "warning", [d.object], { x: d.x, y: d.y, layer: d.layer }, `Track end of ${d.object} (${netOf(d.net)}) at ${at(d.x, d.y)} on ${d.layer} touches no other copper.`, { box: d.box })
      : makeFinding("dangling", "warning", [d.object], { x: d.x, y: d.y, layer: d.layer }, `Via ${d.object} (${netOf(d.net)}) at ${at(d.x, d.y)} meets other copper on ${d.connectedLayers} of its layers.`, { box: d.box }),
  );
}

export function isolatedFindings(a: Analysis): Finding[] {
  return a.connectivity.isolated.map((s) =>
    makeFinding("isolated_copper", "warning", s.objects, { x: s.x, y: s.y, layer: s.layer }, `Zone fill of net ${s.net} near ${at(s.x, s.y)} on ${s.layer} touches no pad, track or via of its net (${listIds(s.objects)}).`, { box: s.box }),
  );
}

// ---------------------------------------------------------------- copper clearance

/** A filled zone's own clearance (its intent's `clearance`), the minimum between its fill and copper of other nets. */
function zoneClearance(a: Analysis, it: CopperItem): number | undefined {
  if (it.kind !== "zone") return undefined;
  const z = a.model.doc.records.get(it.id);
  return z?.kind === "zone" ? z.clearance : undefined;
}

/**
 * Copper clearance between objects of different nets. A filled zone's own clearance is a floor at priority 0 for
 * the gap between its fill and other copper: it combines with priority-0 floors (net classes, board setup) by the
 * largest minimum and gives way to any matching floor of a higher priority (a KiCad custom rule), as in KiCad.
 * One finding per object pair (the closest approach over their layers and fill parts).
 */
export function clearanceFindings(a: Analysis): Finding[] {
  const hasRules = a.rules.has("clearance");
  const best = new Map<string, { p: (typeof a.scan.near)[number]; vs: Violation[] }>();
  for (const p of a.scan.near) {
    const A = a.model.copper[p.a];
    const B = a.model.copper[p.b];
    const na = netIs(a, A.id, A.net);
    const nb = netIs(a, B.id, B.net);
    // copper carrying the same net by contact is one net, as for copper that names it
    if (na !== undefined && na === nb) continue;
    const implicit: ImplicitFloor[] = [];
    for (const it of [A, B]) {
      const zc = zoneClearance(a, it);
      if (zc !== undefined && zc > 0) implicit.push({ min: zc, label: `zone ${it.id} clearance` });
    }
    if (!hasRules && !implicit.length) continue;
    const vs = a.rules.evaluate("clearance", p.gap, { nets: [na, nb], kinds: [A.kind, B.kind], layers: [A.layer], at: { x: p.x, y: p.y }, shapes: [A.shape, B.shape], objects: [copperObj(a, A), copperObj(a, B)] }, implicit);
    if (!vs.length) continue;
    // KiCad names a zone once per layer and other objects once: a pair with a zone is one pair per layer
    const key = [A.id, B.id].sort(byCodeUnit).join("\u0000") + (A.kind === "zone" || B.kind === "zone" ? `\u0000${A.layer}` : "");
    const prev = best.get(key);
    if (!prev || p.gap < prev.p.gap) best.set(key, { p, vs });
  }
  const out: Finding[] = [];
  for (const { p, vs } of best.values()) {
    const A = a.model.copper[p.a];
    const B = a.model.copper[p.b];
    out.push(
      ...violationFindings("clearance", vs, [A.id, B.id], { x: p.x, y: p.y, layer: A.layer }, p.gap, unionBox(A.shape.box, B.shape.box), (v) =>
        `Clearance ${fmt(p.gap)} between ${A.id} (${netSay(a, A.id, A.net)}) and ${B.id} (${netSay(a, B.id, B.net)}) on ${A.layer} is ${bound(v)} ${fmt(v.required!)} (${ruleText(v)}${costText(v)}).`,
      ),
    );
  }
  return out;
}

/**
 * Physical clearance: the gap between any two copper objects, of the same net or not (KiCad's physical_clearance),
 * where a rule asks for one. Only pairs some rule matches are measured. One finding per object pair.
 */
export function physicalClearanceFindings(a: Analysis): Finding[] {
  if (!a.rules.has("physical_clearance")) return [];
  const m = a.model;
  const radius = a.rules.maxMin("physical_clearance");
  if (radius <= 0) return [];
  const best = new Map<string, { A: CopperItem; B: CopperItem; gap: number; x: number; y: number; vs: Violation[] }>();
  const g: Gap = { gap: 0, x: 0, y: 0 };
  for (const layer of m.layers) {
    const grid = m.grids.get(layer)!;
    for (const A of m.copper) {
      if (A.layer !== layer) continue;
      const cand = grid.search({ minX: A.shape.box.minX - radius, minY: A.shape.box.minY - radius, maxX: A.shape.box.maxX + radius, maxY: A.shape.box.maxY + radius });
      for (const j of cand) {
        if (j <= A.i) continue;
        const B = m.copper[j];
        if (B.id === A.id) continue;
        const s = { nets: [netIs(a, A.id, A.net), netIs(a, B.id, B.net)], kinds: [A.kind, B.kind], layers: [layer], at: { x: 0, y: 0 }, shapes: [A.shape, B.shape], objects: [copperObj(a, A), copperObj(a, B)] };
        const r = a.rules.resolve("physical_clearance", s);
        if (!r.floor.length && !r.target.length && !r.policy.length && !r.no_go.length) continue;
        const d = shapeGap(A.shape, B.shape, radius, g);
        if (!(d < radius)) continue;
        s.at = { x: g.x, y: g.y };
        const vs = a.rules.evaluate("physical_clearance", d, s);
        if (!vs.length) continue;
        const key = [A.id, B.id].sort(byCodeUnit).join("\u0000");
        const prev = best.get(key);
        if (!prev || d < prev.gap) best.set(key, { A, B, gap: d, x: g.x, y: g.y, vs });
      }
    }
  }
  const out: Finding[] = [];
  for (const { A, B, gap, x, y, vs } of best.values())
    out.push(
      ...violationFindings("physical_clearance", vs, [A.id, B.id], { x, y, layer: A.layer }, gap, unionBox(A.shape.box, B.shape.box), (v) =>
        `Physical clearance ${fmt(gap)} between ${A.id} (${netSay(a, A.id, A.net)}) and ${B.id} (${netSay(a, B.id, B.net)}) on ${A.layer} is ${bound(v)} ${fmt(v.required!)} (${ruleText(v)}${costText(v)}).`,
      ),
    );
  return out;
}

// ---------------------------------------------------------------- sizes

export function trackWidthFindings(a: Analysis): Finding[] {
  if (!a.rules.has("track_width")) return [];
  const out: Finding[] = [];
  for (const t of a.model.copper) {
    if (t.kind !== "track") continue;
    const w = t.shape.r * 2;
    const e = t.ends!;
    const loc = { x: (e[0] + e[2]) / 2, y: (e[1] + e[3]) / 2, layer: t.layer };
    const vs = a.rules.evaluate("track_width", w, { nets: [netIs(a, t.id, t.net)], kinds: ["track"], layers: [t.layer], at: loc, shapes: [t.shape], objects: [copperObj(a, t)] });
    out.push(...violationFindings("track_width", vs, [t.id], loc, w, t.shape.box, (v) => `Track ${t.id} (${netSay(a, t.id, t.net)}) on ${t.layer} is ${fmt(w)} wide, ${bound(v)} ${fmt(v.required!)} (${ruleText(v)}${costText(v)}).`));
  }
  return out;
}

export function viaSizeFindings(a: Analysis, check: "via_diameter" | "via_hole"): Finding[] {
  if (!a.rules.has(check)) return [];
  const out: Finding[] = [];
  for (const v of a.model.doc.records.values()) {
    if (v.kind !== "via") continue;
    const size = check === "via_diameter" ? v.outer_diameter : v.hole_diameter;
    const hole = a.model.holes.find((h) => h.id === v.id);
    const layers = hole?.layers ?? [v.from_layer, v.to_layer];
    const loc = { x: v.x, y: v.y, layer: v.from_layer };
    const net = netIs(a, v.id, v.net);
    const obj: SubjectObject = { id: v.id, kind: "via", at: { x: v.x, y: v.y }, shape: hole?.shape ?? { core: { t: "pt", x: v.x, y: v.y }, r: v.outer_diameter / 2, box: { minX: v.x - v.outer_diameter / 2, minY: v.y - v.outer_diameter / 2, maxX: v.x + v.outer_diameter / 2, maxY: v.y + v.outer_diameter / 2 } } as Shape, ...(net !== undefined ? { net } : {}) };
    const vs = a.rules.evaluate(check, size, { nets: [net], kinds: [check === "via_hole" ? "hole" : "via"], layers, at: loc, objects: [obj] });
    const word = check === "via_diameter" ? "diameter" : "hole";
    out.push(...violationFindings(check, vs, [v.id], loc, size, { minX: v.x - v.outer_diameter / 2, minY: v.y - v.outer_diameter / 2, maxX: v.x + v.outer_diameter / 2, maxY: v.y + v.outer_diameter / 2 }, (x) => `Via ${v.id} (${netOf(v.net)}) ${word} ${fmt(size)} is ${bound(x)} ${fmt(x.required!)} (${ruleText(x)}${costText(x)}).`));
  }
  return out;
}

/**
 * Hole size of every drilled hole, vias and pads (KiCad's hole_size and minimum through hole). A slot is measured
 * by its narrower side against a minimum and its wider side against a maximum.
 */
export function holeSizeFindings(a: Analysis): Finding[] {
  if (!a.rules.has("hole_size")) return [];
  const out: Finding[] = [];
  for (const h of a.model.holes) {
    const b = h.shape.box;
    const w = b.maxX - b.minX;
    const ht = b.maxY - b.minY;
    let narrow: number;
    let wide: number;
    if (h.kind === "via") {
      const v = a.model.doc.records.get(h.id);
      narrow = wide = v?.kind === "via" ? v.hole_diameter : Math.min(w, ht);
    } else {
      const p = a.model.pads.get(h.id)?.pad;
      const hw = p?.hole_width ?? p?.hole_diameter ?? Math.min(w, ht);
      const hh = p?.hole_height ?? p?.hole_diameter ?? Math.min(w, ht);
      narrow = Math.min(hw, hh);
      wide = Math.max(hw, hh);
    }
    const c = h.shape.core;
    const loc = c.t === "pt" ? { x: c.x, y: c.y } : { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
    const s = { nets: [netIs(a, h.id, h.net)], kinds: ["hole" as const], layers: h.layers, at: loc, shapes: [h.shape], objects: [holeObj(a, h)] };
    const what = h.kind === "via" ? "Via" : "Pad";
    for (const [size, side] of [
      [narrow, "min"],
      [wide, "max"],
    ] as const) {
      const vs = a.rules.evaluate("hole_size", size, s).filter((v) => v.bound === side);
      out.push(...violationFindings("hole_size", vs, [h.id], loc, size, h.shape.box, (x) => `${what} ${h.id} (${netOf(h.net)}) hole ${fmt(size)} is ${bound(x)} ${fmt(x.required!)} (${ruleText(x)}${costText(x)}).`));
    }
  }
  return out;
}

export function annularRingFindings(a: Analysis): Finding[] {
  if (!a.rules.has("annular_ring")) return [];
  const out: Finding[] = [];
  for (const v of a.model.doc.records.values()) {
    if (v.kind !== "via") continue;
    const ring = (v.outer_diameter - v.hole_diameter) / 2;
    const loc = { x: v.x, y: v.y, layer: v.from_layer };
    const vnet = netIs(a, v.id, v.net);
    const vs = a.rules.evaluate("annular_ring", ring, { nets: [vnet], kinds: ["via"], layers: [v.from_layer, v.to_layer], at: loc, objects: [{ id: v.id, kind: "via", at: { x: v.x, y: v.y }, shape: { core: { t: "pt", x: v.x, y: v.y }, r: v.outer_diameter / 2, box: { minX: v.x - v.outer_diameter / 2, minY: v.y - v.outer_diameter / 2, maxX: v.x + v.outer_diameter / 2, maxY: v.y + v.outer_diameter / 2 } } as Shape, ...(vnet !== undefined ? { net: vnet } : {}) }] });
    out.push(...violationFindings("annular_ring", vs, [v.id], loc, ring, undefined, (x) => `Via ${v.id} (${netOf(v.net)}) annular ring ${fmt(ring)} is ${bound(x)} ${fmt(x.required!)} (${ruleText(x)}${costText(x)}).`));
  }
  for (const [id, wp] of a.model.pads) {
    const p = wp.pad;
    if (p.type !== "th") continue;
    let ring: number;
    if (p.shape === "circle" && p.outer_diameter !== undefined && p.hole_diameter !== undefined) ring = (p.outer_diameter - p.hole_diameter) / 2;
    else {
      const ow = p.outer_width ?? p.outer_diameter ?? 0;
      const oh = p.outer_height ?? p.outer_diameter ?? 0;
      const hw = p.hole_width ?? p.hole_diameter ?? 0;
      const hh = p.hole_height ?? p.hole_diameter ?? 0;
      ring = Math.min((ow - hw) / 2, (oh - hh) / 2);
    }
    const net = a.model.doc.padNets.get(id);
    const loc = { x: wp.x, y: wp.y };
    const vs = a.rules.evaluate("annular_ring", ring, { nets: [net], kinds: ["pad"], layers: wp.layers, at: loc, objects: [{ id, kind: "pad", shape: wp.shape, ...(net !== undefined ? { net } : {}), ...padInfo(a, id) }] });
    out.push(...violationFindings("annular_ring", vs, [id], loc, ring, wp.box, (x) => `Pad ${id} (${netOf(net)}) annular ring ${fmt(ring)} is ${bound(x)} ${fmt(x.required!)} (${ruleText(x)}${costText(x)}).`));
  }
  return out;
}

// ---------------------------------------------------------------- holes

export function holeToHoleFindings(a: Analysis): Finding[] {
  const radius = a.rules.maxMin("hole_to_hole");
  if (!a.rules.has("hole_to_hole") || radius <= 0) return [];
  const out: Finding[] = [];
  const g: Gap = { gap: 0, x: 0, y: 0 };
  for (const h of a.model.holes) {
    const cand = a.model.holeGrid.search({ minX: h.shape.box.minX - radius, minY: h.shape.box.minY - radius, maxX: h.shape.box.maxX + radius, maxY: h.shape.box.maxY + radius });
    for (const j of cand) {
      if (j <= h.i) continue;
      const o = a.model.holes[j];
      if (o.id === h.id) continue;
      const d = shapeGap(h.shape, o.shape, radius, g);
      if (!(d < radius)) continue;
      const vs = a.rules.evaluate("hole_to_hole", d, { nets: [netIs(a, h.id, h.net), netIs(a, o.id, o.net)], kinds: ["hole", "hole"], at: { x: g.x, y: g.y }, shapes: [h.shape, o.shape], objects: [holeObj(a, h), holeObj(a, o)] });
      out.push(...violationFindings("hole_to_hole", vs, [h.id, o.id], { x: g.x, y: g.y }, d, unionBox(h.shape.box, o.shape.box), (v) => `Holes of ${h.id} and ${o.id} are ${fmt(d)} apart, ${bound(v)} ${fmt(v.required!)} (${ruleText(v)}${costText(v)}).`));
    }
  }
  return out;
}

export function holeClearanceFindings(a: Analysis): Finding[] {
  const radius = a.rules.maxMin("hole_clearance");
  if (!a.rules.has("hole_clearance") || radius <= 0) return [];
  const out: Finding[] = [];
  const g: Gap = { gap: 0, x: 0, y: 0 };
  // one finding per pair of objects (the hole of A near B and the hole of B near A are one pair, as KiCad reports it)
  const pairs = new Map<string, { h: HoleItem; item: CopperItem; gap: number; x: number; y: number; vs: Violation[] }>();
  for (const h of a.model.holes) {
    // the closest approach per object over the layers the drill passes
    const best = new Map<string, { item: CopperItem; gap: number; x: number; y: number }>();
    for (const layer of h.layers) {
      const grid = a.model.grids.get(layer);
      if (!grid) continue;
      const cand = grid.search({ minX: h.shape.box.minX - radius, minY: h.shape.box.minY - radius, maxX: h.shape.box.maxX + radius, maxY: h.shape.box.maxY + radius });
      for (const j of cand) {
        const it = a.model.copper[j];
        if (it.id === h.id) continue;
        const hn = netIs(a, h.id, h.net);
        if (h.plated && hn !== undefined && netIs(a, it.id, it.net) === hn) continue;
        const d = shapeGap(h.shape, it.shape, radius, g);
        if (!(d < radius)) continue;
        const key = `${it.id}\u0000${it.kind === "zone" ? `${it.layer}#${it.part}` : ""}`;
        const prev = best.get(key);
        if (!prev || d < prev.gap) best.set(key, { item: it, gap: d, x: g.x, y: g.y });
      }
    }
    for (const { item, gap, x, y } of [...best.values()].sort((p, q) => byCodeUnit(p.item.id, q.item.id))) {
      const vs = a.rules.evaluate("hole_clearance", gap, { nets: [netIs(a, h.id, h.net), netIs(a, item.id, item.net)], kinds: ["hole", item.kind], layers: [item.layer], at: { x, y }, shapes: [h.shape, item.shape], objects: [holeObj(a, h), copperObj(a, item)] });
      if (!vs.length) continue;
      const key = [h.id, item.id].sort(byCodeUnit).join("\u0000") + (item.kind === "zone" ? `\u0000${item.layer}` : "");
      const prev = pairs.get(key);
      if (!prev || gap < prev.gap) pairs.set(key, { h, item, gap, x, y, vs });
    }
  }
  for (const { h, item, gap, x, y, vs } of pairs.values())
    out.push(...violationFindings("hole_clearance", vs, [h.id, item.id], { x, y, layer: item.layer }, gap, unionBox(h.shape.box, item.shape.box), (v) => `Hole of ${h.id} is ${fmt(gap)} from ${item.id} (${netSay(a, item.id, item.net)}) on ${item.layer}, ${bound(v)} ${fmt(v.required!)} (${ruleText(v)}${costText(v)}).`));
  return out;
}

// ---------------------------------------------------------------- board edge

export function edgeClearanceFindings(a: Analysis): Finding[] {
  const m = a.model;
  if (!m.region) return [];
  const hasRules = a.rules.has("edge_clearance");
  const radius = Math.max(CONTACT_EPS, a.rules.maxMin("edge_clearance"));
  const out: Finding[] = [];
  const g: Gap = { gap: 0, x: 0, y: 0 };
  const perObject = new Map<string, { item: CopperItem; gap: number; x: number; y: number; outside: boolean; edge: string }>();
  for (const it of m.copper) {
    let best = Infinity;
    let bx = 0,
      by = 0,
      edge = "outline";
    const cand = m.edgeGrid.search({ minX: it.shape.box.minX - radius, minY: it.shape.box.minY - radius, maxX: it.shape.box.maxX + radius, maxY: it.shape.box.maxY + radius });
    for (const j of cand) {
      const e = m.edges[j];
      const d = shapeGap(it.shape, e.shape, Math.min(best, radius), g);
      if (d < best) {
        best = d;
        bx = g.x;
        by = g.y;
        edge = e.id;
      }
    }
    let outside = false;
    if (best > 0) {
      const c = it.shape.core;
      const [x, y] = c.t === "pt" ? [c.x, c.y] : c.t === "seg" ? [c.ax, c.ay] : c.t === "arc" ? [c.sx, c.sy] : [c.rings[0][0], c.rings[0][1]];
      if (!pointInPoly(m.region, x, y)) {
        outside = true;
        best = 0;
        bx = x;
        by = y;
      }
    }
    if (!(best < radius)) continue;
    const key = it.kind === "zone" ? `${it.id}\u0000${it.layer}#${it.part}` : it.id;
    const prev = perObject.get(key);
    if (!prev || best < prev.gap) perObject.set(key, { item: it, gap: best, x: bx, y: by, outside, edge });
  }
  for (const { item, gap, x, y, outside, edge } of perObject.values()) {
    const what = outside ? `lies outside the board outline` : gap === 0 ? `crosses the board edge (${edge})` : `is ${fmt(gap)} from the board edge (${edge})`;
    const loc = { x, y, layer: item.layer };
    const edgeKind = edge === "outline" ? ("outline" as const) : ("cutout" as const);
    const s = { nets: [netIs(a, item.id, item.net)], kinds: [item.kind, edgeKind] as ["pad", "outline"], layers: [item.layer], at: { x, y }, shapes: [item.shape], objects: [copperObj(a, item), { id: edge, kind: edgeKind }] };
    const vs = hasRules ? a.rules.evaluate("edge_clearance", gap, s) : [];
    if (vs.length) out.push(...violationFindings("edge_clearance", vs, [item.id, edge], loc, gap, item.shape.box, (v) => `${item.id} (${netOf(item.net)}) on ${item.layer} ${what}; the limit is ${fmt(v.required!)} (${ruleText(v)}${costText(v)}).`));
    else if (gap === 0 && (!hasRules || a.rules.resolve("edge_clearance", s).floor.every((r) => r.severity !== "ignore")))
      out.push(makeFinding("edge_clearance", "error", [item.id, edge], loc, `${item.id} (${netOf(item.net)}) on ${item.layer} ${what} (built-in default: copper must stay inside the board).`, { box: item.shape.box, measured: 0, required: 0 }));
  }
  return out;
}

// ---------------------------------------------------------------- footprints, silkscreen, vias

export function courtyardFindings(a: Analysis): Finding[] {
  const out: Finding[] = [];
  const cs = a.model.courtyards;
  for (let i = 0; i < cs.length; i++)
    for (let j = i + 1; j < cs.length; j++) {
      const A = cs[i];
      const B = cs[j];
      if (A.side !== B.side) continue;
      const hit = polygonsOverlap(A.poly, B.poly);
      if (!hit) continue;
      const layer = `${A.side}_courtyard`;
      const vs = a.rules.flag("courtyard_overlap", { nets: [], kinds: ["footprint", "footprint"], layers: [layer], at: hit, shapes: [shape(A.poly), shape(B.poly)], objects: [{ id: A.footprint, kind: "footprint", footprint: A.footprint, shape: shape(A.poly) }, { id: B.footprint, kind: "footprint", footprint: B.footprint, shape: shape(B.poly) }] }, "error");
      out.push(...violationFindings("courtyard_overlap", vs, [A.footprint, B.footprint], { ...hit, layer }, undefined, unionBox(A.poly.box, B.poly.box), (v) => `Courtyards of ${A.ref} (${A.footprint}) and ${B.ref} (${B.footprint}) overlap on the ${A.side} near ${at(hit.x, hit.y)} (${ruleText(v)}${costText(v)}).`));
    }
  return out;
}

/**
 * Silkscreen over pads: one finding per silkscreen element (a line, shape or text) that comes too near or over
 * pads, naming every pad it reaches, as KiCad reports one item per silkscreen element. The finding takes the most
 * severe violation among those pads and the smallest gap.
 */
export function silkToPadFindings(a: Analysis): Finding[] {
  const m = a.model;
  const hasRules = a.rules.has("silk_to_pad");
  const radius = Math.max(CONTACT_EPS, a.rules.maxMin("silk_to_pad"));
  const out: Finding[] = [];
  const g: Gap = { gap: 0, x: 0, y: 0 };
  const rank = (v: Violation) => (v.severity === "error" ? 0 : v.severity === "warning" ? 1 : 2);
  m.silk.forEach((s) => {
    const layer: CopperLayer = s.layer === "top_silkscreen" ? "top" : "bottom";
    const grid = m.grids.get(layer);
    if (!grid) return;
    const cand = grid.search({ minX: s.box.minX - radius, minY: s.box.minY - radius, maxX: s.box.maxX + radius, maxY: s.box.maxY + radius });
    const pads: string[] = [];
    let worst: { v?: Violation; gap: number; x: number; y: number; box: Box } | undefined;
    const seen = new Set<string>();
    for (const j of cand) {
      const pad = m.copper[j];
      if (pad.kind !== "pad" || seen.has(pad.id)) continue;
      seen.add(pad.id);
      let best = Infinity,
        bx = 0,
        by = 0;
      for (const sh of s.shapes) {
        const d = shapeGap(sh, pad.shape, Math.min(best, radius), g);
        if (d < best) {
          best = d;
          bx = g.x;
          by = g.y;
        }
      }
      if (!(best < radius)) continue;
      const subject = { nets: [pad.net], kinds: [s.textBox ? "text" : "graphic", "pad"] as ["text", "pad"], layers: [s.layer], at: { x: bx, y: by }, shapes: [pad.shape, ...s.shapes], objects: [{ id: s.id, kind: s.textBox ? ("text" as const) : ("graphic" as const), layer: s.layer, ...(s.footprint ? { footprint: s.footprint } : {}) }, copperObj(a, pad)] };
      let v: Violation | undefined;
      if (hasRules) {
        const vs = a.rules.evaluate("silk_to_pad", best, subject).sort((p, q) => rank(p) - rank(q));
        if (!vs.length) continue;
        v = vs[0];
      } else if (best !== 0) continue;
      pads.push(pad.id);
      const box = unionBox(s.box, pad.shape.box);
      if (!worst || (v && worst.v && rank(v) < rank(worst.v)) || ((!v || !worst.v || rank(v) === rank(worst.v)) && best < worst.gap)) worst = { ...(v ? { v } : {}), gap: best, x: bx, y: by, box: worst ? unionBox(worst.box, box) : box };
      else worst.box = unionBox(worst.box, box);
    }
    if (!worst) return;
    const approx = s.textBox ? " (text checked as its box)" : "";
    const what = pads.length === 1 ? `pad ${pads[0]}` : `${pads.length} pads (${listIds(pads.sort(byCodeUnit))})`;
    const loc = { x: worst.x, y: worst.y, layer: s.layer };
    if (worst.v) out.push(...violationFindings("silk_to_pad", [worst.v], [s.id, ...pads], loc, worst.gap, worst.box, (v) => `Silkscreen of ${s.id} on ${s.layer} is ${fmt(worst!.gap)} from ${what}, ${bound(v)} ${fmt(v.required!)}${approx} (${ruleText(v)}${costText(v)}).`));
    else out.push(makeFinding("silk_to_pad", "warning", [s.id, ...pads], loc, `Silkscreen of ${s.id} overlaps ${what} on ${s.layer}${approx} (built-in default).`, { box: worst.box, measured: 0, required: 0 }));
  });
  return out;
}

export function viaInPadFindings(a: Analysis): Finding[] {
  if (!a.rules.has("via_in_pad")) return [];
  const m = a.model;
  const out: Finding[] = [];
  const seen = new Set<string>();
  const g: Gap = { gap: 0, x: 0, y: 0 };
  for (const v of m.copper) {
    if (v.kind !== "via") continue;
    const cand = m.grids.get(v.layer)!.search(v.shape.box);
    for (const j of cand) {
      const p = m.copper[j];
      if (p.kind !== "pad") continue;
      const key = `${v.id}\u0000${p.id}`;
      if (seen.has(key)) continue;
      if (shapeGap(v.shape, p.shape, CONTACT_EPS, g) > CONTACT_EPS) continue;
      seen.add(key);
      const c = v.shape.core as { x: number; y: number };
      const vs = a.rules.flag("via_in_pad", { nets: [v.net, p.net], kinds: ["via", "pad"], layers: [v.layer], at: c, shapes: [v.shape], objects: [copperObj(a, v), copperObj(a, p)] });
      out.push(...violationFindings("via_in_pad", vs, [v.id, p.id], { x: c.x, y: c.y, layer: v.layer }, undefined, unionBox(v.shape.box, p.shape.box), (x) => `Via ${v.id} (${netOf(v.net)}) is in pad ${p.id} (${netOf(p.net)}) on ${v.layer} (${ruleText(x)}${costText(x)}).`));
    }
  }
  return out;
}

export function viaUnderFootprintFindings(a: Analysis): Finding[] {
  if (!a.rules.has("via_under_footprint")) return [];
  const m = a.model;
  const out: Finding[] = [];
  for (const h of m.holes) {
    if (h.kind !== "via") continue;
    const c = h.shape.core as { x: number; y: number };
    for (const cy of m.courtyards) {
      const outer = cy.side === "top" ? m.layers[0] : m.layers[m.layers.length - 1];
      if (!h.layers.includes(outer)) continue;
      if (!pointInPoly(cy.poly, c.x, c.y)) continue;
      const vs = a.rules.flag("via_under_footprint", { nets: [h.net], kinds: ["via", "footprint"], layers: [outer], at: c, shapes: [h.shape], objects: [holeObj(a, h), { id: cy.footprint, kind: "footprint", footprint: cy.footprint, shape: shape(cy.poly) }] });
      out.push(...violationFindings("via_under_footprint", vs, [h.id, cy.footprint], { x: c.x, y: c.y, layer: outer }, undefined, h.shape.box, (x) => `Via ${h.id} (${netOf(h.net)}) is under ${cy.ref} (${cy.footprint}) on the ${cy.side} (${ruleText(x)}${costText(x)}).`));
    }
  }
  return out;
}

// ---------------------------------------------------------------- keep-outs

/**
 * Keep-outs: copper and footprints inside a keep-out that blocks them. A keep-out is a disallow at priority 0: an
 * object a `disallow` rule of a higher priority matches is reported by that rule instead (`disallowFindings`), as
 * KiCad's custom rules take precedence over its rule areas.
 */
export function keepoutFindings(a: Analysis): Finding[] {
  const m = a.model;
  const out: Finding[] = [];
  const overridden = (o: SubjectObject, layers: string[]) => a.rules.has("disallow") && a.rules.disallowPriority({ nets: [o.net], kinds: [o.kind], layers, at: o.at ?? { x: 0, y: 0 }, ...(o.shape ? { shapes: [o.shape] } : {}), objects: [o] }) > 0;
  for (const k of m.doc.records.values()) {
    if (k.kind !== "keepout") continue;
    const region = keepoutPoly(k.outline, k.holes);
    const regionShape: Shape = shape(region, 0);
    const severity = k.tier === "no_go" ? "error" : "warning";
    const kinds = new Set<string>();
    if (k.blocks.tracks) kinds.add("track");
    if (k.blocks.vias) kinds.add("via");
    if (k.blocks.pours) kinds.add("zone");
    const seen = new Set<string>();
    const g: Gap = { gap: 0, x: 0, y: 0 };
    for (const layer of k.layers) {
      const grid = m.grids.get(layer);
      if (!grid) continue;
      for (const j of grid.search(region.box)) {
        const it = m.copper[j];
        if (!kinds.has(it.kind)) continue;
        const key = `${it.id}#${it.part ?? ""}`;
        if (seen.has(key)) continue;
        // inside means overlapping by more than CONTACT_EPS: fill clipped at the keep-out's edge only touches it
        let hit: { x: number; y: number } | undefined;
        if (it.shape.r > CONTACT_EPS) {
          if (shapeGap({ ...it.shape, r: it.shape.r - CONTACT_EPS }, regionShape, 0, g) === 0) hit = { x: g.x, y: g.y };
        } else if (it.shape.core.t === "poly") hit = polygonsOverlap(it.shape.core, region, CONTACT_EPS);
        else if (shapeGap(it.shape, regionShape, 0, g) === 0 && pointInPoly(region, g.x, g.y)) hit = { x: g.x, y: g.y };
        if (!hit) continue;
        g.x = hit.x;
        g.y = hit.y;
        seen.add(key);
        if (overridden(copperObj(a, it), [layer])) continue;
        out.push(makeFinding("keepout", severity, [k.id, it.id], { x: g.x, y: g.y, layer }, `${it.kind === "zone" ? "Zone fill" : it.kind === "via" ? "Via" : "Track"} ${it.id} (${netOf(it.net)}) on ${layer} is inside keep-out ${k.id}, which blocks ${it.kind === "zone" ? "pours" : `${it.kind}s`} (${k.tier}).`, { tier: k.tier, box: it.shape.box }));
      }
    }
    if (k.blocks.footprints) {
      for (const cy of m.courtyards) {
        if (cy.footprint === k.footprint) continue;
        const side = cy.side === "top" ? m.layers[0] : m.layers[m.layers.length - 1];
        if (!k.layers.includes(side)) continue;
        const hit = polygonsOverlap(cy.poly, region);
        if (!hit) continue;
        if (overridden({ id: cy.footprint, kind: "footprint", footprint: cy.footprint, shape: shape(cy.poly) }, [side])) continue;
        out.push(makeFinding("keepout", severity, [k.id, cy.footprint], { ...hit, layer: side }, `Footprint ${cy.ref} (${cy.footprint}) overlaps keep-out ${k.id}, which blocks footprints (${k.tier}).`, { tier: k.tier, box: cy.poly.box }));
      }
    }
  }
  return out;
}

const keepoutPoly = (outline: readonly Vertex[], holes?: readonly (readonly Vertex[])[]): PolyCore => polyCore([flattenContour(outline), ...(holes ?? []).map((h) => flattenContour(h))]);

/**
 * Disallow rules: an object a `disallow` rule matches is not allowed (KiCad's `disallow` constraint). Objects are
 * tracks, vias, pads, zones (one per zone and layer) and footprints; the rule's `applies` says which. Precedence and
 * severity as for every rule; a rule set to `ignore` allows the object, keep-outs included.
 */
export function disallowFindings(a: Analysis): Finding[] {
  if (!a.rules.has("disallow")) return [];
  const m = a.model;
  const out: Finding[] = [];
  const seen = new Set<string>();
  const report = (o: SubjectObject, layers: string[], loc: { x: number; y: number; layer?: string }, box: Box | undefined, what: string) => {
    const vs = a.rules.flag("disallow", { nets: [o.net], kinds: [o.kind], layers, at: loc, ...(o.shape ? { shapes: [o.shape] } : {}), objects: [o] });
    out.push(...violationFindings("disallow", vs, [o.id], loc, undefined, box, (v) => `${what} is not allowed (${ruleText(v)}${costText(v)}).`));
  };
  for (const it of m.copper) {
    if (it.kind === "pad" || it.kind === "via") {
      if (seen.has(it.id)) continue;
      seen.add(it.id);
      const layers: string[] = it.kind === "via" ? viaLayersOf(m, it.id) : (m.pads.get(it.id)?.layers ?? [it.layer]);
      const o = copperObj(a, it);
      const c = it.shape.core;
      const loc = c.t === "pt" ? { x: c.x, y: c.y, layer: it.layer } : { x: (it.shape.box.minX + it.shape.box.maxX) / 2, y: (it.shape.box.minY + it.shape.box.maxY) / 2, layer: it.layer };
      report({ ...o, layer: it.kind === "pad" ? it.layer : undefined } as SubjectObject, layers, loc, it.shape.box, `${it.kind === "via" ? "Via" : "Pad"} ${it.id} (${netOf(o.net)})`);
    } else if (it.kind === "track") {
      const o = copperObj(a, it);
      const e = it.ends!;
      report(o, [it.layer], { x: (e[0] + e[2]) / 2, y: (e[1] + e[3]) / 2, layer: it.layer }, it.shape.box, `Track ${it.id} (${netOf(o.net)}) on ${it.layer}`);
    } else if (it.kind === "zone") {
      const key = `${it.id}\u0000${it.layer}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const o = copperObj(a, it);
      report(o, [it.layer], { x: (it.shape.box.minX + it.shape.box.maxX) / 2, y: (it.shape.box.minY + it.shape.box.maxY) / 2, layer: it.layer }, it.shape.box, `Zone ${it.id} (${netOf(o.net)}) on ${it.layer}`);
    }
  }
  for (const cy of m.courtyards) {
    const side = cy.side === "top" ? m.layers[0] : m.layers[m.layers.length - 1];
    const sh = shape(cy.poly);
    report({ id: cy.footprint, kind: "footprint", footprint: cy.footprint, shape: sh }, [side], { x: (cy.poly.box.minX + cy.poly.box.maxX) / 2, y: (cy.poly.box.minY + cy.poly.box.maxY) / 2, layer: side }, cy.poly.box, `Footprint ${cy.ref} (${cy.footprint})`);
  }
  return out;
}

const viaLayersOf = (m: CheckModel, id: string): string[] => m.holes.find((h) => h.id === id)?.layers ?? [];

/** Every check of this package, by finding `check` id, in report order. */
export const CHECKS: { id: string; title: string; rule?: RuleCheckName; run: (a: Analysis) => Finding[] }[] = [
  { id: "unconnected", title: "Unconnected items (ratsnest)", run: unconnectedFindings },
  { id: "short", title: "Shorts between nets", run: shortFindings },
  { id: "unassigned_copper", title: "Copper without a net touching a net", run: unassignedFindings },
  { id: "dangling", title: "Dangling track ends and vias", run: danglingFindings },
  { id: "isolated_copper", title: "Isolated zone fill islands", run: isolatedFindings },
  { id: "clearance", title: "Copper clearance", rule: "clearance", run: clearanceFindings },
  { id: "physical_clearance", title: "Physical clearance (any nets)", rule: "physical_clearance", run: physicalClearanceFindings },
  { id: "track_width", title: "Track width", rule: "track_width", run: trackWidthFindings },
  { id: "via_diameter", title: "Via diameter", rule: "via_diameter", run: (a) => viaSizeFindings(a, "via_diameter") },
  { id: "via_hole", title: "Via hole", rule: "via_hole", run: (a) => viaSizeFindings(a, "via_hole") },
  { id: "hole_size", title: "Hole size (vias and pads)", rule: "hole_size", run: holeSizeFindings },
  { id: "annular_ring", title: "Annular ring", rule: "annular_ring", run: annularRingFindings },
  { id: "hole_to_hole", title: "Hole to hole", rule: "hole_to_hole", run: holeToHoleFindings },
  { id: "hole_clearance", title: "Hole clearance", rule: "hole_clearance", run: holeClearanceFindings },
  { id: "edge_clearance", title: "Copper to board edge", rule: "edge_clearance", run: edgeClearanceFindings },
  { id: "courtyard_overlap", title: "Courtyard overlap", rule: "courtyard_overlap", run: courtyardFindings },
  { id: "silk_to_pad", title: "Silkscreen over pads", rule: "silk_to_pad", run: silkToPadFindings },
  { id: "via_in_pad", title: "Via in pad (policy)", rule: "via_in_pad", run: viaInPadFindings },
  { id: "via_under_footprint", title: "Via under footprint (policy)", rule: "via_under_footprint", run: viaUnderFootprintFindings },
  { id: "keepout", title: "Keep-out areas", run: keepoutFindings },
  { id: "disallow", title: "Disallowed objects (disallow rules)", rule: "disallow", run: disallowFindings },
];

/** Checks that did not run, and checks that ran on a built-in default because no rule was given. */
export function coverage(a: Pick<Analysis, "rules" | "model">): { notRun: { check: string; reason: string }[]; defaults: { check: string; reason: string }[] } {
  const notRun: { check: string; reason: string }[] = [];
  const defaults: { check: string; reason: string }[] = [];
  const needRule: RuleCheckName[] = ["clearance", "track_width", "via_diameter", "via_hole", "annular_ring", "hole_to_hole", "hole_clearance", "via_in_pad", "via_under_footprint"];
  for (const c of needRule) {
    // a hole_size rule covers via holes too
    if (c === "via_hole" && a.rules.has("hole_size")) continue;
    if (!a.rules.has(c)) notRun.push({ check: c, reason: `no enabled ${c} rule on the board` });
  }
  if (!a.model.region) notRun.push({ check: "edge_clearance", reason: "the board has no outline" });
  else if (!a.rules.has("edge_clearance")) defaults.push({ check: "edge_clearance", reason: "no enabled edge_clearance rule: only copper crossing or outside the edge is reported, as an error" });
  if (!a.rules.has("silk_to_pad")) defaults.push({ check: "silk_to_pad", reason: "no enabled silk_to_pad rule: only silkscreen overlapping a pad is reported, as a warning" });
  if (!a.rules.has("courtyard_overlap")) defaults.push({ check: "courtyard_overlap", reason: "no enabled courtyard_overlap rule: overlapping courtyards are errors" });
  return { notRun, defaults };
}
