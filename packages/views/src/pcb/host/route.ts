/**
 * Autorouting and routing diagnosis for a host (Node only), on `@protoboardai/board-route` (loaded when installed):
 * the default router order (tscircuit's autorouter first, Freerouting as the fallback), the scorer the product uses
 * (the board checks, with a computed zone fill when the board has zones), runs that can be cancelled, proposals held
 * by the host until a person accepts or rejects them, and the diagnosis of one open net (L4): the attempt, the probe
 * with only the fab floor and no-go areas, the rules that block it, and relaxations test-run on copies.
 *
 * Nothing here changes a board: accepting a proposal applies its transactions through the caller's `apply` (the
 * board service), each as its router, and checks afterwards that every locked record is byte-identical.
 */
import { byCodeUnit, canonicalRecord, createEngine, recordsOfKind, sha1Hex, type Actor, type BoardDocument, type BoardSnapshot, type OpCall, type Reply, type RuleRec, type Transaction } from "@protoboardai/board";
import type * as RouteModule from "@protoboardai/board-route";
import type * as FillModule from "@protoboardai/board-fill";
import type { DiagnosisArea, DiagnosisView, GhostCopper, PageRouteScope, PageScore, ProposalView, RelaxOption, RouteProgressView, RouterInfo } from "../types.js";
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
 * The autoroute runs of one board: each runs on a snapshot, sends its progress and its proposal to `emit`, and is
 * held until it is accepted, rejected or cancelled. One run at a time per board (a new run cancels the old one).
 */
export class RouteRuns {
  private readonly runs = new Map<string, Run>();
  private n = 0;
  constructor(private readonly emit: (m: RouteMessage) => void) {}

