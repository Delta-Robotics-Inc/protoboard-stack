/**
 * Rules in four tiers (contract section 5) resolved for a router. The floor is a hard limit (the largest matching
 * floor minimum); the target is the plan (the most specific matching target rule: nets, then classes, then
 * board-wide; ties take the larger minimum); policies are costs, never walls; no-go is a wall only where it
 * applies. Rules bound to a region, a layer or a pair of object kinds have no place in a router's input: they are
 * listed in `localRules` and checked after the run.
 *
 * Over-constraining the router was the main historical failure, so nothing here turns a preference into a wall.
 */
import { byCodeUnit, netClassOf, recordsOfKind, type BoardDocument, type CopperLayer, type RuleRec } from "@protoboardai/board";
import type { KeepoutConstraint, NetConstraint, PlanFloor, PolicyCost, ResolvedConstraints } from "./types.js";

/** DEFAULT: values the router plans at when no target rule gives one (nanometers; illustrative, not a fab's limits). */
export const DEFAULT_PLAN = { width: 250_000, clearance: 200_000, viaOuter: 600_000, viaHole: 300_000, edge: 300_000 } as const;
/** DEFAULT: hard limits when no floor rule gives one (nanometers; illustrative, common two-layer fab values). */
export const DEFAULT_FLOOR = { width: 127_000, clearance: 127_000, viaOuter: 450_000, viaHole: 200_000, edge: 250_000 } as const;

type Check = RuleRec["check"];

const enabled = (r: RuleRec) => r.enabled !== false;

type Condition = NonNullable<RuleRec["applies"]["when"]>;
/**
 * A rule's `when` condition for a track of one net (side A, no second object): true or false when it depends only
 * on the object's kind, net and class; undefined when it depends on anything else (a layer, an area, a pad, a
 * footprint, a coordinate, the other object of a pair), which no router input can take.
 */
export function whenForNetTrack(c: Condition, net: string | undefined, cls: string | undefined): boolean | undefined {
  if ("all" in c) {
    let unknown = false;
    for (const x of c.all) {
      const v = whenForNetTrack(x, net, cls);
      if (v === false) return false;
      if (v === undefined) unknown = true;
    }
    return unknown ? undefined : true;
  }
  if ("any" in c) {
    let unknown = false;
    for (const x of c.any) {
      const v = whenForNetTrack(x, net, cls);
      if (v === true) return true;
      if (v === undefined) unknown = true;
    }
    return unknown ? undefined : false;
  }
  if ("not" in c) {
    const v = whenForNetTrack(c.not, net, cls);
    return v === undefined ? undefined : !v;
  }
  if ("same_net" in c || c.side !== "A") return undefined;
  if ("kind" in c) return c.kind.includes("track");
  if ("net" in c) return net !== undefined && c.net.includes(net);
  if ("class" in c) return c.class.includes(cls ?? "default");
  return undefined;
}

/** Whether a `when` condition can be decided from a net and its class alone (no geometry, no second object). */
function decidable(c: Condition): boolean {
  if ("all" in c) return c.all.every(decidable);
  if ("any" in c) return c.any.every(decidable);
  if ("not" in c) return decidable(c.not);
  if ("same_net" in c || c.side !== "A") return false;
  return "kind" in c || "net" in c || "class" in c;
}

/**
 * Whether a rule is local (region, layers, an object-kind pair, or a `when` condition that needs more than the net
 * and its class): a router input cannot take it.
 */
const isLocal = (r: RuleRec) => !!(r.applies.region || r.applies.layers?.length || r.applies.between || (r.applies.when && !decidable(r.applies.when)));

function matchesNet(r: RuleRec, net: string | undefined, cls: string | undefined): boolean {
  if (r.applies.nets && (!net || !r.applies.nets.includes(net))) return false;
  if (r.applies.classes && (!cls || !r.applies.classes.includes(cls))) return false;
  // a condition on the net or its class (a KiCad custom rule such as "A.NetClass == 'Power'") holds for this net
  // only; board-wide (no net) it holds for none
  if (r.applies.when && (net === undefined || whenForNetTrack(r.applies.when, net, cls) !== true)) return false;
  return true;
}

const specificity = (r: RuleRec) => (r.applies.nets ? 2 : r.applies.classes ? 1 : 0);

/** The plan and floor of one check for one net (or board-wide when `net` is undefined). */
function resolve(rules: RuleRec[], check: Check, net: string | undefined, cls: string | undefined, def: { plan: number; floor: number }, floorOnly: boolean): { value: PlanFloor; targetRules: string[]; defaulted: boolean } {
  const matching = rules.filter((r) => enabled(r) && r.check === check && !isLocal(r) && matchesNet(r, net, cls));
  const floors = matching.filter((r) => r.tier === "floor" && r.min !== undefined).map((r) => r.min!);
  const floor = floors.length ? Math.max(...floors) : def.floor;
  if (floorOnly) return { value: { plan: floor, floor }, targetRules: [], defaulted: !floors.length };
  const targets = matching
    .filter((r) => r.tier === "target" && (r.min !== undefined || r.preferred !== undefined))
    .sort((a, b) => specificity(b) - specificity(a) || (b.min ?? 0) - (a.min ?? 0) || byCodeUnit(a.id, b.id));
  const t = targets[0];
  const plan = t ? (t.preferred ?? t.min!) : def.plan;
  return { value: { plan: Math.max(plan, floor), floor }, targetRules: t ? [t.id] : [], defaulted: !t || !floors.length };
}

export interface ResolveOptions {
  /** `floor-and-no-go`: drop target and policy tiers (the rules-or-placement diagnostic). */
  tiers?: "all" | "floor-and-no-go";
  /** Layers in scope (keep-outs are clipped to these). */
  layers?: CopperLayer[];
}

