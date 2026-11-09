/**
 * The routing world: other nets' copper, holes, the board edge, cutouts and no-go keep-outs, with the clearance each
 * needs from a given net's track (contract phase2-editing.md, section 7.1). Built once per kernel and updated with
 * the records a commit changed; queried per layer through a grid (`CopperIndex`).
 */
import {
  contourPoints,
  CopperIndex,
  copperLayers,
  inflate,
  otherNet,
  pointGap,
  pointInPolygon,
  primBox,
  primGap,
  recordsOfKind,
  type BoardDocument,
  type CopperPiece,
  type ObjectKindName,
  type Prim,
  type RuleTier,
} from "@protoboardai/board/browser";
import { RuleResolver, type Resolved } from "./rules.js";

/** How close a shape comes to the nearest thing it must keep away from. */
export interface Slack {
  /** Gap minus required (negative: a violation). */
  slack: number;
  gap: number;
  required: number;
  against: string;
  check: "clearance" | "edge_clearance" | "keepout";
  rule?: string;
  tier?: RuleTier;
}

interface Area {
  id: string;
  layers: string[];
  pts: number[];
  prim: Prim;
  tracks: boolean;
  vias: boolean;
}

/** A query context: one net's copper of one radius on one layer. */
export interface LayerContext {
  readonly layer: string;
  readonly net: string;
  readonly r: number;
  /** The least slack of a point grown by `r` (stops early once below `stopBelow`). */
  pointSlack(x: number, y: number, stopBelow?: number): number;
  /** The least slack of a shape, with what limits it (undefined when nothing is within reach). */
  primSlack(p: Prim, ignore?: ReadonlySet<string>): Slack | undefined;
  /** Every piece closer than it may be (highlight mode). */
  violations(p: Prim, ignore?: ReadonlySet<string>): Slack[];
}

export class RouteWorld {
  index: CopperIndex;
  rules: RuleResolver;
  stack: string[];
  private outline?: { pts: number[]; line: Prim };
  private cutouts: { id: string; pts: number[]; line: Prim }[] = [];
  private areas: Area[] = [];
  /** The largest clearance any rule asks (nm): the search reach. */
  maxClearance = 0;

  constructor(public doc: BoardDocument) {
    this.index = CopperIndex.build(doc);
    this.rules = new RuleResolver(doc);
    this.stack = copperLayers(doc);
    this.loadStatic();
  }

  private loadStatic(): void {
    const doc = this.doc;
    const o = doc.records.get("outline");
    if (o?.kind === "outline") {
      const pts = contourPoints(o.outline);
      this.outline = { pts, line: { pts: [...pts, pts[0], pts[1]], r: 0, closed: false } };
    } else this.outline = undefined;
    this.cutouts = recordsOfKind(doc, "cutout").map((c) => {
      const pts = contourPoints(c.outline);
      return { id: c.id, pts, line: { pts: [...pts, pts[0], pts[1]], r: 0, closed: false } };
    });
    this.areas = recordsOfKind(doc, "keepout")
      .filter((k) => k.tier === "no_go" && (k.blocks.tracks || k.blocks.vias))
      .map((k) => {
        const pts = contourPoints(k.outline);
        return { id: k.id, layers: [...k.layers], pts, prim: { pts, r: 0, closed: true }, tracks: k.blocks.tracks, vias: k.blocks.vias };
      });
    let m = 0;
    for (const r of recordsOfKind(doc, "rule")) if (r.enabled !== false && (r.check === "clearance" || r.check === "edge_clearance") && r.min !== undefined) m = Math.max(m, r.min, r.preferred ?? 0);
    this.maxClearance = Math.max(m, 200_000, 300_000);
  }

  /** Bring the world to `next`, given the ids that changed. */
  update(next: BoardDocument, changed: readonly string[]): void {
    const global = changed.some((id) => {
      const r = next.records.get(id) ?? this.doc.records.get(id);
      return !r || r.kind === "rule" || r.kind === "netclass" || r.kind === "outline" || r.kind === "cutout" || r.kind === "keepout" || r.kind === "layer" || r.kind === "board";
    });
    const netlist = next.netlist !== this.doc.netlist;
    this.index.update(next, changed);
    this.doc = next;
    if (global || netlist) {
      this.rules = new RuleResolver(next);
      this.stack = copperLayers(next);
      this.loadStatic();
    }
  }

  /** The required clearance from a piece for a net's object of `self` kind on a layer. */
  required(net: string, p: CopperPiece, layer: string, self: ObjectKindName = "track"): Resolved {
    return this.rules.clearance(net, p.net, layer, p.kind as ObjectKindName, self);
  }