  get(run: string): { proposal?: ProposalView; ended?: string } | undefined {
    const r = this.runs.get(run);
    return r ? { ...(r.view ? { proposal: r.view } : {}), ...(r.ended ? { ended: r.ended } : {}) } : undefined;
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
        (p) => {
          run.proposal = p;
          run.view = proposalView(id, p, snapshot.doc, Date.now() - started);
          if (p.status === "cancelled") run.ended = "cancelled";
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
    const r = this.runs.get(run);
    if (!r?.view || r.ended) return false;
    r.ended = "rejected";
    this.emit({ run, ended: "rejected" });
    return true;
  }

  /**
   * Apply a held proposal step by step, each as its router (the person accepted it), and verify afterwards that
   * every locked record is byte-identical. Stops at the first refusal (a board that moved on is refused stale).
   */
  async accept(run: string, apply: (tx: Transaction, actor: Actor) => Promise<Reply>, before: BoardDocument, after: () => Promise<BoardDocument>): Promise<{ replies: Reply[]; locked: { checked: number; changed: string[] } }> {
    const r = this.runs.get(run);
    if (!r?.proposal || r.ended) throw new Error(`no open proposal ${run}`);
    if (r.proposal.status !== "proposed") throw new Error(`proposal ${run} is ${r.proposal.status}: a result worse than the board you have is never applied`);
    const ids = lockedRecords(before);
    const fp = new Map(ids.map((id) => [id, canonicalRecord(before.records.get(id)!)]));
    const replies: Reply[] = [];
    for (const s of r.proposal.steps) {
      const tx: Transaction = { ...s.transaction, label: `${s.transaction.label} (accepted)`.slice(0, 160) };
      const reply = await apply(tx, s.actor);
      replies.push(reply);
      if (reply.status !== "applied") break;
    }
    const doc = await after();
    const changed = ids.filter((id) => {
      const rec = doc.records.get(id);
      return !rec || canonicalRecord(rec) !== fp.get(id);
    });
    if (replies.length && replies.every((x) => x.status === "applied")) {
      r.ended = "accepted";
      this.emit({ run, ended: "accepted" });
    }
    return { replies, locked: { checked: ids.length, changed } };
  }

  /** Cancel everything (the board closes). */
  close(): void {
    for (const r of this.runs.values()) if (!r.ended) r.ctrl.abort(new Error("the board closed"));
    this.runs.clear();
  }
}

// ---------------------------------------------------------------- diagnosis (L4)

const mmText = (nm: number) => `${(nm / 1e6).toFixed(3).replace(/\.?0+$/, "")} mm`;

/** Apply a proposal's steps on a copy (each as its router); the copy after them, or undefined when one was refused. */
function applyOnCopy(doc: BoardDocument, steps: readonly { actor: Actor; transaction: Transaction }[]): BoardDocument | undefined {
  const engine = createEngine(doc, { epoch: "probe0", now: () => 0 });
  for (const s of steps) {
    const r = engine.apply({ ...s.transaction, expectEpoch: undefined, expectSeq: undefined } as Transaction, s.actor);
    if (r.status !== "applied") return undefined;
  }
  return engine.doc;
}

/** Apply rule changes on a copy as a person would. */
function withRules(doc: BoardDocument, rules: Record<string, unknown>[]): BoardDocument | undefined {
  const engine = createEngine(doc, { epoch: "relax0", now: () => 0 });
  const r = engine.apply({ batchId: "relax", label: "test-run a relaxation", ops: rules.map((rule) => ({ op: "rule.set", rule })) }, { kind: "human", id: "diagnosis" });
  return r.status === "applied" ? engine.doc : undefined;
}

/** A rule id key from free text (net names may hold characters an id key cannot). */
const ruleKey = (text: string) => `${text.replace(/[^A-Za-z0-9_.-]+/g, "_").slice(0, 40)}.${sha1Hex(text).slice(0, 6)}`;

export interface DiagnoseOptions {
  budgetMs?: number;
  routers?: Router[];
  scorer?: BoardScorer;
  signal?: AbortSignal;
}

/**
 * Why one net does not route (L4): the attempt with every rule, the probe with the fab floor and no-go areas only,
 * the verdict (`rules` when the probe routes within the floor clearance, else `placement`), what blocks it, the rule
 * areas by tier, and relaxations test-run on copies of the board. Nothing is applied.
 */
export async function diagnoseNet(snapshot: BoardSnapshot, net: string, options: DiagnoseOptions = {}): Promise<DiagnosisView> {
  const t0 = Date.now();
  const route = await loadRouteModule();
  if (!route) throw new Error("the autorouter is not installed (package @protoboardai/board-route)");
  const doc = snapshot.doc;
  if (!doc.nets.has(net)) throw new Error(`net ${net} is not in this board's netlist`);
  const scorer = options.scorer ?? (await productScorer())?.scorer;
  if (!scorer) throw new Error("no scorer");
  const routers = options.routers ?? route.defaultRouters();
  const budget = { timeMs: options.budgetMs ?? 30_000 };
  const scope = { kind: "nets" as const, nets: [net] };
  const base = { routers, scorer, budget, diagnose: false, ...(options.signal ? { signal: options.signal } : {}) };

  // 1. the attempt with every rule
  const ta = Date.now();
  const attempt = await route.routeBoard(doc, { ...base, scope });
  const attemptMs = Date.now() - ta;
  const routesAsIs = attempt.status === "proposed" && !attempt.openNets.includes(net);
  const attempts: DiagnosisView["attempts"] = attempt.stages.map((s) => ({ router: s.router, status: s.status, ...(s.reason ? { reason: s.reason } : {}), ghost: s.kept ? ghostOf(attempt.steps.filter((st) => st.actor.id === `router:${s.router}`).map((st) => st.transaction)) : { segments: [], vias: [] }, ms: s.durationMs }));
  if (!attempts.length) attempts.push({ router: "none", status: attempt.status, reason: attempt.reasons.join("; "), ghost: { segments: [], vias: [] }, ms: attemptMs });

  const normal = route.resolveConstraints(doc, [net], {});
  const relaxed = route.resolveConstraints(doc, [net], { tiers: "floor-and-no-go" });
  const n = route.netConstraint(normal, net);
  const f = route.netConstraint(relaxed, net);

  // 2. the probe: the fab floor and no-go areas only
  let probe: DiagnosisView["probe"];
  if (!routesAsIs) {
    const tp = Date.now();
    const p = await route.routeBoard(doc, { ...base, scope, tiers: "floor-and-no-go" });
    const after = p.steps.length ? applyOnCopy(doc, p.steps) : undefined;
    let floorViolations = 0;
    if (after) {
      const added = new Set<string>();
      for (const r of after.records.values()) if (!doc.records.has(r.id) && (r.kind === "track" || r.kind === "via")) added.add(r.id);
      for (const pr of route.clearancePairs(route.copperModel(after), relaxed.defaults.clearance.floor)) if (added.has(pr.a) || added.has(pr.b)) floorViolations++;
    }
    const routed = !!after && !route.netsInScope(after, scope).nets.length;
    const g = ghostOf(p.steps.map((s) => s.transaction));
    probe = { router: p.stages.filter((s) => s.kept).at(-1)?.router ?? p.stages[0]?.router ?? "none", routed, ghost: g, length: p.added.length, vias: p.added.vias, floorViolations, ms: Date.now() - tp };
  }
  const verdict: DiagnosisView["verdict"] = routesAsIs ? "routes" : probe?.routed && probe.floorViolations === 0 ? "rules" : "placement";

  // 3. what blocks it
  const rules = recordsOfKind(doc, "rule");
  const ruleName = (id: string | undefined) => (id ? (doc.records.get(id) as RuleRec | undefined)?.note ?? id : "built-in default");
  const blockers: DiagnosisView["blockers"] = [];
  if (n.clearance.plan > f.clearance.floor) blockers.push({ rule: n.sources.clearance ?? "default plan", tier: "target", what: `clearance plan ${mmText(n.clearance.plan)} (${ruleName(n.sources.clearance)})`, blocks: `above the floor ${mmText(f.clearance.floor)}` });
  if (n.width.plan > f.width.floor) blockers.push({ rule: n.sources.width ?? "default plan", tier: "target", what: `track width plan ${mmText(n.width.plan)} (${ruleName(n.sources.width)})`, blocks: `above the floor ${mmText(f.width.floor)}` });
  for (const k of recordsOfKind(doc, "keepout")) {
    const what = Object.entries(k.blocks)
      .filter(([, v]) => v)
      .map(([b]) => b)
      .join(", ");
    blockers.push({ rule: k.id, tier: k.tier, what: k.name ?? k.description ?? k.id, blocks: k.tier === "no_go" ? `a wall for ${what || "nothing"} on ${k.layers.join(", ")}` : `a cost for ${what || "nothing"}` });
  }
  for (const r of rules.filter((x) => x.enabled !== false && x.tier === "policy" && x.applies.region)) blockers.push({ rule: r.id, tier: "policy", what: r.note ?? r.id, blocks: `a cost (${r.cost ?? 1}) in its region` });
  blockers.push({ rule: "fab floor", tier: "floor", what: `clearance ${mmText(f.clearance.floor)}, width ${mmText(f.width.floor)}`, blocks: "never relaxed" });

  // 4. rule areas by tier
  const areas: DiagnosisArea[] = [];
  for (const k of recordsOfKind(doc, "keepout")) areas.push({ id: k.id, name: k.name ?? k.id, tier: k.tier, outline: k.outline.map((v) => ({ x: v.x, y: v.y })), blocks: Object.entries(k.blocks).filter(([, v]) => v).map(([b]) => b).join(", ") });
  for (const r of rules) if (r.enabled !== false && r.applies.region && r.severity !== "ignore") areas.push({ id: r.id, name: r.note ?? r.id, tier: r.tier, outline: r.applies.region.map((v) => ({ x: v.x, y: v.y })), blocks: r.check });

  // 5. relaxations, test-run on copies (only the target tier: the floor is never relaxed)
  const options_: RelaxOption[] = [];
  if (!routesAsIs) {
    const prio = Math.min(1_000_000, Math.max(0, ...rules.filter((r) => r.tier === "target").map((r) => r.priority ?? 0)) + 1);
    const key = ruleKey(net);
    const cands: { id: string; title: string; detail: string; rules: Record<string, unknown>[] }[] = [];
    const clr = n.clearance.plan > f.clearance.floor ? { id: `rule:relax.${key}.clearance`, tier: "target", check: "clearance", priority: prio, applies: { nets: [net] }, min: f.clearance.floor, preferred: f.clearance.floor, note: `${net} may route at the floor clearance (routing diagnosis)`.slice(0, 500) } : undefined;
    const wid = n.width.plan > f.width.floor ? { id: `rule:relax.${key}.width`, tier: "target", check: "track_width", priority: prio, applies: { nets: [net] }, min: f.width.floor, preferred: f.width.floor, note: `${net} may route at the floor width (routing diagnosis)`.slice(0, 500) } : undefined;
    if (clr) cands.push({ id: "clearance", title: `Plan ${net} at the floor clearance`, detail: `a target rule for this net only: ${mmText(n.clearance.plan)} to ${mmText(f.clearance.floor)}`, rules: [clr] });
    if (wid) cands.push({ id: "width", title: `Plan ${net} at the floor width`, detail: `a target rule for this net only: ${mmText(n.width.plan)} to ${mmText(f.width.floor)}`, rules: [wid] });
    if (clr && wid) cands.push({ id: "both", title: `Plan ${net} at the floor clearance and width`, detail: "both target rules, this net only", rules: [clr, wid] });
    for (const c of cands) {
      const t = Date.now();
      const copy = withRules(doc, c.rules);
      if (!copy) {
        options_.push({ ...c, result: { routed: false, open: 0, errors: 0, vias: 0, length: 0, newFindings: 0, ms: Date.now() - t, note: "the rule was refused on a copy" } });
        continue;
      }
      const p = await route.routeBoard(copy, { ...base, scope });
      const routed = p.status === "proposed" && !p.openNets.includes(net);
      options_.push({ ...c, result: { routed, open: p.candidate.open, errors: p.candidate.errors, vias: p.added.vias, length: p.added.length, newFindings: Math.max(0, p.candidate.errors - p.current.errors), ms: Date.now() - t, ...(p.status !== "proposed" ? { note: p.reasons.join("; ").slice(0, 300) } : {}) } });
    }
  }

  const summary =
    verdict === "routes"
      ? `${net} routes with every rule as it is: run the autorouter on it`
      : verdict === "rules"
        ? `Rules, not placement: with only the fab floor and no-go areas, ${net} routed (${mmText(probe!.length)}, ${probe!.vias} via${probe!.vias === 1 ? "" : "s"}); a rule above the floor blocks it`
        : probe?.routed
          ? `Placement: the probe routed ${net} only by breaking the floor clearance (${probe.floorViolations} pair${probe.floorViolations === 1 ? "" : "s"}); move parts or a no-go area`
          : `Placement: even with only the fab floor and no-go areas, ${net} did not route; the parts or a no-go area block it`;
  return { net, seq: snapshot.seq, verdict, summary, attempts, ...(probe ? { probe } : {}), blockers, areas, options: options_, ms: Date.now() - t0 };
}
