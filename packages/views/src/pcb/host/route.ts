/**
 * Autorouting and routing diagnosis for a host (Node only), on `@protoboardai/board-route` (loaded when installed):
 * the default router order (tscircuit's autorouter first, Freerouting as the fallback), the scorer the product uses
 * (the board checks, with a computed zone fill when the board has zones), runs that can be cancelled, results handed
 * to the board service as proposals; the diagnosis of one open net (L4) lives in ./diagnose.ts (re-exported here).
 *
 * Nothing here changes a board: a run's result becomes service proposals (the feed proposes it), a person accepts
 * them through the service, and the feed checks afterwards that every locked record is byte-identical
 * (`lockFingerprint`).
 */
import { byCodeUnit, canonicalRecord, type BoardDocument, type BoardRecord, type BoardSnapshot, type OpCall } from "@protoboardai/board";
import type * as RouteModule from "@protoboardai/board-route";
import type * as FillModule from "@protoboardai/board-fill";
import type { GhostCopper, PageRouteScope, PageScore, ProposalView, RouteProgressView, RouterInfo } from "../types.js";
import { loadChecksModule } from "./analysis.js";

type RouteProposal = RouteModule.RouteProposal;
type BoardScorer = RouteModule.BoardScorer;
type Router = RouteModule.Router;

let routeModule: Promise<typeof RouteModule | undefined> | undefined;
/** The router package, when it is installed. */
export function loadRouteModule(): Promise<typeof RouteModule | undefined> {
  routeModule ??= import("@protoboardai/board-route").then(
    (m) => m as typeof RouteModule,
    () => undefined,
  );
  return routeModule;
}

let fillModule: Promise<typeof FillModule | undefined> | undefined;
/** The zone fill engine, when it is installed. */
export function loadFillModule(): Promise<typeof FillModule | undefined> {
  fillModule ??= import("@protoboardai/board-fill").then(
    (m) => m as typeof FillModule,
    () => undefined,
  );
  return fillModule;
}

const hasZones = (doc: BoardDocument) => {
  for (const r of doc.records.values()) if (r.kind === "zone") return true;
  return false;
};

/**
 * The scorer the product injects: the board checks (open connections and error findings), with the zone fill
 * computed for each candidate when the board has zones; the router package's basic scorer when the checks are not
 * installed (`name` says which).
 */
export async function productScorer(): Promise<{ name: string; scorer: BoardScorer } | undefined> {
  const route = await loadRouteModule();
  if (!route) return undefined;
  const checks = await loadChecksModule();
  const fill = await loadFillModule();
  if (!checks) return { name: "basic (the board checks are not installed)", scorer: route.basicScorer() };
  return {
    name: "board checks",
    scorer: (doc) => {
      const fills = fill && hasZones(doc) ? fill.fillZones(doc).fill : undefined;
      const r = checks.runBoardChecks(doc, fills ? { fills } : {});
      const openNets = [...new Set(r.connectivity.links.map((l) => l.net))].sort(byCodeUnit);
      const errorIds = r.findings.filter((f) => f.severity === "error" && f.check !== "unconnected").map((f) => f.id);
      return { open: r.summary.unconnected, errors: r.summary.errors, openNets, errorIds };
    },
  };
}

/** The routers in the product's order: tscircuit first, Freerouting as the fallback. */
export async function defaultRouterList(): Promise<Router[]> {
  const route = await loadRouteModule();
  return route ? route.defaultRouters() : [];
}

export async function routerInfo(routers?: Router[]): Promise<RouterInfo[]> {
  const list = routers ?? (await defaultRouterList());
  return list.map((r) => {
    const a = r.available();
    let version = "";
    try {
      version = r.version();
    } catch {
      version = "?";
    }
    return { id: r.id, title: r.title, version, available: a.ok, ...(a.ok ? {} : { reason: a.reason }) };
  });
}

/** The copper the transactions of a proposal add, for the ghost. */
export function ghostOf(txs: readonly { ops: readonly OpCall[] }[]): GhostCopper {
  const g: GhostCopper = { segments: [], vias: [] };
  for (const t of txs)
    for (const op of t.ops) {
      if (op.op === "track.add")
        for (const s of (op.segments ?? []) as { net?: string; layer: string; width: number; start: { x: number; y: number }; end: { x: number; y: number } }[]) g.segments.push({ ...(s.net ? { net: s.net } : {}), layer: s.layer, width: s.width, start: { x: s.start.x, y: s.start.y }, end: { x: s.end.x, y: s.end.y } });
      if (op.op === "via.add") for (const v of (op.vias ?? []) as { net?: string; x: number; y: number; outer_diameter: number }[]) g.vias.push({ ...(v.net ? { net: v.net } : {}), x: v.x, y: v.y, outer_diameter: v.outer_diameter });
    }
  return g;
}

