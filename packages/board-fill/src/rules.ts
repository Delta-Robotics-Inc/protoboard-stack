/**
 * Clearances a fill keeps, from the board's rules (contract section 5, with precedence and conditions).
 *
 * For one check on one pair (the zone and an object) on one layer: the enabled rules of the check whose `applies`
 * match (nets or classes of either object, the layer, the pair of kinds, a region holding the object, a `when`
 * condition tested with the pair in both orders). Within each tier only the matching rules of the highest
 * `priority` take part (a higher-priority rule overrides, it does not combine). The floor is the largest `min`
 * left; the target is the most specific rule left (region, then nets, then classes, then layers, then global; ties
 * take the larger `min`). A fill plans at the target and never below the floor: the larger of the two. The zone's
 * own clearance is a floor at priority 0 for the gap to copper of other nets: it combines with priority-0 floors by
 * the largest minimum and gives way to a matching floor of a higher priority. A check with no rule on the board
 * falls back to a default. `physical_clearance` rules (any copper) add to `clearance`.
 */
import { netClassOf, recordsOfKind, type BoardDocument, type CopperLayer, type RuleCondition, type RuleRec } from "@protoboardai/board";
import { contourEdges, pointInContour, type Box, type ContourEdge } from "./shapes.js";

export interface FillRuleDefaults {
  /** Copper to copper of another net, nm. */
  clearance: number;
  /** Copper to the board edge and cutouts, nm. */
  edge_clearance: number;
  /** Copper to a drilled hole of another net or a non-plated hole, nm. */
  hole_clearance: number;
  /** Thermal relief gap when a zone gives none, nm. */
  thermal_gap: number;
  /** Thermal spoke width when a zone gives none, nm. */
  thermal_spoke_width: number;
  /** Hatch line width and gap when a hatched zone gives none, nm. */
  hatch_width: number;
  hatch_gap: number;
}

/** Defaults for a board without a rule of a check (common fab and tool defaults; not any fab's published limits). */
export const DEFAULT_FILL_RULES: FillRuleDefaults = {
  clearance: 200_000,
  edge_clearance: 300_000,
  hole_clearance: 250_000,
  thermal_gap: 500_000,
  thermal_spoke_width: 500_000,
  hatch_width: 500_000,
  hatch_gap: 1_000_000,
};

export interface FillRuleOptions {
  /** Plan at the target (default) or only at the floor (the smallest legal fill). */
  tier?: "target" | "floor";
  /** Values for checks the board has no rule for. */
  defaults?: Partial<FillRuleDefaults>;
}

export type PartyKind = "zone" | "pad" | "track" | "via" | "hole" | "outline" | "cutout" | "graphic" | "text" | "keepout";
type Pt = { x: number; y: number };
/** One side of a measured pair, with what conditions may ask about it. */
export interface Party {
  kind: PartyKind;
  net?: string;
  padType?: "smd" | "th" | "np";
  /** Pad number. */
  pad?: string;
  footprint?: { ref: string; lib: string };
  at?: Pt;
  start?: Pt;
  end?: Pt;
  /** Its box, for area and courtyard terms. */
  box?: Box;
  /** Points that lie in it (corners, center), for area terms. */
  points?: Pt[];
}

type Check = "clearance" | "edge_clearance" | "hole_clearance" | "physical_clearance";
const CHECKS: Check[] = ["clearance", "edge_clearance", "hole_clearance", "physical_clearance"];

interface PreparedRule {
  rule: RuleRec;
  region?: ContourEdge[];
  specificity: number;
  priority: number;
}

/** Whether a condition looks at where the objects are (so values cannot be cached by net and kind). */
function positional(c: RuleCondition | undefined): boolean {
  if (!c) return false;
  if ("all" in c) return c.all.some(positional);
  if ("any" in c) return c.any.some(positional);
  if ("not" in c) return positional(c.not);
  return "area" in c || "courtyard" in c || "coord" in c;
}

const wildcard = (p: string) => new RegExp(`^${p.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")}$`);

export class FillRules {
  readonly defaults: FillRuleDefaults;
  readonly tier: "target" | "floor";
  private readonly byCheck = new Map<Check, PreparedRule[]>();
  private readonly positionalCheck = new Map<Check, boolean>();
  private readonly classCache = new Map<string, string>();
  private readonly cache = new Map<string, number>();
  private readonly areas = new Map<string, ContourEdge[][]>();
  private readonly courtyards: { ref: string; region: ContourEdge[]; box: Box }[] = [];
  /** The largest value any rule or default can give (for search ranges). */
  readonly maxValue: number;

