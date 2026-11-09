/**
 * @protoboardai/board-edit/service: the Node side of editing (contract phase2-editing.md, sections 4 and 6). Live
 * checks after every commit (incremental checks through `board-checks`, incremental refill through `board-fill`,
 * published as a derived-state event), the rules-or-placement diagnosis of one net through `board-route`, router
 * results turned into proposals, and the extension methods a serving process offers on the wire.
 */
import { z } from "zod";
import type { Actor, BoardService, BoardSnapshot, DerivedState, ExtensionMethod, OpCall, Proposal, ProposeReply } from "@protoboardai/board/node";
import { createIncrementalChecks, runBoardChecks, type BoardCheckResult, type IncrementalChecks } from "@protoboardai/board-checks";
import { fillZones, refillZones, type FillZonesResult } from "@protoboardai/board-fill";
import { builtinRouter, defaultRouters, routeBoard, type BoardScorer, type RouteProposal, type Router } from "@protoboardai/board-route";

export * from "./index.js";

// ---------------------------------------------------------------- live checks

export interface LiveChecksOptions {
  /** `compute` (default): board-fill fills every zone at attach and refills the affected ones after each commit. */
  fills?: "compute" | "none";
}

export interface LiveState {
  seq: number;
  result: BoardCheckResult;
  fill?: FillZonesResult;
  derived: DerivedState;
}

export interface LiveChecks {
  current(): LiveState;
  stop(): void;
}

const ms = (t: number) => Math.round((performance.now() - t) * 100) / 100;

function summaryOf(r: BoardCheckResult): DerivedState["summary"] {
  const s = r.summary;
  return { line: s.line, unconnected: s.unconnected, errors: s.errors, warnings: s.warnings, infos: s.infos, incomplete: s.incomplete, caveats: [...s.caveats] };
}

/** Recheck and refill after every commit, and publish the derived state through the service. */
export function attachLiveChecks(svc: BoardService, options: LiveChecksOptions = {}): LiveChecks {
  const t0 = performance.now();
  let snap = svc.snapshot();
  const hasZones = [...snap.doc.records.values()].some((r) => r.kind === "zone");
  let fill: FillZonesResult | undefined = (options.fills ?? "compute") === "compute" && hasZones ? fillZones(snap) : undefined;
  const fillMs = ms(t0);
  const t1 = performance.now();
  const checks: IncrementalChecks = createIncrementalChecks(snap.doc, fill ? { fills: fill.fill } : {});
  let state: LiveState = {
    seq: snap.seq,
    result: checks.result,
    ...(fill ? { fill } : {}),
    derived: {
      epoch: snap.epoch,
      seq: snap.seq,
      summary: summaryOf(checks.result),
      findings: { added: checks.result.findings, removed: [], total: checks.result.findings.length },
      fill: { refilled: fill ? [...new Set(fill.recomputed.map((r) => r.zone))].sort() : [], stale: [] },
      stale: { checks: false, fill: [] },
      timing: { checksMs: ms(t1), fillMs, totalMs: ms(t0), mode: "full" },
    },
  };
  svc.publishDerived(state.derived);
  const unsubscribe = svc.subscribe((e) => {
    if (e.type !== "commit") return;
    const t = performance.now();
    snap = svc.snapshot();
    let refilled: string[] = [];
    let fMs = 0;
    if (fill) {
      const tf = performance.now();
      fill = refillZones(snap, fill, e.changed);
      refilled = [...new Set(fill.recomputed.map((r) => r.zone))].sort();
      fMs = ms(tf);
    }
    const tc = performance.now();
    const u = checks.update(snap.doc, e.changed, fill ? { fills: fill.fill, ...(refilled.length ? { fillChanged: refilled } : {}) } : {});
    const derived: DerivedState = {
      epoch: snap.epoch,
      seq: snap.seq,
      summary: summaryOf(u.result),
      findings: { added: u.added, removed: u.removed, total: u.result.findings.length },
      fill: { refilled, stale: [] },
      stale: { checks: false, fill: [] },
      timing: { checksMs: ms(tc), fillMs: fMs, totalMs: ms(t), mode: u.mode },
    };
    state = { seq: snap.seq, result: u.result, ...(fill ? { fill } : {}), derived };
    svc.publishDerived(derived);
  });
  return {
    current: () => state,
    stop: unsubscribe,
  };
}

// ---------------------------------------------------------------- diagnosis

export interface DiagnoseOptions {
  /** Routers in order (default: the tscircuit autorouter, then an installed Freerouting). */
  routers?: Router[];
  /** The board's checks (default: board-checks' open connections and errors). */
  scorer?: BoardScorer;
  /** Wall clock per router run, ms (default 60 s). */
  budgetMs?: number;
}

export type NetDiagnosis =
  | { net: string; routable: true; router: string; durationMs: number; messages: string[] }
  | { net: string; routable: false; verdict: "rules" | "placement" | "unknown"; relaxed: string[]; crossedPolicies: string[]; floorViolations: number; router: string; durationMs: number; messages: string[] };