const score = (s: RouteModule.BoardScore): PageScore => ({ open: s.open, errors: s.errors, vias: s.vias, length: s.length, openNets: [...s.openNets] });

/** Locked records of a board (what a router must leave byte-identical). */
export function lockedRecords(doc: BoardDocument): string[] {
  const out: string[] = [];
  for (const r of doc.records.values()) if ((r as { locked?: true }).locked) out.push(r.id);
  return out.sort(byCodeUnit);
}

/** Whether a track is hand copper (drawn or last edited by a person). */
const isHandTrack = (r: BoardRecord) => r.kind === "track" && (r.provenance.by === "hand" || r.provenance.edited === "hand");

/**
 * The fingerprint of every locked record before a change, and a check afterwards that each is byte-identical:
 * how many were checked, which changed, and how many of them are hand tracks (the "N hand tracks verified
 * unchanged" line after a router's proposal is accepted).
 */
export function lockFingerprint(before: BoardDocument): (after: BoardDocument) => { checked: number; changed: string[]; hand: number } {
  const ids = lockedRecords(before);
  const fp = new Map(ids.map((id) => [id, canonicalRecord(before.records.get(id)!)]));
  const hand = ids.filter((id) => isHandTrack(before.records.get(id)!)).length;
  return (after) => {
    const changed = ids.filter((id) => {
      const rec = after.records.get(id);
      return !rec || canonicalRecord(rec) !== fp.get(id);
    });
    return { checked: ids.length, changed, hand: hand - changed.filter((id) => isHandTrack(before.records.get(id)!)).length };
  };
}

/** A proposal in the page's form. */
export function proposalView(run: string, p: RouteProposal, doc: BoardDocument, ms: number): ProposalView {
  return {
    run,
    changeSet: p.runId,
    status: p.status,
    reasons: [...p.reasons],
    base: { ...p.base },
    current: score(p.current),
    candidate: score(p.candidate),
    nets: [...p.nets],
    openNets: [...p.openNets],
    stages: p.stages.map((s) => ({ router: s.router, version: s.version, status: s.status, kept: s.kept, ...(s.reason ? { reason: s.reason } : {}), durationMs: s.durationMs, added: { ...s.added } })),
    ...(p.fallback ? { fallback: { from: p.fallback.from, to: [...p.fallback.to], reasons: [...p.fallback.reasons] } } : {}),
    added: { ...p.added },
    lockCheck: { ok: p.lockCheck.ok, changed: [...p.lockCheck.changed], checked: lockedRecords(doc).length },
    ghost: ghostOf(p.steps.map((s) => s.transaction)),
    unexpressed: [...p.unexpressed],
    notes: [...p.notes],
    ms,
  };
}

/** A page's scope in the router's terms. */
export function routeScope(s: PageRouteScope): RouteModule.RouteScope {
  if (s.kind === "nets") return { kind: "nets", nets: [...s.nets] };
  if (s.kind === "region") return { kind: "region", region: s.region.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) })) };
  return { kind: "open" };
}

export interface RunOptions {
  scope: PageRouteScope;
  /** Wall clock per router run (DEFAULT 60 s). */
  budgetMs?: number;
  routers?: Router[];
  scorer?: BoardScorer;
}

interface Run {
  id: string;
  ctrl: AbortController;
  started: number;
  done: Promise<void>;
  proposal?: RouteProposal;
  view?: ProposalView;
  ended?: "accepted" | "rejected" | "cancelled";
}

export type RouteMessage = { run: string; progress?: RouteProgressView; proposal?: ProposalView; error?: string; ended?: "accepted" | "rejected" | "cancelled" };

/**
 * Turn a run's result into board service proposals (`proposeRouteResult`, contract section 4): the ids of the
 * proposals made, or why none was.
 */
export type ProposeRun = (result: RouteProposal) => Promise<{ ids: string[]; error?: string }>;

/**
 * The autoroute runs of one board: each runs on a snapshot and sends its progress and its result to `emit`. A
 * result better than the board becomes board service proposals through `propose` (one per router step, one item
 * per net); the service holds them, and accepting or rejecting goes through it, never through the run. One run at a
 * time per board (a new run cancels the old one).
 */
export class RouteRuns {
  private readonly runs = new Map<string, Run>();
  private n = 0;
  constructor(
    private readonly emit: (m: RouteMessage) => void,
    private readonly propose?: ProposeRun,
  ) {}