  constructor(private readonly doc: BoardDocument, options: FillRuleOptions = {}) {
    this.defaults = { ...DEFAULT_FILL_RULES, ...options.defaults };
    this.tier = options.tier ?? "target";
    let max = Math.max(this.defaults.clearance, this.defaults.edge_clearance, this.defaults.hole_clearance);
    for (const r of recordsOfKind(doc, "rule")) {
      if (r.enabled === false) continue;
      if (!(CHECKS as string[]).includes(r.check)) continue;
      if (r.tier !== "floor" && r.tier !== "target") continue;
      const a = r.applies;
      const specificity = (a.region ? 50 : a.nets ? 40 : a.classes ? 30 : a.layers ? 20 : 10) + (a.between ? 1 : 0) + (a.when ? 1 : 0);
      const check = r.check as Check;
      const list = this.byCheck.get(check) ?? [];
      list.push({ rule: r, ...(a.region ? { region: contourEdges(a.region) } : {}), specificity, priority: r.priority ?? 0 });
      this.byCheck.set(check, list);
      if (a.region || positional(a.when)) this.positionalCheck.set(check, true);
      max = Math.max(max, r.min ?? 0, r.preferred ?? 0);
    }
    this.maxValue = max;
    for (const k of recordsOfKind(doc, "keepout")) {
      if (!k.name) continue;
      const l = this.areas.get(k.name) ?? [];
      l.push(contourEdges(k.outline));
      this.areas.set(k.name, l);
    }
    if ([...this.byCheck.values()].flat().some((p) => JSON.stringify(p.rule.applies.when ?? {}).includes("courtyard"))) {
      for (const fp of recordsOfKind(doc, "footprint")) {
        if (!fp.courtyard) continue;
        const c = Math.cos((fp.rotation / 1000) * (Math.PI / 180));
        const s = Math.sin((fp.rotation / 1000) * (Math.PI / 180));
        const region = contourEdges(fp.courtyard, (p) => {
          const m = fp.side === "bottom" ? { x: -p.x, y: p.y } : p;
          return { x: fp.x + m.x * c - m.y * s, y: fp.y + m.x * s + m.y * c };
        });
        const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
        for (const e of region) {
          b.minX = Math.min(b.minX, e.x0);
          b.minY = Math.min(b.minY, e.y0);
          b.maxX = Math.max(b.maxX, e.x0);
          b.maxY = Math.max(b.maxY, e.y0);
        }
        this.courtyards.push({ ref: fp.ref, region, box: b });
      }
    }
  }

  private classOf(net: string | undefined): string | undefined {
    if (net === undefined) return undefined;
    let c = this.classCache.get(net);
    if (c === undefined) {
      c = netClassOf(this.doc, net);
      this.classCache.set(net, c);
    }
    return c;
  }

  private inArea(p: Party, names: string[], touch: boolean): boolean {
    const pts = p.points ?? (p.at ? [p.at] : p.start && p.end ? [p.start, p.end] : []);
    if (!pts.length) return false;
    for (const n of names)
      for (const region of this.areas.get(n) ?? []) {
        const inside = pts.map((q) => pointInContour(region, q.x, q.y));
        if (touch ? inside.some(Boolean) : inside.every(Boolean)) return true;
      }
    return false;
  }

  private term(c: RuleCondition, a: Party, b: Party | undefined, layer: CopperLayer | undefined): boolean {
    if ("all" in c) return c.all.every((x) => this.term(x, a, b, layer));
    if ("any" in c) return c.any.some((x) => this.term(x, a, b, layer));
    if ("not" in c) return !this.term(c.not, a, b, layer);
    if ("same_net" in c) return !!b && a.net !== undefined && a.net === b.net;
    const p = c.side === "A" ? a : b;
    if (!p) return false;
    if ("kind" in c) return (c.kind as string[]).includes(p.kind === "text" ? "text" : p.kind);
    if ("pad_type" in c) return p.padType !== undefined && c.pad_type.includes(p.padType);
    if ("net" in c) return p.net !== undefined && c.net.includes(p.net);
    if ("class" in c) {
      const cl = this.classOf(p.net);
      return cl !== undefined && c.class.includes(cl);
    }
    if ("layer" in c) return layer !== undefined && (c.layer as string[]).includes(layer);
    if ("area" in c) return this.inArea(p, c.area, c.touch === true);
    if ("courtyard" in c) {
      if (!p.box) return false;
      return this.courtyards.some((cy) => (c.courtyard.includes("*") || c.courtyard.some((r) => wildcard(r).test(cy.ref))) && cy.box.minX <= p.box!.maxX && p.box!.minX <= cy.box.maxX && cy.box.minY <= p.box!.maxY && p.box!.minY <= cy.box.maxY && (p.points ?? []).concat(p.at ? [p.at] : []).some((q) => pointInContour(cy.region, q.x, q.y)));
    }
    if ("footprint" in c) return !!p.footprint && c.footprint.some((f) => wildcard(f).test(p.footprint!.ref) || wildcard(f).test(p.footprint!.lib));
    if ("pad" in c) return p.pad !== undefined && c.pad.includes(p.pad);
    if ("coord" in c) {
      const q = c.of === "at" ? p.at : c.of === "start" ? p.start : p.end;
      if (!q) return false;
      const v = c.coord === "x" ? q.x : q.y;
      return (c.gt === undefined || v > c.gt) && (c.lt === undefined || v < c.lt);
    }
    return false;
  }

