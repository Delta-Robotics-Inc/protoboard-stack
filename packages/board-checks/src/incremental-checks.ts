/**
 * The checks for the incremental mode: each check of checks.ts, step for step, with what it measures per subject
 * (a pair of the scan, a track, a hole, a silkscreen element, a courtyard, a keep-out) kept between edits and
 * measured again only when something it depends on changed: the subject itself (a new item is a new object), copper
 * added, removed or changing its carried net near it, or (for courtyard checks) a footprint. Findings are built
 * through a memo, so an unchanged finding is the same object and is not hashed or validated again.
 *
 * Checks that only run with rules few boards have (`physical_clearance`, `disallow`) and any check this file does
 * not know run whole, as checks.ts runs them. Any change to checks.ts must be made here too; the incremental
 * property test compares the two.
 */
import { byCodeUnit, toMm, type Box, type CopperLayer, type Finding, type KeepoutRec, type RuleTier, type ViaRec, type Vertex } from "@protoboardai/board";
import { CHECKS, copperObj, disallowFindings, fmt, physicalClearanceFindings, type Analysis } from "./checks.js";
import { CONTACT_EPS, type ConnectivityResult } from "./connectivity.js";
import { flattenContour, pointInPoly, polyCore, polygonsOverlap, shape, shapeGap, type Gap, type PolyCore, type Shape } from "./geom/shape.js";
import type { PairRec } from "./incremental-model.js";
import type { CopperItem, CourtyardItem, HoleItem, SilkItem } from "./model.js";
import type { ImplicitFloor, SubjectObject, Violation } from "./rules.js";

export type MakeFinding = (
  check: string,
  severity: "error" | "warning" | "info",
  objects: readonly string[],
  loc: { x: number; y: number; layer?: string },
  message: string,
  extra?: { rule?: string; tier?: RuleTier; box?: Box; measured?: number; required?: number },
) => Finding;

/** What changed in this edit, as the checks ask it. */
export interface CheckContext {
  mk: MakeFinding;
  /** Copper added or removed, or whose carried net changed, meeting a box on a layer. */
  copperDirty(layer: CopperLayer, box: Box): boolean;
  /** Pads added or removed meeting a box on a layer. */
  padDirty(layer: CopperLayer, box: Box): boolean;
  /** Holes added or removed, or whose carried net changed, meeting a box. */
  holeDirty(box: Box): boolean;
  /** Courtyards added or removed meeting a box. */
  courtyardDirty(box: Box): boolean;
  /** Whether any footprint changed. */
  footprintsChanged: boolean;
  /** Ids whose carried net changed. */
  netChanged: ReadonlySet<string>;
}

/** Results kept between edits, by subject object. */
export interface CheckCaches {
  trackWidth: WeakMap<CopperItem, { net: string | undefined; out: Finding[] }>;
  viaSize: { via_diameter: WeakMap<ViaRec, { net: string | undefined; out: Finding[] }>; via_hole: WeakMap<ViaRec, { net: string | undefined; out: Finding[] }> };
  holeSize: WeakMap<HoleItem, { net: string | undefined; out: Finding[] }>;
  annularVia: WeakMap<ViaRec, { net: string | undefined; out: Finding[] }>;
  annularPad: WeakMap<object, { net: string | undefined; out: Finding[] }>;
  holeToHole: WeakMap<HoleItem, Finding[]>;
  holeClearance: WeakMap<HoleItem, HoleEntry[]>;
  edge: WeakMap<CopperItem, EdgeGeo>;
  courtyard: WeakMap<CourtyardItem, Finding[]>;
  silk: WeakMap<SilkItem, Finding[]>;
  viaInPad: WeakMap<CopperItem, Finding[]>;
  viaUnder: WeakMap<HoleItem, Finding[]>;
  keepout: WeakMap<KeepoutRec, Finding[]>;
  keepoutPoly: WeakMap<KeepoutRec, PolyCore>;
  /** Findings of direct shorts, by the frozen short object kept on its pair. */
  short: WeakMap<object, Finding>;
}

export const newCheckCaches = (): CheckCaches => ({
  trackWidth: new WeakMap(),
  viaSize: { via_diameter: new WeakMap(), via_hole: new WeakMap() },
  holeSize: new WeakMap(),
  annularVia: new WeakMap(),
  annularPad: new WeakMap(),
  holeToHole: new WeakMap(),
  holeClearance: new WeakMap(),
  edge: new WeakMap(),
  courtyard: new WeakMap(),
  silk: new WeakMap(),
  viaInPad: new WeakMap(),
  viaUnder: new WeakMap(),
  keepout: new WeakMap(),
  keepoutPoly: new WeakMap(),
  short: new WeakMap(),
});

interface HoleEntry {
  key: string;
  h: HoleItem;
  item: CopperItem;
  gap: number;
  x: number;
  y: number;
  vs: Violation[];
}
interface EdgeGeo {
  best: number;
  bx: number;
  by: number;
  outside: boolean;
  edge: string;
}

