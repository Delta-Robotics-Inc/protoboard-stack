/**
 * The orchestrator: runs routers on a copy of a board snapshot, verifies that locked copper came back unchanged,
 * scores each candidate with the injected checks (open connections, then errors, then vias, then length), compares
 * it with the current board and returns a proposal with both scores. A proposal worse than the current board on
 * open connections or errors is always marked rejected, with the reasons. It never changes the board: the caller
 * applies the proposal's transactions (`applyProposal`) after a person or agent accepts it.
 *
 * Fallback: when a router leaves nets open, times out, errors or is unavailable, the next router runs on the nets
 * still open, on top of what the earlier one completed when that scored better. When nets stay open, the
 * rules-or-placement diagnostic reruns them with the floor and no-go tiers only, on a copy, and reports which rules,
 * if relaxed, let each net route.
 */
import {
  byCodeUnit,
  canonical,
  canonicalRecord,
  createEngine,
  sha1Hex,
  type Actor,
  type BoardDocument,
  type BoardService,
  type BoardSnapshot,
  type Reply,
  type Transaction,
} from "@protoboardai/board";
import { commonUnexpressed, netConstraint, resolveConstraints } from "./constraints.js";
import { clearancePairs, copperModel, copperTotals } from "./connectivity.js";
import { flattenContour, pointInPolygon, segPolygonDist, type P } from "./geom.js";
import { boardHash, buildJob, netsInScope, type JobRequest } from "./job.js";
import { opsTotals, routerTransaction } from "./ops.js";
import { ROUTER_ACTOR, type BoardScore, type BoardScorer, type ResolvedConstraints, type RouteJob, type RouteProgress, type RouteResult, type RouteScope, type Router } from "./types.js";

// ---------------------------------------------------------------- scores

/** Lexicographic: open connections, then errors, then vias, then length. Negative when `a` is better. */
export function compareScores(a: BoardScore, b: BoardScore): number {
  return a.open - b.open || a.errors - b.errors || a.vias - b.vias || a.length - b.length;
}

/** Why `candidate` is worse than `current` on open connections or errors (empty when it is not). */
export function worseThan(candidate: BoardScore, current: BoardScore): string[] {
  const out: string[] = [];
  if (candidate.open > current.open) out.push(`open connections rise from ${current.open} to ${candidate.open}`);
  if (candidate.errors > current.errors) out.push(`errors rise from ${current.errors} to ${candidate.errors}`);
  return out;
}

export async function scoreBoard(doc: BoardDocument, scorer: BoardScorer): Promise<BoardScore> {
  const r = await scorer(doc);
  const t = copperTotals(doc);
  return { open: r.open, errors: r.errors, vias: t.vias, length: t.length, openNets: [...(r.openNets ?? [])].sort(byCodeUnit) };
}

// ---------------------------------------------------------------- locks

/** Each locked record's canonical text (or absent), for a byte-for-byte comparison after a router run. */
export function lockedFingerprint(doc: BoardDocument, ids: readonly string[]): Map<string, string | undefined> {
  const out = new Map<string, string | undefined>();
  for (const id of ids) {
    const r = doc.records.get(id);
    out.set(id, r ? canonicalRecord(r) : undefined);
  }
  return out;
}

/** The locked ids whose records differ (changed, removed or added) between two fingerprints. */
export function lockedChanges(before: Map<string, string | undefined>, after: BoardDocument): string[] {
  const changed: string[] = [];
  for (const [id, text] of before) {
    const r = after.records.get(id);
    if ((r ? canonicalRecord(r) : undefined) !== text) changed.push(id);
  }
  return changed.sort(byCodeUnit);
}

// ---------------------------------------------------------------- proposal

export type RouteEvent =
  | { type: "stage-start"; stage: number; router: string; nets: string[] }
  | { type: "progress"; stage: number; progress: RouteProgress }
  | { type: "stage-end"; stage: number; router: string; status: RouteResult["status"] | "skipped"; kept: boolean; reason?: string }
  | { type: "fallback"; from: string; to: string; reason: string; nets: string[] }
  | { type: "diagnostic"; nets: number }
  | { type: "done"; status: RouteProposal["status"] };

