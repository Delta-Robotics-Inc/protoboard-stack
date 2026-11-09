/**
 * Rule resolution in four tiers with explicit precedence (contract section 5). For one check on one object or pair:
 *
 * - every enabled rule of that check whose `applies` matches is collected (its `when` condition included);
 * - precedence: within each tier, only the matching rules with the highest `priority` (absent: 0) take part; a
 *   higher-priority rule overrides lower ones, it does not combine with them;
 * - `floor`: the hard limit is the largest `min` of the rules left (the smallest `max`); below it is an error;
 * - `target`: the most specific rule left (region, then nets, then classes, then layers, then global; ties take the
 *   larger `min`) gives the plan value; below it but at or above the floor is a warning;
 * - `policy`: every rule left applies on its own, a warning that carries its `cost`;
 * - `no_go`: every rule left is an error;
 * - `severity` on a rule overrides its tier's default, and `ignore` drops the finding (and, being the rule that won,
 *   silences the lower-priority rules it overrides);
 * - implicit floors (a zone's own clearance) sit at priority 0: they combine with priority-0 floors and are
 *   overridden by any matching floor of a higher priority.
 *
 * Comparison tolerance (`toleranceOf`): a distance (clearance, physical clearance, hole clearance, hole to hole, copper
 * to edge, silkscreen to pad, diff pair gap) passes when it is short of its minimum by at most
 * `DISTANCE_TOLERANCE_NM` (500 nm), as KiCad 10 passes it (measured: 0.5 um short passes, 0.501 um fails); a size
 * (track width, via diameter, hole size, annular ring, length) is compared exactly at whole nanometers.
 *
 * Matching: `nets` and `classes` match when any object of the pair is on one of them (an object without a net
 * has class `default`); `layers` when the measurement's layer is listed (a measurement with no layer, such as a
 * drill, matches any); `between` when the pair's kinds are the two listed, in either order (a single object
 * matches when its kind is either); `region` when the measurement's location lies inside, or any of the
 * measured objects reaches into it; `when` when the condition holds with the objects as (A, B) or as (B, A).
 */
import { footprintToWorld, netClassOf, recordsOfKind, type BoardDocument, type RuleCondition, type RuleRec, type RuleTier } from "@protoboardai/board";
import { edgesOnly, flattenContour, pointInPoly, polyCore, shape, shapeGap, type PolyCore, type Shape } from "./geom/shape.js";

export type ObjKind = "pad" | "track" | "via" | "zone" | "keepout" | "footprint" | "outline" | "cutout" | "graphic" | "text" | "hole";
export type RuleCheckName = RuleRec["check"];

/** KiCad 10 passes a clearance short of its minimum by up to 500 nm (measured); sizes are compared exactly. */
export const DISTANCE_TOLERANCE_NM = 500;
const DISTANCE_CHECKS = new Set<RuleCheckName>(["clearance", "physical_clearance", "hole_clearance", "hole_to_hole", "edge_clearance", "silk_to_pad", "diff_pair_gap"]);
/** The comparison tolerance of a check (nm): a measurement short of a minimum (or over a maximum) by at most this passes. */
export const toleranceOf = (check: RuleCheckName): number => (DISTANCE_CHECKS.has(check) ? DISTANCE_TOLERANCE_NM : 0);

/** What a condition can ask of one measured object. */
export interface SubjectObject {
  id: string;
  kind: ObjKind;
  net?: string;
  /** The copper or drawing layer of the measurement on this object. */
  layer?: string;
  shape?: Shape;
  /** Pads: the footprint record id, the pad number and the pad type. Footprints: their own id. */
  footprint?: string;
  pad?: string;
  padType?: "smd" | "th" | "np";
  /** A via's, pad's or footprint's position; a track's ends. */
  at?: { x: number; y: number };
  start?: { x: number; y: number };
  end?: { x: number; y: number };
}

export interface Subject {
  nets: (string | undefined)[];
  kinds: ObjKind[];
  /** The copper or drawing layers of the measurement; absent or empty: not layer-specific. */
  layers?: string[];
  at: { x: number; y: number };
  /** The measured objects' shapes, for region rules. */
  shapes?: Shape[];
  /** The measured objects (one, or the pair), for `when` conditions. Without them a condition matches nothing. */
  objects?: SubjectObject[];
}

export interface Violation {
  /** The rule that applied, or undefined for a built-in default or an implicit floor. */
  rule?: string;
  tier?: RuleTier;
  severity: "error" | "warning" | "info";
  /** The limit the measurement broke (nm). */
  required?: number;
  bound: "min" | "max" | "flag";
  cost?: number;
  /** For an implicit floor: what it is (`zone <id> clearance`). */
  implicit?: string;
}