// ---------------------------------------------------------------- helpers, as checks.ts

const at = (x: number, y: number) => `(${toMm(Math.round(x)).toFixed(3)}, ${toMm(Math.round(y)).toFixed(3)}) mm`;
const netOf = (n: string | undefined) => (n === undefined ? "no net" : `net ${n}`);
const netIs = (a: Analysis, id: string, net: string | undefined): string | undefined => net ?? a.connectivity.carried[id];
const netSay = (a: Analysis, id: string, net: string | undefined): string => (net === undefined && a.connectivity.carried[id] !== undefined ? `no net; carries ${a.connectivity.carried[id]} by contact` : netOf(net));
const ruleText = (v: Violation) => (v.rule ? `${v.rule}, ${v.tier}` : v.implicit ? `${v.implicit}, ${v.tier}` : "built-in default");
const costText = (v: Violation) => (v.cost !== undefined ? `, cost ${v.cost}` : "");
const bound = (v: Violation) => (v.bound === "max" ? "above" : "below");
const unionBox = (...bs: Box[]): Box => ({ minX: Math.min(...bs.map((b) => b.minX)), minY: Math.min(...bs.map((b) => b.minY)), maxX: Math.max(...bs.map((b) => b.maxX)), maxY: Math.max(...bs.map((b) => b.maxY)) });
const grow = (b: Box, r: number): Box => ({ minX: b.minX - r, minY: b.minY - r, maxX: b.maxX + r, maxY: b.maxY + r });

function listIds(ids: readonly string[], max = 5): string {
  if (ids.length <= max) return ids.join(", ");
  return `${ids.slice(0, max).join(", ")} and ${ids.length - max} more`;
}

function padInfo(a: Analysis, id: string): Partial<SubjectObject> {
  const wp = a.model.pads.get(id);
  if (!wp) return {};
  return { footprint: wp.footprint, pad: wp.pad.number, padType: wp.pad.type, at: { x: wp.x, y: wp.y } };
}

function holeObj(a: Analysis, h: HoleItem): SubjectObject {
  const net = netIs(a, h.id, h.net);
  const o: SubjectObject = { id: h.id, kind: h.kind, shape: h.shape, ...(net !== undefined ? { net } : {}) };
  if (h.kind === "pad") return { ...o, ...padInfo(a, h.id) };
  const c = h.shape.core;
  if (c.t === "pt") o.at = { x: c.x, y: c.y };
  return o;
}

function violationFindings(mk: MakeFinding, check: string, vs: Violation[], objects: string[], loc: { x: number; y: number; layer?: string }, measured: number | undefined, box: Box | undefined, what: (v: Violation) => string): Finding[] {
  return vs.map((v) =>
    mk(check, v.severity, objects, loc, what(v), {
      ...(v.rule ? { rule: v.rule } : {}),
      ...(v.tier ? { tier: v.tier } : {}),
      ...(box ? { box } : {}),
      ...(measured !== undefined ? { measured } : {}),
      ...(v.required !== undefined ? { required: v.required } : {}),
    }),
  );
}

// ---------------------------------------------------------------- connectivity findings

function unconnected(a: Analysis, mk: MakeFinding): Finding[] {
  return a.connectivity.links.map((l) =>
    mk("unconnected", "error", [l.from.object, l.to.object], { x: (l.from.x + l.to.x) / 2, y: (l.from.y + l.to.y) / 2, layer: l.from.layer }, `Net ${l.net} is not connected between ${l.from.object} at ${at(l.from.x, l.from.y)} on ${l.from.layer} and ${l.to.object} at ${at(l.to.x, l.to.y)} on ${l.to.layer}, ${fmt(l.length)} apart.`, {
      box: { minX: Math.min(l.from.x, l.to.x), minY: Math.min(l.from.y, l.to.y), maxX: Math.max(l.from.x, l.to.x), maxY: Math.max(l.from.y, l.to.y) },
      measured: l.length,
    }),
  );
}

function shorts(a: Analysis, mk: MakeFinding, kept: WeakMap<object, Finding>): Finding[] {
  // a direct short is the same frozen object while its pair lasts: its finding is kept with it
  return a.connectivity.shorts.map((s) => {
    const k = Object.isFrozen(s) ? kept.get(s) : undefined;
    if (k) return k;
    const f = shortFinding(s, mk);
    if (Object.isFrozen(s)) kept.set(s, f);
    return f;
  });
}

function shortFinding(s: ConnectivityResult["shorts"][number], mk: MakeFinding): Finding {
  return mk(
    "short",
    "error",
    s.objects,
    { x: s.x, y: s.y, layer: s.layer },
    s.bridged
      ? `Nets ${s.nets[0]} and ${s.nets[1]} are joined through copper without a net (${listIds(s.objects)}) on ${s.layer} near ${at(s.x, s.y)}.`
      : `${s.objects[0]} and ${s.objects[1]} touch on ${s.layer} at ${at(s.x, s.y)}, joining nets ${s.nets[0]} and ${s.nets[1]}.`,
    { measured: 0, box: s.box },
  );
}

