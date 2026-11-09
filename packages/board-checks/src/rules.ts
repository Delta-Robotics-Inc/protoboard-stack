/**
 * Rule resolution in four tiers (contract section 5). For one check on one object or pair:
 *
 * - every enabled rule of that check whose `applies` matches is collected;
 * - `floor`: the hard limit is the largest matching `min` (the smallest matching `max`); below it is an error;
 * - `target`: the most specific matching rule (region, then nets, then classes, then layers, then global; ties
 *   take the larger `min`) gives the plan value; below it but at or above the floor is a warning;
 * - `policy`: every matching rule applies on its own, a warning that carries its `cost`;
 * - `no_go`: every matching rule is an error;
 * - `severity` on a rule overrides its tier's default, and `ignore` drops the finding;
 * - measurements are compared at whole nanometers (the board's own unit), so a gap computed as 99,999.9999 nm
 *   against a 0.1 mm limit passes, as the exact integer geometry does.
 *
 * Matching: `nets` and `classes` match when any object of the pair is on one of them (an object without a net
 * has class `default`); `layers` when the measurement's layer is listed (a measurement with no layer, such as a
 * drill, matches any); `between` when the pair's kinds are the two listed, in either order (a single object
 * matches when its kind is either); `region` when the measurement's location lies inside, or any of the
 * measured objects reaches into it.
 */
import { netClassOf, recordsOfKind, type BoardDocument, type RuleRec, type RuleTier } from "@protoboardai/board";
import { flattenContour, pointInPoly, polyCore, shape, shapeGap, type PolyCore, type Shape } from "./geom/shape.js";

export type ObjKind = "pad" | "track" | "via" | "zone" | "keepout" | "footprint" | "outline" | "cutout" | "graphic" | "text" | "hole";
export type RuleCheckName = RuleRec["check"];

export interface Subject {
  nets: (string | undefined)[];
  kinds: ObjKind[];
  /** The copper or drawing layers of the measurement; absent or empty: not layer-specific. */
  layers?: string[];
  at: { x: number; y: number };
  /** The measured objects' shapes, for region rules. */
  shapes?: Shape[];
}

export interface Violation {
  /** The rule that applied, or undefined for a built-in default. */
  rule?: string;
  tier?: RuleTier;
  severity: "error" | "warning" | "info";
  /** The limit the measurement broke (nm). */
  required?: number;
  bound: "min" | "max" | "flag";
  cost?: number;
}

const DEFAULT_SEVERITY: Record<RuleTier, "error" | "warning"> = { floor: "error", target: "warning", policy: "warning", no_go: "error" };

interface Compiled {
  rule: RuleRec;
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
  if (a.between) return 15;
  return 10;
}

export class RuleBook {
  private readonly byCheck = new Map<RuleCheckName, Compiled[]>();
  private readonly classCache = new Map<string, string>();

  constructor(private readonly doc: BoardDocument) {
    for (const r of recordsOfKind(doc, "rule")) {
      if (r.enabled === false) continue;
      const list = this.byCheck.get(r.check) ?? [];
      const region = r.applies.region ? polyCore([flattenContour(r.applies.region)]) : undefined;
      list.push({ rule: r, ...(region ? { region, regionShape: shape(region, 0) } : {}), specificity: specificity(r) });
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
    return true;
  }

  /** The matching rules of a check, by tier. */
  resolve(check: RuleCheckName, s: Subject): { floor: RuleRec[]; target: RuleRec[]; policy: RuleRec[]; no_go: RuleRec[] } {
    const out = { floor: [] as RuleRec[], target: [] as RuleRec[], policy: [] as RuleRec[], no_go: [] as RuleRec[] };
    const targets: Compiled[] = [];
    for (const c of this.byCheck.get(check) ?? []) {
      if (!this.matches(c, s)) continue;
      if (c.rule.tier === "target") targets.push(c);
      else out[c.rule.tier].push(c.rule);
    }
    if (targets.length) {
      targets.sort((a, b) => b.specificity - a.specificity || (b.rule.min ?? 0) - (a.rule.min ?? 0) || (a.rule.id < b.rule.id ? -1 : 1));
      out.target.push(targets[0].rule);
    }
    return out;
  }

  /** The limits a size or distance breaks when it must be at least `min` (and at most `max`). */
  evaluate(check: RuleCheckName, measuredRaw: number, s: Subject): Violation[] {
    const measured = Math.round(measuredRaw);
    const r = this.resolve(check, s);
    const out: Violation[] = [];
    const sev = (rule: RuleRec) => (rule.severity === "ignore" ? undefined : (rule.severity ?? DEFAULT_SEVERITY[rule.tier]));
    const push = (rule: RuleRec, required: number, bound: "min" | "max") => {
      const severity = sev(rule);
      if (!severity) return;
      out.push({ rule: rule.id, tier: rule.tier, severity, required, bound, ...(rule.cost !== undefined ? { cost: rule.cost } : {}) });
    };
    // floor: the largest min, the smallest max
    let floorMin: RuleRec | undefined;
    let floorMax: RuleRec | undefined;
    for (const f of r.floor) {
      if (f.min !== undefined && (!floorMin || f.min > floorMin.min! || (f.min === floorMin.min && f.id < floorMin.id))) floorMin = f;
      if (f.max !== undefined && (!floorMax || f.max < floorMax.max! || (f.max === floorMax.max && f.id < floorMax.id))) floorMax = f;
    }
    let floorBrokenMin = false;
    let floorBrokenMax = false;
    if (floorMin && measured < floorMin.min!) {
      push(floorMin, floorMin.min!, "min");
      floorBrokenMin = true;
    }
    if (floorMax && measured > floorMax.max!) {
      push(floorMax, floorMax.max!, "max");
      floorBrokenMax = true;
    }
    const t = r.target[0];
    if (t) {
      if (!floorBrokenMin && t.min !== undefined && measured < t.min) push(t, t.min, "min");
      if (!floorBrokenMax && t.max !== undefined && measured > t.max) push(t, t.max, "max");
    }
    for (const p of [...r.policy, ...r.no_go]) {
      if (p.min !== undefined && measured < p.min) push(p, p.min, "min");
      if (p.max !== undefined && measured > p.max) push(p, p.max, "max");
    }
    return out;
  }

  /**
   * The rules a condition breaks when the condition itself is the violation (a via in a pad, overlapping
   * courtyards): every matching rule applies, at its tier's severity. With no matching rule, `fallback` (a
   * built-in default) applies, or nothing.
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
}
