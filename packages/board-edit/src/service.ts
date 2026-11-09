/**
 * @protoboardai/board-edit/service: the Node side of editing (contract phase2-editing.md, sections 4 and 6). Live
 * checks after every commit (incremental checks through `board-checks`, incremental refill through `board-fill`,
 * published as a derived-state event), the rules-or-placement diagnosis of one net through `board-route`, router
 * results turned into proposals, and the extension methods a serving process offers on the wire.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { boardBuildDir, byCodeUnit, canonical, findProjectRoot, recordsOfKind, sha1Hex, type Actor, type BoardDocument, type BoardService, type BoardSnapshot, type DerivedState, type ExtensionMethod, type OpCall, type Proposal, type ProposeReply } from "@protoboardai/board/node";
import { createIncrementalChecks, runBoardChecks, type BoardCheckResult, type IncrementalChecks } from "@protoboardai/board-checks";
import { fillZones, refillZones, type FillZonesResult } from "@protoboardai/board-fill";
import { builtinRouter, createLocalScoring, defaultRouters, netsInScope, routeBoard, type BoardScorer, type RouteProposal, type Router } from "@protoboardai/board-route";

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
  return { line: s.line, unconnected: s.unconnected, errors: s.errors, warnings: s.warnings, infos: s.infos, ...(s.waived ? { waived: s.waived } : {}), incomplete: s.incomplete, caveats: [...s.caveats] };
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
  /** A scorer instead of the board checks (default: board-checks' open connections and errors, scored by what changed). */
  scorer?: BoardScorer;
  /** One time budget for the whole diagnosis, ms (default 8 s): the attempt, the fallback and the rules-or-placement rerun. */
  budgetMs?: number;
  /** Use and fill the cache (default true): in memory, and a file under the board's build folder when `dir` is given. */
  cache?: boolean;
  /** The board folder (for the file cache). */
  dir?: string;
}

/** DEFAULT: the one time budget for a whole diagnosis. */
export const DIAGNOSE_BUDGET_MS = 8_000;

interface DiagnosisExtra {
  /** The open links diagnosed (with a pour, only those its fill does not make). */
  links: number;
  /** The net has a zone: it is left to its pour, and only the links its fill does not make are routed. */
  pour?: { zones: string[]; links: number; note: string };
  budgetMs: number;
  /** What the budget cut (a router not started or stopped, the rerun not run). */
  stopped?: string[];
  /** The input hash the answer is cached by, and whether it came from the cache. */
  hash: string;
  cached: boolean;
}

export type NetDiagnosis =
  | ({ net: string; routable: true; router: string; durationMs: number; messages: string[] } & DiagnosisExtra)
  | ({ net: string; routable: false; verdict: "rules" | "placement" | "unknown"; relaxed: string[]; crossedPolicies: string[]; floorViolations: number; router: string; durationMs: number; messages: string[] } & DiagnosisExtra);

/** The default scorer for a single board: open connections and error findings from a full board-checks run. */
export const checksScorer: BoardScorer = (doc) => {
  const r = runBoardChecks(doc);
  const openNets = r.connectivity.nets.filter((n) => n.missing > 0).map((n) => n.net);
  return { open: r.summary.unconnected, errors: r.summary.errors, openNets };
};

const CACHE_VERSION = 1;
const memory = new Map<string, NetDiagnosis>();

/** The input hash of a diagnosis: the records that can change the answer (not drawings or text), the netlist, the net and the options. */
function diagnosisKey(doc: BoardDocument, net: string, budgetMs: number, routers: readonly Router[], scorer: string): string {
  const ids = [...doc.records.keys()].filter((id) => !["graphic", "text"].includes(doc.records.get(id)!.kind)).sort(byCodeUnit);
  const board = sha1Hex(canonical({ records: ids.map((id) => doc.records.get(id)), netlist: doc.netlist ?? null }));
  return sha1Hex(canonical({ kind: "kernel", v: CACHE_VERSION, board, net, budgetMs, routers: routers.map((r) => `${r.id}@${r.version()}:${r.available().ok ? "on" : "off"}`), scorer })).slice(0, 20);
}

const cacheFile = (dir: string, hash: string) => join(boardBuildDir(findProjectRoot(dir), dir), "diagnosis", `${hash}.json`);

/**
 * Try to route one net's open links within one time budget; when it stays open, say whether the rules or the
 * placement block it. A net with a zone is left to its pour: only the links its fill does not make are routed (none:
 * no router runs). Candidates are scored by what changed (incremental checks and refill). Cached by input hash.
 */