export interface StageReport {
  stage: number;
  router: string;
  version: string;
  status: RouteResult["status"] | "skipped";
  /** Whether its copper is part of the proposal. */
  kept: boolean;
  /** Why it was skipped or not kept. */
  reason?: string;
  nets: string[];
  durationMs: number;
  added: { segments: number; vias: number; length: number };
  score?: BoardScore;
  unexpressed: string[];
  messages: string[];
  routerReportedOpen?: number;
  extra?: Record<string, number | string>;
}

export interface ProposalStep {
  actor: Actor;
  transaction: Transaction;
}

export interface DiagnosticNet {
  net: string;
  /** `rules`: it routes with the floor and no-go tiers only; `placement`: it does not (placement or a no-go area blocks it). */
  verdict: "rules" | "placement";
  /** The target rules and defaults that, relaxed to the floor, let it route. */
  relaxed: string[];
  /** Policy areas (costs) the relaxed route crosses. */
  crossedPolicies: string[];
  /** Pairs of the relaxed route's copper and other nets' copper closer than the floor clearance (a route that breaks the floor is not a route). */
  floorViolations: number;
}

export interface DiagnosticReport {
  router: string;
  tiers: "floor-and-no-go";
  durationMs: number;
  nets: DiagnosticNet[];
  status: RouteResult["status"];
  messages: string[];
}

export interface RouteProposal {
  runId: string;
  status: "proposed" | "rejected" | "unchanged" | "failed" | "cancelled";
  reasons: string[];
  base: { epoch?: string; seq?: number; board: string };
  current: BoardScore;
  candidate: BoardScore;
  scope: RouteScope;
  /** Nets the job asked to route. */
  nets: string[];
  /** Nets of the scope still open on the candidate (from this package's islands). */
  openNets: string[];
  stages: StageReport[];
  fallback?: { from: string; to: string[]; reasons: string[] };
  /** The transactions to apply, in order, each as its router actor. Empty unless status is proposed or rejected. */
  steps: ProposalStep[];
  added: { segments: number; vias: number; length: number };
  lockCheck: { ok: boolean; changed: string[] };
  unexpressed: string[];
  notes: string[];
  diagnostic?: DiagnosticReport;
  /** What the deadline cut (a router skipped or stopped), when `deadline` was given and cut something. */
  stopped?: string[];
}

export interface RouteRequest extends JobRequest {
  /** Routers in order: the first is primary, the rest are fallbacks. */
  routers: Router[];
  /** The injected checks. */
  scorer: BoardScorer;
  signal?: AbortSignal;
  onEvent?: (e: RouteEvent) => void;
  /** Run the rules-or-placement diagnostic when nets stay open (default true). */
  diagnose?: boolean;
  /**
   * One deadline for the whole run (`Date.now()` milliseconds): each router gets at most the time left (and its
   * `budget.timeMs`), is stopped at the deadline (its result is a timeout, not a cancellation), and a router that
   * would start with less than a second (or its `startupMs`) left is skipped. The proposal's `stopped` says what the
   * deadline cut.
   */
  deadline?: number;
}

/** The least time left for a router to start under a deadline (ms). */
const MIN_STAGE_MS = 1000;
/** How long after the deadline a router is stopped (it stops itself at its budget; this is the backstop). */
const DEADLINE_GRACE_MS = 750;

/** Six base-36 characters from a text (a deterministic epoch for the copy the routers' operations are applied to). */
function epochFrom(text: string): string {
  const h = sha1Hex(text);
  let out = "";
  for (let i = 0; i < 6; i++) out += (parseInt(h.slice(i * 2, i * 2 + 2), 16) % 36).toString(36);
  return out;
}

/** A signal that aborts when the parent does or after `ms` (for a stuck router, or at a run's deadline). */
function stageSignal(parent: AbortSignal | undefined, ms: number): { signal: AbortSignal; done: () => void; timedOut: () => boolean } {
  const c = new AbortController();
  let timed = false;
  const t = setTimeout(() => {
    timed = true;
    c.abort(new Error("time budget exceeded"));
  }, Math.max(0, ms));
  const onAbort = () => c.abort(parent?.reason);
  parent?.addEventListener("abort", onAbort, { once: true });
  if (parent?.aborted) c.abort(parent.reason);
  return { signal: c.signal, done: () => (clearTimeout(t), parent?.removeEventListener("abort", onAbort)), timedOut: () => timed };
}