/** A floor that is not a rule record (a zone's own clearance), at priority 0. */
export interface ImplicitFloor {
  min: number;
  label: string;
}

const DEFAULT_SEVERITY: Record<RuleTier, "error" | "warning"> = { floor: "error", target: "warning", policy: "warning", no_go: "error" };

interface Compiled {
  rule: RuleRec;
  priority: number;
  region?: PolyCore;
  regionShape?: Shape;
  specificity: number;
}

function specificity(r: RuleRec): number {
  const a = r.applies;
  if (a.region) return 50;
  if (a.nets?.length) return 40;
  if (a.classes?.length) return 30;
  if (a.layers?.length) return 20;
  if (a.between || a.when) return 15;
  return 10;
}

/** `*` and `?` wildcards, as KiCad's condition functions take them. */
const wildcard = (p: string) => new RegExp(`^${p.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")}$`);

export interface Resolved {
  floor: RuleRec[];
  target: RuleRec[];
  policy: RuleRec[];
  no_go: RuleRec[];
  /** The priority of the floor rules left (-1: no floor rule matched). */
  floorPriority: number;
}

export class RuleBook {
  private readonly byCheck = new Map<RuleCheckName, Compiled[]>();
  private readonly classCache = new Map<string, string>();
  private areas?: Map<string, { poly: PolyCore; shape: Shape; edges: Shape }[]>;
  private courtyards?: { ref: string; poly: PolyCore; shape: Shape }[];
  private readonly patterns = new Map<string, RegExp>();

  constructor(private readonly doc: BoardDocument) {
    for (const r of recordsOfKind(doc, "rule")) {
      if (r.enabled === false) continue;
      const list = this.byCheck.get(r.check) ?? [];
      const region = r.applies.region ? polyCore([flattenContour(r.applies.region)]) : undefined;
      list.push({ rule: r, priority: r.priority ?? 0, ...(region ? { region, regionShape: shape(region, 0) } : {}), specificity: specificity(r) });
      this.byCheck.set(r.check, list);
    }
  }

  /** Whether any enabled rule exists for a check. */
  has(check: RuleCheckName): boolean {
    return (this.byCheck.get(check)?.length ?? 0) > 0;
  }

  /** The enabled rules of a check. */
  rules(check: RuleCheckName): RuleRec[] {
    return (this.byCheck.get(check) ?? []).map((c) => c.rule);
  }

  /** The largest `min` of any enabled rule of a check (the search radius for pair checks); 0 without one. */
  maxMin(check: RuleCheckName): number {
    let m = 0;
    for (const c of this.byCheck.get(check) ?? []) if (c.rule.min !== undefined && c.rule.severity !== "ignore") m = Math.max(m, c.rule.min);
    return m;
  }

  classOf(net: string | undefined): string {
    if (net === undefined) return "default";
    let c = this.classCache.get(net);
    if (c === undefined) {
      c = netClassOf(this.doc, net);
      this.classCache.set(net, c);
    }
    return c;
  }

  private pattern(p: string): RegExp {
    let r = this.patterns.get(p);
    if (!r) this.patterns.set(p, (r = wildcard(p)));
    return r;
  }

  private areaShapes(name: string): { poly: PolyCore; shape: Shape; edges: Shape }[] {
    if (!this.areas) {
      this.areas = new Map();
      for (const k of recordsOfKind(this.doc, "keepout")) {
        if (!k.name) continue;
        const poly = polyCore([flattenContour(k.outline), ...(k.holes ?? []).map((h) => flattenContour(h))]);
        const l = this.areas.get(k.name) ?? [];
        l.push({ poly, shape: shape(poly, 0), edges: shape(edgesOnly(poly), 0) });
        this.areas.set(k.name, l);
      }
    }
    return this.areas.get(name) ?? [];
  }

  private courtyardList(): { ref: string; poly: PolyCore; shape: Shape }[] {
    if (!this.courtyards) {
      this.courtyards = [];
      for (const fp of recordsOfKind(this.doc, "footprint")) {
        if (!fp.courtyard) continue;
        const poly = polyCore([
          flattenContour(fp.courtyard, (x, y) => {
            const w = footprintToWorld(fp, { x, y });
            return [w.x, w.y];
          }),
        ]);
        this.courtyards.push({ ref: fp.ref, poly, shape: shape(poly, 0) });
      }
    }
    return this.courtyards;
  }