function unassigned(a: Analysis, mk: MakeFinding): Finding[] {
  return a.connectivity.unassigned.map((u) => mk("unassigned_copper", "warning", [u.object, u.touches], { x: u.x, y: u.y, layer: u.layer }, `${u.object} has no net and touches ${u.touches} of net ${u.net} on ${u.layer} at ${at(u.x, u.y)}.`, { box: u.box }));
}

function dangling(a: Analysis, mk: MakeFinding): Finding[] {
  return a.connectivity.dangling.map((d) =>
    d.kind === "track"
      ? mk("dangling", "warning", [d.object], { x: d.x, y: d.y, layer: d.layer }, `Track end of ${d.object} (${netOf(d.net)}) at ${at(d.x, d.y)} on ${d.layer} touches no other copper.`, { box: d.box })
      : mk("dangling", "warning", [d.object], { x: d.x, y: d.y, layer: d.layer }, `Via ${d.object} (${netOf(d.net)}) at ${at(d.x, d.y)} meets other copper on ${d.connectedLayers} of its layers.`, { box: d.box }),
  );
}

function isolated(a: Analysis, mk: MakeFinding): Finding[] {
  return a.connectivity.isolated.map((s) => mk("isolated_copper", "warning", s.objects, { x: s.x, y: s.y, layer: s.layer }, `Zone fill of net ${s.net} near ${at(s.x, s.y)} on ${s.layer} touches no pad, track or via of its net (${listIds(s.objects)}).`, { box: s.box }));
}

// ---------------------------------------------------------------- copper clearance

function zoneClearance(a: Analysis, it: CopperItem): number | undefined {
  if (it.kind !== "zone") return undefined;
  const z = a.model.doc.records.get(it.id);
  return z?.kind === "zone" ? z.clearance : undefined;
}

function clearance(a: Analysis, mk: MakeFinding, near: readonly PairRec[]): Finding[] {
  const hasRules = a.rules.has("clearance");
  const best = new Map<string, { p: PairRec; vs: Violation[] }>();
  for (const p of near) {
    const A = p.A;
    const B = p.B;
    const na = netIs(a, A.id, A.net);
    const nb = netIs(a, B.id, B.net);
    if (na !== undefined && na === nb) continue;
    let c = p.clr;
    if (!c || c.na !== na || c.nb !== nb) {
      const implicit: ImplicitFloor[] = [];
      for (const it of [A, B]) {
        const zc = zoneClearance(a, it);
        if (zc !== undefined && zc > 0) implicit.push({ min: zc, label: `zone ${it.id} clearance` });
      }
      const vs = !hasRules && !implicit.length ? null : a.rules.evaluate("clearance", p.gap, { nets: [na, nb], kinds: [A.kind, B.kind], layers: [A.layer], at: { x: p.x, y: p.y }, shapes: [A.shape, B.shape], objects: [copperObj(a, A), copperObj(a, B)] }, implicit);
      c = p.clr = { na, nb, vs };
    }
    const vs = c.vs as Violation[] | null;
    if (!vs || !vs.length) continue;
    // the pair's key, kept with its evaluation (the pair's ids, kinds and layer never change)
    const key = (c.key ??= [A.id, B.id].sort(byCodeUnit).join("\u0000") + (A.kind === "zone" || B.kind === "zone" ? `\u0000${A.layer}` : ""));
    const prev = best.get(key);
    if (!prev || p.gap < prev.p.gap) best.set(key, { p, vs });
  }
  const out: Finding[] = [];
  for (const { p, vs } of best.values()) {
    const A = p.A;
    const B = p.B;
    // the findings of a pair follow from the pair and the nets its evaluation was made with: kept with it
    const kept = p.clr!;
    if (kept.out) {
      out.push(...kept.out);
      continue;
    }
    const start = out.length;
    out.push(
      ...violationFindings(mk, "clearance", vs, [A.id, B.id], { x: p.x, y: p.y, layer: A.layer }, p.gap, unionBox(A.shape.box, B.shape.box), (v) =>
        `Clearance ${fmt(p.gap)} between ${A.id} (${netSay(a, A.id, A.net)}) and ${B.id} (${netSay(a, B.id, B.net)}) on ${A.layer} is ${bound(v)} ${fmt(v.required!)} (${ruleText(v)}${costText(v)}).`,
      ),
    );
    kept.out = out.slice(start);
  }
  return out;
}

// ---------------------------------------------------------------- sizes

