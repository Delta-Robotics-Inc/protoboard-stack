/**
 * The routing diagnosis of one net (L4) for a host (Node only), on `@protoboardai/board-route` (loaded when
 * installed): why the net does not route, within one time budget for the whole diagnosis (DEFAULT 8 s).
 *
 * 1. Connectivity: the board's checks (with the zone fill, when the board has zones) run once and give the net's
 *    open links. A net with a zone is left to its pour: only the links its fill does not make are diagnosed, and when
 *    there are none no router runs at all.
 * 2. The attempt with every rule (the routers in order, the fallback only while time is left), on those links only,
 *    and beside it (in parallel: the routers run in their own worker or program) the probe with only the fab floor
 *    and no-go areas (the first available router), dropped when the attempt routes.
 * 3. Relaxations of the target rules for this net, test-run on copies, two at a time (the floor is never relaxed);
 *    pruned when an earlier answer already says how they end.
 *
 * Every candidate is scored by what changed since the last board scored (incremental checks and refill), not by a
 * full check run. Each stage stops when the budget runs out and the answer says what was cut. Answers are cached by
 * an input hash (the board content that can change the answer, the net and the options): in memory in this process,
 * and in a file under the board's build folder when the board folder is known. Nothing is applied.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { boardBuildDir, byCodeUnit, canonical, createEngine, findProjectRoot, recordsOfKind, sha1Hex, type Actor, type BoardDocument, type BoardSnapshot, type RuleRec, type Transaction } from "@protoboardai/board/node";
import type * as RouteModule from "@protoboardai/board-route";
import type { DiagnosisArea, DiagnosisProgress, DiagnosisView, RelaxOption } from "../types.js";
import { loadChecksModule } from "./analysis.js";
import { ghostOf, loadFillModule, loadRouteModule } from "./route.js";

type BoardScorer = RouteModule.BoardScorer;
type Router = RouteModule.Router;

/** Bumped when the diagnosis changes what it answers (old cached answers are then not used). */
export const DIAGNOSIS_VERSION = 2;
/** DEFAULT: the one time budget for a whole diagnosis. */
export const DEFAULT_DIAGNOSIS_BUDGET_MS = 8_000;
const MEMORY_CAP = 64;

export interface DiagnoseOptions {
  /** One time budget for the whole diagnosis, ms (DEFAULT 8 s). */
  budgetMs?: number;
  /** Routers in order (DEFAULT the product's: tscircuit, then Freerouting). */
  routers?: Router[];
  /** A scorer instead of the board checks (tests). The open links still come from the checks when they are installed. */
  scorer?: BoardScorer;
  /** A name for an injected scorer (part of the cache key). */
  scorerName?: string;
  signal?: AbortSignal;
  /** Called as the diagnosis goes: the stage, the fraction done (0 to 1) and the time so far. */
  onProgress?: (p: DiagnosisProgress) => void;
  /** Use and fill the cache (DEFAULT true): memory always, a file when `dir` is given. */
  cache?: boolean;
  /** The board folder (for the file cache under its build folder). */
  dir?: string;
  projectRoot?: string;
}

const mmText = (nm: number) => `${(nm / 1e6).toFixed(3).replace(/\.?0+$/, "")} mm`;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

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

// ---------------------------------------------------------------- cache

/** Record kinds that cannot change a routing answer (drawings and text). */
const INERT = new Set(["graphic", "text"]);

/** The input hash of a diagnosis: the board content that can change the answer, the net, and the options. */
export function diagnosisHash(doc: BoardDocument, net: string, o: { budgetMs: number; routers: readonly Router[]; scorer: string }): string {
  const ids = [...doc.records.keys()].filter((id) => !INERT.has(doc.records.get(id)!.kind)).sort(byCodeUnit);
  const board = sha1Hex(canonical({ records: ids.map((id) => doc.records.get(id)), netlist: doc.netlist ?? null }));
  const routers = o.routers.map((r) => {
    let v = "?";
    try {
      v = r.version();
    } catch {
      /* a version is only part of the key */
    }
    return `${r.id}@${v}:${r.available().ok ? "on" : "off"}`;
  });
  return sha1Hex(canonical({ v: DIAGNOSIS_VERSION, board, net, budgetMs: o.budgetMs, routers, scorer: o.scorer })).slice(0, 20);
}