  /** Whether a condition holds for A (and B). */
  test(c: RuleCondition, A: SubjectObject | undefined, B: SubjectObject | undefined): boolean {
    if ("all" in c) return c.all.every((x) => this.test(x, A, B));
    if ("any" in c) return c.any.some((x) => this.test(x, A, B));
    if ("not" in c) return !this.test(c.not, A, B);
    if ("same_net" in c) return !!A && !!B && A.net !== undefined && A.net === B.net;
    const o = c.side === "A" ? A : B;
    if (!o) return false;
    if ("kind" in c) return c.kind.includes(o.kind);
    if ("pad_type" in c) return o.padType !== undefined && c.pad_type.includes(o.padType);
    if ("net" in c) return o.net !== undefined && c.net.includes(o.net);
    if ("class" in c) return c.class.includes(this.classOf(o.net));
    if ("layer" in c) return o.layer !== undefined && (c.layer as string[]).includes(o.layer);
    if ("pad" in c) return o.pad !== undefined && c.pad.some((p) => this.pattern(p).test(o.pad!));
    if ("footprint" in c) {
      const fp = o.footprint ? this.doc.records.get(o.footprint) : undefined;
      if (fp?.kind !== "footprint") return false;
      return c.footprint.some((p) => this.pattern(p).test(fp.ref) || this.pattern(p).test(fp.footprint));
    }
    if ("coord" in c) {
      const p = c.of === "at" ? o.at : c.of === "start" ? o.start : o.end;
      if (!p) return false;
      const v = c.coord === "x" ? p.x : p.y;
      return (c.gt === undefined || v > c.gt) && (c.lt === undefined || v < c.lt);
    }
    if ("courtyard" in c) {
      if (!o.shape) return false;
      return this.courtyardList().some((cy) => c.courtyard.some((p) => this.pattern(p).test(cy.ref)) && shapeGap(o.shape!, cy.shape, 1) <= 1);
    }
    if ("area" in c) {
      if (!o.shape) return false;
      for (const name of c.area)
        for (const a of this.areaShapes(name)) {
          if (!(shapeGap(o.shape, a.shape, 1) <= 1)) continue;
          // wholly inside: overlapping and not reaching its boundary
          if (c.touch || shapeGap(o.shape, a.edges, 1) > 1) return true;
        }
      return false;
    }
    return false;
  }

  private matches(c: Compiled, s: Subject): boolean {
    const a = c.rule.applies;
    if (a.nets?.length && !s.nets.some((n) => n !== undefined && a.nets!.includes(n))) return false;
    if (a.classes?.length && !s.nets.some((n) => a.classes!.includes(this.classOf(n)))) return false;
    if (a.layers?.length && s.layers?.length && !s.layers.some((l) => (a.layers as string[]).includes(l))) return false;
    if (a.between) {
      const [k1, k2] = a.between;
      if (s.kinds.length >= 2) {
        const [x, y] = s.kinds;
        if (!((x === k1 && y === k2) || (x === k2 && y === k1))) return false;
      } else if (!s.kinds.includes(k1) && !s.kinds.includes(k2)) return false;
    }
    if (c.region && !pointInPoly(c.region, s.at.x, s.at.y) && !s.shapes?.some((sh) => shapeGap(sh, c.regionShape!, 1) <= 1)) return false;
    if (a.when) {
      const [A, B] = s.objects ?? [];
      if (!A) return false;
      if (!this.test(a.when, A, B) && !(B && this.test(a.when, B, A))) return false;
    }
    return true;
  }

  /** The matching rules of a check, by tier, after precedence. */
  resolve(check: RuleCheckName, s: Subject): Resolved {
    const byTier: Record<RuleTier, Compiled[]> = { floor: [], target: [], policy: [], no_go: [] };
    for (const c of this.byCheck.get(check) ?? []) if (this.matches(c, s)) byTier[c.rule.tier].push(c);
    const top = (l: Compiled[]) => {
      if (!l.length) return { list: l, p: -1 };
      const p = Math.max(...l.map((c) => c.priority));
      return { list: l.filter((c) => c.priority === p), p };
    };
    const f = top(byTier.floor);
    const t = top(byTier.target).list;
    const out: Resolved = { floor: f.list.map((c) => c.rule), target: [], policy: top(byTier.policy).list.map((c) => c.rule), no_go: top(byTier.no_go).list.map((c) => c.rule), floorPriority: f.p };
    if (t.length) {
      t.sort((a, b) => b.specificity - a.specificity || (b.rule.min ?? 0) - (a.rule.min ?? 0) || (a.rule.id < b.rule.id ? -1 : 1));
      out.target.push(t[0].rule);
    }
    return out;
  }

