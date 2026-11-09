/** Building a route job from a board and a scope: the nets and islands to join, the constraints, the locked set. */
import { availableParallelism, freemem } from "node:os";
import { byCodeUnit, canonical, copperLayers, recordsOfKind, sha1Hex, type BoardDocument, type CopperLayer, type Vertex } from "@protoboardai/board";
import { resolveConstraints } from "./constraints.js";
import { copperModel, islandAnchors, openNetIslands } from "./connectivity.js";
import { flattenContour, pointInPolygon } from "./geom.js";
import type { NetToRoute, ResolvedConstraints, RouteBudget, RouteJob, RouteScope } from "./types.js";

export interface JobRequest {
  scope: RouteScope;
  seed?: number;
  budget?: Partial<RouteBudget>;
  /** Extra ids to treat as locked for this job only. */
  freeze?: string[];
  options?: Record<string, unknown>;
  /** `floor-and-no-go` for the diagnostic rerun. */
  tiers?: ResolvedConstraints["tiers"];
}

/** DEFAULT: a router run's wall clock (5 minutes), memory and threads from this machine (one heavy job at a time). */
export function defaultBudget(): RouteBudget {
  const threads = Math.max(1, Math.min(4, Math.floor(availableParallelism() / 4)));
  const memoryMb = Math.max(512, Math.min(3072, Math.floor(freemem() / 1024 / 1024 / 3)));
  return { timeMs: 300_000, threads, memoryMb };
}

/** Nets that own a zone (a pour): left to the pour unless the scope names them or asks for them. */
export function pourNets(doc: BoardDocument): Set<string> {
  return new Set(recordsOfKind(doc, "zone").flatMap((z) => (z.net ? [z.net] : [])));
}

/** Ids of every locked record. */
export function lockedIds(doc: BoardDocument): string[] {
  const out: string[] = [];
  for (const r of doc.records.values()) if ((r as { locked?: true }).locked) out.push(r.id);
  return out.sort(byCodeUnit);
}

/** The nets and islands a scope asks to route. */
export function netsInScope(doc: BoardDocument, scope: RouteScope): { nets: NetToRoute[]; notes: string[] } {
  const notes: string[] = [];
  const model = copperModel(doc);
  const open = openNetIslands(doc, model);
  const pours = pourNets(doc);
  let names: string[];
  if (scope.kind === "nets") {
    const unknown = scope.nets.filter((n) => !doc.nets.has(n));
    if (unknown.length) notes.push(`not in the netlist: ${unknown.join(", ")}`);
    names = [...new Set(scope.nets)].filter((n) => open.has(n));
  } else {
    names = [...open.keys()];
    if (!scope.includePourNets) {
      const skipped = names.filter((n) => pours.has(n));
      if (skipped.length) notes.push(`left to their pours (a zone of the net exists): ${skipped.join(", ")}`);
      names = names.filter((n) => !pours.has(n));
    }
  }
  const region = scope.kind === "region" ? flattenContour(scope.region).points : undefined;
  const nets: NetToRoute[] = [];
  for (const net of names.sort(byCodeUnit)) {
    const islands = open.get(net)!;
    let anchors = islandAnchors(islands);
    if (region) {
      anchors = anchors.filter((a) => pointInPolygon(a, region));
      if (anchors.length < 2) continue;
    }
    nets.push({ net, islands: anchors, objects: islands.flatMap((i) => i.items.map((x) => x.id)).sort(byCodeUnit) });
  }
  return { nets, notes };
}

/** A route job for a router (its `unexpressed` list is filled by the orchestrator from the router). */
export function buildJob(doc: BoardDocument, request: JobRequest): Omit<RouteJob, "unexpressed"> & { notes: string[] } {
  const stack = copperLayers(doc);
  const layers: CopperLayer[] = request.scope.layers?.length ? stack.filter((l) => request.scope.layers!.includes(l)) : stack;
  const { nets, notes } = netsInScope(doc, request.scope);
  const constraints = resolveConstraints(doc, nets.map((n) => n.net), { tiers: request.tiers ?? "all", layers });
  const locked = [...new Set([...lockedIds(doc), ...(request.freeze ?? [])])].sort(byCodeUnit);
  const budget = { ...defaultBudget(), ...(request.budget ?? {}) };
  const seed = request.seed ?? 1;
  const region: Vertex[] | undefined = request.scope.kind === "region" ? request.scope.region : undefined;
  const runId = `run-${sha1Hex(canonical({ board: boardHash(doc), scope: request.scope, seed, tiers: constraints.tiers, freeze: request.freeze ?? [], options: request.options ?? {} })).slice(0, 12)}`;
  return { runId, doc, scope: request.scope, nets, layers, ...(region ? { region } : {}), constraints, locked, budget, seed, ...(request.options ? { options: request.options } : {}), notes };
}

/** A hash of a board's records and netlist (canonical JSON, sorted by id). */
export function boardHash(doc: BoardDocument): string {
  const ids = [...doc.records.keys()].sort(byCodeUnit);
  return sha1Hex(canonical({ records: ids.map((id) => doc.records.get(id)), netlist: doc.netlist ?? null }));
}