function trackWidth(a: Analysis, mk: MakeFinding, cache: CheckCaches["trackWidth"]): Finding[] {
  if (!a.rules.has("track_width")) return [];
  const out: Finding[] = [];
  for (const t of a.model.copper) {
    if (t.kind !== "track") continue;
    const net = netIs(a, t.id, t.net);
    let c = cache.get(t);
    if (!c || c.net !== net) {
      const w = t.shape.r * 2;
      const e = t.ends!;
      const loc = { x: (e[0] + e[2]) / 2, y: (e[1] + e[3]) / 2, layer: t.layer };
      const vs = a.rules.evaluate("track_width", w, { nets: [net], kinds: ["track"], layers: [t.layer], at: loc, shapes: [t.shape], objects: [copperObj(a, t)] });
      c = { net, out: violationFindings(mk, "track_width", vs, [t.id], loc, w, t.shape.box, (v) => `Track ${t.id} (${netSay(a, t.id, t.net)}) on ${t.layer} is ${fmt(w)} wide, ${bound(v)} ${fmt(v.required!)} (${ruleText(v)}${costText(v)}).`) };
      cache.set(t, c);
    }
    out.push(...c.out);
  }
  return out;
}

function viaSize(a: Analysis, mk: MakeFinding, check: "via_diameter" | "via_hole", cache: WeakMap<ViaRec, { net: string | undefined; out: Finding[] }>): Finding[] {
  if (!a.rules.has(check)) return [];
  const out: Finding[] = [];
  for (const v of a.model.doc.records.values()) {
    if (v.kind !== "via") continue;
    const net = netIs(a, v.id, v.net);
    let c = cache.get(v);
    if (!c || c.net !== net) {
      const size = check === "via_diameter" ? v.outer_diameter : v.hole_diameter;
      const hole = a.model.holes.find((h) => h.id === v.id);
      const layers = hole?.layers ?? [v.from_layer, v.to_layer];
      const loc = { x: v.x, y: v.y, layer: v.from_layer };
      const obj: SubjectObject = { id: v.id, kind: "via", at: { x: v.x, y: v.y }, shape: hole?.shape ?? ({ core: { t: "pt", x: v.x, y: v.y }, r: v.outer_diameter / 2, box: { minX: v.x - v.outer_diameter / 2, minY: v.y - v.outer_diameter / 2, maxX: v.x + v.outer_diameter / 2, maxY: v.y + v.outer_diameter / 2 } } as Shape), ...(net !== undefined ? { net } : {}) };
      const vs = a.rules.evaluate(check, size, { nets: [net], kinds: [check === "via_hole" ? "hole" : "via"], layers, at: loc, objects: [obj] });
      const word = check === "via_diameter" ? "diameter" : "hole";
      c = { net, out: violationFindings(mk, check, vs, [v.id], loc, size, { minX: v.x - v.outer_diameter / 2, minY: v.y - v.outer_diameter / 2, maxX: v.x + v.outer_diameter / 2, maxY: v.y + v.outer_diameter / 2 }, (x) => `Via ${v.id} (${netOf(v.net)}) ${word} ${fmt(size)} is ${bound(x)} ${fmt(x.required!)} (${ruleText(x)}${costText(x)}).`) };
      cache.set(v, c);
    }
    out.push(...c.out);
  }
  return out;
}