  context(net: string, layer: string, r: number, self: ObjectKindName = "track"): LayerContext {
    const reqCache = new Map<string, Resolved>();
    const req = (p: CopperPiece) => {
      const k = `${p.net ?? ""}|${p.kind}`;
      let v = reqCache.get(k);
      if (!v) reqCache.set(k, (v = this.rules.clearance(net, p.net, layer, p.kind as ObjectKindName, self)));
      return v;
    };
    const edge = this.rules.edge(net, layer);
    const reach = this.maxClearance + r;
    const areas = this.areas.filter((a) => a.layers.includes(layer) && (self === "via" ? a.vias : a.tracks));
    const world = this;
    const conflict = (p: CopperPiece) => otherNet({ net }, p);
    return {
      layer,
      net,
      r,
      pointSlack(x, y, stopBelow = -Infinity) {
        let best = Infinity;
        const box = { minX: x - reach, minY: y - reach, maxX: x + reach, maxY: y + reach };
        world.index.near(box, layer, (p) => {
          if (!conflict(p)) return;
          const s = pointGap(x, y, p.prim) - r - req(p).value;
          if (s < best) {
            best = s;
            if (best < stopBelow) return false;
          }
        });
        if (best < stopBelow) return best;
        if (world.outline) {
          const inside = pointInPolygon(x, y, world.outline.pts);
          const g = pointGap(x, y, world.outline.line) - r;
          best = Math.min(best, inside ? g - edge.value : -g - edge.value - 1);
        }
        for (const c of world.cutouts) {
          const g = pointGap(x, y, c.line) - r;
          best = Math.min(best, pointInPolygon(x, y, c.pts) ? -g - 1 : g - edge.value);
        }
        for (const a of areas) best = Math.min(best, pointGap(x, y, a.prim) - r - 1);
        return best;
      },
      primSlack(prim, ignore) {
        let best: Slack | undefined;
        const take = (s: Slack) => {
          if (!best || s.slack < best.slack) best = s;
        };
        world.index.near(inflate(primBox(prim), reach), layer, (p) => {
          if (!conflict(p) || ignore?.has(p.owner)) return;
          const q = req(p);
          const g = primGap(prim, p.prim);
          take({ slack: g - q.value, gap: g, required: q.value, against: p.id, check: "clearance", ...(q.rule ? { rule: q.rule } : {}), ...(q.tier ? { tier: q.tier } : {}) });
        });
        world.edgeSlack(prim, edge, take);
        for (const a of areas) {
          const g = primGap(prim, a.prim);
          take({ slack: g - 1, gap: g, required: 1, against: a.id, check: "keepout" });
        }
        return best;
      },
      violations(prim, ignore) {
        const out: Slack[] = [];
        world.index.near(inflate(primBox(prim), reach), layer, (p) => {
          if (!conflict(p) || ignore?.has(p.owner)) return;
          const q = req(p);
          const g = primGap(prim, p.prim);
          if (g < q.value) out.push({ slack: g - q.value, gap: g, required: q.value, against: p.id, check: "clearance", ...(q.rule ? { rule: q.rule } : {}), ...(q.tier ? { tier: q.tier } : {}) });
        });
        world.edgeSlack(prim, edge, (s) => {
          if (s.slack < 0) out.push(s);
        });
        for (const a of areas) if (primGap(prim, a.prim) <= 0) out.push({ slack: -1, gap: -1, required: 0, against: a.id, check: "keepout" });
        const seen = new Set<string>();
        return out.filter((s) => (seen.has(s.against) ? false : (seen.add(s.against), true)));
      },
    };
  }

  private edgeSlack(prim: Prim, edge: Resolved, take: (s: Slack) => void): void {
    const tag = { check: "edge_clearance" as const, ...(edge.rule ? { rule: edge.rule } : {}), ...(edge.tier ? { tier: edge.tier } : {}) };
    if (this.outline) {
      let inside = true;
      for (let i = 0; i < prim.pts.length; i += 2) if (!pointInPolygon(prim.pts[i], prim.pts[i + 1], this.outline.pts)) inside = false;
      const g = primGap(prim, this.outline.line);
      take({ slack: inside ? g - edge.value : -Math.abs(g) - edge.value - 1, gap: inside ? g : -1, required: edge.value, against: "outline", ...tag });
    }
    for (const c of this.cutouts) {
      let inside = false;
      for (let i = 0; i < prim.pts.length; i += 2) if (pointInPolygon(prim.pts[i], prim.pts[i + 1], c.pts)) inside = true;
      const g = primGap(prim, c.line);
      take({ slack: inside ? -1 : g - edge.value, gap: inside ? -1 : g, required: edge.value, against: c.id, ...tag });
    }
  }
}
