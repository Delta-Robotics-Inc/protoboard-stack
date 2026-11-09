/**
 * The built-in router: straight or L-shaped connections where the corridor is free, nothing else. It exists so the
 * orchestrator, the fallback policy and the diagnostic can be tested without external tools, and as a last
 * resort for trivial connections. It never moves or removes copper.
 */
import { byCodeUnit, padsOf, recordsOfKind, viaLayers, type CopperLayer } from "@protoboardai/board";
import { netConstraint } from "../constraints.js";
import { boxPolygon, dist, flattenContour, pointInPolygon, pointSegDist, segPolygonDist, segPolygonEdgeDist, segSegDist, trackPieces, type P } from "../geom.js";
import { routedProvenance, routedToOps, type RoutedSegment } from "../ops.js";
import type { IslandAnchor, RouteJob, RouteResult, Router } from "../types.js";

type Obstacle =
  | { kind: "poly"; net?: string; layers: CopperLayer[]; points: P[]; inflate: number }
  | { kind: "seg"; net?: string; layers: CopperLayer[]; a: P; b: P; half: number }
  | { kind: "circle"; net?: string; layers: CopperLayer[]; c: P; r: number };

function obstaclesOf(job: RouteJob): Obstacle[] {
  const doc = job.doc;
  const out: Obstacle[] = [];
  for (const fp of recordsOfKind(doc, "footprint"))
    for (const p of padsOf(fp, job.layers)) {
      const net = doc.padNets.get(p.id);
      const layers = p.drilled ? [...job.layers] : p.layers;
      out.push({ kind: "poly", ...(net ? { net } : {}), layers, points: boxPolygon(p.box), inflate: 0 });
    }
  for (const t of recordsOfKind(doc, "track")) for (const [a, b] of trackPieces(t)) out.push({ kind: "seg", ...(t.net ? { net: t.net } : {}), layers: [t.layer], a, b, half: t.width / 2 });
  for (const v of recordsOfKind(doc, "via")) out.push({ kind: "circle", ...(v.net ? { net: v.net } : {}), layers: viaLayers(doc, v.from_layer, v.to_layer), c: { x: v.x, y: v.y }, r: v.outer_diameter / 2 });
  for (const k of job.constraints.keepouts) if (k.tier === "no_go" && k.blocks.tracks) out.push({ kind: "poly", layers: k.layers, points: flattenContour(k.outline).points, inflate: 0 });
  return out;
}

/** The gap from a segment of half-width `half` to an obstacle (negative: overlap). */
function gap(a: P, b: P, half: number, o: Obstacle): number {
  if (o.kind === "seg") return segSegDist(a, b, o.a, o.b) - half - o.half;
  if (o.kind === "circle") return pointSegDist(o.c, a, b) - half - o.r;
  return segPolygonDist(a, b, o.points) - half - o.inflate;
}

export interface BuiltinOptions {
  id?: string;
  title?: string;
  /** Layers this router may use (default: the job's). Tests use it to make a weaker router. */
  layers?: CopperLayer[];
  /** Milliseconds to wait before each net (tests of cancel and timeouts). */
  delayMs?: number;
}

export const BUILTIN_VERSION = "1";