const memory = new Map<string, DiagnosisView>();
const remember = (hash: string, v: DiagnosisView) => {
  memory.delete(hash);
  memory.set(hash, v);
  while (memory.size > MEMORY_CAP) memory.delete(memory.keys().next().value as string);
};

/** Where a board's cached diagnoses live: `<root>/.protoboard/build/board/<board key>/diagnosis/`. */
export function diagnosisCacheDir(dir: string, projectRoot?: string): string {
  const d = resolve(dir);
  return join(boardBuildDir(projectRoot ?? findProjectRoot(d), d), "diagnosis");
}

function readCached(hash: string, o: DiagnoseOptions): DiagnosisView | undefined {
  const hit = memory.get(hash);
  if (hit) return hit;
  if (!o.dir) return undefined;
  const file = join(diagnosisCacheDir(o.dir, o.projectRoot), `${hash}.json`);
  if (!existsSync(file)) return undefined;
  try {
    const j = JSON.parse(readFileSync(file, "utf8")) as { version: number; hash: string; view: DiagnosisView };
    if (j.version !== DIAGNOSIS_VERSION || j.hash !== hash || !j.view) return undefined;
    remember(hash, j.view);
    return j.view;
  } catch {
    return undefined;
  }
}

function writeCached(hash: string, v: DiagnosisView, o: DiagnoseOptions): void {
  remember(hash, v);
  if (!o.dir) return;
  try {
    const folder = diagnosisCacheDir(o.dir, o.projectRoot);
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, `${hash}.json`), `${JSON.stringify({ version: DIAGNOSIS_VERSION, hash, at: new Date().toISOString(), view: v })}\n`, "utf8");
  } catch {
    // a cache that cannot be written is only slower next time
  }
}

/** Forget every cached diagnosis in this process (tests). */
export function clearDiagnosisMemory(): void {
  memory.clear();
}

// ---------------------------------------------------------------- the diagnosis

/** Stage weights for the progress fraction. */
const SPAN = { cache: [0, 0.02], connectivity: [0.02, 0.08], attempt: [0.08, 0.75], probe: [0.08, 0.75], relaxations: [0.75, 1], done: [1, 1] } as const;
/** The share of the budget the attempt and the probe (run side by side) may use; the relaxations get the rest. */
const FIRST_SHARE = 0.75;
/** Relaxations test-run side by side (each router run is its own worker or program). */
const RELAX_PARALLEL = 2;

/**
 * Why one net does not route (L4), within one time budget: the net's open links (a net with a zone is left to its
 * pour), the attempt with every rule, the probe with the fab floor and no-go areas only, the verdict, what blocks it,
 * the rule areas by tier, and relaxations test-run on copies of the board. Nothing is applied.
 */