interface Applied {
  doc?: BoardDocument;
  reply: Reply;
  lockChanged: string[];
}

/** Apply a router's operations to a copy of `base` as that router, and compare the locked records. */
function applyOnCopy(base: BoardDocument, result: RouteResult, router: Router, job: RouteJob, stage: number): Applied {
  const engine = createEngine(base, { epoch: epochFrom(`${job.runId}:${stage}`), now: () => 0 });
  const before = lockedFingerprint(base, job.locked);
  const tx: Transaction = routerTransaction(`${job.runId}.${stage}.${router.id}`, `route ${job.nets.length} nets with ${router.id}`, result.ops, result.provenance);
  const reply = engine.apply(tx, ROUTER_ACTOR(router));
  if (reply.status !== "applied") return { reply, lockChanged: [] };
  return { doc: engine.doc, reply, lockChanged: lockedChanges(before, engine.doc) };
}

/** Route a board: run the routers in order with fallback, verify, score, and return a proposal. Never changes the board. */
export async function routeBoard(input: BoardSnapshot | BoardDocument, request: RouteRequest): Promise<RouteProposal> {
  const snapshot = "doc" in input && "seq" in input ? (input as BoardSnapshot) : undefined;
  const doc = snapshot ? snapshot.doc : (input as BoardDocument);
  const emit = (e: RouteEvent) => {
    try {
      request.onEvent?.(e);
    } catch {
      // a listener's failure never stops a run
    }
  };
  const board = boardHash(doc);
  const current = await scoreBoard(doc, request.scorer);
  const first = buildJob(doc, request);
  const runId = `run-${sha1Hex(canonical({ job: first.runId, routers: request.routers.map((r) => `${r.id}@${r.version()}`) })).slice(0, 12)}`;
  const scopeNets = first.nets.map((n) => n.net);
  const proposal: RouteProposal = {
    runId,
    status: "unchanged",
    reasons: [],
    base: { ...(snapshot ? { epoch: snapshot.epoch, seq: snapshot.seq } : {}), board },
    current,
    candidate: current,
    scope: request.scope,
    nets: scopeNets,
    openNets: scopeNets,
    stages: [],
    steps: [],
    added: { segments: 0, vias: 0, length: 0 },
    lockCheck: { ok: true, changed: [] },
    unexpressed: [],
    notes: [...first.notes],
  };
  if (!scopeNets.length) {
    proposal.reasons.push("nothing in scope is open");
    proposal.openNets = [];
    emit({ type: "done", status: proposal.status });
    return proposal;
  }
  if (!request.routers.length) throw new Error("routeBoard needs at least one router");

  let base = doc;
  let baseScore = current;
  let remaining = scopeNets;
  let bestRejected: { score: BoardScore; steps: ProposalStep[]; added: { segments: number; vias: number; length: number } } | undefined;
  const fallbackReasons: string[] = [];
  const unexpressed = new Set<string>();
  const stopped: string[] = [];
  let cancelled = false;

  for (let i = 0; i < request.routers.length && remaining.length; i++) {
    const router = request.routers[i];
    const stage = i;
    const report: StageReport = { stage, router: router.id, version: router.version(), status: "skipped", kept: false, nets: remaining, durationMs: 0, added: { segments: 0, vias: 0, length: 0 }, unexpressed: [], messages: [] };
    proposal.stages.push(report);
    const nextReason = (why: string) => {
      const next = request.routers[i + 1];
      if (next) {
        fallbackReasons.push(`${router.id}: ${why}`);
        emit({ type: "fallback", from: router.id, to: next.id, reason: why, nets: remaining });
      }
    };
    const avail = router.available();
    if (!avail.ok) {
      report.reason = `unavailable: ${avail.reason}`;
      emit({ type: "stage-end", stage, router: router.id, status: "skipped", kept: false, reason: report.reason });
      nextReason(report.reason);
      continue;
    }
    // a fallback routes what is still open: the same region (its islands inside it) or the remaining nets
    const scope: RouteScope = i === 0 || request.scope.kind === "region" ? request.scope : { kind: "nets", nets: remaining, ...(request.scope.layers ? { layers: request.scope.layers } : {}) };
    const built = buildJob(base, { ...request, scope });
    if (i > 0) built.nets = built.nets.filter((n) => remaining.includes(n.net));
    const job: RouteJob = { ...built, runId, ...(first.region ? { region: first.region } : {}), unexpressed: [] };
    delete (job as { notes?: string[] }).notes;
    if (job.layers.length < router.capabilities.layers.min || job.layers.length > router.capabilities.layers.max) {
      report.reason = `cannot route ${job.layers.length} copper layers (it takes ${router.capabilities.layers.min} to ${router.capabilities.layers.max})`;
      emit({ type: "stage-end", stage, router: router.id, status: "skipped", kept: false, reason: report.reason });
      nextReason(report.reason);
      continue;
    }
    if (request.deadline !== undefined) {
      const left = request.deadline - Date.now();
      if (left < Math.max(MIN_STAGE_MS, router.capabilities.startupMs ?? 0)) {
        report.reason = `the time budget ran out (${Math.max(0, Math.round(left))} ms left)`;
        stopped.push(`${router.id}: not started, ${report.reason}`);
        emit({ type: "stage-end", stage, router: router.id, status: "skipped", kept: false, reason: report.reason });
        nextReason(report.reason);
        continue;
      }
      job.budget = { ...job.budget, timeMs: Math.min(job.budget.timeMs, left) };
    }
    job.unexpressed = [...new Set([...commonUnexpressed(job.constraints), ...router.express(job)])];
    if (job.region && !router.capabilities.region) job.unexpressed.push("region: this router cannot bound new copper to the region; copper outside it is checked after");
    report.nets = job.nets.map((n) => n.net);
    emit({ type: "stage-start", stage, router: router.id, nets: report.nets });
    const s = stageSignal(request.signal, request.deadline !== undefined ? Math.min(job.budget.timeMs + 30_000, request.deadline - Date.now() + DEADLINE_GRACE_MS) : job.budget.timeMs + 30_000);
    let result: RouteResult;
    const t0 = Date.now();
    try {
      result = await router.route(job, s.signal, (p) => emit({ type: "progress", stage, progress: p }));
    } catch (e) {
      result = { status: s.timedOut() ? "timeout" : request.signal?.aborted ? "cancelled" : "failed", ops: [], provenance: { by: "routed", tool: router.id, run: runId }, stats: { durationMs: Date.now() - t0, segments: 0, vias: 0, length: 0 }, unexpressed: job.unexpressed, messages: [`${router.id} failed: ${e instanceof Error ? e.message : String(e)}`], version: router.version() };
    } finally {
      s.done();
    }
    // stopped at its time (the budget backstop or the deadline), not by the caller: a timeout, not a cancellation
    if (result.status === "cancelled" && s.timedOut() && !request.signal?.aborted) result = { ...result, status: "timeout", messages: [...result.messages, "stopped at the time budget"] };
    if (request.deadline !== undefined && result.status === "timeout") stopped.push(`${router.id}: stopped at the time budget after ${result.stats.durationMs} ms`);
    report.status = result.status;
    report.version = result.version;
    report.durationMs = result.stats.durationMs;
    report.unexpressed = result.unexpressed;
    report.messages = result.messages;
    if (result.stats.routerReportedOpen !== undefined) report.routerReportedOpen = result.stats.routerReportedOpen;
    if (result.stats.extra) report.extra = result.stats.extra;
    for (const u of result.unexpressed) unexpressed.add(u);
    if (result.status === "cancelled" || request.signal?.aborted) {
      cancelled = true;
      report.reason = "cancelled";
      emit({ type: "stage-end", stage, router: router.id, status: "cancelled", kept: false, reason: "cancelled" });
      break;
    }
    if (!result.ops.length) {
      report.reason = result.status === "complete" ? "nothing to add" : `no copper (${result.status})`;
      emit({ type: "stage-end", stage, router: router.id, status: result.status, kept: false, reason: report.reason });
      nextReason(`${result.status}, no copper`);
      continue;
    }
    report.added = opsTotals(result.ops);
    const applied = applyOnCopy(base, result, router, job, stage);
    if (!applied.doc) {
      const r = applied.reply;
      report.reason = `its operations were refused: ${r.status === "refused" ? `${r.reason}: ${r.message}` : r.status === "invalid" ? r.error : r.status}`;
      if (r.status === "refused" && r.reason === "locked") proposal.lockCheck = { ok: false, changed: [...new Set([...proposal.lockCheck.changed, ...(r.ids ?? [])])].sort(byCodeUnit) };
      emit({ type: "stage-end", stage, router: router.id, status: result.status, kept: false, reason: report.reason });
      nextReason("operations refused");
      continue;
    }
    if (applied.lockChanged.length) {
      report.reason = `locked copper changed: ${applied.lockChanged.join(", ")}`;
      proposal.lockCheck = { ok: false, changed: [...new Set([...proposal.lockCheck.changed, ...applied.lockChanged])].sort(byCodeUnit) };
      emit({ type: "stage-end", stage, router: router.id, status: result.status, kept: false, reason: report.reason });
      nextReason("locked copper changed");
      continue;
    }
    const score = await scoreBoard(applied.doc, request.scorer);
    report.score = score;
    const worse = worseThan(score, baseScore);
    const step: ProposalStep = { actor: ROUTER_ACTOR(router), transaction: routerTransaction(`${runId}.${stage}.${router.id}`, `route ${job.nets.length} nets with ${router.id}`, result.ops, result.provenance, { changeSet: { id: runId, title: `router run ${runId}` } }) };
    if (worse.length || compareScores(score, baseScore) >= 0) {
      report.reason = worse.length ? `worse than the board it started from: ${worse.join("; ")}` : "no better than the board it started from";
      const total = [...proposal.steps, step];
      if (!bestRejected || compareScores(score, bestRejected.score) < 0) bestRejected = { score, steps: total, added: sumAdded(total) };
      emit({ type: "stage-end", stage, router: router.id, status: result.status, kept: false, reason: report.reason });
      nextReason(report.reason);
      continue;
    }
    report.kept = true;
    proposal.steps.push(step);
    base = applied.doc;
    baseScore = score;
    remaining = netsInScope(base, { kind: "nets", nets: remaining }, request.islands).nets.map((n) => n.net);
    // a region scope: only nets whose islands in the region are still apart
    if (first.region) remaining = netsInScope(base, { kind: "region", region: first.region, includePourNets: true }, request.islands).nets.map((n) => n.net).filter((n) => remaining.includes(n));
    emit({ type: "stage-end", stage, router: router.id, status: result.status, kept: true });
    if (remaining.length) nextReason(result.status === "timeout" || result.status === "failed" ? `${result.status}, ${remaining.length} net(s) still open` : `${remaining.length} net(s) still open`);
  }

  proposal.unexpressed = [...unexpressed].sort(byCodeUnit);
  proposal.added = sumAdded(proposal.steps);
  if (stopped.length) proposal.stopped = stopped;
  const fellBack = proposal.stages.length > 1;
  if (fellBack) proposal.fallback = { from: proposal.stages[0].router, to: proposal.stages.slice(1).map((s) => s.router), reasons: fallbackReasons };

  if (cancelled) {
    proposal.status = "cancelled";
    proposal.steps = [];
    proposal.added = { segments: 0, vias: 0, length: 0 };
    proposal.reasons.push("cancelled before every router finished; nothing is proposed");
    emit({ type: "done", status: proposal.status });
    return proposal;
  }

  if (proposal.steps.length) {
    proposal.candidate = baseScore;
    proposal.status = "proposed";
    const worse = worseThan(baseScore, current);
    if (worse.length) {
      proposal.status = "rejected";
      proposal.reasons.push(...worse);
    }
  } else if (bestRejected) {
    proposal.status = "rejected";
    proposal.candidate = bestRejected.score;
    proposal.steps = bestRejected.steps;
    proposal.added = bestRejected.added;
    proposal.reasons.push(...(worseThan(bestRejected.score, current).length ? worseThan(bestRejected.score, current) : ["no better than the current board"]));
  } else {
    proposal.status = proposal.stages.some((s) => s.status === "failed" || s.status === "timeout" || s.status === "skipped") ? "failed" : "unchanged";
    proposal.reasons.push(...proposal.stages.map((s) => `${s.router}: ${s.reason ?? s.status}`));
  }
  if (!proposal.lockCheck.ok) proposal.reasons.push(`a router tried to change locked records (${proposal.lockCheck.changed.join(", ")}); its result was not kept`);
  if (proposal.steps.length && snapshot) {
    const t = proposal.steps[0].transaction;
    proposal.steps[0] = { ...proposal.steps[0], transaction: { ...t, expectEpoch: snapshot.epoch, expectSeq: snapshot.seq } };
  }
  proposal.openNets = proposal.status === "proposed" ? remaining : scopeNets.filter((n) => netsInScope(doc, { kind: "nets", nets: [n] }, request.islands).nets.length > 0);

  const diagnoseLeft = request.deadline === undefined ? Infinity : request.deadline - Date.now();
  if (proposal.openNets.length && request.diagnose !== false && !request.signal?.aborted && diagnoseLeft < MIN_STAGE_MS) (proposal.stopped ??= []).push("the rules-or-placement rerun: not started, the time budget ran out");
  else if (proposal.openNets.length && request.diagnose !== false && !request.signal?.aborted) {
    // the router whose copper was kept last does the probe (it is the one that got furthest), else the first available
    const lastKept = [...proposal.stages].reverse().find((st) => st.kept)?.router;
    const diag = await diagnose(proposal.status === "proposed" ? base : doc, proposal.openNets, request, runId, lastKept);
    if (diag) {
      proposal.diagnostic = diag;
      emit({ type: "diagnostic", nets: diag.nets.length });
    }
  }
  emit({ type: "done", status: proposal.status });
  return proposal;
}