export function createBuiltinRouter(options: BuiltinOptions = {}): Router {
  const id = options.id ?? "builtin";
  const router: Router = {
    id,
    title: options.title ?? "Built-in straight and L router",
    version: () => BUILTIN_VERSION,
    available: () => ({ ok: true }),
    capabilities: { layers: { min: 1, max: 10 }, region: true, netSubset: true, respectsLockedCopper: true, incremental: true, maxThreads: 1 },
    express(job) {
      const out: string[] = [];
      for (const k of job.constraints.keepouts) if (k.tier === "no_go" && !k.blocks.tracks) out.push(`keep-out ${k.id} blocks only ${Object.entries(k.blocks).filter(([, v]) => v).map(([b]) => b).join(", ") || "nothing"}: the built-in router places no vias or pours, so it does not apply`);
      if (job.constraints.policies.length) out.push(`${job.constraints.policies.length} policy cost rule(s): the built-in router has no costs; checked after`);
      return out;
    },
    async route(job, signal, onProgress) {
      const t0 = Date.now();
      const deadline = t0 + job.budget.timeMs;
      const layers = options.layers ? job.layers.filter((l) => options.layers!.includes(l)) : job.layers;
      const obstacles = obstaclesOf(job);
      const outline = job.doc.records.get("outline");
      const edge = outline?.kind === "outline" ? flattenContour(outline.outline).points : undefined;
      const region = job.region ? flattenContour(job.region).points : undefined;
      const segments: RoutedSegment[] = [];
      let open = 0;
      let status: RouteResult["status"] = "complete";
      const nets = [...job.nets].sort((a, b) => byCodeUnit(a.net, b.net));
      for (let n = 0; n < nets.length; n++) {
        if (signal?.aborted) {
          status = "cancelled";
          break;
        }
        if (options.delayMs) await new Promise((r) => setTimeout(r, options.delayMs));
        if (signal?.aborted) {
          status = "cancelled";
          break;
        }
        if (Date.now() > deadline) {
          status = "timeout";
          break;
        }
        const net = nets[n];
        onProgress({ router: id, phase: "route", fraction: n / nets.length, elapsedMs: Date.now() - t0, message: net.net });
        const nc = netConstraint(job.constraints, net.net);
        const half = nc.width.plan / 2;
        const clear = nc.clearance.plan;
        const free = (a: P, b: P, layer: CopperLayer): boolean => {
          if (edge) {
            if (!pointInPolygon(a, edge) || !pointInPolygon(b, edge)) return false;
            if (segPolygonEdgeDist(a, b, edge) - half < job.constraints.edgeClearance.plan) return false;
          }
          if (region && (!pointInPolygon(a, region) || !pointInPolygon(b, region) || segPolygonEdgeDist(a, b, region) < half)) return false;
          for (const o of obstacles) {
            if (!o.layers.includes(layer)) continue;
            if (o.net !== undefined && o.net === net.net) continue;
            if (gap(a, b, half, o) < clear) return false;
          }
          return true;
        };
        // Prim's tree over the island anchors, nearest pairs first
        const anchors = net.islands;
        const inTree = new Set<number>([0]);
        while (inTree.size < anchors.length) {
          let best: [number, number] | undefined;
          for (const i of inTree)
            for (let j = 0; j < anchors.length; j++) {
              if (inTree.has(j)) continue;
              if (!best || dist(anchors[i], anchors[j]) < dist(anchors[best[0]], anchors[best[1]])) best = [i, j];
            }
          const [i, j] = best!;
          inTree.add(j);
          const path = connect(anchors[i], anchors[j], layers, free);
          if (!path) {
            open++;
            continue;
          }
          for (const s of path.pieces) {
            segments.push({ net: net.net, layer: path.layer, width: nc.width.plan, start: s[0], end: s[1] });
            obstacles.push({ kind: "seg", net: net.net, layers: [path.layer], a: s[0], b: s[1], half });
          }
        }
      }
      if (status === "complete" && open > 0) status = "partial";
      const conv = routedToOps(job.doc, segments, []);
      return {
        status,
        ops: status === "cancelled" ? [] : conv.ops,
        provenance: routedProvenance(id, BUILTIN_VERSION, job.runId),
        stats: { durationMs: Date.now() - t0, segments: conv.segments, vias: 0, length: Math.round(segments.reduce((s, x) => s + dist(x.start, x.end), 0)), routerReportedOpen: open },
        unexpressed: job.unexpressed,
        messages: conv.dropped,
        version: BUILTIN_VERSION,
      };
    },
  };
  return router;
}

/** A straight or L-shaped path between two anchors on a layer both reach, or undefined. */
function connect(a: IslandAnchor, b: IslandAnchor, layers: CopperLayer[], free: (a: P, b: P, layer: CopperLayer) => boolean): { layer: CopperLayer; pieces: [P, P][] } | undefined {
  const shared = layers.filter((l) => a.layers.includes(l) && b.layers.includes(l));
  for (const layer of shared) {
    if (free(a, b, layer)) return { layer, pieces: [[{ x: a.x, y: a.y }, { x: b.x, y: b.y }]] };
    for (const corner of [
      { x: b.x, y: a.y },
      { x: a.x, y: b.y },
    ]) {
      if ((corner.x === a.x && corner.y === a.y) || (corner.x === b.x && corner.y === b.y)) continue;
      if (free(a, corner, layer) && free(corner, b, layer))
        return {
          layer,
          pieces: [
            [{ x: a.x, y: a.y }, corner],
            [corner, { x: b.x, y: b.y }],
          ],
        };
    }
  }
  return undefined;
}