export async function diagnoseNet(snapshot: BoardSnapshot, net: string, options: DiagnoseOptions = {}): Promise<DiagnosisView> {
  const t0 = Date.now();
  const route = await loadRouteModule();
  if (!route) throw new Error("the autorouter is not installed (package @protoboardai/board-route)");
  const doc = snapshot.doc;
  if (!doc.nets.has(net)) throw new Error(`net ${net} is not in this board's netlist`);
  const budgetMs = Math.max(1, Math.round(options.budgetMs ?? DEFAULT_DIAGNOSIS_BUDGET_MS));
  const deadline = t0 + budgetMs;
  const routers = options.routers ?? route.defaultRouters();
  const checks = await loadChecksModule();
  const fill = await loadFillModule();
  const scorerName = options.scorer ? (options.scorerName ?? "injected") : checks ? "board checks" : "basic";
  const useCache = options.cache !== false;

  let last = 0;
  const progress = (stage: DiagnosisProgress["stage"], within = 0, extra: { router?: string; message?: string } = {}) => {
    const [a, b] = SPAN[stage];
    last = Math.max(last, Math.min(1, a + (b - a) * Math.max(0, Math.min(1, within))));
    try {
      options.onProgress?.({ net, stage, fraction: Math.round(last * 1000) / 1000, elapsedMs: Date.now() - t0, budgetMs, ...extra });
    } catch {
      // a listener's failure never stops the diagnosis
    }
  };

  // the cache: the same board content, net and options give the same answer
  const hash = diagnosisHash(doc, net, { budgetMs, routers, scorer: scorerName });
  if (useCache) {
    const hit = readCached(hash, options);
    if (hit) {
      progress("done", 1, { message: "from the cache" });
      return { ...hit, seq: snapshot.seq, cached: true, ms: Date.now() - t0 };
    }
  }
  progress("connectivity", 0, { message: "the board's checks and zone fill, once" });

  // 1. connectivity: one check run (with the fill), then only what changes
  const local = checks
    ? route.createLocalScoring(doc, {
        checks: (d, o) => checks.createIncrementalChecks(d, o.fills ? { fills: o.fills } : {}),
        ...(fill ? { fills: { fill: (d: BoardDocument) => fill.fillZones(d), refill: (d: BoardDocument, prev: ReturnType<typeof fill.fillZones>, changed: readonly string[]) => fill.refillZones(d, prev, changed) } } : {}),
      })
    : undefined;
  const scorer = options.scorer ?? local?.scorer ?? route.basicScorer();
  const islands = local?.islands;
  const notes: string[] = [];
  if (!checks) notes.push("the board checks are not installed: zones connect nothing and every island of the net is diagnosed");
  const zones = recordsOfKind(doc, "zone").filter((z) => z.net === net).map((z) => z.id).sort(byCodeUnit);
  const scope = { kind: "nets" as const, nets: [net] };
  const open = route.netsInScope(doc, scope, islands).nets.find((n) => n.net === net);
  const links = open ? open.islands.length - 1 : 0;
  let pour: DiagnosisView["pour"];
  if (zones.length) {
    const fills = !!(local && fill);
    pour = {
      zones,
      links,
      note: !fills
        ? `left to its pour (${zones.join(", ")}), but the zone fill could not be computed here: every island of the net is diagnosed`
        : links
          ? `left to its pour (${zones.join(", ")}): its fill joins the rest; only the ${plural(links, "link")} it does not make ${links === 1 ? "is" : "are"} diagnosed`
          : `left to its pour (${zones.join(", ")}): its fill joins every pad of the net; nothing is routed`,
    };
  }
  progress("connectivity", 1, { message: `${plural(links, "open link")}` });

  const resolvedNormal = route.resolveConstraints(doc, [net], {});
  const resolvedFloor = route.resolveConstraints(doc, [net], { tiers: "floor-and-no-go" });
  const n = route.netConstraint(resolvedNormal, net);
  const f = route.netConstraint(resolvedFloor, net);
  const rules = recordsOfKind(doc, "rule");
  const stopped: string[] = [];
  const signal = options.signal;

  const run = (input: BoardDocument, stage: "attempt" | "probe" | "relaxations", list: Router[], until: number, extra: { tiers?: "floor-and-no-go"; within?: [number, number]; signal?: AbortSignal } = {}) => {
    const [w0, w1] = extra.within ?? [0, 1];
    return route.routeBoard(input, {
      scope,
      routers: list,
      scorer,
      ...(islands ? { islands } : {}),
      budget: { timeMs: Math.max(1, until - Date.now()) },
      deadline: until,
      diagnose: false,
      ...(extra.tiers ? { tiers: extra.tiers } : {}),
      ...(extra.signal ? { signal: extra.signal } : signal ? { signal } : {}),
      onEvent: (e) => {
        if (e.type === "progress") progress(stage, w0 + (w1 - w0) * (e.progress.fraction ?? 0), { router: e.progress.router, message: e.progress.phase });
        else if (e.type === "stage-start") progress(stage, w0, { router: e.router, message: "starting" });
        else if (e.type === "stage-end") progress(stage, w0 + (w1 - w0) * 0.95, { router: e.router, message: `${e.status}${e.reason ? `: ${e.reason}` : ""}` });
      },
    });
  };
  const cut = (stage: string, p: RouteModule.RouteProposal) => {
    for (const s of p.stopped ?? []) stopped.push(`${stage}: ${s}`);
  };
  const left = () => deadline - Date.now();

  // 2. the attempt with every rule and, beside it, the probe with the fab floor and no-go areas only, both on the
  // open links only (nothing open: no router runs); the probe is dropped when the attempt routes
  const connected = links === 0;
  const first = routers.find((r) => r.available().ok);
  let attempt: RouteModule.RouteProposal | undefined;
  let attemptMs = 0;
  let probeRun: { p: RouteModule.RouteProposal; ms: number; router: Router } | undefined;
  if (!connected && !signal?.aborted) {
    const until = t0 + budgetMs * FIRST_SHARE;
    const probeCtl = new AbortController();
    const onAbort = () => probeCtl.abort(signal?.reason);
    signal?.addEventListener("abort", onAbort, { once: true });
    progress("attempt", 0, { message: "every rule as it is; the probe beside it" });
    const ta = Date.now();
    const probing = first ? run(doc, "probe", [first], until, { tiers: "floor-and-no-go", signal: probeCtl.signal }).then((p) => ({ p, ms: Date.now() - ta, router: first })) : undefined;
    try {
      attempt = await run(doc, "attempt", routers, until);
      attemptMs = Date.now() - ta;
      cut("attempt", attempt);
      if (attempt.status === "proposed" && !attempt.openNets.includes(net)) probeCtl.abort(new Error("the attempt routed the net"));
      probeRun = await probing;
    } finally {
      signal?.removeEventListener("abort", onAbort);
    }
  }
  const routesAsIs = !!attempt && attempt.status === "proposed" && !attempt.openNets.includes(net);
  const attempts: DiagnosisView["attempts"] = attempt
    ? attempt.stages.map((s) => ({ router: s.router, status: s.status, ...(s.reason ? { reason: s.reason } : {}), ghost: s.kept ? ghostOf(attempt!.steps.filter((st) => st.actor.id === `router:${s.router}`).map((st) => st.transaction)) : { segments: [], vias: [] }, ms: s.durationMs }))
    : [];
  if (attempt && !attempts.length) attempts.push({ router: "none", status: attempt.status, reason: attempt.reasons.join("; "), ghost: { segments: [], vias: [] }, ms: attemptMs });

  // the router for the relaxations: the one that got furthest in the attempt, else the first available
  const furthest = attempt?.stages.find((s) => s.kept)?.router ?? attempt?.stages.find((s) => s.status === "complete" || s.status === "partial")?.router;
  const single = routers.find((r) => r.id === furthest && r.available().ok) ?? first;

  // 3. what the probe found
  let probe: DiagnosisView["probe"];
  const needProbe = !connected && !routesAsIs && !signal?.aborted;
  if (needProbe && !probeRun) stopped.push("probe: not run, no router is available");
  else if (needProbe && probeRun) {
    const { p, router } = probeRun;
    cut("probe", p);
    const after = p.steps.length ? applyOnCopy(doc, p.steps) : undefined;
    let floorViolations = 0;
    if (after) {
      const added = new Set<string>();
      for (const r of after.records.values()) if (!doc.records.has(r.id) && (r.kind === "track" || r.kind === "via")) added.add(r.id);
      for (const pr of route.clearancePairs(route.copperModel(after), resolvedFloor.defaults.clearance.floor)) if (added.has(pr.a) || added.has(pr.b)) floorViolations++;
    }
    const routed = !!after && !route.netsInScope(after, scope, islands).nets.length;
    probe = { router: p.stages.filter((s) => s.kept).at(-1)?.router ?? p.stages[0]?.router ?? router.id, routed, ghost: ghostOf(p.steps.map((s) => s.transaction)), length: p.added.length, vias: p.added.vias, floorViolations, ms: probeRun.ms };
    // a probe the budget stopped before it routed says nothing
    if (!routed && p.stages.every((s) => s.status === "timeout" || s.status === "skipped" || s.status === "cancelled")) probe = undefined;
    progress("probe", 1);
  }
  const verdict: DiagnosisView["verdict"] = connected ? "connected" : routesAsIs ? "routes" : !probe ? "unknown" : probe.routed && probe.floorViolations === 0 ? "rules" : "placement";

  // what blocks it
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

  // rule areas by tier
  const areas: DiagnosisArea[] = [];
  for (const k of recordsOfKind(doc, "keepout")) areas.push({ id: k.id, name: k.name ?? k.id, tier: k.tier, outline: k.outline.map((v) => ({ x: v.x, y: v.y })), blocks: Object.entries(k.blocks).filter(([, v]) => v).map(([b]) => b).join(", ") });
  for (const r of rules) if (r.enabled !== false && r.applies.region && r.severity !== "ignore") areas.push({ id: r.id, name: r.note ?? r.id, tier: r.tier, outline: r.applies.region.map((v) => ({ x: v.x, y: v.y })), blocks: r.check });

  // 4. relaxations, test-run on copies (only the target tier: the floor is never relaxed)
  const relaxOptions: RelaxOption[] = [];
  if (!connected && !routesAsIs) {
    const prio = Math.min(1_000_000, Math.max(0, ...rules.filter((r) => r.tier === "target").map((r) => r.priority ?? 0)) + 1);
    const key = ruleKey(net);
    const cands: { id: string; title: string; detail: string; rules: Record<string, unknown>[] }[] = [];
    const clr = n.clearance.plan > f.clearance.floor ? { id: `rule:relax.${key}.clearance`, tier: "target", check: "clearance", priority: prio, applies: { nets: [net] }, min: f.clearance.floor, preferred: f.clearance.floor, note: `${net} may route at the floor clearance (routing diagnosis)`.slice(0, 500) } : undefined;
    const wid = n.width.plan > f.width.floor ? { id: `rule:relax.${key}.width`, tier: "target", check: "track_width", priority: prio, applies: { nets: [net] }, min: f.width.floor, preferred: f.width.floor, note: `${net} may route at the floor width (routing diagnosis)`.slice(0, 500) } : undefined;
    if (clr) cands.push({ id: "clearance", title: `Plan ${net} at the floor clearance`, detail: `a target rule for this net only: ${mmText(n.clearance.plan)} to ${mmText(f.clearance.floor)}`, rules: [clr] });
    if (wid) cands.push({ id: "width", title: `Plan ${net} at the floor width`, detail: `a target rule for this net only: ${mmText(n.width.plan)} to ${mmText(f.width.floor)}`, rules: [wid] });
    if (clr && wid) cands.push({ id: "both", title: `Plan ${net} at the floor clearance and width`, detail: "both target rules, this net only", rules: [clr, wid] });
    const notRun = (c: (typeof cands)[number], why: string): RelaxOption => ({ ...c, result: { routed: false, open: 0, errors: 0, vias: 0, length: 0, newFindings: 0, ms: 0, skipped: why } });
    // how long one run of that router took on this net (the attempt's or the probe's): a relaxation is not started
    // with less time left than that, since it would only be stopped
    const runs = [...(attempt?.stages ?? []).filter((x) => x.router === single?.id && (x.status === "complete" || x.status === "partial")).map((x) => x.durationMs), ...(probeRun && probe ? probeRun.p.stages.filter((x) => x.router === single?.id && (x.status === "complete" || x.status === "partial")).map((x) => x.durationMs) : [])];
    const oneRun = runs.length ? Math.min(...runs) : 0;
    // the most relaxed first, two at a time: when it does not route, the less relaxed ones not yet started are not
    const order = [...cands].sort((a, b) => b.rules.length - a.rules.length);
    const results = new Map<string, RelaxOption>();
    let blockedBy: string | undefined = probe && !probe.routed ? "with only the fab floor and no-go areas it did not route either, so no target relaxation can" : undefined;
    const testRun = async (c: (typeof cands)[number], i: number): Promise<void> => {
      if (blockedBy) return void results.set(c.id, notRun(c, blockedBy));
      if (signal?.aborted) return void results.set(c.id, notRun(c, "cancelled"));
      if (!single) return void results.set(c.id, notRun(c, "no router is available"));
      if (left() < Math.max(1000, oneRun * 0.8)) {
        stopped.push(`relaxations: ${c.id} not test-run, ${(Math.max(0, left()) / 1000).toFixed(1)} s of the ${budgetMs / 1000} s budget left${oneRun ? `, one ${single.id} run here took ${(oneRun / 1000).toFixed(1)} s` : ""}`);
        return void results.set(c.id, notRun(c, `the ${budgetMs / 1000} s budget ran out`));
      }
      const t = Date.now();
      const copy = withRules(doc, c.rules);
      if (!copy) return void results.set(c.id, { ...c, result: { routed: false, open: 0, errors: 0, vias: 0, length: 0, newFindings: 0, ms: Date.now() - t, note: "the rule was refused on a copy" } });
      const span: [number, number] = [i / order.length, (i + 1) / order.length];
      progress("relaxations", span[0], { router: single.id, message: c.title });
      const p = await run(copy, "relaxations", [single], deadline, { within: span });
      cut(`relaxation ${c.id}`, p);
      const routed = p.status === "proposed" && !p.openNets.includes(net);
      const timedOut = !routed && p.stages.every((s) => s.status === "timeout" || s.status === "skipped");
      results.set(c.id, { ...c, result: { routed, open: p.candidate.open, errors: p.candidate.errors, vias: p.added.vias, length: p.added.length, newFindings: Math.max(0, p.candidate.errors - p.current.errors), ms: Date.now() - t, ...(p.status !== "proposed" ? { note: p.reasons.join("; ").slice(0, 300) } : {}), ...(timedOut ? { skipped: "stopped at the time budget before it routed" } : {}) } });
      if (!routed && !timedOut && c.rules.length > 1) blockedBy = `relaxing both did not route ${net}, so relaxing one alone will not`;
    };
    // two side by side (the most relaxed among the first): a later one is pruned by what they found
    let next = 0;
    while (next < order.length) {
      const batch = order.slice(next, next + RELAX_PARALLEL);
      await Promise.all(batch.map((c, k) => testRun(c, next + k)));
      next += batch.length;
    }
    for (const c of cands) relaxOptions.push(results.get(c.id)!);
  }
  progress("relaxations", 1);

  const summary =
    verdict === "connected"
      ? pour
        ? `${net} is left to its pour: the fill joins every pad, so there is nothing to route`
        : `${net} has no open connection: there is nothing to route`
      : verdict === "routes"
        ? `${net} routes with every rule as it is: run the autorouter on it`
        : verdict === "unknown"
          ? `Not known: the ${budgetMs / 1000} s budget ran out before the probe could say whether rules or placement block ${net}; diagnose it again with a larger budget`
          : verdict === "rules"
            ? `Rules, not placement: with only the fab floor and no-go areas, ${net} routed (${mmText(probe!.length)}, ${plural(probe!.vias, "via")}); a rule above the floor blocks it`
            : probe?.routed
              ? `Placement: the probe routed ${net} only by breaking the floor clearance (${plural(probe.floorViolations, "pair")}); move parts or a no-go area`
              : `Placement: even with only the fab floor and no-go areas, ${net} did not route; the parts or a no-go area block it`;
  if (local) notes.push(`scored by what changed: ${local.stats.full} full and ${local.stats.incremental} incremental check run(s), ${local.stats.ms} ms`);
  const view: DiagnosisView = {
    net,
    seq: snapshot.seq,
    verdict,
    summary,
    attempts,
    ...(probe ? { probe } : {}),
    blockers,
    areas,
    options: relaxOptions,
    ms: Date.now() - t0,
    links,
    ...(pour ? { pour } : {}),
    budgetMs,
    ...(stopped.length ? { stopped } : {}),
    hash,
    cached: false,
    ...(notes.length ? { notes } : {}),
  };
  progress("done", 1, { message: stopped.length ? "the budget cut part of it" : "complete" });
  // a cancelled diagnosis is not an answer to keep
  if (useCache && !signal?.aborted) writeCached(hash, view, options);
  return view;
}