/** Resolve the board's rules for the given nets. */
export function resolveConstraints(doc: BoardDocument, nets: readonly string[], options: ResolveOptions = {}): ResolvedConstraints {
  const tiers = options.tiers ?? "all";
  const floorOnly = tiers === "floor-and-no-go";
  const rules = recordsOfKind(doc, "rule");
  const defaulted = new Set<string>();
  const pf = (plan: number, floor: number) => ({ plan, floor });

  const w = resolve(rules, "track_width", undefined, undefined, pf(DEFAULT_PLAN.width, DEFAULT_FLOOR.width), floorOnly);
  const c = resolve(rules, "clearance", undefined, undefined, pf(DEFAULT_PLAN.clearance, DEFAULT_FLOOR.clearance), floorOnly);
  if (w.defaulted) defaulted.add("track width");
  if (c.defaulted) defaulted.add("clearance");

  const perNet: Record<string, NetConstraint> = {};
  for (const net of [...nets].sort(byCodeUnit)) {
    const cls = netClassOf(doc, net);
    const nw = resolve(rules, "track_width", net, cls, pf(DEFAULT_PLAN.width, DEFAULT_FLOOR.width), floorOnly);
    const nc = resolve(rules, "clearance", net, cls, pf(DEFAULT_PLAN.clearance, DEFAULT_FLOOR.clearance), floorOnly);
    perNet[net] = {
      net,
      class: cls,
      width: nw.value,
      clearance: nc.value,
      targetRules: [...new Set([...nw.targetRules, ...nc.targetRules])].sort(byCodeUnit),
      sources: { ...(nw.targetRules[0] ? { width: nw.targetRules[0] } : {}), ...(nc.targetRules[0] ? { clearance: nc.targetRules[0] } : {}) },
    };
  }

  const vo = resolve(rules, "via_diameter", undefined, undefined, pf(DEFAULT_PLAN.viaOuter, DEFAULT_FLOOR.viaOuter), floorOnly);
  const vh = resolve(rules, "via_hole", undefined, undefined, pf(DEFAULT_PLAN.viaHole, DEFAULT_FLOOR.viaHole), floorOnly);
  if (vo.defaulted) defaulted.add("via diameter");
  if (vh.defaulted) defaulted.add("via hole");
  // the annular ring floor raises the via's outer diameter
  const ring = resolve(rules, "annular_ring", undefined, undefined, pf(0, 0), floorOnly).value;
  const via = { outer: { plan: Math.max(vo.value.plan, vh.value.plan + 2 * ring.plan), floor: Math.max(vo.value.floor, vh.value.floor + 2 * ring.floor) }, hole: vh.value };
  if (via.outer.plan <= via.hole.plan) via.outer.plan = via.hole.plan + 2 * Math.max(ring.plan, 100_000);

  const e = resolve(rules, "edge_clearance", undefined, undefined, pf(DEFAULT_PLAN.edge, DEFAULT_FLOOR.edge), floorOnly);
  if (e.defaulted) defaulted.add("edge clearance");

  const scopeLayers = options.layers;
  const keepouts: KeepoutConstraint[] = recordsOfKind(doc, "keepout")
    .filter((k) => !floorOnly || k.tier === "no_go")
    .map((k) => ({ id: k.id, tier: k.tier, layers: k.layers.filter((l) => !scopeLayers || scopeLayers.includes(l)), blocks: k.blocks, outline: k.outline }))
    .filter((k) => k.layers.length > 0);

  const noGoRules = rules
    .filter((r) => enabled(r) && r.tier === "no_go" && !r.applies.region && !r.applies.layers?.length)
    .map((r) => ({ id: r.id, check: r.check, ...(r.applies.nets ? { nets: [...r.applies.nets] } : {}), ...(r.applies.classes ? { classes: [...r.applies.classes] } : {}) }));
  const policies: PolicyCost[] = floorOnly
    ? []
    : rules.filter((r) => enabled(r) && r.tier === "policy").map((r) => ({ id: r.id, check: r.check, cost: r.cost ?? 1, ...(r.applies.region ? { region: r.applies.region } : {}) }));
  const localRules = rules.filter((r) => enabled(r) && (r.tier === "floor" || r.tier === "target" || r.tier === "no_go") && isLocal(r) && (!floorOnly || r.tier !== "target")).map((r) => r.id);

  return {
    tiers,
    defaults: { width: w.value, clearance: c.value },
    nets: perNet,
    via,
    edgeClearance: e.value,
    keepouts,
    noGoRules,
    policies,
    localRules,
    defaulted: [...defaulted].sort(byCodeUnit),
  };
}

/** The constraint of a net, falling back to the board-wide values. */
export function netConstraint(c: ResolvedConstraints, net: string): NetConstraint {
  return c.nets[net] ?? { net, class: "default", width: c.defaults.width, clearance: c.defaults.clearance, targetRules: [], sources: {} };
}

/**
 * What no router input can take, common to every adapter: policy costs (costs, never walls), local rules, policy
 * keep-outs. Adapters add their own.
 */
export function commonUnexpressed(c: ResolvedConstraints): string[] {
  const out: string[] = [];
  for (const p of c.policies) out.push(`policy ${p.id} (${p.check}, cost ${p.cost}) is a cost, not a wall: not in the router input; checked after`);
  for (const k of c.keepouts) if (k.tier === "policy") out.push(`policy keep-out ${k.id} is a cost, not a wall: not in the router input; checked after`);
  for (const id of c.localRules) out.push(`rule ${id} applies only to a region, layer or object pair: not in the router input; checked after`);
  return out;
}