function sumAdded(steps: ProposalStep[]): { segments: number; vias: number; length: number } {
  const t = { segments: 0, vias: 0, length: 0 };
  for (const s of steps) {
    const x = opsTotals(s.transaction.ops);
    t.segments += x.segments;
    t.vias += x.vias;
    t.length += x.length;
  }
  return t;
}

const mmText = (nm: number) => `${(nm / 1e6).toFixed(3).replace(/\.?0+$/, "")} mm`;

/**
 * The rules-or-placement diagnostic: rerun the open nets with the floor and no-go tiers only, on a copy, with the
 * router whose copper was kept last (else the first available); a net that routes within the floor clearance is
 * blocked by rules (the report names the target rules and defaults relaxed, and the policy areas its relaxed route
 * crosses); a net that stays open, or routes only by breaking the floor clearance, is blocked by placement or a
 * no-go area. The board is not changed.
 */
async function diagnose(doc: BoardDocument, nets: string[], request: RouteRequest, runId: string, prefer?: string): Promise<DiagnosticReport | undefined> {
  const router = request.routers.find((r) => r.id === prefer && r.available().ok) ?? request.routers.find((r) => r.available().ok);
  if (!router) return undefined;
  const t0 = Date.now();
  const scope: RouteScope = { kind: "nets", nets, ...(request.scope.layers ? { layers: request.scope.layers } : {}) };
  const built = buildJob(doc, { ...request, scope, tiers: "floor-and-no-go" });
  const job: RouteJob = { ...built, runId: `${runId}-probe`, unexpressed: [] };
  delete (job as { notes?: string[] }).notes;
  if (request.deadline !== undefined) job.budget = { ...job.budget, timeMs: Math.max(1, Math.min(job.budget.timeMs, request.deadline - Date.now())) };
  job.unexpressed = [...new Set([...commonUnexpressed(job.constraints), ...router.express(job)])];
  const normal = resolveConstraints(doc, nets, { ...(request.scope.layers ? { layers: request.scope.layers } : {}) });
  const s = stageSignal(request.signal, request.deadline !== undefined ? Math.min(job.budget.timeMs + 30_000, request.deadline - Date.now() + DEADLINE_GRACE_MS) : job.budget.timeMs + 30_000);
  let result: RouteResult;
  try {
    result = await router.route(job, s.signal, () => {});
  } catch (e) {
    result = { status: "failed", ops: [], provenance: { by: "routed" }, stats: { durationMs: Date.now() - t0, segments: 0, vias: 0, length: 0 }, unexpressed: [], messages: [String(e)], version: router.version() };
  } finally {
    s.done();
  }
  let after: BoardDocument = doc;
  if (result.ops.length) {
    const applied = applyOnCopy(doc, result, router, job, 99);
    if (applied.doc && !applied.lockChanged.length) after = applied.doc;
  }
  const stillOpen = new Set(netsInScope(after, { kind: "nets", nets }, request.islands).nets.map((n) => n.net));
  // copper the relaxed run added, by net, and its pairs closer than the floor clearance
  const newIds = new Map<string, string>();
  for (const r of after.records.values()) if (!doc.records.has(r.id) && (r.kind === "track" || r.kind === "via") && r.net) newIds.set(r.id, r.net);
  const violations = new Map<string, number>();
  if (newIds.size)
    for (const pr of clearancePairs(copperModel(after), job.constraints.defaults.clearance.floor)) {
      const net = newIds.get(pr.a) ?? newIds.get(pr.b);
      if (net) violations.set(net, (violations.get(net) ?? 0) + 1);
    }
  const added = new Map<string, [P, P][]>();
  for (const op of result.ops)
    if (op.op === "track.add")
      for (const sg of op.segments as { net: string; start: P; end: P }[]) {
        const l = added.get(sg.net) ?? [];
        l.push([sg.start, sg.end]);
        added.set(sg.net, l);
      }
  const out: DiagnosticNet[] = nets.map((net) => {
    const floorViolations = violations.get(net) ?? 0;
    if (stillOpen.has(net) || floorViolations > 0) return { net, verdict: "placement", relaxed: [], crossedPolicies: [], floorViolations };
    return { net, verdict: "rules", relaxed: relaxedFor(normal, job.constraints, net), crossedPolicies: crossed(normal, added.get(net) ?? []), floorViolations };
  });
  return { router: router.id, tiers: "floor-and-no-go", durationMs: Date.now() - t0, nets: out, status: result.status, messages: result.messages };
}