function holeSize(a: Analysis, mk: MakeFinding, cache: CheckCaches["holeSize"]): Finding[] {
  if (!a.rules.has("hole_size")) return [];
  const out: Finding[] = [];
  for (const h of a.model.holes) {
    const net = netIs(a, h.id, h.net);
    let c = cache.get(h);
    if (!c || c.net !== net) {
      const found: Finding[] = [];
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
      const cr = h.shape.core;
      const loc = cr.t === "pt" ? { x: cr.x, y: cr.y } : { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
      const s = { nets: [net], kinds: ["hole" as const], layers: h.layers, at: loc, shapes: [h.shape], objects: [holeObj(a, h)] };
      const what = h.kind === "via" ? "Via" : "Pad";
      for (const [size, side] of [
        [narrow, "min"],
        [wide, "max"],
      ] as const) {
        const vs = a.rules.evaluate("hole_size", size, s).filter((v) => v.bound === side);
        found.push(...violationFindings(mk, "hole_size", vs, [h.id], loc, size, h.shape.box, (x) => `${what} ${h.id} (${netOf(h.net)}) hole ${fmt(size)} is ${bound(x)} ${fmt(x.required!)} (${ruleText(x)}${costText(x)}).`));
      }
      c = { net, out: found };
      cache.set(h, c);
    }
    out.push(...c.out);
  }
  return out;
}

function annularRing(a: Analysis, mk: MakeFinding, caches: CheckCaches): Finding[] {
  if (!a.rules.has("annular_ring")) return [];
  const out: Finding[] = [];
  for (const v of a.model.doc.records.values()) {
    if (v.kind !== "via") continue;
    const vnet = netIs(a, v.id, v.net);
    let c = caches.annularVia.get(v);
    if (!c || c.net !== vnet) {
      const ring = (v.outer_diameter - v.hole_diameter) / 2;
      const loc = { x: v.x, y: v.y, layer: v.from_layer };
      const vs = a.rules.evaluate("annular_ring", ring, { nets: [vnet], kinds: ["via"], layers: [v.from_layer, v.to_layer], at: loc, objects: [{ id: v.id, kind: "via", at: { x: v.x, y: v.y }, shape: { core: { t: "pt", x: v.x, y: v.y }, r: v.outer_diameter / 2, box: { minX: v.x - v.outer_diameter / 2, minY: v.y - v.outer_diameter / 2, maxX: v.x + v.outer_diameter / 2, maxY: v.y + v.outer_diameter / 2 } } as Shape, ...(vnet !== undefined ? { net: vnet } : {}) }] });
      c = { net: vnet, out: violationFindings(mk, "annular_ring", vs, [v.id], loc, ring, undefined, (x) => `Via ${v.id} (${netOf(v.net)}) annular ring ${fmt(ring)} is ${bound(x)} ${fmt(x.required!)} (${ruleText(x)}${costText(x)}).`) };
      caches.annularVia.set(v, c);
    }
    out.push(...c.out);
  }
  for (const [id, wp] of a.model.pads) {
    const p = wp.pad;
    if (p.type !== "th") continue;
    const net = a.model.doc.padNets.get(id);
    let c = caches.annularPad.get(wp);
    if (!c || c.net !== net) {
      let ring: number;
      if (p.shape === "circle" && p.outer_diameter !== undefined && p.hole_diameter !== undefined) ring = (p.outer_diameter - p.hole_diameter) / 2;
      else {
        const ow = p.outer_width ?? p.outer_diameter ?? 0;
        const oh = p.outer_height ?? p.outer_diameter ?? 0;
        const hw = p.hole_width ?? p.hole_diameter ?? 0;
        const hh = p.hole_height ?? p.hole_diameter ?? 0;
        ring = Math.min((ow - hw) / 2, (oh - hh) / 2);
      }
      const loc = { x: wp.x, y: wp.y };
      const vs = a.rules.evaluate("annular_ring", ring, { nets: [net], kinds: ["pad"], layers: wp.layers, at: loc, objects: [{ id, kind: "pad", shape: wp.shape, ...(net !== undefined ? { net } : {}), ...padInfo(a, id) }] });
      c = { net, out: violationFindings(mk, "annular_ring", vs, [id], loc, ring, wp.box, (x) => `Pad ${id} (${netOf(net)}) annular ring ${fmt(ring)} is ${bound(x)} ${fmt(x.required!)} (${ruleText(x)}${costText(x)}).`) };
      caches.annularPad.set(wp, c);
    }
    out.push(...c.out);
  }
  return out;
}

// ---------------------------------------------------------------- holes

function holeToHole(a: Analysis, ctx: CheckContext, cache: CheckCaches["holeToHole"]): Finding[] {
  const radius = a.rules.maxMin("hole_to_hole");
  if (!a.rules.has("hole_to_hole") || radius <= 0) return [];
  const out: Finding[] = [];
  const g: Gap = { gap: 0, x: 0, y: 0 };
  for (const h of a.model.holes) {
    let kept = cache.get(h);
    if (kept && ctx.holeDirty(grow(h.shape.box, radius))) kept = undefined;
    if (!kept) {
      kept = [];
      const cand = a.model.holeGrid.search({ minX: h.shape.box.minX - radius, minY: h.shape.box.minY - radius, maxX: h.shape.box.maxX + radius, maxY: h.shape.box.maxY + radius });
      for (const j of cand) {
        if (j <= h.i) continue;
        const o = a.model.holes[j];
        if (o.id === h.id) continue;
        const d = shapeGap(h.shape, o.shape, radius, g);
        if (!(d < radius)) continue;
        const vs = a.rules.evaluate("hole_to_hole", d, { nets: [netIs(a, h.id, h.net), netIs(a, o.id, o.net)], kinds: ["hole", "hole"], at: { x: g.x, y: g.y }, shapes: [h.shape, o.shape], objects: [holeObj(a, h), holeObj(a, o)] });
        kept.push(...violationFindings(ctx.mk, "hole_to_hole", vs, [h.id, o.id], { x: g.x, y: g.y }, d, unionBox(h.shape.box, o.shape.box), (v) => `Holes of ${h.id} and ${o.id} are ${fmt(d)} apart, ${bound(v)} ${fmt(v.required!)} (${ruleText(v)}${costText(v)}).`));
      }
      cache.set(h, kept);
    }
    out.push(...kept);
  }
  return out;
}

function holeClearance(a: Analysis, ctx: CheckContext, cache: CheckCaches["holeClearance"]): Finding[] {
  const radius = a.rules.maxMin("hole_clearance");
  if (!a.rules.has("hole_clearance") || radius <= 0) return [];
  const out: Finding[] = [];
  const g: Gap = { gap: 0, x: 0, y: 0 };
  const pairs = new Map<string, HoleEntry>();
  for (const h of a.model.holes) {
    let kept = cache.get(h);
    if (kept) {
      const q = grow(h.shape.box, radius);
      if (ctx.netChanged.has(h.id) || h.layers.some((l) => ctx.copperDirty(l, q))) kept = undefined;
    }
    if (!kept) {
      kept = [];
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
        kept.push({ key: [h.id, item.id].sort(byCodeUnit).join("\u0000") + (item.kind === "zone" ? `\u0000${item.layer}` : ""), h, item, gap, x, y, vs });
      }
      cache.set(h, kept);
    }
    for (const e of kept) {
      const prev = pairs.get(e.key);
      if (!prev || e.gap < prev.gap) pairs.set(e.key, e);
    }
  }
  for (const { h, item, gap, x, y, vs } of pairs.values())
    out.push(...violationFindings(ctx.mk, "hole_clearance", vs, [h.id, item.id], { x, y, layer: item.layer }, gap, unionBox(h.shape.box, item.shape.box), (v) => `Hole of ${h.id} is ${fmt(gap)} from ${item.id} (${netSay(a, item.id, item.net)}) on ${item.layer}, ${bound(v)} ${fmt(v.required!)} (${ruleText(v)}${costText(v)}).`));
  return out;
}