  /**
   * The limits a size or distance breaks when it must be at least `min` (and at most `max`). `implicit` floors (a
   * zone's own clearance) take part at priority 0.
   */
  evaluate(check: RuleCheckName, measuredRaw: number, s: Subject, implicit: readonly ImplicitFloor[] = []): Violation[] {
    const measured = Math.round(measuredRaw);
    const tol = toleranceOf(check);
    const below = (min: number) => measured < min - tol;
    const above = (max: number) => measured > max + tol;
    const r = this.resolve(check, s);
    const out: Violation[] = [];
    const sev = (rule: RuleRec) => (rule.severity === "ignore" ? undefined : (rule.severity ?? DEFAULT_SEVERITY[rule.tier]));
    const push = (rule: RuleRec, required: number, bound: "min" | "max") => {
      const severity = sev(rule);
      if (!severity) return;
      out.push({ rule: rule.id, tier: rule.tier, severity, required, bound, ...(rule.cost !== undefined ? { cost: rule.cost } : {}) });
    };
    // floor: the largest min, the smallest max (implicit floors join at priority 0)
    let floorMin: RuleRec | undefined;
    let floorMax: RuleRec | undefined;
    for (const f of r.floor) {
      if (f.min !== undefined && (!floorMin || f.min > floorMin.min! || (f.min === floorMin.min && f.id < floorMin.id))) floorMin = f;
      if (f.max !== undefined && (!floorMax || f.max < floorMax.max! || (f.max === floorMax.max && f.id < floorMax.id))) floorMax = f;
    }
    let imp: ImplicitFloor | undefined;
    if (r.floorPriority <= 0) for (const i of implicit) if (i.min > (floorMin?.min ?? -1) && i.min > (imp?.min ?? -1)) imp = i;
    let floorBrokenMin = false;
    let floorBrokenMax = false;
    if (imp && below(imp.min)) {
      // at the severity of the priority-0 floor it joins, else an error
      const severity = floorMin ? sev(floorMin) : "error";
      if (severity) out.push({ tier: "floor", severity, required: imp.min, bound: "min", implicit: imp.label });
      floorBrokenMin = true;
    } else if (floorMin && below(floorMin.min!)) {
      push(floorMin, floorMin.min!, "min");
      floorBrokenMin = true;
    }
    if (floorMax && above(floorMax.max!)) {
      push(floorMax, floorMax.max!, "max");
      floorBrokenMax = true;
    }
    const t = r.target[0];
    if (t) {
      if (!floorBrokenMin && t.min !== undefined && below(t.min)) push(t, t.min, "min");
      if (!floorBrokenMax && t.max !== undefined && above(t.max)) push(t, t.max, "max");
    }
    for (const p of [...r.policy, ...r.no_go]) {
      if (p.min !== undefined && below(p.min)) push(p, p.min, "min");
      if (p.max !== undefined && above(p.max)) push(p, p.max, "max");
    }
    return out;
  }

  /**
   * The rules a condition breaks when the condition itself is the violation (a via in a pad, overlapping
   * courtyards, a disallowed object): every rule left after precedence applies, at its tier's severity. With no
   * matching rule, `fallback` (a built-in default) applies, or nothing.
   */
  flag(check: RuleCheckName, s: Subject, fallback?: "error" | "warning"): Violation[] {
    const r = this.resolve(check, s);
    const all = [...r.floor, ...r.target, ...r.policy, ...r.no_go];
    const out: Violation[] = [];
    for (const rule of all) {
      const severity = rule.severity === "ignore" ? undefined : (rule.severity ?? DEFAULT_SEVERITY[rule.tier]);
      if (severity) out.push({ rule: rule.id, tier: rule.tier, severity, bound: "flag", ...(rule.cost !== undefined ? { cost: rule.cost } : {}) });
    }
    // a matching rule set to ignore silences the default too
    if (!all.length && fallback) out.push({ severity: fallback, bound: "flag" });
    return out;
  }

  /**
   * The highest priority of the enabled `disallow` rules that match an object (any tier), or -1. A keep-out is a
   * no-go at priority 0 for the kinds it blocks: a matching disallow rule of a higher priority replaces it.
   */
  disallowPriority(s: Subject): number {
    let p = -1;
    for (const c of this.byCheck.get("disallow") ?? []) if (c.priority > p && this.matches(c, s)) p = c.priority;
    return p;
  }
}