/** The target rules and defaults that differ from the floor for a net (what the diagnostic relaxed). */
function relaxedFor(normal: ResolvedConstraints, relaxed: ResolvedConstraints, net: string): string[] {
  const n = netConstraint(normal, net);
  const r = netConstraint(relaxed, net);
  const out: string[] = [];
  if (n.width.plan > r.width.plan) out.push(`track width ${mmText(n.width.plan)} to floor ${mmText(r.width.plan)} (${n.sources.width ?? "default plan"})`);
  if (n.clearance.plan > r.clearance.plan) out.push(`clearance ${mmText(n.clearance.plan)} to floor ${mmText(r.clearance.plan)} (${n.sources.clearance ?? "default plan"})`);
  if (normal.via.outer.plan > relaxed.via.outer.plan || normal.via.hole.plan > relaxed.via.hole.plan)
    out.push(`via ${mmText(normal.via.outer.plan)}/${mmText(normal.via.hole.plan)} to floor ${mmText(relaxed.via.outer.plan)}/${mmText(relaxed.via.hole.plan)}`);
  if (normal.edgeClearance.plan > relaxed.edgeClearance.plan) out.push(`edge clearance ${mmText(normal.edgeClearance.plan)} to floor ${mmText(relaxed.edgeClearance.plan)}`);
  return out;
}

/** Policy keep-outs and policy rule regions that some of these segments enter. */
function crossed(c: ResolvedConstraints, segs: [P, P][]): string[] {
  const out: string[] = [];
  const areas = [...c.keepouts.filter((k) => k.tier === "policy").map((k) => ({ id: k.id, outline: k.outline })), ...c.policies.filter((p) => p.region).map((p) => ({ id: p.id, outline: p.region! }))];
  for (const a of areas) {
    const poly = flattenContour(a.outline).points;
    if (segs.some(([p, q]) => segPolygonDist(p, q, poly) === 0 || pointInPolygon(p, poly))) out.push(a.id);
  }
  return out.sort(byCodeUnit);
}

/** Apply an accepted proposal to a live board service, step by step as each router; stops at the first refusal. */
export function applyProposal(service: Pick<BoardService, "apply">, proposal: RouteProposal): Reply[] {
  if (proposal.status !== "proposed") throw new Error(`proposal ${proposal.runId} is ${proposal.status}, not proposed`);
  const replies: Reply[] = [];
  for (const s of proposal.steps) {
    const r = service.apply(s.transaction, s.actor);
    replies.push(r);
    if (r.status !== "applied") break;
  }
  return replies;
}