// ---------------------------------------------------------------- board edge

function edgeClearance(a: Analysis, mk: MakeFinding, cache: CheckCaches["edge"]): Finding[] {
  const m = a.model;
  if (!m.region) return [];
  const hasRules = a.rules.has("edge_clearance");
  const radius = Math.max(CONTACT_EPS, a.rules.maxMin("edge_clearance"));
  const out: Finding[] = [];
  const g: Gap = { gap: 0, x: 0, y: 0 };
  const perObject = new Map<string, { item: CopperItem; gap: number; x: number; y: number; outside: boolean; edge: string }>();
  for (const it of m.copper) {
    let geo = cache.get(it);
    if (!geo) {
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
      geo = { best, bx, by, outside, edge };
      cache.set(it, geo);
    }
    const { best, bx, by, outside, edge } = geo;
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
    if (vs.length) out.push(...violationFindings(mk, "edge_clearance", vs, [item.id, edge], loc, gap, item.shape.box, (v) => `${item.id} (${netOf(item.net)}) on ${item.layer} ${what}; the limit is ${fmt(v.required!)} (${ruleText(v)}${costText(v)}).`));
    else if (gap === 0 && (!hasRules || a.rules.resolve("edge_clearance", s).floor.every((r) => r.severity !== "ignore")))
      out.push(mk("edge_clearance", "error", [item.id, edge], loc, `${item.id} (${netOf(item.net)}) on ${item.layer} ${what} (built-in default: copper must stay inside the board).`, { box: item.shape.box, measured: 0, required: 0 }));
  }
  return out;
}

// ---------------------------------------------------------------- footprints, silkscreen, vias

function courtyards(a: Analysis, ctx: CheckContext, cache: CheckCaches["courtyard"]): Finding[] {
  const out: Finding[] = [];
  const cs = a.model.courtyards;
  for (let i = 0; i < cs.length; i++) {
    const A = cs[i];
    let kept = cache.get(A);
    if (kept && ctx.courtyardDirty(A.poly.box)) kept = undefined;
    if (!kept) {
      kept = [];
      for (let j = i + 1; j < cs.length; j++) {
        const B = cs[j];
        if (A.side !== B.side) continue;
        const hit = polygonsOverlap(A.poly, B.poly);
        if (!hit) continue;
        const layer = `${A.side}_courtyard`;
        const vs = a.rules.flag("courtyard_overlap", { nets: [], kinds: ["footprint", "footprint"], layers: [layer], at: hit, shapes: [shape(A.poly), shape(B.poly)], objects: [{ id: A.footprint, kind: "footprint", footprint: A.footprint, shape: shape(A.poly) }, { id: B.footprint, kind: "footprint", footprint: B.footprint, shape: shape(B.poly) }] }, "error");
        kept.push(...violationFindings(ctx.mk, "courtyard_overlap", vs, [A.footprint, B.footprint], { ...hit, layer }, undefined, unionBox(A.poly.box, B.poly.box), (v) => `Courtyards of ${A.ref} (${A.footprint}) and ${B.ref} (${B.footprint}) overlap on the ${A.side} near ${at(hit.x, hit.y)} (${ruleText(v)}${costText(v)}).`));
      }
      cache.set(A, kept);
    }
    out.push(...kept);
  }
  return out;
}