export async function diagnoseNet(snapshot: BoardSnapshot, net: string, options: DiagnoseOptions = {}): Promise<NetDiagnosis> {
  if (!snapshot.doc.nets.has(net)) throw new Error(`no net ${net} in this board's netlist`);
  const t0 = performance.now();
  const started = Date.now();
  const doc = snapshot.doc;
  const routers = options.routers ?? defaultRouters();
  const budgetMs = Math.max(1, Math.round(options.budgetMs ?? DIAGNOSE_BUDGET_MS));
  const hash = diagnosisKey(doc, net, budgetMs, routers, options.scorer ? "injected" : "board checks");
  const useCache = options.cache !== false;
  if (useCache) {
    let hit = memory.get(hash);
    if (!hit && options.dir && existsSync(cacheFile(options.dir, hash))) {
      try {
        const j = JSON.parse(readFileSync(cacheFile(options.dir, hash), "utf8")) as { version: number; hash: string; diagnosis: NetDiagnosis };
        if (j.version === CACHE_VERSION && j.hash === hash) hit = j.diagnosis;
      } catch {
        // an unreadable cache is a miss
      }
    }
    if (hit) return { ...hit, cached: true, durationMs: Math.round(performance.now() - t0) };
  }

  // the net's open links as the checks see them (with the zone fill); candidates scored by what changed
  const local = createLocalScoring<FillZonesResult>(doc, { checks: (d, o) => createIncrementalChecks(d, o.fills ? { fills: o.fills } : {}), fills: { fill: (d) => fillZones(d), refill: (d, prev, changed) => refillZones(d, prev, changed) } });
  const scope = { kind: "nets" as const, nets: [net] };
  const open = netsInScope(doc, scope, local.islands).nets.find((n) => n.net === net);
  const links = open ? open.islands.length - 1 : 0;
  const zones = recordsOfKind(doc, "zone").filter((z) => z.net === net).map((z) => z.id).sort(byCodeUnit);
  const pour = zones.length ? { zones, links, note: links ? `left to its pour (${zones.join(", ")}): only the ${links} link(s) its fill does not make are routed` : `left to its pour (${zones.join(", ")}): its fill joins every pad; nothing is routed` } : undefined;
  const extra = (stopped: string[]): DiagnosisExtra => ({ links, ...(pour ? { pour } : {}), budgetMs, ...(stopped.length ? { stopped } : {}), hash, cached: false });
  const keep = (d: NetDiagnosis): NetDiagnosis => {
    if (!useCache) return d;
    memory.set(hash, d);
    if (memory.size > 64) memory.delete(memory.keys().next().value as string);
    if (options.dir)
      try {
        mkdirSync(join(cacheFile(options.dir, hash), ".."), { recursive: true });
        writeFileSync(cacheFile(options.dir, hash), `${JSON.stringify({ version: CACHE_VERSION, hash, at: new Date().toISOString(), diagnosis: d })}\n`, "utf8");
      } catch {
        // a cache that cannot be written is only slower next time
      }
    return d;
  };
  if (!links) return keep({ net, routable: true, router: "none", durationMs: Math.round(performance.now() - t0), messages: [pour ? pour.note : `${net} has no open connection`], ...extra([]) });

  // one deadline: each router may use a little over half of what is left, so the rules-or-placement rerun has time
  const p: RouteProposal = await routeBoard(snapshot, {
    scope,
    routers,
    scorer: options.scorer ?? local.scorer,
    islands: local.islands,
    budget: { timeMs: Math.max(1, Math.round((started + budgetMs - Date.now()) * 0.55)) },
    deadline: started + budgetMs,
    diagnose: true,
  });
  const stopped = [...(p.stopped ?? [])];
  const router = p.stages.find((s) => s.kept)?.router ?? p.stages[0]?.router ?? routers[0]?.id ?? "none";
  const durationMs = Math.round(performance.now() - t0);
  const messages = [...(pour ? [pour.note] : []), ...p.reasons, ...p.notes];
  if (!p.openNets.includes(net) && (p.status === "proposed" || p.status === "unchanged")) return keep({ net, routable: true, router, durationMs, messages, ...extra(stopped) });
  const d = p.diagnostic?.nets.find((x) => x.net === net);
  if (!d) return keep({ net, routable: false, verdict: "unknown", relaxed: [], crossedPolicies: [], floorViolations: 0, router: p.diagnostic?.router ?? router, durationMs, messages: [...messages, ...(p.diagnostic?.messages ?? [stopped.length ? "the time budget ran out before the rules-or-placement rerun" : "the rules-or-placement rerun did not report this net"])], ...extra(stopped) });
  return keep({ net, routable: false, verdict: d.verdict, relaxed: [...d.relaxed], crossedPolicies: [...d.crossedPolicies], floorViolations: d.floorViolations, router: p.diagnostic!.router, durationMs, messages: [...messages, ...p.diagnostic!.messages], ...extra(stopped) });
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
  diagnose(net: string, options?: { budgetMs?: number }): Promise<NetDiagnosis>;
  /** Extension methods for `serveBoard(svc, { methods })`. */
  methods: Record<string, ExtensionMethod>;
  stop(): void;
}

/** Live checks, diagnosis and their wire methods for one service. */
export function attachEditing(svc: BoardService, options: { live?: boolean | LiveChecksOptions; diagnose?: DiagnoseOptions } = {}): Editing {
  const live = options.live === false ? undefined : attachLiveChecks(svc, typeof options.live === "object" ? options.live : {});
  // cached in memory and, for a board opened from a folder, under its build folder
  const diagnose = (net: string, o: { budgetMs?: number } = {}) => diagnoseNet(svc.snapshot(), net, { ...(svc.dir ? { dir: svc.dir } : {}), ...options.diagnose, ...(o.budgetMs ? { budgetMs: o.budgetMs } : {}) });
  return {
    live,
    diagnose,
    methods: {
      "board.diagnose": {
        params: z.object({ net: z.string().min(1).max(200), budgetMs: z.number().int().positive().max(3_600_000).optional() }).strict(),
        run: (p: unknown) => {
          const q = p as { net: string; budgetMs?: number };
          return diagnose(q.net, q.budgetMs ? { budgetMs: q.budgetMs } : {});
        },
      },
    },
    stop: () => live?.stop(),
  };
}

/** The built-in straight and L router (tests and offline use). */
export { builtinRouter };
export type { Actor, Proposal };
