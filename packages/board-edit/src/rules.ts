/**
 * The rules the routing head honors (contract phase2-editing.md, section 7.1): the plan width of a net on a layer, and
 * the clearance a net's track needs from another object, each with the rule and tier that set it. Precedence follows
 * the board contract (section 5): within a tier only the matching rules of the highest priority count; the floor is
 * the largest minimum of those; the target is the most specific of those (nets, then classes, then layers, then
 * object pairs, then global; ties take the larger value); the plan is the target's value, never below the floor.
 *
 * Rules bound to a region or carrying a `when` condition are not resolved here (the live checks judge them after a
 * commit); `skipped` lists them so a caller can say so.
 */
import { netClassOf, recordsOfKind, type BoardDocument, type ObjectKindName, type RuleRec, type RuleTier } from "@protoboardai/board/browser";

export interface Resolved {
  value: number;
  rule?: string;
  tier?: RuleTier;
  source: "rule" | "default";
}

/** DEFAULT: plan values when no rule gives one (nanometers; the router's defaults). */
export const EDIT_DEFAULTS = { width: 250_000, clearance: 200_000, edge: 300_000, viaOuter: 600_000, viaHole: 300_000 } as const;

const specificity = (r: RuleRec) => (r.applies.nets?.length ? 40 : r.applies.classes?.length ? 30 : r.applies.layers?.length ? 20 : r.applies.between ? 15 : 10);

export class RuleResolver {
  private readonly byCheck = new Map<RuleRec["check"], RuleRec[]>();
  private readonly cache = new Map<string, Resolved>();
  private readonly classes = new Map<string, string>();
  /** Rules with a region or a condition: not resolved by the head. */
  readonly skipped: string[] = [];

  constructor(private readonly doc: BoardDocument) {
    for (const r of recordsOfKind(doc, "rule")) {
      if (r.enabled === false) continue;
      if (r.applies.region || r.applies.when) {
        this.skipped.push(r.id);
        continue;
      }
      const l = this.byCheck.get(r.check) ?? [];
      l.push(r);
      this.byCheck.set(r.check, l);
    }
  }

  classOf(net: string | undefined): string {
    if (!net) return "default";
    let c = this.classes.get(net);
    if (c === undefined) this.classes.set(net, (c = netClassOf(this.doc, net)));
    return c;
  }

  private matching(check: RuleRec["check"], nets: (string | undefined)[], layer: string | undefined, kinds: ObjectKindName[]): RuleRec[] {
    const classes = nets.map((n) => this.classOf(n));
    return (this.byCheck.get(check) ?? []).filter((r) => {
      const a = r.applies;
      if (a.nets && !nets.some((n) => n !== undefined && a.nets!.includes(n))) return false;
      if (a.classes && !classes.some((c) => a.classes!.includes(c))) return false;
      if (a.layers && layer !== undefined && !a.layers.includes(layer as never)) return false;
      if (a.between) {
        const [x, y] = a.between;
        if (kinds.length === 1 ? !(kinds[0] === x || kinds[0] === y) : !((kinds[0] === x && kinds[1] === y) || (kinds[0] === y && kinds[1] === x))) return false;
      }
      return true;
    });
  }

  /** The plan value of a check for a subject, with the rule and tier that set it. */
  resolve(check: RuleRec["check"], nets: (string | undefined)[], layer: string | undefined, kinds: ObjectKindName[], fallback: number): Resolved {
    const key = `${check}|${nets.join("\u0001")}|${layer ?? ""}|${kinds.join(",")}|${fallback}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    const m = this.matching(check, nets, layer, kinds);
    const top = (tier: RuleTier) => {
      const l = m.filter((r) => r.tier === tier);
      if (!l.length) return l;
      const p = Math.max(...l.map((r) => r.priority ?? 0));
      return l.filter((r) => (r.priority ?? 0) === p);
    };
    let floor: RuleRec | undefined;
    for (const r of top("floor")) if (r.min !== undefined && (!floor || r.min > floor.min!)) floor = r;
    const targets = top("target")
      .filter((r) => r.preferred !== undefined || r.min !== undefined)
      .sort((a, b) => specificity(b) - specificity(a) || (b.preferred ?? b.min ?? 0) - (a.preferred ?? a.min ?? 0) || (a.id < b.id ? -1 : 1));
    const t = targets[0];
    let out: Resolved;
    if (t) {
      const v = t.preferred ?? t.min!;
      out = floor && floor.min! > v ? { value: floor.min!, rule: floor.id, tier: "floor", source: "rule" } : { value: v, rule: t.id, tier: "target", source: "rule" };
    } else if (floor) out = { value: floor.min!, rule: floor.id, tier: "floor", source: "rule" };
    else out = { value: fallback, source: "default" };
    // a floor-only width is a hard limit, not a plan: plan at the default when it is larger
    if (!t && floor && check === "track_width" && fallback > floor.min!) out = { value: fallback, source: "default" };
    this.cache.set(key, out);
    return out;
  }

  width(net: string, layer: string): Resolved {
    return this.resolve("track_width", [net], layer, ["track"], EDIT_DEFAULTS.width);
  }

  /** The clearance a track of `net` on `layer` needs from an object of `otherNet` and kind. */
  clearance(net: string, otherNet: string | undefined, layer: string, kind: ObjectKindName, self: ObjectKindName = "track"): Resolved {
    return this.resolve("clearance", [net, otherNet], layer, [self, kind], EDIT_DEFAULTS.clearance);
  }

  edge(net: string, layer: string): Resolved {
    return this.resolve("edge_clearance", [net], layer, ["track"], EDIT_DEFAULTS.edge);
  }

  via(): { outer: number; hole: number } {
    const hole = this.resolve("via_hole", [], undefined, ["via"], EDIT_DEFAULTS.viaHole).value;
    const outer = this.resolve("via_diameter", [], undefined, ["via"], EDIT_DEFAULTS.viaOuter).value;
    const ring = this.resolve("annular_ring", [], undefined, ["via"], 0).value;
    return { hole, outer: Math.max(outer, hole + 2 * ring, hole + 100_000) };
  }
}