function silkToPad(a: Analysis, ctx: CheckContext, cache: CheckCaches["silk"]): Finding[] {
  const m = a.model;
  const hasRules = a.rules.has("silk_to_pad");
  const radius = Math.max(CONTACT_EPS, a.rules.maxMin("silk_to_pad"));
  const out: Finding[] = [];
  const g: Gap = { gap: 0, x: 0, y: 0 };
  const rank = (v: Violation) => (v.severity === "error" ? 0 : v.severity === "warning" ? 1 : 2);
  for (const s of m.silk) {
    const layer: CopperLayer = s.layer === "top_silkscreen" ? "top" : "bottom";
    const grid = m.grids.get(layer);
    if (!grid) continue;
    const q = { minX: s.box.minX - radius, minY: s.box.minY - radius, maxX: s.box.maxX + radius, maxY: s.box.maxY + radius };
    let kept = cache.get(s);
    if (kept && ctx.padDirty(layer, q)) kept = undefined;
    if (!kept) {
      kept = [];
      const cand = grid.search(q);
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
          const vs = a.rules.evaluate("silk_to_pad", best, subject).sort((p, q2) => rank(p) - rank(q2));
          if (!vs.length) continue;
          v = vs[0];
        } else if (best !== 0) continue;
        pads.push(pad.id);
        const box = unionBox(s.box, pad.shape.box);
        if (!worst || (v && worst.v && rank(v) < rank(worst.v)) || ((!v || !worst.v || rank(v) === rank(worst.v)) && best < worst.gap)) worst = { ...(v ? { v } : {}), gap: best, x: bx, y: by, box: worst ? unionBox(worst.box, box) : box };
        else worst.box = unionBox(worst.box, box);
      }
      if (worst) {
        const w = worst;
        const approx = s.textBox ? " (text checked as its box)" : "";
        const what = pads.length === 1 ? `pad ${pads[0]}` : `${pads.length} pads (${listIds(pads.sort(byCodeUnit))})`;
        const loc = { x: w.x, y: w.y, layer: s.layer };
        if (w.v) kept.push(...violationFindings(ctx.mk, "silk_to_pad", [w.v], [s.id, ...pads], loc, w.gap, w.box, (v) => `Silkscreen of ${s.id} on ${s.layer} is ${fmt(w.gap)} from ${what}, ${bound(v)} ${fmt(v.required!)}${approx} (${ruleText(v)}${costText(v)}).`));
        else kept.push(ctx.mk("silk_to_pad", "warning", [s.id, ...pads], loc, `Silkscreen of ${s.id} overlaps ${what} on ${s.layer}${approx} (built-in default).`, { box: w.box, measured: 0, required: 0 }));
      }
      cache.set(s, kept);
    }
    out.push(...kept);
  }
  return out;
}

function viaInPad(a: Analysis, ctx: CheckContext, cache: CheckCaches["viaInPad"]): Finding[] {
  if (!a.rules.has("via_in_pad")) return [];
  const m = a.model;
  const out: Finding[] = [];
  const g: Gap = { gap: 0, x: 0, y: 0 };
  // a via's items are consecutive in the model (one per layer it spans); the seen set of checks.ts is per via
  const copper = m.copper;
  for (let k = 0; k < copper.length; ) {
    const first = copper[k];
    if (first.kind !== "via") {
      k++;
      continue;
    }
    let end = k + 1;
    while (end < copper.length && copper[end].kind === "via" && copper[end].id === first.id) end++;
    const items = copper.slice(k, end);
    k = end;
    let kept = cache.get(first);
    if (kept && (ctx.netChanged.has(first.id) || items.some((v) => ctx.padDirty(v.layer, v.shape.box)))) kept = undefined;
    if (!kept) {
      kept = [];
      const seen = new Set<string>();
      for (const v of items) {
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
          kept.push(...violationFindings(ctx.mk, "via_in_pad", vs, [v.id, p.id], { x: c.x, y: c.y, layer: v.layer }, undefined, unionBox(v.shape.box, p.shape.box), (x) => `Via ${v.id} (${netOf(v.net)}) is in pad ${p.id} (${netOf(p.net)}) on ${v.layer} (${ruleText(x)}${costText(x)}).`));
        }
      }
      cache.set(first, kept);
    }
    out.push(...kept);
  }
  return out;
}

function viaUnderFootprint(a: Analysis, ctx: CheckContext, cache: CheckCaches["viaUnder"]): Finding[] {
  if (!a.rules.has("via_under_footprint")) return [];
  const m = a.model;
  const out: Finding[] = [];
  for (const h of m.holes) {
    if (h.kind !== "via") continue;
    let kept = cache.get(h);
    if (kept && (ctx.footprintsChanged || ctx.netChanged.has(h.id))) kept = undefined;
    if (!kept) {
      kept = [];
      const c = h.shape.core as { x: number; y: number };
      for (const cy of m.courtyards) {
        const outer = cy.side === "top" ? m.layers[0] : m.layers[m.layers.length - 1];
        if (!h.layers.includes(outer)) continue;
        if (!pointInPoly(cy.poly, c.x, c.y)) continue;
        const vs = a.rules.flag("via_under_footprint", { nets: [h.net], kinds: ["via", "footprint"], layers: [outer], at: c, shapes: [h.shape], objects: [holeObj(a, h), { id: cy.footprint, kind: "footprint", footprint: cy.footprint, shape: shape(cy.poly) }] });
        kept.push(...violationFindings(ctx.mk, "via_under_footprint", vs, [h.id, cy.footprint], { x: c.x, y: c.y, layer: outer }, undefined, h.shape.box, (x) => `Via ${h.id} (${netOf(h.net)}) is under ${cy.ref} (${cy.footprint}) on the ${cy.side} (${ruleText(x)}${costText(x)}).`));
      }
      cache.set(h, kept);
    }
    out.push(...kept);
  }
  return out;
}