/** The default scorer: open connections and error findings from board-checks. */
export const checksScorer: BoardScorer = (doc) => {
  const r = runBoardChecks(doc);
  const openNets = r.connectivity.nets.filter((n) => n.missing > 0).map((n) => n.net);
  return { open: r.summary.unconnected, errors: r.summary.errors, openNets };
};

/** Try to route one net; when it stays open, say whether the rules or the placement block it. */
export async function diagnoseNet(snapshot: BoardSnapshot, net: string, options: DiagnoseOptions = {}): Promise<NetDiagnosis> {
  if (!snapshot.doc.nets.has(net)) throw new Error(`no net ${net} in this board's netlist`);
  const t0 = performance.now();
  const routers = options.routers ?? defaultRouters();
  const p: RouteProposal = await routeBoard(snapshot, { scope: { kind: "nets", nets: [net] }, routers, scorer: options.scorer ?? checksScorer, budget: { timeMs: options.budgetMs ?? 60_000 }, diagnose: true });
  const router = p.stages.find((s) => s.kept)?.router ?? p.stages[0]?.router ?? routers[0]?.id ?? "none";
  const durationMs = Math.round(performance.now() - t0);
  const messages = [...p.reasons, ...p.notes];
  if (!p.openNets.includes(net) && (p.status === "proposed" || p.status === "unchanged")) return { net, routable: true, router, durationMs, messages };
  const d = p.diagnostic?.nets.find((n) => n.net === net);
  if (!d) return { net, routable: false, verdict: "unknown", relaxed: [], crossedPolicies: [], floorViolations: 0, router: p.diagnostic?.router ?? router, durationMs, messages: [...messages, ...(p.diagnostic?.messages ?? ["the rules-or-placement rerun did not report this net"])] };
  return { net, routable: false, verdict: d.verdict, relaxed: [...d.relaxed], crossedPolicies: [...d.crossedPolicies], floorViolations: d.floorViolations, router: p.diagnostic!.router, durationMs, messages: [...messages, ...p.diagnostic!.messages] };
}

// ---------------------------------------------------------------- router results as proposals

/** The ops of one router step, split by net (track.add and via.add entries regrouped; anything else kept whole). */
function byNet(ops: OpCall[]): Map<string, OpCall[]> {
  const out = new Map<string, OpCall[]>();
  const push = (net: string, op: OpCall) => {
    const l = out.get(net) ?? [];
    l.push(op);
    out.set(net, l);
  };
  for (const op of ops) {
    if (op.op === "track.add" || op.op === "via.add") {
      const key = op.op === "track.add" ? "segments" : "vias";
      const groups = new Map<string, unknown[]>();
      for (const s of op[key] as { net?: string }[]) {
        const n = s.net ?? "(no net)";
        groups.set(n, [...(groups.get(n) ?? []), s]);
      }
      for (const [n, list] of groups) push(n, { op: op.op, [key]: list });
    } else push("(other)", op);
  }
  return out;
}

/** Turn a board-route proposal into service proposals: one per router step, one item per net. */
export function proposeRouteResult(svc: BoardService, rp: RouteProposal): ProposeReply[] {
  if (rp.status !== "proposed") return [{ status: "invalid", error: `the route result is ${rp.status}, not proposed: ${rp.reasons.join("; ")}` }];
  const out: ProposeReply[] = [];
  for (const step of rp.steps) {
    const items = [...byNet(step.transaction.ops)].map(([net, ops], i) => ({ key: `n${i}`, label: `route ${net}`, ops }));
    const router = step.actor.name ?? step.actor.id;
    out.push(
      svc.propose(step.actor, {
        title: `route ${items.length} net${items.length === 1 ? "" : "s"} with ${router}`,
        items,
        ...(step.transaction.provenance ? { provenance: step.transaction.provenance } : {}),
        scores: { current: rp.current, candidate: rp.candidate, runId: rp.runId },
        ...(step.transaction.changeSet ? { changeSet: step.transaction.changeSet } : {}),
        ...(rp.base.seq !== undefined && rp.base.epoch === svc.epoch ? { expectSeq: rp.base.seq } : {}),
      }),
    );
  }
  return out;
}

// ---------------------------------------------------------------- the service attachment

export interface Editing {
  live: LiveChecks | undefined;
  diagnose(net: string): Promise<NetDiagnosis>;
  /** Extension methods for `serveBoard(svc, { methods })`. */
  methods: Record<string, ExtensionMethod>;
  stop(): void;
}

/** Live checks, diagnosis and their wire methods for one service. */
export function attachEditing(svc: BoardService, options: { live?: boolean | LiveChecksOptions; diagnose?: DiagnoseOptions } = {}): Editing {
  const live = options.live === false ? undefined : attachLiveChecks(svc, typeof options.live === "object" ? options.live : {});
  const diagnose = (net: string) => diagnoseNet(svc.snapshot(), net, options.diagnose);
  return {
    live,
    diagnose,
    methods: {
      "board.diagnose": { params: z.object({ net: z.string().min(1).max(200) }).strict(), run: (p: unknown) => diagnose((p as { net: string }).net) },
    },
    stop: () => live?.stop(),
  };
}

/** The built-in straight and L router (tests and offline use). */
export { builtinRouter };
export type { Actor, Proposal };