  get(run: string): { proposal?: ProposalView; ended?: string } | undefined {
    const r = this.runs.get(run);
    return r ? { ...(r.view ? { proposal: r.view } : {}), ...(r.ended ? { ended: r.ended } : {}) } : undefined;
  }

  /** The run that became a service proposal, by the proposal's id. */
  runOf(proposal: string): string | undefined {
    for (const r of this.runs.values()) if (r.view?.proposals?.includes(proposal)) return r.id;
    return undefined;
  }

  /** Mark a run accepted or rejected (its proposals were, through the service). */
  end(run: string, how: "accepted" | "rejected"): boolean {
    const r = this.runs.get(run);
    if (!r?.view || r.ended) return false;
    r.ended = how;
    this.emit({ run, ended: how });
    return true;
  }

  /** Start a run; resolves with its id at once (the proposal comes through `emit`). */
  async start(snapshot: BoardSnapshot, options: RunOptions): Promise<string> {
    const route = await loadRouteModule();
    if (!route) throw new Error("the autorouter is not installed (package @protoboardai/board-route)");
    const scorer = options.scorer ?? (await productScorer())?.scorer;
    if (!scorer) throw new Error("no scorer: the board checks and the router package are both missing");
    const routers = options.routers ?? route.defaultRouters();
    for (const r of this.runs.values()) if (!r.view && !r.ended) this.cancel(r.id);
    const id = `route-${++this.n}-${Date.now().toString(36)}`;
    const ctrl = new AbortController();
    const started = Date.now();
    const run: Run = { id, ctrl, started, done: Promise.resolve() };
    this.runs.set(id, run);
    const stageRouter: string[] = [];
    run.done = route
      .routeBoard(snapshot, {
        scope: routeScope(options.scope),
        routers,
        scorer,
        signal: ctrl.signal,
        budget: { timeMs: options.budgetMs ?? 60_000 },
        diagnose: false,
        onEvent: (e) => {
          if (e.type === "stage-start") {
            stageRouter[e.stage] = e.router;
            this.emit({ run: id, progress: { run: id, stage: e.stage, router: e.router, phase: "starting", elapsedMs: Date.now() - started, message: `${e.nets.length} net(s)` } });
          } else if (e.type === "progress") this.emit({ run: id, progress: { run: id, stage: e.stage, router: e.progress.router, phase: e.progress.phase, ...(e.progress.fraction !== undefined ? { fraction: e.progress.fraction } : {}), elapsedMs: Date.now() - started, ...(e.progress.message ? { message: e.progress.message } : {}) } });
          else if (e.type === "stage-end") this.emit({ run: id, progress: { run: id, stage: e.stage, router: e.router, phase: `${e.status}${e.kept ? ", kept" : ""}`, elapsedMs: Date.now() - started, ...(e.reason ? { message: e.reason } : {}) } });
          else if (e.type === "fallback") this.emit({ run: id, progress: { run: id, stage: stageRouter.length, router: e.to, phase: "fallback", elapsedMs: Date.now() - started, message: e.reason, fallback: { from: e.from, to: e.to, reason: e.reason } } });
        },
      })
      .then(
        async (p) => {
          run.proposal = p;
          const view = proposalView(id, p, snapshot.doc, Date.now() - started);
          if (p.status === "cancelled") run.ended = "cancelled";
          if (p.status === "proposed" && !run.ended && this.propose) {
            try {
              const made = await this.propose(p);
              view.proposals = made.ids;
              if (made.error) view.proposalError = made.error;
            } catch (e) {
              view.proposalError = (e as Error).message;
            }
          }
          run.view = view;
          this.emit({ run: id, proposal: run.view, ...(run.ended ? { ended: run.ended } : {}) });
        },
        (e: Error) => {
          run.ended = "cancelled";
          this.emit({ run: id, error: e.message, ended: "cancelled" });
        },
      );
    return id;
  }

  cancel(run: string): boolean {
    const r = this.runs.get(run);
    if (!r || r.ended) return false;
    r.ctrl.abort(new Error("cancelled by the person"));
    if (r.view) {
      r.ended = "cancelled";
      this.emit({ run, ended: "cancelled" });
    }
    return true;
  }

  reject(run: string): boolean {
    return this.end(run, "rejected");
  }

  /** Cancel everything (the board closes). */
  close(): void {
    for (const r of this.runs.values()) if (!r.ended) r.ctrl.abort(new Error("the board closed"));
    this.runs.clear();
  }
}

// ---------------------------------------------------------------- diagnosis (L4): host/diagnose.ts

export { diagnoseNet, diagnosisHash, diagnosisCacheDir, clearDiagnosisMemory, DEFAULT_DIAGNOSIS_BUDGET_MS, type DiagnoseOptions } from "./diagnose.js";