// ---------------------------------------------------------------- keep-outs

const keepoutPoly = (outline: readonly Vertex[], holes?: readonly (readonly Vertex[])[]): PolyCore => polyCore([flattenContour(outline), ...(holes ?? []).map((h) => flattenContour(h))]);

function keepouts(a: Analysis, ctx: CheckContext, caches: CheckCaches): Finding[] {
  const m = a.model;
  const out: Finding[] = [];
  const overridden = (o: SubjectObject, layers: string[]) => a.rules.has("disallow") && a.rules.disallowPriority({ nets: [o.net], kinds: [o.kind], layers, at: o.at ?? { x: 0, y: 0 }, ...(o.shape ? { shapes: [o.shape] } : {}), objects: [o] }) > 0;
  for (const k of m.doc.records.values()) {
    if (k.kind !== "keepout") continue;
    let region = caches.keepoutPoly.get(k);
    if (!region) caches.keepoutPoly.set(k, (region = keepoutPoly(k.outline, k.holes)));
    let kept = caches.keepout.get(k);
    if (kept && ((k.blocks.footprints && ctx.footprintsChanged) || k.layers.some((l) => ctx.copperDirty(l, region!.box)))) kept = undefined;
    if (!kept) {
      kept = [];
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
          kept.push(ctx.mk("keepout", severity, [k.id, it.id], { x: g.x, y: g.y, layer }, `${it.kind === "zone" ? "Zone fill" : it.kind === "via" ? "Via" : "Track"} ${it.id} (${netOf(it.net)}) on ${layer} is inside keep-out ${k.id}, which blocks ${it.kind === "zone" ? "pours" : `${it.kind}s`} (${k.tier}).`, { tier: k.tier, box: it.shape.box }));
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
          kept.push(ctx.mk("keepout", severity, [k.id, cy.footprint], { ...hit, layer: side }, `Footprint ${cy.ref} (${cy.footprint}) overlaps keep-out ${k.id}, which blocks footprints (${k.tier}).`, { tier: k.tier, box: cy.poly.box }));
        }
      }
      caches.keepout.set(k, kept);
    }
    out.push(...kept);
  }
  return out;
}

// ---------------------------------------------------------------- all checks

/** Every check's findings, in `CHECKS` order (a check this file does not know runs whole). */
export function runChecksKept(a: Analysis, near: readonly PairRec[], ctx: CheckContext, caches: CheckCaches): { check: string; findings: Finding[]; ms: number }[] {
  const mk = ctx.mk;
  const byId: Record<string, () => Finding[]> = {
    unconnected: () => unconnected(a, mk),
    short: () => shorts(a, mk, caches.short),
    unassigned_copper: () => unassigned(a, mk),
    dangling: () => dangling(a, mk),
    isolated_copper: () => isolated(a, mk),
    clearance: () => clearance(a, mk, near),
    physical_clearance: () => physicalClearanceFindings(a),
    track_width: () => trackWidth(a, mk, caches.trackWidth),
    via_diameter: () => viaSize(a, mk, "via_diameter", caches.viaSize.via_diameter),
    via_hole: () => viaSize(a, mk, "via_hole", caches.viaSize.via_hole),
    hole_size: () => holeSize(a, mk, caches.holeSize),
    annular_ring: () => annularRing(a, mk, caches),
    hole_to_hole: () => holeToHole(a, ctx, caches.holeToHole),
    hole_clearance: () => holeClearance(a, ctx, caches.holeClearance),
    edge_clearance: () => edgeClearance(a, mk, caches.edge),
    courtyard_overlap: () => courtyards(a, ctx, caches.courtyard),
    silk_to_pad: () => silkToPad(a, ctx, caches.silk),
    via_in_pad: () => viaInPad(a, ctx, caches.viaInPad),
    via_under_footprint: () => viaUnderFootprint(a, ctx, caches.viaUnder),
    keepout: () => keepouts(a, ctx, caches),
    disallow: () => disallowFindings(a),
  };
  return CHECKS.map((c) => {
    const t = performance.now();
    const run = byId[c.id];
    const findings = run ? run() : c.run(a);
    return { check: c.id, findings, ms: Math.round((performance.now() - t) * 100) / 100 };
  });
}