  private matches(p: PreparedRule, a: Party, b: Party, layer: CopperLayer | undefined, at: Pt | undefined): boolean {
    const ap = p.rule.applies;
    if (ap.layers && (!layer || !ap.layers.includes(layer))) return false;
    if (ap.nets && !((a.net !== undefined && ap.nets.includes(a.net)) || (b.net !== undefined && ap.nets.includes(b.net)))) return false;
    if (ap.classes) {
      const ca = this.classOf(a.net);
      const cb = this.classOf(b.net);
      if (!((ca && ap.classes.includes(ca)) || (cb && ap.classes.includes(cb)))) return false;
    }
    if (ap.between) {
      const [x, y] = ap.between;
      if (!((x === a.kind && y === b.kind) || (x === b.kind && y === a.kind))) return false;
    }
    if (p.region && (!at || !pointInContour(p.region, at.x, at.y))) return false;
    if (ap.when && !(this.term(ap.when, a, b, layer) || this.term(ap.when, b, a, layer))) return false;
    return true;
  }

  /**
   * The value of a check for a pair on a layer: the larger of the floor and the target after precedence, with an
   * optional extra floor at priority 0 (a zone's own clearance); undefined when no rule matches and there is no
   * default (`physical_clearance`).
   */
  value(check: Check, a: Party, b: Party, layer: CopperLayer | undefined, at?: Pt, zoneFloor = 0): number | undefined {
    const list = this.byCheck.get(check);
    const fallback = check === "clearance" ? this.defaults.clearance : check === "edge_clearance" ? this.defaults.edge_clearance : check === "hole_clearance" ? this.defaults.hole_clearance : undefined;
    if (!list?.length) return fallback === undefined ? (zoneFloor > 0 ? zoneFloor : undefined) : Math.max(fallback, zoneFloor);
    const point = at ?? a.at ?? b.at;
    const key = this.positionalCheck.get(check) ? "" : `${check}\u0000${zoneFloor}\u0000${partyKey(a)}\u0000${partyKey(b)}\u0000${layer ?? ""}`;
    if (key) {
      const hit = this.cache.get(key);
      if (hit !== undefined) return hit < 0 ? undefined : hit;
    }
    const floors: PreparedRule[] = [];
    const targets: PreparedRule[] = [];
    for (const p of list) {
      if (!this.matches(p, a, b, layer, point)) continue;
      (p.rule.tier === "floor" ? floors : targets).push(p);
    }
    const top = (l: PreparedRule[]) => {
      const pr = Math.max(...l.map((p) => p.priority));
      return l.filter((p) => p.priority === pr && p.rule.severity !== "ignore");
    };
    let floor = 0;
    let floorPriority = 0;
    if (floors.length) {
      floorPriority = Math.max(...floors.map((p) => p.priority));
      for (const p of top(floors)) floor = Math.max(floor, p.rule.min ?? 0);
    }
    // the zone's clearance is a floor at priority 0: it gives way to a matching floor of higher priority
    if (floorPriority === 0) floor = Math.max(floor, zoneFloor);
    let target: PreparedRule | undefined;
    if (targets.length)
      for (const p of top(targets)) {
        const v = p.rule.min ?? p.rule.preferred;
        if (v === undefined) continue;
        if (!target || p.specificity > target.specificity || (p.specificity === target.specificity && v > (target.rule.min ?? target.rule.preferred ?? 0))) target = p;
      }
    let v: number | undefined;
    if (!floors.length && !target) v = fallback === undefined ? (zoneFloor > 0 ? zoneFloor : undefined) : Math.max(fallback, zoneFloor);
    else v = this.tier === "floor" ? floor : Math.max(floor, target ? (target.rule.min ?? target.rule.preferred ?? 0) : 0);
    if (key) this.cache.set(key, v ?? -1);
    return v;
  }

  /** Copper to copper of another net (clearance, and physical clearance when a rule gives one). */
  clearance(a: Party, b: Party, layer: CopperLayer, at?: Pt, zoneFloor = 0): number {
    const c = this.value("clearance", a, b, layer, at, zoneFloor) ?? 0;
    const p = this.value("physical_clearance", a, b, layer, at) ?? 0;
    return Math.max(c, p);
  }
  /** Copper to the board edge (`outline`) or a cutout. */
  edge(a: Party, edge: "outline" | "cutout", layer: CopperLayer): number {
    return this.value("edge_clearance", a, { kind: edge }, layer) ?? 0;
  }
  /** Copper to a hole: the larger of the copper clearance and the hole clearance. */
  hole(a: Party, hole: Party, layer: CopperLayer, at?: Pt, zoneFloor = 0): number {
    const h: Party = { ...hole, kind: "hole" };
    return Math.max(this.clearance(a, h, layer, at, zoneFloor), this.value("hole_clearance", a, h, layer, at) ?? 0);
  }
}

const partyKey = (p: Party): string => `${p.kind}|${p.net ?? ""}|${p.padType ?? ""}|${p.pad ?? ""}|${p.footprint ? `${p.footprint.ref}/${p.footprint.lib}` : ""}`;
